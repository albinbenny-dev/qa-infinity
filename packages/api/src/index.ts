import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import { createServer } from 'http';
import { Server as SocketIOServer } from 'socket.io';

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
    socket.join(`run:${runId}`);
  }

  socket.on('disconnect', () => {
    // cleanup handled automatically by socket.io
  });
});

export { runsNamespace };

// ── Middleware ─────────────────────────────────────────────────────────────
app.use(helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' },
}));

app.use(cors({
  origin: process.env.CORS_ORIGIN ?? 'http://localhost:3000',
  credentials: true,
}));

app.use(morgan('dev'));

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// ── Health check ───────────────────────────────────────────────────────────
app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    version: '1.0.0',
    timestamp: new Date(),
  });
});

// ── Route mounts ───────────────────────────────────────────────────────────
// Placeholder — full routers wired in subsequent stages
app.use('/api/auth', (_req, res) => {
  res.status(501).json({ error: 'Auth routes not yet implemented' });
});

app.use('/api/projects', (_req, res) => {
  res.status(501).json({ error: 'Project routes not yet implemented' });
});

// ── 404 handler ────────────────────────────────────────────────────────────
app.use((_req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// ── Global error handler ───────────────────────────────────────────────────
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Internal server error', message: err.message });
});

// ── Start ──────────────────────────────────────────────────────────────────
const PORT = parseInt(process.env.PORT ?? '4000', 10);

httpServer.listen(PORT, () => {
  console.log(`[qa-api] Server running on http://0.0.0.0:${PORT}`);
  console.log(`[qa-api] Environment: ${process.env.NODE_ENV ?? 'development'}`);
});
