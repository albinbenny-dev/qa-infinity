import { useEffect, useRef, useCallback } from 'react';
import { io, type Socket } from 'socket.io-client';
import { getToken } from '../lib/auth';

export interface ScanProgressPayload {
  scanId: string;
  projectId: string;
  projectSlug: string;
  progress: number;
  currentPage: string;
  pagesScanned: number;
  pagesTotal: number;
}

export interface ScanCompletedPayload {
  scanId: string;
  projectId: string;
  projectSlug: string;
  tcCount: number;
  useCaseCount: number;
}

export interface ScanFailedPayload {
  scanId: string;
  projectId: string;
  projectSlug: string;
  error: string;
}

export interface ScanSocketHandlers {
  onStarted?: (data: { scanId: string; projectId: string; projectSlug: string }) => void;
  onProgress?: (data: ScanProgressPayload) => void;
  onCompleted?: (data: ScanCompletedPayload) => void;
  onFailed?: (data: ScanFailedPayload) => void;
}

const SOCKET_URL =
  typeof window !== 'undefined'
    ? `${window.location.protocol}//${window.location.host}`
    : 'http://localhost:3000';

export function useScanSocket(handlers: ScanSocketHandlers) {
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

    socket.on('scan:started', (data) => handlersRef.current.onStarted?.(data));
    socket.on('scan:progress', (data) => handlersRef.current.onProgress?.(data));
    socket.on('scan:completed', (data) => handlersRef.current.onCompleted?.(data));
    socket.on('scan:failed', (data) => handlersRef.current.onFailed?.(data));

    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
  }, []);

  const disconnect = useCallback(() => {
    socketRef.current?.disconnect();
  }, []);

  return { disconnect };
}
