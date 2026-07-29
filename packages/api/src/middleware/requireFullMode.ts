import type { Request, Response, NextFunction } from 'express';

export function requireFullMode(req: Request, res: Response, next: NextFunction) {
  if (process.env.APP_MODE === 'runner') {
    res.status(403).json({ error: 'AI features are disabled in runner mode' });
    return;
  }
  next();
}
