import { Worker, type Job } from 'bullmq';
import fs from 'fs';
import path from 'path';
import { prisma } from '../lib/prisma.js';
import { emitToRun } from '../lib/socket.js';
import { addHealJob } from '../lib/queue.js';
import type { RunJobPayload } from '../lib/queue.js';

const ARTIFACTS_ROOT = process.env.ARTIFACTS_PATH ?? '/artifacts';

// ── Playwright JSON report shape ───────────────────────────────────────────
interface PWTestResult {
  status: 'passed' | 'failed' | 'skipped' | 'timedOut' | 'interrupted';
  duration: number;
  error?: { message?: string };
  attachments?: Array<{ name: string; path?: string }>;
}

interface PWTestCase {
  title: string;
  results: PWTestResult[];
}

interface PWSuite {
  title: string;
  suites?: PWSuite[];
  specs?: PWTestCase[];
}

interface PWReport {
  suites: PWSuite[];
  stats: {
    expected: number;
    unexpected: number;
    skipped: number;
    duration: number;
  };
}

function flattenTests(suite: PWSuite): PWTestCase[] {
  const tests: PWTestCase[] = [];
  for (const spec of suite.specs ?? []) {
    tests.push(spec);
  }
  for (const child of suite.suites ?? []) {
    tests.push(...flattenTests(child));
  }
  return tests;
}

// ── Main job processor ─────────────────────────────────────────────────────
async function processRunJob(job: Job<RunJobPayload>): Promise<void> {
  const { runId, projectId, testCaseIds, scriptPaths, environment, envBaseUrl,
    parallelWorkers, headless, browser } = job.data;

  const total = scriptPaths.length;
  const artifactsDir = path.join(ARTIFACTS_ROOT, projectId, runId);

  try {
    fs.mkdirSync(artifactsDir, { recursive: true });
  } catch { /* ignore */ }

  // ── 1. Mark run as RUNNING ───────────────────────────────────────────────
  await prisma.run.update({
    where: { id: runId },
    data: { status: 'RUNNING', startedAt: new Date() },
  });

  emitToRun(runId, 'run:start', { total, environment, parallelWorkers, browser, headless });
  emitLog(runId, 'info',
    `▶ Starting run · ${total} script${total !== 1 ? 's' : ''} · ${parallelWorkers} workers · ${browser}${headless ? ' headless' : ''}`
  );

  // ── 2. Check for cancellation ────────────────────────────────────────────
  const currentRun = await prisma.run.findUnique({ where: { id: runId }, select: { status: true } });
  if (currentRun?.status === 'CANCELLED') {
    emitLog(runId, 'warn', '■ Run cancelled before starting');
    emitToRun(runId, 'run:complete', { passed: 0, failed: 0, skipped: 0, duration: 0 });
    return;
  }

  // ── 3. Initialise RunResult records ─────────────────────────────────────
  for (const tcId of testCaseIds) {
    await prisma.runResult.create({
      data: { runId, testCaseId: tcId, status: 'PENDING' },
    });
  }

  // ── 4. Build a quick lookup: testCaseId → RunResult id ──────────────────
  const runResults = await prisma.runResult.findMany({
    where: { runId },
    select: { id: true, testCaseId: true },
  });
  const tcIdToRunResultId = new Map(runResults.map((r) => [r.testCaseId, r.id]));

  const startTime = Date.now();
  let totalPassed = 0;
  let totalFailed = 0;
  let totalSkipped = 0;

  // ── 5. Execute each script ───────────────────────────────────────────────
  for (let i = 0; i < scriptPaths.length; i++) {
    const scriptPath = scriptPaths[i];
    const testCaseId = testCaseIds[i];
    const scriptName = path.basename(scriptPath);
    const runResultId = tcIdToRunResultId.get(testCaseId);

    // Re-check cancellation before each script
    const runStatus = await prisma.run.findUnique({ where: { id: runId }, select: { status: true } });
    if (runStatus?.status === 'CANCELLED') {
      emitLog(runId, 'warn', `■ Run cancelled — skipping remaining ${scriptPaths.length - i} scripts`);
      break;
    }

    emitLog(runId, 'run', `→ [W${(i % parallelWorkers) + 1}] ${scriptName}`);

    if (runResultId) {
      await prisma.runResult.update({ where: { id: runResultId }, data: { status: 'RUNNING' } });
    }
    emitToRun(runId, 'run:progress', { testCaseId, status: 'RUNNING', index: i, total });

    const reportFile = path.join(artifactsDir, `report-${i}.json`);

    const result = await spawnPlaywright(
      scriptPath,
      reportFile,
      { parallelWorkers, headless, browser, envBaseUrl, environment },
      (line) => emitLog(runId, 'run', line),
    );

    // Parse report or use exit-code fallback
    let passed = false;
    let duration = 0;
    let errorMessage: string | undefined;
    let screenshotPath: string | undefined;

    if (result.reportData) {
      const tests = (result.reportData.suites ?? []).flatMap(flattenTests);
      const testResult = tests[0]?.results?.[0];
      passed = testResult?.status === 'passed';
      duration = Math.round(testResult?.duration ?? 0);
      if (!passed) {
        errorMessage = testResult?.error?.message?.slice(0, 500) ?? result.error ?? 'Test failed';
      }
      const screenshot = testResult?.attachments?.find((a) => a.name === 'screenshot');
      if (screenshot?.path) screenshotPath = screenshot.path;
    } else {
      passed = result.exitCode === 0;
      duration = result.durationMs;
      if (!passed) errorMessage = result.error ?? 'Test failed — non-zero exit code';
    }

    const finalStatus = passed ? 'PASSED' : 'FAILED';

    if (runResultId) {
      await prisma.runResult.update({
        where: { id: runResultId },
        data: { status: finalStatus, duration, errorMessage: errorMessage ?? null, screenshotPath: screenshotPath ?? null },
      });
    }

    if (passed) {
      totalPassed++;
      emitLog(runId, 'pass', `✓ ${scriptName} PASSED · ${(duration / 1000).toFixed(1)}s`);
    } else {
      totalFailed++;
      emitLog(runId, 'fail', `✗ ${scriptName} FAILED · ${errorMessage ?? 'Unknown error'}`);
    }

    emitToRun(runId, 'run:progress', {
      testCaseId, status: finalStatus, index: i, total,
      passed: totalPassed, failed: totalFailed,
    });
  }

  const elapsed = Date.now() - startTime;
  const runFinalStatus = totalFailed === 0 ? 'PASSED' : 'FAILED';

  // ── 5. Update run final status ───────────────────────────────────────────
  const existingRun = await prisma.run.findUnique({ where: { id: runId }, select: { status: true } });
  if (existingRun?.status !== 'CANCELLED') {
    await prisma.run.update({
      where: { id: runId },
      data: { status: runFinalStatus, completedAt: new Date() },
    });
  }

  emitLog(runId, 'info',
    `■ Run complete · ${totalPassed} passed · ${totalFailed} failed · ${(elapsed / 1000).toFixed(1)}s`
  );
  emitToRun(runId, 'run:complete', {
    passed: totalPassed, failed: totalFailed, skipped: totalSkipped, duration: elapsed,
  });

  // ── 6. Queue heal jobs for failures ─────────────────────────────────────
  if (totalFailed > 0) {
    const failedResults = await prisma.runResult.findMany({
      where: { runId, status: 'FAILED' },
      select: { id: true },
    });
    for (const r of failedResults) {
      try {
        await addHealJob({ runResultId: r.id, projectId });
      } catch { /* heal is best-effort */ }
    }
  }
}

// ── Helper: emit log line ────────────────────────────────────────────────────
function emitLog(runId: string, kind: 'info' | 'pass' | 'fail' | 'run' | 'warn', text: string): void {
  emitToRun(runId, 'run:log', { kind, text, ts: new Date().toISOString() });
}

// ── Helper: spawn playwright ─────────────────────────────────────────────────
interface SpawnResult {
  exitCode: number;
  error?: string;
  durationMs: number;
  reportData?: PWReport;
}

async function spawnPlaywright(
  scriptPath: string,
  reportFile: string,
  opts: { parallelWorkers: number; headless: boolean; browser: string; envBaseUrl: string; environment: string },
  onLine: (line: string) => void,
): Promise<SpawnResult> {
  const start = Date.now();
  const runnerUrl = process.env.RUNNER_URL ?? 'http://qa-runner:5001';

  try {
    const response = await fetch(`${runnerUrl}/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        scriptPath,
        reportFile,
        browser: opts.browser,
        workers: opts.parallelWorkers,
        headless: opts.headless,
        baseUrl: opts.envBaseUrl || '',
        environment: opts.environment,
      }),
    });

    // Read chunked NDJSON response line by line
    let exitCode = 1;
    let reportData: PWReport | undefined;
    const text = await response.text();

    for (const raw of text.split('\n')) {
      const trimmed = raw.trim();
      if (!trimmed) continue;
      let msg: { type: string; text?: string; exitCode?: number; reportData?: PWReport | null };
      try {
        msg = JSON.parse(trimmed);
      } catch {
        onLine(trimmed);
        continue;
      }
      if (msg.type === 'log' && msg.text) {
        onLine(msg.text);
      } else if (msg.type === 'done') {
        exitCode = msg.exitCode ?? 1;
        reportData = msg.reportData ?? undefined;
      }
    }

    const durationMs = Date.now() - start;
    return { exitCode, reportData, durationMs };
  } catch (err: unknown) {
    const durationMs = Date.now() - start;
    const message = err instanceof Error ? err.message : String(err);
    return { exitCode: 1, error: `Runner unavailable: ${message}`, durationMs };
  }
}

// ── Start worker ─────────────────────────────────────────────────────────────
export function startRunWorker(): void {
  const connection = (() => {
    try {
      const u = new URL(process.env.REDIS_URL ?? 'redis://localhost:6379');
      return {
        host: u.hostname || 'localhost',
        port: parseInt(u.port || '6379', 10),
        password: u.password || undefined,
        db: parseInt(u.pathname.replace('/', '') || '0', 10),
      };
    } catch {
      return { host: 'localhost', port: 6379, db: 0 };
    }
  })();

  const worker = new Worker('test-runs', processRunJob, {
    connection,
    concurrency: 3,
  });

  worker.on('completed', (job) => {
    console.log(`[run-worker] Job ${job.id} completed`);
  });

  worker.on('failed', (job, err) => {
    console.error(`[run-worker] Job ${job?.id} failed:`, err.message);
    if (job?.data.runId) {
      void prisma.run.update({
        where: { id: job.data.runId },
        data: { status: 'FAILED', completedAt: new Date() },
      });
      emitLog(job.data.runId, 'fail', `Worker error: ${err.message}`);
      emitToRun(job.data.runId, 'run:error', err.message);
    }
  });

  console.log('[run-worker] Worker started, listening on queue "test-runs"');
}
