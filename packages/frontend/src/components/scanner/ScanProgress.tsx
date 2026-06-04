import React, { useEffect, useState } from 'react';
import { Globe, Lock, Map, Target, ClipboardList, Cpu, CheckCircle2, Circle, Loader2 } from 'lucide-react';
import type { UIScan } from '../../types';

interface ScanProgressProps {
  scan: UIScan;
  onCancel?: () => void;
}

interface Phase {
  label: string;
  icon: React.ElementType;
  minProgress: number;
  maxProgress: number;
}

const PHASES: Phase[] = [
  { label: 'Login',           icon: Lock,           minProgress: 0,  maxProgress: 15  },
  { label: 'Nav Map',         icon: Map,            minProgress: 15, maxProgress: 30  },
  { label: 'Pages',           icon: Globe,          minProgress: 30, maxProgress: 70  },
  { label: 'Locators',        icon: Target,         minProgress: 70, maxProgress: 85  },
  { label: 'AI Analysis',     icon: Cpu,            minProgress: 85, maxProgress: 95  },
  { label: 'TC Generation',   icon: ClipboardList,  minProgress: 95, maxProgress: 100 },
];

function getPhaseState(phase: Phase, progress: number): 'done' | 'active' | 'pending' {
  if (progress >= phase.maxProgress) return 'done';
  if (progress >= phase.minProgress) return 'active';
  return 'pending';
}

function useElapsed(startedAt: string | null): string {
  const [elapsed, setElapsed] = useState('0s');

  useEffect(() => {
    if (!startedAt) return;
    const start = new Date(startedAt).getTime();
    const update = () => {
      const secs = Math.floor((Date.now() - start) / 1000);
      if (secs < 60) setElapsed(`${secs}s`);
      else setElapsed(`${Math.floor(secs / 60)}m ${secs % 60}s`);
    };
    update();
    const id = setInterval(update, 1000);
    return () => clearInterval(id);
  }, [startedAt]);

  return elapsed;
}

export default function ScanProgress({ scan, onCancel }: ScanProgressProps) {
  const elapsed = useElapsed(scan.startedAt);
  const isRunning = scan.status === 'RUNNING' || scan.status === 'PENDING';

  return (
    <div
      className="card"
      style={{ borderTop: '4px solid var(--6d-orange)', padding: '20px', display: 'flex', flexDirection: 'column', gap: '16px' }}
    >
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          {isRunning ? (
            <span
              style={{
                width: '10px', height: '10px', borderRadius: '50%',
                background: 'var(--6d-orange)',
                boxShadow: '0 0 6px var(--6d-orange)',
                animation: 'pulse 1.5s ease-in-out infinite',
                display: 'inline-block',
                flexShrink: 0,
              }}
            />
          ) : (
            <CheckCircle2 size={16} color="var(--pass)" />
          )}
          <span style={{ fontWeight: 700, fontSize: '14px', color: 'var(--text)' }}>
            {scan.status === 'PENDING' ? 'Queued…' : scan.status === 'RUNNING' ? 'Scan Running' : scan.status === 'COMPLETED' ? 'Scan Complete' : 'Scan Failed'}
          </span>
          {isRunning && (
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: '11px', color: 'var(--text-dim)' }}>
              {elapsed}
            </span>
          )}
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          {isRunning && onCancel && (
            <button
              type="button"
              onClick={onCancel}
              style={{
                padding: '5px 12px', fontSize: '11px', fontWeight: 600, cursor: 'pointer',
                border: '1px solid var(--fail)', borderRadius: '6px',
                background: 'transparent', color: 'var(--fail)',
                fontFamily: 'var(--font-ui)',
              }}
            >
              Cancel
            </button>
          )}
        </div>
      </div>

      {/* Phase badges */}
      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
        {PHASES.map((phase) => {
          const state = getPhaseState(phase, scan.progress);
          const Icon = phase.icon;
          return (
            <div
              key={phase.label}
              style={{
                display: 'flex', alignItems: 'center', gap: '5px',
                padding: '4px 10px', borderRadius: '20px', fontSize: '11px', fontWeight: 600,
                fontFamily: 'var(--font-ui)',
                background: state === 'done'
                  ? 'var(--emerald-dim)'
                  : state === 'active'
                  ? 'var(--violet-dim)'
                  : 'var(--surface2)',
                color: state === 'done'
                  ? 'var(--emerald)'
                  : state === 'active'
                  ? 'var(--6d-orange)'
                  : 'var(--text-dim)',
                border: state === 'active' ? '1px solid var(--6d-orange)' : '1px solid transparent',
              }}
            >
              {state === 'done' ? (
                <CheckCircle2 size={11} />
              ) : state === 'active' ? (
                <Loader2 size={11} style={{ animation: 'spin 1s linear infinite' }} />
              ) : (
                <Circle size={11} />
              )}
              <Icon size={11} />
              {phase.label}
              {phase.label === 'Pages' && scan.pagesTotal > 0 && (
                <span style={{ opacity: 0.8 }}>
                  &nbsp;{scan.pagesScanned}/{scan.pagesTotal}
                </span>
              )}
            </div>
          );
        })}
      </div>

      {/* Progress bar */}
      <div>
        <div
          style={{
            background: 'var(--surface2)',
            height: '8px',
            borderRadius: 'var(--radius)',
            overflow: 'hidden',
          }}
        >
          <div
            className={isRunning ? 'scan-progress-fill-animated' : ''}
            style={{
              height: '100%',
              borderRadius: 'var(--radius)',
              width: `${scan.progress}%`,
              transition: 'width 0.5s ease',
              background: isRunning
                ? undefined
                : scan.status === 'FAILED'
                ? 'var(--fail)'
                : 'linear-gradient(90deg, var(--6d-blue), var(--6d-orange))',
            }}
          />
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '4px' }}>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: '10px', color: 'var(--text-dim)' }}>
            {scan.progress}% complete
          </span>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: '10px', color: 'var(--text-dim)' }}>
            Pages scanned: {scan.pagesScanned}{scan.pagesTotal > 0 ? `/${scan.pagesTotal}` : ''}
          </span>
        </div>
      </div>

      {/* Current page */}
      {scan.currentPage && scan.currentPage !== 'analysis' && (
        <div
          style={{
            padding: '8px 12px',
            background: 'var(--surface2)',
            borderRadius: 'var(--radius)',
            display: 'flex', alignItems: 'center', gap: '8px',
          }}
        >
          <Globe size={12} color="var(--text-dim)" />
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: '11px', color: 'var(--cyan)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {scan.currentPage}
          </span>
        </div>
      )}

      {/* Error message */}
      {scan.errorMessage && (
        <div
          style={{
            padding: '10px 14px',
            background: 'var(--rose-dim)',
            border: '1px solid rgba(220,38,38,0.2)',
            borderRadius: 'var(--radius)',
            fontFamily: 'var(--font-mono)',
            fontSize: '12px',
            color: 'var(--rose)',
          }}
        >
          {scan.errorMessage}
        </div>
      )}
    </div>
  );
}
