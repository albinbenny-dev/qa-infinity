import { Router, RequestHandler } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { verifyToken } from '../middleware/auth.js';
import { requireProjectAccess } from '../middleware/projectAccess.js';
import { addRunJob } from '../lib/queue.js';
import { findScriptPath, saveScript } from '../services/scriptFileService.js';

// ── Types ──────────────────────────────────────────────────────────────────

interface SuiteStage {
  id: string;
  useCaseTag: string;
  tcIds: string[];
  mode: 'parallel' | 'sequential';
  order: number;
}

// ── Zod schemas ────────────────────────────────────────────────────────────

const StageSchema = z.object({
  id: z.string(),
  useCaseTag: z.string(),
  tcIds: z.array(z.string()),
  mode: z.enum(['parallel', 'sequential']),
  order: z.number(),
});

const CreateSuiteSchema = z.object({
  name: z.string().min(1).max(100),
  stages: z.array(StageSchema).min(1),
  // backward compat: optional flat list, derived from stages if not provided
  testCaseIds: z.array(z.string()).optional(),
});

const UpdateSuiteSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  stages: z.array(StageSchema).optional(),
  testCaseIds: z.array(z.string()).optional(),
});

const RunSuiteSchema = z.object({
  environment:     z.string().optional(),
  parallelWorkers: z.number().int().min(1).max(8).default(2),
  headless:        z.boolean().default(true),
  browser:         z.enum(['chromium', 'firefox', 'webkit']).default('chromium'),
  name:            z.string().max(200).optional(),
});

// ── Helpers ────────────────────────────────────────────────────────────────

async function nextRunSeq(): Promise<number> {
  const agg = await prisma.run.aggregate({ _max: { runSeq: true } });
  return (agg._max.runSeq ?? 0) + 1;
}

async function getEnvConfig(
  projectId: string,
  envName: string,
): Promise<{ baseUrl: string; username: string; password: string }> {
  const env = await prisma.envConfig.findFirst({
    where: { projectId, name: envName },
    select: { baseUrl: true, username: true, password: true },
  });
  return { baseUrl: env?.baseUrl ?? '', username: env?.username ?? '', password: env?.password ?? '' };
}

async function resolveScriptPath(
  slug: string,
  projectId: string,
  tcId: string,
): Promise<string | null> {
  const script = await prisma.script.findFirst({
    where: { projectId, testCaseId: tcId },
    select: { filename: true, content: true, useCaseFolder: true, testCase: { select: { useCaseTag: true } } },
  });
  if (!script) return null;

  const SCRIPTS_ROOT = process.env.SCRIPTS_ROOT ?? '/scripts';
  const found = findScriptPath(slug, script.filename);
  if (found) return found;

  if (script.content) {
    const useCase = script.useCaseFolder ?? (script.testCase as { useCaseTag?: string } | null)?.useCaseTag ?? null;
    saveScript(slug, script.filename, script.content, useCase);
    return findScriptPath(slug, script.filename) ?? `${SCRIPTS_ROOT}/${slug}/scripts/${script.filename}`;
  }
  return null;
}

// ── Router ─────────────────────────────────────────────────────────────────

const router = Router({ mergeParams: true });
router.use(verifyToken as RequestHandler);
router.use(requireProjectAccess as unknown as RequestHandler);

// ── GET /projects/:projectId/suites ────────────────────────────────────────

router.get('/', (async (req, res) => {
  const projectId = req.project.id;
  const suites = await prisma.suite.findMany({
    where: { projectId },
    orderBy: { createdAt: 'asc' },
  });
  res.json({ suites });
}) as RequestHandler);

// ── POST /projects/:projectId/suites ───────────────────────────────────────

router.post('/', (async (req, res) => {
  const projectId = req.project.id;
  const parsed = CreateSuiteSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const { name, stages } = parsed.data;
  // Derive flat testCaseIds from stages (for backward compat / CI endpoint)
  const allTcIds = Array.from(new Set(stages.flatMap(s => s.tcIds)));

  const suite = await prisma.suite.create({
    data: {
      projectId,
      name,
      stages: JSON.stringify(stages),
      testCaseIds: JSON.stringify(allTcIds),
    },
  });
  res.status(201).json({ suite });
}) as RequestHandler);

// ── PUT /projects/:projectId/suites/:suiteId ───────────────────────────────

router.put('/:suiteId', (async (req, res) => {
  const projectId = req.project.id;
  const { suiteId } = req.params;
  const parsed = UpdateSuiteSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const existing = await prisma.suite.findFirst({ where: { id: suiteId, projectId } });
  if (!existing) return res.status(404).json({ error: 'Suite not found' });

  const data: Record<string, unknown> = {};
  if (parsed.data.name !== undefined) data.name = parsed.data.name;
  if (parsed.data.stages !== undefined) {
    data.stages = JSON.stringify(parsed.data.stages);
    // Keep flat testCaseIds in sync
    const allTcIds = Array.from(new Set(parsed.data.stages.flatMap(s => s.tcIds)));
    data.testCaseIds = JSON.stringify(allTcIds);
  } else if (parsed.data.testCaseIds !== undefined) {
    data.testCaseIds = JSON.stringify(parsed.data.testCaseIds);
  }

  const suite = await prisma.suite.update({ where: { id: suiteId }, data });
  res.json({ suite });
}) as RequestHandler);

// ── POST /projects/:projectId/suites/:suiteId/run ─────────────────────────

router.post('/:suiteId/run', (async (req, res) => {
  const projectId = req.project.id;
  const { suiteId } = req.params;

  const parsed = RunSuiteSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Validation failed', issues: parsed.error.issues });
  const { parallelWorkers, headless, browser, name } = parsed.data;

  const suite = await prisma.suite.findFirst({ where: { id: suiteId, projectId } });
  if (!suite) return res.status(404).json({ error: 'Suite not found' });

  // Resolve environment
  let environment = parsed.data.environment ?? '';
  if (!environment) {
    const defaultEnv = await prisma.envConfig.findFirst({
      where: { projectId, isDefault: true },
      select: { name: true },
    }) ?? await prisma.envConfig.findFirst({ where: { projectId }, select: { name: true } });
    environment = defaultEnv?.name ?? 'QA';
  }

  // Parse stages (fall back to flat testCaseIds for older suites)
  let stages: SuiteStage[] = [];
  try { stages = JSON.parse(suite.stages) as SuiteStage[]; } catch { /* noop */ }

  let testCaseIds: string[] = [];
  if (stages.length > 0) {
    testCaseIds = Array.from(new Set(stages.flatMap(s => s.tcIds)));
  } else {
    try { testCaseIds = JSON.parse(suite.testCaseIds) as string[]; } catch { /* noop */ }
  }

  if (testCaseIds.length === 0) {
    return res.status(400).json({ error: `Suite "${suite.name}" has no test cases.` });
  }

  // Resolve script paths
  const project = await prisma.project.findUnique({ where: { id: projectId }, select: { slug: true } });
  const slug = project?.slug ?? projectId;

  const scriptPairs: { testCaseId: string; scriptPath: string }[] = [];
  for (const tcId of testCaseIds) {
    const path = await resolveScriptPath(slug, projectId, tcId);
    if (path) scriptPairs.push({ testCaseId: tcId, scriptPath: path });
  }

  if (scriptPairs.length === 0) {
    return res.status(400).json({ error: `No scripts found for suite "${suite.name}". Generate scripts first.` });
  }

  const skippedTcIds = testCaseIds.filter(id => !scriptPairs.some(s => s.testCaseId === id));
  const envConfig = await getEnvConfig(projectId, environment);
  const runSeq = await nextRunSeq();
  const runName = name ?? `Suite: ${suite.name}`;

  const run = await prisma.run.create({
    data: { projectId, runSeq, name: runName, environment, status: 'PENDING', triggerType: 'SUITE' },
  });

  await addRunJob({
    runId: run.id,
    runSeq,
    projectId,
    testCaseIds: scriptPairs.map(r => r.testCaseId),
    scriptPaths: scriptPairs.map(r => r.scriptPath),
    skippedTcIds,
    environment,
    envBaseUrl: envConfig.baseUrl,
    envUsername: envConfig.username,
    envPassword: envConfig.password,
    parallelWorkers,
    headless,
    browser,
    triggerType: 'SUITE',
  });

  return res.status(201).json({
    run,
    meta: {
      totalTestCases: testCaseIds.length,
      scriptedCount: scriptPairs.length,
      skippedCount: skippedTcIds.length,
      stageCount: stages.length,
      ...(skippedTcIds.length > 0 && { skippedTcIds }),
    },
  });
}) as RequestHandler);

// ── DELETE /projects/:projectId/suites/:suiteId ────────────────────────────

router.delete('/:suiteId', (async (req, res) => {
  const projectId = req.project.id;
  const { suiteId } = req.params;
  const existing = await prisma.suite.findFirst({ where: { id: suiteId, projectId } });
  if (!existing) return res.status(404).json({ error: 'Suite not found' });
  await prisma.suite.delete({ where: { id: suiteId } });
  res.json({ message: 'Suite deleted' });
}) as RequestHandler);

export default router;
