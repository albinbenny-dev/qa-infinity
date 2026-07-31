import fs from 'fs';
import path from 'path';
import JSZip from 'jszip';

const SCRIPTS_ROOT = process.env.SCRIPTS_ROOT ?? '/scripts';

// "results" holds execution artifacts (screenshots, logs, run history) that grow
// unbounded over time and aren't part of the project's source — excluding it keeps
// the file tree / search / zip walks from re-scanning that growth on every request.
const SKIP_DIRS = new Set(['__pycache__', '.git', 'node_modules', 'venv', '.venv', 'log', 'logs', 'rerun_results', 'results', 'skills']);
const SKIP_EXTS = new Set(['.html', '.xml', '.pyc', '.pyo', '.log']);
const SKIP_NAMES = new Set(['output.xml', 'log.html', 'report.html', 'rerun.xml']);
export const BINARY_EXTS = new Set(['.xlsx', '.xls', '.pdf', '.pyc', '.png', '.jpg', '.jpeg', '.gif', '.zip', '.tar', '.gz']);

// ── Project root ──────────────────────────────────────────────────────────────
// Layout: {SCRIPTS_ROOT}/{slug}/TestCases/{UseCase}/TC01_name.robot
//                               Resource/{subdir}/keyword.robot
//                               resources/{datafile.xlsx}     (legacy binary resources)
//                               scripts/{filename}            (legacy flat scripts)

export function projectRoot(slug: string): string {
  return path.join(SCRIPTS_ROOT, slug);
}

// Kept as alias for call-sites that still use projectDir
function projectDir(slug: string): string {
  return projectRoot(slug);
}

function ensureDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
}

// ── Script save / read / delete ───────────────────────────────────────────────

export function saveScript(slug: string, filename: string, content: string, useCase?: string | null): void {
  const root = projectRoot(slug);
  // If filename already encodes the full relative path (contains /), write directly
  if (filename.includes('/') || filename.includes('\\')) {
    const abs = path.join(root, filename);
    ensureDir(path.dirname(abs));
    fs.writeFileSync(abs, content, 'utf-8');
    return;
  }
  // Bare filename → TestCases/{useCase}/
  const folder = useCase?.trim() || 'Uncategorised';
  const dir = path.join(root, 'TestCases', folder);
  ensureDir(dir);
  fs.writeFileSync(path.join(dir, filename), content, 'utf-8');
}

export function savePOM(slug: string, filename: string, content: string): void {
  const dir = path.join(projectRoot(slug), 'pages');
  ensureDir(dir);
  fs.writeFileSync(path.join(dir, filename), content, 'utf-8');
}

export function readScript(slug: string, filename: string, useCase?: string | null): string {
  const root = projectRoot(slug);
  // Full relative path
  if (filename.includes('/') || filename.includes('\\')) {
    const abs = path.join(root, filename);
    if (fs.existsSync(abs)) return fs.readFileSync(abs, 'utf-8');
  }
  // Try TestCases/{useCase}/{filename}
  if (useCase?.trim()) {
    const p1 = path.join(root, 'TestCases', useCase.trim(), filename);
    if (fs.existsSync(p1)) return fs.readFileSync(p1, 'utf-8');
  }
  const found = findScriptPath(slug, filename);
  if (found) return fs.readFileSync(found, 'utf-8');
  throw new Error(`Script file not found: ${filename}`);
}

export function deleteScript(slug: string, filename: string, useCase?: string | null): void {
  const root = projectRoot(slug);
  if (filename.includes('/') || filename.includes('\\')) {
    const abs = path.join(root, filename);
    if (fs.existsSync(abs)) { fs.unlinkSync(abs); return; }
  }
  if (useCase?.trim()) {
    const p1 = path.join(root, 'TestCases', useCase.trim(), filename);
    if (fs.existsSync(p1)) { fs.unlinkSync(p1); return; }
  }
  const found = findScriptPath(slug, filename);
  if (found) fs.unlinkSync(found);
}

// ── Path resolution ───────────────────────────────────────────────────────────

export function findScriptPath(slug: string, filename: string): string | null {
  const root = projectRoot(slug);
  if (!fs.existsSync(root)) return null;
  // Full relative path with separator
  if (filename.includes('/') || filename.includes('\\')) {
    const norm = filename.replace(/\\/g, '/');
    const abs = path.join(root, norm);
    if (fs.existsSync(abs)) return abs;
  }
  // Search recursively under TestCases/, then legacy scripts/
  const fromTC = searchIn(path.join(root, 'TestCases'), filename);
  if (fromTC) return fromTC;
  const fromScripts = searchIn(path.join(root, 'scripts'), filename);
  if (fromScripts) return fromScripts;
  // Last resort: any direct child
  const flat = path.join(root, filename);
  if (fs.existsSync(flat)) return flat;
  return null;
}

function searchIn(dir: string, filename: string): string | null {
  if (!fs.existsSync(dir)) return null;
  // Flat check
  const direct = path.join(dir, filename);
  if (fs.existsSync(direct)) return direct;
  // One level of subdirs
  for (const entry of fs.readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const abs = path.join(dir, entry);
    if (fs.statSync(abs).isDirectory()) {
      const candidate = path.join(abs, filename);
      if (fs.existsSync(candidate)) return candidate;
    }
  }
  return null;
}

// ── File listing ──────────────────────────────────────────────────────────────

export interface ScriptFileMeta {
  filename: string;
  size: number;
  modifiedAt: string;
  useCaseFolder?: string;
  relPath?: string;
}

export function listScriptFiles(slug: string): ScriptFileMeta[] {
  const root = projectRoot(slug);
  const results: ScriptFileMeta[] = [];
  function walk(dir: string): void {
    if (!fs.existsSync(dir)) return;
    for (const f of fs.readdirSync(dir)) {
      if (SKIP_DIRS.has(f)) continue;
      const abs = path.join(dir, f);
      const stat = fs.statSync(abs);
      if (stat.isDirectory()) walk(abs);
      else if (f.endsWith('.spec.ts') || f.endsWith('.spec.js') || f.endsWith('.robot')) {
        const rel = path.relative(root, abs).replace(/\\/g, '/');
        results.push({ filename: f, size: stat.size, modifiedAt: stat.mtime.toISOString(), relPath: rel });
      }
    }
  }
  walk(root);
  return results;
}

export function getScriptFileMeta(slug: string, filename: string): ScriptFileMeta | null {
  const found = findScriptPath(slug, filename);
  if (!found) return null;
  const stat = fs.statSync(found);
  const rel = path.relative(projectRoot(slug), found).replace(/\\/g, '/');
  return { filename, size: stat.size, modifiedAt: stat.mtime.toISOString(), relPath: rel };
}

export function listPOMFiles(slug: string): string[] {
  const dir = path.join(projectRoot(slug), 'pages');
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter(f => fs.statSync(path.join(dir, f)).isFile() && f.endsWith('.ts'));
}

// ── File tree ─────────────────────────────────────────────────────────────────

export interface FileTreeNode {
  name: string;
  path: string;
  type: 'file' | 'dir';
  ext?: string;
  children?: FileTreeNode[];
}

export function buildFileTree(slug: string): FileTreeNode[] {
  const root = projectRoot(slug);
  if (!fs.existsSync(root)) return [];
  return walkForTree(root, root);
}

function walkForTree(root: string, dir: string): FileTreeNode[] {
  const dirs: FileTreeNode[] = [];
  const files: FileTreeNode[] = [];
  for (const entry of fs.readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const abs = path.join(dir, entry);
    const rel = path.relative(root, abs).replace(/\\/g, '/');
    const ext = path.extname(entry).toLowerCase();
    if (SKIP_NAMES.has(entry) || SKIP_EXTS.has(ext)) continue;
    const stat = fs.statSync(abs);
    if (stat.isDirectory()) {
      dirs.push({ name: entry, path: rel, type: 'dir', children: walkForTree(root, abs) });
    } else {
      files.push({ name: entry, path: rel, type: 'file', ext });
    }
  }
  dirs.sort((a, b) => a.name.localeCompare(b.name));
  files.sort((a, b) => a.name.localeCompare(b.name));
  return [...dirs, ...files];
}

// ── Project-wide text search ────────────────────────────────────────────────

export interface FileSearchMatch {
  relPath: string;
  line: number;
  text: string;
}

export interface FileSearchGroup {
  relPath: string;
  matches: FileSearchMatch[];
}

const SEARCH_MAX_FILE_BYTES = 2 * 1024 * 1024; // skip anything bigger — not a real source file
const SEARCH_MAX_MATCHES = 300;

export function searchProjectFiles(slug: string, query: string): FileSearchGroup[] {
  const root = projectRoot(slug);
  const q = query.trim().toLowerCase();
  if (!q || !fs.existsSync(root)) return [];

  const groups: FileSearchGroup[] = [];
  let total = 0;

  function walk(dir: string): void {
    if (total >= SEARCH_MAX_MATCHES) return;
    for (const entry of fs.readdirSync(dir)) {
      if (total >= SEARCH_MAX_MATCHES) return;
      if (SKIP_DIRS.has(entry) || SKIP_NAMES.has(entry)) continue;
      const abs = path.join(dir, entry);
      const stat = fs.statSync(abs);
      if (stat.isDirectory()) { walk(abs); continue; }

      const ext = path.extname(entry).toLowerCase();
      if (BINARY_EXTS.has(ext) || SKIP_EXTS.has(ext)) continue;
      if (stat.size > SEARCH_MAX_FILE_BYTES) continue;

      let content: string;
      try { content = fs.readFileSync(abs, 'utf-8'); } catch { continue; }

      const lines = content.split('\n');
      const matches: FileSearchMatch[] = [];
      for (let i = 0; i < lines.length && total < SEARCH_MAX_MATCHES; i++) {
        if (lines[i].toLowerCase().includes(q)) {
          matches.push({ relPath: '', line: i + 1, text: lines[i].trim().slice(0, 300) });
          total++;
        }
      }
      if (matches.length > 0) {
        const relPath = path.relative(root, abs).replace(/\\/g, '/');
        groups.push({ relPath, matches: matches.map((m) => ({ ...m, relPath })) });
      }
    }
  }

  walk(root);
  return groups;
}

// ── Zip import ────────────────────────────────────────────────────────────────

export interface ZipImportFile {
  relPath: string;     // e.g. "TestCases/Geo Hierarchy/TC01_Create_Region.robot"
  content: string;
  isTestScript: boolean; // true if under TestCases/ and ends in .robot / .spec.ts
}

export async function importFromZip(slug: string, zipBuffer: Buffer): Promise<{ files: ZipImportFile[]; warnings: string[] }> {
  const root = projectRoot(slug);
  const zip = await JSZip.loadAsync(zipBuffer);
  const warnings: string[] = [];
  const results: ZipImportFile[] = [];

  const allPaths = Object.keys(zip.files).filter(p => !zip.files[p].dir);

  // Detect and strip single top-level wrapper folder
  let stripPrefix = '';
  const topFolders = new Set(allPaths.map(p => p.split('/')[0]));
  if (topFolders.size === 1) {
    const top = [...topFolders][0];
    if (allPaths.every(p => p.startsWith(top + '/'))) {
      stripPrefix = top + '/';
    }
  }

  for (const [zipPath, file] of Object.entries(zip.files)) {
    if (file.dir) continue;
    let relPath = zipPath;
    if (stripPrefix && relPath.startsWith(stripPrefix)) relPath = relPath.slice(stripPrefix.length);
    if (!relPath) continue;

    const parts = relPath.split('/');
    const filename = parts[parts.length - 1];
    if (!filename) continue;

    // Skip noise
    if (SKIP_NAMES.has(filename)) continue;
    const ext = path.extname(filename).toLowerCase();
    if (SKIP_EXTS.has(ext)) continue;
    if (parts.some(p => SKIP_DIRS.has(p))) continue;

    // Normalize: tests/ → TestCases/
    if (/^tests\//i.test(relPath)) {
      relPath = 'TestCases/' + relPath.replace(/^tests\//i, '');
    }

    const absPath = path.join(root, relPath);
    ensureDir(path.dirname(absPath));

    // Binary formats (xlsx, images, pdf, ...) must round-trip as raw bytes —
    // extracting them as a 'string' forces a lossy UTF-8 decode/re-encode that
    // corrupts the file (e.g. an .xlsx's internal zip structure breaks with
    // "Bad offset for central directory" the next time something opens it).
    let content = '';
    if (BINARY_EXTS.has(ext)) {
      const buffer = await file.async('nodebuffer');
      fs.writeFileSync(absPath, buffer);
    } else {
      content = await file.async('string');
      fs.writeFileSync(absPath, content, 'utf-8');
    }

    const isTestScript = /\.(robot|spec\.ts|spec\.js)$/.test(filename) && /^TestCases\//i.test(relPath);
    results.push({ relPath, content, isTestScript });
  }

  return { files: results, warnings };
}

// ── Zip export ────────────────────────────────────────────────────────────────

export async function exportZip(slug: string, filenames?: string[]): Promise<Buffer> {
  const root = projectRoot(slug);
  const zip = new JSZip();

  function addDir(dir: string): void {
    if (!fs.existsSync(dir)) return;
    for (const f of fs.readdirSync(dir)) {
      if (SKIP_DIRS.has(f)) continue;
      const abs = path.join(dir, f);
      const ext = path.extname(f).toLowerCase();
      if (SKIP_NAMES.has(f) || SKIP_EXTS.has(ext)) continue;
      const stat = fs.statSync(abs);
      if (stat.isDirectory()) {
        addDir(abs);
      } else {
        const rel = path.relative(root, abs).replace(/\\/g, '/');
        if (filenames && !filenames.some(fn => rel.endsWith('/' + fn) || rel === fn)) continue;
        zip.file(rel, fs.readFileSync(abs));
      }
    }
  }

  addDir(root);
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}

export async function exportFolderZip(slug: string, relPath?: string): Promise<{ buffer: Buffer; name: string }> {
  const root = projectRoot(slug);
  const baseDir = relPath ? path.join(root, relPath) : root;
  const zip = new JSZip();

  function addDir(dir: string): void {
    if (!fs.existsSync(dir)) return;
    for (const f of fs.readdirSync(dir)) {
      if (SKIP_DIRS.has(f)) continue;
      const abs = path.join(dir, f);
      const ext = path.extname(f).toLowerCase();
      if (SKIP_NAMES.has(f) || SKIP_EXTS.has(ext)) continue;
      const stat = fs.statSync(abs);
      if (stat.isDirectory()) addDir(abs);
      else zip.file(path.relative(baseDir, abs).replace(/\\/g, '/'), fs.readFileSync(abs));
    }
  }

  addDir(baseDir);
  const buffer = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
  const name = relPath ? path.basename(relPath) : slug;
  return { buffer, name };
}

// ── Project file access (for download routes) ─────────────────────────────────

export function getProjectFileContent(slug: string, relPath: string): { buffer: Buffer; name: string } {
  const root = projectRoot(slug);
  const abs = path.resolve(root, relPath);
  if (!abs.startsWith(root + path.sep) && abs !== root) throw new Error('Invalid path');
  return { buffer: fs.readFileSync(abs), name: path.basename(abs) };
}

export function deleteProjectFile(slug: string, relPath: string): void {
  const root = projectRoot(slug);
  const abs = path.resolve(root, relPath);
  if (!abs.startsWith(root + path.sep)) throw new Error('Invalid path');
  if (!fs.existsSync(abs)) return;
  const stat = fs.statSync(abs);
  if (stat.isDirectory()) fs.rmSync(abs, { recursive: true, force: true });
  else fs.unlinkSync(abs);
}

// ── Resource files (legacy binary/reference data) ─────────────────────────────

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

// ── RF path rewriting ─────────────────────────────────────────────────────────

export interface RFKeywordLocation {
  name: string;
  line: number;
}

export function rewriteRobotResourcePaths(
  content: string,
  slug: string,
): { content: string; rewrites: string[] } {
  const resDir = resourcesDir(slug);
  const projectRootPath = path.join(SCRIPTS_ROOT, slug);
  const rewrites: string[] = [];
  const DIRECTIVE_RE = /^(\s*)(Variables|Resource|Library|Resource\s+File)(\s{2,}|\t+)(\S+)(.*)/i;
  let inSettings = false;

  const result = content.split('\n').map((line) => {
    const trimmed = line.trim();
    if (/^\*{3}/.test(trimmed)) {
      inSettings = /\*{3}\s*Settings\s*\*{3}/i.test(trimmed);
      return line;
    }
    if (!inSettings || trimmed === '' || trimmed.startsWith('#')) return line;
    const m = line.match(DIRECTIVE_RE);
    if (!m) return line;
    const [, indent, directive, sep, pathToken, rest] = m;
    if (pathToken.startsWith('/scripts/')) return line;
    const hasPathSep = pathToken.includes('/') || pathToken.includes('\\');
    const hasFileExt = /\.(py|robot|resource|txt)$/i.test(pathToken);
    if (!hasFileExt && !hasPathSep) return line;
    let rel = pathToken.replace(/\\/g, '/');
    while (rel.startsWith('../')) rel = rel.slice(3);
    while (rel.startsWith('./')) rel = rel.slice(2);
    const relUnderRes = rel.replace(/^[Rr]esources?\//, '');
    const candidates: [string, string][] = [
      [path.join(resDir, relUnderRes), relUnderRes],
      [path.join(projectRootPath, rel), rel],
      [path.join(resDir, path.basename(pathToken)), path.basename(pathToken)],
    ];
    let found: string | null = null;
    for (const [absCandidate, relCandidate] of candidates) {
      if (fs.existsSync(absCandidate)) { found = relCandidate; break; }
    }
    if (!found) return line;
    const absPath = `/scripts/${slug}/resources/${found}`;
    rewrites.push(`${pathToken} → ${absPath}`);
    return `${indent}${directive}${sep}${absPath}${rest}`;
  });

  return { content: result.join('\n'), rewrites };
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

// ── Skill file helpers ────────────────────────────────────────────────────────

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
  tier?: string | null;
  humanContext?: string | null;
  content: string;
  confidence: number;
  captureMethod: string;
  isActive: boolean;
  updatedAt: string;
}

export function saveSkillFile(slug: string, skillId: string, data: SkillFileData): void {
  ensureDir(skillsDir(slug));
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

// ── Robot Framework tag extraction ────────────────────────────────────────────

/**
 * Extracts all [Tags] values from a Robot Framework script.
 * Handles multi-tag lines:  [Tags]  TC_001  TC_002  SMOKE
 * Returns unique, non-empty values.
 */
export function extractRobotTags(content: string): string[] {
  const tags = new Set<string>();
  for (const line of content.split('\n')) {
    const m = line.match(/\[Tags\]\s+(.+)/i);
    if (!m) continue;
    for (const tag of m[1].split(/\s{2,}|\t/)) {
      const t = tag.trim();
      if (t) tags.add(t);
    }
  }
  return Array.from(tags);
}

// ── Legacy disk import (kept for backward compat) ─────────────────────────────

export interface DiskScriptMeta {
  filename: string;
  useCaseFolder: string;
  content: string;
  size: number;
  modifiedAt: string;
}

export function importFromDisk(slug: string): DiskScriptMeta[] {
  const tcDir = path.join(projectRoot(slug), 'TestCases');
  if (!fs.existsSync(tcDir)) return [];
  const results: DiskScriptMeta[] = [];
  for (const folder of fs.readdirSync(tcDir)) {
    const folderAbs = path.join(tcDir, folder);
    if (!fs.statSync(folderAbs).isDirectory()) continue;
    for (const f of fs.readdirSync(folderAbs)) {
      if (!f.endsWith('.robot') && !f.endsWith('.spec.ts')) continue;
      const abs = path.join(folderAbs, f);
      const stat = fs.statSync(abs);
      results.push({ filename: f, useCaseFolder: folder, content: fs.readFileSync(abs, 'utf-8'), size: stat.size, modifiedAt: stat.mtime.toISOString() });
    }
  }
  return results;
}
