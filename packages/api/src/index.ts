import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import { createServer } from 'http';
import { Server as SocketIOServer } from 'socket.io';
import apiRouter from './routes/index.js';
import { setRunsNamespace } from './lib/socket.js';
import { loadSchedules } from './lib/scheduler.js';
import { startRunWorker } from './jobs/runWorker.js';

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
  socket.on('joinRun', ({ runId: rid }: { runId: string }) => {
    if (rid) void socket.join(`run:${rid}`);
  });
});

// Register namespace so workers can emit without circular imports
setRunsNamespace(runsNamespace);

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
    } catch (err) {
      console.warn('[qa-api] Run worker failed to start (Redis may be unavailable):', (err as Error).message);
    }
  }

  // Load saved schedules from DB
  void loadSchedules();
});
