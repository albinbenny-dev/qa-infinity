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
import type { Page } from 'playwright-core';
import { createLLM } from '../lib/llm.js';
import {
  compressScreenshot,
  hasPageChangedSignificantly,
  jpegDataPrefix,
} from '../lib/imageOptimizer.js';
import type {
  RecordedAction,
  BrowserAgentResult,
  AgentFinishData,
  SelectorType,
  LoginInstructions,
} from '../types/scanner.js';

// ── Types ──────────────────────────────────────────────────────────────────

export interface BrowserAgentOptions {
  page: Page;
  baseUrl: string;
  targetUrl: string;
  menuContext: string;
  testGoal: string;
  seedSteps?: string[];
  additionalContext?: string;
  projectId: string;
  onStep: (step: RecordedAction) => Promise<void>;
}

export interface GeneratedAgentTC {
  title: string;
  description: string;
  steps: string[];
  expectedResult: string;
  type: 'UI';
  priority: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  useCaseTag: string;
  generationHints: string;
}

// ── System prompt ──────────────────────────────────────────────────────────

function buildSystemPrompt(opts: BrowserAgentOptions): string {
  const parts = [
    `You are a senior QA engineer with direct control of a real web browser.`,
    ``,
    `Your goal is to trace the UI flow for: "${opts.testGoal}"`,
    `You are on the page: "${opts.menuContext}" (${opts.targetUrl})`,
    ``,
    `SCOPE: Only interact with elements on this page and any modals/dialogs it opens.`,
    `Do NOT navigate to other main sections of the application.`,
  ];

  if (opts.seedSteps && opts.seedSteps.length > 0) {
    parts.push(``, `User-provided steps to guide this trace (follow these, capturing real selectors):`);
    opts.seedSteps.forEach((s, i) => parts.push(`${i + 1}. ${s}`));
  }

  if (opts.additionalContext) {
    parts.push(``, `Additional context: ${opts.additionalContext}`);
  }

  parts.push(
    ``,
    `Rules:`,
    `- Prefer semantic selectors: role > label > text > testid > placeholder > css`,
    `- After any form submit or navigation action, add assert_visible to confirm the result`,
    `- If a tool call fails, try a different selectorType (e.g. switch from css to text or role)`,
    `- Call finish_recording when the goal is achieved or you are fully blocked`,
    `- Maximum 20 actions — call finish_recording before hitting this limit`,
    `- Keep stepDescription short and human-readable (they become test case steps)`,
  );

  return parts.join('\n');
}

// ── Playwright locator builder ─────────────────────────────────────────────

function buildPlaywrightLocator(page: Page, selector: string, selectorType: SelectorType) {
  switch (selectorType) {
    case 'role':        return page.getByRole(selector as Parameters<typeof page.getByRole>[0]);
    case 'label':       return page.getByLabel(selector);
    case 'text':        return page.getByText(selector, { exact: false });
    case 'testid':      return page.getByTestId(selector);
    case 'placeholder': return page.getByPlaceholder(selector);
    default:            return page.locator(selector);
  }
}

// ── Tool executor ──────────────────────────────────────────────────────────

async function executeToolCall(
  page: Page,
  toolName: string,
  toolInput: Record<string, unknown>,
): Promise<{ success: boolean; error?: string }> {
  try {
    const selector = toolInput['selector'] as string | undefined ?? '';
    const selectorType = (toolInput['selectorType'] as SelectorType | undefined) ?? 'css';

    switch (toolName) {
      case 'click': {
        const locator = buildPlaywrightLocator(page, selector, selectorType);
        await locator.first().click({ timeout: 10000 });
        await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => undefined);
        break;
      }
      case 'fill': {
        const locator = buildPlaywrightLocator(page, selector, selectorType);
        await locator.first().fill((toolInput['value'] as string) ?? '', { timeout: 10000 });
        break;
      }
      case 'navigate': {
        const path = toolInput['path'] as string;
        const target = path.startsWith('http') ? path : new URL(path, page.url()).href;
        await page.goto(target, { waitUntil: 'domcontentloaded', timeout: 20000 });
        await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => undefined);
        break;
      }
      case 'assert_visible': {
        const locator = buildPlaywrightLocator(page, selector, selectorType);
        await locator.first().waitFor({ state: 'visible', timeout: 10000 });
        break;
      }
      case 'assert_text': {
        const locator = buildPlaywrightLocator(page, selector, selectorType);
        const text = await locator.first().textContent({ timeout: 10000 }) ?? '';
        const expected = (toolInput['expectedText'] as string) ?? '';
        if (!text.includes(expected)) {
          return { success: false, error: `Expected text "${expected}" but got "${text.slice(0, 100)}"` };
        }
        break;
      }
      case 'scroll': {
        const direction = toolInput['direction'] as string;
        const pixels = (toolInput['pixels'] as number) ?? 300;
        if (direction === 'top' || direction === 'up') {
          const scrollY = direction === 'top' ? 0 : -pixels;
          await page.evaluate((y: number) => window.scrollBy(0, y), scrollY);
        } else {
          const scrollY = direction === 'bottom' ? document.body?.scrollHeight ?? 9999 : pixels;
          await page.evaluate((y: number) => window.scrollBy(0, y), scrollY);
        }
        break;
      }
      case 'wait_for_element': {
        const locator = buildPlaywrightLocator(page, selector, selectorType);
        await locator.first().waitFor({ state: 'visible', timeout: (toolInput['timeoutMs'] as number) ?? 5000 });
        break;
      }
    }
    return { success: true };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// ── DOM excerpt helper ─────────────────────────────────────────────────────

async function getCompactDomExcerpt(page: Page): Promise<string> {
  // Inline function only — avoids esbuild __name injection issues with page.evaluate
  return page.evaluate(function() {
    const items: string[] = [];
    const seen = new Set<string>();
    const els = document.querySelectorAll<HTMLElement>(
      'button, input:not([type="hidden"]), select, textarea, a[href], [role="button"], [role="link"], [role="menuitem"], [role="tab"], [role="option"]',
    );
    els.forEach(function(el) {
      const tag = el.tagName.toLowerCase();
      const role = el.getAttribute('role') || tag;
      const rawText = (el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 60);
      const ariaLabel = el.getAttribute('aria-label') || '';
      const placeholder = (el as HTMLInputElement).placeholder || '';
      const testid = el.getAttribute('data-testid') || '';
      const label = ariaLabel || placeholder || rawText;
      if (!label || seen.has(role + ':' + label)) return;
      seen.add(role + ':' + label);
      const hint = testid ? '[data-testid="' + testid + '"]' : label;
      items.push('[' + role + '] ' + label + ' | ' + hint);
    });
    return items.slice(0, 50).join('\n');
  }) as Promise<string>;
}

// ── Tool definitions ───────────────────────────────────────────────────────

const SELECTOR_TYPES = ['css', 'text', 'role', 'label', 'testid', 'placeholder'] as const;

function createBrowserTools(): DynamicStructuredTool[] {
  return [
    new DynamicStructuredTool({
      name: 'click',
      description: 'Click an element. Prefer getByRole/getByLabel/getByText over CSS selectors.',
      schema: z.object({
        selector: z.string().describe('The selector value'),
        selectorType: z.enum(SELECTOR_TYPES).describe('How to locate the element'),
        stepDescription: z.string().describe('Human-readable step for test case'),
      }),
      func: async () => 'ok',
    }),
    new DynamicStructuredTool({
      name: 'fill',
      description: 'Fill an input or textarea.',
      schema: z.object({
        selector: z.string(),
        selectorType: z.enum(SELECTOR_TYPES),
        value: z.string().describe('Text to type into the field'),
        stepDescription: z.string(),
      }),
      func: async () => 'ok',
    }),
    new DynamicStructuredTool({
      name: 'navigate',
      description: 'Navigate to a URL path (relative like /#/orders/new or absolute).',
      schema: z.object({
        path: z.string().describe('URL or relative path'),
      }),
      func: async () => 'ok',
    }),
    new DynamicStructuredTool({
      name: 'assert_visible',
      description: 'Assert an element is visible (use after actions to verify outcomes).',
      schema: z.object({
        selector: z.string(),
        selectorType: z.enum(SELECTOR_TYPES),
        stepDescription: z.string().describe('What is being verified'),
      }),
      func: async () => 'ok',
    }),
    new DynamicStructuredTool({
      name: 'assert_text',
      description: 'Assert an element contains specific text.',
      schema: z.object({
        selector: z.string(),
        selectorType: z.enum(SELECTOR_TYPES),
        expectedText: z.string(),
      }),
      func: async () => 'ok',
    }),
    new DynamicStructuredTool({
      name: 'scroll',
      description: 'Scroll the page.',
      schema: z.object({
        direction: z.enum(['down', 'up', 'top', 'bottom']),
        pixels: z.number().optional().describe('Pixels to scroll (for up/down)'),
      }),
      func: async () => 'ok',
    }),
    new DynamicStructuredTool({
      name: 'wait_for_element',
      description: 'Wait for an element to appear (for dynamic content, modals, loading states).',
      schema: z.object({
        selector: z.string(),
        selectorType: z.enum(SELECTOR_TYPES),
        timeoutMs: z.number().optional().describe('Max wait in ms, default 5000'),
      }),
      func: async () => 'ok',
    }),
    new DynamicStructuredTool({
      name: 'finish_recording',
      description: 'Complete the test trace. Call when the goal is achieved or you are blocked.',
      schema: z.object({
        testTitle: z.string().describe('Short title for the generated test case'),
        expectedResult: z.string().describe('Final expected outcome description'),
        status: z.enum(['success', 'blocked']),
        blockedReason: z.string().optional(),
      }),
      func: async () => 'ok',
    }),
  ];
}

// ── Script generation (deterministic, no LLM) ─────────────────────────────

function buildLocatorCode(action: RecordedAction): string {
  const sel = JSON.stringify(action.selector ?? '');
  switch (action.selectorType) {
    case 'role':        return `page.getByRole(${sel})`;
    case 'label':       return `page.getByLabel(${sel})`;
    case 'text':        return `page.getByText(${sel})`;
    case 'testid':      return `page.getByTestId(${sel})`;
    case 'placeholder': return `page.getByPlaceholder(${sel})`;
    default:            return `page.locator(${sel})`;
  }
}

function actionToLine(action: RecordedAction): string {
  const comment = action.stepDescription ? ` // ${action.stepDescription}` : '';
  const loc = buildLocatorCode(action);
  switch (action.toolName) {
    case 'click':          return `  await ${loc}.first().click();${comment}`;
    case 'fill':           return `  await ${loc}.first().fill(${JSON.stringify(action.value ?? '')});${comment}`;
    case 'navigate':       return `  await page.goto(${JSON.stringify(action.path ?? '/')});${comment}`;
    case 'assert_visible': return `  await expect(${loc}.first()).toBeVisible();${comment}`;
    case 'assert_text':    return `  await expect(${loc}.first()).toContainText(${JSON.stringify(action.expectedText ?? '')});${comment}`;
    case 'scroll':         return action.direction === 'up' || action.direction === 'top'
      ? `  await page.evaluate(() => window.scrollTo(0, 0));${comment}`
      : `  await page.mouse.wheel(0, ${action.pixels ?? 300});${comment}`;
    case 'wait_for_element': return `  await ${loc}.first().waitFor({ state: 'visible', timeout: ${action.timeoutMs ?? 5000} });${comment}`;
    default:               return '';
  }
}

function buildLoginLines(login: LoginInstructions): string[] {
  const lines: string[] = [];
  for (const step of login.steps) {
    if (!step.selector) continue;
    if (step.action === 'fill') {
      const isPassword = step.description.toLowerCase().includes('password');
      const val = isPassword ? `process.env.TC_PASSWORD ?? ''` : `process.env.TC_USERNAME ?? ''`;
      lines.push(`  await page.locator(${JSON.stringify(step.selector)}).first().fill(${val});`);
    } else if (step.action === 'click') {
      lines.push(`  await page.locator(${JSON.stringify(step.selector)}).first().click();`);
    }
  }
  lines.push(`  await page.waitForLoadState('networkidle', { timeout: 15000 });`);
  return lines;
}

export function actionLogToPlaywrightScript(
  actions: RecordedAction[],
  finish: AgentFinishData,
  loginInstructions: LoginInstructions,
  targetUrl: string,
): string {
  const loginLines = buildLoginLines(loginInstructions);
  const testLines = actions
    .filter(a => a.success && a.toolName !== 'finish_recording')
    .map(actionToLine)
    .filter(Boolean);

  const title = finish.testTitle.replace(/'/g, "\\'");
  return [
    `import { test, expect } from '@playwright/test';`,
    ``,
    `test('${title}', async ({ page }) => {`,
    `  await page.goto('/');`,
    ...loginLines,
    `  await page.goto(${JSON.stringify(targetUrl)});`,
    ``,
    ...testLines,
    ``,
    `  // Expected: ${finish.expectedResult}`,
    `});`,
  ].join('\n');
}

export function actionLogToTestCases(
  actions: RecordedAction[],
  finish: AgentFinishData,
  menuContext: string,
): GeneratedAgentTC[] {
  const successful = actions.filter(a => a.success && a.toolName !== 'finish_recording');
  const steps = successful.map(a => a.stepDescription ?? `${a.toolName} ${a.selector ?? ''}`.trim());
  const hints = successful
    .filter(a => a.selector)
    .map(a => `${a.stepDescription ?? a.toolName}: ${a.selectorType ?? 'css'}=${a.selector}`)
    .join('; ');

  return [{
    title: finish.testTitle,
    description: `Agentic trace of "${menuContext}" — verified flow captured by browser agent`,
    steps,
    expectedResult: finish.expectedResult,
    type: 'UI',
    priority: 'HIGH',
    useCaseTag: menuContext,
    generationHints: hints,
  }];
}

// ── LLM-powered multi-scenario test case analysis ─────────────────────────

export async function analyzeTraceToTestCases(
  actions: RecordedAction[],
  finish: AgentFinishData,
  menuContext: string,
  testGoal: string,
  loginInstructions: LoginInstructions,
  projectId: string,
): Promise<GeneratedAgentTC[]> {
  const llm = createLLM({ temperature: 0, agentName: 'tc-analyzer', projectId });

  // Build human-readable login steps from stored instructions
  const loginStepLines: string[] = [];
  if (loginInstructions.steps.length > 0) {
    [...loginInstructions.steps]
      .sort((a, b) => a.order - b.order)
      .forEach((s, i) => loginStepLines.push(`${i + 1}. ${s.description}`));
  } else {
    loginStepLines.push(
      '1. Navigate to the application login page',
      '2. Enter valid username in the username field',
      '3. Enter valid password in the password field',
      '4. Click the Login / Submit button',
      '5. Verify the dashboard or home page loads successfully',
    );
  }

  const successful = actions.filter(a => a.success && a.toolName !== 'finish_recording');
  const traceLines = successful.map(a => {
    const sel = a.selector ? ` | ${a.selectorType ?? 'css'}="${a.selector}"` : '';
    return `Step ${a.stepNumber}: [${a.toolName}] ${a.stepDescription ?? ''}${sel}`;
  });

  const systemPrompt = `You are a senior QA engineer expert in test case design.
Analyse a browser recording and produce a structured set of test cases.

OUTPUT: Return ONLY a valid JSON array — no markdown code fences, no commentary.

Each element must match this shape exactly:
{
  "title": "string — Verb + Feature + Condition, e.g. 'Create Project - Happy Path'",
  "description": "string — one sentence stating what this test verifies",
  "steps": ["string", ...],
  "expectedResult": "string — specific, observable outcome",
  "priority": "HIGH" | "MEDIUM" | "LOW",
  "useCaseTag": "string — feature group, e.g. 'Project Creation'",
  "generationHints": "string — semicolon-separated 'step desc: selectorType=selector' entries"
}

RULES:
1. Generate 3–8 test cases covering distinct scenarios.
2. EVERY test case steps array MUST begin with the login steps provided (copy them verbatim).
3. Happy path: reproduce ALL successful trace steps after login.
4. Validation tests: steps that attempt to submit / proceed with missing or invalid required fields.
5. Negative tests: empty states, cancel flows, duplicate entries, unauthorised scenarios inferred from context.
6. Titles MUST NOT repeat the user's original goal text — write concise action-based titles.
7. useCaseTag groups related TCs (e.g. "Project Creation", "Form Validation").
8. generationHints: include trace selectors relevant to this TC so script generation can reuse them.
9. Steps must be natural-language instructions readable by a manual QA tester — no code.`;

  const userContent = `## Test Goal
${testGoal}

## Page / Feature Under Test
${menuContext}

## Login Steps (MUST appear verbatim at the start of every test case's steps array)
${loginStepLines.join('\n')}

## Recorded Browser Trace (${successful.length} successful steps with verified selectors)
${traceLines.join('\n')}

## Trace Outcome
Status: ${finish.status}
Agent expected result: ${finish.expectedResult}${finish.blockedReason ? `\nBlocked reason: ${finish.blockedReason}` : ''}

Generate comprehensive test cases. Infer validation and negative scenarios from forms, buttons, and interactions visible in the trace.`;

  try {
    const response = await llm.invoke([
      new SystemMessage(systemPrompt),
      new HumanMessage(userContent),
    ]) as { content: unknown };

    const raw = typeof response.content === 'string' ? response.content : '';
    // Strip markdown code fences if the model included them
    const cleaned = raw.replace(/```(?:json)?\n?/g, '').trim();
    const jsonMatch = cleaned.match(/\[[\s\S]*\]/);
    if (!jsonMatch) throw new Error('No JSON array in LLM response');

    const parsed = JSON.parse(jsonMatch[0]) as Array<{
      title?: string;
      description?: string;
      steps?: unknown;
      expectedResult?: string;
      priority?: string;
      useCaseTag?: string;
      generationHints?: string;
    }>;

    if (!Array.isArray(parsed) || parsed.length === 0) throw new Error('Empty array returned');

    const VALID_PRIORITIES = new Set(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']);

    return parsed.map(tc => ({
      title: tc.title ?? menuContext,
      description: tc.description ?? '',
      steps: Array.isArray(tc.steps) ? (tc.steps as string[]) : [],
      expectedResult: tc.expectedResult ?? finish.expectedResult,
      type: 'UI' as const,
      priority: (VALID_PRIORITIES.has(tc.priority ?? '') ? tc.priority : 'MEDIUM') as GeneratedAgentTC['priority'],
      useCaseTag: tc.useCaseTag ?? menuContext,
      generationHints: tc.generationHints ?? '',
    }));
  } catch (err) {
    console.warn('[analyzeTraceToTestCases] LLM analysis failed, falling back to deterministic:', (err as Error).message);
    return actionLogToTestCases(actions, finish, menuContext);
  }
}

// ── Main agent loop ────────────────────────────────────────────────────────

export async function runBrowserAgent(opts: BrowserAgentOptions): Promise<BrowserAgentResult> {
  const { page, projectId, onStep } = opts;
  const llm = createLLM({ temperature: 0, agentName: 'browser-agent', projectId });
  const tools = createBrowserTools();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const llmWithTools = typeof (llm as any).bindTools === 'function'
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ? (llm as any).bindTools(tools)
    : llm;

  // ── Optimisation: prompt caching on system message ──
  // The system prompt is identical on every loop iteration (same test goal, same rules).
  // By tagging it with cache_control, Anthropic caches it server-side and charges only
  // 10% of normal input price for it on steps 2–20.
  // For OpenRouter: caching is automatic — this content array form is safe to pass through.
  const systemPromptText = buildSystemPrompt(opts);
  const systemMsg = new SystemMessage({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    content: [{ type: 'text', text: systemPromptText, cache_control: { type: 'ephemeral' } }] as any,
  });

  // history accumulates AIMessages + ToolMessages only (NOT human messages with screenshots)
  // this keeps each LLM call to a fixed cost regardless of step count
  const history: BaseMessage[] = [];

  const actions: RecordedAction[] = [];
  let finishData: AgentFinishData | null = null;
  let stepNumber = 0;
  const MAX_STEPS = 20;

  // Track previous raw PNG for pixel-diff comparison (diff runs on raw; we compress for LLM)
  let prevRawBuf: Buffer | null = null;

  while (stepNumber < MAX_STEPS && !finishData) {
    const rawBuf = await page.screenshot({ type: 'png', fullPage: false });
    const currentUrl = page.url();
    const domExcerpt = await getCompactDomExcerpt(page).catch(() => '(DOM unavailable)');

    const actionSummary = actions.length > 0
      ? actions.map(a =>
          `${a.stepNumber}. [${a.toolName}] ${a.stepDescription ?? ''} — ${a.success ? 'OK' : 'FAILED: ' + (a.errorMessage ?? '')}`,
        ).join('\n')
      : 'No actions taken yet.';

    // ── Optimisation 1: pixel diff — skip screenshot when page is visually unchanged ──
    // Only applies after the first step and only when the last action was a pure
    // assertion (assert_visible / assert_text) that cannot change the DOM.
    const lastAction = actions.at(-1);
    const lastWasAssertion = lastAction?.toolName === 'assert_visible' || lastAction?.toolName === 'assert_text';
    const pageUnchanged = prevRawBuf !== null && lastWasAssertion
      ? !(await hasPageChangedSignificantly(prevRawBuf, rawBuf))
      : false;

    // ── Optimisation 2: compress PNG → JPEG at 1024px wide, quality 60 ──
    // ~85–92% fewer image tokens vs raw PNG with no accuracy loss.
    const imageContent = pageUnchanged
      ? null
      : await compressScreenshot(rawBuf).then(jpeg => ({
          type: 'image_url' as const,
          image_url: { url: `${jpegDataPrefix()}${jpeg.toString('base64')}` },
        }));

    prevRawBuf = rawBuf;

    // Build human message — image omitted when page is visually unchanged
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const msgContent: any[] = [];
    if (imageContent) {
      msgContent.push(imageContent);
    } else {
      msgContent.push({
        type: 'text',
        text: '[Screenshot omitted — page appearance unchanged from previous step]',
      });
    }
    msgContent.push({
      type: 'text',
      text: `Current URL: ${currentUrl}\n\nInteractive elements:\n${domExcerpt}\n\nActions taken (${actions.length}):\n${actionSummary}`,
    });

    const humanMsg = new HumanMessage({ content: msgContent });

    const messages: BaseMessage[] = [systemMsg, ...history, humanMsg];

    const response = await llmWithTools.invoke(messages) as AIMessage & {
      tool_calls?: Array<{ id: string; name: string; args: Record<string, unknown> }>;
    };
    history.push(response);

    const toolCalls = response.tool_calls;
    if (!toolCalls || toolCalls.length === 0) {
      finishData = {
        testTitle: `Agentic trace: ${opts.menuContext}`,
        expectedResult: 'Steps recorded up to this point',
        status: 'blocked',
        blockedReason: 'Agent stopped without calling finish_recording',
      };
      break;
    }

    for (const toolCall of toolCalls) {
      if (toolCall.name === 'finish_recording') {
        finishData = toolCall.args as AgentFinishData;
        history.push(new ToolMessage({
          content: 'Recording finished.',
          tool_call_id: toolCall.id ?? `call_${Date.now()}`,
        }));
        break;
      }

      const result = await executeToolCall(page, toolCall.name, toolCall.args);
      stepNumber++;

      const action: RecordedAction = {
        stepNumber,
        toolName: toolCall.name,
        selector: toolCall.args['selector'] as string | undefined,
        selectorType: toolCall.args['selectorType'] as SelectorType | undefined,
        value: toolCall.args['value'] as string | undefined,
        path: toolCall.args['path'] as string | undefined,
        direction: toolCall.args['direction'] as string | undefined,
        timeoutMs: toolCall.args['timeoutMs'] as number | undefined,
        expectedText: toolCall.args['expectedText'] as string | undefined,
        stepDescription: toolCall.args['stepDescription'] as string | undefined,
        success: result.success,
        errorMessage: result.error,
        timestampMs: Date.now(),
      };
      actions.push(action);
      await onStep(action).catch(console.error);

      const toolResultText = result.success
        ? 'Action succeeded.'
        : `Action FAILED: ${result.error ?? 'unknown error'}. Try a different selectorType (e.g., switch from css to text or role), or use wait_for_element first if the element is not yet visible.`;

      history.push(new ToolMessage({
        content: toolResultText,
        tool_call_id: toolCall.id ?? `call_${Date.now()}`,
      }));

      if (finishData) break;
    }
  }

  if (!finishData) {
    finishData = {
      testTitle: `Agentic trace: ${opts.menuContext}`,
      expectedResult: 'Test steps recorded up to step limit',
      status: 'blocked',
      blockedReason: `Reached maximum step limit (${MAX_STEPS})`,
    };
  }

  return { actions, finish: finishData, totalSteps: stepNumber };
}
