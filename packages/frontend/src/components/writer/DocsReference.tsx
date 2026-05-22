import type { RequirementDoc } from '../../types';

interface DocsReferenceProps {
  docs: RequirementDoc[];
  reqLibraryPath?: string;
  onToggleDoc: (docId: string, isActive: boolean) => void;
  inputCount: number;
  projectSlug: string;
}

function getDocTypeLabel(fileType: string): string {
  if (fileType === 'application/pdf') return 'PDF';
  if (fileType.includes('spreadsheet') || fileType.includes('excel')) return 'XLSX';
  if (fileType.includes('word') || fileType.includes('wordprocessing')) return 'DOCX';
  if (fileType === 'text/plain') return 'TXT';
  if (fileType === 'text/markdown') return 'MD';
  return 'DOC';
}

function getDocIcon(fileType: string): string {
  if (fileType === 'application/pdf') return '📄';
  if (fileType.includes('spreadsheet') || fileType.includes('excel')) return '📊';
  if (fileType.includes('word')) return '📝';
  return '📃';
}

type DocKind = 'HLD' | 'PRD' | 'BRD' | 'API' | 'SPEC' | 'DOC';

function getDocKind(filename: string): DocKind {
  const lower = filename.toLowerCase();
  if (lower.includes('hld')) return 'HLD';
  if (lower.includes('prd')) return 'PRD';
  if (lower.includes('brd')) return 'BRD';
  if (lower.includes('api')) return 'API';
  if (lower.includes('spec')) return 'SPEC';
  return 'DOC';
}

const KIND_COLORS: Record<DocKind, { color: string; border: string; borderHover: string; badge: string }> = {
  HLD:  { color: 'var(--violet)',  border: 'rgba(244,123,32,0.2)',  borderHover: 'rgba(244,123,32,0.5)',  badge: 'var(--violet-dim)' },
  PRD:  { color: 'var(--cyan)',    border: 'rgba(37,99,171,0.2)',   borderHover: 'rgba(37,99,171,0.5)',   badge: 'var(--cyan-dim)' },
  BRD:  { color: 'var(--cyan)',    border: 'rgba(37,99,171,0.2)',   borderHover: 'rgba(37,99,171,0.5)',   badge: 'var(--cyan-dim)' },
  API:  { color: 'var(--emerald)', border: 'rgba(42,157,143,0.2)',  borderHover: 'rgba(42,157,143,0.5)',  badge: 'var(--emerald-dim)' },
  SPEC: { color: 'var(--emerald)', border: 'rgba(42,157,143,0.2)',  borderHover: 'rgba(42,157,143,0.5)',  badge: 'var(--emerald-dim)' },
  DOC:  { color: 'var(--text-mid)',border: 'var(--border)',          borderHover: 'var(--border2)',        badge: 'var(--surface2)' },
};

export default function DocsReference({
  docs,
  reqLibraryPath,
  onToggleDoc,
  inputCount,
  projectSlug,
}: DocsReferenceProps) {
  const activeDocs = docs.filter((d) => d.isActive);

  return (
    <div className="card" style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden', height: '100%' }}>
      <div style={{ height: '4px', background: 'var(--cool-accent)', flexShrink: 0 }} />

      {/* Header */}
      <div className="card-header" style={{ flexShrink: 0 }}>
        <div className="card-title" style={{ fontSize: '13px' }}>📚 Project Docs Reference</div>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: '9px', padding: '2px 7px', borderRadius: '100px', background: 'var(--emerald-dim)', color: 'var(--emerald)', border: '1px solid rgba(42,157,143,0.25)', fontWeight: 700 }}>
          AUTO-LOADED
        </span>
      </div>

      {/* Source path */}
      <div style={{ padding: '10px 14px', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: '9px', color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '1px', marginBottom: '6px' }}>
          From Source Path
        </div>
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: '10px', color: 'var(--text-mid)', background: 'var(--surface2)', padding: '4px 8px', borderRadius: '4px', border: '1px solid var(--border)', wordBreak: 'break-all' }}>
          {reqLibraryPath || `/requirements/${projectSlug}/`}
        </div>
      </div>

      {/* Doc list — scrollable */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '8px 0' }}>
        {docs.length === 0 ? (
          <div style={{ padding: '20px 14px', textAlign: 'center', color: 'var(--text-dim)', fontSize: '12px' }}>
            No requirement docs uploaded yet.<br />
            <a href={`/projects/${projectSlug}/settings`} style={{ color: 'var(--cyan)', fontSize: '11px' }}>Upload in Project Settings →</a>
          </div>
        ) : (
          docs.map((doc) => {
            const kind = getDocKind(doc.filename);
            const palette = KIND_COLORS[kind];
            return (
              <div
                key={doc.id}
                style={{
                  margin: '0 10px 6px',
                  padding: '8px 10px',
                  background: 'var(--surface2)',
                  border: `1px solid ${palette.border}`,
                  borderRadius: '6px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  opacity: doc.isActive ? 1 : 0.45,
                  transition: 'border-color 0.15s, opacity 0.15s',
                  cursor: 'default',
                }}
                onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.borderColor = palette.borderHover; }}
                onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.borderColor = palette.border; }}
              >
                <span style={{ fontSize: '11px', flexShrink: 0, color: palette.color }}>{getDocIcon(doc.fileType)}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: '11px', fontWeight: 600, color: palette.color, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {doc.filename}
                  </div>
                  <div style={{ fontFamily: 'var(--font-mono)', fontSize: '9px', color: 'var(--text-dim)', marginTop: '2px' }}>
                    {getDocTypeLabel(doc.fileType)}
                  </div>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '4px', flexShrink: 0 }}>
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: '8px', fontWeight: 700, padding: '1px 5px', borderRadius: '3px', background: palette.badge, color: palette.color, border: `1px solid ${palette.border}` }}>
                    {kind}
                  </span>
                  <button
                    onClick={() => onToggleDoc(doc.id, !doc.isActive)}
                    style={{
                      width: '26px', height: '14px', borderRadius: '7px',
                      background: doc.isActive ? 'var(--emerald)' : 'var(--border2)',
                      border: 'none', cursor: 'pointer', position: 'relative', transition: 'background 0.2s',
                    }}
                    title={doc.isActive ? 'Deactivate' : 'Activate'}
                  >
                    <div style={{
                      position: 'absolute', top: '2px',
                      left: doc.isActive ? '13px' : '2px',
                      width: '10px', height: '10px', borderRadius: '50%',
                      background: '#fff', transition: 'left 0.2s',
                    }} />
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Manage link */}
      <div style={{ padding: '10px 14px', borderTop: '1px dashed var(--border)', flexShrink: 0 }}>
        <a
          href={`/projects/${projectSlug}/settings`}
          style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '4px', fontSize: '11px', color: 'var(--text-mid)', textDecoration: 'none', fontFamily: 'var(--font-mono)', transition: 'color 0.15s' }}
          onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.color = 'var(--cyan)'; }}
          onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.color = 'var(--text-mid)'; }}
        >
          ⚙️ Manage Source Path
        </a>
      </div>

      {/* Agent context panel */}
      <div style={{ padding: '12px 14px', borderTop: '1px solid var(--border)', background: 'var(--surface2)', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '8px' }}>
          <span style={{ fontSize: '12px' }}>🤖</span>
          <span style={{ fontSize: '12px', fontWeight: 700, color: 'var(--text)' }}>Agent Context</span>
        </div>
        {activeDocs.length > 0 || inputCount > 0 ? (
          <div style={{ padding: '8px', borderRadius: '6px', background: 'var(--emerald-dim)', border: '1px solid rgba(42,157,143,0.25)' }}>
            <div style={{ fontSize: '10px', fontWeight: 700, color: 'var(--emerald)', fontFamily: 'var(--font-mono)', letterSpacing: '0.5px', marginBottom: '4px' }}>
              CONTEXT ACTIVE
            </div>
            <div style={{ fontSize: '11px', color: 'var(--text-mid)', lineHeight: 1.5 }}>
              {activeDocs.length > 0 && <div>✓ {activeDocs.length} project doc{activeDocs.length !== 1 ? 's' : ''} loaded</div>}
              {inputCount > 0 && <div>✓ {inputCount} input{inputCount !== 1 ? 's' : ''} queued</div>}
            </div>
          </div>
        ) : (
          <div style={{ padding: '8px', borderRadius: '6px', background: 'var(--surface3)', border: '1px solid var(--border)' }}>
            <div style={{ fontSize: '11px', color: 'var(--text-dim)' }}>No context loaded yet</div>
          </div>
        )}
      </div>
    </div>
  );
}
