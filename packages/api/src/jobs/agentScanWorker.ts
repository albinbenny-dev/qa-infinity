import path from 'path';
import fs from 'fs';
import { Worker } from 'bullmq';
import { chromium } from 'playwright-core';
import type { Page } from 'playwright-core';
import { prisma } from '../lib/prisma.js';
import { emitToProject } from '../lib/socket.js';
import {
  runBrowserAgent,
  analyzeTraceToTestCases,
  actionLogToPlaywrightScript,
} from '../agents/browserAgent.js';
import { runScriptAgent } from '../agents/scriptAgent.js';
import type { AgentScanJobPayload } from '../lib/queue.js';
import type { LoginInstructions, RecordedAction, AgentLearning } from '../types/scanner.js';
import { saveAgentLearnings } from '../services/agentLearningService.js';

const CHROMIUM_PATH =
  process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ?? '/usr/bin/chromium-browser';
const ARTIFACTS_ROOT = process.env.ARTIFACTS_PATH ?? '/artifacts';

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

// ── Login replay from stored LoginInstructions ─────────────────────────────

async function executeLoginFromInstructions(
  page: Page,
  login: LoginInstructions,
  username: string,
  password: string,
): Promise<void> {
  let lastFilledSelector: string | null = null;

  for (const step of login.steps) {
    if (!step.selector) continue;
    try {
      if (step.action === 'fill') {
        const isPassword = step.description.toLowerCase().includes('password');
        const value = isPassword ? password : username;
        const el = page.locator(step.selector).first();
        // Wait for the field to become visible — critical for multi-step login forms where
        // the password field only appears after the first Login click (e.g. Ventas 2-step form)
        await el.waitFor({ state: 'visible', timeout: 10000 }).catch(() => undefined);
        await el.click({ clickCount: 3, timeout: 5000 });
        // Use pressSequentially (real key events) instead of fill — Keycloak/SPA login buttons
        // stay disabled when fill() is used because it bypasses key event listeners
        await el.pressSequentially(value, { delay: 50 });
        lastFilledSelector = step.selector;
      } else if (step.action === 'click') {
        const el = page.locator(step.selector).first();
        await el.waitFor({ state: 'visible', timeout: 8000 }).catch(() => undefined);
        const isEnabled = await el.isEnabled().catch(() => false);
        if (!isEnabled) {
          // Button still disabled — submit via Enter on the last filled field
          if (lastFilledSelector) {
            await page.locator(lastFilledSelector).first().press('Enter').catch(() => undefined);
          } else {
            await el.click({ force: true, timeout: 5000 }).catch(() => undefined);
          }
        } else {
          await el.click({ timeout: 10000 });
        }
        // Give the SPA time to react — may reveal next form fields or begin navigation
        await page.waitForTimeout(1500);
      }
    } catch (err) {
      console.warn(`[agent-scan-worker] Login step "${step.description}" failed:`, (err as Error).message);
    }
  }

  // Wait for the app to navigate away from the login page
  const loginPageUrl = page.url();
  await page.waitForURL(url => url.href !== loginPageUrl, { timeout: 15000 })
    .catch(() => page.waitForLoadState('domcontentloaded', { timeout: 10000 }).catch(() => undefined));
  // Brief settle for SPA routing after successful login
  await page.waitForTimeout(1000);
}

// ── Worker ─────────────────────────────────────────────────────────────────

export function startAgentScanWorker(): void {
  const connection = parseRedisUrl(process.env.REDIS_URL ?? 'redis://localhost:6379');

  const worker = new Worker<AgentScanJobPayload>(
    'agent-scans',
    async (job) => {
      const {
        agentTraceId,
        projectId,
        projectName,
        baseUrl,
        targetUrl,
        menuContext,
        username,
        password,
        testGoal,
        seedSteps,
        additionalContext,
      } = job.data;

      // 1. Mark as RUNNING
      await prisma.agentTrace.update({
        where: { id: agentTraceId },
        data: { status: 'RUNNING' },
      });

      emitToProject(projectId, 'agent-trace:started', {
        agentTraceId,
        projectId,
        menuContext,
        targetUrl,
      });

      // 2. Load login instructions + product context from ProjectContext
      const projectContext = await prisma.projectContext.findUnique({ where: { projectId } });
      const loginInstructions: LoginInstructions = projectContext?.loginInstructions
        ? (JSON.parse(projectContext.loginInstructions) as LoginInstructions)
        : { steps: [], selectors: { username: '', password: '', submit: '' }, loginType: 'standard', postLoginUrl: '', notes: '' };

      // Gather learnings, navigation map, and existing TCs for this feature to give the
      // browser agent product knowledge (so it can navigate and generate meaningful TCs)
      const agentLearnings: AgentLearning[] = projectContext?.agentLearnings
        ? (JSON.parse(projectContext.agentLearnings) as AgentLearning[])
        : [];
      const navigationMap: Array<{ label: string; url: string }> = projectContext?.navigationMap
        ? (JSON.parse(projectContext.navigationMap) as Array<{ label: string; url: string }>)
        : [];
      const existingTCRows = await prisma.testCase.findMany({
        where: { projectId, useCaseTag: menuContext },
        select: { title: true, steps: true },
        orderBy: { createdAt: 'desc' },
        take: 10,
      });
      const existingTCsForFeature = existingTCRows.map(tc => ({
        title: tc.title,
        steps: JSON.parse(tc.steps || '[]') as string[],
      }));

      const productContext = { agentLearnings, navigationMap, existingTCsForFeature };

      const browser = await chromium.launch({
        executablePath: CHROMIUM_PATH,
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
      });

      // Try to create a video-recording context; fall back silently if ffmpeg is missing.
      // Uses an async IIFE so context + page are always typed as non-null below.
      const { context, page } = await (async () => {
        const vDir = path.join(ARTIFACTS_ROOT, projectId, 'agent-traces', agentTraceId);
        try {
          fs.mkdirSync(vDir, { recursive: true });
          const ctx = await browser.newContext({
            viewport: { width: 1280, height: 800 },
            ignoreHTTPSErrors: true,
            recordVideo: { dir: vDir, size: { width: 1280, height: 800 } },
          });
          const pg = await ctx.newPage(); // throws if ffmpeg binary is missing
          return { context: ctx, page: pg };
        } catch (videoErr) {
          console.warn(
            '[agent-scan-worker] Video recording unavailable (ffmpeg missing?), running without recording:',
            (videoErr as Error).message.split('\n')[0],
          );
          const ctx = await browser.newContext({
            viewport: { width: 1280, height: 800 },
            ignoreHTTPSErrors: true,
          });
          return { context: ctx, page: await ctx.newPage() };
        }
      })();

      // Accumulate actions for onStep DB updates
      const accumulatedActions: RecordedAction[] = [];

      try {
        // 3. Navigate to app and login
        await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await executeLoginFromInstructions(page, loginInstructions, username, password);

        // 4. Navigate to target menu
        const targetFull = targetUrl.startsWith('http')
          ? targetUrl
          : new URL(targetUrl, baseUrl).href;
        await page.goto(targetFull, { waitUntil: 'domcontentloaded', timeout: 20000 });
        await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => undefined);

        // 5. Run browser agent loop
        const agentResult = await runBrowserAgent({
          page,
          baseUrl,
          targetUrl,
          menuContext,
          testGoal,
          seedSteps,
          additionalContext,
          productContext,
          projectId,
          projectName,
          onStep: async (step: RecordedAction) => {
            accumulatedActions.push(step);
            await prisma.agentTrace.update({
              where: { id: agentTraceId },
              data: {
                stepCount: step.stepNumber,
                currentStep: step.stepDescription ?? step.toolName,
              },
            }).catch(console.error);

            emitToProject(projectId, 'agent-trace:step', {
              agentTraceId,
              projectId,
              step: {
                stepNumber: step.stepNumber,
                toolName: step.toolName,
                stepDescription: step.stepDescription,
                success: step.success,
                errorMessage: step.errorMessage,
              },
            });
          },
        });

        // Signal to the UI that browser steps are done and analysis is starting
        emitToProject(projectId, 'agent-trace:step', {
          agentTraceId,
          step: {
            stepNumber: agentResult.totalSteps + 1,
            toolName: 'analyze',
            stepDescription: 'Analysing trace and generating test cases…',
            success: true,
          },
        });

        // 6. LLM analysis: decompose trace into multiple structured test cases
        const generatedTCs = await analyzeTraceToTestCases(
          agentResult.actions,
          agentResult.finish,
          menuContext,
          testGoal,
          loginInstructions,
          projectId,
          projectName,
        );

        // 7. Happy-path script — deterministic, built directly from verified trace actions (no LLM)
        const happyPathScript = agentResult.finish.status === 'success'
          ? actionLogToPlaywrightScript(agentResult.actions, agentResult.finish, loginInstructions, targetUrl)
          : null;

        // Signal that parallel script generation is starting
        emitToProject(projectId, 'agent-trace:step', {
          agentTraceId,
          step: {
            stepNumber: agentResult.totalSteps + 2,
            toolName: 'script_gen',
            stepDescription: `Generating Playwright scripts for ${generatedTCs.length} test case${generatedTCs.length !== 1 ? 's' : ''}…`,
            success: true,
          },
        });

        // 8. Generate scripts for ALL TCs in parallel using the trace's locked locators.
        //    TC[0] (happy-path): use the deterministic trace script.
        //    TC[1..n] (validation / negative): call runScriptAgent with each TC's
        //    generationHints — these carry the real selectors verified in the live browser,
        //    so the script agent gets the exact elements, fields, and forms without any
        //    extra UI scan step.
        const projectRecord = await prisma.project.findUnique({
          where: { id: projectId },
          select: { baseUrl: true },
        });

        const scriptResults = await Promise.allSettled(
          generatedTCs.map(async (tc, i) => {
            if (i === 0 && happyPathScript) return happyPathScript;
            try {
              const result = await runScriptAgent({
                testCase: {
                  id: 'tmp',
                  tcId: `trace-${i}`,
                  title: tc.title,
                  description: tc.description,
                  steps: JSON.stringify(tc.steps),
                  expectedResult: tc.expectedResult,
                  type: tc.type,
                  useCaseTag: tc.useCaseTag,
                  generationHints: tc.generationHints,
                },
                project: {
                  id: projectId,
                  name: projectName ?? '',
                  baseUrl: projectRecord?.baseUrl,
                },
                existingPOMs: [], // self-contained — no POM import needed for trace-gen scripts
              });
              return result.specContent;
            } catch (err) {
              console.warn(`[agent-scan-worker] Script gen failed for TC[${i}] "${tc.title}":`, (err as Error).message);
              return null;
            }
          }),
        );

        // Attach each generated script to its TC so the frontend receives them together
        for (let i = 0; i < generatedTCs.length; i++) {
          const result = scriptResults[i];
          if (result.status === 'fulfilled' && result.value) {
            generatedTCs[i] = { ...generatedTCs[i], scriptContent: result.value };
          }
        }

        // 9. Save agent learnings
        await saveAgentLearnings(projectId, menuContext, targetUrl, agentResult.actions);

        // 10. Update AgentTrace as COMPLETED
        const finalStatus = agentResult.finish.status === 'success' ? 'COMPLETED' : 'BLOCKED';
        await prisma.agentTrace.update({
          where: { id: agentTraceId },
          data: {
            status: finalStatus,
            stepCount: agentResult.totalSteps,
            actionLog: JSON.stringify(agentResult.actions),
            completedAt: new Date(),
          },
        });

        // 11. Emit done — each TC now carries its scriptContent.
        //     The frontend reads scriptContent per-TC, shows ⚡ Script Ready on every card,
        //     and auto-saves the script when the user approves or saves the TC.
        //     Deleting a TC card discards the in-memory script with it — no DB cleanup needed.
        //     Video recording is finalized in the finally block; a separate agent-trace:video-ready
        //     event is emitted once the file is saved to avoid a race condition.
        emitToProject(projectId, 'agent-trace:done', {
          agentTraceId,
          projectId,
          status: finalStatus,
          testCases: generatedTCs,
          stepCount: agentResult.totalSteps,
          menuContext,
          targetUrl,
        });

      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : String(err);
        await prisma.agentTrace.update({
          where: { id: agentTraceId },
          data: { status: 'FAILED', errorMessage, completedAt: new Date() },
        }).catch(console.error);

        emitToProject(projectId, 'agent-trace:failed', {
          agentTraceId,
          projectId,
          error: errorMessage,
        });

        throw err;
      } finally {
        // Capture the video path now, before context.close() finalizes it
        const pendingVideoPath = await page.video()?.path().catch(() => undefined);

        await context.close().catch(console.error);
        await browser.close().catch(console.error);

        // After context.close() the .webm is fully written — rename it to a stable name
        // and persist the path so the download endpoint can serve it
        if (pendingVideoPath) {
          try {
            const stablePath = path.join(path.dirname(pendingVideoPath), 'trace.webm');
            if (pendingVideoPath !== stablePath) fs.renameSync(pendingVideoPath, stablePath);
            await prisma.agentTrace.update({
              where: { id: agentTraceId },
              data: { videoPath: stablePath },
            });
            // Notify the frontend that the recording is now downloadable
            emitToProject(projectId, 'agent-trace:video-ready', { agentTraceId, projectId });
          } catch (videoErr) {
            console.warn('[agent-scan-worker] Could not save trace video:', (videoErr as Error).message);
          }
        }
      }
    },
    { connection, concurrency: 1 },
  );

  worker.on('failed', (job, err) => {
    console.error(`[agent-scan-worker] Job ${job?.id ?? 'unknown'} failed:`, err.message);
  });
  worker.on('completed', (job) => {
    console.log(`[agent-scan-worker] Job ${job.id} completed`);
  });

  console.log('[agent-scan-worker] Started, listening on queue "agent-scans"');
}
