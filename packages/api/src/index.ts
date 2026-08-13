import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import { createServer } from 'http';
import { Server as SocketIOServer } from 'socket.io';
import jwt from 'jsonwebtoken';
import apiRouter from './routes/index.js';
import { setRunsNamespace, setProjectsNamespace, getLastVnc } from './lib/socket.js';
import { prisma } from './lib/prisma.js';
import { loadSchedules } from './lib/scheduler.js';
import { startRunWorker } from './jobs/runWorker.js';
import { startRunWatchdog } from './jobs/runWatchdog.js';
import { startHealWorker } from './jobs/healWorker.js';
import { startScanWorker } from './jobs/scanWorker.js';
import { startScriptGenWorker } from './jobs/scriptGenWorker.js';
import { startScriptVerifyWorker } from './jobs/scriptVerifyWorker.js';
import { startAgentScanWorker } from './jobs/agentScanWorker.js';
import { startRetentionSchedule } from './jobs/retentionWorker.js';
import { saveSkillFile, deleteSkillFile } from './services/scriptFileService.js';
import { scanAllScriptTags } from './routes/scripts.js';

// Without a listener, Node silently terminates the process on an unhandled
// rejection with only a generic stack trace (or nothing, on older versions) —
// the exact failure mode that left a run's status update ("void prisma.run.update(...)")
// unaccounted for during a prior incident. Log loudly, then exit deliberately so
// Docker's `restart: unless-stopped` policy still recovers the container — this
// only adds visibility, it does not change the crash-and-restart behavior.
process.on('unhandledRejection', (reason) => {
  console.error('[qa-api] FATAL unhandledRejection — process will exit:', reason);
  process.exit(1);
});
process.on('uncaughtException', (err) => {
  console.error('[qa-api] FATAL uncaughtException — process will exit:', err);
  process.exit(1);
});

const app = express();
const httpServer = createServer(app);

const _corsOrigins = (process.env.CORS_ORIGIN ?? 'http://localhost:3000')
  .split(',').map(o => o.trim()).filter(Boolean);
const _corsWildcard = _corsOrigins.includes('*');

function corsOriginFn(incoming: string | undefined, cb: (err: Error | null, allow?: boolean) => void): void {
  if (!incoming) return cb(null, true); // server-to-server
  const ok = _corsWildcard || _corsOrigins.includes(incoming) || incoming.startsWith('chrome-extension://');
  cb(ok ? null : new Error('Not allowed by CORS'), ok);
}

// ── Socket.io ──────────────────────────────────────────────────────────────
const io = new SocketIOServer(httpServer, {
  cors: {
    origin: corsOriginFn,
    methods: ['GET', 'POST'],
    credentials: true,
  },
});

const runsNamespace = io.of('/runs');

// Authenticate every socket connection on the /runs namespace using the JWT
// passed in socket.handshake.auth.token (same token used for REST requests).
runsNamespace.use((socket, next) => {
  const token = socket.handshake.auth['token'] as string | undefined;
  if (!token) return next(new Error('auth:token-required'));
  const secret = process.env.JWT_SECRET;
  if (!secret) return next(new Error('server:misconfiguration'));
  try {
    const decoded = jwt.verify(token, secret) as { id: string; globalRole: string };
    socket.data['userId'] = decoded.id;
    socket.data['globalRole'] = decoded.globalRole;
    next();
  } catch {
    next(new Error('auth:invalid-token'));
  }
});

runsNamespace.on('connection', (socket) => {
  const userId: string = socket.data['userId'];
  const globalRole: string = socket.data['globalRole'];

  socket.on('leaveRun', ({ runId: rid }: { runId: string }) => {
    if (!rid) return;
    void socket.leave(`run:${rid}`);
  });

  socket.on('joinRun', async ({ runId: rid }: { runId: string }) => {
    if (!rid) return;

    // Verify the requesting user has access to this run's project
    try {
      const run = await prisma.run.findUnique({
        where: { id: rid },
        select: { projectId: true, status: true, results: { select: { status: true } } },
      });
      if (!run) return;

      if (globalRole !== 'SUPER_ADMIN') {
        const member = await prisma.projectMember.findFirst({
          where: { projectId: run.projectId, userId },
        });
        if (!member) {
          socket.emit('run:error', 'Access denied');
          return;
        }
      }

      void socket.join(`run:${rid}`);

      // Catch up the client if it joined after early events were already emitted
      if (run.status === 'RUNNING') {
        socket.emit('run:start', { total: run.results.length });
        const lastVnc = getLastVnc(rid);
        if (lastVnc) socket.emit('run:vnc', lastVnc);
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

// Require a valid JWT on every /projects connection, same as /runs.
projectsNamespace.use((socket, next) => {
  const token = socket.handshake.auth['token'] as string | undefined;
  if (!token) return next(new Error('auth:token-required'));
  const secret = process.env.JWT_SECRET;
  if (!secret) return next(new Error('server:misconfiguration'));
  try {
    const decoded = jwt.verify(token, secret) as { id: string; globalRole: string };
    socket.data['userId'] = decoded.id;
    socket.data['globalRole'] = decoded.globalRole;
    next();
  } catch {
    next(new Error('auth:invalid-token'));
  }
});

projectsNamespace.on('connection', (socket) => {
  const userId: string = socket.data['userId'];
  const globalRole: string = socket.data['globalRole'];

  const joinProjectRoom = async (pid: string) => {
    if (!pid) return;
    // SUPER_ADMIN may join any project room; others must be a member.
    if (globalRole !== 'SUPER_ADMIN') {
      const member = await prisma.projectMember.findFirst({
        where: { projectId: pid, userId },
      });
      if (!member) {
        socket.emit('project:error', 'Access denied');
        return;
      }
    }
    void socket.join(`project:${pid}`);
  };

  const projectId = socket.handshake.query['projectId'] as string | undefined;
  if (projectId) void joinProjectRoom(projectId);

  socket.on('joinProject', ({ projectId: pid }: { projectId: string }) => {
    void joinProjectRoom(pid);
  });
});

setProjectsNamespace(projectsNamespace);

// ── Middleware ─────────────────────────────────────────────────────────────
app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));

app.use(
  cors({
    origin: corsOriginFn,
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

// ── App config (public — no auth required) ────────────────────────────────
app.get('/api/app-config', (_req, res) => {
  res.json({
    mode: process.env.APP_MODE === 'runner' ? 'runner' : 'full',
    novncPort: Number(process.env.NOVNC_HOST_PORT) || 6180,
    maxVncSessions: Number(process.env.MAX_VNC_SESSIONS) || 6,
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
    // CORS rejections come through as Error('Not allowed by CORS') from corsOriginFn.
    // Return 403 (not 500) so the client and logs correctly identify the cause.
    if (err.message === 'Not allowed by CORS') {
      res.status(403).json({ error: 'Forbidden', message: 'Origin not allowed by CORS policy' });
      return;
    }
    console.error('[qa-api] Unhandled error:', err.stack ?? err.message);
    res.status(500).json({
      error: 'Internal server error',
      message: process.env.NODE_ENV === 'development' ? err.message : undefined,
    });
  },
);

// ── Startup config validation ──────────────────────────────────────────────
// Log a clear warning when CORS_ORIGIN is not set or looks like it won't match
// the actual browser origin — catches this common misconfiguration at boot rather
// than at the first browser request (which would surface as a mysterious 403).
{
  const appUrl   = process.env.APP_URL?.trim();
  const corsOrig = process.env.CORS_ORIGIN?.trim();
  if (!corsOrig) {
    console.warn('[qa-api] WARNING: CORS_ORIGIN is not set — defaulting to http://localhost:3000. Set CORS_ORIGIN to your external https origin in production.');
  } else if (appUrl && corsOrig !== '*' && !corsOrig.split(',').map(o => o.trim()).includes(appUrl)) {
    console.warn(`[qa-api] WARNING: CORS_ORIGIN ("${corsOrig}") does not include APP_URL ("${appUrl}"). Browser requests from APP_URL will be rejected with 403.`);
  }
}

// ── Start ──────────────────────────────────────────────────────────────────
const PORT = parseInt(process.env.PORT ?? '4000', 10);

httpServer.listen(PORT, () => {
  console.log(`[qa-api] Server running  → http://0.0.0.0:${PORT}`);
  console.log(`[qa-api] Environment     → ${process.env.NODE_ENV ?? 'development'}`);
  console.log(`[qa-api] Socket.io       → /runs namespace ready`);

  // Sync all active DB skills to disk so the script agent can read them as files.
  // Idempotent — running again just overwrites with the current DB state.
  async function syncSkillFiles(): Promise<void> {
    try {
      const projects = await prisma.project.findMany({ select: { id: true, slug: true } });
      let total = 0;
      for (const p of projects) {
        const skills = await prisma.projectSkill.findMany({ where: { projectId: p.id } });
        for (const s of skills) {
          if (s.isActive) {
            saveSkillFile(p.slug, s.id, {
              id: s.id, skillType: s.skillType, name: s.name, scope: s.scope,
              content: s.content, confidence: s.confidence, captureMethod: s.captureMethod,
              isActive: s.isActive, updatedAt: s.updatedAt.toISOString(),
            });
            total++;
          } else {
            deleteSkillFile(p.slug, s.id);
          }
        }
      }
      console.log(`[qa-api] Skill file sync: ${total} active skill(s) written to disk`);
    } catch (err) {
      console.warn('[qa-api] Skill file sync failed (non-fatal):', (err as Error).message);
    }
  }

  // Cancel any run left in PENDING/RUNNING from before this boot, BEFORE workers
  // attach. The BullMQ worker that was tracking it lived in the previous process —
  // it's gone, so the run can never reach a terminal status on its own and would
  // otherwise sit "RUNNING" in the UI forever (and stalled BullMQ jobs need to see
  // a terminal status to exit instead of re-executing, e.g. the healing loop).
  void (async () => {
    try {
      if (process.env.FORCE_CANCEL_RUNS === 'true') {
        // Emergency reset: cancel ALL active runs so they can be restarted manually.
        // Set FORCE_CANCEL_RUNS=true in docker-compose or the startup command when
        // stale runs have piled up and need a clean slate. Remove the flag afterwards.
        const forceCleaned = await prisma.run.updateMany({
          where: { status: { in: ['PENDING', 'RUNNING'] } },
          data: { status: 'CANCELLED', completedAt: new Date() },
        });
        if (forceCleaned.count > 0) {
          console.log(`[qa-api] FORCE_CANCEL_RUNS=true: cancelled ${forceCleaned.count} run(s) — remove this flag after restart`);
        }
      } else {
        // Normal restart: cancel only PENDING runs (never started; BullMQ jobs gone).
        // RUNNING runs are left as RUNNING — BullMQ stall detection re-queues them
        // after ~30 s and the worker resume logic skips already-completed TCs.
        const pendingCleaned = await prisma.run.updateMany({
          where: { status: 'PENDING' },
          data: { status: 'CANCELLED', completedAt: new Date() },
        });
        if (pendingCleaned.count > 0) {
          console.log(`[qa-api] Startup cleanup: cancelled ${pendingCleaned.count} pending run(s); active runs will resume via BullMQ stall retry`);
        }
      }
    } catch (err) {
      console.warn('[qa-api] Startup cleanup failed (non-fatal):', (err as Error).message);
    }

    // Ensure at least one SUPER_ADMIN exists — if none, promote the oldest user.
    // Guards against fresh deployments where the first user registered before the
    // userCount=0 check could fire (e.g. two users registered simultaneously).
    try {
      const superAdminCount = await prisma.user.count({ where: { globalRole: 'SUPER_ADMIN' } });
      if (superAdminCount === 0) {
        const oldest = await prisma.user.findFirst({ orderBy: { createdAt: 'asc' } });
        if (oldest) {
          await prisma.user.update({ where: { id: oldest.id }, data: { globalRole: 'SUPER_ADMIN' } });
          console.log(`[qa-api] No SUPER_ADMIN found — promoted ${oldest.email} on startup`);
        }
      }
    } catch (err) {
      console.warn('[qa-api] Super-admin check failed (non-fatal):', (err as Error).message);
    }

    // Sync skill files to disk before workers start (they read skills from files)
    await syncSkillFiles();

    // Auto-link TCs to scripts via [Tags] for any project not yet linked
    void (async () => {
      try {
        const projects = await prisma.project.findMany({ select: { id: true } });
        let total = 0;
        for (const p of projects) total += await scanAllScriptTags(p.id);
        if (total > 0) console.log(`[qa-api] Tag auto-link: ${total} TC(s) linked via [Tags] on startup`);
      } catch (err) {
        console.warn('[qa-api] Tag auto-link failed (non-fatal):', (err as Error).message);
      }
    })();

    // Start BullMQ workers only after cleanup so they see the cancelled state
    if (process.env.REDIS_URL || process.env.NODE_ENV !== 'test') {
      try {
        startRunWorker();
        startRunWatchdog();
        if (process.env.APP_MODE !== 'runner') {
          startHealWorker();
          startScanWorker();
          startScriptGenWorker();
          startScriptVerifyWorker();
          startAgentScanWorker();
        }
      } catch (err) {
        console.warn('[qa-api] Workers failed to start (Redis may be unavailable):', (err as Error).message);
      }
    }

    // Load saved schedules from DB
    void loadSchedules();

    // Start nightly data-retention sweep
    startRetentionSchedule();
  })();
});
