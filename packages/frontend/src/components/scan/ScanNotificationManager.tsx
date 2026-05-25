import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { useScanSocket, type ScanCompletedPayload, type ScanFailedPayload } from '../../hooks/useScanSocket';

function requestNotificationPermission() {
  if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
    Notification.requestPermission();
  }
}

function fireBrowserNotification(title: string, body: string, targetUrl: string, navigate: ReturnType<typeof useNavigate>) {
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
  const n = new Notification(title, { body, icon: '/favicon.ico', tag: 'qa-scan' });
  n.onclick = () => {
    window.focus();
    navigate(targetUrl);
    n.close();
  };
}

export default function ScanNotificationManager() {
  const navigate = useNavigate();

  useScanSocket({
    onStarted: () => {
      requestNotificationPermission();
    },

    onCompleted: (data: ScanCompletedPayload) => {
      const url = `/projects/${data.projectSlug}/settings?tab=scanner`;
      const body = data.useCaseCount > 0
        ? `${data.useCaseCount} use case${data.useCaseCount !== 1 ? 's' : ''} · ${data.tcCount} TC draft${data.tcCount !== 1 ? 's' : ''} ready for review`
        : 'Scan finished — no use cases detected';

      toast.custom(
        (t) => (
          <div
            onClick={() => { navigate(url); toast.dismiss(t.id); }}
            style={{
              display: 'flex', flexDirection: 'column', gap: 3,
              padding: '10px 14px', borderRadius: 8, cursor: 'pointer',
              background: 'var(--surface2, #1e293b)',
              border: '1px solid rgba(42,157,143,0.4)',
              boxShadow: '0 4px 20px rgba(0,0,0,0.4)',
              minWidth: 260, maxWidth: 340,
              opacity: t.visible ? 1 : 0,
              transition: 'opacity 0.2s',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ fontSize: 14 }}>✅</span>
              <span style={{ fontWeight: 700, fontSize: 13, color: '#2A9D8F' }}>UI Scan Complete</span>
            </div>
            <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.7)', paddingLeft: 20 }}>{body}</div>
            <div style={{ fontSize: 10, color: '#22d3ee', paddingLeft: 20, marginTop: 1 }}>
              Click to view results →
            </div>
          </div>
        ),
        { duration: 12000, position: 'bottom-right' },
      );

      fireBrowserNotification('✅ UI Scan Complete', body, url, navigate);
    },

    onFailed: (data: ScanFailedPayload) => {
      const url = `/projects/${data.projectSlug}/settings?tab=scanner`;
      const errMsg = data.error?.slice(0, 100) ?? 'Unknown error';

      toast.custom(
        (t) => (
          <div
            onClick={() => { navigate(url); toast.dismiss(t.id); }}
            style={{
              display: 'flex', flexDirection: 'column', gap: 3,
              padding: '10px 14px', borderRadius: 8, cursor: 'pointer',
              background: 'var(--surface2, #1e293b)',
              border: '1px solid rgba(220,38,38,0.4)',
              boxShadow: '0 4px 20px rgba(0,0,0,0.4)',
              minWidth: 260, maxWidth: 340,
              opacity: t.visible ? 1 : 0,
              transition: 'opacity 0.2s',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ fontSize: 14 }}>❌</span>
              <span style={{ fontWeight: 700, fontSize: 13, color: '#DC2626' }}>UI Scan Failed</span>
            </div>
            <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.7)', paddingLeft: 20 }}>{errMsg}</div>
            <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.4)', paddingLeft: 20, marginTop: 1 }}>
              Click to view details →
            </div>
          </div>
        ),
        { duration: 12000, position: 'bottom-right' },
      );

      fireBrowserNotification('❌ UI Scan Failed', errMsg, url, navigate);
    },
  });

  return null;
}
