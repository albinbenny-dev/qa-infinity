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
import { prisma } from '../lib/prisma.js';
import { addRunJob } from '../lib/queue.js';

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

interface ToolExecutionResult {
  text: string;
  actionType?: string;
  actionPayload?: Record<string, unknown>;
}

interface ScriptRow {
  testCaseId: string | null;
  filename: string;
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

const BASE_SYSTEM_PROMPT = `You are a QA assistant for the Airtel Ventas platform.
You have deep knowledge of the Ventas use cases: Primary Sales, Stock Management,
Dealer Onboarding & KYC, Sales API, Secondary Sales, Distributor API.

Use tools for real actions. Always confirm intent before running tests.
After tool use, summarise the result clearly. Keep responses concise and actionable.

When the user asks to run tests, check what they want (suite, environment) before calling run_tests.
When reporting failures, include the specific TC IDs and error summaries.
Format numbers clearly. Use bullet points for lists.`;

function buildSystemPrompt(memories: string[]): string {
  if (memories.length === 0) return BASE_SYSTEM_PROMPT;
  const memoryBlock = memories.map(m => `- ${m}`).join('\n');
  return `${BASE_SYSTEM_PROMPT}\n\nPersistent memory (facts to always keep in mind):\n${memoryBlock}`;
}

// ── Tool implementations ───────────────────────────────────────────────────

async function toolRunTests(
  projectId: string,
  input: { testCaseIds?: string[]; useCaseTag?: string; environment: string },
): Promise<ToolExecutionResult> {
  const { testCaseIds, useCaseTag, environment } = input;
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

  const rawScripts = await prisma.script.findMany({
    where: { projectId, testCaseId: { in: resolvedIds } },
    select: { testCaseId: true, filename: true },
  });
  const scripts = rawScripts as ScriptRow[];
  const scriptPaths = scripts
    .filter((s: ScriptRow) => s.testCaseId !== null)
    .map((s: ScriptRow) => ({
      testCaseId: s.testCaseId as string,
      scriptPath: `/scripts/${projectId}/${s.filename}`,
    }));

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

  const run = await prisma.run.create({
    data: {
      projectId,
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
  input: { name: string; cronExpression: string; useCaseTag?: string; testCaseIds?: string[]; environment: string },
): Promise<ToolExecutionResult> {
  const { name, cronExpression, useCaseTag, testCaseIds, environment } = input;
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

// ── Tool factory ───────────────────────────────────────────────────────────

function createChatTools(projectId: string): DynamicStructuredTool[] {
  return [
    new DynamicStructuredTool({
      name: 'run_tests',
      description: 'Trigger a test run immediately. Use when the user explicitly asks to run or execute tests.',
      schema: z.object({
        testCaseIds: z.array(z.string()).optional().describe('Specific test case IDs'),
        useCaseTag: z.string().optional().describe('Run all tests in this use-case group (e.g. "Primary Sales")'),
        environment: z.string().describe('Target environment: Dev, QA, Staging, or Prod'),
      }),
      func: async (input: { testCaseIds?: string[]; useCaseTag?: string; environment: string }): Promise<string> =>
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
        environment: z.string().describe('Target environment'),
      }),
      func: async (input: { name: string; cronExpression: string; useCaseTag?: string; testCaseIds?: string[]; environment: string }): Promise<string> =>
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
): Promise<ChatAgentResult> {
  const tools = createChatTools(projectId);
  const llm = createLLM({ temperature: 0.3, agentName: 'chat-agent', projectId });

  const llmWithTools = typeof (llm as { bindTools?: (t: unknown) => unknown }).bindTools === 'function'
    ? (llm as { bindTools: (t: DynamicStructuredTool[]) => typeof llm }).bindTools(tools)
    : llm;

  const historyMessages: BaseMessage[] = history.slice(-20).map((m: ChatHistoryMessage) =>
    m.role === 'user' ? new HumanMessage(m.content) : new AIMessage(m.content),
  );

  const messages: BaseMessage[] = [
    new SystemMessage(buildSystemPrompt(memories)),
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
