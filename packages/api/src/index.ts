import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import { createServer } from 'http';
import { Server as SocketIOServer } from 'socket.io';
import apiRouter from './routes/index.js';
import { setRunsNamespace, setProjectsNamespace } from './lib/socket.js';
import { prisma } from './lib/prisma.js';
import { loadSchedules } from './lib/scheduler.js';
import { startRunWorker } from './jobs/runWorker.js';
import { startHealWorker } from './jobs/healWorker.js';
import { startScanWorker } from './jobs/scanWorker.js';
import { startScriptGenWorker } from './jobs/scriptGenWorker.js';
import { startScriptVerifyWorker } from './jobs/scriptVerifyWorker.js';

const app = express();
const httpServer = createServer(app);

// ── Socket.io ──────────────────────────────────────────────────────────────
const io = new SocketIOServer(httpServer, {
  cors: {
    origin: process.env.CORS_ORIGIN ?? 'http://localhost:3000',
    methods: ['GET', 'POST'],
    credentials: true,
  },
});

const runsNamespace = io.of('/runs');

runsNamespace.on('connection', (socket) => {
  const runId = socket.handshake.query['runId'] as string | undefined;
  if (runId) {
    void socket.join(`run:${runId}`);
  }
  socket.on('joinRun', async ({ runId: rid }: { runId: string }) => {
    if (!rid) return;
    void socket.join(`run:${rid}`);
    // Catch up the client if it joined after early events were already emitted
    try {
      const run = await prisma.run.findUnique({
        where: { id: rid },
        select: { status: true, results: { select: { status: true } } },
      });
      if (!run) return;
      if (run.status === 'RUNNING') {
        socket.emit('run:start', { total: run.results.length });
      } else if (run.status === 'PASSED' || run.status === 'FAILED' || run.status === 'CANCELLED') {
        const passed  = run.results.filter((r) => r.status === 'PASSED').length;
        const failed  = run.results.filter((r) => r.status === 'FAILED').length;
        const skipped = run.results.filter((r) => r.status === 'SKIPPED').length;
        socket.emit('run:complete', { passed, failed, skipped, duration: 0 });
      }
    } catch { /* run may not exist yet — ignore */ }
  });
});

// Register namespace so workers can emit without circular imports
setRunsNamespace(runsNamespace);

// ── /projects namespace — per-project events (e.g. script generation jobs) ──
const projectsNamespace = io.of('/projects');

projectsNamespace.on('connection', (socket) => {
  const projectId = socket.handshake.query['projectId'] as string | undefined;
  if (projectId) {
    void socket.join(`project:${projectId}`);
  }
  socket.on('joinProject', ({ projectId: pid }: { projectId: string }) => {
    if (pid) void socket.join(`project:${pid}`);
  });
});

setProjectsNamespace(projectsNamespace);

// ── Middleware ─────────────────────────────────────────────────────────────
app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));

app.use(
  cors({
    origin: process.env.CORS_ORIGIN ?? 'http://localhost:3000',
    credentials: true,
  }),
);

app.use(morgan('dev'));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// ── Health check ───────────────────────────────────────────────────────────
app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    version: '1.0.0',
    timestamp: new Date(),
    uptime: process.uptime(),
  });
});

// ── API routes ─────────────────────────────────────────────────────────────
app.use('/api', apiRouter);

// ── 404 handler ────────────────────────────────────────────────────────────
app.use((_req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// ── Global error handler ───────────────────────────────────────────────────
app.use(
  (
    err: Error,
    _req: express.Request,
    res: express.Response,
    _next: express.NextFunction,
  ) => {
    console.error('[qa-api] Unhandled error:', err.stack ?? err.message);
    res.status(500).json({
      error: 'Internal server error',
      message: process.env.NODE_ENV === 'development' ? err.message : undefined,
    });
  },
);

// ── Start ──────────────────────────────────────────────────────────────────
const PORT = parseInt(process.env.PORT ?? '4000', 10);

httpServer.listen(PORT, () => {
  console.log(`[qa-api] Server running  → http://0.0.0.0:${PORT}`);
  console.log(`[qa-api] Environment     → ${process.env.NODE_ENV ?? 'development'}`);
  console.log(`[qa-api] Socket.io       → /runs namespace ready`);

  // Start BullMQ worker only if Redis is configured
  if (process.env.REDIS_URL || process.env.NODE_ENV !== 'test') {
    try {
      startRunWorker();
      startHealWorker();
      startScanWorker();
      startScriptGenWorker();
      startScriptVerifyWorker();
    } catch (err) {
      console.warn('[qa-api] Workers failed to start (Redis may be unavailable):', (err as Error).message);
    }
  }

  // Load saved schedules from DB
  void loadSchedules();
});
