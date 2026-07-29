import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { useProjectStore } from '../stores/projectStore';
import { getToken } from '../lib/auth';

export default function CopyExport() {
  const { slug } = useParams<{ slug: string }>();
  const { activeProject } = useProjectStore();
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  async function handleExport() {
    if (!slug) return;
    setExporting(true);
    setExportError(null);
    try {
      const res = await fetch(`/api/projects/${slug}/export-project`, {
        headers: { Authorization: `Bearer ${getToken()}` },
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${slug}.qai.zip`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err: unknown) {
      setExportError(err instanceof Error ? err.message : String(err));
    } finally {
      setExporting(false);
    }
  }

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* Header */}
      <div style={{ padding: '20px 24px', borderBottom: '1px solid var(--border)' }}>
        <div style={{ marginBottom: '4px', fontSize: '11px', color: 'var(--text-dim)', fontFamily: 'var(--font-mono)' }}>
          {activeProject?.name ?? slug} / Export
        </div>
        <h1 style={{ fontSize: '18px', fontWeight: 700, color: 'var(--text)' }}>
          📤 Export Project
        </h1>
      </div>

      {/* Body */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '32px 24px' }}>
        <div style={{ maxWidth: '520px' }}>
          <p style={{ fontSize: '13px', color: 'var(--text-mid)', lineHeight: 1.65, marginBottom: '24px' }}>
            Downloads a{' '}
            <code style={{ fontFamily: 'var(--font-mono)', background: 'var(--surface2)', padding: '1px 5px', borderRadius: '4px' }}>
              .qai.zip
            </code>{' '}
            containing all test cases, script metadata, and project files. Import it into any other QA Infinity instance from the <strong>All Projects</strong> page using the <strong>⬆ Import</strong> button.
          </p>

          {activeProject && (
            <div style={{
              background: 'var(--surface)',
              border: '1px solid var(--border)',
              borderRadius: '10px',
              padding: '16px 20px',
              marginBottom: '24px',
              display: 'grid',
              gridTemplateColumns: '1fr 1fr',
              gap: '14px',
            }}>
              <Stat label="Project"    value={activeProject.name} />
              <Stat label="Slug"       value={activeProject.slug} mono />
              <Stat label="Test Cases" value={String(activeProject._count?.testCases ?? 0)} />
              <Stat label="Base URL"   value={activeProject.baseUrl || '—'} />
            </div>
          )}

          <button
            onClick={handleExport}
            disabled={exporting}
            style={{
              padding: '10px 24px',
              background: 'var(--violet)',
              color: '#fff',
              border: 'none',
              borderRadius: '8px',
              fontFamily: 'var(--font-ui)',
              fontSize: '13px',
              fontWeight: 600,
              cursor: exporting ? 'not-allowed' : 'pointer',
              opacity: exporting ? 0.7 : 1,
            }}
          >
            {exporting ? 'Preparing…' : '⬇ Download .qai.zip'}
          </button>

          {exportError && (
            <div style={{ marginTop: '16px', padding: '10px 14px', background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.25)', borderRadius: '8px', fontSize: '12px', color: 'var(--fail)' }}>
              {exportError}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <div style={{ fontSize: '10px', color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '3px' }}>{label}</div>
      <div style={{ fontSize: '13px', color: 'var(--text)', fontFamily: mono ? 'var(--font-mono)' : undefined, fontWeight: 500, wordBreak: 'break-all' }}>{value}</div>
    </div>
  );
}
