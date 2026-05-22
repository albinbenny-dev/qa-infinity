import { useRef, useState } from 'react';
import type { EnvConfig } from '../../types';

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
}

interface UploadedDoc {
  tempId: string;
  filename: string;
  filePath: string;
  mimeType: string;
  size: number;
}

export interface InputQueueState {
  jiraStories: JiraStory[];
  jiraInput: string;
  refTCs: RefTC[];
  refTCInput: string;
  uploadedDocs: UploadedDoc[];
  uiScreenUrls: UIScreenEntry[];
  additionalContext: string;
  testTypes: { UI: boolean; API: boolean; SIT: boolean };
}

interface InputQueueProps {
  state: InputQueueState;
  onChange: (patch: Partial<InputQueueState>) => void;
  onUploadFile: (file: File) => Promise<{ filePath: string; filename: string; mimeType: string; size: number }>;
  onGenerate: () => void;
  isGenerating: boolean;
  inputCount: number;
  envConfigs?: EnvConfig[];
}

const SECTION_LABEL: React.CSSProperties = {
  fontSize: '10px',
  fontWeight: 700,
  letterSpacing: '0.8px',
  color: 'var(--text-mid)',
  textTransform: 'uppercase',
  fontFamily: 'var(--font-mono)',
};

const SECTION_HEADER: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  marginBottom: '8px',
};

const DIVIDER: React.CSSProperties = {
  height: '1px',
  background: 'var(--border)',
  margin: '4px -14px',
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

export default function InputQueue({
  state,
  onChange,
  onUploadFile,
  onGenerate,
  isGenerating,
  inputCount,
  envConfigs = [],
}: InputQueueProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Pending Live UI Screen form state (local only — not part of InputQueueState)
  const [uiEnvId, setUiEnvId] = useState('');          // env.id | '__custom__' | ''
  const [uiCustomUrl, setUiCustomUrl] = useState('');
  const [uiUsername, setUiUsername] = useState('');
  const [uiPassword, setUiPassword] = useState('');
  const [uiMenuContext, setUiMenuContext] = useState('');
  const [showPassword, setShowPassword] = useState(false);

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
      } catch {
        // silently skip failed uploads
      }
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

  function addUIScreen() {
    if (uiEnvId === '__custom__') {
      const raw = uiCustomUrl.trim();
      if (!raw) return;
      const url = raw.startsWith('http') ? raw : `https://${raw}`;
      const entry: UIScreenEntry = {
        url,
        label: url,
        username: uiUsername.trim() || undefined,
        password: uiPassword.trim() || undefined,
        menuContext: uiMenuContext.trim() || undefined,
      };
      onChange({ uiScreenUrls: [...state.uiScreenUrls, entry] });
    } else if (uiEnvId && selectedEnv) {
      const entry: UIScreenEntry = {
        url: selectedEnv.baseUrl,
        label: selectedEnv.baseUrl,
        envName: selectedEnv.name,
        username: selectedEnv.username ?? undefined,
        password: selectedEnv.password ?? undefined,
        menuContext: uiMenuContext.trim() || undefined,
      };
      onChange({ uiScreenUrls: [...state.uiScreenUrls, entry] });
    } else {
      return;
    }
    // Reset form
    setUiEnvId('');
    setUiCustomUrl('');
    setUiUsername('');
    setUiPassword('');
    setUiMenuContext('');
    setShowPassword(false);
  }

  const canAddScreen = uiEnvId === '__custom__' ? uiCustomUrl.trim().length > 0 : uiEnvId !== '';

  return (
    <div className="card" style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden', maxHeight: '100%' }}>
      <div style={{ height: '4px', background: 'var(--warm-accent)', flexShrink: 0 }} />

      <div className="card-header" style={{ flexShrink: 0 }}>
        <div className="card-title">📥 Multi-Input Sources</div>
        <span className="badge badge-cyan">{inputCount} input{inputCount !== 1 ? 's' : ''}</span>
      </div>

      <div className="card-body" style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column' }}>

        {/* ── JIRA STORIES ── */}
        <div style={{ paddingBottom: '12px' }}>
          <div style={SECTION_HEADER}>
            <span style={SECTION_LABEL}>🔵 Jira Stories</span>
            <button
              onClick={addJiraStory}
              style={{ fontFamily: 'var(--font-mono)', fontSize: '9px', color: 'var(--cyan)', background: 'var(--cyan-dim)', border: '1px solid rgba(37,99,171,0.25)', borderRadius: '4px', padding: '2px 8px', cursor: 'pointer' }}
            >+ Add Story</button>
          </div>

          {state.jiraStories.map((story, i) => (
            <div key={i} style={{ display: 'flex', gap: '6px', alignItems: 'center', marginBottom: '6px' }}>
              <div style={{ flex: 1, padding: '6px 10px', background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', fontFamily: 'var(--font-mono)', fontSize: '11px', color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {story.url}
              </div>
              <div
                style={iconBtn(
                  story.status === 'verified' ? 'var(--emerald)' : 'var(--text-dim)',
                  story.status === 'verified' ? 'var(--emerald-dim)' : 'var(--surface2)',
                  story.status === 'verified' ? 'rgba(42,157,143,0.3)' : 'var(--border)',
                )}
                onClick={() => {
                  const updated = [...state.jiraStories];
                  updated[i] = { ...updated[i], status: 'verified' };
                  onChange({ jiraStories: updated });
                }}
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
        </div>

        <div style={DIVIDER} />

        {/* ── REFERENCE TEST CASES ── */}
        <div style={{ padding: '12px 0' }}>
          <div style={SECTION_HEADER}>
            <span style={SECTION_LABEL}>📋 Reference Test Cases</span>
            <button
              onClick={addRefTC}
              style={{ fontFamily: 'var(--font-mono)', fontSize: '9px', color: 'var(--violet)', background: 'var(--violet-dim)', border: '1px solid rgba(244,123,32,0.25)', borderRadius: '4px', padding: '2px 8px', cursor: 'pointer' }}
            >+ Add Ref</button>
          </div>

          {state.refTCs.map((ref, i) => (
            <div key={i} style={{ display: 'flex', gap: '6px', alignItems: 'center', marginBottom: '6px' }}>
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
        </div>

        <div style={DIVIDER} />

        {/* ── ATTACHED DOCUMENTS ── */}
        <div style={{ padding: '12px 0' }}>
          <div style={SECTION_HEADER}>
            <span style={SECTION_LABEL}>📎 Attached Documents</span>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: '9px', color: 'var(--text-dim)' }}>
              {state.uploadedDocs.length} file{state.uploadedDocs.length !== 1 ? 's' : ''}
            </span>
          </div>

          {state.uploadedDocs.map((doc) => (
            <div key={doc.tempId} style={{ padding: '7px 10px', background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
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
        </div>

        <div style={DIVIDER} />

        {/* ── LIVE UI SCREEN ── */}
        <div style={{ padding: '12px 0' }}>
          <div style={SECTION_HEADER}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span style={SECTION_LABEL}>🖥 Live UI Screen</span>
              <span
                title="AI takes a real screenshot of the URL and analyses the interface using vision to generate test cases. Can be used as the sole input source."
                style={{
                  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                  width: '14px', height: '14px', borderRadius: '50%',
                  background: 'var(--cyan-dim)', border: '1px solid rgba(37,99,171,0.3)',
                  fontSize: '8px', color: 'var(--cyan)', cursor: 'default', fontWeight: 700, flexShrink: 0,
                }}
              >?</span>
              <span style={{
                fontFamily: 'var(--font-mono)', fontSize: '8px',
                color: 'var(--emerald)', background: 'var(--emerald-dim)',
                border: '1px solid rgba(42,157,143,0.25)', borderRadius: '3px',
                padding: '1px 5px',
              }}>standalone</span>
            </div>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: '9px', color: 'var(--text-dim)' }}>
              {state.uiScreenUrls.length} screen{state.uiScreenUrls.length !== 1 ? 's' : ''}
            </span>
          </div>

          <p style={{ fontFamily: 'var(--font-mono)', fontSize: '9px', color: 'var(--text-dim)', lineHeight: 1.5, marginBottom: '10px' }}>
            Vision AI screenshots the live URL and derives test cases from the UI. Use alone or alongside other inputs.
          </p>

          {/* Added screens */}
          {state.uiScreenUrls.map((entry, i) => (
            <div key={i} style={{ display: 'flex', gap: '6px', alignItems: 'flex-start', marginBottom: '6px' }}>
              <div
                style={{
                  width: '26px', height: '26px', borderRadius: '5px',
                  background: 'var(--emerald-dim)', border: '1px solid rgba(42,157,143,0.25)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: '12px', flexShrink: 0, marginTop: '1px',
                }}
              >🖥</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{
                  padding: '5px 10px',
                  background: 'var(--surface2)',
                  border: '1px solid rgba(42,157,143,0.2)',
                  borderRadius: 'var(--radius)',
                  fontFamily: 'var(--font-mono)', fontSize: '10px', color: 'var(--text)',
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                }} title={entry.url}>
                  {entry.envName ? (
                    <><span style={{ color: 'var(--emerald)', fontWeight: 700 }}>{entry.envName}</span>
                    <span style={{ color: 'var(--text-dim)' }}> · </span></>
                  ) : null}
                  {entry.url}
                </div>
                {entry.menuContext && (
                  <div style={{
                    marginTop: '3px', fontFamily: 'var(--font-mono)', fontSize: '9px',
                    color: 'var(--amber)', display: 'flex', alignItems: 'center', gap: '4px',
                  }}>
                    <span>📋</span>
                    <span>{entry.menuContext}</span>
                  </div>
                )}
                {(entry.username) && (
                  <div style={{ marginTop: '2px', fontFamily: 'var(--font-mono)', fontSize: '9px', color: 'var(--text-dim)' }}>
                    👤 {entry.username}
                  </div>
                )}
              </div>
              <div
                style={iconBtn('var(--rose)', 'var(--rose-dim)', 'rgba(220,38,38,0.2)')}
                onClick={() => onChange({ uiScreenUrls: state.uiScreenUrls.filter((_, idx) => idx !== i) })}
              >✕</div>
            </div>
          ))}

          {/* Add screen form */}
          <div style={{
            padding: '10px 12px',
            background: 'rgba(42,157,143,0.04)',
            border: '1px solid rgba(42,157,143,0.18)',
            borderRadius: 'var(--radius)',
          }}>
            {/* Env dropdown */}
            <div style={{ marginBottom: '8px' }}>
              <label style={{ ...SECTION_LABEL, fontSize: '9px', marginBottom: '4px', display: 'block' }}>
                Environment / URL
              </label>
              <select
                value={uiEnvId}
                onChange={(e) => {
                  setUiEnvId(e.target.value);
                  setUiCustomUrl('');
                  setUiUsername('');
                  setUiPassword('');
                }}
                className="input-field"
                style={{ width: '100%', padding: '6px 10px', fontSize: '11px', borderColor: 'rgba(42,157,143,0.3)' }}
              >
                <option value="">— Select environment or add new —</option>
                {envConfigs.map((env) => (
                  <option key={env.id} value={env.id}>
                    {env.name} · {env.baseUrl}
                  </option>
                ))}
                <option value="__custom__">+ Enter custom URL…</option>
              </select>
            </div>

            {/* Custom URL fields */}
            {uiEnvId === '__custom__' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginBottom: '8px' }}>
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
                      style={{
                        position: 'absolute', right: '6px', top: '50%', transform: 'translateY(-50%)',
                        background: 'none', border: 'none', cursor: 'pointer',
                        fontSize: '10px', color: 'var(--text-dim)', padding: '0',
                      }}
                    >{showPassword ? '🙈' : '👁'}</button>
                  </div>
                </div>
              </div>
            )}

            {/* Selected env display */}
            {uiEnvId && uiEnvId !== '__custom__' && selectedEnv && (
              <div style={{
                padding: '6px 10px', marginBottom: '8px',
                background: 'var(--surface2)', borderRadius: 'var(--radius)',
                fontFamily: 'var(--font-mono)', fontSize: '10px', color: 'var(--text-dim)',
                display: 'flex', alignItems: 'center', gap: '8px',
              }}>
                <span style={{ color: 'var(--emerald)', fontWeight: 700 }}>{selectedEnv.name}</span>
                <span>·</span>
                <span style={{ color: 'var(--text)' }}>{selectedEnv.baseUrl}</span>
                {selectedEnv.username && (
                  <>
                    <span>·</span>
                    <span>👤 {selectedEnv.username}</span>
                  </>
                )}
              </div>
            )}

            {/* Menu/Page context — shown once env or custom URL is chosen */}
            {(uiEnvId) && (
              <div style={{ marginBottom: '8px' }}>
                <label style={{ ...SECTION_LABEL, fontSize: '9px', marginBottom: '4px', display: 'block' }}>
                  Which page / menu to test?
                </label>
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

            {/* Add button */}
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
        </div>

        <div style={DIVIDER} />

        {/* ── ADDITIONAL CONTEXT ── */}
        <div style={{ padding: '12px 0' }}>
          <div style={{ ...SECTION_LABEL, marginBottom: '6px' }}>💬 Additional Context</div>
          <textarea
            className="input-field"
            style={{ minHeight: '64px', fontSize: '12px', lineHeight: '1.6', resize: 'vertical', width: '100%', boxSizing: 'border-box' }}
            placeholder="Scope, constraints, edge case focus..."
            value={state.additionalContext}
            onChange={(e) => onChange({ additionalContext: e.target.value })}
          />
        </div>

        <div style={DIVIDER} />

        {/* ── TEST TYPES ── */}
        <div style={{ padding: '12px 0' }}>
          <div style={{ ...SECTION_LABEL, marginBottom: '8px' }}>Test Types to Generate</div>
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

        {/* ── GENERATE ── */}
        <button
          onClick={onGenerate}
          disabled={isGenerating}
          style={{
            width: '100%', padding: '11px', borderRadius: 'var(--radius)',
            background: isGenerating ? 'var(--surface3)' : 'linear-gradient(135deg, var(--cyan), var(--sky))',
            color: isGenerating ? 'var(--text-dim)' : '#fff',
            border: 'none', cursor: isGenerating ? 'not-allowed' : 'pointer',
            fontSize: '13px', fontWeight: 700, letterSpacing: '0.3px',
            transition: 'all 0.2s', marginBottom: '4px',
          }}
        >
          {isGenerating ? '⏳ Generating...' : '✨ Generate Test Cases'}
        </button>

      </div>
    </div>
  );
}
