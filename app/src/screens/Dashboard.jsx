import React from 'react';
import { TEAM_ROSTERS, PLAYERS, findPlayer, findTeam, NEWS, LEAGUE_TEAMS, buildRosterFrame, assignRoster } from '../lib/data.js';
import { PlayerCell, StatusDot, Sparkline, PosBadge, SourceBadge } from '../components/ui.jsx';
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

// Round-robin schedule for opponent lookup (mirrors HeadToHead.jsx)
function buildRRSchedule(ids, weeks) {
  const n = ids.length;
  const schedule = [];
  for (let w = 0; w < weeks; w++) {
    const rest    = ids.slice(1);
    const rot     = w % (n - 1);
    const rotated = [...rest.slice(rot), ...rest.slice(0, rot)];
    const circle  = [ids[0], ...rotated];
    const matchups = [];
    for (let i = 0; i < n / 2; i++) matchups.push([circle[i], circle[n - 1 - i]]);
    schedule.push(matchups);
  }
  return schedule;
}
const RR_SCHEDULE = buildRRSchedule(LEAGUE_TEAMS.map(t => t.id), 14);

function getOpponent(myTeamId, weekNum) {
  if (!weekNum || weekNum < 1 || weekNum > 14) return null;
  const matchups = RR_SCHEDULE[weekNum - 1] || [];
  const match = matchups.find(([a, b]) => a === myTeamId || b === myTeamId);
  if (!match) return null;
  const oppId = match[0] === myTeamId ? match[1] : match[0];
  return LEAGUE_TEAMS.find(t => t.id === oppId) ?? null;
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

export default function Dashboard({ onNav, onOpenPlayer, user, myRosterIds = new Set(), sourcesState, slotOverrides = {}, watchlistIds = new Set() }) {
  const { data: cbsTeams } = useApi(() => api.teams(), []);
  const standings = React.useMemo(() => buildStandings(cbsTeams), [cbsTeams]);
  const currentWeek = React.useMemo(getCurrentWeek, []);
  const nextWeek    = React.useMemo(getNextWeek, []);
  const weekLabel   = currentWeek.label;
  const isOffseason = currentWeek.key === 'offseason';
  const isPre       = currentWeek.pre;

  // Load commissioner message + media + league name from league settings
  const commishData = React.useMemo(() => {
    try {
      const saved      = JSON.parse(localStorage.getItem('fantasai_league_settings') || 'null');
      const media      = JSON.parse(localStorage.getItem('fantasai_commish_media') || 'null');
      const text       = saved?.commishMessage ?? "Welcome to ATO Tau League! Use Rules & Settings → Commissioner Message to post updates for your managers.";
      const leagueName = saved?.leagueName ?? 'ATO Tau League';
      return { text, media, leagueName };
    } catch { return { text: null, media: null, leagueName: 'ATO Tau League' }; }
  }, []);

  // Resolve owner info from logged-in user
  const teamId   = user?.teamId || 1;
  const team     = findTeam(teamId);
  const ownerName = team?.owner || user?.teamName || 'Manager';
  const teamName  = team?.name || user?.teamName || 'My Team';

  // 2026 season record from live standings (0-0 until games are played)
  const myStanding = standings?.find(s => s.me) ?? null;
  const record2026 = myStanding ? `${myStanding.w}-${myStanding.l}` : '0-0';

  // Build starting lineup from league settings frame (stays in sync with CurrentRoster)
  const rosterSettings = React.useMemo(() => {
    try { return JSON.parse(localStorage.getItem('fantasai_league_settings') || 'null'); } catch { return null; }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const slotFrame  = React.useMemo(() => buildRosterFrame(rosterSettings), [rosterSettings]);
  const fullRoster = React.useMemo(
    () => assignRoster(slotFrame, myRosterIds, slotOverrides),
    [slotFrame, myRosterIds, slotOverrides],
  );

  const starters   = fullRoster.filter(r => r.slot !== 'BENCH' && r.playerId);
  const rosterIds  = new Set(fullRoster.map(r => r.playerId).filter(Boolean));
  const starterIds = new Set(starters.map(r => r.playerId).filter(Boolean));
  const totalProj  = starters.reduce((s, r) => s + (findPlayer(r.playerId)?.proj || 0), 0);

  // Roster validity (same rules as HeadToHead isRosterSet)
  const _hasSlot = slot => starters.some(r => r.slot === slot);
  const _countSlot = slot => starters.filter(r => r.slot === slot).length;
  const isValidRoster = _hasSlot('QB') && _hasSlot('DST') && _countSlot('RB') >= 1 && _countSlot('WR') >= 1
    && starters.filter(r => ['RB', 'WR', 'TE', 'FLEX'].includes(r.slot)).length >= 5;
  const hasStarterInjury = starters.some(r => findPlayer(r.playerId)?.status !== 'OK');

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

  // Build news: starters only — live Sleeper items first, mock NEWS as fallback
  const INJURY_IMPACT = { Out: 'high', IR: 'high', Doubtful: 'high', PUP: 'high', Questionable: 'med', Suspended: 'med' };
  const liveNewsItems = sleeperOn
    ? Object.entries(sleeperRosterData)
        .filter(([pid, d]) => starterIds.has(Number(pid)) && d.status && d.status !== 'Active')
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
    .filter(n => starterIds.has(n.playerId) && !livePlayerIds.has(n.playerId));

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

  // ── Champions Corner ────────────────────────────────────────────────────────
  const CHAMP_KEY   = 'fantasai_champions';
  const THIS_YEAR   = new Date().getFullYear();
  const CHAMP_YEARS = Array.from({ length: 10 }, (_, i) => THIS_YEAR - 10 + i); // 10 yr window ending THIS_YEAR-1

  const [champions, setChampions] = React.useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(CHAMP_KEY) || 'null');
      if (saved && Array.isArray(saved)) return saved;
    } catch {}
    return CHAMP_YEARS.map(yr => ({ year: yr, champion: '', asterisk: false, note: '' }));
  });
  const [editingChampions, setEditingChampions]     = React.useState(false);
  const [champDraft, setChampDraft]                 = React.useState([]);
  const [champTooltip, setChampTooltip]             = React.useState(null);
  const [championsOpen, setChampionsOpen]           = React.useState(false);
  const canEditChampions = user?.isAdmin || user?.isCommissioner;

  function startEditChampions() {
    setChampDraft(champions.map(c => ({ ...c })));
    setEditingChampions(true);
  }
  function saveChampions() {
    setChampions(champDraft);
    localStorage.setItem(CHAMP_KEY, JSON.stringify(champDraft));
    setEditingChampions(false);
  }
  function updateDraft(i, patch) {
    setChampDraft(prev => prev.map((c, idx) => idx === i ? { ...c, ...patch } : c));
  }

  return (
    <div className="col" style={{ height: '100%', overflow: 'auto' }}>
      <div className="page-head">
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 16 }}>
          <div>
            <h1>{weekLabel} Dashboard</h1>
            <div className="sub">{subLine}</div>
          </div>
          <span style={{ fontSize: 22, fontWeight: 900, color: '#FFD700', letterSpacing: '-.01em', lineHeight: 1 }}>
            {commishData.leagueName}
          </span>
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

      <div style={{ padding: '0 24px 24px', display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: 16 }}>
        <div className="card">
          <div className="card-head">
            <div>
              <div className="card-title" style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <span
                  style={{ display: 'inline-block', width: 9, height: 9, borderRadius: '50%', background: team?.color || 'var(--accent)', flexShrink: 0 }}
                />
                Starting Lineup — {teamName}
                {(() => {
                  const wkNum  = currentWeek.num;
                  const opp    = wkNum ? getOpponent(teamId, wkNum) : null;
                  const wkStr  = wkNum ? `Wk${wkNum}${opp ? ` vs ${opp.name}` : ''}` : null;
                  if (!isValidRoster) {
                    return (
                      <span style={{ fontSize: 10, fontFamily: 'var(--font-mono)', fontWeight: 700, color: '#fff', background: 'var(--danger)', borderRadius: 4, padding: '2px 7px' }}>
                        Roster Not Set{wkStr ? ` · ${wkStr}` : ''}
                      </span>
                    );
                  }
                  if (hasStarterInjury) {
                    return (
                      <span style={{ fontSize: 10, fontFamily: 'var(--font-mono)', fontWeight: 700, color: '#1a0d00', background: 'var(--warn)', borderRadius: 4, padding: '2px 7px' }}>
                        Valid Roster · Injury Watch{wkStr ? ` · ${wkStr}` : ''}
                      </span>
                    );
                  }
                  return (
                    <span style={{ fontSize: 10, fontFamily: 'var(--font-mono)', fontWeight: 700, color: '#042210', background: 'var(--good)', borderRadius: 4, padding: '2px 7px' }}>
                      Valid Roster{wkStr ? ` · ${wkStr}` : ''}
                    </span>
                  );
                })()}
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

        {/* ── Middle column: Champions Corner above Commissioner Message ── */}
        <div className="col gap-12" style={{ alignSelf: 'start' }}>

        {/* ── Champions Corner — expandable card ── */}
        <div style={{
          background: 'linear-gradient(135deg, rgba(255,215,0,.07) 0%, rgba(255,215,0,.02) 100%)',
          border: '1px solid rgba(255,215,0,.22)',
          borderRadius: 10,
          overflow: 'hidden',
          alignSelf: 'start',
        }}>
          {/* Header / toggle bar */}
          <div
            style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px', cursor: 'pointer', userSelect: 'none' }}
            onClick={() => { if (!editingChampions) setChampionsOpen(o => !o); }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
              <span style={{ fontSize: 14 }}>🏆</span>
              <span style={{ fontWeight: 900, fontSize: 11, color: '#FFD700', letterSpacing: '.07em', textTransform: 'uppercase' }}>Champions Corner</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              {canEditChampions && championsOpen && !editingChampions && (
                <button
                  className="btn ghost sm"
                  style={{ fontSize: 10, padding: '2px 8px', borderColor: 'rgba(255,215,0,.3)', color: 'rgba(255,215,0,.7)' }}
                  onClick={e => { e.stopPropagation(); startEditChampions(); }}
                >Edit</button>
              )}
              <span style={{ fontSize: 11, color: 'rgba(255,215,0,.5)', marginLeft: 2 }}>{championsOpen ? '▲' : '▼'}</span>
            </div>
          </div>

          {/* Collapsed: show most recent champion */}
          {!championsOpen && (
            <div style={{ padding: '0 14px 10px', display: 'flex', alignItems: 'center', gap: 8 }}>
              {(() => {
                const latest = [...champions].reverse().find(c => c.champion);
                return latest ? (
                  <>
                    <span style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'rgba(255,215,0,.5)' }}>{latest.year}</span>
                    <span style={{ fontSize: 12, fontWeight: 800, color: '#FFD700' }}>{latest.champion}{latest.asterisk ? '*' : ''}</span>
                  </>
                ) : (
                  <span style={{ fontSize: 11, color: 'rgba(255,255,255,.2)', fontFamily: 'var(--font-mono)' }}>No data yet</span>
                );
              })()}
              <span style={{ fontSize: 10, color: 'rgba(255,215,0,.35)', fontFamily: 'var(--font-mono)', marginLeft: 'auto' }}>Click to expand</span>
            </div>
          )}

          {/* Expanded */}
          {championsOpen && (
            <div style={{ borderTop: '1px solid rgba(255,215,0,.12)', padding: '10px 14px' }}>
              {editingChampions ? (
                <div>
                  {champions.map((c, i) => (
                    <div key={c.year} style={{ display: 'grid', gridTemplateColumns: 'auto 1fr auto', gap: 6, alignItems: 'center', marginBottom: 6 }}>
                      <span style={{ fontSize: 11, fontFamily: 'var(--font-mono)', fontWeight: 800, color: '#FFD700', minWidth: 38 }}>{c.year}</span>
                      <input
                        className="input"
                        value={c.champion}
                        onChange={e => updateDraft(i, { champion: e.target.value })}
                        placeholder="Team name…"
                        style={{ fontSize: 11, padding: '3px 7px', background: 'rgba(255,215,0,.05)', borderColor: 'rgba(255,215,0,.2)' }}
                      />
                      <label style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer', fontSize: 11, color: 'rgba(255,215,0,.6)', whiteSpace: 'nowrap' }}
                        title={c.asterisk ? c.note || 'Add a note below' : 'Mark as contested/asterisk'}>
                        <input
                          type="checkbox"
                          checked={c.asterisk}
                          onChange={e => updateDraft(i, { asterisk: e.target.checked, note: e.target.checked ? (champDraft[i]?.note || '') : '' })}
                          style={{ accentColor: '#FFD700', cursor: 'pointer' }}
                        />
                        *
                      </label>
                      {c.asterisk && (
                        <input
                          className="input"
                          value={c.note}
                          onChange={e => updateDraft(i, { note: e.target.value })}
                          placeholder="Reason for asterisk…"
                          style={{ gridColumn: '2 / 4', fontSize: 10, padding: '2px 7px', background: 'rgba(255,215,0,.04)', borderColor: 'rgba(255,215,0,.15)', marginTop: -2 }}
                        />
                      )}
                    </div>
                  ))}
                  <div style={{ display: 'flex', gap: 6, marginTop: 10 }}>
                    <button className="btn primary sm" onClick={saveChampions}>Save</button>
                    <button className="btn ghost sm" style={{ borderColor: 'rgba(255,215,0,.3)', color: 'rgba(255,215,0,.6)' }} onClick={() => setEditingChampions(false)}>Cancel</button>
                  </div>
                </div>
              ) : (
                <div>
                  {champions.map((c, i) => {
                    const hasNote = c.asterisk && c.note;
                    return (
                      <div
                        key={c.year}
                        style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0', borderBottom: i < champions.length - 1 ? '1px solid rgba(255,215,0,.07)' : 'none', position: 'relative' }}
                        onMouseEnter={() => hasNote && setChampTooltip(c.year)}
                        onMouseLeave={() => setChampTooltip(null)}
                      >
                        <span style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'rgba(255,215,0,.5)', fontWeight: 700, minWidth: 36 }}>{c.year}</span>
                        {c.champion ? (
                          <span style={{ fontSize: 12, fontWeight: 700, color: '#FFD700', flex: 1 }}>
                            {c.champion}
                            {c.asterisk && <span style={{ fontSize: 10, color: 'rgba(255,215,0,.55)', marginLeft: 1, cursor: hasNote ? 'help' : 'default' }}>*</span>}
                          </span>
                        ) : (
                          <span style={{ flex: 1, fontSize: 11, color: 'rgba(255,255,255,.15)', fontFamily: 'var(--font-mono)' }}>—</span>
                        )}
                        {champTooltip === c.year && hasNote && (
                          <div style={{
                            position: 'absolute', bottom: '110%', left: 0, zIndex: 50,
                            background: 'var(--card)', border: '1px solid rgba(255,215,0,.35)',
                            borderRadius: 6, padding: '5px 10px', whiteSpace: 'nowrap',
                            fontSize: 11, color: 'var(--text-dim)', boxShadow: '0 4px 16px rgba(0,0,0,.5)',
                            pointerEvents: 'none',
                          }}>
                            <span style={{ color: '#FFD700', fontWeight: 700, marginRight: 4 }}>*</span>{c.note}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Commissioner Message — center column */}
        <div className="card" style={{ borderLeft: '3px solid var(--accent)', alignSelf: 'start' }}>
          <div className="card-head" style={{ paddingBottom: commishData.media ? 8 : 6 }}>
            <div className="card-title" style={{ fontSize: 12 }}>
              <span style={{ marginRight: 6 }}>📢</span>Commissioner Message
            </div>
          </div>
          {commishData.media?.url && (
            <div style={{ padding: '0 16px 8px' }}>
              {commishData.media.type === 'image'
                ? <img src={commishData.media.url} alt="Commissioner media" style={{ width: '100%', maxHeight: 200, objectFit: 'cover', borderRadius: 6, display: 'block' }} />
                : <video src={commishData.media.url} controls style={{ width: '100%', maxHeight: 180, borderRadius: 6, display: 'block' }} />
              }
            </div>
          )}
          {commishData.media?.videoUrl && (() => {
            const raw = commishData.media.videoUrl;
            let embed = raw;
            try {
              const u = new URL(raw);
              if (u.hostname.includes('youtube.com') && u.searchParams.get('v'))
                embed = `https://www.youtube.com/embed/${u.searchParams.get('v')}`;
              else if (u.hostname === 'youtu.be')
                embed = `https://www.youtube.com/embed${u.pathname}`;
              else if (u.hostname.includes('vimeo.com'))
                embed = `https://player.vimeo.com/video/${u.pathname.split('/').filter(Boolean).pop()}`;
            } catch {}
            return (
              <div style={{ padding: '0 16px 8px' }}>
                <iframe
                  src={embed}
                  style={{ width: '100%', height: 180, borderRadius: 6, border: 'none', display: 'block' }}
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                  allowFullScreen
                  title="Commissioner Video"
                />
              </div>
            );
          })()}
          {commishData.text && (
            <div style={{ padding: '4px 16px 14px', fontSize: 12, color: 'var(--text-dim)', lineHeight: 1.65 }}>
              {commishData.text}
            </div>
          )}
        </div>

        </div>{/* end middle column */}

        {/* Right column: AI decisions + News */}
        <div className="col gap-12">
          {(() => {
            // Build set of all rostered player IDs across the whole league
            const allRostered = new Set(
              LEAGUE_TEAMS.flatMap(t => (TEAM_ROSTERS[t.id] || []).map(r => r.playerId).filter(Boolean))
            );
            // Watchlist players that are free agents (not on any roster)
            const watchlistAvailable = PLAYERS
              .filter(p => watchlistIds.has(p.id) && !allRostered.has(p.id))
              .sort((a, b) => b.proj - a.proj)
              .slice(0, 3);

            return (
              <div className="muted-card" style={{ borderLeft: '3px solid var(--accent-2)' }}>
                <div className="flex gap-8" style={{ alignItems: 'center', marginBottom: 8 }}>
                  <div className="ai-orb" style={{ width: 22, height: 22 }}></div>
                  <span style={{ fontFamily: 'var(--font-display)', fontStretch: '87%', fontWeight: 800, fontSize: 11, letterSpacing: '.12em', textTransform: 'uppercase', color: 'var(--accent-2)' }}>Lineup Decisions</span>
                </div>
                <div style={{ fontSize: 12, lineHeight: 1.6 }}>
                  <div style={{ marginBottom: 8 }}><strong className="accent">FLEX:</strong> Start Cook over Gibbs (matchup edge, +1.4 proj)</div>
                  <div style={{ marginBottom: 8 }}><strong className="accent">TE:</strong> Bowers locked. McBride upside higher but variance ±9.</div>
                  <div><strong style={{ color: 'var(--warn)' }}>CMC watch:</strong> If listed Out by Saturday, Cook moves to RB2 and Achane to FLEX.</div>
                </div>
                {watchlistAvailable.length > 0 && (
                  <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid var(--border)' }}>
                    <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--accent-2)', letterSpacing: '.1em', textTransform: 'uppercase', marginBottom: 6 }}>
                      ★ Watchlist · Available Now
                    </div>
                    {watchlistAvailable.map(p => (
                      <div key={p.id} onClick={() => onOpenPlayer(p.id)} style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 5, cursor: 'pointer' }}>
                        <PosBadge pos={p.pos} />
                        <span style={{ flex: 1, fontSize: 12, fontWeight: 600 }}>{p.name}</span>
                        <span style={{ fontSize: 11, color: 'var(--text-dim)' }}>{p.team}</span>
                        <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--accent)', fontFamily: 'var(--font-mono)' }}>{p.proj.toFixed(1)}</span>
                        <button className="btn primary sm" style={{ fontSize: 10, padding: '2px 7px' }} onClick={e => { e.stopPropagation(); onNav('roster'); }}>Add</button>
                      </div>
                    ))}
                  </div>
                )}
                <button className="btn ai sm" style={{ marginTop: 10 }}>Apply suggestions</button>
              </div>
            );
          })()}
          <div className="card">
            <div className="card-head">
              <div className="card-title">
                {ownerName}'s Lineup News
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
                <div style={{ padding: '14px 16px', fontSize: 12, color: 'var(--text-faint)' }}>No news for your starters — all clear.</div>
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
                    <div style={{ marginTop: 4 }}><SourceBadge source={n.source} /></div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
      <div style={{ padding: '0 24px 24px', display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 16, alignItems: 'start' }}>
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
        <WeeklyCalendar weekLabel={weekLabel} />
      </div>
    </div>
  );
}

const DAY_ORDER = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const TYPE_COLOR = { game: 'var(--accent-2)', waiver: 'var(--warn)', lock: 'var(--danger)', other: 'var(--text-faint)' };
const TYPE_LABEL = { game: 'GAME', waiver: 'WAIVER', lock: 'LOCK', other: 'EVENT' };

const DEFAULT_EVENTS = [
  { id: 'thu-tnf',   day: 'Thursday',  time: '8:20 PM ET',  label: 'Thursday Night Football', type: 'game'   },
  { id: 'sun-early', day: 'Sunday',    time: '1:00 PM ET',  label: 'Early Games',             type: 'game'   },
  { id: 'sun-late',  day: 'Sunday',    time: '4:05 PM ET',  label: 'Late Games',              type: 'game'   },
  { id: 'sun-snf',   day: 'Sunday',    time: '8:20 PM ET',  label: 'Sunday Night Football',   type: 'game'   },
  { id: 'mon-mnf',   day: 'Monday',    time: '8:15 PM ET',  label: 'Monday Night Football',   type: 'game'   },
  { id: 'wed-wvr',   day: 'Wednesday', time: '11:59 PM ET', label: 'Waivers Run',             type: 'waiver' },
  { id: 'sun-lock',  day: 'Sunday',    time: '12:55 PM ET', label: 'Lineup Lock',             type: 'lock'   },
];

function WeeklyCalendar({ weekLabel }) {
  const events = React.useMemo(() => {
    try {
      const saved = JSON.parse(localStorage.getItem('fantasai_league_settings') || 'null');
      return saved?.weeklyEvents ?? DEFAULT_EVENTS;
    } catch { return DEFAULT_EVENTS; }
  }, []);

  // Today's day of week for highlighting
  const todayDay = new Date().toLocaleDateString('en-US', { weekday: 'long' });

  const grouped = React.useMemo(() => {
    const g = {};
    for (const evt of events) {
      if (!g[evt.day]) g[evt.day] = [];
      g[evt.day].push(evt);
    }
    return g;
  }, [events]);

  const activeDays = DAY_ORDER.filter(d => grouped[d]?.length > 0);

  return (
    <div className="card" style={{ position: 'sticky', top: 0 }}>
      <div className="card-head">
        <div className="card-title">Weekly Events</div>
        <span className="mono faint" style={{ fontSize: 10 }}>{weekLabel}</span>
      </div>
      <div>
        {activeDays.map(day => {
          const isToday = day === todayDay;
          const dayEvts = [...(grouped[day] || [])].sort((a, b) => a.time.localeCompare(b.time));
          return (
            <div key={day} style={{ borderTop: '1px solid var(--border)' }}>
              <div style={{
                padding: '6px 14px 4px',
                fontSize: 10,
                fontWeight: 700,
                letterSpacing: '.1em',
                textTransform: 'uppercase',
                color: isToday ? 'var(--accent)' : 'var(--text-faint)',
                background: isToday ? 'rgba(198,255,58,.06)' : undefined,
                display: 'flex',
                alignItems: 'center',
                gap: 6,
              }}>
                {day}
                {isToday && <span style={{ fontSize: 8, background: 'var(--accent)', color: '#0a1300', borderRadius: 3, padding: '1px 5px', fontWeight: 800 }}>TODAY</span>}
              </div>
              {dayEvts.map(evt => (
                <div key={evt.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 14px 5px 18px' }}>
                  <span style={{
                    fontSize: 9,
                    fontFamily: 'var(--font-mono)',
                    fontWeight: 700,
                    color: TYPE_COLOR[evt.type] ?? TYPE_COLOR.other,
                    flexShrink: 0,
                    width: 44,
                  }}>{TYPE_LABEL[evt.type] ?? 'EVENT'}</span>
                  <span style={{ fontSize: 11, color: 'var(--text-dim)', flex: 1 }}>{evt.label}</span>
                  <span style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--text-faint)', flexShrink: 0 }}>{evt.time}</span>
                </div>
              ))}
            </div>
          );
        })}
        {activeDays.length === 0 && (
          <div style={{ padding: '14px 16px', fontSize: 12, color: 'var(--text-faint)' }}>No events — set them in Rules &amp; Settings → Schedule.</div>
        )}
      </div>
    </div>
  );
}
