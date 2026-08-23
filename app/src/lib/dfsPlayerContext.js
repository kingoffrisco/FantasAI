// Per-player context for the DFS AI Lineup Analysis — pulls together
// everything FantasAI already knows about each rostered player (not just
// DK's own salary/projection) so the AI critic reasons from the same data
// the rest of the site uses. Every field here traces to a real R2 export or
// the main player store; nothing is estimated or fabricated for this module.
//
// Deliberately excluded: raw weekly game logs (500K+ rows, useR2WeeklyStats)
// — too large to put in a prompt. The main player record's season avg/last
// week/trend already summarize that; Floor/Ceiling (dfsAnalysis.js) already
// covers the percentile view of the same history.

import { getPrefs, patchPrefs } from './remotePrefs.js';

export const PLAYER_CONTEXT_SOURCES = [
  { key: 'ourModel',    label: 'FantasAI Projections, Tier & ADP' },
  { key: 'usage',       label: 'Snap Share & Target/Carry Usage' },
  { key: 'advanced',    label: 'Advanced Metrics (Routes, YAC, aDOT, Air Yards)' },
  { key: 'matchup',     label: 'Opponent Matchup vs Position' },
  { key: 'oline',       label: 'Offensive Line Quality (QB/RB)' },
  { key: 'weapon',      label: 'Weapon / Team Support Score (pass-catchers)' },
  { key: 'news',        label: 'Recent News & Injury Reports' },
];

function normKey(s) {
  return (s || '').toLowerCase().trim();
}

function latestSeasonEntry(bySeason) {
  if (!bySeason || typeof bySeason !== 'object') return null;
  const seasons = Object.keys(bySeason).map(Number).filter(n => !Number.isNaN(n));
  if (seasons.length === 0) return null;
  const latest = Math.max(...seasons);
  return bySeason[String(latest)] ?? bySeason[latest] ?? null;
}

export function defenseVsPosRank(defenseVsPos, team, position) {
  const list = Array.isArray(defenseVsPos) ? defenseVsPos : (defenseVsPos?.data || []);
  const row = list.find(d => {
    const dTeam = (d.def_team || d.team || '').toUpperCase();
    const dPos  = (d.position || d.pos || '').toUpperCase();
    return dTeam === (team || '').toUpperCase() && dPos === (position || '').toUpperCase();
  });
  if (!row) return null;
  const rank = row.rank_vs_pos ?? row.rank;
  return rank != null ? Number(rank) : null;
}

function latestWeaponScore(weaponScores, name) {
  const list = (weaponScores?.players || []).filter(p => normKey(p.player_name) === normKey(name));
  if (list.length === 0) return null;
  return list.reduce((a, b) => (Number(b.season) > Number(a.season) ? b : a));
}

function playerNewsFor(playerNotesArray, name) {
  if (!Array.isArray(playerNotesArray)) return null;
  const entry = playerNotesArray.find(p => normKey(p.player_name) === normKey(name));
  if (!entry) return null;
  const topNote = (entry.notes || [])[0];
  return {
    hasInjuryConcern: !!entry.has_injury_concern,
    injuryStatus: entry.injury_status,
    sentiment: entry.sentiment,
    headline: topNote?.note_text || null,
  };
}

/**
 * Builds one compact text block per lineup player, combining FantasAI's own
 * model data with matchup/OL/news signals. Returns an array of strings
 * (already formatted for a prompt), one per player.
 */
export function buildPlayerContextLines(lineup, sources, enabled = {}) {
  const {
    findPlayerByName,
    defenseVsPos,
    playerNotes,
    weaponScores,
    teamSupportScores,
    olineStability,
  } = sources;

  const on = key => enabled[key] !== false;

  return lineup.map(({ slot, player }) => {
    const parts = [];
    const rec = findPlayerByName ? findPlayerByName(player.name) : null;

    if (on('ourModel') && rec) {
      const bits = [];
      if (rec.proj) bits.push(`FantasAI proj ${rec.proj.toFixed?.(1) ?? rec.proj}`);
      if (rec.tier) bits.push(`tier ${rec.tier}`);
      if (rec.ecr) bits.push(`ECR #${rec.ecr}`);
      if (rec.adp) bits.push(`ADP #${rec.adp}`);
      if (rec.trend) bits.push(`trend ${rec.trend}`);
      if (rec.avg) bits.push(`season avg ${rec.avg.toFixed?.(1) ?? rec.avg}`);
      if (bits.length) parts.push(bits.join(', '));
    }

    if (on('usage') && rec) {
      const bits = [];
      if (rec.snapPct != null) bits.push(`${(rec.snapPct * (rec.snapPct <= 1 ? 100 : 1)).toFixed(0)}% snaps`);
      if (rec.targetShare) bits.push(`${(rec.targetShare * (rec.targetShare <= 1 ? 100 : 1)).toFixed(0)}% target share`);
      if (rec.avgTargetsG) bits.push(`${rec.avgTargetsG.toFixed(1)} tgt/g`);
      if (rec.avgCarriesG) bits.push(`${rec.avgCarriesG.toFixed(1)} car/g`);
      if (rec.avgRzAttG) bits.push(`${rec.avgRzAttG.toFixed(1)} RZ att/g`);
      if (bits.length) parts.push(`Usage: ${bits.join(', ')}`);
    }

    if (on('advanced') && rec) {
      const bits = [];
      if (rec.routes) bits.push(`${rec.routes} routes`);
      if (rec.yac != null) bits.push(`${rec.yac.toFixed(1)} YAC/rec`);
      if (rec.adot != null) bits.push(`${rec.adot.toFixed(1)} aDOT`);
      if (rec.airYds) bits.push(`${rec.airYds} air yds`);
      if (bits.length) parts.push(`Advanced: ${bits.join(', ')}`);
    }

    if (on('matchup') && player.opponent && player.position) {
      const rank = defenseVsPosRank(defenseVsPos, player.opponent, player.position);
      if (rank != null) {
        parts.push(`Matchup: ${player.opponent} ranks #${rank} vs ${player.position} (1 = toughest matchup, 32 = easiest)`);
      }
    }

    if (on('oline') && ['QB', 'RB'].includes(player.position) && player.team) {
      const support = latestSeasonEntry(teamSupportScores?.teams?.[player.team]);
      const stability = latestSeasonEntry(olineStability?.teams?.[player.team]);
      const bits = [];
      if (support?.oline_score != null) bits.push(`OL support score ${Math.round(support.oline_score)}/100`);
      if (stability?.olsi_score != null) bits.push(`OL stability ${Math.round(stability.olsi_score)}/100`);
      if (bits.length) parts.push(`O-Line (${player.team}): ${bits.join(', ')}`);
    }

    if (on('weapon') && ['WR', 'TE', 'RB'].includes(player.position)) {
      const ws = latestWeaponScore(weaponScores, player.name);
      if (ws?.weapon_score != null) parts.push(`Weapon score: ${Math.round(ws.weapon_score)}/100`);
    }

    if (on('news')) {
      const news = playerNewsFor(playerNotes, player.name);
      if (news) {
        const bits = [];
        if (news.hasInjuryConcern) bits.push(`injury concern (${news.injuryStatus || 'flagged'})`);
        if (news.sentiment && news.sentiment !== 'neutral') bits.push(`${news.sentiment} sentiment`);
        if (news.headline) bits.push(`"${news.headline.slice(0, 100)}"`);
        if (bits.length) parts.push(`News: ${bits.join(' — ')}`);
      }
    }

    const body = parts.length ? parts.join(' | ') : 'no additional FantasAI data available';
    return `${slot} ${player.name} (${player.team}): ${body}`;
  });
}

// ─── DFS pool table columns ────────────────────────────────────────────
// Toggleable columns for the "Select Players for This Contest" table —
// same catalog spirit as the Players page (opp/weather/ADP/NextGen/combine),
// scoped to what's meaningful for building a DFS lineup. Pos/Player/Team/
// Salary/Proj/Lock/Exclude stay fixed and aren't part of this list.
export const DFS_POOL_COLUMNS = [
  { id: 'opp',      label: 'Opp',      visible: true, group: 'std' },
  { id: 'weather',  label: 'Weather',  visible: true, group: 'std' },
  { id: 'matchup',  label: 'Matchup',  visible: true, group: 'std' },
  { id: 'adp',      label: 'ADP',      visible: true, group: 'std' },
  { id: 'rank',     label: 'Rank',     visible: true, group: 'std' },
  { id: 'tier',     label: 'Tier',     visible: true, group: 'std' },
  { id: 'last',     label: 'Last',     visible: true, group: 'std' },
  { id: 'avg',      label: 'Season Avg', visible: true, group: 'std' },
  { id: 'trend',    label: 'Trend',    visible: true, group: 'std' },
  { id: 'bye',      label: 'Bye',      visible: true, group: 'std' },
  { id: 'owned',    label: '%Own',     visible: true, group: 'std' },
  { id: 'depth',    label: 'Depth',    visible: true, group: 'std' },
  { id: 'snaps',    label: 'Snaps/G',  visible: true, group: 'std' },
  { id: 'snap_pct', label: 'Snap%',    visible: true, group: 'adv' },
  { id: 'tgt',      label: 'Tgt%',     visible: true, group: 'adv' },
  { id: 'tgt_g',    label: 'Tgt/G',    visible: true, group: 'adv' },
  { id: 'att_g',    label: 'Att/G',    visible: true, group: 'adv' },
  { id: 'rz_att',   label: 'RZ Att/G', visible: true, group: 'adv' },
  { id: 'routes',   label: 'Routes',   visible: true, group: 'adv' },
  { id: 'yac',      label: 'YAC',      visible: true, group: 'adv' },
  { id: 'adot',     label: 'ADOT',     visible: true, group: 'adv' },
  { id: 'air_yds',  label: 'Air Yds',  visible: true, group: 'adv' },
  { id: 'yptgt',    label: 'Yds/Tgt',  visible: true, group: 'adv' },
  { id: 'combo',    label: 'Combo Yds', visible: true, group: 'adv' },
  { id: 'forty',    label: '40-Yd',    visible: true, group: 'combine' },
  { id: 'vertical', label: 'Vert',     visible: true, group: 'combine' },
  { id: 'broad',    label: 'Broad',    visible: true, group: 'combine' },
  { id: 'bench',    label: 'Bench',    visible: true, group: 'combine' },
];

const DFS_POOL_COLUMNS_PREF_KEY = 'dfsPoolColumns';

export function loadDfsPoolColumns() {
  try {
    const saved = getPrefs().dfsPoolColumns;
    if (!Array.isArray(saved)) return DFS_POOL_COLUMNS.map(c => ({ ...c }));
    const savedIds = new Set(saved.map(c => c.id));
    return [
      ...saved.map(c => { const def = DFS_POOL_COLUMNS.find(d => d.id === c.id); return def ? { ...def, visible: c.visible } : null; }).filter(Boolean),
      ...DFS_POOL_COLUMNS.filter(c => !savedIds.has(c.id)),
    ];
  } catch { return DFS_POOL_COLUMNS.map(c => ({ ...c })); }
}

export function saveDfsPoolColumns(cols) {
  patchPrefs({ [DFS_POOL_COLUMNS_PREF_KEY]: cols });
}

/**
 * Flat per-player enrichment record for one DFS pool table row — raw values
 * (not prompt text) for whichever toggleable columns are visible. Every
 * field traces to the same real sources as buildPlayerContextLines above.
 */
export function buildOwnershipMap(playerOwnership) {
  const arr = Array.isArray(playerOwnership) ? playerOwnership : (playerOwnership?.data || playerOwnership?.players || []);
  const map = new Map();
  for (const o of arr) {
    if (o.player_name) map.set(normKey(o.player_name), Number(o.ownership_pct) || 0);
  }
  return map;
}

export function getPlayerTableRow(player, sources) {
  const { findPlayerByName, defenseVsPos, ownershipMap, weatherForecast, weatherThresholds } = sources;
  const rec = findPlayerByName ? findPlayerByName(player.name) : null;
  const owned = ownershipMap?.get(normKey(player.name)) ?? null;

  const homeTeam = player.isHome ? player.team : player.opponent;
  const weather = weatherForecast ? weatherRiskForTeamLocal(weatherForecast, homeTeam, weatherThresholds || { lowMaxMph: 10, medMaxMph: 20 }) : null;

  const matchupRank = player.opponent && player.position
    ? defenseVsPosRank(defenseVsPos, player.opponent, player.position)
    : null;

  return {
    adp: rec?.adp ?? null,
    rank: rec?.ecr ?? null,
    tier: rec?.tier ?? null,
    last: rec?.last ?? null,
    avg: rec?.avg ?? null,
    trend: rec?.trend ?? null,
    bye: rec?.bye ?? null,
    owned,
    depth: rec?.depthChartOrder ?? null,
    snaps: rec?.avgSnaps ?? null,
    snapPct: rec?.snapPct ?? null,
    targetShare: rec?.targetShare ?? null,
    tgtG: rec?.avgTargetsG ?? null,
    attG: rec?.avgCarriesG ?? null,
    rzAttG: rec?.avgRzAttG ?? null,
    routes: rec?.routes ?? null,
    yac: rec?.yac ?? null,
    adot: rec?.adot ?? null,
    airYds: rec?.airYds ?? null,
    yptgt: rec?.yptgt ?? null,
    combo: rec?.comboYdsG ?? null,
    forty: rec?.forty ?? null,
    vertical: rec?.vertical ?? null,
    broadJump: rec?.broadJump ?? null,
    benchPress: rec?.benchPress ?? null,
    weatherLabel: weather?.label ?? null,
    weatherWindMph: weather?.windMph ?? null,
    matchupRank,
  };
}

// Local copy of dfsAnalysis.js's weatherRiskForTeam to avoid a circular
// import (dfsAnalysis.js doesn't depend on this file, but keeping this
// self-contained avoids coupling the pool table to the AI-analysis module).
function weatherRiskForTeamLocal(weatherForecast, homeTeam, thresholds) {
  const teams = weatherForecast?.teams;
  if (!teams || !homeTeam) return null;
  const entry = teams[homeTeam];
  if (!entry) return null;
  if (entry.is_dome) return { label: 'Dome', windMph: 0 };
  const day = entry.forecast?.[0];
  const hour = day?.hourly?.find(h => h.time === '1300') || day?.hourly?.[0];
  if (!hour) return null;
  const wind = Math.round(hour.wind_mph || 0);
  const label = wind <= thresholds.lowMaxMph ? 'Low' : wind <= thresholds.medMaxMph ? 'Medium' : 'High';
  return { label, windMph: wind };
}
