export const PROMPT_GUIDE_VERSION = '1.0.0';

export const PROMPT_GUIDE_CONTENT = `# QA Infinity — External Script Generation Guide
**Version:** ${PROMPT_GUIDE_VERSION}
**Last updated:** 2026-05-25

> **When to use this guide:** When AI usage credits are exhausted, use this document as a complete prompt for any external LLM (ChatGPT, Claude, Gemini) to generate Playwright TypeScript test scripts that are fully compatible with QA Infinity's execution engine.

---

## 1. Quick-Start Prompt Template

Copy the block below into your external LLM, replacing every \`[PLACEHOLDER]\` with your actual values:

\`\`\`
You are a senior QA automation engineer generating production-ready Playwright TypeScript test scripts for a web application called "[YOUR APP NAME]" (baseURL: [YOUR APP BASE URL]).

=== PLATFORM CONTEXT ===

Login URL: [e.g., /auth/login or /]
Post-login URL: [e.g., /dashboard or /projects]
Username field selector: [e.g., #username, [name="username"], or getByLabel('Username')]
Password field selector: [e.g., #password, [name="password"], or getByLabel('Password')]
Submit button selector: [e.g., #kc-login, button[type="submit"], or getByRole('button', { name: 'Sign In' })]
Credentials source: process.env.TC_USERNAME and process.env.TC_PASSWORD

Navigation map (fill in relevant routes):
- Dashboard: /dashboard
- [Module name]: [/path/to/module]
- [Sub-page]: [/path/to/sub-page]

=== TEST CASE ===

ID: [e.g., TC-001]
Title: [Test case title]
Type: UI
Use Case: [e.g., Primary Sales]
Description: [Brief description of what this test covers]
Steps:
  1. [Step 1]
  2. [Step 2]
  3. [Step n]
Expected Result: [What should happen at the end]

Additional hints: [Any specific selectors, routes, or quirks the agent should know]

=== INSTRUCTIONS ===

Follow ALL rules below exactly:

1. Output format — use these exact separator tokens (no markdown fences around them):
===SPEC===
<content of the .spec.ts file>
===POM===
<PomClassName>.ts:<content of the Page Object Model class>

   - If no POM is needed (self-contained), only output ===SPEC=== section.
   - If a POM is needed, output both ===SPEC=== and ===POM=== sections.

2. Use relative URLs only in page.goto() — NEVER hardcode absolute URLs.
   CORRECT: page.goto('/')
   WRONG:   page.goto('https://myapp.com/')

3. Credentials from env: process.env.TC_USERNAME, process.env.TC_PASSWORD

4. Timeout on post-login assertions: { timeout: 15000 }

5. Locator priority: getByRole > getByLabel > getByTestId > CSS selector > XPath

6. Do NOT hardcode slugs, IDs, or entity-specific values that change per installation.

7. Shared login: if multiple tests need login, use test.beforeAll with storageState — never repeat full login in each test.

8. File must import from '@playwright/test', include a test.describe block, use async/await, and assert with expect().

9. POM method contract: every method called on a POM in the spec MUST be defined in the POM class. No undefined method calls.
\`\`\`

---

## 2. Required Output Format

QA Infinity's script parser requires your generated output to use **exact separator tokens**.

### 2.1 Pattern A — Self-Contained (no separate POM file)

Use this when the test is simple or no Page Object Model is needed:

\`\`\`
===SPEC===
import { test, expect } from '@playwright/test';

test.describe('My Test Suite', () => {
  test('TC-001 — should do something', async ({ page }) => {
    // ... test body
  });
});
\`\`\`

### 2.2 Pattern B — POM-based (Page Object Model)

Use this when a Page Object class would reduce repetition or improve readability:

\`\`\`
===SPEC===
import { test, expect } from '@playwright/test';
import { LoginPage } from './pages/LoginPage';

test.describe('My Test Suite', () => {
  test('TC-001 — should do something', async ({ page }) => {
    const loginPage = new LoginPage(page);
    await loginPage.login(process.env.TC_USERNAME!, process.env.TC_PASSWORD!);
    // ... rest of test
  });
});
===POM===
LoginPage.ts:import { Page } from '@playwright/test';

export class LoginPage {
  constructor(private page: Page) {}

  async login(username: string, password: string) {
    await this.page.goto('/');
    await this.page.getByLabel('Username').fill(username);
    await this.page.getByLabel('Password').fill(password);
    await this.page.getByRole('button', { name: 'Sign In' }).click();
    await this.page.waitForURL('/dashboard', { timeout: 15000 });
  }
}
\`\`\`

> **Important:** The ===POM=== separator must be followed immediately by \`<ClassName>.ts:\` on the same line.
> The POM file is saved to \`./pages/<ClassName>.ts\` inside the project's scripts directory.

---

## 3. Platform Context to Include

When prompting the external LLM, always include these details from your project's UI scan:

### 3.1 Login Flow

| Field | Where to find it | Example |
|-------|-----------------|---------|
| Login URL | ProjectSettings > UI Scanner results | \`/auth/realms/airtel/login\` |
| Post-login URL | First URL after successful login | \`/projects\` |
| Username selector | UI Scanner — Login selectors | \`#username\` |
| Password selector | UI Scanner — Login selectors | \`#password\` |
| Submit selector | UI Scanner — Login selectors | \`#kc-login\` |
| Special notes | UI Scanner — Login notes | "Wait for project selector modal" |

**Credentials always come from environment variables:**
\`\`\`typescript
const username = process.env.TC_USERNAME!;
const password = process.env.TC_PASSWORD!;
\`\`\`

### 3.2 URL Routing

- **Always use relative paths** in \`page.goto()\`.
- The Playwright config sets \`baseURL\` from the \`BASE_URL\` environment variable at runtime.
- Route paths come from the Navigation Map captured by the UI Scanner.

\`\`\`typescript
// Correct
await page.goto('/sales/primary');

// Wrong — will break in different environments
await page.goto('https://app.airtel.africa/sales/primary');
\`\`\`

### 3.3 Dynamic Values

Do **NOT** hardcode any values that vary per installation:

| Value type | Wrong | Correct |
|-----------|-------|---------|
| Project slug | \`page.goto('/projects/airtel-ke')\` | \`page.goto('/projects/' + process.env.TEST_PROJECT_SLUG)\` |
| User ID | \`userId = '12345'\` | Fetch from response or env var |
| Entity names | \`'Dealer Corp Ltd'\` | Use test data from env or generate dynamically |

---

## 4. Locator Strategy

**Priority order (most to least preferred):**

1. **\`getByRole\`** — semantic, matches accessibility tree
   \`\`\`typescript
   page.getByRole('button', { name: 'Submit' })
   page.getByRole('textbox', { name: 'Email' })
   \`\`\`

2. **\`getByLabel\`** — form inputs with associated labels
   \`\`\`typescript
   page.getByLabel('Username')
   page.getByLabel('Password')
   \`\`\`

3. **\`getByTestId\`** — explicit test hooks in the DOM
   \`\`\`typescript
   page.getByTestId('submit-btn')
   \`\`\`

4. **CSS selector** — class names, IDs, attributes
   \`\`\`typescript
   page.locator('#kc-login')
   page.locator('[data-cy="login-btn"]')
   \`\`\`

5. **XPath** — last resort, fragile
   \`\`\`typescript
   page.locator('xpath=//button[@type="submit"]')
   \`\`\`

---

## 5. Timeouts & Waiting

| Scenario | Recommended |
|----------|-------------|
| Post-login page assertion | \`{ timeout: 15000 }\` |
| After clicking navigation | \`page.waitForURL('/target-path', { timeout: 10000 })\` |
| After form submit (API response) | \`page.waitForResponse(url => url.includes('/api/'), { timeout: 10000 })\` |
| Dynamic content appearing | \`await expect(locator).toBeVisible({ timeout: 8000 })\` |
| Full page load | \`await page.waitForLoadState('networkidle')\` |

**Default Playwright timeout is 30 seconds** — only override with \`{ timeout: N }\` when you know a specific step is slower or faster.

---

## 6. Critical Rules

### DO

- ✅ Use relative URLs in \`page.goto()\`
- ✅ Read credentials from \`process.env.TC_USERNAME\` and \`process.env.TC_PASSWORD\`
- ✅ Use \`test.describe\` to group related tests
- ✅ Use \`test.beforeAll\` + \`storageState\` when multiple tests need the same login
- ✅ Define every POM method you call in the spec
- ✅ Use \`{ timeout: 15000 }\` on assertions that immediately follow login
- ✅ Use \`await expect(locator).toBeVisible()\` instead of brittle \`waitForTimeout\`
- ✅ Name the .spec.ts file to match the test case ID: e.g., \`TC-001_primary-sales-flow.spec.ts\`

### DO NOT

- ❌ Hardcode absolute URLs
- ❌ Hardcode credentials or personal data
- ❌ Hardcode project slugs, IDs, or entity names
- ❌ Write three or more tests that each independently call login — use \`beforeAll\` instead
- ❌ Call POM methods that are not defined in the POM class body
- ❌ Add unnecessary \`waitForTimeout\` — prefer event-based waits
- ❌ Use \`page.pause()\` or \`test.only()\` in committed scripts
- ❌ Import from paths outside \`./pages/\` (only the POM directory is on the runner's path)

---

## 7. File Naming Convention

| File type | Pattern | Example |
|-----------|---------|---------|
| Spec file | \`TC-{id}_{kebab-title}.spec.ts\` | \`TC-042_dealer-login-flow.spec.ts\` |
| POM file | \`{ModuleName}Page.ts\` | \`DealerOnboardingPage.ts\` |

---

## 8. Common Patterns

### 8.1 Login (Self-Contained)

\`\`\`typescript
import { test, expect } from '@playwright/test';

test.describe('TC-001 — Login flow', () => {
  test('should log in and reach dashboard', async ({ page }) => {
    await page.goto('/');
    await page.locator('#username').fill(process.env.TC_USERNAME!);
    await page.locator('#password').fill(process.env.TC_PASSWORD!);
    await page.locator('#kc-login').click();
    await expect(page).toHaveURL('/dashboard', { timeout: 15000 });
    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible({ timeout: 15000 });
  });
});
\`\`\`

### 8.2 Shared Login with beforeAll

\`\`\`typescript
import { test, expect, Browser } from '@playwright/test';
import path from 'path';

const STATE_FILE = path.join(__dirname, 'storageState.json');

test.describe('TC-010 — Primary Sales Suite', () => {
  test.beforeAll(async ({ browser }) => {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await page.goto('/');
    await page.locator('#username').fill(process.env.TC_USERNAME!);
    await page.locator('#password').fill(process.env.TC_PASSWORD!);
    await page.locator('#kc-login').click();
    await page.waitForURL('/dashboard', { timeout: 15000 });
    await ctx.storageState({ path: STATE_FILE });
    await ctx.close();
  });

  test.use({ storageState: STATE_FILE });

  test('should see sales dashboard', async ({ page }) => {
    await page.goto('/sales');
    await expect(page.getByRole('heading', { name: 'Sales' })).toBeVisible();
  });

  test('should create a new order', async ({ page }) => {
    await page.goto('/sales/new');
    // ... test body
  });
});
\`\`\`

### 8.3 API Response Assertion

\`\`\`typescript
// Wait for the API call triggered by a button click
const [response] = await Promise.all([
  page.waitForResponse(
    (res) => res.url().includes('/api/orders') && res.status() === 200,
    { timeout: 10000 }
  ),
  page.getByRole('button', { name: 'Submit Order' }).click(),
]);
const body = await response.json();
expect(body).toHaveProperty('orderId');
\`\`\`

### 8.4 Form Fill & Submit

\`\`\`typescript
await page.getByLabel('Dealer Name').fill('Test Dealer');
await page.getByLabel('Phone Number').fill('+254700000000');
await page.getByRole('combobox', { name: 'Region' }).selectOption('Nairobi');
await page.getByRole('button', { name: 'Save' }).click();
await expect(page.getByText('Dealer created successfully')).toBeVisible({ timeout: 8000 });
\`\`\`

### 8.5 Table Verification

\`\`\`typescript
const table = page.getByRole('table');
await expect(table).toBeVisible();
const rows = table.getByRole('row');
await expect(rows).not.toHaveCount(0); // at least one data row
// Verify a specific cell
await expect(table.getByRole('cell', { name: 'Active' }).first()).toBeVisible();
\`\`\`

---

## 9. POM Template

When a POM is needed, use this structure:

\`\`\`typescript
import { Page, expect } from '@playwright/test';

export class <ModuleName>Page {
  constructor(private page: Page) {}

  async navigate() {
    await this.page.goto('/<route>');
    await this.page.waitForLoadState('networkidle');
  }

  async <actionName>(<params>) {
    // Perform the action
  }

  async verify<Condition>() {
    await expect(this.page.getByRole('...')).toBeVisible({ timeout: 8000 });
  }
}
\`\`\`

---

## 10. What to Tell the LLM About This Project

Copy the section below and fill in your project details before pasting into the LLM:

\`\`\`
Project name: [Fill from Project Settings]
Base URL: [Fill from Project Settings — this is your app's root URL without trailing slash]
Login type: [form / SSO / keycloak / other]
Post-login URL: [the URL path you land on after a successful login]
Application under test: [brief description, e.g., "B2B sales platform for telecom dealers"]

Login selectors (from UI Scanner):
  - Username: [selector]
  - Password: [selector]
  - Submit:   [selector]
  - Special notes: [any extra steps like MFA, project selector modal, etc.]

Key navigation paths relevant to this test case:
  - [Page name]: [/path]
  - [Page name]: [/path]

Existing POMs in the project (import these instead of recreating):
  - [ClassName].ts — handles [module]
  (leave blank if none)

Test case details:
  ID: [TC-XXX]
  Title: [test case title]
  Steps:
    1. [step]
    2. [step]
  Expected Result: [what should happen]

Any known quirks or hints for this test:
  - [Hint 1]
  - [Hint 2]
\`\`\`

---

## 11. After Generating — How to Import Into QA Infinity

1. Save the LLM output to a \`.spec.ts\` file on your computer.
2. In QA Infinity, go to **Script Agent**.
3. Click the **⬆ Import Script** button in the topbar **or** select your test case, click **+ Generate**, and use the **Import Script** button in the dialog.
4. In the import dialog, select your \`.spec.ts\` file and choose the test case to link it to.
5. Click **Import** — the script will appear in the editor linked to that test case.
6. Review the script in the Monaco editor and save if any edits are needed.
7. Send to Execution to run it.

---

## 12. Healing Patterns to Avoid

As scripts are auto-healed by QA Infinity, the following patterns have been known to fail. Avoid them proactively:

| Pattern to avoid | Use instead |
|-----------------|-------------|
| Brittle \`nth-child\` selectors | \`getByRole\` with \`name\` option |
| Fixed \`waitForTimeout(2000)\` | \`waitForResponse\` or \`toBeVisible\` |
| Full login in every test | \`beforeAll\` + \`storageState\` |
| Hardcoded text that may change locale | \`getByTestId\` or \`getByRole\` |
| Asserting \`.innerText()\` exact match | \`toContainText\` or regex matcher |

> **Note:** This section grows with each script generation cycle. QA engineers should append new patterns discovered during their manual script sessions here.

---

## 13. Changelog

| Date | Change |
|------|--------|
| 2026-05-25 | Initial version — base rules, format, examples, and patterns |

`;
