import { Worker, type Job } from 'bullmq';
import fs from 'fs';
import path from 'path';
import { prisma } from '../lib/prisma.js';
import { emitToRun } from '../lib/socket.js';
import type { RunJobPayload } from '../lib/queue.js';
import { generateReport } from '../services/reportService.js';
import { isAgentEnabled } from '../lib/agentConfig.js';

const ARTIFACTS_ROOT = process.env.ARTIFACTS_PATH ?? '/artifacts';

// ── Playwright JSON report shape ───────────────────────────────────────────
interface PWTestResult {
  status: 'passed' | 'failed' | 'skipped' | 'timedOut' | 'interrupted';
  duration: number;
  error?: { message?: string };
  attachments?: Array<{ name: string; path?: string }>;
}

interface PWTestRun {
  status: string;
  results: PWTestResult[];
}

interface PWTestCase {
  title: string;
  tests: PWTestRun[];
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
  const { runId, runSeq, projectId, testCaseIds, scriptPaths, skippedTcIds = [],
    environment, envBaseUrl,
    envUsername = '', envPassword = '', parallelWorkers, headless, browser } = job.data;

  const total = scriptPaths.length;
  const runLabel = `RUN-${String(runSeq).padStart(4, '0')}`;
  const artifactsDir = path.join(ARTIFACTS_ROOT, projectId, `${runLabel}_${runId}`);

  try {
    fs.mkdirSync(artifactsDir, { recursive: true });
  } catch { /* ignore */ }

  // ── 1. Mark run as RUNNING ───────────────────────────────────────────────
  await prisma.run.update({
    where: { id: runId },
    data: { status: 'RUNNING', startedAt: new Date() },
  });

  emitToRun(runId, 'run:start', { total: total + skippedTcIds.length, environment, parallelWorkers, browser, headless: false });
  emitLog(runId, 'info',
    `▶ Starting run · ${total} script${total !== 1 ? 's' : ''}${skippedTcIds.length > 0 ? ` · ${skippedTcIds.length} skipped (no script)` : ''} · ${parallelWorkers} workers · ${browser} · headed`
  );

  // ── 2. Check for cancellation / already-terminal state ──────────────────
  // A stalled BullMQ job may be retried after a server restart. If the run is
  // already in a terminal state (CANCELLED by startup cleanup, or previously
  // completed), exit immediately so the heal loop doesn't restart.
  const currentRun = await prisma.run.findUnique({ where: { id: runId }, select: { status: true } });
  if (
    currentRun?.status === 'CANCELLED' ||
    currentRun?.status === 'PASSED' ||
    currentRun?.status === 'FAILED'
  ) {
    emitLog(runId, 'warn', `■ Run already in terminal state (${currentRun.status}) — skipping`);
    emitToRun(runId, 'run:complete', { passed: 0, failed: 0, skipped: 0, duration: 0 });
    return;
  }

  // ── 2b. Build readable TC id lookup (for artifact dir naming) ─────────────
  const allTcIds = [...testCaseIds, ...skippedTcIds];
  const tcRecords = await prisma.testCase.findMany({
    where: { id: { in: allTcIds } },
    select: { id: true, tcId: true },
  });
  const tcReadableId = new Map<string, string>(tcRecords.map((t) => [t.id, t.tcId]));

  // ── 3. Initialise RunResult records ─────────────────────────────────────
  // Delete any rows left from a previous (failed/retried) attempt so each execution
  // starts with exactly one row per test case.
  await prisma.runResult.deleteMany({ where: { runId } });

  // Fetch scripts up-front so RunResults are linked — healService requires scriptId
  const scriptRecords = await prisma.script.findMany({
    where: { testCaseId: { in: testCaseIds }, projectId },
    select: { id: true, testCaseId: true },
    orderBy: { updatedAt: 'desc' },
  });
  const tcIdToScriptId = new Map<string, string>();
  for (const s of scriptRecords) {
    if (s.testCaseId && !tcIdToScriptId.has(s.testCaseId)) {
      tcIdToScriptId.set(s.testCaseId, s.id);
    }
  }

  for (const tcId of testCaseIds) {
    await prisma.runResult.create({
      data: { runId, testCaseId: tcId, status: 'PENDING', scriptId: tcIdToScriptId.get(tcId) },
    });
  }

  // Create SKIPPED RunResults for TCs with no automation script
  if (skippedTcIds.length > 0) {
    for (const tcId of skippedTcIds) {
      await prisma.runResult.create({
        data: { runId, testCaseId: tcId, status: 'SKIPPED', errorMessage: 'No automation script — test case skipped' },
      });
      emitLog(runId, 'warn', `⊙ ${tcReadableId.get(tcId) ?? tcId} SKIPPED — no automation script`);
    }
  }

  // ── 4. Build a quick lookup: testCaseId → RunResult id ──────────────────
  const runResults = await prisma.runResult.findMany({
    where: { runId },
    select: { id: true, testCaseId: true },
  });
  const tcIdToRunResultId = new Map<string, string>(
    runResults.map((r: { testCaseId: string; id: string }) => [r.testCaseId, r.id] as [string, string]),
  );

  const startTime = Date.now();
  let totalPassed = 0;
  let totalFailed = 0;
  let totalSkipped = skippedTcIds.length;

  // One AbortController for the entire run. The cancel watcher below aborts it
  // the moment the DB status flips to CANCELLED, which propagates into the
  // active spawnPlaywright fetch — killing the runner child process via disconnect.
  const runAbortController = new AbortController();
  let userCancelled = false;

  // Poll every 2 s while scripts are executing — much cheaper than per-step checks
  const cancelWatcher = setInterval(async () => {
    if (userCancelled) { clearInterval(cancelWatcher); return; }
    try {
      const s = await prisma.run.findUnique({ where: { id: runId }, select: { status: true } });
      if (s?.status === 'CANCELLED') {
        userCancelled = true;
        runAbortController.abort();
        clearInterval(cancelWatcher);
      }
    } catch { /* DB hiccup — keep polling */ }
  }, 2000);

  // ── 5. Execute each script ───────────────────────────────────────────────
  for (let i = 0; i < scriptPaths.length; i++) {
    const scriptPath = scriptPaths[i];
    const testCaseId = testCaseIds[i];
    const scriptName = path.basename(scriptPath);
    const runResultId = tcIdToRunResultId.get(testCaseId);

    // Check for cancellation before starting each script
    if (runAbortController.signal.aborted) {
      emitLog(runId, 'warn', `■ Run cancelled — skipping remaining ${scriptPaths.length - i} scripts`);
      break;
    }

    emitLog(runId, 'run', `→ [W${(i % parallelWorkers) + 1}] ${scriptName}`);

    if (runResultId) {
      await prisma.runResult.update({ where: { id: runResultId }, data: { status: 'RUNNING' } });
    }
    emitToRun(runId, 'run:progress', { testCaseId, status: 'RUNNING', index: i, total });

    const tcLabel = tcReadableId.get(testCaseId) ?? `tc-${i}`;
    const reportFile = path.join(artifactsDir, `${runLabel}_${tcLabel}_report.json`);
    const outputDir = path.join(artifactsDir, `${runLabel}_${tcLabel}`);

    const result = await spawnPlaywright(
      scriptPath,
      reportFile,
      outputDir,
      { parallelWorkers, headless, browser, envBaseUrl, envUsername, envPassword, environment },
      (line) => emitLog(runId, 'run', line),
      runAbortController.signal,
    );

    // If the run was cancelled mid-script, mark result and stop
    if (runAbortController.signal.aborted) {
      if (runResultId) {
        await prisma.runResult.update({
          where: { id: runResultId },
          data: { status: 'FAILED', errorMessage: 'Run was cancelled' },
        });
      }
      emitLog(runId, 'warn', '■ Run cancelled during script execution');
      break;
    }

    // Parse report or use exit-code fallback
    let passed = false;
    let duration = 0;
    let errorMessage: string | undefined;
    let screenshotPath: string | undefined;
    let tracePath: string | undefined;
    let videoPath: string | undefined;

    if (result.reportData) {
      const stats = result.reportData.stats;
      const totalTests = (stats?.expected ?? 0) + (stats?.unexpected ?? 0) + (stats?.skipped ?? 0);
      duration = Math.round(stats?.duration ?? result.durationMs);

      if (totalTests === 0) {
        passed = false;
        errorMessage = 'No tests ran — possible import or syntax error in the script.';
      } else {
        passed = (stats?.unexpected ?? 1) === 0;

        // Flatten all test results to extract attachments
        const allPWResults = (result.reportData.suites ?? [])
          .flatMap(flattenTests)
          .flatMap((spec) => spec.tests ?? [])
          .flatMap((run) => run.results ?? []);

        // For failed tests use the failing result as the attachment source; otherwise first result
        const failingResult = allPWResults.find((r: PWTestResult) => r.status !== 'passed');
        if (!passed) {
          errorMessage = failingResult?.error?.message?.slice(0, 500) ?? result.error ?? 'Test failed';
        }
        const attachmentSource = failingResult ?? allPWResults[0];
        if (attachmentSource) {
          const shot = attachmentSource.attachments?.find((a: { name: string; path?: string }) => a.name === 'screenshot');
          if (shot?.path) screenshotPath = shot.path;
          const video = attachmentSource.attachments?.find((a: { name: string; path?: string }) => a.name === 'video');
          if (video?.path) videoPath = video.path;
          const trace = attachmentSource.attachments?.find((a: { name: string; path?: string }) => a.name === 'trace');
          if (trace?.path) tracePath = trace.path;
        }
      }
    } else {
      passed = result.exitCode === 0;
      duration = result.durationMs;
      if (!passed) errorMessage = result.error ?? 'Test failed — non-zero exit code';
    }

    const finalStatus = passed ? 'PASSED' : 'FAILED';

    if (runResultId) {
      await prisma.runResult.update({
        where: { id: runResultId },
        data: {
          status: finalStatus,
          duration,
          errorMessage: errorMessage ?? null,
          screenshotPath: screenshotPath ?? null,
          tracePath: tracePath ?? null,
          videoPath: videoPath ?? null,
        },
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

  // Stop the cancel watcher and abort any in-flight fetch
  clearInterval(cancelWatcher);
  runAbortController.abort();

  const elapsed = Date.now() - startTime;

  // If the run was cancelled by the user, just emit the stopped log and exit —
  // the cancel route already updated the DB status to CANCELLED.
  if (userCancelled) {
    emitLog(runId, 'warn', `■ Run stopped · ${totalPassed} passed · ${totalFailed} failed`);
    return;
  }

  const runFinalStatus = totalFailed === 0 ? 'PASSED' : 'FAILED';

  // ── 5. Update run final status ───────────────────────────────────────────
  await prisma.run.update({
    where: { id: runId },
    data: { status: runFinalStatus, completedAt: new Date() },
  });

  // ── 6. Log failures — healing is triggered manually from the Healing tab ──
  if (totalFailed > 0) {
    emitLog(runId, 'info',
      `⚡ ${totalFailed} failed test${totalFailed !== 1 ? 's' : ''} — visit the Healing tab to analyse and fix`,
    );
  }

  emitLog(runId, 'info',
    `■ Run complete · ${totalPassed} passed · ${totalFailed} failed · ${totalSkipped} skipped · ${(elapsed / 1000).toFixed(1)}s`
  );
  emitToRun(runId, 'run:complete', {
    passed: totalPassed, failed: totalFailed, skipped: totalSkipped, duration: elapsed,
  });

  // ── 7. Auto-generate report (best-effort, fire-and-forget after close) ───
  const reportsEnabled = await isAgentEnabled('reports-agent');
  if (reportsEnabled) {
    void generateReport(runId).catch((err) =>
      console.error('[run-worker] Auto-report generation failed:', err),
    );
  } else {
    console.log('[run-worker] Reports Agent is disabled — skipping AI report for run', runId);
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
  outputDir: string,
  opts: { parallelWorkers: number; headless: boolean; browser: string; envBaseUrl: string; envUsername: string; envPassword: string; environment: string },
  onLine: (line: string) => void,
  externalSignal?: AbortSignal,
): Promise<SpawnResult> {
  const start = Date.now();
  const runnerUrl = process.env.RUNNER_URL ?? 'http://qa-runner:5001';

  // Hard cap: 120 s (runner's 90 s kill timer + 30 s network/startup buffer)
  const controller = new AbortController();
  const fetchTimeout = setTimeout(() => controller.abort(), 120_000);

  // Forward external cancellation (e.g. user clicked Stop Run)
  if (externalSignal) {
    if (externalSignal.aborted) { controller.abort(); }
    else { externalSignal.addEventListener('abort', () => controller.abort(), { once: true }); }
  }

  try {
    const response = await fetch(`${runnerUrl}/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        scriptPath,
        reportFile,
        outputDir,
        browser: opts.browser,
        workers: opts.parallelWorkers,
        headless: opts.headless,
        baseUrl: opts.envBaseUrl || '',
        username: opts.envUsername || '',
        password: opts.envPassword || '',
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

    clearTimeout(fetchTimeout);
    const durationMs = Date.now() - start;
    return { exitCode, reportData, durationMs };
  } catch (err: unknown) {
    clearTimeout(fetchTimeout);
    const durationMs = Date.now() - start;
    const message = err instanceof Error ? err.message : String(err);
    const isAbort = err instanceof Error && err.name === 'AbortError';
    const isCancelled = isAbort && externalSignal?.aborted;
    return {
      exitCode: 1,
      error: isCancelled
        ? 'Cancelled'
        : isAbort
        ? 'Runner timed out after 120 s — script may be hanging'
        : `Runner unavailable: ${message}`,
      durationMs,
    };
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
