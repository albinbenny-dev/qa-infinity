import fs from 'fs/promises';
import path from 'path';
import { prisma } from '../lib/prisma.js';
import { runReportsAgent } from '../agents/reportsAgent.js';
import { sendRunReport } from './emailService.js';

// ── Email config storage ───────────────────────────────────────────────────

const DATA_DIR = process.env.DATA_DIR ?? '/data';

export interface EmailConfig {
  recipients: string[];
  triggerEvents: string[]; // 'on_failure' | 'on_completion' | 'on_schedule'
}

async function configPath(projectId: string): Promise<string> {
  return path.join(DATA_DIR, `report-config-${projectId}.json`);
}

export async function getEmailConfig(projectId: string): Promise<EmailConfig> {
  try {
    const raw = await fs.readFile(await configPath(projectId), 'utf-8');
    return JSON.parse(raw) as EmailConfig;
  } catch {
    return { recipients: [], triggerEvents: ['on_failure'] };
  }
}

export async function saveEmailConfig(projectId: string, config: EmailConfig): Promise<void> {
  try {
    await fs.mkdir(DATA_DIR, { recursive: true });
    await fs.writeFile(await configPath(projectId), JSON.stringify(config, null, 2), 'utf-8');
  } catch (err) {
    console.error('[reportService] Failed to save email config:', err);
    throw err;
  }
}

// ── Types ──────────────────────────────────────────────────────────────────

export interface ProjectStats {
  // Coverage & Readiness
  totalTests: number;
  automatedCount: number;
  coveragePct: number;
  useCaseCount: number;
  coveredUseCaseCount: number;   // use cases with ≥1 automated TC
  useCaseCoveragePct: number;
  automationDepth: number;       // avg automated TCs per use case

  // Quality & Stability
  overallPassRatePct: number;    // all-time pass rate across recent 30 runs
  flakyTestCount: number;
  flakyPct: number;              // flaky / automatedCount
  failureRecurrenceRate: number; // % of ever-tested TCs that failed in ≥2 runs
  neverRunCount: number;
  neverRunPct: number;

  // Execution Velocity
  runsPerWeek: number;
  avgRunDurationSec: number;
  avgTcsPerRun: number;
  scheduledRunCount: number;     // last 30 runs
  manualRunCount: number;        // last 30 runs

  // AI & Productivity
  aiGeneratedScripts: number;   // scripts with testCaseId (agent-generated)
  manualScripts: number;        // scripts without testCaseId
  aiVsManualRatio: number;      // aiGeneratedScripts / max(manualScripts,1)
  scriptPassRate: number;       // verified scripts / total scripts %
  tokensPerScript: number;      // projectTokens / max(scriptsGenerated,1)

  // Legacy (kept for existing tiles)
  scriptsGenerated: number;
  totalRuns: number;
  lastRunPassCount: number;
  lastRunFailCount: number;
  avgPassRate: number;
  activeSchedules: number;
  pendingHeals: number;
  flakyTests: FlakyTest[];
}

export interface FlakyTest {
  id: string;
  tcId: string;
  title: string;
  passCount: number;
  failCount: number;
  recentResults: Array<'PASSED' | 'FAILED' | 'SKIPPED'>;
}

export interface RunTrendPoint {
  date: string;
  passed: number;
  failed: number;
  skipped: number;
}

export interface AgentStatus {
  name: string;
  label: string;
  status: 'ok' | 'busy' | 'idle';
  detail: string;
}

// ── generateReport ─────────────────────────────────────────────────────────

export async function generateReport(runId: string): Promise<void> {
  const run = await prisma.run.findUnique({
    where: { id: runId },
    include: {
      results: {
        include: {
          testCase: { select: { id: true, tcId: true, title: true, type: true } },
        },
      },
      project: { select: { id: true, name: true } },
    },
  });

  if (!run) throw new Error(`Run ${runId} not found`);

  // Skip if report already exists
  const existing = await prisma.report.findUnique({ where: { runId } });
  if (existing) return;

  type ResultRow = { status: string; errorMessage: string | null; testCase: { title: string } };
  const results = run.results as ResultRow[];
  const passed = results.filter((r) => r.status === 'PASSED').length;
  const failed = results.filter((r) => r.status === 'FAILED').length;
  const total = results.length;
  const duration =
    run.startedAt && run.completedAt
      ? new Date(run.completedAt).getTime() - new Date(run.startedAt).getTime()
      : 0;

  const failedTests = results
    .filter((r) => r.status === 'FAILED')
    .map((r) => ({
      title: r.testCase.title,
      error: r.errorMessage ?? 'Unknown error',
    }));

  const analysis = await runReportsAgent({
    runSummary: { total, passed, failed, duration },
    failedTests,
  });

  const report = await prisma.report.upsert({
    where: { runId },
    create: {
      projectId: run.projectId,
      runId,
      summary: analysis.summary,
      aiAnalysis: JSON.stringify(analysis),
    },
    update: {
      summary: analysis.summary,
      aiAnalysis: JSON.stringify(analysis),
    },
  });

  // Send email if configured
  const emailConfig = await getEmailConfig(run.projectId);
  const shouldEmail =
    emailConfig.recipients.length > 0 &&
    (emailConfig.triggerEvents.includes('on_completion') ||
      (emailConfig.triggerEvents.includes('on_failure') && failed > 0));

  if (shouldEmail) {
    try {
      await sendRunReport({
        recipients: emailConfig.recipients,
        run,
        results: run.results,
        analysis,
        projectName: run.project.name,
      });
      await prisma.report.update({
        where: { id: report.id },
        data: { emailSentAt: new Date() },
      });
    } catch (err) {
      console.error('[reportService] Email send failed:', err);
    }
  }
}

// ── getProjectStats ────────────────────────────────────────────────────────

export async function getProjectStats(projectId: string): Promise<ProjectStats> {
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  // ── Parallel batch 1: counts & raw data ───────────────────────────────────
  const [
    totalTests,
    automatedCount,
    neverRunCount,
    scriptsGenerated,
    aiGeneratedScripts,
    verifiedScripts,
    totalRuns,
    activeSchedules,
    pendingHeals,
    lastRun,
    allResults,
    recentRuns,
    runsLastWeek,
    allTCsWithUseCase,
  ] = await Promise.all([
    prisma.testCase.count({ where: { projectId } }),
    // TCs with agent script OR manual linkedScriptId
    prisma.testCase.count({
      where: {
        projectId,
        OR: [{ linkedScriptId: { not: null } }, { scripts: { some: {} } }],
      },
    }),
    prisma.testCase.count({ where: { projectId, runResults: { none: {} } } }),
    prisma.script.count({ where: { projectId } }),
    // Agent-generated scripts (have a testCaseId)
    prisma.script.count({ where: { projectId, testCaseId: { not: null } } }),
    // Scripts that have been verified (passed a real run)
    prisma.script.count({ where: { projectId, verificationStatus: 'VERIFIED' } }),
    prisma.run.count({ where: { projectId } }),
    prisma.schedule.count({ where: { projectId, isActive: true } }),
    prisma.heal.count({ where: { projectId, status: 'PENDING' } }),
    prisma.run.findFirst({
      where: { projectId, status: { in: ['PASSED', 'FAILED', 'RUNNING', 'CANCELLED'] } },
      orderBy: { createdAt: 'desc' },
      include: { results: { select: { status: true } } },
    }),
    // All results for flakiness & recurrence analysis (last 5000)
    prisma.runResult.findMany({
      where: { run: { projectId }, status: { in: ['PASSED', 'FAILED'] } },
      select: { testCaseId: true, status: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
      take: 5000,
    }),
    // Last 30 completed runs for velocity & pass rate
    prisma.run.findMany({
      where: { projectId, status: { in: ['PASSED', 'FAILED', 'CANCELLED'] } },
      orderBy: { createdAt: 'desc' },
      take: 30,
      select: {
        triggerType: true,
        startedAt: true,
        completedAt: true,
        results: { select: { status: true } },
      },
    }),
    // Runs in last 7 days for runs-per-week
    prisma.run.count({
      where: { projectId, createdAt: { gte: sevenDaysAgo } },
    }),
    // All TCs with use case tags + whether they are automated
    prisma.testCase.findMany({
      where: { projectId, useCaseTag: { not: null } },
      select: {
        useCaseTag: true,
        linkedScriptId: true,
        scripts: { select: { id: true }, take: 1 },
      },
    }),
  ]);

  // ── Last-run pass / fail ───────────────────────────────────────────────────
  type StatusRow = { status: string };
  const lastRunPassCount = lastRun
    ? (lastRun.results as StatusRow[]).filter((r) => r.status === 'PASSED').length
    : 0;
  const lastRunFailCount = lastRun
    ? (lastRun.results as StatusRow[]).filter((r) => r.status === 'FAILED').length
    : 0;

  // ── Overall pass rate & execution velocity (last 30 runs) ─────────────────
  type RecentRun = {
    triggerType: string;
    startedAt: Date | null;
    completedAt: Date | null;
    results: StatusRow[];
  };
  let avgPassRate = 0;
  let overallPassRatePct = 0;
  let avgRunDurationSec = 0;
  let avgTcsPerRun = 0;
  let scheduledRunCount = 0;
  let manualRunCount = 0;

  if (recentRuns.length > 0) {
    const runs = recentRuns as RecentRun[];
    const rates = runs.map((r) => {
      const t = r.results.length;
      const p = r.results.filter((x) => x.status === 'PASSED').length;
      return t > 0 ? (p / t) * 100 : 0;
    });
    avgPassRate = Math.round(rates.reduce((a, b) => a + b, 0) / runs.length);
    overallPassRatePct = avgPassRate;

    // Avg duration
    const durations = runs
      .filter((r) => r.startedAt && r.completedAt)
      .map((r) => (r.completedAt!.getTime() - r.startedAt!.getTime()) / 1000);
    avgRunDurationSec = durations.length > 0
      ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length)
      : 0;

    // Avg TCs per run
    const tcCounts = runs.map((r) => r.results.length);
    avgTcsPerRun = Math.round(tcCounts.reduce((a, b) => a + b, 0) / runs.length);

    // Scheduled vs manual
    scheduledRunCount = runs.filter((r) => r.triggerType === 'SCHEDULED').length;
    manualRunCount = runs.filter((r) => r.triggerType === 'MANUAL').length;
  }

  // ── Flaky test analysis ───────────────────────────────────────────────────
  const byTc = new Map<string, { passed: number; failed: number; runIds: Set<string>; results: string[] }>();
  for (const r of allResults) {
    let entry = byTc.get(r.testCaseId);
    if (!entry) {
      entry = { passed: 0, failed: 0, runIds: new Set(), results: [] };
      byTc.set(r.testCaseId, entry);
    }
    if (entry.results.length < 10) {
      entry.results.push(r.status);
      if (r.status === 'PASSED') entry.passed++;
      else entry.failed++;
    }
  }

  const flakyTcIds = [...byTc.entries()]
    .filter(([, v]) => v.passed > 0 && v.failed > 0)
    .map(([id]) => id);

  // Failure recurrence: TCs that have FAILED in ≥2 distinct result rows
  const failCounts = new Map<string, number>();
  for (const r of allResults) {
    if (r.status === 'FAILED') failCounts.set(r.testCaseId, (failCounts.get(r.testCaseId) ?? 0) + 1);
  }
  const recurrentFailTcs = [...failCounts.entries()].filter(([, c]) => c >= 2).length;
  const totalTestedTcs = byTc.size;
  const failureRecurrenceRate = totalTestedTcs > 0
    ? Math.round((recurrentFailTcs / totalTestedTcs) * 100)
    : 0;

  let flakyTests: FlakyTest[] = [];
  if (flakyTcIds.length > 0) {
    const tcs = await prisma.testCase.findMany({
      where: { id: { in: flakyTcIds.slice(0, 20) }, projectId },
      select: { id: true, tcId: true, title: true },
    });
    type TcRow = { id: string; tcId: string; title: string };
    flakyTests = (tcs as TcRow[]).map((tc) => {
      const data = byTc.get(tc.id)!;
      return {
        id: tc.id,
        tcId: tc.tcId,
        title: tc.title,
        passCount: data.passed,
        failCount: data.failed,
        recentResults: data.results.map((s: string) =>
          s === 'PASSED' ? 'PASSED' : s === 'FAILED' ? 'FAILED' : 'SKIPPED',
        ) as FlakyTest['recentResults'],
      };
    });
  }

  // ── Use case coverage ─────────────────────────────────────────────────────
  type UCRow = { useCaseTag: string | null; linkedScriptId: string | null; scripts: { id: string }[] };
  const ucMap = new Map<string, { total: number; automated: number }>();
  for (const tc of allTCsWithUseCase as UCRow[]) {
    const tag = tc.useCaseTag!;
    const existing = ucMap.get(tag) ?? { total: 0, automated: 0 };
    existing.total++;
    if (tc.linkedScriptId || tc.scripts.length > 0) existing.automated++;
    ucMap.set(tag, existing);
  }
  const useCaseCount = ucMap.size;
  const coveredUseCaseCount = [...ucMap.values()].filter((v) => v.automated > 0).length;
  const useCaseCoveragePct = useCaseCount > 0
    ? Math.round((coveredUseCaseCount / useCaseCount) * 100)
    : 0;
  const automationDepth = useCaseCount > 0
    ? Math.round((automatedCount / useCaseCount) * 10) / 10
    : 0;

  // ── AI & productivity ─────────────────────────────────────────────────────
  const manualScripts = scriptsGenerated - aiGeneratedScripts;
  const aiVsManualRatio = manualScripts > 0
    ? Math.round((aiGeneratedScripts / manualScripts) * 10) / 10
    : aiGeneratedScripts;
  const scriptPassRate = scriptsGenerated > 0
    ? Math.round((verifiedScripts / scriptsGenerated) * 100)
    : 0;

  return {
    // Coverage & Readiness
    totalTests,
    automatedCount,
    coveragePct: totalTests > 0 ? Math.round((automatedCount / totalTests) * 100) : 0,
    useCaseCount,
    coveredUseCaseCount,
    useCaseCoveragePct,
    automationDepth,

    // Quality & Stability
    overallPassRatePct,
    flakyTestCount: flakyTcIds.length,
    flakyPct: automatedCount > 0 ? Math.round((flakyTcIds.length / automatedCount) * 100) : 0,
    failureRecurrenceRate,
    neverRunCount,
    neverRunPct: totalTests > 0 ? Math.round((neverRunCount / totalTests) * 100) : 0,

    // Execution Velocity
    runsPerWeek: runsLastWeek,
    avgRunDurationSec,
    avgTcsPerRun,
    scheduledRunCount,
    manualRunCount,

    // AI & Productivity
    aiGeneratedScripts,
    manualScripts,
    aiVsManualRatio,
    scriptPassRate,
    tokensPerScript: 0, // computed on frontend from projectTokens / scriptsGenerated

    // Legacy
    scriptsGenerated,
    totalRuns,
    lastRunPassCount,
    lastRunFailCount,
    avgPassRate,
    activeSchedules,
    pendingHeals,
    flakyTests,
  };
}

// ── getRunTrend ────────────────────────────────────────────────────────────

export async function getRunTrend(projectId: string, days: number): Promise<RunTrendPoint[]> {
  const since = new Date();
  since.setDate(since.getDate() - days);

  const results = await prisma.runResult.findMany({
    where: {
      run: { projectId, createdAt: { gte: since } },
    },
    select: { status: true, createdAt: true },
    orderBy: { createdAt: 'asc' },
  });

  const map = new Map<string, RunTrendPoint>();
  for (const r of results) {
    const date = r.createdAt.toISOString().split('T')[0]!;
    let entry = map.get(date);
    if (!entry) {
      entry = { date, passed: 0, failed: 0, skipped: 0 };
      map.set(date, entry);
    }
    if (r.status === 'PASSED') entry.passed++;
    else if (r.status === 'FAILED') entry.failed++;
    else entry.skipped++;
  }

  // Fill in missing dates
  const points: RunTrendPoint[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const date = d.toISOString().split('T')[0]!;
    points.push(map.get(date) ?? { date, passed: 0, failed: 0, skipped: 0 });
  }

  return points;
}

// ── getTopSuites ───────────────────────────────────────────────────────────

export interface TopSuiteEntry {
  name: string;
  runCount: number;
  lastRunStatuses: string[];
  successRate: number;
  testCaseIds: string[];
}

export async function getTopSuites(projectId: string): Promise<TopSuiteEntry[]> {
  const runs = await prisma.run.findMany({
    where: {
      projectId,
      triggerType: { in: ['SUITE', 'SCHEDULED'] },
      status: { in: ['PASSED', 'FAILED', 'CANCELLED'] },
    },
    orderBy: { createdAt: 'desc' },
    select: { name: true, status: true },
    take: 500,
  });

  const byName = new Map<string, { statuses: string[]; count: number }>();
  for (const run of runs) {
    const existing = byName.get(run.name);
    if (existing) {
      existing.count++;
      if (existing.statuses.length < 5) existing.statuses.push(run.status);
    } else {
      byName.set(run.name, { statuses: [run.status], count: 1 });
    }
  }

  const top5 = [...byName.entries()]
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, 5);

  // Fetch TC IDs for each suite tag — tags is a JSON string field, use string contains
  const suiteNames = top5.map(([name]) => name);
  const tcsWithTags = await prisma.testCase.findMany({
    where: {
      projectId,
      OR: suiteNames.map((n) => ({ tags: { contains: `suite:${n}` } })),
    },
    select: { id: true, tags: true },
  });

  // Build a map: suiteName → testCaseIds
  const suiteToIds = new Map<string, string[]>();
  for (const tc of tcsWithTags) {
    let parsed: string[] = [];
    try { parsed = JSON.parse(tc.tags as string); } catch { /* skip */ }
    for (const tag of parsed) {
      if (tag.startsWith('suite:')) {
        const suiteName = tag.slice(6);
        if (!suiteToIds.has(suiteName)) suiteToIds.set(suiteName, []);
        suiteToIds.get(suiteName)!.push(tc.id);
      }
    }
  }

  return top5.map(([name, { statuses, count }]) => {
    const terminal = statuses.filter((s) => s === 'PASSED' || s === 'FAILED');
    const successRate =
      terminal.length > 0
        ? Math.round((terminal.filter((s) => s === 'PASSED').length / terminal.length) * 100)
        : 0;
    return { name, runCount: count, lastRunStatuses: statuses, successRate, testCaseIds: suiteToIds.get(name) ?? [] };
  });
}

// ── getProjectTokenUsage ───────────────────────────────────────────────────

export async function getProjectTokenUsage(projectId: string): Promise<number> {
  const agg = await prisma.llmCall.aggregate({
    where: { projectId },
    _sum: { totalTokens: true },
  });
  return agg._sum.totalTokens ?? 0;
}

// ── getAgentStatuses ───────────────────────────────────────────────────────

export async function getAgentStatuses(projectId: string): Promise<AgentStatus[]> {
  const [activeRuns, activeHeals] = await Promise.all([
    prisma.run.count({ where: { projectId, status: { in: ['RUNNING', 'PENDING'] } } }),
    prisma.heal.count({ where: { projectId, status: 'PENDING' } }),
  ]);

  return [
    {
      name: 'writer',
      label: 'Test Writer',
      status: 'idle',
      detail: 'Ready',
    },
    {
      name: 'scripts',
      label: 'Script Agent',
      status: 'idle',
      detail: 'Ready',
    },
    {
      name: 'execution',
      label: 'Execution Engine',
      status: activeRuns > 0 ? 'busy' : 'ok',
      detail: activeRuns > 0 ? `${activeRuns} run${activeRuns > 1 ? 's' : ''} active` : 'All clear',
    },
    {
      name: 'healing',
      label: 'Healing Agent',
      status: activeHeals > 0 ? 'busy' : 'ok',
      detail: activeHeals > 0 ? `${activeHeals} pending` : 'No pending heals',
    },
    {
      name: 'reports',
      label: 'Reports Agent',
      status: 'ok',
      detail: 'Ready',
    },
  ];
}
