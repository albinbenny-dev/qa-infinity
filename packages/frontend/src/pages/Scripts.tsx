import React, { useState, useCallback, useRef, useEffect, useLayoutEffect, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import * as Dialog from '@radix-ui/react-dialog';
import Editor from '@monaco-editor/react';
import toast from 'react-hot-toast';
import { useQueryClient } from '@tanstack/react-query';
import Topbar, { TbBtn } from '../components/layout/Topbar';
import ExecutionMonitor from '../components/scripts/ExecutionMonitor';
import EditorTabs, { type EditorTab } from '../components/scripts/EditorTabs';
import { useProject, useProjectEnvConfigs } from '../hooks/useProjects';
import { useRBAC } from '../hooks/useRBAC';
import { useCreateIndividualRun, useRun } from '../hooks/useRuns';
import { useTestCases, useUseCases } from '../hooks/useTestCases';
import {
  useScripts,
  useSaveScriptContent,
  useUploadScript,
  useUploadScriptWithExtract,
  useDeleteScript,
} from '../hooks/useScripts';
import {
  useResources,
  useSaveResource,
} from '../hooks/useResources';
import { useScriptJobs } from '../hooks/useScriptJobs';
import { useSkills } from '../hooks/useSkills';
import { useExecutionStore } from '../stores/executionStore';
import { useChatSidebarStore } from '../stores/chatSidebarStore';
import { useAppConfig } from '../context/AppConfig';
import { api } from '../lib/api';
import { getToken } from '../lib/auth';
import { io } from 'socket.io-client';
import type { Script, TestCase, ScriptJob, ScriptJobPhase, ProjectSkill } from '../types';

interface FileTreeNode {
  name: string;
  path: string;
  type: 'file' | 'dir';
  ext?: string;
  children?: FileTreeNode[];
}

interface FileSearchMatch {
  relPath: string;
  line: number;
  text: string;
}

interface FileSearchGroup {
  relPath: string;
  matches: FileSearchMatch[];
}

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

// ── File Tree Component ─────────────────────────────────────────────────────

function FileTreeView({
  nodes, expandedDirs, onToggle, onSelect, onDownloadFile, onDownloadZip, onDelete, onUploadTo, onNewFolder,
  selectedFolder, onSelectFolder, onMoveItem, indent,
}: {
  nodes: FileTreeNode[];
  expandedDirs: Set<string>;
  onToggle: (p: string) => void;
  onSelect?: (p: string) => void;
  onDownloadFile: (p: string) => void;
  onDownloadZip: (p?: string) => void;
  onDelete?: (p: string) => void;
  onUploadTo?: (folderPath: string) => void;
  onNewFolder?: (parentPath: string) => void;
  selectedFolder?: string;
  onSelectFolder?: (p: string) => void;
  onMoveItem?: (fromPath: string, toFolder: string) => void;
  indent: number;
}) {
  return (
    <>
      {nodes.map(node => (
        <div key={node.path}>
          <div
            draggable={!!onMoveItem}
            onDragStart={onMoveItem ? (e) => { e.dataTransfer.setData('text/plain', node.path); e.dataTransfer.effectAllowed = 'move'; } : undefined}
            onDragOver={onMoveItem && node.type === 'dir' ? (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; } : undefined}
            onDrop={onMoveItem && node.type === 'dir' ? (e) => {
              e.preventDefault();
              e.stopPropagation();
              const fromPath = e.dataTransfer.getData('text/plain');
              if (fromPath && fromPath !== node.path) onMoveItem(fromPath, node.path);
            } : undefined}
            style={{
              display: 'flex', alignItems: 'center', gap: 4,
              padding: '3px 12px', paddingLeft: 12 + indent * 16,
              cursor: 'pointer',
              fontSize: 13,
              background: node.type === 'dir' && node.path === selectedFolder ? 'rgba(37,99,171,0.1)' : 'transparent',
            }}
            onClick={() => {
              if (node.type === 'dir') { onToggle(node.path); onSelectFolder?.(node.path); }
              else onSelect?.(node.path);
            }}
          >
            <span style={{ color: node.type === 'dir' ? 'var(--amber)' : 'var(--text-muted)', fontSize: 14 }}>
              {node.type === 'dir' ? (expandedDirs.has(node.path) ? '▾' : '▸') : ''}
            </span>
            <span style={{ color: node.type === 'dir' ? '#f0a030' : 'var(--text)', marginRight: 2 }}>
              {node.type === 'dir' ? '📁' : (node.ext === '.robot' ? '🤖' : '📄')}
            </span>
            <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {node.name}
            </span>
            <span style={{ display: 'flex', gap: 4 }}
              onClick={e => e.stopPropagation()}
            >
              {node.type === 'dir' ? (
                <>
                  {onUploadTo && (
                    <button
                      title="Upload a file here"
                      style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 13, color: 'var(--text-muted)' }}
                      onClick={() => onUploadTo(node.path)}
                    >⬆</button>
                  )}
                  {onNewFolder && (
                    <button
                      title="New subfolder"
                      style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 13, color: 'var(--text-muted)' }}
                      onClick={() => onNewFolder(node.path)}
                    >📁+</button>
                  )}
                  <button
                    title="Download as zip"
                    style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 13, color: 'var(--text-muted)' }}
                    onClick={() => onDownloadZip(node.path)}
                  >⬇</button>
                </>
              ) : (
                <button
                  title="Download file"
                  style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 13, color: 'var(--text-muted)' }}
                  onClick={() => onDownloadFile(node.path)}
                >⬇</button>
              )}
              {onDelete && (
                <button
                  title="Delete"
                  style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 13, color: 'var(--red)' }}
                  onClick={() => { if (confirm(`Delete ${node.name}?`)) onDelete(node.path); }}
                >✕</button>
              )}
            </span>
          </div>
          {node.type === 'dir' && expandedDirs.has(node.path) && node.children && node.children.length > 0 && (
            <FileTreeView
              nodes={node.children}
              expandedDirs={expandedDirs}
              onToggle={onToggle}
              onSelect={onSelect}
              onDownloadFile={onDownloadFile}
              onDownloadZip={onDownloadZip}
              onDelete={onDelete}
              onUploadTo={onUploadTo}
              onNewFolder={onNewFolder}
              selectedFolder={selectedFolder}
              onSelectFolder={onSelectFolder}
              onMoveItem={onMoveItem}
              indent={indent + 1}
            />
          )}
        </div>
      ))}
    </>
  );
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
  tc, isScripted, isSelected, verificationStatus, suspectedIssue, isGolden, onToggle, onOpen, onToggleGolden, onChat, onDelete,
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
  onChat: () => void;
  onDelete?: () => void;
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
        <div
          title={tc.title}
          style={{
            fontSize: 11,
            fontWeight: isScripted ? 400 : 600,
            color: isScripted ? 'var(--text-dim)' : 'var(--text)',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}
        >
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

      {/* Chat button — open AI agent with this TC pre-loaded */}
      <button
        onClick={(e) => { e.stopPropagation(); onChat(); }}
        title={isScripted ? 'Fix or discuss this script in chat' : 'Generate script via AI chat'}
        style={{
          width: 20, height: 20, borderRadius: 3,
          background: 'transparent', border: '1px solid transparent',
          color: 'var(--text-dim)', fontSize: 11, cursor: 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
          transition: 'all 0.15s',
        }}
        onMouseEnter={(e) => {
          (e.currentTarget as HTMLButtonElement).style.background = 'rgba(99,102,241,0.12)';
          (e.currentTarget as HTMLButtonElement).style.borderColor = 'rgba(99,102,241,0.3)';
          (e.currentTarget as HTMLButtonElement).style.color = 'var(--violet)';
        }}
        onMouseLeave={(e) => {
          (e.currentTarget as HTMLButtonElement).style.background = 'transparent';
          (e.currentTarget as HTMLButtonElement).style.borderColor = 'transparent';
          (e.currentTarget as HTMLButtonElement).style.color = 'var(--text-dim)';
        }}
      >💬</button>

      {/* Delete script — only for scripted TCs */}
      {isScripted && onDelete ? (
        <button
          onClick={(e) => { e.stopPropagation(); onDelete(); }}
          title="Delete this script"
          style={{
            width: 20, height: 20, borderRadius: 3,
            background: 'transparent', border: '1px solid transparent',
            color: 'var(--text-dim)', fontSize: 11, cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
            transition: 'all 0.15s',
          }}
          onMouseEnter={(e) => {
            (e.currentTarget as HTMLButtonElement).style.background = 'rgba(220,38,38,0.12)';
            (e.currentTarget as HTMLButtonElement).style.borderColor = 'rgba(220,38,38,0.3)';
            (e.currentTarget as HTMLButtonElement).style.color = 'var(--fail)';
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLButtonElement).style.background = 'transparent';
            (e.currentTarget as HTMLButtonElement).style.borderColor = 'transparent';
            (e.currentTarget as HTMLButtonElement).style.color = 'var(--text-dim)';
          }}
        >🗑</button>
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

const SKILL_TYPE_SHORT: Record<string, string> = {
  UI_FLOW: 'UI Flow',
  BUSINESS_USE_CASE: 'Business',
  TEST_DATA: 'Test Data',
  HLD: 'HLD',
  API_CONTRACT: 'API',
  USER_ROLE: 'Role',
  UX_DESIGN: 'UX',
  HISTORICAL: 'Historical',
  FUNCTIONAL_RULES: 'Rules',
  LOCATOR_GUIDE: 'Locators',
  TEST_CASE_DOC: 'TC Doc',
  REFERENCE_SCRIPT: 'Ref Script',
};

const SKILL_TYPE_COLOR: Record<string, string> = {
  UI_FLOW: 'var(--emerald)',
  BUSINESS_USE_CASE: 'var(--cyan)',
  TEST_DATA: 'var(--violet)',
  HLD: 'var(--6d-orange)',
  API_CONTRACT: 'var(--cyan)',
  USER_ROLE: 'var(--emerald)',
  UX_DESIGN: 'var(--violet)',
  HISTORICAL: 'var(--text-dim)',
  FUNCTIONAL_RULES: 'var(--6d-orange)',
  LOCATOR_GUIDE: 'var(--emerald)',
  TEST_CASE_DOC: 'var(--cyan)',
  REFERENCE_SCRIPT: 'var(--emerald)',
};

interface GenerateContextModalProps {
  count: number;
  initialNote: string;
  projectId?: string;
  singleTc?: { id: string; tcId: string; title: string; projectId: string; useCaseTag?: string | null };
  onConfirm: (opts: { contextNote: string; saveHints: boolean; scriptMode: 'PLAYWRIGHT' | 'ROBOT'; skillIds: string[] }) => void;
  onClose: () => void;
  onImportInstead?: () => void;
}

function GenerateContextModal({ count, initialNote, projectId, singleTc, onConfirm, onClose, onImportInstead }: GenerateContextModalProps) {
  const [note, setNote] = useState(initialNote);
  const [save, setSave] = useState(false);
  const [busy, setBusy] = useState(false);
  const [scriptMode, setScriptMode] = useState<'PLAYWRIGHT' | 'ROBOT'>('ROBOT');
  const [selectedSkillIds, setSelectedSkillIds] = useState<string[]>([]);
  const [skillDropOpen, setSkillDropOpen] = useState(false);
  const [skillSearch, setSkillSearch] = useState('');
  const [dropPos, setDropPos] = useState<{ top: number; left: number; width: number } | null>(null);
  const skillTriggerRef = React.useRef<HTMLButtonElement>(null);
  const skillDropRef = React.useRef<HTMLDivElement>(null);
  const autoDetectedRef = React.useRef(false);

  const pid = projectId ?? singleTc?.projectId;
  const { data: skillsData } = useSkills(pid);
  const allSkills = (skillsData?.skills ?? []).filter((s: ProjectSkill) => s.isActive);

  // Auto-detect on first load: select skills matching TC's useCaseTag
  useEffect(() => {
    if (autoDetectedRef.current || allSkills.length === 0) return;
    const tag = singleTc?.useCaseTag?.toLowerCase().trim();
    const autoIds = allSkills
      .filter((s: ProjectSkill) => tag && s.featureGroup?.toLowerCase().trim() === tag)
      .map((s: ProjectSkill) => s.id);
    if (autoIds.length > 0) {
      setSelectedSkillIds(autoIds);
      autoDetectedRef.current = true;
    }
  }, [allSkills, singleTc?.useCaseTag]);

  // Close skill dropdown on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (
        skillDropRef.current && !skillDropRef.current.contains(e.target as Node) &&
        skillTriggerRef.current && !skillTriggerRef.current.contains(e.target as Node)
      ) {
        setSkillDropOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  function openSkillDrop() {
    if (skillTriggerRef.current) {
      const r = skillTriggerRef.current.getBoundingClientRect();
      setDropPos({ top: r.bottom + 4, left: r.left, width: Math.max(r.width, 260) });
    }
    setSkillDropOpen((o) => !o);
  }

  function toggleSkill(id: string) {
    setSelectedSkillIds((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]);
  }

  async function handleSubmit() {
    setBusy(true);
    await onConfirm({ contextNote: note, saveHints: save, scriptMode, skillIds: selectedSkillIds });
    setBusy(false);
  }

  const selectedSkills = allSkills.filter((s: ProjectSkill) => selectedSkillIds.includes(s.id));
  const unselectedSkills = allSkills.filter((s: ProjectSkill) => !selectedSkillIds.includes(s.id));
  const filteredUnselected = unselectedSkills.filter((s: ProjectSkill) =>
    skillSearch === '' ||
    s.name.toLowerCase().includes(skillSearch.toLowerCase()) ||
    (s.featureGroup ?? '').toLowerCase().includes(skillSearch.toLowerCase()),
  );

  const autoCount = singleTc?.useCaseTag
    ? allSkills.filter((s: ProjectSkill) => s.featureGroup?.toLowerCase().trim() === singleTc.useCaseTag?.toLowerCase().trim()).length
    : 0;

  return (
    <div style={MODAL_OVERLAY} onClick={onClose}>
      <div style={MODAL_BOX} onClick={(e) => e.stopPropagation()}>
        <div style={MODAL_HEADER}>
          <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>
            ⚡ Generate {count} Script{count !== 1 ? 's' : ''}
          </span>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--text-dim)', fontSize: 16, cursor: 'pointer', lineHeight: 1 }}>×</button>
        </div>

        <div style={MODAL_BODY}>
          {/* Script Framework toggle */}
          <div>
            <span style={LABEL_STYLE}>Script Framework</span>
            <div style={{ display: 'flex', gap: 8 }}>
              {(['PLAYWRIGHT', 'ROBOT'] as const).map((v) => (
                <button
                  key={v}
                  onClick={() => setScriptMode(v)}
                  style={{
                    flex: 1, padding: '7px 10px', borderRadius: 6, cursor: 'pointer', fontSize: 11,
                    fontWeight: 700, fontFamily: 'var(--font-ui)',
                    border: scriptMode === v
                      ? (v === 'ROBOT' ? '1px solid rgba(42,157,143,0.6)' : '1px solid rgba(37,99,171,0.6)')
                      : '1px solid var(--border)',
                    background: scriptMode === v
                      ? (v === 'ROBOT' ? 'rgba(42,157,143,0.12)' : 'rgba(37,99,171,0.1)')
                      : 'transparent',
                    color: scriptMode === v ? (v === 'ROBOT' ? 'var(--emerald)' : 'var(--cyan)') : 'var(--text-dim)',
                    transition: 'all 0.15s',
                  }}
                >
                  {v === 'ROBOT' ? '🤖 Robot Framework' : '⚡ Playwright TS'}
                </button>
              ))}
            </div>
            {scriptMode === 'ROBOT' && (
              <p style={{ fontSize: 10, color: 'var(--text-dim)', margin: '6px 0 0', lineHeight: 1.5 }}>
                Generates <code style={{ fontFamily: 'var(--font-mono)', color: 'var(--emerald)' }}>.robot</code> files using RF Browser library (Playwright backend) — human-readable keywords, easy to correct.
              </p>
            )}
          </div>

          {/* Context note */}
          <div>
            <span style={LABEL_STYLE}>Additional context <span style={{ fontWeight: 400, color: 'var(--text-dim)' }}>(optional)</span></span>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder={'Hints about selectors, routes, or anything the agent should know...\n\nExamples:\n• The primary sales route is /sales/primary-orders\n• Submit button selector: #kc-login\n• After login wait for the project selector modal'}
              style={TEXTAREA_STYLE}
              autoFocus
            />
          </div>

          {/* Skills multi-select */}
          <div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginBottom: 6 }}>
              <span style={LABEL_STYLE}>Skills</span>
              {autoCount > 0 && singleTc?.useCaseTag && (
                <span style={{ fontSize: 9, color: 'var(--text-dim)', fontStyle: 'italic' }}>
                  {autoCount} auto-detected from &ldquo;{singleTc.useCaseTag}&rdquo;
                </span>
              )}
            </div>

            {/* Selected skill chips */}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, minHeight: 28 }}>
              {selectedSkills.map((s: ProjectSkill) => (
                <span
                  key={s.id}
                  style={{
                    display: 'inline-flex', alignItems: 'center', gap: 4,
                    padding: '3px 8px', borderRadius: 20, fontSize: 10, fontWeight: 600,
                    background: 'rgba(42,157,143,0.1)', border: '1px solid rgba(42,157,143,0.3)',
                    color: SKILL_TYPE_COLOR[s.skillType] ?? 'var(--text)',
                    fontFamily: 'var(--font-ui)',
                  }}
                >
                  <span style={{ fontSize: 9, color: 'var(--text-dim)', fontWeight: 400 }}>
                    {SKILL_TYPE_SHORT[s.skillType] ?? s.skillType}
                  </span>
                  <span style={{ maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.name}</span>
                  <button
                    onClick={() => toggleSkill(s.id)}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-dim)', padding: '0 0 0 2px', fontSize: 12, lineHeight: 1, display: 'flex', alignItems: 'center' }}
                  >×</button>
                </span>
              ))}

              {/* Add more button */}
              {allSkills.length > 0 && (
                <button
                  ref={skillTriggerRef}
                  onClick={openSkillDrop}
                  style={{
                    display: 'inline-flex', alignItems: 'center', gap: 4,
                    padding: '3px 8px', borderRadius: 20, fontSize: 10, fontWeight: 600,
                    background: 'transparent', border: '1px dashed var(--border2)',
                    color: 'var(--text-dim)', cursor: 'pointer', fontFamily: 'var(--font-ui)',
                  }}
                >
                  + Add skill ▾
                </button>
              )}
            </div>

            {allSkills.length === 0 && (
              <p style={{ fontSize: 10, color: 'var(--text-dim)', margin: '4px 0 0' }}>
                No active skills — add skills in the Skills section to ground locators and navigation.
              </p>
            )}

            {selectedSkillIds.length > 0 && (
              <p style={{ fontSize: 10, color: 'var(--text-dim)', margin: '6px 0 0', lineHeight: 1.5 }}>
                Selected skills will be injected as high-priority context for the script agent.
              </p>
            )}
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
                background: 'linear-gradient(135deg, var(--violet), var(--6d-orange-deep))',
                opacity: busy ? 0.7 : 1,
              }}
            >
              {busy ? 'Queuing…' : '⚡ Generate'}
            </button>
          </div>
        </div>
      </div>

      {/* Skill dropdown — fixed position to avoid modal clipping */}
      {skillDropOpen && dropPos && (
        <div
          ref={skillDropRef}
          style={{
            position: 'fixed',
            top: dropPos.top,
            left: dropPos.left,
            width: dropPos.width,
            zIndex: 9999,
            background: 'var(--surface2)',
            border: '1px solid var(--border2)',
            borderRadius: 6,
            boxShadow: '0 4px 16px rgba(0,0,0,0.4)',
            maxHeight: 240,
            display: 'flex',
            flexDirection: 'column',
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <input
            autoFocus
            value={skillSearch}
            onChange={(e) => setSkillSearch(e.target.value)}
            placeholder="Search skills…"
            style={{
              margin: 8, padding: '5px 8px', borderRadius: 4,
              border: '1px solid var(--border)', background: 'var(--surface3)',
              color: 'var(--text)', fontSize: 11, fontFamily: 'var(--font-ui)', outline: 'none',
            }}
          />
          <div style={{ overflowY: 'auto', flex: 1 }}>
            {filteredUnselected.length === 0 ? (
              <div style={{ padding: '10px 12px', fontSize: 11, color: 'var(--text-dim)' }}>
                {unselectedSkills.length === 0 ? 'All skills selected' : 'No matching skills'}
              </div>
            ) : filteredUnselected.map((s: ProjectSkill) => (
              <div
                key={s.id}
                onClick={() => { toggleSkill(s.id); setSkillSearch(''); }}
                style={{
                  padding: '7px 12px', fontSize: 11, cursor: 'pointer',
                  borderTop: '1px solid var(--border)',
                  display: 'flex', alignItems: 'center', gap: 8,
                  color: 'var(--text)',
                }}
                onMouseEnter={(e) => { (e.currentTarget as HTMLDivElement).style.background = 'var(--surface3)'; }}
                onMouseLeave={(e) => { (e.currentTarget as HTMLDivElement).style.background = 'transparent'; }}
              >
                <span style={{
                  fontSize: 9, fontWeight: 600, padding: '1px 5px', borderRadius: 3,
                  background: 'rgba(42,157,143,0.12)', color: SKILL_TYPE_COLOR[s.skillType] ?? 'var(--text-dim)',
                  flexShrink: 0,
                }}>
                  {SKILL_TYPE_SHORT[s.skillType] ?? s.skillType}
                </span>
                <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.name}</span>
                {s.featureGroup && (
                  <span style={{ fontSize: 9, color: 'var(--text-dim)', flexShrink: 0 }}>{s.featureGroup}</span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── PromoteReferenceSkillModal ────────────────────────────────────────────────

interface PromoteReferenceSkillModalProps {
  tc: { tcId: string; title: string; steps: string[]; expectedResult?: string; useCaseTag?: string | null };
  scriptBody: string;
  existingFeatureGroups: string[];
  onConfirm: (opts: { name: string; featureGroup: string }) => Promise<void>;
  onClose: () => void;
}

function PromoteReferenceSkillModal({ tc, scriptBody, existingFeatureGroups, onConfirm, onClose }: PromoteReferenceSkillModalProps) {
  const [name, setName] = useState(`${tc.tcId} — ${tc.title}`.slice(0, 80));
  const [featureGroup, setFeatureGroup] = useState(tc.useCaseTag ?? '');
  const [fgOpen, setFgOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const fgOptions = Array.from(new Set([
    ...(tc.useCaseTag ? [tc.useCaseTag] : []),
    ...existingFeatureGroups,
  ])).filter(Boolean);

  async function handleSubmit() {
    if (!name.trim()) return;
    setBusy(true);
    await onConfirm({ name: name.trim(), featureGroup: featureGroup.trim() });
    setBusy(false);
  }

  const previewLines = scriptBody.split('\n').slice(0, 8).join('\n');

  return (
    <div style={MODAL_OVERLAY} onClick={onClose}>
      <div style={{ ...MODAL_BOX, maxWidth: 520 }} onClick={(e) => e.stopPropagation()}>
        <div style={MODAL_HEADER}>
          <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>🔖 Promote to Reference Skill</span>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--text-dim)', fontSize: 16, cursor: 'pointer', lineHeight: 1 }}>×</button>
        </div>

        <div style={MODAL_BODY}>
          <p style={{ fontSize: 11, color: 'var(--text-dim)', margin: 0, lineHeight: 1.6 }}>
            Saves this TC + script pair as a verified reference. The agent will mirror its locators and navigation for all future scripts in the same feature group.
          </p>

          <div>
            <span style={LABEL_STYLE}>Skill name</span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoFocus
              style={{
                width: '100%', boxSizing: 'border-box',
                background: 'var(--surface)', border: '1px solid var(--border2)', borderRadius: 6,
                color: 'var(--text)', fontSize: 11, padding: '7px 10px',
                fontFamily: 'var(--font-ui)', outline: 'none',
              }}
            />
          </div>

          <div style={{ position: 'relative' }}>
            <span style={LABEL_STYLE}>Feature group <span style={{ fontWeight: 400, color: 'var(--text-dim)' }}>(scope for auto-detection)</span></span>
            <div style={{ position: 'relative' }}>
              <input
                value={featureGroup}
                onChange={(e) => { setFeatureGroup(e.target.value); setFgOpen(true); }}
                onFocus={() => setFgOpen(true)}
                onBlur={() => setTimeout(() => setFgOpen(false), 150)}
                placeholder="Select or type a feature group…"
                style={{
                  width: '100%', boxSizing: 'border-box',
                  background: 'var(--surface)', border: '1px solid var(--border2)', borderRadius: 6,
                  color: 'var(--text)', fontSize: 11, padding: '7px 32px 7px 10px',
                  fontFamily: 'var(--font-ui)', outline: 'none',
                }}
              />
              <span
                onClick={() => setFgOpen((v) => !v)}
                style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', cursor: 'pointer', color: 'var(--text-dim)', fontSize: 10 }}
              >
                ▾
              </span>
            </div>
            {fgOpen && fgOptions.length > 0 && (
              <div style={{
                position: 'absolute', zIndex: 99, left: 0, right: 0,
                background: 'var(--surface)', border: '1px solid var(--border2)',
                borderRadius: 6, marginTop: 2,
                boxShadow: '0 8px 24px rgba(0,0,0,0.3)', overflow: 'hidden',
              }}>
                {fgOptions
                  .filter((g) => !featureGroup || g.toLowerCase().includes(featureGroup.toLowerCase()))
                  .map((g) => (
                    <div
                      key={g}
                      onMouseDown={() => { setFeatureGroup(g); setFgOpen(false); }}
                      style={{
                        padding: '7px 12px', fontSize: 11, cursor: 'pointer',
                        color: g === featureGroup ? 'var(--cyan)' : 'var(--text)',
                        background: g === featureGroup ? 'rgba(37,99,171,0.08)' : 'transparent',
                      }}
                      onMouseEnter={(e) => { (e.currentTarget as HTMLDivElement).style.background = 'rgba(255,255,255,0.05)'; }}
                      onMouseLeave={(e) => { (e.currentTarget as HTMLDivElement).style.background = g === featureGroup ? 'rgba(37,99,171,0.08)' : 'transparent'; }}
                    >
                      {g}
                    </div>
                  ))}
                {featureGroup && !fgOptions.includes(featureGroup) && (
                  <div
                    onMouseDown={() => setFgOpen(false)}
                    style={{
                      padding: '7px 12px', fontSize: 11, cursor: 'pointer',
                      color: 'var(--cyan)', borderTop: '1px solid var(--border)',
                    }}
                  >
                    + Add &ldquo;{featureGroup}&rdquo;
                  </div>
                )}
              </div>
            )}
            <p style={{ fontSize: 10, color: 'var(--text-dim)', margin: '4px 0 0' }}>
              Scripts in this feature group will auto-detect this reference skill in the Generate modal.
            </p>
          </div>

          <div>
            <span style={LABEL_STYLE}>Script preview</span>
            <pre style={{
              margin: 0, padding: '8px 10px', borderRadius: 6,
              background: 'var(--surface2)', border: '1px solid var(--border)',
              fontSize: 9, fontFamily: 'var(--font-mono)', color: 'var(--text-dim)',
              overflowX: 'auto', maxHeight: 110, whiteSpace: 'pre',
            }}>
              {previewLines}{scriptBody.split('\n').length > 8 ? '\n…' : ''}
            </pre>
          </div>
        </div>

        <div style={{ ...MODAL_FOOTER, justifyContent: 'flex-end' }}>
          <button onClick={onClose} style={BTN_CANCEL}>Cancel</button>
          <button
            onClick={handleSubmit}
            disabled={busy || !name.trim()}
            style={{
              padding: '7px 18px', borderRadius: 6, border: 'none',
              cursor: busy || !name.trim() ? 'not-allowed' : 'pointer',
              fontSize: 12, fontWeight: 700, fontFamily: 'var(--font-ui)', color: '#fff',
              background: 'linear-gradient(135deg, var(--emerald), var(--cyan))',
              opacity: busy || !name.trim() ? 0.6 : 1,
            }}
          >
            {busy ? 'Saving…' : '🔖 Save as Reference Skill'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── RetryFeedbackModal ───────────────────────────────────────────────────────

interface RetryFeedbackModalProps {
  job: ScriptJob;
  onConfirm: (opts: { contextNote: string; withHeal: boolean; saveHints: boolean; qaFeedback: string; saveAsHistoricalSkill: boolean; featureGroup: string }) => void;
  onClose: () => void;
}

function RetryFeedbackModal({ job, onConfirm, onClose }: RetryFeedbackModalProps) {
  const [note, setNote] = useState('');
  const [heal, setHeal] = useState(job.withHeal);
  const [save, setSave] = useState(false);
  const [saveAsSkill, setSaveAsSkill] = useState(false);
  const [busy, setBusy] = useState(false);

  const errorText = job.suspectedIssue ?? job.lastError ?? null;
  const featureGroup = job.testCase?.useCaseTag ?? '';

  async function handleSubmit() {
    setBusy(true);
    await onConfirm({ contextNote: note, withHeal: heal, saveHints: save, qaFeedback: note, saveAsHistoricalSkill: saveAsSkill, featureGroup });
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
            {featureGroup && (
              <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8, cursor: 'pointer', userSelect: 'none', padding: '7px 10px', borderRadius: 6, background: saveAsSkill ? 'rgba(139,92,246,0.08)' : 'transparent', border: `1px solid ${saveAsSkill ? 'rgba(139,92,246,0.35)' : 'var(--border)'}`, transition: 'all 0.15s' }}>
                <input type="checkbox" checked={saveAsSkill} onChange={(e) => setSaveAsSkill(e.target.checked)} style={{ width: 14, height: 14, accentColor: 'var(--violet)', cursor: 'pointer', marginTop: 1, flexShrink: 0 }} />
                <div>
                  <span style={{ fontSize: 11, color: saveAsSkill ? 'var(--violet)' : 'var(--text-mid)', fontWeight: saveAsSkill ? 700 : 400 }}>
                    Remember this correction for future <strong style={{ color: 'var(--text)' }}>{featureGroup}</strong> scripts
                  </span>
                  <div style={{ fontSize: 10, color: 'var(--text-dim)', marginTop: 2, lineHeight: 1.5 }}>
                    Saves as a Tier 3 Historical skill — auto-injected whenever a {featureGroup} test case is generated
                  </div>
                </div>
              </label>
            )}

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
  /** Pre-filled from "Fix with AI" button on a failed run result */
  fixContext?: { failedStep?: string; errorMessage?: string };
  onConfirm: (opts: { withHeal: boolean; contextNote: string; saveHints: boolean; scriptMode: 'PLAYWRIGHT' | 'ROBOT'; domSnippet?: string; domRecording?: string; failedStep?: string; failedStepError?: string; referenceTcIds?: string[] }) => void;
  onClose: () => void;
}

function isStructuredHintsJson(raw?: string | null): boolean {
  if (!raw) return false;
  try { const p = JSON.parse(raw); return p?.version === 2; } catch { return false; }
}

function RegenerateModal({ script, tc, fixContext, onConfirm, onClose }: RegenerateModalProps) {
  // Don't pre-populate with raw StructuredHints JSON — only show free-text hints
  const [note, setNote] = useState(!isStructuredHintsJson(tc?.generationHints) ? (tc?.generationHints ?? '') : '');
  const [domSnippet, setDomSnippet] = useState('');
  const [domRecording, setDomRecording] = useState('');
  const [failedStep, setFailedStep] = useState(fixContext?.failedStep ?? '');
  const [failedStepError, setFailedStepError] = useState(fixContext?.errorMessage ?? '');
  const [heal, setHeal] = useState(false);
  const [save, setSave] = useState(false);
  const [busy, setBusy] = useState(false);
  const [showDomHelper, setShowDomHelper] = useState(false);
  const [scriptMode, setScriptMode] = useState<'PLAYWRIGHT' | 'ROBOT'>(
    (script as any).scriptType === 'PLAYWRIGHT' ? 'PLAYWRIGHT' : 'ROBOT',
  );
  const [referenceTcIds, setReferenceTcIds] = useState<string[]>([]);
  const [automatedTcs, setAutomatedTcs] = useState<Array<{ id: string; tcId: string; title: string }>>([]);
  const [prereqOpen, setPrereqOpen] = useState(false);
  const [prereqSearch, setPrereqSearch] = useState('');
  const prereqRef = React.useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!tc?.projectId) return;
    fetch(`/api/projects/${tc.projectId}/scripts`, { headers: { Authorization: `Bearer ${getToken()}` } })
      .then((r) => r.json())
      .then((data: { scripts: Script[] }) => {
        const seen = new Set<string>();
        const tcs = (data.scripts ?? [])
          .filter((s: Script) => s.testCaseId && s.testCase && s.testCaseId !== tc.id)
          .map((s: Script) => ({ id: s.testCaseId!, tcId: s.testCase!.tcId, title: s.testCase!.title }))
          .filter((t: { id: string }) => { if (seen.has(t.id)) return false; seen.add(t.id); return true; });
        setAutomatedTcs(tcs);
      })
      .catch(() => {});
  }, [tc?.id, tc?.projectId]);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (prereqRef.current && !prereqRef.current.contains(e.target as Node)) setPrereqOpen(false);
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  async function handleSubmit() {
    setBusy(true);
    await onConfirm({
      withHeal: scriptMode === 'ROBOT' ? false : heal,
      contextNote: note,
      saveHints: save,
      scriptMode,
      domSnippet: domSnippet.trim() || undefined,
      domRecording: domRecording.trim() || undefined,
      failedStep: failedStep.trim() || undefined,
      failedStepError: failedStepError.trim() || undefined,
      referenceTcIds: referenceTcIds.length > 0 ? referenceTcIds : undefined,
    });
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
          {/* Failed step — auto-filled from "Fix with AI" */}
          {(failedStep || failedStepError) && (
            <div style={{ background: 'rgba(248,113,113,0.07)', border: '1px solid rgba(248,113,113,0.2)', borderRadius: 6, padding: '10px 12px' }}>
              <span style={{ ...LABEL_STYLE, color: 'var(--rose)', marginBottom: 6 }}>⚠ Failed Step (auto-filled from run)</span>
              {failedStep && (
                <div style={{ marginBottom: 6 }}>
                  <span style={{ fontSize: 10, color: 'var(--text-dim)', display: 'block', marginBottom: 2 }}>Step</span>
                  <textarea
                    value={failedStep}
                    onChange={(e) => setFailedStep(e.target.value)}
                    style={{ ...TEXTAREA_STYLE, minHeight: 40, background: 'rgba(248,113,113,0.05)' }}
                  />
                </div>
              )}
              {failedStepError && (
                <div>
                  <span style={{ fontSize: 10, color: 'var(--text-dim)', display: 'block', marginBottom: 2 }}>Error</span>
                  <textarea
                    value={failedStepError}
                    onChange={(e) => setFailedStepError(e.target.value)}
                    style={{ ...TEXTAREA_STYLE, minHeight: 60, fontFamily: 'var(--font-mono)', fontSize: 10, background: 'rgba(248,113,113,0.05)' }}
                  />
                </div>
              )}
            </div>
          )}

          {/* Context note */}
          <div>
            <span style={LABEL_STYLE}>
              📋 Issue description{' '}
              <span style={{ fontWeight: 400, color: 'var(--text-dim)' }}>(optional — guides the script agent)</span>
            </span>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder={'Describe what to fix or improve...\n\nExamples:\n• The submit button selector should be input[type="submit"] not #btn-login\n• After login navigate to /projects before checking the dashboard\n• The route is /#/FinanceUserListReport not /finance/reports\n• Login is two-step: enter username → click Login → enter password → click Login again'}
              style={{ ...TEXTAREA_STYLE, minHeight: 100 }}
              autoFocus={!failedStep}
            />
          </div>

          {/* DOM snippet */}
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
              <span style={{ ...LABEL_STYLE, margin: 0 }}>
                🔍 DOM snippet{' '}
                <span style={{ fontWeight: 400, color: 'var(--text-dim)' }}>(paste from browser DevTools — optional)</span>
              </span>
              <button
                onClick={() => setShowDomHelper(v => !v)}
                style={{ fontSize: 10, color: 'var(--cyan)', background: 'none', border: 'none', cursor: 'pointer', padding: '0 4px' }}
              >
                {showDomHelper ? '▲ Hide helper' : '▼ How to extract'}
              </button>
            </div>
            {showDomHelper && (
              <div style={{ background: 'rgba(34,211,238,0.06)', border: '1px solid rgba(34,211,238,0.15)', borderRadius: 6, padding: '8px 10px', marginBottom: 8, fontSize: 10, color: 'var(--text-mid)', lineHeight: 1.7 }}>
                <strong style={{ color: 'var(--cyan)' }}>How to paste DOM from DevTools:</strong>
                <ol style={{ margin: '4px 0 0', paddingLeft: 16 }}>
                  <li>Right-click the element in Chrome/Edge → <em>Inspect</em></li>
                  <li>In the Elements panel, right-click the highlighted node → <em>Copy → Copy element</em></li>
                  <li>Paste the HTML here</li>
                </ol>
                <p style={{ margin: '6px 0 0' }}>
                  The AI will extract the best locator using: <code style={{ color: 'var(--emerald)' }}>data-testid &gt; id &gt; aria-label &gt; name &gt; text &gt; css</code>
                </p>
              </div>
            )}
            <textarea
              value={domSnippet}
              onChange={(e) => setDomSnippet(e.target.value)}
              placeholder={'<button id="btnLogin" data-testid="login-submit" class="btn btn-primary">\n  Sign In\n</button>'}
              style={{ ...TEXTAREA_STYLE, minHeight: 80, fontFamily: 'var(--font-mono)', fontSize: 10 }}
            />
          </div>

          {/* DOM Recording */}
          <div>
            <span style={LABEL_STYLE}>
              🎬 DOM Recording{' '}
              <span style={{ fontWeight: 400, color: 'var(--text-dim)' }}>(optional — paste output from QA DOM Recorder)</span>
            </span>
            <textarea
              value={domRecording}
              onChange={(e) => {
                if (e.target.value.length <= 78000) setDomRecording(e.target.value);
              }}
              placeholder={'Paste the exported recording from the QA DOM Recorder tool here...'}
              style={{ ...TEXTAREA_STYLE, minHeight: 90, fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--cyan)' }}
            />
            {domRecording.trim() && (
              <p style={{ fontSize: 10, color: 'var(--emerald)', margin: '4px 0 0' }}>
                ✓ Recording attached — agent will use captured selectors as locked locators.
              </p>
            )}
          </div>

          {/* Reference Scripts multi-select */}
          {tc && (
            <div>
              <span style={LABEL_STYLE}>
                📎 Reference Scripts{' '}
                <span style={{ fontWeight: 400, color: 'var(--text-dim)' }}>(optional — agent learns patterns from these verified scripts)</span>
              </span>
              <div ref={prereqRef} style={{ position: 'relative' }}>
                <div
                  onClick={() => setPrereqOpen((o) => !o)}
                  style={{
                    background: 'var(--surface)', border: '1px solid var(--border2)', borderRadius: 6,
                    color: referenceTcIds.length > 0 ? 'var(--text)' : 'var(--text-dim)',
                    fontSize: 11, padding: '7px 10px', cursor: 'pointer',
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between', userSelect: 'none',
                    minHeight: 34,
                  }}
                >
                  {referenceTcIds.length === 0 ? (
                    <span>None — generate without reference scripts</span>
                  ) : (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, flex: 1 }}>
                      {referenceTcIds.map((id) => {
                        const f = automatedTcs.find((t) => t.id === id);
                        return f ? (
                          <span key={id} style={{ fontSize: 10, background: 'rgba(37,99,171,0.25)', border: '1px solid rgba(37,99,171,0.4)', borderRadius: 4, padding: '1px 6px', color: 'var(--cyan)', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                            {f.tcId}
                            <span
                              onMouseDown={(e) => { e.stopPropagation(); setReferenceTcIds((prev) => prev.filter((x) => x !== id)); }}
                              style={{ cursor: 'pointer', opacity: 0.7, lineHeight: 1 }}
                            >×</span>
                          </span>
                        ) : null;
                      })}
                    </div>
                  )}
                  <span style={{ fontSize: 10, flexShrink: 0, marginLeft: 8 }}>▾</span>
                </div>
                {prereqOpen && (
                  <div style={{
                    position: 'absolute', top: '100%', left: 0, right: 0, marginTop: 4, zIndex: 60,
                    background: 'var(--surface)', border: '1px solid var(--border2)', borderRadius: 8,
                    boxShadow: '0 8px 24px rgba(0,0,0,0.4)', overflow: 'hidden',
                    maxHeight: 280, display: 'flex', flexDirection: 'column',
                  }}>
                    <div style={{ padding: 8, borderBottom: '1px solid var(--border)', flexShrink: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
                      <input
                        autoFocus
                        placeholder="Search scripts…"
                        value={prereqSearch}
                        onChange={(e) => setPrereqSearch(e.target.value)}
                        style={{ flex: 1, background: 'var(--surface)', border: '1px solid var(--border2)', borderRadius: 6, color: 'var(--text)', fontSize: 11, padding: '5px 8px', outline: 'none', boxSizing: 'border-box' }}
                      />
                      {referenceTcIds.length > 0 && (
                        <button
                          onMouseDown={(e) => { e.stopPropagation(); setReferenceTcIds([]); }}
                          style={{ background: 'none', border: 'none', color: 'var(--text-dim)', fontSize: 10, cursor: 'pointer', whiteSpace: 'nowrap', padding: '4px 6px' }}
                        >
                          Clear all
                        </button>
                      )}
                    </div>
                    <div style={{ overflowY: 'auto', flex: 1 }}>
                      {automatedTcs
                        .filter((t) => prereqSearch === '' || t.tcId.toLowerCase().includes(prereqSearch.toLowerCase()) || t.title.toLowerCase().includes(prereqSearch.toLowerCase()))
                        .map((t) => {
                          const selected = referenceTcIds.includes(t.id);
                          return (
                            <div
                              key={t.id}
                              onClick={() => {
                                setReferenceTcIds((prev) =>
                                  selected ? prev.filter((x) => x !== t.id) : [...prev, t.id],
                                );
                              }}
                              style={{ padding: '8px 12px', fontSize: 11, cursor: 'pointer', borderTop: '1px solid var(--border)', background: selected ? 'rgba(37,99,171,0.15)' : 'transparent', color: selected ? 'var(--cyan)' : 'var(--text)', display: 'flex', alignItems: 'center', gap: 8 }}
                            >
                              <span style={{ width: 14, height: 14, border: `1.5px solid ${selected ? 'var(--cyan)' : 'var(--border2)'}`, borderRadius: 3, background: selected ? 'var(--cyan)' : 'transparent', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                                {selected && <span style={{ color: 'var(--surface)', fontSize: 9, lineHeight: 1, fontWeight: 700 }}>✓</span>}
                              </span>
                              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--text-dim)', flexShrink: 0 }}>{t.tcId}</span>
                              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>{t.title}</span>
                              <span style={{ flexShrink: 0, fontSize: 8, background: 'rgba(42,157,143,0.15)', color: 'var(--emerald)', padding: '1px 5px', borderRadius: 3, border: '1px solid rgba(42,157,143,0.3)' }}>⚡ automated</span>
                            </div>
                          );
                        })}
                      {automatedTcs.filter((t) => prereqSearch === '' || t.tcId.toLowerCase().includes(prereqSearch.toLowerCase()) || t.title.toLowerCase().includes(prereqSearch.toLowerCase())).length === 0 && (
                        <div style={{ padding: '10px 12px', fontSize: 11, color: 'var(--text-dim)' }}>
                          {prereqSearch ? 'No matches.' : 'No automated scripts found yet.'}
                        </div>
                      )}
                    </div>
                    {referenceTcIds.length > 0 && (
                      <div style={{ padding: '6px 12px', borderTop: '1px solid var(--border)', flexShrink: 0, fontSize: 10, color: 'var(--text-dim)' }}>
                        {referenceTcIds.length} script{referenceTcIds.length !== 1 ? 's' : ''} selected
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}

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

          {/* Script Framework toggle */}
          <div>
            <span style={LABEL_STYLE}>Script Framework</span>
            <div style={{ display: 'flex', gap: 8 }}>
              {(['PLAYWRIGHT', 'ROBOT'] as const).map((v) => (
                <button
                  key={v}
                  onClick={() => setScriptMode(v)}
                  style={{
                    flex: 1, padding: '7px 10px', borderRadius: 6, cursor: 'pointer', fontSize: 11,
                    fontWeight: 700, fontFamily: 'var(--font-ui)',
                    border: scriptMode === v
                      ? (v === 'ROBOT' ? '1px solid rgba(42,157,143,0.6)' : '1px solid rgba(37,99,171,0.6)')
                      : '1px solid var(--border)',
                    background: scriptMode === v
                      ? (v === 'ROBOT' ? 'rgba(42,157,143,0.12)' : 'rgba(37,99,171,0.1)')
                      : 'transparent',
                    color: scriptMode === v ? (v === 'ROBOT' ? 'var(--emerald)' : 'var(--cyan)') : 'var(--text-dim)',
                    transition: 'all 0.15s',
                  }}
                >
                  {v === 'ROBOT' ? '🤖 Robot Framework' : '⚡ Playwright TS'}
                </button>
              ))}
            </div>
            {scriptMode === 'ROBOT' && (
              <p style={{ fontSize: 10, color: 'var(--text-dim)', margin: '6px 0 0', lineHeight: 1.5 }}>
                Generates <code style={{ fontFamily: 'var(--font-mono)', color: 'var(--emerald)' }}>.robot</code> files using RF Browser library — human-readable keywords, easy to correct.
              </p>
            )}
          </div>

          {/* Mode toggle */}
          <div>
            <span style={LABEL_STYLE}>Mode</span>
            <div style={{ display: 'flex', gap: 8 }}>
              {([false, true] as const).map((v) => (
                <button
                  key={String(v)}
                  onClick={() => setHeal(v)}
                  disabled={v && scriptMode === 'ROBOT'}
                  title={v && scriptMode === 'ROBOT' ? 'Heal is not available for Robot Framework scripts' : undefined}
                  style={{
                    flex: 1, padding: '7px 10px', borderRadius: 6, cursor: (v && scriptMode === 'ROBOT') ? 'not-allowed' : 'pointer', fontSize: 11,
                    fontWeight: 700, fontFamily: 'var(--font-ui)',
                    border: heal === v
                      ? (v ? '1px solid rgba(139,92,246,0.6)' : '1px solid rgba(245,158,11,0.5)')
                      : '1px solid var(--border)',
                    background: heal === v
                      ? (v ? 'rgba(139,92,246,0.12)' : 'rgba(245,158,11,0.08)')
                      : 'transparent',
                    color: heal === v ? (v ? 'var(--violet)' : 'var(--amber)') : 'var(--text-dim)',
                    opacity: (v && scriptMode === 'ROBOT') ? 0.4 : 1,
                    transition: 'all 0.15s',
                  }}
                >
                  {v ? '🩹 Regenerate + Heal' : '↺ Regenerate only'}
                </button>
              ))}
            </div>
            {heal && scriptMode !== 'ROBOT' && (
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
  const [conversionNote, setConversionNote] = useState<{ converted: boolean; filename: string } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const upload = useUploadScript(projectId);
  const uploadWithExtract = useUploadScriptWithExtract(projectId);

  const isRobotFile = file?.name.toLowerCase().endsWith('.robot') ?? false;

  const filteredTCs = useMemo(() => {
    const q = search.toLowerCase();
    return testCases
      .filter((tc) => tc.title.toLowerCase().includes(q) || tc.tcId.toLowerCase().includes(q))
      .slice(0, 40);
  }, [testCases, search]);

  async function handleImport() {
    if (!file) {
      toast.error('Select a script file first');
      return;
    }
    setBusy(true);
    try {
      if (importMode === 'create') {
        const result = await uploadWithExtract.mutateAsync(file);
        if (result.converted) {
          toast.success(`Converted SeleniumLibrary → Browser & created TC ${result.testCase.tcId}!`, { duration: 7000 });
        } else {
          toast.success(`Test case ${result.testCase.tcId} created from script!`, { duration: 6000 });
        }
        onClose();
        navigate(`/projects/${slug}/tc-library`);
      } else {
        const tcId = importMode === 'link' ? (selectedTcId || undefined) : undefined;
        const result = await upload.mutateAsync({ file, testCaseId: tcId });
        if (result.converted) {
          setConversionNote({ converted: true, filename: result.filename });
        } else {
          const linked = tcId ? testCases.find((tc) => tc.id === tcId) : null;
          toast.success(linked ? `Imported and linked to ${linked.tcId}` : `Imported ${file.name}`);
          onClose();
        }
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
    { value: 'create',     label: 'Create TC from script', desc: 'QA Infinity extracts the test case automatically — TC created in DRAFT status.' },
    { value: 'link',       label: 'Link to existing TC',   desc: 'Choose a TC from your library to associate this script with.' },
    { value: 'standalone', label: 'Import standalone',     desc: 'No TC — custom script only.' },
  ];

  return (
    <div style={MODAL_OVERLAY} onClick={onClose}>
      <div style={MODAL_BOX} onClick={(e) => e.stopPropagation()}>
        <div style={MODAL_HEADER}>
          <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>⬆ Import Script</span>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--text-dim)', fontSize: 16, cursor: 'pointer', lineHeight: 1 }}>×</button>
        </div>

        <div style={MODAL_BODY}>
          {/* Conversion result banner — shown after a SeleniumLibrary robot was converted */}
          {conversionNote && (
            <div style={{
              padding: '10px 12px', borderRadius: 6,
              background: 'rgba(42,157,143,0.1)',
              border: '1px solid rgba(42,157,143,0.4)',
              fontSize: 11, lineHeight: 1.6,
            }}>
              <div style={{ fontWeight: 700, color: 'var(--emerald)', marginBottom: 4 }}>
                ✅ Converted: SeleniumLibrary → Browser library
              </div>
              <div style={{ color: 'var(--text-mid)' }}>
                Saved as <code style={{ fontFamily: 'var(--font-mono)' }}>{conversionNote.filename}</code> using RF Browser library (Playwright backend).
              </div>
              <button
                onClick={onClose}
                style={{ marginTop: 8, padding: '4px 12px', borderRadius: 5, border: 'none', cursor: 'pointer', fontSize: 11, fontWeight: 700, background: 'var(--surface3)', color: 'var(--text-mid)', fontFamily: 'var(--font-ui)' }}
              >
                Done
              </button>
            </div>
          )}

          {!conversionNote && <>
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
              </p>
            </div>

            {/* File picker */}
            <div>
              <span style={LABEL_STYLE}>
                Script File <span style={{ color: '#f87171', fontWeight: 400 }}>*</span>
                {isRobotFile && (
                  <span style={{ marginLeft: 6, color: 'var(--emerald)', fontWeight: 400 }}>
                    🤖 Robot Framework — SeleniumLibrary will be auto-converted if detected
                  </span>
                )}
              </span>
              <button
                onClick={() => fileRef.current?.click()}
                style={{
                  width: '100%', padding: '18px 12px',
                  border: `2px dashed ${file ? (isRobotFile ? 'var(--emerald)' : 'var(--violet)') : 'var(--border)'}`,
                  borderRadius: 8, background: file ? (isRobotFile ? 'rgba(42,157,143,0.06)' : 'rgba(139,92,246,0.06)') : 'transparent',
                  cursor: 'pointer', color: file ? 'var(--text)' : 'var(--text-dim)',
                  fontSize: 12, fontFamily: 'var(--font-ui)', textAlign: 'center',
                  transition: 'all 0.15s',
                }}
              >
                {file ? `📄 ${file.name}` : '+ Click to select .spec.ts, .spec.js, or .robot'}
              </button>
              <input
                ref={fileRef}
                type="file"
                accept=".spec.ts,.spec.js,.robot"
                style={{ display: 'none' }}
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              />
            </div>

            {/* TC selector — only shown in 'link' mode */}
            {importMode === 'link' && (
              <div>
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
              </div>
            )}
          </>}
        </div>

        {!conversionNote && (
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
                ? (importMode === 'create' ? 'Extracting TC…' : (isRobotFile ? 'Converting…' : 'Importing…'))
                : (importMode === 'create' ? '⬆ Import & Create TC' : '⬆ Import')}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Main page ───────────────────────────────────────────────────────────────

// ── RF Go-to-Definition helper ───────────────────────────────────────────────
// Scans the line at `position` for a keyword from the index.
// Returns the matching keyword name, or null. Handles multi-word RF keywords
// by checking full phrase matches rather than single-word tokenisation.
function findRFKeywordAtPosition(
  model: any,
  position: { lineNumber: number; column: number },
  index: Record<string, { filename: string; line: number }>,
): string | null {
  if (!model || !position) return null;
  const lineContent: string = model.getLineContent(position.lineNumber);
  const col = position.column; // 1-based
  const lineLower = lineContent.toLowerCase();
  // Sort by length descending so longer matches win (e.g. "Login As Admin" before "Login")
  const keywords = Object.keys(index).sort((a, b) => b.length - a.length);
  for (const kw of keywords) {
    const kwLower = kw.toLowerCase();
    let searchFrom = 0;
    while (true) {
      const idx = lineLower.indexOf(kwLower, searchFrom);
      if (idx === -1) break;
      const start = idx + 1; // convert to 1-based column
      const end = idx + kw.length + 1; // exclusive
      if (col >= start && col < end) return kw;
      searchFrom = idx + 1;
    }
  }
  return null;
}

export default function Scripts() {
  const { slug } = useParams<{ slug: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { canWrite } = useRBAC();
  const { open: openChat } = useChatSidebarStore();
  const { mode: appMode, novncPort } = useAppConfig();
  const isRunner = appMode === 'runner';

  const { data: project } = useProject(slug);
  const projectId = project?.id;

  const { data: scripts = [] } = useScripts(projectId);
  const { data: tcData, isLoading: tcsLoading } = useTestCases(projectId, { limit: 500 });
  const { data: useCases = [] } = useUseCases(projectId);

  const save = useSaveScriptContent(projectId ?? '');
  const deleteScriptMutation = useDeleteScript(projectId ?? '');
  const createIndividualRun = useCreateIndividualRun(projectId ?? '');
  const { data: envConfigs = [] } = useProjectEnvConfigs(projectId);

  // ── Resources state ────────────────────────────────────────────────────────
  const { data: resources = [] } = useResources(projectId);
  const saveResource = useSaveResource(projectId ?? '');
  const { setSelected: setExecutionSelected } = useExecutionStore();

  // ── Derived data ─────────────────────────────────────────────────────────

  const { data: skillsDataForPromote } = useSkills(projectId);
  const existingFeatureGroups = Array.from(new Set(
    (skillsDataForPromote?.skills ?? [])
      .map((s: ProjectSkill) => s.featureGroup)
      .filter(Boolean) as string[]
  ));

  const allTCs = tcData?.testCases ?? [];

  const tcIdToScript = useMemo(() => {
    const m = new Map<string, Script>();
    const scriptById = new Map<string, Script>(scripts.map((s) => [s.id, s]));
    for (const s of scripts) {
      if (s.testCaseId) m.set(s.testCaseId, s);
    }
    for (const tc of allTCs) {
      if (tc.linkedScriptId && !m.has(tc.id)) {
        const s = scriptById.get(tc.linkedScriptId);
        if (s) m.set(tc.id, s);
      }
    }
    return m;
  }, [scripts, allTCs]);

  const scriptedTcIds = useMemo(() => new Set(tcIdToScript.keys()), [tcIdToScript]);
  const pendingCount = allTCs.filter((tc) => !scriptedTcIds.has(tc.id)).length;

  const groups = useMemo(() => buildGroups(allTCs, useCases), [allTCs, useCases]);

  const [tcSearch, setTcSearch] = useState('');

  const filteredGroups = useMemo(() => {
    const q = tcSearch.trim().toLowerCase();
    if (!q) return groups;
    return groups
      .map((g) => ({
        ...g,
        tcs: g.tcs.filter(
          (tc) =>
            tc.title.toLowerCase().includes(q) ||
            tc.tcId.toLowerCase().includes(q),
        ),
      }))
      .filter((g) => g.tcs.length > 0);
  }, [groups, tcSearch]);

  // ── Left panel state ─────────────────────────────────────────────────────

  const [leftTab, setLeftTab] = useState<'tcs' | 'projectFiles'>('tcs');
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

  // Bulk quick-generate always runs without heal; per-generation modals have their own toggle.
  const withHeal = false;

  // ── Generate context modal state ─────────────────────────────────────────

  const [showGenModal, setShowGenModal] = useState(false);
  const [genModalInitNote, setGenModalInitNote] = useState('');

  // ── Promote to Reference Skill modal state ────────────────────────────────

  const [showPromoteModal, setShowPromoteModal] = useState(false);

  // ── Retry feedback modal state ────────────────────────────────────────────

  const [retryJob, setRetryJob] = useState<ScriptJob | null>(null);

  // ── Regenerate modal state ────────────────────────────────────────────────

  const [showRegenModal, setShowRegenModal] = useState(false);
  const [regenFixContext, setRegenFixContext] = useState<{ failedStep?: string; errorMessage?: string } | undefined>();

  // ── Execution Monitor state ────────────────────────────────────────────────

  const [showMonitor, setShowMonitor] = useState(false);
  const [monitorRunId, setMonitorRunId] = useState<string | null>(null);
  const [monitorScript, setMonitorScript] = useState('');

  // ── Quick-run state (▶ Run from editor toolbar) ───────────────────────────

  const [scanningTags, setScanningTags] = useState(false);

  const [quickRunId, setQuickRunId] = useState<string | null>(null);
  const [quickRunning, setQuickRunning] = useState(false);
  const { data: quickRunData } = useRun(projectId, quickRunId);
  const quickRunStatus = quickRunData?.status ?? null;

  // ── Host-browser run state (▶ Run in Host Browser) ───────────────────────

  const [hostRunId, setHostRunId] = useState<string | null>(null);
  const [hostRunning, setHostRunning] = useState(false);
  const { data: hostRunData } = useRun(projectId, hostRunId);
  const hostRunStatus = hostRunData?.status ?? null;

  // ── Playwright codegen recording state ───────────────────────────────────

  const [showRecordModal, setShowRecordModal] = useState(false);
  const [recordUrl, setRecordUrl] = useState('');
  const [recordSessionId, setRecordSessionId] = useState('');
  const [recordingActive, setRecordingActive] = useState(false);
  const [recordBusy, setRecordBusy] = useState(false);
  const [recordBusyLabel, setRecordBusyLabel] = useState('');
  const [recordedScript, setRecordedScript] = useState('');
  const [_recordedPlaywrightCode, setRecordedPlaywrightCode] = useState('');

  async function handleStartRecording() {
    if (!projectId || !recordUrl.trim()) return;
    setRecordBusy(true);
    const sid = `rec-${Date.now()}`;
    try {
      await api.post(`/projects/${projectId}/scripts/record/start`, { url: recordUrl, sessionId: sid });
      setRecordSessionId(sid);
      setRecordingActive(true);
      window.open(`http://${window.location.hostname}:${novncPort}/vnc.html?autoconnect=1&resize=remote&quality=6`, '_blank');
      toast.success('Recording started — interact with the browser in the noVNC tab');
    } catch {
      toast.error('Failed to start recording — is the runner container running?');
    } finally {
      setRecordBusy(false);
    }
  }

  async function handleStopRecording() {
    if (!projectId || !recordSessionId) return;
    setRecordBusy(true);
    setRecordBusyLabel('Stopping…');
    try {
      // Step 1: stop the runner process (fast — just kills codegen and reads file)
      const stopRes = await api.post<{ ok?: boolean; playwrightCode?: string; error?: string }>(
        `/projects/${projectId}/scripts/record/stop`,
        { sessionId: recordSessionId },
      );
      setRecordingActive(false);
      const pwCode = stopRes.data.playwrightCode ?? '';
      if (!pwCode.trim()) {
        toast('No actions were recorded', { icon: 'ℹ️' });
        return;
      }
      setRecordedPlaywrightCode(pwCode);

      // Step 2: convert Playwright TS → RF via LLM (slow — separate call, no timeout risk)
      setRecordBusyLabel('Converting to Robot Framework…');
      const convertRes = await api.post<{ ok?: boolean; robotScript?: string }>(
        `/projects/${projectId}/scripts/record/convert`,
        { playwrightCode: pwCode, testCaseName: activeScript?.testCase?.title ?? 'Recorded Test' },
        { timeout: 180_000 },
      );
      setRecordedScript(convertRes.data.robotScript ?? '');
      toast.success('Recording converted — review the script below');
    } catch {
      toast.error('Failed to stop recording');
    } finally {
      setRecordBusy(false);
      setRecordBusyLabel('');
    }
  }

  function handleAcceptRecordedScript() {
    if (!recordedScript) return;
    if (!activeTabId) {
      toast('Open a test case script on the left first, then accept', { icon: '⚠️' });
      return;
    }
    setTabContents((prev) => ({ ...prev, [activeTabId]: recordedScript }));
    setDirtyTabs((prev) => new Set(prev).add(activeTabId));
    setRecordedScript('');
    setShowRecordModal(false);
    toast.success('Recorded script loaded into editor — save when ready');
  }

  async function handleScanTags() {
    if (!projectId) return;
    setScanningTags(true);
    try {
      const { data } = await api.post<{ linked: number }>(`/projects/${projectId}/scripts/scan-tags`);
      if (data.linked > 0) {
        toast.success(`Linked ${data.linked} TC${data.linked !== 1 ? 's' : ''} via [Tags]`);
        void qc.invalidateQueries({ queryKey: ['testCases', projectId] });
      } else {
        toast('No new TC links found via [Tags]', { icon: 'ℹ️' });
      }
    } catch {
      toast.error('Tag scan failed');
    } finally {
      setScanningTags(false);
    }
  }

  async function handleQuickRun() {
    if (!projectId || !activeScriptTcId) return;
    // No EnvConfig row is fine — many projects are self-contained (URLs baked
    // into the script/resource files), so fall back to a plain env name and
    // let the runner proceed without injecting a base URL/credentials.
    const defaultEnv = envConfigs.find((e) => e.isDefault) ?? envConfigs[0];
    const environmentName = defaultEnv?.name ?? 'Dev';
    // Auto-save first if dirty
    if (activeTabId && dirtyTabs.has(activeTabId)) {
      try {
        await save.mutateAsync({ scriptId: activeTabId, content: tabContents[activeTabId] ?? '' });
        setDirtyTabs((prev) => { const n = new Set(prev); n.delete(activeTabId); return n; });
      } catch {
        toast.error('Save failed — cannot run unsaved script.');
        return;
      }
    }
    setQuickRunning(true);
    setQuickRunId(null);
    try {
      const run = await createIndividualRun.mutateAsync({
        testCaseId: activeScriptTcId,
        environment: environmentName,
      });
      setQuickRunId(run.id);
      // Open execution monitor
      setMonitorRunId(run.id);
      setMonitorScript(activeScript?.filename ?? 'script');
      setShowMonitor(true);
    } catch (err) {
      toast.error((err as Error)?.message ?? 'Failed to start run');
      setQuickRunning(false);
    }
  }

  async function handleHostBrowserRun() {
    if (!projectId || !activeScriptTcId) return;
    // No EnvConfig row is fine — see handleQuickRun.
    const defaultEnv = envConfigs.find((e) => e.isDefault) ?? envConfigs[0];
    const environmentName = defaultEnv?.name ?? 'Dev';
    if (activeTabId && dirtyTabs.has(activeTabId)) {
      try {
        await save.mutateAsync({ scriptId: activeTabId, content: tabContents[activeTabId] ?? '' });
        setDirtyTabs((prev) => { const n = new Set(prev); n.delete(activeTabId); return n; });
      } catch {
        toast.error('Save failed — cannot run unsaved script.');
        return;
      }
    }
    setHostRunning(true);
    setHostRunId(null);
    try {
      const run = await createIndividualRun.mutateAsync({
        testCaseId: activeScriptTcId,
        environment: environmentName,
        hostBrowser: true,
      });
      setHostRunId(run.id);
      setMonitorRunId(run.id);
      setMonitorScript(activeScript?.filename ?? 'script');
      setShowMonitor(true);

      // Wait for the runner to allocate a VNC session slot (or report all busy)
      const sock = io(`${window.location.protocol}//${window.location.host}/runs`, {
        auth: { token: getToken() },
        transports: ['websocket', 'polling'],
      });
      sock.emit('joinRun', { runId: run.id });
      const vncTimeout = setTimeout(() => { sock.disconnect(); }, 20_000);
      sock.once('run:vnc', (data: { token?: string; busy?: boolean }) => {
        clearTimeout(vncTimeout);
        sock.disconnect();
        if (data.token) {
          const vncUrl = `http://${window.location.hostname}:${novncPort}/vnc.html?path=websockify%3Ftoken%3D${data.token}&autoconnect=1&resize=scale`;
          window.open(vncUrl, 'qa-vnc-viewer');
        } else {
          toast('VNC viewer unavailable — all 2 sessions in use. Run executing without visual monitoring.', { icon: '⚠️' });
        }
      });
    } catch (err) {
      toast.error((err as Error)?.message ?? 'Failed to start host-browser run');
      setHostRunning(false);
    }
  }

  // Once run finishes, stop the "running" spinner
  useEffect(() => {
    if (quickRunStatus && quickRunStatus !== 'PENDING' && quickRunStatus !== 'RUNNING') {
      setQuickRunning(false);
    }
  }, [quickRunStatus]);

  useEffect(() => {
    if (hostRunStatus && hostRunStatus !== 'PENDING' && hostRunStatus !== 'RUNNING') {
      setHostRunning(false);
    }
  }, [hostRunStatus]);

  // ── Import script modal state ─────────────────────────────────────────────

  const [showImportModal, setShowImportModal] = useState(false);
  const [importPreTcId, setImportPreTcId] = useState('');

  function handleOpenImport(tcId = '') {
    setImportPreTcId(tcId);
    setShowImportModal(true);
  }

  // ── Project Files tab ─────────────────────────────────────────────────────
  const [fileTree, setFileTree] = useState<FileTreeNode[]>([]);
  const [fileTreeLoading, setFileTreeLoading] = useState(false);
  const [fileTreeError, setFileTreeError] = useState(false);
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(new Set());
  // '' means the project root — the last-clicked folder is where Upload/New Folder land
  const [selectedFolder, setSelectedFolder] = useState('');

  async function loadFileTree() {
    if (!projectId) return;
    setFileTreeLoading(true);
    setFileTreeError(false);
    try {
      const { data } = await api.get(`/projects/${projectId}/scripts/file-tree`);
      setFileTree(data);
      // Auto-expand top-level dirs
      setExpandedDirs(new Set((data as FileTreeNode[]).filter(n => n.type === 'dir').map(n => n.path)));
    } catch {
      setFileTreeError(true);
    }
    setFileTreeLoading(false);
  }

  // Reload tree when projectId becomes available while on the projectFiles tab
  useEffect(() => {
    if (leftTab === 'projectFiles' && projectId) loadFileTree();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, leftTab]);

  function toggleDir(p: string) {
    setExpandedDirs(prev => {
      const next = new Set(prev);
      next.has(p) ? next.delete(p) : next.add(p);
      return next;
    });
  }

  async function downloadProjectFile(relPath: string) {
    try {
      const resp = await api.get(`/projects/${projectId}/scripts/project-file/download`, {
        params: { path: relPath }, responseType: 'blob',
      });
      const url = URL.createObjectURL(resp.data as Blob);
      const a = document.createElement('a'); a.href = url; a.download = relPath.split('/').pop() ?? 'file';
      document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
    } catch { toast.error('Download failed'); }
  }

  async function downloadFolderZip(relPath?: string) {
    try {
      const resp = await api.get(`/projects/${projectId}/scripts/project-file/download-zip`, {
        params: relPath ? { path: relPath } : {}, responseType: 'blob',
      });
      const name = (relPath ? relPath.split('/').pop() : projectId) ?? 'scripts';
      const url = URL.createObjectURL(resp.data as Blob);
      const a = document.createElement('a'); a.href = url; a.download = `${name}.zip`;
      document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
    } catch { toast.error('Zip download failed'); }
  }

  async function deleteProjectEntry(relPath: string) {
    try {
      await api.delete(`/projects/${projectId}/scripts/project-file`, { params: { path: relPath } });
      toast.success('Deleted');
      loadFileTree();
    } catch (err: any) {
      toast.error(err?.response?.data?.error ?? 'Delete failed', { duration: 6000 });
    }
  }

  function handleOpenFileFromTree(path: string) {
    const filename = path.split('/').pop() ?? path;
    const matchedScript = scripts.find(s => s.filename === filename);
    if (matchedScript) { openTab(matchedScript); return; }
    const matchedResource = resources.find(r => (r.filename.split('/').pop() ?? r.filename) === filename);
    if (matchedResource) { openResourceTab(matchedResource.filename); return; }
    // Not a linked Script or a resourcesDir-scoped resource — open generically by
    // its full path. openProjectFileTab itself falls back to a download if the
    // file turns out to be binary (xlsx, images, etc.).
    void openProjectFileTab(path);
  }

  // ── Project-wide file search ("Find in Files") ────────────────────────────
  const [fileSearchOpen, setFileSearchOpen] = useState(false);
  const [fileSearchQuery, setFileSearchQuery] = useState('');
  const [fileSearchGroups, setFileSearchGroups] = useState<FileSearchGroup[]>([]);
  const [fileSearchLoading, setFileSearchLoading] = useState(false);

  useEffect(() => {
    if (!fileSearchOpen) return;
    const q = fileSearchQuery.trim();
    if (q.length < 2) { setFileSearchGroups([]); return; }
    const timer = setTimeout(async () => {
      setFileSearchLoading(true);
      try {
        const { data } = await api.get(`/projects/${projectId}/scripts/search`, { params: { q } });
        setFileSearchGroups(data.groups ?? []);
      } catch {
        setFileSearchGroups([]);
      } finally {
        setFileSearchLoading(false);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [fileSearchQuery, fileSearchOpen, projectId]);

  function openSearchResult(path: string, line: number) {
    const filename = path.split('/').pop() ?? path;
    const matchedScript = scripts.find(s => s.filename === filename);
    if (matchedScript) { pendingRevealLineRef.current = line; openTab(matchedScript); return; }
    const matchedResource = resources.find(r => (r.filename.split('/').pop() ?? r.filename) === filename);
    if (matchedResource) { openResourceTab(matchedResource.filename, line); return; }
    void openProjectFileTab(path, line);
  }

  // ── Import folder (zip) ───────────────────────────────────────────────────
  const importFolderRef = useRef<HTMLInputElement>(null);
  const [importConfirmFile, setImportConfirmFile] = useState<File | null>(null);

  async function handleImportFolder(file: File, createTCs = true) {
    setImportConfirmFile(null);
    const toastId = toast.loading('Importing zip…');
    try {
      const form = new FormData();
      form.append('folder', file);
      form.append('createTCs', createTCs ? 'true' : 'false');
      const { data } = await api.post(`/projects/${projectId}/scripts/import-folder`, form, {
        headers: { 'Content-Type': 'multipart/form-data' },
        timeout: 30 * 60 * 1000, // large project folders can take minutes to upload + import
      });
      toast.success(
        `Imported ${data.imported?.length ?? 0} scripts, ${data.resourceFiles ?? 0} resource files` +
        (data.warnings?.length ? ` (${data.warnings.length} warnings)` : ''),
        { id: toastId, duration: 5000 },
      );
      qc.invalidateQueries({ queryKey: ['scripts', projectId] });
      qc.invalidateQueries({ queryKey: ['test-cases', projectId] });
      loadFileTree();
    } catch (err: any) {
      toast.error(err?.response?.data?.error ?? 'Import failed', { id: toastId });
    }
  }

  // ── Upload a single file / create a folder anywhere in Project Files ───────
  const projectFileUploadRef = useRef<HTMLInputElement>(null);
  const uploadTargetFolderRef = useRef('');

  function handleUploadToFolder(folderPath: string) {
    uploadTargetFolderRef.current = folderPath;
    projectFileUploadRef.current?.click();
  }

  async function handleProjectFilesSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    e.target.value = '';
    if (files.length === 0) return;
    const folder = uploadTargetFolderRef.current;
    const toastId = toast.loading(`Uploading ${files.length} file${files.length !== 1 ? 's' : ''}…`);
    let ok = 0;
    const failures: string[] = [];
    for (const file of files) {
      try {
        const form = new FormData();
        form.append('file', file);
        form.append('folder', folder);
        await api.post(`/projects/${projectId}/scripts/project-file/upload`, form, {
          headers: { 'Content-Type': 'multipart/form-data' },
        });
        ok++;
      } catch (err: any) {
        failures.push(`${file.name}: ${err?.response?.data?.error ?? 'failed'}`);
      }
    }
    if (failures.length === 0) {
      toast.success(`Uploaded ${ok} file${ok !== 1 ? 's' : ''}`, { id: toastId });
    } else {
      toast.error(`Uploaded ${ok}/${files.length} — ${failures.join('; ')}`, { id: toastId, duration: 8000 });
    }
    loadFileTree();
  }

  async function handleCreateFolder(parentPath: string) {
    const name = window.prompt(parentPath ? `New folder inside "${parentPath}":` : 'New folder name:');
    if (!name || !name.trim()) return;
    const fullPath = parentPath ? `${parentPath}/${name.trim()}` : name.trim();
    try {
      await api.post(`/projects/${projectId}/scripts/project-file/mkdir`, { path: fullPath });
      toast.success('Folder created');
      loadFileTree();
    } catch (err: any) {
      toast.error(err?.response?.data?.error ?? 'Failed to create folder');
    }
  }

  async function handleMoveItem(fromPath: string, toFolder: string) {
    if (fromPath === toFolder) return;
    try {
      await api.post(`/projects/${projectId}/scripts/project-file/move`, { from: fromPath, to: toFolder });
      toast.success(`Moved to ${toFolder || 'project root'}`);
      loadFileTree();
      qc.invalidateQueries({ queryKey: ['scripts', projectId] });
    } catch (err: any) {
      toast.error(err?.response?.data?.error ?? 'Move failed');
    }
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

  const [openTabs, setOpenTabs] = useState<EditorTab[]>([]);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);
  const [tabContents, setTabContents] = useState<Record<string, string>>({});
  const [dirtyTabs, setDirtyTabs] = useState<Set<string>>(new Set());
  const [loadingContent, setLoadingContent] = useState(false);

  // ── Go-to-Definition refs ─────────────────────────────────────────────────
  const monacoEditorRef = useRef<any>(null);
  const pendingRevealLineRef = useRef<number | null>(null);
  const keywordIndexRef = useRef<Record<string, { filename: string; line: number }>>({});
  const rfLangRegisteredRef = useRef(false);
  const openResourceTabRef = useRef<(filename: string, line?: number) => void>(() => {});

  const activeTab = openTabs.find((t) => t.id === activeTabId) ?? null;
  const activeScript = activeTab?.kind === 'script' ? activeTab.script : null;
  const activeContent = activeTabId ? (tabContents[activeTabId] ?? '') : '';
  const activeTc = allTCs.find((tc) => tc.id === activeScript?.testCaseId)
    ?? allTCs.find((tc) => tc.linkedScriptId === activeScript?.id)
    ?? undefined;
  const activeScriptTcId = activeTc?.id ?? activeScript?.testCaseId ?? undefined;

  // Clear run badges when the user switches to a different script tab
  useEffect(() => {
    setQuickRunId(null); setQuickRunning(false);
    setHostRunId(null);  setHostRunning(false);
  }, [activeTabId]);

  // ── Open a tab ───────────────────────────────────────────────────────────

  const openTab = useCallback(
    async (script: Script) => {
      const tab: EditorTab = { kind: 'script', id: script.id, filename: script.filename, script };
      setActiveTabId(script.id);
      if (!openTabs.find((t) => t.id === script.id)) {
        setOpenTabs((prev) => [...prev, tab]);
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

  const openResourceTab = useCallback(
    async (filename: string, revealLine?: number) => {
      if (revealLine) pendingRevealLineRef.current = revealLine;
      const tabId = `resource:${filename}`;
      const tab: EditorTab = { kind: 'resource', id: tabId, filename };
      setActiveTabId(tabId);
      if (!openTabs.find((t) => t.id === tabId)) {
        setOpenTabs((prev) => [...prev, tab]);
      }
      if (!tabContents[tabId] && projectId) {
        setLoadingContent(true);
        try {
          const res = await api.get<{ content: string }>(
            `/projects/${projectId}/resources/${filename}/content`,
          );
          setTabContents((prev) => ({ ...prev, [tabId]: res.data.content }));
        } catch {
          toast.error('Failed to load resource content');
        } finally {
          setLoadingContent(false);
        }
      }
    },
    [openTabs, tabContents, projectId],
  );

  // Opens ANY project file by its full relative path — used by file-tree clicks
  // and "Find in Files" search results for files that aren't a linked Script or
  // a resourcesDir-scoped resource (e.g. a project imported with its own custom
  // folder layout). Falls back to a plain download if the file is binary.
  const openProjectFileTab = useCallback(
    async (relPath: string, revealLine?: number) => {
      if (!projectId) return;
      if (revealLine) pendingRevealLineRef.current = revealLine;
      const tabId = `pf:${relPath}`;
      const filename = relPath.split('/').pop() ?? relPath;
      const tab: EditorTab = { kind: 'projectFile', id: tabId, filename, relPath };
      if (!openTabs.find((t) => t.id === tabId)) {
        setOpenTabs((prev) => [...prev, tab]);
      }
      setActiveTabId(tabId);
      if (!tabContents[tabId]) {
        setLoadingContent(true);
        try {
          const res = await api.get<{ content: string }>(
            `/projects/${projectId}/scripts/project-file/content`,
            { params: { path: relPath } },
          );
          setTabContents((prev) => ({ ...prev, [tabId]: res.data.content }));
        } catch (err: any) {
          setOpenTabs((prev) => prev.filter((t) => t.id !== tabId));
          if (err?.response?.status === 415) {
            downloadProjectFile(relPath);
          } else {
            toast.error(err?.response?.data?.error ?? 'Failed to open file');
          }
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
    const tab = openTabs.find((t) => t.id === activeTabId);
    if (!tab) return;
    try {
      if (tab.kind === 'resource') {
        await saveResource.mutateAsync({ filename: tab.filename, content: tabContents[activeTabId] ?? '' });
      } else if (tab.kind === 'projectFile') {
        await api.put(`/projects/${projectId}/scripts/project-file/content`, { content: tabContents[activeTabId] ?? '' }, { params: { path: tab.relPath } });
      } else {
        await save.mutateAsync({ scriptId: activeTabId, content: tabContents[activeTabId] ?? '' });
      }
      setDirtyTabs((prev) => { const n = new Set(prev); n.delete(activeTabId); return n; });
      toast.success('Saved');
    } catch {
      toast.error('Save failed');
    }
  }, [activeTabId, dirtyTabs, tabContents, openTabs, save, saveResource, projectId]);

  // ── Ctrl+S ───────────────────────────────────────────────────────────────

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        saveActiveTab();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [saveActiveTab]);

  // Keep openResourceTabRef pointing at the latest callback (avoids stale closure in onMount)
  useEffect(() => { openResourceTabRef.current = openResourceTab; }, [openResourceTab]);

  // Fetch keyword index whenever the project changes
  useEffect(() => {
    if (!projectId) return;
    api.get<Record<string, { filename: string; line: number }>>(`/projects/${projectId}/resources/keywords/index`)
      .then((res) => { keywordIndexRef.current = res.data; })
      .catch(() => {});
  }, [projectId]);

  // After switching to a resource tab, reveal the pending line once content is loaded
  useEffect(() => {
    const line = pendingRevealLineRef.current;
    if (!line || !activeTabId || !monacoEditorRef.current) return;
    if (!tabContents[activeTabId]) return;
    pendingRevealLineRef.current = null;
    setTimeout(() => {
      monacoEditorRef.current?.revealLineInCenter(line);
      monacoEditorRef.current?.setPosition({ lineNumber: line, column: 1 });
    }, 80);
  }, [activeTabId, tabContents]);

  // ── Open TC's script in editor ────────────────────────────────────────────

  function handleOpenTCScript(tcDbId: string) {
    const script = tcIdToScript.get(tcDbId);
    if (script) { openTab(script); }
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
    // Pre-populate hints if exactly 1 TC selected and it has free-text (not JSON) hints
    if (tcSelected.size === 1) {
      const [singleId] = tcSelected;
      const tc = allTCs.find((t) => t.id === singleId);
      const hints = tc?.generationHints ?? '';
      setGenModalInitNote(!isStructuredHintsJson(hints) ? hints : '');
    } else {
      setGenModalInitNote('');
    }
    setShowGenModal(true);
  }

  async function handleModalConfirmGenerate(opts: { contextNote: string; saveHints: boolean; scriptMode: 'PLAYWRIGHT' | 'ROBOT'; skillIds: string[] }) {
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
        {
          testCaseIds: ids,
          withHeal: false,
          contextNote: opts.contextNote || undefined,
          scriptMode: opts.scriptMode,
          skillIds: opts.skillIds.length > 0 ? opts.skillIds : undefined,
        },
        { timeout: 30_000 },
      );
      const label = opts.scriptMode === 'ROBOT' ? '🤖 Robot' : '⚡ generate';
      toast.success(`Queued ${ids.length} script${ids.length !== 1 ? 's' : ''} (${label})`);
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

  async function handleRetryConfirm(opts: { contextNote: string; withHeal: boolean; saveHints: boolean; qaFeedback: string; saveAsHistoricalSkill: boolean; featureGroup: string }) {
    if (!projectId || !retryJob) return;
    const job = retryJob;
    setRetryJob(null);
    try {
      await api.post(
        `/projects/${projectId}/scripts/jobs/${job.id}/retry`,
        {
          contextNote: opts.contextNote || undefined,
          withHeal: opts.withHeal,
          saveHints: opts.saveHints,
          qaFeedback: opts.qaFeedback || undefined,
          saveAsHistoricalSkill: opts.saveAsHistoricalSkill || undefined,
          featureGroup: opts.featureGroup || undefined,
        },
        { timeout: 30_000 },
      );
      toast.success(opts.saveAsHistoricalSkill ? 'Retry queued — correction saved as Historical skill' : 'Retry queued');
    } catch (err) {
      const msg = (err as any)?.response?.data?.error ?? (err as Error)?.message ?? 'Failed to retry';
      toast.error(msg);
    }
  }

  // ── Regenerate active script ──────────────────────────────────────────────

  async function handleRegenConfirm(opts: { withHeal: boolean; contextNote: string; saveHints: boolean; scriptMode: 'PLAYWRIGHT' | 'ROBOT'; domSnippet?: string; domRecording?: string; failedStep?: string; failedStepError?: string; referenceTcIds?: string[] }) {
    if (!projectId || !activeScriptTcId) return;
    setShowRegenModal(false);
    setRegenFixContext(undefined);

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
        {
          testCaseIds: [activeScriptTcId],
          withHeal: opts.scriptMode === 'ROBOT' ? false : opts.withHeal,
          contextNote: opts.contextNote || undefined,
          domSnippet: opts.domSnippet || undefined,
          domRecording: opts.domRecording || undefined,
          failedStep: opts.failedStep || undefined,
          failedStepError: opts.failedStepError || undefined,
          scriptMode: opts.scriptMode,
          referenceTcIds: opts.referenceTcIds?.length ? opts.referenceTcIds : undefined,
        },
        { timeout: 30_000 },
      );
      const label = opts.scriptMode === 'ROBOT' ? '🤖 Robot' : (opts.withHeal ? '↺ Regenerating with heal…' : '↺ Regenerating…');
      toast.success(label);
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

  async function handlePromoteToReferenceSkill(opts: { name: string; featureGroup: string }) {
    if (!projectId || !activeScript || !activeTc) return;
    const scriptBody = (activeTabId && tabContents[activeTabId]) ? tabContents[activeTabId] : '';
    let steps: string[] = [];
    try { steps = typeof activeTc.steps === 'string' ? JSON.parse(activeTc.steps) : activeTc.steps; } catch { steps = []; }
    const content = JSON.stringify({
      tcSnapshot: {
        tcId: activeTc.tcId,
        title: activeTc.title,
        steps,
        expectedResult: activeTc.expectedResult ?? '',
      },
      scriptBody,
      passedAt: new Date().toISOString(),
      sourceScriptId: activeScript.id,
    });
    try {
      await api.post(`/projects/${projectId}/skills`, {
        skillType: 'REFERENCE_SCRIPT',
        name: opts.name,
        featureGroup: opts.featureGroup || null,
        scope: activeTc.tcId,
        content,
        captureMethod: 'MANUALLY_ENTERED',
        confidence: 1.0,
      });
      setShowPromoteModal(false);
      toast.success('Saved as Reference Skill — will be auto-detected for scripts in this feature group');
    } catch {
      toast.error('Failed to save reference skill');
    }
  }

  // ── Delete script ──────────────────────────────────────────────────────────

  async function handleDeleteScript(scriptId: string, label: string) {
    if (!window.confirm(`Delete the script for "${label}"? This removes both the file and its run history. This cannot be undone.`)) return;
    try {
      await deleteScriptMutation.mutateAsync(scriptId);
      closeTab(scriptId);
      loadFileTree();
      toast.success('Script deleted');
    } catch (err: any) {
      toast.error(err?.response?.data?.error ?? 'Failed to delete script');
    }
  }

  // ── Send to execution ─────────────────────────────────────────────────────

  function handleSendToExecution() {
    const tcIds = openTabs.map((t) => t.kind === 'script' ? t.script.testCaseId : null).filter((id): id is string => Boolean(id));
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
          initialNote={genModalInitNote}
          projectId={projectId ?? undefined}
          singleTc={tcSelected.size === 1 ? (() => { const tc = allTCs.find((t) => t.id === [...tcSelected][0]); return tc ? { id: tc.id, tcId: tc.tcId, title: tc.title, projectId: tc.projectId, useCaseTag: tc.useCaseTag } : undefined; })() : undefined}
          onConfirm={handleModalConfirmGenerate}
          onClose={() => setShowGenModal(false)}
          onImportInstead={tcSelected.size === 1
            ? () => handleOpenImport([...tcSelected][0])
            : () => handleOpenImport()
          }
        />
      )}

      {/* Promote to Reference Skill modal */}
      {showPromoteModal && activeTc && activeScript && (
        <PromoteReferenceSkillModal
          tc={{
            tcId: activeTc.tcId,
            title: activeTc.title,
            steps: (() => { try { return typeof activeTc.steps === 'string' ? JSON.parse(activeTc.steps) : activeTc.steps; } catch { return []; } })(),
            expectedResult: activeTc.expectedResult,
            useCaseTag: activeTc.useCaseTag,
          }}
          scriptBody={(activeTabId && tabContents[activeTabId]) ? tabContents[activeTabId] : ''}
          existingFeatureGroups={existingFeatureGroups}
          onConfirm={handlePromoteToReferenceSkill}
          onClose={() => setShowPromoteModal(false)}
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
          fixContext={regenFixContext}
          onConfirm={handleRegenConfirm}
          onClose={() => { setShowRegenModal(false); setRegenFixContext(undefined); }}
        />
      )}

      {/* Execution Monitor — floating resizable */}
      {showMonitor && monitorRunId && projectId && (
        <ExecutionMonitor
          runId={monitorRunId}
          projectId={projectId}
          scriptName={monitorScript}
          onClose={() => setShowMonitor(false)}
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

      {/* ── Playwright Codegen Record Modal ──────────────────────────────── */}
      {showRecordModal && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 1000,
          background: 'rgba(0,0,0,0.65)', display: 'flex', alignItems: 'center', justifyContent: 'center',
        }} onClick={(e) => { if (e.target === e.currentTarget && !recordingActive) setShowRecordModal(false); }}>
          <div style={{
            background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10,
            padding: 28, width: 540, maxWidth: '95vw', display: 'flex', flexDirection: 'column', gap: 18,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ fontWeight: 700, fontSize: 15, color: 'var(--text)' }}>🎥 Record Script with Playwright</span>
              {!recordingActive && (
                <button onClick={() => setShowRecordModal(false)} style={{ background: 'none', border: 'none', color: 'var(--text-dim)', cursor: 'pointer', fontSize: 18 }}>✕</button>
              )}
            </div>

            {!recordingActive && !recordedScript && (
              <>
                <p style={{ color: 'var(--text-dim)', fontSize: 12, margin: 0 }}>
                  Playwright will open a browser on the runner. Perform the test steps manually — every click, fill,
                  and navigation is captured. When done, click <strong>Stop &amp; Convert</strong> to get a ready-to-run RF script.
                </p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <label style={{ fontSize: 11, color: 'var(--text-dim)', fontWeight: 600 }}>START URL</label>
                  <input
                    value={recordUrl}
                    onChange={(e) => setRecordUrl(e.target.value)}
                    placeholder="https://your-app-url.example.com/login"
                    style={{
                      padding: '8px 10px', borderRadius: 6, border: '1px solid var(--border)',
                      background: 'var(--surface-raised)', color: 'var(--text)', fontSize: 13,
                    }}
                  />
                </div>
                <button
                  onClick={handleStartRecording}
                  disabled={recordBusy || !recordUrl.trim()}
                  style={{
                    padding: '10px', borderRadius: 6, border: 'none', cursor: 'pointer',
                    background: 'linear-gradient(135deg, var(--violet), var(--6d-orange-deep))',
                    color: 'white', fontWeight: 700, fontSize: 13,
                    opacity: recordBusy || !recordUrl.trim() ? 0.5 : 1,
                  }}
                >
                  {recordBusy ? 'Starting…' : '▶ Start Recording'}
                </button>
              </>
            )}

            {recordingActive && !recordedScript && (
              <>
                <div style={{
                  display: 'flex', alignItems: 'center', gap: 10,
                  padding: '12px 14px', borderRadius: 8, background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)',
                }}>
                  <span style={{ fontSize: 20 }}>🔴</span>
                  <div>
                    <div style={{ fontWeight: 700, color: 'var(--text)', fontSize: 13 }}>Recording in progress</div>
                    <div style={{ color: 'var(--text-dim)', fontSize: 11 }}>The browser is running on the runner. Interact with it in the noVNC tab that opened.</div>
                  </div>
                </div>
                <a
                  href={`http://${window.location.hostname}:${novncPort}/vnc.html?autoconnect=1&resize=remote&quality=6`}
                  target="_blank"
                  rel="noreferrer"
                  style={{ fontSize: 12, color: 'var(--cyan)', textDecoration: 'underline' }}
                >
                  Open noVNC viewer ↗
                </a>
                <button
                  onClick={handleStopRecording}
                  disabled={recordBusy}
                  style={{
                    padding: '10px', borderRadius: 6, border: 'none', cursor: 'pointer',
                    background: 'rgba(239,68,68,0.85)', color: 'white', fontWeight: 700, fontSize: 13,
                    opacity: recordBusy ? 0.6 : 1,
                  }}
                >
                  {recordBusy ? (recordBusyLabel || 'Stopping…') : '⏹ Stop & Convert to Robot Framework'}
                </button>
              </>
            )}

            {recordedScript && (
              <>
                <div style={{ color: 'var(--text-dim)', fontSize: 12 }}>
                  Conversion complete. Click a test case on the left to open its script, then click <strong>Accept</strong> to load this recording into the editor.
                </div>
                <pre style={{
                  background: 'var(--surface-raised)', border: '1px solid var(--border)', borderRadius: 6,
                  padding: 12, fontSize: 11, color: 'var(--text)', overflowX: 'auto', maxHeight: 320,
                  whiteSpace: 'pre', fontFamily: 'var(--font-mono)',
                }}>
                  {recordedScript}
                </pre>
                <div style={{ display: 'flex', gap: 10 }}>
                  <button
                    onClick={handleAcceptRecordedScript}
                    style={{
                      flex: 1, padding: '9px', borderRadius: 6, border: 'none', cursor: 'pointer',
                      background: 'var(--emerald)', color: 'white', fontWeight: 700, fontSize: 13,
                    }}
                  >
                    ✓ Accept & Load into Editor
                  </button>
                  <button
                    onClick={() => { setRecordedScript(''); setRecordingActive(false); }}
                    style={{
                      padding: '9px 14px', borderRadius: 6, cursor: 'pointer',
                      border: '1px solid var(--border)', background: 'none', color: 'var(--text-dim)', fontSize: 13,
                    }}
                  >
                    Re-record
                  </button>
                  <button
                    onClick={() => setShowRecordModal(false)}
                    style={{
                      padding: '9px 14px', borderRadius: 6, cursor: 'pointer',
                      border: '1px solid var(--border)', background: 'none', color: 'var(--text-dim)', fontSize: 13,
                    }}
                  >
                    Discard
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Topbar */}
      <Topbar
        breadcrumbs={[
          { label: 'Projects', href: '/projects' },
          { label: project?.name ?? slug ?? '', href: `/projects/${slug}/dashboard` },
          { label: isRunner ? '⌨ Scripts' : '⌨ Script Agent' },
        ]}
        actions={
          <>
            {canWrite && (
              <TbBtn
                variant="ghost"
                onClick={handleScanTags}
                disabled={scanningTags}
                title="Scan every script in the project for [Tags] matching a TC ID and link them"
              >
                {scanningTags ? '⏳ Scanning…' : '⟳ Sync Tags'}
              </TbBtn>
            )}
            {canWrite && (
              <TbBtn variant="ghost" onClick={() => handleOpenImport()}>
                ⬆ Import Script
              </TbBtn>
            )}
            {canWrite && !isRunner && (
              <TbBtn
                variant="ghost"
                onClick={() => { setRecordedScript(''); setRecordingActive(false); setShowRecordModal(true); }}
                title="Record a test by interacting with the live app — Playwright captures every action"
              >
                🎥 Record
              </TbBtn>
            )}
            <TbBtn variant="primary" onClick={handleSendToExecution}>
              → Send to Execution
            </TbBtn>
          </>
        }
      />

      {/* Hidden zip file input for Import Folder */}
      <input
        ref={importFolderRef}
        type="file"
        accept=".zip"
        style={{ display: 'none' }}
        onChange={e => { const f = e.target.files?.[0]; if (f) setImportConfirmFile(f); e.target.value = ''; }}
      />

      {/* Hidden file input for uploading individual files into Project Files */}
      <input
        ref={projectFileUploadRef}
        type="file"
        multiple
        style={{ display: 'none' }}
        onChange={handleProjectFilesSelected}
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
              onClick={() => { setLeftTab('projectFiles'); loadFileTree(); }}
              style={{
                flex: 1, padding: '9px 10px', border: 'none', cursor: 'pointer',
                background: leftTab === 'projectFiles' ? 'var(--surface)' : 'transparent',
                borderBottom: leftTab === 'projectFiles' ? '2px solid var(--cyan)' : '2px solid transparent',
                color: leftTab === 'projectFiles' ? 'var(--text)' : 'var(--text-dim)',
                fontSize: 11, fontWeight: 700, fontFamily: 'var(--font-ui)',
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5,
                transition: 'all 0.15s',
              }}
            >
              📁 Project Files
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

                  {/* Search */}
                  <div style={{
                    padding: '6px 10px',
                    borderBottom: '1px solid var(--border)',
                    flexShrink: 0,
                    background: 'var(--surface)',
                  }}>
                    <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                      <span style={{
                        position: 'absolute', left: 8, fontSize: 11,
                        color: 'var(--text-dim)', pointerEvents: 'none',
                      }}>🔍</span>
                      <input
                        type="text"
                        placeholder="Search by title or TC ID…"
                        value={tcSearch}
                        onChange={(e) => setTcSearch(e.target.value)}
                        style={{
                          width: '100%',
                          padding: '5px 26px 5px 26px',
                          fontSize: 11,
                          border: '1px solid var(--border)',
                          borderRadius: 6,
                          background: 'var(--surface2)',
                          color: 'var(--text)',
                          outline: 'none',
                          fontFamily: 'var(--font-ui)',
                        }}
                      />
                      {tcSearch && (
                        <button
                          onClick={() => setTcSearch('')}
                          style={{
                            position: 'absolute', right: 6, background: 'none',
                            border: 'none', cursor: 'pointer', color: 'var(--text-dim)',
                            fontSize: 12, padding: '0 2px', lineHeight: 1,
                          }}
                        >✕</button>
                      )}
                    </div>
                  </div>

                  {/* Groups */}
                  <div style={{ flex: 1, overflowY: 'auto' }}>
                    {tcsLoading ? (
                      <div style={{ padding: 20, textAlign: 'center', fontSize: 12, color: 'var(--text-dim)' }}>
                        Loading…
                      </div>
                    ) : filteredGroups.length === 0 ? (
                      <div style={{ padding: '32px 16px', textAlign: 'center', color: 'var(--text-dim)', fontSize: 12 }}>
                        <div style={{ fontSize: 32, marginBottom: 10 }}>{tcSearch ? '🔍' : '📋'}</div>
                        {tcSearch ? `No results for "${tcSearch}"` : 'No test cases yet.'}
                      </div>
                    ) : (
                      filteredGroups.map((group) => {
                        const isOpen = tcSearch ? true : expandedGroups.has(group.name);
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
                                  onChat={() => {
                                    const prompt = linkedScript
                                      ? `Fix the script for ${tc.tcId} — ${tc.title}`
                                      : `Generate a script for ${tc.tcId} — ${tc.title}`;
                                    openChat({ prompt, context: { tcId: tc.tcId, tcTitle: tc.title, page: 'scripts' } });
                                  }}
                                  onDelete={linkedScript && canWrite ? () => handleDeleteScript(linkedScript.id, `${tc.tcId} — ${tc.title}`) : undefined}
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
                    ) : tcSelected.size > 0 && !isRunner ? (
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

          {/* ── PROJECT FILES TAB ── */}
          {leftTab === 'projectFiles' && (
            <div style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden' }}>
              {/* Toolbar */}
              <div style={{ padding: '8px 10px', borderBottom: '1px solid var(--border)', flexShrink: 0, display: 'flex', gap: 6, alignItems: 'center' }}>
                {canWrite && (
                  <button
                    onClick={() => importFolderRef.current?.click()}
                    style={{
                      flex: 1, padding: '6px 8px',
                      background: 'linear-gradient(90deg, var(--violet), #7c3aed)',
                      border: 'none', borderRadius: 5, cursor: 'pointer',
                      color: '#fff', fontWeight: 700, fontSize: 11,
                      display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4,
                    }}
                  >
                    📦 Import Folder
                  </button>
                )}
                {canWrite && (
                  <button
                    onClick={() => handleUploadToFolder(selectedFolder)}
                    title={`Upload one or more files to ${selectedFolder || 'the project root'}`}
                    style={{ padding: '6px 10px', background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 5, cursor: 'pointer', color: 'var(--text-mid)', fontWeight: 700, fontSize: 11, whiteSpace: 'nowrap' }}
                  >⬆ Upload</button>
                )}
                {canWrite && (
                  <button
                    onClick={() => handleCreateFolder(selectedFolder)}
                    title={`Create a new folder inside ${selectedFolder || 'the project root'}`}
                    style={{ padding: '5px 8px', background: 'transparent', border: '1px solid var(--border)', borderRadius: 5, cursor: 'pointer', color: 'var(--text-mid)', fontSize: 13 }}
                  >📁+</button>
                )}
                <button
                  onClick={() => downloadFolderZip(undefined)}
                  style={{ padding: '5px 8px', background: 'transparent', border: '1px solid var(--border)', borderRadius: 5, cursor: 'pointer', color: 'var(--text-mid)', fontSize: 13 }}
                  title="Download all as zip"
                >⬇</button>
                <button
                  onClick={() => loadFileTree()}
                  style={{ padding: '5px 8px', background: 'transparent', border: '1px solid var(--border)', borderRadius: 5, cursor: 'pointer', color: 'var(--text-mid)', fontSize: 13 }}
                  title="Refresh"
                >↺</button>
                <button
                  onClick={() => {
                    setFileSearchOpen((o) => !o);
                    if (fileSearchOpen) setFileSearchQuery('');
                  }}
                  style={{
                    padding: '5px 8px', borderRadius: 5, cursor: 'pointer', fontSize: 13,
                    background: fileSearchOpen ? 'var(--cyan-dim)' : 'transparent',
                    border: `1px solid ${fileSearchOpen ? 'var(--cyan)' : 'var(--border)'}`,
                    color: fileSearchOpen ? 'var(--cyan)' : 'var(--text-mid)',
                  }}
                  title="Search across all project files"
                >🔍</button>
              </div>

              {/* Current upload/new-folder target */}
              {!fileSearchOpen && (
                <div style={{ padding: '4px 10px', borderBottom: '1px solid var(--border)', flexShrink: 0, fontSize: 10, color: 'var(--text-dim)', display: 'flex', alignItems: 'center', gap: 4 }}>
                  <span>📌 Target:</span>
                  <span style={{ color: 'var(--text-mid)', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {selectedFolder || 'project root'}
                  </span>
                  {selectedFolder && (
                    <button
                      onClick={() => setSelectedFolder('')}
                      style={{ background: 'none', border: 'none', color: 'var(--cyan)', cursor: 'pointer', fontSize: 10, padding: 0, marginLeft: 2 }}
                    >reset to root</button>
                  )}
                </div>
              )}

              {/* Find-in-files search box */}
              {fileSearchOpen && (
                <div style={{ padding: '8px 10px', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
                  <input
                    autoFocus
                    className="input-field"
                    value={fileSearchQuery}
                    onChange={(e) => setFileSearchQuery(e.target.value)}
                    placeholder="Search keyword, selector, text… across all project files"
                    style={{ width: '100%', boxSizing: 'border-box', fontSize: 12 }}
                  />
                </div>
              )}

              {/* File tree OR search results */}
              <div
                style={{ flex: 1, overflowY: 'auto', padding: '4px 0' }}
                onDragOver={canWrite && !fileSearchOpen ? (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; } : undefined}
                onDrop={canWrite && !fileSearchOpen ? (e) => {
                  e.preventDefault();
                  const fromPath = e.dataTransfer.getData('text/plain');
                  if (fromPath) handleMoveItem(fromPath, '');
                } : undefined}
              >
                {fileSearchOpen && fileSearchQuery.trim().length >= 2 ? (
                  fileSearchLoading ? (
                    <div style={{ padding: 16, color: 'var(--text-dim)', fontSize: 12, textAlign: 'center' }}>Searching…</div>
                  ) : fileSearchGroups.length === 0 ? (
                    <div style={{ padding: 16, textAlign: 'center', color: 'var(--text-dim)', fontSize: 12 }}>
                      No matches for "{fileSearchQuery}".
                    </div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: '4px 10px' }}>
                      {fileSearchGroups.map((group) => (
                        <div key={group.relPath}>
                          <div
                            onClick={() => openSearchResult(group.relPath, group.matches[0]?.line ?? 1)}
                            style={{
                              fontSize: 11, fontWeight: 700, color: 'var(--sky)', cursor: 'pointer',
                              marginBottom: 3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                            }}
                            title={group.relPath}
                          >
                            📄 {group.relPath}
                          </div>
                          {group.matches.map((m, i) => {
                            const idx = m.text.toLowerCase().indexOf(fileSearchQuery.trim().toLowerCase());
                            return (
                              <div
                                key={i}
                                onClick={() => openSearchResult(group.relPath, m.line)}
                                style={{
                                  display: 'flex', gap: 8, padding: '2px 6px', borderRadius: 4,
                                  cursor: 'pointer', fontFamily: 'var(--font-mono)', fontSize: 11,
                                }}
                                onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--surface2)')}
                                onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                              >
                                <span style={{ color: 'var(--text-dim)', flexShrink: 0, minWidth: 28, textAlign: 'right' }}>{m.line}</span>
                                <span style={{ color: 'var(--text-mid)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                  {idx === -1 ? m.text : (
                                    <>
                                      {m.text.slice(0, idx)}
                                      <mark style={{ background: 'rgba(251,191,36,0.35)', color: 'var(--text)', borderRadius: 2 }}>
                                        {m.text.slice(idx, idx + fileSearchQuery.trim().length)}
                                      </mark>
                                      {m.text.slice(idx + fileSearchQuery.trim().length)}
                                    </>
                                  )}
                                </span>
                              </div>
                            );
                          })}
                        </div>
                      ))}
                    </div>
                  )
                ) : fileTreeLoading ? (
                  <div style={{ padding: 16, color: 'var(--text-dim)', fontSize: 12, textAlign: 'center' }}>Loading…</div>
                ) : fileTreeError ? (
                  <div style={{ padding: 16, textAlign: 'center', color: 'var(--text-dim)', fontSize: 12 }}>
                    Failed to load files.{' '}
                    <span onClick={loadFileTree} style={{ color: 'var(--cyan)', cursor: 'pointer', textDecoration: 'underline' }}>Retry</span>
                  </div>
                ) : fileTree.length === 0 ? (
                  <div style={{ padding: 16, textAlign: 'center', color: 'var(--text-dim)', fontSize: 12 }}>
                    No files yet.<br />
                    {canWrite && <>Use <strong>📦 Import Folder</strong> to upload a zip.</>}
                  </div>
                ) : (
                  <FileTreeView
                    nodes={fileTree}
                    expandedDirs={expandedDirs}
                    onToggle={toggleDir}
                    onSelect={handleOpenFileFromTree}
                    onDownloadFile={downloadProjectFile}
                    onDownloadZip={downloadFolderZip}
                    onDelete={canWrite ? deleteProjectEntry : undefined}
                    onUploadTo={canWrite ? handleUploadToFolder : undefined}
                    onNewFolder={canWrite ? handleCreateFolder : undefined}
                    selectedFolder={selectedFolder}
                    onSelectFolder={setSelectedFolder}
                    onMoveItem={canWrite ? handleMoveItem : undefined}
                    indent={0}
                  />
                )}
              </div>
            </div>
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
                {activeTab?.kind === 'resource' && (() => {
                  const r = resources.find(res => res.filename === activeTab.filename);
                  const cp = r?.containerPath ?? `resources/${activeTab.filename}`;
                  return (
                    <span
                      style={{ fontSize: 10, color: 'var(--text-dim)', fontFamily: 'var(--font-mono)', marginRight: 'auto', cursor: 'pointer', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                      title={`Click to copy: ${cp}`}
                      onClick={() => navigator.clipboard.writeText(cp)}
                    >
                      {cp}
                    </span>
                  );
                })()}
                {activeTab?.kind === 'script' && canWrite && (
                  <button
                    onClick={handleScanTags}
                    disabled={scanningTags}
                    title="Scan all scripts for [Tags] and auto-link matching test cases"
                    style={{
                      display: 'inline-flex', alignItems: 'center', gap: 5,
                      padding: '3px 11px', borderRadius: 5, cursor: scanningTags ? 'not-allowed' : 'pointer',
                      fontSize: 11, fontWeight: 700, fontFamily: 'var(--font-ui)',
                      border: '1px solid rgba(6,182,212,0.35)',
                      background: 'rgba(6,182,212,0.07)',
                      color: 'var(--cyan)',
                      opacity: scanningTags ? 0.55 : 1,
                      transition: 'all 0.15s',
                    }}
                    onMouseEnter={(e) => {
                      if (!scanningTags) {
                        (e.currentTarget as HTMLButtonElement).style.background = 'rgba(6,182,212,0.15)';
                        (e.currentTarget as HTMLButtonElement).style.borderColor = 'rgba(6,182,212,0.6)';
                      }
                    }}
                    onMouseLeave={(e) => {
                      (e.currentTarget as HTMLButtonElement).style.background = 'rgba(6,182,212,0.07)';
                      (e.currentTarget as HTMLButtonElement).style.borderColor = 'rgba(6,182,212,0.35)';
                    }}
                  >
                    {scanningTags ? '⏳ Scanning…' : '⟳ Sync Tags'}
                  </button>
                )}
                {activeTab?.kind === 'script' && canWrite && activeScriptTcId && (
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
                {activeTab?.kind === 'script' && activeTc && (
                  <button
                    onClick={() => {
                      const prompt = `Fix the script for ${activeTc.tcId} — ${activeTc.title}`;
                      openChat({ prompt, context: { tcId: activeTc.tcId, tcTitle: activeTc.title, page: 'scripts' } });
                    }}
                    title="Open AI chat for this script"
                    style={{
                      display: 'inline-flex', alignItems: 'center', gap: 5,
                      padding: '3px 11px', borderRadius: 5, cursor: 'pointer',
                      fontSize: 11, fontWeight: 700, fontFamily: 'var(--font-ui)',
                      border: '1px solid rgba(99,102,241,0.35)',
                      background: 'rgba(99,102,241,0.08)',
                      color: 'var(--violet)',
                      transition: 'all 0.15s',
                    }}
                    onMouseEnter={(e) => {
                      (e.currentTarget as HTMLButtonElement).style.background = 'rgba(99,102,241,0.16)';
                      (e.currentTarget as HTMLButtonElement).style.borderColor = 'rgba(99,102,241,0.6)';
                    }}
                    onMouseLeave={(e) => {
                      (e.currentTarget as HTMLButtonElement).style.background = 'rgba(99,102,241,0.08)';
                      (e.currentTarget as HTMLButtonElement).style.borderColor = 'rgba(99,102,241,0.35)';
                    }}
                  >
                    💬 Chat
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

                {/* 🔖 Promote to Reference Skill */}
                {activeScript && activeTc && canWrite && (
                  <button
                    onClick={() => setShowPromoteModal(true)}
                    title="Promote this verified TC + script to a Reference Skill — the agent will mirror its locators for future scripts in the same feature group"
                    style={{
                      display: 'inline-flex', alignItems: 'center', gap: 4,
                      padding: '3px 9px', borderRadius: 5, cursor: 'pointer',
                      fontSize: 11, fontWeight: 700, fontFamily: 'var(--font-ui)',
                      border: '1px solid rgba(42,157,143,0.25)',
                      background: 'transparent',
                      color: 'rgba(42,157,143,0.5)',
                      transition: 'all 0.15s',
                    }}
                    onMouseEnter={(e) => {
                      (e.currentTarget as HTMLButtonElement).style.color = 'var(--emerald)';
                      (e.currentTarget as HTMLButtonElement).style.borderColor = 'rgba(42,157,143,0.6)';
                      (e.currentTarget as HTMLButtonElement).style.background = 'rgba(42,157,143,0.08)';
                    }}
                    onMouseLeave={(e) => {
                      (e.currentTarget as HTMLButtonElement).style.color = 'rgba(42,157,143,0.5)';
                      (e.currentTarget as HTMLButtonElement).style.borderColor = 'rgba(42,157,143,0.25)';
                      (e.currentTarget as HTMLButtonElement).style.background = 'transparent';
                    }}
                  >
                    🔖 Ref Skill
                  </button>
                )}

                {/* 🗑 Delete script */}
                {activeScript && canWrite && (
                  <button
                    onClick={() => handleDeleteScript(activeScript.id, `${activeTc?.tcId ?? ''} — ${activeTc?.title ?? activeScript.filename}`)}
                    title="Delete this script"
                    style={{
                      display: 'inline-flex', alignItems: 'center', gap: 5,
                      padding: '3px 9px', borderRadius: 5, cursor: 'pointer',
                      fontSize: 11, fontWeight: 700, fontFamily: 'var(--font-ui)',
                      border: '1px solid rgba(248,113,113,0.4)',
                      background: 'transparent',
                      color: 'rgba(226,232,240,0.4)',
                      transition: 'all 0.15s',
                    }}
                    onMouseEnter={(e) => {
                      (e.currentTarget as HTMLButtonElement).style.background = 'rgba(220,38,38,0.12)';
                      (e.currentTarget as HTMLButtonElement).style.color = 'var(--fail)';
                    }}
                    onMouseLeave={(e) => {
                      (e.currentTarget as HTMLButtonElement).style.background = 'transparent';
                      (e.currentTarget as HTMLButtonElement).style.color = 'rgba(226,232,240,0.4)';
                    }}
                  >
                    🗑 Delete
                  </button>
                )}

                {/* ▶ Run button — triggers a quick run against the default env */}
                {activeScriptTcId && (
                  <>
                    <div style={{ width: 1, height: 16, background: 'rgba(255,255,255,0.08)', margin: '0 2px' }} />
                    <button
                      onClick={handleQuickRun}
                      disabled={quickRunning || quickRunStatus === 'PENDING' || quickRunStatus === 'RUNNING'}
                      title={`Run this script inside Docker against the default environment${envConfigs.find(e => e.isDefault) ? ` (${envConfigs.find(e => e.isDefault)!.name})` : ''}`}
                      style={{
                        display: 'inline-flex', alignItems: 'center', gap: 5,
                        padding: '3px 11px', borderRadius: 5, cursor: (quickRunning || quickRunStatus === 'RUNNING' || quickRunStatus === 'PENDING') ? 'not-allowed' : 'pointer',
                        fontSize: 11, fontWeight: 700, fontFamily: 'var(--font-ui)',
                        border: '1px solid rgba(52,211,153,0.5)',
                        background: 'rgba(52,211,153,0.1)',
                        color: 'var(--emerald)',
                        opacity: (quickRunning || quickRunStatus === 'RUNNING' || quickRunStatus === 'PENDING') ? 0.6 : 1,
                        transition: 'all 0.15s',
                      }}
                      onMouseEnter={(e) => {
                        if (!quickRunning) {
                          (e.currentTarget as HTMLButtonElement).style.background = 'rgba(52,211,153,0.2)';
                          (e.currentTarget as HTMLButtonElement).style.borderColor = 'rgba(52,211,153,0.8)';
                        }
                      }}
                      onMouseLeave={(e) => {
                        (e.currentTarget as HTMLButtonElement).style.background = 'rgba(52,211,153,0.1)';
                        (e.currentTarget as HTMLButtonElement).style.borderColor = 'rgba(52,211,153,0.5)';
                      }}
                    >
                      {(quickRunning || quickRunStatus === 'PENDING' || quickRunStatus === 'RUNNING')
                        ? <>⏳ Running…</>
                        : <>▶ Run</>}
                    </button>

                    {/* ▶ Run in Host Browser button — connects to Chrome on the host via CDP */}
                    <button
                      onClick={handleHostBrowserRun}
                      disabled={hostRunning || hostRunStatus === 'PENDING' || hostRunStatus === 'RUNNING'}
                      title={`Run in your host Chrome browser (requires Chrome running with --remote-debugging-port=9222)`}
                      style={{
                        display: 'inline-flex', alignItems: 'center', gap: 5,
                        padding: '3px 11px', borderRadius: 5,
                        cursor: (hostRunning || hostRunStatus === 'RUNNING' || hostRunStatus === 'PENDING') ? 'not-allowed' : 'pointer',
                        fontSize: 11, fontWeight: 700, fontFamily: 'var(--font-ui)',
                        border: '1px solid rgba(96,165,250,0.5)',
                        background: 'rgba(96,165,250,0.1)',
                        color: 'var(--sky)',
                        opacity: (hostRunning || hostRunStatus === 'RUNNING' || hostRunStatus === 'PENDING') ? 0.6 : 1,
                        transition: 'all 0.15s',
                      }}
                      onMouseEnter={(e) => {
                        if (!hostRunning) {
                          (e.currentTarget as HTMLButtonElement).style.background = 'rgba(96,165,250,0.2)';
                          (e.currentTarget as HTMLButtonElement).style.borderColor = 'rgba(96,165,250,0.8)';
                        }
                      }}
                      onMouseLeave={(e) => {
                        (e.currentTarget as HTMLButtonElement).style.background = 'rgba(96,165,250,0.1)';
                        (e.currentTarget as HTMLButtonElement).style.borderColor = 'rgba(96,165,250,0.5)';
                      }}
                    >
                      {(hostRunning || hostRunStatus === 'PENDING' || hostRunStatus === 'RUNNING')
                        ? <>⏳ Running in Host…</>
                        : <>🌐 Run in Host Browser</>}
                    </button>

                    {/* Inline result badge — Docker run */}
                    {quickRunId && !quickRunning && quickRunStatus && quickRunStatus !== 'PENDING' && quickRunStatus !== 'RUNNING' && (
                      <>
                        <span
                          title="Click to view full run results"
                          onClick={() => navigate(`/projects/${slug}/execution?runId=${quickRunId}`)}
                          style={{
                            display: 'inline-flex', alignItems: 'center', gap: 4,
                            padding: '2px 8px', borderRadius: 4, cursor: 'pointer',
                            fontSize: 11, fontWeight: 700, fontFamily: 'var(--font-ui)',
                            border: quickRunStatus === 'PASSED'
                              ? '1px solid rgba(52,211,153,0.5)'
                              : quickRunStatus === 'FAILED'
                              ? '1px solid rgba(248,113,113,0.5)'
                              : '1px solid rgba(255,255,255,0.15)',
                            background: quickRunStatus === 'PASSED'
                              ? 'rgba(52,211,153,0.1)'
                              : quickRunStatus === 'FAILED'
                              ? 'rgba(248,113,113,0.1)'
                              : 'rgba(255,255,255,0.05)',
                            color: quickRunStatus === 'PASSED'
                              ? 'var(--emerald)'
                              : quickRunStatus === 'FAILED'
                              ? 'var(--rose)'
                              : 'var(--text-dim)',
                          }}
                        >
                          {quickRunStatus === 'PASSED' ? '✅ PASSED' : quickRunStatus === 'FAILED' ? '❌ FAILED' : `⚠ ${quickRunStatus}`}
                          <span style={{ fontSize: 9, opacity: 0.7 }}>↗</span>
                        </span>
                        {quickRunId && (
                          <button
                            onClick={() => { setMonitorRunId(quickRunId); setMonitorScript(activeScript?.filename ?? ''); setShowMonitor(true); }}
                            title="Open execution monitor"
                            style={{
                              fontSize: 10, padding: '2px 6px', borderRadius: 4, cursor: 'pointer',
                              background: 'transparent', border: '1px solid rgba(255,255,255,0.1)',
                              color: 'var(--text-dim)', fontFamily: 'var(--font-ui)',
                            }}
                          >
                            ◫ Monitor
                          </button>
                        )}
                        {quickRunStatus === 'FAILED' && activeScriptTcId && (
                          <button
                            onClick={() => {
                              setRegenFixContext({ failedStep: `Run failed for: ${activeScript.filename}`, errorMessage: 'Check run log for details' });
                              setShowRegenModal(true);
                            }}
                            style={{
                              fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 4, cursor: 'pointer',
                              background: 'rgba(139,92,246,0.12)', border: '1px solid rgba(139,92,246,0.3)',
                              color: 'var(--violet)', fontFamily: 'var(--font-ui)',
                            }}
                          >
                            🩹 Fix with AI
                          </button>
                        )}
                      </>
                    )}

                    {/* Inline result badge — Host browser run */}
                    {hostRunId && !hostRunning && hostRunStatus && hostRunStatus !== 'PENDING' && hostRunStatus !== 'RUNNING' && (
                      <>
                        <span style={{ fontSize: 10, color: 'var(--text-dim)', fontFamily: 'var(--font-ui)' }}>🌐</span>
                        <span
                          title="Click to view host-browser run results"
                          onClick={() => navigate(`/projects/${slug}/execution?runId=${hostRunId}`)}
                          style={{
                            display: 'inline-flex', alignItems: 'center', gap: 4,
                            padding: '2px 8px', borderRadius: 4, cursor: 'pointer',
                            fontSize: 11, fontWeight: 700, fontFamily: 'var(--font-ui)',
                            border: hostRunStatus === 'PASSED'
                              ? '1px solid rgba(96,165,250,0.5)'
                              : hostRunStatus === 'FAILED'
                              ? '1px solid rgba(248,113,113,0.5)'
                              : '1px solid rgba(255,255,255,0.15)',
                            background: hostRunStatus === 'PASSED'
                              ? 'rgba(96,165,250,0.1)'
                              : hostRunStatus === 'FAILED'
                              ? 'rgba(248,113,113,0.1)'
                              : 'rgba(255,255,255,0.05)',
                            color: hostRunStatus === 'PASSED'
                              ? 'var(--sky)'
                              : hostRunStatus === 'FAILED'
                              ? 'var(--rose)'
                              : 'var(--text-dim)',
                          }}
                        >
                          {hostRunStatus === 'PASSED' ? '✅ PASSED' : hostRunStatus === 'FAILED' ? '❌ FAILED' : `⚠ ${hostRunStatus}`}
                          <span style={{ fontSize: 9, opacity: 0.7 }}>↗</span>
                        </span>
                        <button
                          onClick={() => { setMonitorRunId(hostRunId); setMonitorScript(activeScript?.filename ?? ''); setShowMonitor(true); }}
                          title="Open host-browser execution monitor"
                          style={{
                            fontSize: 10, padding: '2px 6px', borderRadius: 4, cursor: 'pointer',
                            background: 'transparent', border: '1px solid rgba(96,165,250,0.2)',
                            color: 'var(--sky)', fontFamily: 'var(--font-ui)',
                          }}
                        >
                          ◫ Monitor
                        </button>
                        {hostRunStatus === 'FAILED' && activeScriptTcId && (
                          <button
                            onClick={() => {
                              setRegenFixContext({ failedStep: `Run failed for: ${activeScript.filename}`, errorMessage: 'Check run log for details' });
                              setShowRegenModal(true);
                            }}
                            style={{
                              fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 4, cursor: 'pointer',
                              background: 'rgba(139,92,246,0.12)', border: '1px solid rgba(139,92,246,0.3)',
                              color: 'var(--violet)', fontFamily: 'var(--font-ui)',
                            }}
                          >
                            🩹 Fix with AI
                          </button>
                        )}
                      </>
                    )}
                  </>
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
                  onMount={(editor, monaco) => {
                    monacoEditorRef.current = editor;

                    // Register language + providers once — they're global to the Monaco instance
                    if (!rfLangRegisteredRef.current) {
                      rfLangRegisteredRef.current = true;
                      monaco.languages.register({ id: 'robotframework' });
                      monaco.languages.registerHoverProvider('robotframework', {
                        provideHover: (model: any, position: any) => {
                          const kw = findRFKeywordAtPosition(model, position, keywordIndexRef.current);
                          if (!kw) return null;
                          const def = keywordIndexRef.current[kw];
                          return {
                            contents: [
                              { value: `**${kw}**` },
                              { value: `Defined in \`${def.filename}\` — line ${def.line}` },
                              { value: '_Ctrl+Click or F12 to go to definition_' },
                            ],
                          };
                        },
                      });
                    }

                    // F12 — go to keyword definition
                    editor.addAction({
                      id: 'go-to-rf-keyword-definition',
                      label: 'Go to Keyword Definition (Robot Framework)',
                      keybindings: [monaco.KeyCode.F12],
                      run: (ed) => {
                        const pos = ed.getPosition();
                        if (!pos) return;
                        const kw = findRFKeywordAtPosition(ed.getModel(), pos, keywordIndexRef.current);
                        if (kw) openResourceTabRef.current(keywordIndexRef.current[kw].filename, keywordIndexRef.current[kw].line);
                      },
                    });

                    // Ctrl+Click — go to keyword definition
                    editor.onMouseDown((e) => {
                      if (!(e.event.ctrlKey || e.event.metaKey)) return;
                      if (e.target.type !== monaco.editor.MouseTargetType.CONTENT_TEXT) return;
                      const pos = e.target.position;
                      if (!pos) return;
                      const kw = findRFKeywordAtPosition(editor.getModel(), pos, keywordIndexRef.current);
                      if (kw) {
                        e.event.preventDefault();
                        openResourceTabRef.current(keywordIndexRef.current[kw].filename, keywordIndexRef.current[kw].line);
                      }
                    });
                  }}
                  language={
                    activeScript?.filename?.endsWith('.robot') ? 'robotframework'
                    : (activeTab?.kind === 'resource' || activeTab?.kind === 'projectFile')
                      ? (activeTab.filename.endsWith('.py') ? 'python'
                        : activeTab.filename.endsWith('.yaml') || activeTab.filename.endsWith('.yml') ? 'yaml'
                        : activeTab.filename.endsWith('.json') ? 'json'
                        : activeTab.filename.endsWith('.csv') || activeTab.filename.endsWith('.tsv') ? 'plaintext'
                        : (activeTab.filename.endsWith('.robot') || activeTab.filename.endsWith('.resource')) ? 'robotframework'
                        : 'plaintext')
                    : 'typescript'
                  }
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
                    wordWrap: 'on', tabSize: (activeTab?.kind === 'resource' || activeTab?.kind === 'projectFile') ? 4 : 2,
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
                <span style={{ color: 'rgba(226,232,240,0.8)' }}>{activeTab?.filename ?? ''}</span>
                {(activeTab?.kind === 'resource' || activeTab?.kind === 'projectFile') ? (
                  <span style={{ color: 'var(--emerald)', fontWeight: 700 }}>🤖 Robot Framework</span>
                ) : activeScript?.scriptType === 'ROBOT' ? (
                  <span style={{ color: 'var(--emerald)', fontWeight: 700 }}>🤖 Robot Framework</span>
                ) : (
                  <>
                    <span>TypeScript</span>
                    <span>TS 5.0</span>
                  </>
                )}
                {statusSize && <span>{statusSize}</span>}
                {statusDirty
                  ? <span style={{ color: '#fbbf24' }}>● Modified</span>
                  : <span style={{ color: '#34d399' }}>✓ Saved</span>}
                <div style={{ flex: 1 }} />
                {statusDirty && (
                  <button
                    onClick={saveActiveTab}
                    disabled={save.isPending || saveResource.isPending}
                    style={{
                      background: 'rgba(96,165,250,0.15)', border: '1px solid rgba(96,165,250,0.3)',
                      borderRadius: 4, color: '#60a5fa', cursor: 'pointer',
                      fontSize: 10, padding: '1px 8px', fontFamily: 'var(--font-mono)',
                    }}
                  >
                    {(save.isPending || saveResource.isPending) ? 'Saving…' : '↑ Save (Ctrl+S)'}
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      </div>

      {/* Import folder confirmation dialog */}
      <Dialog.Root open={!!importConfirmFile} onOpenChange={(o) => !o && setImportConfirmFile(null)}>
        <Dialog.Portal>
          <Dialog.Overlay style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)', zIndex: 9998 }} />
          <Dialog.Content
            style={{
              position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%,-50%)',
              background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '14px',
              padding: '28px', width: '440px', boxShadow: '0 24px 64px rgba(0,0,0,0.5)', zIndex: 9999,
              display: 'flex', flexDirection: 'column', gap: '18px',
            }}
          >
            <div>
              <Dialog.Title style={{ fontSize: '15px', fontWeight: 800, color: 'var(--text)', margin: 0 }}>
                📦 Import Folder
              </Dialog.Title>
              <p style={{ fontFamily: 'var(--font-mono)', fontSize: '10px', color: 'var(--text-dim)', margin: '4px 0 0' }}>
                {importConfirmFile?.name}
              </p>
            </div>

            <div>
              <div style={{ fontSize: '11px', color: 'var(--text-mid)', fontWeight: 700, marginBottom: '10px' }}>
                How should test scripts be handled?
              </div>
              <ImportOption
                label="Load scripts + auto-create TC Library entries"
                description="Scripts are imported and a TC Library record is auto-created for each one. Recommended for legacy test suites."
                badge="Recommended"
                badgeColor="var(--emerald)"
                onClick={() => importConfirmFile && handleImportFolder(importConfirmFile, true)}
              />
              <ImportOption
                label="Load scripts only"
                description="Scripts are imported but no TC Library entries are created. Use when TCs already exist or you'll link manually."
                onClick={() => importConfirmFile && handleImportFolder(importConfirmFile, false)}
              />
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <Dialog.Close asChild>
                <button className="tb-btn tb-btn-ghost" onClick={() => setImportConfirmFile(null)}>Cancel</button>
              </Dialog.Close>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

    </div>
  );
}

function ImportOption({
  label, description, badge, badgeColor, onClick,
}: { label: string; description: string; badge?: string; badgeColor?: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{
        display: 'block', width: '100%', textAlign: 'left', padding: '12px 14px',
        background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: '8px',
        cursor: 'pointer', marginBottom: '8px', transition: 'border-color 0.1s',
      }}
      onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.borderColor = 'rgba(99,102,241,0.5)'; }}
      onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--border)'; }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
        <span style={{ fontSize: '12px', fontWeight: 700, color: 'var(--text)' }}>{label}</span>
        {badge && (
          <span style={{
            fontSize: '9px', fontWeight: 700, padding: '1px 6px', borderRadius: '4px',
            background: `color-mix(in srgb, ${badgeColor} 15%, transparent)`,
            color: badgeColor, fontFamily: 'var(--font-mono)',
          }}>
            {badge}
          </span>
        )}
      </div>
      <div style={{ fontSize: '10px', color: 'var(--text-dim)', fontFamily: 'var(--font-mono)', lineHeight: 1.5 }}>
        {description}
      </div>
    </button>
  );
}
