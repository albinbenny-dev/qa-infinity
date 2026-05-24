import { useState } from 'react';
import type { ReportRun } from '../../types';
import { useReportRun } from '../../hooks/useReports';

interface RunHistoryTableProps {
  projectId: string | undefined;
  runs: ReportRun[];
  onExport?: (runId: string) => void;
  onGenerate?: (runId: string) => void;
}

const STATUS_COLOR: Record<string, string> = {
  PASSED: 'var(--pass)',
  FAILED: 'var(--fail)',
  RUNNING: 'var(--cyan)',
  PENDING: 'var(--amber)',
  CANCELLED: 'var(--text-dim)',
};

const TRIGGER_LABEL: Record<string, string> = {
  MANUAL: 'Manual',
  SCHEDULED: 'Scheduled',
  INDIVIDUAL: 'Individual',
  GROUP: 'Group',
};

function formatDuration(startedAt?: string | null, completedAt?: string | null): string {
  if (!startedAt || !completedAt) return '—';
  const ms = new Date(completedAt).getTime() - new Date(startedAt).getTime();
  if (ms < 60000) return `${Math.round(ms / 1000)}s`;
  const m = Math.floor(ms / 60000);
  const s = Math.round((ms % 60000) / 1000);
  return s > 0 ? `${m}m ${s}s` : `${m}m`;
}

const SEVERITY_COLOR: Record<string, string> = {
  CRITICAL: '#DC2626',
  HIGH: '#F47B20',
  MEDIUM: '#FBBF24',
  LOW: 'var(--pass)',
};

// ── Expanded run detail (lazy-fetched) ─────────────────────────────────────

function ExpandedRunDetail({
  projectId,
  runId,
  onExport,
  onGenerate,
  hasReport,
  runStatus,
}: {
  projectId: string | undefined;
  runId: string;
  onExport?: (id: string) => void;
  onGenerate?: (id: string) => void;
  hasReport: boolean;
  runStatus: string;
}) {
  const { data: run, isLoading } = useReportRun(projectId, runId);
  const [query, setQuery] = useState('');

  if (isLoading || !run) {
    return (
      <div style={{ padding: '20px 16px', textAlign: 'center', color: 'var(--text-dim)', fontSize: 12 }}>
        {isLoading ? 'Loading results…' : 'No detail available.'}
      </div>
    );
  }

  const q = query.toLowerCase();
  const visibleResults = (run.results ?? []).filter(
    (r) => !q || r.testCase.title.toLowerCase().includes(q) || r.testCase.tcId.toLowerCase().includes(q),
  );

  let analysis: { summary?: string; severity?: string; rootCauses?: string[] } | null = null;
  if (run.report?.aiAnalysis) {
    try { analysis = JSON.parse(run.report.aiAnalysis); } catch { /* ignore */ }
  }

  return (
    <div style={{ borderTop: '1px solid var(--border)' }}>
      {/* AI Analysis strip */}
      {analysis && (
        <div style={{
          padding: '12px 16px',
          background: 'rgba(37,99,171,0.06)',
          borderBottom: '1px solid var(--border)',
          borderLeft: '3px solid var(--cyan)',
        }}>
          <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--cyan)', marginBottom: 6 }}>
            AI Analysis
            {analysis.severity && (
              <span style={{
                marginLeft: 8,
                padding: '1px 7px',
                borderRadius: 100,
                background: `${SEVERITY_COLOR[analysis.severity] ?? '#999'}22`,
                color: SEVERITY_COLOR[analysis.severity] ?? '#999',
              }}>
                {analysis.severity}
              </span>
            )}
          </div>
          <p style={{ fontSize: 12, color: 'var(--text-mid)', margin: '0 0 8px', lineHeight: 1.6 }}>{analysis.summary}</p>
          {(analysis.rootCauses ?? []).length > 0 && (
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {(analysis.rootCauses ?? []).slice(0, 3).map((c, i) => (
                <span key={i} style={{ fontSize: 10, color: 'var(--text-dim)', background: 'var(--surface2)', padding: '2px 8px', borderRadius: 6, border: '1px solid var(--border)' }}>
                  {c}
                </span>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Filter + summary row */}
      <div style={{ padding: '10px 16px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 10 }}>
        <input
          type="text"
          placeholder="Filter test cases…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          style={{
            flex: 1,
            padding: '5px 10px',
            background: 'var(--surface2)',
            border: '1px solid var(--border)',
            borderRadius: 6,
            color: 'var(--text)',
            fontSize: 12,
            outline: 'none',
          }}
        />
        <span style={{ fontSize: 11, color: 'var(--text-dim)', fontFamily: 'var(--font-mono)', whiteSpace: 'nowrap' }}>
          {visibleResults.length} result{visibleResults.length !== 1 ? 's' : ''}
        </span>
      </div>

      {/* Results table */}
      <div style={{ overflow: 'auto', maxHeight: 300 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead>
            <tr>
              {['TC ID', 'Title', 'Suite', 'Duration', 'Status', 'Error'].map((h) => (
                <th key={h} style={{
                  padding: '6px 12px',
                  textAlign: 'left',
                  fontSize: 10,
                  fontWeight: 700,
                  textTransform: 'uppercase',
                  letterSpacing: '0.06em',
                  color: 'var(--text-dim)',
                  borderBottom: '1px solid var(--border)',
                  position: 'sticky',
                  top: 0,
                  background: 'var(--surface)',
                  whiteSpace: 'nowrap',
                }}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visibleResults.length === 0 ? (
              <tr>
                <td colSpan={6} style={{ padding: '20px 12px', textAlign: 'center', color: 'var(--text-dim)', fontSize: 12 }}>
                  No results found.
                </td>
              </tr>
            ) : visibleResults.map((r) => (
              <tr key={r.id} style={{ borderBottom: '1px solid var(--border)', background: r.status === 'FAILED' ? 'rgba(220,38,38,0.04)' : 'transparent' }}>
                <td style={{ padding: '7px 12px', fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-dim)', whiteSpace: 'nowrap' }}>
                  {r.testCase.tcId}
                </td>
                <td style={{ padding: '7px 12px', color: 'var(--text)', maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {r.testCase.title}
                </td>
                <td style={{ padding: '7px 12px', color: 'var(--text-dim)', fontSize: 11, whiteSpace: 'nowrap' }}>
                  {r.testCase.useCaseTag ?? '—'}
                </td>
                <td style={{ padding: '7px 12px', fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-dim)', whiteSpace: 'nowrap' }}>
                  {r.duration ? `${(r.duration / 1000).toFixed(1)}s` : '—'}
                </td>
                <td style={{ padding: '7px 12px', whiteSpace: 'nowrap' }}>
                  <span style={{ fontSize: 10, fontWeight: 700, color: STATUS_COLOR[r.status] ?? 'var(--text-dim)' }}>
                    {r.status}
                  </span>
                  {r.screenshotPath && (
                    <span title="Screenshot captured" style={{ marginLeft: 5, fontSize: 12, opacity: 0.7 }}>📷</span>
                  )}
                </td>
                <td style={{ padding: '7px 12px', fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--fail)', maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                    title={r.errorMessage ?? undefined}>
                  {r.errorMessage ? r.errorMessage.slice(0, 120) : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Footer actions */}
      <div style={{ padding: '10px 16px', borderTop: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 8, background: 'var(--surface2)' }}>
        {onExport && (
          <button
            onClick={() => onExport(runId)}
            style={{
              padding: '5px 14px',
              borderRadius: 6,
              background: 'rgba(164,123,250,0.12)',
              color: 'var(--violet)',
              border: '1px solid rgba(164,123,250,0.25)',
              cursor: 'pointer',
              fontSize: 11,
              fontWeight: 700,
              display: 'flex',
              alignItems: 'center',
              gap: 4,
            }}
          >
            📥 Download Excel Report
          </button>
        )}
        {onGenerate && !hasReport && (runStatus === 'PASSED' || runStatus === 'FAILED') && (
          <button
            onClick={() => onGenerate(runId)}
            style={{
              padding: '5px 14px',
              borderRadius: 6,
              background: 'rgba(37,99,171,0.12)',
              color: 'var(--cyan)',
              border: '1px solid rgba(37,99,171,0.25)',
              cursor: 'pointer',
              fontSize: 11,
              fontWeight: 700,
            }}
          >
            🤖 Generate AI Report
          </button>
        )}
        <span style={{ marginLeft: 'auto', fontSize: 10, color: 'var(--text-dim)', fontFamily: 'var(--font-mono)' }}>
          Run ID: {runId.slice(0, 12)}…
        </span>
      </div>
    </div>
  );
}

// ── Main table ─────────────────────────────────────────────────────────────

export default function RunHistoryTable({ projectId, runs, onExport, onGenerate }: RunHistoryTableProps) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  function toggle(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  if (runs.length === 0) {
    return (
      <div style={{ padding: '40px 0', textAlign: 'center', color: 'var(--text-dim)', fontSize: 12 }}>
        No runs found.
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      {runs.map((run) => {
        const isOpen = expanded.has(run.id);
        const passed = run.results.filter((r) => r.status === 'PASSED').length;
        const failed = run.results.filter((r) => r.status === 'FAILED').length;
        const total = run._count.results;
        const passRate = total > 0 ? Math.round((passed / total) * 100) : 0;

        // Parse severity from the list-level report data for the badge on the header row
        let severity: string | undefined;
        if (run.report?.aiAnalysis) {
          try {
            const a = JSON.parse(run.report.aiAnalysis) as { severity?: string };
            severity = a.severity;
          } catch { /* ignore */ }
        }

        return (
          <div key={run.id} style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden' }}>
            {/* Header row */}
            <div
              style={{ display: 'flex', alignItems: 'center', padding: '12px 16px', gap: 12, cursor: 'pointer' }}
              onClick={() => toggle(run.id)}
            >
              <span style={{ fontSize: 10, color: 'var(--text-dim)', transition: 'transform 0.15s', transform: isOpen ? 'rotate(90deg)' : 'rotate(0deg)', display: 'inline-block', flexShrink: 0 }}>
                ▶
              </span>
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: STATUS_COLOR[run.status] ?? 'var(--text-dim)', flexShrink: 0, display: 'inline-block' }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {run.name}
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-dim)', fontFamily: 'var(--font-mono)', marginTop: 2 }}>
                  {new Date(run.createdAt).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                  {' · '}{run.environment}
                  {' · '}{TRIGGER_LABEL[run.triggerType] ?? run.triggerType}
                  {' · '}{formatDuration(run.startedAt, run.completedAt)}
                </div>
              </div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexShrink: 0 }}>
                <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--pass)' }}>✓ {passed}</span>
                <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--fail)' }}>✗ {failed}</span>
                <span style={{
                  fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 100,
                  background: passRate >= 90 ? 'rgba(42,157,143,0.15)' : passRate >= 70 ? 'rgba(251,191,36,0.15)' : 'rgba(220,38,38,0.15)',
                  color: passRate >= 90 ? 'var(--pass)' : passRate >= 70 ? 'var(--amber)' : 'var(--fail)',
                }}>
                  {passRate}%
                </span>
                {severity && (
                  <span style={{ fontSize: 9, fontWeight: 700, padding: '1px 7px', borderRadius: 100, background: `${SEVERITY_COLOR[severity] ?? '#999'}22`, color: SEVERITY_COLOR[severity] ?? '#999', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                    {severity}
                  </span>
                )}
              </div>
              {/* Quick action buttons — stop propagation so they don't toggle the row */}
              <div style={{ display: 'flex', gap: 6, flexShrink: 0 }} onClick={(e) => e.stopPropagation()}>
                {onExport && (
                  <button
                    onClick={() => onExport(run.id)}
                    style={{ padding: '3px 10px', borderRadius: 6, background: 'rgba(164,123,250,0.12)', color: 'var(--violet)', border: '1px solid rgba(164,123,250,0.25)', cursor: 'pointer', fontSize: 11, fontWeight: 600 }}
                  >
                    Export
                  </button>
                )}
              </div>
            </div>

            {/* Expanded detail — lazily fetched */}
            {isOpen && (
              <ExpandedRunDetail
                projectId={projectId}
                runId={run.id}
                onExport={onExport}
                onGenerate={onGenerate}
                hasReport={!!run.report}
                runStatus={run.status}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
