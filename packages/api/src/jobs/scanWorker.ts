import { Worker } from 'bullmq';
import { prisma } from '../lib/prisma.js';
import { getRunsNamespace } from '../lib/socket.js';
import { runUIScan } from '../services/uiScannerService.js';
import { runUIContextAgent } from '../agents/uiContextAgent.js';
import { runWriterAgent } from '../agents/writerAgent.js';
import { getLibraryContext } from '../services/reqLibraryLoader.js';
import type { ScanJobPayload } from '../lib/queue.js';

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

export function startScanWorker(): void {
  const connection = parseRedisUrl(process.env.REDIS_URL ?? 'redis://localhost:6379');

  const worker = new Worker<ScanJobPayload>(
    'ui-scans',
    async (job) => {
      const payload = job.data;
      const { scanId, projectId, baseUrl, username, password, scanDepth, generateTCs, customInstructions } = payload;
      const io = getRunsNamespace();

      // 1. Mark scan as RUNNING
      await prisma.uIScan.update({
        where: { id: scanId },
        data: { status: 'RUNNING', startedAt: new Date() },
      });

      // Fetch project slug once — included in all outbound socket events so the
      // frontend can build a direct link without an extra API call.
      const projectMeta = await prisma.project.findUnique({
        where: { id: projectId },
        select: { slug: true, name: true },
      });
      const projectSlug = projectMeta?.slug ?? projectId;

      io?.emit('scan:started', { scanId, projectId, projectSlug });

      // 2. Run the Playwright crawler
      let pagesTotal = 0;
      const scanResult = await runUIScan({
        baseUrl,
        username,
        password,
        depth: scanDepth,
        customInstructions,
        onProgress: async (progress, currentPage, pagesScanned) => {
          await prisma.uIScan.update({
            where: { id: scanId },
            data: { progress, currentPage, pagesScanned },
          });
          io?.emit('scan:progress', { scanId, projectId, progress, currentPage, pagesScanned, pagesTotal });
        },
      });
      pagesTotal = scanResult.pages.length;

      // 3. Fetch requirement library context (used by both context agent and writer agent)
      const libraryContext = await getLibraryContext(projectId);

      // 4. Run the context AI agent (req library enriches use-case title suggestions)
      const contextResult = await runUIContextAgent(scanResult, customInstructions, libraryContext);

      // 5. Upsert ProjectContext
      const useCaseSummaryJson = JSON.stringify(
        contextResult.useCaseSuggestions.map((s) => ({
          name: s.useCase,
          color: s.color,
          pages: s.pages,
          tcCount: 0,
        })),
      );

      await prisma.projectContext.upsert({
        where: { projectId },
        create: {
          projectId,
          loginInstructions: JSON.stringify(contextResult.loginInstructions),
          navigationMap: JSON.stringify(contextResult.navigationMap),
          pageLocators: JSON.stringify(contextResult.pageLocators),
          useCaseSummary: useCaseSummaryJson,
          customInstructions: customInstructions ?? null,
          lastScanId: scanId,
        },
        update: {
          loginInstructions: JSON.stringify(contextResult.loginInstructions),
          navigationMap: JSON.stringify(contextResult.navigationMap),
          pageLocators: JSON.stringify(contextResult.pageLocators),
          useCaseSummary: useCaseSummaryJson,
          ...(customInstructions !== undefined && { customInstructions }),
          lastScanId: scanId,
        },
      });

      // 6. TC generation via Writer Agent (non-fatal — failure keeps scan COMPLETED)
      let tcCount = 0;
      if (generateTCs && contextResult.useCaseSuggestions.length > 0) {
        try {
          const project = projectMeta; // already fetched above
          const prefix = (project?.slug ?? 'PRJ').replace(/[^a-zA-Z0-9]/g, '').slice(0, 3).toUpperCase();
          const baseCount = await prisma.testCase.count({ where: { projectId } });

          // Fetch existing TC titles so the writer agent avoids generating duplicates
          const existingTCRows = await prisma.testCase.findMany({
            where: { projectId },
            select: { title: true },
          });
          const existingTestCaseTitles = existingTCRows.map((r) => r.title);

          // Give the writer agent the discovered navigation map as context
          const navLines = contextResult.navigationMap
            .slice(0, 30)
            .map((n) => `• ${n.label} → ${n.url}`)
            .join('\n');
          const projectContextSummary = navLines
            ? `Application navigation discovered by UI scanner:\n${navLines}`
            : undefined;

          const existingUseCaseTags = contextResult.useCaseSuggestions.map((s) => s.useCase);

          // Run writer agent per use case in parallel
          const allDraftTCs: Array<import('../agents/writerAgent.js').GeneratedTestCase & { sourceRef: string }> = [];
          const writerResults = await Promise.allSettled(
            contextResult.useCaseSuggestions.map(async (suggestion) => {
              const titles = Array.isArray(suggestion.testCaseTitles) ? suggestion.testCaseTitles : [];
              const targetCount = Math.min(8, Math.max(4, titles.length));
              const input = {
                type: 'text' as const,
                label: suggestion.useCase,
                content: [
                  `Use Case: ${suggestion.useCase}`,
                  `Pages covered: ${(Array.isArray(suggestion.pages) ? suggestion.pages : []).join(', ')}`,
                  '',
                  'Suggested test scenario titles (generate full test steps for each):',
                  ...titles.map((t: string) => `• ${t}`),
                ].join('\n'),
              };
              const result = await runWriterAgent({
                inputs: [input],
                projectLibraryContext: libraryContext,
                projectName: project?.name ?? projectId,
                testTypes: ['UI'],
                existingUseCaseTags,
                existingTestCaseTitles,
                projectContextSummary,
                targetTcCount: targetCount,
              });
              return result.testCases.map((tc) => ({ ...tc, sourceRef: `scan:${scanId}` }));
            }),
          );
          for (const r of writerResults) {
            if (r.status === 'fulfilled') allDraftTCs.push(...r.value);
            else console.error(`[scan-worker] Writer failed for a use case:`, r.reason?.message ?? r.reason);
          }

          if (allDraftTCs.length > 0) {
            const draftTCs = allDraftTCs;

            // Store as pending draft in ProjectContext — TCs appear in Test Writer for approval
            await prisma.projectContext.update({
              where: { projectId },
              data: { pendingTCDraft: JSON.stringify(draftTCs) },
            });
            tcCount = draftTCs.length;

            // Update useCaseSummary with per-use-case pending TC counts
            const tcsByUseCase = new Map<string, number>();
            for (const tc of draftTCs) {
              tcsByUseCase.set(tc.useCaseTag, (tcsByUseCase.get(tc.useCaseTag) ?? 0) + 1);
            }
            const updatedSummary = contextResult.useCaseSuggestions.map((s) => ({
              name: s.useCase,
              color: s.color,
              pages: Array.isArray(s.pages) ? s.pages : [],
              tcCount: tcsByUseCase.get(s.useCase) ?? 0,
            }));
            await prisma.projectContext.update({
              where: { projectId },
              data: { useCaseSummary: JSON.stringify(updatedSummary) },
            });
          }

          console.log(`[scan-worker] Writer agent drafted ${tcCount} test cases pending review across ${contextResult.useCaseSuggestions.length} use cases`);
        } catch (tcErr) {
          console.error(`[scan-worker] TC generation failed (scan will still complete):`, (tcErr as Error).message);
        }
      }

      // 7. Mark scan as COMPLETED
      const pagesScanned = scanResult.pages.length;
      await prisma.uIScan.update({
        where: { id: scanId },
        data: {
          status: 'COMPLETED',
          completedAt: new Date(),
          pagesTotal: pagesScanned,
          pagesScanned,
          progress: 100,
          rawPageData: JSON.stringify(scanResult.pages.map((p) => ({
            ...p,
            screenshotBase64: null, // omit screenshots from DB storage
          }))),
        },
      });

      io?.emit('scan:completed', {
        scanId,
        projectId,
        projectSlug,
        tcCount,
        useCaseCount: contextResult.useCaseSuggestions.length,
      });

      console.log(`[scan-worker] Scan ${scanId} completed — ${pagesScanned} pages, ${contextResult.useCaseSuggestions.length} use cases`);
    },
    { connection, concurrency: 1 },
  );

  worker.on('failed', async (job, err) => {
    const io = getRunsNamespace();
    console.error(`[scan-worker] Job ${job?.id} failed:`, err.message);

    if (job?.data.scanId) {
      try {
        await prisma.uIScan.update({
          where: { id: job.data.scanId },
          data: { status: 'FAILED', errorMessage: err.message, completedAt: new Date() },
        });
        const failedProject = await prisma.project.findUnique({ where: { id: job.data.projectId }, select: { slug: true } }).catch(() => null);
        io?.emit('scan:failed', { scanId: job.data.scanId, projectId: job.data.projectId, projectSlug: failedProject?.slug ?? job.data.projectId, error: err.message });
      } catch (updateErr) {
        console.error('[scan-worker] Failed to update scan status:', (updateErr as Error).message);
      }
    }
  });

  worker.on('completed', (job) => {
    console.log(`[scan-worker] Job ${job.id} completed (scanId: ${job.data.scanId})`);
  });

  console.log('[scan-worker] Worker started, listening on queue "ui-scans"');
}
