import { useMemo } from 'react';
import {
  DndContext,
  closestCenter,
  DragEndEvent,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
  arrayMove,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { TestCase } from '../../types';

// ── Single draggable row ───────────────────────────────────────────────────

function SortableRow({
  tc,
  index,
  onRemove,
}: {
  tc: TestCase;
  index: number;
  onRemove?: () => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: tc.id });

  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.45 : 1,
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '5px 8px',
        background: 'var(--surface)',
        border: `1px solid ${isDragging ? 'var(--cyan)' : 'var(--border)'}`,
        borderRadius: 6,
        fontSize: 11,
        cursor: 'default',
        userSelect: 'none',
        boxShadow: isDragging ? '0 4px 12px rgba(0,0,0,0.2)' : undefined,
      }}
    >
      {/* Order index */}
      <span style={{
        minWidth: 16, height: 16, borderRadius: '50%',
        background: 'rgba(37,99,171,0.14)', color: 'var(--cyan)',
        fontSize: 8, fontWeight: 800,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        flexShrink: 0,
      }}>{index + 1}</span>

      {/* Drag handle */}
      <span
        {...attributes}
        {...listeners}
        title="Drag to reorder"
        style={{
          cursor: isDragging ? 'grabbing' : 'grab',
          color: 'var(--text-dim)',
          fontSize: 14,
          lineHeight: 1,
          opacity: 0.6,
          flexShrink: 0,
          touchAction: 'none',
        }}
      >
        ⠿
      </span>

      {/* TC ID badge */}
      <span style={{
        fontSize: 9, fontWeight: 700, flexShrink: 0,
        color: 'var(--cyan)', background: 'var(--cyan-dim)',
        padding: '1px 6px', borderRadius: 4,
      }}>
        {tc.tcId}
      </span>

      {/* Title */}
      <span style={{
        flex: 1, color: 'var(--text)',
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
      }}>
        {tc.title}
      </span>

      {/* Use case chip */}
      {tc.useCaseTag && (
        <span style={{
          fontSize: 9, color: 'var(--text-dim)', flexShrink: 0,
          maxWidth: 80, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {tc.useCaseTag}
        </span>
      )}

      {/* Remove button */}
      {onRemove && (
        <button
          type="button"
          onClick={onRemove}
          title="Remove"
          style={{
            width: 16, height: 16, borderRadius: 3,
            border: '1px solid rgba(220,38,38,0.25)',
            background: 'transparent', color: 'var(--fail)',
            cursor: 'pointer', fontSize: 9,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            flexShrink: 0, lineHeight: 1,
          }}
        >
          ✕
        </button>
      )}
    </div>
  );
}

// ── Public component ──────────────────────────────────────────────────────

export default function SortableTcList({
  tcIds,
  allTcs,
  onChange,
  onRemove,
  emptyMessage = 'No test cases selected.',
}: {
  tcIds: string[];
  allTcs: TestCase[];
  onChange: (newIds: string[]) => void;
  onRemove?: (id: string) => void;
  emptyMessage?: string;
}) {
  const tcMap = useMemo(() => new Map(allTcs.map((tc) => [tc.id, tc])), [allTcs]);
  const visibleTcs = tcIds.map((id) => tcMap.get(id)).filter(Boolean) as TestCase[];

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (over && active.id !== over.id) {
      const oldIdx = tcIds.indexOf(active.id as string);
      const newIdx = tcIds.indexOf(over.id as string);
      if (oldIdx !== -1 && newIdx !== -1) onChange(arrayMove(tcIds, oldIdx, newIdx));
    }
  }

  if (visibleTcs.length === 0) {
    return (
      <div style={{ padding: '10px 0', fontSize: 11, color: 'var(--text-dim)', textAlign: 'center' }}>
        {emptyMessage}
      </div>
    );
  }

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
      <SortableContext items={tcIds} strategy={verticalListSortingStrategy}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {visibleTcs.map((tc, idx) => (
            <SortableRow
              key={tc.id}
              tc={tc}
              index={idx}
              onRemove={onRemove ? () => onRemove(tc.id) : undefined}
            />
          ))}
        </div>
      </SortableContext>
    </DndContext>
  );
}
