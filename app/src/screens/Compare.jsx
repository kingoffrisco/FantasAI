import React from 'react';
import { usePlayers, findPlayer } from '../lib/playerStore.js';
import { PosBadge, PlayerAvatar, Sparkline, TeamLogoBadge } from '../components/ui.jsx';
import { setCompareContext } from '../components/AICopilot.jsx';

const API_BASE = 'https://api.fantasai.net';

const METRICS = [
  { k: 'Proj',        get: p => p.proj,    fmt: v => v.toFixed(1), higher: true },
  { k: 'Last Week',   get: p => p.last,    fmt: v => v.toFixed(1), higher: true },
  { k: 'Season Avg',  get: p => p.avg,     fmt: v => v.toFixed(1), higher: true },
  { k: 'ECR',         get: p => p.ecr,     fmt: v => `#${v}`,      higher: false },
  { k: 'ADP',         get: p => p.adp,     fmt: v => v.toFixed(1), higher: false },
  { k: '% Rostered',  get: p => p.owned,   fmt: v => `${v.toFixed(1)}%`, higher: true },
  { k: 'Tier',        get: p => p.tier,    fmt: v => v,             higher: false },
  { k: 'Opp D Rank',  get: p => p.oppRank, fmt: v => `#${v}`,      higher: false },
];

export default function CompareScreen() {
  const players = usePlayers();
  const [count, setCount] = React.useState(2);
  const [playerIds, setPlayerIds] = React.useState([50, 54, 22, 1, 80]);
  const [posFilters, setPosFilters] = React.useState(['ALL', 'ALL', 'ALL', 'ALL', 'ALL']);
  const [aiLoading, setAiLoading] = React.useState(false);
  const [aiVerdict, setAiVerdict] = React.useState(null);
  const [aiError, setAiError] = React.useState(null);

  const selected = playerIds.slice(0, count).map(id => findPlayer(id)).filter(Boolean);

  const selectedKey = selected.map(p => p.id).join(',');
  React.useEffect(() => {
    setCompareContext(selected);
    return () => setCompareContext([]);
  }, [selectedKey]); // eslint-disable-line react-hooks/exhaustive-deps

  function setPlayerId(idx, id) {
    setPlayerIds(prev => {
      const next = [...prev];
      next[idx] = id;
      return next;
    });
  }

  async function askFantasAI() {
    if (selected.length < 2) return;
    setAiLoading(true); setAiError(null); setAiVerdict(null);
    try {
      const fmt = p => `${p.name} (${p.pos}, ${p.team}): Proj ${p.proj}, Last ${p.last}, Avg ${p.avg}, ECR #${p.ecr}, ADP ${p.adp}, Opp ${p.opp} (#${p.oppRank} vs ${p.pos}), Owned ${p.owned}%, Tier ${p.tier}`;
      const playerLines = selected.map((p, i) => `Player ${i + 1}: ${fmt(p)}`).join('\n');
      const question = `Compare these ${selected.length} fantasy football players and tell me which one to start this week:\n\n${playerLines}\n\nGive a direct ranking (best to worst) with reasoning. Focus on this week's matchup, projected points, and floor/ceiling. Be concise.`;
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

  const colWidth = count <= 2 ? '1fr' : count === 3 ? '1fr' : '1fr';

  return (
    <div className="col" style={{ height: '100%', overflow: 'auto' }}>
      <div className="page-head">
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div><h1>Compare Players</h1><div className="sub">Side-by-side · projections, matchup, season trend</div></div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontSize: 11, color: 'var(--text-faint)', fontFamily: 'var(--font-mono)' }}>Players:</span>
            {[1, 2, 3, 4, 5].map(n => (
              <button
                key={n}
                onClick={() => setCount(n)}
                style={{
                  width: 28, height: 28, borderRadius: 6, border: `1px solid ${count === n ? 'var(--accent)' : 'var(--border)'}`,
                  background: count === n ? 'rgba(198,255,58,.15)' : 'transparent',
                  color: count === n ? 'var(--accent)' : 'var(--text-dim)',
                  fontWeight: 700, fontSize: 13, cursor: 'pointer', lineHeight: 1,
                }}
              >{n}</button>
            ))}
          </div>
          <button className="btn ai" onClick={askFantasAI} disabled={aiLoading || selected.length < 2} style={{ opacity: (aiLoading || selected.length < 2) ? 0.7 : 1 }}>
            <span>◆</span> {aiLoading ? 'Analyzing…' : 'Ask FantasAI'}
          </button>
        </div>
      </div>

      {/* Player selector cards */}
      <div style={{ padding: '0 24px 16px', display: 'grid', gridTemplateColumns: `repeat(${count}, ${colWidth})`, gap: 12, maxWidth: 1200, margin: '0 auto', width: '100%' }}>
        {Array.from({ length: count }, (_, idx) => {
          const p = findPlayer(playerIds[idx]);
          return (
            <div key={idx} className="muted-card" style={{ padding: 0 }}>
              <div style={{ padding: 14, borderBottom: '1px solid var(--border)' }}>
                <div style={{ display: 'flex', gap: 4, marginBottom: 8 }}>
                  {['ALL', 'QB', 'RB', 'WR', 'TE', 'K', 'DST'].map(pos => (
                    <button
                      key={pos}
                      onClick={() => setPosFilters(prev => { const next = [...prev]; next[idx] = pos; return next; })}
                      style={{
                        padding: '3px 8px', borderRadius: 5, fontSize: 10, fontWeight: posFilters[idx] === pos ? 700 : 500,
                        cursor: 'pointer', border: 'none',
                        background: posFilters[idx] === pos ? 'var(--accent)' : 'var(--panel)',
                        color: posFilters[idx] === pos ? 'var(--accent-ink)' : 'var(--text-dim)',
                      }}
                    >{pos}</button>
                  ))}
                </div>
                <select
                  className="input"
                  value={playerIds[idx] ?? ''}
                  onChange={e => setPlayerId(idx, parseInt(e.target.value))}
                  style={{ width: '100%', marginBottom: 10, fontSize: 12 }}
                >
                  {[...players]
                    .filter(pl => posFilters[idx] === 'ALL' || pl.pos === posFilters[idx])
                    .sort((a, b) => (Math.min(a.ecr || 999, a.adp || 999)) - (Math.min(b.ecr || 999, b.adp || 999)))
                    .map(pl => (
                      <option key={pl.id} value={pl.id}>#{Math.min(pl.ecr || 999, pl.adp || 999)} {pl.name} ({pl.pos} · {pl.team})</option>
                  ))}
                </select>
                {p && (
                  <div className="flex gap-10" style={{ alignItems: 'center' }}>
                    <PlayerAvatar player={p} size="lg" />
                    <div>
                      <div style={{ fontFamily: 'var(--font-display)', fontStretch: '75%', fontSize: count >= 4 ? 16 : 20, fontWeight: 900, textTransform: 'uppercase', lineHeight: 1.1 }}>{p.name}</div>
                      <div className="mono dim" style={{ fontSize: 10 }}><PosBadge pos={p.pos} /> {p.team} · vs {p.opp}</div>
                    </div>
                  </div>
                )}
              </div>
              {p && count <= 3 && (
                <div style={{ padding: '10px 14px' }}>
                  <Sparkline data={p.trend} width={240} height={48} />
                  <div className="mono faint" style={{ fontSize: 9, textAlign: 'center', marginTop: 3 }}>WK 5 · 6 · 7 · 8 · 9 · 10</div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Metrics comparison table */}
      <div style={{ padding: '0 24px 24px', maxWidth: 1200, margin: '0 auto', width: '100%' }}>
        <div className="muted-card" style={{ padding: 0, overflow: 'hidden' }}>
          <table className="data-table" style={{ width: '100%' }}>
            <thead>
              <tr>
                <th style={{ width: 120 }}>Metric</th>
                {Array.from({ length: count }, (_, idx) => {
                  const p = findPlayer(playerIds[idx]);
                  return <th key={idx} className="num" style={{ fontSize: 11 }}>{p ? p.name.split(' ').slice(-1)[0] : `P${idx + 1}`}</th>;
                })}
              </tr>
            </thead>
            <tbody>
              {METRICS.map(m => {
                const vals = Array.from({ length: count }, (_, idx) => {
                  const p = findPlayer(playerIds[idx]);
                  return p ? m.get(p) : null;
                });
                const defined = vals.filter(v => v != null);
                const best = defined.length ? (m.higher ? Math.max(...defined) : Math.min(...defined)) : null;
                return (
                  <tr key={m.k}>
                    <td style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-dim)' }}>{m.k}</td>
                    {vals.map((v, idx) => {
                      const isBest = v != null && v === best;
                      return (
                        <td key={idx} className="num" style={{ fontWeight: isBest ? 800 : 400, color: isBest ? 'var(--accent)' : 'var(--text-dim)', fontSize: 13 }}>
                          {v != null ? m.fmt(v) : <span className="faint">—</span>}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="muted-card" style={{ marginTop: 16, borderLeft: `3px solid ${aiError ? 'var(--danger)' : 'var(--accent-2)'}` }}>
          <div className="flex gap-8" style={{ alignItems: 'center', marginBottom: 8 }}>
            <div className="ai-orb" style={{ width: 22, height: 22, opacity: aiLoading ? 0.5 : 1 }}></div>
            <span style={{ fontFamily: 'var(--font-display)', fontStretch: '87%', fontWeight: 800, fontSize: 11, letterSpacing: '.12em', textTransform: 'uppercase', color: 'var(--accent-2)' }}>FantasAI Verdict</span>
            {aiLoading && <span style={{ fontSize: 10, color: 'var(--text-faint)', fontFamily: 'var(--font-mono)' }}>thinking…</span>}
          </div>
          {aiError && <div style={{ fontSize: 12, color: 'var(--danger)' }}>Error: {aiError}</div>}
          {aiVerdict ? (
            <div style={{ fontSize: 13, lineHeight: 1.7, whiteSpace: 'pre-wrap' }}>{aiVerdict}</div>
          ) : !aiLoading && !aiError && (
            <div style={{ fontSize: 13, lineHeight: 1.6, color: 'var(--text-dim)' }}>
              Select {count < 2 ? 'at least 2' : 'your'} players above, then click <strong>Ask FantasAI</strong> for a ranking and recommendation.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
