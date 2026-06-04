import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import type { ProjectResource } from '../types';

// ── List resources ─────────────────────────────────────────────────────────

export function useResources(projectId: string | undefined) {
  return useQuery({
    queryKey: ['resources', projectId],
    queryFn: async () => {
      const res = await api.get<ProjectResource[]>(`/projects/${projectId}/resources`);
      return res.data;
    },
    enabled: !!projectId,
  });
}

// ── Upload resource file ───────────────────────────────────────────────────

export function useUploadResource(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (file: File) => {
      const formData = new FormData();
      formData.append('file', file);
      const res = await api.post<ProjectResource>(
        `/projects/${projectId}/resources`,
        formData,
        { headers: { 'Content-Type': 'multipart/form-data' } },
      );
      return res.data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['resources', projectId] });
    },
  });
}

// ── Read resource file content ─────────────────────────────────────────────

export function useResourceContent(projectId: string | undefined, filename: string | null) {
  return useQuery({
    queryKey: ['resources', projectId, filename, 'content'],
    queryFn: async () => {
      const res = await api.get<{ content: string }>(
        `/projects/${projectId}/resources/${encodeURIComponent(filename!)}/content`,
      );
      return res.data.content;
    },
    enabled: !!projectId && !!filename,
  });
}

// ── Save resource file content ─────────────────────────────────────────────

export function useSaveResource(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ filename, content }: { filename: string; content: string }) => {
      await api.put(
        `/projects/${projectId}/resources/${encodeURIComponent(filename)}/content`,
        { content },
      );
    },
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ['resources', projectId, vars.filename, 'content'] });
      qc.invalidateQueries({ queryKey: ['resources', projectId] });
    },
  });
}

// ── Delete resource file ───────────────────────────────────────────────────

export function useDeleteResource(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (filename: string) => {
      await api.delete(`/projects/${projectId}/resources/${encodeURIComponent(filename)}`);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['resources', projectId] });
    },
  });
}
