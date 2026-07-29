import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import type { ProjectSkill, SkillType } from '../types';

interface SkillsResponse {
  skills: ProjectSkill[];
  total: number;
}

export interface CreateSkillPayload {
  skillType: SkillType;
  name: string;
  scope?: string;
  featureGroup?: string | null;
  content: string;
  captureMethod?: string;
  confidence?: number;
}

export interface UpdateSkillPayload {
  name?: string;
  scope?: string;
  featureGroup?: string | null;
  content?: string;
  isActive?: boolean;
  confidence?: number;
}

export interface FeatureGroupInfo {
  name: string;
  skillCount: number;
  activeCount: number;
  skillTypes: string[];
}

export interface ParsedApiEndpoint {
  name: string;
  method: string;
  endpoint: string;
  purpose: string;
  requestSchema: unknown;
  responses: unknown;
  authRequired: boolean;
  notes: string;
}

export type ApiSpecFormat = 'openapi' | 'postman' | 'curl';

export function useSkills(projectId: string | undefined, skillType?: SkillType) {
  return useQuery({
    queryKey: ['skills', projectId, skillType],
    queryFn: async () => {
      const params: Record<string, string> = {};
      if (skillType) params.skillType = skillType;
      const res = await api.get<SkillsResponse>(`/projects/${projectId}/skills`, { params });
      return res.data;
    },
    enabled: !!projectId,
    staleTime: 30_000,
  });
}

export function useRelevantSkills(projectId: string | undefined, requirement: string) {
  return useQuery({
    queryKey: ['skills-relevant', projectId, requirement.slice(0, 80)],
    queryFn: async () => {
      const res = await api.get<{ skills: ProjectSkill[] }>(
        `/projects/${projectId}/skills/relevant`,
        { params: { q: requirement.slice(0, 300) } },
      );
      return res.data.skills;
    },
    enabled: !!projectId && requirement.trim().length > 10,
    staleTime: 30_000,
  });
}

export function useCreateSkill(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: CreateSkillPayload) => {
      const res = await api.post<{ skill: ProjectSkill }>(`/projects/${projectId}/skills`, payload);
      return res.data.skill;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['skills', projectId] });
    },
  });
}

export function useUpdateSkill(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ skillId, data }: { skillId: string; data: UpdateSkillPayload }) => {
      const res = await api.put<{ skill: ProjectSkill }>(
        `/projects/${projectId}/skills/${skillId}`,
        data,
      );
      return res.data.skill;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['skills', projectId] });
    },
  });
}

export function useDeleteSkill(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (skillId: string) => {
      await api.delete(`/projects/${projectId}/skills/${skillId}`);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['skills', projectId] });
    },
  });
}

export function useStartRecording(projectId: string) {
  return useMutation({
    mutationFn: async (payload: { name: string; targetUrl: string; scope?: string }) => {
      const res = await api.post<{
        sessionId: string;
        name: string;
        targetUrl: string;
        scope: string | null;
        novncPort: number;
        vncToken: string | null;
      }>(`/projects/${projectId}/skills/start-recording`, payload, { timeout: 15_000 });
      return res.data;
    },
  });
}

export function useStopRecording(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: {
      sessionId: string;
      name: string;
      targetUrl: string;
      scope?: string;
      featureGroup?: string | null;
    }) => {
      const res = await api.post<{ skill: import('../types').ProjectSkill }>(
        `/projects/${projectId}/skills/stop-recording`,
        payload,
        { timeout: 30_000 },
      );
      return res.data.skill;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['skills', projectId] });
    },
  });
}

export function useCancelRecording(projectId: string) {
  return useMutation({
    mutationFn: async (sessionId: string) => {
      const res = await api.post(
        `/projects/${projectId}/skills/cancel-recording`,
        { sessionId },
        { timeout: 10_000 },
      );
      return res.data;
    },
  });
}

export function useImportScript(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: {
      name: string;
      targetUrl: string;
      scriptContent: string;
      scope?: string;
      featureGroup?: string | null;
    }) => {
      const res = await api.post<{ skill: import('../types').ProjectSkill }>(
        `/projects/${projectId}/skills/import-script`,
        payload,
        { timeout: 15_000 },
      );
      return res.data.skill;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['skills', projectId] });
    },
  });
}

export function useFeatureGroups(projectId: string | undefined) {
  return useQuery({
    queryKey: ['skill-features', projectId],
    queryFn: async () => {
      const res = await api.get<{ features: FeatureGroupInfo[] }>(`/projects/${projectId}/skills/features`);
      return res.data.features;
    },
    enabled: !!projectId,
    staleTime: 30_000,
  });
}

export function useConvertSkillFromText(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: {
      skillType: string;
      name: string;
      text: string;
      scope?: string;
      featureGroup?: string;
    }) => {
      const res = await api.post<{ skill: ProjectSkill }>(
        `/projects/${projectId}/skills/convert-from-text`,
        payload,
        { timeout: 60_000 },
      );
      return res.data.skill;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['skills', projectId] });
    },
  });
}

export function useParseApiSpec(projectId: string) {
  return useMutation({
    mutationFn: async (text: string) => {
      const res = await api.post<{ format: ApiSpecFormat; endpoints: ParsedApiEndpoint[] }>(
        `/projects/${projectId}/skills/parse-api-spec`,
        { text },
        { timeout: 30_000 },
      );
      return res.data;
    },
  });
}

export function useImportApiContracts(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: {
      scope?: string;
      featureGroup?: string | null;
      endpoints: ParsedApiEndpoint[];
    }) => {
      const res = await api.post<{ skills: ProjectSkill[]; count: number }>(
        `/projects/${projectId}/skills/import-api-contracts`,
        payload,
        { timeout: 30_000 },
      );
      return res.data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['skills', projectId] });
    },
  });
}

export function useExtractSkillFromDoc(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: {
      skillType: 'BUSINESS_USE_CASE' | 'HLD' | 'API_CONTRACT' | 'UX_DESIGN' | 'FUNCTIONAL_RULES';
      name: string;
      filePath: string;
      scope?: string;
      featureGroup?: string;
    }) => {
      const res = await api.post<{ skill: ProjectSkill }>(
        `/projects/${projectId}/skills/extract-from-doc`,
        payload,
        { timeout: 60_000 },
      );
      return res.data.skill;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['skills', projectId] });
    },
  });
}
