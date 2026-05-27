import { useEffect, useRef, useCallback } from 'react';

// ── Extend Window with Google Identity Services types ─────────────────────────
declare global {
  interface Window {
    google?: {
      accounts: {
        id: {
          initialize:   (config: GoogleIdConfig) => void;
          renderButton: (element: HTMLElement, config: GoogleBtnConfig) => void;
          cancel:       () => void;
        };
      };
    };
  }
}

interface GoogleIdConfig {
  client_id: string;
  callback:  (response: { credential: string }) => void;
  auto_select?: boolean;
}

interface GoogleBtnConfig {
  type?:           'standard' | 'icon';
  theme?:          'outline' | 'filled_blue' | 'filled_black';
  size?:           'large' | 'medium' | 'small';
  text?:           'signin_with' | 'signup_with' | 'continue_with' | 'signin';
  width?:          number;
  logo_alignment?: 'left' | 'center';
  shape?:          'rectangular' | 'pill' | 'circle' | 'square';
}

// ── Component ─────────────────────────────────────────────────────────────────

interface GoogleAuthButtonProps {
  /** Google OAuth 2.0 client ID */
  clientId: string;
  /** Called with the raw ID token when the user completes Google sign-in */
  onCredential: (credential: string) => void;
  /** Button label text */
  text?: GoogleBtnConfig['text'];
  /** Loading state — disables the button while the parent is processing */
  loading?: boolean;
}

const GSI_SCRIPT_URL = 'https://accounts.google.com/gsi/client';
const GSI_SCRIPT_ID  = 'google-gsi-script';

/**
 * GoogleAuthButton — renders Google's official "Sign in with Google" button.
 *
 * Loads the Google Identity Services (GIS) script on first mount.
 * The button is re-initialized whenever clientId changes.
 * Calls onCredential(idToken) — POST that token to /api/auth/google.
 *
 * Usage:
 *   <GoogleAuthButton
 *     clientId={config.googleClientId!}
 *     onCredential={async (credential) => {
 *       const res = await api.post('/auth/google', { credential });
 *       setAuth(res.data.token, res.data.user);
 *     }}
 *   />
 */
export default function GoogleAuthButton({
  clientId,
  onCredential,
  text    = 'signin_with',
  loading = false,
}: GoogleAuthButtonProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const initializedRef = useRef(false);

  const renderButton = useCallback(() => {
    if (!window.google || !containerRef.current || !clientId) return;

    // Clear previous render
    containerRef.current.innerHTML = '';
    initializedRef.current = false;

    window.google.accounts.id.initialize({
      client_id:   clientId,
      callback:    (res) => onCredential(res.credential),
      auto_select: false,
    });

    const width = Math.min(containerRef.current.getBoundingClientRect().width || 340, 400);

    window.google.accounts.id.renderButton(containerRef.current, {
      type:           'standard',
      theme:          'outline',
      size:           'large',
      text,
      width,
      logo_alignment: 'left',
      shape:          'rectangular',
    });

    initializedRef.current = true;
  }, [clientId, onCredential, text]);

  useEffect(() => {
    if (!clientId) return;

    // Script already loaded
    if (window.google) {
      renderButton();
      return;
    }

    // Avoid duplicate script tags
    if (document.getElementById(GSI_SCRIPT_ID)) {
      // Script tag exists but not yet executed — wait for it
      const existing = document.getElementById(GSI_SCRIPT_ID) as HTMLScriptElement;
      existing.addEventListener('load', renderButton, { once: true });
      return;
    }

    // Load GIS script
    const script = document.createElement('script');
    script.id    = GSI_SCRIPT_ID;
    script.src   = GSI_SCRIPT_URL;
    script.async = true;
    script.defer = true;
    script.addEventListener('load', renderButton, { once: true });
    document.head.appendChild(script);
  }, [clientId, renderButton]);

  if (!clientId) return null;

  return (
    <div style={{ width: '100%', position: 'relative' }}>
      {/* Google renders its iframe-based button here */}
      <div
        ref={containerRef}
        style={{
          width: '100%',
          minHeight: '44px',
          display: 'flex',
          justifyContent: 'center',
          opacity: loading ? 0.5 : 1,
          pointerEvents: loading ? 'none' : 'auto',
          transition: 'opacity 0.15s',
        }}
      />
      {/* Loading overlay */}
      {loading && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'rgba(255,255,255,0.6)',
            borderRadius: 4,
          }}
        >
          <span
            style={{
              fontSize: 11,
              color: 'var(--text-dim)',
              fontFamily: 'var(--font-mono)',
            }}
          >
            Verifying…
          </span>
        </div>
      )}
    </div>
  );
}
