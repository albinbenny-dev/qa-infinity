import { Router, Request, Response } from 'express';
import projectsRouter from './projects.js';
import authRouter from './auth.js';
import testCasesRouter from './testCases.js';
import uploadsRouter from './uploads.js';
import scriptsRouter from './scripts.js';
import runsRouter from './runs.js';

const router = Router();

// ── Mounted routers ────────────────────────────────────────────────────────
router.use('/projects', projectsRouter);
router.use('/auth', authRouter);
router.use('/upload', uploadsRouter);

// ── Test Cases (Stage 4) ───────────────────────────────────────────────────
router.use('/projects/:projectId/test-cases', testCasesRouter);

// ── Scripts (Stage 6) ─────────────────────────────────────────────────────
router.use('/projects/:projectId/scripts', scriptsRouter);

// ── Runs (Stage 5) ────────────────────────────────────────────────────────
router.use('/projects/:projectId/runs', runsRouter);

// ── Healing (Stage 6) ─────────────────────────────────────────────────────
router.use('/projects/:projectId/heals', (_req: Request, res: Response) => {
  res.status(501).json({ error: 'Heal routes not yet implemented' });
});

// ── Reports (Stage 7) ─────────────────────────────────────────────────────
router.use('/projects/:projectId/reports', (_req: Request, res: Response) => {
  res.status(501).json({ error: 'Report routes not yet implemented' });
});

// ── Chat (Stage 8) ────────────────────────────────────────────────────────
router.use('/projects/:projectId/chat', (_req: Request, res: Response) => {
  res.status(501).json({ error: 'Chat routes not yet implemented' });
});

export default router;
