import { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import Topbar, { TbBtn } from '../components/layout/Topbar';
import MessageBubble, { TypingIndicator } from '../components/chat/MessageBubble';
import {
  useChatHistory, useSendMessage, useClearHistory,
  useChatMemory, useAddMemory, useDeleteMemory,
} from '../hooks/useChat';
import { useProjectStore } from '../stores/projectStore';
import { useHealStats } from '../hooks/useHeals';
import { useRuns } from '../hooks/useRuns';
import { getInitials } from '../lib/utils';
import type { ChatAttachment } from '../types';

// ── Constants ──────────────────────────────────────────────────────────────

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
      display: 'inline-flex', alignItems: 'center', gap: 5, padding: '3px 8px',
      borderRadius: 20, background: 'var(--surface)', border: '1px solid var(--border)',
      fontSize: 10, color: 'var(--text-mid)', maxWidth: 160,
    }}>
      <span>{mimeType.startsWith('image/') ? '🖼' : '📄'}</span>
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>{name}</span>
      <button onClick={onRemove} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-dim)', padding: 0, fontSize: 11 }}>✕</button>
    </div>
  );
}

// ── Conversation ID persistence ────────────────────────────────────────────

function getConversationId(projectId: string): string {
  const key = `qai-conv-${projectId}`;
  const existing = localStorage.getItem(key);
  if (existing) return existing;
  const id = `conv-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  localStorage.setItem(key, id);
  return id;
}

// ── Quick commands ─────────────────────────────────────────────────────────

const QUICK_COMMANDS = [
  {
    section: 'Execution',
    commands: [
      { label: '▶ Run smoke tests now', text: 'Run the smoke tests on QA environment' },
      { label: '▶ Run Primary Sales suite', text: 'Run all Primary Sales test cases on QA environment' },
      { label: '▶ Run failing tests', text: 'Run the tests that failed in the last run on QA environment' },
    ],
  },
  {
    section: 'Analysis',
    commands: [
      { label: '❓ Why did the last run fail?', text: 'Why did the last run fail? Show me the failed tests and root causes.' },
      { label: '📊 Show today\'s pass rate', text: 'Show me the summary of the most recent run including pass rate.' },
      { label: '🔧 Show pending heals', text: 'Show all pending heal proposals that need my approval.' },
    ],
  },
  {
    section: 'Creation',
    commands: [
      { label: '🧠 Generate from Jira story', text: 'Generate test cases for Jira story: ' },
      { label: '📄 Generate from description', text: 'Generate test cases for: ' },
      { label: '⚙️ Show project stats', text: 'Show me the overall project stats and health.' },
    ],
  },
];

// ── Context panel ──────────────────────────────────────────────────────────

function ContextPanel({ projectId, slug }: { projectId: string; slug: string }) {
  const navigate = useNavigate();
  const { activeProject } = useProjectStore();
  const { data: healStats } = useHealStats(projectId);
  const { data: runsData } = useRuns(projectId);
  const lastRun = runsData?.runs?.[0];

  const envName = activeProject?.envConfigs?.find(e => e.isDefault)?.name ?? 'Dev';
  const envUrl = activeProject?.envConfigs?.find(e => e.isDefault)?.baseUrl ?? activeProject?.baseUrl ?? '—';

  const runStatusColor = (s?: string) => {
    if (s === 'PASSED') return 'var(--pass)';
    if (s === 'FAILED') return 'var(--fail)';
    if (s === 'RUNNING' || s === 'PENDING') return 'var(--cyan)';
    return 'var(--text-dim)';
  };

  return (
    <div style={{
      background: 'var(--surface)',
      border: '1px solid var(--border)',
      borderRadius: 10,
      overflow: 'hidden',
    }}>
      <div style={{ height: 4, background: 'linear-gradient(90deg, #2563AB, #0A2A57)' }} />
      <div style={{ padding: '10px 14px 4px' }}>
        <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.07em', color: 'var(--text-dim)', marginBottom: 10 }}>Context</div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {/* Active env */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
            <span style={{ fontSize: 11, color: 'var(--text-dim)' }}>Active env</span>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text)' }}>{envName}</div>
              <div style={{ fontSize: 9, fontFamily: 'var(--font-mono)', color: 'var(--text-dim)', wordBreak: 'break-all' }}>{envUrl}</div>
            </div>
          </div>

          {/* Last run */}
          {lastRun && (
            <div
              style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, cursor: 'pointer' }}
              onClick={() => navigate(`/projects/${slug}/reports`)}
            >
              <span style={{ fontSize: 11, color: 'var(--text-dim)' }}>Last run</span>
              <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                <span style={{ width: 7, height: 7, borderRadius: '50%', background: runStatusColor(lastRun.status), display: 'inline-block' }} />
                <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text)' }}>{lastRun.status}</span>
              </div>
            </div>
          )}

          {/* Pending heals */}
          <div
            style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, cursor: 'pointer' }}
            onClick={() => navigate(`/projects/${slug}/healing`)}
          >
            <span style={{ fontSize: 11, color: 'var(--text-dim)' }}>Pending heals</span>
            {healStats && healStats.pending > 0 ? (
              <span style={{
                fontSize: 9, fontWeight: 700, padding: '2px 7px', borderRadius: 100,
                background: 'rgba(220,38,38,0.12)', color: 'var(--fail)',
              }}>
                {healStats.pending}
              </span>
            ) : (
              <span style={{ fontSize: 11, color: 'var(--pass)', fontWeight: 600 }}>0</span>
            )}
          </div>

          {/* AI mode */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 11, color: 'var(--text-dim)' }}>AI mode</span>
            <span style={{
              fontSize: 9, fontWeight: 700, padding: '2px 8px', borderRadius: 100,
              background: 'rgba(244,123,32,0.12)', color: 'var(--skip)',
            }}>
              ON · claude-sonnet
            </span>
          </div>
        </div>
      </div>
      <div style={{ padding: '8px 14px 12px' }} />
    </div>
  );
}

// ── Main Chat page ─────────────────────────────────────────────────────────

export default function Chat() {
  const { slug } = useParams<{ slug: string }>();
  const { activeProject, currentUser } = useProjectStore();
  const projectId = activeProject?.id ?? '';

  const [conversationId] = useState(() =>
    projectId ? getConversationId(projectId) : `conv-${Date.now()}`,
  );

  const [input, setInput] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [attachments, setAttachments] = useState<ChatAttachment[]>([]);
  const [showMemory, setShowMemory] = useState(false);
  const [memoryDraft, setMemoryDraft] = useState('');

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { data: messages = [], isLoading } = useChatHistory(projectId, conversationId);
  const sendMessage = useSendMessage(projectId);
  const clearHistory = useClearHistory(projectId);
  const { data: memories = [] } = useChatMemory(projectId);
  const addMemory = useAddMemory(projectId);
  const deleteMemory = useDeleteMemory(projectId);

  const userInitials = currentUser ? getInitials(currentUser.name) : 'U';

  // Auto-scroll to bottom
  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, isTyping, scrollToBottom]);

  // Auto-resize textarea
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
    if ((!text && attachments.length === 0) || sendMessage.isPending || isTyping) return;

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

  async function handleAddMemory() {
    const text = memoryDraft.trim();
    if (!text) return;
    try { await addMemory.mutateAsync(text); setMemoryDraft(''); }
    catch { toast.error('Failed to save memory'); }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void handleSend();
    }
  }

  async function handleClear() {
    if (!window.confirm('Clear conversation history?')) return;
    await clearHistory.mutateAsync(conversationId);
    // Reset conversation ID
    localStorage.removeItem(`qai-conv-${projectId}`);
    window.location.reload();
  }

  function insertQuickCommand(text: string) {
    setInput(text);
    textareaRef.current?.focus();
  }

  // Welcome message shown when no messages yet
  const welcomeMessages = messages.length === 0 && !isLoading ? [{
    id: 'welcome',
    projectId,
    conversationId,
    role: 'assistant' as const,
    content: `Hi! I'm your QA Agent. I can help you create test cases, run test suites, analyse failures, and manage your automation pipeline for Airtel Ventas. What would you like to do today?`,
    actionType: null,
    actionPayload: null,
    createdAt: new Date().toISOString(),
  }] : messages;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      {/* Hidden file input */}
      <input ref={fileInputRef} type="file" accept={ACCEPTED_TYPES} multiple style={{ display: 'none' }} onChange={handleFilePick} />

      <Topbar
        breadcrumbs={[
          { label: 'All Projects', href: '/projects' },
          { label: activeProject?.name ?? '…', href: `/projects/${slug}/dashboard` },
          { label: '💬 Chat QA Agent' },
        ]}
        actions={
          <>
            <TbBtn variant="ghost" onClick={() => setShowMemory(m => !m)}>
              🧠 Memory {memories.length > 0 && `(${memories.length})`}
            </TbBtn>
            <TbBtn variant="ghost" onClick={() => void handleClear()}>
              🗑 Clear History
            </TbBtn>
          </>
        }
      />

      {/* Main layout */}
      <div style={{
        flex: 1,
        display: 'grid',
        gridTemplateColumns: '1fr 280px',
        gap: 14,
        padding: 16,
        overflow: 'hidden',
        minHeight: 0,
      }}>

        {/* ── Chat window ── */}
        <div style={{
          background: 'var(--surface)',
          border: '1px solid var(--border)',
          borderRadius: 10,
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
          minHeight: 0,
        }}>
          {/* Chat header */}
          <div style={{
            padding: '12px 16px',
            borderBottom: '1px solid var(--border)',
            background: 'var(--surface2)',
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            flexShrink: 0,
          }}>
            <div style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--pass)', flexShrink: 0 }} />
            <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text)' }}>QA Agent</span>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-dim)' }}>
              claude-sonnet-4-20250514 · All agents connected
            </span>
            {activeProject && (
              <span style={{
                marginLeft: 'auto',
                fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.07em',
                padding: '2px 8px', borderRadius: 100,
                background: 'linear-gradient(90deg,rgba(37,99,171,0.15),rgba(10,42,87,0.15))',
                border: '1px solid rgba(37,99,171,0.2)',
                color: 'var(--cyan)',
              }}>
                {activeProject.name.toUpperCase()}
              </span>
            )}
          </div>

          {/* Messages */}
          <div style={{
            flex: 1,
            overflowY: 'auto',
            padding: '20px',
            display: 'flex',
            flexDirection: 'column',
            gap: 16,
            minHeight: 0,
          }}>
            {isLoading ? (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 1, color: 'var(--text-dim)', fontSize: 12 }}>
                Loading conversation…
              </div>
            ) : (
              welcomeMessages.map(msg => (
                <MessageBubble key={msg.id} message={msg} userInitials={userInitials} />
              ))
            )}

            {isTyping && <TypingIndicator />}
            <div ref={messagesEndRef} />
          </div>

          {/* Attachment previews */}
          {attachments.length > 0 && (
            <div style={{
              padding: '6px 14px', borderTop: '1px solid var(--border)',
              display: 'flex', flexWrap: 'wrap', gap: 6,
              background: 'var(--surface2)', flexShrink: 0,
            }}>
              {attachments.map((a, i) => (
                <AttachmentChip key={i} name={a.name} mimeType={a.mimeType}
                  onRemove={() => setAttachments(prev => prev.filter((_, j) => j !== i))} />
              ))}
            </div>
          )}

          {/* Input area */}
          <div style={{
            borderTop: '1px solid var(--border)',
            padding: 14,
            display: 'flex',
            gap: 10,
            alignItems: 'flex-end',
            background: 'var(--surface2)',
            flexShrink: 0,
          }}>
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={attachments.length >= 5}
              title="Attach file"
              style={{
                background: 'none', border: 'none', cursor: attachments.length >= 5 ? 'not-allowed' : 'pointer',
                color: 'var(--text-dim)', fontSize: 18, padding: '0 2px',
                opacity: attachments.length >= 5 ? 0.4 : 1, flexShrink: 0,
              }}
            >📎</button>
            <textarea
              ref={textareaRef}
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Ask anything — 'run smoke tests', 'why did TC-44 fail', 'create tests for VEN-501', 'schedule nightly at 2am'..."
              rows={2}
              style={{
                flex: 1,
                background: 'var(--bg)',
                border: '1px solid var(--border)',
                borderRadius: 8,
                padding: '10px 14px',
                fontFamily: 'var(--font-ui)',
                fontSize: 12,
                color: 'var(--text)',
                resize: 'none',
                minHeight: 42,
                maxHeight: 120,
                outline: 'none',
                lineHeight: 1.5,
                transition: 'border-color 0.15s',
              }}
              onFocus={e => { e.target.style.borderColor = 'var(--cyan)'; }}
              onBlur={e => { e.target.style.borderColor = 'var(--border)'; }}
            />
            <button
              onClick={() => void handleSend()}
              disabled={(!input.trim() && attachments.length === 0) || isTyping || sendMessage.isPending}
              style={{
                width: 38, height: 38,
                background: 'var(--cyan)',
                border: 'none',
                borderRadius: 8,
                color: 'var(--bg)',
                fontSize: 16,
                cursor: (!input.trim() && attachments.length === 0) || isTyping ? 'not-allowed' : 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
                opacity: (!input.trim() && attachments.length === 0) || isTyping ? 0.5 : 1,
                transition: 'opacity 0.15s',
              }}
            >
              ↑
            </button>
          </div>
        </div>

        {/* ── Sidebar ── */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, overflowY: 'auto', minHeight: 0 }}>

          {/* Quick commands */}
          <div style={{
            background: 'var(--surface)',
            border: '1px solid var(--border)',
            borderRadius: 10,
            overflow: 'hidden',
          }}>
            <div style={{ height: 4, background: 'linear-gradient(90deg, #FFB347, #F47B20)' }} />
            <div style={{ padding: '10px 14px 14px' }}>
              <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.07em', color: 'var(--text-dim)', marginBottom: 10 }}>
                ⚡ Quick Commands
              </div>

              {QUICK_COMMANDS.map((group, gi) => (
                <div key={group.section} style={{ marginBottom: gi < QUICK_COMMANDS.length - 1 ? 12 : 0 }}>
                  <div style={{
                    fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em',
                    color: 'var(--text-dim)', marginBottom: 6,
                  }}>
                    {group.section}
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                    {group.commands.map(cmd => (
                      <button
                        key={cmd.label}
                        onClick={() => insertQuickCommand(cmd.text)}
                        style={{
                          padding: '7px 10px',
                          background: 'var(--surface2)',
                          border: '1px solid var(--border)',
                          borderRadius: 6,
                          fontSize: 11,
                          color: 'var(--text-mid)',
                          cursor: 'pointer',
                          textAlign: 'left',
                          transition: 'all 0.12s',
                          fontFamily: 'var(--font-ui)',
                          lineHeight: 1.3,
                        }}
                        onMouseEnter={e => {
                          (e.target as HTMLButtonElement).style.borderColor = 'var(--cyan)';
                          (e.target as HTMLButtonElement).style.color = 'var(--cyan)';
                        }}
                        onMouseLeave={e => {
                          (e.target as HTMLButtonElement).style.borderColor = 'var(--border)';
                          (e.target as HTMLButtonElement).style.color = 'var(--text-mid)';
                        }}
                      >
                        {cmd.label}
                      </button>
                    ))}
                  </div>
                  {gi < QUICK_COMMANDS.length - 1 && (
                    <div style={{ height: 1, background: 'var(--border)', margin: '10px 0 0' }} />
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Memory panel */}
          {showMemory && (
            <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden' }}>
              <div style={{ height: 4, background: 'linear-gradient(90deg, var(--cyan), var(--violet))' }} />
              <div style={{ padding: '10px 14px 14px' }}>
                <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.07em', color: 'var(--text-dim)', marginBottom: 10 }}>
                  🧠 Memory
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 10 }}>
                  {memories.length === 0 && (
                    <span style={{ fontSize: 11, color: 'var(--text-dim)', fontStyle: 'italic' }}>No memories yet.</span>
                  )}
                  {memories.map(m => (
                    <div key={m.id} style={{ display: 'flex', gap: 6, alignItems: 'flex-start', padding: '5px 8px', background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 7 }}>
                      <span style={{ fontSize: 10, color: 'var(--cyan)', flexShrink: 0 }}>◆</span>
                      <span style={{ flex: 1, fontSize: 11, color: 'var(--text)', lineHeight: 1.5, wordBreak: 'break-word' }}>{m.content}</span>
                      <button onClick={() => void deleteMemory.mutateAsync(m.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-dim)', fontSize: 11, padding: 0, flexShrink: 0 }}>🗑</button>
                    </div>
                  ))}
                </div>
                <div style={{ display: 'flex', gap: 6 }}>
                  <input
                    value={memoryDraft}
                    onChange={e => setMemoryDraft(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') void handleAddMemory(); }}
                    placeholder='Add a memory…'
                    style={{
                      flex: 1, background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 6,
                      padding: '5px 8px', fontSize: 11, color: 'var(--text)', fontFamily: 'var(--font-ui)', outline: 'none',
                    }}
                  />
                  <button
                    onClick={() => void handleAddMemory()}
                    disabled={!memoryDraft.trim()}
                    style={{ padding: '5px 10px', background: 'var(--cyan)', border: 'none', borderRadius: 6, color: 'var(--bg)', fontSize: 11, fontWeight: 700, cursor: 'pointer', opacity: !memoryDraft.trim() ? 0.5 : 1 }}
                  >+</button>
                </div>
              </div>
            </div>
          )}

          {/* Context panel */}
          <ContextPanel projectId={projectId} slug={slug ?? ''} />
        </div>
      </div>

      {/* Typing animation CSS */}
      <style>{`
        @keyframes typing-dot {
          0%, 60%, 100% { opacity: 0.3; transform: translateY(0); }
          30% { opacity: 1; transform: translateY(-3px); }
        }
      `}</style>
    </div>
  );
}
