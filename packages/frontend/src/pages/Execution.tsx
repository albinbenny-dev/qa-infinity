import { useState, useEffect, useCallback, useRef, useMemo, useLayoutEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import Topbar, { TbBtn } from '../components/layout/Topbar';
import LiveLog from '../components/execution/LiveLog';
import TCListPanel from '../components/execution/TCListPanel';
import { useProject } from '../hooks/useProjects';
import { useProjectEnvConfigs } from '../hooks/useProjects';
import { useTestCases, useUseCases } from '../hooks/useTestCases';
import { useScripts } from '../hooks/useScripts';
import { useRuns, useCreateRun, useCreateGroupRun, useCreateIndividualRun, useCancelRun } from '../hooks/useRuns';
import { useRunSocket } from '../hooks/useRunSocket';
import { useExecutionStore } from '../stores/executionStore';
import type { TestCase } from '../types';

// ── Cron readable text ─────────────────────────────────────────────────────

function cronToText(expr: string): string {
  const parts = expr.trim().split(/\s+/);
  if (parts.length < 5) return expr;
  const [min, hour, dom, , dow] = parts;
  const pad = (n: string) => n.padStart(2, '0');
  const hrs = parseInt(hour, 10);
  const mins = parseInt(min, 10);
  const timeStr = isNaN(hrs) || isNaN(mins) ? `${hour}:${min}` : `${hrs}:${pad(String(mins))} ${hrs < 12 ? 'AM' : 'PM'}`;
  if (dom === '*' && dow === '*') return `Every day at ${timeStr}`;
  if (dom === '*') {
    const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const d = parseInt(dow, 10);
    return `Every ${isNaN(d) ? dow : days[d] ?? dow} at ${timeStr}`;
  }
  return expr;
}

// ── Suite data (Airtel Ventas) ─────────────────────────────────────────────

const SUITES = [
  { id: 'smoke',      emoji: '🔥', label: 'Smoke Suite',      desc: '28 tests · ~5 min' },
  { id: 'regression', emoji: '🔄', label: 'Full Regression',  desc: '284 tests · ~45 min' },
  { id: 'api',        emoji: '🔌', label: 'API Contracts',    desc: '47 tests · ~8 min' },
  { id: 'sit',        emoji: '🔗', label: 'SIT Chains',       desc: '12 tests · ~15 min' },
];


// ── Toggle switch ──────────────────────────────────────────────────────────
function Toggle({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <div
      style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', userSelect: 'none' }}
      onClick={() => onChange(!on)}
    >
      <div
        style={{
          width: 34, height: 18, borderRadius: 9, position: 'relative',
          background: on ? 'var(--cyan)' : 'var(--surface3)',
          border: `1px solid ${on ? 'rgba(34,211,238,0.4)' : 'var(--border)'}`,
          transition: 'all 0.2s', flexShrink: 0,
        }}
      >
        <div style={{
          position: 'absolute', top: 2, borderRadius: '50%',
          width: 12, height: 12,
          background: on ? 'white' : 'rgba(255,255,255,0.4)',
          left: on ? 18 : 2,
          transition: 'left 0.2s, background 0.2s',
        }} />
      </div>
      <span style={{ fontSize: 12, color: 'var(--text)', fontWeight: 500 }}>{label}</span>
    </div>
  );
}

// ── Stepper ────────────────────────────────────────────────────────────────
function Stepper({ value, onChange, min = 1, max = 8 }: {
  value: number; onChange: (v: number) => void; min?: number; max?: number;
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 0 }}>
      <button
        onClick={() => onChange(Math.max(min, value - 1))}
        style={{
          width: 26, height: 26, borderRadius: '5px 0 0 5px',
          background: 'var(--surface3)', border: '1px solid var(--border)',
          color: 'var(--text)', fontSize: 14, cursor: 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}
      >−</button>
      <div style={{
        width: 36, height: 26, borderTop: '1px solid var(--border)',
        borderBottom: '1px solid var(--border)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontFamily: 'var(--font-mono)', fontSize: 13, fontWeight: 700, color: 'var(--text)',
        background: 'var(--surface2)',
      }}>
        {value}
      </div>
      <button
        onClick={() => onChange(Math.min(max, value + 1))}
        style={{
          width: 26, height: 26, borderRadius: '0 5px 5px 0',
          background: 'var(--surface3)', border: '1px solid var(--border)',
          color: 'var(--text)', fontSize: 14, cursor: 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}
      >+</button>
    </div>
  );
}

// ── Run progress bar ───────────────────────────────────────────────────────
function RunProgressBar({ passed, failed, total }: { passed: number; failed: number; total: number }) {
  if (total === 0) return null;
  const pct = Math.round(((passed + failed) / total) * 100);
  return (
    <div style={{ marginTop: 8 }}>
      <div style={{
        height: 6, background: 'var(--surface3)', borderRadius: 3, overflow: 'hidden',
      }}>
        <div style={{
          height: '100%', borderRadius: 3,
          background: failed > 0
            ? `linear-gradient(90deg, #2A9D8F ${(passed / (passed + failed)) * 100}%, #DC2626 100%)`
            : 'linear-gradient(90deg, #2A9D8F, #22d3ee)',
          width: `${pct}%`,
          transition: 'width 0.5s ease',
        }} />
      </div>
      <div style={{
        display: 'flex', justifyContent: 'space-between', marginTop: 3,
        fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--text-dim)',
      }}>
        <span>{pct}% complete</span>
        <span>{passed + failed}/{total}</span>
      </div>
    </div>
  );
}

// ── Main page ──────────────────────────────────────────────────────────────

export default function Execution() {
  const { slug } = useParams<{ slug: string }>();
  const navigate = useNavigate();

  const { data: project } = useProject(slug);
  const projectId = project?.id;

  const { data: envConfigs = [] } = useProjectEnvConfigs(projectId);
  const { data: tcData } = useTestCases(projectId, { limit: 500 });
  const { data: useCaseTags = [] } = useUseCases(projectId);
  const { data: scripts = [] } = useScripts(projectId);
  useRuns(projectId);

  const createRun = useCreateRun(projectId ?? '');
  const createGroupRun = useCreateGroupRun(projectId ?? '');
  const createIndividualRun = useCreateIndividualRun(projectId ?? '');
  const cancelRun = useCancelRun(projectId ?? '');

  const { logs, stats, status: socketStatus, clearLogs, joinRun } = useRunSocket();

  const { selectedTestCaseIds, clearSelected } = useExecutionStore();

  // ── Run config state ──────────────────────────────────────────────────────
  const [environment, setEnvironment] = useState('');
  const [selectedSuites, setSelectedSuites] = useState<Set<string>>(new Set());
  const [parallelWorkers, setParallelWorkers] = useState(2);
  const [browser, setBrowser] = useState<'chromium' | 'firefox' | 'webkit'>('chromium');
  const [headless, setHeadless] = useState(true);
  const [autoHeal, setAutoHeal] = useState(true);
  const [useAIAgents, setUseAIAgents] = useState(true);
  const [scheduleEnabled, setScheduleEnabled] = useState(false);
  const [cronParts, setCronParts] = useState(['0', '2', '*', '*', '*']);

  // ── TC selection ──────────────────────────────────────────────────────────
  const [selectedTcIds, setSelectedTcIds] = useState<Set<string>>(
    () => new Set(selectedTestCaseIds),
  );

  // ── Active run tracking ───────────────────────────────────────────────────
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const [isStopping, setIsStopping] = useState(false);
  const [runningTcIds, setRunningTcIds] = useState<Set<string>>(new Set());
  const elapsedRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [elapsedMs, setElapsedMs] = useState(0);

  // ── Resizable log panel ───────────────────────────────────────────────────
  const [logPanelWidth, setLogPanelWidth] = useState(380);
  const isDraggingRef = useRef(false);
  const dragStartXRef = useRef(0);
  const dragStartWidthRef = useRef(380);
  const logPanelWidthRef = useRef(380);

  const handleDividerMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isDraggingRef.current = true;
    dragStartXRef.current = e.clientX;
    dragStartWidthRef.current = logPanelWidthRef.current;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  }, []);

  useLayoutEffect(() => {
    const onMouseMove = (e: MouseEvent) => {
      if (!isDraggingRef.current) return;
      const delta = dragStartXRef.current - e.clientX;
      const next = Math.max(280, Math.min(700, dragStartWidthRef.current + delta));
      logPanelWidthRef.current = next;
      // Direct DOM update — no React re-render during drag
      const panel = document.getElementById('qa-log-panel');
      if (panel) panel.style.width = `${next}px`;
    };
    const onMouseUp = () => {
      if (!isDraggingRef.current) return;
      isDraggingRef.current = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      setLogPanelWidth(logPanelWidthRef.current);
    };
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
  }, []);

  const isRunning = socketStatus === 'running' || socketStatus === 'connecting';

  // ── Derived data ──────────────────────────────────────────────────────────
  const allTCs: TestCase[] = tcData?.testCases ?? [];
  const scriptedTcIds = useMemo(() => {
    const s = new Set<string>();
    for (const sc of scripts) { if (sc.testCaseId) s.add(sc.testCaseId); }
    return s;
  }, [scripts]);

  const envBaseUrl = useMemo(() => {
    const cfg = envConfigs.find((e) => e.name === environment);
    return cfg?.baseUrl ?? project?.baseUrl ?? '';
  }, [envConfigs, environment, project]);

  // Auto-select default (or first) env when configs load
  useEffect(() => {
    if (envConfigs.length === 0) return;
    setEnvironment((cur) => {
      if (cur && envConfigs.some((e) => e.name === cur)) return cur;
      return (envConfigs.find((e) => e.isDefault) ?? envConfigs[0]).name;
    });
  }, [envConfigs]);

  const cronText = cronToText(cronParts.join(' '));

  // ── Sync store → local selection on mount ─────────────────────────────────
  useEffect(() => {
    if (selectedTestCaseIds.length > 0) {
      setSelectedTcIds(new Set(selectedTestCaseIds));
      clearSelected();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Elapsed timer ─────────────────────────────────────────────────────────
  useEffect(() => {
    if (isRunning) {
      setElapsedMs(0);
      elapsedRef.current = setInterval(() => setElapsedMs((p) => p + 1000), 1000);
    } else {
      if (elapsedRef.current) clearInterval(elapsedRef.current);
    }
    return () => { if (elapsedRef.current) clearInterval(elapsedRef.current); };
  }, [isRunning]);

  // ── Socket progress → runningTcIds ────────────────────────────────────────
  useEffect(() => {
    if (socketStatus === 'complete' || socketStatus === 'error') {
      setRunningTcIds(new Set());
    }
  }, [socketStatus]);

  // ── TC selection handlers ─────────────────────────────────────────────────
  const handleToggleTc = useCallback((id: string) => {
    setSelectedTcIds((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });
  }, []);

  const handleToggleGroup = useCallback((ids: string[]) => {
    setSelectedTcIds((prev) => {
      const n = new Set(prev);
      const allSel = ids.every((id) => n.has(id));
      if (allSel) ids.forEach((id) => n.delete(id));
      else ids.forEach((id) => n.add(id));
      return n;
    });
  }, []);

  const handleSelectAll = useCallback(() => {
    setSelectedTcIds(new Set(allTCs.map((tc) => tc.id)));
  }, [allTCs]);

  const handleClearSelection = useCallback(() => {
    setSelectedTcIds(new Set());
  }, []);

  // ── Run handlers ──────────────────────────────────────────────────────────
  async function handleRunNow() {
    if (!projectId) return;
    const tcIds = Array.from(selectedTcIds);
    if (tcIds.length === 0) {
      toast.error('Select at least one test case first');
      return;
    }

    clearLogs();
    setRunningTcIds(new Set(tcIds));

    try {
      const run = await createRun.mutateAsync({
        testCaseIds: tcIds,
        environment,
        parallelWorkers,
        headless,
        browser,
      });
      setActiveRunId(run.id);
      joinRun(run.id);
      toast.success(`Run started · ${tcIds.length} test${tcIds.length !== 1 ? 's' : ''}`);
    } catch (err) {
      const msg = (err as Error)?.message ?? 'Failed to start run';
      toast.error(msg);
      setRunningTcIds(new Set());
    }
  }

  async function handleRunGroup(useCaseTag: string) {
    if (!projectId) return;
    clearLogs();

    try {
      const run = await createGroupRun.mutateAsync({
        useCaseTag,
        environment,
        parallelWorkers,
        headless,
        browser,
      });
      setActiveRunId(run.id);
      joinRun(run.id);
      toast.success(`Running group: ${useCaseTag}`);
    } catch (err) {
      toast.error((err as Error)?.message ?? 'Failed to start group run');
    }
  }

  async function handleRunIndividual(tc: TestCase) {
    if (!projectId) return;
    clearLogs();
    setRunningTcIds(new Set([tc.id]));

    try {
      const run = await createIndividualRun.mutateAsync({
        testCaseId: tc.id,
        environment,
        browser,
        headless,
      });
      setActiveRunId(run.id);
      joinRun(run.id);
      toast.success(`Running: ${tc.tcId}`);
    } catch (err) {
      toast.error((err as Error)?.message ?? 'Failed to start individual run');
      setRunningTcIds(new Set());
    }
  }

  async function handleStopRun() {
    if (!activeRunId || isStopping) return;
    setIsStopping(true);
    try {
      await cancelRun.mutateAsync(activeRunId);
      toast('Run cancelled');
    } catch (err) {
      toast.error((err as Error)?.message ?? 'Failed to cancel run');
    } finally {
      setIsStopping(false);
    }
  }

  function handleViewTc(_tc: TestCase) {
    navigate(`/projects/${slug}/tc-library`);
  }

  // ── Suite badge filter: select TCs matching suite tags ────────────────────
  const suiteTcCount = useMemo(() => {
    return SUITES.reduce<Record<string, number>>((acc, s) => {
      acc[s.id] = allTCs.filter((tc) => tc.tags.includes(`suite:${s.id}`)).length;
      return acc;
    }, {});
  }, [allTCs]);

  function toggleSuite(suiteId: string) {
    setSelectedSuites((prev) => {
      const n = new Set(prev);
      if (n.has(suiteId)) {
        n.delete(suiteId);
        // deselect suite TCs
        const suiteTcs = allTCs.filter((tc) => tc.tags.includes(`suite:${suiteId}`)).map((tc) => tc.id);
        setSelectedTcIds((prevTcs) => {
          const m = new Set(prevTcs);
          suiteTcs.forEach((id) => m.delete(id));
          return m;
        });
      } else {
        n.add(suiteId);
        // select suite TCs
        const suiteTcs = allTCs.filter((tc) => tc.tags.includes(`suite:${suiteId}`)).map((tc) => tc.id);
        setSelectedTcIds((prevTcs) => {
          const m = new Set(prevTcs);
          suiteTcs.forEach((id) => m.add(id));
          return m;
        });
      }
      return n;
    });
  }

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      {/* Topbar */}
      <Topbar
        breadcrumbs={[
          { label: 'All Projects', href: '/projects' },
          { label: project?.name ?? slug ?? '', href: `/projects/${slug}/settings` },
          { label: '▶ Execution' },
        ]}
        actions={
          <>
            <TbBtn variant="ghost" onClick={() => navigate(`/projects/${slug}/tc-library`)}>
              📚 TC Library
            </TbBtn>
            <TbBtn variant="ghost" onClick={() => navigate(`/projects/${slug}/reports`)}>
              📊 Reports
            </TbBtn>
          </>
        }
      />

      {/* 2-column layout */}
      <div style={{
        flex: 1,
        display: 'flex',
        overflow: 'hidden',
        minHeight: 0,
      }}>

        {/* ── LEFT COLUMN ─────────────────────────────────────────────────── */}
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

          {/* Config section (scrollable) */}
          <div style={{
            overflowY: 'auto',
            flexShrink: 0,
            borderRight: '1px solid var(--border)',
            maxHeight: '52%',
          }}>
            {/* Cool accent stripe */}
            <div style={{ height: 4, background: 'linear-gradient(90deg, #2563AB, #0A2A57)', flexShrink: 0 }} />

            <div style={{ padding: '14px 16px 0' }}>

              {/* ── Environment selector ─────────────────────────────── */}
              <div className="card" style={{ marginBottom: 10 }}>
                <div className="card-body" style={{ padding: '10px 14px' }}>
                  <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.8px', marginBottom: 8 }}>
                    Target Environment
                  </div>
                  {envConfigs.length === 0 ? (
                    <div style={{ fontSize: 11, color: 'var(--text-dim)', fontStyle: 'italic' }}>
                      No environments configured —{' '}
                      <span
                        style={{ color: 'var(--cyan)', cursor: 'pointer', textDecoration: 'underline' }}
                        onClick={() => navigate(`/projects/${slug}/settings`)}
                      >
                        add one in Settings
                      </span>
                    </div>
                  ) : (
                    <select
                      value={environment}
                      onChange={(e) => setEnvironment(e.target.value)}
                      style={{
                        width: '100%',
                        padding: '7px 10px',
                        borderRadius: 6,
                        fontSize: 13,
                        fontWeight: 600,
                        fontFamily: 'var(--font-ui)',
                        background: 'var(--surface3)',
                        border: '1px solid rgba(42,157,143,0.35)',
                        color: 'var(--text)',
                        cursor: 'pointer',
                        outline: 'none',
                        appearance: 'none',
                        backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12'%3E%3Cpath fill='%2364748b' d='M6 8L1 3h10z'/%3E%3C/svg%3E")`,
                        backgroundRepeat: 'no-repeat',
                        backgroundPosition: 'right 10px center',
                        paddingRight: 28,
                      }}
                    >
                      {envConfigs.map((cfg) => (
                        <option key={cfg.id} value={cfg.name}>
                          {cfg.name}{cfg.isDefault ? ' (default)' : ''}
                        </option>
                      ))}
                    </select>
                  )}
                  {envBaseUrl && (
                    <div style={{
                      marginTop: 6,
                      fontFamily: 'var(--font-mono)',
                      fontSize: 10,
                      color: '#2A9D8F',
                      background: 'rgba(42,157,143,0.06)',
                      padding: '3px 8px',
                      borderRadius: 4,
                      border: '1px solid rgba(42,157,143,0.15)',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}>
                      {envBaseUrl}
                    </div>
                  )}
                </div>
              </div>

              {/* ── Suite selection ──────────────────────────────────── */}
              <div className="card" style={{ marginBottom: 10 }}>
                <div className="card-body" style={{ padding: '10px 14px' }}>
                  <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.8px', marginBottom: 8 }}>
                    Suite Selection
                  </div>
                  <div style={{
                    display: 'grid',
                    gridTemplateColumns: '1fr 1fr',
                    gap: 8,
                  }}>
                    {SUITES.map((suite) => {
                      const selected = selectedSuites.has(suite.id);
                      const count = suiteTcCount[suite.id] ?? 0;
                      return (
                        <div
                          key={suite.id}
                          onClick={() => toggleSuite(suite.id)}
                          style={{
                            padding: '8px 10px',
                            borderRadius: 6,
                            cursor: 'pointer',
                            background: selected ? 'var(--cyan-dim)' : 'var(--surface2)',
                            border: `1px solid ${selected ? 'rgba(37,99,171,0.35)' : 'var(--border)'}`,
                            transition: 'all 0.15s',
                            userSelect: 'none',
                          }}
                        >
                          <div style={{ fontSize: 13, marginBottom: 2 }}>{suite.emoji}</div>
                          <div style={{ fontSize: 11, fontWeight: 700, color: selected ? 'var(--cyan)' : 'var(--text)' }}>
                            {suite.label}
                          </div>
                          <div style={{ fontSize: 9, color: 'var(--text-dim)', fontFamily: 'var(--font-mono)' }}>
                            {count > 0 ? `${count} TCs` : suite.desc}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>

              {/* ── Run options ──────────────────────────────────────── */}
              <div className="card" style={{ marginBottom: 10 }}>
                <div className="card-body" style={{ padding: '10px 14px' }}>
                  <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.8px', marginBottom: 10 }}>
                    Run Options
                  </div>

                  {/* Workers */}
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                    <span style={{ fontSize: 12, color: 'var(--text)', fontWeight: 500 }}>Parallel Workers</span>
                    <Stepper value={parallelWorkers} onChange={setParallelWorkers} />
                  </div>

                  {/* Browser */}
                  <div style={{ marginBottom: 10 }}>
                    <div style={{ fontSize: 11, color: 'var(--text-dim)', marginBottom: 6, fontWeight: 600 }}>Browser</div>
                    <div style={{ display: 'flex', gap: 4 }}>
                      {(['chromium', 'firefox', 'webkit'] as const).map((b) => (
                        <button
                          key={b}
                          onClick={() => setBrowser(b)}
                          style={{
                            padding: '4px 10px',
                            borderRadius: 5,
                            fontSize: 11,
                            fontWeight: 600,
                            cursor: 'pointer',
                            background: browser === b ? 'var(--cyan-dim)' : 'var(--surface3)',
                            border: `1px solid ${browser === b ? 'rgba(37,99,171,0.35)' : 'var(--border)'}`,
                            color: browser === b ? 'var(--cyan)' : 'var(--text-dim)',
                            textTransform: 'capitalize',
                            transition: 'all 0.15s',
                          }}
                        >
                          {b.charAt(0).toUpperCase() + b.slice(1)}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Toggles */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <div>
                      <Toggle on={!headless} onChange={(v) => setHeadless(!v)} label="Headed Mode" />
                      {!headless && (
                        <div style={{ fontSize: 10, color: 'var(--text-dim)', marginTop: 4, marginLeft: 42, fontStyle: 'italic' }}>
                          Browser UI active · video recorded
                        </div>
                      )}
                    </div>
                    <Toggle on={autoHeal} onChange={setAutoHeal} label="Auto-Heal on Failure" />
                    <Toggle on={useAIAgents} onChange={setUseAIAgents} label="Use AI Agents" />
                  </div>
                </div>
              </div>

              {/* ── Schedule ─────────────────────────────────────────── */}
              <div className="card" style={{ marginBottom: 10 }}>
                <div className="card-body" style={{ padding: '10px 14px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', marginBottom: scheduleEnabled ? 10 : 0 }}>
                    <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.8px', flex: 1 }}>
                      Schedule
                    </div>
                    <Toggle on={scheduleEnabled} onChange={setScheduleEnabled} label="" />
                  </div>
                  {scheduleEnabled && (
                    <>
                      <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
                        {[
                          { label: 'min', idx: 0, placeholder: '0' },
                          { label: 'hr',  idx: 1, placeholder: '2' },
                          { label: 'dom', idx: 2, placeholder: '*' },
                          { label: 'mon', idx: 3, placeholder: '*' },
                          { label: 'dow', idx: 4, placeholder: '*' },
                        ].map(({ label, idx, placeholder }) => (
                          <div key={label} style={{ flex: 1 }}>
                            <input
                              value={cronParts[idx]}
                              onChange={(e) => {
                                const next = [...cronParts];
                                next[idx] = e.target.value;
                                setCronParts(next);
                              }}
                              placeholder={placeholder}
                              style={{
                                width: '100%',
                                padding: '5px 6px',
                                borderRadius: 4,
                                background: 'var(--surface2)',
                                border: '1px solid var(--border)',
                                color: 'var(--text)',
                                fontSize: 12,
                                fontFamily: 'var(--font-mono)',
                                outline: 'none',
                                textAlign: 'center',
                                boxSizing: 'border-box',
                              }}
                            />
                            <div style={{ fontSize: 9, color: 'var(--text-dim)', textAlign: 'center', marginTop: 2 }}>
                              {label}
                            </div>
                          </div>
                        ))}
                      </div>
                      <div style={{
                        fontSize: 11,
                        color: '#2A9D8F',
                        fontFamily: 'var(--font-mono)',
                        background: 'rgba(42,157,143,0.06)',
                        padding: '4px 8px',
                        borderRadius: 4,
                        border: '1px solid rgba(42,157,143,0.15)',
                      }}>
                        {cronText}
                      </div>
                    </>
                  )}
                </div>
              </div>

              {/* ── Run Now button ────────────────────────────────────── */}
              <div style={{ paddingBottom: 14 }}>
                <button
                  onClick={handleRunNow}
                  disabled={isRunning || createRun.isPending || selectedTcIds.size === 0}
                  style={{
                    width: '100%',
                    padding: '11px 16px',
                    borderRadius: 7,
                    background: (isRunning || createRun.isPending)
                      ? 'rgba(42,157,143,0.3)'
                      : selectedTcIds.size === 0
                      ? 'rgba(42,157,143,0.15)'
                      : 'linear-gradient(135deg, #2A9D8F, #22d3ee)',
                    border: 'none',
                    color: selectedTcIds.size === 0 ? 'rgba(255,255,255,0.4)' : 'white',
                    fontSize: 13,
                    fontWeight: 800,
                    cursor: (isRunning || createRun.isPending || selectedTcIds.size === 0) ? 'not-allowed' : 'pointer',
                    fontFamily: 'var(--font-ui)',
                    transition: 'all 0.2s',
                    letterSpacing: '0.3px',
                  }}
                >
                  {isRunning
                    ? '⏳ Running…'
                    : createRun.isPending
                    ? '⏳ Starting…'
                    : `▶ Run ${selectedTcIds.size} Selected Test${selectedTcIds.size !== 1 ? 's' : ''}`}
                </button>

                {/* Progress bar during run */}
                {isRunning && (
                  <RunProgressBar
                    passed={stats.passed}
                    failed={stats.failed}
                    total={stats.total}
                  />
                )}
              </div>
            </div>
          </div>

          {/* TC List Panel */}
          <TCListPanel
            allTCs={allTCs}
            useCases={useCaseTags}
            selectedIds={selectedTcIds}
            runningTcIds={runningTcIds}
            scriptedTcIds={scriptedTcIds}
            onToggleTc={handleToggleTc}
            onToggleGroup={handleToggleGroup}
            onSelectAll={handleSelectAll}
            onClearSelection={handleClearSelection}
            onRunSelected={handleRunNow}
            onRunGroup={handleRunGroup}
            onRunIndividual={handleRunIndividual}
            onViewTc={handleViewTc}
            isRunning={isRunning}
          />
        </div>

        {/* ── Drag divider ─────────────────────────────────────────────────── */}
        <div
          onMouseDown={handleDividerMouseDown}
          style={{
            width: 5,
            flexShrink: 0,
            cursor: 'col-resize',
            background: 'var(--border)',
            position: 'relative',
            transition: 'background 0.15s',
            zIndex: 10,
          }}
          onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--cyan)')}
          onMouseLeave={(e) => (e.currentTarget.style.background = 'var(--border)')}
        >
          {/* Grip dots */}
          <div style={{
            position: 'absolute', top: '50%', left: '50%',
            transform: 'translate(-50%, -50%)',
            display: 'flex', flexDirection: 'column', gap: 3,
            pointerEvents: 'none',
          }}>
            {[0, 1, 2].map((i) => (
              <div key={i} style={{ width: 3, height: 3, borderRadius: '50%', background: 'var(--text-dim)', opacity: 0.6 }} />
            ))}
          </div>
        </div>

        {/* ── RIGHT COLUMN — Live Log ──────────────────────────────────────── */}
        <div id="qa-log-panel" style={{ width: logPanelWidth, flexShrink: 0, minWidth: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <LiveLog
            logs={logs}
            stats={stats}
            status={socketStatus}
            elapsedMs={elapsedMs}
            onStop={handleStopRun}
            isStopping={isStopping}
          />
        </div>
      </div>
    </div>
  );
}
