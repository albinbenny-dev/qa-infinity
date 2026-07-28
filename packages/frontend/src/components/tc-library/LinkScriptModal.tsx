import { useState, useMemo } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import type { Script } from '../../types';

interface LinkScriptModalProps {
  open: boolean;
  onClose: () => void;
  scripts: Script[];
  selectedCount: number;
  onLink: (scriptId: string) => void;
  isPending?: boolean;
}

export default function LinkScriptModal({
  open,
  onClose,
  scripts,
  selectedCount,
  onLink,
  isPending,
}: LinkScriptModalProps) {
  const [search, setSearch] = useState('');
  const [selectedScriptId, setSelectedScriptId] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return scripts.filter(
      (s) =>
        !q ||
        s.filename.toLowerCase().includes(q) ||
        (s.useCaseFolder ?? '').toLowerCase().includes(q),
    );
  }, [scripts, search]);

  // Group by useCaseFolder
  const grouped = useMemo(() => {
    const map = new Map<string, Script[]>();
    for (const s of filtered) {
      const key = s.useCaseFolder ?? '_uncategorized';
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(s);
    }
    return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [filtered]);

  function handleConfirm() {
    if (!selectedScriptId) return;
    onLink(selectedScriptId);
  }

  function handleClose() {
    setSearch('');
    setSelectedScriptId(null);
    onClose();
  }

  const selectedScript = scripts.find((s) => s.id === selectedScriptId);

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
            width: '540px',
            maxHeight: '80vh',
            display: 'flex',
            flexDirection: 'column',
            gap: '16px',
            boxShadow: '0 24px 64px rgba(0,0,0,0.5)',
            zIndex: 9999,
          }}
        >
          <div>
            <Dialog.Title style={{ fontSize: '15px', fontWeight: 800, color: 'var(--text)', margin: 0 }}>
              🔗 Link Script
            </Dialog.Title>
            <p style={{ fontFamily: 'var(--font-mono)', fontSize: '10px', color: 'var(--text-dim)', margin: '4px 0 0' }}>
              Pick a script to link to {selectedCount} selected test case{selectedCount !== 1 ? 's' : ''}.
              All selected TCs will run this script.
            </p>
          </div>

          {/* Search */}
          <input
            className="input-field"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="🔍 Search scripts…"
            style={{ padding: '8px 12px', fontSize: '12px' }}
            autoFocus
          />

          {/* Script list */}
          <div style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
            {grouped.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '32px', color: 'var(--text-dim)', fontSize: '12px', fontFamily: 'var(--font-mono)' }}>
                No scripts found
              </div>
            ) : (
              grouped.map(([folder, folderScripts]) => (
                <div key={folder} style={{ marginBottom: '12px' }}>
                  <div
                    style={{
                      fontFamily: 'var(--font-mono)',
                      fontSize: '9px',
                      fontWeight: 700,
                      color: 'var(--text-dim)',
                      letterSpacing: '0.08em',
                      textTransform: 'uppercase',
                      padding: '0 4px 4px',
                    }}
                  >
                    📂 {folder === '_uncategorized' ? 'Uncategorized' : folder}
                  </div>
                  {folderScripts.map((script) => {
                    const selected = script.id === selectedScriptId;
                    return (
                      <div
                        key={script.id}
                        onClick={() => setSelectedScriptId(selected ? null : script.id)}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: '10px',
                          padding: '8px 12px',
                          borderRadius: '6px',
                          cursor: 'pointer',
                          background: selected ? 'rgba(99,102,241,0.12)' : 'transparent',
                          border: selected ? '1px solid rgba(99,102,241,0.4)' : '1px solid transparent',
                          marginBottom: '2px',
                          transition: 'background 0.1s',
                        }}
                      >
                        <div
                          style={{
                            width: '14px',
                            height: '14px',
                            borderRadius: '50%',
                            border: selected ? '4px solid var(--violet)' : '2px solid var(--border)',
                            flexShrink: 0,
                            transition: 'border 0.1s',
                          }}
                        />
                        <span style={{ fontSize: '12px', fontFamily: 'var(--font-mono)', color: 'var(--text)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {script.scriptType === 'ROBOT' ? '🤖' : '🎭'} {script.filename}
                        </span>
                        <span
                          style={{
                            fontSize: '9px',
                            padding: '2px 6px',
                            borderRadius: '4px',
                            background: script.scriptType === 'ROBOT' ? 'rgba(16,185,129,0.1)' : 'rgba(139,92,246,0.1)',
                            color: script.scriptType === 'ROBOT' ? 'var(--emerald)' : 'var(--violet)',
                            fontWeight: 700,
                            fontFamily: 'var(--font-mono)',
                            flexShrink: 0,
                          }}
                        >
                          {script.scriptType}
                        </span>
                      </div>
                    );
                  })}
                </div>
              ))
            )}
          </div>

          {/* Selected script preview */}
          {selectedScript && (
            <div
              style={{
                padding: '10px 14px',
                background: 'rgba(99,102,241,0.08)',
                border: '1px solid rgba(99,102,241,0.2)',
                borderRadius: '8px',
                fontFamily: 'var(--font-mono)',
                fontSize: '11px',
                color: 'var(--text-mid)',
              }}
            >
              Linking <strong style={{ color: 'var(--violet)' }}>{selectedCount}</strong> TC{selectedCount !== 1 ? 's' : ''} →{' '}
              <strong style={{ color: 'var(--text)' }}>{selectedScript.filename}</strong>
            </div>
          )}

          {/* Actions */}
          <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
            <Dialog.Close asChild>
              <button className="tb-btn tb-btn-ghost" onClick={handleClose}>
                Cancel
              </button>
            </Dialog.Close>
            <button
              onClick={handleConfirm}
              disabled={!selectedScriptId || isPending}
              style={{
                padding: '8px 20px',
                background: selectedScriptId && !isPending
                  ? 'linear-gradient(135deg, var(--violet), var(--cyan))'
                  : 'var(--surface3)',
                border: 'none',
                borderRadius: '7px',
                color: selectedScriptId && !isPending ? 'white' : 'var(--text-dim)',
                fontSize: '12px',
                fontWeight: 700,
                cursor: selectedScriptId && !isPending ? 'pointer' : 'default',
                opacity: selectedScriptId && !isPending ? 1 : 0.5,
              }}
            >
              {isPending ? '⏳ Linking…' : `🔗 Link ${selectedCount} TC${selectedCount !== 1 ? 's' : ''}`}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
