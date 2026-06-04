import { useProjectStore } from '../stores/projectStore';
import type { ProjectRole } from '../types';

interface RBACResult {
  /** The user's project-level role, or null if not a member */
  role: ProjectRole | null;
  /** True when globalRole === 'SUPER_ADMIN' — bypasses all project restrictions */
  isSuperAdmin: boolean;
  /** Project ADMIN — full control over members, deletion, all writes */
  isAdmin: boolean;
  /** QA_ENGINEER — can read/write TCs, scripts, runs, heals, chat */
  isQAEngineer: boolean;
  /** VIEWER — read-only everywhere; no action buttons */
  isViewer: boolean;
  /** canWrite = ADMIN | QA_ENGINEER: may create/update/run/approve */
  canWrite: boolean;
  /** canManageMembers = ADMIN only */
  canManageMembers: boolean;
  /** canDeleteProject = ADMIN only */
  canDeleteProject: boolean;
}

/**
 * useRBAC — returns the current user's effective permissions for the active project.
 *
 * Reads `activeProject.myRole` (set by GET /projects response) and `currentUser.globalRole`.
 * SUPER_ADMIN has full access regardless of project membership.
 *
 * Usage:
 *   const { canWrite, canDeleteProject, isViewer } = useRBAC();
 *   {canWrite && <button>Generate</button>}
 *   {!isViewer && <button>Run</button>}
 */
export function useRBAC(): RBACResult {
  const { currentUser, activeProject } = useProjectStore();

  const isSuperAdmin = currentUser?.globalRole === 'SUPER_ADMIN';

  if (isSuperAdmin) {
    return {
      role: null,
      isSuperAdmin: true,
      isAdmin: true,
      isQAEngineer: true,
      isViewer: false,
      canWrite: true,
      canManageMembers: true,
      canDeleteProject: true,
    };
  }

  const role = (activeProject?.myRole as ProjectRole) ?? null;

  return {
    role,
    isSuperAdmin: false,
    isAdmin: role === 'ADMIN',
    isQAEngineer: role === 'QA_ENGINEER',
    isViewer: role === 'VIEWER',
    canWrite: role === 'ADMIN' || role === 'QA_ENGINEER',
    canManageMembers: role === 'ADMIN',
    canDeleteProject: role === 'ADMIN',
  };
}
