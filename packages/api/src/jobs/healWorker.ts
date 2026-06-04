import { Worker } from 'bullmq';
import { triggerHeal } from '../services/healService.js';
import type { HealJobPayload } from '../lib/queue.js';

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

export function startHealWorker(): void {
  const connection = parseRedisUrl(process.env.REDIS_URL ?? 'redis://localhost:6379');

  const worker = new Worker<HealJobPayload>(
    'heal-jobs',
    async (job) => {
      const { runResultId } = job.data;
      await triggerHeal(runResultId);
    },
    { connection, concurrency: 2 },
  );

  worker.on('completed', (job) => {
    console.log(`[heal-worker] Job ${job.id} completed (runResultId: ${job.data.runResultId})`);
  });

  worker.on('failed', (job, err) => {
    console.error(
      `[heal-worker] Job ${job?.id} failed (runResultId: ${job?.data.runResultId}):`,
      err.message,
    );
  });

  console.log('[heal-worker] Worker started, listening on queue "heal-jobs"');
}
