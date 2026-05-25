import { Router, Request, Response, NextFunction, RequestHandler } from 'express';
import { prisma } from '../lib/prisma.js';
import { verifyToken } from '../middleware/auth.js';
import { KNOWN_AGENTS, STANDARD_MODE_DISABLED } from '../lib/agentConfig.js';

const router = Router();
router.use(verifyToken as RequestHandler);

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

// ── GET /admin/agents ─────────────────────────────────────────────────────
// Returns every known agent with its enabled flag (defaults to true if not yet set).

router.get('/agents', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const rows = await prisma.agentConfig.findMany();
    const configMap = new Map(rows.map((r) => [r.agentName, r.enabled]));

    const agents = KNOWN_AGENTS.map((a) => ({
      agentName: a.agentName,
      label: a.label,
      description: a.description,
      enabled: configMap.get(a.agentName) ?? true,
    }));

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
