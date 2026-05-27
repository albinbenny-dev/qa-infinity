import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import { createLLM } from '../lib/llm.js';
import { prisma } from '../lib/prisma.js';
import { readScript } from '../services/scriptFileService.js';
import type { LoginInstructions, NavNode, PageLocators, AgentLearning } from '../types/scanner.js';

export interface HealContext {
  /** SELECTOR | FLOW | API_SCHEMA */
  type: string;
  /** Human-readable explanation of what was broken and how it was fixed */
  summary: string;
  tcTitle?: string;
  useCaseTag?: string;
  confidence: number;
  timestamp: string;
}

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
    generationHints?: string | null; // stored per-TC hints
  };
  project: {
    id: string;
    name: string;
    baseUrl?: string | null;
  };
  existingPOMs: string[]; // filenames of already-generated POM classes
  contextNote?: string;   // ephemeral user-typed context for this run
  /** Past approved/auto-applied heals for this project — teach the agent what NOT to repeat */
  recentHeals?: HealContext[];
  /**
   * A working, verified Playwright script for a TC that covers the setup steps
   * (login + navigation) that this TC depends on. The agent should learn the
   * login/navigation pattern from it and NOT re-generate those steps from scratch.
   */
  prerequisiteScript?: {
    tcId: string;
    title: string;
    scriptContent: string;
  } | null;
}

export interface ScriptAgentResult {
  specContent: string;
  pomContent?: string;
  pomFilename?: string;
}

const SYSTEM_PROMPT_BASE = `You are a senior QA automation engineer.
Generate a production-ready Playwright TypeScript test using @playwright/test
for the target application (baseUrl: {BASE_URL}).
Page Object Model pattern required. Import POMs from ./pages/.
Locator priority: getByTestId > getByRole > getByLabel > CSS. Never use XPath.
Return ONLY raw TypeScript — no markdown fences, no explanations.

{PLATFORM_CONTEXT}

### Base URL — CRITICAL
The Playwright config sets baseURL from the BASE_URL environment variable at runtime.
ALWAYS use relative paths in page.goto() calls — e.g. page.goto('/') NOT page.goto('http://localhost:3000/').
Never hardcode an absolute URL in any page.goto(), page.request, or navigation call.

### Timeout Defaults for Post-Login Assertions
- Use { timeout: 15000 } on toBeVisible() and toHaveURL() calls that follow a login action.

### Shared login — CRITICAL
When multiple tests in the same describe block all require a login step:
- EITHER write ONE comprehensive test that covers all the behaviours in sequence.
- OR use test.beforeAll to log in ONCE and reuse the context (via storageState) across tests.
- NEVER write 3 (or more) separate tests that each independently call navigate() + login().
  Repeating full login in every test multiplies run time and generates redundant heal jobs on failure.

### Never hardcode dynamic/installation-specific values — CRITICAL
Do NOT hardcode project slugs, user IDs, entity names, or any value that changes per installation.
BAD:  page.goto('/projects/test/dashboard')  ← 'test' is a hardcoded slug
GOOD: skip navigation to specific entities, or derive slug/id from a previous step or env var.
If the test case requires navigating into a specific project/entity, use process.env.TEST_PROJECT_SLUG
or note in a comment that the value must be replaced — do not invent a placeholder slug.

### Heal History — learn from past failures
If the prompt includes a PAST HEALS section, these are real failures that were auto-fixed on this project.
- SELECTOR heals: the listed selector was unstable. Prefer getByTestId/getByRole/getByLabel over it.
- FLOW heals: timing or navigation was wrong. Add explicit waits, waitForResponse, or waitForLoadState.
- API_SCHEMA heals: response shape changed. Validate only stable fields; avoid brittle assertions.
Absorb these patterns so you do not regenerate scripts that will need the same fix.

### POM method contract — CRITICAL
Every method called on a POM instance in the spec (e.g. loginPage.login(), dashboardPage.waitForLoad())
MUST be explicitly defined in the ===POM=== section of your response.
Do not call any method that you have not written in the POM class body.
If no suitable method exists, write one in the POM — never call an undefined method.

Output format — use these exact separators:
===SPEC===
<content of the .spec.ts file>
===POM===
<PomClassName>.ts:<content of the Page Object Model class>

If a suitable POM already exists (listed in existingPOMs), skip the ===POM=== section entirely.
The spec file must import from '@playwright/test', include a test.describe block,
use async/await, and handle assertions with expect().`;

const SYSTEM_PROMPT_SELF_CONTAINED = `You are a senior QA automation engineer.
Generate a production-ready Playwright TypeScript test using @playwright/test
for the target application (baseUrl: {BASE_URL}).
Self-contained mode: do NOT import from ./pages/ or any local modules.
All page interactions must be written inline in this single file.
Locator priority: getByTestId > getByRole > getByLabel > CSS. Never use XPath.
Return ONLY raw TypeScript — no markdown fences, no explanations.

{PLATFORM_CONTEXT}

### Base URL — CRITICAL
The Playwright config sets baseURL from the BASE_URL environment variable at runtime.
ALWAYS use relative paths in page.goto() calls — e.g. page.goto('/') NOT page.goto('http://localhost:3000/').
Never hardcode an absolute URL in any page.goto(), page.request, or navigation call.

### Timeout Defaults for Post-Login Assertions
- Use { timeout: 15000 } on toBeVisible() and toHaveURL() calls that follow a login action.

### Shared login — CRITICAL
When multiple tests in the same describe block all require a login step:
- EITHER write ONE comprehensive test that covers all the behaviours in sequence.
- OR use test.beforeAll to log in ONCE and reuse the context (via storageState) across tests.
- NEVER write 3 (or more) separate tests that each independently call navigate() + login().
  Repeating full login in every test multiplies run time and generates redundant heal jobs on failure.

### Never hardcode dynamic/installation-specific values — CRITICAL
Do NOT hardcode project slugs, user IDs, entity names, or any value that changes per installation.
BAD:  page.goto('/projects/test/dashboard')  ← 'test' is a hardcoded slug
GOOD: skip navigation to specific entities, or derive slug/id from a previous step or env var.
If the test case requires navigating into a specific project/entity, use process.env.TEST_PROJECT_SLUG
or note in a comment that the value must be replaced — do not invent a placeholder slug.

### Heal History — learn from past failures
If the prompt includes a PAST HEALS section, these are real failures that were auto-fixed on this project.
- SELECTOR heals: the listed selector was unstable. Prefer getByTestId/getByRole/getByLabel over it.
- FLOW heals: timing or navigation was wrong. Add explicit waits, waitForResponse, or waitForLoadState.
- API_SCHEMA heals: response shape changed. Validate only stable fields; avoid brittle assertions.
Absorb these patterns so you do not regenerate scripts that will need the same fix.

Output format — use this exact separator:
===SPEC===
<content of the .spec.ts file>

The spec file must import from '@playwright/test', include a test.describe block,
use async/await, and handle assertions with expect().`;

export async function getProjectPlatformSection(
  projectId: string,
  useCaseTag?: string | null,
): Promise<string> {
  const ctx = await prisma.projectContext.findUnique({ where: { projectId } });

  if (!ctx || !ctx.loginInstructions) {
    return [
      '## Platform Context',
      '(No UI scan found for this project — run a UI scan from Project Settings > UI Scanner to enable real locators)',
      '',
      'Locator priority: getByTestId > getByRole > getByLabel > CSS. Never use XPath.',
    ].join('\n');
  }

  const login = JSON.parse(ctx.loginInstructions) as LoginInstructions;
  const navMap = ctx.navigationMap ? (JSON.parse(ctx.navigationMap) as NavNode[]) : [];
  const locators = ctx.pageLocators
    ? (JSON.parse(ctx.pageLocators) as Record<string, PageLocators>)
    : {};
  const learnings = ctx.agentLearnings
    ? (JSON.parse(ctx.agentLearnings) as AgentLearning[])
    : [];

  const loginSection = buildLoginSection(login);
  const navSection = buildNavSection(navMap, useCaseTag);
  const locatorSection = buildLocatorSection(locators, useCaseTag, navMap);
  const learningsSection = buildLearningsSection(learnings, useCaseTag);

  const sections = [
    `## Platform Context — ${new Date().toISOString().split('T')[0]} (from UI scan)`,
    '',
  ];

  if (ctx.customInstructions) {
    sections.push('### Custom Project Instructions');
    sections.push(ctx.customInstructions);
    sections.push('');
  }

  sections.push(loginSection, '', navSection, '', locatorSection);

  if (learningsSection) {
    sections.push('', learningsSection);
  }

  return sections.join('\n');
}

function buildLoginSection(login: LoginInstructions): string {
  const lines = ['### Login Flow'];
  lines.push(`Login type: ${login.loginType}`);
  lines.push(`Post-login URL: ${login.postLoginUrl}`);
  if (login.notes) lines.push(`Notes: ${login.notes}`);
  lines.push('');
  lines.push('Selectors:');
  lines.push(`  Username: ${login.selectors.username || '(not detected)'}`);
  lines.push(`  Password: ${login.selectors.password || '(not detected)'}`);
  lines.push(`  Submit:   ${login.selectors.submit || '(not detected)'}`);
  lines.push('');
  lines.push('Steps:');
  for (const step of login.steps) {
    const sel = step.selector ? ` [${step.selector}]` : '';
    lines.push(`  ${step.order}. ${step.action}: ${step.description}${sel}`);
  }
  lines.push('');
  lines.push('Credentials come from env vars: process.env.TC_USERNAME and process.env.TC_PASSWORD');
  return lines.join('\n');
}

function buildNavSection(navMap: NavNode[], useCaseTag?: string | null): string {
  const lines = ['### Navigation Map'];
  if (navMap.length === 0) {
    lines.push('(No navigation map available)');
    return lines.join('\n');
  }

  function renderNode(node: NavNode, indent: number): void {
    const prefix = '  '.repeat(indent);
    lines.push(`${prefix}- ${node.label}: ${node.url}`);
    for (const child of (node.children ?? [])) {
      renderNode(child, indent + 1);
    }
  }

  const nodesToRender = useCaseTag
    ? navMap.filter((n) => n.label.toLowerCase().includes(useCaseTag.toLowerCase()) || (n.children ?? []).some((c) => c.label.toLowerCase().includes(useCaseTag.toLowerCase())))
    : navMap;

  for (const node of (nodesToRender.length > 0 ? nodesToRender : navMap).slice(0, 40)) {
    renderNode(node, 0);
  }

  return lines.join('\n');
}

function buildLocatorSection(
  locators: Record<string, PageLocators>,
  useCaseTag?: string | null,
  navMap?: NavNode[],
): string {
  const lines = ['### Page Locators'];
  const entries = Object.values(locators);

  if (entries.length === 0) {
    lines.push('(No locators captured)');
    return lines.join('\n');
  }

  // Scope to use case if provided
  let filtered = entries;
  if (useCaseTag && navMap) {
    const matchingLabels = new Set(
      navMap
        .filter((n) => n.label.toLowerCase().includes(useCaseTag.toLowerCase()))
        .map((n) => n.label.toLowerCase()),
    );
    if (matchingLabels.size > 0) {
      filtered = entries.filter((e) => matchingLabels.has(e.navLabel.toLowerCase()));
    }
  }

  for (const page of filtered.slice(0, 15)) {
    lines.push(`\n#### ${page.navLabel} (${page.urlPattern})`);
    for (const loc of page.locators.slice(0, 20)) {
      lines.push(`  - ${loc.semanticName}: \`${loc.selector}\``);
    }
  }

  return lines.join('\n');
}

function buildLearningsSection(learnings: AgentLearning[], useCaseTag?: string | null): string {
  if (learnings.length === 0) return '';

  // Prefer learnings relevant to the use-case tag; fall back to all recent ones
  const scoped = useCaseTag
    ? learnings.filter(l => l.menuContext.toLowerCase().includes(useCaseTag.toLowerCase()))
    : [];
  const toShow = (scoped.length > 0 ? scoped : learnings).slice(-8);
  if (toShow.every(l => l.verifiedLocators.length === 0 && l.verifiedFlow.length === 0)) return '';

  const lines = [
    '### Verified Selectors from Agent Traces',
    'These selectors worked in live browser sessions. Use them first.',
    'Format: selectorType=value → Playwright: testid=x → getByTestId("x"), role=x → getByRole("x"), label=x → getByLabel("x"), text=x → getByText("x"), css=x → locator("x")',
  ];

  for (const l of toShow) {
    if (l.verifiedLocators.length === 0 && l.verifiedFlow.length === 0) continue;
    lines.push(`\n#### ${l.menuContext}`);
    for (const loc of l.verifiedLocators.slice(0, 12)) {
      lines.push(`  - ${loc.semanticName}: ${loc.selector}`);
    }
    if (l.verifiedFlow.length > 0) {
      lines.push(`  Flow: ${l.verifiedFlow.slice(0, 6).join(' → ')}`);
    }
  }

  return lines.join('\n');
}

// ── Golden examples (few-shot grounding) ──────────────────────────────────

async function getGoldenExamples(
  projectId: string,
  useCaseTag?: string | null,
  selfContained?: boolean,
): Promise<string> {
  const goldenScripts = await prisma.script.findMany({
    where: {
      projectId,
      isGolden: true,
      ...(useCaseTag ? { testCase: { useCaseTag } } : {}),
    },
    include: { testCase: { select: { tcId: true, title: true } } },
    orderBy: { updatedAt: 'desc' },
    take: 2,
  });

  // Fall back to any golden scripts from this project if none match the use-case
  const scripts =
    goldenScripts.length > 0
      ? goldenScripts
      : await prisma.script.findMany({
          where: { projectId, isGolden: true },
          include: { testCase: { select: { tcId: true, title: true } } },
          orderBy: { updatedAt: 'desc' },
          take: 1,
        });

  if (scripts.length === 0) return '';

  const lines: string[] = [
    '## Working Examples From This Project',
    'The following scripts have been verified against this application.',
    selfContained
      ? 'Match their selector style, base URL usage, and navigation patterns. DO NOT copy any import statements — all page interactions must be written inline in a single file.'
      : 'Match their selector style, base URL usage, navigation patterns, and import paths exactly.',
    '',
  ];

  for (const s of scripts) {
    const label = s.testCase
      ? `${s.testCase.tcId} — ${s.testCase.title}`
      : s.filename;
    lines.push(`### Example: ${label}`);
    try {
      const content = readScript(s.projectId, s.filename);
      // Cap at 3000 chars to avoid context bloat; include from top
      lines.push('```typescript');
      lines.push(content.slice(0, 3000));
      if (content.length > 3000) lines.push('// … (truncated)');
      lines.push('```');
    } catch {
      // File not on disk — fall back to DB content
      if (s.content) {
        lines.push('```typescript');
        lines.push(s.content.slice(0, 3000));
        if (s.content.length > 3000) lines.push('// … (truncated)');
        lines.push('```');
      }
    }
    lines.push('');
  }

  return lines.join('\n');
}

export async function runScriptAgent(input: ScriptAgentInput): Promise<ScriptAgentResult> {
  const llm = createLLM({ temperature: 0.1, agentName: 'script-agent', projectId: input.project.id });

  const baseUrl = input.project.baseUrl ?? 'http://localhost:3000';
  const selfContained = input.existingPOMs.length === 0;
  const [platformSection, goldenSection] = await Promise.all([
    getProjectPlatformSection(input.project.id, input.testCase.useCaseTag),
    getGoldenExamples(input.project.id, input.testCase.useCaseTag, selfContained),
  ]);
  const fullPlatformContext = goldenSection
    ? `${platformSection}\n\n${goldenSection}`
    : platformSection;
  const promptTemplate = selfContained
    ? SYSTEM_PROMPT_SELF_CONTAINED
    : SYSTEM_PROMPT_BASE;
  const systemPrompt = promptTemplate
    .replace('{BASE_URL}', baseUrl)
    .replace('{PLATFORM_CONTEXT}', fullPlatformContext);

  const steps = parseJsonArray(input.testCase.steps);
  const pomListText =
    input.existingPOMs.length > 0
      ? `\nExisting POMs (do NOT regenerate): ${input.existingPOMs.join(', ')}`
      : '\nNo existing POMs — write self-contained inline code only. Do NOT import from ./pages/.';

  // Build combined user context: stored hints + ephemeral contextNote
  const contextParts: string[] = [];
  if (input.testCase.generationHints?.trim()) {
    contextParts.push(`Stored hints for this test case:\n${input.testCase.generationHints.trim()}`);
  }
  if (input.contextNote?.trim()) {
    contextParts.push(`Additional context provided for this run:\n${input.contextNote.trim()}`);
  }

  // Build past heals section — teach the agent which patterns to avoid
  const healLines: string[] = [];
  if (input.recentHeals && input.recentHeals.length > 0) {
    healLines.push('', '### PAST HEALS — avoid regenerating these failure patterns');
    for (const h of input.recentHeals) {
      const date = h.timestamp.split('T')[0];
      const tc = h.tcTitle ? ` (${h.tcTitle})` : '';
      const uc = h.useCaseTag ? ` [${h.useCaseTag}]` : '';
      healLines.push(`[${h.type}]${tc}${uc} ${date} — ${h.summary}`);
    }
  }

  // Build prerequisite script context — teaches the agent the working login/nav pattern
  const prereqLines: string[] = [];
  if (input.prerequisiteScript) {
    const cap = input.prerequisiteScript.scriptContent.slice(0, 4000);
    const truncated = input.prerequisiteScript.scriptContent.length > 4000;
    prereqLines.push(
      '',
      '### PREREQUISITE SCRIPT — CRITICAL: READ THIS BEFORE GENERATING',
      `The following Playwright script for ${input.prerequisiteScript.tcId} — "${input.prerequisiteScript.title}"`,
      'is a VERIFIED, WORKING script that covers the setup steps this test case depends on.',
      '(login + navigation to the target page / starting state)',
      '',
      '```typescript',
      cap,
      ...(truncated ? ['// … (truncated)'] : []),
      '```',
      '',
      'INSTRUCTIONS FOR USING THE PREREQUISITE:',
      '1. Study the login flow and navigation pattern from the script above.',
      '2. Your generated test MUST start from the same end-state as the prerequisite script.',
      '3. In a test.beforeAll or at the start of your test, reproduce the login + navigation',
      '   steps shown above — copy the exact selectors and waits, do NOT invent new ones.',
      '4. After the setup, write ONLY the new steps specific to this test case.',
      '5. Do NOT add another login block — the setup from the prerequisite covers it.',
    );
  }

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
    ...(contextParts.length > 0 ? [
      '',
      '### User Context & Locator Hints — FOLLOW THESE EXACTLY',
      ...contextParts,
    ] : []),
    ...prereqLines,
    ...healLines,
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
