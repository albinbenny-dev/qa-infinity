/**
 * LocatorRepository: a persisted, named, per-project store of verified element
 * locators — the "Object Repository" pattern (Katalon) combined with Healenium's
 * confidence-scored history.
 *
 * Script generation is meant to SELECT from this repository by name rather than
 * invent selectors fresh each time. Entries are written automatically from
 * passing runs (see jobs/runWorker.ts extractAndLockLocators) and from approved
 * manual corrections (see services/scriptDiff.ts + routes/scripts.ts).
 */

import { prisma } from '../lib/prisma.js';
import type { LocatorEntry } from '@prisma/client';
import { relevanceScore } from './skillSelector.js';

const MIN_CONFIDENCE = 0.05;
const MAX_CONFIDENCE = 0.98;
const BASE_CONFIDENCE = 0.6;
const SUCCESS_STEP = 0.08;
const FAIL_STEP = 0.2;
// A manually-approved correction (human fixed a broken locator) is trusted more
// than a single passing run — start it closer to the ceiling.
const CORRECTION_CONFIDENCE = 0.75;

function clampConfidence(n: number): number {
  return Math.max(MIN_CONFIDENCE, Math.min(MAX_CONFIDENCE, n));
}

/** Infers a human-readable semantic label from a selector string (shared heuristic with patternExtractor). */
export function inferSemanticLabel(selector: string): string {
  const lower = selector.toLowerCase();
  if (lower.includes('username') || lower.includes('email')) return 'USERNAME_INPUT';
  if (lower.includes('password')) return 'PASSWORD_INPUT';
  if (lower.includes('kc-login') || lower.includes('submit') || lower.includes('login-btn') || lower.includes('sign-in')) return 'LOGIN_SUBMIT';
  if (lower.includes('dashboard')) return 'DASHBOARD_INDICATOR';
  if (lower.includes('logout') || lower.includes('sign-out')) return 'LOGOUT_BUTTON';
  const stripped = selector
    .replace(/^(?:css=|id=|role=|text=|xpath=)/, '')
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toUpperCase();
  return (stripped || 'ELEMENT').slice(0, 48);
}

export function selectorStrategy(selector: string): string {
  const m = selector.match(/^(css|id|role|text|xpath)=/);
  return m ? m[1] : 'css';
}

function sanitizeNamePart(s: string): string {
  return s.toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

/**
 * Builds a repository name from a page + a human-chosen element name — used
 * for bulk-importing a hand-curated locator map (see routes/locators.ts).
 * Unlike buildLocatorName below, this preserves the team's own naming
 * ("StockCreation.POField") instead of inferring one from the selector, since
 * a human already gave it a meaningful name.
 */
export function buildNamedLocatorName(page: string, elementName: string): string {
  return `${sanitizeNamePart(page)}.${sanitizeNamePart(elementName)}`;
}

/** Builds a stable repository name from a page scope + selector. Deterministic — same selector always maps to the same name unless a human renames it. */
export function buildLocatorName(page: string | null | undefined, selector: string): string {
  const scope = (page?.trim() || 'GLOBAL').toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  return `${scope}.${inferSemanticLabel(selector)}`;
}

interface UpsertLocatorSuccessParams {
  projectId: string;
  name: string;
  page?: string | null;
  selector: string;
  runId?: string;
  domContext?: string | null;
}

/** Records a successful use of a locator — raises confidence, bumps successCount. Called after a passing run. */
export async function recordLocatorSuccess(params: UpsertLocatorSuccessParams): Promise<void> {
  const { projectId, name, page, selector, runId, domContext } = params;
  const existing = await prisma.locatorEntry.findUnique({
    where: { projectId_name: { projectId, name } },
  });

  if (!existing) {
    await prisma.locatorEntry.create({
      data: {
        projectId, name, page: page ?? null, selector,
        strategy: selectorStrategy(selector),
        domContext: domContext ?? null,
        confidence: BASE_CONFIDENCE,
        successCount: 1,
        sourceRunId: runId ?? null,
        lastVerifiedRunId: runId ?? null,
      },
    });
    return;
  }

  // Selector unchanged from what's on file — reinforce confidence.
  // Selector changed for the same named element — this run just re-verified a
  // (possibly different) selector at the same semantic slot; trust the fresh one.
  const selectorChanged = existing.selector !== selector;
  const nextSuccessCount = selectorChanged ? 1 : existing.successCount + 1;
  const nextConfidence = clampConfidence(
    (selectorChanged ? BASE_CONFIDENCE : existing.confidence) + SUCCESS_STEP,
  );

  await prisma.locatorEntry.update({
    where: { id: existing.id },
    data: {
      selector,
      strategy: selectorStrategy(selector),
      domContext: domContext ?? existing.domContext,
      confidence: nextConfidence,
      successCount: nextSuccessCount,
      failCount: selectorChanged ? 0 : existing.failCount,
      lastVerifiedRunId: runId ?? existing.lastVerifiedRunId,
      isActive: true,
    },
  });
}

/** Records a failure (e.g. a heal had to replace this locator) — lowers confidence. */
export async function recordLocatorFailure(projectId: string, name: string): Promise<void> {
  const existing = await prisma.locatorEntry.findUnique({
    where: { projectId_name: { projectId, name } },
  });
  if (!existing) return;
  await prisma.locatorEntry.update({
    where: { id: existing.id },
    data: {
      failCount: existing.failCount + 1,
      confidence: clampConfidence(existing.confidence - FAIL_STEP),
    },
  });
}

/**
 * Writes back a human-approved correction (a QA engineer manually fixed a
 * locator in a generated script). Treated as higher-trust than a passing-run
 * observation since a person explicitly vetted it.
 */
export async function recordLocatorCorrection(params: {
  projectId: string; page?: string | null; selector: string;
}): Promise<LocatorEntry> {
  const { projectId, page, selector } = params;
  const name = buildLocatorName(page, selector);
  const existing = await prisma.locatorEntry.findUnique({
    where: { projectId_name: { projectId, name } },
  });
  if (!existing) {
    return prisma.locatorEntry.create({
      data: {
        projectId, name, page: page ?? null, selector,
        strategy: selectorStrategy(selector),
        confidence: CORRECTION_CONFIDENCE,
        successCount: 1,
      },
    });
  }
  return prisma.locatorEntry.update({
    where: { id: existing.id },
    data: {
      selector,
      strategy: selectorStrategy(selector),
      confidence: clampConfidence(Math.max(existing.confidence, CORRECTION_CONFIDENCE)),
      successCount: existing.successCount + 1,
      failCount: 0,
      isActive: true,
    },
  });
}

/**
 * Returns the closed list of repository entries generation should choose from
 * for a given page/feature scope.
 *
 * Originally this hard-filtered to page-less (global) entries plus an EXACT
 * (case-insensitive) match on the TC's useCaseTag — which meant a locator
 * proven under one useCaseTag was completely invisible to a same-page-but-
 * differently-tagged TC. That's a real-world miss: a "Save" button or a
 * shared form field routinely gets exercised by TCs under several different
 * useCaseTags, and a locator that was hard-won on one of them should still be
 * offered on the others rather than forcing the LLM to re-invent it from
 * scratch. So instead of filtering entries out, every entry gets a scope
 * score (1.0 global or exact match, a token-overlap relevance score for a
 * near match, a low-but-nonzero floor otherwise) and is ranked by that first
 * and confidence second — nothing is ever excluded outright, just ordered.
 */
export async function getLocatorsForScope(
  projectId: string,
  page?: string | null,
): Promise<LocatorEntry[]> {
  const tcTag = page?.trim();
  const entries = await prisma.locatorEntry.findMany({
    where: { projectId, isActive: true },
  });

  const scored = entries.map((e) => {
    let scopeScore = 0.15; // project-wide fallback floor — never fully excluded
    if (!e.page || !tcTag) {
      scopeScore = 1;
    } else if (e.page.toLowerCase() === tcTag.toLowerCase()) {
      scopeScore = 1;
    } else {
      scopeScore = Math.max(scopeScore, relevanceScore(e.page, tcTag));
    }
    return { entry: e, scopeScore };
  });

  scored.sort((a, b) => b.scopeScore - a.scopeScore || b.entry.confidence - a.entry.confidence);
  return scored.slice(0, 60).map((s) => s.entry);
}

/** Set of selector strings currently in the repository for this project — used by the post-generation lint. */
export async function getKnownSelectorSet(projectId: string): Promise<Set<string>> {
  const entries = await prisma.locatorEntry.findMany({
    where: { projectId, isActive: true },
    select: { selector: true },
  });
  return new Set(entries.map((e) => e.selector));
}
