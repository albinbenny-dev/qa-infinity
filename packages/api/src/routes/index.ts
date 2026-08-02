import { Router, Request, Response, NextFunction, RequestHandler } from 'express';
import projectsRouter from './projects.js';
import authRouter from './auth.js';
import testCasesRouter from './testCases.js';
import uploadsRouter from './uploads.js';
import scriptsRouter from './scripts.js';
import runsRouter from './runs.js';
import healsRouter from './heals.js';
import reportsRouter from './reports.js';
import chatRouter from './chat.js';
import scansRouter from './scans.js';
import suitesRouter from './suites.js';
import adminRouter from './admin.js';
import resourcesRouter from './resources.js';
import skillsRouter from './skills.js';
import locatorsRouter from './locators.js';
import extensionRouter from './extension.js';
import { verifyToken } from '../middleware/auth.js';
import { requireFullMode } from '../middleware/requireFullMode.js';

const router = Router();

// ── Global JWT guard — all routes except /api/auth/* ──────────────────────
// Individual routers that already call verifyToken will get a no-op second
// pass (token is still valid), so this is safe to add globally.
router.use((req: Request, res: Response, next: NextFunction) => {
  if (req.path.startsWith('/auth/')) return next();
  return (verifyToken as RequestHandler)(req, res, next);
});

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

// ── Healing (Stage 7) — AI only ───────────────────────────────────────────
router.use('/projects/:projectId/heals', requireFullMode, healsRouter);

// ── Reports (Stage 9) ─────────────────────────────────────────────────────
router.use('/projects/:projectId/reports', reportsRouter);

// ── Chat (Stage 10) — AI only ─────────────────────────────────────────────
router.use('/projects/:projectId/chat', requireFullMode, chatRouter);

// ── UI Scanner — AI only ──────────────────────────────────────────────────
router.use('/projects/:projectId/scans', requireFullMode, scansRouter);

// ── Suites ────────────────────────────────────────────────────────────────
router.use('/projects/:projectId/suites', suitesRouter);

// ── Admin / platform-level ────────────────────────────────────────────────
router.use('/admin', adminRouter);

// ── Robot Framework resources ─────────────────────────────────────────────
router.use('/projects/:projectId/resources', resourcesRouter);

// ── Product Skills — AI only ──────────────────────────────────────────────
router.use('/projects/:projectId/skills', requireFullMode, skillsRouter);

// ── Object/Locator Repository ──────────────────────────────────────────────
router.use('/projects/:projectId/locators', locatorsRouter);

// ── Chrome Extension download ─────────────────────────────────────────────
router.use('/extension', extensionRouter);

export default router;
