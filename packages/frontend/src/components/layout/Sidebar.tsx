import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useProjectStore } from '../../stores/projectStore';
import { getInitials, PROJECT_GRADIENTS } from '../../lib/utils';
import type { NavSection } from '../../types';

interface SidebarProps {
  slug?: string;
}

export default function Sidebar({ slug }: SidebarProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const { activeProject, projects, currentUser } = useProjectStore();

  const navSections: NavSection[] = slug
    ? [
        {
          label: 'Overview',
          items: [
            { label: 'Dashboard', path: `/projects/${slug}/dashboard`, icon: '▦' },
            { label: 'TC Library', path: `/projects/${slug}/tc-library`, icon: '📋', badge: activeProject?._count?.testCases ?? undefined, badgeVariant: 'green' },
          ],
        },
        {
          label: 'Agents',
          items: [
            { label: 'Test Writer', path: `/projects/${slug}/writer`, icon: '✍', badge: 'AI', badgeVariant: 'blue' },
            { label: 'Script Agent', path: `/projects/${slug}/scripts`, icon: '⌨' },
            { label: 'Execution', path: `/projects/${slug}/execution`, icon: '▶' },
            { label: 'Healing Agent', path: `/projects/${slug}/healing`, icon: '⟳' },
          ],
        },
        {
          label: 'Analytics',
          items: [
            { label: 'Reports', path: `/projects/${slug}/reports`, icon: '📊' },
            { label: 'Chat Agent', path: `/projects/${slug}/chat`, icon: '💬' },
          ],
        },
        {
          label: 'Project Tools',
          items: [
            { label: 'Copy / Export', path: `/projects/${slug}/copy-export`, icon: '📤' },
            { label: 'Settings', path: `/projects/${slug}/settings`, icon: '⚙' },
          ],
        },
      ]
    : [];

  const isActive = (path: string) => location.pathname === path;

  const gradientIndex = activeProject
    ? activeProject.id.charCodeAt(0) % PROJECT_GRADIENTS.length
    : 0;

  return (
    <aside
      style={{
        width: '220px',
        flexShrink: 0,
        background: 'var(--surface)',
        borderRight: '1px solid var(--border)',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        height: '100%',
      }}
    >
      {/* Project context widget */}
      <div
        style={{
          padding: '14px 12px',
          borderBottom: '1px solid var(--border)',
          cursor: slug ? 'pointer' : 'default',
        }}
        onClick={() => slug && navigate(`/projects/${slug}/settings`)}
      >
        {activeProject ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <div
              style={{
                width: '32px',
                height: '32px',
                borderRadius: '8px',
                background: PROJECT_GRADIENTS[gradientIndex],
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '14px',
                flexShrink: 0,
                color: '#fff',
                fontWeight: 700,
              }}
            >
              {getInitials(activeProject.name)}
            </div>
            <div style={{ flex: 1, overflow: 'hidden' }}>
              <div
                style={{
                  fontSize: '13px',
                  fontWeight: 700,
                  color: 'var(--text)',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  lineHeight: 1.2,
                }}
              >
                {activeProject.name}
              </div>
              <div
                style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: '9px',
                  color: 'var(--text-dim)',
                  marginTop: '2px',
                  letterSpacing: '0.5px',
                }}
              >
                {activeProject._count?.testCases ?? 0} tests
              </div>
            </div>
            <span style={{ color: 'var(--text-dim)', fontSize: '11px' }}>⌄</span>
          </div>
        ) : (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              color: 'var(--text-dim)',
              fontSize: '12px',
            }}
          >
            <span style={{ fontSize: '16px' }}>∞</span>
            <span>No project selected</span>
          </div>
        )}
      </div>

      {/* All Projects link */}
      <div style={{ padding: '8px 12px', borderBottom: '1px solid var(--border)' }}>
        <Link
          to="/projects"
          className={`nav-item${location.pathname === '/projects' ? ' active' : ''}`}
        >
          <span className="nav-icon">🌐</span>
          All Projects
          {projects.length > 0 && (
            <span className="nav-badge blue" style={{ marginLeft: 'auto' }}>
              {projects.length}
            </span>
          )}
        </Link>
      </div>

      {/* Nav sections */}
      <nav
        style={{
          flex: 1,
          padding: '8px 10px',
          overflowY: 'auto',
        }}
      >
        {navSections.map((section) => (
          <div key={section.label}>
            <div className="nav-section-label">{section.label}</div>
            {section.items.map((item) => (
              <Link
                key={item.path}
                to={item.path}
                className={`nav-item${isActive(item.path) ? ' active' : ''}`}
              >
                <span className="nav-icon">{item.icon}</span>
                <span style={{ flex: 1 }}>{item.label}</span>
                {item.badge !== undefined && (
                  <span
                    className={`nav-badge${item.badgeVariant === 'green' ? ' green' : item.badgeVariant === 'blue' ? ' blue' : ''}`}
                  >
                    {item.badge}
                  </span>
                )}
              </Link>
            ))}
          </div>
        ))}

        {!slug && (
          <div
            style={{
              padding: '20px 10px',
              textAlign: 'center',
              color: 'var(--text-dim)',
              fontSize: '11px',
              fontFamily: 'var(--font-mono)',
            }}
          >
            Select a project to see<br />its navigation
          </div>
        )}
      </nav>

      {/* User widget */}
      <div
        style={{
          padding: '12px 10px',
          borderTop: '1px solid var(--border)',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
            padding: '8px 10px',
            borderRadius: 'var(--radius)',
            cursor: 'pointer',
          }}
        >
          <div
            style={{
              width: '28px',
              height: '28px',
              borderRadius: '50%',
              background: 'linear-gradient(135deg, var(--violet), var(--cyan))',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '11px',
              fontWeight: 700,
              color: '#fff',
              flexShrink: 0,
            }}
          >
            {currentUser ? getInitials(currentUser.name) : 'U'}
          </div>
          <div style={{ flex: 1, overflow: 'hidden' }}>
            <div
              style={{
                fontSize: '12px',
                fontWeight: 600,
                color: 'var(--text)',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
            >
              {currentUser?.name ?? 'Guest'}
            </div>
            <div
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: '9px',
                color: 'var(--text-dim)',
                letterSpacing: '1px',
                textTransform: 'uppercase',
              }}
            >
              {currentUser?.globalRole === 'SUPER_ADMIN' ? 'Super Admin' : 'QA Engineer'}
            </div>
          </div>
        </div>
      </div>
    </aside>
  );
}
