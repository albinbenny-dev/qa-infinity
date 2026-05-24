import { useState, useMemo, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import { useQuery } from '@tanstack/react-query';
import Topbar, { TbBtn } from '../components/layout/Topbar';
import {
  useSchedules,
  useCreateSchedule,
  useUpdateSchedule,
  useDeleteSchedule,
  useRunNow,
  useRuns,
  useCreateRun,
} from '../hooks/useRuns';
import { useProjectStore } from '../stores/projectStore';
import type { Schedule, TestCase, EnvConfig } from '../types';
import { api } from '../lib/api';
import type { RunListItem } from '../hooks/useRuns';

// ── Frequency config ───────────────────────────────────────────────────────

type FreqMode = 'daily' | 'weekdays' | 'weekly' | 'monthly' | 'hourly' | 'custom';

interface FreqConfig {
  mode: FreqMode;
  hour12: number;
  minute: number;
  ampm: 'AM' | 'PM';
  weekday: number;
  monthDay: number;
  intervalHours: number;
  customCron: string;
}

const DEFAULT_FREQ: FreqConfig = {
  mode: 'daily',
  hour12: 9,
  minute: 0,
  ampm: 'AM',
  weekday: 1,
  monthDay: 1,
  intervalHours: 1,
  customCron: '0 9 * * *',
};

function to24h(h12: number, ampm: 'AM' | 'PM'): number {
  if (ampm === 'AM') return h12 === 12 ? 0 : h12;
  return h12 === 12 ? 12 : h12 + 12;
}

function to12h(h24: number): { hour12: number; ampm: 'AM' | 'PM' } {
  return {
    ampm: h24 >= 12 ? 'PM' : 'AM',
    hour12: h24 === 0 ? 12 : h24 > 12 ? h24 - 12 : h24,
  };
}

function ordinal(n: number): string {
  if (n >= 11 && n <= 13) return 'th';
  switch (n % 10) {
    case 1: return 'st';
    case 2: return 'nd';
    case 3: return 'rd';
    default: return 'th';
  }
}

function buildCron(f: FreqConfig): string {
  if (f.mode === 'custom') return f.customCron.trim();
  const h = to24h(f.hour12, f.ampm);
  const m = f.minute;
  switch (f.mode) {
    case 'hourly':   return f.intervalHours === 1 ? '0 * * * *' : `0 */${f.intervalHours} * * *`;
    case 'daily':    return `${m} ${h} * * *`;
    case 'weekdays': return `${m} ${h} * * 1-5`;
    case 'weekly':   return `${m} ${h} * * ${f.weekday}`;
    case 'monthly':  return `${m} ${h} ${f.monthDay} * *`;
  }
}

function freqToHuman(f: FreqConfig): string {
  if (f.mode === 'custom') return f.customCron || '—';
  const m = f.minute.toString().padStart(2, '0');
  const time = `${f.hour12}:${m} ${f.ampm}`;
  const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  switch (f.mode) {
    case 'hourly':   return f.intervalHours === 1 ? 'Every hour' : `Every ${f.intervalHours} hours`;
    case 'daily':    return `Every day at ${time}`;
    case 'weekdays': return `Every weekday (Mon–Fri) at ${time}`;
    case 'weekly':   return `Every ${DAYS[f.weekday]} at ${time}`;
    case 'monthly':  return `${f.monthDay}${ordinal(f.monthDay)} of every month at ${time}`;
  }
}

function parseCronToFreq(cron: string): FreqConfig {
  const t = cron.trim();
  const p = t.split(/\s+/);
  if (p.length !== 5) return { ...DEFAULT_FREQ, mode: 'custom', customCron: cron };
  const [min, hour, day, month, weekday] = p;
  if (hour === '*' && min === '0') return { ...DEFAULT_FREQ, mode: 'hourly', intervalHours: 1 };
  const ih = hour.match(/^\*\/(\d+)$/);
  if (ih && min === '0') return { ...DEFAULT_FREQ, mode: 'hourly', intervalHours: parseInt(ih[1]) };
  const mn = parseInt(min, 10);
  const hn = parseInt(hour, 10);
  if (!isNaN(mn) && !isNaN(hn)) {
    const { hour12, ampm } = to12h(hn);
    const base = { ...DEFAULT_FREQ, hour12, minute: mn, ampm };
    if (weekday === '1-5' && day === '*' && month === '*') return { ...base, mode: 'weekdays' };
    if (weekday === '*' && day === '*' && month === '*') return { ...base, mode: 'daily' };
    if (/^\d$/.test(weekday) && day === '*' && month === '*') return { ...base, mode: 'weekly', weekday: parseInt(weekday) };
    if (/^\d+$/.test(day) && month === '*' && weekday === '*') return { ...base, mode: 'monthly', monthDay: parseInt(day) };
  }
  return { ...DEFAULT_FREQ, mode: 'custom', customCron: cron };
}

// ── Stat tile ──────────────────────────────────────────────────────────────

function StatTile({ label, value, color, accent, suffix = '' }: {
  label: string; value: number; color: string; accent: string; suffix?: string;
}) {
  return (
    <div style={{
      background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10,
      padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 3,
      position: 'relative', overflow: 'hidden', boxShadow: 'var(--shadow-card)', flex: 1,
    }}>
      <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 3, background: accent, borderRadius: '10px 10px 0 0' }} />
      <div style={{ fontSize: 28, fontWeight: 800, color, lineHeight: 1, marginTop: 4 }}>{value}{suffix}</div>
      <div style={{ fontSize: 10, color: 'var(--text-dim)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.07em', marginTop: 3 }}>{label}</div>
    </div>
  );
}

// ── Active run progress card ───────────────────────────────────────────────

function ActiveRunCard({ run }: { run: RunListItem }) {
  const passed = run.results.filter(r => r.status === 'PASSED').length;
  const failed = run.results.filter(r => r.status === 'FAILED').length;
  const total = run._count.results;
  const progress = total > 0 ? Math.round(((passed + failed) / total) * 100) : 0;
  return (
    <div style={{
      background: 'var(--surface2)',
      border: `1px solid ${run.status === 'RUNNING' ? 'rgba(37,99,171,0.35)' : 'rgba(255,179,71,0.3)'}`,
      borderRadius: 10, padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 8,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <div style={{ flex: 1, overflow: 'hidden' }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{run.name}</div>
          <div style={{ fontSize: 10, color: 'var(--text-dim)', marginTop: 2 }}>{run.environment} · {total} test{total !== 1 ? 's' : ''}</div>
        </div>
        <span style={{
          fontSize: 9, fontWeight: 700, textTransform: 'uppercase', padding: '2px 8px', borderRadius: 100,
          background: run.status === 'RUNNING' ? 'rgba(37,99,171,0.15)' : 'rgba(255,179,71,0.15)',
          color: run.status === 'RUNNING' ? 'var(--cyan)' : 'var(--skip)',
        }}>{run.status}</span>
      </div>
      {total > 0 && (
        <div>
          <div style={{ height: 5, borderRadius: 3, background: 'var(--border)', overflow: 'hidden' }}>
            <div style={{ height: '100%', width: `${progress}%`, background: failed > 0 ? 'linear-gradient(90deg,#2A9D8F,#DC2626)' : '#2A9D8F', borderRadius: 3, transition: 'width 0.4s ease' }} />
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4, fontSize: 10, color: 'var(--text-dim)' }}>
            <span>{passed + failed} / {total} done</span>
            <span>
              {passed > 0 && <span style={{ color: 'var(--pass)', marginRight: 6 }}>✓ {passed}</span>}
              {failed > 0 && <span style={{ color: 'var(--fail)' }}>✗ {failed}</span>}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Time picker ────────────────────────────────────────────────────────────

function TimePicker({ value, onChange }: { value: FreqConfig; onChange: (p: Partial<FreqConfig>) => void }) {
  const sel: React.CSSProperties = {
    padding: '6px 8px', background: 'var(--bg)', border: '1px solid var(--border)',
    borderRadius: 6, color: 'var(--text)', fontSize: 12, outline: 'none', cursor: 'pointer',
  };
  return (
    <>
      <select value={value.hour12} onChange={e => onChange({ hour12: parseInt(e.target.value) })} style={sel}>
        {[1,2,3,4,5,6,7,8,9,10,11,12].map(h => <option key={h} value={h}>{h}</option>)}
      </select>
      <span style={{ fontSize: 13, color: 'var(--text-dim)', fontWeight: 700 }}>:</span>
      <select value={value.minute} onChange={e => onChange({ minute: parseInt(e.target.value) })} style={sel}>
        {[0,15,30,45].map(m => <option key={m} value={m}>{m.toString().padStart(2,'0')}</option>)}
      </select>
      <select value={value.ampm} onChange={e => onChange({ ampm: e.target.value as 'AM' | 'PM' })} style={sel}>
        <option value="AM">AM</option>
        <option value="PM">PM</option>
      </select>
    </>
  );
}

// ── Frequency picker ───────────────────────────────────────────────────────

const FREQ_MODES: { id: FreqMode; label: string }[] = [
  { id: 'daily',    label: 'Daily' },
  { id: 'weekdays', label: 'Weekdays' },
  { id: 'weekly',   label: 'Weekly' },
  { id: 'monthly',  label: 'Monthly' },
  { id: 'hourly',   label: 'Hourly' },
  { id: 'custom',   label: 'Custom cron' },
];

const DAYS_OF_WEEK = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
const HOUR_INTERVALS = [1,2,3,4,6,8,12];

function FrequencyPicker({ value, onChange }: { value: FreqConfig; onChange: (v: FreqConfig) => void }) {
  const set = (p: Partial<FreqConfig>) => onChange({ ...value, ...p });
  const sel: React.CSSProperties = {
    padding: '6px 10px', background: 'var(--bg)', border: '1px solid var(--border)',
    borderRadius: 6, color: 'var(--text)', fontSize: 12, outline: 'none', cursor: 'pointer',
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {/* Mode tabs */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
        {FREQ_MODES.map(m => (
          <button key={m.id} type="button" onClick={() => set({ mode: m.id })} style={{
            padding: '5px 12px', borderRadius: 6, fontSize: 11, fontWeight: 600, cursor: 'pointer',
            background: value.mode === m.id ? 'rgba(34,211,238,0.12)' : 'var(--bg)',
            border: value.mode === m.id ? '1px solid var(--cyan)' : '1px solid var(--border)',
            color: value.mode === m.id ? 'var(--cyan)' : 'var(--text-mid)',
            transition: 'all 0.15s',
          }}>{m.label}</button>
        ))}
      </div>

      {/* Config row */}
      <div style={{
        display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 8,
        padding: '12px 14px', background: 'var(--bg)',
        border: '1px solid var(--border)', borderRadius: 8, minHeight: 46,
      }}>
        {value.mode === 'hourly' && (
          <>
            <span style={{ fontSize: 12, color: 'var(--text-mid)' }}>Every</span>
            <select value={value.intervalHours} onChange={e => set({ intervalHours: parseInt(e.target.value) })} style={sel}>
              {HOUR_INTERVALS.map(h => <option key={h} value={h}>{h}</option>)}
            </select>
            <span style={{ fontSize: 12, color: 'var(--text-mid)' }}>hour{value.intervalHours !== 1 ? 's' : ''}</span>
          </>
        )}

        {value.mode === 'daily' && (
          <>
            <span style={{ fontSize: 12, color: 'var(--text-mid)' }}>Every day at</span>
            <TimePicker value={value} onChange={set} />
          </>
        )}

        {value.mode === 'weekdays' && (
          <>
            <span style={{ fontSize: 12, color: 'var(--text-mid)' }}>Mon – Fri at</span>
            <TimePicker value={value} onChange={set} />
          </>
        )}

        {value.mode === 'weekly' && (
          <>
            <span style={{ fontSize: 12, color: 'var(--text-mid)' }}>Every</span>
            <select value={value.weekday} onChange={e => set({ weekday: parseInt(e.target.value) })} style={sel}>
              {DAYS_OF_WEEK.map((d, i) => <option key={i} value={i}>{d}</option>)}
            </select>
            <span style={{ fontSize: 12, color: 'var(--text-mid)' }}>at</span>
            <TimePicker value={value} onChange={set} />
          </>
        )}

        {value.mode === 'monthly' && (
          <>
            <span style={{ fontSize: 12, color: 'var(--text-mid)' }}>On the</span>
            <select value={value.monthDay} onChange={e => set({ monthDay: parseInt(e.target.value) })} style={sel}>
              {Array.from({ length: 31 }, (_, i) => i + 1).map(d => (
                <option key={d} value={d}>{d}{ordinal(d)}</option>
              ))}
            </select>
            <span style={{ fontSize: 12, color: 'var(--text-mid)' }}>at</span>
            <TimePicker value={value} onChange={set} />
          </>
        )}

        {value.mode === 'custom' && (
          <div style={{ flex: 1 }}>
            <div style={{ display: 'flex', gap: 6, marginBottom: 4 }}>
              {['MIN','HOUR','DAY','MONTH','WEEKDAY'].map((label, i) => {
                const parts = value.customCron.trim().split(/\s+/);
                return (
                  <div key={label} style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 2 }}>
                    <div style={{ fontSize: 8, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-dim)', textAlign: 'center' }}>{label}</div>
                    <input
                      value={parts[i] ?? '*'}
                      onChange={e => {
                        const arr = [...Array(5).fill('*').map((v, idx) => parts[idx] ?? v)];
                        arr[i] = e.target.value || '*';
                        set({ customCron: arr.join(' ') });
                      }}
                      style={{
                        width: '100%', padding: '5px 4px', textAlign: 'center', boxSizing: 'border-box',
                        background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 5,
                        color: 'var(--text)', fontSize: 12, fontFamily: 'var(--font-mono)', outline: 'none',
                      }}
                    />
                  </div>
                );
              })}
            </div>
            <div style={{ fontSize: 10, color: 'var(--text-dim)', textAlign: 'center' }}>
              Standard cron · <a href="https://crontab.guru" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--cyan)', textDecoration: 'none' }}>crontab.guru ↗</a>
            </div>
          </div>
        )}
      </div>

      {/* Human-readable preview */}
      <div style={{
        padding: '6px 12px', background: 'rgba(34,211,238,0.06)',
        border: '1px solid rgba(34,211,238,0.15)', borderRadius: 6,
        display: 'flex', alignItems: 'center', gap: 8, fontSize: 11,
      }}>
        <span>⏰</span>
        <span style={{ fontWeight: 600, color: 'var(--text-mid)' }}>{freqToHuman(value)}</span>
        <span style={{ color: 'var(--text-dim)', fontFamily: 'var(--font-mono)', fontSize: 10 }}>({buildCron(value)})</span>
      </div>
    </div>
  );
}

// ── Grouped TC selector ────────────────────────────────────────────────────

function GroupedTcSelector({ testCases, selected, onChange }: {
  testCases: TestCase[];
  selected: string[];
  onChange: (ids: string[]) => void;
}) {
  const [search, setSearch] = useState('');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const filtered = useMemo(
    () => search
      ? testCases.filter(tc =>
          tc.title.toLowerCase().includes(search.toLowerCase()) ||
          tc.tcId.toLowerCase().includes(search.toLowerCase()))
      : testCases,
    [testCases, search],
  );

  const groups = useMemo(() => {
    const map = new Map<string, TestCase[]>();
    for (const tc of filtered) {
      const k = tc.useCaseTag ?? 'Ungrouped';
      if (!map.has(k)) map.set(k, []);
      map.get(k)!.push(tc);
    }
    return Array.from(map.entries());
  }, [filtered]);

  useEffect(() => {
    if (search) setExpanded(new Set(groups.map(([g]) => g)));
  }, [search]); // eslint-disable-line react-hooks/exhaustive-deps

  function toggle(g: string) {
    setExpanded(prev => { const n = new Set(prev); n.has(g) ? n.delete(g) : n.add(g); return n; });
  }

  function toggleGroup(tcs: TestCase[]) {
    const ids = tcs.map(t => t.id);
    const all = ids.every(id => selected.includes(id));
    onChange(all ? selected.filter(id => !ids.includes(id)) : [...new Set([...selected, ...ids])]);
  }

  function toggleTc(id: string) {
    onChange(selected.includes(id) ? selected.filter(s => s !== id) : [...selected, id]);
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <label style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-dim)' }}>
          Test Cases
        </label>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 10, color: 'var(--text-dim)' }}>
          <span>{selected.length} / {testCases.length} selected</span>
          {testCases.length > 0 && (
            <button type="button"
              onClick={() => onChange(selected.length === testCases.length ? [] : testCases.map(t => t.id))}
              style={{ fontSize: 10, fontWeight: 600, color: 'var(--cyan)', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
              {selected.length === testCases.length ? 'Deselect all' : 'Select all'}
            </button>
          )}
        </div>
      </div>

      <input type="text" value={search} onChange={e => setSearch(e.target.value)}
        placeholder="Search test cases…"
        style={{ width: '100%', padding: '6px 10px', boxSizing: 'border-box', background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 6, color: 'var(--text)', fontSize: 12, outline: 'none', fontFamily: 'var(--font-ui)' }}
      />

      <div style={{ border: '1px solid var(--border)', borderRadius: 8, maxHeight: 240, overflowY: 'auto', background: 'var(--bg)' }}>
        {groups.length === 0 ? (
          <div style={{ padding: '16px', textAlign: 'center', color: 'var(--text-dim)', fontSize: 12 }}>
            {testCases.length === 0 ? 'No approved test cases.' : 'No matches.'}
          </div>
        ) : groups.map(([groupName, tcs]) => {
          const sel = tcs.filter(tc => selected.includes(tc.id)).length;
          const isOpen = expanded.has(groupName);
          const allSel = sel === tcs.length;
          const someSel = sel > 0 && sel < tcs.length;
          return (
            <div key={groupName}>
              {/* Group header row */}
              <div style={{
                display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px',
                background: 'var(--surface)', borderBottom: '1px solid var(--border)',
                userSelect: 'none',
              }}>
                <span onClick={() => toggle(groupName)}
                  style={{ fontSize: 9, color: 'var(--text-dim)', cursor: 'pointer', width: 12, flexShrink: 0 }}>
                  {isOpen ? '▼' : '▶'}
                </span>
                <input type="checkbox"
                  ref={el => { if (el) el.indeterminate = someSel; }}
                  checked={allSel}
                  onChange={() => toggleGroup(tcs)}
                  onClick={e => e.stopPropagation()}
                  style={{ accentColor: 'var(--cyan)', cursor: 'pointer', flexShrink: 0 }}
                />
                <span onClick={() => toggle(groupName)}
                  style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)', flex: 1, cursor: 'pointer' }}>
                  {groupName}
                </span>
                <span style={{
                  fontSize: 9, fontWeight: 700, padding: '2px 6px', borderRadius: 100,
                  background: sel > 0 ? 'rgba(34,211,238,0.12)' : 'rgba(100,116,139,0.1)',
                  color: sel > 0 ? 'var(--cyan)' : 'var(--text-dim)',
                }}>{sel}/{tcs.length}</span>
              </div>

              {/* TC rows */}
              {isOpen && tcs.map((tc, idx) => (
                <label key={tc.id} style={{
                  display: 'flex', alignItems: 'center', gap: 8, padding: '7px 10px 7px 30px',
                  cursor: 'pointer',
                  borderBottom: idx < tcs.length - 1 ? '1px solid var(--border)' : undefined,
                  background: selected.includes(tc.id) ? 'rgba(34,211,238,0.03)' : 'transparent',
                }}>
                  <input type="checkbox" checked={selected.includes(tc.id)} onChange={() => toggleTc(tc.id)}
                    style={{ accentColor: 'var(--cyan)', flexShrink: 0 }} />
                  <div style={{ flex: 1, overflow: 'hidden' }}>
                    <div style={{ fontSize: 11, fontWeight: 500, color: 'var(--text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{tc.title}</div>
                    <div style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--text-dim)', marginTop: 1 }}>{tc.tcId} · {tc.type}</div>
                  </div>
                </label>
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Quick Run Now panel ────────────────────────────────────────────────────

function RunNowPanel({ testCases, envConfigs, projectId, onClose }: {
  testCases: TestCase[];
  envConfigs: EnvConfig[];
  projectId: string;
  onClose: () => void;
}) {
  const defaultEnv = envConfigs.find(e => e.isDefault)?.name ?? envConfigs[0]?.name ?? 'Dev';
  const [selectedTcIds, setSelectedTcIds] = useState<string[]>([]);
  const [environment, setEnvironment] = useState(defaultEnv);
  const { mutateAsync: createRun, isPending } = useCreateRun(projectId);

  const inputStyle: React.CSSProperties = {
    width: '100%', padding: '7px 10px', boxSizing: 'border-box',
    background: 'var(--bg)', border: '1px solid var(--border)',
    borderRadius: 6, color: 'var(--text)', fontSize: 12, outline: 'none',
  };

  async function handleRun() {
    if (selectedTcIds.length === 0) { toast.error('Select at least one test case'); return; }
    try {
      await createRun({ testCaseIds: selectedTcIds, environment, name: `Quick Run — ${environment}` });
      toast.success('Run queued! Check the Execution screen for live logs.');
      onClose();
    } catch (e) {
      toast.error((e as Error).message ?? 'Failed to start run');
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)' }}>▶ Quick Run Now</div>
          <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 2 }}>
            Run tests immediately — no schedule needed.
          </div>
        </div>
        <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--text-dim)', cursor: 'pointer', fontSize: 16 }}>✕</button>
      </div>

      <div>
        <label style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-dim)', display: 'block', marginBottom: 5 }}>
          Environment
        </label>
        {envConfigs.length > 0 ? (
          <select value={environment} onChange={e => setEnvironment(e.target.value)} style={inputStyle}>
            {envConfigs.map(env => <option key={env.id} value={env.name}>{env.name}</option>)}
          </select>
        ) : (
          <input value={environment} onChange={e => setEnvironment(e.target.value)} placeholder="Dev / QA / Staging / Prod" style={inputStyle} />
        )}
      </div>

      <GroupedTcSelector testCases={testCases} selected={selectedTcIds} onChange={setSelectedTcIds} />

      <div style={{ display: 'flex', gap: 8 }}>
        <button
          disabled={isPending || selectedTcIds.length === 0}
          onClick={handleRun}
          style={{
            flex: 1, padding: '9px 0', borderRadius: 7,
            background: selectedTcIds.length === 0 ? 'var(--border)' : 'linear-gradient(90deg,#2A9D8F,#1d7a6c)',
            border: 'none', color: selectedTcIds.length === 0 ? 'var(--text-dim)' : '#fff',
            cursor: isPending || selectedTcIds.length === 0 ? 'not-allowed' : 'pointer',
            fontSize: 13, fontWeight: 700, opacity: isPending ? 0.7 : 1,
          }}>
          {isPending ? '⏳ Queuing…' : `▶ Run ${selectedTcIds.length > 0 ? selectedTcIds.length + ' ' : ''}Test${selectedTcIds.length !== 1 ? 's' : ''} Now`}
        </button>
        <button onClick={onClose} style={{
          padding: '9px 16px', borderRadius: 7,
          background: 'transparent', border: '1px solid var(--border)',
          color: 'var(--text-dim)', cursor: 'pointer', fontSize: 13, fontWeight: 600,
        }}>Cancel</button>
      </div>
    </div>
  );
}

// ── Schedule card ──────────────────────────────────────────────────────────

function ScheduleCard({ schedule, isSelected, onEdit, onRunNow, onDelete, onToggle, runNowPending }: {
  schedule: Schedule; isSelected: boolean;
  onEdit: () => void; onRunNow: () => void; onDelete: () => void; onToggle: () => void;
  runNowPending: boolean;
}) {
  const tcIds = useMemo(() => { try { return JSON.parse(schedule.testCaseIds) as string[]; } catch { return []; } }, [schedule.testCaseIds]);
  const emails = useMemo(() => { try { return JSON.parse(schedule.emailRecipients) as string[]; } catch { return []; } }, [schedule.emailRecipients]);
  const freq = useMemo(() => parseCronToFreq(schedule.cronExpression), [schedule.cronExpression]);

  return (
    <div onClick={onEdit} style={{
      background: 'var(--surface)',
      border: `1px solid ${isSelected ? 'var(--cyan)' : 'var(--border)'}`,
      borderRadius: 10, padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 10,
      cursor: 'pointer', boxShadow: isSelected ? '0 0 0 2px rgba(34,211,238,0.1)' : 'var(--shadow-card)',
      position: 'relative', overflow: 'hidden', transition: 'border-color 0.15s',
    }}>
      <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 3, borderRadius: '10px 10px 0 0', background: schedule.isActive ? 'linear-gradient(90deg,#2563AB,#0A2A57)' : 'var(--border)' }} />

      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8, marginTop: 4 }}>
        <div style={{ flex: 1, overflow: 'hidden' }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{schedule.name}</div>
          <div style={{ fontSize: 11, color: 'var(--text-mid)', marginTop: 3, display: 'flex', alignItems: 'center', gap: 4 }}>
            <span>⏰</span><span>{freqToHuman(freq)}</span>
          </div>
        </div>
        <button onClick={e => { e.stopPropagation(); onToggle(); }} title={schedule.isActive ? 'Pause' : 'Activate'}
          style={{ width: 38, height: 21, borderRadius: 100, border: 'none', cursor: 'pointer', background: schedule.isActive ? 'var(--cyan)' : 'var(--border)', position: 'relative', flexShrink: 0, transition: 'background 0.2s' }}>
          <div style={{ position: 'absolute', top: 2.5, left: schedule.isActive ? 19 : 2.5, width: 16, height: 16, borderRadius: '50%', background: '#fff', transition: 'left 0.2s', boxShadow: '0 1px 3px rgba(0,0,0,0.25)' }} />
        </button>
      </div>

      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 9, fontWeight: 700, textTransform: 'uppercase', padding: '2px 8px', borderRadius: 100, background: 'rgba(37,99,171,0.12)', color: 'var(--cyan)' }}>{schedule.environment}</span>
        <span style={{ fontSize: 9, fontWeight: 700, textTransform: 'uppercase', padding: '2px 8px', borderRadius: 100, background: 'rgba(244,123,32,0.1)', color: 'var(--skip)' }}>{tcIds.length} test{tcIds.length !== 1 ? 's' : ''}</span>
        {emails.length > 0 && <span style={{ fontSize: 9, fontWeight: 700, textTransform: 'uppercase', padding: '2px 8px', borderRadius: 100, background: 'rgba(42,157,143,0.1)', color: 'var(--pass)' }}>📧 {emails.length}</span>}
        {!schedule.isActive && <span style={{ fontSize: 9, fontWeight: 700, textTransform: 'uppercase', padding: '2px 8px', borderRadius: 100, background: 'rgba(100,116,139,0.12)', color: 'var(--text-dim)' }}>PAUSED</span>}
      </div>

      <div style={{ display: 'flex', gap: 6, borderTop: '1px solid var(--border)', paddingTop: 10 }} onClick={e => e.stopPropagation()}>
        <button disabled={runNowPending} onClick={onRunNow} style={{
          flex: 1, padding: '5px 0', borderRadius: 6,
          background: 'rgba(42,157,143,0.1)', border: '1px solid rgba(42,157,143,0.25)',
          color: 'var(--pass)', cursor: runNowPending ? 'not-allowed' : 'pointer',
          fontSize: 11, fontWeight: 700, opacity: runNowPending ? 0.6 : 1,
        }}>{runNowPending ? '⏳ Queuing…' : '▶ Run Now'}</button>
        <button onClick={onEdit} style={{ padding: '5px 12px', borderRadius: 6, background: 'transparent', border: '1px solid var(--border)', color: 'var(--text-dim)', cursor: 'pointer', fontSize: 11, fontWeight: 600 }}>Edit</button>
        <button onClick={onDelete} style={{ padding: '5px 12px', borderRadius: 6, background: 'transparent', border: '1px solid rgba(220,38,38,0.2)', color: 'var(--fail)', cursor: 'pointer', fontSize: 11, fontWeight: 600 }}>Delete</button>
      </div>
    </div>
  );
}

// ── Schedule form ──────────────────────────────────────────────────────────

interface FormState {
  name: string;
  freq: FreqConfig;
  environment: string;
  selectedTcIds: string[];
  emailRecipients: string;
  isActive: boolean;
}

function ScheduleForm({ mode, initial, envConfigs, testCases, onSave, onCancel, isSaving }: {
  mode: 'create' | 'edit';
  initial?: Partial<FormState>;
  envConfigs: EnvConfig[];
  testCases: TestCase[];
  onSave: (d: FormState) => void;
  onCancel: () => void;
  isSaving: boolean;
}) {
  const defaultEnv = envConfigs.find(e => e.isDefault)?.name ?? envConfigs[0]?.name ?? 'Dev';
  const [form, setForm] = useState<FormState>({
    name: initial?.name ?? '',
    freq: initial?.freq ?? DEFAULT_FREQ,
    environment: initial?.environment ?? defaultEnv,
    selectedTcIds: initial?.selectedTcIds ?? [],
    emailRecipients: initial?.emailRecipients ?? '',
    isActive: initial?.isActive ?? true,
  });

  const set = (p: Partial<FormState>) => setForm(f => ({ ...f, ...p }));
  const inputStyle: React.CSSProperties = { width: '100%', padding: '7px 10px', boxSizing: 'border-box', background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 6, color: 'var(--text)', fontSize: 12, outline: 'none', fontFamily: 'var(--font-ui)' };
  const labelStyle: React.CSSProperties = { fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-dim)', marginBottom: 5, display: 'block' };

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) { toast.error('Schedule name is required'); return; }
    if (form.selectedTcIds.length === 0) { toast.error('Select at least one test case'); return; }
    if (!form.environment.trim()) { toast.error('Select an environment'); return; }
    onSave(form);
  }

  return (
    <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)' }}>{mode === 'create' ? '+ New Schedule' : 'Edit Schedule'}</div>
        <button type="button" onClick={onCancel} style={{ background: 'none', border: 'none', color: 'var(--text-dim)', cursor: 'pointer', fontSize: 16 }}>✕</button>
      </div>

      <div>
        <label style={labelStyle}>Name</label>
        <input value={form.name} onChange={e => set({ name: e.target.value })} placeholder="e.g. Nightly Regression" style={inputStyle} />
      </div>

      <div>
        <label style={labelStyle}>Schedule Frequency</label>
        <FrequencyPicker value={form.freq} onChange={freq => set({ freq })} />
      </div>

      <div>
        <label style={labelStyle}>Environment</label>
        {envConfigs.length > 0 ? (
          <select value={form.environment} onChange={e => set({ environment: e.target.value })} style={inputStyle}>
            {envConfigs.map(env => <option key={env.id} value={env.name}>{env.name}</option>)}
          </select>
        ) : (
          <input value={form.environment} onChange={e => set({ environment: e.target.value })} placeholder="Dev / QA / Staging / Prod" style={inputStyle} />
        )}
      </div>

      <GroupedTcSelector testCases={testCases} selected={form.selectedTcIds} onChange={ids => set({ selectedTcIds: ids })} />

      <div>
        <label style={labelStyle}>Email Recipients</label>
        <input value={form.emailRecipients} onChange={e => set({ emailRecipients: e.target.value })} placeholder="user@example.com, team@example.com" style={inputStyle} />
        <div style={{ marginTop: 4, fontSize: 10, color: 'var(--text-dim)' }}>Comma-separated. Leave empty to skip.</div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)' }}>Active</div>
          <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 2 }}>Schedule will {form.isActive ? '' : 'not '}fire automatically</div>
        </div>
        <button type="button" onClick={() => set({ isActive: !form.isActive })} style={{ width: 44, height: 24, borderRadius: 100, border: 'none', cursor: 'pointer', background: form.isActive ? 'var(--cyan)' : 'var(--border)', position: 'relative', transition: 'background 0.2s', flexShrink: 0 }}>
          <div style={{ position: 'absolute', top: 3, left: form.isActive ? 22 : 3, width: 18, height: 18, borderRadius: '50%', background: '#fff', transition: 'left 0.2s', boxShadow: '0 1px 3px rgba(0,0,0,0.25)' }} />
        </button>
      </div>

      <div style={{ display: 'flex', gap: 8, paddingTop: 4 }}>
        <button type="submit" disabled={isSaving} style={{ flex: 1, padding: '8px 0', borderRadius: 7, background: 'linear-gradient(90deg,#2A9D8F,#1d7a6c)', border: 'none', color: '#fff', cursor: isSaving ? 'not-allowed' : 'pointer', fontSize: 13, fontWeight: 700, opacity: isSaving ? 0.7 : 1 }}>
          {isSaving ? 'Saving…' : mode === 'create' ? 'Create Schedule' : 'Save Changes'}
        </button>
        <button type="button" onClick={onCancel} style={{ padding: '8px 16px', borderRadius: 7, background: 'transparent', border: '1px solid var(--border)', color: 'var(--text-dim)', cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>Cancel</button>
      </div>
    </form>
  );
}

// ── Recent runs table ──────────────────────────────────────────────────────

const STATUS_CLR: Record<string, string> = { PASSED: 'var(--pass)', FAILED: 'var(--fail)', RUNNING: 'var(--cyan)', PENDING: 'var(--skip)', CANCELLED: 'var(--text-dim)' };

function RecentRunsTable({ runs, loading }: { runs: RunListItem[]; loading: boolean }) {
  if (loading) return <div style={{ padding: '24px', textAlign: 'center', color: 'var(--text-dim)', fontSize: 12 }}>Loading…</div>;
  if (runs.length === 0) return (
    <div style={{ padding: '28px 16px', textAlign: 'center', color: 'var(--text-dim)', fontSize: 12, lineHeight: 1.7 }}>
      No scheduled runs yet.<br /><span style={{ color: 'var(--text-mid)' }}>Use ▶ Run Now on a schedule or the Quick Run button.</span>
    </div>
  );
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
        <thead>
          <tr>{['Run', 'Env', 'Status', '✓', '✗', 'Started'].map(h => (
            <th key={h} style={{ padding: '6px 10px', textAlign: 'left', fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-dim)', borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap' }}>{h}</th>
          ))}</tr>
        </thead>
        <tbody>
          {runs.map(run => {
            const passed = run.results.filter(r => r.status === 'PASSED').length;
            const failed = run.results.filter(r => r.status === 'FAILED').length;
            return (
              <tr key={run.id} style={{ borderBottom: '1px solid var(--border)' }}>
                <td style={{ padding: '7px 10px', color: 'var(--text)', fontWeight: 500, maxWidth: 150, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{run.name}</td>
                <td style={{ padding: '7px 10px' }}><span style={{ fontSize: 9, fontWeight: 700, textTransform: 'uppercase', padding: '2px 7px', borderRadius: 100, background: 'rgba(37,99,171,0.12)', color: 'var(--cyan)' }}>{run.environment}</span></td>
                <td style={{ padding: '7px 10px' }}><span style={{ fontSize: 10, fontWeight: 700, color: STATUS_CLR[run.status] ?? 'var(--text-dim)' }}>{run.status}</span></td>
                <td style={{ padding: '7px 10px', color: 'var(--pass)', fontWeight: 700 }}>{passed > 0 ? passed : '—'}</td>
                <td style={{ padding: '7px 10px', color: 'var(--fail)', fontWeight: 700 }}>{failed > 0 ? failed : '—'}</td>
                <td style={{ padding: '7px 10px', color: 'var(--text-dim)', fontSize: 10, fontFamily: 'var(--font-mono)', whiteSpace: 'nowrap' }}>
                  {run.startedAt ? new Date(run.startedAt).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : <span style={{ color: 'var(--skip)' }}>Pending</span>}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ── Main page ──────────────────────────────────────────────────────────────

type PageMode = 'idle' | 'create' | 'edit' | 'run-now';

export default function Scheduler() {
  const { slug } = useParams<{ slug: string }>();
  const projectId = slug!;

  const [mode, setMode] = useState<PageMode>('idle');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [runNowId, setRunNowId] = useState<string | null>(null);

  const { data: schedules = [], isLoading: schedulesLoading } = useSchedules(projectId);
  const { data: runsData, isLoading: runsLoading } = useRuns(projectId);
  const allRuns: RunListItem[] = runsData?.runs ?? [];
  const scheduledRuns = allRuns.filter(r => r.triggerType === 'SCHEDULED');
  const activeRuns = scheduledRuns.filter(r => r.status === 'PENDING' || r.status === 'RUNNING');

  const { activeProject } = useProjectStore();
  const envConfigs: EnvConfig[] = activeProject?.envConfigs ?? [];

  const { data: testCases = [] } = useQuery<TestCase[]>({
    queryKey: ['test-cases', projectId, 'approved-scheduler'],
    queryFn: async () => {
      const res = await api.get<{ testCases: TestCase[] }>(`/projects/${projectId}/test-cases?status=APPROVED&limit=500`);
      return res.data.testCases ?? [];
    },
    enabled: !!projectId,
  });

  const { mutateAsync: createSchedule, isPending: creating } = useCreateSchedule(projectId);
  const { mutateAsync: updateSchedule, isPending: updating } = useUpdateSchedule(projectId);
  const { mutateAsync: deleteSchedule } = useDeleteSchedule(projectId);
  const { mutateAsync: runNow, isPending: runNowPending } = useRunNow(projectId);

  const activeCount = schedules.filter(s => s.isActive).length;
  const runs7d = scheduledRuns.filter(r => {
    const d = new Date(r.startedAt ?? '');
    return !isNaN(d.getTime()) && Date.now() - d.getTime() < 7 * 24 * 3600 * 1000;
  }).length;

  const editingSchedule = useMemo(() => schedules.find(s => s.id === editingId), [schedules, editingId]);

  const editInitial: Partial<FormState> | undefined = useMemo(() => {
    if (!editingSchedule) return undefined;
    let tcIds: string[] = [];
    let emails = '';
    try { tcIds = JSON.parse(editingSchedule.testCaseIds); } catch { /* noop */ }
    try { emails = (JSON.parse(editingSchedule.emailRecipients) as string[]).join(', '); } catch { /* noop */ }
    return { name: editingSchedule.name, freq: parseCronToFreq(editingSchedule.cronExpression), environment: editingSchedule.environment, selectedTcIds: tcIds, emailRecipients: emails, isActive: editingSchedule.isActive };
  }, [editingSchedule]);

  function closeForm() { setMode('idle'); setEditingId(null); }

  async function handleSave(formData: FormState) {
    const cronExpression = buildCron(formData.freq);
    const emailRecipients = formData.emailRecipients.split(',').map(e => e.trim()).filter(Boolean);
    try {
      if (mode === 'create') {
        await createSchedule({ name: formData.name, cronExpression, testCaseIds: formData.selectedTcIds, environment: formData.environment, isActive: formData.isActive, emailRecipients });
        toast.success('Schedule created');
      } else if (editingId) {
        await updateSchedule({ id: editingId, name: formData.name, cronExpression, testCaseIds: formData.selectedTcIds, environment: formData.environment, isActive: formData.isActive, emailRecipients });
        toast.success('Schedule updated');
      }
      closeForm();
    } catch (e) { toast.error((e as Error).message ?? 'Failed to save'); }
  }

  async function handleRunNow(scheduleId: string) {
    setRunNowId(scheduleId);
    try {
      await runNow(scheduleId);
      toast.success('Run queued — check Execution for live logs');
    } catch (e) { toast.error((e as Error).message ?? 'Failed to trigger'); }
    finally { setRunNowId(null); }
  }

  async function handleToggle(schedule: Schedule) {
    try {
      await updateSchedule({ id: schedule.id, isActive: !schedule.isActive });
      toast.success(schedule.isActive ? 'Schedule paused' : 'Schedule activated');
    } catch (e) { toast.error((e as Error).message ?? 'Failed'); }
  }

  async function handleDelete(scheduleId: string) {
    if (!window.confirm('Delete this schedule?')) return;
    try {
      await deleteSchedule(scheduleId);
      if (editingId === scheduleId) closeForm();
      toast.success('Deleted');
    } catch (e) { toast.error((e as Error).message ?? 'Failed'); }
  }

  const showForm = mode === 'create' || mode === 'edit';

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <Topbar
        breadcrumbs={[
          { label: 'All Projects', href: '/projects' },
          { label: activeProject?.name ?? 'Project' },
          { label: '⏰ Scheduler' },
        ]}
        actions={
          <div style={{ display: 'flex', gap: 8 }}>
            <TbBtn
              variant="ghost"
              onClick={() => setMode(mode === 'run-now' ? 'idle' : 'run-now')}
              style={{ background: 'rgba(42,157,143,0.1)', color: 'var(--pass)', border: '1px solid rgba(42,157,143,0.25)' }}
            >
              ▶ Quick Run
            </TbBtn>
            <TbBtn
              variant="primary"
              onClick={() => { setMode('create'); setEditingId(null); }}
              style={{ background: 'linear-gradient(90deg,#2563AB,#0A2A57)', color: '#fff', border: 'none' }}
            >
              + New Schedule
            </TbBtn>
          </div>
        }
      />

      <div style={{ flex: 1, overflow: 'auto', padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 20 }}>
        {/* Stat tiles */}
        <div style={{ display: 'flex', gap: 12 }}>
          <StatTile label="Total Schedules" value={schedules.length} color="var(--cyan)" accent="linear-gradient(90deg,#2563AB,#0A2A57)" />
          <StatTile label="Active Schedules" value={activeCount} color="var(--pass)" accent="linear-gradient(90deg,#2A9D8F,#1a7a6e)" />
          <StatTile label="Scheduled Runs (7d)" value={runs7d} color="#F47B20" accent="linear-gradient(90deg,#FFB347,#F47B20)" />
          <StatTile label="In Queue / Running" value={activeRuns.length} color={activeRuns.length > 0 ? 'var(--cyan)' : 'var(--text-dim)'} accent={activeRuns.length > 0 ? 'linear-gradient(90deg,#2563AB,#0A2A57)' : 'var(--border)'} />
        </div>

        {/* 2-col layout */}
        <div style={{ display: 'grid', gridTemplateColumns: showForm || mode === 'run-now' ? '1fr 460px' : '1fr 1fr', gap: 20, alignItems: 'start' }}>

          {/* LEFT: schedule list */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <h2 style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)', margin: 0, display: 'flex', alignItems: 'center', gap: 6 }}>
              ⏰ Schedules
              {schedules.length > 0 && <span style={{ fontSize: 10, background: 'rgba(37,99,171,0.12)', color: 'var(--cyan)', padding: '1px 7px', borderRadius: 100, fontWeight: 700 }}>{schedules.length}</span>}
            </h2>

            {schedulesLoading ? (
              <div style={{ color: 'var(--text-dim)', fontSize: 12, textAlign: 'center', padding: '40px 0' }}>Loading schedules…</div>
            ) : schedules.length === 0 ? (
              <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, padding: '48px 24px', textAlign: 'center' }}>
                <div style={{ fontSize: 36, marginBottom: 12 }}>⏰</div>
                <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)', marginBottom: 6 }}>No schedules yet</div>
                <div style={{ fontSize: 12, color: 'var(--text-dim)', marginBottom: 20, lineHeight: 1.65 }}>Create recurring test runs on a daily,<br />weekly, or custom schedule.</div>
                <button onClick={() => setMode('create')} style={{ padding: '8px 20px', borderRadius: 7, background: 'linear-gradient(90deg,#2563AB,#0A2A57)', border: 'none', color: '#fff', cursor: 'pointer', fontSize: 12, fontWeight: 700 }}>+ Create First Schedule</button>
              </div>
            ) : (
              schedules.map(schedule => (
                <ScheduleCard
                  key={schedule.id}
                  schedule={schedule}
                  isSelected={editingId === schedule.id && mode === 'edit'}
                  onEdit={() => { setEditingId(schedule.id); setMode('edit'); }}
                  onRunNow={() => handleRunNow(schedule.id)}
                  onDelete={() => handleDelete(schedule.id)}
                  onToggle={() => handleToggle(schedule)}
                  runNowPending={runNowId === schedule.id && runNowPending}
                />
              ))
            )}
          </div>

          {/* RIGHT: form / run-now / idle panel */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {(showForm || mode === 'run-now') ? (
              <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, padding: '18px 20px', position: 'relative', overflow: 'hidden' }}>
                <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 3, background: mode === 'run-now' ? 'linear-gradient(90deg,#2A9D8F,#1d7a6c)' : 'linear-gradient(90deg,#2563AB,#0A2A57)', borderRadius: '12px 12px 0 0' }} />
                {showForm ? (
                  <ScheduleForm
                    mode={mode === 'edit' ? 'edit' : 'create'}
                    initial={editInitial}
                    envConfigs={envConfigs}
                    testCases={testCases}
                    onSave={handleSave}
                    onCancel={closeForm}
                    isSaving={creating || updating}
                  />
                ) : (
                  <RunNowPanel
                    testCases={testCases}
                    envConfigs={envConfigs}
                    projectId={projectId}
                    onClose={() => setMode('idle')}
                  />
                )}
              </div>
            ) : (
              <>
                {activeRuns.length > 0 && (
                  <div style={{ background: 'var(--surface)', border: '1px solid rgba(37,99,171,0.3)', borderRadius: 12, overflow: 'hidden' }}>
                    <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--cyan)', display: 'inline-block' }} />
                      <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>In Progress</span>
                      <span style={{ fontSize: 10, background: 'rgba(37,99,171,0.12)', color: 'var(--cyan)', padding: '1px 7px', borderRadius: 100, fontWeight: 700 }}>{activeRuns.length}</span>
                    </div>
                    <div style={{ padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 8 }}>
                      {activeRuns.map(run => <ActiveRunCard key={run.id} run={run} />)}
                    </div>
                  </div>
                )}

                <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden' }}>
                  <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>Recent Scheduled Runs</span>
                    <span style={{ fontSize: 10, color: 'var(--text-dim)', fontFamily: 'var(--font-mono)' }}>{scheduledRuns.length} total</span>
                  </div>
                  <RecentRunsTable runs={scheduledRuns.slice(0, 20)} loading={runsLoading} />
                </div>

                <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderLeft: '3px solid var(--cyan)', borderRadius: 12, padding: '14px 16px', position: 'relative', overflow: 'hidden' }}>
                  <div style={{ height: 3, background: 'linear-gradient(90deg,#2563AB,#0A2A57)', position: 'absolute', top: 0, left: 0, right: 0 }} />
                  <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.07em', color: 'var(--cyan)', marginBottom: 8 }}>Cron Quick Reference</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                    {[['0 9 * * *','Every day at 9 AM'],['0 9 * * 1-5','Weekdays at 9 AM'],['0 * * * *','Every hour'],['0 0 * * 1','Every Monday midnight'],['*/15 * * * *','Every 15 minutes']].map(([expr, desc]) => (
                      <div key={expr} style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                        <code style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-mid)', background: 'var(--surface2)', padding: '2px 6px', borderRadius: 4, border: '1px solid var(--border)', whiteSpace: 'nowrap' }}>{expr}</code>
                        <span style={{ fontSize: 11, color: 'var(--text-dim)' }}>{desc}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
