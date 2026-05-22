import { Router, Request, Response, NextFunction, RequestHandler } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { prisma } from '../lib/prisma.js';
import { verifyToken } from '../middleware/auth.js';
import { requireProjectAccess } from '../middleware/projectAccess.js';
import {
  CreateProjectSchema,
  UpdateProjectSchema,
  DeleteProjectSchema,
  CreateMemberSchema,
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

// ── Environments ───────────────────────────────────────────────────────────

// GET /api/projects/:projectId/envs
projectRouter.get('/envs', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const envs = await prisma.envConfig.findMany({
      where: { projectId: req.project.id },
      orderBy: [{ isDefault: 'desc' }, { name: 'asc' }],
    });
    res.json({ envs });
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

      const { name, baseUrl, isDefault } = parsed.data;

      // If new env is default, clear other defaults first
      if (isDefault) {
        await prisma.envConfig.updateMany({
          where: { projectId: req.project.id, isDefault: true },
          data: { isDefault: false },
        });
      }

      const env = await prisma.envConfig.create({
        data: { projectId: req.project.id, name, baseUrl, isDefault: isDefault ?? false },
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

// ── Mount sub-router ───────────────────────────────────────────────────────
router.use('/:projectId', projectRouter);

export default router;
