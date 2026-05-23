import React from 'react';
import { TEAM_ROSTERS, PLAYERS, findPlayer, findTeam, NEWS, SLOT_ELIGIBILITY, ROSTER_CONFIG } from '../lib/data.js';
import { PosBadge, StatusDot, PlayerAvatar } from '../components/ui.jsx';
import { fetchSleeperPlayerStats } from '../lib/sleeper.js';

const SLOT_ORDER = ['QB', 'RB', 'WR', 'TE', 'FLEX', 'DST', 'BENCH'];

function canFillSlot(playerPos, targetSlot) {
  const allowed = SLOT_ELIGIBILITY[targetSlot];
  return !allowed || allowed.includes(playerPos);
}

function slotSort(a, b) {
  const ai = SLOT_ORDER.indexOf(a.slot);
  const bi = SLOT_ORDER.indexOf(b.slot);
  return (ai < 0 ? 99 : ai) - (bi < 0 ? 99 : bi);
}

function slotColor(slot) {
  if (slot === 'QB')  return 'var(--pos-qb)';
  if (slot === 'RB')  return 'var(--pos-rb)';
  if (slot === 'WR')  return 'var(--pos-wr)';
  if (slot === 'TE')  return 'var(--pos-te)';
  if (slot === 'K')   return 'var(--pos-k)';
  if (slot === 'DST') return 'var(--pos-dst)';
  if (slot === 'FLEX') return 'var(--accent-2)';
  return 'var(--text-faint)';
}

const WORKER = (import.meta.env?.VITE_WORKER_URL || '').replace(/\/$/, '');

export default function CurrentRosterScreen({ user, myRosterIds, onAddPlayer, onDropPlayer, onOpenPlayer, watchlistIds = new Set(), onToggleWatch, sourcesState, slotOverrides = {}, onSlotOverridesChange }) {
  const [dropConfirm, setDropConfirm] = React.useState(null);
  const [addFilter, setAddFilter] = React.useState('ALL');
  const [addSearch, setAddSearch] = React.useState('');
  const [tab, setTab] = React.useState('roster');
  const [dragId, setDragId] = React.useState(null);
  const [dragOver, setDragOver] = React.useState(null);

  const teamId = user?.teamId || 1;
  const team = findTeam(teamId);

  // Build full roster: base from TEAM_ROSTERS + any newly added players
  const baseRoster = TEAM_ROSTERS[teamId] || [];
  const baseIds = new Set(baseRoster.map(r => r.playerId).filter(Boolean));
  const extraIds = [...(myRosterIds || [])].filter(id => id && !baseIds.has(id));
  const fullRoster = [
    ...baseRoster,
    ...extraIds.map(id => ({ slot: 'BENCH', playerId: id })),
  ].map(entry => ({
    ...entry,
    slot: entry.playerId && slotOverrides[entry.playerId] !== undefined
      ? slotOverrides[entry.playerId]
      : entry.slot,
  })).sort(slotSort);

  // Proj totals from starters (non-bench)
  const starters = fullRoster.filter(r => r.slot !== 'BENCH' && r.playerId);
  const totalProj = starters.reduce((s, r) => s + (findPlayer(r.playerId)?.proj || 0), 0);

  const [swapError, setSwapError] = React.useState(null);
  // liveData[playerId] = { note: string|null, proj: number|null }
  const [liveData, setLiveData] = React.useState({});

  const sleeperEnabled = sourcesState?.freeApis?.['sleeper-api'] !== false;

  // Fetch live projections + injury notes for all rostered players via direct Sleeper API
  React.useEffect(() => {
    if (!sleeperEnabled) return;
    const targets = fullRoster
      .map(r => r.playerId ? findPlayer(r.playerId) : null)
      .filter(Boolean);
    if (!targets.length) return;

    Promise.allSettled(
      targets.map(p => fetchSleeperPlayerStats(p.name, p.pos))
    ).then(results => {
      const data = {};
      results.forEach((r, i) => {
        if (r.status !== 'fulfilled' || !r.value?.found) return;
        const d = r.value;
        const p = targets[i];
        const noteParts = [];
        if (d.status && d.status !== 'Active') noteParts.push(d.status);
        if (d.injuryBodyPart) noteParts.push(d.injuryBodyPart);
        const proj = d.projection?.pts_half_ppr ?? d.projection?.pts_std ?? null;
        data[p.id] = {
          note: noteParts.length ? noteParts.join(' · ') : null,
          proj: proj != null ? Number(proj) : null,
        };
      });
      if (Object.keys(data).length) setLiveData(prev => ({ ...prev, ...data }));
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sleeperEnabled, fullRoster.length]);

  function handleDragStart(e, playerId) {
    setDragId(playerId);
    e.dataTransfer.effectAllowed = 'move';
  }

  function handleDragOver(e, key) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDragOver(key);
  }

  // targetSlot: the slot being dropped onto; occupantId: the player already there (or null if empty)
  function handleDropOnSlot(e, targetSlot, occupantId) {
    e.preventDefault();
    if (!dragId || dragId === occupantId) { setDragId(null); setDragOver(null); return; }

    const dragEntry = fullRoster.find(r => r.playerId === dragId);
    if (!dragEntry) { setDragId(null); setDragOver(null); return; }

    const dragPlayer = findPlayer(dragId);

    if (!canFillSlot(dragPlayer?.pos, targetSlot)) {
      setSwapError(`${dragPlayer?.pos} can't play ${targetSlot}`);
      setTimeout(() => setSwapError(null), 2500);
      setDragId(null); setDragOver(null);
      return;
    }

    if (!occupantId) {
      onSlotOverridesChange?.({ ...slotOverrides, [dragId]: targetSlot });
    } else {
      const dropPlayer = findPlayer(occupantId);
      if (canFillSlot(dropPlayer?.pos, dragEntry.slot)) {
        onSlotOverridesChange?.({ ...slotOverrides, [dragId]: targetSlot, [occupantId]: dragEntry.slot });
      } else {
        onSlotOverridesChange?.({ ...slotOverrides, [dragId]: targetSlot, [occupantId]: 'BENCH' });
      }
    }
    setDragId(null); setDragOver(null);
  }

  function handleDragEnd() { setDragId(null); setDragOver(null); }

  // Available players for Add tab
  const rosterIds = new Set(fullRoster.map(r => r.playerId).filter(Boolean));
  const available = PLAYERS.filter(p => {
    if (rosterIds.has(p.id)) return false;
    if (addFilter !== 'ALL' && p.pos !== addFilter) return false;
    if (addSearch && !p.name.toLowerCase().includes(addSearch.toLowerCase())) return false;
    return true;
  }).sort((a, b) => b.proj - a.proj);

  // Build news feed for this roster
  const rosterPlayerIds = new Set(fullRoster.map(r => r.playerId).filter(Boolean));
  const rosterPlayers   = PLAYERS.filter(p => rosterPlayerIds.has(p.id));

  const newsHasId = new Set(NEWS.filter(n => rosterPlayerIds.has(n.playerId)).map(n => n.playerId));

  // Synthetic items from player.news text for players with non-OK status or no news entry
  const syntheticNews = rosterPlayers
    .filter(p => p.news && !newsHasId.has(p.id))
    .map((p, i) => ({
      id: `syn-${p.id}`,
      playerId: p.id,
      mins: 360 + i * 30,
      impact: p.status !== 'OK' ? 'med' : 'low',
      source: 'Beat Writer',
      title: `${p.name}: ${p.news}`,
      body: p.status !== 'OK'
        ? `${p.name} listed as ${p.status}. Monitor practice reports through the week.`
        : `No significant updates. ${p.news}.`,
      synthetic: true,
    }));

  const allRosterNews = [
    ...NEWS.filter(n => rosterPlayerIds.has(n.playerId)),
    ...syntheticNews,
  ].sort((a, b) => {
    // Injury/high-impact first, then by recency
    const aUrgent = a.impact === 'high' || (findPlayer(a.playerId)?.status !== 'OK');
    const bUrgent = b.impact === 'high' || (findPlayer(b.playerId)?.status !== 'OK');
    if (aUrgent !== bUrgent) return aUrgent ? -1 : 1;
    return a.mins - b.mins;
  });

  const injuryCount = rosterPlayers.filter(p => p.status !== 'OK').length;

  function confirmDrop(entry) {
    setDropConfirm(entry);
  }

  function executeDrop(entry) {
    onDropPlayer?.(entry.playerId);
    setDropConfirm(null);
  }

  return (
    <div className="col" style={{ height: '100%' }}>

      {/* Page header */}
      <div className="page-head">
        <div>
          <h1>Current Roster</h1>
          <div className="sub" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span
              style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: team?.color || 'var(--accent)', flexShrink: 0 }}
            />
            {team?.name || 'My Team'} · {fullRoster.length} players
          </div>
        </div>
        <div className="flex gap-8">
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: 11, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '.1em' }}>Projected</div>
            <div style={{ fontFamily: 'var(--font-display)', fontWeight: 900, fontStretch: '75%', fontSize: 24, color: 'var(--accent)', lineHeight: 1 }}>
              {totalProj.toFixed(1)}
            </div>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="tabs" style={{ padding: '0 18px' }}>
        <div className={`tab ${tab === 'roster' ? 'active' : ''}`} onClick={() => setTab('roster')}>My Roster</div>
        <div className={`tab ${tab === 'add' ? 'active' : ''}`} onClick={() => setTab('add')}>Add Player</div>
        <div className={`tab ${tab === 'news' ? 'active' : ''}`} onClick={() => setTab('news')}>
          News &amp; Updates
          {injuryCount > 0 && (
            <span style={{ marginLeft: 6, background: 'var(--danger)', color: '#fff', fontSize: 10, fontWeight: 700, padding: '1px 5px', borderRadius: 10, fontFamily: 'var(--font-mono)' }}>
              {injuryCount}
            </span>
          )}
        </div>
        <div className={`tab ${tab === 'watchlist' ? 'active' : ''}`} onClick={() => setTab('watchlist')}>
          Watchlist
          {watchlistIds.size > 0 && (
            <span style={{ marginLeft: 6, background: '#ffd700', color: '#1a1200', fontSize: 10, fontWeight: 700, padding: '1px 5px', borderRadius: 10, fontFamily: 'var(--font-mono)' }}>
              {watchlistIds.size}
            </span>
          )}
        </div>
      </div>

      {/* Roster tab */}
      {tab === 'roster' && (
        <div style={{ flex: 1, overflow: 'auto' }}>
          {swapError && (
            <div style={{
              margin: '8px 18px 0', padding: '8px 14px', borderRadius: 6,
              background: 'rgba(255,59,48,.12)', border: '1px solid rgba(255,59,48,.3)',
              color: 'var(--danger)', fontSize: 12, fontFamily: 'var(--font-mono)',
              display: 'flex', alignItems: 'center', gap: 8,
            }}>
              ✕ Invalid move — {swapError}
            </div>
          )}
          <div style={{ padding: '6px 18px 0', display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
            <span className="faint mono" style={{ fontSize: 10, marginRight: 4 }}>SLOTS</span>
            {ROSTER_CONFIG.slots.map(s => (
              <span key={s.slot} style={{
                fontSize: 10, fontFamily: 'var(--font-mono)', padding: '1px 6px', borderRadius: 4,
                background: 'var(--panel-2)', border: '1px solid var(--border)',
                color: 'var(--text-dim)',
              }}>
                {s.slot}{s.count > 1 ? `×${s.count}` : ''} <span style={{ color: 'var(--text-faint)' }}>({s.eligible.join('/')})</span>
              </span>
            ))}
            <span style={{
              fontSize: 10, fontFamily: 'var(--font-mono)', padding: '1px 6px', borderRadius: 4,
              background: 'var(--panel-2)', border: '1px solid var(--border)', color: 'var(--text-faint)',
            }}>BENCH×{ROSTER_CONFIG.bench} (any)</span>
          </div>
          <table className="data-table">
            <thead>
              <tr>
                <th>Slot</th>
                <th>Player</th>
                <th className="num" style={{ whiteSpace: 'nowrap' }}>
                  Proj
                  {sleeperEnabled && Object.keys(liveData).length > 0 && (
                    <div style={{ fontSize: 8, fontFamily: 'var(--font-mono)', color: 'var(--accent-2)', fontWeight: 400, textTransform: 'uppercase', letterSpacing: '.06em', marginTop: 1 }}>
                      Sleeper API
                    </div>
                  )}
                </th>
                <th className="num">Last</th>
                <th className="num">Avg</th>
                <th>Opp</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {fullRoster.map((entry, i) => {
                const p = entry.playerId ? findPlayer(entry.playerId) : null;
                const isBench = entry.slot === 'BENCH';
                const isDrafted = baseIds.has(entry.playerId);
                const isWatched = p && watchlistIds.has(p.id);
                const isDragging = p && dragId === p.id;
                const isDragTarget = p && dragOver === p.id;

                const emptyKey = `empty-${entry.slot}-${i}`;
                const isInjured = p && p.status !== 'OK';

                if (!p) {
                  const isEmptyTarget = dragOver === emptyKey;
                  return (
                    <tr
                      key={i}
                      onDragOver={e => handleDragOver(e, emptyKey)}
                      onDrop={e => handleDropOnSlot(e, entry.slot, null)}
                      onDragLeave={() => setDragOver(null)}
                      style={{
                        opacity: isEmptyTarget ? 1 : 0.4,
                        background: isEmptyTarget ? 'rgba(198,255,58,.07)' : undefined,
                        outline: isEmptyTarget ? '1px solid rgba(198,255,58,.3)' : undefined,
                      }}
                    >
                      <td>
                        <span className="roster-slot-tag" style={{ background: slotColor(entry.slot) }}>
                          {entry.slot}
                        </span>
                      </td>
                      <td colSpan={7} className="dim" style={{ fontSize: 12 }}>Empty slot · drop here</td>
                    </tr>
                  );
                }

                return (
                  <tr
                    key={i}
                    draggable
                    onDragStart={e => handleDragStart(e, p.id)}
                    onDragOver={e => handleDragOver(e, p.id)}
                    onDrop={e => handleDropOnSlot(e, entry.slot, p.id)}
                    onDragEnd={handleDragEnd}
                    onDragLeave={() => setDragOver(null)}
                    style={{
                      opacity: isDragging ? 0.4 : isBench ? 0.78 : 1,
                      cursor: 'grab',
                      background: isDragTarget ? 'rgba(198,255,58,.07)' : isInjured ? 'rgba(255,59,48,.04)' : undefined,
                      outline: isDragTarget ? '1px solid rgba(198,255,58,.3)' : undefined,
                    }}
                  >
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span style={{ fontSize: 12, color: 'var(--text-faint)', cursor: 'grab', paddingRight: 2 }}>⠿</span>
                        <span className="roster-slot-tag" style={{ background: slotColor(entry.slot) }}>
                          {entry.slot}
                        </span>
                      </div>
                    </td>
                    <td
                      style={{ cursor: 'pointer' }}
                      onClick={() => onOpenPlayer?.(p.id)}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <PlayerAvatar player={p} />
                        <div>
                          <div style={{ fontWeight: 600, fontSize: 13, display: 'flex', alignItems: 'center', gap: 5 }}>
                            {isWatched && <span style={{ color: '#ffd700', fontSize: 11 }}>★</span>}
                            <span style={{ color: isWatched ? '#ffd700' : isInjured ? 'var(--danger)' : undefined }}>{p.name}</span>
                          </div>
                          <div style={{ fontSize: 11, color: 'var(--text-faint)', display: 'flex', alignItems: 'center', gap: 5 }}>
                            <PosBadge pos={p.pos} /> {p.team} · #{p.num}
                            <span style={{
                              fontSize: 9, fontFamily: 'var(--font-mono)', padding: '1px 5px', borderRadius: 3,
                              background: isDrafted ? 'rgba(198,255,58,.1)' : 'rgba(78,168,255,.1)',
                              color: isDrafted ? 'var(--accent)' : 'var(--accent-2)',
                              border: `1px solid ${isDrafted ? 'rgba(198,255,58,.25)' : 'rgba(78,168,255,.25)'}`,
                            }}>
                              {isDrafted ? '⬆ Drafted' : '+ Free Agency'}
                            </span>
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="num" style={{ fontWeight: 600 }}>
                      {liveData[p.id]?.proj != null ? (
                        <span>
                          <span style={{ color: 'var(--accent-2)' }}>{liveData[p.id].proj.toFixed(1)}</span>
                          <div style={{ fontSize: 8, color: 'var(--accent-2)', fontFamily: 'var(--font-mono)', marginTop: 1 }}>LIVE</div>
                        </span>
                      ) : (
                        <span style={{ color: 'var(--accent)' }}>{p.proj.toFixed(1)}</span>
                      )}
                    </td>
                    <td className="num">{p.last.toFixed(1)}</td>
                    <td className="num">{p.avg.toFixed(1)}</td>
                    <td>
                      <span className="mono dim" style={{ fontSize: 11 }}>vs {p.opp}</span>
                      <div className="mono faint" style={{ fontSize: 10 }}>D #{p.oppRank}</div>
                    </td>
                    <td>
                      {p.status !== 'OK' && (
                        <div>
                          <span className="status-pill"><StatusDot status={p.status} /> {p.status}</span>
                          <div style={{ fontSize: 10, color: 'var(--text-faint)', marginTop: 3, lineHeight: 1.3, maxWidth: 140 }}>
                            {liveData[p.id]?.note
                              ? (
                                <span>
                                  {liveData[p.id].note}
                                  <span style={{ marginLeft: 4, color: 'var(--accent-2)', fontFamily: 'var(--font-mono)', fontSize: 8 }}>LIVE</span>
                                </span>
                              )
                              : p.news || null
                            }
                          </div>
                        </div>
                      )}
                    </td>
                    <td>
                      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                        <button
                          className={`btn sm icon${isWatched ? ' watch-active' : ''}`}
                          title={isWatched ? 'Remove from watchlist' : 'Watch'}
                          onClick={e => { e.stopPropagation(); onToggleWatch?.(p.id); }}
                        >{isWatched ? '★' : '☆'}</button>
                        {dropConfirm?.playerId === p.id ? (
                          <>
                            <button className="btn sm danger" onClick={() => executeDrop(entry)}>Confirm</button>
                            <button className="btn sm ghost" onClick={() => setDropConfirm(null)}>Cancel</button>
                          </>
                        ) : (
                          <button
                            className="btn sm ghost"
                            style={{ color: 'var(--danger)', borderColor: 'var(--danger)' }}
                            onClick={e => { e.stopPropagation(); confirmDrop(entry); }}
                          >Drop</button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Add Player tab */}
      {tab === 'add' && (
        <div className="col" style={{ flex: 1, overflow: 'hidden' }}>
          <div className="toolbar">
            <div className="chips">
              {['ALL', 'QB', 'RB', 'WR', 'TE', 'K', 'DST'].map(p => (
                <div
                  key={p}
                  className={`chip ${addFilter === p ? 'accent active' : ''}`}
                  onClick={() => setAddFilter(p)}
                >
                  {p}
                </div>
              ))}
            </div>
            <input
              className="input search"
              placeholder="Search players…"
              value={addSearch}
              onChange={e => setAddSearch(e.target.value)}
              style={{ width: 220 }}
            />
            <span className="faint mono" style={{ fontSize: 11, marginLeft: 'auto' }}>
              {available.length} available
            </span>
          </div>
          <div style={{ flex: 1, overflow: 'auto' }}>
            <table className="data-table">
              <thead>
                <tr>
                  <th>Player</th>
                  <th className="num">Proj</th>
                  <th className="num">Last</th>
                  <th className="num">Avg</th>
                  <th className="num">%Own</th>
                  <th>Opp</th>
                  <th>Status</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {available.slice(0, 60).map(p => (
                  <tr key={p.id}>
                    <td style={{ cursor: 'pointer' }} onClick={() => onOpenPlayer?.(p.id)}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <PlayerAvatar player={p} />
                        <div>
                          <div style={{ fontWeight: 600, fontSize: 13 }}>{p.name}</div>
                          <div style={{ fontSize: 11, color: 'var(--text-faint)' }}>
                            <PosBadge pos={p.pos} /> {p.team}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="num" style={{ fontWeight: 600 }}>{p.proj.toFixed(1)}</td>
                    <td className="num">{p.last.toFixed(1)}</td>
                    <td className="num">{p.avg.toFixed(1)}</td>
                    <td className="num">{p.owned.toFixed(1)}%</td>
                    <td>
                      <span className="mono dim" style={{ fontSize: 11 }}>vs {p.opp}</span>
                      <div className="mono faint" style={{ fontSize: 10 }}>D #{p.oppRank}</div>
                    </td>
                    <td>
                      {p.status !== 'OK' && (
                        <span className="status-pill"><StatusDot status={p.status} /> {p.status}</span>
                      )}
                    </td>
                    <td>
                      <div style={{ display: 'flex', gap: 6 }}>
                        <button
                          className={`btn sm icon${watchlistIds.has(p.id) ? ' watch-active' : ''}`}
                          title={watchlistIds.has(p.id) ? 'Remove from watchlist' : 'Watch'}
                          onClick={() => onToggleWatch?.(p.id)}
                        >{watchlistIds.has(p.id) ? '★' : '☆'}</button>
                        <button
                          className="btn sm primary"
                          onClick={() => onAddPlayer?.(p.id)}
                        >
                          + Add
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* News & Updates tab */}
      {tab === 'news' && (
        <div style={{ flex: 1, overflow: 'auto', padding: '12px 18px' }}>
          {/* Live API banner */}
          {sleeperEnabled && (
            <LiveRosterNews players={rosterPlayers} onOpenPlayer={onOpenPlayer} />
          )}
          {!sleeperEnabled && (
            <div style={{
              marginBottom: 10, padding: '7px 12px', borderRadius: 6,
              background: 'var(--panel-2)', border: '1px solid var(--border)',
              fontSize: 11, color: 'var(--text-faint)', display: 'flex', alignItems: 'center', gap: 8,
            }}>
              <span>Enable <strong style={{ color: 'var(--text-dim)' }}>Sleeper API</strong> in Sources to pull live player news &amp; injury updates.</span>
            </div>
          )}
          {allRosterNews.length === 0 ? (
            <div style={{ padding: '60px 24px', textAlign: 'center' }}>
              <div style={{ fontSize: 32, marginBottom: 12 }}>📰</div>
              <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 8 }}>All quiet</div>
              <div style={{ fontSize: 12, color: 'var(--text-faint)' }}>No news for your roster players right now.</div>
            </div>
          ) : (
            <>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                <span className="faint mono" style={{ fontSize: 11 }}>{allRosterNews.length} update{allRosterNews.length !== 1 ? 's' : ''} · your {rosterPlayers.length} players</span>
                {injuryCount > 0 && (
                  <span style={{ fontSize: 11, color: 'var(--danger)', fontFamily: 'var(--font-mono)', fontWeight: 700 }}>
                    ⚠ {injuryCount} injury concern{injuryCount !== 1 ? 's' : ''}
                  </span>
                )}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {allRosterNews.map(n => {
                  const p = findPlayer(n.playerId);
                  if (!p) return null;
                  const isInjured = p.status !== 'OK';
                  const impactColor = n.impact === 'high' ? 'var(--danger)' : n.impact === 'good' ? 'var(--good)' : n.impact === 'med' ? 'var(--warn)' : 'var(--text-faint)';
                  return (
                    <div
                      key={n.id}
                      className="muted-card"
                      style={{
                        borderLeft: `3px solid ${isInjured || n.impact === 'high' ? 'var(--danger)' : n.impact === 'good' ? 'var(--good)' : 'var(--border-strong)'}`,
                        cursor: 'pointer',
                      }}
                      onClick={() => onOpenPlayer?.(p.id)}
                    >
                      {/* Player row */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                        <PlayerAvatar player={p} />
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontWeight: 700, fontSize: 13, display: 'flex', alignItems: 'center', gap: 6 }}>
                            {p.name}
                            <PosBadge pos={p.pos} />
                            {isInjured && <span className="status-pill"><StatusDot status={p.status} /> {p.status}</span>}
                          </div>
                          <div style={{ fontSize: 11, color: 'var(--text-faint)' }}>{p.team} · #{p.num}</div>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <span style={{
                            fontSize: 10, fontFamily: 'var(--font-mono)', fontWeight: 700,
                            padding: '2px 6px', borderRadius: 4,
                            background: n.impact === 'high' ? 'rgba(255,59,48,.15)' : n.impact === 'good' ? 'rgba(52,199,89,.15)' : n.impact === 'med' ? 'rgba(255,149,0,.15)' : 'var(--panel-2)',
                            color: impactColor,
                          }}>
                            {n.impact.toUpperCase()}
                          </span>
                        </div>
                      </div>
                      {/* News content */}
                      <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 4, lineHeight: 1.4 }}>{n.title}</div>
                      <div style={{ fontSize: 12, color: 'var(--text-dim)', lineHeight: 1.6 }}>{n.body}</div>
                      <div style={{ marginTop: 6, display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span className="mono faint" style={{ fontSize: 10 }}>
                          {n.mins < 60 ? `${n.mins}m ago` : `${Math.floor(n.mins / 60)}h ago`}
                        </span>
                        <span className="dot" style={{ color: 'var(--text-faint)' }}></span>
                        <span className="mono faint" style={{ fontSize: 10 }}>{n.source}</span>
                        {n.synthetic && (
                          <span style={{ fontSize: 9, fontFamily: 'var(--font-mono)', color: 'var(--text-faint)', marginLeft: 4 }}>· from player status</span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>
      )}

      {/* Watchlist tab */}
      {tab === 'watchlist' && (
        <div style={{ flex: 1, overflow: 'auto' }}>
          {watchlistIds.size === 0 ? (
            <div style={{ padding: '60px 24px', textAlign: 'center' }}>
              <div style={{ fontSize: 32, marginBottom: 12, color: '#ffd700' }}>☆</div>
              <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 8 }}>No players on your watchlist</div>
              <div style={{ fontSize: 12, color: 'var(--text-faint)' }}>
                Tap ☆ on any player in the Players tab or Add Player tab to start tracking them here.
              </div>
            </div>
          ) : (
            <>
              <div style={{ padding: '8px 18px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span className="faint mono" style={{ fontSize: 11 }}>{watchlistIds.size} player{watchlistIds.size !== 1 ? 's' : ''} watched</span>
                <button
                  className="btn ghost sm"
                  style={{ fontSize: 11, color: 'var(--danger)' }}
                  onClick={() => [...watchlistIds].forEach(id => onToggleWatch?.(id))}
                >
                  Clear All
                </button>
              </div>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Player</th>
                    <th className="num">Proj</th>
                    <th className="num">Last</th>
                    <th className="num">Avg</th>
                    <th>Opp</th>
                    <th>Status</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {[...watchlistIds].map(id => {
                    const p = findPlayer(id);
                    if (!p) return null;
                    const onRoster = myRosterIds?.has(p.id);
                    return (
                      <tr key={p.id}>
                        <td style={{ cursor: 'pointer' }} onClick={() => onOpenPlayer?.(p.id)}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                            <PlayerAvatar player={p} />
                            <div>
                              <div style={{ fontWeight: 700, fontSize: 13, color: '#ffd700', display: 'flex', alignItems: 'center', gap: 5 }}>
                                <span>★</span> {p.name}
                              </div>
                              <div style={{ fontSize: 11, color: 'var(--text-faint)' }}>
                                <PosBadge pos={p.pos} /> {p.team} · #{p.num}
                              </div>
                            </div>
                          </div>
                        </td>
                        <td className="num" style={{ fontWeight: 600, color: 'var(--accent)' }}>{p.proj.toFixed(1)}</td>
                        <td className="num">{p.last.toFixed(1)}</td>
                        <td className="num">{p.avg.toFixed(1)}</td>
                        <td>
                          <span className="mono dim" style={{ fontSize: 11 }}>vs {p.opp}</span>
                          <div className="mono faint" style={{ fontSize: 10 }}>D #{p.oppRank}</div>
                        </td>
                        <td>
                          {p.status !== 'OK' && (
                            <span className="status-pill"><StatusDot status={p.status} /> {p.status}</span>
                          )}
                        </td>
                        <td>
                          <div style={{ display: 'flex', gap: 6 }}>
                            {!onRoster && (
                              <button className="btn sm primary" onClick={() => onAddPlayer?.(p.id)}>+ Add</button>
                            )}
                            <button
                              className="btn sm icon watch-active"
                              title="Remove from watchlist"
                              onClick={() => onToggleWatch?.(p.id)}
                            >★</button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </>
          )}
        </div>
      )}

    </div>
  );
}

// ─── LiveRosterNews ────────────────────────────────────────────────────────────
// Fetches live status/news for key roster players directly from Sleeper API.
// Prioritizes injured players, then top starters by projection.
function LiveRosterNews({ players, onOpenPlayer }) {
  const [items, setItems] = React.useState([]);
  const [loading, setLoading] = React.useState(true);
  const [fetched, setFetched] = React.useState(0);

  React.useEffect(() => {
    if (!players.length) { setLoading(false); return; }
    let cancelled = false;

    // Priority: injured players first, then top 5 starters by proj
    const injured  = players.filter(p => p.status !== 'OK');
    const starters = players.filter(p => p.status === 'OK').sort((a, b) => b.proj - a.proj).slice(0, 5);
    const targets  = [...injured, ...starters].slice(0, 8);

    setLoading(true);
    setItems([]);

    Promise.allSettled(
      targets.map(p =>
        fetchSleeperPlayerStats(p.name, p.pos)
          .then(data => data?.found ? { player: p, data } : null)
          .catch(() => null)
      )
    ).then(results => {
      if (cancelled) return;
      const liveItems = results
        .filter(r => r.status === 'fulfilled' && r.value)
        .map(r => r.value);
      setItems(liveItems);
      setFetched(liveItems.length);
      setLoading(false);
    });

    return () => { cancelled = true; };
  }, [players.length]);

  if (loading) {
    return (
      <div style={{
        marginBottom: 12, padding: '10px 14px', borderRadius: 6,
        background: 'rgba(78,168,255,.06)', border: '1px solid rgba(78,168,255,.2)',
        display: 'flex', alignItems: 'center', gap: 10, fontSize: 12,
      }}>
        <div className="ai-orb" style={{ width: 14, height: 14 }} />
        <span className="dim">Fetching live status from Sleeper API…</span>
      </div>
    );
  }

  if (!items.length) return null;

  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <span style={{
          display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 9,
          fontFamily: 'var(--font-mono)', color: 'var(--accent-2)',
          background: 'rgba(78,168,255,.1)', border: '1px solid rgba(78,168,255,.3)',
          borderRadius: 4, padding: '2px 7px',
        }}>
          <span style={{ width: 5, height: 5, borderRadius: '50%', background: 'var(--accent-2)', display: 'inline-block' }} />
          SLEEPER API · LIVE
        </span>
        <span className="faint mono" style={{ fontSize: 10 }}>{fetched} players synced</span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {items.map(({ player, data }) => {
          const liveStatus   = data.status && data.status !== 'Active' ? data.status : null;
          const isInjured    = player.status !== 'OK' || liveStatus;
          const lastPts      = data.weeklyStats
            ? Object.values(data.weeklyStats).at(-1)?.pts_half_ppr ?? null
            : null;
          const gp           = data.gamesPlayed || '—';
          const seasonPts    = data.seasonTotals?.pts_half_ppr;
          const avg          = seasonPts != null && data.gamesPlayed > 0
            ? (seasonPts / data.gamesPlayed).toFixed(1) : null;

          return (
            <div
              key={player.id}
              className="muted-card"
              style={{
                borderLeft: `3px solid ${isInjured ? 'var(--danger)' : 'rgba(78,168,255,.5)'}`,
                cursor: 'pointer', padding: '10px 14px',
              }}
              onClick={() => onOpenPlayer?.(player.id)}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <PlayerAvatar player={player} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 700, fontSize: 13, display: 'flex', alignItems: 'center', gap: 6 }}>
                    {player.name}
                    <PosBadge pos={player.pos} />
                    {isInjured && (
                      <span className="status-pill"><StatusDot status={player.status} /> {liveStatus || player.status}</span>
                    )}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text-faint)' }}>{player.team} · #{player.num}</div>
                </div>
                <div style={{ textAlign: 'right', fontSize: 11 }}>
                  {lastPts != null && (
                    <div><span className="faint">Last:</span> <span style={{ fontWeight: 600, color: 'var(--accent)' }}>{Number(lastPts).toFixed(1)}</span></div>
                  )}
                  {avg && (
                    <div><span className="faint">Avg:</span> <span style={{ fontWeight: 600 }}>{avg}</span></div>
                  )}
                  <div className="faint" style={{ fontSize: 10 }}>{gp} GP</div>
                </div>
              </div>
              <div style={{ marginTop: 6, fontSize: 10, color: 'var(--text-faint)', fontFamily: 'var(--font-mono)' }}>
                Sourced from Sleeper API · click to view full stats
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
