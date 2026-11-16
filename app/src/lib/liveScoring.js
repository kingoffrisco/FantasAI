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
  return { passYd: 0.04, passTD: 4, passInt: -2, rushYd: 0.1, rushTD: 6, recYd: 0.1, recTD: 6, rec: 0.5, fumbleLost: -2, kFg50: 4, kFgUnder50: 3, kFgMiss: -1, kXp: 1, kXpMiss: -1 };
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

// Same formula as calcFantasyPts, but returns each contributing stat's raw
// amount and the points it produced, instead of just the total — for UIs
// that want to show "why" a player scored what they scored (e.g. Head to
// Head's Player Scores tab), not just the final number.
// [[min, max, pts], ...] inclusive; first match wins, else 0.
function tierPts(value, tiers) {
  const v = Number(value);
  for (const [lo, hi, p] of tiers || []) if (v >= lo && v <= hi) return Number(p);
  return 0;
}
// [[threshold, pts], ...] cumulative — CBS's "2 pt bonus @ 100+, 2 more @ 200+…"
function milestonePts(value, bonuses) {
  const v = Number(value || 0);
  return (bonuses || []).reduce((sum, [t, p]) => sum + (v >= t ? Number(p) : 0), 0);
}

// Same formula as calcFantasyPts, but returns each contributing stat's raw
// amount and the points it produced. MUST stay identical to
// local_processing/job_live_scores.py's calc_fantasy_pts — that job writes
// the stats (incl. fgDists/fgMissDists, long-TD and 2-pt counts, DST
// blocks) that this scores.
export function buildStatPointsBreakdown(stats, rules, pos) {
  const s = stats || {};
  const r = rules || {};
  const fgMissed = Math.max(0, (s.fgAtt ?? 0) - (s.fgMade ?? 0));
  const xpMissed = Math.max(0, (s.xpAtt ?? 0) - (s.xpMade ?? 0));

  // DST scoring is gated on pos === 'DST': sacks/ints/ptsAllowed also sit on
  // individual players' lines and must never score for a K/defender
  // (confirmed live: a kicker was picking up +4 from his team's PA tier).
  if (pos === 'DST') {
    const rows = [
      { label: 'Sacks',       amount: s.sacks,    pts: (s.sacks ?? 0) * (r.dstSack ?? 1) },
      { label: 'Int',         amount: s.ints,     pts: (s.ints ?? 0) * (r.dstInt ?? 2) },
      { label: 'Fum Rec',     amount: s.fumRec,   pts: (s.fumRec ?? 0) * (r.dstFumRec ?? 2) },
      { label: 'Safety',      amount: s.safeties, pts: (s.safeties ?? 0) * (r.dstSafety ?? 2) },
      { label: 'Def/ST TD',   amount: s.tds,      pts: (s.tds ?? 0) * (r.dstTd ?? 6) },
      { label: 'Blocked FG',  amount: s.blkFg,    pts: (s.blkFg ?? 0) * (r.dstBlkFg ?? 0) },
      { label: 'Blocked Punt',amount: s.blkPunt,  pts: (s.blkPunt ?? 0) * (r.dstBlkPunt ?? 0) },
      { label: 'Blocked XP',  amount: s.blkXp,    pts: (s.blkXp ?? 0) * (r.dstBlkXp ?? 0) },
    ];
    if ((r.dstPtsAllowed ?? true) && s.ptsAllowed != null) {
      rows.push({ label: 'Pts Allowed', amount: s.ptsAllowed, always: true,
        pts: r.dstPaTiers ? tierPts(s.ptsAllowed, r.dstPaTiers) : dstPtsAllowedBonus(s.ptsAllowed) });
    }
    return rows.filter(x => x.always || (x.amount ?? 0) !== 0)
      .map(x => ({ label: x.label, amount: x.amount ?? 0, unit: '', pts: x.pts }));
  }

  // Kicking — per-distance tiers when distances are known, flat legacy
  // values for any kick that couldn't be placed.
  const fgDists = s.fgDists || [];
  const missDists = s.fgMissDists || [];
  let fgPts, missPts;
  if (r.fgTiers && fgDists.length) {
    fgPts = fgDists.reduce((a, d) => a + tierPts(d, r.fgTiers), 0)
      + Math.max(0, (s.fgMade ?? 0) - fgDists.length) * (r.kFgUnder50 ?? 3);
  } else {
    const fg50 = s.fgMade50 ?? 0;
    fgPts = fg50 * (r.kFg50 ?? 4) + Math.max(0, (s.fgMade ?? 0) - fg50) * (r.kFgUnder50 ?? 3);
  }
  if (r.fgMissTiers && missDists.length) {
    missPts = missDists.reduce((a, d) => a + tierPts(d, r.fgMissTiers), 0)
      + Math.max(0, fgMissed - missDists.length) * (r.kFgMiss ?? -1);
  } else {
    missPts = fgMissed * (r.kFgMiss ?? -1);
  }

  // CBS: "0+ Yds = x per yard" — net-negative yardage scores 0, not negative.
  const pos0 = v => Math.max(0, v ?? 0);
  const rows = [
    { label: 'Pass Yds',  amount: s.passYds, unit: 'yd', pts: pos0(s.passYds) * (r.passYd ?? 0.04) },
    { label: 'Pass Yd Bonus', amount: s.passYds, unit: 'yd', pts: milestonePts(s.passYds, r.passYdBonus), bonus: true },
    { label: 'Pass TD',   amount: s.passTds, pts: (s.passTds ?? 0) * (r.passTD ?? 4) },
    { label: 'Pass TD 50+', amount: s.passTd50, pts: (s.passTd50 ?? 0) * (r.passTdLongBonus ?? 0) },
    { label: 'Pass 2-Pt', amount: s.pass2pt, pts: (s.pass2pt ?? 0) * (r.pass2pt ?? 0) },
    { label: 'Int',       amount: s.passInt, pts: (s.passInt ?? 0) * (r.passInt ?? -2) },
    { label: 'Rush Yds',  amount: s.rushYds, unit: 'yd', pts: pos0(s.rushYds) * (r.rushYd ?? 0.1) },
    { label: 'Rush Yd Bonus', amount: s.rushYds, unit: 'yd', pts: milestonePts(s.rushYds, r.rushYdBonus), bonus: true },
    { label: 'Rush TD',   amount: s.rushTds, pts: (s.rushTds ?? 0) * (r.rushTD ?? 6) },
    { label: 'Rush TD 40+', amount: s.rushTd40, pts: (s.rushTd40 ?? 0) * (r.rushTdLongBonus ?? 0) },
    { label: 'Rush 2-Pt', amount: s.rush2pt, pts: (s.rush2pt ?? 0) * (r.rush2pt ?? 0) },
    { label: 'Rec Yds',   amount: s.recYds,  unit: 'yd', pts: pos0(s.recYds) * (r.recYd ?? 0.1) },
    { label: 'Rec Yd Bonus', amount: s.recYds, unit: 'yd', pts: milestonePts(s.recYds, r.recYdBonus), bonus: true },
    { label: 'Rec TD',    amount: s.recTds,  pts: (s.recTds ?? 0) * (r.recTD ?? 6) },
    { label: 'Rec TD 50+', amount: s.recTd50, pts: (s.recTd50 ?? 0) * (r.recTdLongBonus ?? 0) },
    { label: 'Rec 2-Pt',  amount: s.rec2pt,  pts: (s.rec2pt ?? 0) * (r.rec2pt ?? 0) },
    { label: 'Rec',       amount: s.rec,     pts: (s.rec ?? 0) * (r.rec ?? 0.5) },
    { label: 'Fum Lost',  amount: s.fumLost, pts: (s.fumLost ?? 0) * (r.fumbleLost ?? -2) },
    { label: 'FG Made',   amount: s.fgMade,  pts: fgPts },
    { label: 'FG Miss',   amount: fgMissed,  pts: missPts },
    { label: 'XP Made',   amount: s.xpMade,  pts: (s.xpMade ?? 0) * (r.kXp ?? 1) },
    { label: 'XP Miss',   amount: xpMissed,  pts: xpMissed * (r.kXpMiss ?? -1) },
  ];
  // Bonus-type rows (milestones, long TDs, 2-pt) only when they scored;
  // plain stat rows whenever the player has that stat (even at 0 pts, e.g.
  // receptions in a non-PPR league, so the line still explains itself).
  const isBonus = x => x.bonus || /2-Pt|TD \d/.test(x.label);
  return rows
    .filter(x => isBonus(x) ? x.pts !== 0 : ((x.amount ?? 0) !== 0 || x.pts !== 0))
    .map(x => ({ label: x.label, amount: x.amount ?? 0, unit: x.unit || '', pts: x.pts }));
}

// Same live data Head-to-Head uses (R2 cache written by job_live_scores.py),
// in the same shapes: statusByTeam keyed by ESPN team abbr, ptsByName keyed
// by lowercased name. Lets other views (the sidebar matchup card) show the
// SAME win probability as H2H instead of a projections-only guess.
export async function fetchLiveWeek(week, season = 2026, type = 'regular') {
  let base = 'https://api.fantasai.net';
  try { base = (localStorage.getItem('fantasai.workerUrl') || base).replace(/\/$/, ''); } catch {}
  const [board, stats] = await Promise.all([
    fetch(`${base}/api/v1/nfl/scoreboard?week=${week}&season=${season}&type=${type}`).then(r => r.json()),
    fetch(`${base}/api/v1/nfl/player-stats?week=${week}&season=${season}&type=${type}`).then(r => r.json()),
  ]);
  const statusByTeam = {};
  for (const g of board?.games || []) {
    if (g.home?.abbr) statusByTeam[g.home.abbr] = { ...g.status, kickoff: g.date, opp: g.away?.abbr || null };
    if (g.away?.abbr) statusByTeam[g.away.abbr] = { ...g.status, kickoff: g.date, opp: g.home?.abbr || null, isAway: true };
  }
  const rules = getScoringRules();
  const ptsByName = {};
  for (const p of stats?.players || []) {
    const key = (p.name || '').toLowerCase().trim();
    if (key) ptsByName[key] = { name: p.name, pos: p.pos, team: p.team, pts: p.pts ?? calcFantasyPts(p.stats, rules, p.pos), stats: p.stats };
  }
  return { statusByTeam, ptsByName, anyLive: Object.values(statusByTeam).some(s => s.state === 'in') };
}

export function calcFantasyPts(stats, rules, pos) {
  const total = buildStatPointsBreakdown(stats, rules, pos).reduce((a, x) => a + x.pts, 0);
  return Math.max(0, Math.round(total * 100) / 100);
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
