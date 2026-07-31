// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore — @langchain/core is a transitive dep; types resolved at runtime
import { HumanMessage, SystemMessage, AIMessage, ToolMessage } from '@langchain/core/messages';
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
import type { BaseMessage } from '@langchain/core/messages';
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
import { DynamicStructuredTool } from '@langchain/core/tools';
import { z } from 'zod';
import { createLLM } from '../lib/llm.js';
import { loadActiveSkills, buildSkillsText } from '../lib/skillsContext.js';
import { prisma } from '../lib/prisma.js';
import { addRunJob } from '../lib/queue.js';
import { runScriptAgent } from '../agents/scriptAgent.js';
import {
  saveScript,
  savePOM,
  readScript,
  findScriptPath,
  listResourceFiles,
  readResourceFile,
} from '../services/scriptFileService.js';

const SCRIPTS_ROOT = process.env.SCRIPTS_ROOT ?? '/scripts';
import { isAgentEnabled } from '../lib/agentConfig.js';

// ── Types ──────────────────────────────────────────────────────────────────

export interface ChatHistoryMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface ChatAttachment {
  name: string;
  mimeType: string;
  data: string; // base64
}

export interface ChatAgentResult {
  reply: string;
  actionType?: string;
  actionPayload?: Record<string, unknown>;
}

export interface ChatStreamEvent {
  type: 'tool_start' | 'tool_done';
  name: string;
  label?: string;
}

export interface ChatContext {
  page?: string;
  tcId?: string;
  tcTitle?: string;
}

interface ToolExecutionResult {
  text: string;
  actionType?: string;
  actionPayload?: Record<string, unknown>;
}

interface ResultRow {
  status: string;
}

interface HealRow {
  id: string;
  type: string;
  confidence: number;
  runResult: {
    testCase: { tcId: string; title: string };
  };
}

interface FailureRow {
  errorMessage: string | null;
  testCase: { tcId: string; title: string };
}

// ── System prompt ──────────────────────────────────────────────────────────

function buildBasePrompt(projectName?: string): string {
  const project = projectName ? `the ${projectName} project` : 'this project';
  return `You are a QA assistant for ${project}.

You can help engineers with the full QA lifecycle using tools:
- list_test_cases: browse existing TCs by use-case or status
- create_test_cases: write structured TCs to the database from natural language descriptions
- approve_tc: change a TC from DRAFT to APPROVED
- generate_script: run the Script Agent to produce a Robot Framework .robot file for a TC
- read_script: view a TC's current script content
- fix_script: re-run the Script Agent with user feedback to correct an existing script
- run_tests / schedule_run: execute or schedule tests
- get_run_summary / get_failed_tests: check results

Rules:
- Use tools for real actions. Never fabricate TC IDs or run results.
- After tool use, summarise the result clearly. Keep responses concise and actionable.
- Do NOT ask the user to confirm the environment — call run_tests immediately using the project default environment (omit the environment parameter and the tool will resolve it automatically).
- If the user asks to run a specific TC that is in DRAFT status, call approve_tc first, then call run_tests — do not ask for permission to approve, just do it.
- run_tests only queues the run — it executes asynchronously in the background and is NOT done when the tool returns. Never call get_run_summary or get_failed_tests in the same turn right after run_tests; results won't exist yet. After run_tests, just tell the user the run has started and they can check the Execution screen or ask again later for results.
- Format numbers clearly. Use bullet points for lists.`;
}

function getToolLabel(name: string, args: Record<string, unknown>): string {
  switch (name) {
    case 'generate_script': return `Generating script for ${args['tcId'] ?? '...'}`;
    case 'fix_script': return `Fixing script for ${args['tcId'] ?? '...'}`;
    case 'approve_tc': return `Approving ${args['tcId'] ?? '...'}`;
    case 'read_script': return `Reading script for ${args['tcId'] ?? '...'}`;
    case 'create_test_cases': return `Creating ${(args['testCases'] as unknown[])?.length ?? 1} test case(s)`;
    case 'run_tests': return 'Starting test run...';
    case 'get_run_summary': return 'Fetching run summary...';
    case 'get_failed_tests': return 'Fetching failed tests...';
    case 'list_test_cases': return 'Listing test cases...';
    case 'get_project_stats': return 'Fetching project stats...';
    case 'get_pending_heals': return 'Checking pending heals...';
    case 'schedule_run': return 'Creating schedule...';
    default: return name.replace(/_/g, ' ');
  }
}

function buildSystemPrompt(memories: string[], skillsText?: string, context?: ChatContext, projectName?: string): string {
  let prompt = buildBasePrompt(projectName);
  if (skillsText) {
    prompt = `${skillsText}\n\n${prompt}`;
  }
  if (context?.page || context?.tcId) {
    const parts: string[] = ['\nCurrent user context:'];
    if (context.page) parts.push(`- Page: ${context.page}`);
    if (context.tcId) parts.push(`- Active test case: ${context.tcId}${context.tcTitle ? ` — "${context.tcTitle}"` : ''}`);
    prompt += parts.join('\n');
  }
  if (memories.length === 0) return prompt;
  const memoryBlock = memories.map(m => `- ${m}`).join('\n');
  return `${prompt}\n\nPersistent memory (facts to always keep in mind):\n${memoryBlock}`;
}

// ── Tool implementations ───────────────────────────────────────────────────

async function toolRunTests(
  projectId: string,
  input: { testCaseIds?: string[]; useCaseTag?: string; environment?: string },
): Promise<ToolExecutionResult> {
  const { testCaseIds, useCaseTag } = input;
  // Resolve environment — use what was provided, fall back to the project's default envConfig
  let environment = input.environment ?? '';
  if (!environment) {
    const defaultEnv = await prisma.envConfig.findFirst({
      where: { projectId, isDefault: true },
      select: { name: true },
    }) ?? await prisma.envConfig.findFirst({
      where: { projectId },
      select: { name: true },
    });
    environment = defaultEnv?.name ?? 'QA';
  }
  let resolvedIds: string[] = [];

  if (useCaseTag) {
    const tcs = await prisma.testCase.findMany({
      where: { projectId, useCaseTag, status: 'APPROVED' },
      select: { id: true },
    });
    resolvedIds = tcs.map((t: { id: string }) => t.id);
  } else if (testCaseIds && testCaseIds.length > 0) {
    const [byId, byTcId] = await Promise.all([
      prisma.testCase.findMany({ where: { projectId, id: { in: testCaseIds } }, select: { id: true } }),
      prisma.testCase.findMany({ where: { projectId, tcId: { in: testCaseIds } }, select: { id: true } }),
    ]);
    const idSet = new Set([...byId.map((t: { id: string }) => t.id), ...byTcId.map((t: { id: string }) => t.id)]);
    resolvedIds = Array.from(idSet);
  }

  if (resolvedIds.length === 0) {
    return {
      text: `No test cases found (useCaseTag: ${useCaseTag ?? 'none'}, ids: ${testCaseIds?.join(', ') ?? 'none'}).`,
      actionType: 'RUN_ERROR',
    };
  }

  const [project, rawScripts] = await Promise.all([
    prisma.project.findUnique({ where: { id: projectId }, select: { slug: true } }),
    prisma.script.findMany({
      where: { projectId, testCaseId: { in: resolvedIds } },
      select: {
        testCaseId: true,
        filename: true,
        content: true,
        useCaseFolder: true,
        testCase: { select: { useCaseTag: true } },
      },
    }),
  ]);
  const slug = project?.slug ?? projectId;

  const scriptPaths = rawScripts
    .filter(s => s.testCaseId !== null)
    .map(s => {
      const tcId = s.testCaseId as string;
      // Use the service's recursive search (TestCases/*, scripts/*, root)
      const found = findScriptPath(slug, s.filename);
      if (found) return { testCaseId: tcId, scriptPath: found };
      // Not on disk — write from DB content then locate
      if (s.content) {
        const useCase = s.useCaseFolder ?? (s.testCase as { useCaseTag?: string } | null)?.useCaseTag ?? null;
        saveScript(slug, s.filename, s.content, useCase);
        const written = findScriptPath(slug, s.filename);
        if (written) return { testCaseId: tcId, scriptPath: written };
      }
      // Last resort: flat path (runner will report file-not-found clearly)
      return { testCaseId: tcId, scriptPath: `${SCRIPTS_ROOT}/${slug}/scripts/${s.filename}` };
    });

  if (scriptPaths.length === 0) {
    return {
      text: `Found ${resolvedIds.length} test cases but none have scripts. Generate scripts first.`,
      actionType: 'RUN_ERROR',
    };
  }

  const envConfig = await prisma.envConfig.findFirst({
    where: { projectId, name: environment },
    select: { baseUrl: true, username: true, password: true },
  });

  const seqAgg = await prisma.run.aggregate({ _max: { runSeq: true } });
  const runSeq = (seqAgg._max.runSeq ?? 0) + 1;

  const run = await prisma.run.create({
    data: {
      projectId,
      runSeq,
      name: useCaseTag ? `Chat: ${useCaseTag}` : `Chat: ${scriptPaths.length} tests`,
      environment,
      status: 'PENDING',
      triggerType: 'MANUAL',
    },
  });

  await addRunJob({
    runId: run.id,
    projectId,
    testCaseIds: scriptPaths.map((s) => s.testCaseId),
    scriptPaths: scriptPaths.map((s) => s.scriptPath),
    environment,
    envBaseUrl: envConfig?.baseUrl ?? '',
    envUsername: envConfig?.username ?? '',
    envPassword: envConfig?.password ?? '',
    parallelWorkers: 2,
    headless: true,
    browser: 'chromium',
    triggerType: 'MANUAL',
  });

  return {
    text: `Run queued: ${scriptPaths.length} tests on ${environment}.`,
    actionType: 'RUN_STARTED',
    actionPayload: {
      runId: run.id,
      runName: run.name,
      environment,
      testCount: scriptPaths.length,
      useCaseTag: useCaseTag ?? null,
    },
  };
}

async function toolGetRunSummary(projectId: string, runId?: string): Promise<ToolExecutionResult> {
  const where = runId ? { id: runId, projectId } : { projectId };
  const run = await prisma.run.findFirst({
    where,
    orderBy: runId ? undefined : { createdAt: 'desc' },
    include: {
      results: { select: { status: true } },
      _count: { select: { results: true } },
    },
  });

  if (!run) return { text: 'No runs found for this project.', actionType: 'RUN_SUMMARY' };

  if (run.status === 'PENDING' || run.status === 'RUNNING') {
    return {
      text: `Run "${run.name}" is still ${run.status === 'PENDING' ? 'queued' : 'in progress'} on ${run.environment} — no results yet. Check the Execution screen for live progress, or ask again once it finishes.`,
      actionType: 'RUN_STARTED',
      actionPayload: {
        runId: run.id,
        runName: run.name,
        environment: run.environment,
      },
    };
  }

  const results = (run.results as ResultRow[]);
  const passed = results.filter((r: ResultRow) => r.status === 'PASSED').length;
  const failed = results.filter((r: ResultRow) => r.status === 'FAILED').length;
  const total = (run._count as { results: number }).results;
  const passRate = total > 0 ? Math.round((passed / total) * 100) : 0;

  return {
    text: `Run "${run.name}": ${total} tests, ${passed} passed (${passRate}%), ${failed} failed. Status: ${run.status}. Env: ${run.environment}.`,
    actionType: 'RUN_SUMMARY',
    actionPayload: {
      runId: run.id, runName: run.name, status: run.status, environment: run.environment,
      total, passed, failed, passRate,
      completedAt: run.completedAt ? (run.completedAt as Date).toISOString() : null,
    },
  };
}

async function toolGetFailedTests(projectId: string, runId?: string): Promise<ToolExecutionResult> {
  const where = runId ? { id: runId, projectId } : { projectId };
  const run = await prisma.run.findFirst({
    where,
    orderBy: runId ? undefined : { createdAt: 'desc' },
    select: { id: true, name: true },
  });

  if (!run) return { text: 'No runs found.', actionType: 'FAILED_TESTS' };

  const rawFailures = await prisma.runResult.findMany({
    where: { runId: run.id, status: 'FAILED' },
    include: { testCase: { select: { tcId: true, title: true } } },
    orderBy: { createdAt: 'asc' },
  });
  const failures = rawFailures as FailureRow[];

  if (failures.length === 0) {
    return {
      text: `No failed tests in run "${run.name}".`,
      actionType: 'FAILED_TESTS',
      actionPayload: { runId: run.id, runName: run.name, failures: [] },
    };
  }

  const list = failures.map((f: FailureRow) => ({
    tcId: f.testCase.tcId,
    title: f.testCase.title,
    error: (f.errorMessage ?? 'Unknown error').slice(0, 200),
  }));

  return {
    text: `${failures.length} failed in "${run.name}": ${list.map((f) => f.tcId).join(', ')}.`,
    actionType: 'FAILED_TESTS',
    actionPayload: { runId: run.id, runName: run.name, failures: list },
  };
}

async function toolGetPendingHeals(projectId: string): Promise<ToolExecutionResult> {
  const rawHeals = await prisma.heal.findMany({
    where: { projectId, status: 'PENDING' },
    include: { runResult: { include: { testCase: { select: { tcId: true, title: true } } } } },
    orderBy: { createdAt: 'desc' },
    take: 10,
  });
  const heals = rawHeals as HealRow[];

  if (heals.length === 0) {
    return {
      text: 'No pending heals. Pipeline is healthy.',
      actionType: 'PENDING_HEALS',
      actionPayload: { count: 0, heals: [] },
    };
  }

  const list = heals.map((h: HealRow) => ({
    healId: h.id,
    tcId: h.runResult.testCase.tcId,
    title: h.runResult.testCase.title,
    type: h.type,
    confidence: h.confidence,
  }));

  return {
    text: `${heals.length} pending heal${heals.length !== 1 ? 's' : ''} awaiting approval.`,
    actionType: 'PENDING_HEALS',
    actionPayload: { count: heals.length, heals: list },
  };
}

async function toolScheduleRun(
  projectId: string,
  input: { name: string; cronExpression: string; useCaseTag?: string; testCaseIds?: string[]; environment?: string },
): Promise<ToolExecutionResult> {
  const { name, cronExpression, useCaseTag, testCaseIds } = input;
  let environment = input.environment ?? '';
  if (!environment) {
    const defaultEnv = await prisma.envConfig.findFirst({
      where: { projectId, isDefault: true },
      select: { name: true },
    }) ?? await prisma.envConfig.findFirst({ where: { projectId }, select: { name: true } });
    environment = defaultEnv?.name ?? 'QA';
  }
  let ids: string[] = [];

  if (useCaseTag) {
    const tcs = await prisma.testCase.findMany({
      where: { projectId, useCaseTag, status: 'APPROVED' },
      select: { id: true },
    });
    ids = tcs.map((t: { id: string }) => t.id);
  } else if (testCaseIds?.length) {
    ids = testCaseIds;
  }

  if (ids.length === 0) {
    return { text: 'No test cases found to schedule. Specify a use-case group or test case IDs.', actionType: 'SCHEDULED' };
  }

  const schedule = await prisma.schedule.create({
    data: {
      projectId, name, cronExpression,
      testCaseIds: JSON.stringify(ids),
      environment, isActive: true,
      emailRecipients: JSON.stringify([]),
    },
  });

  return {
    text: `Schedule "${name}" created — ${ids.length} tests on ${environment} at cron: ${cronExpression}.`,
    actionType: 'SCHEDULED',
    actionPayload: { scheduleId: schedule.id, name, cronExpression, environment, testCount: ids.length },
  };
}

async function toolGenerateTestCases(
  input: { jiraUrl?: string; prompt?: string; useCaseTag?: string },
): Promise<ToolExecutionResult> {
  const { jiraUrl, prompt, useCaseTag } = input;
  const source = jiraUrl ?? prompt ?? 'provided description';
  return {
    text: `Test case generation queued from: ${source}. Open the Test Writer screen to review generated cases.`,
    actionType: 'TC_QUEUED',
    actionPayload: { source, jiraUrl: jiraUrl ?? null, prompt: prompt ?? null, useCaseTag: useCaseTag ?? null, redirectTo: 'writer' },
  };
}

async function toolGetProjectStats(projectId: string): Promise<ToolExecutionResult> {
  const [totalTests, scriptsGenerated, pendingHeals, activeSchedules, lastRun] = await Promise.all([
    prisma.testCase.count({ where: { projectId } }),
    prisma.script.count({ where: { projectId } }),
    prisma.heal.count({ where: { projectId, status: 'PENDING' } }),
    prisma.schedule.count({ where: { projectId, isActive: true } }),
    prisma.run.findFirst({
      where: { projectId },
      orderBy: { createdAt: 'desc' },
      include: { results: { select: { status: true } }, _count: { select: { results: true } } },
    }),
  ]);

  const results = lastRun ? (lastRun.results as ResultRow[]) : [];
  const lastRunPassed = results.filter((r: ResultRow) => r.status === 'PASSED').length;
  const lastRunFailed = results.filter((r: ResultRow) => r.status === 'FAILED').length;
  const lastRunTotal = lastRun ? (lastRun._count as { results: number }).results : 0;
  const passRate = lastRunTotal > 0 ? Math.round((lastRunPassed / lastRunTotal) * 100) : 0;

  return {
    text: `Project: ${totalTests} TCs, ${scriptsGenerated} scripts, ${pendingHeals} pending heals, ${activeSchedules} active schedules. Last run: ${passRate}% pass rate.`,
    actionType: 'PROJECT_STATS',
    actionPayload: {
      totalTests, scriptsGenerated, pendingHeals, activeSchedules,
      lastRun: lastRun ? { id: lastRun.id, name: lastRun.name, status: lastRun.status, passed: lastRunPassed, failed: lastRunFailed, total: lastRunTotal, passRate } : null,
    },
  };
}

// ── New Phase-1 tool implementations ──────────────────────────────────────

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

async function toolListTestCases(
  projectId: string,
  input: { useCaseTag?: string; status?: string; limit?: number },
): Promise<ToolExecutionResult> {
  const { useCaseTag, status, limit = 20 } = input;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const where: Record<string, any> = { projectId };
  if (useCaseTag) where.useCaseTag = { contains: useCaseTag, mode: 'insensitive' };
  if (status) where.status = status;

  const tcs = await prisma.testCase.findMany({
    where,
    select: { id: true, tcId: true, title: true, status: true, useCaseTag: true, type: true, priority: true },
    orderBy: [{ useCaseTag: 'asc' }, { tcId: 'asc' }],
    take: limit,
  });

  if (tcs.length === 0) {
    return { text: 'No test cases found matching your criteria.', actionType: 'TC_LIST', actionPayload: { testCases: [] } };
  }

  const grouped: Record<string, typeof tcs> = {};
  for (const tc of tcs) {
    const group = tc.useCaseTag ?? 'Uncategorised';
    if (!grouped[group]) grouped[group] = [];
    grouped[group].push(tc);
  }

  const summary = Object.entries(grouped)
    .map(([group, items]) => `**${group}** (${items.length}): ${items.map(tc => `${tc.tcId} [${tc.status}]`).join(', ')}`)
    .join('\n');

  return {
    text: `Found ${tcs.length} test case${tcs.length !== 1 ? 's' : ''}:\n${summary}`,
    actionType: 'TC_LIST',
    actionPayload: { testCases: tcs, count: tcs.length },
  };
}

async function toolCreateTestCases(
  projectId: string,
  projectSlug: string,
  input: {
    testCases: Array<{
      title: string;
      description: string;
      steps: string[];
      expectedResult: string;
      useCaseTag: string;
      type?: string;
      priority?: string;
    }>;
  },
): Promise<ToolExecutionResult> {
  const { testCases } = input;
  const prefix = projectSlug.replace(/[^a-zA-Z0-9]/g, '').slice(0, 3).toUpperCase();

  const existing = await prisma.testCase.findMany({ where: { projectId }, select: { tcId: true } });
  const maxNum = existing.reduce((max: number, { tcId }: { tcId: string }) => {
    const m = tcId.match(/(\d+)$/);
    return m ? Math.max(max, parseInt(m[1], 10)) : max;
  }, 0);

  const created = await prisma.$transaction(
    testCases.map((tc, i) =>
      prisma.testCase.create({
        data: {
          projectId,
          tcId: `TC-${prefix}-${String(maxNum + i + 1).padStart(3, '0')}`,
          title: tc.title,
          description: tc.description,
          steps: JSON.stringify(tc.steps),
          expectedResult: tc.expectedResult,
          type: tc.type ?? 'FUNCTIONAL',
          tags: JSON.stringify([]),
          useCaseTag: tc.useCaseTag,
          priority: tc.priority ?? 'MEDIUM',
          status: 'DRAFT',
        },
      }),
    ),
  );

  const list = created.map((tc: { tcId: string; title: string }) => `- ${tc.tcId}: ${tc.title}`).join('\n');
  return {
    text: `Created ${created.length} test case${created.length !== 1 ? 's' : ''}:\n${list}\n\nThey are in DRAFT status. Use approve_tc to approve them.`,
    actionType: 'TC_CREATED',
    actionPayload: {
      testCases: created.map((tc: { id: string; tcId: string; title: string; status: string; useCaseTag: string | null }) => ({
        id: tc.id, tcId: tc.tcId, title: tc.title, status: tc.status, useCaseTag: tc.useCaseTag,
      })),
    },
  };
}

async function toolGenerateScript(
  projectId: string,
  input: { tcId: string; contextNote?: string },
): Promise<ToolExecutionResult> {
  const { tcId, contextNote } = input;

  if (!(await isAgentEnabled('script-agent'))) {
    return { text: 'Script Agent is disabled. Enable it in AI Usage settings.', actionType: 'SCRIPT_ERROR' };
  }

  const tc = await prisma.testCase.findFirst({
    where: { projectId, tcId },
    select: { id: true, tcId: true, title: true, description: true, steps: true, expectedResult: true, type: true, useCaseTag: true, generationHints: true, runtimeVariables: true },
  });
  if (!tc) return { text: `Test case "${tcId}" not found.`, actionType: 'SCRIPT_ERROR' };

  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { id: true, slug: true, name: true, baseUrl: true, patternMemory: true },
  });
  if (!project) return { text: 'Project not found.', actionType: 'SCRIPT_ERROR' };

  const resourceFiles = listResourceFiles(project.slug).map((f: { filename: string }) => {
    let keywords: string[] = [];
    try { keywords = extractRobotKeywords(readResourceFile(project.slug, f.filename)); } catch { /* skip */ }
    return { filename: f.filename, keywords };
  });

  let runtimeVariables = null;
  if (tc.runtimeVariables) {
    try { runtimeVariables = JSON.parse(tc.runtimeVariables as string); } catch { /* ignore */ }
  }

  const result = await runScriptAgent({
    testCase: {
      id: tc.id, tcId: tc.tcId, title: tc.title, description: tc.description,
      steps: tc.steps, expectedResult: tc.expectedResult, type: tc.type,
      useCaseTag: tc.useCaseTag, generationHints: tc.generationHints,
    },
    project: { id: project.id, slug: project.slug, name: project.name, baseUrl: project.baseUrl },
    existingPOMs: [],
    contextNote,
    scriptMode: 'ROBOT',
    resourceFiles: resourceFiles.length > 0 ? resourceFiles : undefined,
    patternMemory: project.patternMemory,
    runtimeVariables,
  });

  const titleSlug = tc.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
  const filename = `${tc.tcId}-${titleSlug}.robot`;
  const ucFolder = tc.useCaseTag ?? '_uncategorized';

  saveScript(project.slug, filename, result.specContent, tc.useCaseTag);
  if (result.pomContent && result.pomFilename) savePOM(project.slug, result.pomFilename, result.pomContent);

  const existingScript = await prisma.script.findFirst({ where: { projectId, testCaseId: tc.id } });
  const script = existingScript
    ? await prisma.script.update({
        where: { id: existingScript.id },
        data: { filename, content: result.specContent, scriptType: result.scriptType, useCaseFolder: ucFolder, updatedAt: new Date() },
      })
    : await prisma.script.create({
        data: {
          projectId, testCaseId: tc.id, filename, content: result.specContent,
          scriptType: result.scriptType, useCaseFolder: ucFolder,
          isCustomUpload: false, verificationStatus: 'NOT_VERIFIED',
        },
      });

  return {
    text: `Script generated for ${tc.tcId} — "${tc.title}". Saved as \`${filename}\`.`,
    actionType: 'SCRIPT_GENERATED',
    actionPayload: { tcId: tc.tcId, scriptId: script.id, filename },
  };
}

async function toolReadScript(
  projectId: string,
  input: { tcId: string },
): Promise<ToolExecutionResult> {
  const { tcId } = input;

  const tc = await prisma.testCase.findFirst({
    where: { projectId, tcId },
    select: { id: true, tcId: true, title: true, useCaseTag: true },
  });
  if (!tc) return { text: `Test case "${tcId}" not found.`, actionType: 'SCRIPT_READ_ERROR' };

  const project = await prisma.project.findUnique({ where: { id: projectId }, select: { slug: true } });
  const scriptRow = await prisma.script.findFirst({
    where: { projectId, testCaseId: tc.id },
    select: { filename: true, content: true },
    orderBy: { updatedAt: 'desc' },
  });

  if (!scriptRow) {
    return { text: `No script found for ${tcId}. Use generate_script first.`, actionType: 'SCRIPT_READ_ERROR' };
  }

  let content = scriptRow.content ?? '';
  if (project) {
    try {
      content = readScript(project.slug, scriptRow.filename, tc.useCaseTag);
    } catch { /* fall back to DB content */ }
  }

  const preview = content.length > 3000 ? `${content.slice(0, 3000)}\n... (truncated)` : content;
  return {
    text: `Script for ${tcId} (\`${scriptRow.filename}\`):\n\`\`\`robot\n${preview}\n\`\`\``,
    actionType: 'SCRIPT_READ',
    actionPayload: { tcId, filename: scriptRow.filename, content },
  };
}

async function toolFixScript(
  projectId: string,
  input: { tcId: string; instruction: string },
): Promise<ToolExecutionResult> {
  const { tcId, instruction } = input;

  if (!(await isAgentEnabled('script-agent'))) {
    return { text: 'Script Agent is disabled. Enable it in AI Usage settings.', actionType: 'SCRIPT_ERROR' };
  }

  const tc = await prisma.testCase.findFirst({
    where: { projectId, tcId },
    select: { id: true, tcId: true, title: true, description: true, steps: true, expectedResult: true, type: true, useCaseTag: true, generationHints: true, runtimeVariables: true },
  });
  if (!tc) return { text: `Test case "${tcId}" not found.`, actionType: 'SCRIPT_ERROR' };

  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { id: true, slug: true, name: true, baseUrl: true, patternMemory: true },
  });
  if (!project) return { text: 'Project not found.', actionType: 'SCRIPT_ERROR' };

  const resourceFiles = listResourceFiles(project.slug).map((f: { filename: string }) => {
    let keywords: string[] = [];
    try { keywords = extractRobotKeywords(readResourceFile(project.slug, f.filename)); } catch { /* skip */ }
    return { filename: f.filename, keywords };
  });

  let runtimeVariables = null;
  if (tc.runtimeVariables) {
    try { runtimeVariables = JSON.parse(tc.runtimeVariables as string); } catch { /* ignore */ }
  }

  const result = await runScriptAgent({
    testCase: {
      id: tc.id, tcId: tc.tcId, title: tc.title, description: tc.description,
      steps: tc.steps, expectedResult: tc.expectedResult, type: tc.type,
      useCaseTag: tc.useCaseTag, generationHints: tc.generationHints,
    },
    project: { id: project.id, slug: project.slug, name: project.name, baseUrl: project.baseUrl },
    existingPOMs: [],
    qaFeedback: instruction,
    scriptMode: 'ROBOT',
    resourceFiles: resourceFiles.length > 0 ? resourceFiles : undefined,
    patternMemory: project.patternMemory,
    runtimeVariables,
  });

  const titleSlug = tc.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
  const filename = `${tc.tcId}-${titleSlug}.robot`;
  const ucFolder = tc.useCaseTag ?? '_uncategorized';

  saveScript(project.slug, filename, result.specContent, tc.useCaseTag);
  if (result.pomContent && result.pomFilename) savePOM(project.slug, result.pomFilename, result.pomContent);

  const existingScript = await prisma.script.findFirst({ where: { projectId, testCaseId: tc.id } });
  const script = existingScript
    ? await prisma.script.update({
        where: { id: existingScript.id },
        data: { filename, content: result.specContent, scriptType: result.scriptType, useCaseFolder: ucFolder, updatedAt: new Date() },
      })
    : await prisma.script.create({
        data: {
          projectId, testCaseId: tc.id, filename, content: result.specContent,
          scriptType: result.scriptType, useCaseFolder: ucFolder,
          isCustomUpload: false, verificationStatus: 'NOT_VERIFIED',
        },
      });

  return {
    text: `Script for ${tcId} updated and saved as \`${filename}\`.`,
    actionType: 'SCRIPT_FIXED',
    actionPayload: { tcId, scriptId: script.id, filename },
  };
}

async function toolApproveTc(
  projectId: string,
  input: { tcId: string },
): Promise<ToolExecutionResult> {
  const { tcId } = input;

  const tc = await prisma.testCase.findFirst({
    where: { projectId, tcId },
    select: { id: true, tcId: true, title: true, status: true },
  });
  if (!tc) return { text: `Test case "${tcId}" not found.`, actionType: 'TC_APPROVE_ERROR' };

  if (tc.status === 'APPROVED') {
    return { text: `${tcId} is already approved.`, actionType: 'TC_APPROVED', actionPayload: { tcId, title: tc.title } };
  }

  await prisma.testCase.update({ where: { id: tc.id }, data: { status: 'APPROVED', updatedAt: new Date() } });

  return {
    text: `${tcId} — "${tc.title}" approved successfully.`,
    actionType: 'TC_APPROVED',
    actionPayload: { tcId, title: tc.title },
  };
}

// ── Tool factory ───────────────────────────────────────────────────────────

function createChatTools(projectId: string, projectSlug?: string): DynamicStructuredTool[] {
  return [
    new DynamicStructuredTool({
      name: 'run_tests',
      description: 'Trigger a test run immediately. Use when the user explicitly asks to run or execute tests.',
      schema: z.object({
        testCaseIds: z.array(z.string()).optional().describe('Specific test case IDs'),
        useCaseTag: z.string().optional().describe('Run all tests in this use-case group (e.g. "Primary Sales")'),
        environment: z.string().optional().describe('Target environment (e.g. QA, Dev, Staging). Omit to use the project default.'),
      }),
      func: async (input: { testCaseIds?: string[]; useCaseTag?: string; environment?: string }): Promise<string> =>
        JSON.stringify(await toolRunTests(projectId, input)),
    }),

    new DynamicStructuredTool({
      name: 'get_run_summary',
      description: 'Get a summary of a specific run, or the most recent run if no runId provided.',
      schema: z.object({
        runId: z.string().optional().describe('Run ID. Omit for most recent run.'),
      }),
      func: async (input: { runId?: string }): Promise<string> =>
        JSON.stringify(await toolGetRunSummary(projectId, input.runId)),
    }),

    new DynamicStructuredTool({
      name: 'get_failed_tests',
      description: 'List failed test cases from a run. Omit runId for the most recent run.',
      schema: z.object({
        runId: z.string().optional().describe('Run ID. Omit for most recent run.'),
      }),
      func: async (input: { runId?: string }): Promise<string> =>
        JSON.stringify(await toolGetFailedTests(projectId, input.runId)),
    }),

    new DynamicStructuredTool({
      name: 'get_pending_heals',
      description: 'List all pending heal proposals awaiting approval.',
      schema: z.object({}),
      func: async (): Promise<string> =>
        JSON.stringify(await toolGetPendingHeals(projectId)),
    }),

    new DynamicStructuredTool({
      name: 'schedule_run',
      description: 'Create a recurring scheduled run with a cron expression.',
      schema: z.object({
        name: z.string().describe('Schedule name, e.g. "Nightly Regression"'),
        cronExpression: z.string().describe('5-part cron expression, e.g. "0 2 * * *"'),
        useCaseTag: z.string().optional().describe('Use-case group to run'),
        testCaseIds: z.array(z.string()).optional().describe('Specific test case IDs'),
        environment: z.string().optional().describe('Target environment (omit to use project default)'),
      }),
      func: async (input: { name: string; cronExpression: string; useCaseTag?: string; testCaseIds?: string[]; environment?: string }): Promise<string> =>
        JSON.stringify(await toolScheduleRun(projectId, input)),
    }),

    new DynamicStructuredTool({
      name: 'generate_test_cases',
      description: 'Queue test case generation from a Jira story URL or free-text prompt.',
      schema: z.object({
        jiraUrl: z.string().optional().describe('Jira story URL'),
        prompt: z.string().optional().describe('Free-text description of what to test'),
        useCaseTag: z.string().optional().describe('Use-case group to assign generated TCs to'),
      }),
      func: async (input: { jiraUrl?: string; prompt?: string; useCaseTag?: string }): Promise<string> =>
        JSON.stringify(await toolGenerateTestCases(input)),
    }),

    new DynamicStructuredTool({
      name: 'get_project_stats',
      description: 'Get project overview: test counts, pass rate, pending heals, active schedules.',
      schema: z.object({}),
      func: async (): Promise<string> =>
        JSON.stringify(await toolGetProjectStats(projectId)),
    }),

    new DynamicStructuredTool({
      name: 'list_test_cases',
      description: 'List test cases in this project. Can filter by use-case group and/or status (DRAFT, APPROVED, DEPRECATED).',
      schema: z.object({
        useCaseTag: z.string().optional().describe('Filter by use-case group, e.g. "Primary Sales"'),
        status: z.enum(['DRAFT', 'APPROVED', 'DEPRECATED']).optional().describe('Filter by status'),
        limit: z.number().int().min(1).max(100).optional().describe('Max results to return (default 20)'),
      }),
      func: async (input: { useCaseTag?: string; status?: string; limit?: number }): Promise<string> =>
        JSON.stringify(await toolListTestCases(projectId, input)),
    }),

    new DynamicStructuredTool({
      name: 'create_test_cases',
      description: 'Create one or more test cases in the database from a structured description. Each TC starts in DRAFT status.',
      schema: z.object({
        testCases: z.array(z.object({
          title: z.string().describe('Short descriptive title of the test case'),
          description: z.string().describe('What the test case verifies'),
          steps: z.array(z.string()).describe('Ordered list of test steps'),
          expectedResult: z.string().describe('What the system should do after all steps'),
          useCaseTag: z.string().describe('Use-case group, e.g. "Primary Sales", "Stock Management"'),
          type: z.enum(['FUNCTIONAL', 'REGRESSION', 'SMOKE', 'E2E', 'INTEGRATION', 'PERFORMANCE']).optional(),
          priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']).optional(),
        })).min(1).max(20),
      }),
      func: async (input: { testCases: Array<{ title: string; description: string; steps: string[]; expectedResult: string; useCaseTag: string; type?: string; priority?: string }> }): Promise<string> =>
        JSON.stringify(await toolCreateTestCases(projectId, projectSlug ?? '', input)),
    }),

    new DynamicStructuredTool({
      name: 'generate_script',
      description: 'Generate a Robot Framework automation script for a test case. Use the tcId like "TC-ART-001". This calls the Script Agent and saves the result.',
      schema: z.object({
        tcId: z.string().describe('Test case ID, e.g. "TC-ART-001"'),
        contextNote: z.string().optional().describe('Extra context or instructions for the script agent'),
      }),
      func: async (input: { tcId: string; contextNote?: string }): Promise<string> =>
        JSON.stringify(await toolGenerateScript(projectId, input)),
    }),

    new DynamicStructuredTool({
      name: 'read_script',
      description: 'Read the current Robot Framework script content for a test case.',
      schema: z.object({
        tcId: z.string().describe('Test case ID, e.g. "TC-ART-001"'),
      }),
      func: async (input: { tcId: string }): Promise<string> =>
        JSON.stringify(await toolReadScript(projectId, input)),
    }),

    new DynamicStructuredTool({
      name: 'fix_script',
      description: 'Fix or update a test script based on a specific instruction. Re-runs the Script Agent with your feedback and saves the new version.',
      schema: z.object({
        tcId: z.string().describe('Test case ID whose script to fix'),
        instruction: z.string().describe('What to fix or change, e.g. "use keyword from resource file instead of inline steps"'),
      }),
      func: async (input: { tcId: string; instruction: string }): Promise<string> =>
        JSON.stringify(await toolFixScript(projectId, input)),
    }),

    new DynamicStructuredTool({
      name: 'approve_tc',
      description: 'Approve a test case, changing its status from DRAFT to APPROVED so it can be run.',
      schema: z.object({
        tcId: z.string().describe('Test case ID to approve, e.g. "TC-ART-001"'),
      }),
      func: async (input: { tcId: string }): Promise<string> =>
        JSON.stringify(await toolApproveTc(projectId, input)),
    }),
  ];
}

// ── Agent entry point ──────────────────────────────────────────────────────

function buildHumanMessage(text: string, attachments: ChatAttachment[]): HumanMessage {
  if (attachments.length === 0) return new HumanMessage(text);

  console.log(
    '[ChatAgent] attachments received:',
    attachments.map(a => ({ name: a.name, mimeType: a.mimeType, bytes: Math.round(a.data.length * 0.75) })),
  );

  const imageAttachments = attachments.filter(a => a.mimeType.startsWith('image/'));
  const textAttachments  = attachments.filter(a => !a.mimeType.startsWith('image/'));

  // Decode text/CSV/HTML/JSON files and append directly to the message string.
  // This is the only reliable path — LangChain v0.2 doesn't always serialize
  // mixed text+non-image content blocks correctly to the OpenAI wire format.
  let fullText = text;
  for (const att of textAttachments) {
    try {
      const decoded = Buffer.from(att.data, 'base64').toString('utf8');
      fullText += `\n\n--- Attached file: ${att.name} ---\n${decoded.slice(0, 8000)}\n--- End of ${att.name} ---`;
    } catch {
      fullText += `\n[Attached file: ${att.name} — could not decode]`;
    }
  }

  // No images — send as a plain text message (always works)
  if (imageAttachments.length === 0) {
    return new HumanMessage(fullText);
  }

  // Images — use multimodal content array (OpenAI / OpenRouter vision format)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return new HumanMessage({
    content: [
      { type: 'text', text: fullText },
      ...imageAttachments.map(a => ({
        type: 'image_url',
        image_url: { url: `data:${a.mimeType};base64,${a.data}` },
      })),
    ],
  } as any); // eslint-disable-line @typescript-eslint/no-explicit-any
}

export async function runChatAgent(
  projectId: string,
  userMessage: string,
  history: ChatHistoryMessage[],
  memories: string[] = [],
  attachments: ChatAttachment[] = [],
  projectName?: string,
  projectSlug?: string,
  onEvent?: (event: ChatStreamEvent) => void,
  context?: ChatContext,
): Promise<ChatAgentResult> {
  const skillsText = projectSlug ? buildSkillsText(loadActiveSkills(projectSlug)) : '';

  const tools = createChatTools(projectId, projectSlug);
  const llm = createLLM({ temperature: 0.3, agentName: 'chat-agent', projectId, projectName });

  const llmWithTools = typeof (llm as { bindTools?: (t: unknown) => unknown }).bindTools === 'function'
    ? (llm as { bindTools: (t: DynamicStructuredTool[]) => typeof llm }).bindTools(tools)
    : llm;

  const historyMessages: BaseMessage[] = history.slice(-20).map((m: ChatHistoryMessage) =>
    m.role === 'user' ? new HumanMessage(m.content) : new AIMessage(m.content),
  );

  const messages: BaseMessage[] = [
    new SystemMessage(buildSystemPrompt(memories, skillsText || undefined, context, projectName)),
    ...historyMessages,
    buildHumanMessage(userMessage, attachments),
  ];

  let lastActionType: string | undefined;
  let lastActionPayload: Record<string, unknown> | undefined;

  const MAX_ITERATIONS = 5;
  for (let i = 0; i < MAX_ITERATIONS; i++) {
    const response = await llmWithTools.invoke(messages) as AIMessage & {
      tool_calls?: Array<{ id: string; name: string; args: Record<string, unknown> }>;
    };
    messages.push(response);

    const toolCalls = response.tool_calls;
    if (!toolCalls || toolCalls.length === 0) {
      const content = response.content;
      const text = typeof content === 'string'
        ? content
        : Array.isArray(content)
          ? (content as Array<{ type?: string; text?: string }>)
              .filter((b) => b && typeof b === 'object' && b.type === 'text')
              .map((b) => b.text ?? '')
              .join('')
          : '';
      return { reply: text || 'Request processed.', actionType: lastActionType, actionPayload: lastActionPayload };
    }

    for (const toolCall of toolCalls) {
      onEvent?.({
        type: 'tool_start',
        name: toolCall.name,
        label: getToolLabel(toolCall.name, toolCall.args ?? {}),
      });

      const tool = tools.find((t: DynamicStructuredTool) => t.name === toolCall.name);
      let toolResultText: string;

      if (tool) {
        try {
          toolResultText = await tool.invoke(toolCall.args as Record<string, unknown>) as string;
          try {
            const parsed = JSON.parse(toolResultText) as ToolExecutionResult;
            if (parsed.actionType) {
              lastActionType = parsed.actionType;
              lastActionPayload = parsed.actionPayload;
            }
            toolResultText = parsed.text;
          } catch { /* keep toolResultText as-is */ }
        } catch (err) {
          toolResultText = `Tool error: ${err instanceof Error ? err.message : String(err)}`;
        }
      } else {
        toolResultText = `Unknown tool: ${toolCall.name}`;
      }

      onEvent?.({ type: 'tool_done', name: toolCall.name });

      messages.push(
        new ToolMessage({
          content: toolResultText,
          tool_call_id: toolCall.id ?? `call_${Date.now()}`,
        }),
      );
    }
  }

  return { reply: 'Request processed.', actionType: lastActionType, actionPayload: lastActionPayload };
}
