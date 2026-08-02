import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { Minimize2, Maximize2 } from 'lucide-react';
import { useProjectStore } from '../../stores/projectStore';
import { getInitials, PROJECT_GRADIENTS } from '../../lib/utils';
import type { Project } from '../../types';
import ExtensionInstallModal from '../extension/ExtensionInstallModal';

function projectColor(p: Project): string {
  return p.color ?? PROJECT_GRADIENTS[p.id.charCodeAt(0) % PROJECT_GRADIENTS.length];
}

export default function BrandBanner() {
  const { theme, toggleTheme, density, toggleDensity, activeProject, projects } = useProjectStore();
  const navigate = useNavigate();
  const isLight = theme === 'light';
  const [query, setQuery] = useState('');
  const [showExtModal, setShowExtModal] = useState(false);

  const filteredProjects = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return projects;
    return projects.filter((p) => p.name.toLowerCase().includes(q));
  }, [projects, query]);

  return (
    <header className="brand-banner-top">
      {/* Left: identity */}
      <div className="bb-left">
        <span className="bb-icon">∞</span>
        <div className="bb-text">
          <div className="bb-subtitle">Autonomous Test Automation Platform</div>
          <div className="bb-title">QA Infinity</div>
        </div>
      </div>

      {/* Center: project switcher */}
      <div className="bb-center">
        {activeProject ? (
          <DropdownMenu.Root onOpenChange={(open) => { if (!open) setQuery(''); }}>
            <DropdownMenu.Trigger asChild>
              <button className="bb-proj-switcher" type="button" aria-label="Switch project">
                <span className="bb-proj-avatar" style={{ background: projectColor(activeProject) }}>
                  {getInitials(activeProject.name)}
                </span>
                <span className="bb-proj">{activeProject.name}</span>
                <span className="bb-proj-chevron">▾</span>
              </button>
            </DropdownMenu.Trigger>
            <DropdownMenu.Portal>
              <DropdownMenu.Content className="bb-proj-menu" align="start" sideOffset={10}>
                {projects.length > 6 && (
                  <div className="bb-proj-menu-search">
                    <input
                      autoFocus
                      placeholder="Search projects…"
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                      onKeyDown={(e) => e.stopPropagation()}
                    />
                  </div>
                )}
                <div className="bb-proj-menu-list">
                  {filteredProjects.length === 0 ? (
                    <div className="bb-proj-menu-empty">No projects match “{query}”.</div>
                  ) : (
                    filteredProjects.map((p) => (
                      <DropdownMenu.Item
                        key={p.id}
                        className="bb-proj-menu-item"
                        onSelect={() => navigate(`/projects/${p.slug}/dashboard`)}
                      >
                        <span className="bb-proj-avatar sm" style={{ background: projectColor(p) }}>
                          {getInitials(p.name)}
                        </span>
                        <span className="bb-proj-menu-item-text">
                          <span className="bb-proj-menu-item-name">
                            {p.name}
                            {p.id === activeProject.id && (
                              <span className="bb-proj-menu-item-current">Current</span>
                            )}
                          </span>
                          <span className="bb-proj-menu-item-meta">
                            {p._count?.testCases ?? 0} tests
                          </span>
                        </span>
                      </DropdownMenu.Item>
                    ))
                  )}
                </div>
                <DropdownMenu.Separator className="bb-proj-menu-sep" />
                <DropdownMenu.Item
                  className="bb-proj-menu-viewall"
                  onSelect={() => navigate('/projects')}
                >
                  🗂 View All Projects
                </DropdownMenu.Item>
              </DropdownMenu.Content>
            </DropdownMenu.Portal>
          </DropdownMenu.Root>
        ) : (
          <span style={{ color: 'rgba(255,255,255,0.6)', fontSize: '13px' }}>
            Select a project to begin
          </span>
        )}
      </div>

      {/* Right: density toggle + theme toggle + logo */}
      <div className="bb-right">
        {/* Extension install button */}
        <button
          onClick={() => setShowExtModal(true)}
          title="Get the QA Infinity Chrome Extension"
          type="button"
          style={{
            display: 'flex', alignItems: 'center', gap: 5,
            padding: '4px 10px', borderRadius: 6,
            background: 'rgba(139,92,246,0.18)', border: '1px solid rgba(139,92,246,0.4)',
            color: 'rgba(255,255,255,0.9)', fontSize: 11, fontWeight: 600,
            cursor: 'pointer', fontFamily: 'var(--font-ui)', whiteSpace: 'nowrap',
            transition: 'all 0.15s',
          }}
          onMouseEnter={(e) => {
            (e.currentTarget as HTMLButtonElement).style.background = 'rgba(139,92,246,0.32)';
            (e.currentTarget as HTMLButtonElement).style.borderColor = 'rgba(139,92,246,0.7)';
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLButtonElement).style.background = 'rgba(139,92,246,0.18)';
            (e.currentTarget as HTMLButtonElement).style.borderColor = 'rgba(139,92,246,0.4)';
          }}
        >
          🧩 Get Extension
        </button>

        <button
          className="density-toggle"
          onClick={toggleDensity}
          title={density === 'compact' ? 'Switch to normal view' : 'Switch to compact view'}
          type="button"
          aria-label={density === 'compact' ? 'Switch to normal view' : 'Switch to compact view'}
        >
          {density === 'compact' ? <Maximize2 size={14} /> : <Minimize2 size={14} />}
        </button>
        <button
          className="theme-toggle"
          data-testid="theme-toggle"
          aria-label={isLight ? 'Switch to dark mode' : 'Switch to light mode'}
          onClick={toggleTheme}
          title={isLight ? 'Switch to dark mode' : 'Switch to light mode'}
          type="button"
        >
          <span className={`theme-toggle__icon${isLight ? ' active' : ''}`}>☀</span>
          <span className={`theme-toggle__icon${!isLight ? ' active' : ''}`}>🌙</span>
        </button>
        <img
          className="bb-logo"
          src="/6d-logo-white.png"
          alt="6D Technologies — Smart Ideas, Delivered"
          onError={(e) => {
            (e.target as HTMLImageElement).style.display = 'none';
          }}
        />
      </div>

      {/* Extension install modal */}
      {showExtModal && <ExtensionInstallModal onClose={() => setShowExtModal(false)} />}
    </header>
  );
}
