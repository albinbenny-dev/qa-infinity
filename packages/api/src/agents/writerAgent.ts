import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import { z } from 'zod';
import { createLLM } from '../lib/llm.js';
import type { UISnapshot } from '../services/inputAdapters.js';

export interface WriterInput {
  inputs: Array<{ type: string; content: string; label: string }>;
  uiSnapshots?: UISnapshot[];
  projectLibraryContext: string;
  projectName: string;
  testTypes: ('UI' | 'API' | 'SIT')[];
  additionalContext?: string;
  existingUseCaseTags?: string[];
  /** Titles of test cases already saved in the project — writer must not generate duplicates */
  existingTestCaseTitles?: string[];
  projectContextSummary?: string;
  /** Exact number of test cases the agent must produce for this call */
  targetTcCount?: number;
}

const GeneratedTestCaseSchema = z.object({
  title: z.string().min(1),
  description: z.string().optional().default(''),
  steps: z.array(z.string()).min(1),
  expectedResult: z.string().min(1),
  type: z.enum(['UI', 'API', 'SIT']),
  tags: z.array(z.string()).default([]),
  useCaseTag: z.string().min(1),
  priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']),
  sourceRef: z.string().optional().default(''),
});

export type GeneratedTestCase = z.infer<typeof GeneratedTestCaseSchema>;

export interface WriterResult {
  testCases: GeneratedTestCase[];
  duplicatesRemoved: number;
}

const SYSTEM_PROMPT = `You are a senior QA engineer.
Generate test cases from the provided inputs. The caller specifies the TARGET_TC_COUNT; produce exactly that many test cases — no more, no fewer.

PROJECT REQUIREMENT LIBRARY: The prompt includes a section with uploaded requirement docs (BRD, HLD, existing test cases, specs).
Use these as authoritative context — derive test scenarios, acceptance criteria, and business rules directly from them.
If a document already contains test case titles or scenarios, use them as a foundation and expand coverage.

EXISTING TEST CASES: If the prompt contains an EXISTING TEST CASES section, you MUST check every title you plan to generate
against that list. Do NOT generate a test case that is substantially similar (same feature + same action + same outcome)
to any existing one. If all obvious scenarios are already covered, generate tests for edge cases, negative paths, or
combinations not yet represented.

When UI screenshots are provided, carefully analyse the actual screen:
- Identify every form, input field, button, dropdown, and navigation element visible.
- Derive test cases that cover the visible happy paths, form validations, empty states, and error conditions.
- Note any visible labels, placeholders, or hint text and use them in step descriptions.

Coverage strategy — for each use case, ensure:
1. At least one happy-path (end-to-end success) test
2. At least one negative/validation test (invalid input, missing required field, unauthorised access)
3. At least one boundary/edge-case test (empty state, max length, special characters)
4. Any remaining slots filled with functional tests for each distinct action or workflow on the pages

For useCaseTag: always use the use case name supplied in the input exactly as given.

Be concise — keep steps and descriptions brief.
Return ONLY a valid JSON array. Each element:
{ title, description, steps: string[], expectedResult, type:'UI'|'API'|'SIT',
  tags: string[], useCaseTag: string, priority:'LOW'|'MEDIUM'|'HIGH'|'CRITICAL', sourceRef: string }
IMPORTANT: Output must be complete, valid JSON. Do not truncate the array.`;

export async function runWriterAgent(input: WriterInput): Promise<WriterResult> {
  const llm = createLLM({ temperature: 0, agentName: 'writer-agent' });

  const inputSummary = input.inputs
    .map((inp) => `[${inp.type.toUpperCase()}] ${inp.label}:\n${inp.content.slice(0, 2000)}`)
    .join('\n\n---\n\n');

  const targetCount = input.targetTcCount ?? 6;

  const userParts: string[] = [
    `Project: ${input.projectName}`,
    `Test types to generate: ${input.testTypes.join(', ')}`,
    `TARGET_TC_COUNT: ${targetCount} (you must produce exactly ${targetCount} test cases)`,
  ];

  if (input.additionalContext) {
    userParts.push(`Additional context: ${input.additionalContext}`);
  }

  if (input.existingUseCaseTags && input.existingUseCaseTags.length > 0) {
    userParts.push(
      '',
      '=== EXISTING USE CASE TAGS FOR THIS PROJECT (reuse when applicable) ===',
      input.existingUseCaseTags.join(', '),
    );
  }

  if (input.existingTestCaseTitles && input.existingTestCaseTitles.length > 0) {
    userParts.push(
      '',
      '=== EXISTING TEST CASES (DO NOT duplicate — skip any scenario already covered) ===',
      input.existingTestCaseTitles.slice(0, 200).map((t) => `• ${t}`).join('\n'),
    );
  }

  if (input.projectContextSummary) {
    userParts.push(
      '',
      '=== UI CONTEXT (from live scan) ===',
      input.projectContextSummary,
    );
  }

  userParts.push(
    '',
    '=== PROJECT REQUIREMENT LIBRARY ===',
    input.projectLibraryContext
      ? input.projectLibraryContext.slice(0, 8000)
      : '(no library docs configured)',
    '',
    '=== INPUT SOURCES ===',
    inputSummary,
  );

  // Build the human message — multimodal when UI screenshots are present
  const promptText = userParts.join('\n');
  const activeSnapshots = (input.uiSnapshots ?? []).filter((s) => s.screenshotBase64 !== null);

  const humanMessage =
    activeSnapshots.length > 0
      ? new HumanMessage({
          content: [
            ...activeSnapshots.map((snap) => ({
              type: 'image_url' as const,
              image_url: { url: `data:image/png;base64,${snap.screenshotBase64}` },
            })),
            { type: 'text' as const, text: promptText },
          ],
        })
      : new HumanMessage(promptText);

  const response = await llm.invoke([new SystemMessage(SYSTEM_PROMPT), humanMessage]);

  const content =
    typeof response.content === 'string' ? response.content : JSON.stringify(response.content);

  const jsonMatch = content.match(/\[[\s\S]*/);
  if (!jsonMatch) throw new Error('Writer agent did not return a JSON array');

  const raw: unknown[] = extractCompleteObjects(jsonMatch[0]);
  if (raw.length === 0) throw new Error('Writer agent returned no parseable test cases');

  const validated: GeneratedTestCase[] = [];

  for (const item of raw) {
    const parsed = GeneratedTestCaseSchema.safeParse(item);
    if (parsed.success) validated.push(parsed.data);
  }

  const { deduped, removed } = deduplicate(validated);
  return { testCases: deduped, duplicatesRemoved: removed };
}

/**
 * Walks the LLM output character-by-character and extracts every complete
 * JSON object `{...}`, handling nested objects and quoted strings correctly.
 * This means a truncated array (token-limit cut-off) still yields all the
 * objects that were fully emitted before the cut.
 */
function extractCompleteObjects(text: string): unknown[] {
  const objects: unknown[] = [];
  let i = 0;

  while (i < text.length) {
    while (i < text.length && text[i] !== '{') i++;
    if (i >= text.length) break;

    const start = i;
    let depth = 0;
    let inString = false;
    let escaped = false;

    while (i < text.length) {
      const ch = text[i];
      if (escaped) {
        escaped = false;
      } else if (ch === '\\' && inString) {
        escaped = true;
      } else if (ch === '"') {
        inString = !inString;
      } else if (!inString) {
        if (ch === '{') depth++;
        else if (ch === '}') {
          depth--;
          if (depth === 0) {
            try { objects.push(JSON.parse(text.slice(start, i + 1))); } catch { /* malformed */ }
            i++;
            break;
          }
        }
      }
      i++;
    }
  }

  return objects;
}

function jaccard(a: string, b: string): number {
  const normalize = (s: string) =>
    s
      .toLowerCase()
      .replace(/[^a-z0-9 ]/g, '')
      .trim();
  const aWords = new Set(normalize(a).split(/\s+/).filter(Boolean));
  const bWords = new Set(normalize(b).split(/\s+/).filter(Boolean));
  const intersection = [...aWords].filter((w) => bWords.has(w)).length;
  const union = new Set([...aWords, ...bWords]).size;
  return union === 0 ? 0 : intersection / union;
}

function deduplicate(tcs: GeneratedTestCase[]): { deduped: GeneratedTestCase[]; removed: number } {
  const deduped: GeneratedTestCase[] = [];
  let removed = 0;

  for (const tc of tcs) {
    const dupIdx = deduped.findIndex((existing) => jaccard(existing.title, tc.title) > 0.8);
    if (dupIdx >= 0) {
      if (tc.steps.length > deduped[dupIdx].steps.length) {
        deduped[dupIdx] = tc;
      }
      removed++;
    } else {
      deduped.push(tc);
    }
  }

  return { deduped, removed };
}
