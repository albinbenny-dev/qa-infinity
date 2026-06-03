import { useReducer, useCallback, useMemo, useEffect, useRef, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { io, type Socket } from 'socket.io-client';
import { useProject, useRequirementDocs, useProjectEnvConfigs } from '../hooks/useProjects';
import { useRBAC } from '../hooks/useRBAC';
import {
  useGenerateTestCases,
  useSaveTestCases,
  useUploadFile,
  useParseSeedFile,
  useStartAgentTrace,
  useDuplicateTestCase,
} from '../hooks/useTestCases';
import { useProjectContext, useUpdateContext } from '../hooks/useScans';
import { useAgentConfig, useOpenRouterUsage } from '../hooks/useUsage';
import InputQueue, { type InputQueueState, type SeedTC } from '../components/writer/InputQueue';
import GeneratedTCList from '../components/writer/GeneratedTCList';
import DocsReference from '../components/writer/DocsReference';
import { api } from '../lib/api';
import { getToken } from '../lib/auth';
import type { TestCase, AgentTraceStep } from '../types';

const SOCKET_URL = typeof window !== 'undefined'
  ? `${window.location.protocol}//${window.location.host}`
  : 'http://localhost:3000';

const draftKey = (slug: string) => `qai-writer-draft-${slug}`;

interface GeneratedTC extends Omit<TestCase, 'id' | 'projectId' | 'tcId' | 'status'> {
  _tempId: string;
  sourceRef?: string;
  /** Pre-generated Playwright script from agent trace — present only on happy-path TC */
  scriptContent?: string;
}

type WriterAction =
  | { type: 'SET_INPUT_STATE'; patch: Partial<InputQueueState> }
  | { type: 'SET_GENERATED'; tcs: GeneratedTC[] }
  | { type: 'APPEND_GENERATED'; tcs: GeneratedTC[] }
  | { type: 'DELETE_GENERATED'; tempId: string }
  | { type: 'DELETE_SELECTED' }
  | { type: 'EDIT_GENERATED'; tempId: string; patch: Partial<GeneratedTC> }
  | { type: 'TOGGLE_SELECT'; id: string }
  | { type: 'SELECT_ALL'; ids: string[] }
  | { type: 'CLEAR_SELECTION' };

interface WriterState {
  inputState: InputQueueState;
  generatedTCs: GeneratedTC[];
  selectedIds: Set<string>;
}

function reducer(state: WriterState, action: WriterAction): WriterState {
  switch (action.type) {
    case 'SET_INPUT_STATE':
      return { ...state, inputState: { ...state.inputState, ...action.patch } };
    case 'SET_GENERATED':
      return { ...state, generatedTCs: action.tcs, selectedIds: new Set() };
    case 'APPEND_GENERATED':
      return { ...state, generatedTCs: [...state.generatedTCs, ...action.tcs] };
    case 'DELETE_GENERATED':
      return {
        ...state,
        generatedTCs: state.generatedTCs.filter((tc) => tc._tempId !== action.tempId),
        selectedIds: (() => { const s = new Set(state.selectedIds); s.delete(action.tempId); return s; })(),
      };
    case 'DELETE_SELECTED':
      return {
        ...state,
        generatedTCs: state.generatedTCs.filter((tc) => !state.selectedIds.has(tc._tempId)),
        selectedIds: new Set(),
      };
    case 'EDIT_GENERATED':
      return {
        ...state,
        generatedTCs: state.generatedTCs.map((tc) =>
          tc._tempId === action.tempId ? { ...tc, ...action.patch } : tc,
        ),
      };
    case 'TOGGLE_SELECT': {
      const next = new Set(state.selectedIds);
      if (next.has(action.id)) next.delete(action.id);
      else next.add(action.id);
      return { ...state, selectedIds: next };
    }
    case 'SELECT_ALL':
      return { ...state, selectedIds: new Set(action.ids) };
    case 'CLEAR_SELECTION':
      return { ...state, selectedIds: new Set() };
    default:
      return state;
  }
}

const initialInputState: InputQueueState = {
  jiraStories: [],
  jiraInput: '',
  refTCs: [],
  refTCInput: '',
  refMode: 'style',
  seedTCs: [],
  uploadedDocs: [],
  additionalContext: '',
  testTypes: { UI: true, API: true, SIT: false },
  uiScreenUrls: [],
};

export default function TestWriter() {
  const { slug } = useParams<{ slug: string }>();
  const navigate = useNavigate();
  const { canWrite } = useRBAC();

  const { data: project } = useProject(slug);
  const { data: docs = [] } = useRequirementDocs(project?.id);
  const { data: envConfigs = [] } = useProjectEnvConfigs(project?.id);
  const { data: context } = useProjectContext(project?.id);
  const updateCtx = useUpdateContext(project?.id ?? '');
  const { data: agentConfigs } = useAgentConfig();
  const { data: usageData } = useOpenRouterUsage();
  // Standard Mode: ui-context-agent disabled → only seed TC input works
  const isStandardMode = agentConfigs
    ? agentConfigs.find((a) => a.agentName === 'ui-context-agent')?.enabled === false
    : false;
  // Credits available when no usage data yet, limit is null (unlimited), or remaining > 0
  const creditsAvailable = !usageData || usageData.remaining === null || usageData.remaining > 0;
  const generateMutation = useGenerateTestCases(project?.id ?? '');
  const saveMutation = useSaveTestCases(project?.id ?? '');
  const duplicateMutation = useDuplicateTestCase(project?.id ?? '');
  const uploadMutation = useUploadFile();
  const parseSeedFileMutation = useParseSeedFile(project?.id ?? '');
  const startAgentTrace = useStartAgentTrace(project?.id ?? '');

  const [activeAgentTraceId, setActiveAgentTraceId] = useState<string | null>(null);
  const [agentSteps, setAgentSteps] = useState<AgentTraceStep[]>([]);
  const [showAgentProgress, setShowAgentProgress] = useState(false);
  const [agentError, setAgentError] = useState<string | null>(null);
  // completedTraceId keeps the socket alive after done so the video-ready event can arrive
  const [completedTraceId, setCompletedTraceId] = useState<string | null>(null);
  const [traceVideoReady, setTraceVideoReady] = useState(false);
  const agentSocketRef = useRef<Socket | null>(null);
  // socketTraceId is the last active or recently-completed trace — drives the socket effect
  const socketTraceId = activeAgentTraceId ?? completedTraceId;

  const [state, dispatch] = useReducer(reducer, {
    inputState: initialInputState,
    generatedTCs: [],
    selectedIds: new Set<string>(),
  });

  // Track whether we have loaded the scan draft into state
  const draftLoadedRef = useRef(false);
  // Track whether we have loaded the localStorage draft into state
  const localDraftLoadedRef = useRef(false);

  // Load pending scan draft into writer state on first availability
  useEffect(() => {
    if (draftLoadedRef.current) return;
    if (!context?.pendingTCDraft?.length) return;

    draftLoadedRef.current = true;
    const draftTCs: GeneratedTC[] = context.pendingTCDraft.map((tc, i) => ({
      title: tc.title,
      description: tc.description,
      steps: Array.isArray(tc.steps) ? tc.steps : [],
      expectedResult: tc.expectedResult,
      type: tc.type,
      tags: Array.isArray(tc.tags) ? tc.tags : [],
      useCaseTag: tc.useCaseTag,
      priority: tc.priority ?? 'MEDIUM',
      sourceRef: tc.sourceRef,
      lastRun: undefined,
      _tempId: `scan-${Date.now()}-${i}`,
    }));

    dispatch({ type: 'APPEND_GENERATED', tcs: draftTCs });
  }, [context?.pendingTCDraft]);

  // Restore persisted (non-scan) draft TCs from localStorage once per slug
  useEffect(() => {
    if (!slug || localDraftLoadedRef.current) return;
    localDraftLoadedRef.current = true;
    try {
      const raw = localStorage.getItem(draftKey(slug));
      if (raw) {
        const tcs: GeneratedTC[] = JSON.parse(raw);
        if (tcs.length) dispatch({ type: 'APPEND_GENERATED', tcs });
      }
    } catch {
      // ignore corrupt storage
    }
  }, [slug]);

  // Sync non-scan TCs to localStorage so they survive navigation
  useEffect(() => {
    if (!slug) return;
    const persistable = state.generatedTCs.filter((tc) => !tc._tempId.startsWith('scan-'));
    if (persistable.length) {
      localStorage.setItem(draftKey(slug), JSON.stringify(persistable));
    } else {
      localStorage.removeItem(draftKey(slug));
    }
  }, [state.generatedTCs, slug]);

  // Once all scan-sourced TCs have been handled (saved/deleted), clear the DB draft
  useEffect(() => {
    if (!draftLoadedRef.current) return;
    if (!context?.pendingTCDraft?.length) return;
    const hasScanTCs = state.generatedTCs.some((tc) => tc._tempId.startsWith('scan-'));
    if (!hasScanTCs) {
      void updateCtx.mutateAsync({ pendingTCDraft: null }).catch(() => {});
    }
  }, [state.generatedTCs, context?.pendingTCDraft]);

  // Connect to /projects namespace while a trace is active OR recently completed
  // (socketTraceId stays non-null until the user dismisses the completed trace,
  //  allowing the agent-trace:video-ready event to arrive after context.close())
  useEffect(() => {
    if (!socketTraceId || !project?.id) return;

    const token = getToken();
    const socket = io(`${SOCKET_URL}/projects`, {
      auth: { token },
      transports: ['websocket', 'polling'],
    });
    agentSocketRef.current = socket;

    socket.emit('joinProject', { projectId: project.id });

    socket.on('agent-trace:step', (data: { agentTraceId: string; step: AgentTraceStep }) => {
      if (data.agentTraceId !== activeAgentTraceId) return;
      setAgentSteps((prev) => [...prev, data.step]);
    });

    socket.on('agent-trace:done', (data: {
      agentTraceId: string;
      testCases: Array<Omit<TestCase, 'id' | 'projectId' | 'tcId' | 'status'> & { scriptContent?: string }>;
    }) => {
      if (data.agentTraceId !== activeAgentTraceId) return;
      setShowAgentProgress(false);
      setCompletedTraceId(data.agentTraceId);
      setTraceVideoReady(false);
      setActiveAgentTraceId(null);
      const newTCs: GeneratedTC[] = data.testCases.map((tc, i) => ({
        ...tc,
        _tempId: `agent-${Date.now()}-${i}`,
        steps: tc.steps ?? [],
        tags: tc.tags ?? [],
        priority: tc.priority ?? 'MEDIUM',
        scriptContent: tc.scriptContent,
      }));
      dispatch({ type: 'APPEND_GENERATED', tcs: newTCs });
    });

    socket.on('agent-trace:failed', (data: { agentTraceId: string; error: string }) => {
      if (data.agentTraceId !== activeAgentTraceId) return;
      setShowAgentProgress(false);
      setActiveAgentTraceId(null);
      setAgentError(data.error ?? 'Agentic trace failed');
    });

    socket.on('agent-trace:video-ready', () => {
      setTraceVideoReady(true);
    });

    return () => {
      socket.disconnect();
      agentSocketRef.current = null;
    };
  }, [socketTraceId, project?.id]);

  const hasScanDraft = state.generatedTCs.some((tc) => tc._tempId.startsWith('scan-'));

  const inputCount = useMemo(() => {
    const { jiraStories, refTCs, uploadedDocs, uiScreenUrls, seedTCs } = state.inputState;
    return jiraStories.length + refTCs.length + uploadedDocs.length + uiScreenUrls.length + seedTCs.length;
  }, [state.inputState]);

  const handleGenerate = useCallback(async () => {
    if (!project) return;

    const { jiraStories, refTCs, uploadedDocs, uiScreenUrls, additionalContext, testTypes, seedTCs } = state.inputState;

    const activeTypes = (Object.entries(testTypes) as ['UI' | 'API' | 'SIT', boolean][])
      .filter(([, v]) => v)
      .map(([k]) => k);

    if (!activeTypes.length) {
      alert('Select at least one test type.');
      return;
    }

    // Branch: agentic trace for any UI screen with the toggle enabled
    const agenticScreen = uiScreenUrls.find((s) => s.agenticTrace);
    if (agenticScreen) {
      setAgentError(null);
      setAgentSteps([]);
      setShowAgentProgress(true);
      setCompletedTraceId(null);
      setTraceVideoReady(false);

      const seedSteps = seedTCs.flatMap((tc) => tc.steps);
      try {
        const { agentTraceId } = await startAgentTrace.mutateAsync({
          targetUrl: agenticScreen.url,
          menuContext: agenticScreen.menuContext ?? agenticScreen.url,
          username: agenticScreen.username,
          password: agenticScreen.password,
          additionalContext: additionalContext || undefined,
          seedSteps: seedSteps.length > 0 ? seedSteps : undefined,
          testTypes: activeTypes,
        });
        setActiveAgentTraceId(agentTraceId);
      } catch (err) {
        console.error('[TestWriter] Agent trace start failed:', err);
        setShowAgentProgress(false);
        setAgentError((err as Error)?.message ?? 'Failed to start agentic trace');
      }
      return;
    }

    // Normal generate flow
    const inputs: { type: string; content: string; label: string }[] = [];

    for (const story of jiraStories) {
      inputs.push({ type: 'jira', content: story.url, label: story.url });
    }
    for (const ref of refTCs) {
      inputs.push({ type: 'reference_tc', content: ref.id, label: ref.label });
    }
    for (const doc of uploadedDocs) {
      inputs.push({ type: 'upload', content: doc.filePath, label: doc.filename });
    }
    for (const screen of uiScreenUrls) {
      inputs.push({
        type: 'ui_url',
        content: screen.url,
        label: screen.menuContext
          ? `UI: ${screen.menuContext} (${screen.url})`
          : `UI: ${screen.url}`,
      });
    }

    if (!inputs.length && !seedTCs.length) {
      alert('Add at least one input source or seed test case before generating.');
      return;
    }

    const seedTestCasesPayload = seedTCs.length > 0
      ? seedTCs.map(({ title, steps, expectedResult, useCaseTag, description, priority, type, preConditions, testData, notes }) => ({
          title, steps, expectedResult, useCaseTag, description, priority, type, preConditions, testData, notes,
        }))
      : undefined;

    try {
      const result = await generateMutation.mutateAsync({
        inputs,
        testTypes: activeTypes,
        additionalContext: additionalContext || undefined,
        seedTestCases: seedTestCasesPayload,
      });

      const newTCs: GeneratedTC[] = result.testCases.map((tc, i) => ({
        ...tc,
        _tempId: `gen-${Date.now()}-${i}`,
        steps: tc.steps ?? [],
        tags: tc.tags ?? [],
        priority: tc.priority ?? 'MEDIUM',
      }));

      dispatch({ type: 'APPEND_GENERATED', tcs: newTCs });
    } catch (err) {
      console.error('[TestWriter] Generate failed:', err);
    }
  }, [project, state.inputState, generateMutation, startAgentTrace]);

  const handleSave = useCallback(
    async (tcs: GeneratedTC[]) => {
      if (!project) return;
      try {
        await saveMutation.mutateAsync(
          tcs.map(({ _tempId: _, ...tc }) => ({ ...tc, status: 'APPROVED' as const })),
        );
        const savedTempIds = new Set(tcs.map((t) => t._tempId));
        dispatch({
          type: 'SET_GENERATED',
          tcs: state.generatedTCs.filter((tc) => !savedTempIds.has(tc._tempId)),
        });
        dispatch({ type: 'CLEAR_SELECTION' });
      } catch (err) {
        console.error('[TestWriter] Save failed:', err);
      }
    },
    [project, saveMutation, state.generatedTCs],
  );

  const handleApprove = useCallback(
    async (tc: GeneratedTC) => {
      if (!project) return;
      try {
        const { _tempId: _, ...rest } = tc;
        await saveMutation.mutateAsync([{ ...rest, status: 'APPROVED' as const }]);
        // Sync localStorage before navigating — the component unmounts before the
        // effect can run, so the approved TC would otherwise reappear on next visit.
        const remaining = state.generatedTCs.filter((t) => t._tempId !== tc._tempId);
        const persistable = remaining.filter((t) => !t._tempId.startsWith('scan-'));
        if (persistable.length) {
          localStorage.setItem(draftKey(slug ?? ''), JSON.stringify(persistable));
        } else {
          localStorage.removeItem(draftKey(slug ?? ''));
        }
        dispatch({ type: 'DELETE_GENERATED', tempId: tc._tempId });
        navigate(`/projects/${slug}/tc-library`);
      } catch (err) {
        console.error('[TestWriter] Approve failed:', err);
      }
    },
    [project, saveMutation, slug, navigate, state.generatedTCs],
  );

  const handleToggleDoc = useCallback(
    async (docId: string, isActive: boolean) => {
      if (!project) return;
      try {
        await api.patch(`/projects/${project.id}/req-docs/${docId}`, { isActive });
      } catch {
        // ignore
      }
    },
    [project],
  );

  const handleUploadFile = useCallback(
    async (file: File) => {
      return uploadMutation.mutateAsync(file);
    },
    [uploadMutation],
  );

  const handleParseSeedFile = useCallback(
    async (filePath: string) => {
      return parseSeedFileMutation.mutateAsync(filePath);
    },
    [parseSeedFileMutation],
  );

  // Converts seeds → GeneratedTC items and pushes them into the review panel (no AI)
  const handleSaveDirectly = useCallback(
    (seeds: SeedTC[]) => {
      if (!seeds.length) return;
      const newTCs: GeneratedTC[] = seeds.map((seed, i) => ({
        title: seed.title,
        description: seed.description ?? '',
        steps: seed.steps.length ? seed.steps : ['(No steps specified)'],
        expectedResult: seed.expectedResult?.trim() ?? '',
        type: seed.type ?? 'UI' as const,
        tags: [] as string[],
        useCaseTag: seed.useCaseTag,
        priority: seed.priority ?? 'MEDIUM' as const,
        sourceRef: 'direct',
        generationHints: undefined,
        lastRun: undefined,
        _tempId: `direct-${Date.now()}-${i}`,
      }));
      dispatch({ type: 'APPEND_GENERATED', tcs: newTCs });
      // Remove these seeds from the input queue
      const sentTempIds = new Set(seeds.map((s) => s.tempId));
      dispatch({
        type: 'SET_INPUT_STATE',
        patch: { seedTCs: state.inputState.seedTCs.filter((s) => !sentTempIds.has(s.tempId)) },
      });
    },
    [state.inputState.seedTCs],
  );

  const allFilteredIds = state.generatedTCs.map((t) => t._tempId);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      {/* Topbar */}
      <div className="topbar">
        <div className="topbar-breadcrumb">
          <Link to="/projects" style={{ color: 'var(--text-dim)', textDecoration: 'none', fontSize: '13px' }}>
            All Projects
          </Link>
          <span className="topbar-sep">/</span>
          <Link
            to={`/projects/${slug}/settings`}
            style={{ color: 'var(--cyan)', textDecoration: 'none', fontSize: '13px', fontWeight: 600 }}
          >
            {project?.name ?? slug}
          </Link>
          <span className="topbar-sep">/</span>
          <span className="current">Test Case Writer</span>
        </div>
        <div className="topbar-right">
          <a
            href={project ? `/api/projects/${project.id}/test-cases/export/excel` : '#'}
            target="_blank"
            rel="noreferrer"
          >
            <button className="tb-btn tb-btn-ghost">📤 Export Excel</button>
          </a>
          <button
            className="tb-btn tb-btn-primary"
            onClick={() => navigate(`/projects/${slug}/scripts`)}
          >
            → Send to Script Agent
          </button>
        </div>
      </div>

      {/* Agent trace recording ready banner */}
      {completedTraceId && (
        <div style={{
          margin: '0 24px',
          padding: '10px 14px',
          background: 'rgba(139,92,246,0.06)',
          border: '1px solid rgba(139,92,246,0.25)',
          borderRadius: 'var(--radius)',
          display: 'flex',
          alignItems: 'center',
          gap: '10px',
          fontSize: '12px',
          color: 'var(--text-mid)',
          flexShrink: 0,
        }}>
          <span style={{ fontSize: '14px' }}>🎬</span>
          <span style={{ flex: 1 }}>
            {traceVideoReady ? 'Browser recording is ready.' : 'Saving browser recording…'}
          </span>
          {traceVideoReady && (
            <button
              onClick={async () => {
                try {
                  const token = getToken();
                  const res = await fetch(
                    `/api/projects/${slug}/test-cases/agent-trace/${completedTraceId}/video`,
                    { headers: token ? { Authorization: `Bearer ${token}` } : {} },
                  );
                  if (!res.ok) throw new Error(`Server returned ${res.status}`);
                  const blob = await res.blob();
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement('a');
                  a.href = url;
                  a.download = `agent-trace-${completedTraceId}.webm`;
                  document.body.appendChild(a);
                  a.click();
                  document.body.removeChild(a);
                  URL.revokeObjectURL(url);
                } catch (err) {
                  console.error('[download-video] Failed:', err);
                }
              }}
              style={{
                padding: '4px 12px',
                borderRadius: 'var(--radius)',
                background: 'rgba(139,92,246,0.15)',
                border: '1px solid rgba(139,92,246,0.4)',
                color: '#a78bfa',
                fontSize: '11px',
                fontWeight: 600,
                cursor: 'pointer',
                whiteSpace: 'nowrap',
              }}
            >
              Download .webm
            </button>
          )}
          <button
            onClick={() => { setCompletedTraceId(null); setTraceVideoReady(false); }}
            style={{ background: 'none', border: 'none', color: 'var(--text-dim)', cursor: 'pointer', fontSize: '14px', padding: '0 4px' }}
          >✕</button>
        </div>
      )}

      {/* Agent trace error banner */}
      {agentError && (
        <div style={{
          margin: '0 24px',
          padding: '10px 14px',
          background: 'var(--rose-dim)',
          border: '1px solid rgba(220,38,38,0.3)',
          borderRadius: 'var(--radius)',
          display: 'flex',
          alignItems: 'center',
          gap: '10px',
          fontSize: '12px',
          color: 'var(--rose)',
          flexShrink: 0,
        }}>
          <span>⚠</span>
          <span style={{ flex: 1 }}>Agentic trace failed — {agentError}</span>
          <button
            onClick={() => setAgentError(null)}
            style={{ background: 'none', border: 'none', color: 'var(--rose)', cursor: 'pointer', fontSize: '14px', padding: '0 4px' }}
          >✕</button>
        </div>
      )}

      {/* Agent trace progress panel */}
      {showAgentProgress && (
        <div style={{
          margin: '0 24px',
          padding: '14px 16px',
          background: 'rgba(139,92,246,0.08)',
          border: '1px solid rgba(139,92,246,0.3)',
          borderRadius: 'var(--radius)',
          flexShrink: 0,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: agentSteps.length > 0 ? '10px' : 0 }}>
            <span style={{ fontSize: '16px' }}>🤖</span>
            <span style={{ flex: 1, fontWeight: 600, color: '#a78bfa', fontSize: '13px' }}>
              Claude is tracing your UI...
            </span>
            <span style={{ fontSize: '11px', color: 'var(--text-dim)' }}>Step {agentSteps.length}</span>
          </div>
          {agentSteps.length > 0 && (
            <div style={{
              maxHeight: '120px',
              overflowY: 'auto',
              display: 'flex',
              flexDirection: 'column',
              gap: '4px',
            }}>
              {agentSteps.map((step, i) => (
                <div key={i} style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: '8px',
                  fontSize: '11px',
                  color: step.success === false ? 'var(--rose)' : 'var(--text-mid)',
                }}>
                  <span style={{ flexShrink: 0, marginTop: '1px' }}>{step.success === false ? '✗' : '✓'}</span>
                  <span style={{ color: 'var(--text-dim)', flexShrink: 0 }}>[{step.toolName}]</span>
                  <span>{step.stepDescription ?? step.toolName}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Error banner */}
      {generateMutation.isError && (
        <div style={{
          margin: '0 24px',
          padding: '10px 14px',
          background: 'var(--rose-dim)',
          border: '1px solid rgba(220,38,38,0.3)',
          borderRadius: 'var(--radius)',
          display: 'flex',
          alignItems: 'center',
          gap: '10px',
          fontSize: '12px',
          color: 'var(--rose)',
          flexShrink: 0,
        }}>
          <span>⚠</span>
          <span style={{ flex: 1 }}>
            Generation failed —{' '}
            {(generateMutation.error as Error)?.message?.includes('timeout')
              ? 'request timed out (LLM took too long). Try again or reduce input size.'
              : (generateMutation.error as Error)?.message ?? 'unknown error'}
          </span>
          <button
            onClick={() => generateMutation.reset()}
            style={{ background: 'none', border: 'none', color: 'var(--rose)', cursor: 'pointer', fontSize: '14px', padding: '0 4px' }}
          >✕</button>
        </div>
      )}

      {/* Seed TCs banner */}
      {state.inputState.refMode === 'seed' && state.inputState.seedTCs.length > 0 && (
        <div style={{
          margin: '0 24px',
          padding: '10px 16px',
          background: 'rgba(245,158,11,0.08)',
          border: '1px solid rgba(245,158,11,0.25)',
          borderRadius: 'var(--radius)',
          display: 'flex',
          alignItems: 'center',
          gap: '10px',
          fontSize: '12px',
          color: 'var(--text-mid)',
          flexShrink: 0,
        }}>
          <span style={{ fontSize: '16px' }}>🔒</span>
          <span style={{ flex: 1 }}>
            <strong style={{ color: '#f59e0b' }}>
              {state.inputState.seedTCs.length} seed test case{state.inputState.seedTCs.length !== 1 ? 's' : ''}
            </strong>
            {' '}will be preserved verbatim. Agent adds gap coverage on top. Review and approve below.
          </span>
        </div>
      )}

      {/* Scan draft banner */}
      {hasScanDraft && (
        <div style={{
          margin: '0 24px',
          padding: '10px 16px',
          background: 'var(--violet-dim)',
          border: '1px solid rgba(37,99,171,0.3)',
          borderRadius: 'var(--radius)',
          display: 'flex',
          alignItems: 'center',
          gap: '10px',
          fontSize: '12px',
          color: 'var(--text-mid)',
          flexShrink: 0,
        }}>
          <span style={{ fontSize: '16px' }}>🔍</span>
          <span style={{ flex: 1 }}>
            <strong style={{ color: 'var(--cyan)' }}>
              {state.generatedTCs.filter((tc) => tc._tempId.startsWith('scan-')).length} test cases
            </strong>
            {' '}auto-generated from the latest UI scan. Review, edit, then approve or save to TC Library.
          </span>
        </div>
      )}

      {/* 3-column grid */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '380px 1fr 260px',
          gap: '16px',
          height: 'calc(100vh - 180px)',
          padding: '16px 24px',
          overflow: 'hidden',
        }}
      >
        {/* LEFT */}
        <InputQueue
          state={state.inputState}
          onChange={(patch) => dispatch({ type: 'SET_INPUT_STATE', patch })}
          onUploadFile={handleUploadFile}
          onParseSeedFile={handleParseSeedFile}
          onGenerate={handleGenerate}
          isGenerating={generateMutation.isPending || showAgentProgress}
          canGenerate={canWrite}
          inputCount={inputCount}
          envConfigs={envConfigs}
          projectId={project?.id}
          isStandardMode={isStandardMode}
          onSaveDirectly={handleSaveDirectly}
          creditsAvailable={creditsAvailable}
        />

        {/* MIDDLE */}
        <GeneratedTCList
          testCases={state.generatedTCs}
          selectedIds={state.selectedIds}
          onToggleSelect={(id) => dispatch({ type: 'TOGGLE_SELECT', id })}
          onSelectAll={() => dispatch({ type: 'SELECT_ALL', ids: allFilteredIds })}
          onClearSelection={() => dispatch({ type: 'CLEAR_SELECTION' })}
          onEdit={(tempId, patch) => dispatch({ type: 'EDIT_GENERATED', tempId, patch })}
          onSave={handleSave}
          onDelete={(tempId) => dispatch({ type: 'DELETE_GENERATED', tempId })}
          onDeleteSelected={() => dispatch({ type: 'DELETE_SELECTED' })}
          onApprove={handleApprove}
          onDuplicate={(tc) => duplicateMutation.mutate(tc as unknown as TestCase)}
          isSaving={saveMutation.isPending}
        />

        {/* RIGHT */}
        <DocsReference
          docs={docs}
          reqLibraryPath={project?.reqLibraryPath}
          onToggleDoc={handleToggleDoc}
          inputCount={inputCount}
          projectSlug={slug ?? ''}
        />
      </div>
    </div>
  );
}
