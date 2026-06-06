// Direct Sleeper API client — no auth required, CORS-open.
// Module-level caches deduplicate the large per-week payloads when multiple
// players are fetched concurrently.

const SLEEPER = 'https://api.sleeper.app/v1';

// ── Player map (~5 MB) — loaded once per session ────────────────────────────
let _playerMap = null;
let _playerMapPromise = null;

export async function getPlayerMap() {
  if (_playerMap) return _playerMap;
  if (!_playerMapPromise) {
    _playerMapPromise = fetch(`${SLEEPER}/players/nfl`)
      .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
      .then(d => { _playerMap = d; return d; })
      .catch(e => { _playerMapPromise = null; throw e; });
  }
  return _playerMapPromise;
}

// ── Per-week stats/projections — shared across concurrent calls ─────────────
const _cache = {};
const _pending = {};

async function fetchCached(url, key) {
  if (_cache[key] !== undefined) return _cache[key];
  if (!_pending[key]) {
    _pending[key] = fetch(url)
      .then(r => r.ok ? r.json() : null)
      .then(d => { _cache[key] = d; return d; })
      .catch(() => { _cache[key] = null; return null; });
  }
  return _pending[key];
}

// ── Name search ─────────────────────────────────────────────────────────────
function findInMap(map, name, pos) {
  const q = name.toLowerCase().trim();
  // Exact full-name match, position-filtered first
  for (const [id, p] of Object.entries(map)) {
    const full = (p.full_name || `${p.first_name} ${p.last_name}`).trim().toLowerCase();
    if (full === q && (!pos || !p.position || p.position === pos)) return [id, p];
  }
  // Exact without position filter
  for (const [id, p] of Object.entries(map)) {
    const full = (p.full_name || `${p.first_name} ${p.last_name}`).trim().toLowerCase();
    if (full === q) return [id, p];
  }
  // Partial fallback
  for (const [id, p] of Object.entries(map)) {
    const full = (p.full_name || `${p.first_name} ${p.last_name}`).trim().toLowerCase();
    if ((full.includes(q) || q.includes(full)) && (!pos || !p.position || p.position === pos)) return [id, p];
  }
  return null;
}

// ── Season total aggregation ─────────────────────────────────────────────────
function aggregate(statsArr) {
  const totals = {};
  for (const s of statsArr) {
    if (!s) continue;
    for (const [k, v] of Object.entries(s)) {
      if (typeof v === 'number') totals[k] = (totals[k] || 0) + v;
    }
  }
  return totals;
}

export async function fetchBulkWeekStats(season = 2025, week = 18) {
  return fetchCached(
    `${SLEEPER}/stats/nfl/regular/${season}/${week}`,
    `stats:${season}:${week}`
  );
}

// ── NFL State ────────────────────────────────────────────────────────────────
let _nflState = null;
let _nflStateAt = 0;
export async function getNFLState() {
  const now = Date.now();
  if (_nflState && now - _nflStateAt < 5 * 60 * 1000) return _nflState;
  _nflState = await fetch(`${SLEEPER}/state/nfl`).then(r => r.ok ? r.json() : null).catch(() => null);
  _nflStateAt = now;
  return _nflState;
}

// ── Trending adds/drops (last N hours across all Sleeper leagues) ─────────────
export async function getTrending(type = 'add', hours = 24, limit = 25) {
  return fetch(`${SLEEPER}/trending/nfl/${type}?lookback_hours=${hours}&limit=${limit}`)
    .then(r => r.ok ? r.json() : [])
    .catch(() => []);
}

// ── Live week scores (all players, one request) ───────────────────────────────
export async function getLiveWeekScores(season, week) {
  return fetchCached(
    `${SLEEPER}/stats/nfl/regular/${season}/${week}`,
    `live:${season}:${week}`
  );
}

// ── Projections for a specific week ─────────────────────────────────────────
export async function getWeekProjections(season, week) {
  return fetchCached(
    `${SLEEPER}/projections/nfl/regular/${season}/${week}`,
    `proj:regular:${season}:${week}`
  );
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Fetch stats + projections for a single player directly from Sleeper.
 * Returns the same shape as the worker's /api/player/stats endpoint so
 * callers don't need to change their data-consumption code.
 */
export async function fetchSleeperPlayerStats(name, pos, season = 2025) {
  // NFL state (current week / season type)
  const state = await fetch(`${SLEEPER}/state/nfl`)
    .then(r => r.json())
    .catch(() => ({}));

  const currentWeek = Math.max(1, state.week || 18);
  // During offseason / preseason, pull regular-season stats from last season
  const isOff = state.season_type === 'off' || state.season_type === 'pre';
  const statsType = isOff ? 'regular' : (state.season_type || 'regular');
  const maxWeek   = isOff ? 18 : Math.min(currentWeek, 18);

  // Find player in map
  const map = await getPlayerMap();
  const entry = findInMap(map, name, pos);
  if (!entry) return { found: false, searched: name, pos };
  const [sleeperId, player] = entry;

  // Fetch last 8 completed weeks of stats (deduped via cache)
  const weeksWanted = Array.from({ length: 8 }, (_, i) => maxWeek - i).filter(w => w >= 1);
  const weekData = await Promise.all(
    weeksWanted.map(wk =>
      fetchCached(`${SLEEPER}/stats/nfl/regular/${season}/${wk}`, `stats:${season}:${wk}`)
    )
  );

  // Fetch projections for the most relevant week
  const projWeek = isOff ? 1 : currentWeek;
  const projData = await fetchCached(
    `${SLEEPER}/projections/nfl/${statsType}/${season}/${projWeek}`,
    `proj:${statsType}:${season}:${projWeek}`
  );

  const weeklyStats = {};
  weekData.forEach((d, i) => {
    const s = d?.[sleeperId];
    if (s && Object.keys(s).length > 0) weeklyStats[weeksWanted[i]] = s;
  });

  const rawProj = projData?.[sleeperId] ?? null;
  return {
    found: true,
    sleeperId,
    name:          player.full_name || `${player.first_name} ${player.last_name}`,
    team:          player.team || '',
    pos:           player.position || pos,
    status:        player.injury_status || player.status || 'Active',
    injuryBodyPart: player.injury_body_part || '',
    currentWeek,
    gamesPlayed:   Object.keys(weeklyStats).length,
    weeklyStats,
    seasonTotals:  aggregate(Object.values(weeklyStats)),
    projection:    rawProj,
    // Convenience scalar so callers don't need to know the internal field name
    proj:          rawProj?.pts_half_ppr ?? rawProj?.pts_std ?? rawProj?.pts_ppr ?? null,
  };
}

/**
 * Bulk-fetch Sleeper projections for all players in one pass (2 HTTP calls).
 * Returns an array of [ourNumericId, projValue] pairs.
 * Pass the full player list from playerStore; cross-reference is done by sleeperId,
 * with a name-match fallback for players whose sleeperId isn't in the Sleeper map.
 */
export async function fetchBulkProjections(players) {
  const state = await getNFLState().catch(() => null);
  const isOff = !state || state.season_type === 'off' || state.season_type === 'pre';
  const season = isOff ? 2025 : (Number(state.season) || 2025);
  const week   = isOff ? 1    : Math.max(1, Math.min(Number(state.week) || 1, 18));
  const type   = isOff ? 'regular' : (state.season_type || 'regular');

  const [map, projMap] = await Promise.all([
    getPlayerMap(),
    fetchCached(
      `${SLEEPER}/projections/nfl/${type}/${season}/${week}`,
      `proj:${type}:${season}:${week}`
    ),
  ]);
  if (!map || !projMap) return [];

  const updates = [];
  for (const p of players) {
    // Primary lookup: sleeperId stored in the player record
    let sid = p.sleeperId ? String(p.sleeperId) : null;
    // Fallback: search by name if sleeperId not in map
    if (!sid || !map[sid]) {
      const found = findInMap(map, p.name, p.pos);
      sid = found ? found[0] : null;
    }
    if (!sid) continue;
    const stats = projMap[sid];
    if (!stats) continue;
    const proj = stats.pts_half_ppr ?? stats.pts_std ?? stats.pts_ppr ?? null;
    if (proj != null) updates.push([p.id, Number(proj)]);
  }
  return updates;
}
