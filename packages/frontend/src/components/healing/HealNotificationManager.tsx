import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { useHealSocket, type HealAutoAppliedPayload } from '../../hooks/useHealSocket';

export default function HealNotificationManager() {
  const navigate = useNavigate();

  useHealSocket({
    onAutoApplied: (data: HealAutoAppliedPayload) => {
      const url = `/projects/${data.projectSlug}/healing`;

      toast.custom(
        (t) => (
          <div
            onClick={() => { navigate(url); toast.dismiss(t.id); }}
            style={{
              display: 'flex', flexDirection: 'column', gap: 4,
              padding: '10px 14px', borderRadius: 8, cursor: 'pointer',
              background: 'var(--surface2, #1e293b)',
              border: '1px solid rgba(220,38,38,0.35)',
              boxShadow: '0 4px 20px rgba(0,0,0,0.4)',
              minWidth: 260, maxWidth: 360,
              opacity: t.visible ? 1 : 0,
              transition: 'opacity 0.2s',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ fontSize: 14 }}>⟳</span>
              <span style={{ fontWeight: 700, fontSize: 13, color: 'var(--fail, #ef4444)' }}>
                Heal Auto-Applied
              </span>
              <span style={{
                marginLeft: 'auto', fontSize: 9, fontWeight: 700,
                padding: '1px 5px', borderRadius: 4,
                background: 'rgba(220,38,38,0.15)',
                color: 'var(--fail, #ef4444)',
                border: '1px solid rgba(220,38,38,0.3)',
                fontFamily: 'var(--font-mono)',
              }}>
                {data.confidence}%
              </span>
            </div>
            <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.85)', paddingLeft: 20, fontWeight: 500 }}>
              {data.tcTitle}
            </div>
            {data.explanation && (
              <div style={{
                fontSize: 10, color: 'rgba(255,255,255,0.65)', paddingLeft: 20,
                lineHeight: 1.55, marginTop: 1,
                display: '-webkit-box',
                WebkitLineClamp: 2,
                WebkitBoxOrient: 'vertical' as const,
                overflow: 'hidden',
              }}>
                {data.explanation}
              </div>
            )}
            <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.5)', paddingLeft: 20, marginTop: 2 }}>
              {data.runId ? 'Script patched · Test re-queued for verification' : 'Script patched · Review in Healing tab'}
            </div>
            <div style={{ fontSize: 10, color: 'var(--fail, #ef4444)', paddingLeft: 20, marginTop: 2 }}>
              Click to view healing details →
            </div>
          </div>
        ),
        { duration: 12000, position: 'bottom-right' },
      );
    },
  });

  return null;
}
