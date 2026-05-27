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
import type { AgentScanJobPayload } from '../lib/queue.js';
import type { LoginInstructions, RecordedAction } from '../types/scanner.js';
import { saveAgentLearnings } from '../services/agentLearningService.js';

const CHROMIUM_PATH =
  process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ?? '/usr/bin/chromium-browser';

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
      console.warn(`[agent-scan-worker] Login step "${step.description}" failed:`, (err as Error).message);
    }
  }
  await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => undefined);
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

      // 2. Load login instructions from ProjectContext
      const projectContext = await prisma.projectContext.findUnique({ where: { projectId } });
      const loginInstructions: LoginInstructions = projectContext?.loginInstructions
        ? (JSON.parse(projectContext.loginInstructions) as LoginInstructions)
        : { steps: [], selectors: { username: '', password: '', submit: '' }, loginType: 'standard', postLoginUrl: '', notes: '' };

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
          projectId,
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

        // 6. LLM analysis: decompose trace into multiple structured test cases
        const generatedTCs = await analyzeTraceToTestCases(
          agentResult.actions,
          agentResult.finish,
          menuContext,
          testGoal,
          loginInstructions,
          projectId,
        );

        // 7. Generate Playwright script from verified actions
        const scriptContent = actionLogToPlaywrightScript(
          agentResult.actions,
          agentResult.finish,
          loginInstructions,
          targetUrl,
        );

        // 8. Save agent learnings (req 1.3)
        await saveAgentLearnings(projectId, menuContext, targetUrl, agentResult.actions);

        // 9. Update AgentTrace as COMPLETED
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

        // 10. Emit done with generated TCs for the frontend to display in GeneratedTCList
        emitToProject(projectId, 'agent-trace:done', {
          agentTraceId,
          projectId,
          status: finalStatus,
          testCases: generatedTCs,
          scriptContent,
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
        await context.close().catch(console.error);
        await browser.close().catch(console.error);
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
