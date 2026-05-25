import ActionCard from './ActionCard';
import type { ChatMessage } from '../../types';

// ── Typing indicator ───────────────────────────────────────────────────────

export function TypingIndicator() {
  return (
    <div style={{ display: 'flex', gap: 10, maxWidth: '80%' }}>
      <div style={{
        width: 30, height: 30, borderRadius: '50%', flexShrink: 0,
        background: 'linear-gradient(135deg, var(--cyan), var(--violet))',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 13, marginTop: 2, color: '#fff', fontWeight: 700,
      }}>
        ∞
      </div>
      <div style={{
        padding: '10px 14px',
        borderRadius: 10,
        borderTopLeftRadius: 3,
        background: 'var(--surface2)',
        border: '1px solid var(--border)',
        display: 'flex',
        gap: 5,
        alignItems: 'center',
      }}>
        {[0, 1, 2].map(i => (
          <span
            key={i}
            style={{
              width: 6,
              height: 6,
              borderRadius: '50%',
              background: 'var(--text-dim)',
              display: 'inline-block',
              animation: 'typing-dot 1.2s infinite',
              animationDelay: `${i * 0.2}s`,
            }}
          />
        ))}
      </div>
    </div>
  );
}

// ── Message bubble ─────────────────────────────────────────────────────────

interface MessageBubbleProps {
  message: ChatMessage;
  userInitials: string;
}

export default function MessageBubble({ message, userInitials }: MessageBubbleProps) {
  const isAI = message.role === 'assistant';

  let actionPayload: Record<string, unknown> | undefined;
  if (message.actionPayload) {
    try {
      actionPayload = JSON.parse(message.actionPayload) as Record<string, unknown>;
    } catch { /* ignore parse errors */ }
  }

  const timestamp = new Date(message.createdAt).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  });

  if (isAI) {
    return (
      <div style={{ display: 'flex', gap: 10, maxWidth: '80%', alignSelf: 'flex-start' }}>
        {/* Avatar */}
        <div style={{
          width: 30, height: 30, borderRadius: '50%', flexShrink: 0,
          background: 'linear-gradient(135deg, var(--cyan), var(--violet))',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 13, marginTop: 2, color: '#fff', fontWeight: 700,
        }}>
          ∞
        </div>

        <div style={{ flex: 1, minWidth: 0 }}>
          {/* Bubble */}
          <div style={{
            padding: '10px 14px',
            borderRadius: 10,
            borderTopLeftRadius: 3,
            background: 'var(--surface2)',
            border: '1px solid var(--border)',
            fontSize: 12,
            lineHeight: 1.6,
            color: 'var(--text)',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
          }}>
            {message.content}
          </div>

          {/* Action card */}
          {message.actionType && actionPayload && (
            <ActionCard actionType={message.actionType} actionPayload={actionPayload} />
          )}

          {/* Timestamp */}
          <div style={{
            fontSize: 9,
            color: 'var(--text-dim)',
            marginTop: 4,
            fontFamily: 'var(--font-mono)',
          }}>
            {timestamp}
          </div>
        </div>
      </div>
    );
  }

  // User message
  return (
    <div style={{
      display: 'flex', gap: 10, maxWidth: '80%',
      alignSelf: 'flex-end', flexDirection: 'row-reverse',
    }}>
      {/* Avatar */}
      <div style={{
        width: 30, height: 30, borderRadius: '50%', flexShrink: 0,
        background: 'linear-gradient(135deg, var(--violet), #e879f9)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 10, marginTop: 2, color: '#fff', fontWeight: 700,
      }}>
        {userInitials}
      </div>

      <div>
        <div style={{
          padding: '10px 14px',
          borderRadius: 10,
          borderTopRightRadius: 3,
          background: 'var(--cyan-dim, rgba(34,211,238,0.08))',
          border: '1px solid rgba(37,99,171,0.2)',
          fontSize: 12,
          lineHeight: 1.6,
          color: 'var(--text)',
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
        }}>
          {message.content}
        </div>
        <div style={{
          fontSize: 9,
          color: 'var(--text-dim)',
          marginTop: 4,
          textAlign: 'right',
          fontFamily: 'var(--font-mono)',
        }}>
          {timestamp}
        </div>
      </div>
    </div>
  );
}
