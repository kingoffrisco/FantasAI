import React from 'react';
import { api } from '../api.js';
import { optimizeLineup, optimizeDiverseLineups, DK_SALARY_CAP } from '../lib/dfsOptimizer.js';
import { DFS_POSITIONS, DFS_POSITION_FEATURES, loadDfsWeights, saveDfsWeights, resetDfsWeights, applyDfsWeights, isDefaultWeights } from '../lib/dfsWeights.js';
import { DFS_ANALYSIS_METRICS, loadAnalysisSettings, saveAnalysisSettings, resetAnalysisSettings, computeLineupMetrics, buildAnalysisPrompt, parseAnalysisResponse } from '../lib/dfsAnalysis.js';
import { fetchDkContestDetail, DK_STANDARD_SCORING, DK_LINEUP_SLOTS, DK_SALARY_CAP_INFO } from '../lib/dkContestDetails.js';
import { fetchDkLobbyContestsLive, fetchDkDraftGroupPlayersLive } from '../lib/dkLiveData.js';
import { useR2BreakoutCandidates, useR2SleeperPicks, useR2DefenseVsPos, useR2PlayerOwnership, useR2WeatherForecast, useR2KalshiNflMarkets, useR2FloorCeiling, useR2DkContests, useR2PlayerNotes, useR2WeaponScores, useR2TeamSupportScores, useR2OlineStability } from '../hooks.js';
import { findPlayerByName } from '../lib/playerStore.js';
import { buildPlayerContextLines, PLAYER_CONTEXT_SOURCES, DFS_POOL_COLUMNS, loadDfsPoolColumns, saveDfsPoolColumns, getPlayerTableRow, buildOwnershipMap } from '../lib/dfsPlayerContext.js';
import { getPrefs, patchPrefs } from '../lib/remotePrefs.js';

const POS_COLORS = { QB: '#ef4444', RB: '#22c55e', WR: '#3b82f6', TE: '#f59e0b', DST: '#64748b' };

function money(n) {
  return `$${Number(n || 0).toLocaleString()}`;
}

const WEATHER_COLOR = { Low: 'var(--text-dim)', Medium: '#ffb547', High: 'var(--danger)', Dome: 'var(--text-faint)' };

// Optimal Lineup / Non-Chalk / Best Ceiling — see optimizeDiverseLineups' strategies config.
const LINEUP_STRATEGY_SEQUENCE = ['projection', 'leverageScore', 'ceiling'];

// ─── Movable / resizable page layout ──────────────────────────────────────
// Lets the user drag each box to reorder it and drag its corner to resize
// it. Order is applied via CSS `order` (grid items respect it, same as
// flexbox) rather than physically moving JSX, so every box stays exactly
// where it's defined in the source — only its position in the visual flow
// and its size change.
const DFS_LAYOUT_PREF_KEY = 'dfsOptimizerLayoutV2';
const DEFAULT_DFS_LAYOUT = [
  { id: 'contest',         span: 1, height: null, collapsed: false },
  { id: 'contestDetails',  span: 1, height: null, collapsed: false },
  { id: 'weightedLineups', span: 1, height: null, collapsed: false },
  { id: 'aiAnalysis',      span: 1, height: null, collapsed: false },
  { id: 'selectPlayers',   span: 2, height: null, collapsed: false },
];
const MIN_BOX_HEIGHT = 160;

function loadDfsLayout() {
  try {
    const saved = getPrefs()[DFS_LAYOUT_PREF_KEY];
    if (!Array.isArray(saved)) return DEFAULT_DFS_LAYOUT.map(b => ({ ...b }));
    const byId = new Map(saved.filter(b => b?.id).map(b => [b.id, b]));
    const knownIds = new Set(DEFAULT_DFS_LAYOUT.map(b => b.id));
    const ordered = saved.filter(b => knownIds.has(b?.id)).map(b => DEFAULT_DFS_LAYOUT.find(d => d.id === b.id));
    const missing = DEFAULT_DFS_LAYOUT.filter(d => !byId.has(d.id));
    return [...ordered, ...missing].map(d => {
      const s = byId.get(d.id);
      return {
        id: d.id,
        span: s?.span === 2 ? 2 : s?.span === 1 ? 1 : d.span,
        height: Number.isFinite(s?.height) ? s.height : null,
        collapsed: typeof s?.collapsed === 'boolean' ? s.collapsed : d.collapsed,
      };
    });
  } catch { return DEFAULT_DFS_LAYOUT.map(b => ({ ...b })); }
}
function saveDfsLayout(layout) {
  patchPrefs({ [DFS_LAYOUT_PREF_KEY]: layout });
}

function formatPoolColumnValue(colId, row) {
  if (!row) return '—';
  switch (colId) {
    case 'opp':      return null; // rendered by caller, not from row
    case 'weather':  return row.weatherLabel ? { text: row.weatherWindMph ? `${row.weatherLabel} (${row.weatherWindMph}mph)` : row.weatherLabel, color: WEATHER_COLOR[row.weatherLabel] } : '—';
    case 'matchup':  return row.matchupRank != null ? `#${row.matchupRank}` : '—';
    case 'adp':      return row.adp ?? '—';
    case 'rank':     return row.rank ?? '—';
    case 'tier':     return row.tier ?? '—';
    case 'last':     return row.last != null ? row.last.toFixed(1) : '—';
    case 'avg':      return row.avg != null ? row.avg.toFixed(1) : '—';
    case 'trend':    return row.trend || '—';
    case 'bye':      return row.bye ?? '—';
    case 'owned':    return row.owned != null ? `${row.owned.toFixed(1)}%` : '—';
    case 'depth':    return row.depth ?? '—';
    case 'snaps':    return row.snaps != null ? row.snaps.toFixed(1) : '—';
    case 'snap_pct': return row.snapPct != null ? `${(row.snapPct * (row.snapPct <= 1 ? 100 : 1)).toFixed(0)}%` : '—';
    case 'tgt':      return row.targetShare != null ? `${(row.targetShare * (row.targetShare <= 1 ? 100 : 1)).toFixed(1)}%` : '—';
    case 'tgt_g':    return row.tgtG != null ? row.tgtG.toFixed(1) : '—';
    case 'att_g':    return row.attG != null ? row.attG.toFixed(1) : '—';
    case 'rz_att':   return row.rzAttG != null ? row.rzAttG.toFixed(1) : '—';
    case 'routes':   return row.routes ?? '—';
    case 'yac':      return row.yac != null ? row.yac.toFixed(1) : '—';
    case 'adot':     return row.adot != null ? row.adot.toFixed(1) : '—';
    case 'air_yds':  return row.airYds ?? '—';
    case 'yptgt':    return row.yptgt != null ? row.yptgt.toFixed(1) : '—';
    case 'combo':    return row.combo != null ? row.combo.toFixed(1) : '—';
    case 'forty':    return row.forty != null ? row.forty.toFixed(2) : '—';
    case 'vertical': return row.vertical != null ? `${row.vertical}"` : '—';
    case 'broad':    return row.broadJump != null ? `${row.broadJump}"` : '—';
    case 'bench':    return row.benchPress ?? '—';
    default:         return '—';
  }
}

// One draggable/resizable box in the page layout. `order` comes from this
// box's index in the current dfsLayout array (CSS order, not DOM position),
// so wrapping existing content in this component doesn't require moving
// any of that content in the source. Drag the ⠿ handle to reorder, the ⤡
// corner to resize (right = wider/full-width, down = taller).
function LayoutBox({ id, order, span, height, collapsed, dragging, dragOver, onDragStart, onDragOver, onDrop, onDragEnd, onResizeStart, onToggleCollapse, children }) {
  return (
    <div
      data-box-id={id}
      onDragOver={e => { e.preventDefault(); e.stopPropagation(); onDragOver(id); }}
      onDrop={e => { e.preventDefault(); e.stopPropagation(); onDrop(dragging, id); }}
      style={{
        order,
        gridColumn: `span ${span}`,
        position: 'relative',
        height: collapsed ? 'auto' : (height ? `${height}px` : 'auto'),
        display: 'flex',
        flexDirection: 'column',
        minWidth: 0,
        opacity: dragging === id ? 0.4 : 1,
        outline: dragOver === id && dragging && dragging !== id ? '2px dashed var(--accent-2)' : 'none',
        outlineOffset: 2,
        borderRadius: 10,
        transition: 'opacity .15s',
      }}
    >
      <span
        draggable
        onDragStart={e => { e.dataTransfer.effectAllowed = 'move'; onDragStart(id); }}
        onDragEnd={onDragEnd}
        title="Drag to reorder this box"
        style={{
          position: 'absolute', top: 6, right: 30, zIndex: 6, cursor: 'grab', fontSize: 13, lineHeight: 1,
          color: 'var(--text-faint)', padding: '3px 6px', borderRadius: 5,
          background: 'var(--panel-2)', border: '1px solid var(--border)', userSelect: 'none',
        }}
      >⠿</span>
      {onToggleCollapse && (
        <button
          onClick={() => onToggleCollapse(id)}
          title={collapsed ? 'Expand this box' : 'Collapse this box'}
          style={{
            position: 'absolute', top: 6, right: 6, zIndex: 6, cursor: 'pointer', fontSize: 11, lineHeight: 1,
            color: 'var(--text-faint)', padding: '3px 6px', borderRadius: 5,
            background: 'var(--panel-2)', border: '1px solid var(--border)', userSelect: 'none',
          }}
        >{collapsed ? '▸' : '▾'}</button>
      )}
      {!collapsed && (
        <>
          <div style={{ flex: 1, minHeight: 0, overflowY: height ? 'auto' : 'visible' }}>
            {children}
          </div>
          <span
            onMouseDown={e => onResizeStart(e, id)}
            title="Drag to resize — right for full width, down for taller"
            style={{
              position: 'absolute', bottom: 4, right: 4, zIndex: 6, cursor: 'nwse-resize', fontSize: 13, lineHeight: 1,
              color: 'var(--text-faint)', padding: '3px 5px', borderRadius: 5,
              background: 'var(--panel-2)', border: '1px solid var(--border)', userSelect: 'none',
            }}
          >⤡</span>
        </>
      )}
    </div>
  );
}

export default function DfsOptimizerScreen() {
  const [activeTab, setActiveTab] = React.useState('optimizer');
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState(null);
  const [slates, setSlates] = React.useState([]);
  const [salaries, setSalaries] = React.useState([]);
  const [draftGroupId, setDraftGroupId] = React.useState(null);
  const [selectedContestId, setSelectedContestId] = React.useState(null);
  const [excludeIds, setExcludeIds] = React.useState(() => new Set());
  const [lockIds, setLockIds] = React.useState(() => new Set());
  const [dataGeneratedAt, setDataGeneratedAt] = React.useState(null);
  const { data: dkContestsData } = useR2DkContests();
  const [liveContests, setLiveContests] = React.useState(null); // overrides R2 cache once refreshed live
  const [contestsRefreshing, setContestsRefreshing] = React.useState(false);
  const [contestsRefreshError, setContestsRefreshError] = React.useState(null);
  const contests = liveContests ?? (dkContestsData?.contests || []);

  async function refreshContestsLive() {
    setContestsRefreshing(true);
    setContestsRefreshError(null);
    try {
      const fresh = await fetchDkLobbyContestsLive();
      setLiveContests(fresh);
    } catch (e) {
      setContestsRefreshError(e.message || 'Failed to refresh contests from DraftKings.');
    } finally {
      setContestsRefreshing(false);
    }
  }

  // Live per-draft-group player pool — the R2 cache only covers whichever
  // draft groups the local pipeline's last run happened to pull (top N by
  // field size), so a contest the user picks here may not be in it yet.
  // Fetch it live from DK the first time a draftGroupId with no cached rows
  // is selected, and merge it into `salaries` so poolForSlate picks it up
  // exactly like a normal R2-sourced slate.
  const [poolLiveLoading, setPoolLiveLoading] = React.useState(false);
  const [poolLiveError, setPoolLiveError] = React.useState(null);
  const [pullingDetails, setPullingDetails] = React.useState(false);
  const [pulledGames, setPulledGames] = React.useState([]);
  const fetchedLiveDgRef = React.useRef(new Set());

  function deriveGamesFromRows(rows) {
    const games = new Map();
    for (const r of rows) {
      if (!r.team || !r.opponent) continue;
      const key = [r.team, r.opponent].sort().join('|');
      if (!games.has(key)) games.set(key, r.is_home ? `${r.opponent} @ ${r.team}` : `${r.team} @ ${r.opponent}`);
    }
    return [...games.values()];
  }

  React.useEffect(() => {
    if (!draftGroupId) return;
    const cachedRows = salaries.filter(p => p.draft_group_id === draftGroupId);
    if (cachedRows.length > 0) {
      setPulledGames(deriveGamesFromRows(cachedRows));
    }
    if (cachedRows.length > 0 || fetchedLiveDgRef.current.has(draftGroupId)) return;
    fetchedLiveDgRef.current.add(draftGroupId);
    let cancelled = false;
    setPoolLiveLoading(true);
    setPoolLiveError(null);
    fetchDkDraftGroupPlayersLive(draftGroupId)
      .then(rows => {
        if (cancelled) return;
        setSalaries(prev => [...prev.filter(p => p.draft_group_id !== draftGroupId), ...rows]);
        setPulledGames(deriveGamesFromRows(rows));
      })
      .catch(e => {
        if (cancelled) return;
        setPoolLiveError(e.message || 'Failed to live-fetch this contest\'s player pool.');
        fetchedLiveDgRef.current.delete(draftGroupId); // allow retry on next selection/re-render
      })
      .finally(() => { if (!cancelled) setPoolLiveLoading(false); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftGroupId]);

  // "Pull Details" button — explicit, user-triggered live re-fetch of the
  // selected contest's games + player pool, even if it's already cached
  // (unlike the automatic effect above, which only fires for uncached
  // draft groups). Bypasses the ref gate so it always hits DK fresh.
  async function pullContestDetailsLive() {
    if (!draftGroupId) return;
    setPullingDetails(true);
    setPoolLiveError(null);
    try {
      const rows = await fetchDkDraftGroupPlayersLive(draftGroupId);
      fetchedLiveDgRef.current.add(draftGroupId);
      setSalaries(prev => [...prev.filter(p => p.draft_group_id !== draftGroupId), ...rows]);
      setPulledGames(deriveGamesFromRows(rows));
    } catch (e) {
      setPoolLiveError(e.message || 'Failed to pull contest details from DraftKings.');
    } finally {
      setPullingDetails(false);
    }
  }
  const [contestDetail, setContestDetail] = React.useState(null);
  const [contestDetailLoading, setContestDetailLoading] = React.useState(false);
  const [contestDetailError, setContestDetailError] = React.useState(null);
  const [showScoringRules, setShowScoringRules] = React.useState(true);

  const load = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [slatesResp, salariesResp] = await Promise.all([api.r2.dkSlates(), api.r2.dkSalaries()]);
      const slateList = slatesResp?.slates || [];
      const playerList = salariesResp?.players || [];
      setSlates(slateList);
      setSalaries(playerList);
      setDataGeneratedAt(salariesResp?.generated_at || null);
      if (slateList.length > 0) setDraftGroupId(prev => prev ?? slateList[0].draft_group_id);
      else if (playerList.length > 0) setDraftGroupId(prev => prev ?? playerList[0].draft_group_id);
    } catch (e) {
      setError(e.message || 'Failed to load DraftKings salary data.');
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => { load(); }, [load]);

  const rawPoolForSlate = React.useMemo(() => {
    if (!draftGroupId) return [];
    const mapped = salaries
      .filter(p => p.draft_group_id === draftGroupId)
      .map(p => ({
        id: p.draftable_id,
        dkPlayerId: p.player_dk_id,
        name: p.display_name,
        team: p.team,
        opponent: p.opponent,
        isHome: p.is_home,
        position: p.position,
        salary: p.salary,
        projection: p.dk_avg_points,
        status: p.status,
        gameStartTime: p.game_start_time,
      }));
    // DK sends one row per (player, eligible-slot-type) — a FLEX-eligible
    // RB/WR/TE gets a second row (different draftable id, same player) just
    // for FLEX-slot eligibility. Older cached R2 payloads may still have
    // this before the fix in ingest_draftkings.py takes effect — dedupe
    // defensively here too so the pool and the optimizer never see a real
    // player as two distinct candidates.
    const seen = new Set();
    const deduped = [];
    for (const p of mapped) {
      const key = p.dkPlayerId ?? p.name;
      if (seen.has(key)) continue;
      seen.add(key);
      deduped.push(p);
    }
    return deduped;
  }, [salaries, draftGroupId]);

  // DFS Weights — user-configured per-position feature weighting, same
  // pattern as the Sleeper Slider. Default weights (100% DK projection) are
  // a guaranteed no-op, so this only changes anything once the user
  // actually tunes a slider.
  const [dfsWeights, setDfsWeights] = React.useState(() => loadDfsWeights());
  const { data: breakoutCandidates } = useR2BreakoutCandidates();
  const { data: sleeperPicks } = useR2SleeperPicks();
  const { data: defenseVsPos } = useR2DefenseVsPos();
  const { data: playerOwnership } = useR2PlayerOwnership();
  const [weightedLineups, setWeightedLineups] = React.useState(null); // array of optimizeLineup() results, or null before first generate
  const [generatingLineups, setGeneratingLineups] = React.useState(false);

  // AI Lineup Analysis — deterministic metrics computed from real data, fed
  // to the chat model as a critic (not asked to pick players itself).
  const { data: weatherForecast } = useR2WeatherForecast();
  const { data: kalshiNflMarkets } = useR2KalshiNflMarkets();
  const { data: floorCeilingData } = useR2FloorCeiling();
  const { data: playerNotes } = useR2PlayerNotes();
  const { data: weaponScores } = useR2WeaponScores();
  const { data: teamSupportScores } = useR2TeamSupportScores();
  const { data: olineStability } = useR2OlineStability();
  const [analysisSettings, setAnalysisSettings] = React.useState(() => loadAnalysisSettings());
  const [showAnalysisSettings, setShowAnalysisSettings] = React.useState(false);
  const [analyzing, setAnalyzing] = React.useState(false);
  const [analysisResult, setAnalysisResult] = React.useState(null);
  const [analysisMetrics, setAnalysisMetrics] = React.useState(null);
  const [analysisParsed, setAnalysisParsed] = React.useState(null);
  const [analysisError, setAnalysisError] = React.useState(null);

  const poolForSlate = React.useMemo(() => {
    const weighted = isDefaultWeights(dfsWeights)
      ? rawPoolForSlate
      : applyDfsWeights(rawPoolForSlate, dfsWeights, { breakoutCandidates, sleeperPicks, defenseVsPos, playerOwnership });
    return [...weighted].sort((a, b) => (b.projection || 0) - (a.projection || 0));
  }, [rawPoolForSlate, dfsWeights, breakoutCandidates, sleeperPicks, defenseVsPos, playerOwnership]);

  // How many distinct games this contest's player pool actually spans —
  // surfaced directly next to the pool so a 4-game slate visibly shows
  // fewer players/games than a 12-game slate, not just a smaller table.
  const poolGameCount = React.useMemo(() => {
    const games = new Set();
    for (const p of poolForSlate) {
      if (p.team && p.opponent) games.add([p.team, p.opponent].sort().join('|'));
    }
    return games.size;
  }, [poolForSlate]);

  // Draggable/resizable box layout — order + span + height per box,
  // persisted the same way as everything else on this page.
  const [dfsLayout, setDfsLayout] = React.useState(() => loadDfsLayout());
  const dfsLayoutRef = React.useRef(dfsLayout);
  React.useEffect(() => { dfsLayoutRef.current = dfsLayout; }, [dfsLayout]);
  const [draggingBoxId, setDraggingBoxId] = React.useState(null);
  const [dragOverBoxId, setDragOverBoxId] = React.useState(null);
  const resizeStateRef = React.useRef(null);

  const boxOrder = id => { const i = dfsLayout.findIndex(b => b.id === id); return i < 0 ? 0 : i; };
  const boxSpan = id => dfsLayout.find(b => b.id === id)?.span ?? 1;
  const boxHeight = id => dfsLayout.find(b => b.id === id)?.height ?? null;
  const boxCollapsed = id => dfsLayout.find(b => b.id === id)?.collapsed ?? false;

  function toggleBoxCollapsed(id) {
    setDfsLayout(prev => {
      const next = prev.map(b => b.id === id ? { ...b, collapsed: !b.collapsed } : b);
      saveDfsLayout(next);
      return next;
    });
  }

  function moveBoxTo(fromId, toId) {
    if (!fromId || !toId || fromId === toId) return;
    setDfsLayout(prev => {
      const next = [...prev];
      const fromIdx = next.findIndex(b => b.id === fromId);
      const toIdx = next.findIndex(b => b.id === toId);
      if (fromIdx < 0 || toIdx < 0) return prev;
      const [moved] = next.splice(fromIdx, 1);
      next.splice(toIdx, 0, moved);
      saveDfsLayout(next);
      return next;
    });
  }

  function handleBoxResizeStart(e, id) {
    e.preventDefault();
    const box = dfsLayoutRef.current.find(b => b.id === id);
    if (!box) return;
    const wrapperEl = e.currentTarget.closest('[data-box-id]');
    resizeStateRef.current = {
      id,
      startX: e.clientX,
      startY: e.clientY,
      startHeight: box.height || wrapperEl?.offsetHeight || 260,
      startSpan: box.span,
    };
    window.addEventListener('mousemove', handleBoxResizeMove);
    window.addEventListener('mouseup', handleBoxResizeEnd);
  }
  function handleBoxResizeMove(e) {
    const r = resizeStateRef.current;
    if (!r) return;
    const dy = e.clientY - r.startY;
    const dx = e.clientX - r.startX;
    const newHeight = Math.max(MIN_BOX_HEIGHT, Math.round(r.startHeight + dy));
    let newSpan = r.startSpan;
    if (dx > 90) newSpan = 2;
    else if (dx < -90) newSpan = 1;
    setDfsLayout(prev => prev.map(b => b.id === r.id ? { ...b, height: newHeight, span: newSpan } : b));
  }
  function handleBoxResizeEnd() {
    window.removeEventListener('mousemove', handleBoxResizeMove);
    window.removeEventListener('mouseup', handleBoxResizeEnd);
    resizeStateRef.current = null;
    saveDfsLayout(dfsLayoutRef.current);
  }
  function resetDfsLayout() {
    const next = DEFAULT_DFS_LAYOUT.map(b => ({ ...b }));
    setDfsLayout(next);
    saveDfsLayout(next);
  }

  // Position + salary filters for the player-selection table — narrows the
  // display only; locks/excludes/the optimizer still see the full pool.
  const [poolPosFilter, setPoolPosFilter] = React.useState('ALL');
  const [poolSalaryMin, setPoolSalaryMin] = React.useState('');
  const [poolSalaryMax, setPoolSalaryMax] = React.useState('');

  const filteredPool = React.useMemo(() => {
    const min = poolSalaryMin !== '' ? Number(poolSalaryMin) : null;
    const max = poolSalaryMax !== '' ? Number(poolSalaryMax) : null;
    return poolForSlate.filter(p => {
      if (poolPosFilter !== 'ALL' && p.position !== poolPosFilter) return false;
      if (min != null && p.salary < min) return false;
      if (max != null && p.salary > max) return false;
      return true;
    });
  }, [poolForSlate, poolPosFilter, poolSalaryMin, poolSalaryMax]);

  // Toggleable columns for the player-selection table — same spirit as the
  // Players page (opp/weather/ADP/NextGen/combine), persisted separately
  // under its own pref key.
  const [poolColumns, setPoolColumns] = React.useState(() => loadDfsPoolColumns());
  const [showColumnPicker, setShowColumnPicker] = React.useState(false);
  const visiblePoolColumns = poolColumns.filter(c => c.visible);

  function togglePoolColumn(id) {
    const next = poolColumns.map(c => c.id === id ? { ...c, visible: !c.visible } : c);
    setPoolColumns(next);
    saveDfsPoolColumns(next);
  }
  function resetPoolColumns() {
    const next = DFS_POOL_COLUMNS.map(c => ({ ...c }));
    setPoolColumns(next);
    saveDfsPoolColumns(next);
  }

  const ownershipMap = React.useMemo(() => buildOwnershipMap(playerOwnership), [playerOwnership]);

  // One enrichment lookup per player, computed once per pool/enrichment-data
  // change rather than per cell render.
  const poolRowEnrichment = React.useMemo(() => {
    const map = new Map();
    for (const p of poolForSlate) {
      map.set(p.id, getPlayerTableRow(p, {
        findPlayerByName,
        defenseVsPos,
        ownershipMap,
        weatherForecast,
        weatherThresholds: analysisSettings.weatherThresholds,
      }));
    }
    return map;
  }, [poolForSlate, defenseVsPos, ownershipMap, weatherForecast, analysisSettings.weatherThresholds]);

  const optimized = React.useMemo(() => {
    if (poolForSlate.length === 0) return null;
    return optimizeLineup(poolForSlate, { excludeIds, lockIds });
  }, [poolForSlate, excludeIds, lockIds]);

  // Ceiling lookup (real 90th-percentile game-log data, same source as the
  // AI Analysis floor/ceiling card) — used by the "Best Ceiling" lineup.
  const ceilingByName = React.useMemo(() => {
    const map = new Map();
    for (const fc of (floorCeilingData?.players || [])) {
      if (fc.player_name) map.set(fc.player_name.toLowerCase().trim(), Number(fc.ceiling_pts));
    }
    return map;
  }, [floorCeilingData]);

  // Pool enriched with ceiling/ownership/leverageScore for the strategy
  // lineups below. A player missing real data gets `ceiling: null` (so
  // result.totalCeiling coverage stays honest) but contributes 0 — not a
  // guessed value — to the ceiling-maximizing solve specifically; missing
  // ownership falls back to plain projection (neutral, no leverage
  // adjustment applied) rather than assuming a specific ownership number.
  const strategizedPool = React.useMemo(() => {
    return poolForSlate.map(p => {
      const ceiling = ceilingByName.get(p.name?.toLowerCase().trim());
      const ownership = ownershipMap.get(p.name?.toLowerCase().trim());
      const leverageScore = ownership != null ? (p.projection || 0) * (1 - ownership / 100) : (p.projection || 0);
      return { ...p, ceiling: Number.isFinite(ceiling) ? ceiling : null, ownership: ownership ?? null, leverageScore };
    });
  }, [poolForSlate, ceilingByName, ownershipMap]);

  // Generates the 3 strategy lineups — Optimal (pure projection), Non-Chalk
  // (projection discounted by ownership, rewarding low-owned production),
  // Best Ceiling (real 90th-percentile outcome) — from the same
  // weight-adjusted pool, each required to differ from the others by at
  // least 2 players. Runs async via setTimeout so the "Generating…" state
  // actually paints before the (synchronous, blocking) ILP solve runs 3x.
  function generateWeightedLineups() {
    setGeneratingLineups(true);
    setTimeout(() => {
      const results = optimizeDiverseLineups(strategizedPool, { excludeIds, lockIds }, { count: 3, minDiff: 2, strategies: LINEUP_STRATEGY_SEQUENCE });
      setWeightedLineups(results);
      setGeneratingLineups(false);
    }, 20);
  }

  function toggleSet(setter, id) {
    setter(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  async function runAnalysis() {
    if (!optimized?.feasible) return;
    setAnalyzing(true);
    setAnalysisError(null);
    setAnalysisResult(null);
    setAnalysisParsed(null);
    try {
      const { metrics, promptLines } = computeLineupMetrics(optimized.lineup, {
        kalshiMarkets: kalshiNflMarkets,
        weatherForecast,
        weatherThresholds: analysisSettings.weatherThresholds,
        enabled: analysisSettings.enabled,
        floorCeilingData,
      });
      setAnalysisMetrics(metrics);
      const rosterLines = optimized.lineup.map(({ slot, player }) => `${slot}: ${player.name} (${player.team}, $${player.salary}, proj ${player.projection?.toFixed(1)})`).join('\n');
      const playerContextLines = buildPlayerContextLines(optimized.lineup, {
        findPlayerByName,
        defenseVsPos,
        playerNotes,
        weaponScores,
        teamSupportScores,
        olineStability,
      }, analysisSettings.playerContextEnabled);
      const question = buildAnalysisPrompt({
        rosterLines,
        promptLines,
        contestType: analysisSettings.contestType,
        userExpectations: analysisSettings.userExpectations,
        playerContextLines,
      });
      const res = await fetch('https://api.fantasai.net/api/v1/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question, context: 'DFS lineup critique — evaluate the given lineup, do not build a new one.' }),
        signal: AbortSignal.timeout(45000),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `Error ${res.status}`);
      setAnalysisResult(data.answer);
      setAnalysisParsed(parseAnalysisResponse(data.answer));
    } catch (e) {
      setAnalysisError(e.message || 'Analysis failed.');
    } finally {
      setAnalyzing(false);
    }
  }

  function handleSaveAnalysisSettings() {
    saveAnalysisSettings(analysisSettings);
  }

  function handleResetAnalysisSettings() {
    setAnalysisSettings(resetAnalysisSettings());
  }

  // Default contest: the biggest-prize contest whose draft group we actually
  // have a player pool for (falls back to biggest-prize overall). Only runs
  // once, the first time contest data shows up — after that the user's pick
  // (or the plain Slate dropdown) drives draftGroupId.
  React.useEffect(() => {
    if (selectedContestId != null || contests.length === 0) return;
    const validDgIds = new Set(slates.map(s => s.draft_group_id));
    const candidates = validDgIds.size > 0 ? contests.filter(c => validDgIds.has(c.draft_group_id)) : contests;
    const best = [...candidates].sort((a, b) => (b.total_prize || 0) - (a.total_prize || 0))[0];
    if (best) {
      setSelectedContestId(best.contest_id);
      setDraftGroupId(best.draft_group_id);
    }
  }, [contests, slates, selectedContestId]);

  function selectContest(c) {
    setSelectedContestId(c.contest_id);
    setDraftGroupId(c.draft_group_id);
  }

  // Pull live contest-specific details (prize payouts, entries, blurb)
  // straight from DK whenever the selected contest changes — the scoring
  // rules and lineup requirements alongside it are constant, not fetched
  // (see dkContestDetails.js).
  React.useEffect(() => {
    if (selectedContestId == null) return;
    let cancelled = false;
    setContestDetailLoading(true);
    setContestDetailError(null);
    fetchDkContestDetail(selectedContestId)
      .then(d => { if (!cancelled) setContestDetail(d); })
      .catch(e => { if (!cancelled) setContestDetailError(e.message || 'Failed to load contest details.'); })
      .finally(() => { if (!cancelled) setContestDetailLoading(false); });
    return () => { cancelled = true; };
  }, [selectedContestId]);

  const selectedSlate = slates.find(s => s.draft_group_id === draftGroupId);
  const selectedContest = contests.find(c => c.contest_id === selectedContestId);
  const weightsActive = !isDefaultWeights(dfsWeights);

  return (
    <div style={{ padding: '20px 24px', width: '100%', display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div className="page-head" style={{ paddingLeft: 0, paddingRight: 0, paddingTop: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
          <div>
            <h1>DFS Lineup Optimizer</h1>
            <div className="sub">
              True ILP-optimal DraftKings Classic lineup — {money(DK_SALARY_CAP)} cap, 9 players (QB/RB/RB/WR/WR/WR/TE/FLEX/DST).
              {weightsActive
                ? ' Projections are DraftKings’ consensus (AVG), adjusted by your DFS Weights.'
                : ' Projections are DraftKings’ own consensus (AVG), not FantasAI’s model.'}
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 0, background: 'var(--panel)', borderRadius: 8, padding: 3, marginLeft: 'auto', flexShrink: 0 }}>
            {[{ id: 'optimizer', label: 'Optimizer' }, { id: 'weights', label: `FantasAI Weights for DK Lineup${weightsActive ? ' •' : ''}` }].map(t => (
              <button
                key={t.id}
                onClick={() => setActiveTab(t.id)}
                style={{
                  padding: '6px 14px', borderRadius: 6, fontSize: 12, fontWeight: activeTab === t.id ? 700 : 500,
                  cursor: 'pointer', border: 'none', whiteSpace: 'nowrap',
                  background: activeTab === t.id ? 'var(--accent)' : 'transparent',
                  color: activeTab === t.id ? 'var(--accent-ink)' : 'var(--text-dim)',
                  transition: 'background .15s, color .15s',
                }}
              >{t.label}</button>
            ))}
          </div>
          {activeTab === 'optimizer' && (
            <button className="btn ghost sm" onClick={load} disabled={loading} style={{ flexShrink: 0 }}>
              {loading ? '⟳ Loading…' : '⟳ Refresh'}
            </button>
          )}
        </div>
      </div>

      {activeTab === 'weights' && (
        <DfsWeightsTab weights={dfsWeights} onChange={setDfsWeights} />
      )}

      {activeTab === 'optimizer' && (
        <>
          {error && (
            <div className="muted-card" style={{ borderLeft: '3px solid var(--danger)', fontSize: 13, color: 'var(--danger)' }}>
              {error}
            </div>
          )}

          {!loading && !error && salaries.length === 0 && (
            <div className="muted-card" style={{ fontSize: 13, color: 'var(--text-dim)' }}>
              No DraftKings salary data in R2 yet. Run <code>python local_processing/ingest/ingest_draftkings.py</code> on the local pipeline machine to populate it.
            </div>
          )}

          {optimized && (
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
              {[
                { label: 'Player Pool', value: poolForSlate.length, color: 'var(--accent-2)' },
                { label: 'Optimal Projection', value: optimized.feasible ? optimized.totalProjection : '—', color: '#4caf82' },
                { label: 'Salary Used', value: optimized.feasible ? money(optimized.totalSalary) : '—', color: '#4ea8ff' },
                { label: 'Salary Remaining', value: optimized.feasible ? money(optimized.remainingSalary) : '—', color: '#ffb547' },
              ].map(s => (
                <div key={s.label} style={{ padding: '8px 14px', background: `${s.color}10`, border: `1px solid ${s.color}30`, borderRadius: 8, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, minWidth: 100 }}>
                  <span style={{ fontSize: 18, fontWeight: 900, color: s.color, fontFamily: 'var(--font-mono)', lineHeight: 1 }}>{s.value}</span>
                  <span style={{ fontSize: 9, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '.05em' }}>{s.label}</span>
                </div>
              ))}
            </div>
          )}

          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: -8 }}>
            <span style={{ fontSize: 10, color: 'var(--text-faint)' }}>Drag ⠿ to reorder a box · drag ⤡ to resize it</span>
            <button className="btn ghost sm" onClick={resetDfsLayout} style={{ fontSize: 10 }}>Reset Layout</button>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(380px, 1fr))', gap: 20, alignItems: 'start' }}>
            <LayoutBox
              id="contest" order={boxOrder('contest')} span={boxSpan('contest')} height={boxHeight('contest')}
              collapsed={boxCollapsed('contest')} onToggleCollapse={toggleBoxCollapsed}
              dragging={draggingBoxId} dragOver={dragOverBoxId}
              onDragStart={setDraggingBoxId} onDragOver={setDragOverBoxId} onDrop={moveBoxTo}
              onDragEnd={() => { setDraggingBoxId(null); setDragOverBoxId(null); }}
              onResizeStart={handleBoxResizeStart}
            >
              {(contests.length > 0 || liveContests !== null) ? (
                <ContestPicker
                  contests={contests}
                  selectedContestId={selectedContestId}
                  onSelect={selectContest}
                  onRefresh={refreshContestsLive}
                  refreshing={contestsRefreshing}
                  refreshError={contestsRefreshError}
                  onPullDetails={pullContestDetailsLive}
                  pullingDetails={pullingDetails}
                  pulledGames={pulledGames}
                />
              ) : slates.length > 1 && (
                <div className="muted-card" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-faint)', textTransform: 'uppercase' }}>Slate</span>
                  <select
                    value={draftGroupId ?? ''}
                    onChange={e => setDraftGroupId(Number(e.target.value))}
                    style={{ flex: 1, padding: '6px 10px', borderRadius: 6, background: 'var(--bg-2)', border: '1px solid var(--border)', color: 'var(--text)' }}
                  >
                    {slates.map(s => (
                      <option key={s.draft_group_id} value={s.draft_group_id}>
                        {s.slate_name || `Draft Group ${s.draft_group_id}`} ({s.game_count} games)
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </LayoutBox>

            {selectedContestId != null && (
              <LayoutBox
                id="contestDetails" order={boxOrder('contestDetails')} span={boxSpan('contestDetails')} height={boxHeight('contestDetails')}
                collapsed={boxCollapsed('contestDetails')} onToggleCollapse={toggleBoxCollapsed}
                dragging={draggingBoxId} dragOver={dragOverBoxId}
                onDragStart={setDraggingBoxId} onDragOver={setDragOverBoxId} onDrop={moveBoxTo}
                onDragEnd={() => { setDraggingBoxId(null); setDragOverBoxId(null); }}
                onResizeStart={handleBoxResizeStart}
              >
                <ContestDetailsPanel
                  detail={contestDetail}
                  loading={contestDetailLoading}
                  error={contestDetailError}
                  showScoringRules={showScoringRules}
                  onToggleScoringRules={() => setShowScoringRules(s => !s)}
                />
              </LayoutBox>
            )}

            {optimized && (
              <>
              <LayoutBox
                id="weightedLineups" order={boxOrder('weightedLineups')} span={boxSpan('weightedLineups')} height={boxHeight('weightedLineups')}
                collapsed={boxCollapsed('weightedLineups')} onToggleCollapse={toggleBoxCollapsed}
                dragging={draggingBoxId} dragOver={dragOverBoxId}
                onDragStart={setDraggingBoxId} onDragOver={setDragOverBoxId} onDrop={moveBoxTo}
                onDragEnd={() => { setDraggingBoxId(null); setDragOverBoxId(null); }}
                onResizeStart={handleBoxResizeStart}
              >
              <div className="card">
                <div className="card-head">
                  <span className="card-title">FantasAI Weighted Lineups for DK</span>
                  {weightsActive
                    ? <span style={{ fontSize: 10, color: '#4caf82', fontWeight: 700 }}>Using your DFS Weights</span>
                    : <span style={{ fontSize: 10, color: 'var(--text-faint)' }}>DFS Weights are default — same as DK's own ranking</span>}
                </div>
                <div className="card-body">
                  <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap', marginBottom: 16 }}>
                    <div style={{ fontSize: 12, color: 'var(--text-dim)', lineHeight: 1.6, flex: 1, minWidth: 260 }}>
                      Generates 3 lineups from the current player pool: <b>Optimal Lineup</b> (pure projected points), <b>Non-Chalk</b> (points discounted by season-long roster ownership — a popularity proxy, not a DK-specific ownership projection, which DraftKings doesn't publish), and <b>Best Ceiling</b> (real 90th-percentile game-log outcome). Each differs from the others by at least 2 players.
                    </div>
                    <button className="btn primary" onClick={generateWeightedLineups} disabled={generatingLineups || poolForSlate.length === 0}>
                      {generatingLineups ? '⟳ Generating…' : 'Generate 3 Lineups'}
                    </button>
                  </div>
                  {!weightsActive && (
                    <div style={{ fontSize: 10, color: 'var(--text-faint)', marginBottom: 12 }}>
                      Tip: tune the DFS Weights tab first so these lineups reflect your own signals too, not just DK's raw projection.
                    </div>
                  )}
                  <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
                    {weightedLineups === null && !generatingLineups && (
                      <div style={{ fontSize: 12, color: 'var(--text-faint)' }}>No lineups generated yet.</div>
                    )}
                    {weightedLineups?.map((result, i) => result.feasible && (
                      <div key={i} style={{ flex: '1 1 260px', minWidth: 260 }}>
                        <WeightedLineupCard strategy={LINEUP_STRATEGY_SEQUENCE[i]} result={result} />
                      </div>
                    ))}
                    {weightedLineups && weightedLineups.filter(r => r.feasible).length === 0 && (
                      <div style={{ fontSize: 12, color: 'var(--danger)' }}>{weightedLineups[0]?.reason || 'No valid lineup found.'}</div>
                    )}
                  </div>
                  {weightedLineups && weightedLineups.filter(r => r.feasible).length > 0 && weightedLineups.filter(r => r.feasible).length < 3 && (
                    <div style={{ fontSize: 11, color: 'var(--text-faint)', marginTop: 10 }}>
                      Only {weightedLineups.filter(r => r.feasible).length} sufficiently different lineup{weightedLineups.filter(r => r.feasible).length === 1 ? '' : 's'} available from this pool under the current locks/exclusions.
                    </div>
                  )}
                </div>
              </div>
              </LayoutBox>

              <LayoutBox
                id="selectPlayers" order={boxOrder('selectPlayers')} span={boxSpan('selectPlayers')} height={boxHeight('selectPlayers')}
                collapsed={boxCollapsed('selectPlayers')} onToggleCollapse={toggleBoxCollapsed}
                dragging={draggingBoxId} dragOver={dragOverBoxId}
                onDragStart={setDraggingBoxId} onDragOver={setDragOverBoxId} onDrop={moveBoxTo}
                onDragEnd={() => { setDraggingBoxId(null); setDragOverBoxId(null); }}
                onResizeStart={handleBoxResizeStart}
              >
              <div className="card">
                <div className="card-head" style={{ position: 'relative' }}>
                  <span className="card-title">Select Players for This Contest ({poolForSlate.length}{poolGameCount > 0 ? ` across ${poolGameCount} game${poolGameCount === 1 ? '' : 's'}` : ''})</span>
                  <span style={{ fontSize: 10, color: 'var(--text-faint)' }}>Lock forces inclusion · Exclude removes from consideration · the optimizer fills every other slot around your picks</span>
                  <button className="btn ghost sm" onClick={() => setShowColumnPicker(s => !s)} style={{ fontSize: 10, marginLeft: 'auto' }}>
                    ⚙ Columns
                  </button>
                  {showColumnPicker && (
                    <div style={{ position: 'absolute', top: '100%', right: 0, zIndex: 20, marginTop: 4, width: 220, maxHeight: 320, overflowY: 'auto', background: 'var(--panel)', border: '1px solid var(--border-strong)', borderRadius: 8, padding: 10, boxShadow: '0 8px 24px rgba(0,0,0,.35)' }}>
                      <div style={{ fontSize: 10, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '.05em', color: 'var(--text-faint)', marginBottom: 6 }}>Show Columns</div>
                      {poolColumns.map(col => (
                        <label key={col.id} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, padding: '3px 4px', cursor: 'pointer' }}>
                          <input type="checkbox" checked={col.visible} onChange={() => togglePoolColumn(col.id)} />
                          {col.label}
                        </label>
                      ))}
                      <button className="btn ghost sm" style={{ width: '100%', marginTop: 8, fontSize: 11 }} onClick={resetPoolColumns}>Reset to Default</button>
                    </div>
                  )}
                </div>
                {(poolLiveLoading || pullingDetails) && (
                  <div style={{ padding: '8px 16px', fontSize: 12, color: 'var(--text-faint)', borderBottom: '1px solid var(--border)' }}>
                    {pullingDetails ? '⟳ Pulling games and player pool live from DraftKings…' : "⟳ This contest isn't in the cached snapshot yet — pulling its player pool live from DraftKings…"}
                  </div>
                )}
                {poolLiveError && (
                  <div style={{ padding: '8px 16px', fontSize: 12, color: 'var(--danger)', borderBottom: '1px solid var(--border)' }}>{poolLiveError}</div>
                )}
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', padding: '10px 16px', borderBottom: '1px solid var(--border)' }}>
                  <div style={{ display: 'flex', gap: 0, background: 'var(--panel)', borderRadius: 8, padding: 3 }}>
                    {['ALL', 'QB', 'RB', 'WR', 'TE', 'DST'].map(pos => (
                      <button
                        key={pos}
                        onClick={() => setPoolPosFilter(pos)}
                        style={{
                          padding: '4px 10px', borderRadius: 6, fontSize: 11, fontWeight: poolPosFilter === pos ? 700 : 500,
                          cursor: 'pointer', border: 'none',
                          background: poolPosFilter === pos ? 'var(--accent)' : 'transparent',
                          color: poolPosFilter === pos ? 'var(--accent-ink)' : 'var(--text-dim)',
                        }}
                      >{pos}</button>
                    ))}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: 'var(--text-faint)' }}>
                    Salary
                    <input
                      type="number" placeholder="min" value={poolSalaryMin}
                      onChange={e => setPoolSalaryMin(e.target.value)}
                      style={{ width: 70, padding: '3px 6px', borderRadius: 4, background: 'var(--bg-2)', border: '1px solid var(--border)', color: 'var(--text)' }}
                    />
                    –
                    <input
                      type="number" placeholder="max" value={poolSalaryMax}
                      onChange={e => setPoolSalaryMax(e.target.value)}
                      style={{ width: 70, padding: '3px 6px', borderRadius: 4, background: 'var(--bg-2)', border: '1px solid var(--border)', color: 'var(--text)' }}
                    />
                  </div>
                  {(poolPosFilter !== 'ALL' || poolSalaryMin !== '' || poolSalaryMax !== '') && (
                    <button className="btn ghost sm" style={{ fontSize: 10 }} onClick={() => { setPoolPosFilter('ALL'); setPoolSalaryMin(''); setPoolSalaryMax(''); }}>
                      Clear Filters
                    </button>
                  )}
                  <span style={{ fontSize: 10, color: 'var(--text-faint)', marginLeft: 'auto' }}>
                    Showing {filteredPool.length} of {poolForSlate.length}
                  </span>
                </div>
                <div className="card-body" style={{ padding: 0, maxHeight: 420, overflowY: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                    <thead style={{ position: 'sticky', top: 0, background: 'var(--panel)' }}>
                      <tr style={{ borderBottom: '1px solid var(--border)' }}>
                        {['Pos', 'Player', 'Team'].map(h => (
                          <th key={h} style={{ textAlign: h === 'Player' ? 'left' : 'right', padding: '6px 10px', fontSize: 9, color: 'var(--text-faint)', textTransform: 'uppercase' }}>{h}</th>
                        ))}
                        {visiblePoolColumns.map(col => (
                          <th key={col.id} style={{ textAlign: 'right', padding: '6px 10px', fontSize: 9, color: 'var(--text-faint)', textTransform: 'uppercase' }}>{col.label}</th>
                        ))}
                        {['Salary', weightsActive ? 'Weighted Proj' : 'DK Avg', 'Lock', 'Exclude'].map(h => (
                          <th key={h} style={{ textAlign: 'right', padding: '6px 10px', fontSize: 9, color: 'var(--text-faint)', textTransform: 'uppercase' }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {filteredPool.map(p => {
                        const locked = lockIds.has(p.id);
                        const excluded = excludeIds.has(p.id);
                        const row = poolRowEnrichment.get(p.id);
                        return (
                          <tr key={p.id} style={{ borderBottom: '1px solid var(--border)', opacity: excluded ? 0.4 : 1 }}>
                            <td style={{ padding: '5px 10px', fontWeight: 800, color: POS_COLORS[p.position] || 'var(--text)' }}>{p.position}</td>
                            <td style={{ padding: '5px 10px', fontWeight: 600 }}>{p.name}</td>
                            <td style={{ padding: '5px 10px', textAlign: 'right', fontFamily: 'var(--font-mono)' }}>{p.team}</td>
                            {visiblePoolColumns.map(col => {
                              if (col.id === 'opp') {
                                return (
                                  <td key={col.id} style={{ padding: '5px 10px', textAlign: 'right', fontFamily: 'var(--font-mono)', color: 'var(--text-dim)' }}>
                                    {p.opponent ? `${p.isHome ? 'vs' : '@'} ${p.opponent}` : '—'}
                                  </td>
                                );
                              }
                              const val = formatPoolColumnValue(col.id, row);
                              const isObj = val && typeof val === 'object';
                              return (
                                <td key={col.id} style={{ padding: '5px 10px', textAlign: 'right', fontFamily: 'var(--font-mono)', color: isObj ? val.color : 'var(--text-dim)' }}>
                                  {isObj ? val.text : val}
                                </td>
                              );
                            })}
                            <td style={{ padding: '5px 10px', textAlign: 'right', fontFamily: 'var(--font-mono)' }}>{money(p.salary)}</td>
                            <td style={{ padding: '5px 10px', textAlign: 'right', fontFamily: 'var(--font-mono)' }} title={weightsActive ? `DK Avg: ${p.dkRawProjection?.toFixed(1) ?? '—'}` : undefined}>
                              {p.projection?.toFixed(1) ?? '—'}
                            </td>
                            <td style={{ padding: '5px 10px', textAlign: 'right' }}>
                              <button
                                className="btn ghost sm"
                                style={{ padding: '2px 8px', fontSize: 10, color: locked ? '#4caf82' : 'var(--text-faint)', borderColor: locked ? '#4caf8250' : undefined }}
                                onClick={() => { toggleSet(setLockIds, p.id); if (excluded) toggleSet(setExcludeIds, p.id); }}
                              >
                                {locked ? '✓ Locked' : 'Lock'}
                              </button>
                            </td>
                            <td style={{ padding: '5px 10px', textAlign: 'right' }}>
                              <button
                                className="btn ghost sm"
                                style={{ padding: '2px 8px', fontSize: 10, color: excluded ? 'var(--danger)' : 'var(--text-faint)', borderColor: excluded ? 'rgba(255,90,110,.4)' : undefined }}
                                onClick={() => { toggleSet(setExcludeIds, p.id); if (locked) toggleSet(setLockIds, p.id); }}
                              >
                                {excluded ? '✕ Excluded' : 'Exclude'}
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
              </LayoutBox>

              <LayoutBox
                id="aiAnalysis" order={boxOrder('aiAnalysis')} span={boxSpan('aiAnalysis')} height={boxHeight('aiAnalysis')}
                collapsed={boxCollapsed('aiAnalysis')} onToggleCollapse={toggleBoxCollapsed}
                dragging={draggingBoxId} dragOver={dragOverBoxId}
                onDragStart={setDraggingBoxId} onDragOver={setDragOverBoxId} onDrop={moveBoxTo}
                onDragEnd={() => { setDraggingBoxId(null); setDragOverBoxId(null); }}
                onResizeStart={handleBoxResizeStart}
              >
              <div className="card">
                <div className="card-head">
                  <span className="card-title">AI Lineup Analysis</span>
                  <button className="btn ghost sm" onClick={() => setShowAnalysisSettings(s => !s)} style={{ fontSize: 10 }}>
                    {showAnalysisSettings ? 'Hide Settings' : 'What should the AI analyze?'}
                  </button>
                </div>
                <div className="card-body">
                  {showAnalysisSettings && (
                    <div style={{ marginBottom: 16, padding: 12, background: 'var(--panel-2)', borderRadius: 8, border: '1px solid var(--border)' }}>
                      <div style={{ fontSize: 10, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '.05em', color: 'var(--text-faint)', marginBottom: 8 }}>Contest Type</div>
                      <div style={{ display: 'flex', gap: 0, background: 'var(--panel)', borderRadius: 8, padding: 3, width: 'fit-content', marginBottom: 14 }}>
                        {[{ id: 'gpp', label: 'GPP / Tournament' }, { id: 'cash', label: 'Cash Game' }].map(c => (
                          <button
                            key={c.id}
                            onClick={() => setAnalysisSettings(prev => ({ ...prev, contestType: c.id }))}
                            style={{
                              padding: '5px 12px', borderRadius: 6, fontSize: 11, fontWeight: analysisSettings.contestType === c.id ? 700 : 500,
                              cursor: 'pointer', border: 'none',
                              background: analysisSettings.contestType === c.id ? 'var(--accent)' : 'transparent',
                              color: analysisSettings.contestType === c.id ? 'var(--accent-ink)' : 'var(--text-dim)',
                            }}
                          >{c.label}</button>
                        ))}
                      </div>
                      <div style={{ fontSize: 10, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '.05em', color: 'var(--text-faint)', marginBottom: 6 }}>Your Expectations (optional)</div>
                      <textarea
                        value={analysisSettings.userExpectations}
                        onChange={e => setAnalysisSettings(prev => ({ ...prev, userExpectations: e.target.value }))}
                        placeholder="e.g. I want a safe lineup for a 50-50, avoid rookies, I'm fine paying up at RB but want cheap WRs..."
                        rows={2}
                        style={{ width: '100%', resize: 'vertical', padding: '8px 10px', borderRadius: 6, background: 'var(--bg-2)', border: '1px solid var(--border)', color: 'var(--text)', fontSize: 12, fontFamily: 'inherit', marginBottom: 14 }}
                      />
                      <div style={{ fontSize: 10, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '.05em', color: 'var(--text-faint)', marginBottom: 8 }}>What the AI Should Analyze</div>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginBottom: 12 }}>
                        {DFS_ANALYSIS_METRICS.map(m => (
                          <label key={m.key} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, cursor: 'pointer' }}>
                            <input
                              type="checkbox"
                              checked={analysisSettings.enabled[m.key] !== false}
                              onChange={e => setAnalysisSettings(prev => ({ ...prev, enabled: { ...prev.enabled, [m.key]: e.target.checked } }))}
                            />
                            {m.label}
                          </label>
                        ))}
                      </div>
                      <div style={{ fontSize: 10, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '.05em', color: 'var(--text-faint)', marginBottom: 8 }}>Per-Player FantasAI Data to Include</div>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginBottom: 12 }}>
                        {PLAYER_CONTEXT_SOURCES.map(s => (
                          <label key={s.key} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, cursor: 'pointer' }}>
                            <input
                              type="checkbox"
                              checked={analysisSettings.playerContextEnabled[s.key] !== false}
                              onChange={e => setAnalysisSettings(prev => ({ ...prev, playerContextEnabled: { ...prev.playerContextEnabled, [s.key]: e.target.checked } }))}
                            />
                            {s.label}
                          </label>
                        ))}
                      </div>
                      <div style={{ fontSize: 10, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '.05em', color: 'var(--text-faint)', marginBottom: 8 }}>Weather Risk Thresholds (wind speed)</div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 12, flexWrap: 'wrap' }}>
                        <span>Low: 0–</span>
                        <input
                          type="number" min={1} max={40}
                          value={analysisSettings.weatherThresholds.lowMaxMph}
                          onChange={e => setAnalysisSettings(prev => ({ ...prev, weatherThresholds: { ...prev.weatherThresholds, lowMaxMph: Number(e.target.value) } }))}
                          style={{ width: 50, padding: '3px 6px', borderRadius: 4, background: 'var(--bg-2)', border: '1px solid var(--border)', color: 'var(--text)' }}
                        />
                        <span>mph &nbsp;·&nbsp; Medium: up to</span>
                        <input
                          type="number" min={1} max={50}
                          value={analysisSettings.weatherThresholds.medMaxMph}
                          onChange={e => setAnalysisSettings(prev => ({ ...prev, weatherThresholds: { ...prev.weatherThresholds, medMaxMph: Number(e.target.value) } }))}
                          style={{ width: 50, padding: '3px 6px', borderRadius: 4, background: 'var(--bg-2)', border: '1px solid var(--border)', color: 'var(--text)' }}
                        />
                        <span>mph &nbsp;·&nbsp; High: above that</span>
                      </div>
                      <div style={{ display: 'flex', gap: 10, marginTop: 12 }}>
                        <button className="btn primary sm" onClick={handleSaveAnalysisSettings}>Save Settings</button>
                        <button className="btn ghost sm" onClick={handleResetAnalysisSettings}>Reset to Defaults</button>
                      </div>
                    </div>
                  )}

                  <button className="btn primary" onClick={runAnalysis} disabled={analyzing || !optimized?.feasible}>
                    {analyzing ? '⟳ Analyzing…' : 'Analyze Lineup'}
                  </button>

                  {analysisError && <div style={{ marginTop: 12, fontSize: 12, color: 'var(--danger)' }}>Error: {analysisError}</div>}

                  {analysisResult && analysisMetrics && (
                    <div style={{ marginTop: 16 }}>
                      {(() => {
                        const fcMatch = analysisMetrics.ceiling.display.match(/\((\d+)\/(\d+) players covered\)/);
                        const fcCovered = fcMatch ? Number(fcMatch[1]) : null;
                        const fcTotal = fcMatch ? Number(fcMatch[2]) : null;
                        const partial = fcCovered != null && fcCovered < fcTotal;
                        const tiles = [
                          { label: 'Projection', display: analysisMetrics.projPoints.display, color: '#4caf82' },
                          { label: `Ceiling${partial ? ` (${fcCovered}/${fcTotal})` : ''}`, display: analysisMetrics.ceiling.display.split(' (')[0], color: '#a78bfa' },
                          { label: `Floor${partial ? ` (${fcCovered}/${fcTotal})` : ''}`, display: analysisMetrics.floor.display.split(' (')[0], color: '#4ea8ff' },
                          { label: 'Value', display: analysisMetrics.value.display, color: '#ffb547' },
                        ];
                        return (
                          <>
                            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: partial ? 8 : 16 }}>
                              {tiles.map(t => (
                                <div key={t.label} style={{ padding: '8px 14px', background: `${t.color}10`, border: `1px solid ${t.color}30`, borderRadius: 8, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, minWidth: 90 }}>
                                  <span style={{ fontSize: 16, fontWeight: 900, color: t.color, fontFamily: 'var(--font-mono)', lineHeight: 1 }}>{t.display}</span>
                                  <span style={{ fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.06em', color: 'var(--text-faint)' }}>{t.label}</span>
                                </div>
                              ))}
                            </div>
                            {partial && (
                              <div style={{ fontSize: 10, color: 'var(--text-faint)', marginBottom: 16, lineHeight: 1.5 }}>
                                Floor/Ceiling only include the {fcCovered} of {fcTotal} players with enough real game-log history to compute a percentile (DST and short-sample rookies are excluded, not assigned a guessed value) — Projection covers all {fcTotal}, so it can read higher than a partial Ceiling.
                              </div>
                            )}
                          </>
                        );
                      })()}

                      {analysisParsed ? (
                        <>
                          {(analysisParsed.strengths.length > 0 || analysisParsed.weaknesses.length > 0) && (
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 14 }}>
                              <div>
                                <div style={{ fontSize: 10, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '.06em', color: '#4caf82', marginBottom: 6 }}>Strengths</div>
                                {analysisParsed.strengths.map((s, i) => (
                                  <div key={i} style={{ display: 'flex', gap: 6, fontSize: 12, lineHeight: 1.5, marginBottom: 4 }}>
                                    <span style={{ color: '#4caf82', flexShrink: 0 }}>✓</span><span>{s}</span>
                                  </div>
                                ))}
                              </div>
                              <div>
                                <div style={{ fontSize: 10, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '.06em', color: '#ffb547', marginBottom: 6 }}>Weaknesses</div>
                                {analysisParsed.weaknesses.map((w, i) => (
                                  <div key={i} style={{ display: 'flex', gap: 6, fontSize: 12, lineHeight: 1.5, marginBottom: 4 }}>
                                    <span style={{ color: '#ffb547', flexShrink: 0 }}>⚠</span><span>{w}</span>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}
                          {analysisParsed.verdict && (
                            <div style={{ fontSize: 10, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '.06em', color: 'var(--text-faint)', marginBottom: 6 }}>AI Verdict</div>
                          )}
                          {analysisParsed.verdict && (
                            <div style={{ fontSize: 13, lineHeight: 1.65, fontStyle: 'italic', borderLeft: '3px solid var(--accent-2)', paddingLeft: 12 }}>
                              {analysisParsed.verdict}
                            </div>
                          )}
                        </>
                      ) : (
                        <div style={{ fontSize: 13, lineHeight: 1.65, whiteSpace: 'pre-wrap', borderLeft: '3px solid var(--accent-2)', paddingLeft: 12 }}>
                          {analysisResult}
                        </div>
                      )}
                    </div>
                  )}

                  {!analyzing && !analysisResult && !analysisError && (
                    <div style={{ marginTop: 10, fontSize: 11, color: 'var(--text-faint)' }}>
                      Computes real metrics for the lineup above (salary, value, QB stack, bring-back, Vegas total from Kalshi, injury/weather risk) and asks the model to critique it — strengths, weaknesses, and correlation risk. It reviews the lineup the optimizer already built; it doesn't pick players itself.
                    </div>
                  )}
                </div>
              </div>
              </LayoutBox>
            </>
          )}
          </div>

          {dataGeneratedAt && (
            <div style={{ fontSize: 10, color: 'var(--text-faint)' }}>
              DraftKings data generated {new Date(dataGeneratedAt).toLocaleString()}. Salaries and player pools update whenever the local pipeline reruns <code>ingest_draftkings.py</code> — not yet on an automatic schedule.
            </div>
          )}

          <PageLogicLegend />
        </>
      )}
    </div>
  );
}

// ─── Page Logic & Legend ─────────────────────────────────────────────────
// Plain-language explanation of every algorithm on this page — what each
// button actually computes, not just what it's labeled. Collapsed by
// default so it doesn't compete with the working area above it.
function PageLogicLegend() {
  const [open, setOpen] = React.useState(false);
  return (
    <div className="card">
      <div className="card-head">
        <span className="card-title">How This Page Works — Logic &amp; Legend</span>
        <button className="btn ghost sm" onClick={() => setOpen(o => !o)} style={{ fontSize: 10 }}>
          {open ? 'Hide' : 'Show'}
        </button>
      </div>
      {open && (
        <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 18, fontSize: 12, lineHeight: 1.7, color: 'var(--text-dim)' }}>

          <LegendSection title="Contests & Player Pool">
            The contest list comes from the local pipeline's DraftKings lobby ingest, cached in R2. <b>Refresh DK Contests</b> bypasses that cache and pulls the current lobby straight from DK. Only real, salary-cap Classic contests are kept — Snake-draft and non-Classic contest types are filtered out.
            <br /><br />
            Each contest maps to one DK "draft group." If a selected contest's player pool isn't in the cached snapshot (the local pipeline only pre-fetches the ~10 largest-field draft groups), it's fetched live from DK automatically — or on demand via <b>Pull Details</b>, which also refreshes an already-cached pool.
          </LegendSection>

          <LegendSection title="FantasAI Weights for DK Lineup">
            Per-position sliders (QB/RB/WR/TE/K/DST) rank each feature — DK Projection, Value, Opportunity Score, News Signal, Matchup, Ownership Leverage — as a percentile (0–100) against other players at the same position in this slate. Your weighted average of those percentiles is the "composite" score for a player.
            <br /><br />
            <code>adjusted projection = DK projection × (0.5 + composite / 100)</code>
            <br /><br />
            A player exactly average on your weighted criteria keeps DK's own number; dominating the field pushes toward 1.5×, being weak across the board pulls toward 0.5×. Default weights (100% DK Projection) are a guaranteed no-op — the optimizer sees DK's raw numbers until you move a slider.
          </LegendSection>

          <LegendSection title="Optimal Lineup (ILP Optimizer)">
            A true integer linear program (not a greedy or heuristic approximation), solved with <code>javascript-lp-solver</code>. Constraints: {money(DK_SALARY_CAP)} salary cap; exactly 1 QB; at least 2 RB; at least 3 WR; at least 1 TE; exactly 1 DST; exactly 9 players total (the 9th is necessarily the FLEX, since 1+2+3+1+1=8). Locked players are forced into the solution; excluded players are removed from the pool before solving even starts.
            <br /><br />
            DK's rule that a lineup must include players from at least {DK_SALARY_CAP_INFO.minGames} different games is enforced as a real constraint — no single game's players can fill more than 8 of the 9 roster spots — not just checked after the fact.
            <br /><br />
            Objective: maximize total projected points, using either DK's own consensus (AVG) or your FantasAI-weighted projection if DFS Weights are active.
          </LegendSection>

          <LegendSection title="FantasAI Weighted Lineups for DK (Optimal / Non-Chalk / Best Ceiling)">
            Solves the same ILP model 3 times against the same weight-adjusted pool, each with a different objective: <b>Optimal Lineup</b> maximizes real projected points (identical to what the old standalone "Optimal Lineup" card showed — it's been folded into this generator, not removed). <b>Non-Chalk</b> maximizes points discounted by season-long fantasy roster ownership — a real popularity/consensus signal, not an actual DK single-slate ownership projection (DraftKings doesn't publish those, so this is the closest real proxy available). <b>Best Ceiling</b> maximizes real 90th-percentile game-log outcomes instead of average projection.
            <br /><br />
            After each solve, it adds one new constraint per prior lineup: the next lineup may share at most 7 of its 9 players with that lineup — i.e., it must differ by at least 2 players — so Non-Chalk and Best Ceiling aren't just "the best lineup for that objective," they're the best lineup for that objective that's also meaningfully different from what came before.
            <br /><br />
            If the pool can't support that much diversity under the current cap/locks/exclusions (common on a small slate), generation stops early and shows however many distinct lineups it actually found. A player missing real ceiling or ownership data contributes 0 to that specific objective (not a guessed value) — it can still appear in the Optimal Lineup, just won't be favored by Non-Chalk/Best Ceiling without real data behind it.
          </LegendSection>

          <LegendSection title="Floor / Ceiling">
            Empirical, not simulated: each player's Floor is the 25th percentile and Ceiling the 90th percentile of their most recent up-to-24 real logged games (minimum 6 games required to compute at all). A lineup's Floor/Ceiling is the sum over only the players who have enough real history — DST is currently excluded entirely (no historical box-score table exists yet for team defense scoring).
            <br /><br />
            Because Projection sums <i>every</i> rostered player while Floor/Ceiling only sum the covered subset, Projection can legitimately read higher than Ceiling on a lineup with a DST or a short-sample rookie — the coverage count shown next to Floor/Ceiling (e.g. "7/9") is what to check, not treat as a bug.
          </LegendSection>

          <LegendSection title="AI Lineup Analysis">
            A critic, not a generator — it evaluates the lineup the optimizer already built and is explicitly instructed not to suggest a different one. The prompt combines real lineup-level metrics (salary, value, floor/ceiling, QB stack, bring-back, Vegas game total via Kalshi, injury risk, weather risk — each toggleable) with optional per-player FantasAI data (your own projections/tier/ADP, usage, advanced/NextGen-style metrics, opponent matchup rank, O-line quality, weapon score, recent news — also each toggleable).
            <br /><br />
            Contest Type (GPP vs Cash) changes how the model is told to weigh the <i>same</i> data — ceiling/differentiation for GPP, floor/consistency for cash — it doesn't change what data is sent. The response is parsed into Strengths / Weaknesses / Verdict sections when the model follows the requested format; otherwise the raw text is shown as a fallback.
          </LegendSection>

          <LegendSection title="Player Pool Columns">
            Every toggleable column in the "Select Players" table traces to a real source: FantasAI's own player store (ADP, Rank, Tier, season averages, trend, snap share, target/carry usage, routes/YAC/aDOT/air yards, combine measurables), the defense-vs-position matchup rank, the live weather forecast, and DFS ownership projections. A column shows "—" rather than a guessed number when that data doesn't exist for a given player — nothing here is estimated.
          </LegendSection>

          <div style={{ fontSize: 10, color: 'var(--text-faint)', borderTop: '1px solid var(--border)', paddingTop: 10 }}>
            If a number on this page looks wrong, this section is the place to check first — most "bugs" turn out to be a real, documented boundary (a partial Floor/Ceiling sum, a pool that hasn't been live-fetched yet, default weights being a no-op) rather than a calculation error.
          </div>
        </div>
      )}
    </div>
  );
}

function LegendSection({ title, children }) {
  return (
    <div>
      <div style={{ fontSize: 11, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '.05em', color: 'var(--text)', marginBottom: 6 }}>{title}</div>
      <div>{children}</div>
    </div>
  );
}

// ─── DFS-Weighted Lineup mini card ───────────────────────────────────────
const LINEUP_STRATEGY_META = {
  projection:   { label: 'Optimal Lineup', color: '#4caf82', hint: 'Maximizes projected points — no ownership or ceiling adjustment.' },
  leverageScore: { label: 'Non-Chalk', color: '#c084fc', hint: "Maximizes points discounted by season-long fantasy roster ownership — a real popularity/consensus signal, but not an actual DK single-slate ownership projection (DraftKings doesn't publish those)." },
  ceiling:      { label: 'Best Ceiling', color: '#a78bfa', hint: "Maximizes each player's real 90th-percentile game-log outcome, not average projection." },
};

function WeightedLineupCard({ strategy, result }) {
  const meta = LINEUP_STRATEGY_META[strategy] || LINEUP_STRATEGY_META.projection;
  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
      <div style={{ padding: '6px 10px', background: 'var(--panel-2)', borderBottom: '1px solid var(--border)' }} title={meta.hint}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: 11, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '.05em', color: meta.color }}>{meta.label}</span>
          <span style={{ fontSize: 11, fontFamily: 'var(--font-mono)', fontWeight: 700, color: '#4caf82' }}>{result.totalProjection.toFixed(1)} pts</span>
        </div>
        {strategy === 'ceiling' && (
          <div style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--text-faint)', marginTop: 2 }}>
            {result.totalCeiling != null ? `Ceiling ${result.totalCeiling.toFixed(1)} (${result.ceilingCoverage}/9 covered)` : 'Ceiling: no real game-log data for this lineup'}
          </div>
        )}
        {strategy === 'leverageScore' && (
          <div style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--text-faint)', marginTop: 2 }}>
            {result.avgOwnership != null ? `Avg roster% ${result.avgOwnership.toFixed(1)}% (${result.ownershipCoverage}/9 covered)` : 'Roster%: no data for this lineup'}
          </div>
        )}
      </div>
      <div>
        {result.lineup.map(({ slot, player }) => (
          <div key={`${slot}-${player.id}`} style={{ display: 'flex', justifyContent: 'space-between', gap: 6, padding: '3px 10px', fontSize: 11, borderBottom: '1px solid var(--border)' }}>
            <span style={{ display: 'flex', gap: 6, minWidth: 0 }}>
              <span style={{ fontWeight: 800, color: POS_COLORS[player.position] || 'var(--text)', flexShrink: 0, width: 30 }}>{slot}</span>
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{player.name}</span>
            </span>
            <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-faint)', flexShrink: 0 }}>{money(player.salary)}</span>
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', padding: '5px 10px', fontSize: 11, fontWeight: 800, background: 'var(--panel-2)' }}>
        <span style={{ color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '.05em' }}>Salary</span>
        <span style={{ fontFamily: 'var(--font-mono)' }}>{money(result.totalSalary)}</span>
      </div>
    </div>
  );
}

// ─── Contest Details & Rules ─────────────────────────────────────────────
// Live per-contest data (prize payouts, entries, contest blurb) pulled from
// DK's own contest-detail endpoint via the worker-api CORS proxy — see
// dkContestDetails.js. Scoring/lineup/salary-cap are shown alongside it but
// are a static reference, not fetched — DK doesn't expose them as JSON and
// they're constant across every real (non-simulated) Classic NFL contest.
function ContestDetailsPanel({ detail, loading, error, showScoringRules, onToggleScoringRules }) {
  return (
    <div className="card">
      <div className="card-head">
        <span className="card-title">Contest Details &amp; Rules</span>
        <button className="btn ghost sm" onClick={onToggleScoringRules} style={{ fontSize: 10 }}>
          {showScoringRules ? 'Hide Scoring Rules' : 'Show Scoring Rules'}
        </button>
      </div>
      <div className="card-body">
        {loading && <div style={{ fontSize: 12, color: 'var(--text-faint)' }}>Loading contest details from DraftKings…</div>}
        {error && <div style={{ fontSize: 12, color: 'var(--danger)' }}>Could not load live contest details: {error}</div>}

        {detail && (
          <div style={{ marginBottom: 16 }}>
            {detail.summary && (
              <div style={{ fontSize: 12, color: 'var(--text-dim)', lineHeight: 1.6, marginBottom: 12, fontStyle: 'italic' }}>{detail.summary}</div>
            )}
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 14 }}>
              {[
                { label: 'Entry Fee', value: detail.entryFee ? `$${detail.entryFee}` : 'Free', color: '#4ea8ff' },
                { label: 'Total Prizes', value: money(detail.totalPayouts), color: '#4caf82' },
                { label: 'Entries', value: `${(detail.entries ?? 0).toLocaleString()} / ${(detail.maxEntries ?? 0).toLocaleString()}`, color: 'var(--accent-2)' },
                { label: 'Positions Paid', value: (detail.payoutPositionsPaid || 0).toLocaleString(), color: '#ffb547' },
                { label: 'Max Entries/User', value: detail.maxEntriesPerUser ?? '—', color: 'var(--text-dim)' },
              ].map(s => (
                <div key={s.label} style={{ padding: '8px 14px', background: `${s.color}10`, border: `1px solid ${s.color}30`, borderRadius: 8, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, minWidth: 90 }}>
                  <span style={{ fontSize: 14, fontWeight: 900, color: s.color, fontFamily: 'var(--font-mono)', lineHeight: 1 }}>{s.value}</span>
                  <span style={{ fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.06em', color: 'var(--text-faint)' }}>{s.label}</span>
                </div>
              ))}
            </div>

            {detail.payoutTiers?.length > 0 && (
              <div style={{ maxHeight: 200, overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 8 }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                  <thead style={{ position: 'sticky', top: 0, background: 'var(--panel-2)' }}>
                    <tr>
                      <th style={{ textAlign: 'left', padding: '5px 10px' }}>Place</th>
                      <th style={{ textAlign: 'right', padding: '5px 10px' }}>Payout</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detail.payoutTiers.map((t, i) => (
                      <tr key={i} style={{ borderTop: '1px solid var(--border)' }}>
                        <td style={{ padding: '4px 10px' }}>{t.label}</td>
                        <td style={{ padding: '4px 10px', textAlign: 'right', fontFamily: 'var(--font-mono)', color: '#4caf82', fontWeight: 700 }}>{t.amount}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {showScoringRules && (
          <div style={{ borderTop: '1px solid var(--border)', paddingTop: 14 }}>
            <div style={{ fontSize: 10, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '.06em', color: 'var(--text-faint)', marginBottom: 8 }}>
              DraftKings Standard Classic NFL Rules — same across every real Classic contest (verified against DK's own rules page)
            </div>
            <div style={{ fontSize: 12, marginBottom: 10 }}>
              <strong>Salary Cap:</strong> {money(DK_SALARY_CAP_INFO.cap)} &nbsp;·&nbsp; <strong>Roster:</strong> {DK_LINEUP_SLOTS.map(s => `${s.count} ${s.slot}${s.note ? ` (${s.note})` : ''}`).join(', ')} &nbsp;·&nbsp; players from at least {DK_SALARY_CAP_INFO.minGames} different games
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
              <div>
                <div style={{ fontSize: 11, fontWeight: 800, color: 'var(--text-dim)', marginBottom: 6 }}>Offense</div>
                {DK_STANDARD_SCORING.offense.map(r => (
                  <div key={r.stat} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, padding: '2px 0', borderBottom: '1px solid var(--border)' }}>
                    <span style={{ color: 'var(--text-dim)' }}>{r.stat}</span>
                    <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 700 }}>{r.pts}</span>
                  </div>
                ))}
              </div>
              <div>
                <div style={{ fontSize: 11, fontWeight: 800, color: 'var(--text-dim)', marginBottom: 6 }}>Defense / Special Teams</div>
                {DK_STANDARD_SCORING.defense.map(r => (
                  <div key={r.stat} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, padding: '2px 0', borderBottom: '1px solid var(--border)' }}>
                    <span style={{ color: 'var(--text-dim)' }}>{r.stat}</span>
                    <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 700 }}>{r.pts}</span>
                  </div>
                ))}
                <div style={{ fontSize: 11, fontWeight: 800, color: 'var(--text-dim)', margin: '10px 0 6px' }}>Points Allowed</div>
                {DK_STANDARD_SCORING.pointsAllowed.map(r => (
                  <div key={r.range} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, padding: '2px 0', borderBottom: '1px solid var(--border)' }}>
                    <span style={{ color: 'var(--text-dim)' }}>{r.range}</span>
                    <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 700 }}>{r.pts}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Contest Picker ──────────────────────────────────────────────────────
// Browses every open Classic NFL contest from the DK lobby (fantasai/betting/
// dk_contests.json — see ingest_draftkings.py) so the user can pick a
// specific contest (entry fee, prize pool, field size) rather than just a
// slate. Selecting a contest sets draftGroupId, which drives the player pool
// exactly like the old Slate dropdown did.
function ContestPicker({ contests, selectedContestId, onSelect, onRefresh, refreshing, refreshError, onPullDetails, pullingDetails, pulledGames }) {
  const [search, setSearch] = React.useState('');
  const [sortBy, setSortBy] = React.useState('prize');

  const filtered = React.useMemo(() => {
    const q = search.trim().toLowerCase();
    let list = q ? contests.filter(c => (c.name || '').toLowerCase().includes(q)) : contests;
    list = [...list].sort((a, b) => {
      if (sortBy === 'fee') return (a.entry_fee ?? 0) - (b.entry_fee ?? 0);
      if (sortBy === 'start') return new Date(a.start_time || 0) - new Date(b.start_time || 0);
      return (b.total_prize || 0) - (a.total_prize || 0); // 'prize'
    });
    return list.slice(0, 60);
  }, [contests, search, sortBy]);

  const selected = contests.find(c => c.contest_id === selectedContestId);

  return (
    <div className="card">
      <div className="card-head">
        <span className="card-title">Contest</span>
        <div style={{ display: 'flex', gap: 8, marginLeft: 'auto' }}>
          <button className="btn ghost sm" onClick={onPullDetails} disabled={pullingDetails || !selected} style={{ fontSize: 10 }} title="Pull the games and player pool for the selected contest live from DraftKings">
            {pullingDetails ? '⟳ Pulling…' : 'Pull Details'}
          </button>
          <button className="btn ghost sm" onClick={onRefresh} disabled={refreshing} style={{ fontSize: 10 }} title="Pull the current contest list straight from DraftKings, bypassing the cached snapshot">
            {refreshing ? '⟳ Refreshing…' : 'Refresh DK Contests'}
          </button>
        </div>
      </div>
      {refreshError && (
        <div style={{ padding: '6px 16px', fontSize: 11, color: 'var(--danger)', borderBottom: '1px solid var(--border)' }}>{refreshError}</div>
      )}
      {selected && (
        <div style={{ padding: '12px 16px 0', textAlign: 'right' }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '.06em' }}>Contest Selected</div>
          <div style={{ fontSize: 20, fontWeight: 900, color: '#4ea8ff', lineHeight: 1.3 }}>{selected.name}</div>
          <div style={{ fontSize: 11, color: 'var(--text-faint)', fontFamily: 'var(--font-mono)', marginTop: 2 }}>
            {selected.entry_fee ? `$${selected.entry_fee}` : 'Free'} entry · {selected.payout_summary || money(selected.total_prize)} prize
          </div>
          {pulledGames?.length > 0 && (
            <>
              <div style={{ fontSize: 13, fontWeight: 800, color: 'var(--text)', marginTop: 8 }}>
                {pulledGames.length} game{pulledGames.length === 1 ? '' : 's'} in this contest
              </div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end', marginTop: 6 }}>
                {pulledGames.map(g => (
                  <span key={g} style={{ fontSize: 11, fontFamily: 'var(--font-mono)', fontWeight: 700, padding: '3px 8px', borderRadius: 6, background: '#4ea8ff15', border: '1px solid #4ea8ff40', color: '#4ea8ff' }}>{g}</span>
                ))}
              </div>
            </>
          )}
        </div>
      )}
      <div className="card-body">
        <div style={{ display: 'flex', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
          <input
            type="text"
            placeholder="Search contests…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            style={{ flex: 1, minWidth: 180, padding: '6px 10px', borderRadius: 6, background: 'var(--bg-2)', border: '1px solid var(--border)', color: 'var(--text)', fontSize: 12 }}
          />
          <select
            value={sortBy}
            onChange={e => setSortBy(e.target.value)}
            style={{ padding: '6px 10px', borderRadius: 6, background: 'var(--bg-2)', border: '1px solid var(--border)', color: 'var(--text)', fontSize: 12 }}
          >
            <option value="prize">Sort: Prize Pool</option>
            <option value="fee">Sort: Entry Fee</option>
            <option value="start">Sort: Start Time</option>
          </select>
        </div>
        <div style={{ maxHeight: 260, overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 8 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead style={{ position: 'sticky', top: 0, background: 'var(--panel-2)' }}>
              <tr>
                <th style={{ textAlign: 'left', padding: '6px 10px' }}>Contest</th>
                <th style={{ textAlign: 'right', padding: '6px 10px' }}>Entry</th>
                <th style={{ textAlign: 'right', padding: '6px 10px' }}>Prize Pool</th>
                <th style={{ textAlign: 'right', padding: '6px 10px' }}>Entries</th>
                <th style={{ textAlign: 'right', padding: '6px 10px' }}>Starts</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(c => {
                const isSelected = c.contest_id === selectedContestId;
                return (
                  <tr
                    key={c.contest_id}
                    onClick={() => onSelect(c)}
                    style={{
                      borderTop: '1px solid var(--border)', cursor: 'pointer',
                      background: isSelected ? 'var(--accent-2, #3b82f622)' : 'transparent',
                    }}
                  >
                    <td style={{ padding: '6px 10px', fontWeight: isSelected ? 700 : 500 }}>{c.name}</td>
                    <td style={{ padding: '6px 10px', textAlign: 'right', fontFamily: 'var(--font-mono)' }}>{c.entry_fee ? `$${c.entry_fee}` : 'Free'}</td>
                    <td style={{ padding: '6px 10px', textAlign: 'right', fontFamily: 'var(--font-mono)' }}>{c.payout_summary || money(c.total_prize)}</td>
                    <td style={{ padding: '6px 10px', textAlign: 'right', fontFamily: 'var(--font-mono)', color: 'var(--text-faint)' }}>{(c.entries_so_far ?? 0).toLocaleString()}/{(c.max_entries ?? 0).toLocaleString()}</td>
                    <td style={{ padding: '6px 10px', textAlign: 'right', fontFamily: 'var(--font-mono)', color: 'var(--text-faint)' }}>
                      {c.start_time ? new Date(c.start_time).toLocaleString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' }) : '—'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {contests.length > filtered.length && (
          <div style={{ fontSize: 10, color: 'var(--text-faint)', marginTop: 6 }}>
            Showing {filtered.length} of {contests.length} open contests — refine your search for more.
          </div>
        )}
      </div>
    </div>
  );
}

// ─── DFS Weights tab ─────────────────────────────────────────────────────
// Same UX pattern as the Sleeper Slider (My Account/Team → Sleeper tab):
// per-position feature list, a slider per feature, weights ideally sum to
// 100%. Unlike the Sleeper Slider (which re-ranks the whole Players page),
// this only affects which players the DFS optimizer prefers.

function DfsWeightsTab({ weights, onChange }) {
  const [pos, setPos] = React.useState('QB');
  const [saved, setSaved] = React.useState(false);

  function moveFeature(idx, dir) {
    onChange(prev => {
      const arr = [...(prev[pos] || [])];
      const j = idx + dir;
      if (j < 0 || j >= arr.length) return prev;
      [arr[idx], arr[j]] = [arr[j], arr[idx]];
      return { ...prev, [pos]: arr };
    });
  }

  function setFeatureWeight(idx, val) {
    onChange(prev => {
      const arr         = [...(prev[pos] || [])];
      const clamped     = Math.max(0, Math.min(100, val));
      const remaining   = 100 - clamped;
      const otherTotal  = arr.reduce((s, f, i) => i !== idx ? s + (f.weight || 0) : s, 0);

      const newArr = arr.map((f, i) => {
        if (i === idx) return { ...f, weight: clamped };
        if (remaining === 0) return { ...f, weight: 0 };
        if (otherTotal === 0) return { ...f, weight: Math.floor(remaining / (arr.length - 1)) };
        return { ...f, weight: Math.round((f.weight / otherTotal) * remaining) };
      });

      // Fix rounding: total may be off by ±1 after Math.round — adjust the largest other slider
      const diff = 100 - newArr.reduce((s, f) => s + f.weight, 0);
      if (diff !== 0) {
        let bestIdx = -1, bestVal = -1;
        newArr.forEach((f, i) => { if (i !== idx && f.weight > bestVal) { bestVal = f.weight; bestIdx = i; } });
        if (bestIdx >= 0) newArr[bestIdx] = { ...newArr[bestIdx], weight: Math.max(0, newArr[bestIdx].weight + diff) };
      }

      return { ...prev, [pos]: newArr };
    });
  }

  function handleSave() {
    saveDfsWeights(weights);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  function handleReset() {
    onChange(resetDfsWeights());
  }

  const features = weights[pos] || [];
  const total = features.reduce((s, f) => s + (f.weight || 0), 0);
  const over = total > 100;
  const exact = total === 100;
  const barColor = over ? 'var(--danger)' : exact ? 'var(--good)' : 'var(--accent)';

  return (
    <div className="muted-card" style={{ maxWidth: 640 }}>
      <div style={{ marginBottom: 6 }}>
        <div style={{ fontSize: 13, fontWeight: 800, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--text)' }}>DFS Player Weights</div>
        <div style={{ fontSize: 12, color: 'var(--text-faint)', marginTop: 4, lineHeight: 1.6 }}>
          Weight which signals matter when the optimizer chooses between players at the same position. Default (100% DraftKings Projection) matches the optimizer's original behavior exactly — nothing changes until you move a slider.
        </div>
      </div>

      <div style={{ display: 'flex', gap: 0, background: 'var(--panel)', borderRadius: 8, padding: 3, alignSelf: 'flex-start', marginBottom: 20, marginTop: 16, width: 'fit-content' }}>
        {DFS_POSITIONS.map(p => (
          <button
            key={p}
            onClick={() => setPos(p)}
            style={{
              padding: '5px 14px', borderRadius: 6, fontSize: 12, fontWeight: pos === p ? 700 : 500,
              cursor: 'pointer', border: 'none',
              background: pos === p ? 'var(--accent)' : 'transparent',
              color: pos === p ? 'var(--accent-ink)' : 'var(--text-dim)',
              transition: 'background .15s, color .15s',
            }}
          >{p}</button>
        ))}
      </div>

      <div style={{ marginBottom: 20 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
          <span style={{ fontSize: 11, color: 'var(--text-faint)', fontFamily: 'var(--font-mono)', textTransform: 'uppercase', letterSpacing: '.08em' }}>Total Weight</span>
          <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 800, fontSize: 14, color: barColor }}>
            {total}% {over ? '— over by ' + (total - 100) + '%' : exact ? '✓' : '— ' + (100 - total) + '% remaining'}
          </span>
        </div>
        <div style={{ height: 6, borderRadius: 3, background: 'var(--panel-2)', overflow: 'hidden' }}>
          <div style={{ height: '100%', width: `${Math.min(total, 100)}%`, background: barColor, borderRadius: 3, transition: 'width .2s, background .2s' }} />
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {features.map((f, idx, arr) => (
          <div
            key={f.key}
            style={{
              display: 'grid', gridTemplateColumns: '22px 20px 20px 1fr 120px 42px',
              alignItems: 'center', gap: 8,
              padding: '8px 12px', borderRadius: 8,
              background: 'var(--panel-2)', border: '1px solid var(--border)',
            }}
          >
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-faint)', textAlign: 'center' }}>{idx + 1}</span>
            <button onClick={() => moveFeature(idx, -1)} disabled={idx === 0} style={{ background: 'none', border: 'none', cursor: idx === 0 ? 'default' : 'pointer', color: idx === 0 ? 'var(--border-strong)' : 'var(--text-dim)', fontSize: 13, padding: 0, lineHeight: 1 }}>↑</button>
            <button onClick={() => moveFeature(idx, 1)} disabled={idx === arr.length - 1} style={{ background: 'none', border: 'none', cursor: idx === arr.length - 1 ? 'default' : 'pointer', color: idx === arr.length - 1 ? 'var(--border-strong)' : 'var(--text-dim)', fontSize: 13, padding: 0, lineHeight: 1 }}>↓</button>
            <span style={{ fontSize: 13, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{f.label}</span>
            <input
              type="range" min={0} max={100} step={1}
              value={f.weight || 0}
              onChange={e => setFeatureWeight(idx, Number(e.target.value))}
              style={{ width: '100%', accentColor: 'var(--accent)', cursor: 'pointer' }}
            />
            <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 800, fontSize: 13, color: f.weight > 0 ? 'var(--accent)' : 'var(--text-faint)', textAlign: 'right', whiteSpace: 'nowrap' }}>
              {f.weight || 0}%
            </span>
          </div>
        ))}
      </div>

      <div style={{ display: 'flex', gap: 12, marginTop: 20 }}>
        <button className="btn primary" onClick={handleSave} style={{ minWidth: 140 }}>{saved ? '✓ Saved' : 'Save Weights'}</button>
        <button className="btn ghost" onClick={handleReset}>Reset to Defaults</button>
      </div>
      {saved && (
        <div style={{ marginTop: 10, fontSize: 12, color: 'var(--accent)', fontFamily: 'var(--font-mono)', fontWeight: 700 }}>
          Weights saved — the Optimizer tab will use these rankings.
        </div>
      )}

      <div style={{ marginTop: 20, paddingTop: 16, borderTop: '1px solid var(--border)', fontSize: 11, color: 'var(--text-faint)', lineHeight: 1.7 }}>
        <div style={{ fontWeight: 800, fontSize: 10, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--text-dim)', marginBottom: 6 }}>How This Affects the Lineup</div>
        Each feature is scored 0-100 relative to other players at the same position in this slate. Your weighted average of those scores (the "composite") adjusts each player's DraftKings projection: <code>adjusted = DK proj × (0.5 + composite / 100)</code>. A player who's exactly average on your weighted criteria keeps their DK projection unchanged; dominating the field on what you weighted pushes them toward 1.5×, being weak on all of it pulls toward 0.5×. The optimizer then re-solves for the highest-projection lineup under the salary cap using these adjusted numbers.
        <div style={{ marginTop: 10 }}>
          <strong>Opportunity Score</strong> — a snap-share/usage breakout model (same one used on the Players page's Watchlist tab), not DraftKings data. Only covers players currently flagged as breakout candidates; anyone not on that list scores 0 here.<br />
          <strong>Ownership Leverage</strong> — DFS-specific: favors <em>lower</em>-owned players, since a correct, low-owned pick differentiates your lineup from the field in tournaments. Set this to 0% if you're building a cash-game lineup where that doesn't matter.
        </div>
      </div>
    </div>
  );
}
