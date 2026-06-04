import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';

export interface OpenRouterUsage {
  label: string;
  usage: number;
  limit: number | null;
  remaining: number | null;
  is_free_tier: boolean;
  rate_limit: { requests: number; interval: string };
  model: string;
  provider: string;
}

export interface AgentUsageRow {
  agentName: string;
  calls: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  avgDurationMs: number;
  lastUsed: string | null;
}

export interface AgentUsageData {
  agents: AgentUsageRow[];
  total: { calls: number; tokens: number };
  days: number;
}

export function useOpenRouterUsage() {
  return useQuery({
    queryKey: ['openrouter-usage'],
    queryFn: async () => {
      const res = await api.get<OpenRouterUsage>('/admin/usage');
      return res.data;
    },
    refetchInterval: 60_000,
    staleTime: 30_000,
  });
}

export function useAgentUsage(days = 30) {
  return useQuery({
    queryKey: ['agent-usage', days],
    queryFn: async () => {
      const res = await api.get<AgentUsageData>(`/admin/usage/agents?days=${days}`);
      return res.data;
    },
    refetchInterval: 60_000,
    staleTime: 30_000,
  });
}

export function useUsageTrend(days = 14) {
  return useQuery({
    queryKey: ['usage-trend', days],
    queryFn: async () => {
      const res = await api.get<{ trend: Array<{ date: string; tokens: number }> }>(
        `/admin/usage/trend?days=${days}`,
      );
      return res.data.trend;
    },
    staleTime: 30_000,
  });
}

export interface AgentConfigRow {
  agentName: string;
  label: string;
  description: string;
  enabled: boolean;
  settings: Record<string, unknown> | null;
}

export interface ProjectUsageEntry {
  projectId: string;
  projectName: string;
  totalTokens: number;
}

export function useUsageByProject() {
  return useQuery({
    queryKey: ['usage-by-project'],
    queryFn: async () => {
      const res = await api.get<{ byProject: ProjectUsageEntry[] }>('/admin/usage/by-project');
      return res.data.byProject;
    },
    staleTime: 60_000,
    refetchInterval: 60_000,
  });
}

export function useAgentConfig() {
  return useQuery({
    queryKey: ['agent-config'],
    queryFn: async () => {
      const res = await api.get<{ agents: AgentConfigRow[] }>('/admin/agents');
      return res.data.agents;
    },
    staleTime: 10_000,
  });
}

export function useToggleAgent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ agentName, enabled }: { agentName: string; enabled: boolean }) => {
      const res = await api.patch<AgentConfigRow>(`/admin/agents/${agentName}`, { enabled });
      return res.data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['agent-config'] }),
  });
}

export function useStandardMode() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (enable: boolean) => {
      const res = await api.post<{ ok: boolean; standardMode: boolean }>('/admin/agents/standard-mode', { enable });
      return res.data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['agent-config'] }),
  });
}

export function useUpdateAgentSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ agentName, settings }: { agentName: string; settings: Record<string, unknown> }) => {
      const res = await api.patch<{ agentName: string; settings: Record<string, unknown> | null }>(
        `/admin/agents/${agentName}/settings`,
        settings,
      );
      return res.data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['agent-config'] }),
  });
}
