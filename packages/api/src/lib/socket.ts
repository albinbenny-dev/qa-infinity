import type { Namespace, Socket } from 'socket.io';

let _runsNsp: Namespace | null = null;
let _projectsNsp: Namespace | null = null;

// ── VNC token cache ──────────────────────────────────────────────────────────
// Replayed to clients that join after the token was emitted.
const lastVncByRun = new Map<string, { token?: string; busy?: boolean }>();

// ── Log replay buffer ────────────────────────────────────────────────────────
// Stores all run:log lines emitted during an active run so late-joining clients
// (e.g. navigating from Scheduler → Execution mid-run) receive the full history.
// Capped at MAX_LOG_BUFFER lines per run to bound memory; oldest lines are
// dropped when the cap is hit. Buffer is cleared when the run completes.
const MAX_LOG_BUFFER = 5000;
interface LogEntry { kind: string; text: string; ts: string }
const logBufferByRun = new Map<string, LogEntry[]>();

export function setRunsNamespace(nsp: Namespace): void {
  _runsNsp = nsp;
}

export function getRunsNamespace(): Namespace | null {
  return _runsNsp;
}

export function emitToRun(runId: string, event: string, data: unknown): void {
  if (event === 'run:vnc') {
    lastVncByRun.set(runId, data as { token?: string; busy?: boolean });
  } else if (event === 'run:log') {
    // Buffer log lines for late-joining clients
    const entry = data as LogEntry;
    let buf = logBufferByRun.get(runId);
    if (!buf) { buf = []; logBufferByRun.set(runId, buf); }
    buf.push(entry);
    if (buf.length > MAX_LOG_BUFFER) buf.shift(); // drop oldest when capped
  } else if (event === 'run:complete' || event === 'run:cancelled' || event === 'run:error') {
    lastVncByRun.delete(runId);
    // Keep log buffer a little longer (client may still be joining) — cleared on next run:start
  } else if (event === 'run:start') {
    // Fresh run — clear any previous buffer for this runId
    logBufferByRun.delete(runId);
  }
  _runsNsp?.to(`run:${runId}`).emit(event, data);
}

/** Replay all buffered log lines to a single socket (called on joinRun). */
export function replayLogs(runId: string, socket: Socket): void {
  const buf = logBufferByRun.get(runId);
  if (!buf || buf.length === 0) return;
  for (const entry of buf) {
    socket.emit('run:log', entry);
  }
}

export function getLastVnc(runId: string): { token?: string; busy?: boolean } | undefined {
  return lastVncByRun.get(runId);
}

export function setProjectsNamespace(nsp: Namespace): void {
  _projectsNsp = nsp;
}

export function emitToProject(projectId: string, event: string, data: unknown): void {
  _projectsNsp?.to(`project:${projectId}`).emit(event, data);
}
