import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import { z } from 'zod';
import { createAnthropicDirectClient, createLLM } from '../lib/llm.js';
import { prisma } from '../lib/prisma.js';
import { buildSkillsSystemBlock } from '../lib/skillsContext.js';
import { appendAuditLog } from '../lib/llmAudit.js';
import type { UISnapshot } from '../services/inputAdapters.js';

export interface ProductSkill {
  skillType: string;
  name: string;
  scope?: string;
  content: string; // raw JSON string
  confidence: number;
}

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
  /**
   * Project slug — used to load ALL active skills from disk files.
   * Preferred over the `skills` array: reads without any filtering or cap.
   */
  projectSlug?: string;
  /**
   * @deprecated Pass projectSlug instead. Skills array still supported as a fallback
   * when projectSlug is not set and no disk files exist.
   */
  skills?: ProductSkill[];
  /**
   * When set, bypasses disk loading and uses ONLY these skills.
   * Used by the feature-level TC generation queue — each skill is processed independently.
   */
  skillsOverride?: ProductSkill[];
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

PRODUCT SKILLS: If the prompt contains a === PRODUCT SKILLS === section, this is authoritative knowledge about
the application. You MUST use it directly — not as a hint, but as ground truth:
- UI_FLOW skills: use the EXACT selectors listed — never guess or invent locators; use navigation paths verbatim
- BUSINESS_USE_CASE skills: derive edge cases, acceptance criteria, and negative scenarios from business rules
- TEST_DATA skills: use the exact data values shown — never use placeholders like [value] or [username]
- API_CONTRACT skills: use correct endpoint paths, HTTP methods, and request/response schemas
- USER_ROLE skills: generate role-specific TCs for each role's permissions and restrictions
- UX_DESIGN skills: use the exact copy text (button labels, error messages, toast text) in step assertions
- FUNCTIONAL_RULES skills: treat EVERY listed field constraint, data relationship, failure mode, permission scenario, and functional variation as a mandatory test scenario — generate at least one TC per item; these are business-verified rules, not suggestions

Be concise — keep steps and descriptions brief.
Return ONLY a valid JSON array. Each element:
{ title, description, steps: string[], expectedResult, type:'UI'|'API'|'SIT',
  tags: string[], useCaseTag: string, priority:'LOW'|'MEDIUM'|'HIGH'|'CRITICAL', sourceRef: string, generationHints: string }
IMPORTANT: Output must be complete, valid JSON. Do not truncate the array.`;

function formatSkillContent(skillType: string, content: Record<string, unknown>): string {
  const lines: string[] = [];
  switch (skillType) {
    case 'UI_FLOW': {
      if (content.targetUrl) lines.push(`  Target URL: ${content.targetUrl}`);
      if (Array.isArray(content.navigationPath) && content.navigationPath.length) {
        lines.push(`  Navigation: ${(content.navigationPath as string[]).join(' → ')}`);
      }
      if (Array.isArray(content.locators) && content.locators.length) {
        lines.push('  Locators (use EXACTLY — do not guess):');
        for (const loc of content.locators as Array<{ semanticName: string; selector: string; locatorType: string; interactionNote?: string }>) {
          lines.push(`    - ${loc.semanticName}: ${loc.selector} [${loc.locatorType}]${loc.interactionNote ? ` — ${loc.interactionNote}` : ''}`);
        }
      }
      if (Array.isArray(content.stateTransitions) && content.stateTransitions.length) {
        lines.push('  State transitions:');
        for (const st of content.stateTransitions as Array<{ trigger: string; resultState: string; waitCondition?: string }>) {
          lines.push(`    - ${st.trigger} → ${st.resultState}${st.waitCondition ? ` (wait: ${st.waitCondition})` : ''}`);
        }
      }
      if (Array.isArray(content.validations) && content.validations.length) {
        lines.push('  Validations:');
        for (const v of content.validations as Array<{ field: string; rule: string; errorText: string }>) {
          lines.push(`    - ${v.field}: "${v.errorText}" (rule: ${v.rule})`);
        }
      }
      if (content.prerequisiteState) lines.push(`  Prerequisite: ${content.prerequisiteState}`);
      break;
    }
    case 'BUSINESS_USE_CASE': {
      if (Array.isArray(content.actors)) lines.push(`  Actors: ${(content.actors as string[]).join(', ')}`);
      if (Array.isArray(content.preconditions) && content.preconditions.length) {
        lines.push(`  Preconditions: ${(content.preconditions as string[]).join('; ')}`);
      }
      if (Array.isArray(content.businessRules) && content.businessRules.length) {
        lines.push('  Business Rules:');
        for (const rule of content.businessRules as string[]) lines.push(`    - ${rule}`);
      }
      if (Array.isArray(content.successCriteria) && content.successCriteria.length) {
        lines.push(`  Success Criteria: ${(content.successCriteria as string[]).join('; ')}`);
      }
      if (Array.isArray(content.edgeCases) && content.edgeCases.length) {
        lines.push('  Edge Cases (must generate TCs for each):');
        for (const ec of content.edgeCases as string[]) lines.push(`    - ${ec}`);
      }
      break;
    }
    case 'TEST_DATA': {
      if (content.validData) lines.push(`  Valid data: ${JSON.stringify(content.validData)}`);
      if (content.invalidData) lines.push(`  Invalid data: ${JSON.stringify(content.invalidData)}`);
      if (content.boundaryValues) lines.push(`  Boundary values: ${JSON.stringify(content.boundaryValues)}`);
      if (content.referenceData) lines.push(`  Reference data (exact dropdown values): ${JSON.stringify(content.referenceData)}`);
      if (content.dataSetupInstructions) lines.push(`  Setup: ${content.dataSetupInstructions}`);
      break;
    }
    case 'HLD': {
      if (content.description) lines.push(`  Description: ${content.description}`);
      if (Array.isArray(content.components)) lines.push(`  Components: ${(content.components as string[]).join(', ')}`);
      if (Array.isArray(content.integrations) && content.integrations.length) {
        lines.push('  Integrations:');
        for (const intg of content.integrations as Array<{ from: string; to: string; trigger: string; async: boolean; delay?: string }>) {
          lines.push(`    - ${intg.from} → ${intg.to} (trigger: ${intg.trigger}${intg.async ? ', async' : ''}${intg.delay ? `, delay: ${intg.delay}` : ''})`);
        }
      }
      if (Array.isArray(content.apis) && content.apis.length) {
        lines.push(`  APIs: ${(content.apis as string[]).join(', ')}`);
      }
      break;
    }
    case 'API_CONTRACT': {
      lines.push(`  Endpoint: ${content.method ?? 'GET'} ${content.endpoint}`);
      if (content.purpose) lines.push(`  Purpose: ${content.purpose}`);
      if (content.requestSchema) lines.push(`  Request schema: ${JSON.stringify(content.requestSchema)}`);
      if (content.responses) lines.push(`  Responses: ${JSON.stringify(content.responses)}`);
      break;
    }
    case 'USER_ROLE': {
      if (content.roleName) lines.push(`  Role: ${content.roleName}`);
      if (Array.isArray(content.permissions)) lines.push(`  Permissions: ${(content.permissions as string[]).join(', ')}`);
      if (Array.isArray(content.restrictions)) lines.push(`  Restrictions: ${(content.restrictions as string[]).join(', ')}`);
      if (Array.isArray(content.visibleMenuItems)) lines.push(`  Visible menu: ${(content.visibleMenuItems as string[]).join(', ')}`);
      if (Array.isArray(content.hiddenMenuItems)) lines.push(`  Hidden menu: ${(content.hiddenMenuItems as string[]).join(', ')}`);
      break;
    }
    case 'UX_DESIGN': {
      if (Array.isArray(content.components) && content.components.length) {
        lines.push('  Components:');
        for (const c of content.components as Array<{ name: string; componentType: string; interaction?: string; required?: boolean }>) {
          lines.push(`    - ${c.name} (${c.componentType})${c.interaction ? `: ${c.interaction}` : ''}${c.required ? ' [REQUIRED]' : ''}`);
        }
      }
      if (content.exactCopy) lines.push(`  Exact UI text (use verbatim): ${JSON.stringify(content.exactCopy)}`);
      if (Array.isArray(content.requiredFields)) lines.push(`  Required fields: ${(content.requiredFields as string[]).join(', ')}`);
      break;
    }
    case 'FUNCTIONAL_RULES': {
      if (content.summary) lines.push(`  Summary: ${content.summary}`);
      if (Array.isArray(content.fieldConstraints) && content.fieldConstraints.length) {
        lines.push('  Field Constraints (generate a TC for each):');
        for (const r of content.fieldConstraints as string[]) lines.push(`    - ${r}`);
      }
      if (Array.isArray(content.dataRelationships) && content.dataRelationships.length) {
        lines.push('  Data Relationships:');
        for (const r of content.dataRelationships as string[]) lines.push(`    - ${r}`);
      }
      if (Array.isArray(content.knownFailureModes) && content.knownFailureModes.length) {
        lines.push('  Known Failure Modes (each needs a negative TC):');
        for (const r of content.knownFailureModes as string[]) lines.push(`    - ${r}`);
      }
      if (Array.isArray(content.permissionScenarios) && content.permissionScenarios.length) {
        lines.push('  Permission Scenarios (generate a TC per role):');
        for (const r of content.permissionScenarios as string[]) lines.push(`    - ${r}`);
      }
      if (Array.isArray(content.functionalVariations) && content.functionalVariations.length) {
        lines.push('  Functional Variations (each needs its own TC):');
        for (const r of content.functionalVariations as string[]) lines.push(`    - ${r}`);
      }
      break;
    }
    case 'HISTORICAL': {
      let entries: Array<{ date?: string; healType?: string; confidence?: number; summary?: string; selectorChanges?: Record<string, string> }> = [];
      try { entries = (content as unknown) as typeof entries; } catch { break; }
      if (!Array.isArray(entries) || entries.length === 0) break;
      lines.push('  PAST HEAL FIXES — do NOT replicate these broken patterns in new scripts:');
      for (const e of entries.slice(-10)) {
        lines.push(`  [${e.date ?? '?'}] ${e.healType ?? 'UNKNOWN'} (${e.confidence ?? '?'}% confidence): ${e.summary ?? ''}`);
        if (e.selectorChanges && Object.keys(e.selectorChanges).length > 0) {
          for (const [old, next] of Object.entries(e.selectorChanges)) {
            lines.push(`    FIXED selector: "${old}" → "${next}"`);
          }
        }
      }
      break;
    }
    default:
      lines.push(`  ${JSON.stringify(content).slice(0, 600)}`);
  }
  return lines.join('\n');
}

export async function runWriterAgent(input: WriterInput): Promise<WriterResult> {
  const directClient = createAnthropicDirectClient();

  // Load skills: override array > disk files > passed-in skills array
  let skillsBlock: { type: 'text'; text: string; cache_control: { type: 'ephemeral' } } | null = null;
  let legacySkillsText = '';

  if (input.skillsOverride && input.skillsOverride.length > 0) {
    const overrideText = buildLegacySkillsText(input.skillsOverride);
    if (directClient) {
      skillsBlock = { type: 'text', text: overrideText, cache_control: { type: 'ephemeral' } };
    } else {
      legacySkillsText = overrideText;
    }
  } else if (input.projectSlug) {
    skillsBlock = buildSkillsSystemBlock(input.projectSlug);
    if (!directClient && skillsBlock) {
      legacySkillsText = skillsBlock.text;
      skillsBlock = null; // LangChain path: inject as text, not system block
    }
  }

  const inputSummary = input.inputs
    .map((inp) => `[${inp.type.toUpperCase()}] ${inp.label}:\n${inp.content.slice(0, 2000)}`)
    .join('\n\n---\n\n');

  const seedCount = input.seedTestCases?.length ?? 0;
  const enrichMode = input.enrichSeeds === true && seedCount > 0;
  // enrichMode: agent expands seeds, outputs exactly seedCount enriched TCs, no gap TCs.
  // normal seed mode: agent generates gap TCs only; seeds are prepended server-side.
  const gapTargetCount = enrichMode ? seedCount : (seedCount > 0 ? Math.max(1, input.targetTcCount ?? 3) : input.targetTcCount ?? null);

  const userParts: string[] = [
    `Project: ${input.projectName}`,
    `Test types to generate: ${input.testTypes.join(', ')}`,
    enrichMode
      ? `TARGET_TC_COUNT: ${gapTargetCount} (SEED ENRICHMENT MODE — enrich exactly ${gapTargetCount} seeds; output one enriched TC per seed in the same order)`
      : seedCount > 0
        ? `TARGET_TC_COUNT: ${gapTargetCount} (generate exactly ${gapTargetCount} NEW gap test cases — the ${seedCount} seed test cases below are already locked and will be included separately; do NOT regenerate them)`
        : gapTargetCount !== null
          ? `TARGET_TC_COUNT: ${gapTargetCount} (you must produce exactly ${gapTargetCount} test cases)`
          : `COVERAGE MODE: Generate ALL test cases needed for complete coverage of this use case. Do NOT stop at an arbitrary number — generate every distinct scenario the inputs warrant. Minimum: cover happy-path, all negative/validation paths, all boundary/edge cases, and every distinct workflow or action visible in the inputs. Aim for thorough coverage; only stop when no new scenario remains.`,
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

  // Inject product skills into user message for LangChain path
  // (SDK path uses cached system block — skills are NOT added to userParts there)
  const injectSkillsText = legacySkillsText ||
    (!directClient && input.skills && input.skills.length > 0
      ? buildLegacySkillsText(input.skills)
      : '');
  if (injectSkillsText) {
    userParts.push('', '=== PRODUCT SKILLS (authoritative knowledge — use EXACTLY, do not guess or invent) ===', injectSkillsText);
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

  const promptText = userParts.join('\n');
  const activeSnapshots = (input.uiSnapshots ?? []).filter((s) => s.screenshotBase64 !== null);

  let content: string;

  if (directClient) {
    // Anthropic SDK path: skills as cached first system block, adaptive thinking
    const systemBlocks: Array<{ type: 'text'; text: string; cache_control?: { type: 'ephemeral' } }> = [];
    if (skillsBlock) systemBlocks.push(skillsBlock);
    systemBlocks.push({ type: 'text', text: SYSTEM_PROMPT });

    const sdkContent: Array<
      | { type: 'image'; source: { type: 'base64'; media_type: 'image/png' | 'image/jpeg'; data: string } }
      | { type: 'text'; text: string }
    > = [
      ...activeSnapshots.map((snap) => ({
        type: 'image' as const,
        source: {
          type: 'base64' as const,
          media_type: (snap.mediaType ?? 'image/png') as 'image/png' | 'image/jpeg',
          data: snap.screenshotBase64 as string,
        },
      })),
      { type: 'text' as const, text: promptText },
    ];

    const model = process.env.ANTHROPIC_MODEL ?? 'claude-opus-4-8';
    const startMs = Date.now();
    const message = await directClient.messages.stream({
      model,
      max_tokens: 32000,
      system: systemBlocks,
      messages: [{ role: 'user', content: sdkContent }],
    }).finalMessage();

    const durationMs = Date.now() - startMs;
    content = message.content.find((b): b is { type: 'text'; text: string } => b.type === 'text')?.text ?? '';

    void prisma.llmCall.create({
      data: {
        agentName: 'writer-agent',
        projectId: null,
        projectName: input.projectName,
        model,
        promptTokens: message.usage.input_tokens,
        completionTokens: message.usage.output_tokens,
        totalTokens: message.usage.input_tokens + message.usage.output_tokens,
        durationMs,
      },
    }).catch((e: Error) => console.error('[writer-agent] DB write failed:', e.message));

    appendAuditLog({
      agent: 'writer-agent',
      model,
      projectName: input.projectName,
      promptTokens: message.usage.input_tokens,
      completionTokens: message.usage.output_tokens,
      durationMs,
      system: systemBlocks,
      user: promptText,
      response: content,
    });
  } else {
    // LangChain fallback (OpenRouter or no ANTHROPIC_API_KEY)
    const llm = createLLM({ temperature: 0, agentName: 'writer-agent' });
    const humanMessage =
      activeSnapshots.length > 0
        ? new HumanMessage({
            content: [
              ...activeSnapshots.map((snap) => ({
                type: 'image_url' as const,
                image_url: { url: `data:${snap.mediaType ?? 'image/png'};base64,${snap.screenshotBase64}` },
              })),
              { type: 'text' as const, text: promptText },
            ],
          })
        : new HumanMessage(promptText);

    const response = await llm.invoke([new SystemMessage(SYSTEM_PROMPT), humanMessage]);
    content = typeof response.content === 'string' ? response.content : JSON.stringify(response.content);
  }

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

function buildLegacySkillsText(skills: ProductSkill[]): string {
  const parts: string[] = [];
  for (const skill of skills) {
    const header = `[${skill.skillType}] ${skill.name}${skill.scope ? ` (${skill.scope})` : ''}${skill.confidence < 0.7 ? ' [low-confidence]' : ''}`;
    parts.push(header);
    try {
      const parsed = JSON.parse(skill.content) as Record<string, unknown>;
      parts.push(formatSkillContent(skill.skillType, parsed));
    } catch {
      // Plain text content — emit verbatim, no truncation
      parts.push(skill.content);
    }
    parts.push('');
  }
  return parts.join('\n');
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
