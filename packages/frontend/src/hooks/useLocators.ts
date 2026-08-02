import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import type { LocatorEntry } from '../types';

interface LocatorsResponse {
  entries: LocatorEntry[];
}

export interface ImportPreviewEntry {
  page: string;
  name: string;
  elementName: string;
  selector: string;
  strategy: string;
  isNew: boolean;
}

export interface ImportPreviewResponse {
  ok: true;
  totalPages: number;
  totalElements: number;
  newCount: number;
  updateCount: number;
  entries: ImportPreviewEntry[];
  skipped: string[];
}

export interface ImportResultResponse {
  ok: true;
  created: number;
  updated: number;
  skipped: string[];
}

export interface CreateLocatorPayload {
  page: string;
  elementName: string;
  selector: string; // "strategy:value"
}

export interface UpdateLocatorPayload {
  page?: string;
  selector?: string;
  isActive?: boolean;
}

export function useLocators(projectId: string | undefined) {
  return useQuery({
    queryKey: ['locators', projectId],
    queryFn: async () => {
      const res = await api.get<LocatorsResponse>(`/projects/${projectId}/locators`);
      return res.data.entries;
    },
    enabled: !!projectId,
    staleTime: 30_000,
  });
}

export function useCreateLocator(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: CreateLocatorPayload) => {
      const res = await api.post<{ entry: LocatorEntry }>(`/projects/${projectId}/locators`, payload);
      return res.data.entry;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['locators', projectId] }),
  });
}

export function useUpdateLocator(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, data }: { id: string; data: UpdateLocatorPayload }) => {
      const res = await api.put<{ entry: LocatorEntry }>(`/projects/${projectId}/locators/${id}`, data);
      return res.data.entry;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['locators', projectId] }),
  });
}

export function useDeleteLocator(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      await api.delete(`/projects/${projectId}/locators/${id}`);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['locators', projectId] }),
  });
}

/** Parses (server-side, JSON or YAML) a pasted/uploaded locator map and diffs it against the repository — no writes. */
export function usePreviewLocatorImport(projectId: string) {
  return useMutation({
    mutationFn: async (raw: string) => {
      const res = await api.post<ImportPreviewResponse>(`/projects/${projectId}/locators/import/preview`, { raw });
      return res.data;
    },
  });
}

export function useImportLocators(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (raw: string) => {
      const res = await api.post<ImportResultResponse>(`/projects/${projectId}/locators/import`, { raw });
      return res.data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['locators', projectId] }),
  });
}
