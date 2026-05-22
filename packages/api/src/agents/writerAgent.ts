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

const SYSTEM_PROMPT = `You are a senior QA engineer for the Airtel Ventas platform.
Generate targeted test cases from the provided inputs. Maximum 15 test cases total.
Use project library docs as background context.

When UI screenshots are provided, carefully analyse the actual screen:
- Identify every form, input field, button, dropdown, and navigation element visible.
- Derive test cases that cover the visible happy paths, form validations, empty states, and error conditions.
- Note any visible labels, placeholders, or hint text and use them in step descriptions.

For each test case assign a useCaseTag from these Airtel Ventas use case groups:
  'Primary Sales', 'Stock Management', 'Dealer Onboarding & KYC',
  'Sales API', 'Secondary Sales', 'Distributor API'
Create new use case names only if none of the above apply.
Include happy path AND negative/edge cases. Be concise — keep steps and descriptions brief.
Return ONLY a valid JSON array. Each element:
{ title, description, steps: string[], expectedResult, type:'UI'|'API'|'SIT',
  tags: string[], useCaseTag: string, priority:'LOW'|'MEDIUM'|'HIGH'|'CRITICAL', sourceRef: string }
IMPORTANT: Output must be complete, valid JSON. Do not truncate the array.`;

export async function runWriterAgent(input: WriterInput): Promise<WriterResult> {
  const llm = createLLM({ temperature: 0.3 });

  const inputSummary = input.inputs
    .map((inp) => `[${inp.type.toUpperCase()}] ${inp.label}:\n${inp.content.slice(0, 2000)}`)
    .join('\n\n---\n\n');

  const userParts: string[] = [
    `Project: ${input.projectName}`,
    `Test types to generate: ${input.testTypes.join(', ')}`,
  ];

  if (input.additionalContext) {
    userParts.push(`Additional context: ${input.additionalContext}`);
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
