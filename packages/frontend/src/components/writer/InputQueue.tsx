import { useRef, useState, useEffect } from 'react';
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
  isGroup?: boolean;
  tcIds?: string[];
}

export interface UIScreenEntry {
  url: string;
  label: string;
  envName?: string;
  username?: string;
  password?: string;
  menuContext?: string;
  agenticTrace?: boolean;
  imageBase64?: string;
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

export interface ApiInput {
  tempId: string;
  subType: 'openapi' | 'postman' | 'curl' | 'doc';
  label: string;
  // file-based
  filePath?: string;
  filename?: string;
  mimeType?: string;
  size?: number;
  // curl text
  curlText?: string;
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
  apiInputs: ApiInput[];
  apiSeedTCs: SeedTC[];
  prompts: Array<{ tempId: string; text: string }>;
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
type InputTab = 'prompt' | 'screen' | 'ref' | 'docs' | 'jira' | 'api';

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
  api:    'var(--amber)',
  prompt: 'var(--violet)',
};
const TAB_DIM: Record<InputTab, string> = {
  screen: 'var(--emerald-dim)',
  ref:    'var(--violet-dim)',
  docs:   'var(--cyan-dim)',
  jira:   'var(--cyan-dim)',
  api:    AMBER_BG,
  prompt: 'var(--violet-dim)',
};

// ── Tab button (icon + label, equal-width columns) ────────────
const TAB_META: Record<InputTab, { icon: string; short: string }> = {
  screen: { icon: '🖥',  short: 'Screen' },
  ref:    { icon: '📋', short: 'Ref TCs' },
  docs:   { icon: '📄', short: 'Docs'    },
  jira:   { icon: '🎫', short: 'Jira'    },
  api:    { icon: '⚡', short: 'API'     },
  prompt: { icon: '✍', short: 'Prompt'  },
};

function TabBtn({
  tab, active, count, onClick,
}: {
  tab: InputTab;
  active: boolean;
  count: number;
  onClick: () => void;
}) {
  const color = TAB_COLOR[tab];
  const dim   = TAB_DIM[tab];
  const meta  = TAB_META[tab];
  return (
    <button
      onClick={onClick}
      title={meta.short}
      style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: '2px',
        padding: '6px 2px 5px',
        border: 'none',
        borderRadius: '6px',
        background: active ? dim : 'transparent',
        cursor: 'pointer',
        transition: 'background 0.12s',
        position: 'relative',
        minWidth: 0,
      }}
    >
      <span style={{ fontSize: '14px', lineHeight: 1 }}>{meta.icon}</span>
      <span style={{
        fontSize: '9px',
        fontFamily: 'var(--font-mono)',
        fontWeight: active ? 700 : 400,
        color: active ? color : 'var(--text-dim)',
        whiteSpace: 'nowrap',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        maxWidth: '100%',
      }}>
        {meta.short}
      </span>
      {count > 0 && (
        <span style={{
          position: 'absolute',
          top: '3px',
          right: '4px',
          fontSize: '7px',
          fontWeight: 700,
          minWidth: '12px',
          padding: '0 2px',
          borderRadius: '6px',
          textAlign: 'center',
          background: active ? color : 'var(--text-dim)',
          color: 'var(--bg)',
          lineHeight: '12px',
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
  const apiFileInputRef     = useRef<HTMLInputElement>(null);
  const apiSeedFileInputRef = useRef<HTMLInputElement>(null);

  // Live UI Screen form state
  const [uiEnvId,      setUiEnvId]      = useState('');
  const [uiCustomUrl,  setUiCustomUrl]  = useState('');
  const [uiUsername,   setUiUsername]   = useState('');
  const [uiPassword,   setUiPassword]   = useState('');
  const [uiMenuContext, setUiMenuContext] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [pasteHint, setPasteHint] = useState(false);

  // Seed TC form state
  const [seedInputMode,  setSeedInputMode]  = useState<'manual' | 'excel'>('manual');
  const [seedTitle,      setSeedTitle]      = useState('');
  const [seedSteps,      setSeedSteps]      = useState('');
  const [seedExpected,   setSeedExpected]   = useState('');
  const [isParsing,      setIsParsing]      = useState(false);
  const [seedParseError, setSeedParseError] = useState<string | null>(null);

  // API tab state
  const [curlText,          setCurlText]         = useState('');
  const [isParsingApiSeed,  setIsParsingApiSeed]  = useState(false);
  const [apiSeedParseError, setApiSeedParseError] = useState<string | null>(null);

  // Prompt tab state
  const [promptText, setPromptText] = useState('');

  // Style Ref search
  const [refSearchResults, setRefSearchResults] = useState<{ id: string; tcId: string; title: string; useCaseTag?: string }[]>([]);
  const [refSearchOpen,    setRefSearchOpen]    = useState(false);
  const [useCases,         setUseCases]         = useState<string[]>([]);
  const [isAddingGroup,    setIsAddingGroup]    = useState(false);

  // Active tab — default to 'prompt' (or 'ref' in standard mode)
  const [activeTab, setActiveTab] = useState<InputTab>(isStandardMode ? 'ref' : 'prompt');

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

  const [uploadError,   setUploadError]   = useState<string | null>(null);
  const [isUploading,   setIsUploading]   = useState(false);

  const handleFileDrop = async (files: FileList | null) => {
    if (!files?.length) return;
    setUploadError(null);
    setIsUploading(true);
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
      } catch (err: unknown) {
        const msg = (err as { response?: { data?: { error?: string } }; message?: string })?.response?.data?.error
          ?? (err as { message?: string })?.message
          ?? 'Upload failed';
        setUploadError(msg);
      }
    }
    setIsUploading(false);
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

  // Auto-set test types when API tab becomes active
  useEffect(() => {
    if (activeTab === 'api') {
      onChange({ testTypes: { UI: false, API: true, SIT: true } });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab]);

  // Load use-case list for feature picker on Ref tab
  useEffect(() => {
    if (!projectId || useCases.length > 0) return;
    api.get<{ useCases: string[] }>(`/projects/${projectId}/test-cases/use-cases`)
      .then(r => setUseCases(r.data.useCases ?? []))
      .catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  // Paste screenshot handler — active only on the Screen tab
  useEffect(() => {
    if (activeTab !== 'screen') return;
    const handler = (e: ClipboardEvent) => {
      const items = Array.from(e.clipboardData?.items ?? []);
      const img = items.find(i => i.type.startsWith('image/'));
      if (!img) return;
      const blob = img.getAsFile();
      if (!blob) return;
      const reader = new FileReader();
      reader.onload = () => {
        const dataUrl = reader.result as string;
        const base64 = dataUrl.split(',')[1];
        const newScreen: UIScreenEntry = {
          url: state.uiScreenUrls[0]?.url ?? '(pasted screenshot)',
          label: 'Pasted screenshot',
          envName: state.uiScreenUrls[0]?.envName ?? '',
          username: state.uiScreenUrls[0]?.username ?? '',
          password: state.uiScreenUrls[0]?.password ?? '',
          menuContext: 'Pasted screenshot',
          imageBase64: base64,
        };
        onChange({ uiScreenUrls: [...state.uiScreenUrls, newScreen] });
        setPasteHint(false);
      };
      reader.readAsDataURL(blob);
      e.preventDefault();
    };
    window.addEventListener('paste', handler);
    return () => window.removeEventListener('paste', handler);
  }, [activeTab, state.uiScreenUrls, onChange]);

  // ── API tab handlers ────────────────────────────────────────

  const handleApiFileDrop = async (files: FileList | null, forceSubType?: 'openapi' | 'postman' | 'doc') => {
    if (!files?.length) return;
    for (const file of Array.from(files)) {
      try {
        const result = await onUploadFile(file);
        const lower = file.name.toLowerCase();
        let subType: ApiInput['subType'] = forceSubType ?? 'doc';
        if (!forceSubType) {
          if (lower.endsWith('.yaml') || lower.endsWith('.yml')) subType = 'openapi';
          else if (lower.endsWith('.json')) {
            subType = lower.includes('postman') || lower.includes('collection') ? 'postman' : 'openapi';
          }
        }
        const label = subType === 'openapi' ? `OpenAPI: ${result.filename}`
          : subType === 'postman' ? `Postman: ${result.filename}`
          : result.filename;
        const inp: ApiInput = {
          tempId: `api-${Date.now()}-${Math.random()}`,
          subType, label,
          filePath: result.filePath, filename: result.filename,
          mimeType: result.mimeType, size: result.size,
        };
        onChange({ apiInputs: [...state.apiInputs, inp] });
      } catch { /* skip */ }
    }
  };

  const handleApiCurlAdd = () => {
    const text = curlText.trim();
    if (!text) return;
    const inp: ApiInput = { tempId: `curl-${Date.now()}`, subType: 'curl', label: 'cURL Commands', curlText: text };
    onChange({ apiInputs: [...state.apiInputs, inp] });
    setCurlText('');
  };

  const handleApiSeedExcel = async (files: FileList | null) => {
    if (!files?.length) return;
    setIsParsingApiSeed(true);
    setApiSeedParseError(null);
    try {
      const result = await onUploadFile(files[0]);
      const parsed = await onParseSeedFile(result.filePath);
      if (!parsed.length) { setApiSeedParseError('No test cases found in file'); return; }
      const newSeeds: SeedTC[] = parsed.map((tc, i) => ({
        ...tc,
        type: 'API' as const,
        tempId: `api-seed-${Date.now()}-${i}`,
        source: 'excel' as const,
      }));
      onChange({ apiSeedTCs: [...state.apiSeedTCs, ...newSeeds] });
      if (apiSeedFileInputRef.current) apiSeedFileInputRef.current.value = '';
    } catch {
      setApiSeedParseError('Upload failed. Check the file format and try again.');
    } finally {
      setIsParsingApiSeed(false);
    }
  };

  // Tab badge counts
  const screenCount  = state.uiScreenUrls.length;
  const refCount     = state.refTCs.length + state.seedTCs.length;
  const docsCount    = state.uploadedDocs.length;
  const jiraCount    = state.jiraStories.length;
  const apiCount     = state.apiInputs.length + state.apiSeedTCs.length;
  const promptCount  = state.prompts?.length ?? 0;

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
          padding: '6px 10px',
          gap: '2px',
          borderBottom: '1px solid var(--border)',
          flexShrink: 0,
          background: 'var(--surface)',
        }}>
          <div style={{
            display: 'flex',
            flex: 1,
            gap: '2px',
            background: 'var(--surface2)',
            borderRadius: '8px',
            padding: '2px',
          }}>
            <TabBtn tab="prompt" active={activeTab === 'prompt'} count={promptCount} onClick={() => setActiveTab('prompt')} />
            <TabBtn tab="screen" active={activeTab === 'screen'} count={screenCount} onClick={() => setActiveTab('screen')} />
            <TabBtn tab="ref"    active={activeTab === 'ref'}    count={refCount}    onClick={() => setActiveTab('ref')} />
            <TabBtn tab="docs"   active={activeTab === 'docs'}   count={docsCount}   onClick={() => setActiveTab('docs')} />
            <TabBtn tab="jira"   active={activeTab === 'jira'}   count={jiraCount}   onClick={() => setActiveTab('jira')} />
            <TabBtn tab="api"    active={activeTab === 'api'}    count={apiCount}    onClick={() => setActiveTab('api')} />
          </div>
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
                  {entry.imageBase64 && (
                    <img
                      src={`data:image/png;base64,${entry.imageBase64}`}
                      alt="screenshot"
                      style={{ width: 40, height: 28, objectFit: 'cover', borderRadius: 3, border: '1px solid var(--border)', flexShrink: 0, marginBottom: 3 }}
                    />
                  )}
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
                    {entry.imageBase64 ? (
                      <span>📎 {entry.menuContext ?? 'Screenshot'}</span>
                    ) : (
                      <>
                        {entry.envName && (
                          <><span style={{ color: 'var(--emerald)', fontWeight: 700 }}>{entry.envName}</span>
                          <span style={{ color: 'var(--text-dim)' }}> · </span></>
                        )}
                        {entry.url}
                      </>
                    )}
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

            {/* Screenshot paste/upload zone */}
            <div style={{ marginTop: 8 }}>
              <div
                style={{
                  border: '1px dashed var(--border)',
                  borderRadius: 7,
                  padding: '10px 12px',
                  textAlign: 'center',
                  fontSize: 11,
                  color: 'var(--text-dim)',
                  background: 'var(--bg)',
                  cursor: 'pointer',
                }}
                onClick={() => {
                  const inp = document.createElement('input');
                  inp.type = 'file';
                  inp.accept = 'image/png,image/jpeg,image/jpg';
                  inp.multiple = true;
                  inp.onchange = (e) => {
                    const files = Array.from((e.target as HTMLInputElement).files ?? []);
                    files.forEach(file => {
                      const reader = new FileReader();
                      reader.onload = () => {
                        const dataUrl = reader.result as string;
                        const base64 = dataUrl.split(',')[1];
                        const newScreen: UIScreenEntry = {
                          url: state.uiScreenUrls[0]?.url ?? '(uploaded screenshot)',
                          label: file.name.replace(/\.[^.]+$/, ''),
                          envName: state.uiScreenUrls[0]?.envName ?? '',
                          username: state.uiScreenUrls[0]?.username ?? '',
                          password: state.uiScreenUrls[0]?.password ?? '',
                          menuContext: file.name.replace(/\.[^.]+$/, ''),
                          imageBase64: base64,
                        };
                        onChange({ uiScreenUrls: [...state.uiScreenUrls, newScreen] });
                      };
                      reader.readAsDataURL(file);
                    });
                  };
                  inp.click();
                }}
                onDragOver={e => e.preventDefault()}
                onDrop={e => {
                  e.preventDefault();
                  const files = Array.from(e.dataTransfer.files).filter(f => f.type.startsWith('image/'));
                  files.forEach(file => {
                    const reader = new FileReader();
                    reader.onload = () => {
                      const dataUrl = reader.result as string;
                      const base64 = dataUrl.split(',')[1];
                      onChange({ uiScreenUrls: [...state.uiScreenUrls, {
                        url: state.uiScreenUrls[0]?.url ?? '(dropped screenshot)',
                        label: file.name.replace(/\.[^.]+$/, ''),
                        envName: state.uiScreenUrls[0]?.envName ?? '',
                        username: '',
                        password: '',
                        menuContext: file.name.replace(/\.[^.]+$/, ''),
                        imageBase64: base64,
                      }]});
                    };
                    reader.readAsDataURL(file);
                  });
                }}
              >
                📎 Paste (Ctrl+V) or click to upload screenshot — skip live capture
              </div>
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
                  Search by title, TC-ID, or feature name — agent mimics step patterns and avoids duplication.
                </p>
                {state.refTCs.map((ref, i) => (
                  <div key={i} style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                    {ref.isGroup ? (
                      <div style={{ flex: 1, padding: '6px 10px', background: 'var(--cyan-dim)', border: '1px solid rgba(6,182,212,0.3)', borderRadius: 'var(--radius)', fontSize: '11px', color: 'var(--cyan)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span>📁</span>
                        <span style={{ fontWeight: 600 }}>{ref.label}</span>
                        {ref.tcIds && <span style={{ fontSize: '9px', opacity: 0.7, fontFamily: 'var(--font-mono)' }}>({ref.tcIds.length} TCs)</span>}
                      </div>
                    ) : (
                      <div style={{ flex: 1, padding: '6px 10px', background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', fontFamily: 'var(--font-mono)', fontSize: '11px', color: 'var(--violet)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {ref.label}
                      </div>
                    )}
                    <div
                      style={iconBtn('var(--rose)', 'var(--rose-dim)', 'rgba(220,38,38,0.2)')}
                      onClick={() => onChange({ refTCs: state.refTCs.filter((_, idx) => idx !== i) })}
                    >✕</div>
                  </div>
                ))}
                <div style={{ position: 'relative' }}>
                  <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                    <input
                      className="input-field"
                      style={{ flex: 1, fontSize: '11px', padding: '7px 10px', borderStyle: 'dashed' }}
                      placeholder="Search TC, title, or feature name…"
                      value={state.refTCInput}
                      autoComplete="off"
                      onChange={(e) => {
                        const q = e.target.value;
                        onChange({ refTCInput: q });
                        if (!projectId || q.trim().length < 1) { setRefSearchResults([]); setRefSearchOpen(false); return; }
                        api.get<{ testCases: { id: string; tcId: string; title: string; useCaseTag?: string }[] }>(
                          `/projects/${projectId}/test-cases/search?q=${encodeURIComponent(q.trim())}`
                        ).then(r => { setRefSearchResults(r.data.testCases ?? []); setRefSearchOpen(true); }).catch(() => {});
                        setRefSearchOpen(true);
                      }}
                      onKeyDown={(e) => { if (e.key === 'Enter') { addRefTC(); setRefSearchOpen(false); } if (e.key === 'Escape') setRefSearchOpen(false); }}
                      onFocus={() => { if (refSearchResults.length > 0 || state.refTCInput.trim().length > 0) setRefSearchOpen(true); }}
                      onBlur={() => setTimeout(() => setRefSearchOpen(false), 200)}
                    />
                    <div
                      style={{ width: '28px', height: '28px', borderRadius: '5px', background: 'transparent', border: '1px dashed var(--border2)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '16px', color: 'var(--text-dim)', cursor: 'pointer', flexShrink: 0 }}
                      onClick={() => { addRefTC(); setRefSearchOpen(false); }}
                    >+</div>
                  </div>
                  {refSearchOpen && (() => {
                    const q = state.refTCInput.trim().toLowerCase();
                    const matchingFeatures = q.length >= 1
                      ? useCases.filter(uc => uc.toLowerCase().includes(q) && !state.refTCs.some(r => r.isGroup && r.id === `group:${uc}`))
                      : [];
                    const hasContent = matchingFeatures.length > 0 || refSearchResults.length > 0;
                    if (!hasContent) return null;
                    return (
                      <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 50, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 6, marginTop: 2, maxHeight: 220, overflowY: 'auto', boxShadow: '0 4px 12px rgba(0,0,0,0.15)' }}>
                        {/* Feature groups section */}
                        {matchingFeatures.length > 0 && (
                          <>
                            <div style={{ padding: '4px 10px', fontSize: '9px', fontFamily: 'var(--font-mono)', textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-dim)', background: 'var(--surface2)', borderBottom: '1px solid var(--border)' }}>
                              Features
                            </div>
                            {matchingFeatures.map(uc => (
                              <div
                                key={`uc-${uc}`}
                                onMouseDown={async (e) => {
                                  e.preventDefault();
                                  setRefSearchOpen(false);
                                  onChange({ refTCInput: '' });
                                  setIsAddingGroup(true);
                                  try {
                                    const res = await api.get<{ testCases: { id: string; tcId: string }[] }>(
                                      `/projects/${projectId}/test-cases?useCaseTag=${encodeURIComponent(uc)}&limit=100`
                                    );
                                    const tcs = res.data.testCases ?? [];
                                    const tcIds = tcs.map(tc => tc.tcId);
                                    onChange({
                                      refTCs: [...state.refTCs, { id: `group:${uc}`, label: uc, isGroup: true, tcIds }],
                                    });
                                  } catch { /* silent */ } finally {
                                    setIsAddingGroup(false);
                                  }
                                }}
                                style={{ padding: '7px 10px', cursor: 'pointer', borderBottom: '1px solid var(--border)', display: 'flex', gap: 8, alignItems: 'center' }}
                                onMouseEnter={e => (e.currentTarget.style.background = 'var(--cyan-dim)')}
                                onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                              >
                                <span style={{ fontSize: '13px', flexShrink: 0 }}>📁</span>
                                <div style={{ flex: 1, minWidth: 0 }}>
                                  <div style={{ fontSize: '11px', fontWeight: 600, color: 'var(--cyan)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{uc}</div>
                                  <div style={{ fontSize: '9px', color: 'var(--text-dim)', marginTop: 1 }}>Add all TCs as style reference</div>
                                </div>
                              </div>
                            ))}
                          </>
                        )}
                        {/* Individual TC results */}
                        {refSearchResults.length > 0 && (
                          <>
                            {matchingFeatures.length > 0 && (
                              <div style={{ padding: '4px 10px', fontSize: '9px', fontFamily: 'var(--font-mono)', textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-dim)', background: 'var(--surface2)', borderBottom: '1px solid var(--border)' }}>
                                Test Cases
                              </div>
                            )}
                            {refSearchResults.map(tc => (
                              <div
                                key={tc.id}
                                onMouseDown={(e) => {
                                  e.preventDefault();
                                  if (state.refTCs.some(r => r.id === tc.tcId)) return;
                                  onChange({ refTCs: [...state.refTCs, { id: tc.tcId, label: `${tc.tcId} — ${tc.title}` }], refTCInput: '' });
                                  setRefSearchResults([]);
                                  setRefSearchOpen(false);
                                }}
                                style={{ padding: '7px 10px', cursor: 'pointer', borderBottom: '1px solid var(--border)', display: 'flex', gap: 8, alignItems: 'flex-start' }}
                                onMouseEnter={e => (e.currentTarget.style.background = 'var(--surface2)')}
                                onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                              >
                                <span style={{ fontFamily: 'var(--font-mono)', fontSize: '10px', color: 'var(--violet)', flexShrink: 0, paddingTop: 1 }}>{tc.tcId}</span>
                                <div style={{ flex: 1, minWidth: 0 }}>
                                  <div style={{ fontSize: '11px', color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{tc.title}</div>
                                  {tc.useCaseTag && <div style={{ fontSize: '9px', color: 'var(--text-dim)', marginTop: 1 }}>{tc.useCaseTag}</div>}
                                </div>
                              </div>
                            ))}
                          </>
                        )}
                      </div>
                    );
                  })()}
                  {isAddingGroup && (
                    <div style={{ fontSize: '9px', color: 'var(--cyan)', marginTop: 4, fontFamily: 'var(--font-mono)' }}>Loading feature TCs…</div>
                  )}
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
                  <div style={{ fontFamily: 'var(--font-mono)', fontSize: '9px', color: 'var(--text-dim)' }}>{doc.size < 1024 * 1024 ? `${Math.round(doc.size / 1024)} KB` : `${(doc.size / 1024 / 1024).toFixed(1)} MB`}</div>
                </div>
                <div
                  style={{ color: 'var(--rose)', cursor: 'pointer', fontSize: '11px', padding: '2px 4px' }}
                  onClick={() => onChange({ uploadedDocs: state.uploadedDocs.filter((d) => d.tempId !== doc.tempId) })}
                >✕</div>
              </div>
            ))}

            <div
              style={{ border: `1.5px dashed ${isUploading ? 'var(--cyan)' : 'var(--border2)'}`, borderRadius: 'var(--radius)', padding: '18px', textAlign: 'center', cursor: isUploading ? 'wait' : 'pointer', transition: 'all 0.2s', background: isUploading ? 'var(--cyan-dim)' : 'transparent' }}
              onDragOver={(e) => { e.preventDefault(); if (!isUploading) { (e.currentTarget as HTMLElement).style.borderColor = 'var(--cyan)'; (e.currentTarget as HTMLElement).style.background = 'var(--cyan-dim)'; } }}
              onDragLeave={(e) => { (e.currentTarget as HTMLElement).style.borderColor = isUploading ? 'var(--cyan)' : 'var(--border2)'; (e.currentTarget as HTMLElement).style.background = isUploading ? 'var(--cyan-dim)' : 'transparent'; }}
              onDrop={(e) => { e.preventDefault(); (e.currentTarget as HTMLElement).style.borderColor = 'var(--border2)'; (e.currentTarget as HTMLElement).style.background = 'transparent'; if (!isUploading) handleFileDrop(e.dataTransfer.files); }}
              onClick={() => { if (!isUploading) fileInputRef.current?.click(); }}
            >
              <div style={{ fontSize: '22px', marginBottom: '6px' }}>{isUploading ? '⏳' : '📁'}</div>
              <div style={{ fontSize: '12px', color: 'var(--text-mid)', lineHeight: 1.5 }}>
                {isUploading ? 'Uploading…' : <><strong>Drop PDF / Word / Excel / HLD</strong> or click</>}<br />
                <span style={{ fontSize: '10px', color: 'var(--text-dim)' }}>Multiple files supported</span>
              </div>
              <input ref={fileInputRef} type="file" multiple accept=".pdf,.xlsx,.xls,.docx,.doc,.txt,.md"
                style={{ opacity: 0, position: 'absolute', width: 0, height: 0 }}
                onChange={(e) => { handleFileDrop(e.target.files); e.target.value = ''; }}
              />
            </div>
            {uploadError && (
              <div style={{ fontSize: '10px', color: 'var(--fail)', marginTop: 4, padding: '4px 8px', background: 'rgba(220,38,38,0.08)', borderRadius: 4 }}>
                {uploadError}
              </div>
            )}
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

        {/* ════════════════════════════
            API PANEL
        ═══════════════════════════ */}
        {activeTab === 'api' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>

            {/* OpenAPI / Swagger */}
            <div>
              <span style={FL}>OpenAPI / Swagger Spec</span>
              <div
                onDragOver={e => e.preventDefault()}
                onDrop={e => { e.preventDefault(); void handleApiFileDrop(e.dataTransfer.files, 'openapi'); }}
                onClick={() => { const i = document.createElement('input'); i.type = 'file'; i.accept = '.json,.yaml,.yml'; i.multiple = true; i.onchange = (e) => void handleApiFileDrop((e.target as HTMLInputElement).files, 'openapi'); i.click(); }}
                style={{
                  border: '1px dashed var(--border)', borderRadius: 7, padding: '10px 12px',
                  cursor: 'pointer', textAlign: 'center', fontSize: 11, color: 'var(--text-dim)',
                  background: 'var(--bg)',
                }}
              >
                Drop .json / .yaml / .yml or click to upload
              </div>
            </div>

            {/* Postman Collection */}
            <div>
              <span style={FL}>Postman Collection</span>
              <div
                onDragOver={e => e.preventDefault()}
                onDrop={e => { e.preventDefault(); void handleApiFileDrop(e.dataTransfer.files, 'postman'); }}
                onClick={() => { const i = document.createElement('input'); i.type = 'file'; i.accept = '.json'; i.multiple = true; i.onchange = (e) => void handleApiFileDrop((e.target as HTMLInputElement).files, 'postman'); i.click(); }}
                style={{
                  border: '1px dashed var(--border)', borderRadius: 7, padding: '10px 12px',
                  cursor: 'pointer', textAlign: 'center', fontSize: 11, color: 'var(--text-dim)',
                  background: 'var(--bg)',
                }}
              >
                Drop Postman collection .json or click to upload
              </div>
            </div>

            {/* cURL Commands */}
            <div>
              <span style={FL}>cURL Commands</span>
              <textarea
                value={curlText}
                onChange={e => setCurlText(e.target.value)}
                placeholder={"curl -X POST https://api.example.com/v1/resource \\\n  -H 'Authorization: Bearer TOKEN' \\\n  -d '{\"field\": \"value\"}'\n\n# Paste multiple cURL commands — one per block"}
                rows={5}
                style={{
                  width: '100%', boxSizing: 'border-box', padding: '8px 10px',
                  background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 7,
                  color: 'var(--text)', fontSize: 11, fontFamily: 'var(--font-mono)',
                  resize: 'vertical', outline: 'none',
                }}
              />
              <button
                type="button"
                disabled={!curlText.trim()}
                onClick={handleApiCurlAdd}
                style={{
                  marginTop: 5, padding: '5px 14px', borderRadius: 6, fontSize: 11, fontWeight: 700,
                  background: curlText.trim() ? AMBER_BG : 'var(--bg)',
                  border: `1px solid ${curlText.trim() ? AMBER_BORDER : 'var(--border)'}`,
                  color: curlText.trim() ? AMBER : 'var(--text-dim)',
                  cursor: curlText.trim() ? 'pointer' : 'not-allowed',
                }}
              >
                + Add cURL
              </button>
            </div>

            {/* Generic Docs */}
            <div>
              <span style={FL}>Supporting Docs (BRD, specs, test data)</span>
              <div
                onDragOver={e => e.preventDefault()}
                onDrop={e => { e.preventDefault(); void handleApiFileDrop(e.dataTransfer.files, 'doc'); }}
                onClick={() => { const i = document.createElement('input'); i.type = 'file'; i.accept = '.pdf,.docx,.doc,.txt,.md,.xlsx,.xls'; i.multiple = true; i.onchange = (e) => void handleApiFileDrop((e.target as HTMLInputElement).files, 'doc'); i.click(); }}
                style={{
                  border: '1px dashed var(--border)', borderRadius: 7, padding: '10px 12px',
                  cursor: 'pointer', textAlign: 'center', fontSize: 11, color: 'var(--text-dim)',
                  background: 'var(--bg)',
                }}
              >
                Drop PDF, Word, Excel, TXT, MD or click — multiple files supported
              </div>
            </div>

            {/* Seed TCs */}
            <div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
                <span style={FL}>Seed TCs (Excel)</span>
                <button type="button" onClick={handleDownloadTemplate} style={{ fontSize: 9, color: 'var(--text-dim)', background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline' }}>Download template</button>
              </div>
              <label style={{
                display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px',
                border: '1px dashed var(--border)', borderRadius: 7, cursor: 'pointer',
                background: 'var(--bg)', fontSize: 11, color: 'var(--text-dim)',
              }}>
                <input ref={apiSeedFileInputRef} type="file" accept=".xlsx,.xls" style={{ display: 'none' }}
                  onChange={e => void handleApiSeedExcel(e.target.files)} disabled={isParsingApiSeed} />
                {isParsingApiSeed ? '⏳ Parsing…' : '📎 Upload seed TC Excel (auto-typed as API)'}
              </label>
              {apiSeedParseError && <div style={{ fontSize: 10, color: 'var(--fail)', marginTop: 4 }}>{apiSeedParseError}</div>}
            </div>

            {/* Loaded API inputs list */}
            {(state.apiInputs.length > 0 || state.apiSeedTCs.length > 0) && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <span style={FL}>Loaded ({state.apiInputs.length + state.apiSeedTCs.length})</span>
                {state.apiInputs.map(inp => (
                  <div key={inp.tempId} style={{
                    display: 'flex', alignItems: 'center', gap: 8, padding: '5px 10px',
                    background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 6,
                  }}>
                    <span style={{ fontSize: 10 }}>
                      {inp.subType === 'openapi' ? '📄' : inp.subType === 'postman' ? '📮' : inp.subType === 'curl' ? '⚡' : '📎'}
                    </span>
                    <span style={{ flex: 1, fontSize: 11, color: 'var(--text-mid)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{inp.label}</span>
                    <button type="button" onClick={() => onChange({ apiInputs: state.apiInputs.filter(a => a.tempId !== inp.tempId) })}
                      style={{ ...iconBtn('var(--fail)', 'transparent', 'transparent'), fontSize: 12 }}>✕</button>
                  </div>
                ))}
                {state.apiSeedTCs.map(tc => (
                  <div key={tc.tempId} style={{
                    display: 'flex', alignItems: 'center', gap: 8, padding: '5px 10px',
                    background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 6,
                  }}>
                    <span style={{ fontSize: 10 }}>🧪</span>
                    <span style={{ fontSize: 9, fontWeight: 700, padding: '1px 5px', borderRadius: 3, background: 'rgba(245,158,11,0.12)', color: AMBER }}>SEED</span>
                    <span style={{ flex: 1, fontSize: 11, color: 'var(--text-mid)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{tc.title}</span>
                    <button type="button" onClick={() => onChange({ apiSeedTCs: state.apiSeedTCs.filter(s => s.tempId !== tc.tempId) })}
                      style={{ ...iconBtn('var(--fail)', 'transparent', 'transparent'), fontSize: 12 }}>✕</button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ════════════════════════════
            PROMPT PANEL
        ═══════════════════════════ */}
        {activeTab === 'prompt' && !isStandardMode && (
          <>
            <p style={{ fontSize: '9px', fontFamily: 'var(--font-mono)', color: 'var(--text-dim)', lineHeight: 1.5 }}>
              Describe what to test in plain language. The most direct way to focus the LLM — pair with skills for best results.
            </p>

            {/* Added prompts */}
            {(state.prompts ?? []).map((p, i) => (
              <div key={p.tempId} style={{ display: 'flex', gap: '6px', alignItems: 'flex-start' }}>
                <div style={{
                  flex: 1, padding: '7px 10px',
                  background: 'var(--violet-dim)', border: '1px solid rgba(139,92,246,0.3)',
                  borderRadius: 'var(--radius)', fontSize: '11px', color: 'var(--text)',
                  lineHeight: 1.5, whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                }}>
                  {p.text}
                </div>
                <div
                  style={iconBtn('var(--rose)', 'var(--rose-dim)', 'rgba(220,38,38,0.2)')}
                  onClick={() => onChange({ prompts: state.prompts.filter((_, idx) => idx !== i) })}
                >✕</div>
              </div>
            ))}

            {/* Input area */}
            <textarea
              className="input-field"
              placeholder={"Describe what to test, e.g.:\n\"Generate POS Sales test cases for the order creation flow. Focus on payment methods (Cash and Airtel Money). Exclude login and cash register setup — those are handled by suite setup.\""}
              value={promptText}
              onChange={(e) => setPromptText(e.target.value)}
              style={{ fontSize: '11px', lineHeight: '1.6', minHeight: '100px', resize: 'vertical', borderColor: 'rgba(139,92,246,0.35)' }}
            />
            <button
              onClick={() => {
                const text = promptText.trim();
                if (!text) return;
                onChange({ prompts: [...(state.prompts ?? []), { tempId: `prompt-${Date.now()}`, text }] });
                setPromptText('');
              }}
              disabled={!promptText.trim()}
              style={{
                width: '100%', padding: '7px', borderRadius: 'var(--radius)',
                background: promptText.trim() ? 'var(--violet-dim)' : 'var(--surface3)',
                border: `1px solid ${promptText.trim() ? 'rgba(139,92,246,0.4)' : 'var(--border)'}`,
                color: promptText.trim() ? 'var(--violet)' : 'var(--text-dim)',
                fontSize: '11px', fontWeight: 700,
                cursor: promptText.trim() ? 'pointer' : 'default',
                transition: 'all 0.15s',
              }}
            >
              + Add Prompt
            </button>
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
