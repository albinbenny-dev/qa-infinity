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
      const rawPairs: { tcId: string; path: string }[] = [];
      const skippedTcIds: string[] = [];
      for (const tcId of testCaseIds) {
        const p = await resolveScriptPath(slug, schedule.projectId, tcId);
        if (p) rawPairs.push({ tcId, path: p });
        else skippedTcIds.push(tcId);
      }

      // Deduplicate by scriptPath — same script linked to multiple TCs runs only once
      const seenPaths = new Map<string, string>(); // path → rep tcId
      const scriptPairs: { tcId: string; path: string }[] = [];
      const mirrorMap: Record<string, string[]> = {};
      for (const p of rawPairs) {
        const rep = seenPaths.get(p.path);
        if (rep) {
          mirrorMap[rep] = [...(mirrorMap[rep] ?? []), p.tcId];
        } else {
          seenPaths.set(p.path, p.tcId);
          scriptPairs.push(p);
        }
      }

      // Skip this firing if a run for this schedule is still active
      const activeRun = await prisma.run.findFirst({
        where: {
          projectId: schedule.projectId,
          name: { contains: schedule.name },
          triggerType: 'SCHEDULED',
          status: { in: ['PENDING', 'RUNNING'] },
        },
        select: { id: true, runSeq: true },
      });
      if (activeRun) {
        console.log(`[scheduler] Skipping "${schedule.name}" — RUN-${String(activeRun.runSeq).padStart(4, '0')} still active`);
        return;
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
          parallelWorkers: schedule.parallelWorkers,
        },
      });

      await addRunJob({
        runId: run.id,
        runSeq,
        projectId: schedule.projectId,
        testCaseIds: scriptPairs.map((p) => p.tcId),
        scriptPaths: scriptPairs.map((p) => p.path),
        skippedTcIds,
        mirroredTcIds: mirrorMap,
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
