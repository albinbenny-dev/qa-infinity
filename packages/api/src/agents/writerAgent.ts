import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import { z } from 'zod';
import { createLLM } from '../lib/llm.js';
import type { UISnapshot } from '../services/inputAdapters.js';

export interface GoldenTestCase {
  tcId: string;
  title: string;
  steps: string[];
  expectedResult: string;
  useCaseTag?: string;
  type?: string;
  priority?: string;
}

export interface SeedTestCase {
  title: string;
  steps: string[];
  expectedResult: string;
  useCaseTag?: string;
  description?: string;
  priority?: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  type?: 'UI' | 'API' | 'SIT';
  preConditions?: string;
  testData?: string;
  notes?: string;
}

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
  /** Approved and verified test cases to use as style and pattern reference */
  goldenTestCases?: GoldenTestCase[];
  /** Seed test cases that must be preserved verbatim — agent only generates gap coverage on top */
  seedTestCases?: SeedTestCase[];
  /** Compact summary of recent approved/auto-applied heals — avoid triggering the same failures */
  healInsights?: string;
  /**
   * Standard Mode enrichment: instead of preserving seeds verbatim and adding gaps,
   * the agent expands every seed TC into detailed, automation-ready steps with
   * generationHints (selector hints for the Script Agent). Outputs exactly one
   * enriched TC per seed — no gap TCs are generated.
   */
  enrichSeeds?: boolean;
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
  generationHints: z.string().optional().default(''),
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

GOLDEN REFERENCE TEST CASES: If the prompt contains a GOLDEN REFERENCE TEST CASES section, these are approved and
successfully executed test cases for this project. Treat them as the single source of truth for:
- Step phrasing style and granularity (imperative, specific, no ambiguity)
- Login and authentication flow (replicate the EXACT step sequence — do not simplify or collapse steps)
- Selector and field terminology used in this specific application
- Expected result format
Every new test case that involves login MUST follow the exact same login step sequence shown in the golden login TC.
If the golden TC shows a two-step login (username submit → password reveal → password submit), ALL your new TCs
that require login must include that same two-step sequence — never collapse it to a single step.

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

SEED TEST CASES: If the prompt contains a SEED TEST CASES section:
- These test cases are LOCKED and will be prepended to the final output automatically by the caller.
- Do NOT regenerate, rewrite, or include them in your JSON response.
- Your job is ONLY to produce the TARGET_TC_COUNT additional gap/supplementary test cases that cover scenarios NOT already present in the seed list.
- Do not repeat any scenario already covered by a seed test case.

PAST HEAL PATTERNS: If the prompt includes a PAST HEAL PATTERNS section, these are real test failures
that were automatically fixed in this project. Use them as signals when writing new test cases:
- SELECTOR failures: the listed UI element had an unstable selector — note it in step descriptions so
  testers can verify the correct element without relying on a fragile locator.
- FLOW failures: timing or navigation was wrong — if writing a test that touches the same feature,
  add a note in the step about waiting for the page to settle before proceeding.
- API_SCHEMA failures: response shape changed — test only stable, documented response fields; avoid
  asserting on implementation-specific or volatile fields.

SEED ENRICHMENT MODE: When the user message contains "=== SEED ENRICHMENT MODE ===", your task changes entirely:
- You are NOT generating new test cases — you are EXPANDING each seed into a detailed, automation-ready TC.
- For each seed, produce one enriched TC (same count in, same count out — no additions, no omissions).
- Enrichment rules:
  1. Keep the title as-is (only minor wording fixes for clarity).
  2. Expand steps into explicit Playwright-automation-ready actions:
     - Begin EVERY TC that requires authentication with the EXACT login sequence from GOLDEN REFERENCE TEST CASES (never skip or collapse login steps).
     - Use imperative, specific actions: "Navigate to [URL]", "Click [element label]", "Enter [value] in [field]", "Verify [condition]".
     - Include navigation steps to reach the feature being tested.
     - Add explicit wait/assertion steps for pages that load dynamically.
  3. Populate generationHints with CSS/ARIA selector hints for critical UI elements in this TC.
     Format: "element label: selector; element label: selector". Example: "username: #username; password: #password; submit: [type=submit]; new-order btn: [data-testid=new-order]".
     Base these on the golden TCs, heal patterns, and any known selectors in the context.
  4. Write a specific, verifiable expectedResult — name the element, message, or page state that confirms success.
  5. Assign correct priority, type, useCaseTag (use seed's tag if provided), and tags.

Be concise — keep steps and descriptions brief.
Return ONLY a valid JSON array. Each element:
{ title, description, steps: string[], expectedResult, type:'UI'|'API'|'SIT',
  tags: string[], useCaseTag: string, priority:'LOW'|'MEDIUM'|'HIGH'|'CRITICAL', sourceRef: string, generationHints: string }
IMPORTANT: Output must be complete, valid JSON. Do not truncate the array.`;

export async function runWriterAgent(input: WriterInput): Promise<WriterResult> {
  const llm = createLLM({ temperature: 0, agentName: 'writer-agent' });

  const inputSummary = input.inputs
    .map((inp) => `[${inp.type.toUpperCase()}] ${inp.label}:\n${inp.content.slice(0, 2000)}`)
    .join('\n\n---\n\n');

  const seedCount = input.seedTestCases?.length ?? 0;
  const enrichMode = input.enrichSeeds === true && seedCount > 0;
  // enrichMode: agent expands seeds, outputs exactly seedCount enriched TCs, no gap TCs.
  // normal seed mode: agent generates gap TCs only; seeds are prepended server-side.
  const gapTargetCount = enrichMode ? seedCount : (seedCount > 0 ? Math.max(1, input.targetTcCount ?? 3) : (input.targetTcCount ?? 6));

  const userParts: string[] = [
    `Project: ${input.projectName}`,
    `Test types to generate: ${input.testTypes.join(', ')}`,
    enrichMode
      ? `TARGET_TC_COUNT: ${gapTargetCount} (SEED ENRICHMENT MODE — enrich exactly ${gapTargetCount} seeds; output one enriched TC per seed in the same order)`
      : seedCount > 0
        ? `TARGET_TC_COUNT: ${gapTargetCount} (generate exactly ${gapTargetCount} NEW gap test cases — the ${seedCount} seed test cases below are already locked and will be included separately; do NOT regenerate them)`
        : `TARGET_TC_COUNT: ${gapTargetCount} (you must produce exactly ${gapTargetCount} test cases)`,
  ];

  if (input.additionalContext) {
    userParts.push(`Additional context: ${input.additionalContext}`);
  }

  if (input.healInsights) {
    userParts.push(
      '',
      '=== PAST HEAL PATTERNS (real failures fixed in this project — avoid triggering the same issues) ===',
      input.healInsights,
    );
  }

  if (seedCount > 0) {
    const seedLines = input.seedTestCases!.map((tc, i) => {
      const lines: string[] = [`[Seed ${i + 1}] ${tc.title}`];
      if (tc.useCaseTag) lines.push(`Use Case: ${tc.useCaseTag}`);
      if (tc.description) lines.push(`Objective: ${tc.description}`);
      if (tc.priority) lines.push(`Priority: ${tc.priority}`);
      if (tc.type) lines.push(`Type: ${tc.type}`);
      if (tc.preConditions) lines.push(`Pre-conditions: ${tc.preConditions}`);
      if (tc.steps.length) lines.push(enrichMode
        ? `Steps (expand these — they may be vague): ${tc.steps.map((s, si) => `${si + 1}. ${s}`).join(' → ')}`
        : `Steps: ${tc.steps.map((s, si) => `${si + 1}. ${s}`).join(' → ')}`);
      if (tc.testData) lines.push(`Test Data: ${tc.testData}`);
      lines.push(enrichMode
        ? `Expected (make specific & verifiable): ${tc.expectedResult || '(not provided — derive from context)'}`
        : `Expected: ${tc.expectedResult}`);
      if (tc.notes) lines.push(`Notes: ${tc.notes}`);
      return lines.join('\n');
    });

    if (enrichMode) {
      userParts.push(
        '',
        `=== SEED ENRICHMENT MODE — expand each of the following ${seedCount} seed TCs into detailed, automation-ready test cases with generationHints ===`,
        ...seedLines,
      );
    } else {
      userParts.push(
        '',
        `=== SEED TEST CASES (LOCKED — ${seedCount} provided; generate ${gapTargetCount} ADDITIONAL gap TCs only, do NOT include these in your JSON output) ===`,
        ...seedLines,
      );
    }
  }

  if (input.goldenTestCases && input.goldenTestCases.length > 0) {
    userParts.push(
      '',
      '=== GOLDEN REFERENCE TEST CASES (APPROVED & EXECUTED — mirror their step style, login sequence, and phrasing exactly) ===',
      ...input.goldenTestCases.map((tc) => [
        `[${tc.tcId}] ${tc.title}${tc.priority ? ` | ${tc.priority}` : ''}${tc.useCaseTag ? ` | Use Case: ${tc.useCaseTag}` : ''}`,
        `Steps: ${tc.steps.map((s, i) => `${i + 1}. ${s}`).join(' → ')}`,
        `Expected: ${tc.expectedResult}`,
      ].join('\n')),
    );
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

  const { deduped: dedupedGap, removed } = deduplicate(validated);

  if (enrichMode) {
    // Enrichment mode: the LLM output IS the final result — enriched seeds, no gap TCs.
    return { testCases: dedupedGap, duplicatesRemoved: removed };
  }

  // Normal mode: build verbatim seed TCs server-side and prepend to LLM gap TCs.
  const seedAsGenerated: GeneratedTestCase[] = (input.seedTestCases ?? []).map((tc) => {
    const descParts: string[] = [];
    if (tc.description) descParts.push(tc.description);
    if (tc.testData) descParts.push(`Test Data: ${tc.testData}`);
    if (tc.preConditions) descParts.push(`Pre-conditions: ${tc.preConditions}`);
    if (tc.notes) descParts.push(`Notes: ${tc.notes}`);
    return {
      title: tc.title,
      description: descParts.join(' | '),
      steps: tc.steps.length > 0 ? tc.steps : ['(Execute as per test objective)'],
      expectedResult: tc.expectedResult || 'Test completes successfully',
      type: tc.type ?? (input.testTypes[0] ?? 'UI'),
      tags: [],
      useCaseTag: tc.useCaseTag || 'Imported',
      priority: tc.priority ?? 'MEDIUM',
      sourceRef: 'seed',
      generationHints: '',
    };
  });

  // Drop any gap TC the LLM accidentally regenerated from the seed list
  const gapFiltered = dedupedGap.filter(
    (gen) => !seedAsGenerated.some((seed) => jaccard(seed.title, gen.title) > 0.8),
  );

  return {
    testCases: [...seedAsGenerated, ...gapFiltered],
    duplicatesRemoved: removed + (dedupedGap.length - gapFiltered.length),
  };
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
