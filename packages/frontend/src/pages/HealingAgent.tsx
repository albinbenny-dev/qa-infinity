import { useState } from 'react';
import { useParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import Topbar, { TbBtn } from '../components/layout/Topbar';
import { useHeals, useHealStats, useTriggerHeal, useReviewHeal, useApplyHeal } from '../hooks/useHeals';
import { useRuns } from '../hooks/useRuns';
import type { HealProposal } from '../types';
import type { RunListItem } from '../hooks/useRuns';

// ── Constants ──────────────────────────────────────────────────────────────

type TabKey = 'ALL' | 'PENDING' | 'APPROVED' | 'REJECTED' | 'AUTO_APPLIED';

const TYPE_META: Record<HealProposal['type'], { label: string; color: string; bg: string }> = {
  SELECTOR:   { label: 'Selector',   color: '#2563AB', bg: 'rgba(37,99,171,0.12)' },
  FLOW:       { label: 'Flow',       color: '#F47B20', bg: 'rgba(244,123,32,0.12)' },
  API_SCHEMA: { label: 'API Schema', color: '#7C3AED', bg: 'rgba(124,58,237,0.12)' },
};

const STATUS_META: Record<HealProposal['status'], { label: string; color: string }> = {
  PENDING:      { label: 'Pending',      color: '#F47B20' },
  APPROVED:     { label: 'Approved',     color: '#2A9D8F' },
  REJECTED:     { label: 'Rejected',     color: '#DC2626' },
  AUTO_APPLIED: { label: 'Auto-Applied', color: '#2563AB' },
  EXHAUSTED:    { label: 'Exhausted',    color: '#6B7280' },
};

// ── Sub-components ─────────────────────────────────────────────────────────

function TypeBadge({ type }: { type: HealProposal['type'] }) {
  const m = TYPE_META[type];
  return (
    <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase', padding: '2px 7px', borderRadius: 100, background: m.bg, color: m.color }}>
      {m.label}
    </span>
  );
}

function StatusDot({ status }: { status: HealProposal['status'] }) {
  const m = STATUS_META[status];
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, color: m.color, fontWeight: 600 }}>
      <span style={{ width: 6, height: 6, borderRadius: '50%', background: m.color, flexShrink: 0 }} />
      {m.label}
    </span>
  );
}

function ConfBar({ value }: { value: number }) {
  const color = value >= 80 ? '#2A9D8F' : value >= 50 ? '#F47B20' : '#DC2626';
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <div style={{ flex: 1, height: 4, borderRadius: 2, background: 'var(--surface3)' }}>
        <div style={{ width: `${value}%`, height: '100%', borderRadius: 2, background: color, transition: 'width 0.3s' }} />
      </div>
      <span style={{ fontSize: 11, fontWeight: 700, color, minWidth: 30 }}>{value}%</span>
    </div>
  );
}

function StatTile({ label, value, color, accent }: { label: string; value: number; color: string; accent: string }) {
  return (
    <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, padding: '14px 18px', display: 'flex', flexDirection: 'column', gap: 4, position: 'relative', overflow: 'hidden' }}>
      <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 4, background: accent, borderRadius: '10px 10px 0 0' }} />
      <div style={{ fontSize: 26, fontWeight: 800, color }}>{value}</div>
      <div style={{ fontSize: 11, color: 'var(--text-mid)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em' }}>{label}</div>
    </div>
  );
}

// ── Diff viewer ────────────────────────────────────────────────────────────

function DiffViewer({ original, patched }: { original: string; patched: string }) {
  const origLines = original.split('\n');
  const patchLines = patched.split('\n');
  const maxLen = Math.max(origLines.length, patchLines.length);

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 0, border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden', fontSize: 11, fontFamily: 'var(--font-mono)' }}>
      <div style={{ background: 'var(--surface3)', padding: '6px 12px', borderBottom: '1px solid var(--border)', color: 'var(--text-mid)', fontWeight: 600, fontSize: 10, letterSpacing: '0.05em', textTransform: 'uppercase' }}>Original</div>
      <div style={{ background: 'var(--surface3)', padding: '6px 12px', borderBottom: '1px solid var(--border)', borderLeft: '1px solid var(--border)', color: 'var(--text-mid)', fontWeight: 600, fontSize: 10, letterSpacing: '0.05em', textTransform: 'uppercase' }}>Patched</div>

      <div style={{ overflow: 'auto', maxHeight: 380, background: 'var(--surface)' }}>
        {Array.from({ length: maxLen }, (_, i) => {
          const orig = origLines[i] ?? null;
          const patch = patchLines[i] ?? null;
          const changed = orig !== patch;
          return (
            <div key={i} style={{ padding: '1px 12px', whiteSpace: 'pre', background: changed && orig !== null ? 'rgba(220,38,38,0.10)' : 'transparent', color: orig === null ? 'transparent' : 'var(--text)', borderBottom: '1px solid rgba(255,255,255,0.02)', lineHeight: '18px' }}>
              <span style={{ color: 'var(--text-dim)', userSelect: 'none', marginRight: 12, fontSize: 10 }}>{String(i + 1).padStart(3, ' ')}</span>
              {orig ?? ''}
            </div>
          );
        })}
      </div>

      <div style={{ overflow: 'auto', maxHeight: 380, background: 'var(--surface)', borderLeft: '1px solid var(--border)' }}>
        {Array.from({ length: maxLen }, (_, i) => {
          const orig = origLines[i] ?? null;
          const patch = patchLines[i] ?? null;
          const changed = orig !== patch;
          return (
            <div key={i} style={{ padding: '1px 12px', whiteSpace: 'pre', background: changed && patch !== null ? 'rgba(42,157,143,0.12)' : 'transparent', color: patch === null ? 'transparent' : 'var(--text)', borderBottom: '1px solid rgba(255,255,255,0.02)', lineHeight: '18px' }}>
              <span style={{ color: 'var(--text-dim)', userSelect: 'none', marginRight: 12, fontSize: 10 }}>{String(i + 1).padStart(3, ' ')}</span>
              {patch ?? ''}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Trigger modal ──────────────────────────────────────────────────────────

function TriggerModal({ projectId, onClose }: { projectId: string; onClose: () => void }) {
  const { data, isLoading } = useRuns(projectId);
  const { mutateAsync: trigger, isPending: triggering } = useTriggerHeal(projectId);

  const failedRuns: RunListItem[] = (data?.runs ?? []).filter((r: RunListItem) => r.status === 'FAILED');

  async function handleTrigger(run: RunListItem) {
    try {
      const res = await trigger({ runId: run.id });
      toast.success(`Queued ${res.count} heal job${res.count !== 1 ? 's' : ''} for "${run.name}"`);
      onClose();
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={onClose}>
      <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, padding: 24, width: 480, maxHeight: '70vh', overflow: 'auto' }} onClick={e => e.stopPropagation()}>
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)', marginBottom: 4 }}>Trigger Healing Analysis</div>
          <div style={{ fontSize: 12, color: 'var(--text-dim)' }}>Select a failed run to analyse and generate heal proposals.</div>
        </div>
        {isLoading ? (
          <div style={{ color: 'var(--text-dim)', fontSize: 12, textAlign: 'center', padding: '20px 0' }}>Loading runs…</div>
        ) : failedRuns.length === 0 ? (
          <div style={{ color: 'var(--text-dim)', fontSize: 12, textAlign: 'center', padding: '20px 0' }}>No failed runs found.</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {failedRuns.map(run => (
              <div key={run.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px', background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 8 }}>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>{run.name}</div>
                  <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 2 }}>{run.environment} · {run.triggerType}</div>
                </div>
                <button disabled={triggering} onClick={() => handleTrigger(run)} style={{ padding: '5px 14px', borderRadius: 6, background: 'var(--cyan)', color: '#0a0e17', border: 'none', cursor: 'pointer', fontWeight: 700, fontSize: 12 }}>
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

// ── Main page ──────────────────────────────────────────────────────────────

export default function HealingAgent() {
  const { slug } = useParams<{ slug: string }>();
  const projectId = slug!;

  const [tab, setTab] = useState<TabKey>('ALL');
  const [selected, setSelected] = useState<HealProposal | null>(null);
  const [showTrigger, setShowTrigger] = useState(false);

  const { data: heals = [], isLoading } = useHeals(projectId, tab === 'ALL' ? undefined : tab);
  const { data: stats } = useHealStats(projectId);
  const { mutateAsync: review, isPending: reviewing } = useReviewHeal(projectId);
  const { mutateAsync: apply, isPending: applying } = useApplyHeal(projectId);

  async function handleReview(action: 'APPROVED' | 'REJECTED') {
    if (!selected) return;
    try {
      await review({ healId: selected.id, action });
      toast.success(action === 'APPROVED' ? 'Heal approved' : 'Heal rejected');
      setSelected(null);
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  async function handleApply() {
    if (!selected) return;
    try {
      await apply(selected.id);
      toast.success('Patch applied to script');
      setSelected(null);
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  const TABS: { key: TabKey; label: string; count?: number }[] = [
    { key: 'ALL',          label: 'All',          count: stats?.total },
    { key: 'PENDING',      label: 'Pending',      count: stats?.pending },
    { key: 'APPROVED',     label: 'Approved',     count: stats?.approved },
    { key: 'REJECTED',     label: 'Rejected',     count: stats?.rejected },
    { key: 'AUTO_APPLIED', label: 'Auto-Applied', count: stats?.autoApplied },
  ];

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <Topbar
        breadcrumbs={[{ label: 'Healing Agent' }]}
        actions={
          <TbBtn variant="primary" onClick={() => setShowTrigger(true)}>
            ⟳ Trigger Healing
          </TbBtn>
        }
      />

      <div style={{ flex: 1, overflow: 'auto', padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 20 }}>

        {/* Stats */}
        {stats && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
            <StatTile label="Pending"      value={stats.pending}      color="var(--6d-orange)" accent="linear-gradient(90deg,#FFB347,#F47B20)" />
            <StatTile label="Approved"     value={stats.approved}     color="#2A9D8F"          accent="linear-gradient(90deg,#2A9D8F,#1a7a6e)" />
            <StatTile label="Rejected"     value={stats.rejected}     color="#DC2626"          accent="linear-gradient(90deg,#DC2626,#b91c1c)" />
            <StatTile label="Auto-Applied" value={stats.autoApplied}  color="var(--cyan)"      accent="linear-gradient(90deg,#2563AB,#0A2A57)" />
          </div>
        )}

        {/* Tab bar */}
        <div style={{ display: 'flex', gap: 2, borderBottom: '1px solid var(--border)' }}>
          {TABS.map(t => (
            <button key={t.key} onClick={() => { setTab(t.key); setSelected(null); }}
              style={{ padding: '7px 14px', background: 'none', border: 'none', cursor: 'pointer', fontSize: 12, fontWeight: tab === t.key ? 700 : 500, color: tab === t.key ? 'var(--cyan)' : 'var(--text-dim)', borderBottom: tab === t.key ? '2px solid var(--cyan)' : '2px solid transparent', marginBottom: -1, display: 'flex', alignItems: 'center', gap: 5 }}
            >
              {t.label}
              {t.count !== undefined && t.count > 0 && (
                <span style={{ fontSize: 10, background: tab === t.key ? 'rgba(34,211,238,0.15)' : 'var(--surface3)', color: tab === t.key ? 'var(--cyan)' : 'var(--text-dim)', padding: '1px 6px', borderRadius: 100, fontWeight: 700 }}>
                  {t.count}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* List + detail */}
        <div style={{ display: 'grid', gridTemplateColumns: selected ? '340px 1fr' : '1fr', gap: 16, alignItems: 'start' }}>

          {/* Heal list */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {isLoading ? (
              <div style={{ color: 'var(--text-dim)', fontSize: 12, textAlign: 'center', padding: '40px 0' }}>Analysing…</div>
            ) : heals.length === 0 ? (
              <div style={{ color: 'var(--text-dim)', fontSize: 12, textAlign: 'center', padding: '40px 0', lineHeight: 1.8 }}>
                No heal proposals yet.<br />
                <span style={{ color: 'var(--text-mid)' }}>Run tests with failures, then click <strong>Trigger Healing</strong>.</span>
              </div>
            ) : heals.map(h => (
              <div key={h.id} onClick={() => setSelected(h)}
                style={{ padding: '12px 14px', background: 'var(--surface)', border: `1px solid ${selected?.id === h.id ? 'var(--cyan)' : 'var(--border)'}`, borderRadius: 10, cursor: 'pointer' }}
              >
                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8, marginBottom: 6 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)', lineHeight: 1.35 }}>{h.runResult?.testCase.title ?? 'Unknown Test'}</div>
                  <StatusDot status={h.status} />
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
                  <TypeBadge type={h.type} />
                  <span style={{ fontSize: 10, color: 'var(--text-dim)', fontFamily: 'var(--font-mono)' }}>{h.runResult?.testCase.tcId}</span>
                </div>
                <ConfBar value={h.confidence} />
                <div style={{ marginTop: 6, fontSize: 10, color: 'var(--text-dim)' }}>{h.runResult?.run.name} · {h.runResult?.run.environment}</div>
              </div>
            ))}
          </div>

          {/* Detail panel */}
          {selected && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, padding: 20 }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
                <div>
                  <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)', marginBottom: 4 }}>{selected.runResult?.testCase.title}</div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <TypeBadge type={selected.type} />
                    <StatusDot status={selected.status} />
                    <span style={{ fontSize: 10, color: 'var(--text-dim)', fontFamily: 'var(--font-mono)' }}>{selected.runResult?.testCase.tcId}</span>
                  </div>
                </div>
                <button onClick={() => setSelected(null)} style={{ background: 'none', border: 'none', color: 'var(--text-dim)', cursor: 'pointer', fontSize: 18, lineHeight: 1 }}>✕</button>
              </div>

              <div>
                <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-dim)', marginBottom: 5 }}>AI Confidence</div>
                <ConfBar value={selected.confidence} />
              </div>

              {selected.runResult?.errorMessage && (
                <div>
                  <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-dim)', marginBottom: 5 }}>Error</div>
                  <div style={{ background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', borderRadius: 7, padding: '8px 12px', fontSize: 11, fontFamily: 'var(--font-mono)', color: '#f87171', whiteSpace: 'pre-wrap', maxHeight: 80, overflow: 'auto' }}>
                    {selected.runResult.errorMessage}
                  </div>
                </div>
              )}

              <div>
                <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-dim)', marginBottom: 8 }}>Code Diff</div>
                <DiffViewer original={selected.originalCode} patched={selected.patchedCode} />
              </div>

              {selected.status === 'PENDING' && (
                <div style={{ display: 'flex', gap: 8 }}>
                  <button disabled={reviewing} onClick={() => handleReview('APPROVED')}
                    style={{ flex: 1, padding: '8px 0', background: 'rgba(42,157,143,0.15)', border: '1px solid rgba(42,157,143,0.3)', color: '#2A9D8F', borderRadius: 7, fontWeight: 700, fontSize: 12, cursor: 'pointer' }}>
                    ✓ Approve
                  </button>
                  <button disabled={applying} onClick={handleApply}
                    style={{ flex: 1, padding: '8px 0', background: 'rgba(37,99,171,0.15)', border: '1px solid rgba(37,99,171,0.3)', color: 'var(--cyan)', borderRadius: 7, fontWeight: 700, fontSize: 12, cursor: 'pointer' }}>
                    ⟳ Auto-Apply
                  </button>
                  <button disabled={reviewing} onClick={() => handleReview('REJECTED')}
                    style={{ flex: 1, padding: '8px 0', background: 'rgba(220,38,38,0.10)', border: '1px solid rgba(220,38,38,0.25)', color: '#DC2626', borderRadius: 7, fontWeight: 700, fontSize: 12, cursor: 'pointer' }}>
                    ✕ Reject
                  </button>
                </div>
              )}

              {selected.status !== 'PENDING' && (
                <div style={{ textAlign: 'center', fontSize: 11, color: 'var(--text-dim)', padding: '4px 0' }}>
                  This heal is <strong style={{ color: STATUS_META[selected.status].color }}>{STATUS_META[selected.status].label}</strong>.
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {showTrigger && <TriggerModal projectId={projectId} onClose={() => setShowTrigger(false)} />}
    </div>
  );
}
