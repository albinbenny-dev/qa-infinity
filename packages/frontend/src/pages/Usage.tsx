import { useState, useEffect, useMemo } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, Cell,
} from 'recharts';
import Topbar from '../components/layout/Topbar';
import { useOpenRouterUsage, useAgentUsage, useAgentConfig, useToggleAgent, useStandardMode, useUpdateAgentSettings, useUsageTrend } from '../hooks/useUsage';
import type { AgentUsageRow, AgentConfigRow } from '../hooks/useUsage';

// ── Helpers ────────────────────────────────────────────────────────────────

function fmt(dollars: number): string {
  return `$${dollars.toFixed(4)}`;
}

function fmtK(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

function fmtMs(ms: number): string {
  if (ms >= 60_000) return `${(ms / 60_000).toFixed(1)}m`;
  if (ms >= 1_000) return `${(ms / 1_000).toFixed(1)}s`;
  return `${ms}ms`;
}

function timeAgo(iso: string | null): string {
  if (!iso) return '—';
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 60_000) return 'just now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}

const AGENT_LABEL: Record<string, string> = {
  'script-agent': 'Script Agent',
  'healing-agent': 'Healing Agent',
  'writer-agent': 'Writer Agent',
  'chat-agent': 'Chat Agent',
  'reports-agent': 'Reports Agent',
  'ui-context-agent': 'UI Context Agent',
  'browser-agent': 'Browser Agent',
  'ui-scanner': 'UI Scanner',
};

// All agent names we always want visible in the usage table (in preferred display order).
const ALL_KNOWN_AGENTS = [
  'writer-agent',
  'healing-agent',
  'ui-context-agent',
  'browser-agent',
  'ui-scanner',
  'script-agent',
  'reports-agent',
  'chat-agent',
];

const AGENT_ICON: Record<string, string> = {
  'script-agent': '⌨',
  'healing-agent': '⟳',
  'writer-agent': '✍',
  'chat-agent': '💬',
  'reports-agent': '📊',
  'ui-context-agent': '🔍',
  'browser-agent': '🌐',
  'ui-scanner': '🖥',
};

const AGENT_COLOR: Record<string, string> = {
  'script-agent': 'var(--violet)',
  'healing-agent': 'var(--fail)',
  'writer-agent': 'var(--cyan)',
  'chat-agent': 'var(--emerald)',
  'reports-agent': 'var(--amber)',
  'ui-context-agent': 'var(--sky)',
  'browser-agent': 'var(--pass)',
  'ui-scanner': 'var(--violet)',
};

// ── Credit Gauge ───────────────────────────────────────────────────────────

function CreditGauge({ usage, limit, remaining }: { usage: number; limit: number | null; remaining: number | null }) {
  const usedPct = limit ? Math.min(100, Math.round((usage / limit) * 100)) : 0;
  const critical = limit ? usage / limit >= 0.85 : false;
  const warning = limit ? usage / limit >= 0.65 : false;
  const barColor = critical ? 'var(--fail)' : warning ? 'var(--amber)' : 'var(--pass)';

  return (
    <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 14, overflow: 'hidden', boxShadow: 'var(--shadow-card)' }}>
      <div style={{ height: 3, background: 'var(--warm-accent)' }} />
      <div style={{ padding: '20px 24px' }}>
        <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-dim)', marginBottom: 16 }}>
          Credit Usage
        </div>
        {limit !== null ? (
          <>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 12 }}>
              <div>
                <div style={{ fontSize: 34, fontWeight: 800, color: barColor, lineHeight: 1, fontFamily: 'var(--font-mono)' }}>
                  {remaining !== null ? fmt(remaining) : '—'}
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 4 }}>remaining</div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)', fontFamily: 'var(--font-mono)' }}>{fmt(usage)} used</div>
                <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 2 }}>of {fmt(limit)} prepaid</div>
              </div>
            </div>
            <div style={{ background: 'var(--surface3)', borderRadius: 8, height: 10, overflow: 'hidden', marginBottom: 8 }}>
              <div style={{ height: '100%', width: `${usedPct}%`, background: barColor, borderRadius: 8, transition: 'width 0.4s', boxShadow: `0 0 8px ${barColor}66` }} />
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: 'var(--text-dim)', fontFamily: 'var(--font-mono)' }}>
              <span>$0</span>
              <span style={{ color: critical ? 'var(--fail)' : warning ? 'var(--amber)' : 'var(--text-dim)' }}>{usedPct}% used</span>
              <span>{fmt(limit)}</span>
            </div>
            {critical && (
              <div style={{ marginTop: 12, padding: '10px 14px', background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.3)', borderRadius: 8, fontSize: 12, color: 'var(--fail)', fontWeight: 600 }}>
                ⚠ Less than 15% credits remaining — consider topping up your OpenRouter balance.
              </div>
            )}
          </>
        ) : (
          <div style={{ textAlign: 'center', padding: '16px 0' }}>
            <div style={{ fontSize: 28, fontWeight: 800, color: '#F47B20', fontFamily: 'var(--font-mono)', marginBottom: 6 }}>{fmt(usage)}</div>
            <div style={{ fontSize: 12, color: 'var(--text-dim)' }}>total used (no credit cap set)</div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Agent breakdown table ──────────────────────────────────────────────────

function AgentTable({ agents, totalTokens }: { agents: AgentUsageRow[]; totalTokens: number }) {
  return (
    <div style={{ overflow: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
        <thead>
          <tr>
            {['Agent', 'Calls', 'Prompt Tokens', 'Completion Tokens', 'Total Tokens', 'Share', 'Avg Duration', 'Last Used'].map((h) => (
              <th key={h} style={{
                padding: '8px 14px',
                textAlign: h === 'Agent' ? 'left' : 'right',
                fontSize: 10, fontWeight: 700,
                textTransform: 'uppercase', letterSpacing: '0.06em',
                color: 'var(--text-dim)',
                borderBottom: '1px solid var(--border)',
                whiteSpace: 'nowrap',
                background: 'var(--surface)',
                position: 'sticky', top: 0,
              }}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {agents.map((a, i) => {
            const sharePct = totalTokens > 0 ? Math.round((a.totalTokens / totalTokens) * 100) : 0;
            const color = AGENT_COLOR[a.agentName] ?? 'var(--text-dim)';
            return (
              <tr key={a.agentName} style={{ borderBottom: '1px solid var(--border)', background: i % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.01)' }}>
                <td style={{ padding: '10px 14px', whiteSpace: 'nowrap' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontSize: 14 }}>{AGENT_ICON[a.agentName] ?? '?'}</span>
                    <span style={{ fontWeight: 600, color: 'var(--text)' }}>
                      {AGENT_LABEL[a.agentName] ?? a.agentName}
                    </span>
                  </div>
                </td>
                <td style={{ padding: '10px 14px', textAlign: 'right', fontFamily: 'var(--font-mono)', color: 'var(--text)' }}>
                  {a.calls.toLocaleString()}
                </td>
                <td style={{ padding: '10px 14px', textAlign: 'right', fontFamily: 'var(--font-mono)', color: 'var(--text-mid)' }}>
                  {fmtK(a.promptTokens)}
                </td>
                <td style={{ padding: '10px 14px', textAlign: 'right', fontFamily: 'var(--font-mono)', color: 'var(--text-mid)' }}>
                  {fmtK(a.completionTokens)}
                </td>
                <td style={{ padding: '10px 14px', textAlign: 'right', fontFamily: 'var(--font-mono)', fontWeight: 700, color }}>
                  {fmtK(a.totalTokens)}
                </td>
                <td style={{ padding: '10px 14px', textAlign: 'right' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'flex-end' }}>
                    <div style={{ width: 60, background: 'var(--surface3)', borderRadius: 4, height: 6, overflow: 'hidden' }}>
                      <div style={{ height: '100%', width: `${sharePct}%`, background: color, borderRadius: 4 }} />
                    </div>
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-dim)', minWidth: 28, textAlign: 'right' }}>
                      {sharePct}%
                    </span>
                  </div>
                </td>
                <td style={{ padding: '10px 14px', textAlign: 'right', fontFamily: 'var(--font-mono)', color: 'var(--text-dim)', fontSize: 11 }}>
                  {fmtMs(a.avgDurationMs)}
                </td>
                <td style={{ padding: '10px 14px', textAlign: 'right', fontFamily: 'var(--font-mono)', color: 'var(--text-dim)', fontSize: 11, whiteSpace: 'nowrap' }}>
                  {timeAgo(a.lastUsed)}
                </td>
              </tr>
            );
          })}
        </tbody>
        <tfoot>
          <tr style={{ borderTop: '2px solid var(--border)' }}>
            <td style={{ padding: '8px 14px', fontWeight: 700, color: 'var(--text)', fontSize: 11 }}>Total</td>
            <td style={{ padding: '8px 14px', textAlign: 'right', fontFamily: 'var(--font-mono)', fontWeight: 700, color: 'var(--text)' }}>
              {agents.reduce((s, a) => s + a.calls, 0).toLocaleString()}
            </td>
            <td style={{ padding: '8px 14px', textAlign: 'right', fontFamily: 'var(--font-mono)', fontWeight: 700, color: 'var(--text)' }}>
              {fmtK(agents.reduce((s, a) => s + a.promptTokens, 0))}
            </td>
            <td style={{ padding: '8px 14px', textAlign: 'right', fontFamily: 'var(--font-mono)', fontWeight: 700, color: 'var(--text)' }}>
              {fmtK(agents.reduce((s, a) => s + a.completionTokens, 0))}
            </td>
            <td style={{ padding: '8px 14px', textAlign: 'right', fontFamily: 'var(--font-mono)', fontWeight: 700, color: '#F47B20' }}>
              {fmtK(totalTokens)}
            </td>
            <td colSpan={3} />
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

// ── Info tile ──────────────────────────────────────────────────────────────

function InfoTile({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent: string }) {
  return (
    <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, padding: '16px', position: 'relative', overflow: 'hidden', boxShadow: 'var(--shadow-card)', flex: 1 }}>
      <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 3, background: accent, borderRadius: '12px 12px 0 0' }} />
      <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-dim)', marginBottom: 8, marginTop: 4 }}>{label}</div>
      <div style={{ fontSize: 16, fontWeight: 800, color: 'var(--text)', fontFamily: 'var(--font-mono)', wordBreak: 'break-all' }}>{value}</div>
      {sub && <div style={{ fontSize: 10, color: 'var(--text-dim)', marginTop: 4 }}>{sub}</div>}
    </div>
  );
}

// ── Range tab ──────────────────────────────────────────────────────────────

function RangeTab({ days, active, onClick }: { days: number; active: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} style={{
      padding: '4px 12px', borderRadius: 6,
      border: active ? '1px solid rgba(37,99,171,0.4)' : '1px solid var(--border)',
      background: active ? 'rgba(37,99,171,0.15)' : 'transparent',
      color: active ? 'var(--cyan)' : 'var(--text-dim)',
      fontSize: 11, fontWeight: active ? 700 : 500, cursor: 'pointer',
    }}>
      {days}d
    </button>
  );
}

// ── Healing Agent threshold control ───────────────────────────────────────

function HealingAgentThreshold({ serverValue }: { serverValue: number }) {
  const [value, setValue] = useState(serverValue);
  const update = useUpdateAgentSettings();

  useEffect(() => setValue(serverValue), [serverValue]);

  function commit(v: number) {
    const clamped = Math.min(100, Math.max(0, v));
    setValue(clamped);
    if (clamped !== serverValue) {
      update.mutate({ agentName: 'healing-agent', settings: { selectorTraceThreshold: clamped } });
    }
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <span style={{ fontSize: 10, color: 'var(--text-dim)', flex: 1, lineHeight: 1.4 }}>
        Selector trace threshold
        <span style={{ display: 'block', fontSize: 9, color: 'var(--text-dim)', opacity: 0.7, marginTop: 1 }}>
          SELECTOR heals below this confidence trigger a live browser trace
        </span>
      </span>
      <input
        type="number"
        min={0}
        max={100}
        step={5}
        value={value}
        onChange={(e) => setValue(Number(e.target.value))}
        onBlur={(e) => commit(Number(e.target.value))}
        onKeyDown={(e) => e.key === 'Enter' && commit(value)}
        style={{
          width: 46, padding: '3px 6px',
          borderRadius: 5,
          border: '1px solid var(--border)',
          background: 'var(--surface3)',
          color: 'var(--text)',
          fontSize: 11, fontFamily: 'var(--font-mono)',
          textAlign: 'right',
          outline: 'none',
        }}
      />
      <span style={{ fontSize: 10, color: 'var(--text-dim)', flexShrink: 0 }}>%</span>
      {update.isPending && (
        <span style={{ fontSize: 9, color: 'var(--text-dim)', flexShrink: 0 }}>saving…</span>
      )}
    </div>
  );
}

// ── Agent Config Panel ─────────────────────────────────────────────────────

// Agents disabled in Standard Mode (writer-agent stays ON — seed TCs still work)
const STANDARD_MODE_AGENTS = ['healing-agent', 'ui-context-agent', 'ui-scanner', 'browser-agent', 'reports-agent'];

function AgentConfigPanel() {
  const { data: agents, isLoading } = useAgentConfig();
  const toggle = useToggleAgent();
  const standardMode = useStandardMode();

  const isStandardMode = agents
    ? STANDARD_MODE_AGENTS.every((a) => {
        const row = agents.find((r) => r.agentName === a);
        return row ? !row.enabled : false;
      })
    : false;

  const allEnabled = agents ? agents.every((r) => r.enabled) : false;

  function handleToggle(row: AgentConfigRow) {
    toggle.mutate({ agentName: row.agentName, enabled: !row.enabled });
  }

  return (
    <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden', boxShadow: 'var(--shadow-card)' }}>
      <div style={{ height: 3, background: 'linear-gradient(90deg, var(--amber), var(--fail))' }} />
      <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text)' }}>Agent Configuration</span>
          <span style={{ marginLeft: 10, fontSize: 11, color: 'var(--text-dim)' }}>Enable or disable individual AI agents to control token consumption</span>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            onClick={() => standardMode.mutate(true)}
            disabled={standardMode.isPending || isStandardMode}
            style={{
              padding: '5px 14px', borderRadius: 6, fontSize: 11, fontWeight: 700, cursor: isStandardMode ? 'default' : 'pointer',
              border: '1px solid rgba(245,158,11,0.4)',
              background: isStandardMode ? 'rgba(245,158,11,0.2)' : 'rgba(245,158,11,0.1)',
              color: 'var(--amber)', opacity: standardMode.isPending ? 0.6 : 1,
            }}
          >
            {isStandardMode ? '⚡ Standard Mode active' : '⚡ Standard Mode'}
          </button>
          <button
            onClick={() => standardMode.mutate(false)}
            disabled={standardMode.isPending || allEnabled}
            style={{
              padding: '5px 14px', borderRadius: 6, fontSize: 11, fontWeight: 700, cursor: allEnabled ? 'default' : 'pointer',
              border: '1px solid rgba(34,211,238,0.3)',
              background: 'rgba(34,211,238,0.08)',
              color: 'var(--cyan)', opacity: (standardMode.isPending || allEnabled) ? 0.5 : 1,
            }}
          >
            ✦ Full Mode
          </button>
        </div>
      </div>

      {isLoading ? (
        <div style={{ padding: '32px', textAlign: 'center', color: 'var(--text-dim)', fontSize: 12 }}>Loading…</div>
      ) : (
        <div>
          <div style={{ padding: '12px 16px', display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 8 }}>
            {(agents ?? []).map((row) => {
              const color = AGENT_COLOR[row.agentName] ?? 'var(--text-dim)';
              const icon = AGENT_ICON[row.agentName] ?? '?';
              const isLiteModeAgent = STANDARD_MODE_AGENTS.includes(row.agentName);
              return (
                <div
                  key={row.agentName}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 10,
                    padding: '8px 12px',
                    border: '1px solid var(--border)',
                    borderRadius: 8,
                    background: 'var(--surface2, rgba(255,255,255,0.02))',
                    opacity: row.enabled ? 1 : 0.55,
                    transition: 'opacity 0.2s',
                  }}
                >
                  <span style={{ fontSize: 15, width: 18, textAlign: 'center', flexShrink: 0 }}>{icon}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ fontSize: 11, fontWeight: 700, color: row.enabled ? color : 'var(--text-dim)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {row.label}
                      </span>
                      {isLiteModeAgent && (
                        <span style={{ fontSize: 8, fontWeight: 700, padding: '1px 4px', borderRadius: 3, background: 'rgba(245,158,11,0.15)', color: 'var(--amber)', border: '1px solid rgba(245,158,11,0.3)', whiteSpace: 'nowrap', flexShrink: 0 }}>
                          STD
                        </span>
                      )}
                    </div>
                    <div style={{ fontSize: 10, color: 'var(--text-dim)', marginTop: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {row.description}
                    </div>
                  </div>
                  <button
                    onClick={() => handleToggle(row)}
                    disabled={toggle.isPending}
                    style={{
                      position: 'relative', width: 36, height: 20, borderRadius: 10,
                      background: row.enabled ? color : 'var(--surface3)',
                      border: 'none', cursor: 'pointer', transition: 'background 0.2s',
                      flexShrink: 0,
                      boxShadow: row.enabled ? `0 0 6px ${color}66` : 'none',
                    }}
                    title={row.enabled ? 'Click to disable' : 'Click to enable'}
                  >
                    <span style={{
                      position: 'absolute', top: 2, left: row.enabled ? 18 : 2,
                      width: 16, height: 16, borderRadius: '50%',
                      background: 'white', transition: 'left 0.2s',
                      boxShadow: '0 1px 3px rgba(0,0,0,0.3)',
                    }} />
                  </button>
                  <span style={{ fontSize: 9, fontWeight: 700, color: row.enabled ? 'var(--pass)' : 'var(--text-dim)', minWidth: 22, textAlign: 'right', flexShrink: 0 }}>
                    {row.enabled ? 'ON' : 'OFF'}
                  </span>
                </div>
              );
            })}
          </div>
          {/* Healing Agent settings card */}
          {(() => {
            const healRow = (agents ?? []).find(r => r.agentName === 'healing-agent');
            if (!healRow) return null;
            const threshold = (healRow.settings?.selectorTraceThreshold as number | undefined) ?? 60;
            return (
              <div style={{ margin: '0 12px 8px', padding: '10px 14px', border: '1px solid var(--border)', borderRadius: 8, background: 'var(--surface2, rgba(255,255,255,0.02))' }}>
                <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.07em', color: 'var(--fail)', marginBottom: 8 }}>
                  Healing Agent Settings
                </div>
                <HealingAgentThreshold serverValue={threshold} />
              </div>
            );
          })()}
          <div style={{ padding: '8px 16px 12px', borderTop: '1px solid var(--border)', fontSize: 11, color: 'var(--text-dim)' }}>
            ⚡ <strong>Standard Mode</strong>: Writer Agent stays ON. Healing, UI Context, UI Scanner, Browser Agent, and Reports AI are OFF. Script and Chat Agents remain on in both modes.
            &nbsp;&nbsp;✦ <strong>Full Mode</strong>: All agents on — Jira stories, UI scans, agent scans, document uploads, healing, and AI reports all work.
          </div>
        </div>
      )}
    </div>
  );
}

// ── Daily Usage Chart ──────────────────────────────────────────────────────

function buildDayRange(days: number): string[] {
  const result: string[] = [];
  const now = new Date();
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(now.getTime() - i * 24 * 60 * 60 * 1000);
    result.push(d.toISOString().slice(0, 10));
  }
  return result;
}

function fmtTick(dateStr: string, days: number): string {
  const d = new Date(dateStr + 'T12:00:00');
  if (days <= 7) return d.toLocaleDateString('en', { weekday: 'short' });
  if (days <= 30) return d.toLocaleDateString('en', { month: 'short', day: 'numeric' });
  return d.toLocaleDateString('en', { month: 'short', day: 'numeric' });
}

function CustomTooltip({ active, payload, label }: { active?: boolean; payload?: Array<{ value: number }>; label?: string }) {
  if (!active || !payload?.length) return null;
  const tokens = payload[0].value;
  const d = new Date((label ?? '') + 'T12:00:00');
  const niceDateStr = d.toLocaleDateString('en', { weekday: 'long', month: 'long', day: 'numeric' });
  return (
    <div style={{
      background: 'var(--surface)',
      border: '1px solid var(--border)',
      borderRadius: 8,
      padding: '10px 14px',
      boxShadow: 'var(--shadow-card)',
      fontSize: 12,
    }}>
      <div style={{ color: 'var(--text-dim)', marginBottom: 4 }}>{niceDateStr}</div>
      <div style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, color: '#F47B20', fontSize: 15 }}>
        {fmtK(tokens)} tokens
      </div>
    </div>
  );
}

function DailyUsageChart({ days }: { days: number }) {
  const { data: trend, isLoading } = useUsageTrend(days);

  const chartData = useMemo(() => {
    const dayRange = buildDayRange(days);
    const dataMap = new Map((trend ?? []).map((t) => [t.date, t.tokens]));
    return dayRange.map((date) => ({ date, tokens: dataMap.get(date) ?? 0 }));
  }, [trend, days]);

  const maxTokens = useMemo(() => Math.max(...chartData.map((d) => d.tokens), 1), [chartData]);
  const todayStr = new Date().toISOString().slice(0, 10);

  // Show every Nth tick to avoid crowding
  const tickInterval = days <= 7 ? 0 : days <= 30 ? 3 : 7;

  return (
    <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden', boxShadow: 'var(--shadow-card)' }}>
      <div style={{ height: 3, background: 'linear-gradient(90deg, #F47B20, var(--amber))' }} />
      <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text)' }}>Daily Token Usage</span>
        <span style={{ fontSize: 11, color: 'var(--text-dim)', fontFamily: 'var(--font-mono)' }}>
          last {days} days · {fmtK(chartData.reduce((s, d) => s + d.tokens, 0))} total tokens
        </span>
      </div>
      <div style={{ padding: '16px 8px 8px' }}>
        {isLoading ? (
          <div style={{ height: 180, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-dim)', fontSize: 12 }}>
            Loading…
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={180}>
            <BarChart data={chartData} margin={{ top: 4, right: 16, left: 0, bottom: 0 }} barCategoryGap="20%">
              <CartesianGrid vertical={false} stroke="var(--border)" strokeOpacity={0.5} />
              <XAxis
                dataKey="date"
                tickLine={false}
                axisLine={false}
                tick={{ fontSize: 10, fill: 'var(--text-dim)', fontFamily: 'var(--font-mono)' }}
                interval={tickInterval}
                tickFormatter={(v) => fmtTick(v as string, days)}
              />
              <YAxis
                tickLine={false}
                axisLine={false}
                tick={{ fontSize: 10, fill: 'var(--text-dim)', fontFamily: 'var(--font-mono)' }}
                tickFormatter={(v) => fmtK(v as number)}
                width={40}
              />
              <Tooltip content={<CustomTooltip />} cursor={{ fill: 'rgba(255,255,255,0.04)' }} />
              <Bar dataKey="tokens" radius={[3, 3, 0, 0]} maxBarSize={32}>
                {chartData.map((entry) => (
                  <Cell
                    key={entry.date}
                    fill={entry.tokens === 0
                      ? 'var(--surface3)'
                      : entry.tokens === maxTokens
                      ? '#F47B20'
                      : entry.date === todayStr
                      ? 'var(--amber)'
                      : 'rgba(244,123,32,0.55)'}
                  />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>
      <div style={{ padding: '4px 16px 10px', display: 'flex', gap: 16, fontSize: 10, color: 'var(--text-dim)' }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          <span style={{ width: 10, height: 10, borderRadius: 2, background: '#F47B20', display: 'inline-block' }} />
          Peak day
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          <span style={{ width: 10, height: 10, borderRadius: 2, background: 'var(--amber)', display: 'inline-block' }} />
          Today
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          <span style={{ width: 10, height: 10, borderRadius: 2, background: 'rgba(244,123,32,0.55)', display: 'inline-block' }} />
          Active days
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          <span style={{ width: 10, height: 10, borderRadius: 2, background: 'var(--surface3)', display: 'inline-block' }} />
          No activity
        </span>
      </div>
    </div>
  );
}

// ── Main page ──────────────────────────────────────────────────────────────

export default function Usage() {
  const [days, setDays] = useState(30);
  const qc = useQueryClient();

  const { data: orData, isLoading: orLoading, isError: orError, dataUpdatedAt, isFetching } = useOpenRouterUsage();
  const { data: agentData, isLoading: agentLoading } = useAgentUsage(days);

  // Always show every known agent — pad missing ones with zeroes so the table is never sparse.
  const allAgents = useMemo(() => {
    const apiAgents = agentData?.agents ?? [];
    const apiMap = new Map(apiAgents.map((a) => [a.agentName, a]));
    const ordered = ALL_KNOWN_AGENTS.map((name) =>
      apiMap.get(name) ?? {
        agentName: name,
        calls: 0,
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
        avgDurationMs: 0,
        lastUsed: null,
      }
    );
    // Append any agents returned by the API that aren't in our known list (exclude legacy 'unknown' entries)
    const extra = apiAgents.filter((a) => !ALL_KNOWN_AGENTS.includes(a.agentName) && a.agentName !== 'unknown');
    return [...ordered, ...extra];
  }, [agentData]);

  function handleRefresh() {
    void qc.invalidateQueries({ queryKey: ['openrouter-usage'] });
    void qc.invalidateQueries({ queryKey: ['agent-usage', days] });
    void qc.invalidateQueries({ queryKey: ['usage-trend', days] });
  }

  const lastUpdated = dataUpdatedAt
    ? new Date(dataUpdatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
    : null;

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <Topbar
        breadcrumbs={[{ label: 'Platform' }, { label: '💳 AI Usage' }]}
        actions={
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            {lastUpdated && (
              <span style={{ fontSize: 10, color: 'var(--text-dim)', fontFamily: 'var(--font-mono)' }}>
                Updated {lastUpdated}
              </span>
            )}
            <button
              onClick={handleRefresh}
              disabled={isFetching}
              style={{
                padding: '6px 16px', borderRadius: 7,
                border: '1px solid rgba(164,123,250,0.3)',
                background: 'rgba(164,123,250,0.1)',
                color: 'var(--violet)', fontSize: 12, fontWeight: 700,
                cursor: isFetching ? 'not-allowed' : 'pointer',
                opacity: isFetching ? 0.6 : 1,
              }}
            >
              {isFetching ? '↻ Refreshing…' : '↻ Refresh'}
            </button>
          </div>
        }
      />

      {/* Scroll container — plain block so children grow to natural height instead of flex-shrinking */}
      <div style={{ flex: 1, overflow: 'auto' }}>
      <div style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: 20 }}>

        {orError && (
          <div style={{ padding: '16px 20px', background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.3)', borderRadius: 12, color: 'var(--fail)', fontSize: 13 }}>
            Failed to fetch OpenRouter usage. Check that <code style={{ fontFamily: 'var(--font-mono)', fontSize: 11 }}>OPENROUTER_API_KEY</code> is set in the API container environment.
          </div>
        )}

        {/* ── Top row: all cards in one line ───────────────────────────── */}
        <div style={{ display: 'flex', gap: 12, alignItems: 'stretch' }}>
          {orLoading ? (
            <div style={{ flex: 1, padding: '40px', textAlign: 'center', color: 'var(--text-dim)', fontSize: 12 }}>Loading…</div>
          ) : orData ? (
            <div style={{ flex: 1 }}>
              <CreditGauge usage={orData.usage} limit={orData.limit} remaining={orData.remaining} />
            </div>
          ) : null}
          {orData && (
            <>
              <InfoTile label="Active Model" value={orData.model} sub="OPENROUTER_MODEL" accent="linear-gradient(90deg, var(--violet), var(--cyan))" />
              <InfoTile label="Provider" value={orData.provider.toUpperCase()} sub={orData.is_free_tier ? 'Free tier' : 'Prepaid credits'} accent="linear-gradient(90deg, var(--cyan), #2563AB)" />
              <InfoTile label="Rate Limit" value={`${orData.rate_limit.requests} req`} sub={`per ${orData.rate_limit.interval}`} accent="linear-gradient(90deg, var(--amber), var(--skip))" />
              <InfoTile
                label={`Agent Calls (${days}d)`}
                value={(agentData?.total.calls ?? 0).toLocaleString()}
                sub={`${fmtK(agentData?.total.tokens ?? 0)} tokens`}
                accent="linear-gradient(90deg, var(--pass), #1a7a6e)"
              />
            </>
          )}
        </div>

        {/* ── Agent breakdown ───────────────────────────────────────────── */}
        <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden', boxShadow: 'var(--shadow-card)' }}>
          <div style={{ height: 3, background: 'var(--cool-accent)' }} />
          <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text)' }}>
              Per-Agent Token Usage
            </span>
            <div style={{ display: 'flex', gap: 6 }}>
              {[7, 30, 90].map((d) => (
                <RangeTab key={d} days={d} active={days === d} onClick={() => setDays(d)} />
              ))}
            </div>
          </div>
          {agentLoading ? (
            <div style={{ padding: '40px', textAlign: 'center', color: 'var(--text-dim)', fontSize: 12 }}>Loading…</div>
          ) : (
            <AgentTable
              agents={allAgents}
              totalTokens={agentData?.total.tokens ?? 0}
            />
          )}
        </div>

        {/* ── Daily usage chart ────────────────────────────────────── */}
        <DailyUsageChart days={days} />

        {/* ── Agent config toggles ──────────────────────────────────── */}
        <AgentConfigPanel />

        <div style={{ fontSize: 11, color: 'var(--text-dim)', fontFamily: 'var(--font-mono)', textAlign: 'center' }}>
          Credit data: live from openrouter.ai · Token data: logged locally · auto-refreshes every 60s
        </div>
      </div>
      </div>
    </div>
  );
}
