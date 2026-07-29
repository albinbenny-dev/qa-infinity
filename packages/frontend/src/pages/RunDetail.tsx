import { useState, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import Topbar, { TbBtn } from '../components/layout/Topbar';
import { useReportRun } from '../hooks/useReports';
import { useProject } from '../hooks/useProjects';
import { useProjectStore } from '../stores/projectStore';

const STATUS_COLOR: Record<string, string> = {
  PASSED: 'var(--pass)',
  FAILED: 'var(--fail)',
  RUNNING: 'var(--cyan)',
  PENDING: 'var(--amber)',
  CANCELLED: 'var(--text-dim)',
  SKIPPED: 'var(--skip)',
};


function StatTile({ label, value, accent }: { label: string; value: string | number; accent: string }) {
  return (
    <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, padding: '14px 16px', flex: 1, position: 'relative', overflow: 'hidden', boxShadow: 'var(--shadow-card)' }}>
      <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 3, background: accent }} />
      <div style={{ fontSize: 28, fontWeight: 800, color: '#F47B20', lineHeight: 1, marginTop: 4 }}>{value}</div>
      <div style={{ fontSize: 10, color: 'var(--text-dim)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.07em', marginTop: 3 }}>{label}</div>
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  background: 'var(--surface2)',
  border: '1px solid var(--border)',
  borderRadius: 6,
  color: 'var(--text)',
  fontSize: 12,
  padding: '5px 10px',
  outline: 'none',
};

export default function RunDetail() {
  const { slug, runId } = useParams<{ slug: string; runId: string }>();
  const navigate = useNavigate();
  const { data: project } = useProject(slug);
  const projectId = project?.id;
  const { activeProject } = useProjectStore();
  const { data: run, isLoading } = useReportRun(projectId, runId ?? null);

  const [viewMode, setViewMode] = useState<'script' | 'tc'>('script');
  const [suiteFilter, setSuiteFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [search, setSearch] = useState('');
  const [expandedGroups, setExpandedGroups] = useState<Set<string> | null>(null);

  const results = run?.results ?? [];

  const uniqueSuites = useMemo(() => {
    const s = new Set<string>();
    for (const r of results) s.add(r.testCase.useCaseTag ?? 'Uncategorized');
    return Array.from(s);
  }, [results]);

  const filtered = useMemo(() => {
    return results.filter((r) => {
      if (suiteFilter && (r.testCase.useCaseTag ?? 'Uncategorized') !== suiteFilter) return false;
      if (statusFilter && r.status !== statusFilter) return false;
      if (search) {
        const q = search.toLowerCase();
        if (!r.testCase.title.toLowerCase().includes(q) && !r.testCase.tcId.toLowerCase().includes(q)) return false;
      }
      return true;
    });
  }, [results, suiteFilter, statusFilter, search]);

  const groupedMap = useMemo(() => {
    const m = new Map<string, typeof filtered>();
    for (const r of filtered) {
      const key = r.testCase.useCaseTag ?? 'Uncategorized';
      if (!m.has(key)) m.set(key, []);
      m.get(key)!.push(r);
    }
    return m;
  }, [filtered]);

  const groups = Array.from(groupedMap.entries());

  const defaultExpanded = useMemo(() => {
    return new Set(Array.from(groupedMap.keys()));
  }, [groupedMap]);

  const activeExpanded = expandedGroups ?? defaultExpanded;

  function toggleGroup(key: string) {
    const next = new Set(activeExpanded);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setExpandedGroups(next);
  }

  const total = results.length;
  const passed = results.filter((r) => r.status === 'PASSED').length;
  const failed = results.filter((r) => r.status === 'FAILED').length;
  const skipped = results.filter((r) => r.status === 'SKIPPED').length;
  const passRate = total > 0 ? Math.round((passed / total) * 100) : 0;

  const colHeader: React.CSSProperties = { fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-dim)', padding: '8px 12px', borderBottom: '1px solid var(--border)', textAlign: 'left' };

  function ResultRow({ r }: { r: (typeof results)[0] }) {
    const rowBg = r.status === 'FAILED' ? 'rgba(220,38,38,0.05)' : r.status === 'SKIPPED' ? 'rgba(251,191,36,0.05)' : 'transparent';
    const dur = r.duration != null ? `${(r.duration / 1000).toFixed(1)}s` : '—';
    const err = r.errorMessage ? (r.errorMessage.length > 60 ? r.errorMessage.slice(0, 57) + '…' : r.errorMessage) : '—';
    return (
      <tr style={{ background: rowBg, borderBottom: '1px solid var(--border)' }}>
        <td style={{ padding: '8px 12px', fontSize: 12 }}>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-dim)' }}>{r.testCase.tcId} </span>
          <span style={{ color: 'var(--text)' }}>{r.testCase.title}</span>
        </td>
        <td style={{ padding: '8px 12px', fontSize: 11, color: 'var(--text-dim)' }}>{r.testCase.useCaseTag ?? '—'}</td>
        <td style={{ padding: '8px 12px', fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--text-dim)' }}>{dur}</td>
        <td style={{ padding: '8px 12px', fontSize: 11, color: STATUS_COLOR[r.status] ?? 'var(--text-dim)', fontWeight: 700 }}>{r.status}</td>
        <td style={{ padding: '8px 12px', fontSize: 11, color: 'var(--text-dim)', maxWidth: 240 }}>{err}</td>
      </tr>
    );
  }

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <Topbar
        breadcrumbs={[
          { label: 'All Projects', href: '/projects' },
          { label: activeProject?.name ?? slug ?? '' },
          { label: 'Reports', href: `/projects/${slug}/reports` },
          { label: `#${String(run?.runSeq ?? 0).padStart(4, '0')} ${run?.name ?? ''}` },
        ]}
        actions={
          <TbBtn variant="ghost" onClick={() => navigate(`/projects/${slug}/reports`)} style={{ background: 'rgba(37,99,171,0.1)', color: 'var(--cyan)', border: '1px solid rgba(37,99,171,0.25)' }}>
            ← Back
          </TbBtn>
        }
      />

      <div style={{ flex: 1, overflow: 'auto', padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 20 }}>
        {isLoading ? (
          <div style={{ textAlign: 'center', color: 'var(--text-dim)', fontSize: 13, paddingTop: 60 }}>Loading run details…</div>
        ) : !run ? (
          <div style={{ textAlign: 'center', color: 'var(--text-dim)', fontSize: 13, paddingTop: 60 }}>Run not found.</div>
        ) : (
          <>
            {/* Header row */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ width: 10, height: 10, borderRadius: '50%', background: STATUS_COLOR[run.status] ?? 'var(--text-dim)', display: 'inline-block', flexShrink: 0 }} />
              <span style={{ fontSize: 16, fontWeight: 700, color: 'var(--text)' }}>{run.name}</span>
              <span style={{ fontSize: 12, color: 'var(--text-dim)', fontFamily: 'var(--font-mono)' }}>
                #{String(run.runSeq).padStart(4, '0')} · {run.environment} · {new Date(run.createdAt).toLocaleString([], { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
              </span>
            </div>

            {/* Stat tiles */}
            <div style={{ display: 'flex', gap: 12 }}>
              <StatTile label="Total" value={total} accent="linear-gradient(90deg, var(--cyan), #2563AB)" />
              <StatTile label="Passed" value={passed} accent="linear-gradient(90deg, var(--pass), #1a7a6e)" />
              <StatTile label="Failed" value={failed} accent="linear-gradient(90deg, var(--fail), #b91c1c)" />
              <StatTile label="Skipped" value={skipped} accent="linear-gradient(90deg, var(--amber), #D97706)" />
              <StatTile label="Pass Rate" value={`${passRate}%`} accent="linear-gradient(90deg, var(--skip), #D9601A)" />
            </div>

            {/* Filter controls */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <div style={{ display: 'flex', gap: 0, background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 6, overflow: 'hidden' }}>
                <button onClick={() => setViewMode('script')} style={{ padding: '5px 14px', fontSize: 12, border: 'none', cursor: 'pointer', background: viewMode === 'script' ? 'var(--cyan)' : 'transparent', color: viewMode === 'script' ? '#fff' : 'var(--text)' }}>By Script</button>
                <button onClick={() => setViewMode('tc')} style={{ padding: '5px 14px', fontSize: 12, border: 'none', cursor: 'pointer', background: viewMode === 'tc' ? 'var(--cyan)' : 'transparent', color: viewMode === 'tc' ? '#fff' : 'var(--text)' }}>By Test Case</button>
              </div>
              <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} style={inputStyle}>
                <option value="">All Status</option>
                {['PASSED', 'FAILED', 'SKIPPED', 'RUNNING', 'CANCELLED'].map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Filter test cases…" style={{ ...inputStyle, minWidth: 180 }} />
              <span style={{ fontSize: 11, color: 'var(--text-dim)', fontFamily: 'var(--font-mono)' }}>{filtered.length} results</span>
            </div>

            {/* Results table */}
            <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, boxShadow: 'var(--shadow-card)', overflow: 'hidden' }}>
              {viewMode === 'script' ? (
                <div>
                  {groups.map(([groupKey, groupResults]) => {
                    const gPass = groupResults.filter((r) => r.status === 'PASSED').length;
                    const gFail = groupResults.filter((r) => r.status === 'FAILED').length;
                    const isOpen = activeExpanded.has(groupKey);
                    return (
                      <div key={groupKey}>
                        <div
                          onClick={() => toggleGroup(groupKey)}
                          style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', borderBottom: '1px solid var(--border)', cursor: 'pointer', background: 'var(--surface2)' }}
                        >
                          <span style={{ fontSize: 10, color: 'var(--cyan)' }}>{isOpen ? '▼' : '▶'}</span>
                          <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)', flex: 1 }}>{groupKey}</span>
                          <span style={{ fontSize: 11, color: 'var(--text-dim)' }}>{groupResults.length} TCs</span>
                          {gPass > 0 && <span style={{ fontSize: 11, color: 'var(--pass)' }}>{gPass} PASSED</span>}
                          {gFail > 0 && <span style={{ fontSize: 11, color: 'var(--fail)' }}>{gFail} FAILED</span>}
                        </div>
                        {isOpen && (
                          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                            <thead>
                              <tr>
                                <th style={colHeader}>Title</th>
                                <th style={colHeader}>Suite</th>
                                <th style={colHeader}>Duration</th>
                                <th style={colHeader}>Status</th>
                                <th style={colHeader}>Error</th>
                              </tr>
                            </thead>
                            <tbody>
                              {groupResults.map((r) => <ResultRow key={r.id} r={r} />)}
                            </tbody>
                          </table>
                        )}
                      </div>
                    );
                  })}
                  {groups.length === 0 && (
                    <div style={{ padding: '32px 0', textAlign: 'center', color: 'var(--text-dim)', fontSize: 12 }}>No results match the current filters.</div>
                  )}
                </div>
              ) : (
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr>
                      <th style={colHeader}>Title</th>
                      <th style={colHeader}>Suite</th>
                      <th style={colHeader}>Duration</th>
                      <th style={colHeader}>Status</th>
                      <th style={colHeader}>Error</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((r) => <ResultRow key={r.id} r={r} />)}
                    {filtered.length === 0 && (
                      <tr><td colSpan={5} style={{ padding: '32px 0', textAlign: 'center', color: 'var(--text-dim)', fontSize: 12 }}>No results match the current filters.</td></tr>
                    )}
                  </tbody>
                </table>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
