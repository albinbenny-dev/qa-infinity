import { Worker, type Job } from 'bullmq';
import fs from 'fs';
import path from 'path';
import { prisma } from '../lib/prisma.js';
import { emitToRun } from '../lib/socket.js';
import type { RunJobPayload } from '../lib/queue.js';
import { generateReport } from '../services/reportService.js';
import { isAgentEnabled } from '../lib/agentConfig.js';
import { updatePatternMemory } from '../services/patternExtractor.js';
import { recordLocatorSuccess, buildLocatorName } from '../services/locatorRepository.js';

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
  // Robot Framework report shape (from parseRobotXmlReport in runner/index.js)
  _robotReport?: true;
  suiteStatus?: 'PASS' | 'FAIL';
  tests?: Array<{ name: string; status: 'PASS' | 'FAIL'; durationMs: number; errorMsg: string | null; tags?: string[] }>;
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

// ── RF output.xml helpers ──────────────────────────────────────────────────

// Decode the five standard XML entities in attribute/text values.
function decodeXmlEntities(s: string): string {
  return s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'");
}

// Check whether an RF test case name belongs to a given QA Infinity TC ID.
//
// Handles all common naming conventions:
//   • "TC_19 - Edit Existing Roaming Partner Details"        → simple space separator
//   • "TC_19-Edit Existing Roaming Partner Details"          → simple dash separator
//   • "TC_13_TC_14_TC_20_TC_22 - Create Direct Roaming..."  → composite underscore names
//     TC_13 is the first  → startsWith('TC_13_')
//     TC_14 is the middle → includes('_TC_14_')
//     TC_22 is the last   → includes('_TC_22 ') or includes('_TC_22-')
//
// The underscore-delimited pattern ('TC_X_TC_Y_TC_Z - ...') is the convention
// where a single RF test case covers multiple QA Infinity TCs.  The plain
// startsWith('TC_ID ') check misses every TC except TC_PRM_001 style names
// because 'TC_13_TC_14... '.startsWith('TC_13 ') is false — it starts with 'TC_13_'.
function rfNameMatchesTcId(testName: string, tcId: string): boolean {
  return (
    testName === tcId ||
    testName.startsWith(tcId + ' ')  ||   // "TC_19 - Edit..."
    testName.startsWith(tcId + '-')  ||   // "TC_19-Edit..."
    testName.startsWith(tcId + '_')  ||   // "TC_13_TC_14_..." first in composite
    testName.includes('_' + tcId + '_') || // "..._TC_14_TC_20_..." middle in composite
    testName.includes('_' + tcId + ' ') || // "..._TC_22 - Create..." last before ' '
    testName.includes('_' + tcId + '-') || // "..._TC_22-Create..." last before '-'
    testName.endsWith('_' + tcId)          // "TC_16_TC_17_TC_18" last with no description suffix
  );
}

// Per-test result shape used by the tag-map extractor below.
interface RfTestResult {
  name: string;
  status: 'PASS' | 'FAIL';
  durationMs: number;
  errorMsg: string | null;
  tcTagCount: number; // number of TC_* tags (for dedup priority)
}

// extractRfTestErrors — reads output.xml and returns a map of
// testName → correct test-level error message (the LAST <status> in the block).
// The runner's built-in parser reads the FIRST <status>, which may be a
// keyword-level status rather than the test's own outcome.
function extractRfTestErrors(xmlPath: string): Map<string, string> {
  const result = new Map<string, string>();
  try {
    if (!fs.existsSync(xmlPath)) return result;
    const xml = fs.readFileSync(xmlPath, 'utf8');
    // Match each <test>…</test> block
    const testBlockRe = /<test\b[^>]*\bname="([^"]+)"[^>]*>([\s\S]*?)<\/test>/g;
    let tm: RegExpExecArray | null;
    while ((tm = testBlockRe.exec(xml)) !== null) {
      const testName = decodeXmlEntities(tm[1]);
      const block    = tm[2];
      // Find ALL status tags in the block and take the last one (test-level)
      const statusRe = /<status\b[^>]*\bstatus="(PASS|FAIL)"[^>]*>([^<]*)<\/status>|<status\b[^>]*\bstatus="(PASS|FAIL)"[^>]*\/>/g;
      let sm: RegExpExecArray | null;
      let lastMsg = '';
      while ((sm = statusRe.exec(block)) !== null) {
        // Group 2 is message text for non-self-closing tags
        const msg = sm[2]?.trim() ?? '';
        if (msg) lastMsg = msg;
      }
      if (lastMsg) {
        result.set(testName, decodeXmlEntities(lastMsg));
      }
    }
  } catch { /* non-fatal — fall back to runner-provided errorMsg */ }
  return result;
}

// extractRfTagResults — reads output.xml and returns a map of
//   TC_* tag → best test result for that tag
//
// This is the authoritative per-TC status source.  The runner serialises
// `rfTests` with tags through JSON, but tag extraction can fail silently
// (e.g. unexpected RF output.xml schema variants), leaving rfTests[i].tags
// empty.  Reading the XML directly here gives us the ground truth regardless
// of what the runner sent over the wire.
//
// "Best" = PASS if any tagged test passes; among failures, fewest TC-pattern
// tags (most focused test) wins — same preference as runWorker's inline logic.
function extractRfTagResults(xmlPath: string): Map<string, RfTestResult> {
  // tagBuckets: tag → all tests carrying that tag
  const tagBuckets = new Map<string, RfTestResult[]>();
  try {
    if (!fs.existsSync(xmlPath)) return new Map();
    const xml = fs.readFileSync(xmlPath, 'utf8');
    const testBlockRe = /<test\b[^>]*\bname="([^"]+)"[^>]*>([\s\S]*?)<\/test>/g;
    let tm: RegExpExecArray | null;
    while ((tm = testBlockRe.exec(xml)) !== null) {
      const testName = decodeXmlEntities(tm[1]);
      const body     = tm[2];

      // ── Extract tags (RF4-6: <tags><tag>…</tag></tags>; RF7: bare <tag> before first kw) ──
      let tags: string[] = [];
      const tagsWrapperMatch = body.match(/<tags>([\s\S]*?)<\/tags>/);
      if (tagsWrapperMatch) {
        tags = [...tagsWrapperMatch[1].matchAll(/<tag>([^<]*)<\/tag>/g)]
          .map((m) => m[1].trim());
      } else {
        // RF7: bare <tag> elements appear before the first keyword/status block
        const preambleEnd = body.search(/<(?:kw|setup|teardown|if|for|status)[\s>]/);
        const preamble = preambleEnd > 0 ? body.slice(0, preambleEnd) : body;
        tags = [...preamble.matchAll(/<tag>([^<]*)<\/tag>/g)].map((m) => m[1].trim());
      }

      // Only proceed when this test carries at least one TC_* tag
      const tcTags = tags.filter((t) => /^TC_\w+$/.test(t));
      if (tcTags.length === 0) continue;

      // ── Extract test-level status (LAST <status> in the body) ──
      const allStatuses = [...body.matchAll(/<status\s+status="(PASS|FAIL)"[^>]*/g)];
      const lastStatusMatch = allStatuses.length > 0 ? allStatuses[allStatuses.length - 1] : null;
      const status: 'PASS' | 'FAIL' = (lastStatusMatch?.[1] as 'PASS' | 'FAIL') ?? 'FAIL';

      // ── Extract duration from the last <status> element ──
      let durationMs = 0;
      if (lastStatusMatch) {
        const raw = lastStatusMatch[0];
        const startM = raw.match(/start(?:time)?="([^"]*)"/);
        const endM   = raw.match(/end(?:time)?="([^"]*)"/);
        const elapsedM = raw.match(/elapsed="([^"]*)"/);
        if (startM && endM) {
          try { durationMs = new Date(endM[1]).getTime() - new Date(startM[1]).getTime(); } catch { /* ignore */ }
        } else if (elapsedM) {
          durationMs = Math.round(parseFloat(elapsedM[1]) * 1000) || 0;
        }
      }

      // ── Extract error message for FAIL tests ──
      let errorMsg: string | null = null;
      if (status === 'FAIL') {
        const statusTextMatch = body.match(/<status\s+status="FAIL"[^>]*>([\s\S]*?)<\/status>/);
        if (statusTextMatch) {
          const txt = decodeXmlEntities(statusTextMatch[1]).replace(/<[^>]+>/g, '').trim();
          if (txt) errorMsg = txt;
        }
        if (!errorMsg) {
          const msgRe = /<msg[^>]*\blevel="FAIL"[^>]*>([\s\S]*?)<\/msg>/g;
          let mm: RegExpExecArray | null;
          let lastMsg: string | null = null;
          while ((mm = msgRe.exec(body)) !== null) lastMsg = mm[1];
          if (lastMsg) errorMsg = decodeXmlEntities(lastMsg).replace(/<[^>]+>/g, '').trim();
        }
        if (errorMsg && errorMsg.length > 600) errorMsg = errorMsg.slice(0, 600) + '…';
      }

      const entry: RfTestResult = { name: testName, status, durationMs, errorMsg, tcTagCount: tcTags.length };

      // Bucket this result under each TC_* tag it carries
      for (const tag of tcTags) {
        if (!tagBuckets.has(tag)) tagBuckets.set(tag, []);
        tagBuckets.get(tag)!.push(entry);
      }
    }
  } catch { /* non-fatal — caller falls back to runner-provided data */ }

  // Resolve each tag to its best result: prefer PASS; among equal-status candidates,
  // pick the test with fewest TC-pattern tags (most focused, least likely to be a
  // "mega" test that happened to carry this tag alongside 8 others).
  const result = new Map<string, RfTestResult>();
  for (const [tag, entries] of tagBuckets) {
    const passing = entries.filter((e) => e.status === 'PASS');
    const pool    = passing.length > 0 ? passing : entries;
    const best    = pool.reduce((a, b) => a.tcTagCount <= b.tcTagCount ? a : b);
    result.set(tag, best);
  }
  return result;
}

// ── Main job processor ─────────────────────────────────────────────────────
async function processRunJob(job: Job<RunJobPayload>): Promise<void> {
  const { runId, runSeq, projectId, testCaseIds, scriptPaths, skippedTcIds = [],
    mirroredTcIds = {},
    environment, envBaseUrl,
    envUsername = '', envPassword = '', parallelWorkers, headless, browser, hostBrowser = false } = job.data;

  const total = scriptPaths.length + Object.values(mirroredTcIds).reduce((s, a) => s + a.length, 0);
  const runLabel = `RUN-${String(runSeq).padStart(4, '0')}`;

  // Resolve project slug once — used for artifact dir naming and passed to the runner
  // so it can find project resources at /scripts/{slug}/resources/
  const projectRecord = await prisma.project.findUnique({
    where: { id: projectId },
    select: { slug: true },
  });
  const projectSlug = projectRecord?.slug ?? projectId;

  const artifactsDir = path.join(ARTIFACTS_ROOT, projectSlug, `${runLabel}_${runId}`);

  try {
    fs.mkdirSync(artifactsDir, { recursive: true });
  } catch { /* ignore */ }

  // ── 1. Resume detection: snapshot existing results before touching the run ─
  // Must happen before the guard so we preserve the checkpoint state even if
  // another instance tries to claim the same run concurrently.
  const existingResults = await prisma.runResult.findMany({
    where: { runId },
    select: { id: true, testCaseId: true, status: true },
  });
  const completedTcIds = new Set(
    existingResults.filter(r => r.status === 'PASSED' || r.status === 'FAILED').map(r => r.testCaseId),
  );
  const existingResultsByTcId = new Map(existingResults.map(r => [r.testCaseId, r.status]));
  const isResuming = completedTcIds.size > 0;

  // ── 2. Atomic guard: only claim runs that are still in a startable state ──
  // updateMany with a conditional where-clause means that if startup cleanup (or
  // a user cancel) already moved the run to a terminal state, guard.count === 0
  // and we bail without touching RunResults — preserving any completed TC work.
  const guard = await prisma.run.updateMany({
    where: { id: runId, status: { in: ['PENDING', 'RUNNING'] } },
    data: { status: 'RUNNING', startedAt: new Date() },
  });
  if (guard.count === 0) {
    const terminalRun = await prisma.run.findUnique({ where: { id: runId }, select: { status: true } });
    emitLog(runId, 'warn', `■ Run already in terminal state (${terminalRun?.status ?? 'unknown'}) — skipping`);
    emitToRun(runId, 'run:complete', { passed: 0, failed: 0, skipped: 0, duration: 0 });
    return;
  }

  const resumeSkipCount = testCaseIds.filter(id => completedTcIds.has(id)).length;
  emitToRun(runId, 'run:start', { total: total + skippedTcIds.length, environment, parallelWorkers, browser, headless: false });
  if (isResuming) {
    emitLog(runId, 'info',
      `↻ Resuming run · ${resumeSkipCount} TC(s) already completed · ${scriptPaths.length - resumeSkipCount} remaining · ${parallelWorkers} workers · ${browser} · headed`,
    );
  } else {
    emitLog(runId, 'info',
      `▶ Starting run · ${total} script${total !== 1 ? 's' : ''}${skippedTcIds.length > 0 ? ` · ${skippedTcIds.length} skipped (no script)` : ''} · ${parallelWorkers} workers · ${browser} · headed`,
    );
  }

  // ── 2b. Build readable TC id lookup (for artifact dir naming) ─────────────
  const allMirrorTcIds = Object.values(mirroredTcIds).flat();
  const allTcIds = [...testCaseIds, ...skippedTcIds, ...allMirrorTcIds];
  const tcRecords = await prisma.testCase.findMany({
    where: { id: { in: allTcIds } },
    select: { id: true, tcId: true },
  });
  const tcReadableId = new Map<string, string>(tcRecords.map((t) => [t.id, t.tcId]));

  // ── 3. Initialise RunResult records (resume-aware) ───────────────────────
  if (!isResuming) {
    // Fresh run — clear any stale orphans and create all RunResult rows from scratch
    await prisma.runResult.deleteMany({ where: { runId } });

    // Fetch scripts up-front so RunResults are linked — healService requires scriptId
    // Primary lookup: TC.linkedScriptId (the TC Library link, N TCs → 1 script)
    const tcIdToScriptId = new Map<string, string>();
    const linkedTcRecords = await prisma.testCase.findMany({
      where: { id: { in: testCaseIds }, linkedScriptId: { not: null } },
      select: { id: true, linkedScriptId: true },
    });
    for (const tc of linkedTcRecords) {
      if (tc.linkedScriptId) tcIdToScriptId.set(tc.id, tc.linkedScriptId);
    }
    // Fallback: Script.testCaseId ownership for TCs not covered above
    const unresolved = testCaseIds.filter(id => !tcIdToScriptId.has(id));
    if (unresolved.length > 0) {
      const scriptRecords = await prisma.script.findMany({
        where: { testCaseId: { in: unresolved }, projectId },
        select: { id: true, testCaseId: true },
        orderBy: { updatedAt: 'desc' },
      });
      for (const s of scriptRecords) {
        if (s.testCaseId && !tcIdToScriptId.has(s.testCaseId)) {
          tcIdToScriptId.set(s.testCaseId, s.id);
        }
      }
    }

    for (const tcId of testCaseIds) {
      await prisma.runResult.create({
        data: { runId, testCaseId: tcId, status: 'PENDING', scriptId: tcIdToScriptId.get(tcId) },
      });
    }

    // Create PENDING RunResults for mirror TCs (share same script as their representative)
    if (allMirrorTcIds.length > 0) {
      const mirrorTcRecords = await prisma.testCase.findMany({
        where: { id: { in: allMirrorTcIds } },
        select: { id: true, linkedScriptId: true },
      });
      const mirrorScriptId = new Map<string, string>();
      for (const m of mirrorTcRecords) { if (m.linkedScriptId) mirrorScriptId.set(m.id, m.linkedScriptId); }
      for (const tcId of allMirrorTcIds) {
        await prisma.runResult.create({
          data: { runId, testCaseId: tcId, status: 'PENDING', scriptId: mirrorScriptId.get(tcId) },
        });
      }
    }

    // Create SKIPPED RunResults for TCs with no automation script
    // Filter to only IDs that exist in the DB — stale frontend selections can reference deleted TCs
    const validSkippedTcIds = skippedTcIds.filter(id => tcReadableId.has(id));
    if (validSkippedTcIds.length > 0) {
      for (const tcId of validSkippedTcIds) {
        await prisma.runResult.create({
          data: { runId, testCaseId: tcId, status: 'SKIPPED', errorMessage: 'No automation script — test case skipped' },
        });
        emitLog(runId, 'warn', `⊙ ${tcReadableId.get(tcId) ?? tcId} SKIPPED — no automation script`);
      }
    }
  } else {
    // Resuming an interrupted run — reset any mid-flight RUNNING rows back to PENDING
    // (the runner process died while executing them; they need to re-run from scratch)
    const resetResult = await prisma.runResult.updateMany({
      where: { runId, status: 'RUNNING' },
      data: { status: 'PENDING' },
    });
    if (resetResult.count > 0) {
      emitLog(runId, 'info', `↺ Reset ${resetResult.count} mid-flight TC(s) to PENDING for re-execution`);
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
  // Seed counters from checkpoint — on fresh runs existingResults is empty so these are 0.
  let totalPassed = existingResults.filter(r => r.status === 'PASSED').length;
  let totalFailed = existingResults.filter(r => r.status === 'FAILED').length;
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

  // ── 5. Execute scripts — up to `parallelWorkers` running concurrently ────
  // Each lane pulls the next unclaimed index from a shared cursor, so N lanes
  // process the array concurrently instead of one script finishing before the
  // next starts. hostBrowser (visible/VNC) runs are forced to a single lane —
  // there are only 2 VNC slots total and a run's live view is one connection,
  // so parallel headed execution wouldn't be watchable or fit the slot budget.
  const cancelNotice = { beforeStart: false, midExec: false };

  async function runOneScript(i: number, laneNum: number): Promise<void> {
    const scriptPath = scriptPaths[i];
    const testCaseId = testCaseIds[i];
    const scriptName = path.basename(scriptPath);
    const runResultId = tcIdToRunResultId.get(testCaseId);

    // Check for cancellation before starting each script
    if (runAbortController.signal.aborted) {
      if (!cancelNotice.beforeStart) {
        cancelNotice.beforeStart = true;
        emitLog(runId, 'warn', '■ Run cancelled — skipping remaining scripts');
      }
      return;
    }

    // Skip TCs that already completed (PASSED or FAILED) in the interrupted execution
    if (completedTcIds.has(testCaseId)) {
      const prevStatus = existingResultsByTcId.get(testCaseId) ?? 'PASSED';
      emitToRun(runId, 'run:progress', { testCaseId, status: prevStatus, index: i, total });
      const mirrors = mirroredTcIds[testCaseId] ?? [];
      for (const mirrorTcId of mirrors) {
        emitToRun(runId, 'run:progress', {
          testCaseId: mirrorTcId,
          status: existingResultsByTcId.get(mirrorTcId) ?? prevStatus,
          index: i,
          total,
        });
      }
      return;
    }

    emitLog(runId, 'run', `→ [W${laneNum}] ${scriptName}`);

    if (runResultId) {
      await prisma.runResult.update({ where: { id: runResultId }, data: { status: 'RUNNING' } });
    }
    emitToRun(runId, 'run:progress', { testCaseId, status: 'RUNNING', index: i, total });

    const tcLabel = tcReadableId.get(testCaseId) ?? `tc-${i}`;
    const reportFile = path.join(artifactsDir, `${runLabel}_${tcLabel}_report.json`);
    const outputDir = path.join(artifactsDir, `${runLabel}_${tcLabel}`);

    // Backstop above spawnPlaywright's own internal 960s abort timer: that abort
    // signal has to interrupt an in-flight stream read to work, which isn't
    // guaranteed across all cases. If a script wedges and the internal abort
    // never unblocks it, this lane must move on regardless so the rest of the
    // run doesn't stall forever behind one hung test case.
    const LANE_HARD_TIMEOUT_MS = 1_020_000; // 17 min
    let laneTimeoutHandle: NodeJS.Timeout;
    const laneTimeout = new Promise<SpawnResult>((resolve) => {
      laneTimeoutHandle = setTimeout(() => resolve({
        exitCode: 1,
        error: 'Execution watchdog: script did not respond within the hard timeout — treated as failed so the run could continue.',
        durationMs: LANE_HARD_TIMEOUT_MS,
      }), LANE_HARD_TIMEOUT_MS);
    });

    const result = await Promise.race([
      spawnPlaywright(
        scriptPath,
        reportFile,
        outputDir,
        { parallelWorkers, headless, browser, hostBrowser, envBaseUrl, envUsername, envPassword, environment, projectSlug },
        (line) => {
          // ConsoleStepListener emits "[STEP] {depth} {text}" — route these with kind='step'
          // so the frontend can render and filter them separately from regular run output.
          const stepMatch = line.match(/^\[STEP\] (-?\d+) ([\s\S]*)$/);
          if (stepMatch) {
            emitLog(runId, 'step', stepMatch[2], parseInt(stepMatch[1], 10));
          } else {
            emitLog(runId, 'run', line);
          }
        },
        runAbortController.signal,
        hostBrowser ? (vncData) => emitToRun(runId, 'run:vnc', vncData) : undefined,
      ),
      laneTimeout,
    ]);
    clearTimeout(laneTimeoutHandle!);

    // If the run was cancelled mid-script, mark result and stop
    if (runAbortController.signal.aborted) {
      if (runResultId) {
        await prisma.runResult.update({
          where: { id: runResultId },
          data: { status: 'FAILED', errorMessage: 'Run was cancelled' },
        });
      }
      if (!cancelNotice.midExec) {
        cancelNotice.midExec = true;
        emitLog(runId, 'warn', '■ Run cancelled during script execution');
      }
      return;
    }

    // Parse report or use exit-code fallback
    let passed = false;
    let duration = 0;
    let errorMessage: string | undefined;
    let screenshotPath: string | undefined;
    let tracePath: string | undefined;
    let videoPath: string | undefined;
    let rfLogPath: string | undefined;
    let rfTestsForTagMatch: Array<{ name: string; status: 'PASS' | 'FAIL'; durationMs: number; errorMsg: string | null; tags?: string[] }> | undefined;
    // Hoisted so the mirror-TC fan-out below (outside the _robotReport block) can also
    // apply the XML-parsed error messages — the previous fix only covered primary TCs.
    let rfXmlErrors = new Map<string, string>();
    // Per-TC-tag best result parsed directly from output.xml — used as an authoritative
    // fallback when the runner-provided rfTests.tags array is empty or missing (which
    // causes the tag-based ownTest/mirrorTest matching below to silently return nothing,
    // making every TC in a multi-TC suite inherit the aggregate FAIL status even though
    // the individual test for that TC passed).
    let rfTagResults = new Map<string, RfTestResult>();

    if (result.reportData?._robotReport) {
      // ── Robot Framework report ──────────────────────────────────────────
      const rfReport = result.reportData;
      const rfTests = rfReport.tests ?? [];
      rfTestsForTagMatch = rfTests;
      duration = rfTests.reduce((sum, t) => sum + t.durationMs, 0) || result.durationMs;
      // Use reportData.failed count — RF can exit with code 0 even when tests fail
      const rfFailedCount = rfTests.filter((t) => t.status === 'FAIL').length;
      passed = rfTests.length > 0 ? rfFailedCount === 0 : result.exitCode === 0;
      // Parse output.xml directly for:
      //   (a) correct test-level error messages (runner may read keyword-level <status> instead of test-level)
      //   (b) authoritative per-TC-tag status — handles cases where runner serialises rfTests with empty tags
      const xmlPath = path.join(outputDir, 'output.xml');
      rfXmlErrors   = extractRfTestErrors(xmlPath);
      rfTagResults  = extractRfTagResults(xmlPath);
      if (!passed) {
        const failedTest = rfTests.find((t) => t.status === 'FAIL');
        const xmlMsg = failedTest ? rfXmlErrors.get(failedTest.name) : undefined;
        errorMessage = xmlMsg
          ?? failedTest?.errorMsg
          ?? result.errorSnippet
          ?? 'Robot test failed — check the run log for details.';
      }

      // Multi-TC suite scripts contain several *** Test Cases *** blocks, each
      // tagged with its own TC_ID. Prefer this TC's own tagged test result over
      // the whole-script aggregate above when a tag match exists — this makes a
      // TC that individually passed show PASSED even if a sibling test in the
      // same script failed (and vice versa), instead of every TC in the script
      // sharing one blanket pass/fail. Falls back to the aggregate when the
      // script doesn't tag tests this way (single-TC scripts, legacy scripts).
      const ownTcId = tcReadableId.get(testCaseId);
      // Multi-TC dedup: when the same TC tag appears on several RF tests (legacy [Tags] pattern),
      // prefer (1) name-match, (2) PASSING result, (3) fewest TC-pattern tags (most focused).
      // A plain rfTests.find() returns an arbitrary first match and can attribute a sibling TC's
      // failure to this TC (e.g. TC_PRM_006 PASS vs TC_50 FAIL → TC_51 must be PASS, not FAIL).
      let ownTest: typeof rfTests[0] | undefined;
      if (ownTcId) {
        const taggedTests = rfTests.filter((t) => t.tags?.includes(ownTcId));
        if (taggedTests.length > 0) {
          // Priority 1: RF test whose name directly identifies this TC
          ownTest = taggedTests.find((t) => rfNameMatchesTcId(t.name, ownTcId));
          // Priority 2 (legacy multi-tag scripts): prefer PASSING subset, then fewest TC-pattern tags.
          // Prevents a sibling TC's failure inside a broad test from being wrongly attributed here.
          if (!ownTest) {
            const countTcTags = (t: typeof rfTests[0]) =>
              (t.tags ?? []).filter((tag) => /^TC_\w+$/.test(tag)).length;
            const passingTagged = taggedTests.filter((t) => t.status === 'PASS');
            const pool = passingTagged.length > 0 ? passingTagged : taggedTests;
            ownTest = pool.reduce((best, t) =>
              countTcTags(t) < countTcTags(best) ? t : best,
            );
          }
        } else {
          // Fallback A: no tag match from runner — try name (covers legacy scripts without [Tags]
          // and composite-name scripts like "TC_13_TC_14_TC_20_TC_22 - Create..." where the
          // TC ID appears as the first, middle, or last segment of the underscore-delimited name).
          ownTest = rfTests.find((t) => rfNameMatchesTcId(t.name, ownTcId));
          // Fallback B: runner rfTests.tags may have been empty (serialisation failure).
          // Use the direct XML tag-result map as the authoritative source in that case.
          if (!ownTest) {
            const xmlTagResult = rfTagResults.get(ownTcId);
            if (xmlTagResult) {
              passed   = xmlTagResult.status === 'PASS';
              duration = xmlTagResult.durationMs || duration;
              const ownXmlMsg = rfXmlErrors.get(xmlTagResult.name);
              errorMessage = xmlTagResult.status === 'FAIL'
                ? (ownXmlMsg ?? xmlTagResult.errorMsg ?? errorMessage)
                : undefined;
            }
          }
        }
      }
      if (ownTest) {
        passed = ownTest.status === 'PASS';
        duration = ownTest.durationMs || duration;
        // Prefer the XML-parsed message for this specific test over the runner-provided one
        const ownXmlMsg = rfXmlErrors?.get(ownTest.name);
        errorMessage = ownTest.status === 'FAIL'
          ? (ownXmlMsg ?? ownTest.errorMsg ?? errorMessage)
          : undefined;
      }

      // Assets captured by the runner's post-run directory scan
      if (result.screenshotPath) screenshotPath = result.screenshotPath;
      if (result.videoPath) videoPath = result.videoPath;
      // RF HTML log written to the outputDir
      const rfLog_ = path.join(outputDir, 'log.html');
      if (fs.existsSync(rfLog_)) rfLogPath = rfLog_;
    } else if (result.reportData) {
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
        // Fallback: use runner-scanned paths when JSON report attachments are missing
        if (!screenshotPath && result.screenshotPath) screenshotPath = result.screenshotPath;
        if (!videoPath && result.videoPath) videoPath = result.videoPath;
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
          rfLogPath: rfLogPath ?? null,
        },
      });
    }

    if (passed) {
      totalPassed++;
      emitLog(runId, 'pass', `✓ ${scriptName} PASSED · ${(duration / 1000).toFixed(1)}s`);
      void extractAndLockLocators(testCaseId, scriptPath, projectId, runId).catch(() => {});
      void updatePatternMemory(projectId).catch(() => {});
    } else {
      totalFailed++;
      emitLog(runId, 'fail', `✗ ${scriptName} FAILED · ${errorMessage ?? 'Unknown error'}`);
    }

    // Fan-out result to any mirror TCs that share the same script. Each mirror
    // gets its own tag-matched test result when one exists (same preference as
    // the representative TC above), falling back to this script's aggregate
    // result when the script doesn't tag tests by TC_ID.
    const mirrors = mirroredTcIds[testCaseId] ?? [];
    for (const mirrorTcId of mirrors) {
      const mirrorRunResultId = tcIdToRunResultId.get(mirrorTcId);

      let mirrorStatus = finalStatus;
      let mirrorDuration = duration;
      let mirrorErrorMessage = errorMessage;
      const mirrorTcReadableId = tcReadableId.get(mirrorTcId);
      // Same prefer-PASS + fewest-TC-tags priority as the representative TC above.
      let mirrorTest: NonNullable<typeof rfTestsForTagMatch>[number] | undefined;
      let mirrorResolvedViaXml = false; // tracks if we already resolved via rfTagResults fallback
      if (mirrorTcReadableId && rfTestsForTagMatch) {
        const taggedMirror = rfTestsForTagMatch.filter((t) => t.tags?.includes(mirrorTcReadableId));
        if (taggedMirror.length > 0) {
          mirrorTest = taggedMirror.find((t) => rfNameMatchesTcId(t.name, mirrorTcReadableId));
          if (!mirrorTest) {
            const countMirrorTcTags = (t: NonNullable<typeof rfTestsForTagMatch>[number]) =>
              (t.tags ?? []).filter((tag: string) => /^TC_\w+$/.test(tag)).length;
            const passingMirror = taggedMirror.filter((t) => t.status === 'PASS');
            const mirrorPool = passingMirror.length > 0 ? passingMirror : taggedMirror;
            mirrorTest = mirrorPool.reduce((best, t) =>
              countMirrorTcTags(t) < countMirrorTcTags(best) ? t : best,
            );
          }
        } else {
          mirrorTest = rfTestsForTagMatch.find((t) => rfNameMatchesTcId(t.name, mirrorTcReadableId));
          // Fallback: runner-provided tags may be empty — check direct XML tag map
          if (!mirrorTest && mirrorTcReadableId) {
            const xmlTagResult = rfTagResults.get(mirrorTcReadableId);
            if (xmlTagResult) {
              mirrorResolvedViaXml = true;
              mirrorStatus = xmlTagResult.status === 'PASS' ? 'PASSED' : 'FAILED';
              mirrorDuration = xmlTagResult.durationMs || mirrorDuration;
              const mirrorXmlMsg = rfXmlErrors.get(xmlTagResult.name);
              mirrorErrorMessage = xmlTagResult.status === 'FAIL'
                ? (mirrorXmlMsg ?? xmlTagResult.errorMsg ?? mirrorErrorMessage)
                : undefined;
            }
          }
        }
      }
      if (mirrorTest && !mirrorResolvedViaXml) {
        mirrorStatus = mirrorTest.status === 'PASS' ? 'PASSED' : 'FAILED';
        mirrorDuration = mirrorTest.durationMs || mirrorDuration;
        // Apply the same XML-parsed error lookup as primary TCs — rfXmlErrors is
        // now hoisted so it's in scope here even though it's assigned inside the
        // _robotReport block above. Without this, mirror TCs get the runner-provided
        // errorMsg which may be a keyword-level message instead of the test-level one.
        const mirrorXmlMsg = rfXmlErrors.get(mirrorTest.name);
        mirrorErrorMessage = mirrorTest.status === 'FAIL'
          ? (mirrorXmlMsg ?? mirrorTest.errorMsg ?? mirrorErrorMessage)
          : undefined;
      }

      if (mirrorRunResultId) {
        await prisma.runResult.update({
          where: { id: mirrorRunResultId },
          data: { status: mirrorStatus, duration: mirrorDuration, errorMessage: mirrorErrorMessage ?? null,
                  screenshotPath: screenshotPath ?? null, tracePath: tracePath ?? null,
                  videoPath: videoPath ?? null, rfLogPath: rfLogPath ?? null },
        });
      }
      if (mirrorStatus === 'PASSED') totalPassed++; else totalFailed++;
      emitToRun(runId, 'run:progress', { testCaseId: mirrorTcId, status: mirrorStatus, index: i, total });
    }

    emitToRun(runId, 'run:progress', {
      testCaseId, status: finalStatus, index: i, total,
      passed: totalPassed, failed: totalFailed,
    });
  }

  const { stages } = job.data;

  if (stages && stages.length > 0) {
    // ── Stage-aware execution ────────────────────────────────────────────────
    // Rules:
    //  1. TCs inside every stage always run sequentially (one TC at a time).
    //  2. Each stage occupies exactly one worker lane for its entire duration.
    //  3. PARALLEL stage  — no dependency on other stages; starts as soon as a
    //                       worker slot is free.
    //  4. SEQUENTIAL stage — must wait for the previous SEQUENTIAL stage to
    //                        finish, then starts as soon as a worker slot is free.
    //                        If there is no prior sequential stage it behaves like
    //                        a parallel stage (no blocking dependency).
    //  5. Worker pool     — if all slots are busy a stage queues until one frees.
    //
    // Example (4 workers, PAR→SEQ→PAR): all 3 stages start at t=0 (slots free,
    // Stage 2 has no previous SEQ). With 2 workers the 3rd stage queues until
    // one of the first two finishes.
    //
    // Example (4 workers, SEQ→PAR→SEQ): Stage 1 + Stage 2 start at t=0.
    // Stage 3 (SEQ) waits for Stage 1 (the previous SEQ) to finish, then W1
    // picks it up even if Stage 2 (PAR) is still running.

    const tcIdToIdx = new Map<string, number>(testCaseIds.map((id, i) => [id, i]));
    const executedIdxs = new Set<number>();
    const effectiveWorkers = hostBrowser ? 1 : Math.max(1, parallelWorkers);

    // Worker-slot pool — slot numbers double as the [W1]..[WN] lane labels.
    const slotPool: number[] = Array.from({ length: effectiveWorkers }, (_, i) => i + 1);
    const slotWaiters: Array<(lane: number) => void> = [];

    const acquireSlot = (): Promise<number> => {
      if (slotPool.length > 0) return Promise.resolve(slotPool.shift()!);
      return new Promise(resolve => slotWaiters.push(resolve));
    };

    const releaseSlot = (lane: number): void => {
      if (slotWaiters.length > 0) {
        slotWaiters.shift()!(lane);
      } else {
        slotPool.push(lane);
      }
    };

    // Sequential-stage chain — each SEQ stage awaits this before starting.
    // Starts as an already-resolved promise (no predecessor).
    let prevSeqDone: Promise<void> = Promise.resolve();

    // Build one async task per stage. The prevSeqDone chain is wired
    // synchronously here (before any task actually runs) so ordering is correct.
    const stageTasks = stages.map(stage => {
      const idxs = stage.tcIds
        .map(tcId => tcIdToIdx.get(tcId))
        .filter((i): i is number => i !== undefined && !executedIdxs.has(i));

      if (stage.mode === 'sequential') {
        // Capture the current chain tail and advance it.
        const waitFor = prevSeqDone;
        let resolveStage!: () => void;
        prevSeqDone = new Promise<void>(resolve => { resolveStage = resolve; });

        return async (): Promise<void> => {
          emitLog(runId, 'info', `⏳ Stage [${stage.useCaseTag}] · sequential · ${idxs.length} runnable TCs · waiting for prev SEQ`);
          if (idxs.length === 0) { resolveStage(); return; }
          await waitFor;                          // block until previous SEQ done
          if (runAbortController.signal.aborted) { resolveStage(); return; }
          const lane = await acquireSlot();       // then wait for a free worker
          try {
            emitLog(runId, 'info', `▷ Stage [${stage.useCaseTag}] · sequential · ${idxs.length} test(s) · W${lane}`);
            for (const i of idxs) {
              if (runAbortController.signal.aborted) break;
              executedIdxs.add(i);
              await runOneScript(i, lane);
            }
          } finally {
            releaseSlot(lane);
            resolveStage();   // unblock the next SEQ stage (if any)
          }
        };
      } else {
        // PARALLEL — no SEQ dependency, just wait for a free worker slot.
        return async (): Promise<void> => {
          emitLog(runId, 'info', `⏳ Stage [${stage.useCaseTag}] · parallel · ${idxs.length} runnable TCs · waiting for slot`);
          if (idxs.length === 0) return;
          if (runAbortController.signal.aborted) return;
          const lane = await acquireSlot();
          try {
            emitLog(runId, 'info', `▷ Stage [${stage.useCaseTag}] · parallel · ${idxs.length} test(s) · W${lane}`);
            for (const i of idxs) {
              if (runAbortController.signal.aborted) break;
              executedIdxs.add(i);
              await runOneScript(i, lane);
            }
          } finally {
            releaseSlot(lane);
          }
        };
      }
    });

    // Launch all stage tasks concurrently — each manages its own timing via
    // the slot pool and the sequential-chain promise.
    await Promise.all(stageTasks.map(task => task()));
  } else {
    // Flat cursor execution for non-suite runs (schedules, manual, individual, etc.)
    const laneCount = Math.max(1, Math.min(hostBrowser ? 1 : (parallelWorkers || 1), scriptPaths.length || 1));
    let nextIndex = 0;
    const workerLane = async (laneNum: number): Promise<void> => {
      while (true) {
        if (runAbortController.signal.aborted) return;
        const i = nextIndex++;
        if (i >= scriptPaths.length) return;
        await runOneScript(i, laneNum);
      }
    };
    await Promise.all(Array.from({ length: laneCount }, (_, idx) => workerLane(idx + 1)));
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

// ── Helper: extract verified locators from a passing script and lock them ────
// Parses css=, text=, xpath= and nth= patterns from the script content, then
// merges them into testCase.generationHints so the next generation skips the
// guessing phase and starts with proven selectors.
async function extractAndLockLocators(
  testCaseId: string,
  scriptPath: string,
  projectId: string,
  runId: string,
): Promise<void> {
  let scriptContent: string;
  try {
    scriptContent = fs.readFileSync(scriptPath, 'utf-8');
  } catch {
    return;
  }

  // Extract all locator strings assigned to variables or passed to RF Browser keywords.
  // Previously this only matched css=/text=/xpath= — missing id= and role=, which are
  // tiers 1 and 4 of the system prompt's own locator priority order and thus extremely
  // common in generated scripts. Any passing script whose corrected locator happened to
  // use id= or role= silently never made it into generationHints OR the Locator
  // Repository, so the fix could pass a real run and still never get "learned."
  // The (?:[^\s'"]|"[^"]*"|'[^']*')+ body (rather than a plain [^\s'"}{]+ class) matters
  // just as much here: role=row[name="..."] and css=[attr='...'] both contain quotes
  // (often with internal spaces) and would otherwise be truncated at the first one,
  // silently corrupting exactly the two most-recommended locator strategies.
  const locatorPattern = /(?:css=|id=|role=|text=|xpath=)(?:[^\s'"]|"[^"]*"|'[^']*')+(?:\s*>>\s*(?:nth=\d+|text="[^"]+"))?/g;
  const matches = scriptContent.match(locatorPattern) ?? [];
  const unique = [...new Set(matches)].filter(
    (l) => !l.includes('${') && l.length > 5,
  );

  if (unique.length === 0) return;

  const tc = await prisma.testCase.findUnique({
    where: { id: testCaseId },
    select: { generationHints: true, useCaseTag: true },
  });
  if (!tc) return;

  let hints: Record<string, unknown> = {};
  try {
    hints = tc.generationHints ? JSON.parse(tc.generationHints as string) : {};
  } catch { /* start fresh */ }

  // Merge new verified locators — existing locked ones are preserved
  const existing: string[] = Array.isArray(hints.verifiedLocators) ? hints.verifiedLocators as string[] : [];
  const merged = [...new Set([...existing, ...unique])];
  hints.verifiedLocators = merged;
  hints.lastPassedAt = new Date().toISOString();

  await prisma.testCase.update({
    where: { id: testCaseId },
    data: { generationHints: JSON.stringify(hints) },
  });

  // Feed the same passing-run evidence into the Object/Locator Repository so
  // future generations select these selectors by name instead of re-guessing.
  await Promise.all(
    unique.map((selector) =>
      recordLocatorSuccess({
        projectId,
        name: buildLocatorName(tc.useCaseTag, selector),
        page: tc.useCaseTag,
        selector,
        runId,
      }).catch((err) => console.error(`[run-worker] recordLocatorSuccess failed for "${selector}" (TC ${testCaseId}):`, err)),
    ),
  );
}

// ── Helper: emit log line ────────────────────────────────────────────────────
// `depth` is only meaningful for kind='step' (populated by ConsoleStepListener):
//   -1 = test lifecycle event (start / end)
//    0 = top-level user keyword (the test step as written)
//   1+ = nested library-internal keyword
function emitLog(runId: string, kind: 'info' | 'pass' | 'fail' | 'run' | 'warn' | 'step', text: string, depth?: number): void {
  const payload: Record<string, unknown> = { kind, text, ts: new Date().toISOString() };
  if (depth !== undefined) payload.depth = depth;
  emitToRun(runId, 'run:log', payload);
}

// ── Helper: spawn playwright ─────────────────────────────────────────────────
interface SpawnResult {
  exitCode: number;
  error?: string;
  durationMs: number;
  reportData?: PWReport;
  screenshotPath?: string;
  videoPath?: string;
  videoPaths?: string[];
  errorSnippet?: string;
}

async function spawnPlaywright(
  scriptPath: string,
  reportFile: string,
  outputDir: string,
  opts: { parallelWorkers: number; headless: boolean; browser: string; hostBrowser?: boolean; envBaseUrl: string; envUsername: string; envPassword: string; environment: string; projectSlug?: string },
  onLine: (line: string) => void,
  externalSignal?: AbortSignal,
  onVnc?: (data: { token?: string; busy?: boolean }) => void,
): Promise<SpawnResult> {
  const start = Date.now();
  // hostBrowser tests must land on the primary runner (the one with VNC exposed on
  // port 6080). Headless tests can go to any runner via the load balancer.
  const lbUrl      = process.env.RUNNER_URL          ?? 'http://qa-runner:5001';
  const primaryUrl = process.env.RUNNER_PRIMARY_URL  ?? 'http://qa-runner:5001';
  const runnerUrl  = opts.hostBrowser ? primaryUrl : lbUrl;

  // Hard cap: runner HARD_KILL_MS (900 s) + 60 s cleanup buffer
  const controller = new AbortController();
  const fetchTimeout = setTimeout(() => controller.abort(), 960_000);

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
        hostBrowser: opts.hostBrowser ?? false,
        baseUrl: opts.envBaseUrl || '',
        username: opts.envUsername || '',
        password: opts.envPassword || '',
        environment: opts.environment,
        projectSlug: opts.projectSlug || '',
        recordVideo: false, // video recording disabled — re-enable when feature is ready
      }),
    });

    // Stream chunked NDJSON line by line — do NOT buffer with response.text()
    // because that blocks live log delivery and prevents abort from closing the
    // runner connection mid-test (abort signal cannot interrupt a buffered read).
    let exitCode = 1;
    let reportData: PWReport | undefined;
    let rfScreenshotPath: string | undefined;
    let rfVideoPath: string | undefined;
    let rfVideoPaths: string[] | undefined;
    let rfErrorSnippet: string | undefined;

    const processLine = (raw: string) => {
      const trimmed = raw.trim();
      if (!trimmed) return;
      let msg: { type: string; text?: string; exitCode?: number; reportData?: PWReport | null; screenshotPath?: string | null; videoPath?: string | null; videoPaths?: string[] | null; errorSnippet?: string | null };
      try {
        msg = JSON.parse(trimmed);
      } catch {
        onLine(trimmed);
        return;
      }
      if (msg.type === 'heartbeat') {
        return; // keepalive — prevents TCP idle timeout on long-running tests
      } else if (msg.type === 'log' && msg.text) {
        onLine(msg.text);
      } else if (msg.type === 'vnc-session') {
        onVnc?.({ token: msg.token as string });
      } else if (msg.type === 'vnc-busy') {
        onVnc?.({ busy: true });
      } else if (msg.type === 'done') {
        exitCode = msg.exitCode ?? 1;
        reportData = msg.reportData ?? undefined;
        if (msg.screenshotPath) rfScreenshotPath = msg.screenshotPath;
        if (msg.videoPaths && Array.isArray(msg.videoPaths) && msg.videoPaths.length > 0) {
          rfVideoPaths = msg.videoPaths;
          rfVideoPath = msg.videoPaths.length === 1 ? msg.videoPaths[0] : JSON.stringify(msg.videoPaths);
        } else if (msg.videoPath) {
          rfVideoPath = msg.videoPath;
        }
        if (msg.errorSnippet) rfErrorSnippet = msg.errorSnippet;
      }
    };

    if (response.body) {
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let lineBuffer = '';
      try {
        while (true) {
          if (controller.signal.aborted) { reader.cancel(); break; }
          const { done, value } = await reader.read();
          if (done) break;
          lineBuffer += decoder.decode(value, { stream: true });
          const lines = lineBuffer.split('\n');
          lineBuffer = lines.pop() ?? '';
          for (const line of lines) processLine(line);
        }
        if (lineBuffer) processLine(lineBuffer);
      } finally {
        reader.releaseLock();
      }
    } else {
      // Fallback for environments where body is not a ReadableStream
      const text = await response.text();
      for (const raw of text.split('\n')) processLine(raw);
    }

    clearTimeout(fetchTimeout);
    const durationMs = Date.now() - start;
    return { exitCode, reportData, durationMs, screenshotPath: rfScreenshotPath, videoPath: rfVideoPath, videoPaths: rfVideoPaths, errorSnippet: rfErrorSnippet };
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
    concurrency: 6, // 2 runner replicas × 3 slots each — each slot gets a unique rfbrowser-node port
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
