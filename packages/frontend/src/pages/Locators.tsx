import { useState, useMemo, Fragment } from 'react';
import { useParams } from 'react-router-dom';
import * as Dialog from '@radix-ui/react-dialog';
import toast from 'react-hot-toast';
import Topbar, { TbBtn } from '../components/layout/Topbar';
import EmptyState from '../components/ui/EmptyState';
import LocatorImportModal from '../components/skills/LocatorImportModal';
import { useProjectStore } from '../stores/projectStore';
import {
  useLocators, useCreateLocator, useUpdateLocator, useDeleteLocator,
} from '../hooks/useLocators';
import type { LocatorEntry } from '../types';

// ── Add/Edit modal ──────────────────────────────────────────────────────────

interface EntryModalProps {
  open: boolean;
  onClose: () => void;
  projectId: string;
  entry?: LocatorEntry | null; // null/undefined = creating
}

function EntryModal({ open, onClose, projectId, entry }: EntryModalProps) {
  const [page, setPage] = useState(entry?.page ?? '');
  const [elementName, setElementName] = useState(entry ? entry.name.split('.').slice(1).join('.') : '');
  const [selector, setSelector] = useState(entry?.selector.replace('=', ':') ?? '');

  const createMutation = useCreateLocator(projectId);
  const updateMutation = useUpdateLocator(projectId);
  const isSaving = createMutation.isPending || updateMutation.isPending;

  async function handleSave() {
    if (!page.trim() || !selector.trim()) return;
    try {
      if (entry) {
        await updateMutation.mutateAsync({ id: entry.id, data: { page: page.trim(), selector: selector.trim() } });
        toast.success('Locator updated');
      } else {
        if (!elementName.trim()) { toast.error('Element name is required'); return; }
        await createMutation.mutateAsync({ page: page.trim(), elementName: elementName.trim(), selector: selector.trim() });
        toast.success('Locator added');
      }
      onClose();
    } catch (err: any) {
      toast.error(err?.response?.data?.error ?? 'Save failed');
    }
  }

  return (
    <Dialog.Root open={open} onOpenChange={(o) => !o && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.65)', backdropFilter: 'blur(4px)', zIndex: 9998 }} />
        <Dialog.Content
          style={{
            position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%,-50%)',
            background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '14px',
            padding: '24px', width: '460px', display: 'flex', flexDirection: 'column', gap: '14px',
            boxShadow: '0 24px 64px rgba(0,0,0,0.5)', zIndex: 9999,
          }}
        >
          <Dialog.Title style={{ fontSize: '15px', fontWeight: 800, color: 'var(--text)', margin: 0 }}>
            {entry ? 'Edit Locator' : '+ Add Locator'}
          </Dialog.Title>

          <div>
            <label style={{ fontSize: '10px', fontFamily: 'var(--font-mono)', color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Page / Feature</label>
            <input className="input-field" value={page} onChange={(e) => setPage(e.target.value)} placeholder="e.g. StockCreation" style={{ width: '100%', marginTop: 4 }} />
          </div>

          {!entry && (
            <div>
              <label style={{ fontSize: '10px', fontFamily: 'var(--font-mono)', color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Element Name</label>
              <input className="input-field" value={elementName} onChange={(e) => setElementName(e.target.value)} placeholder="e.g. POField" style={{ width: '100%', marginTop: 4 }} />
            </div>
          )}

          <div>
            <label style={{ fontSize: '10px', fontFamily: 'var(--font-mono)', color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Selector</label>
            <input
              className="input-field"
              value={selector}
              onChange={(e) => setSelector(e.target.value)}
              placeholder="css:.my-button  or  id:save-btn"
              spellCheck={false}
              style={{ width: '100%', marginTop: 4, fontFamily: 'var(--font-mono)' }}
            />
          </div>

          <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end', marginTop: 6 }}>
            <Dialog.Close asChild>
              <button className="tb-btn tb-btn-ghost" onClick={onClose}>Cancel</button>
            </Dialog.Close>
            <button
              onClick={handleSave}
              disabled={isSaving || !page.trim() || !selector.trim()}
              style={{
                padding: '8px 20px',
                background: 'linear-gradient(135deg, var(--cyan), var(--violet))',
                border: 'none', borderRadius: '7px', color: 'white',
                fontSize: '12px', fontWeight: 700, cursor: 'pointer',
                opacity: isSaving ? 0.6 : 1,
              }}
            >
              {isSaving ? 'Saving…' : entry ? 'Save' : 'Add'}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

// ── Main page ────────────────────────────────────────────────────────────────

export default function Locators() {
  const { slug } = useParams<{ slug: string }>();
  const { activeProject } = useProjectStore();
  const projectId = activeProject?.id ?? '';

  const { data: entries = [], isLoading } = useLocators(projectId || undefined);
  const deleteMutation = useDeleteLocator(projectId);
  const updateMutation = useUpdateLocator(projectId);

  const [search, setSearch] = useState('');
  const [showImport, setShowImport] = useState(false);
  const [editingEntry, setEditingEntry] = useState<LocatorEntry | null | undefined>(undefined); // undefined = closed, null = creating

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = q
      ? entries.filter((e) => e.name.toLowerCase().includes(q) || e.selector.toLowerCase().includes(q) || (e.page ?? '').toLowerCase().includes(q))
      : entries;
    return [...list].sort((a, b) => (a.page ?? '').localeCompare(b.page ?? '') || b.confidence - a.confidence);
  }, [entries, search]);

  const pageCount = new Set(entries.map((e) => e.page ?? '(global)')).size;
  const avgConfidence = entries.length > 0 ? Math.round((entries.reduce((s, e) => s + e.confidence, 0) / entries.length) * 100) : 0;
  const highConfidenceCount = entries.filter((e) => e.confidence >= 0.8).length;

  async function handleDelete(entry: LocatorEntry) {
    if (!confirm(`Delete "${entry.name}"? Script generation will stop seeing this locator.`)) return;
    await deleteMutation.mutateAsync(entry.id);
    toast.success('Deleted');
  }

  async function handleToggleActive(entry: LocatorEntry) {
    await updateMutation.mutateAsync({ id: entry.id, data: { isActive: !entry.isActive } });
  }

  let lastPage: string | null = null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      <Topbar
        breadcrumbs={[
          { label: 'All Projects', href: '/projects' },
          { label: `📡 ${activeProject?.name ?? slug ?? ''}`, href: `/projects/${slug}/settings` },
          { label: '🗺️ Object Repository' },
        ]}
        actions={
          <>
            <TbBtn variant="ghost" onClick={() => setShowImport(true)}>📥 Import</TbBtn>
            <TbBtn variant="primary" onClick={() => setEditingEntry(null)}>+ Add Locator</TbBtn>
          </>
        }
      />

      <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px 80px' }}>
        <p style={{ fontSize: '12px', color: 'var(--text-mid)', maxWidth: '720px', margin: '0 0 16px' }}>
          A persisted, named store of verified selectors for this project — script generation selects locators
          from here by name instead of inventing them. Populated automatically from passing runs and approved
          corrections, or seeded directly by importing a hand-curated locator map for this product.
        </p>

        {/* Stats row */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 10, marginBottom: 16 }}>
          {[
            { label: 'Total Locators', value: entries.length, color: 'var(--cyan)' },
            { label: 'Pages', value: pageCount, color: 'var(--violet)' },
            { label: 'Avg Confidence', value: `${avgConfidence}%`, color: 'var(--emerald)' },
            { label: 'High Confidence (≥80%)', value: highConfidenceCount, color: 'var(--emerald)' },
          ].map((s) => (
            <div key={s.label} className="stat-card sc-cyan" style={{ padding: '10px 14px' }}>
              <div className="stat-label">{s.label}</div>
              <div className="stat-value" style={{ color: s.color, fontSize: 20 }}>{s.value}</div>
            </div>
          ))}
        </div>

        <input
          className="input-field"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by page, element name, or selector…"
          style={{ width: '100%', marginBottom: 14 }}
        />

        {isLoading ? (
          <div style={{ padding: '40px', textAlign: 'center', color: 'var(--text-dim)', fontSize: '12px' }}>Loading…</div>
        ) : filtered.length === 0 ? (
          <EmptyState
            icon="🗺️"
            title={entries.length === 0 ? 'No locators yet' : 'No matches'}
            description={
              entries.length === 0
                ? 'Import a hand-curated locator map to seed this instantly, or just start generating and running scripts — passing runs populate this automatically.'
                : 'Try a different search term.'
            }
            action={entries.length === 0 ? { label: '📥 Import Locator Map', onClick: () => setShowImport(true) } : undefined}
          />
        ) : (
          <div style={{ border: '1px solid var(--border)', borderRadius: '10px', overflow: 'hidden' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
              <thead>
                <tr style={{ background: 'var(--surface2)', borderBottom: '1px solid var(--border)' }}>
                  <th style={{ textAlign: 'left', padding: '8px 12px', color: 'var(--text-dim)', fontWeight: 700, fontSize: '9px', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Element</th>
                  <th style={{ textAlign: 'left', padding: '8px 12px', color: 'var(--text-dim)', fontWeight: 700, fontSize: '9px', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Selector</th>
                  <th style={{ textAlign: 'left', padding: '8px 12px', color: 'var(--text-dim)', fontWeight: 700, fontSize: '9px', textTransform: 'uppercase', letterSpacing: '0.06em', width: '90px' }}>Confidence</th>
                  <th style={{ textAlign: 'left', padding: '8px 12px', color: 'var(--text-dim)', fontWeight: 700, fontSize: '9px', textTransform: 'uppercase', letterSpacing: '0.06em', width: '70px' }}>Uses</th>
                  <th style={{ padding: '8px 12px', width: '110px' }}></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((entry) => {
                  const showPageHeader = entry.page !== lastPage;
                  lastPage = entry.page;
                  return (
                    <Fragment key={entry.id}>
                      {showPageHeader && (
                        <tr key={`hdr-${entry.page}-${entry.id}`}>
                          <td colSpan={5} style={{ padding: '8px 12px 4px', fontFamily: 'var(--font-mono)', fontSize: '10px', fontWeight: 700, color: 'var(--violet)', textTransform: 'uppercase', letterSpacing: '0.05em', background: 'rgba(139,92,246,0.04)' }}>
                            {entry.page ?? '(no page — applies everywhere)'}
                          </td>
                        </tr>
                      )}
                      <tr key={entry.id} style={{ borderBottom: '1px solid rgba(255,255,255,0.04)', opacity: entry.isActive ? 1 : 0.45 }}>
                        <td style={{ padding: '7px 12px', color: 'var(--text)', fontFamily: 'var(--font-mono)', whiteSpace: 'nowrap' }} title={entry.name}>
                          {entry.name.split('.').slice(1).join('.') || entry.name}
                        </td>
                        <td style={{ padding: '7px 12px', color: 'var(--cyan)', fontFamily: 'var(--font-mono)', fontSize: '11px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 0 }} title={entry.selector}>
                          {entry.selector}
                        </td>
                        <td style={{ padding: '7px 12px' }}>
                          <span style={{ color: entry.confidence >= 0.8 ? 'var(--emerald)' : entry.confidence >= 0.5 ? 'var(--amber)' : 'var(--fail)', fontWeight: 700, fontSize: '11px' }}>
                            {Math.round(entry.confidence * 100)}%
                          </span>
                        </td>
                        <td style={{ padding: '7px 12px', color: 'var(--text-dim)', fontFamily: 'var(--font-mono)', fontSize: '11px' }}>
                          {entry.successCount}{entry.failCount > 0 ? ` / -${entry.failCount}` : ''}
                        </td>
                        <td style={{ padding: '7px 12px', textAlign: 'right', whiteSpace: 'nowrap' }}>
                          <button onClick={() => setEditingEntry(entry)} title="Edit" style={{ background: 'transparent', border: 'none', cursor: 'pointer', fontSize: '13px', padding: '2px 5px' }}>✏️</button>
                          <button onClick={() => handleToggleActive(entry)} title={entry.isActive ? 'Deactivate' : 'Activate'} style={{ background: 'transparent', border: 'none', cursor: 'pointer', fontSize: '13px', padding: '2px 5px' }}>
                            {entry.isActive ? '🟢' : '⚪'}
                          </button>
                          <button onClick={() => handleDelete(entry)} title="Delete" style={{ background: 'transparent', border: 'none', cursor: 'pointer', fontSize: '13px', padding: '2px 5px' }}>🗑️</button>
                        </td>
                      </tr>
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <LocatorImportModal open={showImport} onClose={() => setShowImport(false)} projectId={projectId} />
      {editingEntry !== undefined && (
        <EntryModal
          open
          onClose={() => setEditingEntry(undefined)}
          projectId={projectId}
          entry={editingEntry}
        />
      )}
    </div>
  );
}
