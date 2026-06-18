import { LEAGUE_TEAMS, TEAM_ROSTERS, buildRosterFrame, assignRoster } from './data.js';
import { findPlayer } from './playerStore.js';

const SEASON_START = new Date('2026-09-09');

export function getPowerWeek() {
  const today = new Date();
  if (today < SEASON_START) return 0;
  return Math.min(Math.floor((today - SEASON_START) / (7 * 86400000)) + 1, 14);
}

export function buildPowerSchedule(ids, weeks) {
  const n = ids.length;
  return Array.from({ length: weeks }, (_, w) => {
    const rest   = ids.slice(1);
    const rot    = w % (n - 1);
    const circle = [ids[0], ...[...rest.slice(rot), ...rest.slice(0, rot)]];
    return Array.from({ length: n / 2 }, (_, i) => [circle[i], circle[n - 1 - i]]);
  });
}

export function simScore(teamId, week) {
  const roster   = TEAM_ROSTERS[teamId] || [];
  const starters = roster.filter(r => r.slot !== 'BENCH' && r.playerId);
  const base = starters.reduce((s, e) => {
    const p = findPlayer(e.playerId);
    return s + (p ? (p.avg || p.proj || 0) : 0);
  }, 0);
  const noise = (Math.sin(teamId * 11.3 + week * 7.1) * 12) + (Math.cos(teamId * 3.7 + week * 2.9) * 6);
  return Math.max(0, Math.round((base + noise) * 10) / 10);
}

export function buildPowerData(currentWeek, rosterOverrides = {}, slotOverridesByTeam = {}) {
  const ids         = LEAGUE_TEAMS.map(t => t.id);
  const schedule    = buildPowerSchedule(ids, 14);
  const weeksPlayed = Math.max(0, currentWeek - 1);
  const leagueSettings = (() => { try { return JSON.parse(localStorage.getItem('fantasai_league_settings') || 'null'); } catch { return null; } })();
  const rosterFrame = buildRosterFrame(leagueSettings);

  return LEAGUE_TEAMS.map(team => {
    const playerIdSet    = rosterOverrides[team.id]
      ?? new Set((TEAM_ROSTERS[team.id] || []).filter(r => r.playerId).map(r => r.playerId));
    const teamSlotOv     = slotOverridesByTeam[team.id] ?? {};
    const rosterEntries  = assignRoster(rosterFrame, playerIdSet, teamSlotOv, findPlayer);
    const projPts = rosterEntries.reduce((s, e) => {
      const p = e.playerId ? findPlayer(e.playerId) : null;
      return s + (p ? (p.proj || 0) : 0);
    }, 0);

    let wins = 0, losses = 0, totalPts = 0, weeklyPts = [];
    for (let w = 0; w < weeksPlayed; w++) {
      const matchup = schedule[w]?.find(([a, b]) => a === team.id || b === team.id);
      if (!matchup) continue;
      const oppId  = matchup[0] === team.id ? matchup[1] : matchup[0];
      const myPts  = simScore(team.id, w + 1);
      const oppPts = simScore(oppId, w + 1);
      weeklyPts.push(myPts);
      totalPts += myPts;
      if (myPts > oppPts) wins++; else losses++;
    }

    const avgActual = weeklyPts.length ? totalPts / weeklyPts.length : 0;
    const best      = weeklyPts.length ? Math.max(...weeklyPts) : 0;
    const worst     = weeklyPts.length ? Math.min(...weeklyPts) : 0;

    const weekResults = weeklyPts.map((pts, wi) => {
      const m = schedule[wi]?.find(([a, b]) => a === team.id || b === team.id);
      if (!m) return null;
      const oppId = m[0] === team.id ? m[1] : m[0];
      return pts > simScore(oppId, wi + 1);
    }).filter(r => r !== null);

    const streak = (() => {
      if (!weekResults.length) return { type: '—', count: 0 };
      const won = weekResults[weekResults.length - 1];
      let count = 1;
      for (let i = weekResults.length - 2; i >= 0; i--) {
        if (weekResults[i] === won) count++; else break;
      }
      return { type: won ? 'W' : 'L', count };
    })();

    const winPct = (wins + losses) > 0 ? wins / (wins + losses) : 0;
    const power  = Math.round((projPts * 0.4 + avgActual * 0.35 + winPct * 60) * 10) / 10;

    return {
      team,
      wins, losses,
      totalPts:  Math.round(totalPts  * 10) / 10,
      avgActual: Math.round(avgActual * 10) / 10,
      projPts:   Math.round(projPts   * 10) / 10,
      best:      Math.round(best      * 10) / 10,
      worst:     Math.round(worst     * 10) / 10,
      streak, power, weeklyPts,
      playerCount: playerIdSet.size,
    };
  }).sort((a, b) => b.power - a.power);
}
