import { useNavigate, useParams } from 'react-router-dom';

// ── Types ──────────────────────────────────────────────────────────────────

interface RunStartedPayload {
  runId: string;
  runName: string;
  environment: string;
  testCount: number;
  useCaseTag?: string | null;
}

interface RunSummaryPayload {
  runId: string;
  runName: string;
  status: string;
  environment: string;
  total: number;
  passed: number;
  failed: number;
  passRate: number;
  completedAt?: string | null;
}

interface FailedTestsPayload {
  runId: string;
  runName: string;
  failures: Array<{ tcId: string; title: string; error: string }>;
}

interface PendingHealsPayload {
  count: number;
  heals: Array<{ healId: string; tcId: string; title: string; type: string; confidence: number }>;
}

interface ScheduledPayload {
  scheduleId: string;
  name: string;
  cronExpression: string;
  environment: string;
  testCount: number;
}

interface TcQueuedPayload {
  source: string;
  redirectTo: string;
}

interface ProjectStatsPayload {
  totalTests: number;
  scriptsGenerated: number;
  pendingHeals: number;
  activeSchedules: number;
  lastRun?: {
    id: string;
    name: string;
    status: string;
    passed: number;
    failed: number;
    total: number;
    passRate: number;
  } | null;
}

type ActionPayload =
  | RunStartedPayload
  | RunSummaryPayload
  | FailedTestsPayload
  | PendingHealsPayload
  | ScheduledPayload
  | TcQueuedPayload
  | ProjectStatsPayload
  | Record<string, unknown>;

interface ActionCardProps {
  actionType: string;
  actionPayload?: ActionPayload;
}

// ── Helpers ────────────────────────────────────────────────────────────────

function StatusDot({ status }: { status: string }) {
  const color = status === 'PASSED' ? 'var(--pass)' : status === 'FAILED' ? 'var(--fail)' : status === 'RUNNING' ? 'var(--cyan)' : 'var(--text-dim)';
  return (
    <span style={{
      display: 'inline-block', width: 7, height: 7, borderRadius: '50%',
      background: color, marginRight: 5, flexShrink: 0,
    }} />
  );
}

function Row({ label, value, accent }: { label: string; value: React.ReactNode; accent?: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
      <span style={{ color: 'var(--text-dim)' }}>{label}</span>
      <span style={{ color: accent ?? 'var(--text-mid)', fontWeight: 600 }}>{value}</span>
    </div>
  );
}

// ── Card shell ─────────────────────────────────────────────────────────────

function CardShell({ title, icon, children, onNavigate }: {
  title: string;
  icon: string;
  children: React.ReactNode;
  onNavigate?: () => void;
}) {
  return (
    <div style={{
      marginTop: 8,
      background: 'var(--surface3, #1a2640)',
      border: '1px solid var(--border2, var(--border))',
      borderLeft: '3px solid var(--cyan)',
      borderRadius: 8,
      padding: '10px 14px',
      fontFamily: 'var(--font-mono)',
      fontSize: 11,
      color: 'var(--text-mid)',
      lineHeight: 1.7,
      display: 'flex',
      flexDirection: 'column',
      gap: 6,
    }}>
      <div style={{
        color: 'var(--cyan)', fontWeight: 700, marginBottom: 2,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      }}>
        <span>{icon} {title}</span>
        {onNavigate && (
          <button
            onClick={onNavigate}
            style={{
              background: 'none', border: 'none', color: 'var(--cyan)',
              cursor: 'pointer', fontSize: 10, padding: 0, fontFamily: 'inherit',
            }}
          >
            → View
          </button>
        )}
      </div>
      {children}
    </div>
  );
}

// ── Card variants ──────────────────────────────────────────────────────────

function RunStartedCard({ payload, slug }: { payload: RunStartedPayload; slug: string }) {
  const navigate = useNavigate();
  return (
    <CardShell
      title="Execution Started"
      icon="▶"
      onNavigate={() => navigate(`/projects/${slug}/execution`)}
    >
      <Row label="Run" value={payload.runName} />
      <Row label="Environment" value={payload.environment} />
      <Row label="Tests" value={payload.testCount} />
      {payload.useCaseTag && <Row label="Suite" value={payload.useCaseTag} />}
      <div style={{ color: 'var(--text-dim)', fontSize: 10, marginTop: 2 }}>
        Tests are queued — check the Execution screen for live progress.
      </div>
    </CardShell>
  );
}

function RunSummaryCard({ payload, slug }: { payload: RunSummaryPayload; slug: string }) {
  const navigate = useNavigate();
  return (
    <CardShell
      title="Run Summary"
      icon="📊"
      onNavigate={() => navigate(`/projects/${slug}/reports`)}
    >
      <Row label="Run" value={<><StatusDot status={payload.status} />{payload.runName}</>} />
      <Row label="Environment" value={payload.environment} />
      <Row label="Pass rate" value={`${payload.passRate}%`} accent={payload.passRate >= 80 ? 'var(--pass)' : 'var(--fail)'} />
      <Row label="Passed" value={payload.passed} accent="var(--pass)" />
      <Row label="Failed" value={payload.failed} accent={payload.failed > 0 ? 'var(--fail)' : 'var(--text-mid)'} />
    </CardShell>
  );
}

function FailedTestsCard({ payload, slug }: { payload: FailedTestsPayload; slug: string }) {
  const navigate = useNavigate();
  return (
    <CardShell
      title={`Failed Tests (${payload.failures.length})`}
      icon="✗"
      onNavigate={() => navigate(`/projects/${slug}/reports`)}
    >
      {payload.failures.length === 0 ? (
        <div style={{ color: 'var(--pass)' }}>No failures — all tests passed.</div>
      ) : (
        payload.failures.slice(0, 5).map(f => (
          <div key={f.tcId} style={{ borderTop: '1px solid var(--border)', paddingTop: 4, marginTop: 2 }}>
            <div style={{ color: 'var(--fail)', fontWeight: 600 }}>{f.tcId}: {f.title}</div>
            <div style={{ color: 'var(--text-dim)', fontSize: 10, marginTop: 1 }}>{f.error}</div>
          </div>
        ))
      )}
      {payload.failures.length > 5 && (
        <div style={{ color: 'var(--text-dim)', fontSize: 10 }}>+ {payload.failures.length - 5} more</div>
      )}
    </CardShell>
  );
}

function PendingHealsCard({ payload, slug }: { payload: PendingHealsPayload; slug: string }) {
  const navigate = useNavigate();
  return (
    <CardShell
      title={`Pending Heals (${payload.count})`}
      icon="🔧"
      onNavigate={() => navigate(`/projects/${slug}/healing`)}
    >
      {payload.count === 0 ? (
        <div style={{ color: 'var(--pass)' }}>No pending heals — pipeline is healthy.</div>
      ) : (
        payload.heals.slice(0, 4).map(h => (
          <div key={h.healId} style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
            <span style={{ color: 'var(--text-mid)' }}>{h.tcId}</span>
            <span style={{ color: 'var(--text-dim)' }}>{h.type} · {h.confidence}%</span>
          </div>
        ))
      )}
      {payload.count > 4 && (
        <div style={{ color: 'var(--text-dim)', fontSize: 10 }}>+ {payload.count - 4} more · → Go to Healing Agent to approve</div>
      )}
    </CardShell>
  );
}

function ScheduledCard({ payload, slug }: { payload: ScheduledPayload; slug: string }) {
  const navigate = useNavigate();
  return (
    <CardShell
      title="Schedule Created"
      icon="⏰"
      onNavigate={() => navigate(`/projects/${slug}/scheduler`)}
    >
      <Row label="Name" value={payload.name} />
      <Row label="Cron" value={payload.cronExpression} />
      <Row label="Environment" value={payload.environment} />
      <Row label="Tests" value={payload.testCount} />
    </CardShell>
  );
}

function TcQueuedCard({ payload, slug }: { payload: TcQueuedPayload; slug: string }) {
  const navigate = useNavigate();
  return (
    <CardShell
      title="Test Cases Queued"
      icon="🧠"
      onNavigate={() => navigate(`/projects/${slug}/writer`)}
    >
      <Row label="Source" value={payload.source} />
      <div style={{ color: 'var(--text-dim)', fontSize: 10, marginTop: 2 }}>
        → Open the Test Writer screen to review and approve generated cases.
      </div>
    </CardShell>
  );
}

function ProjectStatsCard({ payload }: { payload: ProjectStatsPayload }) {
  return (
    <CardShell title="Project Stats" icon="▦">
      <Row label="Total TCs" value={payload.totalTests} />
      <Row label="Scripts" value={payload.scriptsGenerated} />
      <Row label="Active schedules" value={payload.activeSchedules} />
      <Row label="Pending heals" value={payload.pendingHeals} accent={payload.pendingHeals > 0 ? 'var(--skip)' : undefined} />
      {payload.lastRun && (
        <Row
          label="Last run pass rate"
          value={`${payload.lastRun.passRate}%`}
          accent={payload.lastRun.passRate >= 80 ? 'var(--pass)' : 'var(--fail)'}
        />
      )}
    </CardShell>
  );
}

// ── Main export ────────────────────────────────────────────────────────────

export default function ActionCard({ actionType, actionPayload }: ActionCardProps) {
  const { slug } = useParams<{ slug: string }>();
  const projectSlug = slug ?? '';

  if (!actionPayload) return null;

  switch (actionType) {
    case 'RUN_STARTED':
      return <RunStartedCard payload={actionPayload as RunStartedPayload} slug={projectSlug} />;
    case 'RUN_SUMMARY':
      return <RunSummaryCard payload={actionPayload as RunSummaryPayload} slug={projectSlug} />;
    case 'FAILED_TESTS':
      return <FailedTestsCard payload={actionPayload as FailedTestsPayload} slug={projectSlug} />;
    case 'PENDING_HEALS':
      return <PendingHealsCard payload={actionPayload as PendingHealsPayload} slug={projectSlug} />;
    case 'SCHEDULED':
      return <ScheduledCard payload={actionPayload as ScheduledPayload} slug={projectSlug} />;
    case 'TC_QUEUED':
      return <TcQueuedCard payload={actionPayload as TcQueuedPayload} slug={projectSlug} />;
    case 'PROJECT_STATS':
      return <ProjectStatsCard payload={actionPayload as ProjectStatsPayload} />;
    default:
      return null;
  }
}
