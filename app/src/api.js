const BASE     = import.meta.env.VITE_WORKER_URL ?? 'https://fantasai-cbs.fantasai.workers.dev'
const API_BASE = 'https://api.fantasai.net'

async function get(path) {
  const res = await fetch(BASE + path)
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
  return res.json()
}

async function r2Get(key) {
  const res = await fetch(`${API_BASE}/api/v1/r2/${key}`)
  if (res.status === 404) return null   // file not written by Databricks yet
  if (!res.ok) throw new Error(`R2 ${res.status}`)
  return res.json()
}

export const api = {
  league:   ()            => get('/api/cbs/league'),
  teams:    ()            => get('/api/cbs/teams'),
  rankings: (pos = 'ALL') => get(`/api/cbs/rankings?pos=${pos}`),
  draft:    (year)        => get(`/api/cbs/draft?year=${year}`),
  rosters:  ()            => get('/api/cbs/rosters'),
  // Full active NFL player pool from Databricks bronze_player_news_raw table
  dbPlayers: () => fetch(`${API_BASE}/api/v1/db/players`).then(r => r.json()),
  // Sleeper fallback (1 h CF cache) — used only if Databricks is unavailable
  allPlayers: (limit = 2000) => fetch(`${API_BASE}/api/v1/players?limit=${limit}`).then(r => r.json()),

  r2: {
    lineup:   () => r2Get('fantasai/analysis/lineup_recommendations.json'),
    injuries: () => r2Get('fantasai/injuries/silver_player_news.json'),
    trends:   () => r2Get('fantasai/analysis/performance_trends.json'),
    trade:    () => r2Get('fantasai/analysis/trade_values.json'),
    waivers:  () => r2Get('fantasai/analysis/waiver_wire_recommendations.json'),
    drops:    () => r2Get('fantasai/analysis/drop_candidates.json'),
    list:          (prefix = '') => fetch(`${API_BASE}/api/v1/r2/list?prefix=${encodeURIComponent(prefix)}`).then(r => r.json()),
    playerNotes:    () => r2Get('fantasai/news/player_notes.json'),
    criticalAlerts: () => r2Get('fantasai/news/critical_alerts.json'),
    enrichedNews:        () => r2Get('fantasai/news/enriched_news.json'),
    aiSummaries:         () => r2Get('fantasai/news/ai_summaries.json'),
    breakoutCandidates:  () => r2Get('fantasai/analysis/breakout_candidates.json'),
    weatherForecast:     () => r2Get('fantasai/analysis/weather_forecast.json'),
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
}
