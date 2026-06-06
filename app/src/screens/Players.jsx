import React from 'react';
import WatchlistScreen from './Watchlist.jsx';
import { MY_ROSTER, TEAM_ROSTERS, TEAMS_ORDER, findTeam, NFL_TEAMS, NEWS, SOURCE_META, FREE_DATA_SOURCES, RANKING_SOURCES, GAME_WEATHER, buildRosterFrame, assignRoster, ROSTER_CONFIG, refreshTeamRosters } from '../lib/data.js';
import { usePlayers, isLiveData, findPlayer } from '../lib/playerStore.js';
import { PosBadge, StatusDot, PlayerAvatar, PlayerCell, Sparkline, ProjBar, Delta, AIHint, SourceBadge, TeamLogoBadge } from '../components/ui.jsx';
import { useApi, useR2BreakoutCandidates, useR2Injuries, useR2PlayerNotes } from '../hooks.js';
import { fetchSleeperPlayerStats, getPlayerMap, fetchBulkWeekStats, getTrending } from '../lib/sleeper.js';

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
    fetch(`${API_BASE}/api/v1/nfl/schedule?week=${week}&season=2026`)
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (!data?.games?.length) return;
        const m = new Map();
        for (const g of data.games) {
          const home = normalizeTeamAbbr(g.home?.abbr);
          const away = normalizeTeamAbbr(g.away?.abbr);
          if (home && away) {
            m.set(home, `@${away}`);
            m.set(away, home);
          }
        }
        setMap(m);
      })
      .catch(() => {});
  }, []);
  return map;
}

function loadScoringWeights() {
  try {
    const raw = localStorage.getItem('fantasai_scoring_weights');
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
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

function WeatherBadge({ opp }) {
  const w = GAME_WEATHER[opp];
  if (!w) return null;
  if (w.cond === 'Dome') return <div style={{ fontSize: 10, color: 'var(--text-faint)', marginTop: 2 }}>🏟️ Dome</div>;
  const isAlert = w.wind >= 15 || w.temp <= 32;
  return (
    <div style={{ fontSize: 10, marginTop: 2, color: isAlert ? 'var(--warn)' : 'var(--text-faint)' }}>
      {w.icon} {w.temp}°F{w.wind > 0 ? ` · ${w.wind}mph` : ''}
    </div>
  );
}

// ── Column config ─────────────────────────────────────────────────────────────
const DEFAULT_COLUMNS = [
  { id: 'proj',      label: 'Proj',    visible: true,  sortKey: 'proj' },
  { id: 'last',      label: 'Last',    visible: true,  sortKey: 'last' },
  { id: 'avg',       label: 'Avg',     visible: true,  sortKey: 'avg' },
  { id: 'trend',     label: 'Trend',   visible: true,  sortKey: null },
  { id: 'opp_score', label: 'Opp Sc',  visible: true,  sortKey: 'oppScore' },
  { id: 'bye',       label: 'Bye',     visible: true,  sortKey: 'bye' },
  { id: 'owned',     label: '%Own',    visible: true,  sortKey: 'owned' },
  { id: 'adp',       label: 'ADP',     visible: true,  sortKey: 'adp' },
  { id: 'depth',     label: 'Depth',   visible: true,  sortKey: null },
  { id: 'snaps',     label: 'Snaps/G', visible: true,  sortKey: null },
  { id: 'tgt',       label: 'Tgt%',    visible: false, sortKey: 'targetShare' },
  { id: 'routes',    label: 'Routes',  visible: false, sortKey: 'routes' },
  { id: 'yac',       label: 'YAC',     visible: false, sortKey: 'yac' },
  { id: 'weather',   label: 'Weather', visible: false, sortKey: null },
  { id: 'status',    label: 'Status',  visible: true,  sortKey: null },
];

function loadColumns() {
  try {
    const saved = JSON.parse(localStorage.getItem('fantasai_columns') || 'null');
    if (!Array.isArray(saved)) return DEFAULT_COLUMNS.map(c => ({ ...c }));
    const savedIds = new Set(saved.map(c => c.id));
    const merged = [
      ...saved.map(c => { const def = DEFAULT_COLUMNS.find(d => d.id === c.id); return def ? { ...def, visible: c.visible } : null; }).filter(Boolean),
      ...DEFAULT_COLUMNS.filter(c => !savedIds.has(c.id)),
    ];
    return merged;
  } catch { return DEFAULT_COLUMNS.map(c => ({ ...c })); }
}

export default function PlayersScreen({ onOpenPlayer, aiMode, myRosterIds = new Set(), onAddPlayer, onDropPlayer, onClaimPlayer, onTradePlayer, user, watchlistIds = new Set(), onToggleWatch, waiverQueue = {}, playersTab = 'players', onPlayersTabChange }) {
  const _addFilter = (() => { try { const f = localStorage.getItem('fantasai_add_filter'); if (f) { localStorage.removeItem('fantasai_add_filter'); return f; } } catch {} return null; })();
  const [pos, setPos] = React.useState(_addFilter ?? 'ALL');
  const [search, setSearch] = React.useState('');
  const [sort, setSort] = React.useState('adp');
  const [avail, setAvail] = React.useState(_addFilter ? 'available' : 'all');
  const [useSleeperSort, setUseSleeperSort] = React.useState(false);
  const [breakoutOnly, setBreakoutOnly] = React.useState(false);

  // ── Custom Rankings (sort dropdown) ─────────────────────────────────────────
  const [customRankings, setCustomRankings] = React.useState(() => {
    try { return JSON.parse(localStorage.getItem('fantasai_custom_rankings') || '[]'); } catch { return []; }
  });
  const [activeRankingId, setActiveRankingId] = React.useState(null);

  // ── Column customization ──────────────────────────────────────────────────
  const [columns, setColumns] = React.useState(loadColumns);
  const [showColPicker, setShowColPicker] = React.useState(false);

  // ── Waiver claim state ────────────────────────────────────────────────────
  const draftDone = React.useMemo(() => isDraftComplete(), []);
  const [waiverOrder, setWaiverOrder] = React.useState(loadWaiverOrder);
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

  const { data: r2Breakouts } = useR2BreakoutCandidates();
  const breakoutSet = React.useMemo(() => {
    const s = new Map(); // player_name (lower) → { snap_share_delta, opportunity_score }
    const arr = Array.isArray(r2Breakouts) ? r2Breakouts : [];
    for (const b of arr) {
      if (b.player_name) s.set(b.player_name.toLowerCase().trim(), b);
    }
    return s;
  }, [r2Breakouts]);

  // Global player store — seeds from static data, replaced with live Databricks/Sleeper on startup
  const apiPlayerList = usePlayers();

  // R2 injury overlay — real status + depth chart from Databricks silver_player_news
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
    if (!r2InjuryData && !r2Notes) return apiPlayerList;
    return apiPlayerList.map(p => {
      const r2 = r2InjuryIndex.byName[p.name.toLowerCase().trim()]
               || (p.sleeperId ? r2InjuryIndex.byId[String(p.sleeperId)] : null);
      const note = r2NotesIndex[p.name.toLowerCase().trim()];
      const injSt = r2?.injury_status;
      const updates = {};
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
      if (note?.notes?.length) {
        const topNote = note.notes[0];
        updates.news = topNote.note_text ? topNote.note_text.slice(0, 100) : p.news;
        updates.hasCriticalNews   = note.has_critical_news   || false;
        updates.hasInjuryConcern  = note.has_injury_concern  || false;
        updates.overallImpact     = note.overall_impact_score ?? null;
      }
      return Object.keys(updates).length ? { ...p, ...updates } : p;
    });
  }, [apiPlayerList, r2InjuryData, r2Notes, r2InjuryIndex, r2NotesIndex]);

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
            stats[name] = { last: lastVal, avg: avgVal, trend: trendPts, bye: p.bye_week ?? 0 };
          } else if (p.bye_week) {
            stats[name] = { last: null, avg: null, trend: [], bye: p.bye_week };
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
        last:  p.last  > 0 ? p.last  : (sl.last  ?? 0),
        avg:   p.avg   > 0 ? p.avg   : (sl.avg   ?? 0),
        trend: p.trend?.length > 0 ? p.trend : (sl.trend ?? []),
        bye:   p.bye   > 0 ? p.bye   : (sl.bye   ?? 0),
      };
    });
  }, [allPlayersList, sleeperStats]);

  let players = allPlayersList2.filter(p => {
    if (pos === 'FLEX' && !['RB', 'WR'].includes(p.pos)) return false;
    if (pos !== 'ALL' && pos !== 'FLEX' && p.pos !== pos) return false;
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
      if (sort === 'adp')         return a.adp - b.adp;
      if (sort === 'rank')        return a.ecr - b.ecr;
      if (sort === 'targetShare') return b.targetShare - a.targetShare;
      if (sort === 'routes')      return b.routes - a.routes;
      if (sort === 'yac')         return b.yac - a.yac;
      if (sort === 'name')        return a.name.localeCompare(b.name);
      if (sort === 'oppScore') {
        const as = breakoutSet.get(a.name.toLowerCase().trim())?.opportunity_score ?? -1;
        const bs = breakoutSet.get(b.name.toLowerCase().trim())?.opportunity_score ?? -1;
        return bs - as;
      }
      return 0;
    });
  }

  // ── Custom ranking helpers ───────────────────────────────────────────────────
  function saveCustomRanking(ranking) {
    const updated = [...customRankings.filter(r => r.id !== ranking.id), ranking];
    setCustomRankings(updated);
    localStorage.setItem('fantasai_custom_rankings', JSON.stringify(updated));
    setActiveRankingId(ranking.id);
    setSort('custom');
  }

  function deleteCustomRanking(id) {
    const updated = customRankings.filter(r => r.id !== id);
    setCustomRankings(updated);
    localStorage.setItem('fantasai_custom_rankings', JSON.stringify(updated));
    if (activeRankingId === id) { setActiveRankingId(null); setSort('proj'); }
  }

  // ── Column helpers ────────────────────────────────────────────────────────
  function saveColumns(cols) {
    setColumns(cols);
    localStorage.setItem('fantasai_columns', JSON.stringify(cols));
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
  const visibleCols = columns.filter(c => c.visible);

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
          {user && <TeamLogoBadge team={user.teamId ? findTeam(user.teamId) : null} size={40} />}
          <div>
            <h1>Players</h1>
            <div className="sub">
              {`${players.length} of ${allPlayersList.length} · `}
              {isLiveData() ? '2026 Players' : 'Static seed'}
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <button className="btn ghost"><span>⇣</span> Export</button>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: 11, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '.1em' }}>
              {draftDone ? 'Waiver Priority' : 'Mode'}
            </div>
            <div style={{ fontFamily: 'var(--font-display)', fontWeight: 900, fontStretch: '75%', fontSize: 22, lineHeight: 1, color: draftDone ? 'var(--accent)' : 'var(--text-dim)' }}>
              {draftDone ? `#${myWaiverPriority}` : 'Pre-Draft'}
            </div>
          </div>
        </div>
      </div>

      {/* ── Tab strip ── */}
      <div className="tabs" style={{ padding: '0 18px', flexShrink: 0, borderBottom: '1px solid var(--border)', background: 'var(--bg-2)' }}>
        <div className={`tab ${playersTab === 'players' ? 'active' : ''}`} onClick={() => onPlayersTabChange?.('players')}>Players</div>
        <div className={`tab ${playersTab === 'watchlist' ? 'active' : ''}`} onClick={() => onPlayersTabChange?.('watchlist')}>★ Watchlist {watchlistIds.size > 0 && <span style={{ marginLeft: 4, fontSize: 9, background: 'rgba(198,255,58,.2)', color: 'var(--accent)', borderRadius: 3, padding: '1px 5px', fontFamily: 'var(--font-mono)', fontWeight: 700 }}>{watchlistIds.size}</span>}</div>
      </div>

      {/* ── Watchlist tab ── */}
      {playersTab === 'watchlist' && (
        <div style={{ flex: 1, overflow: 'auto' }}>
          <WatchlistScreen asTab onOpenPlayer={onOpenPlayer} watchlistIds={watchlistIds} onToggleWatch={onToggleWatch} />
        </div>
      )}

      {/* ── Players tab content ── */}
      {playersTab === 'players' && <>

      {/* ── Waiver position banner ── */}
      {draftDone && (
        <div style={{ margin: '10px 18px 0', padding: '10px 16px', borderRadius: 10, background: 'rgba(198,255,58,.07)', border: '2px solid rgba(198,255,58,.35)', display: 'flex', alignItems: 'center', gap: 14 }}>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', width: 48, height: 48, borderRadius: 10, background: 'rgba(198,255,58,.15)', border: '1px solid rgba(198,255,58,.4)', flexShrink: 0 }}>
            <span style={{ fontSize: 22, fontWeight: 900, color: 'var(--accent)', lineHeight: 1, fontFamily: 'var(--font-mono)' }}>{myWaiverPriority}</span>
            <span style={{ fontSize: 8, color: 'var(--accent)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.08em' }}>of {waiverOrder.length}</span>
          </div>
          <div>
            <div style={{ fontSize: 13, fontWeight: 800, color: 'var(--text)' }}>
              Your Waiver Priority: #{myWaiverPriority}
              {myWaiverPriority === 1 && <span style={{ marginLeft: 8, fontSize: 10, background: 'rgba(198,255,58,.2)', color: 'var(--accent)', borderRadius: 4, padding: '2px 6px', fontWeight: 700 }}>FIRST PICK</span>}
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 2 }}>
              Next waiver run: <span style={{ color: 'var(--text)', fontWeight: 600 }}>{fmtWaiverDate(nextWaiverDate(processDay))}</span>
            </div>
          </div>
        </div>
      )}

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
          {['ALL', 'QB', 'RB', 'WR', 'TE', 'FLEX', 'K', 'DST'].map(p => (
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
            border: `1px solid ${breakoutOnly ? 'rgba(198,255,58,.6)' : 'var(--border)'}`,
            background: breakoutOnly ? 'rgba(198,255,58,.12)' : 'transparent',
            color: breakoutOnly ? '#c6ff3a' : breakoutSet.size === 0 ? 'var(--text-faint)' : 'var(--text-dim)',
            display: 'flex', alignItems: 'center', gap: 5, flexShrink: 0,
            transition: 'all .15s',
            opacity: breakoutSet.size === 0 ? 0.5 : 1,
          }}
          title={breakoutSet.size === 0 ? 'No breakout data yet — run the Databricks export job' : `${breakoutSet.size} breakout candidate${breakoutSet.size !== 1 ? 's' : ''} identified by FantasAI ML`}
        >
          <span style={{ fontSize: 13 }}>↑</span>
          Breakout
          {breakoutOnly && <span style={{ fontSize: 10, fontFamily: 'var(--font-mono)', opacity: 0.8 }}>ON</span>}
          {breakoutSet.size > 0 && !breakoutOnly && <span style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: '#c6ff3a', opacity: 0.8 }}>{breakoutSet.size}</span>}
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
        <button
          className="btn ghost"
          style={{ fontSize: 11, padding: '4px 10px', flexShrink: 0 }}
          onClick={() => setShowColPicker(p => !p)}
          title="Customize visible columns"
        >⚙ Columns</button>
        <span style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--text-faint)', whiteSpace: 'nowrap' }}>
          {isLiveData() ? '◆ 2026 Players' : '○ Static'} · {allPlayersList.length}
          {r2InjuryData ? ' · R2 injuries' : ''}
        </span>
        <span className="faint mono" style={{ fontSize: 11 }}>HALF PPR</span>
      </div>

      <div style={{ flex: 1, overflow: 'auto' }}>
        <table className="data-table">
          <thead>
            <tr>
              <th className={`num${sort === 'rank' ? ' sorted' : ''}`} style={{ cursor: 'pointer' }} onClick={() => { setSort('rank'); setUseSleeperSort(false); }}>#</th>
              <th className={sort === 'name' ? 'sorted' : ''} style={{ cursor: 'pointer' }} onClick={() => { setSort('name'); setUseSleeperSort(false); }}>Player</th>
              <th>Opp</th>
              {useSleeperSort && <th className="num sorted" style={{ color: 'var(--accent)' }}>Score</th>}
              {visibleCols.map(col => {
                const isSorted = !useSleeperSort && sort === col.sortKey;
                return (
                  <th key={col.id}
                    className={`num${isSorted ? ' sorted' : ''}`}
                    style={{ cursor: col.sortKey ? 'pointer' : 'default' }}
                    onClick={col.sortKey ? () => { setSort(col.sortKey); setUseSleeperSort(false); } : undefined}
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
                  style={isOnWaivers ? { background: 'rgba(255,149,0,.04)' } : undefined}>
                  <td className="rank">{i + 1}</td>
                  <td onClick={(e) => { e.stopPropagation(); onOpenPlayer(p.id); }} style={{ cursor: 'pointer' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <PlayerCell player={p} watched={watchlistIds.has(p.id)} />
                      {ownerTeam && (
                        <span title={`On ${ownerTeam.name}'s roster`} style={{
                          display: 'inline-flex', alignItems: 'center', gap: 4,
                          flexShrink: 0, fontSize: 9, fontWeight: 700, fontFamily: 'var(--font-mono)',
                          padding: '1px 6px', borderRadius: 3, letterSpacing: '.03em',
                          background: isOnMyRoster ? 'rgba(198,255,58,.13)' : 'rgba(255,255,255,.07)',
                          color: isOnMyRoster ? 'var(--accent)' : 'var(--text-dim)',
                          border: isOnMyRoster ? '1px solid rgba(198,255,58,.3)' : '1px solid rgba(255,255,255,.1)',
                          whiteSpace: 'nowrap', maxWidth: 110, overflow: 'hidden', textOverflow: 'ellipsis',
                        }}>
                          <span style={{ width: 6, height: 6, borderRadius: '50%', background: ownerTeam.color || (isOnMyRoster ? 'var(--accent)' : '#666'), flexShrink: 0, display: 'inline-block' }} />
                          {isOnMyRoster ? 'My Team' : ownerTeam.name}
                        </span>
                      )}
                    </div>
                  </td>
                  <td>
                    {(() => {
                      const displayOpp = p.opp || scheduleOppMap.get(p.team) || '';
                      const wk = getNflScheduleWeek();
                      const label = displayOpp
                        ? <span className="mono dim" style={{ fontSize: 11 }}>vs {displayOpp}</span>
                        : <span className="mono faint" style={{ fontSize: 10 }}>—</span>;
                      return (
                        <>
                          {label}
                          {displayOpp && <div className="mono faint" style={{ fontSize: 9 }}>Wk {wk}</div>}
                          {p.oppRank > 0 && <div className="mono faint" style={{ fontSize: 10 }}>D #{p.oppRank}</div>}
                        </>
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
                  {visibleCols.map(col => {
                    const isRecvr = p.pos === 'WR' || p.pos === 'TE' || p.pos === 'RB';
                    if (col.id === 'proj') {
                      const projVal = p.proj > 0 ? p.proj : null;
                      return (
                        <td key="proj" className="num">
                          {projVal != null
                            ? <><span style={{ fontWeight: 600 }}>{projVal.toFixed(1)}</span><ProjBar value={projVal} /></>
                            : <span className="faint" style={{ fontSize: 10 }}>—</span>}
                        </td>
                      );
                    }
                    if (col.id === 'last') {
                      const v = p.last > 0 ? p.last : null;
                      return <td key="last" className="num">{v != null ? v.toFixed(1) : <span className="faint" style={{ fontSize: 10 }}>—</span>}</td>;
                    }
                    if (col.id === 'avg') {
                      const v = p.avg > 0 ? p.avg : null;
                      return <td key="avg" className="num">{v != null ? v.toFixed(1) : <span className="faint" style={{ fontSize: 10 }}>—</span>}</td>;
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
                            ? <span style={{ fontWeight: 600, color: 'var(--accent-2)', fontFamily: 'var(--font-mono)', fontSize: 11 }}>{oppVal.toFixed(1)}</span>
                            : <span className="faint" style={{ fontSize: 10 }}>—</span>}
                        </td>
                      );
                    }
                    if (col.id === 'bye')     return <td key="bye" className="num">{p.bye > 0 ? p.bye : <span className="faint">—</span>}</td>;
                    if (col.id === 'owned')   return <td key="owned" className="num">{p.owned.toFixed(1)}%</td>;
                    if (col.id === 'adp')     return <td key="adp" className="num faint">{p.adp.toFixed(1)}</td>;
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
                    if (col.id === 'weather') return <td key="weather"><WeatherBadge opp={p.opp} /></td>;
                    if (col.id === 'status')  return (
                      <td key="status">
                        {isOnWaivers ? (
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 10, fontWeight: 700, fontFamily: 'var(--font-mono)', color: '#ff9500', background: 'rgba(255,149,0,.12)', border: '1px solid rgba(255,149,0,.35)', borderRadius: 4, padding: '2px 7px', whiteSpace: 'nowrap' }}>
                            ⏳ Waivers
                          </span>
                        ) : p.status !== 'OK' ? (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                            <span className="status-pill"><StatusDot status={p.status} /> {p.status}</span>
                            {injNotes && <span style={{ fontSize: 10, color: 'var(--text-faint)', lineHeight: 1.4, maxWidth: 160 }}>{injNotes}</span>}
                          </div>
                        ) : null}
                        {breakoutData && (
                          <div title={`Snap Δ +${((breakoutData.snap_share_delta || 0) * 100).toFixed(0)}% · Opp Score ${(breakoutData.opportunity_score || 0).toFixed(1)}`}>
                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: 9, fontWeight: 800, fontFamily: 'var(--font-mono)', color: 'var(--accent-2)', background: 'rgba(78,168,255,.12)', border: '1px solid rgba(78,168,255,.4)', borderRadius: 4, padding: '2px 6px', letterSpacing: '.04em' }}>↑ BREAKOUT</span>
                          </div>
                        )}
                        {aiPick && <div><AIHint>{aiPick}</AIHint></div>}
                      </td>
                    );
                    return null;
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

    {/* ── Column Picker Modal ────────────────────────────────────────────── */}
    {showColPicker && (
      <div style={{ position: 'fixed', inset: 0, zIndex: 500, display: 'flex', alignItems: 'flex-start', justifyContent: 'flex-end', padding: '64px 16px 0' }}
        onClick={e => { if (e.target === e.currentTarget) setShowColPicker(false); }}>
        <div style={{ background: 'var(--panel)', border: '1px solid var(--border-strong)', borderRadius: 12, padding: 16, width: 240, boxShadow: '0 12px 40px rgba(0,0,0,.5)' }}
          onClick={e => e.stopPropagation()}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
            <div style={{ fontWeight: 800, fontSize: 13 }}>⚙ Columns</div>
            <button style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 16, color: 'var(--text-faint)', lineHeight: 1 }} onClick={() => setShowColPicker(false)}>✕</button>
          </div>
          <div style={{ fontSize: 10, color: 'var(--text-faint)', marginBottom: 8 }}>Toggle, reorder with arrows</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            {columns.map((col, idx) => (
              <div key={col.id} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 6px', borderRadius: 6, background: col.visible ? 'rgba(255,255,255,.04)' : 'transparent' }}>
                <input type="checkbox" checked={col.visible} onChange={() => toggleColumn(col.id)}
                  style={{ accentColor: 'var(--accent)', cursor: 'pointer', flexShrink: 0 }} />
                <span style={{ flex: 1, fontSize: 12, color: col.visible ? 'var(--text)' : 'var(--text-faint)' }}>{col.label}</span>
                <button style={{ background: 'none', border: 'none', cursor: idx === 0 ? 'default' : 'pointer', opacity: idx === 0 ? 0.2 : 0.6, fontSize: 11, color: 'var(--text-dim)', padding: '0 2px', lineHeight: 1 }}
                  onClick={() => moveColumn(col.id, -1)} disabled={idx === 0}>▲</button>
                <button style={{ background: 'none', border: 'none', cursor: idx === columns.length - 1 ? 'default' : 'pointer', opacity: idx === columns.length - 1 ? 0.2 : 0.6, fontSize: 11, color: 'var(--text-dim)', padding: '0 2px', lineHeight: 1 }}
                  onClick={() => moveColumn(col.id, 1)} disabled={idx === columns.length - 1}>▼</button>
              </div>
            ))}
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
  if (pos === 'QB')  return ['Att','Cmp','Cmp%','Yds','TD','INT','Air Yds','Pts'];
  if (pos === 'RB')  return ['Att','Ru Yds','YPC','TD','Rec','Tgt','Re Yds','Snp','Pts'];
  if (pos === 'K')   return ['FGM','FGA','FG%','Long','XP','Pts'];
  if (pos === 'DST') return ['Sack','INT','FR','TD','PA','Pts'];
  return ['Snp','Tgt','Rec','Yds','Air Yds','YAC','TD','Pts'];  // WR / TE
}

function glRow(pos, s) {
  if (!s) return null;
  const pts = s.pts_half_ppr ?? s.pts_std;
  const pct = (a, b) => (a > 0 && b > 0) ? `${((a/b)*100).toFixed(0)}%` : '—';
  if (pos === 'QB')  return [fmtStat(s.pass_att), fmtStat(s.pass_cmp), pct(s.pass_cmp, s.pass_att), fmtStat(s.pass_yd), fmtStat(s.pass_td), fmtStat(s.pass_int), fmtStat(s.pass_air_yd || s.pass_cmp_air_yd), fmtStat(pts, 1)];
  if (pos === 'RB')  return [fmtStat(s.rush_att), fmtStat(s.rush_yd), (s.rush_att > 0 ? ((s.rush_yd||0)/(s.rush_att)).toFixed(1) : '—'), fmtStat((s.rush_td||0)+(s.rec_td||0)), fmtStat(s.rec), fmtStat(s.rec_tgt), fmtStat(s.rec_yd), fmtStat(s.off_snp), fmtStat(pts, 1)];
  if (pos === 'K')   return [fmtStat(s.fgm), fmtStat(s.fga), pct(s.fgm, s.fga), fmtStat(s.fg_lng), fmtStat(s.xpm), fmtStat(pts, 1)];
  if (pos === 'DST') return [fmtStat(s.sack), fmtStat(s.def_int), fmtStat(s.def_fr), fmtStat(s.def_td), fmtStat(s.pts_allow), fmtStat(pts, 1)];
  return [fmtStat(s.off_snp), fmtStat(s.rec_tgt), fmtStat(s.rec), fmtStat(s.rec_yd), fmtStat(s.rec_air_yd), fmtStat(s.rec_yac), fmtStat(s.rec_td), fmtStat(pts, 1)];
}

// Next Gen Stats — advanced metrics from season totals
function NextGenStatsPanel({ pos, tot, gp }) {
  if (!tot || !gp) return <div className="dim" style={{ fontSize: 12, padding: 8 }}>Next Gen Stats require live Sleeper data. Enable Sleeper API in Sources.</div>;

  const pct = (a, b) => (b > 0 ? `${((a/b)*100).toFixed(1)}%` : '—');
  const rate = (a, b) => (b > 0 ? (a/b).toFixed(2) : '—');
  const avg  = (a, b) => (b > 0 ? (a/b).toFixed(1) : '—');

  const StatRow = ({ label, value, desc, highlight }) => (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 0', borderBottom: '1px solid var(--border)' }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)' }}>{label}</div>
        {desc && <div style={{ fontSize: 10, color: 'var(--text-faint)', marginTop: 1 }}>{desc}</div>}
      </div>
      <div style={{ fontFamily: 'var(--font-mono)', fontWeight: 800, fontSize: 16, color: highlight ? 'var(--accent)' : 'var(--text)', flexShrink: 0 }}>{value}</div>
    </div>
  );

  const Section = ({ title, children }) => (
    <div className="card" style={{ marginBottom: 14 }}>
      <div className="card-head"><div className="card-title" style={{ fontSize: 11, letterSpacing: '.08em' }}>{title}</div></div>
      <div style={{ padding: '0 14px' }}>{children}</div>
    </div>
  );

  if (pos === 'QB') return (
    <>
      <Section title="PASSING — ADVANCED">
        <StatRow label="Attempts / Game"     value={avg(tot.pass_att, gp)}       desc="Volume indicator" />
        <StatRow label="Comp %" value={pct(tot.pass_cmp, tot.pass_att)} desc="Accuracy" highlight />
        <StatRow label="Yds / Attempt"       value={avg(tot.pass_yd, tot.pass_att)}  desc="Efficiency" />
        <StatRow label="Air Yards / Att"     value={avg(tot.pass_air_yd || tot.pass_cmp_air_yd, tot.pass_att)}  desc="Downfield aggressiveness" />
        <StatRow label="TD / INT Ratio"      value={tot.pass_int > 0 ? ((tot.pass_td||0)/(tot.pass_int)).toFixed(2) : '—'} desc="Ball security" highlight />
        <StatRow label="Rush Yds / Game"     value={avg(tot.rush_yd, gp)}         desc="Scramble ability" />
      </Section>
      <Section title="FANTASY PRODUCTION">
        <StatRow label="Pts / Game (Half PPR)" value={avg(tot.pts_half_ppr, gp)} highlight />
        <StatRow label="Season Total"          value={tot.pts_half_ppr?.toFixed(1) ?? '—'} />
      </Section>
    </>
  );

  if (pos === 'RB') return (
    <>
      <Section title="RUSHING — ADVANCED">
        <StatRow label="Carries / Game"    value={avg(tot.rush_att, gp)}        desc="Workload" />
        <StatRow label="Yards / Carry"     value={avg(tot.rush_yd, tot.rush_att)} desc="Efficiency" highlight />
        <StatRow label="Rush TDs"          value={fmtStat(tot.rush_td)}         desc="Red-zone role" />
        <StatRow label="Yards After Contact" value={fmtStat(tot.rush_yac || tot.rush_ybc)} desc="Elusiveness proxy" />
      </Section>
      <Section title="RECEIVING ROLE">
        <StatRow label="Targets / Game"   value={avg(tot.rec_tgt, gp)}          desc="Pass-game involvement" highlight />
        <StatRow label="Catch %"          value={pct(tot.rec, tot.rec_tgt)}     desc="Efficiency" />
        <StatRow label="Rec Yds / Game"   value={avg(tot.rec_yd, gp)}           desc="Receiving production" />
        <StatRow label="YAC / Reception"  value={avg(tot.rec_yac, tot.rec)}     desc="After-catch ability" />
      </Section>
      <Section title="FANTASY PRODUCTION">
        <StatRow label="Pts / Game (Half PPR)" value={avg(tot.pts_half_ppr, gp)} highlight />
        <StatRow label="Touches / Game"   value={avg((tot.rush_att||0)+(tot.rec||0), gp)} desc="Total touch rate" />
      </Section>
    </>
  );

  if (pos === 'WR' || pos === 'TE') return (
    <>
      <Section title="TARGET PROFILE">
        <StatRow label="Targets / Game"    value={avg(tot.rec_tgt, gp)}       desc="Volume" highlight />
        <StatRow label="Catch %"           value={pct(tot.rec, tot.rec_tgt)}  desc="Efficiency" />
        <StatRow label="Avg Depth of Target" value={avg(tot.rec_air_yd, tot.rec_tgt)} desc="Air yards per target" />
        <StatRow label="Air Yards Total"   value={fmtStat(tot.rec_air_yd)}    desc="Routes + separation value" />
      </Section>
      <Section title="AFTER THE CATCH">
        <StatRow label="YAC Total"         value={fmtStat(tot.rec_yac)}       desc="Yards after catch" highlight />
        <StatRow label="YAC / Reception"   value={avg(tot.rec_yac, tot.rec)}  desc="Elusiveness in space" />
        <StatRow label="Yds / Target"      value={avg(tot.rec_yd, tot.rec_tgt)}  desc="Overall efficiency" />
        <StatRow label="Yds / Reception"   value={avg(tot.rec_yd, tot.rec)}   desc="Yards per catch" />
      </Section>
      <Section title="FANTASY PRODUCTION">
        <StatRow label="Pts / Game (Half PPR)" value={avg(tot.pts_half_ppr, gp)} highlight />
        <StatRow label="TD Rate"           value={pct(tot.rec_td, tot.rec_tgt)}  desc="Red-zone conversion" />
      </Section>
    </>
  );

  if (pos === 'K') return (
    <Section title="KICKER ACCURACY">
      <StatRow label="FG %"              value={pct(tot.fgm, tot.fga)}           highlight />
      <StatRow label="FGM / Game"        value={avg(tot.fgm, gp)}                desc="Volume" />
      <StatRow label="Long (season)"     value={fmtStat(tot.fg_lng)}             desc="Longest FG" />
      <StatRow label="XP %"             value={pct(tot.xpm, tot.xpa)}            desc="Extra point accuracy" />
      <StatRow label="Pts / Game"        value={avg(tot.pts_std, gp)}            highlight />
    </Section>
  );

  if (pos === 'DST') return (
    <Section title="DEFENSE METRICS">
      <StatRow label="Sacks / Game"      value={avg(tot.sack, gp)}               highlight />
      <StatRow label="INTs (season)"     value={fmtStat(tot.def_int)}            />
      <StatRow label="Forced Fumbles"    value={fmtStat(tot.def_fr)}             />
      <StatRow label="Def TDs"           value={fmtStat(tot.def_td)}             highlight />
      <StatRow label="Pts Allowed / Game" value={avg(tot.pts_allow, gp)}         desc="Lower is better" />
      <StatRow label="Pts / Game (Fantasy)" value={avg(tot.pts_std, gp)}         />
    </Section>
  );

  return <div className="dim" style={{ fontSize: 12 }}>Advanced stats not available for this position.</div>;
}

function SeasonStatBar({ label, val, max }) {
  const pct = Math.min(100, (val / max) * 100);
  return (
    <div style={{ marginBottom: 8 }}>
      <div className="flex" style={{ justifyContent:'space-between', marginBottom: 3 }}>
        <span className="dim" style={{ fontSize: 11 }}>{label}</span>
        <span style={{ fontFamily:'var(--font-mono)', fontSize: 12, fontWeight: 600 }}>{val ?? '—'}</span>
      </div>
      <div style={{ height: 3, background:'var(--panel-3)', borderRadius: 2 }}>
        <div style={{ width:`${pct}%`, height:'100%', background:'var(--accent-2)', borderRadius: 2, transition:'width .4s' }} />
      </div>
    </div>
  );
}

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
          const minsAgo = n.fetchedAt ? Math.round((Date.now() - n.fetchedAt) / 60000) : null;
          return (
            <div key={i} style={{ padding:'10px 16px', borderTop: i > 0 ? '1px solid var(--border)' : 'none', background: i % 2 !== 0 ? 'rgba(255,255,255,.015)' : 'transparent' }}>
              <div style={{ display:'flex', alignItems:'center', gap:6, marginBottom:5 }}>
                <span style={{ fontSize:9, fontFamily:'var(--font-mono)', fontWeight:700, padding:'2px 6px', borderRadius:3, background:`${color}22`, color, border:`1px solid ${color}55`, whiteSpace:'nowrap' }}>
                  {n.source}
                </span>
                {minsAgo != null && (
                  <span style={{ fontSize:10, color:'var(--accent)', fontFamily:'var(--font-mono)' }}>
                    {minsAgo < 1 ? 'just now' : `${minsAgo}m ago`}
                  </span>
                )}
                {n.mins != null && minsAgo == null && (
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

// ─── PlayerDetail ─────────────────────────────────────────────────────────────

export function PlayerDetail({ player, onClose, myRosterIds = new Set(), onAddPlayer, onTradePlayer, sourcesState }) {
  if (!player) return null;
  const [activeTab, setTab] = React.useState('overview');
  const [added, setAdded] = React.useState(false);
  const [fetchedNewsItems, setFetchedNewsItems] = React.useState([]);
  const [newsLoading, setNewsLoading] = React.useState(true);

  React.useEffect(() => { setAdded(false); }, [player.id]);

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
            items.push({
              source: 'CBS Sports',
              sourceColor: '#0d4ea2',
              title: match.newsTitle || null,
              body:  match.news     || null,
              fetchedAt: now,
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
                fetchedAt: art.published ? new Date(art.published).getTime() : now,
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

  const isOnRoster    = myRosterIds.has(player.id);
  const ownerMap      = React.useMemo(() => buildOwnerMap(), []);
  const ownerTeamId   = isOnRoster ? null : (ownerMap[player.id] ?? null);
  const ownerTeam     = ownerTeamId ? findTeam(ownerTeamId) : null;
  const isOwnedByOther = !!ownerTeamId;
  const sleeperEnabled = sourcesState?.freeApis?.['sleeper-api'] !== false;

  const { data: detailBreakouts } = useR2BreakoutCandidates();
  const detailOppScore = React.useMemo(() => {
    if (!detailBreakouts?.length) return null;
    const key = player.name.toLowerCase().trim();
    return detailBreakouts.find(b => (b.player_name || '').toLowerCase().trim() === key)?.opportunity_score ?? null;
  }, [detailBreakouts, player.name]);

  function handleAdd() {
    if (isOnRoster || added) return;
    onAddPlayer?.(player.id);
    setAdded(true);
    setTimeout(onClose, 1300);
  }

  const { data: live, loading, error } = useApi(
    () => sleeperEnabled
      ? fetchSleeperPlayerStats(player.name, player.pos)
      : Promise.resolve(null),
    [player.id, sleeperEnabled]
  );

  const hasLive = !loading && live?.found && live.weeklyStats && Object.keys(live.weeklyStats).length > 0;
  const statusFromLive = live?.status && live.status !== 'Active' ? live.status : null;

  const playerNewsItems = React.useMemo(() => {
    const items = [...fetchedNewsItems];
    if (!loading && live?.status && !['Active','OK','Na',''].includes(live.status)) {
      const isBad = ['Out','Injured_Reserve','IR','Non_Football_Injury','NFI'].includes(live.status);
      items.unshift({
        source: 'Sleeper',
        sourceColor: '#7c5cbf',
        title: `${live.status}${live.injuryBodyPart ? ` — ${live.injuryBodyPart}` : ''}`,
        body: null,
        fetchedAt: Date.now(),
        impact: isBad ? 'bad' : live.status === 'Questionable' || live.status === 'Doubtful' ? 'medium' : 'low',
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
  }, [fetchedNewsItems, live, loading, newsLoading, player]);

  // Priority: 1) stored photoUrl from normalized data, 2) Sleeper CDN by stored sleeperId,
  // 3) Sleeper CDN by live sleeperId (available after API resolves)
  const sleeperAvatarUrl =
    player.photoUrl ||
    (player.sleeperId ? `https://sleepercdn.com/content/nfl/players/thumb/${player.sleeperId}.jpg` : null) ||
    (live?.sleeperId  ? `https://sleepercdn.com/content/nfl/players/thumb/${live.sleeperId}.jpg`   : null);

  // Game log rows from live data or mock fallback
  const liveRows = hasLive
    ? Object.entries(live.weeklyStats)
        .map(([wk, s]) => ({ wk: Number(wk), s }))
        .sort((a, b) => b.wk - a.wk)
    : null;

  const mockGameLog = [
    { wk: 10, opp: player.opp,  snaps: 64, tar: 9,  rec: 6, yds: 78,  td: 1, pts: player.last },
    { wk: 9,  opp: 'BYE',       snaps:'—', tar:'—', rec:'—',yds:'—', td:'—', pts:'—' },
    { wk: 8,  opp: '@NE',       snaps: 58, tar: 7,  rec: 5, yds: 64,  td: 0, pts: player.trend[4] },
    { wk: 7,  opp: 'NYG',       snaps: 67, tar: 11, rec: 8, yds: 102, td: 1, pts: player.trend[3] },
    { wk: 6,  opp: '@SF',       snaps: 54, tar: 6,  rec: 3, yds: 41,  td: 0, pts: player.trend[2] },
    { wk: 5,  opp: 'TB',        snaps: 62, tar: 8,  rec: 6, yds: 88,  td: 1, pts: player.trend[1] },
    { wk: 4,  opp: '@DAL',      snaps: 60, tar: 5,  rec: 4, yds: 54,  td: 0, pts: player.trend[0] },
  ];

  // Season stats derived from live totals or mock
  const tot = hasLive ? live.seasonTotals : null;
  const gp  = hasLive ? live.gamesPlayed : 10;
  const liveLastPts = hasLive && live.currentWeek
    ? (live.weeklyStats[live.currentWeek] ?? live.weeklyStats[live.currentWeek - 1])?.pts_half_ppr
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
              <span className="mono dim" style={{ fontSize: 11 }}>{player.team} · #{player.num} · Age {player.age}</span>
              {(player.status !== 'OK' || statusFromLive) &&
                <span className="status-pill"><StatusDot status={player.status} /> {statusFromLive || player.status}</span>}
              {hasLive && <LiveBadge />}
            </div>
            <h2>{player.name}</h2>
            <div className="meta">
              <span>ECR #{player.ecr}</span><span className="dot"></span>
              <span>ADP {player.adp.toFixed(1)}</span><span className="dot"></span>
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
          {[['overview','Overview'],['gamelog','Weekly Stats'],['nextgen','Next Gen'],['news','News'],['matchup','Matchup']].map(([k,v]) => (
            <div key={k} className={`tab ${activeTab===k?'active':''}`} onClick={() => setTab(k)}>{v}</div>
          ))}
        </div>

        <div style={{ padding: 18 }}>

          {/* ── Overview ── */}
          {activeTab === 'overview' && (
            <React.Fragment>
              <div style={{ display:'grid', gridTemplateColumns:`repeat(${detailOppScore != null ? 5 : 4},1fr)`, gap:10, marginBottom:16 }}>
                <div className="stat">
                  <div className="k">
                    Wk {live?.currentWeek || '—'} Proj
                    {hasLive && <span style={{ marginLeft: 5, fontSize: 8, fontFamily: 'var(--font-mono)', color: 'var(--accent-2)', verticalAlign: 'middle' }}>SLEEPER</span>}
                  </div>
                  <div className="v accent">
                    {(live?.projection?.pts_half_ppr ?? live?.projection?.pts_std ?? player.proj).toFixed(1)}
                  </div>
                  <div className="sub">vs {player.opp} (D #{player.oppRank})</div>
                </div>
                <div className="stat">
                  <div className="k">Last Week</div>
                  <div className="v">{(liveLastPts ?? player.last).toFixed(1)}</div>
                  <div className="sub"><Delta from={liveAvg ?? player.avg} to={liveLastPts ?? player.last} /> vs avg</div>
                </div>
                <div className="stat">
                  <div className="k">Season Avg</div>
                  <div className="v">{(liveAvg ?? player.avg).toFixed(1)}</div>
                  <div className="sub">{gp} games {hasLive ? <LiveBadge /> : 'played'}</div>
                </div>
                <div className="stat">
                  <div className="k">6-Wk Trend</div>
                  <div className="v"><Sparkline data={player.trend} width={80} height={28} /></div>
                  <div className="sub mono">{player.trend.join(' · ')}</div>
                </div>
                {detailOppScore != null && (
                  <div className="stat">
                    <div className="k" style={{ color: 'var(--accent-2)' }}>Opp Score</div>
                    <div className="v" style={{ color: 'var(--accent-2)', fontFamily: 'var(--font-mono)' }}>{detailOppScore.toFixed(1)}</div>
                    <div className="sub">↑ Breakout signal</div>
                  </div>
                )}
              </div>

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
                      <SeasonStatBar label="Pass Yards"  val={Math.round(tot.pass_yd  || 0)} max={5000} />
                      <SeasonStatBar label="Pass TDs"    val={Math.round(tot.pass_td  || 0)} max={50}   />
                      <SeasonStatBar label="Completions" val={Math.round(tot.pass_cmp || 0)} max={400}  />
                      <SeasonStatBar label="INTs"        val={Math.round(tot.pass_int || 0)} max={20}   />
                      <SeasonStatBar label="Rush Yards"  val={Math.round(tot.rush_yd  || 0)} max={800}  />
                      <SeasonStatBar label="Fantasy Pts" val={fmtStat(tot.pts_half_ppr,1)} max={400}  />
                    </>}
                    {player.pos === 'RB' && <>
                      <SeasonStatBar label="Rush Attempts" val={Math.round(tot.rush_att || 0)} max={300} />
                      <SeasonStatBar label="Rush Yards"    val={Math.round(tot.rush_yd  || 0)} max={1800}/>
                      <SeasonStatBar label="Rush TDs"      val={Math.round(tot.rush_td  || 0)} max={20}  />
                      <SeasonStatBar label="Receptions"    val={Math.round(tot.rec      || 0)} max={100} />
                      <SeasonStatBar label="Rec Yards"     val={Math.round(tot.rec_yd   || 0)} max={800} />
                      <SeasonStatBar label="Fantasy Pts"   val={fmtStat(tot.pts_half_ppr,1)} max={350}  />
                    </>}
                    {(player.pos === 'WR' || player.pos === 'TE') && <>
                      <SeasonStatBar label="Targets"     val={Math.round(tot.rec_tgt || 0)} max={200} />
                      <SeasonStatBar label="Receptions"  val={Math.round(tot.rec     || 0)} max={150} />
                      <SeasonStatBar label="Rec Yards"   val={Math.round(tot.rec_yd  || 0)} max={1800}/>
                      <SeasonStatBar label="Rec TDs"     val={Math.round(tot.rec_td  || 0)} max={20}  />
                      <SeasonStatBar label="Catch %"     val={tot.rec_tgt > 0 ? fmtStat((tot.rec/tot.rec_tgt)*100,1)+'%' : '—'} max={100} />
                      <SeasonStatBar label="YAC Total"   val={Math.round(tot.rec_yac || player.yac || 0)} max={600} />
                      <SeasonStatBar label="YAC/Rec"     val={tot.rec > 0 && (tot.rec_yac || player.yac) ? fmtStat((tot.rec_yac || player.yac) / tot.rec, 1) : player.yac > 0 ? fmtStat(player.yac, 1) : '—'} max={12} />
                      <SeasonStatBar label="Fantasy Pts" val={fmtStat(tot.pts_half_ppr,1)} max={350}  />
                    </>}
                  </div>
                </div>
              )}


              {/* AI insight */}
              <div className="muted-card" style={{ marginBottom:16, borderLeft:'3px solid var(--accent-2)' }}>
                <div className="flex gap-8" style={{ alignItems:'center', marginBottom:8 }}>
                  <div className="ai-orb" style={{ width:20, height:20 }}></div>
                  <span style={{ fontFamily:'var(--font-display)', fontStretch:'87%', fontWeight:800, fontSize:11, letterSpacing:'.12em', textTransform:'uppercase', color:'var(--accent-2)' }}>FantasAI Insight</span>
                </div>
                <div style={{ fontSize:13, lineHeight:1.55 }}>
                  {player.proj > 18
                    ? `Lock 'em in. Matchup model loves ${player.opp.replace('@','')} — ${player.name} should see volume at depth. Proj ${player.proj.toFixed(1)} is conservative; 75th-pct is ${(player.proj*1.25).toFixed(1)}.`
                    : `Mixed signals. Volume is fine but ${player.opp.replace('@','')} has been stingy near the goal line. Floor ${(player.proj*0.6).toFixed(1)}, ceiling ${(player.proj*1.4).toFixed(1)}.`}
                </div>
              </div>

              <PlayerNewsCard items={playerNewsItems} loading={newsLoading || loading} playerName={player.name} />
            </React.Fragment>
          )}

          {/* ── Game Log ── */}
          {activeTab === 'gamelog' && (
            loading
              ? <div className="muted-card" style={{ padding:18, display:'flex', alignItems:'center', gap:10 }}>
                  <div className="ai-orb" style={{ width:16, height:16 }} />
                  <span className="dim" style={{ fontSize:12 }}>Loading game log from Sleeper…</span>
                </div>
              : liveRows
                ? <>
                    <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:10 }}>
                      <span className="dim" style={{ fontSize:11 }}>2025 · Week-by-Week</span>
                      <LiveBadge />
                      <span className="mono faint" style={{ fontSize:9 }}>Sleeper API</span>
                    </div>
                    <div style={{ overflowX: 'auto' }}>
                    <table className="gamelog">
                      <thead>
                        <tr>
                          <th>Wk</th>
                          {glCols(player.pos).map(c => <th key={c}>{c}</th>)}
                        </tr>
                      </thead>
                      <tbody>
                        {liveRows.map(({ wk, s }) => {
                          const cells = glRow(player.pos, s);
                          if (!cells) return null;
                          const ptsIdx = cells.length - 1;
                          return (
                            <tr key={wk}>
                              <td className="mono" style={{ color:'var(--text-faint)' }}>{wk}</td>
                              {cells.map((c, i) => (
                                <td key={i} style={i===ptsIdx ? { fontWeight:600, color:'var(--accent)' } : {}}>{c}</td>
                              ))}
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                    </div>
                  </>
                : <>
                    {error && <div className="dim" style={{ fontSize:11, marginBottom:10 }}>Live data unavailable — showing sample data.</div>}
                    <div style={{ overflowX: 'auto' }}>
                    <table className="gamelog">
                      <thead><tr><th>Wk</th><th>Opp</th><th>Snp</th><th>Tar</th><th>Rec</th><th>Yds</th><th>TD</th><th>Pts</th></tr></thead>
                      <tbody>
                        {mockGameLog.map(g => (
                          <tr key={g.wk}>
                            <td>{g.wk}</td><td>{g.opp}</td><td>{g.snaps}</td>
                            <td>{g.tar}</td><td>{g.rec}</td><td>{g.yds}</td><td>{g.td}</td>
                            <td style={{ fontWeight:600, color:'var(--accent)' }}>{typeof g.pts==='number' ? g.pts.toFixed(1) : g.pts}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    </div>
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
                    <span className="mono faint" style={{ fontSize: 9 }}>Sleeper API</span>
                  </div>
                  <NextGenStatsPanel pos={player.pos} tot={tot} gp={gp} />
                </>
          )}

          {/* ── News ── */}
          {activeTab === 'news' && (
            <PlayerNewsCard items={playerNewsItems} loading={newsLoading || loading} playerName={player.name} />
          )}

          {/* ── Matchup ── */}
          {activeTab === 'matchup' && (
            <div>
              <div className="muted-card" style={{ marginBottom:16 }}>
                <div className="flex gap-16" style={{ justifyContent:'space-around', textAlign:'center' }}>
                  <div>
                    <div className="mono dim" style={{ fontSize:11 }}>{player.team}</div>
                    <div style={{ fontFamily:'var(--font-display)', fontStretch:'75%', fontSize:28, fontWeight:900 }}>7-3</div>
                  </div>
                  <div style={{ fontFamily:'var(--font-display)', fontStretch:'75%', fontSize:28, fontWeight:900, color:'var(--text-faint)', alignSelf:'center' }}>vs</div>
                  <div>
                    <div className="mono dim" style={{ fontSize:11 }}>{player.opp}</div>
                    <div style={{ fontFamily:'var(--font-display)', fontStretch:'75%', fontSize:28, fontWeight:900 }}>5-5</div>
                  </div>
                </div>
                <div style={{ textAlign:'center', fontSize:11, color:'var(--text-faint)', marginTop:8 }} className="mono">SUN 1:00PM ET · O/U 47.5 · {player.team} -3.5</div>
              </div>
              <div className="card-title" style={{ marginBottom:8 }}>Defense vs Position ({player.pos})</div>
              <table className="gamelog">
                <thead><tr><th>Metric</th><th>{player.opp}</th><th>NFL Avg</th><th>Rank</th></tr></thead>
                <tbody>
                  <tr><td>FP Allowed/G</td><td>{(20-player.oppRank*0.3).toFixed(1)}</td><td>15.8</td><td style={{ color:player.oppRank>20?'var(--good)':'var(--danger)' }}>#{player.oppRank}</td></tr>
                  <tr><td>Yds Allowed/G</td><td>284</td><td>241</td><td>#26</td></tr>
                  <tr><td>TDs Allowed</td><td>18</td><td>14</td><td>#28</td></tr>
                  <tr><td>Pressure %</td><td>22.4%</td><td>24.1%</td><td>#19</td></tr>
                </tbody>
              </table>
            </div>
          )}

        </div>
      </div>
    </React.Fragment>
  );
}
