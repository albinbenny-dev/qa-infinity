import { Router, Request, Response, NextFunction, RequestHandler } from 'express';
import { z } from 'zod';
import * as XLSX from 'xlsx';
import { prisma } from '../lib/prisma.js';
import { verifyToken } from '../middleware/auth.js';
import { requireProjectAccess } from '../middleware/projectAccess.js';
import {
  generateReport,
  getProjectStats,
  getRunTrend,
  getAgentStatuses,
  getEmailConfig,
  saveEmailConfig,
} from '../services/reportService.js';

// ── Zod schemas ────────────────────────────────────────────────────────────

const EmailConfigSchema = z.object({
  recipients: z.array(z.string().email()),
  triggerEvents: z.array(z.enum(['on_failure', 'on_completion', 'on_schedule'])),
});

// ── Router setup ───────────────────────────────────────────────────────────

const router = Router({ mergeParams: true });
router.use(verifyToken as RequestHandler);
router.use(requireProjectAccess as unknown as RequestHandler);

// ── GET /dashboard ─────────────────────────────────────────────────────────

router.get('/dashboard', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const days = parseInt(req.query['days'] as string || '7', 10);
    const [stats, trend, recentRunsData, agentStatuses] = await Promise.all([
      getProjectStats(req.project.id),
      getRunTrend(req.project.id, days),
      prisma.run.findMany({
        where: { projectId: req.project.id },
        orderBy: { createdAt: 'desc' },
        take: 5,
        include: {
          results: { select: { status: true } },
          _count: { select: { results: true } },
        },
      }),
      getAgentStatuses(req.project.id),
    ]);
    res.json({ stats, trend, recentRuns: recentRunsData, agentStatuses });
  } catch (err) { next(err); }
});

// ── GET /runs ──────────────────────────────────────────────────────────────

router.get('/runs', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const page = Math.max(1, parseInt(req.query['page'] as string || '1', 10));
    const limit = Math.min(50, parseInt(req.query['limit'] as string || '20', 10));
    const skip = (page - 1) * limit;

    const [runs, total] = await Promise.all([
      prisma.run.findMany({
        where: { projectId: req.project.id },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
        include: {
          results: { select: { status: true } },
          _count: { select: { results: true } },
          report: { select: { id: true, summary: true, aiAnalysis: true } },
        },
      }),
      prisma.run.count({ where: { projectId: req.project.id } }),
    ]);

    res.json({ runs, total, page, limit, pages: Math.ceil(total / limit) });
  } catch (err) { next(err); }
});

// ── GET /runs/:runId ───────────────────────────────────────────────────────

router.get('/runs/:runId', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const run = await prisma.run.findFirst({
      where: { id: req.params['runId'], projectId: req.project.id },
      include: {
        results: {
          include: {
            testCase: { select: { id: true, tcId: true, title: true, type: true, useCaseTag: true } },
          },
          orderBy: { createdAt: 'asc' },
        },
        report: true,
      },
    });
    if (!run) { res.status(404).json({ error: 'Run not found' }); return; }

    // Auto-generate report if run is complete and no report yet
    if (
      (run.status === 'PASSED' || run.status === 'FAILED') &&
      !run.report
    ) {
      void generateReport(run.id).catch((err) =>
        console.error('[reports] Auto-generate report failed:', err),
      );
    }

    res.json({ run });
  } catch (err) { next(err); }
});

// ── POST /runs/:runId/generate ─────────────────────────────────────────────

router.post('/runs/:runId/generate', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const run = await prisma.run.findFirst({
      where: { id: req.params['runId'], projectId: req.project.id },
      select: { id: true, status: true },
    });
    if (!run) { res.status(404).json({ error: 'Run not found' }); return; }
    if (run.status === 'RUNNING' || run.status === 'PENDING') {
      res.status(400).json({ error: 'Cannot generate report for an in-progress run' });
      return;
    }
    await generateReport(run.id);
    const report = await prisma.report.findUnique({ where: { runId: run.id } });
    res.json({ report });
  } catch (err) { next(err); }
});

// ── GET /runs/:runId/export ────────────────────────────────────────────────

router.get('/runs/:runId/export', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const run = await prisma.run.findFirst({
      where: { id: req.params['runId'], projectId: req.project.id },
      include: {
        results: {
          include: {
            testCase: { select: { id: true, tcId: true, title: true, type: true, useCaseTag: true } },
          },
          orderBy: { createdAt: 'asc' },
        },
        report: true,
        project: { select: { name: true } },
      },
    });
    if (!run) { res.status(404).json({ error: 'Run not found' }); return; }

    type ExportResult = { status: string; duration: number | null; errorMessage: string | null; testCase: { tcId: string; title: string; type: string; useCaseTag: string | null } };
    const exportResults = run.results as ExportResult[];
    const passed = exportResults.filter((r) => r.status === 'PASSED').length;
    const failed = exportResults.filter((r) => r.status === 'FAILED').length;
    const total = exportResults.length;
    const passRate = total > 0 ? Math.round((passed / total) * 100) : 0;
    const duration =
      run.startedAt && run.completedAt
        ? Math.round(
            (new Date(run.completedAt).getTime() - new Date(run.startedAt).getTime()) / 1000,
          )
        : 0;

    // Sheet 1: Summary
    const summaryData = [
      ['QA Infinity — Run Report'],
      [],
      ['Project', run.project.name],
      ['Run Name', run.name],
      ['Environment', run.environment],
      ['Status', run.status],
      ['Trigger', run.triggerType],
      ['Started', run.startedAt?.toISOString() ?? ''],
      ['Completed', run.completedAt?.toISOString() ?? ''],
      ['Duration (s)', duration],
      [],
      ['Total Tests', total],
      ['Passed', passed],
      ['Failed', failed],
      ['Pass Rate', `${passRate}%`],
    ];

    if (run.report) {
      try {
        const analysis = JSON.parse(run.report.aiAnalysis) as {
          summary?: string;
          severity?: string;
          rootCauses?: string[];
          recommendations?: string[];
        };
        summaryData.push(
          [],
          ['AI Analysis'],
          ['Summary', analysis.summary ?? ''],
          ['Severity', analysis.severity ?? ''],
          [],
          ['Root Causes'],
          ...(analysis.rootCauses ?? []).map((c: string) => ['', c]),
          [],
          ['Recommendations'],
          ...(analysis.recommendations ?? []).map((r: string) => ['', r]),
        );
      } catch { /* ignore parse errors */ }
    }

    // Sheet 2: Test Results
    const resultHeaders = [
      'TC ID', 'Title', 'Use Case', 'Type', 'Status', 'Duration (ms)', 'Error Message',
    ];
    const resultRows = exportResults.map((r) => [
      r.testCase.tcId,
      r.testCase.title,
      r.testCase.useCaseTag ?? '',
      r.testCase.type,
      r.status,
      r.duration ?? '',
      r.errorMessage ?? '',
    ]);

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(summaryData), 'Summary');
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.aoa_to_sheet([resultHeaders, ...resultRows]),
      'Test Results',
    );

    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
    const filename = `run-report-${run.id.slice(0, 8)}.xlsx`;

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(buf);
  } catch (err) { next(err); }
});

// ── GET /email-config ──────────────────────────────────────────────────────

router.get('/email-config', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const config = await getEmailConfig(req.project.id);
    res.json({ config });
  } catch (err) { next(err); }
});

// ── PUT /email-config ──────────────────────────────────────────────────────

router.put('/email-config', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const parsed = EmailConfigSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Validation failed', issues: parsed.error.issues });
      return;
    }
    await saveEmailConfig(req.project.id, parsed.data);
    res.json({ config: parsed.data });
  } catch (err) { next(err); }
});

// ── GET /stats ─────────────────────────────────────────────────────────────

router.get('/stats', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const stats = await getProjectStats(req.project.id);
    res.json({ stats });
  } catch (err) { next(err); }
});

// ── GET /trend ─────────────────────────────────────────────────────────────

router.get('/trend', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const days = parseInt(req.query['days'] as string || '30', 10);
    const trend = await getRunTrend(req.project.id, days);
    res.json({ trend });
  } catch (err) { next(err); }
});

export default router;
