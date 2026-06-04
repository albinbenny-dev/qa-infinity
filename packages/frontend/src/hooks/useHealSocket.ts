import { useEffect, useRef } from 'react';
import { io, type Socket } from 'socket.io-client';
import { getToken } from '../lib/auth';

export interface HealAutoAppliedPayload {
  healId: string;
  projectId: string;
  projectSlug: string;
  tcTitle: string;
  confidence: number;
  runId?: string;
  explanation?: string;
  runResultId?: string;
}

export interface HealStartedPayload {
  runResultId: string;
  projectId: string;
  projectSlug: string;
  tcTitle: string;
}

export type HealPhase = 'TRACING' | 'PATCHING';

export interface HealProgressPayload {
  runResultId: string;
  projectId: string;
  projectSlug: string;
  phase: HealPhase;
  tcTitle: string;
}

export interface HealPendingCreatedPayload {
  healId: string;
  projectId: string;
  projectSlug: string;
  tcTitle: string;
  confidence: number;
  runResultId: string;
}

export interface HealSocketHandlers {
  onAutoApplied?: (data: HealAutoAppliedPayload) => void;
  onStarted?: (data: HealStartedPayload) => void;
  onProgress?: (data: HealProgressPayload) => void;
  onPendingCreated?: (data: HealPendingCreatedPayload) => void;
}

const SOCKET_URL =
  typeof window !== 'undefined'
    ? `${window.location.protocol}//${window.location.host}`
    : 'http://localhost:3000';

export function useHealSocket(handlers: HealSocketHandlers) {
  const socketRef = useRef<Socket | null>(null);
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  useEffect(() => {
    const token = getToken();
    const socket = io(`${SOCKET_URL}/runs`, {
      auth: { token },
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionDelay: 1000,
    });
    socketRef.current = socket;

    socket.on('heal:auto-applied', (data: HealAutoAppliedPayload) => {
      handlersRef.current.onAutoApplied?.(data);
    });

    socket.on('heal:started', (data: HealStartedPayload) => {
      handlersRef.current.onStarted?.(data);
    });

    socket.on('heal:progress', (data: HealProgressPayload) => {
      handlersRef.current.onProgress?.(data);
    });

    socket.on('heal:pending-created', (data: HealPendingCreatedPayload) => {
      handlersRef.current.onPendingCreated?.(data);
    });

    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
  }, []);
}
