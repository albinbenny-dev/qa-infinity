import { chromium } from 'playwright-core';
import type { Browser, Page } from 'playwright-core';
import { HumanMessage } from '@langchain/core/messages';
import { createLLM } from '../lib/llm.js';
import type {
  PageScanData,
  KeyLocator,
  NavNode,
  LoginInstructions,
  LoginStep,
} from '../types/scanner.js';

export interface ScanOptions {
  baseUrl: string;
  username: string;
  password: string;
  depth: 'full' | 'top-level' | 'login-only';
  customInstructions?: string;
  onProgress: (progress: number, currentPage: string, pagesScanned: number) => Promise<void>;
}

export interface ScanResult {
  pages: PageScanData[];
  loginInstructions: LoginInstructions;
  navigationMap: NavNode[];
}

const CHROMIUM_PATH =
  process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ?? '/usr/bin/chromium-browser';

const MAX_PAGES = 50;

export async function runUIScan(options: ScanOptions): Promise<ScanResult> {
  const { baseUrl, username, password, depth, customInstructions, onProgress } = options;

  let browser: Browser | null = null;

  try {
    browser = await chromium.launch({
      executablePath: CHROMIUM_PATH,
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
    });

    const context = await browser.newContext({
      viewport: { width: 1280, height: 800 },
      ignoreHTTPSErrors: true,
    });

    const page = await context.newPage();

    // ── Step 1: Navigate to base URL ────────────────────────────────────────
    await onProgress(5, baseUrl, 0).catch(console.error);
    await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(300);

    // ── Step 2: Detect and perform login ────────────────────────────────────
    const loginInstructions = await performLogin(page, baseUrl, username, password);
    await onProgress(15, page.url(), 0).catch(console.error);

    if (depth === 'login-only') {
      const loginPageData = await scanPage(page, baseUrl, 'Login', []);
      return {
        pages: [loginPageData],
        loginInstructions,
        navigationMap: [],
      };
    }

    // ── Step 3: Execute custom post-login navigation ─────────────────────────
    if (customInstructions) {
      await onProgress(18, 'post-login navigation', 0).catch(console.error);
      await executePostLoginNavigation(page, customInstructions);
    }

    // ── Step 4: Map navigation ───────────────────────────────────────────────
    const navNodes = await mapNavigation(page, baseUrl);
    await onProgress(25, page.url(), 0).catch(console.error);

    // ── Step 4: Scan pages ───────────────────────────────────────────────────
    const pagesToScan = depth === 'top-level'
      ? navNodes.filter((n) => n.depth === 0).slice(0, MAX_PAGES)
      : flattenNavNodes(navNodes).slice(0, MAX_PAGES);

    const pages: PageScanData[] = [];
    const total = Math.max(pagesToScan.length, 1);

    for (let i = 0; i < pagesToScan.length; i++) {
      const node = pagesToScan[i];
      const progressPct = 30 + Math.round((i / total) * 55);

      await onProgress(progressPct, node.url, i).catch(console.error);

      try {
        await page.goto(node.url, { waitUntil: 'domcontentloaded', timeout: 20000 });
        await page.waitForTimeout(300);
        const pageData = await scanPage(page, node.url, node.label, node.urlPattern ? [node.urlPattern] : []);
        pages.push(pageData);
      } catch (err) {
        console.warn(`[ui-scanner] Skipping page ${node.url}: ${(err as Error).message}`);
      }
    }

    await onProgress(90, 'analysis', pages.length).catch(console.error);

    await context.close();

    return { pages, loginInstructions, navigationMap: navNodes };
  } finally {
    if (browser) await browser.close().catch(console.error);
  }
}

// ── Login detection and execution ──────────────────────────────────────────

async function performLogin(
  page: Page,
  baseUrl: string,
  username: string,
  password: string,
): Promise<LoginInstructions> {
  const steps: LoginStep[] = [
    { order: 1, action: 'navigate', description: `Navigate to ${baseUrl}` },
  ];

  const usernameSelectors = [
    'input[placeholder*="sername" i]',
    'input[name="username"]',
    'input[name="email"]',
    'input[type="email"]',
    '#username',
    '#email',
  ];

  const passwordSelectors = [
    'input[type="password"]',
    '#password',
    'input[name="password"]',
  ];

  const submitSelectors = [
    'button[type="submit"]',
    'input[type="submit"]',
    '#kc-login',
    'button:has-text("Login")',
    'button:has-text("Sign in")',
    'button:has-text("Log in")',
  ];

  let detectedUsernameSelector = '';
  let detectedPasswordSelector = '';
  let detectedSubmitSelector = '';
  let loginType: 'standard' | 'two-step' | 'sso' = 'standard';
  let postLoginUrl = baseUrl;

  // Check if login form is present
  let hasLoginForm = false;
  for (const sel of usernameSelectors) {
    if (await page.locator(sel).first().isVisible().catch(() => false)) {
      detectedUsernameSelector = sel;
      hasLoginForm = true;
      break;
    }
  }

  if (!hasLoginForm) {
    return buildLoginInstructions(steps, detectedUsernameSelector, detectedPasswordSelector, detectedSubmitSelector, loginType, baseUrl, 'No login form detected on the base URL');
  }

  // Check if password is already visible (standard) or hidden (two-step)
  let passwordVisible = false;
  for (const sel of passwordSelectors) {
    if (await page.locator(sel).first().isVisible().catch(() => false)) {
      detectedPasswordSelector = sel;
      passwordVisible = true;
      break;
    }
  }

  // Detect submit button
  for (const sel of submitSelectors) {
    if (await page.locator(sel).first().isVisible().catch(() => false)) {
      detectedSubmitSelector = sel;
      break;
    }
  }

  if (!passwordVisible) {
    loginType = 'two-step';
  }

  // Enter username
  steps.push({ order: 2, action: 'fill', description: 'Enter username', selector: detectedUsernameSelector });
  try {
    const usernameEl = page.locator(detectedUsernameSelector).first();
    await usernameEl.click({ clickCount: 3 });
    await usernameEl.fill(username);
  } catch (err) {
    throw new Error(`ScanError: Login failed — could not fill username: ${(err as Error).message}`);
  }

  // Two-step: click submit first to reveal password
  if (loginType === 'two-step') {
    steps.push({ order: 3, action: 'click', description: 'Click Login to reveal password field', selector: detectedSubmitSelector });
    try {
      await page.locator(detectedSubmitSelector).first().click();
      await page.waitForTimeout(600);

      // Now find password
      for (const sel of passwordSelectors) {
        if (await page.locator(sel).first().isVisible().catch(() => false)) {
          detectedPasswordSelector = sel;
          break;
        }
      }

      if (!detectedPasswordSelector) {
        throw new Error('ScanError: Login failed — password field did not appear after step-1 click');
      }
    } catch (err) {
      if ((err as Error).message.startsWith('ScanError')) throw err;
      throw new Error(`ScanError: Login failed — ${(err as Error).message}`);
    }
  }

  // Enter password
  steps.push({ order: loginType === 'two-step' ? 4 : 3, action: 'fill', description: 'Enter password', selector: detectedPasswordSelector });
  try {
    const pwEl = page.locator(detectedPasswordSelector).first();
    await pwEl.click({ clickCount: 3 });
    await pwEl.fill(password);
  } catch (err) {
    throw new Error(`ScanError: Login failed — could not fill password: ${(err as Error).message}`);
  }

  // Submit
  steps.push({ order: loginType === 'two-step' ? 5 : 4, action: 'click', description: 'Submit login', selector: detectedSubmitSelector });
  try {
    await page.locator(detectedSubmitSelector).first().click();
    await page.waitForURL((url) => url.href !== baseUrl && !url.href.includes('login'), { timeout: 20000 });
    postLoginUrl = page.url();
  } catch {
    postLoginUrl = page.url();
  }

  steps.push({ order: steps.length + 1, action: 'assert', description: `Assert landed at ${postLoginUrl}` });

  return buildLoginInstructions(steps, detectedUsernameSelector, detectedPasswordSelector, detectedSubmitSelector, loginType, postLoginUrl, '');
}

function buildLoginInstructions(
  steps: LoginStep[],
  username: string,
  password: string,
  submit: string,
  loginType: 'standard' | 'two-step' | 'sso',
  postLoginUrl: string,
  notes: string,
): LoginInstructions {
  return { steps, selectors: { username, password, submit }, loginType, postLoginUrl, notes };
}

// ── Post-login context navigation ─────────────────────────────────────────
// Uses a quick LLM call to interpret custom instructions and click/navigate
// to the correct app context before the nav map is captured.

async function executePostLoginNavigation(page: Page, instructions: string): Promise<void> {
  try {
    await page.waitForLoadState('networkidle', { timeout: 4000 }).catch(() => {});
    await page.waitForTimeout(500);

    // ── Fast path: if instructions contain an explicit URL, navigate directly ──
    const urlMatch = instructions.match(
      /(?:navigate\s+to|go\s+to|open)\s+(https?:\/\/[^\s"'<>]+|\/[a-zA-Z0-9\-_/]+(?:[?#][^\s]*)?)/i,
    ) ?? instructions.match(/(https?:\/\/[^\s"'<>]{12,})/i);

    if (urlMatch) {
      let target = urlMatch[1].trim();
      if (target.startsWith('/')) target = new URL(target, page.url()).href;
      console.log(`[ui-scanner] Post-login nav: direct URL → ${target}`);
      await page.goto(target, { waitUntil: 'domcontentloaded', timeout: 15000 });
      await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
      return;
    }

    // ── Collect interactive elements ───────────────────────────────────────
    // Includes <a> links, buttons AND cursor:pointer elements (React onClick cards)
    const elements = await page.evaluate(() => {
      const seen = new Set<string>();
      const results: Array<{ tag: string; text: string; href: string }> = [];

      const add = (tag: string, text: string, href: string) => {
        const key = text + href;
        if (!text || seen.has(key)) return;
        seen.add(key);
        results.push({ tag, text, href });
      };

      // All anchor tags with hrefs (highest priority)
      document.querySelectorAll<HTMLAnchorElement>('a[href]').forEach((a) => {
        const text = (a.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 80);
        if (!a.href.includes('logout') && !a.href.endsWith('#')) {
          add('a', text, a.href);
        }
      });

      // Buttons
      document.querySelectorAll<HTMLElement>('button:not([disabled]), [role="button"]').forEach((el) => {
        add(el.tagName.toLowerCase(), (el.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 80), '');
      });

      // Clickable card/tile divs — React onClick elements (cursor:pointer, substantial size,
      // no <a> or <button> child so we don't double-count)
      document.querySelectorAll<HTMLElement>('[style*="cursor: pointer"], [style*="cursor:pointer"]').forEach((el) => {
        if (el.querySelector('a[href], button')) return;
        const rect = el.getBoundingClientRect();
        if (rect.width < 80 || rect.height < 40) return;
        add('card', (el.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 80), '');
      });

      return results.slice(0, 100);
    });

    if (elements.length === 0) {
      console.log('[ui-scanner] Post-login nav: no interactive elements found');
      return;
    }

    // ── Ask LLM which element to click ────────────────────────────────────
    const llm = createLLM({ temperature: 0 });
    const prompt = [
      `Custom scan instructions: "${instructions}"`,
      '',
      'Interactive elements on the post-login page (index | type | text | href):',
      elements.map((e, i) => `${i} | ${e.tag} | "${e.text}" | ${e.href || '—'}`).join('\n'),
      '',
      'Which index to click/navigate to so the scanner reaches the main feature area?',
      'Reply ONLY with JSON: {"index": <number>, "reason": "<brief>"}',
      'If nothing matches: {"index": -1, "reason": "no action needed"}',
    ].join('\n');

    const response = await llm.invoke([new HumanMessage(prompt)]);
    const raw = typeof response.content === 'string' ? response.content : '';
    const cleaned = raw.replace(/```(?:json)?\s*/g, '').replace(/```\s*$/g, '').trim();
    const parsed = JSON.parse(cleaned) as { index: number; reason: string };

    const target = elements[parsed.index];
    if (!target || parsed.index < 0) {
      console.log(`[ui-scanner] Post-login nav: ${parsed.reason}`);
      return;
    }

    console.log(`[ui-scanner] Post-login nav: clicking "${target.text}" — ${parsed.reason}`);

    if (target.href) {
      await page.goto(target.href, { waitUntil: 'domcontentloaded', timeout: 15000 });
    } else {
      // Use Playwright text locator for React onClick cards (no href available)
      await page.locator(`text="${target.text.slice(0, 40)}"`).first().click({ timeout: 8000 });
      await page.waitForTimeout(1500);
    }

    await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(1000);

  } catch (err) {
    console.warn(`[ui-scanner] Post-login navigation skipped: ${(err as Error).message}`);
  }
}

// ── Navigation mapping ─────────────────────────────────────────────────────

async function mapNavigation(page: Page, baseUrl: string): Promise<NavNode[]> {
  const baseOrigin = new URL(baseUrl).origin;

  const links = await page.evaluate((origin: string) => {
    const selectors = [
      'nav a',
      '[role="navigation"] a',
      'aside a',
      'ul[class*="menu"] a',
      'ul[class*="nav"] a',
      'ul[class*="sidebar"] a',
      'li[class*="menu-item"] a',
      '[class*="nav-item"] a',
    ];

    const seen = new Set<string>();
    const results: Array<{ href: string; text: string; depth: number }> = [];

    for (const sel of selectors) {
      document.querySelectorAll<HTMLAnchorElement>(sel).forEach((a) => {
        const href = a.href;
        if (!href || seen.has(href)) return;
        if (!href.startsWith(origin)) return;
        if (href.includes('logout') || href.includes('/404')) return;

        seen.add(href);
        const text = (a.textContent ?? '').trim().replace(/\s+/g, ' ');
        if (!text) return;

        // Estimate depth by counting the distance from nav root
        let depth = 0;
        let el: Element | null = a.parentElement;
        while (el && depth < 5) {
          if (el.tagName === 'NAV' || el.getAttribute('role') === 'navigation') break;
          const tag = el.tagName.toLowerCase();
          if (tag === 'ul' || tag === 'li') depth++;
          el = el.parentElement;
        }

        results.push({ href, text, depth: Math.floor(depth / 2) });
      });
    }

    return results;
  }, baseOrigin);

  // Build NavNode tree
  const nodeMap = new Map<string, NavNode>();
  const roots: NavNode[] = [];

  for (const link of links) {
    const urlPattern = link.href.replace(/[0-9a-f]{8,}/gi, ':id').replace(/\d+/g, ':num');
    const node: NavNode = {
      label: link.text,
      url: link.href,
      urlPattern,
      children: [],
      pageType: inferPageType(link.text, link.href),
      depth: link.depth,
    };
    nodeMap.set(link.href, node);

    if (link.depth === 0) {
      roots.push(node);
    }
  }

  // Attach children to parents (simple depth-based grouping)
  const depth1 = [...nodeMap.values()].filter((n) => n.depth === 1);
  for (const child of depth1) {
    const parent = roots.find((r) => child.url.includes(new URL(r.url).pathname.split('/')[1] ?? ''));
    if (parent) {
      parent.children.push(child);
    } else {
      roots.push(child);
    }
  }

  return roots;
}

function inferPageType(label: string, url: string): NavNode['pageType'] {
  const combined = `${label} ${url}`.toLowerCase();
  if (/dashboard|home|overview|summary/.test(combined)) return 'dashboard';
  if (/setting|config|preference|admin/.test(combined)) return 'settings';
  if (/list|report|history|log|all/.test(combined)) return 'list';
  if (/form|create|add|new|edit|upload/.test(combined)) return 'form';
  return 'other';
}

function flattenNavNodes(nodes: NavNode[]): NavNode[] {
  const result: NavNode[] = [];
  for (const node of nodes) {
    result.push(node);
    if (node.children.length > 0) {
      result.push(...flattenNavNodes(node.children));
    }
  }
  return result;
}

// ── Page scanning ──────────────────────────────────────────────────────────

async function scanPage(
  page: Page,
  url: string,
  navLabel: string,
  navPath: string[],
): Promise<PageScanData> {
  const startTime = Date.now();

  const screenshotBase64: string | null = null;

  // Accessibility-like snapshot via DOM evaluation (page.accessibility removed in PW 1.44+)
  let accessibilityTree = '';
  try {
    accessibilityTree = await page.evaluate(() => {
      function walk(el: Element, depth: number): object {
        const tag = el.tagName.toLowerCase();
        const role = el.getAttribute('role') ?? '';
        const label = el.getAttribute('aria-label') ?? el.getAttribute('placeholder') ?? (el as HTMLElement).innerText?.slice(0, 60) ?? '';
        const children = depth < 3
          ? Array.from(el.children).slice(0, 5).map((c) => walk(c, depth + 1))
          : [];
        return { tag, role, label, children };
      }
      return JSON.stringify(walk(document.body, 0), null, 0).slice(0, 5000);
    }) as string;
  } catch {
    accessibilityTree = '';
  }

  // Extract locators
  const keyLocators = await extractLocators(page);

  // Count elements
  const formCount = await page.locator('form').count().catch(() => 0);
  const inputCount = await page.locator('input:not([type="hidden"])').count().catch(() => 0);
  const buttonCount = await page.locator('button, [role="button"], input[type="submit"]').count().catch(() => 0);

  const loadTimeMs = Date.now() - startTime;

  return {
    url,
    navLabel,
    navPath,
    screenshotBase64,
    accessibilityTree,
    keyLocators,
    formCount,
    inputCount,
    buttonCount,
    loadTimeMs,
  };
}

async function extractLocators(page: Page): Promise<KeyLocator[]> {
  return page.evaluate(() => {
    const results: Array<{ semanticName: string; selector: string; locatorType: string }> = [];
    const seen = new Set<string>();

    function push(semanticName: string, selector: string, locatorType: string) {
      if (!semanticName || !selector || seen.has(selector)) return;
      seen.add(selector);
      results.push({ semanticName, selector, locatorType });
    }

    function bestSelector(el: HTMLElement): { name: string; selector: string; type: string } | null {
      const tag = el.tagName.toLowerCase();
      const inputType = (el as HTMLInputElement).type ?? '';
      const dataTestId = el.getAttribute('data-testid') ?? el.getAttribute('data-test') ?? el.getAttribute('data-cy') ?? '';
      const ariaLabel = el.getAttribute('aria-label') ?? '';
      const id = el.id;
      const labelEl = id ? document.querySelector(`label[for="${id}"]`) : null;
      const labelText = labelEl?.textContent?.trim() ?? '';
      const placeholder = el.getAttribute('placeholder') ?? '';
      const name = el.getAttribute('name') ?? '';
      const innerText = (el.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 50);

      if (dataTestId) return { name: dataTestId.replace(/[-_]/g, ' '), selector: `[data-testid="${dataTestId}"]`, type: 'testid' };
      if (ariaLabel) return { name: ariaLabel, selector: `[aria-label="${ariaLabel}"]`, type: 'aria' };
      if (labelText && id) return { name: labelText, selector: `#${id}`, type: 'label' };
      if (placeholder) return { name: `${inputType || tag} "${placeholder}"`, selector: `${tag}[placeholder="${placeholder}"]`, type: 'css' };
      if (innerText && (tag === 'button' || el.getAttribute('role') === 'button' || el.getAttribute('role') === 'tab' || el.getAttribute('role') === 'menuitem')) {
        return { name: `${innerText}`, selector: `${tag}:has-text("${innerText.slice(0, 30)}")`, type: 'text' };
      }
      if (name) return { name: `${inputType || tag} ${name}`, selector: `${tag}[name="${name}"]`, type: 'css' };
      if (id) return { name: id.replace(/[-_]/g, ' '), selector: `#${id}`, type: 'css' };
      return null;
    }

    // 1. All form controls
    document.querySelectorAll<HTMLElement>(
      'input:not([type="hidden"]), select, textarea',
    ).forEach((el) => {
      const r = bestSelector(el);
      if (r) push(r.name, r.selector, r.type);
    });

    // 2. Buttons and button-role elements
    document.querySelectorAll<HTMLElement>(
      'button, [role="button"], input[type="submit"], input[type="button"]',
    ).forEach((el) => {
      const r = bestSelector(el);
      if (r) push(r.name, r.selector, r.type);
    });

    // 3. Tab panels and menu items
    document.querySelectorAll<HTMLElement>(
      '[role="tab"], [role="menuitem"], [role="option"]',
    ).forEach((el) => {
      const r = bestSelector(el);
      if (r) push(r.name, r.selector, r.type);
    });

    // 4. Dropdown/popup triggers
    document.querySelectorAll<HTMLElement>(
      '[aria-haspopup], [aria-expanded]',
    ).forEach((el) => {
      const r = bestSelector(el);
      if (r) push(`${r.name} (dropdown)`, r.selector, r.type);
    });

    // 5. Action links (not nav links — CTAs like Edit, Delete, View, Add)
    const ACTION_WORDS = /\b(add|create|new|edit|update|delete|remove|view|open|submit|save|cancel|confirm|approve|reject|export|import|download|upload|search|filter|reset)\b/i;
    document.querySelectorAll<HTMLAnchorElement>('a[href]').forEach((a) => {
      const text = (a.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 50);
      if (!text || !ACTION_WORDS.test(text)) return;
      const ariaLabel = a.getAttribute('aria-label') ?? '';
      const dataTestId = a.getAttribute('data-testid') ?? '';
      if (dataTestId) push(dataTestId.replace(/[-_]/g, ' '), `[data-testid="${dataTestId}"]`, 'testid');
      else if (ariaLabel) push(ariaLabel, `[aria-label="${ariaLabel}"]`, 'aria');
      else push(`${text} link`, `a:has-text("${text.slice(0, 30)}")`, 'text');
    });

    // 6. Table column headers (important for knowing what data is on the page)
    document.querySelectorAll<HTMLElement>('th, [role="columnheader"]').forEach((th) => {
      const text = (th.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 40);
      if (!text || text.length < 2) return;
      push(`column: ${text}`, `th:has-text("${text.slice(0, 25)}")`, 'text');
    });

    // 7. Dialog / modal triggers (elements whose click visibly opens an overlay)
    document.querySelectorAll<HTMLElement>('[data-modal], [data-toggle="modal"], [aria-controls]').forEach((el) => {
      const r = bestSelector(el);
      if (r) push(`${r.name} (modal trigger)`, r.selector, r.type);
    });

    return results.slice(0, 60);
  }) as Promise<KeyLocator[]>;
}
