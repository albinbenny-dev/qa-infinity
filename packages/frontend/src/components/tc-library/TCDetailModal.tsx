import { useNavigate, useParams } from 'react-router-dom';
import type { TestCase } from '../../types';

interface TCDetailModalProps {
  tc: TestCase;
  onClose: () => void;
}

const TYPE_CHIP: Record<string, { bg: string; color: string }> = {
  UI:  { bg: 'rgba(225,29,72,0.12)', color: '#e11d48' },
  API: { bg: 'rgba(37,99,171,0.12)', color: 'var(--cyan)' },
  SIT: { bg: 'rgba(42,157,143,0.12)', color: 'var(--emerald)' },
};

const PRIORITY_COLOR: Record<string, string> = {
  LOW:      'var(--text-dim)',
  MEDIUM:   'var(--amber)',
  HIGH:     'var(--violet)',
  CRITICAL: 'var(--fail)',
};

const RUN_COLOR: Record<string, string> = {
  PASSED:    '#2A9D8F',
  FAILED:    '#DC2626',
  SKIPPED:   '#F59E0B',
  CANCELLED: '#64748b',
};

const LABEL: React.CSSProperties = {
  fontSize: '9px',
  fontWeight: 700,
  letterSpacing: '0.8px',
  textTransform: 'uppercase',
  fontFamily: 'var(--font-mono)',
  color: 'var(--text-dim)',
  marginBottom: '6px',
};

/** Read-only test case detail popup — steps, expected result, meta, recent run results.
 *  Lets engineers inspect a TC's full definition without leaving the Scripts page. */
export default function TCDetailModal({ tc, onClose }: TCDetailModalProps) {
  const navigate = useNavigate();
  const { slug } = useParams<{ slug: string }>();
  const chip = TYPE_CHIP[tc.type] ?? { bg: 'var(--surface3)', color: 'var(--text-dim)' };

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.55)',
        zIndex: 1000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '24px',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: 'var(--surface)',
          border: '1px solid var(--border2)',
          borderRadius: '12px',
          width: '100%',
          maxWidth: '640px',
          maxHeight: '85vh',
          display: 'flex',
          flexDirection: 'column',
          boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
        }}
      >
        {/* Header */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
            padding: '14px 18px',
            borderBottom: '1px solid var(--border)',
            flexShrink: 0,
          }}
        >
          <span style={{ fontSize: '14px' }}>👁</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div title={tc.title} style={{ fontSize: '13px', fontWeight: 700, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {tc.title}
            </div>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: '10px', color: 'var(--text-dim)' }}>
              {tc.tcId}
            </div>
          </div>
          <span style={{
            fontSize: '8px', fontWeight: 700, padding: '2px 6px', borderRadius: '3px',
            background: chip.bg, color: chip.color, flexShrink: 0, fontFamily: 'var(--font-ui)',
          }}>
            {tc.type}
          </span>
          <button
            onClick={onClose}
            style={{
              width: '28px', height: '28px',
              background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: '6px',
              color: 'var(--text-dim)', fontSize: '14px', cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
            }}
          >
            ×
          </button>
        </div>

        {/* Scrollable body */}
        <div style={{ overflowY: 'auto', flex: 1, padding: '18px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {/* Meta row */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
            <span style={{ fontSize: '10px', color: 'var(--text-dim)' }}>Priority:</span>
            <span style={{ fontSize: '10px', fontWeight: 700, color: PRIORITY_COLOR[tc.priority] ?? 'var(--text)' }}>
              {tc.priority}
            </span>
            <span style={{ color: 'var(--border2)' }}>·</span>
            <span style={{ fontSize: '10px', color: 'var(--text-dim)' }}>Status:</span>
            <span style={{ fontSize: '10px', fontWeight: 700, color: 'var(--text)' }}>{tc.status}</span>
            {tc.sourceRef && (
              <>
                <span style={{ color: 'var(--border2)' }}>·</span>
                <span style={{ fontSize: '10px', color: 'var(--text-dim)' }}>Src:</span>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: '9px', color: 'var(--cyan)' }}>{tc.sourceRef}</span>
              </>
            )}
            {tc.prerequisiteTc && (
              <>
                <span style={{ color: 'var(--border2)' }}>·</span>
                <span style={{ fontSize: '10px', color: 'var(--text-dim)' }}>Prereq:</span>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: '9px', color: 'var(--violet)' }}>{tc.prerequisiteTc.tcId}</span>
              </>
            )}
          </div>

          {/* Description */}
          {tc.description && (
            <div>
              <div style={LABEL}>Description</div>
              <p style={{ margin: 0, fontSize: '11px', color: 'var(--text-mid)', lineHeight: 1.5 }}>
                {tc.description}
              </p>
            </div>
          )}

          {/* Steps */}
          <div>
            <div style={LABEL}>Steps</div>
            <ol style={{ margin: 0, paddingLeft: '18px', display: 'flex', flexDirection: 'column', gap: '5px' }}>
              {tc.steps.map((step, i) => (
                <li key={i} style={{ fontSize: '11px', color: 'var(--text)', lineHeight: 1.5 }}>
                  {step}
                </li>
              ))}
            </ol>
          </div>

          {/* Expected Result */}
          {tc.expectedResult && (
            <div>
              <div style={LABEL}>Expected Result</div>
              <p style={{ margin: 0, fontSize: '11px', color: 'var(--text)', lineHeight: 1.5 }}>
                {tc.expectedResult}
              </p>
            </div>
          )}

          {/* Recent run results */}
          {tc.recentRunStatuses && tc.recentRunStatuses.length > 0 && (
            <div>
              <div style={LABEL}>Recent Results</div>
              <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                {tc.recentRunStatuses.map((r, i) => (
                  <button
                    key={i}
                    onClick={() => navigate(`/projects/${slug}/reports?run=${r.runId}`)}
                    title={`${r.status} — open report`}
                    style={{
                      fontSize: '9px', fontWeight: 700, padding: '3px 8px', borderRadius: '10px',
                      background: `${RUN_COLOR[r.status] ?? '#64748b'}22`,
                      border: `1px solid ${RUN_COLOR[r.status] ?? '#64748b'}55`,
                      color: RUN_COLOR[r.status] ?? 'var(--text-dim)',
                      cursor: 'pointer', fontFamily: 'var(--font-mono)',
                    }}
                  >
                    {r.status}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Tags */}
          {tc.tags.length > 0 && (
            <div>
              <div style={LABEL}>Tags</div>
              <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
                {tc.tags.map((tag) =>
                  tag.startsWith('suite:') ? (
                    <span key={tag} className="tag" style={{ fontSize: '8px', background: 'var(--amber-dim)', color: 'var(--amber)', border: '1px solid rgba(245,158,11,0.3)' }}>
                      {tag.replace('suite:', '⚡ ')}
                    </span>
                  ) : (
                    <span key={tag} className="tag" style={{ fontSize: '8px' }}>{tag}</span>
                  )
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
