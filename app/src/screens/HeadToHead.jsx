import React from 'react';
import { LEAGUE_TEAMS, TEAM_ROSTERS, findPlayer, buildRosterFrame, assignRoster } from '../lib/data.js';
import { PosBadge } from '../components/ui.jsx';

const NUM_WEEKS = 14;

function getCurrentNFLWeek() {
  const SEASON_START = new Date('2026-09-09');
  const today = new Date();
  if (today < SEASON_START) return 1;
  const msPerWeek = 7 * 24 * 60 * 60 * 1000;
  return Math.min(Math.max(Math.floor((today - SEASON_START) / msPerWeek) + 1, 1), NUM_WEEKS);
}

const CURRENT_WEEK = getCurrentNFLWeek();

function buildSchedule(ids, weeks) {
  const n = ids.length;
  return Array.from({ length: weeks }, (_, w) => {
    const rest = ids.slice(1);
    const rot = w % (n - 1);
    const circle = [ids[0], ...[...rest.slice(rot), ...rest.slice(0, rot)]];
    return Array.from({ length: n / 2 }, (_, i) => [circle[i], circle[n - 1 - i]]);
  });
}

function weekSeed(teamId, week) {
  return Math.sin(teamId * 7.3 + week * 3.1) * 18 + Math.cos(teamId * 2.1 + week * 5.7) * 8;
}

function computeScore(roster, teamId, week) {
  const starters = roster.filter(r => r.slot !== 'BENCH');
  const base = starters.reduce((sum, entry) => {
    const p = entry.playerId ? findPlayer(entry.playerId) : null;
    return sum + (p ? (p.avg || 0) : 0);
  }, 0);
  return Math.max(0, Math.round((base + weekSeed(teamId, week)) * 10) / 10);
}

function isRosterValid(roster) {
  const starters = roster.filter(r => r.slot !== 'BENCH' && r.playerId);
  const has   = slot => starters.some(r => r.slot === slot);
  const count = slot => starters.filter(r => r.slot === slot).length;
  if (!has('QB') || !has('DST') || count('RB') < 1 || count('WR') < 1) return false;
  return starters.filter(r => ['RB', 'WR', 'TE', 'FLEX'].includes(r.slot)).length >= 5;
}

function parseRecord(r = '0-0') {
  const [w, l] = r.split('-').map(Number);
  return { w: w || 0, l: l || 0 };
}

export default function HeadToHeadScreen({ onOpenPlayer, user, myRosterIds, slotOverrides }) {
  const [week, setWeek] = React.useState(CURRENT_WEEK);
  const [expanded, setExpanded] = React.useState(null);

  const myTeamId = user?.teamId ?? LEAGUE_TEAMS.find(t => t.me)?.id;

  // Use the commissioner-set schedule from localStorage if available (same source as sidebar),
  // fall back to the algorithmic round-robin only when no schedule has been generated yet.
  const schedule = React.useMemo(() => {
    try {
      const saved = JSON.parse(localStorage.getItem('fantasai_league_settings') || 'null');
      const ms = saved?.matchupSchedule;
      if (ms && Object.keys(ms).length > 0) {
        return Array.from({ length: NUM_WEEKS }, (_, i) => ms[i + 1] || ms[String(i + 1)] || []);
      }
    } catch {}
    return buildSchedule(LEAGUE_TEAMS.map(t => t.id), NUM_WEEKS);
  }, []);

  const matchups = schedule[week - 1] || [];

  // Build the live roster from Current Roster's pipeline
  const rosterSettings = React.useMemo(() => {
    try { return JSON.parse(localStorage.getItem('fantasai_league_settings') || 'null'); } catch { return null; }
  }, []);
  const slotFrame = React.useMemo(() => buildRosterFrame(rosterSettings), [rosterSettings]);
  const myLiveRoster = React.useMemo(
    () => (myRosterIds && slotFrame) ? assignRoster(slotFrame, myRosterIds, slotOverrides || {}) : null,
    [slotFrame, myRosterIds, slotOverrides],
  );

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
          <div className="sub">Weekly matchup results · rosters pulled from Current Roster settings</div>
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
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-faint)', letterSpacing: '.1em', textTransform: 'uppercase', marginBottom: 2 }}>
            Week {week} · {week < CURRENT_WEEK ? 'Final' : week === CURRENT_WEEK ? 'In Progress' : 'Upcoming'}
          </div>
          {matchups.map(([homeId, awayId], idx) => {
            const homeRec = standings.find(t => t.id === homeId);
            const awayRec = standings.find(t => t.id === awayId);
            return (
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
                myLiveRoster={myLiveRoster}
                homeRecord={homeRec ? `${homeRec.w}–${homeRec.l}` : null}
                awayRecord={awayRec ? `${awayRec.w}–${awayRec.l}` : null}
              />
            );
          })}
        </div>

        {/* Right column: NFL Scores */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <NflScores week={week} />
        </div>
      </div>
    </div>
  );
}

function MatchupCard({ homeId, awayId, week, isLive, isFinal, expanded, onToggle, onOpenPlayer, myTeamId, myLiveRoster, homeRecord, awayRecord }) {
  const home = LEAGUE_TEAMS.find(t => t.id === homeId);
  const away = LEAGUE_TEAMS.find(t => t.id === awayId);

  // Use live roster for the user's team; fall back to TEAM_ROSTERS for others
  const homeRoster = homeId === myTeamId && myLiveRoster ? myLiveRoster : (TEAM_ROSTERS[homeId] || []);
  const awayRoster = awayId === myTeamId && myLiveRoster ? myLiveRoster : (TEAM_ROSTERS[awayId] || []);

  const homePts      = computeScore(homeRoster, homeId, week);
  const awayPts      = computeScore(awayRoster, awayId, week);
  const homeWin      = homePts > awayPts;
  const awayWin      = awayPts > homePts;
  const homeRosterOk = isRosterValid(homeRoster);
  const awayRosterOk = isRosterValid(awayRoster);
  const label        = isFinal ? 'Final' : isLive ? 'Live' : 'Upcoming';
  const labelColor   = isLive ? 'var(--accent)' : isFinal ? 'var(--text-dim)' : 'var(--text-faint)';
  const isMyMatchup  = homeId === myTeamId || awayId === myTeamId;

  return (
    <div className="card" style={{ overflow: 'hidden', borderLeft: isMyMatchup ? '3px solid #4caf82' : undefined, background: isMyMatchup ? 'rgba(76,175,130,.06)' : undefined }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 0, cursor: 'pointer' }} onClick={onToggle}>
        <TeamScore team={home} pts={homePts} win={homeWin} side="home" showPts={isLive || isFinal} isMe={homeId === myTeamId} rosterOk={homeRosterOk} record={homeRecord} />
        <div style={{ flexShrink: 0, textAlign: 'center', padding: '0 12px', minWidth: 70 }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: labelColor, letterSpacing: '.08em', marginBottom: 2 }}>{label}</div>
          {(isLive || isFinal) && <div style={{ fontSize: 11, color: 'var(--text-faint)' }}>vs</div>}
        </div>
        <TeamScore team={away} pts={awayPts} win={awayWin} side="away" showPts={isLive || isFinal} isMe={awayId === myTeamId} rosterOk={awayRosterOk} record={awayRecord} />
        <div style={{ marginLeft: 'auto', paddingRight: 14, color: 'var(--text-faint)', fontSize: 12 }}>
          {expanded ? '▲' : '▼'}
        </div>
      </div>

      {expanded && (
        <div style={{ borderTop: '1px solid var(--border)', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 0 }}>
          <RosterBreakdown roster={homeRoster} teamId={homeId} week={week} onOpenPlayer={onOpenPlayer} isProjected={!isLive && !isFinal} />
          <RosterBreakdown roster={awayRoster} teamId={awayId} week={week} onOpenPlayer={onOpenPlayer} side="away" isProjected={!isLive && !isFinal} />
        </div>
      )}
    </div>
  );
}

function TeamScore({ team, pts, win, side, showPts, isMe, rosterOk, record }) {
  if (!team) return null;
  const isRight = side === 'away';
  return (
    <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 10, padding: '14px 16px', flexDirection: isRight ? 'row-reverse' : 'row', background: isMe ? 'rgba(76,175,130,.08)' : 'transparent' }}>
      {team.logoImg
        ? <img src={team.logoImg} alt={team.logo} style={{ width: 36, height: 36, borderRadius: 8, objectFit: 'cover', flexShrink: 0 }} />
        : <span style={{ width: 36, height: 36, borderRadius: 8, background: team.color, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, fontWeight: 900, color: '#000', flexShrink: 0 }}>{team.logo}</span>
      }
      <div style={{ flex: 1, minWidth: 0, textAlign: isRight ? 'right' : 'left' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 5, flexDirection: isRight ? 'row-reverse' : 'row' }}>
          <span style={{ fontSize: 12, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: isMe ? '#4caf82' : 'var(--text)' }}>{team.name}</span>
          {isMe && <span style={{ fontSize: 8, fontFamily: 'var(--font-mono)', color: '#fff', background: '#4caf82', borderRadius: 3, padding: '1px 4px', fontWeight: 800, flexShrink: 0 }}>YOU</span>}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 5, flexDirection: isRight ? 'row-reverse' : 'row', marginTop: 2 }}>
          <span style={{ fontSize: 11, color: 'var(--text-dim)' }}>{team.owner}</span>
          {record && <span style={{ fontSize: 9, fontFamily: 'var(--font-mono)', fontWeight: 700, color: 'var(--text-faint)', background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 3, padding: '1px 5px', flexShrink: 0 }}>{record}</span>}
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

function NflScores({ week }) {
  const [data, setData] = React.useState(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState(null);
  const season = 2026;

  React.useEffect(() => {
    const workerUrl = (localStorage.getItem('fantasai.workerUrl') || '').replace(/\/$/, '');
    if (!workerUrl) { setLoading(false); setError('no_worker'); return; }
    setLoading(true);
    setError(null);
    fetch(`${workerUrl}/api/v1/nfl/scoreboard?week=${week}&season=${season}&type=regular`)
      .then(r => r.json())
      .then(d => { setData(d); setLoading(false); })
      .catch(() => { setError('fetch_failed'); setLoading(false); });
  }, [week, season]);

  return (
    <div className="card">
      <div className="card-head">
        <div className="card-title" style={{ flex: 1 }}>
          {(data?.games || []).some(g => new Date(g.date) > new Date()) ? 'NFL Schedule' : 'NFL Scores'} · Wk {week}
        </div>
        <span style={{ fontSize: 9, color: '#e05e5e', fontWeight: 800, fontFamily: 'var(--font-mono)', letterSpacing: '.06em', background: 'rgba(224,94,94,.12)', padding: '2px 6px', borderRadius: 4, border: '1px solid rgba(224,94,94,.25)' }}>ESPN</span>
      </div>
      <div>
        {loading && (
          <div style={{ padding: '16px', textAlign: 'center', color: 'var(--text-faint)', fontSize: 12 }}>Loading scores…</div>
        )}
        {error === 'no_worker' && (
          <div style={{ padding: '12px 14px', fontSize: 11, color: 'var(--text-faint)', lineHeight: 1.5 }}>
            Configure your Worker URL in <strong>Sources</strong> to see live NFL scores.
          </div>
        )}
        {error === 'fetch_failed' && (
          <div style={{ padding: '12px 14px', fontSize: 11, color: 'var(--danger)' }}>Failed to load scores.</div>
        )}
        {!loading && !error && data?.games?.length === 0 && (
          <div style={{ padding: '12px 14px', fontSize: 11, color: 'var(--text-faint)', lineHeight: 1.6 }}>
            {data?.seasonAvailable === false
              ? `${data.season || 2026} schedule not yet released by ESPN — check back closer to the season.`
              : `No games scheduled for Week ${week}.`
            }
          </div>
        )}
        {(data?.games || []).map(game => (
          <NflGameRow key={game.id} game={game} />
        ))}
        {data && (
          <div style={{ padding: '6px 14px', fontSize: 9, color: 'var(--text-faint)', fontFamily: 'var(--font-mono)' }}>
            {season} season · via ESPN
          </div>
        )}
      </div>
    </div>
  );
}

function NflGameRow({ game }) {
  const { home, away, status, broadcasts = [], date } = game;
  const gameDate = new Date(date);
  const now = new Date();
  // Use actual game date to determine state — overrides stale API status
  const isUpcoming = gameDate > now && !status?.completed;
  const isLive     = status?.state === 'in' && !isUpcoming;
  const isFinal    = status?.completed && !isUpcoming;

  const dateStr = gameDate.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
  const timeStr = gameDate.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', timeZoneName: 'short' });

  const homeScore = home?.score != null ? Number(home.score) : null;
  const awayScore = away?.score != null ? Number(away.score) : null;
  const homeWin = isFinal && homeScore != null && homeScore > awayScore;
  const awayWin = isFinal && awayScore != null && awayScore > homeScore;

  return (
    <div style={{ padding: '8px 14px', borderBottom: '1px solid var(--border)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 5 }}>
        {isUpcoming ? (
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9 }}>
            <span style={{ color: 'var(--text-dim)', fontWeight: 700 }}>{dateStr}</span>
            <span style={{ color: 'var(--text-faint)' }}> · {timeStr}</span>
          </span>
        ) : isLive ? (
          <span style={{ fontSize: 9, color: 'var(--accent)', fontWeight: 700, fontFamily: 'var(--font-mono)', display: 'flex', alignItems: 'center', gap: 4 }}>
            <span style={{ width: 5, height: 5, borderRadius: '50%', background: 'var(--accent)', display: 'inline-block', animation: 'pulse 1s infinite' }} />
            Q{status.period} {status.clock}
          </span>
        ) : (
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9 }}>
            <span style={{ color: 'var(--text-faint)', fontWeight: 700 }}>Final</span>
            <span style={{ color: 'var(--text-faint)' }}> · {dateStr}</span>
          </span>
        )}
        {broadcasts[0] && (
          <span style={{ fontSize: 9, color: 'var(--text-faint)', fontFamily: 'var(--font-mono)', background: 'var(--panel)', padding: '1px 5px', borderRadius: 3, border: '1px solid var(--border)' }}>
            {broadcasts[0]}
          </span>
        )}
      </div>
      {[{ team: away, win: awayWin, score: awayScore }, { team: home, win: homeWin, score: homeScore }].map(({ team, win, score }, i) => (
        team && (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: i === 0 ? 2 : 0 }}>
            <span style={{ fontFamily: 'var(--font-mono)', fontWeight: win ? 900 : 500, color: win ? 'var(--text)' : 'var(--text-dim)', fontSize: 11, width: 30, flexShrink: 0 }}>{team.abbr}</span>
            <span style={{ flex: 1, fontSize: 10, color: 'var(--text-faint)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{team.name}</span>
            {(isLive || isFinal) && score != null && (
              <span style={{ fontFamily: 'var(--font-mono)', fontWeight: win ? 900 : 400, color: win ? 'var(--text)' : 'var(--text-dim)', fontSize: 13, minWidth: 24, textAlign: 'right' }}>{score}</span>
            )}
          </div>
        )
      ))}
    </div>
  );
}

function RosterBreakdown({ roster, teamId, week, onOpenPlayer, side, isProjected }) {
  const starters = roster.filter(r => r.slot !== 'BENCH');
  const bench    = roster.filter(r => r.slot === 'BENCH');
  const total    = computeScore(roster, teamId, week);
  const isRight  = side === 'away';
  const ptColor  = isProjected ? 'var(--text-dim)' : 'var(--accent)';

  function playerPts(p) {
    if (!p) return 0;
    const v = p.avg + Math.sin(p.id * 3.7 + week * 2.3) * 4;
    return Math.max(0, Math.round(v * 10) / 10);
  }

  return (
    <div style={{ borderRight: isRight ? 'none' : '1px solid var(--border)', padding: '10px 0' }}>
      <div style={{ padding: '4px 16px 8px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-faint)', letterSpacing: '.1em' }}>STARTERS</span>
          {isProjected && (
            <span style={{ fontSize: 8, fontWeight: 800, color: 'var(--text-faint)', background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 3, padding: '1px 5px', fontFamily: 'var(--font-mono)', letterSpacing: '.06em' }}>PROJ</span>
          )}
        </div>
        <span style={{ fontSize: 13, fontWeight: 800, color: ptColor }}>{total.toFixed(1)} pts</span>
      </div>
      {starters.map((entry, i) => {
        const p = entry.playerId ? findPlayer(entry.playerId) : null;
        const pts = playerPts(p);
        const ptsColor = isProjected ? 'var(--text-dim)' : pts >= 15 ? 'var(--accent)' : pts >= 8 ? 'var(--text)' : 'var(--text-dim)';
        return (
          <div
            key={i}
            style={{ padding: '5px 16px', display: 'flex', alignItems: 'center', gap: 8, fontSize: 11, cursor: p && onOpenPlayer ? 'pointer' : 'default' }}
            onClick={p && onOpenPlayer ? () => onOpenPlayer(p.id) : undefined}
          >
            <span style={{ fontSize: 9, color: 'var(--text-faint)', width: 32, fontFamily: 'var(--font-mono)' }}>{entry.slot}</span>
            {p ? (
              <>
                <PosBadge pos={p.pos} />
                <span style={{ flex: 1 }}>{p.name}</span>
                <div style={{ textAlign: 'right' }}>
                  <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, color: ptsColor }}>{pts.toFixed(1)}</span>
                  {isProjected && <span style={{ fontSize: 8, color: 'var(--text-faint)', marginLeft: 2 }}>proj</span>}
                </div>
              </>
            ) : (
              <span style={{ color: 'var(--text-faint)', flex: 1 }}>Empty slot</span>
            )}
          </div>
        );
      })}
      {bench.length > 0 && (
        <div style={{ padding: '8px 16px 2px', fontSize: 10, fontWeight: 700, color: 'var(--text-faint)', letterSpacing: '.1em' }}>BENCH</div>
      )}
      {bench.map((entry, i) => {
        const p = entry.playerId ? findPlayer(entry.playerId) : null;
        const pts = playerPts(p);
        return (
          <div key={i} style={{ padding: '4px 16px', display: 'flex', alignItems: 'center', gap: 8, fontSize: 11, opacity: 0.55 }}>
            <span style={{ fontSize: 9, color: 'var(--text-faint)', width: 32, fontFamily: 'var(--font-mono)' }}>BN</span>
            {p ? (
              <>
                <PosBadge pos={p.pos} />
                <span style={{ flex: 1 }}>{p.name}</span>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-faint)' }}>{pts.toFixed(1)}{isProjected && <span style={{ fontSize: 8 }}> proj</span>}</span>
              </>
            ) : (
              <span style={{ color: 'var(--text-faint)' }}>—</span>
            )}
          </div>
        );
      })}
    </div>
  );
}
