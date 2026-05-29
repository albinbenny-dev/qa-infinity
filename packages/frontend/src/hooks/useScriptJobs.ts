import { useEffect, useRef, useState, useCallback } from 'react';
import { io, type Socket } from 'socket.io-client';
import { getToken } from '../lib/auth';
import { api } from '../lib/api';
import { useProjectStore } from '../stores/projectStore';
import type { ScriptJob } from '../types';

const SOCKET_URL = typeof window !== 'undefined'
  ? `${window.location.protocol}//${window.location.host}`
  : 'http://localhost:3000';

interface UseScriptJobsReturn {
  jobs: ScriptJob[];
  setJobs: React.Dispatch<React.SetStateAction<ScriptJob[]>>;
  clear: () => Promise<void>;
  clearAll: () => Promise<void>;
}

export function useScriptJobs(projectId: string | undefined): UseScriptJobsReturn {
  const { currentUser } = useProjectStore();
  const currentUserId = currentUser?.id;
  const currentUserIdRef = useRef(currentUserId);
  useEffect(() => { currentUserIdRef.current = currentUserId; }, [currentUserId]);
  const [jobs, setJobs] = useState<ScriptJob[]>([]);
  const socketRef = useRef<Socket | null>(null);

  // Initial fetch of active jobs (in case any are mid-flight from a previous session)
  useEffect(() => {
    if (!projectId) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await api.get<{ jobs: ScriptJob[] }>(
          `/projects/${projectId}/scripts/jobs?active=1`,
        );
        if (!cancelled) setJobs(res.data.jobs);
      } catch { /* ignore */ }
    })();
    return () => { cancelled = true; };
  }, [projectId]);

  // Socket subscription
  useEffect(() => {
    if (!projectId) return;
    const token = getToken();
    const socket = io(`${SOCKET_URL}/projects`, {
      auth: { token },
      query: { projectId },
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionDelay: 1000,
    });
    socketRef.current = socket;

    socket.on('connect', () => {
      socket.emit('joinProject', { projectId });
    });

    socket.on('script-job:update', (job: ScriptJob) => {
      // Ignore jobs that belong to another user
      const uid = currentUserIdRef.current;
      if (job.createdBy && uid && job.createdBy !== uid) return;
      setJobs((prev) => {
        const idx = prev.findIndex((j) => j.id === job.id);
        if (idx === -1) return [job, ...prev];
        const next = [...prev];
        next[idx] = { ...next[idx], ...job };
        return next;
      });
    });

    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
  }, [projectId]);

  const clear = useCallback(async () => {
    if (!projectId) return;
    try {
      await api.delete(`/projects/${projectId}/scripts/jobs/finished`);
      setJobs((prev) =>
        prev.filter(
          (j) => !['VERIFIED', 'GENERATED', 'MANUAL_REVIEW', 'FAILED'].includes(j.phase),
        ),
      );
    } catch { /* ignore */ }
  }, [projectId]);

  const clearAll = useCallback(async () => {
    if (!projectId) return;
    try {
      await api.delete(`/projects/${projectId}/scripts/jobs/all`);
      setJobs([]);
    } catch { /* ignore */ }
  }, [projectId]);

  return { jobs, setJobs, clear, clearAll };
}
