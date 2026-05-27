import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { OAuth2Client } from 'google-auth-library';
import { prisma } from '../lib/prisma.js';
import { generateToken, verifyToken } from '../middleware/auth.js';
import { z } from 'zod';

const router = Router();

const LoginSchema = z.object({
  email:    z.string().email('Invalid email address'),
  password: z.string().min(1, 'Password is required'),
});

const RegisterSchema = z.object({
  email:    z.string().email('Invalid email address'),
  name:     z.string().min(2, 'Name must be at least 2 characters'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
});

const ChangePasswordSchema = z.object({
  currentPassword: z.string().min(1, 'Current password is required'),
  newPassword:     z.string().min(8, 'New password must be at least 8 characters'),
});

// POST /api/auth/login
router.post('/login', async (req: Request, res: Response) => {
  try {
    const parsed = LoginSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Validation failed', details: parsed.error.issues });
      return;
    }

    const { email, password } = parsed.data;
    const user = await prisma.user.findUnique({ where: { email } });

    if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
      res.status(401).json({ error: 'Invalid email or password' });
      return;
    }

    const token = generateToken({
      id:         user.id,
      email:      user.email,
      name:       user.name,
      globalRole: user.globalRole,
    });

    res.json({
      token,
      user: { id: user.id, email: user.email, name: user.name, globalRole: user.globalRole },
    });
  } catch (err) {
    console.error('[auth/login]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/auth/register
router.post('/register', async (req: Request, res: Response) => {
  try {
    const parsed = RegisterSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Validation failed', details: parsed.error.issues });
      return;
    }

    const { email, name, password } = parsed.data;
    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      res.status(409).json({ error: 'Email is already registered' });
      return;
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const user = await prisma.user.create({
      data: { email, name, passwordHash, globalRole: 'USER' },
    });

    const token = generateToken({
      id:         user.id,
      email:      user.email,
      name:       user.name,
      globalRole: user.globalRole,
    });

    res.status(201).json({
      token,
      user: { id: user.id, email: user.email, name: user.name, globalRole: user.globalRole },
    });
  } catch (err) {
    console.error('[auth/register]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/auth/me
router.get('/me', verifyToken as unknown as (req: Request, res: Response, next: () => void) => void, async (req: Request, res: Response) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user?.id },
      select: { id: true, email: true, name: true, globalRole: true },
    });

    if (!user) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    res.json(user);
  } catch (err) {
    console.error('[auth/me]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/auth/password — change own password
router.put('/password', verifyToken as unknown as (req: Request, res: Response, next: () => void) => void, async (req: Request, res: Response) => {
  try {
    const parsed = ChangePasswordSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Validation failed', details: parsed.error.issues });
      return;
    }

    const { currentPassword, newPassword } = parsed.data;
    const user = await prisma.user.findUnique({ where: { id: req.user.id } });

    if (!user || !(await bcrypt.compare(currentPassword, user.passwordHash))) {
      res.status(401).json({ error: 'Current password is incorrect' });
      return;
    }

    const passwordHash = await bcrypt.hash(newPassword, 10);
    await prisma.user.update({
      where: { id: user.id },
      data: { passwordHash },
    });

    res.json({ message: 'Password updated successfully' });
  } catch (err) {
    console.error('[auth/password]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/auth/config  — public, no JWT
// Tells the frontend whether Google SSO is enabled and what client ID to use.
// The client ID is NOT secret — it is safe to expose to the browser.
// ─────────────────────────────────────────────────────────────────────────────
router.get('/config', (_req: Request, res: Response) => {
  const clientId  = process.env.GOOGLE_CLIENT_ID ?? null;
  const rawDomains = process.env.ALLOWED_DOMAINS ?? '';
  const allowedDomains = rawDomains
    .split(',')
    .map((d) => d.trim().toLowerCase())
    .filter(Boolean);

  res.json({
    googleEnabled:   !!clientId,
    googleClientId:  clientId,
    allowedDomains,              // e.g. ["6dtech.co.in","airtelonline.com"]
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/auth/google  — public, no JWT
// Receives the Google Identity Services (GIS) credential (ID token),
// verifies it, enforces domain allow-list, then upserts the user and
// returns a QA Infinity JWT — same shape as /login.
// ─────────────────────────────────────────────────────────────────────────────
router.post('/google', async (req: Request, res: Response) => {
  try {
    const { credential } = req.body as { credential?: string };
    if (!credential) {
      res.status(400).json({ error: 'credential is required' });
      return;
    }

    const clientId = process.env.GOOGLE_CLIENT_ID;
    if (!clientId) {
      res.status(503).json({ error: 'Google SSO is not configured on this server' });
      return;
    }

    // ── 1. Verify the ID token with Google ──────────────────────────────────
    const client = new OAuth2Client(clientId);
    let payload: Awaited<ReturnType<typeof client.verifyIdToken>> extends
      Promise<infer T> ? T : never;

    try {
      const ticket = await client.verifyIdToken({
        idToken:  credential,
        audience: clientId,
      });
      payload = ticket;
    } catch {
      res.status(401).json({ error: 'Invalid or expired Google credential' });
      return;
    }

    const gPayload = payload.getPayload();
    if (!gPayload?.email) {
      res.status(401).json({ error: 'Could not read email from Google token' });
      return;
    }
    if (!gPayload.email_verified) {
      res.status(401).json({ error: 'Google account email is not verified' });
      return;
    }

    const email  = gPayload.email.toLowerCase();
    const domain = email.split('@')[1] ?? '';

    // ── 2. Enforce domain allow-list ─────────────────────────────────────────
    const allowedDomains = (process.env.ALLOWED_DOMAINS ?? '')
      .split(',')
      .map((d) => d.trim().toLowerCase())
      .filter(Boolean);

    if (allowedDomains.length > 0 && !allowedDomains.includes(domain)) {
      res.status(403).json({
        error: `Access is restricted to: ${allowedDomains.join(', ')}`,
        yourDomain: domain,
      });
      return;
    }

    // ── 3. Upsert user (create on first SSO login) ──────────────────────────
    // SSO users have no usable password — we store a random bcrypt hash so the
    // NOT NULL constraint is satisfied, but it is cryptographically inaccessible.
    let user = await prisma.user.findUnique({ where: { email } });

    if (!user) {
      const passwordHash = await bcrypt.hash(crypto.randomBytes(32).toString('hex'), 10);
      user = await prisma.user.create({
        data: {
          email,
          name:         gPayload.name ?? email.split('@')[0],
          passwordHash, // unusable — SSO users authenticate via Google
          globalRole:   'USER',
        },
      });
      console.log(`[auth/google] New user registered via SSO: ${email}`);
    }

    // ── 4. Issue QA Infinity JWT ─────────────────────────────────────────────
    const token = generateToken({
      id:         user.id,
      email:      user.email,
      name:       user.name,
      globalRole: user.globalRole,
    });

    res.json({
      token,
      user: { id: user.id, email: user.email, name: user.name, globalRole: user.globalRole },
    });
  } catch (err) {
    console.error('[auth/google]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
