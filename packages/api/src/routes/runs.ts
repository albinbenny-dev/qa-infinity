import { Router, Request, Response, NextFunction, RequestHandler } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { verifyToken } from '../middleware/auth.js';
import { requireProjectAccess } from '../middleware/projectAccess.js';
import { addRunJob } from '../lib/queue.js';
import { registerSchedule, unregisterSchedule } from '../lib/scheduler.js';
import { testRunQueue } from '../lib/queue.js';
import { emitToRun } from '../lib/socket.js';

// ── Zod schemas ────────────────────────────────────────────────────────────

const CreateRunSchema = z.object({
  testCaseIds: z.array(z.string().cuid()).min(1),
  environment: z.string().min(1),
  parallelWorkers: z.number().int().min(1).max(8).default(2),
  headless: z.boolean().default(true),
  browser: z.enum(['chromium', 'firefox', 'webkit']).default('chromium'),
  name: z.string().max(200).optional(),
});

const CreateGroupRunSchema = z.object({
  useCaseTag: z.string().min(1),
  environment: z.string().min(1),
  parallelWorkers: z.number().int().min(1).max(8).default(2),
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
});

const UpdateScheduleSchema = CreateScheduleSchema.partial();

// ── Router setup ───────────────────────────────────────────────────────────

const router = Router({ mergeParams: true });
router.use(verifyToken as RequestHandler);
router.use(requireProjectAccess as unknown as RequestHandler);

// ── Helpers ────────────────────────────────────────────────────────────────

async function resolveScriptPaths(
  projectId: string,
  testCaseIds: string[],
): Promise<{ testCaseId: string; scriptPath: string }[]> {
  const scripts = await prisma.script.findMany({
    where: { projectId, testCaseId: { in: testCaseIds } },
    select: { testCaseId: true, filename: true },
  });
  return scripts
    .filter((s): s is typeof s & { testCaseId: string } => s.testCaseId !== null)
    .map((s) => ({
      testCaseId: s.testCaseId,
      scriptPath: `/scripts/${projectId}/${s.filename}`,
    }));
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
    const { name, cronExpression, testCaseIds, environment, isActive, emailRecipients } = parsed.data;

    const schedule = await prisma.schedule.create({
      data: {
        projectId: req.project.id,
        name,
        cronExpression,
        testCaseIds: JSON.stringify(testCaseIds),
        environment,
        isActive,
        emailRecipients: JSON.stringify(emailRecipients),
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

    const resolved = await resolveScriptPaths(req.project.id, testCaseIds);
    if (resolved.length === 0) {
      res.status(400).json({ error: 'No scripts found for scheduled test cases. Generate scripts first.' });
      return;
    }

    const envConfig = await getEnvConfig(req.project.id, schedule.environment);

    const run = await prisma.run.create({
      data: {
        projectId: req.project.id,
        name: `Scheduled (now): ${schedule.name}`,
        environment: schedule.environment,
        status: 'PENDING',
        triggerType: 'SCHEDULED',
      },
    });

    await addRunJob({
      runId: run.id,
      projectId: req.project.id,
      testCaseIds: resolved.map((r) => r.testCaseId),
      scriptPaths: resolved.map((r) => r.scriptPath),
      environment: schedule.environment,
      envBaseUrl: envConfig.baseUrl,
      envUsername: envConfig.username,
      envPassword: envConfig.password,
      parallelWorkers: 2,
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

    const resolved = await resolveScriptPaths(req.project.id, testCaseIds);
    if (resolved.length === 0) {
      res.status(400).json({ error: 'No scripts found for the selected test cases. Generate scripts first.' });
      return;
    }

    const envConfig = await getEnvConfig(req.project.id, environment);

    const run = await prisma.run.create({
      data: {
        projectId: req.project.id,
        name: name ?? `Manual run — ${new Date().toLocaleString()}`,
        environment,
        status: 'PENDING',
        triggerType: 'MANUAL',
      },
    });

    await addRunJob({
      runId: run.id,
      projectId: req.project.id,
      testCaseIds: resolved.map((r) => r.testCaseId),
      scriptPaths: resolved.map((r) => r.scriptPath),
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

    const tc = await prisma.testCase.findFirst({
      where: { id: testCaseId, projectId: req.project.id },
      select: { id: true, tcId: true, title: true },
    });
    if (!tc) { res.status(404).json({ error: 'Test case not found' }); return; }

    const resolved = await resolveScriptPaths(req.project.id, [testCaseId]);
    if (resolved.length === 0) {
      res.status(400).json({ error: 'No script found for this test case. Generate a script first.' });
      return;
    }

    const envConfig = await getEnvConfig(req.project.id, environment);

    const run = await prisma.run.create({
      data: {
        projectId: req.project.id,
        name: `Individual: ${tc.tcId} — ${tc.title}`,
        environment,
        status: 'PENDING',
        triggerType: 'INDIVIDUAL',
      },
    });

    await addRunJob({
      runId: run.id,
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

    const tcs = await prisma.testCase.findMany({
      where: { projectId: req.project.id, useCaseTag, status: { in: ['APPROVED', 'DRAFT'] } },
      select: { id: true },
    });
    if (tcs.length === 0) {
      res.status(400).json({ error: `No test cases found in use case group "${useCaseTag}"` });
      return;
    }

    const testCaseIds = tcs.map((t) => t.id);
    const resolved = await resolveScriptPaths(req.project.id, testCaseIds);
    if (resolved.length === 0) {
      res.status(400).json({ error: 'No scripts found for this group. Generate scripts first.' });
      return;
    }

    const envConfig = await getEnvConfig(req.project.id, environment);

    const run = await prisma.run.create({
      data: {
        projectId: req.project.id,
        name: `Group: ${useCaseTag}`,
        environment,
        status: 'PENDING',
        triggerType: 'GROUP',
      },
    });

    await addRunJob({
      runId: run.id,
      projectId: req.project.id,
      testCaseIds: resolved.map((r) => r.testCaseId),
      scriptPaths: resolved.map((r) => r.scriptPath),
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
