// Live (uncached) pulls straight from DraftKings, via the worker-api CORS
// proxy — for when the R2 snapshot (written by the local ingest_draftkings.py
// pipeline, which only pulls the top N largest-field draft groups) doesn't
// cover the contest the user actually picked, or the user just wants
// current data without waiting for the next scheduled pipeline run.
//
// Mirrors the parsing logic in ingest_draftkings.py exactly, so the rows
// this returns are drop-in compatible with the R2-cached shape the rest of
// DfsOptimizer.jsx already expects (dk_contests.json / dk_salaries.json).

const API_BASE = 'https://api.fantasai.net';

function proxyUrl(target) {
  return `${API_BASE}/api/v1/proxy?url=${encodeURIComponent(target)}`;
}

function parseDkDate(s) {
  if (!s) return null;
  const m = /\/Date\((\d+)\)\//.exec(s);
  if (!m) return null;
  return new Date(Number(m[1])).toISOString();
}

function isRealNflContest(c) {
  return c.gameType === 'Classic' && !c.isSnakeDraft;
}

/** Live equivalent of dk_contests.json's `.contests` array. */
export async function fetchDkLobbyContestsLive() {
  const res = await fetch(proxyUrl('https://www.draftkings.com/lobby/getcontests?sport=NFL'), {
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) throw new Error(`DraftKings lobby fetch failed (HTTP ${res.status})`);
  const data = await res.json();
  const contests = (data?.Contests || []).filter(isRealNflContest);
  return contests
    .map(c => ({
      contest_id: c.id,
      draft_group_id: c.dg,
      name: c.n || '',
      game_type: c.gameType || '',
      entry_fee: c.a ?? null,
      total_prize: c.po ?? null,
      payout_summary: c.pd ? Object.values(c.pd)[0] : '',
      max_entries: c.m ?? null,
      entries_so_far: c.nt ?? null,
      max_entries_per_user: c.mec ?? null,
      is_guaranteed: (c.attr?.IsGuaranteed ?? c.attr?.IsGuranteed) === 'true',
      start_time: parseDkDate(c.sd),
    }))
    .filter(c => c.contest_id != null && c.draft_group_id != null)
    .sort((a, b) => (b.total_prize || 0) - (a.total_prize || 0));
}

/** Live equivalent of dk_salaries.json's `.players` array, for one draft group. */
export async function fetchDkDraftGroupPlayersLive(draftGroupId) {
  const res = await fetch(proxyUrl(`https://api.draftkings.com/draftgroups/v1/draftgroups/${draftGroupId}/draftables`), {
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) throw new Error(`DraftKings player pool fetch failed (HTTP ${res.status})`);
  const data = await res.json();
  const draftables = data?.draftables || [];

  // Same dedup as ingest_draftkings.py: DK sends one row per (player,
  // eligible-slot-type) pair, not one row per player.
  const seen = new Set();
  const rows = [];
  for (const p of draftables) {
    const playerDkId = p.playerDkId;
    if (playerDkId != null) {
      if (seen.has(playerDkId)) continue;
      seen.add(playerDkId);
    }
    const comp = p.competition || {};
    const team = p.teamAbbreviation || '';
    const compName = comp.name || '';
    let opponent = '';
    let isHome = null;
    const teams = compName.split('@').map(s => s.trim());
    if (teams.length === 2) {
      const [away, home] = teams;
      isHome = team === home;
      opponent = team === away ? home : away;
    }
    let avgPoints = null;
    for (const a of (p.draftStatAttributes || [])) {
      if (a.id === 90) {
        const v = Number(a.value);
        if (!Number.isNaN(v)) avgPoints = v;
      }
    }
    rows.push({
      draft_group_id: draftGroupId,
      draftable_id: p.draftableId,
      player_dk_id: playerDkId,
      display_name: p.displayName || '',
      position: p.position || '',
      team,
      opponent,
      is_home: isHome,
      salary: p.salary,
      status: p.status || '',
      game_start_time: comp.startTime || null,
      dk_avg_points: avgPoints,
      dk_position_rank: null,
    });
  }
  return rows;
}
