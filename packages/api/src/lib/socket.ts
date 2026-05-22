import type { Namespace } from 'socket.io';

let _runsNsp: Namespace | null = null;

export function setRunsNamespace(nsp: Namespace): void {
  _runsNsp = nsp;
}

export function getRunsNamespace(): Namespace | null {
  return _runsNsp;
}

export function emitToRun(runId: string, event: string, data: unknown): void {
  _runsNsp?.to(`run:${runId}`).emit(event, data);
}
