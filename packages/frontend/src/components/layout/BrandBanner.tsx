import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { useProjectStore } from '../../stores/projectStore';
import { getInitials, PROJECT_GRADIENTS } from '../../lib/utils';
import type { Project } from '../../types';

function projectColor(p: Project): string {
  return p.color ?? PROJECT_GRADIENTS[p.id.charCodeAt(0) % PROJECT_GRADIENTS.length];
}

export default function BrandBanner() {
  const { theme, toggleTheme, activeProject, projects } = useProjectStore();
  const navigate = useNavigate();
  const isLight = theme === 'light';
  const [query, setQuery] = useState('');

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

      {/* Right: theme toggle + logo */}
      <div className="bb-right">
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
    </header>
  );
}
