import { Router, Request, Response, NextFunction, RequestHandler } from 'express';
import { z } from 'zod';
import fs from 'fs';
import { prisma } from '../lib/prisma.js';
import { verifyToken } from '../middleware/auth.js';
import { requireProjectAccess } from '../middleware/projectAccess.js';
import { addRunJob } from '../lib/queue.js';
import { registerSchedule, unregisterSchedule } from '../lib/scheduler.js';
import { testRunQueue } from '../lib/queue.js';
import { emitToRun } from '../lib/socket.js';
import { findScriptPath, saveScript } from '../services/scriptFileService.js';

// ── Zod schemas ────────────────────────────────────────────────────────────

const CreateRunSchema = z.object({
  testCaseIds: z.array(z.string().cuid()).min(1),
  environment: z.string().min(1),
  parallelWorkers: z.number().int().min(1).max(16).default(2),
  headless: z.boolean().default(true),
  browser: z.enum(['chromium', 'firefox', 'webkit']).default('chromium'),
  name: z.string().max(200).optional(),
});

const CreateGroupRunSchema = z.object({
  useCaseTag: z.string().min(1),
  environment: z.string().min(1),
  parallelWorkers: z.number().int().min(1).max(16).default(2),
  headless: z.boolean().default(true),
  browser: z.enum(['chromium', 'firefox', 'webkit']).default('chromium'),
});

const CreateScheduleSchema = z.object({
  name: z.string().min(1).max(100),
  cronExpression: z.string().min(9).max(100),
  testCaseIds: z.array(z.string()).min(1),
  environment: z.string().min(1),
  isActive: z.boolean().default(true),
  emailRecipients: z.array(z.string().email()).default([]),
  parallelWorkers: z.number().int().min(1).max(16).default(2),
});

const UpdateScheduleSchema = CreateScheduleSchema.partial();

// ── Router setup ───────────────────────────────────────────────────────────

const router = Router({ mergeParams: true });
router.use(verifyToken as RequestHandler);
router.use(requireProjectAccess as unknown as RequestHandler);

// ── Helpers ────────────────────────────────────────────────────────────────

const MAX_ACTIVE_RUNS_PER_USER    = 5;
const MAX_ACTIVE_RUNS_PER_PROJECT = 20;

async function checkRunRateLimit(
  projectId: string,
  userId: string,
  res: Response,
): Promise<boolean> {
  const [userActive, projectActive] = await Promise.all([
    prisma.run.count({
      where: { createdByUserId: userId, status: { in: ['PENDING', 'RUNNING'] } },
    }),
    prisma.run.count({
      where: { projectId, status: { in: ['PENDING', 'RUNNING'] } },
    }),
  ]);
  if (userActive >= MAX_ACTIVE_RUNS_PER_USER) {
    res.status(429).json({
      error: `You already have ${userActive} active run(s) in progress. Wait for them to complete before starting more.`,
    });
    return false;
  }
  if (projectActive >= MAX_ACTIVE_RUNS_PER_PROJECT) {
    res.status(429).json({
      error: `This project has ${projectActive} active run(s) in progress (limit ${MAX_ACTIVE_RUNS_PER_PROJECT}). Wait for existing runs to complete.`,
    });
    return false;
  }
  return true;
}

async function resolveScriptPaths(
  projectId: string,
  testCaseIds: string[],
): Promise<{ pairs: { testCaseId: string; scriptPath: string }[]; mirrorMap: Record<string, string[]> }> {
  const [project, tcsWithLinks, agentScripts] = await Promise.all([
    prisma.project.findUnique({ where: { id: projectId }, select: { slug: true } }),
    // Manually linked scripts — TC Library "Link Script" action sets linkedScriptId
    prisma.testCase.findMany({
      where: { id: { in: testCaseIds }, linkedScriptId: { not: null } },
      select: {
        id: true,
        sourceRef: true,
        useCaseTag: true,
        linkedScript: {
          select: { filename: true, content: true, useCaseFolder: true },
        },
      },
    }),
    // Agent-generated scripts — Script.testCaseId set during script generation
    prisma.script.findMany({
      where: { projectId, testCaseId: { in: testCaseIds } },
      select: {
        testCaseId: true,
        filename: true,
        content: true,
        useCaseFolder: true,
        testCase: { select: { sourceRef: true, useCaseTag: true } },
      },
    }),
  ]);

  type ScriptInfo = {
    testCaseId: string;
    filename: string;
    content: string | null;
    useCaseFolder: string | null;
    ucTag: string | null;
    sourceRef: string | null;
  };

  // Build resolution map; linkedScriptId (manual) takes priority over agent link
  const scriptMap = new Map<string, ScriptInfo>();

  for (const s of agentScripts) {
    if (s.testCaseId) {
      scriptMap.set(s.testCaseId, {
        testCaseId: s.testCaseId,
        filename: s.filename,
        content: s.content,
        useCaseFolder: s.useCaseFolder,
        ucTag: s.testCase?.useCaseTag ?? null,
        sourceRef: s.testCase?.sourceRef ?? null,
      });
    }
  }

  for (const tc of tcsWithLinks) {
    if (tc.linkedScript) {
      scriptMap.set(tc.id, {
        testCaseId: tc.id,
        filename: tc.linkedScript.filename,
        content: tc.linkedScript.content,
        useCaseFolder: tc.linkedScript.useCaseFolder,
        ucTag: tc.useCaseTag ?? null,
        sourceRef: tc.sourceRef ?? null,
      });
    }
  }

  const SCRIPTS_ROOT = process.env.SCRIPTS_ROOT ?? '/scripts';
  const slug = project?.slug ?? projectId;

  // Resolve a scriptPath for every TC that has a script
  const rawPairs: { testCaseId: string; scriptPath: string }[] = [];
  for (const s of scriptMap.values()) {
    const ucFolder = s.useCaseFolder ?? s.ucTag ?? null;

    const found = findScriptPath(slug, s.filename);
    if (found) { rawPairs.push({ testCaseId: s.testCaseId, scriptPath: found }); continue; }

    const sourceRefPath = s.sourceRef ? `${SCRIPTS_ROOT}/${slug}/${s.sourceRef}` : null;
    if (sourceRefPath && fs.existsSync(sourceRefPath)) { rawPairs.push({ testCaseId: s.testCaseId, scriptPath: sourceRefPath }); continue; }

    if (s.content) {
      saveScript(slug, s.filename, s.content, ucFolder);
      const written = findScriptPath(slug, s.filename);
      rawPairs.push({ testCaseId: s.testCaseId, scriptPath: written ?? `${SCRIPTS_ROOT}/${slug}/TestCases/${ucFolder ?? 'Uncategorised'}/${s.filename}` });
      continue;
    }

    rawPairs.push({ testCaseId: s.testCaseId, scriptPath: `${SCRIPTS_ROOT}/${slug}/TestCases/${ucFolder ?? 'Uncategorised'}/${s.filename}` });
  }

  // Deduplicate by scriptPath — same physical file should run only once.
  // First TC encountered becomes the representative; the rest become mirrors that
  // receive a copy of the representative's pass/fail result without re-running.
  const seenPaths = new Map<string, string>(); // scriptPath → representative tcId
  const pairs: { testCaseId: string; scriptPath: string }[] = [];
  const mirrorMap: Record<string, string[]> = {};

  for (const p of rawPairs) {
    const existing = seenPaths.get(p.scriptPath);
    if (existing) {
      mirrorMap[existing] = [...(mirrorMap[existing] ?? []), p.testCaseId];
    } else {
      seenPaths.set(p.scriptPath, p.testCaseId);
      pairs.push(p);
    }
  }

  return { pairs, mirrorMap };
}

async function nextRunSeq(): Promise<number> {
  const agg = await prisma.run.aggregate({ _max: { runSeq: true } });
  return (agg._max.runSeq ?? 0) + 1;
}

async function getEnvConfig(projectId: string, envName: string): Promise<{ baseUrl: string; username: string; password: string }> {
  const env = await prisma.envConfig.findFirst({
    where: { projectId, name: envName },
    select: { baseUrl: true, username: true, password: true },
  });
  return {
    baseUrl: env?.baseUrl ?? '',
    username: env?.username ?? '',
    password: env?.password ?? '',
  };
}

// ══════════════════════════════════════════════════════════════════════════════
// SCHEDULE routes  (must be registered before /:runId to avoid route collision)
// ══════════════════════════════════════════════════════════════════════════════

// GET /runs/schedules
router.get('/schedules', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const schedules = await prisma.schedule.findMany({
      where: { projectId: req.project.id },
      orderBy: { createdAt: 'desc' },
    });
    res.json({ schedules });
  } catch (err) { next(err); }
});

// POST /runs/schedules
router.post('/schedules', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const parsed = CreateScheduleSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Validation failed', issues: parsed.error.issues });
      return;
    }
    const { name, cronExpression, testCaseIds, environment, isActive, emailRecipients, parallelWorkers } = parsed.data;

    const schedule = await prisma.schedule.create({
      data: {
        projectId: req.project.id,
        name,
        cronExpression,
        testCaseIds: JSON.stringify(testCaseIds),
        environment,
        isActive,
        emailRecipients: JSON.stringify(emailRecipients),
        parallelWorkers,
      },
    });

    if (isActive) {
      registerSchedule({
        id: schedule.id,
        projectId: schedule.projectId,
        name: schedule.name,
        cronExpression: schedule.cronExpression,
        testCaseIds: schedule.testCaseIds,
        environment: schedule.environment,
        parallelWorkers: schedule.parallelWorkers,
      });
    }

    res.status(201).json({ schedule });
  } catch (err) { next(err); }
});

// PUT /runs/schedules/:id
router.put('/schedules/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const parsed = UpdateScheduleSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Validation failed', issues: parsed.error.issues });
      return;
    }
    const { id } = req.params;
    const existing = await prisma.schedule.findFirst({ where: { id, projectId: req.project.id } });
    if (!existing) { res.status(404).json({ error: 'Schedule not found' }); return; }

    const updated = await prisma.schedule.update({
      where: { id },
      data: {
        ...(parsed.data.name !== undefined && { name: parsed.data.name }),
        ...(parsed.data.cronExpression !== undefined && { cronExpression: parsed.data.cronExpression }),
        ...(parsed.data.testCaseIds !== undefined && { testCaseIds: JSON.stringify(parsed.data.testCaseIds) }),
        ...(parsed.data.environment !== undefined && { environment: parsed.data.environment }),
        ...(parsed.data.isActive !== undefined && { isActive: parsed.data.isActive }),
        ...(parsed.data.emailRecipients !== undefined && { emailRecipients: JSON.stringify(parsed.data.emailRecipients) }),
        ...(parsed.data.parallelWorkers !== undefined && { parallelWorkers: parsed.data.parallelWorkers }),
      },
    });

    unregisterSchedule(id);
    if (updated.isActive) {
      registerSchedule({
        id: updated.id,
        projectId: updated.projectId,
        name: updated.name,
        cronExpression: updated.cronExpression,
        testCaseIds: updated.testCaseIds,
        environment: updated.environment,
        parallelWorkers: updated.parallelWorkers,
      });
    }

    res.json({ schedule: updated });
  } catch (err) { next(err); }
});

// POST /runs/schedules/:id/run-now  → immediately fire a schedule
router.post('/schedules/:id/run-now', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const schedule = await prisma.schedule.findFirst({
      where: { id, projectId: req.project.id },
    });
    if (!schedule) { res.status(404).json({ error: 'Schedule not found' }); return; }

    const testCaseIds: string[] = JSON.parse(schedule.testCaseIds);
    if (testCaseIds.length === 0) {
      res.status(400).json({ error: 'Schedule has no test cases configured.' });
      return;
    }

    const { pairs: resolved, mirrorMap } = await resolveScriptPaths(req.project.id, testCaseIds);
    const scriptedIds = new Set([...resolved.map((r) => r.testCaseId), ...Object.values(mirrorMap).flat()]);
    const skippedTcIds = testCaseIds.filter((id) => !scriptedIds.has(id));

    const envConfig = await getEnvConfig(req.project.id, schedule.environment);
    const runSeqSch = await nextRunSeq();

    const run = await prisma.run.create({
      data: {
        projectId: req.project.id,
        runSeq: runSeqSch,
        name: `Scheduled (now): ${schedule.name}`,
        environment: schedule.environment,
        status: 'PENDING',
        triggerType: 'SCHEDULED',
      },
    });

    await addRunJob({
      runId: run.id,
      runSeq: runSeqSch,
      projectId: req.project.id,
      testCaseIds: resolved.map((r) => r.testCaseId),
      scriptPaths: resolved.map((r) => r.scriptPath),
      skippedTcIds,
      mirroredTcIds: mirrorMap,
      environment: schedule.environment,
      envBaseUrl: envConfig.baseUrl,
      envUsername: envConfig.username,
      envPassword: envConfig.password,
      parallelWorkers: schedule.parallelWorkers,
      headless: true,
      browser: 'chromium',
      triggerType: 'SCHEDULED',
    });

    res.status(201).json({ run });
  } catch (err) { next(err); }
});

// DELETE /runs/schedules/:id
router.delete('/schedules/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const existing = await prisma.schedule.findFirst({ where: { id, projectId: req.project.id } });
    if (!existing) { res.status(404).json({ error: 'Schedule not found' }); return; }
    unregisterSchedule(id);
    await prisma.schedule.delete({ where: { id } });
    res.status(204).send();
  } catch (err) { next(err); }
});

// ══════════════════════════════════════════════════════════════════════════════
// RUN routes
// ══════════════════════════════════════════════════════════════════════════════

// POST /runs  → MANUAL run
router.post('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const parsed = CreateRunSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Validation failed', issues: parsed.error.issues });
      return;
    }
    const { testCaseIds, environment, parallelWorkers, headless, browser, name } = parsed.data;

    if (!await checkRunRateLimit(req.project.id, req.user.id, res)) return;

    const { pairs: resolved, mirrorMap } = await resolveScriptPaths(req.project.id, testCaseIds);
    const scriptedIds = new Set([...resolved.map((r) => r.testCaseId), ...Object.values(mirrorMap).flat()]);
    const skippedTcIds = testCaseIds.filter((id) => !scriptedIds.has(id));

    const envConfig = await getEnvConfig(req.project.id, environment);
    const runSeq = await nextRunSeq();

    const run = await prisma.run.create({
      data: {
        projectId: req.project.id,
        runSeq,
        name: name ?? `Manual run — ${new Date().toLocaleString()}`,
        environment,
        status: 'PENDING',
        triggerType: 'MANUAL',
        createdByUserId: req.user.id,
      },
    });

    await addRunJob({
      runId: run.id,
      runSeq,
      projectId: req.project.id,
      testCaseIds: resolved.map((r) => r.testCaseId),
      scriptPaths: resolved.map((r) => r.scriptPath),
      skippedTcIds,
      mirroredTcIds: mirrorMap,
      environment,
      envBaseUrl: envConfig.baseUrl,
      envUsername: envConfig.username,
      envPassword: envConfig.password,
      parallelWorkers,
      headless,
      browser,
      triggerType: 'MANUAL',
    });

    res.status(201).json({ run });
  } catch (err) { next(err); }
});

// POST /runs/individual/:testCaseId
router.post('/individual/:testCaseId', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { testCaseId } = req.params;
    const environment: string = req.body.environment ?? 'Dev';
    const browser: 'chromium' | 'firefox' | 'webkit' = req.body.browser ?? 'chromium';
    const headless: boolean = req.body.headless ?? true;
    const hostBrowser: boolean = req.body.hostBrowser ?? false;

    if (!await checkRunRateLimit(req.project.id, req.user.id, res)) return;

    const tc = await prisma.testCase.findFirst({
      where: { id: testCaseId, projectId: req.project.id },
      select: { id: true, tcId: true, title: true },
    });
    if (!tc) { res.status(404).json({ error: 'Test case not found' }); return; }

    const { pairs: resolved } = await resolveScriptPaths(req.project.id, [testCaseId]);
    if (resolved.length === 0) {
      res.status(400).json({ error: 'No script found for this test case. Generate a script first.' });
      return;
    }

    const envConfig = await getEnvConfig(req.project.id, environment);
    const runSeqInd = await nextRunSeq();

    const run = await prisma.run.create({
      data: {
        projectId: req.project.id,
        runSeq: runSeqInd,
        name: `Individual: ${tc.tcId} — ${tc.title}`,
        environment,
        status: 'PENDING',
        triggerType: 'INDIVIDUAL',
        createdByUserId: req.user.id,
      },
    });

    await addRunJob({
      runId: run.id,
      runSeq: runSeqInd,
      projectId: req.project.id,
      testCaseIds: [testCaseId],
      scriptPaths: [resolved[0].scriptPath],
      environment,
      envBaseUrl: envConfig.baseUrl,
      envUsername: envConfig.username,
      envPassword: envConfig.password,
      parallelWorkers: 1,
      headless,
      browser,
      hostBrowser,
      triggerType: 'INDIVIDUAL',
    });

    res.status(201).json({ run });
  } catch (err) { next(err); }
});

// POST /runs/group
router.post('/group', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const parsed = CreateGroupRunSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Validation failed', issues: parsed.error.issues });
      return;
    }
    const { useCaseTag, environment, parallelWorkers, headless, browser } = parsed.data;

    if (!await checkRunRateLimit(req.project.id, req.user.id, res)) return;

    const tcs = await prisma.testCase.findMany({
      where: {
        projectId: req.project.id,
        useCaseTag,
        status: { in: ['APPROVED', 'DRAFT'] },
        OR: [
          { scripts: { some: {} } },
          { linkedScriptId: { not: null } },
        ],
      },
      select: { id: true },
    });
    if (tcs.length === 0) {
      res.status(400).json({ error: `No scripted test cases found in use case group "${useCaseTag}"` });
      return;
    }

    const testCaseIds = tcs.map((t) => t.id);
    const { pairs: resolved, mirrorMap } = await resolveScriptPaths(req.project.id, testCaseIds);
    const scriptedIds = new Set([...resolved.map((r) => r.testCaseId), ...Object.values(mirrorMap).flat()]);
    const skippedTcIds = testCaseIds.filter((id) => !scriptedIds.has(id));

    const envConfig = await getEnvConfig(req.project.id, environment);
    const runSeqGrp = await nextRunSeq();

    const run = await prisma.run.create({
      data: {
        projectId: req.project.id,
        runSeq: runSeqGrp,
        name: `Group: ${useCaseTag}`,
        environment,
        status: 'PENDING',
        triggerType: 'GROUP',
        createdByUserId: req.user.id,
      },
    });

    await addRunJob({
      runId: run.id,
      runSeq: runSeqGrp,
      projectId: req.project.id,
      testCaseIds: resolved.map((r) => r.testCaseId),
      scriptPaths: resolved.map((r) => r.scriptPath),
      skippedTcIds,
      mirroredTcIds: mirrorMap,
      environment,
      envBaseUrl: envConfig.baseUrl,
      envUsername: envConfig.username,
      envPassword: envConfig.password,
      parallelWorkers,
      headless,
      browser,
      triggerType: 'GROUP',
    });

    res.status(201).json({ run });
  } catch (err) { next(err); }
});

// GET /runs  → list paginated
router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const page = Math.max(1, parseInt(req.query['page'] as string || '1', 10));
    const limit = Math.min(50, parseInt(req.query['limit'] as string || '20', 10));
    const skip = (page - 1) * limit;

    const [runs, total] = await Promise.all([
      prisma.run.findMany({
        where: { projectId: req.project.id },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
        include: {
          _count: { select: { results: true } },
          results: {
            select: { status: true },
          },
        },
      }),
      prisma.run.count({ where: { projectId: req.project.id } }),
    ]);

    res.json({ runs, total, page, limit, pages: Math.ceil(total / limit) });
  } catch (err) { next(err); }
});

// GET /runs/:runId  → run details + results
router.get('/:runId', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const run = await prisma.run.findFirst({
      where: { id: req.params['runId'], projectId: req.project.id },
      include: {
        results: {
          include: {
            testCase: { select: { id: true, tcId: true, title: true, type: true, useCaseTag: true } },
          },
          orderBy: { createdAt: 'asc' },
        },
      },
    });
    if (!run) { res.status(404).json({ error: 'Run not found' }); return; }
    res.json({ run });
  } catch (err) { next(err); }
});

// POST /runs/:runId/retry  → re-run all TCs from a completed run
router.post('/:runId/retry', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const run = await prisma.run.findFirst({
      where: { id: req.params['runId'], projectId: req.project.id },
      include: { results: { select: { testCaseId: true } } },
    });
    if (!run) { res.status(404).json({ error: 'Run not found' }); return; }
    if (run.status === 'PENDING' || run.status === 'RUNNING') {
      res.status(400).json({ error: 'Cannot retry an active run' }); return;
    }

    const testCaseIds = [...new Set(run.results.map((r) => r.testCaseId))];
    if (testCaseIds.length === 0) {
      res.status(400).json({ error: 'No test cases in this run to retry' }); return;
    }

    const { pairs: resolved, mirrorMap } = await resolveScriptPaths(req.project.id, testCaseIds);
    const scriptedIds = new Set([...resolved.map((r) => r.testCaseId), ...Object.values(mirrorMap).flat()]);
    const skippedTcIds = testCaseIds.filter((id) => !scriptedIds.has(id));

    const envConfig = await getEnvConfig(req.project.id, run.environment);
    const retryRunSeq = await nextRunSeq();

    const newRun = await prisma.run.create({
      data: {
        projectId: req.project.id,
        runSeq: retryRunSeq,
        name: `Retry #${String(run.runSeq).padStart(4, '0')} — ${run.environment}`,
        environment: run.environment,
        status: 'PENDING',
        triggerType: 'MANUAL',
        createdByUserId: req.user.id,
      },
    });

    await addRunJob({
      runId: newRun.id,
      runSeq: retryRunSeq,
      projectId: req.project.id,
      testCaseIds: resolved.map((r) => r.testCaseId),
      scriptPaths: resolved.map((r) => r.scriptPath),
      skippedTcIds,
      mirroredTcIds: mirrorMap,
      environment: run.environment,
      envBaseUrl: envConfig.baseUrl,
      envUsername: envConfig.username,
      envPassword: envConfig.password,
      parallelWorkers: 2,
      headless: true,
      browser: 'chromium',
      triggerType: 'MANUAL',
    });

    res.status(201).json({ run: newRun });
  } catch (err) { next(err); }
});

// POST /runs/:runId/cancel
router.post('/:runId/cancel', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const run = await prisma.run.findFirst({
      where: { id: req.params['runId'], projectId: req.project.id },
      select: { id: true, status: true },
    });
    if (!run) { res.status(404).json({ error: 'Run not found' }); return; }
    if (run.status === 'PASSED' || run.status === 'FAILED' || run.status === 'CANCELLED') {
      res.status(400).json({ error: `Run is already in terminal state: ${run.status}` });
      return;
    }

    await prisma.run.update({
      where: { id: run.id },
      data: { status: 'CANCELLED', completedAt: new Date() },
    });

    // Immediately tell the frontend the run is cancelled — don't wait for the worker
    emitToRun(run.id, 'run:cancelled', { runId: run.id });

    // Try to remove from queue if still pending (no-op if already executing)
    try {
      const job = await testRunQueue.getJob(run.id);
      if (job) await job.remove();
    } catch { /* job may already be processing */ }

    res.json({ message: 'Run cancelled' });
  } catch (err) { next(err); }
});

export default router;
