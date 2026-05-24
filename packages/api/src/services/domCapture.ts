export interface DomSnapshot {
  html: string;
  interactiveElements: Array<{
    tag: string;
    role: string;
    text: string;
    selector: string;
  }>;
  screenshot: string; // base64-encoded PNG
}

export async function captureSnapshot(
  url: string,
  credentials?: { username: string; password: string },
): Promise<DomSnapshot | null> {
  try {
    const { chromium } = await import('playwright-core');

    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext();

    if (credentials) {
      await context.setHTTPCredentials(credentials);
    }

    const page = await context.newPage();
    await page.goto(url, { waitUntil: 'networkidle', timeout: 15000 });

    const html = await page.content();

    const interactiveElements = await page.evaluate((): Array<{
      tag: string;
      role: string;
      text: string;
      selector: string;
    }> => {
      const results: Array<{ tag: string; role: string; text: string; selector: string }> = [];
      const sel = 'button, a, input, select, textarea, [role], [data-testid], [id]';
      document.querySelectorAll(sel).forEach((el, i) => {
        const tag = el.tagName.toLowerCase();
        const role = el.getAttribute('role') ?? tag;
        const text = (el.textContent ?? '').trim().slice(0, 100);
        const testId = el.getAttribute('data-testid');
        const id = el.getAttribute('id');
        const selector = testId
          ? `[data-testid="${testId}"]`
          : id
          ? `#${id}`
          : `${tag}:nth-of-type(${i + 1})`;
        results.push({ tag, role, text, selector });
      });
      return results.slice(0, 60);
    });

    const screenshotBuffer = await page.screenshot({ type: 'png', fullPage: false });
    const screenshot = screenshotBuffer.toString('base64');

    await browser.close();

    return {
      html: html.slice(0, 50_000),
      interactiveElements,
      screenshot,
    };
  } catch (err) {
    console.warn('[dom-capture] Failed to capture DOM snapshot:', (err as Error).message);
    return null;
  }
}
