import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import { createLLM } from '../lib/llm.js';

export type HealType = 'SELECTOR' | 'FLOW' | 'API_SCHEMA';

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
  confidence: number; // 0–100
  summary: string;
}

const SYSTEM_PROMPT = `You are a senior QA automation engineer for the Airtel Ventas platform.
A Playwright test has failed. Analyse the error, classify the failure type, and produce a minimal patch.

Failure types:
  SELECTOR   — a locator (getByRole, getByLabel, getByTestId, CSS, XPath) did not find the element.
               Fix by correcting or replacing the selector using Playwright best-practice priority.
  FLOW       — unexpected navigation, page state, timeout, or missing assertion.
               Fix by adjusting waits, navigation paths, or assertion logic.
  API_SCHEMA — a network/API response body or status mismatch caused the test to fail.
               Fix by updating expected values or adding appropriate guards.

Rules:
- Return the ENTIRE patched script — not just the changed lines.
- Use Playwright TypeScript (@playwright/test). Page Object Model pattern.
- Locator priority: getByRole > getByLabel > getByTestId > CSS > XPath.
- Preserve the original test intent and structure.
- Keep confidence between 0 and 100. Be honest — if you are guessing, lower the score.

Output format (use these exact separators, no markdown fences):
===TYPE===
SELECTOR|FLOW|API_SCHEMA
===CONFIDENCE===
0-100
===SUMMARY===
One sentence describing what was wrong and what was changed.
===PATCHED===
<full patched script content>`;

function classifyFromError(errorMessage: string): HealType {
  const msg = errorMessage.toLowerCase();
  if (
    msg.includes('locator') ||
    msg.includes('selector') ||
    msg.includes('getbyrole') ||
    msg.includes('getbylabel') ||
    msg.includes('getbytestid') ||
    msg.includes('element') ||
    msg.includes('waiting for') ||
    msg.includes('strict mode violation') ||
    msg.includes('not found')
  ) return 'SELECTOR';
  if (
    msg.includes('status') ||
    msg.includes('response') ||
    msg.includes('json') ||
    msg.includes('schema') ||
    msg.includes('network') ||
    msg.includes('fetch') ||
    msg.includes('api')
  ) return 'API_SCHEMA';
  return 'FLOW';
}

export async function runHealingAgent(input: HealingAgentInput): Promise<HealingAgentResult> {
  const llm = createLLM({ temperature: 0.1 });

  const userPrompt = `Project: ${input.project.name}
Base URL: ${input.project.baseUrl ?? 'http://localhost:3000'}
Test Case: ${input.runResult.testCaseName}
Script File: ${input.runResult.scriptFilename}

ERROR MESSAGE:
${input.runResult.errorMessage ?? 'Unknown error'}

ORIGINAL SCRIPT:
${input.runResult.scriptContent}`;

  const response = await llm.invoke([
    new SystemMessage(SYSTEM_PROMPT),
    new HumanMessage(userPrompt),
  ]);

  const raw = typeof response.content === 'string' ? response.content : JSON.stringify(response.content);

  const typeMatch = raw.match(/===TYPE===\s*(SELECTOR|FLOW|API_SCHEMA)/);
  const confMatch = raw.match(/===CONFIDENCE===\s*(\d+)/);
  const summaryMatch = raw.match(/===SUMMARY===\s*([\s\S]*?)(?====PATCHED===)/);
  const patchedMatch = raw.match(/===PATCHED===\s*([\s\S]+)$/);

  const type: HealType = (typeMatch?.[1] as HealType) ?? classifyFromError(input.runResult.errorMessage ?? '');
  const confidence = confMatch ? Math.min(100, Math.max(0, parseInt(confMatch[1], 10))) : 50;
  const summary = summaryMatch?.[1]?.trim() ?? 'AI generated a patch for the failing test.';
  const patchedCode = patchedMatch?.[1]?.trim() ?? input.runResult.scriptContent;

  return { type, patchedCode, confidence, summary };
}
