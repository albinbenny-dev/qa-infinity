import React, { useState, useCallback, useRef, useEffect, useLayoutEffect, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import Editor from '@monaco-editor/react';
import toast from 'react-hot-toast';
import { useQueryClient } from '@tanstack/react-query';
import Topbar, { TbBtn } from '../components/layout/Topbar';
import FileTree from '../components/scripts/FileTree';
import EditorTabs from '../components/scripts/EditorTabs';
import { useProject } from '../hooks/useProjects';
import { useRBAC } from '../hooks/useRBAC';
import { useTestCases, useUseCases } from '../hooks/useTestCases';
import {
  useScripts,
  useSaveScriptContent,
  useDeleteScript,
  useUploadScript,
  useUploadScriptWithExtract,
} from '../hooks/useScripts';
import { useScriptJobs } from '../hooks/useScriptJobs';
import { useExecutionStore } from '../stores/executionStore';
import { api } from '../lib/api';
import type { Script, TestCase, ScriptJob, ScriptJobPhase } from '../types';

// ── Domain constants ────────────────────────────────────────────────────────

const AIRTEL_USE_CASES = [
  'Primary Sales', 'Stock Management', 'Dealer Onboarding & KYC',
  'Sales API', 'Secondary Sales', 'Distributor API',
];
const UC_COLORS: Record<string, string> = {
  'Primary Sales':           'var(--violet)',
  'Stock Management':        'var(--amber)',
  'Dealer Onboarding & KYC': 'var(--emerald)',
  'Sales API':               'var(--cyan)',
  'Secondary Sales':         'var(--rose)',
  'Distributor API':         'var(--sky)',
};
const UC_FALLBACKS = ['--violet', '--cyan', '--emerald', '--amber', '--rose', '--sky'];

function ucColor(name: string, idx: number) {
  return UC_COLORS[name] ?? `var(${UC_FALLBACKS[idx % UC_FALLBACKS.length]})`;
}

function buildGroups(allTCs: TestCase[], useCases: string[]) {
  const map = new Map<string, TestCase[]>();
  AIRTEL_USE_CASES.forEach((uc) => map.set(uc, []));
  useCases.filter((uc) => !AIRTEL_USE_CASES.includes(uc)).forEach((uc) => map.set(uc, []));
  for (const tc of allTCs) {
    const key = tc.useCaseTag ?? 'Uncategorised';
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(tc);
  }
  return Array.from(map.entries())
    .filter(([, tcs]) => tcs.length > 0)
    .map(([name, tcs], i) => ({ name, tcs, color: ucColor(name, i) }));
}

// ── Types ───────────────────────────────────────────────────────────────────

interface GenerateApiResponse {
  queued: Array<{ scriptJobId: string; testCaseId: string; tcId: string; title: string; type: string; useCaseTag?: string | null; withHeal: boolean; phase: ScriptJobPhase }>;
  errors: Array<{ testCaseId: string; error: string }>;
  withHeal: boolean;
}

// Phases the user thinks of as "done" — gate the dismiss button + final colors
const TERMINAL_PHASES: ScriptJobPhase[] = ['VERIFIED', 'GENERATED', 'MANUAL_REVIEW', 'FAILED'];

interface PhaseMeta { icon: string; color: string; bg: string; label: (j: ScriptJob) => string }
const PHASE_META: Record<ScriptJobPhase, PhaseMeta> = {
  QUEUED:         { icon: '○',  color: 'var(--text-dim)', bg: 'transparent',           label: () => 'queued' },
  GENERATING:     { icon: '⏳', color: 'var(--amber)',    bg: 'rgba(245,158,11,0.05)', label: () => 'generating…' },
  GENERATED:      { icon: '✓',  color: 'var(--emerald)',  bg: 'rgba(42,157,143,0.05)', label: () => 'generated' },
  QUEUED_VERIFY:  { icon: '○',  color: 'var(--cyan)',     bg: 'rgba(34,211,238,0.05)', label: () => 'waiting to verify' },
  VERIFYING:      { icon: '🔬', color: 'var(--cyan)',     bg: 'rgba(34,211,238,0.06)', label: (j) => `verifying… (attempt ${j.healAttempts + 1}/${j.maxHealAttempts + 1})` },
  HEALING:        { icon: '🩹', color: 'var(--violet)',   bg: 'rgba(139,92,246,0.06)', label: (j) => `healing… (${j.healAttempts}/${j.maxHealAttempts})` },
  VERIFIED:       { icon: '✓',  color: 'var(--emerald)',  bg: 'rgba(42,157,143,0.05)', label: () => 'verified' },
  MANUAL_REVIEW:  { icon: '⚠',  color: 'var(--amber)',    bg: 'rgba(245,158,11,0.06)', label: () => 'manual review' },
  FAILED:         { icon: '✕',  color: 'var(--fail)',     bg: 'rgba(220,38,38,0.05)',  label: () => 'failed' },
};

// ── TCScriptRow ─────────────────────────────────────────────────────────────

const TYPE_CHIP: Record<string, { bg: string; color: string }> = {
  UI:  { bg: 'var(--rose-dim)',    color: 'var(--rose)' },
  API: { bg: 'var(--cyan-dim)',    color: 'var(--cyan)' },
  SIT: { bg: 'var(--emerald-dim)', color: 'var(--emerald)' },
};

function TCScriptRow({
  tc, isScripted, isSelected, verificationStatus, suspectedIssue, isGolden, onToggle, onOpen, onToggleGolden,
}: {
  tc: TestCase;
  isScripted: boolean;
  isSelected: boolean;
  verificationStatus?: 'NOT_VERIFIED' | 'VERIFIED' | 'MANUAL_REVIEW';
  suspectedIssue?: string | null;
  isGolden?: boolean;
  onToggle: () => void;
  onOpen: () => void;
  onToggleGolden?: () => void;
}) {
  const chip = TYPE_CHIP[tc.type] ?? { bg: 'var(--surface3)', color: 'var(--text-dim)' };
  const needsReview = isScripted && verificationStatus === 'MANUAL_REVIEW';
  const verified = isScripted && verificationStatus === 'VERIFIED';

  return (
    <div
      onClick={!isScripted ? onToggle : undefined}
      style={{
        display: 'flex', alignItems: 'center', gap: 6,
        padding: '6px 10px 6px 24px',
        borderBottom: '1px solid var(--border)',
        cursor: isScripted ? 'default' : 'pointer',
        background: isSelected
          ? 'rgba(37,99,171,0.08)'
          : isScripted
          ? 'rgba(42,157,143,0.04)'
          : 'transparent',
        transition: 'background 0.1s',
      }}
    >
      {/* Status icon / checkbox */}
      {isScripted ? (
        <span
          title={needsReview ? (suspectedIssue ?? 'Manual review needed') : (verified ? 'Verified live' : 'Scripted')}
          style={{
            width: 15, height: 15, borderRadius: 3,
            background: needsReview
              ? 'rgba(245,158,11,0.18)'
              : verified
              ? 'var(--emerald-dim)'
              : 'rgba(120,120,120,0.18)',
            border: needsReview
              ? '1px solid rgba(245,158,11,0.45)'
              : verified
              ? '1px solid rgba(42,157,143,0.35)'
              : '1px solid var(--border)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 9, color: needsReview ? 'var(--amber)' : verified ? 'var(--emerald)' : 'var(--text-dim)',
            fontWeight: 700, flexShrink: 0,
          }}
        >{needsReview ? '⚠' : '✓'}</span>
      ) : (
        <div
          className={`tc-checkbox${isSelected ? ' checked' : ''}`}
          style={{ fontSize: 9, flexShrink: 0 }}
          onClick={(e) => { e.stopPropagation(); onToggle(); }}
        >
          {isSelected ? '✓' : ''}
        </div>
      )}

      {/* Title + TC ID */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontSize: 11,
          fontWeight: isScripted ? 400 : 600,
          color: isScripted ? 'var(--text-dim)' : 'var(--text)',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {tc.title}
        </div>
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--text-dim)', marginTop: 1 }}>
          {tc.tcId}
        </div>
      </div>

      {/* Type badge */}
      <span style={{
        fontSize: 8, fontWeight: 700, padding: '2px 5px', borderRadius: 3,
        background: chip.bg, color: chip.color,
        flexShrink: 0, fontFamily: 'var(--font-ui)',
      }}>
        {tc.type}
      </span>

      {/* Golden star — only for scripted TCs */}
      {isScripted ? (
        <button
          onClick={(e) => { e.stopPropagation(); onToggleGolden?.(); }}
          title={isGolden ? 'Golden example — click to unmark' : 'Mark as golden example for few-shot AI generation'}
          style={{
            width: 18, height: 18, borderRadius: 3, padding: 0,
            background: isGolden ? 'rgba(245,158,11,0.15)' : 'transparent',
            border: isGolden ? '1px solid rgba(245,158,11,0.4)' : '1px solid transparent',
            color: isGolden ? 'var(--amber)' : 'var(--text-dim)',
            fontSize: 11, cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
            transition: 'all 0.15s',
          }}
        >{isGolden ? '★' : '☆'}</button>
      ) : (
        <div style={{ width: 18, flexShrink: 0 }} />
      )}

      {/* Open button for scripted */}
      {isScripted ? (
        <button
          onClick={(e) => { e.stopPropagation(); onOpen(); }}
          title="Open script in editor"
          style={{
            width: 20, height: 20, borderRadius: 3,
            background: 'rgba(37,99,171,0.1)', border: '1px solid rgba(37,99,171,0.2)',
            color: 'var(--cyan)', fontSize: 10, cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
          }}
        >↗</button>
      ) : (
        <div style={{ width: 20, flexShrink: 0 }} />
      )}
    </div>
  );
}

// ── QueueJobRow ─────────────────────────────────────────────────────────────

function QueueJobRow({ job, onRetry }: { job: ScriptJob; onRetry?: (j: ScriptJob) => void }) {
  const meta = PHASE_META[job.phase];
  const tcTitle = job.testCase?.title ?? '(test case)';
  const tcId = job.testCase?.tcId ?? job.testCaseId.slice(0, 8);
  const type = job.testCase?.type ?? 'UI';
  const chip = TYPE_CHIP[type] ?? { bg: 'var(--surface3)', color: 'var(--text-dim)' };

  const isAnimating = job.phase === 'GENERATING' || job.phase === 'VERIFYING' || job.phase === 'HEALING';
  const isTerminal = TERMINAL_PHASES.includes(job.phase);
  const isRetryable = job.phase === 'FAILED' || job.phase === 'MANUAL_REVIEW';

  return (
    <div
      style={{
        display: 'flex', alignItems: 'flex-start', gap: 8,
        padding: '7px 12px',
        borderBottom: '1px solid var(--border)',
        background: meta.bg,
        transition: 'background 0.3s',
      }}
    >
      {/* Status icon */}
      <span style={{
        fontSize: isAnimating ? 13 : 10,
        color: meta.color, flexShrink: 0, marginTop: 2,
        fontWeight: isTerminal ? 700 : 400,
      }}>
        {meta.icon}
      </span>

      {/* Text */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontSize: 11, fontWeight: 600,
          color: job.phase === 'VERIFIED' || job.phase === 'GENERATED' ? 'var(--text-dim)' : 'var(--text)',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {tcTitle}
        </div>
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: 9, marginTop: 1, display: 'flex', gap: 4, alignItems: 'center' }}>
          <span style={{ color: 'var(--text-dim)' }}>{tcId}</span>
          <span style={{ color: meta.color }}>· {meta.label(job)}</span>
          {job.phase === 'MANUAL_REVIEW' && job.suspectedIssue && (
            <span style={{
              color: 'var(--amber)', marginLeft: 4, fontStyle: 'italic',
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1, minWidth: 0,
            }}>
              {job.suspectedIssue}
            </span>
          )}
          {job.phase === 'FAILED' && job.lastError && (
            <span style={{ color: 'var(--fail)', marginLeft: 4 }}>{job.lastError.slice(0, 80)}</span>
          )}
        </div>
      </div>

      {/* Type chip */}
      <span style={{
        fontSize: 8, fontWeight: 700, padding: '2px 5px', borderRadius: 3,
        background: chip.bg, color: chip.color,
        flexShrink: 0, fontFamily: 'var(--font-ui)',
      }}>
        {type}
      </span>

      {/* Retry button — only for terminal failure states */}
      {isRetryable && onRetry && (
        <button
          onClick={() => onRetry(job)}
          title="Retry with feedback"
          style={{
            padding: '2px 7px', fontSize: 9, fontWeight: 700, flexShrink: 0,
            background: 'rgba(139,92,246,0.1)', border: '1px solid rgba(139,92,246,0.3)',
            borderRadius: 4, color: 'var(--violet)', cursor: 'pointer',
            fontFamily: 'var(--font-ui)', lineHeight: '14px',
          }}
        >
          ↺ Retry
        </button>
      )}
    </div>
  );
}

// ── EmptyEditor ─────────────────────────────────────────────────────────────

function EmptyEditor() {
  return (
    <div style={{
      flex: 1, display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center',
      gap: 12, color: 'rgba(226,232,240,0.3)', userSelect: 'none',
    }}>
      <div style={{ fontSize: 48, lineHeight: 1 }}>⌨</div>
      <div style={{ fontSize: 16, fontWeight: 700, color: 'rgba(226,232,240,0.5)' }}>
        No file open
      </div>
      <div style={{ fontSize: 12, textAlign: 'center', maxWidth: 280, lineHeight: 1.6 }}>
        Select a TC row on the left to open its script, or generate new scripts.
      </div>
    </div>
  );
}

// ── Shared modal shell ───────────────────────────────────────────────────────

const MODAL_OVERLAY: React.CSSProperties = {
  position: 'fixed', inset: 0, zIndex: 1000,
  background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(2px)',
  display: 'flex', alignItems: 'center', justifyContent: 'center',
};
const MODAL_BOX: React.CSSProperties = {
  background: 'var(--surface)', border: '1px solid var(--border)',
  borderRadius: 10, width: 480, maxWidth: '92vw',
  boxShadow: '0 24px 64px rgba(0,0,0,0.5)',
  display: 'flex', flexDirection: 'column', overflow: 'hidden',
};
const MODAL_HEADER: React.CSSProperties = {
  padding: '14px 18px', borderBottom: '1px solid var(--border)',
  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
};
const MODAL_BODY: React.CSSProperties = { padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 14 };
const MODAL_FOOTER: React.CSSProperties = {
  padding: '12px 18px', borderTop: '1px solid var(--border)',
  display: 'flex', justifyContent: 'flex-end', gap: 8,
};
const TEXTAREA_STYLE: React.CSSProperties = {
  width: '100%', minHeight: 90, padding: '8px 10px',
  background: 'var(--surface2)', border: '1px solid var(--border)',
  borderRadius: 6, color: 'var(--text)', fontSize: 12,
  fontFamily: 'var(--font-mono)', resize: 'vertical', lineHeight: 1.5,
  boxSizing: 'border-box',
};
const LABEL_STYLE: React.CSSProperties = { fontSize: 11, fontWeight: 700, color: 'var(--text-mid)', marginBottom: 4, display: 'block' };
const BTN_CANCEL: React.CSSProperties = {
  padding: '7px 16px', borderRadius: 6, border: '1px solid var(--border)',
  background: 'transparent', color: 'var(--text-mid)', fontSize: 12,
  fontWeight: 600, cursor: 'pointer', fontFamily: 'var(--font-ui)',
};

// ── GenerateContextModal ─────────────────────────────────────────────────────

interface GenerateContextModalProps {
  count: number;
  withHeal: boolean;
  initialNote: string; // pre-populated from stored hints when count === 1
  onConfirm: (opts: { withHeal: boolean; contextNote: string; saveHints: boolean }) => void;
  onClose: () => void;
  onImportInstead?: () => void;
}

function GenerateContextModal({ count, withHeal: initHeal, initialNote, onConfirm, onClose, onImportInstead }: GenerateContextModalProps) {
  const [heal, setHeal] = useState(initHeal);
  const [note, setNote] = useState(initialNote);
  const [save, setSave] = useState(false);
  const [busy, setBusy] = useState(false);

  async function handleSubmit() {
    setBusy(true);
    await onConfirm({ withHeal: heal, contextNote: note, saveHints: save });
    setBusy(false);
  }

  return (
    <div style={MODAL_OVERLAY} onClick={onClose}>
      <div style={MODAL_BOX} onClick={(e) => e.stopPropagation()}>
        <div style={MODAL_HEADER}>
          <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>
            {heal ? '🩹' : '⚡'} Generate {count} Script{count !== 1 ? 's' : ''}
          </span>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--text-dim)', fontSize: 16, cursor: 'pointer', lineHeight: 1 }}>×</button>
        </div>

        <div style={MODAL_BODY}>
          {/* Mode toggle */}
          <div>
            <span style={LABEL_STYLE}>Mode</span>
            <div style={{ display: 'flex', gap: 8 }}>
              {([false, true] as const).map((v) => (
                <button
                  key={String(v)}
                  onClick={() => setHeal(v)}
                  style={{
                    flex: 1, padding: '7px 10px', borderRadius: 6, cursor: 'pointer', fontSize: 11,
                    fontWeight: 700, fontFamily: 'var(--font-ui)',
                    border: heal === v
                      ? (v ? '1px solid rgba(139,92,246,0.6)' : '1px solid rgba(37,99,171,0.6)')
                      : '1px solid var(--border)',
                    background: heal === v
                      ? (v ? 'rgba(139,92,246,0.12)' : 'rgba(37,99,171,0.1)')
                      : 'transparent',
                    color: heal === v ? (v ? 'var(--violet)' : 'var(--cyan)') : 'var(--text-dim)',
                    transition: 'all 0.15s',
                  }}
                >
                  {v ? '🩹 Generate + Heal' : '⚡ Generate only'}
                </button>
              ))}
            </div>
            {heal && (
              <p style={{ fontSize: 10, color: 'var(--text-dim)', margin: '6px 0 0', lineHeight: 1.5 }}>
                Each script is live-tested after generation and auto-healed up to 2 times.
              </p>
            )}
          </div>

          {/* Context note */}
          <div>
            <span style={LABEL_STYLE}>Additional context for the script agent <span style={{ fontWeight: 400, color: 'var(--text-dim)' }}>(optional)</span></span>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder={'Hints about selectors, routes, login flow, or anything the agent should know...\n\nExamples:\n• The primary sales route is /sales/primary-orders\n• Submit button selector: #kc-login\n• After login wait for the project selector modal'}
              style={TEXTAREA_STYLE}
              autoFocus
            />
          </div>

          {/* Save hints checkbox */}
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', userSelect: 'none' }}>
            <input type="checkbox" checked={save} onChange={(e) => setSave(e.target.checked)} style={{ width: 14, height: 14, accentColor: 'var(--violet)', cursor: 'pointer' }} />
            <span style={{ fontSize: 11, color: 'var(--text-mid)' }}>
              Save as default hints for {count === 1 ? 'this test case' : 'these test cases'} (auto-populated next time)
            </span>
          </label>
        </div>

        <div style={{ ...MODAL_FOOTER, justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center' }}>
            {onImportInstead && (
              <button
                onClick={() => { onClose(); onImportInstead(); }}
                style={{
                  background: 'none', border: 'none', cursor: 'pointer',
                  color: 'var(--text-dim)', fontSize: 11, padding: '4px 0',
                  textDecoration: 'underline', fontFamily: 'var(--font-ui)',
                }}
                title="Import a manually generated .spec.ts file instead of AI generation"
              >
                ⬆ Import script instead
              </button>
            )}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={onClose} style={BTN_CANCEL}>Cancel</button>
            <button
              onClick={handleSubmit}
              disabled={busy}
              style={{
                padding: '7px 18px', borderRadius: 6, border: 'none', cursor: busy ? 'wait' : 'pointer',
                fontSize: 12, fontWeight: 700, fontFamily: 'var(--font-ui)', color: '#fff',
                background: heal
                  ? 'linear-gradient(135deg, var(--violet), var(--cyan))'
                  : 'linear-gradient(135deg, var(--violet), var(--6d-orange-deep))',
                opacity: busy ? 0.7 : 1,
              }}
            >
              {busy ? 'Queuing…' : (heal ? '🩹 Generate + Heal' : '⚡ Generate')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── RetryFeedbackModal ───────────────────────────────────────────────────────

interface RetryFeedbackModalProps {
  job: ScriptJob;
  onConfirm: (opts: { contextNote: string; withHeal: boolean; saveHints: boolean }) => void;
  onClose: () => void;
}

function RetryFeedbackModal({ job, onConfirm, onClose }: RetryFeedbackModalProps) {
  const [note, setNote] = useState('');
  const [heal, setHeal] = useState(job.withHeal);
  const [save, setSave] = useState(false);
  const [busy, setBusy] = useState(false);

  const errorText = job.suspectedIssue ?? job.lastError ?? null;

  async function handleSubmit() {
    setBusy(true);
    await onConfirm({ contextNote: note, withHeal: heal, saveHints: save });
    setBusy(false);
  }

  return (
    <div style={MODAL_OVERLAY} onClick={onClose}>
      <div style={MODAL_BOX} onClick={(e) => e.stopPropagation()}>
        <div style={MODAL_HEADER}>
          <div>
            <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>↺ Retry with Feedback</span>
            <div style={{ fontSize: 10, color: 'var(--text-dim)', marginTop: 2, fontFamily: 'var(--font-mono)' }}>
              {job.testCase?.tcId} — {job.testCase?.title ?? '(test case)'}
            </div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--text-dim)', fontSize: 16, cursor: 'pointer', lineHeight: 1 }}>×</button>
        </div>

        <div style={MODAL_BODY}>
          {/* Last error */}
          {errorText && (
            <div>
              <span style={LABEL_STYLE}>Last error</span>
              <div style={{
                padding: '8px 10px', borderRadius: 6, fontSize: 11, fontFamily: 'var(--font-mono)',
                background: 'rgba(220,38,38,0.07)', border: '1px solid rgba(220,38,38,0.2)',
                color: 'var(--fail)', lineHeight: 1.5, wordBreak: 'break-word',
              }}>
                {errorText}
              </div>
            </div>
          )}

          {/* Context note */}
          <div>
            <span style={LABEL_STYLE}>What to fix / additional context</span>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder={'Describe what went wrong and how to fix it...\n\nExamples:\n• The route is /sales/primary, not /primary-sales\n• Use getByRole("button", { name: "Submit" }) not #btn-submit\n• After login navigate to /projects first'}
              style={{ ...TEXTAREA_STYLE, minHeight: 100 }}
              autoFocus
            />
          </div>

          {/* Save hints + mode row */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', userSelect: 'none' }}>
              <input type="checkbox" checked={save} onChange={(e) => setSave(e.target.checked)} style={{ width: 14, height: 14, accentColor: 'var(--violet)', cursor: 'pointer' }} />
              <span style={{ fontSize: 11, color: 'var(--text-mid)' }}>Save as default hints for this test case</span>
            </label>

            <div style={{ display: 'flex', gap: 8 }}>
              {([false, true] as const).map((v) => (
                <button
                  key={String(v)}
                  onClick={() => setHeal(v)}
                  style={{
                    flex: 1, padding: '6px 8px', borderRadius: 6, cursor: 'pointer', fontSize: 10,
                    fontWeight: 700, fontFamily: 'var(--font-ui)',
                    border: heal === v
                      ? (v ? '1px solid rgba(139,92,246,0.6)' : '1px solid rgba(37,99,171,0.6)')
                      : '1px solid var(--border)',
                    background: heal === v
                      ? (v ? 'rgba(139,92,246,0.12)' : 'rgba(37,99,171,0.1)')
                      : 'transparent',
                    color: heal === v ? (v ? 'var(--violet)' : 'var(--cyan)') : 'var(--text-dim)',
                    transition: 'all 0.15s',
                  }}
                >
                  {v ? '🩹 + Heal' : '⚡ Generate only'}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div style={MODAL_FOOTER}>
          <button onClick={onClose} style={BTN_CANCEL}>Cancel</button>
          <button
            onClick={handleSubmit}
            disabled={busy}
            style={{
              padding: '7px 18px', borderRadius: 6, border: 'none', cursor: busy ? 'wait' : 'pointer',
              fontSize: 12, fontWeight: 700, fontFamily: 'var(--font-ui)', color: '#fff',
              background: 'linear-gradient(135deg, var(--violet), var(--cyan))',
              opacity: busy ? 0.7 : 1,
            }}
          >
            {busy ? 'Queuing…' : '↺ Retry'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── RegenerateModal ──────────────────────────────────────────────────────────

interface RegenerateModalProps {
  script: Script;
  tc: TestCase | undefined;
  onConfirm: (opts: { withHeal: boolean; contextNote: string; saveHints: boolean }) => void;
  onClose: () => void;
}

function RegenerateModal({ script, tc, onConfirm, onClose }: RegenerateModalProps) {
  const [note, setNote] = useState(tc?.generationHints ?? '');
  const [heal, setHeal] = useState(false);
  const [save, setSave] = useState(false);
  const [busy, setBusy] = useState(false);

  async function handleSubmit() {
    setBusy(true);
    await onConfirm({ withHeal: heal, contextNote: note, saveHints: save });
    setBusy(false);
  }

  return (
    <div style={MODAL_OVERLAY} onClick={onClose}>
      <div style={MODAL_BOX} onClick={(e) => e.stopPropagation()}>
        <div style={MODAL_HEADER}>
          <div>
            <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>↺ Regenerate Script</span>
            <div style={{ fontSize: 10, color: 'var(--text-dim)', marginTop: 2, fontFamily: 'var(--font-mono)' }}>
              {tc ? `${tc.tcId} — ${tc.title}` : script.filename}
            </div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--text-dim)', fontSize: 16, cursor: 'pointer', lineHeight: 1 }}>×</button>
        </div>

        <div style={MODAL_BODY}>
          {/* Context note */}
          <div>
            <span style={LABEL_STYLE}>
              What needs to be corrected{' '}
              <span style={{ fontWeight: 400, color: 'var(--text-dim)' }}>(optional — guides the script agent)</span>
            </span>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder={'Describe what to fix or improve...\n\nExamples:\n• The submit button selector should be input[type="submit"] not #btn-login\n• After login navigate to /projects before checking the dashboard\n• The route is /#/FinanceUserListReport not /finance/reports\n• Login is two-step: enter username → click Login → enter password → click Login again'}
              style={{ ...TEXTAREA_STYLE, minHeight: 130 }}
              autoFocus
            />
          </div>

          {/* Save hints checkbox */}
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', userSelect: 'none' }}>
            <input
              type="checkbox"
              checked={save}
              onChange={(e) => setSave(e.target.checked)}
              style={{ width: 14, height: 14, accentColor: 'var(--violet)', cursor: 'pointer' }}
            />
            <span style={{ fontSize: 11, color: 'var(--text-mid)' }}>
              Save as default hints for this test case (auto-populated on future regenerations)
            </span>
          </label>

          {/* Mode toggle */}
          <div>
            <span style={LABEL_STYLE}>Mode</span>
            <div style={{ display: 'flex', gap: 8 }}>
              {([false, true] as const).map((v) => (
                <button
                  key={String(v)}
                  onClick={() => setHeal(v)}
                  style={{
                    flex: 1, padding: '7px 10px', borderRadius: 6, cursor: 'pointer', fontSize: 11,
                    fontWeight: 700, fontFamily: 'var(--font-ui)',
                    border: heal === v
                      ? (v ? '1px solid rgba(139,92,246,0.6)' : '1px solid rgba(245,158,11,0.5)')
                      : '1px solid var(--border)',
                    background: heal === v
                      ? (v ? 'rgba(139,92,246,0.12)' : 'rgba(245,158,11,0.08)')
                      : 'transparent',
                    color: heal === v ? (v ? 'var(--violet)' : 'var(--amber)') : 'var(--text-dim)',
                    transition: 'all 0.15s',
                  }}
                >
                  {v ? '🩹 Regenerate + Heal' : '↺ Regenerate only'}
                </button>
              ))}
            </div>
            {heal && (
              <p style={{ fontSize: 10, color: 'var(--text-dim)', margin: '6px 0 0', lineHeight: 1.5 }}>
                The new script will be live-tested and auto-healed up to 2 times after generation.
              </p>
            )}
          </div>
        </div>

        <div style={MODAL_FOOTER}>
          <button onClick={onClose} style={BTN_CANCEL}>Cancel</button>
          <button
            onClick={handleSubmit}
            disabled={busy}
            style={{
              padding: '7px 18px', borderRadius: 6, border: 'none', cursor: busy ? 'wait' : 'pointer',
              fontSize: 12, fontWeight: 700, fontFamily: 'var(--font-ui)', color: '#fff',
              background: heal
                ? 'linear-gradient(135deg, var(--amber), var(--violet))'
                : 'linear-gradient(135deg, var(--amber), var(--6d-orange-deep))',
              opacity: busy ? 0.7 : 1,
            }}
          >
            {busy ? 'Queuing…' : (heal ? '🩹 Regenerate + Heal' : '↺ Regenerate')}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── ImportScriptModal ────────────────────────────────────────────────────────

type ImportMode = 'create' | 'link' | 'standalone';

interface ImportScriptModalProps {
  projectId: string;
  testCases: TestCase[];
  preSelectedTcId?: string;
  onClose: () => void;
}

function ImportScriptModal({ projectId, testCases, preSelectedTcId, onClose }: ImportScriptModalProps) {
  const { slug } = useParams<{ slug: string }>();
  const navigate = useNavigate();
  const [importMode, setImportMode] = useState<ImportMode>(preSelectedTcId ? 'link' : 'create');
  const [selectedTcId, setSelectedTcId] = useState(preSelectedTcId ?? '');
  const [file, setFile] = useState<File | null>(null);
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const upload = useUploadScript(projectId);
  const uploadWithExtract = useUploadScriptWithExtract(projectId);

  const filteredTCs = useMemo(() => {
    const q = search.toLowerCase();
    return testCases
      .filter((tc) => tc.title.toLowerCase().includes(q) || tc.tcId.toLowerCase().includes(q))
      .slice(0, 40);
  }, [testCases, search]);

  async function handleImport() {
    if (!file) { toast.error('Select a .spec.ts or .spec.js file first'); return; }
    setBusy(true);
    try {
      if (importMode === 'create') {
        const result = await uploadWithExtract.mutateAsync(file);
        toast.success(
          `Test case ${result.testCase.tcId} created from script!`,
          { duration: 6000 },
        );
        onClose();
        navigate(`/projects/${slug}/tc-library`);
      } else {
        const tcId = importMode === 'link' ? (selectedTcId || undefined) : undefined;
        await upload.mutateAsync({ file, testCaseId: tcId });
        const linked = tcId ? testCases.find((tc) => tc.id === tcId) : null;
        toast.success(linked ? `Imported and linked to ${linked.tcId}` : `Imported ${file.name}`);
        onClose();
      }
    } catch {
      toast.error('Import failed');
    }
    setBusy(false);
  }

  const INPUT_STYLE_SM: React.CSSProperties = {
    width: '100%', padding: '7px 10px', background: 'var(--surface2)',
    border: '1px solid var(--border)', borderRadius: 6, color: 'var(--text)',
    fontSize: 11, outline: 'none', boxSizing: 'border-box', fontFamily: 'var(--font-ui)',
  };

  const MODE_OPTS: { value: ImportMode; label: string; desc: string }[] = [
    { value: 'create', label: 'Create TC from script', desc: 'QA Infinity extracts the test case automatically' },
    { value: 'link',   label: 'Link to existing TC',  desc: 'Choose a TC from your library' },
    { value: 'standalone', label: 'Import standalone', desc: 'No TC — custom script only' },
  ];

  return (
    <div style={MODAL_OVERLAY} onClick={onClose}>
      <div style={MODAL_BOX} onClick={(e) => e.stopPropagation()}>
        <div style={MODAL_HEADER}>
          <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>⬆ Import Script</span>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--text-dim)', fontSize: 16, cursor: 'pointer', lineHeight: 1 }}>×</button>
        </div>

        <div style={MODAL_BODY}>
          {/* Mode selector */}
          <div>
            <span style={LABEL_STYLE}>Import Mode</span>
            <div style={{ display: 'flex', gap: 6 }}>
              {MODE_OPTS.map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => setImportMode(opt.value)}
                  style={{
                    flex: 1, padding: '7px 6px', borderRadius: 6, cursor: 'pointer',
                    fontSize: 10, fontWeight: 700, fontFamily: 'var(--font-ui)',
                    border: importMode === opt.value ? '1px solid rgba(139,92,246,0.6)' : '1px solid var(--border)',
                    background: importMode === opt.value ? 'rgba(139,92,246,0.12)' : 'transparent',
                    color: importMode === opt.value ? 'var(--violet)' : 'var(--text-dim)',
                    transition: 'all 0.15s', textAlign: 'center',
                  }}
                >
                  {opt.label}
                </button>
              ))}
            </div>
            <p style={{ fontSize: 10, color: 'var(--text-dim)', margin: '5px 0 0', lineHeight: 1.5 }}>
              {MODE_OPTS.find(o => o.value === importMode)?.desc}
              {importMode === 'create' && (
                <span style={{ color: 'var(--violet)', marginLeft: 4 }}>
                  — TC will be created in DRAFT status for review in TC Library.
                </span>
              )}
            </p>
          </div>

          {/* File picker */}
          <div>
            <span style={LABEL_STYLE}>Script File <span style={{ color: '#f87171', fontWeight: 400 }}>*</span></span>
            <button
              onClick={() => fileRef.current?.click()}
              style={{
                width: '100%', padding: '18px 12px',
                border: `2px dashed ${file ? 'var(--violet)' : 'var(--border)'}`,
                borderRadius: 8, background: file ? 'rgba(139,92,246,0.06)' : 'transparent',
                cursor: 'pointer', color: file ? 'var(--text)' : 'var(--text-dim)',
                fontSize: 12, fontFamily: 'var(--font-ui)', textAlign: 'center',
                transition: 'all 0.15s',
              }}
            >
              {file ? `📄 ${file.name}` : '+ Click to select .spec.ts or .spec.js'}
            </button>
            <input
              ref={fileRef}
              type="file"
              accept=".spec.ts,.spec.js"
              style={{ display: 'none' }}
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
          </div>

          {/* TC selector — only shown in 'link' mode */}
          {importMode === 'link' && <div>
            <span style={LABEL_STYLE}>Link to Test Case <span style={{ fontWeight: 400, color: 'var(--text-dim)' }}>(optional)</span></span>
            <input
              type="text"
              placeholder="Search by title or TC ID…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={INPUT_STYLE_SM}
            />
            <div style={{
              maxHeight: 160, overflowY: 'auto', marginTop: 4,
              border: '1px solid var(--border)', borderRadius: 6,
              background: 'var(--surface2)',
            }}>
              <div
                onClick={() => setSelectedTcId('')}
                style={{
                  padding: '7px 10px', cursor: 'pointer', fontSize: 11,
                  background: !selectedTcId ? 'rgba(37,99,171,0.18)' : 'transparent',
                  color: !selectedTcId ? 'var(--cyan)' : 'var(--text-dim)',
                  borderBottom: '1px solid var(--border)',
                }}
              >
                None — upload as unlinked custom script
              </div>
              {filteredTCs.map((tc) => (
                <div
                  key={tc.id}
                  onClick={() => setSelectedTcId(tc.id)}
                  style={{
                    padding: '7px 10px', cursor: 'pointer', fontSize: 11,
                    background: selectedTcId === tc.id ? 'rgba(37,99,171,0.18)' : 'transparent',
                    color: selectedTcId === tc.id ? 'var(--cyan)' : 'var(--text-mid)',
                    display: 'flex', gap: 8, alignItems: 'baseline',
                  }}
                >
                  <span style={{ color: 'var(--text-dim)', flexShrink: 0 }}>{tc.tcId}</span>
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{tc.title}</span>
                </div>
              ))}
              {filteredTCs.length === 0 && search && (
                <div style={{ padding: '8px 10px', color: 'var(--text-dim)', fontSize: 11 }}>No matches</div>
              )}
            </div>
            {selectedTcId && (
              <p style={{ fontSize: 10, color: 'var(--text-dim)', margin: '5px 0 0', lineHeight: 1.5 }}>
                Any existing script for this test case will be replaced.
              </p>
            )}
          </div>}
        </div>

        <div style={MODAL_FOOTER}>
          <button onClick={onClose} style={BTN_CANCEL}>Cancel</button>
          <button
            onClick={handleImport}
            disabled={!file || busy}
            style={{
              padding: '7px 18px', borderRadius: 6, border: 'none',
              cursor: !file || busy ? 'not-allowed' : 'pointer',
              fontSize: 12, fontWeight: 700, fontFamily: 'var(--font-ui)', color: '#fff',
              background: importMode === 'create'
                ? 'linear-gradient(135deg, var(--violet), var(--emerald))'
                : 'linear-gradient(135deg, var(--violet), var(--cyan))',
              opacity: !file || busy ? 0.55 : 1,
              transition: 'opacity 0.15s',
            }}
          >
            {busy
              ? (importMode === 'create' ? 'Extracting TC…' : 'Importing…')
              : (importMode === 'create' ? '⬆ Import & Create TC' : '⬆ Import')}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Main page ───────────────────────────────────────────────────────────────

export default function Scripts() {
  const { slug } = useParams<{ slug: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { canWrite } = useRBAC();

  const { data: project } = useProject(slug);
  const projectId = project?.id;

  const { data: scripts = [], isLoading: scriptsLoading } = useScripts(projectId);
  const { data: tcData, isLoading: tcsLoading } = useTestCases(projectId, { limit: 500 });
  const { data: useCases = [] } = useUseCases(projectId);

  const save = useSaveScriptContent(projectId ?? '');
  const deleteScript = useDeleteScript(projectId ?? '');
  const { setSelected: setExecutionSelected } = useExecutionStore();

  // ── Derived data ─────────────────────────────────────────────────────────

  const allTCs = tcData?.testCases ?? [];

  const tcIdToScript = useMemo(() => {
    const m = new Map<string, Script>();
    for (const s of scripts) {
      if (s.testCaseId) m.set(s.testCaseId, s);
    }
    return m;
  }, [scripts]);

  const scriptedTcIds = useMemo(() => new Set(tcIdToScript.keys()), [tcIdToScript]);
  const pendingCount = allTCs.filter((tc) => !scriptedTcIds.has(tc.id)).length;

  const groups = useMemo(() => buildGroups(allTCs, useCases), [allTCs, useCases]);

  // ── Left panel state ─────────────────────────────────────────────────────

  const [leftTab, setLeftTab] = useState<'tcs' | 'scripts'>('tcs');
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(
    new Set(AIRTEL_USE_CASES),
  );
  const [tcSelected, setTcSelected] = useState<Set<string>>(new Set());

  // ── Resizable left panel ─────────────────────────────────────────────────

  const [leftPanelWidth, setLeftPanelWidth] = useState(() => Math.floor((window.innerWidth - 180) * 0.35));
  const leftPanelWidthRef = useRef(Math.floor((window.innerWidth - 180) * 0.35));
  const isDraggingRef = useRef(false);
  const dragStartXRef = useRef(0);
  const dragStartWidthRef = useRef(0);
  const dividerRef = useRef<HTMLDivElement>(null);

  const handleDividerMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isDraggingRef.current = true;
    dragStartXRef.current = e.clientX;
    dragStartWidthRef.current = leftPanelWidthRef.current;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  }, []);

  useLayoutEffect(() => {
    const onMouseMove = (e: MouseEvent) => {
      if (!isDraggingRef.current) return;
      const delta = e.clientX - dragStartXRef.current;
      const next = Math.min(Math.floor(window.innerWidth * 0.75), Math.max(240, dragStartWidthRef.current + delta));
      leftPanelWidthRef.current = next;
      if (dividerRef.current) {
        const panel = dividerRef.current.previousElementSibling as HTMLElement | null;
        if (panel) panel.style.width = `${next}px`;
      }
    };
    const onMouseUp = () => {
      if (!isDraggingRef.current) return;
      isDraggingRef.current = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      setLeftPanelWidth(leftPanelWidthRef.current);
    };
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
  }, []);

  // ── Queue state (server-driven via socket) ───────────────────────────────

  const { jobs: queueJobs, clear: clearFinishedJobs, clearAll: clearAllJobs } = useScriptJobs(projectId);

  // Fire toasts when script jobs reach a terminal phase
  const prevJobPhasesRef = useRef<Record<string, string>>({});
  useEffect(() => {
    const prev = prevJobPhasesRef.current;
    for (const job of queueJobs) {
      const prevPhase = prev[job.id];
      const phase = job.phase;
      if (prevPhase !== phase) {
        if (phase === 'GENERATED') {
          toast.success(`Script regenerated: ${job.testCase?.tcId ?? job.id}`);
        } else if (phase === 'VERIFIED') {
          toast.success(`Script regenerated & verified: ${job.testCase?.tcId ?? job.id}`);
        } else if (phase === 'MANUAL_REVIEW') {
          toast(`Script needs manual review: ${job.testCase?.tcId ?? job.id}`, { icon: '⚠️' });
        } else if (phase === 'FAILED') {
          toast.error(`Regeneration failed: ${job.lastError ?? 'unknown error'}`);
        }
      }
    }
    prevJobPhasesRef.current = Object.fromEntries(queueJobs.map((j) => [j.id, j.phase]));
  }, [queueJobs]);

  // "Generate with Heal" toggle — defaults OFF every page load (no persistence)
  const [withHeal, setWithHeal] = useState(false);

  // ── Generate context modal state ─────────────────────────────────────────

  const [showGenModal, setShowGenModal] = useState(false);
  const [genModalInitNote, setGenModalInitNote] = useState('');

  // ── Retry feedback modal state ────────────────────────────────────────────

  const [retryJob, setRetryJob] = useState<ScriptJob | null>(null);

  // ── Regenerate modal state ────────────────────────────────────────────────

  const [showRegenModal, setShowRegenModal] = useState(false);

  // ── Import script modal state ─────────────────────────────────────────────

  const [showImportModal, setShowImportModal] = useState(false);
  const [importPreTcId, setImportPreTcId] = useState('');

  function handleOpenImport(tcId = '') {
    setImportPreTcId(tcId);
    setShowImportModal(true);
  }

  const queueVisible = queueJobs.length > 0;
  const queueDone = queueJobs.filter((j) => j.phase === 'VERIFIED' || j.phase === 'GENERATED').length;
  const queueManualReview = queueJobs.filter((j) => j.phase === 'MANUAL_REVIEW').length;
  const queueErrors = queueJobs.filter((j) => j.phase === 'FAILED').length;
  const queueFinished = queueDone + queueManualReview + queueErrors;
  const queueAllDone = queueVisible && queueFinished === queueJobs.length;
  const queueProgress = queueJobs.length > 0 ? queueFinished / queueJobs.length : 0;
  const isQueuing = queueVisible && !queueAllDone;

  // ── Editor tab state ─────────────────────────────────────────────────────

  const [openTabs, setOpenTabs] = useState<Script[]>([]);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);
  const [tabContents, setTabContents] = useState<Record<string, string>>({});
  const [dirtyTabs, setDirtyTabs] = useState<Set<string>>(new Set());
  const [loadingContent, setLoadingContent] = useState(false);

  const activeScript = openTabs.find((t) => t.id === activeTabId) ?? null;
  const activeContent = activeTabId ? (tabContents[activeTabId] ?? '') : '';
  const activeTc = allTCs.find((tc) => tc.id === activeScript?.testCaseId) ?? undefined;

  // ── Open a tab ───────────────────────────────────────────────────────────

  const openTab = useCallback(
    async (script: Script) => {
      setActiveTabId(script.id);
      if (!openTabs.find((t) => t.id === script.id)) {
        setOpenTabs((prev) => [...prev, script]);
      }
      if (!tabContents[script.id] && projectId) {
        setLoadingContent(true);
        try {
          const res = await api.get<{ content: string }>(
            `/projects/${projectId}/scripts/${script.id}/content`,
          );
          setTabContents((prev) => ({ ...prev, [script.id]: res.data.content }));
        } catch {
          toast.error('Failed to load script content');
        } finally {
          setLoadingContent(false);
        }
      }
    },
    [openTabs, tabContents, projectId],
  );

  // ── Close a tab ──────────────────────────────────────────────────────────

  const closeTab = useCallback(
    (id: string) => {
      setOpenTabs((prev) => {
        const next = prev.filter((t) => t.id !== id);
        if (activeTabId === id) setActiveTabId(next.length > 0 ? next[next.length - 1].id : null);
        return next;
      });
      setTabContents((prev) => { const n = { ...prev }; delete n[id]; return n; });
      setDirtyTabs((prev) => { const n = new Set(prev); n.delete(id); return n; });
    },
    [activeTabId],
  );

  // ── Save current tab ─────────────────────────────────────────────────────

  const saveActiveTab = useCallback(async () => {
    if (!activeTabId || !dirtyTabs.has(activeTabId)) return;
    try {
      await save.mutateAsync({ scriptId: activeTabId, content: tabContents[activeTabId] ?? '' });
      setDirtyTabs((prev) => { const n = new Set(prev); n.delete(activeTabId); return n; });
      toast.success('Saved');
    } catch {
      toast.error('Save failed');
    }
  }, [activeTabId, dirtyTabs, tabContents, save]);

  // ── Ctrl+S ───────────────────────────────────────────────────────────────

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') { e.preventDefault(); saveActiveTab(); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [saveActiveTab]);

  // ── Open TC's script in editor ────────────────────────────────────────────

  function handleOpenTCScript(tcDbId: string) {
    const script = tcIdToScript.get(tcDbId);
    if (script) openTab(script);
  }

  // ── TC selection ─────────────────────────────────────────────────────────

  function handleTCToggle(tcDbId: string) {
    if (scriptedTcIds.has(tcDbId)) return;
    setTcSelected((prev) => {
      const n = new Set(prev);
      if (n.has(tcDbId)) n.delete(tcDbId); else n.add(tcDbId);
      return n;
    });
  }

  function handleGroupSelect(groupTCs: TestCase[]) {
    const pending = groupTCs.filter((tc) => !scriptedTcIds.has(tc.id)).map((tc) => tc.id);
    const allSel = pending.every((id) => tcSelected.has(id));
    setTcSelected((prev) => {
      const n = new Set(prev);
      if (allSel) pending.forEach((id) => n.delete(id));
      else pending.forEach((id) => n.add(id));
      return n;
    });
  }

  function handleSelectAllPending() {
    const all = allTCs.filter((tc) => !scriptedTcIds.has(tc.id)).map((tc) => tc.id);
    setTcSelected((prev) => {
      const allSel = all.every((id) => prev.has(id));
      return allSel ? new Set() : new Set(all);
    });
  }

  function toggleGroupExpand(name: string) {
    setExpandedGroups((prev) => {
      const n = new Set(prev);
      if (n.has(name)) n.delete(name); else n.add(name);
      return n;
    });
  }

  // ── Queue generate — opens modal first ───────────────────────────────────

  function handleQueueGenerate() {
    if (!projectId || tcSelected.size === 0) return;
    // Pre-populate hints if exactly 1 TC selected and it has stored hints
    if (tcSelected.size === 1) {
      const [singleId] = tcSelected;
      const tc = allTCs.find((t) => t.id === singleId);
      setGenModalInitNote(tc?.generationHints ?? '');
    } else {
      setGenModalInitNote('');
    }
    setShowGenModal(true);
  }

  async function handleModalConfirmGenerate(opts: { withHeal: boolean; contextNote: string; saveHints: boolean }) {
    if (!projectId || tcSelected.size === 0) return;
    const ids = Array.from(tcSelected);
    setShowGenModal(false);
    setTcSelected(new Set());

    // Save hints to each selected TC if requested
    if (opts.saveHints && opts.contextNote.trim()) {
      const tcsToSave = allTCs.filter((tc) => ids.includes(tc.id));
      await Promise.allSettled(
        tcsToSave.map((tc) =>
          api.patch(`/projects/${projectId}/test-cases/${tc.tcId}/hints`, { hints: opts.contextNote.trim() }),
        ),
      );
      void qc.invalidateQueries({ queryKey: ['testCases', projectId] });
    }

    try {
      await api.post<GenerateApiResponse>(
        `/projects/${projectId}/scripts/generate`,
        { testCaseIds: ids, withHeal: opts.withHeal, contextNote: opts.contextNote || undefined },
        { timeout: 30_000 },
      );
      toast.success(
        opts.withHeal
          ? `Queued ${ids.length} script${ids.length !== 1 ? 's' : ''} (generate + heal)`
          : `Queued ${ids.length} script${ids.length !== 1 ? 's' : ''}`,
      );
    } catch (err) {
      const msg = (err as Error)?.message ?? 'Failed to enqueue';
      toast.error(msg);
    }
  }

  // Refresh Scripts list when jobs reach a terminal phase so the TC rows update
  const lastTerminalCount = useRef(0);
  useEffect(() => {
    const finished = queueJobs.filter((j) => TERMINAL_PHASES.includes(j.phase)).length;
    if (finished !== lastTerminalCount.current) {
      lastTerminalCount.current = finished;
      if (projectId) {
        void qc.invalidateQueries({ queryKey: ['scripts', projectId] });
      }
    }
  }, [queueJobs, projectId, qc]);

  async function dismissQueue() {
    await clearFinishedJobs();
  }

  // ── Retry with feedback ───────────────────────────────────────────────────

  async function handleRetryConfirm(opts: { contextNote: string; withHeal: boolean; saveHints: boolean }) {
    if (!projectId || !retryJob) return;
    const job = retryJob;
    setRetryJob(null);
    try {
      await api.post(
        `/projects/${projectId}/scripts/jobs/${job.id}/retry`,
        { contextNote: opts.contextNote || undefined, withHeal: opts.withHeal, saveHints: opts.saveHints },
        { timeout: 30_000 },
      );
      toast.success('Retry queued');
    } catch (err) {
      const msg = (err as any)?.response?.data?.error ?? (err as Error)?.message ?? 'Failed to retry';
      toast.error(msg);
    }
  }

  // ── Regenerate active script ──────────────────────────────────────────────

  async function handleRegenConfirm(opts: { withHeal: boolean; contextNote: string; saveHints: boolean }) {
    if (!projectId || !activeScript?.testCaseId) return;
    setShowRegenModal(false);

    if (opts.saveHints && opts.contextNote.trim() && activeTc) {
      await api.patch(
        `/projects/${projectId}/test-cases/${activeTc.tcId}/hints`,
        { hints: opts.contextNote.trim() },
      ).catch(() => {});
      void qc.invalidateQueries({ queryKey: ['testCases', projectId] });
    }

    try {
      await api.post<GenerateApiResponse>(
        `/projects/${projectId}/scripts/generate`,
        { testCaseIds: [activeScript.testCaseId], withHeal: opts.withHeal, contextNote: opts.contextNote || undefined },
        { timeout: 30_000 },
      );
      toast.success(opts.withHeal ? '↺ Regenerating with heal…' : '↺ Regenerating…');
    } catch (err) {
      const msg = (err as Error)?.message ?? 'Failed to regenerate';
      toast.error(msg);
    }
  }

  // ── Toggle golden ─────────────────────────────────────────────────────────

  async function handleToggleGolden(scriptId: string) {
    if (!projectId) return;
    try {
      await api.patch(`/projects/${projectId}/scripts/${scriptId}/golden`);
      await qc.invalidateQueries({ queryKey: ['scripts', projectId] });
    } catch {
      toast.error('Failed to update golden status');
    }
  }

  // ── Delete ────────────────────────────────────────────────────────────────

  async function handleDelete(script: Script) {
    if (!window.confirm(`Delete "${script.filename}"?`)) return;
    try {
      await deleteScript.mutateAsync(script.id);
      closeTab(script.id);
      toast.success('Deleted');
    } catch {
      toast.error('Delete failed');
    }
  }


  // ── Send to execution ─────────────────────────────────────────────────────

  function handleSendToExecution() {
    const tcIds = openTabs.map((t) => t.testCaseId).filter((id): id is string => Boolean(id));
    if (tcIds.length === 0) { toast('No linked test cases in open tabs'); return; }
    setExecutionSelected(tcIds);
    navigate(`/projects/${slug}/execution`);
  }

  // ── Status bar ────────────────────────────────────────────────────────────

  const statusMeta = scripts.find((s) => s.id === activeTabId);
  const statusSize = statusMeta?.size ? `${(statusMeta.size / 1024).toFixed(1)} KB` : null;
  const statusDirty = dirtyTabs.has(activeTabId ?? '');

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      {/* Generate context modal */}
      {showGenModal && (
        <GenerateContextModal
          count={tcSelected.size}
          withHeal={withHeal}
          initialNote={genModalInitNote}
          onConfirm={handleModalConfirmGenerate}
          onClose={() => setShowGenModal(false)}
          onImportInstead={tcSelected.size === 1
            ? () => handleOpenImport([...tcSelected][0])
            : () => handleOpenImport()
          }
        />
      )}

      {/* Retry feedback modal */}
      {retryJob && (
        <RetryFeedbackModal
          job={retryJob}
          onConfirm={handleRetryConfirm}
          onClose={() => setRetryJob(null)}
        />
      )}

      {/* Regenerate modal */}
      {showRegenModal && activeScript && (
        <RegenerateModal
          script={activeScript}
          tc={activeTc}
          onConfirm={handleRegenConfirm}
          onClose={() => setShowRegenModal(false)}
        />
      )}

      {/* Import script modal */}
      {showImportModal && projectId && (
        <ImportScriptModal
          projectId={projectId}
          testCases={allTCs.filter((tc) => !scriptedTcIds.has(tc.id))}
          preSelectedTcId={importPreTcId}
          onClose={() => setShowImportModal(false)}
        />
      )}

      {/* Topbar */}
      <Topbar
        breadcrumbs={[
          { label: 'Projects', href: '/projects' },
          { label: project?.name ?? slug ?? '', href: `/projects/${slug}/dashboard` },
          { label: '⌨ Script Agent' },
        ]}
        actions={
          <>
            <button
              onClick={() => setWithHeal((v) => !v)}
              title={
                withHeal
                  ? 'Each generated script will be live-tested and auto-healed (up to 2 attempts) before finalizing'
                  : 'Generate only — no live verification or healing'
              }
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 6,
                padding: '6px 10px', borderRadius: 6, cursor: 'pointer',
                border: withHeal ? '1px solid rgba(139,92,246,0.5)' : '1px solid var(--border)',
                background: withHeal
                  ? 'linear-gradient(135deg, rgba(139,92,246,0.15), rgba(34,211,238,0.15))'
                  : 'transparent',
                color: withHeal ? 'var(--violet)' : 'var(--text-mid)',
                fontSize: 11, fontWeight: 700, fontFamily: 'var(--font-ui)',
                transition: 'all 0.15s',
              }}
            >
              <span
                style={{
                  width: 22, height: 12, borderRadius: 8, position: 'relative',
                  background: withHeal ? 'var(--violet)' : 'var(--surface3)',
                  transition: 'background 0.15s',
                }}
              >
                <span
                  style={{
                    position: 'absolute', top: 1, left: withHeal ? 11 : 1,
                    width: 10, height: 10, borderRadius: '50%',
                    background: '#fff',
                    transition: 'left 0.15s',
                  }}
                />
              </span>
              🩹 Generate with Heal
            </button>
            {canWrite && (
              <TbBtn variant="ghost" onClick={() => handleOpenImport()}>
                ⬆ Import Script
              </TbBtn>
            )}
            <TbBtn
              variant="ghost"
              onClick={async () => {
                if (!projectId) return;
                try {
                  const res = await api.get(`/projects/${projectId}/scripts/context-guide`, { responseType: 'blob' });
                  const url = URL.createObjectURL(new Blob([res.data as BlobPart], { type: 'text/markdown' }));
                  const a = document.createElement('a');
                  a.href = url;
                  a.download = `qa-infinity-guide-${slug ?? projectId}.md`;
                  a.click();
                  URL.revokeObjectURL(url);
                } catch {
                  toast.error('Failed to download script guide');
                }
              }}
              title="Download project-specific guide for Claude Desktop — use when credits are exhausted"
            >
              📋 Script Guide
            </TbBtn>
            <TbBtn variant="primary" onClick={handleSendToExecution}>
              → Send to Execution
            </TbBtn>
          </>
        }
      />

      {/* 2-column body */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>

        {/* ── LEFT PANEL ──────────────────────────────────────────────────── */}
        <div style={{
          width: leftPanelWidth, flexShrink: 0,
          display: 'flex', flexDirection: 'column', overflow: 'hidden',
          background: 'var(--surface)',
        }}>
          {/* Accent stripe */}
          <div style={{ height: 3, background: 'linear-gradient(90deg, var(--violet), var(--cyan))', flexShrink: 0 }} />

          {/* Tab bar */}
          <div style={{
            display: 'flex', borderBottom: '1px solid var(--border)',
            flexShrink: 0, background: 'var(--surface2)',
          }}>
            <button
              onClick={() => setLeftTab('tcs')}
              style={{
                flex: 1, padding: '9px 10px', border: 'none', cursor: 'pointer',
                background: leftTab === 'tcs' ? 'var(--surface)' : 'transparent',
                borderBottom: leftTab === 'tcs' ? '2px solid var(--6d-orange)' : '2px solid transparent',
                color: leftTab === 'tcs' ? 'var(--text)' : 'var(--text-dim)',
                fontSize: 11, fontWeight: 700, fontFamily: 'var(--font-ui)',
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5,
                transition: 'all 0.15s',
              }}
            >
              📋 Test Cases
              {pendingCount > 0 && (
                <span style={{
                  fontSize: 9, fontWeight: 700, padding: '1px 5px', borderRadius: 10,
                  background: 'var(--violet)', color: 'white', lineHeight: '14px',
                }}>
                  {pendingCount}
                </span>
              )}
            </button>
            <button
              onClick={() => setLeftTab('scripts')}
              style={{
                flex: 1, padding: '9px 10px', border: 'none', cursor: 'pointer',
                background: leftTab === 'scripts' ? 'var(--surface)' : 'transparent',
                borderBottom: leftTab === 'scripts' ? '2px solid var(--cyan)' : '2px solid transparent',
                color: leftTab === 'scripts' ? 'var(--text)' : 'var(--text-dim)',
                fontSize: 11, fontWeight: 700, fontFamily: 'var(--font-ui)',
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5,
                transition: 'all 0.15s',
              }}
            >
              📄 Scripts
              {scripts.length > 0 && (
                <span style={{
                  fontSize: 9, fontWeight: 700, padding: '1px 5px', borderRadius: 10,
                  background: 'var(--surface3)', color: 'var(--text-dim)', lineHeight: '14px',
                }}>
                  {scripts.length}
                </span>
              )}
            </button>
          </div>

          {/* ── TEST CASES TAB ── */}
          {leftTab === 'tcs' && (
            <>
              {/* Queue view */}
              {queueVisible ? (
                <div style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden' }}>
                  {/* Queue header */}
                  <div style={{ padding: '10px 12px', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                      <span style={{ fontSize: 12, fontWeight: 700, color: queueAllDone ? 'var(--emerald)' : 'var(--amber)' }}>
                        {queueAllDone
                          ? '✅ Generation Complete'
                          : (queueJobs.some((j) => j.phase === 'HEALING' || j.phase === 'VERIFYING')
                              ? '🩹 Verifying & Healing…'
                              : '⚡ Generating Scripts…')}
                      </span>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-dim)' }}>
                          {queueFinished} / {queueJobs.length}
                        </span>
                        <button
                          onClick={clearAllJobs}
                          title="Force clear all jobs (including stuck ones)"
                          style={{
                            padding: '2px 7px', fontSize: 9, fontWeight: 700,
                            background: 'rgba(220,38,38,0.1)', border: '1px solid rgba(220,38,38,0.3)',
                            borderRadius: 4, color: 'var(--fail)', cursor: 'pointer',
                            fontFamily: 'var(--font-ui)',
                          }}
                        >
                          ✕ Cancel All
                        </button>
                      </div>
                    </div>
                    {/* Progress bar */}
                    <div style={{ height: 5, background: 'var(--surface3)', borderRadius: 3, overflow: 'hidden', marginBottom: 4 }}>
                      <div style={{
                        height: '100%', borderRadius: 3,
                        background: queueErrors > 0
                          ? 'linear-gradient(90deg, var(--emerald), var(--amber))'
                          : 'linear-gradient(90deg, var(--emerald), var(--cyan))',
                        width: `${queueProgress * 100}%`,
                        transition: 'width 0.5s ease',
                      }} />
                    </div>
                    {(queueErrors > 0 || queueManualReview > 0) && (
                      <div style={{ fontSize: 10, fontFamily: 'var(--font-mono)', display: 'flex', gap: 8 }}>
                        <span style={{ color: 'var(--emerald)' }}>{queueDone} done</span>
                        {queueManualReview > 0 && <span style={{ color: 'var(--amber)' }}>{queueManualReview} review</span>}
                        {queueErrors > 0 && <span style={{ color: 'var(--fail)' }}>{queueErrors} failed</span>}
                      </div>
                    )}
                  </div>

                  {/* Job list */}
                  <div style={{ flex: 1, overflowY: 'auto' }}>
                    {queueJobs.map((job) => (
                      <QueueJobRow key={job.id} job={job} onRetry={setRetryJob} />
                    ))}
                  </div>

                  {/* Dismiss button once complete */}
                  {queueAllDone && (
                    <div style={{ padding: '10px 12px', borderTop: '1px solid var(--border)', flexShrink: 0 }}>
                      <button
                        onClick={dismissQueue}
                        style={{
                          width: '100%', padding: '8px',
                          background: 'linear-gradient(135deg, var(--emerald), var(--cyan))',
                          border: 'none', borderRadius: 6, color: 'white',
                          fontSize: 12, fontWeight: 700, cursor: 'pointer',
                        }}
                      >
                        ✓ Done — View Test Cases
                      </button>
                    </div>
                  )}
                </div>
              ) : (
                /* TC library view */
                <>
                  {/* Stats bar */}
                  <div style={{
                    display: 'flex', alignItems: 'center', gap: 8, padding: '7px 12px',
                    borderBottom: '1px solid var(--border)', flexShrink: 0,
                    background: 'var(--surface2)',
                  }}>
                    <span style={{
                      fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 10,
                      background: 'rgba(42,157,143,0.12)', color: 'var(--emerald)',
                      border: '1px solid rgba(42,157,143,0.25)',
                    }}>
                      ✓ {allTCs.length - pendingCount} scripted
                    </span>
                    <span style={{
                      fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 10,
                      background: pendingCount > 0 ? 'var(--violet-dim)' : 'var(--surface3)',
                      color: pendingCount > 0 ? 'var(--violet)' : 'var(--text-dim)',
                      border: pendingCount > 0 ? '1px solid rgba(244,123,32,0.25)' : '1px solid var(--border)',
                    }}>
                      ○ {pendingCount} pending
                    </span>
                    {pendingCount > 0 && (
                      <button
                        onClick={handleSelectAllPending}
                        style={{
                          marginLeft: 'auto', fontSize: 9, background: 'none', border: 'none',
                          cursor: 'pointer', color: 'var(--cyan)', padding: 0,
                          fontFamily: 'var(--font-mono)', textDecoration: 'underline',
                        }}
                      >
                        {tcSelected.size === pendingCount ? 'Deselect all' : 'Select all'}
                      </button>
                    )}
                  </div>

                  {/* Groups */}
                  <div style={{ flex: 1, overflowY: 'auto' }}>
                    {tcsLoading ? (
                      <div style={{ padding: 20, textAlign: 'center', fontSize: 12, color: 'var(--text-dim)' }}>
                        Loading…
                      </div>
                    ) : groups.length === 0 ? (
                      <div style={{ padding: '32px 16px', textAlign: 'center', color: 'var(--text-dim)', fontSize: 12 }}>
                        <div style={{ fontSize: 32, marginBottom: 10 }}>📋</div>
                        No test cases yet.
                      </div>
                    ) : (
                      groups.map((group) => {
                        const isOpen = expandedGroups.has(group.name);
                        const pending = group.tcs.filter((tc) => !scriptedTcIds.has(tc.id));
                        const done = group.tcs.length - pending.length;
                        const selCount = pending.filter((tc) => tcSelected.has(tc.id)).length;
                        const allSel = pending.length > 0 && selCount === pending.length;
                        const someSel = selCount > 0 && !allSel;

                        return (
                          <div key={group.name}>
                            {/* Group header */}
                            <div
                              onClick={() => toggleGroupExpand(group.name)}
                              style={{
                                display: 'flex', alignItems: 'center', gap: 6,
                                padding: '7px 10px', cursor: 'pointer',
                                background: `linear-gradient(90deg, ${group.color.replace('var(', 'rgba(').replace(')', ', 0.06)')} , transparent)`,
                                borderBottom: '1px solid var(--border)',
                                userSelect: 'none',
                              }}
                            >
                              {/* Group checkbox */}
                              {pending.length > 0 && (
                                <div
                                  className={`tc-checkbox${allSel ? ' checked' : someSel ? ' indeterminate' : ''}`}
                                  style={{ fontSize: 9, flexShrink: 0 }}
                                  onClick={(e) => { e.stopPropagation(); handleGroupSelect(group.tcs); }}
                                >
                                  {allSel ? '✓' : someSel ? '–' : ''}
                                </div>
                              )}
                              {pending.length === 0 && <div style={{ width: 14 }} />}

                              {/* Chevron */}
                              <span style={{
                                fontSize: 10, color: 'var(--text-dim)', flexShrink: 0,
                                transition: 'transform 0.15s', display: 'inline-block',
                                transform: isOpen ? 'rotate(0deg)' : 'rotate(-90deg)',
                              }}>▼</span>

                              {/* Color dot */}
                              <span style={{
                                width: 7, height: 7, borderRadius: '50%',
                                background: group.color, flexShrink: 0, display: 'inline-block',
                              }} />

                              {/* Name */}
                              <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text)', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                {group.name}
                              </span>

                              {/* Progress chip */}
                              <span style={{
                                fontFamily: 'var(--font-mono)', fontSize: 9,
                                color: done === group.tcs.length ? 'var(--emerald)' : 'var(--text-dim)',
                                flexShrink: 0,
                              }}>
                                {done}/{group.tcs.length}
                              </span>
                            </div>

                            {/* TC rows */}
                            {isOpen && group.tcs.map((tc) => {
                              const linkedScript = tcIdToScript.get(tc.id);
                              return (
                                <TCScriptRow
                                  key={tc.id}
                                  tc={tc}
                                  isScripted={scriptedTcIds.has(tc.id)}
                                  isSelected={tcSelected.has(tc.id)}
                                  verificationStatus={linkedScript?.verificationStatus}
                                  suspectedIssue={linkedScript?.suspectedIssue}
                                  isGolden={linkedScript?.isGolden}
                                  onToggle={() => handleTCToggle(tc.id)}
                                  onOpen={() => handleOpenTCScript(tc.id)}
                                  onToggleGolden={linkedScript ? () => handleToggleGolden(linkedScript.id) : undefined}
                                />
                              );
                            })}
                          </div>
                        );
                      })
                    )}
                  </div>

                  {/* Generate action bar */}
                  <div style={{
                    padding: '10px 12px', borderTop: '1px solid var(--border)',
                    flexShrink: 0, background: 'var(--surface2)',
                  }}>
                    {!canWrite ? (
                      <div style={{
                        textAlign: 'center', fontSize: 10,
                        color: 'var(--text-dim)', fontFamily: 'var(--font-mono)', padding: '2px 0',
                      }}>
                        🔒 View Only — script generation requires QA Engineer role
                      </div>
                    ) : tcSelected.size > 0 ? (
                      <button
                        onClick={handleQueueGenerate}
                        disabled={isQueuing}
                        style={{
                          width: '100%', padding: '9px',
                          background: withHeal
                            ? 'linear-gradient(135deg, var(--violet), var(--cyan))'
                            : 'linear-gradient(135deg, var(--violet), var(--6d-orange-deep))',
                          border: 'none', borderRadius: 6, color: 'white',
                          fontSize: 12, fontWeight: 700, cursor: 'pointer',
                          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                        }}
                      >
                        {withHeal ? '🩹' : '⚡'} Generate {tcSelected.size} Script{tcSelected.size !== 1 ? 's' : ''}
                        {withHeal && <span style={{ fontSize: 10, opacity: 0.85 }}>+ Heal</span>}
                      </button>
                    ) : (
                      <div style={{
                        textAlign: 'center', fontSize: 10,
                        color: pendingCount === 0 ? 'var(--emerald)' : 'var(--text-dim)',
                        fontFamily: 'var(--font-mono)', padding: '2px 0',
                      }}>
                        {pendingCount === 0
                          ? '✓ All test cases have scripts'
                          : `Select pending TCs above to generate scripts`}
                      </div>
                    )}
                  </div>
                </>
              )}
            </>
          )}

          {/* ── SCRIPTS TAB ── */}
          {leftTab === 'scripts' && (
            <>
              {canWrite && (
                <div style={{
                  padding: '8px 10px', borderBottom: '1px solid var(--border)',
                  flexShrink: 0, display: 'flex', gap: 6,
                }}>
                  <button
                    onClick={() => setLeftTab('tcs')}
                    style={{
                      flex: 1, padding: '6px 8px',
                      background: 'linear-gradient(90deg, #FFB347, #F47B20)',
                      border: 'none', borderRadius: 5, cursor: 'pointer',
                      color: '#fff', fontWeight: 700, fontSize: 11,
                      display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4,
                    }}
                  >
                    + Generate
                  </button>
                  <button
                    onClick={() => handleOpenImport()}
                    style={{
                      padding: '6px 8px', background: 'transparent',
                      border: '1px solid var(--border)', borderRadius: 5,
                      cursor: 'pointer', color: 'var(--text-mid)', fontSize: 11,
                    }}
                    title="Import .spec.ts and link to a test case"
                  >
                    ⬆
                  </button>
                </div>
              )}

              {scriptsLoading ? (
                <div style={{ padding: 16, color: 'var(--text-dim)', fontSize: 12 }}>Loading…</div>
              ) : (
                <FileTree
                  scripts={scripts}
                  activeId={activeTabId}
                  onSelect={openTab}
                  onDelete={handleDelete}
                  canDelete={canWrite}
                />
              )}
            </>
          )}
        </div>

        {/* ── DRAG DIVIDER ─────────────────────────────────────────────── */}
        <div
          ref={dividerRef}
          onMouseDown={handleDividerMouseDown}
          style={{
            width: 4, flexShrink: 0, cursor: 'col-resize',
            background: 'var(--border)',
            transition: 'background 0.15s',
          }}
          onMouseEnter={(e) => { (e.currentTarget as HTMLDivElement).style.background = 'var(--6d-orange)'; }}
          onMouseLeave={(e) => { if (!isDraggingRef.current) (e.currentTarget as HTMLDivElement).style.background = 'var(--border)'; }}
        />

        {/* ── RIGHT: Monaco Editor ───────────────────────────────────────── */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', background: '#06224A' }}>
          {openTabs.length === 0 ? (
            <EmptyEditor />
          ) : (
            <>
              <EditorTabs
                tabs={openTabs}
                activeId={activeTabId}
                dirtyIds={dirtyTabs}
                onActivate={setActiveTabId}
                onClose={closeTab}
              />

              {/* Editor action toolbar */}
              <div style={{
                display: 'flex', alignItems: 'center', justifyContent: 'flex-end',
                padding: '4px 10px', gap: 6, flexShrink: 0,
                background: 'rgba(0,0,0,0.25)',
                borderBottom: '1px solid rgba(255,255,255,0.05)',
                minHeight: 32,
              }}>
                {canWrite && activeScript?.testCaseId && (
                  <button
                    onClick={() => setShowRegenModal(true)}
                    title="Regenerate this script — provide correction context to guide the agent"
                    style={{
                      display: 'inline-flex', alignItems: 'center', gap: 5,
                      padding: '3px 11px', borderRadius: 5, cursor: 'pointer',
                      fontSize: 11, fontWeight: 700, fontFamily: 'var(--font-ui)',
                      border: '1px solid rgba(245,158,11,0.45)',
                      background: 'rgba(245,158,11,0.09)',
                      color: 'var(--amber)',
                      transition: 'all 0.15s',
                    }}
                    onMouseEnter={(e) => {
                      (e.currentTarget as HTMLButtonElement).style.background = 'rgba(245,158,11,0.18)';
                      (e.currentTarget as HTMLButtonElement).style.borderColor = 'rgba(245,158,11,0.7)';
                    }}
                    onMouseLeave={(e) => {
                      (e.currentTarget as HTMLButtonElement).style.background = 'rgba(245,158,11,0.09)';
                      (e.currentTarget as HTMLButtonElement).style.borderColor = 'rgba(245,158,11,0.45)';
                    }}
                  >
                    ↺ Regenerate
                  </button>
                )}
                {activeScript && (
                  <button
                    onClick={() => handleToggleGolden(activeScript.id)}
                    title={activeScript.isGolden ? 'Remove golden status (stop using as few-shot example)' : 'Mark as golden — used as few-shot example for future script generation'}
                    style={{
                      display: 'inline-flex', alignItems: 'center', gap: 4,
                      padding: '3px 9px', borderRadius: 5, cursor: 'pointer',
                      fontSize: 11, fontWeight: 700, fontFamily: 'var(--font-ui)',
                      border: activeScript.isGolden
                        ? '1px solid rgba(245,158,11,0.6)'
                        : '1px solid rgba(255,255,255,0.1)',
                      background: activeScript.isGolden
                        ? 'rgba(245,158,11,0.12)'
                        : 'transparent',
                      color: activeScript.isGolden ? '#fbbf24' : 'rgba(226,232,240,0.3)',
                      transition: 'all 0.15s',
                    }}
                    onMouseEnter={(e) => {
                      (e.currentTarget as HTMLButtonElement).style.color = '#fbbf24';
                      (e.currentTarget as HTMLButtonElement).style.borderColor = 'rgba(245,158,11,0.5)';
                    }}
                    onMouseLeave={(e) => {
                      if (!activeScript.isGolden) {
                        (e.currentTarget as HTMLButtonElement).style.color = 'rgba(226,232,240,0.3)';
                        (e.currentTarget as HTMLButtonElement).style.borderColor = 'rgba(255,255,255,0.1)';
                      }
                    }}
                  >
                    {activeScript.isGolden ? '★ Golden' : '☆ Golden'}
                  </button>
                )}
              </div>

              <div style={{ flex: 1, overflow: 'hidden', position: 'relative' }}>
                {loadingContent && (
                  <div style={{
                    position: 'absolute', inset: 0, display: 'flex',
                    alignItems: 'center', justifyContent: 'center',
                    background: 'rgba(6,34,74,0.8)', zIndex: 10,
                    color: '#60a5fa', fontSize: 13,
                  }}>
                    Loading…
                  </div>
                )}
                <Editor
                  height="100%"
                  language="typescript"
                  theme="vs-dark"
                  value={activeContent}
                  onChange={(v) => {
                    if (!activeTabId || v === undefined) return;
                    setTabContents((prev) => ({ ...prev, [activeTabId]: v }));
                    setDirtyTabs((prev) => new Set([...prev, activeTabId]));
                  }}
                  options={{
                    fontFamily: "'JetBrains Mono', ui-monospace, monospace",
                    fontSize: 13, lineHeight: 20,
                    minimap: { enabled: false },
                    scrollBeyondLastLine: false,
                    wordWrap: 'on', tabSize: 2,
                    renderLineHighlight: 'line',
                    scrollbar: { verticalScrollbarSize: 5, horizontalScrollbarSize: 5 },
                    overviewRulerLanes: 0,
                    padding: { top: 12, bottom: 12 },
                  }}
                />
              </div>

              {/* Status bar */}
              <div style={{
                height: 24, background: 'rgba(0,0,0,0.3)',
                borderTop: '1px solid rgba(255,255,255,0.06)',
                display: 'flex', alignItems: 'center', padding: '0 12px', gap: 16,
                fontSize: 11, fontFamily: 'var(--font-mono)',
                color: 'rgba(226,232,240,0.5)', flexShrink: 0,
              }}>
                <span style={{ color: 'rgba(226,232,240,0.8)' }}>{activeScript?.filename ?? ''}</span>
                <span>TypeScript</span>
                <span>TS 5.0</span>
                {statusSize && <span>{statusSize}</span>}
                {statusDirty
                  ? <span style={{ color: '#fbbf24' }}>● Modified</span>
                  : <span style={{ color: '#34d399' }}>✓ Saved</span>}
                <div style={{ flex: 1 }} />
                {statusDirty && (
                  <button
                    onClick={saveActiveTab}
                    disabled={save.isPending}
                    style={{
                      background: 'rgba(96,165,250,0.15)', border: '1px solid rgba(96,165,250,0.3)',
                      borderRadius: 4, color: '#60a5fa', cursor: 'pointer',
                      fontSize: 10, padding: '1px 8px', fontFamily: 'var(--font-mono)',
                    }}
                  >
                    {save.isPending ? 'Saving…' : '↑ Save (Ctrl+S)'}
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      </div>

    </div>
  );
}
