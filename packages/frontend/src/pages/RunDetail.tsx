import { useState, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import Topbar, { TbBtn } from '../components/layout/Topbar';
import { useReportRun } from '../hooks/useReports';
import { useProject } from '../hooks/useProjects';
import { useProjectStore } from '../stores/projectStore';
import { api } from '../lib/api';

// ── Helpers ────────────────────────────────────────────────────────────────

const STATUS_COLOR: Record<string, string> = {
  PASSED: 'var(--pass)',
  FAILED: 'var(--fail)',
  RUNNING: 'var(--cyan)',
  PENDING: 'var(--amber)',
  CANCELLED: 'var(--text-dim)',
  SKIPPED: 'var(--skip)',
};

function fmtMs(ms: number | null | undefined): string {
  if (ms == null) return '—';
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)}s`;
  const m = Math.floor(s / 60);
  return `${m}m ${Math.round(s % 60)}s`;
}

function fmtSpan(start?: string | null, end?: string | null): string {
  if (!start || !end) return '—';
  return fmtMs(new Date(end).getTime() - new Date(start).getTime());
}

// ── Clickable stat tile ────────────────────────────────────────────────────

interface StatTileProps {
  label: string;
  value: string | number;
  accent: string;
  active?: boolean;
  onClick?: () => void;
}

function StatTile({ label, value, accent, active, onClick }: StatTileProps) {
  return (
    <div
      onClick={onClick}
      style={{
        background: active ? 'var(--surface2)' : 'var(--surface)',
        border: `1px solid ${active ? 'rgba(37,99,171,0.6)' : 'var(--border)'}`,
        borderRadius: 10, padding: '14px 16px', flex: 1,
        position: 'relative', overflow: 'hidden',
        boxShadow: active ? '0 0 0 2px rgba(37,99,171,0.15)' : 'var(--shadow-card)',
        cursor: onClick ? 'pointer' : 'default',
        transition: 'border-color 0.15s, box-shadow 0.15s',
        userSelect: 'none',
      }}
    >
      <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 3, background: accent }} />
      <div style={{ fontSize: 28, fontWeight: 800, color: '#F47B20', lineHeight: 1, marginTop: 4 }}>{value}</div>
      <div style={{ fontSize: 10, color: 'var(--text-dim)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.07em', marginTop: 3 }}>
        {label}
      </div>
      {onClick && (
        <div style={{ position: 'absolute', bottom: 5, right: 8, fontSize: 9, color: active ? 'var(--cyan)' : 'var(--text-dim)', opacity: 0.8 }}>
          {active ? '✕ clear' : 'filter'}
        </div>
      )}
    </div>
  );
}

// ── Use-case group header ──────────────────────────────────────────────────

type Result = ReturnType<typeof useReportRun>['data'] extends { results: (infer R)[] } | undefined ? R : never;

interface GroupHeaderProps {
  groupKey: string;
  groupResults: Result[];
  isOpen: boolean;
  onToggle: () => void;
}

function GroupHeader({ groupKey, groupResults, isOpen, onToggle }: GroupHeaderProps) {
  const total   = groupResults.length;
  const passed  = groupResults.filter(r => r.status === 'PASSED').length;
  const failed  = groupResults.filter(r => r.status === 'FAILED').length;
  const skipped = groupResults.filter(r => r.status === 'SKIPPED').length;
  const pct     = total > 0 ? Math.round((passed / total) * 100) : 0;

  const barColor = failed > 0
    ? 'linear-gradient(90deg, var(--pass) 0%, var(--fail) 100%)'
    : 'var(--pass)';

  return (
    <div
      onClick={onToggle}
      style={{
        display: 'flex', alignItems: 'center', gap: 12,
        padding: '11px 16px', borderBottom: '1px solid var(--border)',
        cursor: 'pointer', background: 'var(--surface2)',
        transition: 'background 0.12s',
      }}
    >
      {/* chevron */}
      <span style={{ fontSize: 9, color: 'var(--cyan)', width: 10, flexShrink: 0 }}>
        {isOpen ? '▼' : '▶'}
      </span>

      {/* use case name */}
      <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)', flex: '0 0 auto', maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {groupKey}
      </span>

      {/* TC count pill */}
      <span style={{
        fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 100,
        background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--text-dim)',
        flexShrink: 0,
      }}>
        {total} TC{total !== 1 ? 's' : ''}
      </span>

      {/* progress bar — fills remaining space */}
      <div style={{ flex: 1, minWidth: 60, maxWidth: 200 }}>
        <div style={{ height: 6, borderRadius: 3, background: 'var(--border)', overflow: 'hidden' }}>
          <div style={{
            height: '100%', borderRadius: 3,
            width: `${pct}%`,
            background: barColor,
            transition: 'width 0.3s ease',
          }} />
        </div>
        <div style={{ fontSize: 10, color: 'var(--text-dim)', marginTop: 2, fontVariantNumeric: 'tabular-nums' }}>
          {pct}% pass
        </div>
      </div>

      {/* stats */}
      <div style={{ display: 'flex', gap: 10, flexShrink: 0, alignItems: 'center' }}>
        <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--pass)', display: 'flex', alignItems: 'center', gap: 3 }}>
          <span>✓</span><span>{passed}</span>
        </span>
        {failed > 0 && (
          <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--fail)', display: 'flex', alignItems: 'center', gap: 3 }}>
            <span>✗</span><span>{failed}</span>
          </span>
        )}
        {skipped > 0 && (
          <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-dim)', display: 'flex', alignItems: 'center', gap: 3 }}>
            <span>⊙</span><span>{skipped}</span>
          </span>
        )}
      </div>
    </div>
  );
}

// ── Result row ─────────────────────────────────────────────────────────────

function ResultRow({ r }: { r: Result }) {
  const rowBg = r.status === 'FAILED'
    ? 'rgba(220,38,38,0.04)'
    : r.status === 'SKIPPED'
    ? 'rgba(251,191,36,0.04)'
    : 'transparent';
  const dur = fmtMs(r.duration);
  const err = r.errorMessage
    ? (r.errorMessage.length > 80 ? r.errorMessage.slice(0, 77) + '…' : r.errorMessage)
    : null;

  return (
    <tr style={{ background: rowBg, borderBottom: '1px solid var(--border)' }}>
      <td style={{ padding: '8px 14px', fontSize: 12, maxWidth: 380 }}>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-dim)', marginRight: 6 }}>
          {r.testCase.tcId}
        </span>
        <span style={{ color: 'var(--text)' }}>{r.testCase.title}</span>
        {err && (
          <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 2, lineHeight: 1.4 }}>
            {err}
          </div>
        )}
      </td>
      <td style={{ padding: '8px 14px', fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--text-dim)', whiteSpace: 'nowrap', textAlign: 'right' }}>
        {dur}
      </td>
      <td style={{ padding: '8px 14px', textAlign: 'center' }}>
        <span style={{
          fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 100,
          color: STATUS_COLOR[r.status] ?? 'var(--text-dim)',
          background: r.status === 'PASSED' ? 'rgba(42,157,143,0.1)'
            : r.status === 'FAILED' ? 'rgba(220,38,38,0.1)'
            : r.status === 'SKIPPED' ? 'rgba(251,191,36,0.1)'
            : 'rgba(107,114,128,0.1)',
          border: `1px solid ${STATUS_COLOR[r.status] ?? 'var(--border)'}`,
          opacity: 0.9,
        }}>
          {r.status}
        </span>
      </td>
    </tr>
  );
}

// ── Run stats strip ────────────────────────────────────────────────────────

function RunStats({ results, startedAt, completedAt }: {
  results: Result[];
  startedAt?: string | null;
  completedAt?: string | null;
}) {
  const totalDur = fmtSpan(startedAt, completedAt);
  const withDur  = results.filter(r => r.duration != null);
  const avgMs    = withDur.length > 0
    ? withDur.reduce((s, r) => s + (r.duration ?? 0), 0) / withDur.length
    : null;

  const top5 = useMemo(() =>
    [...results]
      .filter(r => r.duration != null)
      .sort((a, b) => (b.duration ?? 0) - (a.duration ?? 0))
      .slice(0, 5),
    [results],
  );

  return (
    <div style={{
      background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10,
      padding: '14px 18px', display: 'flex', gap: 24, flexWrap: 'wrap', alignItems: 'flex-start',
      boxShadow: 'var(--shadow-card)',
    }}>
      {/* time stats */}
      <div style={{ display: 'flex', gap: 20, flexShrink: 0 }}>
        <div>
          <div style={{ fontSize: 10, color: 'var(--text-dim)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Total Duration</div>
          <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--text)', marginTop: 3, fontVariantNumeric: 'tabular-nums' }}>{totalDur}</div>
        </div>
        <div>
          <div style={{ fontSize: 10, color: 'var(--text-dim)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Avg per Test</div>
          <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--text)', marginTop: 3, fontVariantNumeric: 'tabular-nums' }}>{avgMs != null ? fmtMs(avgMs) : '—'}</div>
        </div>
      </div>

      {/* divider */}
      <div style={{ width: 1, background: 'var(--border)', alignSelf: 'stretch' }} />

      {/* top 5 slowest */}
      <div style={{ flex: 1, minWidth: 260 }}>
        <div style={{ fontSize: 10, color: 'var(--text-dim)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>
          Top 5 Slowest Tests
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
          {top5.length === 0 && (
            <span style={{ fontSize: 11, color: 'var(--text-dim)' }}>No timing data</span>
          )}
          {top5.map((r, i) => {
            const maxMs = top5[0]?.duration ?? 1;
            const pct   = Math.round(((r.duration ?? 0) / maxMs) * 100);
            return (
              <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 9, color: 'var(--text-dim)', fontVariantNumeric: 'tabular-nums', width: 10, flexShrink: 0 }}>
                  {i + 1}
                </span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ height: 4, borderRadius: 2, background: 'var(--border)', overflow: 'hidden', marginBottom: 2 }}>
                    <div style={{
                      height: '100%', borderRadius: 2,
                      width: `${pct}%`,
                      background: r.status === 'FAILED' ? 'var(--fail)' : 'var(--cyan)',
                    }} />
                  </div>
                  <span style={{ fontSize: 11, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'block' }}>
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-dim)', marginRight: 4 }}>{r.testCase.tcId}</span>
                    {r.testCase.title}
                  </span>
                </div>
                <span style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--text-dim)', flexShrink: 0, fontVariantNumeric: 'tabular-nums' }}>
                  {fmtMs(r.duration)}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ── Page ───────────────────────────────────────────────────────────────────

const inputStyle: React.CSSProperties = {
  background: 'var(--surface2)',
  border: '1px solid var(--border)',
  borderRadius: 6,
  color: 'var(--text)',
  fontSize: 12,
  padding: '5px 10px',
  outline: 'none',
};

export default function RunDetail() {
  const { slug, runId } = useParams<{ slug: string; runId: string }>();
  const navigate = useNavigate();
  const { data: project } = useProject(slug);
  const projectId = project?.id;
  const { activeProject } = useProjectStore();
  const { data: run, isLoading } = useReportRun(projectId, runId ?? null);

  const [statusFilter, setStatusFilter] = useState('');
  const [search, setSearch]             = useState('');
  const [expandedGroups, setExpandedGroups] = useState<Set<string> | null>(null);
  const [exporting, setExporting]       = useState(false);

  const results = run?.results ?? [];

  const filtered = useMemo(() => {
    return results.filter((r) => {
      if (statusFilter && r.status !== statusFilter) return false;
      if (search) {
        const q = search.toLowerCase();
        if (!r.testCase.title.toLowerCase().includes(q) && !r.testCase.tcId.toLowerCase().includes(q)) return false;
      }
      return true;
    });
  }, [results, statusFilter, search]);

  const groupedMap = useMemo(() => {
    const m = new Map<string, typeof filtered>();
    for (const r of filtered) {
      const key = r.testCase.useCaseTag ?? 'Uncategorized';
      if (!m.has(key)) m.set(key, []);
      m.get(key)!.push(r);
    }
    return m;
  }, [filtered]);

  const groups = Array.from(groupedMap.entries());

  const defaultExpanded = useMemo(() => new Set(Array.from(groupedMap.keys())), [groupedMap]);
  const activeExpanded  = expandedGroups ?? defaultExpanded;

  function toggleGroup(key: string) {
    const next = new Set(activeExpanded);
    if (next.has(key)) next.delete(key); else next.add(key);
    setExpandedGroups(next);
  }

  function toggleStatusFilter(s: string) {
    setStatusFilter(prev => prev === s ? '' : s);
  }

  const total    = results.length;
  const passed   = results.filter((r) => r.status === 'PASSED').length;
  const failed   = results.filter((r) => r.status === 'FAILED').length;
  const skipped  = results.filter((r) => r.status === 'SKIPPED').length;
  const passRate = total > 0 ? Math.round((passed / total) * 100) : 0;

  async function handleExport() {
    if (!projectId || !runId || exporting) return;
    setExporting(true);
    try {
      const res = await api.get(`/projects/${projectId}/reports/runs/${runId}/export`, { responseType: 'blob' });
      const url = URL.createObjectURL(new Blob([res.data as BlobPart]));
      const a = document.createElement('a');
      a.href = url;
      a.download = `run-report-${String(run?.runSeq ?? '').padStart(4, '0')}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      /* silent — user can retry */
    } finally {
      setExporting(false);
    }
  }

  const colHeader: React.CSSProperties = {
    fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em',
    color: 'var(--text-dim)', padding: '8px 14px', borderBottom: '1px solid var(--border)',
    textAlign: 'left', background: 'var(--surface2)',
  };

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <Topbar
        breadcrumbs={[
          { label: 'All Projects', href: '/projects' },
          { label: activeProject?.name ?? slug ?? '' },
          { label: 'Reports', href: `/projects/${slug}/reports` },
          { label: `#${String(run?.runSeq ?? 0).padStart(4, '0')} ${run?.name ?? ''}` },
        ]}
        actions={
          <TbBtn variant="ghost" onClick={() => navigate(`/projects/${slug}/reports`)} style={{ background: 'rgba(37,99,171,0.1)', color: 'var(--cyan)', border: '1px solid rgba(37,99,171,0.25)' }}>
            ← Back
          </TbBtn>
        }
      />

      <div style={{ flex: 1, overflow: 'auto', padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 18 }}>
        {isLoading ? (
          <div style={{ textAlign: 'center', color: 'var(--text-dim)', fontSize: 13, paddingTop: 60 }}>Loading run details…</div>
        ) : !run ? (
          <div style={{ textAlign: 'center', color: 'var(--text-dim)', fontSize: 13, paddingTop: 60 }}>Run not found.</div>
        ) : (
          <>
            {/* Run header */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ width: 10, height: 10, borderRadius: '50%', background: STATUS_COLOR[run.status] ?? 'var(--text-dim)', display: 'inline-block', flexShrink: 0 }} />
              <span style={{ fontSize: 16, fontWeight: 700, color: 'var(--text)' }}>{run.name}</span>
              <span style={{ fontSize: 12, color: 'var(--text-dim)', fontFamily: 'var(--font-mono)' }}>
                #{String(run.runSeq).padStart(4, '0')} · {run.environment} · {new Date(run.createdAt).toLocaleString([], { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
              </span>
            </div>

            {/* Clickable stat tiles */}
            <div style={{ display: 'flex', gap: 12 }}>
              <StatTile label="Total"     value={total}        accent="linear-gradient(90deg, var(--cyan), #2563AB)"      onClick={() => toggleStatusFilter('')} />
              <StatTile label="Passed"    value={passed}       accent="linear-gradient(90deg, var(--pass), #1a7a6e)"      active={statusFilter === 'PASSED'}   onClick={() => toggleStatusFilter('PASSED')} />
              <StatTile label="Failed"    value={failed}       accent="linear-gradient(90deg, var(--fail), #b91c1c)"      active={statusFilter === 'FAILED'}   onClick={() => toggleStatusFilter('FAILED')} />
              <StatTile label="Skipped"   value={skipped}      accent="linear-gradient(90deg, var(--amber), #D97706)"     active={statusFilter === 'SKIPPED'}  onClick={() => toggleStatusFilter('SKIPPED')} />
              <StatTile label="Pass Rate" value={`${passRate}%`} accent="linear-gradient(90deg, var(--skip), #D9601A)" />
            </div>

            {/* Run stats (duration + top 5 slowest) */}
            <RunStats results={results} startedAt={run.startedAt} completedAt={run.completedAt} />

            {/* Search + export toolbar */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search test cases…"
                style={{ ...inputStyle, minWidth: 200 }}
              />
              <span style={{ fontSize: 11, color: 'var(--text-dim)', fontFamily: 'var(--font-mono)' }}>
                {filtered.length} result{filtered.length !== 1 ? 's' : ''}
                {statusFilter ? ` · ${statusFilter.toLowerCase()}` : ''}
              </span>
              <div style={{ flex: 1 }} />
              <button
                onClick={handleExport}
                disabled={exporting}
                style={{
                  display: 'flex', alignItems: 'center', gap: 6,
                  padding: '6px 14px', borderRadius: 7, fontSize: 12, fontWeight: 600,
                  background: 'rgba(42,157,143,0.1)', color: 'var(--pass)',
                  border: '1px solid rgba(42,157,143,0.3)',
                  cursor: exporting ? 'not-allowed' : 'pointer',
                  opacity: exporting ? 0.6 : 1,
                }}
              >
                {exporting ? '⏳ Exporting…' : '⬇ Download Excel'}
              </button>
            </div>

            {/* Results grouped by use case */}
            <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, boxShadow: 'var(--shadow-card)', overflow: 'hidden' }}>
              {groups.length === 0 ? (
                <div style={{ padding: '40px 0', textAlign: 'center', color: 'var(--text-dim)', fontSize: 12 }}>
                  No results match the current filters.
                </div>
              ) : (
                groups.map(([groupKey, groupResults]) => {
                  const isOpen = activeExpanded.has(groupKey);
                  return (
                    <div key={groupKey}>
                      <GroupHeader
                        groupKey={groupKey}
                        groupResults={groupResults}
                        isOpen={isOpen}
                        onToggle={() => toggleGroup(groupKey)}
                      />
                      {isOpen && (
                        <div style={{ overflowX: 'auto' }}>
                          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 400 }}>
                            <thead>
                              <tr>
                                <th style={colHeader}>Test Case</th>
                                <th style={{ ...colHeader, width: 80, textAlign: 'right' }}>Duration</th>
                                <th style={{ ...colHeader, width: 100, textAlign: 'center' }}>Status</th>
                              </tr>
                            </thead>
                            <tbody>
                              {groupResults.map((r) => <ResultRow key={r.id} r={r} />)}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
