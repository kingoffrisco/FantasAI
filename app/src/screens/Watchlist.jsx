import React from 'react';
import { WATCHLIST } from '../lib/data.js';
import { findPlayer } from '../lib/playerStore.js';
import { PlayerCell, Sparkline, TeamLogoBadge } from '../components/ui.jsx';

export default function WatchlistScreen({ onOpenPlayer }) {
  return (
    <div className="col" style={{ height: '100%', overflow: 'auto' }}>
      <div className="page-head">
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <TeamLogoBadge team={null} size={40} />
          <div><h1>Watchlist</h1><div className="sub">8 players across 3 groups · Auto-alert on news</div></div>
        </div>
        <div className="flex gap-8">
          <button className="btn ghost">+ New Group</button>
          <button className="btn primary">+ Add Player</button>
        </div>
      </div>
      <div style={{ padding: 24, maxWidth: 1200, margin: '0 auto', width: '100%' }}>
        {Object.entries(WATCHLIST).map(([group, ids]) => (
          <div className="wl-group" key={group}>
            <div className="head">
              <div className="name">{group}</div>
              <div className="ct">{ids.length} players</div>
              <div className="grow"></div>
              <button className="btn sm ghost">Edit</button>
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
                {ids.map(id => {
                  const p = findPlayer(id);
                  if (!p) return null;
                  return (
                    <tr key={p.id} onClick={() => onOpenPlayer(p.id)} style={{ cursor: 'pointer' }}>
                      <td><PlayerCell player={p} /></td>
                      <td className="mono dim" style={{ fontSize: 11 }}>vs {p.opp}</td>
                      <td className="num"><strong>{p.proj.toFixed(1)}</strong></td>
                      <td className="num">{p.owned.toFixed(1)}%</td>
                      <td className="num"><Sparkline data={p.trend} /></td>
                      <td className="dim" style={{ fontSize: 11 }}>{p.news}</td>
                      <td><button className="btn sm primary" onClick={e => e.stopPropagation()}>+ Add</button></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ))}
      </div>
    </div>
  );
}
