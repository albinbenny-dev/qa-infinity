import fs from 'fs';
import path from 'path';
import JSZip from 'jszip';

const SCRIPTS_ROOT = process.env.SCRIPTS_ROOT ?? '/scripts';

function projectDir(projectId: string): string {
  return path.join(SCRIPTS_ROOT, projectId);
}

function pagesDir(projectId: string): string {
  return path.join(SCRIPTS_ROOT, projectId, 'pages');
}

function ensureDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
}

export function saveScript(projectId: string, filename: string, content: string): void {
  ensureDir(projectDir(projectId));
  fs.writeFileSync(path.join(projectDir(projectId), filename), content, 'utf-8');
}

export function savePOM(projectId: string, filename: string, content: string): void {
  ensureDir(pagesDir(projectId));
  fs.writeFileSync(path.join(pagesDir(projectId), filename), content, 'utf-8');
}

export function readScript(projectId: string, filename: string): string {
  const filePath = path.join(projectDir(projectId), filename);
  if (!fs.existsSync(filePath)) throw new Error(`Script file not found: ${filename}`);
  return fs.readFileSync(filePath, 'utf-8');
}

export function deleteScript(projectId: string, filename: string): void {
  const filePath = path.join(projectDir(projectId), filename);
  if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
}

export interface ScriptFileMeta {
  filename: string;
  size: number;
  modifiedAt: string;
}

export function listScriptFiles(projectId: string): ScriptFileMeta[] {
  const dir = projectDir(projectId);
  if (!fs.existsSync(dir)) return [];

  return fs
    .readdirSync(dir)
    .filter((f) => {
      const abs = path.join(dir, f);
      return (
        fs.statSync(abs).isFile() &&
        (f.endsWith('.spec.ts') || f.endsWith('.spec.js') || f.endsWith('.robot'))
      );
    })
    .map((f) => {
      const stat = fs.statSync(path.join(dir, f));
      return { filename: f, size: stat.size, modifiedAt: stat.mtime.toISOString() };
    });
}

export function listPOMFiles(projectId: string): string[] {
  const dir = pagesDir(projectId);
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => fs.statSync(path.join(dir, f)).isFile() && f.endsWith('.ts'));
}

export function getScriptFileMeta(projectId: string, filename: string): ScriptFileMeta | null {
  const filePath = path.join(projectDir(projectId), filename);
  if (!fs.existsSync(filePath)) return null;
  const stat = fs.statSync(filePath);
  return { filename, size: stat.size, modifiedAt: stat.mtime.toISOString() };
}

export async function exportZip(projectId: string, filenames?: string[]): Promise<Buffer> {
  const zip = new JSZip();
  const dir = projectDir(projectId);
  const pages = pagesDir(projectId);
  const res = resourcesDir(projectId);

  // Add spec / robot files
  if (fs.existsSync(dir)) {
    const files = fs.readdirSync(dir).filter((f) => {
      const abs = path.join(dir, f);
      if (!fs.statSync(abs).isFile()) return false;
      if (filenames) return filenames.includes(f);
      return f.endsWith('.spec.ts') || f.endsWith('.spec.js') || f.endsWith('.robot');
    });
    for (const f of files) {
      zip.file(f, fs.readFileSync(path.join(dir, f)));
    }
  }

  // Always include the full pages/ folder
  if (fs.existsSync(pages)) {
    for (const f of fs.readdirSync(pages)) {
      const abs = path.join(pages, f);
      if (fs.statSync(abs).isFile()) {
        zip.file(`pages/${f}`, fs.readFileSync(abs));
      }
    }
  }

  // Always include resources/ folder (Robot Framework resource files)
  if (fs.existsSync(res)) {
    for (const f of fs.readdirSync(res)) {
      const abs = path.join(res, f);
      if (fs.statSync(abs).isFile()) {
        zip.file(`resources/${f}`, fs.readFileSync(abs));
      }
    }
  }

  return zip.generateAsync({ type: 'nodebuffer' });
}

// ── Resource file helpers ─────────────────────────────────────────────────

export function resourcesDir(projectId: string): string {
  return path.join(SCRIPTS_ROOT, projectId, 'resources');
}

export function saveResourceFile(projectId: string, filename: string, buffer: Buffer): void {
  ensureDir(resourcesDir(projectId));
  fs.writeFileSync(path.join(resourcesDir(projectId), filename), buffer);
}

export function deleteResourceFile(projectId: string, filename: string): void {
  const filePath = path.join(resourcesDir(projectId), filename);
  if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
}

export function listResourceFiles(projectId: string): { filename: string; size: number }[] {
  const dir = resourcesDir(projectId);
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => fs.statSync(path.join(dir, f)).isFile())
    .map((f) => ({ filename: f, size: fs.statSync(path.join(dir, f)).size }));
}

export function readResourceFile(projectId: string, filename: string): string {
  const filePath = path.join(resourcesDir(projectId), filename);
  if (!fs.existsSync(filePath)) throw new Error(`Resource file not found: ${filename}`);
  return fs.readFileSync(filePath, 'utf-8');
}
