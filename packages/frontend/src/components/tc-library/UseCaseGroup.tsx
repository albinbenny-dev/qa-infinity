import { useState } from 'react';
import type { Script, TestCase } from '../../types';
import TCTableRow from './TCTableRow';
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  verticalListSortingStrategy,
  useSortable,
  arrayMove,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

export interface UseCaseGroupProps {
  name: string;
  tcs: TestCase[];
  selectedIds: Set<string>;
  scriptedTcIds: Set<string>;
  scriptById?: Map<string, Script>;
  color: string;
  expanded: boolean;
  onToggleExpand: () => void;
  onToggleTc: (id: string) => void;
  onToggleGroup: (ids: string[]) => void;
  onRunGroup: (ids: string[]) => void;
  onRunIndividual: (tc: TestCase) => void;
  onDeleteTc: (tc: TestCase) => void;
  onDeleteGroup: (name: string) => void;
  onEditTc: (tc: TestCase) => void;
  onLinkScript?: (tc: TestCase) => void;
  onUnlinkScript?: (tc: TestCase) => void;
  onReorder?: (orderedIds: string[]) => void;
}

// ── Sortable drag handle wrapper ────────────────────────────────────────────

interface SortableRowProps {
  id: string;
  tc: TestCase;
  selected: boolean;
  hasScript: boolean;
  scriptedTcIds: Set<string>;
  selectedIds: Set<string>;
  scriptById?: Map<string, Script>;
  expandedTcId: string | null;
  onToggleTc: (id: string) => void;
  onRunIndividual: (tc: TestCase) => void;
  onDeleteTc: (tc: TestCase) => void;
  onEditTc: (tc: TestCase) => void;
  onLinkScript?: (tc: TestCase) => void;
  onUnlinkScript?: (tc: TestCase) => void;
  onExpand: (id: string | null) => void;
}

function SortableRow({ id, tc, selected, hasScript, scriptById, expandedTcId, onToggleTc, onRunIndividual, onDeleteTc, onEditTc, onLinkScript, onUnlinkScript, onExpand }: SortableRowProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    position: 'relative' as const,
  };

  return (
    <div ref={setNodeRef} style={style}>
      {/* Drag handle — absolutely positioned on the left edge */}
      <div
        {...attributes}
        {...listeners}
        title="Drag to reorder"
        style={{
          position: 'absolute',
          left: 0,
          top: 0,
          bottom: 0,
          width: '14px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          cursor: isDragging ? 'grabbing' : 'grab',
          color: 'var(--text-dim)',
          fontSize: '10px',
          opacity: 0.4,
          zIndex: 1,
          userSelect: 'none',
        }}
        onMouseEnter={(e) => { (e.currentTarget as HTMLDivElement).style.opacity = '0.9'; }}
        onMouseLeave={(e) => { (e.currentTarget as HTMLDivElement).style.opacity = '0.4'; }}
      >
        ⠿
      </div>
      <div style={{ paddingLeft: '14px' }}>
        <TCTableRow
          tc={tc}
          selected={selected}
          hasScript={hasScript}
          scriptById={scriptById}
          onToggle={onToggleTc}
          onRunIndividual={onRunIndividual}
          onDelete={onDeleteTc}
          onEdit={onEditTc}
          onLinkScript={onLinkScript}
          onUnlinkScript={onUnlinkScript}
          isExpanded={expandedTcId === tc.id}
          onExpand={onExpand}
        />
      </div>
    </div>
  );
}

const COLUMNS_HEADER = ['', 'Test Case', 'Type', 'Script Link', 'Automation', 'Run History', ''];

export default function UseCaseGroup({
  name,
  tcs,
  selectedIds,
  scriptedTcIds,
  scriptById,
  color,
  expanded,
  onToggleExpand,
  onToggleTc,
  onToggleGroup,
  onRunGroup,
  onRunIndividual,
  onDeleteTc,
  onDeleteGroup,
  onEditTc,
  onLinkScript,
  onUnlinkScript,
  onReorder,
}: UseCaseGroupProps) {
  const [expandedTcId, setExpandedTcId] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [localTcs, setLocalTcs] = useState<TestCase[]>(tcs);

  // Keep localTcs in sync when tcs prop changes (e.g. after server refetch)
  if (localTcs.length !== tcs.length || localTcs.some((t, i) => t.id !== tcs[i]?.id)) {
    setLocalTcs(tcs);
  }

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = localTcs.findIndex((tc) => tc.id === active.id);
    const newIndex = localTcs.findIndex((tc) => tc.id === over.id);
    if (oldIndex === -1 || newIndex === -1) return;
    const reordered = arrayMove(localTcs, oldIndex, newIndex);
    setLocalTcs(reordered);
    onReorder?.(reordered.map((tc) => tc.id));
  }

  const tcIds = tcs.map((tc) => tc.id);
  const selectedCount = tcIds.filter((id) => selectedIds.has(id)).length;
  const allSelected = tcIds.length > 0 && selectedCount === tcIds.length;
  const passedCount = tcs.filter((tc) => tc.lastRun?.status === 'PASSED').length;
  const failedCount = tcs.filter((tc) => tc.lastRun?.status === 'FAILED').length;

  function handleHeaderCheckbox(e: React.MouseEvent) {
    e.stopPropagation();
    onToggleGroup(tcIds);
  }

  function handleExpandTc(id: string | null) {
    setExpandedTcId((cur) => (cur === id ? null : id));
  }

  return (
    <div
      style={{
        background: 'var(--surface)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius-lg)',
        overflow: 'hidden',
        boxShadow: 'var(--shadow-card)',
      }}
    >
      {/* Group header */}
      <div
        onClick={onToggleExpand}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          padding: '10px 14px',
          background: `linear-gradient(90deg, ${colorToRgba(color, 0.07)}, transparent)`,
          borderBottom: expanded ? '1px solid var(--border)' : 'none',
          cursor: 'pointer',
          userSelect: 'none',
        }}
      >
        {/* Group checkbox */}
        <div
          className={`tc-checkbox${allSelected ? ' checked' : selectedCount > 0 ? ' indeterminate' : ''}`}
          style={{
            fontSize: '10px',
            flexShrink: 0,
            ...(allSelected
              ? { background: `var(${color})`, borderColor: `var(${color})` }
              : selectedCount > 0
              ? { background: `rgba(244,123,32,0.3)`, borderColor: `var(${color})` }
              : {}),
          }}
          onClick={handleHeaderCheckbox}
        >
          {allSelected ? '✓' : selectedCount > 0 ? '–' : ''}
        </div>

        {/* Chevron */}
        <span style={{ fontSize: '11px', color: 'var(--text-dim)', minWidth: '10px', transition: 'transform 0.15s', display: 'inline-block', transform: expanded ? 'rotate(0deg)' : 'rotate(-90deg)' }}>
          ▼
        </span>

        {/* Status dot */}
        <div
          style={{
            width: '8px',
            height: '8px',
            borderRadius: '50%',
            background: `var(${color})`,
            flexShrink: 0,
          }}
        />

        {/* Group name */}
        <span style={{ fontSize: '12px', fontWeight: 700, color: 'var(--text)', flex: 1 }}>
          {name}
        </span>

        {/* TC count + selection */}
        <span
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: '9px',
            color: 'var(--text-dim)',
            whiteSpace: 'nowrap',
          }}
        >
          {tcs.length} TCs{selectedCount > 0 ? ` · ${selectedCount} selected` : ''}
        </span>

        {/* Pass chip */}
        {passedCount > 0 && (
          <span className="badge badge-pass" style={{ fontSize: '8px' }}>
            {passedCount}✓
          </span>
        )}

        {/* Fail chip */}
        {failedCount > 0 && (
          <span className="badge badge-fail" style={{ fontSize: '8px' }}>
            {failedCount}✗
          </span>
        )}

        {/* Run Group button */}
        <button
          onClick={(e) => {
            e.stopPropagation();
            onRunGroup(tcIds);
          }}
          style={{
            padding: '4px 10px',
            background: 'var(--emerald-dim)',
            border: '1px solid rgba(42,157,143,0.3)',
            borderRadius: '5px',
            color: 'var(--emerald)',
            fontSize: '10px',
            fontWeight: 600,
            cursor: 'pointer',
            whiteSpace: 'nowrap',
            flexShrink: 0,
          }}
        >
          ▶ Run Group
        </button>

        {/* Delete group */}
        {confirmingDelete ? (
          <div
            style={{ display: 'flex', alignItems: 'center', gap: '6px', flexShrink: 0 }}
            onClick={(e) => e.stopPropagation()}
          >
            <span style={{ fontSize: '10px', color: 'var(--fail)', fontWeight: 600 }}>
              Delete {tcs.length} TCs?
            </span>
            <button
              onClick={() => { setConfirmingDelete(false); onDeleteGroup(name); }}
              style={{
                padding: '3px 8px',
                background: 'rgba(220,38,38,0.1)',
                border: '1px solid rgba(220,38,38,0.3)',
                borderRadius: '4px',
                color: 'var(--fail)',
                fontSize: '10px',
                fontWeight: 700,
                cursor: 'pointer',
              }}
            >
              Yes
            </button>
            <button
              onClick={() => setConfirmingDelete(false)}
              style={{
                padding: '3px 8px',
                background: 'var(--surface2)',
                border: '1px solid var(--border)',
                borderRadius: '4px',
                color: 'var(--text-dim)',
                fontSize: '10px',
                cursor: 'pointer',
              }}
            >
              No
            </button>
          </div>
        ) : (
          <button
            title="Delete all TCs in this group"
            onClick={(e) => {
              e.stopPropagation();
              if (tcs.length === 0) return;
              setConfirmingDelete(true);
            }}
            style={{
              width: '22px',
              height: '22px',
              borderRadius: '4px',
              background: 'transparent',
              border: '1px solid transparent',
              color: 'var(--text-dim)',
              fontSize: '11px',
              cursor: tcs.length === 0 ? 'default' : 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
              opacity: tcs.length === 0 ? 0.3 : 0.6,
              transition: 'all 0.15s',
            }}
            onMouseEnter={(e) => {
              if (tcs.length > 0) {
                (e.currentTarget as HTMLButtonElement).style.background = 'rgba(220,38,38,0.1)';
                (e.currentTarget as HTMLButtonElement).style.borderColor = 'rgba(220,38,38,0.3)';
                (e.currentTarget as HTMLButtonElement).style.color = 'var(--fail)';
                (e.currentTarget as HTMLButtonElement).style.opacity = '1';
              }
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLButtonElement).style.background = 'transparent';
              (e.currentTarget as HTMLButtonElement).style.borderColor = 'transparent';
              (e.currentTarget as HTMLButtonElement).style.color = 'var(--text-dim)';
              (e.currentTarget as HTMLButtonElement).style.opacity = tcs.length === 0 ? '0.3' : '0.6';
            }}
          >
            🗑
          </button>
        )}
      </div>

      {/* Expanded table */}
      {expanded && tcs.length > 0 && (
        <div>
          {/* Column headers */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '28px 1fr 60px 148px 90px 96px 80px',
              gap: '8px',
              padding: '6px 14px',
              background: 'var(--surface2)',
              borderBottom: '1px solid var(--border)',
            }}
          >
            {COLUMNS_HEADER.map((col, i) => (
              <div
                key={i}
                style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: '9px',
                  textTransform: 'uppercase',
                  color: 'var(--text-dim)',
                  letterSpacing: '1px',
                  fontWeight: 700,
                }}
              >
                {col}
              </div>
            ))}
          </div>

          {/* TC rows — sortable when onReorder is provided */}
          {onReorder ? (
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
              <SortableContext items={localTcs.map((tc) => tc.id)} strategy={verticalListSortingStrategy}>
                {localTcs.map((tc) => (
                  <SortableRow
                    key={tc.id}
                    id={tc.id}
                    tc={tc}
                    selected={selectedIds.has(tc.id)}
                    hasScript={scriptedTcIds.has(tc.id)}
                    scriptedTcIds={scriptedTcIds}
                    selectedIds={selectedIds}
                    scriptById={scriptById}
                    expandedTcId={expandedTcId}
                    onToggleTc={onToggleTc}
                    onRunIndividual={onRunIndividual}
                    onDeleteTc={onDeleteTc}
                    onEditTc={onEditTc}
                    onLinkScript={onLinkScript}
                    onUnlinkScript={onUnlinkScript}
                    onExpand={handleExpandTc}
                  />
                ))}
              </SortableContext>
            </DndContext>
          ) : (
            tcs.map((tc) => (
              <TCTableRow
                key={tc.id}
                tc={tc}
                selected={selectedIds.has(tc.id)}
                hasScript={scriptedTcIds.has(tc.id)}
                scriptById={scriptById}
                onToggle={onToggleTc}
                onRunIndividual={onRunIndividual}
                onDelete={onDeleteTc}
                onEdit={onEditTc}
                onLinkScript={onLinkScript}
                onUnlinkScript={onUnlinkScript}
                isExpanded={expandedTcId === tc.id}
                onExpand={handleExpandTc}
              />
            ))
          )}
        </div>
      )}

      {expanded && tcs.length === 0 && (
        <div
          style={{
            padding: '20px 14px',
            textAlign: 'center',
            fontFamily: 'var(--font-mono)',
            fontSize: '11px',
            color: 'var(--text-dim)',
          }}
        >
          No test cases in this group.
        </div>
      )}
    </div>
  );
}

function colorToRgba(cssVar: string, alpha: number): string {
  const map: Record<string, string> = {
    '--violet':  `rgba(244,123,32,${alpha})`,
    '--amber':   `rgba(245,158,11,${alpha})`,
    '--emerald': `rgba(42,157,143,${alpha})`,
    '--cyan':    `rgba(37,99,171,${alpha})`,
    '--rose':    `rgba(220,38,38,${alpha})`,
    '--sky':     `rgba(37,99,171,${alpha})`,
    '--pass':    `rgba(42,157,143,${alpha})`,
    '--fail':    `rgba(220,38,38,${alpha})`,
    '--run':     `rgba(37,99,171,${alpha})`,
  };
  return map[cssVar] ?? `rgba(100,100,100,${alpha})`;
}
