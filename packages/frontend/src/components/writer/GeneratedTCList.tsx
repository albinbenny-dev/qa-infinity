import { useState, useRef, useEffect } from 'react';
import type { TestCase } from '../../types';

interface GeneratedTC extends Omit<TestCase, 'id' | 'projectId' | 'tcId' | 'status'> {
  _tempId: string;
  sourceRef?: string;
}

interface GeneratedTCListProps {
  testCases: GeneratedTC[];
  selectedIds: Set<string>;
  onToggleSelect: (id: string) => void;
  onSelectAll: () => void;
  onClearSelection: () => void;
  onEdit: (tempId: string, patch: Partial<GeneratedTC>) => void;
  onSave: (tcs: GeneratedTC[]) => void;
  onDelete: (tempId: string) => void;
  onDeleteSelected: () => void;
  onApprove: (tc: GeneratedTC) => void;
  isSaving: boolean;
}

const TYPE_COLORS: Record<string, { bg: string; color: string; border: string }> = {
  UI:  { bg: 'var(--rose-dim)',    color: 'var(--rose)',    border: 'rgba(220,38,38,0.25)' },
  API: { bg: 'var(--cyan-dim)',    color: 'var(--cyan)',    border: 'rgba(37,99,171,0.25)' },
  SIT: { bg: 'var(--emerald-dim)', color: 'var(--emerald)', border: 'rgba(42,157,143,0.25)' },
};

const PRIORITY_COLORS: Record<string, { color: string; bg: string; border: string }> = {
  CRITICAL: { color: '#DC2626', bg: 'rgba(220,38,38,0.08)',  border: 'rgba(220,38,38,0.25)' },
  HIGH:     { color: '#F47B20', bg: 'rgba(244,123,32,0.08)', border: 'rgba(244,123,32,0.25)' },
  MEDIUM:   { color: 'var(--cyan)', bg: 'var(--cyan-dim)',   border: 'rgba(37,99,171,0.2)' },
  LOW:      { color: 'var(--text-dim)', bg: 'var(--surface2)', border: 'var(--border)' },
};

const LABEL: React.CSSProperties = {
  fontSize: '9px', fontWeight: 700, letterSpacing: '0.7px',
  textTransform: 'uppercase', fontFamily: 'var(--font-mono)',
  color: 'var(--text-dim)', marginBottom: '4px',
};

function TCCard({
  tc,
  isSaved,
  isSelected,
  onToggleSelect,
  onEdit,
  onDelete,
  onApprove,
}: {
  tc: GeneratedTC;
  isSaved: boolean;
  isSelected: boolean;
  onToggleSelect: () => void;
  onEdit: (patch: Partial<GeneratedTC>) => void;
  onDelete: () => void;
  onApprove: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [newTag, setNewTag] = useState('');
  const [newStep, setNewStep] = useState('');
  const [focusInsertIdx, setFocusInsertIdx] = useState<number | null>(null);
  const stepRefs = useRef<(HTMLInputElement | null)[]>([]);

  useEffect(() => {
    if (focusInsertIdx !== null && stepRefs.current[focusInsertIdx]) {
      stepRefs.current[focusInsertIdx]?.focus();
      setFocusInsertIdx(null);
    }
  }, [tc.steps.length, focusInsertIdx]);

  const typeStyle = TYPE_COLORS[tc.type] ?? TYPE_COLORS['UI'];
  const priStyle  = PRIORITY_COLORS[tc.priority] ?? PRIORITY_COLORS['MEDIUM'];

  return (
    <div style={{
      borderBottom: '1px solid var(--border)',
      background: isSelected ? 'rgba(37,99,171,0.03)' : 'transparent',
      transition: 'background 0.1s',
    }}>
      {/* ── Collapsed header row ── */}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: '10px', padding: '10px 14px' }}>

        {/* Checkbox — stops expand toggle */}
        <div
          onClick={(e) => { e.stopPropagation(); onToggleSelect(); }}
          style={{
            width: '16px', height: '16px', borderRadius: '3px', flexShrink: 0, marginTop: '2px',
            background: isSelected ? 'var(--cyan)' : 'transparent',
            border: `1.5px solid ${isSelected ? 'var(--cyan)' : 'var(--border2)'}`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: '#fff', fontSize: '10px', cursor: 'pointer',
          }}
        >{isSelected ? '✓' : ''}</div>

        {/* Main content — clicking expands */}
        <div style={{ flex: 1, minWidth: 0, cursor: 'pointer' }} onClick={() => setExpanded((v) => !v)}>
          {/* Meta row */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '5px', marginBottom: '4px', flexWrap: 'wrap' }}>
            <span style={{
              padding: '2px 7px', borderRadius: '100px', fontSize: '9px', fontWeight: 700,
              fontFamily: 'var(--font-mono)', border: `1px solid ${typeStyle.border}`,
              background: typeStyle.bg, color: typeStyle.color, textTransform: 'uppercase',
            }}>{tc.type}</span>
            <span style={{
              padding: '2px 7px', borderRadius: '100px', fontSize: '9px', fontWeight: 700,
              fontFamily: 'var(--font-mono)', border: `1px solid ${priStyle.border}`,
              background: priStyle.bg, color: priStyle.color,
            }}>{tc.priority}</span>
            {tc.useCaseTag && (
              <span style={{
                padding: '2px 7px', borderRadius: '100px', fontSize: '9px', fontWeight: 700,
                fontFamily: 'var(--font-mono)', background: 'var(--violet-dim)',
                color: 'var(--violet)', border: '1px solid rgba(244,123,32,0.25)',
              }}>📌 {tc.useCaseTag}</span>
            )}
            {isSaved && (
              <span style={{
                padding: '1px 6px', borderRadius: '100px', fontSize: '9px', fontWeight: 700,
                fontFamily: 'var(--font-mono)', background: 'var(--emerald-dim)',
                color: 'var(--emerald)', border: '1px solid rgba(42,157,143,0.25)',
              }}>SAVED</span>
            )}
          </div>

          {/* Title */}
          <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text)', lineHeight: 1.35, marginBottom: '5px' }}>
            {tc.title}
          </div>

          {/* Tags */}
          {tc.tags.length > 0 && (
            <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
              {tc.tags.slice(0, 5).map((tag, i) => (
                <span key={i} className="tag">{tag}</span>
              ))}
              {tc.tags.length > 5 && (
                <span style={{ fontSize: '9px', color: 'var(--text-dim)', fontFamily: 'var(--font-mono)' }}>
                  +{tc.tags.length - 5}
                </span>
              )}
            </div>
          )}
        </div>

        {/* Right actions */}
        <div style={{ display: 'flex', gap: '4px', alignItems: 'center', flexShrink: 0 }}>
          <button
            onClick={() => setExpanded((v) => !v)}
            title={expanded ? 'Collapse' : 'Expand & Edit'}
            style={{
              width: '26px', height: '26px', borderRadius: '5px', border: '1px solid var(--border)',
              background: expanded ? 'var(--cyan-dim)' : 'var(--surface2)',
              color: expanded ? 'var(--cyan)' : 'var(--text-dim)',
              cursor: 'pointer', fontSize: '11px',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}
          >{expanded ? '▲' : '▼'}</button>
          <button
            onClick={(e) => { e.stopPropagation(); onDelete(); }}
            title="Remove"
            style={{
              width: '26px', height: '26px', borderRadius: '5px',
              background: 'var(--rose-dim)', border: '1px solid rgba(220,38,38,0.2)',
              color: 'var(--rose)', cursor: 'pointer', fontSize: '11px',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}
          >✕</button>
        </div>
      </div>

      {/* ── Expanded edit panel ── */}
      {expanded && (
        <div style={{
          margin: '0 14px 12px',
          padding: '14px',
          background: 'var(--surface2)',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius)',
          display: 'flex', flexDirection: 'column', gap: '14px',
        }}>

          {/* Title edit */}
          <div>
            <div style={LABEL}>Title</div>
            <input
              className="input-field"
              style={{ width: '100%', boxSizing: 'border-box', fontSize: '13px', fontWeight: 600 }}
              value={tc.title}
              onChange={(e) => onEdit({ title: e.target.value })}
            />
          </div>

          {/* Description */}
          <div>
            <div style={LABEL}>Description</div>
            <textarea
              className="input-field"
              style={{ width: '100%', boxSizing: 'border-box', fontSize: '12px', minHeight: '52px', resize: 'vertical', lineHeight: 1.5 }}
              value={tc.description ?? ''}
              onChange={(e) => onEdit({ description: e.target.value })}
              placeholder="What this test case covers..."
            />
          </div>

          {/* Steps */}
          <div>
            <div style={LABEL}>Steps</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              {tc.steps.map((step, si) => (
                <div key={si} style={{ display: 'flex', gap: '6px', alignItems: 'flex-start' }}>
                  <span style={{
                    flexShrink: 0, marginTop: '7px', width: '18px', height: '18px',
                    borderRadius: '50%', background: 'var(--cyan-dim)', border: '1px solid rgba(37,99,171,0.25)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: '9px', fontWeight: 700, color: 'var(--cyan)', fontFamily: 'var(--font-mono)',
                  }}>{si + 1}</span>
                  <input
                    ref={(el) => { stepRefs.current[si] = el; }}
                    className="input-field"
                    style={{ flex: 1, fontSize: '12px', padding: '5px 8px' }}
                    value={step}
                    onChange={(e) => {
                      const updated = [...tc.steps];
                      updated[si] = e.target.value;
                      onEdit({ steps: updated });
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault();
                        const updated = [...tc.steps];
                        updated.splice(si + 1, 0, '');
                        onEdit({ steps: updated });
                        setFocusInsertIdx(si + 1);
                      }
                    }}
                  />
                  {/* Insert step below */}
                  <button
                    onClick={() => {
                      const updated = [...tc.steps];
                      updated.splice(si + 1, 0, '');
                      onEdit({ steps: updated });
                      setFocusInsertIdx(si + 1);
                    }}
                    title="Insert step below"
                    style={{
                      marginTop: '4px', flexShrink: 0, width: '22px', height: '22px', borderRadius: '4px',
                      background: 'var(--cyan-dim)', border: '1px solid rgba(37,99,171,0.2)',
                      color: 'var(--cyan)', cursor: 'pointer', fontSize: '13px', fontWeight: 700,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                    }}
                  >+</button>
                  {/* Delete step */}
                  <button
                    onClick={() => onEdit({ steps: tc.steps.filter((_, idx) => idx !== si) })}
                    title="Remove step"
                    style={{
                      marginTop: '4px', flexShrink: 0, width: '22px', height: '22px', borderRadius: '4px',
                      background: 'var(--rose-dim)', border: '1px solid rgba(220,38,38,0.2)',
                      color: 'var(--rose)', cursor: 'pointer', fontSize: '10px',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                    }}
                  >✕</button>
                </div>
              ))}
              {/* Append step at end */}
              <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                <span style={{ width: '18px', flexShrink: 0 }} />
                <input
                  className="input-field"
                  style={{ flex: 1, fontSize: '12px', padding: '5px 8px', borderStyle: 'dashed' }}
                  placeholder="+ Add step and press Enter..."
                  value={newStep}
                  onChange={(e) => setNewStep(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && newStep.trim()) {
                      onEdit({ steps: [...tc.steps, newStep.trim()] });
                      setNewStep('');
                    }
                  }}
                />
              </div>
            </div>
          </div>

          {/* Expected Result */}
          <div>
            <div style={LABEL}>Expected Result</div>
            <textarea
              className="input-field"
              style={{ width: '100%', boxSizing: 'border-box', fontSize: '12px', minHeight: '48px', resize: 'vertical', lineHeight: 1.5 }}
              value={tc.expectedResult ?? ''}
              onChange={(e) => onEdit({ expectedResult: e.target.value })}
              placeholder="What should happen after all steps are completed..."
            />
          </div>

          {/* Type · Priority · Use Case — inline row */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '10px' }}>
            <div>
              <div style={LABEL}>Type</div>
              <select
                className="input-field"
                style={{ width: '100%', fontSize: '12px', padding: '5px 8px' }}
                value={tc.type}
                onChange={(e) => onEdit({ type: e.target.value as 'UI' | 'API' | 'SIT' })}
              >
                <option value="UI">UI</option>
                <option value="API">API</option>
                <option value="SIT">SIT</option>
              </select>
            </div>
            <div>
              <div style={LABEL}>Priority</div>
              <select
                className="input-field"
                style={{ width: '100%', fontSize: '12px', padding: '5px 8px' }}
                value={tc.priority}
                onChange={(e) => onEdit({ priority: e.target.value as 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL' })}
              >
                <option value="CRITICAL">Critical</option>
                <option value="HIGH">High</option>
                <option value="MEDIUM">Medium</option>
                <option value="LOW">Low</option>
              </select>
            </div>
            <div>
              <div style={LABEL}>Use Case</div>
              <input
                className="input-field"
                style={{ width: '100%', boxSizing: 'border-box', fontSize: '12px', padding: '5px 8px' }}
                value={tc.useCaseTag ?? ''}
                onChange={(e) => onEdit({ useCaseTag: e.target.value })}
                placeholder="Primary Sales..."
              />
            </div>
          </div>

          {/* Tags */}
          <div>
            <div style={LABEL}>Tags</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '5px', alignItems: 'center' }}>
              {tc.tags.map((tag, ti) => (
                <span key={ti} style={{
                  display: 'inline-flex', alignItems: 'center', gap: '4px',
                  padding: '2px 7px', borderRadius: '4px', fontSize: '10px',
                  background: 'var(--surface3)', border: '1px solid var(--border2)',
                  color: 'var(--text-mid)', fontFamily: 'var(--font-mono)',
                }}>
                  {tag}
                  <span
                    style={{ cursor: 'pointer', color: 'var(--rose)', fontSize: '9px', lineHeight: 1 }}
                    onClick={() => onEdit({ tags: tc.tags.filter((_, idx) => idx !== ti) })}
                  >✕</span>
                </span>
              ))}
              <input
                className="input-field"
                style={{ width: '110px', fontSize: '11px', padding: '3px 7px', borderStyle: 'dashed' }}
                placeholder="+ tag, Enter"
                value={newTag}
                onChange={(e) => setNewTag(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && newTag.trim()) {
                    const t = newTag.trim().toLowerCase();
                    if (!tc.tags.includes(t)) onEdit({ tags: [...tc.tags, t] });
                    setNewTag('');
                  }
                }}
              />
            </div>
          </div>

          {/* Source ref — read only */}
          {tc.sourceRef && (
            <div>
              <div style={LABEL}>Source</div>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: '10px', color: 'var(--text-dim)' }}>
                {tc.sourceRef}
              </div>
            </div>
          )}

          {/* Approve action */}
          <div style={{ display: 'flex', justifyContent: 'flex-end', paddingTop: '4px' }}>
            <button
              onClick={(e) => { e.stopPropagation(); onApprove(); }}
              style={{
                padding: '7px 18px', borderRadius: 'var(--radius)', fontSize: '12px', fontWeight: 700,
                background: 'linear-gradient(135deg, var(--6d-orange), #D9601A)',
                color: '#fff', border: 'none', cursor: 'pointer',
                display: 'flex', alignItems: 'center', gap: '6px',
                transition: 'opacity 0.15s',
              }}
              onMouseEnter={(e) => (e.currentTarget.style.opacity = '0.85')}
              onMouseLeave={(e) => (e.currentTarget.style.opacity = '1')}
            >
              ✓ Approve &amp; Go to Library
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default function GeneratedTCList({
  testCases,
  selectedIds,
  onToggleSelect,
  onSelectAll,
  onClearSelection,
  onEdit,
  onSave,
  onDelete,
  onDeleteSelected,
  onApprove,
  isSaving,
}: GeneratedTCListProps) {
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState<'ALL' | 'UI' | 'API' | 'SIT'>('ALL');

  const filtered = testCases.filter((tc) => {
    if (typeFilter !== 'ALL' && tc.type !== typeFilter) return false;
    if (search && !tc.title.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  const selectedPending = testCases.filter((tc) => selectedIds.has(tc._tempId));

  return (
    <div className="card" style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden', height: '100%' }}>
      <div style={{ height: '4px', background: 'var(--cool-accent)', flexShrink: 0 }} />

      {/* Header */}
      <div className="card-header" style={{ flexShrink: 0, flexWrap: 'wrap', gap: '8px' }}>
        <div className="card-title">
          📋 Generated Test Cases
          <span className="badge badge-cyan" style={{ marginLeft: '6px' }}>{testCases.length}</span>
        </div>
        <div style={{ display: 'flex', gap: '6px', marginLeft: 'auto', alignItems: 'center', flexWrap: 'wrap' }}>
          <input
            className="input-field"
            style={{ width: '150px', padding: '5px 10px', fontSize: '12px' }}
            placeholder="🔍 Search..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          {(['ALL', 'UI', 'API', 'SIT'] as const).map((f) => (
            <button
              key={f}
              onClick={() => setTypeFilter(f)}
              style={{
                padding: '3px 9px', borderRadius: '100px', fontSize: '10px', fontWeight: 700,
                fontFamily: 'var(--font-mono)', cursor: 'pointer', border: '1px solid',
                background: typeFilter === f ? 'var(--cyan-dim)' : 'transparent',
                color: typeFilter === f ? 'var(--cyan)' : 'var(--text-dim)',
                borderColor: typeFilter === f ? 'rgba(37,99,171,0.3)' : 'var(--border)',
                transition: 'all 0.15s',
              }}
            >{f}</button>
          ))}
        </div>
      </div>

      {/* Instruction hint when there are pending TCs */}
      {testCases.length > 0 && (
        <div style={{
          padding: '6px 14px', background: 'var(--cyan-dim)',
          borderBottom: '1px solid rgba(37,99,171,0.15)',
          fontSize: '11px', color: 'var(--cyan)', flexShrink: 0,
        }}>
          ▼ Expand each card to review and edit · Check the ones you want to save · then click Save to Library
        </div>
      )}

      {/* List */}
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {filtered.length === 0 ? (
          <div style={{ padding: '48px 24px', textAlign: 'center', color: 'var(--text-dim)', fontSize: '13px', lineHeight: 1.6 }}>
            {testCases.length === 0
              ? <>No test cases generated yet.<br />Add inputs on the left and click Generate.</>
              : 'No test cases match the current filter.'}
          </div>
        ) : (
          filtered.map((tc) => (
            <TCCard
              key={tc._tempId}
              tc={tc}
              isSaved={false}
              isSelected={selectedIds.has(tc._tempId)}
              onToggleSelect={() => onToggleSelect(tc._tempId)}
              onEdit={(patch) => onEdit(tc._tempId, patch)}
              onDelete={() => onDelete(tc._tempId)}
              onApprove={() => onApprove(tc)}
            />
          ))
        )}
      </div>

      {/* Footer */}
      <div style={{
        padding: '10px 14px', borderTop: '1px solid var(--border)', background: 'var(--surface2)',
        display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0,
      }}>
        <span style={{ fontSize: '12px', color: 'var(--text-mid)', fontFamily: 'var(--font-mono)' }}>
          {selectedIds.size > 0
            ? `${selectedIds.size} selected`
            : `${testCases.length} pending`}
        </span>

        {testCases.length > 0 && (
          selectedIds.size < testCases.length ? (
            <button
              onClick={() => onSelectAll()}
              style={{ fontSize: '11px', color: 'var(--cyan)', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'var(--font-mono)' }}
            >Select All</button>
          ) : (
            <button
              onClick={() => onClearSelection()}
              style={{ fontSize: '11px', color: 'var(--text-dim)', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'var(--font-mono)' }}
            >Clear</button>
          )
        )}

        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center' }}>
          {selectedIds.size > 0 && (
            <button
              onClick={() => {
                if (window.confirm(`Delete ${selectedIds.size} selected test case${selectedIds.size !== 1 ? 's' : ''}?`)) {
                  onDeleteSelected();
                }
              }}
              style={{
                padding: '7px 14px', borderRadius: 'var(--radius)', fontSize: '12px', fontWeight: 700,
                background: 'var(--rose-dim)', color: 'var(--rose)',
                border: '1px solid rgba(220,38,38,0.3)', cursor: 'pointer',
                display: 'flex', alignItems: 'center', gap: 5,
                transition: 'all 0.15s',
              }}
              onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(220,38,38,0.18)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = 'var(--rose-dim)'; }}
            >
              🗑 Delete {selectedIds.size}
            </button>
          )}
          <button
            onClick={() => { if (selectedPending.length > 0) onSave(selectedPending); }}
            disabled={selectedPending.length === 0 || isSaving}
            style={{
              padding: '7px 18px', borderRadius: 'var(--radius)', fontSize: '12px', fontWeight: 700,
              background: selectedPending.length === 0
                ? 'var(--surface3)'
                : 'linear-gradient(135deg, var(--6d-orange), #D9601A)',
              color: selectedPending.length === 0 ? 'var(--text-dim)' : '#fff',
              border: 'none', cursor: selectedPending.length === 0 ? 'not-allowed' : 'pointer',
              transition: 'all 0.15s',
            }}
          >
            {isSaving
              ? '⏳ Saving...'
              : selectedPending.length > 0
                ? `→ Save ${selectedPending.length} to Library`
                : '→ Save to Library'}
          </button>
        </div>
      </div>
    </div>
  );
}
