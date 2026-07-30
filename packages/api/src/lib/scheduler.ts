import cron from 'node-cron';
import { prisma } from './prisma.js';
import { addRunJob } from './queue.js';
import { findScriptPath, saveScript } from '../services/scriptFileService.js';

const SCRIPTS_ROOT = process.env.SCRIPTS_ROOT ?? '/scripts';

async function resolveScriptPath(slug: string, projectId: string, tcId: string): Promise<string | null> {
  // 1. Agent-generated script
  let script = await prisma.script.findFirst({
    where: { projectId, testCaseId: tcId },
    select: { filename: true, content: true, useCaseFolder: true, testCase: { select: { useCaseTag: true } } },
  });
  // 2. Manually linked script
  if (!script) {
    const tc = await prisma.testCase.findUnique({
      where: { id: tcId },
      select: { linkedScript: { select: { filename: true, content: true, useCaseFolder: true } } },
    });
    script = tc?.linkedScript ? { ...tc.linkedScript, testCase: null } : null;
  }
  if (!script) return null;
  const found = findScriptPath(slug, script.filename);
  if (found) return found;
  if (script.content) {
    const useCase = script.useCaseFolder ?? (script.testCase as { useCaseTag?: string } | null)?.useCaseTag ?? null;
    saveScript(slug, script.filename, script.content, useCase);
    return findScriptPath(slug, script.filename) ?? `${SCRIPTS_ROOT}/${slug}/scripts/${script.filename}`;
  }
  return null;
}

const jobs = new Map<string, cron.ScheduledTask>();

export async function loadSchedules(): Promise<void> {
  try {
    const schedules = await prisma.schedule.findMany({
      where: { isActive: true },
      include: { project: { select: { baseUrl: true, slug: true } } },
    });
    for (const schedule of schedules) {
      registerSchedule(schedule);
    }
    console.log(`[scheduler] Loaded ${schedules.length} active schedule(s)`);
  } catch (err) {
    console.error('[scheduler] Failed to load schedules:', err);
  }
}

interface ScheduleRow {
  id: string;
  projectId: string;
  name: string;
  cronExpression: string;
  testCaseIds: string;
  environment: string;
  parallelWorkers: number;
  project?: { baseUrl?: string | null; slug?: string | null } | null;
}

export function registerSchedule(schedule: ScheduleRow): void {
  if (jobs.has(schedule.id)) {
    jobs.get(schedule.id)?.stop();
    jobs.delete(schedule.id);
  }

  if (!cron.validate(schedule.cronExpression)) {
    console.warn(`[scheduler] Invalid cron for schedule ${schedule.id}: "${schedule.cronExpression}"`);
    return;
  }

  const task = cron.schedule(schedule.cronExpression, async () => {
    console.log(`[scheduler] Firing schedule "${schedule.name}" (${schedule.id})`);
    try {
      const testCaseIds: string[] = JSON.parse(schedule.testCaseIds);
      if (testCaseIds.length === 0) return;

      // Fetch project slug for resolveScriptPath
      const project = await prisma.project.findUnique({
        where: { id: schedule.projectId },
        select: { slug: true, baseUrl: true },
      });
      const slug = project?.slug ?? schedule.projectId;

      // Resolve script paths using the same logic as suite runs (handles linkedScriptId + disk write)
      const pairs: { tcId: string; path: string }[] = [];
      const skippedTcIds: string[] = [];
      for (const tcId of testCaseIds) {
        const p = await resolveScriptPath(slug, schedule.projectId, tcId);
        if (p) pairs.push({ tcId, path: p });
        else skippedTcIds.push(tcId);
      }

      const envConfig = await prisma.envConfig.findFirst({
        where: { projectId: schedule.projectId, name: schedule.environment },
        select: { baseUrl: true, username: true, password: true },
      });

      const seqAgg = await prisma.run.aggregate({ _max: { runSeq: true } });
      const runSeq = (seqAgg._max.runSeq ?? 0) + 1;

      const run = await prisma.run.create({
        data: {
          projectId: schedule.projectId,
          runSeq,
          name: `Scheduled: ${schedule.name}`,
          environment: schedule.environment,
          status: 'PENDING',
          triggerType: 'SCHEDULED',
        },
      });

      await addRunJob({
        runId: run.id,
        runSeq,
        projectId: schedule.projectId,
        testCaseIds: pairs.map((p) => p.tcId),
        scriptPaths: pairs.map((p) => p.path),
        skippedTcIds,
        environment: schedule.environment,
        envBaseUrl: envConfig?.baseUrl ?? schedule.project?.baseUrl ?? '',
        envUsername: envConfig?.username ?? '',
        envPassword: envConfig?.password ?? '',
        parallelWorkers: schedule.parallelWorkers,
        headless: true,
        browser: 'chromium',
        triggerType: 'SCHEDULED',
      });
    } catch (err) {
      console.error(`[scheduler] Error firing schedule ${schedule.id}:`, err);
    }
  });

  jobs.set(schedule.id, task);
}

export function unregisterSchedule(id: string): void {
  jobs.get(id)?.stop();
  jobs.delete(id);
}
