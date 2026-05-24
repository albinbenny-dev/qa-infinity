import { Worker, type Job } from 'bullmq';
import { prisma } from '../lib/prisma.js';
import { emitToProject } from '../lib/socket.js';
import { addScriptVerifyJob } from '../lib/queue.js';
import type { ScriptGenJobPayload } from '../lib/queue.js';
import { runScriptAgent } from '../agents/scriptAgent.js';
import { saveScript, savePOM, listPOMFiles } from '../services/scriptFileService.js';

function parseRedisUrl(url: string): { host: string; port: number; password?: string; db: number } {
  try {
    const u = new URL(url);
    return {
      host: u.hostname || 'localhost',
      port: parseInt(u.port || '6379', 10),
      password: u.password || undefined,
      db: parseInt(u.pathname.replace('/', '') || '0', 10),
    };
  } catch {
    return { host: 'localhost', port: 6379, db: 0 };
  }
}

async function emitJobUpdate(scriptJobId: string): Promise<void> {
  const job = await prisma.scriptJob.findUnique({
    where: { id: scriptJobId },
    include: {
      script: { select: { id: true, filename: true, verificationStatus: true, suspectedIssue: true } },
    },
  });
  if (!job) return;
  const testCase = await prisma.testCase.findUnique({
    where: { id: job.testCaseId },
    select: { id: true, tcId: true, title: true, type: true, useCaseTag: true },
  });
  emitToProject(job.projectId, 'script-job:update', { ...job, testCase });
}

async function processGenJob(job: Job<ScriptGenJobPayload>): Promise<void> {
  const { scriptJobId, projectId, testCaseId, withHeal, contextNote } = job.data;

  await prisma.scriptJob.update({
    where: { id: scriptJobId },
    data: { phase: 'GENERATING', updatedAt: new Date() },
  });
  await emitJobUpdate(scriptJobId);

  const tc = await prisma.testCase.findFirst({
    where: { id: testCaseId, projectId },
    select: {
      id: true, projectId: true, tcId: true, title: true, description: true,
      steps: true, expectedResult: true, type: true, useCaseTag: true,
      generationHints: true,
    },
  });
  const project = await prisma.project.findUnique({ where: { id: projectId } });
  if (!tc || !project) {
    await prisma.scriptJob.update({
      where: { id: scriptJobId },
      data: { phase: 'FAILED', lastError: 'Test case or project missing' },
    });
    await emitJobUpdate(scriptJobId);
    return;
  }

  try {
    const existingPOMs = listPOMFiles(projectId);
    const result = await runScriptAgent({
      testCase: {
        id: tc.id,
        tcId: tc.tcId,
        title: tc.title,
        description: tc.description,
        steps: tc.steps,
        expectedResult: tc.expectedResult,
        type: tc.type,
        useCaseTag: tc.useCaseTag,
        generationHints: tc.generationHints,
      },
      project: { id: project.id, name: project.name, baseUrl: project.baseUrl },
      existingPOMs,
      contextNote,
    });

    const slug = tc.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
    const filename = `${tc.tcId}-${slug}.spec.ts`;

    saveScript(projectId, filename, result.specContent);
    if (result.pomContent && result.pomFilename) {
      savePOM(projectId, result.pomFilename, result.pomContent);
    }

    const existing = await prisma.script.findFirst({
      where: { projectId, testCaseId: tc.id },
    });

    const script = existing
      ? await prisma.script.update({
          where: { id: existing.id },
          data: {
            filename,
            content: result.specContent,
            verificationStatus: withHeal ? 'NOT_VERIFIED' : existing.verificationStatus,
            suspectedIssue: withHeal ? null : existing.suspectedIssue,
            updatedAt: new Date(),
          },
        })
      : await prisma.script.create({
          data: {
            projectId,
            testCaseId: tc.id,
            filename,
            content: result.specContent,
            isCustomUpload: false,
          },
        });

    if (withHeal) {
      await prisma.scriptJob.update({
        where: { id: scriptJobId },
        data: { scriptId: script.id, phase: 'QUEUED_VERIFY' },
      });
      await emitJobUpdate(scriptJobId);
      await addScriptVerifyJob({
        scriptJobId,
        projectId,
        testCaseId: tc.id,
        scriptId: script.id,
      });
    } else {
      await prisma.scriptJob.update({
        where: { id: scriptJobId },
        data: { scriptId: script.id, phase: 'GENERATED' },
      });
      await emitJobUpdate(scriptJobId);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[script-gen-worker] failed for TC ${testCaseId}:`, err);
    await prisma.scriptJob.update({
      where: { id: scriptJobId },
      data: { phase: 'FAILED', lastError: msg },
    });
    await emitJobUpdate(scriptJobId);
  }
}

export function startScriptGenWorker(): void {
  const connection = parseRedisUrl(process.env.REDIS_URL ?? 'redis://localhost:6379');

  const worker = new Worker<ScriptGenJobPayload>('script-gen', processGenJob, {
    connection,
    concurrency: 1, // generation runs single-threaded — no hurry
  });

  worker.on('completed', (job) => {
    console.log(`[script-gen-worker] Job ${job.id} completed`);
  });
  worker.on('failed', (job, err) => {
    console.error(`[script-gen-worker] Job ${job?.id} failed:`, err.message);
  });

  console.log('[script-gen-worker] Worker started, listening on queue "script-gen"');
}
