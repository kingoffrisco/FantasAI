import React from 'react';
import { findTeam, LEAGUE_TEAMS, TEAM_ROSTERS } from '../lib/data.js';
import { findPlayer } from '../lib/playerStore.js';
import { PosBadge, PlayerAvatar, TeamLogoBadge } from '../components/ui.jsx';

function getTeamAllPlayerIds(teamId) {
  return (TEAM_ROSTERS[teamId] || []).filter(r => r.playerId).map(r => r.playerId);
}

export default function TradeScreen({ initOtherTeamId, initGetIds = [], myRosterIds = new Set(), user, onSendTradeOffer, tradeOffers = [], onRespondTradeOffer, onDeleteTradeOffer }) {
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
  const [offerComments, setOfferComments] = React.useState({});

  // Outgoing: offers this owner sent, still pending or resolved
  const sentOffers = tradeOffers.filter(o => o.fromTeamId === myTeamId);
  // Incoming: pending offers addressed to this owner awaiting approval
  const incomingOffers = tradeOffers.filter(o => o.toTeamId === myTeamId && o.status === 'pending');

  function reset() {
    setOtherTeam(defaultOther);
    setMyGive([]);
    setMyGet(initGetIds.filter(id => findPlayer(id)));
    setOfferSent(false);
  }

  function sendOffer() {
    if (!bothSided) return;
    const offer = {
      id: Date.now(),
      sentAt: Date.now(),
      fromTeamId: myTeamId,
      toTeamId: otherTeam,
      giveIds: [...myGive],
      getIds: [...myGet],
      grade,
      diff: parseFloat(diff.toFixed(1)),
      status: 'pending',
    };
    onSendTradeOffer?.(offer);
    setOfferSent(true);
  }

  return (
    <div className="col" style={{ height: '100%', overflow: 'auto' }}>
      <div className="page-head">
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div>
            <h1>Trade Analyzer</h1>
            <div className="sub">Build a multi-player offer · FantasAI grades the deal</div>
          </div>
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

      {/* ── FantasAI Deep Evaluator ── */}
      {bothSided && (() => {
        // Position impact analysis
        const givePosMap = {};
        const getPosMap  = {};
        for (const id of myGive) { const p = findPlayer(id); if (p) givePosMap[p.pos] = (givePosMap[p.pos] || 0) + 1; }
        for (const id of myGet)  { const p = findPlayer(id); if (p) getPosMap[p.pos]  = (getPosMap[p.pos]  || 0) + 1; }

        // Roster depth: how many of each pos do we have?
        const myPosDepth = {};
        for (const id of myRosterArr) { const p = findPlayer(id); if (p) myPosDepth[p.pos] = (myPosDepth[p.pos] || 0) + 1; }

        // Identify needs: pos with 1 or fewer players after give
        const needs = [];
        for (const [pos, cnt] of Object.entries(myPosDepth)) {
          const afterGive = cnt - (givePosMap[pos] || 0);
          if (afterGive <= 1 && !getPosMap[pos]) needs.push(pos);
        }
        // Identify upgrades: getting high-avg players
        const topGet = myGet.map(id => findPlayer(id)).filter(Boolean).sort((a, b) => (b.avg || 0) - (a.avg || 0));

        // Age/upside analysis
        const avgAgeGive = myGive.map(id => findPlayer(id)).filter(Boolean).reduce((s, p, _, a) => s + (p.age || 27) / a.length, 0);
        const avgAgeGet  = myGet.map(id => findPlayer(id)).filter(Boolean).reduce((s, p, _, a) => s + (p.age || 27) / a.length, 0);
        const isYounger  = avgAgeGet < avgAgeGive - 1;
        const isOlder    = avgAgeGet > avgAgeGive + 1;

        // Trade type classification
        const tradeType = diff > 3 ? 'value-win'
          : diff < -3 ? 'value-loss'
          : isYounger ? 'win-now-for-youth'
          : needs.length > 0 ? 'depth-risk'
          : 'balanced';

        const typeLabels = {
          'value-win':         { label: 'Clear Win',       color: '#c6ff3a', icon: '🏆' },
          'value-loss':        { label: 'Overpay Risk',    color: '#ff5a6e', icon: '⚠️' },
          'win-now-for-youth': { label: 'Youth Upside',    color: '#4ea8ff', icon: '📈' },
          'depth-risk':        { label: 'Depth Risk',      color: '#ff9500', icon: '⚡' },
          'balanced':          { label: 'Balanced Offer',  color: 'var(--text-dim)', icon: '⚖️' },
        };
        const typeMeta = typeLabels[tradeType];

        // Recommendation text
        const topGetName  = topGet[0]?.name ?? 'the player';
        const posNeed     = Object.keys(getPosMap)[0] ?? '';
        let recommendation = '';
        if (diff > 5)  recommendation = `Strong accept — ${topGetName} significantly upgrades your starting lineup.`;
        else if (diff > 1) recommendation = `Lean accept — you improve your ${posNeed || 'overall'} scoring average.`;
        else if (diff > -2) recommendation = `Coin flip. Consider roster depth and schedule before deciding.`;
        else if (diff > -5) recommendation = `Lean decline — you're giving more value than you receive.`;
        else recommendation = `Decline — significant value imbalance. Counter-offer with fewer assets.`;
        if (needs.length > 0) recommendation += ` Watch out: trading away ${needs.join('/')} leaves you thin there.`;

        const insights = [
          { label: 'Avg Pts Differential', value: `${diff > 0 ? '+' : ''}${diff.toFixed(1)} pts/wk`, color: diff > 0 ? '#c6ff3a' : '#ff5a6e' },
          { label: 'Position Balance', value: Object.keys(getPosMap).join(', ') || '—', color: 'var(--text-dim)' },
          { label: 'Roster Depth Risk', value: needs.length > 0 ? `Thin at ${needs.join(', ')}` : 'Acceptable', color: needs.length > 0 ? '#ff9500' : '#4caf82' },
          { label: 'Age / Upside', value: isYounger ? 'Getting younger (+upside)' : isOlder ? 'Getting older (win-now)' : 'Similar age range', color: isYounger ? '#4ea8ff' : 'var(--text-dim)' },
        ];

        return (
          <div style={{ padding: '0 24px 16px' }}>
            <div style={{ background: 'rgba(198,255,58,.04)', border: '1px solid rgba(198,255,58,.2)', borderRadius: 12, padding: '16px 20px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
                <span style={{ fontSize: 16 }}>{typeMeta.icon}</span>
                <div>
                  <div style={{ fontWeight: 800, fontSize: 13 }}>
                    <span style={{ background: 'rgba(198,255,58,.15)', color: 'var(--accent)', fontSize: 9, fontFamily: 'var(--font-mono)', padding: '1px 5px', borderRadius: 3, fontWeight: 700, marginRight: 6, verticalAlign: 'middle' }}>AI</span>
                    FantasAI Deep Evaluator
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text-faint)', marginTop: 2 }}>Multi-factor trade analysis</div>
                </div>
                <div style={{ marginLeft: 'auto' }}>
                  <span style={{ fontSize: 10, fontFamily: 'var(--font-mono)', fontWeight: 700, color: typeMeta.color, background: typeMeta.color + '22', border: `1px solid ${typeMeta.color}55`, borderRadius: 4, padding: '3px 10px' }}>
                    {typeMeta.label}
                  </span>
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 8, marginBottom: 14 }}>
                {insights.map(ins => (
                  <div key={ins.label} style={{ background: 'var(--panel)', borderRadius: 8, padding: '8px 12px', border: '1px solid var(--border)' }}>
                    <div style={{ fontSize: 9, color: 'var(--text-faint)', fontFamily: 'var(--font-mono)', textTransform: 'uppercase', letterSpacing: '.08em', marginBottom: 3 }}>{ins.label}</div>
                    <div style={{ fontWeight: 700, fontSize: 12, color: ins.color }}>{ins.value}</div>
                  </div>
                ))}
              </div>

              <div style={{ background: 'var(--panel)', borderRadius: 8, padding: '10px 14px', border: '1px solid var(--border)' }}>
                <div style={{ fontSize: 9, color: 'var(--accent)', fontFamily: 'var(--font-mono)', textTransform: 'uppercase', letterSpacing: '.08em', fontWeight: 700, marginBottom: 6 }}>◆ Recommendation</div>
                <div style={{ fontSize: 13, color: 'var(--text)', lineHeight: 1.65 }}>{recommendation}</div>
              </div>
            </div>
          </div>
        );
      })()}

      {/* ── Incoming offers awaiting my approval ── */}
      {incomingOffers.length > 0 && (
        <div style={{ padding: '0 24px 8px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#FFD700', flexShrink: 0 }} />
            <div style={{ fontSize: 13, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '.08em', color: '#FFD700' }}>
              Pending — Awaiting Your Approval
            </div>
            <span style={{ fontSize: 11, fontFamily: 'var(--font-mono)', background: '#FFD70022', color: '#FFD700', border: '1px solid #FFD70044', borderRadius: 4, padding: '1px 7px' }}>
              {incomingOffers.length}
            </span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {incomingOffers.map(offer => {
              const fromTeam = findTeam(offer.fromTeamId);
              const sentDate = new Date(offer.sentAt);
              const timeStr  = sentDate.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
              return (
                <div key={offer.id} style={{ borderRadius: 10, border: '2px solid rgba(255,215,0,.4)', background: 'rgba(255,215,0,.04)', overflow: 'hidden' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', borderBottom: '1px solid rgba(255,215,0,.2)', background: 'rgba(255,215,0,.06)' }}>
                    {fromTeam?.color && <span style={{ width: 8, height: 8, borderRadius: '50%', background: fromTeam.color, flexShrink: 0 }} />}
                    <span style={{ fontWeight: 700, fontSize: 13, flex: 1 }}>From: {fromTeam?.name ?? `Team ${offer.fromTeamId}`}</span>
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-faint)' }}>{timeStr}</span>
                  </div>
                  <TradeOfferPlayers
                    giveLabel="They Give You"
                    getLabel="You Give Them"
                    giveIds={offer.getIds}
                    getIds={offer.giveIds}
                  />
                  <div style={{ padding: '10px 14px', borderTop: '1px solid rgba(255,215,0,.2)', background: 'rgba(255,215,0,.02)' }}>
                    <textarea
                      value={offerComments[offer.id] || ''}
                      onChange={e => setOfferComments(prev => ({ ...prev, [offer.id]: e.target.value }))}
                      placeholder="Add a comment to your response (optional)…"
                      rows={2}
                      style={{ width: '100%', boxSizing: 'border-box', resize: 'vertical', background: 'var(--panel)', border: '1px solid rgba(255,215,0,.25)', borderRadius: 6, color: 'var(--text)', fontSize: 12, padding: '7px 10px', fontFamily: 'inherit', outline: 'none' }}
                    />
                  </div>
                  <div style={{ display: 'flex', gap: 10, padding: '10px 14px', borderTop: '1px solid rgba(255,215,0,.2)', background: 'rgba(255,215,0,.04)' }}>
                    <button
                      className="btn primary"
                      style={{ flex: 1, background: 'var(--good)', color: '#001a0a', fontWeight: 800 }}
                      onClick={() => onRespondTradeOffer?.(offer.id, 'accepted', offerComments[offer.id] || '')}
                    >
                      ✓ Approve Trade — Swap Players Now
                    </button>
                    <button
                      className="btn ghost"
                      style={{ flex: 1, borderColor: 'var(--danger)', color: 'var(--danger)' }}
                      onClick={() => onRespondTradeOffer?.(offer.id, 'declined', offerComments[offer.id] || '')}
                    >
                      ✕ Decline
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Sent offers history ── */}
      {sentOffers.length > 0 && (
        <div style={{ padding: '0 24px 32px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
            <div>
              <div style={{ fontSize: 13, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '.08em', color: 'var(--text)' }}>
                Offers Sent
              </div>
              <div style={{ fontSize: 11, color: 'var(--text-faint)', marginTop: 2 }}>{sentOffers.length} offer{sentOffers.length !== 1 ? 's' : ''}</div>
            </div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {sentOffers.map(offer => {
              const toTeam = findTeam(offer.toTeamId);
              const gradeColor = !offer.grade || offer.grade === '—' ? 'var(--text-faint)'
                : offer.diff > 1 ? 'var(--good)' : offer.diff > -2 ? 'var(--warn)' : 'var(--danger)';
              const sentDate = new Date(offer.sentAt);
              const timeStr  = sentDate.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
              const statusColor = offer.status === 'accepted' ? 'var(--good)' : offer.status === 'declined' ? 'var(--danger)' : offer.status === 'cancelled' ? 'var(--text-faint)' : '#FFD700';
              const statusLabel = offer.status === 'accepted' ? 'Trade Accepted' : offer.status === 'declined' ? '✕ Declined' : offer.status === 'cancelled' ? 'Trade Cancelled' : '⏳ Pending';
              return (
                <div key={offer.id} style={{ borderRadius: 10, border: '1px solid var(--border)', background: 'var(--panel-2)', overflow: 'hidden' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', borderBottom: '1px solid var(--border)', background: 'var(--panel)' }}>
                    {toTeam?.color && <span style={{ width: 8, height: 8, borderRadius: '50%', background: toTeam.color, flexShrink: 0 }} />}
                    <span style={{ fontWeight: 700, fontSize: 13, flex: 1 }}>To: {toTeam?.name ?? `Team ${offer.toTeamId}`}</span>
                    <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 800, fontSize: 12, color: statusColor }}>{statusLabel}</span>
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-faint)', marginLeft: 6 }}>{timeStr}</span>
                    <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 800, fontSize: 13, color: gradeColor, marginLeft: 6 }}>{offer.grade}</span>
                    <button
                      onClick={() => onDeleteTradeOffer?.(offer.id)}
                      style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-faint)', fontSize: 14, padding: '0 0 0 6px', lineHeight: 1 }}
                    >✕</button>
                  </div>
                  <TradeOfferPlayers giveLabel="You Give" getLabel="You Get" giveIds={offer.giveIds} getIds={offer.getIds} />
                  <div style={{ padding: '7px 14px', borderTop: '1px solid var(--border)', background: 'var(--panel)', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                    <span style={{ fontSize: 11, color: 'var(--text-faint)', fontFamily: 'var(--font-mono)', flex: 1 }}>
                      Net avg/wk:{' '}
                      <span style={{ color: gradeColor, fontWeight: 700 }}>{offer.diff > 0 ? '+' : ''}{offer.diff} pts</span>
                      {offer.diff > 0 ? ' · favorable' : offer.diff < -2 ? ' · unfavorable' : ' · roughly even'}
                      {offer.status === 'pending' && <span style={{ marginLeft: 10, color: '#FFD700' }}>Waiting for {toTeam?.name ?? 'other owner'}…</span>}
                    </span>
                    {offer.status === 'pending' && (
                      <button
                        onClick={() => onRespondTradeOffer?.(offer.id, 'cancelled')}
                        style={{ fontSize: 11, fontWeight: 700, cursor: 'pointer', background: 'none', border: '1px solid var(--danger)', borderRadius: 5, color: 'var(--danger)', padding: '3px 10px', flexShrink: 0 }}
                      >
                        Cancel Trade
                      </button>
                    )}
                  </div>
                  {offer.responseComment && (
                    <div style={{ padding: '7px 14px', borderTop: '1px solid var(--border)', background: 'rgba(0,0,0,.1)' }}>
                      <span style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '.06em' }}>
                        {toTeam?.name ?? 'Their'} comment:{' '}
                      </span>
                      <span style={{ fontSize: 12, color: 'var(--text-dim)', fontStyle: 'italic' }}>{offer.responseComment}</span>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function TradeOfferPlayers({ giveLabel, getLabel, giveIds, getIds }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr auto 1fr' }}>
      <div style={{ padding: '10px 14px' }}>
        <div style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '.08em', marginBottom: 6 }}>{giveLabel}</div>
        {giveIds.map(id => { const p = findPlayer(id); return p ? (
          <div key={id} style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
            <PosBadge pos={p.pos} />
            <span style={{ fontSize: 14, fontWeight: 600 }}>{p.name}</span>
            <span style={{ fontSize: 10, color: 'var(--text-faint)', fontFamily: 'var(--font-mono)' }}>{p.avg.toFixed(1)}</span>
          </div>
        ) : null; })}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '10px 8px', color: 'var(--text-faint)', fontSize: 18 }}>⇄</div>
      <div style={{ padding: '10px 14px', borderLeft: '1px solid var(--border)' }}>
        <div style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '.08em', marginBottom: 6 }}>{getLabel}</div>
        {getIds.map(id => { const p = findPlayer(id); return p ? (
          <div key={id} style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
            <PosBadge pos={p.pos} />
            <span style={{ fontSize: 14, fontWeight: 600 }}>{p.name}</span>
            <span style={{ fontSize: 11, color: 'var(--text-faint)', fontFamily: 'var(--font-mono)' }}>{p.avg.toFixed(1)}</span>
          </div>
        ) : null; })}
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
