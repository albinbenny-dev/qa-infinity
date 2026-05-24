import { useQuery } from '@tanstack/react-query';
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
