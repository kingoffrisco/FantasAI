// Live scoring helpers for Head-to-Head — converts raw per-player stats from
// the Worker's /api/v1/nfl/player-stats endpoint into fantasy points using
// the league's actual "Rules & Settings > Scoring" config, and blends
// actual-so-far with a pace-adjusted remaining-game projection.
//
// Field names here match the Worker's handleNflPlayerStats response shape
// (passYds, passTds, rec, fgMade50, ...) — NOT Dashboard.jsx's own
// client-side ESPN box-score parser, which uses different field names
// (passYards, passTDs, receptions, ...) for the same concepts.

export function getScoringRules() {
  try {
    const s = JSON.parse(localStorage.getItem('fantasai_league_settings') || 'null');
    if (s?.scoring) return s.scoring;
  } catch {}
  return { passYd: 0.04, passTD: 4, passInt: -2, rushYd: 0.1, rushTD: 6, recYd: 0.1, recTD: 6, rec: 0.5, fumbleLost: -2, kFg50: 5, kFgUnder50: 3, kFgMiss: -1 };
}

// Standard points-allowed tier table — same values as ScoringTest.jsx's
// applyScoring() DST branch (the app's one other place DST gets scored).
function dstPtsAllowedBonus(ptsAllowed) {
  const pa = Number(ptsAllowed);
  if (pa === 0) return 10;
  if (pa <= 6) return 7;
  if (pa <= 13) return 4;
  if (pa <= 20) return 1;
  if (pa <= 27) return 0;
  if (pa <= 34) return -1;
  return -4;
}

export function calcFantasyPts(stats, rules, pos) {
  const s = stats || {};
  const r = rules || {};
  const fgMade50 = s.fgMade50 ?? 0;
  const fgMadeUnder50 = Math.max(0, (s.fgMade ?? 0) - fgMade50);
  const fgMissed = Math.max(0, (s.fgAtt ?? 0) - (s.fgMade ?? 0));
  // DST scoring must be gated on pos === 'DST' explicitly, not just on these
  // fields being present. sacks/ints/fumRec/tds/safeties also live on
  // INDIVIDUAL defensive players' own stat lines, and ptsAllowed is tagged
  // onto every player on a team regardless of position — without this gate
  // a kicker or defender would silently pick up bonus points that belong
  // only to the team DST entry (confirmed live: a kicker was scoring +4
  // bogus points from his team's points-allowed tier before this fix).
  const isDst = pos === 'DST';
  return Math.max(0,
    (s.passYds ?? 0) * (r.passYd ?? 0.04) +
    (s.passTds ?? 0) * (r.passTD ?? 4) +
    (s.passInt ?? 0) * (r.passInt ?? -2) +
    (s.rushYds ?? 0) * (r.rushYd ?? 0.1) +
    (s.rushTds ?? 0) * (r.rushTD ?? 6) +
    (s.recYds  ?? 0) * (r.recYd  ?? 0.1) +
    (s.recTds  ?? 0) * (r.recTD  ?? 6) +
    (s.rec     ?? 0) * (r.rec    ?? 0.5) +
    (s.fumLost ?? 0) * (r.fumbleLost ?? -2) +
    fgMade50 * (r.kFg50 ?? 5) +
    fgMadeUnder50 * (r.kFgUnder50 ?? 3) +
    fgMissed * (r.kFgMiss ?? -1) +
    // DST — bug fixed 2026-08-22: this whole block was missing, so team
    // defense entries always scored 0 even when their stats were present.
    // Same rule keys/tiers as ScoringTest.jsx's applyScoring().
    (isDst ? (s.sacks ?? 0) * (r.dstSack ?? 1) : 0) +
    (isDst ? (s.ints ?? 0) * (r.dstInt ?? 2) : 0) +
    (isDst ? (s.fumRec ?? 0) * (r.dstFumRec ?? 2) : 0) +
    (isDst ? (s.safeties ?? 0) * (r.dstSafety ?? 2) : 0) +
    (isDst ? (s.tds ?? 0) * (r.dstTd ?? 6) : 0) +
    (isDst && (r.dstPtsAllowed ?? true) && s.ptsAllowed != null ? dstPtsAllowedBonus(s.ptsAllowed) : 0)
  );
}

// ESPN's site API returns some team abbreviations that differ from this
// app's convention (playerStore.js's BYE_WEEKS_2026 etc. use WAS; ESPN
// returns WSH). Without this, live lookups for that team silently return
// nothing and fall back to projection with no error — already happening
// today in Dashboard.jsx's live scoring. Maps FROM this app's convention
// TO ESPN's, for use when indexing into ESPN-sourced data by a roster
// player's p.team.
const TEAM_ABBR_ALIASES = { WAS: 'WSH' };

export function normalizeTeamAbbr(abbr) {
  const t = (abbr || '').toUpperCase();
  return TEAM_ABBR_ALIASES[t] || t;
}

// gameStatus shape: { state: 'pre'|'in'|'post', completed, clock, period }
// — matches worker-api's /api/v1/nfl/scoreboard normalizeGame() output.
export function getGameProgress(gameStatus) {
  if (!gameStatus || gameStatus.state === 'pre') return 0;
  if (gameStatus.state === 'post' || gameStatus.completed) return 1;
  const parts = (gameStatus.clock || '15:00').split(':');
  const timeLeft = parseInt(parts[0] || '15', 10) * 60 + parseInt(parts[1] || '0', 10);
  const qSecs = 15 * 60;
  const done = Math.max(0, (gameStatus.period || 1) - 1) * qSecs + Math.max(0, qSecs - timeLeft);
  return Math.min(0.99, done / (4 * qSecs));
}

// actualSoFar defaults to 0 (not "no data") — a rostered player with no
// live stats yet, in a game that has started, has genuinely scored 0 so far.
export function blendProjectedFinal(actualSoFar, preGameProj, progress) {
  const actual = actualSoFar ?? 0;
  const proj = preGameProj ?? 0;
  if (progress >= 1) return actual;
  return actual + proj * (1 - progress);
}

// -- Browser-direct ESPN fallback ------------------------------------------
//
// Display-only, never written anywhere (no R2 write-back — that would need
// shipping the R2 write key to every browser). Used only when the Worker's
// R2 cache (populated by local_processing/job_live_scores.py) has no data
// yet for the requested week/season/type. CORS for this exact ESPN host is
// already proven to work from the browser — Dashboard.jsx/CurrentRoster.jsx/
// Players.jsx already call it directly.
//
// This is a THIRD copy of the same ESPN box-score parsing logic (the other
// two: worker-api/src/index.js's normalizeGame/handleNflPlayerStats, and
// local_processing/job_live_scores.py's Python port) — unavoidable given
// three different runtimes, but keep all three in sync if ESPN's response
// shape ever changes.

const ESPN_DIRECT_BASE = 'https://site.api.espn.com/apis/site/v2/sports/football/nfl';

function espnSeasonTypeCode(type) {
  return type === 'pre' ? 1 : type === 'post' ? 3 : 2;
}

// ESPN's own week.number for preseason counts the Hall of Fame Game as
// "week 1", shifting everything else by one relative to how everyone
// actually refers to preseason weeks (confirmed 2026-08-20: ESPN tags the
// real Aug 20-26 "Pre Week 2" slate as week.number=3). Regular season has
// no such offset. Same correction as local_processing/job_live_scores.py's
// to_espn_week() — keep both in sync.
function toEspnWeek(week, type) {
  return type === 'pre' ? week + 1 : week;
}

function normalizeEspnEvent(event) {
  const comp = (event.competitions || [])[0] || {};
  const competitors = comp.competitors || [];
  const teamInfo = side => {
    const c = competitors.find(x => x.homeAway === side);
    if (!c) return null;
    return { abbr: c.team?.abbreviation, score: c.score ?? null };
  };
  const statusType = (event.status || {}).type || {};
  return {
    id: event.id,
    date: event.date,
    home: teamInfo('home'),
    away: teamInfo('away'),
    status: {
      state: statusType.state || 'pre',
      completed: statusType.completed || false,
      clock: event.status?.displayClock ?? null,
      period: event.status?.period ?? null,
    },
  };
}

export async function fetchEspnScoreboardDirect(week, season, type) {
  const espnWeek = toEspnWeek(week, type);
  const res = await fetch(`${ESPN_DIRECT_BASE}/scoreboard?seasontype=${espnSeasonTypeCode(type)}&week=${espnWeek}&season=${season}`);
  if (!res.ok) throw new Error(`ESPN scoreboard ${res.status}`);
  const data = await res.json();
  const seasonFloor = new Date(`${season}-07-01`);
  const seasonCeil = new Date(`${season + 1}-03-01`);
  return (data.events || [])
    .map(normalizeEspnEvent)
    .filter(g => g.date && new Date(g.date) >= seasonFloor && new Date(g.date) < seasonCeil);
}

export async function fetchEspnPlayerStatsDirect(games) {
  const targets = games.slice(0, 16);
  const results = await Promise.allSettled(
    targets.map(g => fetch(`${ESPN_DIRECT_BASE}/summary?event=${g.id}`).then(r => r.json()))
  );

  const playerMap = {};
  const posNorm = { HB: 'RB', FB: 'RB', WB: 'RB', FL: 'WR', SE: 'WR', SWR: 'WR', 'D/ST': 'DST', DEF: 'DST', PK: 'K' };

  results.forEach((result, i) => {
    if (result.status !== 'fulfilled') return;
    const boxscore = result.value.boxscore || {};
    const game = targets[i];
    const teamScores = {};
    if (game?.home?.abbr) teamScores[game.home.abbr] = Number(game.home.score) || 0;
    if (game?.away?.abbr) teamScores[game.away.abbr] = Number(game.away.score) || 0;

    for (const teamData of (boxscore.players || [])) {
      const teamAbbr = teamData.team?.abbreviation || '';
      const opponentAbbr = Object.keys(teamScores).find(k => k !== teamAbbr);
      const ptsAllowed = opponentAbbr != null ? teamScores[opponentAbbr] : null;

      for (const statGroup of (teamData.statistics || [])) {
        const name = statGroup.name;
        const keys = statGroup.keys || [];
        const sv = (arr, key) => {
          const idx = keys.indexOf(key);
          if (idx < 0) return 0;
          const v = arr[idx];
          return v && v !== '--' ? parseFloat(v) || 0 : 0;
        };
        const svFirst = (arr, ...cands) => {
          for (const k of cands) {
            const idx = keys.indexOf(k);
            if (idx >= 0) { const v = arr[idx]; return v && v !== '--' ? parseFloat(v) || 0 : 0; }
          }
          return 0;
        };
        const splitSlash = (arr, key) => {
          const idx = keys.indexOf(key);
          const v = idx >= 0 ? (arr[idx] || '') : '';
          const parts = v.split('/');
          return { a: parseFloat(parts[0]) || 0, b: parseFloat(parts[1]) || 0 };
        };

        for (const athleteEntry of (statGroup.athletes || [])) {
          const athlete = athleteEntry.athlete || {};
          const statsArr = athleteEntry.stats || [];
          const pid = athlete.id;
          if (!pid) continue;
          if (!playerMap[pid]) {
            playerMap[pid] = {
              id: pid, name: athlete.displayName || '',
              pos: athlete.position?.abbreviation || '', team: teamAbbr, stats: {},
            };
          }
          const s = playerMap[pid].stats;

          if (name === 'passing') {
            // ESPN's key for this varies by game — seen both
            // 'completionsAttempts' and 'completions/passingAttempts'
            // (confirmed 2026-08-20 against a real box score).
            const caKey = keys.includes('completions/passingAttempts') ? 'completions/passingAttempts' : 'completionsAttempts';
            const ca = splitSlash(statsArr, caKey);
            s.passComp = (s.passComp || 0) + ca.a;
            s.passAtt = (s.passAtt || 0) + ca.b;
            s.passYds = (s.passYds || 0) + sv(statsArr, 'passingYards');
            s.passTds = (s.passTds || 0) + sv(statsArr, 'passingTouchdowns');
            s.passInt = (s.passInt || 0) + sv(statsArr, 'interceptions');
          } else if (name === 'rushing') {
            s.rushYds = (s.rushYds || 0) + sv(statsArr, 'rushingYards');
            s.rushTds = (s.rushTds || 0) + sv(statsArr, 'rushingTouchdowns');
          } else if (name === 'receiving') {
            s.rec = (s.rec || 0) + sv(statsArr, 'receptions');
            s.recYds = (s.recYds || 0) + sv(statsArr, 'receivingYards');
            s.recTds = (s.recTds || 0) + sv(statsArr, 'receivingTouchdowns');
          } else if (name === 'kicking') {
            const fg = splitSlash(statsArr, 'fieldGoalsMadeFieldGoalsAttempted');
            s.fgMade = (s.fgMade || 0) + fg.a;
            s.fgAtt = (s.fgAtt || 0) + fg.b;
            s.fgMade50 = (s.fgMade50 || 0) + svFirst(statsArr, 'fieldGoalsMade50Plus', 'fieldGoals50PlusMade', 'fg50');
            if (!playerMap[pid].pos) playerMap[pid].pos = 'K';
          } else if (name === 'defensive') {
            s.sacks = (s.sacks || 0) + sv(statsArr, 'sacks');
            s.ints = (s.ints || 0) + sv(statsArr, 'interceptions');
            s.fumRec = (s.fumRec || 0) + sv(statsArr, 'fumbleRecoveries');
            s.tds = (s.tds || 0) + sv(statsArr, 'defensiveTouchdowns');
            s.safeties = (s.safeties || 0) + sv(statsArr, 'safeties');
          } else if (name === 'fumbles') {
            s.fumLost = (s.fumLost || 0) + svFirst(statsArr, 'fumblesLost', 'lost');
          }
          if (ptsAllowed != null) s.ptsAllowed = ptsAllowed;
        }
      }
    }
  });

  return Object.values(playerMap)
    .map(p => ({ ...p, pos: posNorm[p.pos] || p.pos }))
    .filter(p => {
      const s = p.stats;
      return (s.passYds || s.rushYds || s.recYds || s.rec || s.fgMade || s.fgAtt || s.sacks || s.ints || s.tds) > 0
        || (s.xpMade || 0) > 0;
    });
}
