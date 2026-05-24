import { useState, useEffect, useRef, useCallback } from 'react';
import toast from 'react-hot-toast';
import MessageBubble, { TypingIndicator } from './MessageBubble';
import {
  useChatHistory, useSendMessage,
  useChatMemory, useAddMemory, useDeleteMemory,
} from '../../hooks/useChat';
import { useProjectStore } from '../../stores/projectStore';
import { getInitials } from '../../lib/utils';
import type { ChatMessage, ChatAttachment } from '../../types';

// ── Conversation ID ────────────────────────────────────────────────────────

function getConversationId(projectId: string): string {
  const key = `qai-conv-${projectId}`;
  const existing = localStorage.getItem(key);
  if (existing) return existing;
  const id = `conv-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  localStorage.setItem(key, id);
  return id;
}

// ── Supported file types ───────────────────────────────────────────────────

const ACCEPTED_TYPES = 'image/png,image/jpeg,image/webp,image/gif,text/plain,text/csv,text/html,application/json';
const MAX_FILE_BYTES = 4 * 1024 * 1024; // 4 MB per file

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve((reader.result as string).split(',')[1]);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// ── Attachment chip ────────────────────────────────────────────────────────

function AttachmentChip({ name, mimeType, onRemove }: { name: string; mimeType: string; onRemove: () => void }) {
  const isImage = mimeType.startsWith('image/');
  return (
    <div style={{
      display: 'inline-flex', alignItems: 'center', gap: 5,
      padding: '3px 8px', borderRadius: 20,
      background: 'var(--surface)', border: '1px solid var(--border)',
      fontSize: 10, color: 'var(--text-mid)', maxWidth: 140,
    }}>
      <span>{isImage ? '🖼' : '📄'}</span>
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>{name}</span>
      <button
        onClick={onRemove}
        style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-dim)', padding: 0, fontSize: 11, lineHeight: 1 }}
      >✕</button>
    </div>
  );
}

// ── Memory panel ───────────────────────────────────────────────────────────

function MemoryPanel({ projectId, onClose }: { projectId: string; onClose: () => void }) {
  const { data: memories = [], isLoading } = useChatMemory(projectId);
  const addMemory = useAddMemory(projectId);
  const deleteMemory = useDeleteMemory(projectId);
  const [draft, setDraft] = useState('');

  async function handleAdd() {
    const text = draft.trim();
    if (!text) return;
    try {
      await addMemory.mutateAsync(text);
      setDraft('');
    } catch {
      toast.error('Failed to save memory');
    }
  }

  return (
    <div style={{
      position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
      background: 'var(--surface)', zIndex: 10,
      display: 'flex', flexDirection: 'column',
      borderRadius: 14,
    }}>
      {/* Header */}
      <div style={{
        padding: '10px 14px', borderBottom: '1px solid var(--border)',
        background: 'var(--surface2)', display: 'flex', alignItems: 'center',
        gap: 8, flexShrink: 0, borderRadius: '14px 14px 0 0',
      }}>
        <span style={{ fontSize: 14 }}>🧠</span>
        <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text)', flex: 1 }}>Persistent Memory</span>
        <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-dim)', fontSize: 14 }}>✕</button>
      </div>

      <div style={{ padding: '6px 10px 4px', flexShrink: 0 }}>
        <p style={{ fontSize: 10, color: 'var(--text-dim)', margin: 0, lineHeight: 1.5 }}>
          Facts saved here are injected into every message you send, so the agent always remembers them.
        </p>
      </div>

      {/* Memory list */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '6px 12px', display: 'flex', flexDirection: 'column', gap: 6 }}>
        {isLoading && <span style={{ fontSize: 11, color: 'var(--text-dim)' }}>Loading…</span>}
        {!isLoading && memories.length === 0 && (
          <span style={{ fontSize: 11, color: 'var(--text-dim)', fontStyle: 'italic' }}>No memories yet. Add one below.</span>
        )}
        {memories.map(m => (
          <div key={m.id} style={{
            display: 'flex', alignItems: 'flex-start', gap: 8,
            padding: '7px 10px', background: 'var(--surface2)',
            border: '1px solid var(--border)', borderRadius: 8,
          }}>
            <span style={{ fontSize: 10, color: 'var(--cyan)', marginTop: 1, flexShrink: 0 }}>◆</span>
            <span style={{ flex: 1, fontSize: 11, color: 'var(--text)', lineHeight: 1.5, wordBreak: 'break-word' }}>{m.content}</span>
            <button
              onClick={() => void deleteMemory.mutateAsync(m.id)}
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-dim)', fontSize: 12, flexShrink: 0, padding: 0 }}
              title="Delete memory"
            >🗑</button>
          </div>
        ))}
      </div>

      {/* Add new memory */}
      <div style={{ padding: '10px 12px', borderTop: '1px solid var(--border)', background: 'var(--surface2)', flexShrink: 0, borderRadius: '0 0 14px 14px' }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
          <textarea
            value={draft}
            onChange={e => setDraft(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void handleAdd(); } }}
            placeholder='e.g. "Always use QA environment" or "TC prefix is VEN-"'
            rows={2}
            style={{
              flex: 1, background: 'var(--bg)', border: '1px solid var(--border)',
              borderRadius: 8, padding: '7px 10px', fontSize: 11,
              color: 'var(--text)', fontFamily: 'var(--font-ui)', resize: 'none',
              outline: 'none', lineHeight: 1.5,
            }}
          />
          <button
            onClick={() => void handleAdd()}
            disabled={!draft.trim() || addMemory.isPending}
            style={{
              padding: '7px 12px', background: 'var(--cyan)', border: 'none',
              borderRadius: 8, color: 'var(--bg)', fontSize: 11, fontWeight: 700,
              cursor: !draft.trim() ? 'not-allowed' : 'pointer',
              opacity: !draft.trim() ? 0.5 : 1,
              fontFamily: 'var(--font-ui)',
            }}
          >Save</button>
        </div>
      </div>
    </div>
  );
}

// ── Quick commands ─────────────────────────────────────────────────────────

const QUICK_CMDS = [
  { label: '▶ Run smoke tests', text: 'Run the smoke tests on QA environment' },
  { label: '📊 Last run summary', text: 'Show me the summary of the most recent run including pass rate.' },
  { label: '🔧 Pending heals', text: 'Show all pending heal proposals that need my approval.' },
  { label: '⚙️ Project stats', text: 'Show me the overall project stats and health.' },
];

// ── Main widget ────────────────────────────────────────────────────────────

export default function ChatWidget() {
  const { activeProject, currentUser } = useProjectStore();
  const projectId = activeProject?.id ?? '';

  const [open, setOpen] = useState(false);
  const [showMemory, setShowMemory] = useState(false);
  const [input, setInput] = useState('');
  const [attachments, setAttachments] = useState<ChatAttachment[]>([]);
  const [isTyping, setIsTyping] = useState(false);
  const [unread, setUnread] = useState(0);
  const [conversationId] = useState(() =>
    projectId ? getConversationId(projectId) : `conv-${Date.now()}`,
  );

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const prevCountRef = useRef(0);

  const { data: messages = [] } = useChatHistory(projectId, conversationId);
  const { data: memories = [] } = useChatMemory(projectId);
  const sendMessage = useSendMessage(projectId);
  const userInitials = currentUser ? getInitials(currentUser.name) : 'U';

  const welcomeMessages: ChatMessage[] = messages.length === 0 ? [{
    id: 'welcome',
    projectId,
    conversationId,
    role: 'assistant',
    content: `Hi! I'm your QA Agent. Ask me to run tests, check failures, show stats, or manage heals.`,
    actionType: null,
    actionPayload: null,
    createdAt: new Date().toISOString(),
  }] : messages;

  // Unread badge tracking
  useEffect(() => {
    if (!open && messages.length > prevCountRef.current) {
      setUnread(u => u + (messages.length - prevCountRef.current));
    }
    prevCountRef.current = messages.length;
  }, [messages.length, open]);

  useEffect(() => { if (open) setUnread(0); }, [open]);

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  useEffect(() => {
    if (open) scrollToBottom();
  }, [welcomeMessages.length, isTyping, open, scrollToBottom]);

  // Auto-resize textarea
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 100)}px`;
  }, [input]);

  async function handleFilePick(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    e.target.value = '';
    const remaining = 5 - attachments.length;
    for (const file of files.slice(0, remaining)) {
      if (file.size > MAX_FILE_BYTES) {
        toast.error(`${file.name} exceeds 4 MB limit`);
        continue;
      }
      try {
        const data = await fileToBase64(file);
        setAttachments(prev => [...prev, { name: file.name, mimeType: file.type, data }]);
      } catch {
        toast.error(`Failed to read ${file.name}`);
      }
    }
  }

  async function handleSend() {
    const text = input.trim();
    if (!text || sendMessage.isPending || isTyping || !projectId) return;
    const atts = [...attachments];
    setInput('');
    setAttachments([]);
    setIsTyping(true);
    try {
      await sendMessage.mutateAsync({ message: text, conversationId, attachments: atts.length > 0 ? atts : undefined });
    } catch {
      toast.error('Failed to send message. Check your AI configuration.');
    } finally {
      setIsTyping(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void handleSend();
    }
  }

  if (!projectId) return null;

  return (
    <>
      <style>{`
        @keyframes typing-dot {
          0%, 60%, 100% { opacity: 0.3; transform: translateY(0); }
          30% { opacity: 1; transform: translateY(-3px); }
        }
        @keyframes widget-pop {
          from { opacity: 0; transform: scale(0.92) translateY(12px); }
          to   { opacity: 1; transform: scale(1)    translateY(0); }
        }
        .chat-widget-panel { animation: widget-pop 0.18s ease-out; }
        .chat-widget-input:focus { border-color: var(--cyan) !important; outline: none; }
        .chat-quick-btn:hover { border-color: var(--cyan) !important; color: var(--cyan) !important; }
        .chat-attach-btn:hover { color: var(--cyan) !important; }
        .chat-memory-btn:hover { color: var(--cyan) !important; }
      `}</style>

      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        accept={ACCEPTED_TYPES}
        multiple
        style={{ display: 'none' }}
        onChange={handleFilePick}
      />

      {/* Floating toggle button */}
      <button
        onClick={() => setOpen(o => !o)}
        title="QA Agent"
        style={{
          position: 'fixed', bottom: 24, right: 24, zIndex: 10000,
          width: 52, height: 52, borderRadius: '50%',
          background: open ? 'var(--surface2)' : 'linear-gradient(135deg, #2563AB, #0A2A57)',
          border: open ? '1px solid var(--border)' : 'none',
          boxShadow: '0 4px 20px rgba(0,0,0,0.4)',
          cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: open ? 18 : 22, color: '#fff', transition: 'all 0.2s',
        }}
      >
        {open ? '✕' : '💬'}
        {!open && unread > 0 && (
          <span style={{
            position: 'absolute', top: -4, right: -4, width: 18, height: 18,
            borderRadius: '50%', background: 'var(--fail)', fontSize: 10, fontWeight: 700,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: '#fff', border: '2px solid var(--bg)',
          }}>
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>

      {/* Chat panel */}
      {open && (
        <div
          className="chat-widget-panel"
          style={{
            position: 'fixed', bottom: 86, right: 24, zIndex: 9999,
            width: 390, height: 540,
            background: 'var(--surface)', border: '1px solid var(--border)',
            borderRadius: 14, boxShadow: '0 8px 40px rgba(0,0,0,0.5)',
            display: 'flex', flexDirection: 'column', overflow: 'hidden',
          }}
        >
          {/* Header */}
          <div style={{
            padding: '10px 14px', borderBottom: '1px solid var(--border)',
            background: 'var(--surface2)', display: 'flex', alignItems: 'center',
            gap: 9, flexShrink: 0,
          }}>
            <div style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--pass)', flexShrink: 0 }} />
            <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text)' }}>QA Agent</span>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--text-dim)', flex: 1 }}>
              claude-sonnet · {activeProject?.name}
            </span>
            {/* Memory button with badge */}
            <button
              className="chat-memory-btn"
              onClick={() => setShowMemory(true)}
              title="Manage memory"
              style={{
                background: 'none', border: 'none', cursor: 'pointer',
                color: 'var(--text-dim)', fontSize: 14, padding: '0 2px',
                display: 'flex', alignItems: 'center', gap: 3, transition: 'color 0.15s',
                position: 'relative',
              }}
            >
              🧠
              {memories.length > 0 && (
                <span style={{
                  position: 'absolute', top: -4, right: -4,
                  width: 14, height: 14, borderRadius: '50%',
                  background: 'var(--cyan)', fontSize: 8, fontWeight: 700,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  color: 'var(--bg)',
                }}>
                  {memories.length}
                </span>
              )}
            </button>
          </div>

          {/* Quick commands strip */}
          <div style={{
            display: 'flex', gap: 6, padding: '7px 12px',
            borderBottom: '1px solid var(--border)', overflowX: 'auto', flexShrink: 0,
          }}>
            {QUICK_CMDS.map(cmd => (
              <button
                key={cmd.label}
                className="chat-quick-btn"
                onClick={() => { setInput(cmd.text); textareaRef.current?.focus(); }}
                style={{
                  padding: '4px 9px', background: 'var(--surface2)',
                  border: '1px solid var(--border)', borderRadius: 20,
                  fontSize: 10, color: 'var(--text-mid)', cursor: 'pointer',
                  whiteSpace: 'nowrap', fontFamily: 'var(--font-ui)', transition: 'all 0.12s',
                }}
              >{cmd.label}</button>
            ))}
          </div>

          {/* Messages */}
          <div style={{
            flex: 1, overflowY: 'auto', padding: '14px 12px',
            display: 'flex', flexDirection: 'column', gap: 12, minHeight: 0,
          }}>
            {welcomeMessages.map(msg => (
              <MessageBubble key={msg.id} message={msg} userInitials={userInitials} />
            ))}
            {isTyping && <TypingIndicator />}
            <div ref={messagesEndRef} />
          </div>

          {/* Attachment previews */}
          {attachments.length > 0 && (
            <div style={{
              padding: '6px 12px', borderTop: '1px solid var(--border)',
              display: 'flex', flexWrap: 'wrap', gap: 5, flexShrink: 0,
              background: 'var(--surface2)',
            }}>
              {attachments.map((a, i) => (
                <AttachmentChip
                  key={i}
                  name={a.name}
                  mimeType={a.mimeType}
                  onRemove={() => setAttachments(prev => prev.filter((_, j) => j !== i))}
                />
              ))}
            </div>
          )}

          {/* Input row */}
          <div style={{
            borderTop: '1px solid var(--border)', padding: '10px 12px',
            display: 'flex', gap: 8, alignItems: 'flex-end',
            background: 'var(--surface2)', flexShrink: 0,
          }}>
            {/* Attach button */}
            <button
              className="chat-attach-btn"
              onClick={() => fileInputRef.current?.click()}
              disabled={attachments.length >= 5}
              title="Attach file (image, CSV, TXT, JSON, HTML)"
              style={{
                background: 'none', border: 'none', cursor: attachments.length >= 5 ? 'not-allowed' : 'pointer',
                color: 'var(--text-dim)', fontSize: 16, padding: '0 2px',
                transition: 'color 0.15s', flexShrink: 0,
                opacity: attachments.length >= 5 ? 0.4 : 1,
              }}
            >📎</button>

            <textarea
              ref={textareaRef}
              className="chat-widget-input"
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={attachments.length > 0 ? 'Describe the attachment…' : 'Ask anything…'}
              rows={1}
              style={{
                flex: 1, background: 'var(--bg)', border: '1px solid var(--border)',
                borderRadius: 8, padding: '8px 12px', fontFamily: 'var(--font-ui)',
                fontSize: 12, color: 'var(--text)', resize: 'none',
                minHeight: 36, maxHeight: 100, lineHeight: 1.5, transition: 'border-color 0.15s',
              }}
            />

            <button
              onClick={() => void handleSend()}
              disabled={(!input.trim() && attachments.length === 0) || isTyping || sendMessage.isPending}
              style={{
                width: 34, height: 34, background: 'var(--cyan)', border: 'none',
                borderRadius: 8, color: 'var(--bg)', fontSize: 15,
                cursor: (!input.trim() && attachments.length === 0) || isTyping ? 'not-allowed' : 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                flexShrink: 0,
                opacity: (!input.trim() && attachments.length === 0) || isTyping ? 0.5 : 1,
                transition: 'opacity 0.15s',
              }}
            >↑</button>
          </div>

          {/* Memory overlay panel */}
          {showMemory && (
            <MemoryPanel projectId={projectId} onClose={() => setShowMemory(false)} />
          )}
        </div>
      )}
    </>
  );
}
