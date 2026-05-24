import { chromium } from 'playwright-core';
import type { LoginInstructions } from '../types/scanner.js';

const CHROMIUM_PATH =
  process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ?? '/usr/bin/chromium-browser';

export interface LoginTestResult {
  success: boolean;
  finalUrl?: string;
  errorMessage?: string;
  screenshotBase64?: string;
}

export async function testLoginFlow(opts: {
  baseUrl: string;
  username: string;
  password: string;
  login: LoginInstructions;
}): Promise<LoginTestResult> {
  const { baseUrl, username, password, login } = opts;

  const browser = await chromium.launch({
    executablePath: CHROMIUM_PATH,
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  });

  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    ignoreHTTPSErrors: true,
  });
  const page = await context.newPage();

  try {
    await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(1500);

    const sortedSteps = [...login.steps].sort((a, b) => a.order - b.order);

    for (const step of sortedSteps) {
      if (step.action === 'navigate') {
        const target = step.selector?.startsWith('http') ? step.selector : baseUrl;
        await page.goto(target, { waitUntil: 'domcontentloaded', timeout: 20000 });
        await page.waitForTimeout(800);
      } else if (step.action === 'fill') {
        if (!step.selector) continue;
        const isPassword = step.description.toLowerCase().includes('password');
        const value = isPassword ? password : username;
        const el = page.locator(step.selector).first();
        await el.waitFor({ state: 'visible', timeout: 8000 });
        await el.click({ clickCount: 3 });
        await el.fill(value);
      } else if (step.action === 'click') {
        if (!step.selector) continue;
        const el = page.locator(step.selector).first();
        await el.waitFor({ state: 'visible', timeout: 8000 });
        await el.click();
        await page.waitForTimeout(1200);
      }
    }

    // Wait for navigation away from login page
    await page.waitForURL(
      (url) => {
        const h = url.href.toLowerCase();
        return h !== baseUrl.toLowerCase() && !h.includes('login') && !h.includes('auth');
      },
      { timeout: 15000 },
    );

    const finalUrl = page.url();
    const buf = await page.screenshot({ type: 'jpeg', quality: 60 });
    return { success: true, finalUrl, screenshotBase64: buf.toString('base64') };
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    let screenshotBase64: string | undefined;
    try {
      const buf = await page.screenshot({ type: 'jpeg', quality: 50 });
      screenshotBase64 = buf.toString('base64');
    } catch { /* ignore */ }
    return { success: false, errorMessage, screenshotBase64 };
  } finally {
    await context.close().catch(() => {});
    await browser.close().catch(() => {});
  }
}
