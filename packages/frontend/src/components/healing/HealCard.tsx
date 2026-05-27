import { useState } from 'react';
import type { HealProposal } from '../../types';
import DiffViewer from './DiffViewer';

interface HealCardProps {
  heal: HealProposal;
  onApprove: (rerun: boolean) => void;
  onReject: () => void;
  onRetryWithContext?: (context: string) => void;
  busy: boolean;
  retrying?: boolean;
  /** When false (Viewer role), hides approve/reject action buttons */
  canWrite?: boolean;
}

const TYPE_META = {
  SELECTOR:   { label: 'Selector',   cls: 'ht-selector' },
  FLOW:       { label: 'Flow',       cls: 'ht-flow' },
  API_SCHEMA: { label: 'API Schema', cls: 'ht-api' },
} as const;

function railColor(confidence: number): string {
  if (confidence >= 90) return 'var(--pass)';
  if (confidence >= 70) return 'var(--amber)';
  return 'var(--fail)';
}

function ConfBar({ value }: { value: number }) {
  const color = value >= 90 ? 'var(--pass)' : value >= 70 ? 'var(--amber)' : 'var(--fail)';
  return (
    <div className="conf-track" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <div
        style={{
          flex: 1,
          height: 4,
          borderRadius: 2,
          background: 'var(--surface3)',
          overflow: 'hidden',
        }}
      >
        <div
          className="conf-fill"
          style={{
            width: `${value}%`,
            height: '100%',
            borderRadius: 2,
            background: color,
            transition: 'width 0.3s ease',
          }}
        />
      </div>
      <span className="conf-val" style={{ fontSize: 11, fontWeight: 700, color, minWidth: 32 }}>
        {value}%
      </span>
    </div>
  );
}

export default function HealCard({ heal, onApprove, onReject, onRetryWithContext, busy, retrying, canWrite = true }: HealCardProps) {
  const [expanded, setExpanded] = useState(false);
  const [showContext, setShowContext] = useState(false);
  const [contextText, setContextText] = useState('');
  const rail = railColor(heal.confidence);
  const typeMeta = TYPE_META[heal.type];
  const tcId = heal.runResult?.testCase.tcId ?? '—';
  const tcName = heal.runResult?.testCase.title ?? 'Unknown Test';
  const errorMsg = heal.runResult?.errorMessage;
  const diff = heal.lineDiff ?? [];
  const isBusy = busy || retrying;

  function handleSubmitContext() {
    if (!contextText.trim() || !onRetryWithContext) return;
    onRetryWithContext(contextText.trim());
    setShowContext(false);
    setContextText('');
  }

  return (
    <div
      className={`heal-item${heal.confidence >= 90 ? ' healed' : heal.confidence >= 70 ? ' warning' : ' critical'}`}
      style={{
        background: 'var(--surface)',
        border: '1px solid var(--border)',
        borderLeft: `3px solid ${rail}`,
        borderRadius: 10,
        padding: '12px 14px',
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
        transition: 'border-color 0.15s',
        cursor: 'default',
      }}
      onMouseEnter={(e) => ((e.currentTarget as HTMLDivElement).style.borderColor = `var(--amber) var(--border) var(--border) var(--amber)`)}
      onMouseLeave={(e) => ((e.currentTarget as HTMLDivElement).style.borderColor = `${rail} var(--border) var(--border) ${rail}`)}
    >
      {/* Header */}
      <div
        className="heal-item-header"
        style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}
      >
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            className="heal-tc-id"
            style={{
              fontSize: 9,
              fontFamily: 'var(--font-mono)',
              color: 'var(--text-dim)',
              marginBottom: 2,
              textTransform: 'uppercase',
              letterSpacing: '0.08em',
            }}
          >
            {tcId}
          </div>
          <div
            className="heal-tc-name"
            style={{
              fontSize: 13,
              fontWeight: 700,
              color: 'var(--text)',
              lineHeight: 1.35,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {tcName}
          </div>
        </div>

        {/* Type badge */}
        <span
          className={`heal-type-tag ${typeMeta.cls}`}
          style={{
            flexShrink: 0,
            fontSize: 9,
            fontWeight: 700,
            letterSpacing: '0.06em',
            textTransform: 'uppercase',
            padding: '2px 8px',
            borderRadius: 100,
            background:
              heal.type === 'SELECTOR'
                ? 'rgba(251,191,36,0.12)'
                : heal.type === 'FLOW'
                ? 'rgba(244,123,32,0.12)'
                : 'rgba(37,99,171,0.12)',
            color:
              heal.type === 'SELECTOR'
                ? 'var(--amber)'
                : heal.type === 'FLOW'
                ? 'var(--violet)'
                : 'var(--cyan)',
          }}
        >
          {typeMeta.label}
        </span>
      </div>

      {/* Error message */}
      {errorMsg && (
        <div
          className="heal-error"
          style={{
            fontSize: 10,
            fontFamily: 'var(--font-mono)',
            color: 'var(--fail)',
            background: 'var(--rose-dim)',
            border: '1px solid rgba(220,38,38,0.18)',
            borderRadius: 5,
            padding: '5px 8px',
            whiteSpace: 'pre-wrap',
            overflow: 'hidden',
            maxHeight: 48,
            lineHeight: 1.5,
          }}
        >
          {errorMsg.slice(0, 160)}
          {errorMsg.length > 160 ? '…' : ''}
        </div>
      )}

      {/* Body */}
      <div className="heal-item-body" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {/* Mini diff */}
        {diff.length > 0 && (
          <div className="heal-diff">
            {expanded ? (
              <DiffViewer diff={diff} compact />
            ) : (
              <div
                style={{
                  background: 'var(--surface2)',
                  border: '1px solid var(--border)',
                  borderRadius: 6,
                  padding: '4px 8px',
                  fontFamily: 'var(--font-mono)',
                  fontSize: 10,
                  maxHeight: 72,
                  overflow: 'hidden',
                }}
              >
                {diff
                  .filter((l) => l.type !== 'unchanged')
                  .slice(0, 4)
                  .map((l, i) => (
                    <div
                      key={i}
                      style={{
                        color: l.type === 'add' ? 'var(--pass)' : 'var(--fail)',
                        whiteSpace: 'pre',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        lineHeight: '16px',
                      }}
                    >
                      {l.type === 'add' ? '+ ' : '- '}
                      {l.line.trim().slice(0, 80)}
                    </div>
                  ))}
              </div>
            )}
          </div>
        )}

        {/* Confidence bar */}
        <ConfBar value={heal.confidence} />
      </div>

      {/* Context input */}
      {showContext && (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 6,
            padding: '8px 10px',
            background: 'var(--surface2)',
            border: '1px solid rgba(37,99,171,0.3)',
            borderRadius: 7,
          }}
        >
          <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--cyan)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
            Describe what you know about this failure
          </div>
          <textarea
            autoFocus
            value={contextText}
            onChange={(e) => setContextText(e.target.value)}
            placeholder="e.g. 'the Create Project modal was renamed last week', 'login flow changed — the Submit button now says Sign In'"
            rows={3}
            style={{
              width: '100%',
              background: 'var(--surface)',
              border: '1px solid var(--border)',
              borderRadius: 5,
              color: 'var(--text)',
              fontSize: 11,
              fontFamily: 'var(--font-ui)',
              padding: '6px 8px',
              resize: 'vertical',
              outline: 'none',
              boxSizing: 'border-box',
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleSubmitContext();
              if (e.key === 'Escape') { setShowContext(false); setContextText(''); }
            }}
          />
          <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
            <button
              onClick={() => { setShowContext(false); setContextText(''); }}
              style={{
                padding: '4px 12px',
                borderRadius: 5,
                background: 'transparent',
                border: '1px solid var(--border)',
                color: 'var(--text-dim)',
                fontSize: 11,
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              Cancel
            </button>
            <button
              disabled={!contextText.trim() || isBusy}
              onClick={handleSubmitContext}
              style={{
                padding: '4px 12px',
                borderRadius: 5,
                background: 'rgba(37,99,171,0.18)',
                border: '1px solid rgba(37,99,171,0.4)',
                color: 'var(--cyan)',
                fontSize: 11,
                fontWeight: 700,
                cursor: !contextText.trim() || isBusy ? 'not-allowed' : 'pointer',
                opacity: !contextText.trim() || isBusy ? 0.5 : 1,
              }}
            >
              {retrying ? 'Re-analyzing…' : 'Re-analyze with Context'}
            </button>
          </div>
        </div>
      )}

      {/* Actions */}
      <div
        className="heal-actions"
        style={{ display: 'flex', gap: 6, alignItems: 'center' }}
      >
        {/* Write actions — Approve/Reject hidden for Viewers */}
        {canWrite && <>
          <button
            className="hb-approve-rerun"
            disabled={isBusy}
            onClick={(e) => { e.stopPropagation(); onApprove(true); }}
            style={{
              flex: 2,
              padding: '6px 0',
              borderRadius: 6,
              border: '1px solid rgba(42,157,143,0.35)',
              background: 'rgba(42,157,143,0.12)',
              color: 'var(--pass)',
              fontWeight: 700,
              fontSize: 11,
              cursor: isBusy ? 'not-allowed' : 'pointer',
              opacity: isBusy ? 0.6 : 1,
              transition: 'opacity 0.15s',
              whiteSpace: 'nowrap',
            }}
          >
            ✓ Approve & Re-run
          </button>

          <button
            className="hb-approve-only"
            disabled={isBusy}
            onClick={(e) => { e.stopPropagation(); onApprove(false); }}
            style={{
              flex: 1,
              padding: '6px 0',
              borderRadius: 6,
              border: '1px solid rgba(42,157,143,0.2)',
              background: 'rgba(42,157,143,0.05)',
              color: 'var(--pass)',
              fontWeight: 600,
              fontSize: 10,
              cursor: isBusy ? 'not-allowed' : 'pointer',
              opacity: isBusy ? 0.6 : 1,
              transition: 'opacity 0.15s',
              whiteSpace: 'nowrap',
            }}
          >
            Approve Only
          </button>

          <button
            className="hb-reject"
            disabled={isBusy}
            onClick={(e) => { e.stopPropagation(); onReject(); }}
            style={{
              flex: 1,
              padding: '6px 0',
              borderRadius: 6,
              border: '1px solid rgba(220,38,38,0.3)',
              background: 'rgba(220,38,38,0.08)',
              color: 'var(--fail)',
              fontWeight: 700,
              fontSize: 11,
              cursor: isBusy ? 'not-allowed' : 'pointer',
              opacity: isBusy ? 0.6 : 1,
              transition: 'opacity 0.15s',
            }}
          >
            ✕ Reject
          </button>

          {onRetryWithContext && (
            <button
              className="hb-context"
              disabled={isBusy}
              onClick={(e) => { e.stopPropagation(); setShowContext((p) => !p); }}
              title="Add context to improve the heal suggestion"
              style={{
                padding: '6px 10px',
                borderRadius: 6,
                border: showContext
                  ? '1px solid rgba(37,99,171,0.5)'
                  : '1px solid var(--border)',
                background: showContext ? 'rgba(37,99,171,0.12)' : 'transparent',
                color: showContext ? 'var(--cyan)' : 'var(--text-dim)',
                fontWeight: 600,
                fontSize: 11,
                cursor: isBusy ? 'not-allowed' : 'pointer',
                opacity: isBusy ? 0.6 : 1,
                whiteSpace: 'nowrap',
              }}
            >
              💬
            </button>
          )}
        </>}

        <button
          className="hb-view"
          onClick={(e) => { e.stopPropagation(); setExpanded((p) => !p); }}
          style={{
            padding: '6px 10px',
            borderRadius: 6,
            border: '1px solid var(--border)',
            background: 'transparent',
            color: 'var(--text-dim)',
            fontWeight: 600,
            fontSize: 11,
            cursor: 'pointer',
            whiteSpace: 'nowrap',
          }}
        >
          {expanded ? '▲ Less' : '▼ Diff'}
        </button>
      </div>
    </div>
  );
}
