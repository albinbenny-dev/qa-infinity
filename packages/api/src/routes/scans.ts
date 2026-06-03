import { Router, Request, Response, NextFunction, RequestHandler } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { verifyToken } from '../middleware/auth.js';
import { requireProjectAccess } from '../middleware/projectAccess.js';
import { addScanJob } from '../lib/queue.js';
import type { LoginInstructions } from '../types/scanner.js';
import { testLoginFlow } from '../services/loginTester.js';
import { quickLoginTest } from '../services/uiScannerService.js';

const router = Router({ mergeParams: true });
router.use(verifyToken as RequestHandler);
router.use(requireProjectAccess as unknown as RequestHandler);

function wrap(fn: (req: Request, res: Response, next: NextFunction) => Promise<void>): RequestHandler {
  return (req, res, next) => fn(req, res, next).catch(next);
}

const StartScanSchema = z.object({
  envConfigId: z.string().min(1),
  scanDepth: z.enum(['full', 'top-level', 'login-only']).default('full'),
  generateTCs: z.boolean().default(false),
  customInstructions: z.string().max(2000).optional(),
});

const UpdateContextSchema = z.object({
  loginInstructions: z.object({
    steps: z.array(z.object({
      order: z.number(),
      description: z.string(),
      selector: z.string().optional(),
      action: z.enum(['navigate', 'fill', 'click', 'assert']),
    })),
    selectors: z.object({
      username: z.string(),
      password: z.string(),
      submit: z.string(),
    }),
    loginType: z.enum(['standard', 'two-step', 'sso']),
    postLoginUrl: z.string(),
    notes: z.string(),
  }).optional(),
  customInstructions: z.string().max(2000).nullable().optional(),
  pendingTCDraft: z.null().optional(), // only clearing is allowed from the client
});

// ── POST /scans — trigger a new scan ──────────────────────────────────────

router.post('/', wrap(async (req, res) => {
  const parsed = StartScanSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Validation failed', issues: parsed.error.issues });
    return;
  }

  const { envConfigId, scanDepth, generateTCs, customInstructions } = parsed.data;
  const projectId = req.project.id;

  const envConfig = await prisma.envConfig.findFirst({
    where: { id: envConfigId, projectId },
  });

  if (!envConfig) {
    res.status(404).json({ error: 'EnvConfig not found or does not belong to this project' });
    return;
  }

  if (!envConfig.baseUrl) {
    res.status(422).json({ error: 'EnvConfig has no baseUrl configured' });
    return;
  }

  const scan = await prisma.uIScan.create({
    data: {
      projectId,
      status: 'PENDING',
      triggeredBy: req.user.id,
    },
  });

  await addScanJob({
    scanId: scan.id,
    projectId,
    baseUrl: envConfig.baseUrl,
    username: envConfig.username ?? '',
    password: envConfig.password ?? '',
    scanDepth,
    generateTCs,
    triggeredBy: req.user.id,
    customInstructions,
  });

  res.status(201).json({ scanId: scan.id });
}));

// ── GET /scans — list all scans for the project ───────────────────────────

router.get('/', wrap(async (req, res) => {
  const projectId = req.project.id;

  const scans = await prisma.uIScan.findMany({
    where: { projectId },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      projectId: true,
      status: true,
      triggeredBy: true,
      startedAt: true,
      completedAt: true,
      progress: true,
      currentPage: true,
      pagesTotal: true,
      pagesScanned: true,
      errorMessage: true,
      createdAt: true,
      // omit rawPageData — too large for list
    },
  });

  res.json(scans);
}));

// ── GET /scans/:scanId — get a single scan with raw data ──────────────────

router.get('/:scanId', wrap(async (req, res) => {
  const { scanId } = req.params;
  const projectId = req.project.id;

  const scan = await prisma.uIScan.findFirst({
    where: { id: scanId, projectId },
  });

  if (!scan) {
    res.status(404).json({ error: 'Scan not found' });
    return;
  }

  res.json(scan);
}));

// ── DELETE /scans/:scanId ─────────────────────────────────────────────────

router.delete('/:scanId', wrap(async (req, res) => {
  const { scanId } = req.params;
  const projectId = req.project.id;

  const scan = await prisma.uIScan.findFirst({
    where: { id: scanId, projectId },
  });

  if (!scan) {
    res.status(404).json({ error: 'Scan not found' });
    return;
  }

  if (scan.status === 'RUNNING') {
    res.status(409).json({ error: 'Cannot delete a scan that is currently running' });
    return;
  }

  await prisma.uIScan.delete({ where: { id: scanId } });
  res.json({ message: 'Scan deleted' });
}));

// ── POST /quick-login-test — detect login + verify credentials (pre-scan) ──

const QuickLoginTestSchema = z.object({
  envConfigId: z.string().min(1),
});

router.post('/quick-login-test', wrap(async (req, res) => {
  const parsed = QuickLoginTestSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Validation failed', issues: parsed.error.issues });
    return;
  }

  const { envConfigId } = parsed.data;
  const projectId = req.project.id;

  const envConfig = await prisma.envConfig.findFirst({
    where: { id: envConfigId, projectId },
  });

  if (!envConfig) {
    res.status(404).json({ error: 'EnvConfig not found or does not belong to this project' });
    return;
  }

  if (!envConfig.baseUrl) {
    res.status(422).json({ error: 'EnvConfig has no baseUrl configured' });
    return;
  }

  const result = await quickLoginTest({
    baseUrl: envConfig.baseUrl,
    username: envConfig.username ?? '',
    password: envConfig.password ?? '',
  });

  // On success, save the detected loginInstructions to ProjectContext so the
  // next scan can skip detection and directly use the verified steps.
  if (result.success && result.loginInstructions) {
    await prisma.projectContext.upsert({
      where: { projectId },
      create: {
        projectId,
        loginInstructions: JSON.stringify(result.loginInstructions),
        navigationMap: '[]',
        pageLocators: '{}',
        useCaseSummary: '[]',
      },
      update: {
        loginInstructions: JSON.stringify(result.loginInstructions),
      },
    }).catch((err: Error) => {
      console.error('[quick-login-test] Failed to save login instructions:', err.message);
    });
  }

  // Omit loginInstructions from response (internal detail; frontend only needs success/screenshot)
  const { loginInstructions: _li, ...clientResult } = result;
  res.json(clientResult);
}));

// ── POST /context/test-login — verify login instructions work ─────────────

router.post('/context/test-login', wrap(async (req, res) => {
  const projectId = req.project.id;

  const ctx = await prisma.projectContext.findUnique({ where: { projectId } });
  if (!ctx?.loginInstructions) {
    res.status(422).json({ error: 'No login instructions found — run a UI scan first' });
    return;
  }

  let login: LoginInstructions;
  try {
    login = JSON.parse(ctx.loginInstructions) as LoginInstructions;
  } catch {
    res.status(422).json({ error: 'Login instructions are malformed — re-run a UI scan to regenerate them' });
    return;
  }
  if (!login?.steps?.length) {
    res.status(422).json({ error: 'No login steps found — re-run a UI scan to regenerate login instructions' });
    return;
  }

  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { baseUrl: true },
  });

  const envConfig =
    (await prisma.envConfig.findFirst({ where: { projectId, isDefault: true } })) ??
    (await prisma.envConfig.findFirst({ where: { projectId } }));

  const baseUrl = envConfig?.baseUrl ?? project?.baseUrl;
  if (!baseUrl) {
    res.status(422).json({ error: 'No base URL configured. Add an environment in Project Settings first.' });
    return;
  }
  const result = await testLoginFlow({
    baseUrl,
    username: envConfig?.username ?? '',
    password: envConfig?.password ?? '',
    login,
  });

  res.json(result);
}));

// ── GET /context — get the project's UI context ───────────────────────────

router.get('/context/current', wrap(async (req, res) => {
  const projectId = req.project.id;

  const context = await prisma.projectContext.findUnique({
    where: { projectId },
  });

  if (!context) {
    res.status(404).json({ error: 'No project context found — run a UI scan first' });
    return;
  }

  // Parse JSON fields before returning
  res.json({
    ...context,
    loginInstructions: context.loginInstructions ? JSON.parse(context.loginInstructions) : null,
    navigationMap: context.navigationMap ? JSON.parse(context.navigationMap) : null,
    pageLocators: context.pageLocators ? JSON.parse(context.pageLocators) : null,
    useCaseSummary: context.useCaseSummary ? JSON.parse(context.useCaseSummary) : null,
    pendingTCDraft: context.pendingTCDraft ? JSON.parse(context.pendingTCDraft) : null,
  });
}));

// ── PATCH /context — update login instructions and/or custom instructions ──

router.patch('/context/current', wrap(async (req, res) => {
  const parsed = UpdateContextSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Validation failed', issues: parsed.error.issues });
    return;
  }

  const projectId = req.project.id;

  const updateData: Record<string, unknown> = {};
  if (parsed.data.loginInstructions !== undefined) {
    updateData.loginInstructions = JSON.stringify(parsed.data.loginInstructions as LoginInstructions);
  }
  if (parsed.data.customInstructions !== undefined) {
    updateData.customInstructions = parsed.data.customInstructions;
  }
  if (parsed.data.pendingTCDraft === null) {
    updateData.pendingTCDraft = null;
  }

  // Upsert: create the context record if it doesn't exist yet (no scan required to set custom instructions)
  const updated = await prisma.projectContext.upsert({
    where: { projectId },
    create: { projectId, ...updateData },
    update: updateData,
  });

  res.json({
    ...updated,
    loginInstructions: updated.loginInstructions ? JSON.parse(updated.loginInstructions) : null,
    navigationMap: updated.navigationMap ? JSON.parse(updated.navigationMap) : null,
    pageLocators: updated.pageLocators ? JSON.parse(updated.pageLocators) : null,
    useCaseSummary: updated.useCaseSummary ? JSON.parse(updated.useCaseSummary) : null,
    pendingTCDraft: updated.pendingTCDraft ? JSON.parse(updated.pendingTCDraft) : null,
  });
}));

export default router;
