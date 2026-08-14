import { useQueries } from '@tanstack/react-query';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from 'recharts';
import { useNavigate } from 'react-router-dom';
import Topbar, { TbBtn } from '../components/layout/Topbar';
import { useProjects } from '../hooks/useProjects';
import { api } from '../lib/api';
import type { DashboardData } from '../types';

// ── helpers ────────────────────────────────────────────────────────────────

const RUN_STATUS_COLOR: Record<string, string> = {
  PASSED:    'var(--pass)',
  FAILED:    'var(--fail)',
  RUNNING:   'var(--cyan)',
  PENDING:   'var(--amber)',
  CANCELLED: 'var(--text-dim)',
};

const RUN_STATUS_LABEL: Record<string, string> = {
  PASSED: 'Passed', FAILED: 'Failed', RUNNING: 'Running',
  PENDING: 'Queued', CANCELLED: 'Cancelled',
};

function passRateColor(r: number) {
  if (r >= 90) return 'var(--pass)';
  if (r >= 70) return 'var(--amber)';
  return 'var(--fail)';
}

function coverageColor(c: number) {
  if (c >= 80) return 'var(--pass)';
  if (c >= 50) return 'var(--amber)';
  return 'var(--fail)';
}

// ── KPI tile ───────────────────────────────────────────────────────────────

function KpiTile({
  label, value, sub, accent, valueColor,
}: {
  label: string; value: string | number;
  sub?: string; accent: string; valueColor?: string;
}) {
  return (
    <div style={{
      background: 'var(--surface)', border: '1px solid var(--border)',
      borderRadius: 10, padding: '14px 16px 12px',
      position: 'relative', overflow: 'hidden',
      boxShadow: 'var(--shadow-card)', flex: 1,
    }}>
      <div style={{
        position: 'absolute', top: 0, left: 0, right: 0, height: 3,
        background: accent, borderRadius: '10px 10px 0 0',
      }} />
      <div style={{
        fontSize: 10, fontWeight: 600, textTransform: 'uppercase',
        letterSpacing: '0.08em', color: 'var(--text-dim)', marginBottom: 6,
      }}>
        {label}
      </div>
      <div style={{ fontSize: 28, fontWeight: 800, color: valueColor ?? '#F47B20', lineHeight: 1 }}>
        {value}
      </div>
      {sub && (
        <div style={{ fontSize: 10, color: 'var(--text-dim)', marginTop: 5 }}>{sub}</div>
      )}
    </div>
  );
}

// ── SVG sparkline ──────────────────────────────────────────────────────────

function Sparkline({ data, color, width = 70, height = 22 }: {
  data: number[]; color: string; width?: number; height?: number;
}) {
  if (data.length < 2) {
    return <span style={{ fontSize: 10, color: 'var(--text-dim)' }}>—</span>;
  }
  const min = Math.min(...data);
  const max = Math.max(...data);
  const rng = max - min || 1;
  const pts = data.map((v, i) => ({
    x: (i / (data.length - 1)) * (width - 4) + 2,
    y: height - 2 - ((v - min) / rng) * (height - 4),
  }));
  const linePath = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
  const fillPath = `${linePath} L${pts[pts.length - 1].x.toFixed(1)},${height} L${pts[0].x.toFixed(1)},${height} Z`;
  const last = pts[pts.length - 1];

  return (
    <svg width={width} height={height} style={{ display: 'block', flexShrink: 0 }}>
      <path d={fillPath} fill={color} fillOpacity={0.15} />
      <path d={linePath} fill="none" stroke={color} strokeWidth={1.5} strokeLinejoin="round" />
      <circle cx={last.x} cy={last.y} r={2.5} fill={color} />
    </svg>
  );
}

// ── Recharts tooltip ───────────────────────────────────────────────────────

function ChartTooltip({
  active, payload, label,
}: {
  active?: boolean;
  payload?: Array<{ color: string; name: string; value: number }>;
  label?: string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div style={{
      background: 'var(--surface)', border: '1px solid var(--border)',
      borderRadius: 8, padding: '8px 12px', fontSize: 12,
      boxShadow: 'var(--shadow-card)',
    }}>
      <div style={{ fontWeight: 700, color: 'var(--text)', marginBottom: 6 }}>{label}</div>
      {payload.map((p) => (
        <div key={p.name} style={{ color: p.color, marginBottom: 2 }}>
          {p.name}: {p.value}
        </div>
      ))}
    </div>
  );
}

// ── th helper ─────────────────────────────────────────────────────────────

function Th({ children, align = 'center' }: { children: React.ReactNode; align?: 'left' | 'center' | 'right' }) {
  return (
    <th style={{
      padding: '8px 16px', textAlign: align,
      fontSize: 9, fontWeight: 700, letterSpacing: '0.12em',
      textTransform: 'uppercase', color: 'var(--text-dim)',
      borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap',
    }}>
      {children}
    </th>
  );
}

// ── Main page ──────────────────────────────────────────────────────────────

export default function OverallDashboard() {
  const navigate = useNavigate();
  const { data: projects = [], isLoading: projectsLoading } = useProjects();

  // Fetch each project's dashboard data in parallel
  const dashQueries = useQueries({
    queries: projects.map((p) => ({
      queryKey: ['dashboard', p.id],
      queryFn: async () => {
        const res = await api.get<DashboardData>(`/projects/${p.id}/reports/dashboard`);
        return res.data;
      },
      enabled: !!p.id,
      refetchInterval: 60_000,
    })),
  });

  const isLoading = projectsLoading || (dashQueries.length > 0 && dashQueries.every((q) => q.isLoading));

  // Combine project + dashboard data
  const rows = projects.map((p, i) => ({
    project: p,
    stats:     dashQueries[i]?.data?.stats,
    trend:     dashQueries[i]?.data?.trend ?? [],
    recentRun: dashQueries[i]?.data?.recentRuns?.[0] ?? null,
  }));

  // ── Aggregated KPIs ──────────────────────────────────────────────────────
  const totalTCs       = rows.reduce((s, r) => s + (r.stats?.totalTests       ?? 0), 0);
  const totalScripts   = rows.reduce((s, r) => s + (r.stats?.scriptsGenerated ?? 0), 0);
  const coverage       = totalTCs > 0 ? Math.round((totalScripts / totalTCs) * 100) : 0;
  const avgPassRate    = rows.length > 0
    ? Math.round(rows.reduce((s, r) => s + (r.stats?.avgPassRate ?? 0), 0) / rows.length)
    : 0;
  const totalRuns      = rows.reduce((s, r) => s + (r.stats?.totalRuns       ?? 0), 0);
  const totalSchedules = rows.reduce((s, r) => s + (r.stats?.activeSchedules ?? 0), 0);

  // ── 30-day aggregated trend (merge all project trends by date key) ────────
  const trendMap = new Map<string, { passed: number; failed: number; skipped: number }>();
  rows.forEach((r) => {
    r.trend.forEach((tp) => {
      const key = tp.date.slice(5); // MM-DD
      if (!trendMap.has(key)) trendMap.set(key, { passed: 0, failed: 0, skipped: 0 });
      const e = trendMap.get(key)!;
      e.passed  += tp.passed;
      e.failed  += tp.failed;
      e.skipped += tp.skipped;
    });
  });
  const trendData = Array.from(trendMap.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(-30)
    .map(([date, v]) => ({ date, ...v }));

  // ── Render ───────────────────────────────────────────────────────────────
  return (
    <>
      {/* Sticky topbar — anchors to <main>'s scroll container */}
      <div style={{ position: 'sticky', top: 0, zIndex: 10, background: 'var(--bg)', borderBottom: '1px solid var(--border)' }}>
        <Topbar
          breadcrumbs={[{ label: '📊 Overall Dashboard' }]}
          actions={
            <TbBtn
              variant="ghost"
              onClick={() => window.location.reload()}
              style={{ background: 'rgba(37,99,171,0.1)', color: 'var(--cyan)', border: '1px solid rgba(37,99,171,0.25)' }}
            >
              ↺ Refresh
            </TbBtn>
          }
        />
      </div>

      <div style={{ padding: '20px 24px 40px', display: 'flex', flexDirection: 'column', gap: 20 }}>
        {isLoading ? (
          <div style={{ textAlign: 'center', color: 'var(--text-dim)', fontSize: 12, paddingTop: 60 }}>
            Loading overview…
          </div>
        ) : (
          <>
            {/* ── KPI strip ──────────────────────────────────────────── */}
            <div style={{ display: 'flex', gap: 12 }}>
              <KpiTile
                label="Projects Onboarded"
                value={projects.length}
                sub={`${rows.filter((r) => r.recentRun?.status === 'RUNNING').length} running now`}
                accent="linear-gradient(90deg, var(--cyan), #2563AB)"
              />
              <KpiTile
                label="Total Test Cases"
                value={totalTCs}
                sub={`${totalScripts} scripts generated`}
                accent="linear-gradient(90deg, var(--violet), #7c3aed)"
              />
              <KpiTile
                label="Script Coverage"
                value={`${coverage}%`}
                sub={`${totalScripts} / ${totalTCs} cases`}
                accent="linear-gradient(90deg, var(--cyan), var(--violet))"
                valueColor={coverageColor(coverage)}
              />
              <KpiTile
                label="Avg Pass Rate"
                value={`${avgPassRate}%`}
                sub="30-day rolling, all projects"
                accent="linear-gradient(90deg, var(--pass), #1a7a6e)"
                valueColor={passRateColor(avgPassRate)}
              />
              <KpiTile
                label="Total Runs"
                value={totalRuns.toLocaleString()}
                sub="All time, all projects"
                accent="linear-gradient(90deg, var(--skip), #D9601A)"
              />
              <KpiTile
                label="Active Schedules"
                value={totalSchedules}
                sub={`Across ${rows.filter((r) => (r.stats?.activeSchedules ?? 0) > 0).length} projects`}
                accent="linear-gradient(90deg, var(--amber), var(--skip))"
              />
            </div>

            {/* ── Trend + Last Runs ───────────────────────────────────── */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 360px', gap: 16, alignItems: 'start' }}>

              {/* 30-day area chart */}
              <div style={{
                background: 'var(--surface)', border: '1px solid var(--border)',
                borderRadius: 12, overflow: 'hidden', boxShadow: 'var(--shadow-card)',
              }}>
                <div style={{ height: 3, background: 'var(--cool-accent)' }} />
                <div style={{ padding: '14px 16px 16px' }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text)', marginBottom: 14 }}>
                    30-Day Execution Trend — All Projects
                  </div>
                  {trendData.length === 0 ? (
                    <div style={{ height: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-dim)', fontSize: 12 }}>
                      No run data yet. Execute some tests to see trends.
                    </div>
                  ) : (
                    <ResponsiveContainer width="100%" height={200}>
                      <AreaChart data={trendData} margin={{ top: 4, right: 4, bottom: 0, left: -20 }}>
                        <defs>
                          <linearGradient id="gPass" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%"  stopColor="var(--pass)" stopOpacity={0.28} />
                            <stop offset="95%" stopColor="var(--pass)" stopOpacity={0.02} />
                          </linearGradient>
                          <linearGradient id="gFail" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%"  stopColor="var(--fail)" stopOpacity={0.28} />
                            <stop offset="95%" stopColor="var(--fail)" stopOpacity={0.02} />
                          </linearGradient>
                          <linearGradient id="gSkip" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%"  stopColor="var(--skip)" stopOpacity={0.2} />
                            <stop offset="95%" stopColor="var(--skip)" stopOpacity={0.0} />
                          </linearGradient>
                        </defs>
                        <XAxis dataKey="date" tick={{ fontSize: 10, fill: 'var(--text-dim)' }} axisLine={false} tickLine={false} />
                        <YAxis tick={{ fontSize: 10, fill: 'var(--text-dim)' }} axisLine={false} tickLine={false} />
                        <Tooltip content={<ChartTooltip />} />
                        <Legend iconType="circle" iconSize={7} wrapperStyle={{ fontSize: 11, paddingTop: 8 }} />
                        <Area dataKey="passed"  name="Pass" stackId="a" stroke="var(--pass)" fill="url(#gPass)" strokeWidth={1.5} />
                        <Area dataKey="failed"  name="Fail" stackId="a" stroke="var(--fail)" fill="url(#gFail)" strokeWidth={1.5} />
                        <Area dataKey="skipped" name="Skip" stackId="a" stroke="var(--skip)" fill="url(#gSkip)" strokeWidth={1} />
                      </AreaChart>
                    </ResponsiveContainer>
                  )}
                </div>
              </div>

              {/* Per-project last run panel */}
              <div style={{
                background: 'var(--surface)', border: '1px solid var(--border)',
                borderRadius: 12, boxShadow: 'var(--shadow-card)',
                display: 'flex', flexDirection: 'column',
              }}>
                <div style={{ height: 3, background: 'var(--warm-accent)', borderRadius: '12px 12px 0 0', flexShrink: 0 }} />
                <div style={{ padding: '10px 14px', borderBottom: '1px solid var(--border)', fontSize: 12, fontWeight: 700, color: 'var(--text)', flexShrink: 0 }}>
                  Last Run — Per Project
                </div>
                <div style={{ overflowY: 'auto' }}>
                {rows.map(({ project: p, stats, recentRun }) => {
                  const status   = recentRun?.status ?? 'PENDING';
                  const pass     = stats?.lastRunPassCount ?? 0;
                  const fail     = stats?.lastRunFailCount ?? 0;
                  const total    = pass + fail;
                  const rate     = total > 0 ? Math.round((pass / total) * 100) : 0;
                  const statColor = RUN_STATUS_COLOR[status] ?? 'var(--text-dim)';
                  return (
                    <div
                      key={p.id}
                      onClick={() => navigate(`/projects/${p.slug}/dashboard`)}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 10,
                        padding: '9px 14px', borderBottom: '1px solid var(--border)',
                        cursor: 'pointer', transition: 'background 0.15s',
                      }}
                      onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--surface2)')}
                      onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                    >
                      <div style={{ width: 3, height: 30, borderRadius: 2, background: p.color ?? 'var(--cyan)', flexShrink: 0 }} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {p.name}
                        </div>
                        <div style={{ fontSize: 10, color: 'var(--text-dim)', marginTop: 1 }}>
                          {recentRun ? `${pass}P · ${fail}F` : 'No runs yet'}
                        </div>
                      </div>
                      {/* Mini pass bar */}
                      <div style={{ width: 48, height: 4, background: 'var(--surface2)', borderRadius: 2, overflow: 'hidden', flexShrink: 0 }}>
                        <div style={{ height: '100%', width: `${rate}%`, background: passRateColor(rate), borderRadius: 2 }} />
                      </div>
                      <span style={{
                        fontSize: 9.5, fontWeight: 700, padding: '2px 8px', borderRadius: 100,
                        background: `${statColor}20`, color: statColor, flexShrink: 0,
                      }}>
                        {recentRun ? (RUN_STATUS_LABEL[status] ?? status) : '—'}
                      </span>
                    </div>
                  );
                })}
                </div>
              </div>
            </div>

            {/* ── Project breakdown table ─────────────────────────────── */}
            <div style={{
              background: 'var(--surface)', border: '1px solid var(--border)',
              borderRadius: 12, boxShadow: 'var(--shadow-card)',
            }}>
              <div style={{ height: 3, background: 'linear-gradient(90deg, var(--cyan), var(--violet))' }} />
              <div style={{ padding: '10px 16px', borderBottom: '1px solid var(--border)', fontSize: 12, fontWeight: 700, color: 'var(--text)' }}>
                Project Breakdown
              </div>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 720 }}>
                  <thead>
                    <tr>
                      <Th align="left">Project</Th>
                      <Th>Test Cases</Th>
                      <Th>Scripts</Th>
                      <Th>Coverage</Th>
                      <Th>Last Run</Th>
                      <Th>Pass Rate (30d)</Th>
                      <Th>Schedules</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map(({ project: p, stats, recentRun, trend }) => {
                      const tcs     = stats?.totalTests      ?? 0;
                      const scripts = stats?.scriptsGenerated ?? 0;
                      const cov     = tcs > 0 ? Math.round((scripts / tcs) * 100) : 0;
                      const rate    = stats?.avgPassRate ?? 0;
                      const runStatus = recentRun?.status ?? null;
                      const pColor  = passRateColor(rate);
                      const cColor  = coverageColor(cov);

                      // Sparkline: daily pass rate from trend
                      const sparkData = trend.slice(-15).map((tp) => {
                        const t = tp.passed + tp.failed + tp.skipped;
                        return t > 0 ? Math.round((tp.passed / t) * 100) : 0;
                      });

                      return (
                        <tr
                          key={p.id}
                          onClick={() => navigate(`/projects/${p.slug}/dashboard`)}
                          style={{ cursor: 'pointer', borderBottom: '1px solid var(--border)', transition: 'background 0.12s' }}
                          onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--surface2)')}
                          onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                        >
                          {/* Project name */}
                          <td style={{ padding: '12px 16px' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
                              <div style={{ width: 3, height: 34, borderRadius: 2, background: p.color ?? 'var(--cyan)', flexShrink: 0 }} />
                              <div>
                                <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>{p.name}</div>
                                <div style={{ fontSize: 10, color: 'var(--text-dim)', marginTop: 1, fontFamily: 'var(--font-mono)' }}>{p.slug}</div>
                              </div>
                            </div>
                          </td>

                          {/* Test cases */}
                          <td style={{ padding: '12px 16px', textAlign: 'center' }}>
                            <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)', fontVariantNumeric: 'tabular-nums' }}>
                              {tcs}
                            </span>
                          </td>

                          {/* Scripts */}
                          <td style={{ padding: '12px 16px', textAlign: 'center' }}>
                            <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)', fontVariantNumeric: 'tabular-nums' }}>
                              {scripts}
                            </span>
                            {tcs > scripts && (
                              <div style={{ fontSize: 10, color: 'var(--text-dim)', marginTop: 1 }}>
                                {tcs - scripts} missing
                              </div>
                            )}
                          </td>

                          {/* Coverage */}
                          <td style={{ padding: '12px 16px', textAlign: 'center' }}>
                            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
                              <span style={{ fontSize: 13, fontWeight: 700, color: cColor, fontVariantNumeric: 'tabular-nums' }}>
                                {cov}%
                              </span>
                              <div style={{ width: 60, height: 4, background: 'var(--surface2)', borderRadius: 2, overflow: 'hidden' }}>
                                <div style={{ height: '100%', width: `${cov}%`, background: cColor, borderRadius: 2 }} />
                              </div>
                            </div>
                          </td>

                          {/* Last run */}
                          <td style={{ padding: '12px 16px', textAlign: 'center' }}>
                            {runStatus ? (
                              <span style={{
                                fontSize: 10, fontWeight: 700, padding: '3px 9px', borderRadius: 100,
                                background: `${RUN_STATUS_COLOR[runStatus] ?? 'var(--text-dim)'}20`,
                                color: RUN_STATUS_COLOR[runStatus] ?? 'var(--text-dim)',
                              }}>
                                {RUN_STATUS_LABEL[runStatus] ?? runStatus}
                              </span>
                            ) : (
                              <span style={{ fontSize: 10, color: 'var(--text-dim)' }}>No runs</span>
                            )}
                          </td>

                          {/* Pass rate + sparkline */}
                          <td style={{ padding: '12px 16px', textAlign: 'center' }}>
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
                              <Sparkline data={sparkData} color={pColor} />
                              <span style={{ fontSize: 13, fontWeight: 700, color: pColor, fontVariantNumeric: 'tabular-nums', minWidth: 36, textAlign: 'right' }}>
                                {rate}%
                              </span>
                            </div>
                          </td>

                          {/* Active schedules */}
                          <td style={{ padding: '12px 16px', textAlign: 'center' }}>
                            <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)', fontVariantNumeric: 'tabular-nums' }}>
                              {stats?.activeSchedules ?? 0}
                            </span>
                          </td>
                        </tr>
                      );
                    })}

                    {rows.length === 0 && (
                      <tr>
                        <td colSpan={7} style={{ padding: '40px 0', textAlign: 'center', color: 'var(--text-dim)', fontSize: 12 }}>
                          No projects found. Create a project to get started.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}
      </div>
    </>
  );
}
