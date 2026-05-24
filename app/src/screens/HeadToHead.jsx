import React from 'react';
import { LEAGUE_TEAMS, TEAM_ROSTERS, ROSTER_CONFIG, findPlayer } from '../lib/data.js';
import { PosBadge } from '../components/ui.jsx';

function isRosterSet(teamId, myRosterIds, slotOverrides) {
  let roster;
  if (myRosterIds && slotOverrides !== undefined) {
    // Build live roster for the current user's team
    roster = [...myRosterIds].filter(id => findPlayer(id)).map(id => {
      const override = slotOverrides[id];
      const base = (TEAM_ROSTERS[teamId] || []).find(r => r.playerId === id);
      return { playerId: id, slot: override ?? base?.slot ?? 'BENCH' };
    });
    // Also include static slots so empty starters from TEAM_ROSTERS are accounted for
  } else {
    roster = TEAM_ROSTERS[teamId] || [];
  }
  const starters  = roster.filter(r => r.slot !== 'BENCH' && r.playerId);
  const has       = slot => starters.some(r => r.slot === slot);
  const count     = slot => starters.filter(r => r.slot === slot).length;
  if (!has('QB') || !has('DST') || count('RB') < 1 || count('WR') < 1) return false;
  const flexEligible = starters.filter(r => ['RB', 'WR', 'TE', 'FLEX'].includes(r.slot)).length;
  return flexEligible >= 5;
}

const NUM_WEEKS = 14;

// Determine current NFL week from real date (regular season starts ~Sep 9, 2026)
function getCurrentNFLWeek() {
  const SEASON_START = new Date('2026-09-09');
  const today = new Date();
  if (today < SEASON_START) return 1;
  const msPerWeek = 7 * 24 * 60 * 60 * 1000;
  const week = Math.floor((today - SEASON_START) / msPerWeek) + 1;
  return Math.min(Math.max(week, 1), NUM_WEEKS);
}

const CURRENT_WEEK = getCurrentNFLWeek();

// Standard round-robin for 12 teams — fix team[0], rotate rest
function buildSchedule(ids, weeks) {
  const n = ids.length;
  const schedule = [];
  for (let w = 0; w < weeks; w++) {
    const rest    = ids.slice(1);
    const rot     = w % (n - 1);
    const rotated = [...rest.slice(rot), ...rest.slice(0, rot)];
    const circle  = [ids[0], ...rotated];
    const matchups = [];
    for (let i = 0; i < n / 2; i++) matchups.push([circle[i], circle[n - 1 - i]]);
    schedule.push(matchups);
  }
  return schedule;
}

// Deterministic pseudo-variance so each week's scores differ
function weekSeed(teamId, week) {
  return Math.sin(teamId * 7.3 + week * 3.1) * 18 + Math.cos(teamId * 2.1 + week * 5.7) * 8;
}

function computeScore(teamId, week) {
  const roster  = TEAM_ROSTERS[teamId] || [];
  const starters = roster.filter(r => r.slot !== 'BENCH');
  const base = starters.reduce((sum, entry) => {
    const p = entry.playerId ? findPlayer(entry.playerId) : null;
    return sum + (p ? (p.avg || 0) : 0);
  }, 0);
  const raw = base + weekSeed(teamId, week);
  return Math.max(0, Math.round(raw * 10) / 10);
}

// Parse "7-3" → { w:7, l:3 }
function parseRecord(r = '0-0') {
  const [w, l] = r.split('-').map(Number);
  return { w: w || 0, l: l || 0 };
}

const SCHEDULE = buildSchedule(LEAGUE_TEAMS.map(t => t.id), NUM_WEEKS);

export default function HeadToHeadScreen({ onOpenPlayer, user, myRosterIds, slotOverrides }) {
  const [week, setWeek] = React.useState(CURRENT_WEEK);
  const [expanded, setExpanded] = React.useState(null);

  const myTeamId = user?.teamId ?? LEAGUE_TEAMS.find(t => t.me)?.id;
  const matchups = SCHEDULE[week - 1] || [];

  const standings = React.useMemo(() => {
    return LEAGUE_TEAMS.map(t => {
      const rec = parseRecord(t.record);
      return { ...t, ...rec, pf: t.pf || 0, pa: t.pa || 0 };
    }).sort((a, b) => (b.w - a.w) || (b.pf - a.pf));
  }, []);

  return (
    <div style={{ padding: '20px 24px', maxWidth: 1100, display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div className="page-head" style={{ paddingLeft: 0, paddingRight: 0, paddingTop: 0 }}>
        <div>
          <h1 style={{ marginBottom: 2 }}>Head to Head</h1>
          <div className="sub">Weekly matchup results · scores computed from starter stats per league rules</div>
        </div>
      </div>

      {/* Week tabs */}
      <div style={{ display: 'flex', gap: 4, overflowX: 'auto', paddingBottom: 2 }}>
        {Array.from({ length: NUM_WEEKS }, (_, i) => i + 1).map(w => (
          <button
            key={w}
            onClick={() => { setWeek(w); setExpanded(null); }}
            style={{
              flexShrink: 0, padding: '5px 12px', borderRadius: 6, fontSize: 12, fontWeight: 600,
              cursor: 'pointer', border: '1px solid var(--border)',
              background: w === week ? 'var(--accent)' : w < CURRENT_WEEK ? 'var(--panel)' : 'transparent',
              color: w === week ? 'var(--accent-ink)' : w < CURRENT_WEEK ? 'var(--text)' : 'var(--text-dim)',
            }}
          >
            {w === CURRENT_WEEK ? `Wk ${w} ●` : `Wk ${w}`}
          </button>
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 280px', gap: 20, alignItems: 'start' }}>
        {/* Matchup cards */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-faint)', letterSpacing: '.1em', textTransform: 'uppercase', marginBottom: 2 }}>
            Week {week} · {week < CURRENT_WEEK ? 'Final' : week === CURRENT_WEEK ? 'In Progress' : 'Upcoming'}
          </div>
          {matchups.map(([homeId, awayId], idx) => (
            <MatchupCard
              key={idx}
              homeId={homeId}
              awayId={awayId}
              week={week}
              isLive={week === CURRENT_WEEK}
              isFinal={week < CURRENT_WEEK}
              expanded={expanded === idx}
              onToggle={() => setExpanded(expanded === idx ? null : idx)}
              onOpenPlayer={onOpenPlayer}
              myTeamId={myTeamId}
              myRosterIds={myRosterIds}
              slotOverrides={slotOverrides}
            />
          ))}
        </div>

        {/* Standings */}
        <div className="card" style={{ position: 'sticky', top: 0 }}>
          <div className="card-head">
            <div className="card-title">Standings</div>
          </div>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border)' }}>
                <th style={{ padding: '6px 12px', textAlign: 'left', color: 'var(--text-faint)', fontWeight: 600, fontSize: 10, letterSpacing: '.08em' }}>#</th>
                <th style={{ padding: '6px 4px', textAlign: 'left', color: 'var(--text-faint)', fontWeight: 600, fontSize: 10 }}>Team</th>
                <th style={{ padding: '6px 8px', textAlign: 'center', color: 'var(--text-faint)', fontWeight: 600, fontSize: 10 }}>W–L</th>
                <th style={{ padding: '6px 12px', textAlign: 'right', color: 'var(--text-faint)', fontWeight: 600, fontSize: 10 }}>PF</th>
              </tr>
            </thead>
            <tbody>
              {standings.map((t, i) => {
                const isMe = t.id === myTeamId;
                return (
                  <tr key={t.id} style={{ borderBottom: '1px solid var(--border)', background: isMe ? 'rgba(198,255,58,.13)' : 'transparent', borderLeft: isMe ? '3px solid var(--accent)' : '3px solid transparent' }}>
                    <td style={{ padding: '7px 12px', color: isMe ? 'var(--accent)' : 'var(--text-faint)', fontWeight: 700 }}>{i + 1}</td>
                    <td style={{ padding: '7px 4px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span style={{ width: 22, height: 22, borderRadius: 4, background: t.color, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 8, fontWeight: 900, color: '#000', flexShrink: 0 }}>{t.logo}</span>
                        <span style={{ fontSize: 11, fontWeight: isMe ? 700 : 400, color: isMe ? 'var(--accent)' : 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 100 }}>{t.name}</span>
                        {isMe && <span style={{ fontSize: 8, fontFamily: 'var(--font-mono)', color: 'var(--accent-ink)', background: 'var(--accent)', borderRadius: 3, padding: '1px 4px', fontWeight: 800, flexShrink: 0 }}>YOU</span>}
                      </div>
                    </td>
                    <td style={{ padding: '7px 8px', textAlign: 'center', fontFamily: 'var(--font-mono)', fontSize: 11, fontWeight: isMe ? 700 : 400 }}>{t.w}–{t.l}</td>
                    <td style={{ padding: '7px 12px', textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: 11, color: isMe ? 'var(--accent)' : 'var(--text-dim)' }}>{t.pf.toFixed(1)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function MatchupCard({ homeId, awayId, week, isLive, isFinal, expanded, onToggle, onOpenPlayer, myTeamId, myRosterIds, slotOverrides }) {
  const home         = LEAGUE_TEAMS.find(t => t.id === homeId);
  const away         = LEAGUE_TEAMS.find(t => t.id === awayId);
  const homePts      = computeScore(homeId, week);
  const awayPts      = computeScore(awayId, week);
  const homeWin      = homePts > awayPts;
  const awayWin      = awayPts > homePts;
  const homeRosterOk = isRosterSet(homeId, homeId === myTeamId ? myRosterIds : undefined, homeId === myTeamId ? slotOverrides : undefined);
  const awayRosterOk = isRosterSet(awayId, awayId === myTeamId ? myRosterIds : undefined, awayId === myTeamId ? slotOverrides : undefined);
  const label        = isFinal ? 'Final' : isLive ? 'Live' : 'Upcoming';
  const labelColor   = isLive ? 'var(--accent)' : isFinal ? 'var(--text-dim)' : 'var(--text-faint)';
  const isMyMatchup  = homeId === myTeamId || awayId === myTeamId;

  return (
    <div className="card" style={{ overflow: 'hidden', borderLeft: isMyMatchup ? '3px solid var(--accent)' : undefined, background: isMyMatchup ? 'rgba(198,255,58,.04)' : undefined }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 0, cursor: 'pointer' }} onClick={onToggle}>
        <TeamScore team={home} pts={homePts} win={homeWin} side="home" showPts={isLive || isFinal} isMe={homeId === myTeamId} rosterOk={homeRosterOk} />
        <div style={{ flexShrink: 0, textAlign: 'center', padding: '0 12px', minWidth: 70 }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: labelColor, letterSpacing: '.08em', marginBottom: 2 }}>{label}</div>
          {(isLive || isFinal) && (
            <div style={{ fontSize: 11, color: 'var(--text-faint)' }}>vs</div>
          )}
        </div>
        <TeamScore team={away} pts={awayPts} win={awayWin} side="away" showPts={isLive || isFinal} isMe={awayId === myTeamId} rosterOk={awayRosterOk} />
        <div style={{ marginLeft: 'auto', paddingRight: 14, color: 'var(--text-faint)', fontSize: 12 }}>
          {expanded ? '▲' : '▼'}
        </div>
      </div>

      {expanded && (isLive || isFinal) && (
        <div style={{ borderTop: '1px solid var(--border)', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 0 }}>
          <RosterBreakdown teamId={homeId} week={week} onOpenPlayer={onOpenPlayer} />
          <RosterBreakdown teamId={awayId} week={week} onOpenPlayer={onOpenPlayer} side="away" />
        </div>
      )}

      {expanded && !isLive && !isFinal && (
        <div style={{ borderTop: '1px solid var(--border)', padding: '12px 16px', fontSize: 12, color: 'var(--text-faint)', textAlign: 'center' }}>
          Matchup hasn't started yet — check back Week {week}.
        </div>
      )}
    </div>
  );
}

function TeamScore({ team, pts, win, side, showPts, isMe, rosterOk }) {
  if (!team) return null;
  const isRight = side === 'away';
  return (
    <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 10, padding: '14px 16px', flexDirection: isRight ? 'row-reverse' : 'row', background: isMe ? 'rgba(198,255,58,.06)' : 'transparent' }}>
      <span style={{ width: 36, height: 36, borderRadius: 8, background: team.color, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, fontWeight: 900, color: '#000', flexShrink: 0 }}>{team.logo}</span>
      <div style={{ flex: 1, minWidth: 0, textAlign: isRight ? 'right' : 'left' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 5, flexDirection: isRight ? 'row-reverse' : 'row' }}>
          <span style={{ fontSize: 12, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: isMe ? 'var(--accent)' : 'var(--text)' }}>{team.name}</span>
          {isMe && <span style={{ fontSize: 8, fontFamily: 'var(--font-mono)', color: 'var(--accent-ink)', background: 'var(--accent)', borderRadius: 3, padding: '1px 4px', fontWeight: 800, flexShrink: 0 }}>YOU</span>}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 5, flexDirection: isRight ? 'row-reverse' : 'row', marginTop: 2 }}>
          <span style={{ fontSize: 11, color: 'var(--text-dim)' }}>{team.owner}</span>
          {rosterOk ? (
            <span style={{ fontSize: 9, fontFamily: 'var(--font-mono)', fontWeight: 700, color: 'var(--good)', background: 'rgba(76,175,130,.15)', border: '1px solid rgba(76,175,130,.35)', borderRadius: 3, padding: '1px 5px', flexShrink: 0 }}>
              Valid Roster
            </span>
          ) : (
            <span style={{ fontSize: 9, fontFamily: 'var(--font-mono)', fontWeight: 700, color: '#fff', background: 'var(--danger)', borderRadius: 3, padding: '1px 5px', flexShrink: 0 }}>
              Roster Not Set
            </span>
          )}
        </div>
      </div>
      {showPts && (
        <div style={{ flexShrink: 0, fontSize: 22, fontWeight: 900, fontFamily: 'var(--font-display)', color: rosterOk ? (win ? 'var(--accent)' : 'var(--text)') : 'var(--danger)', minWidth: 60, textAlign: isRight ? 'left' : 'right' }}>
          {rosterOk ? pts.toFixed(1) : '—'}
        </div>
      )}
    </div>
  );
}

function RosterBreakdown({ teamId, week, onOpenPlayer, side }) {
  const roster   = TEAM_ROSTERS[teamId] || [];
  const starters = roster.filter(r => r.slot !== 'BENCH');
  const bench    = roster.filter(r => r.slot === 'BENCH');
  const total    = computeScore(teamId, week);
  const isRight  = side === 'away';

  function playerPts(p, week) {
    if (!p) return 0;
    const v = p.avg + Math.sin(p.id * 3.7 + week * 2.3) * 4;
    return Math.max(0, Math.round(v * 10) / 10);
  }

  return (
    <div style={{ borderRight: isRight ? 'none' : '1px solid var(--border)', padding: '10px 0' }}>
      <div style={{ padding: '4px 16px 8px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-faint)', letterSpacing: '.1em' }}>STARTERS</span>
        <span style={{ fontSize: 13, fontWeight: 800, color: 'var(--accent)' }}>{total.toFixed(1)} pts</span>
      </div>
      {starters.map((entry, i) => {
        const p = entry.playerId ? findPlayer(entry.playerId) : null;
        const pts = playerPts(p, week);
        return (
          <div key={i}
            style={{ padding: '5px 16px', display: 'flex', alignItems: 'center', gap: 8, fontSize: 11, cursor: p && onOpenPlayer ? 'pointer' : 'default' }}
            onClick={p && onOpenPlayer ? () => onOpenPlayer(p.id) : undefined}
          >
            <span style={{ fontSize: 9, color: 'var(--text-faint)', width: 32, fontFamily: 'var(--font-mono)' }}>{entry.slot}</span>
            {p ? (
              <>
                <PosBadge pos={p.pos} />
                <span style={{ flex: 1 }}>{p.name}</span>
                <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, color: pts >= 15 ? 'var(--accent)' : pts >= 8 ? 'var(--text)' : 'var(--text-dim)' }}>{pts.toFixed(1)}</span>
              </>
            ) : (
              <span style={{ color: 'var(--text-faint)', flex: 1 }}>—</span>
            )}
          </div>
        );
      })}
      {bench.length > 0 && (
        <div style={{ padding: '8px 16px 2px', fontSize: 10, fontWeight: 700, color: 'var(--text-faint)', letterSpacing: '.1em' }}>BENCH</div>
      )}
      {bench.map((entry, i) => {
        const p = entry.playerId ? findPlayer(entry.playerId) : null;
        return (
          <div key={i} style={{ padding: '4px 16px', display: 'flex', alignItems: 'center', gap: 8, fontSize: 11, opacity: 0.5 }}>
            <span style={{ fontSize: 9, color: 'var(--text-faint)', width: 32, fontFamily: 'var(--font-mono)' }}>BN</span>
            {p ? <><PosBadge pos={p.pos} /><span style={{ flex: 1 }}>{p.name}</span></> : <span style={{ color: 'var(--text-faint)' }}>—</span>}
          </div>
        );
      })}
    </div>
  );
}
