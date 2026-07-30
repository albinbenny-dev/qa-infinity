import { useNavigate } from 'react-router-dom';
import Topbar from '../components/layout/Topbar';
import { useProjectStore } from '../stores/projectStore';
import { useAdminRunsOverview, type AdminProjectRuns, type AdminRunSummary } from '../hooks/useAdminRuns';
import { formatRelativeTime } from '../lib/utils';

const STATUS_COLOR: Record<string, string> = {
  PASSED: 'var(--pass)',
  FAILED: 'var(--fail)',
  RUNNING: 'var(--cyan)',
  PENDING: 'var(--amber)',
  CANCELLED: 'var(--text-dim)',
  SKIPPED: 'var(--amber)',
};

const TRIGGER_LABEL: Record<string, string> = {
  MANUAL: 'Manual',
  SCHEDULED: 'Scheduled',
  INDIVIDUAL: 'Individual',
  GROUP: 'Group',
  HEAL_RERUN: 'Heal re-run',
};

function ActiveBanner({ run }: { run: NonNullable<AdminProjectRuns['activeRun']> }) {
  return (
    <div
      style={{
        display: 'flex', alignItems: 'center', gap: 8,
        padding: '8px 14px',
        background: run.status === 'RUNNING' ? 'rgba(37,99,171,0.08)' : 'rgba(251,191,36,0.08)',
        borderBottom: '1px solid var(--border)',
      }}
    >
      <span style={{
        width: 8, height: 8, borderRadius: '50%', flexShrink: 0,
        background: STATUS_COLOR[run.status] ?? 'var(--text-dim)',
        animation: 'runmon-pulse 1.3s ease-in-out infinite',
      }} />
      <span style={{ fontSize: 11, fontWeight: 700, color: STATUS_COLOR[run.status] ?? 'var(--text)' }}>
        {run.status === 'RUNNING' ? 'RUNNING' : 'QUEUED'}
      </span>
      <span style={{ fontSize: 12, color: 'var(--text)', fontWeight: 600, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        #{String(run.runSeq).padStart(4, '0')} — {run.name}
      </span>
      <span style={{ fontSize: 10, color: 'var(--text-dim)', fontFamily: 'var(--font-mono)', flexShrink: 0 }}>
        {run.environment} · {TRIGGER_LABEL[run.triggerType] ?? run.triggerType} · {formatRelativeTime(run.startedAt ?? run.createdAt)}
      </span>
    </div>
  );
}

function RecentRunRow({ run }: { run: AdminRunSummary }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 14px' }}>
      <span style={{ width: 7, height: 7, borderRadius: '50%', flexShrink: 0, background: STATUS_COLOR[run.status] ?? 'var(--text-dim)' }} />
      <span style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--text-dim)', flexShrink: 0 }}>
        #{String(run.runSeq).padStart(4, '0')}
      </span>
      <span style={{ fontSize: 12, color: 'var(--text)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {run.name}
      </span>
      {run.status !== 'RUNNING' && run.status !== 'PENDING' && (
        <>
          <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--pass)', flexShrink: 0 }}>✓ {run.passed}</span>
          <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--fail)', flexShrink: 0 }}>✗ {run.failed}</span>
        </>
      )}
      <span style={{ fontSize: 10, color: 'var(--text-dim)', fontFamily: 'var(--font-mono)', flexShrink: 0, minWidth: 56, textAlign: 'right' }}>
        {formatRelativeTime(run.createdAt)}
      </span>
    </div>
  );
}

function ProjectRunCard({ project }: { project: AdminProjectRuns }) {
  const navigate = useNavigate();
  return (
    <div
      className="card"
      style={{ cursor: 'pointer' }}
      onClick={() => navigate(`/projects/${project.slug}/reports`)}
      title="Open Reports for this project"
    >
      <div className="card-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
          <span style={{ width: 9, height: 9, borderRadius: 3, background: project.color, flexShrink: 0 }} />
          <span className="card-title" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{project.name}</span>
        </div>
        <span style={{ fontSize: 10, color: 'var(--text-dim)', fontFamily: 'var(--font-mono)', flexShrink: 0 }}>
          {project.totalRuns} run{project.totalRuns !== 1 ? 's' : ''}
        </span>
      </div>

      {project.activeRun ? (
        <ActiveBanner run={project.activeRun} />
      ) : (
        <div style={{ padding: '8px 14px', fontSize: 11, color: 'var(--text-dim)', borderBottom: '1px solid var(--border)' }}>
          No active execution
        </div>
      )}

      {project.recentRuns.length === 0 ? (
        <div style={{ padding: '18px 0', textAlign: 'center', color: 'var(--text-dim)', fontSize: 11 }}>
          No runs yet.
        </div>
      ) : (
        <div style={{ padding: '4px 0' }}>
          {project.recentRuns.map((r) => <RecentRunRow key={r.id} run={r} />)}
        </div>
      )}
    </div>
  );
}

export default function RunMonitor() {
  const { currentUser } = useProjectStore();
  const isSuperAdmin = currentUser?.globalRole === 'SUPER_ADMIN';
  const { data, isLoading } = useAdminRunsOverview(isSuperAdmin);

  // SUPER_ADMIN guard — shouldn't reach here without it, but belt-and-suspenders
  if (!isSuperAdmin) {
    return (
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: '12px', padding: '40px' }}>
        <div style={{ fontSize: '48px' }}>🔒</div>
        <h1 style={{ fontSize: '18px', fontWeight: 700, color: 'var(--text)' }}>Access Denied</h1>
        <p style={{ fontSize: '12px', color: 'var(--text-dim)', fontFamily: 'var(--font-mono)' }}>Super Admin role required.</p>
      </div>
    );
  }

  const projects = data?.projects ?? [];

  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      <Topbar
        breadcrumbs={[
          { label: 'Admin' },
          { label: '📡 Run Monitor' },
        ]}
      />

      <div style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: '20px' }}>
        {/* Page header */}
        <div>
          <div className="page-eyebrow">Administration</div>
          <h1 className="page-title">Run Monitor</h1>
          <p className="page-sub">Live view of test executions across every project on the platform.</p>
        </div>

        {/* Stats row */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: '12px' }}>
          {[
            { label: 'Total Projects', value: data?.totalProjects ?? 0, color: 'var(--cyan)' },
            { label: 'Active Executions', value: data?.activeCount ?? 0, color: (data?.activeCount ?? 0) > 0 ? 'var(--cyan)' : 'var(--text-dim)' },
            { label: 'Total Runs', value: projects.reduce((sum, p) => sum + p.totalRuns, 0), color: 'var(--violet)' },
          ].map((s) => (
            <div key={s.label} className="stat-card" style={{ padding: '14px' }}>
              <div className="stat-label">{s.label}</div>
              <div className="stat-value" style={{ fontSize: '24px', color: s.color }}>{s.value}</div>
            </div>
          ))}
        </div>

        {/* Project cards */}
        {isLoading ? (
          <div style={{ textAlign: 'center', color: 'var(--text-dim)', fontSize: 12, padding: '40px 0' }}>
            Loading executions…
          </div>
        ) : projects.length === 0 ? (
          <div style={{ textAlign: 'center', color: 'var(--text-dim)', fontSize: 12, padding: '40px 0' }}>
            No projects found.
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(380px, 1fr))', gap: '16px' }}>
            {projects.map((p) => <ProjectRunCard key={p.id} project={p} />)}
          </div>
        )}
      </div>

      <style>{`
        @keyframes runmon-pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.3; }
        }
      `}</style>
    </div>
  );
}
