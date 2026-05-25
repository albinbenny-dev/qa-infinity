import { useParams } from 'react-router-dom';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from 'recharts';
import Topbar, { TbBtn } from '../components/layout/Topbar';
import { useDashboard } from '../hooks/useReports';
import type { AgentStatus } from '../types';

// ── Stat tile ──────────────────────────────────────────────────────────────

function StatTile({
  label,
  value,
  suffix = '',
  accent,
}: {
  label: string;
  value: number | string;
  suffix?: string;
  accent: string;
}) {
  return (
    <div
      style={{
        background: 'var(--surface)',
        border: '1px solid var(--border)',
        borderRadius: 10,
        padding: '14px 16px',
        display: 'flex',
        flexDirection: 'column',
        gap: 3,
        position: 'relative',
        overflow: 'hidden',
        boxShadow: 'var(--shadow-card)',
        flex: 1,
      }}
    >
      <div
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          height: 3,
          background: accent,
          borderRadius: '10px 10px 0 0',
        }}
      />
      <div
        style={{
          fontSize: 28,
          fontWeight: 800,
          color: '#F47B20',
          lineHeight: 1,
          marginTop: 4,
        }}
      >
        {value}
        {suffix}
      </div>
      <div
        style={{
          fontSize: 10,
          color: 'var(--text-dim)',
          fontWeight: 600,
          textTransform: 'uppercase',
          letterSpacing: '0.07em',
          marginTop: 3,
        }}
      >
        {label}
      </div>
    </div>
  );
}

// ── Agent status card ──────────────────────────────────────────────────────

const AGENT_ICON: Record<string, string> = {
  writer: '✍️',
  scripts: '📝',
  execution: '▶️',
  healing: '🔧',
  reports: '📊',
};

function AgentStatusCard({ statuses }: { statuses: AgentStatus[] }) {
  return (
    <div
      style={{
        background: 'var(--surface)',
        border: '1px solid var(--border)',
        borderRadius: 12,
        overflow: 'hidden',
        boxShadow: 'var(--shadow-card)',
      }}
    >
      <div
        style={{
          height: 3,
          background: 'var(--cool-accent)',
          borderRadius: '12px 12px 0 0',
        }}
      />
      <div style={{ padding: '14px 16px 6px' }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text)', marginBottom: 12 }}>
          Agent Status
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {statuses.map((a) => (
            <div
              key={a.name}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '6px 8px',
                background: 'var(--surface2)',
                borderRadius: 7,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span
                  style={{
                    display: 'inline-block',
                    width: 8,
                    height: 8,
                    borderRadius: '50%',
                    flexShrink: 0,
                    background:
                      a.status === 'ok'
                        ? 'var(--pass)'
                        : a.status === 'busy'
                        ? 'var(--amber)'
                        : 'var(--text-dim)',
                    boxShadow:
                      a.status === 'ok'
                        ? '0 0 6px var(--pass)'
                        : a.status === 'busy'
                        ? '0 0 6px var(--amber)'
                        : 'none',
                  }}
                />
                <span style={{ fontSize: 12, color: 'var(--text)' }}>
                  {AGENT_ICON[a.name]} {a.label}
                </span>
              </div>
              <span
                style={{
                  fontSize: 10,
                  fontWeight: 600,
                  color:
                    a.status === 'ok'
                      ? 'var(--pass)'
                      : a.status === 'busy'
                      ? 'var(--amber)'
                      : 'var(--text-dim)',
                  background:
                    a.status === 'ok'
                      ? 'rgba(42,157,143,0.12)'
                      : a.status === 'busy'
                      ? 'rgba(251,191,36,0.12)'
                      : 'var(--surface)',
                  padding: '2px 8px',
                  borderRadius: 100,
                }}
              >
                {a.status === 'ok' ? 'Ready' : a.status === 'busy' ? 'Busy' : 'Idle'}
              </span>
            </div>
          ))}
        </div>
      </div>
      {/* Detail strip */}
      <div style={{ padding: '8px 16px 12px' }}>
        {statuses
          .filter((a) => a.status === 'busy')
          .map((a) => (
            <div key={a.name} style={{ fontSize: 11, color: 'var(--amber)', marginTop: 4 }}>
              ⚡ {a.label}: {a.detail}
            </div>
          ))}
      </div>
    </div>
  );
}

// ── Recent run row ─────────────────────────────────────────────────────────

const RUN_STATUS_BG: Record<string, string> = {
  PASSED: 'var(--pass)',
  FAILED: 'var(--fail)',
  RUNNING: 'var(--cyan)',
  PENDING: 'var(--amber)',
  CANCELLED: 'var(--text-dim)',
};

function RecentRunCard({
  run,
}: {
  run: {
    id: string;
    name: string;
    environment: string;
    status: string;
    triggerType: string;
    createdAt: string;
    startedAt?: string | null;
    completedAt?: string | null;
    results: Array<{ status: string }>;
    _count: { results: number };
  };
}) {
  const passed = run.results.filter((r) => r.status === 'PASSED').length;
  const total = run._count.results;
  const passRate = total > 0 ? Math.round((passed / total) * 100) : 0;
  const duration =
    run.startedAt && run.completedAt
      ? Math.round(
          (new Date(run.completedAt).getTime() - new Date(run.startedAt).getTime()) / 1000,
        )
      : null;

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: '10px 14px',
        borderBottom: '1px solid var(--border)',
      }}
    >
      {/* Status chip */}
      <div
        style={{
          width: 32,
          height: 32,
          borderRadius: 8,
          background: `${RUN_STATUS_BG[run.status] ?? 'var(--text-dim)'}22`,
          border: `1px solid ${RUN_STATUS_BG[run.status] ?? 'var(--text-dim)'}44`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 14,
          flexShrink: 0,
        }}
      >
        {run.status === 'PASSED' ? '✓' : run.status === 'FAILED' ? '✗' : '↻'}
      </div>

      {/* Name + meta */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontSize: 13,
            fontWeight: 600,
            color: 'var(--text)',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          {run.name}
        </div>
        <div
          style={{
            fontSize: 11,
            color: 'var(--text-dim)',
            fontFamily: 'var(--font-mono)',
            marginTop: 2,
          }}
        >
          {new Date(run.createdAt).toLocaleString([], {
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
          })}
          {' · '}
          {total} tests
          {duration ? ` · ${duration}s` : ''}
        </div>
        {/* Progress bar */}
        <div
          style={{
            marginTop: 5,
            height: 4,
            background: 'var(--surface2)',
            borderRadius: 2,
            overflow: 'hidden',
          }}
        >
          <div
            style={{
              height: '100%',
              width: `${passRate}%`,
              background: 'linear-gradient(90deg, var(--pass), var(--cyan))',
              borderRadius: 2,
              transition: 'width 0.3s ease',
            }}
          />
        </div>
      </div>

      {/* Pass rate badge */}
      <span
        style={{
          fontSize: 11,
          fontWeight: 700,
          padding: '3px 9px',
          borderRadius: 100,
          background:
            passRate >= 90
              ? 'rgba(42,157,143,0.15)'
              : passRate >= 70
              ? 'rgba(251,191,36,0.15)'
              : 'rgba(220,38,38,0.15)',
          color:
            passRate >= 90
              ? 'var(--pass)'
              : passRate >= 70
              ? 'var(--amber)'
              : 'var(--fail)',
          flexShrink: 0,
        }}
      >
        {passRate}%
      </span>
    </div>
  );
}

// ── Recharts tooltip ───────────────────────────────────────────────────────

function CustomTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: Array<{ color: string; name: string; value: number }>;
  label?: string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div
      style={{
        background: 'var(--surface)',
        border: '1px solid var(--border)',
        borderRadius: 8,
        padding: '8px 12px',
        fontSize: 12,
        boxShadow: 'var(--shadow-card)',
      }}
    >
      <div style={{ fontWeight: 700, color: 'var(--text)', marginBottom: 6 }}>{label}</div>
      {payload.map((p) => (
        <div key={p.name} style={{ color: p.color, marginBottom: 2 }}>
          {p.name}: {p.value}
        </div>
      ))}
    </div>
  );
}

// ── Main Dashboard ─────────────────────────────────────────────────────────

export default function Dashboard() {
  const { slug } = useParams<{ slug: string }>();
  const projectId = slug!;

  const { data, isLoading } = useDashboard(projectId);

  const stats = data?.stats;
  const trend = (data?.trend ?? []).map((p) => ({
    ...p,
    date: p.date.slice(5), // MM-DD
  }));
  const recentRuns = data?.recentRuns ?? [];
  const agentStatuses = data?.agentStatuses ?? [];

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <Topbar
        breadcrumbs={[
          { label: 'All Projects', href: '/projects' },
          { label: 'Airtel Ventas' },
          { label: '📊 Dashboard' },
        ]}
        actions={
          <div style={{ display: 'flex', gap: 8 }}>
            <TbBtn
              variant="ghost"
              onClick={() => window.location.reload()}
              style={{ background: 'rgba(37,99,171,0.1)', color: 'var(--cyan)', border: '1px solid rgba(37,99,171,0.25)' }}
            >
              ↺ Refresh
            </TbBtn>
          </div>
        }
      />

      <div
        style={{
          flex: 1,
          overflow: 'auto',
          padding: '20px 24px',
          display: 'flex',
          flexDirection: 'column',
          gap: 20,
        }}
      >
        {isLoading ? (
          <div style={{ textAlign: 'center', color: 'var(--text-dim)', fontSize: 12, paddingTop: 60 }}>
            Loading dashboard…
          </div>
        ) : (
          <>
            {/* ── 5-up stat tiles ───────────────────────────────────────── */}
            <div style={{ display: 'flex', gap: 12 }}>
              <StatTile
                label="Total Tests"
                value={stats?.totalTests ?? 0}
                accent="linear-gradient(90deg, var(--cyan), #2563AB)"
              />
              <StatTile
                label="Last Run Pass"
                value={stats?.lastRunPassCount ?? 0}
                accent="linear-gradient(90deg, var(--pass), #1a7a6e)"
              />
              <StatTile
                label="Last Run Failures"
                value={stats?.lastRunFailCount ?? 0}
                accent="linear-gradient(90deg, var(--fail), #b91c1c)"
              />
              <StatTile
                label="Scheduled Runs"
                value={stats?.activeSchedules ?? 0}
                accent="linear-gradient(90deg, var(--skip), #D9601A)"
              />
              <StatTile
                label="Scripts Generated"
                value={stats?.scriptsGenerated ?? 0}
                accent="linear-gradient(90deg, var(--violet), #7c3aed)"
              />
            </div>

            {/* ── 3-column dash grid ────────────────────────────────────── */}
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: '1fr 1fr 300px',
                gap: 16,
                alignItems: 'start',
              }}
            >
              {/* Col 1 — 7-day trend chart */}
              <div
                style={{
                  background: 'var(--surface)',
                  border: '1px solid var(--border)',
                  borderRadius: 12,
                  overflow: 'hidden',
                  boxShadow: 'var(--shadow-card)',
                }}
              >
                <div style={{ height: 3, background: 'var(--cool-accent)' }} />
                <div style={{ padding: '14px 16px 16px' }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text)', marginBottom: 14 }}>
                    7-Day Pass / Fail Trend
                  </div>
                  {trend.length === 0 ? (
                    <div
                      style={{
                        height: 180,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        color: 'var(--text-dim)',
                        fontSize: 12,
                      }}
                    >
                      No run data yet.
                    </div>
                  ) : (
                    <ResponsiveContainer width="100%" height={180}>
                      <BarChart data={trend} margin={{ top: 0, right: 0, bottom: 0, left: -20 }}>
                        <XAxis
                          dataKey="date"
                          tick={{ fontSize: 10, fill: 'var(--text-dim)' }}
                          axisLine={false}
                          tickLine={false}
                        />
                        <YAxis
                          tick={{ fontSize: 10, fill: 'var(--text-dim)' }}
                          axisLine={false}
                          tickLine={false}
                        />
                        <Tooltip content={<CustomTooltip />} />
                        <Legend
                          iconType="circle"
                          iconSize={7}
                          wrapperStyle={{ fontSize: 11, paddingTop: 8 }}
                        />
                        <Bar dataKey="passed" name="Pass" stackId="a" fill="var(--pass)" radius={[0, 0, 0, 0]} />
                        <Bar dataKey="failed" name="Fail" stackId="a" fill="var(--fail)" radius={[0, 0, 0, 0]} />
                        <Bar dataKey="skipped" name="Skip" stackId="a" fill="var(--skip)" radius={[2, 2, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  )}
                </div>
              </div>

              {/* Col 2 — Recent Runs */}
              <div
                style={{
                  background: 'var(--surface)',
                  border: '1px solid var(--border)',
                  borderRadius: 12,
                  overflow: 'hidden',
                  boxShadow: 'var(--shadow-card)',
                }}
              >
                <div style={{ height: 3, background: 'var(--warm-accent)' }} />
                <div
                  style={{
                    padding: '12px 14px',
                    borderBottom: '1px solid var(--border)',
                    fontSize: 12,
                    fontWeight: 700,
                    color: 'var(--text)',
                  }}
                >
                  Recent Runs
                </div>
                {recentRuns.length === 0 ? (
                  <div
                    style={{
                      padding: '30px 0',
                      textAlign: 'center',
                      color: 'var(--text-dim)',
                      fontSize: 12,
                    }}
                  >
                    No runs yet. Head to Execution to start.
                  </div>
                ) : (
                  recentRuns.map((run) => <RecentRunCard key={run.id} run={run} />)
                )}
              </div>

              {/* Col 3 — Agent Status (300px) */}
              <AgentStatusCard statuses={agentStatuses} />
            </div>

            {/* ── Flaky tests (if any) ──────────────────────────────────── */}
            {(stats?.flakyTests?.length ?? 0) > 0 && (
              <div
                style={{
                  background: 'var(--surface)',
                  border: '1px solid var(--border)',
                  borderRadius: 12,
                  overflow: 'hidden',
                  boxShadow: 'var(--shadow-card)',
                }}
              >
                <div
                  style={{
                    height: 3,
                    background: 'linear-gradient(90deg, var(--amber), var(--skip))',
                  }}
                />
                <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)' }}>
                  <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text)' }}>
                    ⚠️ Flaky Tests
                  </span>
                  <span
                    style={{
                      marginLeft: 8,
                      fontSize: 10,
                      fontWeight: 700,
                      color: 'var(--amber)',
                      background: 'rgba(251,191,36,0.12)',
                      padding: '1px 7px',
                      borderRadius: 100,
                    }}
                  >
                    {stats!.flakyTests.length}
                  </span>
                </div>
                <div style={{ padding: '4px 0 8px' }}>
                  {stats!.flakyTests.slice(0, 5).map((t) => (
                    <div
                      key={t.id}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 10,
                        padding: '6px 16px',
                        borderBottom: '1px solid var(--border)',
                      }}
                    >
                      <span
                        style={{
                          fontFamily: 'var(--font-mono)',
                          fontSize: 10,
                          color: 'var(--text-dim)',
                          flexShrink: 0,
                        }}
                      >
                        {t.tcId}
                      </span>
                      <span
                        style={{
                          fontSize: 12,
                          color: 'var(--text)',
                          flex: 1,
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {t.title}
                      </span>
                      <span style={{ fontSize: 11, color: 'var(--pass)', flexShrink: 0 }}>
                        ✓ {t.passCount}
                      </span>
                      <span style={{ fontSize: 11, color: 'var(--fail)', flexShrink: 0 }}>
                        ✗ {t.failCount}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
