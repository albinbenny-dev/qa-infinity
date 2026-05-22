import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import { createLLM } from '../lib/llm.js';

export interface ScriptAgentInput {
  testCase: {
    id: string;
    tcId: string;
    title: string;
    description?: string | null;
    steps: string; // JSON-encoded string[]
    expectedResult: string;
    type: string;
    useCaseTag?: string | null;
  };
  project: {
    name: string;
    baseUrl?: string | null;
  };
  existingPOMs: string[]; // filenames of already-generated POM classes
}

export interface ScriptAgentResult {
  specContent: string;
  pomContent?: string;
  pomFilename?: string;
}

const SYSTEM_PROMPT = `You are a senior QA automation engineer for the Airtel Ventas platform.
Generate a production-ready Playwright TypeScript test using @playwright/test
for the Airtel Ventas platform (baseUrl: {BASE_URL}).
Page Object Model pattern required. Import POMs from ./pages/.
Locator priority: getByRole > getByLabel > getByTestId > CSS > XPath.
Use page.goto('/ventas/...') for navigation — preserve Ventas URL patterns.
Return ONLY raw TypeScript — no markdown fences, no explanations.

Output format — use these exact separators:
===SPEC===
<content of the .spec.ts file>
===POM===
<PomClassName>.ts:<content of the Page Object Model class>

If a suitable POM already exists (listed in existingPOMs), skip the ===POM=== section entirely.
The spec file must import from '@playwright/test', include a test.describe block,
use async/await, and handle assertions with expect().`;

export async function runScriptAgent(input: ScriptAgentInput): Promise<ScriptAgentResult> {
  const llm = createLLM({ temperature: 0.1 });

  const baseUrl = input.project.baseUrl ?? 'http://localhost:3000';
  const systemPrompt = SYSTEM_PROMPT.replace('{BASE_URL}', baseUrl);

  const steps = parseJsonArray(input.testCase.steps);
  const pomListText =
    input.existingPOMs.length > 0
      ? `\nExisting POMs (do NOT regenerate): ${input.existingPOMs.join(', ')}`
      : '\nNo existing POMs yet — generate one if needed.';

  const userPrompt = [
    `Project: ${input.project.name}`,
    `Base URL: ${baseUrl}`,
    pomListText,
    '',
    'Test Case:',
    `  ID:          ${input.testCase.tcId}`,
    `  Title:       ${input.testCase.title}`,
    `  Type:        ${input.testCase.type}`,
    `  Use Case:    ${input.testCase.useCaseTag ?? 'General'}`,
    `  Description: ${input.testCase.description ?? '(none)'}`,
    '',
    'Steps:',
    ...steps.map((s, i) => `  ${i + 1}. ${s}`),
    '',
    `Expected Result: ${input.testCase.expectedResult}`,
  ].join('\n');

  const response = await llm.invoke([new SystemMessage(systemPrompt), new HumanMessage(userPrompt)]);

  const content =
    typeof response.content === 'string' ? response.content : JSON.stringify(response.content);

  return parseAgentOutput(content);
}

function parseJsonArray(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

function parseAgentOutput(raw: string): ScriptAgentResult {
  const specIdx = raw.indexOf('===SPEC===');
  const pomIdx = raw.indexOf('===POM===');

  let specContent: string;

  if (specIdx !== -1) {
    const specEnd = pomIdx !== -1 ? pomIdx : raw.length;
    specContent = raw.slice(specIdx + '===SPEC==='.length, specEnd).trim();
  } else {
    // Fallback: strip any accidental markdown fences
    specContent = raw
      .replace(/^```(?:typescript|ts)?\s*/im, '')
      .replace(/```\s*$/im, '')
      .trim();
  }

  if (pomIdx === -1) {
    return { specContent };
  }

  const pomRaw = raw.slice(pomIdx + '===POM==='.length).trim();
  const colonIdx = pomRaw.indexOf(':');
  if (colonIdx === -1) {
    return { specContent };
  }

  const pomFilename = pomRaw.slice(0, colonIdx).trim();
  const pomContent = pomRaw.slice(colonIdx + 1).trim();

  if (!pomFilename || !pomContent) {
    return { specContent };
  }

  return { specContent, pomContent, pomFilename };
}
