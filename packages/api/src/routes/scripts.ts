import { Router, Request, Response, NextFunction, RequestHandler } from 'express';
import multer from 'multer';
import fs from 'fs';
import path from 'path';
import { z } from 'zod';
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore — @langchain/core types are resolved inside Docker; ignore locally
import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import { prisma } from '../lib/prisma.js';
import { verifyToken } from '../middleware/auth.js';
import { requireProjectAccess } from '../middleware/projectAccess.js';
import { addScriptGenJob, scriptGenQueue } from '../lib/queue.js';
import { createLLM } from '../lib/llm.js';
import {
  saveScript,
  readScript,
  deleteScript,
  getScriptFileMeta,
  exportZip,
  listScriptFiles,
  rewriteRobotResourcePaths,
  saveSkillFile,
  importFromDisk,
  buildFileTree,
  importFromZip,
  exportFolderZip,
  getProjectFileContent,
  deleteProjectFile,
  searchProjectFiles,
  BINARY_EXTS,
  projectRoot,
  extractRobotTags,
} from '../services/scriptFileService.js';
import { PROMPT_GUIDE_CONTENT } from '../lib/promptGuide.js';
import { generateContextGuide } from '../lib/contextGuide.js';
import { convertCodegenToRobot } from '../agents/codegenConverterAgent.js';

const router = Router({ mergeParams: true });

router.use(verifyToken as RequestHandler);
router.use(requireProjectAccess as unknown as RequestHandler);

// ── Zod schemas ────────────────────────────────────────────────────────────

const GenerateSchema = z.object({
  testCaseIds: z.array(z.string().min(1)).min(1).max(50),
  withHeal: z.boolean().optional().default(false),
  contextNote: z.string().max(12000).optional(),
  domSnippet: z.string().max(8000).optional(),
  domRecording: z.string().max(80000).optional(),
  failedStep: z.string().max(500).optional(),
  failedStepError: z.string().max(2000).optional(),
  scriptMode: z.enum(['PLAYWRIGHT', 'ROBOT']).optional().default('ROBOT'),
  referenceTcIds: z.array(z.string()).max(5).optional(),
});

const SaveContentSchema = z.object({
  content: z.string(),
});

// ── Multer for script uploads ──────────────────────────────────────────────

const scriptUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024 }, // 2 MB
  fileFilter: (_req, file, cb) => {
    const ok =
      file.originalname.endsWith('.spec.ts') ||
      file.originalname.endsWith('.spec.js') ||
      file.originalname.endsWith('.robot');
    if (ok) cb(null, true);
    else cb(new Error('Only .spec.ts, .spec.js, or .robot files are allowed'));
  },
});

const robotUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (file.originalname.endsWith('.robot')) cb(null, true);
    else cb(new Error('Only .robot files are allowed'));
  },
});

// Project Files uploads — any file type (xlsx, yaml, images, ...), no extension
// filter. Matches the same "anything goes" precedent already set by the zip
// folder import, just for one file at a time into an arbitrary folder.
const projectFileUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 100 * 1024 * 1024 }, // 100 MB
});

// Large project-folder imports (500MB+) stream straight to disk instead of
// buffering the whole archive in the process's memory during upload.
const ZIP_UPLOAD_TMP = process.env.UPLOAD_TMP ?? '/tmp/uploads';

const zipUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => {
      try {
        fs.mkdirSync(ZIP_UPLOAD_TMP, { recursive: true });
        cb(null, ZIP_UPLOAD_TMP);
      } catch (err) {
        cb(err as Error, ZIP_UPLOAD_TMP);
      }
    },
    filename: (_req, file, cb) => {
      const safe = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
      cb(null, `${Date.now()}-${safe}`);
    },
  }),
  limits: { fileSize: 2 * 1024 * 1024 * 1024 }, // 2 GB
  fileFilter: (_req, file, cb) => {
    if (file.originalname.endsWith('.zip')) cb(null, true);
    else cb(new Error('Only .zip files are allowed'));
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
      const meta = getScriptFileMeta(req.project.slug, s.filename);
      return {
        id: s.id,
        projectId: s.projectId,
        testCaseId: s.testCaseId,
        filename: s.filename,
        scriptType: (s as any).scriptType ?? 'PLAYWRIGHT',
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

    const { testCaseIds, withHeal, contextNote, domSnippet, domRecording, failedStep, failedStepError, scriptMode, referenceTcIds } = parsed.data;
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
        domSnippet: domSnippet || undefined,
        domRecording: domRecording || undefined,
        failedStep: failedStep || undefined,
        failedStepError: failedStepError || undefined,
        referenceTcIds: referenceTcIds?.length ? referenceTcIds : undefined,
        scriptMode,
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
    const jobs = await prisma.scriptJob.findMany({
      where: { projectId, createdBy: req.user.id },
      select: { id: true },
    });
    await prisma.scriptJob.deleteMany({ where: { projectId, createdBy: req.user.id } });
    // Also remove queued/waiting BullMQ jobs so the worker doesn't pick them up after DB delete
    await Promise.allSettled(jobs.map((j) => scriptGenQueue.remove(j.id)));
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
    const { contextNote, withHeal, saveHints, qaFeedback, saveAsHistoricalSkill, featureGroup } = req.body as {
      contextNote?: string;
      withHeal?: boolean;
      saveHints?: boolean;
      qaFeedback?: string;
      saveAsHistoricalSkill?: boolean;
      featureGroup?: string;
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

    // Save QA feedback as a Tier 3 Historical skill if requested
    if (saveAsHistoricalSkill && qaFeedback?.trim()) {
      const skillName = `${featureGroup ?? tc.useCaseTag ?? 'General'} — QA Correction`;
      const historicalContent = JSON.stringify({
        issue: qaFeedback.trim(),
        correction: qaFeedback.trim(),
        tcId: tc.tcId,
        tcTitle: tc.title,
        source: 'manual_qa_feedback',
      });
      const skill = await prisma.projectSkill.create({
        data: {
          projectId,
          skillType: 'HISTORICAL',
          name: skillName,
          featureGroup: featureGroup ?? tc.useCaseTag ?? null,
          tier: 'HISTORICAL',
          content: historicalContent,
          humanContext: qaFeedback.trim(),
          captureMethod: 'MANUAL_QA_FEEDBACK',
          confidence: 0.9,
        },
      });
      saveSkillFile(req.project.slug, skill.id, {
        id: skill.id, skillType: skill.skillType, name: skill.name,
        scope: null, featureGroup: skill.featureGroup, tier: skill.tier,
        humanContext: skill.humanContext, content: skill.content,
        confidence: skill.confidence, captureMethod: skill.captureMethod,
        isActive: skill.isActive, updatedAt: skill.updatedAt.toISOString(),
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
      qaFeedback: qaFeedback || undefined,
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

// ── GET /project-file/content — read any project text file for viewing/editing ─
// Used by "Find in Files" search results and the file tree to open a file in
// the editor instead of downloading it. Binary formats (xlsx, images, etc.)
// are rejected — the frontend falls back to a plain download for those.
// NOTE: must be registered before /:id/content — otherwise Express matches
// that generic route first (":id" = "project-file") and this never runs.

router.get('/project-file/content', async (req: Request, res: Response) => {
  try {
    const relPath = req.query.path as string;
    if (!relPath) { res.status(400).json({ error: 'path query param required' }); return; }
    const ext = path.extname(relPath).toLowerCase();
    if (BINARY_EXTS.has(ext)) {
      res.status(415).json({ error: 'Binary file — use the download button instead.' });
      return;
    }
    const { buffer } = getProjectFileContent(req.project.slug, relPath);
    res.json({ content: buffer.toString('utf-8') });
  } catch (err: any) {
    res.status(err?.message === 'Invalid path' ? 400 : 404).json({ error: err?.message ?? 'File not found' });
  }
});

// ── PUT /project-file/content — save edited content back to a project file ────
// Same ordering note as above — must precede /:id/content.

router.put('/project-file/content', async (req: Request, res: Response) => {
  try {
    const relPath = req.query.path as string;
    const { content } = req.body as { content?: string };
    if (!relPath) { res.status(400).json({ error: 'path query param required' }); return; }
    if (typeof content !== 'string') { res.status(400).json({ error: 'content is required' }); return; }
    saveScript(req.project.slug, relPath, content);
    res.json({ ok: true });
  } catch (err: any) {
    console.error('[scripts] PUT /project-file/content', err);
    res.status(500).json({ error: err?.message ?? 'Save failed' });
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
      content = readScript(req.project.slug, script.filename);
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
    saveScript(req.project.slug, script.filename, content, (script as any).useCaseFolder);

    // Auto-link TCs whose tcId matches [Tags] in this script (non-blocking)
    void autoLinkScriptByTags(req.project.id, script.id, content);

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

// ── DELETE /project-file — delete a file or folder by relative path ────────────
// Must be registered BEFORE DELETE /:id to prevent Express matching 'project-file' as :id

router.delete('/project-file', async (req: Request, res: Response) => {
  try {
    const relPath = req.query.path as string;
    if (!relPath) { res.status(400).json({ error: 'path query param required' }); return; }

    const { id: projectId } = req.project;
    const isDir = !relPath.includes('.') || relPath.endsWith('/');

    if (isDir) {
      // Deleting a folder — remove all scripts whose useCaseFolder matches or whose
      // relPath starts with this prefix
      const folderName = relPath.replace(/\/$/, '').split('/').pop() ?? '';
      const scripts = await prisma.script.findMany({
        where: { projectId, useCaseFolder: folderName },
        select: { id: true },
      });
      if (scripts.length) {
        await prisma.script.deleteMany({ where: { id: { in: scripts.map(s => s.id) } } });
      }
    } else {
      const filename = relPath.split('/').pop() ?? relPath;
      const script = await prisma.script.findFirst({ where: { projectId, filename } });
      if (script) await prisma.script.delete({ where: { id: script.id } });
    }

    deleteProjectFile(req.project.slug, relPath);
    res.json({ ok: true });
  } catch (err: any) {
    console.error('[scripts] DELETE /project-file', err);
    res.status(500).json({ error: err.message ?? 'Delete failed' });
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
    deleteScript(req.project.slug, script.filename);

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

      const projectId = req.project.id;
      const slug = req.project.slug;
      const testCaseId = (req.body?.testCaseId as string | undefined) || null;
      const isRobotFile = req.file.originalname.toLowerCase().endsWith('.robot');

      // Convert SeleniumLibrary → Browser for robot files
      let rawContent = req.file.buffer.toString('utf-8');
      let converted = false;
      if (isRobotFile) {
        const result = await convertRobotIfNeeded(rawContent, projectId);
        rawContent = result.content;
        converted = result.converted;
      }

      let filename = req.file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
      let useCaseTag: string | null = null;

      if (testCaseId) {
        const tc = await prisma.testCase.findFirst({ where: { id: testCaseId, projectId } });
        if (!tc) {
          res.status(400).json({ error: 'Test case not found in this project' });
          return;
        }
        useCaseTag = tc.useCaseTag ?? null;
        filename = buildSystemFilename(tc.tcId, tc.title, req.file.originalname);
        const existing = await prisma.script.findFirst({ where: { projectId, testCaseId } });
        if (existing) {
          await prisma.script.delete({ where: { id: existing.id } });
          deleteScript(slug, existing.filename);
        }
      }

      saveScript(slug, filename, rawContent, useCaseTag);

      const detectedScriptType = isRobotFile ? 'ROBOT' : 'PLAYWRIGHT';

      const script = await prisma.script.create({
        data: {
          projectId,
          testCaseId,
          filename,
          content: rawContent,
          scriptType: detectedScriptType,
          useCaseFolder: useCaseTag ?? '_uncategorized',
          isCustomUpload: true,
        },
      });

      // Auto-link TCs whose tcId matches [Tags] in this script (non-blocking)
      void autoLinkScriptByTags(projectId, script.id, rawContent);

      res.status(201).json({
        id: script.id,
        filename: script.filename,
        scriptType: detectedScriptType,
        converted,
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
  const lower = originalname.toLowerCase();
  const ext = lower.endsWith('.robot') ? '.robot' : lower.endsWith('.spec.js') ? '.spec.js' : '.spec.ts';
  const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
  return `${tcId}-${slug}${ext}`;
}

async function nextTcId(projectId: string, projectSlug: string): Promise<string> {
  const prefix = projectSlug.replace(/[^a-zA-Z0-9]/g, '').slice(0, 3).toUpperCase();
  const pattern = `TC-${prefix}-`;
  const existing = await prisma.testCase.findMany({
    where: { projectId, tcId: { startsWith: pattern } },
    select: { tcId: true },
  });
  const maxSeq = existing.reduce((max, tc) => {
    const n = parseInt(tc.tcId.slice(pattern.length), 10);
    return Number.isFinite(n) ? Math.max(max, n) : max;
  }, 0);
  return `${pattern}${String(maxSeq + 1).padStart(3, '0')}`;
}

// ── Shared robot conversion helper ───────────────────────────────────────────

async function convertRobotIfNeeded(content: string, projectId: string): Promise<{ content: string; converted: boolean }> {
  if (!/SeleniumLibrary/i.test(content)) return { content, converted: false };
  const llm = createLLM({ temperature: 0, agentName: 'script-agent', projectId });
  const prompt = `You are an expert in Robot Framework test automation.
Convert the following Robot Framework test file from SeleniumLibrary to Browser library (Playwright backend).

Rules:
- Replace "Library    SeleniumLibrary" with "Library    Browser"
- Convert Open Browser to: New Browser    headless=False  /  New Context  /  New Page    \${BASE_URL}
- Convert Input Text → Fill Text
- Convert Click Element / Click Button → Click
- Convert Wait Until Element Is Visible → Wait For Elements State    <locator>    visible
- Convert Get Location → Get Url
- Convert Capture Page Screenshot → Take Screenshot
- Convert Close Browser → Close Browser (Browser library)
- Convert Go To → New Page or reload as appropriate
- Keep all *** Settings ***, *** Variables ***, *** Test Cases ***, *** Keywords *** sections
- Keep variable names like \${BASE_URL}, \${TC_USERNAME}, \${TC_PASSWORD} unchanged
- Preserve all test case names, step descriptions, and tags
- Return ONLY the converted .robot file content — no explanation, no markdown fences

Input file:
${content.slice(0, 6000)}`;
  const response = await llm.invoke([new HumanMessage(prompt)]);
  const raw = typeof response.content === 'string' ? response.content : JSON.stringify(response.content);
  const converted = raw.replace(/^```(?:robot|robotframework)?\s*/im, '').replace(/```\s*$/im, '').trim();
  return { content: converted, converted: true };
}

/** Derive a best-effort title from raw script text without calling the LLM. */
function extractTitleFromScriptText(content: string, isRobot: boolean): string {
  if (isRobot) {
    // First keyword name under *** Test Cases ***
    const tcSection = content.match(/\*{3}\s*Test Cases?\s*\*{3}([\s\S]*?)(?:\*{3}|$)/i)?.[1] ?? '';
    const firstLine = tcSection.split('\n').find((l) => l.trim() && !l.startsWith(' ') && !l.startsWith('\t'));
    if (firstLine?.trim()) return firstLine.trim().slice(0, 200);
  } else {
    // test('...') or describe('...') or test("...")
    const m = content.match(/(?:test|describe)\s*\(\s*['"`]([^'"`]+)['"`]/);
    if (m?.[1]) return m[1].trim().slice(0, 200);
  }
  return 'Imported Test Case';
}

async function extractTCFromScript(scriptContent: string, projectId: string, projectName?: string): Promise<{
  title: string;
  description: string;
  steps: string[];
  expectedResult: string;
  type: 'UI' | 'API' | 'SIT';
  useCaseTag: string | null;
}> {
  const capped = scriptContent.slice(0, 8000);
  const isRobot = capped.trimStart().startsWith('*** Settings ***');

  const minimalFallback = () => ({
    title: extractTitleFromScriptText(capped, isRobot),
    description: 'Imported from external script',
    steps: ['Execute the imported script'],
    expectedResult: 'Script executes without errors',
    type: 'UI' as const,
    useCaseTag: null,
  });

  try {
    const llm = createLLM({ temperature: 0, agentName: 'script-agent', projectId, projectName });

    const response = await llm.invoke([
      new SystemMessage(
        isRobot
          ? `You are a QA engineer. Extract test case details from a Robot Framework test script.
Output ONLY a JSON object — no markdown fences, no explanation:
{
  "title": "concise test case title (from *** Test Cases *** section, 5-10 words)",
  "description": "one sentence describing what is tested",
  "steps": ["user action in plain English", "..."],
  "expectedResult": "what the test verifies in plain English",
  "type": "UI",
  "useCaseTag": null
}
Rules:
- steps: translate keywords into human-readable user actions, not Robot syntax
- type: "UI" for browser tests, "API" for pure API, "SIT" for system integration
- useCaseTag: functional area if clear (e.g. "Login", "Primary Sales", "Dashboard"), otherwise null`
          : `You are a QA engineer. Extract test case details from a Playwright TypeScript test script.
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
      new HumanMessage(isRobot
        ? `Script:\n\`\`\`robot\n${capped}\n\`\`\``
        : `Script:\n\`\`\`typescript\n${capped}\n\`\`\``),
    ]);

    const raw = typeof response.content === 'string' ? response.content : JSON.stringify(response.content);
    const cleaned = raw.replace(/^```(?:json)?\s*/im, '').replace(/```\s*$/im, '').trim();

    const parsed = JSON.parse(cleaned);
    return {
      title: String(parsed.title || extractTitleFromScriptText(capped, isRobot)).slice(0, 200),
      description: String(parsed.description || '').slice(0, 500),
      steps: Array.isArray(parsed.steps) ? parsed.steps.map(String).filter(Boolean) : [],
      expectedResult: String(parsed.expectedResult || 'Script executes without errors').slice(0, 1000),
      type: (['UI', 'API', 'SIT'] as const).includes(parsed.type) ? parsed.type : 'UI',
      useCaseTag: parsed.useCaseTag ? String(parsed.useCaseTag).slice(0, 120) : null,
    };
  } catch (err: unknown) {
    // Network/LLM unavailable — create a minimal TC from the script text itself
    const isNetworkError = err instanceof Error && (
      err.message.includes('ECONNREFUSED') ||
      err.message.includes('ENOTFOUND') ||
      err.message.includes('ETIMEDOUT') ||
      err.message.includes('fetch failed') ||
      err.message.includes('network') ||
      err.message.includes('connect')
    );
    if (!isNetworkError) {
      // JSON parse failure from LLM — still use minimal fallback
      console.warn('[extractTCFromScript] LLM response unparseable, using fallback');
    } else {
      console.warn('[extractTCFromScript] LLM unreachable (no internet?), using offline fallback');
    }
    return minimalFallback();
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
      const slug = req.project.slug;
      const isRobotFile = req.file.originalname.toLowerCase().endsWith('.robot');

      // Convert SeleniumLibrary → Browser for robot files before extraction
      let rawContent = req.file.buffer.toString('utf-8');
      let converted = false;
      if (isRobotFile) {
        const result = await convertRobotIfNeeded(rawContent, projectId);
        rawContent = result.content;
        converted = result.converted;
      }

      // Rewrite relative resource/variable paths to absolute container paths
      if (isRobotFile) {
        const { content: rewritten } = rewriteRobotResourcePaths(rawContent, slug);
        rawContent = rewritten;
      }

      // Extract TC details from script via LLM
      const extracted = await extractTCFromScript(rawContent, projectId, req.project.name);

      // Generate a unique tcId
      const tcId = await nextTcId(projectId, slug);

      // Rename to system-default convention using extracted TC info
      const filename = buildSystemFilename(tcId, extracted.title, req.file.originalname);
      const scriptType = isRobotFile ? 'ROBOT' : 'PLAYWRIGHT';

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
      saveScript(slug, filename, rawContent, testCase.useCaseTag ?? null);

      const script = await prisma.script.create({
        data: {
          projectId,
          testCaseId: testCase.id,
          filename,
          content: rawContent,
          scriptType,
          isCustomUpload: true,
        },
      });

      res.status(201).json({ testCase, script, converted });
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

    const buffer = await exportZip(req.project.slug, filenames);
    const name = `${req.project.slug}-scripts.zip`;

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${name}"`);
    res.send(buffer);
  } catch (err) {
    console.error('[scripts] GET /export/zip', err);
    res.status(500).json({ error: 'Export failed' });
  }
});

// ── GET /file-tree — recursive project file tree ──────────────────────────────

router.get('/file-tree', async (req: Request, res: Response) => {
  try {
    const tree = buildFileTree(req.project.slug);
    res.json(tree);
  } catch (err) {
    console.error('[scripts] GET /file-tree', err);
    res.status(500).json({ error: 'Could not build file tree' });
  }
});

// ── GET /search — grep project files for a keyword/phrase ────────────────────

router.get('/search', async (req: Request, res: Response) => {
  try {
    const q = String(req.query.q ?? '').trim();
    if (q.length < 2) { res.json({ groups: [] }); return; }
    const groups = searchProjectFiles(req.project.slug, q);
    res.json({ groups });
  } catch (err) {
    console.error('[scripts] GET /search', err);
    res.status(500).json({ error: 'Search failed' });
  }
});

// ── POST /project-file/mkdir — create a folder anywhere in the project tree ────

router.post('/project-file/mkdir', async (req: Request, res: Response) => {
  try {
    const { path: folderPath } = req.body as { path?: string };
    if (!folderPath || typeof folderPath !== 'string') {
      res.status(400).json({ error: 'path is required' });
      return;
    }
    const segments = folderPath.split('/').filter(Boolean);
    if (segments.length === 0 || segments.some((s) => s === '..' || s === '.')) {
      res.status(400).json({ error: 'Invalid folder path' });
      return;
    }
    const normalized = segments.join('/');
    const fullPath = path.join(projectRoot(req.project.slug), normalized);
    fs.mkdirSync(fullPath, { recursive: true });
    const keepFile = path.join(fullPath, '.gitkeep');
    if (!fs.existsSync(keepFile)) fs.writeFileSync(keepFile, '', 'utf-8');
    res.json({ ok: true, path: normalized });
  } catch (err: any) {
    console.error('[scripts] POST /project-file/mkdir', err);
    res.status(500).json({ error: err?.message ?? 'Failed to create folder' });
  }
});

// ── POST /project-file/upload — upload any file into an arbitrary folder ──────

router.post('/project-file/upload', projectFileUpload.single('file'), async (req: Request, res: Response) => {
  try {
    if (!req.file) { res.status(400).json({ error: 'No file uploaded (field name: file)' }); return; }
    const rawFolder = ((req.body as Record<string, string>).folder ?? '').trim();
    const folderSegments = rawFolder.split('/').filter(Boolean).filter((s) => s !== '..' && s !== '.');
    const basename = req.file.originalname.replace(/[^a-zA-Z0-9._\- ()]/g, '_');
    const relPath = [...folderSegments, basename].join('/');
    const fullPath = path.join(projectRoot(req.project.slug), relPath);
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    fs.writeFileSync(fullPath, req.file.buffer);
    res.status(201).json({ ok: true, path: relPath });
  } catch (err: any) {
    console.error('[scripts] POST /project-file/upload', err);
    res.status(500).json({ error: err?.message ?? 'Upload failed' });
  }
});

// ── POST /project-file/move — move/rename a file or folder within the project ─
// Used by drag-and-drop in the Project Files tree.

function normalizeRelPath(p: string): string | null {
  const segments = p.split('/').filter(Boolean);
  if (segments.length === 0 || segments.some((s) => s === '..' || s === '.')) return null;
  return segments.join('/');
}

router.post('/project-file/move', async (req: Request, res: Response) => {
  try {
    const { from, to } = req.body as { from?: string; to?: string };
    const fromNorm = from ? normalizeRelPath(from) : null;
    if (!fromNorm) { res.status(400).json({ error: 'Invalid "from" path' }); return; }
    // "to" is the destination FOLDER (may be '' for project root)
    const toFolder = to?.trim() ? normalizeRelPath(to.trim()) : '';
    if (toFolder === null) { res.status(400).json({ error: 'Invalid "to" path' }); return; }

    const root = projectRoot(req.project.slug);
    const srcAbs = path.join(root, fromNorm);
    const basename = path.basename(fromNorm);
    const destRelPath = toFolder ? `${toFolder}/${basename}` : basename;
    const destAbs = path.join(root, destRelPath);

    if (!fs.existsSync(srcAbs)) { res.status(404).json({ error: 'Source not found' }); return; }
    if (destAbs === srcAbs) { res.json({ ok: true, path: destRelPath }); return; }
    // Guard against dropping a folder into itself or one of its own descendants
    if (destAbs === srcAbs + path.sep || destAbs.startsWith(srcAbs + path.sep)) {
      res.status(400).json({ error: 'Cannot move a folder into itself' });
      return;
    }
    if (fs.existsSync(destAbs)) { res.status(409).json({ error: `"${basename}" already exists in the destination folder` }); return; }

    fs.mkdirSync(path.dirname(destAbs), { recursive: true });
    fs.renameSync(srcAbs, destAbs);

    // Best-effort: keep useCaseFolder in sync for any linked Script row so the
    // rest of the app (run resolution, etc.) doesn't point at the stale folder.
    if (fs.statSync(destAbs).isFile()) {
      await prisma.script.updateMany({
        where: { projectId: req.project.id, filename: basename },
        data: { useCaseFolder: toFolder || null },
      });
    }

    res.json({ ok: true, path: destRelPath });
  } catch (err: any) {
    console.error('[scripts] POST /project-file/move', err);
    res.status(500).json({ error: err?.message ?? 'Move failed' });
  }
});

// ── GET /project-file/download — download a single file by relative path ──────

router.get('/project-file/download', async (req: Request, res: Response) => {
  try {
    const relPath = req.query.path as string;
    if (!relPath) { res.status(400).json({ error: 'path query param required' }); return; }
    const { buffer, name } = getProjectFileContent(req.project.slug, relPath);
    res.setHeader('Content-Disposition', `attachment; filename="${name}"`);
    res.setHeader('Content-Type', 'application/octet-stream');
    res.send(buffer);
  } catch (err: any) {
    console.error('[scripts] GET /project-file/download', err);
    res.status(404).json({ error: err.message ?? 'File not found' });
  }
});

// ── GET /project-file/download-zip — download a folder or whole project as zip ─

router.get('/project-file/download-zip', async (req: Request, res: Response) => {
  try {
    const relPath = (req.query.path as string | undefined) || undefined;
    const { buffer, name } = await exportFolderZip(req.project.slug, relPath);
    res.setHeader('Content-Disposition', `attachment; filename="${name}.zip"`);
    res.setHeader('Content-Type', 'application/zip');
    res.send(buffer);
  } catch (err: any) {
    console.error('[scripts] GET /project-file/download-zip', err);
    res.status(500).json({ error: 'Zip export failed' });
  }
});

// ── POST /import-folder — import a zip archive maintaining folder structure ────
// Accepts a .zip file with QAASR-compatible structure:
//   TestCases/{UseCase}/TC01_name.robot → DB Script record + TestCase link
//   Resource/**                         → disk only (RF keywords/variables)
//   resources/**                        → disk only (binary data)

router.post(
  '/import-folder',
  (req: Request, res: Response, next: NextFunction) => {
    zipUpload.single('folder')(req, res, (err) => {
      if (err instanceof multer.MulterError) { res.status(400).json({ error: `Upload error: ${err.message}` }); return; }
      if (err instanceof Error) { res.status(400).json({ error: err.message }); return; }
      next();
    });
  },
  async (req: Request, res: Response) => {
    try {
      if (!req.file) { res.status(400).json({ error: 'No zip file uploaded (field name: folder)' }); return; }
      const { id: projectId, slug } = req.project;
      // createTCs=false → load scripts only, skip TC creation (feature 3: import confirmation)
      const createTCs = req.body?.createTCs !== 'false';

      const zipBuffer = fs.readFileSync(req.file.path);
      fs.unlink(req.file.path, () => { /* best-effort temp cleanup */ });

      const { files, warnings } = await importFromZip(slug, zipBuffer);

      // Only test scripts under TestCases/ get DB records
      const testScripts = files.filter(f => f.isTestScript);
      const imported: { filename: string; relPath: string; testCasesCreated: number }[] = [];

      for (const f of testScripts) {
        // relPath like "TestCases/Geo Hierarchy/TC01_Create_Region.robot"
        const parts = f.relPath.split('/');
        const useCaseTag = parts.length >= 3 ? parts[1] : 'Uncategorised';
        const filename = parts[parts.length - 1];

        try {
          const existing = await prisma.script.findFirst({ where: { projectId, filename, useCaseFolder: useCaseTag } });
          let testCasesCreated = 0;

          // Helper: auto-create a TC for this script if createTCs is enabled
          const autoCreateTc = async (): Promise<{ id: string } | null> => {
            if (!createTCs) return null;
            const title = filename.replace(/\.(robot|spec\.ts|spec\.js)$/, '');
            const maxTc = await prisma.testCase.findFirst({
              where: { projectId },
              orderBy: { tcId: 'desc' },
              select: { tcId: true },
            });
            const prefix = slug.toUpperCase().slice(0, 6);
            const nextNum = maxTc ? (parseInt(maxTc.tcId.replace(/\D/g, '') || '0', 10) + 1) : 1;
            const newTcId = `TC-${prefix}-${String(nextNum).padStart(3, '0')}`;
            return prisma.testCase.create({
              data: { projectId, tcId: newTcId, title, useCaseTag, steps: '', expectedResult: '' },
            });
          };

          if (existing) {
            await prisma.script.update({
              where: { id: existing.id },
              data: { content: f.content, useCaseFolder: useCaseTag, updatedAt: new Date() },
            });
            // If script has no TC link yet and createTCs is on, create one now
            if (!existing.testCaseId && createTCs) {
              const tc = await autoCreateTc();
              if (tc) {
                await prisma.script.update({ where: { id: existing.id }, data: { testCaseId: tc.id } });
                testCasesCreated = 1;
              }
            }
          } else {
            // Try to link to existing TC by TC-XXX prefix
            const tcMatch = filename.match(/^(TC-[A-Z]+-\d+)/i) ?? filename.match(/^(TC\d+)/i);
            let testCaseId: string | null = null;
            if (tcMatch) {
              const tc = await prisma.testCase.findFirst({
                where: { projectId, tcId: { equals: tcMatch[1], mode: 'insensitive' } },
                select: { id: true },
              });
              testCaseId = tc?.id ?? null;
            }
            if (!testCaseId) {
              const tc = await autoCreateTc();
              if (tc) { testCaseId = tc.id; testCasesCreated = 1; }
            }
            const scriptType = filename.endsWith('.robot') ? 'ROBOT' : 'PLAYWRIGHT';
            await prisma.script.create({
              data: {
                projectId,
                testCaseId,
                filename,
                content: f.content,
                scriptType,
                useCaseFolder: useCaseTag,
                isCustomUpload: false,
              },
            });
          }
          imported.push({ filename, relPath: f.relPath, testCasesCreated });
        } catch (err: any) {
          warnings.push(`${f.relPath}: ${err.message}`);
        }
      }

      res.json({
        imported,
        resourceFiles: files.filter(f => !f.isTestScript).length,
        total: files.length,
        warnings,
      });
    } catch (err) {
      console.error('[scripts] POST /import-folder', err);
      res.status(500).json({ error: 'Import failed' });
    }
  },
);

// ── POST /import-robot — upload & optionally convert a .robot file ───────────
// Detects if the file uses SeleniumLibrary → converts to RF Browser via LLM
// If already Browser/PlaywrightLibrary → passes through unchanged

router.post(
  '/import-robot',
  (req: Request, res: Response, next: NextFunction) => {
    robotUpload.single('file')(req, res, (err) => {
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
      const rawContent = req.file.buffer.toString('utf-8');
      const originalName = req.file.originalname;

      // Detect if file uses SeleniumLibrary
      const usesSelenium = /SeleniumLibrary/i.test(rawContent);

      let finalContent = rawContent;
      let converted = false;

      if (usesSelenium) {
        // Convert SeleniumLibrary → RF Browser using LLM
        const llm = createLLM({ temperature: 0, agentName: 'script-agent', projectId });
        const conversionPrompt = `You are an expert in Robot Framework test automation.
Convert the following Robot Framework test file from SeleniumLibrary to Browser library (Playwright backend).

Rules:
- Replace "Library    SeleniumLibrary" with "Library    Browser"
- Convert Open Browser to: New Browser    headless=False  /  New Context  /  New Page    \${BASE_URL}
- Convert Input Text → Fill Text
- Convert Click Element / Click Button → Click
- Convert Wait Until Element Is Visible → Wait For Elements State    <locator>    visible
- Convert Get Location → Get Url
- Convert Capture Page Screenshot → Take Screenshot
- Convert Close Browser → Close Browser (Browser library)
- Convert Go To → New Page or reload as appropriate
- Keep all *** Settings ***, *** Variables ***, *** Test Cases ***, *** Keywords *** sections
- Keep variable names like \${BASE_URL}, \${TC_USERNAME}, \${TC_PASSWORD} unchanged
- Preserve all test case names, step descriptions, and tags
- Return ONLY the converted .robot file content — no explanation, no markdown fences

Input file:
${rawContent.slice(0, 6000)}`;

        const response = await llm.invoke([new HumanMessage(conversionPrompt)]);
        const responseText = typeof response.content === 'string'
          ? response.content
          : JSON.stringify(response.content);
        finalContent = responseText
          .replace(/^```(?:robot|robotframework)?\s*/im, '')
          .replace(/```\s*$/im, '')
          .trim();
        converted = true;
      }

      // Rewrite relative resource/variable paths to absolute container paths
      const { content: rewrittenRobot } = rewriteRobotResourcePaths(finalContent, req.project.slug);
      finalContent = rewrittenRobot;

      // Save to filesystem with sanitised filename
      const filename = originalName.replace(/[^a-zA-Z0-9._-]/g, '_');
      saveScript(req.project.slug, filename, finalContent);

      // Link to a test case if testCaseId provided
      const testCaseId = (req.body?.testCaseId as string | undefined) || null;
      if (testCaseId) {
        const tc = await prisma.testCase.findFirst({ where: { id: testCaseId, projectId } });
        if (!tc) {
          res.status(400).json({ error: 'Test case not found in this project' });
          return;
        }
        const existing = await prisma.script.findFirst({ where: { projectId, testCaseId } });
        if (existing) {
          await prisma.script.delete({ where: { id: existing.id } });
          deleteScript(req.project.slug, existing.filename);
        }
      }

      const script = await prisma.script.create({
        data: {
          projectId,
          testCaseId,
          filename,
          content: finalContent,
          scriptType: 'ROBOT',
          isCustomUpload: true,
        },
      });

      res.status(201).json({
        id: script.id,
        filename: script.filename,
        scriptType: 'ROBOT',
        converted,
        originalLibrary: usesSelenium ? 'SeleniumLibrary' : 'Browser',
        testCaseId: script.testCaseId,
        createdAt: script.createdAt,
      });
    } catch (err) {
      console.error('[scripts] POST /import-robot', err);
      res.status(500).json({ error: 'Robot import failed' });
    }
  },
);

// ── GET /mine-keywords — cross-script keyword mining ─────────────────────
// Analyses all .robot files in the project and returns keyword bodies that
// appear in 2+ scripts (candidates for extraction to resources/).

router.get('/mine-keywords', async (req: Request, res: Response) => {
  try {
    const projectId = req.project.id;
    const slug = req.project.slug;
    const files = listScriptFiles(slug).filter(f => f.filename.endsWith('.robot'));

    // Parse keywords out of each file: a keyword is a non-indented line followed by indented lines
    const keywordBodies: Map<string, { body: string; files: string[] }> = new Map();

    for (const { filename } of files) {
      let content: string;
      try { content = readScript(slug, filename); } catch { continue; }

      const lines = content.split('\n');
      let inKeywords = false;
      let currentName = '';
      const currentBody: string[] = [];

      const flush = () => {
        if (!currentName || currentBody.length === 0) return;
        const body = currentBody.join('\n').trim();
        if (body.length < 20) return; // ignore trivially short keywords
        if (!keywordBodies.has(body)) {
          keywordBodies.set(body, { body, files: [filename] });
        } else {
          const entry = keywordBodies.get(body)!;
          if (!entry.files.includes(filename)) entry.files.push(filename);
        }
      };

      for (const line of lines) {
        if (line.trim() === '*** Keywords ***') { inKeywords = true; currentName = ''; currentBody.length = 0; continue; }
        if (line.startsWith('*** ') && line !== '*** Keywords ***') { flush(); inKeywords = false; currentName = ''; currentBody.length = 0; continue; }
        if (!inKeywords) continue;
        if (line && !line.startsWith(' ') && !line.startsWith('\t')) {
          flush(); currentName = line.trim(); currentBody.length = 0;
        } else if (currentName) {
          currentBody.push(line);
        }
      }
      flush();
    }

    const candidates = Array.from(keywordBodies.values())
      .filter(k => k.files.length >= 2)
      .map(k => ({ body: k.body.slice(0, 300), usedInFiles: k.files, count: k.files.length }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 20);

    res.json({ candidates, analysedFiles: files.length });
  } catch (err) {
    console.error('[scripts] GET /mine-keywords', err);
    res.status(500).json({ error: 'Keyword mining failed' });
  }
});

// ── Playwright Codegen recording proxy ────────────────────────────────────

const RUNNER_URL = process.env.RUNNER_PRIMARY_URL ?? process.env.RUNNER_URL ?? 'http://qa-runner:5001';

const RecordStartSchema = z.object({
  url: z.string().min(1).max(2048),
  sessionId: z.string().min(1).max(64),
});

const RecordStopSchema = z.object({
  sessionId: z.string().min(1).max(64),
  testCaseId: z.string().optional(),
  testCaseName: z.string().optional(),
  saveToScriptId: z.string().optional(),
});

// POST /projects/:projectId/scripts/record/start
router.post('/record/start', async (req: Request, res: Response) => {
  const parsed = RecordStartSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  try {
    const runnerRes = await fetch(`${RUNNER_URL}/record/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(parsed.data),
    });
    const json = await runnerRes.json() as Record<string, unknown>;
    res.status(runnerRes.status).json(json);
  } catch (err) {
    console.error('[scripts] POST /record/start', err);
    res.status(502).json({ error: 'Runner unreachable' });
  }
});

// POST /projects/:projectId/scripts/record/stop
// Kills the codegen process and returns the raw Playwright TS code (fast, no LLM).
router.post('/record/stop', async (req: Request, res: Response) => {
  const parsed = z.object({ sessionId: z.string().min(1).max(64) }).safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  const { sessionId } = parsed.data;

  try {
    const runnerRes = await fetch(`${RUNNER_URL}/record/stop`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId }),
    });
    const json = await runnerRes.json() as { ok?: boolean; playwrightCode?: string; error?: string };
    if (!runnerRes.ok || !json.ok) {
      res.status(runnerRes.status).json({ error: json.error ?? 'Runner error' });
      return;
    }
    res.json({ ok: true, playwrightCode: json.playwrightCode ?? '' });
  } catch (err) {
    console.error('[scripts] POST /record/stop — runner fetch', err);
    res.status(502).json({ error: 'Runner unreachable' });
  }
});

// POST /projects/:projectId/scripts/record/convert
// Converts raw Playwright TS (from codegen) to Robot Framework via LLM.
router.post('/record/convert', async (req: Request, res: Response) => {
  const parsed = z.object({
    playwrightCode: z.string().min(1),
    testCaseName: z.string().optional(),
  }).safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  const { playwrightCode, testCaseName } = parsed.data;
  const projectId = req.params['projectId'] ?? '';

  let projectName = projectId;
  try {
    const proj = await prisma.project.findUnique({ where: { id: projectId }, select: { name: true } });
    if (proj) projectName = proj.name;
  } catch { /* non-fatal */ }

  try {
    const robotScript = await convertCodegenToRobot({ playwrightCode, projectId, projectName, testCaseName });
    res.json({ ok: true, robotScript });
  } catch (err) {
    console.error('[scripts] codegen conversion failed', err);
    res.status(500).json({ error: 'Conversion failed' });
  }
});

// ── Tag-based auto-link helpers ───────────────────────────────────────────────

/**
 * Reads [Tags] from a Robot Framework script and sets TC.linkedScriptId for any
 * matching test case (matched by tcId). Only fills null slots — never overwrites
 * an existing link. First script wins when multiple scripts claim the same tag.
 */
export async function autoLinkScriptByTags(
  projectId: string,
  scriptId: string,
  content: string,
): Promise<number> {
  const tags = extractRobotTags(content);
  if (tags.length === 0) return 0;

  let linked = 0;
  for (const tag of tags) {
    const tc = await prisma.testCase.findFirst({
      where: { projectId, tcId: tag, linkedScriptId: null },
    });
    if (!tc) continue;
    await prisma.testCase.update({
      where: { id: tc.id },
      data: { linkedScriptId: scriptId },
    });
    linked++;
  }
  return linked;
}

/**
 * Scans every script in a project and auto-links TCs by [Tags].
 * Processes scripts in createdAt ASC order so first-created script wins on conflicts.
 */
export async function scanAllScriptTags(projectId: string): Promise<number> {
  const scripts = await prisma.script.findMany({
    where: { projectId },
    select: { id: true, content: true },
    orderBy: { createdAt: 'asc' },
  });
  let total = 0;
  for (const s of scripts) {
    if (!s.content) continue;
    total += await autoLinkScriptByTags(projectId, s.id, s.content);
  }
  return total;
}

// ── POST /scan-tags — project-wide tag scan ───────────────────────────────────

router.post('/scan-tags', async (req: Request, res: Response) => {
  try {
    const linked = await scanAllScriptTags(req.project.id);
    res.json({ ok: true, linked });
  } catch (err) {
    console.error('[scripts] POST /scan-tags', err);
    res.status(500).json({ error: 'Tag scan failed' });
  }
});

export default router;
