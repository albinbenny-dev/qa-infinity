// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore — @langchain/core is a transitive dep; types resolved at runtime
import { HumanMessage, SystemMessage, AIMessage, ToolMessage } from '@langchain/core/messages';
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
import type { BaseMessage } from '@langchain/core/messages';
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
import { DynamicStructuredTool } from '@langchain/core/tools';
import { z } from 'zod';
import type { Page } from 'playwright-core';
import { createLLM } from '../lib/llm.js';
import {
  compressScreenshot,
  hasPageChangedSignificantly,
  jpegDataPrefix,
} from '../lib/imageOptimizer.js';
import type {
  RecordedAction,
  BrowserAgentResult,
  AgentFinishData,
  SelectorType,
  LoginInstructions,
  AgentLearning,
} from '../types/scanner.js';

// ── Types ──────────────────────────────────────────────────────────────────

export interface BrowserAgentProductContext {
  /** Previous verified flows from agentic traces for any feature */
  agentLearnings: AgentLearning[];
  /** All pages discovered during the project UI scan */
  navigationMap: Array<{ label: string; url: string }>;
  /** Already-saved test cases for this specific feature (for reference and deduplication) */
  existingTCsForFeature: Array<{ title: string; steps: string[] }>;
}

export interface BrowserAgentOptions {
  page: Page;
  baseUrl: string;
  targetUrl: string;
  menuContext: string;
  testGoal: string;
  seedSteps?: string[];
  additionalContext?: string;
  /** Application knowledge injected into the agent's system prompt */
  productContext?: BrowserAgentProductContext;
  projectId: string;
  projectName?: string;
  onStep: (step: RecordedAction) => Promise<void>;
}

/** Per-step verified locator entry stored in generationHints JSON */
export interface StructuredLocator {
  step: string;
  selectorType: string;
  selector: string;
  /** Exact Playwright statement verified in live browser, e.g. await page.getByRole('button', { name: 'Save' }).first().click(); */
  playwright: string;
}

/** Structured hints format (version 2) stored in TC.generationHints as JSON string */
export interface StructuredHints {
  version: 2;
  locators: StructuredLocator[];
}

export interface GeneratedAgentTC {
  title: string;
  description: string;
  steps: string[];
  expectedResult: string;
  type: 'UI';
  priority: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  useCaseTag: string;
  generationHints: string; // JSON-encoded StructuredHints (version 2) or legacy string
  /** Pre-generated Playwright script from deterministic trace conversion — only set on the happy-path TC */
  scriptContent?: string;
}

// ── System prompt ──────────────────────────────────────────────────────────

function buildSystemPrompt(opts: BrowserAgentOptions): string {
  const parts = [
    `You are a senior QA engineer with direct control of a real web browser.`,
    ``,
    `Your goal is to trace the UI flow for: "${opts.testGoal}"`,
    `Feature under test: "${opts.menuContext}"`,
    `Start URL: ${opts.targetUrl}`,
    ``,
    `PHASE 1 — PAGE AUDIT (always do this first on every new page):`,
    `- Call audit_page immediately before touching any element.`,
    `- The audit shows all form fields (REQUIRED vs optional), buttons, nav items, and the best Playwright locator for each.`,
    `- Never guess selectors from the screenshot — use what the audit tells you.`,
    ``,
    `PHASE 2 — NAVIGATION (if needed):`,
    `- If the current page does not show the target feature, find it in the navigation and click through.`,
    `- Call audit_page again after navigating to confirm you are on the right screen.`,
    ``,
    `PHASE 3 — INTERACTION:`,
    `- Fill every field marked REQUIRED before attempting to submit.`,
    `- Use the exact selector and selectorType from the audit output.`,
    `- After every submit/save action, add assert_visible to confirm the result.`,
    ``,
    `LOCATOR RULES:`,
    `- Priority: testid > role > label > placeholder > text > css`,
    `- selectorType "role": encode as "roleName|Accessible Name" — e.g., "button|Save Order", "combobox|Status"`,
    `  NEVER use a bare role without a name (e.g., "button" alone is wrong — use "button|Save")`,
    `- selectorType "label": use the exact label text from the audit`,
    `- selectorType "testid": use the data-testid value from the audit`,
    `- selectorType "placeholder": use the placeholder text from the audit`,
    ``,
    `SIDEBAR NAVIGATION RULES:`,
    `- The sidebar uses <ul>/<li> elements — NOT <nav> or <aside> — so the audit lists them under NAVIGATION as <li> items.`,
    `- To expand a parent menu item: click with selectorType "text" and the exact label (e.g. "Stock Management").`,
    `- ALWAYS use the exact label text — partial matches hit wrong items (e.g. "Stock" matches "Stock Management", "Stock Orders", etc.).`,
    `- After expanding a parent, wait for the submenu to appear before clicking the child item.`,
    `- If the audit shows no NAVIGATION items, call audit_page again after the page has settled.`,
    `- CRITICAL: If seed steps specify a navigation path (e.g. "Expand Stock Management menu → Click Stock submenu"), follow that EXACT path.`,
    `  Do NOT take a shortcut via a differently-named menu item that sounds related to the goal (e.g. do NOT click "Stock Creation" when told to go to "Stock Management > Stock").`,
    `  A menu item named "Stock Creation" is a completely different feature from the "Stock" submenu under "Stock Management".`,
    ``,
    `OTHER RULES:`,
    `- Only interact with elements visible on this page and any modals it opens.`,
    `- If a tool call fails, check the audit for a better locator or use wait_for_element first.`,
    `- Call finish_recording when the goal is achieved or you are fully blocked.`,
    `- Maximum 30 interaction steps — call finish_recording before hitting this limit.`,
    `- Keep stepDescription short and human-readable (they become test case steps).`,
  ];

  if (opts.seedSteps && opts.seedSteps.length > 0) {
    parts.push(``, `User-provided steps to follow (capture real selectors for each):`);
    opts.seedSteps.forEach((s, i) => parts.push(`${i + 1}. ${s}`));
  }

  if (opts.additionalContext) {
    parts.push(``, `Additional context: ${opts.additionalContext}`);
  }

  // ── Product context: inject app knowledge so the agent can navigate and generate meaningful TCs ──
  const ctx = opts.productContext;
  if (ctx) {
    // Navigation map — tells the agent what pages exist and their URLs
    if (ctx.navigationMap.length > 0) {
      parts.push(``, `APPLICATION PAGES (${ctx.navigationMap.length} discovered — use these to navigate if needed):`);
      ctx.navigationMap.slice(0, 30).forEach(n => parts.push(`  - ${n.label}: ${n.url}`));
    }

    // Previous agent traces — the most valuable training signal: real verified flows
    const relevantLearnings = ctx.agentLearnings.filter(
      l => l.menuContext === opts.menuContext || l.targetUrl === opts.targetUrl,
    );
    const otherLearnings = ctx.agentLearnings.filter(
      l => l.menuContext !== opts.menuContext && l.targetUrl !== opts.targetUrl,
    );

    if (relevantLearnings.length > 0) {
      parts.push(``, `PREVIOUSLY VERIFIED FLOWS FOR THIS EXACT FEATURE (follow these steps — they use real selectors):`);
      for (const l of relevantLearnings) {
        parts.push(`  ${l.menuContext} (${l.targetUrl}):`);
        l.verifiedFlow.forEach(s => parts.push(`    → ${s}`));
        if (l.verifiedLocators.length > 0) {
          parts.push(`  Verified selectors:`);
          l.verifiedLocators.slice(0, 10).forEach(loc =>
            parts.push(`    - ${loc.semanticName}: ${loc.selector}`),
          );
        }
      }
    }

    if (otherLearnings.length > 0) {
      parts.push(``, `OTHER VERIFIED FLOWS (for navigation context — how to reach various app sections):`);
      for (const l of otherLearnings.slice(0, 5)) {
        parts.push(`  ${l.menuContext}: ${l.verifiedFlow.slice(0, 3).join(' → ')}`);
      }
    }

    // Existing test cases — deduplication reference
    if (ctx.existingTCsForFeature.length > 0) {
      parts.push(``, `EXISTING TEST CASES FOR "${opts.menuContext}" (do NOT generate duplicates of these):`);
      ctx.existingTCsForFeature.slice(0, 8).forEach(tc => {
        parts.push(`  - "${tc.title}"`);
      });
    }
  }

  return parts.join('\n');
}

// ── Playwright locator builder ─────────────────────────────────────────────

function buildPlaywrightLocator(page: Page, selector: string, selectorType: SelectorType) {
  switch (selectorType) {
    case 'role': {
      // Selector encodes role + accessible name as "role|Accessible Name"
      // e.g., "button|Save Order" → page.getByRole('button', { name: 'Save Order' })
      const pipeIdx = selector.indexOf('|');
      if (pipeIdx > 0) {
        const roleStr = selector.substring(0, pipeIdx) as Parameters<typeof page.getByRole>[0];
        const name = selector.substring(pipeIdx + 1).trim();
        return name ? page.getByRole(roleStr, { name }) : page.getByRole(roleStr);
      }
      return page.getByRole(selector as Parameters<typeof page.getByRole>[0]);
    }
    case 'label':       return page.getByLabel(selector);
    case 'text':        return page.getByText(selector, { exact: false });
    case 'testid':      return page.getByTestId(selector);
    case 'placeholder': return page.getByPlaceholder(selector);
    default:            return page.locator(selector);
  }
}

// ── Tool executor ──────────────────────────────────────────────────────────

async function executeToolCall(
  page: Page,
  toolName: string,
  toolInput: Record<string, unknown>,
): Promise<{ success: boolean; error?: string }> {
  try {
    const selector = toolInput['selector'] as string | undefined ?? '';
    const selectorType = (toolInput['selectorType'] as SelectorType | undefined) ?? 'css';

    switch (toolName) {
      case 'click': {
        const locator = buildPlaywrightLocator(page, selector, selectorType);
        await locator.first().click({ timeout: 10000 });
        // networkidle times out on SPAs with background polling — domcontentloaded is sufficient
        await page.waitForLoadState('domcontentloaded', { timeout: 8000 }).catch(() => undefined);
        break;
      }
      case 'fill': {
        const locator = buildPlaywrightLocator(page, selector, selectorType);
        await locator.first().fill((toolInput['value'] as string) ?? '', { timeout: 10000 });
        break;
      }
      case 'navigate': {
        const path = toolInput['path'] as string;
        const target = path.startsWith('http') ? path : new URL(path, page.url()).href;
        await page.goto(target, { waitUntil: 'domcontentloaded', timeout: 20000 });
        await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => undefined);
        break;
      }
      case 'assert_visible': {
        const locator = buildPlaywrightLocator(page, selector, selectorType);
        await locator.first().waitFor({ state: 'visible', timeout: 10000 });
        break;
      }
      case 'assert_text': {
        const locator = buildPlaywrightLocator(page, selector, selectorType);
        const text = await locator.first().textContent({ timeout: 10000 }) ?? '';
        const expected = (toolInput['expectedText'] as string) ?? '';
        if (!text.includes(expected)) {
          return { success: false, error: `Expected text "${expected}" but got "${text.slice(0, 100)}"` };
        }
        break;
      }
      case 'scroll': {
        const direction = toolInput['direction'] as string;
        const pixels = (toolInput['pixels'] as number) ?? 300;
        if (direction === 'top' || direction === 'up') {
          const scrollY = direction === 'top' ? 0 : -pixels;
          await page.evaluate((y: number) => window.scrollBy(0, y), scrollY);
        } else {
          const scrollY = direction === 'bottom' ? document.body?.scrollHeight ?? 9999 : pixels;
          await page.evaluate((y: number) => window.scrollBy(0, y), scrollY);
        }
        break;
      }
      case 'wait_for_element': {
        const locator = buildPlaywrightLocator(page, selector, selectorType);
        await locator.first().waitFor({ state: 'visible', timeout: (toolInput['timeoutMs'] as number) ?? 5000 });
        break;
      }
    }
    return { success: true };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// ── Rich DOM audit helper ──────────────────────────────────────────────────

async function getRichDomAudit(page: Page): Promise<string> {
  // Use function() + const expressions only — avoids esbuild __name injection inside page.evaluate
  return page.evaluate(function () {
    const trunc = function(s: string, n: number): string { return s.length > n ? s.slice(0, n) + '…' : s; };

    const getLabel = function(el: HTMLElement): string {
      const aria = el.getAttribute('aria-label');
      if (aria) return aria.trim();
      const id = el.getAttribute('id');
      if (id) {
        const lbl = document.querySelector('label[for="' + id + '"]');
        if (lbl) return (lbl.textContent || '').trim();
      }
      const by = el.getAttribute('aria-labelledby');
      if (by) {
        const lbl = document.getElementById(by);
        if (lbl) return (lbl.textContent || '').trim();
      }
      const ph = (el as HTMLInputElement).placeholder;
      if (ph) return ph.trim();
      return trunc((el.textContent || '').trim().replace(/\s+/g, ' '), 50);
    };

    const bestLocator = function(el: HTMLElement, tag: string, label: string): string {
      const testid = el.getAttribute('data-testid');
      if (testid) return 'getByTestId("' + testid + '")';
      const role = el.getAttribute('role') || tag;
      if (role === 'button' || tag === 'button') {
        return label ? 'getByRole("button", { name: "' + trunc(label, 40) + '" })' : 'locator("button")';
      }
      if (tag === 'a') return label ? 'getByRole("link", { name: "' + trunc(label, 40) + '" })' : 'locator("a")';
      if (tag === 'input' || tag === 'select' || tag === 'textarea') {
        if (label) return 'getByLabel("' + trunc(label, 40) + '")';
        const ph = (el as HTMLInputElement).placeholder;
        if (ph) return 'getByPlaceholder("' + trunc(ph, 40) + '")';
      }
      if (role && label) return 'getByRole("' + role + '", { name: "' + trunc(label, 40) + '" })';
      const id = el.getAttribute('id');
      return id ? 'locator("#' + id + '")' : 'locator("' + tag + '")';
    };

    const visible = function(el: Element): boolean {
      const r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) return false;
      const s = window.getComputedStyle(el);
      return s.display !== 'none' && s.visibility !== 'hidden' && s.opacity !== '0';
    };

    const lines: string[] = [];
    lines.push('=== PAGE: ' + (document.title || 'Untitled') + ' | URL: ' + window.location.href + ' ===');

    // Form fields
    const fields = Array.from(document.querySelectorAll<HTMLElement>(
      'input:not([type="hidden"]):not([type="submit"]):not([type="button"]):not([type="reset"]), select, textarea',
    )).filter(visible);
    if (fields.length > 0) {
      const req = fields.filter(e => (e as HTMLInputElement).required || e.getAttribute('aria-required') === 'true').length;
      lines.push('\nFORM FIELDS (' + fields.length + ' visible, ' + req + ' REQUIRED):');
      for (const el of fields.slice(0, 40)) {
        const tag = el.tagName.toLowerCase();
        const type = (el as HTMLInputElement).type || tag;
        const label = getLabel(el);
        const testid = el.getAttribute('data-testid') || '';
        const required = (el as HTMLInputElement).required || el.getAttribute('aria-required') === 'true';
        const ph = (el as HTMLInputElement).placeholder || '';
        let line = '  ' + (required ? '●' : '○') + ' ';
        line += (label ? '"' + trunc(label, 40) + '"' : '(unlabeled)') + ' [' + type + ']';
        if (required) line += ' REQUIRED';
        if (testid) line += ' testid="' + testid + '"';
        if (!label && ph) line += ' placeholder="' + trunc(ph, 30) + '"';
        if (tag === 'select') {
          const opts = Array.from((el as HTMLSelectElement).options).map(function(o) { return o.text.trim(); }).filter(Boolean).slice(0, 8);
          if (opts.length) line += ' options:[' + opts.join(', ') + ']';
        }
        line += ' → ' + bestLocator(el, tag, label);
        lines.push(line);
      }
    }

    // Buttons
    const buttons = Array.from(document.querySelectorAll<HTMLElement>(
      'button, [role="button"], input[type="submit"], input[type="button"]',
    )).filter(visible);
    if (buttons.length > 0) {
      lines.push('\nBUTTONS (' + buttons.length + ' visible):');
      const seen = new Set<string>();
      for (const el of buttons.slice(0, 20)) {
        const label = getLabel(el) || trunc((el.textContent || '').trim().replace(/\s+/g, ' '), 50);
        if (!label || seen.has(label)) continue;
        seen.add(label);
        const testid = el.getAttribute('data-testid') || '';
        let line = '  ● "' + trunc(label, 50) + '"';
        if (testid) line += ' testid="' + testid + '"';
        line += ' → ' + bestLocator(el, 'button', label);
        lines.push(line);
      }
    }

    // Navigation / menu items
    // Include bare <li> elements used by Angular sidebar menus (e.g. Ventas) that have no role/nav/aside
    const navEls = Array.from(document.querySelectorAll<HTMLElement>(
      '[role="menuitem"], [role="tab"], nav a[href], aside a[href], .sidebar a[href], [class*="sidebar"] a[href], [class*="nav"] a[href], [class*="menu"] li, [class*="sidebar"] li, [class*="sidenav"] li',
    )).filter(visible);
    if (navEls.length > 0) {
      lines.push('\nNAVIGATION (' + navEls.length + ' items):');
      const seen = new Set<string>();
      for (const el of navEls.slice(0, 30)) {
        // Prefer inner <span> text for <li> elements to avoid icon + arrow noise
        const spanText = el.tagName.toLowerCase() === 'li'
          ? (el.querySelector('span')?.textContent || '').trim()
          : '';
        const label = spanText || getLabel(el) || trunc((el.textContent || '').trim().replace(/\s+/g, ' '), 50);
        if (!label || seen.has(label)) continue;
        seen.add(label);
        const href = (el as HTMLAnchorElement).href || '';
        const tag = el.tagName.toLowerCase();
        let line = '  ↗ "' + trunc(label, 50) + '"';
        if (href) line += ' href="' + trunc(href.replace(window.location.origin, ''), 40) + '"';
        // For <li> sidebar items use exact getByText — partial matches hit wrong items
        line += tag === 'li'
          ? ' → getByText("' + trunc(label, 40) + '", { exact: true }).first()'
          : ' → ' + bestLocator(el, tag, label);
        lines.push(line);
      }
    }

    return lines.join('\n');
  }) as Promise<string>;
}

// ── Tool definitions ───────────────────────────────────────────────────────

const SELECTOR_TYPES = ['testid', 'role', 'label', 'placeholder', 'text', 'css'] as const;

function createBrowserTools(): DynamicStructuredTool[] {
  return [
    new DynamicStructuredTool({
      name: 'click',
      description: 'Click an element. Prefer getByRole/getByLabel/getByText over CSS selectors.',
      schema: z.object({
        selector: z.string().describe('The selector value'),
        selectorType: z.enum(SELECTOR_TYPES).describe('How to locate the element'),
        stepDescription: z.string().describe('Human-readable step for test case'),
      }),
      func: async () => 'ok',
    }),
    new DynamicStructuredTool({
      name: 'fill',
      description: 'Fill an input or textarea.',
      schema: z.object({
        selector: z.string(),
        selectorType: z.enum(SELECTOR_TYPES),
        value: z.string().describe('Text to type into the field'),
        stepDescription: z.string(),
      }),
      func: async () => 'ok',
    }),
    new DynamicStructuredTool({
      name: 'navigate',
      description: 'Navigate to a URL path (relative like /#/orders/new or absolute).',
      schema: z.object({
        path: z.string().describe('URL or relative path'),
      }),
      func: async () => 'ok',
    }),
    new DynamicStructuredTool({
      name: 'assert_visible',
      description: 'Assert an element is visible (use after actions to verify outcomes).',
      schema: z.object({
        selector: z.string(),
        selectorType: z.enum(SELECTOR_TYPES),
        stepDescription: z.string().describe('What is being verified'),
      }),
      func: async () => 'ok',
    }),
    new DynamicStructuredTool({
      name: 'assert_text',
      description: 'Assert an element contains specific text.',
      schema: z.object({
        selector: z.string(),
        selectorType: z.enum(SELECTOR_TYPES),
        expectedText: z.string(),
      }),
      func: async () => 'ok',
    }),
    new DynamicStructuredTool({
      name: 'scroll',
      description: 'Scroll the page.',
      schema: z.object({
        direction: z.enum(['down', 'up', 'top', 'bottom']),
        pixels: z.number().nullish().describe('Pixels to scroll (for up/down)'),
      }),
      func: async () => 'ok',
    }),
    new DynamicStructuredTool({
      name: 'wait_for_element',
      description: 'Wait for an element to appear (for dynamic content, modals, loading states).',
      schema: z.object({
        selector: z.string(),
        selectorType: z.enum(SELECTOR_TYPES),
        timeoutMs: z.number().nullish().describe('Max wait in ms, default 5000'),
      }),
      func: async () => 'ok',
    }),
    new DynamicStructuredTool({
      name: 'audit_page',
      description: 'Get a full structured inventory of all visible form fields (with REQUIRED/optional status), buttons, and navigation items on the current page, each with its best Playwright locator. Call this FIRST on every new page before interacting with any element.',
      schema: z.object({
        reason: z.string().nullish().describe('Why you are auditing this page'),
      }),
      func: async () => 'ok',
    }),
    new DynamicStructuredTool({
      name: 'finish_recording',
      description: 'Complete the test trace. Call when the goal is achieved or you are blocked.',
      schema: z.object({
        testTitle: z.string().describe('Short title for the generated test case'),
        expectedResult: z.string().describe('Final expected outcome description'),
        status: z.enum(['success', 'blocked']),
        blockedReason: z.string().nullish(),
      }),
      func: async () => 'ok',
    }),
  ];
}

// ── Script generation (deterministic, no LLM) ─────────────────────────────

/** Converts a RecordedAction into an exact Playwright locator expression */
function buildLocatorCode(action: RecordedAction): string {
  const sel = JSON.stringify(action.selector ?? '');
  switch (action.selectorType) {
    case 'role': {
      // Selector is encoded as "role|Accessible Name" — e.g., "button|Save Order"
      const selector = action.selector ?? '';
      const pipeIdx = selector.indexOf('|');
      if (pipeIdx > 0) {
        const role = JSON.stringify(selector.substring(0, pipeIdx));
        const name = JSON.stringify(selector.substring(pipeIdx + 1).trim());
        return `page.getByRole(${role}, { name: ${name} })`;
      }
      return `page.getByRole(${sel})`;
    }
    case 'label':       return `page.getByLabel(${sel})`;
    case 'text':        return `page.getByText(${sel})`;
    case 'testid':      return `page.getByTestId(${sel})`;
    case 'placeholder': return `page.getByPlaceholder(${sel})`;
    default:            return `page.locator(${sel})`;
  }
}

/** Converts a RecordedAction into the exact Playwright statement used in generated scripts */
function buildPlaywrightStatement(action: RecordedAction): string {
  const loc = buildLocatorCode(action);
  switch (action.toolName) {
    case 'click':
      return `await ${loc}.first().click();`;
    case 'fill':
      return `await ${loc}.first().fill(${JSON.stringify(action.value ?? '')});`;
    case 'assert_visible':
      return `await expect(${loc}.first()).toBeVisible();`;
    case 'assert_text':
      return `await expect(${loc}.first()).toContainText(${JSON.stringify(action.expectedText ?? '')});`;
    case 'wait_for_element':
      return `await ${loc}.first().waitFor({ state: 'visible', timeout: ${action.timeoutMs ?? 5000} });`;
    default:
      return '';
  }
}

function actionToLine(action: RecordedAction): string {
  const comment = action.stepDescription ? ` // ${action.stepDescription}` : '';
  const loc = buildLocatorCode(action);
  switch (action.toolName) {
    case 'click':          return `  await ${loc}.first().click();${comment}`;
    case 'fill':           return `  await ${loc}.first().fill(${JSON.stringify(action.value ?? '')});${comment}`;
    case 'navigate':       return `  await page.goto(${JSON.stringify(action.path ?? '/')});${comment}`;
    case 'assert_visible': return `  await expect(${loc}.first()).toBeVisible();${comment}`;
    case 'assert_text':    return `  await expect(${loc}.first()).toContainText(${JSON.stringify(action.expectedText ?? '')});${comment}`;
    case 'scroll':         return action.direction === 'up' || action.direction === 'top'
      ? `  await page.evaluate(() => window.scrollTo(0, 0));${comment}`
      : `  await page.mouse.wheel(0, ${action.pixels ?? 300});${comment}`;
    case 'wait_for_element': return `  await ${loc}.first().waitFor({ state: 'visible', timeout: ${action.timeoutMs ?? 5000} });${comment}`;
    default:               return '';
  }
}

function buildLoginLines(login: LoginInstructions): string[] {
  const lines: string[] = [];
  for (const step of login.steps) {
    if (!step.selector) continue;
    if (step.action === 'fill') {
      const isPassword = step.description.toLowerCase().includes('password');
      const val = isPassword ? `process.env.TC_PASSWORD ?? ''` : `process.env.TC_USERNAME ?? ''`;
      if (isPassword) {
        // Keycloak requires real key events — fill() bypasses them and leaves Login button disabled
        lines.push(`  await page.locator(${JSON.stringify(step.selector)}).first().click();`);
        lines.push(`  await page.locator(${JSON.stringify(step.selector)}).first().pressSequentially(${val}, { delay: 50 });`);
      } else {
        lines.push(`  await page.locator(${JSON.stringify(step.selector)}).first().fill(${val});`);
      }
    } else if (step.action === 'click') {
      lines.push(`  await page.locator(${JSON.stringify(step.selector)}).first().click();`);
    }
  }
  // myProfile page takes ~20s to load on this platform — networkidle never reached due to background polling
  lines.push(`  await page.waitForURL(/.*\\/myProfile/, { timeout: 30000 });`);
  return lines;
}

export function actionLogToPlaywrightScript(
  actions: RecordedAction[],
  finish: AgentFinishData,
  loginInstructions: LoginInstructions,
  targetUrl: string,
): string {
  const loginLines = buildLoginLines(loginInstructions);
  const testLines = actions
    .filter(a => a.success && a.toolName !== 'finish_recording')
    .map(actionToLine)
    .filter(Boolean);

  const title = finish.testTitle.replace(/'/g, "\\'");
  // Use process.env.BASE_URL — never hardcode the URL
  let targetPathExpr: string;
  if (targetUrl.startsWith('http')) {
    try {
      const parsedPath = new URL(targetUrl).pathname;
      targetPathExpr = `\`\${process.env.BASE_URL}${parsedPath}\``;
    } catch {
      targetPathExpr = 'process.env.BASE_URL!';
    }
  } else {
    targetPathExpr = `\`\${process.env.BASE_URL}${targetUrl}\``;
  }

  return [
    `import { test, expect } from '@playwright/test';`,
    ``,
    `test('${title}', async ({ page }) => {`,
    `  const baseURL = process.env.BASE_URL;`,
    `  if (!baseURL) throw new Error('BASE_URL environment variable is not set');`,
    `  await page.goto(baseURL);`,
    ...loginLines,
    `  await page.goto(${targetPathExpr});`,
    ``,
    ...testLines,
    ``,
    `  // Expected: ${finish.expectedResult}`,
    `});`,
  ].join('\n');
}

/** Builds a StructuredHints JSON string from verified trace actions */
function buildStructuredHints(actions: RecordedAction[]): string {
  const ELEMENT_TOOLS = new Set(['click', 'fill', 'assert_visible', 'assert_text', 'wait_for_element']);
  const locators: StructuredLocator[] = actions
    .filter(a => a.success && a.selector && ELEMENT_TOOLS.has(a.toolName))
    .map(a => {
      const playwright = buildPlaywrightStatement(a);
      if (!playwright) return null;
      return {
        step: a.stepDescription ?? `${a.toolName} ${a.selector}`,
        selectorType: a.selectorType ?? 'css',
        selector: a.selector!,
        playwright,
      };
    })
    .filter(Boolean) as StructuredLocator[];

  const hints: StructuredHints = { version: 2, locators };
  return JSON.stringify(hints);
}

export function actionLogToTestCases(
  actions: RecordedAction[],
  finish: AgentFinishData,
  menuContext: string,
): GeneratedAgentTC[] {
  const successful = actions.filter(a => a.success && a.toolName !== 'finish_recording');
  const steps = successful.map(a => a.stepDescription ?? `${a.toolName} ${a.selector ?? ''}`.trim());
  return [{
    title: finish.testTitle,
    description: `Agentic trace of "${menuContext}" — verified flow captured by browser agent`,
    steps,
    expectedResult: finish.expectedResult,
    type: 'UI',
    priority: 'HIGH',
    useCaseTag: menuContext,
    generationHints: buildStructuredHints(successful),
  }];
}

// ── LLM-powered multi-scenario test case analysis ─────────────────────────

export async function analyzeTraceToTestCases(
  actions: RecordedAction[],
  finish: AgentFinishData,
  menuContext: string,
  testGoal: string,
  loginInstructions: LoginInstructions,
  projectId: string,
  projectName?: string,
): Promise<GeneratedAgentTC[]> {
  const llm = createLLM({ temperature: 0, agentName: 'tc-analyzer', projectId, projectName });

  // Build human-readable login steps from stored instructions
  const loginStepLines: string[] = [];
  if (loginInstructions.steps.length > 0) {
    [...loginInstructions.steps]
      .sort((a, b) => a.order - b.order)
      .forEach((s, i) => loginStepLines.push(`${i + 1}. ${s.description}`));
  } else {
    loginStepLines.push(
      '1. Navigate to the application login page',
      '2. Enter valid username in the username field',
      '3. Enter valid password in the password field',
      '4. Click the Login / Submit button',
      '5. Verify the dashboard or home page loads successfully',
    );
  }

  const successful = actions.filter(a => a.success && a.toolName !== 'finish_recording');
  const traceLines = successful.map(a => {
    const sel = a.selector ? ` | ${a.selectorType ?? 'css'}="${a.selector}"` : '';
    return `Step ${a.stepNumber}: [${a.toolName}] ${a.stepDescription ?? ''}${sel}`;
  });

  const systemPrompt = `You are a senior QA engineer expert in test case design.
Analyse a browser recording and produce a structured set of test cases.

OUTPUT: Return ONLY a valid JSON array — no markdown code fences, no commentary.

Each element must match this shape exactly:
{
  "title": "string — Verb + Feature + Condition, e.g. 'Create Project - Happy Path'",
  "description": "string — one sentence stating what this test verifies",
  "steps": ["string", ...],
  "expectedResult": "string — specific, observable outcome",
  "priority": "HIGH" | "MEDIUM" | "LOW",
  "useCaseTag": "string — feature group, e.g. 'Project Creation'",
  "generationHints": "string — JSON-stringified StructuredHints object (see format below)"
}

RULES:
1. Generate 3–8 test cases covering distinct scenarios.
2. EVERY test case steps array MUST begin with the login steps provided (copy them verbatim).
3. Happy path: reproduce ALL successful trace steps after login.
4. Validation tests: steps that attempt to submit / proceed with missing or invalid required fields.
5. Negative tests: empty states, cancel flows, duplicate entries, unauthorised scenarios inferred from context.
6. Titles MUST NOT repeat the user's original goal text — write concise action-based titles.
7. useCaseTag groups related TCs (e.g. "Project Creation", "Form Validation").
8. generationHints MUST be a JSON string with this exact structure:
   {"version":2,"locators":[{"step":"<exact step text from your steps array>","selectorType":"<type>","selector":"<value>","playwright":"<exact Playwright statement>"},...]}
   - Only include entries for steps that interact with UI elements (click, fill, assert).
   - Use ONLY the verified selectors provided in the "Verified Selectors" section below.
   - Map each relevant step in your TC to the closest matching verified selector.
   - The "playwright" field must be the exact statement from the verified selectors list.
   - Do NOT invent new selectors — only reference verified ones.
9. Steps must be natural-language instructions readable by a manual QA tester — no code.`;

  // Build the verified selectors lookup for the LLM to reference when building generationHints
  const ELEMENT_TOOLS = new Set(['click', 'fill', 'assert_visible', 'assert_text', 'wait_for_element']);
  const verifiedSelectorsLines = successful
    .filter(a => a.selector && ELEMENT_TOOLS.has(a.toolName))
    .map(a => {
      const playwright = buildPlaywrightStatement(a);
      return `  step="${a.stepDescription ?? a.toolName}" selectorType="${a.selectorType ?? 'css'}" selector="${a.selector}" playwright="${playwright}"`;
    });

  const userContent = `## Test Goal
${testGoal}

## Page / Feature Under Test
${menuContext}

## Login Steps (MUST appear verbatim at the start of every test case's steps array)
${loginStepLines.join('\n')}

## Recorded Browser Trace (${successful.length} successful steps with verified selectors)
${traceLines.join('\n')}

## Verified Selectors (use ONLY these in generationHints — do not invent others)
${verifiedSelectorsLines.length > 0 ? verifiedSelectorsLines.join('\n') : '(none)'}

## Trace Outcome
Status: ${finish.status}
Agent expected result: ${finish.expectedResult}${finish.blockedReason ? `\nBlocked reason: ${finish.blockedReason}` : ''}

Generate comprehensive test cases. Infer validation and negative scenarios from forms, buttons, and interactions visible in the trace.
For generationHints on each TC: map each UI-interaction step to the matching verified selector above and produce the JSON string.`;

  try {
    const response = await llm.invoke([
      new SystemMessage(systemPrompt),
      new HumanMessage(userContent),
    ]) as { content: unknown };

    const raw = typeof response.content === 'string' ? response.content : '';
    // Strip markdown code fences if the model included them
    const cleaned = raw.replace(/```(?:json)?\n?/g, '').trim();
    const jsonMatch = cleaned.match(/\[[\s\S]*\]/);
    if (!jsonMatch) throw new Error('No JSON array in LLM response');

    const parsed = JSON.parse(jsonMatch[0]) as Array<{
      title?: string;
      description?: string;
      steps?: unknown;
      expectedResult?: string;
      priority?: string;
      useCaseTag?: string;
      generationHints?: string;
    }>;

    if (!Array.isArray(parsed) || parsed.length === 0) throw new Error('Empty array returned');

    const VALID_PRIORITIES = new Set(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']);

    return parsed.map(tc => ({
      title: tc.title ?? menuContext,
      description: tc.description ?? '',
      steps: Array.isArray(tc.steps) ? (tc.steps as string[]) : [],
      expectedResult: tc.expectedResult ?? finish.expectedResult,
      type: 'UI' as const,
      priority: (VALID_PRIORITIES.has(tc.priority ?? '') ? tc.priority : 'MEDIUM') as GeneratedAgentTC['priority'],
      useCaseTag: tc.useCaseTag ?? menuContext,
      generationHints: tc.generationHints ?? '',
    }));
  } catch (err) {
    console.warn('[analyzeTraceToTestCases] LLM analysis failed, falling back to deterministic:', (err as Error).message);
    return actionLogToTestCases(actions, finish, menuContext);
  }
}

// ── Main agent loop ────────────────────────────────────────────────────────

export async function runBrowserAgent(opts: BrowserAgentOptions): Promise<BrowserAgentResult> {
  const { page, projectId, projectName, onStep } = opts;
  const llm = createLLM({ temperature: 0, agentName: 'browser-agent', projectId, projectName });
  const tools = createBrowserTools();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const llmWithTools = typeof (llm as any).bindTools === 'function'
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ? (llm as any).bindTools(tools)
    : llm;

  // ── Optimisation: prompt caching on system message ──
  // The system prompt is identical on every loop iteration (same test goal, same rules).
  // By tagging it with cache_control, Anthropic caches it server-side and charges only
  // 10% of normal input price for it on steps 2–20.
  // For OpenRouter: caching is automatic — this content array form is safe to pass through.
  const systemPromptText = buildSystemPrompt(opts);
  const systemMsg = new SystemMessage({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    content: [{ type: 'text', text: systemPromptText, cache_control: { type: 'ephemeral' } }] as any,
  });

  // history accumulates AIMessages + ToolMessages only (NOT human messages with screenshots)
  // this keeps each LLM call to a fixed cost regardless of step count
  const history: BaseMessage[] = [];

  const actions: RecordedAction[] = [];
  let finishData: AgentFinishData | null = null;
  let stepNumber = 0;
  const MAX_STEPS = 30;
  const WALL_CLOCK_TIMEOUT_MS = 4 * 60 * 1000; // 4 minutes total
  const MAX_CONSECUTIVE_FAILURES = 5;           // force-finish if stuck retrying
  const startTime = Date.now();
  let consecutiveFailures = 0;

  // Track previous raw PNG for pixel-diff comparison (diff runs on raw; we compress for LLM)
  let prevRawBuf: Buffer | null = null;

  while (stepNumber < MAX_STEPS && !finishData && (Date.now() - startTime) < WALL_CLOCK_TIMEOUT_MS) {
    const rawBuf = await page.screenshot({ type: 'png', fullPage: false });
    const currentUrl = page.url();
    const domExcerpt = await getRichDomAudit(page).catch(() => '(DOM unavailable)');

    const actionSummary = actions.length > 0
      ? actions.map(a =>
          `${a.stepNumber}. [${a.toolName}] ${a.stepDescription ?? ''} — ${a.success ? 'OK' : 'FAILED: ' + (a.errorMessage ?? '')}`,
        ).join('\n')
      : 'No actions taken yet.';

    // ── Optimisation 1: pixel diff — skip screenshot when page is visually unchanged ──
    // Only applies after the first step and only when the last action was a pure
    // assertion (assert_visible / assert_text) that cannot change the DOM.
    const lastAction = actions.at(-1);
    const lastWasAssertion = lastAction?.toolName === 'assert_visible' || lastAction?.toolName === 'assert_text';
    const pageUnchanged = prevRawBuf !== null && lastWasAssertion
      ? !(await hasPageChangedSignificantly(prevRawBuf, rawBuf))
      : false;

    // ── Optimisation 2: compress PNG → JPEG at 1024px wide, quality 60 ──
    // ~85–92% fewer image tokens vs raw PNG with no accuracy loss.
    const imageContent = pageUnchanged
      ? null
      : await compressScreenshot(rawBuf).then(jpeg => ({
          type: 'image_url' as const,
          image_url: { url: `${jpegDataPrefix()}${jpeg.toString('base64')}` },
        }));

    prevRawBuf = rawBuf;

    // Build human message — image omitted when page is visually unchanged
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const msgContent: any[] = [];
    if (imageContent) {
      msgContent.push(imageContent);
    } else {
      msgContent.push({
        type: 'text',
        text: '[Screenshot omitted — page appearance unchanged from previous step]',
      });
    }
    msgContent.push({
      type: 'text',
      text: `Current URL: ${currentUrl}\n\nInteractive elements:\n${domExcerpt}\n\nActions taken (${actions.length}):\n${actionSummary}`,
    });

    const humanMsg = new HumanMessage({ content: msgContent });

    const messages: BaseMessage[] = [systemMsg, ...history, humanMsg];

    const response = await llmWithTools.invoke(messages) as AIMessage & {
      tool_calls?: Array<{ id: string; name: string; args: Record<string, unknown> }>;
    };
    history.push(response);

    const toolCalls = response.tool_calls;
    if (!toolCalls || toolCalls.length === 0) {
      finishData = {
        testTitle: `Agentic trace: ${opts.menuContext}`,
        expectedResult: 'Steps recorded up to this point',
        status: 'blocked',
        blockedReason: 'Agent stopped without calling finish_recording',
      };
      break;
    }

    for (const toolCall of toolCalls) {
      if (toolCall.name === 'finish_recording') {
        finishData = toolCall.args as AgentFinishData;
        history.push(new ToolMessage({
          content: 'Recording finished.',
          tool_call_id: toolCall.id ?? `call_${Date.now()}`,
        }));
        break;
      }

      // audit_page returns live DOM data without counting as an interaction step
      if (toolCall.name === 'audit_page') {
        const audit = await getRichDomAudit(page).catch(() => '(DOM audit unavailable)');
        history.push(new ToolMessage({
          content: audit,
          tool_call_id: toolCall.id ?? `call_${Date.now()}`,
        }));
        continue;
      }

      const result = await executeToolCall(page, toolCall.name, toolCall.args);
      stepNumber++;

      const action: RecordedAction = {
        stepNumber,
        toolName: toolCall.name,
        selector: toolCall.args['selector'] as string | undefined,
        selectorType: toolCall.args['selectorType'] as SelectorType | undefined,
        value: toolCall.args['value'] as string | undefined,
        path: toolCall.args['path'] as string | undefined,
        direction: toolCall.args['direction'] as string | undefined,
        timeoutMs: toolCall.args['timeoutMs'] as number | undefined,
        expectedText: toolCall.args['expectedText'] as string | undefined,
        stepDescription: toolCall.args['stepDescription'] as string | undefined,
        success: result.success,
        errorMessage: result.error,
        timestampMs: Date.now(),
      };
      actions.push(action);
      await onStep(action).catch(console.error);

      if (result.success) {
        consecutiveFailures = 0;
      } else {
        consecutiveFailures++;
      }

      const toolResultText = result.success
        ? 'Action succeeded.'
        : `Action FAILED: ${result.error ?? 'unknown error'}. Check the page audit for the correct selector, try a different selectorType, or call wait_for_element first if the element may not be visible yet.`;

      history.push(new ToolMessage({
        content: toolResultText,
        tool_call_id: toolCall.id ?? `call_${Date.now()}`,
      }));

      if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
        finishData = {
          testTitle: `Agentic trace: ${opts.menuContext}`,
          expectedResult: 'Steps recorded up to this point',
          status: 'blocked',
          blockedReason: `Stopped after ${MAX_CONSECUTIVE_FAILURES} consecutive failed actions — agent was stuck`,
        };
        break;
      }

      if (finishData) break;
    }
  }

  if (!finishData) {
    const timedOut = (Date.now() - startTime) >= WALL_CLOCK_TIMEOUT_MS;
    finishData = {
      testTitle: `Agentic trace: ${opts.menuContext}`,
      expectedResult: 'Test steps recorded up to this point',
      status: 'blocked',
      blockedReason: timedOut
        ? `Stopped after 4-minute wall-clock timeout (${stepNumber} steps completed)`
        : `Reached maximum step limit (${MAX_STEPS})`,
    };
  }

  return { actions, finish: finishData, totalSteps: stepNumber };
}
