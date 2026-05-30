import React from 'react';
import { PLAYERS, findPlayer } from '../lib/data.js';
import { PosBadge, PlayerAvatar, Sparkline, Delta } from '../components/ui.jsx';

export default function CompareScreen() {
  const [leftId, setLeftId] = React.useState(50);
  const [rightId, setRightId] = React.useState(54);
  const left = findPlayer(leftId);
  const right = findPlayer(rightId);

  const metrics = [
    { k: 'Week 11 Proj', l: left.proj, r: right.proj, fmt: v => v.toFixed(1), max: 30 },
    { k: 'Last Week', l: left.last, r: right.last, fmt: v => v.toFixed(1), max: 30 },
    { k: 'Season Avg', l: left.avg, r: right.avg, fmt: v => v.toFixed(1), max: 25 },
    { k: 'ECR', l: left.ecr, r: right.ecr, fmt: v => `#${v}`, max: 100, lower: true },
    { k: 'ADP', l: left.adp, r: right.adp, fmt: v => v.toFixed(1), max: 100, lower: true },
    { k: '% Rostered', l: left.owned, r: right.owned, fmt: v => `${v.toFixed(1)}%`, max: 100 },
    { k: 'Tier', l: left.tier, r: right.tier, fmt: v => v, max: 5, lower: true },
    { k: 'Opp Def Rank', l: left.oppRank, r: right.oppRank, fmt: v => `#${v}`, max: 32 },
  ];

  return (
    <div className="col" style={{ height: '100%', overflow: 'auto' }}>
      <div className="page-head">
        <div><h1>Compare Players</h1><div className="sub">Side-by-side · projections, matchup, season trend</div></div>
        <button className="btn ai"><span>◆</span> Ask FantasAI which to start</button>
      </div>

      <div style={{ padding: 24, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, maxWidth: 1100, margin: '0 auto', width: '100%' }}>
        {[[left, leftId, setLeftId], [right, rightId, setRightId]].map(([p, id, setId], idx) => (
          <div key={idx} className="muted-card" style={{ padding: 0 }}>
            <div style={{ padding: 18, borderBottom: '1px solid var(--border)' }}>
              <select className="input" value={id} onChange={e => setId(parseInt(e.target.value))} style={{ width: '100%', marginBottom: 12 }}>
                {PLAYERS.map(pl => (
                  <option key={pl.id} value={pl.id}>{pl.name} ({pl.pos} · {pl.team})</option>
                ))}
              </select>
              <div className="flex gap-12" style={{ alignItems: 'center' }}>
                <PlayerAvatar player={p} size="lg" />
                <div>
                  <div style={{ fontFamily: 'var(--font-display)', fontStretch: '75%', fontSize: 22, fontWeight: 900, textTransform: 'uppercase' }}>{p.name}</div>
                  <div className="mono dim" style={{ fontSize: 11 }}><PosBadge pos={p.pos} /> {p.team} · #{p.num} · vs {p.opp}</div>
                </div>
              </div>
            </div>
            <div style={{ padding: 16 }}>
              <Sparkline data={p.trend} width={300} height={60} />
              <div className="mono faint" style={{ fontSize: 10, textAlign: 'center', marginTop: 4 }}>WK 5 · 6 · 7 · 8 · 9 · 10</div>
            </div>
          </div>
        ))}
      </div>

      <div style={{ padding: '0 24px 24px', maxWidth: 1100, margin: '0 auto', width: '100%' }}>
        <div className="muted-card" style={{ padding: 0 }}>
          <div className="compare-grid">
            {metrics.map((m, i) => {
              const lower = m.lower;
              const leftWins = lower ? m.l < m.r : m.l > m.r;
              const rightWins = lower ? m.r < m.l : m.r > m.l;
              return (
                <div className="compare-row" key={i}>
                  <div className={`left ${leftWins ? 'winner-l' : ''}`}>
                    <span>{m.fmt(m.l)}</span>
                    <div className="compare-bar"><span style={{ width: `${(m.l / m.max) * 100}%`, background: leftWins ? 'var(--accent)' : 'var(--panel-3)' }}></span></div>
                  </div>
                  <div className="label">{m.k}</div>
                  <div className={`right ${rightWins ? 'winner-r' : ''}`}>
                    <div className="compare-bar"><span style={{ width: `${(m.r / m.max) * 100}%`, background: rightWins ? 'var(--accent)' : 'var(--panel-3)' }}></span></div>
                    <span>{m.fmt(m.r)}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="muted-card" style={{ marginTop: 16, borderLeft: '3px solid var(--accent-2)' }}>
          <div className="flex gap-8" style={{ alignItems: 'center', marginBottom: 8 }}>
            <div className="ai-orb" style={{ width: 22, height: 22 }}></div>
            <span style={{ fontFamily: 'var(--font-display)', fontStretch: '87%', fontWeight: 800, fontSize: 11, letterSpacing: '.12em', textTransform: 'uppercase', color: 'var(--accent-2)' }}>FantasAI Verdict</span>
          </div>
          <div style={{ fontSize: 13, lineHeight: 1.6 }}>
            <strong>Start {left.proj > right.proj ? left.name : right.name}.</strong> Across 10,000 simulated weeks, {left.proj > right.proj ? left.name : right.name} outscored the other in <strong>{Math.round(50 + Math.abs(left.proj - right.proj) * 3)}%</strong> of outcomes.
            Decision is largely matchup-driven: {left.opp} ranks #{left.oppRank} vs {left.pos}, {right.opp} ranks #{right.oppRank} vs {right.pos}.
            Floor difference is <strong>{Math.abs(left.proj - right.proj).toFixed(1)} pts</strong>; ceiling difference is closer to <strong>{(Math.abs(left.proj - right.proj) * 2.1).toFixed(1)}</strong>.
          </div>
        </div>
      </div>
    </div>
  );
}
