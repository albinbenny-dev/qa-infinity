import { Router, Request, Response, NextFunction, RequestHandler } from 'express';
import multer from 'multer';
import { z } from 'zod';
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore — @langchain/core types are resolved inside Docker; ignore locally
import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import { prisma } from '../lib/prisma.js';
import { verifyToken } from '../middleware/auth.js';
import { requireProjectAccess } from '../middleware/projectAccess.js';
import { addScriptGenJob } from '../lib/queue.js';
import { createLLM } from '../lib/llm.js';
import {
  saveScript,
  readScript,
  deleteScript,
  getScriptFileMeta,
  exportZip,
} from '../services/scriptFileService.js';
import { PROMPT_GUIDE_CONTENT } from '../lib/promptGuide.js';
import { generateContextGuide } from '../lib/contextGuide.js';

const router = Router({ mergeParams: true });

router.use(verifyToken as RequestHandler);
router.use(requireProjectAccess as unknown as RequestHandler);

// ── Zod schemas ────────────────────────────────────────────────────────────

const GenerateSchema = z.object({
  testCaseIds: z.array(z.string().min(1)).min(1).max(50),
  withHeal: z.boolean().optional().default(false),
  contextNote: z.string().max(4000).optional(),
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
        isGolden: s.isGolden,
        verificationStatus: s.verificationStatus,
        suspectedIssue: s.suspectedIssue,
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

// ── POST /generate — enqueue script-generation jobs ───────────────────────

router.post('/generate', async (req: Request, res: Response) => {
  try {
    const parsed = GenerateSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }

    const { testCaseIds, withHeal, contextNote } = parsed.data;
    const projectId = req.project.id;

    const tcs = await prisma.testCase.findMany({
      where: { id: { in: testCaseIds }, projectId },
      select: { id: true, tcId: true, title: true, type: true, useCaseTag: true },
    });
    const tcMap = new Map(tcs.map((t) => [t.id, t]));

    const queued: object[] = [];
    const errors: { testCaseId: string; error: string }[] = [];

    for (const tcId of testCaseIds) {
      const tc = tcMap.get(tcId);
      if (!tc) {
        errors.push({ testCaseId: tcId, error: 'Test case not found' });
        continue;
      }

      const scriptJob = await prisma.scriptJob.create({
        data: {
          projectId,
          testCaseId: tc.id,
          phase: 'QUEUED',
          withHeal,
          maxHealAttempts: 2,
          createdBy: req.user.id,
        },
      });

      await addScriptGenJob({
        scriptJobId: scriptJob.id,
        projectId,
        testCaseId: tc.id,
        withHeal,
        contextNote: contextNote || undefined,
      });

      queued.push({
        scriptJobId: scriptJob.id,
        testCaseId: tc.id,
        tcId: tc.tcId,
        title: tc.title,
        type: tc.type,
        useCaseTag: tc.useCaseTag,
        withHeal,
        phase: 'QUEUED',
      });
    }

    res.status(202).json({ queued, errors, withHeal });
  } catch (err) {
    console.error('[scripts] POST /generate', err);
    res.status(500).json({ error: 'Failed to enqueue script-generation jobs' });
  }
});

// ── GET /jobs — list recent / active script-generation jobs ───────────────

router.get('/jobs', async (req: Request, res: Response) => {
  try {
    const projectId = req.project.id;
    const activeOnly = req.query.active === '1';

    const where = activeOnly
      ? {
          projectId,
          createdBy: req.user.id,
          phase: { in: ['QUEUED', 'GENERATING', 'GENERATED', 'QUEUED_VERIFY', 'VERIFYING', 'HEALING'] },
        }
      : { projectId, createdBy: req.user.id };

    const jobs = await prisma.scriptJob.findMany({
      where,
      include: {
        script: { select: { id: true, filename: true, verificationStatus: true, suspectedIssue: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });

    // Attach the testCase tcId/title so the UI can render without an extra fetch
    const tcs = await prisma.testCase.findMany({
      where: { id: { in: jobs.map((j) => j.testCaseId) } },
      select: { id: true, tcId: true, title: true, type: true, useCaseTag: true },
    });
    const tcMap = new Map(tcs.map((t) => [t.id, t]));
    const enriched = jobs.map((j) => ({ ...j, testCase: tcMap.get(j.testCaseId) ?? null }));

    res.json({ jobs: enriched });
  } catch (err) {
    console.error('[scripts] GET /jobs', err);
    res.status(500).json({ error: 'Failed to list script jobs' });
  }
});

// ── DELETE /jobs/finished — dismiss completed/failed jobs ─────────────────

router.delete('/jobs/finished', async (req: Request, res: Response) => {
  try {
    const projectId = req.project.id;
    await prisma.scriptJob.deleteMany({
      where: {
        projectId,
        createdBy: req.user.id,
        phase: { in: ['VERIFIED', 'GENERATED', 'MANUAL_REVIEW', 'FAILED'] },
      },
    });
    res.json({ ok: true });
  } catch (err) {
    console.error('[scripts] DELETE /jobs/finished', err);
    res.status(500).json({ error: 'Failed to dismiss jobs' });
  }
});

// ── DELETE /jobs/all — force-clear all jobs (including stuck active ones) ──

router.delete('/jobs/all', async (req: Request, res: Response) => {
  try {
    const projectId = req.project.id;
    await prisma.scriptJob.deleteMany({ where: { projectId, createdBy: req.user.id } });
    res.json({ ok: true });
  } catch (err) {
    console.error('[scripts] DELETE /jobs/all', err);
    res.status(500).json({ error: 'Failed to clear jobs' });
  }
});

// ── POST /jobs/:jobId/retry — re-queue a failed/review job with new context ─

router.post('/jobs/:jobId/retry', async (req: Request, res: Response) => {
  try {
    const projectId = req.project.id;
    const { contextNote, withHeal, saveHints } = req.body as {
      contextNote?: string;
      withHeal?: boolean;
      saveHints?: boolean;
    };

    const existingJob = await prisma.scriptJob.findFirst({
      where: { id: req.params.jobId, projectId, createdBy: req.user.id },
    });
    if (!existingJob) {
      res.status(404).json({ error: 'Script job not found' });
      return;
    }
    if (!['FAILED', 'MANUAL_REVIEW', 'GENERATED', 'VERIFIED'].includes(existingJob.phase)) {
      res.status(422).json({ error: `Job phase "${existingJob.phase}" is not retryable` });
      return;
    }

    const tc = await prisma.testCase.findFirst({
      where: { id: existingJob.testCaseId, projectId },
      select: { id: true, tcId: true, title: true, type: true, useCaseTag: true },
    });
    if (!tc) {
      res.status(404).json({ error: 'Test case not found' });
      return;
    }

    // Persist hints to TestCase if requested
    if (saveHints && contextNote?.trim()) {
      await prisma.testCase.update({
        where: { id: tc.id },
        data: { generationHints: contextNote.trim() },
      });
    }

    const useHeal = withHeal ?? existingJob.withHeal;
    const newJob = await prisma.scriptJob.create({
      data: {
        projectId,
        testCaseId: tc.id,
        phase: 'QUEUED',
        withHeal: useHeal,
        maxHealAttempts: existingJob.maxHealAttempts,
        createdBy: req.user.id,
      },
    });

    await addScriptGenJob({
      scriptJobId: newJob.id,
      projectId,
      testCaseId: tc.id,
      withHeal: useHeal,
      contextNote: contextNote || undefined,
    });

    res.status(202).json({
      scriptJobId: newJob.id,
      testCaseId: tc.id,
      tcId: tc.tcId,
      title: tc.title,
      type: tc.type,
      useCaseTag: tc.useCaseTag,
      withHeal: useHeal,
      phase: 'QUEUED',
    });
  } catch (err) {
    console.error('[scripts] POST /jobs/:jobId/retry', err);
    res.status(500).json({ error: 'Failed to retry job' });
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

// ── PATCH /:id/golden — toggle the isGolden flag ──────────────────────────

router.patch('/:id/golden', async (req: Request, res: Response) => {
  try {
    const script = await prisma.script.findFirst({
      where: { id: req.params.id, projectId: req.project.id },
    });
    if (!script) {
      res.status(404).json({ error: 'Script not found' });
      return;
    }
    const updated = await prisma.script.update({
      where: { id: script.id },
      data: { isGolden: !script.isGolden },
    });
    res.json({ id: updated.id, isGolden: updated.isGolden });
  } catch (err) {
    console.error('[scripts] PATCH /:id/golden', err);
    res.status(500).json({ error: 'Failed to update golden status' });
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

    // Clear heal history so exhaust state doesn't bleed into a replacement script
    const linkedResultIds = await prisma.runResult.findMany({
      where: { scriptId: script.id },
      select: { id: true },
    });
    if (linkedResultIds.length > 0) {
      await prisma.heal.deleteMany({
        where: { runResultId: { in: linkedResultIds.map((r) => r.id) } },
      });
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
      const projectId = req.project.id;
      const testCaseId = (req.body?.testCaseId as string | undefined) || null;

      let filename = req.file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');

      if (testCaseId) {
        const tc = await prisma.testCase.findFirst({ where: { id: testCaseId, projectId } });
        if (!tc) {
          res.status(400).json({ error: 'Test case not found in this project' });
          return;
        }
        // Rename to system-default convention for traceability
        filename = buildSystemFilename(tc.tcId, tc.title, req.file.originalname);
        // Replace any existing script for this test case
        const existing = await prisma.script.findFirst({ where: { projectId, testCaseId } });
        if (existing) {
          await prisma.script.delete({ where: { id: existing.id } });
          deleteScript(projectId, existing.filename);
        }
      }

      saveScript(projectId, filename, content);

      const script = await prisma.script.create({
        data: {
          projectId,
          testCaseId,
          filename,
          content,
          isCustomUpload: true,
        },
      });

      res.status(201).json({
        id: script.id,
        filename: script.filename,
        testCaseId: script.testCaseId,
        isCustomUpload: true,
        createdAt: script.createdAt,
      });
    } catch (err) {
      console.error('[scripts] POST /upload', err);
      res.status(500).json({ error: 'Upload failed' });
    }
  },
);

// ── GET /prompt-guide — static generic LLM prompt guide (kept for compat) ────

router.get('/prompt-guide', (_req: Request, res: Response) => {
  res.setHeader('Content-Disposition', 'attachment; filename="qa-infinity-script-prompt-guide.md"');
  res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
  res.send(PROMPT_GUIDE_CONTENT);
});

// ── GET /context-guide — project-specific dynamic guide ───────────────────

router.get('/context-guide', async (req: Request, res: Response) => {
  try {
    const project = req.project;
    const content = await generateContextGuide(
      project.id,
      project.name,
      project.baseUrl ?? 'http://localhost:3000',
    );
    const safeName = (project.slug ?? project.id).replace(/[^a-zA-Z0-9-]/g, '-');
    res.setHeader('Content-Disposition', `attachment; filename="qa-infinity-guide-${safeName}.md"`);
    res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
    res.send(content);
  } catch (err) {
    console.error('[scripts] GET /context-guide', err);
    res.status(500).json({ error: 'Failed to generate context guide' });
  }
});

// ── POST /upload-with-extract — upload script + auto-create TC from it ────

function buildSystemFilename(tcId: string, title: string, originalname: string): string {
  const ext = originalname.toLowerCase().endsWith('.spec.js') ? '.spec.js' : '.spec.ts';
  const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
  return `${tcId}-${slug}${ext}`;
}

async function nextTcId(projectId: string, projectSlug: string): Promise<string> {
  const count = await prisma.testCase.count({ where: { projectId } });
  const prefix = projectSlug.replace(/[^a-zA-Z0-9]/g, '').slice(0, 3).toUpperCase();
  return `TC-${prefix}-${String(count + 1).padStart(3, '0')}`;
}

async function extractTCFromScript(scriptContent: string, projectId: string, projectName?: string): Promise<{
  title: string;
  description: string;
  steps: string[];
  expectedResult: string;
  type: 'UI' | 'API' | 'SIT';
  useCaseTag: string | null;
}> {
  const llm = createLLM({ temperature: 0, agentName: 'script-extract', projectId, projectName });
  const capped = scriptContent.slice(0, 8000);

  const response = await llm.invoke([
    new SystemMessage(
      `You are a QA engineer. Extract test case details from a Playwright TypeScript test script.
Output ONLY a JSON object — no markdown fences, no explanation:
{
  "title": "concise test case title (from describe/test name, 5-10 words)",
  "description": "one sentence describing what is tested",
  "steps": ["user action in plain English", "..."],
  "expectedResult": "what the final assertions verify, in plain English",
  "type": "UI",
  "useCaseTag": null
}
Rules:
- steps: translate code into human-readable user actions, not TypeScript syntax
- type: "UI" for browser tests, "API" for pure API, "SIT" for system integration
- useCaseTag: functional area if clear (e.g. "Login", "Primary Sales", "Dashboard"), otherwise null`,
    ),
    new HumanMessage(`Script:\n\`\`\`typescript\n${capped}\n\`\`\``),
  ]);

  const raw = typeof response.content === 'string' ? response.content : JSON.stringify(response.content);
  const cleaned = raw.replace(/^```(?:json)?\s*/im, '').replace(/```\s*$/im, '').trim();

  try {
    const parsed = JSON.parse(cleaned);
    return {
      title: String(parsed.title || 'Imported Test Case').slice(0, 200),
      description: String(parsed.description || '').slice(0, 500),
      steps: Array.isArray(parsed.steps) ? parsed.steps.map(String).filter(Boolean) : [],
      expectedResult: String(parsed.expectedResult || 'Script executes without errors').slice(0, 1000),
      type: (['UI', 'API', 'SIT'] as const).includes(parsed.type) ? parsed.type : 'UI',
      useCaseTag: parsed.useCaseTag ? String(parsed.useCaseTag).slice(0, 120) : null,
    };
  } catch {
    // Fallback: derive title from filename if LLM output is unparseable
    return {
      title: 'Imported Test Case',
      description: 'Imported from external script',
      steps: ['Execute the imported Playwright script'],
      expectedResult: 'Script executes without errors',
      type: 'UI',
      useCaseTag: null,
    };
  }
}

router.post(
  '/upload-with-extract',
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

      const projectId = req.project.id;
      const content = req.file.buffer.toString('utf-8');

      // Extract TC details from script via LLM
      const extracted = await extractTCFromScript(content, projectId, req.project.name);

      // Generate a unique tcId
      const tcId = await nextTcId(projectId, req.project.slug ?? projectId);

      // Rename to system-default convention using extracted TC info
      const filename = buildSystemFilename(tcId, extracted.title, req.file.originalname);

      // Create the test case in DRAFT status
      const testCase = await prisma.testCase.create({
        data: {
          projectId,
          tcId,
          title: extracted.title,
          description: extracted.description,
          steps: JSON.stringify(extracted.steps),
          expectedResult: extracted.expectedResult,
          type: extracted.type,
          tags: '[]',
          useCaseTag: extracted.useCaseTag,
          status: 'DRAFT',
          priority: 'MEDIUM',
          sourceRef: `Imported from ${req.file.originalname}`,
        },
      });

      // Save script file and link to the created TC
      saveScript(projectId, filename, content);

      const script = await prisma.script.create({
        data: {
          projectId,
          testCaseId: testCase.id,
          filename,
          content,
          isCustomUpload: true,
        },
      });

      res.status(201).json({ testCase, script });
    } catch (err) {
      console.error('[scripts] POST /upload-with-extract', err);
      res.status(500).json({ error: 'Upload and extraction failed' });
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
