import { Router } from 'express';
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

// ── Healing (Stage 7) ─────────────────────────────────────────────────────
router.use('/projects/:projectId/heals', healsRouter);

// ── Reports (Stage 9) ─────────────────────────────────────────────────────
router.use('/projects/:projectId/reports', reportsRouter);

// ── Chat (Stage 10) ───────────────────────────────────────────────────────
router.use('/projects/:projectId/chat', chatRouter);

// ── UI Scanner ────────────────────────────────────────────────────────────
router.use('/projects/:projectId/scans', scansRouter);

// ── Suites ────────────────────────────────────────────────────────────────
router.use('/projects/:projectId/suites', suitesRouter);

// ── Admin / platform-level ────────────────────────────────────────────────
router.use('/admin', adminRouter);

export default router;
