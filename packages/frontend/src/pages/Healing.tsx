import { useState, useEffect, useMemo } from 'react';
import { useParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import { useQueryClient } from '@tanstack/react-query';
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
  useCancelHeal,
  useDismissHeal,
  useRetryHealWithContext,
} from '../hooks/useHeals';
import { useHealSocket } from '../hooks/useHealSocket';
import type { HealPhase } from '../hooks/useHealSocket';
import { useRuns, useRun } from '../hooks/useRuns';
import { useProject } from '../hooks/useProjects';
import { useRBAC } from '../hooks/useRBAC';
import type { HealProposal } from '../types';
import type { RunListItem } from '../hooks/useRuns';

interface HealInProgressEntry {
  runResultId: string;
  tcTitle: string;
  phase: HealPhase | 'ANALYZING' | 'COMPLETE' | 'AUTO_APPLIED';
  startedAt: number;
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

// ── Expanded run results (loads details on demand) ─────────────────────────

function ExpandedRunResults({
  projectId,
  runId,
  selectedIds,
  onToggle,
  onInitialized,
}: {
  projectId: string;
  runId: string;
  selectedIds: string[];
  onToggle: (id: string) => void;
  onInitialized: (ids: string[]) => void;
}) {
  const { data: run, isLoading } = useRun(projectId, runId);
  const [expandedErrors, setExpandedErrors] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (run) {
      const failedIds = run.results.filter((r) => r.status === 'FAILED').map((r) => r.id);
      onInitialized(failedIds);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run?.id]);

  if (isLoading) {
    return (
      <div style={{ padding: '10px 14px', fontSize: 11, color: 'var(--text-dim)' }}>
        Loading…
      </div>
    );
  }

  const failed = run?.results.filter((r) => r.status === 'FAILED') ?? [];

  if (failed.length === 0) {
    return (
      <div style={{ padding: '10px 14px', fontSize: 11, color: 'var(--text-dim)' }}>
        No failed test cases.
      </div>
    );
  }

  function toggleError(id: string, e: React.MouseEvent) {
    e.stopPropagation();
    setExpandedErrors((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      {failed.map((result) => {
        const checked = selectedIds.includes(result.id);
        const errorExpanded = expandedErrors.has(result.id);
        return (
          <div
            key={result.id}
            style={{
              display: 'flex',
              alignItems: 'flex-start',
              gap: 10,
              padding: '7px 14px',
              cursor: 'pointer',
              borderBottom: '1px solid rgba(255,255,255,0.04)',
              background: checked ? 'rgba(220,38,38,0.05)' : 'transparent',
            }}
            onClick={() => onToggle(result.id)}
          >
            <input
              type="checkbox"
              checked={checked}
              onChange={() => onToggle(result.id)}
              onClick={(e) => e.stopPropagation()}
              style={{ accentColor: 'var(--fail)', width: 13, height: 13, flexShrink: 0, marginTop: 2 }}
            />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div
                style={{
                  fontSize: 12,
                  fontWeight: 600,
                  color: 'var(--text)',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {result.testCase?.title ?? result.testCase?.tcId ?? '—'}
              </div>
              {result.errorMessage && (
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 4,
                    marginTop: 1,
                    minWidth: 0,
                  }}
                >
                  <div
                    title={result.errorMessage}
                    style={{
                      flex: 1,
                      minWidth: 0,
                      fontSize: 10,
                      fontFamily: 'var(--font-mono)',
                      color: 'var(--fail)',
                      whiteSpace: errorExpanded ? 'pre-wrap' : 'nowrap',
                      overflow: errorExpanded ? 'visible' : 'hidden',
                      textOverflow: errorExpanded ? 'clip' : 'ellipsis',
                      wordBreak: errorExpanded ? 'break-all' : 'normal',
                      lineHeight: 1.4,
                      maxHeight: errorExpanded ? 100 : 'none',
                      overflowY: errorExpanded ? 'auto' : 'visible',
                    }}
                  >
                    {result.errorMessage}
                  </div>
                  {result.errorMessage.length > 80 && (
                    <button
                      onClick={(e) => toggleError(result.id, e)}
                      title={errorExpanded ? 'Collapse error' : 'Expand full error'}
                      style={{
                        flexShrink: 0,
                        background: 'none',
                        border: 'none',
                        padding: '0 2px',
                        fontSize: 9,
                        color: 'var(--text-dim)',
                        cursor: 'pointer',
                        lineHeight: 1,
                      }}
                    >
                      {errorExpanded ? '▲' : '▼'}
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── Failed runs panel (replaces TriggerModal) ──────────────────────────────

function FailedRunsPanel({
  projectId,
  onHealsQueued,
  healedRunIds,
  onRunExpanded,
}: {
  projectId: string;
  onHealsQueued?: (items: Array<{ runResultId: string; tcTitle: string }>) => void;
  healedRunIds?: Set<string>;
  onRunExpanded?: (runId: string | null) => void;
}) {
  const { data, isLoading } = useRuns(projectId);
  const qc = useQueryClient();
  const { mutateAsync: trigger, isPending: triggering } = useTriggerHeal(projectId);

  const [expandedRunId, setExpandedRunId] = useState<string | null>(null);
  const [selections, setSelections] = useState<Record<string, string[]>>({});
  const [showOlderRuns, setShowOlderRuns] = useState(false);

  const RETENTION_DAYS = 7;
  const allFailedRuns: RunListItem[] = (data?.runs ?? []).filter(
    (r: RunListItem) => r.status === 'FAILED',
  );
  const cutoff = Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000;
  const recentFailedRuns = allFailedRuns.filter(
    (r) => !r.completedAt || new Date(r.completedAt).getTime() >= cutoff,
  );
  const olderCount = allFailedRuns.length - recentFailedRuns.length;
  const failedRuns = showOlderRuns ? allFailedRuns : recentFailedRuns;

  function handleToggleRun(runId: string) {
    setExpandedRunId((prev) => {
      const next = prev === runId ? null : runId;
      onRunExpanded?.(next);
      return next;
    });
  }

  function handleToggleResult(runId: string, resultId: string) {
    setSelections((prev) => {
      const current = prev[runId] ?? [];
      const next = current.includes(resultId)
        ? current.filter((id) => id !== resultId)
        : [...current, resultId];
      return { ...prev, [runId]: next };
    });
  }

  function handleInitialized(runId: string, ids: string[]) {
    setSelections((prev) => {
      if (prev[runId] !== undefined) return prev;
      return { ...prev, [runId]: ids };
    });
  }

  async function handleHealSelected(runId: string) {
    const runResultIds = selections[runId] ?? [];
    if (runResultIds.length === 0) {
      toast('Select at least one test case to heal', { icon: 'ℹ️' });
      return;
    }
    try {
      const res = await trigger({ runId, runResultIds });
      if (res.count === 0) {
        toast('Heal jobs already running for selected tests', { icon: 'ℹ️' });
      } else {
        // Immediately seed the progress bar — don't wait for socket or polling
        if (res.queued?.length) onHealsQueued?.(res.queued);
        toast.success(`Queued ${res.count} heal job${res.count !== 1 ? 's' : ''}`);
        setSelections((prev) => ({ ...prev, [runId]: [] }));
        setExpandedRunId(null);
      }
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  if (isLoading) {
    return (
      <div style={{ color: 'var(--text-dim)', fontSize: 12, padding: '16px 0' }}>
        Loading runs…
      </div>
    );
  }

  if (failedRuns.length === 0) {
    return (
      <div
        style={{
          color: 'var(--text-dim)',
          fontSize: 12,
          padding: '20px 0',
          textAlign: 'center',
          lineHeight: 1.7,
        }}
      >
        No failed runs.
        <br />
        <span style={{ color: 'var(--text-dim)', fontSize: 11 }}>
          Run your test suite and failed tests will appear here.
        </span>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {failedRuns.map((run) => {
        const isExpanded = expandedRunId === run.id;
        const failedCount = run.results.filter((r) => r.status === 'FAILED').length;
        const selectedCount = (selections[run.id] ?? []).length;

        return (
          <div
            key={run.id}
            style={{
              background: 'var(--surface)',
              border: `1px solid ${isExpanded ? 'rgba(220,38,38,0.35)' : 'var(--border)'}`,
              borderRadius: 8,
              overflow: 'hidden',
              transition: 'border-color 0.15s',
            }}
          >
            {/* Run header */}
            <div
              onClick={() => handleToggleRun(run.id)}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '9px 12px',
                cursor: 'pointer',
                background: isExpanded ? 'rgba(220,38,38,0.04)' : 'transparent',
              }}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <div
                  style={{
                    fontSize: 12,
                    fontWeight: 600,
                    color: 'var(--text)',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {run.name}
                </div>
                <div style={{ fontSize: 10, color: 'var(--text-dim)', marginTop: 1 }}>
                  {run.environment}
                  {' · '}
                  <span style={{ color: 'var(--fail)', fontWeight: 700 }}>
                    {failedCount} failed
                  </span>
                  {run.completedAt && (
                    <>
                      {' · '}
                      {new Date(run.completedAt).toLocaleString([], {
                        month: 'short', day: 'numeric',
                        hour: '2-digit', minute: '2-digit',
                      })}
                    </>
                  )}
                </div>
              </div>
              <span
                style={{
                  fontSize: 11,
                  color: 'var(--text-dim)',
                  flexShrink: 0,
                  marginLeft: 8,
                  transition: 'transform 0.2s',
                  transform: isExpanded ? 'rotate(180deg)' : 'none',
                  display: 'inline-block',
                }}
              >
                ▾
              </span>
            </div>

            {/* Expanded TC list */}
            {isExpanded && (
              <>
                <div style={{ borderTop: '1px solid rgba(220,38,38,0.15)' }}>
                  <ExpandedRunResults
                    projectId={projectId}
                    runId={run.id}
                    selectedIds={selections[run.id] ?? []}
                    onToggle={(id) => handleToggleResult(run.id, id)}
                    onInitialized={(ids) => handleInitialized(run.id, ids)}
                  />
                </div>
                <div
                  style={{
                    padding: '8px 12px',
                    borderTop: '1px solid rgba(220,38,38,0.12)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 8,
                  }}
                >
                  <span style={{ fontSize: 11, color: 'var(--text-dim)' }}>
                    {selectedCount > 0 ? `${selectedCount} selected` : 'None selected'}
                  </span>
                  <button
                    disabled={triggering || selectedCount === 0}
                    onClick={() => handleHealSelected(run.id)}
                    style={{
                      padding: '5px 16px',
                      borderRadius: 6,
                      background: selectedCount > 0 ? 'rgba(220,38,38,0.12)' : 'transparent',
                      border: `1px solid ${selectedCount > 0 ? 'rgba(220,38,38,0.35)' : 'var(--border)'}`,
                      color: selectedCount > 0 ? 'var(--fail)' : 'var(--text-dim)',
                      fontSize: 11,
                      fontWeight: 700,
                      cursor: triggering || selectedCount === 0 ? 'not-allowed' : 'pointer',
                      opacity: triggering || selectedCount === 0 ? 0.55 : 1,
                      transition: 'all 0.15s',
                    }}
                  >
                    {triggering ? 'Queuing…' : '⟳ Heal Selected'}
                  </button>
                </div>
              </>
            )}
          </div>
        );
      })}
      {olderCount > 0 && (
        <button
          onClick={() => setShowOlderRuns((v) => !v)}
          style={{
            background: 'transparent',
            border: '1px solid var(--border)',
            borderRadius: 6,
            color: 'var(--text-dim)',
            fontSize: 11,
            padding: '5px 12px',
            cursor: 'pointer',
            textAlign: 'center',
            width: '100%',
            marginTop: 2,
          }}
        >
          {showOlderRuns
            ? `▲ Hide older runs (showing all ${allFailedRuns.length})`
            : `▼ ${olderCount} older run${olderCount !== 1 ? 's' : ''} hidden · Show all`}
        </button>
      )}
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

function RecentlyHealedTable({
  heals,
  onDelete,
}: {
  heals: HealProposal[];
  onDelete?: (healId: string) => void;
}) {
  const recent = heals
    .filter((h) => h.status === 'APPROVED' || h.status === 'AUTO_APPLIED')
    .slice(0, 15);

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
            {['TC', 'Type', 'Confidence', 'Time', 'Status', ''].map((h, i) => (
              <th
                key={i}
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
              <td style={{ padding: '4px 6px', textAlign: 'right' }}>
                {onDelete && (
                  <button
                    onClick={() => onDelete(h.id)}
                    title="Delete this heal record"
                    style={{
                      padding: '2px 7px',
                      borderRadius: 4,
                      background: 'transparent',
                      border: '1px solid var(--border2)',
                      color: 'var(--text-dim)',
                      fontSize: 10,
                      cursor: 'pointer',
                      fontFamily: 'var(--font-ui)',
                      lineHeight: 1,
                    }}
                  >
                    ✕
                  </button>
                )}
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
  const { canAccessHealing: canWrite } = useRBAC();

  const qc = useQueryClient();
  const [detailHeal, setDetailHeal] = useState<HealProposal | null>(null);
  const [healProgress, setHealProgress] = useState<HealInProgressEntry[]>([]);
  const [retryingHealId, setRetryingHealId] = useState<string | null>(null);

  const { data: pendingHeals = [], isLoading: loadingPending } = useHeals(projectId, 'PENDING');
  const { data: exhaustedHeals = [] } = useHeals(projectId, 'EXHAUSTED');
  const { data: inProgressHeals = [] } = useHeals(projectId, 'IN_PROGRESS');
  const { data: allHeals = [] } = useHeals(projectId);
  const { data: stats } = useHealStats(projectId);

  const { mutateAsync: approve, isPending: approving } = useApproveHeal(projectId);
  const { mutateAsync: reject, isPending: rejecting } = useRejectHeal(projectId);
  const { mutateAsync: approveAll, isPending: approvingAll } = useApproveAllConfident(projectId);
  const { mutateAsync: dismissHeal } = useDismissHeal(projectId);
  const { mutateAsync: retryWithContext } = useRetryHealWithContext(projectId);
  const { mutateAsync: cancelHeal } = useCancelHeal(projectId);

  const busy = approving || rejecting;

  // Live healing progress via socket
  useHealSocket({
    onStarted: (data) => {
      if (data.projectId !== projectId) return;
      setHealProgress((prev) => [
        ...prev.filter((e) => e.runResultId !== data.runResultId),
        { runResultId: data.runResultId, tcTitle: data.tcTitle, phase: 'ANALYZING', startedAt: Date.now() },
      ]);
    },
    onProgress: (data) => {
      if (data.projectId !== projectId) return;
      setHealProgress((prev) =>
        prev.map((e) => e.runResultId === data.runResultId ? { ...e, phase: data.phase } : e),
      );
    },
    onPendingCreated: (data) => {
      if (data.projectId !== projectId) return;
      setHealProgress((prev) =>
        prev.map((e) => e.runResultId === data.runResultId ? { ...e, phase: 'COMPLETE' } : e),
      );
      void qc.invalidateQueries({ queryKey: ['heals', projectId] });
      void qc.invalidateQueries({ queryKey: ['heal-stats', projectId] });
    },
    onAutoApplied: (data) => {
      if (data.projectId !== projectId) return;
      if (data.runResultId) {
        setHealProgress((prev) =>
          prev.map((e) => e.runResultId === data.runResultId ? { ...e, phase: 'AUTO_APPLIED' } : e),
        );
      }
      void qc.invalidateQueries({ queryKey: ['heals', projectId] });
      void qc.invalidateQueries({ queryKey: ['heal-stats', projectId] });
    },
  });

  // Polling fallback: seed healProgress from IN_PROGRESS heals (catches socket misses)
  useEffect(() => {
    if (!inProgressHeals.length) return;
    setHealProgress((prev) => {
      const trackedIds = new Set(prev.map((e) => e.runResultId));
      const toAdd = inProgressHeals
        .filter((h) => !trackedIds.has(h.runResultId))
        .map((h) => ({
          runResultId: h.runResultId,
          tcTitle: h.runResult?.testCase.title ?? 'Test',
          phase: 'ANALYZING' as const,
          startedAt: Date.now(),
        }));
      return toAdd.length ? [...prev, ...toAdd] : prev;
    });
  }, [inProgressHeals.map((h) => h.id).join(',')]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-remove COMPLETE/AUTO_APPLIED entries after 4 s
  useEffect(() => {
    const done = healProgress.filter((e) => e.phase === 'COMPLETE' || e.phase === 'AUTO_APPLIED');
    if (done.length === 0) return;
    const timer = setTimeout(() => {
      setHealProgress((prev) => prev.filter((e) => e.phase !== 'COMPLETE' && e.phase !== 'AUTO_APPLIED'));
    }, 4000);
    return () => clearTimeout(timer);
  }, [healProgress.map((e) => e.phase).join(',')]); // eslint-disable-line react-hooks/exhaustive-deps

  async function handleApprove(healId: string, rerun: boolean) {
    try {
      await approve({ healId, rerun });
      toast.success(rerun ? 'Heal approved — test re-queued for verification' : 'Heal approved — script updated');
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  async function handleReject(healId: string) {
    try {
      await reject(healId);
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

  async function handleRetryWithContext(healId: string, userContext: string) {
    try {
      setRetryingHealId(healId);
      await retryWithContext({ healId, userContext });
      toast.success('Re-analyzing with your context — proposal updated');
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setRetryingHealId(null);
    }
  }

  async function handleDismissExhausted(healId: string) {
    try {
      await dismissHeal(healId);
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  async function handleDeleteHeal(healId: string) {
    try {
      await dismissHeal(healId);
      toast.success('Heal record deleted');
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  async function handleCancelHeal(runResultId: string) {
    try {
      await cancelHeal(runResultId);
      setHealProgress((prev) => prev.filter((e) => e.runResultId !== runResultId));
      toast('Heal job cancelled', { icon: '✕' });
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
          canWrite ? (
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
          ) : undefined
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

        {/* ── Healing In Progress ───────────────────────────────────────── */}
        {healProgress.length > 0 && (
          <div
            style={{
              background: 'linear-gradient(135deg, rgba(37,99,171,0.15), rgba(37,99,171,0.08))',
              border: '1px solid rgba(37,99,171,0.4)',
              borderRadius: 12,
              padding: '16px 20px',
            }}
          >
            {/* Header */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
              <span
                style={{
                  width: 9, height: 9, borderRadius: '50%',
                  background: 'var(--cyan)',
                  display: 'inline-block',
                  flexShrink: 0,
                  boxShadow: '0 0 0 3px rgba(37,99,171,0.25)',
                  animation: 'healBlink 1.2s ease-in-out infinite',
                }}
              />
              <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--cyan)', letterSpacing: '0.04em' }}>
                Healing In Progress
              </span>
              <span style={{
                marginLeft: 4,
                background: 'rgba(37,99,171,0.2)',
                color: 'var(--cyan)',
                border: '1px solid rgba(37,99,171,0.35)',
                borderRadius: 10,
                padding: '1px 8px',
                fontSize: 11,
                fontWeight: 600,
              }}>
                {healProgress.length} {healProgress.length !== 1 ? 'tests' : 'test'}
              </span>
            </div>

            {/* Entries */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {healProgress.map((entry) => {
                const phaseOrder: Record<string, number> = { ANALYZING: 0, TRACING: 1, PATCHING: 2, COMPLETE: 3, AUTO_APPLIED: 3 };
                const phaseLabels: Record<string, string> = {
                  ANALYZING: 'Classifying failure',
                  TRACING: 'Running browser trace',
                  PATCHING: 'Generating patch',
                  COMPLETE: 'Proposal ready — review below',
                  AUTO_APPLIED: 'Auto-applied ✓',
                };
                const stepLabels = ['Analyze', 'Trace', 'Patch'];
                const currentStep = phaseOrder[entry.phase] ?? 0;
                const isDone = entry.phase === 'COMPLETE' || entry.phase === 'AUTO_APPLIED';
                const progressPct = isDone ? 100 : Math.round((currentStep / 3) * 100);

                return (
                  <div
                    key={entry.runResultId}
                    style={{
                      background: 'rgba(0,0,0,0.2)',
                      border: '1px solid rgba(37,99,171,0.2)',
                      borderRadius: 8,
                      padding: '12px 16px',
                    }}
                  >
                    {/* Title row */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                      <span style={{
                        fontSize: 13, fontWeight: 600, color: 'var(--text)',
                        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1, minWidth: 0,
                      }}>
                        {entry.tcTitle}
                      </span>
                      <span style={{
                        fontSize: 11,
                        fontFamily: 'var(--font-mono)',
                        color: isDone
                          ? (entry.phase === 'AUTO_APPLIED' ? 'var(--pass)' : 'var(--cyan)')
                          : 'var(--cyan)',
                        flexShrink: 0,
                        fontWeight: 600,
                      }}>
                        {phaseLabels[entry.phase] ?? entry.phase}
                      </span>
                      {!isDone && (
                        <button
                          title="Cancel heal job"
                          onClick={() => handleCancelHeal(entry.runResultId)}
                          style={{
                            flexShrink: 0,
                            width: 22, height: 22,
                            borderRadius: 4,
                            background: 'rgba(220,38,38,0.12)',
                            border: '1px solid rgba(220,38,38,0.3)',
                            color: 'var(--fail)',
                            fontSize: 11,
                            cursor: 'pointer',
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            lineHeight: 1,
                          }}
                        >
                          ✕
                        </button>
                      )}
                    </div>

                    {/* Progress bar */}
                    <div style={{ background: 'rgba(255,255,255,0.08)', borderRadius: 4, height: 7, overflow: 'hidden', marginBottom: 8 }}>
                      <div style={{
                        height: '100%',
                        borderRadius: 4,
                        width: `${Math.max(6, progressPct)}%`,
                        background: isDone
                          ? 'var(--pass)'
                          : 'linear-gradient(90deg, #2563AB, var(--cyan))',
                        transition: 'width 0.6s ease',
                        boxShadow: isDone ? 'none' : '2px 0 8px rgba(37,99,171,0.6)',
                      }} />
                    </div>

                    {/* Step labels */}
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      {stepLabels.map((label, i) => (
                        <span key={label} style={{
                          fontSize: 10,
                          fontFamily: 'var(--font-mono)',
                          fontWeight: currentStep === i ? 700 : 400,
                          color: isDone
                            ? 'var(--pass)'
                            : currentStep > i
                            ? 'var(--cyan)'
                            : currentStep === i
                            ? 'var(--text)'
                            : 'var(--text-dim)',
                        }}>
                          {currentStep > i ? '✓ ' : currentStep === i && !isDone ? '▶ ' : ''}{label}
                        </span>
                      ))}
                      <span style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--text-dim)' }}>
                        {progressPct}%
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
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
          {/* LEFT — Failed Runs only */}
          <div>
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
                  padding: '10px 14px',
                  borderBottom: '1px solid var(--border)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                }}
              >
                <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>
                  🔴 Failed Runs
                </span>
                <span style={{ fontSize: 10, color: 'var(--text-dim)', background: 'var(--surface2)', padding: '1px 7px', borderRadius: 100, marginLeft: 6 }}>
                  Last 7 days
                </span>
                <span style={{ fontSize: 11, color: 'var(--text-dim)', marginLeft: 'auto' }}>
                  Expand a run → select TCs → Heal Selected
                </span>
              </div>
              <div style={{ padding: '10px 12px' }}>
                <FailedRunsPanel
                  projectId={projectId}
                  onHealsQueued={(queued) => {
                    setHealProgress((prev) => [
                      ...prev.filter((e) => !queued.some((q) => q.runResultId === e.runResultId)),
                      ...queued.map((item) => ({
                        runResultId: item.runResultId,
                        tcTitle: item.tcTitle,
                        phase: 'ANALYZING' as const,
                        startedAt: Date.now(),
                      })),
                    ]);
                  }}
                />
              </div>
            </div>
          </div>

          {/* RIGHT — Pending Approval + AI Analysis + Recently Healed */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {/* Pending Approval */}
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
                    padding: '24px 0',
                    lineHeight: 1.8,
                  }}
                >
                  No pending heal proposals.
                  <br />
                  <span style={{ color: 'var(--text-mid)', fontSize: 11 }}>
                    Select failed tests above and click Heal Selected.
                  </span>
                </div>
              ) : (
                pendingHeals.map((h) => (
                  <HealCard
                    key={h.id}
                    heal={h}
                    busy={busy}
                    retrying={retryingHealId === h.id}
                    onApprove={(rerun) => handleApprove(h.id, rerun)}
                    onReject={() => handleReject(h.id)}
                    onRetryWithContext={(ctx) => handleRetryWithContext(h.id, ctx)}
                    canWrite={canWrite}
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

            {/* AI Analysis */}
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

            {/* Recently Healed */}
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
              <RecentlyHealedTable heals={allHeals} onDelete={handleDeleteHeal} />
            </div>
          </div>
        </div>
      </div>

      <style>{`
        @keyframes healBlink {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.25; }
        }
      `}</style>

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
