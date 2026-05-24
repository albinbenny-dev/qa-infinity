import { useState } from 'react';
import type { HealProposal } from '../../types';
import DiffViewer from './DiffViewer';

interface HealCardProps {
  heal: HealProposal;
  onApprove: () => void;
  onReject: () => void;
  busy: boolean;
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

export default function HealCard({ heal, onApprove, onReject, busy }: HealCardProps) {
  const [expanded, setExpanded] = useState(false);
  const rail = railColor(heal.confidence);
  const typeMeta = TYPE_META[heal.type];
  const tcId = heal.runResult?.testCase.tcId ?? '—';
  const tcName = heal.runResult?.testCase.title ?? 'Unknown Test';
  const errorMsg = heal.runResult?.errorMessage;
  const diff = heal.lineDiff ?? [];

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

      {/* Actions */}
      <div
        className="heal-actions"
        style={{ display: 'flex', gap: 6, alignItems: 'center' }}
      >
        <button
          className="hb-approve"
          disabled={busy}
          onClick={(e) => { e.stopPropagation(); onApprove(); }}
          style={{
            flex: 1,
            padding: '6px 0',
            borderRadius: 6,
            border: '1px solid rgba(42,157,143,0.35)',
            background: 'rgba(42,157,143,0.12)',
            color: 'var(--pass)',
            fontWeight: 700,
            fontSize: 11,
            cursor: busy ? 'not-allowed' : 'pointer',
            opacity: busy ? 0.6 : 1,
            transition: 'opacity 0.15s',
          }}
        >
          ✓ Approve
        </button>

        <button
          className="hb-reject"
          disabled={busy}
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
            cursor: busy ? 'not-allowed' : 'pointer',
            opacity: busy ? 0.6 : 1,
            transition: 'opacity 0.15s',
          }}
        >
          ✕ Reject
        </button>

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
