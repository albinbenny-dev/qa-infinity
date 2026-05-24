import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import type { HealProposal, HealStats } from '../types';

export function useHeals(projectId: string | undefined, status?: string, type?: string) {
  return useQuery({
    queryKey: ['heals', projectId, status, type],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (status) params.set('status', status);
      if (type) params.set('type', type);
      const qs = params.toString();
      const res = await api.get<HealProposal[]>(
        `/projects/${projectId}/heals${qs ? `?${qs}` : ''}`,
      );
      return res.data;
    },
    enabled: !!projectId,
    refetchInterval: 15_000,
  });
}

export function useHealStats(projectId: string | undefined) {
  return useQuery({
    queryKey: ['heal-stats', projectId],
    queryFn: async () => {
      const res = await api.get<HealStats>(`/projects/${projectId}/heals/stats`);
      return res.data;
    },
    enabled: !!projectId,
    refetchInterval: 20_000,
  });
}

export function useTriggerHeal(projectId: string, onNoHeals?: () => void) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (runId: string) =>
      api
        .post<{ message: string; count: number }>(
          `/projects/${projectId}/heals/trigger/${runId}`,
        )
        .then((r) => r.data),
    onSuccess: (data) => {
      void qc.invalidateQueries({ queryKey: ['heals', projectId] });
      void qc.invalidateQueries({ queryKey: ['heal-stats', projectId] });
      if (data.count === 0) onNoHeals?.();
    },
    onError: () => {
      onNoHeals?.();
    },
  });
}

// New: POST /:healId/approve — applies patch + re-queues test
export function useApproveHeal(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (healId: string) =>
      api
        .post<{ message: string; runId: string }>(
          `/projects/${projectId}/heals/${healId}/approve`,
        )
        .then((r) => r.data),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['heals', projectId] });
      void qc.invalidateQueries({ queryKey: ['heal-stats', projectId] });
      void qc.invalidateQueries({ queryKey: ['runs', projectId] });
    },
  });
}

// New: POST /:healId/reject
export function useRejectHeal(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (healId: string) =>
      api
        .post<{ message: string }>(`/projects/${projectId}/heals/${healId}/reject`)
        .then((r) => r.data),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['heals', projectId] });
      void qc.invalidateQueries({ queryKey: ['heal-stats', projectId] });
    },
  });
}

// New: POST /approve-all-confident — bulk approve confidence ≥ 90
export function useApproveAllConfident(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () =>
      api
        .post<{ message: string; count: number }>(
          `/projects/${projectId}/heals/approve-all-confident`,
        )
        .then((r) => r.data),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['heals', projectId] });
      void qc.invalidateQueries({ queryKey: ['heal-stats', projectId] });
    },
  });
}

// Legacy: PATCH /:healId — kept for backward compat with old HealingAgent page
export function useReviewHeal(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ healId, action }: { healId: string; action: 'APPROVED' | 'REJECTED' }) =>
      api
        .patch<HealProposal>(`/projects/${projectId}/heals/${healId}`, { action })
        .then((r) => r.data),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['heals', projectId] });
      void qc.invalidateQueries({ queryKey: ['heal-stats', projectId] });
    },
  });
}

// DELETE /:healId — hard-delete a heal record (used for clearing EXHAUSTED cards)
export function useDismissHeal(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (healId: string) =>
      api
        .delete<{ message: string }>(`/projects/${projectId}/heals/${healId}`)
        .then((r) => r.data),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['heals', projectId] });
      void qc.invalidateQueries({ queryKey: ['heal-stats', projectId] });
    },
  });
}

// Legacy: POST /:healId/apply
export function useApplyHeal(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (healId: string) =>
      api
        .post<HealProposal>(`/projects/${projectId}/heals/${healId}/apply`)
        .then((r) => r.data),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['heals', projectId] });
      void qc.invalidateQueries({ queryKey: ['heal-stats', projectId] });
    },
  });
}
