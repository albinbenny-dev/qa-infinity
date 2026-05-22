import { Router, Request, Response } from 'express';
import projectsRouter from './projects.js';

const router = Router();

// ── Mounted routers ────────────────────────────────────────────────────────
router.use('/projects', projectsRouter);

// ── Auth (Stage 3) ─────────────────────────────────────────────────────────
router.use('/auth', (_req: Request, res: Response) => {
  res.status(501).json({ error: 'Auth routes not yet implemented — coming in Stage 3' });
});

// ── Test Cases (Stage 4) ───────────────────────────────────────────────────
router.use('/projects/:projectId/test-cases', (_req: Request, res: Response) => {
  res.status(501).json({ error: 'Test case routes not yet implemented' });
});

// ── Scripts (Stage 5) ─────────────────────────────────────────────────────
router.use('/projects/:projectId/scripts', (_req: Request, res: Response) => {
  res.status(501).json({ error: 'Script routes not yet implemented' });
});

// ── Runs (Stage 5) ────────────────────────────────────────────────────────
router.use('/projects/:projectId/runs', (_req: Request, res: Response) => {
  res.status(501).json({ error: 'Run routes not yet implemented' });
});

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
