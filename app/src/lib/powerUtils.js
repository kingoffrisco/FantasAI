import React from 'react';
import { LEAGUE_TEAMS, TEAM_ROSTERS, buildRosterFrame, assignRoster } from './data.js';
import { findPlayer } from './playerStore.js';
import { api } from '../api.js';

const SEASON_START = new Date('2026-09-09');

export function getPowerWeek() {
  const today = new Date();
  if (today < SEASON_START) return 0;
  return Math.min(Math.floor((today - SEASON_START) / (7 * 86400000)) + 1, 14);
}

// ── Real season results from CBS ──────────────────────────────────────────────
// /api/cbs/schedule returns { schedule: { [cbsTeamId]: [{ week, oppId, away,
// result: 'W'|'L'|'T'|null, inProgress, pts, oppPts }] } }. Convert it to app
// team ids so screens can join it with LEAGUE_TEAMS.
export function buildSeasonFromCbs(resp) {
  const raw = resp?.schedule;
  if (!raw || typeof raw !== 'object') return null;
  const byCbs = new Map(LEAGUE_TEAMS.map(t => [String(t.cbsId), t.id]));
  const season = new Map();
  for (const [cbsId, weeks] of Object.entries(raw)) {
    const teamId = byCbs.get(String(cbsId));
    if (teamId == null || !Array.isArray(weeks)) continue;
    season.set(teamId, weeks.map(w => ({
      week:       w.week,
      opp:        w.oppId != null ? byCbs.get(String(w.oppId)) ?? null : null,
      away:       !!w.away,
      result:     w.result || null,
      inProgress: !!w.inProgress,
      pts:        w.pts,
      oppPts:     w.oppPts,
    })).sort((a, b) => a.week - b.week));
  }
  return season.size ? season : null;
}

// Remaining matchups as { [week]: [[teamIdA, teamIdB], ...] } for weeks with no
// final result yet — the shape the dashboard's playoff simulation expects.
export function remainingMatchups(season) {
  if (!season) return {};
  const out = {};
  const seen = new Set();
  for (const [teamId, weeks] of season) {
    for (const w of weeks) {
      if (w.result || w.opp == null) continue;
      const key = `${w.week}:${Math.min(teamId, w.opp)}:${Math.max(teamId, w.opp)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      (out[w.week] ||= []).push([teamId, w.opp]);
    }
  }
  return out;
}

// One shared fetch for every screen that needs results (5-minute reuse).
let seasonCache = { at: 0, promise: null };
function fetchSeason() {
  if (!seasonCache.promise || Date.now() - seasonCache.at > 5 * 60 * 1000) {
    seasonCache = {
      at: Date.now(),
      promise: api.schedule().then(buildSeasonFromCbs).catch(() => {
        seasonCache.at = 0; // retry on next mount
        return null;
      }),
    };
  }
  return seasonCache.promise;
}

// undefined = loading, null = unavailable, Map = loaded
export function useCbsSeason() {
  const [season, setSeason] = React.useState(undefined);
  React.useEffect(() => {
    let alive = true;
    fetchSeason().then(s => { if (alive) setSeason(s); });
    return () => { alive = false; };
  }, []);
  return season;
}

// Summarise one team's completed games.
export function summarizeTeamSeason(weeks = []) {
  const done = weeks.filter(w => w.result && w.pts != null);
  const wins   = done.filter(w => w.result === 'W').length;
  const losses = done.filter(w => w.result === 'L').length;
  const ties   = done.filter(w => w.result === 'T').length;
  const weeklyPts = done.map(w => w.pts);
  const totalPts  = weeklyPts.reduce((s, p) => s + p, 0);
  const streak = (() => {
    if (!done.length) return { type: '—', count: 0 };
    const last = done[done.length - 1].result;
    let count = 0;
    for (let i = done.length - 1; i >= 0 && done[i].result === last; i--) count++;
    return { type: last, count };
  })();
  return {
    done, wins, losses, ties, weeklyPts, totalPts, streak,
    avg:   done.length ? totalPts / done.length : 0,
    best:  done.length ? Math.max(...weeklyPts) : 0,
    worst: done.length ? Math.min(...weeklyPts) : 0,
  };
}

const r1 = n => Math.round(n * 10) / 10;

// season: Map from useCbsSeason(). Without it, teams show no games played
// rather than invented results.
export function buildPowerData(currentWeek, rosterOverrides = {}, slotOverridesByTeam = {}, season = null) {
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

    const s = summarizeTeamSeason(season?.get(team.id));
    const games  = s.wins + s.losses + s.ties;
    const winPct = games > 0 ? (s.wins + s.ties / 2) / games : 0;
    // Projection carries the ranking pre-season; real results take over as
    // games are played (60 points of weight for win %, 0.35 per avg point).
    const power  = r1(projPts * 0.4 + s.avg * 0.35 + winPct * 60);

    return {
      team,
      wins: s.wins, losses: s.losses, ties: s.ties,
      totalPts:  r1(s.totalPts),
      avgActual: r1(s.avg),
      projPts:   r1(projPts),
      best:      r1(s.best),
      worst:     r1(s.worst),
      streak: s.streak, power, weeklyPts: s.weeklyPts,
      weeks: season?.get(team.id) || [],
      playerCount: playerIdSet.size,
    };
  }).sort((a, b) => b.power - a.power);
}
