import { useState, useRef } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import toast from 'react-hot-toast';
import { usePreviewLocatorImport, useImportLocators, type ImportPreviewResponse } from '../../hooks/useLocators';

interface LocatorImportModalProps {
  open: boolean;
  onClose: () => void;
  projectId: string;
}

/**
 * Bulk-seed the Object/Locator Repository from a team's own hand-curated
 * locator map — any product, not just one project. Paste YAML or JSON
 * directly (the format most teams already maintain their locators in), or
 * drop/browse a .yaml/.yml/.json file. Mirrors TCImportModal's
 * drop-zone → parse → preview table → confirm shape.
 */
export default function LocatorImportModal({ open, onClose, projectId }: LocatorImportModalProps) {
  const [raw, setRaw] = useState('');
  const [preview, setPreview] = useState<ImportPreviewResponse | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const previewMutation = usePreviewLocatorImport(projectId);
  const importMutation = useImportLocators(projectId);

  function handleClose() {
    setRaw('');
    setPreview(null);
    onClose();
  }

  async function loadFile(f: File) {
    const text = await f.text();
    setRaw(text);
    setPreview(null);
  }

  async function handlePreview() {
    if (!raw.trim()) return;
    const result = await previewMutation.mutateAsync(raw).catch((err) => {
      toast.error(err?.response?.data?.error ?? 'Could not parse this as YAML or JSON');
      return null;
    });
    if (result) setPreview(result);
  }

  async function handleImport() {
    if (!raw.trim()) return;
    const result = await importMutation.mutateAsync(raw).catch((err) => {
      toast.error(err?.response?.data?.error ?? 'Import failed');
      return null;
    });
    if (result) {
      toast.success(`${result.created} added, ${result.updated} updated${result.skipped.length ? `, ${result.skipped.length} skipped` : ''}`);
      handleClose();
    }
  }

  const isPreviewing = previewMutation.isPending;
  const isImporting = importMutation.isPending;

  return (
    <Dialog.Root open={open} onOpenChange={(o) => !o && handleClose()}>
      <Dialog.Portal>
        <Dialog.Overlay
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.65)', backdropFilter: 'blur(4px)', zIndex: 9998 }}
        />
        <Dialog.Content
          style={{
            position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%,-50%)',
            background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '14px',
            padding: '24px', width: '720px', maxHeight: '85vh',
            display: 'flex', flexDirection: 'column', gap: '16px',
            boxShadow: '0 24px 64px rgba(0,0,0,0.5)', zIndex: 9999,
          }}
        >
          <div>
            <Dialog.Title style={{ fontSize: '15px', fontWeight: 800, color: 'var(--text)', margin: 0 }}>
              🗺️ Import Locator Map
            </Dialog.Title>
            <p style={{ fontFamily: 'var(--font-mono)', fontSize: '10px', color: 'var(--text-dim)', margin: '4px 0 0' }}>
              Paste or drop a locator map (YAML or JSON) — { '{ page: { elementName: "strategy:selector" } }' }. Safe to re-run any time the list changes; existing entries are updated, not duplicated.
            </p>
          </div>

          {!preview && (
            <>
              <div
                onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
                onDragLeave={() => setIsDragging(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setIsDragging(false);
                  const f = e.dataTransfer.files[0];
                  if (f) loadFile(f);
                }}
                onClick={() => fileRef.current?.click()}
                style={{
                  border: `2px dashed ${isDragging ? 'var(--violet)' : 'var(--border)'}`,
                  borderRadius: '10px', padding: '18px 24px', textAlign: 'center', cursor: 'pointer',
                  background: isDragging ? 'rgba(99,102,241,0.06)' : 'var(--surface2)', transition: 'all 0.15s',
                }}
              >
                <div style={{ fontSize: '11px', color: 'var(--text-dim)', fontFamily: 'var(--font-mono)' }}>
                  Drop a .yaml / .yml / .json file here, or click to browse — or just paste below
                </div>
                <input
                  ref={fileRef}
                  type="file"
                  accept=".yaml,.yml,.json"
                  style={{ display: 'none' }}
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) loadFile(f); }}
                />
              </div>

              <textarea
                className="input-field"
                value={raw}
                onChange={(e) => { setRaw(e.target.value); setPreview(null); }}
                placeholder={'LoginPage:\n  UserName: "id:username"\n  Password: "id:password"\nDashboard:\n  SearchButton: "css:button.search-btn"'}
                spellCheck={false}
                style={{
                  flex: 1, minHeight: '260px', fontFamily: 'var(--font-mono)', fontSize: '11px',
                  padding: '10px 12px', resize: 'vertical', lineHeight: 1.6,
                }}
              />
            </>
          )}

          {preview && (
            <>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
                <span style={{ fontSize: '12px', fontWeight: 700, color: 'var(--text)' }}>
                  {preview.totalElements} locator{preview.totalElements !== 1 ? 's' : ''} across {preview.totalPages} page{preview.totalPages !== 1 ? 's' : ''}
                </span>
                <span style={{ fontSize: '10px', fontFamily: 'var(--font-mono)', color: 'var(--emerald)' }}>
                  {preview.newCount} new
                </span>
                <span style={{ fontSize: '10px', fontFamily: 'var(--font-mono)', color: 'var(--amber)' }}>
                  {preview.updateCount} updated
                </span>
                {preview.skipped.length > 0 && (
                  <span style={{ fontSize: '10px', fontFamily: 'var(--font-mono)', color: 'var(--fail)' }}>
                    {preview.skipped.length} skipped (unparseable)
                  </span>
                )}
                <button
                  onClick={() => setPreview(null)}
                  style={{ fontSize: '10px', fontFamily: 'var(--font-mono)', color: 'var(--text-dim)', background: 'transparent', border: 'none', cursor: 'pointer', textDecoration: 'underline', marginLeft: 'auto' }}
                >
                  Edit source
                </button>
              </div>

              <div style={{ flex: 1, overflowY: 'auto', minHeight: 0, maxHeight: '340px', border: '1px solid var(--border)', borderRadius: '8px' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '11px', fontFamily: 'var(--font-mono)' }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid var(--border)', position: 'sticky', top: 0, background: 'var(--surface2)' }}>
                      <th style={{ textAlign: 'left', padding: '6px 10px', color: 'var(--text-dim)', fontWeight: 700, fontSize: '9px', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Page</th>
                      <th style={{ textAlign: 'left', padding: '6px 10px', color: 'var(--text-dim)', fontWeight: 700, fontSize: '9px', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Element</th>
                      <th style={{ textAlign: 'left', padding: '6px 10px', color: 'var(--text-dim)', fontWeight: 700, fontSize: '9px', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Selector</th>
                      <th style={{ textAlign: 'left', padding: '6px 10px', color: 'var(--text-dim)', fontWeight: 700, fontSize: '9px', textTransform: 'uppercase', letterSpacing: '0.06em', width: '70px' }}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.entries.map((e, i) => (
                      <tr key={i} style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                        <td style={{ padding: '5px 10px', color: 'var(--text-dim)', whiteSpace: 'nowrap' }}>{e.page}</td>
                        <td style={{ padding: '5px 10px', color: 'var(--text)', whiteSpace: 'nowrap' }}>{e.elementName}</td>
                        <td style={{ padding: '5px 10px', color: 'var(--cyan)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 0 }}>{e.selector}</td>
                        <td style={{ padding: '5px 10px' }}>
                          <span style={{ fontSize: '9px', fontWeight: 700, color: e.isNew ? 'var(--emerald)' : 'var(--amber)' }}>
                            {e.isNew ? 'NEW' : 'UPDATE'}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}

          <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
            <Dialog.Close asChild>
              <button className="tb-btn tb-btn-ghost" onClick={handleClose}>Cancel</button>
            </Dialog.Close>
            {!preview ? (
              <button
                onClick={handlePreview}
                disabled={isPreviewing || !raw.trim()}
                style={{
                  padding: '8px 20px',
                  background: !isPreviewing && raw.trim() ? 'linear-gradient(135deg, var(--cyan), var(--violet))' : 'var(--surface3)',
                  border: 'none', borderRadius: '7px',
                  color: !isPreviewing && raw.trim() ? 'white' : 'var(--text-dim)',
                  fontSize: '12px', fontWeight: 700,
                  cursor: !isPreviewing && raw.trim() ? 'pointer' : 'default',
                  opacity: !isPreviewing && raw.trim() ? 1 : 0.5,
                }}
              >
                {isPreviewing ? '⏳ Parsing…' : 'Preview'}
              </button>
            ) : (
              <button
                onClick={handleImport}
                disabled={isImporting || preview.totalElements === 0}
                style={{
                  padding: '8px 20px',
                  background: !isImporting && preview.totalElements > 0 ? 'linear-gradient(135deg, var(--cyan), var(--violet))' : 'var(--surface3)',
                  border: 'none', borderRadius: '7px',
                  color: !isImporting && preview.totalElements > 0 ? 'white' : 'var(--text-dim)',
                  fontSize: '12px', fontWeight: 700,
                  cursor: !isImporting && preview.totalElements > 0 ? 'pointer' : 'default',
                  opacity: !isImporting && preview.totalElements > 0 ? 1 : 0.5,
                }}
              >
                {isImporting ? '⏳ Importing…' : `📥 Import ${preview.totalElements}`}
              </button>
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
