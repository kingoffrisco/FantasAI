import React from 'react';
import { findPlayer, LEAGUE_TEAMS } from '../lib/data.js';
import { PosBadge, PlayerAvatar } from '../components/ui.jsx';

export default function TradeScreen() {
  const [myGive, setMyGive] = React.useState([22, 80]);
  const [myGet, setMyGet] = React.useState([21, 84]);
  const [otherTeam, setOtherTeam] = React.useState(2);

  const giveTotal = myGive.reduce((s, id) => s + (findPlayer(id)?.avg || 0), 0);
  const getTotal = myGet.reduce((s, id) => s + (findPlayer(id)?.avg || 0), 0);
  const diff = getTotal - giveTotal;
  const grade = diff > 4 ? 'A' : diff > 1 ? 'B+' : diff > -1 ? 'B' : diff > -4 ? 'C' : 'D';
  const gradeColor = diff > 1 ? 'var(--accent)' : diff > -1 ? 'var(--warn)' : 'var(--danger)';

  const otherTeamObj = LEAGUE_TEAMS.find(t => t.id === otherTeam);

  return (
    <div className="col" style={{ height: '100%', overflow: 'auto' }}>
      <div className="page-head">
        <div><h1>Trade Analyzer</h1><div className="sub">Drag players in · AI grades the deal · ROS projections</div></div>
        <div className="flex gap-8">
          <button className="btn ghost">Reset</button>
          <button className="btn primary">Send Offer</button>
        </div>
      </div>

      <div style={{ padding: '0 24px', marginTop: 8 }}>
        <select className="input" value={otherTeam} onChange={e => setOtherTeam(parseInt(e.target.value))}>
          {LEAGUE_TEAMS.filter(t => !t.me).map(t => (
            <option key={t.id} value={t.id}>Trade with: {t.name} ({t.owner})</option>
          ))}
        </select>
      </div>

      <div className="trade-panels">
        <div className="trade-panel me">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <div className="card-title">You Give · Armed Rodgery</div>
            <div className="mono dim" style={{ fontSize: 11 }}>Total avg: {giveTotal.toFixed(1)}</div>
          </div>
          {myGive.map(id => {
            const p = findPlayer(id);
            if (!p) return null;
            return (
              <div className="trade-slot" key={id}>
                <PlayerAvatar player={p} />
                <div style={{ flex: 1 }}>
                  <div className="player-name">{p.name}</div>
                  <div className="player-meta"><PosBadge pos={p.pos} /> {p.team} · {p.avg.toFixed(1)} avg</div>
                </div>
                <button className="btn sm ghost" onClick={() => setMyGive(myGive.filter(x => x !== id))}>✕</button>
              </div>
            );
          })}
          <div className="trade-slot empty">+ Drop player here</div>
        </div>

        <div className="trade-panel">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <div className="card-title">You Get · {otherTeamObj?.name}</div>
            <div className="mono dim" style={{ fontSize: 11 }}>Total avg: {getTotal.toFixed(1)}</div>
          </div>
          {myGet.map(id => {
            const p = findPlayer(id);
            if (!p) return null;
            return (
              <div className="trade-slot" key={id}>
                <PlayerAvatar player={p} />
                <div style={{ flex: 1 }}>
                  <div className="player-name">{p.name}</div>
                  <div className="player-meta"><PosBadge pos={p.pos} /> {p.team} · {p.avg.toFixed(1)} avg</div>
                </div>
                <button className="btn sm ghost" onClick={() => setMyGet(myGet.filter(x => x !== id))}>✕</button>
              </div>
            );
          })}
          <div className="trade-slot empty">+ Drop player here</div>
        </div>
      </div>

      <div className="trade-grade">
        <div>
          <div style={{ fontFamily: 'var(--font-display)', fontStretch: '87%', fontWeight: 800, fontSize: 10, letterSpacing: '.12em', textTransform: 'uppercase', color: 'var(--text-faint)' }}>FantasAI Grade</div>
          <div className="grade-letter" style={{ color: gradeColor }}>{grade}</div>
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 13, lineHeight: 1.6 }}>
            <strong>{diff > 0 ? 'Favorable for you.' : diff < -2 ? 'Slight lean against you.' : 'Roughly even on paper.'}</strong>
            {' '}You gain {diff > 0 ? `+${diff.toFixed(1)}` : diff.toFixed(1)} avg points/week.
            Net playoff odds: <span style={{ color: 'var(--good)' }}>+4.2%</span>.
          </div>
          <div className="flex gap-8" style={{ marginTop: 12 }}>
            <div className="stat" style={{ padding: 8, flex: 1 }}>
              <div className="k">Avg / week</div>
              <div className="v" style={{ fontSize: 14 }}>{diff > 0 ? '+' : ''}{diff.toFixed(1)}</div>
            </div>
            <div className="stat" style={{ padding: 8, flex: 1 }}>
              <div className="k">Playoff Odds</div>
              <div className="v" style={{ fontSize: 14, color: 'var(--good)' }}>+4.2%</div>
            </div>
            <div className="stat" style={{ padding: 8, flex: 1 }}>
              <div className="k">Bench Depth</div>
              <div className="v" style={{ fontSize: 14, color: 'var(--warn)' }}>−1 starter</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
