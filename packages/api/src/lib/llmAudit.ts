import fs from 'fs';
import path from 'path';

const AUDIT_FILE = process.env.LLM_AUDIT_LOG ?? '/data/llm-audit.jsonl';

function extractSystemText(system: unknown): string {
  if (typeof system === 'string') return system;
  if (Array.isArray(system)) {
    return system
      .filter((b): b is { type: string; text: string } => b && b.type === 'text')
      .map((b) => b.text)
      .join('\n---\n');
  }
  return '';
}

export interface AuditEntry {
  agent: string;
  model: string;
  projectId?: string | null;
  projectName?: string | null;
  promptTokens: number;
  completionTokens: number;
  durationMs: number;
  system?: unknown;
  user?: string;
  response?: string;
}

export function appendAuditLog(entry: AuditEntry): void {
  try {
    const dir = path.dirname(AUDIT_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    const line = JSON.stringify({
      ts: new Date().toISOString(),
      agent: entry.agent,
      model: entry.model,
      projectId: entry.projectId ?? null,
      projectName: entry.projectName ?? null,
      promptTokens: entry.promptTokens,
      completionTokens: entry.completionTokens,
      durationMs: entry.durationMs,
      system: extractSystemText(entry.system) || null,
      user: entry.user || null,
      response: entry.response || null,
    });

    fs.appendFileSync(AUDIT_FILE, line + '\n', 'utf8');
  } catch {
    // never crash the main flow over audit logging
  }
}
