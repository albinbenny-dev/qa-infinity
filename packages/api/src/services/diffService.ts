export interface DiffLine {
  type: 'add' | 'remove' | 'unchanged';
  line: string;
  lineNum: number;
}

const LCS_LINE_LIMIT = 400;

export function generateLineDiff(original: string, patched: string): DiffLine[] {
  const origLines = original.split('\n');
  const patchLines = patched.split('\n');

  if (origLines.length > LCS_LINE_LIMIT || patchLines.length > LCS_LINE_LIMIT) {
    return zipDiff(origLines, patchLines);
  }

  return lcsDiff(origLines, patchLines);
}

// LCS-based diff for files within the line limit — produces minimal edit distance
function lcsDiff(a: string[], b: string[]): DiffLine[] {
  const m = a.length;
  const n = b.length;

  // Build DP table
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0) as number[]);
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1] + 1
        : Math.max(dp[i - 1][j], dp[i][j - 1]);
    }
  }

  // Backtrack
  type Op = { op: 'unchanged' | 'remove' | 'add'; aIdx?: number; bIdx?: number };
  const ops: Op[] = [];
  let i = m;
  let j = n;

  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && a[i - 1] === b[j - 1]) {
      ops.unshift({ op: 'unchanged', aIdx: i - 1, bIdx: j - 1 });
      i--;
      j--;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      ops.unshift({ op: 'add', bIdx: j - 1 });
      j--;
    } else {
      ops.unshift({ op: 'remove', aIdx: i - 1 });
      i--;
    }
  }

  return ops.map((op) => {
    if (op.op === 'unchanged') {
      return { type: 'unchanged' as const, line: a[op.aIdx!], lineNum: op.aIdx! + 1 };
    } else if (op.op === 'remove') {
      return { type: 'remove' as const, line: a[op.aIdx!], lineNum: op.aIdx! + 1 };
    } else {
      return { type: 'add' as const, line: b[op.bIdx!], lineNum: op.bIdx! + 1 };
    }
  });
}

// Zip diff for large files — line-by-line positional comparison
function zipDiff(a: string[], b: string[]): DiffLine[] {
  const maxLen = Math.max(a.length, b.length);
  const result: DiffLine[] = [];

  for (let i = 0; i < maxLen; i++) {
    if (i >= a.length) {
      result.push({ type: 'add', line: b[i], lineNum: i + 1 });
    } else if (i >= b.length) {
      result.push({ type: 'remove', line: a[i], lineNum: i + 1 });
    } else if (a[i] === b[i]) {
      result.push({ type: 'unchanged', line: a[i], lineNum: i + 1 });
    } else {
      result.push({ type: 'remove', line: a[i], lineNum: i + 1 });
      result.push({ type: 'add', line: b[i], lineNum: i + 1 });
    }
  }

  return result;
}
