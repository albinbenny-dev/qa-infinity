import { prisma } from './prisma.js';
import { readScript } from '../services/scriptFileService.js';
import type { LoginInstructions, NavNode, PageLocators, AgentLearning } from '../types/scanner.js';

/**
 * Generates a project-specific Playwright script generation guide for use with
 * Claude Desktop or any external LLM when QA Infinity credits are exhausted.
 *
 * The guide embeds live project context: login flow, navigation map, verified
 * selectors, golden script examples, and heal-derived failure patterns.
 */
export async function generateContextGuide(
  projectId: string,
  projectName: string,
  baseUrl: string,
): Promise<string> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const prismaAny = prisma as any;
  const [ctx, goldenScripts, recentHeals] = await Promise.all([
    prismaAny.projectContext.findUnique({ where: { projectId } }),
    prismaAny.script.findMany({
      where: { projectId, isGolden: true },
      include: { testCase: { select: { tcId: true, title: true, useCaseTag: true } } },
      orderBy: { updatedAt: 'desc' },
      take: 5,
    }),
    prismaAny.heal.findMany({
      where: { projectId, status: { in: ['APPROVED', 'AUTO_APPLIED'] }, summary: { not: null } },
      select: { type: true, summary: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
      take: 25,
    }),
  ]);

  // ctx is typed against the stale local Prisma client; cast to access schema-valid fields
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ctxAny = ctx as any;
  const hasScan = !!ctxAny?.loginInstructions;
  const date = new Date().toISOString().split('T')[0];
  const lines: string[] = [];

  // ── Header ────────────────────────────────────────────────────────────────
  lines.push('# QA Infinity — Playwright Script Generation Guide');
  lines.push(`**Project:** ${projectName}  |  **Base URL:** \`${baseUrl}\`  |  **Generated:** ${date}`);
  lines.push('');
  lines.push('> **How to use:** Add this file as a **Project Instruction** in Claude Desktop (Settings → Project Instructions → Add file). Then browse your app or describe test steps and ask Claude to generate a Playwright script. Import the result back into QA Infinity via Script Agent → ⬆ Import Script.');
  lines.push('');
  lines.push('---');
  lines.push('');

  // ── Section 1: Quick-Start ────────────────────────────────────────────────
  lines.push('## 1. Quick-Start Workflow');
  lines.push('');
  lines.push('**Setup (one-time):**');
  lines.push('1. Open Claude Desktop → create or open a project for this application');
  lines.push('2. Project Settings → Add this file as a Project Instruction');
  lines.push('');
  lines.push('**Per-script workflow:**');
  lines.push('1. Start a new chat in your Claude project');
  lines.push('2. Describe the test you want — paste steps, share screenshots, or browse the UI live');
  lines.push('3. Ask: *"Generate a Playwright TypeScript test script for this following the rules in this guide"*');
  lines.push('4. Save the output as `TC-XXX_test-name.spec.ts`');
  lines.push('5. In QA Infinity: **Script Agent → ⬆ Import Script → Create TC from script**');
  lines.push('   QA Infinity will extract the test case and link it to the script automatically');
  lines.push('6. Review the test case in **TC Library**, approve it, then execute from **Script Agent**');
  lines.push('');
  lines.push('---');
  lines.push('');

  // ── Section 2: Project Context ────────────────────────────────────────────
  lines.push('## 2. This Project\'s Context');
  lines.push('');

  if (!hasScan) {
    lines.push('> **No UI scan found.** Run a UI scan from Project Settings → UI Scanner to auto-populate login flow, navigation, and selectors. Until then, fill in these values manually when prompting Claude:');
    lines.push('');
    lines.push('```');
    lines.push(`Base URL: ${baseUrl}`);
    lines.push('Login URL: [e.g. /auth/login or /]');
    lines.push('Post-login URL: [e.g. /dashboard]');
    lines.push('Username selector: [e.g. #username]');
    lines.push('Password selector: [e.g. #password]');
    lines.push('Submit selector: [e.g. button[type="submit"]]');
    lines.push('Special notes: [e.g. two-step login, MFA, project-selector modal]');
    lines.push('```');
    lines.push('');
  } else {
    const login = JSON.parse(ctxAny.loginInstructions) as LoginInstructions;
    const navMap = ctxAny.navigationMap ? (JSON.parse(ctxAny.navigationMap) as NavNode[]) : [];
    const locators = ctxAny.pageLocators ? (JSON.parse(ctxAny.pageLocators) as Record<string, PageLocators>) : {};
    const learnings = ctxAny.agentLearnings ? (JSON.parse(ctxAny.agentLearnings) as AgentLearning[]) : [];

    // 2.1 Login Flow
    lines.push('### 2.1 Login Flow');
    lines.push('');
    lines.push('| Field | Value |');
    lines.push('|-------|-------|');
    lines.push(`| Login type | ${login.loginType} |`);
    lines.push(`| Post-login URL | \`${login.postLoginUrl}\` |`);
    if (login.notes) lines.push(`| Notes | ${login.notes} |`);
    lines.push(`| Username selector | \`${login.selectors.username || '(not detected)'}\` |`);
    lines.push(`| Password selector | \`${login.selectors.password || '(not detected)'}\` |`);
    lines.push(`| Submit selector | \`${login.selectors.submit || '(not detected)'}\` |`);
    lines.push('');
    if (login.steps.length > 1) {
      lines.push('**Login sequence:**');
      for (const step of login.steps) {
        const sel = step.selector ? ` → \`${step.selector}\`` : '';
        lines.push(`${step.order}. ${step.description}${sel}`);
      }
      lines.push('');
    }
    lines.push('> Credentials come from env vars: `process.env.TC_USERNAME` and `process.env.TC_PASSWORD`');
    lines.push('');

    // 2.2 Navigation Map
    lines.push('### 2.2 Navigation Map');
    lines.push('');
    if (navMap.length === 0) {
      lines.push('*(No navigation map — run UI scanner to capture routes)*');
    } else {
      lines.push('Use these exact relative paths in `page.goto()`:');
      lines.push('');
      function renderNode(node: NavNode, depth: number): void {
        const pad = '  '.repeat(depth);
        lines.push(`${pad}- **${node.label}:** \`${node.url}\``);
        for (const child of (node.children ?? [])) renderNode(child, depth + 1);
      }
      for (const node of navMap.slice(0, 60)) renderNode(node, 0);
    }
    lines.push('');

    // 2.3 Page Locators
    const locEntries = Object.values(locators);
    if (locEntries.length > 0) {
      lines.push('### 2.3 Page Locators (from UI Scanner)');
      lines.push('');
      lines.push('Use these selectors — they were captured from the live application:');
      lines.push('');
      for (const p of locEntries.slice(0, 18)) {
        lines.push(`#### ${p.navLabel} (\`${p.urlPattern}\`)`);
        for (const loc of p.locators.slice(0, 20)) {
          lines.push(`- **${loc.semanticName}:** \`${loc.selector}\``);
        }
        lines.push('');
      }
    }

    // 2.4 Verified Selectors from Agentic Traces
    const validLearnings = learnings
      .filter(l => l.verifiedLocators.length > 0 || l.verifiedFlow.length > 0)
      .slice(-12);
    if (validLearnings.length > 0) {
      lines.push('### 2.4 Verified Selectors (from Agentic Traces)');
      lines.push('');
      lines.push('These selectors were confirmed working in live browser sessions — prefer them over guessing:');
      lines.push('');
      for (const l of validLearnings) {
        lines.push(`#### ${l.menuContext}`);
        for (const loc of l.verifiedLocators.slice(0, 12)) {
          lines.push(`- **${loc.semanticName}:** \`${loc.selector}\``);
        }
        if (l.verifiedFlow.length > 0) {
          lines.push(`- **Flow:** ${l.verifiedFlow.slice(0, 6).join(' → ')}`);
        }
        lines.push('');
      }
    }
  }

  lines.push('---');
  lines.push('');

  // ── Section 3: Verified Examples ─────────────────────────────────────────
  if (goldenScripts.length > 0) {
    lines.push('## 3. Verified Script Examples');
    lines.push('');
    lines.push('These scripts have been verified against the live application. Match their selector patterns, navigation approach, and structure exactly:');
    lines.push('');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const s of goldenScripts as any[]) {
      const label = s.testCase
        ? `${s.testCase.tcId} — ${s.testCase.title}${s.testCase.useCaseTag ? ` [${s.testCase.useCaseTag}]` : ''}`
        : s.filename;
      lines.push(`### ${label}`);
      lines.push('');
      let content = s.content ?? '';
      try { content = readScript(s.projectId, s.filename); } catch { /* fall back to DB content */ }
      lines.push('```typescript');
      lines.push(content.slice(0, 4000));
      if (content.length > 4000) lines.push('// … (truncated)');
      lines.push('```');
      lines.push('');
    }
    lines.push('---');
    lines.push('');
  }

  // ── Section 4: Failure Patterns ───────────────────────────────────────────
  if (recentHeals.length > 0) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const healsWithSummary = (recentHeals as any[]).filter((h: any) => h.summary);
    if (healsWithSummary.length > 0) {
      lines.push('## 4. Known Failure Patterns (Avoid These)');
      lines.push('');
      lines.push('These patterns failed in real runs on this project and were auto-healed. Do not reproduce them:');
      lines.push('');
      const byType = new Map<string, string[]>();
      for (const h of healsWithSummary) {
        const t = h.type ?? 'SELECTOR';
        if (!byType.has(t)) byType.set(t, []);
        byType.get(t)!.push(h.summary!);
      }
      for (const [type, summaries] of byType) {
        const heading =
          type === 'SELECTOR' ? '**Unstable Selectors**'
          : type === 'FLOW' ? '**Timing / Navigation Issues**'
          : type === 'API_SCHEMA' ? '**API Response Changes**'
          : `**${type}**`;
        lines.push(`${heading}:`);
        for (const s of summaries.slice(0, 5)) lines.push(`- ${s}`);
        lines.push('');
      }
      lines.push('---');
      lines.push('');
    }
  }

  // ── Section 5: Rules ──────────────────────────────────────────────────────
  lines.push('## 5. Rules (MUST Follow)');
  lines.push('');
  lines.push('### Critical Rules');
  lines.push('');
  lines.push('| Rule | Correct | Wrong |');
  lines.push('|------|---------|-------|');
  lines.push("| Relative URLs only | `page.goto('/dashboard')` | `page.goto('https://app.com/dashboard')` |");
  lines.push("| Credentials from env | `process.env.TC_USERNAME` | `'admin@example.com'` |");
  lines.push('| Post-login timeout | `toBeVisible({ timeout: 15000 })` | *(default — too short after login)* |');
  lines.push("| No hardcoded slugs/IDs | `process.env.TEST_PROJECT_SLUG` | `'my-project'` |");
  lines.push('| POM contract | Define every method you call | Call undefined POM methods |');
  lines.push('');
  lines.push('### Locator Priority (best → worst)');
  lines.push("1. `getByTestId('data-testid')` — explicit test hooks");
  lines.push("2. `getByRole('button', { name: 'Submit' })` — semantic");
  lines.push("3. `getByLabel('Username')` — form labels");
  lines.push("4. `locator('#css-id')` — CSS");
  lines.push("5. `locator('xpath=//...')` — avoid, fragile");
  lines.push('');
  lines.push('### Shared Login');
  lines.push('When multiple tests need login, use `test.beforeAll` with `storageState` — **never** repeat the full login sequence in every `test()`:');
  lines.push('');
  lines.push('```typescript');
  lines.push('test.beforeAll(async ({ browser }) => {');
  lines.push('  const ctx = await browser.newContext();');
  lines.push('  const page = await ctx.newPage();');
  lines.push("  await page.goto('/');");
  lines.push("  await page.locator('#username').fill(process.env.TC_USERNAME!);");
  lines.push("  await page.locator('#password').fill(process.env.TC_PASSWORD!);");
  lines.push("  await page.locator('#kc-login').click();");
  lines.push("  await page.waitForURL('/dashboard', { timeout: 15000 });");
  lines.push("  await ctx.storageState({ path: 'storageState.json' });");
  lines.push('  await ctx.close();');
  lines.push('});');
  lines.push("test.use({ storageState: 'storageState.json' });");
  lines.push('```');
  lines.push('');
  lines.push('---');
  lines.push('');

  // ── Section 6: Output Format ──────────────────────────────────────────────
  lines.push('## 6. Required Output Format');
  lines.push('');
  lines.push("QA Infinity's script parser requires **exact separator tokens**:");
  lines.push('');
  lines.push('**Pattern A — Self-contained (no POM needed):**');
  lines.push('```');
  lines.push('===SPEC===');
  lines.push("import { test, expect } from '@playwright/test';");
  lines.push('');
  lines.push("test.describe('TC-001 — Test Name', () => {");
  lines.push("  test('should do something', async ({ page }) => {");
  lines.push('    // test body');
  lines.push('  });');
  lines.push('});');
  lines.push('```');
  lines.push('');
  lines.push('**Pattern B — With Page Object Model:**');
  lines.push('```');
  lines.push('===SPEC===');
  lines.push("import { test, expect } from '@playwright/test';");
  lines.push("import { LoginPage } from './pages/LoginPage';");
  lines.push('');
  lines.push("test.describe('TC-001', () => {");
  lines.push("  test('should log in', async ({ page }) => {");
  lines.push('    const loginPage = new LoginPage(page);');
  lines.push('    await loginPage.login(process.env.TC_USERNAME!, process.env.TC_PASSWORD!);');
  lines.push('  });');
  lines.push('});');
  lines.push('===POM===');
  lines.push("LoginPage.ts:import { Page } from '@playwright/test';");
  lines.push('export class LoginPage {');
  lines.push('  constructor(private page: Page) {}');
  lines.push('  async login(username: string, password: string) {');
  lines.push("    await this.page.goto('/');");
  lines.push("    await this.page.locator('#username').fill(username);");
  lines.push("    await this.page.locator('#password').fill(password);");
  lines.push("    await this.page.locator('#kc-login').click();");
  lines.push("    await this.page.waitForURL('/dashboard', { timeout: 15000 });");
  lines.push('  }');
  lines.push('}');
  lines.push('```');
  lines.push('');
  lines.push('> `===POM===` must be followed immediately by `ClassName.ts:` on the same line.');
  lines.push('> Omit `===POM===` entirely for self-contained scripts.');
  lines.push('');
  lines.push('---');
  lines.push('');

  // ── Section 7: Import Instructions ───────────────────────────────────────
  lines.push('## 7. Importing Back Into QA Infinity');
  lines.push('');
  lines.push('1. Save the output as `TC-XXX_test-name.spec.ts`');
  lines.push('2. In QA Infinity → **Script Agent** → **⬆ Import Script**');
  lines.push('3. Select your `.spec.ts` file');
  lines.push('4. Choose import mode:');
  lines.push('   - **Create TC from script** — QA Infinity reads the script and extracts the test case automatically (recommended)');
  lines.push('   - **Link to existing TC** — select a test case already in the library');
  lines.push('   - **Import standalone** — saves the script without linking to a TC');
  lines.push('5. Click **Import**');
  lines.push('6. If you used "Create TC from script", review the extracted TC in **TC Library** (it will be in DRAFT status)');
  lines.push('7. Approve the TC, then run it from **Script Agent** or **Execution**');
  lines.push('');

  return lines.join('\n');
}
