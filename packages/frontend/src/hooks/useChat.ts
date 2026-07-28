import { useState, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { getToken } from '../lib/auth';
import type { ChatMessage, ChatMemory, ChatAttachment, ChatContext, ChatToolActivity } from '../types';

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

// ── Streaming message hook ─────────────────────────────────────────────────

interface StreamDoneEvent {
  type: 'done';
  conversationId: string;
  userMessageId: string;
  assistantMessageId: string;
  reply: string;
  actionType: string | null;
  actionPayload: Record<string, unknown> | null;
}

export function useStreamMessage(projectId: string) {
  const qc = useQueryClient();
  const [isStreaming, setIsStreaming] = useState(false);
  const [toolActivity, setToolActivity] = useState<ChatToolActivity[]>([]);

  const send = useCallback(async (params: {
    message: string;
    conversationId: string;
    attachments?: ChatAttachment[];
    currentContext?: ChatContext;
  }): Promise<void> => {
    const { message, conversationId, attachments, currentContext } = params;

    // Optimistic user message
    const optimistic: ChatMessage = {
      id: `opt-${Date.now()}`,
      projectId,
      conversationId,
      role: 'user',
      content: message,
      actionType: null,
      actionPayload: null,
      attachments: attachments?.length
        ? JSON.stringify(attachments.map(a => ({ name: a.name, mimeType: a.mimeType })))
        : null,
      createdAt: new Date().toISOString(),
    };
    qc.setQueryData<ChatMessage[]>(chatKey(projectId, conversationId), old => [...(old ?? []), optimistic]);

    setIsStreaming(true);
    setToolActivity([]);

    try {
      const token = getToken();
      const resp = await fetch(`/api/projects/${projectId}/chat/stream`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ message, conversationId, attachments, currentContext }),
      });

      if (!resp.ok || !resp.body) {
        throw new Error(`Stream request failed: ${resp.status}`);
      }

      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const parts = buf.split('\n\n');
        buf = parts.pop() ?? '';
        for (const part of parts) {
          if (!part.startsWith('data: ')) continue;
          try {
            const event = JSON.parse(part.slice(6)) as { type: string; name?: string; label?: string } | StreamDoneEvent;
            if (event.type === 'tool_start' && 'name' in event) {
              setToolActivity(prev => [
                ...prev,
                { name: event.name!, label: event.label ?? event.name!, status: 'running' },
              ]);
            } else if (event.type === 'tool_done' && 'name' in event) {
              setToolActivity(prev =>
                prev.map(e => e.name === event.name ? { ...e, status: 'done' } : e),
              );
            } else if (event.type === 'done') {
              const done = event as StreamDoneEvent;
              // Append both persisted messages to cache
              const assistant: ChatMessage = {
                id: done.assistantMessageId,
                projectId,
                conversationId: done.conversationId,
                role: 'assistant',
                content: done.reply,
                actionType: done.actionType,
                actionPayload: done.actionPayload ? JSON.stringify(done.actionPayload) : null,
                createdAt: new Date().toISOString(),
              };
              qc.setQueryData<ChatMessage[]>(
                chatKey(projectId, conversationId),
                old => {
                  // Replace optimistic user message + add assistant reply
                  const withoutOpt = (old ?? []).filter(m => !m.id.startsWith('opt-'));
                  const userMsg: ChatMessage = {
                    id: done.userMessageId,
                    projectId,
                    conversationId: done.conversationId,
                    role: 'user',
                    content: message,
                    actionType: null,
                    actionPayload: null,
                    attachments: optimistic.attachments,
                    createdAt: optimistic.createdAt,
                  };
                  return [...withoutOpt, userMsg, assistant];
                },
              );
            }
          } catch { /* skip malformed events */ }
        }
      }
    } catch (err) {
      // Rollback optimistic update on error
      qc.setQueryData<ChatMessage[]>(
        chatKey(projectId, conversationId),
        old => (old ?? []).filter(m => !m.id.startsWith('opt-')),
      );
      throw err;
    } finally {
      setIsStreaming(false);
      setToolActivity([]);
    }
  }, [projectId, qc]);

  return { send, isStreaming, toolActivity };
}
