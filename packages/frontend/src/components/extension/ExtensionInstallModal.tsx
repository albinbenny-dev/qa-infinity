import { useState, useRef } from 'react';
import { api } from '../../lib/api';

interface Props {
  onClose: () => void;
}

const STEPS = [
  {
    n: 1,
    icon: '⬇',
    title: 'Download the extension',
    body: 'Click the button below to download the ZIP file.',
  },
  {
    n: 2,
    icon: '📂',
    title: 'Unzip the file',
    body: 'Extract the downloaded ZIP to any permanent folder on your computer (e.g. Documents/qa-infinity-extension).',
  },
  {
    n: 3,
    icon: '🧩',
    title: 'Open Chrome Extensions',
    body: (
      <>
        In Chrome, navigate to{' '}
        <code style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--cyan)', background: 'rgba(34,211,238,0.08)', padding: '1px 5px', borderRadius: 3 }}>
          chrome://extensions
        </code>
      </>
    ),
  },
  {
    n: 4,
    icon: '🔧',
    title: 'Enable Developer mode',
    body: 'Toggle the "Developer mode" switch in the top-right corner of the Extensions page.',
  },
  {
    n: 5,
    icon: '📁',
    title: 'Load the extension',
    body: 'Click "Load unpacked" and select the unzipped folder (the one containing manifest.json).',
  },
  {
    n: 6,
    icon: '📌',
    title: 'Pin it to your toolbar',
    body: 'Click the puzzle-piece icon in Chrome\'s toolbar → find "QA Infinity Locator Capture" → click the pin icon.',
  },
];

export default function ExtensionInstallModal({ onClose }: Props) {
  const [downloading, setDownloading] = useState(false);
  const overlayMouseDownRef = useRef(false);

  async function handleDownload() {
    setDownloading(true);
    try {
      const res = await api.get('/extension/download', { responseType: 'blob' });
      const url = URL.createObjectURL(res.data as Blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'qa-infinity-extension.zip';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } finally {
      setDownloading(false);
    }
  }

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 2000,
        background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(3px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
      onMouseDown={(e) => { overlayMouseDownRef.current = e.target === e.currentTarget; }}
      onClick={(e) => { if (e.target === e.currentTarget && overlayMouseDownRef.current) onClose(); }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: 'var(--surface)', border: '1px solid var(--border)',
          borderRadius: 12, width: 480, maxWidth: '94vw', maxHeight: '90vh',
          boxShadow: '0 32px 80px rgba(0,0,0,0.55)',
          display: 'flex', flexDirection: 'column', overflow: 'hidden',
        }}
      >
        {/* Header */}
        <div style={{
          padding: '16px 20px', borderBottom: '1px solid var(--border)',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 20 }}>🧩</span>
            <div>
              <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>
                QA Infinity Chrome Extension
              </div>
              <div style={{ fontSize: 10, color: 'var(--text-dim)', marginTop: 1 }}>
                Locator Capture · Flow Recorder · v1.0.0
              </div>
            </div>
          </div>
          <button
            onClick={onClose}
            style={{ background: 'none', border: 'none', color: 'var(--text-dim)', fontSize: 18, cursor: 'pointer', lineHeight: 1, padding: 4 }}
          >×</button>
        </div>

        {/* What it does */}
        <div style={{
          margin: '16px 20px 0',
          padding: '12px 14px',
          background: 'rgba(34,211,238,0.06)', border: '1px solid rgba(34,211,238,0.18)',
          borderRadius: 8, display: 'flex', gap: 16,
        }}>
          {[
            { icon: '🎯', label: 'Locator Picker', desc: 'Click any element to capture its best selector into the Object Repository.' },
            { icon: '🎬', label: 'Flow Recorder', desc: 'Record click/input flows and import them as UI Flow skills.' },
          ].map((f) => (
            <div key={f.label} style={{ flex: 1 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--cyan)', marginBottom: 3 }}>
                {f.icon} {f.label}
              </div>
              <div style={{ fontSize: 10, color: 'var(--text-dim)', lineHeight: 1.5 }}>{f.desc}</div>
            </div>
          ))}
        </div>

        {/* Steps */}
        <div style={{ overflowY: 'auto', padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-mid)', marginBottom: 2 }}>
            Installation steps
          </div>
          {STEPS.map((step) => (
            <div key={step.n} style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
              {/* Step number */}
              <div style={{
                width: 24, height: 24, borderRadius: '50%', flexShrink: 0,
                background: 'rgba(139,92,246,0.15)', border: '1px solid rgba(139,92,246,0.35)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 10, fontWeight: 700, color: 'var(--violet)',
              }}>
                {step.n}
              </div>
              {/* Content */}
              <div style={{ paddingTop: 3 }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text)', marginBottom: 2 }}>
                  {step.icon} {step.title}
                </div>
                <div style={{ fontSize: 10, color: 'var(--text-dim)', lineHeight: 1.55 }}>
                  {step.body}
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Footer */}
        <div style={{
          padding: '14px 20px', borderTop: '1px solid var(--border)',
          display: 'flex', gap: 8, justifyContent: 'flex-end', alignItems: 'center',
        }}>
          <span style={{ fontSize: 10, color: 'var(--text-dim)', flex: 1 }}>
            Chrome · Edge · Brave — Manifest V3
          </span>
          <button
            onClick={onClose}
            style={{
              padding: '7px 14px', borderRadius: 6, border: '1px solid var(--border)',
              background: 'transparent', color: 'var(--text-mid)', fontSize: 12,
              fontWeight: 600, cursor: 'pointer', fontFamily: 'var(--font-ui)',
            }}
          >
            Close
          </button>
          <button
            onClick={handleDownload}
            disabled={downloading}
            style={{
              padding: '7px 16px', borderRadius: 6, border: 'none',
              cursor: downloading ? 'wait' : 'pointer', fontSize: 12,
              fontWeight: 700, fontFamily: 'var(--font-ui)', color: '#fff',
              background: 'linear-gradient(135deg, var(--violet), var(--cyan))',
              opacity: downloading ? 0.7 : 1, display: 'flex', alignItems: 'center', gap: 6,
            }}
          >
            {downloading ? '⏳ Downloading…' : '⬇ Download Extension (.zip)'}
          </button>
        </div>
      </div>
    </div>
  );
}
