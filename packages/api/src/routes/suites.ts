import { Router, RequestHandler } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { verifyToken } from '../middleware/auth.js';
import { requireProjectAccess } from '../middleware/projectAccess.js';

// ── Zod schemas ────────────────────────────────────────────────────────────

const CreateSuiteSchema = z.object({
  name: z.string().min(1).max(100),
  testCaseIds: z.array(z.string()).min(1),
});

const UpdateSuiteSchema = CreateSuiteSchema.partial();

// ── Router setup ───────────────────────────────────────────────────────────

const router = Router({ mergeParams: true });
router.use(verifyToken as RequestHandler);
router.use(requireProjectAccess as unknown as RequestHandler);

// ── GET /projects/:projectId/suites ────────────────────────────────────────

router.get('/', (async (req, res) => {
  const projectId = req.project.id;
  const suites = await prisma.suite.findMany({
    where: { projectId },
    orderBy: { createdAt: 'asc' },
  });
  res.json({ suites });
}) as RequestHandler);

// ── POST /projects/:projectId/suites ───────────────────────────────────────

router.post('/', (async (req, res) => {
  const projectId = req.project.id;
  const parsed = CreateSuiteSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }
  const { name, testCaseIds } = parsed.data;
  const suite = await prisma.suite.create({
    data: {
      projectId,
      name,
      testCaseIds: JSON.stringify(testCaseIds),
    },
  });
  res.status(201).json({ suite });
}) as RequestHandler);

// ── PUT /projects/:projectId/suites/:suiteId ───────────────────────────────

router.put('/:suiteId', (async (req, res) => {
  const projectId = req.project.id;
  const { suiteId } = req.params;
  const parsed = UpdateSuiteSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }
  const existing = await prisma.suite.findFirst({ where: { id: suiteId, projectId } });
  if (!existing) return res.status(404).json({ error: 'Suite not found' });

  const data: Record<string, unknown> = {};
  if (parsed.data.name !== undefined) data.name = parsed.data.name;
  if (parsed.data.testCaseIds !== undefined) data.testCaseIds = JSON.stringify(parsed.data.testCaseIds);

  const suite = await prisma.suite.update({ where: { id: suiteId }, data });
  res.json({ suite });
}) as RequestHandler);

// ── DELETE /projects/:projectId/suites/:suiteId ────────────────────────────

router.delete('/:suiteId', (async (req, res) => {
  const projectId = req.project.id;
  const { suiteId } = req.params;
  const existing = await prisma.suite.findFirst({ where: { id: suiteId, projectId } });
  if (!existing) return res.status(404).json({ error: 'Suite not found' });
  await prisma.suite.delete({ where: { id: suiteId } });
  res.json({ message: 'Suite deleted' });
}) as RequestHandler);

export default router;
