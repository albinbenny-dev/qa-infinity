/**
 * skillSelector: the shared "which skills apply to this generation?" predicate.
 *
 * Previously this logic was duplicated in two places that disagreed:
 *  - agents/scriptAgent.ts filtered FEATURE/HISTORICAL skills by EXACT string
 *    equality between skill.featureGroup and the test case's useCaseTag — a TC
 *    tagged "Stock Mgmt" would silently miss a skill grouped under
 *    "Stock Management", with no relevance fallback.
 *  - lib/skillsContext.ts (used by chatAgent, healingAgent, writerAgent, etc.)
 *    applied NO featureGroup filtering at all — every active skill went in.
 *
 * This module is the single relevance predicate both now call. It keeps each
 * caller's existing default behavior (opt-in scoping) while replacing exact
 * equality with a token-overlap relevance score wherever scoping IS requested,
 * so near-miss tag wording still matches instead of guessing from nothing.
 */

import type { SkillFileData } from './scriptFileService.js';

const RELEVANCE_THRESHOLD = 0.34; // ~1/3 of the shorter phrase's distinctive tokens must overlap

function tokenize(s: string): Set<string> {
  return new Set(
    s
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((t) => t.length > 2),
  );
}

/** Overlap-coefficient similarity — generous toward one phrase being a subset of the other (e.g. "Stock" vs "Stock Management"). */
export function relevanceScore(a: string, b: string): number {
  const ta = tokenize(a);
  const tb = tokenize(b);
  if (ta.size === 0 || tb.size === 0) return 0;
  let intersection = 0;
  for (const t of ta) if (tb.has(t)) intersection++;
  return intersection / Math.min(ta.size, tb.size);
}

export function isLoginSkill(s: Pick<SkillFileData, 'skillType' | 'name' | 'scope'>): boolean {
  return (
    s.skillType === 'UI_FLOW' &&
    (s.name.toLowerCase().includes('login') || (s.scope?.toLowerCase().includes('login') ?? false))
  );
}

export interface SkillSelectionOptions {
  /** The current test case's use-case tag. Passing this (even as null) opts into scoped ("strict") filtering. Omitting it entirely preserves the legacy "include everything" behavior for callers that haven't adopted scoping. */
  useCaseTag?: string | null;
  /** Skill names (lower-cased) to force-include regardless of scope — e.g. explicitly pinned skills. */
  pinnedNames?: Set<string>;
}

/**
 * Filters + sorts a project's skill set for prompt injection.
 *  - GLOBAL tier: always included.
 *  - Unscoped skills (no featureGroup): always included — they're meant to apply everywhere.
 *  - Scoped skills (FEATURE/HISTORICAL with a featureGroup): included when the featureGroup
 *    exactly matches the TC's useCaseTag, OR scores above the relevance threshold against it.
 *  - Login-type skills are always sorted first; ties broken by confidence descending.
 */
export function selectRelevantSkills(all: SkillFileData[], opts: SkillSelectionOptions = {}): SkillFileData[] {
  const { pinnedNames } = opts;
  const scoped = opts.useCaseTag !== undefined; // param was explicitly passed (even as null) → caller wants scoping
  const tcTag = opts.useCaseTag?.trim() ?? '';

  const filtered = all.filter((skill) => {
    if (!skill.isActive) return false;
    if (pinnedNames?.has(skill.name.toLowerCase())) return true;
    if (!scoped) return true; // legacy behavior — no scoping requested

    const tier = skill.tier ?? 'FEATURE';
    if (tier === 'GLOBAL') return true;

    const fg = skill.featureGroup?.trim();
    if (!fg) return true; // unscoped skill — applies to all TCs
    if (!tcTag) return false; // scoped skill, but this TC has nothing to match against
    if (fg.toLowerCase() === tcTag.toLowerCase()) return true; // exact match — always include
    return relevanceScore(fg, tcTag) >= RELEVANCE_THRESHOLD;
  });

  return [...filtered].sort((a, b) => {
    const aLogin = isLoginSkill(a);
    const bLogin = isLoginSkill(b);
    if (aLogin && !bLogin) return -1;
    if (!aLogin && bLogin) return 1;
    return b.confidence - a.confidence;
  });
}
