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

// ── Structured hints (version 2 from agent traces) ────────────────────────

interface StructuredLocator {
  step: string;
  selectorType: string;
  selector: string;
  playwright: string;
}

interface StructuredHints {
  version: number;
  locators: StructuredLocator[];
}

function parseStructuredHints(raw: string): StructuredHints | null {
  try {
    const parsed = JSON.parse(raw);
    if (parsed?.version === 2 && Array.isArray(parsed.locators) && parsed.locators.length > 0) {
      return parsed as StructuredHints;
    }
    return null;
  } catch {
    return null;
  }
}

export interface ResourceFileInfo {
  filename: string;
  /** Keyword names extracted from *** Keywords *** section */
  keywords: string[];
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
    generationHints?: string | null; // stored per-TC hints (may be StructuredHints JSON)
  };
  project: {
    id: string;
    name: string;
    baseUrl?: string | null;
  };
  existingPOMs: string[]; // filenames of already-generated POM classes
  contextNote?: string;      // ephemeral user-typed context for this run
  domSnippet?: string;       // HTML from DevTools to extract accurate locators
  domRecording?: string;     // QA DOM Recorder export — structured live-session capture
  failedStep?: string;       // step that failed (e.g. "Step 5: Click css=#submit-btn")
  failedStepError?: string;  // error message from the failed step
  scriptMode?: 'PLAYWRIGHT' | 'ROBOT'; // defaults to PLAYWRIGHT
  resourceFiles?: ResourceFileInfo[]; // resource files with keyword names for Robot mode
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
  scriptType: 'PLAYWRIGHT' | 'ROBOT';
}

const SYSTEM_PROMPT_BASE = `You are a senior QA automation engineer.
Generate a production-ready Playwright TypeScript test using @playwright/test
for the target application (baseUrl: {BASE_URL}).
Page Object Model pattern required. Import POMs from ./pages/.
Locator priority: getByTestId > getByRole > getByLabel > CSS. Never use XPath.
Return ONLY raw TypeScript — no markdown fences, no explanations.

{PLATFORM_CONTEXT}

### Base URL — CRITICAL
ALWAYS read the application URL from process.env.BASE_URL — never hardcode any URL.
Do NOT use relative paths in page.goto() — they only work when a playwright.config.ts sets baseURL,
which cannot be assumed at execution time.

Every page.goto() and navigation call MUST use process.env.BASE_URL explicitly:
  BAD:  page.goto('/')                              ← relative path, breaks without playwright config
  BAD:  page.goto('http://any-hardcoded-url/login') ← hardcoded, not portable
  GOOD: page.goto(process.env.BASE_URL!)             ← root navigation
  GOOD: page.goto(\`\${process.env.BASE_URL}/login\`) ← sub-path navigation

The navigate() method in EVERY POM class MUST follow this exact pattern:
  async navigate(): Promise<void> {
    const baseURL = process.env.BASE_URL;
    if (!baseURL) throw new Error('BASE_URL environment variable is not set');
    await this.page.goto(baseURL);
    await this.page.waitForLoadState('domcontentloaded');
  }

For sub-page navigation (e.g. going directly to a settings or list page):
  await this.page.goto(\`\${process.env.BASE_URL}/your-path\`);

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
BAD:  page.goto(\`\${process.env.BASE_URL}/projects/test/dashboard\`)  ← 'test' is a hardcoded slug
GOOD: skip navigation to specific entities, or derive slug/id from a previous step or env var.
If the test case requires navigating into a specific project/entity, use process.env.TEST_PROJECT_SLUG
or note in a comment that the value must be replaced — do not invent a placeholder slug.

### Locked Locators — CRITICAL
When the user context includes a "LOCKED LOCATORS" section, those Playwright statements were captured in a
live browser session and are guaranteed to work. You MUST:
- Copy them verbatim for the steps they map to.
- Never substitute, invent, or modify these locators.
- If a locked locator uses a fill action, use the exact same locator with the appropriate value.
This is the highest-priority instruction — it overrides your default locator preference order.

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
ALWAYS read the application URL from process.env.BASE_URL — never hardcode any URL.
Do NOT use relative paths in page.goto() — they only work when a playwright.config.ts sets baseURL,
which cannot be assumed at execution time.

Every page.goto() and navigation call MUST use process.env.BASE_URL explicitly:
  BAD:  page.goto('/')                              ← relative path, breaks without playwright config
  BAD:  page.goto('http://any-hardcoded-url/login') ← hardcoded, not portable
  GOOD: page.goto(process.env.BASE_URL!)             ← root navigation
  GOOD: page.goto(\`\${process.env.BASE_URL}/login\`) ← sub-path navigation

Since this is self-contained (no POM), the login step MUST start with:
  const baseURL = process.env.BASE_URL;
  if (!baseURL) throw new Error('BASE_URL environment variable is not set');
  await page.goto(baseURL);

For sub-page navigation:
  await page.goto(\`\${process.env.BASE_URL}/your-path\`);

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
BAD:  page.goto(\`\${process.env.BASE_URL}/projects/test/dashboard\`)  ← 'test' is a hardcoded slug
GOOD: skip navigation to specific entities, or derive slug/id from a previous step or env var.
If the test case requires navigating into a specific project/entity, use process.env.TEST_PROJECT_SLUG
or note in a comment that the value must be replaced — do not invent a placeholder slug.

### Locked Locators — CRITICAL
When the user context includes a "LOCKED LOCATORS" section, those Playwright statements were captured in a
live browser session and are guaranteed to work. You MUST:
- Copy them verbatim for the steps they map to.
- Never substitute, invent, or modify these locators.
- If a locked locator uses a fill action, use the exact same locator with the appropriate value.
This is the highest-priority instruction — it overrides your default locator preference order.

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

const SYSTEM_PROMPT_ROBOT = `You are a senior QA automation engineer.
Generate a production-ready Robot Framework test using the Browser library (Playwright backend)
for the target application (baseUrl: {BASE_URL}).
The Browser library uses Playwright under the hood — use its keywords exactly.

{PLATFORM_CONTEXT}

### Base URL — CRITICAL
Read the application URL from the \${BASE_URL} variable — never hardcode any URL.
Every navigation call MUST use: \${BASE_URL}
  BAD:  New Page    https://hardcoded-url/login
  GOOD: New Page    \${BASE_URL}

### Credentials
Use \${TC_USERNAME} and \${TC_PASSWORD} variables — never hardcode credentials.

### Locator strategy — STRICT PRIORITY ORDER
Choose the FIRST strategy that uniquely identifies the element. Never skip ahead.

1. **id=<value>**
   Use when the element has a stable HTML id attribute.
   Examples:  id=username    id=kc-login    id=password
   RF syntax: css=#username  OR  id=username

2. **css=<selector> with data attribute**
   Use when element has a data-testid, data-cy, data-qa or similar test hook.
   Examples:  css=[data-testid=submit-btn]    css=[data-cy=login-form]

3. **css=<selector> with stable attribute**
   Use when element has a stable name, type, role, or aria-label attribute.
   Examples:  css=input[name="username"]    css=button[type="submit"]
              css=[aria-label="Close dialog"]    css=input[placeholder="Search"]

4. **role=<role>[name="<accessible name>"]**
   Use for interactive elements (buttons, links, inputs) identified by their ARIA role
   and visible label — resilient to class/id changes.
   Examples:  role=button[name="Login"]    role=link[name="Dashboard"]
              role=textbox[name="Username"]

5. **text=<visible text>** or **text="<exact text>"**
   Use for links, labels, and buttons identified purely by their visible text.
   Examples:  text=Login    text="Sign In"    text=Forgot Password

6. **css=<class-based selector>**
   Use only when no better anchor exists. Prefer specific, short class chains.
   Examples:  css=.btn-primary    css=.login-form input.email-field
   AVOID: long brittle chains like css=div > div > form > div:nth-child(2) > input

7. **xpath=<expression>**
   LAST RESORT ONLY — use only when no CSS or role selector is possible.
   If you must use XPath, keep it as short and attribute-based as possible.
   Examples:  xpath=//input[@id='username']    xpath=//button[text()='Login']
   NEVER use index-based XPath: xpath=//div[3]/span[2]

### Locator anti-patterns — NEVER do these
- Never hardcode full XPath trees with positional indices
- Never use generated class names (e.g. css=.sc-bdXxxt, css=.css-1x2y3z)
- Never chain more than 3 CSS descendant steps
- For Angular/React apps: prefer id= or data-testid= as they survive re-renders
- NEVER use bare HTML tag selectors (e.g. css=ul, css=div, css=span) — they match dozens of elements and cause strict mode violations. Always add a class, id, role, or attribute to narrow to a single element.
- NEVER use multiple css= prefixes in a single locator argument — this produces invalid CSS and crashes at runtime.
  Each locator argument accepts exactly ONE strategy prefix. Commas inside a single css= are valid CSS multi-selectors; additional css= tokens are not.
  BAD:  Wait For Elements State    css=.sidebar, css=nav, css=[class*="nav"]    visible    \${TIMEOUT}
  BAD:  Click    css=button:has-text("Save"), css=input[type=submit]
  GOOD: Wait For Elements State    css=.sidebar, nav, [class*="nav"]    visible    \${TIMEOUT}
  GOOD: Click    css=button:has-text("Save"), input[type=submit]
  If you need a true OR across incompatible strategies (e.g. css + text), use separate
  Run Keyword And Return Status calls rather than jamming two prefixes together.

### Key Browser library keywords
New Browser    chromium    headless=False
New Context    ignoreHTTPSErrors=True    recordVideo={'dir': '\${OUTPUTDIR}'}
New Page    \${BASE_URL}
Fill Text    <locator>    <value>
Click    <locator>
Wait For Elements State    <locator>    visible    \${TIMEOUT}
Wait For Elements State    <locator>    enabled    \${TIMEOUT}
Get Url
Should Contain    <string>    <substring>
Take Screenshot    filename=\${OUTPUTDIR}/screenshot.png
Get Text    <locator>
Get Element    <locator>
Select Options By    <locator>    value    <value>
Hover    <locator>
Keyboard Input    type    <text>
Sleep    <time>s    # use sparingly — prefer Wait For Elements State

### Screenshot and Video Recording — REQUIRED
Every generated script MUST capture a screenshot and video for run history. You MUST:
1. Configure video in New Context — ALWAYS include \`recordVideo={'dir': '\${OUTPUTDIR}'}\`:
     New Context    ignoreHTTPSErrors=True    recordVideo={'dir': '\${OUTPUTDIR}'}
2. Take a screenshot at the end of EVERY test — add \`Take Screenshot\` as the FIRST line of the
   teardown keyword (before Close Browser), so it captures the final page state on both pass and fail:
     Close Test Session
         Take Screenshot    filename=\${OUTPUTDIR}/screenshot.png
         Close Browser
   This is NON-NEGOTIABLE — run history will not show any assets without these two steps.

### Variables section
Always declare these at minimum:
\${BASE_URL}       (set from environment — do NOT hardcode)
\${TC_USERNAME}    (set from environment)
\${TC_PASSWORD}    (set from environment)
\${TIMEOUT}        30s

### Test structure
- Use *** Keywords *** to extract every reusable action (e.g. Open Application, Login As User)
- Test Cases section should read like a business scenario — one keyword call per logical step
- [Setup] and [Teardown] tags on the test case for browser open/close (teardown = Close Test Session)
- The Close Test Session keyword MUST call Take Screenshot before Close Browser (see above)
- [Tags] on every test: use the use-case tag, test type, and "automation"

### Resource files
ONLY import resource files that are explicitly listed in the prompt under "Available resource files".
If no resource files are listed, do NOT add any Resource imports — do NOT invent filenames like keywords.robot or variables.robot.
When resource files are listed, import them with:
Resource    resources/<filename>.robot
Use keywords from them where applicable rather than repeating logic.

### Locked Locators
When the user prompt includes a LOCKED LOCATORS section, those selectors were captured
in a live browser session and are guaranteed to work. Use them verbatim — convert
Playwright selector syntax (page.locator('css=...')) to RF Browser selector syntax
(css=...) without modification to the selector string itself.

### Output format — use this EXACT separator:
===ROBOT===
<complete .robot file content>

The .robot file MUST have all four sections: *** Settings ***, *** Variables ***, *** Test Cases ***, *** Keywords ***
Do NOT include markdown fences, explanations, or any text outside the ===ROBOT=== block.`;

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

// ── Step-text matching for locked vs reference locators ───────────────────

/**
 * Returns true if `hintStep` (from a stored StructuredHints locator) still
 * matches one of the current TC steps.  Uses normalised substring comparison
 * so minor punctuation/capitalisation edits still match, but a fully rewritten
 * step will not match and its locator will be demoted to "reference" status.
 */
function stepTextMatches(hintStep: string, currentSteps: string[]): boolean {
  if (currentSteps.length === 0) return false;
  const normalize = (s: string) =>
    s.toLowerCase().replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, ' ').trim();
  const nh = normalize(hintStep);
  return currentSteps.some((s) => {
    const ns = normalize(s);
    return ns === nh || ns.includes(nh) || nh.includes(ns);
  });
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
  const llm = createLLM({ temperature: 0.1, agentName: 'script-agent', projectId: input.project.id, projectName: input.project.name });

  const baseUrl = input.project.baseUrl ?? 'http://localhost:3000';
  const isRobot = input.scriptMode === 'ROBOT';
  const selfContained = input.existingPOMs.length === 0;
  const [platformSection, goldenSection] = await Promise.all([
    getProjectPlatformSection(input.project.id, input.testCase.useCaseTag),
    isRobot ? Promise.resolve('') : getGoldenExamples(input.project.id, input.testCase.useCaseTag, selfContained),
  ]);
  const fullPlatformContext = goldenSection
    ? `${platformSection}\n\n${goldenSection}`
    : platformSection;
  let promptTemplate: string;
  if (isRobot) {
    promptTemplate = SYSTEM_PROMPT_ROBOT;
  } else if (selfContained) {
    promptTemplate = SYSTEM_PROMPT_SELF_CONTAINED;
  } else {
    promptTemplate = SYSTEM_PROMPT_BASE;
  }
  const systemPrompt = promptTemplate
    .replace('{BASE_URL}', baseUrl)
    .replace('{PLATFORM_CONTEXT}', fullPlatformContext);

  const steps = parseJsonArray(input.testCase.steps);
  const pomListText = isRobot
    ? ''
    : (input.existingPOMs.length > 0
        ? `\nExisting POMs (do NOT regenerate): ${input.existingPOMs.join(', ')}`
        : '\nNo existing POMs — write self-contained inline code only. Do NOT import from ./pages/.');

  // Robot resource file injection
  const resourceLines: string[] = [];
  if (isRobot && input.resourceFiles && input.resourceFiles.length > 0) {
    resourceLines.push('', '### Resource Files — USE THESE KEYWORDS, do NOT rewrite their logic');
    resourceLines.push('Import all relevant files. Use their keywords instead of duplicating steps.');
    resourceLines.push('Import syntax: Resource    resources/<filename>');
    resourceLines.push('');

    const loginKeywords: string[] = [];
    for (const rf of input.resourceFiles) {
      const kwList = rf.keywords.length > 0 ? rf.keywords.join(', ') : '(no keywords)';
      resourceLines.push(`  - ${rf.filename}`);
      resourceLines.push(`      Keywords: ${kwList}`);
      // Collect login/setup keyword names for the critical rule below
      for (const kw of rf.keywords) {
        const lower = kw.toLowerCase();
        if (lower.includes('login') || lower.includes('open application') || lower.includes('close test') || lower.includes('setup')) {
          loginKeywords.push(kw);
        }
      }
    }

    if (loginKeywords.length > 0) {
      resourceLines.push('');
      resourceLines.push(`CRITICAL — Login/Setup/Teardown keywords are provided by the resource files: ${loginKeywords.join(', ')}`);
      resourceLines.push('Structure your test using ONLY the keyword names listed above — do NOT invent names.');
      resourceLines.push('Typical pattern:');
      resourceLines.push('  [Setup]    <open-session keyword from resource>');
      resourceLines.push('  [Teardown] <close-session keyword from resource>');
      resourceLines.push('  Then call the login keyword as the first step in the test body.');
      resourceLines.push('DO NOT define your own Open/Login/Close keywords — use the exact names from the list above.');
    }
  }

  // Build combined user context: structured/locked locators + ephemeral contextNote
  const contextParts: string[] = [];

  if (input.testCase.generationHints?.trim()) {
    // Surface verified locators written back by runWorker after a passing run
    try {
      const raw = JSON.parse(input.testCase.generationHints.trim());
      if (Array.isArray(raw.verifiedLocators) && raw.verifiedLocators.length > 0) {
        contextParts.push([
          'VERIFIED LOCATORS — extracted from the last passing run of this test case.',
          'These selectors are confirmed to work in the live app. Prefer them over any invented alternatives.',
          '',
          ...(raw.verifiedLocators as string[]).map((l: string) => `  ${l}`),
          ...(raw.lastPassedAt ? [`  (last passed: ${raw.lastPassedAt})`] : []),
        ].join('\n'));
      }
    } catch { /* not JSON — fall through to structured hints parser */ }

    const structured = parseStructuredHints(input.testCase.generationHints.trim());
    if (structured && structured.locators.length > 0) {
      // Split locators: LOCKED if step still matches a current TC step, REFERENCE if step was edited
      const locked: StructuredLocator[] = [];
      const reference: StructuredLocator[] = [];
      for (const loc of structured.locators) {
        if (stepTextMatches(loc.step, steps)) {
          locked.push(loc);
        } else {
          reference.push(loc);
        }
      }

      if (locked.length > 0) {
        contextParts.push([
          'LOCKED LOCATORS — verified in live browser session.',
          'You MUST use these EXACT Playwright statements for the steps they map to.',
          'Do NOT substitute, invent, or modify any of these locators.',
          '',
          ...locked.map(l => `  Step "${l.step}" → ${l.playwright}`),
        ].join('\n'));
      }

      if (reference.length > 0) {
        contextParts.push([
          'REFERENCE LOCATORS from a previous agent trace — the test steps may have changed since these were recorded.',
          'Use them as a starting point where applicable; adapt selectors to match the current test case steps.',
          '',
          ...reference.map(l => `  "${l.step}" → ${l.playwright}`),
        ].join('\n'));
      }
    } else {
      // Legacy free-text hints — pass through as before
      contextParts.push(`Stored hints for this test case:\n${input.testCase.generationHints.trim()}`);
    }
  }

  if (input.domRecording?.trim()) {
    contextParts.push([
      'DOM RECORDING — captured from a live manual execution of this exact test case.',
      'This is the HIGHEST PRIORITY input. Each RECOMMENDED selector was verified in a real browser session.',
      'Rules you MUST follow:',
      '  1. Use the RECOMMENDED selector verbatim for every step it maps to — do NOT invent alternatives.',
      '  2. For SHORT-LIVED TOASTs: assert the toast text IMMEDIATELY after the trigger step with NO Sleep before it.',
      '  3. For FILL steps: use the RECOMMENDED selector and fill with the appropriate test data value.',
      '',
      input.domRecording.trim(),
    ].join('\n'));
  }

  if (input.contextNote?.trim()) {
    contextParts.push(`Additional context provided for this run:\n${input.contextNote.trim()}`);
  }

  if (input.failedStep?.trim() || input.failedStepError?.trim()) {
    const lines = ['FAILED STEP (fix this specifically — do not restructure the whole script unless necessary):'];
    if (input.failedStep?.trim()) lines.push(`  Step: ${input.failedStep.trim()}`);
    if (input.failedStepError?.trim()) lines.push(`  Error: ${input.failedStepError.trim()}`);
    lines.push('');
    lines.push('Instructions:');
    lines.push('  1. Parse the DOM snippet (if provided) to extract the BEST locator using priority: data-testid > id > aria-label > text > css.');
    lines.push('  2. Fix ONLY the broken locators/steps. Do not restructure the entire script unless asked.');
    lines.push('  3. Add a DIFF SUMMARY at the top as comments showing what changed and why.');
    contextParts.push(lines.join('\n'));
  }

  if (input.domSnippet?.trim()) {
    contextParts.push([
      'DOM SNIPPET (from browser DevTools — use this to extract the most stable locator):',
      input.domSnippet.trim(),
      '',
      'Locator extraction priority from this DOM: data-testid > id > aria-label > name attribute > visible text > css class.',
      'Pick the FIRST strategy that uniquely identifies the target element.',
    ].join('\n'));
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
    ...(pomListText ? [pomListText] : []),
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
    ...resourceLines,
    ...(contextParts.length > 0 ? [
      '',
      '### LOCKED LOCATORS & Context — HIGHEST PRIORITY — FOLLOW EXACTLY',
      ...contextParts,
    ] : []),
    ...prereqLines,
    ...healLines,
  ].join('\n');

  const response = await llm.invoke([new SystemMessage(systemPrompt), new HumanMessage(userPrompt)]);

  const content =
    typeof response.content === 'string' ? response.content : JSON.stringify(response.content);

  return parseAgentOutput(content, isRobot ? 'ROBOT' : 'PLAYWRIGHT');
}

function parseJsonArray(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

function parseAgentOutput(raw: string, scriptType: 'PLAYWRIGHT' | 'ROBOT' = 'PLAYWRIGHT'): ScriptAgentResult {
  // ── Robot mode ─────────────────────────────────────────────────────────────
  if (scriptType === 'ROBOT') {
    const robotIdx = raw.indexOf('===ROBOT===');
    let specContent: string;
    if (robotIdx !== -1) {
      specContent = raw.slice(robotIdx + '===ROBOT==='.length).trim();
    } else {
      // Fallback: strip markdown fences if present
      specContent = raw
        .replace(/^```(?:robot|robotframework)?\s*/im, '')
        .replace(/```\s*$/im, '')
        .trim();
    }
    return { specContent, scriptType: 'ROBOT' };
  }

  // ── Playwright mode ────────────────────────────────────────────────────────
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
    return { specContent, scriptType: 'PLAYWRIGHT' };
  }

  const pomRaw = raw.slice(pomIdx + '===POM==='.length).trim();
  const colonIdx = pomRaw.indexOf(':');
  if (colonIdx === -1) {
    return { specContent, scriptType: 'PLAYWRIGHT' };
  }

  const pomFilename = pomRaw.slice(0, colonIdx).trim();
  const pomContent = pomRaw.slice(colonIdx + 1).trim();

  if (!pomFilename || !pomContent) {
    return { specContent, scriptType: 'PLAYWRIGHT' };
  }

  return { specContent, pomContent, pomFilename, scriptType: 'PLAYWRIGHT' };
}
