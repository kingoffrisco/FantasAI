// Module-level live store for league data loaded from S3.
// Populated on login and cold mount; cleared on logout.
// Falls back to data.js LEAGUE_TEAMS / LeagueSettings DEFAULTS when null.
//
// Auto-initializes from localStorage on module load so findTeam() works
// synchronously on the first render (before the async S3 fetch resolves).

let _store = null;

try {
  const user     = JSON.parse(localStorage.getItem('fantasai_user') || 'null');
  const leagueId = user?.leagueId || 'tau';
  const cached   = JSON.parse(localStorage.getItem(`fantasai_league_data_${leagueId}`) || 'null');
  if (cached) _store = cached;
} catch {}

export function applyLeagueData(data) { _store = data || null; }
export function clearLeagueData()     { _store = null; }
export function getLiveTeams()        { return _store?.teams    ?? null; }
export function getLiveSettings()     { return _store?.settings ?? null; }
export function getLeagueId()         { return _store?.leagueId ?? 'tau'; }
