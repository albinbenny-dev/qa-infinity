import { Router, Request, Response } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import JSZip from 'jszip';

const router = Router();

const EXTENSION_DIR =
  process.env.EXTENSION_DIR ??
  path.resolve(process.cwd(), 'packages/extension/dist');

function addDirToZip(zip: JSZip, dirPath: string, prefix: string) {
  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);
    const zipKey = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      addDirToZip(zip, fullPath, zipKey);
    } else {
      zip.file(zipKey, fs.readFileSync(fullPath));
    }
  }
}

// GET /api/extension/download — streams the extension dist as a zip
router.get('/download', async (_req: Request, res: Response) => {
  try {
    if (!fs.existsSync(EXTENSION_DIR)) {
      res.status(404).json({ error: 'Extension dist not found on server' });
      return;
    }

    const zip = new JSZip();
    const folder = zip.folder('qa-infinity-extension')!;
    addDirToZip(folder, EXTENSION_DIR, '');

    const buffer = await zip.generateAsync({
      type: 'nodebuffer',
      compression: 'DEFLATE',
      compressionOptions: { level: 6 },
    });

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', 'attachment; filename="qa-infinity-extension.zip"');
    res.setHeader('Content-Length', buffer.length);
    res.send(buffer);
  } catch (err: any) {
    console.error('[extension/download]', err);
    res.status(500).json({ error: 'Failed to generate extension zip' });
  }
});

export default router;
