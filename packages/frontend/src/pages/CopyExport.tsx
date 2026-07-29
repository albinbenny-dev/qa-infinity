import { useState, useRef } from 'react';
import { useParams } from 'react-router-dom';
import { useProjectStore } from '../stores/projectStore';
import { getToken } from '../lib/auth';

type Tab = 'export' | 'import';

interface ImportResult {
  success: boolean;
  project?: { id: string; slug: string; name: string };
  error?: string;
}

export default function CopyExport() {
  const { slug } = useParams<{ slug: string }>();
  const { activeProject } = useProjectStore();
  const [tab, setTab] = useState<Tab>('export');

  // Export state
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  // Import state
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function handleExport() {
    if (!slug) return;
    setExporting(true);
    setExportError(null);
    try {
      const token = getToken();
      const res = await fetch(`/api/projects/${slug}/export-project`, {
        headers: { Authorization: `Bearer ${token}` },
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

  async function handleImport(file: File) {
    setImporting(true);
    setImportResult(null);
    try {
      const token = getToken();
      const form = new FormData();
      form.append('file', file);
      const res = await fetch('/api/projects/import-project', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: form,
      });
      const body = await res.json();
      if (!res.ok) {
        setImportResult({ success: false, error: body.error ?? `HTTP ${res.status}` });
      } else {
        setImportResult({ success: true, project: body.project });
      }
    } catch (err: unknown) {
      setImportResult({ success: false, error: err instanceof Error ? err.message : String(err) });
    } finally {
      setImporting(false);
    }
  }

  function onFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) handleImport(file);
    e.target.value = '';
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) handleImport(file);
  }

  const tabStyle = (active: boolean): React.CSSProperties => ({
    padding: '8px 20px',
    border: 'none',
    borderBottom: active ? '2px solid var(--violet)' : '2px solid transparent',
    background: 'transparent',
    color: active ? 'var(--text)' : 'var(--text-dim)',
    fontFamily: 'var(--font-ui)',
    fontSize: '13px',
    fontWeight: active ? 600 : 400,
    cursor: 'pointer',
    transition: 'all 0.15s',
  });

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* Header */}
      <div style={{ padding: '20px 24px 0', borderBottom: '1px solid var(--border)' }}>
        <div style={{ marginBottom: '4px', fontSize: '11px', color: 'var(--text-dim)', fontFamily: 'var(--font-mono)' }}>
          {activeProject?.name ?? slug} / Copy &amp; Export
        </div>
        <h1 style={{ fontSize: '18px', fontWeight: 700, color: 'var(--text)', marginBottom: '16px' }}>
          📤 Copy / Export
        </h1>
        <div style={{ display: 'flex', gap: '0', borderBottom: '1px solid var(--border)', marginLeft: '-24px', paddingLeft: '24px' }}>
          <button style={tabStyle(tab === 'export')} onClick={() => setTab('export')}>Export</button>
          <button style={tabStyle(tab === 'import')} onClick={() => setTab('import')}>Import</button>
        </div>
      </div>

      {/* Body */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '32px 24px' }}>

        {/* ── Export tab ── */}
        {tab === 'export' && (
          <div style={{ maxWidth: '560px' }}>
            <h2 style={{ fontSize: '15px', fontWeight: 600, color: 'var(--text)', marginBottom: '8px' }}>
              Export this project
            </h2>
            <p style={{ fontSize: '12px', color: 'var(--text-dim)', lineHeight: 1.6, marginBottom: '24px' }}>
              Downloads a <code style={{ fontFamily: 'var(--font-mono)', background: 'var(--surface-hover)', padding: '1px 5px', borderRadius: '4px' }}>.qai.zip</code> containing all
              test cases, script metadata, and project files. You can import it into any other QA Infinity instance.
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
                gap: '12px',
              }}>
                <Stat label="Project" value={activeProject.name} />
                <Stat label="Slug" value={activeProject.slug} mono />
                <Stat label="Test Cases" value={String(activeProject._count?.testCases ?? 0)} />
                <Stat label="Base URL" value={activeProject.baseUrl || '—'} />
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
        )}

        {/* ── Import tab ── */}
        {tab === 'import' && (
          <div style={{ maxWidth: '560px' }}>
            <h2 style={{ fontSize: '15px', fontWeight: 600, color: 'var(--text)', marginBottom: '8px' }}>
              Import a project
            </h2>
            <p style={{ fontSize: '12px', color: 'var(--text-dim)', lineHeight: 1.6, marginBottom: '24px' }}>
              Upload a <code style={{ fontFamily: 'var(--font-mono)', background: 'var(--surface-hover)', padding: '1px 5px', borderRadius: '4px' }}>.qai.zip</code> exported from another QA Infinity instance.
              A new project will be created; if the slug already exists, a suffix is added automatically.
            </p>

            {/* Drop zone */}
            <div
              onClick={() => fileInputRef.current?.click()}
              onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={onDrop}
              style={{
                border: `2px dashed ${dragOver ? 'var(--violet)' : 'var(--border)'}`,
                borderRadius: '12px',
                padding: '40px 24px',
                textAlign: 'center',
                cursor: importing ? 'not-allowed' : 'pointer',
                background: dragOver ? 'rgba(139,92,246,0.04)' : 'transparent',
                transition: 'all 0.15s',
                marginBottom: '20px',
              }}
            >
              <div style={{ fontSize: '32px', marginBottom: '10px' }}>📂</div>
              <div style={{ fontSize: '13px', color: 'var(--text)', fontWeight: 600, marginBottom: '4px' }}>
                {importing ? 'Importing…' : 'Click or drop a .qai.zip file'}
              </div>
              <div style={{ fontSize: '11px', color: 'var(--text-dim)' }}>
                Max 500 MB
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept=".zip,.qai.zip"
                style={{ display: 'none' }}
                onChange={onFileChange}
                disabled={importing}
              />
            </div>

            {importResult && (
              importResult.success ? (
                <div style={{ padding: '14px 16px', background: 'rgba(16,185,129,0.08)', border: '1px solid rgba(16,185,129,0.3)', borderRadius: '8px', fontSize: '12px', color: 'var(--pass)' }}>
                  <div style={{ fontWeight: 700, marginBottom: '6px' }}>Import successful</div>
                  <div>Project <strong>{importResult.project?.name}</strong> created with slug <code style={{ fontFamily: 'var(--font-mono)' }}>{importResult.project?.slug}</code>.</div>
                  <div style={{ marginTop: '8px' }}>
                    <a
                      href={`/projects/${importResult.project?.slug}/dashboard`}
                      style={{ color: 'var(--violet)', textDecoration: 'none', fontWeight: 600 }}
                    >
                      Open project →
                    </a>
                  </div>
                </div>
              ) : (
                <div style={{ padding: '14px 16px', background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.25)', borderRadius: '8px', fontSize: '12px', color: 'var(--fail)' }}>
                  <div style={{ fontWeight: 700, marginBottom: '4px' }}>Import failed</div>
                  {importResult.error}
                </div>
              )
            )}
          </div>
        )}
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
