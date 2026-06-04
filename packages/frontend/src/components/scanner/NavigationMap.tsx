import { useState } from 'react';
import {
  LayoutDashboard, FileText, Settings, List, Globe, ChevronRight, ChevronDown,
} from 'lucide-react';
import type { NavNode } from '../../types';

interface NavigationMapProps {
  navMap: NavNode[] | null;
  pagesScanned: number;
}

function pageTypeIcon(pageType: string) {
  switch (pageType) {
    case 'dashboard': return <LayoutDashboard size={12} />;
    case 'form':      return <FileText size={12} />;
    case 'settings':  return <Settings size={12} />;
    case 'list':      return <List size={12} />;
    default:          return <Globe size={12} />;
  }
}

function NavTreeNode({ node, depth }: { node: NavNode; depth: number }) {
  const [expanded, setExpanded] = useState(depth === 0);
  const hasChildren = (node.children?.length ?? 0) > 0;
  const indent = depth * 20;

  return (
    <div>
      <div
        style={{
          display: 'flex', alignItems: 'center', gap: '6px',
          padding: '5px 8px',
          paddingLeft: `${8 + indent}px`,
          borderRadius: '4px',
          cursor: hasChildren ? 'pointer' : 'default',
          transition: 'background 0.1s',
        }}
        onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = 'var(--surface2)'; }}
        onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
        onClick={() => hasChildren && setExpanded((v) => !v)}
      >
        {/* Toggle icon */}
        <span style={{ color: 'var(--text-dim)', flexShrink: 0, width: '14px' }}>
          {hasChildren
            ? expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />
            : <span style={{ fontSize: '8px', lineHeight: 1 }}>·</span>}
        </span>

        {/* Page type icon */}
        <span style={{ color: 'var(--text-dim)', flexShrink: 0 }}>
          {pageTypeIcon(node.pageType)}
        </span>

        {/* Label */}
        <span style={{ fontSize: '12px', fontWeight: hasChildren ? 600 : 400, color: 'var(--text)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {node.label}
        </span>

        {/* URL chip */}
        <span
          style={{
            fontFamily: 'var(--font-mono)', fontSize: '10px', color: 'var(--text-dim)',
            maxWidth: '160px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            flexShrink: 0,
          }}
          title={node.url}
        >
          {(() => {
            try { return new URL(node.url).pathname; } catch { return node.url; }
          })()}
        </span>
      </div>

      {/* Children */}
      {hasChildren && expanded && (
        <div>
          {(node.children ?? []).map((child) => (
            <NavTreeNode key={child.url} node={child} depth={depth + 1} />
          ))}
        </div>
      )}
    </div>
  );
}

export default function NavigationMap({ navMap, pagesScanned }: NavigationMapProps) {
  const totalPages = navMap ? navMap.reduce((acc, n) => acc + 1 + n.children.length, 0) : 0;
  const totalMenus = navMap ? navMap.length : 0;

  return (
    <div className="card" style={{ position: 'relative', overflow: 'visible' }}>
      {/* Cool accent stripe */}
      <div
        style={{
          position: 'absolute', top: 0, left: 0, right: 0, height: '4px',
          background: 'linear-gradient(90deg, #2563AB, #0A2A57)',
          borderRadius: 'var(--radius-lg) var(--radius-lg) 0 0',
        }}
      />

      <div className="card-header" style={{ paddingTop: '18px' }}>
        <div className="card-title">
          <Globe size={14} color="var(--cyan)" />
          Navigation Map
        </div>
        {navMap && (
          <div style={{ display: 'flex', gap: '6px' }}>
            <span
              style={{
                padding: '2px 8px', borderRadius: '4px', fontSize: '10px', fontWeight: 700,
                background: 'var(--cyan-dim)', color: 'var(--cyan)',
                fontFamily: 'var(--font-mono)',
              }}
            >
              {pagesScanned || totalPages} pages
            </span>
            <span
              style={{
                padding: '2px 8px', borderRadius: '4px', fontSize: '10px', fontWeight: 700,
                background: 'var(--violet-dim)', color: 'var(--6d-orange)',
                fontFamily: 'var(--font-mono)',
              }}
            >
              {totalMenus} menus
            </span>
          </div>
        )}
      </div>

      <div
        className="card-body"
        style={{ padding: '8px', maxHeight: '360px', overflowY: 'auto' }}
      >
        {!navMap || navMap.length === 0 ? (
          <div
            style={{
              textAlign: 'center', padding: '24px',
              color: 'var(--text-dim)', fontFamily: 'var(--font-mono)', fontSize: '12px',
            }}
          >
            Navigation map not yet available
          </div>
        ) : (
          navMap.map((node) => (
            <NavTreeNode key={node.url} node={node} depth={0} />
          ))
        )}
      </div>
    </div>
  );
}
