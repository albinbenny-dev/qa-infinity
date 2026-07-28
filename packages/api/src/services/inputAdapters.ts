import fetch from 'node-fetch';
import * as cheerio from 'cheerio';
import fs from 'fs';
import path from 'path';
import * as xlsx from 'xlsx';
import mammoth from 'mammoth';
// @ts-ignore
import pdfParse from 'pdf-parse';
import { prisma } from '../lib/prisma.js';

export function mimeFromPath(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  const map: Record<string, string> = {
    '.pdf':  'application/pdf',
    '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    '.xls':  'application/vnd.ms-excel',
    '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    '.doc':  'application/msword',
    '.txt':  'text/plain',
    '.md':   'text/markdown',
    '.yaml': 'text/plain',
    '.yml':  'text/plain',
  };
  return map[ext] ?? 'text/plain';
}

export interface UISnapshot {
  url: string;
  pageTitle: string;
  screenshotBase64: string | null;
  interactiveElements: string;
  mediaType?: 'image/png' | 'image/jpeg';
  label?: string;
}

export async function fetchJiraStory(keyOrUrl: string): Promise<string> {
  const jiraBase = process.env.JIRA_HOST;
  const jiraToken = process.env.JIRA_API_TOKEN;
  const jiraEmail = process.env.JIRA_EMAIL;

  if (!jiraBase) throw new Error('JIRA_HOST is not configured');

  let issueKey = keyOrUrl.trim();
  const urlMatch = keyOrUrl.match(/browse\/([A-Z0-9]+-\d+)/i);
  if (urlMatch) issueKey = urlMatch[1].toUpperCase();

  const url = `${jiraBase.replace(/\/$/, '')}/rest/api/3/issue/${issueKey}`;
  const headers: Record<string, string> = { Accept: 'application/json' };

  if (jiraToken && jiraEmail) {
    const creds = Buffer.from(`${jiraEmail}:${jiraToken}`).toString('base64');
    headers['Authorization'] = `Basic ${creds}`;
  } else if (jiraToken) {
    headers['Authorization'] = `Bearer ${jiraToken}`;
  }

  const res = await fetch(url, { headers, signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`Jira API returned ${res.status} for issue "${issueKey}"`);

  const data = (await res.json()) as Record<string, unknown>;
  const fields = (data.fields as Record<string, unknown>) ?? {};

  const lines: string[] = [
    `Issue: ${issueKey}`,
    `Summary: ${fields['summary'] ?? 'N/A'}`,
    `Type: ${(fields['issuetype'] as any)?.name ?? 'N/A'}`,
    `Status: ${(fields['status'] as any)?.name ?? 'N/A'}`,
    `Priority: ${(fields['priority'] as any)?.name ?? 'N/A'}`,
    '',
  ];

  if (fields['description']) {
    lines.push('Description:');
    lines.push(extractAtlassianDocText(fields['description']));
    lines.push('');
  }

  const acField = fields['acceptance_criteria'] ?? fields['customfield_10016'];
  if (acField) {
    lines.push('Acceptance Criteria:');
    lines.push(typeof acField === 'string' ? acField : extractAtlassianDocText(acField));
    lines.push('');
  }

  return lines.join('\n');
}

function extractAtlassianDocText(doc: unknown): string {
  if (typeof doc === 'string') return doc;
  if (!doc || typeof doc !== 'object') return '';
  const content = (doc as Record<string, unknown>)['content'];
  if (!Array.isArray(content)) return '';
  return content.map(extractNodeText).join('\n');
}

function extractNodeText(node: unknown): string {
  if (!node || typeof node !== 'object') return '';
  const n = node as Record<string, unknown>;
  if (n['type'] === 'text') return String(n['text'] ?? '');
  if (Array.isArray(n['content'])) return (n['content'] as unknown[]).map(extractNodeText).join('');
  return '';
}

export async function fetchUrlContent(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'QA-Infinity-Bot/1.0' },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching URL: ${url}`);

  const html = await res.text();
  const $ = cheerio.load(html);
  $('script, style, nav, footer, header, .nav, .footer, .menu, .sidebar').remove();

  const title = $('title').text().trim();
  const body = $('body').text().replace(/\s+/g, ' ').trim();
  return title ? `Page: ${title}\n\n${body}` : body;
}

export async function readUploadedFile(filePath: string, mimeType: string): Promise<string> {
  if (!fs.existsSync(filePath)) throw new Error(`File not found: ${filePath}`);

  if (mimeType === 'application/pdf') {
    const buffer = fs.readFileSync(filePath);
    const data = await pdfParse(buffer);
    return data.text;
  }

  if (
    mimeType === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
    mimeType === 'application/vnd.ms-excel'
  ) {
    const workbook = xlsx.readFile(filePath);
    return workbook.SheetNames.map((name) => {
      const ws = workbook.Sheets[name];
      return `[Sheet: ${name}]\n${xlsx.utils.sheet_to_csv(ws)}`;
    }).join('\n\n');
  }

  if (
    mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
    mimeType === 'application/msword'
  ) {
    const result = await mammoth.extractRawText({ path: filePath });
    return result.value;
  }

  if (mimeType === 'text/plain' || mimeType === 'text/markdown') {
    return fs.readFileSync(filePath, 'utf-8');
  }

  throw new Error(`Unsupported file type: ${mimeType}`);
}

export async function fetchUISnapshot(url: string): Promise<UISnapshot> {
  const chromiumPath = process.env['PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH'];

  if (!chromiumPath || !fs.existsSync(chromiumPath)) {
    // No browser available — fall back to DOM text extraction only
    const text = await fetchUrlContent(url).catch(() => `Could not fetch content from ${url}`);
    return { url, pageTitle: url, screenshotBase64: null, interactiveElements: text };
  }

  let browser: import('playwright-core').Browser | null = null;
  try {
    const { chromium } = await import('playwright-core');
    browser = await chromium.launch({
      executablePath: chromiumPath,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
      headless: true,
    });

    const page = await browser.newPage();
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto(url, { waitUntil: 'networkidle', timeout: 30_000 });

    const [screenshotBuf, pageTitle, html] = await Promise.all([
      page.screenshot({ type: 'png', fullPage: false }),
      page.title(),
      page.content(),
    ]);

    const screenshotBase64 = screenshotBuf.toString('base64');
    const interactiveElements = extractInteractiveElements(html);

    return { url, pageTitle, screenshotBase64, interactiveElements };
  } finally {
    if (browser) await browser.close();
  }
}

function extractInteractiveElements(html: string): string {
  const $ = cheerio.load(html);
  const lines: string[] = [];

  // Page headings
  $('h1, h2, h3').each((_, el) => {
    const text = $(el).text().trim();
    if (text) lines.push(`Heading [${el.tagName}]: ${text}`);
  });

  // Forms and their fields
  $('form').each((idx, form) => {
    lines.push(`\nForm ${idx + 1}${$(form).attr('id') ? ` #${$(form).attr('id')}` : ''}:`);

    $(form).find('input:not([type="hidden"]), select, textarea').each((_, field) => {
      const tag = field.tagName.toLowerCase();
      const type = $(field).attr('type') ?? tag;
      const name = $(field).attr('name') ?? $(field).attr('id') ?? '';
      const placeholder = $(field).attr('placeholder') ?? '';
      const forId = $(field).attr('id') ?? '';
      const labelText = $(`label[for="${forId}"]`).text().trim()
        || $(field).closest('label').text().trim()
        || $(field).prev('label').text().trim();
      const desc = labelText || placeholder || name || '(unlabelled)';
      lines.push(`  - ${type} field: ${desc}`);
    });

    $(form).find('button, input[type="submit"], input[type="button"]').each((_, btn) => {
      const text = $(btn).text().trim() || String($(btn).attr('value') ?? 'Submit');
      lines.push(`  - button: ${text}`);
    });
  });

  // Standalone buttons outside forms
  $('button, [role="button"]').not('form button').each((_, btn) => {
    const text = $(btn).text().trim().slice(0, 60);
    if (text) lines.push(`Button: ${text}`);
  });

  // Navigation links
  const navLinks: string[] = [];
  $('nav a, [role="navigation"] a, header a').each((_, a) => {
    const text = $(a).text().trim().slice(0, 40);
    if (text) navLinks.push(text);
  });
  if (navLinks.length) lines.push(`\nNavigation: ${navLinks.slice(0, 20).join(' | ')}`);

  // Error / validation messages visible on the page
  $('[class*="error"], [class*="alert"], [class*="validation"], [role="alert"]').each((_, el) => {
    const text = $(el).text().trim().slice(0, 100);
    if (text) lines.push(`Visible message: ${text}`);
  });

  return lines.join('\n') || '(No interactive elements detected)';
}

export async function readReferenceTCs(projectId: string, ids: string[]): Promise<string> {
  // Accept either internal CUID (id) or human-readable tcId (e.g. "TC-042")
  const tcs = await prisma.testCase.findMany({
    where: { projectId, OR: [{ id: { in: ids } }, { tcId: { in: ids } }] },
    take: 50,
    orderBy: { createdAt: 'asc' },
  });

  if (!tcs.length) return '';

  return tcs
    .map((tc) => {
      const steps = JSON.parse(tc.steps || '[]') as string[];
      return [
        `TC-ID: ${tc.tcId}`,
        `Title: ${tc.title}`,
        `Type: ${tc.type}`,
        `UseCase: ${tc.useCaseTag ?? 'N/A'}`,
        `Steps:\n${steps.map((s, i) => `  ${i + 1}. ${s}`).join('\n')}`,
        `Expected: ${tc.expectedResult}`,
      ].join('\n');
    })
    .join('\n\n---\n\n');
}

export function parseOpenApiSpec(rawContent: string): string {
  let spec: Record<string, unknown>;
  try {
    spec = JSON.parse(rawContent) as Record<string, unknown>;
  } catch {
    // YAML or unparseable — return raw content (LLM can read YAML)
    return rawContent.slice(0, 8000);
  }

  const info = spec['info'] as Record<string, unknown> | undefined;
  const lines: string[] = [
    `API SPEC: ${info?.['title'] ?? 'Unknown API'} v${info?.['version'] ?? '?'}`,
  ];
  if (info?.['description']) {
    lines.push(`DESCRIPTION: ${String(info['description']).slice(0, 300)}`);
  }
  const servers = spec['servers'] as Array<{ url?: string }> | undefined;
  if (servers?.[0]?.url) lines.push(`BASE URL: ${servers[0].url}`);
  lines.push('');

  const paths = (spec['paths'] ?? {}) as Record<string, Record<string, unknown>>;
  for (const [pathStr, methods] of Object.entries(paths)) {
    for (const [method, opRaw] of Object.entries(methods)) {
      if (!['get', 'post', 'put', 'patch', 'delete', 'head'].includes(method)) continue;
      const op = opRaw as Record<string, unknown>;
      lines.push(`ENDPOINT: ${method.toUpperCase()} ${pathStr}`);
      if (op['summary']) lines.push(`  SUMMARY: ${op['summary']}`);
      if (op['description']) lines.push(`  PURPOSE: ${String(op['description']).slice(0, 200)}`);

      // Query/path parameters
      const params = (op['parameters'] as Array<Record<string, unknown>> | undefined) ?? [];
      const reqParams = params.filter(p => p['required']);
      if (reqParams.length) lines.push(`  REQUIRED PARAMS: ${reqParams.map(p => `${p['name']} (${p['in']})`).join(', ')}`);
      const optParams = params.filter(p => !p['required']);
      if (optParams.length) lines.push(`  OPTIONAL PARAMS: ${optParams.slice(0, 8).map(p => String(p['name'])).join(', ')}`);

      // Request body
      const rb = op['requestBody'] as Record<string, unknown> | undefined;
      if (rb) {
        const content = (rb['content'] as Record<string, unknown> | undefined) ?? {};
        const schema = ((content['application/json'] as Record<string, unknown> | undefined)?.['schema'] as Record<string, unknown> | undefined);
        if (schema) {
          const required = (schema['required'] as string[] | undefined) ?? [];
          const props = Object.keys((schema['properties'] as Record<string, unknown> | undefined) ?? {});
          if (required.length) lines.push(`  REQUIRED BODY FIELDS: ${required.join(', ')}`);
          if (props.length) lines.push(`  ALL BODY FIELDS: ${props.join(', ')}`);
        }
      }

      // Responses
      const responses = (op['responses'] as Record<string, unknown> | undefined) ?? {};
      const codes = Object.keys(responses);
      if (codes.length) lines.push(`  RESPONSES: ${codes.join(', ')}`);

      lines.push('');
    }
  }

  return lines.join('\n').slice(0, 8000);
}

export function parsePostmanCollection(rawContent: string): string {
  let col: Record<string, unknown>;
  try {
    col = JSON.parse(rawContent) as Record<string, unknown>;
  } catch {
    return rawContent.slice(0, 8000);
  }

  const info = (col['info'] as Record<string, unknown> | undefined);
  const name = String(info?.['name'] ?? col['name'] ?? 'Postman Collection');
  const lines: string[] = [`POSTMAN COLLECTION: ${name}`, ''];

  function extractItems(items: unknown[], depth: number) {
    for (const raw of items ?? []) {
      const item = raw as Record<string, unknown>;
      if (item['item']) {
        lines.push(`${'  '.repeat(depth)}FOLDER: ${item['name']}`);
        extractItems(item['item'] as unknown[], depth + 1);
        continue;
      }
      const req = item['request'] as Record<string, unknown> | undefined;
      if (!req) continue;
      const method = String(req['method'] ?? 'GET').toUpperCase();
      const urlRaw = req['url'];
      const url = typeof urlRaw === 'string' ? urlRaw : String((urlRaw as Record<string, unknown> | undefined)?.['raw'] ?? '');
      lines.push(`${'  '.repeat(depth)}${method} ${url}`);
      if (item['name']) lines.push(`${'  '.repeat(depth)}  NAME: ${item['name']}`);

      // Auth header
      const headers = (req['header'] as Array<Record<string, unknown>> | undefined) ?? [];
      const auth = headers.find(h => String(h['key'] ?? '').toLowerCase() === 'authorization');
      if (auth) lines.push(`${'  '.repeat(depth)}  AUTH: ${String(auth['value']).slice(0, 60)}`);

      // Body
      const body = req['body'] as Record<string, unknown> | undefined;
      if (body?.['raw']) {
        try {
          const parsed = JSON.parse(String(body['raw'])) as Record<string, unknown>;
          lines.push(`${'  '.repeat(depth)}  BODY FIELDS: ${Object.keys(parsed).join(', ')}`);
          lines.push(`${'  '.repeat(depth)}  SAMPLE: ${JSON.stringify(parsed).slice(0, 300)}`);
        } catch {
          lines.push(`${'  '.repeat(depth)}  BODY: ${String(body['raw']).slice(0, 200)}`);
        }
      }

      // Test script assertions
      const events = (item['event'] as Array<Record<string, unknown>> | undefined) ?? [];
      const testEv = events.find(e => e['listen'] === 'test');
      const scriptLines: string[] = [];
      const execRaw = (testEv?.['script'] as Record<string, unknown> | undefined)?.['exec'];
      const exec = Array.isArray(execRaw) ? execRaw.join('\n') : String(execRaw ?? '');
      exec.split('\n').filter(l => l.includes('pm.response') || l.includes('pm.expect')).slice(0, 4)
        .forEach(l => scriptLines.push(l.trim()));
      if (scriptLines.length) lines.push(`${'  '.repeat(depth)}  ASSERTIONS: ${scriptLines.join(' | ')}`);
      lines.push('');
    }
  }

  extractItems((col['item'] as unknown[]) ?? [], 0);
  return lines.join('\n').slice(0, 8000);
}

export function parseCurlCommands(input: string): string {
  const commands = input
    .split(/(?=\bcurl\b)/i)
    .map(c => c.trim())
    .filter(c => /^curl\b/i.test(c));

  if (!commands.length) return input.slice(0, 4000);

  const lines: string[] = [`CURL COMMANDS: ${commands.length} request(s)`, ''];

  for (const cmd of commands.slice(0, 20)) {
    const methodMatch = cmd.match(/-X\s+([A-Z]+)/i);
    const hasData = /-d\s|--data/.test(cmd);
    const method = methodMatch ? methodMatch[1].toUpperCase() : (hasData ? 'POST' : 'GET');

    const urlMatch = cmd.match(/https?:\/\/[^\s'"\\]+/);
    const url = urlMatch ? urlMatch[0] : '';

    if (url) lines.push(`${method} ${url}`);

    // Headers
    for (const hm of cmd.matchAll(/-H\s+['"]([^'"]+)['"]/gi)) {
      lines.push(`  HEADER: ${hm[1]}`);
    }

    // Body
    const dataMatch = cmd.match(/(?:--data-raw|--data-binary|--data|-d)\s+['"]([^'"]+)['"]/is);
    if (dataMatch) {
      try {
        const parsed = JSON.parse(dataMatch[1]) as Record<string, unknown>;
        lines.push(`  BODY FIELDS: ${Object.keys(parsed).join(', ')}`);
        lines.push(`  SAMPLE BODY: ${JSON.stringify(parsed).slice(0, 400)}`);
      } catch {
        lines.push(`  BODY: ${dataMatch[1].slice(0, 300)}`);
      }
    }

    // Basic auth
    const authMatch = cmd.match(/-u\s+['"]?([^'":\s]+):[^'"\s]*/);
    if (authMatch) lines.push(`  BASIC AUTH: ${authMatch[1]}:***`);

    lines.push('');
  }

  return lines.join('\n');
}
