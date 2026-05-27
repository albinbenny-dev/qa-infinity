import { writeFileSync } from 'fs';
import { join } from 'path';
import { chromium } from 'playwright-core';
import type { Page } from 'playwright-core';
import { prisma } from '../lib/prisma.js';
import { runClassifier, runPatcher, needsAgentTrace, type ClassifierResult, type HealType } from '../agents/healingAgent.js';
import { getHealingAgentSettings } from '../lib/agentConfig.js';
import { runBrowserAgent } from '../agents/browserAgent.js';
import { captureSnapshot } from './domCapture.js';
import { saveAgentLearnings } from './agentLearningService.js';
import { addRunJob } from '../lib/queue.js';
import { getRunsNamespace } from '../lib/socket.js';
import type { LoginInstructions, RecordedAction } from '../types/scanner.js';

const SCRIPTS_ROOT = process.env.SCRIPTS_PATH ?? '/scripts';
const AUTO_APPLY_THRESHOLD = 95;
const CHROMIUM_PATH =
  process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ?? '/usr/bin/chromium-browser';

// ── Login replay (mirrors agentScanWorker) ─────────────────────────────────

async function executeLoginFromInstructions(
  page: Page,
  login: LoginInstructions,
  username: string,
  password: string,
): Promise<void> {
  for (const step of login.steps) {
    if (!step.selector) continue;
    try {
      if (step.action === 'fill') {
        const isPassword = step.description.toLowerCase().includes('password');
        const value = isPassword ? password : username;
        const el = page.locator(step.selector).first();
        await el.click({ clickCount: 3, timeout: 5000 });
        await el.fill(value, { timeout: 5000 });
      } else if (step.action === 'click') {
        await page.locator(step.selector).first().click({ timeout: 10000 });
        await page.waitForTimeout(500);
      }
    } catch (err) {
      console.warn(`[heal-service] Login step "${step.description}" failed:`, (err as Error).message);
    }
  }
  await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => undefined);
}

// ── Healing browser trace ──────────────────────────────────────────────────
// Launches a headless browser, logs in, and runs the browser agent to reproduce
// the failing test scenario. Returns a text summary for the patcher.

async function runHealTrace(opts: {
  agentTraceId: string;
  projectId: string;
  baseUrl: string;
  testGoal: string;
  loginInstructions: LoginInstructions;
  username: string;
  password: string;
  classResult?: ClassifierResult;
  scriptContent?: string;
}): Promise<{ summary: string; actions: RecordedAction[] }> {
  const browser = await chromium.launch({
    executablePath: CHROMIUM_PATH,
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    ignoreHTTPSErrors: true,
  });
  const page = await context.newPage();

  try {
    await page.goto(opts.baseUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await executeLoginFromInstructions(page, opts.loginInstructions, opts.username, opts.password);

    const additionalContext = opts.classResult?.type === 'SELECTOR'
      ? [
          'You are diagnosing a failing element selector in a Playwright test.',
          'The script uses getByRole / getByLabel / getByTestId but one or more elements were not found.',
          'YOUR TASK:',
          '1. Navigate to the area under test.',
          '2. Locate every interactive element on the page (buttons, inputs, links, dropdowns).',
          '3. For each element, record its exact role, accessible name, placeholder, and data-testid if present.',
          '4. Identify which element the script was trying to target and record its correct selector.',
          'Do NOT skip elements — the patcher needs the exact accessible names to fix the script.',
        ].join('\n')
      : [
          'You are diagnosing a failing test flow. The script may be missing prerequisite steps',
          '(such as login, navigation, or a modal dismissal) or may use incorrect timing/assertions.',
          'YOUR TASK:',
          '1. Start from the application root and complete any required login or authentication.',
          '2. Navigate step-by-step to the page the test targets.',
          '3. Record every step taken, including any prerequisite steps not present in the original script.',
          '4. If you reach a blocked state, document exactly where and why.',
          'The patcher will use this trace to insert any missing steps and fix incorrect flow.',
        ].join('\n');

    const agentResult = await runBrowserAgent({
      page,
      baseUrl: opts.baseUrl,
      targetUrl: opts.baseUrl,
      menuContext: 'heal-diagnostic',
      testGoal: opts.testGoal,
      additionalContext,
      projectId: opts.projectId,
      onStep: async (step: RecordedAction) => {
        await prisma.agentTrace
          .update({
            where: { id: opts.agentTraceId },
            data: {
              stepCount: step.stepNumber,
              currentStep: step.stepDescription ?? step.toolName,
            },
          })
          .catch(console.error);
      },
    });

    const finalStatus = agentResult.finish.status === 'success' ? 'COMPLETED' : 'BLOCKED';
    await prisma.agentTrace.update({
      where: { id: opts.agentTraceId },
      data: {
        status: finalStatus,
        stepCount: agentResult.totalSteps,
        actionLog: JSON.stringify(agentResult.actions),
        completedAt: new Date(),
      },
    });

    const successActions = agentResult.actions.filter((a) => a.success);
    const failedAction = agentResult.actions.find((a) => !a.success);
    const summary = [
      `Trace status: ${finalStatus}`,
      agentResult.finish.blockedReason
        ? `Blocked at: ${agentResult.finish.blockedReason}`
        : '',
      `Steps completed: ${successActions.length} / ${agentResult.totalSteps}`,
      failedAction
        ? `First failure: ${failedAction.stepDescription ?? failedAction.toolName}` +
          `${failedAction.selector ? ` — selector: ${failedAction.selector}` : ''}` +
          `${failedAction.errorMessage ? ` — ${failedAction.errorMessage}` : ''}`
        : '',
      '\nVerified actions:',
      ...successActions
        .slice(0, 15)
        .map(
          (a, i) =>
            `${i + 1}. ${a.toolName}` +
            `${a.selector ? `('${a.selector}')` : ''}` +
            `${a.stepDescription ? ` — ${a.stepDescription}` : ''} ✓`,
        ),
      failedAction
        ? `${successActions.length + 1}. ${failedAction.toolName}` +
          `${failedAction.selector ? `('${failedAction.selector}')` : ''}` +
          ` ✗ — ${failedAction.errorMessage ?? 'failed'}`
        : '',
    ]
      .filter(Boolean)
      .join('\n');

    return { summary, actions: agentResult.actions };
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    await prisma.agentTrace
      .update({
        where: { id: opts.agentTraceId },
        data: { status: 'FAILED', errorMessage, completedAt: new Date() },
      })
      .catch(console.error);
    throw err;
  } finally {
    await context.close().catch(console.error);
    await browser.close().catch(console.error);
  }
}

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
          project: { select: { id: true, name: true, baseUrl: true, slug: true } },
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

  const projectSlug = project.slug;
  getRunsNamespace()?.emit('heal:started', {
    runResultId,
    projectId,
    projectSlug,
    tcTitle: runResult.testCase?.title ?? 'Test',
  });

  const classResult = await runClassifier({
    errorMessage: runResult.errorMessage ?? 'Unknown error',
    scriptContent: script.content,
  });

  const { selectorTraceThreshold } = await getHealingAgentSettings();
  const traceDecision = needsAgentTrace(classResult, selectorTraceThreshold);
  let agentTraceId: string | undefined;
  let agentTraceContext: string | undefined;

  if (traceDecision.needed && project.baseUrl) {
    console.log(`[heal-service] Agent trace required: ${traceDecision.reason}`);
    getRunsNamespace()?.emit('heal:progress', {
      runResultId,
      projectId,
      projectSlug,
      phase: 'TRACING',
      tcTitle: runResult.testCase?.title ?? 'Test',
    });
    try {
      const envConfig = await prisma.envConfig.findFirst({
        where: { projectId, name: runResult.run.environment },
        select: { username: true, password: true },
      });

      const projectContext = await prisma.projectContext.findUnique({ where: { projectId } });
      const loginInstructions: LoginInstructions = projectContext?.loginInstructions
        ? (JSON.parse(projectContext.loginInstructions) as LoginInstructions)
        : { steps: [], selectors: { username: '', password: '', submit: '' }, loginType: 'standard', postLoginUrl: '', notes: '' };

      const tcTitle = runResult.testCase?.title ?? 'Unknown';
      const errSnippet = (runResult.errorMessage ?? '').slice(0, 150);
      const testGoal = classResult.type === 'SELECTOR'
        ? `Find correct selectors for: ${tcTitle} — Script error: ${errSnippet}`
        : `Diagnose missing/incorrect steps for: ${tcTitle} — Including prerequisites like login. Error: ${errSnippet}`;

      const trace = await prisma.agentTrace.create({
        data: {
          projectId,
          status: 'RUNNING',
          testGoal,
          menuContext: 'heal-diagnostic',
        },
      });
      agentTraceId = trace.id;

      const traceResult = await runHealTrace({
        agentTraceId: trace.id,
        projectId,
        baseUrl: project.baseUrl,
        testGoal,
        loginInstructions,
        username: envConfig?.username ?? '',
        password: envConfig?.password ?? '',
        classResult,
        scriptContent: script.content,
      });

      agentTraceContext = traceResult.summary;
      console.log(`[heal-service] Agent trace ${trace.id} complete — using live trace context for patch`);

      // Persist verified selectors so future script generation can use them
      const menuCtx = runResult.testCase?.title ?? 'heal-diagnostic';
      await saveAgentLearnings(projectId, menuCtx, project.baseUrl, traceResult.actions).catch(
        (e) => console.warn('[heal-service] saveAgentLearnings failed (non-fatal):', (e as Error).message),
      );
    } catch (traceErr) {
      console.warn(
        '[heal-service] Agent trace failed — falling back to static analysis:',
        (traceErr as Error).message,
      );
      agentTraceId = undefined;
      agentTraceContext = undefined;
    }
  } else {
    console.log(`[heal-service] Static analysis: ${traceDecision.reason}`);
  }

  // DOM snapshot for SELECTOR type — only when no agent trace was run
  let domSnapshot: string | undefined;
  if (!agentTraceContext && classResult.type === 'SELECTOR' && project.baseUrl) {
    const snapshot = await captureSnapshot(project.baseUrl);
    if (snapshot) {
      domSnapshot = JSON.stringify(snapshot.interactiveElements, null, 2);
    }
  }

  getRunsNamespace()?.emit('heal:progress', {
    runResultId,
    projectId,
    projectSlug,
    phase: 'PATCHING',
    tcTitle: runResult.testCase?.title ?? 'Test',
  });

  const patchResult = await runPatcher({
    type: classResult.type,
    errorMessage: runResult.errorMessage ?? 'Unknown error',
    originalScript: script.content,
    domSnapshot,
    agentTraceContext,
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
      agentTraceId: agentTraceId ?? null,
    },
  });

  if (!autoApply) {
    getRunsNamespace()?.emit('heal:pending-created', {
      healId: heal.id,
      projectId,
      projectSlug,
      tcTitle: runResult.testCase?.title ?? 'Test',
      confidence: finalConfidence,
      runResultId,
    });
  }

  if (autoApply) {
    writeScriptToDisk(projectId, script.filename, patchResult.patchedScript);
    // Promote to golden — auto-applied at ≥95% confidence is a trusted fix
    await prisma.script.update({
      where: { id: script.id },
      data: { content: patchResult.patchedScript, isGolden: true },
    });
    console.log(`[heal-service] Auto-applied heal ${heal.id} (confidence: ${finalConfidence}%) — script promoted to golden`);

    // Notify all connected clients so the UI can show a toast
    getRunsNamespace()?.emit('heal:auto-applied', {
      healId: heal.id,
      projectId,
      projectSlug,
      tcTitle: runResult.testCase?.title ?? 'Test',
      confidence: finalConfidence,
      explanation: patchResult.explanation,
      runResultId,
    });
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

// ── retryHealWithContext ──────────────────────────────────────────────────────
// Re-run the patcher chain with user-supplied context, updating the existing heal record.

export async function retryHealWithContext(healId: string, userContext: string): Promise<void> {
  const heal = await prisma.heal.findUnique({
    where: { id: healId },
    include: {
      runResult: {
        include: {
          testCase: { select: { id: true, title: true } },
          script: { select: { id: true, filename: true, content: true } },
          run: {
            include: {
              project: { select: { id: true, name: true, baseUrl: true, slug: true } },
            },
          },
        },
      },
    },
  });

  if (!heal) throw new Error('Heal not found');

  const { runResult } = heal;
  const project = runResult.run.project;
  const script = runResult.script;
  if (!script) throw new Error('No script linked to this heal');

  const patchResult = await runPatcher({
    type: heal.type as HealType,
    errorMessage: runResult.errorMessage ?? 'Unknown error',
    originalScript: heal.originalCode,
    agentTraceContext: `User-provided context about this failure:\n${userContext}`,
    projectName: project.name,
    baseUrl: project.baseUrl ?? undefined,
  });

  const finalConfidence = Math.min(100, Math.round(patchResult.confidence));
  const autoApply = finalConfidence >= AUTO_APPLY_THRESHOLD;

  await prisma.heal.update({
    where: { id: healId },
    data: {
      patchedCode: patchResult.patchedScript,
      confidence: finalConfidence,
      summary: patchResult.explanation,
      ...(autoApply ? { status: 'AUTO_APPLIED' } : {}),
    },
  });

  if (autoApply) {
    writeScriptToDisk(heal.projectId, script.filename, patchResult.patchedScript);
    await prisma.script.update({
      where: { id: script.id },
      data: { content: patchResult.patchedScript, isGolden: true },
    });

    getRunsNamespace()?.emit('heal:auto-applied', {
      healId: heal.id,
      projectId: heal.projectId,
      projectSlug: project.slug,
      tcTitle: runResult.testCase?.title ?? 'Test',
      confidence: finalConfidence,
      explanation: patchResult.explanation,
      runResultId: heal.runResultId,
    });
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
      triggerType: 'INDIVIDUAL',
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
    triggerType: 'INDIVIDUAL',
  });

  return run.id;
}
