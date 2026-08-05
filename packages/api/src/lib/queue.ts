import { Queue } from 'bullmq';

function parseRedisUrl(url: string): { host: string; port: number; password?: string; db: number } {
  try {
    const parsed = new URL(url);
    return {
      host: parsed.hostname || 'localhost',
      port: parseInt(parsed.port || '6379', 10),
      password: parsed.password || undefined,
      db: parseInt(parsed.pathname.replace('/', '') || '0', 10),
    };
  } catch {
    return { host: 'localhost', port: 6379, db: 0 };
  }
}

const connection = parseRedisUrl(process.env.REDIS_URL ?? 'redis://localhost:6379');

export const testRunQueue = new Queue('test-runs', { connection });
export const healQueue = new Queue('heal-jobs', { connection });
export const scanQueue = new Queue('ui-scans', { connection });
export const scriptGenQueue = new Queue('script-gen', { connection });
export const scriptVerifyQueue = new Queue('script-verify', { connection });

export interface RunJobPayload {
  runId: string;
  runSeq: number;
  projectId: string;
  testCaseIds: string[];
  scriptPaths: string[];
  skippedTcIds?: string[];
  /** Maps each representative tcId → mirror tcIds that share the same script. Mirror TCs receive a copy of the representative's pass/fail result without re-running the script. */
  mirroredTcIds?: Record<string, string[]>;
  /** Suite stages in execution order. When present the worker runs each stage as a barrier before starting the next, respecting per-stage mode. */
  stages?: Array<{ id: string; useCaseTag: string; tcIds: string[]; mode: 'parallel' | 'sequential' }>;
  environment: string;
  envBaseUrl: string;
  envUsername?: string;
  envPassword?: string;
  parallelWorkers: number;
  headless: boolean;
  browser: 'chromium' | 'firefox' | 'webkit';
  hostBrowser?: boolean;
  triggerType: 'MANUAL' | 'SCHEDULED' | 'INDIVIDUAL' | 'GROUP' | 'HEAL_RERUN' | 'SUITE';
}

export interface HealJobPayload {
  runResultId: string;
  projectId: string;
}

export async function addRunJob(payload: RunJobPayload): Promise<void> {
  await testRunQueue.add('run', payload, {
    jobId: payload.runId,
    // 2 attempts: if the worker process stalls (misses its lock-renewal heartbeat —
    // e.g. it crashed or the event loop was blocked), BullMQ requeues the job once
    // instead of moving straight to permanent failure. runWorker's resume logic
    // (skips already-completed RunResults) picks the retry up from checkpoint.
    attempts: 2,
    removeOnComplete: 100,
    removeOnFail: 50,
  });
}

export async function addHealJob(payload: HealJobPayload): Promise<void> {
  await healQueue.add('heal', payload, {
    jobId: `heal-${payload.runResultId}`,  // Deduplicate — same RunResult is never healed twice
    attempts: 1,
    removeOnComplete: 200,
    removeOnFail: 100,
  });
}

export interface ScanJobPayload {
  scanId: string;
  projectId: string;
  baseUrl: string;
  username: string;
  password: string;
  scanDepth: 'full' | 'top-level' | 'login-only';
  generateTCs: boolean;
  triggeredBy: string;
  customInstructions?: string;
}

export async function addScanJob(payload: ScanJobPayload): Promise<void> {
  await scanQueue.add('scan', payload, {
    jobId: payload.scanId,
    attempts: 1,
    removeOnComplete: 50,
    removeOnFail: 20,
  });
}

// ── Script Agent pipeline ───────────────────────────────────────────────────

export interface ScriptGenJobPayload {
  scriptJobId: string;
  projectId: string;
  testCaseId: string;
  withHeal: boolean;
  contextNote?: string;   // ephemeral user-provided hints for this generation run
  qaFeedback?: string;    // QA engineer's correction from a prior failed run — injected at highest priority
  domSnippet?: string;    // DOM HTML from DevTools to improve locator accuracy
  domRecording?: string;  // QA DOM Recorder export — structured step/selector capture from live session
  failedStep?: string;    // step description that failed (e.g. "Step 5: Click css=#submit-btn")
  failedStepError?: string; // error message from failed step
  scriptMode?: 'PLAYWRIGHT' | 'ROBOT';
  referenceTcIds?: string[]; // user-selected TCs whose scripts are passed as pattern references
  skillIds?: string[];       // explicitly pinned skill IDs — injected regardless of tier/featureGroup
}

export interface ScriptVerifyJobPayload {
  scriptJobId: string;
  projectId: string;
  testCaseId: string;
  scriptId: string;
}

export async function addScriptGenJob(payload: ScriptGenJobPayload): Promise<void> {
  await scriptGenQueue.add('script-gen', payload, {
    jobId: payload.scriptJobId,
    attempts: 1,
    removeOnComplete: 200,
    removeOnFail: 100,
  });
}

export async function addScriptVerifyJob(payload: ScriptVerifyJobPayload): Promise<void> {
  await scriptVerifyQueue.add('script-verify', payload, {
    jobId: `${payload.scriptJobId}-verify`,
    attempts: 1,
    removeOnComplete: 200,
    removeOnFail: 100,
  });
}

// ── Agentic Browser Trace queue ────────────────────────────────────────────

export const agentScanQueue = new Queue('agent-scans', { connection });

export interface AgentScanJobPayload {
  agentTraceId: string;
  projectId: string;
  projectName?: string;
  baseUrl: string;
  targetUrl: string;
  menuContext: string;
  username: string;
  password: string;
  testGoal: string;
  seedSteps?: string[];
  additionalContext?: string;
  testTypes?: string[];
}

export async function addAgentScanJob(payload: AgentScanJobPayload): Promise<void> {
  await agentScanQueue.add('agent-scan', payload, {
    jobId: payload.agentTraceId,
    attempts: 1,
    removeOnComplete: 50,
    removeOnFail: 20,
  });
}
