// Shared Kalshi NFL market parsing — used by the Betting > Kalshi page and
// the DFS AI Lineup Analysis. Verified live 2026-08-22 against real cached
// data (fantasai/betting/kalshi_nfl_markets.json) — see the git history for
// the test that validated ticker-splitting and implied-total extraction.

// Kalshi uses JAC for Jacksonville; this app (and DK) uses JAX everywhere
// else. Keep both so ticker-splitting matches regardless of source.
export const NFL_TEAMS = ['ARI', 'ATL', 'BAL', 'BUF', 'CAR', 'CHI', 'CIN', 'CLE', 'DAL', 'DEN', 'DET', 'GB',
  'HOU', 'IND', 'JAX', 'JAC', 'KC', 'LAC', 'LAR', 'LV', 'MIA', 'MIN', 'NE', 'NO', 'NYG', 'NYJ',
  'PHI', 'PIT', 'SEA', 'SF', 'TB', 'TEN', 'WAS'];

export function normTeam(code) {
  return code === 'JAC' ? 'JAX' : code;
}

// Kalshi event_ticker looks like "KXNFLTOTAL-26AUG23SEATEN" — a date code
// then two team abbreviations concatenated with no separator. Split by
// checking known team codes since abbreviations aren't fixed-width.
export function splitTeamsFromTicker(eventTicker, seriesPrefix) {
  const suffix = (eventTicker || '').replace(new RegExp(`^${seriesPrefix}-\\d{2}[A-Z]{3}\\d{2}`), '');
  for (const a of NFL_TEAMS) {
    if (suffix.startsWith(a)) {
      const rest = suffix.slice(a.length);
      if (NFL_TEAMS.includes(rest)) return [normTeam(a), normTeam(rest)];
    }
  }
  return null;
}

// bronze_kalshi_nfl_markets doesn't store the numeric strike as its own
// column (an ingest gap, not fixed here) — it's reliably embedded in the
// title text instead: "Will there be over 34.5 points scored?"
export function extractStrikeFromTitle(title) {
  const m = (title || '').match(/over ([\d.]+) points/i);
  return m ? Number(m[1]) : null;
}

function marketsList(kalshiMarkets) {
  return Array.isArray(kalshiMarkets) ? kalshiMarkets : (kalshiMarkets?.markets || []);
}

/** Best single-number estimate of a game's total: the strike whose yes_bid
 * is closest to 50% — the line the market currently considers a coin flip,
 * the standard way to read an implied total off a ladder of binary
 * over/under markets. Returns null if no matching game/strike found. */
export function findImpliedGameTotal(kalshiMarkets, teamA, teamB) {
  let best = null, bestDist = Infinity;
  for (const m of marketsList(kalshiMarkets)) {
    if (m.series_ticker !== 'KXNFLTOTAL') continue;
    const teams = splitTeamsFromTicker(m.event_ticker, 'KXNFLTOTAL');
    if (!teams || !teams.includes(teamA) || !teams.includes(teamB)) continue;
    const strike = extractStrikeFromTitle(m.title);
    if (strike == null || m.yes_bid == null) continue;
    const dist = Math.abs(m.yes_bid - 0.5);
    if (dist < bestDist) { bestDist = dist; best = strike; }
  }
  return best;
}

/** Win probability for `team` vs `opponent`, from the KXNFLGAME market's
 * yes_bid — read defensively since which side "yes" refers to isn't fully
 * confirmed from a single sample; returns null rather than guessing when
 * the side can't be determined from yes_sub_title/no_sub_title. */
export function findWinProbability(kalshiMarkets, team, opponent) {
  for (const m of marketsList(kalshiMarkets)) {
    if (m.series_ticker !== 'KXNFLGAME') continue;
    const teams = splitTeamsFromTicker(m.event_ticker, 'KXNFLGAME');
    if (!teams || !teams.includes(team) || !teams.includes(opponent)) continue;
    if (m.yes_bid == null) continue;
    const yesSub = (m.yes_sub_title || '').toUpperCase();
    const noSub = (m.no_sub_title || '').toUpperCase();
    if (yesSub.includes(team)) return m.yes_bid;
    if (noSub.includes(team)) return 1 - m.yes_bid;
    return null;
  }
  return null;
}

/** Groups every NFL market by game (team pair), across all series types,
 * for a browsable per-game summary. */
export function groupMarketsByGame(kalshiMarkets) {
  const games = new Map(); // "TEAMA|TEAMB" (sorted) -> { teams: [a,b], markets: [] }
  for (const m of marketsList(kalshiMarkets)) {
    const teams = splitTeamsFromTicker(m.event_ticker, m.series_ticker);
    if (!teams) continue;
    const key = [...teams].sort().join('|');
    if (!games.has(key)) games.set(key, { teams, markets: [], closeTime: m.close_time });
    games.get(key).markets.push(m);
  }
  return [...games.values()];
}
