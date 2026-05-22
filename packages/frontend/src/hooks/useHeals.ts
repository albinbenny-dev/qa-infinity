import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import type { HealProposal, HealStats } from '../types';

export function useHeals(projectId: string | undefined, status?: string) {
  return useQuery({
    queryKey: ['heals', projectId, status],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (status) params.set('status', status);
      const qs = params.toString();
      const res = await api.get<HealProposal[]>(
        `/projects/${projectId}/heals${qs ? `?${qs}` : ''}`,
      );
      return res.data;
    },
    enabled: !!projectId,
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
  });
}

export function useTriggerHeal(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (runId: string) =>
      api.post<{ message: string; count: number }>(
        `/projects/${projectId}/heals/trigger/${runId}`,
      ).then(r => r.data),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['heals', projectId] });
      void qc.invalidateQueries({ queryKey: ['heal-stats', projectId] });
    },
  });
}

export function useReviewHeal(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ healId, action }: { healId: string; action: 'APPROVED' | 'REJECTED' }) =>
      api.patch<HealProposal>(`/projects/${projectId}/heals/${healId}`, { action }).then(r => r.data),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['heals', projectId] });
      void qc.invalidateQueries({ queryKey: ['heal-stats', projectId] });
    },
  });
}

export function useApplyHeal(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (healId: string) =>
      api.post<HealProposal>(`/projects/${projectId}/heals/${healId}/apply`).then(r => r.data),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['heals', projectId] });
      void qc.invalidateQueries({ queryKey: ['heal-stats', projectId] });
    },
  });
}
