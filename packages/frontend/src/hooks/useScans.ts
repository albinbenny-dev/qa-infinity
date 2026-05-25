import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import type { UIScan, ProjectContext, LoginInstructions } from '../types';

export function useScans(projectId: string | undefined) {
  return useQuery({
    queryKey: ['scans', projectId],
    queryFn: async () => {
      const res = await api.get<UIScan[]>(`/projects/${projectId}/scans`);
      return res.data;
    },
    enabled: !!projectId,
    refetchInterval: 10_000,
  });
}

export function useScan(projectId: string | undefined, scanId: string | undefined) {
  return useQuery({
    queryKey: ['scan', projectId, scanId],
    queryFn: async () => {
      const res = await api.get<UIScan>(`/projects/${projectId}/scans/${scanId}`);
      return res.data;
    },
    enabled: !!projectId && !!scanId,
    refetchInterval: (query) => {
      const data = query.state.data;
      return data?.status === 'RUNNING' || data?.status === 'PENDING' ? 3000 : false;
    },
  });
}

export function useProjectContext(projectId: string | undefined) {
  return useQuery({
    queryKey: ['project-context', projectId],
    queryFn: async () => {
      const res = await api.get<ProjectContext>(`/projects/${projectId}/scans/context/current`);
      return res.data;
    },
    enabled: !!projectId,
    retry: (failureCount, error) => {
      // Don't retry 404 — it just means no scan has been run yet
      if ((error as { response?: { status?: number } })?.response?.status === 404) return false;
      return failureCount < 2;
    },
  });
}

export function useStartScan(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: {
      envConfigId: string;
      scanDepth: 'full' | 'top-level' | 'login-only';
      generateTCs: boolean;
      customInstructions?: string;
    }) =>
      api
        .post<{ scanId: string }>(`/projects/${projectId}/scans`, payload)
        .then((r) => r.data),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['scans', projectId] });
    },
  });
}

export function useUpdateContext(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: {
      loginInstructions?: LoginInstructions;
      customInstructions?: string | null;
      pendingTCDraft?: null;
    }) =>
      api
        .patch<ProjectContext>(`/projects/${projectId}/scans/context/current`, data)
        .then((r) => r.data),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['project-context', projectId] });
    },
  });
}

/** @deprecated use useUpdateContext */
export function useUpdateLoginInstructions(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (loginInstructions: LoginInstructions) =>
      api
        .patch<ProjectContext>(`/projects/${projectId}/scans/context/current`, { loginInstructions })
        .then((r) => r.data),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['project-context', projectId] });
    },
  });
}

export interface QuickLoginTestResult {
  success: boolean;
  finalUrl?: string;
  errorMessage?: string;
  screenshotBase64?: string;
}

export function useQuickLoginTest(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (envConfigId: string) =>
      api
        .post<QuickLoginTestResult>(
          `/projects/${projectId}/scans/quick-login-test`,
          { envConfigId },
          { timeout: 90000 },
        )
        .then((r) => r.data),
    onSuccess: (data) => {
      if (data.success) {
        void qc.invalidateQueries({ queryKey: ['project-context', projectId] });
      }
    },
  });
}

export function useDeleteScan(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (scanId: string) =>
      api
        .delete<{ message: string }>(`/projects/${projectId}/scans/${scanId}`)
        .then((r) => r.data),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['scans', projectId] });
    },
  });
}
