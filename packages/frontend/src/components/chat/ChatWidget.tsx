import { useState, useEffect, useRef, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import MessageBubble, { TypingIndicator } from './MessageBubble';
import {
  useChatHistory, useStreamMessage,
  useChatMemory, useAddMemory, useDeleteMemory, useClearHistory,
} from '../../hooks/useChat';
import { useProjectStore } from '../../stores/projectStore';
import { useChatSidebarStore } from '../../stores/chatSidebarStore';
import { getInitials } from '../../lib/utils';
import type { ChatAttachment, ChatContext, ChatToolActivity } from '../../types';

// ── Conversation ID — keyed by slug to avoid async Zustand race ───────────

function getConversationId(slug: string): string {
  const key = `qai-conv-${slug}`;
  const existing = localStorage.getItem(key);
  if (existing) return existing;
  const id = `conv-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  localStorage.setItem(key, id);
  return id;
}

// ── Tool activity bubble ───────────────────────────────────────────────────

const TOOL_ICONS: Record<string, string> = {
  generate_script: '⌨',
  fix_script: '🔧',
  create_test_cases: '📋',
  approve_tc: '✅',
  read_script: '📖',
  list_test_cases: '🗂',
  run_tests: '▶',
  get_run_summary: '📊',
  get_failed_tests: '❌',
  get_pending_heals: '⟳',
  schedule_run: '⏰',
  get_project_stats: '📈',
};

function StreamingBubble({ toolActivity }: { toolActivity: ChatToolActivity[] }) {
  return (
    <div style={{ display: 'flex', gap: 10, maxWidth: '90%', alignSelf: 'flex-start' }}>
      <div style={{
        width: 28, height: 28, borderRadius: '50%', flexShrink: 0,
        background: 'linear-gradient(135deg, var(--cyan), var(--violet))',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 12, color: '#fff',
      }}>∞</div>
      <div style={{
        background: 'var(--surface2)', border: '1px solid var(--border)',
        borderRadius: '4px 12px 12px 12px', padding: '8px 12px',
        display: 'flex', flexDirection: 'column', gap: 4,
      }}>
        {toolActivity.length === 0 && <TypingIndicator />}
        {toolActivity.map((a, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11 }}>
            <span>{TOOL_ICONS[a.name] ?? '⚙'}</span>
            <span style={{ color: 'var(--text-mid)' }}>{a.label}</span>
            {a.status === 'running'
              ? <span style={{ color: 'var(--cyan)', fontSize: 9 }}>●</span>
              : <span style={{ color: 'var(--pass)', fontSize: 9 }}>✓</span>}
          </div>
        ))}
      </div>
    </div>
  );
}

// ── File helpers ───────────────────────────────────────────────────────────

const ACCEPTED_TYPES = 'image/png,image/jpeg,image/webp,image/gif,text/plain,text/csv,text/html,application/json';
const MAX_FILE_BYTES = 4 * 1024 * 1024;

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve((reader.result as string).split(',')[1]);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function AttachmentChip({ name, mimeType, onRemove }: { name: string; mimeType: string; onRemove: () => void }) {
  return (
    <div style={{
      display: 'inline-flex', alignItems: 'center', gap: 5,
      padding: '3px 8px', borderRadius: 20,
      background: 'var(--surface)', border: '1px solid var(--border)',
      fontSize: 10, color: 'var(--text-mid)', maxWidth: 140,
    }}>
      <span>{mimeType.startsWith('image/') ? '🖼' : '📄'}</span>
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>{name}</span>
      <button
        onClick={onRemove}
        style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-dim)', padding: 0, fontSize: 11 }}
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
    try { await addMemory.mutateAsync(text); setDraft(''); }
    catch { toast.error('Failed to save memory'); }
  }

  return (
    <div style={{
      position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
      background: 'var(--surface)', zIndex: 10,
      display: 'flex', flexDirection: 'column',
    }}>
      <div style={{
        padding: '10px 14px', borderBottom: '1px solid var(--border)',
        background: 'var(--surface2)', display: 'flex', alignItems: 'center',
        gap: 8, flexShrink: 0,
      }}>
        <span style={{ fontSize: 14 }}>🧠</span>
        <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text)', flex: 1 }}>Persistent Memory</span>
        <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-dim)', fontSize: 14 }}>✕</button>
      </div>
      <div style={{ padding: '6px 10px 4px', flexShrink: 0 }}>
        <p style={{ fontSize: 10, color: 'var(--text-dim)', margin: 0, lineHeight: 1.5 }}>
          Facts here are injected into every message so the agent always remembers them.
        </p>
      </div>
      <div style={{ flex: 1, overflowY: 'auto', padding: '6px 12px', display: 'flex', flexDirection: 'column', gap: 6 }}>
        {isLoading && <span style={{ fontSize: 11, color: 'var(--text-dim)' }}>Loading…</span>}
        {!isLoading && memories.length === 0 && (
          <span style={{ fontSize: 11, color: 'var(--text-dim)', fontStyle: 'italic' }}>No memories yet.</span>
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
            >🗑</button>
          </div>
        ))}
      </div>
      <div style={{ padding: '10px 12px', borderTop: '1px solid var(--border)', background: 'var(--surface2)', flexShrink: 0 }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
          <textarea
            value={draft}
            onChange={e => setDraft(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void handleAdd(); } }}
            placeholder='"Always use QA environment" or "TC prefix is VEN-"'
            rows={2}
            style={{
              flex: 1, background: 'var(--bg)', border: '1px solid var(--border)',
              borderRadius: 8, padding: '7px 10px', fontSize: 11,
              color: 'var(--text)', fontFamily: 'var(--font-ui)', resize: 'none', outline: 'none', lineHeight: 1.5,
            }}
          />
          <button
            onClick={() => void handleAdd()}
            disabled={!draft.trim() || addMemory.isPending}
            style={{
              padding: '7px 12px', background: 'var(--cyan)', border: 'none',
              borderRadius: 8, color: 'var(--bg)', fontSize: 11, fontWeight: 700,
              cursor: !draft.trim() ? 'not-allowed' : 'pointer',
              opacity: !draft.trim() ? 0.5 : 1, fontFamily: 'var(--font-ui)',
            }}
          >Save</button>
        </div>
      </div>
    </div>
  );
}

// ── Quick commands ─────────────────────────────────────────────────────────

const QUICK_CMDS = [
  { label: '▶ Smoke tests', text: 'Run the smoke tests on QA environment' },
  { label: '📊 Last run', text: 'Show me the summary of the most recent run including pass rate.' },
  { label: '🔧 Pending heals', text: 'Show all pending heal proposals that need my approval.' },
  { label: '📈 Project stats', text: 'Show me the overall project stats and health.' },
];

// ── Main sidebar widget ────────────────────────────────────────────────────
// Rendered as a natural flex child in AppShell — pushes content, not an overlay.

export default function ChatWidget() {
  const { mode, pendingPrompt, pendingContext, clearPending, minimize, expand, toggle } = useChatSidebarStore();
  const { slug } = useParams<{ slug?: string }>();
  const { activeProject, currentUser } = useProjectStore();
  const projectId = activeProject?.id ?? '';

  const [showMemory, setShowMemory] = useState(false);
  const [input, setInput] = useState('');
  const [attachments, setAttachments] = useState<ChatAttachment[]>([]);
  const [context, setContext] = useState<ChatContext | undefined>();
  const [unreadCount, setUnreadCount] = useState(0);
  const prevMsgCount = useRef(0);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const effectiveSlug = slug ?? 'global';
  const [conversationId] = useState(() => getConversationId(effectiveSlug));

  const { data: messages = [] } = useChatHistory(projectId, conversationId);
  const { data: memories = [] } = useChatMemory(projectId);
  const { send: streamSend, isStreaming, toolActivity } = useStreamMessage(projectId);
  const clearHistory = useClearHistory(projectId);
  const userInitials = currentUser ? getInitials(currentUser.name) : 'U';

  function handleClearHistory() {
    if (!window.confirm('Clear this conversation? This cannot be undone.')) return;
    clearHistory.mutate(conversationId);
  }

  // Apply pending context when expanded via openChat()
  useEffect(() => {
    if (mode === 'expanded' && (pendingPrompt !== undefined || pendingContext !== undefined)) {
      if (pendingPrompt) setInput(pendingPrompt);
      if (pendingContext) setContext(pendingContext);
      clearPending();
      setTimeout(() => textareaRef.current?.focus(), 150);
    }
  }, [mode, pendingPrompt, pendingContext, clearPending]);

  // Unread badge when minimized
  useEffect(() => {
    if (mode === 'minimized' && messages.length > prevMsgCount.current) {
      setUnreadCount(u => u + (messages.length - prevMsgCount.current));
    }
    prevMsgCount.current = messages.length;
  }, [messages.length, mode]);

  useEffect(() => {
    if (mode === 'expanded') setUnreadCount(0);
  }, [mode]);

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  useEffect(() => {
    if (mode === 'expanded') scrollToBottom();
  }, [messages.length, isStreaming, mode, scrollToBottom]);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
  }, [input]);

  async function handleFilePick(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    e.target.value = '';
    for (const file of files.slice(0, 5 - attachments.length)) {
      if (file.size > MAX_FILE_BYTES) { toast.error(`${file.name} exceeds 4 MB`); continue; }
      try {
        const data = await fileToBase64(file);
        setAttachments(prev => [...prev, { name: file.name, mimeType: file.type, data }]);
      } catch { toast.error(`Failed to read ${file.name}`); }
    }
  }

  async function handleSend() {
    const text = input.trim();
    if (!text || isStreaming || !projectId) return;
    const atts = [...attachments];
    setInput('');
    setAttachments([]);
    try {
      await streamSend({ message: text, conversationId, attachments: atts.length > 0 ? atts : undefined, currentContext: context });
    } catch {
      toast.error('Failed to send message. Check your AI configuration.');
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void handleSend(); }
  }

  const isExpanded = mode === 'expanded';

  const displayMessages = messages.length === 0 ? [{
    id: 'welcome',
    projectId,
    conversationId,
    role: 'assistant' as const,
    content: `Hi! I'm your QA Agent. Ask me to generate scripts, create test cases, run tests, or manage heals.`,
    actionType: null,
    actionPayload: null,
    createdAt: new Date().toISOString(),
  }] : messages;

  return (
    <>
      <style>{`
        @keyframes chat-width-expand {
          from { width: 40px; }
          to   { width: 380px; }
        }
        .chat-sidebar-input:focus { border-color: var(--cyan) !important; outline: none; }
        .chat-sidebar-quick:hover { border-color: var(--cyan) !important; color: var(--cyan) !important; }
        .chat-strip-btn:hover { background: rgba(99,102,241,0.10) !important; }
      `}</style>

      <input
        ref={fileInputRef}
        type="file"
        accept={ACCEPTED_TYPES}
        multiple
        style={{ display: 'none' }}
        onChange={handleFilePick}
      />

      <div
        style={{
          width: isExpanded ? 380 : 40,
          flexShrink: 0,
          height: '100%',
          borderLeft: '1px solid var(--border)',
          background: 'var(--surface)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          transition: 'width 0.22s cubic-bezier(0.4, 0, 0.2, 1)',
          position: 'relative',
        }}
      >
        {/* ── Minimized strip ─────────────────────────────────── */}
        {!isExpanded && (
          <div
            onClick={expand}
            title="Open QA Agent"
            style={{
              width: 40,
              height: '100%',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              paddingTop: 14,
              gap: 12,
              cursor: 'pointer',
              userSelect: 'none',
            }}
          >
            {/* Icon with optional unread badge */}
            <div style={{ position: 'relative', flexShrink: 0 }}>
              <div style={{
                width: 28,
                height: 28,
                borderRadius: '50%',
                background: 'linear-gradient(135deg, #2563AB, #0A2A57)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 14,
                color: '#fff',
              }}>∞</div>
              {unreadCount > 0 && (
                <span style={{
                  position: 'absolute', top: -4, right: -4,
                  width: 15, height: 15, borderRadius: '50%',
                  background: 'var(--fail)', fontSize: 8, fontWeight: 700,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  color: '#fff', border: '2px solid var(--surface)',
                }}>
                  {unreadCount > 9 ? '9+' : unreadCount}
                </span>
              )}
            </div>

            {/* Rotated label */}
            <span style={{
              fontSize: 9,
              fontWeight: 700,
              color: 'var(--text-dim)',
              textTransform: 'uppercase',
              letterSpacing: '1.5px',
              writingMode: 'vertical-rl',
              transform: 'rotate(180deg)',
              whiteSpace: 'nowrap',
              fontFamily: 'var(--font-mono)',
            }}>
              QA Agent
            </span>
          </div>
        )}

        {/* ── Expanded panel ──────────────────────────────────── */}
        {isExpanded && (
          <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
            {/* Header */}
            <div style={{
              padding: '10px 14px',
              borderBottom: '1px solid var(--border)',
              background: 'var(--surface2)',
              display: 'flex',
              alignItems: 'center',
              gap: 9,
              flexShrink: 0,
            }}>
              <div style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--pass)', flexShrink: 0 }} />
              <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text)' }}>QA Agent</span>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--text-dim)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {activeProject?.name ?? 'no project'}
              </span>

              {/* Memory */}
              <button
                onClick={() => setShowMemory(true)}
                title="Manage memory"
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-dim)', fontSize: 14, padding: '0 2px', position: 'relative', transition: 'color 0.15s' }}
                onMouseEnter={e => (e.currentTarget.style.color = 'var(--cyan)')}
                onMouseLeave={e => (e.currentTarget.style.color = 'var(--text-dim)')}
              >
                🧠
                {memories.length > 0 && (
                  <span style={{ position: 'absolute', top: -4, right: -4, width: 14, height: 14, borderRadius: '50%', background: 'var(--cyan)', fontSize: 8, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--bg)' }}>
                    {memories.length}
                  </span>
                )}
              </button>

              {/* Clear history */}
              <button
                onClick={handleClearHistory}
                disabled={messages.length === 0 || clearHistory.isPending}
                title="Clear conversation history"
                style={{
                  background: 'none', border: 'none',
                  cursor: messages.length === 0 || clearHistory.isPending ? 'not-allowed' : 'pointer',
                  color: 'var(--text-dim)', fontSize: 13, padding: '0 2px',
                  opacity: messages.length === 0 ? 0.4 : 1, transition: 'color 0.15s',
                }}
                onMouseEnter={e => { if (messages.length > 0) (e.currentTarget as HTMLButtonElement).style.color = 'var(--fail)'; }}
                onMouseLeave={e => (e.currentTarget as HTMLButtonElement).style.color = 'var(--text-dim)'}
              >🗑</button>

              {/* Collapse to strip */}
              <button
                onClick={minimize}
                title="Collapse to strip"
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-dim)', fontSize: 14, padding: '0 2px', transition: 'color 0.15s', lineHeight: 1 }}
                onMouseEnter={e => (e.currentTarget.style.color = 'var(--text)')}
                onMouseLeave={e => (e.currentTarget.style.color = 'var(--text-dim)')}
              >›</button>
            </div>

            {/* Context chip */}
            {context && (
              <div style={{
                padding: '5px 14px', borderBottom: '1px solid var(--border)',
                display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0,
                background: 'rgba(99,102,241,0.06)',
              }}>
                <span style={{ fontSize: 9, fontFamily: 'var(--font-mono)', color: 'var(--violet)', textTransform: 'uppercase', letterSpacing: 1, flexShrink: 0 }}>
                  {context.page ?? 'ctx'}
                </span>
                <span style={{ fontSize: 11, color: 'var(--text-mid)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {context.tcId} — {context.tcTitle}
                </span>
                <button onClick={() => setContext(undefined)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-dim)', fontSize: 11, padding: 0, flexShrink: 0 }}>✕</button>
              </div>
            )}

            {/* Quick commands */}
            <div style={{ display: 'flex', gap: 5, padding: '6px 12px', borderBottom: '1px solid var(--border)', overflowX: 'auto', flexShrink: 0 }}>
              {QUICK_CMDS.map(cmd => (
                <button
                  key={cmd.label}
                  className="chat-sidebar-quick"
                  onClick={() => { setInput(cmd.text); textareaRef.current?.focus(); }}
                  style={{
                    padding: '3px 8px', background: 'var(--surface2)',
                    border: '1px solid var(--border)', borderRadius: 20,
                    fontSize: 10, color: 'var(--text-mid)', cursor: 'pointer',
                    whiteSpace: 'nowrap', fontFamily: 'var(--font-ui)', transition: 'all 0.12s',
                  }}
                >{cmd.label}</button>
              ))}
            </div>

            {/* Messages */}
            <div style={{ flex: 1, overflowY: 'auto', padding: '12px 12px', display: 'flex', flexDirection: 'column', gap: 12, minHeight: 0 }}>
              {displayMessages.map(msg => (
                <MessageBubble key={msg.id} message={msg} userInitials={userInitials} />
              ))}
              {isStreaming && <StreamingBubble toolActivity={toolActivity} />}
              <div ref={messagesEndRef} />
            </div>

            {/* Attachments */}
            {attachments.length > 0 && (
              <div style={{ padding: '6px 12px', borderTop: '1px solid var(--border)', display: 'flex', flexWrap: 'wrap', gap: 5, flexShrink: 0, background: 'var(--surface2)' }}>
                {attachments.map((a, i) => (
                  <AttachmentChip key={i} name={a.name} mimeType={a.mimeType} onRemove={() => setAttachments(prev => prev.filter((_, j) => j !== i))} />
                ))}
              </div>
            )}

            {/* Input row */}
            <div style={{ borderTop: '1px solid var(--border)', padding: '10px 12px', display: 'flex', gap: 8, alignItems: 'flex-end', background: 'var(--surface2)', flexShrink: 0 }}>
              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={attachments.length >= 5}
                title="Attach file"
                style={{ background: 'none', border: 'none', cursor: attachments.length >= 5 ? 'not-allowed' : 'pointer', color: 'var(--text-dim)', fontSize: 16, padding: '0 2px', opacity: attachments.length >= 5 ? 0.4 : 1, flexShrink: 0, transition: 'color 0.15s' }}
                onMouseEnter={e => { if (attachments.length < 5) (e.currentTarget as HTMLButtonElement).style.color = 'var(--cyan)'; }}
                onMouseLeave={e => (e.currentTarget as HTMLButtonElement).style.color = 'var(--text-dim)'}
              >📎</button>

              <textarea
                ref={textareaRef}
                className="chat-sidebar-input"
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={attachments.length > 0 ? 'Describe the attachment…' : 'Ask anything…'}
                rows={1}
                style={{
                  flex: 1, background: 'var(--bg)', border: '1px solid var(--border)',
                  borderRadius: 8, padding: '8px 10px', fontFamily: 'var(--font-ui)',
                  fontSize: 12, color: 'var(--text)', resize: 'none',
                  minHeight: 36, maxHeight: 120, lineHeight: 1.5, transition: 'border-color 0.15s',
                }}
              />

              <button
                onClick={() => void handleSend()}
                disabled={(!input.trim() && attachments.length === 0) || isStreaming}
                style={{
                  width: 32, height: 32, background: 'var(--cyan)', border: 'none',
                  borderRadius: 8, color: 'var(--bg)', fontSize: 15,
                  cursor: (!input.trim() && attachments.length === 0) || isStreaming ? 'not-allowed' : 'pointer',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                  opacity: (!input.trim() && attachments.length === 0) || isStreaming ? 0.5 : 1,
                  transition: 'opacity 0.15s',
                }}
              >↑</button>
            </div>

            {/* Memory overlay */}
            {showMemory && projectId && (
              <MemoryPanel projectId={projectId} onClose={() => setShowMemory(false)} />
            )}
          </div>
        )}
      </div>
    </>
  );
}
