import React from 'react';
import { LEAGUE_TEAMS, TEAM_ROSTERS, buildRosterFrame, assignRoster, findTeam, refreshTeamRosters } from '../lib/data.js';
import { findPlayer, usePlayers } from '../lib/playerStore.js';
import { PosBadge, TeamLogoBadge } from '../components/ui.jsx';

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

function loadLockedScores(season, week) {
  try {
    const key = `fantasai_week_scores_${season}_${week}`;
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch { return null; }
}

function getActualPtsFromLocked(locked, roster) {
  if (!locked?.players) return null;
  const starters = roster.filter(r => r.slot !== 'BENCH' && r.playerId);
  let total = 0;
  let matched = 0;
  for (const entry of starters) {
    const p = findPlayer(entry.playerId);
    if (!p) continue;
    const lockedPlayer = locked.players.find(lp =>
      lp.name?.toLowerCase().trim() === p.name?.toLowerCase().trim()
    );
    if (lockedPlayer) { total += lockedPlayer.pts || 0; matched++; }
  }
  return matched > 0 ? Math.round(total * 10) / 10 : null;
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

export default function HeadToHeadScreen({ onOpenPlayer, user, myRosterIds, slotOverrides }) {
  const allPlayers = usePlayers(); // subscribe so roster re-assigns when player data loads
  const [week, setWeek] = React.useState(CURRENT_WEEK);
  const [expanded, setExpanded] = React.useState(0);
  const [showAll, setShowAll] = React.useState(false);
  const [isMobile, setIsMobile] = React.useState(() => window.matchMedia('(max-width: 900px)').matches);
  const [h2hMobileTab, setH2hMobileTab] = React.useState('matchups'); // 'matchups' | 'scores'
  const [mobileScoringOpen, setMobileScoringOpen] = React.useState(false);

  // Sync TEAM_ROSTERS from localStorage whenever H2H is opened so drafted players appear
  const [rosterVersion, setRosterVersion] = React.useState(0);
  React.useEffect(() => {
    refreshTeamRosters();
    setRosterVersion(v => v + 1);
  }, []);


  React.useEffect(() => {
    const mq = window.matchMedia('(max-width: 900px)');
    const h = e => setIsMobile(e.matches);
    mq.addEventListener('change', h);
    return () => mq.removeEventListener('change', h);
  }, []);

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
            <div className="sub">Weekly matchup results · rosters pulled from Current Roster settings</div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginLeft: 'auto', flexWrap: 'nowrap' }}>
            <button
              className="btn"
              style={{ background: '#22c55e', border: 'none', color: '#fff', fontWeight: 700, flexShrink: 0, whiteSpace: 'nowrap' }}
              onClick={() => setMobileScoringOpen(true)}
            >📱 Mobile Scoring</button>

            <div style={{ display: 'flex', alignItems: 'center', gap: 0, background: 'var(--panel)', borderRadius: 8, padding: 3, flexShrink: 0 }}>
              {[{ label: 'My H2H', val: false }, { label: 'All Matchups', val: true }].map(opt => (
                <button
                  key={String(opt.val)}
                  onClick={() => { setShowAll(opt.val); setExpanded(opt.val ? null : 0); }}
                  style={{
                    padding: '6px 14px', borderRadius: 6, fontSize: 12, fontWeight: showAll === opt.val ? 700 : 500,
                    cursor: 'pointer', border: 'none', whiteSpace: 'nowrap',
                    background: showAll === opt.val ? 'var(--accent)' : 'transparent',
                    color: showAll === opt.val ? 'var(--accent-ink)' : 'var(--text-dim)',
                    transition: 'background .15s, color .15s',
                  }}
                >
                  {opt.label}
                </button>
              ))}
            </div>

            <div style={{ display: 'flex', gap: 3, overflowX: 'auto' }}>
              {Array.from({ length: NUM_WEEKS }, (_, i) => i + 1).map(w => (
                <button
                  key={w}
                  onClick={() => { setWeek(w); setExpanded(showAll ? null : 0); }}
                  style={{
                    flexShrink: 0, padding: '4px 6px', borderRadius: 5, fontSize: 10, fontWeight: 600,
                    cursor: 'pointer', border: '1px solid var(--border)', whiteSpace: 'nowrap',
                    background: w === week ? 'var(--accent)' : w < CURRENT_WEEK ? 'var(--panel)' : 'transparent',
                    color: w === week ? 'var(--accent-ink)' : w < CURRENT_WEEK ? 'var(--text)' : 'var(--text-dim)',
                  }}
                >
                  {w === CURRENT_WEEK ? `Wk ${w}●` : `Wk ${w}`}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {isMobile && (
        <div style={{ display: 'flex', gap: 0, background: 'var(--panel)', borderRadius: 8, padding: 3, alignSelf: 'flex-start' }}>
          {[{ id: 'matchups', label: 'Matchups' }, { id: 'scores', label: 'NFL Scores' }].map(t => (
            <button key={t.id} onClick={() => setH2hMobileTab(t.id)} style={{
              padding: '6px 16px', borderRadius: 6, fontSize: 12, fontWeight: h2hMobileTab === t.id ? 700 : 500,
              cursor: 'pointer', border: 'none',
              background: h2hMobileTab === t.id ? 'var(--accent)' : 'transparent',
              color: h2hMobileTab === t.id ? 'var(--accent-ink)' : 'var(--text-dim)',
            }}>{t.label}</button>
          ))}
        </div>
      )}
      <div style={{ display: isMobile ? 'block' : 'grid', gridTemplateColumns: '1fr 280px', gap: 20, alignItems: 'start' }}>
        {(!isMobile || h2hMobileTab === 'matchups') && (
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
                season={CURRENT_SEASON}
                isLive={week === CURRENT_WEEK}
                isFinal={week < CURRENT_WEEK}
                expanded={expanded === idx}
                onToggle={() => setExpanded(expanded === idx ? null : idx)}
                onOpenPlayer={onOpenPlayer}
                myTeamId={myTeamId}
                myLiveRoster={myLiveRoster}
                allTeamRosters={allTeamRosters}
                homeRecord={homeRec ? `${homeRec.w}–${homeRec.l}` : null}
                awayRecord={awayRec ? `${awayRec.w}–${awayRec.l}` : null}
              />
            );
          })}
        </div>
        )}

        {/* Right column: NFL Scores */}
        {(!isMobile || h2hMobileTab === 'scores') && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <NflScores week={week} />
        </div>
        )}
      </div>

      {mobileScoringOpen && (
        <MobileScoringPopup
          onClose={() => setMobileScoringOpen(false)}
          myTeamId={myTeamId}
          week={week}
          matchups={allMatchups}
        />
      )}
    </div>
  );
}

function MobileScoringPopup({ onClose, myTeamId, week, matchups }) {
  function computeTeamScore(teamId) {
    const roster   = TEAM_ROSTERS[teamId] || [];
    const starters = roster.filter(r => r.slot !== 'BENCH' && r.playerId);
    return starters.reduce((total, r) => {
      const p = findPlayer(r.playerId);
      return total + (p ? (p.proj || p.avg || 0) : 0);
    }, 0);
  }

  const TeamRow = ({ team, teamId, score, winning }) => (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
      <span style={{
        width: 44, height: 44, borderRadius: 10,
        background: team?.color || '#555',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 18, fontWeight: 900, color: '#fff', flexShrink: 0,
      }}>
        {team?.logo || '??'}
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 700, fontSize: 15, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{team?.name || 'Team'}</div>
        {teamId === myTeamId && (
          <span style={{ fontSize: 9, color: 'var(--accent)', fontFamily: 'var(--font-mono)', fontWeight: 800, letterSpacing: '.06em' }}>YOU</span>
        )}
      </div>
      <div style={{ fontFamily: 'var(--font-display)', fontWeight: 900, fontStretch: '75%', fontSize: 32, color: '#4ea8ff', lineHeight: 1 }}>
        {score.toFixed(1)}
      </div>
    </div>
  );

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 9999, background: 'var(--bg)', display: 'flex', flexDirection: 'column' }}>
      <div style={{ background: 'var(--bg-2)', borderBottom: '1px solid var(--border)', padding: '16px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
        <div>
          <div style={{ fontWeight: 900, fontSize: 18, letterSpacing: '-.01em' }}>Week {week ?? '—'} Scores</div>
          <div style={{ fontSize: 11, color: 'var(--text-faint)', marginTop: 2 }}>H2H Matchup Projections</div>
        </div>
        <button
          onClick={onClose}
          style={{ background: 'rgba(255,255,255,.08)', border: '1px solid var(--border)', color: 'var(--text)', fontSize: 20, cursor: 'pointer', borderRadius: '50%', width: 38, height: 38, display: 'flex', alignItems: 'center', justifyContent: 'center', lineHeight: 1, flexShrink: 0 }}
        >✕</button>
      </div>
      <div style={{ flex: 1, overflowY: 'auto', padding: '16px 16px 32px', display: 'flex', flexDirection: 'column', gap: 14 }}>
        {matchups.length === 0 ? (
          <div style={{ textAlign: 'center', color: 'var(--text-faint)', fontSize: 14, marginTop: 48 }}>No matchups found for this week.</div>
        ) : (
          matchups.map(([aId, bId]) => {
            const teamA = LEAGUE_TEAMS.find(t => t.id === aId);
            const teamB = LEAGUE_TEAMS.find(t => t.id === bId);
            const scoreA = computeTeamScore(aId);
            const scoreB = computeTeamScore(bId);
            const isMyMatch = aId === myTeamId || bId === myTeamId;
            const aWinning = scoreA >= scoreB;
            const diff = Math.abs(scoreA - scoreB);
            return (
              <div key={`${aId}-${bId}`} style={{
                background: 'var(--panel)',
                border: `1px solid ${isMyMatch ? 'rgba(198,255,58,.35)' : 'var(--border)'}`,
                borderRadius: 14, padding: '16px 18px',
                ...(isMyMatch ? { boxShadow: '0 0 0 1px rgba(198,255,58,.1)' } : {}),
              }}>
                <TeamRow team={teamA} teamId={aId} score={scoreA} winning={aWinning} />
                <div style={{ margin: '12px 0', display: 'flex', alignItems: 'center', gap: 10 }}>
                  <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
                  <span style={{ fontSize: 12, fontFamily: 'var(--font-mono)', fontWeight: 800, color: aWinning ? 'var(--good)' : 'var(--danger)', background: aWinning ? 'rgba(76,175,130,.12)' : 'rgba(255,90,110,.12)', border: `1px solid ${aWinning ? 'rgba(76,175,130,.3)' : 'rgba(255,90,110,.3)'}`, borderRadius: 6, padding: '2px 10px' }}>
                    {diff.toFixed(1)}
                  </span>
                  <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
                </div>
                <TeamRow team={teamB} teamId={bId} score={scoreB} winning={!aWinning} />
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

function MatchupCard({ homeId, awayId, week, season, isLive, isFinal, expanded, onToggle, onOpenPlayer, myTeamId, myLiveRoster, allTeamRosters, homeRecord, awayRecord }) {
  const home = findTeam(homeId);
  const away = findTeam(awayId);

  // Use assigned rosters (with proper starter slots) for all teams
  const homeRoster = homeId === myTeamId && myLiveRoster ? myLiveRoster : (allTeamRosters?.[homeId] || TEAM_ROSTERS[homeId] || []);
  const awayRoster = awayId === myTeamId && myLiveRoster ? myLiveRoster : (allTeamRosters?.[awayId] || TEAM_ROSTERS[awayId] || []);

  const homeProj  = computeScore(homeRoster);
  const awayProj  = computeScore(awayRoster);

  const locked = React.useMemo(() => loadLockedScores(season, week), [season, week]);
  const homeActual = locked ? getActualPtsFromLocked(locked, homeRoster) : null;
  const awayActual = locked ? getActualPtsFromLocked(locked, awayRoster) : null;

  const homeStarterProj = rosterGroupPts(homeRoster, 'STARTERS');
  const homeBenchProj   = rosterGroupPts(homeRoster, 'BENCH');
  const awayStarterProj = rosterGroupPts(awayRoster, 'STARTERS');
  const awayBenchProj   = rosterGroupPts(awayRoster, 'BENCH');

  const homePts = homeActual ?? homeProj;
  const awayPts = awayActual ?? awayProj;
  const homeWin      = homePts > awayPts;
  const awayWin      = awayPts > homePts;
  const homeRosterOk = isRosterValid(homeRoster);
  const awayRosterOk = isRosterValid(awayRoster);
  const hasActual    = homeActual !== null || awayActual !== null;
  const label        = isFinal ? (hasActual ? 'Final (Actual)' : 'Final') : isLive ? 'Live' : 'Upcoming';
  const labelColor   = isLive ? 'var(--accent)' : isFinal ? 'var(--text-dim)' : 'var(--text-faint)';
  const isMyMatchup  = homeId === myTeamId || awayId === myTeamId;

  return (
    <div className="card" style={{ overflow: 'hidden', borderLeft: isMyMatchup ? '3px solid #4caf82' : undefined, background: isMyMatchup ? 'rgba(76,175,130,.06)' : undefined }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 0, cursor: 'pointer' }} onClick={onToggle}>
        <TeamScore team={home} pts={homePts} projPts={homeActual !== null ? homeProj : null} win={homeWin} side="home" showPts={isLive || isFinal} isMe={homeId === myTeamId} rosterOk={homeRosterOk} record={homeRecord} hasActual={homeActual !== null} starterProj={homeStarterProj} benchProj={homeBenchProj} />
        <div style={{ flexShrink: 0, textAlign: 'center', padding: '0 14px', minWidth: 80 }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: labelColor, letterSpacing: '.08em', marginBottom: 4 }}>{label}</div>
          <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-faint)' }}>vs</div>
        </div>
        <TeamScore team={away} pts={awayPts} projPts={awayActual !== null ? awayProj : null} win={awayWin} side="away" showPts={isLive || isFinal} isMe={awayId === myTeamId} rosterOk={awayRosterOk} record={awayRecord} hasActual={awayActual !== null} starterProj={awayStarterProj} benchProj={awayBenchProj} />
        <div style={{ marginLeft: 'auto', paddingRight: 14, color: 'var(--text-faint)', fontSize: 12 }}>
          {expanded ? '▲' : '▼'}
        </div>
      </div>

      {/* Racing bar — always visible */}
      <WinProbabilityBar
        homeTeam={home}
        awayTeam={away}
        homeExpected={homeStarterProj}
        awayExpected={awayStarterProj}
      />

      {expanded && (
        <>
          <div style={{ borderTop: '1px solid var(--border)', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 0 }}>
            <RosterBreakdown roster={homeRoster} teamId={homeId} week={week} onOpenPlayer={onOpenPlayer} isProjected={!isLive && !isFinal} locked={locked} />
            <RosterBreakdown roster={awayRoster} teamId={awayId} week={week} onOpenPlayer={onOpenPlayer} side="away" isProjected={!isLive && !isFinal} locked={locked} />
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
function WinProbabilityBar({ homeTeam, awayTeam, homeExpected, awayExpected }) {
  const total    = (homeExpected + awayExpected) || 1;
  const homeProb = homeExpected / total;
  const homePct  = Math.round(homeProb * 100);
  const awayPct  = 100 - homePct;
  const isClose  = Math.abs(homePct - awayPct) <= 6;

  const GREEN = '#4ed87b';
  const RED   = '#ff5a6e';
  const TIE   = '#e0c84b';

  const homeC = isClose ? TIE : homePct > 50 ? GREEN : RED;
  const awayC = isClose ? TIE : awayPct > 50 ? GREEN : RED;

  return (
    <div style={{ padding: '10px 22px 14px', borderTop: '1px solid var(--border)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 5 }}>
        <span style={{ fontSize: 13, fontWeight: 800, fontFamily: 'var(--font-mono)', color: homeC }}>{homePct}%</span>
        <span style={{ fontSize: 9, fontFamily: 'var(--font-mono)', color: 'var(--text-faint)', letterSpacing: '.08em', textTransform: 'uppercase' }}>
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
          {homeTeam?.name} · <span style={{ color: homeC, fontWeight: 700 }}>{homeExpected.toFixed(1)}</span> proj
        </span>
        <span style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--text-faint)', textAlign: 'right' }}>
          {awayTeam?.name} · <span style={{ color: awayC, fontWeight: 700 }}>{awayExpected.toFixed(1)}</span> proj
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

function formatStatLine(p, lockedStats) {
  if (!p) return null;
  const s = lockedStats || {};
  const parts = [];
  if (s.passYds || p.pos === 'QB') {
    if (s.passYds) parts.push(`${s.passYds}y`);
    if (s.passTds) parts.push(`${s.passTds}td`);
    if (s.passInt) parts.push(`${s.passInt}int`);
    if (s.rushYds) parts.push(`${s.rushYds} rush`);
  } else if (p.pos === 'RB') {
    if (s.rushYds) parts.push(`${s.rushYds}y`);
    if (s.rushTds) parts.push(`${s.rushTds}td`);
    if (s.rec != null) parts.push(`${s.rec}rec`);
    if (s.recYds) parts.push(`+${s.recYds}y`);
  } else if (['WR', 'TE'].includes(p.pos)) {
    if (s.rec != null) parts.push(`${s.rec}rec`);
    if (s.recYds) parts.push(`${s.recYds}y`);
    if (s.recTds) parts.push(`${s.recTds}td`);
    if (s.targets) parts.push(`${s.targets}tgt`);
  } else if (p.pos === 'K' || p.pos === 'PK') {
    if (s.fgMade) parts.push(`${s.fgMade}fg`);
    if (s.xpMade) parts.push(`${s.xpMade}xp`);
  } else if (['DST', 'D/ST', 'DEF'].includes(p.pos)) {
    if (s.sacks) parts.push(`${s.sacks}sk`);
    if (s.ints) parts.push(`${s.ints}int`);
    if (s.ptsAllowed != null) parts.push(`${s.ptsAllowed}pa`);
  }
  if (parts.length === 0 && p.last) parts.push(`${p.last.toFixed(1)} last wk`);
  return parts.length > 0 ? parts.join(' · ') : null;
}

function RosterBreakdown({ roster, teamId, week, onOpenPlayer, side, isProjected, locked }) {
  const starters = roster.filter(r => r.slot !== 'BENCH');
  const bench    = roster.filter(r => r.slot === 'BENCH');
  const isRight  = side === 'away';

  function getLockedEntry(p) {
    if (!p || !locked?.players) return null;
    return locked.players.find(x => x.name?.toLowerCase().trim() === p.name?.toLowerCase().trim()) || null;
  }

  const totalProj = starters.reduce((s, e) => s + playerProjPts(e.playerId ? findPlayer(e.playerId) : null), 0);
  const lockedEntries = starters.map(e => getLockedEntry(e.playerId ? findPlayer(e.playerId) : null));
  const hasActual = locked && lockedEntries.some(v => v !== null);
  const totalActual = hasActual ? lockedEntries.reduce((s, v) => s + (v?.pts ?? 0), 0) : null;
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
        const proj = playerProjPts(p);
        const lockedEntry = p ? getLockedEntry(p) : null;
        const actual = lockedEntry ? lockedEntry.pts : null;
        const statLine = formatStatLine(p, lockedEntry?.stats || null);
        const dispScore = actual ?? proj;
        const actColor = actual != null ? (dispScore >= 20 ? 'var(--accent)' : dispScore >= 10 ? '#4ea8ff' : 'var(--text)') : 'var(--text-faint)';
        let mover = '';
        if (actual != null && proj > 0) {
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
                  {statLine && (
                    <div style={{ fontSize: 9, color: 'var(--text-faint)', fontFamily: 'var(--font-mono)', marginTop: 2, paddingLeft: 22, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{statLine}</div>
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

