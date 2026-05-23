const BASE = import.meta.env.VITE_WORKER_URL ?? 'https://fantasai-cbs.fantasai.workers.dev'

async function get(path) {
  const res = await fetch(BASE + path)
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
  return res.json()
}

export const api = {
  league:   ()            => get('/api/cbs/league'),
  teams:    ()            => get('/api/cbs/teams'),
  rankings: (pos = 'ALL') => get(`/api/cbs/rankings?pos=${pos}`),
  draft:    (year)        => get(`/api/cbs/draft?year=${year}`),
  rosters:  ()            => get('/api/cbs/rosters'),
}
