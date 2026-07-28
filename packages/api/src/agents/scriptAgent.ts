import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import { createLLM, createAnthropicDirectClient } from '../lib/llm.js';
import { prisma } from '../lib/prisma.js';
import { appendAuditLog } from '../lib/llmAudit.js';
import { readScript, listSkillFiles, readSkillFile } from '../services/scriptFileService.js';
import type { LoginInstructions, NavNode, PageLocators, AgentLearning } from '../types/scanner.js';
import type { PatternMemory } from '../services/patternExtractor.js';

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
    /** Project slug — used to locate skill files on disk */
    slug: string;
  };
  existingPOMs: string[]; // filenames of already-generated POM classes
  contextNote?: string;      // ephemeral user-typed context for this run
  qaFeedback?: string;       // QA engineer correction from a prior failed run — injected at highest priority
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
  /** User-selected reference scripts — additional verified scripts to learn patterns from */
  referenceScripts?: Array<{
    tcId: string;
    title: string;
    scriptContent: string;
  }>;
  /**
   * Project-level pattern memory — auto-learned from all verified scripts.
   * Contains proven login block, common locators, and avoid patterns.
   */
  patternMemory?: string | null; // raw JSON from Project.patternMemory
  /**
   * Runtime variables that must be captured dynamically during the test.
   * Each variable has a name (used as {{name}} in steps), where to capture it from,
   * and an optional description.
   */
  runtimeVariables?: Array<{
    name: string;
    captureFrom: string;
    description?: string;
  }> | null;
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
Locator priority: getByTestId > locator('#id') > getByRole > getByLabel > CSS. Never use XPath.
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
- SELECTOR heals: the listed selector was unstable. Prefer getByTestId/locator('#id')/getByRole/getByLabel over it.
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
Locator priority: getByTestId > locator('#id') > getByRole > getByLabel > CSS. Never use XPath.
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
- SELECTOR heals: the listed selector was unstable. Prefer getByTestId/locator('#id')/getByRole/getByLabel over it.
- FLOW heals: timing or navigation was wrong. Add explicit waits, waitForResponse, or waitForLoadState.
- API_SCHEMA heals: response shape changed. Validate only stable fields; avoid brittle assertions.
Absorb these patterns so you do not regenerate scripts that will need the same fix.

Output format — use this exact separator:
===SPEC===
<content of the .spec.ts file>

The spec file must import from '@playwright/test', include a test.describe block,
use async/await, and handle assertions with expect().`;

const SYSTEM_PROMPT_ROBOT = `OUTPUT RULES — READ FIRST, FOLLOW EXACTLY:
- Your response MUST start with ===ROBOT=== on the very first line. No exceptions.
- Do NOT output any reasoning, analysis, thinking, or commentary — not before, not after.
- Do NOT use <think> tags or any internal monologue.
- Do NOT explain what you are about to do or what you did.
- Output ONLY the ===ROBOT=== separator followed immediately by the .robot file content.
- If you feel the urge to think through the problem, do it silently — never write it out.

You are a senior QA automation engineer.
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
- EVERY locator argument passed to a Browser keyword MUST start with a strategy prefix (css=, id=, text=, role=, xpath=).
  A locator with NO prefix is INVALID and will throw a "strict mode violation" or "element not found" error at runtime.
  Apply this rule to EVERY keyword that takes a locator: Click, Fill Text, Wait For Elements State, Get Text, Hover, etc.
  BAD:  Click    [data-testid='login-btn']       ← no prefix → runtime error
  BAD:  Click    #myProfile                      ← no prefix → runtime error
  BAD:  Fill Text    #username    value          ← no prefix → runtime error
  BAD:  Wait For Elements State    input[type='password']    visible    \${TIMEOUT}   ← no prefix
  GOOD: Click    css=[data-testid='login-btn']
  GOOD: Click    css=#myProfile
  GOOD: Fill Text    css=#username    value
  GOOD: Wait For Elements State    css=input[type='password']    visible    \${TIMEOUT}

### Keyword naming — NEVER duplicate keyword names
- Every keyword name in *** Keywords *** MUST be unique within the file.
- If two actions share the same name (e.g. two "Click Login Button" steps), give them distinct names:
  "Submit Username" and "Submit Password" instead of two "Click Login Button" keywords.
- Robot Framework will fail to load a file with duplicate keyword names.

### SeleniumLibrary keywords are FORBIDDEN — use Browser library equivalents only
The ONLY library imported is Browser. SeleniumLibrary is NOT available.
NEVER use these keywords — they will cause "No keyword with name" errors at runtime:
  FORBIDDEN keyword             → Browser library replacement
  Go To <url>                   → New Page    <url>   (only once in Open Test Session; never again)
  Open Browser                  → New Browser + New Context + New Page
  Input Text                    → Fill Text    css=<locator>    <value>
  Click Element / Click Button  → Click    css=<locator>
  Press Keys / Press Key        → Click    css=<locator> THEN Keyboard Input    type    <text>
  Element Should Be Visible     → Wait For Elements State    css=<loc>    visible    \${TIMEOUT}
  Wait Until Element Is Visible → Wait For Elements State    css=<loc>    visible    \${TIMEOUT}
  Get Location                  → Get Url
  Maximize Browser Window       → (not needed)
  Set Selenium Speed            → (not needed)
  Close All Browsers            → Close Browser

The ONLY correct way to type into a field using keyboard:
  Click    css=input[type='password']
  Keyboard Input    type    \${TC_PASSWORD}
Press Keys does NOT exist in the Browser library. Using it will crash the test immediately.

### Key Browser library keywords — copy these patterns EXACTLY including the css= prefix
\${browser_args}=    Create List    --disable-gpu    --no-sandbox    --disable-dev-shm-usage
New Browser    chromium    headless=\${HEADLESS}    args=\${browser_args}
Set Browser Timeout    30s
New Context    ignoreHTTPSErrors=True    recordVideo={'dir': '\${OUTPUTDIR}'}
New Page    \${BASE_URL}    wait_until=domcontentloaded
Fill Text    css=#username    \${TC_USERNAME}
Fill Text    css=input[name='email']    \${TC_USERNAME}
Click    css=button[type='submit']
Click    css=[data-testid='login-btn']
Click    css=#submit
Wait For Elements State    css=#username    visible    \${TIMEOUT}
Wait For Elements State    css=input[type='password']    enabled    \${TIMEOUT}
Wait For Elements State    css=#myProfile    visible    \${TIMEOUT}
Wait For Elements State    css=[data-testid='dashboard']    visible    \${TIMEOUT}
Get Url
Should Contain    \${url}    /#/myProfile
Take Screenshot    filename=\${OUTPUTDIR}/screenshot.png
Get Text    css=#myProfile
Select Options By    css=select[name='role']    value    admin
Hover    css=.menu-item
Click    css=input[type='password']
Keyboard Input    type    \${TC_PASSWORD}
Sleep    2s    # use sparingly — prefer Wait For Elements State

### Keyboard Input — exact usage
Keyboard Input types into the currently focused element. It does NOT accept a locator argument.
ALWAYS Click the target field first to focus it, then call Keyboard Input on the next line.
This is MANDATORY — skipping the Click means the keyboard input goes nowhere.
  BAD:  Keyboard Input    type    \${TC_PASSWORD}                     ← field not focused, input is lost
  BAD:  Keyboard Input    type    \${TC_PASSWORD}    css=#password    ← locator arg is invalid syntax
  GOOD:
        Click    css=input[type='password']
        Keyboard Input    type    \${TC_PASSWORD}

### Variables — exact declaration rules
Declare ONLY these variables in *** Variables ***. Use EXACTLY these names and defaults:
\${BASE_URL}      https://the-actual-base-url
\${TC_USERNAME}   actual_username_value
\${TC_PASSWORD}   actual_password_value
\${TIMEOUT}       30s
\${HEADLESS}      \${TRUE}

NEVER do any of these:
  \${TC_PASSWORD}    \${EMPTY}            ← WRONG — submits blank password, test fails
  \${TC_PASSWORD}    \${None}             ← WRONG — None is not a string, crashes at runtime
  \${TC_PASSWORD}    \${ENV_TC_PASSWORD}  ← WRONG — \${ENV_TC_PASSWORD} is undefined, crashes at load time
  \${TC_PASSWORD}    \${TC_PASSWORD}      ← WRONG — circular reference
  \${TC_PASSWORD}    password_placeholder ← WRONG — hardcoded fake credential
The runner injects the real values at runtime. Just declare the variable with the known value from the test case description.
Do NOT import extra libraries (Collections, String) unless a keyword in the script explicitly uses them.

### Open Test Session — mandatory structure
The Open Test Session keyword MUST follow this exact structure — no deviations:
    Open Test Session
        \${browser_args}=    Create List    --disable-gpu    --no-sandbox    --disable-dev-shm-usage
        New Browser    chromium    headless=\${HEADLESS}    args=\${browser_args}
        Set Browser Timeout    30s
        New Context    ignoreHTTPSErrors=True    recordVideo={'dir': '\${OUTPUTDIR}'}
        New Page    \${BASE_URL}    wait_until=domcontentloaded

Set Browser Timeout    30s is MANDATORY. RF Browser v20 defaults to 10s — too short for enterprise SSO/Keycloak pages.
wait_until=domcontentloaded prevents timeouts when the page loads external resources (fonts, analytics) unreachable from the container.
The browser_args list is MANDATORY for Docker containers: --disable-gpu forces X11 framebuffer rendering (required for VNC live view), --no-sandbox prevents container namespace errors, --disable-dev-shm-usage avoids /dev/shm overflow crashes.
Do NOT add a separate keyword or test step that navigates to the same URL again.
  BAD:  Open Test Session navigates, then test body calls "Open Application" which also navigates.
  GOOD: Open Test Session navigates once. Test body starts directly with the first interaction (e.g. Login).

### headless mode — use \${HEADLESS} variable
ALWAYS write headless=\${HEADLESS} in New Browser — never hardcode True or False.
The runner injects HEADLESS at execution time:
  - Normal/background runs: HEADLESS=True  (fast, no GUI)
  - VNC/headed runs:         HEADLESS=False (browser visible in noVNC viewer)
Declare \${HEADLESS} in *** Variables *** with default \${TRUE}.

### Screenshot and Video Recording — REQUIRED
Every generated script MUST capture a screenshot and video for run history. You MUST:
1. Configure video in New Context — ALWAYS include \`recordVideo={'dir': '\${OUTPUTDIR}'}\`:
     Set Browser Timeout    30s
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
\${HEADLESS}       \${TRUE}

### Step-level logging — MANDATORY in every keyword
Add a Log statement as the FIRST line of every keyword body and before each significant action.
CRITICAL: Always use \`console=True\` so messages appear in BOTH the log.html file AND the live
execution console window. Without console=True the messages are silent during the run.

Correct pattern:
    Login As User
        Log    Logging in as \${TC_USERNAME}    console=True
        Wait For Elements State    css=#username    visible    \${TIMEOUT}
        Fill Text    css=#username    \${TC_USERNAME}
        Click    css=#kc-login
        Log    Username submitted — waiting for password field    console=True
        Wait For Elements State    css=#password    visible    \${TIMEOUT}
        Click    css=#password
        Keyboard Input    type    \${TC_PASSWORD}
        Click    css=#kc-login
        Log    Password submitted — polling for dashboard URL    console=True

    Navigate To Stock Creation Form
        Log    Step 1/3: clicking Stock Creation to expand section    console=True
        Wait For Elements State    text=Stock Creation    visible    \${TIMEOUT}
        Click    text=Stock Creation
        Log    Step 2/3: clicking Stock Management to expand sub-section    console=True
        Wait For Elements State    text=Stock Management    visible    \${TIMEOUT}
        Click    text=Stock Management
        Log    Step 3/3: clicking Stock link to open the Stock page    console=True
        Wait For Elements State    role=link[name="Stock"]    visible    \${TIMEOUT}
        Click    role=link[name="Stock"]
        Log    Stock page loaded — waiting for Create button    console=True
        Wait For Elements State    role=button[name="Create"]    visible    \${TIMEOUT}

    Fill Stock Form
        Log    Filling stock form — PO: \${PO_NUMBER}, GRN: \${GRN}    console=True
        ...
        Log    Selecting warehouse: \${WAREHOUSE}    console=True
        Select Warehouse    \${WAREHOUSE}
        Log    Warehouse selected — entering quantity    console=True

Rules:
- Every keyword MUST start with Log    <description>    console=True
- Add Log    <step description>    console=True before each major sub-action
- Never log selector strings — log the business meaning
- Log messages read as a live narrative in the execution console

### Test structure
- Use *** Keywords *** to extract every reusable action (e.g. Open Application, Login As User)
- Test Cases section should read like a business scenario — one keyword call per logical step
- [Setup] and [Teardown] tags on the test case for browser open/close (teardown = Close Test Session)
- The Close Test Session keyword MUST call Take Screenshot before Close Browser (see above)
- [Tags] on every test: use the use-case tag, test type, and "automation"
- NEVER put inline comments (# Step X: ...) or raw Browser keywords inside *** Test Cases ***
  Every action belongs in a keyword. The test body must contain ONLY keyword calls.
  BAD test body:
      # Step 2: wait for login
      Wait For Elements State    css=#username    visible    \${TIMEOUT}
      Fill Text    css=#username    \${TC_USERNAME}
  GOOD test body:
      Login As User
      Verify My Profile Page

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

### Mandatory Login Skill — overrides all other login sources
When the PRODUCT SKILLS section contains a skill marked "MANDATORY LOGIN SKILL":
1. That skill's login flow is the ONLY source of truth for how to log in.
2. Copy its locators and steps VERBATIM into the Login As User keyword — do NOT change selectors.
3. DO NOT use login steps from any other skill's rawPlaywrightCode, even if those steps look like login.
4. DO NOT use role=textbox[name="Username"] or similar — use whatever selectors are in the mandatory skill.
5. If the mandatory skill has rawPlaywrightCode showing login via Keycloak, convert it to RF using
   the same annotated guidance below, but treat the selectors as authoritative.

### Translating skills / Playwright recordings — critical rules

When a skill (Playwright recording) is provided, apply these rules BEFORE writing any Robot Framework code:

**1. NEVER use the raw Keycloak / SSO redirect URL for New Page.**
The skill's targetUrl often starts with /keycloak/realms/…?state=…&nonce=…. These parameters
are single-use tokens that expire immediately. ALWAYS use \${BASE_URL} in New Page and let
the SSO redirect happen naturally — identical to every other test in this project.

**2. Extract ALL test-data values into Variables.**
Any literal value from the skill (PO numbers, GRN, quantities, serial numbers, product codes,
warehouse names, usernames) MUST become a \${VARIABLE} in *** Variables ***. Never hardcode
them inline inside keywords.

**3. Tab-key sequences mean dependent-field auto-population — preserve them correctly.**
When the recording shows Tab pressed on field A then B then C in sequence (like PO Number → PO
Version Number → ASN Number), it means field B and C are auto-filled by the backend after Tab
from A. Translate this as:
    Fill Text    <field A locator>    \${VALUE}
    Keyboard Key    press    Tab      # triggers backend auto-fill for Version and ASN
    Keyboard Key    press    Tab
    Keyboard Key    press    Tab
Do NOT collapse multiple Tab presses into one, and do NOT add Fill Text calls for auto-filled
fields unless the recording explicitly fills them.

**4. Sidebar navigation — two different element types, two different selectors.**
The Ventas sidebar has TWO kinds of items; use a different selector for each:

TYPE A — Collapsible SECTION HEADERS (role=button, have data-toggle="collapse"):
  These expand to reveal child links. They are NOT <a href> links — they are <a role="button">.
  role=link will NOT match them. Use text= for these:
    Click    text=Stock Creation       ← expands the section
    Click    text=Stock Management     ← expands the sub-section

TYPE B — Leaf NAVIGATION LINKS (role=link, actual <a href> links):
  These navigate to a page. Use role=link[name="..."] for EXACT name matching:
    Click    role=link[name="Stock"]   ← navigates to the Stock page
  NEVER use text=Stock for these — text= does SUBSTRING matching and will match
  every element containing the word "Stock" (Stock View, Stock Transfer, etc.), causing
  a strict mode violation. role=link[name="Stock"] matches ONLY the element whose
  accessible name is exactly "Stock".

Navigation pattern to use:
    Click    text=Stock Creation                  # TYPE A: expand section header
    Wait For Elements State    text=Stock Management    visible    \${TIMEOUT}
    Click    text=Stock Management                # TYPE A: expand sub-section
    Wait For Elements State    role=link[name="Stock"]    visible    \${TIMEOUT}
    Click    role=link[name="Stock"]              # TYPE B: navigate to page

**5. Infinite-select / custom dropdowns: never Fill Text into the trigger element.**
When the skill shows a locator like #sixdee_field_infinite_select_<fieldName> or any
dropdown-like component followed by selecting a text option, generate a dedicated keyword:
    Select <FieldName>
        [Arguments]    \${option}
        Click    css=#sixdee_field_infinite_select_<fieldName>
        Wait For Elements State    text=\${option}    visible    \${TIMEOUT}
        Click    text=\${option}
NEVER do: Fill Text    css=#sixdee_field_<fieldName>    \${option}
That fills a hidden input inside the dropdown widget, not the visible trigger — the UI will
not show the selection and the form will not accept it.

**6. Include EVERY interaction from the skill — do not drop steps.**
Review the rawPlaywrightCode line by line. Every distinct user interaction (click, fill, select,
navigation) MUST appear in the RF script. Common omissions that break tests:
  - Product/item code selection (often a div-based infinite select after quantity)
  - Dropdown option clicks after opening a picker
  - Confirmation dialogs or modal submits
If a step in the Playwright code uses a selector that is hard to replicate exactly (e.g.
page.locator('div').filter({hasText:/^Product Code$/}).nth(3)), use text= or a simpler CSS
equivalent — but DO include the step.

**Navigation sequences — click EVERY step, never skip.**
When the skill shows a navigation path like "Stock Creation → Stock Management → Stock",
ALL THREE clicks are mandatory. Sidebar sections are collapsed by default — clicking
"Stock Management" without first clicking "Stock Creation" to expand it will time out.
Generate the full sequence:
    Click    text=Stock Creation            # expand top-level section — NEVER skip this
    Wait For Elements State    text=Stock Management    visible    \${TIMEOUT}
    Click    text=Stock Management          # expand sub-section — NEVER skip this
    Wait For Elements State    role=link[name="Stock"]    visible    \${TIMEOUT}
    Click    role=link[name="Stock"]        # navigate to page
Do NOT start from step 2 or 3 assuming a prior step is already done.

**7. Role selectors vs text= — choose based on element type and uniqueness.**
Playwright's getByRole(..., {name: '...'}) computes ARIA accessible names which may differ
from visible text. General guidance:
- For CUSTOM components (not native button/input/link): prefer text=<label> to avoid computed-name mismatches.
- For NAVIGATION LINKS (role=link) where the name could be a substring of other elements:
  ALWAYS use role=link[name="ExactName"] — it does exact name matching.
  NEVER use text=<short word> for links — text= is a substring search and will match multiple items.
  Example: text=Stock matches "Stock", "Stock View", "Stock Transfer", "EVD Stock Transfer" etc.
           role=link[name="Stock"] matches ONLY the link whose accessible name is exactly "Stock".
- For sidebar SECTION HEADERS (role=button with collapse toggle): use text= because role=link won't match.

**8. Post-login wait: use URL polling, not Sleep.**
After clicking the final login button, DO NOT use Sleep. Use:
    Wait Until Keyword Succeeds    30s    2s    Dashboard URL Should Load
    Dashboard URL Should Load
        \${url}=    Get Url
        Should Contain    \${url}    \${BASE_URL}    # or a known post-login path fragment

### Output format — MANDATORY:
Your entire response must be exactly this and nothing else:
===ROBOT===
<complete .robot file content>

Rules:
- ===ROBOT=== must be the VERY FIRST characters of your response — no preamble, no "Here is", no "Sure".
- The .robot file MUST have all four sections: *** Settings ***, *** Variables ***, *** Test Cases ***, *** Keywords ***
- No markdown fences, no explanations, no trailing text after the .robot content.
- Any text outside the ===ROBOT=== block will break the parser and the test will not be saved.`;

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
      'Locator priority: getByTestId > locator('#id') > getByRole > getByLabel > CSS. Never use XPath.',
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
  isRobot?: boolean,
): Promise<string> {
  const projectSlugRow = await prisma.project.findUnique({ where: { id: projectId }, select: { slug: true } });
  const projectSlug = projectSlugRow?.slug ?? projectId;

  const scriptTypeFilter = isRobot ? { scriptType: 'ROBOT' as const } : {};

  const goldenScripts = await prisma.script.findMany({
    where: {
      projectId,
      isGolden: true,
      ...scriptTypeFilter,
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
          where: { projectId, isGolden: true, ...scriptTypeFilter },
          include: { testCase: { select: { tcId: true, title: true } } },
          orderBy: { updatedAt: 'desc' },
          take: 1,
        });

  if (scripts.length === 0) return '';

  const fence = isRobot ? 'robot' : 'typescript';
  const matchInstructions = isRobot
    ? 'CRITICAL: Match their login keyword EXACTLY — copy the same selectors (css=#username, css=#kc-login, css=#password), the Keyboard Input pattern for password, and the Dashboard URL polling. Do NOT invent new login selectors.'
    : (selfContained
        ? 'Match their selector style, base URL usage, and navigation patterns. DO NOT copy any import statements — all page interactions must be written inline in a single file.'
        : 'Match their selector style, base URL usage, navigation patterns, and import paths exactly.');

  const lines: string[] = [
    '## Working Examples From This Project',
    'The following scripts have been verified against this application.',
    matchInstructions,
    '',
  ];

  for (const s of scripts) {
    const label = s.testCase
      ? `${s.testCase.tcId} — ${s.testCase.title}`
      : s.filename;
    lines.push(`### Example: ${label}`);
    try {
      const content = readScript(projectSlug, s.filename);
      lines.push(`\`\`\`${fence}`);
      lines.push(content.slice(0, 3000));
      if (content.length > 3000) lines.push('# … (truncated)');
      lines.push('```');
    } catch {
      if (s.content) {
        lines.push(`\`\`\`${fence}`);
        lines.push(s.content.slice(0, 3000));
        if (s.content.length > 3000) lines.push('# … (truncated)');
        lines.push('```');
      }
    }
    lines.push('');
  }

  return lines.join('\n');
}

// ── Project Pattern Memory section ────────────────────────────────────────

function buildPatternMemorySection(raw: string): string[] {
  let memory: PatternMemory;
  try {
    memory = JSON.parse(raw) as PatternMemory;
  } catch {
    return [];
  }

  if (!memory || memory.scriptCount === 0) return [];

  const lines: string[] = [
    '',
    `### PROJECT PATTERN MEMORY — Learned from ${memory.scriptCount} verified script${memory.scriptCount !== 1 ? 's' : ''} in this project`,
    'CRITICAL: These patterns are PROVEN to work in this specific application.',
    'Do NOT invent alternatives. Copy the login block and use the listed locators exactly.',
    '',
  ];

  if (memory.loginBlock) {
    lines.push(
      `#### Verified Login Block (copy this exactly — source: "${memory.loginBlock.sourceTcTitle}")`,
      '```',
      memory.loginBlock.codeSnippet,
      '```',
      '',
    );
  }

  if (memory.provenLocators.length > 0) {
    lines.push('#### Proven Locators (appeared in 2+ working scripts — use these, do not guess)');
    for (const loc of memory.provenLocators) {
      lines.push(`  - ${loc.label}: \`${loc.selector}\` (used in ${loc.frequency} scripts)`);
    }
    lines.push('');
  }

  if (memory.avoidPatterns.length > 0) {
    lines.push('#### Avoid (these caused failures that needed manual fixing)');
    for (const p of memory.avoidPatterns) {
      lines.push(`  ✗ ${p}`);
    }
    lines.push('');
  }

  return lines;
}

// ── Playwright recording annotator for Robot Framework translation ────────

/**
 * Scans rawPlaywrightCode line by line and inserts inline RF translation hints
 * directly before each line that requires a non-obvious transformation.
 * This guides the LLM with explicit "what to do" comments so it does NOT rely
 * on reasoning alone to apply the 8 skill-translation rules.
 */
function annotatePlaywrightCodeForRobot(code: string): { annotated: string; checklist: string[] } {
  const lines = code.split('\n');
  const annotated: string[] = [];
  const checklist: Set<string> = new Set();

  for (const line of lines) {
    const t = line.trim();

    // Rule 1: Keycloak / SSO redirect URL in goto()
    if (
      (t.startsWith('await page.goto') || t.startsWith('page.goto')) &&
      (t.includes('/keycloak/') || t.includes('/realms/') || t.includes('?state=') ||
       t.includes('?nonce=') || t.includes('openid-connect'))
    ) {
      annotated.push(`  // ❌ RULE 1 VIOLATION: This is a one-time SSO redirect URL — NEVER use it in RF.`);
      annotated.push(`  // ✅ CORRECT RF: Open Test Session already calls New Page    \${BASE_URL}    wait_until=domcontentloaded`);
      annotated.push(`  // ✅ Skip this goto entirely — SSO redirect happens automatically from \${BASE_URL}.`);
      checklist.add('SKIP the goto() Keycloak URL — Open Test Session navigates to ${BASE_URL} and SSO fires automatically.');
    }

    // Rule 4: getByRole('link') — distinguish section headers (role=button) from leaf links (role=link)
    const roleLinkMatch = t.match(/getByRole\(\s*['"]link['"]\s*,\s*\{[^}]*name:\s*['"]([^'"]+)['"]/);
    if (roleLinkMatch) {
      const name = roleLinkMatch[1].trim();
      // Known Ventas collapsible section headers — these are role=button, NOT role=link
      const SECTION_HEADERS = ['Stock Creation', 'Stock Management', 'Users', 'Reports', 'Admin', 'Settings', 'Dashboard', 'Inventory', 'Orders', 'Finance'];
      const isKnownHeader = SECTION_HEADERS.some(h => name.toLowerCase().includes(h.toLowerCase()));
      if (isKnownHeader) {
        annotated.push(`  // ⚠️ RULE 4 (TYPE A): "${name}" is a collapsible section HEADER (role=button with data-toggle).`);
        annotated.push(`  // ❌ BAD RF:  Click    role=link[name="${name}"]  ← will FAIL (it's a button, not a link)`);
        annotated.push(`  // ✅ CORRECT:`);
        annotated.push(`  //   Wait For Elements State    text=${name}    visible    \${TIMEOUT}`);
        annotated.push(`  //   Click    text=${name}    ← KEEP THIS STEP — sidebar is collapsed by default`);
        checklist.add(`"${name}" is a section header — use: Click    text=${name}. DO NOT SKIP — sidebar is collapsed.`);
      } else {
        annotated.push(`  // ⚠️ RULE 4 (TYPE B): "${name}" is a leaf navigation link (role=link).`);
        annotated.push(`  // ✅ CORRECT RF: Click    role=link[name="${name}"]  ← exact name match, safe`);
        annotated.push(`  // ❌ NEVER use: Click    text=${name}  ← substring match, will hit multiple sidebar items`);
        checklist.add(`"${name}" is a leaf link — use: Click    role=link[name="${name}"] (NOT text= which is substring).`);
      }
    }

    // Rule 5: infinite-select trigger — detect by #sixdee_field_infinite_select_ ID
    const infiniteSelectMatch = t.match(/#sixdee_field_infinite_select_(\w+)/);
    if (infiniteSelectMatch) {
      const fieldName = infiniteSelectMatch[1];
      const isFill = t.includes('.fill(') || t.includes('.type(');
      if (isFill) {
        annotated.push(`  // ❌ RULE 5 VIOLATION: NEVER Fill Text into an infinite-select trigger.`);
        annotated.push(`  // ✅ CORRECT RF pattern — create a keyword:`);
        annotated.push(`  //   Click    css=#sixdee_field_infinite_select_${fieldName}   ← open dropdown`);
        annotated.push(`  //   Wait For Elements State    text=\${${fieldName.toUpperCase()}}    visible    \${TIMEOUT}`);
        annotated.push(`  //   Click    text=\${${fieldName.toUpperCase()}}               ← select option`);
        checklist.add(`Infinite-select '${fieldName}': use Click→Wait→Click pattern (see Rule 5), NOT Fill Text.`);
      } else {
        annotated.push(`  // ⚠️ RULE 5: This is an infinite-select (custom dropdown).`);
        annotated.push(`  // ✅ RF: Click    css=#sixdee_field_infinite_select_${fieldName}`);
        annotated.push(`  //    Then: Wait For Elements State    text=\${OPTION_VAR}    visible    \${TIMEOUT}`);
        annotated.push(`  //    Then: Click    text=\${OPTION_VAR}`);
        checklist.add(`Infinite-select '${fieldName}': use Click→Wait→Click pattern (see Rule 5).`);
      }
    }

    // Rule 3: keyboard.press('Tab') — auto-fill trigger
    if (t.includes("keyboard.press('Tab')") || t.includes('keyboard.press("Tab")')) {
      annotated.push(`  // ⚠️ RULE 3: Tab triggers backend auto-fill for the NEXT field — preserve it.`);
      annotated.push(`  // ✅ RF: Keyboard Key    press    Tab`);
      checklist.add('Tab presses trigger auto-fill — translate each one as: Keyboard Key    press    Tab');
    }

    // Rule 2 hint: numeric/string literals that are test data values
    const fillMatch = t.match(/\.fill\(['"]([^'"]{3,})['"]\)/);
    if (fillMatch && !t.includes('BASE_URL') && !t.includes('username') && !t.includes('password')) {
      const val = fillMatch[1];
      // Only hint if the value looks like test data (not a selector)
      if (/^[A-Za-z0-9_\-. ]+$/.test(val) && !val.startsWith('css=') && !val.startsWith('#')) {
        annotated.push(`  // ⚠️ RULE 2: Extract test data to a \${VARIABLE} — do NOT hardcode "${val}" inline.`);
        checklist.add(`Extract hardcoded values (like "${val}") into *** Variables *** section.`);
      }
    }

    annotated.push(line);
  }

  return {
    annotated: annotated.join('\n'),
    checklist: Array.from(checklist),
  };
}

// ── Product Skills injection ──────────────────────────────────────────────

function buildSkillsSection(skills: ScriptAgentInput['skills'], isRobot: boolean): string[] {
  if (!skills || skills.length === 0) return [];

  const lines: string[] = [
    '',
    '### PRODUCT SKILLS — verified app knowledge (use EXACTLY, do not guess or invent)',
    '',
  ];

  for (const skill of skills) {
    try {
      const content = JSON.parse(skill.content) as Record<string, unknown>;
      const lowConf = skill.confidence < 0.7 ? ' [LOW CONFIDENCE — verify before use]' : '';
      const recorded = skill.captureMethod === 'USER_RECORDED' ? ' [RECORDED IN LIVE BROWSER — highest trust]' : '';

      // Detect dedicated login skill — name or scope contains "login"
      const isLoginSkill =
        skill.skillType === 'UI_FLOW' &&
        (skill.name.toLowerCase().includes('login') ||
          (skill.scope?.toLowerCase().includes('login') ?? false));

      if (isLoginSkill) {
        lines.push('');
        lines.push('╔══════════════════════════════════════════════════════════════╗');
        lines.push('║  MANDATORY LOGIN SKILL — HIGHEST PRIORITY                   ║');
        lines.push('║  This is the ONLY authoritative login flow for this app.    ║');
        lines.push('║  EVERY generated script MUST use EXACTLY these login steps. ║');
        lines.push('║  DO NOT invent or derive login from any other skill.         ║');
        lines.push('╚══════════════════════════════════════════════════════════════╝');
        lines.push('');
      }

      lines.push(`#### [${skill.skillType}] ${skill.name}${skill.scope ? ` — scope: ${skill.scope}` : ''}${recorded}${lowConf}`);

      switch (skill.skillType) {
        case 'UI_FLOW': {
          if (content.targetUrl) lines.push(`  Target URL: ${content.targetUrl}`);
          if (Array.isArray(content.navigationPath) && content.navigationPath.length) {
            lines.push(`  Navigation path: ${(content.navigationPath as string[]).join(' → ')}`);
          }
          if (content.loginRequired !== undefined) {
            lines.push(`  Login required: ${content.loginRequired}`);
          }
          if (Array.isArray(content.locators) && content.locators.length) {
            lines.push(skill.captureMethod === 'USER_RECORDED'
              ? '  RECORDED locators — copy these VERBATIM, do NOT substitute or invent alternatives:'
              : '  Locators (use as ground truth):');
            for (const loc of content.locators as Array<{
              semanticName: string; selector: string; locatorType: string; interactionNote?: string;
            }>) {
              lines.push(`    - ${loc.semanticName}: "${loc.selector}" [${loc.locatorType}]${loc.interactionNote ? ` — ${loc.interactionNote}` : ''}`);
            }
          }
          if (Array.isArray(content.stateTransitions) && content.stateTransitions.length) {
            lines.push('  State transitions:');
            for (const st of content.stateTransitions as Array<{ trigger: string; resultState: string; waitCondition?: string }>) {
              lines.push(`    - After "${st.trigger}" → ${st.resultState}${st.waitCondition ? ` (wait for: ${st.waitCondition})` : ''}`);
            }
          }
          if (Array.isArray(content.steps) && content.steps.length) {
            const captureSteps = (content.steps as Array<{ action?: string; target?: string; captureAs?: string; value?: string; expectedOutcome?: string }>)
              .filter(s => s.captureAs);
            if (captureSteps.length > 0) {
              lines.push('  RUNTIME VARIABLES — these values are generated at runtime and MUST be captured dynamically:');
              lines.push('  Rules: emit capture code for each variable; substitute {{name}} references in later steps.');
              for (const s of captureSteps) {
                lines.push(`    {{${s.captureAs}}}  →  capture from: "${s.target}"`);
              }
            }
            const nonCapture = (content.steps as Array<{ action?: string; target?: string; captureAs?: string; value?: string; expectedOutcome?: string }>)
              .filter(s => s.action && s.action !== 'capture');
            if (nonCapture.length > 0) {
              lines.push('  Flow steps:');
              for (const s of nonCapture) {
                const val = s.value ? ` → "${s.value}"` : '';
                lines.push(`    [${s.action}] ${s.target}${val}${s.expectedOutcome ? ` — expect: ${s.expectedOutcome}` : ''}`);
              }
            }
          }
          if (Array.isArray(content.runtimeVariables) && (content.runtimeVariables as Array<unknown>).length > 0) {
            lines.push('  RUNTIME VARIABLES (declared on skill) — capture these dynamically, never hardcode:');
            for (const v of content.runtimeVariables as Array<{ name: string; captureFrom: string; description?: string }>) {
              const desc = v.description ? ` — ${v.description}` : '';
              lines.push(`    {{${v.name}}}  →  capture from: "${v.captureFrom}"${desc}`);
            }
          }
          if (typeof content.rawPlaywrightCode === 'string' && content.rawPlaywrightCode.trim()) {
            if (isRobot) {
              const raw = content.rawPlaywrightCode.trim().slice(0, 3000);
              const { annotated, checklist } = annotatePlaywrightCodeForRobot(raw);

              if (checklist.length > 0) {
                lines.push('  ⚠️  RF TRANSFORMATION CHECKLIST — apply EVERY item before writing the script:');
                for (const item of checklist) {
                  lines.push(`    • ${item}`);
                }
                lines.push('');
              }

              lines.push('  Recorded Playwright flow (each line annotated with the REQUIRED RF translation):');
              lines.push('  ---');
              for (const l of annotated.split('\n')) lines.push(`  ${l}`);
              lines.push('  ---');
            } else {
              lines.push('  Recorded Playwright code — exact selectors confirmed in live session (copy verbatim):');
              lines.push('  ---');
              const code = content.rawPlaywrightCode.trim().slice(0, 2500);
              for (const l of code.split('\n')) lines.push(`  ${l}`);
              lines.push('  ---');
            }
          }
          break;
        }
        case 'USER_ROLE': {
          const creds = content.testCredentials as { username?: string; password?: string } | undefined;
          if (creds?.username || creds?.password) {
            lines.push('  Test credentials for this role:');
            if (creds.username) lines.push(`    TC_USERNAME = ${creds.username}`);
            if (creds.password) lines.push(`    TC_PASSWORD = ${creds.password}`);
            lines.push('  Use these values in the ${TC_USERNAME} and ${TC_PASSWORD} variables.');
          }
          if (Array.isArray(content.permissions) && content.permissions.length) {
            lines.push(`  Permissions: ${(content.permissions as string[]).slice(0, 5).join('; ')}`);
          }
          if (Array.isArray(content.restrictions) && content.restrictions.length) {
            lines.push(`  Restrictions: ${(content.restrictions as string[]).slice(0, 5).join('; ')}`);
          }
          break;
        }
        case 'TEST_DATA': {
          if (content.validData) lines.push(`  Valid data (use exact values): ${JSON.stringify(content.validData).slice(0, 400)}`);
          if (content.referenceData) lines.push(`  Reference data (IDs, codes, options): ${JSON.stringify(content.referenceData).slice(0, 400)}`);
          break;
        }
        case 'UX_DESIGN': {
          if (content.exactCopy) lines.push(`  Exact UI text (use verbatim in assertions): ${JSON.stringify(content.exactCopy).slice(0, 400)}`);
          if (Array.isArray(content.requiredFields)) lines.push(`  Required fields: ${(content.requiredFields as string[]).join(', ')}`);
          break;
        }
        case 'HISTORICAL': {
          // Human context (QA correction) takes priority over JSON fields
          const human = (skill as { humanContext?: string | null }).humanContext?.trim();
          if (human) {
            lines.push('  ⚠️ QA CORRECTION — do not repeat this failure:');
            lines.push(`  ${human}`);
          } else {
            if (content.issue) lines.push(`  Issue: ${content.issue}`);
            if (content.correction) lines.push(`  Correction: ${content.correction}`);
          }
          if (content.tcId) lines.push(`  Source TC: ${content.tcId}${content.tcTitle ? ` — ${content.tcTitle}` : ''}`);
          break;
        }
        case 'LOCATOR_GUIDE': {
          if (content.summary) lines.push(`  ${String(content.summary).slice(0, 600)}`);
          if (Array.isArray(content.locators)) {
            lines.push('  ID patterns (use these patterns when generating locators):');
            for (const loc of (content.locators as Array<{ pattern?: string; example?: string; notes?: string }>) .slice(0, 10)) {
              const note = loc.notes ? ` — ${loc.notes}` : '';
              lines.push(`    ${loc.pattern ?? ''}${loc.example ? ` (e.g. ${loc.example})` : ''}${note}`);
            }
          }
          break;
        }
        case 'TEST_CASE_DOC': {
          if (content.summary) lines.push(`  Summary: ${String(content.summary).slice(0, 400)}`);
          if (Array.isArray(content.scenarios)) {
            lines.push('  Test scenarios defined in this document:');
            for (const s of (content.scenarios as Array<{ name?: string; steps?: string[] }>).slice(0, 5)) {
              if (s.name) lines.push(`    • ${s.name}`);
            }
          }
          break;
        }
        default:
          break;
      }
      lines.push('');
    } catch {
      // skip malformed skill content
    }
  }

  return lines;
}

export async function runScriptAgent(input: ScriptAgentInput): Promise<ScriptAgentResult> {
  const llm = createLLM({ temperature: 0.1, agentName: 'script-agent', projectId: input.project.id, projectName: input.project.name });

  const baseUrl = input.project.baseUrl ?? 'http://localhost:3000';
  const isRobot = input.scriptMode === 'ROBOT';
  const selfContained = input.existingPOMs.length === 0;
  const [platformSection, goldenSection] = await Promise.all([
    getProjectPlatformSection(input.project.id, input.testCase.useCaseTag),
    getGoldenExamples(input.project.id, input.testCase.useCaseTag, selfContained, isRobot),
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

  // QA feedback always goes first — it overrides everything below
  if (input.qaFeedback?.trim()) {
    contextParts.push([
      '⚠️  QA ENGINEER CORRECTION — HIGHEST PRIORITY',
      '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
      'The previous version of this script was run by a QA engineer and failed.',
      'They have provided the following correction. You MUST address it in this',
      'generation. Do NOT repeat the failing approach.',
      '',
      input.qaFeedback.trim(),
      '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
    ].join('\n'));
  }

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

  // Runtime variable capture instructions
  if (input.runtimeVariables && input.runtimeVariables.length > 0) {
    const varLines = [
      'RUNTIME VARIABLES — these values are generated by the app at runtime and must be captured dynamically.',
      'Rules you MUST follow:',
      '  1. For each variable, emit code that waits for the element to appear and captures its text into a named variable.',
      '  2. Wherever you see {{varName}} in the test steps, substitute it with the captured variable — do NOT hardcode a literal value.',
      '  3. For Playwright: use `const varName = await page.locator(...).textContent()` then `varName.trim()`.',
      '  4. For Robot Framework: use `${varName}=    Get Text    <locator>` then reference `${varName}` in subsequent steps.',
      '  5. Add a log/console.log after each capture so failures are easy to debug.',
      '',
      'Variables to capture:',
    ];
    for (const v of input.runtimeVariables) {
      const desc = v.description ? ` — ${v.description}` : '';
      varLines.push(`  {{${v.name}}}  →  capture from: "${v.captureFrom}"${desc}`);
    }
    contextParts.push(varLines.join('\n'));
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

  // Read all active skill files from disk — then filter by tier + TC feature group
  const skillFileList = listSkillFiles(input.project.slug);
  const skillsFromFiles: Array<{
    skillType: string; name: string; scope: string | null;
    featureGroup?: string | null; tier?: string | null;
    humanContext?: string | null;
    content: string; confidence: number; captureMethod: string;
  }> = [];
  for (const filename of skillFileList) {
    try {
      const data = readSkillFile(input.project.slug, filename);
      skillsFromFiles.push(data);
    } catch { /* skip unreadable */ }
  }

  // Tier-based filtering: GLOBAL always injected; FEATURE/HISTORICAL only when featureGroup matches TC's useCaseTag
  const tcFeatureGroup = input.testCase.useCaseTag?.toLowerCase().trim();
  const filteredSkills = skillsFromFiles.filter((skill) => {
    const tier = skill.tier ?? 'FEATURE';
    if (tier === 'GLOBAL') return true;
    if (tier === 'FEATURE' || tier === 'HISTORICAL') {
      const skillFG = skill.featureGroup?.toLowerCase().trim();
      // No featureGroup on the skill → applies to all TCs (treat as global)
      if (!skillFG) return true;
      // featureGroup set → only inject when TC's useCaseTag matches
      return !!tcFeatureGroup && skillFG === tcFeatureGroup;
    }
    return true;
  });

  // Login skills always first so they dominate the MANDATORY LOGIN banner
  const sortedSkills = [...filteredSkills].sort((a, b) => {
    const aLogin = a.skillType === 'UI_FLOW' &&
      (a.name.toLowerCase().includes('login') || (a.scope?.toLowerCase().includes('login') ?? false));
    const bLogin = b.skillType === 'UI_FLOW' &&
      (b.name.toLowerCase().includes('login') || (b.scope?.toLowerCase().includes('login') ?? false));
    if (aLogin && !bLogin) return -1;
    if (!aLogin && bLogin) return 1;
    return b.confidence - a.confidence;
  });

  // Build product skills section — inject BEFORE pattern memory so skills ground general knowledge
  const skillLines = buildSkillsSection(sortedSkills.length > 0 ? sortedSkills : undefined, isRobot);

  // Build project pattern memory section — inject proven login/locator patterns
  const patternMemoryLines = input.patternMemory?.trim()
    ? buildPatternMemorySection(input.patternMemory.trim())
    : [];

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
    const fence = isRobot ? 'robot' : 'typescript';
    const truncMarker = isRobot ? '# … (truncated)' : '// … (truncated)';
    const rfInstructions = [
      'MANDATORY RULES FOR ROBOT FRAMEWORK:',
      '1. Copy the Login As User keyword VERBATIM — same selector names (css=#username, css=#kc-login, etc.),',
      '   same Keyboard Input pattern for the password field, same Wait Until Keyword Succeeds polling.',
      '2. DO NOT use role=textbox[name="Username"] — the app uses css=#username (Keycloak field IDs).',
      '3. DO NOT use Fill Text for the password field — use Click + Keyboard Input type to enable the button.',
      '4. DO NOT use Sleep after login — use Wait Until Keyword Succeeds 30s 2s Dashboard URL Should Load.',
      '5. The Open Test Session keyword structure is defined in *** Keywords *** — copy it exactly.',
    ].join('\n');
    const pwInstructions = [
      'INSTRUCTIONS FOR USING THE PREREQUISITE:',
      '1. Study the login flow and navigation pattern from the script above.',
      '2. Your generated test MUST start from the same end-state as the prerequisite script.',
      '3. In a test.beforeAll or at the start of your test, reproduce the login + navigation',
      '   steps shown above — copy the exact selectors and waits, do NOT invent new ones.',
      '4. After the setup, write ONLY the new steps specific to this test case.',
      '5. Do NOT add another login block — the setup from the prerequisite covers it.',
    ].join('\n');
    prereqLines.push(
      '',
      '### VERIFIED LOGIN PATTERN — CRITICAL: COPY THIS EXACTLY, DO NOT INVENT LOGIN STEPS',
      `The following ${isRobot ? 'Robot Framework' : 'Playwright'} script for ${input.prerequisiteScript.tcId} — "${input.prerequisiteScript.title}"`,
      'is a VERIFIED, PASSING script. Its login keyword uses selectors confirmed to work in this application.',
      '',
      `\`\`\`${fence}`,
      cap,
      ...(truncated ? [truncMarker] : []),
      '```',
      '',
      isRobot ? rfInstructions : pwInstructions,
    );
  }

  // Build reference scripts context — additional user-selected scripts to learn patterns from
  const refLines: string[] = [];
  if (input.referenceScripts && input.referenceScripts.length > 0) {
    const fence = isRobot ? 'robot' : 'typescript';
    refLines.push(
      '',
      '### REFERENCE SCRIPTS — LEARN PATTERNS FROM THESE VERIFIED SCRIPTS',
      'The following passing scripts demonstrate selectors and keywords that work in this application.',
      'Reuse the same locators, waits, and keyword structure wherever applicable.',
    );
    for (const ref of input.referenceScripts) {
      const cap = ref.scriptContent.slice(0, 3000);
      const truncated = ref.scriptContent.length > 3000;
      const truncMarker = isRobot ? '# … (truncated)' : '// … (truncated)';
      refLines.push(
        '',
        `#### Reference: ${ref.tcId} — "${ref.title}"`,
        `\`\`\`${fence}`,
        cap,
        ...(truncated ? [truncMarker] : []),
        '```',
      );
    }
  }

  const userPromptParts = [
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
    ...patternMemoryLines,
    ...(contextParts.length > 0 ? [
      '',
      '### LOCKED LOCATORS & Context — HIGHEST PRIORITY — FOLLOW EXACTLY',
      ...contextParts,
    ] : []),
    ...prereqLines,
    ...refLines,
    ...healLines,
  ];

  const directClient = createAnthropicDirectClient();

  // Always prefer the native Anthropic SDK when available — the LangChain ChatAnthropic path
  // sends top_p: -1 (its "unset" sentinel) which newer Claude models reject with a 400.
  if (directClient) {
    // Skills as a cached document block when present — stable cache key independent of main prompt.
    const systemBlocks: Array<{ type: 'text'; text: string; cache_control?: { type: 'ephemeral' } }> =
      skillLines.length > 0
        ? [
            { type: 'text', text: skillLines.join('\n'), cache_control: { type: 'ephemeral' } },
            { type: 'text', text: systemPrompt },
          ]
        : [{ type: 'text', text: systemPrompt }];
    const model = process.env.ANTHROPIC_MODEL ?? 'claude-opus-4-8';
    const startMs = Date.now();
    const stream = directClient.messages.stream({
      model,
      max_tokens: 32000,
      system: systemBlocks,
      messages: [{ role: 'user', content: userPromptParts.join('\n') }],
    });
    const message = await stream.finalMessage();
    const durationMs = Date.now() - startMs;
    const textBlock = message.content.find((b): b is { type: 'text'; text: string } => b.type === 'text');
    const content = textBlock?.text ?? '';
    void prisma.llmCall.create({
      data: {
        agentName: 'script-agent',
        projectId: input.project.id,
        projectName: input.project.name,
        model,
        promptTokens: message.usage.input_tokens,
        completionTokens: message.usage.output_tokens,
        totalTokens: message.usage.input_tokens + message.usage.output_tokens,
        durationMs,
      },
    }).catch((err) => console.error('[usage-tracker] DB write failed:', err));
    appendAuditLog({
      agent: 'script-agent',
      model,
      projectId: input.project.id,
      projectName: input.project.name,
      promptTokens: message.usage.input_tokens,
      completionTokens: message.usage.output_tokens,
      durationMs,
      system: systemBlocks,
      user: userPromptParts.join('\n'),
      response: content,
    });
    return parseAgentOutput(content, isRobot ? 'ROBOT' : 'PLAYWRIGHT');
  }

  // LangChain path (OpenRouter only): inject skills as text in user message
  const userPrompt = [...userPromptParts, ...skillLines].join('\n');
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

// ── Robot script post-processor ───────────────────────────────────────────
// Fixes known mechanical errors that local LLMs emit repeatedly despite prompt instructions.

const BROWSER_LOCATOR_KEYWORDS = [
  'Fill Text', 'Click', 'Wait For Elements State', 'Get Text', 'Get Element',
  'Hover', 'Select Options By', 'Focus', 'Type Text', 'Drag And Drop',
  'Mouse Button', 'Scroll To Element',
];

// Locator patterns that need a css= prefix — bare CSS selectors with no strategy
const BARE_LOCATOR_RE = /^(#[\w-]+|\[[\w-]|input\[|button\[|select\[|textarea\[|div\[|span\[|\.[\w-])/;
const HAS_STRATEGY_RE = /^(css=|id=|xpath=|text=|role=|data-testid=|link=|partial link=)/i;

function addCssPrefix(locator: string): string {
  const trimmed = locator.trim();
  if (HAS_STRATEGY_RE.test(trimmed)) return locator; // already has a prefix
  if (BARE_LOCATOR_RE.test(trimmed)) return locator.replace(trimmed, `css=${trimmed}`);
  return locator;
}

function sanitizeRobotScript(script: string): string {
  const lines = script.split('\n');
  const out: string[] = [];

  for (const line of lines) {
    let fixed = line;

    // 1. (headless override removed — runner always provides a display via xvfb-run or VNC)

    // 2. Fix ${TC_PASSWORD} bad defaults
    fixed = fixed.replace(/(\$\{TC_PASSWORD\})\s+\$\{EMPTY\}/, '$1    ');
    fixed = fixed.replace(/(\$\{TC_PASSWORD\})\s+\$\{None\}/, '$1    ');
    fixed = fixed.replace(/(\$\{TC_PASSWORD\})\s+\$\{ENV_\w+\}/, '$1    ');

    // 2b. Fix Fill Text on the password field → Keyboard Input
    // The Keycloak login button only becomes enabled after a real keyboard event.
    // Fill Text uses Playwright's .fill() which bypasses the Angular/React change event,
    // so the kc-login button stays disabled and the test hangs waiting for it to enable.
    // Replace any: Fill Text    <any-locator>    ${TC_PASSWORD}
    // With:        Keyboard Input    type    ${TC_PASSWORD}
    // (The preceding Click on the field is still required and remains unchanged.)
    if (/^\s+Fill Text\s+\S.*\$\{TC_PASSWORD\}\s*$/.test(fixed)) {
      const indent = fixed.match(/^(\s+)/)?.[1] ?? '    ';
      fixed = `${indent}Keyboard Input    type    \${TC_PASSWORD}`;
    }

    // 3. Add css= prefix to bare locators in Browser keyword lines
    const trimmedLine = fixed.trimStart();
    const isKeywordLine = BROWSER_LOCATOR_KEYWORDS.some(kw =>
      trimmedLine.startsWith(kw + '    ') || trimmedLine.startsWith(kw + '\t'),
    );
    if (isKeywordLine) {
      // Split on 2+ spaces or tab to get arguments
      const indent = fixed.match(/^(\s*)/)?.[1] ?? '';
      const parts = trimmedLine.split(/  +|\t/);
      // parts[0] = keyword, parts[1] = first arg (usually the locator)
      if (parts.length >= 2) {
        parts[1] = addCssPrefix(parts[1]);
        fixed = indent + parts.join('    ');
      }
    }

    out.push(fixed);
  }

  return out.join('\n');
}

function parseAgentOutput(raw: string, scriptType: 'PLAYWRIGHT' | 'ROBOT' = 'PLAYWRIGHT'): ScriptAgentResult {
  // Strip <think>...</think> blocks that Qwen/local models emit before the output
  raw = raw.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();

  // ── Robot mode ─────────────────────────────────────────────────────────────
  if (scriptType === 'ROBOT') {
    const robotIdx = raw.indexOf('===ROBOT===');
    let specContent: string;
    if (robotIdx !== -1) {
      specContent = raw.slice(robotIdx + '===ROBOT==='.length).trim();
    } else {
      // Fallback 1: extract from markdown fence
      const fenceMatch = raw.match(/```(?:robot|robotframework)?\s*([\s\S]*?)```/i);
      if (fenceMatch) {
        specContent = fenceMatch[1].trim();
      } else {
        // Fallback 2: find the first *** Settings *** header — everything from there is the .robot file
        const rfIdx = raw.search(/\*{3}\s*Settings\s*\*{3}/i);
        specContent = rfIdx !== -1 ? raw.slice(rfIdx).trim() : raw.trim();
      }
    }
    return { specContent: sanitizeRobotScript(specContent), scriptType: 'ROBOT' };
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
