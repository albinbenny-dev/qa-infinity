import React, { useState } from 'react';
import { Lock, Edit3, Save, X } from 'lucide-react';
import type { LoginInstructions as LoginInstructionsType } from '../../types';

const LABEL_STYLE: React.CSSProperties = {
  display: 'block',
  fontFamily: 'var(--font-mono)',
  fontSize: '10px',
  fontWeight: 700,
  letterSpacing: '1.2px',
  textTransform: 'uppercase',
  color: 'var(--text-mid)',
  marginBottom: '4px',
};

interface LoginInstructionsProps {
  instructions: LoginInstructionsType | null;
  onSave: (updated: LoginInstructionsType) => void;
  isSaving: boolean;
  scanDate?: string;
  envConfigName?: string;
}

export default function LoginInstructions({
  instructions,
  onSave,
  isSaving,
  scanDate,
  envConfigName,
}: LoginInstructionsProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<LoginInstructionsType | null>(null);

  function startEdit() {
    if (!instructions) return;
    setDraft(JSON.parse(JSON.stringify(instructions)) as LoginInstructionsType);
    setEditing(true);
  }

  function cancelEdit() {
    setEditing(false);
    setDraft(null);
  }

  function handleSave() {
    if (!draft) return;
    onSave(draft);
    setEditing(false);
    setDraft(null);
  }

  function updateStep(index: number, field: 'description' | 'selector', value: string) {
    if (!draft) return;
    const updated = { ...draft, steps: [...draft.steps] };
    updated.steps[index] = { ...updated.steps[index], [field]: value };
    setDraft(updated);
  }

  const data = editing ? draft : instructions;

  if (!data) {
    return (
      <div
        className="card"
        style={{ borderTop: '4px solid var(--warm-accent)', overflow: 'hidden' }}
      >
        <div
          style={{
            height: '4px',
            background: 'var(--warm-accent)',
            position: 'absolute',
            top: 0, left: 0, right: 0,
          }}
        />
        <div className="card-header">
          <div className="card-title">
            <Lock size={14} color="var(--6d-orange)" />
            Login Instructions
          </div>
        </div>
        <div
          className="card-body"
          style={{
            textAlign: 'center', padding: '32px 20px',
            color: 'var(--text-dim)', fontFamily: 'var(--font-mono)', fontSize: '12px',
          }}
        >
          No login instructions yet — run a UI scan to discover the login flow automatically.
        </div>
      </div>
    );
  }

  return (
    <div
      className="card"
      style={{ position: 'relative', overflow: 'visible' }}
    >
      {/* Warm accent stripe */}
      <div
        style={{
          position: 'absolute', top: 0, left: 0, right: 0, height: '4px',
          background: 'linear-gradient(90deg, #FFB347, #F47B20)',
          borderRadius: 'var(--radius-lg) var(--radius-lg) 0 0',
        }}
      />

      <div className="card-header" style={{ paddingTop: '18px' }}>
        <div className="card-title">
          <Lock size={14} color="var(--6d-orange)" />
          Login Instructions
          <span
            style={{
              marginLeft: '4px',
              padding: '2px 7px', borderRadius: '4px', fontSize: '10px', fontWeight: 700,
              background: 'var(--emerald-dim)', color: 'var(--emerald)',
            }}
          >
            ✓ Verified
          </span>
        </div>
        <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
          {editing ? (
            <>
              <button
                type="button"
                onClick={cancelEdit}
                style={{
                  padding: '4px 10px', fontSize: '11px', cursor: 'pointer',
                  border: '1px solid var(--border)', borderRadius: '6px',
                  background: 'transparent', color: 'var(--text-mid)',
                }}
              >
                <X size={11} style={{ display: 'inline', marginRight: '4px' }} />
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSave}
                disabled={isSaving}
                style={{
                  padding: '4px 12px', fontSize: '11px', fontWeight: 600, cursor: 'pointer',
                  border: 'none', borderRadius: '6px',
                  background: 'linear-gradient(135deg, #F47B20, #D9601A)',
                  color: '#fff', opacity: isSaving ? 0.6 : 1,
                }}
              >
                <Save size={11} style={{ display: 'inline', marginRight: '4px' }} />
                {isSaving ? 'Saving…' : 'Save'}
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={startEdit}
              style={{
                padding: '4px 10px', fontSize: '11px', cursor: 'pointer',
                border: '1px solid var(--border)', borderRadius: '6px',
                background: 'transparent', color: 'var(--text-mid)',
              }}
            >
              <Edit3 size={11} style={{ display: 'inline', marginRight: '4px' }} />
              Edit
            </button>
          )}
        </div>
      </div>

      <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
        {/* Meta row */}
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
          <span
            style={{
              padding: '2px 8px', borderRadius: '4px', fontSize: '11px', fontWeight: 600,
              background: 'var(--cyan-dim)', color: 'var(--cyan)',
            }}
          >
            {data.loginType === 'two-step' ? 'Two-step form' : data.loginType === 'sso' ? 'SSO' : 'Standard form'}
          </span>
          {scanDate && (
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: '10px', color: 'var(--text-dim)' }}>
              Scanned {scanDate}
            </span>
          )}
        </div>

        {/* Steps list */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {(Array.isArray(data.steps) ? data.steps : []).map((step, i) => (
            <div key={i} style={{ display: 'flex', gap: '10px', alignItems: 'flex-start' }}>
              {/* Step number circle */}
              <div
                style={{
                  flexShrink: 0,
                  width: '22px', height: '22px', borderRadius: '50%',
                  background: 'var(--6d-navy)',
                  color: '#fff', fontSize: '10px', fontWeight: 700,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}
              >
                {step.order}
              </div>
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '4px' }}>
                {editing ? (
                  <input
                    style={{
                      padding: '4px 8px', fontSize: '12px', fontFamily: 'var(--font-ui)',
                      border: '1px solid var(--border)', borderRadius: '4px',
                      background: 'var(--surface2)', color: 'var(--text)',
                    }}
                    value={step.description}
                    onChange={(e) => updateStep(i, 'description', e.target.value)}
                  />
                ) : (
                  <span style={{ fontSize: '12px', color: 'var(--text)' }}>{step.description}</span>
                )}
                {(step.selector || editing) && (
                  editing ? (
                    <input
                      style={{
                        padding: '2px 6px', fontSize: '11px', fontFamily: 'var(--font-mono)',
                        border: '1px solid var(--border)', borderRadius: '4px',
                        background: 'var(--surface2)', color: 'var(--cyan)',
                      }}
                      value={step.selector ?? ''}
                      placeholder="CSS selector (optional)"
                      onChange={(e) => updateStep(i, 'selector', e.target.value)}
                    />
                  ) : step.selector ? (
                    <span
                      style={{
                        display: 'inline-block',
                        padding: '2px 6px', borderRadius: '4px',
                        background: 'var(--cyan-dim)', color: 'var(--cyan)',
                        fontFamily: 'var(--font-mono)', fontSize: '11px',
                      }}
                    >
                      {step.selector}
                    </span>
                  ) : null
                )}
              </div>
            </div>
          ))}
        </div>

        {/* Post-login URL */}
        <div>
          <label style={LABEL_STYLE}>Post-login URL</label>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: '11px', color: 'var(--cyan)' }}>
            {data.postLoginUrl}
          </span>
        </div>

        {/* Notes */}
        {data.notes && (
          <div
            style={{
              padding: '8px 12px', background: 'var(--surface2)', borderRadius: 'var(--radius)',
              fontFamily: 'var(--font-mono)', fontSize: '11px', color: 'var(--text-mid)',
            }}
          >
            {data.notes}
          </div>
        )}

        {/* Credentials note */}
        <div
          style={{
            padding: '8px 12px', background: 'var(--violet-dim)',
            border: '1px solid rgba(244,123,32,0.15)',
            borderRadius: 'var(--radius)',
            fontSize: '11px', color: 'var(--text-mid)',
          }}
        >
          Credentials source:{' '}
          {envConfigName ? (
            <strong style={{ color: 'var(--text)' }}>EnvConfig "{envConfigName}"</strong>
          ) : (
            'EnvConfig'
          )}{' '}
          (TC_USERNAME / TC_PASSWORD env vars)
        </div>
      </div>
    </div>
  );
}
