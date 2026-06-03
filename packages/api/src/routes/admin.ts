import { Router, Request, Response, NextFunction, RequestHandler } from 'express';
import bcrypt from 'bcryptjs';
import { prisma } from '../lib/prisma.js';
import { verifyToken } from '../middleware/auth.js';
import { KNOWN_AGENTS, STANDARD_MODE_DISABLED, DEFAULT_HEALING_SETTINGS } from '../lib/agentConfig.js';

const router = Router();
router.use(verifyToken as RequestHandler);

// ── SUPER_ADMIN guard ──────────────────────────────────────────────────────
function requireSuperAdmin(req: Request, res: Response, next: NextFunction): void {
  if (req.user.globalRole !== 'SUPER_ADMIN') {
    res.status(403).json({ error: 'SUPER_ADMIN role is required for this action' });
    return;
  }
  next();
}

// ══════════════════════════════════════════════════════════════════════════════
// USER MANAGEMENT ROUTES (SUPER_ADMIN only)
// ══════════════════════════════════════════════════════════════════════════════

// GET /admin/users — list all users
router.get('/users', requireSuperAdmin as RequestHandler, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const users = await prisma.user.findMany({
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        email: true,
        name: true,
        globalRole: true,
        createdAt: true,
        _count: { select: { memberships: true } },
      },
    });
    res.json({ users });
  } catch (err) { next(err); }
});

// PUT /admin/users/:uid/role — change a user's global role
router.put('/users/:uid/role', requireSuperAdmin as RequestHandler, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { uid } = req.params;
    const { globalRole } = req.body as { globalRole: string };

    if (!['SUPER_ADMIN', 'USER'].includes(globalRole)) {
      res.status(400).json({ error: 'globalRole must be "SUPER_ADMIN" or "USER"' });
      return;
    }

    // Prevent demoting yourself
    if (uid === req.user.id && globalRole !== 'SUPER_ADMIN') {
      res.status(400).json({ error: 'You cannot demote your own SUPER_ADMIN role' });
      return;
    }

    const user = await prisma.user.findUnique({ where: { id: uid } });
    if (!user) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    const updated = await prisma.user.update({
      where: { id: uid },
      data: { globalRole },
      select: { id: true, email: true, name: true, globalRole: true },
    });
    res.json({ user: updated });
  } catch (err) { next(err); }
});

// POST /admin/users/:uid/reset-password — set a new password for a user
router.post('/users/:uid/reset-password', requireSuperAdmin as RequestHandler, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { uid } = req.params;
    const { newPassword } = req.body as { newPassword: string };

    if (!newPassword || newPassword.length < 8) {
      res.status(400).json({ error: 'newPassword must be at least 8 characters' });
      return;
    }

    const user = await prisma.user.findUnique({ where: { id: uid } });
    if (!user) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    const passwordHash = await bcrypt.hash(newPassword, 12);
    await prisma.user.update({ where: { id: uid }, data: { passwordHash } });

    res.json({ ok: true, message: 'Password has been reset successfully' });
  } catch (err) { next(err); }
});

// DELETE /admin/users/:uid — delete a user
router.delete('/users/:uid', requireSuperAdmin as RequestHandler, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { uid } = req.params;

    // Prevent deleting yourself
    if (uid === req.user.id) {
      res.status(400).json({ error: 'You cannot delete your own account' });
      return;
    }

    const user = await prisma.user.findUnique({ where: { id: uid } });
    if (!user) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    await prisma.user.delete({ where: { id: uid } });
    res.status(204).send();
  } catch (err) { next(err); }
});

// ── GET /admin/usage ───────────────────────────────────────────────────────
// OpenRouter key info: credit balance, usage, rate limit.

router.get('/usage', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey) {
      res.status(503).json({ error: 'OPENROUTER_API_KEY is not configured' });
      return;
    }

    const orRes = await fetch('https://openrouter.ai/api/v1/auth/key', {
      headers: { Authorization: `Bearer ${apiKey}` },
    });

    if (!orRes.ok) {
      res.status(502).json({ error: `OpenRouter responded with ${orRes.status}` });
      return;
    }

    const body = await orRes.json() as {
      data: {
        label: string;
        usage: number;
        limit: number | null;
        is_free_tier: boolean;
        rate_limit: { requests: number; interval: string };
      };
    };

    const { usage, limit, is_free_tier, rate_limit, label } = body.data;
    const remaining = limit !== null ? Math.max(0, limit - usage) : null;
    const model = process.env.OPENROUTER_MODEL ?? 'anthropic/claude-sonnet-4-5';
    const provider = process.env.LLM_PROVIDER ?? 'openrouter';

    res.json({ label, usage, limit, remaining, is_free_tier, rate_limit, model, provider });
  } catch (err) { next(err); }
});

// ── GET /admin/usage/agents?days=30 ───────────────────────────────────────
// Per-agent token usage aggregated from local LlmCall log.

router.get('/usage/agents', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const days = Math.min(365, Math.max(1, parseInt(req.query['days'] as string || '30', 10)));
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    // Aggregate per agent
    const rows = await prisma.llmCall.groupBy({
      by: ['agentName'],
      where: { createdAt: { gte: since } },
      _sum: { promptTokens: true, completionTokens: true, totalTokens: true, durationMs: true },
      _count: { id: true },
      _max: { createdAt: true },
    });

    // Total across all agents in period
    const total = rows.reduce((acc, r) => ({
      calls: acc.calls + (r._count.id ?? 0),
      tokens: acc.tokens + (r._sum.totalTokens ?? 0),
    }), { calls: 0, tokens: 0 });

    const agents = rows
      .map((r) => ({
        agentName: r.agentName,
        calls: r._count.id ?? 0,
        promptTokens: r._sum.promptTokens ?? 0,
        completionTokens: r._sum.completionTokens ?? 0,
        totalTokens: r._sum.totalTokens ?? 0,
        avgDurationMs: r._count.id ? Math.round((r._sum.durationMs ?? 0) / r._count.id) : 0,
        lastUsed: r._max.createdAt?.toISOString() ?? null,
      }))
      .sort((a, b) => b.totalTokens - a.totalTokens);

    res.json({ agents, total, days });
  } catch (err) { next(err); }
});

// ── GET /admin/usage/trend?days=30 ────────────────────────────────────────
// Daily token totals for sparkline charts.

router.get('/usage/trend', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const days = Math.min(90, Math.max(1, parseInt(req.query['days'] as string || '14', 10)));
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const calls = await prisma.llmCall.findMany({
      where: { createdAt: { gte: since } },
      select: { agentName: true, totalTokens: true, createdAt: true },
      orderBy: { createdAt: 'asc' },
    });

    // Bucket by day
    const byDay = new Map<string, number>();
    for (const c of calls) {
      const day = c.createdAt.toISOString().slice(0, 10);
      byDay.set(day, (byDay.get(day) ?? 0) + c.totalTokens);
    }

    const trend = Array.from(byDay.entries()).map(([date, tokens]) => ({ date, tokens }));
    res.json({ trend });
  } catch (err) { next(err); }
});

// ── GET /admin/usage/by-project ───────────────────────────────────────────
// Per-project token usage aggregated from local LlmCall log.

router.get('/usage/by-project', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const rows = await prisma.llmCall.groupBy({
      by: ['projectId'],
      where: { projectId: { not: null } },
      _sum: { totalTokens: true },
      orderBy: { _sum: { totalTokens: 'desc' } },
    });

    const projectIds = rows
      .map((r) => r.projectId)
      .filter((id): id is string => id !== null);

    const projects = await prisma.project.findMany({
      where: { id: { in: projectIds } },
      select: { id: true, name: true },
    });
    const nameMap = new Map(projects.map((p) => [p.id, p.name]));

    // For project IDs not found in the Project table (deleted projects), look up
    // the stored projectName from the most recent LlmCall for that project.
    const orphanedIds = projectIds.filter((id) => !nameMap.has(id));
    if (orphanedIds.length > 0) {
      const orphanCalls = await prisma.llmCall.findMany({
        where: { projectId: { in: orphanedIds }, projectName: { not: null } },
        select: { projectId: true, projectName: true },
        orderBy: { createdAt: 'desc' },
      });
      for (const call of orphanCalls) {
        if (call.projectId && call.projectName && !nameMap.has(call.projectId)) {
          nameMap.set(call.projectId, call.projectName);
        }
      }
    }

    const byProject = rows
      .filter((r): r is typeof r & { projectId: string } => r.projectId !== null)
      .map((r) => ({
        projectId: r.projectId,
        projectName: nameMap.get(r.projectId) ?? 'Deleted Project',
        totalTokens: r._sum.totalTokens ?? 0,
      }));

    res.json({ byProject });
  } catch (err) { next(err); }
});

// ── GET /admin/agents ─────────────────────────────────────────────────────
// Returns every known agent with its enabled flag and settings.

router.get('/agents', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const rows = await prisma.agentConfig.findMany();
    const configMap = new Map(rows.map((r) => [r.agentName, r]));

    const agents = KNOWN_AGENTS.map((a) => {
      const row = configMap.get(a.agentName);
      let settings: Record<string, unknown> | null = null;
      if (row?.settings) {
        try { settings = JSON.parse(row.settings) as Record<string, unknown>; } catch { /* ignore */ }
      }
      // Inject defaults for healing-agent so the UI always has a value to display
      if (a.agentName === 'healing-agent' && !settings) {
        settings = DEFAULT_HEALING_SETTINGS as unknown as Record<string, unknown>;
      }
      return {
        agentName: a.agentName,
        label: a.label,
        description: a.description,
        enabled: row?.enabled ?? true,
        settings,
      };
    });

    res.json({ agents });
  } catch (err) { next(err); }
});

// ── PATCH /admin/agents/:agentName ────────────────────────────────────────
// Enable or disable a specific agent. Body: { enabled: boolean }

router.patch('/agents/:agentName', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { agentName } = req.params;
    const { enabled } = req.body as { enabled: boolean };

    if (typeof enabled !== 'boolean') {
      res.status(400).json({ error: '`enabled` must be a boolean' });
      return;
    }

    const row = await prisma.agentConfig.upsert({
      where: { agentName },
      create: { agentName, enabled },
      update: { enabled },
    });

    res.json({ agentName: row.agentName, enabled: row.enabled });
  } catch (err) { next(err); }
});

// ── PATCH /admin/agents/:agentName/settings ───────────────────────────────
// Update agent-specific settings. Body is a settings object validated per agent.

router.patch('/agents/:agentName/settings', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { agentName } = req.params;
    const body = req.body as Record<string, unknown>;

    if (agentName === 'healing-agent') {
      const { selectorTraceThreshold } = body as { selectorTraceThreshold?: unknown };
      if (
        typeof selectorTraceThreshold !== 'number' ||
        selectorTraceThreshold < 0 ||
        selectorTraceThreshold > 100
      ) {
        res.status(400).json({ error: '`selectorTraceThreshold` must be a number between 0 and 100' });
        return;
      }
    }

    const row = await prisma.agentConfig.upsert({
      where: { agentName },
      create: { agentName, enabled: true, settings: JSON.stringify(body) },
      update: { settings: JSON.stringify(body) },
    });

    let settings: Record<string, unknown> | null = null;
    if (row.settings) {
      try { settings = JSON.parse(row.settings) as Record<string, unknown>; } catch { /* ignore */ }
    }
    res.json({ agentName: row.agentName, settings });
  } catch (err) { next(err); }
});

// ── POST /admin/agents/standard-mode ─────────────────────────────────────
// Standard Mode: disables scan/heal/report agents; Writer + Script Agents stay ON.
// Full Mode: re-enables all agents.

router.post('/agents/standard-mode', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { enable } = req.body as { enable: boolean }; // true = standard mode, false = full mode

    if (typeof enable !== 'boolean') {
      res.status(400).json({ error: '`enable` must be a boolean' });
      return;
    }

    for (const agentName of STANDARD_MODE_DISABLED) {
      await prisma.agentConfig.upsert({
        where: { agentName },
        create: { agentName, enabled: !enable },
        update: { enabled: !enable },
      });
    }

    res.json({ ok: true, standardMode: enable });
  } catch (err) { next(err); }
});

export default router;
