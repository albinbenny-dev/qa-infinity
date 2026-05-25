import { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import Topbar, { TbBtn } from '../components/layout/Topbar';
import HealCard from '../components/healing/HealCard';
import DiffViewer from '../components/healing/DiffViewer';
import {
  useHeals,
  useHealStats,
  useApproveHeal,
  useRejectHeal,
  useApproveAllConfident,
  useTriggerHeal,
  useDismissHeal,
} from '../hooks/useHeals';
import { useRuns, useCancelRun } from '../hooks/useRuns';
import { useProject } from '../hooks/useProjects';
import type { HealProposal } from '../types';
import type { RunListItem } from '../hooks/useRuns';

interface RetestEntry {
  healId: string;
  runId: string;
  tcTitle: string;
  result?: 'PASSED' | 'FAILED' | 'CANCELLED';
}

// ── Stat tile ──────────────────────────────────────────────────────────────

function StatTile({
  label,
  value,
  color,
  accent,
  suffix = '',
}: {
  label: string;
  value: number;
  color: string;
  accent: string;
  suffix?: string;
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
      <div style={{ fontSize: 26, fontWeight: 800, color, lineHeight: 1 }}>
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
          marginTop: 2,
        }}
      >
        {label}
      </div>
    </div>
  );
}

// ── Trigger modal ──────────────────────────────────────────────────────────

function TriggerModal({ projectId, onClose }: { projectId: string; onClose: () => void }) {
  const { data, isLoading } = useRuns(projectId);
  const { mutateAsync: trigger, isPending: triggering } = useTriggerHeal(projectId);

  const failedRuns: RunListItem[] = (data?.runs ?? []).filter(
    (r: RunListItem) => r.status === 'FAILED',
  );

  async function handleTrigger(run: RunListItem) {
    try {
      const res = await trigger(run.id);
      toast.success(`Queued ${res.count} heal job${res.count !== 1 ? 's' : ''} for "${run.name}"`);
      onClose();
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.55)',
        zIndex: 1000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: 'var(--surface)',
          border: '1px solid var(--border)',
          borderRadius: 12,
          padding: 24,
          width: 480,
          maxHeight: '70vh',
          overflow: 'auto',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)', marginBottom: 3 }}>
            Trigger Healing Analysis
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-dim)' }}>
            Select a failed run to analyse and generate heal proposals.
          </div>
        </div>

        {isLoading ? (
          <div style={{ color: 'var(--text-dim)', fontSize: 12, textAlign: 'center', padding: '20px 0' }}>
            Loading runs…
          </div>
        ) : failedRuns.length === 0 ? (
          <div style={{ color: 'var(--text-dim)', fontSize: 12, textAlign: 'center', padding: '20px 0' }}>
            No failed runs found.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {failedRuns.map((run) => (
              <div
                key={run.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '10px 14px',
                  background: 'var(--surface2)',
                  border: '1px solid var(--border)',
                  borderRadius: 8,
                }}
              >
                <div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>{run.name}</div>
                  <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 2 }}>
                    {run.environment} · {run.triggerType}
                  </div>
                </div>
                <button
                  disabled={triggering}
                  onClick={() => handleTrigger(run)}
                  style={{
                    padding: '5px 14px',
                    borderRadius: 6,
                    background: 'var(--cyan)',
                    color: 'var(--surface)',
                    border: 'none',
                    cursor: triggering ? 'not-allowed' : 'pointer',
                    fontWeight: 700,
                    fontSize: 12,
                    opacity: triggering ? 0.6 : 1,
                  }}
                >
                  Heal
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Heal detail panel (right side) ─────────────────────────────────────────

function HealDetailPanel({
  heal,
  onClose,
}: {
  heal: HealProposal;
  onClose: () => void;
}) {
  const diff = heal.lineDiff ?? [];

  return (
    <div
      style={{
        background: 'var(--surface)',
        border: '1px solid var(--border)',
        borderRadius: 12,
        padding: 20,
        display: 'flex',
        flexDirection: 'column',
        gap: 14,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
        <div>
          <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)', marginBottom: 4 }}>
            {heal.runResult?.testCase.title}
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <span
              style={{
                fontSize: 9,
                fontWeight: 700,
                letterSpacing: '0.06em',
                textTransform: 'uppercase',
                padding: '2px 8px',
                borderRadius: 100,
                background:
                  heal.type === 'SELECTOR'
                    ? 'rgba(251,191,36,0.12)'
                    : heal.type === 'FLOW'
                    ? 'rgba(244,123,32,0.12)'
                    : 'rgba(37,99,171,0.12)',
                color:
                  heal.type === 'SELECTOR'
                    ? 'var(--amber)'
                    : heal.type === 'FLOW'
                    ? 'var(--violet)'
                    : 'var(--cyan)',
              }}
            >
              {heal.type.replace('_', ' ')}
            </span>
            <span
              style={{
                fontSize: 10,
                color: 'var(--text-dim)',
                fontFamily: 'var(--font-mono)',
              }}
            >
              {heal.runResult?.testCase.tcId}
            </span>
          </div>
        </div>
        <button
          onClick={onClose}
          style={{ background: 'none', border: 'none', color: 'var(--text-dim)', cursor: 'pointer', fontSize: 18, lineHeight: 1, flexShrink: 0 }}
        >
          ✕
        </button>
      </div>

      {heal.runResult?.errorMessage && (
        <div>
          <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-dim)', marginBottom: 5 }}>
            Error
          </div>
          <div
            style={{
              background: 'var(--rose-dim)',
              border: '1px solid rgba(220,38,38,0.2)',
              borderRadius: 7,
              padding: '8px 12px',
              fontSize: 11,
              fontFamily: 'var(--font-mono)',
              color: 'var(--fail)',
              whiteSpace: 'pre-wrap',
              maxHeight: 80,
              overflow: 'auto',
            }}
          >
            {heal.runResult.errorMessage}
          </div>
        </div>
      )}

      {diff.length > 0 && <DiffViewer diff={diff} />}
    </div>
  );
}

// ── Recently healed table ──────────────────────────────────────────────────

const STATUS_COLOR: Record<string, string> = {
  APPROVED: 'var(--pass)',
  AUTO_APPLIED: 'var(--cyan)',
  REJECTED: 'var(--fail)',
  PENDING: 'var(--amber)',
};

function RecentlyHealedTable({ heals }: { heals: HealProposal[] }) {
  const recent = heals
    .filter((h) => h.status === 'APPROVED' || h.status === 'AUTO_APPLIED')
    .slice(0, 10);

  if (recent.length === 0) {
    return (
      <div style={{ padding: '24px 0', textAlign: 'center', color: 'var(--text-dim)', fontSize: 12 }}>
        No heals applied yet.
      </div>
    );
  }

  return (
    <div style={{ overflow: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
        <thead>
          <tr>
            {['TC', 'Type', 'Confidence', 'Time', 'Status'].map((h) => (
              <th
                key={h}
                style={{
                  padding: '6px 10px',
                  textAlign: 'left',
                  fontSize: 10,
                  fontWeight: 700,
                  textTransform: 'uppercase',
                  letterSpacing: '0.06em',
                  color: 'var(--text-dim)',
                  borderBottom: '1px solid var(--border)',
                  whiteSpace: 'nowrap',
                }}
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {recent.map((h) => (
            <tr
              key={h.id}
              style={{ borderBottom: '1px solid var(--border)' }}
            >
              <td
                style={{
                  padding: '8px 10px',
                  color: 'var(--text)',
                  fontWeight: 500,
                  maxWidth: 160,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {h.runResult?.testCase.title ?? '—'}
              </td>
              <td style={{ padding: '8px 10px' }}>
                <span
                  style={{
                    fontSize: 9,
                    fontWeight: 700,
                    letterSpacing: '0.05em',
                    textTransform: 'uppercase',
                    padding: '2px 7px',
                    borderRadius: 100,
                    background:
                      h.type === 'SELECTOR'
                        ? 'rgba(251,191,36,0.12)'
                        : h.type === 'FLOW'
                        ? 'rgba(244,123,32,0.12)'
                        : 'rgba(37,99,171,0.12)',
                    color:
                      h.type === 'SELECTOR'
                        ? 'var(--amber)'
                        : h.type === 'FLOW'
                        ? 'var(--violet)'
                        : 'var(--cyan)',
                  }}
                >
                  {h.type.replace('_', ' ')}
                </span>
              </td>
              <td style={{ padding: '8px 10px' }}>
                <span
                  style={{
                    fontWeight: 700,
                    color:
                      h.confidence >= 90
                        ? 'var(--pass)'
                        : h.confidence >= 70
                        ? 'var(--amber)'
                        : 'var(--fail)',
                  }}
                >
                  {h.confidence}%
                </span>
              </td>
              <td
                style={{
                  padding: '8px 10px',
                  color: 'var(--text-dim)',
                  fontSize: 11,
                  fontFamily: 'var(--font-mono)',
                  whiteSpace: 'nowrap',
                }}
              >
                {new Date(h.updatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </td>
              <td style={{ padding: '8px 10px' }}>
                <span
                  style={{
                    fontSize: 10,
                    fontWeight: 700,
                    color: STATUS_COLOR[h.status] ?? 'var(--text-dim)',
                  }}
                >
                  {h.status.replace('_', '-')}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Main page ──────────────────────────────────────────────────────────────

export default function Healing() {
  const { slug } = useParams<{ slug: string }>();
  const { data: project } = useProject(slug);
  const projectId = project?.id ?? '';

  const [showTrigger, setShowTrigger] = useState(false);
  const [detailHeal, setDetailHeal] = useState<HealProposal | null>(null);
  const [retestQueue, setRetestQueue] = useState<RetestEntry[]>([]);

  const { data: pendingHeals = [], isLoading: loadingPending } = useHeals(projectId, 'PENDING');
  const { data: exhaustedHeals = [] } = useHeals(projectId, 'EXHAUSTED');
  const { data: allHeals = [] } = useHeals(projectId);
  const { data: stats } = useHealStats(projectId);
  const { data: runsData } = useRuns(projectId);
  const runs = runsData?.runs ?? [];

  const { mutateAsync: approve, isPending: approving } = useApproveHeal(projectId);
  const { mutateAsync: reject, isPending: rejecting } = useRejectHeal(projectId);
  const { mutateAsync: approveAll, isPending: approvingAll } = useApproveAllConfident(projectId);
  const { mutateAsync: dismissHeal } = useDismissHeal(projectId);
  const { mutateAsync: cancelRun } = useCancelRun(projectId);

  const busy = approving || rejecting;

  // When a run terminates, capture its result on the entry instead of silently removing it
  useEffect(() => {
    if (retestQueue.length === 0) return;
    setRetestQueue((prev) => {
      let changed = false;
      const updated = prev.map((entry) => {
        if (entry.result) return entry;
        const run = runs.find((r) => r.id === entry.runId);
        if (run && (run.status === 'PASSED' || run.status === 'FAILED' || run.status === 'CANCELLED')) {
          changed = true;
          return { ...entry, result: run.status as RetestEntry['result'] };
        }
        return entry;
      });
      return changed ? updated : prev;
    });
  }, [runs]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-dismiss only PASSED entries after 5 s; FAILED/CANCELLED entries stay until user action
  useEffect(() => {
    const passed = retestQueue.filter((e) => e.result === 'PASSED');
    if (passed.length === 0) return;
    const timer = setTimeout(() => {
      setRetestQueue((prev) => prev.filter((e) => e.result !== 'PASSED'));
    }, 5000);
    return () => clearTimeout(timer);
  }, [retestQueue.map((e) => e.result ?? '').join(',')]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-remove FAILED banner entries whose TC is now EXHAUSTED (no more heal attempts)
  useEffect(() => {
    if (retestQueue.length === 0) return;
    const exhaustedTitles = new Set(
      exhaustedHeals.map((h) => h.runResult?.testCase.title ?? ''),
    );
    const hasStale = retestQueue.some(
      (e) => e.result === 'FAILED' && exhaustedTitles.has(e.tcTitle),
    );
    if (!hasStale) return;
    setRetestQueue((prev) =>
      prev.filter((e) => !(e.result === 'FAILED' && exhaustedTitles.has(e.tcTitle))),
    );
  }, [exhaustedHeals]); // eslint-disable-line react-hooks/exhaustive-deps

  // Entries still running or awaiting result display
  const activeRetests = retestQueue;

  async function handleApprove(healId: string, tcTitle: string) {
    // Block only if a retest is still actively running (not if it has already completed)
    if (activeRetests.some((e) => e.tcTitle === tcTitle && !e.result)) {
      toast('A retest is already running for this test case — wait for it to finish', { icon: 'ℹ️' });
      return;
    }
    try {
      const res = await approve(healId);
      // Replace any existing entry for this TC so the banner never shows duplicates
      setRetestQueue((prev) => [
        ...prev.filter((e) => e.tcTitle !== tcTitle),
        { healId, runId: res.runId, tcTitle },
      ]);
      toast.success('Heal approved — test re-queued');
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  async function handleCancelRetest(runId: string) {
    try {
      await cancelRun(runId);
      setRetestQueue((prev) => prev.filter((e) => e.runId !== runId));
      toast('Retest cancelled — healing loop stopped');
    } catch (e) {
      toast.error((e as Error).message ?? 'Failed to cancel retest');
    }
  }

  async function handleReject(healId: string, tcTitle?: string) {
    try {
      await reject(healId);
      // Clear any lingering banner entry for this TC (e.g. a FAILED re-run that was waiting)
      if (tcTitle) {
        setRetestQueue((prev) => prev.filter((e) => e.tcTitle !== tcTitle));
      }
      toast.success('Heal rejected');
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  async function handleApproveAll() {
    try {
      const res = await approveAll();
      if (res.count === 0) {
        toast('No high-confidence pending heals found', { icon: 'ℹ️' });
      } else {
        toast.success(`Approved ${res.count} high-confidence heal${res.count !== 1 ? 's' : ''}`);
      }
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  async function handleDismissExhausted(healId: string) {
    try {
      await dismissHeal(healId);
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  const latestHeal = allHeals[0];

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <Topbar
        breadcrumbs={[
          { label: 'All Projects', href: '/projects' },
          { label: project?.name ?? slug ?? '' },
          { label: '🔧 Healing Agent' },
        ]}
        actions={
          <div style={{ display: 'flex', gap: 8 }}>
            <TbBtn
              variant="primary"
              disabled={approvingAll}
              onClick={handleApproveAll}
              style={{
                background: 'rgba(42,157,143,0.15)',
                color: 'var(--pass)',
                border: '1px solid rgba(42,157,143,0.3)',
              }}
            >
              ✅ Approve All High-Confidence
            </TbBtn>
            <TbBtn
              variant="ghost"
              onClick={() => setShowTrigger(true)}
              style={{
                background: 'rgba(37,99,171,0.12)',
                color: 'var(--cyan)',
                border: '1px solid rgba(37,99,171,0.3)',
              }}
            >
              🔄 Re-run Healed Tests
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
        {/* 5-up stat tiles */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 12 }}>
          <StatTile
            label="Pending Heals"
            value={stats?.pending ?? 0}
            color="var(--fail)"
            accent="linear-gradient(90deg, #DC2626, #b91c1c)"
          />
          <StatTile
            label="Auto-Healed Today"
            value={stats?.autoAppliedToday ?? 0}
            color="var(--pass)"
            accent="linear-gradient(90deg, #2A9D8F, #1a7a6e)"
          />
          <StatTile
            label="Selector Changes"
            value={stats?.selectorChanges ?? 0}
            color="var(--skip)"
            accent="linear-gradient(90deg, #F47B20, #D9601A)"
          />
          <StatTile
            label="Flow Changes"
            value={stats?.flowChanges ?? 0}
            color="var(--cyan)"
            accent="linear-gradient(90deg, #2563AB, #0A2A57)"
          />
          <StatTile
            label="Avg Confidence"
            value={stats?.avgConfidence ?? 0}
            color="var(--violet)"
            accent="linear-gradient(90deg, #FFB347, #F47B20)"
            suffix="%"
          />
        </div>

        {/* ── Retest monitor banner ──────────────────────────────────────── */}
        {activeRetests.length > 0 && (
          <div
            style={{
              background: 'rgba(37,99,171,0.07)',
              border: '1px solid rgba(37,99,171,0.3)',
              borderRadius: 10,
              padding: '12px 16px',
              display: 'flex',
              flexDirection: 'column',
              gap: 10,
            }}
          >
            <div
              style={{
                fontSize: 10,
                fontWeight: 700,
                textTransform: 'uppercase',
                letterSpacing: '0.07em',
                color: activeRetests.some((e) => !e.result) ? 'var(--cyan)' : 'var(--text-dim)',
              }}
            >
              {activeRetests.some((e) => !e.result) ? '⚡ Heal Re-run in Progress' : '⟳ Heal Re-run Results'}
            </div>
            {activeRetests.map((entry) => {
              const run = runs.find((r) => r.id === entry.runId);
              const runStatus = run?.status ?? 'QUEUED';
              const isDone = !!entry.result;
              const passed = entry.result === 'PASSED';
              const failed = entry.result === 'FAILED' || entry.result === 'CANCELLED';

              return (
                <div
                  key={entry.runId}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 12,
                    padding: isDone ? '8px 12px' : '0',
                    borderRadius: isDone ? 8 : 0,
                    background: isDone
                      ? passed
                        ? 'rgba(42,157,143,0.10)'
                        : 'rgba(220,38,38,0.08)'
                      : 'transparent',
                    border: isDone
                      ? `1px solid ${passed ? 'rgba(42,157,143,0.3)' : 'rgba(220,38,38,0.3)'}`
                      : 'none',
                    transition: 'all 0.3s',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                    {isDone ? (
                      <span style={{ fontSize: 14, flexShrink: 0 }}>{passed ? '✓' : '✕'}</span>
                    ) : (
                      <span
                        style={{
                          width: 7,
                          height: 7,
                          borderRadius: '50%',
                          background: 'var(--cyan)',
                          flexShrink: 0,
                          animation: 'healBlink 1.2s ease-in-out infinite',
                        }}
                      />
                    )}
                    <div style={{ minWidth: 0 }}>
                      <span
                        style={{
                          fontSize: 12,
                          fontWeight: 600,
                          color: isDone
                            ? passed ? 'var(--pass)' : 'var(--fail)'
                            : 'var(--text)',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                          display: 'block',
                        }}
                      >
                        {entry.tcTitle}
                      </span>
                      {isDone && failed && (
                        <span style={{ fontSize: 10, color: 'var(--amber)', fontFamily: 'var(--font-mono)' }}>
                          Re-run failed — review the new heal proposal below ↓
                        </span>
                      )}
                      {isDone && passed && (
                        <span style={{ fontSize: 10, color: 'var(--pass)', fontFamily: 'var(--font-mono)' }}>
                          Test passed after healing ✓
                        </span>
                      )}
                    </div>
                    {!isDone && (
                      <span
                        style={{
                          fontSize: 10,
                          fontFamily: 'var(--font-mono)',
                          color: 'var(--text-dim)',
                          flexShrink: 0,
                        }}
                      >
                        {runStatus}
                      </span>
                    )}
                  </div>

                  {!isDone && (
                    <button
                      onClick={() => handleCancelRetest(entry.runId)}
                      style={{
                        padding: '3px 12px',
                        borderRadius: 5,
                        background: 'rgba(220,38,38,0.08)',
                        border: '1px solid rgba(220,38,38,0.35)',
                        color: 'var(--fail)',
                        fontSize: 11,
                        fontWeight: 700,
                        cursor: 'pointer',
                        flexShrink: 0,
                        fontFamily: 'var(--font-ui)',
                      }}
                    >
                      ■ Stop Loop
                    </button>
                  )}
                  {isDone && failed && (
                    <button
                      onClick={() => setRetestQueue((prev) => prev.filter((e) => e.runId !== entry.runId))}
                      title="Dismiss"
                      style={{
                        padding: '3px 10px',
                        borderRadius: 5,
                        background: 'transparent',
                        border: '1px solid var(--border)',
                        color: 'var(--text-dim)',
                        fontSize: 11,
                        fontWeight: 700,
                        cursor: 'pointer',
                        flexShrink: 0,
                        fontFamily: 'var(--font-ui)',
                      }}
                    >
                      ✕ Dismiss
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* 2-column main layout */}
        <div
          className="heal-layout"
          style={{
            display: 'grid',
            gridTemplateColumns: '1fr 1fr',
            gap: 20,
            alignItems: 'start',
          }}
        >
          {/* LEFT — Pending Approval */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                marginBottom: 2,
              }}
            >
              <h2
                style={{
                  fontSize: 13,
                  fontWeight: 700,
                  color: 'var(--text)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                }}
              >
                ⏳ Pending Approval
                {pendingHeals.length > 0 && (
                  <span
                    style={{
                      fontSize: 10,
                      background: 'rgba(220,38,38,0.12)',
                      color: 'var(--fail)',
                      padding: '1px 7px',
                      borderRadius: 100,
                      fontWeight: 700,
                    }}
                  >
                    {pendingHeals.length}
                  </span>
                )}
              </h2>
            </div>

            {loadingPending ? (
              <div
                style={{
                  color: 'var(--text-dim)',
                  fontSize: 12,
                  textAlign: 'center',
                  padding: '40px 0',
                }}
              >
                Analysing failures…
              </div>
            ) : pendingHeals.length === 0 ? (
              <div
                style={{
                  color: 'var(--text-dim)',
                  fontSize: 12,
                  textAlign: 'center',
                  padding: '40px 0',
                  lineHeight: 1.8,
                }}
              >
                No pending heal proposals.
                <br />
                <span style={{ color: 'var(--text-mid)' }}>
                  Run tests with failures, then click{' '}
                  <span
                    style={{ color: 'var(--cyan)', cursor: 'pointer', textDecoration: 'underline' }}
                    onClick={() => setShowTrigger(true)}
                  >
                    Trigger Healing
                  </span>
                  .
                </span>
              </div>
            ) : (
              pendingHeals.map((h) => (
                <HealCard
                  key={h.id}
                  heal={h}
                  busy={busy}
                  onApprove={() => handleApprove(h.id, h.runResult?.testCase.title ?? 'Unknown Test')}
                  onReject={() => handleReject(h.id, h.runResult?.testCase.title ?? 'Unknown Test')}
                />
              ))
            )}

            {/* ── Cannot Auto-Heal section ──────────────────────────────── */}
            {exhaustedHeals.length > 0 && (
              <div style={{ marginTop: pendingHeals.length > 0 ? 20 : 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                    fontSize: 13,
                    fontWeight: 700,
                    color: 'var(--fail)',
                  }}
                >
                  🚫 Cannot Auto-Heal
                  <span
                    style={{
                      fontSize: 10,
                      background: 'rgba(220,38,38,0.12)',
                      color: 'var(--fail)',
                      padding: '1px 7px',
                      borderRadius: 100,
                      fontWeight: 700,
                    }}
                  >
                    {exhaustedHeals.length}
                  </span>
                </div>
                {exhaustedHeals.map((h) => (
                  <div
                    key={h.id}
                    style={{
                      background: 'rgba(220,38,38,0.04)',
                      border: '1px solid rgba(220,38,38,0.25)',
                      borderRadius: 10,
                      padding: '12px 14px',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 8,
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
                      <div>
                        <div style={{ fontSize: 10, color: 'var(--text-dim)', fontFamily: 'var(--font-mono)', marginBottom: 2 }}>
                          {h.runResult?.testCase.tcId}
                        </div>
                        <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>
                          {h.runResult?.testCase.title ?? '—'}
                        </div>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0, marginTop: 2 }}>
                        <span
                          style={{
                            fontSize: 9,
                            fontWeight: 700,
                            letterSpacing: '0.06em',
                            textTransform: 'uppercase',
                            padding: '2px 8px',
                            borderRadius: 100,
                            background: 'rgba(220,38,38,0.12)',
                            color: 'var(--fail)',
                          }}
                        >
                          Exhausted
                        </span>
                        <button
                          onClick={() => handleDismissExhausted(h.id)}
                          title="Clear this card"
                          style={{
                            padding: '2px 9px',
                            borderRadius: 5,
                            background: 'transparent',
                            border: '1px solid var(--border2)',
                            color: 'var(--text-dim)',
                            fontSize: 10,
                            fontWeight: 700,
                            cursor: 'pointer',
                            fontFamily: 'var(--font-ui)',
                          }}
                        >
                          ✕ Clear
                        </button>
                      </div>
                    </div>
                    {h.runResult?.errorMessage && (
                      <div
                        style={{
                          background: 'rgba(220,38,38,0.07)',
                          border: '1px solid rgba(220,38,38,0.15)',
                          borderRadius: 6,
                          padding: '6px 10px',
                          fontSize: 11,
                          fontFamily: 'var(--font-mono)',
                          color: 'var(--fail)',
                          whiteSpace: 'pre-wrap',
                          maxHeight: 60,
                          overflow: 'auto',
                        }}
                      >
                        {h.runResult.errorMessage}
                      </div>
                    )}
                    <div style={{ fontSize: 11, color: 'var(--text-dim)', lineHeight: 1.55 }}>
                      {h.summary}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* RIGHT — Recently Healed + AI Summary */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {/* Recently healed section */}
            <div
              style={{
                background: 'var(--surface)',
                border: '1px solid var(--border)',
                borderRadius: 12,
                overflow: 'hidden',
              }}
            >
              <div
                style={{
                  padding: '12px 16px',
                  borderBottom: '1px solid var(--border)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                }}
              >
                <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>
                  Recently Healed
                </span>
                <span
                  style={{
                    fontSize: 10,
                    color: 'var(--text-dim)',
                    fontFamily: 'var(--font-mono)',
                  }}
                >
                  {allHeals.filter((h) => h.status === 'APPROVED' || h.status === 'AUTO_APPLIED').length} total
                </span>
              </div>
              <RecentlyHealedTable heals={allHeals} />
            </div>

            {/* AI Summary card */}
            {latestHeal?.summary && (
              <div
                style={{
                  background: 'var(--surface)',
                  border: '1px solid var(--border)',
                  borderLeft: '3px solid var(--cyan)',
                  borderRadius: 12,
                  overflow: 'hidden',
                  position: 'relative',
                }}
              >
                {/* Cool-accent top stripe */}
                <div
                  style={{
                    height: 3,
                    background: 'var(--cool-accent)',
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    right: 0,
                  }}
                />
                <div style={{ padding: '20px 16px 14px' }}>
                  <div
                    style={{
                      fontSize: 10,
                      fontWeight: 700,
                      textTransform: 'uppercase',
                      letterSpacing: '0.07em',
                      color: 'var(--cyan)',
                      marginBottom: 8,
                    }}
                  >
                    AI Analysis — Latest Heal
                  </div>
                  <p
                    style={{
                      fontSize: 12,
                      color: 'var(--text-mid)',
                      lineHeight: 1.65,
                      margin: 0,
                    }}
                  >
                    {latestHeal.summary}
                  </p>
                  {latestHeal.runResult?.testCase && (
                    <div
                      style={{
                        marginTop: 10,
                        fontSize: 11,
                        color: 'var(--text-dim)',
                        fontFamily: 'var(--font-mono)',
                      }}
                    >
                      {latestHeal.runResult.testCase.tcId} · {latestHeal.runResult.testCase.title}
                    </div>
                  )}
                </div>

                {/* View full diff link */}
                {latestHeal.lineDiff && latestHeal.lineDiff.length > 0 && (
                  <div
                    style={{
                      padding: '0 16px 14px',
                      borderTop: '1px solid var(--border)',
                      marginTop: 4,
                      paddingTop: 12,
                    }}
                  >
                    <button
                      onClick={() => setDetailHeal(latestHeal)}
                      style={{
                        background: 'none',
                        border: 'none',
                        color: 'var(--cyan)',
                        cursor: 'pointer',
                        fontSize: 11,
                        fontWeight: 600,
                        padding: 0,
                        textDecoration: 'underline',
                      }}
                    >
                      View full diff →
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      <style>{`
        @keyframes healBlink {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.25; }
        }
      `}</style>

      {/* Trigger modal */}
      {showTrigger && (
        <TriggerModal projectId={projectId} onClose={() => setShowTrigger(false)} />
      )}

      {/* Detail diff modal */}
      {detailHeal && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.55)',
            zIndex: 1000,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 24,
          }}
          onClick={() => setDetailHeal(null)}
        >
          <div
            style={{ width: '100%', maxWidth: 700, maxHeight: '85vh', overflow: 'auto' }}
            onClick={(e) => e.stopPropagation()}
          >
            <HealDetailPanel heal={detailHeal} onClose={() => setDetailHeal(null)} />
          </div>
        </div>
      )}
    </div>
  );
}
