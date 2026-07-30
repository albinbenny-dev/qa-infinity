import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';

export interface AdminRunSummary {
  id: string;
  runSeq: number;
  name: string;
  status: string;
  environment: string;
  triggerType: string;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  passed: number;
  failed: number;
  total: number;
}

export interface AdminActiveRun {
  id: string;
  runSeq: number;
  name: string;
  status: string;
  environment: string;
  triggerType: string;
  startedAt: string | null;
  createdAt: string;
}

export interface AdminProjectRuns {
  id: string;
  name: string;
  slug: string;
  color: string;
  totalRuns: number;
  activeRun: AdminActiveRun | null;
  recentRuns: AdminRunSummary[];
}

export interface AdminRunsOverview {
  activeCount: number;
  totalProjects: number;
  projects: AdminProjectRuns[];
}

export function useAdminRunsOverview(enabled = true) {
  return useQuery({
    queryKey: ['admin-runs-overview'],
    queryFn: async () => {
      const res = await api.get<AdminRunsOverview>('/admin/runs/overview');
      return res.data;
    },
    enabled,
    refetchInterval: 8000,
  });
}
