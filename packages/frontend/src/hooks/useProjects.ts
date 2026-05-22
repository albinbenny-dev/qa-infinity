import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import type { Project, EnvConfig, ProjectMember, RequirementDoc } from '../types';

export function useProjects() {
  return useQuery({
    queryKey: ['projects'],
    queryFn: async () => {
      const res = await api.get<Project[]>('/projects');
      return res.data;
    },
  });
}

export function useProject(slug: string | undefined) {
  return useQuery({
    queryKey: ['project', slug],
    queryFn: async () => {
      const res = await api.get<Project[]>('/projects');
      const project = res.data.find((p) => p.slug === slug);
      if (!project) throw new Error(`Project "${slug}" not found`);
      return project;
    },
    enabled: !!slug,
    staleTime: 1000 * 30,
  });
}

export function useProjectById(id: string | undefined) {
  return useQuery({
    queryKey: ['project-by-id', id],
    queryFn: async () => {
      const res = await api.get<Project>(`/projects/${id}`);
      return res.data;
    },
    enabled: !!id,
  });
}

export function useCreateProject() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (data: {
      name: string;
      description?: string;
      baseUrl?: string;
      color?: string;
    }) => {
      const res = await api.post<Project>('/projects', data);
      return res.data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['projects'] });
    },
  });
}

export function useUpdateProject(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (data: Partial<Project>) => {
      const res = await api.put<Project>(`/projects/${projectId}`, data);
      return res.data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['projects'] });
      qc.invalidateQueries({ queryKey: ['project-by-id', projectId] });
    },
  });
}

export function useDeleteProject(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      await api.delete(`/projects/${projectId}`);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['projects'] });
    },
  });
}

export function useProjectEnvConfigs(projectId: string | undefined) {
  return useQuery({
    queryKey: ['project-envs', projectId],
    queryFn: async () => {
      const res = await api.get<EnvConfig[]>(`/projects/${projectId}/env-configs`);
      return res.data;
    },
    enabled: !!projectId,
  });
}

export function useProjectMembers(projectId: string | undefined) {
  return useQuery({
    queryKey: ['project-members', projectId],
    queryFn: async () => {
      const res = await api.get<ProjectMember[]>(`/projects/${projectId}/members`);
      return res.data;
    },
    enabled: !!projectId,
  });
}

export function useRequirementDocs(projectId: string | undefined) {
  return useQuery({
    queryKey: ['req-docs', projectId],
    queryFn: async () => {
      const res = await api.get<RequirementDoc[]>(`/projects/${projectId}/req-docs`);
      return res.data;
    },
    enabled: !!projectId,
  });
}
