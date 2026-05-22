import { Router, Request, Response, NextFunction, RequestHandler } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { verifyToken } from '../middleware/auth.js';
import { requireProjectAccess } from '../middleware/projectAccess.js';
import { runHealingAgent } from '../agents/healingAgent.js';
import { writeFileSync } from 'fs';
import { join } from 'path';

const router = Router({ mergeParams: true });
router.use(verifyToken as RequestHandler);
router.use(requireProjectAccess as unknown as RequestHandler);

// ── Schemas ────────────────────────────────────────────────────────────────

const ReviewHealSchema = z.object({
  action: z.enum(['APPROVED', 'REJECTED']),
});

// ── Helpers ────────────────────────────────────────────────────────────────

function wrap(fn: (req: Request, res: Response, next: NextFunction) => Promise<void>): RequestHandler {
  return (req, res, next) => fn(req, res, next).catch(next);
}

// ── GET /projects/:projectId/heals ─────────────────────────────────────────
// List heals for a project, optional ?status= filter
router.get('/', wrap(async (req, res) => {
  const { projectId } = req.params;
  const { status, runId } = req.query as { status?: string; runId?: string };

  const heals = await prisma.heal.findMany({
    where: {
      projectId,
      ...(status ? { status } : {}),
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

  res.json(heals);
}));

// ── GET /projects/:projectId/heals/stats ───────────────────────────────────
router.get('/stats', wrap(async (req, res) => {
  const { projectId } = req.params;

  const [pending, approved, rejected, autoApplied] = await Promise.all([
    prisma.heal.count({ where: { projectId, status: 'PENDING' } }),
    prisma.heal.count({ where: { projectId, status: 'APPROVED' } }),
    prisma.heal.count({ where: { projectId, status: 'REJECTED' } }),
    prisma.heal.count({ where: { projectId, status: 'AUTO_APPLIED' } }),
  ]);

  res.json({ pending, approved, rejected, autoApplied, total: pending + approved + rejected + autoApplied });
}));

// ── GET /projects/:projectId/heals/:healId ─────────────────────────────────
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
  res.json(heal);
}));

// ── POST /projects/:projectId/runs/:runId/heal ─────────────────────────────
// Trigger healing analysis on all FAILED results in a run
router.post('/trigger/:runId', wrap(async (req, res) => {
  const { projectId, runId } = req.params;

  const run = await prisma.run.findFirst({ where: { id: runId, projectId } });
  if (!run) { res.status(404).json({ error: 'Run not found' }); return; }

  const failedResults = await prisma.runResult.findMany({
    where: { runId, status: 'FAILED' },
    include: {
      testCase: { select: { title: true } },
      script: { select: { filename: true, content: true } },
    },
  });

  if (failedResults.length === 0) {
    res.json({ message: 'No failed results to heal', heals: [] }); return;
  }

  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { name: true, baseUrl: true },
  });

  // Return immediately — healing runs in background
  res.json({ message: `Queued ${failedResults.length} heal jobs`, count: failedResults.length });

  // Background processing
  void (async () => {
    for (const result of failedResults) {
      // Skip if heal already exists for this run result
      const existing = await prisma.heal.findFirst({ where: { runResultId: result.id } });
      if (existing) continue;

      if (!result.script) continue;

      try {
        const agentResult = await runHealingAgent({
          runResult: {
            id: result.id,
            errorMessage: result.errorMessage,
            testCaseName: result.testCase.title,
            scriptContent: result.script.content,
            scriptFilename: result.script.filename,
          },
          project: { name: project?.name ?? 'QA Infinity', baseUrl: project?.baseUrl },
        });

        await prisma.heal.create({
          data: {
            projectId,
            runResultId: result.id,
            type: agentResult.type,
            originalCode: result.script.content,
            patchedCode: agentResult.patchedCode,
            confidence: agentResult.confidence,
            status: 'PENDING',
          },
        });
      } catch (err) {
        console.error(`[healing-agent] Failed to heal runResult ${result.id}:`, (err as Error).message);
      }
    }
  })();
}));

// ── PATCH /projects/:projectId/heals/:healId ───────────────────────────────
// Approve or reject a heal
router.patch('/:healId', wrap(async (req, res) => {
  const { projectId, healId } = req.params;
  const parsed = ReviewHealSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.flatten() }); return; }

  const heal = await prisma.heal.findFirst({ where: { id: healId, projectId } });
  if (!heal) { res.status(404).json({ error: 'Heal not found' }); return; }
  if (heal.status !== 'PENDING') { res.status(409).json({ error: 'Heal already reviewed' }); return; }

  const updated = await prisma.heal.update({
    where: { id: healId },
    data: { status: parsed.data.action },
  });

  res.json(updated);
}));

// ── POST /projects/:projectId/heals/:healId/apply ──────────────────────────
// Auto-apply: write the patched code back to the script file on disk
router.post('/:healId/apply', wrap(async (req, res) => {
  const { projectId, healId } = req.params;

  const heal = await prisma.heal.findFirst({
    where: { id: healId, projectId },
    include: {
      runResult: {
        include: { script: true },
      },
    },
  });

  if (!heal) { res.status(404).json({ error: 'Heal not found' }); return; }
  if (!heal.runResult.script) { res.status(422).json({ error: 'No script linked to this heal' }); return; }

  const scriptRecord = heal.runResult.script;
  const scriptPath = join('/scripts', projectId, scriptRecord.filename);

  try {
    writeFileSync(scriptPath, heal.patchedCode, 'utf8');
  } catch (err) {
    console.error('[heals] Failed to write patched script to disk:', (err as Error).message);
    // Non-fatal — still update DB
  }

  // Update script content in DB and mark heal as AUTO_APPLIED
  const [updatedHeal] = await prisma.$transaction([
    prisma.heal.update({ where: { id: healId }, data: { status: 'AUTO_APPLIED' } }),
    prisma.script.update({ where: { id: scriptRecord.id }, data: { content: heal.patchedCode } }),
  ]);

  res.json(updatedHeal);
}));

export default router;
