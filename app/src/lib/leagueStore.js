// Module-level live store for league data loaded from S3.
// Populated on login and cold mount; cleared on logout.
// Falls back to data.js LEAGUE_TEAMS / LeagueSettings DEFAULTS when null.
//
// Auto-initializes from localStorage on module load so findTeam() works
// synchronously on the first render (before the async S3 fetch resolves).

let _store = null;

// Safety net: the commissioner's saved league-settings record in R2 (loaded
// below as "always authoritative") still has the pre-rename team names
// baked in from whenever it was last saved, and will keep overriding the
// names in data.js until that record is explicitly re-saved. Translate on
// the way out so the old names never render anywhere, regardless of source.
export const LEGACY_TEAM_NAME_MAP = {
  "Howdy Hut":                "Fourth and Long",
  "Start Pulling Out":        "Dak to the Future",
  "The Epstein Islanders":    "Kupp of Tea",
  "Penn State Shower Power":  "Fields of Dreams",
  "Vick's Hushpuppies":       "Here for the Beer",
  "Swingin' Flamingos":       "Hill Street Blues",
  "Gringo Pendejo":           "Victory Formation",
  "Fat, Drunk & Stupid":      "The Underdogs",
};

function renameLegacyTeam(t) {
  const renamed = LEGACY_TEAM_NAME_MAP[t?.name];
  return renamed ? { ...t, name: renamed } : t;
}

try {
  const user     = JSON.parse(localStorage.getItem('fantasai_user') || 'null');
  const leagueId = user?.leagueId || 'tau';
  const cached   = JSON.parse(localStorage.getItem(`fantasai_league_data_${leagueId}`) || 'null');
  if (cached) _store = cached;
} catch {}

export function applyLeagueData(data) { _store = data || null; }
export function clearLeagueData()     { _store = null; }
export function getLiveTeams()        { return _store?.teams?.map(renameLegacyTeam) ?? null; }
export function getLiveSettings()     { return _store?.settings ?? null; }
export function getLeagueId()         { return _store?.leagueId ?? 'tau'; }

// Reads the scoring format set by the commissioner ('ppr' | 'half-ppr' | 'standard').
// Falls back to 'half-ppr' when not yet configured.
export function getScoringFormat() {
  const fromS3 = _store?.settings?.scoringFormat;
  if (fromS3) return fromS3;
  try {
    const saved = JSON.parse(localStorage.getItem('fantasai_league_settings') || 'null');
    return saved?.scoringFormat || 'half-ppr';
  } catch { return 'half-ppr'; }
}

// Per-user team customizations stored locally (logo, color, name overrides).
export function getMyTeamPrefs() {
  try { return JSON.parse(localStorage.getItem('fantasai_team_prefs') || 'null'); } catch { return null; }
}
export function saveMyTeamPrefs(prefs) {
  localStorage.setItem('fantasai_team_prefs', JSON.stringify(prefs));
}
export function clearMyTeamPrefs() {
  localStorage.removeItem('fantasai_team_prefs');
}
