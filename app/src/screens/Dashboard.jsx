import React from 'react';
import { TEAM_ROSTERS, findPlayer, findTeam, NEWS, LEAGUE_TEAMS } from '../lib/data.js';
import { PlayerCell, StatusDot, Sparkline, PosBadge } from '../components/ui.jsx';
import { api } from '../api.js';
import { useApi } from '../hooks.js';
import { fetchSleeperPlayerStats } from '../lib/sleeper.js';

const NFL_SCHEDULE = [
  { key: 'hof',  label: 'Hall of Fame Game',  start: '2026-08-06', end: '2026-08-12', pre: true },
  { key: 'pre1', label: 'Preseason Week 1',   start: '2026-08-13', end: '2026-08-19', pre: true },
  { key: 'pre2', label: 'Preseason Week 2',   start: '2026-08-20', end: '2026-08-26', pre: true },
  { key: 'pre3', label: 'Preseason Week 3',   start: '2026-08-27', end: '2026-09-01', pre: true },
  { key: 'wk1',  label: 'Week 1',  num: 1,    start: '2026-09-09', end: '2026-09-15' },
  { key: 'wk2',  label: 'Week 2',  num: 2,    start: '2026-09-16', end: '2026-09-22' },
  { key: 'wk3',  label: 'Week 3',  num: 3,    start: '2026-09-23', end: '2026-09-29' },
  { key: 'wk4',  label: 'Week 4',  num: 4,    start: '2026-09-30', end: '2026-10-06' },
  { key: 'wk5',  label: 'Week 5',  num: 5,    start: '2026-10-07', end: '2026-10-13' },
  { key: 'wk6',  label: 'Week 6',  num: 6,    start: '2026-10-14', end: '2026-10-20' },
  { key: 'wk7',  label: 'Week 7',  num: 7,    start: '2026-10-21', end: '2026-10-27' },
  { key: 'wk8',  label: 'Week 8',  num: 8,    start: '2026-10-28', end: '2026-11-03' },
  { key: 'wk9',  label: 'Week 9',  num: 9,    start: '2026-11-04', end: '2026-11-10' },
  { key: 'wk10', label: 'Week 10', num: 10,   start: '2026-11-11', end: '2026-11-17' },
  { key: 'wk11', label: 'Week 11', num: 11,   start: '2026-11-19', end: '2026-11-24' },
  { key: 'wk12', label: 'Week 12', num: 12,   start: '2026-11-25', end: '2026-12-01' },
  { key: 'wk13', label: 'Week 13', num: 13,   start: '2026-12-02', end: '2026-12-08' },
  { key: 'wk14', label: 'Week 14', num: 14,   start: '2026-12-09', end: '2026-12-15' },
  { key: 'wk15', label: 'Week 15', num: 15,   start: '2026-12-16', end: '2026-12-22' },
  { key: 'wk16', label: 'Week 16', num: 16,   start: '2026-12-23', end: '2026-12-29' },
  { key: 'wk17', label: 'Week 17', num: 17,   start: '2026-12-30', end: '2027-01-05' },
  { key: 'wk18', label: 'Week 18', num: 18,   start: '2027-01-06', end: '2027-01-12' },
];

function getCurrentWeek() {
  const today = new Date().toISOString().slice(0, 10);
  const found = NFL_SCHEDULE.find(w => today >= w.start && today <= w.end);
  if (found) return found;
  if (today < NFL_SCHEDULE[0].start) return { key: 'offseason', label: 'Offseason · 2026', pre: true };
  return { key: 'offseason', label: 'Offseason', pre: true };
}

function getNextWeek() {
  const today = new Date().toISOString().slice(0, 10);
  const idx = NFL_SCHEDULE.findIndex(w => today < w.start);
  return idx >= 0 ? NFL_SCHEDULE[idx] : null;
}

function buildStandings(cbsRaw) {
  if (!cbsRaw) return null;
  const teams = Array.isArray(cbsRaw) ? cbsRaw
    : cbsRaw.teams || cbsRaw.body?.teams || cbsRaw.data || [];
  if (!Array.isArray(teams) || !teams.length) return null;
  return teams.map(ct => {
    const cbsId = String(ct.id || ct.team_id || '');
    const mock = LEAGUE_TEAMS.find(t => t.cbsId === cbsId) || LEAGUE_TEAMS.find(t => t.name === ct.name);
    const w = ct.w ?? ct.wins ?? 0;
    const l = ct.l ?? ct.losses ?? 0;
    const pf = ct.pf ?? ct.points_for ?? 0;
    const pa = ct.pa ?? ct.points_against ?? 0;
    return { id: mock?.id, name: ct.name || mock?.name || '—', logo: mock?.logo || '??', color: mock?.color || '#555', w, l, pf, pa, me: mock?.me };
  }).sort((a, b) => b.w - a.w || b.pf - a.pf);
}

export default function Dashboard({ onNav, onOpenPlayer, user, myRosterIds = new Set(), sourcesState, slotOverrides = {} }) {
  const { data: cbsTeams } = useApi(() => api.teams(), []);
  const standings = React.useMemo(() => buildStandings(cbsTeams), [cbsTeams]);
  const currentWeek = React.useMemo(getCurrentWeek, []);
  const nextWeek    = React.useMemo(getNextWeek, []);
  const weekLabel   = currentWeek.label;
  const isOffseason = currentWeek.key === 'offseason';
  const isPre       = currentWeek.pre;

  // Resolve owner info from logged-in user
  const teamId   = user?.teamId || 1;
  const team     = findTeam(teamId);
  const ownerName = team?.owner || user?.teamName || 'Manager';
  const teamName  = team?.name || user?.teamName || 'My Team';

  // 2026 season record from live standings (0-0 until games are played)
  const myStanding = standings?.find(s => s.me) ?? null;
  const record2026 = myStanding ? `${myStanding.w}-${myStanding.l}` : '0-0';

  // Build starting lineup from real roster (starters only, no BENCH)
  const baseRoster = TEAM_ROSTERS[teamId] || [];
  const baseIds    = new Set(baseRoster.map(r => r.playerId).filter(Boolean));
  const extraIds   = [...myRosterIds].filter(id => id && !baseIds.has(id));
  const fullRoster = [
    ...baseRoster,
    ...extraIds.map(id => ({ slot: 'BENCH', playerId: id })),
  ].map(entry => ({
    ...entry,
    slot: entry.playerId && slotOverrides[entry.playerId] !== undefined
      ? slotOverrides[entry.playerId]
      : entry.slot,
  }));
  const starters     = fullRoster.filter(r => r.slot !== 'BENCH' && r.playerId);
  const rosterIds    = new Set(fullRoster.map(r => r.playerId).filter(Boolean));
  const totalProj    = starters.reduce((s, r) => s + (findPlayer(r.playerId)?.proj || 0), 0);

  // ── Live roster data from Sleeper (projections + injury news) ─────────────
  const sleeperOn = sourcesState?.freeApis?.['sleeper-api'] !== false;
  // { [playerId]: { proj: number|null, status: string, injuryBodyPart: string } }
  const [sleeperRosterData, setSleeperRosterData] = React.useState({});
  const [newsLoading, setNewsLoading] = React.useState(false);

  const allRosterIds = [...rosterIds].join(',');
  React.useEffect(() => {
    if (!sleeperOn) { setSleeperRosterData({}); return; }
    const targets = [...rosterIds].map(id => findPlayer(id)).filter(Boolean);
    if (!targets.length) return;
    setNewsLoading(true);
    Promise.allSettled(targets.map(p => fetchSleeperPlayerStats(p.name, p.pos)))
      .then(results => {
        const data = {};
        results.forEach((r, i) => {
          if (r.status !== 'fulfilled' || !r.value?.found) return;
          const d = r.value;
          const proj = d.projection?.pts_half_ppr ?? d.projection?.pts_std ?? null;
          data[targets[i].id] = {
            proj:           proj != null ? Number(proj) : null,
            status:         d.status || 'Active',
            injuryBodyPart: d.injuryBodyPart || '',
          };
        });
        setSleeperRosterData(data);
        setNewsLoading(false);
      });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sleeperOn, allRosterIds]);

  // Build projection columns
  const projCols = [
    { id: 'base',    label: 'Proj', sub: 'FantasAI',   color: 'var(--accent)',   get: p => p.proj?.toFixed(1) ?? '—' },
    ...(sleeperOn ? [{ id: 'sleeper', label: 'Proj', sub: 'Sleeper API', color: 'var(--accent-2)', get: p => sleeperRosterData[p.id]?.proj != null ? sleeperRosterData[p.id].proj.toFixed(1) : '—' }] : []),
  ];

  // Build news: live Sleeper items first, mock NEWS as fallback for uncovered players
  const INJURY_IMPACT = { Out: 'high', IR: 'high', Doubtful: 'high', PUP: 'high', Questionable: 'med', Suspended: 'med' };
  const liveNewsItems = sleeperOn
    ? Object.entries(sleeperRosterData)
        .filter(([, d]) => d.status && d.status !== 'Active')
        .map(([pid, d]) => {
          const p = findPlayer(Number(pid));
          if (!p) return null;
          return {
            id:       `live-${pid}`,
            playerId: Number(pid),
            impact:   INJURY_IMPACT[d.status] || 'low',
            title:    d.injuryBodyPart ? `${d.status} · ${d.injuryBodyPart} injury` : `Status: ${d.status}`,
            body:     d.injuryBodyPart
              ? `${p.name} is listed ${d.status} with a ${d.injuryBodyPart} injury. Monitor practice reports.`
              : `${p.name} injury status updated to ${d.status}.`,
            source:   'Sleeper API',
            mins:     0,
            live:     true,
          };
        })
        .filter(Boolean)
    : [];

  const livePlayerIds = new Set(liveNewsItems.map(n => n.playerId));
  const mockNews = NEWS
    .filter(n => rosterIds.has(n.playerId) && !livePlayerIds.has(n.playerId));

  const rosterNews = [...liveNewsItems, ...mockNews]
    .sort((a, b) => {
      const aHigh = a.impact === 'high' || findPlayer(a.playerId)?.status !== 'OK';
      const bHigh = b.impact === 'high' || findPlayer(b.playerId)?.status !== 'OK';
      if (aHigh !== bHigh) return aHigh ? -1 : 1;
      return (a.mins ?? 0) - (b.mins ?? 0);
    })
    .slice(0, 6);

  const subLine = isOffseason
    ? `Next: ${nextWeek ? nextWeek.label + ' · starts ' + new Date(nextWeek.start).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '—'}`
    : isPre
    ? `${currentWeek.label} · Exhibition games`
    : `${currentWeek.label} · ${new Date(currentWeek.start).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} – ${new Date(currentWeek.end).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`;

  return (
    <div className="col" style={{ height: '100%', overflow: 'auto' }}>
      <div className="page-head">
        <div>
          <h1>{weekLabel} Dashboard</h1>
          <div className="sub">{subLine}</div>
        </div>
        <div className="flex gap-8">
          <button className="btn ghost" onClick={() => onNav('roster')}>Set Lineup</button>
          <button className="btn primary" onClick={() => onNav('draft')}>▶ Open Draft Room</button>
        </div>
      </div>

      <div style={{ padding: 24, display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
        <div className="stat">
          <div className="k">Starters Projected</div>
          <div className="v accent">{totalProj.toFixed(1)}</div>
          <div className="sub">{starters.length} of 8 slots filled</div>
        </div>
        <div className="stat"><div className="k">Win Probability</div><div className="v">58.4%</div><div className="sub" style={{ color: 'var(--good)' }}>+2.4% since Tues</div></div>
        <div className="stat"><div className="k">Season Avg</div><div className="v">128.5</div><div className="sub">2nd in league</div></div>
        <div className="stat"><div className="k">Playoff Odds</div><div className="v">84.2%</div><div className="sub">Top seed: 21.8%</div></div>
      </div>

      <div style={{ padding: '0 24px 24px', display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 16 }}>
        <div className="card">
          <div className="card-head">
            <div>
              <div className="card-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span
                  style={{ display: 'inline-block', width: 9, height: 9, borderRadius: '50%', background: team?.color || 'var(--accent)', flexShrink: 0 }}
                />
                Starting Lineup — {teamName}
              </div>
              <div style={{ fontSize: 11, color: 'var(--text-faint)', marginTop: 4, display: 'flex', alignItems: 'center', gap: 10 }}>
                <span>Manager: <strong style={{ color: 'var(--text-dim)', fontWeight: 600 }}>{ownerName}</strong></span>
                <span style={{ color: 'var(--border-strong)' }}>·</span>
                <span>
                  Record:{' '}
                  <span className="mono" style={{ fontWeight: 700, color: record2026 === '0-0' ? 'var(--text-faint)' : 'var(--accent)', fontSize: 11 }}>
                    {record2026}
                  </span>
                  {record2026 === '0-0' && (
                    <span className="mono faint" style={{ fontSize: 9, marginLeft: 4 }}>no games yet</span>
                  )}
                </span>
              </div>
            </div>
            <button className="btn sm ghost" onClick={() => onNav('roster')}>Edit →</button>
          </div>
          <table className="data-table">
            <thead>
              <tr>
                <th>Slot</th>
                <th>Player</th>
                <th>Opp</th>
                {projCols.map(c => (
                  <th key={c.id} className="num" style={{ whiteSpace: 'nowrap' }}>
                    <span style={{ color: c.color }}>{c.label}</span>
                    <div style={{ fontSize: 8, fontFamily: 'var(--font-mono)', color: 'var(--text-faint)', fontWeight: 400, textTransform: 'uppercase', letterSpacing: '.06em', marginTop: 1 }}>{c.sub}</div>
                  </th>
                ))}
                <th>Status</th>
                <th className="num">Trend</th>
              </tr>
            </thead>
            <tbody>
              {starters.length === 0 && (
                <tr>
                  <td colSpan={4 + projCols.length} style={{ textAlign: 'center', padding: '24px 0', color: 'var(--text-faint)', fontSize: 12 }}>
                    No starters found — <button className="btn ghost sm" onClick={() => onNav('roster')} style={{ fontSize: 11 }}>Set your lineup</button>
                  </td>
                </tr>
              )}
              {starters.map(r => {
                const p = findPlayer(r.playerId);
                if (!p) return null;
                return (
                  <tr key={r.playerId} onClick={() => onOpenPlayer(p.id)} style={{ cursor: 'pointer' }}>
                    <td><PosBadge pos={r.slot} /></td>
                    <td><PlayerCell player={p} /></td>
                    <td className="mono dim" style={{ fontSize: 11 }}>vs {p.opp}</td>
                    {projCols.map(c => (
                      <td key={c.id} className="num">
                        <strong style={{ color: c.color }}>{c.get(p)}</strong>
                      </td>
                    ))}
                    <td>
                      {p.status !== 'OK'
                        ? <span className="status-pill"><StatusDot status={p.status} /> {p.status}</span>
                        : <span className="faint" style={{ fontSize: 11 }}>—</span>}
                    </td>
                    <td className="num"><Sparkline data={p.trend} /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="col gap-12">
          <div className="muted-card" style={{ borderLeft: '3px solid var(--accent-2)' }}>
            <div className="flex gap-8" style={{ alignItems: 'center', marginBottom: 8 }}>
              <div className="ai-orb" style={{ width: 22, height: 22 }}></div>
              <span style={{ fontFamily: 'var(--font-display)', fontStretch: '87%', fontWeight: 800, fontSize: 11, letterSpacing: '.12em', textTransform: 'uppercase', color: 'var(--accent-2)' }}>3 Lineup Decisions</span>
            </div>
            <div style={{ fontSize: 12, lineHeight: 1.6 }}>
              <div style={{ marginBottom: 8 }}><strong className="accent">FLEX:</strong> Start Cook over Gibbs (matchup edge, +1.4 proj)</div>
              <div style={{ marginBottom: 8 }}><strong className="accent">TE:</strong> Bowers locked. McBride upside higher but variance ±9.</div>
              <div><strong style={{ color: 'var(--warn)' }}>CMC watch:</strong> If listed Out by Saturday, Cook moves to RB2 and Achane to FLEX.</div>
            </div>
            <button className="btn ai sm" style={{ marginTop: 12 }}>Apply suggestions</button>
          </div>
          <div className="card">
            <div className="card-head">
              <div className="card-title">
                News Affecting {ownerName}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                {newsLoading && <span className="mono faint" style={{ fontSize: 9 }}>fetching…</span>}
                {sleeperOn && !newsLoading && liveNewsItems.length > 0 && (
                  <span style={{ fontSize: 9, fontFamily: 'var(--font-mono)', color: 'var(--accent-2)', background: 'rgba(78,168,255,.1)', border: '1px solid rgba(78,168,255,.25)', borderRadius: 3, padding: '1px 5px' }}>
                    SLEEPER · LIVE
                  </span>
                )}
                {!sleeperOn && <span className="mono faint" style={{ fontSize: 9 }}>mock data</span>}
              </div>
            </div>
            <div>
              {rosterNews.length === 0 && !newsLoading && (
                <div style={{ padding: '14px 16px', fontSize: 12, color: 'var(--text-faint)' }}>No news for your rostered players.</div>
              )}
              {newsLoading && rosterNews.length === 0 && (
                <div style={{ padding: '14px 16px', fontSize: 12, color: 'var(--text-faint)', display: 'flex', alignItems: 'center', gap: 8 }}>
                  <div className="ai-orb" style={{ width: 12, height: 12 }} />
                  Checking Sleeper for roster news…
                </div>
              )}
              {rosterNews.map(n => {
                const p = findPlayer(n.playerId);
                if (!p) return null;
                const impactColor = n.impact === 'high' ? 'var(--danger)' : n.impact === 'good' ? 'var(--good)' : n.impact === 'med' ? 'var(--warn)' : 'var(--text-faint)';
                return (
                  <div
                    key={n.id}
                    style={{
                      padding: '10px 14px',
                      borderBottom: '1px solid var(--border)',
                      fontSize: 12,
                      cursor: 'pointer',
                      borderLeft: n.live ? `2px solid ${impactColor}` : undefined,
                    }}
                    onClick={() => onOpenPlayer(p.id)}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 3 }}>
                      <span className="mono dim" style={{ fontSize: 11 }}>{p.name} · {p.pos} · {p.team}</span>
                      <div style={{ display: 'flex', gap: 5, alignItems: 'center' }}>
                        {n.live && (
                          <span style={{ fontSize: 8, fontFamily: 'var(--font-mono)', color: 'var(--accent-2)' }}>LIVE</span>
                        )}
                        <span className={`news-impact impact-${n.impact}`} style={{ fontSize: 9 }}>{n.impact}</span>
                      </div>
                    </div>
                    <div style={{ fontWeight: 600, marginBottom: n.body ? 3 : 0 }}>{n.title}</div>
                    {n.body && <div className="dim" style={{ fontSize: 11, lineHeight: 1.4 }}>{n.body}</div>}
                    <div className="mono faint" style={{ fontSize: 9, marginTop: 4 }}>{n.source}</div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
      <div style={{ padding: '0 24px 24px' }}>
        <div className="card">
          <div className="card-head">
            <div className="card-title">League Standings · {weekLabel}</div>
            <span className="mono faint" style={{ fontSize: 10 }}>{standings ? 'CBS · live' : 'mock data'}</span>
          </div>
          <table className="data-table">
            <thead>
              <tr><th style={{ width: 32 }}>#</th><th>Team</th><th className="num">W</th><th className="num">L</th><th className="num">PF</th><th className="num">PA</th></tr>
            </thead>
            <tbody>
              {(standings || LEAGUE_TEAMS.map(t => ({ ...t, w: 0, l: 0, pf: 0, pa: 0 }))).map((row, i) => (
                <tr key={row.id || i} style={row.me ? { background: 'rgba(198,255,58,.04)' } : {}}>
                  <td className="mono dim" style={{ fontSize: 12 }}>{i + 1}</td>
                  <td>
                    <div className="flex gap-8" style={{ alignItems: 'center' }}>
                      <span className="logo" style={{ background: row.color, width: 22, height: 22, fontSize: 8 }}>{row.logo}</span>
                      <span style={row.me ? { color: 'var(--accent)', fontWeight: 700 } : {}}>{row.name}</span>
                      {row.me && <span className="mono faint" style={{ fontSize: 9 }}>YOU</span>}
                    </div>
                  </td>
                  <td className="num mono" style={{ fontWeight: 700 }}>{row.w}</td>
                  <td className="num mono dim">{row.l}</td>
                  <td className="num mono">{typeof row.pf === 'number' && row.pf > 0 ? row.pf.toFixed(1) : '—'}</td>
                  <td className="num mono dim">{typeof row.pa === 'number' && row.pa > 0 ? row.pa.toFixed(1) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
