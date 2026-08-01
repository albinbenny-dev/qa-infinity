/**
 * dryRunGate: a fast, no-browser validation pass for generated Robot Framework
 * scripts, using RF's own `--dryrun` flag (resolves every keyword call and
 * validates test data without executing any keyword implementation — no
 * browser, no VNC slot, typically sub-second to a few seconds).
 *
 * Previously the default script-generation flow had ZERO validation before a
 * script reached a human — only regex-based sanitizers (see scriptGenWorker's
 * sanitizeRobotScript/lintRobotScript), which can't catch a hallucinated
 * keyword name or a malformed variable declaration. This is the cheap first
 * gate from the generate → validate → repair pattern; the expensive real
 * headless-execution gate remains the existing opt-in `withHeal` verify
 * pipeline (jobs/scriptVerifyWorker.ts) — deliberately left opt-in since it
 * spins up a real browser and materially changes generation latency/cost,
 * unlike this gate.
 *
 * Fails OPEN: if the runner is unreachable, this reports passed=true rather
 * than blocking generation — a missing safety net should never be worse than
 * the zero-validation status quo it replaces.
 */

import { findScriptPath } from './scriptFileService.js';

export interface DryRunResult {
  passed: boolean;
  errorMessage?: string;
  /** True when the gate didn't actually validate anything (runner unreachable, file missing) — passed=true here means "not blocked", not "verified." */
  skipped?: boolean;
}

const RUNNER_URL = process.env.RUNNER_PRIMARY_URL ?? process.env.RUNNER_URL ?? 'http://qa-runner:5001';
const DRY_RUN_TIMEOUT_MS = 30_000; // generous — dry run never opens a browser, this is a ceiling not an expectation

interface RFDryRunTest { status: 'PASS' | 'FAIL'; errorMsg?: string | null }
interface RFDryRunReport { _robotReport?: true; tests?: RFDryRunTest[] }

export async function dryRunRobotScript(slug: string, filename: string): Promise<DryRunResult> {
  const scriptPath = findScriptPath(slug, filename);
  if (!scriptPath) {
    // Can't locate the file we just wrote — don't block on an internal inconsistency.
    return { passed: true, skipped: true };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DRY_RUN_TIMEOUT_MS);

  try {
    const response = await fetch(`${RUNNER_URL}/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        scriptPath,
        reportFile: `${scriptPath}.dryrun.json`,
        dryRun: true,
        headless: true,
      }),
    });
    const text = await response.text();
    clearTimeout(timeout);

    let exitCode = 1;
    let reportData: RFDryRunReport | undefined;
    for (const raw of text.split('\n')) {
      const trimmed = raw.trim();
      if (!trimmed) continue;
      let msg: { type: string; exitCode?: number; reportData?: RFDryRunReport | null };
      try { msg = JSON.parse(trimmed); } catch { continue; }
      if (msg.type === 'done') {
        exitCode = msg.exitCode ?? 1;
        reportData = msg.reportData ?? undefined;
      }
    }

    if (exitCode === 0) return { passed: true };

    const failedTest = reportData?.tests?.find((t) => t.status === 'FAIL');
    return {
      passed: false,
      errorMessage:
        failedTest?.errorMsg?.slice(0, 1500) ??
        'Dry-run failed — likely an undefined keyword, a missing library import, or a syntax error in *** Variables ***/*** Settings ***.',
    };
  } catch (err) {
    clearTimeout(timeout);
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`[dry-run-gate] runner unreachable, skipping gate (fail-open): ${message}`);
    return { passed: true, skipped: true };
  }
}
