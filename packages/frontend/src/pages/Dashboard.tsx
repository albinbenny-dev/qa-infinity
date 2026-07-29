import { useParams, useNavigate } from 'react-router-dom';
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
import { useDashboard, useReportRuns } from '../hooks/useReports';
import { useProject } from '../hooks/useProjects';
import { useProjectStore } from '../stores/projectStore';
import RunHistoryTable from '../components/reports/RunHistoryTable';

// ── Helpers ────────────────────────────────────────────────────────────────

function fmtK(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

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

// ── Status dot (used by Flaky Tests) ──────────────────────────────────────

const STATUS_DOT: Record<string, string> = {
  PASSED: 'var(--pass)',
  FAILED: 'var(--fail)',
  CANCELLED: 'var(--text-dim)',
  RUNNING: 'var(--cyan)',
  PENDING: 'var(--amber)',
};

// ── Suite & Scheduler Run History Card ──────────────────────────────────────

function SuiteSchedulerHistoryCard({
  projectId,
  onViewAll,
}: {
  projectId: string | undefined;
  onViewAll: () => void;
}) {
  const { data, isLoading } = useReportRuns(projectId, 1, {
    triggerTypes: ['SUITE', 'SCHEDULED'],
    limit: 8,
  });
  const runs = data?.runs ?? [];

  return (
    <div
      style={{
        background: 'var(--surface)',
        border: '1px solid var(--border)',
        borderRadius: 12,
        boxShadow: 'var(--shadow-card)',
      }}
    >
      <div style={{ height: 3, background: 'linear-gradient(90deg, var(--cyan), var(--violet))', borderRadius: '12px 12px 0 0' }} />
      <div
        style={{
          padding: '12px 16px',
          borderBottom: '1px solid var(--border)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text)' }}>
          🗂️ Suite &amp; Scheduler Run History
        </span>
        <button
          onClick={onViewAll}
          style={{
            background: 'transparent',
            border: 'none',
            color: 'var(--cyan)',
            fontSize: 11,
            fontWeight: 700,
            cursor: 'pointer',
          }}
        >
          View All →
        </button>
      </div>
      {isLoading ? (
        <div style={{ padding: '28px 0', textAlign: 'center', color: 'var(--text-dim)', fontSize: 12 }}>
          Loading…
        </div>
      ) : runs.length === 0 ? (
        <div style={{ padding: '28px 16px', textAlign: 'center', color: 'var(--text-dim)', fontSize: 12, lineHeight: 1.7 }}>
          No suite or scheduled runs yet.<br />
          <span style={{ color: 'var(--text-mid)' }}>Run a suite or a schedule to see its history here.</span>
        </div>
      ) : (
        <div style={{ padding: '10px 12px' }}>
          <RunHistoryTable projectId={projectId} runs={runs} />
        </div>
      )}
    </div>
  );
}

// ── Main Dashboard ─────────────────────────────────────────────────────────

export default function Dashboard() {
  const { slug } = useParams<{ slug: string }>();
  const navigate = useNavigate();
  const { data: project } = useProject(slug);
  const projectId = project?.id;

  const { data, isLoading } = useDashboard(projectId);
  const { activeProject } = useProjectStore();

  const stats = data?.stats;
  const trend = (data?.trend ?? []).map((p) => ({
    ...p,
    date: p.date.slice(5), // MM-DD
  }));
  const recentRuns = data?.recentRuns ?? [];
  const projectTokens = data?.projectTokens ?? 0;

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <Topbar
        breadcrumbs={[
          { label: 'All Projects', href: '/projects' },
          { label: activeProject?.name ?? slug ?? '' },
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
              <StatTile
                label="AI Tokens Used"
                value={fmtK(projectTokens)}
                accent="linear-gradient(90deg, #F47B20, var(--amber))"
              />
            </div>

            {/* ── 2-column dash grid ────────────────────────────────────── */}
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: '1fr 1fr',
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

            </div>

            {/* ── Suite & Scheduler run history ─────────────────────────── */}
            <SuiteSchedulerHistoryCard
              projectId={projectId}
              onViewAll={() => navigate(`/projects/${slug}/reports`)}
            />

            {/* ── Flaky tests (if any) ──────────────────────────────────── */}
            {(stats?.flakyTests?.length ?? 0) > 0 && (
              <div
                style={{
                  background: 'var(--surface)',
                  border: '1px solid var(--border)',
                  borderRadius: 12,
                  boxShadow: 'var(--shadow-card)',
                }}
              >
                <div
                  style={{
                    height: 3,
                    background: 'linear-gradient(90deg, var(--amber), var(--skip))',
                    borderRadius: '12px 12px 0 0',
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
                  <span style={{ marginLeft: 8, fontSize: 10, color: 'var(--text-dim)' }}>
                    Click a row to view run history
                  </span>
                </div>
                <div style={{ padding: '4px 0 8px' }}>
                  {stats!.flakyTests.slice(0, 5).map((t) => {
                    const total = t.passCount + t.failCount;
                    const flakiness = total > 0 ? Math.round((t.failCount / total) * 100) : 0;
                    return (
                      <div
                        key={t.id}
                        onClick={() => navigate(`/projects/${slug}/reports`)}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 10,
                          padding: '8px 16px',
                          borderBottom: '1px solid var(--border)',
                          cursor: 'pointer',
                          transition: 'background 0.15s',
                        }}
                        onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--surface2)')}
                        onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                      >
                        {/* TC ID */}
                        <span
                          style={{
                            fontFamily: 'var(--font-mono)',
                            fontSize: 10,
                            color: 'var(--text-dim)',
                            flexShrink: 0,
                            minWidth: 56,
                          }}
                        >
                          {t.tcId}
                        </span>
                        {/* Title */}
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
                        {/* Last 10 run dots */}
                        <div style={{ display: 'flex', gap: 3, alignItems: 'center', flexShrink: 0 }}>
                          {t.recentResults.slice(0, 10).map((r, i) => (
                            <span
                              key={i}
                              title={r}
                              style={{
                                display: 'inline-block',
                                width: 9,
                                height: 9,
                                borderRadius: '50%',
                                background: STATUS_DOT[r] ?? 'var(--text-dim)',
                                flexShrink: 0,
                              }}
                            />
                          ))}
                          {Array.from({ length: Math.max(0, 10 - t.recentResults.length) }).map((_, i) => (
                            <span
                              key={`pad-${i}`}
                              style={{
                                display: 'inline-block',
                                width: 9,
                                height: 9,
                                borderRadius: '50%',
                                background: 'var(--border)',
                                flexShrink: 0,
                              }}
                            />
                          ))}
                        </div>
                        {/* Pass / fail counts */}
                        <span style={{ fontSize: 11, color: 'var(--pass)', flexShrink: 0 }}>
                          ✓ {t.passCount}
                        </span>
                        <span style={{ fontSize: 11, color: 'var(--fail)', flexShrink: 0 }}>
                          ✗ {t.failCount}
                        </span>
                        {/* Flakiness badge */}
                        <span
                          style={{
                            fontSize: 10,
                            fontWeight: 700,
                            padding: '2px 7px',
                            borderRadius: 100,
                            flexShrink: 0,
                            background:
                              flakiness >= 50
                                ? 'rgba(220,38,38,0.12)'
                                : flakiness >= 25
                                ? 'rgba(251,191,36,0.12)'
                                : 'rgba(244,123,32,0.12)',
                            color:
                              flakiness >= 50
                                ? 'var(--fail)'
                                : flakiness >= 25
                                ? 'var(--amber)'
                                : 'var(--skip)',
                          }}
                        >
                          {flakiness}%
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
