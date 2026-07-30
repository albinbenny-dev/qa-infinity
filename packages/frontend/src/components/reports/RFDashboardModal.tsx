import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import * as Dialog from '@radix-ui/react-dialog';
import { api } from '../../lib/api';
import { useRfSummary, useRfSteps, type RfSummaryResult, type RfKeyword } from '../../hooks/useReports';
import { useProjectStore } from '../../stores/projectStore';

// ── Types ──────────────────────────────────────────────────────────────────

interface RunInfo {
  id: string;
  runSeq: number;
  name: string;
  status: string;
  environment: string;
  createdAt: string;
  completedAt?: string | null;
}

interface Props {
  open: boolean;
  onClose: () => void;
  projectId: string | undefined;
  run: RunInfo | null;
}

// ── Helpers ────────────────────────────────────────────────────────────────

function fmtMs(ms: number | null | undefined): string {
  if (!ms) return '—';
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  const m = Math.floor(ms / 60000);
  const s = Math.round((ms % 60000) / 1000);
  return s > 0 ? `${m}m ${s}s` : `${m}m`;
}

function statusColor(s: string) {
  if (s === 'PASSED' || s === 'PASS') return 'var(--emerald)';
  if (s === 'FAILED' || s === 'FAIL') return 'var(--fail)';
  return 'var(--amber)';
}

function statusBg(s: string) {
  if (s === 'PASSED' || s === 'PASS') return 'rgba(52,211,153,0.12)';
  if (s === 'FAILED' || s === 'FAIL') return 'rgba(220,38,38,0.12)';
  return 'rgba(251,191,36,0.12)';
}

// ── Keyword steps row (lazy-fetched per TC) ────────────────────────────────

function TCRow({
  projectId,
  runId,
  result,
  autoExpand,
}: {
  projectId: string;
  runId: string;
  result: RfSummaryResult;
  autoExpand: boolean;
}) {
  const [expanded, setExpanded] = useState(autoExpand);
  const { data: stepsData, isLoading: stepsLoading } = useRfSteps(
    projectId, runId, result.id, expanded && result.hasRfLog,
  );

  const isFailed = result.status === 'FAILED' || result.status === 'FAIL';

  // The parsed output.xml may have multiple RF test cases per file;
  // find the one whose name contains this TC's title or tcId.
  const matchedTest = stepsData?.tests.find(
    (t) => t.name.includes(result.tcId) || t.name.includes(result.title),
  ) ?? stepsData?.tests[0];

  return (
    <div style={{
      borderBottom: '1px solid var(--border)',
      background: expanded && isFailed ? 'rgba(220,38,38,0.03)' : 'transparent',
    }}>
      {/* Main row */}
      <div
        onClick={() => setExpanded((v) => !v)}
        style={{
          display: 'flex', alignItems: 'center', gap: 9,
          padding: '8px 16px', cursor: 'pointer',
        }}
        onMouseEnter={(e) => { (e.currentTarget as HTMLDivElement).style.background = 'rgba(255,255,255,0.03)'; }}
        onMouseLeave={(e) => { (e.currentTarget as HTMLDivElement).style.background = 'transparent'; }}
      >
        <span style={{
          width: 7, height: 7, borderRadius: '50%', flexShrink: 0,
          background: statusColor(result.status),
        }} />
        <span style={{
          fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--text-dim)',
          whiteSpace: 'nowrap', minWidth: 72,
        }}>
          {result.tcId}
        </span>
        <span style={{
          fontSize: 12, color: 'var(--text)', flex: 1,
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
        }}>
          {result.title}
        </span>
        <span style={{ fontSize: 11, color: 'var(--text-dim)', fontFamily: 'var(--font-mono)', whiteSpace: 'nowrap', minWidth: 44, textAlign: 'right' }}>
          {fmtMs(result.duration)}
        </span>
        {result.scriptFilename && (
          <span
            title={result.scriptFilename}
            style={{
              fontSize: 10, color: 'var(--text-dim)', cursor: 'default',
              whiteSpace: 'nowrap', maxWidth: 120, overflow: 'hidden',
              textOverflow: 'ellipsis', fontFamily: 'var(--font-mono)',
              padding: '1px 5px', borderRadius: 3,
              background: 'rgba(255,255,255,0.05)',
              border: '1px solid var(--border)',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {result.scriptFilename}
          </span>
        )}
        <span style={{
          fontSize: 10, fontWeight: 700, padding: '1px 7px', borderRadius: 3,
          background: statusBg(result.status), color: statusColor(result.status),
          whiteSpace: 'nowrap',
        }}>
          {result.status === 'PASSED' ? 'PASS' : result.status === 'FAILED' ? 'FAIL' : result.status}
        </span>
        <span style={{ fontSize: 12, color: 'var(--text-dim)', transition: 'transform 0.12s', transform: expanded ? 'rotate(90deg)' : 'rotate(0deg)' }}>
          ▶
        </span>
      </div>

      {/* Expanded: keyword steps */}
      {expanded && (
        <div style={{ borderTop: '1px solid var(--border)' }}>
          {stepsLoading && (
            <div style={{ padding: '8px 16px 8px 36px', fontSize: 11, color: 'var(--text-dim)', fontFamily: 'var(--font-mono)' }}>
              Loading steps…
            </div>
          )}
          {!result.hasRfLog && !stepsLoading && (
            <div style={{ padding: '8px 16px 8px 36px', fontSize: 11, color: 'var(--text-dim)' }}>
              No RF log available for this result.
            </div>
          )}
          {matchedTest && (
            <>
              {matchedTest.keywords.map((kw, i) => (
                <KeywordRow key={i} kw={kw} />
              ))}
            </>
          )}
          {/* Fallback: show error from DB if no steps parsed */}
          {!matchedTest && !stepsLoading && result.hasRfLog && (
            <div style={{ padding: '8px 16px 8px 36px', fontSize: 11, color: 'var(--text-dim)' }}>
              Could not parse keyword steps from output.xml.
            </div>
          )}
          {/* DB error message as fallback */}
          {isFailed && result.errorMessage && !matchedTest && (
            <div style={{
              margin: '0 16px 8px 36px', padding: '8px 10px',
              background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)',
              borderRadius: 6, fontSize: 11, fontFamily: 'var(--font-mono)',
              color: 'var(--text-mid)', lineHeight: 1.55,
            }}>
              {result.errorMessage}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function KeywordRow({ kw }: { kw: RfKeyword }) {
  const isFail = kw.status === 'FAIL' || kw.status === 'FAILED';
  return (
    <>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8,
        padding: '5px 16px 5px 36px',
        borderBottom: '1px solid rgba(255,255,255,0.035)',
        background: isFail ? 'rgba(220,38,38,0.04)' : 'transparent',
      }}>
        <span style={{
          width: 5, height: 5, borderRadius: '50%', flexShrink: 0,
          background: statusColor(kw.status),
        }} />
        <span style={{ fontSize: 11, color: 'var(--text-mid)', flex: 1 }}>
          {kw.type && kw.type !== 'kw' ? (
            <span style={{ fontSize: 9, fontWeight: 700, color: 'var(--text-dim)', marginRight: 5, textTransform: 'uppercase' }}>
              {kw.type}
            </span>
          ) : null}
          {kw.name}
        </span>
        <span style={{ fontSize: 10, color: 'var(--text-dim)', fontFamily: 'var(--font-mono)', whiteSpace: 'nowrap' }}>
          {fmtMs(kw.durationMs)}
        </span>
      </div>
      {isFail && kw.errorMsg && (
        <div style={{
          padding: '7px 16px 7px 44px',
          background: 'rgba(220,38,38,0.07)',
          borderBottom: '1px solid rgba(220,38,38,0.15)',
        }}>
          <div style={{ fontSize: 9, fontWeight: 700, color: 'var(--fail)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 3 }}>
            Error
          </div>
          <div style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--text-mid)', lineHeight: 1.55, wordBreak: 'break-all' }}>
            {kw.errorMsg}
          </div>
        </div>
      )}
    </>
  );
}

// ── Main modal ─────────────────────────────────────────────────────────────

export default function RFDashboardModal({ open, onClose, projectId, run }: Props) {
  const [filter, setFilter] = useState<'failed' | 'all'>('all');
  const navigate = useNavigate();
  const { projects } = useProjectStore();
  const projectSlug = projects.find(p => p.id === projectId)?.slug;

  const { data: summary, isLoading, error } = useRfSummary(projectId, run?.id ?? null);

  // Reset to "all" filter whenever a new run is opened
  useEffect(() => { if (open) setFilter('all'); }, [open, run?.id]);

  async function downloadExcel() {
    if (!projectId || !run) return;
    try {
      const res = await api.get(`/projects/${projectId}/reports/runs/${run.id}/export`, { responseType: 'blob' });
      const url = URL.createObjectURL(res.data as Blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `RUN-${String(run.runSeq).padStart(4, '0')}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
    } catch { /* silent */ }
  }

  async function downloadAllLogs() {
    if (!projectId || !run) return;
    try {
      const res = await api.get(`/projects/${projectId}/reports/runs/${run.id}/rf-logs-zip`, { responseType: 'blob' });
      const url = URL.createObjectURL(res.data as Blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `rf-logs-RUN-${String(run.runSeq).padStart(4, '0')}.zip`;
      a.click();
      URL.revokeObjectURL(url);
    } catch { /* silent */ }
  }

  const stats = summary?.stats;
  const groups = summary?.groups ?? [];
  const passRate = stats && stats.total > 0 ? Math.round((stats.passed / stats.total) * 100) : 0;

  const filteredGroups = groups.map((g) => ({
    ...g,
    results: filter === 'failed'
      ? g.results.filter((r) => r.status === 'FAILED' || r.status === 'FAIL')
      : g.results,
  })).filter((g) => g.results.length > 0);

  // Auto-expand logic: find the first failed result id
  const firstFailedResultId = groups
    .flatMap((g) => g.results)
    .find((r) => r.status === 'FAILED' || r.status === 'FAIL')?.id;

  const runSeqLabel = run ? `#${String(run.runSeq).padStart(4, '0')}` : '';
  const isFailed = run?.status === 'FAILED';
  const rfScriptCount = groups.filter((g) => g.results.some((r) => r.hasRfLog)).length;

  return (
    <Dialog.Root open={open} onOpenChange={(o) => !o && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay style={{
          position: 'fixed', inset: 0,
          background: 'rgba(0,0,0,0.6)',
          backdropFilter: 'blur(4px)',
          zIndex: 9998,
        }} />
        <Dialog.Content style={{
          position: 'fixed', top: '50%', left: '50%',
          transform: 'translate(-50%,-50%)',
          background: 'var(--surface)',
          border: '1px solid var(--border2)',
          borderRadius: 12,
          width: '680px',
          maxHeight: '88vh',
          display: 'flex',
          flexDirection: 'column',
          boxShadow: '0 24px 64px rgba(0,0,0,0.5)',
          zIndex: 9999,
          overflow: 'hidden',
          fontFamily: 'var(--font-ui)',
        }}>

          {/* Header */}
          <div style={{ padding: '14px 18px 12px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'flex-start', gap: 10 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <span style={{
                  fontSize: 10, fontWeight: 700, fontFamily: 'var(--font-mono)',
                  padding: '2px 7px', borderRadius: 5,
                  background: 'rgba(37,99,171,0.12)', color: 'var(--cyan)',
                  border: '1px solid rgba(37,99,171,0.25)', whiteSpace: 'nowrap',
                }}>
                  {runSeqLabel}
                </span>
                <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {run?.name ?? ''}
                </span>
                {isFailed && stats && stats.failed > 0 && (
                  <span style={{ fontSize: 11, fontWeight: 600, padding: '1px 8px', borderRadius: 4, background: 'rgba(220,38,38,0.12)', color: 'var(--fail)', whiteSpace: 'nowrap' }}>
                    ✗ {stats.failed} failed
                  </span>
                )}
                {!isFailed && (
                  <span style={{ fontSize: 11, fontWeight: 600, padding: '1px 8px', borderRadius: 4, background: 'rgba(52,211,153,0.12)', color: 'var(--emerald)', whiteSpace: 'nowrap' }}>
                    ✓ All passed
                  </span>
                )}
              </div>
              <div style={{ fontSize: 11, color: 'var(--text-dim)', fontFamily: 'var(--font-mono)', marginTop: 3 }}>
                {run?.environment ?? ''} · {run ? new Date(run.createdAt).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : ''}
              </div>
            </div>
            <Dialog.Close asChild>
              <button style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-dim)', fontSize: 18, lineHeight: 1, padding: 2, flexShrink: 0 }} aria-label="Close">✕</button>
            </Dialog.Close>
          </div>

          {/* Stats strip */}
          {stats && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5,1fr)', gap: 1, background: 'var(--border)', borderBottom: '1px solid var(--border)' }}>
              {[
                { val: stats.total, label: 'Total', color: 'var(--text)' },
                { val: stats.passed, label: 'Passed', color: 'var(--emerald)' },
                { val: stats.failed, label: 'Failed', color: 'var(--fail)' },
                { val: stats.skipped, label: 'Skipped', color: 'var(--amber)' },
                { val: fmtMs(stats.durationMs), label: 'Duration', color: 'var(--text)' },
              ].map(({ val, label, color }) => (
                <div key={label} style={{ background: 'var(--surface)', padding: '10px 14px' }}>
                  <div style={{ fontSize: typeof val === 'number' ? 20 : 16, fontWeight: 500, color, lineHeight: 1 }}>{val}</div>
                  <div style={{ fontSize: 10, color: 'var(--text-dim)', marginTop: 3 }}>{label}</div>
                </div>
              ))}
            </div>
          )}

          {/* Progress bar */}
          {stats && stats.total > 0 && (
            <div style={{ padding: '8px 18px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 10, background: 'var(--surface2)' }}>
              <div style={{ flex: 1, height: 5, background: 'rgba(255,255,255,0.08)', borderRadius: 3, overflow: 'hidden', display: 'flex' }}>
                <div style={{ height: '100%', background: 'var(--emerald)', width: `${passRate}%`, transition: 'width 0.3s' }} />
                <div style={{ height: '100%', background: 'var(--fail)', width: `${Math.round((stats.failed / stats.total) * 100)}%`, transition: 'width 0.3s' }} />
              </div>
              <span style={{ fontSize: 10, color: 'var(--text-dim)', whiteSpace: 'nowrap' }}>{passRate}% pass rate</span>
            </div>
          )}

          {/* Filter bar */}
          <div style={{ padding: '8px 18px', borderBottom: '1px solid var(--border)', display: 'flex', gap: 6, alignItems: 'center', background: 'var(--surface2)' }}>
            <button
              onClick={() => setFilter('all')}
              style={{
                fontSize: 11, fontWeight: 600, padding: '3px 11px', borderRadius: 12,
                border: filter === 'all' ? '1px solid rgba(37,99,171,0.35)' : '1px solid var(--border)',
                background: filter === 'all' ? 'rgba(37,99,171,0.1)' : 'transparent',
                color: filter === 'all' ? 'var(--cyan)' : 'var(--text-dim)',
                cursor: 'pointer',
              }}
            >
              All ({stats?.total ?? 0})
            </button>
            <span style={{ fontSize: 10, color: 'var(--text-dim)', fontFamily: 'var(--font-mono)' }}>
              {groups.length} use case{groups.length !== 1 ? 's' : ''} · {stats?.total ?? 0} TC{(stats?.total ?? 0) !== 1 ? 's' : ''}
            </span>
            <button
              onClick={() => setFilter('failed')}
              style={{
                marginLeft: 'auto',
                fontSize: 11, fontWeight: 600, padding: '3px 11px', borderRadius: 12,
                border: filter === 'failed' ? '1px solid rgba(220,38,38,0.35)' : '1px solid var(--border)',
                background: filter === 'failed' ? 'rgba(220,38,38,0.1)' : 'transparent',
                color: filter === 'failed' ? 'var(--fail)' : 'var(--text-dim)',
                cursor: 'pointer',
              }}
            >
              Failed ({stats?.failed ?? 0})
            </button>
          </div>

          {/* Body */}
          <div style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
            {isLoading && (
              <div style={{ padding: '32px 18px', textAlign: 'center', color: 'var(--text-dim)', fontSize: 12 }}>
                Loading run data…
              </div>
            )}
            {error && (
              <div style={{ padding: '32px 18px', textAlign: 'center', color: 'var(--fail)', fontSize: 12 }}>
                Failed to load run summary.
              </div>
            )}
            {!isLoading && !error && filteredGroups.length === 0 && (
              <div style={{ padding: '32px 18px', textAlign: 'center', color: 'var(--text-dim)', fontSize: 12 }}>
                {filter === 'failed' ? 'No failures — all tests passed.' : 'No results found.'}
              </div>
            )}
            {filteredGroups.map((group) => (
              <div key={group.useCaseTag} style={{ borderBottom: '1px solid var(--border)' }}>
                {/* Use-case group header — always shown */}
                <div style={{
                  padding: '6px 16px', background: 'var(--surface2)',
                  borderBottom: '1px solid var(--border)',
                  display: 'flex', alignItems: 'center', gap: 8,
                  fontSize: 11, color: 'var(--text-mid)', fontWeight: 600,
                }}>
                  <span style={{ fontSize: 11, color: 'var(--text-dim)' }}>▸</span>
                  <span style={{ flex: 1, fontSize: 11 }}>{group.useCaseTag}</span>
                  <span style={{ fontSize: 10, padding: '1px 6px', borderRadius: 3, background: 'rgba(52,211,153,0.1)', color: 'var(--emerald)' }}>
                    {group.passed} pass
                  </span>
                  {group.failed > 0 && (
                    <span style={{ fontSize: 10, padding: '1px 6px', borderRadius: 3, background: 'rgba(220,38,38,0.1)', color: 'var(--fail)' }}>
                      {group.failed} fail
                    </span>
                  )}
                  {group.skipped > 0 && (
                    <span style={{ fontSize: 10, padding: '1px 6px', borderRadius: 3, background: 'rgba(251,191,36,0.1)', color: 'var(--amber)' }}>
                      {group.skipped} skip
                    </span>
                  )}
                </div>
                {projectId && group.results.map((result) => (
                  <TCRow
                    key={result.id}
                    projectId={projectId}
                    runId={run!.id}
                    result={result}
                    autoExpand={result.id === firstFailedResultId}
                  />
                ))}
              </div>
            ))}
          </div>

          {/* Footer */}
          <div style={{ padding: '11px 18px', borderTop: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 8 }}>
            <button
              onClick={downloadExcel}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 12, fontWeight: 600,
                padding: '6px 13px', borderRadius: 6,
                background: 'rgba(37,99,171,0.1)', color: 'var(--cyan)',
                border: '1px solid rgba(37,99,171,0.25)', cursor: 'pointer',
              }}
            >
              ⬇ Excel Report
            </button>
            {projectSlug && run && (
              <Dialog.Close asChild>
                <button
                  onClick={() => navigate(`/projects/${projectSlug}/reports/runs/${run.id}`)}
                  style={{
                    display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 12, fontWeight: 600,
                    padding: '6px 13px', borderRadius: 6,
                    background: 'transparent', color: 'var(--text-mid)',
                    border: '1px solid var(--border2)', cursor: 'pointer',
                  }}
                >
                  ↗ View Full Report
                </button>
              </Dialog.Close>
            )}
            {rfScriptCount > 0 && (
              <button
                onClick={downloadAllLogs}
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 12, fontWeight: 600,
                  padding: '6px 13px', borderRadius: 6,
                  background: 'transparent', color: 'var(--text-mid)',
                  border: '1px solid var(--border2)', cursor: 'pointer',
                }}
              >
                ⬇ All RF Logs (.zip)
              </button>
            )}
            <Dialog.Close asChild>
              <button style={{
                marginLeft: 'auto', fontSize: 12, padding: '6px 14px', borderRadius: 6,
                background: 'transparent', color: 'var(--text-dim)',
                border: '1px solid var(--border)', cursor: 'pointer',
              }}>
                Close
              </button>
            </Dialog.Close>
          </div>

        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
