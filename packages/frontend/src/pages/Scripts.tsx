import React, { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import Editor from '@monaco-editor/react';
import toast from 'react-hot-toast';
import { useQueryClient } from '@tanstack/react-query';
import Topbar, { TbBtn } from '../components/layout/Topbar';
import FileTree from '../components/scripts/FileTree';
import EditorTabs from '../components/scripts/EditorTabs';
import { useProject } from '../hooks/useProjects';
import { useTestCases, useUseCases } from '../hooks/useTestCases';
import {
  useScripts,
  useSaveScriptContent,
  useDeleteScript,
  useUploadScript,
} from '../hooks/useScripts';
import { useExecutionStore } from '../stores/executionStore';
import { api } from '../lib/api';
import type { Script, TestCase } from '../types';

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

interface QueueJob {
  tcDbId: string;
  tcId: string;
  title: string;
  type: string;
  useCaseTag?: string;
  status: 'pending' | 'running' | 'done' | 'error';
  error?: string;
  scriptFilename?: string;
}

interface GenerateApiResponse {
  created: Array<{ id: string; filename: string; testCaseId: string; tcId: string; title: string }>;
  errors: Array<{ testCaseId: string; error: string }>;
}

// ── TCScriptRow ─────────────────────────────────────────────────────────────

const TYPE_CHIP: Record<string, { bg: string; color: string }> = {
  UI:  { bg: 'var(--rose-dim)',    color: 'var(--rose)' },
  API: { bg: 'var(--cyan-dim)',    color: 'var(--cyan)' },
  SIT: { bg: 'var(--emerald-dim)', color: 'var(--emerald)' },
};

function TCScriptRow({
  tc, isScripted, isSelected, onToggle, onOpen,
}: {
  tc: TestCase;
  isScripted: boolean;
  isSelected: boolean;
  onToggle: () => void;
  onOpen: () => void;
}) {
  const chip = TYPE_CHIP[tc.type] ?? { bg: 'var(--surface3)', color: 'var(--text-dim)' };

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
        <span style={{
          width: 15, height: 15, borderRadius: 3,
          background: 'var(--emerald-dim)', border: '1px solid rgba(42,157,143,0.35)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 9, color: 'var(--emerald)', fontWeight: 700, flexShrink: 0,
        }}>✓</span>
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

function QueueJobRow({ job }: { job: QueueJob }) {
  const STATUS = {
    pending: { icon: '○', color: 'var(--text-dim)',  bg: 'transparent' },
    running: { icon: '⏳', color: 'var(--amber)',    bg: 'rgba(245,158,11,0.05)' },
    done:    { icon: '✓',  color: 'var(--emerald)',  bg: 'rgba(42,157,143,0.05)' },
    error:   { icon: '✕',  color: 'var(--fail)',     bg: 'rgba(220,38,38,0.05)' },
  }[job.status];

  const chip = TYPE_CHIP[job.type] ?? { bg: 'var(--surface3)', color: 'var(--text-dim)' };

  return (
    <div style={{
      display: 'flex', alignItems: 'flex-start', gap: 8,
      padding: '7px 12px',
      borderBottom: '1px solid var(--border)',
      background: STATUS.bg,
      transition: 'background 0.3s',
    }}>
      {/* Status icon */}
      <span style={{
        fontSize: job.status === 'running' ? 13 : 10,
        color: STATUS.color, flexShrink: 0, marginTop: 2,
        fontWeight: job.status === 'done' || job.status === 'error' ? 700 : 400,
      }}>
        {STATUS.icon}
      </span>

      {/* Text */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontSize: 11, fontWeight: 600,
          color: job.status === 'done' ? 'var(--text-dim)' : 'var(--text)',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {job.title}
        </div>
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: 9, marginTop: 1 }}>
          <span style={{ color: 'var(--text-dim)' }}>{job.tcId}</span>
          {job.status === 'done' && job.scriptFilename && (
            <span style={{ color: 'var(--emerald)', marginLeft: 4 }}>→ {job.scriptFilename}</span>
          )}
          {job.status === 'error' && job.error && (
            <span style={{ color: 'var(--fail)', marginLeft: 4 }}>{job.error}</span>
          )}
          {job.status === 'running' && (
            <span style={{ color: 'var(--amber)', marginLeft: 4 }}>generating…</span>
          )}
        </div>
      </div>

      {/* Type chip */}
      <span style={{
        fontSize: 8, fontWeight: 700, padding: '2px 5px', borderRadius: 3,
        background: chip.bg, color: chip.color,
        flexShrink: 0, fontFamily: 'var(--font-ui)',
      }}>
        {job.type}
      </span>
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

// ── Main page ───────────────────────────────────────────────────────────────

export default function Scripts() {
  const { slug } = useParams<{ slug: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const mountedRef = useRef(true);
  useEffect(() => () => { mountedRef.current = false; }, []);

  const { data: project } = useProject(slug);
  const projectId = project?.id;

  const { data: scripts = [], isLoading: scriptsLoading } = useScripts(projectId);
  const { data: tcData, isLoading: tcsLoading } = useTestCases(projectId, { limit: 500 });
  const { data: useCases = [] } = useUseCases(projectId);

  const save = useSaveScriptContent(projectId ?? '');
  const deleteScript = useDeleteScript(projectId ?? '');
  const upload = useUploadScript(projectId ?? '');
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

  // ── Queue state ──────────────────────────────────────────────────────────

  const [queueJobs, setQueueJobs] = useState<QueueJob[]>([]);
  const [isQueuing, setIsQueuing] = useState(false);

  const queueVisible = queueJobs.length > 0;
  const queueDone = queueJobs.filter((j) => j.status === 'done').length;
  const queueErrors = queueJobs.filter((j) => j.status === 'error').length;
  const queueAllDone = queueVisible && !isQueuing;
  const queueProgress = queueJobs.length > 0 ? (queueDone + queueErrors) / queueJobs.length : 0;

  // ── Editor tab state ─────────────────────────────────────────────────────

  const [openTabs, setOpenTabs] = useState<Script[]>([]);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);
  const [tabContents, setTabContents] = useState<Record<string, string>>({});
  const [dirtyTabs, setDirtyTabs] = useState<Set<string>>(new Set());
  const [loadingContent, setLoadingContent] = useState(false);

  const activeScript = openTabs.find((t) => t.id === activeTabId) ?? null;
  const activeContent = activeTabId ? (tabContents[activeTabId] ?? '') : '';

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

  // ── Queue generate ────────────────────────────────────────────────────────

  async function handleQueueGenerate() {
    if (!projectId || tcSelected.size === 0) return;
    const selected = allTCs.filter((tc) => tcSelected.has(tc.id));

    const jobs: QueueJob[] = selected.map((tc) => ({
      tcDbId: tc.id, tcId: tc.tcId, title: tc.title,
      type: tc.type, useCaseTag: tc.useCaseTag ?? undefined,
      status: 'pending',
    }));

    setQueueJobs(jobs);
    setIsQueuing(true);
    setTcSelected(new Set());

    let ok = 0;
    let fail = 0;

    for (let i = 0; i < jobs.length; i++) {
      if (!mountedRef.current) break;

      setQueueJobs((prev) =>
        prev.map((j, idx) => (idx === i ? { ...j, status: 'running' } : j)),
      );

      try {
        const res = await api.post<GenerateApiResponse>(
          `/projects/${projectId}/scripts/generate`,
          { testCaseIds: [jobs[i].tcDbId] },
          { timeout: 180_000 },
        );
        const created = res.data.created?.[0];
        const errored = res.data.errors?.[0];

        if (errored) {
          setQueueJobs((prev) =>
            prev.map((j, idx) => (idx === i ? { ...j, status: 'error', error: errored.error } : j)),
          );
          fail++;
        } else {
          setQueueJobs((prev) =>
            prev.map((j, idx) =>
              idx === i ? { ...j, status: 'done', scriptFilename: created?.filename } : j,
            ),
          );
          ok++;
        }
      } catch (err) {
        const msg = (err as Error)?.message ?? 'Unknown error';
        setQueueJobs((prev) =>
          prev.map((j, idx) => (idx === i ? { ...j, status: 'error', error: msg } : j)),
        );
        fail++;
      }
    }

    await qc.invalidateQueries({ queryKey: ['scripts', projectId] });
    setIsQueuing(false);
    if (ok > 0) toast.success(`Generated ${ok} script${ok !== 1 ? 's' : ''}`);
    if (fail > 0) toast.error(`${fail} failed`);
  }

  function dismissQueue() {
    setQueueJobs([]);
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

  // ── Upload ────────────────────────────────────────────────────────────────

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      await upload.mutateAsync(file);
      toast.success(`Uploaded ${file.name}`);
    } catch {
      toast.error('Upload failed');
    }
    if (fileInputRef.current) fileInputRef.current.value = '';
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
      {/* Topbar */}
      <Topbar
        breadcrumbs={[
          { label: 'Projects', href: '/projects' },
          { label: project?.name ?? slug ?? '', href: `/projects/${slug}/dashboard` },
          { label: '⌨ Script Agent' },
        ]}
        actions={
          <>
            <TbBtn
              variant="ghost"
              onClick={() => fileInputRef.current?.click()}
              disabled={upload.isPending}
            >
              ⬆ Upload .spec.ts
            </TbBtn>
            <TbBtn variant="primary" onClick={handleSendToExecution}>
              → Send to Execution
            </TbBtn>
          </>
        }
      />

      {/* 2-column body */}
      <div style={{ flex: 1, display: 'grid', gridTemplateColumns: '320px 1fr', overflow: 'hidden' }}>

        {/* ── LEFT PANEL ──────────────────────────────────────────────────── */}
        <div style={{
          display: 'flex', flexDirection: 'column', overflow: 'hidden',
          background: 'var(--surface)', borderRight: '1px solid var(--border)',
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
                        {queueAllDone ? '✅ Generation Complete' : '⚡ Generating Scripts…'}
                      </span>
                      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-dim)' }}>
                        {queueDone + queueErrors} / {queueJobs.length}
                      </span>
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
                    {queueErrors > 0 && (
                      <div style={{ fontSize: 10, color: 'var(--fail)', fontFamily: 'var(--font-mono)' }}>
                        {queueDone} done · {queueErrors} failed
                      </div>
                    )}
                  </div>

                  {/* Job list */}
                  <div style={{ flex: 1, overflowY: 'auto' }}>
                    {queueJobs.map((job) => (
                      <QueueJobRow key={job.tcDbId} job={job} />
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
                            {isOpen && group.tcs.map((tc) => (
                              <TCScriptRow
                                key={tc.id}
                                tc={tc}
                                isScripted={scriptedTcIds.has(tc.id)}
                                isSelected={tcSelected.has(tc.id)}
                                onToggle={() => handleTCToggle(tc.id)}
                                onOpen={() => handleOpenTCScript(tc.id)}
                              />
                            ))}
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
                    {tcSelected.size > 0 ? (
                      <button
                        onClick={handleQueueGenerate}
                        disabled={isQueuing}
                        style={{
                          width: '100%', padding: '9px',
                          background: 'linear-gradient(135deg, var(--violet), var(--6d-orange-deep))',
                          border: 'none', borderRadius: 6, color: 'white',
                          fontSize: 12, fontWeight: 700, cursor: 'pointer',
                          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                        }}
                      >
                        ⚡ Generate {tcSelected.size} Script{tcSelected.size !== 1 ? 's' : ''}
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
                  onClick={() => fileInputRef.current?.click()}
                  disabled={upload.isPending}
                  style={{
                    padding: '6px 8px', background: 'transparent',
                    border: '1px solid var(--border)', borderRadius: 5,
                    cursor: 'pointer', color: 'var(--text-mid)', fontSize: 11,
                  }}
                  title="Upload .spec.ts"
                >
                  ⬆
                </button>
              </div>

              {scriptsLoading ? (
                <div style={{ padding: 16, color: 'var(--text-dim)', fontSize: 12 }}>Loading…</div>
              ) : (
                <FileTree
                  scripts={scripts}
                  activeId={activeTabId}
                  onSelect={openTab}
                  onDelete={handleDelete}
                />
              )}
            </>
          )}
        </div>

        {/* ── RIGHT: Monaco Editor ───────────────────────────────────────── */}
        <div style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden', background: '#06224A' }}>
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

      <input
        ref={fileInputRef}
        type="file"
        accept=".spec.ts,.spec.js"
        style={{ display: 'none' }}
        onChange={handleUpload}
      />
    </div>
  );
}
