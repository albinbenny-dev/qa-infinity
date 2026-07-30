import { useState, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ListChecks, CheckCircle2, XCircle, MinusCircle, TrendingUp, type LucideIcon } from 'lucide-react';
import Topbar, { TbBtn } from '../components/layout/Topbar';
import { useReportRun, useRunTrend } from '../hooks/useReports';
import { useProject } from '../hooks/useProjects';
import { useProjectStore } from '../stores/projectStore';
import { api } from '../lib/api';
import type { RunTrendPoint } from '../types';

// ── Helpers ────────────────────────────────────────────────────────────────

const STATUS_COLOR: Record<string, string> = {
  PASSED:    'var(--pass)',
  FAILED:    'var(--fail)',
  RUNNING:   'var(--cyan)',
  PENDING:   'var(--amber)',
  CANCELLED: 'var(--text-dim)',
  SKIPPED:   'var(--skip)',
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

// ── Stat tile ──────────────────────────────────────────────────────────────

interface StatTileProps {
  label:       string;
  value:       string | number;
  accent:      string;
  valueColor?: string;
  icon:        LucideIcon;
  active?:     boolean;
  onClick?:    () => void;
}

function StatTile({ label, value, accent, valueColor, icon: Icon, active, onClick }: StatTileProps) {
  const [hov, setHov] = useState(false);
  const color = valueColor ?? accent;
  return (
    <div
      onClick={onClick}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{
        background: active ? 'var(--surface2)' : hov && onClick ? 'var(--surface2)' : 'var(--surface)',
        border: `1px solid ${active ? accent : 'var(--border)'}`,
        borderTop: `3px solid ${accent}`,
        borderRadius: 10, padding: '12px 16px', flex: 1,
        boxShadow: active ? `0 0 0 2px ${accent}22` : 'var(--shadow-card)',
        cursor: onClick ? 'pointer' : 'default',
        transition: 'border-color 0.15s, background 0.12s',
        userSelect: 'none',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <Icon size={17} strokeWidth={2} color={color} style={{ flexShrink: 0 }} />
        <div style={{ fontSize: 26, fontWeight: 800, color, lineHeight: 1 }}>{value}</div>
      </div>
      <div style={{ fontSize: 10, color: 'var(--text-dim)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em', marginTop: 5 }}>
        {label}
      </div>
      {onClick && (
        <div style={{ fontSize: 9, color: active ? accent : 'var(--text-dim)', opacity: 0.75, marginTop: 2 }}>
          {active ? '✕ clear filter' : 'click to filter'}
        </div>
      )}
    </div>
  );
}

// ── Group header ───────────────────────────────────────────────────────────

type Result = ReturnType<typeof useReportRun>['data'] extends { results: (infer R)[] } | undefined ? R : never;

interface GroupHeaderProps {
  groupKey:     string;
  groupResults: Result[];
  isOpen:       boolean;
  onToggle:     () => void;
}

function GroupHeader({ groupKey, groupResults, isOpen, onToggle }: GroupHeaderProps) {
  const total   = groupResults.length;
  const passed  = groupResults.filter(r => r.status === 'PASSED').length;
  const failed  = groupResults.filter(r => r.status === 'FAILED').length;
  const skipped = groupResults.filter(r => r.status === 'SKIPPED').length;
  const pct     = total > 0 ? Math.round((passed / total) * 100) : 0;
  const accentColor = failed > 0 ? 'var(--fail)' : 'var(--pass)';

  return (
    <div
      onClick={onToggle}
      style={{
        display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
        padding: '9px 14px',
        cursor: 'pointer',
        borderLeft: `3px solid ${accentColor}`,
        background: 'var(--surface2)',
        borderBottom: isOpen ? '1px solid var(--border)' : 'none',
      }}
    >
      <span style={{ fontSize: 8, color: 'var(--text-dim)', flexShrink: 0 }}>{isOpen ? '▼' : '▶'}</span>

      <span style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--text)', flexShrink: 0 }}>
        {groupKey}
      </span>

      {/* Total TCs */}
      <span style={{
        fontSize: 10.5, fontWeight: 600, color: 'var(--text-dim)',
        padding: '1px 8px', borderRadius: 100,
        background: 'rgba(255,255,255,0.06)', border: '1px solid var(--border)',
        flexShrink: 0,
      }}>
        {total} TC{total !== 1 ? 's' : ''}
      </span>

      {/* Progress bar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flex: '1 1 100px', minWidth: 80, maxWidth: 180 }}>
        <div style={{ flex: 1, height: 5, borderRadius: 2, background: 'var(--border)', overflow: 'hidden' }}>
          <div style={{ height: '100%', borderRadius: 2, width: `${pct}%`, background: 'var(--pass)', transition: 'width 0.3s' }} />
        </div>
        <span style={{ fontSize: 10, color: 'var(--text-dim)', minWidth: 28, fontVariantNumeric: 'tabular-nums' }}>{pct}%</span>
      </div>

      {/* Labeled pass/fail counts — pushed right */}
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginLeft: 'auto', flexShrink: 0 }}>
        <span style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--pass)', display: 'flex', alignItems: 'center', gap: 4 }}>
          <span>✓</span><span>{passed} Passed</span>
        </span>
        <span style={{ fontSize: 11.5, fontWeight: 700, color: failed > 0 ? 'var(--fail)' : 'var(--text-dim)', display: 'flex', alignItems: 'center', gap: 4 }}>
          <span>✗</span><span>{failed} Failed</span>
        </span>
        {skipped > 0 && (
          <span style={{ fontSize: 11, color: 'var(--text-dim)' }}>⊙ {skipped} Skipped</span>
        )}
      </div>
    </div>
  );
}

// ── Result row (table row) ─────────────────────────────────────────────────

function ResultRow({ r }: { r: Result }) {
  const statusBg = r.status === 'PASSED'  ? 'rgba(42,157,143,0.1)'
    : r.status === 'FAILED'   ? 'rgba(220,38,38,0.1)'
    : r.status === 'SKIPPED'  ? 'rgba(251,191,36,0.1)'
    : 'rgba(107,114,128,0.1)';
  const statusBorder = r.status === 'PASSED'  ? 'rgba(42,157,143,0.3)'
    : r.status === 'FAILED'   ? 'rgba(220,38,38,0.3)'
    : r.status === 'SKIPPED'  ? 'rgba(251,191,36,0.3)'
    : 'rgba(107,114,128,0.2)';

  return (
    <tr style={{
      background: r.status === 'FAILED' ? 'rgba(220,38,38,0.025)' : 'transparent',
      borderBottom: '1px solid var(--border)',
    }}>
      {/* TC ID */}
      <td style={{ padding: '8px 8px 8px 14px', verticalAlign: 'top', whiteSpace: 'nowrap' }}>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-dim)' }}>
          {r.testCase.tcId}
        </span>
      </td>

      {/* Title + error */}
      <td style={{ padding: '8px 10px', verticalAlign: 'top' }}>
        <div style={{ fontSize: 12, color: 'var(--text)', fontWeight: 500, lineHeight: 1.4 }}>
          {r.testCase.title}
        </div>
        {r.errorMessage && (
          <div style={{
            fontSize: 10.5, color: 'var(--text-dim)', marginTop: 3, lineHeight: 1.45,
            display: '-webkit-box',
            WebkitLineClamp: 3,
            WebkitBoxOrient: 'vertical',
            overflow: 'hidden',
          } as React.CSSProperties}>
            {r.errorMessage}
          </div>
        )}
      </td>

      {/* Duration */}
      <td style={{ padding: '8px 10px', textAlign: 'right', verticalAlign: 'middle', whiteSpace: 'nowrap' }}>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-dim)', fontVariantNumeric: 'tabular-nums' }}>
          {fmtMs(r.duration)}
        </span>
      </td>

      {/* Status */}
      <td style={{ padding: '8px 14px 8px 8px', textAlign: 'center', verticalAlign: 'middle' }}>
        <span style={{
          display: 'inline-block',
          fontSize: 9.5, fontWeight: 700, padding: '2px 9px', borderRadius: 100,
          color: STATUS_COLOR[r.status] ?? 'var(--text-dim)',
          background: statusBg, border: `1px solid ${statusBorder}`,
          whiteSpace: 'nowrap',
        }}>
          {r.status}
        </span>
      </td>
    </tr>
  );
}

// ── Regression trend chart ─────────────────────────────────────────────────

function TrendChart({ trend }: { trend: RunTrendPoint[] | undefined }) {
  const pts = useMemo(() => (trend ?? []).slice(-20), [trend]);

  const labelStyle: React.CSSProperties = {
    fontSize: 10, color: 'var(--text-dim)', fontWeight: 600,
    textTransform: 'uppercase', letterSpacing: '0.07em',
  };

  if (!trend || pts.length < 2) {
    return (
      <div style={{
        background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10,
        padding: '14px 18px', boxShadow: 'var(--shadow-card)',
        display: 'flex', flexDirection: 'column', height: '100%',
      }}>
        <div style={labelStyle}>Regression Trend</div>
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <span style={{ fontSize: 11, color: 'var(--text-dim)' }}>Not enough run data yet</span>
        </div>
      </div>
    );
  }

  const VW = 300, VH = 80;
  const rates = pts.map(p => {
    const tot = p.passed + p.failed + p.skipped;
    return tot > 0 ? p.passed / tot : 0;
  });

  const n = rates.length;
  const getX = (i: number) => (i / (n - 1)) * (VW - 20) + 10;
  const getY = (v: number) => VH - 6 - v * (VH - 14);

  const linePoints  = rates.map((v, i) => `${getX(i)},${getY(v)}`).join(' ');
  const areaPoints  = `${getX(0)},${VH} ` + rates.map((v, i) => `${getX(i)},${getY(v)}`).join(' ') + ` ${getX(n - 1)},${VH}`;

  const latestRate  = rates[n - 1] ?? 0;
  const prevRate    = rates[n - 2] ?? latestRate;
  const delta       = latestRate - prevRate;
  const arrow       = delta > 0.01 ? '↑' : delta < -0.01 ? '↓' : '→';
  const arrowColor  = delta > 0.01 ? 'var(--pass)' : delta < -0.01 ? 'var(--fail)' : 'var(--text-dim)';

  return (
    <div style={{
      background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10,
      padding: '14px 18px', boxShadow: 'var(--shadow-card)', display: 'flex', flexDirection: 'column',
    }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <div style={labelStyle}>Regression Trend</div>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 4 }}>
          <span style={{ fontSize: 16, fontWeight: 800, color: 'var(--text)', fontVariantNumeric: 'tabular-nums' }}>
            {Math.round(latestRate * 100)}%
          </span>
          <span style={{ fontSize: 13, fontWeight: 700, color: arrowColor }}>{arrow}</span>
        </div>
      </div>

      {/* SVG sparkline */}
      <svg width="100%" viewBox={`0 0 ${VW} ${VH}`} style={{ display: 'block', overflow: 'visible' }}>
        {/* Guide lines */}
        {[0, 0.5, 1].map(v => (
          <line key={v}
            x1={10} x2={VW - 10} y1={getY(v)} y2={getY(v)}
            stroke="var(--border)" strokeWidth={0.6}
            strokeDasharray={v === 0.5 ? '3,3' : undefined}
          />
        ))}
        {/* Y-axis labels */}
        <text x={2}    y={getY(1)   + 4} fontSize={7} fill="var(--text-dim)">100%</text>
        <text x={2}    y={getY(0.5) + 4} fontSize={7} fill="var(--text-dim)">50%</text>
        <text x={5}    y={getY(0)   - 2} fontSize={7} fill="var(--text-dim)">0%</text>

        {/* Area fill */}
        <polygon points={areaPoints} fill="rgba(6,182,212,0.07)" />

        {/* Fail area — region above (100-passRate) */}
        <polygon
          points={`${getX(0)},0 ` + rates.map((v, i) => `${getX(i)},${getY(v)}`).join(' ') + ` ${getX(n - 1)},0`}
          fill="rgba(220,38,38,0.04)"
        />

        {/* Pass line */}
        <polyline points={linePoints} fill="none" stroke="var(--cyan)" strokeWidth={1.8} strokeLinejoin="round" />

        {/* Dots — highlight last 3 */}
        {rates.map((v, i) => {
          const isLast = i === n - 1;
          return (
            <circle key={i}
              cx={getX(i)} cy={getY(v)} r={isLast ? 3.5 : 2}
              fill={isLast ? 'var(--cyan)' : 'var(--surface)'}
              stroke="var(--cyan)" strokeWidth={1.5}
            />
          );
        })}
      </svg>

      <div style={{ fontSize: 9.5, color: 'var(--text-dim)', marginTop: 6 }}>
        Last {pts.length} day{pts.length !== 1 ? 's' : ''} — pass rate per day
      </div>
    </div>
  );
}

// ── RunStats strip ─────────────────────────────────────────────────────────

function RunStats({ results, startedAt, completedAt }: {
  results:      Result[];
  startedAt?:   string | null;
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

  const labelStyle: React.CSSProperties = {
    fontSize: 10, color: 'var(--text-dim)', fontWeight: 600,
    textTransform: 'uppercase', letterSpacing: '0.07em',
  };

  return (
    <div style={{
      background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10,
      padding: '14px 18px', display: 'flex', gap: 24, flexWrap: 'wrap', alignItems: 'flex-start',
      boxShadow: 'var(--shadow-card)',
    }}>
      {/* time stats */}
      <div style={{ display: 'flex', gap: 22, flexShrink: 0 }}>
        <div>
          <div style={labelStyle}>Total Duration</div>
          <div style={{ fontSize: 17, fontWeight: 700, color: 'var(--text)', marginTop: 4, fontVariantNumeric: 'tabular-nums' }}>{totalDur}</div>
        </div>
        <div>
          <div style={labelStyle}>Avg per Test</div>
          <div style={{ fontSize: 17, fontWeight: 700, color: 'var(--text)', marginTop: 4, fontVariantNumeric: 'tabular-nums' }}>{avgMs != null ? fmtMs(avgMs) : '—'}</div>
        </div>
      </div>

      <div style={{ width: 1, background: 'var(--border)', alignSelf: 'stretch' }} />

      {/* top 5 slowest */}
      <div style={{ flex: 1, minWidth: 240 }}>
        <div style={{ ...labelStyle, marginBottom: 8 }}>Top 5 Slowest Tests</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {top5.length === 0 && (
            <span style={{ fontSize: 11, color: 'var(--text-dim)' }}>No timing data</span>
          )}
          {top5.map((r, i) => {
            const maxMs    = top5[0]?.duration ?? 1;
            const pct      = Math.round(((r.duration ?? 0) / maxMs) * 100);
            const barColor = r.status === 'FAILED' ? 'rgba(220,38,38,0.42)' : 'rgba(37,99,171,0.5)';
            return (
              <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 9, color: 'var(--text-dim)', width: 10, flexShrink: 0, fontVariantNumeric: 'tabular-nums' }}>{i + 1}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ height: 4, borderRadius: 2, background: 'var(--border)', overflow: 'hidden', marginBottom: 3 }}>
                    <div style={{ height: '100%', borderRadius: 2, width: `${pct}%`, background: barColor }} />
                  </div>
                  <span style={{ fontSize: 11, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'block' }}>
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9.5, color: 'var(--text-dim)', marginRight: 4 }}>{r.testCase.tcId}</span>
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
  background: 'var(--surface2)', border: '1px solid var(--border)',
  borderRadius: 6, color: 'var(--text)', fontSize: 12, padding: '5px 10px', outline: 'none',
};

const colHeadStyle: React.CSSProperties = {
  fontSize: 9.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.07em',
  color: 'var(--text-dim)', padding: '5px 10px', borderBottom: '1px solid var(--border)',
  background: 'rgba(255,255,255,0.015)',
};

export default function RunDetail() {
  const { slug, runId } = useParams<{ slug: string; runId: string }>();
  const navigate = useNavigate();
  const { data: project } = useProject(slug);
  const projectId = project?.id;
  const { activeProject } = useProjectStore();
  const { data: run, isLoading }  = useReportRun(projectId, runId ?? null);
  const { data: trend }            = useRunTrend(projectId, 30);

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
  const passed   = results.filter(r => r.status === 'PASSED').length;
  const failed   = results.filter(r => r.status === 'FAILED').length;
  const skipped  = results.filter(r => r.status === 'SKIPPED').length;
  const passRate = total > 0 ? Math.round((passed / total) * 100) : 0;

  async function handleExport() {
    if (!projectId || !runId || exporting) return;
    setExporting(true);
    try {
      const res = await api.get(`/projects/${projectId}/reports/runs/${runId}/export`, { responseType: 'blob' });
      const url = URL.createObjectURL(new Blob([res.data as BlobPart]));
      const a   = document.createElement('a');
      a.href     = url;
      a.download = `run-report-${String(run?.runSeq ?? '').padStart(4, '0')}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
    } catch { /* silent */ } finally {
      setExporting(false);
    }
  }

  return (
    /* Let <main overflowY:auto> in AppShell handle the page scroll — no overflow:hidden here */
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
      <Topbar
        breadcrumbs={[
          { label: 'All Projects', href: '/projects' },
          { label: activeProject?.name ?? slug ?? '' },
          { label: 'Reports', href: `/projects/${slug}/reports` },
          { label: `#${String(run?.runSeq ?? 0).padStart(4, '0')} ${run?.name ?? ''}` },
        ]}
        actions={
          <TbBtn variant="ghost" onClick={() => navigate(`/projects/${slug}/reports`)}
            style={{ background: 'rgba(37,99,171,0.1)', color: 'var(--cyan)', border: '1px solid rgba(37,99,171,0.25)' }}>
            ← Back
          </TbBtn>
        }
      />

      {isLoading ? (
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-dim)', fontSize: 13, padding: 60 }}>
          Loading run details…
        </div>
      ) : !run ? (
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-dim)', fontSize: 13, padding: 60 }}>
          Run not found.
        </div>
      ) : (
        <div style={{ padding: '16px 24px 32px', display: 'flex', flexDirection: 'column', gap: 14 }}>

          {/* Run title */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ width: 9, height: 9, borderRadius: '50%', background: STATUS_COLOR[run.status] ?? 'var(--text-dim)', display: 'inline-block', flexShrink: 0 }} />
            <span style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)' }}>{run.name}</span>
            <span style={{ fontSize: 11.5, color: 'var(--text-dim)', fontFamily: 'var(--font-mono)' }}>
              #{String(run.runSeq).padStart(4, '0')} · {run.environment} · {new Date(run.createdAt).toLocaleString([], { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
            </span>
          </div>

          {/* Stat tiles */}
          <div style={{ display: 'flex', gap: 10 }}>
            <StatTile label="Total"     value={total}          icon={ListChecks}   accent="var(--cyan)"          valueColor="var(--cyan)"  onClick={() => toggleStatusFilter('')} />
            <StatTile label="Passed"    value={passed}         icon={CheckCircle2} accent="var(--pass)"          valueColor="var(--pass)"  active={statusFilter === 'PASSED'}  onClick={() => toggleStatusFilter('PASSED')} />
            <StatTile label="Failed"    value={failed}         icon={XCircle}      accent="var(--fail)"          valueColor="var(--fail)"  active={statusFilter === 'FAILED'}  onClick={() => toggleStatusFilter('FAILED')} />
            <StatTile label="Skipped"   value={skipped}        icon={MinusCircle}  accent="var(--amber)"         valueColor="var(--amber)" active={statusFilter === 'SKIPPED'} onClick={() => toggleStatusFilter('SKIPPED')} />
            <StatTile label="Pass Rate" value={`${passRate}%`} icon={TrendingUp}   accent="rgba(37,99,171,0.8)"  valueColor="#F47B20" />
          </div>

          {/* RunStats + Trend chart side by side */}
          <div style={{ display: 'flex', gap: 14, alignItems: 'stretch' }}>
            <div style={{ flex: 3, minWidth: 0 }}>
              <RunStats results={results} startedAt={run.startedAt} completedAt={run.completedAt} />
            </div>
            <div style={{ flex: 2, minWidth: 220 }}>
              <TrendChart trend={trend} />
            </div>
          </div>

          {/* Search + export toolbar */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
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

          {/* Group cards */}
          {groups.length === 0 ? (
            <div style={{ textAlign: 'center', color: 'var(--text-dim)', fontSize: 12, padding: '40px 0' }}>
              No results match the current filters.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {groups.map(([groupKey, groupResults]) => {
                const isOpen = activeExpanded.has(groupKey);
                return (
                  <div
                    key={groupKey}
                    style={{
                      background: 'var(--surface)',
                      border: '1px solid var(--border)',
                      borderRadius: 10,
                      overflow: 'hidden',
                      boxShadow: 'var(--shadow-card)',
                    }}
                  >
                    <GroupHeader
                      groupKey={groupKey}
                      groupResults={groupResults}
                      isOpen={isOpen}
                      onToggle={() => toggleGroup(groupKey)}
                    />
                    {isOpen && (
                      /* Individual card scroll — max height so card doesn't grow unbounded */
                      <div style={{ maxHeight: 380, overflowY: 'auto' }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed' }}>
                          <colgroup>
                            <col style={{ width: 108 }} />
                            <col />
                            <col style={{ width: 82 }} />
                            <col style={{ width: 96 }} />
                          </colgroup>
                          <thead>
                            <tr>
                              <th style={{ ...colHeadStyle, textAlign: 'left', paddingLeft: 14 }}>TC ID</th>
                              <th style={{ ...colHeadStyle, textAlign: 'left' }}>Test Case</th>
                              <th style={{ ...colHeadStyle, textAlign: 'right' }}>Duration</th>
                              <th style={{ ...colHeadStyle, textAlign: 'center', paddingRight: 14 }}>Status</th>
                            </tr>
                          </thead>
                          <tbody>
                            {groupResults.map(r => <ResultRow key={r.id} r={r} />)}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

        </div>
      )}
    </div>
  );
}
