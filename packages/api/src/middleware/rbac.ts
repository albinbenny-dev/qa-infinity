import { Request, Response, NextFunction } from 'express';

export type ProjectRole = 'ADMIN' | 'QA_ENGINEER' | 'VIEWER';

/**
 * requireRole — project-level RBAC gate.
 *
 * Must run after verifyToken + requireProjectAccess (which sets req.projectMember).
 * SUPER_ADMIN global role bypasses all project-level role checks.
 *
 * Role hierarchy (spec):
 *   ADMIN      — all operations
 *   QA_ENGINEER — read/write TCs, scripts, runs, heals, chat — no project deletion or member management
 *   VIEWER     — GET only everywhere
 *
 * @param roles — project roles that are allowed to perform this action
 *
 * @example
 *   // Only project ADMIN may delete:
 *   router.delete('/:id', requireProjectAccess, requireRole(['ADMIN']), handler);
 *
 *   // ADMIN or QA_ENGINEER may write:
 *   router.post('/', requireProjectAccess, requireRole(['ADMIN', 'QA_ENGINEER']), handler);
 */
export function requireRole(roles: ProjectRole[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    // SUPER_ADMIN bypasses all project-level role restrictions
    if (req.user?.globalRole === 'SUPER_ADMIN') {
      next();
      return;
    }

    const memberRole = req.projectMember?.role as ProjectRole | undefined;

    if (!memberRole) {
      res.status(403).json({ error: 'Project membership required' });
      return;
    }

    if (!roles.includes(memberRole)) {
      res.status(403).json({
        error: 'Insufficient permissions for this action',
        required: roles,
        current: memberRole,
      });
      return;
    }

    next();
  };
}

/**
 * requireWrite — blocks VIEWER role from any mutating operation.
 * Equivalent to requireRole(['ADMIN', 'QA_ENGINEER']).
 */
export const requireWrite = requireRole(['ADMIN', 'QA_ENGINEER']);

/**
 * requireAdmin — restricts to project ADMIN only.
 * Use for: project deletion, member management, env config changes.
 * Equivalent to requireRole(['ADMIN']).
 */
export const requireAdmin = requireRole(['ADMIN']);
