/**
 * Object/Locator Repository management API (see services/locatorRepository.ts).
 *
 * The repository is normally populated two ways — a passing run
 * (jobs/runWorker.ts extractAndLockLocators) or an approved manual correction
 * (services/scriptDiff.ts) — both of which require a script to already exist
 * and have been exercised at least once. This router covers the other two
 * ways a team actually needs to manage it:
 *  - Cold-start import of a hand-curated locator map (this can be ANY app's
 *    map — Ventas today, a different product tomorrow — nothing here is
 *    hardcoded per-project) via /import (and /import/preview to validate
 *    before committing).
 *  - Direct single-entry CRUD for day-to-day maintenance as the list grows.
 * Imported/manually-entered locators get a high confidence since a human,
 * not an inference, vouches for them — comparable to an approved correction.
 */

import { Router, Request, Response, NextFunction, RequestHandler } from 'express';
import { z } from 'zod';
// @ts-ignore — js-yaml has no bundled types and @types/js-yaml isn't installed
import yaml from 'js-yaml';
import { prisma } from '../lib/prisma.js';
import { verifyToken } from '../middleware/auth.js';
import { requireProjectAccess } from '../middleware/projectAccess.js';
import { buildNamedLocatorName, selectorStrategy } from '../services/locatorRepository.js';

const router = Router({ mergeParams: true });
router.use(verifyToken as RequestHandler);
router.use(requireProjectAccess as unknown as RequestHandler);

const IMPORT_CONFIDENCE = 0.92;
const MANUAL_CONFIDENCE = 0.85;

type PageMap = Record<string, Record<string, string>>;

function isPageMap(value: unknown): value is PageMap {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  return Object.values(value as Record<string, unknown>).every(
    (page) =>
      page && typeof page === 'object' && !Array.isArray(page) &&
      Object.values(page as Record<string, unknown>).every((v) => typeof v === 'string'),
  );
}

/**
 * Accepts the page map directly, or one level of wrapping — either an
 * app-name key (`{ AIRTEL: { LoginPage: {...} } }`) or a `pages` key
 * (`{ pages: { LoginPage: {...} } }`) — so a locator map can be posted with
 * minimal (or no) reshaping from however a team already maintains it.
 */
function extractPageMap(body: unknown): PageMap | null {
  if (isPageMap(body)) return body;
  if (body && typeof body === 'object' && !Array.isArray(body)) {
    const obj = body as Record<string, unknown>;
    if (isPageMap(obj['pages'])) return obj['pages'] as PageMap;
    const keys = Object.keys(obj);
    if (keys.length === 1 && isPageMap(obj[keys[0]])) return obj[keys[0]] as PageMap;
  }
  return null;
}

/** Parses "strategy:selector" (the team's own format) or an already-internal "strategy=selector" string. */
function parseLocatorValue(raw: string): { strategy: string; selector: string } | null {
  const trimmed = raw.trim();
  const colonIdx = trimmed.indexOf(':');
  if (colonIdx !== -1 && !trimmed.slice(0, colonIdx).includes('=')) {
    const strategy = trimmed.slice(0, colonIdx).trim();
    const value = trimmed.slice(colonIdx + 1).trim();
    if (!strategy || !value) return null;
    return { strategy, selector: `${strategy}=${value}` };
  }
  const eqIdx = trimmed.indexOf('=');
  if (eqIdx !== -1) {
    return { strategy: trimmed.slice(0, eqIdx).trim(), selector: trimmed };
  }
  return null;
}

/**
 * A locator map can arrive three ways: an already-structured JSON body (the
 * original API shape), a `{ raw: "..." }` string the caller wants parsed
 * server-side, or nothing at all. The raw string is tried as JSON first,
 * then YAML — so a team's existing locators.yaml can be pasted verbatim with
 * no client-side conversion.
 */
function resolvePageMap(body: unknown): { pageMap: PageMap | null; parseError?: string } {
  if (body && typeof body === 'object' && typeof (body as Record<string, unknown>)['raw'] === 'string') {
    const raw = (body as Record<string, unknown>)['raw'] as string;
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      try {
        parsed = yaml.load(raw);
      } catch (yamlErr) {
        return { pageMap: null, parseError: `Could not parse as JSON or YAML: ${(yamlErr as Error).message}` };
      }
    }
    return { pageMap: extractPageMap(parsed) };
  }
  return { pageMap: extractPageMap(body) };
}

interface ImportEntryPreview {
  page: string;
  name: string;
  elementName: string;
  selector: string;
  strategy: string;
  isNew: boolean;
}

async function buildImportPreview(projectId: string, pageMap: PageMap): Promise<{ entries: ImportEntryPreview[]; skipped: string[] }> {
  const entries: ImportEntryPreview[] = [];
  const skipped: string[] = [];

  for (const [pageName, elements] of Object.entries(pageMap)) {
    for (const [elementName, rawLocator] of Object.entries(elements)) {
      const parsed = parseLocatorValue(rawLocator);
      if (!parsed) { skipped.push(`${pageName}.${elementName}`); continue; }
      const name = buildNamedLocatorName(pageName, elementName);
      const existing = await prisma.locatorEntry.findUnique({ where: { projectId_name: { projectId, name } } });
      entries.push({
        page: pageName, name, elementName,
        selector: parsed.selector, strategy: parsed.strategy,
        isNew: !existing,
      });
    }
  }
  return { entries, skipped };
}

// ── POST /import/preview — parse + diff against the existing repository, no writes ─

router.post('/import/preview', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { pageMap, parseError } = resolvePageMap(req.body);
    if (parseError) { res.status(400).json({ error: parseError }); return; }
    if (!pageMap) {
      res.status(400).json({
        error: 'Could not find a locator map. Expected { pageName: { elementName: "strategy:selector" } }, optionally wrapped in an app-name key, a "pages" key, or pasted as raw YAML/JSON.',
      });
      return;
    }
    const { entries, skipped } = await buildImportPreview(req.project.id, pageMap);
    res.json({
      ok: true,
      totalPages: Object.keys(pageMap).length,
      totalElements: entries.length,
      newCount: entries.filter((e) => e.isNew).length,
      updateCount: entries.filter((e) => !e.isNew).length,
      entries,
      skipped,
    });
  } catch (err) { next(err); }
});

// ── POST /import — bulk-seed the repository from a hand-curated locator map ─

router.post('/import', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { pageMap, parseError } = resolvePageMap(req.body);
    if (parseError) { res.status(400).json({ error: parseError }); return; }
    if (!pageMap) {
      res.status(400).json({
        error: 'Could not find a locator map. Expected { pageName: { elementName: "strategy:selector" } }, optionally wrapped in an app-name key, a "pages" key, or pasted as raw YAML/JSON.',
      });
      return;
    }

    let created = 0;
    let updated = 0;
    const skipped: string[] = [];

    for (const [pageName, elements] of Object.entries(pageMap)) {
      for (const [elementName, rawLocator] of Object.entries(elements)) {
        const parsed = parseLocatorValue(rawLocator);
        if (!parsed) { skipped.push(`${pageName}.${elementName}`); continue; }

        const name = buildNamedLocatorName(pageName, elementName);
        const existing = await prisma.locatorEntry.findUnique({
          where: { projectId_name: { projectId: req.project.id, name } },
        });

        if (existing) {
          await prisma.locatorEntry.update({
            where: { id: existing.id },
            data: {
              selector: parsed.selector,
              strategy: parsed.strategy,
              page: pageName,
              confidence: Math.max(existing.confidence, IMPORT_CONFIDENCE),
              isActive: true,
            },
          });
          updated++;
        } else {
          await prisma.locatorEntry.create({
            data: {
              projectId: req.project.id,
              name,
              page: pageName,
              selector: parsed.selector,
              strategy: parsed.strategy,
              confidence: IMPORT_CONFIDENCE,
              successCount: 0,
            },
          });
          created++;
        }
      }
    }

    res.json({ ok: true, created, updated, skipped });
  } catch (err) { next(err); }
});

// ── GET /pages — distinct page names for autocomplete ────────────────────

router.get('/pages', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const rows = await prisma.locatorEntry.findMany({
      where: { projectId: req.project.id },
      select: { page: true },
      distinct: ['page'],
      orderBy: { page: 'asc' },
    });
    res.json({ pages: rows.map(r => r.page) });
  } catch (err) { next(err); }
});

// ── GET / — list the repository for this project ──────────────────────────

router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const entries = await prisma.locatorEntry.findMany({
      where: { projectId: req.project.id },
      orderBy: [{ page: 'asc' }, { confidence: 'desc' }],
    });
    res.json({ entries });
  } catch (err) { next(err); }
});

// ── Single-entry CRUD — day-to-day maintenance as the list grows ──────────

const CreateLocatorSchema = z.object({
  page: z.string().min(1).max(120),
  elementName: z.string().min(1).max(120),
  selector: z.string().min(1).max(500), // "strategy:value" or "strategy=value"
});

router.post('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const parsed = CreateLocatorSchema.safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ error: parsed.error.flatten() }); return; }
    const { page, elementName, selector: rawSelector } = parsed.data;

    const locator = parseLocatorValue(rawSelector);
    if (!locator) { res.status(400).json({ error: `Could not parse selector "${rawSelector}" — expected "strategy:value" (e.g. "css:.my-button")` }); return; }

    const name = buildNamedLocatorName(page, elementName);
    const entry = await prisma.locatorEntry.upsert({
      where: { projectId_name: { projectId: req.project.id, name } },
      create: {
        projectId: req.project.id, name, page,
        selector: locator.selector, strategy: locator.strategy,
        confidence: MANUAL_CONFIDENCE, successCount: 0,
      },
      update: {
        selector: locator.selector, strategy: locator.strategy,
        confidence: MANUAL_CONFIDENCE, isActive: true,
      },
    });
    res.status(201).json({ entry });
  } catch (err) { next(err); }
});

const UpdateLocatorSchema = z.object({
  page: z.string().min(1).max(120).optional(),
  selector: z.string().min(1).max(500).optional(),
  isActive: z.boolean().optional(),
});

router.put('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const existing = await prisma.locatorEntry.findFirst({ where: { id: req.params.id, projectId: req.project.id } });
    if (!existing) { res.status(404).json({ error: 'Locator entry not found' }); return; }

    const parsed = UpdateLocatorSchema.safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ error: parsed.error.flatten() }); return; }
    const { page, selector: rawSelector, isActive } = parsed.data;

    let selectorUpdate: { selector: string; strategy: string } | undefined;
    if (rawSelector !== undefined) {
      const locator = parseLocatorValue(rawSelector) ?? { selector: rawSelector, strategy: selectorStrategy(rawSelector) };
      selectorUpdate = locator;
    }

    const entry = await prisma.locatorEntry.update({
      where: { id: existing.id },
      data: {
        ...(page !== undefined ? { page } : {}),
        ...(selectorUpdate ?? {}),
        ...(isActive !== undefined ? { isActive } : {}),
      },
    });
    res.json({ entry });
  } catch (err) { next(err); }
});

router.delete('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const existing = await prisma.locatorEntry.findFirst({ where: { id: req.params.id, projectId: req.project.id } });
    if (!existing) { res.status(404).json({ error: 'Locator entry not found' }); return; }
    await prisma.locatorEntry.delete({ where: { id: existing.id } });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

export default router;
