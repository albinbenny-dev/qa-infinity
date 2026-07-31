import { Worker, type Job } from 'bullmq';
import fs from 'fs';
import path from 'path';
import { prisma } from '../lib/prisma.js';
import { emitToProject } from '../lib/socket.js';
import type { ScriptVerifyJobPayload } from '../lib/queue.js';
import { runClassifier, runPatcher } from '../agents/healingAgent.js';
import { saveScript, listResourceFiles, readResourceFile } from '../services/scriptFileService.js';
import { runScriptAgent, type ResourceFileInfo } from '../agents/scriptAgent.js';

const ARTIFACTS_ROOT = process.env.ARTIFACTS_PATH ?? '/artifacts';
const SCRIPTS_ROOT = process.env.SCRIPTS_PATH ?? '/scripts';

function parseRedisUrl(url: string): { host: string; port: number; password?: string; db: number } {
  try {
    const u = new URL(url);
    return {
      host: u.hostname || 'localhost',
      port: parseInt(u.port || '6379', 10),
      password: u.password || undefined,
      db: parseInt(u.pathname.replace('/', '') || '0', 10),
    };
  } catch {
    return { host: 'localhost', port: 6379, db: 0 };
  }
}

interface PWTestResult {
  status: 'passed' | 'failed' | 'skipped' | 'timedOut' | 'interrupted';
  duration: number;
  error?: { message?: string };
}
interface PWTestRun { status: string; results: PWTestResult[] }
interface PWTestCase { title: string; tests: PWTestRun[] }
interface PWSuite { title: string; suites?: PWSuite[]; specs?: PWTestCase[] }
interface PWReport {
  suites: PWSuite[];
  stats: { expected: number; unexpected: number; skipped: number; duration: number };
}

function flattenTests(suite: PWSuite): PWTestCase[] {
  const out: PWTestCase[] = [];
  for (const s of suite.specs ?? []) out.push(s);
  for (const c of suite.suites ?? []) out.push(...flattenTests(c));
  return out;
}

async function emitJobUpdate(scriptJobId: string): Promise<void> {
  const job = await prisma.scriptJob.findUnique({
    where: { id: scriptJobId },
    include: {
      script: { select: { id: true, filename: true, verificationStatus: true, suspectedIssue: true } },
    },
  });
  if (!job) return;
  const testCase = await prisma.testCase.findUnique({
    where: { id: job.testCaseId },
    select: { id: true, tcId: true, title: true, type: true, useCaseTag: true },
  });
  emitToProject(job.projectId, 'script-job:update', { ...job, testCase });
}

interface RFTestEntry { name: string; status: 'PASS' | 'FAIL'; durationMs: number; errorMsg: string | null }
interface RFReport { _robotReport: true; tests: RFTestEntry[]; suiteStatus: 'PASS' | 'FAIL' }

interface SpawnResult {
  passed: boolean;
  errorMessage?: string;
  reportData?: PWReport;
}

async function runOnce(scriptPath: string, reportFile: string, envBaseUrl: string, envUsername: string, envPassword: string): Promise<SpawnResult> {
  const runnerUrl = process.env.RUNNER_URL ?? 'http://qa-runner:5001';
  const controller = new AbortController();
  const fetchTimeout = setTimeout(() => controller.abort(), 180_000); // 3 min — RF tests can be slow

  try {
    const response = await fetch(`${runnerUrl}/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        scriptPath,
        reportFile,
        browser: 'chromium',
        workers: 1,
        headless: true,
        baseUrl: envBaseUrl,
        username: envUsername,
        password: envPassword,
        environment: 'script-verify',
      }),
    });

    const text = await response.text();
    let exitCode = 1;
    let reportData: PWReport | RFReport | undefined;
    for (const raw of text.split('\n')) {
      const trimmed = raw.trim();
      if (!trimmed) continue;
      let msg: { type: string; exitCode?: number; reportData?: PWReport | RFReport | null };
      try { msg = JSON.parse(trimmed); } catch { continue; }
      if (msg.type === 'done') {
        exitCode = msg.exitCode ?? 1;
        reportData = msg.reportData ?? undefined;
      }
    }
    clearTimeout(fetchTimeout);

    if (reportData) {
      // ── Robot Framework report ──────────────────────────────────────────────
      if ((reportData as RFReport)._robotReport) {
        const rfReport = reportData as RFReport;
        const passed = exitCode === 0;
        if (passed) return { passed: true };
        const failedTest = (rfReport.tests ?? []).find((t) => t.status === 'FAIL');
        const errorMessage = failedTest?.errorMsg?.slice(0, 1500) ?? 'Robot test failed — check log.html';
        return { passed: false, errorMessage };
      }

      // ── Playwright report ───────────────────────────────────────────────────
      const pwReport = reportData as PWReport;
      const stats = pwReport.stats;
      const total = (stats?.expected ?? 0) + (stats?.unexpected ?? 0) + (stats?.skipped ?? 0);
      if (total === 0) {
        return { passed: false, errorMessage: 'No tests ran — possible import or syntax error.' };
      }
      const passed = (stats?.unexpected ?? 1) === 0;
      if (passed) return { passed: true, reportData: pwReport };

      const failingResult = (pwReport.suites ?? [])
        .flatMap(flattenTests)
        .flatMap((spec) => spec.tests ?? [])
        .flatMap((tr) => tr.results ?? [])
        .find((r) => r.status !== 'passed');
      const errorMessage = failingResult?.error?.message?.slice(0, 1000) ?? 'Test failed';
      return { passed: false, errorMessage, reportData: pwReport };
    }
    return {
      passed: exitCode === 0,
      errorMessage: exitCode === 0 ? undefined : 'Test failed — non-zero exit code',
    };
  } catch (err) {
    clearTimeout(fetchTimeout);
    const message = err instanceof Error ? err.message : String(err);
    return { passed: false, errorMessage: `Runner unavailable: ${message}` };
  }
}

// ── RF keyword extractor (same logic as scriptGenWorker) ──────────────────
function extractRobotKeywords(content: string): string[] {
  const keywords: string[] = [];
  let inKeywords = false;
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (trimmed.startsWith('*** Keywords ***')) { inKeywords = true; continue; }
    if (trimmed.startsWith('***')) { inKeywords = false; continue; }
    if (inKeywords && line.length > 0 && line[0] !== ' ' && line[0] !== '\t' && trimmed.length > 0 && !trimmed.startsWith('#')) {
      keywords.push(trimmed);
    }
  }
  return keywords;
}

// ── RF-specific heal: re-generate the script with the error as context ────
// For Robot Framework we do a full re-generation (not a diff-patch) because
// the error often reveals a fundamental selector or flow problem that requires
// understanding the whole test, not just the failing line.
async function healRobotScript(
  testCaseId: string,
  projectId: string,
  errorMessage: string,
): Promise<string | null> {
  const tc = await prisma.testCase.findFirst({
    where: { id: testCaseId, projectId },
    select: {
      id: true, tcId: true, title: true, description: true,
      steps: true, expectedResult: true, type: true, useCaseTag: true, generationHints: true,
    },
  });
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { id: true, slug: true, name: true, baseUrl: true, patternMemory: true },
  });
  if (!tc || !project) return null;

  const resourceFiles: ResourceFileInfo[] = (await listResourceFiles(project.slug)).map((f) => {
    let keywords: string[] = [];
    try { keywords = extractRobotKeywords(readResourceFile(project.slug, f.filename)); } catch { /* skip */ }
    return { filename: f.filename, keywords };
  });

  console.log(`[script-verify-worker] RF heal attempt for ${tc.tcId} — error: ${errorMessage.slice(0, 120)}`);

  const result = await runScriptAgent({
    testCase: {
      id: tc.id, tcId: tc.tcId, title: tc.title, description: tc.description,
      steps: tc.steps, expectedResult: tc.expectedResult, type: tc.type,
      useCaseTag: tc.useCaseTag, generationHints: tc.generationHints,
    },
    project: { id: project.id, slug: project.slug, name: project.name, baseUrl: project.baseUrl },
    existingPOMs: [],
    scriptMode: 'ROBOT',
    resourceFiles,
    patternMemory: project.patternMemory,
    failedStep: 'Previous run failed',
    failedStepError: errorMessage,
  });

  return result.specContent;
}

async function processVerifyJob(job: Job<ScriptVerifyJobPayload>): Promise<void> {
  const { scriptJobId, projectId, testCaseId, scriptId } = job.data;

  const scriptJob = await prisma.scriptJob.findUnique({ where: { id: scriptJobId } });
  if (!scriptJob) return;
  const maxAttempts = scriptJob.maxHealAttempts;

  const project = await prisma.project.findUnique({ where: { id: projectId }, select: { id: true, slug: true, name: true, baseUrl: true } });
  const script = await prisma.script.findUnique({ where: { id: scriptId } });
  if (!project || !script) {
    await prisma.scriptJob.update({
      where: { id: scriptJobId },
      data: { phase: 'FAILED', lastError: 'Project or script missing' },
    });
    await emitJobUpdate(scriptJobId);
    return;
  }

  const isRobot = script.filename.endsWith('.robot');

  // Resolve env (default EnvConfig, fall back to project.baseUrl + empty creds)
  const env = await prisma.envConfig.findFirst({
    where: { projectId, isDefault: true },
  });
  const envBaseUrl = env?.baseUrl ?? project.baseUrl ?? '';
  const envUsername = env?.username ?? '';
  const envPassword = env?.password ?? '';

  if (!envBaseUrl) {
    await prisma.script.update({
      where: { id: script.id },
      data: {
        verificationStatus: 'MANUAL_REVIEW',
        suspectedIssue: 'No base URL configured — cannot live-verify. Add a default EnvConfig in Project Settings.',
      },
    });
    await prisma.scriptJob.update({
      where: { id: scriptJobId },
      data: {
        phase: 'MANUAL_REVIEW',
        suspectedIssue: 'No base URL configured for verification.',
      },
    });
    await emitJobUpdate(scriptJobId);
    return;
  }

  const artifactsDir = path.join(ARTIFACTS_ROOT, project.slug, 'script-jobs', scriptJobId);
  try { fs.mkdirSync(artifactsDir, { recursive: true }); } catch { /* ignore */ }

  const scriptPath = path.join(SCRIPTS_ROOT, project.slug, 'scripts', script.filename);

  // ── Attempt 0: initial verify ────────────────────────────────────────────
  await prisma.scriptJob.update({
    where: { id: scriptJobId },
    data: { phase: 'VERIFYING' },
  });
  await emitJobUpdate(scriptJobId);

  let currentContent = script.content;
  let attempt = 0;
  let result = await runOnce(scriptPath, path.join(artifactsDir, `verify-0.json`), envBaseUrl, envUsername, envPassword);

  let lastHealType: string | undefined;
  let lastSuspected: string | undefined;

  while (!result.passed && attempt < maxAttempts) {
    attempt += 1;
    lastSuspected = result.errorMessage ?? 'Unknown failure';

    await prisma.scriptJob.update({
      where: { id: scriptJobId },
      data: {
        phase: 'HEALING',
        healAttempts: attempt,
        lastError: result.errorMessage ?? null,
      },
    });
    await emitJobUpdate(scriptJobId);

    try {
      if (isRobot) {
        // ── RF heal: full re-generation with error context ──────────────────
        lastHealType = 'RF_REGEN';
        const healed = await healRobotScript(
          testCaseId, projectId, result.errorMessage ?? 'Unknown error',
        );
        if (!healed) {
          lastSuspected = 'RF heal: could not retrieve test case context';
          break;
        }
        currentContent = healed;
        lastSuspected = `RF regen attempt ${attempt}: regenerated from error context`;
      } else {
        // ── Playwright heal: classify + patch ──────────────────────────────
        const cls = await runClassifier({
          errorMessage: result.errorMessage ?? 'Unknown error',
          scriptContent: currentContent,
        });
        lastHealType = cls.type;

        const patch = await runPatcher({
          type: cls.type,
          errorMessage: result.errorMessage ?? 'Unknown error',
          originalScript: currentContent,
          projectName: project.name,
          baseUrl: project.baseUrl,
          slug: project.slug,
        });

        currentContent = patch.patchedScript;
        lastSuspected = `${cls.type}: ${patch.explanation}`;
      }

      saveScript(project.slug, script.filename, currentContent, (script as any).useCaseFolder);
      await prisma.script.update({
        where: { id: script.id },
        data: { content: currentContent, updatedAt: new Date() },
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      lastSuspected = `Healing pipeline error: ${msg}`;
      break;
    }

    // Re-verify
    await prisma.scriptJob.update({
      where: { id: scriptJobId },
      data: { phase: 'VERIFYING' },
    });
    await emitJobUpdate(scriptJobId);

    result = await runOnce(
      scriptPath,
      path.join(artifactsDir, `verify-${attempt}.json`),
      envBaseUrl, envUsername, envPassword,
    );
  }

  if (result.passed) {
    await prisma.script.update({
      where: { id: script.id },
      data: { verificationStatus: 'VERIFIED', suspectedIssue: null },
    });
    await prisma.scriptJob.update({
      where: { id: scriptJobId },
      data: {
        phase: 'VERIFIED',
        healAttempts: attempt,
        lastError: null,
        suspectedIssue: null,
        healType: lastHealType ?? null,
      },
    });
  } else {
    const suspected = lastSuspected ?? result.errorMessage ?? 'Unknown failure';
    await prisma.script.update({
      where: { id: script.id },
      data: { verificationStatus: 'MANUAL_REVIEW', suspectedIssue: suspected },
    });
    await prisma.scriptJob.update({
      where: { id: scriptJobId },
      data: {
        phase: 'MANUAL_REVIEW',
        healAttempts: attempt,
        lastError: result.errorMessage ?? null,
        suspectedIssue: suspected,
        healType: lastHealType ?? null,
      },
    });
  }
  await emitJobUpdate(scriptJobId);
}

export function startScriptVerifyWorker(): void {
  const connection = parseRedisUrl(process.env.REDIS_URL ?? 'redis://localhost:6379');

  const worker = new Worker<ScriptVerifyJobPayload>('script-verify', processVerifyJob, {
    connection,
    concurrency: 1, // shares the runner with the run worker — keep low
  });

  worker.on('completed', (job) => {
    console.log(`[script-verify-worker] Job ${job.id} completed`);
  });
  worker.on('failed', (job, err) => {
    console.error(`[script-verify-worker] Job ${job?.id} failed:`, err.message);
  });

  console.log('[script-verify-worker] Worker started, listening on queue "script-verify"');
}
