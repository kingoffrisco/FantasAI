import React from 'react';
import { findPlayer, findTeam, LEAGUE_TEAMS, TEAM_ROSTERS } from '../lib/data.js';
import { PosBadge, PlayerAvatar } from '../components/ui.jsx';

function getTeamAllPlayerIds(teamId) {
  return (TEAM_ROSTERS[teamId] || []).filter(r => r.playerId).map(r => r.playerId);
}

export default function TradeScreen({ initOtherTeamId, initGetIds = [], myRosterIds = new Set(), user, onSendTradeOffer }) {
  const myTeamObj = (user?.teamId ? findTeam(user.teamId) : null) ?? LEAGUE_TEAMS.find(t => t.me);
  const myTeamId  = myTeamObj?.id;

  const defaultOther = initOtherTeamId
    ?? LEAGUE_TEAMS.find(t => t.id !== myTeamId)?.id
    ?? 2;

  const [otherTeam, setOtherTeam] = React.useState(defaultOther);
  const [myGive,    setMyGive]    = React.useState([]);
  const [myGet,     setMyGet]     = React.useState(() => initGetIds.filter(id => findPlayer(id)));

  const otherTeamObj       = findTeam(otherTeam);
  const otherRosterIds     = getTeamAllPlayerIds(otherTeam);
  const myRosterArr        = [...myRosterIds].filter(id => findPlayer(id));

  const giveOptions = myRosterArr.filter(id => !myGive.includes(id));
  const getOptions  = otherRosterIds.filter(id => !myGet.includes(id) && findPlayer(id));

  const giveTotal  = myGive.reduce((s, id) => s + (findPlayer(id)?.avg || 0), 0);
  const getTotal   = myGet.reduce((s, id)  => s + (findPlayer(id)?.avg || 0), 0);
  const diff       = getTotal - giveTotal;
  const bothSided  = myGive.length > 0 && myGet.length > 0;
  const grade      = !bothSided ? '—'
    : diff > 5 ? 'A+' : diff > 3 ? 'A' : diff > 1 ? 'B+' : diff > -1 ? 'B'
    : diff > -3 ? 'C+' : diff > -5 ? 'C' : 'D';
  const gradeColor = !bothSided ? 'var(--text-faint)'
    : diff > 1 ? 'var(--good)' : diff > -2 ? 'var(--warn)' : 'var(--danger)';

  function addGive(e) {
    const id = parseInt(e.target.value);
    if (id && !myGive.includes(id)) setMyGive(p => [...p, id]);
    e.target.value = '';
  }

  function addGet(e) {
    const id = parseInt(e.target.value);
    if (id && !myGet.includes(id)) setMyGet(p => [...p, id]);
    e.target.value = '';
  }

  function changeTeam(newId) {
    setOtherTeam(newId);
    // Only clear players that don't belong to the new team
    const newRoster = new Set(getTeamAllPlayerIds(newId));
    setMyGet(prev => prev.filter(id => newRoster.has(id)));
  }

  const [offerSent, setOfferSent] = React.useState(false);

  function reset() {
    setOtherTeam(defaultOther);
    setMyGive([]);
    setMyGet(initGetIds.filter(id => findPlayer(id)));
    setOfferSent(false);
  }

  function sendOffer() {
    if (!bothSided) return;
    onSendTradeOffer?.({ fromTeamId: myTeamId, toTeamId: otherTeam, giveIds: myGive, getIds: myGet });
    setOfferSent(true);
  }

  return (
    <div className="col" style={{ height: '100%', overflow: 'auto' }}>
      <div className="page-head">
        <div>
          <h1>Trade Analyzer</h1>
          <div className="sub">Build a multi-player offer · FantasAI grades the deal</div>
        </div>
        <div className="flex gap-8" style={{ alignItems: 'center' }}>
          {offerSent && (
            <span style={{ fontSize: 12, fontWeight: 700, color: '#4caf82', display: 'flex', alignItems: 'center', gap: 5 }}>
              ✓ Offer sent to {otherTeamObj?.name}
            </span>
          )}
          <button className="btn ghost" onClick={reset}>Reset</button>
          <button className="btn primary" disabled={!bothSided || offerSent} onClick={sendOffer}>
            {offerSent ? 'Offer Sent' : 'Send Offer'}
          </button>
        </div>
      </div>

      {/* Team selector */}
      <div style={{ padding: '4px 24px 0' }}>
        <select
          className="input"
          value={otherTeam}
          onChange={e => changeTeam(parseInt(e.target.value))}
          style={{ maxWidth: 380, fontSize: 13 }}
        >
          {LEAGUE_TEAMS.filter(t => t.id !== myTeamId).map(t => (
            <option key={t.id} value={t.id}>Trade with: {t.name}</option>
          ))}
        </select>
      </div>

      <div className="trade-panels">
        {/* YOU GIVE */}
        <TradePanel
          title="You Give"
          subtitle={myTeamObj?.name || 'Your Team'}
          color={myTeamObj?.color}
          players={myGive}
          onRemove={id => setMyGive(p => p.filter(x => x !== id))}
          total={giveTotal}
          options={giveOptions}
          onAdd={addGive}
          addLabel="+ Add your player…"
          emptyLabel={myRosterArr.length === 0 ? 'No roster loaded' : 'All your players selected'}
          side="me"
        />

        {/* YOU GET */}
        <TradePanel
          title="You Get"
          subtitle={otherTeamObj?.name}
          color={otherTeamObj?.color}
          players={myGet}
          onRemove={id => setMyGet(p => p.filter(x => x !== id))}
          total={getTotal}
          options={getOptions}
          onAdd={addGet}
          addLabel="+ Add their player…"
          emptyLabel={otherRosterIds.length === 0 ? 'No roster data for this team' : 'All their players selected'}
        />
      </div>

      {/* Grade */}
      <div className="trade-grade">
        <div>
          <div style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 10, letterSpacing: '.12em', textTransform: 'uppercase', color: 'var(--text-faint)' }}>FantasAI Grade</div>
          <div className="grade-letter" style={{ color: gradeColor }}>{grade}</div>
        </div>
        <div style={{ flex: 1 }}>
          {bothSided ? (
            <>
              <div style={{ fontSize: 13, lineHeight: 1.65 }}>
                <strong>
                  {diff > 1 ? 'Favorable for you.' : diff < -2 ? 'Unfavorable — you lose value.' : 'Roughly even on paper.'}
                </strong>
                {' '}You {diff >= 0 ? 'gain' : 'lose'} <span style={{ color: gradeColor, fontWeight: 700 }}>{Math.abs(diff).toFixed(1)} avg pts/week</span> across all positions.
              </div>
              <div className="flex gap-8" style={{ marginTop: 12 }}>
                <div className="stat" style={{ padding: 8, flex: 1 }}>
                  <div className="k">Avg Δ / wk</div>
                  <div className="v" style={{ fontSize: 14, color: gradeColor }}>{diff > 0 ? '+' : ''}{diff.toFixed(1)}</div>
                </div>
                <div className="stat" style={{ padding: 8, flex: 1 }}>
                  <div className="k">You Give</div>
                  <div className="v" style={{ fontSize: 14 }}>{myGive.length} player{myGive.length !== 1 ? 's' : ''}</div>
                </div>
                <div className="stat" style={{ padding: 8, flex: 1 }}>
                  <div className="k">You Get</div>
                  <div className="v" style={{ fontSize: 14 }}>{myGet.length} player{myGet.length !== 1 ? 's' : ''}</div>
                </div>
                <div className="stat" style={{ padding: 8, flex: 1 }}>
                  <div className="k">Playoff Odds</div>
                  <div className="v" style={{ fontSize: 14, color: diff > 0 ? 'var(--good)' : 'var(--danger)' }}>
                    {diff > 0 ? '+' : ''}{(diff * 0.8).toFixed(1)}%
                  </div>
                </div>
              </div>
            </>
          ) : (
            <div style={{ fontSize: 13, color: 'var(--text-dim)', lineHeight: 1.65 }}>
              Add at least one player to each side to see the trade grade.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function TradePanel({ title, subtitle, color, players, onRemove, total, options, onAdd, addLabel, emptyLabel, side }) {
  return (
    <div className={`trade-panel${side === 'me' ? ' me' : ''}`}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
        <div>
          <div className="card-title">{title}</div>
          {subtitle && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginTop: 3 }}>
              {color && <span style={{ width: 8, height: 8, borderRadius: '50%', background: color, display: 'inline-block', flexShrink: 0 }} />}
              <span style={{ fontSize: 11, color: 'var(--text-dim)' }}>{subtitle}</span>
            </div>
          )}
        </div>
        <div className="mono dim" style={{ fontSize: 11, paddingTop: 2 }}>
          {players.length > 0 ? `${total.toFixed(1)} avg/wk` : '—'}
        </div>
      </div>

      {players.map(id => {
        const p = findPlayer(id);
        if (!p) return null;
        return (
          <div className="trade-slot" key={id}>
            <PlayerAvatar player={p} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="player-name">{p.name}</div>
              <div className="player-meta"><PosBadge pos={p.pos} /> {p.team} · {p.avg.toFixed(1)} avg/wk</div>
            </div>
            <button className="btn sm ghost" onClick={() => onRemove(id)}>✕</button>
          </div>
        );
      })}

      {options.length > 0 ? (
        <select
          className="input"
          style={{ marginTop: players.length > 0 ? 8 : 0, fontSize: 12 }}
          defaultValue=""
          onChange={onAdd}
        >
          <option value="">{addLabel}</option>
          {options.map(id => {
            const p = findPlayer(id);
            if (!p) return null;
            return (
              <option key={id} value={id}>
                {p.name} · {p.pos} · {p.team} · {p.avg.toFixed(1)} avg
              </option>
            );
          })}
        </select>
      ) : players.length === 0 ? (
        <div className="trade-slot empty">{emptyLabel}</div>
      ) : (
        <div className="trade-slot empty" style={{ opacity: .5 }}>All players selected</div>
      )}
    </div>
  );
}
