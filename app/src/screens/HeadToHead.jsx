import React from 'react';
import { LEAGUE_TEAMS, TEAM_ROSTERS, buildRosterFrame, assignRoster, findTeam, refreshTeamRosters, refreshTeamRostersFromServer } from '../lib/data.js';
import { findPlayer, findPlayerByName, usePlayers } from '../lib/playerStore.js';
import { PosBadge, TeamLogoBadge } from '../components/ui.jsx';
import { getScoringRules, calcFantasyPts, buildStatPointsBreakdown, normalizeTeamAbbr, getGameProgress, blendProjectedFinal, fetchEspnScoreboardDirect, fetchEspnPlayerStatsDirect } from '../lib/liveScoring.js';

const NUM_WEEKS = 14;

function getCurrentNFLWeek() {
  const SEASON_START = new Date('2026-09-09');
  const today = new Date();
  if (today < SEASON_START) return 1;
  const msPerWeek = 7 * 24 * 60 * 60 * 1000;
  return Math.min(Math.max(Math.floor((today - SEASON_START) / msPerWeek) + 1, 1), NUM_WEEKS);
}

const CURRENT_WEEK = getCurrentNFLWeek();
const CURRENT_SEASON = 2026;

function buildSchedule(ids, weeks) {
  const n = ids.length;
  return Array.from({ length: weeks }, (_, w) => {
    const rest = ids.slice(1);
    const rot = w % (n - 1);
    const circle = [ids[0], ...[...rest.slice(rot), ...rest.slice(0, rot)]];
    return Array.from({ length: n / 2 }, (_, i) => [circle[i], circle[n - 1 - i]]);
  });
}

function computeScore(roster) {
  const starters = roster.filter(r => r.slot !== 'BENCH');
  return starters.reduce((sum, entry) => {
    const p = entry.playerId ? findPlayer(entry.playerId) : null;
    return sum + (p ? (p.proj || p.avg || 0) : 0);
  }, 0);
}

// Live per-player lookup: matches by lowercased/trimmed name against the
// player-stats response from /api/v1/nfl/player-stats, same matching
// convention the old locked-score system used.
function findLivePlayerEntry(livePlayerPts, p) {
  if (!p || !livePlayerPts) return null;
  return livePlayerPts[(p.name || '').toLowerCase().trim()] || null;
}

// Real, current score — derived only from recorded stats via the scoring
// rules, never blended with projection. A player with no live stat entry
// contributes 0, whether that's because their game hasn't started, they
// haven't recorded anything yet, or they have no game this slate at all.
// This is the "what has actually happened" number.
function computeActualTeamTotal(roster, livePlayerPts) {
  const starters = roster.filter(r => r.slot !== 'BENCH' && r.playerId);
  let total = 0;
  for (const entry of starters) {
    const p = findPlayer(entry.playerId);
    if (!p) continue;
    const liveEntry = findLivePlayerEntry(livePlayerPts, p);
    total += liveEntry?.pts ?? 0;
  }
  return Math.round(total * 10) / 10;
}

// Projected final — actual-so-far blended with a pace-adjusted remaining
// projection. Falls back to the static proj for any player with no live
// game info at all (bye week, not playing this slate). This is a distinct
// "what we expect the final to be" estimate — shown separately from the
// real/actual score above, never as the main score.
function computeBlendedTeamTotal(roster, liveGameStatus, livePlayerPts) {
  const starters = roster.filter(r => r.slot !== 'BENCH' && r.playerId);
  let total = 0;
  for (const entry of starters) {
    const p = findPlayer(entry.playerId);
    if (!p) continue;
    const proj = playerProjPts(p);
    const gameStatus = liveGameStatus?.[normalizeTeamAbbr(p.team)];
    if (!gameStatus) { total += proj; continue; }
    const progress = getGameProgress(gameStatus);
    const liveEntry = findLivePlayerEntry(livePlayerPts, p);
    total += blendProjectedFinal(liveEntry?.pts ?? 0, proj, progress);
  }
  return Math.round(total * 10) / 10;
}

// Real isLive/isFinal from actual ESPN game status for this matchup's
// rostered players, falling back to the calendar heuristic when no live
// data is available yet (e.g. Worker not configured, or a week ESPN
// hasn't published games for).
function deriveMatchupStatus(homeRoster, awayRoster, liveGameStatus, fallbackIsLive, fallbackIsFinal) {
  const rosters = [...homeRoster, ...awayRoster].filter(r => r.slot !== 'BENCH' && r.playerId);
  const statuses = rosters
    .map(entry => {
      const p = findPlayer(entry.playerId);
      return p ? liveGameStatus?.[normalizeTeamAbbr(p.team)] : null;
    })
    .filter(Boolean);
  if (statuses.length === 0) return { isLive: fallbackIsLive, isFinal: fallbackIsFinal };
  const allPre  = statuses.every(s => s.state === 'pre');
  const allPost = statuses.every(s => s.state === 'post' || s.completed);
  return { isLive: !allPre && !allPost, isFinal: allPost };
}

// Per-player projection: prefer p.proj (same source as Current Roster), fall back to p.avg
function playerProjPts(p) {
  if (!p) return 0;
  return Math.max(0, p.proj || p.avg || 0);
}

function rosterGroupPts(roster, slot) {
  return roster
    .filter(r => (slot === 'BENCH' ? r.slot === 'BENCH' : r.slot !== 'BENCH') && r.playerId)
    .reduce((s, e) => s + playerProjPts(findPlayer(e.playerId)), 0);
}

function isRosterValid(roster) {
  const starterSlots = roster.filter(r => r.slot !== 'BENCH');
  return starterSlots.length > 0 && starterSlots.every(r => r.playerId != null);
}

function parseRecord(r = '0-0') {
  const [w, l] = r.split('-').map(Number);
  return { w: w || 0, l: l || 0 };
}

export default function HeadToHeadScreen({ onOpenPlayer, user, myRosterIds, slotOverrides, showMobile = false }) {
  const isMobile = showMobile;
  const allPlayers = usePlayers(); // subscribe so roster re-assigns when player data loads
  const [week, setWeek] = React.useState(CURRENT_WEEK);
  const [expanded, setExpanded] = React.useState(0);
  const [h2hTab, setH2hTab] = React.useState('mine'); // 'mine' | 'all' | 'scores'
  const showAll = h2hTab === 'all';
  // 'regular' by default (unchanged behavior); 'pre' lets us test scoring
  // against real preseason games before the real season starts.
  const [seasonType, setSeasonType] = React.useState('regular');

  // Sync TEAM_ROSTERS whenever H2H is opened so drafted players appear.
  // refreshTeamRosters() itself is synchronous (local-storage-only), so
  // bumping rosterVersion right after it only captures that fast/incomplete
  // pass. The real, correct data comes from refreshTeamRostersFromServer(),
  // which is async and resolves moments later — bump rosterVersion again once
  // it actually completes, or allTeamRosters (built from TEAM_ROSTERS in a
  // useMemo keyed on rosterVersion) permanently freezes on whatever opponent
  // rosters looked like before the real fetch landed. Confirmed live
  // 2026-09-02: every opponent's H2H roster showed almost entirely empty
  // slots with one or two stale leftover players, while "my own" roster
  // (built through a completely different, already-fixed path) was correct.
  const [rosterVersion, setRosterVersion] = React.useState(0);
  React.useEffect(() => {
    refreshTeamRosters();
    setRosterVersion(v => v + 1);
    refreshTeamRostersFromServer().then(() => setRosterVersion(v => v + 1));
  }, []);

  // Live per-player stats + per-game status. Primary source is the Worker's
  // R2 cache (populated by local_processing/job_live_scores.py, since ESPN
  // started blocking the Worker's own outbound requests). If that cache has
  // no data yet for the requested week/season/type, fall back to fetching
  // ESPN directly from this browser — display-only for this viewer, never
  // written back to R2 (see fetchEspnScoreboardDirect's comment).
  // liveGameStatus is keyed by ESPN team abbreviation; livePlayerPts by
  // lowercased/trimmed player name → {pts, stats}.
  const [liveGameStatus, setLiveGameStatus] = React.useState({});
  const [livePlayerPts, setLivePlayerPts] = React.useState({});
  const [liveSource, setLiveSource] = React.useState(null); // 'r2' | 'browser' | 'none'
  const [liveRefreshing, setLiveRefreshing] = React.useState(false);
  const [refreshTick, setRefreshTick] = React.useState(0);

  React.useEffect(() => {
    const workerUrl = (localStorage.getItem('fantasai.workerUrl') || '').replace(/\/$/, '');
    if (!workerUrl) { setLiveGameStatus({}); setLivePlayerPts({}); setLiveSource('none'); return; }

    let cancelled = false;
    let pollId = null;

    function applyLiveData(games, players, source) {
      const statusByTeam = {};
      for (const g of games) {
        // Carry the game's kickoff time + opponent alongside status so the
        // roster breakdown can show "when to expect points" per player.
        if (g.home?.abbr) statusByTeam[g.home.abbr] = { ...g.status, kickoff: g.date, opp: g.away?.abbr || null };
        if (g.away?.abbr) statusByTeam[g.away.abbr] = { ...g.status, kickoff: g.date, opp: g.home?.abbr || null, isAway: true };
      }
      setLiveGameStatus(statusByTeam);

      const rules = getScoringRules();
      const ptsByName = {};
      for (const p of players) {
        const key = (p.name || '').toLowerCase().trim();
        if (!key) continue;
        ptsByName[key] = { name: p.name, pos: p.pos, team: p.team, pts: p.pts ?? calcFantasyPts(p.stats, rules, p.pos), stats: p.stats };
      }
      setLivePlayerPts(ptsByName);
      setLiveSource(source);
      return statusByTeam;
    }

    async function fetchLive() {
      setLiveRefreshing(true);
      try {
        const [boardRes, statsRes] = await Promise.all([
          fetch(`${workerUrl}/api/v1/nfl/scoreboard?week=${week}&season=${CURRENT_SEASON}&type=${seasonType}`),
          fetch(`${workerUrl}/api/v1/nfl/player-stats?week=${week}&season=${CURRENT_SEASON}&type=${seasonType}`),
        ]);
        const board = await boardRes.json();
        const stats = await statsRes.json();
        if (cancelled) return;

        let statusByTeam;
        if ((board.games || []).length > 0) {
          statusByTeam = applyLiveData(board.games, stats.players || [], 'r2');
        } else {
          // R2 cache has nothing for this week/season/type yet — fall back
          // to fetching ESPN directly from this browser.
          try {
            const games = await fetchEspnScoreboardDirect(week, CURRENT_SEASON, seasonType);
            const players = games.length > 0 ? await fetchEspnPlayerStatsDirect(games) : [];
            statusByTeam = applyLiveData(games, players, 'browser');
          } catch {
            statusByTeam = applyLiveData([], [], 'none');
          }
        }
        if (cancelled) return;

        // Keep polling only while at least one game is actually in progress.
        // 60s, matching job_live_scores.py's tightest tier (LIVE_INTERVAL)
        // — this only hits our own Worker/R2, not ESPN, so there's no
        // rate-limit concern here; no reason to lag behind the backend's
        // freshest cadence during live play.
        const anyLive = Object.values(statusByTeam).some(s => s.state === 'in');
        if (anyLive && !cancelled && !pollId) {
          pollId = setInterval(fetchLive, 60000);
        } else if (!anyLive && pollId) {
          clearInterval(pollId);
          pollId = null;
        }
      } catch {
        // Leave prior live data in place on a transient fetch failure.
      } finally {
        if (!cancelled) setLiveRefreshing(false);
      }
    }

    function onVisibilityChange() {
      if (document.hidden) {
        if (pollId) { clearInterval(pollId); pollId = null; }
      } else {
        fetchLive();
      }
    }

    fetchLive();
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      cancelled = true;
      if (pollId) clearInterval(pollId);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [week, seasonType, refreshTick]);

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

  const allMatchups = schedule[week - 1] || [];
  const matchups = showAll
    ? allMatchups
    : allMatchups.filter(([a, b]) => a === myTeamId || b === myTeamId);

  // Build the live roster from Current Roster's pipeline
  const rosterSettings = React.useMemo(() => {
    try { return JSON.parse(localStorage.getItem('fantasai_league_settings') || 'null'); } catch { return null; }
  }, []);
  const slotFrame = React.useMemo(() => buildRosterFrame(rosterSettings), [rosterSettings]);
  // allPlayers in deps: re-assign when live player data loads (findPlayer depends on the store)
  const myLiveRoster = React.useMemo(
    () => (myRosterIds && slotFrame) ? assignRoster(slotFrame, myRosterIds, slotOverrides || {}, findPlayer) : null,
    [slotFrame, myRosterIds, slotOverrides, allPlayers],
  );

  // Build assigned rosters for ALL teams so H2H shows starter slots, not raw BENCH picks
  const allTeamRosters = React.useMemo(() => {
    const rosters = {};
    for (const t of LEAGUE_TEAMS) {
      const rawIds = (TEAM_ROSTERS[t.id] || []).map(e => e.playerId).filter(Boolean);
      if (rawIds.length === 0) { rosters[t.id] = []; continue; }
      rosters[t.id] = assignRoster(slotFrame, new Set(rawIds), {}, findPlayer);
    }
    return rosters;
  }, [slotFrame, rosterVersion, allPlayers]);

  const standings = React.useMemo(() => {
    return LEAGUE_TEAMS.map(t => {
      const rec = parseRecord(t.record);
      return { ...t, ...rec, pf: t.pf || 0, pa: t.pa || 0 };
    }).sort((a, b) => (b.w - a.w) || (b.pf - a.pf) || (a.pa - b.pa));
  }, []);

  return (
    <div style={{ padding: '20px 24px', maxWidth: 1100, display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div className="page-head" style={{ paddingLeft: 0, paddingRight: 0, paddingTop: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'nowrap' }}>
          <div style={{ flexShrink: 0 }}>
            <h1 style={{ marginBottom: 2 }}>Head to Head</h1>
            <div className="sub">
              Weekly Matchup - Week {week}{' '}
              <span style={{ color: week === CURRENT_WEEK ? '#1affa0' : 'inherit', fontWeight: week === CURRENT_WEEK ? 700 : 'inherit' }}>
                {week < CURRENT_WEEK ? 'Final' : week === CURRENT_WEEK ? 'In Progress' : 'Upcoming'}
              </span>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginLeft: 'auto', flexWrap: 'nowrap' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 0, background: 'var(--panel)', borderRadius: 8, padding: 3, flexShrink: 0 }}>
              {[{ id: 'mine', label: 'My H2H' }, { id: 'all', label: 'All Matchups' }, { id: 'scores', label: 'Live Scores' }, { id: 'playertest', label: 'Player Scores' }].map(opt => (
                <button
                  key={opt.id}
                  onClick={() => { setH2hTab(opt.id); setExpanded(opt.id === 'all' ? null : 0); }}
                  style={{
                    padding: '6px 14px', borderRadius: 6, fontSize: 12, fontWeight: h2hTab === opt.id ? 700 : 500,
                    cursor: 'pointer', border: 'none', whiteSpace: 'nowrap',
                    background: h2hTab === opt.id ? 'var(--accent)' : 'transparent',
                    color: h2hTab === opt.id ? 'var(--accent-ink)' : 'var(--text-dim)',
                    transition: 'background .15s, color .15s',
                  }}
                >
                  {opt.label}
                </button>
              ))}
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 0, background: 'var(--panel)', borderRadius: 8, padding: 3, flexShrink: 0 }} title="Preseason lets you test live scoring against real games before the regular season starts">
              {[{ id: 'pre', label: 'Pre' }, { id: 'regular', label: 'Reg' }, { id: 'post', label: 'Post' }].map(opt => (
                <button
                  key={opt.id}
                  onClick={() => {
                    setSeasonType(opt.id);
                    // Preseason only has 3 real weeks — clamp so switching
                    // types never lands on a week that doesn't exist for it.
                    if (opt.id === 'pre' && week > 3) setWeek(1);
                    if (opt.id !== 'pre' && seasonType === 'pre') setWeek(CURRENT_WEEK);
                  }}
                  style={{
                    padding: '5px 10px', borderRadius: 6, fontSize: 11, fontWeight: seasonType === opt.id ? 700 : 500,
                    cursor: 'pointer', border: 'none', whiteSpace: 'nowrap',
                    background: seasonType === opt.id ? 'var(--accent)' : 'transparent',
                    color: seasonType === opt.id ? 'var(--accent-ink)' : 'var(--text-dim)',
                    transition: 'background .15s, color .15s',
                  }}
                >
                  {opt.label}
                </button>
              ))}
            </div>

            <button
              onClick={() => setRefreshTick(t => t + 1)}
              disabled={liveRefreshing}
              title={
                liveSource === 'r2' ? 'Live data from the local scoring pipeline'
                : liveSource === 'browser' ? 'No pipeline data cached yet — pulling live scores directly from ESPN in this browser'
                : 'No live data available for this week yet'
              }
              style={{
                display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0, whiteSpace: 'nowrap',
                padding: '6px 12px', borderRadius: 8, fontSize: 11, fontWeight: 700,
                cursor: liveRefreshing ? 'default' : 'pointer', border: '1px solid var(--border)',
                background: 'var(--panel)', color: 'var(--text-dim)',
                opacity: liveRefreshing ? 0.6 : 1,
              }}
            >
              <span style={{ display: 'inline-block', transform: liveRefreshing ? 'rotate(180deg)' : 'none', transition: 'transform .4s' }}>⟳</span>
              {liveRefreshing ? 'Refreshing…' : 'Refresh Scores'}
              {liveSource === 'browser' && !liveRefreshing && (
                <span style={{ fontSize: 8, fontWeight: 800, color: '#4ea8ff', letterSpacing: '.05em' }}>BROWSER</span>
              )}
            </button>

            <div style={{ display: 'grid', gridTemplateColumns: seasonType === 'pre' ? 'repeat(3, auto)' : 'repeat(7, auto)', gridAutoFlow: 'row', gap: 3 }}>
              {Array.from({ length: seasonType === 'pre' ? 3 : NUM_WEEKS }, (_, i) => i + 1).map(w => (
                <button
                  key={w}
                  onClick={() => { setWeek(w); setExpanded(showAll ? null : 0); }}
                  style={{
                    padding: '4px 6px', borderRadius: 5, fontSize: 10, fontWeight: 600,
                    cursor: 'pointer', border: '1px solid var(--border)', whiteSpace: 'nowrap',
                    background: w === week ? 'var(--accent)' : (seasonType !== 'pre' && w < CURRENT_WEEK) ? 'var(--panel)' : 'transparent',
                    color: w === week ? 'var(--accent-ink)' : (seasonType !== 'pre' && w < CURRENT_WEEK) ? 'var(--text)' : 'var(--text-dim)',
                  }}
                >
                  {seasonType === 'pre' ? `Pre ${w}` : (w === CURRENT_WEEK ? `Wk ${w}●` : `Wk ${w}`)}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {h2hTab === 'scores' ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 460 }}>
          <NflScores week={week} seasonType={seasonType} />
        </div>
      ) : h2hTab === 'playertest' ? (
        <PlayerScoresTab livePlayerPts={livePlayerPts} seasonType={seasonType} week={week} />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {matchups.map(([homeId, awayId], idx) => {
            const homeRec = standings.find(t => t.id === homeId);
            const awayRec = standings.find(t => t.id === awayId);
            return (
              <MatchupCard
                key={idx}
                homeId={homeId}
                awayId={awayId}
                week={week}
                fallbackIsLive={week === CURRENT_WEEK}
                fallbackIsFinal={week < CURRENT_WEEK}
                liveGameStatus={liveGameStatus}
                livePlayerPts={livePlayerPts}
                expanded={expanded === idx}
                onToggle={() => setExpanded(expanded === idx ? null : idx)}
                onOpenPlayer={onOpenPlayer}
                myTeamId={myTeamId}
                myLiveRoster={myLiveRoster}
                allTeamRosters={allTeamRosters}
                homeRecord={homeRec ? `${homeRec.w}–${homeRec.l}` : null}
                awayRecord={awayRec ? `${awayRec.w}–${awayRec.l}` : null}
                isMobile={isMobile}
              />
            );
          })}
        </div>
      )}

    </div>
  );
}

// Every player who recorded a stat this week, scored with the league's
// actual Rules & Settings scoring config — a direct look at what the live
// pipeline is computing, independent of any roster. Reuses the same
// livePlayerPts already fetched for the matchup cards; no separate request.
function PlayerScoresTab({ livePlayerPts, seasonType, week }) {
  const [posFilter, setPosFilter] = React.useState('ALL');
  const rules = React.useMemo(() => getScoringRules(), []);
  const players = Object.values(livePlayerPts || {});
  const sorted = [...(posFilter === 'ALL' ? players : players.filter(p => p.pos === posFilter))]
    .sort((a, b) => b.pts - a.pts);
  const positions = ['ALL', 'QB', 'RB', 'WR', 'TE', 'K', 'DST'];
  const seasonLabel = seasonType === 'pre' ? 'Preseason' : seasonType === 'post' ? 'Postseason' : 'Regular Season';

  return (
    <div className="card">
      <div className="card-head">
        <div className="card-title" style={{ flex: 1 }}>{seasonLabel} Week {week} · Player Scores</div>
        <span style={{ fontSize: 9, color: 'var(--text-faint)', fontFamily: 'var(--font-mono)' }}>
          {sorted.length} players · Rules &amp; Settings scoring
        </span>
      </div>
      <div style={{ display: 'flex', gap: 4, padding: '8px 14px', flexWrap: 'wrap' }}>
        {positions.map(pos => (
          <button key={pos} onClick={() => setPosFilter(pos)}
            style={{
              padding: '3px 10px', borderRadius: 5, fontSize: 11, fontWeight: posFilter === pos ? 700 : 500,
              cursor: 'pointer', border: '1px solid var(--border)',
              background: posFilter === pos ? 'var(--accent)' : 'transparent',
              color: posFilter === pos ? 'var(--accent-ink)' : 'var(--text-dim)',
            }}
          >{pos}</button>
        ))}
      </div>
      {sorted.length === 0 ? (
        <div style={{ padding: '20px 14px', textAlign: 'center', color: 'var(--text-faint)', fontSize: 12, lineHeight: 1.6 }}>
          No player stats yet for this week — either games haven't started, ESPN hasn't published this slate, or the Worker URL isn't configured in <strong>Sources</strong>.
        </div>
      ) : (
        <div>
          <div style={{ display: 'grid', gridTemplateColumns: '28px 1fr 40px 1fr 60px', padding: '4px 14px', borderBottom: '1px solid var(--border)', fontSize: 9, fontWeight: 700, color: 'var(--text-faint)', fontFamily: 'var(--font-mono)', letterSpacing: '.08em', textTransform: 'uppercase' }}>
            <span />
            <span>Player</span>
            <span>Team</span>
            <span>Stats</span>
            <span style={{ textAlign: 'right' }}>Pts</span>
          </div>
          {sorted.map(p => {
            const breakdown = buildStatPointsBreakdown(p.stats, rules, p.pos);
            return (
              <div key={p.name} style={{ display: 'grid', gridTemplateColumns: '28px 1fr 40px 1fr 60px', alignItems: 'center', padding: '6px 14px', fontSize: 12, borderBottom: '1px solid rgba(255,255,255,.04)' }}>
                <PosBadge pos={p.pos} />
                <span style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</span>
                <span style={{ fontSize: 10, color: 'var(--text-dim)', fontFamily: 'var(--font-mono)' }}>{p.team}</span>
                <span style={{ display: 'flex', flexWrap: 'wrap', gap: '2px 8px', fontSize: 10, color: 'var(--text-faint)', fontFamily: 'var(--font-mono)' }}>
                  {breakdown.length === 0 ? '—' : breakdown.map(row => (
                    <span key={row.label} title={`${row.label}: ${row.amount}${row.unit} × rate = ${row.pts >= 0 ? '+' : ''}${row.pts.toFixed(1)} pts`}>
                      {row.label} {row.amount}{row.unit}
                      <span style={{ color: row.pts > 0 ? '#4caf82' : row.pts < 0 ? '#ff5a6e' : 'var(--text-faint)', fontWeight: 700 }}>
                        {' '}({row.pts >= 0 ? '+' : ''}{row.pts.toFixed(1)})
                      </span>
                    </span>
                  ))}
                </span>
                <span style={{ textAlign: 'right', fontWeight: 800, color: p.pts >= 15 ? 'var(--accent)' : p.pts >= 8 ? '#4ea8ff' : 'var(--text)' }}>{p.pts.toFixed(1)}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function MatchupCard({ homeId, awayId, week, fallbackIsLive, fallbackIsFinal, liveGameStatus, livePlayerPts, expanded, onToggle, onOpenPlayer, myTeamId, myLiveRoster, allTeamRosters, homeRecord, awayRecord }) {
  const home = findTeam(homeId);
  const away = findTeam(awayId);

  // Use assigned rosters (with proper starter slots) for all teams
  const homeRoster = homeId === myTeamId && myLiveRoster ? myLiveRoster : (allTeamRosters?.[homeId] || TEAM_ROSTERS[homeId] || []);
  const awayRoster = awayId === myTeamId && myLiveRoster ? myLiveRoster : (allTeamRosters?.[awayId] || TEAM_ROSTERS[awayId] || []);

  const homeProj  = computeScore(homeRoster);
  const awayProj  = computeScore(awayRoster);

  const { isLive, isFinal } = deriveMatchupStatus(homeRoster, awayRoster, liveGameStatus, fallbackIsLive, fallbackIsFinal);
  const hasActual = isLive || isFinal;

  // Two distinct numbers: the real/actual score (stats only, never
  // blended — this is the main score shown) and a separate projected-final
  // estimate (blended with pace) shown only via the win-probability bar's
  // "proj. final" caption, never as the primary number.
  const homeActual  = computeActualTeamTotal(homeRoster, livePlayerPts);
  const awayActual  = computeActualTeamTotal(awayRoster, livePlayerPts);
  const homeBlended = computeBlendedTeamTotal(homeRoster, liveGameStatus, livePlayerPts);
  const awayBlended = computeBlendedTeamTotal(awayRoster, liveGameStatus, livePlayerPts);

  const homeStarterProj = rosterGroupPts(homeRoster, 'STARTERS');
  const homeBenchProj   = rosterGroupPts(homeRoster, 'BENCH');
  const awayStarterProj = rosterGroupPts(awayRoster, 'STARTERS');
  const awayBenchProj   = rosterGroupPts(awayRoster, 'BENCH');

  const homePts = hasActual ? homeActual : homeProj;
  const awayPts = hasActual ? awayActual : awayProj;
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
        <TeamScore team={home} pts={homePts} projPts={hasActual ? homeProj : null} win={homeWin} side="home" showPts={isLive || isFinal} isMe={homeId === myTeamId} rosterOk={homeRosterOk} record={homeRecord} hasActual={hasActual} starterProj={homeStarterProj} benchProj={homeBenchProj} />
        <div style={{ flexShrink: 0, textAlign: 'center', padding: '0 14px', minWidth: 80 }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: labelColor, letterSpacing: '.08em', marginBottom: 4 }}>{label}</div>
          <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-faint)' }}>vs</div>
        </div>
        <TeamScore team={away} pts={awayPts} projPts={hasActual ? awayProj : null} win={awayWin} side="away" showPts={isLive || isFinal} isMe={awayId === myTeamId} rosterOk={awayRosterOk} record={awayRecord} hasActual={hasActual} starterProj={awayStarterProj} benchProj={awayBenchProj} />
        <div style={{ marginLeft: 'auto', paddingRight: 14, color: 'var(--text-faint)', fontSize: 12 }}>
          {expanded ? '▲' : '▼'}
        </div>
      </div>

      {/* Racing bar — always visible. Fed the live-blended totals, which
          equal the static proj sums until a game actually starts, so this
          matches today's look exactly outside of live windows. */}
      <WinProbabilityBar
        homeTeam={home}
        awayTeam={away}
        homeExpected={homeBlended}
        awayExpected={awayBlended}
        isLive={hasActual}
      />

      {expanded && (
        <>
          <div style={{ borderTop: '1px solid var(--border)', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 0 }}>
            <RosterBreakdown roster={homeRoster} teamId={homeId} week={week} onOpenPlayer={onOpenPlayer} isProjected={!isLive && !isFinal} liveGameStatus={liveGameStatus} livePlayerPts={livePlayerPts} />
            <RosterBreakdown roster={awayRoster} teamId={awayId} week={week} onOpenPlayer={onOpenPlayer} side="away" isProjected={!isLive && !isFinal} liveGameStatus={liveGameStatus} livePlayerPts={livePlayerPts} />
          </div>
          <SmackTalkWall matchupKey={`${week}-${homeId}-${awayId}`} homeTeam={home} awayTeam={away} />
        </>
      )}
    </div>
  );
}

function SmackTalkWall({ matchupKey, homeTeam, awayTeam }) {
  const storageKey = `fantasai_smack_${matchupKey}`;
  const [comments, setComments] = React.useState(() => {
    try { return JSON.parse(localStorage.getItem(storageKey) || '[]'); } catch { return []; }
  });
  const [text, setText] = React.useState('');
  const [authorTeamId, setAuthorTeamId] = React.useState(() => {
    try { return JSON.parse(localStorage.getItem('fantasai_user') || 'null')?.teamId ?? null; } catch { return null; }
  });
  const inputRef = React.useRef(null);

  function post() {
    const trimmed = text.trim();
    if (!trimmed) return;
    const comment = {
      id: Date.now().toString(),
      teamId: authorTeamId,
      text: trimmed,
      emoji: pickEmoji(trimmed),
      timestamp: new Date().toISOString(),
    };
    const next = [...comments, comment];
    setComments(next);
    localStorage.setItem(storageKey, JSON.stringify(next));
    setText('');
    inputRef.current?.focus();
  }

  function remove(id) {
    const next = comments.filter(c => c.id !== id);
    setComments(next);
    localStorage.setItem(storageKey, JSON.stringify(next));
  }

  function pickEmoji(txt) {
    const t = txt.toLowerCase();
    if (t.includes('win') || t.includes('beat')) return '🏆';
    if (t.includes('trash') || t.includes('weak')) return '🗑️';
    if (t.includes('good') || t.includes('nice')) return '👍';
    if (t.includes('lol') || t.includes('haha')) return '😂';
    if (t.includes('fire') || t.includes('hot')) return '🔥';
    return '💬';
  }

  function teamName(teamId) {
    if (teamId === homeTeam?.id) return homeTeam?.name ?? 'Home';
    if (teamId === awayTeam?.id) return awayTeam?.name ?? 'Away';
    const t = LEAGUE_TEAMS.find(x => x.id === teamId);
    return t?.name ?? 'League Member';
  }

  function teamColor(teamId) {
    if (teamId === homeTeam?.id) return homeTeam?.color ?? '#c6ff3a';
    if (teamId === awayTeam?.id) return awayTeam?.color ?? '#4ea8ff';
    return '#888';
  }

  return (
    <div style={{ borderTop: '1px solid var(--border)', padding: '14px 18px', background: 'rgba(255,255,255,.015)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
        <span style={{ fontSize: 14 }}>💬</span>
        <span style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.1em', color: 'var(--text-faint)', fontFamily: 'var(--font-mono)' }}>Smack Talk Wall</span>
        {comments.length > 0 && (
          <span style={{ fontSize: 9, fontFamily: 'var(--font-mono)', background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 4, padding: '1px 6px', color: 'var(--text-faint)' }}>
            {comments.length}
          </span>
        )}
      </div>

      {/* Comment list */}
      {comments.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 10 }}>
          {comments.map(c => {
            const color = teamColor(c.teamId);
            return (
              <div key={c.id} style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                <span style={{ width: 24, height: 24, borderRadius: '50%', background: color, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, flexShrink: 0, fontWeight: 700 }}>
                  {c.emoji}
                </span>
                <div style={{ flex: 1, background: 'var(--panel)', borderRadius: 8, padding: '7px 10px', border: '1px solid var(--border)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3 }}>
                    <span style={{ fontSize: 10, fontWeight: 700, color }}>{teamName(c.teamId)}</span>
                    <span style={{ fontSize: 9, color: 'var(--text-faint)', fontFamily: 'var(--font-mono)' }}>
                      {new Date(c.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--text)', lineHeight: 1.5 }}>{c.text}</div>
                </div>
                <button onClick={() => remove(c.id)} style={{ background: 'none', border: 'none', color: 'var(--text-faint)', cursor: 'pointer', fontSize: 12, padding: '4px 6px', flexShrink: 0, lineHeight: 1 }}>✕</button>
              </div>
            );
          })}
        </div>
      )}

      {/* Input */}
      <div style={{ display: 'flex', gap: 8 }}>
        <select
          value={authorTeamId ?? ''}
          onChange={e => setAuthorTeamId(Number(e.target.value) || null)}
          style={{ fontSize: 11, background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 6, color: 'var(--text)', padding: '4px 8px', flexShrink: 0 }}
        >
          <option value="">Team…</option>
          {[homeTeam, awayTeam].filter(Boolean).map(t => (
            <option key={t.id} value={t.id}>{t.name}</option>
          ))}
        </select>
        <input
          ref={inputRef}
          value={text}
          onChange={e => setText(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); post(); } }}
          placeholder="Drop some trash talk…"
          style={{ flex: 1, background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 6, color: 'var(--text)', padding: '6px 10px', fontSize: 12, outline: 'none', fontFamily: 'inherit' }}
        />
        <button className="btn primary sm" onClick={post} style={{ flexShrink: 0 }}>Post</button>
      </div>
    </div>
  );
}

/* ── Win Probability Racing Bar ─────────────────────────────────────────── */
function WinProbabilityBar({ homeTeam, awayTeam, homeExpected, awayExpected, isLive }) {
  const total    = (homeExpected + awayExpected) || 1;
  const homeProb = homeExpected / total;
  const homePct  = Math.round(homeProb * 100);
  const awayPct  = 100 - homePct;
  const isClose  = Math.abs(homePct - awayPct) <= 6;
  const capLabel = isLive ? 'proj. final' : 'proj';

  const GREEN = '#4ed87b';
  const RED   = '#ff5a6e';
  const TIE   = '#e0c84b';

  const homeC = isClose ? TIE : homePct > 50 ? GREEN : RED;
  const awayC = isClose ? TIE : awayPct > 50 ? GREEN : RED;

  return (
    <div style={{ padding: '10px 22px 14px', borderTop: '1px solid var(--border)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 5 }}>
        <span style={{ fontSize: 13, fontWeight: 800, fontFamily: 'var(--font-mono)', color: homeC }}>{homePct}%</span>
        <span style={{ fontSize: 9, fontFamily: 'var(--font-mono)', color: 'var(--text-faint)', letterSpacing: '.08em', textTransform: 'uppercase' }} title="Rough estimate from projected final scores — not a calibrated model">
          {isClose ? '⚖️ Toss-Up' : 'Win Probability'}
        </span>
        <span style={{ fontSize: 13, fontWeight: 800, fontFamily: 'var(--font-mono)', color: awayC }}>{awayPct}%</span>
      </div>

      {/* Racing bar */}
      <div style={{ height: 12, borderRadius: 6, overflow: 'hidden', display: 'flex', background: 'var(--panel-3)' }}>
        <div style={{ width: `${homePct}%`, background: homeC, transition: 'width 1s cubic-bezier(.4,0,.2,1)', borderRadius: '6px 0 0 6px', opacity: 0.9 }} />
        <div style={{ width: `${awayPct}%`, background: awayC, transition: 'width 1s cubic-bezier(.4,0,.2,1)', borderRadius: '0 6px 6px 0', opacity: 0.9 }} />
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 5 }}>
        <span style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--text-faint)' }}>
          {homeTeam?.name} · <span style={{ color: homeC, fontWeight: 700 }}>{homeExpected.toFixed(1)}</span> {capLabel}
        </span>
        <span style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--text-faint)', textAlign: 'right' }}>
          {awayTeam?.name} · <span style={{ color: awayC, fontWeight: 700 }}>{awayExpected.toFixed(1)}</span> {capLabel}
        </span>
      </div>
    </div>
  );
}


function TeamScore({ team, pts, projPts, win, side, showPts, isMe, rosterOk, record, hasActual, starterProj, benchProj }) {
  if (!team) return null;
  const isRight = side === 'away';
  const logoSize = team.logoImg ? 64 : 56;
  const subColor = 'var(--text-dim)';
  return (
    <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 14, padding: '20px 22px', flexDirection: isRight ? 'row-reverse' : 'row', background: isMe ? 'rgba(76,175,130,.08)' : 'transparent' }}>
      {team.logoImg
        ? <img src={team.logoImg} alt={team.logo} style={{ width: logoSize, height: logoSize, borderRadius: 10, objectFit: 'cover', flexShrink: 0, boxShadow: '0 2px 10px rgba(0,0,0,.35)' }} />
        : <span style={{ width: logoSize, height: logoSize, borderRadius: 10, background: team.color, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 16, fontWeight: 900, color: '#000', flexShrink: 0, letterSpacing: '-0.03em', boxShadow: `0 2px 10px ${team.color}55` }}>{team.logo}</span>
      }
      <div style={{ flex: 1, minWidth: 0, textAlign: isRight ? 'right' : 'left' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexDirection: isRight ? 'row-reverse' : 'row' }}>
          <span style={{ fontSize: 15, fontWeight: 800, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: isMe ? '#4caf82' : 'var(--text)', letterSpacing: '-.01em' }}>{team.name}</span>
          {isMe && <span style={{ fontSize: 8, fontFamily: 'var(--font-mono)', color: '#fff', background: '#4caf82', borderRadius: 3, padding: '1px 5px', fontWeight: 800, flexShrink: 0 }}>YOU</span>}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 5, flexDirection: isRight ? 'row-reverse' : 'row', marginTop: 3 }}>
          <span style={{ fontSize: 12, color: 'var(--text-dim)' }}>{team.owner}</span>
          {record && <span style={{ fontSize: 9, fontFamily: 'var(--font-mono)', fontWeight: 700, color: 'var(--text-faint)', background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 3, padding: '1px 5px', flexShrink: 0 }}>{record}</span>}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 5, flexDirection: isRight ? 'row-reverse' : 'row', marginTop: 4 }}>
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
        <div style={{ flexShrink: 0, textAlign: isRight ? 'left' : 'right' }}>
          <div style={{ fontFamily: 'var(--font-display)', fontStretch: '75%', color: rosterOk ? (hasActual ? '#1affa0' : '#4ea8ff') : 'var(--danger)' }}>
            <div style={{ fontSize: 36, fontWeight: 900, lineHeight: 1 }}>{rosterOk ? pts.toFixed(1) : '—'}</div>
            {win && rosterOk && hasActual && <div style={{ fontSize: 9, fontFamily: 'var(--font-mono)', fontWeight: 700, color: '#1affa0', letterSpacing: '.06em', marginTop: 2 }}>WIN</div>}
            {rosterOk && !hasActual && <div style={{ fontSize: 9, fontFamily: 'var(--font-mono)', fontWeight: 700, color: '#4ea8ff', letterSpacing: '.06em', marginTop: 2 }}>PROJ</div>}
          </div>
          {/* Starters proj + bench proj */}
          {rosterOk && (
            <div style={{ marginTop: 5, display: 'flex', flexDirection: 'column', gap: 2, alignItems: isRight ? 'flex-start' : 'flex-end' }}>
              <div style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: subColor, display: 'flex', alignItems: 'center', gap: 4, flexDirection: isRight ? 'row' : 'row-reverse' }}>
                <span style={{ fontWeight: 700 }}>{(starterProj ?? 0).toFixed(1)}</span>
                <span style={{ fontSize: 8, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '.06em' }}>starters proj</span>
              </div>
              <div style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: subColor, display: 'flex', alignItems: 'center', gap: 4, flexDirection: isRight ? 'row' : 'row-reverse' }}>
                <span style={{ fontWeight: 700 }}>{(benchProj ?? 0).toFixed(1)}</span>
                <span style={{ fontSize: 8, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '.06em' }}>bench</span>
              </div>
            </div>
          )}
          {/* Fallback: show original proj label when no actual */}
          {hasActual && projPts != null && rosterOk && (
            <div style={{ fontSize: 9, color: 'var(--text-faint)', fontFamily: 'var(--font-mono)', marginTop: 3 }}>
              {projPts.toFixed(1)} proj
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function NflScores({ week, seasonType }) {
  const [data, setData] = React.useState(null);
  const [players, setPlayers] = React.useState([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState(null);
  const season = 2026;

  React.useEffect(() => {
    const workerUrl = (localStorage.getItem('fantasai.workerUrl') || '').replace(/\/$/, '');
    if (!workerUrl) { setLoading(false); setError('no_worker'); return; }
    setLoading(true);
    setError(null);
    Promise.all([
      fetch(`${workerUrl}/api/v1/nfl/scoreboard?week=${week}&season=${season}&type=${seasonType}`).then(r => r.json()),
      fetch(`${workerUrl}/api/v1/nfl/player-stats?week=${week}&season=${season}&type=${seasonType}`).then(r => r.json()),
    ])
      .then(([board, stats]) => {
        setData(board);
        const rules = getScoringRules();
        setPlayers((stats.players || []).map(p => ({ ...p, pts: p.pts ?? calcFantasyPts(p.stats, rules, p.pos) })));
        setLoading(false);
      })
      .catch(() => { setError('fetch_failed'); setLoading(false); });
  }, [week, season, seasonType]);

  // Every rostered player across the league, so top performers who are
  // NOT in this set can be flagged as available on waivers.
  const rosteredPlayerIds = React.useMemo(() => {
    const set = new Set();
    for (const t of LEAGUE_TEAMS) {
      for (const entry of (TEAM_ROSTERS[t.id] || [])) {
        if (entry.playerId) set.add(entry.playerId);
      }
    }
    return set;
  }, []);

  return (
    <div className="card">
      <div className="card-head">
        <div className="card-title" style={{ flex: 1 }}>
          {(data?.games || []).some(g => new Date(g.date) > new Date()) ? 'NFL Schedule' : 'NFL Scores'} · Wk {week}
        </div>
        <span style={{ fontSize: 9, color: '#e05e5e', fontWeight: 800, fontFamily: 'var(--font-mono)', letterSpacing: '.06em', background: 'rgba(224,94,94,.12)', padding: '2px 6px', borderRadius: 4, border: '1px solid rgba(224,94,94,.25)' }}>LOCAL</span>
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
            {data?.note
              ? data.note
              : `No games cached for ${seasonType} week ${week} yet — run job_live_scores.py locally, or it'll pick this up automatically once it's within range.`
            }
          </div>
        )}
        {(data?.games || []).map(game => (
          <NflGameRow key={game.id} game={game} players={players} rosteredPlayerIds={rosteredPlayerIds} />
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

function NflGameRow({ game, players = [], rosteredPlayerIds }) {
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
      {(isLive || isFinal) && (
        <GameTopPerformers home={home} away={away} players={players} rosteredPlayerIds={rosteredPlayerIds} />
      )}
    </div>
  );
}

// Top fantasy performers for one game — whichever rostered/available players
// have actually recorded stats so far, ranked by fantasy points. Anyone NOT
// currently on a league roster (i.e. sitting on waivers) is called out —
// a hot free agent putting up points live is exactly what you want to catch.
function GameTopPerformers({ home, away, players, rosteredPlayerIds }) {
  const gameTeams = new Set([home?.abbr, away?.abbr].filter(Boolean));
  const top = players
    .filter(p => gameTeams.has(p.team) && (p.pts || 0) > 0)
    .sort((a, b) => (b.pts || 0) - (a.pts || 0))
    .slice(0, 5);

  if (top.length === 0) return null;

  return (
    <div style={{ marginTop: 6, paddingTop: 6, borderTop: '1px dashed var(--border)', display: 'flex', flexDirection: 'column', gap: 3 }}>
      <div style={{ fontSize: 8, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '.06em', fontWeight: 700 }}>
        Top Fantasy Performers
      </div>
      {top.map(p => {
        const live = findPlayerByName(p.name);
        const isWaiver = !!live && !rosteredPlayerIds?.has(live.id);
        const statLine = formatStatLine({ pos: p.pos }, p.stats);
        return (
          <div
            key={p.name}
            style={{
              display: 'flex', alignItems: 'center', gap: 6, fontSize: 10,
              padding: isWaiver ? '2px 6px' : '1px 0',
              background: isWaiver ? 'rgba(52,211,153,.12)' : 'transparent',
              border: isWaiver ? '1px solid rgba(52,211,153,.35)' : 'none',
              borderRadius: isWaiver ? 5 : 0,
            }}
          >
            {p.pos && <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 800, fontSize: 8, color: 'var(--text-faint)', width: 22, flexShrink: 0 }}>{p.pos}</span>}
            <span style={{ fontWeight: isWaiver ? 800 : 600, color: isWaiver ? '#34d399' : 'var(--text)', flexShrink: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 110 }}>
              {p.name}
            </span>
            {isWaiver && (
              <span style={{ fontSize: 7, fontWeight: 900, color: '#34d399', background: 'rgba(52,211,153,.18)', padding: '1px 4px', borderRadius: 3, letterSpacing: '.03em', flexShrink: 0 }} title="Not on any league roster — available on waivers">
                FA
              </span>
            )}
            <span style={{ flex: 1, color: 'var(--text-faint)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{statLine || ''}</span>
            <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 800, color: 'var(--text)', flexShrink: 0 }}>{(p.pts || 0).toFixed(1)}</span>
          </div>
        );
      })}
    </div>
  );
}

function formatStatLine(p, lockedStats) {
  if (!p) return null;
  const s = lockedStats || {};
  const parts = [];
  const pos = p.pos;

  const showPassing = () => {
    if (s.passYds) parts.push(`${s.passYds}y`);
    if (s.passTds) parts.push(`${s.passTds}td`);
    if (s.passInt) parts.push(`${s.passInt}int`);
    if (s.rushYds) parts.push(`${s.rushYds} rush`);
  };
  const showRushing = () => {
    if (s.rushYds) parts.push(`${s.rushYds}y`);
    if (s.rushTds) parts.push(`${s.rushTds}td`);
    if (s.rec != null) parts.push(`${s.rec}rec`);
    if (s.recYds) parts.push(`+${s.recYds}y`);
  };
  const showReceiving = () => {
    if (s.rec != null) parts.push(`${s.rec}rec`);
    if (s.recYds) parts.push(`${s.recYds}y`);
    if (s.recTds) parts.push(`${s.recTds}td`);
    if (s.targets) parts.push(`${s.targets}tgt`);
  };
  const showKicking = () => {
    if (s.fgMade) parts.push(`${s.fgMade}fg`);
    if (s.xpMade) parts.push(`${s.xpMade}xp`);
  };
  const showDefense = () => {
    if (s.sacks) parts.push(`${s.sacks}sk`);
    if (s.ints) parts.push(`${s.ints}int`);
    if (s.ptsAllowed != null) parts.push(`${s.ptsAllowed}pa`);
  };

  if (s.passYds || pos === 'QB') showPassing();
  else if (pos === 'RB') showRushing();
  else if (['WR', 'TE'].includes(pos)) showReceiving();
  else if (pos === 'K' || pos === 'PK') showKicking();
  else if (['DST', 'D/ST', 'DEF'].includes(pos)) showDefense();
  else {
    // ESPN sometimes omits position on a box-score entry (a real, known
    // gap — not every player line is tagged). Rather than show nothing for
    // someone who clearly scored points, infer the category from whichever
    // stats are actually present.
    if (s.rushYds || s.rushTds) showRushing();
    else if (s.rec != null || s.recYds || s.recTds || s.targets) showReceiving();
    else if (s.fgMade || s.fgAtt || s.xpMade) showKicking();
    else if (s.sacks || s.ints || s.ptsAllowed != null) showDefense();
  }

  if (parts.length === 0 && p.last) parts.push(`${p.last.toFixed(1)} last wk`);
  return parts.length > 0 ? parts.join(' · ') : null;
}

function RosterBreakdown({ roster, teamId, week, onOpenPlayer, side, isProjected, liveGameStatus, livePlayerPts }) {
  const starters = roster.filter(r => r.slot !== 'BENCH');
  const bench    = roster.filter(r => r.slot === 'BENCH');
  const isRight  = side === 'away';

  // Per-starter: blended actual-so-far + pace-adjusted remaining projection.
  // null gameStatus (bye week / not playing) falls back to that player's
  // own static proj, same as computeBlendedTeamTotal does at the card level.
  function liveInfoFor(p) {
    const proj = playerProjPts(p);
    if (!p) return { gameStatus: null, proj, real: 0, progress: 0, stats: null };
    const gameStatus = liveGameStatus?.[normalizeTeamAbbr(p.team)] || null;
    const liveEntry = findLivePlayerEntry(livePlayerPts, p);
    return {
      gameStatus,
      proj,
      // Real/actual — stats only, never blended with projection. 0 if this
      // player hasn't recorded anything (game not started, or nothing yet).
      real: liveEntry?.pts ?? 0,
      progress: gameStatus ? getGameProgress(gameStatus) : 0,
      stats: liveEntry?.stats ?? null,
    };
  }

  // "TEAM" for byes/no data, "TEAM · Sun 1:00 PM" pre-kickoff, "TEAM · Q2 8:45"
  // live, "TEAM · Final" once the game's over — so it's clear when a player's
  // points will actually start moving.
  function gameLabel(p, gameStatus) {
    const team = p?.team || '';
    if (p?.bye && p.bye === week) return `${team} · BYE`;
    if (!gameStatus) return team;
    if (gameStatus.completed || gameStatus.state === 'post') return `${team} · Final`;
    if (gameStatus.state === 'in') {
      const q = gameStatus.period ? `Q${gameStatus.period}` : 'Live';
      return `${team} · ${q}${gameStatus.clock ? ` ${gameStatus.clock}` : ''}`;
    }
    if (gameStatus.kickoff) {
      const d = new Date(gameStatus.kickoff);
      if (!isNaN(d)) {
        const when = d.toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' });
        return `${team} · ${when}${gameStatus.opp ? ` ${gameStatus.isAway ? '@' : 'vs'} ${gameStatus.opp}` : ''}`;
      }
    }
    return team;
  }

  const totalProj = starters.reduce((s, e) => s + playerProjPts(e.playerId ? findPlayer(e.playerId) : null), 0);
  const liveInfos = starters.map(e => liveInfoFor(e.playerId ? findPlayer(e.playerId) : null));
  const hasActual = liveInfos.some(v => v.gameStatus !== null);
  const totalActual = hasActual ? liveInfos.reduce((s, v) => s + v.real, 0) : null;
  const total = totalActual ?? totalProj;
  const ptColor = isProjected && !hasActual ? 'var(--text-dim)' : 'var(--accent)';

  return (
    <div style={{ borderRight: isRight ? 'none' : '1px solid var(--border)', padding: '10px 0' }}>
      {/* Header */}
      <div style={{ padding: '4px 16px 6px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-faint)', letterSpacing: '.1em' }}>STARTERS</span>
          <span style={{ fontSize: 8, fontWeight: 800, color: hasActual ? '#4ea8ff' : 'var(--text-faint)', background: 'var(--panel)', border: `1px solid ${hasActual ? 'rgba(78,168,255,.4)' : 'var(--border)'}`, borderRadius: 3, padding: '1px 5px', fontFamily: 'var(--font-mono)', letterSpacing: '.06em' }}>
            {hasActual ? 'ACTUAL' : 'PROJ'}
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 12 }}>
          {hasActual && <span style={{ fontSize: 9, color: 'var(--text-faint)', fontFamily: 'var(--font-mono)' }}>{totalProj.toFixed(1)} proj</span>}
          <span style={{ fontSize: 13, fontWeight: 800, color: ptColor }}>{total.toFixed(1)} pts</span>
        </div>
      </div>

      {/* Column labels */}
      <div style={{ display: 'grid', gridTemplateColumns: '32px 1fr 22px 44px 48px', padding: '2px 16px 4px', borderBottom: '1px solid rgba(255,255,255,.06)', fontSize: 8, fontWeight: 700, color: 'var(--text-faint)', fontFamily: 'var(--font-mono)', letterSpacing: '.08em', textTransform: 'uppercase' }}>
        <span />
        <span />
        <span style={{ textAlign: 'center' }}>MVR</span>
        <span style={{ textAlign: 'right' }}>PROJ</span>
        <span style={{ textAlign: 'right', color: hasActual ? '#4ea8ff' : 'var(--text-faint)' }}>ACT</span>
      </div>

      {starters.map((entry, i) => {
        const p = entry.playerId ? findPlayer(entry.playerId) : null;
        const info = liveInfos[i];
        const proj = info.proj;
        const isLiveRow = info.gameStatus !== null;
        const actual = isLiveRow ? info.real : null;
        const statLine = formatStatLine(p, info.stats);
        const dispScore = actual ?? proj;
        const actColor = actual != null ? (dispScore >= 20 ? 'var(--accent)' : dispScore >= 10 ? '#4ea8ff' : 'var(--text)') : 'var(--text-faint)';
        // Only judge pace once the game has actually started — a player
        // showing 0 before kickoff hasn't underperformed, they just haven't
        // played yet.
        let mover = '';
        if (actual != null && proj > 0 && info.progress > 0) {
          if (actual >= proj * 1.25) mover = '🔥';
          else if (actual < proj * 0.5) mover = '❄️';
        }
        return (
          <div key={i}
            style={{ padding: '5px 16px', display: 'grid', gridTemplateColumns: '32px 1fr 22px 44px 48px', alignItems: 'center', gap: 6, fontSize: 11, cursor: p && onOpenPlayer ? 'pointer' : 'default' }}
            onClick={p && onOpenPlayer ? () => onOpenPlayer(p.id) : undefined}
          >
            <span style={{ fontSize: 9, color: 'var(--text-faint)', fontFamily: 'var(--font-mono)' }}>{entry.slot}</span>
            {p ? (
              <>
                <div style={{ minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                    <PosBadge pos={p.pos} />
                    <span style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</span>
                  </div>
                  <div style={{ fontSize: 9, color: isLiveRow && info.gameStatus?.state === 'in' ? '#4ea8ff' : 'var(--text-faint)', fontFamily: 'var(--font-mono)', marginTop: 2, paddingLeft: 22, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {gameLabel(p, info.gameStatus)}
                  </div>
                  {statLine && (
                    <div style={{ fontSize: 9, color: 'var(--text-faint)', fontFamily: 'var(--font-mono)', marginTop: 1, paddingLeft: 22, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{statLine}</div>
                  )}
                </div>
                <span style={{ textAlign: 'center', fontSize: 13, lineHeight: 1 }}>{mover}</span>
                <span style={{ textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-dim)' }}>{proj.toFixed(1)}</span>
                <span style={{ textAlign: 'right', fontFamily: 'var(--font-mono)', fontWeight: 800, fontSize: 12, color: actColor }}>
                  {actual != null ? actual.toFixed(1) : '—'}
                </span>
              </>
            ) : (
              <>
                <span style={{ color: 'var(--text-faint)', fontSize: 10, fontStyle: 'italic' }}>Empty slot</span>
                <span />
                <span />
                <span />
              </>
            )}
          </div>
        );
      })}
      {bench.length > 0 && (
        <div style={{ padding: '8px 16px 2px', fontSize: 10, fontWeight: 700, color: 'var(--text-faint)', letterSpacing: '.1em' }}>BENCH</div>
      )}
      {bench.map((entry, i) => {
        const p = entry.playerId ? findPlayer(entry.playerId) : null;
        const pts = playerProjPts(p);
        const delta = p ? pts - (p.avg || 0) : 0;
        const mover = delta >= 3 ? '🔥' : delta <= -3 ? '❄️' : '';
        return (
          <div key={i} style={{ padding: '4px 16px', display: 'flex', alignItems: 'center', gap: 8, fontSize: 11, opacity: 0.55 }}>
            <span style={{ fontSize: 9, color: 'var(--text-faint)', width: 32, fontFamily: 'var(--font-mono)' }}>BN</span>
            {p ? (
              <>
                <PosBadge pos={p.pos} />
                <span style={{ flex: 1 }}>{p.name}</span>
                {mover && <span style={{ fontSize: 13 }}>{mover}</span>}
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-faint)' }}>{pts.toFixed(1)} proj</span>
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

