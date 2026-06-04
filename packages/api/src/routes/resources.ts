'use strict';
import { Router, RequestHandler } from 'express';
import multer from 'multer';
import { prisma } from '../lib/prisma.js';
import { verifyToken } from '../middleware/auth.js';
import { requireProjectAccess } from '../middleware/projectAccess.js';
import fs from 'fs';
import path from 'path';
import {
  saveResourceFile,
  deleteResourceFile,
  listResourceFiles,
  resourcesDir,
} from '../services/scriptFileService.js';

const router = Router({ mergeParams: true });

router.use(verifyToken as RequestHandler);
router.use(requireProjectAccess as unknown as RequestHandler);

// ── Multer — only .robot files, 2 MB max ──────────────────────────────────

const resourceUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (file.originalname.endsWith('.robot')) cb(null, true);
    else cb(new Error('Only .robot resource files are allowed'));
  },
});

// ── GET / — list resource files ───────────────────────────────────────────

router.get('/', (async (req, res) => {
  const { projectId } = req.params;
  try {
    const rows = await prisma.projectResource.findMany({
      where: { projectId },
      orderBy: { uploadedAt: 'desc' },
    });
    // Merge DB rows with live filesystem size
    const fsMeta = listResourceFiles(projectId);
    const fsMap = new Map(fsMeta.map((f) => [f.filename, f]));
    const result = rows.map((r) => ({
      id:           r.id,
      filename:     r.filename,
      originalName: r.originalName,
      size:         fsMap.get(r.filename)?.size ?? r.size,
      uploadedAt:   r.uploadedAt.toISOString(),
      resourcesDir: resourcesDir(projectId),
    }));
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
}) as RequestHandler);

// ── POST / — upload a resource file ──────────────────────────────────────

router.post('/', resourceUpload.single('file'), (async (req, res) => {
  const { projectId } = req.params;
  if (!req.file) {
    res.status(400).json({ error: 'No file uploaded' });
    return;
  }

  const originalName = req.file.originalname;
  // Sanitise filename: keep only safe chars
  const filename = originalName.replace(/[^a-zA-Z0-9._-]/g, '_');

  try {
    saveResourceFile(projectId, filename, req.file.buffer);

    const record = await prisma.projectResource.upsert({
      where:  { projectId_filename: { projectId, filename } },
      update: { originalName, size: req.file.size, uploadedAt: new Date() },
      create: { projectId, filename, originalName, size: req.file.size },
    });

    res.status(201).json({
      id:           record.id,
      filename:     record.filename,
      originalName: record.originalName,
      size:         record.size,
      uploadedAt:   record.uploadedAt.toISOString(),
      resourcesDir: resourcesDir(projectId),
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
}) as RequestHandler);

// ── GET /:filename/content — read resource file text ─────────────────────

router.get('/:filename/content', (async (req, res) => {
  const { projectId, filename } = req.params;
  const filePath = path.join(resourcesDir(projectId), filename);
  if (!fs.existsSync(filePath)) {
    res.status(404).json({ error: 'Resource file not found' });
    return;
  }
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    res.json({ content });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
}) as RequestHandler);

// ── PUT /:filename/content — save resource file text ─────────────────────

router.put('/:filename/content', (async (req, res) => {
  const { projectId, filename } = req.params;
  const { content } = req.body as { content?: string };
  if (typeof content !== 'string') {
    res.status(400).json({ error: 'content is required' });
    return;
  }
  const filePath = path.join(resourcesDir(projectId), filename);
  if (!fs.existsSync(filePath)) {
    res.status(404).json({ error: 'Resource file not found' });
    return;
  }
  try {
    fs.writeFileSync(filePath, content, 'utf-8');
    // Update DB size
    await prisma.projectResource.updateMany({
      where: { projectId, filename },
      data: { size: Buffer.byteLength(content, 'utf-8') },
    });
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
}) as RequestHandler);

// ── POST /init-defaults — auto-create starter resource files ─────────────
// Creates common_keywords.robot, variables.robot, navigation_helpers.robot,
// and assertions.robot if they don't already exist. Safe to call repeatedly.

const DEFAULT_RESOURCES: Array<{ filename: string; content: string }> = [
  {
    filename: 'common_keywords.robot',
    content: `*** Settings ***
Library    Browser

*** Keywords ***
Login As User
    [Arguments]    \${username}    \${password}
    # Purpose: Authenticates a user via the standard login form
    Navigate To    \${LOGIN_URL}
    Fill Text      id=username    \${username}
    Fill Text      id=password    \${password}
    Click          id=submit-btn
    Wait For Elements State    css=.dashboard-header    visible    \${TIMEOUT}

Accept Cookie Banner
    # Purpose: Dismisses cookie consent banner — safe to call even when no banner is present
    Run Keyword And Ignore Error    Click    css=.cookie-accept

Wait For Page Ready
    [Arguments]    \${state}=networkidle
    # Purpose: Waits for the page to finish loading (SPA-friendly)
    Wait For Load State    \${state}
`,
  },
  {
    filename: 'variables.robot',
    content: `*** Variables ***
\${BASE_URL}          \${EMPTY}    # Set at runtime via --variable BASE_URL:...
\${LOGIN_URL}         \${BASE_URL}/login
\${TC_USERNAME}       \${EMPTY}    # Set at runtime via --variable TC_USERNAME:...
\${TC_PASSWORD}       \${EMPTY}    # Set at runtime via --variable TC_PASSWORD:...
\${TIMEOUT}           30s
\${BROWSER}           chromium
\${SCREENSHOT_DIR}    \${OUTPUTDIR}
`,
  },
  {
    filename: 'navigation_helpers.robot',
    content: `*** Settings ***
Library    Browser

*** Keywords ***
Go To Dashboard
    # Purpose: Navigates to the main dashboard and waits for it to load
    Navigate To    \${BASE_URL}/dashboard
    Wait For Load State    networkidle

Go To Settings
    # Purpose: Navigates to the settings page and waits for it to load
    Navigate To    \${BASE_URL}/settings
    Wait For Load State    networkidle

Go To Login
    # Purpose: Navigates to the login page
    Navigate To    \${LOGIN_URL}
    Wait For Elements State    id=username    visible    \${TIMEOUT}
`,
  },
  {
    filename: 'assertions.robot',
    content: `*** Settings ***
Library    Browser
Library    String

*** Keywords ***
Assert Page Title Contains
    [Arguments]    \${expected}
    # Purpose: Asserts that the page <title> contains the expected string
    \${title}=    Get Title
    Should Contain    \${title}    \${expected}

Assert URL Contains
    [Arguments]    \${fragment}
    # Purpose: Asserts that the current URL contains the expected path fragment
    \${url}=    Get Url
    Should Contain    \${url}    \${fragment}

Assert Element Text Equals
    [Arguments]    \${locator}    \${expected}
    # Purpose: Asserts visible text of an element exactly matches expected value
    \${text}=    Get Text    \${locator}
    Should Be Equal    \${text}    \${expected}

Assert Element Visible
    [Arguments]    \${locator}
    # Purpose: Asserts that an element is visible on the page
    Wait For Elements State    \${locator}    visible    \${TIMEOUT}

Assert Element Hidden
    [Arguments]    \${locator}
    # Purpose: Asserts that an element is hidden or does not exist
    Wait For Elements State    \${locator}    hidden    \${TIMEOUT}
`,
  },
];

router.post('/init-defaults', (async (req, res) => {
  const { projectId } = req.params;
  const created: string[] = [];
  const skipped: string[] = [];

  try {
    for (const { filename, content } of DEFAULT_RESOURCES) {
      const filePath = path.join(resourcesDir(projectId), filename);
      if (fs.existsSync(filePath)) {
        skipped.push(filename);
        continue;
      }
      const buf = Buffer.from(content, 'utf-8');
      saveResourceFile(projectId, filename, buf);
      await prisma.projectResource.upsert({
        where:  { projectId_filename: { projectId, filename } },
        update: { originalName: filename, size: buf.length, uploadedAt: new Date() },
        create: { projectId, filename, originalName: filename, size: buf.length },
      });
      created.push(filename);
    }
    res.json({ created, skipped });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
}) as RequestHandler);

// ── GET /health — resource health stats ──────────────────────────────────

router.get('/health', (async (req, res) => {
  const { projectId } = req.params;
  try {
    const resources = listResourceFiles(projectId);
    const SCRIPTS_ROOT = process.env.SCRIPTS_ROOT ?? '/scripts';
    const scriptDir = path.join(SCRIPTS_ROOT, projectId);

    // Read all robot scripts to count keyword usages
    let scriptCount = 0;
    const keywordUsage: Record<string, number> = {};
    if (fs.existsSync(scriptDir)) {
      const robotFiles = fs.readdirSync(scriptDir).filter(f => f.endsWith('.robot'));
      scriptCount = robotFiles.length;
      for (const rf of robotFiles) {
        const content = fs.readFileSync(path.join(scriptDir, rf), 'utf-8');
        // Count how many scripts import each resource
        for (const res of resources) {
          const base = res.filename.replace(/\.robot$/, '');
          if (content.includes(`resources/${res.filename}`) || content.includes(base)) {
            keywordUsage[res.filename] = (keywordUsage[res.filename] ?? 0) + 1;
          }
        }
      }
    }

    const healthData = resources.map(r => {
      const filePath = path.join(resourcesDir(projectId), r.filename);
      const stat = fs.statSync(filePath);
      const content = fs.readFileSync(filePath, 'utf-8');
      const keywordMatches = content.match(/^[A-Za-z][^\n]+\n(?:    |\t)/gm) ?? [];
      return {
        filename:     r.filename,
        size:         r.size,
        lastUpdated:  stat.mtime.toISOString(),
        keywordCount: keywordMatches.length,
        usedInScripts: keywordUsage[r.filename] ?? 0,
      };
    });

    res.json({ scriptCount, resources: healthData });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
}) as RequestHandler);

// ── DELETE /:filename — remove a resource file ────────────────────────────

router.delete('/:filename', (async (req, res) => {
  const { projectId, filename } = req.params;
  try {
    deleteResourceFile(projectId, filename);
    await prisma.projectResource.deleteMany({ where: { projectId, filename } });
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
}) as RequestHandler);

export default router;
