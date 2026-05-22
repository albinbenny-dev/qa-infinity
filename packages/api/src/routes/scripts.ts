import { Router, Request, Response, NextFunction, RequestHandler } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { verifyToken } from '../middleware/auth.js';
import { requireProjectAccess } from '../middleware/projectAccess.js';
import { runScriptAgent } from '../agents/scriptAgent.js';
import {
  saveScript,
  savePOM,
  readScript,
  deleteScript,
  listPOMFiles,
  getScriptFileMeta,
  exportZip,
} from '../services/scriptFileService.js';

const router = Router({ mergeParams: true });

router.use(verifyToken as RequestHandler);
router.use(requireProjectAccess as unknown as RequestHandler);

// ── Zod schemas ────────────────────────────────────────────────────────────

const GenerateSchema = z.object({
  testCaseIds: z.array(z.string().min(1)).min(1).max(50),
});

const SaveContentSchema = z.object({
  content: z.string(),
});

// ── Multer for .spec.ts uploads ────────────────────────────────────────────

const scriptUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024 }, // 2 MB
  fileFilter: (_req, file, cb) => {
    const ok =
      file.originalname.endsWith('.spec.ts') || file.originalname.endsWith('.spec.js');
    if (ok) cb(null, true);
    else cb(new Error('Only .spec.ts or .spec.js files are allowed'));
  },
});

// ── GET / — list scripts (DB + filesystem meta) ────────────────────────────

router.get('/', async (req: Request, res: Response) => {
  try {
    const projectId = req.project.id;

    const scripts = await prisma.script.findMany({
      where: { projectId },
      include: {
        testCase: { select: { id: true, tcId: true, title: true, useCaseTag: true } },
        runResults: {
          select: { status: true, createdAt: true },
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    const enriched = scripts.map((s: (typeof scripts)[number]) => {
      const meta = getScriptFileMeta(projectId, s.filename);
      return {
        id: s.id,
        projectId: s.projectId,
        testCaseId: s.testCaseId,
        filename: s.filename,
        isCustomUpload: s.isCustomUpload,
        createdAt: s.createdAt,
        updatedAt: s.updatedAt,
        testCase: s.testCase,
        lastRunStatus: s.runResults[0]?.status ?? null,
        size: meta?.size ?? null,
        modifiedAt: meta?.modifiedAt ?? null,
      };
    });

    res.json({ scripts: enriched });
  } catch (err) {
    console.error('[scripts] GET /', err);
    res.status(500).json({ error: 'Failed to list scripts' });
  }
});

// ── POST /generate — generate scripts for test cases ──────────────────────

router.post('/generate', async (req: Request, res: Response) => {
  try {
    const parsed = GenerateSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }

    const { testCaseIds } = parsed.data;
    const project = req.project;
    const existingPOMs = listPOMFiles(project.id);

    const created: object[] = [];
    const errors: { testCaseId: string; error: string }[] = [];

    for (const tcId of testCaseIds) {
      try {
        const tc = await prisma.testCase.findFirst({
          where: { id: tcId, projectId: project.id },
        });

        if (!tc) {
          errors.push({ testCaseId: tcId, error: 'Test case not found' });
          continue;
        }

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
          },
          project: { name: project.name, baseUrl: project.baseUrl },
          existingPOMs,
        });

        // Derive a safe filename: e.g. "TC-PROJ-001-checkout-flow.spec.ts"
        const slug = tc.title
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-+|-+$/g, '')
          .slice(0, 60);
        const filename = `${tc.tcId}-${slug}.spec.ts`;

        // Persist spec to filesystem
        saveScript(project.id, filename, result.specContent);

        // Persist POM if returned
        if (result.pomContent && result.pomFilename) {
          savePOM(project.id, result.pomFilename, result.pomContent);
          existingPOMs.push(result.pomFilename);
        }

        // Upsert Script record in DB
        const existing = await prisma.script.findFirst({
          where: { projectId: project.id, testCaseId: tc.id },
        });

        const script = existing
          ? await prisma.script.update({
              where: { id: existing.id },
              data: { filename, content: result.specContent, updatedAt: new Date() },
            })
          : await prisma.script.create({
              data: {
                projectId: project.id,
                testCaseId: tc.id,
                filename,
                content: result.specContent,
                isCustomUpload: false,
              },
            });

        created.push({
          id: script.id,
          filename: script.filename,
          testCaseId: tc.id,
          tcId: tc.tcId,
          title: tc.title,
        });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error(`[scripts] generate failed for ${tcId}:`, e);
        errors.push({ testCaseId: tcId, error: msg });
      }
    }

    res.status(200).json({ created, errors });
  } catch (err) {
    console.error('[scripts] POST /generate', err);
    res.status(500).json({ error: 'Script generation failed' });
  }
});

// ── GET /:id/content — return raw script content ───────────────────────────

router.get('/:id/content', async (req: Request, res: Response) => {
  try {
    const script = await prisma.script.findFirst({
      where: { id: req.params.id, projectId: req.project.id },
    });

    if (!script) {
      res.status(404).json({ error: 'Script not found' });
      return;
    }

    // Prefer filesystem (always fresh); fall back to DB content
    let content = script.content;
    try {
      content = readScript(req.project.id, script.filename);
    } catch {
      // file may not exist if volume was reset — fall back to DB
    }

    res.json({ content });
  } catch (err) {
    console.error('[scripts] GET /:id/content', err);
    res.status(500).json({ error: 'Failed to read script content' });
  }
});

// ── PUT /:id/content — save edited content ─────────────────────────────────

router.put('/:id/content', async (req: Request, res: Response) => {
  try {
    const parsed = SaveContentSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'content field is required' });
      return;
    }

    const script = await prisma.script.findFirst({
      where: { id: req.params.id, projectId: req.project.id },
    });

    if (!script) {
      res.status(404).json({ error: 'Script not found' });
      return;
    }

    const { content } = parsed.data;

    // Update DB and filesystem
    await prisma.script.update({
      where: { id: script.id },
      data: { content, updatedAt: new Date() },
    });
    saveScript(req.project.id, script.filename, content);

    res.json({ ok: true });
  } catch (err) {
    console.error('[scripts] PUT /:id/content', err);
    res.status(500).json({ error: 'Failed to save script content' });
  }
});

// ── DELETE /:id ────────────────────────────────────────────────────────────

router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const script = await prisma.script.findFirst({
      where: { id: req.params.id, projectId: req.project.id },
    });

    if (!script) {
      res.status(404).json({ error: 'Script not found' });
      return;
    }

    await prisma.script.delete({ where: { id: script.id } });
    deleteScript(req.project.id, script.filename);

    res.json({ ok: true });
  } catch (err) {
    console.error('[scripts] DELETE /:id', err);
    res.status(500).json({ error: 'Failed to delete script' });
  }
});

// ── POST /upload — upload a custom .spec.ts file ───────────────────────────

router.post(
  '/upload',
  (req: Request, res: Response, next: NextFunction) => {
    scriptUpload.single('file')(req, res, (err) => {
      if (err instanceof multer.MulterError) {
        res.status(400).json({ error: `Upload error: ${err.message}` });
        return;
      }
      if (err instanceof Error) {
        res.status(400).json({ error: err.message });
        return;
      }
      next();
    });
  },
  async (req: Request, res: Response) => {
    try {
      if (!req.file) {
        res.status(400).json({ error: 'No file uploaded. Use multipart/form-data with field "file"' });
        return;
      }

      const content = req.file.buffer.toString('utf-8');
      const filename = req.file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
      const projectId = req.project.id;

      saveScript(projectId, filename, content);

      const script = await prisma.script.create({
        data: {
          projectId,
          testCaseId: null,
          filename,
          content,
          isCustomUpload: true,
        },
      });

      res.status(201).json({
        id: script.id,
        filename: script.filename,
        isCustomUpload: true,
        createdAt: script.createdAt,
      });
    } catch (err) {
      console.error('[scripts] POST /upload', err);
      res.status(500).json({ error: 'Upload failed' });
    }
  },
);

// ── GET /export/zip ────────────────────────────────────────────────────────

router.get('/export/zip', async (req: Request, res: Response) => {
  try {
    const projectId = req.project.id;

    // Optional: filter by comma-separated IDs via query param
    let filenames: string[] | undefined;
    const idsParam = req.query.ids as string | undefined;
    if (idsParam) {
      const ids = idsParam.split(',').filter(Boolean);
      const scripts = await prisma.script.findMany({
        where: { id: { in: ids }, projectId },
        select: { filename: true },
      });
      filenames = scripts.map((s: { filename: string }) => s.filename);
    }

    const buffer = await exportZip(projectId, filenames);
    const name = `${req.project.slug ?? projectId}-scripts.zip`;

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${name}"`);
    res.send(buffer);
  } catch (err) {
    console.error('[scripts] GET /export/zip', err);
    res.status(500).json({ error: 'Export failed' });
  }
});

export default router;
