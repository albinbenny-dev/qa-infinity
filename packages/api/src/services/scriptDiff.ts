/**
 * ScriptDiff: turns a human's manual edit to a generated script into a
 * classified, durable record instead of a silent content overwrite.
 *
 * This is the feedback-loop half of the rebuild — previously PUT /:id/content
 * just replaced Script.content with no trace of what changed or why, so a
 * QA engineer's correction taught the system nothing. Every save now runs
 * through classifyScriptEdit(), which is cheap (regex-based, no LLM call) and
 * distinguishes a locator swap (promotable straight into the LocatorEntry
 * repository) from a structural/step change (queued for human approval before
 * it can be promoted into a golden example) from a plain test-data edit.
 */

import { prisma } from '../lib/prisma.js';
import { recordLocatorCorrection } from './locatorRepository.js';

// The alternation for quoted segments matters: role=row[name="..."] and
// css=[attr='...'] — both explicitly recommended locator strategies in the
// generation system prompt — contain quote characters and often internal
// spaces (e.g. name='Search Menu Item'). A plain [^\s'"}{]+ class stops at
// the first quote, truncating exactly these two strategies mid-token.
const LOCATOR_ARG_RE = /(?:css|id|role|text|xpath)=(?:[^\s'"]|"[^"]*"|'[^']*')+/g;

export type ScriptEditClassification = 'LOCATOR_SWAP' | 'STRUCTURAL' | 'DATA' | 'UNCLASSIFIED';

export interface LocatorChange {
  before: string;
  after: string;
}

export interface ScriptDiffSummary {
  classification: ScriptEditClassification;
  locatorChanges: LocatorChange[];
  addedLineCount: number;
  removedLineCount: number;
  changedKeywordNames: string[];
}

function extractLocators(content: string): string[] {
  return content.match(LOCATOR_ARG_RE) ?? [];
}

function extractKeywordNames(content: string): Set<string> {
  const names = new Set<string>();
  let inKeywords = false;
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (trimmed.startsWith('*** Keywords ***')) { inKeywords = true; continue; }
    if (trimmed.startsWith('***')) { inKeywords = false; continue; }
    if (inKeywords && line.length > 0 && line[0] !== ' ' && line[0] !== '\t' && trimmed.length > 0 && !trimmed.startsWith('#')) {
      names.add(trimmed);
    }
  }
  return names;
}

/**
 * Classifies a manual script edit purely from a line-level diff — no LLM call,
 * so this runs synchronously on every save without adding latency or cost.
 *
 *  - LOCATOR_SWAP: only locator argument tokens changed, line count is stable,
 *    keyword names are unchanged. The most common and most valuable correction —
 *    a QA engineer fixed a broken selector.
 *  - STRUCTURAL: keyword names were added/removed/renamed, or the line count
 *    changed meaningfully — a step was added, removed, or reordered.
 *  - DATA: content changed but no locator or structural signal was found —
 *    most often a test-data value edit.
 */
export function classifyScriptEdit(previousContent: string, newContent: string): ScriptDiffSummary {
  if (previousContent === newContent) {
    return { classification: 'UNCLASSIFIED', locatorChanges: [], addedLineCount: 0, removedLineCount: 0, changedKeywordNames: [] };
  }

  const prevLines = previousContent.split('\n');
  const nextLines = newContent.split('\n');
  const addedLineCount = Math.max(0, nextLines.length - prevLines.length);
  const removedLineCount = Math.max(0, prevLines.length - nextLines.length);

  const prevKeywords = extractKeywordNames(previousContent);
  const nextKeywords = extractKeywordNames(newContent);
  const changedKeywordNames = [
    ...[...prevKeywords].filter((k) => !nextKeywords.has(k)),
    ...[...nextKeywords].filter((k) => !prevKeywords.has(k)),
  ];

  // Pair up locator changes line-by-line where a line's non-locator text is
  // otherwise identical — a reliable, cheap signal for "this exact step's
  // selector was swapped" without needing a real diff/patch library.
  const locatorChanges: LocatorChange[] = [];
  const maxLines = Math.min(prevLines.length, nextLines.length);
  for (let i = 0; i < maxLines; i++) {
    const before = prevLines[i];
    const after = nextLines[i];
    if (before === after) continue;
    const beforeLocators = extractLocators(before);
    const afterLocators = extractLocators(after);
    if (beforeLocators.length === 1 && afterLocators.length === 1 && beforeLocators[0] !== afterLocators[0]) {
      const beforeStripped = before.replace(LOCATOR_ARG_RE, ' ');
      const afterStripped = after.replace(LOCATOR_ARG_RE, ' ');
      if (beforeStripped === afterStripped) {
        locatorChanges.push({ before: beforeLocators[0], after: afterLocators[0] });
      }
    }
  }

  let classification: ScriptEditClassification;
  if (changedKeywordNames.length > 0 || addedLineCount > 2 || removedLineCount > 2) {
    classification = 'STRUCTURAL';
  } else if (locatorChanges.length > 0) {
    classification = 'LOCATOR_SWAP';
  } else {
    classification = 'DATA';
  }

  return { classification, locatorChanges, addedLineCount, removedLineCount, changedKeywordNames };
}

/**
 * Persists the edit as a ScriptEdit row and, for pure locator swaps, promotes
 * the correction straight into the LocatorEntry repository immediately — a
 * human explicitly fixing a selector is exactly the "approval" a locator swap
 * needs. STRUCTURAL edits are recorded but left unpromoted (promoted=false)
 * until a reviewer opts them into the golden-examples pool via the existing
 * PATCH /:id/golden toggle — see routes/scripts.ts.
 */
export async function recordScriptEdit(params: {
  scriptId: string;
  projectId: string;
  previousContent: string;
  newContent: string;
  page?: string | null;
  editedBy?: string | null;
}): Promise<ScriptDiffSummary> {
  const { scriptId, projectId, previousContent, newContent, page, editedBy } = params;
  const summary = classifyScriptEdit(previousContent, newContent);

  if (summary.classification === 'UNCLASSIFIED' && summary.locatorChanges.length === 0) {
    return summary; // no-op save (e.g. re-saving identical content) — nothing to record
  }

  let promoted = false;
  if (summary.classification === 'LOCATOR_SWAP') {
    await Promise.all(
      summary.locatorChanges.map((c) =>
        recordLocatorCorrection({ projectId, page, selector: c.after }).catch(() => {
          /* best-effort — a repository write failure must not block the save */
        }),
      ),
    );
    promoted = true;
  }

  await prisma.scriptEdit.create({
    data: {
      scriptId,
      projectId,
      previousContent,
      newContent,
      diffSummary: JSON.stringify(summary),
      classification: summary.classification,
      promoted,
      editedBy: editedBy ?? null,
    },
  });

  return summary;
}
