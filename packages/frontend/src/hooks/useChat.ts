import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import type { ChatMessage, ChatMemory, ChatAttachment } from '../types';

// ── Query keys ─────────────────────────────────────────────────────────────

const chatKey = (projectId: string, conversationId: string) =>
  ['chat', projectId, conversationId] as const;

const memoryKey = (projectId: string) =>
  ['chat-memory', projectId] as const;

// ── Chat history ───────────────────────────────────────────────────────────

export function useChatHistory(projectId: string, conversationId: string) {
  return useQuery({
    queryKey: chatKey(projectId, conversationId),
    queryFn: async () => {
      const res = await api.get<{ messages: ChatMessage[] }>(
        `/projects/${projectId}/chat/history?conversationId=${conversationId}`,
      );
      return res.data.messages;
    },
    enabled: !!projectId && !!conversationId,
    staleTime: 0,
  });
}

// ── Send message ───────────────────────────────────────────────────────────

export function useSendMessage(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      message,
      conversationId,
      attachments,
    }: {
      message: string;
      conversationId: string;
      attachments?: ChatAttachment[];
    }) => {
      const res = await api.post<{
        conversationId: string;
        userMessage: ChatMessage;
        assistantMessage: ChatMessage;
      }>(`/projects/${projectId}/chat/message`, { message, conversationId, attachments });
      return res.data;
    },
    onMutate: async ({ message, conversationId, attachments }) => {
      await qc.cancelQueries({ queryKey: chatKey(projectId, conversationId) });
      const previous = qc.getQueryData<ChatMessage[]>(chatKey(projectId, conversationId));
      const attachmentMeta = attachments?.map(a => ({ name: a.name, mimeType: a.mimeType })) ?? [];
      const optimistic: ChatMessage = {
        id: `opt-${Date.now()}`,
        projectId,
        conversationId,
        role: 'user',
        content: message,
        actionType: null,
        actionPayload: null,
        attachments: attachmentMeta.length > 0 ? JSON.stringify(attachmentMeta) : null,
        createdAt: new Date().toISOString(),
      };
      qc.setQueryData<ChatMessage[]>(
        chatKey(projectId, conversationId),
        (old) => [...(old ?? []), optimistic],
      );
      return { previous, conversationId };
    },
    onError: (_err, _vars, context) => {
      if (context?.previous !== undefined) {
        qc.setQueryData(chatKey(projectId, context.conversationId), context.previous);
      }
    },
    onSuccess: (data) => {
      void qc.invalidateQueries({ queryKey: chatKey(projectId, data.conversationId) });
    },
  });
}

// ── Clear history ──────────────────────────────────────────────────────────

export function useClearHistory(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (conversationId: string) => {
      await api.delete(`/projects/${projectId}/chat/history?conversationId=${conversationId}`);
    },
    onSuccess: (_data, conversationId) => {
      void qc.invalidateQueries({ queryKey: chatKey(projectId, conversationId) });
    },
  });
}

// ── Memory ─────────────────────────────────────────────────────────────────

export function useChatMemory(projectId: string) {
  return useQuery({
    queryKey: memoryKey(projectId),
    queryFn: async () => {
      const res = await api.get<{ memories: ChatMemory[] }>(
        `/projects/${projectId}/chat/memory`,
      );
      return res.data.memories;
    },
    enabled: !!projectId,
    staleTime: 30_000,
  });
}

export function useAddMemory(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (content: string) => {
      const res = await api.post<{ memory: ChatMemory }>(
        `/projects/${projectId}/chat/memory`,
        { content },
      );
      return res.data.memory;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: memoryKey(projectId) });
    },
  });
}

export function useDeleteMemory(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (memoryId: string) => {
      await api.delete(`/projects/${projectId}/chat/memory/${memoryId}`);
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: memoryKey(projectId) });
    },
  });
}
