'use strict';

const http = require('http');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const PORT = 5001;
const SCRIPTS_DIR = '/scripts';
const CONFIG_FILE = 'qa-infinity.playwright.config.js';
const CONFIG_PATH = path.join(SCRIPTS_DIR, CONFIG_FILE);

// Robot Framework binary — prefer venv path, fall back to PATH
const ROBOT_BIN = fs.existsSync('/opt/rfbrowser/bin/robot')
  ? '/opt/rfbrowser/bin/robot'
  : 'robot';

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

    tests.push({ name, status, durationMs, errorMsg });
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
    { name: 'chromium', use: { browserName: 'chromium', viewport: { width: 1280, height: 720 }, launchOptions: { args: ['--disable-blink-features=AutomationControlled'] } } },
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

    const HARD_KILL_MS = 900_000;
    let proc;
    let procDone = false;

    // ── Robot Framework execution path ──────────────────────────────────────
    if (scriptPath.endsWith('.robot')) {
      const scriptDir = path.dirname(scriptPath);
      const projectId = path.basename(scriptDir);
      const resourcesSrcDir = path.join(SCRIPTS_DIR, projectId, 'resources');

      // Copy resource files into script dir so relative Resource imports resolve
      if (fs.existsSync(resourcesSrcDir)) {
        const resFiles = fs.readdirSync(resourcesSrcDir).filter(f => f.endsWith('.robot'));
        const destResDir = path.join(scriptDir, 'resources');
        fs.mkdirSync(destResDir, { recursive: true });
        for (const rf of resFiles) {
          fs.copyFileSync(path.join(resourcesSrcDir, rf), path.join(destResDir, rf));
        }
      }

      const effectiveOutputDir = outputDir || path.join('/artifacts', projectId, path.basename(scriptPath, '.robot'));
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

      const robotArgs = [
        '--outputdir', effectiveOutputDir,
        '--output', 'output.xml',
        '--report', 'NONE',
        '--log', 'NONE',
        '--listener', `${listenerPath}:${effectiveOutputDir}`,
        '--variable', `BASE_URL:${baseUrl || ''}`,
        '--variable', `TC_USERNAME:${username || ''}`,
        '--variable', `TC_PASSWORD:${password || ''}`,
        '--variable', `OUTPUTDIR:${effectiveOutputDir}`,
        scriptPath,
      ];

      const robotEnv = Object.assign({}, process.env, {
        BASE_URL: baseUrl || '',
        TC_USERNAME: username || '',
        TC_PASSWORD: password || '',
        TEST_ENV: environment || '',
      });

      const spawnCmd = 'xvfb-run';
      const spawnArgs = [
        '--auto-servernum',
        '--server-args=-screen 0 1920x1080x24',
        ROBOT_BIN,
        ...robotArgs,
      ];

      proc = spawn(spawnCmd, spawnArgs, {
        cwd: scriptDir,
        env: robotEnv,
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      const killTimer = setTimeout(() => {
        sendLine({ type: 'log', text: `[runner] Robot script exceeded ${HARD_KILL_MS / 1000}s hard limit — killing` });
        proc.kill('SIGTERM');
        setTimeout(() => proc.kill('SIGKILL'), 5_000);
      }, HARD_KILL_MS);

      req.on('close', () => {
        if (!procDone && !proc.killed) {
          proc.kill('SIGTERM');
          setTimeout(() => { if (!proc.killed) proc.kill('SIGKILL'); }, 3000);
        }
        clearTimeout(killTimer);
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
        const reportData = parseRobotXmlReport(xmlOutputPath);
        // Build a compact error snippet from the last N lines that contain 'FAIL', 'Error', or 'Exception'
        const errorLines = outputLines.filter(l => /FAIL|Error|Exception|Critical/i.test(l)).slice(-5).join(' | ');

        // Scan output dir for screenshots and videos produced by RF Browser library
        let screenshotPath = null;
        let videoPath = null;
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
          scanDir(effectiveOutputDir);
        } catch { /* non-fatal */ }

        sendLine({ type: 'done', exitCode: exitCode ?? 1, reportData, screenshotPath, videoPath, errorSnippet: errorLines || null });
        res.end();
      });

      proc.on('error', (err) => {
        clearTimeout(killTimer);
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

    const playwrightBin = findPlaywrightBin();

    // Always use xvfb-run for virtual display inside Docker
    const spawnCmd = 'xvfb-run';
    const spawnArgs = [
      '--auto-servernum',
      '--server-args=-screen 0 1920x1080x24',
      playwrightBin,
      ...args,
    ];

    proc = spawn(spawnCmd, spawnArgs, {
      cwd: SCRIPTS_DIR,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    // Kill the Playwright process immediately when the API worker disconnects
    // (e.g. user clicked Stop Run, which aborts the fetch on the worker side)
    req.on('close', () => {
      if (!procDone && !proc.killed) {
        proc.kill('SIGTERM');
        setTimeout(() => { if (!proc.killed) proc.kill('SIGKILL'); }, 3000);
      }
      clearTimeout(killTimer);
    });

    // Hard-kill the browser process if it hasn't exited within 15 min
    // (accommodates multi-step workflow tests that use test.setTimeout up to 600 s + startup/shutdown buffer)
    const killTimer = setTimeout(() => {
      sendLine({ type: 'log', text: `[runner] Script exceeded ${HARD_KILL_MS / 1000}s hard limit — killing process` });
      proc.kill('SIGTERM');
      setTimeout(() => proc.kill('SIGKILL'), 5_000);
    }, HARD_KILL_MS);

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
