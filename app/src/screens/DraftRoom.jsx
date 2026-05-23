import React from 'react';
import { PLAYERS, findPlayer, LEAGUE_TEAMS, DRAFT_PICKS, TEAMS_ORDER, QUEUE as INIT_QUEUE, CHAT_MESSAGES } from '../lib/data.js';
import { predictPicks } from '../lib/draft.js';
import { PosBadge, PlayerAvatar, PlayerCell } from '../components/ui.jsx';

export default function DraftRoom({ aiMode }) {
  const CURRENT_PICK = 40;
  const [seconds, setSeconds] = React.useState(73);
  const [queue, setQueue] = React.useState(INIT_QUEUE);
  const [boardPos, setBoardPos] = React.useState('ALL');
  const [boardSearch, setBoardSearch] = React.useState('');
  const [showRecap, setShowRecap] = React.useState(false);

  React.useEffect(() => {
    const t = setInterval(() => setSeconds(s => Math.max(0, s - 1)), 1000);
    return () => clearInterval(t);
  }, []);

  React.useEffect(() => {
    if (seconds === 0) {
      const r = setTimeout(() => setSeconds(90), 1200);
      return () => clearTimeout(r);
    }
  }, [seconds]);

  const allPicks = DRAFT_PICKS;
  const draftedIds = new Set(allPicks.filter(p => p.playerId).map(p => p.playerId));

  const teamsOrder = TEAMS_ORDER;
  const currentRound = Math.ceil(CURRENT_PICK / 12);
  const slot = ((CURRENT_PICK - 1) % 12);
  const onClockTeamId = currentRound % 2 === 1 ? teamsOrder[slot] : teamsOrder[11 - slot];
  const onClockTeam = LEAGUE_TEAMS.find(t => t.id === onClockTeamId);

  const upcoming = [];
  for (let i = 1; i <= 6; i++) {
    const pn = CURRENT_PICK + i;
    if (pn > 192) break;
    const round = Math.ceil(pn / 12);
    const s = ((pn - 1) % 12);
    const tid = round % 2 === 1 ? teamsOrder[s] : teamsOrder[11 - s];
    const team = LEAGUE_TEAMS.find(t => t.id === tid);
    upcoming.push({ pick: pn, round, team, teamId: tid });
  }

  const currentPrediction = predictPicks(onClockTeamId, CURRENT_PICK, draftedIds, 3);

  let bestAvail = PLAYERS.filter(p => !draftedIds.has(p.id));
  if (boardPos !== 'ALL') bestAvail = bestAvail.filter(p => p.pos === boardPos);
  if (boardSearch) bestAvail = bestAvail.filter(p => p.name.toLowerCase().includes(boardSearch.toLowerCase()));
  bestAvail.sort((a, b) => a.ecr - b.ecr);

  const aiSuggestions = [
    { id: 31, why: 'Tier-2 RB with three-down workload — perfect handcuff to your CMC. Last #28 ECR available.' },
    { id: 82, why: 'TE5 still on the board. Position scarcity hits hard after pick 50; lock this now.' },
    { id: 6, why: "QB room is thin if Burrow tweaks again. Caleb is the contingency w/ rushing floor." },
  ];

  const rosterSlots = [
    { slot: 'QB', filled: 1 }, { slot: 'RB', filled: 1 }, { slot: 'RB', filled: 0 },
    { slot: 'WR', filled: 1 }, { slot: 'WR', filled: 0 }, { slot: 'TE', filled: 0 },
    { slot: 'FLEX', filled: 0 }, { slot: 'K', filled: 0 }, { slot: 'DST', filled: 0 },
    { slot: 'BENCH', filled: 0 }, { slot: 'BENCH', filled: 0 }, { slot: 'BENCH', filled: 0 },
    { slot: 'BENCH', filled: 0 }, { slot: 'BENCH', filled: 0 }, { slot: 'BENCH', filled: 0 },
    { slot: 'BENCH', filled: 0 },
  ];

  const myPicks = allPicks.filter(p => p.teamId === 1 && p.playerId);
  const teamsForCols = teamsOrder.map(id => LEAGUE_TEAMS.find(t => t.id === id));
  const clockClass = seconds < 10 ? 'danger' : seconds < 30 ? 'warn' : '';
  const isMyTurn = onClockTeamId === 1;

  return (
    <div className="draft-grid">
      {/* CLOCK BAR */}
      <div className="draft-clock">
        <div style={{ padding: '0 24px', borderRight: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 16, alignSelf: 'stretch' }}>
          <span className={`clock-time ${clockClass}`} style={{ fontSize: 48 }}>
            {`${Math.floor(seconds / 60)}:${(seconds % 60).toString().padStart(2, '0')}`}
          </span>
          <div>
            <div className="mono dim" style={{ fontSize: 10, letterSpacing: '.12em', textTransform: 'uppercase', fontWeight: 700 }}>ON THE CLOCK</div>
            <div className="mono" style={{ fontSize: 11, color: 'var(--text)' }}>Pick #{CURRENT_PICK} · Round {currentRound}</div>
          </div>
        </div>

        <div className="on-clock" style={{ flex: 1 }}>
          <div className="avatar lg" style={{ background: `linear-gradient(135deg, ${onClockTeam.color}cc, ${onClockTeam.color}33)`, color: '#fff' }}>
            <span style={{ position: 'relative', zIndex: 1 }}>{onClockTeam.logo}</span>
          </div>
          <div>
            <div className="name">{onClockTeam.name}</div>
            <div className="pick">{onClockTeam.owner} {isMyTurn && <span style={{ color: 'var(--accent)', marginLeft: 6 }}>· YOU'RE UP</span>}</div>
          </div>
          <div className="up-next">
            <span>UP NEXT →</span>
            {upcoming.map(u => (
              <span key={u.pick} className={`tn ${u.team.me ? 'me' : ''}`}>{u.pick}. {u.team.logo}</span>
            ))}
          </div>
        </div>

        <div style={{ padding: '0 24px', display: 'flex', gap: 8, alignSelf: 'center' }}>
          <button className="btn ghost sm" onClick={() => setShowRecap(!showRecap)}>Round {currentRound - 1} Recap</button>
          <button className="btn ghost sm">⏸ Pause</button>
          {isMyTurn && <button className="btn primary">▶ Draft Best Available</button>}
        </div>
      </div>

      {/* GHOST PICKS STRIP */}
      <div className="draft-ghosts">
        <div className="ghost-label">
          <div className="ai-orb" style={{ width: 16, height: 16 }}></div>
          <span>GHOST PICKS</span>
          <span className="faint" style={{ fontWeight: 400, letterSpacing: 0, textTransform: 'none' }}>· predicted next moves based on each owner's draft DNA</span>
        </div>
        <div className="ghost-strip">
          <div className={`ghost-card oc ${isMyTurn ? 'me' : ''}`}>
            <div className="ghost-head">
              <span className="ghost-pick mono">#{CURRENT_PICK}</span>
              <span className="ghost-owner">{onClockTeam.logo} {onClockTeam.owner}</span>
              <span className="ghost-now">ON CLOCK</span>
            </div>
            <div className="ghost-targets">
              {currentPrediction.map((g, i) => (
                <GhostTarget key={g.player.id} g={g} rank={i} isMe={isMyTurn} />
              ))}
            </div>
          </div>

          {upcoming.slice(0, 5).map(u => {
            const ghostPreds = predictPicks(u.teamId, u.pick, draftedIds, 2);
            return (
              <div key={u.pick} className={`ghost-card ${u.team.me ? 'me' : ''}`}>
                <div className="ghost-head sm">
                  <span className="ghost-pick mono">#{u.pick}</span>
                  <span className="ghost-owner sm">{u.team.logo} {u.team.owner}</span>
                </div>
                <div className="ghost-targets sm">
                  {ghostPreds.map((g, i) => (
                    <GhostTarget key={g.player.id} g={g} rank={i} compact />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* BIG BOARD */}
      <div className="draft-board">
        <div className="toolbar" style={{ padding: '10px 12px', borderBottom: '1px solid var(--border)', borderTop: 0 }}>
          <div className="card-title" style={{ flex: 1 }}>Big Board · {bestAvail.length} available</div>
        </div>
        <div style={{ padding: '8px 12px', borderBottom: '1px solid var(--border)', display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <div className="chips">
            {['ALL', 'QB', 'RB', 'WR', 'TE', 'K', 'DST'].map(p => (
              <div key={p} className={`chip ${boardPos === p ? 'accent active' : ''}`} onClick={() => setBoardPos(p)}>{p}</div>
            ))}
          </div>
        </div>
        <div style={{ padding: '8px 12px' }}>
          <input className="input search" placeholder="Find player" value={boardSearch} onChange={e => setBoardSearch(e.target.value)} style={{ width: '100%' }} />
        </div>
        <div style={{ flex: 1, overflow: 'auto' }}>
          <table className="data-table" style={{ fontSize: 12 }}>
            <thead>
              <tr><th>#</th><th>Player</th><th className="num">Tier</th><th className="num">ADP</th><th></th></tr>
            </thead>
            <tbody>
              {bestAvail.slice(0, 60).map((p) => {
                const inQueue = queue.includes(p.id);
                return (
                  <tr key={p.id}>
                    <td className="rank">{p.ecr}</td>
                    <td>
                      <div className="player-cell">
                        <PlayerAvatar player={p} />
                        <div style={{ minWidth: 0, flex: 1 }}>
                          <div className="player-name" style={{ fontSize: 12 }}>{p.name}</div>
                          <div className="player-meta"><PosBadge pos={p.pos} /> {p.team}</div>
                        </div>
                      </div>
                    </td>
                    <td className="tier">T{p.tier}</td>
                    <td className="num faint" style={{ fontSize: 11 }}>{p.adp.toFixed(1)}</td>
                    <td>
                      <div className="flex" style={{ gap: 4 }}>
                        <button className="btn sm icon" title="Add to queue"
                          onClick={() => setQueue(inQueue ? queue.filter(x => x !== p.id) : [...queue, p.id])}
                          style={inQueue ? { background: 'var(--accent)', color: 'var(--accent-ink)', borderColor: 'var(--accent)' } : {}}>
                          {inQueue ? '✓' : '+'}
                        </button>
                        {isMyTurn && <button className="btn sm primary" style={{ padding: '4px 8px' }}>DRAFT</button>}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* CENTER: AI + QUEUE + PICK LOG */}
      <div className="draft-center">
        <div style={{ padding: 14, borderBottom: '1px solid var(--border)' }}>
          <div className="suggest-card">
            <div className="head">
              <div className="ai-orb"></div>
              <span className="label">FantasAI Pick Engine</span>
              <span className="grow"></span>
              <span className="mono faint" style={{ fontSize: 10 }}>Updated 0.2s ago</span>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
              {aiSuggestions.map((s, i) => {
                const p = findPlayer(s.id);
                if (!p) return null;
                return (
                  <div key={s.id} style={{ background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 6, padding: 10 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                      <span className="mono accent" style={{ fontSize: 10, fontWeight: 600 }}>#{i + 1}</span>
                      <span className="mono faint" style={{ fontSize: 10 }}>{Math.round(94 - i * 7)}% match</span>
                    </div>
                    <div className="player-cell">
                      <PlayerAvatar player={p} />
                      <div style={{ minWidth: 0 }}>
                        <div className="player-name" style={{ fontSize: 12 }}>{p.name}</div>
                        <div className="player-meta"><PosBadge pos={p.pos} /> {p.team}</div>
                      </div>
                    </div>
                    <div className="why" style={{ marginTop: 8, minHeight: 50 }}>{s.why}</div>
                    {(aiMode === 'centerpiece' || aiMode === 'copilot') && isMyTurn && (
                      <button className="btn ai sm" style={{ width: '100%', marginTop: 8 }}>DRAFT</button>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', flex: 1, overflow: 'hidden' }}>
          {/* My Queue */}
          <div style={{ borderRight: '1px solid var(--border)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            <div style={{ padding: '10px 14px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center' }}>
              <div className="card-title" style={{ flex: 1 }}>My Queue · {queue.length}</div>
              <button className="btn sm ghost" onClick={() => setQueue([])}>Clear</button>
            </div>
            <div style={{ flex: 1, overflow: 'auto' }}>
              {queue.map((id, i) => {
                const p = findPlayer(id);
                if (!p) return null;
                return (
                  <div className="queue-item" key={id}>
                    <span className="grip">≡</span>
                    <span className="num">{i + 1}</span>
                    <PlayerAvatar player={p} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div className="player-name" style={{ fontSize: 12 }}>{p.name}</div>
                      <div className="player-meta"><PosBadge pos={p.pos} /> {p.team} · ECR #{p.ecr}</div>
                    </div>
                    <button className="btn sm icon ghost" onClick={() => setQueue(queue.filter(x => x !== id))}>✕</button>
                  </div>
                );
              })}
              {queue.length === 0 && <div className="empty">Queue is empty.<br /><span className="faint" style={{ fontSize: 11 }}>Add players from the big board.</span></div>}
            </div>
          </div>

          {/* Pick Log */}
          <div style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            <div style={{ padding: '10px 14px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center' }}>
              <div className="card-title" style={{ flex: 1 }}>Pick Log</div>
              <span className="mono faint" style={{ fontSize: 10 }}>{CURRENT_PICK - 1}/192</span>
            </div>
            <div style={{ flex: 1, overflow: 'auto' }}>
              {allPicks.filter(pk => pk.playerId).slice().reverse().slice(0, 30).map(pk => {
                const p = findPlayer(pk.playerId);
                const t = LEAGUE_TEAMS.find(x => x.id === pk.teamId);
                if (!p || !t) return null;
                return (
                  <div key={pk.pickNum} style={{ padding: '8px 14px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 10, fontSize: 12, background: t.me ? 'rgba(198,255,58,.03)' : '' }}>
                    <div className="mono faint" style={{ width: 40, fontSize: 11 }}>{pk.round}.{pk.slot.toString().padStart(2, '0')}</div>
                    <PosBadge pos={p.pos} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div className="player-name" style={{ fontSize: 12 }}>{p.name} <span className="faint mono" style={{ fontSize: 10 }}>{p.team}</span></div>
                      <div className="player-meta" style={{ color: t.me ? 'var(--accent)' : 'var(--text-dim)' }}>→ {t.logo} {t.name}</div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      {/* RIGHT: Roster + Chat */}
      <div className="draft-roster">
        <div style={{ padding: '10px 14px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center' }}>
          <div className="ai-orb" style={{ width: 18, height: 18, background: 'var(--accent)', boxShadow: '0 0 8px var(--accent)' }}></div>
          <div className="card-title" style={{ flex: 1, marginLeft: 10 }}>Armed Rodgery</div>
          <div className="mono faint" style={{ fontSize: 11 }}>{myPicks.length}/16</div>
        </div>
        <div style={{ padding: '6px 0', maxHeight: '50%', overflow: 'auto' }}>
          {rosterSlots.map((rs, i) => {
            const myPicksOfPos = myPicks.filter(pk => findPlayer(pk.playerId)?.pos === rs.slot);
            const fillIdx = rosterSlots.slice(0, i).filter(x => x.slot === rs.slot).length;
            const filled = myPicksOfPos[fillIdx];
            const player = filled ? findPlayer(filled.playerId) : null;
            return (
              <div key={i} style={{ padding: '4px 14px', display: 'flex', alignItems: 'center', gap: 10, fontSize: 12, borderBottom: '1px solid var(--border)', minHeight: 40 }}>
                <span className={`pos-badge pos-${rs.slot}`} style={{ minWidth: 36 }}>{rs.slot}</span>
                {player ? (
                  <React.Fragment>
                    <PlayerAvatar player={player} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div className="player-name" style={{ fontSize: 12 }}>{player.name}</div>
                      <div className="player-meta">{player.team} · ECR #{player.ecr}</div>
                    </div>
                    <div className="mono faint" style={{ fontSize: 11 }}>R{filled.round}.{filled.slot}</div>
                  </React.Fragment>
                ) : (
                  <div className="faint" style={{ fontSize: 11, flex: 1 }}>empty</div>
                )}
              </div>
            );
          })}
        </div>

        <div style={{ borderTop: '1px solid var(--border)', display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden' }}>
          <div style={{ padding: '10px 14px', borderBottom: '1px solid var(--border)' }}>
            <div className="card-title">League Chat</div>
          </div>
          <div style={{ flex: 1, overflow: 'auto', padding: '8px 0' }}>
            {CHAT_MESSAGES.map((m, i) => (
              <div key={i} className="chat-msg" style={m.ai ? { borderLeft: '2px solid var(--accent)', background: 'rgba(198,255,58,.04)' } : {}}>
                <span className="ts">{m.ts}</span>
                <span className="who" style={{ color: m.color }}>{m.who}</span>
                <span>{m.msg}</span>
              </div>
            ))}
          </div>
          <div style={{ padding: 8, borderTop: '1px solid var(--border)' }}>
            <input className="input" placeholder="Type to chat..." style={{ width: '100%', fontSize: 12 }} />
          </div>
        </div>
      </div>

      {/* TEAMS GRID */}
      <div className="draft-teams">
        <div className="teams-grid">
          {teamsForCols.map((t, colIdx) => {
            if (!t) return null;
            const teamPicks = allPicks.filter(pk => pk.teamId === t.id);
            return (
              <div key={t.id} className={`team-col ${t.me ? 'me' : ''} ${t.id === onClockTeamId ? 'active' : ''}`}>
                <div className="hdr">
                  <span>#{colIdx + 1}</span>
                  <span className="pts">{Math.round(teamPicks.filter(p => p.playerId).reduce((s, p) => s + (findPlayer(p.playerId)?.avg || 0), 0))}</span>
                </div>
                <div className="team-name">{t.logo} {t.name}</div>
                {teamPicks.slice(0, 8).map(pk => {
                  if (!pk.playerId) return (
                    <div key={pk.pickNum} className="pick-cell empty"><span>R{pk.round}.{pk.slot}</span></div>
                  );
                  const p = findPlayer(pk.playerId);
                  if (!p) return null;
                  return (
                    <div key={pk.pickNum} className="pick-cell" style={{ borderLeftWidth: 2, borderLeftStyle: 'solid', borderLeftColor: `var(--pos-${p.pos.toLowerCase() === 'dst' ? 'dst' : p.pos.toLowerCase()})` }}>
                      <PosBadge pos={p.pos} />
                      <span className="nm">{p.name.split(' ').slice(-1)[0]}</span>
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>

      {showRecap && <DraftRecap round={currentRound - 1} onClose={() => setShowRecap(false)} />}
    </div>
  );
}

function DraftRecap({ round, onClose }) {
  const picks = DRAFT_PICKS.filter(p => p.round === round && p.playerId);
  const grades = LEAGUE_TEAMS.map(t => {
    const myPick = picks.find(p => p.teamId === t.id);
    const player = myPick ? findPlayer(myPick.playerId) : null;
    const value = player ? Math.round(((player.adp - myPick.pickNum) + 20) / 6) : 0;
    return {
      team: t, player, pickNum: myPick?.pickNum,
      grade: value > 4 ? 'A+' : value > 3 ? 'A' : value > 2 ? 'B+' : value > 1 ? 'B' : value > 0 ? 'C' : 'D',
      gradeColor: value > 3 ? 'var(--accent)' : value > 1 ? 'var(--warn)' : 'var(--danger)',
      delta: player ? player.adp - myPick.pickNum : 0,
    };
  });
  return (
    <div className="drawer-overlay" onClick={onClose}>
      <div style={{ position: 'fixed', inset: '60px', background: 'var(--bg-2)', border: '1px solid var(--border)', borderRadius: 12, padding: 24, overflow: 'auto', zIndex: 60 }} onClick={e => e.stopPropagation()}>
        <div className="flex" style={{ alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
          <div>
            <h1 style={{ fontFamily: 'var(--font-display)', fontStretch: '75%', fontWeight: 900, fontSize: 28, margin: 0, textTransform: 'uppercase' }}>Round {round} Recap</h1>
            <div className="sub dim" style={{ fontSize: 12, marginTop: 4 }}>FantasAI graded each pick by value vs ADP</div>
          </div>
          <button className="btn ghost" onClick={onClose}>Close ✕</button>
        </div>
        <table className="data-table">
          <thead><tr><th>Pick</th><th>Team</th><th>Player</th><th className="num">ADP</th><th className="num">Δ</th><th className="num">Grade</th><th>Take</th></tr></thead>
          <tbody>
            {grades.filter(g => g.player).sort((a, b) => a.pickNum - b.pickNum).map(g => (
              <tr key={g.team.id}>
                <td className="mono">{Math.ceil(g.pickNum / 12)}.{((g.pickNum - 1) % 12) + 1}</td>
                <td className="player-cell" style={{ padding: '8px 14px' }}>
                  <div className="avatar" style={{ background: g.team.color, color: '#fff' }}>{g.team.logo}</div>
                  <div className="player-name">{g.team.name}</div>
                </td>
                <td><PlayerCell player={g.player} /></td>
                <td className="num">{g.player.adp.toFixed(1)}</td>
                <td className="num" style={{ color: g.delta > 0 ? 'var(--good)' : g.delta < -5 ? 'var(--danger)' : 'var(--text-dim)' }}>
                  {g.delta > 0 ? '+' : ''}{g.delta.toFixed(1)}
                </td>
                <td className="num"><span style={{ fontFamily: 'var(--font-display)', fontStretch: '75%', fontWeight: 900, fontSize: 18, color: g.gradeColor }}>{g.grade}</span></td>
                <td className="dim" style={{ fontSize: 11 }}>
                  {g.delta > 5 ? 'Massive value — fell past ADP' : g.delta > 0 ? 'Solid pick at right spot' : g.delta < -5 ? 'Reach — gone earlier than expected' : 'On target'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function GhostTarget({ g, rank, compact, isMe }) {
  const p = g.player;
  return (
    <div className={`ghost-target rank-${rank} ${compact ? 'compact' : ''} ${isMe ? 'me' : ''}`} title={`${p.name} · ${g.likelihood}% likely`}>
      <span className={`pos-badge pos-${p.pos}`}>{p.pos}</span>
      <span className="ghost-name">{compact ? p.name.split(' ').slice(-1)[0] : p.name}</span>
      <span className="ghost-pct mono">{g.likelihood}%</span>
    </div>
  );
}
