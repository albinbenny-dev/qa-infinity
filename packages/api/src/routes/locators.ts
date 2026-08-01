/**
 * Bulk import for the Object/Locator Repository (see services/locatorRepository.ts).
 *
 * The repository is normally populated two ways — a passing run
 * (jobs/runWorker.ts extractAndLockLocators) or an approved manual correction
 * (services/scriptDiff.ts) — both of which require a script to already exist
 * and have been exercised at least once. This endpoint exists for the cold
 * start: a team's own hand-verified locator map (the kind maintained
 * alongside the application itself) can be imported directly, seeding the
 * repository with pre-vetted knowledge before a single script has run.
 * Imported entries get a high confidence since a human, not an inference,
 * vouches for them — comparable to an approved correction, not a first pass.
 */

import { Router, Request, Response, NextFunction, RequestHandler } from 'express';
import { prisma } from '../lib/prisma.js';
import { verifyToken } from '../middleware/auth.js';
import { requireProjectAccess } from '../middleware/projectAccess.js';
import { buildNamedLocatorName } from '../services/locatorRepository.js';

const router = Router({ mergeParams: true });
router.use(verifyToken as RequestHandler);
router.use(requireProjectAccess as unknown as RequestHandler);

const IMPORT_CONFIDENCE = 0.92;

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

// ── POST /import — bulk-seed the repository from a hand-curated locator map ─

router.post('/import', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const pageMap = extractPageMap(req.body);
    if (!pageMap) {
      res.status(400).json({
        error: 'Body must be a map of { pageName: { elementName: "strategy:selector" } } — optionally wrapped in a single app-name key or a "pages" key.',
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

// ── GET / — list the repository for this project (verification / debugging) ─

router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const entries = await prisma.locatorEntry.findMany({
      where: { projectId: req.project.id },
      orderBy: [{ page: 'asc' }, { confidence: 'desc' }],
    });
    res.json({ entries });
  } catch (err) { next(err); }
});

export default router;
