const BASE        = import.meta.env.VITE_WORKER_URL ?? 'https://fantasai-cbs.fantasai.workers.dev'
const API_BASE    = 'https://api.fantasai.net'
// X-FantasAI-Key is required by the main API Worker for all R2 and db endpoints.
// Set VITE_FANTASAI_KEY in Cloudflare Pages env vars (or local .env for dev).
const FANTASAI_KEY = import.meta.env.VITE_FANTASAI_KEY || 'fantasai2026'

function apiHeaders() {
  return FANTASAI_KEY ? { 'X-FantasAI-Key': FANTASAI_KEY } : {}
}

function cbsHeaders() {
  const h = { ...apiHeaders() }
  try { const c = localStorage.getItem('fantasai_cbs_cookie'); if (c) h['X-CBS-Cookie'] = c; } catch {}
  return h
}

async function get(path) {
  const res = await fetch(BASE + path, { headers: cbsHeaders() })
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
  return res.json()
}

async function r2Get(key) {
  const res = await fetch(`${API_BASE}/api/v1/r2/${key}`, { headers: apiHeaders() })
  if (res.status === 404) return null   // file not written by Databricks yet
  if (!res.ok) throw new Error(`R2 ${res.status}`)
  return res.json()
}

// Normalise any Databricks R2 player export shape into a plain array.
// Supports: root array, { data: [...] }, { players: [...] }
function extractPlayerArray(raw) {
  if (!raw) return []
  if (Array.isArray(raw)) return raw
  if (Array.isArray(raw.data)) return raw.data
  if (Array.isArray(raw.players)) return raw.players
  return []
}

export const api = {
  league:   ()            => get('/api/cbs/league'),
  teams:    ()            => get('/api/cbs/teams'),
  rankings: (pos = 'ALL') => get(`/api/cbs/rankings?pos=${pos}`),
  draft:    (year)        => get(`/api/cbs/draft?year=${year}`),
  rosters:  ()            => get('/api/cbs/rosters'),
  // Full active NFL player pool from Databricks export_players_2026_draft (via worker-api)
  dbPlayers: () => fetch(`${API_BASE}/api/v1/db/players`, { headers: apiHeaders() }).then(r => r.json()),
  // Sleeper full player list proxied through CBS Worker (no CORS, 1 h edge cache, ~1500 active players)
  sleeperPlayers: () => fetch(`${BASE}/api/cbs/sleeper-players`, { headers: apiHeaders() }).then(r => r.json()),
  // Sleeper fallback (1 h CF cache) — used only if Databricks is unavailable
  allPlayers: (limit = 2000) => fetch(`${API_BASE}/api/v1/players?limit=${limit}`, { headers: apiHeaders() }).then(r => r.json()),

  r2: {
    // Try .json first, then .js, then no extension.
    // Always returns a plain array (handles root-array, {data:[...]}, {players:[...]} shapes).
    players2026: async () => {
      const paths = [
        'fantasai/players/players_2026_draft.json',
        'fantasai/players/export_players_2026_draft.json',
        'fantasai/players/export_players_2026_draft.js',
        'fantasai/players/export_players_2026_draft',
      ];
      for (const p of paths) {
        const raw = await r2Get(p);
        const arr = extractPlayerArray(raw);
        if (arr.length > 0) return arr;
      }
      return null;
    },
    lineup:   () => r2Get('fantasai/analysis/lineup_recommendations.json'),
    injuries: () => r2Get('fantasai/players/injury_overlay.json'),
    trends:   () => r2Get('fantasai/analysis/performance_trends.json'),
    playerScores: () => r2Get('fantasai/analysis/player_scores.json'),
    trade:    () => r2Get('fantasai/analysis/trade_values.json'),
    waivers:  () => r2Get('fantasai/analysis/waiver_wire_recommendations.json'),
    drops:    () => r2Get('fantasai/analysis/drop_candidates.json'),
    list:     (prefix = '') => fetch(`${API_BASE}/api/v1/r2/list?prefix=${encodeURIComponent(prefix)}`, { headers: apiHeaders() }).then(r => r.json()),
    playerNotes:    () => r2Get('fantasai/news/player_notes.json'),
    playerNewsLinks: () => r2Get('fantasai/analysis/player_news.json'),
    criticalAlerts: () => r2Get('fantasai/news/critical_alerts.json'),
    enrichedNews:        () => r2Get('fantasai/news/enriched_news.json'),
    aiSummaries:         () => r2Get('fantasai/news/ai_summaries.json'),
    breakoutCandidates:  async () => {
      // Backend exports to analysis/ (no fantasai/ prefix) — try both paths.
      for (const p of ['analysis/breakout_candidates.json', 'fantasai/analysis/breakout_candidates.json']) {
        const r2 = await r2Get(p);
        if (r2) {
          const arr = extractPlayerArray(r2);
          if (arr.length > 0) return arr;
        }
      }
      // Fall back to live Databricks SQL endpoint.
      try {
        const res = await fetch(`${API_BASE}/api/v1/opportunity/rankings`);
        if (!res.ok) return null;
        const json = await res.json();
        const rows = json?.data || [];
        return rows.map(r => ({
          player_name:       r.player_name,
          position:          r.position,
          team:              r.team,
          opportunity_score: parseFloat(r.opportunity_score) || 0,
          snap_share_delta:  null,
          avg_snap_share:    null,
        }));
      } catch { return null; }
    },
    sleeperPicks: async () => {
      // Backend exports to analysis/ (no fantasai/ prefix) — try both paths.
      for (const p of ['analysis/sleeper_picks.json', 'fantasai/analysis/sleeper_picks.json']) {
        const r2 = await r2Get(p);
        if (r2) {
          const arr = extractPlayerArray(r2);
          if (arr.length > 0) return arr;
        }
      }
      return null;
    },
    weatherForecast:      () => r2Get('fantasai/analysis/weather_forecast.json'),
    // Clean 32-row DST ranking table (main.fantasai.gold_adp_defense → R2).
    // Fields: team, adp_rank (1-32), avg_pts, avg_last_4_weeks. No duplicates.
    defenseAdp: async () => {
      for (const p of ['analysis/gold_adp_defense.json', 'fantasai/analysis/gold_adp_defense.json']) {
        const r2 = await r2Get(p);
        if (r2) return r2;
      }
      return null;
    },
    defensePerformance: async () => {
      for (const p of ['analysis/defense_performance.json', 'fantasai/analysis/defense_performance.json']) {
        const r2 = await r2Get(p);
        if (r2) return r2;
      }
      return null;
    },
    defensePredictions: async () => {
      for (const p of ['predictions/defense_predictions.json', 'fantasai/predictions/defense_predictions.json']) {
        const r2 = await r2Get(p);
        if (r2) return r2;
      }
      return null;
    },
    defenseVsPos:   () => r2Get('fantasai/analysis/defense_vs_pos.json'),
    rookieScores:   () => r2Get('fantasai/analysis/rookie_scores.json'),
    collegeStats:   () => r2Get('fantasai/analysis/college_stats.json'),
    // 583K records — only use on demand, not on page load
    weeklyStats: () => r2Get('fantasai/stats/gold_weekly_stats.json'),
    adpPPR:        () => r2Get('players/adp_ppr.json'),
    adpStandard:   () => r2Get('players/adp_standard.json'),
    ecrPPR:        () => r2Get('players/ecr_ppr.json'),
    ecrStandard:   () => r2Get('players/ecr_std.json'),
    playerWriteups:  () => r2Get('players/player_writeups.json'),
    nflSchedule:     () => r2Get('fantasai/analysis/nfl_schedule.json'),
    opponentLookup:  () => r2Get('fantasai/analysis/opponent_lookup.json'),
    playerOwnership: () => r2Get('fantasai/analysis/player_ownership.json'),
    combineData:     () => r2Get('fantasai/analysis/combine_data.json'),
    playerStats2025: () => r2Get('fantasai/analysis/player_stats_2025.json'),
    olineIndex:         () => r2Get('fantasai/analysis/oline_index.json'),
    playerTeamHistory:  () => r2Get('fantasai/analysis/player_team_history.json'),
    weaponScores:       () => r2Get('fantasai/analysis/player_weapon_scores.json'),
    teamSupportScores:  () => r2Get('fantasai/analysis/team_support_scores.json'),
    olineStability:       () => r2Get('fantasai/analysis/oline_stability.json'),
    playerOlineStability: () => r2Get('fantasai/analysis/player_oline_stability.json'),
    weeklyStartSit:  () => r2Get('fantasai/analysis/weekly_startsit.json'),
  },

  transactions: {
    get: () =>
      fetch(`${API_BASE}/api/v1/transactions`)
        .then(r => r.ok ? r.json() : [])
        .catch(() => []),
    log: tx =>
      fetch(`${API_BASE}/api/v1/transactions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(tx),
      }).catch(() => null),
  },

  draftPicks: {
    get: () =>
      fetch(`${API_BASE}/api/v1/draft/picks`)
        .then(r => r.ok ? r.json() : [])
        .catch(() => []),
    save: picks =>
      fetch(`${API_BASE}/api/v1/draft/picks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(picks),
      }).catch(() => null),
  },

  draftChat: {
    get: () =>
      fetch(`${API_BASE}/api/v1/r2/fantasai/draft/chat_log.json`)
        .then(r => r.ok ? r.json() : [])
        .catch(() => []),
    save: messages =>
      fetch(`${API_BASE}/api/v1/r2/fantasai/draft/chat_log.json`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(messages),
      }).catch(() => null),
  },

  draftQueue: {
    get: () =>
      fetch(`${API_BASE}/api/v1/r2/fantasai/draft/queue_by_team.json`)
        .then(r => r.ok ? r.json() : {})
        .catch(() => ({})),
    save: queueByTeam =>
      fetch(`${API_BASE}/api/v1/r2/fantasai/draft/queue_by_team.json`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(queueByTeam || {}),
      }).catch(() => null),
  },

  draftState: {
    get: () =>
      fetch(`${API_BASE}/api/v1/r2/fantasai/draft/state.json`)
        .then(r => r.ok ? r.json() : null)
        .catch(() => null),
    save: state =>
      fetch(`${API_BASE}/api/v1/r2/fantasai/draft/state.json`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(state || {}),
      }).catch(() => null),
  },

  loginLog: {
    // keepalive: true — App.jsx calls this immediately before window.location.reload(),
    // and a non-keepalive fetch can be aborted by the browser mid-navigation.
    record: (payload) =>
      fetch(`${API_BASE}/api/v1/login-log`, {
        method: 'POST',
        headers: { ...apiHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        keepalive: true,
      }).catch(() => null),
    list: () =>
      fetch(`${API_BASE}/api/v1/login-log`, { headers: apiHeaders() })
        .then(r => r.ok ? r.json() : { status: 'ok', entries: [] })
        .catch(() => ({ status: 'ok', entries: [] })),
  },

  leagues: {
    // No dedicated backend endpoint — every league (self-serve "Create League" or
    // "Import League" on the login screen) writes a league-config.json under
    // fantasai/leagues/{leagueId}/, so this just lists that prefix via the existing
    // R2 proxy and fetches each config directly.
    list: async () => {
      const listing = await fetch(`${API_BASE}/api/v1/r2/list?prefix=${encodeURIComponent('fantasai/leagues/')}`, { headers: apiHeaders() })
        .then(r => r.ok ? r.json() : { objects: [] })
        .catch(() => ({ objects: [] }));
      const configKeys = (listing.objects || []).filter(o => o.key.endsWith('/league-config.json'));
      const configs = await Promise.all(configKeys.map(o => r2Get(o.key).catch(() => null)));
      return configs.filter(Boolean);
    },
    delete: (leagueId) =>
      Promise.all(['league-config.json', 'owners-config.json'].map(f =>
        fetch(`${API_BASE}/api/v1/r2/fantasai/leagues/${leagueId}/${f}`, { method: 'DELETE', headers: apiHeaders() }).catch(() => null)
      )),
  },
}
