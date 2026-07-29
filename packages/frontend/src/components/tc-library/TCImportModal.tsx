import { useState, useRef } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import toast from 'react-hot-toast';
import { useParseSeedFileUpload, useSaveTestCases } from '../../hooks/useTestCases';
import { api } from '../../lib/api';

interface SeedTC {
  tcId?: string;
  title: string;
  steps: string[];
  expectedResult: string;
  useCaseTag?: string;
  description?: string;
  priority?: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  type?: 'UI' | 'API' | 'SIT';
}

interface TCImportModalProps {
  open: boolean;
  onClose: () => void;
  projectId: string;
}

const PRIORITY_COLORS: Record<string, string> = {
  CRITICAL: 'var(--fail)',
  HIGH:     'var(--rose)',
  MEDIUM:   'var(--amber)',
  LOW:      'var(--emerald)',
};

export default function TCImportModal({ open, onClose, projectId }: TCImportModalProps) {
  const [file, setFile] = useState<File | null>(null);
  const [parsed, setParsed] = useState<SeedTC[] | null>(null);
  const [defaultUseCase, setDefaultUseCase] = useState('');
  const [isDragging, setIsDragging] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const parseMutation = useParseSeedFileUpload(projectId);
  const saveMutation = useSaveTestCases(projectId);

  function handleClose() {
    setFile(null);
    setParsed(null);
    setDefaultUseCase('');
    onClose();
  }

  async function handleFile(f: File) {
    setFile(f);
    setParsed(null);
    const result = await parseMutation.mutateAsync(f).catch((err) => {
      toast.error(err?.response?.data?.error ?? 'Failed to parse Excel file');
      return null;
    });
    if (result) setParsed(result);
  }

  const [importErrors, setImportErrors] = useState<string[]>([]);

  async function handleImport() {
    if (!parsed || parsed.length === 0) return;
    setImportErrors([]);
    const tcs = parsed.map((tc) => ({
      ...tc,
      useCaseTag: tc.useCaseTag || defaultUseCase || undefined,
      status: 'DRAFT' as const,
      steps: tc.steps,
      tags: [],
      type: tc.type ?? 'UI',
    }));
    try {
      const res = await saveMutation.mutateAsync(tcs as any);
      toast.success(`Imported ${res.count} test case${res.count !== 1 ? 's' : ''} to TC Library`);
      handleClose();
    } catch (err: any) {
      const data = err?.response?.data;
      if (data?.rows?.length) {
        setImportErrors(data.rows);
        toast.error(data.error ?? 'Import failed — see errors below');
      } else {
        toast.error(data?.error ?? 'Import failed');
      }
    }
  }

  async function handleDownloadTemplate() {
    try {
      const res = await api.get(`/projects/${projectId}/test-cases/seed-template`, { responseType: 'blob' });
      const url = URL.createObjectURL(res.data as Blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'seed-tc-template.xlsx';
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      toast.error('Download failed');
    }
  }

  const isParsing = parseMutation.isPending;
  const isSaving = saveMutation.isPending;

  return (
    <Dialog.Root open={open} onOpenChange={(o) => !o && handleClose()}>
      <Dialog.Portal>
        <Dialog.Overlay
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.65)',
            backdropFilter: 'blur(4px)',
            zIndex: 9998,
          }}
        />
        <Dialog.Content
          style={{
            position: 'fixed',
            top: '50%',
            left: '50%',
            transform: 'translate(-50%,-50%)',
            background: 'var(--surface)',
            border: '1px solid var(--border)',
            borderRadius: '14px',
            padding: '24px',
            width: '680px',
            maxHeight: '85vh',
            display: 'flex',
            flexDirection: 'column',
            gap: '16px',
            boxShadow: '0 24px 64px rgba(0,0,0,0.5)',
            zIndex: 9999,
          }}
        >
          {/* Header */}
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
            <div>
              <Dialog.Title style={{ fontSize: '15px', fontWeight: 800, color: 'var(--text)', margin: 0 }}>
                📥 Import Test Cases from Excel
              </Dialog.Title>
              <p style={{ fontFamily: 'var(--font-mono)', fontSize: '10px', color: 'var(--text-dim)', margin: '4px 0 0' }}>
                Upload a seed Excel file to populate the TC Library directly.
              </p>
            </div>
            <button
              onClick={handleDownloadTemplate}
              style={{
                padding: '5px 12px',
                background: 'rgba(16,185,129,0.1)',
                border: '1px solid rgba(16,185,129,0.3)',
                borderRadius: '6px',
                color: 'var(--emerald)',
                fontSize: '10px',
                fontWeight: 700,
                cursor: 'pointer',
                fontFamily: 'var(--font-mono)',
                whiteSpace: 'nowrap',
              }}
            >
              ⬇ Template
            </button>
          </div>

          {/* Drop zone */}
          {!parsed && (
            <div
              onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
              onDragLeave={() => setIsDragging(false)}
              onDrop={(e) => {
                e.preventDefault();
                setIsDragging(false);
                const f = e.dataTransfer.files[0];
                if (f) handleFile(f);
              }}
              onClick={() => fileRef.current?.click()}
              style={{
                border: `2px dashed ${isDragging ? 'var(--violet)' : 'var(--border)'}`,
                borderRadius: '10px',
                padding: '36px 24px',
                textAlign: 'center',
                cursor: 'pointer',
                background: isDragging ? 'rgba(99,102,241,0.06)' : 'var(--surface2)',
                transition: 'all 0.15s',
              }}
            >
              {isParsing ? (
                <div style={{ color: 'var(--text-dim)', fontSize: '12px', fontFamily: 'var(--font-mono)' }}>
                  ⏳ Parsing Excel…
                </div>
              ) : (
                <>
                  <div style={{ fontSize: '28px', marginBottom: '8px' }}>📊</div>
                  <div style={{ fontSize: '13px', fontWeight: 700, color: 'var(--text)', marginBottom: '4px' }}>
                    {file ? file.name : 'Drop Excel file here or click to browse'}
                  </div>
                  <div style={{ fontSize: '10px', color: 'var(--text-dim)', fontFamily: 'var(--font-mono)' }}>
                    .xlsx — TC ID (optional), Use Case, Title, Steps, Expected Result, Priority, Type
                  </div>
                </>
              )}
              <input
                ref={fileRef}
                type="file"
                accept=".xlsx,.xls"
                style={{ display: 'none' }}
                onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }}
              />
            </div>
          )}

          {/* Preview table */}
          {parsed && (
            <>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <span style={{ fontSize: '12px', fontWeight: 700, color: 'var(--text)' }}>
                  {parsed.length} test case{parsed.length !== 1 ? 's' : ''} ready to import
                </span>
                <button
                  onClick={() => { setFile(null); setParsed(null); }}
                  style={{
                    fontSize: '10px',
                    fontFamily: 'var(--font-mono)',
                    color: 'var(--text-dim)',
                    background: 'transparent',
                    border: 'none',
                    cursor: 'pointer',
                    textDecoration: 'underline',
                  }}
                >
                  Change file
                </button>
              </div>

              {/* Default UseCase override */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <label style={{ fontSize: '11px', color: 'var(--text-mid)', whiteSpace: 'nowrap', fontFamily: 'var(--font-mono)' }}>
                  Default UseCase:
                </label>
                <input
                  className="input-field"
                  value={defaultUseCase}
                  onChange={(e) => setDefaultUseCase(e.target.value)}
                  placeholder="(use per-row value from Excel)"
                  style={{ flex: 1, padding: '6px 10px', fontSize: '11px' }}
                />
              </div>

              {/* Preview list */}
              <div style={{ flex: 1, overflowY: 'auto', minHeight: 0, maxHeight: '260px' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '11px', fontFamily: 'var(--font-mono)' }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid var(--border)' }}>
                      <th style={{ textAlign: 'left', padding: '4px 8px', color: 'var(--text-dim)', fontWeight: 700, fontSize: '9px', textTransform: 'uppercase', letterSpacing: '0.06em', width: '16%' }}>TC ID</th>
                      <th style={{ textAlign: 'left', padding: '4px 8px', color: 'var(--text-dim)', fontWeight: 700, fontSize: '9px', textTransform: 'uppercase', letterSpacing: '0.06em', width: '36%' }}>Title</th>
                      <th style={{ textAlign: 'left', padding: '4px 8px', color: 'var(--text-dim)', fontWeight: 700, fontSize: '9px', textTransform: 'uppercase', letterSpacing: '0.06em', width: '20%' }}>UseCase</th>
                      <th style={{ textAlign: 'left', padding: '4px 8px', color: 'var(--text-dim)', fontWeight: 700, fontSize: '9px', textTransform: 'uppercase', letterSpacing: '0.06em', width: '14%' }}>Priority</th>
                      <th style={{ textAlign: 'left', padding: '4px 8px', color: 'var(--text-dim)', fontWeight: 700, fontSize: '9px', textTransform: 'uppercase', letterSpacing: '0.06em', width: '14%' }}>Type</th>
                    </tr>
                  </thead>
                  <tbody>
                    {parsed.map((tc, i) => (
                      <tr key={i} style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                        <td style={{ padding: '5px 8px', color: tc.tcId ? 'var(--cyan)' : 'var(--text-dim)', whiteSpace: 'nowrap' }}>
                          {tc.tcId || <span style={{ opacity: 0.4 }}>auto</span>}
                        </td>
                        <td style={{ padding: '5px 8px', color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 0 }}>
                          {tc.title}
                        </td>
                        <td style={{ padding: '5px 8px', color: 'var(--text-dim)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 0 }}>
                          {tc.useCaseTag || defaultUseCase || '—'}
                        </td>
                        <td style={{ padding: '5px 8px' }}>
                          {tc.priority ? (
                            <span style={{ color: PRIORITY_COLORS[tc.priority] ?? 'var(--text-dim)', fontWeight: 700, fontSize: '10px' }}>
                              {tc.priority}
                            </span>
                          ) : <span style={{ color: 'var(--text-dim)' }}>—</span>}
                        </td>
                        <td style={{ padding: '5px 8px', color: 'var(--text-dim)' }}>
                          {tc.type ?? '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}

          {/* Import errors */}
          {importErrors.length > 0 && (
            <div style={{
              background: 'rgba(220,38,38,0.06)',
              border: '1px solid rgba(220,38,38,0.25)',
              borderRadius: '8px',
              padding: '10px 12px',
              maxHeight: '140px',
              overflowY: 'auto',
            }}>
              <div style={{ fontSize: '10px', fontWeight: 700, color: 'var(--fail)', marginBottom: '6px', fontFamily: 'var(--font-mono)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                ✕ {importErrors.length} row{importErrors.length !== 1 ? 's' : ''} failed validation — fix in Excel and re-import
              </div>
              {importErrors.map((msg, i) => (
                <div key={i} style={{ fontSize: '10px', fontFamily: 'var(--font-mono)', color: 'var(--text-mid)', lineHeight: 1.6 }}>
                  {msg}
                </div>
              ))}
            </div>
          )}

          {/* Actions */}
          <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
            <Dialog.Close asChild>
              <button className="tb-btn tb-btn-ghost" onClick={handleClose}>
                Cancel
              </button>
            </Dialog.Close>
            {parsed && (
              <button
                onClick={handleImport}
                disabled={isSaving || parsed.length === 0}
                style={{
                  padding: '8px 20px',
                  background: !isSaving && parsed.length > 0
                    ? 'linear-gradient(135deg, var(--cyan), var(--violet))'
                    : 'var(--surface3)',
                  border: 'none',
                  borderRadius: '7px',
                  color: !isSaving && parsed.length > 0 ? 'white' : 'var(--text-dim)',
                  fontSize: '12px',
                  fontWeight: 700,
                  cursor: !isSaving && parsed.length > 0 ? 'pointer' : 'default',
                  opacity: !isSaving && parsed.length > 0 ? 1 : 0.5,
                }}
              >
                {isSaving ? '⏳ Importing…' : `📥 Import ${parsed.length} TC${parsed.length !== 1 ? 's' : ''}`}
              </button>
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
