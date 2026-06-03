import React, { useState, useEffect, useRef } from 'react';
import { useRunSocket } from '../../hooks/useRunSocket';

// ── Types ─────────────────────────────────────────────────────────────────

interface ExecutionMonitorProps {
  runId: string;
  projectId?: string;
  scriptName: string;
  onClose: () => void;
  onFixWithAi?: (failedStep: string, errorMessage: string) => void;
}

// ── Step indicator helpers ─────────────────────────────────────────────────

function lineIcon(kind: string): { icon: string; color: string } {
  switch (kind) {
    case 'pass':  return { icon: '✓', color: 'var(--emerald)' };
    case 'fail':  return { icon: '✗', color: 'var(--rose)' };
    case 'warn':  return { icon: '⚠', color: 'var(--amber)' };
    case 'run':   return { icon: '●', color: 'var(--cyan)' };
    default:      return { icon: '▶', color: 'rgba(148,163,184,0.5)' };
  }
}

function formatTs(ts: string): string {
  try {
    return new Date(ts).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  } catch {
    return '';
  }
}

// ── Component ─────────────────────────────────────────────────────────────

export default function ExecutionMonitor({
  runId, scriptName, onClose, onFixWithAi,
}: ExecutionMonitorProps) {
  const { logs, stats, status, joinRun, leaveRun } = useRunSocket();

  const [pos, setPos] = useState({ x: 40, y: 80 });
  const [size, setSize] = useState({ w: 620, h: 500 });
  const [dragging, setDragging] = useState(false);
  const [resizing, setResizing] = useState(false);
  const dragRef = useRef({ startX: 0, startY: 0, origX: 0, origY: 0 });
  const resizeRef = useRef({ startX: 0, startY: 0, origW: 0, origH: 0 });
  const logEndRef = useRef<HTMLDivElement | null>(null);

  // Join run room on mount
  useEffect(() => {
    joinRun(runId);
    return () => { leaveRun(runId); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runId]);

  // Scroll to bottom on new logs
  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs.length]);

  // ── Drag handling ─────────────────────────────────────────────────────────

  const handleDragStart = (e: React.MouseEvent) => {
    setDragging(true);
    dragRef.current = { startX: e.clientX, startY: e.clientY, origX: pos.x, origY: pos.y };
  };

  useEffect(() => {
    if (!dragging) return;
    const onMove = (e: MouseEvent) => setPos({ x: Math.max(0, dragRef.current.origX + e.clientX - dragRef.current.startX), y: Math.max(0, dragRef.current.origY + e.clientY - dragRef.current.startY) });
    const onUp = () => setDragging(false);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
  }, [dragging]);

  // ── Resize handling ───────────────────────────────────────────────────────

  const handleResizeStart = (e: React.MouseEvent) => {
    e.stopPropagation();
    setResizing(true);
    resizeRef.current = { startX: e.clientX, startY: e.clientY, origW: size.w, origH: size.h };
  };

  useEffect(() => {
    if (!resizing) return;
    const onMove = (e: MouseEvent) => setSize({ w: Math.max(480, resizeRef.current.origW + e.clientX - resizeRef.current.startX), h: Math.max(360, resizeRef.current.origH + e.clientY - resizeRef.current.startY) });
    const onUp = () => setResizing(false);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
  }, [resizing]);

  // ── Fix with AI ───────────────────────────────────────────────────────────

  const handleFixWithAi = () => {
    const failLine = [...logs].reverse().find(l => l.kind === 'fail');
    const errLine = [...logs].reverse().find(l => l.text.toLowerCase().includes('error') || l.text.toLowerCase().includes('timeout'));
    onFixWithAi?.(failLine?.text ?? `Run failed: ${scriptName}`, errLine?.text ?? '');
    onClose();
  };

  // ── Derived ───────────────────────────────────────────────────────────────

  const isRunning = status === 'running' || status === 'connecting' || status === 'idle';
  const hasFailed = stats.failed > 0 || status === 'error';
  const hasPassed = status === 'complete' && stats.failed === 0;

  const statusColor = hasPassed ? 'var(--emerald)' : hasFailed ? 'var(--rose)' : 'var(--amber)';
  const statusLabel = hasPassed ? 'PASSED' : hasFailed ? 'FAILED' : isRunning ? 'RUNNING' : 'DONE';

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div
      style={{
        position: 'fixed', left: pos.x, top: pos.y,
        width: size.w, height: size.h, zIndex: 9000,
        background: 'var(--surface)', border: `1px solid ${statusColor}44`,
        borderRadius: 10, boxShadow: '0 24px 80px rgba(0,0,0,0.7)',
        display: 'flex', flexDirection: 'column',
        fontFamily: 'var(--font-ui)', overflow: 'hidden',
        userSelect: dragging || resizing ? 'none' : 'auto',
      }}
    >
      {/* Title bar — draggable */}
      <div
        onMouseDown={handleDragStart}
        style={{
          display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px',
          background: 'rgba(0,0,0,0.3)', borderBottom: '1px solid rgba(255,255,255,0.07)',
          cursor: 'move', flexShrink: 0,
        }}
      >
        <span style={{ fontSize: 10, fontWeight: 700, color: statusColor, letterSpacing: 1 }}>
          {hasPassed ? '✓' : hasFailed ? '✗' : '●'} {statusLabel}
        </span>
        <span style={{ flex: 1, fontSize: 11, color: 'var(--text-mid)', fontFamily: 'var(--font-mono)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {scriptName}
        </span>
        <div style={{ display: 'flex', gap: 6, cursor: 'default' }}>
          {hasFailed && onFixWithAi && (
            <button
              onClick={handleFixWithAi}
              style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 4, cursor: 'pointer', background: 'rgba(248,113,113,0.15)', border: '1px solid rgba(248,113,113,0.4)', color: 'var(--rose)' }}
            >
              🩹 Fix with AI
            </button>
          )}
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--text-dim)', fontSize: 16, cursor: 'pointer', lineHeight: 1, padding: '0 2px' }}>×</button>
        </div>
      </div>

      {/* Stats bar */}
      {(stats.total > 0 || status !== 'idle') && (
        <div style={{ display: 'flex', gap: 16, padding: '4px 12px', background: 'rgba(0,0,0,0.2)', borderBottom: '1px solid rgba(255,255,255,0.05)', flexShrink: 0 }}>
          <span style={{ fontSize: 10, color: 'var(--emerald)', fontFamily: 'var(--font-mono)' }}>✓ {stats.passed}</span>
          <span style={{ fontSize: 10, color: 'var(--rose)', fontFamily: 'var(--font-mono)' }}>✗ {stats.failed}</span>
          <span style={{ fontSize: 10, color: 'var(--text-dim)', fontFamily: 'var(--font-mono)' }}>total {stats.total}</span>
        </div>
      )}

      {/* Step log */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '8px 10px' }}>
        <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-dim)', letterSpacing: 1, marginBottom: 6 }}>STEP LOG (live)</div>
        {logs.length === 0 && (
          <div style={{ fontSize: 11, color: 'var(--text-dim)', fontFamily: 'var(--font-mono)' }}>
            {status === 'idle' || status === 'connecting' ? 'Connecting…' : 'Waiting for output…'}
          </div>
        )}
        {logs.map((line, i) => {
          const { icon, color } = lineIcon(line.kind);
          return (
            <div
              key={i}
              style={{
                display: 'flex', gap: 8, padding: '2px 4px', borderRadius: 3,
                background: line.kind === 'fail' ? 'rgba(248,113,113,0.06)' : 'transparent',
              }}
            >
              <span style={{ fontSize: 11, color, fontFamily: 'var(--font-mono)', flexShrink: 0 }}>{icon}</span>
              <span style={{ fontSize: 9, color: 'var(--text-dim)', fontFamily: 'var(--font-mono)', flexShrink: 0 }}>[{formatTs(line.ts)}]</span>
              <span style={{ fontSize: 11, color: line.kind === 'fail' ? 'var(--rose)' : line.kind === 'pass' ? 'var(--emerald)' : 'var(--text-mid)', wordBreak: 'break-all', flex: 1 }}>
                {line.text}
              </span>
            </div>
          );
        })}
        <div ref={logEndRef} />
      </div>

      {/* Footer */}
      <div style={{ display: 'flex', gap: 8, padding: '6px 10px', borderTop: '1px solid rgba(255,255,255,0.07)', background: 'rgba(0,0,0,0.2)', flexShrink: 0, alignItems: 'center' }}>
        <span style={{ fontSize: 9, color: 'var(--text-dim)' }}>Run: {runId.slice(0, 8)}…</span>
        <div style={{ flex: 1 }} />
        {hasFailed && onFixWithAi && (
          <button
            onClick={handleFixWithAi}
            style={{ fontSize: 10, fontWeight: 700, padding: '2px 10px', borderRadius: 4, cursor: 'pointer', background: 'rgba(139,92,246,0.15)', border: '1px solid rgba(139,92,246,0.35)', color: 'var(--violet)' }}
          >
            🩹 Fix with AI
          </button>
        )}
      </div>

      {/* Resize handle */}
      <div
        onMouseDown={handleResizeStart}
        style={{ position: 'absolute', bottom: 0, right: 0, width: 16, height: 16, cursor: 'se-resize', background: 'linear-gradient(135deg, transparent 50%, rgba(255,255,255,0.15) 50%)', borderBottomRightRadius: 10 }}
      />
    </div>
  );
}
