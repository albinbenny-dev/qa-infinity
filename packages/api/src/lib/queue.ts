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

export interface RunJobPayload {
  runId: string;
  projectId: string;
  testCaseIds: string[];
  scriptPaths: string[];
  environment: string;
  envBaseUrl: string;
  parallelWorkers: number;
  headless: boolean;
  browser: 'chromium' | 'firefox' | 'webkit';
  triggerType: 'MANUAL' | 'SCHEDULED' | 'INDIVIDUAL' | 'GROUP';
}

export interface HealJobPayload {
  runResultId: string;
  projectId: string;
}

export async function addRunJob(payload: RunJobPayload): Promise<void> {
  await testRunQueue.add('run', payload, {
    jobId: payload.runId,
    attempts: 1,
    removeOnComplete: 100,
    removeOnFail: 50,
  });
}

export async function addHealJob(payload: HealJobPayload): Promise<void> {
  await healQueue.add('heal', payload, {
    attempts: 2,
    backoff: { type: 'exponential', delay: 5000 },
    removeOnComplete: 200,
    removeOnFail: 100,
  });
}
