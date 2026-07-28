// @ts-ignore — js-yaml has no bundled types and @types/js-yaml isn't installed
import yaml from 'js-yaml';

export interface ParsedApiEndpoint {
  name: string;
  method: string;
  endpoint: string;
  purpose: string;
  requestSchema: unknown;
  responses: Record<string, unknown>;
  authRequired: boolean;
  notes: string;
}

export type ApiSpecFormat = 'openapi' | 'postman' | 'curl' | 'unknown';

export interface ApiSpecParseResult {
  format: ApiSpecFormat;
  endpoints: ParsedApiEndpoint[];
}

// ── curl ─────────────────────────────────────────────────────────────────

function tokenizeShellLike(input: string): string[] {
  const tokens: string[] = [];
  let current = '';
  let quote: '"' | "'" | null = null;
  const normalized = input.replace(/\\\r?\n/g, ' ').trim();

  for (let i = 0; i < normalized.length; i++) {
    const ch = normalized[i];
    if (quote) {
      if (ch === quote) {
        quote = null;
      } else {
        current += ch;
      }
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (/\s/.test(ch)) {
      if (current) {
        tokens.push(current);
        current = '';
      }
      continue;
    }
    current += ch;
  }
  if (current) tokens.push(current);
  return tokens;
}

export function parseCurl(curlCmd: string): ParsedApiEndpoint {
  const tokens = tokenizeShellLike(curlCmd).filter((t) => t.toLowerCase() !== 'curl');

  let method: string | null = null;
  let url = '';
  const headers: string[] = [];
  const bodyParts: string[] = [];
  let authRequired = false;

  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t === '-X' || t === '--request') {
      method = tokens[++i] ?? method;
    } else if (t === '-H' || t === '--header') {
      const h = tokens[++i] ?? '';
      headers.push(h);
      if (/^authorization\s*:/i.test(h)) authRequired = true;
    } else if (t === '-d' || t === '--data' || t === '--data-raw' || t === '--data-binary' || t === '--data-ascii') {
      bodyParts.push(tokens[++i] ?? '');
    } else if (t === '--data-urlencode') {
      bodyParts.push(tokens[++i] ?? '');
    } else if (t === '-u' || t === '--user') {
      i++;
      authRequired = true;
    } else if (t === '--url') {
      url = tokens[++i] ?? url;
    } else if (t.startsWith('-')) {
      // Unrecognized flag — skip its likely value if the next token isn't itself a flag/URL
      continue;
    } else if (!url && /^https?:\/\//i.test(t)) {
      url = t;
    } else if (!url) {
      url = t;
    }
  }

  if (!method) method = bodyParts.length > 0 ? 'POST' : 'GET';

  const rawBody = bodyParts.join('&');
  let requestSchema: unknown = {};
  if (rawBody) {
    try {
      requestSchema = JSON.parse(rawBody);
    } catch {
      requestSchema = { raw: rawBody };
    }
  }

  return {
    name: `${method} ${url}`,
    method: method.toUpperCase(),
    endpoint: url,
    purpose: 'Imported from curl command',
    requestSchema,
    responses: { '200': {} },
    authRequired,
    notes: headers.length > 0 ? `Headers: ${headers.join('; ')}` : '',
  };
}

// ── OpenAPI / Swagger ────────────────────────────────────────────────────

const HTTP_METHODS = ['get', 'post', 'put', 'patch', 'delete', 'options', 'head'];

function isOpenApiDoc(doc: unknown): doc is Record<string, unknown> {
  if (!doc || typeof doc !== 'object') return false;
  const d = doc as Record<string, unknown>;
  return (typeof d.openapi === 'string' || typeof d.swagger === 'string') && typeof d.paths === 'object';
}

function extractOpenApiRequestSchema(op: Record<string, unknown>): unknown {
  const requestBody = op.requestBody as Record<string, unknown> | undefined;
  if (requestBody?.content) {
    const content = requestBody.content as Record<string, unknown>;
    const jsonContent = (content['application/json'] ?? Object.values(content)[0]) as Record<string, unknown> | undefined;
    if (jsonContent?.schema) return jsonContent.schema;
  }
  // Swagger 2.0 — body/form parameters
  const params = op.parameters as Array<Record<string, unknown>> | undefined;
  if (Array.isArray(params)) {
    const bodyParam = params.find((p) => p.in === 'body');
    if (bodyParam?.schema) return bodyParam.schema;
    const formParams = params.filter((p) => p.in === 'formData' || p.in === 'query' || p.in === 'path');
    if (formParams.length > 0) {
      return Object.fromEntries(formParams.map((p) => [String(p.name), p.type ?? 'string']));
    }
  }
  return {};
}

function extractOpenApiResponses(op: Record<string, unknown>): Record<string, unknown> {
  const responses = op.responses as Record<string, unknown> | undefined;
  if (!responses) return { '200': {} };
  return Object.fromEntries(
    Object.entries(responses).map(([code, resp]) => [
      code,
      { description: (resp as Record<string, unknown>)?.description ?? '' },
    ]),
  );
}

export function parseOpenApi(doc: Record<string, unknown>): ParsedApiEndpoint[] {
  const paths = doc.paths as Record<string, Record<string, unknown>>;
  const docSecurity = Array.isArray(doc.security) && (doc.security as unknown[]).length > 0;
  const endpoints: ParsedApiEndpoint[] = [];

  for (const [pathKey, pathItem] of Object.entries(paths ?? {})) {
    for (const method of HTTP_METHODS) {
      const op = pathItem[method] as Record<string, unknown> | undefined;
      if (!op) continue;

      const opSecurity = Array.isArray(op.security) ? (op.security as unknown[]).length > 0 : docSecurity;
      const tags = Array.isArray(op.tags) ? (op.tags as string[]).join(', ') : '';

      endpoints.push({
        name: `${method.toUpperCase()} ${pathKey}`,
        method: method.toUpperCase(),
        endpoint: pathKey,
        purpose: String(op.summary ?? op.description ?? `${method.toUpperCase()} ${pathKey}`),
        requestSchema: extractOpenApiRequestSchema(op),
        responses: extractOpenApiResponses(op),
        authRequired: opSecurity,
        notes: tags ? `Tags: ${tags}` : '',
      });
    }
  }

  return endpoints;
}

// ── Postman collection ───────────────────────────────────────────────────

interface PostmanUrl {
  raw?: string;
  host?: string[] | string;
  path?: string[] | string;
}

function postmanUrlToString(url: unknown): string {
  if (typeof url === 'string') return url;
  const u = url as PostmanUrl | undefined;
  if (u?.raw) return u.raw;
  const host = Array.isArray(u?.host) ? u!.host!.join('.') : (u?.host ?? '');
  const path = Array.isArray(u?.path) ? u!.path!.join('/') : (u?.path ?? '');
  return [host, path].filter(Boolean).join('/');
}

function extractPostmanBody(request: Record<string, unknown>): unknown {
  const body = request.body as Record<string, unknown> | undefined;
  if (!body || !body.mode) return {};
  if (body.mode === 'raw' && typeof body.raw === 'string') {
    try {
      return JSON.parse(body.raw);
    } catch {
      return { raw: body.raw };
    }
  }
  if (body.mode === 'urlencoded' || body.mode === 'formdata') {
    const entries = (body[body.mode as string] as Array<Record<string, unknown>>) ?? [];
    return Object.fromEntries(entries.map((e) => [String(e.key), e.value ?? '']));
  }
  return {};
}

function isPostmanCollection(doc: unknown): boolean {
  if (!doc || typeof doc !== 'object') return false;
  const d = doc as Record<string, unknown>;
  const info = d.info as Record<string, unknown> | undefined;
  if (typeof info?.schema === 'string' && info.schema.includes('postman')) return true;
  return Array.isArray(d.item);
}

function flattenPostmanItems(items: unknown[], folderPath: string[]): ParsedApiEndpoint[] {
  const endpoints: ParsedApiEndpoint[] = [];

  for (const raw of items) {
    const item = raw as Record<string, unknown>;
    if (Array.isArray(item.item)) {
      endpoints.push(...flattenPostmanItems(item.item, [...folderPath, String(item.name ?? '')]));
      continue;
    }
    const request = item.request as Record<string, unknown> | undefined;
    if (!request) continue;

    const method = String(request.method ?? 'GET').toUpperCase();
    const url = postmanUrlToString(request.url);
    const headers = (request.header as Array<Record<string, unknown>> | undefined) ?? [];
    const authRequired =
      (request.auth && (request.auth as Record<string, unknown>).type !== 'noauth') ||
      headers.some((h) => String(h.key ?? '').toLowerCase() === 'authorization');

    const breadcrumb = [...folderPath, String(item.name ?? '')].filter(Boolean).join(' / ');
    const responses = item.response as Array<Record<string, unknown>> | undefined;
    const responsesSummary: Record<string, unknown> = {};
    if (Array.isArray(responses) && responses.length > 0) {
      for (const r of responses) {
        const code = String(r.code ?? '200');
        responsesSummary[code] = { description: r.name ?? '' };
      }
    } else {
      responsesSummary['200'] = {};
    }

    endpoints.push({
      name: breadcrumb || `${method} ${url}`,
      method,
      endpoint: url,
      purpose: String(item.name ?? `${method} ${url}`),
      requestSchema: extractPostmanBody(request),
      responses: responsesSummary,
      authRequired: Boolean(authRequired),
      notes: folderPath.length > 0 ? `Folder: ${folderPath.join(' / ')}` : '',
    });
  }

  return endpoints;
}

export function parsePostmanCollection(doc: Record<string, unknown>): ParsedApiEndpoint[] {
  const items = (doc.item as unknown[]) ?? [];
  return flattenPostmanItems(items, []);
}

// ── Unified detection ────────────────────────────────────────────────────

export function detectAndParseApiSpec(rawText: string): ApiSpecParseResult {
  const text = rawText.trim();
  if (!text) return { format: 'unknown', endpoints: [] };

  if (/^curl\s/i.test(text)) {
    return { format: 'curl', endpoints: [parseCurl(text)] };
  }

  let doc: unknown = null;
  try {
    doc = JSON.parse(text);
  } catch {
    try {
      doc = yaml.load(text);
    } catch {
      doc = null;
    }
  }

  if (isOpenApiDoc(doc)) {
    return { format: 'openapi', endpoints: parseOpenApi(doc as Record<string, unknown>) };
  }
  if (isPostmanCollection(doc)) {
    return { format: 'postman', endpoints: parsePostmanCollection(doc as Record<string, unknown>) };
  }

  return { format: 'unknown', endpoints: [] };
}
