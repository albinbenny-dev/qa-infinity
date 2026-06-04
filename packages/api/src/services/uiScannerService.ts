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
    await usernameEl.pressSequentially(username, { delay: 40 });
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
    await pwEl.pressSequentially(password, { delay: 40 });
  } catch (err) {
    throw new Error(`ScanError: Login failed — could not fill password: ${(err as Error).message}`);
  }

  // Submit — force-click or Enter fallback handles Keycloak themes that keep button disabled
  steps.push({ order: loginType === 'two-step' ? 5 : 4, action: 'click', description: 'Submit login', selector: detectedSubmitSelector });
  try {
    const submitEl = page.locator(detectedSubmitSelector).first();
    try {
      await submitEl.click({ timeout: 5000 });
    } catch {
      try {
        await submitEl.click({ force: true });
      } catch {
        await page.keyboard.press('Enter');
      }
    }
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
    // Inline all logic — no named inner functions (avoids esbuild __name injection
    // which causes ReferenceError when Playwright serialises the fn to the browser).
    const elements = await page.evaluate(() => {
      const seen = new Set<string>();
      const results: Array<{ tag: string; text: string; href: string }> = [];

      // All anchor tags with hrefs (highest priority)
      document.querySelectorAll<HTMLAnchorElement>('a[href]').forEach((a) => {
        const text = (a.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 80);
        if (!text || a.href.includes('logout') || a.href.endsWith('#')) return;
        const key = text + a.href;
        if (seen.has(key)) return;
        seen.add(key);
        results.push({ tag: 'a', text, href: a.href });
      });

      // Buttons
      document.querySelectorAll<HTMLElement>('button:not([disabled]), [role="button"]').forEach((el) => {
        const text = (el.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 80);
        if (!text) return;
        const key = text + '';
        if (seen.has(key)) return;
        seen.add(key);
        results.push({ tag: el.tagName.toLowerCase(), text, href: '' });
      });

      // Clickable card/tile divs — React onClick elements (cursor:pointer, substantial size,
      // no <a> or <button> child so we don't double-count)
      document.querySelectorAll<HTMLElement>('[style*="cursor: pointer"], [style*="cursor:pointer"]').forEach((el) => {
        if (el.querySelector('a[href], button')) return;
        const rect = el.getBoundingClientRect();
        if (rect.width < 80 || rect.height < 40) return;
        const text = (el.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 80);
        if (!text) return;
        const key = text + '';
        if (seen.has(key)) return;
        seen.add(key);
        results.push({ tag: 'card', text, href: '' });
      });

      return results.slice(0, 100);
    });

    if (elements.length === 0) {
      console.log('[ui-scanner] Post-login nav: no interactive elements found');
      return;
    }

    // ── Ask LLM which element to click ────────────────────────────────────
    const llm = createLLM({ temperature: 0, agentName: 'ui-scanner' });
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
    // Extract the first {...} block — handles trailing text / markdown fences robustly
    const jsonMatch = raw.match(/\{[^}]*\}/);
    if (!jsonMatch) throw new Error(`LLM returned no JSON object: ${raw.slice(0, 120)}`);
    const parsed = JSON.parse(jsonMatch[0]) as { index: number; reason: string };

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

  // Collect all navigation <a> links currently visible/present in the DOM
  async function collectNavLinks(): Promise<Array<{ href: string; text: string }>> {
    return page.evaluate((origin: string) => {
      const selectors = [
        'nav a[href]',
        '[role="navigation"] a[href]',
        'aside a[href]',
        '[class*="sidebar"] a[href]',
        '[class*="sidenav"] a[href]',
        '[class*="nav-menu"] a[href]',
        'ul[class*="menu"] a[href]',
        'ul[class*="nav"] a[href]',
        'li[class*="menu-item"] a[href]',
        '[class*="nav-item"] a[href]',
        // Broad fallback — catches Ventas-style ul/li sidebars with no nav/aside wrapper
        'ul li a[href]',
      ];

      const seen = new Set<string>();
      const results: Array<{ href: string; text: string }> = [];
      const currentPath = new URL(window.location.href).pathname;

      for (const sel of selectors) {
        document.querySelectorAll<HTMLAnchorElement>(sel).forEach((a) => {
          const href = a.href;
          if (!href || seen.has(href)) return;
          if (!href.startsWith(origin)) return;
          if (/logout|\/404/.test(href)) return;

          // Skip anchors that merely point to the current page (expand-toggle style <a href="#">)
          try {
            const u = new URL(href);
            const fragment = u.hash.replace('#', '');
            // Hash links that don't look like SPA route paths are skip-worthy
            if (u.pathname === currentPath && (!fragment || !fragment.includes('/'))) return;
          } catch { return; }

          const text = (a.textContent ?? '').trim().replace(/\s+/g, ' ');
          if (!text) return;

          seen.add(href);
          results.push({ href, text });
        });
      }

      return results;
    }, baseOrigin);
  }

  // ── Pass 1: static snapshot ─────────────────────────────────────────────
  const allLinks = await collectNavLinks();
  const seenHrefs = new Set(allLinks.map((l) => l.href));

  // ── Pass 2: multi-round accordion expansion ──────────────────────────────
  // Ventas (and many Angular/React SPAs) have a 3-level sidebar:
  //   Level 1: Payment Management, Reports, Stock Management, …
  //   Level 2: Finance Reports, Customer Reports, … (revealed after clicking level 1)
  //   Level 3: Individual pages (revealed after clicking level 2)
  //
  // Previous bug: `container.querySelector('ul')` found the sub-menu <ul> of
  // the already-open Reports accordion, so its children were Finance Reports /
  // Customer Reports rather than the top-level items. Also, Ventas sidebars use
  // href="/" on accordion anchors, which was not handled by the toggle detector.
  //
  // Fix: scan ALL <li> elements in the sidebar (not just topUl.children), accept
  // href="/" as a toggle href, extract only the item's OWN label text (not nested
  // sub-items), and repeat up to 3 rounds to handle multi-level nesting.

  // Detect expandable items: search ALL <li>s in the page, not just first-ul children.
  // alreadyClicked is passed in so we skip items we've processed.
  async function detectExpandableItems(alreadyClicked: Set<string>): Promise<Array<{ text: string }>> {
    const done = Array.from(alreadyClicked);
    return page.evaluate((doneList: string[]) => {
      const results: Array<{ text: string }> = [];
      const seenText = new Set<string>();

      // ALL <li> elements across the page — don't limit to a single container/ul.
      // This avoids the "first <ul> is the open sub-menu" bug.
      for (const li of Array.from(document.querySelectorAll('li'))) {
        const anchor = li.querySelector<HTMLAnchorElement>(':scope > a');
        const href = anchor?.getAttribute('href') ?? '';

        // "Toggle href" = doesn't route to a real SPA path.
        // Includes: empty, "#", "/", "#/", "javascript:..."
        const isToggleHref =
          !href ||
          href === '#' ||
          href === '/' ||
          href === '#/' ||
          href.startsWith('javascript');

        const hasSVGorIcon =
          li.querySelector('svg, i, [class*="chevron"], [class*="arrow"], [class*="expand"], [class*="caret"]') !== null;
        const hasNestedList = li.querySelector('ul') !== null;

        if (!(isToggleHref && (hasSVGorIcon || hasNestedList))) continue;

        // Extract ONLY this item's own label — not nested sub-items.
        // Use direct text nodes of the anchor/span so sub-item text is excluded.
        const labelEl = anchor ?? li.querySelector<HTMLElement>(':scope > span, :scope > div');
        let text = '';
        if (labelEl) {
          text = Array.from(labelEl.childNodes)
            .filter((n) => n.nodeType === 3 /* TEXT_NODE */)
            .map((n) => n.textContent?.trim() ?? '')
            .join(' ')
            .replace(/\s+/g, ' ')
            .trim();
          // Fallback: use textContent of first meaningful child
          if (!text && labelEl.firstElementChild) {
            text = (labelEl.firstElementChild.textContent ?? '').trim().replace(/\s+/g, ' ');
          }
        }
        if (!text) {
          text = Array.from(li.childNodes)
            .filter((n) => n.nodeType === 3)
            .map((n) => n.textContent?.trim() ?? '')
            .join(' ')
            .trim();
        }
        text = text.slice(0, 70);

        if (!text || text.length < 2 || seenText.has(text)) continue;
        if (doneList.includes(text)) continue;
        seenText.add(text);
        results.push({ text });
      }

      return results.slice(0, 40);
    }, done);
  }

  // Click an item by text, preferring sidebar containers
  async function clickExpandable(text: string): Promise<void> {
    const sidebarSelectors = [
      '[class*="sidebar"]', '[class*="sidenav"]', '[class*="nav-menu"]',
      '[class*="left-panel"]', '[class*="left-nav"]', '[class*="main-nav"]',
      'aside', 'nav', '[role="navigation"]',
    ];
    for (const cSel of sidebarSelectors) {
      const container = page.locator(cSel).first();
      if (!(await container.isVisible().catch(() => false))) continue;
      const el = container.getByText(text, { exact: false }).first();
      if (await el.isVisible().catch(() => false)) {
        await el.click({ timeout: 3000 });
        return;
      }
    }
    // Fallback: click anywhere visible in the page
    const el = page.getByText(text, { exact: false }).first();
    if (await el.isVisible().catch(() => false)) {
      await el.click({ timeout: 3000 });
    }
  }

  // 3 rounds: round 0 = top-level items, round 1 = sub-categories, round 2 = deeper
  const clickedItems = new Set<string>();
  for (let round = 0; round < 3; round++) {
    const triggers = await detectExpandableItems(clickedItems);
    if (triggers.length === 0) break;

    let foundNewLinks = false;
    for (const trigger of triggers) {
      clickedItems.add(trigger.text);
      try {
        await clickExpandable(trigger.text);
        await page.waitForTimeout(600);

        const newLinks = await collectNavLinks();
        for (const link of newLinks) {
          if (!seenHrefs.has(link.href)) {
            seenHrefs.add(link.href);
            allLinks.push(link);
            foundNewLinks = true;
          }
        }
      } catch {
        // Non-fatal — some items may close another menu or navigate away
      }
    }

    if (!foundNewLinks) break; // no new links this round — deeper expansion won't help
  }

  // ── Build NavNode tree ───────────────────────────────────────────────────
  const roots: NavNode[] = [];
  const nodeMap = new Map<string, NavNode>();

  for (const link of allLinks) {
    const urlPattern = link.href.replace(/[0-9a-f]{8,}/gi, ':id').replace(/\d+/g, ':num');
    // Use hash-segment count as a heuristic for depth
    // e.g. /#/hierarchy/geo → hash="hierarchy/geo" → depth=1
    let depth = 0;
    try {
      const hash = new URL(link.href).hash.replace('#/', '');
      depth = Math.max(0, hash.split('/').length - 1);
    } catch { /* ignore */ }

    const node: NavNode = {
      label: link.text,
      url: link.href,
      urlPattern,
      children: [],
      pageType: inferPageType(link.text, link.href),
      depth,
    };
    nodeMap.set(link.href, node);

    if (depth === 0) {
      roots.push(node);
    }
  }

  // Attach depth-1+ nodes as children of depth-0 parents
  for (const node of nodeMap.values()) {
    if (node.depth === 0) continue;
    const parent = roots.find((r) =>
      node.url.includes(new URL(r.url).hash.replace('#/', '').split('/')[0] ?? '__none__'),
    );
    if (parent && parent !== node) {
      parent.children.push(node);
    } else {
      roots.push(node); // orphan — promote to root
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
  // Use object reference trick for recursion — avoids esbuild __name injection that
  // breaks page.evaluate serialization (named arrow functions get wrapped in __name()).
  let accessibilityTree = '';
  try {
    accessibilityTree = await page.evaluate(() => {
      const h: { w: ((el: Element, depth: number) => object) | null } = { w: null };
      h.w = (el, depth) => {
        const tag = el.tagName.toLowerCase();
        const role = el.getAttribute('role') ?? '';
        const label = el.getAttribute('aria-label') ?? el.getAttribute('placeholder') ?? (el as HTMLElement).innerText?.slice(0, 60) ?? '';
        const children = depth < 3
          ? Array.from(el.children).slice(0, 5).map((c) => h.w!(c, depth + 1))
          : [];
        return { tag, role, label, children };
      };
      return JSON.stringify(h.w(document.body, 0), null, 0).slice(0, 5000);
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
  // Use object reference pattern for named helpers — avoids esbuild __name injection
  // that breaks page.evaluate serialization (const fn = () => {} gets wrapped in __name()).
  // Also guards document.querySelector against CSS-invalid id values (dots, brackets, etc.)
  // which throw SyntaxError and cause the whole evaluate to fail.
  return page.evaluate(() => {
    const results: Array<{ semanticName: string; selector: string; locatorType: string }> = [];
    const seen = new Set<string>();

    const fns: {
      push: (semanticName: string, selector: string, locatorType: string) => void;
      bestSelector: (el: HTMLElement) => { name: string; selector: string; type: string } | null;
    } = { push: null!, bestSelector: null! };

    fns.push = (semanticName, selector, locatorType) => {
      if (!semanticName || !selector || seen.has(selector)) return;
      seen.add(selector);
      results.push({ semanticName, selector, locatorType });
    };

    fns.bestSelector = (el) => {
      const tag = el.tagName.toLowerCase();
      const inputType = (el as HTMLInputElement).type ?? '';
      const dataTestId = el.getAttribute('data-testid') ?? el.getAttribute('data-test') ?? el.getAttribute('data-cy') ?? '';
      const ariaLabel = el.getAttribute('aria-label') ?? '';
      const id = el.id;
      // Guard: IDs with CSS-special chars (dots, brackets, colons) throw in querySelector
      let labelText = '';
      if (id && /^[a-zA-Z][\w-]*$/.test(id)) {
        try { labelText = document.querySelector(`label[for="${id}"]`)?.textContent?.trim() ?? ''; } catch { /* skip */ }
      }
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
    };

    // 1. All form controls
    document.querySelectorAll<HTMLElement>(
      'input:not([type="hidden"]), select, textarea',
    ).forEach((el) => {
      const r = fns.bestSelector(el);
      if (r) fns.push(r.name, r.selector, r.type);
    });

    // 2. Buttons and button-role elements
    document.querySelectorAll<HTMLElement>(
      'button, [role="button"], input[type="submit"], input[type="button"]',
    ).forEach((el) => {
      const r = fns.bestSelector(el);
      if (r) fns.push(r.name, r.selector, r.type);
    });

    // 3. Tab panels and menu items
    document.querySelectorAll<HTMLElement>(
      '[role="tab"], [role="menuitem"], [role="option"]',
    ).forEach((el) => {
      const r = fns.bestSelector(el);
      if (r) fns.push(r.name, r.selector, r.type);
    });

    // 4. Dropdown/popup triggers
    document.querySelectorAll<HTMLElement>(
      '[aria-haspopup], [aria-expanded]',
    ).forEach((el) => {
      const r = fns.bestSelector(el);
      if (r) fns.push(`${r.name} (dropdown)`, r.selector, r.type);
    });

    // 5. Action links (not nav links — CTAs like Edit, Delete, View, Add)
    const ACTION_WORDS = /\b(add|create|new|edit|update|delete|remove|view|open|submit|save|cancel|confirm|approve|reject|export|import|download|upload|search|filter|reset)\b/i;
    document.querySelectorAll<HTMLAnchorElement>('a[href]').forEach((a) => {
      const text = (a.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 50);
      if (!text || !ACTION_WORDS.test(text)) return;
      const ariaLabel = a.getAttribute('aria-label') ?? '';
      const dataTestId = a.getAttribute('data-testid') ?? '';
      if (dataTestId) fns.push(dataTestId.replace(/[-_]/g, ' '), `[data-testid="${dataTestId}"]`, 'testid');
      else if (ariaLabel) fns.push(ariaLabel, `[aria-label="${ariaLabel}"]`, 'aria');
      else fns.push(`${text} link`, `a:has-text("${text.slice(0, 30)}")`, 'text');
    });

    // 6. Table column headers (important for knowing what data is on the page)
    document.querySelectorAll<HTMLElement>('th, [role="columnheader"]').forEach((th) => {
      const text = (th.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 40);
      if (!text || text.length < 2) return;
      fns.push(`column: ${text}`, `th:has-text("${text.slice(0, 25)}")`, 'text');
    });

    // 7. Dialog / modal triggers (elements whose click visibly opens an overlay)
    document.querySelectorAll<HTMLElement>('[data-modal], [data-toggle="modal"], [aria-controls]').forEach((el) => {
      const r = fns.bestSelector(el);
      if (r) fns.push(`${r.name} (modal trigger)`, r.selector, r.type);
    });

    return results.slice(0, 60);
  }) as Promise<KeyLocator[]>;
}

// ── Quick login test (pre-scan verification) ───────────────────────────────

export interface QuickLoginTestResult {
  success: boolean;
  finalUrl?: string;
  errorMessage?: string;
  screenshotBase64?: string;
  loginInstructions?: LoginInstructions;
}

export async function quickLoginTest(opts: {
  baseUrl: string;
  username: string;
  password: string;
}): Promise<QuickLoginTestResult> {
  const { baseUrl, username, password } = opts;

  const browser = await chromium.launch({
    executablePath: CHROMIUM_PATH,
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  });

  const browserContext = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    ignoreHTTPSErrors: true,
  });
  const page = await browserContext.newPage();

  try {
    await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(300);

    const loginInstructions = await performLogin(page, baseUrl, username, password);

    const finalUrl = page.url();
    const buf = await page.screenshot({ type: 'jpeg', quality: 60, fullPage: true });
    return {
      success: true,
      finalUrl,
      screenshotBase64: buf.toString('base64'),
      loginInstructions,
    };
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    let screenshotBase64: string | undefined;
    try {
      const buf = await page.screenshot({ type: 'jpeg', quality: 50, fullPage: true });
      screenshotBase64 = buf.toString('base64');
    } catch { /* ignore */ }
    return { success: false, errorMessage, screenshotBase64 };
  } finally {
    await browserContext.close().catch(() => {});
    await browser.close().catch(() => {});
  }
}
