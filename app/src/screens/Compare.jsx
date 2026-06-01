import React from 'react';
import { usePlayers, findPlayer } from '../lib/playerStore.js';
import { PosBadge, PlayerAvatar, Sparkline, Delta, TeamLogoBadge } from '../components/ui.jsx';

const API_BASE = 'https://api.fantasai.net';

export default function CompareScreen() {
  const players = usePlayers();
  const [leftId, setLeftId] = React.useState(50);
  const [rightId, setRightId] = React.useState(54);
  const [aiLoading, setAiLoading] = React.useState(false);
  const [aiVerdict, setAiVerdict] = React.useState(null);
  const [aiError, setAiError] = React.useState(null);
  const left = findPlayer(leftId);
  const right = findPlayer(rightId);

  async function askFantasAI() {
    setAiLoading(true);
    setAiError(null);
    setAiVerdict(null);
    try {
      const fmt = p => `${p.name} (${p.pos}, ${p.team}): Proj ${p.proj}, Last ${p.last}, Avg ${p.avg}, ECR #${p.ecr}, ADP ${p.adp}, Opp ${p.opp} (#${p.oppRank} vs ${p.pos}), Owned ${p.owned}%, Tier ${p.tier}`;
      const question = `Compare these two fantasy football players and tell me which one to start this week:\n\nPlayer 1: ${fmt(left)}\nPlayer 2: ${fmt(right)}\n\nGive a direct recommendation with reasoning. Focus on this week's matchup, projected points, and floor/ceiling. Be concise.`;
      const res = await fetch(`${API_BASE}/api/v1/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question, context: 'Player comparison for start/sit decision.' }),
        signal: AbortSignal.timeout(35000),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `Error ${res.status}`);
      setAiVerdict(data.answer);
    } catch (err) {
      setAiError(err.message);
    } finally {
      setAiLoading(false);
    }
  }

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
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <TeamLogoBadge team={null} size={40} />
          <div><h1>Compare Players</h1><div className="sub">Side-by-side · projections, matchup, season trend</div></div>
        </div>
        <button className="btn ai" onClick={askFantasAI} disabled={aiLoading} style={{ opacity: aiLoading ? 0.7 : 1 }}>
          <span>◆</span> {aiLoading ? 'Analyzing…' : 'Ask FantasAI which to start'}
        </button>
      </div>

      <div style={{ padding: 24, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, maxWidth: 1100, margin: '0 auto', width: '100%' }}>
        {[[left, leftId, setLeftId], [right, rightId, setRightId]].map(([p, id, setId], idx) => (
          <div key={idx} className="muted-card" style={{ padding: 0 }}>
            <div style={{ padding: 18, borderBottom: '1px solid var(--border)' }}>
              <select className="input" value={id} onChange={e => setId(parseInt(e.target.value))} style={{ width: '100%', marginBottom: 12 }}>
                {players.map(pl => (
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

        <div className="muted-card" style={{ marginTop: 16, borderLeft: `3px solid ${aiError ? 'var(--danger)' : 'var(--accent-2)'}` }}>
          <div className="flex gap-8" style={{ alignItems: 'center', marginBottom: 8 }}>
            <div className="ai-orb" style={{ width: 22, height: 22, opacity: aiLoading ? 0.5 : 1 }}></div>
            <span style={{ fontFamily: 'var(--font-display)', fontStretch: '87%', fontWeight: 800, fontSize: 11, letterSpacing: '.12em', textTransform: 'uppercase', color: 'var(--accent-2)' }}>FantasAI Verdict</span>
            {aiLoading && <span style={{ fontSize: 10, color: 'var(--text-faint)', fontFamily: 'var(--font-mono)' }}>thinking…</span>}
          </div>
          {aiError && (
            <div style={{ fontSize: 12, color: 'var(--danger)' }}>Error: {aiError}</div>
          )}
          {aiVerdict ? (
            <div style={{ fontSize: 13, lineHeight: 1.7, whiteSpace: 'pre-wrap' }}>{aiVerdict}</div>
          ) : !aiLoading && !aiError && (
            <div style={{ fontSize: 13, lineHeight: 1.6, color: 'var(--text-dim)' }}>
              Click <strong>Ask FantasAI</strong> above to get a real AI recommendation comparing these two players.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
