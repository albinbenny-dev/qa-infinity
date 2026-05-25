'use strict';

const http = require('http');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const PORT = 5001;
const SCRIPTS_DIR = '/scripts';
const CONFIG_FILE = 'qa-infinity.playwright.config.js';
const CONFIG_PATH = path.join(SCRIPTS_DIR, CONFIG_FILE);

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
  timeout: 60000,           // hard cap: 60 s per test
  use: {
    actionTimeout: 15000,   // 15 s for each action (fill, click, …)
    navigationTimeout: 20000, // 20 s for page loads / waitForNavigation
    baseURL: process.env.BASE_URL || '',
    screenshot: 'on',
    trace: 'on-first-retry',
    ignoreHTTPSErrors: true,
    video: 'on',
  },
  projects: [
    { name: 'chromium', use: { browserName: 'chromium' } },
    { name: 'firefox',  use: { browserName: 'firefox'  } },
    { name: 'webkit',   use: { browserName: 'webkit'   } },
  ],
};
`;

function writeConfig() {
  fs.writeFileSync(CONFIG_PATH, CONFIG_CONTENT, 'utf8');
}

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
    } = body;

    if (!scriptPath || !reportFile) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'scriptPath and reportFile are required' }));
      return;
    }

    // Write playwright config
    try {
      writeConfig();
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Failed to write playwright config: ' + err.message }));
      return;
    }

    // Build args — always headed for screenshot/video capture
    const args = [
      'test',
      path.basename(scriptPath),
      `--config=${CONFIG_FILE}`,
      '--reporter=list',
      '--reporter=json',
      `--workers=${workers}`,
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

    // Start streaming response
    res.writeHead(200, {
      'Content-Type': 'application/x-ndjson',
      'Transfer-Encoding': 'chunked',
    });

    const start = Date.now();
    const playwrightBin = findPlaywrightBin();

    // Always use xvfb-run for virtual display inside Docker
    const spawnCmd = 'xvfb-run';
    const spawnArgs = [
      '--auto-servernum',
      '--server-args=-screen 0 1920x1080x24',
      playwrightBin,
      ...args,
    ];

    const proc = spawn(spawnCmd, spawnArgs, {
      cwd: SCRIPTS_DIR,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let procDone = false;

    // Kill the Playwright process immediately when the API worker disconnects
    // (e.g. user clicked Stop Run, which aborts the fetch on the worker side)
    req.on('close', () => {
      if (!procDone && !proc.killed) {
        proc.kill('SIGTERM');
        setTimeout(() => { if (!proc.killed) proc.kill('SIGKILL'); }, 3000);
      }
      clearTimeout(killTimer);
    });

    // Hard-kill the browser process if it hasn't exited within 90 s
    // (Playwright's own 60 s test timeout + 30 s browser-startup / shutdown buffer)
    const HARD_KILL_MS = 90_000;
    const killTimer = setTimeout(() => {
      sendLine({ type: 'log', text: `[runner] Script exceeded ${HARD_KILL_MS / 1000}s hard limit — killing process` });
      proc.kill('SIGTERM');
      setTimeout(() => proc.kill('SIGKILL'), 5_000);
    }, HARD_KILL_MS);

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

    proc.stdout.on('data', handleChunk);
    proc.stderr.on('data', handleChunk);

    proc.on('close', (exitCode) => {
      procDone = true;
      clearTimeout(killTimer);
      let reportData = null;
      try {
        if (fs.existsSync(reportFile)) {
          reportData = JSON.parse(fs.readFileSync(reportFile, 'utf8'));
        }
      } catch { /* ignore parse errors */ }

      sendLine({ type: 'done', exitCode: exitCode ?? 1, reportData });
      res.end();
    });

    proc.on('error', (err) => {
      clearTimeout(killTimer);
      sendLine({ type: 'done', exitCode: 1, reportData: null, error: err.message });
      res.end();
    });

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
});
