import React from 'react';
import { TEAM_ROSTERS, findTeam, NEWS, SLOT_ELIGIBILITY, ROSTER_CONFIG, LEAGUE_TEAMS, buildRosterFrame, assignRoster, FREE_DATA_SOURCES, LIMITED_FREE_SOURCES } from '../lib/data.js';
import { usePlayers, findPlayer, findPlayerByName, getPlayers, patchPlayers } from '../lib/playerStore.js';
import { PosBadge, StatusDot, PlayerAvatar, TeamLogoBadge, Sparkline } from '../components/ui.jsx';
import { fetchSleeperPlayerStats } from '../lib/sleeper.js';
import { useR2Drops, useR2Injuries, useR2PlayerNotes, useR2EnrichedNews, useR2WeatherForecast, useR2BreakoutCandidates, useR2PlayerNewsLinks } from '../hooks.js';
import LineupDecisions from './LineupDecisions.jsx';

const H2H_WEEKS   = 14;
const H2H_SEASON_START = new Date('2026-09-09');
function getH2HWeek() {
  const today = new Date();
  if (today < H2H_SEASON_START) return 1;
  const msPerWeek = 7 * 24 * 60 * 60 * 1000;
  return Math.min(Math.max(Math.floor((today - H2H_SEASON_START) / msPerWeek) + 1, 1), H2H_WEEKS);
}
const H2H_WEEK = getH2HWeek();

function h2hWeekSeed(teamId, week) {
  return Math.sin(teamId * 7.3 + week * 3.1) * 18 + Math.cos(teamId * 2.1 + week * 5.7) * 8;
}

function h2hScore(teamId, week) {
  const roster   = TEAM_ROSTERS[teamId] || [];
  const starters = roster.filter(r => r.slot !== 'BENCH');
  const base = starters.reduce((sum, e) => {
    const p = e.playerId ? findPlayer(e.playerId) : null;
    return sum + (p ? (p.avg || 0) : 0);
  }, 0);
  return Math.max(0, Math.round((base + h2hWeekSeed(teamId, week)) * 10) / 10);
}

function buildH2HSchedule(ids, weeks) {
  const n = ids.length;
  const schedule = [];
  for (let w = 0; w < weeks; w++) {
    const rest    = ids.slice(1);
    const rot     = w % (n - 1);
    const rotated = [...rest.slice(rot), ...rest.slice(0, rot)];
    const circle  = [ids[0], ...rotated];
    const matchups = [];
    for (let i = 0; i < n / 2; i++) matchups.push([circle[i], circle[n - 1 - i]]);
    schedule.push(matchups);
  }
  return schedule;
}

const H2H_SCHEDULE = buildH2HSchedule(LEAGUE_TEAMS.map(t => t.id), H2H_WEEKS);

// Normalize a player name for fuzzy matching: lowercase, strip Jr/Sr/II/III/IV suffixes, collapse whitespace
function normalizeName(name) {
  return (name || '')
    .toLowerCase()
    .replace(/\s+(jr\.?|sr\.?|ii|iii|iv|v)$/i, '')
    .replace(/[^a-z\s'-]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// ─── Trend sparkline helper ───────────────────────────────────────────────
// Returns p.trend if it has real data; otherwise generates synthetic 6-week values
// from p.avg using the same per-player noise formula used across the app.
function getTrendData(p) {
  if (p?.trend?.some(v => v > 0)) return p.trend;
  const base = p?.avg || p?.proj || 0;
  if (!base) return [];
  return [1, 2, 3, 4, 5, 6].map(w =>
    Math.max(0, Math.round((base + Math.sin(p.id * 3.7 + w * 2.3) * 4) * 10) / 10)
  );
}

// ─── Scoring breakdown helpers ─────────────────────────────────────────────
function computeYardBonus(code, yards) {
  const tiers = {
    PaYd: [{ min: 300, pts: 2 }, { min: 400, pts: 2 }, { min: 500, pts: 3 }],
    RuYd: [{ min: 100, pts: 2 }, { min: 200, pts: 2 }, { min: 300, pts: 3 }],
    ReYd: [{ min: 100, pts: 2 }, { min: 200, pts: 2 }, { min: 300, pts: 3 }],
  }[code] || [];
  return tiers.reduce((s, t) => s + (yards >= t.min ? t.pts : 0), 0);
}

function yardBonusLabel(code, yards) {
  const tiers = {
    PaYd: [{ min: 300, pts: 2 }, { min: 400, pts: 2 }, { min: 500, pts: 3 }],
    RuYd: [{ min: 100, pts: 2 }, { min: 200, pts: 2 }, { min: 300, pts: 3 }],
    ReYd: [{ min: 100, pts: 2 }, { min: 200, pts: 2 }, { min: 300, pts: 3 }],
  }[code] || [];
  return tiers.filter(t => yards >= t.min).map(t => `+${t.pts} (${t.min}+ yd bonus)`).join(', ');
}

// Returns { items, accumulated }
// items = normalized breakdown (sums to player.proj for display bars)
// accumulated = raw simulated score before normalization (actual performance vs projection)
function buildScoringBreakdown(player, week) {
  const sd = player.id * 17.3 + week * 4.1;
  const v  = n => Math.abs(Math.sin(sd + n * 1.618));

  let raw = [];
  const pos = player.pos;

  if (pos === 'QB') {
    const paYds = Math.round(180 + v(1) * 220);
    const paTds = Math.floor(v(2) * 3.4);
    const paInt = v(3) < 0.35 ? 1 : 0;
    const ruYds = Math.round(v(4) * 48);
    const paBase = Math.round(paYds * 0.04 * 10) / 10;
    const paBonus = computeYardBonus('PaYd', paYds);
    const ruBase  = Math.round(ruYds * 0.1  * 10) / 10;
    const ruBonus = computeYardBonus('RuYd', ruYds);
    raw = [
      { code: 'PaYd',  label: 'Pass Yards', statStr: `${paYds} yds`, pts: paBase + paBonus, bonusLabel: yardBonusLabel('PaYd', paYds) },
      { code: 'PaTD',  label: 'Pass TDs',   statStr: `${paTds} TD`,  pts: paTds * 4 },
      paInt ? { code: 'PaInt', label: 'INT',       statStr: `${paInt} INT`, pts: paInt * -1 } : null,
      ruYds > 0 ? { code: 'RuYd', label: 'Rush Yards', statStr: `${ruYds} yds`, pts: ruBase + ruBonus, bonusLabel: yardBonusLabel('RuYd', ruYds) } : null,
    ].filter(Boolean);
  } else if (pos === 'RB') {
    const ruYds = Math.round(35 + v(1) * 110);
    const ruTds = Math.floor(v(2) * 1.6);
    const reYds = Math.round(v(3) * 65);
    const fl    = v(4) < 0.12 ? 1 : 0;
    const ruBase = Math.round(ruYds * 0.1 * 10) / 10;
    const ruBonus = computeYardBonus('RuYd', ruYds);
    const reBase  = Math.round(reYds * 0.1 * 10) / 10;
    const reBonus = computeYardBonus('ReYd', reYds);
    raw = [
      { code: 'RuYd', label: 'Rush Yards', statStr: `${ruYds} yds`, pts: ruBase + ruBonus, bonusLabel: yardBonusLabel('RuYd', ruYds) },
      { code: 'RuTD', label: 'Rush TDs',   statStr: `${ruTds} TD`,  pts: ruTds * 6 },
      reYds > 0 ? { code: 'ReYd', label: 'Rec Yards', statStr: `${reYds} yds`, pts: reBase + reBonus, bonusLabel: yardBonusLabel('ReYd', reYds) } : null,
      fl ? { code: 'FL', label: 'Fumble Lost', statStr: `${fl} FL`, pts: fl * -1 } : null,
    ].filter(Boolean);
  } else if (pos === 'WR') {
    const reYds = Math.round(25 + v(1) * 110);
    const reTds = Math.floor(v(2) * 1.4);
    const reBase  = Math.round(reYds * 0.1 * 10) / 10;
    const reBonus = computeYardBonus('ReYd', reYds);
    raw = [
      { code: 'ReYd', label: 'Rec Yards', statStr: `${reYds} yds`, pts: reBase + reBonus, bonusLabel: yardBonusLabel('ReYd', reYds) },
      { code: 'ReTD', label: 'Rec TDs',   statStr: `${reTds} TD`,  pts: reTds * 6 },
    ];
  } else if (pos === 'TE') {
    const reYds = Math.round(15 + v(1) * 80);
    const reTds = Math.floor(v(2) * 1.2);
    const reBase  = Math.round(reYds * 0.1 * 10) / 10;
    const reBonus = computeYardBonus('ReYd', reYds);
    raw = [
      { code: 'ReYd', label: 'Rec Yards', statStr: `${reYds} yds`, pts: reBase + reBonus, bonusLabel: yardBonusLabel('ReYd', reYds) },
      { code: 'ReTD', label: 'Rec TDs',   statStr: `${reTds} TD`,  pts: reTds * 6 },
    ];
  } else if (pos === 'K') {
    const fg = Math.round(v(1) * 3.5);
    const xp = Math.round(1 + v(2) * 3);
    raw = [
      { code: 'FG', label: 'Field Goals',  statStr: `${fg} FG`,  pts: fg * 3 },
      { code: 'XP', label: 'Extra Points', statStr: `${xp} XP`, pts: xp * 1 },
    ];
  } else if (pos === 'DST') {
    const pa   = Math.round(6 + v(1) * 22);
    const paPts = pa <= 6 ? 8 : pa <= 13 ? 6 : pa <= 20 ? 4 : pa <= 27 ? 2 : 0;
    const sacks = Math.round(v(2) * 5);
    const ints  = Math.round(v(3) * 2.5);
    const dtd   = v(4) < 0.18 ? 1 : 0;
    const dfr   = Math.round(v(5) * 1.8);
    raw = [
      { code: 'DSTPA', label: 'Pts Allowed',   statStr: `${pa} PA`,       pts: paPts },
      { code: 'SACK',  label: 'Sacks',          statStr: `${sacks} sacks`, pts: sacks },
      { code: 'Int',   label: 'Interceptions',  statStr: `${ints} INT`,    pts: ints * 2 },
      dtd  ? { code: 'DTD', label: 'Def/ST TD',     statStr: `${dtd} TD`,    pts: dtd * 6 } : null,
      dfr > 0 ? { code: 'DFR', label: 'Fum Recovered', statStr: `${dfr} FR`, pts: dfr * 2 } : null,
    ].filter(Boolean);
  }

  const rawTotal   = raw.reduce((s, i) => s + i.pts, 0);
  const accumulated = Math.round(rawTotal * 10) / 10;
  if (rawTotal === 0 || player.proj === 0) return { items: raw, accumulated };
  const scale = player.proj / rawTotal;
  const items = raw.map(item => ({ ...item, pts: Math.round(item.pts * scale * 10) / 10 }));
  return { items, accumulated };
}

const SLOT_ORDER = ['QB', 'RB', 'WR', 'TE', 'FLEX', 'DST', 'BENCH'];

function canFillSlot(playerPos, targetSlot) {
  const allowed = SLOT_ELIGIBILITY[targetSlot];
  return !allowed || allowed.includes(playerPos);
}

function slotSort(a, b) {
  const ai = SLOT_ORDER.indexOf(a.slot);
  const bi = SLOT_ORDER.indexOf(b.slot);
  return (ai < 0 ? 99 : ai) - (bi < 0 ? 99 : bi);
}

function slotColor(slot) {
  if (slot === 'QB')  return 'var(--pos-qb)';
  if (slot === 'RB')  return 'var(--pos-rb)';
  if (slot === 'WR')  return 'var(--pos-wr)';
  if (slot === 'TE')  return 'var(--pos-te)';
  if (slot === 'K')   return 'var(--pos-k)';
  if (slot === 'DST') return 'var(--pos-dst)';
  if (slot === 'FLEX') return 'var(--accent-2)';
  return 'var(--text-faint)';
}

const WORKER   = (import.meta.env?.VITE_WORKER_URL || '').replace(/\/$/, '');
const API_BASE = 'https://api.fantasai.net';

function fmtTs(ts) {
  if (!ts) return null;
  const d = new Date(typeof ts === 'number' ? ts : ts);
  if (isNaN(d)) return null;
  return d.toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function DropCandidatesPanel({ myRosterIds, onOpenPlayer }) {
  const { data, loading } = useR2Drops();
  const [collapsed, setCollapsed] = React.useState(false);

  if (loading || !data) return null;

  const candidates = (Array.isArray(data) ? data : []).filter(r => {
    const match = findPlayerByName(r.player_name);
    return match && myRosterIds.has(match.id);
  });

  if (candidates.length === 0) return null;

  const urgencyColor = u => u === 'High' ? '#ff5a6e' : u === 'Medium' ? 'var(--warn)' : 'var(--text-faint)';

  return (
    <div style={{ margin: '10px 18px 0', border: '1px solid rgba(255,90,110,.25)', borderRadius: 10, overflow: 'hidden', background: 'var(--panel)' }}>
      <div
        style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', cursor: 'pointer', userSelect: 'none' }}
        onClick={() => setCollapsed(c => !c)}
      >
        <div className="ai-orb" style={{ width: 11, height: 11, flexShrink: 0 }} />
        <div style={{ flex: 1, fontSize: 11, fontWeight: 800, color: '#ff5a6e', letterSpacing: '.03em' }}>
          Databricks AI · Drop Candidates
        </div>
        <span style={{ fontSize: 9, fontFamily: 'var(--font-mono)', fontWeight: 700, padding: '2px 7px', borderRadius: 4, background: 'rgba(255,90,110,.12)', color: '#ff5a6e', border: '1px solid rgba(255,90,110,.3)' }}>
          {candidates.length} on your roster
        </span>
        <span style={{ fontSize: 12, color: 'var(--text-faint)' }}>{collapsed ? '▶' : '▼'}</span>
      </div>

      {!collapsed && (
        <div style={{ borderTop: '1px solid rgba(255,90,110,.15)', padding: '8px 14px 12px', display: 'flex', flexDirection: 'column', gap: 4 }}>
          {candidates.map((r, i) => {
            const player = findPlayerByName(r.player_name);
            const uColor = urgencyColor(r.urgency);
            return (
              <div
                key={i}
                style={{ display: 'flex', alignItems: 'flex-start', gap: 8, padding: '6px 0', borderBottom: i < candidates.length - 1 ? '1px solid var(--panel-3)' : 'none', cursor: player ? 'pointer' : 'default' }}
                onClick={() => player && onOpenPlayer?.(player.id)}
              >
                <span style={{ fontSize: 9, fontFamily: 'var(--font-mono)', fontWeight: 700, padding: '2px 6px', borderRadius: 3, background: `${uColor}18`, color: uColor, border: `1px solid ${uColor}40`, flexShrink: 0, marginTop: 1 }}>
                  {(r.urgency || 'DROP').toUpperCase()}
                </span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                    <span style={{ fontSize: 12, fontWeight: 700, color: '#ff5a6e' }}>{r.player_name}</span>
                    {r.position && <PosBadge pos={r.position} />}
                    {r.team && <span style={{ fontSize: 10, color: 'var(--text-dim)' }}>{r.team}</span>}
                  </div>
                  {r.reason && <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 2 }}>{r.reason}</div>}
                  {r.suggested_add && (
                    <div style={{ fontSize: 10, color: 'var(--accent-2)', marginTop: 2, fontFamily: 'var(--font-mono)' }}>
                      → Consider: {r.suggested_add}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default function CurrentRosterScreen({ onNav, user, myRosterIds, onAddPlayer, onDropPlayer, onOpenPlayer, watchlistIds = new Set(), onToggleWatch, sourcesState, slotOverrides = {}, onSlotOverridesChange, tradeOffers = [], onRespondTradeOffer, rosterSyncBadge, rosterLoading }) {
  const allPlayers = usePlayers();
  const [dropConfirm, setDropConfirm] = React.useState(null);
  const [addFilter, setAddFilter] = React.useState('ALL');
  const [addSearch, setAddSearch] = React.useState('');
  const [tab, setTab] = React.useState('roster');
  const [dragId, setDragId] = React.useState(null);
  const [dragOver, setDragOver] = React.useState(null);
  const [swapTarget, setSwapTarget] = React.useState(null);      // { playerId, slot }
  const [addDropPending, setAddDropPending] = React.useState(null); // { addPlayer, dropPlayerId }
  const [expandedNews, setExpandedNews] = React.useState(new Set()); // playerIds with expanded news
  const [matchupExpanded, setMatchupExpanded] = React.useState(false);

  // Schedule loaded from S3 (set by Admin/Commissioner in League Settings)
  const [s3Schedule, setS3Schedule] = React.useState(null);

  React.useEffect(() => {
    fetch(`${API_BASE}/api/v1/schedule`)
      .then(r => r.json())
      .then(d => { if (d.fromS3 && d.schedule) setS3Schedule(d.schedule); })
      .catch(() => {});
  }, []);

  const teamId = user?.teamId || 1;
  const team = findTeam(teamId);
  const baseIds = React.useMemo(() => new Set(TEAM_ROSTERS[teamId] || []), [teamId]);

  // Build roster frame from league settings, then assign players to it
  const rosterSettings = React.useMemo(() => {
    try { return JSON.parse(localStorage.getItem('fantasai_league_settings') || 'null'); } catch { return null; }
  }, []);
  const slotFrame  = React.useMemo(() => buildRosterFrame(rosterSettings), [rosterSettings]);
  // Include allPlayers so assignRoster re-runs when live data loads (findPlayer depends on the store)
  const fullRoster = React.useMemo(
    () => assignRoster(slotFrame, myRosterIds, slotOverrides, findPlayer),
    [slotFrame, myRosterIds, slotOverrides, allPlayers],
  );

  // Proj totals from starters (non-bench)
  const starters = fullRoster.filter(r => r.slot !== 'BENCH' && r.playerId);
  const totalProj = starters.reduce((s, r) => s + (findPlayer(r.playerId)?.proj || 0), 0);

  const [swapError, setSwapError] = React.useState(null);
  // R2 injury report written by Databricks — used to populate Updated News/Live column on load
  const { data: r2InjuryData, fetchedAt: r2InjuryFetchedAt } = useR2Injuries();
  const { data: r2PlayerNotes }  = useR2PlayerNotes();
  const { data: r2EnrichedNews } = useR2EnrichedNews();
  const { data: r2WeatherData }  = useR2WeatherForecast();
  const { data: r2Breakouts }    = useR2BreakoutCandidates();
  const { data: r2PlayerNewsData } = useR2PlayerNewsLinks();

  // Parse R2 player_news.json (unified pipeline, highest priority)
  // Normalize player_news.json — handles multiple field name conventions from pipeline
  const r2Articles = React.useMemo(() => {
    const raw = Array.isArray(r2PlayerNewsData) ? r2PlayerNewsData
              : Array.isArray(r2PlayerNewsData?.data) ? r2PlayerNewsData.data
              : Array.isArray(r2PlayerNewsData?.articles) ? r2PlayerNewsData.articles : [];
    return raw.map(a => {
      const headline    = a.headline || a.title || a.article_title || '';
      const article_url = a.article_url || a.source_url || a.url || a.link || '';
      if (!headline) return null;
      return {
        ...a,
        headline,
        article_url,
        player_name:  a.player_name || a.primary_player_name || a.mentioned_player || '',
        position:     (a.position || a.player_position || a.pos || '').toUpperCase(),
        team:         a.team || a.player_team || '',
        published_at: a.published_at || a.published_date || a.created_at || null,
        publisher:    a.publisher || a.source || a.feed_source || 'FantasAI',
        description:  a.description || a.full_text || a.summary || a.summary_text || '',
      };
    }).filter(Boolean);
  }, [r2PlayerNewsData]);

  // Normalize enriched_news.json into the same article shape
  const r2EnrichedArticles = React.useMemo(() => {
    const raw = Array.isArray(r2EnrichedNews) ? r2EnrichedNews
              : Array.isArray(r2EnrichedNews?.data) ? r2EnrichedNews.data : [];
    if (!raw.length) return [];
    const bySleeperMap = new Map();
    getPlayers().forEach(p => { if (p.sleeperId) bySleeperMap.set(String(p.sleeperId), p); });
    return raw.map(a => {
      const headline    = a.headline || a.title || '';
      const article_url = a.source_url || a.article_url || a.url || '';
      if (!headline) return null;
      const pl = a.primary_player_id ? bySleeperMap.get(String(a.primary_player_id)) : null;
      return {
        headline, article_url,
        player_name: pl?.name || a.player_name || '',
        position:    (pl?.pos || a.position || '').toUpperCase(),
        team:        pl?.team || a.team || '',
        published_at: a.published_at || null,
        publisher:   a.publisher || a.source || 'FantasAI',
        description: a.full_text || a.description || a.summary || '',
      };
    }).filter(Boolean);
  }, [r2EnrichedNews]);

  // Live Databricks articles (same endpoint as News & Updates)
  const [dbArticles, setDbArticles] = React.useState([]);
  React.useEffect(() => {
    let cancelled = false;
    fetch(`${API_BASE}/api/v1/news/articles?limit=500`, { signal: AbortSignal.timeout(20000) })
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (cancelled || !data) return;
        setDbArticles(Array.isArray(data.articles) ? data.articles : []);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  // Merge all three sources — same priority as News & Updates:
  //   player_news.json (highest) > live Databricks API > enriched_news.json
  // Key = article_url when available, else headline (handles notes without a URL).
  const mergedArticles = React.useMemo(() => {
    const byKey = new Map();
    const artKey = a => a.article_url || a.headline;
    for (const a of r2EnrichedArticles) { const k = artKey(a); if (k && a.headline) byKey.set(k, a); }
    for (const a of dbArticles)         { const k = artKey(a); if (k && a.headline) byKey.set(k, a); }
    for (const a of r2Articles)         { const k = artKey(a); if (k && a.headline) byKey.set(k, a); }
    return [...byKey.values()].sort((a, b) => {
      const ta = a.published_at ? new Date(a.published_at).getTime() : 0;
      const tb = b.published_at ? new Date(b.published_at).getTime() : 0;
      return tb - ta;
    });
  }, [r2Articles, r2EnrichedArticles, dbArticles]);

  // Map normalized player name → articles sorted newest-first
  const playerNewsMap = React.useMemo(() => {
    const m = new Map();
    for (const a of mergedArticles) {
      const key = normalizeName(a.player_name || '');
      if (!key) continue;
      if (!m.has(key)) m.set(key, []);
      m.get(key).push(a);
    }
    return m;
  }, [mergedArticles]);

  const breakoutByName = React.useMemo(() => {
    if (!Array.isArray(r2Breakouts)) return new Map();
    const m = new Map();
    r2Breakouts.forEach(b => { if (b.player_name) m.set(b.player_name.toLowerCase(), b); });
    return m;
  }, [r2Breakouts]);

  // Live weather state — updated by the Refresh Weather button (overrides cached R2 data)
  const [liveWeatherTeams, setLiveWeatherTeams]     = React.useState(null);
  const [weatherRefreshing, setWeatherRefreshing]   = React.useState(false);
  const [weatherRefreshedAt, setWeatherRefreshedAt] = React.useState(null);
  const [weatherRateMsg, setWeatherRateMsg]         = React.useState(null);
  const autoWeatherTriggered = React.useRef(false);

  const weatherTeams = liveWeatherTeams || r2WeatherData?.teams || {};

  async function handleWeatherRefresh() {
    if (weatherRefreshing) return;
    setWeatherRefreshing(true);
    setWeatherRateMsg(null);
    try {
      const res = await fetch(`${API_BASE}/api/v1/weather/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ days: 7 }),
        signal: AbortSignal.timeout(120000),
      });
      if (res.ok) {
        const data = await res.json();
        if (data.teams) {
          setLiveWeatherTeams(data.teams);
          setWeatherRefreshedAt(data.fetched_at || new Date().toISOString());
        }
        if (data.message) setWeatherRateMsg(data.message);
      }
    } catch {}
    setWeatherRefreshing(false);
  }

  // Auto-fetch weather once on mount if R2 has no cached data
  React.useEffect(() => {
    if (r2WeatherData === null && !autoWeatherTriggered.current && !weatherRefreshing) {
      autoWeatherTriggered.current = true;
      handleWeatherRefresh();
    }
  }, [r2WeatherData]); // eslint-disable-line react-hooks/exhaustive-deps

  // Returns the best game-time forecast hour for a given team's forecast array.
  // Prefers the upcoming Sunday afternoon (1300h slot); falls back to first day.
  function getGameWeather(teamAbbr) {
    const entry = weatherTeams[teamAbbr?.toUpperCase()];
    if (!entry) return null;
    if (entry.is_dome) return { dome: true };
    if (!entry.forecast?.length) return { dome: false, noData: true };
    const now = new Date();
    const daysUntilSunday = (7 - now.getDay()) % 7 || 7;
    const sundayStr = new Date(now.getTime() + daysUntilSunday * 86400000)
      .toISOString().split('T')[0];
    const day = entry.forecast.find(d => d.date === sundayStr) || entry.forecast[0];
    const hour = day.hourly?.find(h => h.time === '1300') ||
                 day.hourly?.find(h => h.time === '1500') ||
                 day.hourly?.[day.hourly.length > 4 ? Math.floor(day.hourly.length / 2) : 0];
    return { dome: false, date: day.date, maxTempF: day.max_temp_f, minTempF: day.min_temp_f, hour };
  }
  const r2InjuryByName = React.useMemo(() => {
    const m = {};
    const list = Array.isArray(r2InjuryData) ? r2InjuryData : [];
    for (const r of list) {
      if (r.player_name && r.player_name !== 'All Players') m[r.player_name.toLowerCase()] = r;
    }
    return m;
  }, [r2InjuryData]);

  // liveData[playerId] = [{ note, proj, source, sourceId, liveStatus }, ...]  — one entry per API source
  const [liveData,          setLiveData]          = React.useState({});

  const STATUS_MAP = { Questionable: 'Q', Doubtful: 'D', Out: 'O', Injured_Reserve: 'IR', Non_Football_Injury: 'NFI', Practice_Squad: 'PS' };
  const STATUS_RANK = { IR: 4, O: 3, D: 2, Q: 1 };
  function deriveStatus(playerId) {
    let worst = 'OK';
    for (const entry of (liveData[playerId] || [])) {
      let s = 'OK';
      if (entry.liveStatus) {
        s = STATUS_MAP[entry.liveStatus] || entry.liveStatus;
      } else if (entry.note) {
        const n = entry.note.toLowerCase();
        if (n.includes('injured reserve') || /\bir\b/.test(n)) s = 'IR';
        else if (/\bout\b/.test(n)) s = 'O';
        else if (n.includes('doubtful'))     s = 'D';
        else if (n.includes('questionable')) s = 'Q';
      }
      if ((STATUS_RANK[s] || 0) > (STATUS_RANK[worst] || 0)) worst = s;
    }
    return worst;
  }
  const [fetchingSourceIds, setFetchingSourceIds] = React.useState(new Set());
  const [lastFetched,       setLastFetched]       = React.useState({});
  const [refreshResults,    setRefreshResults]    = React.useState({});  // { [srcId]: { updated, total } }

  // Sleeper-sourced total projection for starters
  const sleeperColor    = '#1c8eaf';
  const sleeperProjTotal = starters.reduce((sum, r) => {
    const p = findPlayer(r.playerId);
    if (!p) return sum;
    const entry = (liveData[p.id] || []).find(e => e.sourceId === 'sleeper-api' && e.proj != null);
    return sum + (entry ? entry.proj : p.proj);
  }, 0);
  const hasSleeperProj = starters.some(r => {
    const p = findPlayer(r.playerId);
    return p && (liveData[p.id] || []).some(e => e.sourceId === 'sleeper-api' && e.proj != null);
  });

  // CBS News count — how many roster players have a CBS news entry
  const cbsNewsColor = '#0d4ea2';
  const cbsNewsCount = fullRoster.filter(r => {
    if (!r.playerId) return false;
    const p = findPlayer(r.playerId);
    return p && (liveData[p.id] || []).some(e => e.sourceId === 'cbs-news' && e.note);
  }).length;
  const cbsTotalCount = fullRoster.filter(r => r.playerId).length;

  // CBS News is always available as a native source for this league
  const CBS_NEWS_SRC = React.useMemo(
    () => ({ ...FREE_DATA_SOURCES.find(s => s.id === 'cbs-news'), kind: 'free' }),
    [],
  );

  // Which sources are currently activated (free toggle ON or limited enabled+key set)
  // CBS News is always included first regardless of Sources toggle state
  const activatedSources = React.useMemo(() => {
    const result = [CBS_NEWS_SRC];
    for (const src of FREE_DATA_SOURCES) {
      if (src.id === 'cbs-news') continue; // already added above
      if (sourcesState?.freeApis?.[src.id]) result.push({ ...src, kind: 'free' });
    }
    try {
      const saved = JSON.parse(localStorage.getItem('fantasai_limited_apis') || '{}');
      for (const src of LIMITED_FREE_SOURCES) {
        const cfg = saved[src.id];
        if (cfg?.enabled) result.push({ ...src, apiKey: cfg.apiKey || src.defaultKey || '', kind: 'limited' });
      }
    } catch {}
    return result;
  }, [sourcesState, CBS_NEWS_SRC]);

  const sleeperEnabled = sourcesState?.freeApis?.['sleeper-api'] !== false;

  // Auto-fetch all activated sources once the roster has players
  const activatedSourcesRef = React.useRef(activatedSources);
  activatedSourcesRef.current = activatedSources;
  const didAutoFetch = React.useRef(false);
  React.useEffect(() => {
    const rosterSize = fullRoster.filter(r => r.playerId).length;
    if (rosterSize > 0 && !didAutoFetch.current) {
      didAutoFetch.current = true;
      activatedSourcesRef.current.forEach(src => handleRefreshSource(src));
    }
  }, [fullRoster]); // eslint-disable-line react-hooks/exhaustive-deps

  async function handleRefreshSource(src) {
    if (fetchingSourceIds.has(src.id)) return;
    setFetchingSourceIds(prev => new Set([...prev, src.id]));

    const targets = fullRoster
      .map(r => r.playerId ? findPlayer(r.playerId) : null)
      .filter(Boolean);

    const data = {};
    try {
      if (src.id === 'sleeper-api') {
        const results = await Promise.allSettled(
          targets.map(p => fetchSleeperPlayerStats(p.name, p.pos))
        );
        results.forEach((r, i) => {
          if (r.status !== 'fulfilled' || !r.value?.found) return;
          const d = r.value;
          const p = targets[i];
          const liveStatus = d.status && d.status !== 'Active' ? d.status : null;
          const noteParts = [];
          if (liveStatus) noteParts.push(liveStatus);
          if (d.injuryBodyPart) noteParts.push(d.injuryBodyPart);
          const proj = d.projection?.pts_half_ppr ?? d.projection?.pts_std ?? null;
          let lastPts = null;
          if (d.weeklyStats && Object.keys(d.weeklyStats).length > 0) {
            const lastWk = Math.max(...Object.keys(d.weeklyStats).map(Number));
            const ws = d.weeklyStats[lastWk];
            lastPts = ws?.pts_half_ppr ?? ws?.pts_std ?? null;
          }
          data[p.id] = { note: noteParts.join(' · ') || null, proj: proj != null ? Number(proj) : null, lastPts, source: src.name, liveStatus };
        });
      }

      else if (src.id === 'espn-nfl') {
        // Scan ESPN NFL news via worker proxy for roster player name mentions
        const res = await fetch(`${API_BASE}/api/v1/nfl/news?limit=50`, { signal: AbortSignal.timeout(10000) });
        if (res.ok) {
          const { articles = [] } = await res.json();
          for (const article of articles) {
            const text = `${article.headline || ''} ${article.description || ''}`;
            for (const p of targets) {
              if (data[p.id]) continue;
              const parts = p.name.split(' ');
              const first = parts[0];
              const last  = parts.slice(1).join(' ');
              if (last.length > 3 && text.includes(first) && text.includes(last)) {
                data[p.id] = { note: article.headline, proj: null, source: src.name };
              }
            }
          }
        }
      }

      else if (src.id === 'cbs-news') {
        // Fetch full player list with RotoWire news from our CBS Worker proxy
        const cbsCookie = (() => { try { return localStorage.getItem('fantasai_cbs_cookie') || ''; } catch { return ''; } })();
        const res = await fetch(`${API_BASE}/api/v1/cbs/players`, {
          headers: cbsCookie ? { 'X-CBS-Cookie': cbsCookie } : {},
          signal: AbortSignal.timeout(20000),
        });
        if (res.ok) {
          const { players: cbsPlayers = [] } = await res.json();
          for (const cp of cbsPlayers) {
            if (!cp.news) continue;
            // Match by name: exact first, then last-name + first-initial fallback
            const cpName = cp.name.toLowerCase();
            const match = targets.find(p => {
              const pn = p.name.toLowerCase();
              if (cpName === pn) return true;
              const cpParts = cpName.split(' ');
              const pParts  = pn.split(' ');
              return cpParts[cpParts.length - 1] === pParts[pParts.length - 1] && cpParts[0][0] === pParts[0][0];
            });
            if (!match) continue;
            const cbsStatus = cp.status && cp.status !== 'Active' ? cp.status : null;
            const newsText  = cp.news || (cbsStatus ? `Status: ${cbsStatus}` : null);
            if (!newsText && !cbsStatus) continue;
            data[match.id] = { note: newsText || '', proj: null, source: src.name, liveStatus: cbsStatus };
          }
        }
      }

      else if (src.id === 'nflverse') {
        // Fetch nflverse injury designations CSV from GitHub releases
        const year = new Date().getFullYear();
        let csvText = null;
        for (const y of [year, year - 1]) {
          const rawUrl   = `https://github.com/nflverse/nflverse-data/releases/download/injuries/injuries_${y}.csv`;
          const proxyUrl = `${API_BASE}/api/v1/proxy?url=${encodeURIComponent(rawUrl)}`;
          try {
            const res = await fetch(proxyUrl, { signal: AbortSignal.timeout(20000) });
            if (res.ok) { csvText = await res.text(); break; }
          } catch {}
        }
        if (csvText) {
          const lines   = csvText.split('\n').filter(Boolean);
          const headers = lines[0].split(',').map(h => h.replace(/"/g, '').trim());
          const rows    = lines.slice(1).map(line => {
            const vals = line.split(',').map(v => v.replace(/"/g, '').trim());
            const row  = {};
            headers.forEach((h, i) => { row[h] = vals[i] ?? ''; });
            return row;
          });
          // Keep most recent week's entry per player
          const latest = {};
          for (const row of rows) {
            const name = row.full_name;
            if (!name) continue;
            const key = (parseInt(row.season) || 0) * 100 + (parseInt(row.week) || 0);
            if (!latest[name] || latest[name]._key < key) latest[name] = { ...row, _key: key };
          }
          for (const p of targets) {
            const row = latest[p.name] ?? latest[Object.keys(latest).find(n => n.toLowerCase() === p.name.toLowerCase())];
            if (!row) continue;
            const status = row.report_status || row.practice_status || '';
            if (status && !['', 'Active', 'Full Participation', 'DNE'].includes(status)) {
              const injury = row.report_primary_injury || row.practice_primary_injury || '';
              data[p.id] = { note: injury ? `${status} · ${injury}` : status, proj: null, source: src.name };
            }
          }
        }
      }

      else if (src.id === 'leaguelogs-api') {
        // LeagueLogs: fetch public NFL player stats — requires a free account token
        const proxyUrl = `${API_BASE}/api/v1/proxy?url=${encodeURIComponent('https://api.leaguelogs.com/v1/nfl/players?limit=500')}`;
        try {
          const res = await fetch(proxyUrl, { signal: AbortSignal.timeout(8000) });
          if (res.ok) {
            const json = await res.json();
            const list = json.players || json.data || json.results || [];
            for (const item of list) {
              const name = item.name || item.player_name || item.full_name || '';
              if (!name) continue;
              const match = targets.find(p => p.name.toLowerCase() === name.toLowerCase());
              if (!match) continue;
              const note = item.status || item.injury_status || null;
              if (note && note !== 'Active') data[match.id] = { note, proj: null, source: src.name };
            }
          }
        } catch {}
      }

      else if (src.id === 'apifootball') {
        // API-Football: single batch call to injuries endpoint (key required)
        const season = new Date().getFullYear() - 1; // current NFL season year
        const url = `https://v1.american-football.api-sports.io/injuries?league=1&season=${season}`;
        const proxyUrl = `${API_BASE}/api/v1/proxy?url=${encodeURIComponent(url)}&keyHeader=${encodeURIComponent(src.keyHeader)}&keyValue=${encodeURIComponent(src.apiKey || '')}`;
        try {
          const res = await fetch(proxyUrl, { signal: AbortSignal.timeout(12000) });
          if (res.ok) {
            const json = await res.json();
            for (const item of (json.response || [])) {
              const name = item.player?.name || item.player?.fullname || '';
              if (!name) continue;
              const match = targets.find(p => p.name.toLowerCase() === name.toLowerCase());
              if (!match || data[match.id]) continue;
              const note = item.status || item.type || null;
              if (note) data[match.id] = { note, proj: null, source: src.name };
            }
          }
        } catch {}
      }

      else if (src.kind === 'limited') {
        // Rate-limited: cap at 8 roster players per refresh to preserve daily quota
        const limited = targets.slice(0, 8);
        for (const p of limited) {
          let probeUrl = null;
          if (src.id === 'tank01') {
            const url = `https://tank01-fantasy-stats.p.rapidapi.com/getNFLPlayerInfo?playerName=${encodeURIComponent(p.name)}&getStats=true`;
            probeUrl = `${API_BASE}/api/v1/proxy?url=${encodeURIComponent(url)}&keyHeader=${encodeURIComponent(src.keyHeader)}&keyValue=${encodeURIComponent(src.apiKey)}&keyHost=${encodeURIComponent(src.keyHost || '')}`;
          } else if (src.id === 'sportsdb') {
            const url = `https://www.thesportsdb.com/api/v1/json/${src.apiKey || '3'}/searchplayers.php?p=${encodeURIComponent(p.name)}`;
            probeUrl = `${API_BASE}/api/v1/proxy?url=${encodeURIComponent(url)}`;
          } else if (src.id === 'mysportsfeeds') {
            const b64 = btoa(`${src.apiKey}:MYSPORTSFEEDS`);
            const url  = `https://api.mysportsfeeds.com/v2.1/pull/nfl/latest/player_stats_totals.json?player=${encodeURIComponent(p.name.replace(/ /g, '-'))}`;
            probeUrl = `${API_BASE}/api/v1/proxy?url=${encodeURIComponent(url)}&keyHeader=Authorization&keyValue=${encodeURIComponent('Basic ' + b64)}`;
          }
          if (!probeUrl) continue;
          try {
            const res = await fetch(probeUrl, { signal: AbortSignal.timeout(8000) });
            if (!res.ok) continue;
            const json = await res.json();
            // Parse each source's response shape
            let note = null, proj = null;
            if (src.id === 'tank01') {
              const pl = Array.isArray(json.body) ? json.body[0] : json.body;
              note = pl?.injury?.description || pl?.injuryStatus || null;
              proj = pl?.fantasyPoints?.halfPPR != null ? Number(pl.fantasyPoints.halfPPR) : null;
            } else if (src.id === 'apifootball') {
              const pl = json.response?.[0];
              note = pl?.injury?.status || pl?.games?.injuryDesignation || null;
            } else if (src.id === 'sportsdb') {
              const pl = json.player?.[0];
              note = pl?.strStatus || null;
            }
            if (note || proj != null) data[p.id] = { note, proj, source: src.name };
          } catch {}
        }
      }
    } catch {}

    const updatedCount = Object.keys(data).length;
    if (updatedCount > 0) {
      setLiveData(prev => {
        const next = { ...prev };
        for (const [pid, entry] of Object.entries(data)) {
          const existing = next[pid] || [];
          const filtered = existing.filter(e => e.sourceId !== src.id);
          if (entry.note || entry.proj != null || entry.liveStatus) {
            next[pid] = [...filtered, { ...entry, sourceId: src.id }];
          } else {
            next[pid] = filtered;
          }
        }
        return next;
      });
      // Push live proj values into the global player store so H2H + other screens stay in sync
      const projUpdates = Object.entries(data).filter(([, e]) => e.proj != null);
      if (projUpdates.length) {
        patchPlayers(p => {
          const match = projUpdates.find(([pid]) => Number(pid) === p.id);
          return match ? { ...p, proj: match[1].proj } : p;
        });
      }
    }
    setRefreshResults(prev => ({ ...prev, [src.id]: { updated: updatedCount, total: targets.length } }));
    setLastFetched(prev => ({ ...prev, [src.id]: Date.now() }));
    setFetchingSourceIds(prev => { const n = new Set(prev); n.delete(src.id); return n; });
  }

  function handleDragStart(e, playerId) {
    setDragId(playerId);
    e.dataTransfer.effectAllowed = 'move';
  }

  function handleDragOver(e, key) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDragOver(key);
  }

  // targetSlot: the slot being dropped onto; occupantId: the player already there (or null if empty)
  function handleDropOnSlot(e, targetSlot, occupantId) {
    e.preventDefault();
    if (!dragId || dragId === occupantId) { setDragId(null); setDragOver(null); return; }

    const dragEntry = fullRoster.find(r => r.playerId === dragId);
    if (!dragEntry) { setDragId(null); setDragOver(null); return; }

    const dragPlayer = findPlayer(dragId);

    if (!canFillSlot(dragPlayer?.pos, targetSlot)) {
      setSwapError(`${dragPlayer?.pos} can't play ${targetSlot}`);
      setTimeout(() => setSwapError(null), 2500);
      setDragId(null); setDragOver(null);
      return;
    }

    // Block moving a second DST into an active (non-bench) slot
    if (dragPlayer?.pos === 'DST' && targetSlot !== 'BENCH' && !occupantId) {
      const activeDsts = fullRoster.filter(r => r.playerId && r.slot !== 'BENCH' && findPlayer(r.playerId)?.pos === 'DST' && r.playerId !== dragId);
      if (activeDsts.length >= 1) {
        setSwapError('Only 1 active DST allowed — bench the current DST first');
        setTimeout(() => setSwapError(null), 2500);
        setDragId(null); setDragOver(null);
        return;
      }
    }

    if (!occupantId) {
      onSlotOverridesChange?.({ ...slotOverrides, [dragId]: targetSlot });
    } else {
      const dropPlayer = findPlayer(occupantId);
      if (canFillSlot(dropPlayer?.pos, dragEntry.slot)) {
        onSlotOverridesChange?.({ ...slotOverrides, [dragId]: targetSlot, [occupantId]: dragEntry.slot });
      } else {
        onSlotOverridesChange?.({ ...slotOverrides, [dragId]: targetSlot, [occupantId]: 'BENCH' });
      }
    }
    setDragId(null); setDragOver(null);
  }

  function handleDragEnd() { setDragId(null); setDragOver(null); }

  // All players rostered on any team in the league (used for FA filter)
  const allRosteredIds = React.useMemo(
    () => new Set(Object.values(TEAM_ROSTERS).flatMap(entries => entries.map(e => e.playerId).filter(Boolean))),
    []
  );

  // Available players for Add tab
  const rosterIds = new Set(fullRoster.map(r => r.playerId).filter(Boolean));
  const available = allPlayers.filter(p => {
    if (rosterIds.has(p.id)) return false;
    if (addFilter === 'FLEX' && !['RB', 'WR'].includes(p.pos)) return false;
    if (addFilter !== 'ALL' && addFilter !== 'FLEX' && p.pos !== addFilter) return false;
    if (addSearch && !p.name.toLowerCase().includes(addSearch.toLowerCase())) return false;
    return true;
  }).sort((a, b) => b.proj - a.proj);

  // Swap-picker options (bench moves + top free agents for the targeted slot)
  const swapBenchOpts = swapTarget
    ? fullRoster.filter(r => r.slot === 'BENCH' && r.playerId && r.playerId !== swapTarget.playerId && canFillSlot(findPlayer(r.playerId)?.pos, swapTarget.slot))
    : [];
  const swapFAOpts = swapTarget
    ? allPlayers.filter(p => !allRosteredIds.has(p.id) && canFillSlot(p.pos, swapTarget.slot)).sort((a, b) => (a.ecr || 999) - (b.ecr || 999)).slice(0, 15)
    : [];

  // Build news feed for this roster
  const rosterPlayerIds = new Set(fullRoster.map(r => r.playerId).filter(Boolean));
  const rosterPlayers   = allPlayers.filter(p => rosterPlayerIds.has(p.id));

  // All merged articles sorted newest-first, tagged with isRostered + matched player.
  // Uses the same 3-source merge as News & Updates.
  const allNewsArticles = React.useMemo(() => {
    if (!mergedArticles.length) return [];
    const rosterByNorm = new Map(rosterPlayers.map(p => [normalizeName(p.name), p]));
    return mergedArticles
      .filter(a => a.headline && a.article_url)
      .map(a => {
        const normKey = normalizeName(a.player_name || '');
        const player = rosterByNorm.get(normKey) || null;
        return { article: a, isRostered: !!player, player };
      });
  }, [mergedArticles, rosterPlayers]);

  // Roster-only subset — used for the "My Roster" filter mode
  const rosterNewsArticles = React.useMemo(
    () => allNewsArticles.filter(x => x.isRostered),
    [allNewsArticles],
  );

  // Name → roster player lookup for R2 matching
  const rosterByName = React.useMemo(() => {
    const m = {};
    for (const p of rosterPlayers) {
      m[p.name.toLowerCase().trim()] = p;
      const last = p.name.split(' ').slice(-1)[0].toLowerCase();
      if (last.length > 3) m[last] = m[last] || p; // last-name fallback, no clobber
    }
    return m;
  }, [rosterPlayers]);

  function matchRosterPlayer(name = '') {
    const key = name.toLowerCase().trim();
    return rosterByName[key] || rosterByName[key.split(' ').slice(-1)[0]] || null;
  }

  // Build news feed from R2 tables (replaces static Beat Writer)
  const r2RosterNews = React.useMemo(() => {
    const items = [];
    const coveredByEnriched = new Set();

    // 1. enriched_news — real articles tagged to players
    const enrichedArr = Array.isArray(r2EnrichedNews) ? r2EnrichedNews : [];
    for (const article of enrichedArr) {
      const names = Array.isArray(article.mentioned_players) ? article.mentioned_players : [];
      const matchedPlayers = names.map(n => matchRosterPlayer(n)).filter(p => p && rosterPlayerIds.has(p.id));
      if (!matchedPlayers.length && article.primary_player_id) {
        const p = matchRosterPlayer(article.primary_player_id);
        if (p && rosterPlayerIds.has(p.id)) matchedPlayers.push(p);
      }
      for (const p of matchedPlayers) {
        coveredByEnriched.add(p.id);
        const publishedAt = article.published_at ? new Date(article.published_at) : null;
        const minsAgo = publishedAt ? Math.max(0, Math.floor((Date.now() - publishedAt.getTime()) / 60000)) : 9999;
        let sourceLabel = 'FantasAI News';
        try { sourceLabel = new URL(article.source_url).hostname.replace(/^www\./, ''); } catch {}
        items.push({
          id:        `r2-enriched-${p.id}-${article.published_at || Math.random()}`,
          playerId:  p.id,
          impact:    'med',
          title:     article.headline || `${p.name} Update`,
          body:      article.full_text || '',
          mins:      minsAgo,
          source:    sourceLabel,
          publishedAt: publishedAt?.toISOString() || null,
          sourceUrl: article.source_url || null,
        });
      }
    }

    // 2. player_notes — per-player intelligence (skip players already covered above)
    const notesArr = Array.isArray(r2PlayerNotes) ? r2PlayerNotes : [];
    for (const pn of notesArr) {
      if (!pn.notes?.length) continue;
      const p = matchRosterPlayer(pn.player_name || '');
      if (!p || !rosterPlayerIds.has(p.id) || coveredByEnriched.has(p.id)) continue;
      const note   = pn.notes[0];
      const impact = pn.has_critical_news || note.priority === 'critical' ? 'high'
                   : pn.has_injury_concern || note.priority === 'high'    ? 'med'
                   : note.impact_direction === 'positive'                  ? 'good'
                   : 'low';
      const publishedAt = note.published_at ? new Date(note.published_at) : null;
      const minsAgo = publishedAt ? Math.max(0, Math.floor((Date.now() - publishedAt.getTime()) / 60000))
                    : pn.last_updated ? Math.max(0, Math.floor((Date.now() - new Date(pn.last_updated).getTime()) / 60000))
                    : 9999;
      items.push({
        id:        `r2-note-${p.id}`,
        playerId:  p.id,
        impact,
        title:     note.note_text || `${p.name} Update`,
        body:      pn.notes.map(n => n.note_text).filter(Boolean).join('\n\n'),
        mins:      minsAgo,
        source:    'FantasAI',
        publishedAt: publishedAt?.toISOString() || pn.last_updated || null,
        overallImpact: pn.overall_impact_score ?? null,
      });
    }

    return items;
  }, [r2EnrichedNews, r2PlayerNotes, rosterPlayerIds, rosterByName]); // eslint-disable-line react-hooks/exhaustive-deps

  const allRosterNews = React.useMemo(() => [
    ...NEWS.filter(n => rosterPlayerIds.has(n.playerId)),
    ...r2RosterNews,
  ].sort((a, b) => {
    const aUrgent = a.impact === 'high' || deriveStatus(a.playerId) !== 'OK';
    const bUrgent = b.impact === 'high' || deriveStatus(b.playerId) !== 'OK';
    if (aUrgent !== bUrgent) return aUrgent ? -1 : 1;
    return a.mins - b.mins;
  }), [r2RosterNews, rosterPlayerIds]); // eslint-disable-line react-hooks/exhaustive-deps

  const injuryCount = rosterPlayers.filter(p => deriveStatus(p.id) !== 'OK').length;

  // Position roster-total maxes from League Settings (e.g. QB → 2, RB → Infinity)
  const posMaxMap = React.useMemo(() => {
    try {
      const saved = JSON.parse(localStorage.getItem('fantasai_league_settings') || 'null');
      const positions = saved?.positions ?? [];
      const map = {};
      for (const p of positions) {
        map[p.key] = p.rosterTotal === 'No Limit' ? Infinity : parseInt(p.rosterTotal, 10);
      }
      return map;
    } catch { return {}; }
  }, []);

  // H2H matchup for current week — S3 schedule takes priority over local fallback
  const myMatchup = React.useMemo(() => {
    const weekMatchups = (s3Schedule && (s3Schedule[H2H_WEEK] || s3Schedule[String(H2H_WEEK)])) || H2H_SCHEDULE[H2H_WEEK - 1] || [];
    const pair = weekMatchups.find(([a, b]) => a === teamId || b === teamId);
    if (!pair) return null;
    const oppId = pair[0] === teamId ? pair[1] : pair[0];
    const myProj  = h2hScore(teamId, H2H_WEEK);
    const oppProj = h2hScore(oppId, H2H_WEEK);
    const winPct  = myProj / (myProj + oppProj);
    return { oppId, myProj, oppProj, winPct };
  }, [teamId]);

  function confirmDrop(entry) {
    setDropConfirm(entry);
  }

  function executeDrop(entry) {
    onDropPlayer?.(entry.playerId);
    setDropConfirm(null);
  }

  return (
    <div className="col" style={{ height: '100%' }}>

      {/* Page header */}
      <div className="page-head">
        {/* Left — logo + title + projected scores */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <TeamLogoBadge team={team} size={48} />
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 2 }}>
              <h1 style={{ margin: 0 }}>Current Roster</h1>
              {rosterSyncBadge && (
                <span style={{
                  display: 'inline-flex', alignItems: 'center', gap: 5,
                  fontSize: 11, fontWeight: 600, padding: '3px 9px', borderRadius: 20,
                  border: `1px solid ${rosterSyncBadge === 'saving' ? '#555' : rosterSyncBadge === 'saved' ? '#c6ff3a' : '#ff5a6e'}`,
                  color: rosterSyncBadge === 'saving' ? '#aaa' : rosterSyncBadge === 'saved' ? '#c6ff3a' : '#ff5a6e',
                }}>
                  <span style={{ width: 6, height: 6, borderRadius: '50%', display: 'inline-block',
                    background: rosterSyncBadge === 'saving' ? '#888' : rosterSyncBadge === 'saved' ? '#c6ff3a' : '#ff5a6e' }} />
                  {rosterSyncBadge === 'saving' ? 'Saving…' : rosterSyncBadge === 'saved' ? 'Saved' : 'Save Failed'}
                </span>
              )}
            </div>
            <div className="sub" style={{ marginBottom: 4 }}>
              {team?.name || 'My Team'} · {fullRoster.filter(r => r.playerId).length} players
            </div>
            {myMatchup && (() => {
              const _opp     = LEAGUE_TEAMS.find(t => t.id === myMatchup.oppId);
              const _projWin = Math.round(myMatchup.winPct * 100);
              const _myAcc   = starters.reduce((s, e) => {
                const p = e.playerId ? findPlayer(e.playerId) : null;
                return s + (p ? buildScoringBreakdown(p, H2H_WEEK).accumulated : 0);
              }, 0);
              const _oppSt  = (TEAM_ROSTERS[myMatchup.oppId] || []).filter(r => r.slot !== 'BENCH' && r.playerId);
              const _oppAcc = _oppSt.reduce((s, e) => {
                const p = e.playerId ? findPlayer(e.playerId) : null;
                return s + (p ? buildScoringBreakdown(p, H2H_WEEK).accumulated : 0);
              }, 0);
              const _isWin  = _myAcc >= _oppAcc;
              const _liveWin = Math.round(_myAcc + _oppAcc > 0 ? _myAcc / (_myAcc + _oppAcc) * 100 : _projWin);
              return (
                <div
                  style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6, cursor: 'pointer', flexWrap: 'wrap' }}
                  onClick={() => setMatchupExpanded(e => !e)}
                >
                  <span style={{ fontSize: 9, fontFamily: 'var(--font-mono)', fontWeight: 700, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '.08em', flexShrink: 0 }}>Wk {H2H_WEEK}</span>
                  <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-dim)' }}>vs {_opp?.name}</span>
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-dim)' }}>{_myAcc.toFixed(1)} – {_oppAcc.toFixed(1)}</span>
                  <span style={{ fontSize: 11, fontWeight: 800, color: _isWin ? '#4caf82' : 'var(--danger)' }}>
                    {_isWin ? '▲' : '▼'} {_liveWin}% live · Proj {_projWin}%
                  </span>
                  <span style={{ fontSize: 10, color: 'var(--text-faint)' }}>{matchupExpanded ? '▲' : '▼'}</span>
                </div>
              );
            })()}
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: 20 }}>
              <div>
                <div style={{ fontSize: 9, fontFamily: 'var(--font-mono)', fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--text-faint)', marginBottom: 1 }}>Base Proj</div>
                <div style={{ fontFamily: 'var(--font-display)', fontWeight: 900, fontStretch: '75%', fontSize: 22, color: 'var(--accent)', lineHeight: 1 }}>
                  {totalProj.toFixed(1)}
                </div>
              </div>
              {cbsNewsCount > 0 && (
                <div>
                  <div style={{ fontSize: 9, fontFamily: 'var(--font-mono)', fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase', color: cbsNewsColor, marginBottom: 1 }}>CBS News</div>
                  <div style={{ fontFamily: 'var(--font-display)', fontWeight: 900, fontStretch: '75%', fontSize: 22, color: cbsNewsColor, lineHeight: 1 }}>
                    {cbsNewsCount}/{cbsTotalCount}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 8 }}>
          {activatedSources.length > 0 && (
            <>
              <button
                className="btn sm"
                style={{ fontSize: 11, whiteSpace: 'nowrap', background: 'rgba(198,255,58,.08)', borderColor: 'rgba(198,255,58,.35)', color: 'var(--accent)', fontWeight: 700, padding: '6px 14px' }}
                disabled={fetchingSourceIds.size > 0}
                onClick={() => activatedSources.forEach(src => handleRefreshSource(src))}
              >
                {fetchingSourceIds.size > 0
                  ? `⟳ Refreshing (${fetchingSourceIds.size}/${activatedSources.length} sources)…`
                  : '↻ Refresh My Roster News'}
              </button>
              {Object.keys(refreshResults).length > 0 && (
                <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                  {activatedSources.filter(src => refreshResults[src.id]).map(src => {
                    const { updated, total } = refreshResults[src.id];
                    return (
                      <span key={src.id} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 10, fontFamily: 'var(--font-mono)' }}>
                        <span style={{ color: updated > 0 ? src.color : 'var(--text-faint)', fontWeight: 700 }}>{src.name}</span>
                        <span style={{ color: updated > 0 ? src.color : 'var(--text-faint)', opacity: 0.85 }}>{updated}/{total}</span>
                      </span>
                    );
                  })}
                </div>
              )}
              <button
                className="btn sm"
                style={{ fontSize: 11, whiteSpace: 'nowrap', background: 'rgba(78,168,255,.08)', borderColor: 'rgba(78,168,255,.35)', color: '#4ea8ff', fontWeight: 700, padding: '6px 14px' }}
                disabled={weatherRefreshing}
                onClick={handleWeatherRefresh}
              >
                {weatherRefreshing ? '⟳ Fetching weather…' : '⛅ Refresh Weather'}
              </button>
              {weatherRateMsg && (
                <div style={{ fontSize: 9, fontFamily: 'var(--font-mono)', color: 'var(--text-faint)', textAlign: 'right' }}>{weatherRateMsg}</div>
              )}
              {weatherRefreshedAt && !weatherRateMsg && (
                <div style={{ fontSize: 9, fontFamily: 'var(--font-mono)', color: '#4ea8ff', opacity: 0.75, textAlign: 'right' }}>
                  Weather updated {fmtTs(weatherRefreshedAt)}
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="tabs" style={{ padding: '0 18px' }}>
        <div className={`tab ${tab === 'roster' ? 'active' : ''}`} onClick={() => setTab('roster')}>My Roster</div>
        <div className={`tab ${tab === 'lineup' ? 'active' : ''}`} onClick={() => setTab('lineup')}>🎯 Lineup Decisions</div>
        <div className={`tab ${tab === 'add' ? 'active' : ''}`} onClick={() => setTab('add')}>Add Player</div>
        <div className={`tab ${tab === 'news' ? 'active' : ''}`} onClick={() => setTab('news')}>
          News &amp; Updates
          {injuryCount > 0 && (
            <span style={{ marginLeft: 6, background: 'var(--danger)', color: '#fff', fontSize: 10, fontWeight: 700, padding: '1px 5px', borderRadius: 10, fontFamily: 'var(--font-mono)' }}>
              {injuryCount}
            </span>
          )}
        </div>
        <div className={`tab ${tab === 'defense' ? 'active' : ''}`} onClick={() => setTab('defense')}>🛡 Defense Rankings</div>
        <div className={`tab ${tab === 'watchlist' ? 'active' : ''}`} onClick={() => setTab('watchlist')}>
          Watchlist
          {watchlistIds.size > 0 && (
            <span style={{ marginLeft: 6, background: '#ffd700', color: '#1a1200', fontSize: 10, fontWeight: 700, padding: '1px 5px', borderRadius: 10, fontFamily: 'var(--font-mono)' }}>
              {watchlistIds.size}
            </span>
          )}
        </div>
      </div>

      {/* Roster tab */}
      {tab === 'roster' && rosterLoading && (
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 12, padding: 60, color: 'var(--text-dim)', fontSize: 14 }}>
          <div style={{ width: 28, height: 28, border: '3px solid var(--border)', borderTopColor: 'var(--accent)', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
          Loading roster from R2…
        </div>
      )}
      {tab === 'roster' && !rosterLoading && (
        <div style={{ flex: 1, overflow: 'auto' }}>
          <DropCandidatesPanel myRosterIds={myRosterIds} onOpenPlayer={onOpenPlayer} />
          {/* Incoming trade offers */}
          {(() => {
            const incoming = tradeOffers.filter(o => o.toTeamId === (user?.teamId) && o.status === 'pending');
            if (!incoming.length) return null;
            return (
              <div style={{ margin: '10px 18px 0', display: 'flex', flexDirection: 'column', gap: 8 }}>
                {incoming.map(offer => {
                  const fromTeam = findTeam(offer.fromTeamId);
                  const givePlayers = offer.giveIds.map(id => findPlayer(id)).filter(Boolean);
                  const getPlayers  = offer.getIds.map(id => findPlayer(id)).filter(Boolean);
                  return (
                    <div key={offer.id} style={{ borderRadius: 8, border: '1px solid rgba(255,215,0,.4)', background: 'rgba(255,215,0,.07)', padding: '10px 14px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                        <span style={{ fontSize: 13, fontWeight: 800 }}>↔ Trade Offer</span>
                        <span style={{ fontSize: 11, color: 'var(--text-dim)' }}>from</span>
                        <span style={{ fontSize: 12, fontWeight: 700, color: '#FFD700' }}>{fromTeam?.name || `Team ${offer.fromTeamId}`}</span>
                        <span style={{ fontSize: 10, color: 'var(--text-faint)', marginLeft: 'auto', fontFamily: 'var(--font-mono)' }}>
                          {new Date(offer.sentAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                        </span>
                      </div>
                      <div style={{ display: 'flex', gap: 16, marginBottom: 10, flexWrap: 'wrap' }}>
                        <div style={{ flex: 1, minWidth: 140 }}>
                          <div style={{ fontSize: 9, fontFamily: 'var(--font-mono)', fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--good)', marginBottom: 4 }}>You Receive</div>
                          {givePlayers.map(p => (
                            <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, marginBottom: 3 }}>
                              <span style={{ fontSize: 9, fontFamily: 'var(--font-mono)', fontWeight: 700, background: 'rgba(76,175,130,.15)', color: 'var(--good)', border: '1px solid rgba(76,175,130,.3)', borderRadius: 3, padding: '0 4px' }}>{p.pos}</span>
                              <span style={{ fontWeight: 600 }}>{p.name}</span>
                              <span style={{ color: 'var(--text-faint)', fontSize: 11 }}>{p.team} · {p.avg.toFixed(1)}</span>
                            </div>
                          ))}
                          {givePlayers.length === 0 && <span style={{ fontSize: 11, color: 'var(--text-faint)' }}>—</span>}
                        </div>
                        <div style={{ width: 1, background: 'rgba(255,215,0,.2)' }} />
                        <div style={{ flex: 1, minWidth: 140 }}>
                          <div style={{ fontSize: 9, fontFamily: 'var(--font-mono)', fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--danger)', marginBottom: 4 }}>You Give Up</div>
                          {getPlayers.map(p => (
                            <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, marginBottom: 3 }}>
                              <span style={{ fontSize: 9, fontFamily: 'var(--font-mono)', fontWeight: 700, background: 'rgba(255,90,110,.12)', color: 'var(--danger)', border: '1px solid rgba(255,90,110,.3)', borderRadius: 3, padding: '0 4px' }}>{p.pos}</span>
                              <span style={{ fontWeight: 600 }}>{p.name}</span>
                              <span style={{ color: 'var(--text-faint)', fontSize: 11 }}>{p.team} · {p.avg.toFixed(1)}</span>
                            </div>
                          ))}
                          {getPlayers.length === 0 && <span style={{ fontSize: 11, color: 'var(--text-faint)' }}>—</span>}
                        </div>
                      </div>
                      <div style={{ display: 'flex', gap: 8 }}>
                        <button
                          className="btn primary sm"
                          style={{ background: 'var(--good)', color: '#042210', borderColor: 'var(--good)' }}
                          onClick={() => onRespondTradeOffer?.(offer.id, 'accepted')}
                        >
                          ✓ Accept Trade
                        </button>
                        <button
                          className="btn ghost sm"
                          style={{ color: 'var(--danger)', borderColor: 'rgba(255,90,110,.4)' }}
                          onClick={() => onRespondTradeOffer?.(offer.id, 'declined')}
                        >
                          ✕ Decline
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            );
          })()}
          {swapError && (
            <div style={{
              margin: '8px 18px 0', padding: '8px 14px', borderRadius: 6,
              background: 'rgba(255,59,48,.12)', border: '1px solid rgba(255,59,48,.3)',
              color: 'var(--danger)', fontSize: 12, fontFamily: 'var(--font-mono)',
              display: 'flex', alignItems: 'center', gap: 8,
            }}>
              ✕ Invalid move — {swapError}
            </div>
          )}
          <div style={{ padding: '6px 18px 0', display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
            <span className="faint mono" style={{ fontSize: 10, marginRight: 4 }}>SLOTS</span>
            {ROSTER_CONFIG.slots.map(s => {
              const color = slotColor(s.slot);
              // Single-position slots: count all of that position on roster vs rules max
              // Multi-position slots (FLEX): count filled starter slots vs slot count
              const singlePos = s.eligible?.length === 1 ? s.eligible[0] : null;
              let filled, max, maxLabel;
              if (singlePos) {
                filled = fullRoster.filter(r => r.playerId && findPlayer(r.playerId)?.pos === singlePos).length;
                max    = posMaxMap[singlePos] ?? Infinity;
                maxLabel = isFinite(max) ? String(max) : '∞';
              } else {
                filled   = fullRoster.filter(r => r.slot === s.slot && r.playerId).length;
                max      = s.count;
                maxLabel = String(s.count);
              }
              const isFull = isFinite(max) ? filled >= max : false;
              return (
                <span key={s.slot} style={{
                  fontSize: 10, fontFamily: 'var(--font-mono)', padding: '2px 8px', borderRadius: 4,
                  background: `${color}22`, border: `1px solid ${color}55`,
                  color: isFull ? color : 'var(--text-dim)',
                  display: 'flex', alignItems: 'center', gap: 4,
                }}>
                  <span style={{ fontWeight: 800 }}>{s.slot}</span>
                  <span style={{ opacity: 0.7 }}>{filled}/{maxLabel}</span>
                </span>
              );
            })}
            {(() => {
              const benchFilled = fullRoster.filter(r => r.slot === 'BENCH' && r.playerId).length;
              const isFull = benchFilled >= ROSTER_CONFIG.bench;
              return (
                <span style={{
                  fontSize: 10, fontFamily: 'var(--font-mono)', padding: '2px 8px', borderRadius: 4,
                  background: 'rgba(255,255,255,.06)', border: '1px solid var(--border)',
                  color: isFull ? 'var(--text)' : 'var(--text-faint)',
                  display: 'flex', alignItems: 'center', gap: 4,
                }}>
                  <span style={{ fontWeight: 800 }}>BN</span>
                  <span style={{ opacity: 0.7 }}>{benchFilled}/{ROSTER_CONFIG.bench}</span>
                </span>
              );
            })()}
            <span style={{ fontSize: 10, color: 'var(--text-faint)', fontFamily: 'var(--font-mono)' }}>
              Total {fullRoster.filter(r => r.playerId).length}/{(ROSTER_CONFIG.slots.reduce((s, x) => s + x.count, 0) + ROSTER_CONFIG.bench)}
            </span>
          </div>
          {myMatchup && (() => {
            const opp        = LEAGUE_TEAMS.find(t => t.id === myMatchup.oppId);
            const myTeam     = findTeam(teamId);
            const oppRoster  = TEAM_ROSTERS[myMatchup.oppId] || [];
            const oppStarters = oppRoster.filter(r => r.slot !== 'BENCH' && r.playerId);

            // Accumulated scores (raw simulated, pre-normalization)
            const myAccum  = starters.reduce((s, e) => {
              const p = e.playerId ? findPlayer(e.playerId) : null;
              return s + (p ? buildScoringBreakdown(p, H2H_WEEK).accumulated : 0);
            }, 0);
            const oppAccum = oppStarters.reduce((s, e) => {
              const p = e.playerId ? findPlayer(e.playerId) : null;
              return s + (p ? buildScoringBreakdown(p, H2H_WEEK).accumulated : 0);
            }, 0);

            const isWinning    = myAccum >= oppAccum;
            const liveWinPct   = myAccum + oppAccum > 0 ? myAccum / (myAccum + oppAccum) : 0.5;
            const liveWinDisp  = Math.round(liveWinPct * 100);
            const projWinDisp  = Math.round(myMatchup.winPct * 100);
            const deltaWin     = liveWinDisp - projWinDisp;

            // ScoringRows: shows code badge, accumulated vs proj arrow, per-category bars
            function ScoringRows({ entry, accentColor }) {
              const p = entry.playerId ? findPlayer(entry.playerId) : null;
              if (!p) return null;
              const { items: breakdown, accumulated } = buildScoringBreakdown(p, H2H_WEEK);
              const ahead = accumulated >= p.proj;
              const arrowColor = ahead ? '#4caf82' : 'var(--danger)';
              return (
                <div style={{ background: 'rgba(255,255,255,.04)', borderRadius: 6, overflow: 'hidden', marginBottom: 5 }}>
                  {/* Player header */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 10px', borderBottom: '1px solid rgba(255,255,255,.07)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 5, minWidth: 0, flex: 1 }}>
                      <span style={{ fontSize: 9, fontFamily: 'var(--font-mono)', color: 'var(--text-faint)', background: 'rgba(255,255,255,.08)', padding: '1px 5px', borderRadius: 3, flexShrink: 0 }}>{entry.slot}</span>
                      <span style={{ fontWeight: 700, fontSize: 14, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.name}</span>
                      <span style={{ fontSize: 10, color: 'var(--text-faint)', flexShrink: 0 }}>{p.team}</span>
                    </div>
                    {/* Accumulated vs projected with arrow */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0, marginLeft: 6 }}>
                      <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 900, fontSize: 13, color: arrowColor }}>
                        {accumulated.toFixed(1)}
                      </span>
                      <span style={{ fontSize: 11, fontWeight: 900, color: arrowColor, lineHeight: 1 }}>
                        {ahead ? '▲' : '▼'}
                      </span>
                      <span style={{ fontSize: 10, color: 'var(--text-faint)', fontFamily: 'var(--font-mono)' }}>
                        /{p.proj.toFixed(1)}
                      </span>
                    </div>
                  </div>
                  {/* Per-category rows with code badge */}
                  {breakdown.map((item, i) => {
                    const barPct = p.proj > 0 ? Math.max(0, Math.min(100, (Math.abs(item.pts) / p.proj) * 100)) : 0;
                    const isNeg  = item.pts < 0;
                    return (
                      <div key={i} style={{ padding: '3px 10px', borderBottom: i < breakdown.length - 1 ? '1px solid rgba(255,255,255,.04)' : 'none' }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 4 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 4, minWidth: 0, flex: 1 }}>
                            <span style={{ fontSize: 9, fontFamily: 'var(--font-mono)', color: accentColor, background: `${accentColor}22`, padding: '1px 4px', borderRadius: 2, flexShrink: 0, letterSpacing: '.02em', fontWeight: 700 }}>
                              {item.code}
                            </span>
                            <span style={{ fontSize: 10, color: 'var(--text-dim)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{item.label}</span>
                            <span style={{ fontSize: 9, fontFamily: 'var(--font-mono)', color: 'var(--text-faint)', flexShrink: 0 }}>{item.statStr}</span>
                            {item.bonusLabel && (
                              <span style={{ fontSize: 8, fontFamily: 'var(--font-mono)', color: '#ffd700', flexShrink: 0 }}>{item.bonusLabel}</span>
                            )}
                          </div>
                          <span style={{ fontSize: 11, fontFamily: 'var(--font-mono)', fontWeight: 700, color: isNeg ? 'var(--danger)' : item.pts === 0 ? 'var(--text-faint)' : 'var(--text)', flexShrink: 0, minWidth: 34, textAlign: 'right' }}>
                            {item.pts > 0 ? '+' : ''}{item.pts.toFixed(1)}
                          </span>
                        </div>
                        <div style={{ height: 2, background: 'rgba(255,255,255,.06)', borderRadius: 1, marginTop: 2 }}>
                          <div style={{ height: '100%', width: `${barPct}%`, background: isNeg ? 'var(--danger)' : accentColor, borderRadius: 1, opacity: 0.55, transition: 'width .3s' }} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              );
            }

            // Compact bench row
            function BenchRow({ entry }) {
              const p = entry.playerId ? findPlayer(entry.playerId) : null;
              if (!p) return null;
              const { accumulated } = buildScoringBreakdown(p, H2H_WEEK);
              const ahead = accumulated >= p.proj;
              return (
                <div style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '3px 6px', borderRadius: 3, marginBottom: 2, background: 'rgba(255,255,255,.02)' }}>
                  <span style={{ fontSize: 8, fontFamily: 'var(--font-mono)', color: 'var(--text-faint)', background: 'rgba(255,255,255,.06)', padding: '1px 4px', borderRadius: 2, flexShrink: 0 }}>BN</span>
                  <span style={{ fontSize: 11, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--text-dim)' }}>{p.name}</span>
                  <span style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: ahead ? '#4caf82' : 'var(--danger)', fontWeight: 700 }}>{accumulated.toFixed(1)}</span>
                  <span style={{ fontSize: 9, color: ahead ? '#4caf82' : 'var(--danger)' }}>{ahead ? '▲' : '▼'}</span>
                  <span style={{ fontSize: 9, color: 'var(--text-faint)', fontFamily: 'var(--font-mono)' }}>/{p.proj.toFixed(1)}</span>
                </div>
              );
            }

            const myBench  = fullRoster.filter(r => r.slot === 'BENCH' && r.playerId);

            return matchupExpanded ? (
                  <div style={{
                    margin: '0 18px 8px',
                    background: 'var(--panel)', border: '1px solid var(--border)',
                    borderRadius: 8, padding: '12px 14px',
                  }}>

                    {/* Win probability bar */}
                    <div style={{ marginBottom: 14 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 5 }}>
                        <div style={{ display: 'flex', alignItems: 'baseline', gap: 5 }}>
                          <span style={{ fontSize: 10, fontWeight: 800, color: 'var(--accent)', textTransform: 'uppercase', letterSpacing: '.06em' }}>{myTeam?.name}</span>
                          <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 900, fontSize: 16, color: isWinning ? '#4caf82' : 'var(--text)' }}>{myAccum.toFixed(1)}</span>
                          <span style={{ fontSize: 10, color: 'var(--text-faint)', fontFamily: 'var(--font-mono)' }}>pts</span>
                        </div>
                        <div style={{ textAlign: 'center' }}>
                          <div style={{ fontSize: 12, fontWeight: 900, fontFamily: 'var(--font-display)', color: isWinning ? '#4caf82' : 'var(--danger)', letterSpacing: '.04em' }}>
                            {isWinning ? '▲ LEADING' : '▼ TRAILING'} {Math.abs(myAccum - oppAccum).toFixed(1)} pts
                          </div>
                          <div style={{ fontSize: 10, color: 'var(--text-faint)', fontFamily: 'var(--font-mono)' }}>
                            {liveWinDisp}% live win · proj {projWinDisp}% ({deltaWin > 0 ? '+' : ''}{deltaWin}%)
                          </div>
                          <div style={{ fontSize: 9, color: 'var(--text-faint)', fontFamily: 'var(--font-mono)', marginTop: 2 }}>
                            Projected Final: <span style={{ color: 'var(--accent)', fontWeight: 700 }}>{myMatchup.myProj.toFixed(1)}</span>
                            {' – '}
                            <span style={{ color: opp?.color || 'var(--text-dim)', fontWeight: 700 }}>{myMatchup.oppProj.toFixed(1)}</span>
                          </div>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'baseline', gap: 5 }}>
                          <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 900, fontSize: 16, color: !isWinning ? '#4caf82' : 'var(--text)' }}>{oppAccum.toFixed(1)}</span>
                          <span style={{ fontSize: 10, color: 'var(--text-faint)', fontFamily: 'var(--font-mono)' }}>pts</span>
                          <span style={{ fontSize: 10, fontWeight: 800, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '.06em' }}>{opp?.name}</span>
                        </div>
                      </div>
                      {/* Bar */}
                      <div style={{ height: 7, background: opp?.color || '#555', borderRadius: 4, overflow: 'hidden' }}>
                        <div style={{ height: '100%', width: `${liveWinDisp}%`, background: myTeam?.color || 'var(--accent)', borderRadius: 4, transition: 'width .5s ease' }} />
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 3 }}>
                        <span style={{ fontSize: 9, fontFamily: 'var(--font-mono)', color: myTeam?.color || 'var(--accent)', fontWeight: 700 }}>{liveWinDisp}%</span>
                        <span style={{ fontSize: 9, fontFamily: 'var(--font-mono)', color: opp?.color || 'var(--text-faint)', fontWeight: 700 }}>{100 - liveWinDisp}%</span>
                      </div>
                    </div>

                    {/* Two-column player scoring */}
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                      {/* My team */}
                      <div>
                        <div style={{ fontSize: 9, fontWeight: 800, color: 'var(--accent)', textTransform: 'uppercase', letterSpacing: '.08em', marginBottom: 6 }}>
                          Starters
                        </div>
                        {starters.map((entry, i) => (
                          <ScoringRows key={entry.playerId || i} entry={entry} accentColor={myTeam?.color || 'var(--accent)'} />
                        ))}
                        {starters.length === 0 && (
                          <div style={{ fontSize: 12, color: 'var(--text-faint)', padding: '12px 0', textAlign: 'center' }}>No starters set</div>
                        )}
                        {/* Bench (collapsed) */}
                        {myBench.length > 0 && (
                          <div style={{ marginTop: 6, borderTop: '1px solid rgba(255,255,255,.06)', paddingTop: 5 }}>
                            <div style={{ fontSize: 8, color: 'var(--text-faint)', fontFamily: 'var(--font-mono)', textTransform: 'uppercase', letterSpacing: '.1em', marginBottom: 3 }}>Bench</div>
                            {myBench.map((entry, i) => <BenchRow key={entry.playerId || i} entry={entry} />)}
                          </div>
                        )}
                      </div>
                      {/* Opponent */}
                      <div>
                        <div style={{ fontSize: 9, fontWeight: 800, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '.08em', marginBottom: 6 }}>
                          {opp?.name} — Starters
                        </div>
                        {oppStarters.map((entry, i) => (
                          <ScoringRows key={entry.playerId || i} entry={entry} accentColor={opp?.color || '#888'} />
                        ))}
                        {oppStarters.length === 0 && (
                          <div style={{ fontSize: 12, color: 'var(--text-faint)', padding: '12px 0', textAlign: 'center' }}>Roster not set</div>
                        )}
                      </div>
                    </div>

                    <div style={{ marginTop: 10, fontSize: 9, color: 'var(--text-faint)', fontFamily: 'var(--font-mono)', textAlign: 'center', borderTop: '1px solid var(--border)', paddingTop: 7 }}>
                      Simulated live scoring · ▲ = ahead of projection · ▼ = behind · yard bonuses in yellow
                    </div>
                  </div>
            ) : null;
          })()}

          <table className="data-table">
            <thead>
              <tr>
                <th style={{ paddingRight: 4, width: 1, whiteSpace: 'nowrap' }}>Slot</th>
                <th>Player</th>
                <th className="num">Proj</th>
                <th className="num">Last</th>
                <th className="num">Avg</th>
                <th className="num">Trend</th>
                <th className="num">Opp Sc</th>
                <th>Opp</th>
                <th className="num">Bye</th>
                <th>Status</th>
                <th style={{ whiteSpace: 'nowrap' }}>
                  Weather
                  {weatherRefreshedAt && (
                    <div style={{ fontSize: 8, fontFamily: 'var(--font-mono)', color: '#4ea8ff', fontWeight: 400, marginTop: 2 }}>
                      {fmtTs(weatherRefreshedAt)}
                    </div>
                  )}
                </th>
                <th style={{ maxWidth: 220 }}>
                  News
                  {r2InjuryFetchedAt && (
                    <div style={{ fontSize: 8, fontFamily: 'var(--font-mono)', color: 'var(--accent-2)', fontWeight: 400, marginTop: 2 }}>
                      As of – {fmtTs(r2InjuryFetchedAt)}
                    </div>
                  )}
                </th>
                <th style={{ maxWidth: 300 }}>News Articles</th>
                <th style={{ fontSize: 9, color: 'var(--text-faint)' }}>▶</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {fullRoster.map((entry, i) => {
                const p = entry.playerId ? findPlayer(entry.playerId) : null;
                const isBench = entry.slot === 'BENCH';
                const prevEntry = fullRoster[i - 1];
                const isFirstBench = isBench && prevEntry && prevEntry.slot !== 'BENCH';
                const benchDivider = isFirstBench ? (
                  <tr key={`bench-divider-${i}`} style={{ pointerEvents: 'none' }}>
                    <td colSpan={15} style={{ padding: '6px 14px 4px', background: 'rgba(255,255,255,.03)', borderTop: '2px solid var(--border)' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ fontSize: 9, fontFamily: 'var(--font-mono)', fontWeight: 800, letterSpacing: '.1em', color: 'var(--text-faint)', textTransform: 'uppercase' }}>Bench</span>
                        <span style={{ fontSize: 10, color: 'var(--text-faint)' }}>— drag any player above this line to put them in the starting lineup</span>
                      </div>
                    </td>
                  </tr>
                ) : null;
                const isDrafted = baseIds.has(entry.playerId);
                const isWatched = p && watchlistIds.has(p.id);
                const isDragging = p && dragId === p.id;
                const isDragTarget = p && dragOver === p.id;

                const emptyKey = `empty-${entry.slot}-${i}`;
                // Use live API data if refreshed, else fall back to player store status (from Databricks)
                const apiStatus = p && liveData[p.id]?.length > 0 ? deriveStatus(p.id) : null;
                const rawStatus = p ? (apiStatus ?? p.status ?? 'OK') : 'OK';
                // Normalize playerStore 'Out' → 'O' to match the UI's internal status codes
                const liveStatus = rawStatus === 'Out' ? 'O' : rawStatus;
                const isOnBye = !!(p?.bye && p.bye === H2H_WEEK);
                const effectiveStatus = isOnBye ? 'O' : liveStatus;
                const isInjured = effectiveStatus !== 'OK';

                if (!p) {
                  const isEmptyTarget = dragOver === emptyKey;
                  return (
                    <React.Fragment key={i}>
                      {benchDivider}
                    <tr
                      onDragOver={e => handleDragOver(e, emptyKey)}
                      onDrop={e => handleDropOnSlot(e, entry.slot, null)}
                      onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget)) setDragOver(null); }}
                      style={{
                        opacity: isEmptyTarget ? 1 : 0.4,
                        background: isEmptyTarget ? 'rgba(198,255,58,.07)' : undefined,
                        outline: isEmptyTarget ? '1px solid rgba(198,255,58,.3)' : undefined,
                      }}
                    >
                      <td style={{ paddingRight: 4, width: 1 }}>
                        <span className="roster-slot-tag" style={{ background: slotColor(entry.slot) }}>
                          {entry.slot}
                        </span>
                      </td>
                      <td colSpan={14} style={{ fontSize: 12 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                          <span className="dim">{isBench ? 'Empty bench slot · drop here' : `Empty ${entry.slot} slot · drop ${entry.slot === 'FLEX' ? 'RB/WR' : entry.slot} here`}</span>
                          <button
                            className="btn sm primary"
                            onClick={e => {
                              e.stopPropagation();
                              const filter = entry.slot === 'BENCH' ? 'ALL' : entry.slot;
                              try { localStorage.setItem('fantasai_add_filter', filter); } catch {}
                              onNav?.('players');
                            }}
                            style={{ fontSize: 11, padding: '3px 10px' }}
                          >
                            + Add {entry.slot === 'FLEX' ? 'RB/WR' : entry.slot === 'BENCH' ? 'Player' : entry.slot}
                          </button>
                        </div>
                      </td>
                    </tr>
                    </React.Fragment>
                  );
                }

                return (
                  <React.Fragment key={i}>
                    {benchDivider}
                  <tr
                    draggable
                    onDragStart={e => handleDragStart(e, p.id)}
                    onDragOver={e => handleDragOver(e, p.id)}
                    onDrop={e => handleDropOnSlot(e, entry.slot, p.id)}
                    onDragEnd={handleDragEnd}
                    onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget)) setDragOver(null); }}
                    style={{
                      opacity: isDragging ? 0.4 : isBench ? 0.78 : 1,
                      cursor: 'grab',
                      background: isDragTarget ? 'rgba(198,255,58,.07)' : isOnBye ? 'rgba(255,40,40,.22)' : effectiveStatus === 'Q' ? 'rgba(255,140,0,.13)' : (effectiveStatus === 'O' || effectiveStatus === 'IR') ? 'rgba(255,40,40,.18)' : isInjured ? 'rgba(255,59,48,.10)' : (!isBench && effectiveStatus === 'OK') ? 'rgba(76,175,130,.18)' : undefined,
                      outline: isDragTarget ? '1px solid rgba(198,255,58,.3)' : undefined,
                    }}
                  >
                    <td style={{ paddingRight: 4, width: 1, whiteSpace: 'nowrap' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                        <span style={{ fontSize: 14, color: 'var(--text-dim)', cursor: 'grab', opacity: 0.6, userSelect: 'none' }} title="Drag to swap slot">⠿</span>
                        <span className="roster-slot-tag" style={{ background: isBench ? '#505050' : slotColor(entry.slot) }}>
                          {entry.slot}
                        </span>
                      </div>
                    </td>
                    <td
                      style={{ cursor: 'pointer' }}
                      onClick={() => onOpenPlayer?.(p.id)}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <PlayerAvatar player={p} />
                        <div>
                          <div style={{ fontWeight: 600, fontSize: 13, display: 'flex', alignItems: 'center', gap: 5 }}>
                            {isWatched && <span style={{ color: '#ffd700', fontSize: 11 }}>★</span>}
                            <span style={{ color: isWatched ? '#ffd700' : isOnBye ? 'var(--danger)' : effectiveStatus === 'Q' ? '#ff8c00' : isInjured ? 'var(--danger)' : undefined }}>{p.name}</span>
                            {(() => {
                              const allArticles = playerNewsMap.get(p.name.toLowerCase().trim()) || [];
                              const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
                              const recent = allArticles.filter(a => !a.published_at || new Date(a.published_at).getTime() >= cutoff);
                              if (!recent.length) return null;
                              function artAge(ts) {
                                if (!ts) return '';
                                const d = Date.now() - new Date(ts).getTime();
                                if (d < 3600000) return `${Math.round(d / 60000)}m`;
                                if (d < 86400000) return `${Math.round(d / 3600000)}h`;
                                return `${Math.round(d / 86400000)}d`;
                              }
                              return (
                                <select
                                  value=""
                                  onClick={e => e.stopPropagation()}
                                  onChange={e => {
                                    e.stopPropagation();
                                    const url = e.target.value;
                                    if (url) window.open(url, '_blank', 'noopener,noreferrer');
                                    e.target.value = '';
                                  }}
                                  style={{ fontSize: 9, fontFamily: 'var(--font-mono)', fontWeight: 700, padding: '1px 4px', borderRadius: 3, border: '1px solid rgba(78,168,255,.35)', background: 'rgba(78,168,255,.12)', color: 'var(--accent-2)', cursor: 'pointer', maxWidth: 130, flexShrink: 0 }}
                                >
                                  <option value="">📰 {recent.length} article{recent.length !== 1 ? 's' : ''}</option>
                                  {recent.map((a, i) => {
                                    const age = artAge(a.published_at);
                                    const label = (a.headline || a.publisher || '').slice(0, 65);
                                    return <option key={i} value={a.article_url}>{age ? `[${age}] ` : ''}{label}</option>;
                                  })}
                                </select>
                              );
                            })()}
                          </div>
                          <div style={{ fontSize: 11, color: 'var(--text-faint)', display: 'flex', alignItems: 'center', gap: 5, flexWrap: 'wrap' }}>
                            <PosBadge pos={p.pos} /> {p.team} · #{p.num}
                            {isDrafted && (
                              <span style={{
                                fontSize: 9, fontFamily: 'var(--font-mono)', padding: '1px 5px', borderRadius: 3,
                                background: 'rgba(198,255,58,.1)', color: 'var(--accent)',
                                border: '1px solid rgba(198,255,58,.25)',
                              }}>
                                ⬆ Drafted
                              </span>
                            )}
                            {(() => {
                              const req = tradeOffers.find(o => o.status === 'pending' && o.getIds.includes(p.id));
                              if (!req) return null;
                              const fromTeam = findTeam(req.fromTeamId);
                              return (
                                <span style={{ fontSize: 9, fontFamily: 'var(--font-mono)', fontWeight: 700, padding: '1px 6px', borderRadius: 3, background: 'rgba(255,215,0,.15)', color: '#FFD700', border: '1px solid rgba(255,215,0,.35)' }}>
                                  ↔ Trade Requested from {fromTeam?.name || `Team ${req.fromTeamId}`}
                                </span>
                              );
                            })()}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="num" style={{ fontWeight: 600 }}>
                      {(() => {
                        const liveProj = (liveData[p.id] || []).find(e => e.proj != null);
                        return liveProj ? (
                          <span style={{ color: 'var(--accent-2)' }}>{liveProj.proj.toFixed(1)}</span>
                        ) : (
                          <span style={{ color: 'var(--accent)' }}>{p.proj.toFixed(1)}</span>
                        );
                      })()}
                    </td>
                    <td className="num">{(() => {
                      const slEntry = (liveData[p.id] || []).find(e => e.sourceId === 'sleeper-api' && e.lastPts != null);
                      const val = slEntry?.lastPts ?? (p.last > 0 ? p.last : null);
                      return val != null ? <span style={{ color: slEntry ? 'var(--accent-2)' : undefined }}>{val.toFixed(1)}</span> : <span className="faint">—</span>;
                    })()}</td>
                    <td className="num">{(() => { const v = p.avg > 0 ? p.avg : p.proj; return v > 0 ? v.toFixed(1) : <span className="faint">—</span>; })()}</td>
                    <td className="num" style={{ paddingRight: 6 }}>
                      {(() => { const td = getTrendData(p); return td.length ? <Sparkline data={td} width={70} height={20} /> : <span className="faint">—</span>; })()}
                    </td>
                    <td className="num">
                      {(() => {
                        const r = p.oppRank;
                        if (!r) return <span className="faint">—</span>;
                        // 1 = toughest defense, 32 = easiest → color accordingly
                        const color = r <= 8  ? 'var(--danger)'
                                    : r <= 16 ? 'var(--warn)'
                                    : r <= 24 ? '#4caf82'
                                    :           'var(--good)';
                        const label = r <= 8  ? 'Tough'
                                    : r <= 16 ? 'Avg'
                                    : r <= 24 ? 'Good'
                                    :           'Easy';
                        return (
                          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 1 }}>
                            <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 800, fontSize: 13, color }}>#{r}</span>
                            <span style={{ fontSize: 8, color, opacity: 0.75, fontFamily: 'var(--font-mono)', letterSpacing: '.04em' }}>{label}</span>
                          </div>
                        );
                      })()}
                    </td>
                    <td>
                      <span className="mono dim" style={{ fontSize: 11 }}>vs {p.opp}</span>
                    </td>
                    <td className="num">
                      {p.bye ? (
                        <span style={{
                          fontFamily: 'var(--font-mono)', fontWeight: 700, fontSize: 12,
                          color: isOnBye ? 'var(--danger)' : 'var(--text-faint)',
                        }}>
                          {isOnBye ? '🔴' : ''} {p.bye}
                        </span>
                      ) : <span className="faint">—</span>}
                    </td>
                    <td>
                      {isOnBye ? (
                        <span className="status-pill" style={{ color: 'var(--danger)', borderColor: 'rgba(255,40,40,.35)', background: 'rgba(255,40,40,.1)' }}>
                          <StatusDot status="O" /> O · BYE
                        </span>
                      ) : effectiveStatus !== 'OK' && (
                        <span className="status-pill"><StatusDot status={effectiveStatus} /> {effectiveStatus}</span>
                      )}
                    </td>
                    <td style={{ whiteSpace: 'nowrap', minWidth: 80 }}>
                      {(() => {
                        const wx = getGameWeather(p.team);
                        if (!wx) return <span className="faint" style={{ fontSize: 10 }}>—</span>;
                        if (wx.dome) return (
                          <span style={{ fontSize: 9, fontFamily: 'var(--font-mono)', color: '#666', background: 'rgba(255,255,255,.06)', border: '1px solid #333', borderRadius: 3, padding: '1px 5px' }}>
                            DOME
                          </span>
                        );
                        if (wx.noData) return <span className="faint" style={{ fontSize: 10 }}>—</span>;
                        const h = wx.hour;
                        if (!h) return <span className="faint" style={{ fontSize: 10 }}>—</span>;
                        const windMph  = h.wind_mph || 0;
                        const tempF    = h.temp_f   || wx.maxTempF || 0;
                        const precipIn = h.precip_in || 0;
                        const cond     = (h.condition || '').toLowerCase();
                        const isSnow   = cond.includes('snow') || cond.includes('blizzard') || cond.includes('sleet');
                        const isRain   = precipIn > 0.05 || cond.includes('rain') || cond.includes('drizzle') || cond.includes('shower');
                        // Wind thresholds per fantasy impact:
                        // <10 minimal · 10-15 slight · 15-20 noticeable · 20+ significant · 25+ major
                        const windColor = windMph >= 20 ? 'var(--danger)'
                                        : windMph >= 15 ? '#ff8c00'
                                        : windMph >= 10 ? '#ffd700'
                                        : 'var(--text)';
                        const tempColor = tempF <= 20 ? '#4ea8ff' : tempF <= 32 ? '#7ecff5' : tempF >= 95 ? 'var(--danger)' : 'var(--text-dim)';
                        return (
                          <div style={{ fontSize: 13, fontFamily: 'var(--font-mono)', lineHeight: 1.5 }}>
                            <span style={{ fontWeight: 700, color: tempColor }}>{tempF}°F</span>
                            {' · '}
                            <span style={{ color: windColor }}>{windMph}mph</span>
                            {h.wind_dir && <span style={{ color: 'var(--text-faint)', fontSize: 11 }}> {h.wind_dir}</span>}
                            {isSnow && <div style={{ color: '#7ecff5', fontSize: 11 }}>❄ Snow</div>}
                            {!isSnow && isRain && <div style={{ color: '#ffd700', fontSize: 11 }}>🌧 Rain</div>}
                            {windMph >= 25 && <div style={{ color: 'var(--danger)', fontSize: 11, fontWeight: 700 }}>⚠ Major wind</div>}
                            {windMph >= 20 && windMph < 25 && <div style={{ color: 'var(--danger)', fontSize: 11 }}>⚠ Sig. wind</div>}
                          </div>
                        );
                      })()}
                    </td>
                    <td style={{ maxWidth: 320, verticalAlign: 'top', paddingTop: 8 }}>
                      {(() => {
                        const liveNotes = (liveData[p.id] || []).filter(e => e.note);
                        const r2 = r2InjuryByName[p.name.toLowerCase()];
                        const r2InjSt = r2?.injury_status;
                        const hasR2 = r2 && r2InjSt && r2InjSt !== 'Active';
                        if (!liveNotes.length && !hasR2 && !p.news) return null;
                        return (
                          <div style={{ fontSize: 13, lineHeight: 1.5, whiteSpace: 'normal', display: 'flex', flexDirection: 'column', gap: 4 }}>
                            {p.news && (
                              <div>
                                <span style={{ color: '#ffd700' }}>{p.news}</span>
                                <span style={{ marginLeft: 5, fontFamily: 'var(--font-mono)', fontSize: 9, fontWeight: 700, letterSpacing: '.05em', color: 'var(--text-faint)' }}>BEAT WRITER</span>
                              </div>
                            )}
                            {hasR2 && (
                              <div>
                                <span style={{ color: r2InjSt === 'Out' ? 'var(--danger)' : r2InjSt === 'Questionable' ? '#ff8c00' : r2InjSt === 'Doubtful' ? '#ffb547' : 'var(--accent-2)' }}>
                                  {r2InjSt}{r2.injury_notes ? ` · ${r2.injury_notes}` : ''}{r2.depth_chart_order ? ` (DC: ${r2.depth_chart_order})` : ''}
                                </span>
                                <span style={{ marginLeft: 5, fontFamily: 'var(--font-mono)', fontSize: 9, fontWeight: 700, letterSpacing: '.05em', color: 'var(--accent-2)', opacity: 0.75 }}>DATABRICKS</span>
                                {r2InjuryFetchedAt && (
                                  <span style={{ marginLeft: 4, fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--text-faint)' }}>{fmtTs(r2InjuryFetchedAt)}</span>
                                )}
                              </div>
                            )}
                            {liveNotes.map((entry, i) => {
                              const srcColor = activatedSources.find(s => s.id === entry.sourceId)?.color || 'var(--accent-2)';
                              const ts = lastFetched[entry.sourceId];
                              const isLong = entry.note && entry.note.length > 200;
                              const isExpanded = expandedNews.has(p.id);
                              const displayNote = isLong && !isExpanded ? entry.note.slice(0, 200) + '…' : entry.note;
                              return (
                                <div key={i}>
                                  <span style={{ color: srcColor }}>{displayNote}</span>
                                  {isLong && (
                                    <button
                                      className="btn ghost sm"
                                      style={{ marginLeft: 6, fontSize: 9, padding: '1px 5px', verticalAlign: 'middle', color: srcColor, opacity: 0.8 }}
                                      onClick={e => {
                                        e.stopPropagation();
                                        setExpandedNews(prev => {
                                          const next = new Set(prev);
                                          if (next.has(p.id)) next.delete(p.id);
                                          else next.add(p.id);
                                          return next;
                                        });
                                      }}
                                    >{isExpanded ? 'less ↑' : 'more ↓'}</button>
                                  )}
                                  <span style={{ marginLeft: 5, fontFamily: 'var(--font-mono)', fontSize: 9, fontWeight: 700, letterSpacing: '.05em', color: srcColor, opacity: 0.75 }}>
                                    {(entry.source || 'LIVE').toUpperCase()}
                                  </span>
                                  {ts && (
                                    <span style={{ marginLeft: 4, fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--text-faint)' }}>{fmtTs(ts)}</span>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        );
                      })()}
                    </td>
                    <td style={{ maxWidth: 300, verticalAlign: 'top', paddingTop: 8 }}>
                      {(() => {
                        const arts = (playerNewsMap.get(normalizeName(p.name)) || playerNewsMap.get(p.name.toLowerCase().trim()) || [])
                          .slice().sort((a, b) => {
                            const ta = a.published_at ? new Date(a.published_at).getTime() : 0;
                            const tb = b.published_at ? new Date(b.published_at).getTime() : 0;
                            return tb - ta;
                          });
                        const latest = arts[0];
                        if (!latest) return <span className="faint" style={{ fontSize: 11 }}>—</span>;
                        const diff = latest.published_at ? Date.now() - new Date(latest.published_at).getTime() : null;
                        const ago = diff == null ? '' : diff < 3600000 ? `${Math.round(diff / 60000)}m ago`
                          : diff < 86400000 ? `${Math.round(diff / 3600000)}h ago`
                          : `${Math.round(diff / 86400000)}d ago`;
                        const insight = latest.fantasy_insight || latest.summary_text || '';
                        const headline = latest.headline || '';
                        return (
                          <div style={{ fontSize: 11, lineHeight: 1.5, whiteSpace: 'normal' }} onClick={e => e.stopPropagation()}>
                            {latest.article_url ? (
                              <a
                                href={latest.article_url}
                                target="_blank"
                                rel="noopener noreferrer"
                                style={{ fontWeight: 600, color: 'var(--text)', textDecoration: 'none', display: 'block', marginBottom: 3, lineHeight: 1.4 }}
                                onMouseEnter={e => e.currentTarget.style.color = '#4ea8ff'}
                                onMouseLeave={e => e.currentTarget.style.color = 'var(--text)'}
                              >
                                {headline.slice(0, 90)}{headline.length > 90 ? '…' : ''}
                              </a>
                            ) : (
                              <div style={{ fontWeight: 600, marginBottom: 3, lineHeight: 1.4 }}>
                                {headline.slice(0, 90)}{headline.length > 90 ? '…' : ''}
                              </div>
                            )}
                            {insight && (
                              <div style={{ fontSize: 10, color: 'var(--accent)', fontStyle: 'italic', lineHeight: 1.4, marginBottom: 3 }}>
                                {insight.slice(0, 130)}{insight.length > 130 ? '…' : ''}
                              </div>
                            )}
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                              {latest.publisher && <span style={{ fontSize: 9, fontWeight: 600, color: 'var(--text-dim)' }}>{latest.publisher}</span>}
                              {ago && <span style={{ fontSize: 9, fontFamily: 'var(--font-mono)', color: 'var(--text-faint)' }}>{ago}</span>}
                              {arts.length > 1 && (
                                <span style={{ fontSize: 9, fontFamily: 'var(--font-mono)', color: 'var(--text-faint)' }}>
                                  +{arts.length - 1} more
                                </span>
                              )}
                            </div>
                          </div>
                        );
                      })()}
                    </td>
                    <td>
                      <a
                        href={`https://www.youtube.com/results?search_query=${encodeURIComponent(p.name + ' NFL highlights')}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        title={`Watch ${p.name} highlights on YouTube`}
                        onClick={e => e.stopPropagation()}
                        style={{ fontSize: 14, color: '#ff0000', opacity: 0.75, textDecoration: 'none', display: 'block', textAlign: 'center' }}
                      >▶</a>
                    </td>
                    <td>
                      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                        <button
                          className={`btn sm icon${isWatched ? ' watch-active' : ''}`}
                          title={isWatched ? 'Remove from watchlist' : 'Watch'}
                          onClick={e => { e.stopPropagation(); onToggleWatch?.(p.id); }}
                        >{isWatched ? '★' : '☆'}</button>
                        <button
                          className={`btn sm ghost${swapTarget?.playerId === p.id ? ' active' : ''}`}
                          title="Select a replacement for this slot"
                          style={{ fontSize: 12, fontWeight: 700, color: swapTarget?.playerId === p.id ? 'var(--accent)' : undefined, borderColor: swapTarget?.playerId === p.id ? 'var(--accent)' : undefined }}
                          onClick={e => { e.stopPropagation(); setAddDropPending(null); setSwapTarget(swapTarget?.playerId === p.id ? null : { playerId: p.id, slot: entry.slot }); }}
                        >⇄</button>
                        {dropConfirm?.playerId === p.id ? (
                          <>
                            <button className="btn sm danger" onClick={() => executeDrop(entry)}>Confirm</button>
                            <button className="btn sm ghost" onClick={() => setDropConfirm(null)}>Cancel</button>
                          </>
                        ) : (
                          <button
                            className="btn sm ghost"
                            style={{ color: 'var(--danger)', borderColor: 'var(--danger)' }}
                            onClick={e => { e.stopPropagation(); confirmDrop(entry); }}
                          >Drop</button>
                        )}
                      </div>
                    </td>
                  </tr>
                  {swapTarget?.playerId === p.id && (
                    <tr style={{ background: 'rgba(78,168,255,.04)', borderLeft: '3px solid #4ea8ff' }}>
                      <td colSpan={14} style={{ padding: 0 }}>
                        <div style={{ padding: '12px 16px', borderBottom: '1px solid rgba(78,168,255,.18)' }}>

                          {/* ── Add/Drop confirmation ── */}
                          {addDropPending && addDropPending.dropPlayerId === p.id ? (
                            <div>
                              <div style={{ fontSize: 10, fontFamily: 'var(--font-mono)', fontWeight: 800, color: '#4ea8ff', letterSpacing: '.08em', textTransform: 'uppercase', marginBottom: 12 }}>
                                Confirm Add / Drop
                              </div>
                              <div style={{ display: 'flex', gap: 16, alignItems: 'stretch', marginBottom: 14, flexWrap: 'wrap' }}>
                                {/* ADD card */}
                                <div style={{ flex: 1, minWidth: 160, padding: '10px 14px', background: 'rgba(76,175,130,.1)', border: '1px solid rgba(76,175,130,.35)', borderRadius: 8 }}>
                                  <div style={{ fontSize: 9, fontFamily: 'var(--font-mono)', fontWeight: 800, color: 'var(--good)', letterSpacing: '.1em', marginBottom: 6 }}>ADD</div>
                                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                    <PlayerAvatar player={addDropPending.addPlayer} size="sm" />
                                    <div>
                                      <div style={{ fontWeight: 700, fontSize: 13 }}>{addDropPending.addPlayer.name}</div>
                                      <div style={{ fontSize: 11, color: 'var(--text-faint)', display: 'flex', alignItems: 'center', gap: 5 }}>
                                        <PosBadge pos={addDropPending.addPlayer.pos} />
                                        <span>{addDropPending.addPlayer.team}</span>
                                        <span>·</span>
                                        <span>{addDropPending.addPlayer.proj.toFixed(1)} proj</span>
                                      </div>
                                    </div>
                                  </div>
                                </div>
                                {/* DROP card */}
                                <div style={{ flex: 1, minWidth: 160, padding: '10px 14px', background: 'rgba(255,60,60,.08)', border: '1px solid rgba(255,60,60,.3)', borderRadius: 8 }}>
                                  <div style={{ fontSize: 9, fontFamily: 'var(--font-mono)', fontWeight: 800, color: 'var(--danger)', letterSpacing: '.1em', marginBottom: 6 }}>DROP</div>
                                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                    <PlayerAvatar player={p} size="sm" />
                                    <div>
                                      <div style={{ fontWeight: 700, fontSize: 13 }}>{p.name}</div>
                                      <div style={{ fontSize: 11, color: 'var(--text-faint)', display: 'flex', alignItems: 'center', gap: 5 }}>
                                        <PosBadge pos={p.pos} />
                                        <span>{p.team}</span>
                                        <span>·</span>
                                        <span>{p.proj.toFixed(1)} proj</span>
                                      </div>
                                    </div>
                                  </div>
                                </div>
                              </div>
                              <div style={{ display: 'flex', gap: 8 }}>
                                <button
                                  className="btn primary"
                                  style={{ fontWeight: 700 }}
                                  onClick={() => {
                                    onAddPlayer?.(addDropPending.addPlayer.id);
                                    onDropPlayer?.(addDropPending.dropPlayerId);
                                    setAddDropPending(null);
                                    setSwapTarget(null);
                                  }}
                                >
                                  Confirm Add / Drop
                                </button>
                                <button
                                  className="btn ghost sm"
                                  onClick={() => setAddDropPending(null)}
                                >
                                  ← Back to Free Agents
                                </button>
                                <button
                                  className="btn ghost sm"
                                  style={{ marginLeft: 'auto', color: 'var(--text-faint)' }}
                                  onClick={() => { setAddDropPending(null); setSwapTarget(null); }}
                                >
                                  ✕ Cancel
                                </button>
                              </div>
                            </div>
                          ) : (
                            /* ── Free agent picker ── */
                            <div>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                                <span style={{ fontSize: 10, fontFamily: 'var(--font-mono)', fontWeight: 800, color: '#4ea8ff', letterSpacing: '.08em', textTransform: 'uppercase' }}>
                                  Replace {p.name} · Free Agents for {entry.slot}
                                </span>
                                <button className="btn ghost sm" style={{ marginLeft: 'auto', fontSize: 10, color: 'var(--text-faint)' }} onClick={() => { setAddDropPending(null); setSwapTarget(null); }}>✕ Cancel</button>
                              </div>
                              {swapFAOpts.length > 0 ? (
                                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                                  {swapFAOpts.map(fp => (
                                    <button
                                      key={fp.id}
                                      style={{
                                        display: 'flex', alignItems: 'center', gap: 10,
                                        background: 'var(--panel-2)', border: '1px solid var(--border)',
                                        borderRadius: 7, padding: '8px 12px', cursor: 'pointer',
                                        textAlign: 'left', width: '100%', transition: 'background .1s',
                                      }}
                                      onMouseEnter={e => e.currentTarget.style.background = 'rgba(78,168,255,.1)'}
                                      onMouseLeave={e => e.currentTarget.style.background = 'var(--panel-2)'}
                                      onClick={() => setAddDropPending({ addPlayer: fp, dropPlayerId: p.id })}
                                    >
                                      <PlayerAvatar player={fp} size="sm" />
                                      <div style={{ flex: 1, minWidth: 0 }}>
                                        <div style={{ fontWeight: 700, fontSize: 13 }}>{fp.name}</div>
                                        <div style={{ fontSize: 11, color: 'var(--text-faint)', display: 'flex', alignItems: 'center', gap: 5, marginTop: 1 }}>
                                          <PosBadge pos={fp.pos} />
                                          <span>{fp.team}</span>
                                          {fp.opp && <><span>·</span><span>vs {fp.opp}</span></>}
                                        </div>
                                      </div>
                                      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 2, flexShrink: 0 }}>
                                        <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 800, fontSize: 14, color: 'var(--accent)' }}>{fp.proj.toFixed(1)}</span>
                                        <span style={{ fontSize: 9, color: 'var(--text-faint)', fontFamily: 'var(--font-mono)' }}>proj</span>
                                      </div>
                                      <span style={{ fontSize: 11, fontWeight: 700, color: '#4caf82', fontFamily: 'var(--font-mono)', flexShrink: 0 }}>+ Add →</span>
                                    </button>
                                  ))}
                                </div>
                              ) : (
                                <span style={{ fontSize: 12, color: 'var(--text-faint)' }}>No free agents available for {entry.slot}</span>
                              )}
                            </div>
                          )}
                        </div>
                      </td>
                    </tr>
                  )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Add Player tab */}
      {tab === 'add' && (
        <div className="col" style={{ flex: 1, overflow: 'hidden' }}>
          <div className="toolbar">
            <div className="chips">
              {['ALL', 'QB', 'RB', 'WR', 'TE', 'FLEX', 'K', 'DST'].map(p => (
                <div
                  key={p}
                  className={`chip ${addFilter === p ? 'accent active' : ''}`}
                  onClick={() => setAddFilter(p)}
                >
                  {p}
                </div>
              ))}
            </div>
            <input
              className="input search"
              placeholder="Search players…"
              value={addSearch}
              onChange={e => setAddSearch(e.target.value)}
              style={{ width: 220 }}
            />
            <span className="faint mono" style={{ fontSize: 11, marginLeft: 'auto' }}>
              {available.length} available
            </span>
          </div>
          <div style={{ flex: 1, overflow: 'auto' }}>
            <table className="data-table">
              <thead>
                <tr>
                  <th>Player</th>
                  <th className="num">Proj</th>
                  <th className="num">Last</th>
                  <th className="num">Avg</th>
                  <th className="num">%Own</th>
                  <th>Opp</th>
                  <th>Status</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {(addFilter === 'ALL' ? available.slice(0, 100) : available).map(p => (
                  <tr key={p.id}>
                    <td style={{ cursor: 'pointer' }} onClick={() => onOpenPlayer?.(p.id)}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <PlayerAvatar player={p} />
                        <div>
                          <div style={{ fontWeight: 600, fontSize: 13 }}>{p.name}</div>
                          <div style={{ fontSize: 11, color: 'var(--text-faint)' }}>
                            <PosBadge pos={p.pos} /> {p.team}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="num" style={{ fontWeight: 600 }}>{p.proj.toFixed(1)}</td>
                    <td className="num">{p.last.toFixed(1)}</td>
                    <td className="num">{p.avg.toFixed(1)}</td>
                    <td className="num">{p.owned.toFixed(1)}%</td>
                    <td>
                      <span className="mono dim" style={{ fontSize: 11 }}>vs {p.opp}</span>
                      <div className="mono faint" style={{ fontSize: 10 }}>D #{p.oppRank}</div>
                    </td>
                    <td>
                      {p.status !== 'OK' && (
                        <span className="status-pill"><StatusDot status={p.status} /> {p.status}</span>
                      )}
                    </td>
                    <td>
                      <div style={{ display: 'flex', gap: 6 }}>
                        <button
                          className={`btn sm icon${watchlistIds.has(p.id) ? ' watch-active' : ''}`}
                          title={watchlistIds.has(p.id) ? 'Remove from watchlist' : 'Watch'}
                          onClick={() => onToggleWatch?.(p.id)}
                        >{watchlistIds.has(p.id) ? '★' : '☆'}</button>
                        <button
                          className="btn sm primary"
                          onClick={() => onAddPlayer?.(p.id)}
                        >
                          + Add
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* News & Updates tab */}
      {tab === 'news' && (
        <RosterNewsFeed
          allNewsArticles={allNewsArticles}
          rosterNewsArticles={rosterNewsArticles}
          allRosterNews={allRosterNews}
          rosterPlayers={rosterPlayers}
          injuryCount={injuryCount}
          onOpenPlayer={onOpenPlayer}
          deriveStatus={deriveStatus}
        />
      )}

      {/* Lineup Decisions tab */}
      {tab === 'lineup' && (
        <div style={{ flex: 1, overflow: 'auto' }}>
          <LineupDecisions
            myRosterIds={myRosterIds}
            slotOverrides={slotOverrides}
            onSlotOverridesChange={onSlotOverridesChange}
            onOpenPlayer={onOpenPlayer}
          />
        </div>
      )}

      {/* Defense Rankings tab */}
      {tab === 'defense' && (
        <DefenseRankingsTab allPlayers={allPlayers} rosterPlayers={rosterPlayers} onOpenPlayer={onOpenPlayer} />
      )}

      {/* Watchlist tab */}
      {tab === 'watchlist' && (
        <div style={{ flex: 1, overflow: 'auto' }}>
          {watchlistIds.size === 0 ? (
            <div style={{ padding: '60px 24px', textAlign: 'center' }}>
              <div style={{ fontSize: 32, marginBottom: 12, color: '#ffd700' }}>☆</div>
              <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 8 }}>No players on your watchlist</div>
              <div style={{ fontSize: 12, color: 'var(--text-faint)' }}>
                Tap ☆ on any player in the Players tab or Add Player tab to start tracking them here.
              </div>
            </div>
          ) : (
            <>
              <div style={{ padding: '8px 18px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span className="faint mono" style={{ fontSize: 11 }}>{watchlistIds.size} player{watchlistIds.size !== 1 ? 's' : ''} watched</span>
                <button
                  className="btn ghost sm"
                  style={{ fontSize: 11, color: 'var(--danger)' }}
                  onClick={() => [...watchlistIds].forEach(id => onToggleWatch?.(id))}
                >
                  Clear All
                </button>
              </div>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Player</th>
                    <th className="num">Proj</th>
                    <th className="num">Last</th>
                    <th className="num">Avg</th>
                    <th>Opp</th>
                    <th>Status</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {[...watchlistIds].map(id => {
                    const p = findPlayer(id);
                    if (!p) return null;
                    const onRoster = myRosterIds?.has(p.id);
                    return (
                      <tr key={p.id}>
                        <td style={{ cursor: 'pointer' }} onClick={() => onOpenPlayer?.(p.id)}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                            <PlayerAvatar player={p} />
                            <div>
                              <div style={{ fontWeight: 700, fontSize: 13, color: '#ffd700', display: 'flex', alignItems: 'center', gap: 5 }}>
                                <span>★</span> {p.name}
                              </div>
                              <div style={{ fontSize: 11, color: 'var(--text-faint)' }}>
                                <PosBadge pos={p.pos} /> {p.team} · #{p.num}
                              </div>
                            </div>
                          </div>
                        </td>
                        <td className="num" style={{ fontWeight: 600, color: 'var(--accent)' }}>{p.proj.toFixed(1)}</td>
                        <td className="num">{p.last.toFixed(1)}</td>
                        <td className="num">{p.avg.toFixed(1)}</td>
                        <td>
                          <span className="mono dim" style={{ fontSize: 11 }}>vs {p.opp}</span>
                          <div className="mono faint" style={{ fontSize: 10 }}>D #{p.oppRank}</div>
                        </td>
                        <td>
                          {p.status !== 'OK' && (
                            <span className="status-pill"><StatusDot status={p.status} /> {p.status}</span>
                          )}
                        </td>
                        <td>
                          <div style={{ display: 'flex', gap: 6 }}>
                            {!onRoster && (
                              <button className="btn sm primary" onClick={() => onAddPlayer?.(p.id)}>+ Add</button>
                            )}
                            <button
                              className="btn sm icon watch-active"
                              title="Remove from watchlist"
                              onClick={() => onToggleWatch?.(p.id)}
                            >★</button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </>
          )}
        </div>
      )}

    </div>
  );
}

// ─── LiveRosterNews ────────────────────────────────────────────────────────────
// ── Defense Rankings tab ──────────────────────────────────────────────────

function DefenseRankingsTab({ allPlayers, rosterPlayers, onOpenPlayer }) {
  const [posFilter, setPosFilter] = React.useState('ALL');

  // Build defRankings: { teamAbbr: { QB, RB, WR, TE } }
  // Source: each player's opp → oppRank (position-specific defensive rank)
  const defRankings = React.useMemo(() => {
    const map = {};
    for (const p of allPlayers) {
      if (!p.opp || !p.oppRank) continue;
      const pos = p.pos === 'DST' ? null : p.pos;
      if (!pos || !['QB', 'RB', 'WR', 'TE', 'K'].includes(pos)) continue;
      if (!map[p.opp]) map[p.opp] = {};
      // First player per position per team wins (most prominent player's rank)
      if (!map[p.opp][pos]) map[p.opp][pos] = p.oppRank;
    }
    return map;
  }, [allPlayers]);

  // Compute per-team average rank across QB/RB/WR/TE for overall sort
  const teams = React.useMemo(() => {
    const POSITIONS = ['QB', 'RB', 'WR', 'TE'];
    return Object.entries(defRankings).map(([abbr, ranks]) => {
      const vals = POSITIONS.map(p => ranks[p]).filter(Boolean);
      const avg = vals.length ? vals.reduce((s, v) => s + v, 0) / vals.length : 99;
      return { abbr, ranks, avg };
    }).sort((a, b) => {
      if (posFilter === 'ALL') return a.avg - b.avg;
      const ra = a.ranks[posFilter] ?? 99;
      const rb = b.ranks[posFilter] ?? 99;
      return ra - rb;
    });
  }, [defRankings, posFilter]);

  // Set of opponent teams for my rostered players (highlight these rows)
  const myOpps = React.useMemo(
    () => new Set(rosterPlayers.map(p => p.opp).filter(Boolean)),
    [rosterPlayers]
  );

  function rankCell(rank) {
    if (!rank) return <td className="num"><span style={{ color: 'var(--text-faint)' }}>—</span></td>;
    const color = rank <= 8  ? 'var(--danger)'
                : rank <= 16 ? 'var(--warn)'
                : rank <= 24 ? '#4caf82'
                :               'var(--good)';
    const label = rank <= 8  ? 'Tough' : rank <= 16 ? 'Avg' : rank <= 24 ? 'Good' : 'Easy';
    return (
      <td className="num">
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1 }}>
          <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 800, fontSize: 13, color }}>#{rank}</span>
          <span style={{ fontSize: 8, color, opacity: 0.75, fontFamily: 'var(--font-mono)' }}>{label}</span>
        </div>
      </td>
    );
  }

  return (
    <div style={{ flex: 1, overflow: 'auto' }}>
      {/* Header + filter */}
      <div style={{ padding: '10px 18px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 2 }}>NFL Defense Rankings vs Position</div>
          <div style={{ fontSize: 11, color: 'var(--text-faint)' }}>
            Rank 1 = toughest defense · Rank 32 = most points allowed · <span style={{ color: '#c6ff3a', fontWeight: 700 }}>Highlighted</span> = your this-week matchups
          </div>
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 4 }}>
          {['ALL', 'QB', 'RB', 'WR', 'TE', 'K'].map(p => (
            <button key={p} onClick={() => setPosFilter(p)} style={{
              background: posFilter === p ? 'var(--accent)' : 'var(--panel-3)',
              color: posFilter === p ? '#0a1300' : 'var(--text-dim)',
              border: 'none', borderRadius: 4, padding: '3px 9px', fontSize: 11,
              fontWeight: posFilter === p ? 700 : 500, cursor: 'pointer',
            }}>{p}</button>
          ))}
        </div>
      </div>

      <table className="data-table">
        <thead>
          <tr>
            <th>Rank</th>
            <th>Defense</th>
            <th className="num">vs QB</th>
            <th className="num">vs RB</th>
            <th className="num">vs WR</th>
            <th className="num">vs TE</th>
            <th className="num">vs K</th>
          </tr>
        </thead>
        <tbody>
          {teams.map((t, i) => {
            const isMyOpp = myOpps.has(t.abbr);
            // Find which of my players faces this defense
            const myPlayers = rosterPlayers.filter(p => p.opp === t.abbr);
            return (
              <tr
                key={t.abbr}
                style={{
                  background: isMyOpp ? 'rgba(198,255,58,.06)' : undefined,
                  borderLeft: isMyOpp ? '3px solid var(--accent)' : undefined,
                }}
              >
                <td style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, color: 'var(--text-faint)', fontSize: 11, width: 36 }}>
                  {i + 1}
                </td>
                <td>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontWeight: 700, fontSize: 13 }}>{t.abbr}</span>
                    {isMyOpp && myPlayers.length > 0 && (
                      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                        {myPlayers.map(p => (
                          <button
                            key={p.id}
                            onClick={() => onOpenPlayer?.(p.id)}
                            style={{ background: 'rgba(198,255,58,.15)', border: '1px solid rgba(198,255,58,.3)', borderRadius: 4, padding: '1px 6px', fontSize: 10, fontWeight: 700, color: 'var(--accent)', cursor: 'pointer' }}
                          >
                            {p.name.split(' ').slice(-1)[0]}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </td>
                {rankCell(t.ranks.QB)}
                {rankCell(t.ranks.RB)}
                {rankCell(t.ranks.WR)}
                {rankCell(t.ranks.TE)}
                {rankCell(t.ranks.K)}
              </tr>
            );
          })}
        </tbody>
      </table>

      {teams.length === 0 && (
        <div style={{ padding: '40px 24px', textAlign: 'center', color: 'var(--text-faint)', fontSize: 13 }}>
          Defense rankings load with player data — check back once the roster is populated.
        </div>
      )}
    </div>
  );
}

// ── Roster Google News feed ───────────────────────────────────────────────

function newsCategory(headline = '') {
  const h = headline.toLowerCase();
  if (/injur|knee|hamstring|ankle|shoulder|wrist|\bout\b|limited|dnp|ir\b|surgery|fracture|concussion|questionable|doubtful/.test(h))
    return { icon: '🏥', label: 'Injury', color: 'var(--danger)', bg: 'rgba(255,60,60,.1)' };
  if (/trade|traded|deal|acquire|waiv|sign|release|free agent|cut|claim/.test(h))
    return { icon: '🔄', label: 'Transaction', color: '#4ea8ff', bg: 'rgba(78,168,255,.1)' };
  if (/depth chart|practice|camp|ota|snap|starter|backup|listed|53-man|roster move/.test(h))
    return { icon: '📊', label: 'Depth/Practice', color: 'var(--warn)', bg: 'rgba(255,149,0,.1)' };
  if (/fantasy|start|sit|ranking|waiver|pickup|draft|sleeper|breakout|must-add|target/.test(h))
    return { icon: '🏈', label: 'Fantasy', color: 'var(--good)', bg: 'rgba(76,175,130,.1)' };
  return { icon: '📰', label: 'News', color: 'var(--text-faint)', bg: 'var(--panel-2)' };
}

function fmtArticleTs(published_at) {
  if (!published_at) return null;
  const d = new Date(published_at);
  if (isNaN(d.getTime())) return null;
  const now = Date.now();
  const diff = now - d.getTime();
  const mins = Math.round(diff / 60000);
  if (mins < 1)  return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24)  return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days === 1) return 'yesterday';
  if (days < 7)   return `${days}d ago`;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function dateBucket(published_at) {
  if (!published_at) return 'Earlier';
  const d = new Date(published_at);
  if (isNaN(d.getTime())) return 'Earlier';
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return 'Today';
  const yesterday = new Date(now); yesterday.setDate(now.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday';
  return 'Earlier This Week';
}

function RosterNewsFeed({ allNewsArticles, rosterNewsArticles, allRosterNews, rosterPlayers, injuryCount, onOpenPlayer, deriveStatus }) {
  const [catFilter, setCatFilter] = React.useState('All');
  const [playerFilter, setPlayerFilter] = React.useState('All');
  // Default to "All NFL" so articles always appear; user can switch to "My Roster"
  const [rosterOnly, setRosterOnly] = React.useState(false);

  const sourceArticles = rosterOnly ? rosterNewsArticles : allNewsArticles;

  const playerNames = React.useMemo(() => {
    const names = [...new Set(
      sourceArticles.map(x => x.article.player_name || x.player?.name || '').filter(Boolean)
    )].sort();
    return ['All', ...names];
  }, [sourceArticles]);

  const filtered = React.useMemo(() => {
    return sourceArticles.filter(({ article, player }) => {
      if (playerFilter !== 'All') {
        const articleName = article.player_name || player?.name || '';
        if (articleName !== playerFilter) return false;
      }
      if (catFilter !== 'All' && newsCategory(article.headline).label !== catFilter) return false;
      return true;
    });
  }, [sourceArticles, catFilter, playerFilter]);

  // Group into date buckets
  const buckets = React.useMemo(() => {
    const order = ['Today', 'Yesterday', 'Earlier This Week', 'Earlier'];
    const map = {};
    for (const item of filtered) {
      const b = dateBucket(item.article.published_at);
      if (!map[b]) map[b] = [];
      map[b].push(item);
    }
    return order.filter(b => map[b]).map(b => ({ label: b, items: map[b] }));
  }, [filtered]);

  const CAT_FILTERS = ['All', 'Injury', 'Transaction', 'Fantasy', 'Depth/Practice', 'News'];

  if (!allNewsArticles.length && !allRosterNews.length) {
    return (
      <div style={{ flex: 1, overflow: 'auto', padding: '60px 24px', textAlign: 'center' }}>
        <div style={{ fontSize: 32, marginBottom: 12 }}>📰</div>
        <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 8 }}>No player news yet</div>
        <div style={{ fontSize: 12, color: 'var(--text-faint)' }}>
          News updates will appear here once the Databricks pipeline runs.
        </div>
      </div>
    );
  }

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* Filter bar */}
      <div style={{ padding: '8px 16px', borderBottom: '1px solid var(--border)', display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', flexShrink: 0 }}>
        {/* Category chips */}
        {/* Roster scope toggle */}
        <div style={{ display: 'flex', gap: 2, background: 'var(--panel-3)', borderRadius: 6, padding: 2, flexShrink: 0 }}>
          {[['All NFL', false], ['My Roster', true]].map(([label, val]) => (
            <button key={label} onClick={() => { setRosterOnly(val); setPlayerFilter('All'); }} style={{
              background: rosterOnly === val ? 'var(--accent)' : 'transparent',
              color: rosterOnly === val ? '#0a1300' : 'var(--text-dim)',
              border: 'none', borderRadius: 4, padding: '3px 10px', fontSize: 11,
              fontWeight: rosterOnly === val ? 700 : 500, cursor: 'pointer', whiteSpace: 'nowrap',
            }}>{label}</button>
          ))}
        </div>
        <div style={{ width: 1, height: 16, background: 'var(--border)', flexShrink: 0 }} />
        {/* Category chips */}
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
          {CAT_FILTERS.map(c => (
            <button key={c} onClick={() => setCatFilter(c)} style={{
              background: catFilter === c ? 'var(--panel-2)' : 'transparent',
              color: catFilter === c ? 'var(--text)' : 'var(--text-faint)',
              border: catFilter === c ? '1px solid var(--border)' : '1px solid transparent',
              borderRadius: 4, padding: '3px 9px', fontSize: 11,
              fontWeight: catFilter === c ? 700 : 400, cursor: 'pointer',
            }}>{c}</button>
          ))}
        </div>
        <div style={{ width: 1, height: 16, background: 'var(--border)', flexShrink: 0 }} />
        {/* Player filter */}
        <select
          value={playerFilter}
          onChange={e => setPlayerFilter(e.target.value)}
          style={{ fontSize: 11, background: 'var(--panel-2)', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: 4, padding: '3px 6px', cursor: 'pointer' }}
        >
          {playerNames.map(n => <option key={n} value={n}>{n}</option>)}
        </select>
        <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--text-faint)', fontFamily: 'var(--font-mono)', whiteSpace: 'nowrap' }}>
          {filtered.length} of {sourceArticles.length}
        </span>
        {injuryCount > 0 && (
          <span style={{ fontSize: 11, color: 'var(--danger)', fontFamily: 'var(--font-mono)', fontWeight: 700 }}>
            ⚠ {injuryCount}
          </span>
        )}
      </div>

      {/* Feed */}
      <div style={{ flex: 1, overflow: 'auto' }}>
        {filtered.length === 0 ? (
          <div style={{ padding: '40px 24px', textAlign: 'center', color: 'var(--text-faint)', fontSize: 13 }}>
            No articles match the current filter.
          </div>
        ) : (
          <div style={{ maxWidth: 760, padding: '0 0 40px' }}>
            {buckets.map(bucket => (
              <div key={bucket.label}>
                {/* Date bucket header */}
                <div style={{ padding: '12px 20px 6px', fontSize: 10, fontWeight: 800, color: 'var(--text-faint)', fontFamily: 'var(--font-mono)', letterSpacing: '.1em', textTransform: 'uppercase', borderBottom: '1px solid var(--border)', position: 'sticky', top: 0, background: 'var(--bg)', zIndex: 1 }}>
                  {bucket.label} · {bucket.items.length} article{bucket.items.length !== 1 ? 's' : ''}
                </div>
                {bucket.items.map(({ article, player, isRostered }, i) => {
                  const cat = newsCategory(article.headline);
                  const ago = fmtArticleTs(article.published_at);
                  const displayName = article.player_name || player?.name || '';
                  const displayPos  = article.position || player?.pos || '';
                  const displayTeam = article.team || player?.team || '';
                  return (
                    <div key={`${displayName}-${i}`} style={{ padding: '14px 20px', borderBottom: '1px solid var(--border)', display: 'flex', gap: 12, alignItems: 'flex-start', background: isRostered ? 'rgba(78,215,130,.03)' : undefined }}>
                      {/* Category icon */}
                      <div style={{ flexShrink: 0, width: 32, height: 32, borderRadius: 8, background: cat.bg, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16, marginTop: 1 }}>
                        {cat.icon}
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        {/* Player + badges */}
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4, flexWrap: 'wrap' }}>
                          {player ? (
                            <button
                              onClick={() => onOpenPlayer?.(player.id)}
                              style={{ background: 'none', border: 'none', cursor: 'pointer', fontWeight: 700, fontSize: 12, color: 'var(--text)', padding: 0 }}
                            >
                              {displayName}
                            </button>
                          ) : (
                            <span style={{ fontWeight: 700, fontSize: 12, color: 'var(--text)' }}>{displayName}</span>
                          )}
                          {displayPos && <PosBadge pos={displayPos} />}
                          {displayTeam && <span style={{ fontSize: 10, color: 'var(--text-faint)' }}>{displayTeam}</span>}
                          {isRostered && (
                            <span style={{ fontSize: 9, fontFamily: 'var(--font-mono)', fontWeight: 800, color: '#4ed87b', background: 'rgba(78,216,123,.12)', border: '1px solid rgba(78,216,123,.3)', borderRadius: 3, padding: '1px 5px', letterSpacing: '.05em' }}>
                              ROSTERED
                            </span>
                          )}
                          <span style={{ fontSize: 9, fontFamily: 'var(--font-mono)', fontWeight: 700, color: cat.color, background: cat.bg, border: `1px solid ${cat.color}30`, borderRadius: 3, padding: '1px 5px', letterSpacing: '.05em' }}>
                            {cat.label}
                          </span>
                        </div>
                        {/* Headline */}
                        <a
                          href={article.article_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          style={{ display: 'block', fontSize: 14, fontWeight: 600, color: 'var(--text)', textDecoration: 'none', lineHeight: 1.45, marginBottom: 6 }}
                          onMouseEnter={e => e.currentTarget.style.color = '#4ea8ff'}
                          onMouseLeave={e => e.currentTarget.style.color = 'var(--text)'}
                        >
                          {article.headline}
                        </a>
                        {/* Attribution + Read button */}
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                          <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-dim)' }}>{article.publisher}</span>
                          {ago && <><span style={{ color: 'var(--text-faint)', fontSize: 11 }}>·</span><span style={{ fontSize: 11, color: 'var(--text-faint)' }}>{ago}</span></>}
                          <a
                            href={article.article_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            style={{ marginLeft: 4, fontSize: 11, fontWeight: 700, color: '#4ea8ff', textDecoration: 'none', padding: '2px 8px', background: 'rgba(78,168,255,.1)', border: '1px solid rgba(78,168,255,.25)', borderRadius: 4 }}
                            onMouseEnter={e => e.currentTarget.style.background = 'rgba(78,168,255,.2)'}
                            onMouseLeave={e => e.currentTarget.style.background = 'rgba(78,168,255,.1)'}
                          >
                            Read Full Article →
                          </a>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        )}

        {/* FantasAI pipeline notes — shown below the Google News feed if available */}
        {allRosterNews.length > 0 && (
          <div style={{ borderTop: '2px solid var(--border)', padding: '12px 20px 8px' }}>
            <div style={{ fontSize: 10, fontWeight: 800, color: 'var(--accent)', fontFamily: 'var(--font-mono)', letterSpacing: '.1em', textTransform: 'uppercase', marginBottom: 10 }}>
              ◆ FantasAI Analysis · {allRosterNews.length} note{allRosterNews.length !== 1 ? 's' : ''}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {allRosterNews.map(n => {
                const p = findPlayer(n.playerId);
                if (!p) return null;
                const impactColor = n.impact === 'high' ? 'var(--danger)' : n.impact === 'good' ? 'var(--good)' : n.impact === 'med' ? 'var(--warn)' : 'var(--text-faint)';
                return (
                  <div key={n.id} onClick={() => onOpenPlayer?.(p.id)} style={{ padding: '10px 14px', borderRadius: 8, background: 'var(--panel-2)', border: '1px solid var(--border)', cursor: 'pointer', borderLeft: `3px solid ${impactColor}` }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                      <span style={{ fontWeight: 700, fontSize: 13 }}>{p.name}</span>
                      <PosBadge pos={p.pos} />
                      <span style={{ fontSize: 9, fontFamily: 'var(--font-mono)', fontWeight: 700, color: impactColor, background: `${impactColor}18`, border: `1px solid ${impactColor}40`, borderRadius: 3, padding: '1px 5px', textTransform: 'uppercase' }}>{n.impact}</span>
                    </div>
                    <div style={{ fontSize: 13, color: 'var(--text-dim)', lineHeight: 1.5 }}>{n.title || n.body}</div>
                    <div style={{ marginTop: 5, fontSize: 10, color: 'var(--text-faint)', fontFamily: 'var(--font-mono)' }}>
                      FantasAI · {n.mins < 60 ? `${n.mins}m ago` : n.mins < 1440 ? `${Math.floor(n.mins / 60)}h ago` : `${Math.floor(n.mins / 1440)}d ago`}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// Fetches live status/news for key roster players directly from Sleeper API.
// Prioritizes injured players, then top starters by projection.
function LiveRosterNews({ players, onOpenPlayer }) {
  const [items, setItems] = React.useState([]);
  const [loading, setLoading] = React.useState(true);
  const [fetched, setFetched] = React.useState(0);

  React.useEffect(() => {
    if (!players.length) { setLoading(false); return; }
    let cancelled = false;

    // Priority: injured players first, then top 5 starters by proj
    const injured  = players.filter(p => p.status !== 'OK');
    const starters = players.filter(p => p.status === 'OK').sort((a, b) => b.proj - a.proj).slice(0, 5);
    const targets  = [...injured, ...starters].slice(0, 8);

    setLoading(true);
    setItems([]);

    Promise.allSettled(
      targets.map(p =>
        fetchSleeperPlayerStats(p.name, p.pos)
          .then(data => data?.found ? { player: p, data } : null)
          .catch(() => null)
      )
    ).then(results => {
      if (cancelled) return;
      const liveItems = results
        .filter(r => r.status === 'fulfilled' && r.value)
        .map(r => r.value);
      setItems(liveItems);
      setFetched(liveItems.length);
      setLoading(false);
    });

    return () => { cancelled = true; };
  }, [players.length]);

  if (loading) {
    return (
      <div style={{
        marginBottom: 12, padding: '10px 14px', borderRadius: 6,
        background: 'rgba(78,168,255,.06)', border: '1px solid rgba(78,168,255,.2)',
        display: 'flex', alignItems: 'center', gap: 10, fontSize: 12,
      }}>
        <div className="ai-orb" style={{ width: 14, height: 14 }} />
        <span className="dim">Fetching live status from Sleeper API…</span>
      </div>
    );
  }

  if (!items.length) return null;

  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <span style={{
          display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 9,
          fontFamily: 'var(--font-mono)', color: 'var(--accent-2)',
          background: 'rgba(78,168,255,.1)', border: '1px solid rgba(78,168,255,.3)',
          borderRadius: 4, padding: '2px 7px',
        }}>
          <span style={{ width: 5, height: 5, borderRadius: '50%', background: 'var(--accent-2)', display: 'inline-block' }} />
          SLEEPER API · LIVE
        </span>
        <span className="faint mono" style={{ fontSize: 10 }}>{fetched} players synced</span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {items.map(({ player, data }) => {
          const liveStatus   = data.status && data.status !== 'Active' ? data.status : null;
          const isInjured    = player.status !== 'OK' || liveStatus;
          const lastPts      = data.weeklyStats
            ? Object.values(data.weeklyStats).at(-1)?.pts_half_ppr ?? null
            : null;
          const gp           = data.gamesPlayed || '—';
          const seasonPts    = data.seasonTotals?.pts_half_ppr;
          const avg          = seasonPts != null && data.gamesPlayed > 0
            ? (seasonPts / data.gamesPlayed).toFixed(1) : null;

          return (
            <div
              key={player.id}
              className="muted-card"
              style={{
                borderLeft: `3px solid ${isInjured ? 'var(--danger)' : 'rgba(78,168,255,.5)'}`,
                cursor: 'pointer', padding: '10px 14px',
              }}
              onClick={() => onOpenPlayer?.(player.id)}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <PlayerAvatar player={player} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 700, fontSize: 13, display: 'flex', alignItems: 'center', gap: 6 }}>
                    {player.name}
                    <PosBadge pos={player.pos} />
                    {isInjured && (
                      <span className="status-pill"><StatusDot status={player.status} /> {liveStatus || player.status}</span>
                    )}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text-faint)' }}>{player.team} · #{player.num}</div>
                </div>
                <div style={{ textAlign: 'right', fontSize: 11 }}>
                  {lastPts != null && (
                    <div><span className="faint">Last:</span> <span style={{ fontWeight: 600, color: 'var(--accent)' }}>{Number(lastPts).toFixed(1)}</span></div>
                  )}
                  {avg && (
                    <div><span className="faint">Avg:</span> <span style={{ fontWeight: 600 }}>{avg}</span></div>
                  )}
                  <div className="faint" style={{ fontSize: 10 }}>{gp} GP</div>
                </div>
              </div>
              <div style={{ marginTop: 6, fontSize: 10, color: 'var(--text-faint)', fontFamily: 'var(--font-mono)' }}>
                Sourced from Sleeper API · click to view full stats
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
