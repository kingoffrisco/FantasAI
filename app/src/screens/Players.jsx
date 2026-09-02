import React from 'react';
import WatchlistScreen from './Watchlist.jsx';
import { MY_ROSTER, TEAM_ROSTERS, TEAMS_ORDER, findTeam, NFL_TEAMS, NEWS, SOURCE_META, FREE_DATA_SOURCES, RANKING_SOURCES, buildRosterFrame, assignRoster, ROSTER_CONFIG, refreshTeamRosters, refreshTeamRostersFromServer } from '../lib/data.js';
import { usePlayers, isLiveData, findPlayer, getPlayers } from '../lib/playerStore.js';
import { PosBadge, StatusDot, PlayerAvatar, PlayerCell, Sparkline, ProjBar, Delta, AIHint, SourceBadge, TeamLogoBadge, SeasonStatBar, RadarChart, scoreToTier, SCORE_TIER_STYLE } from '../components/ui.jsx';
import { useApi, useR2BreakoutCandidates, useR2SleeperPicks, useR2Injuries, useR2PlayerNotes, useR2PlayerWriteups, useR2WeatherForecast, useR2DefensePerformance, useR2DefenseVsPos, useR2PlayerStats2025, useR2CombineData, useR2RookieScores, useR2CollegeStats, useR2WeeklyStartSit, useR2OlineIndex, useR2OlineIndexWeekly, useR2OlineRookieScores, useR2PlayerTeamHistory, useR2WeaponScores, useR2TeamSupportScores, useR2OlineStability, useR2PlayerOlineStability, useR2DeepReasoning, useR2FloorCeiling, useR2PlayerCoverageSplits, useR2TeamCoverageTendency, useR2PlayerRushBoxSplits, useR2TeamRushBoxTendency } from '../hooks.js';
import { fetchSleeperPlayerStats, getPlayerMap, fetchBulkWeekStats, getTrending, fetchLeagueSeasonTotals } from '../lib/sleeper.js';
// import { DataSourceDebugger } from './Sources.jsx'; // TEMP DEBUG — uncomment with the panel below
import { getPrefs, patchPrefs } from '../lib/remotePrefs.js';
import { api } from '../api.js';

// Strip generational suffixes so "Kenneth Walker" (app roster) matches "Kenneth Walker III"
// (CFBD college stats) without falling back to a last-name-only match, which can collide
// with dozens of unrelated players sharing a common surname.
const stripNameSuffix = s => (s || '').replace(/\s+(jr|sr|ii|iii|iv|v)\.?$/i, '').trim();

// Find a player's rows in a CFBD-style array keyed by player_name. Tries an exact
// (suffix-stripped) match first; if that fails, falls back to same-last-name +
// same-first-initial (handles nickname/given-name mismatches like "KC Concepcion"
// (app/Sleeper) vs "Kevin Concepcion" (CFBD)) — but only when that fallback resolves
// to exactly one distinct player, never a guess between several candidates.
function matchCollegeRows(arr, targetName) {
  const key = stripNameSuffix(targetName?.toLowerCase().trim());
  if (!key) return [];
  const exact = arr.filter(r => stripNameSuffix(r.player_name?.toLowerCase().trim() || '') === key);
  if (exact.length) return exact;
  const parts = key.split(' ');
  const last = parts[parts.length - 1];
  const firstInitial = key[0];
  if (!last || !firstInitial) return [];
  const candidates = new Set(
    arr
      .map(r => stripNameSuffix(r.player_name?.toLowerCase().trim() || ''))
      .filter(n => n.endsWith(' ' + last) && n[0] === firstInitial)
  );
  if (candidates.size !== 1) return [];
  const [only] = candidates;
  return arr.filter(r => stripNameSuffix(r.player_name?.toLowerCase().trim() || '') === only);
}

const NFL_TEAM_NAME = {
  ARI:'Cardinals',ATL:'Falcons',BAL:'Ravens',BUF:'Bills',CAR:'Panthers',CHI:'Bears',CIN:'Bengals',CLE:'Browns',
  DAL:'Cowboys',DEN:'Broncos',DET:'Lions',GB:'Packers',HOU:'Texans',IND:'Colts',JAX:'Jaguars',KC:'Chiefs',
  LAC:'Chargers',LAR:'Rams',LV:'Raiders',MIA:'Dolphins',MIN:'Vikings',NE:'Patriots',NO:'Saints',NYG:'Giants',
  NYJ:'Jets',PHI:'Eagles',PIT:'Steelers',SEA:'Seahawks',SF:'49ers',TB:'Buccaneers',TEN:'Titans',WAS:'Commanders',
};
const FREE_DATA_SOURCES_LIST = FREE_DATA_SOURCES.map(s => ({ id: s.id, name: s.name, defaultEnabled: s.enabled }));
const FEED_NAMES = Object.fromEntries(RANKING_SOURCES.map(s => [s.id, s.name.replace(' (ECR)', '').replace(' Fantasy', '').replace(' Sports Rankings', '').replace(' Rankings', '')]));


const WORKER   = (import.meta.env?.VITE_WORKER_URL || '').replace(/\/$/, '');
const API_BASE = 'https://api.fantasai.net';

// Fields where a lower value is better (invert when normalizing)
const LOWER_IS_BETTER = new Set(['ecr', 'adp', 'tier', 'oppRank']);

// ESPN abbreviations that differ from Sleeper's — used when parsing schedule response
const ESPN_TO_SLEEPER = { WSH: 'WAS', LAR: 'LAR', SFO: 'SF', GNB: 'GB', NWE: 'NE',
  NOR: 'NO', TAM: 'TB', KAN: 'KC', LVR: 'LV', LAC: 'LAC' };

function normalizeTeamAbbr(abbr) {
  const up = (abbr || '').toUpperCase();
  return ESPN_TO_SLEEPER[up] || up;
}

function getNflScheduleWeek() {
  const today = new Date().toISOString().slice(0, 10);
  const SEASON_START = '2026-09-09';
  if (today < SEASON_START) return 1;
  const ms = new Date(today) - new Date(SEASON_START);
  return Math.min(Math.max(Math.floor(ms / (7 * 86400000)) + 1, 1), 18);
}

function useScheduleOppMap() {
  const [map, setMap] = React.useState(new Map());
  React.useEffect(() => {
    const week = getNflScheduleWeek();
    const espnUrl = `https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?seasontype=2&week=${week}&dates=2026`;
    fetch(espnUrl, { signal: AbortSignal.timeout(12000) })
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (!data?.events?.length) return;
        const m = new Map();
        for (const ev of data.events) {
          const comps = (ev.competitions || [{}])[0];
          const game = {};
          for (const t of comps.competitors || []) {
            const abbr = normalizeTeamAbbr((t.team?.abbreviation || '').toUpperCase());
            game[t.homeAway] = abbr;
          }
          const home = game.home || '';
          const away = game.away || '';
          if (home && away) {
            m.set(home, away);
            m.set(away, `@${home}`);
          }
        }
        setMap(m);
      })
      .catch(() => {});
  }, []);
  return map;
}

// newsSignal / opportunityScore / successRate / explosiveRate / elusivenessScore mirror the
// same sub-groups shown in the Watchlist Sleepers/Breakout Candidates tables (Job 2 news score,
// breakout opportunity model, and nflverse-derived efficiency metrics) — kept in sync with
// POSITION_FEATURES / DEFAULT_WEIGHT_DIST in AccountEdit.jsx.
const DEFAULT_SCORING_WEIGHTS = {
  QB: [
    { key: 'proj', weight: 25 }, { key: 'avg', weight: 13 }, { key: 'ecr', weight: 17 },
    { key: 'adp', weight: 10 }, { key: 'last', weight: 10 }, { key: 'owned', weight: 10 },
    { key: 'newsSignal', weight: 5 }, { key: 'successRate', weight: 4 },
    { key: 'explosiveRate', weight: 3 }, { key: 'elusivenessScore', weight: 3 },
  ],
  RB: [
    { key: 'proj', weight: 18 }, { key: 'avg', weight: 13 }, { key: 'ecr', weight: 12 },
    { key: 'adp', weight: 10 }, { key: 'last', weight: 10 }, { key: 'targetShare', weight: 10 },
    { key: 'owned', weight: 10 }, { key: 'newsSignal', weight: 3 }, { key: 'opportunityScore', weight: 4 },
    { key: 'successRate', weight: 3 }, { key: 'explosiveRate', weight: 3 }, { key: 'elusivenessScore', weight: 4 },
  ],
  WR: [
    { key: 'proj', weight: 18 }, { key: 'avg', weight: 15 }, { key: 'ecr', weight: 13 },
    { key: 'adp', weight: 10 }, { key: 'last', weight: 10 }, { key: 'targetShare', weight: 10 },
    { key: 'owned', weight: 10 }, { key: 'newsSignal', weight: 3 }, { key: 'opportunityScore', weight: 4 },
    { key: 'successRate', weight: 3 }, { key: 'explosiveRate', weight: 4 },
  ],
  TE: [
    { key: 'proj', weight: 18 }, { key: 'avg', weight: 15 }, { key: 'ecr', weight: 13 },
    { key: 'adp', weight: 10 }, { key: 'last', weight: 10 }, { key: 'targetShare', weight: 10 },
    { key: 'owned', weight: 10 }, { key: 'newsSignal', weight: 3 }, { key: 'opportunityScore', weight: 4 },
    { key: 'successRate', weight: 3 }, { key: 'explosiveRate', weight: 4 },
  ],
  K: [
    { key: 'proj', weight: 40 }, { key: 'avg', weight: 30 }, { key: 'ecr', weight: 30 },
  ],
  DST: [
    { key: 'proj', weight: 35 }, { key: 'avg', weight: 30 }, { key: 'ecr', weight: 30 },
    { key: 'newsSignal', weight: 5 },
  ],
};

function loadScoringWeights() {
  return getPrefs().scoringWeights ?? DEFAULT_SCORING_WEIGHTS;
}

function computeSleeperScores(playerList, weights) {
  if (!weights) return {};
  // Group by position for per-position normalization
  const byPos = {};
  for (const p of playerList) {
    if (!byPos[p.pos]) byPos[p.pos] = [];
    byPos[p.pos].push(p);
  }
  // Compute min/max per feature per position
  const ranges = {};
  for (const [pos, players] of Object.entries(byPos)) {
    const posWeights = weights[pos];
    if (!posWeights) continue;
    ranges[pos] = {};
    for (const { key } of posWeights) {
      const vals = players.map(p => p[key] ?? 0);
      ranges[pos][key] = { min: Math.min(...vals), max: Math.max(...vals) };
    }
  }
  // Score each player
  const scores = {};
  for (const p of playerList) {
    const posWeights = weights[p.pos];
    if (!posWeights || !ranges[p.pos]) { scores[p.id] = 0; continue; }
    let total = 0;
    let totalWeight = 0;
    for (const { key, weight } of posWeights) {
      if (!weight) continue;
      const { min, max } = ranges[p.pos][key] || { min: 0, max: 1 };
      const span = max - min || 1;
      const raw = p[key] ?? 0;
      const norm = LOWER_IS_BETTER.has(key)
        ? (max - raw) / span
        : (raw - min) / span;
      total += norm * weight;
      totalWeight += weight;
    }
    scores[p.id] = totalWeight > 0 ? total / totalWeight : 0;
  }
  return scores;
}

function formatWaiverExpiry(isoStr) {
  const d   = new Date(isoStr);
  const now = new Date();
  const diffH = (d - now) / 3_600_000;
  if (diffH < 24) return `Tonight ${d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`;
  const tomorrow = new Date(now); tomorrow.setDate(tomorrow.getDate() + 1);
  if (d.toDateString() === tomorrow.toDateString()) return 'Tomorrow night';
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

// Build owner map — always re-syncs TEAM_ROSTERS from localStorage first
// so picks made in DraftRoom show up without requiring a page reload.
function buildOwnerMap() {
  refreshTeamRosters();
  const map = {};
  for (const [teamId, entries] of Object.entries(TEAM_ROSTERS)) {
    for (const entry of entries) {
      if (entry.playerId) map[Number(entry.playerId)] = Number(teamId);
    }
  }
  return map;
}

// ── Waiver helpers ────────────────────────────────────────────────────────────
const DEFAULT_WAIVER_ORDER = [...TEAMS_ORDER].reverse();

function isDraftComplete() {
  try {
    const picks = JSON.parse(localStorage.getItem('fantasai_live_picks') || 'null');
    if (!Array.isArray(picks) || picks.length === 0) return false;
    return picks.every(p => p.playerId != null);
  } catch { return false; }
}

function loadWaiverOrder() {
  try {
    const saved = JSON.parse(localStorage.getItem('fantasai_waiver_order') || 'null');
    if (Array.isArray(saved) && saved.length > 0) return saved;
  } catch {}
  return [...DEFAULT_WAIVER_ORDER];
}

function nextWaiverDate(processDay) {
  const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const idx = days.indexOf(processDay);
  if (idx < 0) return null;
  const today = new Date();
  const diff = ((idx - today.getDay()) + 7) % 7 || 7;
  const d = new Date(today);
  d.setDate(today.getDate() + diff);
  d.setHours(23, 59, 0, 0);
  return d;
}

function fmtWaiverDate(d) {
  if (!d) return 'TBD';
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }) + ' · 11:59 PM ET';
}

function WeatherBadge({ team, opp, scheduleOppMap }) {
  const { data: r2Weather } = useR2WeatherForecast();
  if (!r2Weather?.teams) return null;
  const schedOpp = scheduleOppMap?.get(team) || opp || '';
  const isAway = schedOpp.startsWith('@');
  const oppClean = schedOpp.replace(/^@/, '').toUpperCase();
  const homeTeam = isAway ? oppClean : (team || '').toUpperCase();
  if (!homeTeam) return null;
  const entry = r2Weather.teams[homeTeam];
  if (!entry) return null;
  if (entry.is_dome) return <div style={{ fontSize: 10, color: '#1affa0' }}>🏟️ Dome</div>;
  if (!entry.forecast?.length) return <span className="faint" style={{ fontSize: 10 }}>—</span>;
  const day = entry.forecast[0];
  const hour = day?.hourly?.find(h => h.time === '1300') || day?.hourly?.[0];
  if (!hour) return <span className="faint" style={{ fontSize: 10 }}>—</span>;
  const temp = Math.round(hour.temp_f || day.max_temp_f || 0);
  const wind = Math.round(hour.wind_mph || 0);
  const gust = Math.round(hour.wind_gust_mph || hour.gust_mph || 0);
  const precip = hour.precip_in || 0;
  const cond = (hour.condition || '').toLowerCase();
  const isSnow = cond.includes('snow') || cond.includes('blizzard');
  const isRain = precip > 0.05 || cond.includes('rain') || cond.includes('drizzle');
  const windColor = wind >= 20 ? 'var(--danger)' : wind >= 15 ? '#ff9800' : wind >= 10 ? '#ffd700' : 'var(--text)';
  const tempColor = temp >= 90 ? '#ff4f4f' : temp >= 75 ? '#ff9800' : temp >= 50 ? '#1affa0' : temp >= 32 ? '#7ecff5' : '#ffffff';
  return (
    <div style={{ fontSize: 11, fontFamily: 'var(--font-mono)', lineHeight: 1.5 }}>
      <span style={{ fontWeight: 700, color: tempColor }}>{temp}°</span>
      {' · '}
      <span style={{ color: windColor }}>{wind}mph</span>
      {isSnow && <div style={{ color: '#7ecff5', fontSize: 10 }}>❄ Snow</div>}
      {!isSnow && isRain && <div style={{ color: '#ffd700', fontSize: 10 }}>🌧 Rain</div>}
      {wind >= 20 && <div style={{ color: 'var(--danger)', fontSize: 10, fontWeight: 700 }}>⚠ Wind</div>}
      {gust >= 20 && <div style={{ color: 'var(--danger)', fontSize: 10 }}>💨 {gust}mph</div>}
    </div>
  );
}

// Numeric weather-impact score for a player's upcoming game, for sorting the
// Weather column. Mirrors WeatherBadge's own home-team resolution so the sort
// order matches what's actually displayed. Domes / no forecast data sort last.
const COVERAGE_SCHEME_LABELS = {
  MAN_COVERAGE: 'Man', ZONE_COVERAGE: 'Zone',
  COVER_0: 'Cover 0', COVER_1: 'Cover 1', COVER_2: 'Cover 2', COVER_3: 'Cover 3',
  COVER_4: 'Cover 4', COVER_6: 'Cover 6', COVER_9: 'Cover 9',
  '2_MAN': '2-Man', COMBO: 'Combo', BLOWN: 'Blown Coverage',
};
function formatCoverageScheme(value) {
  return COVERAGE_SCHEME_LABELS[value] || value;
}

function getWeatherSeverity(r2Weather, team, opp, scheduleOppMap) {
  if (!r2Weather?.teams) return -1;
  const schedOpp = scheduleOppMap?.get(team) || opp || '';
  const isAway = schedOpp.startsWith('@');
  const oppClean = schedOpp.replace(/^@/, '').toUpperCase();
  const homeTeam = isAway ? oppClean : (team || '').toUpperCase();
  if (!homeTeam) return -1;
  const entry = r2Weather.teams[homeTeam];
  if (!entry || entry.is_dome) return -1;
  const day = entry.forecast?.[0];
  const hour = day?.hourly?.find(h => h.time === '1300') || day?.hourly?.[0];
  if (!hour) return -1;
  const wind   = Number(hour.wind_mph || 0);
  const gust   = Number(hour.wind_gust_mph || hour.gust_mph || 0);
  const precip = Number(hour.precip_in || 0);
  return wind + gust * 0.5 + precip * 20;
}

// ── Column config ─────────────────────────────────────────────────────────────
const DEFAULT_COLUMNS = [
  { id: 'proj',      label: 'Proj',     visible: true,  sortKey: 'proj',         group: 'std' },
  { id: 'last',      label: 'Last',     visible: true,  sortKey: 'last',         group: 'std' },
  { id: 'avg',       label: 'Avg',      visible: true,  sortKey: 'avg',          group: 'std' },
  { id: 'trend',     label: 'Trend',    visible: true,  sortKey: 'trendAvg',     group: 'std' },
  { id: 'opp_score', label: 'Opp Sc',   visible: true,  sortKey: 'oppScore',     group: 'std' },
  { id: 'bye',       label: 'Bye',      visible: true,  sortKey: 'bye',          group: 'std' },
  { id: 'owned',     label: '%Own',     visible: true,  sortKey: 'owned',        group: 'std' },
  { id: 'adp',       label: 'ADP',      visible: true,  sortKey: 'adp',          group: 'std' },
  { id: 'ecr_rank',  label: 'Rank',     visible: true,  sortKey: 'rank',         group: 'std' },
  { id: 'depth',     label: 'Depth',    visible: true,  sortKey: 'depthOrder',   group: 'std' },
  { id: 'snaps',     label: 'Snaps/G',  visible: true,  sortKey: 'snapsG',       group: 'std' },
  { id: 'tgt',       label: 'Tgt%',     visible: false, sortKey: 'targetShare',  group: 'std' },
  { id: 'routes',    label: 'Routes',   visible: false, sortKey: 'routes',       group: 'std' },
  { id: 'yac',       label: 'YAC',      visible: false, sortKey: 'yac',          group: 'std' },
  { id: 'weather',   label: 'Weather',  visible: true,  sortKey: 'weatherSeverity', group: 'std' },
  // Advanced stats (from Sleeper wks 14-17, 2025 season)
  { id: 'snap_pct',  label: 'Snap%',    visible: false, sortKey: 'snapPct',  group: 'adv' },
  { id: 'tgt_g',     label: 'Tgt/G',    visible: false, sortKey: 'tgtG',     group: 'adv' },
  { id: 'adot',      label: 'ADOT',     visible: false, sortKey: 'adot',     group: 'adv' },
  { id: 'air_yds',   label: 'Air Yds',  visible: false, sortKey: 'airYds',   group: 'adv' },
  { id: 'att_g',     label: 'Att/G',    visible: false, sortKey: 'attG',     group: 'adv' },
  { id: 'yptgt',     label: 'Yds/Tgt',  visible: false, sortKey: 'yptgt',    group: 'adv' },
  { id: 'combo',     label: 'Combo Yds',visible: false, sortKey: 'combo',    group: 'adv' },
  { id: 'rz_att',    label: 'RZ Att/G', visible: false, sortKey: 'avgRzAttG', group: 'adv' },
  // Combine measurables
  { id: 'forty',     label: '40-Yd',    visible: false, sortKey: 'forty',    group: 'combine' },
  { id: 'vertical',  label: 'Vert',     visible: false, sortKey: 'vertical', group: 'combine' },
  { id: 'broad',     label: 'Broad',    visible: false, sortKey: 'broadJump',group: 'combine' },
  { id: 'bench',     label: 'Bench',    visible: false, sortKey: 'benchPress',group: 'combine' },
];

function loadColumns() {
  try {
    const saved = getPrefs().columns;
    if (!Array.isArray(saved)) return DEFAULT_COLUMNS.map(c => ({ ...c }));
    const savedIds = new Set(saved.map(c => c.id));
    const merged = [
      ...saved.map(c => { const def = DEFAULT_COLUMNS.find(d => d.id === c.id); return def ? { ...def, visible: c.visible } : null; }).filter(Boolean),
      ...DEFAULT_COLUMNS.filter(c => !savedIds.has(c.id)),
    ];
    return merged;
  } catch { return DEFAULT_COLUMNS.map(c => ({ ...c })); }
}

export default function PlayersScreen({ onOpenPlayer, aiMode, myRosterIds = new Set(), onAddPlayer, onDropPlayer, onClaimPlayer, onTradePlayer, user, watchlistIds = new Set(), onToggleWatch, waiverQueue = {}, playersTab = 'players', onPlayersTabChange, showMobile = false }) {
  const isMobile = showMobile;
  const _addFilter = (() => { try { const f = localStorage.getItem('fantasai_add_filter'); if (f) { localStorage.removeItem('fantasai_add_filter'); return f; } } catch {} return null; })();
  const [pos, setPos] = React.useState(_addFilter ?? 'ALL');
  const [search, setSearch] = React.useState('');
  const [sort, setSort] = React.useState('rank');
  const [avail, setAvail] = React.useState(_addFilter ? 'available' : 'all');
  const [useSleeperSort, setUseSleeperSort] = React.useState(false);
  const [breakoutOnly, setBreakoutOnly] = React.useState(false);

  // ── Custom Rankings (sort dropdown) ─────────────────────────────────────────
  const [customRankings, setCustomRankings] = React.useState(() => getPrefs().customRankings || []);
  const [activeRankingId, setActiveRankingId] = React.useState(null);

  // ── Column customization ──────────────────────────────────────────────────
  const [columns, setColumns] = React.useState(loadColumns);
  const [showColPicker, setShowColPicker] = React.useState(false);
  const [draggedColId, setDraggedColId]   = React.useState(null);
  const [dragOverColId, setDragOverColId] = React.useState(null);

  // ── Waiver claim state ────────────────────────────────────────────────────
  const draftDone = React.useMemo(() => isDraftComplete(), []);
  const [waiverOrder, setWaiverOrder] = React.useState(loadWaiverOrder);
  const [waiverOrderOpen, setWaiverOrderOpen] = React.useState(false);
  const [claimQueue, setClaimQueue] = React.useState(() => {
    try { return JSON.parse(localStorage.getItem('fantasai_waiver_queue') || '[]'); } catch { return []; }
  });
  const [claimPlayer, setClaimPlayer] = React.useState(null);
  const [claimDrop, setClaimDrop]     = React.useState(null);
  const [claimQueueOpen, setClaimQueueOpen] = React.useState(true);
  const [addSuccess, setAddSuccess]   = React.useState(null);
  // Count open slots using live-store resolution only. assignRoster falls back to the
  // static PLAYERS array via _findPlayerLocal, so ghost IDs from an old session would
  // fill slots invisibly. Counting only IDs that findPlayer() resolves gives the true
  // number of live players on the roster vs total frame capacity.
  const _rosterFrame = React.useMemo(() => {
    try { return buildRosterFrame(JSON.parse(localStorage.getItem('fantasai_league_settings') || 'null')); }
    catch { return buildRosterFrame(null); }
  }, []);
  const liveRosterCount = React.useMemo(
    () => [...myRosterIds].filter(id => findPlayer(id) != null).length,
    [myRosterIds],
  );
  const openSlots = Math.max(0, _rosterFrame.length - liveRosterCount);

  React.useEffect(() => {
    localStorage.setItem('fantasai_waiver_queue', JSON.stringify(claimQueue));
  }, [claimQueue]);

  const settings = React.useMemo(() => {
    try { return JSON.parse(localStorage.getItem('fantasai_league_settings') || 'null'); } catch { return null; }
  }, []);
  const teamId           = user?.teamId || 1;
  const myPriorityIdx    = waiverOrder.indexOf(teamId);
  const myWaiverPriority = myPriorityIdx >= 0 ? myPriorityIdx + 1 : waiverOrder.length + 1;
  const waiverDays       = settings?.waiverRules?.days || ['Wednesday'];
  const processDay       = waiverDays[waiverDays.length - 1] || 'Wednesday';
  const currentWeek      = settings?.currentWeek || 11;
  const nextRun          = React.useMemo(() => nextWaiverDate(processDay), [processDay]);
  const myClaimQueue     = claimQueue.filter(q => q.teamId === teamId);
  const claimCountByPlayer = React.useMemo(() => {
    const counts = {};
    for (const c of claimQueue) counts[c.addId] = (counts[c.addId] || 0) + 1;
    return counts;
  }, [claimQueue]);

  const sleeperWeights = React.useMemo(() => loadScoringWeights(), []);

  const scheduleOppMap = useScheduleOppMap();

  const { data: r2DefenseData } = useR2DefensePerformance();
  const { data: r2DefVsPos } = useR2DefenseVsPos();
  const { data: r2RookieScoresData } = useR2RookieScores();
  // rookieScoreMap: player_name (lower) → { rookie_score, proj_week_pts, draft_capital_score, athleticism_score, opportunity_score, draft_ovr, draft_round }
  const rookieScoreMap = React.useMemo(() => {
    const arr = r2RookieScoresData?.players || [];
    const m = new Map();
    for (const r of arr) {
      if (r.player_name) m.set(r.player_name.toLowerCase().trim(), r);
    }
    return m;
  }, [r2RookieScoresData]);
  // defVsPosIndex: Map of "TEAM|POS" → rank_vs_pos (1=toughest, 32=easiest)
  const defVsPosIndex = React.useMemo(() => {
    const arr = r2DefVsPos?.data || [];
    const m = new Map();
    for (const row of arr) {
      if (row.def_team && row.position)
        m.set(`${row.def_team.toUpperCase()}|${row.position}`, row.rank_vs_pos);
    }
    return m;
  }, [r2DefVsPos]);
  const defRankByTeam = React.useMemo(() => {
    const arr = r2DefenseData?.data || (Array.isArray(r2DefenseData) ? r2DefenseData : []);
    if (!arr.length) return {};
    const latestByTeam = {};
    for (const row of arr) {
      const t = row.team;
      if (t && (!latestByTeam[t] || (row.week || 0) > (latestByTeam[t].week || 0)))
        latestByTeam[t] = row;
    }
    const sorted = Object.values(latestByTeam)
      .sort((a, b) => (b.avg_last_4_weeks || 0) - (a.avg_last_4_weeks || 0));
    const ranks = {};
    sorted.forEach((row, i) => { ranks[row.team] = i + 1; });
    return ranks;
  }, [r2DefenseData]);

  // Also needed at table level (not just inside WeatherBadge) so the Weather column can be sorted.
  const { data: r2WeatherForSort } = useR2WeatherForecast();

  const { data: r2Breakouts } = useR2BreakoutCandidates();
  const breakoutSet = React.useMemo(() => {
    const s = new Map(); // player_name (lower) → { snap_share_delta, opportunity_score }
    const arr = Array.isArray(r2Breakouts) ? r2Breakouts : [];
    for (const b of arr) {
      if (b.player_name) s.set(b.player_name.toLowerCase().trim(), b);
    }
    return s;
  }, [r2Breakouts]);

  // Sleeper Slider weights below can weight by "News/Sleeper Signal" and "Opportunity Score" —
  // same sub-scores shown in the Watchlist Sleepers table (Job 2 news score + breakout opportunity model).
  const { data: r2Sleepers } = useR2SleeperPicks();
  const sleeperByName = React.useMemo(() => {
    const s = new Map();
    const arr = Array.isArray(r2Sleepers) ? r2Sleepers : [];
    for (const row of arr) {
      if (row.player_name) s.set(row.player_name.toLowerCase().trim(), row);
    }
    return s;
  }, [r2Sleepers]);

  // Global player store — seeds from static data, replaced with live Databricks/Sleeper on startup
  const apiPlayerList = usePlayers();

  // Some watched IDs may no longer resolve to a real player (stale ID from a
  // prior data snapshot) — count only what the Watchlist tab will actually show,
  // so the badge doesn't overcount vs what's visible.
  const resolvableWatchCount = React.useMemo(
    () => [...watchlistIds].filter(id => findPlayer(id)).length,
    [watchlistIds, apiPlayerList]
  );

  // R2 injury overlay — injury status + depth chart from R2 injury_overlay export
  const { data: r2InjuryData } = useR2Injuries();
  const { data: r2Notes } = useR2PlayerNotes();

  // Index R2 injury data by name and by Sleeper player_id for fast lookup
  const r2InjuryIndex = React.useMemo(() => {
    const byName = {};
    const byId   = {};
    const arr = Array.isArray(r2InjuryData) ? r2InjuryData : [];
    for (const r of arr) {
      if (r.player_name) byName[r.player_name.toLowerCase().trim()] = r;
      if (r.player_id)   byId[String(r.player_id)] = r;
    }
    return { byName, byId };
  }, [r2InjuryData]);

  // ── Free Agent Buzz Feed — Sleeper trending adds ──────────────────────────
  const [trendingPlayers, setTrendingPlayers] = React.useState([]);
  const [showBuzzFeed, setShowBuzzFeed] = React.useState(true);
  React.useEffect(() => {
    getTrending('add', 24, 20).then(items => {
      if (!Array.isArray(items) || !items.length) return;
      const resolved = items
        .map(item => {
          // Sleeper trending uses player_id (string), count
          const pid = item.player_id ? String(item.player_id) : null;
          if (!pid) return null;
          // Find by sleeperId in the player store
          const p = apiPlayerList.find(pl => String(pl.sleeperId) === pid || String(pl.id) === pid);
          return p ? { ...p, buzzCount: item.count } : null;
        })
        .filter(Boolean);
      if (resolved.length > 0) setTrendingPlayers(resolved);
    }).catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiPlayerList.length]);

  // Index player_notes by name for news overlay
  const r2NotesIndex = React.useMemo(() => {
    const byName = {};
    const arr = Array.isArray(r2Notes) ? r2Notes : [];
    for (const n of arr) {
      if (n.player_name) byName[n.player_name.toLowerCase().trim()] = n;
    }
    return byName;
  }, [r2Notes]);

  // Merge R2 injury overlay into the player list when it arrives.
  // R2 has more current injury_status + depth_chart_order than Databricks bronze table.
  const allPlayersList = React.useMemo(() => {
    if (!r2InjuryData && !r2Notes && !sleeperByName.size && !breakoutSet.size) return apiPlayerList;
    return apiPlayerList.map(p => {
      const nameKey = p.name.toLowerCase().trim();
      const r2 = r2InjuryIndex.byName[nameKey]
               || (p.sleeperId ? r2InjuryIndex.byId[String(p.sleeperId)] : null);
      const note = r2NotesIndex[nameKey];
      const injSt = r2?.injury_status;
      const updates = {};
      // Sleeper Slider inputs — same fields Watchlist's Sleepers sub-groups use
      const sleeperRow = sleeperByName.get(nameKey);
      if (sleeperRow?.news_score != null) updates.newsSignal = Number(sleeperRow.news_score);
      const breakoutRow = breakoutSet.get(nameKey);
      if (typeof breakoutRow?.opportunity_score === 'number') updates.opportunityScore = breakoutRow.opportunity_score;
      if (typeof breakoutRow?.success_rate === 'number') updates.successRate = breakoutRow.success_rate;
      // Explosive-play rate is rushing for QB/RB, receiving for WR/TE — same nflverse
      // play-by-play source (player_efficiency_stats), just the position-relevant half.
      const explosive = (p.pos === 'QB' || p.pos === 'RB') ? breakoutRow?.explosive_run_rate : breakoutRow?.explosive_rec_rate;
      if (typeof explosive === 'number') updates.explosiveRate = explosive;
      if (typeof breakoutRow?.elusiveness_score === 'number') updates.elusivenessScore = breakoutRow.elusiveness_score;
      if (injSt) {
        updates.status = injSt === 'Questionable' ? 'Q'
                       : injSt === 'Doubtful'     ? 'D'
                       : injSt === 'Out'           ? 'Out'
                       : injSt === 'IR' || injSt === 'Injured_Reserve' ? 'IR'
                       : p.status;
        if (r2.injury_notes) updates.injuryNotes = r2.injury_notes;
      }
      if (r2?.depth_chart_order != null) updates.depthChartOrder = r2.depth_chart_order;
      if (r2?.depth_chart_position)      updates.depthChartPos   = r2.depth_chart_position;
      const noteNotes = Array.isArray(note?.notes) ? note.notes
        : typeof note?.notes === 'string' ? (() => { try { return JSON.parse(note.notes); } catch { return []; } })()
        : [];
      if (noteNotes.length) {
        const topNote = noteNotes[0];
        updates.news = topNote.note_text ? topNote.note_text.slice(0, 100) : p.news;
        updates.hasCriticalNews   = note.has_critical_news   || false;
        updates.hasInjuryConcern  = note.has_injury_concern  || false;
        updates.overallImpact     = note.overall_impact_score ?? null;
      }
      return Object.keys(updates).length ? { ...p, ...updates } : p;
    });
  }, [apiPlayerList, r2InjuryData, r2Notes, r2InjuryIndex, r2NotesIndex, sleeperByName, breakoutSet]);

  const sleeperScores  = React.useMemo(
    () => useSleeperSort ? computeSleeperScores(allPlayersList, sleeperWeights) : {},
    [useSleeperSort, sleeperWeights, allPlayersList],
  );
  const [selected, setSelected] = React.useState(null);
  const [depthData,  setDepthData]  = React.useState({});
  const [snapsData,  setSnapsData]  = React.useState({});
  const [injuryData, setInjuryData] = React.useState({});
  const [sleeperStats, setSleeperStats] = React.useState({}); // { [name]: { last, avg, trend, bye } }

  React.useEffect(() => {
    let cancelled = false;
    async function loadDepthAndSnaps() {
      try {
        // Weeks 13-18: trend window. Weeks 14-17 are best for snaps (18 = rest week).
        const TREND_WEEKS = [13, 14, 15, 16, 17, 18];
        const [map, ...weekStatsArr] = await Promise.all([
          getPlayerMap(),
          ...TREND_WEEKS.map(w => fetchBulkWeekStats(2025, w)),
        ]);
        if (cancelled) return;
        const depths  = {};
        const snaps   = {};
        const injuries = {};
        const stats   = {};
        for (const [sid, p] of Object.entries(map)) {
          if (!p.full_name && !p.first_name) continue;
          const name = (p.full_name || `${p.first_name} ${p.last_name}`).toLowerCase().trim();
          if (p.depth_chart_order && p.depth_chart_position) {
            depths[name] = `${p.depth_chart_position}${p.depth_chart_order}`;
          }
          // Snaps: average weeks 14-17 (indices 1-4 in TREND_WEEKS)
          let totalSnps = 0, wkCount = 0;
          for (let i = 1; i <= 4; i++) {
            const weekStats = weekStatsArr[i];
            if (!weekStats) continue;
            const s = weekStats[sid];
            const snpVal = s?.off_snp ?? s?.snp;
            if (snpVal != null && snpVal > 0) { totalSnps += snpVal; wkCount++; }
          }
          if (wkCount > 0) snaps[name] = Math.round(totalSnps / wkCount);
          if (p.injury_status && p.injury_status !== 'Na') {
            injuries[name] = {
              status:   p.injury_status,
              bodyPart: p.injury_body_part  || null,
              notes:    p.injury_notes      || null,
            };
          }
          // Advanced stats: average over weeks 14-17 (indices 1-4 in TREND_WEEKS)
          let spSum = 0, spWks = 0, adotSum = 0, adotWks = 0;
          let airSum = 0, tgtSum = 0, recYdsSum = 0, attSum = 0, rushYdsSum = 0, advWks = 0;
          for (let i = 1; i <= 4; i++) {
            const ws = weekStatsArr[i]?.[sid];
            if (!ws) continue;
            advWks++;
            const offSnp = ws.off_snp ?? ws.snp ?? 0;
            const tmSnp  = ws.tm_off_snp ?? 0;
            if (offSnp > 0 && tmSnp > 0) { spSum += (offSnp / tmSnp) * 100; spWks++; }
            if ((ws.adot ?? 0) > 0) { adotSum += ws.adot; adotWks++; }
            airSum    += ws.rec_air_yds ?? 0;
            tgtSum    += ws.rec_tgt     ?? 0;
            recYdsSum += ws.rec_yds     ?? 0;
            attSum    += ws.rush_att    ?? 0;
            rushYdsSum += ws.rush_yds   ?? 0;
          }
          const advStats = {
            snapPct: spWks   > 0 ? Math.round(spSum / spWks) : null,
            adot:    adotWks > 0 ? Math.round((adotSum / adotWks) * 10) / 10 : null,
            airYds:  advWks  > 0 && airSum  > 0 ? Math.round((airSum  / advWks) * 10) / 10 : null,
            tgtG:    advWks  > 0 && tgtSum  > 0 ? Math.round((tgtSum  / advWks) * 10) / 10 : null,
            attG:    advWks  > 0 && attSum  > 0 ? Math.round((attSum  / advWks) * 10) / 10 : null,
            yptgt:   tgtSum  > 0               ? Math.round((recYdsSum / tgtSum) * 10) / 10 : null,
            combo:   advWks  > 0 && (recYdsSum + rushYdsSum) > 0
              ? Math.round(((recYdsSum + rushYdsSum) / advWks) * 10) / 10 : null,
          };
          // Pts trend for weeks 13-18
          const trendPts = weekStatsArr.map(wk => {
            if (!wk) return 0;
            const s = wk[sid];
            return s?.pts_half_ppr != null ? Math.round(s.pts_half_ppr * 10) / 10 : 0;
          });
          const nonZero = trendPts.filter(v => v > 0);
          if (nonZero.length > 0) {
            // last: most recent non-zero week (prefer wk17 over wk18 for accuracy)
            const lastVal = trendPts[4] > 0 ? trendPts[4] : trendPts[5] > 0 ? trendPts[5] : nonZero[nonZero.length - 1];
            const avgVal  = Math.round((nonZero.reduce((s, v) => s + v, 0) / nonZero.length) * 10) / 10;
            stats[name] = { last: lastVal, avg: avgVal, trend: trendPts, bye: p.bye_week ?? 0, ...advStats };
          } else if (p.bye_week || advWks > 0) {
            stats[name] = { last: null, avg: null, trend: [], bye: p.bye_week ?? 0, ...advStats };
          }
        }
        setDepthData(depths);
        setSnapsData(snaps);
        setInjuryData(injuries);
        setSleeperStats(stats);
      } catch {
        // Sleeper unavailable — columns fall back to R2 data
      }
    }
    loadDepthAndSnaps();
    return () => { cancelled = true; };
  }, []);

  // Rebuild every render — TEAM_ROSTERS is mutated in-place by refreshTeamRosters()
  // after the draft completes, and players re-renders when the player list updates.
  const PLAYER_OWNER_MAP = React.useMemo(() => buildOwnerMap(), [allPlayersList]);

  // Read drafted player IDs from all localStorage pick keys (live, completed mock, WIP mock).
  const draftedIds = React.useMemo(() => {
    try {
      const live  = JSON.parse(localStorage.getItem('fantasai_live_picks')       || 'null');
      const mock  = JSON.parse(localStorage.getItem('fantasai_mock_picks_saved') || 'null');
      const wip   = JSON.parse(localStorage.getItem('fantasai_mock_picks_wip')   || 'null');
      const liveCount = Array.isArray(live)  ? live.filter(p => p.playerId).length  : 0;
      const mockCount = Array.isArray(mock)  ? mock.filter(p => p.playerId).length  : 0;
      const wipCount  = Array.isArray(wip)   ? wip.filter(p => p.playerId).length   : 0;
      let picks;
      if (liveCount >= mockCount && liveCount >= wipCount) picks = live;
      else if (mockCount >= wipCount) picks = mock;
      else picks = wip;
      return new Set((picks || []).filter(p => p.playerId).map(p => Number(p.playerId)));
    } catch { return new Set(); }
  }, [allPlayersList]);

  const now = new Date();
  const activeWaivers = new Set(
    Object.entries(waiverQueue)
      .filter(([, v]) => new Date(v.expiresAt) > now)
      .map(([id]) => Number(id))
  );

  // Merge Sleeper stats (last/avg/trend/bye) into each player as fallback for missing R2 data
  const allPlayersList2 = React.useMemo(() => {
    if (Object.keys(sleeperStats).length === 0) return allPlayersList;
    return allPlayersList.map(p => {
      const sl = sleeperStats[p.name.toLowerCase().trim()];
      if (!sl) return p;
      return {
        ...p,
        last:    p.last  > 0 ? p.last  : (sl.last  ?? 0),
        avg:     p.avg   > 0 ? p.avg   : (sl.avg   ?? 0),
        trend:   p.trend?.length > 0 ? p.trend : (sl.trend ?? []),
        bye:     p.bye   > 0 ? p.bye   : (sl.bye   ?? 0),
        snapPct: p.snapPct ?? sl.snapPct ?? null,
        adot:    p.adot    ?? sl.adot    ?? null,
        airYds:  p.airYds  ?? sl.airYds  ?? null,
        tgtG:    p.tgtG    ?? sl.tgtG    ?? null,
        attG:    p.attG    ?? sl.attG    ?? null,
        yptgt:   p.yptgt   ?? sl.yptgt   ?? null,
        combo:   p.combo   ?? sl.combo   ?? null,
      };
    });
  }, [allPlayersList, sleeperStats]);

  let players = allPlayersList2.filter(p => {
    if (pos === 'FLEX'   && !['RB', 'WR'].includes(p.pos)) return false;
    if (pos === 'ROOKIE' && !p.rookie) return false;
    if (pos !== 'ALL' && pos !== 'FLEX' && pos !== 'ROOKIE' && p.pos !== pos) return false;
    if (search && !p.name.toLowerCase().includes(search.toLowerCase())) return false;
    if (avail === 'free' && (draftedIds.has(p.id) || activeWaivers.has(p.id) || PLAYER_OWNER_MAP[p.id] != null || myRosterIds.has(p.id))) return false;
    if (avail === 'waivers' && !activeWaivers.has(p.id)) return false;
    if (avail === 'rostered' && !draftedIds.has(p.id) && !myRosterIds.has(p.id) && PLAYER_OWNER_MAP[p.id] == null) return false;
    if (breakoutOnly && !breakoutSet.has(p.name.toLowerCase().trim())) return false;
    return true;
  });

  const activeRanking = customRankings.find(r => r.id === activeRankingId) ?? null;
  const customRankMap = React.useMemo(() => {
    if (!activeRanking) return null;
    const m = new Map();
    for (const p of activeRanking.players) m.set(p.name.toLowerCase().trim(), p.rank);
    return m;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeRankingId, customRankings]);

  if (useSleeperSort) {
    players.sort((a, b) => (sleeperScores[b.id] ?? 0) - (sleeperScores[a.id] ?? 0));
  } else if (sort === 'custom' && customRankMap) {
    players.sort((a, b) => {
      const ra = customRankMap.get(a.name.toLowerCase().trim()) ?? Infinity;
      const rb = customRankMap.get(b.name.toLowerCase().trim()) ?? Infinity;
      return ra - rb;
    });
  } else {
    players.sort((a, b) => {
      if (sort === 'proj')        return b.proj - a.proj;
      if (sort === 'last')        return b.last - a.last;
      if (sort === 'avg')         return b.avg - a.avg;
      if (sort === 'owned')       return b.owned - a.owned;
      if (sort === 'adp') {
        // DST and K are not in ADP rankings — always push to the bottom
        const SKILL = new Set(['QB', 'RB', 'WR', 'TE']);
        const aSkill = SKILL.has(a.pos), bSkill = SKILL.has(b.pos);
        if (aSkill !== bSkill) return aSkill ? -1 : 1;
        // For unranked players (adp=999) fall back to ECR so alphabetical insertion order
        // never accidentally puts an unranked player (e.g. Aaron Bailey) at the top.
        const aVal = a.adp < 999 ? a.adp : (a.ecr < 999 ? a.ecr : 9999);
        const bVal = b.adp < 999 ? b.adp : (b.ecr < 999 ? b.ecr : 9999);
        return aVal - bVal;
      }
      if (sort === 'rank') {
        // Push K and DST after skill positions — matches ADP sort behavior.
        // Within same tier, sort by FantasyPros overall ECR (or 999 if unranked).
        const MAIN = new Set(['QB', 'RB', 'WR', 'TE']);
        const aMain = MAIN.has(a.pos), bMain = MAIN.has(b.pos);
        if (aMain !== bMain) return aMain ? -1 : 1;
        return (a.ecr || 999) - (b.ecr || 999);
      }
      if (sort === 'targetShare') return b.targetShare - a.targetShare;
      if (sort === 'routes')      return b.routes - a.routes;
      if (sort === 'yac')         return b.yac - a.yac;
      if (sort === 'snapPct')     return (b.snapPct ?? -1) - (a.snapPct ?? -1);
      if (sort === 'tgtG')        return (b.tgtG    ?? -1) - (a.tgtG    ?? -1);
      if (sort === 'adot')        return (b.adot    ?? -1) - (a.adot    ?? -1);
      if (sort === 'airYds')      return (b.airYds  ?? -1) - (a.airYds  ?? -1);
      if (sort === 'attG')        return (b.attG    ?? -1) - (a.attG    ?? -1);
      if (sort === 'yptgt')       return (b.yptgt   ?? -1) - (a.yptgt   ?? -1);
      if (sort === 'combo')       return (b.combo   ?? -1) - (a.combo   ?? -1);
      if (sort === 'avgRzAttG')   return (b.avgRzAttG ?? -1) - (a.avgRzAttG ?? -1);
      if (sort === 'forty')       return (a.forty   ?? 99) - (b.forty   ?? 99);
      if (sort === 'vertical')    return (b.vertical ?? -1) - (a.vertical ?? -1);
      if (sort === 'broadJump')   return (b.broadJump ?? -1) - (a.broadJump ?? -1);
      if (sort === 'benchPress')  return (b.benchPress ?? -1) - (a.benchPress ?? -1);
      if (sort === 'name')        return a.name.localeCompare(b.name);
      if (sort === 'oppScore') {
        const as = breakoutSet.get(a.name.toLowerCase().trim())?.opportunity_score ?? -1;
        const bs = breakoutSet.get(b.name.toLowerCase().trim())?.opportunity_score ?? -1;
        return bs - as;
      }
      if (sort === 'trendAvg') {
        const aAvg = a.trend?.length ? a.trend.reduce((s, v) => s + v, 0) / a.trend.length : -1;
        const bAvg = b.trend?.length ? b.trend.reduce((s, v) => s + v, 0) / b.trend.length : -1;
        return bAvg - aAvg;
      }
      if (sort === 'depthOrder') {
        // Lower depth chart order = higher on the depth chart = "better". R2 order takes
        // priority; fall back to parsing the trailing digit off the Sleeper depth label (e.g. "RB2" -> 2).
        const parseFallback = key => {
          const label = depthData[key];
          const m = typeof label === 'string' ? label.match(/(\d+)$/) : null;
          return m ? Number(m[1]) : null;
        };
        const aOrder = a.depthChartOrder ?? parseFallback(a.name.toLowerCase().trim());
        const bOrder = b.depthChartOrder ?? parseFallback(b.name.toLowerCase().trim());
        return (aOrder ?? 999) - (bOrder ?? 999);
      }
      if (sort === 'snapsG') {
        const av = a.snaps ?? snapsData[a.name.toLowerCase().trim()] ?? -1;
        const bv = b.snaps ?? snapsData[b.name.toLowerCase().trim()] ?? -1;
        return bv - av;
      }
      if (sort === 'weatherSeverity') {
        const av = getWeatherSeverity(r2WeatherForSort, a.team, a.opp, scheduleOppMap);
        const bv = getWeatherSeverity(r2WeatherForSort, b.team, b.opp, scheduleOppMap);
        return bv - av;
      }
      if (sort === 'efficiencyScore') {
        const as = breakoutSet.get(a.name.toLowerCase().trim())?.efficiency_score ?? -1;
        const bs = breakoutSet.get(b.name.toLowerCase().trim())?.efficiency_score ?? -1;
        return bs - as;
      }
      if (sort === 'epaPerOpportunity') {
        const as = breakoutSet.get(a.name.toLowerCase().trim())?.epa_per_opportunity ?? -999;
        const bs = breakoutSet.get(b.name.toLowerCase().trim())?.epa_per_opportunity ?? -999;
        return bs - as;
      }
      return 0;
    });
  }

  // ── Custom ranking helpers ───────────────────────────────────────────────────
  function saveCustomRanking(ranking) {
    const updated = [...customRankings.filter(r => r.id !== ranking.id), ranking];
    setCustomRankings(updated);
    patchPrefs({ customRankings: updated });
    setActiveRankingId(ranking.id);
    setSort('custom');
  }

  function deleteCustomRanking(id) {
    const updated = customRankings.filter(r => r.id !== id);
    setCustomRankings(updated);
    patchPrefs({ customRankings: updated });
    if (activeRankingId === id) { setActiveRankingId(null); setSort('proj'); }
  }

  // ── Column helpers ────────────────────────────────────────────────────────
  function saveColumns(cols) {
    setColumns(cols);
    patchPrefs({ columns: cols });
  }
  function toggleColumn(id) {
    saveColumns(columns.map(c => c.id === id ? { ...c, visible: !c.visible } : c));
  }
  function moveColumn(id, dir) {
    const idx = columns.findIndex(c => c.id === id);
    if (idx < 0) return;
    const newIdx = idx + dir;
    if (newIdx < 0 || newIdx >= columns.length) return;
    const next = [...columns];
    [next[idx], next[newIdx]] = [next[newIdx], next[idx]];
    saveColumns(next);
  }
  function moveColumnTo(fromId, toId) {
    if (!fromId || !toId || fromId === toId) return;
    const fromIdx = columns.findIndex(c => c.id === fromId);
    const toIdx   = columns.findIndex(c => c.id === toId);
    if (fromIdx < 0 || toIdx < 0) return;
    const next = [...columns];
    const [moved] = next.splice(fromIdx, 1);
    next.splice(toIdx, 0, moved);
    saveColumns(next);
  }
  // Keep standard cols in user-defined order; always group adv cols together at the end
  const visibleCols = [
    ...columns.filter(c => c.visible && c.group !== 'adv' && (c.id !== 'opp_score' || breakoutOnly)),
    ...columns.filter(c => c.visible && c.group === 'adv'),
  ];

  // ── Waiver claim helpers ──────────────────────────────────────────────────
  function openClaim(player) { setClaimPlayer(player); setClaimDrop(null); }

  function submitClaim() {
    if (!claimPlayer) return;
    if (!draftDone && openSlots <= 0 && !claimDrop) return; // roster full, drop required
    if (!draftDone) {
      if (onClaimPlayer) {
        onClaimPlayer(claimPlayer.id, claimDrop || null);
      } else {
        if (claimDrop) onDropPlayer?.(claimDrop);
        onAddPlayer?.(claimPlayer.id);
      }
      setAddSuccess(claimPlayer.name);
      setTimeout(() => setAddSuccess(null), 3000);
    } else {
      setClaimQueue(prev => [...prev, {
        id:          Date.now(),
        teamId,
        addId:       claimPlayer.id,
        dropId:      claimDrop || null,
        priority:    myWaiverPriority,
        waiverNum:   currentWeek,
        submittedAt: new Date().toISOString(),
      }]);
    }
    setClaimPlayer(null);
    setClaimDrop(null);
  }

  function removeClaim(claimId) {
    setClaimQueue(prev => prev.filter(c => c.id !== claimId));
  }

  return (
    <div style={{ display: 'flex', height: '100%', overflow: 'hidden' }}>
    <div className="col" style={{ flex: 1, minWidth: 0, overflow: 'hidden', height: '100%' }}>
      <div className="page-head">
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div>
            <h1>Players</h1>
            <div className="sub">
              {`${players.length} of ${allPlayersList.length} · `}
              {isLiveData() ? '2026 Players' : 'Static seed'}
            </div>
          </div>
          {draftDone && !isMobile && (
            <div style={{ position: 'relative' }}>
              <div
                onClick={() => setWaiverOrderOpen(o => !o)}
                title={`Next waiver run: ${fmtWaiverDate(nextWaiverDate(processDay))} · click for full order`}
                style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 10px', borderRadius: 8, background: waiverOrderOpen ? 'rgba(198,255,58,.16)' : 'rgba(198,255,58,.08)', border: '1px solid rgba(198,255,58,.35)', cursor: 'pointer' }}
              >
                <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 900, fontSize: 15, color: 'var(--accent)', lineHeight: 1 }}>#{myWaiverPriority}</span>
                <span style={{ fontSize: 10, color: 'var(--text-dim)' }}>of {waiverOrder.length} waiver priority</span>
                {myWaiverPriority === 1 && <span style={{ fontSize: 9, background: 'rgba(198,255,58,.2)', color: 'var(--accent)', borderRadius: 4, padding: '1px 5px', fontWeight: 700 }}>FIRST PICK</span>}
                <span style={{ fontSize: 9, color: 'var(--text-faint)' }}>{waiverOrderOpen ? '▲' : '▼'}</span>
              </div>
              {waiverOrderOpen && (
                <div style={{ position: 'absolute', top: '100%', left: 0, marginTop: 4, zIndex: 50, background: 'var(--panel)', border: '1px solid var(--border-strong)', borderRadius: 10, padding: '8px 4px', minWidth: 170, boxShadow: '0 12px 30px rgba(0,0,0,.5)' }}>
                  <div style={{ fontSize: 9, fontWeight: 800, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '.08em', padding: '2px 10px 6px' }}>Waiver Order</div>
                  {waiverOrder.map((tid, i) => {
                    const t = findTeam(tid);
                    const isMe = tid === (user?.teamId ?? null);
                    return (
                      <div key={tid} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 10px', borderRadius: 6, background: isMe ? 'rgba(198,255,58,.12)' : 'transparent' }}>
                        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-faint)', width: 16, flexShrink: 0 }}>{i + 1}.</span>
                        <span style={{ fontSize: 12, fontWeight: isMe ? 700 : 500, color: isMe ? 'var(--accent)' : 'var(--text)' }}>{t?.logo || t?.name || `Team ${tid}`}</span>
                        {isMe && <span style={{ marginLeft: 'auto', fontSize: 9, color: 'var(--accent)', fontWeight: 700 }}>YOU</span>}
                      </div>
                    );
                  })}
                  <div style={{ fontSize: 10, color: 'var(--text-faint)', padding: '6px 10px 2px', borderTop: '1px solid var(--border)', marginTop: 4 }}>
                    Next run: {fmtWaiverDate(nextWaiverDate(processDay))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <button className="btn ghost"><span>⇣</span> Export</button>
        </div>
      </div>

      {/* ── Tab strip ── */}
      <div className="tabs" style={{ padding: '0 18px', flexShrink: 0, borderBottom: '1px solid var(--border)', background: 'var(--bg-2)' }}>
        <div className={`tab ${playersTab === 'players' ? 'active' : ''}`} onClick={() => onPlayersTabChange?.('players')}>Players</div>
        <div className={`tab ${playersTab === 'watchlist' ? 'active' : ''}`} onClick={() => onPlayersTabChange?.('watchlist')}>★ Watchlist {resolvableWatchCount > 0 && <span style={{ marginLeft: 4, fontSize: 9, background: 'rgba(198,255,58,.2)', color: 'var(--accent)', borderRadius: 3, padding: '1px 5px', fontFamily: 'var(--font-mono)', fontWeight: 700 }}>{resolvableWatchCount}</span>}</div>
        {isMobile && draftDone && (
          <div className={`tab ${playersTab === 'waiverorder' ? 'active' : ''}`} onClick={() => onPlayersTabChange?.('waiverorder')}>Waiver Order</div>
        )}
      </div>

      {/* ── Watchlist tab ── */}
      {playersTab === 'watchlist' && (
        <div style={{ flex: 1, overflow: 'auto' }}>
          <WatchlistScreen asTab onOpenPlayer={onOpenPlayer} watchlistIds={watchlistIds} onToggleWatch={onToggleWatch} />
        </div>
      )}

      {/* ── Waiver Order tab (mobile only — desktop shows it as a header dropdown) ── */}
      {isMobile && playersTab === 'waiverorder' && draftDone && (
        <div style={{ flex: 1, overflow: 'auto', padding: '14px 16px' }}>
          <div style={{ fontSize: 12, color: 'var(--text-dim)', marginBottom: 14 }}>
            You're <strong style={{ color: 'var(--accent)' }}>#{myWaiverPriority}</strong> of {waiverOrder.length} in waiver priority.
            {myWaiverPriority === 1 && <span style={{ marginLeft: 6, fontSize: 9, background: 'rgba(198,255,58,.2)', color: 'var(--accent)', borderRadius: 4, padding: '1px 5px', fontWeight: 700 }}>FIRST PICK</span>}
          </div>
          {waiverOrder.map((tid, i) => {
            const t = findTeam(tid);
            const isMe = tid === (user?.teamId ?? null);
            return (
              <div key={tid} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 12px', borderRadius: 8, background: isMe ? 'rgba(198,255,58,.12)' : 'var(--panel)', border: '1px solid var(--border)', marginBottom: 6 }}>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--text-faint)', width: 20, flexShrink: 0 }}>{i + 1}.</span>
                <span style={{ fontSize: 14, fontWeight: isMe ? 700 : 500, color: isMe ? 'var(--accent)' : 'var(--text)' }}>{t?.logo || t?.name || `Team ${tid}`}</span>
                {isMe && <span style={{ marginLeft: 'auto', fontSize: 10, color: 'var(--accent)', fontWeight: 700 }}>YOU</span>}
              </div>
            );
          })}
          <div style={{ fontSize: 11, color: 'var(--text-faint)', padding: '10px 2px 0', borderTop: '1px solid var(--border)', marginTop: 8 }}>
            Next run: {fmtWaiverDate(nextWaiverDate(processDay))}
          </div>
        </div>
      )}

      {/* ── Players tab content ── */}
      {/* Falls back here if playersTab is stuck on 'waiverorder' after switching
          from mobile back to desktop, where that tab doesn't exist. */}
      {(playersTab === 'players' || (playersTab === 'waiverorder' && !isMobile)) && <>


      {/* ── Success toast (pre-draft pickups) ── */}
      {addSuccess && (
        <div style={{ margin: '0 18px 8px', padding: '10px 14px', background: 'rgba(76,175,130,.15)', border: '1px solid #4caf82', borderRadius: 8, fontSize: 13, color: '#4caf82', fontWeight: 600 }}>
          ✓ {addSuccess} added to your roster
        </div>
      )}

      {/* ── Free Agent Buzz Feed ── */}
      {trendingPlayers.length > 0 && showBuzzFeed && (
        <div style={{ padding: '0 18px 10px' }}>
          <div style={{ background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 10, padding: '10px 14px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <span style={{ fontSize: 11, color: 'var(--accent)', fontFamily: 'var(--font-mono)', textTransform: 'uppercase', letterSpacing: '.1em', fontWeight: 700 }}>🔥 Buzz Feed</span>
              <span style={{ fontSize: 10, color: 'var(--text-faint)' }}>Most added in last 24h</span>
              <button onClick={() => setShowBuzzFeed(false)} style={{ marginLeft: 'auto', background: 'none', border: 'none', color: 'var(--text-faint)', cursor: 'pointer', fontSize: 14, lineHeight: 1, padding: '0 2px' }}>✕</button>
            </div>
            <div style={{ display: 'flex', gap: 8, overflowX: 'auto', paddingBottom: 4 }}>
              {trendingPlayers.slice(0, 12).map((p, i) => {
                const isOnMyRoster = myRosterIds.has(p.id);
                const isWaivered   = !!waiverQueue[p.id];
                return (
                  <div key={p.id}
                    onClick={() => onOpenPlayer?.(p.id)}
                    style={{ cursor: 'pointer', flexShrink: 0, background: 'var(--panel-2)', border: '1px solid var(--border)', borderRadius: 8, padding: '8px 12px', minWidth: 110, transition: 'border-color .15s' }}
                    onMouseEnter={e => e.currentTarget.style.borderColor = 'rgba(198,255,58,.4)'}
                    onMouseLeave={e => e.currentTarget.style.borderColor = 'var(--border)'}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 4 }}>
                      <span style={{ fontSize: 9, color: 'var(--text-faint)', fontFamily: 'var(--font-mono)', fontWeight: 700 }}>#{i + 1}</span>
                      <PosBadge pos={p.pos} />
                    </div>
                    <div style={{ fontWeight: 700, fontSize: 14, lineHeight: 1.2, marginBottom: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</div>
                    <div style={{ fontSize: 10, color: 'var(--text-faint)', marginBottom: 6 }}>{p.team}</div>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <span style={{ fontSize: 10, color: 'var(--good)', fontFamily: 'var(--font-mono)', fontWeight: 700 }}>
                        +{p.buzzCount?.toLocaleString()}
                      </span>
                      {isOnMyRoster ? (
                        <span style={{ fontSize: 9, color: 'var(--accent)', fontFamily: 'var(--font-mono)' }}>Rostered</span>
                      ) : isWaivered ? (
                        <span style={{ fontSize: 9, color: 'var(--warn)', fontFamily: 'var(--font-mono)' }}>Waiver</span>
                      ) : (
                        <button
                          onClick={e => { e.stopPropagation(); setClaimPlayer(p); setClaimDrop(null); }}
                          style={{ fontSize: 9, padding: '2px 6px', borderRadius: 4, background: 'rgba(198,255,58,.15)', color: 'var(--accent)', border: '1px solid rgba(198,255,58,.3)', cursor: 'pointer', fontFamily: 'var(--font-mono)', fontWeight: 700 }}>
                          + Add
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* ── Waiver order strip (post-draft only) ── */}
      {draftDone && (
        <div style={{ padding: '0 18px 8px', display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
          <span className="faint" style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '.1em', marginRight: 4 }}>Waiver Order:</span>
          {waiverOrder.map((tid, i) => {
            const t    = findTeam(tid);
            const isMe = tid === teamId;
            return (
              <span key={tid} style={{
                display: 'inline-flex', alignItems: 'center', gap: 4,
                background: isMe ? 'rgba(198,255,58,.15)' : 'var(--panel-2)',
                border: `1px solid ${isMe ? 'var(--accent)' : 'var(--border)'}`,
                borderRadius: 4, padding: '2px 7px', fontSize: 10,
                fontFamily: 'var(--font-mono)', color: isMe ? 'var(--accent)' : 'var(--text-dim)',
              }}>
                <span style={{ color: 'var(--text-faint)' }}>{i + 1}.</span>
                <span style={{ width: 6, height: 6, borderRadius: '50%', background: t?.color, display: 'inline-block', flexShrink: 0 }} />
                {t?.logo}
              </span>
            );
          })}
        </div>
      )}

      {/* ── Pending claims (post-draft only) ── */}
      {draftDone && myClaimQueue.length > 0 && (
        <div style={{ margin: '0 18px 8px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--panel-2)', overflow: 'hidden' }}>
          <div
            style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 14px', cursor: 'pointer', userSelect: 'none', borderBottom: claimQueueOpen ? '1px solid var(--border)' : 'none' }}
            onClick={() => setClaimQueueOpen(o => !o)}
          >
            <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--warn)' }}>
              {claimQueueOpen ? '▼' : '▶'} &nbsp;My Pending Claims ({myClaimQueue.length}) · Processes {fmtWaiverDate(nextRun)}
            </span>
            <span style={{ fontSize: 10, color: 'var(--text-faint)' }}>Priority #{myWaiverPriority}</span>
          </div>
          {claimQueueOpen && (
            <div style={{ padding: '6px 0' }}>
              {myClaimQueue.map((claim, i) => {
                const addP        = findPlayer(claim.addId);
                const dropP       = claim.dropId ? findPlayer(claim.dropId) : null;
                const competitors = (claimCountByPlayer[claim.addId] || 1) - 1;
                return (
                  <div key={claim.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 14px', fontSize: 12, borderBottom: i < myClaimQueue.length - 1 ? '1px solid var(--border)' : 'none' }}>
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-faint)', minWidth: 20 }}>#{i + 1}</span>
                    <span style={{ color: 'var(--accent)', fontWeight: 600 }}>+ {addP?.name || '?'}</span>
                    <span style={{ fontSize: 10 }}><PosBadge pos={addP?.pos} /></span>
                    {dropP
                      ? <span style={{ color: 'var(--danger)' }}>/ − {dropP.name}</span>
                      : <span className="faint" style={{ fontSize: 11 }}>/ no drop</span>}
                    {competitors > 0 && (
                      <span style={{ fontSize: 10, color: 'var(--warn)', fontFamily: 'var(--font-mono)' }}>
                        ⚠ {competitors} competing claim{competitors > 1 ? 's' : ''}
                      </span>
                    )}
                    <button
                      style={{ marginLeft: 'auto', background: 'none', border: 'none', color: 'var(--text-faint)', cursor: 'pointer', fontSize: 16, lineHeight: 1, padding: '0 4px' }}
                      onClick={() => removeClaim(claim.id)}
                      title="Remove claim"
                    >⊗</button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      <div className="toolbar">
        <div className="chips">
          {['ALL', 'QB', 'RB', 'WR', 'TE', 'FLEX', 'K', 'DST', 'ROOKIE'].map(p => (
            <div key={p} className={`chip ${pos === p ? 'accent active' : ''}`} onClick={() => setPos(p)}>{p}</div>
          ))}
        </div>
        <input className="input search" placeholder="Filter by name" value={search} onChange={e => setSearch(e.target.value)} style={{ width: 220 }} />
        <div className="chips">
          {[
            ['all', 'All'],
            ['free', 'Available'],
            ['waivers', `Waivers${activeWaivers.size > 0 ? ` (${activeWaivers.size})` : ''}`],
            ['rostered', 'Rostered'],
          ].map(([k, v]) => (
            <div key={k} className={`chip ${avail === k ? 'active' : ''}`}
              style={k === 'waivers' && activeWaivers.size > 0 ? { color: '#ff9500', borderColor: 'rgba(255,149,0,.4)' } : undefined}
              onClick={() => setAvail(k)}>{v}</div>
          ))}
        </div>
        <button
          onClick={() => setBreakoutOnly(b => !b)}
          disabled={breakoutSet.size === 0}
          style={{
            padding: '5px 12px', borderRadius: 6, fontSize: 12, fontWeight: 700,
            cursor: breakoutSet.size === 0 ? 'default' : 'pointer',
            border: `1px solid ${breakoutOnly ? 'rgba(78,168,255,.6)' : 'var(--border)'}`,
            background: breakoutOnly ? 'rgba(78,168,255,.12)' : 'transparent',
            color: breakoutOnly ? '#4ea8ff' : breakoutSet.size === 0 ? 'var(--text-faint)' : 'var(--text-dim)',
            display: 'flex', alignItems: 'center', gap: 5, flexShrink: 0,
            transition: 'all .15s',
            opacity: breakoutSet.size === 0 ? 0.5 : 1,
          }}
          title={breakoutSet.size === 0 ? 'No breakout data yet — run the Databricks export job' : `${breakoutSet.size} breakout candidate${breakoutSet.size !== 1 ? 's' : ''} identified by FantasAI ML`}
        >
          <span style={{ fontSize: 13 }}>↑</span>
          Breakout
          {breakoutOnly && <span style={{ fontSize: 10, fontFamily: 'var(--font-mono)', opacity: 0.8 }}>ON</span>}
          {breakoutSet.size > 0 && !breakoutOnly && <span style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: '#4ea8ff', opacity: 0.8 }}>{breakoutSet.size}</span>}
        </button>
        <button
          onClick={() => setUseSleeperSort(s => !s)}
          style={{
            padding: '5px 12px', borderRadius: 6, fontSize: 12, fontWeight: 700,
            cursor: 'pointer', border: `1px solid ${useSleeperSort ? 'var(--accent)' : 'var(--border)'}`,
            background: useSleeperSort ? 'rgba(198,255,58,.12)' : 'transparent',
            color: useSleeperSort ? 'var(--accent)' : 'var(--text-dim)',
            display: 'flex', alignItems: 'center', gap: 5, flexShrink: 0,
            transition: 'all .15s',
          }}
          title={sleeperWeights ? 'Sort by your Sleeper Slider weights (Account → Sleeper tab)' : 'No Sleeper weights saved — configure them in Account → Sleeper tab'}
        >
          <span style={{ fontSize: 13 }}>😴</span>
          Sleeper Slider
          {useSleeperSort && <span style={{ fontSize: 10, fontFamily: 'var(--font-mono)', opacity: 0.8 }}>ON</span>}
          {!sleeperWeights && <span style={{ fontSize: 10, color: 'var(--warn)', fontFamily: 'var(--font-mono)' }}>!</span>}
        </button>
        <select
          className="input"
          value={sort === 'custom' && activeRankingId ? `custom:${activeRankingId}` : sort}
          onChange={e => {
            const v = e.target.value;
            setUseSleeperSort(false);
            if (v.startsWith('custom:')) { setActiveRankingId(v.slice(7)); setSort('custom'); }
            else { setSort(v); setActiveRankingId(null); }
          }}
          disabled={useSleeperSort}
          style={{ opacity: useSleeperSort ? 0.4 : 1 }}
        >
          <option value="proj">Sort: Projection</option>
          <option value="last">Sort: Last Week</option>
          <option value="avg">Sort: Season Avg</option>
          <option value="owned">Sort: % Owned</option>
          <option value="adp">Sort: ADP</option>
          <option value="rank">Sort: Expert Rank</option>
          {breakoutSet.size > 0 && <option value="oppScore">Sort: Opportunity Score</option>}
          {breakoutSet.size > 0 && <option value="efficiencyScore">Sort: Efficiency Score</option>}
          {breakoutSet.size > 0 && <option value="epaPerOpportunity">Sort: EPA/Play</option>}
          {columns.find(c => c.id === 'tgt')?.visible && <option value="targetShare">Sort: Tgt%</option>}
          {columns.find(c => c.id === 'routes')?.visible && <option value="routes">Sort: Routes</option>}
          {columns.find(c => c.id === 'yac')?.visible && <option value="yac">Sort: YAC</option>}
          {customRankings.length > 0 && <option disabled>── My Rankings ──</option>}
          {customRankings.map(r => <option key={r.id} value={`custom:${r.id}`}>📋 {r.name}</option>)}
        </select>
        {/* Active custom ranking indicator */}
        {activeRanking && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '3px 10px', background: 'rgba(198,255,58,.1)', border: '1px solid rgba(198,255,58,.3)', borderRadius: 6, flexShrink: 0 }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--accent)' }}>📋 {activeRanking.name}</span>
            <span style={{ fontSize: 10, color: 'var(--text-faint)', fontFamily: 'var(--font-mono)' }}>{activeRanking.players.length} players</span>
            <button style={{ background:'none', border:'none', cursor:'pointer', color:'var(--text-faint)', fontSize:13, padding:0, lineHeight:1 }}
              onClick={() => { setActiveRankingId(null); setSort('proj'); }}>✕</button>
          </div>
        )}
        {/* Custom rankings chips (if any saved) */}
        {customRankings.length > 0 && (
          <div style={{ display:'flex', gap:4, flexWrap:'nowrap', alignItems:'center' }}>
            {customRankings.map(r => (
              <div key={r.id} style={{ display:'flex', alignItems:'center', gap:0, borderRadius:6, border:`1px solid ${activeRankingId===r.id ? 'rgba(198,255,58,.5)' : 'var(--border)'}`, overflow:'hidden', flexShrink:0 }}>
                <button
                  style={{ padding:'3px 9px', fontSize:11, fontWeight:600, background: activeRankingId===r.id ? 'rgba(198,255,58,.12)' : 'transparent', border:'none', cursor:'pointer', color: activeRankingId===r.id ? 'var(--accent)' : 'var(--text-dim)', whiteSpace:'nowrap' }}
                  onClick={() => { setActiveRankingId(r.id); setSort('custom'); setUseSleeperSort(false); }}
                >📋 {r.name}</button>
                <button style={{ padding:'3px 7px', fontSize:11, background:'transparent', border:'none', borderLeft:`1px solid ${activeRankingId===r.id ? 'rgba(198,255,58,.3)' : 'var(--border)'}`, cursor:'pointer', color:'var(--text-faint)', lineHeight:1 }}
                  onClick={() => deleteCustomRanking(r.id)}>✕</button>
              </div>
            ))}
          </div>
        )}
        <div className="grow"></div>
        {[
          { group: 'std',     label: 'Standard',  color: '#4ea8ff', bg: 'rgba(78,168,255,.12)', border: 'rgba(78,168,255,.4)' },
          { group: 'adv',     label: 'Next Gen',  color: '#ffcc44', bg: 'rgba(255,204,68,.12)', border: 'rgba(255,204,68,.4)' },
          { group: 'combine', label: 'Combine',   color: '#c0c0c0', bg: 'rgba(192,192,192,.12)', border: 'rgba(192,192,192,.4)' },
        ].map(g => {
          const groupCols = columns.filter(c => c.group === g.group);
          const anyVisible = groupCols.some(c => c.visible);
          return (
            <button
              key={g.group}
              style={{
                fontSize: 10, padding: '4px 10px', borderRadius: 5, fontWeight: 700, cursor: 'pointer', flexShrink: 0,
                border: `1px solid ${anyVisible ? g.border : 'var(--border)'}`,
                background: anyVisible ? g.bg : 'transparent',
                color: anyVisible ? g.color : 'var(--text-faint)',
                fontFamily: 'var(--font-mono)', letterSpacing: '.04em',
              }}
              onClick={() => {
                const next = columns.map(c => c.group === g.group ? { ...c, visible: !anyVisible } : c);
                saveColumns(next);
              }}
              title={`${anyVisible ? 'Hide' : 'Show'} all ${g.label} columns`}
            >
              {anyVisible ? '✓ ' : ''}{g.label}
            </button>
          );
        })}
        <button
          className="btn ghost"
          style={{ fontSize: 11, padding: '4px 10px', flexShrink: 0, color: '#000', background: '#e6c619', borderColor: '#e6c619' }}
          onClick={() => setShowColPicker(p => !p)}
          title="Customize visible stat columns"
        >⚙ Player Stat Selector</button>
      </div>

      <div style={{ flex: 1, overflow: 'auto' }}>
        <table className="data-table">
          <thead>
            {(() => {
              const stdCount = visibleCols.filter(c => c.group === 'std').length;
              const advCount = visibleCols.filter(c => c.group === 'adv').length;
              const combCount = visibleCols.filter(c => c.group === 'combine').length;
              if (!stdCount && !advCount && !combCount) return null;
              const cells = [];
              cells.push(<th key="pre" colSpan={3 + (useSleeperSort ? 1 : 0)} style={{ border: 'none', background: 'transparent' }} />);
              let run = null;
              let runCount = 0;
              const flush = () => {
                if (!run) return;
                if (run === 'std') cells.push(<th key={`g-std-${cells.length}`} colSpan={runCount} style={{ textAlign: 'center', fontSize: 9, fontFamily: 'var(--font-mono)', fontWeight: 800, letterSpacing: '.1em', color: '#4ea8ff', background: 'rgba(78,168,255,.08)', border: '1px solid rgba(78,168,255,.25)', borderBottom: 'none', borderRadius: '4px 4px 0 0', padding: '3px 6px' }}>STANDARD PLAYER STATS</th>);
                else if (run === 'adv') cells.push(<th key={`g-adv-${cells.length}`} colSpan={runCount} style={{ textAlign: 'center', fontSize: 9, fontFamily: 'var(--font-mono)', fontWeight: 800, letterSpacing: '.1em', color: '#ffcc44', background: 'rgba(255,204,68,.1)', border: '1px solid rgba(255,204,68,.3)', borderBottom: 'none', borderRadius: '4px 4px 0 0', padding: '3px 6px' }}>NEXT GEN STATS</th>);
                else if (run === 'combine') cells.push(<th key={`g-comb-${cells.length}`} colSpan={runCount} style={{ textAlign: 'center', fontSize: 9, fontFamily: 'var(--font-mono)', fontWeight: 800, letterSpacing: '.1em', color: '#c0c0c0', background: 'rgba(192,192,192,.08)', border: '1px solid rgba(192,192,192,.25)', borderBottom: 'none', borderRadius: '4px 4px 0 0', padding: '3px 6px' }}>COMBINE</th>);
                else cells.push(<th key={`g-blank-${cells.length}`} colSpan={runCount} style={{ border: 'none', background: 'transparent' }} />);
                run = null; runCount = 0;
              };
              for (const col of visibleCols) {
                const g = col.group || '';
                if (g !== run) { flush(); run = g; }
                runCount++;
              }
              flush();
              cells.push(<th key="post" colSpan={2} style={{ border: 'none', background: 'transparent' }} />);
              return <tr>{cells}</tr>;
            })()}
            <tr>
              <th className={`num${sort === 'adp' || sort === 'rank' ? ' sorted' : ''}`} style={{ cursor: 'pointer' }} onClick={() => { setSort(sort === 'adp' ? 'rank' : 'adp'); setUseSleeperSort(false); }} title="Click to toggle ADP / Expert Rank">{sort === 'adp' ? 'ADP' : sort === 'rank' ? 'ECR' : '#'}</th>
              <th className={sort === 'name' ? 'sorted' : ''} style={{ cursor: 'pointer' }} onClick={() => { setSort('name'); setUseSleeperSort(false); }}>Player</th>
              <th>Opp</th>
              {useSleeperSort && <th className="num sorted" style={{ color: 'var(--accent)' }}>Score</th>}
              {visibleCols.map((col, idx) => {
                const isSorted = !useSleeperSort && sort === col.sortKey;
                const isAdv = col.group === 'adv';
                const isCombine = col.group === 'combine';
                const isFirstAdv = isAdv && (idx === 0 || visibleCols[idx - 1]?.group !== 'adv');
                const isFirstCombine = isCombine && (idx === 0 || visibleCols[idx - 1]?.group !== 'combine');
                const isDragging = draggedColId === col.id;
                const isDragOver = dragOverColId === col.id && draggedColId !== col.id;
                return (
                  <th key={col.id}
                    className={`num${isSorted ? ' sorted' : ''}`}
                    draggable
                    onDragStart={e => { e.dataTransfer.effectAllowed = 'move'; setDraggedColId(col.id); }}
                    onDragOver={e => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; setDragOverColId(col.id); }}
                    onDrop={e => { e.preventDefault(); moveColumnTo(draggedColId, col.id); setDraggedColId(null); setDragOverColId(null); }}
                    onDragEnd={() => { setDraggedColId(null); setDragOverColId(null); }}
                    style={{
                      cursor: 'grab',
                      opacity: isDragging ? 0.35 : 1,
                      outline: isDragOver ? '2px dashed rgba(255,255,255,.35)' : 'none',
                      outlineOffset: '-2px',
                      transition: 'opacity .15s',
                      ...(isAdv ? { color: '#ffcc44', background: 'rgba(255,204,68,.08)' } : {}),
                      ...(isCombine ? { color: '#c0c0c0', background: 'rgba(192,192,192,.06)' } : {}),
                      ...(isFirstAdv ? { borderLeft: '2px solid rgba(255,204,68,.5)' } : {}),
                      ...(isFirstCombine ? { borderLeft: '2px solid rgba(192,192,192,.4)' } : {}),
                      ...(isDragOver && isAdv ? { background: 'rgba(255,204,68,.18)' } : {}),
                      ...(isDragOver && isCombine ? { background: 'rgba(192,192,192,.15)' } : {}),
                      ...(isDragOver && !isAdv && !isCombine ? { background: 'rgba(255,255,255,.1)' } : {}),
                    }}
                    onClick={col.sortKey ? () => { setSort(col.sortKey); setUseSleeperSort(false); } : undefined}
                    title={isAdv ? `${col.label} — Next Gen stat · 2025` : isCombine ? `${col.label} — NFL Combine measurable` : `Drag to reorder · Click to sort`}
                  >{col.label}</th>
                );
              })}
              <th></th>
            </tr>
          </thead>
          <tbody>
            {!isLiveData() && players.length === 0 && Array.from({ length: 20 }).map((_, i) => (
              <tr key={`skel-${i}`}>
                {Array.from({ length: visibleCols.length + 4 }).map((__, c) => (
                  <td key={c}><div style={{ height: 12, borderRadius: 4, background: 'rgba(255,255,255,.06)', width: c === 1 ? 140 : c === 0 ? 24 : 48, animation: 'pulse 1.4s ease-in-out infinite' }} /></td>
                ))}
              </tr>
            ))}
            {players.map((p, i) => {
              const isOnMyRoster  = myRosterIds.has(p.id);
              const waiverEntry   = waiverQueue[p.id];
              const isOnWaivers   = !!(waiverEntry && new Date(waiverEntry.expiresAt) > new Date());
              const isAvail       = !draftedIds.has(p.id) && !isOnMyRoster && !isOnWaivers && PLAYER_OWNER_MAP[p.id] == null;
              const aiPick = aiMode !== 'subtle' ? null :
                (p.id === 65 ? 'fade — hammy' : p.id === 62 ? 'BUY' : p.id === 80 ? 'TE1 lock' : null);
              const pKey = p.name.toLowerCase().trim();
              const ownerTeamId = isOnMyRoster ? (user?.teamId || null) : (PLAYER_OWNER_MAP[p.id] ?? null);
              const ownerTeam   = ownerTeamId != null ? findTeam(ownerTeamId) : null;
              // R2 overlay takes priority for depth; fall back to Sleeper getPlayerMap data
              const depthLabel = p.depthChartPos
                ? `${p.depthChartPos}${p.depthChartOrder != null ? p.depthChartOrder : ''}`
                : depthData[pKey];
              const snapCount   = snapsData[pKey];
              // Injury notes: prefer R2 overlay, fall back to Sleeper getPlayerMap
              const injNotes    = p.injuryNotes || (injuryData[pKey] ? [injuryData[pKey].bodyPart, injuryData[pKey].notes].filter(Boolean).join(' · ') : null);
              const breakoutData = breakoutSet.get(pKey);
              return (
                <tr key={p.id} className={selected === p.id ? 'selected' : ''} onClick={() => setSelected(p.id)}
                  style={
                    myRosterIds.has(p.id)     ? { background: 'rgba(78,168,255,.1)', borderLeft: '2px solid rgba(78,168,255,.5)' }
                    : isOnWaivers               ? { background: 'rgba(255,149,0,.04)' }
                    : p.status === 'Out' || p.status === 'IR' ? { background: 'rgba(255,60,60,.07)' }
                    : p.status === 'Q'        ? { background: 'rgba(255,140,0,.07)' }
                    : p.status === 'D'        ? { background: 'rgba(255,80,30,.07)' }
                    : isAvail                 ? { background: 'rgba(26,210,130,.18)', borderLeft: '2px solid rgba(26,210,130,.5)' }
                    : undefined
                  }>
                  <td className="rank">
                    {i + 1}
                  </td>
                  <td onClick={(e) => { e.stopPropagation(); onOpenPlayer(p.id); }} style={{ cursor: 'pointer' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <PlayerCell player={p} watched={watchlistIds.has(p.id)} />
                      {breakoutData && (
                        <span title={`Snap Δ +${((breakoutData.snap_share_delta || 0) * 100).toFixed(0)}% · Opp Score ${(breakoutData.opportunity_score || 0).toFixed(1)}`}
                          style={{ display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: 8, fontWeight: 800, fontFamily: 'var(--font-mono)', color: 'var(--accent-2)', background: 'rgba(78,168,255,.12)', border: '1px solid rgba(78,168,255,.4)', borderRadius: 4, padding: '1px 5px', letterSpacing: '.04em', whiteSpace: 'nowrap', flexShrink: 0 }}>↑ BREAKOUT</span>
                      )}
                      {(() => {
                        const s = p.status;
                        const label = s === 'Q' ? 'Questionable' : s === 'D' ? 'Doubtful' : (s === 'Out' || s === 'O') ? 'Out' : s === 'IR' ? 'IR' : null;
                        const color = (s === 'Q' || s === 'D') ? '#ff9800' : (s === 'Out' || s === 'O' || s === 'IR') ? '#ff4f4f' : null;
                        if (!label) return null;
                        return <span style={{ fontSize: 10, fontFamily: 'var(--font-mono)', fontWeight: 700, color, letterSpacing: '.04em', flexShrink: 0 }}>{label}</span>;
                      })()}
                    </div>
                  </td>
                  <td>
                    {(() => {
                      const displayOpp = p.opp || scheduleOppMap.get(p.team) || '';
                      const wk = getNflScheduleWeek();
                      const rawOpp = displayOpp.replace(/^@/, '').toUpperCase();
                      const defRank = displayOpp
                        ? (defRankByTeam[displayOpp.toUpperCase()] || defRankByTeam[displayOpp] || p.oppRank || 0)
                        : (p.oppRank || 0);
                      // Position-specific matchup rank (1=toughest, 32=easiest)
                      const posForMatchup = p.pos === 'DST' ? null : (p.pos === 'K' ? 'K' : p.pos);
                      const matchupRank = posForMatchup && rawOpp
                        ? defVsPosIndex.get(`${rawOpp}|${posForMatchup}`) ?? null
                        : null;
                      const matchupInfo = matchupRank == null ? null
                        : matchupRank <= 5  ? { label: 'AVOID',     color: '#ff5a6e', bg: 'rgba(255,90,110,.15)' }
                        : matchupRank <= 10 ? { label: 'TOUGH',     color: '#ff9f3f', bg: 'rgba(255,159,63,.12)' }
                        : matchupRank >= 28 ? { label: 'SMASH',     color: '#4ed87b', bg: 'rgba(78,216,123,.15)' }
                        : matchupRank >= 23 ? { label: 'FAVORABLE', color: '#4ea8ff', bg: 'rgba(78,168,255,.12)' }
                        : null;
                      return (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 60 }}>
                          {displayOpp
                            ? <span className="mono" style={{ fontSize: 11, color: matchupInfo ? matchupInfo.color : 'var(--text-dim)' }}>vs {displayOpp}</span>
                            : <span className="mono faint" style={{ fontSize: 10 }}>—</span>}
                          {displayOpp && <div className="mono faint" style={{ fontSize: 9 }}>Wk {wk}</div>}
                          {matchupInfo
                            ? <span style={{ fontSize: 8, fontWeight: 800, letterSpacing: '.06em', color: matchupInfo.color, background: matchupInfo.bg, borderRadius: 3, padding: '1px 4px', alignSelf: 'flex-start' }}>{matchupInfo.label}</span>
                            : defRank > 0
                              ? <div className="mono faint" style={{ fontSize: 9 }}>D #{defRank}</div>
                              : null}
                        </div>
                      );
                    })()}
                  </td>
                  {useSleeperSort && (
                    <td className="num">
                      <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 800, fontSize: 12, color: 'var(--accent)' }}>
                        {((sleeperScores[p.id] ?? 0) * 100).toFixed(0)}
                      </span>
                    </td>
                  )}
                  {visibleCols.map((col, idx) => {
                    const isAdv = col.group === 'adv';
                    const isFirstAdv = isAdv && (idx === 0 || visibleCols[idx - 1]?.group !== 'adv');
                    const isRecvr = p.pos === 'WR' || p.pos === 'TE' || p.pos === 'RB';
                    const noStats = p.proj <= 0 && (p.pts2025 || 0) === 0 && (p.avg || 0) === 0;
                    const rookieRow = p.rookie ? rookieScoreMap.get(p.name.toLowerCase().trim()) : null;
                    const cell = (() => {
                    if (col.id === 'proj') {
                      const rookieProjRaw = rookieRow?.proj_week_pts ?? null;
                      const rookieFromScore = rookieRow?.rookie_score != null
                        ? (() => {
                            const s = rookieRow.rookie_score;
                            const base = { QB: 8, RB: 6, WR: 5, TE: 4 }[p.pos] ?? 5;
                            const ceil = { QB: 22, RB: 16, WR: 14, TE: 10 }[p.pos] ?? 14;
                            return parseFloat((base + (ceil - base) * (s / 100)).toFixed(1));
                          })()
                        : null;
                      const rookieProj = (rookieProjRaw && rookieProjRaw >= 1) ? rookieProjRaw : rookieFromScore;
                      const projVal = p.proj > 0 ? p.proj : (rookieProj ?? null);
                      const isRookieProj = projVal === rookieProj && rookieProj != null && p.proj <= 0;
                      return (
                        <td key="proj" className="num">
                          {projVal != null ? (
                            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 2 }}>
                              <span style={{ fontWeight: 600 }}>{parseFloat(projVal.toFixed(1))}</span>
                              {isRookieProj && rookieRow?.rookie_score != null && (
                                <span title={`Rookie Score: ${rookieRow.rookie_score} · Draft Capital: ${rookieRow.draft_capital_score ?? '—'} · Athleticism: ${rookieRow.athleticism_score ?? '—'} · Opportunity: ${rookieRow.opportunity_score}`}
                                  style={{ fontSize: 8, fontWeight: 800, letterSpacing: '.05em', color: '#a78bfa', background: 'rgba(167,139,250,.15)', borderRadius: 3, padding: '1px 4px', cursor: 'default' }}>
                                  R {Math.round(rookieRow.rookie_score)}
                                </span>
                              )}
                              {!isRookieProj && <ProjBar value={projVal} />}
                            </div>
                          ) : <span className="faint" style={{ fontSize: 10 }}>—</span>}
                        </td>
                      );
                    }
                    if (col.id === 'last') {
                      const v = p.last > 0 ? p.last : null;
                      return <td key="last" className="num">{v != null ? parseFloat(v.toFixed(1)) : <span className="faint" style={{ fontSize: 10 }}>—</span>}</td>;
                    }
                    if (col.id === 'avg') {
                      const v = p.avg > 0 ? p.avg : null;
                      return <td key="avg" className="num">{v != null ? parseFloat(v.toFixed(1)) : <span className="faint" style={{ fontSize: 10 }}>—</span>}</td>;
                    }
                    if (col.id === 'trend') {
                      const tData = p.trend?.some(v => v > 0) ? p.trend : null;
                      return (
                        <td key="trend" className="num" style={{ paddingRight: 6 }}>
                          {tData ? <Sparkline data={tData} width={70} height={20} /> : <span className="faint" style={{ fontSize: 10 }}>—</span>}
                        </td>
                      );
                    }
                    if (col.id === 'opp_score') {
                      const oppVal = breakoutSet.get(p.name.toLowerCase().trim())?.opportunity_score;
                      return (
                        <td key="opp_score" className="num">
                          {oppVal != null
                            ? <span style={{ fontWeight: 600, color: 'var(--accent-2)', fontFamily: 'var(--font-mono)', fontSize: 11 }}>{parseFloat(Number(oppVal).toFixed(1))}</span>
                            : <span className="faint" style={{ fontSize: 10 }}>—</span>}
                        </td>
                      );
                    }
                    if (col.id === 'bye')     return <td key="bye" className="num">{p.bye > 0 ? p.bye : <span className="faint">—</span>}</td>;
                    if (col.id === 'owned')   return <td key="owned" className="num">{p.owned.toFixed(1)}%</td>;
                    if (col.id === 'adp')     return <td key="adp" className="num" style={{ color: 'var(--text-dim)' }}>{p.adp < 999 ? parseFloat(p.adp.toFixed(1)) : <span style={{ color: 'var(--text-faint)', fontFamily: 'var(--font-mono)', fontSize: 10 }}>999</span>}</td>;
                    if (col.id === 'ecr_rank') return <td key="ecr_rank" className="num">{p.ecr < 999 ? <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, fontSize: 11 }}>{p.ecr}</span> : <span style={{ color: 'var(--text-faint)', fontFamily: 'var(--font-mono)', fontSize: 10 }}>999</span>}</td>;
                    if (col.id === 'depth')   return (
                      <td key="depth" className="num">
                        {depthLabel
                          ? <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, fontWeight: 700, color: depthLabel.endsWith('1') ? 'var(--accent)' : depthLabel.endsWith('2') ? 'var(--accent-2)' : 'var(--text-faint)' }}>{depthLabel}</span>
                          : <span className="faint" style={{ fontSize: 11 }}>—</span>}
                      </td>
                    );
                    if (col.id === 'snaps')   return <td key="snaps" className="num mono" style={{ fontSize: 11 }}>{snapCount != null ? snapCount : <span className="faint">—</span>}</td>;
                    if (col.id === 'tgt')     return <td key="tgt" className="num">{isRecvr && p.targetShare > 0 ? `${p.targetShare.toFixed(1)}%` : <span className="faint" style={{ fontSize: 10 }}>—</span>}</td>;
                    if (col.id === 'routes')  return <td key="routes" className="num">{isRecvr && p.routes > 0 ? p.routes : <span className="faint" style={{ fontSize: 10 }}>—</span>}</td>;
                    if (col.id === 'yac')     return <td key="yac" className="num">{isRecvr && p.yac > 0 ? p.yac.toFixed(1) : <span className="faint" style={{ fontSize: 10 }}>—</span>}</td>;
                    if (col.id === 'snap_pct') return (
                      <td key="snap_pct" className="num mono" style={{ fontSize: 11 }}>
                        {p.snapPct != null ? `${p.snapPct}%` : <span className="faint">—</span>}
                      </td>
                    );
                    if (col.id === 'tgt_g') return (
                      <td key="tgt_g" className="num mono" style={{ fontSize: 11 }}>
                        {p.tgtG != null ? p.tgtG.toFixed(1) : <span className="faint">—</span>}
                      </td>
                    );
                    if (col.id === 'adot') return (
                      <td key="adot" className="num mono" style={{ fontSize: 11 }}>
                        {p.adot != null ? p.adot.toFixed(1) : <span className="faint">—</span>}
                      </td>
                    );
                    if (col.id === 'air_yds') return (
                      <td key="air_yds" className="num mono" style={{ fontSize: 11 }}>
                        {p.airYds != null ? p.airYds.toFixed(1) : <span className="faint">—</span>}
                      </td>
                    );
                    if (col.id === 'att_g') return (
                      <td key="att_g" className="num mono" style={{ fontSize: 11 }}>
                        {p.attG != null ? p.attG.toFixed(1) : <span className="faint">—</span>}
                      </td>
                    );
                    if (col.id === 'yptgt') return (
                      <td key="yptgt" className="num mono" style={{ fontSize: 11 }}>
                        {p.yptgt != null ? p.yptgt.toFixed(1) : <span className="faint">—</span>}
                      </td>
                    );
                    if (col.id === 'combo') {
                      const comboVal = p.combo ?? p.comboYdsG ?? null;
                      return (
                        <td key="combo" className="num mono" style={{ fontSize: 11 }}>
                          {comboVal != null ? comboVal.toFixed(1) : <span className="faint">—</span>}
                        </td>
                      );
                    }
                    if (col.id === 'rz_att') return (
                      <td key="rz_att" className="num mono" style={{ fontSize: 11, color: p.avgRzAttG >= 2 ? '#1affa0' : undefined }}>
                        {p.avgRzAttG != null ? p.avgRzAttG.toFixed(1) : <span className="faint">—</span>}
                      </td>
                    );
                    if (col.id === 'forty') return (
                      <td key="forty" className="num mono" style={{ fontSize: 11, color: p.forty && p.forty <= 4.4 ? '#1affa0' : undefined }}>
                        {p.forty != null ? p.forty.toFixed(2) : <span className="faint">—</span>}
                      </td>
                    );
                    if (col.id === 'vertical') return (
                      <td key="vertical" className="num mono" style={{ fontSize: 11 }}>
                        {p.vertical != null ? p.vertical.toFixed(1) + '"' : <span className="faint">—</span>}
                      </td>
                    );
                    if (col.id === 'broad') return (
                      <td key="broad" className="num mono" style={{ fontSize: 11 }}>
                        {p.broadJump != null ? p.broadJump + '"' : <span className="faint">—</span>}
                      </td>
                    );
                    if (col.id === 'bench') return (
                      <td key="bench" className="num mono" style={{ fontSize: 11 }}>
                        {p.benchPress != null ? p.benchPress : <span className="faint">—</span>}
                      </td>
                    );
                    if (col.id === 'weather') return <td key="weather"><WeatherBadge team={p.team} opp={p.opp} scheduleOppMap={scheduleOppMap} /></td>;
                      return null;
                    })();
                    if (!cell) return cell;
                    if (isAdv) return React.cloneElement(cell, {
                      style: {
                        ...(cell.props.style || {}),
                        background: 'rgba(255,204,68,.07)',
                        ...(isFirstAdv ? { borderLeft: '2px solid rgba(255,204,68,.45)' } : {}),
                      }
                    });
                    if (col.group === 'combine') {
                      const isFirstComb = idx === 0 || visibleCols[idx - 1]?.group !== 'combine';
                      return React.cloneElement(cell, {
                        style: {
                          ...(cell.props.style || {}),
                          background: 'rgba(192,192,192,.05)',
                          ...(isFirstComb ? { borderLeft: '2px solid rgba(192,192,192,.35)' } : {}),
                        }
                      });
                    }
                    return cell;
                  })}
                  <td>
                    <div className="flex gap-8" style={{ alignItems: 'center' }}>
                      <button
                        className={`btn sm icon${watchlistIds.has(p.id) ? ' watch-active' : ''}`}
                        title={watchlistIds.has(p.id) ? 'Remove from watchlist' : 'Add to watchlist'}
                        onClick={e => { e.stopPropagation(); onToggleWatch?.(p.id); }}
                      >{watchlistIds.has(p.id) ? '★' : '☆'}</button>
                      {isOnMyRoster ? (() => {
                        const myTeam = user?.teamId ? findTeam(user.teamId) : null;
                        return (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 3, alignItems: 'flex-start' }}>
                            {myTeam && (
                              <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 10, color: 'var(--accent)', whiteSpace: 'nowrap' }}>
                                <span style={{ width: 7, height: 7, borderRadius: '50%', background: myTeam.color || 'var(--accent)', flexShrink: 0, display: 'inline-block' }} />
                                {myTeam.name}
                              </span>
                            )}
                            <button className="btn sm success" disabled onClick={e => e.stopPropagation()}>✓ Rostered</button>
                          </div>
                        );
                      })() : isOnWaivers ? (() => {
                        const dropTeam  = waiverEntry.teamId ? findTeam(waiverEntry.teamId) : null;
                        const clearsAt  = new Date(waiverEntry.expiresAt);
                        const clearsFmt = clearsAt.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
                          + ' · ' + clearsAt.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
                        return (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 2, alignItems: 'flex-start' }}>
                            {dropTeam && (
                              <span style={{ fontSize: 10, color: 'var(--text-dim)', whiteSpace: 'nowrap' }}>
                                Dropped by {dropTeam.name.split(' ').slice(-1)[0]}
                              </span>
                            )}
                            <span style={{ fontSize: 10, color: 'var(--accent-2)', fontFamily: 'var(--font-mono)', whiteSpace: 'nowrap' }}>
                              Avail {clearsFmt}
                            </span>
                          </div>
                        );
                      })() : isAvail ? (
                        <button className="btn sm primary" onClick={e => { e.stopPropagation(); openClaim(p); }}>{draftDone ? '+ Claim' : '+ Add'}</button>
                      ) : (() => {
                        const ownerTeamId = PLAYER_OWNER_MAP[p.id];
                        const ownerTeam   = ownerTeamId ? findTeam(ownerTeamId) : null;
                        const teamLabel   = ownerTeam?.name ?? (ownerTeamId ? `Team ${ownerTeamId}` : null);
                        const teamColor   = ownerTeam?.color ?? '#888';
                        return (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 3, alignItems: 'flex-start' }}>
                            {teamLabel && (
                              <span style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 10, fontWeight: 700, whiteSpace: 'nowrap', color: teamColor }}>
                                <span style={{ width: 7, height: 7, borderRadius: '50%', background: teamColor, flexShrink: 0, display: 'inline-block' }} />
                                {teamLabel}
                              </span>
                            )}
                            <div style={{ display: 'flex', gap: 4 }}>
                              <button className="btn sm ghost" disabled onClick={e => e.stopPropagation()}
                                style={{ opacity: .65 }}>On Roster</button>
                              {ownerTeamId && (
                                <button className="btn sm ghost" onClick={e => { e.stopPropagation(); onTradePlayer?.(p.id, ownerTeamId); }}
                                  style={{ color: 'var(--accent-2)', borderColor: 'rgba(78,168,255,.35)' }}>Trade</button>
                              )}
                            </div>
                          </div>
                        );
                      })()}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      </>}
    </div>

    {/* ── TEMP: Data Source Debugger right panel ── */}
    {/* To re-enable: uncomment the block below and import DataSourceDebugger if needed */}
    {/*
    <div style={{ width: 400, flexShrink: 0, borderLeft: '1px solid var(--border)', overflow: 'auto', background: 'var(--bg-2)', display: 'flex', flexDirection: 'column' }}>
      <div style={{ padding: '10px 14px', borderBottom: '1px solid var(--border)', background: 'rgba(255,180,0,.06)', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 9, fontWeight: 800, color: '#ffb547', fontFamily: 'var(--font-mono)', letterSpacing: '.1em', background: 'rgba(255,180,0,.15)', border: '1px solid rgba(255,180,0,.35)', borderRadius: 3, padding: '1px 5px' }}>TEMP DEBUG</span>
          <span style={{ fontWeight: 700, fontSize: 13 }}>Data Source Debugger</span>
        </div>
        <div style={{ fontSize: 10, color: 'var(--text-faint)', marginTop: 3 }}>Identify which source injects bad player records. Disable &amp; reload to test.</div>
      </div>
      <div style={{ overflow: 'auto', flex: 1 }}>
        <DataSourceDebugger />
      </div>
    </div>
    */}

    {/* ── Column Picker Modal ────────────────────────────────────────────── */}
    {showColPicker && (
      <div style={{ position: 'fixed', inset: 0, zIndex: 500, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '64px 0 0 0' }}
        onClick={e => { if (e.target === e.currentTarget) setShowColPicker(false); }}>
        <div style={{ background: 'var(--panel)', border: '1px solid var(--border-strong)', borderRadius: 12, padding: 16, width: 240, boxShadow: '0 12px 40px rgba(0,0,0,.5)' }}
          onClick={e => e.stopPropagation()}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
            <div style={{ fontWeight: 800, fontSize: 13 }}>⚙ Player Stat Selector</div>
            <button style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 16, color: 'var(--text-faint)', lineHeight: 1 }} onClick={() => setShowColPicker(false)}>✕</button>
          </div>
          <div style={{ fontSize: 10, color: 'var(--text-faint)', marginBottom: 8 }}>Drag to reorder · check to show/hide</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            {columns.map((col, idx) => {
              const isFirstOfGroup = col.group && (idx === 0 || columns[idx - 1].group !== col.group);
              const isDragging = draggedColId === col.id;
              const isDragOver = dragOverColId === col.id && draggedColId !== col.id;
              const groupHeaders = { std: { label: 'Standard Player Stats', color: '#4ea8ff' }, adv: { label: 'Next Gen Stats', color: '#ffcc44' }, combine: { label: 'Combine Measurables', color: '#c0c0c0' } };
              const gh = isFirstOfGroup ? groupHeaders[col.group] : null;
              return (
                <React.Fragment key={col.id}>
                  {gh && (
                    <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.08em', color: gh.color, paddingLeft: 6, marginTop: 8, marginBottom: 2 }}>
                      {gh.label}
                    </div>
                  )}
                  <div
                    draggable
                    onDragStart={e => { e.dataTransfer.effectAllowed = 'move'; setDraggedColId(col.id); }}
                    onDragOver={e => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; setDragOverColId(col.id); }}
                    onDrop={e => { e.preventDefault(); moveColumnTo(draggedColId, col.id); setDraggedColId(null); setDragOverColId(null); }}
                    onDragEnd={() => { setDraggedColId(null); setDragOverColId(null); }}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 6, padding: '4px 6px', borderRadius: 6,
                      cursor: 'grab',
                      opacity: isDragging ? 0.35 : 1,
                      background: isDragOver
                        ? 'rgba(255,255,255,.12)'
                        : col.visible ? 'rgba(255,255,255,.04)' : 'transparent',
                      outline: isDragOver ? '1px dashed rgba(255,255,255,.3)' : 'none',
                      transition: 'background .1s, opacity .1s',
                    }}
                  >
                    <span style={{ color: 'var(--text-faint)', fontSize: 14, lineHeight: 1, flexShrink: 0, userSelect: 'none' }}>⠿</span>
                    <input type="checkbox" checked={col.visible} onChange={() => toggleColumn(col.id)}
                      style={{ accentColor: col.group === 'adv' ? '#ffcc44' : col.group === 'combine' ? '#c0c0c0' : col.group === 'std' ? '#4ea8ff' : 'var(--accent)', cursor: 'pointer', flexShrink: 0 }}
                      onClick={e => e.stopPropagation()} />
                    <span style={{ flex: 1, fontSize: 12, color: col.group === 'adv' ? (col.visible ? '#ffcc44' : 'rgba(255,204,68,.45)') : (col.visible ? 'var(--text)' : 'var(--text-faint)') }}>{col.label}</span>
                  </div>
                </React.Fragment>
              );
            })}
          </div>
          <button className="btn ghost sm" style={{ width: '100%', marginTop: 10, fontSize: 11 }}
            onClick={() => saveColumns(DEFAULT_COLUMNS.map(c => ({ ...c })))}>Reset to Default</button>
        </div>
      </div>
    )}

    {/* ── Claim / Add Modal ─────────────────────────────────────────────── */}
    {claimPlayer && (
      <div className="drawer-overlay" onClick={() => setClaimPlayer(null)}>
        <div
          style={{ position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%,-50%)', background: 'var(--panel)', border: '1px solid var(--border-strong)', borderRadius: 14, padding: 28, width: 400, maxWidth: 'calc(100vw - 32px)', zIndex: 300 }}
          onClick={e => e.stopPropagation()}
        >
          <div style={{ fontFamily: 'var(--font-display)', fontWeight: 900, fontStretch: '75%', fontSize: 16, marginBottom: 4 }}>
            {draftDone ? 'Submit Waiver Claim' : 'Add Free Agent'}
          </div>
          <div className="dim" style={{ fontSize: 12, marginBottom: 4 }}>
            {draftDone
              ? `Wk ${currentWeek} · Priority #${myWaiverPriority} · Processes ${fmtWaiverDate(nextRun)}`
              : 'Pre-draft — takes effect immediately, no waiver queue'}
          </div>
          <div style={{ fontSize: 13, marginBottom: 16, marginTop: 12 }}>
            Add <strong style={{ color: 'var(--accent)' }}>{claimPlayer.name}</strong>
            <span className="faint" style={{ marginLeft: 6 }}>
              <PosBadge pos={claimPlayer.pos} /> {claimPlayer.team}
            </span>
          </div>
          {draftDone && (claimCountByPlayer[claimPlayer.id] || 0) > 0 && (
            <div style={{ marginBottom: 12, padding: '8px 12px', background: 'rgba(255,152,0,.1)', border: '1px solid rgba(255,152,0,.3)', borderRadius: 6, fontSize: 12, color: 'var(--warn)' }}>
              ⚠ {claimCountByPlayer[claimPlayer.id]} other team{claimCountByPlayer[claimPlayer.id] > 1 ? 's are' : ' is'} also claiming this player.
              {myWaiverPriority === 1 ? ' You have top priority.' : ` Your priority is #${myWaiverPriority}.`}
            </div>
          )}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
            <div style={{ fontSize: 11, color: openSlots <= 0 ? 'var(--danger)' : 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '.1em' }}>
              Drop a player {openSlots > 0 ? '(optional)' : '(required — roster full)'}
            </div>
            {openSlots > 0 && (
              <span style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--good)', background: 'rgba(76,175,130,.12)', border: '1px solid rgba(76,175,130,.3)', borderRadius: 4, padding: '1px 7px' }}>
                {openSlots} slot{openSlots !== 1 ? 's' : ''} open
              </span>
            )}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 200, overflowY: 'auto', marginBottom: 20 }}>
            {openSlots > 0 && (
              <div
                style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px', borderRadius: 6, cursor: 'pointer', border: `1px solid ${claimDrop === null ? 'var(--accent)' : 'var(--border)'}`, background: claimDrop === null ? 'rgba(198,255,58,.06)' : 'transparent' }}
                onClick={() => setClaimDrop(null)}
              >
                <span className="dim">No drop — add only</span>
              </div>
            )}
            {[...myRosterIds].map(id => {
              const rp = findPlayer(id);
              if (!rp) return null;
              return (
                <div key={id}
                  style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px', borderRadius: 6, cursor: 'pointer', border: `1px solid ${claimDrop === id ? 'var(--danger)' : 'var(--border)'}`, background: claimDrop === id ? 'rgba(255,90,110,.06)' : 'transparent' }}
                  onClick={() => setClaimDrop(id)}
                >
                  <PosBadge pos={rp.pos} />
                  <span style={{ flex: 1 }}>{rp.name}</span>
                  <span className="mono dim" style={{ fontSize: 10 }}>{rp.team}</span>
                </div>
              );
            })}
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            <button
              className="btn primary"
              style={{ flex: 1, opacity: (!draftDone && openSlots <= 0 && !claimDrop) ? 0.4 : 1 }}
              disabled={!draftDone && openSlots <= 0 && !claimDrop}
              onClick={submitClaim}
            >
              {draftDone ? 'Queue Claim' : 'Add to Roster'}
            </button>
            <button className="btn ghost" onClick={() => setClaimPlayer(null)}>Cancel</button>
          </div>
        </div>
      </div>
    )}

    </div>
  );
}

// ─── RosterPanel ─────────────────────────────────────────────────────────────

function RosterPanel({ teamId, myRosterIds, onOpenPlayer }) {
  const team = findTeam(teamId);

  const rosterSettings = React.useMemo(() => {
    try { return JSON.parse(localStorage.getItem('fantasai_league_settings') || 'null'); } catch { return null; }
  }, []);

  const slotFrame  = React.useMemo(() => buildRosterFrame(rosterSettings), [rosterSettings]);
  const fullRoster = React.useMemo(
    () => assignRoster(slotFrame, myRosterIds, {}, findPlayer),
    [slotFrame, myRosterIds],
  );

  const starters   = fullRoster.filter(r => r.slot !== 'BENCH' && r.playerId);
  const totalProj  = starters.reduce((s, r) => s + (findPlayer(r.playerId)?.proj || 0), 0);

  return (
    <div className="roster-panel">
      <div className="roster-panel-head">
        <span className="roster-team-dot" style={{ background: team?.color || 'var(--accent)' }} />
        <div style={{ minWidth: 0 }}>
          <div className="roster-team-name">{team?.name || 'My Roster'}</div>
          <div style={{ fontSize: 10, color: 'var(--text-faint)' }}>
            Proj: <span style={{ color: 'var(--accent)', fontWeight: 600 }}>{totalProj.toFixed(1)}</span>
          </div>
        </div>
      </div>
      <div className="roster-list">
        {fullRoster.map((entry, i) => {
          const p = entry.playerId ? findPlayer(entry.playerId) : null;
          const isBench = entry.slot === 'BENCH';
          return (
            <div
              key={i}
              className={`roster-row${isBench ? ' bench' : ''}`}
              onClick={() => p && onOpenPlayer?.(p.id)}
              style={{ cursor: p ? 'pointer' : 'default' }}
            >
              <span className="roster-slot-tag">{entry.slot}</span>
              {p ? (
                <>
                  <span className="roster-name">{p.name}</span>
                  <span className="roster-team-abbr">{p.team}</span>
                  <span className="roster-proj">{p.proj.toFixed(1)}</span>
                </>
              ) : (
                <span style={{ flex: 1, fontSize: 11, color: 'var(--text-faint)' }}>Empty</span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── helpers ────────────────────────────────────────────────────────────────

function fmtStat(v, dec = 0) {
  if (v == null) return '—';
  return dec > 0 ? Number(v).toFixed(dec) : String(Math.round(v));
}

function LiveBadge() {
  return (
    <span style={{ display:'inline-flex', alignItems:'center', gap:4, fontSize:9,
      fontFamily:'var(--font-mono)', letterSpacing:'.1em', color:'var(--accent-2)',
      background:'rgba(78,168,255,.1)', border:'1px solid rgba(78,168,255,.3)',
      borderRadius:4, padding:'1px 6px', textTransform:'uppercase' }}>
      <span style={{ width:5, height:5, borderRadius:'50%', background:'var(--accent-2)',
        boxShadow:'0 0 6px var(--accent-2)', animation:'pulse 2s infinite', display:'inline-block' }}/>
      Live
    </span>
  );
}

// Position-aware game-log columns — expanded with advanced stats
function glCols(pos) {
  if (pos === 'QB')  return ['Att','Cmp','Cmp%','Yds','TD','INT','Air Yds','Ru Yds','Ru TD','Pts'];
  if (pos === 'RB')  return ['Att','Ru Yds','YPC','TD','Rec','Tgt','Re Yds','Snp','Pts'];
  if (pos === 'K')   return ['FGM','FGA','FG%','Long','XP','Pts'];
  if (pos === 'DST') return ['Sack','INT','FR','TD','PA','Pts'];
  return ['Snp','Tgt','Rec','Yds','Air Yds','YAC','TD','Pts'];  // WR / TE
}

function glRow(pos, s) {
  if (!s) return null;
  const pts = s.pts_half_ppr ?? s.pts_std;
  const pct = (a, b) => (a > 0 && b > 0) ? `${((a/b)*100).toFixed(0)}%` : '—';
  if (pos === 'QB')  return [fmtStat(s.pass_att), fmtStat(s.pass_cmp), pct(s.pass_cmp, s.pass_att), fmtStat(s.pass_yd), fmtStat(s.pass_td), fmtStat(s.pass_int), fmtStat(s.pass_air_yd || s.pass_cmp_air_yd), fmtStat(s.rush_yd), fmtStat(s.rush_td), fmtStat(pts, 1)];
  if (pos === 'RB')  return [fmtStat(s.rush_att), fmtStat(s.rush_yd), (s.rush_att > 0 ? ((s.rush_yd||0)/(s.rush_att)).toFixed(1) : '—'), fmtStat((s.rush_td||0)+(s.rec_td||0)), fmtStat(s.rec), fmtStat(s.rec_tgt), fmtStat(s.rec_yd), fmtStat(s.off_snp), fmtStat(pts, 1)];
  if (pos === 'K')   return [fmtStat(s.fgm), fmtStat(s.fga), pct(s.fgm, s.fga), fmtStat(s.fg_lng), fmtStat(s.xpm), fmtStat(pts, 1)];
  if (pos === 'DST') return [fmtStat(s.sack), fmtStat(s.def_int), fmtStat(s.def_fr), fmtStat(s.def_td), fmtStat(s.pts_allow), fmtStat(pts, 1)];
  return [fmtStat(s.off_snp), fmtStat(s.rec_tgt), fmtStat(s.rec), fmtStat(s.rec_yd), fmtStat(s.rec_air_yd), fmtStat(s.rec_yar), fmtStat(s.rec_td), fmtStat(pts, 1)];
}

// Raw numeric values parallel to glRow — used for percentile coloring
function glRawNums(pos, s) {
  if (!s) return null;
  const pts = s.pts_half_ppr ?? s.pts_std ?? 0;
  if (pos === 'QB')  return [s.pass_att||0, s.pass_cmp||0, s.pass_att>0 ? (s.pass_cmp||0)/s.pass_att*100 : 0, s.pass_yd||0, s.pass_td||0, s.pass_int||0, s.pass_air_yd||s.pass_cmp_air_yd||0, s.rush_yd||0, s.rush_td||0, pts];
  if (pos === 'RB')  return [s.rush_att||0, s.rush_yd||0, s.rush_att>0 ? (s.rush_yd||0)/s.rush_att : 0, (s.rush_td||0)+(s.rec_td||0), s.rec||0, s.rec_tgt||0, s.rec_yd||0, s.off_snp||0, pts];
  if (pos === 'K')   return [s.fgm||0, s.fga||0, s.fga>0 ? (s.fgm||0)/s.fga*100 : 0, s.fg_lng||0, s.xpm||0, pts];
  if (pos === 'DST') return [s.sack||0, s.def_int||0, s.def_fr||0, s.def_td||0, s.pts_allow||0, pts];
  return [s.off_snp||0, s.rec_tgt||0, s.rec||0, s.rec_yd||0, s.rec_air_yd||0, s.rec_yar||0, s.rec_td||0, pts];
}

// true = higher is better (false = lower is better, e.g. INTs, pts_allowed)
function glHigherIsBetter(pos) {
  if (pos === 'QB')  return [true, true, true, true, true, false, true, true, true, true];
  if (pos === 'RB')  return [true, true, true, true, true, true, true, true, true];
  if (pos === 'K')   return [true, true, true, true, true, true];
  if (pos === 'DST') return [true, true, true, true, false, true];
  return [true, true, true, true, true, true, true, true]; // WR / TE
}

// Next Gen Stats — advanced metrics from season totals
function NextGenStatsPanel({ pos, tot, gp, player }) {
  if (!tot || !gp) return <div className="dim" style={{ fontSize: 12, padding: 8 }}>Next Gen Stats require live Sleeper data. Enable Sleeper API in Sources.</div>;

  const v = (a, b) => (b > 0 ? parseFloat((a/b).toFixed(1)) : null);
  const yac = tot.rec_yar > 0 ? tot.rec_yar : (player?.yac || 0);
  const pctVal = (a, b) => (b > 0 ? parseFloat(((a/b)*100).toFixed(1)) : null);

  const Section = ({ title, children }) => (
    <div className="card" style={{ marginBottom: 14 }}>
      <div className="card-head"><div className="card-title" style={{ fontSize: 11, letterSpacing: '.08em' }}>{title}</div></div>
      <div className="card-body">{children}</div>
    </div>
  );

  if (pos === 'QB') return (
    <>
      <Section title="PASSING — ADVANCED">
        <SeasonStatBar label="Att / Game" val={v(tot.pass_att, gp)} max={45} leagueAvg={33} />
        <SeasonStatBar label="Comp %" val={pctVal(tot.pass_cmp, tot.pass_att) != null ? pctVal(tot.pass_cmp, tot.pass_att) + '%' : '—'} max={100} leagueAvg={65} />
        <SeasonStatBar label="Yds / Attempt" val={v(tot.pass_yd, tot.pass_att)} max={10} leagueAvg={7.0} />
        <SeasonStatBar label="Pass TDs" val={Math.round(tot.pass_td || 0)} max={45} leagueAvg={22} />
        <SeasonStatBar label="TD/INT Ratio" val={tot.pass_int > 0 ? ((tot.pass_td||0)/tot.pass_int).toFixed(1) : '—'} max={6} leagueAvg={2.2} />
        <SeasonStatBar label="Rush Yds / Game" val={v(tot.rush_yd, gp)} max={60} leagueAvg={15} />
      </Section>
      <Section title="FANTASY PRODUCTION">
        <SeasonStatBar label="Pts / Game (Half PPR)" val={v(tot.pts_half_ppr, gp)} max={30} leagueAvg={16} />
        <SeasonStatBar label="Season Total" val={tot.pts_half_ppr ? Math.round(tot.pts_half_ppr) : '—'} max={400} leagueAvg={265} />
      </Section>
    </>
  );

  if (pos === 'RB') return (
    <>
      <Section title="RUSHING — ADVANCED">
        <SeasonStatBar label="Carries / Game" val={v(tot.rush_att, gp)} max={25} leagueAvg={12} />
        <SeasonStatBar label="Yards / Carry" val={v(tot.rush_yd, tot.rush_att)} max={7} leagueAvg={4.3} />
        <SeasonStatBar label="Rush TDs" val={Math.round(tot.rush_td || 0)} max={18} leagueAvg={6} />
        <SeasonStatBar label="Rush Yds / Game" val={v(tot.rush_yd, gp)} max={120} leagueAvg={55} />
      </Section>
      <Section title="RECEIVING ROLE">
        <SeasonStatBar label="Targets / Game" val={v(tot.rec_tgt, gp)} max={8} leagueAvg={2.8} />
        <SeasonStatBar label="Catch %" val={pctVal(tot.rec, tot.rec_tgt) != null ? pctVal(tot.rec, tot.rec_tgt) + '%' : '—'} max={100} leagueAvg={75} />
        <SeasonStatBar label="Rec Yds / Game" val={v(tot.rec_yd, gp)} max={60} leagueAvg={16} />
        <SeasonStatBar label="ADOT" val={tot.rec_tgt > 0 ? v(tot.rec_air_yd, tot.rec_tgt) : (player?.adot ?? '—')} max={8} leagueAvg={1.5} />
        <SeasonStatBar label="Air Yards Total" val={tot.rec_air_yd > 0 ? Math.round(tot.rec_air_yd) : (player?.airYds ? Math.round(player.airYds) : '—')} max={500} leagueAvg={100} />
        <SeasonStatBar label="YAC Total" val={yac > 0 ? Math.round(yac) : '—'} max={600} leagueAvg={150} />
        <SeasonStatBar label="YAC / Rec" val={yac > 0 && tot.rec > 0 ? parseFloat((yac / tot.rec).toFixed(1)) : '—'} max={10} leagueAvg={4.5} />
      </Section>
      <Section title="FANTASY PRODUCTION">
        <SeasonStatBar label="Pts / Game (Half PPR)" val={v(tot.pts_half_ppr, gp)} max={25} leagueAvg={10} />
        <SeasonStatBar label="Touches / Game" val={v((tot.rush_att||0)+(tot.rec||0), gp)} max={30} leagueAvg={15} />
      </Section>
    </>
  );

  if (pos === 'WR' || pos === 'TE') return (
    <>
      <Section title="TARGET PROFILE">
        <SeasonStatBar label="Targets / Game" val={v(tot.rec_tgt, gp)} max={pos === 'TE' ? 10 : 12} leagueAvg={pos === 'TE' ? 4.5 : 5.5} />
        <SeasonStatBar label="Catch %" val={pctVal(tot.rec, tot.rec_tgt) != null ? pctVal(tot.rec, tot.rec_tgt) + '%' : '—'} max={100} leagueAvg={pos === 'TE' ? 72 : 65} />
        <SeasonStatBar label="ADOT" val={tot.rec_tgt > 0 ? v(tot.rec_air_yd, tot.rec_tgt) : (player?.adot ?? '—')} max={20} leagueAvg={pos === 'TE' ? 7.5 : 10.5} />
        <SeasonStatBar label="Air Yards Total" val={tot.rec_air_yd > 0 ? Math.round(tot.rec_air_yd) : (player?.airYds ? Math.round(player.airYds) : '—')} max={1800} leagueAvg={pos === 'TE' ? 350 : 600} />
      </Section>
      <Section title="AFTER THE CATCH">
        <SeasonStatBar label="YAC Total" val={yac > 0 ? Math.round(yac) : '—'} max={800} leagueAvg={pos === 'TE' ? 180 : 250} />
        <SeasonStatBar label="YAC / Rec" val={yac > 0 && tot.rec > 0 ? parseFloat((yac / tot.rec).toFixed(1)) : '—'} max={12} leagueAvg={pos === 'TE' ? 4.5 : 5.0} />
        <SeasonStatBar label="Yds / Target" val={v(tot.rec_yd, tot.rec_tgt)} max={15} leagueAvg={pos === 'TE' ? 6.5 : 7.5} />
        <SeasonStatBar label="Yds / Rec" val={v(tot.rec_yd, tot.rec)} max={20} leagueAvg={pos === 'TE' ? 9.0 : 11.0} />
      </Section>
      <Section title="FANTASY PRODUCTION">
        <SeasonStatBar label="Pts / Game (Half PPR)" val={v(tot.pts_half_ppr, gp)} max={25} leagueAvg={pos === 'TE' ? 8 : 10} />
        <SeasonStatBar label="TD Rate" val={pctVal(tot.rec_td, tot.rec_tgt) != null ? pctVal(tot.rec_td, tot.rec_tgt) + '%' : '—'} max={15} leagueAvg={pos === 'TE' ? 5 : 4} />
      </Section>
    </>
  );

  if (pos === 'K') return (
    <Section title="KICKER ACCURACY">
      <SeasonStatBar label="FG %" val={pctVal(tot.fgm, tot.fga) != null ? pctVal(tot.fgm, tot.fga) + '%' : '—'} max={100} leagueAvg={85} />
      <SeasonStatBar label="FGM / Game" val={v(tot.fgm, gp)} max={3} leagueAvg={1.8} />
      <SeasonStatBar label="Long (season)" val={Math.round(tot.fg_lng || 0)} max={65} leagueAvg={52} />
      <SeasonStatBar label="Pts / Game" val={v(tot.pts_std, gp)} max={15} leagueAvg={8} />
    </Section>
  );

  if (pos === 'DST') return (
    <Section title="DEFENSE METRICS">
      <SeasonStatBar label="Sacks / Game" val={v(tot.sack, gp)} max={5} leagueAvg={2.2} />
      <SeasonStatBar label="INTs (season)" val={Math.round(tot.def_int || 0)} max={25} leagueAvg={12} />
      <SeasonStatBar label="Forced Fumbles" val={Math.round(tot.def_fr || 0)} max={15} leagueAvg={8} />
      <SeasonStatBar label="Def TDs" val={Math.round(tot.def_td || 0)} max={5} leagueAvg={2} />
      <SeasonStatBar label="Pts Allowed / Game" val={v(tot.pts_allow, gp)} max={35} leagueAvg={22} />
      <SeasonStatBar label="Fantasy Pts / Game" val={v(tot.pts_std, gp)} max={15} leagueAvg={7} />
    </Section>
  );

  return <div className="dim" style={{ fontSize: 12 }}>Advanced stats not available for this position.</div>;
}

// 2025 NFL starter averages (top fantasy-relevant players per position)
const LEAGUE_AVG_STATS = {
  QB: { pass_yd: 3500, pass_td: 23, pass_cmp: 260, pass_int: 11, rush_yd: 185, pts_half_ppr: 265 },
  RB: { rush_att: 165, rush_yd: 780, rush_td: 6, rec: 36, rec_yd: 275, pts_half_ppr: 160 },
  WR: { rec_tgt: 80, rec: 52, rec_yd: 700, rec_td: 5, rec_yac: 225, catch_pct: 68, yac_per_rec: 5.0, pts_half_ppr: 155 },
  TE: { rec_tgt: 58, rec: 40, rec_yd: 490, rec_td: 4, rec_yac: 130, catch_pct: 72, yac_per_rec: 4.5, pts_half_ppr: 115 },
};

// ─── PlayerNewsCard ───────────────────────────────────────────────────────────
function PlayerNewsCard({ items = [], loading = false, playerName = '' }) {
  if (loading) {
    return (
      <div className="card">
        <div className="card-head">
          <div className="card-title">News · {playerName}</div>
        </div>
        <div style={{ padding:'12px 16px', display:'flex', alignItems:'center', gap:8 }}>
          <div className="ai-orb" style={{ width:14, height:14 }} />
          <span className="dim" style={{ fontSize:12 }}>Fetching news from all sources…</span>
        </div>
      </div>
    );
  }
  const sources = [...new Set(items.map(n => n.source))];
  return (
    <div className="card">
      <div className="card-head">
        <div className="card-title">News · {playerName}</div>
        {sources.length > 0 && (
          <div style={{ display:'flex', gap:4, flexWrap:'wrap' }}>
            {sources.map(s => <SourceBadge key={s} source={s} />)}
          </div>
        )}
      </div>
      <div className="card-body" style={{ padding:0 }}>
        {items.length === 0 ? (
          <div style={{ padding:'12px 16px', fontSize:12, color:'var(--text-faint)' }}>
            No recent news found. Try refreshing your data sources.
          </div>
        ) : items.map((n, i) => {
          const color = n.sourceColor || SOURCE_META[n.source]?.color || 'var(--accent-2)';
          // Prefer source's own publication date; fall back to our fetch time
          const pubTs   = n.publishedAt || null;
          const fetchTs = n.fetchedAt   || null;
          function fmtTs(ts) {
            if (!ts) return null;
            const d = new Date(ts);
            const now2 = new Date();
            const time = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
            if (d.toDateString() === now2.toDateString()) return `Today ${time}`;
            const yest = new Date(now2); yest.setDate(yest.getDate() - 1);
            if (d.toDateString() === yest.toDateString()) return `Yesterday ${time}`;
            return `${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} ${time}`;
          }
          const pubStr   = fmtTs(pubTs);
          const fetchStr = fmtTs(fetchTs);
          const showFetchStr = fetchStr && (!pubStr || Math.abs((fetchTs||0) - (pubTs||0)) > 5 * 60 * 1000);
          return (
            <div key={i} style={{ padding:'10px 16px', borderTop: i > 0 ? '1px solid var(--border)' : 'none', background: i % 2 !== 0 ? 'rgba(255,255,255,.015)' : 'transparent' }}>
              <div style={{ display:'flex', alignItems:'center', gap:6, marginBottom:5, flexWrap:'wrap' }}>
                <span style={{ fontSize:9, fontFamily:'var(--font-mono)', fontWeight:700, padding:'2px 6px', borderRadius:3, background:`${color}22`, color, border:`1px solid ${color}55`, whiteSpace:'nowrap' }}>
                  {n.source}
                </span>
                {pubStr && (
                  <span style={{ fontSize:10, color:'var(--accent)', fontFamily:'var(--font-mono)' }} title="Date source published this">
                    {pubStr}
                  </span>
                )}
                {showFetchStr && (
                  <span style={{ fontSize:10, color:'var(--text-faint)', fontFamily:'var(--font-mono)' }} title="When we fetched this">
                    {pubStr ? `(fetched ${fetchStr})` : fetchStr}
                  </span>
                )}
                {n.mins != null && !pubStr && !fetchStr && (
                  <span style={{ fontSize:10, color:'var(--text-faint)', fontFamily:'var(--font-mono)' }}>
                    {n.mins < 60 ? `${n.mins}m ago` : `${Math.floor(n.mins/60)}h ago`}
                  </span>
                )}
                <span style={{ flex:1 }} />
                {n.impact && n.impact !== 'low' && (
                  <span className={`news-impact impact-${n.impact}`} style={{ fontSize:9, padding:'1px 6px' }}>
                    {n.impact === 'good' ? 'BOOST' : n.impact?.toUpperCase()}
                  </span>
                )}
              </div>
              {n.title && <div style={{ fontSize:12, fontWeight:600, marginBottom:n.body ? 3 : 0, lineHeight:1.4 }}>{n.title}</div>}
              {n.body  && <div style={{ fontSize:11, color:'var(--text-dim)', lineHeight:1.6 }}>{n.body}</div>}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── PlayerArticlesCard ───────────────────────────────────────────────────────

function PlayerArticlesCard({ articles = [], loading = false }) {
  if (loading) return (
    <div className="card" style={{ marginTop: 12 }}>
      <div className="card-head"><div className="card-title">AI Summaries</div><div className="ai-orb" style={{ width: 12, height: 12 }} /></div>
      <div style={{ padding: '10px 16px', fontSize: 12, color: 'var(--text-faint)' }}>Loading AI summaries…</div>
    </div>
  );
  if (!articles.length) return null;
  return (
    <div className="card" style={{ marginTop: 12 }}>
      <div className="card-head">
        <div className="card-title">AI Summaries</div>
        <span style={{ fontSize: 9, color: 'var(--text-faint)', fontFamily: 'var(--font-mono)' }}>{articles.length} article{articles.length !== 1 ? 's' : ''}</span>
      </div>
      <div className="card-body" style={{ padding: 0 }}>
        {articles.map((a, i) => {
          const pub     = a.published_at ? new Date(a.published_at) : null;
          const pubStr  = pub ? pub.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : null;
          const isAi    = !!(a.ai_processed || a.summary_text || a.fantasy_insight);
          const insight = a.fantasy_insight || '';
          const summary = a.summary_text || '';
          const desc    = a.description || a.full_text || a.summary || '';
          const url     = a.article_url || a.source_url || '';
          return (
            <div key={i} style={{ padding: '10px 16px', borderTop: i > 0 ? '1px solid var(--border)' : 'none' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 5, flexWrap: 'wrap' }}>
                {isAi && <span style={{ fontSize: 9, fontFamily: 'var(--font-mono)', fontWeight: 700, color: 'var(--accent)', background: 'rgba(198,255,58,.1)', borderRadius: 3, padding: '1px 5px', border: '1px solid rgba(198,255,58,.2)' }}>AI</span>}
                <span style={{ fontSize: 9, fontFamily: 'var(--font-mono)', fontWeight: 700, padding: '2px 6px', borderRadius: 3, background: 'rgba(78,168,255,.12)', color: '#4ea8ff', border: '1px solid rgba(78,168,255,.25)' }}>{a.publisher || 'FantasAI'}</span>
                {pubStr && <span style={{ fontSize: 10, color: 'var(--text-faint)', fontFamily: 'var(--font-mono)', marginLeft: 'auto' }}>{pubStr}</span>}
              </div>
              <div style={{ fontSize: 12, fontWeight: 600, lineHeight: 1.4, marginBottom: (insight || summary || desc) ? 4 : 0 }}>{a.headline || a.title}</div>
              {insight && <div style={{ fontSize: 11, color: 'var(--accent)', lineHeight: 1.5, marginBottom: summary ? 3 : 0 }}>Fantasy: {insight}</div>}
              {summary && <div style={{ fontSize: 11, color: 'var(--text-dim)', lineHeight: 1.5, marginBottom: 0 }}>{summary.slice(0, 240)}{summary.length > 240 ? '…' : ''}</div>}
              {!summary && !insight && desc && <div style={{ fontSize: 11, color: 'var(--text-dim)', lineHeight: 1.5 }}>{desc.slice(0, 220)}{desc.length > 220 ? '…' : ''}</div>}
              {url && <a href={url} target="_blank" rel="noopener noreferrer" style={{ fontSize: 10, color: '#4ea8ff', textDecoration: 'none', display: 'inline-block', marginTop: 4 }}>Read Article ↗</a>}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── PlayerDetail ─────────────────────────────────────────────────────────────

export function PlayerDetail({ player, onClose, myRosterIds = new Set(), onAddPlayer, onTradePlayer, sourcesState }) {
  if (!player) return null;
  const { data: r2DefVsPos } = useR2DefenseVsPos();
  const { data: r2RookieScoresData } = useR2RookieScores();
  const { data: r2CollegeStatsRaw } = useR2CollegeStats();
  const { data: r2OlineIndex } = useR2OlineIndex();
  const { data: r2OlineIndexWeekly } = useR2OlineIndexWeekly();
  const { data: r2TeamHistory } = useR2PlayerTeamHistory();
  const { data: r2WeaponScores } = useR2WeaponScores();
  const { data: r2TeamSupport } = useR2TeamSupportScores();
  const { data: r2OlineStability } = useR2OlineStability();
  const { data: r2PlayerOlineStability } = useR2PlayerOlineStability();
  const collegeStats = React.useMemo(() => {
    if (!player.rookie || !r2CollegeStatsRaw) return null;
    const arr = Array.isArray(r2CollegeStatsRaw) ? r2CollegeStatsRaw : r2CollegeStatsRaw?.data || [];
    const rows = matchCollegeRows(arr, player.name).sort((a, b) => (a.season || 0) - (b.season || 0));
    return rows.length > 0 ? rows : null;
  }, [player, r2CollegeStatsRaw]);
  const detailRookieData = React.useMemo(() => {
    if (!player.rookie || !r2RookieScoresData?.players) return null;
    const key = player.name?.toLowerCase().trim();
    return r2RookieScoresData.players.find(r => r.player_name?.toLowerCase().trim() === key) ?? null;
  }, [player, r2RookieScoresData]);
  // Efficiency Profile — EPA/play, success rate, explosive rate, opportunity/efficiency scores,
  // all derived from nflverse play-by-play (player_efficiency_stats / breakout_candidates.json).
  const { data: r2BreakoutsDetail } = useR2BreakoutCandidates();
  const efficiencyData = React.useMemo(() => {
    if (!Array.isArray(r2BreakoutsDetail)) return null;
    const key = player.name?.toLowerCase().trim();
    return r2BreakoutsDetail.find(b => b.player_name?.toLowerCase().trim() === key) ?? null;
  }, [player, r2BreakoutsDetail]);
  const [activeTab, setTab] = React.useState('overview');
  const [added, setAdded] = React.useState(false);
  // Show 2025 stats until 2026 Week 1 is complete (~Sep 9 2026)
  const [statYear, setStatYear] = React.useState(() => new Date() >= new Date('2026-09-09') ? 2026 : 2025);

  // Which team the player suited up for in statYear, and that team's O-Line Index for
  // that season — surfaces situation changes (e.g. RB moved from a bad line to a good one).
  const yearTeam = React.useMemo(() => {
    const key = player.name?.toLowerCase().trim();
    const rec = r2TeamHistory?.players?.find(p => p.player_name?.toLowerCase().trim() === key);
    const seasonRec = rec?.seasons?.[String(statYear)];
    return seasonRec?.team || (statYear >= 2026 ? player.team : null) || null;
  }, [r2TeamHistory, player, statYear]);
  const yearOline = React.useMemo(() => {
    if (!yearTeam || !r2OlineIndex?.teams) return null;
    return r2OlineIndex.teams[yearTeam]?.[String(statYear)] ?? null;
  }, [r2OlineIndex, yearTeam, statYear]);

  // Offensive Ecosystem: this player's Weapon Score (WR/TE/RB) and, for QBs, their
  // team's Support Score — always the latest season available, same as yearOline above
  // conceptually but not year-toggle-driven since the underlying data only covers the
  // current season today.
  const weaponScore = React.useMemo(() => {
    if (!Array.isArray(r2WeaponScores?.players)) return null;
    const key = player.name?.toLowerCase().trim();
    const rows = r2WeaponScores.players.filter(w => w.player_name?.toLowerCase().trim() === key);
    return rows.length ? rows.sort((a, b) => b.season - a.season)[0] : null;
  }, [r2WeaponScores, player]);
  const supportScore = React.useMemo(() => {
    const teamRec = r2TeamSupport?.teams?.[yearTeam];
    if (!teamRec) return null;
    const latest = Object.keys(teamRec).map(Number).sort((a, b) => b - a)[0];
    return teamRec[String(latest)] ?? null;
  }, [r2TeamSupport, yearTeam]);
  // O-Line Stability Index — continuity/chemistry/health/experience, no
  // fabricated grades, real counting stats only (real starts/snaps/penalties).
  const teamOlStability = React.useMemo(() => {
    const teamRec = r2OlineStability?.teams?.[yearTeam];
    if (!teamRec) return null;
    const latest = Object.keys(teamRec).map(Number).sort((a, b) => b - a)[0];
    return teamRec[String(latest)] ?? null;
  }, [r2OlineStability, yearTeam]);
  // O-Line vs last year — real nflverse-derived overall_score/overall_rank
  // from oline_index.json, comparing the most recent season on file against
  // the one before it (same "latest year" basis the Ecosystem tab's other
  // O-Line cards already use, independent of the Game Log year-tab selector).
  const olineYoY = React.useMemo(() => {
    const teamRec = r2OlineIndex?.teams?.[yearTeam];
    if (!teamRec) return null;
    const years = Object.keys(teamRec).map(Number).sort((a, b) => b - a);
    const latest = years[0];
    if (latest == null) return null;
    // Only show once real play-by-play exists for the actual current
    // calendar year — before that (e.g. 2026 preseason, before Sept kickoff),
    // "latest" is really last season, and showing it as if it were a live
    // comparison for the year about to start is misleading. The medallion
    // reappears automatically the moment this season's real data lands.
    if (latest !== new Date().getFullYear()) return null;
    const cur = teamRec[String(latest)];
    const prev = teamRec[String(latest - 1)];
    if (!cur || !prev) return null;
    return {
      year: latest,
      prevYear: latest - 1,
      scoreDelta: cur.overall_score - prev.overall_score,
      rankDelta: prev.overall_rank - cur.overall_rank, // positive = improved (lower rank number is better)
      cur,
      prev,
    };
  }, [r2OlineIndex, yearTeam]);
  // O-Line vs last week — same real-data gating as olineYoY: only shows once
  // this actual calendar year has at least two weeks of real play-by-play,
  // so it can never present a stale prior season as if it were "this week."
  const olineWoW = React.useMemo(() => {
    const nowYear = new Date().getFullYear();
    const seasonRec = r2OlineIndexWeekly?.teams?.[yearTeam]?.[String(nowYear)];
    if (!seasonRec) return null;
    const weeks = Object.keys(seasonRec).map(Number).sort((a, b) => b - a);
    const latestWeek = weeks[0];
    if (latestWeek == null) return null;
    const cur = seasonRec[String(latestWeek)];
    const prev = seasonRec[String(latestWeek - 1)];
    if (!cur || !prev) return null;
    return {
      week: latestWeek,
      prevWeek: latestWeek - 1,
      scoreDelta: cur.overall_score - prev.overall_score,
      rankDelta: prev.overall_rank - cur.overall_rank,
      cur,
      prev,
    };
  }, [r2OlineIndexWeekly, yearTeam]);
  // Name -> rookie flag lookup for the O-Line Starters card, sourced from the
  // same player store (export_players_2026_draft.json's real `is_rookie`
  // field) everywhere else in the app uses — not a fabricated signal.
  // Calls usePlayers() independently (rather than reusing allPlayersForRank,
  // declared later in this component) to avoid a temporal-dead-zone error.
  const playersForRookieLookup = usePlayers();
  const rookieByName = React.useMemo(() => {
    const map = new Map();
    for (const p of playersForRookieLookup) {
      if (p.name) map.set(p.name.toLowerCase().trim(), !!p.rookie);
    }
    return map;
  }, [playersForRookieLookup]);
  // Which O-Line starter slots changed personnel vs last year, so the O-Line
  // Starters card can flag them — colored by whether the team's overall
  // O-Line score (a real play-by-play-derived metric, not a fabricated grade)
  // improved or declined year over year, since no per-player performance
  // grade exists in this data to attribute the change to the individual.
  // Which O-Line starter slots changed personnel vs last year — computed
  // independently of whether real current-season team-level O-Line data
  // exists yet (olineYoY), since a rookie replacing a departed starter can
  // be evaluated on draft capital (olineRookieScoreByName below) before a
  // single real snap is played, even though the TEAM-trend-based coloring
  // (olineYoY) genuinely can't exist until then.
  const olineStartersYoY = React.useMemo(() => {
    const teamRec = r2TeamSupport?.teams?.[yearTeam];
    if (!teamRec) return null;
    const years = Object.keys(teamRec).map(Number).sort((a, b) => b - a);
    const latest = years[0];
    if (latest == null) return null;
    const curStarters = teamRec[String(latest)]?.oline_starters || {};
    const prevStarters = teamRec[String(latest - 1)]?.oline_starters || {};
    if (!Object.keys(prevStarters).length) return null;
    return { curStarters, prevStarters, teamImproved: olineYoY ? olineYoY.scoreDelta > 0 : null };
  }, [r2TeamSupport, yearTeam, olineYoY]);
  // Name -> O-line rookie draft-capital score (see ingest_oline_rookie_scores.py —
  // the one real signal available for a rookie starter before he's played a
  // down for this team: no fantasy production or 2026 combine data exists to
  // build a fuller score the way skill-position rookies get one).
  const { data: r2OlineRookieScores } = useR2OlineRookieScores();
  const olineRookieScoreByName = React.useMemo(() => {
    const map = new Map();
    for (const p of (r2OlineRookieScores?.players || [])) {
      if (p.player_name) map.set(p.player_name.toLowerCase().trim(), p.draft_capital_score);
    }
    return map;
  }, [r2OlineRookieScores]);
  const olLinemen = React.useMemo(() => {
    if (!Array.isArray(r2PlayerOlineStability?.players) || !yearTeam) return [];
    const seasons = r2PlayerOlineStability.players
      .filter(p => p.team === yearTeam)
      .map(p => p.season);
    if (!seasons.length) return [];
    const latest = Math.max(...seasons);
    return r2PlayerOlineStability.players
      .filter(p => p.team === yearTeam && p.season === latest)
      .sort((a, b) => (b.is_primary_starter ? 1 : 0) - (a.is_primary_starter ? 1 : 0) || b.starts - a.starts);
  }, [r2PlayerOlineStability, yearTeam]);
  const [fetchedNewsItems, setFetchedNewsItems] = React.useState([]);
  const [newsLoading, setNewsLoading] = React.useState(true);
  const [playerArticles,  setPlayerArticles]  = React.useState([]);
  const [articlesLoading, setArticlesLoading] = React.useState(true);
  const [lineageTx,    setLineageTx]    = React.useState([]);
  const [lineagePicks, setLineagePicks] = React.useState([]);
  const [lineageLoading, setLineageLoading] = React.useState(true);

  // Start/Sit advice — same source Current Roster uses, so every player gets
  // evaluated the same way regardless of whether they're rostered.
  const { data: r2StartSitRaw } = useR2WeeklyStartSit();
  const startSit = React.useMemo(() => {
    const players = r2StartSitRaw?.players || {};
    const key = player.name?.toLowerCase().trim();
    if (!key) return null;
    for (const [name, entry] of Object.entries(players)) {
      if (name.toLowerCase().trim() === key) return entry;
    }
    return null;
  }, [r2StartSitRaw, player.name]);

  React.useEffect(() => {
    setAdded(false);
    setStatYear(new Date() >= new Date('2026-09-09') ? 2026 : 2025);
  }, [player.id]);

  React.useEffect(() => {
    let cancelled = false;
    setLineageLoading(true);
    Promise.all([api.transactions.get(), api.draftPicks.get()]).then(([tx, picks]) => {
      if (cancelled) return;
      setLineageTx(Array.isArray(tx) ? tx : []);
      setLineagePicks(Array.isArray(picks) ? picks : []);
      setLineageLoading(false);
    }).catch(() => { if (!cancelled) setLineageLoading(false); });
    return () => { cancelled = true; };
  }, []);

  // Ownership history — drafted → added/dropped/swapped/claimed → traded, chronologically.
  const lineage = React.useMemo(() => {
    const key = player.name?.toLowerCase().trim();
    const matchesPlayer = pl => pl && (pl.id === player.id || pl.name?.toLowerCase().trim() === key);
    const events = [];

    const pick = lineagePicks.find(p => p.playerId === player.id);
    if (pick) {
      const team = findTeam(pick.teamId);
      events.push({
        ts: pick.pickedAt || null,
        icon: '📋',
        color: '#a78bfa',
        label: `Drafted by ${team?.name || `Team ${pick.teamId}`}`,
        sub: pick.round != null ? `Round ${pick.round}${pick.pickNum != null ? ` · Pick ${pick.pickNum}` : ''}` : null,
      });
    }

    for (const tx of lineageTx) {
      if (Array.isArray(tx.players)) {
        const entry = tx.players.find(matchesPlayer);
        if (entry) {
          const team = findTeam(tx.teamId);
          const teamName = team?.name || tx.teamName || 'Unknown Team';
          const isAdd = entry.action === 'add';
          const label = isAdd
            ? (tx.type === 'waiver_claim' ? `Claimed off waivers by ${teamName}`
              : tx.type === 'swap' ? `Added by ${teamName} (swap)`
              : `Added by ${teamName}`)
            : `Dropped by ${teamName}`;
          events.push({
            ts: tx.timestamp,
            icon: isAdd ? '➕' : '➖',
            color: isAdd ? '#4caf82' : '#ff5a6e',
            label,
            sub: (tx.type === 'waiver_claim' && tx.waiverPick != null) ? `Claim #${tx.waiverPick}${tx.newWaiverPick != null ? ` → #${tx.newWaiverPick}` : ''}` : null,
          });
        }
      } else if (tx.type === 'trade') {
        const inGave = (tx.gave || []).some(matchesPlayer);
        const inGot  = (tx.got  || []).some(matchesPlayer);
        if (inGave || inGot) {
          const txTeam    = findTeam(tx.teamId);
          const otherTeam = findTeam(tx.otherTeamId);
          const fromTeam = inGave ? txTeam : otherTeam;
          const toTeam   = inGave ? otherTeam : txTeam;
          events.push({
            ts: tx.timestamp,
            icon: '↔',
            color: '#4ea8ff',
            label: `Traded from ${fromTeam?.name || 'Unknown Team'} to ${toTeam?.name || 'Unknown Team'}`,
            sub: null,
          });
        }
      }
    }

    events.sort((a, b) => (a.ts ? new Date(a.ts).getTime() : 0) - (b.ts ? new Date(b.ts).getTime() : 0));
    return events;
  }, [lineagePicks, lineageTx, player.id, player.name]);

  React.useEffect(() => {
    let cancelled = false;
    setFetchedNewsItems([]);
    setNewsLoading(true);
    async function fetchPlayerNews() {
      const items = [];
      const nameParts = player.name.trim().split(' ');
      const firstName = nameParts[0];
      const lastName  = nameParts.slice(1).join(' ');
      const now = Date.now();
      try {
        const [cbsRes, espnRes] = await Promise.allSettled([
          fetch(`${API_BASE}/api/v1/cbs/players`).then(r => r.ok ? r.json() : null),
          fetch(`${API_BASE}/api/v1/nfl/news?limit=50`).then(r => r.ok ? r.json() : null),
        ]);
        if (cancelled) return;

        if (cbsRes.status === 'fulfilled' && cbsRes.value?.players) {
          const fl = firstName.toLowerCase();
          const ll = lastName.toLowerCase();
          const match = cbsRes.value.players.find(p => {
            const n = (p.name || '').toLowerCase();
            return n.includes(fl) && n.includes(ll);
          });
          if (match && (match.newsTitle || match.news)) {
            const cbsDate = match.newsDate || match.updatedDate || null;
            items.push({
              source: 'CBS Sports',
              sourceColor: '#0d4ea2',
              title: match.newsTitle || null,
              body:  match.news     || null,
              fetchedAt:   now,
              publishedAt: cbsDate ? new Date(cbsDate).getTime() || null : null,
              impact: /^out$/i.test(match.status||'') ? 'bad'
                : /questionable/i.test(match.status||'') ? 'medium'
                : 'low',
            });
          }
        }

        if (espnRes.status === 'fulfilled' && espnRes.value?.articles) {
          const fl = firstName.toLowerCase();
          const ll = lastName.toLowerCase();
          for (const art of espnRes.value.articles) {
            const text = `${art.headline||''} ${art.description||''}`.toLowerCase();
            if (text.includes(fl) && text.includes(ll)) {
              items.push({
                source: 'ESPN',
                sourceColor: '#cc0000',
                title: art.headline    || null,
                body:  art.description || null,
                fetchedAt:   now,
                publishedAt: art.published ? new Date(art.published).getTime() : null,
                impact: 'low',
              });
            }
          }
        }
      } catch { /* network error — show whatever we have */ }
      if (!cancelled) {
        setFetchedNewsItems(items);
        setNewsLoading(false);
      }
    }
    fetchPlayerNews();
    return () => { cancelled = true; };
  }, [player.id]);

  React.useEffect(() => {
    let cancelled = false;
    setPlayerArticles([]);
    setArticlesLoading(true);
    const nameLow = player.name.toLowerCase().trim();
    fetch(`${API_BASE}/api/v1/news/articles?limit=500`, { signal: AbortSignal.timeout(15000) })
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (cancelled || !data) return;
        const arr = Array.isArray(data.articles) ? data.articles : [];
        const matched = arr.filter(a => {
          const pn = (a.player_name || a.primary_player_name || '').toLowerCase().trim();
          if (!pn) return false;
          return pn === nameLow || nameLow.startsWith(pn) || pn.startsWith(nameLow.split(' ').slice(-1)[0]);
        }).slice(0, 12);
        setPlayerArticles(matched);
      })
      .catch(() => {})
      .finally(() => { if (!cancelled) setArticlesLoading(false); });
    return () => { cancelled = true; };
  }, [player.id]);

  const isOnRoster    = myRosterIds.has(player.id);
  // TEAM_ROSTERS is a plain mutable object — mutating it (which the async
  // server refresh inside buildOwnerMap's refreshTeamRosters() call does
  // once it resolves) doesn't itself trigger a re-render. Without this
  // version bump the owner map would permanently freeze on whatever
  // TEAM_ROSTERS held the instant this popup first opened (same bug already
  // found and fixed in HeadToHead.jsx's allTeamRosters).
  const [ownerMapVersion, setOwnerMapVersion] = React.useState(0);
  React.useEffect(() => {
    refreshTeamRostersFromServer().then(() => setOwnerMapVersion(v => v + 1));
  }, []);
  const ownerMap      = React.useMemo(() => buildOwnerMap(), [ownerMapVersion]);
  const ownerTeamId   = isOnRoster ? null : (ownerMap[player.id] ?? null);
  const ownerTeam     = ownerTeamId ? findTeam(ownerTeamId) : null;
  const isOwnedByOther = !!ownerTeamId;
  const sleeperEnabled = sourcesState?.freeApis?.['sleeper-api'] !== false;

  // player.opp comes from the draft export, which isn't populated with next-season
  // matchups until the schedule lands there — fall back to the live ESPN schedule map.
  const scheduleOppMap = useScheduleOppMap();
  const displayOpp = player.opp || scheduleOppMap.get(player.team) || '';

  // Position-specific matchup rating for this player
  const detailMatchupRating = React.useMemo(() => {
    if (!r2DefVsPos?.data?.length || !displayOpp || player.pos === 'DST') return null;
    const oppTeam = displayOpp.replace(/^@/, '').toUpperCase();
    const posKey  = player.pos;
    const row = r2DefVsPos.data.find(
      r => r.def_team?.toUpperCase() === oppTeam && r.position === posKey
    );
    if (!row) return null;
    const rank = row.rank_vs_pos;
    return {
      rank,
      avg_pts_allowed: row.avg_pts_allowed,
      score: rank <= 5  ? -2
           : rank <= 10 ? -1
           : rank >= 28 ? 2
           : rank >= 23 ? 1
           : 0,
      label: rank <= 5  ? 'AVOID'
           : rank <= 10 ? 'TOUGH'
           : rank >= 28 ? 'SMASH SPOT'
           : rank >= 23 ? 'FAVORABLE'
           : 'NEUTRAL',
      color: rank <= 5  ? '#ff5a6e'
           : rank <= 10 ? '#ff9f3f'
           : rank >= 28 ? '#4ed87b'
           : rank >= 23 ? '#4ea8ff'
           : 'var(--text-faint)',
    };
  }, [r2DefVsPos, displayOpp, player.pos]);

  const { data: detailBreakouts } = useR2BreakoutCandidates();
  const detailOppScore = React.useMemo(() => {
    if (!detailBreakouts?.length) return null;
    const key = player.name.toLowerCase().trim();
    return detailBreakouts.find(b => (b.player_name || '').toLowerCase().trim() === key)?.opportunity_score ?? null;
  }, [detailBreakouts, player.name]);

  const { data: allWriteups } = useR2PlayerWriteups();
  const playerWriteup = React.useMemo(() => {
    if (!allWriteups || typeof allWriteups !== 'object') return null;
    // Top-level is { generated_at, players: { "Name": {...} } }
    const dict = allWriteups.players || allWriteups;
    const key = player.name?.toLowerCase().trim();
    if (!key) return null;
    for (const [name, entry] of Object.entries(dict)) {
      if (name.toLowerCase().trim() === key) return entry;
    }
    return null;
  }, [allWriteups, player.name]);

  // Job 5 (Qwen3:30b) deep reasoning — only covers a weekly top-slice of
  // high-priority players, not everyone, so this is a bonus card, not a
  // replacement for the Job 3 writeup above.
  const { data: deepReasoningData } = useR2DeepReasoning();
  const deepReasoning = React.useMemo(() => {
    if (!deepReasoningData || typeof deepReasoningData !== 'object') return null;
    const dict = deepReasoningData.players || deepReasoningData;
    const key = player.name?.toLowerCase().trim();
    if (!key) return null;
    for (const [name, entry] of Object.entries(dict)) {
      if (name.toLowerCase().trim() === key) return entry;
    }
    return null;
  }, [deepReasoningData, player.name]);

  // Floor/Ceiling — empirical 25th/90th percentile from the player's actual
  // game log (most recent ~24 games), not a simulation. Only covers players
  // with a big-enough real sample (min 6 games).
  const { data: floorCeilingData } = useR2FloorCeiling();
  const floorCeiling = React.useMemo(() => {
    const list = floorCeilingData?.players;
    if (!Array.isArray(list)) return null;
    const key = player.name?.toLowerCase().trim();
    if (!key) return null;
    return list.find(p => (p.player_name || '').toLowerCase().trim() === key) || null;
  }, [floorCeilingData, player.name]);

  // Coverage matchup — real man/zone and per-scheme (Cover 0-9) target
  // splits from nflverse play-by-play charting, plus the upcoming
  // opponent's own coverage tendency. No CB assignment or route alignment
  // in this data (nflverse doesn't chart that) — man/zone and scheme only.
  const { data: coverageSplitsData } = useR2PlayerCoverageSplits();
  const { data: teamTendencyData } = useR2TeamCoverageTendency();
  const coverageSplits = React.useMemo(() => {
    const rows = coverageSplitsData?.players;
    if (!Array.isArray(rows)) return null;
    const key = player.name?.toLowerCase().trim();
    if (!key) return null;
    const mine = rows.filter(r => (r.receiver_name || '').toLowerCase().trim() === key);
    if (!mine.length) return null;
    return {
      manZone: mine.filter(r => r.split_type === 'man_zone').sort((a, b) => b.targets - a.targets),
      byScheme: mine.filter(r => r.split_type === 'coverage_type').sort((a, b) => b.targets - a.targets),
      seasonsIncluded: mine[0]?.seasons_included,
    };
  }, [coverageSplitsData, player.name]);
  const opponentTendency = React.useMemo(() => {
    const rows = teamTendencyData?.teams;
    const opp = (player.opp || '').replace(/^@/, '').toUpperCase();
    if (!Array.isArray(rows) || !opp) return null;
    const mine = rows.filter(r => (r.team || '').toUpperCase() === opp);
    if (!mine.length) return null;
    return {
      manZone: mine.filter(r => r.split_type === 'man_zone').sort((a, b) => b.pct_of_pass_plays - a.pct_of_pass_plays),
      byScheme: mine.filter(r => r.split_type === 'coverage_type').sort((a, b) => b.pct_of_pass_plays - a.pct_of_pass_plays),
    };
  }, [teamTendencyData, player.opp]);

  // Rush box-count matchup — the run-game counterpart to coverage matchup,
  // shown for RBs instead (a receiver's man/zone splits aren't the relevant
  // signal for a runner; box count vs rushing outcome is).
  const { data: rushBoxSplitsData } = useR2PlayerRushBoxSplits();
  const { data: teamRushTendencyData } = useR2TeamRushBoxTendency();
  const rushBoxSplits = React.useMemo(() => {
    if (player.pos !== 'RB') return null;
    const rows = rushBoxSplitsData?.players;
    if (!Array.isArray(rows)) return null;
    const key = player.name?.toLowerCase().trim();
    if (!key) return null;
    const mine = rows.filter(r => (r.rusher_name || '').toLowerCase().trim() === key);
    if (!mine.length) return null;
    return {
      boxGroup: mine.filter(r => r.split_type === 'box_group').sort((a, b) => b.attempts - a.attempts),
      byCount: mine.filter(r => r.split_type === 'box_count').sort((a, b) => Number(a.split_value) - Number(b.split_value)),
      seasonsIncluded: mine[0]?.seasons_included,
    };
  }, [rushBoxSplitsData, player.name, player.pos]);
  const opponentRushTendency = React.useMemo(() => {
    if (player.pos !== 'RB') return null;
    const rows = teamRushTendencyData?.teams;
    const opp = (player.opp || '').replace(/^@/, '').toUpperCase();
    if (!Array.isArray(rows) || !opp) return null;
    const mine = rows.filter(r => (r.team || '').toUpperCase() === opp);
    if (!mine.length) return null;
    return {
      boxGroup: mine.filter(r => r.split_type === 'box_group').sort((a, b) => b.pct_of_rush_plays - a.pct_of_rush_plays),
      byCount: mine.filter(r => r.split_type === 'box_count').sort((a, b) => Number(a.split_value) - Number(b.split_value)),
    };
  }, [teamRushTendencyData, player.opp, player.pos]);

  // Pre-baked 2025 Sleeper stats (from R2) — used as fallback when live API unavailable
  const { data: r2Stats2025Data } = useR2PlayerStats2025();
  const r2Stats2025 = React.useMemo(() => {
    const players = r2Stats2025Data?.players;
    if (!players) return null;
    // Look up by sleeperId first, then by name match
    if (player.sleeperId && players[String(player.sleeperId)]) return players[String(player.sleeperId)];
    return Object.values(players).find(s =>
      s.player_name?.toLowerCase().trim() === player.name.toLowerCase().trim()
    ) || null;
  }, [r2Stats2025Data, player.sleeperId, player.name]);

  // Combine measurables from R2
  const { data: combineData } = useR2CombineData();
  const combineRow = React.useMemo(() => {
    const players = Array.isArray(combineData) ? combineData : (combineData?.players || []);
    const q = player.name.toLowerCase().trim();
    return players.find(c => (c.player_name || '').toLowerCase().trim() === q) || null;
  }, [combineData, player.name]);

  const { data: allR2Notes } = useR2PlayerNotes();
  const playerAiNotes = React.useMemo(() => {
    if (!Array.isArray(allR2Notes)) return null;
    return allR2Notes.find(n => n.player_name?.toLowerCase().trim() === player.name.toLowerCase().trim()) || null;
  }, [allR2Notes, player.name]);

  function handleAdd() {
    if (isOnRoster || added) return;
    onAddPlayer?.(player.id);
    setAdded(true);
    setTimeout(onClose, 1300);
  }

  // League rank computation from Databricks export stats in playerStore
  const allPlayersForRank = usePlayers();
  const posPlayers = React.useMemo(() => {
    return allPlayersForRank.filter(p => p.pos === player.pos && (p.pts2025 > 0 || p.avg > 0));
  }, [allPlayersForRank, player.pos]);

  // Team depth chart at this player's position — same team, same pos, ordered by
  // depth_chart_order (unranked/no-slot players sort last, not first, so a buried
  // or unlisted player doesn't get displayed as if he were the starter).
  const teamDepthChart = React.useMemo(() => {
    if (!player.team || !player.pos) return [];
    return allPlayersForRank
      .filter(p => p.team === player.team && p.pos === player.pos)
      .sort((a, b) => (a.depthChartOrder ?? 999) - (b.depthChartOrder ?? 999));
  }, [allPlayersForRank, player.team, player.pos]);

  const leagueRankOf = React.useCallback((field) => {
    const sorted = [...posPlayers].sort((a, b) => (b[field] || 0) - (a[field] || 0));
    const rank = sorted.findIndex(p => p.id === player.id) + 1;
    return { rank: rank > 0 ? rank : null, n: posPlayers.length };
  }, [posPlayers, player.id]);

  // For Sleeper-fetched stats (pass_yd, rush_yd, etc.) estimate rank from val vs. hardcoded league-leader max
  function approxRank(val, max, leagueN) {
    const v = Number(val) || 0;
    if (!v || !max) return {};
    const rank = Math.max(1, Math.ceil((1 - v / max) * leagueN));
    return { rank, leagueN };
  }

  const posAvg = LEAGUE_AVG_STATS[player.pos] ?? {};

  const { data: live, loading, error } = useApi(
    () => sleeperEnabled
      ? fetchSleeperPlayerStats(player.name, player.pos, statYear)
      : Promise.resolve(null),
    [player.id, sleeperEnabled, statYear]
  );

  // Keep the last successful response visible while a year-switch re-fetch is in flight
  const [stableLive, setStableLive] = React.useState(null);
  React.useEffect(() => { if (live != null) setStableLive(live); }, [live]);
  React.useEffect(() => { setStableLive(null); }, [player.id]); // clear on player change
  const displayLive = live ?? stableLive;

  const hasLive = !loading && displayLive?.found && displayLive.weeklyStats && Object.keys(displayLive.weeklyStats).length > 0;
  const has2026Data = statYear === 2026 && !loading && live?.found && live.weeklyStats && Object.keys(live.weeklyStats).length > 0;
  const statusFromLive = displayLive?.status && displayLive.status !== 'Active' ? displayLive.status : null;

  // Fetch league-wide season totals for this position — week payloads are already
  // cached from the player fetch above, so this aggregation is essentially free.
  const { data: leagueTotals } = useApi(
    () => hasLive && sleeperEnabled
      ? fetchLeagueSeasonTotals(player.pos, statYear)
      : Promise.resolve(null),
    [hasLive, player.pos, statYear, sleeperEnabled]
  );

  // Real rank among all players at this position who had stats in the chosen year.
  // Returns { rank, leagueN } for spreading into SeasonStatBar.
  const lRank = React.useCallback((statKey) => {
    if (!leagueTotals || !displayLive?.sleeperId) return {};
    const sid = String(displayLive.sleeperId);
    const entries = Object.entries(leagueTotals)
      .filter(([, d]) => (d.totals[statKey] || 0) > 0)
      .sort(([, a], [, b]) => (b.totals[statKey] || 0) - (a.totals[statKey] || 0));
    const rank = entries.findIndex(([id]) => id === sid) + 1;
    return { rank: rank > 0 ? rank : null, leagueN: entries.length };
  }, [leagueTotals, displayLive?.sleeperId]);

  // Real league average for a stat across all players who had stats.
  const lAvg = React.useCallback((statKey, fallback) => {
    if (!leagueTotals) return fallback ?? null;
    const vals = Object.values(leagueTotals)
      .map(d => d.totals[statKey] || 0)
      .filter(v => v > 0);
    if (!vals.length) return fallback ?? null;
    return Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 10) / 10;
  }, [leagueTotals]);

  // Rank by a computed ratio (e.g. Catch % = rec/rec_tgt, YAC/Rec = rec_yar/rec) —
  // for stats that aren't stored directly in leagueTotals[x].totals.
  const lRankRatio = React.useCallback((numKey, denKey, minDen = 1) => {
    if (!leagueTotals || !displayLive?.sleeperId) return {};
    const sid = String(displayLive.sleeperId);
    const entries = Object.entries(leagueTotals)
      .filter(([, d]) => (d.totals[denKey] || 0) >= minDen)
      .map(([id, d]) => [id, (d.totals[numKey] || 0) / d.totals[denKey]])
      .sort(([, a], [, b]) => b - a);
    const rank = entries.findIndex(([id]) => id === sid) + 1;
    return { rank: rank > 0 ? rank : null, leagueN: entries.length };
  }, [leagueTotals, displayLive?.sleeperId]);

  // Real league average of a computed ratio across all players who had stats.
  const lAvgRatio = React.useCallback((numKey, denKey, { minDen = 1, scale = 1, fallback } = {}) => {
    if (!leagueTotals) return fallback ?? null;
    const vals = Object.values(leagueTotals)
      .filter(d => (d.totals[denKey] || 0) >= minDen)
      .map(d => (d.totals[numKey] || 0) / d.totals[denKey] * scale);
    if (!vals.length) return fallback ?? null;
    return Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 10) / 10;
  }, [leagueTotals]);

  const playerNewsItems = React.useMemo(() => {
    const items = [];

    // FantasAI Job 1 notes — AI-classified article summaries, shown first
    if (playerAiNotes?.notes?.length > 0) {
      const noteTs = playerAiNotes.last_updated ? new Date(playerAiNotes.last_updated).getTime() : null;
      for (const note of playerAiNotes.notes.slice(0, 5)) {
        if (!note.note_text) continue;
        const impact = note.priority === 'critical' ? 'bad'
          : note.impact_direction === 'positive' ? 'good'
          : note.priority === 'high' ? 'medium' : 'low';
        items.push({
          source: 'FantasAI',
          sourceColor: '#c6ff3a',
          title: null,
          body: note.note_text,
          fetchedAt: noteTs,
          impact,
        });
      }
    }

    // CBS Sports + ESPN live items
    items.push(...fetchedNewsItems);

    // Injury status from Sleeper — always at the top
    if (!loading && displayLive?.status && !['Active','OK','Na',''].includes(displayLive.status)) {
      const isBad = ['Out','Injured_Reserve','IR','Non_Football_Injury','NFI'].includes(displayLive.status);
      items.unshift({
        source: 'Sleeper',
        sourceColor: '#7c5cbf',
        title: `${displayLive.status}${displayLive.injuryBodyPart ? ` — ${displayLive.injuryBodyPart}` : ''}`,
        body: null,
        fetchedAt: Date.now(),
        impact: isBad ? 'bad' : displayLive.status === 'Questionable' || displayLive.status === 'Doubtful' ? 'medium' : 'low',
      });
    }
    // Fall back to static news when live APIs returned nothing
    if (!newsLoading && items.length === 0) {
      const staticItems = NEWS.filter(n => n.playerId === player.id);
      for (const n of staticItems) {
        items.push({
          source: n.source || 'Beat Writer',
          sourceColor: '#888',
          title: n.title || null,
          body:  n.body  || null,
          mins:  n.mins  || null,
          impact: n.impact === 'high' ? 'bad' : n.impact || 'low',
        });
      }
      if (player.news && items.length === 0) {
        items.push({
          source: 'Beat Writer',
          sourceColor: '#888',
          title: player.news,
          body: player.status && player.status !== 'OK'
            ? `${player.name} listed as ${player.status}. Monitor practice reports.`
            : null,
          fetchedAt: Date.now() - 3_600_000,
          impact: player.status && player.status !== 'OK' ? 'medium' : 'low',
        });
      }
    }
    return items;
  }, [fetchedNewsItems, playerAiNotes, displayLive, loading, newsLoading, player]);

  // Priority: 1) stored photoUrl from normalized data, 2) Sleeper CDN by stored sleeperId,
  // 3) Sleeper CDN by live sleeperId (available after API resolves)
  // Prefer the verified Sleeper ID from the live API response (guaranteed numeric Sleeper ID)
  // over player.sleeperId which may be an artificial local ID when R2 export lacks player_id
  const sleeperAvatarUrl =
    player.photoUrl ||
    (displayLive?.sleeperId  ? `https://sleepercdn.com/content/nfl/players/thumb/${displayLive.sleeperId}.jpg` : null) ||
    (player.sleeperId ? `https://sleepercdn.com/content/nfl/players/thumb/${player.sleeperId}.jpg` : null);

  // Game log rows from live data or mock fallback
  const liveRows = hasLive
    ? Object.entries(displayLive.weeklyStats)
        .map(([wk, s]) => ({ wk: Number(wk), s }))
        .sort((a, b) => b.wk - a.wk)
    : null;

  // Per-column 25th/75th percentile thresholds across this player's season weeks
  const pctThresholds = React.useMemo(() => {
    if (!liveRows || liveRows.length < 3) return null;
    const higherBetter = glHigherIsBetter(player.pos);
    const sample = glRawNums(player.pos, liveRows[0]?.s);
    if (!sample) return null;
    return sample.map((_, col) => {
      const vals = liveRows
        .map(({ s }) => glRawNums(player.pos, s)?.[col] ?? 0)
        .filter(v => v > 0)
        .sort((a, b) => a - b);
      if (vals.length < 2) return null;
      return {
        p25: vals[Math.floor(vals.length * 0.25)],
        p75: vals[Math.floor(vals.length * 0.75)],
        higher: higherBetter[col] ?? true,
      };
    });
  }, [liveRows, player.pos]);

  const mockGameLog = [
    { wk: 10, opp: player.opp,  snaps: 64, tar: 9,  rec: 6, yds: 78,  td: 1, pts: player.last },
    { wk: 9,  opp: 'BYE',       snaps:'—', tar:'—', rec:'—',yds:'—', td:'—', pts:'—' },
    { wk: 8,  opp: '@NE',       snaps: 58, tar: 7,  rec: 5, yds: 64,  td: 0, pts: player.trend[4] },
    { wk: 7,  opp: 'NYG',       snaps: 67, tar: 11, rec: 8, yds: 102, td: 1, pts: player.trend[3] },
    { wk: 6,  opp: '@SF',       snaps: 54, tar: 6,  rec: 3, yds: 41,  td: 0, pts: player.trend[2] },
    { wk: 5,  opp: 'TB',        snaps: 62, tar: 8,  rec: 6, yds: 88,  td: 1, pts: player.trend[1] },
    { wk: 4,  opp: '@DAL',      snaps: 60, tar: 5,  rec: 4, yds: 54,  td: 0, pts: player.trend[0] },
  ];

  // Season stats — live Sleeper API wins; pre-baked R2 export is the fallback
  const tot = hasLive ? displayLive.seasonTotals : (statYear === 2025 && r2Stats2025 ? r2Stats2025 : null);
  const gp  = hasLive ? displayLive.gamesPlayed  : (statYear === 2025 && r2Stats2025?.gp ? r2Stats2025.gp : 0);
  const liveLastPts = hasLive && displayLive.currentWeek
    ? (displayLive.weeklyStats[displayLive.currentWeek] ?? displayLive.weeklyStats[displayLive.currentWeek - 1])?.pts_half_ppr
    : null;
  const liveAvg = tot?.pts_half_ppr != null && gp > 0 ? (tot.pts_half_ppr / gp) : null;

  return (
    <React.Fragment>
      <div className="drawer-overlay" onClick={onClose}></div>
      <div className="drawer">

        {/* ── Hero ── */}
        <div className="detail-hero">
          <PlayerAvatar player={player} size="xl" src={sleeperAvatarUrl} />
          <div>
            <div className="flex gap-8" style={{ alignItems: 'center', flexWrap: 'wrap' }}>
              <PosBadge pos={player.pos} solid />
              <TeamLogoBadge team={{ name: player.team, color: NFL_TEAMS.find(t => t.abbr === player.team)?.color }} size={20} />
              <span className="mono dim" style={{ fontSize: 11 }}>{player.team} {NFL_TEAM_NAME[player.team] || ''} · #{player.num} · Age {player.age}</span>
              {(player.status !== 'OK' || statusFromLive) &&
                <span className="status-pill"><StatusDot status={player.status} /> {statusFromLive || player.status}</span>}
              {hasLive && <LiveBadge />}
            </div>
            <h2>{player.name}</h2>
            <div className="meta">
              <span>ECR #{player.ecr}</span><span className="dot"></span>
              {player.adp < 999 && <><span>ADP {player.adp.toFixed(1)}</span><span className="dot"></span></>}
              <span>Tier {player.tier}</span><span className="dot"></span>
              <span>{player.owned.toFixed(1)}% rostered</span>
            </div>
            {(isOnRoster || isOwnedByOther) && (() => {
              let label, color;
              if (isOnRoster) {
                try { const u = JSON.parse(localStorage.getItem('fantasai_user') || 'null'); label = findTeam(u?.teamId)?.name ?? 'Your Roster'; color = findTeam(u?.teamId)?.color ?? 'var(--accent)'; } catch { label = 'Your Roster'; color = 'var(--accent)'; }
              } else {
                label = ownerTeam?.name ?? `Team ${ownerTeamId}`; color = ownerTeam?.color ?? '#888';
              }
              return (
                <div style={{ marginTop: 4, display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ width: 8, height: 8, borderRadius: '50%', background: color, display: 'inline-block', flexShrink: 0 }} />
                  <span style={{ fontSize: 11, fontWeight: 700, color, fontFamily: 'var(--font-mono)' }}>
                    {isOnRoster ? '★ ' : ''}{label}
                  </span>
                </div>
              );
            })()}
          </div>
          <div className="flex col gap-8" style={{ alignItems: 'stretch' }}>
            {isOnRoster || added ? (
              <button className="btn success" disabled>✓ {added ? 'Added!' : 'On Roster'}</button>
            ) : isOwnedByOther ? (
              <button className="btn primary" style={{ background: 'rgba(78,168,255,.15)', borderColor: 'rgba(78,168,255,.4)', color: 'var(--accent-2)' }}
                onClick={() => { onTradePlayer?.(player.id, ownerTeamId); onClose?.(); }}>
                ⇄ Trade
              </button>
            ) : (
              <button className="btn primary" onClick={handleAdd}>+ Add to Roster</button>
            )}
            <button className="btn ghost">★ Watchlist</button>
            <button className="btn ghost icon" onClick={onClose} style={{ alignSelf: 'flex-end' }}>✕</button>
          </div>
        </div>

        {/* ── Tabs ── */}
        <div className="tabs">
          {[['overview','Overview'],['gamelog','Weekly Stats'],['nextgen','Next Gen'],['ecosystem','Ecosystem'],['news','News'],['matchup','Matchup'],['lineage','Lineage']].map(([k,v]) => (
            <div key={k} className={`tab ${activeTab===k?'active':''}`} onClick={() => setTab(k)}>{v}</div>
          ))}
        </div>

        <div style={{ padding: 18 }}>

          {/* ── Overview ── */}
          {activeTab === 'overview' && (
            <React.Fragment>
              <div style={{ display:'grid', gridTemplateColumns:`repeat(${(detailOppScore != null || detailMatchupRating != null) ? 5 : 4},1fr)`, gap:10, marginBottom:16 }}>
                <div className="stat">
                  <div className="k">
                    Wk {displayLive?.projWeek || displayLive?.currentWeek || '—'} Proj
                  </div>
                  <div className="v accent">
                    {parseFloat((displayLive?.projection?.pts_half_ppr ?? displayLive?.projection?.pts_std ?? (player.proj > 0 ? player.proj : (() => {
                      const rr = detailRookieData;
                      if (!rr) return 0;
                      if (rr.proj_week_pts >= 1) return rr.proj_week_pts;
                      if (rr.rookie_score == null) return 0;
                      const base = { QB: 8, RB: 6, WR: 5, TE: 4 }[player.pos] ?? 5;
                      const ceil = { QB: 22, RB: 16, WR: 14, TE: 10 }[player.pos] ?? 14;
                      return base + (ceil - base) * (rr.rookie_score / 100);
                    })())).toFixed(1))}
                  </div>
                  <div className="sub">
                    vs {displayOpp || '—'}
                    {detailMatchupRating && detailMatchupRating.score !== 0 &&
                      <span style={{ marginLeft: 4, color: detailMatchupRating.color, fontWeight: 700 }}>· {detailMatchupRating.label}</span>}
                  </div>
                </div>
                <div className="stat">
                  <div className="k">Last Week</div>
                  <div className="v">{parseFloat((liveLastPts ?? player.last).toFixed(1))}</div>
                  <div className="sub"><Delta from={liveAvg ?? player.avg} to={liveLastPts ?? player.last} /> vs avg</div>
                </div>
                <div className="stat">
                  <div className="k">Season Avg</div>
                  <div className="v">{parseFloat((liveAvg ?? player.avg).toFixed(1))}</div>
                  <div className="sub">{gp} games {hasLive ? <LiveBadge /> : 'played'}</div>
                </div>
                <div className="stat">
                  <div className="k">Season Trend</div>
                  <div className="v"><Sparkline data={player.trend} width={80} height={28} /></div>
                  <div className="sub mono" style={{ fontSize: 9 }}>{(player.trend.slice(-5) || []).join(' · ')}</div>
                </div>
                {detailMatchupRating != null ? (
                  <div className="stat">
                    <div className="k" style={{ color: detailMatchupRating.color }}>Matchup</div>
                    <div className="v" style={{ color: detailMatchupRating.color, fontFamily: 'var(--font-mono)', fontSize: 18 }}>
                      {detailMatchupRating.score > 0 ? '+' : ''}{detailMatchupRating.score !== 0 ? detailMatchupRating.score : '—'}
                    </div>
                    <div className="sub" style={{ color: detailMatchupRating.color }}>
                      {detailMatchupRating.label} · #{detailMatchupRating.rank}/32
                    </div>
                  </div>
                ) : detailOppScore != null ? (
                  <div className="stat">
                    <div className="k" style={{ color: 'var(--accent-2)' }}>Opp Score</div>
                    <div className="v" style={{ color: 'var(--accent-2)', fontFamily: 'var(--font-mono)' }}>{parseFloat(detailOppScore.toFixed(1))}</div>
                    <div className="sub">↑ Breakout signal</div>
                  </div>
                ) : null}
              </div>

              {/* Rookie Score breakdown card */}
              {detailRookieData && (
                <div className="card" style={{ marginBottom: 16 }}>
                  <div className="card-head">
                    <div className="card-title" style={{ color: '#a78bfa' }}>Rookie Score</div>
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: 22, fontWeight: 900, color: '#a78bfa' }}>
                      {Math.round(detailRookieData.rookie_score)}
                      <span style={{ fontSize: 11, fontWeight: 400, color: 'var(--text-dim)', marginLeft: 4 }}>/100</span>
                    </span>
                  </div>
                  <div className="card-body">
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10, marginBottom: 10 }}>
                      {[
                        { label: 'Draft Capital', val: detailRookieData.draft_capital_score, note: detailRookieData.draft_ovr ? `Pick #${detailRookieData.draft_ovr}` : (detailRookieData.adp ? `ADP ${detailRookieData.adp}` : 'UDFA') },
                        { label: 'Athleticism',   val: detailRookieData.athleticism_score,   note: 'Combine metrics' },
                        { label: 'Opportunity',   val: detailRookieData.opportunity_score,   note: `Depth #${detailRookieData.depth_chart_order ?? '?'}` },
                      ].map(({ label, val, note }) => {
                        const pct = Math.min(100, Math.max(0, val ?? 0));
                        return (
                          <div key={label}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                              <span style={{ fontSize: 10, color: 'var(--text-dim)' }}>{label}</span>
                              <span style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: '#a78bfa' }}>{val != null ? Math.round(val) : '—'}</span>
                            </div>
                            <div style={{ height: 4, borderRadius: 2, background: 'var(--bg-card-alt)', overflow: 'hidden' }}>
                              <div style={{ height: '100%', width: `${pct}%`, background: '#a78bfa', borderRadius: 2 }} />
                            </div>
                            <div style={{ fontSize: 9, color: 'var(--text-faint)', marginTop: 3 }}>{note}</div>
                          </div>
                        );
                      })}
                    </div>
                    <div style={{ display: 'flex', gap: 20, borderTop: '1px solid var(--border)', paddingTop: 10 }}>
                      <div>
                        <span className="dim" style={{ fontSize: 10 }}>Proj Season · </span>
                        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--text)' }}>{detailRookieData.proj_season_pts ? Math.round(detailRookieData.proj_season_pts) : '—'} pts</span>
                      </div>
                      <div>
                        <span className="dim" style={{ fontSize: 10 }}>Proj/Week · </span>
                        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: '#a78bfa' }}>{detailRookieData.proj_week_pts ? parseFloat(detailRookieData.proj_week_pts.toFixed(1)) : '—'} pts</span>
                      </div>
                      {detailRookieData.draft_round && (
                        <div>
                          <span className="dim" style={{ fontSize: 10 }}>Round · </span>
                          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}>{detailRookieData.draft_round}</span>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {/* Combine Measurables */}
              {player.forty != null && player.pos !== 'DST' && player.pos !== 'K' && (
                <div className="card" style={{ marginBottom: 16 }}>
                  <div className="card-head">
                    <div className="card-title" style={{ color: '#ff9800' }}>Combine Measurables</div>
                    {player.combineWt && <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--text-dim)' }}>{player.combineWt} lbs</span>}
                  </div>
                  <div className="card-body">
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(80px, 1fr))', gap: 10 }}>
                      {[
                        { label: '40-Yard', val: player.forty, fmt: v => v.toFixed(2) + 's', elite: player.pos === 'QB' ? 4.55 : player.pos === 'TE' ? 4.55 : 4.40 },
                        { label: 'Vertical', val: player.vertical, fmt: v => v.toFixed(1) + '"', elite: 38 },
                        { label: 'Broad Jump', val: player.broadJump, fmt: v => v + '"', elite: 125 },
                        { label: 'Bench', val: player.benchPress, fmt: v => v + ' reps', elite: 20 },
                        { label: '3-Cone', val: player.cone, fmt: v => v.toFixed(2) + 's', elite: 6.8, invert: true },
                        { label: 'Shuttle', val: player.shuttle, fmt: v => v.toFixed(2) + 's', elite: 4.1, invert: true },
                      ].filter(m => m.val != null).map(m => {
                        const isElite = m.invert ? m.val <= m.elite : (m.label === '40-Yard' ? m.val <= m.elite : m.val >= m.elite);
                        return (
                          <div key={m.label} style={{ textAlign: 'center' }}>
                            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 16, fontWeight: 900, color: isElite ? '#1affa0' : 'var(--text)' }}>{m.fmt(m.val)}</div>
                            <div style={{ fontSize: 9, color: 'var(--text-faint)', marginTop: 2 }}>{m.label}</div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              )}

              {/* Season Stats */}
              {loading && (
                <div className="muted-card" style={{ marginBottom:16, padding:14, display:'flex', alignItems:'center', gap:10 }}>
                  <div className="ai-orb" style={{ width:16, height:16 }} />
                  <span className="dim" style={{ fontSize:12 }}>Fetching live stats from Sleeper…</span>
                </div>
              )}
              {!loading && error && (
                <div className="muted-card" style={{ marginBottom:16, padding:'10px 14px', borderLeft:'3px solid var(--border-strong)' }}>
                  <span className="dim" style={{ fontSize:11 }}>
                    Sleeper API error — showing projected data.{' '}
                    <span className="mono faint" style={{ fontSize:10 }}>{String(error)}</span>
                  </span>
                </div>
              )}
              {!loading && !error && !hasLive && !sleeperEnabled && (
                <>
                  <div className="muted-card" style={{ marginBottom:16, padding:'10px 14px', borderLeft:'3px solid var(--border)' }}>
                    <span className="dim" style={{ fontSize:11 }}>
                      Sleeper API is disabled — showing projected data.{' '}
                      <span className="mono faint" style={{ fontSize:10 }}>Enable in Sources → Free Data APIs</span>
                    </span>
                  </div>
                  {(player.pos === 'WR' || player.pos === 'TE' || player.pos === 'RB') && (player.yac > 0 || player.targetShare > 0) && (
                    <div className="card" style={{ marginBottom:16 }}>
                      <div className="card-head"><div className="card-title">Projected Usage</div></div>
                      <div className="card-body" style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'0 24px' }}>
                        {(player.pos === 'WR' || player.pos === 'TE') && <>
                          {player.targetShare > 0 && <SeasonStatBar label="Target Share" val={`${player.targetShare.toFixed(1)}%`} max={100} />}
                          {player.routes > 0     && <SeasonStatBar label="Routes/Game"  val={player.routes.toFixed(0)} max={30} />}
                          {player.yac > 0        && <SeasonStatBar label="YAC Total"    val={player.yac.toFixed(1)} max={600} />}
                        </>}
                        {player.pos === 'RB' && <>
                          {player.yac > 0        && <SeasonStatBar label="YAC Total"    val={player.yac.toFixed(1)} max={600} />}
                          {player.targetShare > 0 && <SeasonStatBar label="Target Share" val={`${player.targetShare.toFixed(1)}%`} max={40} />}
                        </>}
                      </div>
                    </div>
                  )}
                </>
              )}
              {hasLive && tot && (
                <div className="card" style={{ marginBottom:16 }}>
                  <div className="card-head">
                    <div className="card-title">2025 Season Stats</div>
                    <div style={{ display:'flex', alignItems:'center', gap:6 }}>
                      <LiveBadge />
                      <span className="mono faint" style={{ fontSize:9 }}>Sleeper API · direct</span>
                    </div>
                  </div>
                  <div className="card-body" style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'0 24px' }}>
                    {player.pos === 'QB' && <>
                      <SeasonStatBar label="Pass Yards"  val={Math.round(tot.pass_yd  || 0)} max={5000} leagueAvg={lAvg('pass_yd',  posAvg.pass_yd)}  {...lRank('pass_yd')}  />
                      <SeasonStatBar label="Pass TDs"    val={Math.round(tot.pass_td  || 0)} max={50}   leagueAvg={lAvg('pass_td',  posAvg.pass_td)}  {...lRank('pass_td')}  />
                      <SeasonStatBar label="Completions" val={Math.round(tot.pass_cmp || 0)} max={400}  leagueAvg={lAvg('pass_cmp', posAvg.pass_cmp)} {...lRank('pass_cmp')} />
                      <SeasonStatBar label="INTs"        val={Math.round(tot.pass_int || 0)} max={20}   leagueAvg={lAvg('pass_int', posAvg.pass_int)} />
                      <SeasonStatBar label="Rush Yards"  val={Math.round(tot.rush_yd  || 0)} max={800}  leagueAvg={lAvg('rush_yd',  posAvg.rush_yd)}  {...lRank('rush_yd')}  />
                      <SeasonStatBar label="Fantasy Pts" val={fmtStat(tot.pts_half_ppr,1)} max={400}   leagueAvg={lAvg('pts_half_ppr', posAvg.pts_half_ppr)} {...lRank('pts_half_ppr')} />
                    </>}
                    {player.pos === 'RB' && <>
                      <SeasonStatBar label="Rush Attempts" val={Math.round(tot.rush_att || 0)} max={300}  leagueAvg={lAvg('rush_att', posAvg.rush_att)} {...lRank('rush_att')} />
                      <SeasonStatBar label="Rush Yards"    val={Math.round(tot.rush_yd  || 0)} max={1800} leagueAvg={lAvg('rush_yd',  posAvg.rush_yd)}  {...lRank('rush_yd')}  />
                      <SeasonStatBar label="Rush TDs"      val={Math.round(tot.rush_td  || 0)} max={20}   leagueAvg={lAvg('rush_td',  posAvg.rush_td)}  {...lRank('rush_td')}  />
                      <SeasonStatBar label="Receptions"    val={Math.round(tot.rec      || 0)} max={100}  leagueAvg={lAvg('rec',      posAvg.rec)}      {...lRank('rec')}      />
                      <SeasonStatBar label="Rec Yards"     val={Math.round(tot.rec_yd   || 0)} max={800}  leagueAvg={lAvg('rec_yd',   posAvg.rec_yd)}   {...lRank('rec_yd')}   />
                      <SeasonStatBar label="Fantasy Pts"   val={fmtStat(tot.pts_half_ppr,1)} max={350}   leagueAvg={lAvg('pts_half_ppr', posAvg.pts_half_ppr)} {...lRank('pts_half_ppr')} />
                    </>}
                    {(player.pos === 'WR' || player.pos === 'TE') && <>
                      <SeasonStatBar label="Targets"     val={Math.round(tot.rec_tgt || 0)} max={200}  leagueAvg={lAvg('rec_tgt', posAvg.rec_tgt)} {...lRank('rec_tgt')} />
                      <SeasonStatBar label="Receptions"  val={Math.round(tot.rec     || 0)} max={150}  leagueAvg={lAvg('rec',     posAvg.rec)}     {...lRank('rec')}     />
                      <SeasonStatBar label="Rec Yards"   val={Math.round(tot.rec_yd  || 0)} max={1800} leagueAvg={lAvg('rec_yd',  posAvg.rec_yd)}  {...lRank('rec_yd')}  />
                      <SeasonStatBar label="Rec TDs"     val={Math.round(tot.rec_td  || 0)} max={20}   leagueAvg={lAvg('rec_td',  posAvg.rec_td)}  {...lRank('rec_td')}  />
                      <SeasonStatBar label="Catch %"     val={tot.rec_tgt > 0 ? fmtStat((tot.rec/tot.rec_tgt)*100,1)+'%' : '—'} max={100} leagueAvg={lAvgRatio('rec', 'rec_tgt', { scale: 100, fallback: posAvg.catch_pct })} {...lRankRatio('rec', 'rec_tgt')} />
                      <SeasonStatBar label="YAC Total"   val={(() => { const v = tot.rec_yar > 0 ? tot.rec_yar : (player.yac || 0); return v > 0 ? Math.round(v) : '—'; })()} max={600} leagueAvg={lAvg('rec_yar', posAvg.rec_yac)} {...lRank('rec_yar')} />
                      <SeasonStatBar label="YAC/Rec"     val={(() => { const yac = tot.rec_yar > 0 ? tot.rec_yar : (player.yac || 0); const rec = tot.rec > 0 ? tot.rec : (tot.receptions > 0 ? tot.receptions : null); return rec > 0 && yac > 0 ? fmtStat(yac / rec, 1) : '—'; })()} max={12} leagueAvg={lAvgRatio('rec_yar', 'rec', { fallback: posAvg.yac_per_rec })} {...lRankRatio('rec_yar', 'rec')} />
                      <SeasonStatBar label="Fantasy Pts" val={fmtStat(tot.pts_half_ppr,1)} max={350}   leagueAvg={lAvg('pts_half_ppr', posAvg.pts_half_ppr)} {...lRank('pts_half_ppr')} />
                    </>}
                  </div>
                </div>
              )}


              {/* Combine measurables */}
              {combineRow && (() => {
                const stats = [
                  combineRow.forty      != null && { label: '40-Yard Dash',  value: `${combineRow.forty}s` },
                  combineRow.vertical   != null && { label: 'Vertical Jump', value: `${combineRow.vertical}"` },
                  combineRow.broad_jump != null && { label: 'Broad Jump',    value: `${combineRow.broad_jump}"` },
                  combineRow.bench      != null && { label: 'Bench Press',   value: `${combineRow.bench} reps` },
                  combineRow.cone       != null && { label: '3-Cone Drill',  value: `${combineRow.cone}s` },
                  combineRow.shuttle    != null && { label: 'Shuttle Run',   value: `${combineRow.shuttle}s` },
                  combineRow.ht         != null && { label: 'Height',        value: combineRow.ht },
                  combineRow.wt         != null && { label: 'Weight',        value: `${combineRow.wt} lbs` },
                ].filter(Boolean);
                if (!stats.length) return null;
                return (
                  <div className="card" style={{ marginBottom: 16 }}>
                    <div className="card-head">
                      <div className="card-title">NFL Combine · {combineRow.draft_year || combineRow.season}</div>
                      <span className="mono faint" style={{ fontSize: 9 }}>
                        {combineRow.school}{combineRow.draft_round != null ? ` · Rd ${combineRow.draft_round}, Pick ${combineRow.draft_ovr}` : ''}
                      </span>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 24px', padding: '4px 14px 10px' }}>
                      {stats.map(({ label, value }) => (
                        <div key={label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '7px 0', borderBottom: '1px solid var(--border)' }}>
                          <span style={{ fontSize: 11, color: 'var(--text-faint)' }}>{label}</span>
                          <span style={{ fontSize: 12, fontWeight: 700, fontFamily: 'var(--font-mono)', color: 'var(--text)' }}>{value}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })()}

              {/* Team depth chart at this position — context for whether proj is realistic */}
              {teamDepthChart.length > 0 && (
                <div className="muted-card" style={{ marginBottom: 16, borderLeft: '3px solid var(--text-faint)' }}>
                  <div className="flex gap-8" style={{ alignItems: 'center', marginBottom: 8 }}>
                    <span style={{ fontFamily: 'var(--font-display)', fontStretch: '87%', fontWeight: 800, fontSize: 11, letterSpacing: '.12em', textTransform: 'uppercase', color: 'var(--text-faint)' }}>
                      {player.team} {player.pos} Depth Chart
                    </span>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                    {teamDepthChart.map(p => {
                      const isThisPlayer = p.id === player.id;
                      const unranked = p.depthChartOrder == null;
                      return (
                        <div
                          key={p.id}
                          style={{
                            display: 'flex', alignItems: 'center', gap: 8, fontSize: 12,
                            padding: '4px 8px', borderRadius: 5,
                            background: isThisPlayer ? 'rgba(198,255,58,.10)' : 'transparent',
                            border: isThisPlayer ? '1px solid rgba(198,255,58,.3)' : '1px solid transparent',
                          }}
                        >
                          <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 800, fontSize: 11, width: 18, flexShrink: 0, color: unranked ? 'var(--text-faint)' : 'var(--text-dim)' }}>
                            {unranked ? '—' : p.depthChartOrder}
                          </span>
                          <span style={{ fontWeight: isThisPlayer ? 800 : 500, color: isThisPlayer ? 'var(--accent)' : 'var(--text)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {p.name}
                          </span>
                          {p.depthChartPos && p.depthChartPos !== p.pos && (
                            <span style={{ fontSize: 9, fontFamily: 'var(--font-mono)', color: 'var(--text-faint)' }}>{p.depthChartPos}</span>
                          )}
                          {p.avg > 0 && (
                            <span style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--text-faint)' }}>{p.avg.toFixed(1)} avg</span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                  {player.depthChartOrder == null && (
                    <div style={{ marginTop: 8, fontSize: 10, color: '#ffb547', lineHeight: 1.5 }}>
                      Not on {player.team}'s confirmed {player.pos} depth chart — no meaningful projection can be generated until he has a real slot.
                    </div>
                  )}
                </div>
              )}

              {/* Floor/Ceiling — empirical percentiles from real game log, not a simulation */}
              {floorCeiling && (
                <div className="muted-card" style={{ marginBottom: 16, borderLeft: '3px solid #a78bfa' }}>
                  <div className="flex gap-8" style={{ alignItems: 'center', marginBottom: 8 }}>
                    <span style={{ fontFamily: 'var(--font-display)', fontStretch: '87%', fontWeight: 800, fontSize: 11, letterSpacing: '.12em', textTransform: 'uppercase', color: '#a78bfa' }}>
                      Floor / Ceiling
                    </span>
                    <span style={{ marginLeft: 'auto', fontSize: 9, fontFamily: 'var(--font-mono)', color: 'var(--text-faint)' }}>
                      {floorCeiling.games_sample} game sample
                    </span>
                  </div>
                  <div style={{ display: 'flex', gap: 16, marginBottom: 8 }}>
                    <div>
                      <div style={{ fontSize: 9, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '.05em' }}>Floor (25th %ile)</div>
                      <div style={{ fontSize: 18, fontWeight: 900, fontFamily: 'var(--font-mono)', color: '#ff8080' }}>{floorCeiling.floor_pts.toFixed(1)}</div>
                    </div>
                    <div>
                      <div style={{ fontSize: 9, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '.05em' }}>Median</div>
                      <div style={{ fontSize: 18, fontWeight: 900, fontFamily: 'var(--font-mono)', color: 'var(--text)' }}>{floorCeiling.median_pts.toFixed(1)}</div>
                    </div>
                    <div>
                      <div style={{ fontSize: 9, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '.05em' }}>Ceiling (90th %ile)</div>
                      <div style={{ fontSize: 18, fontWeight: 900, fontFamily: 'var(--font-mono)', color: '#4caf82' }}>{floorCeiling.ceiling_pts.toFixed(1)}</div>
                    </div>
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text-dim)' }}>
                    Booms (≥1.5× median) <strong style={{ color: '#4caf82' }}>{floorCeiling.boom_rate}%</strong> of games · Busts (&lt;0.5× median) <strong style={{ color: '#ff8080' }}>{floorCeiling.bust_rate}%</strong> of games
                  </div>
                  <div style={{ marginTop: 6, fontSize: 10, color: 'var(--text-faint)' }}>
                    From this player's actual fantasy points over their last {floorCeiling.games_sample} games — real history, not a projection model.
                  </div>
                </div>
              )}

              {/* AI insight — Qwen writeup when available, template fallback */}
              <div className="muted-card" style={{ marginBottom:16, borderLeft:'3px solid var(--accent-2)' }}>
                <div className="flex gap-8" style={{ alignItems:'center', marginBottom:8 }}>
                  <div className="ai-orb" style={{ width:20, height:20 }}></div>
                  <span style={{ fontFamily:'var(--font-display)', fontStretch:'87%', fontWeight:800, fontSize:11, letterSpacing:'.12em', textTransform:'uppercase', color:'var(--accent-2)' }}>FantasAI Insight</span>
                  {playerWriteup && (
                    <span style={{ marginLeft:'auto', fontSize:9, fontFamily:'var(--font-mono)', color:'var(--accent-2)', opacity:.7 }}>
                      Qwen · {playerWriteup.generated_at ? new Date(playerWriteup.generated_at).toLocaleDateString() : 'local'}
                    </span>
                  )}
                </div>
                {playerWriteup?.writeup ? (
                  <div style={{ fontSize:13, lineHeight:1.6 }}>
                    {playerWriteup.writeup.split('\n\n').map((para, i) => (
                      <p key={i} style={{ margin: i > 0 ? '10px 0 0' : 0 }}>{para}</p>
                    ))}
                  </div>
                ) : (
                  <div style={{ fontSize:13, lineHeight:1.55 }}>
                    {player.proj > 18
                      ? `Lock 'em in. Matchup model loves ${displayOpp.replace('@','')} — ${player.name} should see volume at depth. Proj ${player.proj.toFixed(1)} is conservative; 75th-pct is ${(player.proj*1.25).toFixed(1)}.`
                      : `Mixed signals. Volume is fine but ${displayOpp.replace('@','')} has been stingy near the goal line. Floor ${(player.proj*0.6).toFixed(1)}, ceiling ${(player.proj*1.4).toFixed(1)}.`}
                  </div>
                )}
              </div>

              {/* Job 5 deep reasoning (Qwen3:30b) — only present for the weekly top-slice of high-priority players */}
              {deepReasoning && (() => {
                const rec = (deepReasoning.recommendation || '').toUpperCase();
                const recColor = rec === 'BUY' ? '#1affa0' : rec === 'AVOID' ? '#ff4f4f' : '#ffb547';
                return (
                  <div className="muted-card" style={{ marginBottom: 16, borderLeft: `3px solid ${recColor}` }}>
                    <div className="flex gap-8" style={{ alignItems: 'center', marginBottom: 8 }}>
                      <div className="ai-orb" style={{ width: 20, height: 20 }}></div>
                      <span style={{ fontFamily: 'var(--font-display)', fontStretch: '87%', fontWeight: 800, fontSize: 11, letterSpacing: '.12em', textTransform: 'uppercase', color: recColor }}>
                        Deep Reasoning
                      </span>
                      <span style={{ fontSize: 9, fontFamily: 'var(--font-mono)', fontWeight: 900, color: recColor, background: `${recColor}1a`, border: `1px solid ${recColor}40`, borderRadius: 4, padding: '1px 7px' }}>
                        {rec || '—'}
                      </span>
                      {deepReasoning._elapsed_sec != null && (
                        <span style={{ marginLeft: 'auto', fontSize: 9, fontFamily: 'var(--font-mono)', color: recColor, opacity: .7 }}>
                          Qwen3:30b
                        </span>
                      )}
                    </div>
                    <div style={{ display: 'flex', gap: 16, marginBottom: 8 }}>
                      <div>
                        <div style={{ fontSize: 9, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '.05em' }}>Breakout Score</div>
                        <div style={{ fontSize: 18, fontWeight: 900, fontFamily: 'var(--font-mono)', color: 'var(--text)' }}>{deepReasoning.breakout_score ?? '—'}<span style={{ fontSize: 11, color: 'var(--text-faint)' }}>/100</span></div>
                      </div>
                      <div>
                        <div style={{ fontSize: 9, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '.05em' }}>Confidence</div>
                        <div style={{ fontSize: 18, fontWeight: 900, fontFamily: 'var(--font-mono)', color: 'var(--text)' }}>{deepReasoning.confidence ?? '—'}<span style={{ fontSize: 11, color: 'var(--text-faint)' }}>/100</span></div>
                      </div>
                      {deepReasoning.risk_flag && (
                        <div>
                          <div style={{ fontSize: 9, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '.05em' }}>Risk</div>
                          <div style={{ fontSize: 13, fontWeight: 700, color: deepReasoning.risk_flag === 'none' ? 'var(--text-dim)' : '#ffb547', textTransform: 'capitalize' }}>{deepReasoning.risk_flag}</div>
                        </div>
                      )}
                    </div>
                    {deepReasoning.primary_reason && (
                      <div style={{ fontSize: 13, lineHeight: 1.55 }}>{deepReasoning.primary_reason}</div>
                    )}
                    {deepReasoning._consistency_warning && (
                      <div style={{ marginTop: 8, fontSize: 10, color: '#ffb547', fontFamily: 'var(--font-mono)' }}>
                        ⚠ {deepReasoning._consistency_warning}
                      </div>
                    )}
                  </div>
                );
              })()}

            </React.Fragment>
          )}

          {/* ── Game Log ── */}
          {activeTab === 'gamelog' && (
            <>
              {/* Year filter */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                {[2023, 2024, 2025, 2026].map(yr => (
                  <button
                    key={yr}
                    onClick={() => setStatYear(yr)}
                    style={{
                      fontFamily: 'var(--font-mono)', fontSize: 11, fontWeight: 700,
                      padding: '3px 12px', borderRadius: 4, cursor: 'pointer',
                      border: statYear === yr ? '1px solid var(--accent)' : '1px solid var(--border)',
                      background: statYear === yr ? 'rgba(198,255,58,.12)' : 'transparent',
                      color: statYear === yr ? 'var(--accent)' : 'var(--text-faint)',
                    }}
                  >{yr}{yr === 2026 && !has2026Data ? <span style={{ fontSize: 9, marginLeft: 4, opacity: 0.5 }}>No data yet</span> : null}</button>
                ))}
                {yearTeam && (
                  <span className="mono" style={{ fontSize: 10, display: 'flex', alignItems: 'center', gap: 6, marginLeft: 2 }}>
                    <span style={{ color: 'var(--text-dim)', fontWeight: 700 }}>{yearTeam}</span>
                    {yearOline && (
                      <span
                        title={`FantasAI O-Line Index (nflverse-derived) — Pass Block #${yearOline.pass_block_rank} of 32 · Run Block #${yearOline.run_block_rank} of 32`}
                        style={{
                          fontWeight: 700, padding: '1px 6px', borderRadius: 3,
                          color: yearOline.overall_rank <= 10 ? '#1affa0' : yearOline.overall_rank >= 23 ? '#ff4f4f' : 'var(--text-faint)',
                          background: yearOline.overall_rank <= 10 ? 'rgba(26,255,160,.1)' : yearOline.overall_rank >= 23 ? 'rgba(255,79,79,.1)' : 'transparent',
                        }}
                      >
                        OL #{yearOline.overall_rank} <span style={{ opacity: 0.7, fontWeight: 500 }}>(Run #{yearOline.run_block_rank} · Pass #{yearOline.pass_block_rank})</span>
                      </span>
                    )}
                  </span>
                )}
                {hasLive && <LiveBadge />}
                <span className="mono faint" style={{ fontSize: 9 }}>Sleeper API</span>
              </div>

              {loading
                ? <div className="muted-card" style={{ padding:18, display:'flex', alignItems:'center', gap:10 }}>
                    <div className="ai-orb" style={{ width:16, height:16 }} />
                    <span className="dim" style={{ fontSize:12 }}>Loading {statYear} stats from Sleeper…</span>
                  </div>
                : liveRows
                  ? <div style={{ overflowX: 'auto' }}>
                      <table className="gamelog">
                        <thead>
                          <tr>
                            <th>Wk</th>
                            {glCols(player.pos).map(c => <th key={c}>{c}</th>)}
                          </tr>
                        </thead>
                        <tbody>
                          {[...liveRows].sort((a, b) => a.wk - b.wk).map(({ wk, s }) => {
                            const cells   = glRow(player.pos, s);
                            if (!cells) return null;
                            const rawNums = glRawNums(player.pos, s) ?? [];
                            const ptsIdx  = cells.length - 1;
                            return (
                              <tr key={wk}>
                                <td className="mono" style={{ color:'var(--text-faint)', fontWeight: 600 }}>W{wk}</td>
                                {cells.map((c, i) => {
                                  const th = pctThresholds?.[i];
                                  const v  = rawNums[i] ?? 0;
                                  let color;
                                  if (th && v > 0) {
                                    const isTop    = th.higher ? v >= th.p75 : v <= th.p25;
                                    const isBottom = th.higher ? v <= th.p25 : v >= th.p75;
                                    color = isTop ? '#1affa0' : isBottom ? '#ff4f4f' : undefined;
                                  }
                                  return (
                                    <td key={i} style={{ fontWeight: i === ptsIdx ? 700 : undefined, color: color ?? (i === ptsIdx && v === 0 ? 'var(--text-faint)' : undefined) }}>
                                      {c}
                                    </td>
                                  );
                                })}
                              </tr>
                            );
                          })}
                          {/* Season totals row */}
                          {(() => {
                            const allNums = liveRows.map(({ s }) => glRawNums(player.pos, s)).filter(Boolean);
                            if (allNums.length < 2) return null;
                            const cols = glCols(player.pos);
                            const sums = allNums[0].map((_, col) => allNums.reduce((s, row) => s + (row[col] || 0), 0));
                            const gp = allNums.length;
                            const fmtTotal = (col) => {
                              const label = cols[col];
                              if (label === 'Cmp%' || label === 'FG%') return sums[col - 1] > 0 ? `${((sums[col - 2] / sums[col - 1]) * 100).toFixed(0)}%` : '—';
                              if (label === 'YPC') return sums[0] > 0 ? (sums[1] / sums[0]).toFixed(1) : '—';
                              if (label === 'Pts') return sums[col].toFixed(1);
                              return Math.round(sums[col]);
                            };
                            return (
                              <tr style={{ borderTop: '2px solid var(--accent)', background: 'rgba(198,255,58,.06)' }}>
                                <td className="mono" style={{ fontWeight: 800, color: 'var(--accent)', fontSize: 10 }}>{gp}G</td>
                                {cols.map((c, i) => (
                                  <td key={i} style={{ fontWeight: 700, color: c === 'Pts' ? 'var(--accent)' : 'var(--text)' }}>{fmtTotal(i)}</td>
                                ))}
                              </tr>
                            );
                          })()}
                        </tbody>
                      </table>
                    {/* Legend */}
                    <div style={{ display: 'flex', gap: 14, padding: '8px 0 0', alignItems: 'center' }}>
                      <span style={{ fontSize: 9, color: 'var(--text-faint)', fontFamily: 'var(--font-mono)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.08em' }}>Key:</span>
                      <span style={{ fontSize: 9, fontFamily: 'var(--font-mono)', color: '#1affa0', fontWeight: 700 }}>■ Top 25%</span>
                      <span style={{ fontSize: 9, fontFamily: 'var(--font-mono)', color: '#ff4f4f', fontWeight: 700 }}>■ Bottom 25%</span>
                      <span style={{ fontSize: 9, fontFamily: 'var(--font-mono)', color: 'var(--text-faint)' }}>■ Average</span>
                    </div>
                  </div>
                  : statYear === 2026
                    ? <div className="muted-card" style={{ padding: 18, textAlign: 'center' }}>
                        <div className="dim" style={{ fontSize: 12 }}>2026 season hasn't started yet — check back in September.</div>
                      </div>
                    : player.rookie
                      ? <div style={{ padding: '12px 0' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                            <span style={{ fontSize: 13, fontWeight: 700, color: '#a78bfa' }}>College Stats</span>
                            <span style={{ fontSize: 10, color: 'var(--text-faint)', fontFamily: 'var(--font-mono)' }}>CFBD</span>
                          </div>
                          {collegeStats ? (() => {
                            const pos = player.pos;
                            const cols = pos === 'QB'
                              ? [{ k: 'Cmp', fn: s => s.completions }, { k: 'Att', fn: s => s.att }, { k: 'Yds', fn: s => s.yds }, { k: 'TD', fn: s => s.td }, { k: 'INT', fn: s => s.int }, { k: 'Pct', fn: s => s.pct?.toFixed?.(1) ?? s.pct }]
                              : pos === 'RB'
                              ? [{ k: 'Car', fn: s => s.car }, { k: 'Yds', fn: s => s.yds }, { k: 'TD', fn: s => s.td }, { k: 'Rec', fn: s => s.rec }, { k: 'YPC', fn: s => s.ypc?.toFixed?.(1) ?? s.ypc }]
                              : [{ k: 'Rec', fn: s => s.rec }, { k: 'Yds', fn: s => s.yds }, { k: 'TD', fn: s => s.td }, { k: 'Long', fn: s => s.long }, { k: 'YPR', fn: s => s.ypr?.toFixed?.(1) ?? s.ypr }];
                            return (
                              <div style={{ overflowX: 'auto' }}>
                                <table className="gamelog">
                                  <thead>
                                    <tr>
                                      <th style={{ textAlign: 'left' }}>Year</th>
                                      <th style={{ textAlign: 'left' }}>Team</th>
                                      {cols.map(c => <th key={c.k}>{c.k}</th>)}
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {collegeStats.map(cs => (
                                      <tr key={cs.season}>
                                        <td style={{ fontWeight: 700, color: '#a78bfa' }}>{cs.season}</td>
                                        <td style={{ color: 'var(--text-dim)' }}>{cs.team}</td>
                                        {cols.map(c => {
                                          const v = c.fn(cs);
                                          return <td key={c.k}>{v != null ? (typeof v === 'number' ? Math.round(v) || v : v) : '—'}</td>;
                                        })}
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                            );
                          })() : (
                            <div style={{ textAlign: 'center', padding: 16 }}>
                              <div style={{ fontSize: 11, color: 'var(--text-faint)' }}>No college stats available</div>
                            </div>
                          )}
                        </div>
                      : <></>

              }
            </>
          )}

          {/* ── Next Gen Stats ── */}
          {activeTab === 'nextgen' && (
            loading
              ? <div className="muted-card" style={{ padding: 18, display: 'flex', alignItems: 'center', gap: 10 }}>
                  <div className="ai-orb" style={{ width: 16, height: 16 }} />
                  <span className="dim" style={{ fontSize: 12 }}>Loading advanced stats from Sleeper…</span>
                </div>
              : <>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
                    <span className="dim" style={{ fontSize: 11 }}>2025 Season · Advanced Metrics</span>
                    {hasLive && <LiveBadge />}
                    <span className="mono faint" style={{ fontSize: 9 }}>{hasLive ? 'Sleeper API · live' : (tot ? 'R2 · pre-baked' : 'Sleeper API')}</span>
                  </div>
                  <NextGenStatsPanel pos={player.pos} tot={tot} gp={gp} player={player} />

                  {/* Per-game stats from R2 export */}
                  {player.pos !== 'DST' && player.pos !== 'K' && (player.snapPct != null || player.adot != null || player.tgtG != null) && (() => {
                    const allP = getPlayers().filter(x => x.pos === player.pos && x.ecr < 500);
                    const ngRank = (field, higher = true) => {
                      const vals = allP.filter(x => x[field] != null && x[field] > 0).sort((a, b) => higher ? b[field] - a[field] : a[field] - b[field]);
                      const idx = vals.findIndex(x => x.id === player.id);
                      return idx >= 0 ? { rank: idx + 1, leagueN: vals.length } : {};
                    };
                    return (
                    <div className="card" style={{ marginTop: 16 }}>
                      <div className="card-head">
                        <div className="card-title" style={{ color: '#ffcc44' }}>Per Game Averages</div>
                        <span style={{ fontSize: 10, color: 'var(--text-faint)', fontFamily: 'var(--font-mono)' }}>R2 Export · 2025</span>
                      </div>
                      <div className="card-body">
                        {player.snapPct != null && <SeasonStatBar label="Snap %" val={`${player.snapPct.toFixed(0)}%`} max={100} leagueAvg={player.pos === 'QB' ? 95 : 55} {...ngRank('snapPct')} />}
                        {player.tgtG != null && (player.pos === 'WR' || player.pos === 'TE' || player.pos === 'RB') && <SeasonStatBar label="Targets / Game" val={player.tgtG.toFixed(1)} max={player.pos === 'RB' ? 8 : 12} leagueAvg={player.pos === 'WR' ? 5.5 : player.pos === 'TE' ? 4.5 : 2.8} {...ngRank('tgtG')} />}
                        {player.targetShare > 0 && <SeasonStatBar label="Target Share" val={`${player.targetShare.toFixed(1)}%`} max={player.pos === 'RB' ? 20 : 35} leagueAvg={player.pos === 'WR' ? 15 : player.pos === 'TE' ? 12 : 5} {...ngRank('targetShare')} />}
                        {player.attG != null && (player.pos === 'RB' || player.pos === 'QB') && <SeasonStatBar label="Rush Att / Game" val={player.attG.toFixed(1)} max={25} leagueAvg={player.pos === 'RB' ? 12 : 4} {...ngRank('attG')} />}
                        {player.adot != null && (player.pos === 'WR' || player.pos === 'TE' || player.pos === 'RB') && <SeasonStatBar label="ADOT" val={player.adot.toFixed(1)} max={player.pos === 'RB' ? 8 : 20} leagueAvg={player.pos === 'WR' ? 10.5 : player.pos === 'TE' ? 7.5 : 1.5} {...ngRank('adot')} />}
                        {player.airYds != null && (player.pos === 'WR' || player.pos === 'TE' || player.pos === 'RB') && <SeasonStatBar label="Air Yards (season)" val={Math.round(player.airYds)} max={player.pos === 'RB' ? 500 : 1800} leagueAvg={player.pos === 'WR' ? 600 : player.pos === 'TE' ? 350 : 100} {...ngRank('airYds')} />}
                        {player.yac > 0 && <SeasonStatBar label="YAC (season)" val={Math.round(player.yac)} max={800} leagueAvg={player.pos === 'WR' ? 250 : player.pos === 'RB' ? 150 : 180} {...ngRank('yac')} />}
                        {player.yptgt != null && (player.pos === 'WR' || player.pos === 'TE') && <SeasonStatBar label="Yards / Target" val={player.yptgt.toFixed(1)} max={15} leagueAvg={player.pos === 'WR' ? 7.5 : 6.5} {...ngRank('yptgt')} />}
                        {player.comboYdsG != null && <SeasonStatBar label="Combo Yds / Game" val={player.comboYdsG.toFixed(1)} max={150} leagueAvg={player.pos === 'RB' ? 65 : player.pos === 'WR' ? 55 : 40} {...ngRank('comboYdsG')} />}
                        {player.avgRzAttG != null && player.pos === 'RB' && <SeasonStatBar label="Red Zone Att / Game" val={player.avgRzAttG.toFixed(1)} max={5} leagueAvg={1.5} {...ngRank('avgRzAttG')} />}
                      </div>
                    </div>
                    );
                  })()}

                  {/* Efficiency Profile — EPA, success rate, explosive plays, opportunity/efficiency scores */}
                  {efficiencyData && (
                    <div className="card" style={{ marginTop: 16 }}>
                      <div className="card-head">
                        <div className="card-title" style={{ color: '#c6ff3a' }}>Efficiency Profile</div>
                        <span style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--text-faint)' }}>
                          nflverse play-by-play · Wk {efficiencyData.week}, {efficiencyData.season}
                        </span>
                      </div>
                      <div className="card-body">
                        {efficiencyData.epa_per_opportunity != null && (
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, padding: '8px 10px', background: 'var(--panel-3)', borderRadius: 6 }}>
                            <span className="dim" style={{ fontSize: 11 }}>EPA / Opportunity</span>
                            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 14, fontWeight: 800, color: efficiencyData.epa_per_opportunity >= 0.2 ? '#1affa0' : efficiencyData.epa_per_opportunity >= 0 ? '#4ea8ff' : '#ff4f4f' }}>
                              {efficiencyData.epa_per_opportunity >= 0 ? '+' : ''}{efficiencyData.epa_per_opportunity.toFixed(2)}
                            </span>
                          </div>
                        )}
                        {efficiencyData.efficiency_score != null && <SeasonStatBar label="Efficiency Score" val={efficiencyData.efficiency_score.toFixed(1)} max={100} leagueAvg={50} />}
                        {efficiencyData.opportunity_score != null && <SeasonStatBar label="Opportunity Score" val={efficiencyData.opportunity_score.toFixed(1)} max={10} leagueAvg={5} />}
                        {efficiencyData.success_rate != null && <SeasonStatBar label="Success Rate" val={`${(efficiencyData.success_rate * 100).toFixed(0)}%`} max={100} leagueAvg={45} />}
                        {(efficiencyData.explosive_run_rate != null || efficiencyData.explosive_rec_rate != null) && (
                          <SeasonStatBar
                            label={player.pos === 'WR' || player.pos === 'TE' ? 'Explosive Reception Rate' : 'Explosive Run Rate'}
                            val={`${((efficiencyData.explosive_run_rate ?? efficiencyData.explosive_rec_rate) * 100).toFixed(0)}%`}
                            max={40}
                          />
                        )}
                        {efficiencyData.yards_per_target != null && (player.pos === 'WR' || player.pos === 'TE' || player.pos === 'RB') && (
                          <SeasonStatBar label="Yards / Target" val={efficiencyData.yards_per_target.toFixed(1)} max={15} leagueAvg={7.5} />
                        )}
                        {efficiencyData.elusiveness_score != null && (player.pos === 'RB' || player.pos === 'QB') && (
                          <SeasonStatBar label="Elusiveness Score" val={efficiencyData.elusiveness_score.toFixed(1)} max={100} leagueAvg={40} />
                        )}
                      </div>
                    </div>
                  )}
                </>
          )}

          {/* ── Ecosystem ── */}
          {activeTab === 'ecosystem' && (() => {
            const showWeapon = ['WR', 'TE', 'RB'].includes(player.pos);
            const isSkillPos = player.pos === 'QB' || showWeapon;
            if (!isSkillPos) {
              return <div className="muted-card" style={{ padding: 18 }}>Ecosystem view isn't available for this position.</div>;
            }
            return (
              <>
                {showWeapon && (
                  weaponScore ? (
                    <div className="card">
                      <div className="card-head">
                        <div className="card-title">Weapon Score</div>
                        <span className="mono faint" style={{ fontSize: 9 }}>{weaponScore.season}</span>
                      </div>
                      <div className="card-body" style={{ display: 'flex', gap: 20, flexWrap: 'wrap', alignItems: 'center' }}>
                        <div>
                          <div style={{ fontSize: 32, fontWeight: 800, fontFamily: 'var(--font-mono)' }}>{weaponScore.weapon_score?.toFixed(0)}</div>
                          {(() => {
                            const tier = scoreToTier(weaponScore.weapon_score);
                            const ts = SCORE_TIER_STYLE[tier];
                            return <span style={{ color: ts?.color, background: ts?.bg, border: `1px solid ${ts?.border}`, borderRadius: 4, padding: '3px 8px', fontSize: 11, fontWeight: 700 }}>{tier}</span>;
                          })()}
                        </div>
                        <RadarChart axes={player.pos === 'RB' ? [
                          { label: 'Tgt Share',  value: weaponScore.target_share_score },
                          { label: 'EPA/Tgt',    value: weaponScore.epa_per_target_score },
                          { label: 'Catch %',    value: weaponScore.catch_rate_score },
                          { label: 'Yds/Tgt',    value: weaponScore.yards_per_target_score },
                          { label: 'Red Zone',   value: weaponScore.redzone_score },
                          { label: 'Explosive%', value: weaponScore.explosive_rec_rate_score },
                        ] : [
                          { label: 'Tgt Share',  value: weaponScore.target_share_score },
                          { label: 'ADOT',       value: weaponScore.adot_score },
                          { label: 'Separation', value: weaponScore.separation_score },
                          { label: 'Catch %',    value: weaponScore.catch_rate_score },
                          { label: 'YACOE',      value: weaponScore.yacoe_score },
                          { label: 'Red Zone',   value: weaponScore.redzone_score },
                        ]} />
                      </div>
                    </div>
                  ) : <div className="muted-card" style={{ padding: 18 }}>No Weapon Score data yet for {player.name}.</div>
                )}

                {supportScore ? (
                  <>
                  <div className="card" style={{ marginTop: showWeapon ? 16 : 0 }}>
                    <div className="card-head">
                      <div className="card-title">O-Line Support Score</div>
                      <span className="mono faint" style={{ fontSize: 9 }}>{yearTeam} · {supportScore.season ?? statYear}</span>
                    </div>
                    <div className="card-body">
                      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14, flexWrap: 'wrap' }}>
                        <span style={{ fontSize: 32, fontWeight: 800, fontFamily: 'var(--font-mono)' }}>
                          {supportScore.support_score?.toFixed(0)}
                        </span>
                        {(() => {
                          const tier = scoreToTier(supportScore.support_score);
                          const ts = SCORE_TIER_STYLE[tier];
                          return <span style={{ color: ts?.color, background: ts?.bg, border: `1px solid ${ts?.border}`, borderRadius: 4, padding: '3px 8px', fontSize: 11, fontWeight: 700 }}>{tier}</span>;
                        })()}
                        {olineYoY && (() => {
                          const up = olineYoY.scoreDelta > 0;
                          const flat = Math.abs(olineYoY.scoreDelta) < 0.05;
                          const color = flat ? 'var(--text-faint)' : up ? '#1affa0' : '#ff4f4f';
                          return (
                            <span
                              title={`O-Line overall score ${olineYoY.cur.overall_score.toFixed(1)} (${olineYoY.year}) vs ${olineYoY.prev.overall_score.toFixed(1)} (${olineYoY.prevYear}) — rank #${olineYoY.cur.overall_rank} vs #${olineYoY.prev.overall_rank}`}
                              style={{
                                fontFamily: 'var(--font-mono)', fontSize: 11, fontWeight: 700,
                                padding: '3px 9px', borderRadius: 20,
                                color, background: `${color}18`, border: `1px solid ${color}55`,
                              }}
                            >
                              {flat ? '◆ Same as' : up ? '▲ Better than' : '▼ Worse than'} {olineYoY.prevYear}
                              <span style={{ opacity: 0.75, fontWeight: 600, marginLeft: 5 }}>
                                ({olineYoY.scoreDelta >= 0 ? '+' : ''}{olineYoY.scoreDelta.toFixed(1)} pts, rank {olineYoY.rankDelta >= 0 ? '+' : ''}{olineYoY.rankDelta})
                              </span>
                            </span>
                          );
                        })()}
                        {olineWoW && (() => {
                          const up = olineWoW.scoreDelta > 0;
                          const flat = Math.abs(olineWoW.scoreDelta) < 0.05;
                          const color = flat ? 'var(--text-faint)' : up ? '#1affa0' : '#ff4f4f';
                          return (
                            <span
                              title={`O-Line overall score ${olineWoW.cur.overall_score.toFixed(1)} (Wk ${olineWoW.week}) vs ${olineWoW.prev.overall_score.toFixed(1)} (Wk ${olineWoW.prevWeek}) — rank #${olineWoW.cur.overall_rank} vs #${olineWoW.prev.overall_rank}`}
                              style={{
                                fontFamily: 'var(--font-mono)', fontSize: 11, fontWeight: 700,
                                padding: '3px 9px', borderRadius: 20,
                                color, background: `${color}18`, border: `1px solid ${color}55`,
                              }}
                            >
                              {flat ? '◆ Same as' : up ? '▲ Better than' : '▼ Worse than'} Wk {olineWoW.prevWeek}
                              <span style={{ opacity: 0.75, fontWeight: 600, marginLeft: 5 }}>
                                ({olineWoW.scoreDelta >= 0 ? '+' : ''}{olineWoW.scoreDelta.toFixed(1)} pts)
                              </span>
                            </span>
                          );
                        })()}
                      </div>
                      <SeasonStatBar label="O-Line"          val={supportScore.oline_score?.toFixed(0)}           max={100} />
                      <SeasonStatBar label="Best WR/TE"      val={supportScore.best_wrte_weapon_score?.toFixed(0)} max={100} />
                      <SeasonStatBar label="Receiving RB"    val={supportScore.best_rb_weapon_score?.toFixed(0)}   max={100} />
                      <SeasonStatBar label="Offensive Pace"  val={supportScore.pace_score?.toFixed(0)}             max={100} />
                      <SeasonStatBar label="Red Zone Volume" val={supportScore.redzone_score?.toFixed(0)}          max={100} />
                    </div>
                  </div>
                  <div className="card" style={{ marginTop: 16 }}>
                    <div className="card-head">
                      <div className="card-title">O-Line Starters</div>
                      {olineStartersYoY && (
                        <span className="mono faint" style={{ fontSize: 9 }}>vs {olineYoY?.prevYear} — new starter colored by team O-Line trend</span>
                      )}
                    </div>
                    <div className="card-body" style={{ display: 'grid', gridTemplateColumns: 'repeat(5,1fr)', gap: 8 }}>
                      {['LT','LG','C','RG','RT'].map(slot => {
                        const name = supportScore.oline_starters?.[slot];
                        const prevName = olineStartersYoY?.prevStarters?.[slot];
                        const changed = olineStartersYoY && name && prevName && name !== prevName;
                        const isRookie = name && rookieByName.get(name.toLowerCase().trim());
                        const rookieScore = isRookie ? olineRookieScoreByName.get(name.toLowerCase().trim()) : null;

                        // Prefer a real signal in this order: (1) rookie draft-capital
                        // score, when available — the only real evaluation possible
                        // before a rookie starter has played a down for this team;
                        // (2) the team's actual measured O-Line trend, once real
                        // current-season data exists; (3) no color if neither exists
                        // yet (e.g. a non-rookie starter change before the season starts).
                        let trend = null; // true = upgrade, false = downgrade, null = unknown
                        let label = null;
                        if (changed && rookieScore != null) {
                          trend = rookieScore >= 70 ? true : rookieScore < 35 ? false : null;
                          label = `${trend === true ? '▲' : trend === false ? '▼' : '◆'} rookie (${rookieScore.toFixed(0)} draft capital)`;
                        } else if (changed && olineStartersYoY.teamImproved != null) {
                          trend = olineStartersYoY.teamImproved;
                          label = trend ? '▲ upgrade' : '▼ downgrade';
                        }
                        const color = trend === true ? '#1affa0' : trend === false ? '#ff4f4f' : changed ? 'var(--text-faint)' : 'var(--text)';
                        return (
                          <div key={slot} style={{ textAlign: 'center' }} title={changed ? `Was ${prevName} in ${olineYoY?.prevYear ?? (new Date().getFullYear() - 1)}` : undefined}>
                            <div className="dim" style={{ fontSize: 10 }}>{slot}</div>
                            <div style={{ fontSize: 12, fontWeight: 700, color, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 3 }}>
                              {name ?? '—'}
                              {isRookie && (
                                <span
                                  title="Rookie"
                                  style={{
                                    fontSize: 9, fontWeight: 900, color: '#b78bff',
                                    background: 'rgba(183,139,255,.15)', border: '1px solid rgba(183,139,255,.5)',
                                    borderRadius: 3, padding: '0 4px', lineHeight: '14px',
                                  }}
                                >R</span>
                              )}
                            </div>
                            {changed && (
                              <div style={{ fontSize: 9, fontWeight: 700, color }}>{label ?? 'new starter'}</div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {teamOlStability && (
                    <>
                      <div className="card" style={{ marginTop: 16 }}>
                        <div className="card-head">
                          <div className="card-title">O-Line Stability Index</div>
                          <span className="mono faint" style={{ fontSize: 9 }}>real counting stats, no fabricated grades</span>
                        </div>
                        <div className="card-body">
                          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14 }}>
                            <span style={{ fontSize: 32, fontWeight: 800, fontFamily: 'var(--font-mono)' }}>
                              {teamOlStability.olsi_score?.toFixed(0)}
                            </span>
                            {(() => {
                              const tier = scoreToTier(teamOlStability.olsi_score);
                              const ts = SCORE_TIER_STYLE[tier];
                              return <span style={{ color: ts?.color, background: ts?.bg, border: `1px solid ${ts?.border}`, borderRadius: 4, padding: '3px 8px', fontSize: 11, fontWeight: 700 }}>{tier}</span>;
                            })()}
                          </div>
                          <SeasonStatBar label="Pass Protection" val={teamOlStability.pass_block_score?.toFixed(0)}     max={100} />
                          <SeasonStatBar label="Run Blocking"    val={teamOlStability.run_block_score?.toFixed(0)}      max={100} />
                          <SeasonStatBar label="Continuity"      val={teamOlStability.continuity_score?.toFixed(0)}     max={100} />
                          <SeasonStatBar label="Health"          val={teamOlStability.health_score?.toFixed(0)}         max={100} />
                          <SeasonStatBar label="Experience"      val={teamOlStability.experience_score?.toFixed(0)}     max={100} />
                        </div>
                      </div>

                      <div className="card" style={{ marginTop: 16 }}>
                        <div className="card-head"><div className="card-title">Chemistry</div></div>
                        <div className="card-body">
                          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 10, marginBottom: 12 }}>
                            <div>
                              <div className="dim" style={{ fontSize: 10 }}>Returning Starters</div>
                              <div style={{ fontSize: 16, fontWeight: 700 }}>
                                {teamOlStability.returning_starters_ct != null ? `${teamOlStability.returning_starters_ct}/5` : '—'}
                              </div>
                            </div>
                            <div>
                              <div className="dim" style={{ fontSize: 10 }}>Games Together</div>
                              <div style={{ fontSize: 16, fontWeight: 700 }}>
                                {teamOlStability.games_started_together}/{teamOlStability.team_games_played}
                              </div>
                            </div>
                            <div>
                              <div className="dim" style={{ fontSize: 10 }}>Shared Snaps</div>
                              <div style={{ fontSize: 16, fontWeight: 700 }}>{teamOlStability.shared_snaps?.toLocaleString()}</div>
                            </div>
                          </div>
                          <SeasonStatBar label="Chemistry Score" val={teamOlStability.chemistry_score?.toFixed(0)} max={100} />
                        </div>
                      </div>
                    </>
                  )}

                  {olLinemen.length > 0 && (
                    <div className="card" style={{ marginTop: 16 }}>
                      <div className="card-head"><div className="card-title">Individual Linemen</div></div>
                      <div className="card-body" style={{ overflowX: 'auto' }}>
                        <div style={{ display: 'grid', gridTemplateColumns: '2fr 0.5fr 0.5fr 0.6fr 0.7fr 0.9fr 0.7fr 0.7fr 0.7fr', gap: 6, fontSize: 9, color: 'var(--text-faint)', fontWeight: 700, letterSpacing: '.04em', marginBottom: 6, minWidth: 640 }}>
                          <div>NAME</div><div>SLOT</div><div>AGE</div><div>EXP</div><div>STARTS</div><div>SNAPS</div><div>PEN</div><div>MISSED</div><div>CONT.</div>
                        </div>
                        {olLinemen.map(p => (
                          <div key={p.gsis_id} style={{ display: 'grid', gridTemplateColumns: '2fr 0.5fr 0.5fr 0.6fr 0.7fr 0.9fr 0.7fr 0.7fr 0.7fr', gap: 6, fontSize: 11, padding: '4px 0', borderTop: '1px solid var(--border)', minWidth: 640, alignItems: 'center' }}>
                            <div style={{ fontWeight: p.is_primary_starter ? 700 : 400 }}>{p.player_name}</div>
                            <div className="mono">{p.current_pos_abb ?? '—'}</div>
                            <div className="mono">{p.age?.toFixed(0) ?? '—'}</div>
                            <div className="mono">{p.years_exp ?? '—'}</div>
                            <div className="mono">{p.starts}</div>
                            <div className="mono">{p.snaps?.toLocaleString()}</div>
                            <div className="mono" title={`Holding ${p.penalties_holding} · False Start ${p.penalties_false_start}`}>
                              H:{p.penalties_holding} FS:{p.penalties_false_start}
                            </div>
                            <div className="mono">{p.games_missed}</div>
                            <div className="mono">{p.continuity_games}</div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  </>
                ) : <div className="muted-card" style={{ padding: 18, marginTop: showWeapon ? 16 : 0 }}>No O-Line Support Score data yet for {yearTeam || 'this team'}.</div>}
              </>
            );
          })()}

          {/* ── News ── */}
          {activeTab === 'news' && (
            <>
              <a
                href={`https://www.youtube.com/results?search_query=${encodeURIComponent(player.name + ' NFL highlights')}`}
                target="_blank"
                rel="noopener noreferrer"
                style={{ textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 5, padding: '6px 12px', borderRadius: 6, background: 'rgba(26,255,160,.08)', border: '1px solid rgba(26,255,160,.35)', color: '#1affa0', fontSize: 11, fontWeight: 700, fontFamily: 'var(--font-mono)', letterSpacing: '.04em', marginBottom: 14 }}
              >
                <svg width="14" height="10" viewBox="0 0 18 13" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ flexShrink: 0 }}>
                  <path d="M17.6 2.03C17.4 1.29 16.83.72 16.09.52 14.67.14 9 .14 9 .14S3.33.14 1.91.52C1.17.72.6 1.29.4 2.03 0 3.47 0 6.5 0 6.5s0 3.03.4 4.47c.2.74.77 1.31 1.51 1.51C3.33 12.86 9 12.86 9 12.86s5.67 0 7.09-.38c.74-.2 1.31-.77 1.51-1.51C18 9.53 18 6.5 18 6.5s0-3.03-.4-4.47z" fill="#1affa0"/>
                  <path d="M7.2 9.29l4.73-2.79L7.2 3.71v5.58z" fill="black"/>
                </svg>
                Highlights
              </a>

              {startSit && (() => {
                const rec  = startSit.recommendation;
                const conf = startSit.confidence;
                const mi   = startSit.matchup_indicator;
                const clr  = rec === 'MONITOR' ? '#ff9800' : rec?.startsWith('START') ? '#1affa0' : rec?.startsWith('SIT') ? '#ff4f4f' : '#ffb547';
                const bg   = rec === 'MONITOR' ? 'rgba(255,152,0,.08)' : rec === 'START' ? 'rgba(26,255,160,.08)' : rec === 'SIT' ? 'rgba(255,79,79,.08)' : 'rgba(255,181,71,.08)';
                const bdr  = rec === 'MONITOR' ? 'rgba(255,152,0,.25)' : rec === 'START' ? 'rgba(26,255,160,.25)' : rec === 'SIT' ? 'rgba(255,79,79,.25)' : 'rgba(255,181,71,.25)';
                const miClr = mi === 'SMASH' ? '#1affa0' : mi === 'FAVORABLE' ? '#1affa0' : mi === 'AVOID' ? '#ff4f4f' : mi === 'DIFFICULT' ? '#ff9800' : 'var(--text)';
                const factors = startSit.factors || [];
                const scoreVal = startSit.start_score ?? 0;
                const scoreBarClr = scoreVal >= 65 ? '#1affa0' : scoreVal <= 35 ? '#ff4f4f' : '#ffb547';
                return (
                  <div className="card" style={{ marginBottom: 14, padding: '12px 16px' }}>
                    <div style={{ fontSize: 11, fontWeight: 800, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '.08em', marginBottom: 8 }}>Start/Sit Advice</div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8, flexWrap: 'wrap' }}>
                      <span style={{ fontSize: 11, fontFamily: 'var(--font-mono)', fontWeight: 900, padding: '2px 8px', borderRadius: 4, color: clr, background: bg, border: `1px solid ${bdr}`, letterSpacing: '.08em' }}>
                        {rec}
                      </span>
                      {startSit.depth_label && (
                        <span style={{ fontSize: 9, fontFamily: 'var(--font-mono)', color: startSit.depth_order > 1 ? '#ffb547' : 'var(--text-faint)', fontWeight: startSit.depth_order > 1 ? 700 : 400 }}>
                          {startSit.depth_label}
                        </span>
                      )}
                      <span style={{ fontSize: 9, fontFamily: 'var(--font-mono)', color: 'var(--text-faint)' }}>Week {startSit.week}</span>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '110px 1fr', gap: '3px 8px', fontSize: 10, fontFamily: 'var(--font-mono)', marginBottom: 8 }}>
                      {startSit.start_score != null && <>
                        <span style={{ color: 'var(--text-faint)', fontWeight: 700 }}>Start Score:</span>
                        <span style={{ fontWeight: 900, fontSize: 13, color: scoreBarClr }}>{startSit.start_score}<span style={{ color: 'var(--text-faint)', fontSize: 10, fontWeight: 400 }}>/100</span> <span style={{ fontSize: 9, color: clr, fontWeight: 700 }}>{conf}</span></span>
                      </>}
                      {mi && <>
                        <span style={{ color: 'var(--text-faint)', fontWeight: 700 }}>{startSit.matchup_type || 'Defense Matchup'}:</span>
                        <span style={{ fontWeight: 800, color: miClr }}>{mi}{startSit.def_rank && startSit.def_rank !== '?' ? ` (#${startSit.def_rank}/32)` : ''}</span>
                      </>}
                      {startSit.opponent && <>
                        <span style={{ color: 'var(--text-faint)', fontWeight: 700 }}>Opponent:</span>
                        <span style={{ fontWeight: 700, color: 'var(--text)' }}>vs {startSit.opponent}</span>
                      </>}
                    </div>
                    {startSit.start_score != null && (
                      <div style={{ height: 3, borderRadius: 2, background: 'rgba(255,255,255,.08)', marginBottom: 8, overflow: 'hidden' }}>
                        <div style={{ height: '100%', width: `${scoreVal}%`, background: scoreBarClr, borderRadius: 2, transition: 'width .4s' }} />
                      </div>
                    )}
                    {startSit.summary && (
                      <div style={{ fontSize: 11, color: 'var(--text-dim)', lineHeight: 1.5, marginBottom: 8, fontStyle: 'italic' }}>
                        {startSit.summary}
                      </div>
                    )}
                    {factors.length > 0 && (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                        {factors.map((f, fi) => {
                          const fc = f.sentiment === 'positive' ? '#1affa0' : f.sentiment === 'negative' ? '#ff4f4f' : 'var(--text-faint)';
                          const sym = f.sentiment === 'positive' ? '▲' : f.sentiment === 'negative' ? '▼' : '◆';
                          return (
                            <div key={fi} style={{ display: 'flex', gap: 5, alignItems: 'flex-start' }}>
                              <span style={{ color: fc, fontSize: 9, marginTop: 2, flexShrink: 0 }}>{sym}</span>
                              <span style={{ fontSize: 10, color: 'var(--text-dim)', lineHeight: 1.4 }}>
                                <strong style={{ color: 'var(--text)', fontFamily: 'var(--font-mono)', fontSize: 9, fontWeight: 700, letterSpacing: '.04em' }}>{f.label}: </strong>
                                {f.text}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })()}

              {!articlesLoading && playerArticles.length > 0 && (
                <div className="card" style={{ marginBottom: 14 }}>
                  <div className="card-head">
                    <div className="card-title" style={{ fontSize: 11, letterSpacing: '.08em' }}>Player Articles</div>
                    <span style={{ fontSize: 9, color: 'var(--text-faint)', fontFamily: 'var(--font-mono)' }}>{playerArticles.length}</span>
                  </div>
                  <div style={{ padding: '4px 16px 12px', display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {playerArticles.map((a, i) => {
                      const url = a.article_url || a.source_url || '';
                      const pub = a.published_at ? new Date(a.published_at) : null;
                      const pubStr = pub ? pub.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : null;
                      if (!url) return null;
                      return (
                        <a
                          key={i}
                          href={url}
                          target="_blank"
                          rel="noopener noreferrer"
                          style={{ display: 'flex', alignItems: 'baseline', gap: 8, fontSize: 12, color: '#4ea8ff', textDecoration: 'none', lineHeight: 1.4 }}
                        >
                          <span style={{ flexShrink: 0 }}>↗</span>
                          <span style={{ flex: 1 }}>{a.headline || a.title}</span>
                          {pubStr && <span style={{ flexShrink: 0, fontSize: 10, color: 'var(--text-faint)', fontFamily: 'var(--font-mono)' }}>{pubStr}</span>}
                        </a>
                      );
                    })}
                  </div>
                </div>
              )}

              <PlayerNewsCard items={playerNewsItems} loading={newsLoading || loading} playerName={player.name} />
              <PlayerArticlesCard articles={playerArticles} loading={articlesLoading} />
            </>
          )}

          {/* ── Matchup ── */}
          {activeTab === 'matchup' && (
            <div>
              {/* Matchup rating banner */}
              {detailMatchupRating ? (
                <div style={{ marginBottom: 16, padding: '14px 18px', borderRadius: 10, border: `1px solid ${detailMatchupRating.color}44`, background: `${detailMatchupRating.color}11`, display: 'flex', alignItems: 'center', gap: 16 }}>
                  <div style={{ fontFamily: 'var(--font-mono)', fontSize: 36, fontWeight: 900, color: detailMatchupRating.color, lineHeight: 1 }}>
                    {detailMatchupRating.score > 0 ? '+' : ''}{detailMatchupRating.score}
                  </div>
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                      <span style={{ fontSize: 15, fontWeight: 800, color: detailMatchupRating.color }}>{detailMatchupRating.label}</span>
                      <span style={{ fontSize: 10, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '.05em' }}>{player.pos} vs</span>
                      <span style={{
                        fontSize: 18, fontWeight: 900, fontFamily: 'var(--font-mono)', letterSpacing: '.03em',
                        color: 'var(--text)', background: 'rgba(255,255,255,.08)', border: `1px solid ${detailMatchupRating.color}66`,
                        borderRadius: 6, padding: '2px 10px',
                      }}>{displayOpp}</span>
                    </div>
                    <div className="mono" style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 6 }}>
                      #{detailMatchupRating.rank} of 32 defenses · {detailMatchupRating.avg_pts_allowed} pts/g allowed to {player.pos}s
                    </div>
                  </div>
                </div>
              ) : (
                <div style={{ marginBottom: 16, padding: '12px 16px', borderRadius: 10, background: 'rgba(255,255,255,.04)', color: 'var(--text-faint)', fontSize: 12 }}>
                  No 2026 matchup data for {displayOpp || 'this player'}
                </div>
              )}
              {/* All positions vs this defense */}
              {r2DefVsPos?.data?.length > 0 && displayOpp && (() => {
                const oppTeam = displayOpp.replace(/^@/, '').toUpperCase();
                const rows = r2DefVsPos.data.filter(r => r.def_team?.toUpperCase() === oppTeam);
                if (!rows.length) return null;
                const posOrder = ['QB','RB','WR','TE','K'];
                const sorted = posOrder.map(pos => rows.find(r => r.position === pos)).filter(Boolean);
                return (
                  <>
                    <div className="card-title" style={{ marginBottom: 8 }}>2026 Defense vs Position · {oppTeam}</div>
                    <table className="gamelog">
                      <thead><tr><th>Pos</th><th>Pts Allowed/G</th><th>Rank</th><th>Matchup</th></tr></thead>
                      <tbody>
                        {sorted.map(r => {
                          const isPlayer = r.position === player.pos;
                          const mc = r.rank_vs_pos <= 5  ? { label: 'AVOID',     color: '#ff5a6e' }
                                   : r.rank_vs_pos <= 10 ? { label: 'TOUGH',     color: '#ff9f3f' }
                                   : r.rank_vs_pos >= 28 ? { label: 'SMASH',     color: '#4ed87b' }
                                   : r.rank_vs_pos >= 23 ? { label: 'FAVORABLE', color: '#4ea8ff' }
                                   : { label: 'NEUTRAL', color: 'var(--text-faint)' };
                          return (
                            <tr key={r.position} style={isPlayer ? { background: 'rgba(255,255,255,.04)', fontWeight: 700 } : {}}>
                              <td><span style={{ color: isPlayer ? mc.color : 'var(--text-dim)' }}>{r.position}{isPlayer ? ' ★' : ''}</span></td>
                              <td>{r.avg_pts_allowed}</td>
                              <td style={{ color: mc.color }}>#{r.rank_vs_pos}</td>
                              <td><span style={{ fontSize: 10, fontWeight: 700, color: mc.color }}>{mc.label}</span></td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </>
                );
              })()}

              {/* Coverage Matchup — real man/zone + per-scheme splits from nflverse PBP charting.
                  Not shown for RBs — a runner's occasional receiving work isn't the relevant
                  signal; Rush Box Matchup below covers rushing instead. */}
              {player.pos !== 'RB' && (coverageSplits || opponentTendency) && (
                <div className="muted-card" style={{ marginTop: 16, borderLeft: '3px solid #4ea8ff' }}>
                  <div className="flex gap-8" style={{ alignItems: 'center', marginBottom: 10 }}>
                    <span style={{ fontFamily: 'var(--font-display)', fontStretch: '87%', fontWeight: 800, fontSize: 11, letterSpacing: '.12em', textTransform: 'uppercase', color: '#4ea8ff' }}>
                      Coverage Matchup
                    </span>
                    {coverageSplits?.seasonsIncluded && (
                      <span style={{ marginLeft: 'auto', fontSize: 9, fontFamily: 'var(--font-mono)', color: 'var(--text-faint)' }}>
                        {coverageSplits.seasonsIncluded} seasons
                      </span>
                    )}
                  </div>

                  {coverageSplits?.manZone.length > 0 && (
                    <div style={{ display: 'flex', gap: 16, marginBottom: 12 }}>
                      {coverageSplits.manZone.map(mz => (
                        <div key={mz.split_value} style={{ flex: 1 }}>
                          <div style={{ fontSize: 9, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '.05em' }}>
                            {mz.split_value === 'MAN_COVERAGE' ? 'vs Man' : 'vs Zone'} ({mz.targets} tgt)
                          </div>
                          <div style={{ display: 'flex', gap: 10, alignItems: 'baseline' }}>
                            <span style={{ fontSize: 16, fontWeight: 900, fontFamily: 'var(--font-mono)', color: mz.avg_epa > 0 ? '#4caf82' : '#ff8080' }}>{mz.yds_per_target.toFixed(1)}</span>
                            <span style={{ fontSize: 9, color: 'var(--text-faint)' }}>Y/T</span>
                            <span style={{ fontSize: 12, fontFamily: 'var(--font-mono)', color: 'var(--text-dim)' }}>{mz.catch_rate_pct.toFixed(0)}% catch</span>
                          </div>
                          <div style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: mz.avg_epa > 0 ? '#4caf82' : '#ff8080' }}>
                            {mz.avg_epa != null ? `${mz.avg_epa > 0 ? '+' : ''}${mz.avg_epa.toFixed(2)} EPA/tgt` : ''}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {coverageSplits?.byScheme.length > 0 && (
                    <div style={{ overflowX: 'auto', marginBottom: 10 }}>
                      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
                        <thead>
                          <tr style={{ borderBottom: '1px solid var(--border)' }}>
                            {['Scheme', 'Tgt', 'Catch%', 'Y/T', 'EPA/tgt'].map(h => (
                              <th key={h} style={{ textAlign: h === 'Scheme' ? 'left' : 'right', padding: '3px 8px', fontSize: 9, color: 'var(--text-faint)', textTransform: 'uppercase' }}>{h}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {coverageSplits.byScheme.map(s => {
                            const oppPct = opponentTendency?.byScheme.find(o => o.split_value === s.split_value)?.pct_of_pass_plays;
                            return (
                              <tr key={s.split_value} style={{ borderBottom: '1px solid var(--border)' }}>
                                <td style={{ padding: '3px 8px', fontWeight: 600 }}>
                                  {formatCoverageScheme(s.split_value)}
                                  {oppPct != null && (
                                    <span style={{ marginLeft: 6, fontSize: 9, fontFamily: 'var(--font-mono)', color: '#4ea8ff' }} title={`${player.opp?.replace('@', '') || 'Opponent'} runs this ${oppPct.toFixed(0)}% of the time`}>
                                      opp {oppPct.toFixed(0)}%
                                    </span>
                                  )}
                                </td>
                                <td style={{ padding: '3px 8px', textAlign: 'right', fontFamily: 'var(--font-mono)', color: 'var(--text-faint)' }}>{s.targets}</td>
                                <td style={{ padding: '3px 8px', textAlign: 'right', fontFamily: 'var(--font-mono)' }}>{s.catch_rate_pct.toFixed(0)}%</td>
                                <td style={{ padding: '3px 8px', textAlign: 'right', fontFamily: 'var(--font-mono)', fontWeight: 700 }}>{s.yds_per_target.toFixed(1)}</td>
                                <td style={{ padding: '3px 8px', textAlign: 'right', fontFamily: 'var(--font-mono)', color: s.avg_epa > 0 ? '#4caf82' : s.avg_epa < 0 ? '#ff8080' : 'var(--text-dim)' }}>
                                  {s.avg_epa != null ? `${s.avg_epa > 0 ? '+' : ''}${s.avg_epa.toFixed(2)}` : '—'}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}

                  {(opponentTendency?.manZone.length > 0 || opponentTendency?.byScheme.length > 0) && (
                    <div style={{ marginTop: 14, paddingTop: 12, borderTop: '1px solid var(--border)' }}>
                      <div style={{ fontSize: 9, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 8 }}>
                        {player.opp?.replace('@', '') || 'Opponent'}'s Coverage Tendency
                      </div>

                      {opponentTendency.manZone.length > 0 && (
                        <div style={{ marginBottom: 12 }}>
                          <div style={{ display: 'flex', height: 8, borderRadius: 4, overflow: 'hidden', marginBottom: 6 }}>
                            {opponentTendency.manZone.map(mz => (
                              <div
                                key={mz.split_value}
                                style={{ width: `${mz.pct_of_pass_plays}%`, background: mz.split_value === 'MAN_COVERAGE' ? '#4ea8ff' : '#f59e0b' }}
                                title={`${mz.split_value === 'MAN_COVERAGE' ? 'Man' : 'Zone'} ${mz.pct_of_pass_plays.toFixed(0)}%`}
                              />
                            ))}
                          </div>
                          <div style={{ display: 'flex', gap: 16 }}>
                            {opponentTendency.manZone.map(mz => (
                              <span key={mz.split_value} style={{ fontSize: 11, color: 'var(--text-dim)' }}>
                                <span style={{ color: mz.split_value === 'MAN_COVERAGE' ? '#4ea8ff' : '#f59e0b', fontWeight: 700, fontFamily: 'var(--font-mono)' }}>
                                  {mz.pct_of_pass_plays.toFixed(0)}%
                                </span> {mz.split_value === 'MAN_COVERAGE' ? 'Man' : 'Zone'}
                              </span>
                            ))}
                          </div>
                        </div>
                      )}

                      {opponentTendency.byScheme.length > 0 && (
                        <div style={{ overflowX: 'auto' }}>
                          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
                            <thead>
                              <tr style={{ borderBottom: '1px solid var(--border)' }}>
                                <th style={{ textAlign: 'left', padding: '3px 8px', fontSize: 9, color: 'var(--text-faint)', textTransform: 'uppercase' }}>Scheme</th>
                                <th style={{ textAlign: 'right', padding: '3px 8px', fontSize: 9, color: 'var(--text-faint)', textTransform: 'uppercase' }}>% of Pass Plays</th>
                              </tr>
                            </thead>
                            <tbody>
                              {opponentTendency.byScheme.map(s => (
                                <tr key={s.split_value} style={{ borderBottom: '1px solid var(--border)' }}>
                                  <td style={{ padding: '3px 8px', fontWeight: 600 }}>{formatCoverageScheme(s.split_value)}</td>
                                  <td style={{ padding: '3px 8px', textAlign: 'right', fontFamily: 'var(--font-mono)', fontWeight: 700, color: '#4ea8ff' }}>{s.pct_of_pass_plays.toFixed(0)}%</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>
                  )}
                  <div style={{ marginTop: 10, fontSize: 10, color: 'var(--text-faint)' }}>
                    From real nflverse play-by-play coverage charting — targets/catch rate/yards per target/EPA against each scheme this player has actually faced, and how often {player.opp?.replace('@', '') || 'the opponent'} actually runs each scheme on defense. No CB-specific or route-alignment data exists publicly, so this is scheme-level only, not "vs this specific cornerback." Small target/play counts are noisier — weight accordingly.
                  </div>
                </div>
              )}

              {/* Rush Box Matchup — RB-specific: real box-count splits from nflverse PBP charting */}
              {player.pos === 'RB' && (rushBoxSplits || opponentRushTendency) && (
                <div className="muted-card" style={{ marginTop: 16, borderLeft: '3px solid #4caf82' }}>
                  <div className="flex gap-8" style={{ alignItems: 'center', marginBottom: 10 }}>
                    <span style={{ fontFamily: 'var(--font-display)', fontStretch: '87%', fontWeight: 800, fontSize: 11, letterSpacing: '.12em', textTransform: 'uppercase', color: '#4caf82' }}>
                      Rush Box Matchup
                    </span>
                    {rushBoxSplits?.seasonsIncluded && (
                      <span style={{ marginLeft: 'auto', fontSize: 9, fontFamily: 'var(--font-mono)', color: 'var(--text-faint)' }}>
                        {rushBoxSplits.seasonsIncluded} seasons
                      </span>
                    )}
                  </div>

                  {rushBoxSplits?.boxGroup.length > 0 && (
                    <div style={{ display: 'flex', gap: 16, marginBottom: 12 }}>
                      {rushBoxSplits.boxGroup.map(bg => (
                        <div key={bg.split_value} style={{ flex: 1 }}>
                          <div style={{ fontSize: 9, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '.05em' }}>
                            {bg.split_value === 'LIGHT_BOX' ? 'vs Light Box (≤6)' : bg.split_value === 'STANDARD_BOX' ? 'vs Standard (7)' : 'vs Stacked (8+)'} ({bg.attempts} att)
                          </div>
                          <div style={{ display: 'flex', gap: 10, alignItems: 'baseline' }}>
                            <span style={{ fontSize: 16, fontWeight: 900, fontFamily: 'var(--font-mono)', color: bg.avg_epa > 0 ? '#4caf82' : '#ff8080' }}>{bg.yards_per_carry.toFixed(1)}</span>
                            <span style={{ fontSize: 9, color: 'var(--text-faint)' }}>YPC</span>
                            <span style={{ fontSize: 12, fontFamily: 'var(--font-mono)', color: 'var(--text-dim)' }}>{bg.tds} TD</span>
                          </div>
                          <div style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: bg.avg_epa > 0 ? '#4caf82' : '#ff8080' }}>
                            {bg.avg_epa != null ? `${bg.avg_epa > 0 ? '+' : ''}${bg.avg_epa.toFixed(2)} EPA/rush` : ''}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {rushBoxSplits?.byCount.length > 0 && (
                    <div style={{ overflowX: 'auto', marginBottom: 10 }}>
                      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
                        <thead>
                          <tr style={{ borderBottom: '1px solid var(--border)' }}>
                            {['Box Count', 'Att', 'YPC', 'EPA/rush'].map(h => (
                              <th key={h} style={{ textAlign: h === 'Box Count' ? 'left' : 'right', padding: '3px 8px', fontSize: 9, color: 'var(--text-faint)', textTransform: 'uppercase' }}>{h}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {rushBoxSplits.byCount.map(s => {
                            const oppPct = opponentRushTendency?.byCount.find(o => o.split_value === s.split_value)?.pct_of_rush_plays;
                            return (
                              <tr key={s.split_value} style={{ borderBottom: '1px solid var(--border)' }}>
                                <td style={{ padding: '3px 8px', fontWeight: 600 }}>
                                  {s.split_value} in the box
                                  {oppPct != null && (
                                    <span style={{ marginLeft: 6, fontSize: 9, fontFamily: 'var(--font-mono)', color: '#4caf82' }} title={`${player.opp?.replace('@', '') || 'Opponent'} loads this box ${oppPct.toFixed(0)}% of the time`}>
                                      opp {oppPct.toFixed(0)}%
                                    </span>
                                  )}
                                </td>
                                <td style={{ padding: '3px 8px', textAlign: 'right', fontFamily: 'var(--font-mono)', color: 'var(--text-faint)' }}>{s.attempts}</td>
                                <td style={{ padding: '3px 8px', textAlign: 'right', fontFamily: 'var(--font-mono)', fontWeight: 700 }}>{s.yards_per_carry.toFixed(1)}</td>
                                <td style={{ padding: '3px 8px', textAlign: 'right', fontFamily: 'var(--font-mono)', color: s.avg_epa > 0 ? '#4caf82' : s.avg_epa < 0 ? '#ff8080' : 'var(--text-dim)' }}>
                                  {s.avg_epa != null ? `${s.avg_epa > 0 ? '+' : ''}${s.avg_epa.toFixed(2)}` : '—'}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}

                  {(opponentRushTendency?.boxGroup.length > 0 || opponentRushTendency?.byCount.length > 0) && (
                    <div style={{ marginTop: 14, paddingTop: 12, borderTop: '1px solid var(--border)' }}>
                      <div style={{ fontSize: 9, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 8 }}>
                        {player.opp?.replace('@', '') || 'Opponent'}'s Box-Count Tendency
                      </div>

                      {opponentRushTendency.boxGroup.length > 0 && (
                        <div style={{ marginBottom: 12 }}>
                          <div style={{ display: 'flex', height: 8, borderRadius: 4, overflow: 'hidden', marginBottom: 6 }}>
                            {opponentRushTendency.boxGroup.map(bg => (
                              <div
                                key={bg.split_value}
                                style={{ width: `${bg.pct_of_rush_plays}%`, background: bg.split_value === 'LIGHT_BOX' ? '#4caf82' : bg.split_value === 'STANDARD_BOX' ? '#f59e0b' : '#ff5a6e' }}
                                title={`${bg.split_value.replace('_BOX', '')} ${bg.pct_of_rush_plays.toFixed(0)}%`}
                              />
                            ))}
                          </div>
                          <div style={{ display: 'flex', gap: 16 }}>
                            {opponentRushTendency.boxGroup.map(bg => (
                              <span key={bg.split_value} style={{ fontSize: 11, color: 'var(--text-dim)' }}>
                                <span style={{ color: bg.split_value === 'LIGHT_BOX' ? '#4caf82' : bg.split_value === 'STANDARD_BOX' ? '#f59e0b' : '#ff5a6e', fontWeight: 700, fontFamily: 'var(--font-mono)' }}>
                                  {bg.pct_of_rush_plays.toFixed(0)}%
                                </span> {bg.split_value === 'LIGHT_BOX' ? 'Light' : bg.split_value === 'STANDARD_BOX' ? 'Standard' : 'Stacked'}
                              </span>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                  <div style={{ marginTop: 10, fontSize: 10, color: 'var(--text-faint)' }}>
                    From real nflverse play-by-play — rushing yards/EPA against each box count this player has actually faced, and how often {player.opp?.replace('@', '') || 'the opponent'} actually loads the box on defense. No blocking scheme or gap-assignment data exists publicly, so this is box-count only. Small attempt counts are noisier — weight accordingly.
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ── Lineage — ownership history ── */}
          {activeTab === 'lineage' && (
            <div>
              {lineageLoading ? (
                <div className="dim" style={{ fontSize: 12, padding: '20px 0', textAlign: 'center' }}>Loading ownership history…</div>
              ) : lineage.length === 0 ? (
                <div className="dim" style={{ fontSize: 12, padding: '20px 0', textAlign: 'center' }}>
                  No ownership history found for {player.name} — they may be a free agent, or moves predate this league's tracked history.
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column' }}>
                  {lineage.map((ev, i) => (
                    <div key={i} style={{ display: 'flex', gap: 12, paddingBottom: i < lineage.length - 1 ? 16 : 0, position: 'relative' }}>
                      {/* Timeline rail */}
                      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flexShrink: 0 }}>
                        <div style={{
                          width: 26, height: 26, borderRadius: '50%', flexShrink: 0,
                          background: `${ev.color}18`, border: `1px solid ${ev.color}55`,
                          display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12,
                        }}>
                          {ev.icon}
                        </div>
                        {i < lineage.length - 1 && (
                          <div style={{ width: 1, flex: 1, background: 'var(--border)', marginTop: 4 }} />
                        )}
                      </div>
                      <div style={{ paddingTop: 3 }}>
                        <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>{ev.label}</div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 2 }}>
                          {ev.ts && (
                            <span style={{ fontSize: 11, color: 'var(--text-faint)', fontFamily: 'var(--font-mono)' }}>
                              {new Date(ev.ts).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}
                            </span>
                          )}
                          {ev.sub && (
                            <span style={{ fontSize: 11, color: ev.color, fontFamily: 'var(--font-mono)' }}>{ev.sub}</span>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

        </div>
      </div>
    </React.Fragment>
  );
}
