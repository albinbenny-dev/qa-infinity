import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import type { Script } from '../types';

interface ScriptsResponse {
  scripts: Script[];
}

interface GenerateResponse {
  created: Array<{ id: string; filename: string; testCaseId: string; tcId: string; title: string }>;
  errors: Array<{ testCaseId: string; error: string }>;
}

export function useScripts(projectId: string | undefined) {
  return useQuery({
    queryKey: ['scripts', projectId],
    queryFn: async () => {
      const res = await api.get<ScriptsResponse>(`/projects/${projectId}/scripts`);
      return res.data.scripts;
    },
    enabled: !!projectId,
  });
}

export function useGenerateScripts(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (testCaseIds: string[]) => {
      const res = await api.post<GenerateResponse>(
        `/projects/${projectId}/scripts/generate`,
        { testCaseIds },
        { timeout: 180_000 },
      );
      return res.data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['scripts', projectId] });
    },
  });
}

export function useSaveScriptContent(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ scriptId, content }: { scriptId: string; content: string }) => {
      await api.put(`/projects/${projectId}/scripts/${scriptId}/content`, { content });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['scripts', projectId] });
    },
  });
}

export function useDeleteScript(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (scriptId: string) => {
      await api.delete(`/projects/${projectId}/scripts/${scriptId}`);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['scripts', projectId] });
    },
  });
}

export function useUploadScript(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ file, testCaseId }: { file: File; testCaseId?: string }) => {
      const formData = new FormData();
      formData.append('file', file);
      if (testCaseId) formData.append('testCaseId', testCaseId);
      const res = await api.post<Script>(
        `/projects/${projectId}/scripts/upload`,
        formData,
        { headers: { 'Content-Type': 'multipart/form-data' } },
      );
      return res.data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['scripts', projectId] });
    },
  });
}

export function scriptExportUrl(projectId: string, ids?: string[]): string {
  const base = `/api/projects/${projectId}/scripts/export/zip`;
  if (ids?.length) return `${base}?ids=${ids.join(',')}`;
  return base;
}
