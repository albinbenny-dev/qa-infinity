import { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { useProjectStore } from '../../stores/projectStore';
import { useChatSidebarStore } from '../../stores/chatSidebarStore';
import { clearAuth } from '../../lib/auth';
import { getInitials, PROJECT_GRADIENTS } from '../../lib/utils';
import { useHealStats } from '../../hooks/useHeals';
import { useSchedules } from '../../hooks/useRuns';
import { useRBAC } from '../../hooks/useRBAC';
import { useAppConfig } from '../../context/AppConfig';
import type { NavSection } from '../../types';

interface SidebarProps {
  slug?: string;
}

const COLLAPSED_WIDTH = 52;
const EXPANDED_WIDTH  = 216;

function getCollapsed(): boolean {
  try { return localStorage.getItem('sb-collapsed') !== 'false'; } catch { return true; }
}

export default function Sidebar({ slug }: SidebarProps) {
  const location  = useLocation();
  const navigate  = useNavigate();
  const qc        = useQueryClient();
  const { activeProject, projects, currentUser, setCurrentUser } = useProjectStore();
  const { mode: chatMode, toggle: toggleChat } = useChatSidebarStore();
  const [collapsed, setCollapsed] = useState<boolean>(getCollapsed);
  const [logoutHover, setLogoutHover] = useState(false);

  function toggleCollapsed() {
    setCollapsed(v => {
      try { localStorage.setItem('sb-collapsed', String(!v)); } catch { /* */ }
      return !v;
    });
  }

  function handleLogout() {
    clearAuth();
    setCurrentUser(null);
    qc.clear();
    navigate('/login', { replace: true });
  }

  const projectId = activeProject?.id ?? '';
  const { canAccessHealing } = useRBAC();
  const { data: healStats }  = useHealStats(projectId || undefined);
  const { data: schedules = [] } = useSchedules(projectId || undefined);
  const activeScheduleCount = schedules.filter(s => s.isActive).length;
  const { mode: appMode } = useAppConfig();
  const isRunner = appMode === 'runner';

  const navSections: NavSection[] = slug ? [
    {
      label: 'Overview',
      items: [
        { label: 'Dashboard',     path: `/projects/${slug}/dashboard`,  icon: '▦' },
        { label: 'TC Library',    path: `/projects/${slug}/tc-library`, icon: '📋', badge: activeProject?._count?.testCases ?? undefined, badgeVariant: 'green' },
        ...(!isRunner ? [{ label: 'Product Skills', path: `/projects/${slug}/skills`, icon: '🧠' }] : []),
      ],
    },
    {
      label: isRunner ? 'Testing' : 'Agents',
      items: [
        ...(!isRunner ? [{ label: 'Test Writer',    path: `/projects/${slug}/writer`,    icon: '✍', aiLabel: true }] : []),
        { label: isRunner ? 'Scripts' : 'Script Agent', path: `/projects/${slug}/scripts`,   icon: '⌨', ...(!isRunner && { aiLabel: true }) },
        { label: 'Execution',     path: `/projects/${slug}/execution`,  icon: '▶' },
        { label: 'Scheduler',     path: `/projects/${slug}/scheduler`,  icon: '⏰', badge: activeScheduleCount || undefined, badgeVariant: 'blue' },
        ...(!isRunner && canAccessHealing ? [{ label: 'Healing Agent', path: `/projects/${slug}/healing`, icon: '⟳', badge: healStats?.pending || undefined, badgeVariant: 'red' as const, aiLabel: true }] : []),
      ],
    },
    {
      label: 'Analytics',
      items: [
        { label: 'Reports',    path: `/projects/${slug}/reports`, icon: '📊' },
        ...(!isRunner ? [{ label: 'Chat Agent', path: `/projects/${slug}/chat`, icon: '💬', aiLabel: true, onClick: () => toggleChat() }] : []),
      ],
    },
    {
      label: 'Project Tools',
      items: [
        { label: 'Export',   path: `/projects/${slug}/copy-export`, icon: '📤' },
        { label: 'Settings', path: `/projects/${slug}/settings`,    icon: '⚙' },
      ],
    },
  ] : [];

  const isActive = (path: string) => {
    if (location.pathname === path) return true;
    if (path.endsWith('/test-cycles') && location.pathname.startsWith(path + '/')) return true;
    return false;
  };

  const gradientIndex  = activeProject ? activeProject.id.charCodeAt(0) % PROJECT_GRADIENTS.length : 0;
  const projectColor   = activeProject?.color ?? PROJECT_GRADIENTS[gradientIndex];

  const width = collapsed ? COLLAPSED_WIDTH : EXPANDED_WIDTH;

  // ── Shared style builders ─────────────────────────────────────────────────

  function iconItemStyle(active: boolean, hover: boolean): React.CSSProperties {
    return {
      display: 'flex',
      alignItems: 'center',
      justifyContent: collapsed ? 'center' : 'flex-start',
      gap: collapsed ? 0 : 8,
      width: '100%',
      height: 36,
      borderRadius: 8,
      padding: collapsed ? '0' : '0 8px',
      cursor: 'pointer',
      border: 'none',
      fontFamily: 'var(--font-ui)',
      fontSize: 12,
      fontWeight: active ? 600 : 400,
      transition: 'background 0.12s, color 0.12s',
      background: active ? 'var(--cyan-dim)' : hover ? 'var(--surface2)' : 'transparent',
      color: active ? 'var(--cyan)' : 'var(--text-dim)',
      textDecoration: 'none',
      boxSizing: 'border-box',
      boxShadow: active ? 'inset 2px 0 0 var(--cyan)' : 'none',
      position: 'relative',
      whiteSpace: 'nowrap',
      overflow: 'hidden',
    };
  }

  return (
    <aside
      style={{
        width,
        minWidth: width,
        flexShrink: 0,
        background: 'var(--surface)',
        borderRight: '1px solid var(--border)',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'visible',
        height: '100%',
        transition: 'width 0.2s ease, min-width 0.2s ease',
        position: 'relative',
        zIndex: 20,
      }}
    >
      {/* ── Project badge + expand toggle ─────────────────────────────────── */}
      <div style={{
        padding: collapsed ? '12px 8px 10px' : '12px 10px 10px',
        borderBottom: '1px solid var(--border)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: collapsed ? 'center' : 'space-between',
        gap: 8,
      }}>
        {/* Project avatar — always visible */}
        <div
          onClick={() => slug && navigate(`/projects/${slug}/settings`)}
          title={activeProject?.name ?? 'Project'}
          style={{
            width: 34,
            height: 34,
            borderRadius: 9,
            background: activeProject ? projectColor : 'var(--surface2)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 13,
            fontWeight: 700,
            color: '#fff',
            flexShrink: 0,
            cursor: slug ? 'pointer' : 'default',
          }}
        >
          {activeProject ? getInitials(activeProject.name) : '∞'}
        </div>

        {/* Project name + test count — only when expanded */}
        {!collapsed && activeProject && (
          <div style={{ flex: 1, minWidth: 0, cursor: 'pointer' }} onClick={() => slug && navigate(`/projects/${slug}/settings`)}>
            <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', lineHeight: 1.3 }}>
              {activeProject.name}
            </div>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--text-dim)', marginTop: 1 }}>
              {activeProject._count?.testCases ?? 0} tests
            </div>
          </div>
        )}

        {/* Expand / collapse toggle */}
        <button
          onClick={toggleCollapsed}
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          style={{
            width: 24,
            height: 24,
            borderRadius: 6,
            border: '1px solid var(--border)',
            background: 'transparent',
            color: 'var(--text-dim)',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 11,
            flexShrink: 0,
            transition: 'background 0.1s, color 0.1s',
          }}
          onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = 'var(--surface2)'; (e.currentTarget as HTMLButtonElement).style.color = 'var(--text)'; }}
          onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = 'transparent'; (e.currentTarget as HTMLButtonElement).style.color = 'var(--text-dim)'; }}
        >
          {collapsed ? '›' : '‹'}
        </button>
      </div>

      {/* ── All Projects link ──────────────────────────────────────────────── */}
      {!collapsed && (
        <div style={{ padding: '6px 8px', borderBottom: '1px solid var(--border)' }}>
          <NavLink path="/projects" label="All Projects" icon="🌐" isActive={location.pathname === '/projects'} collapsed={false}
            badge={projects.length > 0 ? projects.length : undefined} badgeVariant="blue" />
          {!isRunner && (
            <NavLink path="/usage" label="AI Usage" icon="💳" isActive={location.pathname === '/usage'} collapsed={false} />
          )}
          {currentUser?.globalRole === 'SUPER_ADMIN' && (
            <NavLink path="/admin/users" label="User Mgmt" icon="👤" isActive={location.pathname === '/admin/users'} collapsed={false}
              badge="ADMIN" badgeVariant="admin" />
          )}
        </div>
      )}

      {/* ── Nav sections ──────────────────────────────────────────────────── */}
      <nav style={{ flex: 1, padding: collapsed ? '8px 6px' : '6px 8px', overflowY: 'auto', overflowX: 'visible' }}>
        {navSections.map((section, si) => (
          <div key={section.label}>
            {/* Section divider — thin line when collapsed, label when expanded */}
            {si > 0 && (
              collapsed
                ? <div style={{ height: 1, background: 'var(--border)', margin: '6px 4px' }} />
                : <div className="nav-section-label">{section.label}</div>
            )}
            {collapsed && si === 0 && null}
            {!collapsed && si === 0 && <div className="nav-section-label">{section.label}</div>}

            {section.items.map(item => {
              if (item.onClick) {
                const chatOpen = chatMode === 'expanded';
                return (
                  <NavButton
                    key={item.path}
                    label={item.label}
                    icon={item.icon}
                    active={chatOpen}
                    collapsed={collapsed}
                    aiLabel={item.aiLabel}
                    onClick={item.onClick}
                  />
                );
              }
              return (
                <NavLink
                  key={item.path}
                  path={item.path}
                  label={item.label}
                  icon={item.icon}
                  isActive={isActive(item.path)}
                  collapsed={collapsed}
                  aiLabel={item.aiLabel}
                  badge={item.badge}
                  badgeVariant={item.badgeVariant}
                />
              );
            })}
          </div>
        ))}

        {!slug && !collapsed && (
          <div style={{ padding: '20px 10px', textAlign: 'center', color: 'var(--text-dim)', fontSize: 11, fontFamily: 'var(--font-mono)' }}>
            Select a project to see<br />its navigation
          </div>
        )}
      </nav>

      {/* ── User widget ───────────────────────────────────────────────────── */}
      <div style={{ padding: collapsed ? '8px 6px' : '8px', borderTop: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 8, justifyContent: collapsed ? 'center' : 'flex-start' }}>
        {/* Avatar */}
        <div
          title={currentUser?.name ?? 'User'}
          style={{
            width: 28, height: 28, borderRadius: '50%',
            background: 'linear-gradient(135deg, var(--violet), var(--cyan))',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 11, fontWeight: 700, color: '#fff', flexShrink: 0,
          }}
        >
          {currentUser ? getInitials(currentUser.name) : 'U'}
        </div>

        {!collapsed && (
          <>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {currentUser?.name ?? 'Guest'}
              </div>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--text-dim)', letterSpacing: '1px', textTransform: 'uppercase' }}>
                {currentUser?.globalRole?.replace('_', ' ') ?? 'User'}
              </div>
            </div>
            <button
              onClick={handleLogout}
              onMouseEnter={() => setLogoutHover(true)}
              onMouseLeave={() => setLogoutHover(false)}
              title="Sign out"
              style={{
                flexShrink: 0, width: 26, height: 26, borderRadius: 7,
                border: `1px solid ${logoutHover ? 'rgba(220,38,38,0.4)' : 'var(--border)'}`,
                background: logoutHover ? 'rgba(220,38,38,0.10)' : 'transparent',
                color: logoutHover ? 'var(--fail)' : 'var(--text-dim)',
                cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 13, transition: 'all 0.15s',
              }}
            >
              ⏻
            </button>
          </>
        )}
      </div>
    </aside>
  );
}

// ── NavLink ────────────────────────────────────────────────────────────────

function NavLink({
  path, label, icon, isActive, collapsed, aiLabel, badge, badgeVariant,
}: {
  path: string; label: string; icon: string; isActive: boolean; collapsed: boolean;
  aiLabel?: boolean; badge?: number | string; badgeVariant?: string;
}) {
  const [hover, setHover] = useState(false);

  const style: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    justifyContent: collapsed ? 'center' : 'flex-start',
    gap: collapsed ? 0 : 8,
    width: '100%',
    height: 34,
    borderRadius: 8,
    padding: collapsed ? 0 : '0 8px',
    cursor: 'pointer',
    fontSize: 12,
    fontWeight: isActive ? 600 : 400,
    fontFamily: 'var(--font-ui)',
    transition: 'background 0.12s, color 0.12s, box-shadow 0.12s',
    background: isActive ? 'var(--cyan-dim)' : hover ? 'var(--surface2)' : 'transparent',
    color: isActive ? 'var(--cyan)' : hover ? 'var(--text)' : 'var(--text-dim)',
    textDecoration: 'none',
    boxSizing: 'border-box',
    boxShadow: isActive ? 'inset 2px 0 0 var(--cyan)' : 'none',
    position: 'relative',
    whiteSpace: 'nowrap',
    overflow: collapsed ? 'visible' : 'hidden',
  };

  return (
    <Link
      to={path}
      style={style}
      title={collapsed ? label : undefined}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      <span className="nav-icon">{icon}</span>
      {!collapsed && (
        <>
          <span style={{ flex: 1 }}>{label}</span>
          {aiLabel && <span className="nav-ai-tag">AI</span>}
          {badge !== undefined && (
            <span className={`nav-badge${badgeVariant === 'green' ? ' green' : badgeVariant === 'blue' ? ' blue' : ''}`}
              style={badgeVariant === 'admin' ? { marginLeft: 'auto', background: 'rgba(244,123,32,0.2)', color: 'var(--6d-orange)', fontSize: '8px', padding: '1px 5px' } : undefined}
            >
              {badge}
            </span>
          )}
        </>
      )}
      {/* Badge dot in collapsed mode */}
      {collapsed && badge !== undefined && Number(badge) > 0 && (
        <span style={{
          position: 'absolute', top: 4, right: 4,
          width: 7, height: 7, borderRadius: '50%',
          background: badgeVariant === 'red' ? 'var(--fail)' : badgeVariant === 'green' ? 'var(--emerald)' : 'var(--cyan)',
          border: '1px solid var(--surface)',
        }} />
      )}
    </Link>
  );
}

// ── NavButton (for onClick items like Chat) ────────────────────────────────

function NavButton({
  label, icon, active, collapsed, aiLabel, onClick,
}: {
  label: string; icon: string; active: boolean; collapsed: boolean;
  aiLabel?: boolean; onClick: () => void;
}) {
  const [hover, setHover] = useState(false);

  return (
    <button
      onClick={onClick}
      title={collapsed ? label : undefined}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: collapsed ? 'center' : 'flex-start',
        gap: collapsed ? 0 : 8,
        width: '100%',
        height: 34,
        borderRadius: 8,
        padding: collapsed ? 0 : '0 8px',
        cursor: 'pointer',
        fontSize: 12,
        fontWeight: active ? 600 : 400,
        fontFamily: 'var(--font-ui)',
        border: 'none',
        transition: 'background 0.12s, color 0.12s, box-shadow 0.12s',
        background: active ? 'var(--cyan-dim)' : hover ? 'var(--surface2)' : 'transparent',
        color: active ? 'var(--cyan)' : hover ? 'var(--text)' : 'var(--text-dim)',
        boxSizing: 'border-box',
        boxShadow: active ? 'inset 2px 0 0 var(--cyan)' : 'none',
        textAlign: 'left',
        whiteSpace: 'nowrap',
        overflow: 'hidden',
      }}
    >
      <span className="nav-icon">{icon}</span>
      {!collapsed && (
        <>
          <span style={{ flex: 1 }}>{label}</span>
          {aiLabel && <span className="nav-ai-tag">AI</span>}
        </>
      )}
    </button>
  );
}
