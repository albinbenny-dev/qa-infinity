import { useState, type CSSProperties } from 'react';
import * as Dialog from '@radix-ui/react-dialog';

interface SelectionBarProps {
  selectedCount: number;
  useCaseOptions: string[];
  onMove: (targetUseCaseTag: string) => void;
  onClear: () => void;
  onSendToExecution: () => void;
  onDelete: () => void;
  onLinkScript?: () => void;
  onUnlinkScript?: () => void;
  onRun?: () => void;
  visible: boolean;
}

export default function SelectionBar({
  selectedCount,
  useCaseOptions,
  onMove,
  onClear,
  onSendToExecution,
  onDelete,
  onLinkScript,
  onUnlinkScript,
  onRun,
  visible,
}: SelectionBarProps) {
  const [moveTarget, setMoveTarget] = useState('');
  const [newUCName, setNewUCName] = useState('');
  const [createModalOpen, setCreateModalOpen] = useState(false);

  const allOptions = useCaseOptions;

  function handleMoveTargetChange(val: string) {
    if (val === '__new__') {
      setCreateModalOpen(true);
      setMoveTarget('');
    } else {
      setMoveTarget(val);
      onMove(val);
    }
  }

  function handleCreateAndMove() {
    const trimmed = newUCName.trim();
    if (!trimmed) return;
    onMove(trimmed);
    setNewUCName('');
    setCreateModalOpen(false);
  }

  if (!visible) return null;

  const actionBtnStyle = (color: string, borderColor: string, bg: string): CSSProperties => ({
    padding: '4px 9px',
    background: bg,
    border: `1px solid ${borderColor}`,
    borderRadius: '5px',
    color,
    fontSize: '11px',
    fontWeight: 700,
    cursor: 'pointer',
    whiteSpace: 'nowrap',
    display: 'flex',
    alignItems: 'center',
    gap: '4px',
    flexShrink: 0,
  });

  return (
    <>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          padding: '7px 10px',
          background: 'var(--surface2)',
          border: '1px solid var(--border)',
          borderLeft: '3px solid var(--violet)',
          borderRadius: 'var(--radius)',
          gap: '7px',
          flexShrink: 0,
          flexWrap: 'nowrap',
          overflowX: 'auto',
          boxShadow: '0 2px 10px rgba(0,0,0,0.15)',
        }}
      >
        {/* Selected count */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '5px', flexShrink: 0 }}>
          <div
            style={{
              width: '16px',
              height: '16px',
              borderRadius: '4px',
              background: 'var(--violet)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '9px',
              color: 'white',
              flexShrink: 0,
            }}
          >
            ✓
          </div>
          <span style={{ fontSize: '11px', fontWeight: 700, color: 'var(--violet)', whiteSpace: 'nowrap' }}>
            {selectedCount}
          </span>
        </div>

        <Divider />

        {/* Move to UseCase */}
        <select
          value={moveTarget}
          onChange={(e) => handleMoveTargetChange(e.target.value)}
          className="input-field"
          title="Move to use case"
          style={{
            padding: '4px 7px',
            fontSize: '11px',
            fontWeight: 600,
            color: 'var(--violet)',
            background: 'var(--surface3)',
            borderColor: 'var(--border)',
            maxWidth: '130px',
            flexShrink: 0,
          }}
        >
          <option value="">↗ Move to…</option>
          {allOptions.map((uc) => (
            <option key={uc} value={uc}>{uc}</option>
          ))}
          <option value="__new__">+ Create New…</option>
        </select>

        <Divider />

        <button
          onClick={onClear}
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: '9px',
            color: 'var(--text-dim)',
            background: 'transparent',
            border: 'none',
            cursor: 'pointer',
            textDecoration: 'underline',
            whiteSpace: 'nowrap',
            flexShrink: 0,
          }}
        >
          Clear
        </button>

        <Divider />

        {onLinkScript && (
          <button onClick={onLinkScript} style={actionBtnStyle('var(--violet)', 'rgba(99,102,241,0.3)', 'rgba(99,102,241,0.1)')}>
            🔗 Link
          </button>
        )}

        {onUnlinkScript && (
          <button onClick={onUnlinkScript} style={actionBtnStyle('var(--text-mid)', 'var(--border2)', 'rgba(148,163,184,0.1)')}>
            ⛓️‍💥 Unlink
          </button>
        )}

        {onRun && (
          <button onClick={onRun} style={actionBtnStyle('var(--emerald)', 'rgba(42,157,143,0.35)', 'var(--emerald-dim)')}>
            ▶ Run {selectedCount}
          </button>
        )}

        <button onClick={onDelete} style={actionBtnStyle('var(--fail)', 'rgba(220,38,38,0.3)', 'rgba(220,38,38,0.08)')}>
          🗑 Delete {selectedCount}
        </button>

        {/* Send to Execution — pushed to right */}
        <button
          onClick={onSendToExecution}
          style={{
            marginLeft: 'auto',
            padding: '6px 14px',
            background: 'linear-gradient(135deg, var(--violet), var(--cyan))',
            border: 'none',
            borderRadius: '6px',
            color: 'white',
            fontSize: '11px',
            fontWeight: 700,
            cursor: 'pointer',
            fontFamily: 'var(--font-ui)',
            whiteSpace: 'nowrap',
            flexShrink: 0,
          }}
        >
          ▶ Send to Execution
        </button>
      </div>

      {/* Create New UseCase modal */}
      <Dialog.Root open={createModalOpen} onOpenChange={setCreateModalOpen}>
        <Dialog.Portal>
          <Dialog.Overlay
            style={{
              position: 'fixed',
              inset: 0,
              background: 'rgba(0,0,0,0.6)',
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
              border: '1px solid rgba(244,123,32,0.3)',
              borderRadius: '14px',
              padding: '28px',
              width: '380px',
              boxShadow: '0 24px 64px rgba(0,0,0,0.5)',
              zIndex: 9999,
            }}
          >
            <Dialog.Title
              style={{ fontSize: '15px', fontWeight: 800, color: 'var(--text)', marginBottom: '6px' }}
            >
              Create New UseCase
            </Dialog.Title>
            <p
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: '10px',
                color: 'var(--text-dim)',
                marginBottom: '16px',
              }}
            >
              The selected TCs will be moved to this new group.
            </p>
            <input
              className="input-field"
              value={newUCName}
              onChange={(e) => setNewUCName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleCreateAndMove()}
              placeholder="e.g. Refund Flow"
              style={{ width: '100%', marginBottom: '14px', padding: '10px 14px', fontSize: '13px' }}
              autoFocus
            />
            <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
              <Dialog.Close asChild>
                <button className="tb-btn tb-btn-ghost">Cancel</button>
              </Dialog.Close>
              <button
                onClick={handleCreateAndMove}
                disabled={!newUCName.trim()}
                className="tb-btn"
                style={{
                  background: newUCName.trim()
                    ? 'linear-gradient(135deg, var(--violet), var(--6d-orange-deep))'
                    : 'var(--surface3)',
                  border: 'none',
                  color: newUCName.trim() ? 'white' : 'var(--text-dim)',
                  fontWeight: 700,
                  opacity: newUCName.trim() ? 1 : 0.6,
                }}
              >
                Create &amp; Move
              </button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </>
  );
}

function Divider() {
  return <div style={{ width: '1px', height: '18px', background: 'rgba(244,123,32,0.3)', flexShrink: 0 }} />;
}
