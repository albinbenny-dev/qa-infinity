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
    // Navigate to the login page (same as TC-AIR-001 step 1)
    await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(1000);

    const sortedSteps = [...login.steps].sort((a, b) => a.order - b.order);
    const isTwoStep = login.loginType === 'two-step';
    let twoStepRevealDone = false;

    for (const step of sortedSteps) {
      if (step.action === 'navigate') {
        // Skip re-navigation — we already loaded the page above
        continue;
      } else if (step.action === 'fill') {
        if (!step.selector) continue;
        const isPassword = step.description.toLowerCase().includes('password');
        const value = isPassword ? password : username;
        const el = page.locator(step.selector).first();
        await el.waitFor({ state: 'visible', timeout: 8000 });
        await el.click({ clickCount: 3 });
        // Use pressSequentially so each keystroke fires keydown/keypress/keyup events —
        // Keycloak enables the submit button only when it detects real key events on the
        // password field, not when the value is set programmatically via fill().
        await el.pressSequentially(value, { delay: 40 });
      } else if (step.action === 'click') {
        if (!step.selector) continue;
        const el = page.locator(step.selector).first();
        await el.waitFor({ state: 'visible', timeout: 8000 });

        // Some Keycloak themes keep the submit button disabled even after filling fields.
        // Try a normal click first; if the element is still disabled after a short wait,
        // fall back to force-click (bypasses actionability) then Enter key as last resort.
        const urlBefore = page.url();
        try {
          await el.click({ timeout: 5000 });
        } catch {
          try {
            await el.click({ force: true });
          } catch {
            await page.keyboard.press('Enter');
          }
        }
        await page.waitForTimeout(1500);

        // Detect navigation triggered by the click — if URL changed we're past login
        const urlAfter = page.url();
        if (urlAfter !== urlBefore && urlAfter.includes('/login')) {
          // Still on login — wait a bit more for redirect to settle
          await page.waitForTimeout(1000);
        }

        // Two-step form (e.g. Ventas/Keycloak): after the first submit click reveals the
        // password field, verify the username is still populated — matching TC-AIR-001
        // step 4 pattern. If the SPA cleared it, re-fill before the password step runs.
        if (isTwoStep && !twoStepRevealDone && login.selectors.username) {
          twoStepRevealDone = true;
          try {
            const usernameEl = page.locator(login.selectors.username).first();
            await usernameEl.waitFor({ state: 'visible', timeout: 5000 });
            const currentVal = await usernameEl.inputValue();
            if (!currentVal || currentVal.trim() !== username.trim()) {
              await usernameEl.click({ clickCount: 3 });
              await usernameEl.fill(username);
            }
          } catch { /* non-fatal — best-effort */ }
        }
      }
      // 'assert' steps are informational only — skip
    }

    // Wait for navigation away from the login page.
    // Mirror TC-AIR-001: check url.pathname, NOT url.href.
    // This correctly handles Keycloak OIDC flows where the redirect chain passes
    // through /login-actions/authenticate (pathname contains '/login') before
    // landing on the app's post-login URL (pathname is just '/').
    await page.waitForURL(
      (url) => !url.pathname.toLowerCase().includes('/login'),
      { timeout: 20000 },
    );

    const finalUrl = page.url();
    const buf = await page.screenshot({ type: 'jpeg', quality: 60, fullPage: true });
    return { success: true, finalUrl, screenshotBase64: buf.toString('base64') };
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    let screenshotBase64: string | undefined;
    try {
      const buf = await page.screenshot({ type: 'jpeg', quality: 50, fullPage: true });
      screenshotBase64 = buf.toString('base64');
    } catch { /* ignore */ }
    return { success: false, errorMessage, screenshotBase64 };
  } finally {
    await context.close().catch(() => {});
    await browser.close().catch(() => {});
  }
}
