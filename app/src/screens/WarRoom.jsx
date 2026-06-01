import React from 'react';
import { getPlayers, findPlayer } from '../lib/playerStore.js';
import { runMockDraft } from '../lib/draft.js';
import { PosBadge, PlayerAvatar, TeamLogoBadge } from '../components/ui.jsx';

export default function WarRoomScreen({ onOpenPlayer }) {
  const [slot, setSlot] = React.useState(6);
  const [nMocks, setNMocks] = React.useState(30);
  const [filter, setFilter] = React.useState('ALL');
  const [results, setResults] = React.useState(null);
  const [running, setRunning] = React.useState(true);
  const [progress, setProgress] = React.useState(0);

  const run = React.useCallback(() => {
    setRunning(true); setResults(null); setProgress(0);
    const mocks = [];
    let i = 0;
    const step = () => {
      const chunkSize = 3;
      for (let k = 0; k < chunkSize && i < nMocks; k++, i++) {
        mocks.push(runMockDraft(slot));
      }
      setProgress(i);
      if (i < nMocks) {
        setTimeout(step, 5);
      } else {
        setResults(analyzeMocks(mocks, slot));
        setRunning(false);
      }
    };
    setTimeout(step, 50);
  }, [slot, nMocks]);

  React.useEffect(() => { run(); }, [slot, nMocks]);

  return (
    <div className="col" style={{ height: '100%', overflow: 'hidden' }}>
      <div className="page-head">
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <TeamLogoBadge team={null} size={40} />
          <div>
            <h1>War Room</h1>
            <div className="sub">{nMocks} mock drafts simulated · league-specific ADP · your slot {slot}</div>
          </div>
        </div>
        <div className="flex gap-8">
          <button className="btn ghost" onClick={run} disabled={running}>{running ? `Running… ${progress}/${nMocks}` : '↻ Re-run'}</button>
          <button className="btn ai"><span>◆</span> Build My Draft Plan</button>
        </div>
      </div>

      <div className="toolbar">
        <div className="flex gap-8" style={{ alignItems: 'center' }}>
          <span className="mono faint" style={{ fontSize: 10, letterSpacing: '.1em' }}>YOUR SLOT</span>
          <select className="input" value={slot} onChange={e => setSlot(parseInt(e.target.value))}>
            {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map(n => <option key={n} value={n}>Pick {n}</option>)}
          </select>
        </div>
        <div className="flex gap-8" style={{ alignItems: 'center' }}>
          <span className="mono faint" style={{ fontSize: 10, letterSpacing: '.1em' }}>MOCKS</span>
          {[10, 30, 50].map(n => (
            <div key={n} className={`chip ${nMocks === n ? 'accent active' : ''}`} onClick={() => setNMocks(n)}>{n}</div>
          ))}
        </div>
        <div className="chips" style={{ marginLeft: 12 }}>
          {['ALL', 'QB', 'RB', 'WR', 'TE'].map(p => (
            <div key={p} className={`chip ${filter === p ? 'accent active' : ''}`} onClick={() => setFilter(p)}>{p}</div>
          ))}
        </div>
        <div className="grow"></div>
        <span className="faint mono" style={{ fontSize: 11 }}>{running ? `Simulating ${progress * 192} picks…` : `${nMocks * 192} picks analyzed`}</span>
      </div>

      {running && !results && (
        <div className="war-loading">
          <div className="ai-orb" style={{ width: 40, height: 40 }}></div>
          <div className="war-loading-text">
            <div className="t">Running league simulation…</div>
            <div className="sub">Each mock uses owners' archetypes to predict who picks what.</div>
            <div className="war-progress"><span style={{ width: `${(progress / nMocks) * 100}%` }}></span></div>
          </div>
        </div>
      )}

      {results && (
        <div className="war-grid">
          <div className="war-left">
            <div className="war-section-head">
              <span>DRAFT DISTRIBUTION · {filter === 'ALL' ? 'TOP 60' : `${filter} ONLY`}</span>
              <span className="faint" style={{ fontWeight: 400, letterSpacing: 0, textTransform: 'none' }}>Where each player went across {nMocks} mocks</span>
            </div>
            <PlayerDistTable
              players={results.playerSummary}
              filter={filter}
              yourSlots={results.yourSlots}
              nMocks={nMocks}
              onOpenPlayer={onOpenPlayer}
            />
          </div>

          <div className="war-right">
            <div className="war-section-head">
              <span>YOUR PICKS FORECAST</span>
              <span className="faint" style={{ fontWeight: 400, letterSpacing: 0, textTransform: 'none' }}>Slot {slot} · {results.yourSlots.length} picks</span>
            </div>
            <YourSlotForecast forecast={results.yourForecast} onOpenPlayer={onOpenPlayer} />

            <div className="war-section-head" style={{ marginTop: 18 }}>
              <span>YOUR MOST COMMON BUILD</span>
            </div>
            <BuildFrequency builds={results.buildFreq} />

            <div className="muted-card war-plan">
              <div className="card-mini-label" style={{ color: 'var(--accent-2)' }}>◆ DRAFT PLAN @ SLOT {slot}</div>
              {results.plan.map((line, i) => (
                <div key={i} className="war-plan-line">
                  <span className="r">R{i + 1}</span>
                  <span className="t">{line}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function PlayerDistTable({ players, filter, yourSlots, nMocks, onOpenPlayer }) {
  let list = players.slice();
  if (filter !== 'ALL') list = list.filter(s => findPlayer(s.playerId)?.pos === filter);
  list.sort((a, b) => a.median - b.median);
  list = list.slice(0, 60);

  const yourSlotSet = new Set(yourSlots);

  return (
    <div style={{ flex: 1, overflow: 'auto' }}>
      <table className="data-table war-dist-table">
        <thead>
          <tr>
            <th>#</th><th>Player</th><th className="num">Median</th><th className="num">Range</th>
            <th>Distribution · pick 1 to 192</th><th className="num">At your picks</th>
          </tr>
        </thead>
        <tbody>
          {list.map((s, i) => {
            const p = findPlayer(s.playerId);
            if (!p) return null;
            const yourAvailability = yourSlots.map(slotNum => ({
              slot: slotNum,
              prob: s.picks.filter(pk => pk >= slotNum).length / nMocks,
            }));
            const bestSlot = yourAvailability.find(y => y.prob > 0.3 && y.prob < 0.95);
            return (
              <tr key={p.id} onClick={() => onOpenPlayer && onOpenPlayer(p.id)} style={{ cursor: 'pointer' }}>
                <td className="rank">{i + 1}</td>
                <td>
                  <div className="player-cell">
                    <PlayerAvatar player={p} />
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div className="player-name">{p.name}</div>
                      <div className="player-meta"><PosBadge pos={p.pos} /> {p.team}</div>
                    </div>
                  </div>
                </td>
                <td className="num mono"><strong>{s.median.toFixed(1)}</strong></td>
                <td className="num mono faint" style={{ fontSize: 11 }}>{s.min}–{s.max}</td>
                <td><DistBar picks={s.picks} yourSlots={yourSlots} max={192} /></td>
                <td className="num">
                  {bestSlot ? (
                    <span style={{ color: bestSlot.prob > 0.7 ? 'var(--good)' : bestSlot.prob > 0.4 ? 'var(--warn)' : 'var(--danger)', fontWeight: 700 }}>
                      {Math.round(bestSlot.prob * 100)}% @ R{Math.ceil(bestSlot.slot / 12)}
                    </span>
                  ) : (
                    <span className="faint mono" style={{ fontSize: 11 }}>{yourAvailability[0]?.prob > 0.95 ? 'lock' : 'gone'}</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function DistBar({ picks, yourSlots }) {
  const buckets = new Array(16).fill(0);
  picks.forEach(pk => {
    const round = Math.min(15, Math.floor((pk - 1) / 12));
    buckets[round]++;
  });
  const peak = Math.max(...buckets, 1);
  return (
    <div className="dist-bar">
      {buckets.map((b, i) => {
        const yourPickInRound = yourSlots.find(s => Math.ceil(s / 12) === i + 1);
        return (
          <div key={i} className={`dist-bucket ${yourPickInRound ? 'mine' : ''}`} title={`R${i + 1}: ${b} picks`}>
            <div className="fill" style={{ height: `${(b / peak) * 100}%` }}></div>
          </div>
        );
      })}
    </div>
  );
}

function YourSlotForecast({ forecast, onOpenPlayer }) {
  return (
    <div className="war-forecast-list">
      {forecast.map(f => {
        const round = Math.ceil(f.pick / 12);
        return (
          <div key={f.pick} className="war-forecast-row">
            <div className="war-fc-pick">
              <div className="r">R{round}</div>
              <div className="p mono">#{f.pick}</div>
            </div>
            <div className="war-fc-targets">
              {f.available.slice(0, 4).map((t) => {
                const p = findPlayer(t.playerId);
                if (!p) return null;
                return (
                  <div key={t.playerId} className="war-fc-target" onClick={() => onOpenPlayer && onOpenPlayer(p.id)} style={{ cursor: 'pointer' }} title={`${Math.round(t.availProb * 100)}% available`}>
                    <PosBadge pos={p.pos} />
                    <span className="nm">{p.name.split(' ').slice(-1)[0]}</span>
                    <span className="prob mono" style={{ color: t.availProb > 0.7 ? 'var(--good)' : t.availProb > 0.4 ? 'var(--warn)' : 'var(--danger)' }}>{Math.round(t.availProb * 100)}</span>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function BuildFrequency({ builds }) {
  const total = builds.reduce((s, b) => s + b.count, 0);
  return (
    <div className="war-builds">
      {builds.slice(0, 4).map(b => (
        <div key={b.pattern} className="war-build">
          <div className="war-build-pattern">{b.pattern.split('').map((c, i) => <span key={i} className={`pos-tag pos-${c}`}>{c}</span>)}</div>
          <div className="war-build-bar"><span style={{ width: `${(b.count / total) * 100}%` }}></span></div>
          <div className="war-build-count mono">{b.count}/<span className="faint">{total}</span></div>
        </div>
      ))}
    </div>
  );
}

function analyzeMocks(mocks, yourSlot) {
  const playerStats = {};
  getPlayers().forEach(p => { playerStats[p.id] = { picks: [], drafted: 0 }; });

  mocks.forEach(m => {
    m.picks.forEach(pk => {
      if (pk.playerId && playerStats[pk.playerId]) {
        playerStats[pk.playerId].picks.push(pk.pickNum);
        playerStats[pk.playerId].drafted++;
      }
    });
  });

  const playerSummary = Object.keys(playerStats).map(pid => {
    const stat = playerStats[pid];
    if (stat.drafted === 0) return null;
    const sorted = stat.picks.slice().sort((a, b) => a - b);
    return {
      playerId: parseInt(pid),
      drafted: stat.drafted,
      median: sorted[Math.floor(sorted.length / 2)],
      min: sorted[0],
      max: sorted[sorted.length - 1],
      picks: sorted,
    };
  }).filter(Boolean);

  const yourSlots = [];
  for (let r = 1; r <= 16; r++) {
    yourSlots.push((r - 1) * 12 + (r % 2 === 1 ? yourSlot : 13 - yourSlot));
  }

  const yourForecast = yourSlots.map(slotPick => {
    const available = playerSummary.map(s => ({
      ...s,
      availProb: s.picks.filter(pk => pk >= slotPick).length / mocks.length,
    }))
      .filter(s => s.availProb > 0.05)
      .filter(s => s.availProb < 0.98 || s.median > slotPick - 12)
      .sort((a, b) => a.median - b.median);
    return { pick: slotPick, available: available.slice(0, 5) };
  });

  const builds = {};
  mocks.forEach(m => {
    const myPicks = m.picks.filter(p => p.teamId === 1).slice(0, 5);
    const pattern = myPicks.map(p => {
      const player = findPlayer(p.playerId);
      return player?.pos[0] || 'X';
    }).join('');
    builds[pattern] = (builds[pattern] || 0) + 1;
  });
  const buildFreq = Object.entries(builds).map(([pattern, count]) => ({ pattern, count }))
    .sort((a, b) => b.count - a.count);

  const planByRound = [];
  for (let r = 1; r <= 16; r++) {
    const fc = yourForecast[r - 1];
    if (!fc || fc.available.length === 0) { planByRound.push('Best available'); continue; }
    const top = findPlayer(fc.available[0].playerId);
    if (r === 1) planByRound.push(`Take ${top.name} (${top.pos}) — locks tier 1`);
    else if (r <= 3) planByRound.push(`${top.pos} target: ${top.name} — ${Math.round(fc.available[0].availProb * 100)}% there`);
    else if (r === 4) planByRound.push(`TE / WR3 window — ${fc.available.slice(0, 2).map(a => findPlayer(a.playerId).name.split(' ').slice(-1)[0]).join(' or ')}`);
    else if (r === 5) planByRound.push(`Pivot or stack — ${top.name} value here`);
    else if (r <= 8) planByRound.push(`Bench depth · ${top.pos} upside`);
    else if (r === 9) planByRound.push('QB streamers or RB handcuff');
    else if (r <= 12) planByRound.push('Lottery tickets · rookies / late breakouts');
    else if (r === 13 || r === 14) planByRound.push('Kicker, D/ST');
    else planByRound.push('Stash & flier');
  }

  return { playerSummary, yourSlots, yourForecast, buildFreq, mocks, plan: planByRound.slice(0, 10) };
}
