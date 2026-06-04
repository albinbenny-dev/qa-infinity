import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import { createLLM } from '../lib/llm.js';

export type HealType = 'SELECTOR' | 'FLOW' | 'API_SCHEMA' | 'MISSING_MODULE';

// ── Chain A: Classifier ────────────────────────────────────────────────────

export interface ClassifierInput {
  errorMessage: string;
  stackTrace?: string;
  scriptContent: string;
}

export interface ClassifierResult {
  type: HealType;
  confidence: number; // 0–100
  reasoning: string;
}

const CLASSIFIER_SYSTEM = `You are a senior QA engineer. Classify a Playwright test failure into exactly one type.

Failure types:
  SELECTOR       — a DOM locator did not find the element (wrong role, text, testid, CSS, or XPath selector).
  FLOW           — unexpected navigation, missing wait, timeout, or test assertion mismatch.
  API_SCHEMA     — a network/API response body, status code, or JSON schema mismatch.
  MISSING_MODULE — the test imports from ./pages/ but the module file does not exist on disk.

Respond with ONLY valid JSON — no markdown fences, no extra text:
{"type":"SELECTOR"|"FLOW"|"API_SCHEMA"|"MISSING_MODULE","confidence":0-100,"reasoning":"one concise sentence"}`;

export async function runClassifier(input: ClassifierInput): Promise<ClassifierResult> {
  if (isMissingModuleError(input.errorMessage, input.scriptContent)) {
    return {
      type: 'MISSING_MODULE',
      confidence: 98,
      reasoning: 'Script imports a ./pages/ module that does not exist on disk.',
    };
  }

  const llm = createLLM({ temperature: 0.1, agentName: 'healing-agent' });

  const userContent = `ERROR:\n${input.errorMessage}${
    input.stackTrace ? `\n\nSTACK TRACE (first 1000 chars):\n${input.stackTrace.slice(0, 1000)}` : ''
  }\n\nSCRIPT (first 2000 chars):\n${input.scriptContent.slice(0, 2000)}`;

  const response = await llm.invoke([
    new SystemMessage(CLASSIFIER_SYSTEM),
    new HumanMessage(userContent),
  ]);

  const raw = typeof response.content === 'string' ? response.content : JSON.stringify(response.content);

  try {
    const jsonText = raw.replace(/```json\s*/g, '').replace(/```/g, '').trim();
    const parsed = JSON.parse(jsonText) as { type?: string; confidence?: number; reasoning?: string };
    const validTypes: HealType[] = ['SELECTOR', 'FLOW', 'API_SCHEMA', 'MISSING_MODULE'];
    const type: HealType = validTypes.includes(parsed.type as HealType)
      ? (parsed.type as HealType)
      : classifyFromError(input.errorMessage);
    return {
      type,
      confidence: Math.min(100, Math.max(0, Math.round(parsed.confidence ?? 50))),
      reasoning: parsed.reasoning ?? 'AI classified failure type.',
    };
  } catch {
    return {
      type: classifyFromError(input.errorMessage),
      confidence: 40,
      reasoning: 'Classification inferred from error message patterns.',
    };
  }
}

function isMissingModuleError(msg: string, scriptContent?: string): boolean {
  if (msg.includes('Cannot find module') && msg.includes('./pages/')) return true;
  if (msg.includes('No tests ran') && (scriptContent ?? '').includes("from './pages/")) return true;
  // POM method mismatch: method called in spec doesn't exist in the imported POM class
  if (msg.includes('is not a function') && (scriptContent ?? '').includes("from './pages/")) return true;
  return false;
}

function classifyFromError(msg: string): HealType {
  if (isMissingModuleError(msg)) return 'MISSING_MODULE';
  const m = msg.toLowerCase();
  if (
    m.includes('locator') || m.includes('selector') || m.includes('getbyrole') ||
    m.includes('getbylabel') || m.includes('getbytestid') || m.includes('element') ||
    m.includes('waiting for') || m.includes('strict mode violation') || m.includes('not found')
  ) return 'SELECTOR';
  if (
    m.includes('status') || m.includes('response') || m.includes('json') ||
    m.includes('schema') || m.includes('network') || m.includes('fetch') || m.includes('api')
  ) return 'API_SCHEMA';
  return 'FLOW';
}

// ── Trace decision ─────────────────────────────────────────────────────────

export interface TraceDecision {
  needed: boolean;
  reason: string;
}

/**
 * Decides whether the healing agent should launch a live browser trace to
 * diagnose the failure, or whether static analysis (DOM snapshot / error msg)
 * is sufficient.
 *
 * Rules:
 *  MISSING_MODULE → no trace  (structural code issue, browser can't help)
 *  API_SCHEMA     → no trace  (network-level issue)
 *  FLOW           → always trace (need to observe live navigation/timing and detect missing steps)
 *  SELECTOR       → always trace (live DOM gives exact element roles and accessible names)
 */
export function needsAgentTrace(
  classResult: ClassifierResult,
  _selectorTraceThreshold = 60,
): TraceDecision {
  if (classResult.type === 'MISSING_MODULE') {
    return { needed: false, reason: 'Module import issue — no browser trace needed.' };
  }
  if (classResult.type === 'API_SCHEMA') {
    return { needed: false, reason: 'API/network issue — browser trace not applicable.' };
  }
  if (classResult.type === 'FLOW') {
    return {
      needed: true,
      reason: 'Flow failure — live trace will diagnose navigation, timing, or missing prerequisite steps.',
    };
  }
  // SELECTOR: always trace — live DOM gives exact element roles and accessible names,
  // which static snapshots cannot reliably provide for dynamic apps.
  return {
    needed: true,
    reason: 'Selector failure — live trace will capture real DOM selectors and exact element names.',
  };
}

// ── Chain B: Patcher ────────────────────────────────────────────────────────

export interface PatcherInput {
  type: HealType;
  errorMessage: string;
  originalScript: string;
  domSnapshot?: string;
  agentTraceContext?: string; // live browser trace summary (overrides domSnapshot when present)
  projectName: string;
  baseUrl?: string | null;
}

export interface PatcherResult {
  patchedScript: string;
  explanation: string;
  confidence: number; // 0–100
  diffSummary: string;
}

const PATCHER_SYSTEM = `Fix the failing Playwright test. Minimal changes only — change only what is broken.
Selector priority (highest → lowest):
  1. page.getByTestId('…')          — data-testid attributes are added to key elements
  2. page.getByRole('…', { name })  — semantic role + accessible name
  3. page.getByLabel('…')           — form labels
  4. page.locator('.css-class')     — stable CSS class (last resort)
  Never use XPath or positional CSS selectors like nth-child.
If an AGENT TRACE is provided, it shows a live browser session that reproduced the failure.
  Use trace-derived selectors and flow observations as the primary context — they reflect the
  actual live state of the app and are more reliable than a static DOM snapshot.
  IMPORTANT: If the trace includes steps that are ABSENT from the original script (e.g., a
  login flow, an extra navigation, a modal dismissal), INSERT those missing steps into the
  patched script at the correct position before the failing step. The trace represents the
  complete working path — the script must replicate every step the trace took, not just fix
  selectors. Never omit a step the trace performed successfully.
If only a DOM snapshot is provided, use it to identify the correct selectors.
The project name and base URL are provided in the user message — use them as context.
Keep all test logic, describe blocks, and assertions intact.
Explain changes in plain English.

Output format — use these exact separators, no markdown fences:
===CONFIDENCE===
0-100
===EXPLANATION===
Plain English explanation of what was wrong and what changed.
===DIFF_SUMMARY===
One-line summary (e.g., "Updated 3 selectors to use getByTestId").
===PATCHED===
<full patched script — complete, valid TypeScript>`;

const PATCHER_SYSTEM_MISSING_MODULE = `Fix the failing Playwright test by rewriting it as self-contained.
The script imports from ./pages/ but that module does not exist on disk.
Remove all ./pages/ imports and replicate their logic inline in the spec file.
Keep all test.describe structure, test assertions, and test steps intact.
Prefer getByRole/getByLabel/getByTestId over XPath/CSS.

Output format — use these exact separators, no markdown fences:
===CONFIDENCE===
0-100
===EXPLANATION===
Plain English explanation of what was wrong and what changed.
===DIFF_SUMMARY===
One-line summary (e.g., "Inlined LoginPage POM, removed ./pages/ import").
===PATCHED===
<full patched script — complete, valid TypeScript>`;

export async function runPatcher(input: PatcherInput): Promise<PatcherResult> {
  const llm = createLLM({ temperature: 0.1, agentName: 'healing-agent' });

  const userContent = [
    `Project: ${input.projectName}`,
    `Base URL: ${input.baseUrl ?? 'http://localhost:3000'}`,
    `Failure type: ${input.type}`,
    `Error: ${input.errorMessage}`,
    input.agentTraceContext
      ? `\nAGENT TRACE (live browser session that reproduced the failure):\n${input.agentTraceContext.slice(0, 4000)}`
      : input.domSnapshot
      ? `\nDOM SNAPSHOT (interactive elements):\n${input.domSnapshot.slice(0, 3000)}`
      : '',
    `\nORIGINAL SCRIPT:\n${input.originalScript}`,
  ].join('\n');

  const response = await llm.invoke([
    new SystemMessage(input.type === 'MISSING_MODULE' ? PATCHER_SYSTEM_MISSING_MODULE : PATCHER_SYSTEM),
    new HumanMessage(userContent),
  ]);

  const raw = typeof response.content === 'string' ? response.content : JSON.stringify(response.content);

  const confMatch = raw.match(/===CONFIDENCE===\s*(\d+)/);
  const explMatch = raw.match(/===EXPLANATION===\s*([\s\S]*?)(?====DIFF_SUMMARY===)/);
  const diffMatch = raw.match(/===DIFF_SUMMARY===\s*([\s\S]*?)(?====PATCHED===)/);
  const patchedMatch = raw.match(/===PATCHED===\s*([\s\S]+)$/);

  return {
    patchedScript: patchedMatch?.[1]?.trim() ?? input.originalScript,
    explanation: explMatch?.[1]?.trim() ?? 'AI generated a patch for the failing test.',
    confidence: confMatch ? Math.min(100, Math.max(0, parseInt(confMatch[1], 10))) : 50,
    diffSummary: diffMatch?.[1]?.trim() ?? 'Script updated to fix failing test.',
  };
}

// ── Legacy single-call entry point (kept for backward compatibility) ────────

export interface HealingAgentInput {
  runResult: {
    id: string;
    errorMessage: string | null;
    testCaseName: string;
    scriptContent: string;
    scriptFilename: string;
  };
  project: {
    name: string;
    baseUrl?: string | null;
  };
}

export interface HealingAgentResult {
  type: HealType;
  patchedCode: string;
  confidence: number;
  summary: string;
}

export async function runHealingAgent(input: HealingAgentInput): Promise<HealingAgentResult> {
  const classResult = await runClassifier({
    errorMessage: input.runResult.errorMessage ?? 'Unknown error',
    scriptContent: input.runResult.scriptContent,
  });

  const patchResult = await runPatcher({
    type: classResult.type,
    errorMessage: input.runResult.errorMessage ?? 'Unknown error',
    originalScript: input.runResult.scriptContent,
    projectName: input.project.name,
    baseUrl: input.project.baseUrl,
  });

  return {
    type: classResult.type,
    patchedCode: patchResult.patchedScript,
    confidence: patchResult.confidence,
    summary: patchResult.explanation,
  };
}
