import fs from 'fs';
import * as cheerio from 'cheerio';
import { loadActiveSkills } from '../lib/skillsContext.js';

export interface AutoScanSnapshot {
  screenshotBase64: string;
  label: string;
  url: string;
  pageTitle: string;
  interactiveElements: string;
}

interface LoginLocators {
  loginUrl: string;
  usernameSelector: string;
  passwordSelector: string;
  submitSelector: string;
  isTwoStep: boolean;
}

function extractLoginLocators(slug: string): LoginLocators | null {
  try {
    const skills = loadActiveSkills(slug);
    const loginSkill = skills.find(
      (s) => s.skillType === 'UI_FLOW' && s.name.toLowerCase().includes('login'),
    );
    if (!loginSkill) return null;

    const content = JSON.parse(loginSkill.content) as Record<string, unknown>;
    const loginUrl = content.targetUrl as string | undefined;
    if (!loginUrl) return null;

    const locators = (
      content.locators as Array<{
        semanticName: string;
        selector: string;
        locatorType: string;
        interactionNote?: string;
      }>
    ) ?? [];

    const usernameLocator = locators.find(
      (l) => l.locatorType === 'role' && /user|email|username/i.test(l.semanticName),
    ) ?? locators.filter((l) => l.locatorType === 'role')[0];

    const passwordLocator = locators.find(
      (l) =>
        l.locatorType === 'role' &&
        (/pass|pwd|password/i.test(l.semanticName) || l.interactionNote?.includes('keyword press')),
    ) ?? locators.filter((l) => l.locatorType === 'role')[2];

    const submitLocator = locators.find(
      (l) => l.locatorType === 'role' && /login|sign.?in|submit|next|continue/i.test(l.semanticName),
    ) ?? locators.find((l) => !/textbox|input/i.test(l.semanticName ?? ''));

    if (!usernameLocator || !passwordLocator || !submitLocator) return null;

    const submitIdx = locators.indexOf(submitLocator);
    const passwordIdx = locators.indexOf(passwordLocator);
    const isTwoStep = submitIdx < passwordIdx && submitIdx >= 0;

    return {
      loginUrl,
      usernameSelector: usernameLocator.selector,
      passwordSelector: passwordLocator.selector,
      submitSelector: submitLocator.selector,
      isTwoStep,
    };
  } catch {
    return null;
  }
}

function extractInteractiveElements(html: string): string {
  const $ = cheerio.load(html);
  const lines: string[] = [];

  $('h1, h2, h3').each((_, el) => {
    const text = $(el).text().trim();
    if (text) lines.push(`Heading [${el.tagName}]: ${text}`);
  });

  $('form').each((idx, form) => {
    lines.push(`\nForm ${idx + 1}:`);
    $(form).find('input:not([type="hidden"]), select, textarea').each((_, field) => {
      const type = ($(field).attr('type') ?? field.tagName).toLowerCase();
      const id = $(field).attr('id') ?? '';
      const labelText =
        $(`label[for="${id}"]`).text().trim() ||
        $(field).closest('label').text().trim() ||
        $(field).attr('placeholder') ||
        $(field).attr('name') ||
        '(unlabelled)';
      lines.push(`  - ${type} field: ${labelText}`);
    });
    $(form).find('button, input[type="submit"]').each((_, btn) => {
      const text = $(btn).text().trim() || String($(btn).attr('value') ?? 'Submit');
      lines.push(`  - button: ${text}`);
    });
  });

  $('button, [role="button"]').not('form button').each((_, btn) => {
    const text = $(btn).text().trim().slice(0, 60);
    if (text) lines.push(`Button: ${text}`);
  });

  $('[class*="error"], [class*="alert"], [role="alert"]').each((_, el) => {
    const text = $(el).text().trim().slice(0, 100);
    if (text) lines.push(`Visible message: ${text}`);
  });

  return lines.join('\n') || '(No interactive elements detected)';
}

export async function autoScanPage(
  targetUrl: string,
  projectSlug: string,
  envConfig: { username: string; password: string } | null,
  menuContext?: string,
): Promise<AutoScanSnapshot[]> {
  const chromiumPath = process.env['PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH'];
  if (!chromiumPath || !fs.existsSync(chromiumPath)) return [];

  const { chromium } = await import('playwright-core');
  const browser = await chromium.launch({
    executablePath: chromiumPath,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--ignore-certificate-errors',
    ],
    headless: true,
  });

  const snapshots: AutoScanSnapshot[] = [];

  try {
    const context = await browser.newContext({
      viewport: { width: 1024, height: 640 },
      ignoreHTTPSErrors: true,
    });
    const page = await context.newPage();

    // ── Step 1: Login ──────────────────────────────────────────────────────
    const loginLocators = extractLoginLocators(projectSlug);

    if (loginLocators && envConfig?.username) {
      console.log(`[auto-scan] Logging in via ${loginLocators.loginUrl}`);
      await page.goto(loginLocators.loginUrl, { waitUntil: 'domcontentloaded', timeout: 20_000 });

      // Fill username
      try {
        await page.getByRole('textbox', { name: loginLocators.usernameSelector }).fill(envConfig.username);
      } catch {
        await page.locator('input[type="text"], input[name*="user"], input[id*="user"]').first().fill(envConfig.username).catch(() => {});
      }

      // Two-step login: click submit before password appears
      if (loginLocators.isTwoStep) {
        try {
          await page.getByRole('button', { name: loginLocators.submitSelector }).click();
          await page.waitForTimeout(1500);
        } catch {}
      }

      // Fill password
      try {
        await page.getByRole('textbox', { name: loginLocators.passwordSelector }).fill(envConfig.password);
      } catch {
        await page.locator('input[type="password"]').first().fill(envConfig.password).catch(() => {});
      }

      // Submit
      try {
        await page.getByRole('button', { name: loginLocators.submitSelector }).click();
      } catch {
        await page.locator('button[type="submit"], input[type="submit"]').first().click().catch(() => {});
      }

      await page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 15_000 }).catch(() => {});
      console.log('[auto-scan] Login complete, now at:', page.url());
    }

    // ── Step 2: Navigate to target page ───────────────────────────────────
    await page.goto(targetUrl, { waitUntil: 'networkidle', timeout: 30_000 });
    await page.waitForTimeout(1500);

    // ── Step 2b: Navigate to menuContext if provided ───────────────────────
    if (menuContext) {
      try {
        const navSelectors = [
          `a:has-text("${menuContext}")`,
          `button:has-text("${menuContext}")`,
          `[role="menuitem"]:has-text("${menuContext}")`,
          `li:has-text("${menuContext}")`,
          `span:has-text("${menuContext}")`,
        ];
        let clicked = false;
        for (const sel of navSelectors) {
          const el = page.locator(sel).first();
          const count = await el.count();
          if (count > 0) {
            await el.click({ timeout: 5000 });
            await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});
            clicked = true;
            break;
          }
        }
        if (!clicked) {
          const words = menuContext.split(/\s+/).filter(w => w.length > 3);
          for (const word of words.slice(0, 2)) {
            const el = page.locator(`a, button, [role="menuitem"]`).filter({ hasText: new RegExp(word, 'i') }).first();
            if (await el.count() > 0) {
              await el.click({ timeout: 5000 }).catch(() => {});
              await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});
              break;
            }
          }
        }
      } catch {
        // Navigation click failed — proceed with screenshot of current page
      }
    }

    const [initBuf, pageTitle, html] = await Promise.all([
      page.screenshot({ type: 'jpeg', quality: 60, fullPage: false }),
      page.title(),
      page.content(),
    ]);

    snapshots.push({
      screenshotBase64: initBuf.toString('base64'),
      label: `${pageTitle || targetUrl} — initial state`,
      url: page.url(),
      pageTitle: pageTitle || targetUrl,
      interactiveElements: extractInteractiveElements(html),
    });

    // ── Step 3: Try to open a create/add form ──────────────────────────────
    const createSelectors = [
      'button:has-text("Create")',
      'button:has-text("New")',
      'button:has-text("Add")',
      '[role="button"]:has-text("Create")',
      '[role="button"]:has-text("New")',
      '[role="button"]:has-text("Add")',
      'button:has-text("+")',
      'a:has-text("Create")',
      'a:has-text("New")',
    ];

    let formOpened = false;
    for (const sel of createSelectors) {
      try {
        const btn = page.locator(sel).first();
        if (await btn.isVisible({ timeout: 800 })) {
          await btn.click();
          await page.waitForTimeout(1500);
          const [formBuf, formHtml] = await Promise.all([
            page.screenshot({ type: 'jpeg', quality: 60, fullPage: false }),
            page.content(),
          ]);
          snapshots.push({
            screenshotBase64: formBuf.toString('base64'),
            label: `${pageTitle || targetUrl} — create form open`,
            url: page.url(),
            pageTitle: pageTitle || targetUrl,
            interactiveElements: extractInteractiveElements(formHtml),
          });
          formOpened = true;
          break;
        }
      } catch {}
    }

    // ── Step 4: If no form found, scroll to reveal more content ───────────
    if (!formOpened) {
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight / 3));
      await page.waitForTimeout(500);
      const scrollBuf = await page.screenshot({ type: 'jpeg', quality: 60, fullPage: false });
      snapshots.push({
        screenshotBase64: scrollBuf.toString('base64'),
        label: `${pageTitle || targetUrl} — scrolled view`,
        url: page.url(),
        pageTitle: pageTitle || targetUrl,
        interactiveElements: '',
      });
    }
  } catch (err) {
    console.error('[auto-scan] Failed:', err instanceof Error ? err.message : String(err));
  } finally {
    await browser.close();
  }

  return snapshots;
}
