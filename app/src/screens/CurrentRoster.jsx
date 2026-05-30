import React from 'react';
import { TEAM_ROSTERS, PLAYERS, findPlayer, findTeam, NEWS, SLOT_ELIGIBILITY, ROSTER_CONFIG, LEAGUE_TEAMS, buildRosterFrame, assignRoster, FREE_DATA_SOURCES, LIMITED_FREE_SOURCES } from '../lib/data.js';
import { PosBadge, StatusDot, PlayerAvatar, TeamLogoBadge } from '../components/ui.jsx';
import { fetchSleeperPlayerStats } from '../lib/sleeper.js';
import { useR2Drops, useR2Injuries } from '../hooks.js';

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
  const d   = new Date(typeof ts === 'number' ? ts : ts);
  if (isNaN(d)) return null;
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  return sameDay
    ? d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
    : d.toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function DropCandidatesPanel({ myRosterIds, onOpenPlayer }) {
  const { data, loading } = useR2Drops();
  const [collapsed, setCollapsed] = React.useState(false);

  if (loading || !data) return null;

  const candidates = (Array.isArray(data) ? data : []).filter(r => {
    const match = PLAYERS.find(p => p.name?.toLowerCase() === r.player_name?.toLowerCase());
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
            const player = PLAYERS.find(p => p.name?.toLowerCase() === r.player_name?.toLowerCase());
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

export default function CurrentRosterScreen({ user, myRosterIds, onAddPlayer, onDropPlayer, onOpenPlayer, watchlistIds = new Set(), onToggleWatch, sourcesState, slotOverrides = {}, onSlotOverridesChange, tradeOffers = [], onRespondTradeOffer }) {
  const [dropConfirm, setDropConfirm] = React.useState(null);
  const [addFilter, setAddFilter] = React.useState('ALL');
  const [addSearch, setAddSearch] = React.useState('');
  const [tab, setTab] = React.useState('roster');
  const [dragId, setDragId] = React.useState(null);
  const [dragOver, setDragOver] = React.useState(null);
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
  const fullRoster = React.useMemo(
    () => assignRoster(slotFrame, myRosterIds, slotOverrides),
    [slotFrame, myRosterIds, slotOverrides],
  );

  // Proj totals from starters (non-bench)
  const starters = fullRoster.filter(r => r.slot !== 'BENCH' && r.playerId);
  const totalProj = starters.reduce((s, r) => s + (findPlayer(r.playerId)?.proj || 0), 0);

  const [swapError, setSwapError] = React.useState(null);
  // R2 injury report written by Databricks — used to populate Updated News/Live column on load
  const { data: r2InjuryData, fetchedAt: r2InjuryFetchedAt } = useR2Injuries();
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
          data[p.id] = { note: noteParts.join(' · ') || null, proj: proj != null ? Number(proj) : null, source: src.name, liveStatus };
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
        const res = await fetch(`${API_BASE}/api/v1/cbs/players`, { signal: AbortSignal.timeout(20000) });
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
            data[match.id] = { note: (newsText || '').slice(0, 250), proj: null, source: src.name, liveStatus: cbsStatus };
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

  // Available players for Add tab
  const rosterIds = new Set(fullRoster.map(r => r.playerId).filter(Boolean));
  const available = PLAYERS.filter(p => {
    if (rosterIds.has(p.id)) return false;
    if (addFilter === 'FLEX' && !['RB', 'WR', 'TE'].includes(p.pos)) return false;
    if (addFilter !== 'ALL' && addFilter !== 'FLEX' && p.pos !== addFilter) return false;
    if (addSearch && !p.name.toLowerCase().includes(addSearch.toLowerCase())) return false;
    return true;
  }).sort((a, b) => b.proj - a.proj);

  // Build news feed for this roster
  const rosterPlayerIds = new Set(fullRoster.map(r => r.playerId).filter(Boolean));
  const rosterPlayers   = PLAYERS.filter(p => rosterPlayerIds.has(p.id));

  const newsHasId = new Set(NEWS.filter(n => rosterPlayerIds.has(n.playerId)).map(n => n.playerId));

  // Synthetic items from player.news text for players with non-OK status or no news entry
  const syntheticNews = rosterPlayers
    .filter(p => p.news && !newsHasId.has(p.id))
    .map((p, i) => ({
      id: `syn-${p.id}`,
      playerId: p.id,
      mins: 360 + i * 30,
      impact: p.status !== 'OK' ? 'med' : 'low',
      source: 'Beat Writer',
      title: `${p.name}: ${p.news}`,
      body: p.status !== 'OK'
        ? `${p.name} listed as ${p.status}. Monitor practice reports through the week.`
        : `No significant updates. ${p.news}.`,
      synthetic: true,
    }));

  const allRosterNews = [
    ...NEWS.filter(n => rosterPlayerIds.has(n.playerId)),
    ...syntheticNews,
  ].sort((a, b) => {
    // Injury/high-impact first, then by recency
    const aUrgent = a.impact === 'high' || deriveStatus(a.playerId) !== 'OK';
    const bUrgent = b.impact === 'high' || deriveStatus(b.playerId) !== 'OK';
    if (aUrgent !== bUrgent) return aUrgent ? -1 : 1;
    return a.mins - b.mins;
  });

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
            <h1 style={{ marginBottom: 2 }}>Current Roster</h1>
            <div className="sub" style={{ marginBottom: 8 }}>
              {team?.name || 'My Team'} · {fullRoster.length} players
            </div>
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: 20 }}>
              <div>
                <div style={{ fontSize: 9, fontFamily: 'var(--font-mono)', fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--text-faint)', marginBottom: 1 }}>Base Proj</div>
                <div style={{ fontFamily: 'var(--font-display)', fontWeight: 900, fontStretch: '75%', fontSize: 22, color: 'var(--accent)', lineHeight: 1 }}>
                  {totalProj.toFixed(1)}
                </div>
              </div>
              {hasSleeperProj && (
                <div>
                  <div style={{ fontSize: 9, fontFamily: 'var(--font-mono)', fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase', color: sleeperColor, marginBottom: 1 }}>Sleeper Proj</div>
                  <div style={{ fontFamily: 'var(--font-display)', fontWeight: 900, fontStretch: '75%', fontSize: 22, color: sleeperColor, lineHeight: 1 }}>
                    {sleeperProjTotal.toFixed(1)}
                  </div>
                </div>
              )}
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
            </>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="tabs" style={{ padding: '0 18px' }}>
        <div className={`tab ${tab === 'roster' ? 'active' : ''}`} onClick={() => setTab('roster')}>My Roster</div>
        <div className={`tab ${tab === 'add' ? 'active' : ''}`} onClick={() => setTab('add')}>Add Player</div>
        <div className={`tab ${tab === 'news' ? 'active' : ''}`} onClick={() => setTab('news')}>
          News &amp; Updates
          {injuryCount > 0 && (
            <span style={{ marginLeft: 6, background: 'var(--danger)', color: '#fff', fontSize: 10, fontWeight: 700, padding: '1px 5px', borderRadius: 10, fontFamily: 'var(--font-mono)' }}>
              {injuryCount}
            </span>
          )}
        </div>
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
      {tab === 'roster' && (
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
                      <span style={{ fontWeight: 700, fontSize: 12, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.name}</span>
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

            return (
              <div style={{ margin: '10px 18px 4px' }}>
                {/* ── Matchup header bar (click to expand) ── */}
                <div
                  style={{
                    background: 'var(--panel)', border: '1px solid var(--border)',
                    borderRadius: matchupExpanded ? '8px 8px 0 0' : 8,
                    padding: '10px 16px', display: 'flex', alignItems: 'center', gap: 12,
                    cursor: 'pointer', userSelect: 'none',
                  }}
                  onClick={() => setMatchupExpanded(e => !e)}
                >
                  <div style={{ fontSize: 9, fontFamily: 'var(--font-mono)', fontWeight: 700, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '.1em', flexShrink: 0 }}>
                    Wk {H2H_WEEK} Matchup
                  </div>
                  <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 10 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                      <span style={{ width: 20, height: 20, borderRadius: '50%', background: myTeam?.color || 'var(--accent)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 8, flexShrink: 0 }}>{myTeam?.logo}</span>
                      <span style={{ fontWeight: 800, fontSize: 13, color: isWinning ? '#4caf82' : 'var(--accent)' }}>{myAccum.toFixed(1)}</span>
                      <span style={{ fontSize: 9, color: 'var(--text-faint)', fontFamily: 'var(--font-mono)' }}>/{myMatchup.myProj}</span>
                    </div>
                    <span style={{ fontSize: 10, color: 'var(--text-faint)' }}>vs</span>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                      <span style={{ fontWeight: 800, fontSize: 13, color: !isWinning ? '#4caf82' : 'var(--text-dim)' }}>{oppAccum.toFixed(1)}</span>
                      <span style={{ fontSize: 9, color: 'var(--text-faint)', fontFamily: 'var(--font-mono)' }}>/{myMatchup.oppProj}</span>
                      <span style={{ width: 20, height: 20, borderRadius: '50%', background: opp?.color || '#555', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 8, flexShrink: 0 }}>{opp?.logo}</span>
                      <span style={{ fontSize: 11, color: 'var(--text-dim)' }}>{opp?.name}</span>
                    </div>
                  </div>
                  {/* Win probability chip */}
                  <div style={{ flexShrink: 0, textAlign: 'right' }}>
                    <div style={{ fontSize: 11, fontWeight: 800, color: isWinning ? '#4caf82' : 'var(--danger)' }}>
                      {isWinning ? '▲' : '▼'} {liveWinDisp}% Live Win
                    </div>
                    <div style={{ fontSize: 9, fontFamily: 'var(--font-mono)', color: 'var(--text-faint)' }}>
                      Proj Win: <span style={{ color: projWinDisp >= 50 ? '#4caf82' : 'var(--danger)', fontWeight: 700 }}>{projWinDisp}%</span>
                      {' '}
                      <span style={{ color: deltaWin > 0 ? '#4caf82' : deltaWin < 0 ? 'var(--danger)' : 'var(--text-faint)' }}>({deltaWin > 0 ? '+' : ''}{deltaWin}%)</span>
                    </div>
                  </div>
                  <span style={{ fontSize: 12, color: 'var(--text-faint)', flexShrink: 0 }}>
                    {matchupExpanded ? '▲' : '▼'}
                  </span>
                </div>

                {/* ── Expanded scoring breakdown ── */}
                {matchupExpanded && (
                  <div style={{
                    background: 'var(--panel)', border: '1px solid var(--border)',
                    borderTop: '1px solid rgba(255,255,255,.05)',
                    borderRadius: '0 0 8px 8px', padding: '12px 14px',
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
                )}
              </div>
            );
          })()}
          <table className="data-table">
            <thead>
              <tr>
                <th style={{ paddingRight: 4, width: 1, whiteSpace: 'nowrap' }}>Slot</th>
                <th>Player</th>
                <th className="num" style={{ whiteSpace: 'nowrap' }}>
                  Proj
                  {sleeperEnabled && Object.keys(liveData).length > 0 && (
                    <div style={{ fontSize: 8, fontFamily: 'var(--font-mono)', color: 'var(--accent-2)', fontWeight: 400, textTransform: 'uppercase', letterSpacing: '.06em', marginTop: 1 }}>
                      Sleeper API
                    </div>
                  )}
                </th>
                <th className="num">Last</th>
                <th className="num">Avg</th>
                <th>Opp</th>
                <th className="num">Bye</th>
                <th>Status</th>
                <th style={{ maxWidth: 160 }}>
                  News
                  {r2InjuryFetchedAt && (
                    <div style={{ fontSize: 8, fontFamily: 'var(--font-mono)', color: 'var(--text-faint)', fontWeight: 400, marginTop: 2 }}>
                      As of – {fmtTs(r2InjuryFetchedAt)}
                    </div>
                  )}
                </th>
                <th style={{ maxWidth: 200 }}>
                  Updated News/Live
                  {r2InjuryFetchedAt && (
                    <div style={{ fontSize: 8, fontFamily: 'var(--font-mono)', color: 'var(--accent-2)', fontWeight: 400, marginTop: 2 }}>
                      As of – {fmtTs(r2InjuryFetchedAt)}
                    </div>
                  )}
                </th>
                <th style={{ fontSize: 9, color: 'var(--text-faint)' }}>▶</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {fullRoster.map((entry, i) => {
                const p = entry.playerId ? findPlayer(entry.playerId) : null;
                const isBench = entry.slot === 'BENCH';
                const isDrafted = baseIds.has(entry.playerId);
                const isWatched = p && watchlistIds.has(p.id);
                const isDragging = p && dragId === p.id;
                const isDragTarget = p && dragOver === p.id;

                const emptyKey = `empty-${entry.slot}-${i}`;
                const liveStatus = p ? deriveStatus(p.id) : 'OK';
                const isOnBye = !!(p?.bye && p.bye === H2H_WEEK);
                const effectiveStatus = isOnBye ? 'O' : liveStatus;
                const isInjured = effectiveStatus !== 'OK';

                if (!p) {
                  const isEmptyTarget = dragOver === emptyKey;
                  return (
                    <tr
                      key={i}
                      onDragOver={e => handleDragOver(e, emptyKey)}
                      onDrop={e => handleDropOnSlot(e, entry.slot, null)}
                      onDragLeave={() => setDragOver(null)}
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
                      <td colSpan={9} className="dim" style={{ fontSize: 12 }}>Empty slot · drop here</td>
                    </tr>
                  );
                }

                return (
                  <tr
                    key={i}
                    draggable
                    onDragStart={e => handleDragStart(e, p.id)}
                    onDragOver={e => handleDragOver(e, p.id)}
                    onDrop={e => handleDropOnSlot(e, entry.slot, p.id)}
                    onDragEnd={handleDragEnd}
                    onDragLeave={() => setDragOver(null)}
                    style={{
                      opacity: isDragging ? 0.4 : isBench ? 0.78 : 1,
                      cursor: 'grab',
                      background: isDragTarget ? 'rgba(198,255,58,.07)' : isOnBye ? 'rgba(255,40,40,.22)' : effectiveStatus === 'Q' ? 'rgba(255,140,0,.13)' : (effectiveStatus === 'O' || effectiveStatus === 'IR') ? 'rgba(255,40,40,.18)' : isInjured ? 'rgba(255,59,48,.10)' : undefined,
                      outline: isDragTarget ? '1px solid rgba(198,255,58,.3)' : undefined,
                    }}
                  >
                    <td style={{ paddingRight: 4, width: 1, whiteSpace: 'nowrap' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                        <span style={{ fontSize: 12, color: 'var(--text-faint)', cursor: 'grab' }}>⠿</span>
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
                          </div>
                          <div style={{ fontSize: 11, color: 'var(--text-faint)', display: 'flex', alignItems: 'center', gap: 5, flexWrap: 'wrap' }}>
                            <PosBadge pos={p.pos} /> {p.team} · #{p.num}
                            <span style={{
                              fontSize: 9, fontFamily: 'var(--font-mono)', padding: '1px 5px', borderRadius: 3,
                              background: isDrafted ? 'rgba(198,255,58,.1)' : 'rgba(78,168,255,.1)',
                              color: isDrafted ? 'var(--accent)' : 'var(--accent-2)',
                              border: `1px solid ${isDrafted ? 'rgba(198,255,58,.25)' : 'rgba(78,168,255,.25)'}`,
                            }}>
                              {isDrafted ? '⬆ Drafted' : '+ Free Agency'}
                            </span>
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
                          <span>
                            <span style={{ color: 'var(--accent-2)' }}>{liveProj.proj.toFixed(1)}</span>
                            <div style={{ fontSize: 8, color: 'var(--accent-2)', fontFamily: 'var(--font-mono)', marginTop: 1 }} title={liveProj.source}>{(liveProj.source || 'LIVE').split(' ')[0].toUpperCase()}</div>
                          </span>
                        ) : (
                          <span style={{ color: 'var(--accent)' }}>{p.proj.toFixed(1)}</span>
                        );
                      })()}
                    </td>
                    <td className="num">{p.last.toFixed(1)}</td>
                    <td className="num">{p.avg.toFixed(1)}</td>
                    <td>
                      <span className="mono dim" style={{ fontSize: 11 }}>vs {p.opp}</span>
                      <div className="mono faint" style={{ fontSize: 10 }}>D #{p.oppRank}</div>
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
                    <td style={{ maxWidth: 160 }}>
                      {(() => {
                        // Primary news: static beat-writer text, then CBS API as fallback
                        const cbsEntry = (liveData[p.id] || []).find(e => e.sourceId === 'cbs-news' && e.note);
                        const newsText = p.news || cbsEntry?.note;
                        const newsLabel = p.news ? 'BEAT WRITER' : cbsEntry ? 'CBS' : null;
                        if (!newsText) return null;
                        return (
                          <div style={{ fontSize: 11, lineHeight: 1.5, whiteSpace: 'normal' }}>
                            <span style={{ color: '#ffd700' }}>{newsText}</span>
                            <span style={{ marginLeft: 5, fontFamily: 'var(--font-mono)', fontSize: 9, fontWeight: 700, letterSpacing: '.05em', color: 'var(--text-faint)' }}>{newsLabel}</span>
                            {cbsEntry && !p.news && lastFetched['cbs-news'] && (
                              <span style={{ marginLeft: 4, fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--text-faint)' }}>{fmtTs(lastFetched['cbs-news'])}</span>
                            )}
                          </div>
                        );
                      })()}
                    </td>
                    <td style={{ maxWidth: 200 }}>
                      {(() => {
                        // Secondary sources only (skip CBS since it shows in News column)
                        const liveNotes = (liveData[p.id] || []).filter(e => e.note && e.sourceId !== 'cbs-news');
                        const r2 = r2InjuryByName[p.name.toLowerCase()];
                        const hasR2 = r2 && r2.status && r2.status !== 'Active' && r2.status !== 'OK';
                        if (!liveNotes.length && !hasR2) return null;
                        return (
                          <div style={{ fontSize: 11, lineHeight: 1.5, whiteSpace: 'normal', display: 'flex', flexDirection: 'column', gap: 4 }}>
                            {hasR2 && (
                              <div>
                                <span style={{ color: r2.status === 'Out' ? 'var(--danger)' : r2.status === 'Questionable' ? '#ff8c00' : r2.status === 'Doubtful' ? '#ffb547' : 'var(--accent-2)' }}>
                                  {r2.status}{r2.notes ? ` · ${r2.notes}` : ''}
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
                              return (
                                <div key={i}>
                                  <span style={{ color: srcColor }}>{entry.note}</span>
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
                {available.slice(0, 60).map(p => (
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
        <div style={{ flex: 1, overflow: 'auto', padding: '12px 18px' }}>
          {/* Live API banner */}
          {sleeperEnabled && (
            <LiveRosterNews players={rosterPlayers} onOpenPlayer={onOpenPlayer} />
          )}
          {!sleeperEnabled && (
            <div style={{
              marginBottom: 10, padding: '7px 12px', borderRadius: 6,
              background: 'var(--panel-2)', border: '1px solid var(--border)',
              fontSize: 11, color: 'var(--text-faint)', display: 'flex', alignItems: 'center', gap: 8,
            }}>
              <span>Enable <strong style={{ color: 'var(--text-dim)' }}>Sleeper API</strong> in Sources to pull live player news &amp; injury updates.</span>
            </div>
          )}
          {allRosterNews.length === 0 ? (
            <div style={{ padding: '60px 24px', textAlign: 'center' }}>
              <div style={{ fontSize: 32, marginBottom: 12 }}>📰</div>
              <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 8 }}>All quiet</div>
              <div style={{ fontSize: 12, color: 'var(--text-faint)' }}>No news for your roster players right now.</div>
            </div>
          ) : (
            <>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                <span className="faint mono" style={{ fontSize: 11 }}>{allRosterNews.length} update{allRosterNews.length !== 1 ? 's' : ''} · your {rosterPlayers.length} players</span>
                {injuryCount > 0 && (
                  <span style={{ fontSize: 11, color: 'var(--danger)', fontFamily: 'var(--font-mono)', fontWeight: 700 }}>
                    ⚠ {injuryCount} injury concern{injuryCount !== 1 ? 's' : ''}
                  </span>
                )}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {allRosterNews.map(n => {
                  const p = findPlayer(n.playerId);
                  if (!p) return null;
                  const playerStatus = deriveStatus(n.playerId);
                  const isInjured = playerStatus !== 'OK';
                  const impactColor = n.impact === 'high' ? 'var(--danger)' : n.impact === 'good' ? 'var(--good)' : n.impact === 'med' ? 'var(--warn)' : 'var(--text-faint)';
                  return (
                    <div
                      key={n.id}
                      className="muted-card"
                      style={{
                        borderLeft: `3px solid ${isInjured || n.impact === 'high' ? 'var(--danger)' : n.impact === 'good' ? 'var(--good)' : 'var(--border-strong)'}`,
                        cursor: 'pointer',
                      }}
                      onClick={() => onOpenPlayer?.(p.id)}
                    >
                      {/* Player row */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                        <PlayerAvatar player={p} />
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontWeight: 700, fontSize: 13, display: 'flex', alignItems: 'center', gap: 6 }}>
                            {p.name}
                            <PosBadge pos={p.pos} />
                            {isInjured && <span className="status-pill"><StatusDot status={playerStatus} /> {playerStatus}</span>}
                          </div>
                          <div style={{ fontSize: 11, color: 'var(--text-faint)' }}>{p.team} · #{p.num}</div>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <span style={{
                            fontSize: 10, fontFamily: 'var(--font-mono)', fontWeight: 700,
                            padding: '2px 6px', borderRadius: 4,
                            background: n.impact === 'high' ? 'rgba(255,59,48,.15)' : n.impact === 'good' ? 'rgba(52,199,89,.15)' : n.impact === 'med' ? 'rgba(255,149,0,.15)' : 'var(--panel-2)',
                            color: impactColor,
                          }}>
                            {n.impact.toUpperCase()}
                          </span>
                        </div>
                      </div>
                      {/* News content */}
                      <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 4, lineHeight: 1.4 }}>{n.title}</div>
                      <div style={{ fontSize: 12, color: 'var(--text-dim)', lineHeight: 1.6 }}>{n.body}</div>
                      <div style={{ marginTop: 6, display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span className="mono faint" style={{ fontSize: 10 }}>
                          {n.mins < 60 ? `${n.mins}m ago` : `${Math.floor(n.mins / 60)}h ago`}
                        </span>
                        <span className="dot" style={{ color: 'var(--text-faint)' }}></span>
                        <span className="mono faint" style={{ fontSize: 10 }}>{n.source}</span>
                        {n.synthetic && (
                          <span style={{ fontSize: 9, fontFamily: 'var(--font-mono)', color: 'var(--text-faint)', marginLeft: 4 }}>· from player status</span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>
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
