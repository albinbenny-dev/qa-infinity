import React, { useMemo, useReducer, useCallback, useState, useRef, useEffect } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import Topbar, { TbBtn } from '../components/layout/Topbar';
import UseCaseGroup from '../components/tc-library/UseCaseGroup';
import SelectionBar from '../components/tc-library/SelectionBar';
import EditTCModal from '../components/tc-library/EditTCModal';
import LinkScriptModal from '../components/tc-library/LinkScriptModal';
import TCImportModal from '../components/tc-library/TCImportModal';
import { useProject } from '../hooks/useProjects';
import {
  useTestCases,
  useUseCases,
  useTCLibraryStats,
  useBulkUpdateUseCase,
  useDeleteTestCase,
  useUpdateTestCase,
  useBulkDelete,
  useReorderTestCases,
  useBulkLinkScript,
} from '../hooks/useTestCases';
import { useExecutionStore } from '../stores/executionStore';
import { useScripts } from '../hooks/useScripts';
import { useCreateRun } from '../hooks/useRuns';
import { useProjectStore } from '../stores/projectStore';
import { useRBAC } from '../hooks/useRBAC';
import { api } from '../lib/api';
import type { TestCase } from '../types';

// ── UseCase colour cycling ──────────────────────────────────────────────────
const UC_COLOR_FALLBACKS = ['--violet', '--cyan', '--emerald', '--amber', '--rose', '--sky'];

function getUcColor(_name: string, index: number): string {
  return UC_COLOR_FALLBACKS[index % UC_COLOR_FALLBACKS.length];
}

// ── State ───────────────────────────────────────────────────────────────────
interface LibState {
  selectedIds: Set<string>;
  groupOpen: Record<string, boolean>;
  search: string;
  linkFilter: 'all' | 'linked' | 'unlinked';
}

type LibAction =
  | { type: 'TOGGLE_TC'; id: string }
  | { type: 'TOGGLE_GROUP'; ids: string[] }
  | { type: 'CLEAR_SELECTION' }
  | { type: 'SELECT_ALL'; ids: string[] }
  | { type: 'TOGGLE_GROUP_OPEN'; name: string }
  | { type: 'SET_ALL_OPEN'; values: Record<string, boolean> }
  | { type: 'SET_SEARCH'; value: string }
  | { type: 'SET_LINK_FILTER'; value: 'all' | 'linked' | 'unlinked' }
  | { type: 'DESELECT_MOVED'; ids: string[] };

function libReducer(state: LibState, action: LibAction): LibState {
  switch (action.type) {
    case 'TOGGLE_TC': {
      const next = new Set(state.selectedIds);
      if (next.has(action.id)) next.delete(action.id);
      else next.add(action.id);
      return { ...state, selectedIds: next };
    }
    case 'TOGGLE_GROUP': {
      const next = new Set(state.selectedIds);
      const allSelected = action.ids.every((id) => next.has(id));
      if (allSelected) action.ids.forEach((id) => next.delete(id));
      else action.ids.forEach((id) => next.add(id));
      return { ...state, selectedIds: next };
    }
    case 'CLEAR_SELECTION':
      return { ...state, selectedIds: new Set() };
    case 'SELECT_ALL':
      return { ...state, selectedIds: new Set(action.ids) };
    case 'DESELECT_MOVED': {
      const next = new Set(state.selectedIds);
      action.ids.forEach((id) => next.delete(id));
      return { ...state, selectedIds: next };
    }
    case 'TOGGLE_GROUP_OPEN': {
      const cur = state.groupOpen[action.name] ?? true;
      return { ...state, groupOpen: { ...state.groupOpen, [action.name]: !cur } };
    }
    case 'SET_ALL_OPEN':
      return { ...state, groupOpen: action.values };
    case 'SET_SEARCH':
      return { ...state, search: action.value };
    case 'SET_LINK_FILTER':
      return { ...state, linkFilter: action.value };
    default:
      return state;
  }
}

const initialState: LibState = {
  selectedIds: new Set(),
  groupOpen: {},
  search: '',
  linkFilter: 'all',
};

// ── Stat tile ───────────────────────────────────────────────────────────────
function StatTile({
  label,
  value,
  colorClass,
  valueColor,
}: {
  label: string;
  value: number | string;
  colorClass: string;
  valueColor: string;
}) {
  return (
    <div className={`stat-card ${colorClass}`}>
      <div className="stat-label">{label}</div>
      <div className="stat-value" style={{ color: valueColor, fontSize: '22px' }}>
        {value}
      </div>
    </div>
  );
}

// ── Page ────────────────────────────────────────────────────────────────────
export default function TCLibrary() {
  const { slug } = useParams<{ slug: string }>();
  const navigate = useNavigate();
  const { setSelected } = useExecutionStore();

  const { data: project } = useProject(slug);
  const projectId = project?.id;

  const [state, dispatch] = useReducer(libReducer, initialState);
  const { search, selectedIds, linkFilter } = state;

  // ── Data ──────────────────────────────────────────────────────────────────
  const { data: tcData, isLoading } = useTestCases(projectId, {
    search: search || undefined,
    limit: 500,
  });
  const { data: useCases = [] } = useUseCases(projectId);
  const { data: stats } = useTCLibraryStats(projectId);
  const { data: scripts = [] } = useScripts(projectId);

  const bulkUpdateMutation = useBulkUpdateUseCase(projectId ?? '');
  const deleteTcMutation = useDeleteTestCase(projectId ?? '');
  const updateTcMutation = useUpdateTestCase(projectId ?? '');
  const bulkDeleteMutation = useBulkDelete(projectId ?? '');
  const reorderTcMutation = useReorderTestCases(projectId ?? '');
  const bulkLinkScriptMutation = useBulkLinkScript(projectId ?? '');
  const createRun = useCreateRun(projectId ?? '');
  const { activeProject } = useProjectStore();
  const { canWrite } = useRBAC();
  const envConfigs = activeProject?.envConfigs ?? [];
  const defaultEnv = envConfigs.find(e => e.isDefault)?.name ?? envConfigs[0]?.name ?? 'Dev';

  const [editingTc, setEditingTc] = useState<TestCase | null>(null);
  const [exportOpen, setExportOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [linkScriptOpen, setLinkScriptOpen] = useState(false);
  const exportRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!exportOpen) return;
    function onClickOutside(e: MouseEvent) {
      if (exportRef.current && !exportRef.current.contains(e.target as Node)) {
        setExportOpen(false);
      }
    }
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, [exportOpen]);

  const allTCs: TestCase[] = tcData?.testCases ?? [];

  // Set of TC IDs that have an agent-generated script
  const scriptedTcIds = useMemo(() => {
    const set = new Set<string>();
    for (const s of scripts) {
      if (s.testCaseId) set.add(s.testCaseId);
    }
    return set;
  }, [scripts]);

  // Map scriptId → Script for Script Link column display
  const scriptById = useMemo(() => new Map(scripts.map((s) => [s.id, s])), [scripts]);

  // Track which single TC is being linked via per-row "+ Link" button
  const [linkScriptForTc, setLinkScriptForTc] = useState<TestCase | null>(null);

  // A TC counts as "linked" if it has an agent-generated script OR a manually linked one
  const isLinked = useCallback(
    (tc: TestCase) => scriptedTcIds.has(tc.id) || !!tc.linkedScriptId,
    [scriptedTcIds],
  );

  const linkedCount = useMemo(() => allTCs.filter(isLinked).length, [allTCs, isLinked]);
  const unlinkedCount = allTCs.length - linkedCount;

  const filteredTCs = useMemo(() => {
    if (linkFilter === 'linked') return allTCs.filter(isLinked);
    if (linkFilter === 'unlinked') return allTCs.filter((tc) => !isLinked(tc));
    return allTCs;
  }, [allTCs, linkFilter, isLinked]);

  // ── Group TCs by useCaseTag ───────────────────────────────────────────────
  const groups = useMemo(() => {
    const map = new Map<string, TestCase[]>();
    useCases.forEach((uc) => map.set(uc, []));
    for (const tc of filteredTCs) {
      const key = tc.useCaseTag ?? 'Uncategorised';
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(tc);
    }
    return Array.from(map.entries()).map(([name, tcs], i) => ({
      name,
      tcs,
      color: getUcColor(name, i),
    }));
  }, [filteredTCs, useCases]);

  const groupsWithTCs = useMemo(() => groups.filter((g) => g.tcs.length > 0), [groups]);
  const totalVisible = filteredTCs.length;
  const totalGroups = groupsWithTCs.length;

  // ── Expand / collapse all ─────────────────────────────────────────────────
  function handleExpandAll() {
    const vals: Record<string, boolean> = {};
    groups.forEach((g) => { vals[g.name] = true; });
    dispatch({ type: 'SET_ALL_OPEN', values: vals });
  }
  function handleCollapseAll() {
    const vals: Record<string, boolean> = {};
    groups.forEach((g) => { vals[g.name] = false; });
    dispatch({ type: 'SET_ALL_OPEN', values: vals });
  }

  // ── Excel export ──────────────────────────────────────────────────────────
  async function downloadExcel(params: Record<string, string>, filename: string) {
    if (!projectId) return;
    setExportOpen(false);
    try {
      const query = new URLSearchParams(params).toString();
      const res = await api.get(
        `/projects/${projectId}/test-cases/export/excel${query ? `?${query}` : ''}`,
        { responseType: 'blob' },
      );
      const url = URL.createObjectURL(res.data as Blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      toast.error('Export failed');
    }
  }

  function handleExportAll() {
    downloadExcel({}, `${slug}-test-cases.xlsx`);
  }
  function handleExportByUseCase(tag: string) {
    downloadExcel({ useCaseTag: tag }, `${slug}-${tag.replace(/\s+/g, '-')}.xlsx`);
  }
  function handleExportSelected() {
    const ids = Array.from(selectedIds).join(',');
    downloadExcel({ ids }, `${slug}-selected.xlsx`);
  }

  // ── Run handlers ─────────────────────────────────────────────────────────
  async function handleRunGroup(ids: string[]) {
    if (!projectId || ids.length === 0) return;
    try {
      await createRun.mutateAsync({ testCaseIds: ids, environment: defaultEnv, name: `Quick Run — ${defaultEnv}` });
      toast.success('Run queued! Check Execution for live logs.');
      navigate(`/projects/${slug}/execution`);
    } catch {
      toast.error('Failed to start run.');
    }
  }
  async function handleRunIndividual(tc: TestCase) {
    if (!projectId) return;
    try {
      await createRun.mutateAsync({ testCaseIds: [tc.id], environment: defaultEnv, name: `Quick Run — ${defaultEnv}` });
      toast.success('Run queued! Check Execution for live logs.');
      navigate(`/projects/${slug}/execution`);
    } catch {
      toast.error('Failed to start run.');
    }
  }
  function handleSendToExecution() {
    setSelected(Array.from(selectedIds));
    navigate(`/projects/${slug}/execution`);
  }

  // ── Bulk move ─────────────────────────────────────────────────────────────
  async function handleMove(targetUseCaseTag: string) {
    const ids = Array.from(selectedIds);
    if (!ids.length || !projectId) return;
    try {
      await bulkUpdateMutation.mutateAsync({ testCaseIds: ids, targetUseCaseTag });
      dispatch({ type: 'DESELECT_MOVED', ids });
      toast.success(`Moved ${ids.length} TC${ids.length === 1 ? '' : 's'} to "${targetUseCaseTag}"`);
    } catch {
      toast.error('Move failed');
    }
  }

  // ── Delete handlers ───────────────────────────────────────────────────────
  async function handleDeleteTc(tc: TestCase) {
    try {
      await deleteTcMutation.mutateAsync(tc.tcId);
      toast.success(`"${tc.title}" deleted`);
    } catch {
      toast.error('Delete failed');
    }
  }

  async function handleDeleteGroup(name: string) {
    const group = groups.find((g) => g.name === name);
    if (!group || group.tcs.length === 0) return;
    try {
      await bulkDeleteMutation.mutateAsync(group.tcs.map((tc) => tc.id));
      toast.success(`Deleted ${group.tcs.length} TCs from "${name}"`);
    } catch {
      toast.error('Delete failed');
    }
  }

  // ── Edit handler ─────────────────────────────────────────────────────────
  async function handleSaveEdit(tcId: string, patch: Partial<TestCase>) {
    try {
      await updateTcMutation.mutateAsync({ tcId, data: patch });
      setEditingTc(null);
      toast.success('Test case updated');
    } catch {
      toast.error('Update failed');
    }
  }

  // ── Bulk delete selected ──────────────────────────────────────────────────
  const handleDeleteSelected = useCallback(async () => {
    const ids = Array.from(selectedIds);
    if (!ids.length || !projectId) return;
    if (!window.confirm(`Delete ${ids.length} test case${ids.length !== 1 ? 's' : ''}? This cannot be undone.`)) return;
    try {
      await bulkDeleteMutation.mutateAsync(ids);
      dispatch({ type: 'CLEAR_SELECTION' });
      toast.success(`Deleted ${ids.length} TC${ids.length !== 1 ? 's' : ''}`);
    } catch {
      toast.error('Delete failed');
    }
  }, [selectedIds, projectId, bulkDeleteMutation]);

  // ── Bulk link script (from selection bar) ────────────────────────────────
  async function handleLinkScript(scriptId: string) {
    const tcIds = Array.from(selectedIds);
    if (!tcIds.length || !projectId) return;
    try {
      await bulkLinkScriptMutation.mutateAsync({ tcIds, scriptId });
      setLinkScriptOpen(false);
      toast.success(`Linked ${tcIds.length} TC${tcIds.length !== 1 ? 's' : ''} to script`);
    } catch {
      toast.error('Link failed');
    }
  }

  // ── Per-row link (opens modal scoped to that one TC) ──────────────────────
  async function handleLinkScriptForRow(scriptId: string) {
    if (!linkScriptForTc || !projectId) return;
    try {
      await bulkLinkScriptMutation.mutateAsync({ tcIds: [linkScriptForTc.id], scriptId });
      setLinkScriptForTc(null);
      toast.success(`Script linked to ${linkScriptForTc.tcId}`);
    } catch {
      toast.error('Link failed');
    }
  }

  // ── Per-row unlink ────────────────────────────────────────────────────────
  async function handleUnlinkScriptForRow(tc: TestCase) {
    if (!projectId) return;
    try {
      await bulkLinkScriptMutation.mutateAsync({ tcIds: [tc.id], scriptId: null });
      toast.success(`Script unlinked from ${tc.tcId}`);
    } catch {
      toast.error('Unlink failed');
    }
  }

  // ── Bulk unlink (from selection bar) ─────────────────────────────────────
  async function handleUnlinkSelected() {
    const tcIds = Array.from(selectedIds);
    if (!tcIds.length || !projectId) return;
    try {
      await bulkLinkScriptMutation.mutateAsync({ tcIds, scriptId: null });
      toast.success(`Unlinked ${tcIds.length} TC${tcIds.length !== 1 ? 's' : ''}`);
    } catch {
      toast.error('Unlink failed');
    }
  }

  // ── Run selected (from selection bar) ────────────────────────────────────
  function handleRunSelected() {
    handleRunGroup(Array.from(selectedIds));
  }

  const sendBtnEnabled = selectedIds.size > 0;

  const dropdownItemStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    width: '100%',
    padding: '8px 12px',
    background: 'none',
    border: 'none',
    color: 'var(--text)',
    fontSize: '12px',
    fontFamily: 'var(--font-mono)',
    cursor: 'pointer',
    textAlign: 'left',
    transition: 'background 0.1s',
  };

  return (
    <div style={{ position: 'relative', display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      {/* Topbar */}
      <Topbar
        breadcrumbs={[
          { label: 'All Projects', href: '/projects' },
          { label: `📡 ${project?.name ?? slug ?? ''}`, href: `/projects/${slug}/settings` },
          { label: '📚 TC Library' },
        ]}
        actions={
          <>
            {/* Export dropdown */}
            <div ref={exportRef} style={{ position: 'relative' }}>
              <TbBtn variant="ghost" onClick={() => setExportOpen((o) => !o)}>
                📤 Export Excel ▾
              </TbBtn>
              {exportOpen && (
                <div
                  style={{
                    position: 'absolute',
                    top: 'calc(100% + 6px)',
                    right: 0,
                    minWidth: '220px',
                    background: 'var(--surface2)',
                    border: '1px solid var(--border)',
                    borderRadius: '8px',
                    boxShadow: '0 8px 24px rgba(0,0,0,0.35)',
                    zIndex: 200,
                    overflow: 'hidden',
                  }}
                >
                  {/* Export All */}
                  <button
                    onClick={handleExportAll}
                    style={dropdownItemStyle}
                  >
                    <span style={{ opacity: 0.7 }}>📋</span> Export All ({allTCs.length} TCs)
                  </button>

                  {/* Export Selected */}
                  {selectedIds.size > 0 && (
                    <button
                      onClick={handleExportSelected}
                      style={dropdownItemStyle}
                    >
                      <span style={{ opacity: 0.7 }}>✅</span> Export Selected ({selectedIds.size})
                    </button>
                  )}

                  {/* Divider + by use case */}
                  {useCases.length > 0 && (
                    <>
                      <div style={{ borderTop: '1px solid var(--border)', margin: '4px 0' }} />
                      <div style={{ padding: '5px 12px 3px', fontSize: '9px', fontWeight: 700, color: 'var(--text-dim)', letterSpacing: '0.06em', textTransform: 'uppercase' }}>
                        By Use Case
                      </div>
                      <div style={{ maxHeight: '220px', overflowY: 'auto' }}>
                        {useCases.map((uc) => (
                          <button
                            key={uc}
                            onClick={() => handleExportByUseCase(uc)}
                            style={dropdownItemStyle}
                          >
                            <span style={{ opacity: 0.7 }}>📂</span> {uc}
                          </button>
                        ))}
                      </div>
                    </>
                  )}
                </div>
              )}
            </div>
            {canWrite && (
              <TbBtn variant="ghost" onClick={() => setImportOpen(true)}>
                📥 Import Excel
              </TbBtn>
            )}
            {canWrite && (
              <TbBtn variant="ghost" onClick={() => navigate(`/projects/${slug}/writer`)}>
                + Generate More
              </TbBtn>
            )}
            {canWrite && (
              <TbBtn
                variant="primary"
                disabled={!sendBtnEnabled}
                style={!sendBtnEnabled ? { opacity: 0.45, pointerEvents: 'none' } : undefined}
                onClick={handleSendToExecution}
              >
                ▶ Send to Execution ({selectedIds.size})
              </TbBtn>
            )}
          </>
        }
      />

      {/* Scrollable content */}
      <div
        style={{
          flex: 1,
          overflowY: 'auto',
          display: 'flex',
          flexDirection: 'column',
          gap: '14px',
          padding: '16px 20px 80px',
        }}
      >
        {/* Stats row */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5,1fr)', gap: '12px', flexShrink: 0 }}>
          <StatTile label="Total TCs" value={stats?.totalTCs ?? allTCs.length} colorClass="sc-cyan" valueColor="var(--cyan)" />
          <StatTile label="UseCases" value={stats?.useCaseCount ?? useCases.length} colorClass="sc-violet" valueColor="var(--violet)" />
          <StatTile label="Last Pass" value={stats?.passedLast ?? 0} colorClass="sc-pass" valueColor="var(--pass)" />
          <StatTile label="Last Fail" value={stats?.failedLast ?? 0} colorClass="sc-fail" valueColor="var(--fail)" />
          <StatTile label="Never Run" value={stats?.neverRun ?? allTCs.length} colorClass="sc-skip" valueColor="var(--amber)" />
        </div>

        {/* Filter bar */}
        <div className="card" style={{ flexShrink: 0 }}>
          <div className="card-body" style={{ padding: '10px 14px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
              {/* Search */}
              <input
                className="input-field"
                value={search}
                onChange={(e) => dispatch({ type: 'SET_SEARCH', value: e.target.value })}
                placeholder="🔍 Search test cases..."
                style={{ width: '200px', padding: '6px 10px' }}
              />

              {/* Linked / Unlinked filter chips */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                {(
                  [
                    ['all', `All (${allTCs.length})`],
                    ['linked', `⚡ Linked (${linkedCount})`],
                    ['unlinked', `Unlinked (${unlinkedCount})`],
                  ] as const
                ).map(([value, label]) => (
                  <button
                    key={value}
                    onClick={() => dispatch({ type: 'SET_LINK_FILTER', value })}
                    style={{
                      padding: '5px 10px',
                      borderRadius: '6px',
                      fontSize: '10px',
                      fontWeight: 700,
                      fontFamily: 'var(--font-mono)',
                      cursor: 'pointer',
                      whiteSpace: 'nowrap',
                      border: linkFilter === value ? '1px solid var(--violet)' : '1px solid var(--border)',
                      background: linkFilter === value ? 'var(--violet-dim)' : 'transparent',
                      color: linkFilter === value ? 'var(--violet)' : 'var(--text-dim)',
                    }}
                  >
                    {label}
                  </button>
                ))}
              </div>

              {/* Right: group info + expand/collapse + select all */}
              <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '6px' }}>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: '10px', color: 'var(--text-dim)' }}>
                  {totalGroups} groups · {totalVisible} TCs
                </span>
                <button
                  className="tb-btn tb-btn-ghost"
                  style={{ fontSize: '10px', padding: '3px 8px' }}
                  onClick={() => {
                    const allIds = filteredTCs.map((tc) => tc.id);
                    const allSelected = allIds.every((id) => selectedIds.has(id));
                    if (allSelected) dispatch({ type: 'CLEAR_SELECTION' });
                    else dispatch({ type: 'SELECT_ALL', ids: allIds });
                  }}
                >
                  {filteredTCs.length > 0 && filteredTCs.every((tc) => selectedIds.has(tc.id)) ? 'Deselect All' : 'Select All'}
                </button>
                <button className="tb-btn tb-btn-ghost" style={{ fontSize: '10px', padding: '3px 8px' }} onClick={handleExpandAll}>
                  Expand All
                </button>
                <button className="tb-btn tb-btn-ghost" style={{ fontSize: '10px', padding: '3px 8px' }} onClick={handleCollapseAll}>
                  Collapse All
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* UseCase groups */}
        {isLoading ? (
          <div style={{ textAlign: 'center', padding: '40px', fontFamily: 'var(--font-mono)', fontSize: '12px', color: 'var(--text-dim)' }}>
            Loading test cases…
          </div>
        ) : groupsWithTCs.length === 0 ? (
          <EmptyState slug={slug ?? ''} />
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {groups.map((g, idx) => {
              if (g.tcs.length === 0 && !search) return null;
              const isOpen = state.groupOpen[g.name] ?? idx < 3;
              return (
                <UseCaseGroup
                  key={g.name}
                  name={g.name}
                  tcs={g.tcs}
                  selectedIds={selectedIds}
                  scriptedTcIds={scriptedTcIds}
                  scriptById={scriptById}
                  color={g.color}
                  expanded={isOpen}
                  onToggleExpand={() => dispatch({ type: 'TOGGLE_GROUP_OPEN', name: g.name })}
                  onToggleTc={(id) => dispatch({ type: 'TOGGLE_TC', id })}
                  onToggleGroup={(ids) => dispatch({ type: 'TOGGLE_GROUP', ids })}
                  onRunGroup={handleRunGroup}
                  onRunIndividual={handleRunIndividual}
                  onDeleteTc={handleDeleteTc}
                  onDeleteGroup={handleDeleteGroup}
                  onEditTc={setEditingTc}
                  onLinkScript={canWrite ? (tc) => setLinkScriptForTc(tc) : undefined}
                  onUnlinkScript={canWrite ? handleUnlinkScriptForRow : undefined}
                  onReorder={(orderedIds) =>
                    reorderTcMutation.mutate({ useCaseTag: g.name === 'Uncategorised' ? null : g.name, orderedIds })
                  }
                />
              );
            })}
          </div>
        )}
      </div>

      {/* Selection action bar — floats above content, pinned to the bottom of the page */}
      <div
        style={{
          position: 'absolute',
          left: '20px',
          right: '20px',
          bottom: '16px',
          zIndex: 40,
          filter: selectedIds.size > 0 ? 'drop-shadow(0 8px 24px rgba(0,0,0,0.35))' : 'none',
        }}
      >
        <SelectionBar
          visible={selectedIds.size > 0}
          selectedCount={selectedIds.size}
          useCaseOptions={useCases}
          onMove={handleMove}
          onClear={() => dispatch({ type: 'CLEAR_SELECTION' })}
          onSendToExecution={handleSendToExecution}
          onDelete={handleDeleteSelected}
          onLinkScript={canWrite ? () => setLinkScriptOpen(true) : undefined}
          onUnlinkScript={canWrite ? handleUnlinkSelected : undefined}
          onRun={handleRunSelected}
        />
      </div>

      {editingTc && (
        <EditTCModal
          tc={editingTc}
          onSave={handleSaveEdit}
          onClose={() => setEditingTc(null)}
        />
      )}

      {projectId && (
        <TCImportModal
          open={importOpen}
          onClose={() => setImportOpen(false)}
          projectId={projectId}
        />
      )}

      {/* Bulk-link modal (selection bar) */}
      <LinkScriptModal
        open={linkScriptOpen}
        onClose={() => setLinkScriptOpen(false)}
        scripts={scripts}
        selectedCount={selectedIds.size}
        onLink={handleLinkScript}
        isPending={bulkLinkScriptMutation.isPending}
      />

      {/* Per-row link modal */}
      <LinkScriptModal
        open={linkScriptForTc !== null}
        onClose={() => setLinkScriptForTc(null)}
        scripts={scripts}
        selectedCount={1}
        onLink={handleLinkScriptForRow}
        isPending={bulkLinkScriptMutation.isPending}
      />
    </div>
  );
}

function EmptyState({ slug }: { slug: string }) {
  return (
    <div
      style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '12px',
        padding: '60px 40px',
        textAlign: 'center',
      }}
    >
      <div style={{ fontSize: '40px', opacity: 0.3 }}>📚</div>
      <h2 style={{ fontSize: '16px', fontWeight: 700, color: 'var(--text)', margin: 0 }}>
        No test cases yet
      </h2>
      <p style={{ fontSize: '13px', color: 'var(--text-dim)', maxWidth: '320px', lineHeight: 1.6, margin: 0 }}>
        Generate your first test cases from Jira stories, PRDs, or free text prompts.
      </p>
      <Link
        to={`/projects/${slug}/writer`}
        style={{
          marginTop: '8px',
          padding: '9px 20px',
          background: 'linear-gradient(135deg, var(--violet), var(--6d-orange-deep))',
          border: 'none',
          borderRadius: '8px',
          color: 'white',
          fontSize: '13px',
          fontWeight: 700,
          textDecoration: 'none',
          cursor: 'pointer',
        }}
      >
        + Generate Test Cases
      </Link>
    </div>
  );
}
