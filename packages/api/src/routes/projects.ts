import { Router, Request, Response, NextFunction, RequestHandler } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import JSZip from 'jszip';
import { prisma } from '../lib/prisma.js';
import { verifyToken } from '../middleware/auth.js';
import { requireProjectAccess } from '../middleware/projectAccess.js';
import { exportZip, projectRoot } from '../services/scriptFileService.js';
import {
  CreateProjectSchema,
  UpdateProjectSchema,
  DeleteProjectSchema,
  CreateMemberSchema,
  UpdateMemberSchema,
  CreateEnvConfigSchema,
  UpdateEnvConfigSchema,
  ToggleReqDocSchema,
} from '../lib/validation.js';

const router = Router();

// ── Multer — requirement-doc upload config ─────────────────────────────────

const REQUIREMENTS_ROOT = process.env.REQUIREMENTS_PATH ?? '/requirements';

const storage = multer.diskStorage({
  destination: (req, _file, cb) => {
    const dir = path.join(REQUIREMENTS_ROOT, req.params['projectId'] ?? req.project?.id ?? 'unknown');
    try {
      fs.mkdirSync(dir, { recursive: true });
      cb(null, dir);
    } catch (err) {
      cb(err as Error, dir);
    }
  },
  filename: (_req, file, cb) => {
    const safe = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
    cb(null, `${Date.now()}-${safe}`);
  },
});

const fileFilter = (
  _req: Request,
  file: Express.Multer.File,
  cb: multer.FileFilterCallback,
) => {
  const allowedTypes = [
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/msword',
    'text/plain',
    'text/markdown',
  ];
  if (allowedTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error(`File type "${file.mimetype}" is not supported. Allowed: PDF, Excel, Word, TXT, MD`));
  }
};

const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: parseInt(process.env.MAX_UPLOAD_BYTES ?? '52428800', 10) },
});

// ── RBAC helper — checks project-level ADMIN role ──────────────────────────

function requireProjectAdmin(req: Request, res: Response, next: NextFunction): void {
  if (req.user.globalRole === 'SUPER_ADMIN') {
    next();
    return;
  }
  if (!req.projectMember || req.projectMember.role !== 'ADMIN') {
    res.status(403).json({ error: 'Project ADMIN role is required for this action' });
    return;
  }
  next();
}

// ── Slug generator ─────────────────────────────────────────────────────────

function toSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

// ══════════════════════════════════════════════════════════════════════════════
// PUBLIC-PROJECT ROUTES  (auth only, no project membership check)
// ══════════════════════════════════════════════════════════════════════════════

// GET /api/projects — list all projects the authenticated user is a member of
router.get('/', verifyToken as RequestHandler, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const isSuperAdmin = req.user.globalRole === 'SUPER_ADMIN';

    const projects = await prisma.project.findMany({
      where: isSuperAdmin ? undefined : { members: { some: { userId: req.user.id } } },
      include: {
        _count: {
          select: {
            testCases: true,
            members: true,
            runs: true,
          },
        },
        envConfigs: { orderBy: { isDefault: 'desc' } },
        members: {
          where: { userId: req.user.id },
          select: { role: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    res.json({
      projects: projects.map((p) => ({
        ...p,
        myRole: p.members[0]?.role ?? (isSuperAdmin ? 'ADMIN' : null),
        members: undefined, // remove raw members array from response
      })),
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/projects — create a new project
router.post('/', verifyToken as RequestHandler, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const parsed = CreateProjectSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Validation failed', issues: parsed.error.issues });
      return;
    }

    const { name, description, baseUrl, color, reqLibraryPath } = parsed.data;
    const slug = parsed.data.slug ?? toSlug(name);

    // Validate slug uniqueness
    const existing = await prisma.project.findUnique({ where: { slug } });
    if (existing) {
      res.status(409).json({ error: 'A project with this slug already exists', slug });
      return;
    }

    const project = await prisma.$transaction(async (tx) => {
      const p = await tx.project.create({
        data: {
          name,
          slug,
          description,
          baseUrl: baseUrl || undefined,
          color: color ?? '#22d3ee',
          reqLibraryPath,
          createdBy: req.user.id,
        },
      });

      // Creator is automatically an ADMIN
      await tx.projectMember.create({
        data: { projectId: p.id, userId: req.user.id, role: 'ADMIN' },
      });

      return p;
    });

    res.status(201).json({ project });
  } catch (err) {
    next(err);
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// PER-PROJECT ROUTES  (/api/projects/:projectId/...)
// All routes below require: verifyToken → requireProjectAccess
// ══════════════════════════════════════════════════════════════════════════════

const projectRouter = Router({ mergeParams: true });

projectRouter.use(verifyToken as RequestHandler);
projectRouter.use(requireProjectAccess as unknown as RequestHandler);

// ── Project CRUD ───────────────────────────────────────────────────────────

// GET /api/projects/:projectId
projectRouter.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const project = await prisma.project.findUnique({
      where: { id: req.project.id },
      include: {
        envConfigs: { orderBy: { isDefault: 'desc' } },
        requirementDocs: { orderBy: { uploadedAt: 'desc' } },
        _count: { select: { members: true, testCases: true, runs: true, scripts: true } },
      },
    });

    res.json({ project });
  } catch (err) {
    next(err);
  }
});

// PUT /api/projects/:projectId
projectRouter.put(
  '/',
  requireProjectAdmin as RequestHandler,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const parsed = UpdateProjectSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'Validation failed', issues: parsed.error.issues });
        return;
      }

      const { name, description, baseUrl, color, reqLibraryPath } = parsed.data;

      const updated = await prisma.project.update({
        where: { id: req.project.id },
        data: {
          ...(name !== undefined && { name }),
          ...(description !== undefined && { description }),
          ...(baseUrl !== undefined && { baseUrl: baseUrl || null }),
          ...(color !== undefined && { color }),
          ...(reqLibraryPath !== undefined && { reqLibraryPath }),
        },
      });

      res.json({ project: updated });
    } catch (err) {
      next(err);
    }
  },
);

// DELETE /api/projects/:projectId
// Requires project name confirmation to prevent accidental deletion
projectRouter.delete(
  '/',
  requireProjectAdmin as RequestHandler,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const parsed = DeleteProjectSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'Validation failed', issues: parsed.error.issues });
        return;
      }

      if (parsed.data.confirmName !== req.project.name) {
        res.status(400).json({
          error: 'Project name confirmation does not match',
          expected: req.project.name,
        });
        return;
      }

      // Clean up uploaded requirement docs from disk (best-effort)
      const docs = await prisma.requirementDoc.findMany({
        where: { projectId: req.project.id },
        select: { filePath: true },
      });
      for (const doc of docs) {
        try {
          await fs.promises.unlink(doc.filePath);
        } catch {
          // Ignore — file may not exist on disk
        }
      }

      // Cascade delete handles all child records via Prisma relations
      await prisma.project.delete({ where: { id: req.project.id } });

      res.status(204).send();
    } catch (err) {
      next(err);
    }
  },
);

// ── Members ────────────────────────────────────────────────────────────────

// GET /api/projects/:projectId/users/search?q= — search registered users for member autocomplete
projectRouter.get(
  '/users/search',
  requireProjectAdmin as RequestHandler,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const q = (req.query.q as string ?? '').trim();
      if (!q || q.length < 2) {
        res.json({ users: [] });
        return;
      }
      const existingMemberIds = (
        await prisma.projectMember.findMany({
          where: { projectId: req.project.id },
          select: { userId: true },
        })
      ).map((m) => m.userId);

      const users = await prisma.user.findMany({
        where: {
          id: { notIn: existingMemberIds },
          OR: [
            { email: { contains: q, mode: 'insensitive' } },
            { name: { contains: q, mode: 'insensitive' } },
          ],
        },
        select: { id: true, name: true, email: true },
        take: 8,
        orderBy: { email: 'asc' },
      });
      res.json({ users });
    } catch (err) {
      next(err);
    }
  },
);

// GET /api/projects/:projectId/members — list all members of a project
projectRouter.get('/members', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const members = await prisma.projectMember.findMany({
      where: { projectId: req.project.id },
      include: { user: { select: { id: true, name: true, email: true, globalRole: true } } },
      orderBy: { createdAt: 'asc' },
    });
    res.json({ members });
  } catch (err) {
    next(err);
  }
});

// POST /api/projects/:projectId/members — add a member by email
projectRouter.post(
  '/members',
  requireProjectAdmin as RequestHandler,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const parsed = CreateMemberSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'Validation failed', issues: parsed.error.issues });
        return;
      }

      const { email, role } = parsed.data;

      const user = await prisma.user.findUnique({ where: { email } });
      if (!user) {
        res.status(404).json({ error: `No user found with email "${email}"` });
        return;
      }

      // Check for existing membership
      const existing = await prisma.projectMember.findUnique({
        where: { projectId_userId: { projectId: req.project.id, userId: user.id } },
      });
      if (existing) {
        res.status(409).json({ error: 'User is already a member of this project' });
        return;
      }

      const member = await prisma.projectMember.create({
        data: { projectId: req.project.id, userId: user.id, role },
        include: { user: { select: { id: true, name: true, email: true } } },
      });

      res.status(201).json({ member });
    } catch (err) {
      next(err);
    }
  },
);

// DELETE /api/projects/:projectId/members/:uid — remove a member
projectRouter.delete(
  '/members/:uid',
  requireProjectAdmin as RequestHandler,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { uid } = req.params;

      // Prevent removing yourself if you are the only ADMIN
      const adminCount = await prisma.projectMember.count({
        where: { projectId: req.project.id, role: 'ADMIN' },
      });
      const targetMember = await prisma.projectMember.findUnique({
        where: { projectId_userId: { projectId: req.project.id, userId: uid } },
      });

      if (!targetMember) {
        res.status(404).json({ error: 'Member not found in this project' });
        return;
      }

      if (targetMember.role === 'ADMIN' && adminCount <= 1) {
        res.status(400).json({ error: 'Cannot remove the last ADMIN from a project' });
        return;
      }

      await prisma.projectMember.delete({
        where: { projectId_userId: { projectId: req.project.id, userId: uid } },
      });

      res.status(204).send();
    } catch (err) {
      next(err);
    }
  },
);

// PUT /api/projects/:projectId/members/:uid — change a member's role
projectRouter.put(
  '/members/:uid',
  requireProjectAdmin as RequestHandler,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const parsed = UpdateMemberSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'Validation failed', issues: parsed.error.issues });
        return;
      }

      const { uid } = req.params;
      const { role } = parsed.data;

      const existing = await prisma.projectMember.findUnique({
        where: { projectId_userId: { projectId: req.project.id, userId: uid } },
      });
      if (!existing) {
        res.status(404).json({ error: 'Member not found in this project' });
        return;
      }

      // Prevent removing last ADMIN by demoting them
      if (existing.role === 'ADMIN' && role !== 'ADMIN') {
        const adminCount = await prisma.projectMember.count({
          where: { projectId: req.project.id, role: 'ADMIN' },
        });
        if (adminCount <= 1) {
          res.status(400).json({ error: 'Cannot demote the last ADMIN of a project' });
          return;
        }
      }

      const updated = await prisma.projectMember.update({
        where: { projectId_userId: { projectId: req.project.id, userId: uid } },
        data: { role },
        include: { user: { select: { id: true, name: true, email: true } } },
      });

      res.json({ member: updated });
    } catch (err) {
      next(err);
    }
  },
);

// ── Environments ───────────────────────────────────────────────────────────

// GET /api/projects/:projectId/envs
projectRouter.get('/envs', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const isAdmin =
      req.user.globalRole === 'SUPER_ADMIN' ||
      req.user.globalRole === 'ADMIN' ||
      req.projectMember?.role === 'ADMIN';

    const envs = await prisma.envConfig.findMany({
      where: { projectId: req.project.id },
      orderBy: [{ isDefault: 'desc' }, { name: 'asc' }],
    });

    // Only project ADMINs and global admins receive the raw password; all other
    // roles receive a masked placeholder so they know a password exists without
    // being able to read it.
    const sanitized = envs.map((e) => ({
      ...e,
      password: isAdmin ? e.password : e.password ? '••••••••' : null,
    }));

    res.json({ envs: sanitized });
  } catch (err) {
    next(err);
  }
});

// POST /api/projects/:projectId/envs
projectRouter.post(
  '/envs',
  requireProjectAdmin as RequestHandler,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const parsed = CreateEnvConfigSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'Validation failed', issues: parsed.error.issues });
        return;
      }

      const { name, baseUrl, username, password, isDefault } = parsed.data;

      // If new env is default, clear other defaults first
      if (isDefault) {
        await prisma.envConfig.updateMany({
          where: { projectId: req.project.id, isDefault: true },
          data: { isDefault: false },
        });
      }

      const env = await prisma.envConfig.create({
        data: {
          projectId: req.project.id,
          name,
          baseUrl,
          username: username ?? null,
          password: password ?? null,
          isDefault: isDefault ?? false,
        },
      });

      res.status(201).json({ env });
    } catch (err) {
      next(err);
    }
  },
);

// PUT /api/projects/:projectId/envs/:id
projectRouter.put(
  '/envs/:id',
  requireProjectAdmin as RequestHandler,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const parsed = UpdateEnvConfigSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'Validation failed', issues: parsed.error.issues });
        return;
      }

      const { id } = req.params;

      const existing = await prisma.envConfig.findFirst({
        where: { id, projectId: req.project.id },
      });
      if (!existing) {
        res.status(404).json({ error: 'Environment not found' });
        return;
      }

      // If setting as default, clear others
      if (parsed.data.isDefault === true) {
        await prisma.envConfig.updateMany({
          where: { projectId: req.project.id, isDefault: true, NOT: { id } },
          data: { isDefault: false },
        });
      }

      const updated = await prisma.envConfig.update({
        where: { id },
        data: parsed.data,
      });

      res.json({ env: updated });
    } catch (err) {
      next(err);
    }
  },
);

// DELETE /api/projects/:projectId/envs/:id
projectRouter.delete(
  '/envs/:id',
  requireProjectAdmin as RequestHandler,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { id } = req.params;

      const existing = await prisma.envConfig.findFirst({
        where: { id, projectId: req.project.id },
      });
      if (!existing) {
        res.status(404).json({ error: 'Environment not found' });
        return;
      }

      await prisma.envConfig.delete({ where: { id } });

      res.status(204).send();
    } catch (err) {
      next(err);
    }
  },
);

// ── Requirement Docs ───────────────────────────────────────────────────────

// GET /api/projects/:projectId/req-docs
projectRouter.get('/req-docs', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const docs = await prisma.requirementDoc.findMany({
      where: { projectId: req.project.id },
      orderBy: { uploadedAt: 'desc' },
    });
    res.json({ docs });
  } catch (err) {
    next(err);
  }
});

// POST /api/projects/:projectId/req-docs — upload a requirement document
projectRouter.post(
  '/req-docs',
  (req: Request, res: Response, next: NextFunction) => {
    upload.single('file')(req, res, (err) => {
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
  async (req: Request, res: Response, next: NextFunction) => {
    const file = req.file;
    if (!file) {
      res.status(400).json({ error: 'No file was uploaded. Use multipart/form-data with field name "file"' });
      return;
    }

    try {
      const doc = await prisma.requirementDoc.create({
        data: {
          projectId: req.project.id,
          filename: file.originalname,
          filePath: file.path,
          fileType: file.mimetype,
          isActive: true,
        },
      });

      res.status(201).json({ doc });
    } catch (err) {
      // Best-effort cleanup of uploaded file if DB insert fails
      try { await fs.promises.unlink(file.path); } catch { /* ignore */ }
      next(err);
    }
  },
);

// PATCH /api/projects/:projectId/req-docs/:id — toggle isActive
projectRouter.patch('/req-docs/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const parsed = ToggleReqDocSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Validation failed', issues: parsed.error.issues });
      return;
    }

    const { id } = req.params;

    const existing = await prisma.requirementDoc.findFirst({
      where: { id, projectId: req.project.id },
    });
    if (!existing) {
      res.status(404).json({ error: 'Requirement document not found' });
      return;
    }

    const doc = await prisma.requirementDoc.update({
      where: { id },
      data: { isActive: parsed.data.isActive },
    });

    res.json({ doc });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/projects/:projectId/req-docs/:id
projectRouter.delete(
  '/req-docs/:id',
  requireProjectAdmin as RequestHandler,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { id } = req.params;

      const doc = await prisma.requirementDoc.findFirst({
        where: { id, projectId: req.project.id },
      });
      if (!doc) {
        res.status(404).json({ error: 'Requirement document not found' });
        return;
      }

      // Delete DB record first
      await prisma.requirementDoc.delete({ where: { id } });

      // Then remove from disk (best-effort — seed/placeholder docs won't be on disk)
      try { await fs.promises.unlink(doc.filePath); } catch { /* ignore */ }

      res.status(204).send();
    } catch (err) {
      next(err);
    }
  },
);

// ── Export project as .qai.zip ────────────────────────────────────────────
projectRouter.get(
  '/export-project',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const project = req.project!;

      // Fetch all TCs for this project
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const testCases = await (prisma.testCase as any).findMany({
        where: { projectId: project.id },
        orderBy: { sortOrder: 'asc' },
      }) as Awaited<ReturnType<typeof prisma.testCase.findMany>>;

      // Fetch all scripts for this project
      const scripts = await prisma.script.findMany({
        where: { projectId: project.id },
      });

      // Build TC-id → tcId lookup for script records
      const idToTcId = new Map(testCases.map((t) => [t.id, t.tcId]));

      const manifest = {
        version: '1',
        exportedAt: new Date().toISOString(),
        project: {
          name: project.name,
          slug: project.slug,
          description: project.description,
          baseUrl: project.baseUrl,
          color: project.color,
        },
        testCases: testCases.map((t) => ({
          tcId: t.tcId,
          title: t.title,
          description: t.description,
          steps: t.steps,
          expectedResult: t.expectedResult,
          type: t.type,
          tags: t.tags,
          useCaseTag: t.useCaseTag,
          status: t.status,
          priority: t.priority,
          sortOrder: (t as any).sortOrder ?? 0,
          prerequisiteTcId: t.prerequisiteTcId ? idToTcId.get(t.prerequisiteTcId) ?? null : null,
        })),
        scripts: scripts.map((s) => ({
          filename: s.filename,
          useCaseFolder: s.useCaseFolder,
          scriptType: s.scriptType,
          isCustomUpload: s.isCustomUpload,
          tcId: s.testCaseId ? (idToTcId.get(s.testCaseId) ?? null) : null,
        })),
      };

      // Get filesystem files as a ZIP buffer
      const filesZipBuf = await exportZip(project.slug);
      const filesZip = await JSZip.loadAsync(filesZipBuf);

      // Build final ZIP
      const zip = new JSZip();
      zip.file('manifest.json', JSON.stringify(manifest, null, 2));

      // Re-add all files/ from the inner zip under files/
      const promises: Promise<void>[] = [];
      filesZip.forEach((relPath, entry) => {
        if (entry.dir) return;
        promises.push(
          entry.async('nodebuffer').then((buf) => {
            zip.file(`files/${relPath}`, buf);
          }),
        );
      });
      await Promise.all(promises);

      const outBuf = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 6 } });

      res.setHeader('Content-Type', 'application/zip');
      res.setHeader('Content-Disposition', `attachment; filename="${project.slug}.qai.zip"`);
      res.end(outBuf);
    } catch (err) {
      next(err);
    }
  },
);

// ── Project import (must be before /:projectId catch-all) ─────────────────
const importUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 500 * 1024 * 1024 } });

router.post(
  '/import-project',
  verifyToken as RequestHandler,
  importUpload.single('file'),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const file = req.file;
      if (!file) { res.status(400).json({ error: 'No file uploaded' }); return; }

      const zip = await JSZip.loadAsync(file.buffer);

      const manifestFile = zip.file('manifest.json');
      if (!manifestFile) { res.status(400).json({ error: 'Invalid .qai.zip: missing manifest.json' }); return; }

      const manifest = JSON.parse(await manifestFile.async('string'));
      if (manifest.version !== '1') { res.status(400).json({ error: 'Unsupported export version' }); return; }

      // Resolve slug conflict
      let slug: string = manifest.project.slug;
      if (await prisma.project.findUnique({ where: { slug } })) {
        let i = 2;
        while (await prisma.project.findUnique({ where: { slug: `${manifest.project.slug}-${i}` } })) i++;
        slug = `${manifest.project.slug}-${i}`;
      }

      // Create project
      const project = await prisma.project.create({
        data: {
          name: manifest.project.name,
          slug,
          description: manifest.project.description ?? '',
          baseUrl: manifest.project.baseUrl ?? '',
          color: manifest.project.color ?? '#22d3ee',
          createdBy: req.user.id,
        },
      });

      // Create TCs (first pass — no prerequisite links yet)
      const tcIdToDbId = new Map<string, string>();
      for (const tc of (manifest.testCases ?? [])) {
        const created = await prisma.testCase.create({
          data: {
            projectId: project.id,
            tcId: tc.tcId,
            title: tc.title,
            description: tc.description ?? null,
            steps: tc.steps ?? '[]',
            expectedResult: tc.expectedResult ?? '',
            type: tc.type ?? 'UI',
            tags: tc.tags ?? '[]',
            useCaseTag: tc.useCaseTag ?? '_uncategorized',
            status: tc.status ?? 'DRAFT',
            priority: tc.priority ?? 'MEDIUM',
            ...(tc.sortOrder !== undefined ? { sortOrder: tc.sortOrder } : {}),
          },
        });
        tcIdToDbId.set(tc.tcId, created.id);
      }

      // Second pass — wire prerequisite links
      for (const tc of (manifest.testCases ?? [])) {
        if (tc.prerequisiteTcId && tcIdToDbId.has(tc.prerequisiteTcId)) {
          await prisma.testCase.update({
            where: { id: tcIdToDbId.get(tc.tcId)! },
            data: { prerequisiteTcId: tcIdToDbId.get(tc.prerequisiteTcId)! },
          });
        }
      }

      // Create scripts
      for (const s of (manifest.scripts ?? [])) {
        await prisma.script.create({
          data: {
            projectId: project.id,
            testCaseId: s.tcId ? (tcIdToDbId.get(s.tcId) ?? null) : null,
            filename: s.filename,
            useCaseFolder: s.useCaseFolder ?? '_uncategorized',
            scriptType: s.scriptType ?? 'ROBOT',
            isCustomUpload: s.isCustomUpload ?? true,
            content: '',
          },
        });
      }

      // Extract project files
      const root = projectRoot(slug);
      fs.mkdirSync(root, { recursive: true });
      const writes: Promise<void>[] = [];
      zip.forEach((relPath, entry) => {
        if (!relPath.startsWith('files/') || entry.dir) return;
        const abs = path.join(root, relPath.slice('files/'.length));
        writes.push(
          entry.async('nodebuffer').then((buf) => {
            fs.mkdirSync(path.dirname(abs), { recursive: true });
            fs.writeFileSync(abs, buf);
          }),
        );
      });
      await Promise.all(writes);

      res.json({ success: true, project: { id: project.id, slug: project.slug, name: project.name } });
    } catch (err) {
      next(err);
    }
  },
);

// ── Mount sub-router ───────────────────────────────────────────────────────
router.use('/:projectId', projectRouter);

export default router;
