import React from 'react';
import { PLAYERS, TEAM_ROSTERS, TEAMS_ORDER, findTeam, findPlayer, GAME_WEATHER } from '../lib/data.js';
import { PosBadge, StatusDot, PlayerAvatar, TeamLogoBadge } from '../components/ui.jsx';
import { useR2Waivers } from '../hooks.js';

const DEFAULT_WAIVER_ORDER = [...TEAMS_ORDER].reverse();
const FLEX_POS = new Set(['RB', 'WR', 'TE']);

function isDraftComplete() {
  try {
    const picks = JSON.parse(localStorage.getItem('fantasai_live_picks') || 'null');
    if (!Array.isArray(picks) || picks.length === 0) return false;
    return picks.every(p => p.playerId != null);
  } catch { return false; }
}

function loadWaiverOrder() {
  try {
    const saved = JSON.parse(localStorage.getItem('fantasai_waiver_order') || 'null');
    if (Array.isArray(saved) && saved.length > 0) return saved;
  } catch {}
  return [...DEFAULT_WAIVER_ORDER];
}

function nextWaiverDate(processDay) {
  const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const idx = days.indexOf(processDay);
  if (idx < 0) return null;
  const today = new Date();
  const diff = ((idx - today.getDay()) + 7) % 7 || 7;
  const d = new Date(today);
  d.setDate(today.getDate() + diff);
  d.setHours(23, 59, 0, 0);
  return d;
}

function fmtDate(d) {
  if (!d) return 'TBD';
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }) + ' · 11:59 PM ET';
}

function WeatherCell({ opp }) {
  const w = GAME_WEATHER[opp];
  if (!w) return null;
  if (w.cond === 'Dome') {
    return <div style={{ fontSize: 10, color: 'var(--text-faint)', marginTop: 2 }}>🏟️ Dome</div>;
  }
  const isAlert = w.wind >= 15 || w.temp <= 32;
  return (
    <div style={{ fontSize: 10, marginTop: 2, color: isAlert ? 'var(--warn)' : 'var(--text-faint)' }}>
      {w.icon} {w.temp}°F{w.wind > 0 ? ` · ${w.wind}mph` : ''}
    </div>
  );
}

function WaiverAIPanel({ myRosterIds, onOpenPlayer }) {
  const { data, loading } = useR2Waivers();
  const [collapsed, setCollapsed] = React.useState(false);

  if (loading) return null;
  if (!data) return null;

  const recs = Array.isArray(data) ? data : [];
  if (recs.length === 0) return null;

  const priority = recs.filter(r => r.priority === 'High' || r.priority === 'Must Add');
  const standard = recs.filter(r => r.priority !== 'High' && r.priority !== 'Must Add');

  const priorityColor = p => p === 'Must Add' ? '#ff5a6e' : p === 'High' ? 'var(--warn)' : 'var(--accent-2)';

  return (
    <div style={{ margin: '0 18px 10px', border: '1px solid rgba(78,168,255,.25)', borderRadius: 10, overflow: 'hidden', background: 'var(--panel)' }}>
      <div
        style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', cursor: 'pointer', userSelect: 'none' }}
        onClick={() => setCollapsed(c => !c)}
      >
        <div className="ai-orb" style={{ width: 11, height: 11, flexShrink: 0 }} />
        <div style={{ flex: 1, fontSize: 11, fontWeight: 800, color: 'var(--accent-2)', letterSpacing: '.03em' }}>
          Databricks AI · Waiver Targets
        </div>
        {priority.length > 0 && (
          <span style={{ fontSize: 9, fontFamily: 'var(--font-mono)', fontWeight: 700, padding: '2px 7px', borderRadius: 4, background: 'rgba(255,90,110,.12)', color: '#ff5a6e', border: '1px solid rgba(255,90,110,.3)' }}>
            {priority.length} PRIORITY
          </span>
        )}
        <span style={{ fontSize: 12, color: 'var(--text-faint)' }}>{collapsed ? '▶' : '▼'}</span>
      </div>

      {!collapsed && (
        <div style={{ borderTop: '1px solid rgba(78,168,255,.15)', padding: '8px 14px 12px', display: 'flex', flexDirection: 'column', gap: 4 }}>
          {[...priority, ...standard].map((r, i) => {
            const player = PLAYERS.find(p => p.name?.toLowerCase() === r.player_name?.toLowerCase());
            const pColor = priorityColor(r.priority);
            return (
              <div
                key={i}
                style={{ display: 'flex', alignItems: 'flex-start', gap: 8, padding: '6px 0', borderBottom: i < recs.length - 1 ? '1px solid var(--panel-3)' : 'none', cursor: player ? 'pointer' : 'default' }}
                onClick={() => player && onOpenPlayer?.(player.id)}
              >
                <span style={{ fontSize: 9, fontFamily: 'var(--font-mono)', fontWeight: 700, padding: '2px 6px', borderRadius: 3, background: `${pColor}18`, color: pColor, border: `1px solid ${pColor}40`, flexShrink: 0, marginTop: 1 }}>
                  {(r.priority || 'ADD').toUpperCase()}
                </span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                    <span style={{ fontSize: 12, fontWeight: 700 }}>{r.player_name}</span>
                    {r.position && <PosBadge pos={r.position} />}
                    {r.team && <span style={{ fontSize: 10, color: 'var(--text-dim)' }}>{r.team}</span>}
                    {r.projected_points != null && (
                      <span style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--accent)', fontWeight: 700 }}>{Number(r.projected_points).toFixed(1)} proj</span>
                    )}
                  </div>
                  {r.reason && <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 2 }}>{r.reason}</div>}
                </div>
                {r.owned_pct != null && (
                  <span style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--text-faint)', flexShrink: 0 }}>
                    {Number(r.owned_pct).toFixed(0)}% owned
                  </span>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default function WaiversScreen({ user, myRosterIds = new Set(), onAddPlayer, onDropPlayer, onOpenPlayer, sourcesState }) {
  const [posFilter, setPosFilter] = React.useState('ALL');
  const [search, setSearch]       = React.useState('');
  const [sortBy, setSortBy]       = React.useState('proj');
  const [claimPlayer, setClaimPlayer] = React.useState(null);
  const [claimDrop, setClaimDrop]     = React.useState(null);
  const [queueOpen, setQueueOpen]     = React.useState(true);
  const [addSuccess, setAddSuccess]   = React.useState(null);

  const draftDone = React.useMemo(() => isDraftComplete(), []);

  const [waiverOrder, setWaiverOrder] = React.useState(loadWaiverOrder);

  const [waiverQueue, setWaiverQueue] = React.useState(() => {
    try { return JSON.parse(localStorage.getItem('fantasai_waiver_queue') || '[]'); }
    catch { return []; }
  });

  React.useEffect(() => {
    localStorage.setItem('fantasai_waiver_queue', JSON.stringify(waiverQueue));
  }, [waiverQueue]);

  const settings = React.useMemo(() => {
    try { return JSON.parse(localStorage.getItem('fantasai_league_settings') || 'null'); } catch { return null; }
  }, []);

  const teamId        = user?.teamId || 1;
  const myPriorityIdx = waiverOrder.indexOf(teamId);
  const myWaiverPriority = myPriorityIdx >= 0 ? myPriorityIdx + 1 : waiverOrder.length + 1;
  const waiverDays    = settings?.waiverRules?.days || ['Wednesday'];
  const processDay    = waiverDays[waiverDays.length - 1] || 'Wednesday';
  const currentWeek   = settings?.currentWeek || 11;
  const nextRun       = React.useMemo(() => nextWaiverDate(processDay), [processDay]);
  const projSource    = sourcesState?.freeApis?.['sleeper-api'] ? 'Sleeper' : 'CBS';

  const allRosteredIds = React.useMemo(() => {
    const ids = new Set(
      Object.values(TEAM_ROSTERS).flatMap(r => r.map(e => e.playerId).filter(Boolean))
    );
    [...myRosterIds].forEach(id => ids.add(id));
    return ids;
  }, [myRosterIds]);

  const myQueue      = waiverQueue.filter(q => q.teamId === teamId);
  const queuedAddIds = new Set(myQueue.map(q => q.addId));

  // Auto-process waivers if the run day has passed and we haven't run yet this week
  React.useEffect(() => {
    if (!draftDone || waiverQueue.length === 0) return;
    const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const todayIdx   = new Date().getDay();
    const processIdx = days.indexOf(processDay);
    const lastRun    = localStorage.getItem('fantasai_waiver_last_run');
    const startOfWeek = new Date();
    startOfWeek.setDate(new Date().getDate() - todayIdx);
    startOfWeek.setHours(0, 0, 0, 0);
    const alreadyRan = lastRun && new Date(lastRun) > startOfWeek;
    if (!alreadyRan && processIdx >= 0 && todayIdx > processIdx) processWaivers();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function processWaivers() {
    const order  = [...waiverOrder];
    const sorted = [...waiverQueue].sort((a, b) => {
      const posA = order.indexOf(a.teamId);
      const posB = order.indexOf(b.teamId);
      return (posA < 0 ? 999 : posA) - (posB < 0 ? 999 : posB);
    });

    const granted      = new Set(); // playerIds awarded
    const teamsGranted = [];        // teamIds that won a claim, in priority order

    for (const claim of sorted) {
      if (granted.has(claim.addId)) continue;
      if (!allRosteredIds.has(claim.addId)) {
        if (claim.teamId === teamId) {
          onAddPlayer?.(claim.addId);
          if (claim.dropId) onDropPlayer?.(claim.dropId);
        }
        granted.add(claim.addId);
        if (!teamsGranted.includes(claim.teamId)) teamsGranted.push(claim.teamId);
      }
    }

    // Move teams that won a claim to the back of the waiver order
    if (teamsGranted.length > 0) {
      const remaining = order.filter(id => !teamsGranted.includes(id));
      const newOrder  = [...remaining, ...teamsGranted];
      setWaiverOrder(newOrder);
      localStorage.setItem('fantasai_waiver_order', JSON.stringify(newOrder));
    }

    setWaiverQueue([]);
    localStorage.setItem('fantasai_waiver_last_run', new Date().toISOString());
  }

  function openClaim(player) {
    setClaimPlayer(player);
    setClaimDrop(null);
  }

  function submitClaim() {
    if (!claimPlayer) return;
    if (!draftDone) {
      // Pre-draft: instant free-agent pickup
      onAddPlayer?.(claimPlayer.id);
      if (claimDrop) onDropPlayer?.(claimDrop);
      setAddSuccess(claimPlayer.name);
      setTimeout(() => setAddSuccess(null), 3000);
    } else {
      // Post-draft: enter waiver queue
      setWaiverQueue(prev => [...prev, {
        id:          Date.now(),
        teamId,
        addId:       claimPlayer.id,
        dropId:      claimDrop || null,
        priority:    myWaiverPriority,
        waiverNum:   currentWeek,
        submittedAt: new Date().toISOString(),
      }]);
    }
    setClaimPlayer(null);
    setClaimDrop(null);
  }

  function removeClaim(claimId) {
    setWaiverQueue(prev => prev.filter(c => c.id !== claimId));
  }

  const available = React.useMemo(() => {
    return PLAYERS.filter(p => {
      if (allRosteredIds.has(p.id)) return false;
      if (queuedAddIds.has(p.id)) return false;
      if (posFilter === 'FLEX' && !FLEX_POS.has(p.pos)) return false;
      if (posFilter !== 'ALL' && posFilter !== 'FLEX' && p.pos !== posFilter) return false;
      if (search && !p.name.toLowerCase().includes(search.toLowerCase())) return false;
      return true;
    }).sort((a, b) => {
      if (sortBy === 'proj')  return b.proj - a.proj;
      if (sortBy === 'last')  return b.last - a.last;
      if (sortBy === 'owned') return b.owned - a.owned;
      if (sortBy === 'adp')   return a.adp - b.adp;
      return 0;
    });
  }, [allRosteredIds, queuedAddIds, posFilter, search, sortBy]);

  const myRosterList = PLAYERS.filter(p => myRosterIds.has(p.id));

  // How many total claims exist per player (to show contention)
  const claimCountByPlayer = React.useMemo(() => {
    const counts = {};
    for (const c of waiverQueue) counts[c.addId] = (counts[c.addId] || 0) + 1;
    return counts;
  }, [waiverQueue]);

  return (
    <div className="col" style={{ height: '100%' }}>

      {/* ── Header ── */}
      <div className="page-head">
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          {user && <TeamLogoBadge team={user.teamId ? findTeam(user.teamId) : null} size={40} />}
          <div>
            <h1 style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              Waivers
              <span style={{
                fontFamily: 'var(--font-mono)', fontSize: 12, fontWeight: 400,
                background: draftDone ? 'rgba(255,215,0,.1)' : 'var(--panel-2)',
                border: `1px solid ${draftDone ? 'rgba(255,215,0,.4)' : 'var(--border)'}`,
                borderRadius: 4, padding: '2px 8px',
                color: draftDone ? 'var(--accent)' : 'var(--text-dim)',
              }}>
                {draftDone ? 'Waiver Wire' : 'Free Agency'}
              </span>
            </h1>
            <div className="sub">
              {available.length} players available
              {draftDone
                ? ` · Processes ${fmtDate(nextRun)}`
                : ' · Draft not yet complete — free pickups, no waiver process'}
            </div>
          </div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: 11, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '.1em' }}>
            {draftDone ? 'Your Waiver Priority' : 'Mode'}
          </div>
          <div style={{ fontFamily: 'var(--font-display)', fontWeight: 900, fontStretch: '75%', fontSize: 28, lineHeight: 1, color: draftDone ? 'var(--accent)' : 'var(--text-dim)' }}>
            {draftDone ? `#${myWaiverPriority}` : 'Pre-Draft'}
          </div>
        </div>
      </div>

      <WaiverAIPanel myRosterIds={myRosterIds} onOpenPlayer={onOpenPlayer} />

      {/* ── Success toast (pre-draft pickups) ── */}
      {addSuccess && (
        <div style={{ margin: '0 18px 8px', padding: '10px 14px', background: 'rgba(76,175,130,.15)', border: '1px solid #4caf82', borderRadius: 8, fontSize: 13, color: '#4caf82', fontWeight: 600 }}>
          ✓ {addSuccess} added to your roster
        </div>
      )}

      {/* ── Waiver order strip (post-draft only) ── */}
      {draftDone && (
        <div style={{ padding: '0 18px 10px', display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
          <span className="faint" style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '.1em', marginRight: 4 }}>Waiver Order:</span>
          {waiverOrder.map((tid, i) => {
            const t    = findTeam(tid);
            const isMe = tid === teamId;
            return (
              <span key={tid} style={{
                display: 'inline-flex', alignItems: 'center', gap: 4,
                background: isMe ? 'rgba(198,255,58,.15)' : 'var(--panel-2)',
                border: `1px solid ${isMe ? 'var(--accent)' : 'var(--border)'}`,
                borderRadius: 4, padding: '2px 7px', fontSize: 10,
                fontFamily: 'var(--font-mono)', color: isMe ? 'var(--accent)' : 'var(--text-dim)',
              }}>
                <span style={{ color: 'var(--text-faint)' }}>{i + 1}.</span>
                <span style={{ width: 6, height: 6, borderRadius: '50%', background: t?.color, display: 'inline-block', flexShrink: 0 }} />
                {t?.logo}
              </span>
            );
          })}
        </div>
      )}

      {/* ── My pending claims (post-draft only) ── */}
      {draftDone && myQueue.length > 0 && (
        <div style={{ margin: '0 18px 10px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--panel-2)', overflow: 'hidden' }}>
          <div
            style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 14px', cursor: 'pointer', userSelect: 'none', borderBottom: queueOpen ? '1px solid var(--border)' : 'none' }}
            onClick={() => setQueueOpen(o => !o)}
          >
            <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--warn)' }}>
              {queueOpen ? '▼' : '▶'} &nbsp;My Pending Claims ({myQueue.length}) · Processes {fmtDate(nextRun)}
            </span>
            <span style={{ fontSize: 10, color: 'var(--text-faint)' }}>Priority #{myWaiverPriority}</span>
          </div>
          {queueOpen && (
            <div style={{ padding: '6px 0' }}>
              {myQueue.map((claim, i) => {
                const addP        = findPlayer(claim.addId);
                const dropP       = claim.dropId ? findPlayer(claim.dropId) : null;
                const competitors = (claimCountByPlayer[claim.addId] || 1) - 1;
                return (
                  <div key={claim.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 14px', fontSize: 12, borderBottom: i < myQueue.length - 1 ? '1px solid var(--border)' : 'none' }}>
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-faint)', minWidth: 20 }}>#{i + 1}</span>
                    <span style={{ color: 'var(--accent)', fontWeight: 600 }}>+ {addP?.name || '?'}</span>
                    <span style={{ fontSize: 10 }}><PosBadge pos={addP?.pos} /></span>
                    {dropP
                      ? <span style={{ color: 'var(--danger)' }}>/ − {dropP.name}</span>
                      : <span className="faint" style={{ fontSize: 11 }}>/ no drop</span>}
                    {competitors > 0 && (
                      <span style={{ fontSize: 10, color: 'var(--warn)', fontFamily: 'var(--font-mono)' }}>
                        ⚠ {competitors} competing claim{competitors > 1 ? 's' : ''}
                      </span>
                    )}
                    <button
                      style={{ marginLeft: 'auto', background: 'none', border: 'none', color: 'var(--text-faint)', cursor: 'pointer', fontSize: 16, lineHeight: 1, padding: '0 4px' }}
                      onClick={() => removeClaim(claim.id)}
                      title="Remove claim"
                    >⊗</button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ── Toolbar ── */}
      <div className="toolbar">
        <div className="chips">
          {['ALL', 'QB', 'RB', 'WR', 'TE', 'K', 'DST', 'FLEX'].map(p => (
            <div key={p} className={`chip ${posFilter === p ? 'accent active' : ''}`} onClick={() => setPosFilter(p)}>{p}</div>
          ))}
        </div>
        <input className="input search" placeholder="Search players…" value={search} onChange={e => setSearch(e.target.value)} style={{ width: 200 }} />
        <select className="input" value={sortBy} onChange={e => setSortBy(e.target.value)}>
          <option value="proj">Sort: Projection</option>
          <option value="last">Sort: Last Week</option>
          <option value="owned">Sort: % Owned</option>
          <option value="adp">Sort: ADP</option>
        </select>
      </div>

      {/* ── Player table ── */}
      <div style={{ flex: 1, overflow: 'auto' }}>
        <table className="data-table">
          <thead>
            <tr>
              <th>Player</th>
              <th className="num">
                Proj
                <div style={{ fontSize: 8, fontFamily: 'var(--font-mono)', color: 'var(--accent-2)', fontWeight: 400, textTransform: 'uppercase', letterSpacing: '.06em', marginTop: 1 }}>{projSource}</div>
              </th>
              <th className="num">Last</th>
              <th className="num">Avg</th>
              <th className="num">%Own</th>
              <th className="num" title="Target share % (WR/TE only)">Tgt%</th>
              <th className="num" title="Routes run per game (WR/TE only)">Routes</th>
              <th>Opp · Weather</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {available.slice(0, 120).map(p => {
              const isRecvr    = p.pos === 'RB' || p.pos === 'WR' || p.pos === 'TE';
              const depthLabel = p.depth ? `${p.pos}${p.depth}` : null;
              const contested  = draftDone && (claimCountByPlayer[p.id] || 0) > 1;
              return (
                <tr key={p.id}>
                  <td style={{ cursor: 'pointer' }} onClick={() => onOpenPlayer?.(p.id)}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <PlayerAvatar player={p} />
                      <div>
                        <div style={{ fontWeight: 600, fontSize: 13 }}>{p.name}</div>
                        <div style={{ fontSize: 11, color: 'var(--text-faint)', display: 'flex', alignItems: 'center', gap: 5 }}>
                          <PosBadge pos={p.pos} /> {p.team} · #{p.num}
                          {depthLabel && (
                            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9, background: 'var(--panel-2)', border: '1px solid var(--border)', borderRadius: 3, padding: '1px 4px', color: 'var(--text-dim)' }}>
                              {depthLabel}
                            </span>
                          )}
                          {contested && (
                            <span style={{ fontSize: 9, color: 'var(--warn)', fontFamily: 'var(--font-mono)', fontWeight: 700 }}>⚠ CONTESTED</span>
                          )}
                        </div>
                      </div>
                    </div>
                  </td>
                  <td className="num" style={{ fontWeight: 600 }}>{p.proj.toFixed(1)}</td>
                  <td className="num">{p.last.toFixed(1)}</td>
                  <td className="num">{p.avg.toFixed(1)}</td>
                  <td className="num">{p.owned.toFixed(1)}%</td>
                  <td className="num">
                    {isRecvr && p.targetShare > 0 ? <span>{p.targetShare.toFixed(1)}%</span> : <span className="faint" style={{ fontSize: 10 }}>—</span>}
                  </td>
                  <td className="num">
                    {isRecvr && p.routes > 0 ? p.routes : <span className="faint" style={{ fontSize: 10 }}>—</span>}
                  </td>
                  <td>
                    <span className="mono dim" style={{ fontSize: 11 }}>vs {p.opp}</span>
                    <div className="mono faint" style={{ fontSize: 10 }}>D #{p.oppRank}</div>
                    <WeatherCell opp={p.opp} />
                  </td>
                  <td>
                    {p.status !== 'OK' && <span className="status-pill"><StatusDot status={p.status} /> {p.status}</span>}
                  </td>
                  <td>
                    <button className="btn sm primary" onClick={() => openClaim(p)}>
                      {draftDone ? '+ Claim' : '+ Add'}
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* ── Claim / Add modal ── */}
      {claimPlayer && (
        <div className="drawer-overlay" onClick={() => setClaimPlayer(null)}>
          <div
            style={{ position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%,-50%)', background: 'var(--panel)', border: '1px solid var(--border-strong)', borderRadius: 14, padding: 28, width: 400, maxWidth: 'calc(100vw - 32px)', zIndex: 300 }}
            onClick={e => e.stopPropagation()}
          >
            <div style={{ fontFamily: 'var(--font-display)', fontWeight: 900, fontStretch: '75%', fontSize: 16, marginBottom: 4 }}>
              {draftDone ? 'Submit Waiver Claim' : 'Add Free Agent'}
            </div>
            <div className="dim" style={{ fontSize: 12, marginBottom: 4 }}>
              {draftDone
                ? `Wk ${currentWeek} · Priority #${myWaiverPriority} · Processes ${fmtDate(nextRun)}`
                : 'Pre-draft — takes effect immediately, no waiver queue'}
            </div>

            <div style={{ fontSize: 13, marginBottom: 16, marginTop: 12 }}>
              Add <strong style={{ color: 'var(--accent)' }}>{claimPlayer.name}</strong>
              <span className="faint" style={{ marginLeft: 6 }}>
                <PosBadge pos={claimPlayer.pos} /> {claimPlayer.team}
                {claimPlayer.depth ? ` · ${claimPlayer.pos}${claimPlayer.depth}` : ''}
              </span>
            </div>

            {draftDone && claimCountByPlayer[claimPlayer.id] > 0 && (
              <div style={{ marginBottom: 12, padding: '8px 12px', background: 'rgba(255,152,0,.1)', border: '1px solid rgba(255,152,0,.3)', borderRadius: 6, fontSize: 12, color: 'var(--warn)' }}>
                ⚠ {claimCountByPlayer[claimPlayer.id]} other team{claimCountByPlayer[claimPlayer.id] > 1 ? 's are' : ' is'} also claiming this player.
                {myWaiverPriority === 1 ? ' You have top priority.' : ` Your priority is #${myWaiverPriority}.`}
              </div>
            )}

            <div style={{ fontSize: 11, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '.1em', marginBottom: 8 }}>
              Drop a player (optional)
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 200, overflowY: 'auto', marginBottom: 20 }}>
              <div className={`waiver-drop-row${claimDrop === null ? ' selected' : ''}`} onClick={() => setClaimDrop(null)}>
                <span className="dim">No drop — add only</span>
              </div>
              {myRosterList.map(p => (
                <div key={p.id} className={`waiver-drop-row${claimDrop === p.id ? ' selected' : ''}`} onClick={() => setClaimDrop(p.id)}>
                  <PosBadge pos={p.pos} />
                  <span style={{ marginLeft: 8 }}>{p.name}</span>
                  <span className="mono dim" style={{ fontSize: 10, marginLeft: 'auto' }}>{p.team}</span>
                </div>
              ))}
            </div>

            <div style={{ display: 'flex', gap: 10 }}>
              <button className="btn primary" style={{ flex: 1 }} onClick={submitClaim}>
                {draftDone ? 'Queue Claim' : 'Add to Roster'}
              </button>
              <button className="btn ghost" onClick={() => setClaimPlayer(null)}>Cancel</button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
