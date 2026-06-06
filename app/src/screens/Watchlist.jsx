import React from 'react';
import { WATCHLIST } from '../lib/data.js';
import { usePlayers, findPlayer } from '../lib/playerStore.js';
import { PlayerCell, Sparkline, TeamLogoBadge } from '../components/ui.jsx';
import { useR2BreakoutCandidates, useR2SleeperPicks } from '../hooks.js';

const AI_BADGE = (
  <span style={{ marginLeft: 7, fontSize: 9, background: 'rgba(78,168,255,.15)', border: '1px solid rgba(78,168,255,.3)', borderRadius: 3, padding: '1px 5px', color: '#4ea8ff', fontFamily: 'var(--font-mono)', fontWeight: 700, letterSpacing: '.06em' }}>
    AI MODEL
  </span>
);

function WatchGroup({ name, ids, onOpenPlayer }) {
  const rows = ids.map(id => findPlayer(id)).filter(Boolean);
  return (
    <div className="wl-group">
      <div className="head">
        <div className="name">{name}</div>
        <div className="ct">{rows.length} players</div>
        <div className="grow"></div>
        <button className="btn sm ghost">Compare</button>
      </div>
      <table className="data-table">
        <thead>
          <tr>
            <th>Player</th>
            <th>Opp</th>
            <th className="num">Proj</th>
            <th className="num">%Own</th>
            <th className="num">Trend</th>
            <th>Latest</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {rows.map(p => (
            <tr key={p.id} onClick={() => onOpenPlayer(p.id)} style={{ cursor: 'pointer' }}>
              <td><PlayerCell player={p} /></td>
              <td className="mono dim" style={{ fontSize: 11 }}>vs {p.opp}</td>
              <td className="num"><strong>{p.proj.toFixed(1)}</strong></td>
              <td className="num">{p.owned.toFixed(1)}%</td>
              <td className="num"><Sparkline data={p.trend} /></td>
              <td className="dim" style={{ fontSize: 11, maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.news}</td>
              <td><button className="btn sm primary" onClick={e => e.stopPropagation()}>+ Add</button></td>
            </tr>
          ))}
          {rows.length === 0 && (
            <tr><td colSpan={7} style={{ textAlign: 'center', padding: '20px', color: 'var(--text-faint)', fontSize: 12 }}>No players found</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

export default function WatchlistScreen({ onOpenPlayer, asTab = false, watchlistIds = new Set(), onToggleWatch }) {
  const allPlayers = usePlayers();
  const { data: r2Sleepers }  = useR2SleeperPicks();
  const { data: r2Breakouts } = useR2BreakoutCandidates();

  // Name → player object map for R2 name-based lookup
  const playerByName = React.useMemo(() => {
    const m = new Map();
    for (const p of allPlayers) if (p.name) m.set(p.name.toLowerCase().trim(), p);
    return m;
  }, [allPlayers]);

  // Local fallback — used when R2 file isn't written yet
  const localSleepers = React.useMemo(() => (
    allPlayers
      .filter(p => p.owned < 40 && p.proj >= 8 && ['RB', 'WR', 'TE', 'QB'].includes(p.pos))
      .sort((a, b) => (b.proj / Math.max(b.owned, 1)) - (a.proj / Math.max(a.owned, 1)))
      .slice(0, 10)
  ), [allPlayers]);

  const localBreakouts = React.useMemo(() => (
    allPlayers
      .filter(p => { const avg = p.avg || 0; return avg > 0 && p.last >= avg * 1.35 && p.proj >= 8; })
      .sort((a, b) => (b.last / Math.max(b.avg, 1)) - (a.last / Math.max(a.avg, 1)))
      .slice(0, 10)
  ), [allPlayers]);

  const useSleepersR2  = Array.isArray(r2Sleepers)  && r2Sleepers.length  > 0;
  const useBreakoutsR2 = Array.isArray(r2Breakouts) && r2Breakouts.length > 0;

  const myWatchRows = [...watchlistIds].map(id => findPlayer(id)).filter(Boolean);

  const content = (
    <div style={{ padding: asTab ? '16px 18px' : 24, maxWidth: 1200, margin: '0 auto', width: '100%' }}>

      {/* ── 1. My Watchlist ── */}
      {myWatchRows.length > 0 && (
        <div className="wl-group">
          <div className="head">
            <div className="name" style={{ color: 'var(--accent)' }}>★ My Watchlist</div>
            <div className="ct">{myWatchRows.length} players</div>
          </div>
          <table className="data-table">
            <thead>
              <tr>
                <th>Player</th>
                <th>Opp</th>
                <th className="num">Proj</th>
                <th className="num">%Own</th>
                <th className="num">Trend</th>
                <th>Latest</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {myWatchRows.map(p => (
                <tr key={p.id} onClick={() => onOpenPlayer?.(p.id)} style={{ cursor: 'pointer' }}>
                  <td><PlayerCell player={p} /></td>
                  <td className="mono dim" style={{ fontSize: 11 }}>vs {p.opp}</td>
                  <td className="num"><strong>{p.proj?.toFixed(1) ?? '—'}</strong></td>
                  <td className="num">{p.owned?.toFixed(1)}%</td>
                  <td className="num"><Sparkline data={p.trend} /></td>
                  <td className="dim" style={{ fontSize: 11, maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.news}</td>
                  <td>
                    <button className="btn sm ghost" style={{ fontSize: 10, color: 'var(--accent)', borderColor: 'var(--accent)' }} onClick={e => { e.stopPropagation(); onToggleWatch?.(p.id); }}>
                      ★ Unwatch
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ── 2. Breakouts ── */}
      <div className="wl-group" style={{ marginTop: 8 }}>
        <div className="head">
          <div className="name" style={{ color: 'var(--accent)' }}>
            Breakouts
            {useBreakoutsR2 && AI_BADGE}
          </div>
          <div className="ct">{useBreakoutsR2 ? Math.min(r2Breakouts.length, 10) : localBreakouts.length} players</div>
          <div style={{ fontSize: 11, color: 'var(--text-faint)', marginLeft: 10 }}>
            {useBreakoutsR2 ? 'FantasAI ML · snap share + opportunity model' : 'Last week ≥ 135% of season avg'}
          </div>
          <div className="grow"></div>
        </div>
        <table className="data-table">
          <thead>
            <tr>
              {useBreakoutsR2 && <th>#</th>}
              <th>Player</th>
              <th>Opp</th>
              <th className="num">Proj</th>
              {useBreakoutsR2 ? (
                <>
                  <th className="num">Snap Δ</th>
                  <th className="num">Opp Score</th>
                  <th className="num">Avg Snap%</th>
                </>
              ) : (
                <>
                  <th className="num">Last</th>
                  <th className="num">Avg</th>
                  <th className="num">Surge</th>
                </>
              )}
              <th className="num">Trend</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {useBreakoutsR2
              ? r2Breakouts.slice(0, 10).map((b, i) => {
                  const p        = playerByName.get((b.player_name || '').toLowerCase().trim());
                  const snapDelta = typeof b.snap_share_delta === 'number' ? b.snap_share_delta : 0;
                  const oppScore  = typeof b.opportunity_score === 'number' ? b.opportunity_score : 0;
                  const avgSnap   = typeof b.avg_snap_share === 'number' ? b.avg_snap_share
                                  : typeof b.avg_snap_share_prev_2wk === 'number' ? b.avg_snap_share_prev_2wk : null;
                  const proj      = b.projected_pts ?? p?.proj;
                  return (
                    <tr key={i} onClick={() => p && onOpenPlayer?.(p.id)} style={{ cursor: p ? 'pointer' : 'default' }}>
                      <td className="rank" style={{ color: 'var(--text-faint)' }}>{i + 1}</td>
                      <td>{p ? <PlayerCell player={p} /> : <span style={{ fontWeight: 600 }}>{b.player_name || '—'}</span>}</td>
                      <td className="mono dim" style={{ fontSize: 11 }}>{p ? `vs ${p.opp}` : (b.team ? `(${b.team})` : '—')}</td>
                      <td className="num"><strong>{proj != null ? Number(proj).toFixed(1) : '—'}</strong></td>
                      <td className="num">
                        <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 800, fontSize: 12, color: snapDelta > 0.15 ? '#c6ff3a' : snapDelta > 0.08 ? 'var(--warn)' : 'var(--text-dim)' }}>
                          +{(snapDelta * 100).toFixed(0)}%
                        </span>
                      </td>
                      <td className="num">
                        <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, fontSize: 12, color: oppScore > 7 ? '#c6ff3a' : oppScore > 4 ? 'var(--warn)' : 'var(--text-dim)' }}>
                          {oppScore.toFixed(1)}
                        </span>
                      </td>
                      <td className="num mono faint" style={{ fontSize: 11 }}>
                        {avgSnap != null ? `${(avgSnap * 100).toFixed(0)}%` : '—'}
                      </td>
                      <td className="num">{p ? <Sparkline data={p.trend} /> : '—'}</td>
                      <td><button className="btn sm primary" onClick={e => e.stopPropagation()}>+ Add</button></td>
                    </tr>
                  );
                })
              : localBreakouts.map(p => {
                  const surge = p.avg > 0 ? ((p.last / p.avg - 1) * 100).toFixed(0) : '—';
                  return (
                    <tr key={p.id} onClick={() => onOpenPlayer?.(p.id)} style={{ cursor: 'pointer' }}>
                      <td><PlayerCell player={p} /></td>
                      <td className="mono dim" style={{ fontSize: 11 }}>vs {p.opp}</td>
                      <td className="num"><strong>{p.proj.toFixed(1)}</strong></td>
                      <td className="num" style={{ color: 'var(--accent)', fontWeight: 700 }}>{p.last.toFixed(1)}</td>
                      <td className="num">{p.avg.toFixed(1)}</td>
                      <td className="num" style={{ fontFamily: 'var(--font-mono)', fontWeight: 800, color: 'var(--good)' }}>+{surge}%</td>
                      <td className="num"><Sparkline data={p.trend} /></td>
                      <td><button className="btn sm primary" onClick={e => e.stopPropagation()}>+ Add</button></td>
                    </tr>
                  );
                })
            }
            {!useBreakoutsR2 && localBreakouts.length === 0 && (
              <tr><td colSpan={8} style={{ textAlign: 'center', padding: '24px 20px', fontSize: 12 }}>
                <div style={{ color: 'var(--text-dim)', fontWeight: 600, marginBottom: 4 }}>No 2026 player data yet</div>
                <div style={{ color: 'var(--text-faint)' }}>Breakout tracking requires in-season game data. Check back when the NFL season kicks off in September.</div>
              </td></tr>
            )}
          </tbody>
        </table>
      </div>

      {/* ── 3. Buy Low ── */}
      <WatchGroup name="Buy Low" ids={WATCHLIST['Buy Low']} onOpenPlayer={onOpenPlayer ?? (() => {})} />

      {/* ── 4. Sell High ── */}
      <WatchGroup name="Sell High" ids={WATCHLIST['Sell High']} onOpenPlayer={onOpenPlayer ?? (() => {})} />

      {/* ── 5. Sleepers ── */}
      <div className="wl-group" style={{ marginTop: 8 }}>
        <div className="head">
          <div className="name" style={{ color: 'var(--accent-2)' }}>
            Sleepers
            {useSleepersR2 && AI_BADGE}
          </div>
          <div className="ct">{useSleepersR2 ? Math.min(r2Sleepers.length, 10) : localSleepers.length} players</div>
          <div style={{ fontSize: 11, color: 'var(--text-faint)', marginLeft: 10 }}>
            {useSleepersR2 ? 'FantasAI ML · low-ownership value targets' : 'Low ownership · high projected value'}
          </div>
          <div className="grow"></div>
        </div>
        <table className="data-table">
          <thead>
            <tr>
              {useSleepersR2 && <th>#</th>}
              <th>Player</th>
              <th>Opp</th>
              <th className="num">Proj</th>
              <th className="num">%Own</th>
              <th className="num">Value</th>
              <th className="num">Trend</th>
              <th>Note</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {useSleepersR2
              ? r2Sleepers.slice(0, 10).map((s, i) => {
                  const p    = playerByName.get((s.player_name || '').toLowerCase().trim());
                  const owned = s.ownership_pct ?? p?.owned;
                  const proj  = s.projected_pts  ?? p?.proj;
                  const value = s.value_score != null
                    ? Number(s.value_score).toFixed(1)
                    : (proj != null && owned != null)
                      ? (Number(proj) / Math.max(Number(owned), 1) * 10).toFixed(1)
                      : '—';
                  return (
                    <tr key={i} onClick={() => p && onOpenPlayer?.(p.id)} style={{ cursor: p ? 'pointer' : 'default' }}>
                      <td className="rank" style={{ color: 'var(--text-faint)' }}>{i + 1}</td>
                      <td>{p ? <PlayerCell player={p} /> : <span style={{ fontWeight: 600 }}>{s.player_name || '—'}</span>}</td>
                      <td className="mono dim" style={{ fontSize: 11 }}>{p ? `vs ${p.opp}` : (s.team ? `(${s.team})` : '—')}</td>
                      <td className="num"><strong>{proj != null ? Number(proj).toFixed(1) : '—'}</strong></td>
                      <td className="num" style={{ color: 'var(--good)' }}>{owned != null ? `${Number(owned).toFixed(1)}%` : '—'}</td>
                      <td className="num" style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, color: 'var(--accent-2)' }}>{value}</td>
                      <td className="num">{p ? <Sparkline data={p.trend} /> : '—'}</td>
                      <td className="dim" style={{ fontSize: 11, maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.reason || p?.news || ''}</td>
                      <td><button className="btn sm primary" onClick={e => e.stopPropagation()}>+ Add</button></td>
                    </tr>
                  );
                })
              : localSleepers.map(p => {
                  const value = (p.proj / Math.max(p.owned, 1) * 10).toFixed(1);
                  return (
                    <tr key={p.id} onClick={() => onOpenPlayer?.(p.id)} style={{ cursor: 'pointer' }}>
                      <td><PlayerCell player={p} /></td>
                      <td className="mono dim" style={{ fontSize: 11 }}>vs {p.opp}</td>
                      <td className="num"><strong>{p.proj.toFixed(1)}</strong></td>
                      <td className="num" style={{ color: 'var(--good)' }}>{p.owned.toFixed(1)}%</td>
                      <td className="num" style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, color: 'var(--accent-2)' }}>{value}</td>
                      <td className="num"><Sparkline data={p.trend} /></td>
                      <td className="dim" style={{ fontSize: 11, maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.news}</td>
                      <td><button className="btn sm primary" onClick={e => e.stopPropagation()}>+ Add</button></td>
                    </tr>
                  );
                })
            }
            {!useSleepersR2 && localSleepers.length === 0 && (
              <tr><td colSpan={8} style={{ textAlign: 'center', padding: '20px', color: 'var(--text-faint)', fontSize: 12 }}>Waiting for live player data…</td></tr>
            )}
          </tbody>
        </table>
      </div>

    </div>
  );

  if (asTab) return content;

  return (
    <div className="col" style={{ height: '100%', overflow: 'auto' }}>
      <div className="page-head">
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <TeamLogoBadge team={null} size={40} />
          <div><h1>Watchlist</h1><div className="sub">My Watchlist · Breakouts · Buy Low · Sell High · Sleepers</div></div>
        </div>
        <div className="flex gap-8">
          <button className="btn ghost">+ New Group</button>
          <button className="btn primary">+ Add Player</button>
        </div>
      </div>
      {content}
    </div>
  );
}
