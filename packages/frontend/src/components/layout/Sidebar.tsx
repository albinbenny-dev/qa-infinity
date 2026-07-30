import { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import {
  LayoutDashboard, ClipboardList, Brain, PenLine, Code2,
  Play, Clock, RefreshCw, BarChart2, MessageSquare,
  Upload, Settings, Globe, CreditCard, User, LogOut,
  ChevronsRight, ChevronsLeft,
  type LucideIcon,
} from 'lucide-react';
import { useProjectStore } from '../../stores/projectStore';
import { useChatSidebarStore } from '../../stores/chatSidebarStore';
import { clearAuth } from '../../lib/auth';
import { getInitials, PROJECT_GRADIENTS } from '../../lib/utils';
import { useHealStats } from '../../hooks/useHeals';
import { useSchedules } from '../../hooks/useRuns';
import { useRBAC } from '../../hooks/useRBAC';
import { useAppConfig } from '../../context/AppConfig';

interface SidebarProps { slug?: string }

const W_COLLAPSED = 74;
const W_EXPANDED  = 182;

// ── Icon map ───────────────────────────────────────────────────────────────
const ICON_MAP: Record<string, LucideIcon> = {
  dashboard:   LayoutDashboard,
  tcLibrary:   ClipboardList,
  skills:      Brain,
  writer:      PenLine,
  scripts:     Code2,
  execution:   Play,
  scheduler:   Clock,
  healing:     RefreshCw,
  reports:     BarChart2,
  chat:        MessageSquare,
  export:      Upload,
  settings:    Settings,
  allProjects: Globe,
  usage:       CreditCard,
  userMgmt:    User,
};

export default function Sidebar({ slug }: SidebarProps) {
  const location  = useLocation();
  const navigate  = useNavigate();
  const qc        = useQueryClient();
  const { activeProject, projects, currentUser, setCurrentUser } = useProjectStore();
  const { mode: chatMode, toggle: toggleChat } = useChatSidebarStore();
  const [logoutHover, setLogoutHover] = useState(false);
  const [expanded, setExpanded]       = useState(false);

  const W = expanded ? W_EXPANDED : W_COLLAPSED;

  function handleLogout() {
    clearAuth();
    setCurrentUser(null);
    qc.clear();
    navigate('/login', { replace: true });
  }

  const projectId = activeProject?.id ?? '';
  const { canAccessHealing } = useRBAC();
  const { data: healStats }   = useHealStats(projectId || undefined);
  const { data: schedules = [] } = useSchedules(projectId || undefined);
  const activeScheduleCount = schedules.filter(s => s.isActive).length;
  const { mode: appMode } = useAppConfig();
  const isRunner = appMode === 'runner';

  type NavItem = {
    label: string; shortLabel: string; path: string;
    iconKey: string; badge?: number; badgeVariant?: string;
    aiLabel?: boolean; onClick?: () => void;
  };

  const navGroups: { items: NavItem[] }[] = slug ? [
    {
      items: [
        { label: 'Dashboard',     shortLabel: 'Dash',    path: `/projects/${slug}/dashboard`,  iconKey: 'dashboard' },
        { label: 'TC Library',    shortLabel: 'TCs',     path: `/projects/${slug}/tc-library`, iconKey: 'tcLibrary', badge: activeProject?._count?.testCases ?? undefined, badgeVariant: 'green' },
        ...(!isRunner ? [{ label: 'Product Skills', shortLabel: 'Skills', path: `/projects/${slug}/skills`, iconKey: 'skills' }] : []),
      ],
    },
    {
      items: [
        ...(!isRunner ? [{ label: 'Test Writer',   shortLabel: 'Writer', path: `/projects/${slug}/writer`,   iconKey: 'writer',   aiLabel: true }] : []),
        { label: isRunner ? 'Scripts' : 'Script Agent', shortLabel: 'Scripts', path: `/projects/${slug}/scripts`, iconKey: 'scripts', aiLabel: !isRunner },
        { label: 'Execution',    shortLabel: 'Run',     path: `/projects/${slug}/execution`,  iconKey: 'execution' },
        { label: 'Scheduler',    shortLabel: 'Schedule',path: `/projects/${slug}/scheduler`,  iconKey: 'scheduler', badge: activeScheduleCount || undefined, badgeVariant: 'blue' },
        ...(!isRunner && canAccessHealing ? [{ label: 'Healing Agent', shortLabel: 'Heal', path: `/projects/${slug}/healing`, iconKey: 'healing', badge: healStats?.pending || undefined, badgeVariant: 'red', aiLabel: true }] : []),
      ],
    },
    {
      items: [
        { label: 'Reports',  shortLabel: 'Reports', path: `/projects/${slug}/reports`, iconKey: 'reports' },
        ...(!isRunner ? [{ label: 'Chat Agent', shortLabel: 'Chat', path: `/projects/${slug}/chat`, iconKey: 'chat', aiLabel: true, onClick: () => toggleChat() }] : []),
      ],
    },
    {
      items: [
        { label: 'Export',   shortLabel: 'Export',   path: `/projects/${slug}/copy-export`, iconKey: 'export' },
        { label: 'Settings', shortLabel: 'Settings', path: `/projects/${slug}/settings`,    iconKey: 'settings' },
      ],
    },
  ] : [];

  const isActive = (path: string) =>
    location.pathname === path ||
    (path.endsWith('/test-cycles') && location.pathname.startsWith(path + '/'));

  const gradientIndex = activeProject ? activeProject.id.charCodeAt(0) % PROJECT_GRADIENTS.length : 0;
  const projectColor  = activeProject?.color ?? PROJECT_GRADIENTS[gradientIndex];

  return (
    <aside style={{
      width: W, minWidth: W, flexShrink: 0,
      background: 'var(--surface)',
      borderRight: '1px solid var(--border)',
      display: 'flex', flexDirection: 'column',
      height: '100%', overflow: 'hidden',
      transition: 'width 0.18s ease, min-width 0.18s ease',
    }}>

      {/* ── Project avatar ──────────────────────────────────────────────── */}
      <div style={{ padding: '12px 0 10px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'center' }}>
        <div
          onClick={() => slug && navigate(`/projects/${slug}/settings`)}
          title={activeProject?.name ?? 'No project selected'}
          style={{
            width: 40, height: 40, borderRadius: 11,
            background: activeProject ? projectColor : 'var(--surface2)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 14, fontWeight: 700, color: '#fff',
            cursor: slug ? 'pointer' : 'default', flexShrink: 0,
            letterSpacing: 0.5,
          }}
        >
          {activeProject ? getInitials(activeProject.name) : '∞'}
        </div>
      </div>

      {/* ── Nav groups ──────────────────────────────────────────────────── */}
      {/* No paddingTop on nav — the sticky toggle provides it, so there's
          no gap above it where scrolling icons could bleed through */}
      <nav style={{ flex: 1, padding: '0 6px 8px', display: 'flex', flexDirection: 'column', gap: 4, overflowY: 'auto', overflowX: 'hidden' }}>

        {/* Sticky expand toggle — bleeds to full nav width via negative margins */}
        <div style={{
          position: 'sticky', top: 0, zIndex: 2,
          background: 'var(--surface)',
          margin: '0 -6px',          /* undo nav side-padding so bg covers edge-to-edge */
          padding: '6px 6px 5px',    /* restore visual spacing */
          borderBottom: '1px solid var(--border)',
          marginBottom: 4,
        }}>
          <ExpandToggle expanded={expanded} onToggle={() => setExpanded(e => !e)} />
        </div>

        {navGroups.map((group, gi) => (
          <div key={gi} style={{
            background: 'var(--surface2)',
            borderRadius: 9, padding: '3px',
            display: 'flex', flexDirection: 'column', gap: 1,
          }}>
            {group.items.map(item => {
              const active = item.onClick ? chatMode === 'expanded' : isActive(item.path);
              const Icon = ICON_MAP[item.iconKey];
              return (
                <TileItem
                  key={item.path}
                  label={item.shortLabel}
                  fullLabel={item.label}
                  icon={Icon}
                  active={active}
                  badge={item.badge}
                  badgeVariant={item.badgeVariant}
                  aiLabel={item.aiLabel}
                  title={item.label}
                  onClick={item.onClick}
                  path={item.onClick ? undefined : item.path}
                  expanded={expanded}
                />
              );
            })}
          </div>
        ))}

        {/* All Projects + utils — always visible regardless of active project */}
        <div style={{
          background: 'var(--surface2)',
          borderRadius: 9, padding: '3px',
          display: 'flex', flexDirection: 'column', gap: 1, marginTop: 4,
        }}>
          <TileItem label="Projects"  fullLabel="All Projects"     icon={Globe}       active={location.pathname === '/projects'} path="/projects"
            title="All Projects" badge={projects.length || undefined} badgeVariant="blue" expanded={expanded} />
          {!isRunner && (
            <TileItem label="AI Usage" fullLabel="AI Usage" icon={CreditCard} active={location.pathname === '/usage'} path="/usage" title="AI Usage" expanded={expanded} />
          )}
          {currentUser?.globalRole === 'SUPER_ADMIN' && (
            <TileItem label="Users" fullLabel="User Management" icon={User} active={location.pathname === '/admin/users'} path="/admin/users" title="User Management" expanded={expanded} />
          )}
        </div>

      </nav>

      {/* ── User avatar + logout ─────────────────────────────────────────── */}
      <div style={{ padding: '8px 0 10px', borderTop: '1px solid var(--border)', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
        <div
          title={`${currentUser?.name ?? 'Guest'} · ${currentUser?.globalRole?.replace('_', ' ') ?? ''}`}
          style={{
            width: 30, height: 30, borderRadius: '50%',
            background: 'linear-gradient(135deg, var(--violet), var(--cyan))',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 11, fontWeight: 700, color: '#fff',
          }}
        >
          {currentUser ? getInitials(currentUser.name) : 'U'}
        </div>
        <button
          onClick={handleLogout}
          onMouseEnter={() => setLogoutHover(true)}
          onMouseLeave={() => setLogoutHover(false)}
          title="Sign out"
          style={{
            width: 28, height: 28, borderRadius: 7, border: 'none', cursor: 'pointer',
            background: logoutHover ? 'rgba(220,38,38,0.1)' : 'transparent',
            color: logoutHover ? 'var(--fail)' : 'var(--text-dim)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            transition: 'all 0.15s',
          }}
        >
          <LogOut size={14} />
        </button>
      </div>

    </aside>
  );
}

// ── Expand toggle button ───────────────────────────────────────────────────

function ExpandToggle({ expanded, onToggle }: { expanded: boolean; onToggle: () => void }) {
  const [hover, setHover] = useState(false);
  return (
    <button
      onClick={onToggle}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      title={expanded ? 'Collapse sidebar' : 'Expand sidebar'}
      style={{
        display: 'flex', alignItems: 'center',
        justifyContent: expanded ? 'flex-start' : 'center',
        gap: 6,
        width: '100%',
        padding: expanded ? '3px 8px' : '3px 0',
        borderRadius: 6, border: '1px solid var(--border)', cursor: 'pointer',
        background: hover ? 'rgba(255,255,255,0.05)' : 'transparent',
        color: hover ? 'var(--text)' : 'var(--text-dim)',
        fontSize: 10, fontWeight: 500,
        transition: 'color 0.12s, background 0.12s',
        fontFamily: 'var(--font-ui)',
        whiteSpace: 'nowrap', overflow: 'hidden',
      }}
    >
      {expanded
        ? <><ChevronsLeft size={13} /><span>Collapse</span></>
        : <ChevronsRight size={13} />
      }
    </button>
  );
}

// ── TileItem ───────────────────────────────────────────────────────────────

function TileItem({
  label, fullLabel, icon: Icon, active, badge, badgeVariant, aiLabel, title, onClick, path, expanded,
}: {
  label: string; fullLabel?: string; icon: LucideIcon; active: boolean;
  badge?: number; badgeVariant?: string; aiLabel?: boolean;
  title: string; onClick?: () => void; path?: string; expanded?: boolean;
}) {
  const [hover, setHover] = useState(false);

  const style: React.CSSProperties = {
    display: 'flex',
    flexDirection: expanded ? 'row' : 'column',
    alignItems: 'center',
    justifyContent: expanded ? 'flex-start' : 'center',
    gap: expanded ? 8 : 3,
    padding: expanded ? '6px 10px' : '7px 4px 6px',
    borderRadius: 7, cursor: 'pointer',
    background: active ? 'rgba(6,182,212,0.12)' : hover ? 'rgba(255,255,255,0.05)' : 'transparent',
    color: active ? 'var(--cyan)' : hover ? 'var(--text)' : 'var(--text-dim)',
    transition: 'background 0.12s, color 0.12s',
    textDecoration: 'none', border: 'none', fontFamily: 'var(--font-ui)',
    position: 'relative', width: '100%', boxSizing: 'border-box',
    whiteSpace: 'nowrap', overflow: 'hidden',
  };

  const inner = (
    <>
      <div style={{ position: 'relative', flexShrink: 0 }}>
        <Icon size={17} strokeWidth={active ? 2 : 1.75} />
        {/* Badge count */}
        {badge !== undefined && badge > 0 && (
          <span style={{
            position: 'absolute', top: -3, right: -4,
            minWidth: 13, height: 13, borderRadius: 20,
            fontSize: 8, fontWeight: 700, lineHeight: '13px',
            textAlign: 'center', padding: '0 3px',
            background: badgeVariant === 'red' ? 'var(--fail)' : badgeVariant === 'green' ? 'var(--emerald)' : 'var(--cyan)',
            color: '#fff', fontFamily: 'var(--font-mono)',
            border: '1.5px solid var(--surface)',
          }}>
            {badge > 99 ? '99+' : badge}
          </span>
        )}
        {/* AI dot */}
        {aiLabel && !badge && (
          <span style={{
            position: 'absolute', top: -3, right: -4,
            width: 6, height: 6, borderRadius: '50%',
            background: 'var(--violet)',
            border: '1.5px solid var(--surface)',
          }} />
        )}
      </div>
      <span style={{
        fontSize: expanded ? 11 : 9,
        fontWeight: active ? 600 : 500,
        lineHeight: 1.2,
        textAlign: expanded ? 'left' : 'center',
        letterSpacing: 0.1,
        overflow: 'hidden', textOverflow: 'ellipsis',
        maxWidth: expanded ? undefined : 58,
        flex: expanded ? 1 : undefined,
      }}>
        {expanded ? (fullLabel ?? title) : label}
      </span>
    </>
  );

  const shared = {
    style,
    title,
    onMouseEnter: () => setHover(true),
    onMouseLeave: () => setHover(false),
  };

  if (onClick) {
    return <button {...shared} onClick={onClick}>{inner}</button>;
  }
  return <Link {...shared} to={path!}>{inner}</Link>;
}
