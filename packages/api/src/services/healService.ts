import { writeFileSync } from 'fs';
import { join } from 'path';
import { prisma } from '../lib/prisma.js';
import { runClassifier, runPatcher } from '../agents/healingAgent.js';
import { captureSnapshot } from './domCapture.js';
import { addRunJob } from '../lib/queue.js';

const SCRIPTS_ROOT = process.env.SCRIPTS_PATH ?? '/scripts';
const AUTO_APPLY_THRESHOLD = 95;
const MAX_HEAL_ATTEMPTS = 3;

// ── triggerHeal ──────────────────────────────────────────────────────────────
// Load RunResult → Classify → DOM capture (SELECTOR) → Patch → Save → Maybe auto-apply

export async function triggerHeal(runResultId: string): Promise<void> {
  const existing = await prisma.heal.findFirst({ where: { runResultId } });
  if (existing) return;

  const runResult = await prisma.runResult.findUnique({
    where: { id: runResultId },
    include: {
      testCase: { select: { id: true, title: true } },
      script: { select: { id: true, filename: true, content: true } },
      run: {
        include: {
          project: { select: { id: true, name: true, baseUrl: true } },
        },
      },
    },
  });

  if (!runResult) throw new Error(`RunResult ${runResultId} not found`);

  // If the run was cancelled by the user (Stop Loop), skip heal creation entirely
  if (runResult.run.status === 'CANCELLED') {
    console.log(`[heal-service] Run ${runResult.run.id} was cancelled — skipping heal for runResult ${runResultId}`);
    return;
  }

  const { projectId } = runResult.run;
  const project = runResult.run.project;

  // Resolve script — prefer the linked script, fall back to latest script for the test case
  let script = runResult.script;
  if (!script && runResult.testCase?.id) {
    const found = await prisma.script.findFirst({
      where: { testCaseId: runResult.testCase.id, projectId },
      select: { id: true, filename: true, content: true },
      orderBy: { updatedAt: 'desc' },
    });
    script = found ?? null;
  }
  if (!script) {
    console.warn(`[heal-service] No script found for runResult ${runResultId} — skipping`);
    return;
  }

  // Guard: enforce MAX_HEAL_ATTEMPTS per healing chain.
  // Only HEAL_RERUN runs (spawned by heal approval) count against the limit.
  // MANUAL / SCHEDULED / GROUP / INDIVIDUAL all start a fresh chain.
  const testCaseId = runResult.testCase?.id;
  const currentTriggerType = runResult.run.triggerType;

  if (testCaseId && currentTriggerType === 'HEAL_RERUN') {
    // Find chain start: the most recent non-heal-spawned run for this TC
    const chainStart = await prisma.run.findFirst({
      where: {
        projectId,
        triggerType: { in: ['MANUAL', 'SCHEDULED', 'GROUP', 'INDIVIDUAL'] },
        results: { some: { testCaseId } },
      },
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true },
    });

    const chainStartTime = chainStart?.createdAt ?? new Date(0);

    const priorApplied = await prisma.heal.count({
      where: {
        projectId,
        status: { in: ['APPROVED', 'AUTO_APPLIED'] },
        runResult: {
          testCaseId,
          run: { createdAt: { gte: chainStartTime } },
        },
      },
    });

    if (priorApplied >= MAX_HEAL_ATTEMPTS) {
      await prisma.heal.create({
        data: {
          projectId,
          runResultId,
          type: 'FLOW',
          originalCode: script.content,
          patchedCode: script.content,
          confidence: 0,
          summary: `Healing exhausted after ${priorApplied} applied attempt${priorApplied !== 1 ? 's' : ''} in this run chain. The agent could not automatically resolve this failure — manual investigation is required.`,
          status: 'EXHAUSTED',
        },
      });
      console.warn(`[heal-service] Max heal attempts (${MAX_HEAL_ATTEMPTS}) reached for TC ${testCaseId} in current chain — marked EXHAUSTED`);
      return;
    }
  }
  // All other trigger types: always proceed — fresh chain, no prior history considered

  const classResult = await runClassifier({
    errorMessage: runResult.errorMessage ?? 'Unknown error',
    scriptContent: script.content,
  });

  let domSnapshot: string | undefined;
  if (classResult.type === 'SELECTOR' && project.baseUrl) {
    const snapshot = await captureSnapshot(project.baseUrl);
    if (snapshot) {
      domSnapshot = JSON.stringify(snapshot.interactiveElements, null, 2);
    }
  }

  const patchResult = await runPatcher({
    type: classResult.type,
    errorMessage: runResult.errorMessage ?? 'Unknown error',
    originalScript: script.content,
    domSnapshot,
    projectName: project.name,
    baseUrl: project.baseUrl,
  });

  // Combine confidence: classifier 30% + patcher 70%
  const rawConfidence = classResult.confidence * 0.3 + patchResult.confidence * 0.7;
  const finalConfidence = Math.min(100, Math.round(rawConfidence));
  const autoApply = finalConfidence >= AUTO_APPLY_THRESHOLD;

  const heal = await prisma.heal.create({
    data: {
      projectId,
      runResultId,
      type: classResult.type,
      originalCode: script.content,
      patchedCode: patchResult.patchedScript,
      confidence: finalConfidence,
      summary: patchResult.explanation,
      status: autoApply ? 'AUTO_APPLIED' : 'PENDING',
    },
  });

  if (autoApply) {
    writeScriptToDisk(projectId, script.filename, patchResult.patchedScript);
    // Promote to golden — auto-applied at ≥95% confidence is a trusted fix
    await prisma.script.update({
      where: { id: script.id },
      data: { content: patchResult.patchedScript, isGolden: true },
    });
    console.log(`[heal-service] Auto-applied heal ${heal.id} (confidence: ${finalConfidence}%) — script promoted to golden`);
  }
}

// ── applyHeal ────────────────────────────────────────────────────────────────
// Write patched code to disk + update script DB + mark heal as APPROVED

export async function applyHeal(healId: string): Promise<{
  projectId: string;
  testCaseId: string;
  scriptFilename: string;
  environment: string;
  envBaseUrl: string;
}> {
  const heal = await prisma.heal.findUnique({
    where: { id: healId },
    include: {
      runResult: {
        include: {
          script: true,
          testCase: { select: { id: true } },
          run: { select: { environment: true } },
        },
      },
    },
  });

  if (!heal) throw new Error('Heal not found');
  if (!heal.runResult.script) throw new Error('No script linked to this heal');

  const { projectId } = heal;
  const script = heal.runResult.script;

  writeScriptToDisk(projectId, script.filename, heal.patchedCode);

  const testCaseId = heal.runResult.testCase.id;

  // Auto-reject any other PENDING heals for the same test case so a second
  // approval cannot overwrite the script mid-run or spawn a second run.
  const siblingIds = await prisma.heal.findMany({
    where: {
      projectId,
      id: { not: healId },
      status: 'PENDING',
      runResult: { testCase: { id: testCaseId } },
    },
    select: { id: true },
  });

  // Human-approved heal = expert-validated fix → promote script to golden
  await prisma.$transaction([
    prisma.heal.update({ where: { id: healId }, data: { status: 'APPROVED' } }),
    prisma.script.update({ where: { id: script.id }, data: { content: heal.patchedCode, isGolden: true } }),
    ...(siblingIds.length > 0
      ? [prisma.heal.updateMany({
          where: { id: { in: siblingIds.map((h) => h.id) } },
          data: { status: 'REJECTED' },
        })]
      : []),
  ]);
  console.log(`[heal-service] Heal ${healId} approved — script ${script.id} promoted to golden`);

  const envConfig = await prisma.envConfig.findFirst({
    where: { projectId, name: heal.runResult.run.environment },
    select: { baseUrl: true },
  });

  return {
    projectId,
    testCaseId: heal.runResult.testCase.id,
    scriptFilename: script.filename,
    environment: heal.runResult.run.environment,
    envBaseUrl: envConfig?.baseUrl ?? '',
  };
}

// ── rejectHeal ───────────────────────────────────────────────────────────────

export async function rejectHeal(healId: string): Promise<void> {
  const heal = await prisma.heal.findUnique({ where: { id: healId }, select: { id: true } });
  if (!heal) throw new Error('Heal not found');
  await prisma.heal.update({ where: { id: healId }, data: { status: 'REJECTED' } });
}

// ── helpers ──────────────────────────────────────────────────────────────────

function writeScriptToDisk(projectId: string, filename: string, content: string): void {
  try {
    const scriptPath = join(SCRIPTS_ROOT, projectId, filename);
    writeFileSync(scriptPath, content, 'utf8');
  } catch (err) {
    console.error('[heal-service] Failed to write patched script to disk:', (err as Error).message);
  }
}

export async function requeueHealedTest(opts: {
  projectId: string;
  testCaseId: string;
  scriptFilename: string;
  environment: string;
  envBaseUrl: string;
}): Promise<string> {
  const tc = await prisma.testCase.findUnique({
    where: { id: opts.testCaseId },
    select: { title: true },
  });

  const run = await prisma.run.create({
    data: {
      projectId: opts.projectId,
      name: `Healed: ${tc?.title ?? 'Test'}`,
      environment: opts.environment,
      status: 'PENDING',
      triggerType: 'HEAL_RERUN',
    },
  });

  await addRunJob({
    runId: run.id,
    projectId: opts.projectId,
    testCaseIds: [opts.testCaseId],
    scriptPaths: [`/scripts/${opts.projectId}/${opts.scriptFilename}`],
    environment: opts.environment,
    envBaseUrl: opts.envBaseUrl,
    parallelWorkers: 1,
    headless: true,
    browser: 'chromium',
    triggerType: 'HEAL_RERUN',
  });

  return run.id;
}
