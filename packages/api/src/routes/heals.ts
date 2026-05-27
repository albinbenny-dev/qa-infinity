import { Router, Request, Response, NextFunction, RequestHandler } from 'express';
import { prisma } from '../lib/prisma.js';
import { verifyToken } from '../middleware/auth.js';
import { requireProjectAccess } from '../middleware/projectAccess.js';
import { generateLineDiff } from '../services/diffService.js';
import { applyHeal, rejectHeal, requeueHealedTest, retryHealWithContext } from '../services/healService.js';
import { addHealJob } from '../lib/queue.js';
import { writeFileSync } from 'fs';
import { join } from 'path';

const router = Router({ mergeParams: true });
router.use(verifyToken as RequestHandler);
router.use(requireProjectAccess as unknown as RequestHandler);

// ── Helpers ────────────────────────────────────────────────────────────────

function wrap(fn: (req: Request, res: Response, next: NextFunction) => Promise<void>): RequestHandler {
  return (req, res, next) => fn(req, res, next).catch(next);
}

function attachDiff<T extends { originalCode: string; patchedCode: string }>(heal: T) {
  return {
    ...heal,
    lineDiff: generateLineDiff(heal.originalCode, heal.patchedCode),
  };
}

// ── GET /heals ─────────────────────────────────────────────────────────────
// List heals, optional ?status= and ?type= filters, includes lineDiff

router.get('/', wrap(async (req, res) => {
  const { projectId } = req.params;
  const { status, type, runId } = req.query as { status?: string; type?: string; runId?: string };

  const heals = await prisma.heal.findMany({
    where: {
      projectId,
      ...(status ? { status } : {}),
      ...(type ? { type } : {}),
      ...(runId ? { runResult: { runId } } : {}),
    },
    include: {
      runResult: {
        include: {
          testCase: { select: { id: true, tcId: true, title: true } },
          run: { select: { id: true, name: true, environment: true } },
          script: { select: { id: true, filename: true } },
        },
      },
    },
    orderBy: { createdAt: 'desc' },
  });

  res.json(heals.map(attachDiff));
}));

// ── GET /heals/stats ───────────────────────────────────────────────────────

router.get('/stats', wrap(async (req, res) => {
  const { projectId } = req.params;

  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  const [pending, approved, rejected, autoApplied, autoAppliedToday, selectorChanges, flowChanges, allConfidences] =
    await Promise.all([
      prisma.heal.count({ where: { projectId, status: 'PENDING' } }),
      prisma.heal.count({ where: { projectId, status: 'APPROVED' } }),
      prisma.heal.count({ where: { projectId, status: 'REJECTED' } }),
      prisma.heal.count({ where: { projectId, status: 'AUTO_APPLIED' } }),
      prisma.heal.count({ where: { projectId, status: 'AUTO_APPLIED', createdAt: { gte: todayStart } } }),
      prisma.heal.count({ where: { projectId, type: 'SELECTOR' } }),
      prisma.heal.count({ where: { projectId, type: 'FLOW' } }),
      prisma.heal.aggregate({ where: { projectId }, _avg: { confidence: true } }),
    ]);

  const avgConfidence = Math.round(allConfidences._avg.confidence ?? 0);

  res.json({
    pending,
    approved,
    rejected,
    autoApplied,
    total: pending + approved + rejected + autoApplied,
    autoAppliedToday,
    selectorChanges,
    flowChanges,
    avgConfidence,
  });
}));

// ── POST /heals/approve-all-confident ─────────────────────────────────────
// Bulk approve all PENDING heals with confidence ≥ 90

router.post('/approve-all-confident', wrap(async (req, res) => {
  const { projectId } = req.params;

  const pendingHighConf = await prisma.heal.findMany({
    where: { projectId, status: 'PENDING', confidence: { gte: 90 } },
    include: {
      runResult: {
        include: {
          script: true,
          testCase: { select: { id: true } },
          run: { select: { environment: true } },
        },
      },
    },
  });

  if (pendingHighConf.length === 0) {
    res.json({ message: 'No high-confidence pending heals found', count: 0 });
    return;
  }

  let approved = 0;
  const scriptRoot = process.env.SCRIPTS_PATH ?? '/scripts';

  for (const heal of pendingHighConf) {
    if (!heal.runResult.script) continue;
    try {
      const scriptPath = join(scriptRoot, projectId, heal.runResult.script.filename);
      try {
        writeFileSync(scriptPath, heal.patchedCode, 'utf8');
      } catch { /* disk write is best-effort */ }

      await prisma.$transaction([
        prisma.heal.update({ where: { id: heal.id }, data: { status: 'APPROVED' } }),
        prisma.script.update({ where: { id: heal.runResult.script.id }, data: { content: heal.patchedCode } }),
      ]);
      approved++;
    } catch (err) {
      console.error(`[heals] approve-all failed for heal ${heal.id}:`, (err as Error).message);
    }
  }

  res.json({ message: `Approved ${approved} heals`, count: approved });
}));

// ── POST /heals/trigger/:runId ─────────────────────────────────────────────
// Enqueue heal jobs for all FAILED results in a run (idempotent — skips already-healed results)

router.post('/trigger/:runId', wrap(async (req, res) => {
  const { projectId, runId } = req.params;
  const { runResultIds } = req.body as { runResultIds?: string[] };

  const run = await prisma.run.findFirst({ where: { id: runId, projectId } });
  if (!run) { res.status(404).json({ error: 'Run not found' }); return; }

  const failedResults = await prisma.runResult.findMany({
    where: {
      runId,
      status: 'FAILED',
      ...(runResultIds?.length ? { id: { in: runResultIds } } : {}),
    },
    select: { id: true },
  });

  if (failedResults.length === 0) {
    res.json({ message: 'No failed results to heal', count: 0 });
    return;
  }

  let queued = 0;
  for (const r of failedResults) {
    const existing = await prisma.heal.findFirst({ where: { runResultId: r.id } });
    if (existing) continue;
    try {
      await addHealJob({ runResultId: r.id, projectId });
      queued++;
    } catch (err) {
      console.error(`[heals] failed to queue heal job for runResult ${r.id}:`, (err as Error).message);
    }
  }

  res.json({
    message: queued > 0
      ? `Queued ${queued} heal job${queued !== 1 ? 's' : ''}`
      : 'All selected results already have heal jobs queued',
    count: queued,
  });
}));

// ── GET /heals/:healId ─────────────────────────────────────────────────────

router.get('/:healId', wrap(async (req, res) => {
  const { projectId, healId } = req.params;

  const heal = await prisma.heal.findFirst({
    where: { id: healId, projectId },
    include: {
      runResult: {
        include: {
          testCase: { select: { id: true, tcId: true, title: true } },
          run: { select: { id: true, name: true, environment: true } },
          script: { select: { id: true, filename: true, content: true } },
        },
      },
    },
  });

  if (!heal) { res.status(404).json({ error: 'Heal not found' }); return; }
  res.json(attachDiff(heal));
}));

// ── POST /heals/:healId/approve ────────────────────────────────────────────
// Apply patched code. Optional { rerun: true } queues a single INDIVIDUAL re-run.

router.post('/:healId/approve', wrap(async (req, res) => {
  const { projectId, healId } = req.params;
  const { rerun = false } = req.body as { rerun?: boolean };

  const heal = await prisma.heal.findFirst({ where: { id: healId, projectId } });
  if (!heal) { res.status(404).json({ error: 'Heal not found' }); return; }
  if (heal.status !== 'PENDING') { res.status(409).json({ error: 'Heal is not pending' }); return; }

  const opts = await applyHeal(healId);

  if (rerun) {
    const runId = await requeueHealedTest(opts);
    res.json({ message: 'Heal approved and test re-queued', runId });
  } else {
    res.json({ message: 'Heal approved — script updated' });
  }
}));

// ── POST /heals/:healId/retry-with-context ────────────────────────────────
// Re-run the patcher with user-supplied context and update the existing heal record.

router.post('/:healId/retry-with-context', wrap(async (req, res) => {
  const { projectId, healId } = req.params;
  const { userContext } = req.body as { userContext?: string };

  if (!userContext?.trim()) {
    res.status(400).json({ error: 'userContext is required' });
    return;
  }

  const heal = await prisma.heal.findFirst({ where: { id: healId, projectId } });
  if (!heal) { res.status(404).json({ error: 'Heal not found' }); return; }
  if (heal.status !== 'PENDING') { res.status(409).json({ error: 'Heal is not pending' }); return; }

  await retryHealWithContext(healId, userContext);

  const updated = await prisma.heal.findFirst({
    where: { id: healId },
    include: {
      runResult: {
        include: {
          testCase: { select: { id: true, tcId: true, title: true } },
          run: { select: { id: true, name: true, environment: true } },
          script: { select: { id: true, filename: true } },
        },
      },
    },
  });

  res.json(attachDiff(updated!));
}));

// ── POST /heals/:healId/reject ─────────────────────────────────────────────

router.post('/:healId/reject', wrap(async (req, res) => {
  const { projectId, healId } = req.params;

  const heal = await prisma.heal.findFirst({ where: { id: healId, projectId } });
  if (!heal) { res.status(404).json({ error: 'Heal not found' }); return; }
  if (heal.status !== 'PENDING') { res.status(409).json({ error: 'Heal is not pending' }); return; }

  await rejectHeal(healId);
  res.json({ message: 'Heal rejected' });
}));

// ── PATCH /heals/:healId (legacy review) ──────────────────────────────────

router.patch('/:healId', wrap(async (req, res) => {
  const { projectId, healId } = req.params;
  const action = (req.body as { action?: string }).action;

  if (!action || !['APPROVED', 'REJECTED'].includes(action)) {
    res.status(400).json({ error: 'action must be APPROVED or REJECTED' });
    return;
  }

  const heal = await prisma.heal.findFirst({ where: { id: healId, projectId } });
  if (!heal) { res.status(404).json({ error: 'Heal not found' }); return; }
  if (heal.status !== 'PENDING') { res.status(409).json({ error: 'Heal already reviewed' }); return; }

  const updated = await prisma.heal.update({ where: { id: healId }, data: { status: action } });
  res.json(updated);
}));

// ── DELETE /heals/:healId ─────────────────────────────────────────────────
// Hard-delete a heal record (used to clear EXHAUSTED cards from the UI)

router.delete('/:healId', wrap(async (req, res) => {
  const { projectId, healId } = req.params;

  const heal = await prisma.heal.findFirst({ where: { id: healId, projectId } });
  if (!heal) { res.status(404).json({ error: 'Heal not found' }); return; }

  await prisma.heal.delete({ where: { id: healId } });
  res.json({ message: 'Heal deleted' });
}));

// ── POST /heals/:healId/apply (legacy auto-apply) ─────────────────────────

router.post('/:healId/apply', wrap(async (req, res) => {
  const { projectId, healId } = req.params;

  const heal = await prisma.heal.findFirst({
    where: { id: healId, projectId },
    include: { runResult: { include: { script: true } } },
  });

  if (!heal) { res.status(404).json({ error: 'Heal not found' }); return; }
  if (!heal.runResult.script) { res.status(422).json({ error: 'No script linked to this heal' }); return; }

  const scriptRecord = heal.runResult.script;
  const scriptPath = join(process.env.SCRIPTS_PATH ?? '/scripts', projectId, scriptRecord.filename);

  try {
    writeFileSync(scriptPath, heal.patchedCode, 'utf8');
  } catch (err) {
    console.error('[heals] Failed to write patched script:', (err as Error).message);
  }

  const [updatedHeal] = await prisma.$transaction([
    prisma.heal.update({ where: { id: healId }, data: { status: 'AUTO_APPLIED' } }),
    prisma.script.update({ where: { id: scriptRecord.id }, data: { content: heal.patchedCode } }),
  ]);

  res.json(updatedHeal);
}));

export default router;
