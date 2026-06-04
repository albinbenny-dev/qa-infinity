import { useRef, useState } from 'react';
import type { EnvConfig } from '../../types';
import { api } from '../../lib/api';

// ── Interfaces ────────────────────────────────────────────────
interface JiraStory {
  url: string;
  status: 'idle' | 'verifying' | 'verified' | 'error';
  label: string;
}

interface RefTC {
  id: string;
  label: string;
}

export interface UIScreenEntry {
  url: string;
  label: string;
  envName?: string;
  username?: string;
  password?: string;
  menuContext?: string;
  agenticTrace?: boolean;
}

interface UploadedDoc {
  tempId: string;
  filename: string;
  filePath: string;
  mimeType: string;
  size: number;
}

export interface SeedTC {
  tempId: string;
  title: string;
  steps: string[];
  expectedResult: string;
  source: 'manual' | 'excel';
  useCaseTag?: string;
  description?: string;
  priority?: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  type?: 'UI' | 'API' | 'SIT';
  preConditions?: string;
  testData?: string;
  notes?: string;
}

export interface InputQueueState {
  jiraStories: JiraStory[];
  jiraInput: string;
  refTCs: RefTC[];
  refTCInput: string;
  refMode: 'style' | 'seed';
  seedTCs: SeedTC[];
  uploadedDocs: UploadedDoc[];
  uiScreenUrls: UIScreenEntry[];
  additionalContext: string;
  testTypes: { UI: boolean; API: boolean; SIT: boolean };
}

interface InputQueueProps {
  state: InputQueueState;
  onChange: (patch: Partial<InputQueueState>) => void;
  onUploadFile: (file: File) => Promise<{ filePath: string; filename: string; mimeType: string; size: number }>;
  onParseSeedFile: (filePath: string) => Promise<Omit<SeedTC, 'tempId' | 'source'>[]>;
  onGenerate: () => void;
  isGenerating: boolean;
  inputCount: number;
  envConfigs?: EnvConfig[];
  projectId?: string;
  isStandardMode?: boolean;
  onSaveDirectly?: (seeds: SeedTC[]) => void;
  creditsAvailable?: boolean;
  /** When false (Viewer role) the Generate button is hidden and a read-only badge is shown */
  canGenerate?: boolean;
}

// ── Tab types ─────────────────────────────────────────────────
type InputTab = 'screen' | 'ref' | 'docs' | 'jira';

// ── Style helpers ─────────────────────────────────────────────
const AMBER = '#f59e0b';
const AMBER_BG = 'rgba(245,158,11,0.08)';
const AMBER_BORDER = 'rgba(245,158,11,0.35)';

const FL: React.CSSProperties = {
  fontSize: '9px',
  fontFamily: 'var(--font-mono)',
  textTransform: 'uppercase',
  letterSpacing: '0.06em',
  color: 'var(--text-dim)',
  marginBottom: '3px',
  display: 'block',
};

const iconBtn = (color: string, bg: string, border: string): React.CSSProperties => ({
  width: '24px',
  height: '24px',
  borderRadius: '5px',
  background: bg,
  border: `1px solid ${border}`,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  fontSize: '10px',
  color,
  cursor: 'pointer',
  flexShrink: 0,
});

// Per-tab accent colours (uses app CSS variables)
const TAB_COLOR: Record<InputTab, string> = {
  screen: 'var(--emerald)',
  ref:    'var(--violet)',
  docs:   'var(--cyan)',
  jira:   'var(--sky)',
};
const TAB_DIM: Record<InputTab, string> = {
  screen: 'var(--emerald-dim)',
  ref:    'var(--violet-dim)',
  docs:   'var(--cyan-dim)',
  jira:   'var(--cyan-dim)',
};

// ── Tab button ────────────────────────────────────────────────
function TabBtn({
  label, tab, active, count, onClick,
}: {
  label: string;
  tab: InputTab;
  active: boolean;
  count: number;
  onClick: () => void;
}) {
  const color = TAB_COLOR[tab];
  const dim   = TAB_DIM[tab];
  return (
    <button
      onClick={onClick}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '4px',
        padding: '5px 10px 7px',
        border: 'none',
        borderBottom: active ? `2px solid ${color}` : '2px solid transparent',
        background: 'transparent',
        color: active ? color : 'var(--text-dim)',
        fontSize: '10px',
        fontFamily: 'var(--font-mono)',
        fontWeight: active ? 700 : 400,
        cursor: 'pointer',
        transition: 'all 0.15s',
        whiteSpace: 'nowrap',
        marginBottom: '-2px',
      }}
    >
      {label}
      {count > 0 && (
        <span style={{
          fontSize: '8px',
          fontWeight: 700,
          minWidth: '14px',
          padding: '0 3px',
          borderRadius: '6px',
          textAlign: 'center',
          background: active ? dim : 'var(--surface3)',
          color: active ? color : 'var(--text-dim)',
        }}>
          {count}
        </span>
      )}
    </button>
  );
}

// ── Main component ────────────────────────────────────────────
export default function InputQueue({
  state,
  onChange,
  onUploadFile,
  onParseSeedFile,
  onGenerate,
  isGenerating,
  inputCount,
  envConfigs = [],
  projectId,
  isStandardMode = false,
  onSaveDirectly,
  creditsAvailable = true,
  canGenerate = true,
}: InputQueueProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const seedFileRef  = useRef<HTMLInputElement>(null);

  // Live UI Screen form state
  const [uiEnvId,      setUiEnvId]      = useState('');
  const [uiCustomUrl,  setUiCustomUrl]  = useState('');
  const [uiUsername,   setUiUsername]   = useState('');
  const [uiPassword,   setUiPassword]   = useState('');
  const [uiMenuContext, setUiMenuContext] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  // Seed TC form state
  const [seedInputMode,  setSeedInputMode]  = useState<'manual' | 'excel'>('manual');
  const [seedTitle,      setSeedTitle]      = useState('');
  const [seedSteps,      setSeedSteps]      = useState('');
  const [seedExpected,   setSeedExpected]   = useState('');
  const [isParsing,      setIsParsing]      = useState(false);
  const [seedParseError, setSeedParseError] = useState<string | null>(null);

  // Active tab — default to 'screen' (or 'ref' in standard mode)
  const [activeTab, setActiveTab] = useState<InputTab>(isStandardMode ? 'ref' : 'screen');

  // ── Handlers (unchanged from original) ───────────────────

  const handleDownloadTemplate = async () => {
    if (!projectId) return;
    try {
      const res = await api.get(`/projects/${projectId}/test-cases/seed-template`, { responseType: 'blob' });
      const url = URL.createObjectURL(res.data as Blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'seed-tc-template.xlsx';
      a.click();
      URL.revokeObjectURL(url);
    } catch { /* ignore */ }
  };

  const selectedEnv = envConfigs.find((e) => e.id === uiEnvId);

  const handleFileDrop = async (files: FileList | null) => {
    if (!files?.length) return;
    for (const file of Array.from(files)) {
      try {
        const result = await onUploadFile(file);
        const tempId = `${Date.now()}-${Math.random()}`;
        onChange({
          uploadedDocs: [
            ...state.uploadedDocs,
            { tempId, filename: result.filename, filePath: result.filePath, mimeType: result.mimeType, size: result.size },
          ],
        });
      } catch { /* silently skip */ }
    }
  };

  const addJiraStory = () => {
    if (!state.jiraInput.trim()) return;
    onChange({
      jiraStories: [...state.jiraStories, { url: state.jiraInput.trim(), status: 'idle', label: state.jiraInput.trim() }],
      jiraInput: '',
    });
  };

  const addRefTC = () => {
    if (!state.refTCInput.trim()) return;
    const id = state.refTCInput.trim();
    onChange({ refTCs: [...state.refTCs, { id, label: id }], refTCInput: '' });
  };

  const addManualSeedTC = () => {
    if (!seedTitle.trim()) return;
    const steps = seedSteps
      .split('\n')
      .map((s) => s.replace(/^\d+\.\s*/, '').trim())
      .filter(Boolean);
    const tc: SeedTC = {
      tempId: `seed-${Date.now()}-${Math.random()}`,
      title: seedTitle.trim(),
      steps: steps.length ? steps : (seedSteps.trim() ? [seedSteps.trim()] : []),
      expectedResult: seedExpected.trim(),
      source: 'manual',
    };
    onChange({ seedTCs: [...state.seedTCs, tc] });
    setSeedTitle(''); setSeedSteps(''); setSeedExpected('');
  };

  const handleSendToReview = () => {
    if (!seedTitle.trim() || !onSaveDirectly) return;
    const steps = seedSteps
      .split('\n')
      .map((s) => s.replace(/^\d+\.\s*/, '').trim())
      .filter(Boolean);
    const tc: SeedTC = {
      tempId: `seed-direct-${Date.now()}`,
      title: seedTitle.trim(),
      steps,
      expectedResult: seedExpected.trim(),
      source: 'manual',
    };
    onSaveDirectly([tc]);
    setSeedTitle(''); setSeedSteps(''); setSeedExpected('');
  };

  const handleSeedExcelFile = async (files: FileList | null) => {
    if (!files?.length) return;
    setIsParsing(true);
    setSeedParseError(null);
    try {
      const result = await onUploadFile(files[0]);
      const parsed = await onParseSeedFile(result.filePath);
      if (!parsed.length) {
        setSeedParseError('No test cases found. Ensure your Excel has columns: Title · Steps · Expected Result');
        return;
      }
      const newSeeds: SeedTC[] = parsed.map((tc, i) => ({
        ...tc,
        tempId: `seed-excel-${Date.now()}-${i}`,
        source: 'excel' as const,
      }));
      onChange({ seedTCs: [...state.seedTCs, ...newSeeds] });
      if (seedFileRef.current) seedFileRef.current.value = '';
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Upload failed';
      setSeedParseError(
        msg.includes('not supported')
          ? `File rejected — ${msg}`
          : 'Upload failed. Check the file format and try again.',
      );
    } finally {
      setIsParsing(false);
    }
  };

  function addUIScreen() {
    if (uiEnvId === '__custom__') {
      const raw = uiCustomUrl.trim();
      if (!raw) return;
      const url = raw.startsWith('http') ? raw : `https://${raw}`;
      onChange({
        uiScreenUrls: [
          ...state.uiScreenUrls,
          {
            url,
            label: url,
            username: uiUsername.trim() || undefined,
            password: uiPassword.trim() || undefined,
            menuContext: uiMenuContext.trim() || undefined,
          },
        ],
      });
    } else if (uiEnvId && selectedEnv) {
      onChange({
        uiScreenUrls: [
          ...state.uiScreenUrls,
          {
            url: selectedEnv.baseUrl,
            label: selectedEnv.baseUrl,
            envName: selectedEnv.name,
            username: selectedEnv.username ?? undefined,
            password: selectedEnv.password ?? undefined,
            menuContext: uiMenuContext.trim() || undefined,
          },
        ],
      });
    } else {
      return;
    }
    setUiEnvId(''); setUiCustomUrl(''); setUiUsername('');
    setUiPassword(''); setUiMenuContext(''); setShowPassword(false);
  }

  const canAddScreen = uiEnvId === '__custom__' ? uiCustomUrl.trim().length > 0 : uiEnvId !== '';
  const hasSeedMode  = state.refMode === 'seed';

  // Tab badge counts
  const screenCount = state.uiScreenUrls.length;
  const refCount    = state.refTCs.length + state.seedTCs.length;
  const docsCount   = state.uploadedDocs.length;
  const jiraCount   = state.jiraStories.length;

  // ── Render ────────────────────────────────────────────────
  return (
    <div className="card" style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden', maxHeight: '100%' }}>

      {/* Warm accent bar */}
      <div style={{ height: '3px', background: 'var(--warm-accent)', flexShrink: 0 }} />

      {/* Standard Mode banner */}
      {isStandardMode && (
        <div style={{
          padding: '8px 14px', flexShrink: 0,
          background: 'rgba(245,158,11,0.07)',
          borderBottom: '1px solid var(--border)',
          fontSize: 11, color: 'var(--amber)', lineHeight: 1.5,
        }}>
          <strong>⚡ Standard Mode</strong> — only Seed TCs available. Jira, documents, and Live UI require Full Mode.
        </div>
      )}

      {/* Card header */}
      <div className="card-header" style={{ flexShrink: 0 }}>
        <div className="card-title">📥 Input Sources</div>
        <span className="badge badge-cyan">{inputCount} input{inputCount !== 1 ? 's' : ''}</span>
      </div>

      {/* Tab row */}
      {!isStandardMode && (
        <div style={{
          display: 'flex',
          padding: '0 14px',
          gap: '2px',
          borderBottom: '2px solid var(--border)',
          flexShrink: 0,
          background: 'var(--surface)',
        }}>
          <TabBtn label="🖥 Live Screen" tab="screen" active={activeTab === 'screen'} count={screenCount} onClick={() => setActiveTab('screen')} />
          <TabBtn label="📋 Ref TCs"    tab="ref"    active={activeTab === 'ref'}    count={refCount}    onClick={() => setActiveTab('ref')} />
          <TabBtn label="📄 Docs"       tab="docs"   active={activeTab === 'docs'}   count={docsCount}   onClick={() => setActiveTab('docs')} />
          <TabBtn label="🎫 Jira"       tab="jira"   active={activeTab === 'jira'}   count={jiraCount}   onClick={() => setActiveTab('jira')} />
        </div>
      )}

      {/* ── Panel body (scrollable) ── */}
      <div
        className="card-body"
        style={{ flex: 1, overflowY: 'auto', padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: '8px' }}
      >

        {/* ════════════════════════════
            LIVE SCREEN PANEL
        ═══════════════════════════ */}
        {activeTab === 'screen' && !isStandardMode && (
          <>
            <p style={{ fontSize: '9px', fontFamily: 'var(--font-mono)', color: 'var(--text-dim)', lineHeight: 1.5 }}>
              Vision AI screenshots the live URL and derives test cases from the UI. Can be used as the sole input source.
            </p>

            {/* Added screens */}
            {state.uiScreenUrls.map((entry, i) => (
              <div key={i} style={{ display: 'flex', gap: '6px', alignItems: 'flex-start' }}>
                <div style={{
                  width: '26px', height: '26px', borderRadius: '5px', flexShrink: 0, marginTop: '1px',
                  background: entry.agenticTrace ? 'rgba(99,102,241,0.15)' : 'var(--emerald-dim)',
                  border: `1px solid ${entry.agenticTrace ? 'rgba(99,102,241,0.4)' : 'rgba(42,157,143,0.25)'}`,
                  display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '12px',
                }}>
                  {entry.agenticTrace ? '🤖' : '🖥'}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div
                    title={entry.url}
                    style={{
                      padding: '5px 9px',
                      background: 'var(--surface2)',
                      border: `1px solid ${entry.agenticTrace ? 'rgba(99,102,241,0.3)' : 'rgba(42,157,143,0.2)'}`,
                      borderRadius: 'var(--radius)',
                      fontFamily: 'var(--font-mono)', fontSize: '10px', color: 'var(--text)',
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    }}
                  >
                    {entry.envName && (
                      <><span style={{ color: 'var(--emerald)', fontWeight: 700 }}>{entry.envName}</span>
                      <span style={{ color: 'var(--text-dim)' }}> · </span></>
                    )}
                    {entry.url}
                  </div>
                  {entry.menuContext && (
                    <div style={{ marginTop: '3px', fontFamily: 'var(--font-mono)', fontSize: '9px', color: AMBER, display: 'flex', alignItems: 'center', gap: '4px' }}>
                      <span>📋</span><span>{entry.menuContext}</span>
                    </div>
                  )}
                  {entry.username && (
                    <div style={{ marginTop: '2px', fontFamily: 'var(--font-mono)', fontSize: '9px', color: 'var(--text-dim)' }}>
                      👤 {entry.username}
                    </div>
                  )}
                  <div style={{ marginTop: '4px', display: 'flex', gap: '4px', alignItems: 'center' }}>
                    <button
                      onClick={() => onChange({
                        uiScreenUrls: state.uiScreenUrls.map((s, idx) =>
                          idx === i ? { ...s, agenticTrace: !s.agenticTrace } : s,
                        ),
                      })}
                      title={entry.agenticTrace ? 'Agentic Trace ON — click to disable.' : 'Enable Agentic Trace — Claude browses live'}
                      style={{
                        padding: '2px 8px', borderRadius: '4px',
                        border: `1px solid ${entry.agenticTrace ? 'rgba(99,102,241,0.6)' : 'rgba(255,255,255,0.1)'}`,
                        background: entry.agenticTrace ? 'rgba(99,102,241,0.2)' : 'transparent',
                        color: entry.agenticTrace ? '#818cf8' : 'var(--text-dim)',
                        fontSize: '9px', fontFamily: 'var(--font-mono)',
                        cursor: 'pointer', transition: 'all 0.15s',
                        display: 'flex', alignItems: 'center', gap: '3px',
                      }}
                    >
                      <span>{entry.agenticTrace ? '●' : '○'}</span>
                      <span>Agentic Trace</span>
                    </button>
                    {entry.agenticTrace && (
                      <span style={{ fontSize: '9px', fontFamily: 'var(--font-mono)', color: '#818cf8', opacity: 0.8 }}>
                        Claude will browse live
                      </span>
                    )}
                  </div>
                </div>
                <div
                  style={iconBtn('var(--rose)', 'var(--rose-dim)', 'rgba(220,38,38,0.2)')}
                  onClick={() => onChange({ uiScreenUrls: state.uiScreenUrls.filter((_, idx) => idx !== i) })}
                >✕</div>
              </div>
            ))}

            {/* Add screen form */}
            <div style={{ padding: '10px 12px', background: 'rgba(42,157,143,0.04)', border: '1px solid rgba(42,157,143,0.18)', borderRadius: 'var(--radius)' }}>
              <div style={{ marginBottom: '7px' }}>
                <label style={FL}>Environment / URL</label>
                <select
                  value={uiEnvId}
                  onChange={(e) => { setUiEnvId(e.target.value); setUiCustomUrl(''); setUiUsername(''); setUiPassword(''); }}
                  className="input-field"
                  style={{ width: '100%', padding: '6px 10px', fontSize: '11px', borderColor: 'rgba(42,157,143,0.3)' }}
                >
                  <option value="">— Select environment or add new —</option>
                  {envConfigs.map((env) => (
                    <option key={env.id} value={env.id}>{env.name} · {env.baseUrl}</option>
                  ))}
                  <option value="__custom__">+ Enter custom URL…</option>
                </select>
              </div>

              {uiEnvId === '__custom__' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginBottom: '7px' }}>
                  <input
                    className="input-field"
                    value={uiCustomUrl}
                    onChange={(e) => setUiCustomUrl(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') addUIScreen(); }}
                    placeholder="https://ventas.airtel.local/sales/new-order"
                    style={{ fontSize: '11px', padding: '6px 10px', fontFamily: 'var(--font-mono)', borderColor: 'rgba(42,157,143,0.3)' }}
                    autoFocus
                  />
                  <div style={{ display: 'flex', gap: '6px' }}>
                    <input
                      className="input-field"
                      value={uiUsername}
                      onChange={(e) => setUiUsername(e.target.value)}
                      placeholder="Username"
                      style={{ flex: 1, fontSize: '11px', padding: '6px 10px' }}
                    />
                    <div style={{ flex: 1, position: 'relative' }}>
                      <input
                        className="input-field"
                        type={showPassword ? 'text' : 'password'}
                        value={uiPassword}
                        onChange={(e) => setUiPassword(e.target.value)}
                        placeholder="Password"
                        style={{ width: '100%', fontSize: '11px', padding: '6px 30px 6px 10px', boxSizing: 'border-box' }}
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword((v) => !v)}
                        style={{ position: 'absolute', right: '6px', top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', fontSize: '10px', color: 'var(--text-dim)', padding: 0 }}
                      >
                        {showPassword ? '🙈' : '👁'}
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {uiEnvId && uiEnvId !== '__custom__' && selectedEnv && (
                <div style={{
                  padding: '6px 10px', marginBottom: '7px',
                  background: 'var(--surface2)', borderRadius: 'var(--radius)',
                  fontFamily: 'var(--font-mono)', fontSize: '10px', color: 'var(--text-dim)',
                  display: 'flex', alignItems: 'center', gap: '8px',
                }}>
                  <span style={{ color: 'var(--emerald)', fontWeight: 700 }}>{selectedEnv.name}</span>
                  <span>·</span>
                  <span style={{ color: 'var(--text)' }}>{selectedEnv.baseUrl}</span>
                  {selectedEnv.username && <><span>·</span><span>👤 {selectedEnv.username}</span></>}
                </div>
              )}

              {uiEnvId && (
                <div style={{ marginBottom: '7px' }}>
                  <label style={FL}>Which page / menu to test?</label>
                  <input
                    className="input-field"
                    value={uiMenuContext}
                    onChange={(e) => setUiMenuContext(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter' && canAddScreen) addUIScreen(); }}
                    placeholder="e.g. New Order form, Dealer KYC onboarding, Stock report"
                    style={{ width: '100%', fontSize: '11px', padding: '6px 10px', borderColor: 'rgba(245,158,11,0.3)', boxSizing: 'border-box' }}
                  />
                </div>
              )}

              <button
                onClick={addUIScreen}
                disabled={!canAddScreen}
                style={{
                  width: '100%', padding: '7px',
                  background: canAddScreen ? 'linear-gradient(135deg, rgba(42,157,143,0.8), rgba(42,157,143,0.5))' : 'var(--surface3)',
                  border: canAddScreen ? '1px solid rgba(42,157,143,0.4)' : '1px solid var(--border)',
                  borderRadius: 'var(--radius)',
                  color: canAddScreen ? 'white' : 'var(--text-dim)',
                  fontSize: '11px', fontWeight: 700,
                  cursor: canAddScreen ? 'pointer' : 'default',
                  transition: 'all 0.15s',
                }}
              >
                + Add Screen
              </button>
            </div>
          </>
        )}

        {/* ════════════════════════════
            REF TCS / SEED TCS PANEL
        ═══════════════════════════ */}
        {(activeTab === 'ref' || isStandardMode) && (
          <>
            {/* Sub-mode toggle (hidden in standard mode — always seed) */}
            {!isStandardMode && (
              <div style={{ display: 'flex', gap: '2px', background: 'var(--surface3)', borderRadius: '6px', padding: '2px' }}>
                <button
                  style={{
                    flex: 1, fontSize: '9px', fontWeight: 700, padding: '3px 9px', borderRadius: '4px',
                    border: 'none', cursor: 'pointer', transition: 'all 0.15s',
                    background: !hasSeedMode ? 'var(--violet-dim)' : 'transparent',
                    color: !hasSeedMode ? 'var(--violet)' : 'var(--text-dim)',
                  }}
                  onClick={() => onChange({ refMode: 'style' })}
                >
                  Style Ref
                </button>
                <button
                  style={{
                    flex: 1, fontSize: '9px', fontWeight: 700, padding: '3px 9px', borderRadius: '4px',
                    border: 'none', cursor: 'pointer', transition: 'all 0.15s',
                    background: hasSeedMode ? AMBER_BG : 'transparent',
                    color: hasSeedMode ? AMBER : 'var(--text-dim)',
                  }}
                  onClick={() => onChange({ refMode: 'seed' })}
                >
                  🔒 Seed TCs
                </button>
              </div>
            )}

            {/* ── Style Reference ── */}
            {!hasSeedMode && !isStandardMode && (
              <>
                <p style={{ fontSize: '9px', fontFamily: 'var(--font-mono)', color: 'var(--text-dim)', lineHeight: 1.5 }}>
                  Add TC IDs as style/format reference — the agent mimics their step pattern and phrasing.
                </p>
                {state.refTCs.map((ref, i) => (
                  <div key={i} style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                    <div style={{ flex: 1, padding: '6px 10px', background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', fontFamily: 'var(--font-mono)', fontSize: '11px', color: 'var(--violet)' }}>
                      {ref.label}
                    </div>
                    <div
                      style={iconBtn('var(--rose)', 'var(--rose-dim)', 'rgba(220,38,38,0.2)')}
                      onClick={() => onChange({ refTCs: state.refTCs.filter((_, idx) => idx !== i) })}
                    >✕</div>
                  </div>
                ))}
                <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                  <input
                    className="input-field"
                    style={{ flex: 1, fontSize: '11px', padding: '7px 10px', borderStyle: 'dashed' }}
                    placeholder="Search or paste test case IDs..."
                    value={state.refTCInput}
                    onChange={(e) => onChange({ refTCInput: e.target.value })}
                    onKeyDown={(e) => { if (e.key === 'Enter') addRefTC(); }}
                  />
                  <div
                    style={{ width: '28px', height: '28px', borderRadius: '5px', background: 'transparent', border: '1px dashed var(--border2)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '16px', color: 'var(--text-dim)', cursor: 'pointer', flexShrink: 0 }}
                    onClick={addRefTC}
                  >+</div>
                </div>
              </>
            )}

            {/* ── Seed TCs ── */}
            {(hasSeedMode || isStandardMode) && (
              <>
                {/* Seed list */}
                {state.seedTCs.length > 0 && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
                    {state.seedTCs.map((tc, i) => (
                      <div
                        key={tc.tempId}
                        style={{ display: 'flex', alignItems: 'flex-start', gap: '6px', padding: '7px 10px', background: AMBER_BG, border: `1px solid ${AMBER_BORDER}`, borderRadius: 'var(--radius)' }}
                      >
                        <span style={{ fontSize: '11px', flexShrink: 0, marginTop: '1px' }}>🔒</span>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{tc.title}</div>
                          <div style={{ fontFamily: 'var(--font-mono)', fontSize: '9px', color: 'var(--text-dim)', marginTop: '2px', display: 'flex', flexWrap: 'wrap', gap: '4px', alignItems: 'center' }}>
                            {tc.useCaseTag && <span style={{ color: 'var(--cyan)', background: 'var(--cyan-dim)', borderRadius: '3px', padding: '1px 5px' }}>{tc.useCaseTag}</span>}
                            {tc.priority && <span style={{ color: tc.priority === 'HIGH' || tc.priority === 'CRITICAL' ? AMBER : 'var(--text-dim)', background: AMBER_BG, borderRadius: '3px', padding: '1px 5px' }}>{tc.priority}</span>}
                            {tc.type && <span style={{ background: 'var(--surface3)', borderRadius: '3px', padding: '1px 5px' }}>{tc.type}</span>}
                            {tc.testData && <span title={tc.testData} style={{ color: 'var(--violet)', background: 'var(--violet-dim)', borderRadius: '3px', padding: '1px 5px' }}>Data ✓</span>}
                            <span>{tc.steps.length} step{tc.steps.length !== 1 ? 's' : ''} · {tc.source}</span>
                          </div>
                        </div>
                        <div
                          style={iconBtn('var(--rose)', 'var(--rose-dim)', 'rgba(220,38,38,0.2)')}
                          onClick={() => onChange({ seedTCs: state.seedTCs.filter((_, idx) => idx !== i) })}
                        >✕</div>
                      </div>
                    ))}

                    <p style={{ fontFamily: 'var(--font-mono)', fontSize: '9px', color: AMBER, lineHeight: 1.5 }}>
                      {isStandardMode
                        ? `✨ ${state.seedTCs.length} TC${state.seedTCs.length !== 1 ? 's' : ''} — agent will enrich with detailed steps, login sequence, and selector hints.`
                        : `🔒 ${state.seedTCs.length} TC${state.seedTCs.length !== 1 ? 's' : ''} locked — agent preserves these verbatim and adds gap coverage only.`}
                    </p>

                    {/* No-credits warning */}
                    {!creditsAvailable && (
                      <div style={{ padding: '7px 10px', background: 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.22)', borderRadius: 'var(--radius)', fontSize: '10px', color: 'var(--rose)', lineHeight: 1.5 }}>
                        ⚠ <strong>AI credits exhausted</strong> — save test cases directly to library without AI enrichment.
                      </div>
                    )}

                    {/* Save directly button */}
                    {onSaveDirectly && (
                      <button
                        onClick={() => onSaveDirectly(state.seedTCs)}
                        disabled={isParsing}
                        style={{
                          width: '100%', padding: '7px', borderRadius: 'var(--radius)',
                          background: !creditsAvailable ? 'rgba(239,68,68,0.08)' : 'var(--surface2)',
                          border: `1px solid ${!creditsAvailable ? 'rgba(239,68,68,0.3)' : 'var(--border)'}`,
                          color: !creditsAvailable ? 'var(--rose)' : 'var(--text-dim)',
                          fontSize: '11px', fontWeight: 600,
                          cursor: isParsing ? 'not-allowed' : 'pointer',
                          transition: 'all 0.15s',
                        }}
                      >
                        → Review &amp; Save {state.seedTCs.length} TC{state.seedTCs.length !== 1 ? 's' : ''} (No AI)
                      </button>
                    )}
                  </div>
                )}

                {/* Manual / Excel toggle */}
                <div style={{ display: 'flex', gap: '4px' }}>
                  {(['manual', 'excel'] as const).map((mode) => (
                    <button
                      key={mode}
                      onClick={() => setSeedInputMode(mode)}
                      style={{
                        flex: 1, fontSize: '10px', fontWeight: 600, padding: '5px 8px', borderRadius: '5px',
                        cursor: 'pointer', transition: 'all 0.15s', border: '1px solid',
                        borderColor: seedInputMode === mode ? AMBER_BORDER : 'var(--border)',
                        background: seedInputMode === mode ? AMBER_BG : 'var(--surface2)',
                        color: seedInputMode === mode ? AMBER : 'var(--text-dim)',
                      }}
                    >
                      {mode === 'manual' ? '✏️ Manual Entry' : '📊 Excel Upload'}
                    </button>
                  ))}
                </div>

                {/* Manual entry form */}
                {seedInputMode === 'manual' && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    <input
                      className="input-field"
                      placeholder="Test case title *"
                      value={seedTitle}
                      onChange={(e) => setSeedTitle(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && seedTitle.trim()) addManualSeedTC(); }}
                      style={{ fontSize: '11px', padding: '7px 10px', borderColor: AMBER_BORDER }}
                    />
                    <textarea
                      className="input-field"
                      placeholder={'Steps (one per line)\n1. Open the application\n2. Click Login\n3. Enter credentials'}
                      value={seedSteps}
                      onChange={(e) => setSeedSteps(e.target.value)}
                      style={{ fontSize: '11px', padding: '7px 10px', minHeight: '80px', resize: 'vertical', borderColor: 'rgba(245,158,11,0.2)', lineHeight: '1.5' }}
                    />
                    <textarea
                      className="input-field"
                      placeholder="Expected result..."
                      value={seedExpected}
                      onChange={(e) => setSeedExpected(e.target.value)}
                      style={{ fontSize: '11px', padding: '7px 10px', minHeight: '48px', resize: 'vertical', borderColor: 'rgba(245,158,11,0.2)' }}
                    />
                    <div style={{ display: 'flex', gap: '6px' }}>
                      <button
                        onClick={addManualSeedTC}
                        disabled={!seedTitle.trim()}
                        style={{ flex: 1, padding: '7px', borderRadius: 'var(--radius)', background: seedTitle.trim() ? AMBER_BG : 'var(--surface3)', border: `1px solid ${seedTitle.trim() ? AMBER_BORDER : 'var(--border)'}`, color: seedTitle.trim() ? AMBER : 'var(--text-dim)', fontSize: '11px', fontWeight: 700, cursor: seedTitle.trim() ? 'pointer' : 'default', transition: 'all 0.15s' }}
                      >
                        + Add to Queue
                      </button>
                      {onSaveDirectly && (
                        <button
                          onClick={handleSendToReview}
                          disabled={!seedTitle.trim()}
                          style={{ flex: 1, padding: '7px', borderRadius: 'var(--radius)', background: seedTitle.trim() ? 'rgba(42,157,143,0.1)' : 'var(--surface3)', border: `1px solid ${seedTitle.trim() ? 'rgba(42,157,143,0.3)' : 'var(--border)'}`, color: seedTitle.trim() ? 'var(--emerald)' : 'var(--text-dim)', fontSize: '11px', fontWeight: 700, cursor: seedTitle.trim() ? 'pointer' : 'default', transition: 'all 0.15s' }}
                        >
                          → Review &amp; Save
                        </button>
                      )}
                    </div>
                  </div>
                )}

                {/* Excel upload */}
                {seedInputMode === 'excel' && (
                  <div>
                    {projectId && (
                      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '6px' }}>
                        <button
                          onClick={handleDownloadTemplate}
                          style={{ fontFamily: 'var(--font-mono)', fontSize: '9px', color: 'var(--emerald)', background: 'var(--emerald-dim)', border: '1px solid rgba(42,157,143,0.3)', borderRadius: '4px', padding: '3px 9px', cursor: 'pointer' }}
                        >
                          ⬇ Download Template
                        </button>
                      </div>
                    )}
                    <div
                      style={{ border: `1.5px dashed ${isParsing ? 'var(--border2)' : AMBER_BORDER}`, borderRadius: 'var(--radius)', padding: '20px', textAlign: 'center', cursor: isParsing ? 'wait' : 'pointer', background: 'transparent', transition: 'all 0.2s' }}
                      onClick={() => !isParsing && seedFileRef.current?.click()}
                      onDragOver={(e) => { e.preventDefault(); if (!isParsing) (e.currentTarget as HTMLElement).style.background = AMBER_BG; }}
                      onDragLeave={(e) => { (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
                      onDrop={(e) => { e.preventDefault(); (e.currentTarget as HTMLElement).style.background = 'transparent'; if (!isParsing) handleSeedExcelFile(e.dataTransfer.files); }}
                    >
                      <div style={{ fontSize: '24px', marginBottom: '6px' }}>{isParsing ? '⏳' : '📊'}</div>
                      <div style={{ fontSize: '12px', color: 'var(--text-mid)', lineHeight: 1.6 }}>
                        {isParsing
                          ? 'Parsing Excel…'
                          : <><strong>Excel (.xlsx)</strong> with test cases<br /><span style={{ fontSize: '10px', color: 'var(--text-dim)' }}>Cols: Title · Steps · Expected Result</span></>
                        }
                      </div>
                      <input ref={seedFileRef} type="file" accept=".xlsx,.xls" style={{ display: 'none' }} onChange={(e) => handleSeedExcelFile(e.target.files)} />
                    </div>
                    {seedParseError && (
                      <p style={{ fontFamily: 'var(--font-mono)', fontSize: '9px', color: 'var(--rose)', marginTop: '6px', lineHeight: 1.5, padding: '5px 8px', background: 'var(--rose-dim)', border: '1px solid rgba(220,38,38,0.25)', borderRadius: 'var(--radius)' }}>
                        ⚠ {seedParseError}
                      </p>
                    )}
                    {!seedParseError && (
                      <p style={{ fontFamily: 'var(--font-mono)', fontSize: '9px', color: 'var(--text-dim)', marginTop: '6px', lineHeight: 1.5 }}>
                        Each row = one locked test case. Steps column can use newline-separated lines.
                      </p>
                    )}
                  </div>
                )}
              </>
            )}
          </>
        )}

        {/* ════════════════════════════
            DOCS PANEL
        ═══════════════════════════ */}
        {activeTab === 'docs' && !isStandardMode && (
          <>
            {state.uploadedDocs.map((doc) => (
              <div key={doc.tempId} style={{ padding: '7px 10px', background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ fontSize: '13px' }}>📄</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{doc.filename}</div>
                  <div style={{ fontFamily: 'var(--font-mono)', fontSize: '9px', color: 'var(--text-dim)' }}>{(doc.size / 1024 / 1024).toFixed(1)} MB</div>
                </div>
                <div
                  style={{ color: 'var(--rose)', cursor: 'pointer', fontSize: '11px', padding: '2px 4px' }}
                  onClick={() => onChange({ uploadedDocs: state.uploadedDocs.filter((d) => d.tempId !== doc.tempId) })}
                >✕</div>
              </div>
            ))}

            <div
              style={{ border: '1.5px dashed var(--border2)', borderRadius: 'var(--radius)', padding: '18px', textAlign: 'center', cursor: 'pointer', transition: 'all 0.2s', background: 'transparent' }}
              onDragOver={(e) => { e.preventDefault(); (e.currentTarget as HTMLElement).style.borderColor = 'var(--cyan)'; (e.currentTarget as HTMLElement).style.background = 'var(--cyan-dim)'; }}
              onDragLeave={(e) => { (e.currentTarget as HTMLElement).style.borderColor = 'var(--border2)'; (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
              onDrop={(e) => { e.preventDefault(); (e.currentTarget as HTMLElement).style.borderColor = 'var(--border2)'; (e.currentTarget as HTMLElement).style.background = 'transparent'; handleFileDrop(e.dataTransfer.files); }}
              onClick={() => fileInputRef.current?.click()}
            >
              <div style={{ fontSize: '22px', marginBottom: '6px' }}>📁</div>
              <div style={{ fontSize: '12px', color: 'var(--text-mid)', lineHeight: 1.5 }}>
                Drop <strong>PDF / Word / Excel / HLD</strong> or click<br />
                <span style={{ fontSize: '10px', color: 'var(--text-dim)' }}>Multiple files supported</span>
              </div>
              <input ref={fileInputRef} type="file" multiple accept=".pdf,.xlsx,.xls,.docx,.doc,.txt,.md" style={{ display: 'none' }} onChange={(e) => handleFileDrop(e.target.files)} />
            </div>
          </>
        )}

        {/* ════════════════════════════
            JIRA PANEL
        ═══════════════════════════ */}
        {activeTab === 'jira' && !isStandardMode && (
          <>
            <p style={{ fontSize: '9px', fontFamily: 'var(--font-mono)', color: 'var(--text-dim)', lineHeight: 1.5 }}>
              Paste story URLs — agent extracts acceptance criteria as test inputs.
            </p>

            {state.jiraStories.map((story, i) => (
              <div key={i} style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                <div style={{ flex: 1, padding: '6px 10px', background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', fontFamily: 'var(--font-mono)', fontSize: '11px', color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {story.url}
                </div>
                <div
                  style={iconBtn(
                    story.status === 'verified' ? 'var(--emerald)' : 'var(--text-dim)',
                    story.status === 'verified' ? 'var(--emerald-dim)' : 'var(--surface2)',
                    story.status === 'verified' ? 'rgba(42,157,143,0.3)' : 'var(--border)',
                  )}
                  onClick={() => { const updated = [...state.jiraStories]; updated[i] = { ...updated[i], status: 'verified' }; onChange({ jiraStories: updated }); }}
                >✓</div>
                <div
                  style={iconBtn('var(--rose)', 'var(--rose-dim)', 'rgba(220,38,38,0.2)')}
                  onClick={() => onChange({ jiraStories: state.jiraStories.filter((_, idx) => idx !== i) })}
                >✕</div>
              </div>
            ))}

            <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
              <input
                className="input-field"
                style={{ flex: 1, fontFamily: 'var(--font-mono)', fontSize: '11px', padding: '7px 10px' }}
                placeholder="https://airtel.atlassian.net/browse/VEN-XXX"
                value={state.jiraInput}
                onChange={(e) => onChange({ jiraInput: e.target.value })}
                onKeyDown={(e) => { if (e.key === 'Enter') addJiraStory(); }}
              />
              <div
                style={{ width: '28px', height: '28px', borderRadius: '5px', background: 'var(--cyan-dim)', border: '1px solid rgba(37,99,171,0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '16px', color: 'var(--cyan)', cursor: 'pointer', flexShrink: 0 }}
                onClick={addJiraStory}
              >+</div>
            </div>
          </>
        )}

      </div>{/* /panel body */}

      {/* ════════════════════════════════════
          BOTTOM — always visible
          Additional Context · Test Types · Generate
      ══════════════════════════════════════ */}
      <div style={{
        borderTop: '1px solid var(--border)',
        flexShrink: 0,
        padding: '10px 14px',
        background: 'var(--surface)',
        display: 'flex',
        flexDirection: 'column',
        gap: '9px',
      }}>

        {/* Additional Context */}
        <div>
          <label style={FL}>💬 Additional Context</label>
          <textarea
            className="input-field"
            style={{ minHeight: '50px', fontSize: '11px', lineHeight: '1.6', resize: 'vertical', width: '100%', boxSizing: 'border-box' }}
            placeholder="Scope, constraints, edge case focus..."
            value={state.additionalContext}
            onChange={(e) => onChange({ additionalContext: e.target.value })}
          />
        </div>

        {/* Test Types */}
        <div>
          <div style={{ ...FL, marginBottom: '5px' }}>Test Types to Generate</div>
          <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
            {(['UI', 'API', 'SIT'] as const).map((t) => (
              <div
                key={t}
                style={{
                  display: 'flex', alignItems: 'center', gap: '5px',
                  padding: '5px 10px', borderRadius: '5px', cursor: 'pointer',
                  background: state.testTypes[t] ? 'var(--cyan-dim)' : 'var(--surface2)',
                  border: state.testTypes[t] ? '1px solid rgba(37,99,171,0.3)' : '1px solid var(--border)',
                  transition: 'all 0.15s',
                }}
                onClick={() => onChange({ testTypes: { ...state.testTypes, [t]: !state.testTypes[t] } })}
              >
                <div style={{
                  width: '14px', height: '14px', borderRadius: '3px',
                  background: state.testTypes[t] ? 'var(--cyan)' : 'transparent',
                  border: `1.5px solid ${state.testTypes[t] ? 'var(--cyan)' : 'var(--border2)'}`,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: '9px', color: '#fff', flexShrink: 0,
                }}>
                  {state.testTypes[t] ? '✓' : ''}
                </div>
                <span style={{ fontSize: '11px', color: state.testTypes[t] ? 'var(--cyan)' : 'var(--text-mid)' }}>
                  {t} Tests
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Generate button — hidden for Viewers */}
        {canGenerate ? (
          <button
            onClick={onGenerate}
            disabled={isGenerating}
            style={{
              width: '100%', padding: '11px', borderRadius: 'var(--radius)',
              background: isGenerating
                ? 'var(--surface3)'
                : 'linear-gradient(135deg, var(--cyan), var(--sky))',
              color: isGenerating ? 'var(--text-dim)' : '#fff',
              border: 'none',
              cursor: isGenerating ? 'not-allowed' : 'pointer',
              fontSize: '13px', fontWeight: 700, letterSpacing: '0.3px',
              transition: 'all 0.2s',
            }}
          >
            {isGenerating
              ? '⏳ Generating...'
              : isStandardMode && state.seedTCs.length > 0
                ? '✨ Enrich & Expand Seed TCs'
                : hasSeedMode && state.seedTCs.length > 0
                  ? '✨ Enhance Test Cases'
                  : '✨ Generate Test Cases'
            }
          </button>
        ) : (
          <div style={{
            width: '100%', padding: '10px', borderRadius: 'var(--radius)',
            background: 'var(--surface2)', border: '1px solid var(--border)',
            textAlign: 'center', fontSize: '11px', color: 'var(--text-dim)',
            fontFamily: 'var(--font-mono)', letterSpacing: '0.5px',
          }}>
            🔒 View Only — generation requires QA Engineer role
          </div>
        )}

      </div>
    </div>
  );
}
