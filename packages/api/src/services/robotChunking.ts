/**
 * robotChunking: AST-aware-ish truncation for Robot Framework script bodies
 * injected into an LLM prompt (reference scripts, prerequisite script, golden
 * examples, REFERENCE_SCRIPT skills).
 *
 * Previously every one of these sources was truncated with a blind
 * `content.slice(0, N)` — a fixed character cut with no awareness of RF
 * structure, which could (and regularly did) slice a keyword definition in
 * half, leaving the model a dangling, unusable fragment instead of a complete,
 * reusable unit. This chunks along `*** Section ***` and top-level
 * keyword/test-case name boundaries (the same boundaries
 * scriptFileService.extractRobotKeywordsWithLines already parses for other
 * purposes) and greedily keeps whole blocks until the budget runs out —
 * mirroring the cAST "chunk along syntax-tree boundaries, not line count"
 * pattern from RAG-for-code research.
 */

interface Block {
  /** Section header this block belongs to, e.g. "*** Keywords ***" — carried so a truncated Keywords section doesn't silently drop the header for the next block. */
  section: string;
  text: string;
}

function splitIntoBlocks(content: string): Block[] {
  const lines = content.split('\n');
  const blocks: Block[] = [];
  let currentSection = '';
  let currentBlockLines: string[] = [];

  const flush = () => {
    if (currentBlockLines.length === 0) return;
    const text = currentBlockLines.join('\n');
    if (text.trim().length > 0) blocks.push({ section: currentSection, text });
    currentBlockLines = [];
  };

  for (const line of lines) {
    const trimmed = line.trim();
    const isSectionHeader = /^\*{3}.*\*{3}$/.test(trimmed);
    if (isSectionHeader) {
      flush();
      currentSection = trimmed;
      currentBlockLines = [line];
      continue;
    }
    // A new top-level keyword/test-case name starts at column 0 inside
    // *** Keywords *** / *** Test Cases *** — that's a fresh block boundary.
    const isTopLevelName =
      (currentSection.includes('Keywords') || currentSection.includes('Test Cases')) &&
      line.length > 0 && line[0] !== ' ' && line[0] !== '\t' && trimmed.length > 0 && !trimmed.startsWith('#');
    if (isTopLevelName && currentBlockLines.length > 0) {
      flush();
    }
    currentBlockLines.push(line);
  }
  flush();
  return blocks;
}

/**
 * Truncates a Robot Framework script body to at most `charCap` characters,
 * preferring to cut between whole blocks (section headers, keyword/test-case
 * definitions) rather than mid-block. Falls back to a hard slice only when a
 * single block already exceeds the entire budget (rare — e.g. one enormous
 * keyword), so a caller is never left with literally nothing.
 */
export function truncateRobotScript(content: string, charCap: number): { text: string; truncated: boolean } {
  if (content.length <= charCap) return { text: content, truncated: false };

  const blocks = splitIntoBlocks(content);
  const kept: string[] = [];
  let used = 0;

  for (const block of blocks) {
    const addition = block.text.length + 1; // +1 for the joining newline
    if (used + addition > charCap) {
      if (kept.length === 0) {
        // Even the first block alone exceeds the budget — hard slice as a safety net.
        return { text: content.slice(0, charCap), truncated: true };
      }
      break;
    }
    kept.push(block.text);
    used += addition;
  }

  return { text: kept.join('\n'), truncated: used < content.length };
}

/** Convenience: only chunk-truncates for Robot content; Playwright/TS content falls back to a plain slice (no RF section structure to respect). */
export function truncateScriptForPrompt(content: string, charCap: number, isRobot: boolean): { text: string; truncated: boolean } {
  if (!isRobot) {
    return content.length <= charCap
      ? { text: content, truncated: false }
      : { text: content.slice(0, charCap), truncated: true };
  }
  return truncateRobotScript(content, charCap);
}
