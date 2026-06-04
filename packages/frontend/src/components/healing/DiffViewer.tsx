import type { DiffLine } from '../../types';

interface DiffViewerProps {
  diff: DiffLine[];
  maxLines?: number;
  compact?: boolean;
}

export default function DiffViewer({ diff, maxLines, compact = false }: DiffViewerProps) {
  const lines = maxLines ? diff.slice(0, maxLines) : diff;
  const truncated = maxLines && diff.length > maxLines;
  const changedCount = diff.filter((l) => l.type !== 'unchanged').length;

  return (
    <div
      style={{
        border: '1px solid var(--border)',
        borderRadius: 8,
        overflow: 'hidden',
        fontFamily: 'var(--font-mono)',
        fontSize: compact ? 10 : 11,
      }}
    >
      {/* Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: compact ? '4px 10px' : '6px 12px',
          background: 'var(--surface2)',
          borderBottom: '1px solid var(--border)',
        }}
      >
        <span style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-dim)' }}>
          Code Diff
        </span>
        <span style={{ fontSize: 10, color: 'var(--text-dim)' }}>
          {changedCount} line{changedCount !== 1 ? 's' : ''} changed
        </span>
      </div>

      {/* Diff lines */}
      <div style={{ overflow: 'auto', maxHeight: compact ? 120 : 340, background: 'var(--surface)' }}>
        {lines.map((dl, i) => {
          const isAdd = dl.type === 'add';
          const isRemove = dl.type === 'remove';
          return (
            <div
              key={i}
              style={{
                display: 'flex',
                alignItems: 'flex-start',
                lineHeight: compact ? '16px' : '18px',
                background: isAdd
                  ? 'rgba(42,157,143,0.10)'
                  : isRemove
                  ? 'rgba(220,38,38,0.08)'
                  : 'transparent',
                borderLeft: isAdd
                  ? '2px solid var(--pass)'
                  : isRemove
                  ? '2px solid var(--fail)'
                  : '2px solid transparent',
              }}
            >
              {/* Gutter */}
              <span
                style={{
                  flexShrink: 0,
                  width: compact ? 28 : 36,
                  padding: compact ? '0 4px' : '0 6px',
                  textAlign: 'right',
                  fontSize: 9,
                  color: 'var(--text-dim)',
                  userSelect: 'none',
                  borderRight: '1px solid var(--border)',
                  marginRight: compact ? 6 : 8,
                }}
              >
                {dl.lineNum}
              </span>

              {/* Prefix */}
              <span
                style={{
                  flexShrink: 0,
                  width: 12,
                  fontSize: 10,
                  fontWeight: 700,
                  color: isAdd
                    ? 'var(--pass)'
                    : isRemove
                    ? 'var(--fail)'
                    : 'transparent',
                  userSelect: 'none',
                }}
              >
                {isAdd ? '+' : isRemove ? '-' : ' '}
              </span>

              {/* Line content */}
              <span
                style={{
                  flex: 1,
                  whiteSpace: 'pre',
                  overflowX: 'auto',
                  padding: compact ? '0 4px 0 0' : '0 8px 0 0',
                  color: isAdd
                    ? 'var(--pass)'
                    : isRemove
                    ? 'var(--fail)'
                    : 'var(--text)',
                }}
              >
                {dl.line}
              </span>
            </div>
          );
        })}

        {truncated && (
          <div
            style={{
              padding: '4px 12px',
              textAlign: 'center',
              fontSize: 10,
              color: 'var(--text-dim)',
              background: 'var(--surface2)',
              borderTop: '1px solid var(--border)',
            }}
          >
            {diff.length - maxLines!} more lines…
          </div>
        )}
      </div>
    </div>
  );
}
