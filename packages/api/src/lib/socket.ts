import type { Namespace } from 'socket.io';

let _runsNsp: Namespace | null = null;
let _projectsNsp: Namespace | null = null;

// A host-browser run's VNC token is broadcast once, right as the runner claims
// a slot — often before a socket that just called joinRun has finished its
// access-control DB round-trip and actually joined the room. Without this,
// that broadcast is lost forever for any client that joins a beat too late
// (worse over higher-latency connections, e.g. through an SSH jump host).
// Cached here so joinRun can replay it, the same way run:start/run:complete
// catch up from the Run row itself.
const lastVncByRun = new Map<string, { token?: string; busy?: boolean }>();

export function setRunsNamespace(nsp: Namespace): void {
  _runsNsp = nsp;
}

export function getRunsNamespace(): Namespace | null {
  return _runsNsp;
}

export function emitToRun(runId: string, event: string, data: unknown): void {
  if (event === 'run:vnc') {
    lastVncByRun.set(runId, data as { token?: string; busy?: boolean });
  } else if (event === 'run:complete' || event === 'run:cancelled' || event === 'run:error') {
    lastVncByRun.delete(runId);
  }
  _runsNsp?.to(`run:${runId}`).emit(event, data);
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
