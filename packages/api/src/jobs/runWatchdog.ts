import { prisma } from '../lib/prisma.js';
import { testRunQueue } from '../lib/queue.js';
import { emitToRun } from '../lib/socket.js';

const CHECK_INTERVAL_MS = 60_000;      // sweep every minute
const GRACE_PERIOD_MS = 3 * 60_000;    // ignore runs started less than 3 min ago — give BullMQ's own attempt/retry cycle a chance first

const STALL_MESSAGE =
  'Run stalled — the execution worker became unresponsive and BullMQ abandoned the job. ' +
  'Automatically marked failed by the reconciliation watchdog.';

// Runs left in RUNNING whose BullMQ job has already reached a terminal state
// (or has vanished from the queue entirely) will never update on their own —
// nothing else in the codebase reconciles that gap. This sweep is the backstop:
// it periodically checks each RUNNING run's actual job state in Redis and closes
// out any that BullMQ has already given up on, so the UI never shows a run as
// "running" for hours after the job behind it is dead.
async function reconcileOrphanedRuns(): Promise<void> {
  const staleRuns = await prisma.run.findMany({
    where: { status: 'RUNNING', startedAt: { lt: new Date(Date.now() - GRACE_PERIOD_MS) } },
    select: { id: true, runSeq: true },
  });

  for (const run of staleRuns) {
    try {
      const job = await testRunQueue.getJob(run.id);
      const state = job ? await job.getState() : null;

      // Only reconcile once we're sure the job is genuinely gone — anything still
      // active/waiting/delayed/waiting-children is legitimately in flight or queued
      // for its BullMQ-driven retry and must be left alone.
      const isOrphaned = job === null || state === 'completed' || state === 'failed';
      if (!isOrphaned) continue;

      const { count } = await prisma.runResult.updateMany({
        where: { runId: run.id, status: { in: ['RUNNING', 'PENDING'] } },
        data: { status: 'FAILED', errorMessage: STALL_MESSAGE },
      });

      await prisma.run.update({
        where: { id: run.id },
        data: { status: 'FAILED', completedAt: new Date() },
      });

      emitToRun(run.id, 'run:error', STALL_MESSAGE);
      console.warn(
        `[run-watchdog] Run #${run.runSeq} (${run.id}) was orphaned (job state: ${state ?? 'missing'}) — ` +
        `marked FAILED, closed out ${count} unfinished test case(s).`,
      );
    } catch (err) {
      console.error(`[run-watchdog] Failed to reconcile run ${run.id}:`, (err as Error).message);
    }
  }
}

export function startRunWatchdog(): void {
  setInterval(() => { void reconcileOrphanedRuns(); }, CHECK_INTERVAL_MS);
  console.log(`[run-watchdog] Orphaned-run reconciliation scheduled (every ${CHECK_INTERVAL_MS / 1000}s, ${GRACE_PERIOD_MS / 1000}s grace period)`);
}
