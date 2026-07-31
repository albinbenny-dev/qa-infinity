'use strict';

const http = require('http');
const net  = require('net');
const { spawn, execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const PORT = 5001;
const SCRIPTS_DIR = '/scripts';
const CONFIG_FILE = 'qa-infinity.playwright.config.js';
const CONFIG_PATH = path.join(SCRIPTS_DIR, CONFIG_FILE);

// ── noVNC / live-browser-view constants ────────────────────────────────────
// Two VNC slots are started at boot. Each slot has its own Xvfb display and
// x11vnc instance. A single websockify with TokenFile routing multiplexes both
// onto port 6080. Each host-browser or recording session claims one slot and
// gets a short-lived token; the noVNC client connects with that token so
// sessions are isolated (max 2 concurrent viewers).
const VNC_SLOTS = [
  { display: ':99',  vncPort: 5900 },
  { display: ':100', vncPort: 5901 },
];
const VNC_DISPLAY    = VNC_SLOTS[0].display; // legacy alias
const NOVNC_PORT     = 6080;
const NOVNC_WEB_DIR  = '/usr/share/novnc';
const VNC_TOKEN_FILE = '/tmp/vnc-tokens.cfg';

// Active VNC sessions: Map<token, slotIndex>
const vncSessions = new Map();

function writeVncTokenFile() {
  const lines = [];
  for (const [token, slotIdx] of vncSessions) {
    lines.push(`${token}: localhost:${VNC_SLOTS[slotIdx].vncPort}`);
  }
  try { fs.writeFileSync(VNC_TOKEN_FILE, lines.join('\n') + (lines.length ? '\n' : ''), 'utf8'); } catch {}
}

function claimVncSlot() {
  const usedSlots = new Set(vncSessions.values());
  for (let i = 0; i < VNC_SLOTS.length; i++) {
    if (!usedSlots.has(i)) {
      const token = Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
      vncSessions.set(token, i);
      writeVncTokenFile();
      return { token, slotIndex: i, display: VNC_SLOTS[i].display };
    }
  }
  return null;
}

function releaseVncSlot(token) {
  if (vncSessions.delete(token)) writeVncTokenFile();
}

// Poll a TCP port until something is listening, then call onReady.
// Uses only Node's built-in 'net' module — no external binaries needed.
function waitForPort(port, onReady) {
  const attempt = () => {
    const sock = new net.Socket();
    sock.setTimeout(600);
    sock.on('connect', () => { sock.destroy(); onReady(); });
    sock.on('error',   () => { setTimeout(attempt, 800); });
    sock.on('timeout', () => { sock.destroy(); setTimeout(attempt, 800); });
    sock.connect(port, '127.0.0.1');
  };
  attempt();
}

// One-shot port check — resolves true if something is listening, false if not.
function checkPort(port) {
  return new Promise((resolve) => {
    const sock = new net.Socket();
    sock.setTimeout(500);
    sock.on('connect', () => { sock.destroy(); resolve(true); });
    sock.on('error',   () => resolve(false));
    sock.on('timeout', () => { sock.destroy(); resolve(false); });
    sock.connect(port, '127.0.0.1');
  });
}

// Find a free TCP port on localhost. Used to give each concurrent RF Browser
// process its own isolated rfbrowser-node gRPC port so concurrent runs on the
// same container don't compete for the same port.
function findFreePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
    srv.on('error', reject);
  });
}

// Spawn a process and pipe its stdout/stderr into the container logs so
// every VNC-stack failure shows up in `docker-compose logs qa-runner`.
// Spawn with logging; accepts optional spawn opts (e.g. { env: {...} }).
function spawnLogged(cmd, args, opts = {}) {
  const p = spawn(cmd, args, { ...opts, stdio: ['ignore', 'pipe', 'pipe'] });
  p.stdout.on('data', (d) => process.stdout.write(`[${cmd}] ${d}`));
  p.stderr.on('data', (d) => process.stdout.write(`[${cmd}] ${d}`));
  p.on('exit',  (code) => { if (code) console.error(`[${cmd}] exited with code ${code}`); });
  p.on('error', (err)  => console.error(`[${cmd}] spawn error: ${err.message}`));
  return p;
}

// Test whether the Xvfb Unix socket at /tmp/.X11-unix/X<n> is backed by a
// live X server. After a `docker restart` the socket file survives but the
// Xvfb process is gone; a plain fs.existsSync check would falsely skip startup.
function isXvfbSocketAlive(display) {
  return new Promise((resolve) => {
    const num = display.replace(':', '');
    const socketPath = `/tmp/.X11-unix/X${num}`;
    if (!fs.existsSync(socketPath)) { resolve(false); return; }
    const sock = new net.Socket();
    sock.setTimeout(400);
    sock.on('connect', () => { sock.destroy(); resolve(true); });
    sock.on('error',   () => resolve(false));
    sock.on('timeout', () => { sock.destroy(); resolve(false); });
    sock.connect(socketPath);
  });
}

// Poll until Xvfb's Unix socket exists — works without any external binary.
// Xvfb writes /tmp/.X11-unix/X<n> as soon as it is ready for X11 clients.
function waitForXvfb(display, onReady) {
  const num    = display.replace(':', '');
  const socket = `/tmp/.X11-unix/X${num}`;
  const poll   = () => {
    if (fs.existsSync(socket)) {
      console.log(`[qa-runner] Xvfb socket ready: ${socket}`);
      onReady();
    } else {
      setTimeout(poll, 300);
    }
  };
  poll();
}

// Idempotent VNC stack startup — safe to call on every server boot.
// Starts both VNC slots (Xvfb + x11vnc each) and one websockify with
// TokenFile routing so sessions are isolated by token.
async function startVncStack() {
  console.log(`[qa-runner] Starting VNC stack — ${VNC_SLOTS.length} slots`);

  for (const slot of VNC_SLOTS) {
    const { display, vncPort } = slot;
    const displayNum = display.replace(':', '');
    const xvfbSocket = `/tmp/.X11-unix/X${displayNum}`;
    const xvfbLock   = `/tmp/.X${displayNum}-lock`;

    const xvfbLive = await isXvfbSocketAlive(display);
    if (xvfbLive) {
      console.log(`[qa-runner] Xvfb already running on ${display} — skipping`);
    } else {
      if (fs.existsSync(xvfbSocket)) {
        try { fs.unlinkSync(xvfbSocket); } catch {}
      }
      if (fs.existsSync(xvfbLock)) {
        try { fs.unlinkSync(xvfbLock); } catch {}
      }
      console.log(`[qa-runner] Starting Xvfb on ${display}`);
      spawnLogged('Xvfb', [display, '-screen', '0', '1600x900x24', '-ac']);
      await new Promise((resolve) => waitForXvfb(display, resolve));
    }

    const vncAlive = await checkPort(vncPort);
    if (vncAlive) {
      console.log(`[qa-runner] x11vnc already on :${vncPort} — skipping`);
    } else {
      console.log(`[qa-runner] Starting x11vnc on :${vncPort} for ${display}`);
      spawnLogged('x11vnc', [
        '-display', display,
        '-nopw',
        '-listen', 'localhost',
        '-rfbport', String(vncPort),
        '-forever',
        '-shared',
        '-noxdamage',
        '-noshm',
      ]);
      await new Promise((resolve) => waitForPort(vncPort, resolve));
      console.log(`[qa-runner] x11vnc up on :${vncPort}`);
    }
  }

  // Single websockify with TokenFile routing — routes by ?token= query param
  const wsAlive = await checkPort(NOVNC_PORT);
  if (wsAlive) {
    console.log(`[qa-runner] websockify already on :${NOVNC_PORT} — skipping`);
  } else {
    if (!fs.existsSync(NOVNC_WEB_DIR)) {
      console.error(`[qa-runner] noVNC web dir not found at ${NOVNC_WEB_DIR}`);
      return;
    }
    writeVncTokenFile(); // create empty token file before websockify starts
    console.log('[qa-runner] Starting websockify with TokenFile routing');
    spawnLogged('/usr/bin/python3', [
      '-m', 'websockify',
      '--web', NOVNC_WEB_DIR,
      '--heartbeat=30',
      '--token-plugin=TokenFile',
      `--token-source=${VNC_TOKEN_FILE}`,
      `0.0.0.0:${NOVNC_PORT}`,
    ]);
  }

  console.log(`[qa-runner] VNC ready — ${VNC_SLOTS.length} isolated sessions available on :${NOVNC_PORT}`);

  // Watchdog: restart any dead x11vnc or websockify every 20 s
  setInterval(async () => {
    try {
      for (const slot of VNC_SLOTS) {
        const vncOk = await checkPort(slot.vncPort);
        if (!vncOk) {
          console.log(`[qa-runner] [watchdog] x11vnc down on :${slot.vncPort} — restarting`);
          spawnLogged('x11vnc', [
            '-display', slot.display,
            '-nopw',
            '-listen', 'localhost',
            '-rfbport', String(slot.vncPort),
            '-forever',
            '-shared',
            '-noxdamage',
            '-noshm',
          ]);
          await new Promise((resolve) => waitForPort(slot.vncPort, resolve));
          console.log(`[qa-runner] [watchdog] x11vnc restarted on :${slot.vncPort}`);
        }
      }
      const wsOk = await checkPort(NOVNC_PORT);
      if (!wsOk) {
        console.log('[qa-runner] [watchdog] websockify down — restarting');
        spawnLogged('/usr/bin/python3', [
          '-m', 'websockify',
          '--web', NOVNC_WEB_DIR,
          '--heartbeat=30',
          '--token-plugin=TokenFile',
          `--token-source=${VNC_TOKEN_FILE}`,
          `0.0.0.0:${NOVNC_PORT}`,
        ]);
      }
    } catch (err) {
      console.error('[qa-runner] [watchdog] error:', err.message);
    }
  }, 20_000);
}

// Robot Framework binary — prefer venv path, fall back to PATH
const ROBOT_BIN = fs.existsSync('/opt/rfbrowser/bin/robot')
  ? '/opt/rfbrowser/bin/robot'
  : 'robot';

// Python 3 binary from the same venv
const PYTHON_BIN = fs.existsSync('/opt/rfbrowser/bin/python3')
  ? '/opt/rfbrowser/bin/python3'
  : 'python3';

// Path to the rfbrowser-node gRPC wrapper (index.js inside the Browser package).
// Resolved once at startup so we don't pay the Python fork cost per test run.
// When set, each robot run gets its own isolated rfbrowser-node process on a unique port.
let RF_BROWSER_WRAPPER_JS = null;
try {
  const p = execSync(
    `${PYTHON_BIN} -c "import os,Browser;print(os.path.join(os.path.dirname(Browser.__file__),'wrapper','index.js'))"`,
    { timeout: 10_000, encoding: 'utf8' },
  ).trim();
  if (p && fs.existsSync(p)) RF_BROWSER_WRAPPER_JS = p;
} catch { /* RF Browser not installed — fall back to default behaviour */ }

if (RF_BROWSER_WRAPPER_JS) {
  console.log(`[runner] RF Browser wrapper found: ${RF_BROWSER_WRAPPER_JS}`);
} else {
  console.warn('[runner] RF Browser wrapper not found — concurrent RF Browser runs may conflict');
}

// ── rfbrowser-node warm pool ───────────────────────────────────────────────
// Pre-warms N rfbrowser-node gRPC processes at startup so each test run can
// skip the 15-25 s cold-start. A run claims a warm entry, which is immediately
// replaced by a fresh warm entry so the pool stays full for the next run.
//
// Pool size matches the worker concurrency (3). Processes are started on
// VNC_DISPLAY so they can render headed browsers when needed.

const WARM_POOL_SIZE = 3;

// Each entry: { port: number, proc: ChildProcess }
const rfbWarmPool = [];

// Polls a TCP port until it accepts a connection (up to maxMs milliseconds).
// Named differently from the existing callback-based waitForPort to avoid shadowing it.
function pollPortReady(port, maxMs = 20_000) {
  return new Promise((resolve) => {
    const deadline = Date.now() + maxMs;
    const attempt = () => {
      const s = new net.Socket();
      s.setTimeout(300);
      s.connect(port, '127.0.0.1', () => { s.destroy(); resolve(true); });
      s.on('error', () => { s.destroy(); if (Date.now() < deadline) setTimeout(attempt, 250); else resolve(false); });
      s.on('timeout', () => { s.destroy(); if (Date.now() < deadline) setTimeout(attempt, 250); else resolve(false); });
    };
    attempt();
  });
}

// Starts a single rfbrowser-node process and adds it to rfbWarmPool once ready.
async function spawnWarmNode() {
  if (!RF_BROWSER_WRAPPER_JS) return;
  try {
    const port = await findFreePort();
    const env = { ...process.env, DISPLAY: VNC_DISPLAY };
    const proc = spawn('node', [RF_BROWSER_WRAPPER_JS, '127.0.0.1', String(port)], {
      env,
      stdio: ['ignore', 'ignore', 'ignore'],
      detached: false,
    });
    proc.on('error', () => { /* ignore spawn errors — pool will refill */ });
    const ready = await pollPortReady(port, 20_000);
    if (ready) {
      rfbWarmPool.push({ port, proc });
      console.log(`[runner] [warm-pool] rfbrowser-node ready on port ${port} (pool size: ${rfbWarmPool.length})`);
    } else {
      proc.kill();
      console.warn(`[runner] [warm-pool] rfbrowser-node on port ${port} did not become ready — discarding`);
    }
  } catch (err) {
    console.error('[runner] [warm-pool] spawn error:', err.message);
  }
}

// Claims a warm entry from the pool (returns { port, proc } or null if pool is empty).
// Immediately kicks off a replacement so the pool stays full.
function claimWarmNode() {
  const entry = rfbWarmPool.shift() ?? null;
  // Replenish in background — don't await, run is already in progress
  spawnWarmNode().catch(() => {});
  return entry;
}

// Seed the pool at startup (runs in background, server continues immediately).
if (RF_BROWSER_WRAPPER_JS) {
  Promise.all(Array.from({ length: WARM_POOL_SIZE }, () => spawnWarmNode()))
    .then(() => console.log(`[runner] [warm-pool] Initial pool ready (${rfbWarmPool.length}/${WARM_POOL_SIZE})`))
    .catch(() => {});
}

// ── RF XML report parser ───────────────────────────────────────────────────
function decodeXmlEntities(str) {
  return str
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

function parseRobotXmlReport(xmlPath) {
  if (!fs.existsSync(xmlPath)) return null;
  const xml = fs.readFileSync(xmlPath, 'utf8');

  // Extract suite-level status
  const suiteMatch = xml.match(/<suite[^>]*>[\s\S]*?<status\s+status="(PASS|FAIL)"[^>]*start="([^"]*)"[^>]*end="([^"]*)"[^/]*/);
  const suiteStatus = suiteMatch ? suiteMatch[1] : 'FAIL';

  // Extract individual test results — capture the full test block so we can mine
  // the error from either <status status="FAIL">msg</status> or <msg level="FAIL">
  const tests = [];
  const testBlockRegex = /<test\s[^>]*>([\s\S]*?)<\/test>/g;
  let m;
  while ((m = testBlockRegex.exec(xml)) !== null) {
    const block = m[0];
    const body = m[1];

    const nameMatch = block.match(/<test\s[^>]*\bname="([^"]*)"/);
    if (!nameMatch) continue;
    const name = decodeXmlEntities(nameMatch[1]);

    // RF puts one <tags><tag>...</tag>...</tags> block directly under <test> (used
    // downstream to match this specific test back to a TestCase by tcId tag).
    const tagsMatch = body.match(/<tags>([\s\S]*?)<\/tags>/);
    const tags = tagsMatch
      ? [...tagsMatch[1].matchAll(/<tag>([^<]*)<\/tag>/g)].map((tm) => decodeXmlEntities(tm[1]).trim())
      : [];

    // Status is in the direct child <status> of <test> (not nested keyword statuses)
    const statusMatch = body.match(/<status\s+status="(PASS|FAIL)"[^>]*(?:start(?:time)?="([^"]*)")?[^>]*(?:end(?:time)?="([^"]*)")?/);
    const status = statusMatch ? statusMatch[1] : 'FAIL';
    const startStr = statusMatch ? statusMatch[2] : null;
    const endStr = statusMatch ? statusMatch[3] : null;

    let durationMs = 0;
    if (startStr && endStr) {
      try { durationMs = new Date(endStr).getTime() - new Date(startStr).getTime(); } catch { /* ignore */ }
    }

    let errorMsg = null;
    if (status === 'FAIL') {
      // Strategy 1: text content of the test-level <status status="FAIL">...</status>
      const statusTextMatch = body.match(/<status\s+status="FAIL"[^>]*>([\s\S]*?)<\/status>/);
      if (statusTextMatch) {
        const txt = decodeXmlEntities(statusTextMatch[1]).replace(/<[^>]+>/g, '').trim();
        if (txt) errorMsg = txt;
      }
      // Strategy 2: last <msg level="FAIL"> in the block (most specific failure message)
      if (!errorMsg) {
        const msgRegex = /<msg[^>]*\blevel="FAIL"[^>]*>([\s\S]*?)<\/msg>/g;
        let mm;
        let lastMsg = null;
        while ((mm = msgRegex.exec(body)) !== null) lastMsg = mm[1];
        if (lastMsg) errorMsg = decodeXmlEntities(lastMsg).replace(/<[^>]+>/g, '').trim();
      }
      // Truncate very long messages
      if (errorMsg && errorMsg.length > 600) errorMsg = errorMsg.slice(0, 600) + '…';
    }

    tests.push({ name, status, durationMs, errorMsg, tags });
  }

  // Normalise to a shape similar to Playwright JSON so runWorker.ts can reuse the same parsing path
  return {
    _robotReport: true,
    suiteStatus,
    tests,
    stats: {
      total: tests.length,
      passed: tests.filter(t => t.status === 'PASS').length,
      failed: tests.filter(t => t.status === 'FAIL').length,
    },
  };
}

// pnpm may hoist to workspace root or keep in package — try both
const PLAYWRIGHT_BIN_CANDIDATES = [
  '/app/node_modules/.bin/playwright',
  '/app/packages/runner/node_modules/.bin/playwright',
  '/app/packages/runner/node_modules/@playwright/test/node_modules/.bin/playwright',
];
function findPlaywrightBin() {
  for (const candidate of PLAYWRIGHT_BIN_CANDIDATES) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return PLAYWRIGHT_BIN_CANDIDATES[0]; // fallback — will fail with a clear error
}

const CONFIG_CONTENT = `module.exports = {
  timeout: 660000,          // hard cap: 11 min per test (scripts may call test.setTimeout to extend further)
  retries: 2,               // retry flaky tests up to 2 times — safety net for Angular rendering races
  use: {
    actionTimeout: 30000,   // 30 s for each action (fill, click, …)
    navigationTimeout: 60000, // 60 s for page loads / waitForNavigation
    slowMo: 80,             // 80 ms pause after every action — gives Angular/React render cycles time to settle
    baseURL: process.env.BASE_URL || '',
    screenshot: 'on',
    trace: 'on-first-retry',
    ignoreHTTPSErrors: true,
    video: 'on',               // always retain video — lets run history show recordings for pass and fail
  },
  projects: [
    { name: 'chromium', use: { browserName: 'chromium', viewport: { width: 1280, height: 720 }, launchOptions: { args: ['--disable-blink-features=AutomationControlled', '--disable-dev-shm-usage', '--no-sandbox', '--disable-gpu'] } } },
    { name: 'firefox',  use: { browserName: 'firefox'  } },
    { name: 'webkit',   use: { browserName: 'webkit'   } },
  ],
};
`;

// Separate config for "Run in Host Browser" — no retries, higher slowMo so
// every step is clearly visible in the noVNC viewer.
// Extra Chromium flags are required for headed rendering on a persistent Xvfb
// inside Docker: GPU acceleration doesn't work, /dev/shm is small, sandbox
// requires kernel features that are often absent in containers.
const HOST_BROWSER_CONFIG_CONTENT = `module.exports = {
  timeout: 660000,
  retries: 0,
  use: {
    actionTimeout: 30000,
    navigationTimeout: 60000,
    slowMo: 600,
    baseURL: process.env.BASE_URL || '',
    screenshot: 'on',
    trace: 'off',
    ignoreHTTPSErrors: true,
    video: 'off',
  },
  projects: [
    { name: 'chromium', use: {
        browserName: 'chromium',
        viewport: { width: 1600, height: 812 },
        launchOptions: {
          args: [
            '--disable-blink-features=AutomationControlled',
            '--disable-gpu',
            '--disable-dev-shm-usage',
            '--no-sandbox',
            '--disable-setuid-sandbox',
          ],
        },
    } },
  ],
};
`;

const HOST_BROWSER_CONFIG_FILE = 'qa-infinity.host-browser.playwright.config.js';
const HOST_BROWSER_CONFIG_PATH = path.join(SCRIPTS_DIR, HOST_BROWSER_CONFIG_FILE);

function writeConfig() {
  fs.writeFileSync(CONFIG_PATH, CONFIG_CONTENT, 'utf8');
}

function writeHostBrowserConfig() {
  fs.writeFileSync(HOST_BROWSER_CONFIG_PATH, HOST_BROWSER_CONFIG_CONTENT, 'utf8');
}

// Active playwright codegen sessions — keyed by sessionId
const activeRecordings = new Map();

function collectBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  // GET /health
  if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('OK');
    return;
  }

  // POST /vnc/claim — allocate a VNC session slot; returns { token, display } or 409
  if (req.method === 'POST' && req.url === '/vnc/claim') {
    const slot = claimVncSlot();
    if (!slot) {
      res.writeHead(409, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'All VNC sessions in use', busy: true }));
      return;
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ token: slot.token, display: slot.display }));
    return;
  }

  // POST /vnc/release — free a VNC session slot
  if (req.method === 'POST' && req.url === '/vnc/release') {
    let body;
    try {
      const raw = await collectBody(req);
      body = JSON.parse(raw);
    } catch {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid JSON' }));
      return;
    }
    releaseVncSlot(body.token ?? '');
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  // POST /run
  if (req.method === 'POST' && req.url === '/run') {
    let body;
    try {
      const raw = await collectBody(req);
      body = JSON.parse(raw);
    } catch (err) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid JSON body: ' + err.message }));
      return;
    }

    const {
      scriptPath,
      reportFile,
      outputDir,
      browser = 'chromium',
      workers = 1,
      headless = true,
      baseUrl = '',
      username = '',
      password = '',
      environment = '',
      hostBrowser = false,
      projectSlug = '',
    } = body;

    if (!scriptPath || !reportFile) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'scriptPath and reportFile are required' }));
      return;
    }

    // Start streaming response early so both paths can write to it
    res.writeHead(200, {
      'Content-Type': 'application/x-ndjson',
      'Transfer-Encoding': 'chunked',
    });

    const sendLine = (obj) => {
      res.write(JSON.stringify(obj) + '\n');
    };

    const handleChunk = (chunk) => {
      const text = chunk.toString('utf8');
      for (const line of text.split('\n')) {
        const trimmed = line.trim();
        if (trimmed) {
          sendLine({ type: 'log', text: trimmed });
        }
      }
    };

    // Claim a VNC slot for host-browser runs; notify frontend immediately
    let vncClaim = null;
    let vncReleased = false;
    const releaseVnc = () => {
      if (vncClaim && !vncReleased) { vncReleased = true; releaseVncSlot(vncClaim.token); }
    };
    if (hostBrowser) {
      vncClaim = claimVncSlot();
      sendLine(vncClaim ? { type: 'vnc-session', token: vncClaim.token } : { type: 'vnc-busy' });
    }

    const HARD_KILL_MS = 900_000;
    let proc;
    let procDone = false;

    // ── Robot Framework execution path ──────────────────────────────────────
    if (scriptPath.endsWith('.robot')) {
      const scriptDir = path.dirname(scriptPath);
      const projectId = path.basename(scriptDir);

      // Detect hierarchy-based projects (e.g. Airtel Ventas) where Resource/ lives
      // at the project root rather than alongside the test file.
      const relToScripts = path.relative(SCRIPTS_DIR, scriptPath);
      const projectSlug = relToScripts.split(path.sep)[0];
      const projectRoot = path.join(SCRIPTS_DIR, projectSlug);
      const resourcesDirName = fs.existsSync(path.join(projectRoot, 'Resources')) ? 'Resources' : 'Resource';
      const pageObjectsDir = path.join(projectRoot, resourcesDirName, 'PageObjects');
      const hasHierarchy = fs.existsSync(path.join(projectRoot, resourcesDirName));

      if (!hasHierarchy) {
        // Flat layout: copy resource files directly into the script dir so RF can resolve
        // `Resource keywords.robot` and `Variables login_portal.py` relative to the test file.
        // Prefer the slug-based resources dir (written by the resources API) using the
        // projectSlug passed from the API. Fall back to the CUID-based dir for legacy layouts.
        const slugResourcesDir = projectSlug
          ? path.join(SCRIPTS_DIR, projectSlug, 'resources')
          : null;
        const cuidResourcesDir = path.join(SCRIPTS_DIR, projectId, 'resources');
        const resourcesSrcDir = (slugResourcesDir && fs.existsSync(slugResourcesDir))
          ? slugResourcesDir
          : (fs.existsSync(cuidResourcesDir) ? cuidResourcesDir : null);

        if (resourcesSrcDir) {
          const resFiles = fs.readdirSync(resourcesSrcDir);
          for (const rf of resFiles) {
            if (rf === '.gitkeep') continue;
            const srcFile = path.join(resourcesSrcDir, rf);
            if (fs.statSync(srcFile).isFile()) {
              fs.copyFileSync(srcFile, path.join(scriptDir, rf));
            }
          }
        }

        // Additive: expose the Infinity shared common library (Shared/*.robot —
        // Session/Login/Locators/Navigation/TestData) next to the script, same way
        // as the resources/ copy above. Deliberately separate from that block and
        // from the hasHierarchy check above — this never touches legacy resources/
        // or Resource//Resources/ handling, it only adds visibility for the new
        // Shared/ folder when present. Hierarchy-mode projects already get this for
        // free via the whole-tree symlink further down, so this only runs for flat
        // (non-hierarchy) projects like this one.
        const sharedSrcDir = path.join(projectRoot, 'Shared');
        if (fs.existsSync(sharedSrcDir)) {
          for (const sf of fs.readdirSync(sharedSrcDir)) {
            const srcFile = path.join(sharedSrcDir, sf);
            if (fs.statSync(srcFile).isFile()) {
              fs.copyFileSync(srcFile, path.join(scriptDir, sf));
            }
          }
        }
      }

      const effectiveOutputDir = outputDir || path.join('/artifacts', projectSlug, path.basename(scriptPath, '.robot'));
      fs.mkdirSync(effectiveOutputDir, { recursive: true });
      const xmlOutputPath = path.join(effectiveOutputDir, 'output.xml');

      // Write a RF listener that auto-takes a screenshot before each test teardown.
      // This fires when the teardown keyword is about to start — browser still open —
      // so we capture the final page state for every run regardless of whether the
      // robot script explicitly calls Take Screenshot.
      const listenerCode = [
        'import os as _os',
        '',
        'class QaRunnerListener:',
        '    ROBOT_LISTENER_API_VERSION = 2',
        '',
        '    def __init__(self, output_dir):',
        '        self.output_dir = output_dir',
        '        self._screenshot_done = False',
        '',
        '    def start_test(self, name, attrs):',
        '        self._screenshot_done = False',
        '',
        '    def start_keyword(self, name, attrs):',
        '        # type=="teardown" fires before the [Teardown] keyword runs — browser still open',
        '        if not self._screenshot_done and attrs.get("type") == "teardown":',
        '            self._screenshot_done = True',
        '            try:',
        '                from robot.libraries.BuiltIn import BuiltIn',
        '                screenshot_path = _os.path.join(self.output_dir, "screenshot.png")',
        '                BuiltIn().run_keyword("Take Screenshot", screenshot_path)',
        '            except Exception:',
        '                pass',
      ].join('\n');

      const listenerPath = path.join(effectiveOutputDir, 'QaRunnerListener.py');
      try { fs.writeFileSync(listenerPath, listenerCode, 'utf8'); } catch { /* non-fatal */ }

      // Only inject env credentials when the script doesn't declare its own —
      // scripts with multi-persona flows declare ${TC_USERNAME} / ${TC_PASSWORD}
      // in their *** Variables *** section and must not be overridden.
      let scriptSource = '';
      try { scriptSource = fs.readFileSync(scriptPath, 'utf8'); } catch { /* non-fatal */ }
      const scriptDeclares = (name) => new RegExp(`^\\$\\{${name}\\}`, 'm').test(scriptSource);

      const robotArgs = [
        '--outputdir', effectiveOutputDir,
        '--output', 'output.xml',
        '--report', 'NONE',
        '--log', 'log.html',
        '--listener', `${listenerPath}:${effectiveOutputDir}`,
        '--variable', `OUTPUTDIR:${effectiveOutputDir}`,
        '--variable', `HEADLESS:${hostBrowser ? 'False' : 'True'}`,
      ];
      // Only override BASE_URL if a value was supplied — if empty, let the script's
      // own *** Variables *** default take effect (e.g. imported projects with no env config).
      if (baseUrl) robotArgs.push('--variable', `BASE_URL:${baseUrl}`);
      if (!scriptDeclares('TC_USERNAME') && username) robotArgs.push('--variable', `TC_USERNAME:${username}`);
      if (!scriptDeclares('TC_PASSWORD') && password) robotArgs.push('--variable', `TC_PASSWORD:${password}`);

      // Hierarchy-based projects (e.g. Airtel Ventas) keep custom Python libs in
      // Resource/PageObjects/ — expose them to Robot Framework via --pythonpath.
      if (hasHierarchy && fs.existsSync(pageObjectsDir)) {
        robotArgs.push('--pythonpath', pageObjectsDir);
      }

      robotArgs.push(scriptPath);

      const robotEnv = Object.assign({}, process.env, {
        BASE_URL: baseUrl || '',
        TC_USERNAME: username || '',
        TC_PASSWORD: password || '',
        TEST_ENV: environment || '',
      });

      if (hasHierarchy && fs.existsSync(pageObjectsDir)) {
        robotEnv.PYTHONPATH = [pageObjectsDir, process.env.PYTHONPATH || ''].filter(Boolean).join(':');
      }

      let spawnCmd, spawnArgs;

      if (RF_BROWSER_WRAPPER_JS) {
        // Warm pool nodes are spawned with DISPLAY=:99 (VNC display).
        // Only use them for host-browser runs — headless runs go through xvfb-run
        // which creates its own isolated display (:100, :101, …). If a warm node
        // (DISPLAY=:99) were claimed for a headless run, Playwright would render on
        // :99, leaking the browser into the VNC viewer and causing overlapping windows
        // when multiple headless runs are in flight concurrently.
        const warmEntry = hostBrowser ? claimWarmNode() : null;
        const rfBrowserPort = warmEntry ? warmEntry.port : await findFreePort();
        const warmProc = warmEntry ? warmEntry.proc : null;

        if (warmEntry) {
          console.log(`[runner] [warm-pool] Using pre-warmed rfbrowser-node on port ${rfBrowserPort} (host-browser)`);
        } else {
          console.log(`[runner] [warm-pool] Cold-starting rfbrowser-node on port ${rfBrowserPort} (${hostBrowser ? 'pool empty' : 'headless — warm pool bypassed'})`);
        }

        // Launcher: if we have a warm proc, skip the node spawn + wait steps entirely.
        // If cold-starting, spawn rfbrowser-node and wait for it as before.
        const launcherLines = ['#!/bin/bash'];
        if (!warmEntry) {
          launcherLines.push(
            `RFBNODE_WRAPPER="${RF_BROWSER_WRAPPER_JS}"`,
            '',
            'cleanup() { kill "${RFBNODE_PID:-}" 2>/dev/null || true; }',
            'trap cleanup EXIT TERM INT',
            '',
            '# Cold start — rfbrowser-node was not pre-warmed',
            `node "$RFBNODE_WRAPPER" 127.0.0.1 "${rfBrowserPort}" >/dev/null 2>&1 &`,
            'RFBNODE_PID=$!',
            '',
            '# Wait up to 20 s for the gRPC server to accept connections',
            'node -e "',
            'const net=require(\'net\'),p=' + rfBrowserPort + ';let n=0;',
            'const t=()=>{',
            '  const s=new net.Socket();s.setTimeout(200);',
            '  s.connect(p,\'127.0.0.1\',()=>{s.destroy();process.exit(0);});',
            '  s.on(\'error\',()=>{if(++n<100)setTimeout(t,200);else process.exit(0);});',
            '  s.on(\'timeout\',()=>{s.destroy();if(++n<100)setTimeout(t,200);else process.exit(0);});',
            '};t();',
            '"',
          );
        } else {
          // Warm path — just set a trap to kill the pre-warmed proc when robot exits
          launcherLines.push(
            `RFBNODE_PID=${warmProc.pid}`,
            'cleanup() { kill "${RFBNODE_PID:-}" 2>/dev/null || true; }',
            'trap cleanup EXIT TERM INT',
          );
        }
        launcherLines.push(
          '',
          `export ROBOT_FRAMEWORK_BROWSER_NODE_PORT="${rfBrowserPort}"`,
          `${ROBOT_BIN} "$@"`,
        );
        const launcherCode = launcherLines.join('\n');

        const launcherPath = path.join(effectiveOutputDir, 'launch_rf_browser.sh');
        try {
          fs.writeFileSync(launcherPath, launcherCode, 'utf8');
          fs.chmodSync(launcherPath, 0o755);
        } catch { /* non-fatal — fall through to direct robot */ }

        if (hostBrowser && vncClaim) {
          sendLine({ type: 'log', text: `[runner] 🌐 Launching RF Browser on VNC display ${vncClaim.display} (node port ${rfBrowserPort})` });
          sendLine({ type: 'log', text: `[runner]    Watch live → noVNC tab should already be open` });
          robotEnv.DISPLAY = vncClaim.display;
          spawnCmd  = 'bash';
          spawnArgs = [launcherPath, ...robotArgs];
        } else {
          if (hostBrowser) sendLine({ type: 'log', text: '[runner] ⚠ All VNC sessions in use — running without visual display' });
          else sendLine({ type: 'log', text: `[runner] 🤖 Launching RF Browser headless (node port ${rfBrowserPort})` });
          spawnCmd  = 'xvfb-run';
          spawnArgs = ['--auto-servernum', '--server-args=-screen 0 1920x1080x24', 'bash', launcherPath, ...robotArgs];
        }
      } else {
        // Fallback: RF Browser not found — run robot directly (old behaviour)
        if (hostBrowser && vncClaim) {
          sendLine({ type: 'log', text: `[runner] 🌐 Launching RF Browser on VNC display ${vncClaim.display}` });
          sendLine({ type: 'log', text: `[runner]    Watch live → noVNC tab should already be open` });
          robotEnv.DISPLAY = vncClaim.display;
          spawnCmd  = ROBOT_BIN;
          spawnArgs = robotArgs;
        } else {
          if (hostBrowser) sendLine({ type: 'log', text: '[runner] ⚠ All VNC sessions in use — running without visual display' });
          spawnCmd  = 'xvfb-run';
          spawnArgs = ['--auto-servernum', '--server-args=-screen 0 1920x1080x24', ROBOT_BIN, ...robotArgs];
        }
      }

      // For hierarchy projects, create an isolated run directory with file-level
      // symlinks into projectRoot. cwd=runDir lets Python open() resolve relative
      // paths (e.g. Resources/TestData/*.xlsx) via the symlinks, while any new
      // directories the scripts create (e.g. TestCases/) stay in the temp dir.
      //
      // YAML variable files that use ${CURDIR} get a real expanded copy because
      // Robot Framework does NOT substitute ${CURDIR} inside YAML values — the
      // literal string is passed to Python which then fails to open() it.
      let runDir = null;
      let spawnCwd = hasHierarchy ? projectRoot : scriptDir;
      if (hasHierarchy) {
        try {
          runDir = fs.mkdtempSync('/tmp/robot-run-');

          // Recursively create file-level symlinks so individual files can be
          // replaced (e.g. YAML files with expanded ${CURDIR}).
          const symlinkTree = (src, dest) => {
            fs.mkdirSync(dest, { recursive: true });
            for (const ent of fs.readdirSync(src, { withFileTypes: true })) {
              const srcP = path.join(src, ent.name);
              const dstP = path.join(dest, ent.name);
              if (ent.isDirectory()) symlinkTree(srcP, dstP);
              else fs.symlinkSync(srcP, dstP);
            }
          };
          symlinkTree(projectRoot, runDir);

          // Expand ${CURDIR} in YAML variable files. RF does not substitute
          // built-in variables inside YAML values, so Python receives the
          // literal string. Replace with the real absolute directory of each
          // YAML file so open() works regardless of cwd.
          const expandYaml = (dir) => {
            for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
              const p = path.join(dir, ent.name);
              if (ent.isDirectory()) { expandYaml(p); continue; }
              if (!ent.name.endsWith('.yaml') && !ent.name.endsWith('.yml')) continue;
              const realSrc = fs.realpathSync(p);
              const content = fs.readFileSync(realSrc, 'utf8');
              if (!content.includes('${CURDIR}')) continue;
              const fixed = content.split('${CURDIR}').join(path.dirname(realSrc));
              fs.unlinkSync(p);
              fs.writeFileSync(p, fixed, 'utf8');
            }
          };
          expandYaml(runDir);

          spawnCwd = runDir;
        } catch {
          runDir = null; // fall back to projectRoot on any failure
        }
      }

      const cleanupRunDir = () => {
        if (runDir) {
          try { fs.rmSync(runDir, { recursive: true, force: true }); } catch { /* non-fatal */ }
          runDir = null;
        }
      };

      proc = spawn(spawnCmd, spawnArgs, {
        cwd: spawnCwd,
        env: robotEnv,
        stdio: ['ignore', 'pipe', 'pipe'],
        // detached=true creates a new process group so a hard-kill can take out
        // the whole tree (xvfb-run/launcher + robot + its Chromium child) with a
        // single negative-PID signal — a lone SIGTERM to the immediate child can
        // leave grandchildren (and their locks/memory) orphaned if it's wedged.
        detached: true,
      });

      const killProcessTree = (signal) => {
        try { process.kill(-proc.pid, signal); } catch { try { proc.kill(signal); } catch { /* already gone */ } }
      };

      const killTimer = setTimeout(() => {
        sendLine({ type: 'log', text: `[runner] Robot script exceeded ${HARD_KILL_MS / 1000}s hard limit — killing` });
        killProcessTree('SIGTERM');
        setTimeout(() => killProcessTree('SIGKILL'), 5_000);
      }, HARD_KILL_MS);

      // Send a heartbeat every 20 s to keep the TCP session alive through
      // firewalls/NAT that kill idle connections (typical idle timeout: ~300 s).
      // The API side ignores heartbeat lines.
      const heartbeatTimer = setInterval(() => {
        if (!procDone) sendLine({ type: 'heartbeat' });
      }, 20_000);

      req.on('close', () => {
        if (!procDone && !proc.killed) {
          killProcessTree('SIGTERM');
          setTimeout(() => { if (!procDone) killProcessTree('SIGKILL'); }, 3000);
        }
        clearTimeout(killTimer);
        clearInterval(heartbeatTimer);
        releaseVnc();
        cleanupRunDir();
      });

      // Accumulate last 2 KB of output as a fallback error snippet
      const outputLines = [];
      const captureChunk = (chunk) => {
        for (const line of chunk.toString('utf8').split('\n')) {
          const t = line.trim();
          if (t) outputLines.push(t);
          if (outputLines.length > 80) outputLines.shift();
        }
      };

      proc.stdout.on('data', (chunk) => { handleChunk(chunk); captureChunk(chunk); });
      proc.stderr.on('data', (chunk) => { handleChunk(chunk); captureChunk(chunk); });

      proc.on('close', (exitCode) => {
        procDone = true;
        clearTimeout(killTimer);
        clearInterval(heartbeatTimer);
        releaseVnc();
        cleanupRunDir();
        const reportData = parseRobotXmlReport(xmlOutputPath);
        // Build a compact error snippet from the last N lines that contain 'FAIL', 'Error', or 'Exception'
        const errorLines = outputLines.filter(l => /FAIL|Error|Exception|Critical/i.test(l)).slice(-5).join(' | ');

        // Scan output dir for screenshots and videos produced by RF Browser library
        let screenshotPath = null;
        const videoPaths = [];
        try {
          const allFiles = [];
          const scanDir = (dir) => {
            if (!fs.existsSync(dir)) return;
            for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
              const full = path.join(dir, entry.name);
              if (entry.isDirectory()) {
                scanDir(full);
              } else {
                allFiles.push(full);
                if (!screenshotPath && /\.(png|jpg|jpeg)$/i.test(entry.name)) {
                  screenshotPath = full;
                } else if (/\.(webm|mp4)$/i.test(entry.name)) {
                  videoPaths.push(full);
                }
              }
            }
          };
          scanDir(effectiveOutputDir);
          videoPaths.sort((a, b) => fs.statSync(a).mtimeMs - fs.statSync(b).mtimeMs);
          console.log(`[qa-runner] artifact scan: dir=${effectiveOutputDir} files=[${allFiles.map(f => path.basename(f)).join(', ')}] videos=[${videoPaths.map(f => path.basename(f)).join(', ')}] screenshot=${screenshotPath || 'none'}`);
        } catch (scanErr) {
          console.error(`[qa-runner] artifact scan error: ${scanErr.message}`);
        }

        sendLine({ type: 'done', exitCode: exitCode ?? 1, reportData, screenshotPath, videoPaths, errorSnippet: errorLines || null });
        res.end();
      });

      proc.on('error', (err) => {
        clearTimeout(killTimer);
        clearInterval(heartbeatTimer);
        releaseVnc();
        sendLine({ type: 'done', exitCode: 1, reportData: null, error: err.message });
        res.end();
      });

      return;
    }

    // ── Playwright execution path ───────────────────────────────────────────

    // Write playwright config
    try {
      writeConfig();
    } catch (err) {
      sendLine({ type: 'done', exitCode: 1, reportData: null, error: 'Failed to write playwright config: ' + err.message });
      res.end();
      return;
    }

    // Build args — always headed for screenshot/video capture
    const args = [
      'test',
      path.basename(scriptPath),
      `--config=${CONFIG_FILE}`,
      '--reporter=list',
      '--reporter=json',
      '--workers=1',
      `--project=${browser}`,
      '--headed',
    ];
    // Route artifacts to a per-TC directory so they aren't overwritten by the next run
    if (outputDir) {
      args.push(`--output=${outputDir}`);
    }

    const env = Object.assign({}, process.env, {
      BASE_URL: baseUrl || '',
      TC_USERNAME: username || '',
      TC_PASSWORD: password || '',
      TEST_ENV: environment || '',
      PLAYWRIGHT_JSON_OUTPUT_NAME: reportFile,
      CI: '1',
      HEADED: '1',
      // Allow test scripts in /scripts to resolve @playwright/test from the runner's node_modules
      NODE_PATH: [
        '/app/node_modules',
        '/app/packages/runner/node_modules',
        process.env.NODE_PATH,
      ].filter(Boolean).join(':'),
    });

    const playwrightBin = findPlaywrightBin();

    let spawnCmd, spawnArgs, spawnEnv;

    if (hostBrowser) {
      if (vncClaim) {
        try { writeHostBrowserConfig(); } catch (err) {
          releaseVnc();
          sendLine({ type: 'done', exitCode: 1, reportData: null, error: 'Failed to write host-browser config: ' + err.message });
          res.end(); return;
        }
        const hbArgs = args.map((a) =>
          a.startsWith('--config=') ? `--config=${HOST_BROWSER_CONFIG_FILE}` : a
        );
        sendLine({ type: 'log', text: `[runner] 🌐 Launching browser on VNC display ${vncClaim.display}` });
        sendLine({ type: 'log', text: `[runner]    DISPLAY=${vncClaim.display}  config=${HOST_BROWSER_CONFIG_FILE}` });
        sendLine({ type: 'log', text: `[runner]    slowMo=600ms — each step visible for 0.6 s` });
        spawnCmd  = playwrightBin;
        spawnArgs = hbArgs;
        spawnEnv  = Object.assign({}, env, { DISPLAY: vncClaim.display, CHROMIUM_FLAGS: '--disable-gpu' });
      } else {
        // VNC busy — continue in an isolated xvfb-run display so the run still executes
        sendLine({ type: 'log', text: '[runner] ⚠ All VNC sessions in use — running without visual display' });
        try { writeHostBrowserConfig(); } catch { /* non-fatal */ }
        const hbArgs = args.map((a) =>
          a.startsWith('--config=') ? `--config=${HOST_BROWSER_CONFIG_FILE}` : a
        );
        spawnCmd  = 'xvfb-run';
        spawnArgs = ['--auto-servernum', '--server-args=-screen 0 1920x1080x24', playwrightBin, ...hbArgs];
        spawnEnv  = env;
      }
    } else {
      // Normal headless run — allocate a fresh virtual display with xvfb-run
      spawnCmd  = 'xvfb-run';
      spawnArgs = [
        '--auto-servernum',
        '--server-args=-screen 0 1920x1080x24',
        playwrightBin,
        ...args,
      ];
      spawnEnv = env;
    }

    proc = spawn(spawnCmd, spawnArgs, {
      cwd: SCRIPTS_DIR,
      env: spawnEnv,
      stdio: ['ignore', 'pipe', 'pipe'],
      // detached=true creates a new process group so a hard-kill can take out the
      // whole tree (xvfb-run + playwright + its Chromium child) with a single
      // negative-PID signal — see the matching comment on the Robot Framework spawn.
      detached: true,
    });

    const killProcessTree = (signal) => {
      try { process.kill(-proc.pid, signal); } catch { try { proc.kill(signal); } catch { /* already gone */ } }
    };

    // Kill the Playwright process immediately when the API worker disconnects
    // (e.g. user clicked Stop Run, which aborts the fetch on the worker side)
    req.on('close', () => {
      releaseVnc();
      if (!procDone) {
        killProcessTree('SIGTERM');
        setTimeout(() => { if (!procDone) killProcessTree('SIGKILL'); }, 3000);
      }
      clearTimeout(killTimer);
    });

    // Hard-kill the browser process if it hasn't exited within 15 min
    // (accommodates multi-step workflow tests that use test.setTimeout up to 600 s + startup/shutdown buffer)
    const killTimer = setTimeout(() => {
      sendLine({ type: 'log', text: `[runner] Script exceeded ${HARD_KILL_MS / 1000}s hard limit — killing process` });
      killProcessTree('SIGTERM');
      setTimeout(() => killProcessTree('SIGKILL'), 5_000);
    }, HARD_KILL_MS);

    proc.stdout.on('data', handleChunk);
    proc.stderr.on('data', handleChunk);

    proc.on('close', (exitCode) => {
      procDone = true;
      releaseVnc();
      clearTimeout(killTimer);
      let reportData = null;
      try {
        if (fs.existsSync(reportFile)) {
          reportData = JSON.parse(fs.readFileSync(reportFile, 'utf8'));
        }
      } catch { /* ignore parse errors */ }

      // Scan outputDir for screenshot/video as fallback when JSON report lacks attachment paths
      let screenshotPath = null;
      let videoPath = null;
      if (outputDir) {
        try {
          const scanDir = (dir) => {
            if (!fs.existsSync(dir)) return;
            for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
              const full = path.join(dir, entry.name);
              if (entry.isDirectory()) {
                scanDir(full);
              } else if (!screenshotPath && /\.(png|jpg|jpeg)$/i.test(entry.name)) {
                screenshotPath = full;
              } else if (!videoPath && /\.(webm|mp4)$/i.test(entry.name)) {
                videoPath = full;
              }
            }
          };
          scanDir(outputDir);
        } catch { /* non-fatal */ }
      }

      sendLine({ type: 'done', exitCode: exitCode ?? 1, reportData, screenshotPath, videoPath });
      res.end();
    });

    proc.on('error', (err) => {
      clearTimeout(killTimer);
      sendLine({ type: 'done', exitCode: 1, reportData: null, error: err.message });
      res.end();
    });

    return;
  }

  // POST /record/start — launch playwright codegen on the VNC display
  if (req.method === 'POST' && req.url === '/record/start') {
    let body;
    try {
      const raw = await collectBody(req);
      body = JSON.parse(raw);
    } catch {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid JSON body' }));
      return;
    }

    const { url = '', sessionId = 'default' } = body;
    if (!url) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'url is required' }));
      return;
    }

    if (activeRecordings.has(sessionId)) {
      res.writeHead(409, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Recording already active for this session' }));
      return;
    }

    const vncSlot = claimVncSlot();
    if (!vncSlot) {
      res.writeHead(503, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'VNC_BUSY', message: 'All VNC sessions are in use. Wait for an active session to end.' }));
      return;
    }

    const outputPath = `/tmp/recording-${sessionId}.js`;
    // Clean up any previous recording file
    try { fs.unlinkSync(outputPath); } catch { /* ignore */ }

    const pwBin = findPlaywrightBin();
    const systemChromium = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || '/usr/bin/chromium-browser';
    const codegenProc = spawn(pwBin, ['codegen', '--ignore-https-errors', '--viewport-size=1280,768', `--browser-executable-path=${systemChromium}`, '--output', outputPath, url], {
      stdio: ['ignore', 'pipe', 'pipe'],
      // detached=true creates a new process group so we can kill the whole group
      // (parent playwright codegen + its Chromium child) with a single negative-PID signal
      detached: true,
      env: Object.assign({}, process.env, {
        DISPLAY: vncSlot.display,
        PLAYWRIGHT_BROWSERS_PATH: process.env.PLAYWRIGHT_BROWSERS_PATH || '/ms-playwright',
        // Required for headed Chromium on Xvfb inside Docker — without these flags
        // Chromium attempts GPU acceleration via EGL which fails and renders black.
        PLAYWRIGHT_CHROMIUM_FLAGS: '--disable-gpu --disable-dev-shm-usage --no-sandbox --disable-setuid-sandbox',
      }),
    });

    activeRecordings.set(sessionId, { proc: codegenProc, outputPath, pid: codegenProc.pid, vncToken: vncSlot.token });
    codegenProc.stdout.on('data', (d) => process.stdout.write(`[codegen:${sessionId}] ${d}`));
    codegenProc.stderr.on('data', (d) => process.stdout.write(`[codegen:${sessionId}] ${d}`));
    codegenProc.on('exit', (code) => {
      console.log(`[codegen:${sessionId}] process exited with code ${code}`);
      const rec = activeRecordings.get(sessionId);
      if (rec?.vncToken) releaseVncSlot(rec.vncToken);
      activeRecordings.delete(sessionId);
    });

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, sessionId, pid: codegenProc.pid, vncToken: vncSlot.token }));
    return;
  }

  // POST /record/stop — kill codegen and return the recorded script
  if (req.method === 'POST' && req.url === '/record/stop') {
    let body;
    try {
      const raw = await collectBody(req);
      body = JSON.parse(raw);
    } catch {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid JSON body' }));
      return;
    }

    const { sessionId = 'default' } = body;
    const recording = activeRecordings.get(sessionId);

    if (!recording) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'No active recording for this session' }));
      return;
    }

    // Kill the entire process group (parent playwright + its Chromium child).
    // Using negative PID works because we spawned with detached:true.
    try { process.kill(-recording.pid, 'SIGTERM'); } catch { /* already exited */ }
    // Give Playwright 1 s to flush the --output file, then hard-kill the group
    await new Promise((r) => setTimeout(r, 1000));
    try { process.kill(-recording.pid, 'SIGKILL'); } catch { /* already dead */ }
    if (recording.vncToken) releaseVncSlot(recording.vncToken);
    activeRecordings.delete(sessionId);

    // Give Playwright up to 3 s to flush the output file
    let playwrightCode = '';
    for (let i = 0; i < 15; i++) {
      await new Promise((resolve) => setTimeout(resolve, 200));
      if (fs.existsSync(recording.outputPath)) {
        playwrightCode = fs.readFileSync(recording.outputPath, 'utf8');
        if (playwrightCode.trim().length > 0) break;
      }
    }

    // Clean up
    try { fs.unlinkSync(recording.outputPath); } catch { /* ignore */ }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, playwrightCode }));
    return;
  }

  // POST /record/cancel — kill codegen without saving (user hit Cancel)
  if (req.method === 'POST' && req.url === '/record/cancel') {
    let body;
    try {
      const raw = await collectBody(req);
      body = JSON.parse(raw);
    } catch {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid JSON body' }));
      return;
    }

    const { sessionId = 'default' } = body;
    const recording = activeRecordings.get(sessionId);

    if (recording) {
      try { process.kill(-recording.pid, 'SIGTERM'); } catch { /* already exited */ }
      await new Promise((r) => setTimeout(r, 500));
      try { process.kill(-recording.pid, 'SIGKILL'); } catch { /* already dead */ }
      if (recording.vncToken) releaseVncSlot(recording.vncToken);
      activeRecordings.delete(sessionId);
      try { fs.unlinkSync(recording.outputPath); } catch { /* ignore */ }
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, cancelled: !!recording }));
    return;
  }

  // 404 for everything else
  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Not found' }));
});

server.listen(PORT, () => {
  const bin = findPlaywrightBin();
  console.log(`[qa-runner] HTTP server listening on port ${PORT}`);
  console.log(`[qa-runner] Playwright binary: ${bin} (exists: ${fs.existsSync(bin)})`);
  console.log(`[qa-runner] NODE_PATH will be: /app/node_modules:/app/packages/runner/node_modules`);
  // Start VNC stack so "Run in Host Browser" has a display ready
  startVncStack();
});
