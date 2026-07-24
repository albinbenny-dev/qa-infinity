import fs from 'fs';
import path from 'path';
import JSZip from 'jszip';

const SCRIPTS_ROOT = process.env.SCRIPTS_ROOT ?? '/scripts';

// Folder used for scripts that have no use-case tag assigned
const UNCATEGORIZED = '_uncategorized';

function sanitizeFolderName(name: string | null | undefined): string {
  if (!name?.trim()) return UNCATEGORIZED;
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || UNCATEGORIZED;
}

function projectDir(slug: string): string {
  return path.join(SCRIPTS_ROOT, slug, 'scripts');
}

function pagesDir(slug: string): string {
  return path.join(SCRIPTS_ROOT, slug, 'scripts', 'pages');
}

function ensureDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
}

// ── Script file helpers ───────────────────────────────────────────────────

export function saveScript(slug: string, filename: string, content: string, useCase?: string | null): void {
  const dir = useCase ? path.join(projectDir(slug), sanitizeFolderName(useCase)) : projectDir(slug);
  ensureDir(dir);
  fs.writeFileSync(path.join(dir, filename), content, 'utf-8');
}

export function savePOM(slug: string, filename: string, content: string): void {
  ensureDir(pagesDir(slug));
  fs.writeFileSync(path.join(pagesDir(slug), filename), content, 'utf-8');
}

export function readScript(slug: string, filename: string, useCase?: string | null): string {
  if (useCase) {
    const ucPath = path.join(projectDir(slug), sanitizeFolderName(useCase), filename);
    if (fs.existsSync(ucPath)) return fs.readFileSync(ucPath, 'utf-8');
  }
  const found = findScriptPath(slug, filename);
  if (found) return fs.readFileSync(found, 'utf-8');
  throw new Error(`Script file not found: ${filename}`);
}

export function deleteScript(slug: string, filename: string, useCase?: string | null): void {
  if (useCase) {
    const ucPath = path.join(projectDir(slug), sanitizeFolderName(useCase), filename);
    if (fs.existsSync(ucPath)) { fs.unlinkSync(ucPath); return; }
  }
  const found = findScriptPath(slug, filename);
  if (found) fs.unlinkSync(found);
}

export interface ScriptFileMeta {
  filename: string;
  size: number;
  modifiedAt: string;
  useCaseFolder?: string;
}

export function listScriptFiles(slug: string): ScriptFileMeta[] {
  const base = projectDir(slug);
  if (!fs.existsSync(base)) return [];
  const results: ScriptFileMeta[] = [];
  function scan(dir: string, useCaseFolder?: string): void {
    for (const f of fs.readdirSync(dir)) {
      const abs = path.join(dir, f);
      const stat = fs.statSync(abs);
      if (stat.isDirectory()) {
        if (f !== 'pages') scan(abs, f);
      } else if (f.endsWith('.spec.ts') || f.endsWith('.spec.js') || f.endsWith('.robot')) {
        results.push({ filename: f, size: stat.size, modifiedAt: stat.mtime.toISOString(), useCaseFolder });
      }
    }
  }
  scan(base);
  return results;
}

export function listPOMFiles(slug: string): string[] {
  const dir = pagesDir(slug);
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => fs.statSync(path.join(dir, f)).isFile() && f.endsWith('.ts'));
}

// Search flat base dir + all immediate use-case subfolders for a script file.
// Returns the absolute path if found, null otherwise.
export function findScriptPath(slug: string, filename: string): string | null {
  const base = projectDir(slug);
  if (!fs.existsSync(base)) return null;
  // Check flat path first (legacy / uncategorized scripts placed directly in base)
  const flat = path.join(base, filename);
  if (fs.existsSync(flat)) return flat;
  // Check immediate subdirectories (use-case folders)
  for (const entry of fs.readdirSync(base)) {
    if (entry === 'pages') continue;
    const abs = path.join(base, entry);
    if (!fs.statSync(abs).isDirectory()) continue;
    const candidate = path.join(abs, filename);
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

export function getScriptFileMeta(slug: string, filename: string): ScriptFileMeta | null {
  const found = findScriptPath(slug, filename);
  if (!found) return null;
  const stat = fs.statSync(found);
  const rel = path.relative(projectDir(slug), path.dirname(found));
  return { filename, size: stat.size, modifiedAt: stat.mtime.toISOString(), useCaseFolder: rel || undefined };
}

export async function exportZip(slug: string, filenames?: string[]): Promise<Buffer> {
  const zip = new JSZip();
  const base = projectDir(slug);
  const pages = pagesDir(slug);
  const res = resourcesDir(slug);

  // Recursively add script files, preserving use-case subfolders in the zip
  if (fs.existsSync(base)) {
    function addScripts(dir: string, prefix: string): void {
      for (const f of fs.readdirSync(dir)) {
        const abs = path.join(dir, f);
        const stat = fs.statSync(abs);
        if (stat.isDirectory() && f !== 'pages') {
          addScripts(abs, `${prefix}${f}/`);
        } else if (stat.isFile()) {
          if (!(f.endsWith('.spec.ts') || f.endsWith('.spec.js') || f.endsWith('.robot'))) continue;
          if (filenames && !filenames.includes(f)) continue;
          zip.file(`${prefix}${f}`, fs.readFileSync(abs));
        }
      }
    }
    addScripts(base, '');
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
  const filePath = path.join(resourcesDir(projectId), filename);
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, buffer);
}

export function deleteResourceFile(projectId: string, filename: string): void {
  const filePath = path.join(resourcesDir(projectId), filename);
  if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
}

export const BINARY_EXTS = new Set(['.xlsx', '.xls', '.pdf', '.pyc', '.png', '.jpg', '.jpeg', '.gif', '.zip', '.tar', '.gz']);
const SKIP_DIRS = new Set(['__pycache__', '.git', 'node_modules', 'venv', '.venv']);

export function listResourceFiles(identifier: string): { filename: string; size: number; isBinary: boolean }[] {
  const dir = resourcesDir(identifier);
  if (!fs.existsSync(dir)) return [];

  function scan(current: string, prefix: string): { filename: string; size: number; isBinary: boolean }[] {
    return fs.readdirSync(current).flatMap((entry) => {
      const full = path.join(current, entry);
      const stat = fs.statSync(full);
      const rel = prefix ? `${prefix}/${entry}` : entry;
      if (stat.isDirectory()) {
        if (SKIP_DIRS.has(entry)) return [];
        return scan(full, rel);
      }
      const isBinary = BINARY_EXTS.has(path.extname(entry).toLowerCase());
      return [{ filename: rel, size: stat.size, isBinary }];
    });
  }

  return scan(dir, '');
}

export function readResourceFile(projectId: string, filename: string): string {
  const filePath = path.join(resourcesDir(projectId), filename);
  if (!fs.existsSync(filePath)) throw new Error(`Resource file not found: ${filename}`);
  return fs.readFileSync(filePath, 'utf-8');
}

// ── Disk import helper ─────────────────────────────────────────────────────
// Scans the project's scripts directory tree and returns metadata for every
// script found, so the caller can sync them into the database.

export interface DiskScriptMeta {
  filename: string;
  useCaseFolder: string;
  content: string;
  size: number;
  modifiedAt: string;
}

export function importFromDisk(slug: string): DiskScriptMeta[] {
  const base = projectDir(slug);
  if (!fs.existsSync(base)) return [];
  const results: DiskScriptMeta[] = [];
  function scan(dir: string, folder: string): void {
    for (const f of fs.readdirSync(dir)) {
      const abs = path.join(dir, f);
      const stat = fs.statSync(abs);
      if (stat.isDirectory() && f !== 'pages') {
        scan(abs, f);
      } else if (stat.isFile() && (f.endsWith('.spec.ts') || f.endsWith('.spec.js') || f.endsWith('.robot'))) {
        results.push({
          filename: f,
          useCaseFolder: folder,
          content: fs.readFileSync(abs, 'utf-8'),
          size: stat.size,
          modifiedAt: stat.mtime.toISOString(),
        });
      }
    }
  }
  scan(base, UNCATEGORIZED);
  return results;
}

export interface RFKeywordLocation {
  name: string;
  line: number; // 1-based
}

/**
 * Rewrites relative Variables / Resource / Library paths in a .robot file to absolute
 * container paths (/scripts/{slug}/resources/...) when the referenced file exists in
 * the project's resources directory. Only operates within the *** Settings *** section.
 */
export function rewriteRobotResourcePaths(
  content: string,
  slug: string,
): { content: string; rewrites: string[] } {
  const resDir = resourcesDir(slug);
  const projectRoot = path.join(SCRIPTS_ROOT, slug);
  const rewrites: string[] = [];

  // Matches RF settings directives: indent + keyword + separator (2+ spaces or tab) + first token + rest
  const DIRECTIVE_RE = /^(\s*)(Variables|Resource|Library|Resource\s+File)(\s{2,}|\t+)(\S+)(.*)/i;

  let inSettings = false;

  const result = content.split('\n').map((line) => {
    const trimmed = line.trim();

    // Track which section we're in
    if (/^\*{3}/.test(trimmed)) {
      inSettings = /\*{3}\s*Settings\s*\*{3}/i.test(trimmed);
      return line;
    }
    if (!inSettings || trimmed === '' || trimmed.startsWith('#')) return line;

    const m = line.match(DIRECTIVE_RE);
    if (!m) return line;

    const [, indent, directive, sep, pathToken, rest] = m;

    // Already an absolute /scripts/ path — leave it alone
    if (pathToken.startsWith('/scripts/')) return line;

    // Library without a file extension and no path separator is a Python module name — skip
    const hasPathSep = pathToken.includes('/') || pathToken.includes('\\');
    const hasFileExt = /\.(py|robot|resource|txt)$/i.test(pathToken);
    if (!hasFileExt && !hasPathSep) return line;

    // Normalise separators, strip leading ../ and ./
    let rel = pathToken.replace(/\\/g, '/');
    while (rel.startsWith('../')) rel = rel.slice(3);
    while (rel.startsWith('./')) rel = rel.slice(2);

    // Strip a leading resources/ folder name (case-insensitive) since we know where it lives
    const relUnderRes = rel.replace(/^[Rr]esources?\//, '');

    // Try candidates in order of specificity
    const candidates: [string, string][] = [
      [path.join(resDir, relUnderRes), relUnderRes],          // under resources/, sans prefix
      [path.join(projectRoot, rel), rel],                     // from project root as-is
      [path.join(resDir, path.basename(pathToken)), path.basename(pathToken)], // bare filename
    ];

    let found: string | null = null;
    for (const [absCandidate, relCandidate] of candidates) {
      if (fs.existsSync(absCandidate)) {
        found = relCandidate;
        break;
      }
    }

    if (!found) return line;

    const absPath = `/scripts/${slug}/resources/${found}`;
    rewrites.push(`${pathToken} → ${absPath}`);
    return `${indent}${directive}${sep}${absPath}${rest}`;
  });

  return { content: result.join('\n'), rewrites };
}

// ── Skill file helpers ─────────────────────────────────────────────────────

function skillsDir(slug: string): string {
  return path.join(SCRIPTS_ROOT, slug, 'skills');
}

function sanitizeSkillName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
}

export interface SkillFileData {
  id: string;
  skillType: string;
  name: string;
  scope: string | null;
  featureGroup?: string | null;
  tier?: string | null;         // "GLOBAL" | "FEATURE" | "HISTORICAL"
  humanContext?: string | null; // plain-text QA correction or annotation
  content: string;
  confidence: number;
  captureMethod: string;
  isActive: boolean;
  updatedAt: string;
}

export function saveSkillFile(slug: string, skillId: string, data: SkillFileData): void {
  ensureDir(skillsDir(slug));
  // Remove any stale file for this skillId (name may have changed)
  deleteSkillFile(slug, skillId);
  const filename = `${skillId}-${sanitizeSkillName(data.name)}.json`;
  fs.writeFileSync(path.join(skillsDir(slug), filename), JSON.stringify(data, null, 2), 'utf-8');
}

export function deleteSkillFile(slug: string, skillId: string): void {
  const dir = skillsDir(slug);
  if (!fs.existsSync(dir)) return;
  for (const f of fs.readdirSync(dir)) {
    if (f.startsWith(`${skillId}-`) && f.endsWith('.json')) {
      try { fs.unlinkSync(path.join(dir, f)); } catch { /* ignore */ }
    }
  }
}

export function listSkillFiles(slug: string): string[] {
  const dir = skillsDir(slug);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter(f => f.endsWith('.json'));
}

export function readSkillFile(slug: string, filename: string): SkillFileData {
  const filePath = path.join(skillsDir(slug), filename);
  return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as SkillFileData;
}

/** Extracts Robot Framework keyword names with their 1-based line numbers from file content. */
export function extractRobotKeywordsWithLines(content: string): RFKeywordLocation[] {
  const results: RFKeywordLocation[] = [];
  let inKeywords = false;
  const lines = content.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    if (trimmed.startsWith('*** Keywords ***')) { inKeywords = true; continue; }
    if (trimmed.startsWith('***')) { inKeywords = false; continue; }
    if (inKeywords && line.length > 0 && line[0] !== ' ' && line[0] !== '\t' && trimmed.length > 0 && !trimmed.startsWith('#')) {
      results.push({ name: trimmed, line: i + 1 });
    }
  }
  return results;
}
