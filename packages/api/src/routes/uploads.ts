import { Router, Request, Response, NextFunction, RequestHandler } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { verifyToken } from '../middleware/auth.js';

const router = Router();

router.use(verifyToken as RequestHandler);

const UPLOAD_TMP = process.env.UPLOAD_TMP ?? '/tmp/uploads';

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    try {
      fs.mkdirSync(UPLOAD_TMP, { recursive: true });
      cb(null, UPLOAD_TMP);
    } catch (err) {
      cb(err as Error, UPLOAD_TMP);
    }
  },
  filename: (_req, file, cb) => {
    const safe = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
    cb(null, `${Date.now()}-${safe}`);
  },
});

const ALLOWED_MIMES = new Set([
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/msword',
  'text/plain',
  'text/markdown',
]);

const ALLOWED_EXTS = new Set(['.pdf', '.xlsx', '.xls', '.docx', '.doc', '.txt', '.md']);

const fileFilter = (
  _req: Request,
  file: Express.Multer.File,
  cb: multer.FileFilterCallback,
) => {
  const ext = path.extname(file.originalname).toLowerCase();
  // Some browsers/OS send application/octet-stream for Office files — trust the extension
  if (ALLOWED_MIMES.has(file.mimetype) || (file.mimetype === 'application/octet-stream' && ALLOWED_EXTS.has(ext))) {
    cb(null, true);
  } else {
    cb(new Error(`File type "${file.mimetype}" not supported`));
  }
};

const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: parseInt(process.env.MAX_UPLOAD_BYTES ?? '20971520', 10) },
});

router.post('/', (req: Request, res: Response, next: NextFunction) => {
  upload.single('file')(req, res, (err) => {
    if (err instanceof multer.MulterError) {
      res.status(400).json({ error: `Upload error: ${err.message}` });
      return;
    }
    if (err instanceof Error) {
      res.status(400).json({ error: err.message });
      return;
    }
    next();
  });
}, async (req: Request, res: Response) => {
  const file = req.file;
  if (!file) {
    res.status(400).json({ error: 'No file uploaded. Use multipart/form-data with field "file"' });
    return;
  }

  res.status(201).json({
    filePath: file.path,
    filename: file.originalname,
    mimeType: file.mimetype,
    size: file.size,
  });
});

export default router;
