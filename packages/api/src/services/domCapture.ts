import { compressScreenshot, jpegDataPrefix } from '../lib/imageOptimizer.js';

export interface DomSnapshot {
  html: string;
  interactiveElements: Array<{
    tag: string;
    role: string;
    text: string;
    selector: string;
  }>;
  /**
   * Base64-encoded JPEG (not PNG).
   * Compressed to 1024px wide, quality 60 — ~90% smaller than raw PNG.
   * Embed as: `data:image/jpeg;base64,${screenshot}`
   */
  screenshot: string;
}

// ── DOM pruning ────────────────────────────────────────────────────────────

/**
 * Strip noise from raw HTML before sending to the LLM.
 *
 * Removes: <script>, <style>, <svg>, <noscript>, <meta>, <link>, comments.
 * Keeps only essential attributes: id, class, name, type, placeholder,
 *   href, value, aria-label, data-testid, role.
 *
 * Typical reduction: 50 KB raw HTML → 4–6 KB pruned = ~90% smaller.
 */
function pruneHtml(html: string): string {
  // Remove block-level noise tags (including their content for script/style)
  let pruned = html
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '')
    .replace(/<svg\b[^<]*(?:(?!<\/svg>)<[^<]*)*<\/svg>/gi, '<svg/>')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<(noscript|meta|link|head)[^>]*>[\s\S]*?<\/\1>/gi, '')
    .replace(/<(meta|link|br|hr|img|input)[^>]*\/?>/gi, (_m, tag) => `<${tag}/>`);

  // Strip non-essential attributes — keep only the ones the LLM needs
  const KEEP_ATTRS = new Set([
    'id', 'class', 'name', 'type', 'placeholder',
    'href', 'value', 'aria-label', 'data-testid', 'role',
  ]);
  pruned = pruned.replace(/<([a-zA-Z][a-zA-Z0-9-]*)\s([^>]+)>/g, (_match, tag, attrStr) => {
    const kept: string[] = [];
    // Match key="value" or key='value' or key=value or standalone key
    const attrRe = /([a-zA-Z][a-zA-Z0-9-]*)(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]*))?/g;
    let m: RegExpExecArray | null;
    while ((m = attrRe.exec(attrStr)) !== null) {
      if (KEEP_ATTRS.has(m[1].toLowerCase())) {
        kept.push(m[0]);
      }
    }
    return kept.length ? `<${tag} ${kept.join(' ')}>` : `<${tag}>`;
  });

  // Collapse whitespace and hard-cap length
  pruned = pruned.replace(/\s{2,}/g, ' ').trim();
  return pruned.slice(0, 12_000); // hard cap — well within a single LLM context chunk
}

// ── Snapshot capture ───────────────────────────────────────────────────────

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

    // ── Optimisation: prune DOM before returning — ~90% size reduction ──
    const rawHtml = await page.content();
    const html = pruneHtml(rawHtml);

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

    // ── Optimisation: compress PNG → JPEG — ~90% fewer image tokens ──
    const rawPng = await page.screenshot({ type: 'png', fullPage: false });
    const jpeg = await compressScreenshot(rawPng);
    // Store as plain base64; callers should prefix with jpegDataPrefix() when embedding
    const screenshot = jpeg.toString('base64');

    await browser.close();

    return { html, interactiveElements, screenshot };
  } catch (err) {
    console.warn('[dom-capture] Failed to capture DOM snapshot:', (err as Error).message);
    return null;
  }
}

export { jpegDataPrefix };
