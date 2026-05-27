import { Router, Request, Response, NextFunction, RequestHandler } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { verifyToken } from '../middleware/auth.js';
import { requireProjectAccess } from '../middleware/projectAccess.js';
import { runChatAgent } from '../agents/chatAgent.js';
import type { ChatAttachment } from '../agents/chatAgent.js';

const router = Router({ mergeParams: true });
router.use(verifyToken as RequestHandler);
router.use(requireProjectAccess as unknown as RequestHandler);

// ── Zod schemas ────────────────────────────────────────────────────────────

const AttachmentSchema = z.object({
  name: z.string(),
  mimeType: z.string(),
  data: z.string(), // base64
});

const SendMessageSchema = z.object({
  message: z.string().min(1).max(4000),
  conversationId: z.string().optional(),
  attachments: z.array(AttachmentSchema).max(5).optional(),
});

const AddMemorySchema = z.object({
  content: z.string().min(1).max(500),
});

// ── Helpers ────────────────────────────────────────────────────────────────

function wrap(fn: (req: Request, res: Response, next: NextFunction) => Promise<void>): RequestHandler {
  return (req, res, next) => fn(req, res, next).catch(next);
}

// ── POST /chat/message ─────────────────────────────────────────────────────

router.post('/message', wrap(async (req, res) => {
  const parsed = SendMessageSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Validation failed', issues: parsed.error.issues });
    return;
  }

  const { message, conversationId, attachments } = parsed.data;
  const projectId = req.project.id;
  const convId = conversationId ?? `conv-${Date.now()}`;

  // Persist user message (store attachment metadata only, not binary data)
  const attachmentMeta = attachments?.map(a => ({ name: a.name, mimeType: a.mimeType })) ?? [];
  const userMsg = await prisma.chatMessage.create({
    data: {
      projectId,
      conversationId: convId,
      role: 'user',
      content: message,
      attachments: attachmentMeta.length > 0 ? JSON.stringify(attachmentMeta) : null,
    },
  });

  // Fetch recent history for context
  const history = await prisma.chatMessage.findMany({
    where: { projectId, conversationId: convId, id: { not: userMsg.id } },
    orderBy: { createdAt: 'asc' },
    take: 20,
    select: { role: true, content: true },
  });

  // Fetch project memories
  const memoryRows = await prisma.chatMemory.findMany({
    where: { projectId },
    orderBy: { createdAt: 'asc' },
    select: { content: true },
  });
  const memories = memoryRows.map(m => m.content);

  // Run agent
  let agentResult: { reply: string; actionType?: string; actionPayload?: Record<string, unknown> };
  try {
    agentResult = await runChatAgent(
      projectId,
      message,
      history as Array<{ role: 'user' | 'assistant'; content: string }>,
      memories,
      (attachments ?? []) as ChatAttachment[],
    );
  } catch (err) {
    console.error('[ChatAgent] Error:', err);
    agentResult = { reply: 'I encountered an error processing your request. Please try again.' };
  }

  // Persist assistant reply
  const assistantMsg = await prisma.chatMessage.create({
    data: {
      projectId,
      conversationId: convId,
      role: 'assistant',
      content: agentResult.reply,
      actionType: agentResult.actionType ?? null,
      actionPayload: agentResult.actionPayload ? JSON.stringify(agentResult.actionPayload) : null,
    },
  });

  res.json({ conversationId: convId, userMessage: userMsg, assistantMessage: assistantMsg });
}));

// ── GET /chat/history ──────────────────────────────────────────────────────

router.get('/history', wrap(async (req, res) => {
  const conversationId = req.query['conversationId'] as string | undefined;
  const projectId = req.project.id;

  const messages = await prisma.chatMessage.findMany({
    where: { projectId, ...(conversationId ? { conversationId } : {}) },
    orderBy: { createdAt: 'asc' },
    take: 100,
  });

  res.json({ messages });
}));

// ── DELETE /chat/history ───────────────────────────────────────────────────

router.delete('/history', wrap(async (req, res) => {
  const conversationId = req.query['conversationId'] as string | undefined;
  const projectId = req.project.id;

  await prisma.chatMessage.deleteMany({
    where: { projectId, ...(conversationId ? { conversationId } : {}) },
  });

  res.json({ message: 'History cleared' });
}));

// ── GET /chat/memory ───────────────────────────────────────────────────────

router.get('/memory', wrap(async (req, res) => {
  const memories = await prisma.chatMemory.findMany({
    where: { projectId: req.project.id },
    orderBy: { createdAt: 'asc' },
  });
  res.json({ memories });
}));

// ── POST /chat/memory ──────────────────────────────────────────────────────

router.post('/memory', wrap(async (req, res) => {
  const parsed = AddMemorySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Validation failed', issues: parsed.error.issues });
    return;
  }

  const memory = await prisma.chatMemory.create({
    data: { projectId: req.project.id, content: parsed.data.content },
  });
  res.status(201).json({ memory });
}));

// ── DELETE /chat/memory/:memoryId ──────────────────────────────────────────

router.delete('/memory/:memoryId', wrap(async (req, res) => {
  const { memoryId } = req.params;
  await prisma.chatMemory.deleteMany({
    where: { id: memoryId, projectId: req.project.id },
  });
  res.json({ message: 'Memory deleted' });
}));

export default router;
