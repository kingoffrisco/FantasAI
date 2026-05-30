import React from 'react';
import { PLAYERS, findPlayer, MY_ROSTER, DRAFT_PICKS, TEAM_ROSTERS, findTeam, NFL_TEAMS, NEWS, SOURCE_META, FREE_DATA_SOURCES, RANKING_SOURCES, buildRosterFrame, assignRoster } from '../lib/data.js';

const FREE_DATA_SOURCES_LIST = FREE_DATA_SOURCES.map(s => ({ id: s.id, name: s.name, defaultEnabled: s.enabled }));
const FEED_NAMES = Object.fromEntries(RANKING_SOURCES.map(s => [s.id, s.name.replace(' (ECR)', '').replace(' Fantasy', '').replace(' Sports Rankings', '').replace(' Rankings', '')]));

import { PosBadge, StatusDot, PlayerAvatar, PlayerCell, Sparkline, ProjBar, Delta, AIHint, SourceBadge, TeamLogoBadge } from '../components/ui.jsx';
import { useApi } from '../hooks.js';
import { fetchSleeperPlayerStats, getPlayerMap, fetchBulkWeekStats } from '../lib/sleeper.js';
import { api } from '../api.js';

const WORKER   = (import.meta.env?.VITE_WORKER_URL || '').replace(/\/$/, '');
const API_BASE = 'https://api.fantasai.net';

// Fields where a lower value is better (invert when normalizing)
const LOWER_IS_BETTER = new Set(['ecr', 'adp', 'tier', 'oppRank']);

function loadScoringWeights() {
  try {
    const raw = localStorage.getItem('fantasai_scoring_weights');
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

function computeSleeperScores(playerList, weights) {
  if (!weights) return {};
  // Group by position for per-position normalization
  const byPos = {};
  for (const p of playerList) {
    if (!byPos[p.pos]) byPos[p.pos] = [];
    byPos[p.pos].push(p);
  }
  // Compute min/max per feature per position
  const ranges = {};
  for (const [pos, players] of Object.entries(byPos)) {
    const posWeights = weights[pos];
    if (!posWeights) continue;
    ranges[pos] = {};
    for (const { key } of posWeights) {
      const vals = players.map(p => p[key] ?? 0);
      ranges[pos][key] = { min: Math.min(...vals), max: Math.max(...vals) };
    }
  }
  // Score each player
  const scores = {};
  for (const p of playerList) {
    const posWeights = weights[p.pos];
    if (!posWeights || !ranges[p.pos]) { scores[p.id] = 0; continue; }
    let total = 0;
    let totalWeight = 0;
    for (const { key, weight } of posWeights) {
      if (!weight) continue;
      const { min, max } = ranges[p.pos][key] || { min: 0, max: 1 };
      const span = max - min || 1;
      const raw = p[key] ?? 0;
      const norm = LOWER_IS_BETTER.has(key)
        ? (max - raw) / span
        : (raw - min) / span;
      total += norm * weight;
      totalWeight += weight;
    }
    scores[p.id] = totalWeight > 0 ? total / totalWeight : 0;
  }
  return scores;
}

function formatWaiverExpiry(isoStr) {
  const d   = new Date(isoStr);
  const now = new Date();
  const diffH = (d - now) / 3_600_000;
  if (diffH < 24) return `Tonight ${d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`;
  const tomorrow = new Date(now); tomorrow.setDate(tomorrow.getDate() + 1);
  if (d.toDateString() === tomorrow.toDateString()) return 'Tomorrow night';
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

// Build once — maps playerId → owning teamId from the base roster data
const PLAYER_OWNER_MAP = (() => {
  const map = {};
  for (const [teamId, entries] of Object.entries(TEAM_ROSTERS)) {
    for (const entry of entries) {
      if (entry.playerId) map[entry.playerId] = Number(teamId);
    }
  }
  return map;
})();

export default function PlayersScreen({ onOpenPlayer, aiMode, myRosterIds = new Set(), onAddPlayer, onTradePlayer, user, watchlistIds = new Set(), onToggleWatch, waiverQueue = {} }) {
  const [pos, setPos] = React.useState('ALL');
  const [search, setSearch] = React.useState('');
  const [sort, setSort] = React.useState('proj');
  const [avail, setAvail] = React.useState('all');
  const [useSleeperSort, setUseSleeperSort] = React.useState(false);

  const sleeperWeights = React.useMemo(() => loadScoringWeights(), []);

  const [dynamicExtras, setDynamicExtras] = React.useState([]);
  React.useEffect(() => {
    api.allPlayers(2000).then(raw => {
      const arr = Array.isArray(raw) ? raw : Object.values(raw || {});
      const staticNames = new Set(PLAYERS.map(p => p.name.toLowerCase().trim()));
      const staticDstTeams = new Set(
        PLAYERS.filter(p => p.pos === 'DST').map(p => p.team.toUpperCase())
      );
      const extras = [];
      for (const p of arr) {
        if (!p.team || p.status === 'Inactive') continue;
        let name;
        if (p.position === 'DEF') {
          const t = p.team.toUpperCase();
          if (staticDstTeams.has(t)) continue;
          name = `${t} DST`;
        } else {
          name = (p.full_name || `${p.first_name || ''} ${p.last_name || ''}`).trim();
          if (!name || staticNames.has(name.toLowerCase())) continue;
        }
        const pos = p.position === 'DEF' ? 'DST' : (p.position || '');
        if (!['QB', 'RB', 'WR', 'TE', 'K', 'DST'].includes(pos)) continue;
        extras.push({
          id: p.player_id || p.id || name,
          name,
          pos,
          team: p.team,
          opp: '', oppRank: 0,
          status: p.injury_status === 'Questionable' ? 'Q'
                : p.injury_status === 'Doubtful'      ? 'D'
                : p.injury_status === 'Out'            ? 'Out'
                : p.injury_status === 'Injured_Reserve' ? 'IR'
                : 'OK',
          proj: 0, last: 0, avg: 0,
          trend: [0, 0, 0, 0, 0, 0],
          owned: 0, adp: 999, ecr: 999, tier: 0,
          num: p.number || 0, age: p.age || 0,
          news: '',
        });
      }
      setDynamicExtras(extras);
    }).catch(() => {});
  }, []);

  const allPlayersList = React.useMemo(() => [...PLAYERS, ...dynamicExtras], [dynamicExtras]);

  const sleeperScores  = React.useMemo(
    () => useSleeperSort ? computeSleeperScores(allPlayersList, sleeperWeights) : {},
    [useSleeperSort, sleeperWeights, allPlayersList],
  );
  const [selected, setSelected] = React.useState(null);
  const [depthData,  setDepthData]  = React.useState({});
  const [snapsData,  setSnapsData]  = React.useState({});
  const [injuryData, setInjuryData] = React.useState({});

  React.useEffect(() => {
    let cancelled = false;
    async function loadDepthAndSnaps() {
      try {
        const [map, weekStats] = await Promise.all([
          getPlayerMap(),
          fetchBulkWeekStats(2025, 18),
        ]);
        if (cancelled) return;
        const depths  = {};
        const snaps   = {};
        const injuries = {};
        for (const [sid, p] of Object.entries(map)) {
          if (!p.full_name && !p.first_name) continue;
          const name = (p.full_name || `${p.first_name} ${p.last_name}`).toLowerCase().trim();
          if (p.depth_chart_order && p.depth_chart_position) {
            depths[name] = `${p.depth_chart_position}${p.depth_chart_order}`;
          }
          if (weekStats) {
            const s = weekStats[sid];
            const snpVal = s?.off_snp ?? s?.snp;
            if (snpVal != null) snaps[name] = Math.round(snpVal);
          }
          if (p.injury_status && p.injury_status !== 'Na') {
            injuries[name] = {
              status:   p.injury_status,
              bodyPart: p.injury_body_part  || null,
              notes:    p.injury_notes      || null,
            };
          }
        }
        setDepthData(depths);
        setSnapsData(snaps);
        setInjuryData(injuries);
      } catch {
        // Sleeper unavailable — columns remain empty
      }
    }
    loadDepthAndSnaps();
    return () => { cancelled = true; };
  }, []);

  const draftedIds = new Set(DRAFT_PICKS.filter(p => p.playerId).map(p => p.playerId));

  const now = new Date();
  const activeWaivers = new Set(
    Object.entries(waiverQueue)
      .filter(([, v]) => new Date(v.expiresAt) > now)
      .map(([id]) => Number(id))
  );

  let players = allPlayersList.filter(p => {
    if (pos === 'FLEX' && !['RB', 'WR', 'TE'].includes(p.pos)) return false;
    if (pos !== 'ALL' && pos !== 'FLEX' && p.pos !== pos) return false;
    if (search && !p.name.toLowerCase().includes(search.toLowerCase())) return false;
    if (avail === 'free' && (draftedIds.has(p.id) || activeWaivers.has(p.id) || PLAYER_OWNER_MAP[p.id] != null || myRosterIds.has(p.id))) return false;
    if (avail === 'waivers' && !activeWaivers.has(p.id)) return false;
    if (avail === 'rostered' && !draftedIds.has(p.id) && !myRosterIds.has(p.id) && PLAYER_OWNER_MAP[p.id] == null) return false;
    return true;
  });

  if (useSleeperSort) {
    players.sort((a, b) => (sleeperScores[b.id] ?? 0) - (sleeperScores[a.id] ?? 0));
  } else {
    players.sort((a, b) => {
      if (sort === 'proj') return b.proj - a.proj;
      if (sort === 'last') return b.last - a.last;
      if (sort === 'avg') return b.avg - a.avg;
      if (sort === 'owned') return b.owned - a.owned;
      if (sort === 'adp') return a.adp - b.adp;
      if (sort === 'rank') return a.ecr - b.ecr;
      return 0;
    });
  }

  return (
    <div style={{ display: 'flex', height: '100%', overflow: 'hidden' }}>
    <div className="col" style={{ flex: 1, minWidth: 0, overflow: 'hidden', height: '100%' }}>
      <div className="page-head">
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          {user && <TeamLogoBadge team={user.teamId ? findTeam(user.teamId) : null} size={40} />}
          <div>
            <h1>Players</h1>
            <div className="sub">{players.length} of {allPlayersList.length} matching · Updated 2 min ago</div>
          </div>
        </div>
        <div className="flex gap-8">
          <button className="btn ghost"><span>⇣</span> Export</button>
        </div>
      </div>

      <div className="toolbar">
        <div className="chips">
          {['ALL', 'QB', 'RB', 'WR', 'TE', 'FLEX', 'K', 'DST'].map(p => (
            <div key={p} className={`chip ${pos === p ? 'accent active' : ''}`} onClick={() => setPos(p)}>{p}</div>
          ))}
        </div>
        <input className="input search" placeholder="Filter by name" value={search} onChange={e => setSearch(e.target.value)} style={{ width: 220 }} />
        <div className="chips">
          {[
            ['all', 'All'],
            ['free', 'Available'],
            ['waivers', `Waivers${activeWaivers.size > 0 ? ` (${activeWaivers.size})` : ''}`],
            ['rostered', 'Rostered'],
          ].map(([k, v]) => (
            <div key={k} className={`chip ${avail === k ? 'active' : ''}`}
              style={k === 'waivers' && activeWaivers.size > 0 ? { color: '#ff9500', borderColor: 'rgba(255,149,0,.4)' } : undefined}
              onClick={() => setAvail(k)}>{v}</div>
          ))}
        </div>
        <button
          onClick={() => setUseSleeperSort(s => !s)}
          style={{
            padding: '5px 12px', borderRadius: 6, fontSize: 12, fontWeight: 700,
            cursor: 'pointer', border: `1px solid ${useSleeperSort ? 'var(--accent)' : 'var(--border)'}`,
            background: useSleeperSort ? 'rgba(198,255,58,.12)' : 'transparent',
            color: useSleeperSort ? 'var(--accent)' : 'var(--text-dim)',
            display: 'flex', alignItems: 'center', gap: 5, flexShrink: 0,
            transition: 'all .15s',
          }}
          title={sleeperWeights ? 'Sort by your Sleeper Slider weights (Account → Sleeper tab)' : 'No Sleeper weights saved — configure them in Account → Sleeper tab'}
        >
          <span style={{ fontSize: 13 }}>😴</span>
          Sleeper Slider
          {useSleeperSort && <span style={{ fontSize: 10, fontFamily: 'var(--font-mono)', opacity: 0.8 }}>ON</span>}
          {!sleeperWeights && <span style={{ fontSize: 10, color: 'var(--warn)', fontFamily: 'var(--font-mono)' }}>!</span>}
        </button>
        <select className="input" value={sort} onChange={e => { setSort(e.target.value); setUseSleeperSort(false); }} disabled={useSleeperSort} style={{ opacity: useSleeperSort ? 0.4 : 1 }}>
          <option value="proj">Sort: Projection</option>
          <option value="last">Sort: Last Week</option>
          <option value="avg">Sort: Season Avg</option>
          <option value="owned">Sort: % Owned</option>
          <option value="adp">Sort: ADP</option>
          <option value="rank">Sort: Expert Rank</option>
        </select>
        <div className="grow"></div>
        <span className="faint mono" style={{ fontSize: 11 }}>Scoring: HALF PPR</span>
      </div>

      <div style={{ flex: 1, overflow: 'auto' }}>
        <table className="data-table">
          <thead>
            <tr>
              <th>#</th>
              <th>Player</th>
              <th>Opp</th>
              {useSleeperSort && <th className="num sorted" style={{ color: 'var(--accent)' }}>Score</th>}
              <th className={`num ${!useSleeperSort && sort === 'proj' ? 'sorted' : ''}`} onClick={() => { setSort('proj'); setUseSleeperSort(false); }}>Proj</th>
              <th className={`num ${!useSleeperSort && sort === 'last' ? 'sorted' : ''}`} onClick={() => { setSort('last'); setUseSleeperSort(false); }}>Last</th>
              <th className={`num ${!useSleeperSort && sort === 'avg' ? 'sorted' : ''}`} onClick={() => { setSort('avg'); setUseSleeperSort(false); }}>Avg</th>
              <th className="num">Trend</th>
              <th className={`num ${!useSleeperSort && sort === 'owned' ? 'sorted' : ''}`} onClick={() => { setSort('owned'); setUseSleeperSort(false); }}>%Own</th>
              <th className={`num ${!useSleeperSort && sort === 'adp' ? 'sorted' : ''}`} onClick={() => { setSort('adp'); setUseSleeperSort(false); }}>ADP</th>
              <th className="num">Depth</th>
              <th className="num">Snaps</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {players.map((p, i) => {
              const isOnMyRoster  = myRosterIds.has(p.id);
              const waiverEntry   = waiverQueue[p.id];
              const isOnWaivers   = !!(waiverEntry && new Date(waiverEntry.expiresAt) > new Date());
              const isAvail       = !draftedIds.has(p.id) && !isOnMyRoster && !isOnWaivers;
              const aiPick = aiMode !== 'subtle' ? null :
                (p.id === 65 ? 'fade — hammy' : p.id === 62 ? 'BUY' : p.id === 80 ? 'TE1 lock' : null);
              const pKey = p.name.toLowerCase();
              const depthLabel  = depthData[pKey];
              const snapCount   = snapsData[pKey];
              const injuryEntry = injuryData[pKey];
              return (
                <tr key={p.id} className={selected === p.id ? 'selected' : ''} onClick={() => setSelected(p.id)}
                  style={isOnWaivers ? { background: 'rgba(255,149,0,.04)' } : undefined}>
                  <td className="rank">{i + 1}</td>
                  <td onClick={(e) => { e.stopPropagation(); onOpenPlayer(p.id); }} style={{ cursor: 'pointer' }}>
                    <PlayerCell player={p} watched={watchlistIds.has(p.id)} />
                  </td>
                  <td>
                    <span className="mono dim" style={{ fontSize: 11 }}>vs {p.opp}</span>
                    <div className="mono faint" style={{ fontSize: 10 }}>D #{p.oppRank}</div>
                  </td>
                  {useSleeperSort && (
                    <td className="num">
                      <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 800, fontSize: 12, color: 'var(--accent)' }}>
                        {((sleeperScores[p.id] ?? 0) * 100).toFixed(0)}
                      </span>
                    </td>
                  )}
                  <td className="num">
                    <span style={{ fontWeight: 600 }}>{p.proj.toFixed(1)}</span>
                    <ProjBar value={p.proj} />
                  </td>
                  <td className="num">{p.last.toFixed(1)}</td>
                  <td className="num">{p.avg.toFixed(1)}</td>
                  <td className="num"><Sparkline data={p.trend} /></td>
                  <td className="num">{p.owned.toFixed(1)}%</td>
                  <td className="num faint">{p.adp.toFixed(1)}</td>
                  <td className="num">
                    {depthLabel
                      ? <span style={{
                          fontFamily: 'var(--font-mono)', fontSize: 11, fontWeight: 700,
                          color: depthLabel.endsWith('1') ? 'var(--accent)' : depthLabel.endsWith('2') ? 'var(--accent-2)' : 'var(--text-faint)',
                        }}>{depthLabel}</span>
                      : <span className="faint" style={{ fontSize: 11 }}>—</span>}
                  </td>
                  <td className="num mono" style={{ fontSize: 11 }}>
                    {snapCount != null ? snapCount : <span className="faint">—</span>}
                  </td>
                  <td>
                    {isOnWaivers ? (
                      <span style={{
                        display: 'inline-flex', alignItems: 'center', gap: 4,
                        fontSize: 10, fontWeight: 700, fontFamily: 'var(--font-mono)',
                        color: '#ff9500',
                        background: 'rgba(255,149,0,.12)',
                        border: '1px solid rgba(255,149,0,.35)',
                        borderRadius: 4, padding: '2px 7px', whiteSpace: 'nowrap',
                      }}>
                        ⏳ Waiver Queue · Clears {formatWaiverExpiry(waiverEntry.expiresAt)}
                      </span>
                    ) : p.status !== 'OK' ? (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                        <span className="status-pill"><StatusDot status={p.status} /> {p.status}</span>
                        {injuryEntry && (injuryEntry.bodyPart || injuryEntry.notes) && (
                          <span style={{ fontSize: 10, color: 'var(--text-faint)', lineHeight: 1.4, maxWidth: 160 }}>
                            {[injuryEntry.bodyPart, injuryEntry.notes].filter(Boolean).join(' · ')}
                          </span>
                        )}
                      </div>
                    ) : null}
                    {aiPick && <div><AIHint>{aiPick}</AIHint></div>}
                  </td>
                  <td>
                    <div className="flex gap-8" style={{ alignItems: 'center' }}>
                      <button
                        className={`btn sm icon${watchlistIds.has(p.id) ? ' watch-active' : ''}`}
                        title={watchlistIds.has(p.id) ? 'Remove from watchlist' : 'Add to watchlist'}
                        onClick={e => { e.stopPropagation(); onToggleWatch?.(p.id); }}
                      >{watchlistIds.has(p.id) ? '★' : '☆'}</button>
                      {isOnMyRoster ? (
                        <button className="btn sm success" disabled onClick={e => e.stopPropagation()}>✓ Rostered</button>
                      ) : isOnWaivers ? (() => {
                        const dropTeam = waiverEntry.teamId ? findTeam(waiverEntry.teamId) : null;
                        return (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 2, alignItems: 'flex-start' }}>
                            <span style={{
                              fontSize: 9, fontWeight: 700, fontFamily: 'var(--font-mono)',
                              color: '#ff9500', background: 'rgba(255,149,0,.12)',
                              border: '1px solid rgba(255,149,0,.35)',
                              borderRadius: 3, padding: '1px 5px', letterSpacing: '.04em',
                            }}>WAIVERS</span>
                            {dropTeam && (
                              <span style={{ fontSize: 10, color: 'var(--text-dim)', whiteSpace: 'nowrap' }}>
                                Dropped by {dropTeam.name} · {new Date(waiverEntry.droppedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                              </span>
                            )}
                          </div>
                        );
                      })() : isAvail ? (
                        <button className="btn sm primary" onClick={e => { e.stopPropagation(); onAddPlayer?.(p.id); }}>+ Add</button>
                      ) : (() => {
                        const ownerTeamId = PLAYER_OWNER_MAP[p.id];
                        const ownerTeam   = ownerTeamId ? findTeam(ownerTeamId) : null;
                        return (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 3, alignItems: 'flex-start' }}>
                            {ownerTeam && (
                              <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 10, color: 'var(--text-dim)', whiteSpace: 'nowrap' }}>
                                <span style={{ width: 7, height: 7, borderRadius: '50%', background: ownerTeam.color, flexShrink: 0, display: 'inline-block' }} />
                                {ownerTeam.name}
                              </span>
                            )}
                            <div style={{ display: 'flex', gap: 4 }}>
                              <button className="btn sm ghost" disabled onClick={e => e.stopPropagation()}
                                style={{ opacity: .65 }}>On Roster</button>
                              <button className="btn sm ghost" onClick={e => { e.stopPropagation(); onTradePlayer?.(p.id, ownerTeamId); }}
                                style={{ color: 'var(--accent-2)', borderColor: 'rgba(78,168,255,.35)' }}>Trade</button>
                            </div>
                          </div>
                        );
                      })()}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
    {user && <RosterPanel teamId={user.teamId} myRosterIds={myRosterIds} onOpenPlayer={onOpenPlayer} />}
    </div>
  );
}

// ─── RosterPanel ─────────────────────────────────────────────────────────────

function RosterPanel({ teamId, myRosterIds, onOpenPlayer }) {
  const team = findTeam(teamId);

  const rosterSettings = React.useMemo(() => {
    try { return JSON.parse(localStorage.getItem('fantasai_league_settings') || 'null'); } catch { return null; }
  }, []);

  const slotFrame  = React.useMemo(() => buildRosterFrame(rosterSettings), [rosterSettings]);
  const fullRoster = React.useMemo(
    () => assignRoster(slotFrame, myRosterIds, {}),
    [slotFrame, myRosterIds],
  );

  const starters   = fullRoster.filter(r => r.slot !== 'BENCH' && r.playerId);
  const totalProj  = starters.reduce((s, r) => s + (findPlayer(r.playerId)?.proj || 0), 0);

  return (
    <div className="roster-panel">
      <div className="roster-panel-head">
        <span className="roster-team-dot" style={{ background: team?.color || 'var(--accent)' }} />
        <div style={{ minWidth: 0 }}>
          <div className="roster-team-name">{team?.name || 'My Roster'}</div>
          <div style={{ fontSize: 10, color: 'var(--text-faint)' }}>
            Proj: <span style={{ color: 'var(--accent)', fontWeight: 600 }}>{totalProj.toFixed(1)}</span>
          </div>
        </div>
      </div>
      <div className="roster-list">
        {fullRoster.map((entry, i) => {
          const p = entry.playerId ? findPlayer(entry.playerId) : null;
          const isBench = entry.slot === 'BENCH';
          return (
            <div
              key={i}
              className={`roster-row${isBench ? ' bench' : ''}`}
              onClick={() => p && onOpenPlayer?.(p.id)}
              style={{ cursor: p ? 'pointer' : 'default' }}
            >
              <span className="roster-slot-tag">{entry.slot}</span>
              {p ? (
                <>
                  <span className="roster-name">{p.name}</span>
                  <span className="roster-team-abbr">{p.team}</span>
                  <span className="roster-proj">{p.proj.toFixed(1)}</span>
                </>
              ) : (
                <span style={{ flex: 1, fontSize: 11, color: 'var(--text-faint)' }}>Empty</span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── helpers ────────────────────────────────────────────────────────────────

function fmtStat(v, dec = 0) {
  if (v == null) return '—';
  return dec > 0 ? Number(v).toFixed(dec) : String(Math.round(v));
}

function LiveBadge() {
  return (
    <span style={{ display:'inline-flex', alignItems:'center', gap:4, fontSize:9,
      fontFamily:'var(--font-mono)', letterSpacing:'.1em', color:'var(--accent-2)',
      background:'rgba(78,168,255,.1)', border:'1px solid rgba(78,168,255,.3)',
      borderRadius:4, padding:'1px 6px', textTransform:'uppercase' }}>
      <span style={{ width:5, height:5, borderRadius:'50%', background:'var(--accent-2)',
        boxShadow:'0 0 6px var(--accent-2)', animation:'pulse 2s infinite', display:'inline-block' }}/>
      Live
    </span>
  );
}

// Position-aware game-log columns
function glCols(pos) {
  if (pos === 'QB')  return ['Att','Cmp','Yds','TD','INT','Pts'];
  if (pos === 'RB')  return ['Att','Ru Yds','Rec','Re Yds','TD','Pts'];
  if (pos === 'K')   return ['FGM','FGA','XP','Pts'];
  if (pos === 'DST') return ['Sack','INT','FR','TD','Pts'];
  return ['Snp','Tgt','Rec','Yds','TD','Pts'];  // WR / TE
}

function glRow(pos, s) {
  if (!s) return null;
  const pts = s.pts_half_ppr ?? s.pts_std;
  if (pos === 'QB')  return [fmtStat(s.pass_att), fmtStat(s.pass_cmp), fmtStat(s.pass_yd), fmtStat(s.pass_td), fmtStat(s.pass_int), fmtStat(pts, 1)];
  if (pos === 'RB')  return [fmtStat(s.rush_att), fmtStat(s.rush_yd), fmtStat(s.rec), fmtStat(s.rec_yd), fmtStat((s.rush_td||0)+(s.rec_td||0)), fmtStat(pts, 1)];
  if (pos === 'K')   return [fmtStat(s.fgm), fmtStat(s.fga), fmtStat(s.xpm), fmtStat(pts, 1)];
  if (pos === 'DST') return [fmtStat(s.sack), fmtStat(s.def_int), fmtStat(s.def_fr), fmtStat(s.def_td), fmtStat(pts, 1)];
  return [fmtStat(s.off_snp), fmtStat(s.rec_tgt), fmtStat(s.rec), fmtStat(s.rec_yd), fmtStat(s.rec_td), fmtStat(pts, 1)];
}

function SeasonStatBar({ label, val, max }) {
  const pct = Math.min(100, (val / max) * 100);
  return (
    <div style={{ marginBottom: 8 }}>
      <div className="flex" style={{ justifyContent:'space-between', marginBottom: 3 }}>
        <span className="dim" style={{ fontSize: 11 }}>{label}</span>
        <span style={{ fontFamily:'var(--font-mono)', fontSize: 12, fontWeight: 600 }}>{val ?? '—'}</span>
      </div>
      <div style={{ height: 3, background:'var(--panel-3)', borderRadius: 2 }}>
        <div style={{ width:`${pct}%`, height:'100%', background:'var(--accent-2)', borderRadius: 2, transition:'width .4s' }} />
      </div>
    </div>
  );
}

// ─── PlayerNewsCard ───────────────────────────────────────────────────────────
function PlayerNewsCard({ items = [], loading = false, playerName = '' }) {
  if (loading) {
    return (
      <div className="card">
        <div className="card-head">
          <div className="card-title">News · {playerName}</div>
        </div>
        <div style={{ padding:'12px 16px', display:'flex', alignItems:'center', gap:8 }}>
          <div className="ai-orb" style={{ width:14, height:14 }} />
          <span className="dim" style={{ fontSize:12 }}>Fetching news from all sources…</span>
        </div>
      </div>
    );
  }
  const sources = [...new Set(items.map(n => n.source))];
  return (
    <div className="card">
      <div className="card-head">
        <div className="card-title">News · {playerName}</div>
        {sources.length > 0 && (
          <div style={{ display:'flex', gap:4, flexWrap:'wrap' }}>
            {sources.map(s => <SourceBadge key={s} source={s} />)}
          </div>
        )}
      </div>
      <div className="card-body" style={{ padding:0 }}>
        {items.length === 0 ? (
          <div style={{ padding:'12px 16px', fontSize:12, color:'var(--text-faint)' }}>
            No recent news found. Try refreshing your data sources.
          </div>
        ) : items.map((n, i) => {
          const color = n.sourceColor || SOURCE_META[n.source]?.color || 'var(--accent-2)';
          const minsAgo = n.fetchedAt ? Math.round((Date.now() - n.fetchedAt) / 60000) : null;
          return (
            <div key={i} style={{ padding:'10px 16px', borderTop: i > 0 ? '1px solid var(--border)' : 'none', background: i % 2 !== 0 ? 'rgba(255,255,255,.015)' : 'transparent' }}>
              <div style={{ display:'flex', alignItems:'center', gap:6, marginBottom:5 }}>
                <span style={{ fontSize:9, fontFamily:'var(--font-mono)', fontWeight:700, padding:'2px 6px', borderRadius:3, background:`${color}22`, color, border:`1px solid ${color}55`, whiteSpace:'nowrap' }}>
                  {n.source}
                </span>
                {minsAgo != null && (
                  <span style={{ fontSize:10, color:'var(--accent)', fontFamily:'var(--font-mono)' }}>
                    {minsAgo < 1 ? 'just now' : `${minsAgo}m ago`}
                  </span>
                )}
                {n.mins != null && minsAgo == null && (
                  <span style={{ fontSize:10, color:'var(--text-faint)', fontFamily:'var(--font-mono)' }}>
                    {n.mins < 60 ? `${n.mins}m ago` : `${Math.floor(n.mins/60)}h ago`}
                  </span>
                )}
                <span style={{ flex:1 }} />
                {n.impact && n.impact !== 'low' && (
                  <span className={`news-impact impact-${n.impact}`} style={{ fontSize:9, padding:'1px 6px' }}>
                    {n.impact === 'good' ? 'BOOST' : n.impact?.toUpperCase()}
                  </span>
                )}
              </div>
              {n.title && <div style={{ fontSize:12, fontWeight:600, marginBottom:n.body ? 3 : 0, lineHeight:1.4 }}>{n.title}</div>}
              {n.body  && <div style={{ fontSize:11, color:'var(--text-dim)', lineHeight:1.6 }}>{n.body}</div>}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── PlayerDetail ─────────────────────────────────────────────────────────────

export function PlayerDetail({ player, onClose, myRosterIds = new Set(), onAddPlayer, sourcesState }) {
  if (!player) return null;
  const [activeTab, setTab] = React.useState('overview');
  const [added, setAdded] = React.useState(false);
  const [fetchedNewsItems, setFetchedNewsItems] = React.useState([]);
  const [newsLoading, setNewsLoading] = React.useState(true);

  React.useEffect(() => { setAdded(false); }, [player.id]);

  React.useEffect(() => {
    let cancelled = false;
    setFetchedNewsItems([]);
    setNewsLoading(true);
    async function fetchPlayerNews() {
      const items = [];
      const nameParts = player.name.trim().split(' ');
      const firstName = nameParts[0];
      const lastName  = nameParts.slice(1).join(' ');
      const now = Date.now();
      try {
        const [cbsRes, espnRes] = await Promise.allSettled([
          fetch(`${API_BASE}/api/v1/cbs/players`).then(r => r.ok ? r.json() : null),
          fetch(`${API_BASE}/api/v1/nfl/news?limit=50`).then(r => r.ok ? r.json() : null),
        ]);
        if (cancelled) return;

        if (cbsRes.status === 'fulfilled' && cbsRes.value?.players) {
          const fl = firstName.toLowerCase();
          const ll = lastName.toLowerCase();
          const match = cbsRes.value.players.find(p => {
            const n = (p.name || '').toLowerCase();
            return n.includes(fl) && n.includes(ll);
          });
          if (match && (match.newsTitle || match.news)) {
            items.push({
              source: 'CBS Sports',
              sourceColor: '#0d4ea2',
              title: match.newsTitle || null,
              body:  match.news     || null,
              fetchedAt: now,
              impact: /^out$/i.test(match.status||'') ? 'bad'
                : /questionable/i.test(match.status||'') ? 'medium'
                : 'low',
            });
          }
        }

        if (espnRes.status === 'fulfilled' && espnRes.value?.articles) {
          const fl = firstName.toLowerCase();
          const ll = lastName.toLowerCase();
          for (const art of espnRes.value.articles) {
            const text = `${art.headline||''} ${art.description||''}`.toLowerCase();
            if (text.includes(fl) && text.includes(ll)) {
              items.push({
                source: 'ESPN',
                sourceColor: '#cc0000',
                title: art.headline    || null,
                body:  art.description || null,
                fetchedAt: art.published ? new Date(art.published).getTime() : now,
                impact: 'low',
              });
            }
          }
        }
      } catch { /* network error — show whatever we have */ }
      if (!cancelled) {
        setFetchedNewsItems(items);
        setNewsLoading(false);
      }
    }
    fetchPlayerNews();
    return () => { cancelled = true; };
  }, [player.id]);

  const isOnRoster = myRosterIds.has(player.id);
  const sleeperEnabled = sourcesState?.freeApis?.['sleeper-api'] !== false;

  function handleAdd() {
    if (isOnRoster || added) return;
    onAddPlayer?.(player.id);
    setAdded(true);
    setTimeout(onClose, 1300);
  }

  const { data: live, loading, error } = useApi(
    () => sleeperEnabled
      ? fetchSleeperPlayerStats(player.name, player.pos)
      : Promise.resolve(null),
    [player.id, sleeperEnabled]
  );

  const hasLive = !loading && live?.found && live.weeklyStats && Object.keys(live.weeklyStats).length > 0;
  const statusFromLive = live?.status && live.status !== 'Active' ? live.status : null;

  const playerNewsItems = React.useMemo(() => {
    const items = [...fetchedNewsItems];
    if (!loading && live?.status && !['Active','OK','Na',''].includes(live.status)) {
      const isBad = ['Out','Injured_Reserve','IR','Non_Football_Injury','NFI'].includes(live.status);
      items.unshift({
        source: 'Sleeper',
        sourceColor: '#7c5cbf',
        title: `${live.status}${live.injuryBodyPart ? ` — ${live.injuryBodyPart}` : ''}`,
        body: null,
        fetchedAt: Date.now(),
        impact: isBad ? 'bad' : live.status === 'Questionable' || live.status === 'Doubtful' ? 'medium' : 'low',
      });
    }
    // Fall back to static news when live APIs returned nothing
    if (!newsLoading && items.length === 0) {
      const staticItems = NEWS.filter(n => n.playerId === player.id);
      for (const n of staticItems) {
        items.push({
          source: n.source || 'Beat Writer',
          sourceColor: '#888',
          title: n.title || null,
          body:  n.body  || null,
          mins:  n.mins  || null,
          impact: n.impact === 'high' ? 'bad' : n.impact || 'low',
        });
      }
      if (player.news && items.length === 0) {
        items.push({
          source: 'Beat Writer',
          sourceColor: '#888',
          title: player.news,
          body: player.status && player.status !== 'OK'
            ? `${player.name} listed as ${player.status}. Monitor practice reports.`
            : null,
          fetchedAt: Date.now() - 3_600_000,
          impact: player.status && player.status !== 'OK' ? 'medium' : 'low',
        });
      }
    }
    return items;
  }, [fetchedNewsItems, live, loading, newsLoading, player]);

  const sleeperAvatarUrl = live?.sleeperId
    ? `https://sleepercdn.com/avatars/${live.sleeperId}`
    : null;

  // Game log rows from live data or mock fallback
  const liveRows = hasLive
    ? Object.entries(live.weeklyStats)
        .map(([wk, s]) => ({ wk: Number(wk), s }))
        .sort((a, b) => b.wk - a.wk)
    : null;

  const mockGameLog = [
    { wk: 10, opp: player.opp,  snaps: 64, tar: 9,  rec: 6, yds: 78,  td: 1, pts: player.last },
    { wk: 9,  opp: 'BYE',       snaps:'—', tar:'—', rec:'—',yds:'—', td:'—', pts:'—' },
    { wk: 8,  opp: '@NE',       snaps: 58, tar: 7,  rec: 5, yds: 64,  td: 0, pts: player.trend[4] },
    { wk: 7,  opp: 'NYG',       snaps: 67, tar: 11, rec: 8, yds: 102, td: 1, pts: player.trend[3] },
    { wk: 6,  opp: '@SF',       snaps: 54, tar: 6,  rec: 3, yds: 41,  td: 0, pts: player.trend[2] },
    { wk: 5,  opp: 'TB',        snaps: 62, tar: 8,  rec: 6, yds: 88,  td: 1, pts: player.trend[1] },
    { wk: 4,  opp: '@DAL',      snaps: 60, tar: 5,  rec: 4, yds: 54,  td: 0, pts: player.trend[0] },
  ];

  // Season stats derived from live totals or mock
  const tot = hasLive ? live.seasonTotals : null;
  const gp  = hasLive ? live.gamesPlayed : 10;
  const liveLastPts = hasLive && live.currentWeek
    ? (live.weeklyStats[live.currentWeek] ?? live.weeklyStats[live.currentWeek - 1])?.pts_half_ppr
    : null;
  const liveAvg = tot?.pts_half_ppr != null && gp > 0 ? (tot.pts_half_ppr / gp) : null;

  return (
    <React.Fragment>
      <div className="drawer-overlay" onClick={onClose}></div>
      <div className="drawer">

        {/* ── Hero ── */}
        <div className="detail-hero">
          <PlayerAvatar player={player} size="xl" src={sleeperAvatarUrl} />
          <div>
            <div className="flex gap-8" style={{ alignItems: 'center', flexWrap: 'wrap' }}>
              <PosBadge pos={player.pos} solid />
              <span className="mono dim" style={{ fontSize: 11 }}>{player.team} · #{player.num} · Age {player.age}</span>
              {(player.status !== 'OK' || statusFromLive) &&
                <span className="status-pill"><StatusDot status={player.status} /> {statusFromLive || player.status}</span>}
              {hasLive && <LiveBadge />}
            </div>
            <h2>{player.name}</h2>
            <div className="meta">
              <span>ECR #{player.ecr}</span><span className="dot"></span>
              <span>ADP {player.adp.toFixed(1)}</span><span className="dot"></span>
              <span>Tier {player.tier}</span><span className="dot"></span>
              <span>{player.owned.toFixed(1)}% rostered</span>
            </div>
          </div>
          <div className="flex col gap-8" style={{ alignItems: 'stretch' }}>
            {isOnRoster || added ? (
              <button className="btn success" disabled>✓ {added ? 'Added!' : 'On Roster'}</button>
            ) : (
              <button className="btn primary" onClick={handleAdd}>+ Add to Roster</button>
            )}
            <button className="btn ghost">★ Watchlist</button>
            <button className="btn ghost icon" onClick={onClose} style={{ alignSelf: 'flex-end' }}>✕</button>
          </div>
        </div>

        {/* ── Tabs ── */}
        <div className="tabs">
          {[['overview','Overview'],['gamelog','Game Log'],['news','News'],['matchup','Matchup']].map(([k,v]) => (
            <div key={k} className={`tab ${activeTab===k?'active':''}`} onClick={() => setTab(k)}>{v}</div>
          ))}
        </div>

        <div style={{ padding: 18 }}>

          {/* ── Overview ── */}
          {activeTab === 'overview' && (
            <React.Fragment>
              <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:10, marginBottom:16 }}>
                <div className="stat">
                  <div className="k">
                    Wk {live?.currentWeek || '—'} Proj
                    {hasLive && <span style={{ marginLeft: 5, fontSize: 8, fontFamily: 'var(--font-mono)', color: 'var(--accent-2)', verticalAlign: 'middle' }}>SLEEPER</span>}
                  </div>
                  <div className="v accent">
                    {(live?.projection?.pts_half_ppr ?? live?.projection?.pts_std ?? player.proj).toFixed(1)}
                  </div>
                  <div className="sub">vs {player.opp} (D #{player.oppRank})</div>
                </div>
                <div className="stat">
                  <div className="k">Last Week</div>
                  <div className="v">{(liveLastPts ?? player.last).toFixed(1)}</div>
                  <div className="sub"><Delta from={liveAvg ?? player.avg} to={liveLastPts ?? player.last} /> vs avg</div>
                </div>
                <div className="stat">
                  <div className="k">Season Avg</div>
                  <div className="v">{(liveAvg ?? player.avg).toFixed(1)}</div>
                  <div className="sub">{gp} games {hasLive ? <LiveBadge /> : 'played'}</div>
                </div>
                <div className="stat">
                  <div className="k">6-Wk Trend</div>
                  <div className="v"><Sparkline data={player.trend} width={80} height={28} /></div>
                  <div className="sub mono">{player.trend.join(' · ')}</div>
                </div>
              </div>

              {/* Season Stats */}
              {loading && (
                <div className="muted-card" style={{ marginBottom:16, padding:14, display:'flex', alignItems:'center', gap:10 }}>
                  <div className="ai-orb" style={{ width:16, height:16 }} />
                  <span className="dim" style={{ fontSize:12 }}>Fetching live stats from Sleeper…</span>
                </div>
              )}
              {!loading && error && (
                <div className="muted-card" style={{ marginBottom:16, padding:'10px 14px', borderLeft:'3px solid var(--border-strong)' }}>
                  <span className="dim" style={{ fontSize:11 }}>
                    Sleeper API error — showing projected data.{' '}
                    <span className="mono faint" style={{ fontSize:10 }}>{String(error)}</span>
                  </span>
                </div>
              )}
              {!loading && !error && !hasLive && !sleeperEnabled && (
                <div className="muted-card" style={{ marginBottom:16, padding:'10px 14px', borderLeft:'3px solid var(--border)' }}>
                  <span className="dim" style={{ fontSize:11 }}>
                    Sleeper API is disabled — showing projected data.{' '}
                    <span className="mono faint" style={{ fontSize:10 }}>Enable in Sources → Free Data APIs</span>
                  </span>
                </div>
              )}
              {hasLive && tot && (
                <div className="card" style={{ marginBottom:16 }}>
                  <div className="card-head">
                    <div className="card-title">2025 Season Stats</div>
                    <div style={{ display:'flex', alignItems:'center', gap:6 }}>
                      <LiveBadge />
                      <span className="mono faint" style={{ fontSize:9 }}>Sleeper API · direct</span>
                    </div>
                  </div>
                  <div className="card-body" style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'0 24px' }}>
                    {player.pos === 'QB' && <>
                      <SeasonStatBar label="Pass Yards"  val={Math.round(tot.pass_yd  || 0)} max={5000} />
                      <SeasonStatBar label="Pass TDs"    val={Math.round(tot.pass_td  || 0)} max={50}   />
                      <SeasonStatBar label="Completions" val={Math.round(tot.pass_cmp || 0)} max={400}  />
                      <SeasonStatBar label="INTs"        val={Math.round(tot.pass_int || 0)} max={20}   />
                      <SeasonStatBar label="Rush Yards"  val={Math.round(tot.rush_yd  || 0)} max={800}  />
                      <SeasonStatBar label="Fantasy Pts" val={fmtStat(tot.pts_half_ppr,1)} max={400}  />
                    </>}
                    {player.pos === 'RB' && <>
                      <SeasonStatBar label="Rush Attempts" val={Math.round(tot.rush_att || 0)} max={300} />
                      <SeasonStatBar label="Rush Yards"    val={Math.round(tot.rush_yd  || 0)} max={1800}/>
                      <SeasonStatBar label="Rush TDs"      val={Math.round(tot.rush_td  || 0)} max={20}  />
                      <SeasonStatBar label="Receptions"    val={Math.round(tot.rec      || 0)} max={100} />
                      <SeasonStatBar label="Rec Yards"     val={Math.round(tot.rec_yd   || 0)} max={800} />
                      <SeasonStatBar label="Fantasy Pts"   val={fmtStat(tot.pts_half_ppr,1)} max={350}  />
                    </>}
                    {(player.pos === 'WR' || player.pos === 'TE') && <>
                      <SeasonStatBar label="Targets"     val={Math.round(tot.rec_tgt || 0)} max={200} />
                      <SeasonStatBar label="Receptions"  val={Math.round(tot.rec     || 0)} max={150} />
                      <SeasonStatBar label="Rec Yards"   val={Math.round(tot.rec_yd  || 0)} max={1800}/>
                      <SeasonStatBar label="Rec TDs"     val={Math.round(tot.rec_td  || 0)} max={20}  />
                      <SeasonStatBar label="Catch %"     val={tot.rec_tgt > 0 ? fmtStat((tot.rec/tot.rec_tgt)*100,1)+'%' : '—'} max={100} />
                      <SeasonStatBar label="Fantasy Pts" val={fmtStat(tot.pts_half_ppr,1)} max={350}  />
                    </>}
                  </div>
                </div>
              )}

              {/* Sources strip */}
              {sourcesState && (
                <div style={{ marginBottom:14, display:'flex', flexWrap:'wrap', gap:6, alignItems:'center' }}>
                  <span className="mono faint" style={{ fontSize:10, letterSpacing:'.08em' }}>DATA SOURCES</span>
                  {FREE_DATA_SOURCES_LIST.map(s => {
                    const on = sourcesState.freeApis?.[s.id] !== false && sourcesState.freeApis?.[s.id] !== undefined
                      ? sourcesState.freeApis[s.id]
                      : s.defaultEnabled;
                    return (
                      <span key={s.id} style={{
                        display:'inline-flex', alignItems:'center', gap:4, fontSize:10,
                        fontFamily:'var(--font-mono)', padding:'2px 7px', borderRadius:4,
                        background: on ? 'rgba(78,168,255,.1)' : 'var(--panel-2)',
                        border: `1px solid ${on ? 'rgba(78,168,255,.35)' : 'var(--border)'}`,
                        color: on ? 'var(--accent-2)' : 'var(--text-faint)',
                      }}>
                        <span style={{ width:5, height:5, borderRadius:'50%', background: on ? 'var(--accent-2)' : 'var(--text-faint)', display:'inline-block', flexShrink:0 }} />
                        {s.name}{on ? ' · live' : ' · off'}
                      </span>
                    );
                  })}
                  {Object.entries(sourcesState.feeds || {}).filter(([,v]) => v.enabled).slice(0, 4).map(([id]) => {
                    const name = FEED_NAMES[id] || id;
                    return (
                      <span key={id} style={{
                        fontSize:10, fontFamily:'var(--font-mono)', padding:'2px 7px', borderRadius:4,
                        background:'rgba(198,255,58,.07)', border:'1px solid rgba(198,255,58,.2)',
                        color:'var(--accent)',
                      }}>{name}</span>
                    );
                  })}
                  {Object.entries(sourcesState.feeds || {}).filter(([,v]) => v.enabled).length > 4 && (
                    <span className="faint mono" style={{ fontSize:10 }}>
                      +{Object.entries(sourcesState.feeds).filter(([,v]) => v.enabled).length - 4} more
                    </span>
                  )}
                </div>
              )}

              {/* AI insight */}
              <div className="muted-card" style={{ marginBottom:16, borderLeft:'3px solid var(--accent-2)' }}>
                <div className="flex gap-8" style={{ alignItems:'center', marginBottom:8 }}>
                  <div className="ai-orb" style={{ width:20, height:20 }}></div>
                  <span style={{ fontFamily:'var(--font-display)', fontStretch:'87%', fontWeight:800, fontSize:11, letterSpacing:'.12em', textTransform:'uppercase', color:'var(--accent-2)' }}>FantasAI Insight</span>
                </div>
                <div style={{ fontSize:13, lineHeight:1.55 }}>
                  {player.proj > 18
                    ? `Lock 'em in. Matchup model loves ${player.opp.replace('@','')} — ${player.name} should see volume at depth. Proj ${player.proj.toFixed(1)} is conservative; 75th-pct is ${(player.proj*1.25).toFixed(1)}.`
                    : `Mixed signals. Volume is fine but ${player.opp.replace('@','')} has been stingy near the goal line. Floor ${(player.proj*0.6).toFixed(1)}, ceiling ${(player.proj*1.4).toFixed(1)}.`}
                </div>
              </div>

              <PlayerNewsCard items={playerNewsItems} loading={newsLoading || loading} playerName={player.name} />
            </React.Fragment>
          )}

          {/* ── Game Log ── */}
          {activeTab === 'gamelog' && (
            loading
              ? <div className="muted-card" style={{ padding:18, display:'flex', alignItems:'center', gap:10 }}>
                  <div className="ai-orb" style={{ width:16, height:16 }} />
                  <span className="dim" style={{ fontSize:12 }}>Loading game log from Sleeper…</span>
                </div>
              : liveRows
                ? <>
                    <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:10 }}>
                      <span className="dim" style={{ fontSize:11 }}>2025 Season · Half PPR</span>
                      <LiveBadge />
                      <span className="mono faint" style={{ fontSize:9 }}>Sleeper API</span>
                    </div>
                    <table className="gamelog">
                      <thead>
                        <tr>
                          <th>Wk</th>
                          {glCols(player.pos).map(c => <th key={c}>{c}</th>)}
                        </tr>
                      </thead>
                      <tbody>
                        {liveRows.map(({ wk, s }) => {
                          const cells = glRow(player.pos, s);
                          if (!cells) return null;
                          const ptsIdx = cells.length - 1;
                          return (
                            <tr key={wk}>
                              <td className="mono" style={{ color:'var(--text-faint)' }}>{wk}</td>
                              {cells.map((c, i) => (
                                <td key={i} style={i===ptsIdx ? { fontWeight:600, color:'var(--accent)' } : {}}>{c}</td>
                              ))}
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </>
                : <>
                    {error && <div className="dim" style={{ fontSize:11, marginBottom:10 }}>Live data unavailable — showing sample data.</div>}
                    <table className="gamelog">
                      <thead><tr><th>Wk</th><th>Opp</th><th>Snp</th><th>Tar</th><th>Rec</th><th>Yds</th><th>TD</th><th>Pts</th></tr></thead>
                      <tbody>
                        {mockGameLog.map(g => (
                          <tr key={g.wk}>
                            <td>{g.wk}</td><td>{g.opp}</td><td>{g.snaps}</td>
                            <td>{g.tar}</td><td>{g.rec}</td><td>{g.yds}</td><td>{g.td}</td>
                            <td style={{ fontWeight:600, color:'var(--accent)' }}>{typeof g.pts==='number' ? g.pts.toFixed(1) : g.pts}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </>
          )}

          {/* ── News ── */}
          {activeTab === 'news' && (
            <PlayerNewsCard items={playerNewsItems} loading={newsLoading || loading} playerName={player.name} />
          )}

          {/* ── Matchup ── */}
          {activeTab === 'matchup' && (
            <div>
              <div className="muted-card" style={{ marginBottom:16 }}>
                <div className="flex gap-16" style={{ justifyContent:'space-around', textAlign:'center' }}>
                  <div>
                    <div className="mono dim" style={{ fontSize:11 }}>{player.team}</div>
                    <div style={{ fontFamily:'var(--font-display)', fontStretch:'75%', fontSize:28, fontWeight:900 }}>7-3</div>
                  </div>
                  <div style={{ fontFamily:'var(--font-display)', fontStretch:'75%', fontSize:28, fontWeight:900, color:'var(--text-faint)', alignSelf:'center' }}>vs</div>
                  <div>
                    <div className="mono dim" style={{ fontSize:11 }}>{player.opp}</div>
                    <div style={{ fontFamily:'var(--font-display)', fontStretch:'75%', fontSize:28, fontWeight:900 }}>5-5</div>
                  </div>
                </div>
                <div style={{ textAlign:'center', fontSize:11, color:'var(--text-faint)', marginTop:8 }} className="mono">SUN 1:00PM ET · O/U 47.5 · {player.team} -3.5</div>
              </div>
              <div className="card-title" style={{ marginBottom:8 }}>Defense vs Position ({player.pos})</div>
              <table className="gamelog">
                <thead><tr><th>Metric</th><th>{player.opp}</th><th>NFL Avg</th><th>Rank</th></tr></thead>
                <tbody>
                  <tr><td>FP Allowed/G</td><td>{(20-player.oppRank*0.3).toFixed(1)}</td><td>15.8</td><td style={{ color:player.oppRank>20?'var(--good)':'var(--danger)' }}>#{player.oppRank}</td></tr>
                  <tr><td>Yds Allowed/G</td><td>284</td><td>241</td><td>#26</td></tr>
                  <tr><td>TDs Allowed</td><td>18</td><td>14</td><td>#28</td></tr>
                  <tr><td>Pressure %</td><td>22.4%</td><td>24.1%</td><td>#19</td></tr>
                </tbody>
              </table>
            </div>
          )}

        </div>
      </div>
    </React.Fragment>
  );
}
