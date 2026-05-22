import { Router, Request, Response, NextFunction, RequestHandler } from 'express';
import path from 'path';
import * as xlsx from 'xlsx';
import { prisma } from '../lib/prisma.js';
import { verifyToken } from '../middleware/auth.js';
import { requireProjectAccess } from '../middleware/projectAccess.js';
import { getLibraryContext } from '../services/reqLibraryLoader.js';
import { runWriterAgent } from '../agents/writerAgent.js';
import {
  fetchJiraStory,
  fetchUrlContent,
  fetchUISnapshot,
  readUploadedFile,
  readReferenceTCs,
  type UISnapshot,
} from '../services/inputAdapters.js';
import { z } from 'zod';

function mimeFromPath(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  const map: Record<string, string> = {
    '.pdf': 'application/pdf',
    '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    '.xls': 'application/vnd.ms-excel',
    '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    '.doc': 'application/msword',
    '.txt': 'text/plain',
    '.md': 'text/markdown',
  };
  return map[ext] ?? 'text/plain';
}

const router = Router({ mergeParams: true });

router.use(verifyToken as RequestHandler);
router.use(requireProjectAccess as unknown as RequestHandler);

// ── Zod schemas ────────────────────────────────────────────────────────────

const GenerateInputSchema = z.object({
  inputs: z.array(
    z.object({
      type: z.string().min(1),
      content: z.string().min(1),
      label: z.string().min(1),
    }),
  ).min(1),
  testTypes: z.array(z.enum(['UI', 'API', 'SIT'])).min(1).default(['UI']),
  additionalContext: z.string().optional(),
});

const SaveTestCasesSchema = z.object({
  testCases: z.array(
    z.object({
      title: z.string().min(1),
      description: z.string().optional().default(''),
      steps: z.array(z.string()).min(1),
      expectedResult: z.string().min(1),
      type: z.enum(['UI', 'API', 'SIT']),
      tags: z.array(z.string()).default([]),
      useCaseTag: z.string().optional(),
      priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']).default('MEDIUM'),
      sourceRef: z.string().optional(),
      status: z.enum(['DRAFT', 'APPROVED', 'DEPRECATED']).optional().default('DRAFT'),
    }),
  ).min(1),
});

const UpdateTestCaseSchema = z.object({
  title: z.string().min(1).optional(),
  description: z.string().optional(),
  steps: z.array(z.string()).optional(),
  expectedResult: z.string().optional(),
  type: z.enum(['UI', 'API', 'SIT']).optional(),
  tags: z.array(z.string()).optional(),
  useCaseTag: z.string().optional().nullable(),
  priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']).optional(),
  status: z.enum(['DRAFT', 'APPROVED', 'DEPRECATED']).optional(),
  sourceRef: z.string().optional(),
});

const BulkApproveSchema = z.object({
  ids: z.array(z.string().cuid()).min(1),
});

const BulkUpdateUseCaseSchema = z.object({
  testCaseIds: z.array(z.string().cuid()).min(1),
  targetUseCaseTag: z.string().min(1).max(120),
});

const BulkDeleteSchema = z.object({
  ids: z.array(z.string().cuid()).min(1),
});

const BulkAddTagSchema = z.object({
  testCaseIds: z.array(z.string().cuid()).min(1),
  tag: z.string().min(1).max(80),
});

// ── Helpers ────────────────────────────────────────────────────────────────

function parseTCFields(tc: Record<string, unknown>) {
  return {
    ...tc,
    steps: JSON.parse((tc['steps'] as string) || '[]'),
    tags: JSON.parse((tc['tags'] as string) || '[]'),
  };
}

async function nextTcId(projectId: string, projectSlug: string): Promise<string> {
  const count = await prisma.testCase.count({ where: { projectId } });
  const prefix = projectSlug.replace(/[^a-zA-Z0-9]/g, '').slice(0, 3).toUpperCase();
  return `TC-${prefix}-${String(count + 1).padStart(3, '0')}`;
}

// ── POST /generate ─────────────────────────────────────────────────────────

router.post('/generate', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const parsed = GenerateInputSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Validation failed', issues: parsed.error.issues });
      return;
    }

    const { inputs, testTypes, additionalContext } = parsed.data;

    const uiSnapshots: UISnapshot[] = [];

    // Resolve each input through the appropriate adapter in parallel
    const resolvedInputs = await Promise.all(
      inputs.map(async (inp) => {
        try {
          let content = inp.content;
          switch (inp.type) {
            case 'jira':
              content = await fetchJiraStory(inp.content);
              break;
            case 'url':
              content = await fetchUrlContent(inp.content);
              break;
            case 'ui_url': {
              const snap = await fetchUISnapshot(inp.content);
              uiSnapshots.push(snap);
              content = [
                `[Live UI Screenshot: "${snap.pageTitle}" at ${inp.content}]`,
                '',
                'Interactive elements detected on screen:',
                snap.interactiveElements,
              ].join('\n');
              break;
            }
            case 'upload':
              content = await readUploadedFile(inp.content, mimeFromPath(inp.content));
              break;
            case 'reference_tc':
              content = await readReferenceTCs(req.project.id, [inp.content]);
              break;
            case 'prompt':
              // raw text — use as-is
              break;
          }
          return { ...inp, content };
        } catch {
          // Return raw content on adapter failure so the agent still runs
          return inp;
        }
      }),
    );

    const projectLibraryContext = await getLibraryContext(req.project.id);

    const result = await runWriterAgent({
      inputs: resolvedInputs,
      uiSnapshots,
      projectLibraryContext,
      projectName: req.project.name,
      testTypes,
      additionalContext,
    });

    res.json(result);
  } catch (err) {
    next(err);
  }
});

// ── GET /use-cases ─────────────────────────────────────────────────────────

router.get('/use-cases', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const raw = await prisma.testCase.findMany({
      where: { projectId: req.project.id, useCaseTag: { not: null } },
      select: { useCaseTag: true },
      distinct: ['useCaseTag'],
      orderBy: { useCaseTag: 'asc' },
    });

    const useCases = raw.map((r) => r.useCaseTag).filter(Boolean) as string[];
    res.json({ useCases });
  } catch (err) {
    next(err);
  }
});

// ── GET /export/excel ──────────────────────────────────────────────────────

router.get('/export/excel', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tcs = await prisma.testCase.findMany({
      where: { projectId: req.project.id },
      orderBy: [{ useCaseTag: 'asc' }, { tcId: 'asc' }],
    });

    const rows = tcs.map((tc) => ({
      'TC ID': tc.tcId,
      Title: tc.title,
      Description: tc.description ?? '',
      Steps: (JSON.parse(tc.steps || '[]') as string[]).join('\n'),
      'Expected Result': tc.expectedResult,
      Type: tc.type,
      'Use Case': tc.useCaseTag ?? '',
      Priority: tc.priority,
      Status: tc.status,
      Tags: (JSON.parse(tc.tags || '[]') as string[]).join(', '),
      'Source Ref': tc.sourceRef ?? '',
      'Created At': tc.createdAt.toISOString(),
    }));

    const ws = xlsx.utils.json_to_sheet(rows);
    const wb = xlsx.utils.book_new();
    xlsx.utils.book_append_sheet(wb, ws, 'Test Cases');

    const buf = xlsx.write(wb, { type: 'buffer', bookType: 'xlsx' });
    const filename = `${req.project.slug}-test-cases-${Date.now()}.xlsx`;

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(buf);
  } catch (err) {
    next(err);
  }
});

// ── POST /bulk-approve ─────────────────────────────────────────────────────

router.post('/bulk-approve', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const parsed = BulkApproveSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Validation failed', issues: parsed.error.issues });
      return;
    }

    const result = await prisma.testCase.updateMany({
      where: { id: { in: parsed.data.ids }, projectId: req.project.id },
      data: { status: 'APPROVED' },
    });

    res.json({ updated: result.count });
  } catch (err) {
    next(err);
  }
});

// ── GET /stats ─────────────────────────────────────────────────────────────

router.get('/stats', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const projectId = req.project.id;

    const [totalTCs, ucRaw, neverRunCount, runResultsRaw] = await Promise.all([
      prisma.testCase.count({ where: { projectId } }),
      prisma.testCase.findMany({
        where: { projectId, useCaseTag: { not: null } },
        select: { useCaseTag: true },
        distinct: ['useCaseTag'],
      }),
      prisma.testCase.count({ where: { projectId, runResults: { none: {} } } }),
      prisma.runResult.findMany({
        where: { testCase: { projectId } },
        select: { testCaseId: true, status: true },
        orderBy: { run: { createdAt: 'desc' } },
      }),
    ]);

    // First occurrence per testCaseId = most recent run result (ordered desc above)
    const latestByTc = new Map<string, string>();
    for (const rr of runResultsRaw) {
      if (!latestByTc.has(rr.testCaseId)) {
        latestByTc.set(rr.testCaseId, rr.status);
      }
    }

    let passedLast = 0;
    let failedLast = 0;
    for (const status of latestByTc.values()) {
      if (status === 'PASSED') passedLast++;
      else if (status === 'FAILED') failedLast++;
    }

    res.json({
      totalTCs,
      useCaseCount: ucRaw.length,
      passedLast,
      failedLast,
      neverRun: neverRunCount,
    });
  } catch (err) {
    next(err);
  }
});

// ── POST /bulk-update-usecase ──────────────────────────────────────────────

router.post('/bulk-update-usecase', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const parsed = BulkUpdateUseCaseSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Validation failed', issues: parsed.error.issues });
      return;
    }

    const result = await prisma.testCase.updateMany({
      where: { id: { in: parsed.data.testCaseIds }, projectId: req.project.id },
      data: { useCaseTag: parsed.data.targetUseCaseTag },
    });

    res.json({ updated: result.count });
  } catch (err) {
    next(err);
  }
});

// ── POST /bulk-delete ─────────────────────────────────────────────────────

router.post('/bulk-delete', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const parsed = BulkDeleteSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Validation failed', issues: parsed.error.issues });
      return;
    }

    const result = await prisma.testCase.deleteMany({
      where: { id: { in: parsed.data.ids }, projectId: req.project.id },
    });

    res.json({ deleted: result.count });
  } catch (err) {
    next(err);
  }
});

// ── POST /bulk-add-tag ────────────────────────────────────────────────────

router.post('/bulk-add-tag', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const parsed = BulkAddTagSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Validation failed', issues: parsed.error.issues });
      return;
    }

    const { testCaseIds, tag } = parsed.data;
    const tcs = await prisma.testCase.findMany({
      where: { id: { in: testCaseIds }, projectId: req.project.id },
      select: { id: true, tags: true },
    });

    await prisma.$transaction(
      tcs.map((tc) => {
        const tags = JSON.parse(tc.tags || '[]') as string[];
        if (!tags.includes(tag)) tags.push(tag);
        return prisma.testCase.update({ where: { id: tc.id }, data: { tags: JSON.stringify(tags) } });
      }),
    );

    res.json({ updated: tcs.length });
  } catch (err) {
    next(err);
  }
});

// ── GET / ─────────────────────────────────────────────────────────────────

router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { type, status, useCaseTag, search, page = '1', limit = '50' } = req.query as Record<string, string>;

    const pageNum = Math.max(1, parseInt(page, 10));
    const limitNum = Math.min(200, Math.max(1, parseInt(limit, 10)));
    const skip = (pageNum - 1) * limitNum;

    const where = {
      projectId: req.project.id,
      ...(type && { type }),
      ...(status && { status }),
      ...(useCaseTag && { useCaseTag }),
      ...(search && {
        title: { contains: search },
      }),
    };

    const [testCases, total] = await Promise.all([
      prisma.testCase.findMany({
        where,
        orderBy: [{ useCaseTag: 'asc' }, { createdAt: 'desc' }],
        skip,
        take: limitNum,
      }),
      prisma.testCase.count({ where }),
    ]);

    res.json({
      testCases: testCases.map(parseTCFields),
      total,
      page: pageNum,
      limit: limitNum,
      pages: Math.ceil(total / limitNum),
    });
  } catch (err) {
    next(err);
  }
});

// ── POST / — save batch ────────────────────────────────────────────────────

router.post('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const parsed = SaveTestCasesSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Validation failed', issues: parsed.error.issues });
      return;
    }

    const slug = req.project.slug;
    const baseCount = await prisma.testCase.count({ where: { projectId: req.project.id } });
    const prefix = slug.replace(/[^a-zA-Z0-9]/g, '').slice(0, 3).toUpperCase();

    const created = await prisma.$transaction(
      parsed.data.testCases.map((tc, i) =>
        prisma.testCase.create({
          data: {
            projectId: req.project.id,
            tcId: `TC-${prefix}-${String(baseCount + i + 1).padStart(3, '0')}`,
            title: tc.title,
            description: tc.description,
            steps: JSON.stringify(tc.steps),
            expectedResult: tc.expectedResult,
            type: tc.type,
            tags: JSON.stringify(tc.tags),
            useCaseTag: tc.useCaseTag,
            priority: tc.priority,
            status: tc.status,
            sourceRef: tc.sourceRef,
          },
        }),
      ),
    );

    res.status(201).json({ testCases: created.map(parseTCFields), count: created.length });
  } catch (err) {
    next(err);
  }
});

// ── GET /:tcId ─────────────────────────────────────────────────────────────

router.get('/:tcId', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tc = await prisma.testCase.findFirst({
      where: { tcId: req.params['tcId'], projectId: req.project.id },
    });

    if (!tc) {
      res.status(404).json({ error: 'Test case not found' });
      return;
    }

    res.json({ testCase: parseTCFields(tc as unknown as Record<string, unknown>) });
  } catch (err) {
    next(err);
  }
});

// ── PUT /:tcId ─────────────────────────────────────────────────────────────

router.put('/:tcId', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const parsed = UpdateTestCaseSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Validation failed', issues: parsed.error.issues });
      return;
    }

    const existing = await prisma.testCase.findFirst({
      where: { tcId: req.params['tcId'], projectId: req.project.id },
    });
    if (!existing) {
      res.status(404).json({ error: 'Test case not found' });
      return;
    }

    const { steps, tags, ...rest } = parsed.data;

    const updated = await prisma.testCase.update({
      where: { id: existing.id },
      data: {
        ...rest,
        ...(steps !== undefined && { steps: JSON.stringify(steps) }),
        ...(tags !== undefined && { tags: JSON.stringify(tags) }),
      },
    });

    res.json({ testCase: parseTCFields(updated as unknown as Record<string, unknown>) });
  } catch (err) {
    next(err);
  }
});

// ── DELETE /:tcId ──────────────────────────────────────────────────────────

router.delete('/:tcId', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const existing = await prisma.testCase.findFirst({
      where: { tcId: req.params['tcId'], projectId: req.project.id },
    });
    if (!existing) {
      res.status(404).json({ error: 'Test case not found' });
      return;
    }

    await prisma.testCase.delete({ where: { id: existing.id } });
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

export default router;
