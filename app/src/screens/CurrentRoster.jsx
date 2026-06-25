import React from 'react';
import { TEAM_ROSTERS, findTeam, NEWS, SLOT_ELIGIBILITY, ROSTER_CONFIG, LEAGUE_TEAMS, buildRosterFrame, assignRoster, FREE_DATA_SOURCES, LIMITED_FREE_SOURCES } from '../lib/data.js';
import { usePlayers, findPlayer, findPlayerByName, getPlayers, patchPlayers } from '../lib/playerStore.js';
import { PosBadge, StatusDot, PlayerAvatar, TeamLogoBadge, Sparkline } from '../components/ui.jsx';
import { fetchSleeperPlayerStats, getPlayerMap } from '../lib/sleeper.js';
import { useR2Drops, useR2Injuries, useR2PlayerNotes, useR2EnrichedNews, useR2WeatherForecast, useR2BreakoutCandidates, useR2PlayerNewsLinks, useR2DefensePerformance, useR2DefenseVsPos, useR2PlayerWriteups, useR2WeeklyStartSit, useR2RookieScores } from '../hooks.js';
import LineupDecisions, { computeOptimal } from './LineupDecisions.jsx';

const H2H_WEEKS   = 14;
const H2H_SEASON_START = new Date('2026-09-09');
function getH2HWeek() {
  const today = new Date();
  if (today < H2H_SEASON_START) return 1;
  const msPerWeek = 7 * 24 * 60 * 60 * 1000;
  return Math.min(Math.max(Math.floor((today - H2H_SEASON_START) / msPerWeek) + 1, 1), H2H_WEEKS);
}
const H2H_WEEK = getH2HWeek();

function h2hScore(teamId) {
  const roster   = TEAM_ROSTERS[teamId] || [];
  const starters = roster.filter(r => r.slot !== 'BENCH');
  return starters.reduce((sum, e) => {
    const p = e.playerId ? findPlayer(e.playerId) : null;
    return sum + (p ? (p.proj || p.avg || 0) : 0);
  }, 0);
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

// ESPN abbreviation → our abbreviation (only mismatches)
const ESPN_TEAM_MAP = { WSH: 'WAS', JAX: 'JAX' };
function espnAbbr(a) { return ESPN_TEAM_MAP[a] || a; }

async function fetchEspnSchedule(season, week) {
  try {
    const url = `https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?seasontype=2&week=${week}&dates=${season}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(12000) });
    if (!res.ok) return {};
    const data = await res.json();
    return parseEspnScoreboard(data);
  } catch { return {}; }
}

function parseEspnScoreboard(data) {
  const out = {};
  for (const ev of data.events || []) {
    const comps = (ev.competitions || [{}])[0];
    const competitors = comps.competitors || [];
    const game = {};
    for (const t of competitors) {
      const abbr = espnAbbr((t.team?.abbreviation || '').toUpperCase());
      game[t.homeAway] = abbr;
    }
    const home = game.home || '';
    const away = game.away || '';
    if (!home || !away) continue;
    const dateStr = comps.date || ev.date || '';
    const dt = dateStr ? new Date(dateStr) : null;
    const time = dt ? dt.toLocaleString('en-US', { weekday: 'short', hour: 'numeric', minute: '2-digit', timeZone: 'America/Chicago', timeZoneName: undefined }).replace(',', '') + ' CT' : '';
    out[home] = { opp: away, time, isAway: false };
    out[away] = { opp: home, time, isAway: true };
  }
  return out;
}

let _fullScheduleCache = null;
async function fetchFullEspnSchedule(season) {
  if (_fullScheduleCache?.season === season) return _fullScheduleCache.weeks;
  const weeks = {};
  const fetches = [];
  for (let w = 1; w <= 18; w++) {
    fetches.push(
      fetch(`https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?seasontype=2&week=${w}&dates=${season}`, { signal: AbortSignal.timeout(15000) })
        .then(r => r.ok ? r.json() : null)
        .then(data => { if (data) weeks[w] = parseEspnScoreboard(data); })
        .catch(() => {})
    );
    if (w % 4 === 0) {
      await Promise.all(fetches);
      fetches.length = 0;
    }
  }
  await Promise.all(fetches);
  _fullScheduleCache = { season, weeks };
  return weeks;
}

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
function liveOverrideRec(ss, playerStatus) {
  if (!ss) return ss;
  const s = (playerStatus || '').toUpperCase();
  const rec = ss.recommendation;
  if ((s === 'Q' || s === 'QUESTIONABLE') && rec !== 'MONITOR' && rec !== 'SIT') {
    return { ...ss, recommendation: 'MONITOR', confidence: 'LOW', _overridden: true };
  }
  if ((s === 'D' || s === 'DOUBTFUL') && !rec?.startsWith('SIT')) {
    return { ...ss, recommendation: 'SIT', confidence: 'MEDIUM', _overridden: true };
  }
  if ((s === 'O' || s === 'OUT' || s === 'IR') && rec !== 'SIT') {
    return { ...ss, recommendation: 'SIT', confidence: 'HIGH', _overridden: true };
  }
  return ss;
}

function rookieProjFromScore(rookieRow, pos) {
  if (!rookieRow?.rookie_score) return null;
  if (rookieRow.proj_week_pts >= 1) return rookieRow.proj_week_pts;
  const s = rookieRow.rookie_score;
  const base = { QB: 8, RB: 6, WR: 5, TE: 4 }[pos] ?? 5;
  const ceil = { QB: 22, RB: 16, WR: 14, TE: 10 }[pos] ?? 14;
  return parseFloat((base + (ceil - base) * (s / 100)).toFixed(1));
}

function estimateProjFromAdp(p) {
  if (!p || p.pos === 'DST' || p.pos === 'K') return null;
  const rank = Math.min(p.adp || 999, p.ecr || 999);
  if (rank >= 500) return null;
  const base  = { QB: 22, RB: 16, WR: 14, TE: 10 }[p.pos] ?? 14;
  const slope = { QB: 0.06, RB: 0.06, WR: 0.05, TE: 0.04 }[p.pos] ?? 0.05;
  const floor = { QB: 6, RB: 4, WR: 4, TE: 3 }[p.pos] ?? 4;
  return parseFloat(Math.max(floor, base - rank * slope).toFixed(1));
}

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

const SLOT_ORDER = ['QB', 'RB', 'WR', 'TE', 'FLEX', 'K', 'DST', 'BENCH'];

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

function RosterWriteupBlock({ writeup, aiNotes, notesList, borderTop }) {
  const [expanded, setExpanded] = React.useState(false);
  if (writeup?.writeup) {
    const paragraphs = writeup.writeup.split(/\n\n+/).filter(Boolean);
    const genDate = writeup.generated_at ? new Date(writeup.generated_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : null;
    return (
      <div style={{ borderTop, paddingTop: borderTop !== 'none' ? 6 : 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 5 }}>
          <span style={{ fontSize: 9, fontFamily: 'var(--font-mono)', fontWeight: 800, padding: '1px 5px', borderRadius: 3, background: 'rgba(198,255,58,.12)', color: '#c6ff3a', border: '1px solid rgba(198,255,58,.25)', whiteSpace: 'nowrap' }}>FantasAI</span>
          <span style={{ fontSize: 9, fontFamily: 'var(--font-mono)', color: 'var(--text-faint)' }}>Qwen · {genDate || 'local'}</span>
        </div>
        <div style={{ fontSize: 11, color: 'var(--text)', lineHeight: 1.55 }}>
          {(expanded ? paragraphs : paragraphs.slice(0, 1)).map((para, i) => (
            <p key={i} style={{ margin: i > 0 ? '8px 0 0' : 0 }}>{para}</p>
          ))}
        </div>
        {paragraphs.length > 1 && (
          <button
            onClick={e => { e.stopPropagation(); setExpanded(v => !v); }}
            style={{ marginTop: 4, fontSize: 9, fontFamily: 'var(--font-mono)', color: '#c6ff3a', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
          >{expanded ? '↑ less' : `↓ +${paragraphs.length - 1} more`}</button>
        )}
        {aiNotes && ((aiNotes.waiver_relevance >= 6) || (aiNotes.dynasty_relevance >= 6)) && (
          <div style={{ display: 'flex', gap: 5, marginTop: 4 }}>
            {aiNotes.waiver_relevance >= 6 && <span style={{ fontSize: 9, fontFamily: 'var(--font-mono)', fontWeight: 700, color: 'var(--warn)', background: 'rgba(255,181,71,.1)', border: '1px solid rgba(255,181,71,.3)', borderRadius: 3, padding: '1px 5px' }}>W {Number(aiNotes.waiver_relevance).toFixed(1)}</span>}
            {aiNotes.dynasty_relevance >= 6 && <span style={{ fontSize: 9, fontFamily: 'var(--font-mono)', fontWeight: 700, color: '#b4a0ff', background: 'rgba(180,160,255,.1)', border: '1px solid rgba(180,160,255,.3)', borderRadius: 3, padding: '1px 5px' }}>DYN {Number(aiNotes.dynasty_relevance).toFixed(1)}</span>}
          </div>
        )}
      </div>
    );
  }
  const fetchTs = aiNotes?.last_updated ? new Date(aiNotes.last_updated).getTime() : null;
  return (
    <div style={{ borderTop, paddingTop: borderTop !== 'none' ? 5 : 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 5 }}>
        <span style={{ fontSize: 9, fontFamily: 'var(--font-mono)', fontWeight: 800, padding: '1px 5px', borderRadius: 3, background: 'rgba(198,255,58,.12)', color: '#c6ff3a', border: '1px solid rgba(198,255,58,.25)', whiteSpace: 'nowrap', marginTop: 1 }}>FantasAI</span>
        <span style={{ fontSize: 11, color: 'var(--text)', lineHeight: 1.45, flex: 1 }}>{notesList[0].note_text}</span>
        {fetchTs && <span style={{ fontSize: 9, fontFamily: 'var(--font-mono)', color: 'var(--text-faint)', whiteSpace: 'nowrap', marginTop: 1 }}>{new Date(fetchTs).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>}
      </div>
      {notesList.slice(1).map((note, ni) => {
        const dirColor = note.impact_direction === 'positive' ? 'var(--good)' : note.impact_direction === 'negative' ? 'var(--danger)' : '#c6ff3a';
        return (
          <div key={ni} style={{ display: 'flex', gap: 5, alignItems: 'flex-start', paddingLeft: 4 }}>
            <span style={{ color: dirColor, fontSize: 9, marginTop: 2, flexShrink: 0 }}>{note.impact_direction === 'positive' ? '▲' : note.impact_direction === 'negative' ? '▼' : '◆'}</span>
            <span style={{ fontSize: 11, color: 'var(--text-dim)', lineHeight: 1.45 }}>{note.note_text}</span>
          </div>
        );
      })}
      {aiNotes && ((aiNotes.waiver_relevance >= 6) || (aiNotes.dynasty_relevance >= 6)) && (
        <div style={{ display: 'flex', gap: 5, marginTop: 1 }}>
          {aiNotes.waiver_relevance >= 6 && <span style={{ fontSize: 9, fontFamily: 'var(--font-mono)', fontWeight: 700, color: 'var(--warn)', background: 'rgba(255,181,71,.1)', border: '1px solid rgba(255,181,71,.3)', borderRadius: 3, padding: '1px 5px' }}>W {Number(aiNotes.waiver_relevance).toFixed(1)}</span>}
          {aiNotes.dynasty_relevance >= 6 && <span style={{ fontSize: 9, fontFamily: 'var(--font-mono)', fontWeight: 700, color: '#b4a0ff', background: 'rgba(180,160,255,.1)', border: '1px solid rgba(180,160,255,.3)', borderRadius: 3, padding: '1px 5px' }}>DYN {Number(aiNotes.dynasty_relevance).toFixed(1)}</span>}
        </div>
      )}
    </div>
  );
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
  const [tab, setTab] = React.useState('roster');
  const [dragId, setDragId] = React.useState(null);
  const [dragOver, setDragOver] = React.useState(null);
  const [swapTarget, setSwapTarget] = React.useState(null);      // { playerId, slot }
  const [compareIds, setCompareIds] = React.useState([]);         // [id1, id2] for compare popup
  const [addDropPending, setAddDropPending] = React.useState(null); // { addPlayer, dropPlayerId }
  const [expandedNews, setExpandedNews] = React.useState(new Set()); // playerIds with expanded news
  const [expandedArts, setExpandedArts] = React.useState(new Set()); // playerIds with expanded article list
  const [matchupExpanded, setMatchupExpanded] = React.useState(false);

  // NFL schedule fetched live from ESPN scoreboard API — all 18 weeks
  const [nflSchedule, setNflSchedule] = React.useState({});
  const [fullSchedule, setFullSchedule] = React.useState({});
  React.useEffect(() => {
    const season = H2H_SEASON_START.getFullYear();
    fetchFullEspnSchedule(season).then(weeks => {
      setFullSchedule(weeks);
      if (weeks[H2H_WEEK]) setNflSchedule(weeks[H2H_WEEK]);
    });
  }, []);

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

  // Proj totals from starters (non-bench) — computed after rookieScoreMap below
  const starters = fullRoster.filter(r => r.slot !== 'BENCH' && r.playerId);

  const [swapError, setSwapError] = React.useState(null);
  // R2 injury report written by Databricks — used to populate Updated News/Live column on load
  const { data: r2InjuryData, fetchedAt: r2InjuryFetchedAt } = useR2Injuries();
  const { data: r2PlayerNotes }  = useR2PlayerNotes();
  const { data: r2EnrichedNews } = useR2EnrichedNews();
  const { data: r2WeatherData }  = useR2WeatherForecast();
  const { data: r2Breakouts }    = useR2BreakoutCandidates();
  const { data: r2PlayerNewsData } = useR2PlayerNewsLinks();
  const { data: r2DefenseData }  = useR2DefensePerformance();
  const { data: r2DefVsPos }     = useR2DefenseVsPos();
  const { data: r2WriteupsRaw }  = useR2PlayerWriteups();
  const { data: r2StartSitRaw }  = useR2WeeklyStartSit();
  const { data: r2RookieScoresData } = useR2RookieScores();
  const rookieScoreMap = React.useMemo(() => {
    const arr = r2RookieScoresData?.players || [];
    const m = new Map();
    for (const r of arr) { if (r.player_name) m.set(r.player_name.toLowerCase().trim(), r); }
    return m;
  }, [r2RookieScoresData]);
  const totalProj = starters.reduce((s, r) => {
    const p = findPlayer(r.playerId);
    if (!p) return s;
    if (p.proj > 0) return s + p.proj;
    const noStats = (p.pts2025 || 0) === 0 && (p.avg || 0) === 0;
    if (!noStats) return s;
    const rr = p.rookie ? rookieScoreMap.get(p.name.toLowerCase().trim()) : null;
    const rProj = rr ? rookieProjFromScore(rr, p.pos) : null;
    return s + (rProj || estimateProjFromAdp(p) || 0);
  }, 0);
  const startSitMap = React.useMemo(() => {
    const players = r2StartSitRaw?.players || {};
    const m = new Map();
    for (const [name, entry] of Object.entries(players)) {
      m.set(name.toLowerCase().trim(), entry);
    }
    return m;
  }, [r2StartSitRaw]);

  const writeupsMap = React.useMemo(() => {
    const players = r2WriteupsRaw?.players || r2WriteupsRaw || {};
    const m = new Map();
    for (const [name, entry] of Object.entries(players)) {
      m.set(name.toLowerCase().trim(), entry);
    }
    return m;
  }, [r2WriteupsRaw]);

  // Position-specific matchup index: "TEAM|POS" → rank_vs_pos (1=toughest, 32=easiest)
  const defVsPosIndex = React.useMemo(() => {
    const arr = r2DefVsPos?.data || [];
    const m = new Map();
    for (const row of arr) {
      if (row.def_team && row.position)
        m.set(`${row.def_team.toUpperCase()}|${row.position}`, row.rank_vs_pos);
    }
    return m;
  }, [r2DefVsPos]);

  // Defense rank lookup: team abbrev → rank 1-32 (1=toughest, 32=easiest matchup)
  const defRankByTeam = React.useMemo(() => {
    const arr = r2DefenseData?.data || (Array.isArray(r2DefenseData) ? r2DefenseData : []);
    if (!arr.length) return {};
    const latestByTeam = {};
    for (const row of arr) {
      const t = row.team;
      if (t && (!latestByTeam[t] || row.week > latestByTeam[t].week))
        latestByTeam[t] = row;
    }
    const sorted = Object.values(latestByTeam)
      .sort((a, b) => (b.avg_last_4_weeks || 0) - (a.avg_last_4_weeks || 0));
    const ranks = {};
    sorted.forEach((row, i) => { ranks[row.team] = i + 1; });
    return ranks;
  }, [r2DefenseData]);

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
  const DST_TEAM_KEYWORDS = { ARI: 'cardinals', ATL: 'falcons', BAL: 'ravens', BUF: 'bills', CAR: 'panthers', CHI: 'bears', CIN: 'bengals', CLE: 'browns', DAL: 'cowboys', DEN: 'broncos', DET: 'lions', GB: 'packers', HOU: 'texans', IND: 'colts', JAX: 'jaguars', KC: 'chiefs', LAC: 'chargers', LAR: 'rams', LV: 'raiders', MIA: 'dolphins', MIN: 'vikings', NE: 'patriots', NO: 'saints', NYG: 'giants', NYJ: 'jets', PHI: 'eagles', PIT: 'steelers', SEA: 'seahawks', SF: '49ers', TB: 'buccaneers', TEN: 'titans', WAS: 'commanders' };

  const playerNewsMap = React.useMemo(() => {
    const m = new Map();
    const rosterNames = new Set(fullRoster.map(r => { const p = findPlayer(r.playerId); return p ? normalizeName(p.name) : null; }).filter(Boolean));
    const dstMap = {};
    for (const r of fullRoster) {
      const p = r.playerId ? findPlayer(r.playerId) : null;
      if (p?.pos === 'DST' && p.team) {
        const kw = DST_TEAM_KEYWORDS[p.team.toUpperCase()];
        if (kw) dstMap[kw] = normalizeName(p.name);
      }
    }
    for (const a of mergedArticles) {
      const key = normalizeName(a.player_name || '');
      if (key) {
        if (!m.has(key)) m.set(key, []);
        m.get(key).push(a);
      }
      const headline = (a.headline || a.title || '').toLowerCase();
      if (headline) {
        for (const rn of rosterNames) {
          if (rn.length >= 5 && headline.includes(rn) && rn !== key) {
            if (!m.has(rn)) m.set(rn, []);
            m.get(rn).push(a);
          }
        }
        for (const [kw, dstName] of Object.entries(dstMap)) {
          if (headline.includes(kw) && (headline.includes('defense') || headline.includes('d/st') || headline.includes('dst') || a.team?.toUpperCase() === dstName.replace(' d/st','').toUpperCase())) {
            if (!m.has(dstName)) m.set(dstName, []);
            m.get(dstName).push(a);
          }
        }
      }
    }
    return m;
  }, [mergedArticles, fullRoster]);

  // Map player name → FantasAI Job 1 notes entry for per-player news cell display
  const r2NotesLookup = React.useMemo(() => {
    const m = new Map();
    const arr = Array.isArray(r2PlayerNotes) ? r2PlayerNotes : [];
    // Stub pattern: "Firstname Lastname - Updated/Update" with no real body
    const isStub = (text) => /^[\w\s.''-]+ [-–] (updated?|news)$/i.test((text || '').trim());
    for (const pn of arr) {
      if (!pn.player_name) continue;
      const rawNotes = Array.isArray(pn.notes) ? pn.notes
        : typeof pn.notes === 'string' ? (() => { try { return JSON.parse(pn.notes); } catch { return []; } })()
        : [];
      const realNotes = rawNotes.filter(n => {
        const t = (n.note_text || '').trim();
        return t.length > 0 && !isStub(t);
      });
      // Only add to lookup if there's real content or meaningful signals
      const hasSignals = (pn.waiver_relevance >= 5) || (pn.dynasty_relevance >= 5) || pn.has_injury_concern;
      if (!realNotes.length && !hasSignals) continue;
      m.set(pn.player_name.toLowerCase().trim(), { ...pn, notes: realNotes });
    }
    return m;
  }, [r2PlayerNotes]);

  const breakoutByName = React.useMemo(() => {
    if (!Array.isArray(r2Breakouts)) return new Map();
    const m = new Map();
    r2Breakouts.forEach(b => { if (b.player_name) m.set(b.player_name.toLowerCase(), b); });
    return m;
  }, [r2Breakouts]);

  // Live injury refresh — fetches directly from Sleeper API (real-time, not R2 cache)
  const [injuryRefreshing, setInjuryRefreshing] = React.useState(false);
  const [injuryRefreshedAt, setInjuryRefreshedAt] = React.useState(null);
  const [injuryRefreshResult, setInjuryRefreshResult] = React.useState(null);
  async function handleInjuryRefresh() {
    if (injuryRefreshing) return;
    setInjuryRefreshing(true);
    setInjuryRefreshResult(null);
    try {
      const map = await fetch('https://api.sleeper.app/v1/players/nfl', { signal: AbortSignal.timeout(15000) }).then(r => r.json());
      const STATUS_MAP = { Questionable: 'Q', Doubtful: 'D', Out: 'O', Injured_Reserve: 'IR', Non_Football_Injury: 'NFI', PUP: 'PUP', Suspended: 'SUS' };
      let updated = 0;
      patchPlayers(p => {
        const sleeper = Object.values(map).find(s => {
          const full = s.full_name || `${s.first_name || ''} ${s.last_name || ''}`.trim();
          return full && full.toLowerCase().trim() === p.name?.toLowerCase().trim();
        });
        if (!sleeper) return p;
        const rawStatus = sleeper.injury_status || null;
        const newStatus = rawStatus ? (STATUS_MAP[rawStatus] || rawStatus) : 'OK';
        if (p.status === newStatus) return p;
        updated++;
        return { ...p, status: newStatus };
      });
      const sleeperByName = {};
      for (const s of Object.values(map)) {
        const full = s.full_name || `${s.first_name || ''} ${s.last_name || ''}`.trim();
        if (full) sleeperByName[full.toLowerCase().trim()] = s.injury_status || null;
      }
      setLiveData(prev => {
        const next = { ...prev };
        for (const pid of Object.keys(next)) {
          const p = findPlayer(Number(pid));
          if (!p) continue;
          const sleeperStatus = sleeperByName[p.name?.toLowerCase().trim()];
          if (sleeperStatus === undefined) continue;
          if (!sleeperStatus) {
            delete next[pid];
          } else {
            next[pid] = (next[pid] || []).map(e => ({ ...e, liveStatus: sleeperStatus }));
          }
        }
        return next;
      });
      setInjuryRefreshedAt(new Date());
      setInjuryRefreshResult({ updated, total: Object.keys(map).length });
    } catch (e) {
      setInjuryRefreshResult({ error: e.message });
    } finally {
      setInjuryRefreshing(false);
    }
  }

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
      }
      if ((STATUS_RANK[s] || 0) > (STATUS_RANK[worst] || 0)) worst = s;
    }
    return worst;
  }
  React.useEffect(() => {
    if (!Object.keys(liveData).length) return;
    let changed = false;
    patchPlayers(p => {
      const live = deriveStatus(p.id);
      if (!live || live === 'OK') return p;
      if (p.status === live) return p;
      changed = true;
      return { ...p, status: live };
    });
  }, [liveData]); // eslint-disable-line react-hooks/exhaustive-deps

  const [fetchingSourceIds, setFetchingSourceIds] = React.useState(new Set());
  const [lastFetched,       setLastFetched]       = React.useState({});
  const [refreshResults,    setRefreshResults]    = React.useState({});  // { [srcId]: { updated, total } }

  // Sleeper-sourced total projection for starters
  const sleeperColor    = '#1c8eaf';
  const sleeperProjTotal = starters.reduce((sum, r) => {
    const p = findPlayer(r.playerId);
    if (!p) return sum;
    const apiStatus = liveData[p.id]?.length > 0 ? deriveStatus(p.id) : null;
    const rawStatus = apiStatus ?? p.status ?? 'OK';
    const liveStatus = rawStatus === 'Out' ? 'O' : rawStatus;
    const isOut = ['O', 'IR', 'NFI'].includes(liveStatus);
    if (isOut) return sum;
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

  // Swap-picker options (bench moves + top free agents matching the player's position)
  const swapPlayerPos = swapTarget ? (findPlayer(swapTarget.playerId)?.pos || null) : null;
  const swapBenchOpts = swapTarget
    ? fullRoster.filter(r => r.slot === 'BENCH' && r.playerId && r.playerId !== swapTarget.playerId && canFillSlot(findPlayer(r.playerId)?.pos, swapTarget.slot))
    : [];
  const swapFAOpts = swapTarget
    ? allPlayers.filter(p => !allRosteredIds.has(p.id) && p.pos === swapPlayerPos).sort((a, b) => (b.proj || 0) - (a.proj || 0)).slice(0, 20)
    : [];

  // Build news feed for this roster
  const rosterPlayerIds = new Set(fullRoster.map(r => r.playerId).filter(Boolean));
  const rosterPlayers   = allPlayers.filter(p => rosterPlayerIds.has(p.id)).map(p => {
    const live = deriveStatus(p.id);
    return live && live !== 'OK' ? { ...p, status: live } : p;
  });

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
    const isStub = (text) => /^[\w\s.''-]+ [-–] (updated?|news)$/i.test((text || '').trim());

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
        const headline = article.headline || '';
        const body = article.full_text || article.description || '';
        // Skip articles that are just bare "Player - Updated" stubs with no body
        if (isStub(headline) && !body.trim()) continue;
        const publishedAt = article.published_at ? new Date(article.published_at) : null;
        const minsAgo = publishedAt ? Math.max(0, Math.floor((Date.now() - publishedAt.getTime()) / 60000)) : 9999;
        let sourceLabel = 'FantasAI News';
        try { sourceLabel = new URL(article.source_url).hostname.replace(/^www\./, ''); } catch {}
        items.push({
          id:        `r2-enriched-${p.id}-${article.published_at || Math.random()}`,
          playerId:  p.id,
          impact:    'med',
          title:     headline || `${p.name} Update`,
          body,
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
      // notes may arrive as a JSON-encoded string from Spark serialization
      const notes = Array.isArray(pn.notes) ? pn.notes
        : typeof pn.notes === 'string' ? (() => { try { return JSON.parse(pn.notes); } catch { return []; } })()
        : [];
      if (!notes.length) continue;
      const p = matchRosterPlayer(pn.player_name || '');
      if (!p || !rosterPlayerIds.has(p.id) || coveredByEnriched.has(p.id)) continue;

      // Filter real notes — skip bare "Player Name - Updated/Update" stubs
      const realNotes = notes.filter(n => {
        const t = (n.note_text || '').trim();
        return t.length > 0 && !isStub(t);
      });

      const hasWaiver  = (pn.waiver_relevance  ?? 0) >= 5;
      const hasDynasty = (pn.dynasty_relevance ?? 0) >= 5;
      const hasRookie  = (pn.rookie_relevance  ?? 0) >= 5;
      const hasInjury  = pn.has_injury_concern || (pn.injury_status && pn.injury_status !== 'none');

      // Skip entry if there's no real content at all
      if (!realNotes.length && !hasWaiver && !hasDynasty && !hasInjury) continue;

      const note   = realNotes[0] || notes[0];
      const impact = pn.has_critical_news || note.priority === 'critical' ? 'high'
                   : hasInjury || note.priority === 'high'                ? 'med'
                   : note.impact_direction === 'positive'                  ? 'good'
                   : 'low';
      const publishedAt = note.published_at ? new Date(note.published_at) : null;
      const minsAgo = publishedAt ? Math.max(0, Math.floor((Date.now() - publishedAt.getTime()) / 60000))
                    : pn.last_updated ? Math.max(0, Math.floor((Date.now() - new Date(pn.last_updated).getTime()) / 60000))
                    : 9999;
      items.push({
        id:              `r2-note-${p.id}`,
        playerId:        p.id,
        impact,
        title:           realNotes[0]?.note_text || null,
        body:            realNotes.map(n => n.note_text).filter(Boolean).join('\n\n'),
        allNotes:        realNotes,
        mins:            minsAgo,
        source:          'FantasAI',
        publishedAt:     publishedAt?.toISOString() || pn.last_updated || null,
        overallImpact:   pn.overall_impact_score ?? null,
        sentiment:       pn.sentiment || 'neutral',
        waiverRelevance: pn.waiver_relevance ?? 0,
        dynastyRelevance: pn.dynasty_relevance ?? 0,
        rookieRelevance: pn.rookie_relevance ?? 0,
        injuryStatus:    pn.injury_status || null,
        articleCount:    pn.article_count || notes.length,
        hasInjury,
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
    const myProj  = h2hScore(teamId);
    const oppProj = h2hScore(oppId);
    const winPct  = myProj / (myProj + oppProj);
    return { oppId, myProj, oppProj, winPct };
  }, [teamId]);

  // Live matchup win/loss for row highlight color
  const matchupWinning = React.useMemo(() => {
    if (!myMatchup) return null;
    const myAcc  = starters.reduce((s, e) => {
      const p = e.playerId ? findPlayer(e.playerId) : null;
      return s + (p ? buildScoringBreakdown(p, H2H_WEEK).accumulated : 0);
    }, 0);
    const oppSt  = (TEAM_ROSTERS[myMatchup.oppId] || []).filter(r => r.slot !== 'BENCH' && r.playerId);
    const oppAcc = oppSt.reduce((s, e) => {
      const p = e.playerId ? findPlayer(e.playerId) : null;
      return s + (p ? buildScoringBreakdown(p, H2H_WEEK).accumulated : 0);
    }, 0);
    return myAcc >= oppAcc;
  }, [myMatchup, starters]);

  // Optimal lineup projection for header display — Out/IR/bye players score 0
  const optimalProjFn = React.useCallback(p => {
    if (!p) return 0;
    const derived = deriveStatus(p.id);
    const s = (derived || p.status || '').toUpperCase();
    if (['OUT', 'O', 'IR', 'NFI', 'PUP', 'SUSPENDED'].includes(s)) return 0;
    if (p.bye && p.bye === H2H_WEEK) return 0;
    return p.proj ?? 0;
  }, [liveData]); // eslint-disable-line react-hooks/exhaustive-deps
  const optimalSlots = React.useMemo(
    () => computeOptimal(fullRoster.filter(r => r.slot !== 'BENCH'), rosterPlayers, optimalProjFn, H2H_WEEK),
    [fullRoster, rosterPlayers, optimalProjFn],
  );
  const optimalTotal = optimalSlots.reduce((s, e) => s + optimalProjFn(findPlayer(e.playerId)), 0);
  const optimalGain  = Math.max(0, optimalTotal - totalProj);
  const [appliedOptimal, setAppliedOptimal] = React.useState(false);

  // Highlight intensity slider — 0 (off) to 100 (max), default 50
  const [hlIntensity, setHlIntensity] = React.useState(
    () => Number(localStorage.getItem('fantasai_hl_intensity') ?? 50)
  );
  function handleHlChange(v) {
    setHlIntensity(v);
    localStorage.setItem('fantasai_hl_intensity', v);
  }

  // Scale base opacity values by intensity (50 = 1×, 0 = off, 100 = ~2×)
  const hlMult = hlIntensity / 50;
  function hla(r, g, b, base) {
    return `rgba(${r},${g},${b},${Math.min(0.85, base * hlMult).toFixed(3)})`;
  }
  function handleApplyOptimal() {
    const overrides = {};
    for (const { slot, playerId } of optimalSlots) {
      if (playerId) overrides[playerId] = slot;
    }
    onSlotOverridesChange?.(overrides);
    setAppliedOptimal(true);
    setTimeout(() => setAppliedOptimal(false), 3000);
  }

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
                  <span style={{ fontSize: 11, fontWeight: 800, color: _isWin ? '#1affa0' : 'var(--danger)' }}>
                    {_isWin ? '▲' : '▼'} {_liveWin}% live · Proj {_projWin}%
                  </span>
                  <span style={{ fontSize: 10, color: 'var(--text-faint)' }}>{matchupExpanded ? '▲' : '▼'}</span>
                </div>
              );
            })()}
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 20 }}>
              <div>
                <div style={{ fontSize: 9, fontFamily: 'var(--font-mono)', fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--text-faint)', marginBottom: 1 }}>Current Proj</div>
                <div style={{ fontFamily: 'var(--font-display)', fontWeight: 900, fontStretch: '75%', fontSize: 22, color: '#4ea8ff', lineHeight: 1 }}>
                  {totalProj.toFixed(1)}
                </div>
              </div>
              {optimalGain > 0.05 && (
                <div>
                  <div style={{ fontSize: 9, fontFamily: 'var(--font-mono)', fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--text-faint)', marginBottom: 1 }}>Optimal Proj</div>
                  <div style={{ fontFamily: 'var(--font-display)', fontWeight: 900, fontStretch: '75%', fontSize: 22, color: '#1affa0', lineHeight: 1 }}>
                    {optimalTotal.toFixed(1)}
                  </div>
                  <div style={{ fontSize: 9, color: '#1affa0', marginTop: 1 }}>+{optimalGain.toFixed(1)} pts</div>
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
          <button
            className={`btn sm ${(appliedOptimal || optimalGain <= 0.05) ? 'success' : 'primary'}`}
            style={{ fontSize: 11, whiteSpace: 'nowrap', fontWeight: 700, padding: '6px 14px' }}
            onClick={handleApplyOptimal}
            disabled={appliedOptimal || optimalGain <= 0.05}
          >
            {(appliedOptimal || optimalGain <= 0.05)
              ? '✓ Optimal Lineup'
              : `⚡ Apply Optimal Lineup (+${optimalGain.toFixed(1)} pts)`}
          </button>
          <LineupLockCountdown nflSchedule={nflSchedule} rosterPlayers={rosterPlayers} />
        </div>
      </div>

      {/* Tabs */}
      <div className="tabs" style={{ padding: '0 18px' }}>
        <div className={`tab ${tab === 'roster' ? 'active' : ''}`} onClick={() => setTab('roster')}>My Roster</div>
        <div className={`tab ${tab === 'waivers' ? 'active' : ''}`} onClick={() => setTab('waivers')}>Waiver Wire</div>
        <div className={`tab ${tab === 'byeweek' ? 'active' : ''}`} onClick={() => setTab('byeweek')}>Bye Weeks</div>
        <div className={`tab ${tab === 'sos' ? 'active' : ''}`} onClick={() => setTab('sos')}>Schedule</div>
        <div className={`tab ${tab === 'allrosters' ? 'active' : ''}`} onClick={() => setTab('allrosters')}>All Rosters</div>
        <div className={`tab ${tab === 'news' ? 'active' : ''}`} onClick={() => setTab('news')}>
          News &amp; Updates
          {injuryCount > 0 && (
            <span style={{ marginLeft: 6, background: 'var(--danger)', color: '#fff', fontSize: 10, fontWeight: 700, padding: '1px 5px', borderRadius: 10, fontFamily: 'var(--font-mono)' }}>
              {injuryCount}
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
                  const receivePlayers = offer.getIds.map(id => findPlayer(id)).filter(Boolean);
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
                              <span style={{ fontSize: 9, fontFamily: 'var(--font-mono)', fontWeight: 700, background: 'rgba(26,255,160,.20)', color: 'var(--good)', border: '1px solid rgba(26,255,160,.45)', borderRadius: 3, padding: '0 4px' }}>{p.pos}</span>
                              <span style={{ fontWeight: 600 }}>{p.name}</span>
                              <span style={{ color: 'var(--text-faint)', fontSize: 11 }}>{p.team} · {p.avg.toFixed(1)}</span>
                            </div>
                          ))}
                          {givePlayers.length === 0 && <span style={{ fontSize: 11, color: 'var(--text-faint)' }}>—</span>}
                        </div>
                        <div style={{ width: 1, background: 'rgba(255,215,0,.2)' }} />
                        <div style={{ flex: 1, minWidth: 140 }}>
                          <div style={{ fontSize: 9, fontFamily: 'var(--font-mono)', fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--danger)', marginBottom: 4 }}>You Give Up</div>
                          {receivePlayers.map(p => (
                            <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, marginBottom: 3 }}>
                              <span style={{ fontSize: 9, fontFamily: 'var(--font-mono)', fontWeight: 700, background: 'rgba(255,90,110,.12)', color: 'var(--danger)', border: '1px solid rgba(255,90,110,.3)', borderRadius: 3, padding: '0 4px' }}>{p.pos}</span>
                              <span style={{ fontWeight: 600 }}>{p.name}</span>
                              <span style={{ color: 'var(--text-faint)', fontSize: 11 }}>{p.team} · {p.avg.toFixed(1)}</span>
                            </div>
                          ))}
                          {receivePlayers.length === 0 && <span style={{ fontSize: 11, color: 'var(--text-faint)' }}>—</span>}
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
            const isPreSeason = new Date() < H2H_SEASON_START;
            const opp        = LEAGUE_TEAMS.find(t => t.id === myMatchup.oppId);
            const myTeam     = findTeam(teamId);
            const oppRoster  = TEAM_ROSTERS[myMatchup.oppId] || [];
            const oppStarters = oppRoster.filter(r => r.slot !== 'BENCH' && r.playerId);

            if (isPreSeason && matchupExpanded) {
              return (
                <div style={{ margin: '0 18px 8px', background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 8, padding: '24px 20px', textAlign: 'center' }}>
                  <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 6 }}>Live Scoring — Available Week 1</div>
                  <div style={{ fontSize: 11, color: 'var(--text-faint)', lineHeight: 1.6 }}>
                    Player-by-player scoring breakdown with live ESPN data will appear here once the 2026 season kicks off (Sep 9).
                    <br/>Projected matchup: <strong style={{ color: 'var(--accent)' }}>{myTeam?.name}</strong> ({myMatchup.myProj.toFixed(1)} proj) vs <strong style={{ color: 'var(--text-dim)' }}>{opp?.name}</strong> ({myMatchup.oppProj.toFixed(1)} proj)
                  </div>
                </div>
              );
            }
            if (isPreSeason) return null;

            // Accumulated scores (real ESPN data during season)
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
              const arrowColor = ahead ? '#1affa0' : 'var(--danger)';
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
                  <span style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: ahead ? '#1affa0' : 'var(--danger)', fontWeight: 700 }}>{accumulated.toFixed(1)}</span>
                  <span style={{ fontSize: 9, color: ahead ? '#1affa0' : 'var(--danger)' }}>{ahead ? '▲' : '▼'}</span>
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
                          <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 900, fontSize: 16, color: isWinning ? '#1affa0' : 'var(--text)' }}>{myAccum.toFixed(1)}</span>
                          <span style={{ fontSize: 10, color: 'var(--text-faint)', fontFamily: 'var(--font-mono)' }}>pts</span>
                        </div>
                        <div style={{ textAlign: 'center' }}>
                          <div style={{ fontSize: 12, fontWeight: 900, fontFamily: 'var(--font-display)', color: isWinning ? '#1affa0' : 'var(--danger)', letterSpacing: '.04em' }}>
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
                          <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 900, fontSize: 16, color: !isWinning ? '#1affa0' : 'var(--text)' }}>{oppAccum.toFixed(1)}</span>
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

          {/* ── Highlight intensity slider ── */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 14px', borderBottom: '1px solid var(--border)', background: 'var(--bg-2)' }}>
            <span style={{ fontSize: 9, fontFamily: 'var(--font-mono)', fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--text-faint)', whiteSpace: 'nowrap' }}>Row Highlights</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, flex: 1, maxWidth: 220 }}>
              <span style={{ fontSize: 9, color: 'var(--text-faint)', fontFamily: 'var(--font-mono)' }}>Off</span>
              <input
                type="range" min={0} max={100} value={hlIntensity}
                onChange={e => handleHlChange(Number(e.target.value))}
                style={{ flex: 1, accentColor: hlIntensity === 0 ? 'var(--text-faint)' : hlIntensity < 40 ? '#4ea8ff' : hlIntensity < 70 ? '#1affa0' : '#ffd700', cursor: 'pointer', height: 3 }}
              />
              <span style={{ fontSize: 9, color: 'var(--text-faint)', fontFamily: 'var(--font-mono)' }}>Max</span>
            </div>
            <span style={{ fontSize: 9, fontFamily: 'var(--font-mono)', fontWeight: 700, color: hlIntensity === 0 ? 'var(--text-faint)' : 'var(--accent)', minWidth: 28, textAlign: 'right' }}>{hlIntensity}%</span>
            {hlIntensity !== 50 && (
              <button onClick={() => handleHlChange(50)} style={{ fontSize: 9, fontFamily: 'var(--font-mono)', color: 'var(--text-faint)', background: 'none', border: 'none', cursor: 'pointer', padding: '0 2px', textDecoration: 'underline' }}>reset</button>
            )}
          </div>

          <table className="data-table">
            <thead>
              {/* ── Column group labels (row 1) ── */}
              {(() => {
                const grpBox = { padding: '5px 6px 4px', textAlign: 'center', fontSize: 10, fontFamily: 'var(--font-mono)', fontWeight: 800, letterSpacing: '.1em', color: 'rgba(255,255,255,.7)', border: '1px solid rgba(255,255,255,.18)', borderBottom: 'none', background: 'rgba(255,255,255,.04)', borderRadius: '3px 3px 0 0' };
                const grpBlue = { ...grpBox, background: 'rgba(78,168,255,.12)', border: '1px solid rgba(78,168,255,.3)', borderBottom: 'none', color: '#4ea8ff' };
                const blank   = { padding: '5px 0 4px', border: 'none', background: 'transparent' };
                return (
                  <tr>
                    <th colSpan={2} style={blank} />
                    <th colSpan={1} style={grpBlue}>STATUS</th>
                    <th colSpan={3} style={grpBlue}>SCHEDULE</th>
                    <th colSpan={1} style={grpBlue}>WEATHER</th>
                    <th colSpan={1} style={grpBlue}>TRENDS</th>
                    <th colSpan={3} style={grpBlue}>FANTASY POINTS</th>
                    <th colSpan={1} style={grpBlue}>NEWS</th>
                    <th colSpan={2} style={blank} />
                  </tr>
                );
              })()}
              {/* ── Column headers (row 2) ── */}
              {(() => {
                const side  = '1px solid rgba(255,255,255,.18)';
                const sideL = { borderLeft: side };
                const sideR = { borderRight: side };
                const sideLR = { borderLeft: side, borderRight: side };
                return (
                  <tr>
                    <th style={{ paddingRight: 4, width: 1, whiteSpace: 'nowrap', fontWeight: 800, color: '#fff' }}>Slot</th>
                    <th style={{ fontWeight: 800, color: '#fff' }}>Player</th>
                    {/* STATUS */}
                    <th style={{ whiteSpace: 'nowrap' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                        <span>Status</span>
                        <button
                          className="btn sm"
                          style={{ fontSize: 9, padding: '1px 6px', background: 'rgba(255,152,0,.1)', borderColor: 'rgba(255,152,0,.3)', color: '#ff9800', fontWeight: 700, lineHeight: 1.4 }}
                          disabled={injuryRefreshing}
                          onClick={handleInjuryRefresh}
                        >
                          {injuryRefreshing ? '⟳' : injuryRefreshResult?.updated != null ? `✓ ${injuryRefreshResult.updated}` : 'Refresh'}
                        </button>
                      </div>
                      {injuryRefreshedAt && (
                        <div style={{ fontSize: 7, fontFamily: 'var(--font-mono)', color: '#ff9800', fontWeight: 400, marginTop: 1 }}>
                          {injuryRefreshedAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </div>
                      )}
                    </th>
                    {/* SCHEDULE: Bye · Opp · Game Time */}
                    <th className="num" style={sideL}>Bye</th>
                    <th>Opp</th>
                    <th style={{ whiteSpace: 'nowrap', ...sideR }}>Game Time</th>
                    {/* WEATHER */}
                    <th style={{ whiteSpace: 'nowrap', ...sideLR }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 5, justifyContent: 'center' }}>
                        <span>{new Date() < H2H_SEASON_START ? 'Weather (Available 7 days before kickoff)' : 'Weather'}</span>
                        <button
                          className="btn sm"
                          style={{ fontSize: 9, padding: '1px 6px', background: 'rgba(78,168,255,.1)', borderColor: 'rgba(78,168,255,.3)', color: '#4ea8ff', fontWeight: 700, lineHeight: 1.4 }}
                          disabled={weatherRefreshing}
                          onClick={handleWeatherRefresh}
                        >
                          {weatherRefreshing ? '⟳' : 'Refresh'}
                        </button>
                      </div>
                      {weatherRefreshedAt && (
                        <div style={{ fontSize: 7, fontFamily: 'var(--font-mono)', color: '#4ea8ff', fontWeight: 400, marginTop: 1, textAlign: 'center' }}>
                          {fmtTs(weatherRefreshedAt)}
                        </div>
                      )}
                    </th>
                    {/* TRENDS */}
                    <th className="num" style={sideLR}>Trend</th>
                    {/* FANTASY POINTS */}
                    <th className="num" style={sideL}>2025 Pts</th>
                    <th className="num">2025 PPG</th>
                    <th className="num" style={sideR}>Proj</th>
                    <th style={{ maxWidth: 420 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                        <span>News &amp; Articles</span>
                        {activatedSources.length > 0 && (
                          <button
                            className="btn sm"
                            style={{ fontSize: 9, padding: '1px 6px', background: 'rgba(78,168,255,.1)', borderColor: 'rgba(78,168,255,.3)', color: '#4ea8ff', fontWeight: 700, lineHeight: 1.4 }}
                            disabled={fetchingSourceIds.size > 0}
                            onClick={() => activatedSources.forEach(src => handleRefreshSource(src))}
                          >
                            {fetchingSourceIds.size > 0 ? '⟳' : 'Refresh'}
                          </button>
                        )}
                      </div>
                      {r2InjuryFetchedAt && (
                        <div style={{ fontSize: 7, fontFamily: 'var(--font-mono)', color: 'var(--accent-2)', fontWeight: 400, marginTop: 1 }}>
                          {fmtTs(r2InjuryFetchedAt)}
                        </div>
                      )}
                    </th>
                    <th style={{ fontSize: 9, color: 'var(--text-faint)' }}>▶</th>
                    <th></th>
                  </tr>
                );
              })()}
            </thead>
            <tbody>
              {fullRoster.map((entry, i) => {
                const p = entry.playerId ? findPlayer(entry.playerId) : null;
                const isBench = entry.slot === 'BENCH';
                const prevEntry = fullRoster[i - 1];
                const isFirstBench = isBench && prevEntry && prevEntry.slot !== 'BENCH';
                const benchDivider = isFirstBench ? (
                  <tr key={`bench-divider-${i}`} style={{ pointerEvents: 'none' }}>
                    <td colSpan={14} style={{ padding: '6px 14px 4px', background: 'rgba(255,255,255,.03)', borderTop: '2px solid var(--border)' }}>
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
                      <td colSpan={13} style={{ fontSize: 12 }}>
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
                      background: isDragTarget ? 'rgba(198,255,58,.10)' : isOnBye ? hla(255,40,40,.32) : (p.pos === 'DST' && !isBench) ? (matchupWinning === false ? hla(255,40,40,.18) : hla(26,255,160,.22)) : (p.pos !== 'DST' && effectiveStatus === 'Q') ? hla(255,160,0,.24) : (p.pos !== 'DST' && (effectiveStatus === 'O' || effectiveStatus === 'IR')) ? hla(255,40,40,.28) : (p.pos !== 'DST' && isInjured) ? hla(255,59,48,.22) : (!isBench && effectiveStatus === 'OK') ? (matchupWinning === false ? hla(255,40,40,.18) : hla(26,255,160,.22)) : undefined,
                      outline: isDragTarget ? '1px solid rgba(198,255,58,.5)' : undefined,
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
                        <div>
                          <div style={{ fontWeight: 600, fontSize: 13, display: 'flex', alignItems: 'center', gap: 5 }}>
                            {isWatched && <span style={{ color: '#ffd700', fontSize: 11 }}>★</span>}
                            <span style={{ color: isWatched ? '#ffd700' : isOnBye ? 'var(--danger)' : undefined }}>{p.name}</span>
                            {p.rookie && <span style={{ fontSize: 9, fontWeight: 800, color: '#4ea8ff', background: 'rgba(78,168,255,.15)', border: '1px solid rgba(78,168,255,.3)', borderRadius: 3, padding: '1px 4px', letterSpacing: '.04em' }}>R</span>}
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
                    {/* STATUS */}
                    <td>
                      {isOnBye ? (
                        <span style={{ fontSize: 10, fontFamily: 'var(--font-mono)', fontWeight: 700, color: 'var(--danger)', letterSpacing: '.04em' }}>Out · BYE</span>
                      ) : (p.pos !== 'DST' && effectiveStatus !== 'OK') ? (() => {
                        const statusLabel = effectiveStatus === 'Q' ? 'Questionable'
                          : effectiveStatus === 'O' ? 'Out'
                          : effectiveStatus === 'D' ? 'Doubtful'
                          : effectiveStatus === 'IR' ? 'IR'
                          : effectiveStatus;
                        const statusColor = (effectiveStatus === 'Q' || effectiveStatus === 'D') ? '#ff9800'
                          : (effectiveStatus === 'O' || effectiveStatus === 'IR') ? '#ff4f4f'
                          : 'var(--text-dim)';
                        return (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                            <span style={{ fontSize: 10, fontFamily: 'var(--font-mono)', fontWeight: 700, color: statusColor, letterSpacing: '.04em' }}>{statusLabel}</span>
                            {injuryRefreshedAt && (
                              <span style={{ fontSize: 8, fontFamily: 'var(--font-mono)', color: 'var(--text-faint)' }}>{injuryRefreshedAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                            )}
                          </div>
                        );
                      })() : (
                        <span style={{ fontSize: 10, fontFamily: 'var(--font-mono)', fontWeight: 700, color: '#1affa0', letterSpacing: '.04em' }}>Active</span>
                      )}
                    </td>
                    {/* SCHEDULE — Bye · Opp · Game Time */}
                    <td className="num">
                      {p.bye ? (
                        <span style={{
                          fontFamily: 'var(--font-mono)', fontWeight: 700, fontSize: 12,
                          color: isOnBye ? 'var(--danger)' : 'var(--text)',
                        }}>
                          {isOnBye ? '🔴 ' : ''}{p.bye}
                        </span>
                      ) : <span className="faint">—</span>}
                    </td>
                    <td>
                      {(() => {
                        const sched = nflSchedule[p.team];
                        const oppTeam = sched?.opp || p.opp;
                        if (!oppTeam) return <span className="faint">—</span>;
                        const r = defRankByTeam[oppTeam] || p.oppRank;
                        const oppColor = !r ? 'var(--text)'
                          : r <= 5  ? '#ff4f4f'
                          : r <= 10 ? '#ff9800'
                          : r <= 20 ? '#ffd700'
                          : '#1affa0';
                        // Position-specific matchup indicator
                        const posKey = p.pos === 'DST' ? null : p.pos;
                        let posRank = posKey ? defVsPosIndex.get(`${oppTeam.toUpperCase()}|${posKey}`) ?? null : null;
                        // DST: compute offensive quality of opponent (invert — weak offense = good for DST)
                        if (p.pos === 'DST' && oppTeam) {
                          const offPts = ['QB','RB','WR'].map(op => {
                            const val = defVsPosIndex.get(`${oppTeam.toUpperCase()}|${op}`);
                            return val ?? null;
                          }).filter(v => v != null);
                          if (offPts.length) {
                            const avgRank = offPts.reduce((s,v) => s+v, 0) / offPts.length;
                            posRank = Math.round(33 - avgRank);
                          }
                        }
                        const matchup = posRank == null ? null
                          : posRank <= 5  ? { emoji: '🔴',      label: 'Avoid',     score: -2 }
                          : posRank <= 10 ? { emoji: '🟠',      label: 'Difficult', score: -1 }
                          : posRank >= 28 ? { emoji: '🟢🟢',   label: 'Smash Spot', score: 2 }
                          : posRank >= 23 ? { emoji: '🟢',      label: 'Favorable', score: 1 }
                          : { emoji: '⚪', label: 'Neutral', score: 0 };
                        return (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                            <span className="mono" style={{ fontSize: 12, whiteSpace: 'nowrap', fontWeight: 700 }}>
                              {sched?.isAway ? <span style={{ color: 'var(--text-dim)' }}>@</span> : null}
                              <span style={{ color: oppColor }}>{oppTeam}</span>
                            </span>
                            {matchup
                              ? <span title={`${matchup.label} · #${posRank}/32 vs ${posKey}`} style={{ fontSize: 11, cursor: 'default', lineHeight: 1 }}>{matchup.emoji} {matchup.label}</span>
                              : r ? <span style={{ color: oppColor, fontSize: 9, opacity: .85 }} className="mono">#{r}</span> : null}
                          </div>
                        );
                      })()}
                    </td>
                    <td style={{ whiteSpace: 'nowrap', paddingRight: 10 }}>
                      {(() => {
                        const sched = nflSchedule[p.team];
                        if (!sched?.time) return <span className="faint" style={{ fontSize: 10 }}>—</span>;
                        const [day, ...rest] = sched.time.split(' ');
                        return (
                          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, lineHeight: 1.4 }}>
                            <span style={{ color: 'var(--text)', fontWeight: 800, fontSize: 10, letterSpacing: '.04em' }}>{day}</span>
                            <span style={{ color: 'var(--text-dim)', display: 'block' }}>{rest.join(' ')}</span>
                          </div>
                        );
                      })()}
                    </td>
                    {/* WEATHER */}
                    <td style={{ whiteSpace: 'nowrap', minWidth: 80 }}>
                      {(() => {
                        const wx = getGameWeather(p.team);
                        if (!wx) return <span className="faint" style={{ fontSize: 10 }}>—</span>;
                        if (wx.dome) return (
                          <span style={{ fontSize: 9, fontFamily: 'var(--font-mono)', fontWeight: 700, color: '#1affa0', letterSpacing: '.04em' }}>
                            Dome
                          </span>
                        );
                        if (wx.noData) return <span className="faint" style={{ fontSize: 10 }}>—</span>;
                        const h = wx.hour;
                        if (!h) return <span className="faint" style={{ fontSize: 10 }}>—</span>;
                        const windMph  = h.wind_mph || 0;
                        const gustMph  = h.wind_gust_mph || h.gust_mph || h.windgust_mph || 0;
                        const tempF    = h.temp_f   || wx.maxTempF || 0;
                        const precipIn = h.precip_in || 0;
                        const cond     = (h.condition || '').toLowerCase();
                        const isSnow   = cond.includes('snow') || cond.includes('blizzard') || cond.includes('sleet');
                        const isRain   = precipIn > 0.05 || cond.includes('rain') || cond.includes('drizzle') || cond.includes('shower');
                        const windColor = windMph >= 20 ? 'var(--danger)'
                                        : windMph >= 15 ? '#ff8c00'
                                        : windMph >= 10 ? '#ffd700'
                                        : 'var(--text)';
                        const tempColor = tempF >= 90 ? '#ff4f4f'
                                       : tempF >= 75 ? '#ff9800'
                                       : tempF >= 50 ? '#1affa0'
                                       : tempF >= 32 ? '#7ecff5'
                                       : '#ffffff';
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
                            {gustMph >= 20 && <div style={{ color: 'var(--danger)', fontSize: 11, fontWeight: 700 }}>💨 Gusts {gustMph}mph</div>}
                          </div>
                        );
                      })()}
                    </td>
                    {/* TRENDS */}
                    <td className="num" style={{ paddingRight: 6 }}>
                      {(() => { const td = getTrendData(p); return td.length ? <Sparkline data={td} width={70} height={20} /> : <span className="faint">—</span>; })()}
                    </td>
                    {/* FANTASY POINTS */}
                    <td className="num">{(() => {
                      const total = p.pts2025 > 0 ? p.pts2025 : (p.last > 0 ? Math.round(p.last * 17 * 10) / 10 : null);
                      return total != null ? <span style={{ color: 'var(--text)', fontWeight: 600 }}>{Number(total).toFixed(1)}</span> : <span className="faint">—</span>;
                    })()}</td>
                    <td className="num">{p.avg > 0 ? <span>{p.avg.toFixed(1)}</span> : <span className="faint">—</span>}</td>
                    <td className="num" style={{ fontWeight: 600 }}>
                      {(() => {
                        const isOut = ['O', 'IR', 'NFI'].includes(effectiveStatus);
                        if (isOut) return <span style={{ color: 'var(--text-faint)', fontFamily: 'var(--font-mono)', fontSize: 11 }}>—</span>;
                        const liveProj = (liveData[p.id] || []).find(e => e.proj != null);
                        const noStats = p.proj <= 0 && (p.pts2025 || 0) === 0 && (p.avg || 0) === 0;
                        const rookieRow = (noStats && p.rookie) ? rookieScoreMap.get(p.name.toLowerCase().trim()) : null;
                        const rookieProj = rookieRow ? rookieProjFromScore(rookieRow, p.pos) : null;
                        const adpProj = (noStats && !rookieProj) ? estimateProjFromAdp(p) : null;
                        const fallback = rookieProj ?? adpProj ?? 0;
                        const val = liveProj ? liveProj.proj : (p.proj > 0 ? p.proj : fallback);
                        const isEstimate = !liveProj && p.proj <= 0 && fallback > 0;
                        const tip = liveProj ? `Live · ${liveProj.source}`
                          : rookieProj ? `Rookie Score: ${Math.round(rookieRow.rookie_score)}/100`
                          : adpProj ? `Estimated from ADP/ECR (no 2025 stats)`
                          : 'Base projection';
                        return (
                          <span title={tip} style={{ color: 'var(--accent-2)', cursor: 'default' }}>
                            {parseFloat(val.toFixed(1))}
                            {isEstimate && <span style={{ fontSize: 8, fontWeight: 800, color: '#a78bfa', marginLeft: 3 }}>{rookieProj ? 'R' : 'E'}</span>}
                          </span>
                        );
                      })()}
                    </td>
                    <td style={{ maxWidth: 420, verticalAlign: 'top', paddingTop: 8 }}>
                      {(() => {
                        const liveNotes = (liveData[p.id] || []).filter(e => e.note);
                        const r2 = r2InjuryByName[p.name.toLowerCase()];
                        const r2InjSt = r2?.injury_status;
                        const hasR2 = r2 && r2InjSt && r2InjSt !== 'Active';
                        const aiNotes = r2NotesLookup.get(p.name.toLowerCase().trim()) || null;
                        const hasSS = startSitMap.has(p.name.toLowerCase().trim());
                        const hasArts = (playerNewsMap.get(normalizeName(p.name)) || playerNewsMap.get(p.name.toLowerCase().trim()) || []).length > 0;
                        const hasNews = liveNotes.length || hasR2 || p.news || aiNotes || hasSS || hasArts;
                        const arts = (playerNewsMap.get(normalizeName(p.name)) || playerNewsMap.get(p.name.toLowerCase().trim()) || [])
                          .slice().sort((a, b) => {
                            const ta = a.published_at ? new Date(a.published_at).getTime() : 0;
                            const tb = b.published_at ? new Date(b.published_at).getTime() : 0;
                            return tb - ta;
                          });
                        if (!hasNews) return <span className="faint" style={{ fontSize: 11 }}>—</span>;
                        const isExpanded = expandedNews.has(p.id);
                        const toggleNews = e => {
                          e.stopPropagation();
                          setExpandedNews(prev => {
                            const next = new Set(prev);
                            if (next.has(p.id)) next.delete(p.id); else next.add(p.id);
                            return next;
                          });
                        };
                        const ssPreview = (() => {
                          const ssRaw = startSitMap.get(p.name.toLowerCase().trim());
                          if (!ssRaw) return null;
                          const ssOv = liveOverrideRec(ssRaw, effectiveStatus);
                          return ssOv;
                        })();
                        const previewColor = hasR2
                          ? (r2InjSt === 'Out' ? 'var(--danger)' : r2InjSt === 'Questionable' ? '#ff8c00' : r2InjSt === 'Doubtful' ? '#ffb547' : 'var(--accent-2)')
                          : ssPreview ? 'var(--text)' : 'var(--text-dim)';
                        const rawPreview = hasR2
                          ? `${r2InjSt}${r2.injury_notes ? ` · ${r2.injury_notes}` : ''}`
                          : p.news || (liveNotes.length ? liveNotes[0].note : null);
                        const previewText = rawPreview ? (rawPreview.length > 100 ? rawPreview.slice(0, 100) + '…' : rawPreview) : null;
                        return (
                          <div style={{ fontSize: 12, lineHeight: 1.5, whiteSpace: 'normal', display: 'flex', flexDirection: 'column', gap: 4 }} onClick={e => e.stopPropagation()}>
                            {/* ── Toggle row ── */}
                            <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                              <button
                                onClick={toggleNews}
                                style={{ background: 'rgba(255,255,255,.06)', border: '1px solid var(--border)', borderRadius: 4, cursor: 'pointer', padding: '3px 6px', color: 'var(--text-dim)', fontSize: 13, lineHeight: 1, flexShrink: 0, fontWeight: 700 }}
                              >{isExpanded ? '▾' : '▸'}</button>
                              {!isExpanded && (
                                <>
                                  {previewText ? (
                                    <span style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', flexWrap: 'nowrap', overflow: 'hidden' }} onClick={toggleNews}>
                                      <span style={{ fontSize: 11, color: previewColor, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 220 }}>{previewText}</span>
                                      {ssPreview && (() => {
                                        const rec = ssPreview.recommendation;
                                        const recClr = rec === 'MONITOR' ? '#ff9800' : rec?.startsWith('START') ? '#1affa0' : rec?.startsWith('SIT') ? '#ff4f4f' : '#ffb547';
                                        return <span style={{ fontSize: 9, fontFamily: 'var(--font-mono)', fontWeight: 800, color: recClr, flexShrink: 0 }}>{rec}{ssPreview.start_score != null ? ` ${ssPreview.start_score}` : ''}</span>;
                                      })()}
                                    </span>
                                  ) : ssPreview ? (() => {
                                    const rec = ssPreview.recommendation;
                                    const mi = ssPreview.matchup_indicator;
                                    const recClr = rec === 'MONITOR' ? '#ff9800' : rec?.startsWith('START') ? '#1affa0' : rec?.startsWith('SIT') ? '#ff4f4f' : '#ffb547';
                                    const miClr2 = mi === 'SMASH' ? '#1affa0' : mi === 'FAVORABLE' ? '#1affa0' : mi === 'AVOID' ? '#ff4f4f' : mi === 'DIFFICULT' ? '#ff9800' : 'var(--text-dim)';
                                    const mType = ssPreview.matchup_type || (p.pos === 'DST' ? 'Off Matchup' : 'Def Matchup');
                                    return (
                                      <span style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', flexWrap: 'wrap' }} onClick={toggleNews}>
                                        <span style={{ fontSize: 10, fontFamily: 'var(--font-mono)', fontWeight: 800, color: recClr }}>{rec}</span>
                                        {ssPreview.start_score != null && <span style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--text-dim)' }}>Score <strong style={{ color: recClr }}>{ssPreview.start_score}</strong>/100</span>}
                                        {mi && <span style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: miClr2 }}>{mType} {mi}{ssPreview.def_rank && ssPreview.def_rank !== '?' ? ` (#${ssPreview.def_rank}/32)` : ''}</span>}
                                      </span>
                                    );
                                  })() : (
                                    <span style={{ fontSize: 11, color: 'var(--text-faint)', cursor: 'pointer' }} onClick={toggleNews}>—</span>
                                  )}
                                  {arts.length > 0 && (
                                    <span style={{ fontSize: 9, fontFamily: 'var(--font-mono)', fontWeight: 700, color: 'var(--accent-2)', opacity: 0.7, flexShrink: 0 }}>📰 {arts.length}</span>
                                  )}
                                </>
                              )}
                            </div>

                            {/* ── Expanded content ── */}
                            {isExpanded && (
                              <>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
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
                                    return (
                                      <div key={i}>
                                        <span style={{ color: 'var(--text)' }}>{entry.note}</span>
                                        <span style={{ marginLeft: 5, fontFamily: 'var(--font-mono)', fontSize: 9, fontWeight: 700, letterSpacing: '.05em', color: srcColor, opacity: 0.85 }}>
                                          {(entry.source || 'LIVE').toUpperCase()}
                                        </span>
                                        {ts && (
                                          <span style={{ marginLeft: 4, fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--text-faint)' }}>{fmtTs(ts)}</span>
                                        )}
                                      </div>
                                    );
                                  })}
                                </div>
                                {/* ── Start/Sit detail ── */}
                                {(() => {
                                  const ssRaw = startSitMap.get(p.name.toLowerCase().trim());
                                  if (!ssRaw) return null;
                                  const ss = liveOverrideRec(ssRaw, effectiveStatus);
                                  const rec  = ss.recommendation;
                                  const conf = ss.confidence;
                                  const mi   = ss.matchup_indicator;
                                  const clr  = rec === 'MONITOR' ? '#ff9800' : rec?.startsWith('START') ? '#1affa0' : rec?.startsWith('SIT') ? '#ff4f4f' : '#ffb547';
                                  const bg   = rec === 'MONITOR' ? 'rgba(255,152,0,.08)' : rec === 'START' ? 'rgba(26,255,160,.08)' : rec === 'SIT' ? 'rgba(255,79,79,.08)' : 'rgba(255,181,71,.08)';
                                  const bdr  = rec === 'MONITOR' ? 'rgba(255,152,0,.25)' : rec === 'START' ? 'rgba(26,255,160,.25)' : rec === 'SIT' ? 'rgba(255,79,79,.25)' : 'rgba(255,181,71,.25)';
                                  const miClr = mi === 'SMASH' ? '#1affa0' : mi === 'FAVORABLE' ? '#1affa0' : mi === 'AVOID' ? '#ff4f4f' : mi === 'DIFFICULT' ? '#ff9800' : 'var(--text)';
                                  const factors = ss.factors || [];
                                  // Score bar width (0-100 → 0-100%)
                                  const scoreVal = ss.start_score ?? 0;
                                  const scoreBarClr = scoreVal >= 65 ? '#1affa0' : scoreVal <= 35 ? '#ff4f4f' : '#ffb547';
                                  return (
                                    <div style={{ borderTop: '1px solid rgba(255,255,255,.06)', paddingTop: 6, marginTop: 2 }}>
                                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                                        <span style={{ fontSize: 11, fontFamily: 'var(--font-mono)', fontWeight: 900, padding: '2px 8px', borderRadius: 4, color: clr, background: bg, border: `1px solid ${bdr}`, letterSpacing: '.08em' }}>
                                          {rec}
                                        </span>
                                        {ss.depth_label && (
                                          <span style={{ fontSize: 9, fontFamily: 'var(--font-mono)', color: ss.depth_order > 1 ? '#ffb547' : 'var(--text-faint)', fontWeight: ss.depth_order > 1 ? 700 : 400 }}>
                                            {ss.depth_label}
                                          </span>
                                        )}
                                        <span style={{ fontSize: 9, fontFamily: 'var(--font-mono)', color: 'var(--text-faint)' }}>Week {ss.week}</span>
                                      </div>
                                      <div style={{ display: 'grid', gridTemplateColumns: '110px 1fr', gap: '3px 8px', fontSize: 10, fontFamily: 'var(--font-mono)', marginBottom: 6 }}>
                                        {ss.start_score != null && <>
                                          <span style={{ color: 'var(--text-faint)', fontWeight: 700 }}>Start Score:</span>
                                          <span style={{ fontWeight: 900, fontSize: 13, color: scoreBarClr }}>{ss.start_score}<span style={{ color: 'var(--text-faint)', fontSize: 10, fontWeight: 400 }}>/100</span> <span style={{ fontSize: 9, color: clr, fontWeight: 700 }}>{conf}</span></span>
                                        </>}
                                        {mi && <>
                                          <span style={{ color: 'var(--text-faint)', fontWeight: 700 }}>{ss.matchup_type || 'Defense Matchup'}:</span>
                                          <span style={{ fontWeight: 800, color: miClr }}>{mi}{ss.def_rank && ss.def_rank !== '?' ? ` (#${ss.def_rank}/32)` : ''}</span>
                                        </>}
                                        {ss.opponent && <>
                                          <span style={{ color: 'var(--text-faint)', fontWeight: 700 }}>Opponent:</span>
                                          <span style={{ fontWeight: 700, color: 'var(--text)' }}>vs {ss.opponent}</span>
                                        </>}
                                      </div>
                                      {ss.start_score != null && (
                                        <div style={{ height: 3, borderRadius: 2, background: 'rgba(255,255,255,.08)', marginBottom: 5, overflow: 'hidden' }}>
                                          <div style={{ height: '100%', width: `${scoreVal}%`, background: scoreBarClr, borderRadius: 2, transition: 'width .4s' }} />
                                        </div>
                                      )}
                                      {ss.summary && (
                                        <div style={{ fontSize: 11, color: 'var(--text-dim)', lineHeight: 1.5, marginBottom: 5, fontStyle: 'italic' }}>
                                          {ss.summary}
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
                                {(() => {
                                  const writeup = writeupsMap.get(p.name.toLowerCase().trim());
                                  const notesList = aiNotes?.notes?.slice(0, 5) || [];
                                  if (!writeup?.writeup && !notesList.length) return null;
                                  const borderTop = (liveNotes.length || hasR2 || p.news) ? '1px solid rgba(255,255,255,.06)' : 'none';
                                  return <RosterWriteupBlock writeup={writeup} aiNotes={aiNotes} notesList={notesList} borderTop={borderTop} />;
                                })()}
                                {/* ── Articles dropdown ── */}
                                {arts.length > 0 && (() => {
                                  const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
                                  const recent = arts.filter(a => !a.published_at || new Date(a.published_at).getTime() >= cutoff);
                                  if (!recent.length) return null;
                                  function artAge(ts) {
                                    if (!ts) return '';
                                    const d = Date.now() - new Date(ts).getTime();
                                    if (d < 3600000) return `${Math.round(d / 60000)}m`;
                                    if (d < 86400000) return `${Math.round(d / 3600000)}h`;
                                    return `${Math.round(d / 86400000)}d`;
                                  }
                                  return (
                                    <div style={{ borderTop: '1px solid rgba(255,255,255,.06)', paddingTop: 5, marginTop: 3 }}>
                                      <select
                                        value=""
                                        onClick={e => e.stopPropagation()}
                                        onChange={e => { e.stopPropagation(); const url = e.target.value; if (url) window.open(url, '_blank', 'noopener,noreferrer'); e.target.value = ''; }}
                                        style={{ fontSize: 10, fontFamily: 'var(--font-mono)', fontWeight: 700, padding: '2px 6px', borderRadius: 4, border: '1px solid rgba(78,168,255,.35)', background: 'rgba(78,168,255,.12)', color: 'var(--accent-2)', cursor: 'pointer', maxWidth: 300, width: '100%' }}
                                      >
                                        <option value="">📰 {recent.length} article{recent.length !== 1 ? 's' : ''} this week</option>
                                        {recent.map((a, i) => {
                                          const age = artAge(a.published_at);
                                          const label = (a.headline || a.publisher || '').slice(0, 80);
                                          return <option key={i} value={a.article_url}>{age ? `[${age}] ` : ''}{label}</option>;
                                        })}
                                      </select>
                                    </div>
                                  );
                                })()}
                              </>
                            )}
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
                        style={{ textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 5, padding: '4px 8px', borderRadius: 5, background: 'rgba(26,255,160,.08)', border: '1px solid rgba(26,255,160,.35)', color: '#1affa0', fontSize: 10, fontWeight: 700, fontFamily: 'var(--font-mono)', letterSpacing: '.04em', whiteSpace: 'nowrap' }}
                      >
                        <svg width="13" height="10" viewBox="0 0 18 13" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ flexShrink: 0 }}>
                          <path d="M17.6 2.03C17.4 1.29 16.83.72 16.09.52 14.67.14 9 .14 9 .14S3.33.14 1.91.52C1.17.72.6 1.29.4 2.03 0 3.47 0 6.5 0 6.5s0 3.03.4 4.47c.2.74.77 1.31 1.51 1.51C3.33 12.86 9 12.86 9 12.86s5.67 0 7.09-.38c.74-.2 1.31-.77 1.51-1.51C18 9.53 18 6.5 18 6.5s0-3.03-.4-4.47z" fill="#1affa0"/>
                          <path d="M7.2 9.29l4.73-2.79L7.2 3.71v5.58z" fill="black"/>
                        </svg>
                        Highlights
                      </a>
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
                        <button
                          className={`btn sm ghost${compareIds.includes(p.id) ? ' active' : ''}`}
                          title={compareIds.length === 0 ? 'Compare — click two players' : compareIds.length === 1 ? 'Click to compare with selected player' : 'Compare'}
                          style={{ fontSize: 10, fontWeight: 700, color: compareIds.includes(p.id) ? '#4ea8ff' : undefined, borderColor: compareIds.includes(p.id) ? '#4ea8ff' : undefined }}
                          onClick={e => { e.stopPropagation(); setCompareIds(prev => prev.includes(p.id) ? prev.filter(x => x !== p.id) : prev.length >= 2 ? [p.id] : [...prev, p.id]); }}
                        >VS</button>
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
                      <td colSpan={13} style={{ padding: 0 }}>
                        <div style={{ padding: '12px 16px', borderBottom: '1px solid rgba(78,168,255,.18)' }}>

                          {/* ── Add/Drop confirmation ── */}
                          {addDropPending && addDropPending.dropPlayerId === p.id ? (
                            <div>
                              <div style={{ fontSize: 10, fontFamily: 'var(--font-mono)', fontWeight: 800, color: '#4ea8ff', letterSpacing: '.08em', textTransform: 'uppercase', marginBottom: 12 }}>
                                Confirm Add / Drop
                              </div>
                              <div style={{ display: 'flex', gap: 16, alignItems: 'stretch', marginBottom: 14, flexWrap: 'wrap' }}>
                                {/* ADD card */}
                                <div style={{ flex: 1, minWidth: 160, padding: '10px 14px', background: 'rgba(26,255,160,.15)', border: '1px solid rgba(26,255,160,.50)', borderRadius: 8 }}>
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
                                      <span style={{ fontSize: 11, fontWeight: 700, color: '#1affa0', fontFamily: 'var(--font-mono)', flexShrink: 0 }}>↻ Swap</span>
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
          {/* ── Lineup Optimizer ── */}
          <LineupDecisions
            compact
            myRosterIds={myRosterIds}
            slotOverrides={slotOverrides}
            onSlotOverridesChange={onSlotOverridesChange}
            onOpenPlayer={onOpenPlayer}
          />
        </div>
      )}

      {/* Waiver Wire tab */}
      {tab === 'waivers' && (
        <WaiverRecommendations
          myRosterIds={myRosterIds}
          starters={starters}
          fullRoster={fullRoster}
          onOpenPlayer={onOpenPlayer}
          onAddPlayer={onAddPlayer}
          nflSchedule={nflSchedule}
          startSitMap={startSitMap}
          defVsPosIndex={defVsPosIndex}
        />
      )}

      {/* Bye Week Planner tab */}
      {tab === 'byeweek' && (
        <ByeWeekPlanner rosterPlayers={rosterPlayers} starters={starters} fullRoster={fullRoster} />
      )}

      {/* Strength of Schedule tab */}
      {tab === 'sos' && (
        <StrengthOfSchedule rosterPlayers={rosterPlayers} fullSchedule={fullSchedule} defVsPosIndex={defVsPosIndex} starters={starters} />
      )}

      {/* All Rosters tab */}
      {tab === 'allrosters' && (
        <AllRostersView
          myTeamId={teamId}
          slotFrame={slotFrame}
          onOpenPlayer={onOpenPlayer}
          nflSchedule={nflSchedule}
          startSitMap={startSitMap}
          defRankByTeam={defRankByTeam}
          defVsPosIndex={defVsPosIndex}
          weatherTeams={weatherTeams}
        />
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

      {compareIds.length === 2 && (
        <PlayerComparePopup
          playerA={findPlayer(compareIds[0])}
          playerB={findPlayer(compareIds[1])}
          onClose={() => setCompareIds([])}
          nflSchedule={nflSchedule}
          startSitMap={startSitMap}
          defVsPosIndex={defVsPosIndex}
        />
      )}

      <RosterLegend />
      <PageLogicPanel />

    </div>
  );
}

function PageLogicPanel() {
  const [open, setOpen] = React.useState(false);
  const [activeTab, setActiveTab] = React.useState('sources');
  const grid = { display: 'grid', gridTemplateColumns: '120px 1fr', gap: '3px 12px' };
  const k = { fontFamily: 'var(--font-mono)', fontWeight: 700, fontSize: 10, color: 'var(--text-dim)' };
  const v = { fontSize: 11, color: 'var(--text-dim)', lineHeight: 1.5 };

  const tabs = [
    { id: 'sources',   label: 'Data Sources' },
    { id: 'proj',      label: 'Projection' },
    { id: 'scoring',   label: 'Scoring' },
    { id: 'startsit',  label: 'Start/Sit' },
    { id: 'optimal',   label: 'Optimal' },
    { id: 'news',      label: 'News' },
    { id: 'dst',       label: 'Defense' },
    { id: 'rosters',   label: 'All Rosters' },
    { id: 'swap',      label: 'Swap' },
  ];

  const content = {
    sources: (
      <div style={grid}>
        <span style={k}>Player Pool</span><span style={v}>R2: <code>export_players_2026_draft.json</code> — built daily by Databricks ETL from Sleeper API. ~1000 active NFL players (QB/RB/WR/TE/K/DST). Retired players filtered by: must have 2025 stats, depth chart presence, or &lt;3 years experience.</span>
        <span style={k}>Schedule</span><span style={v}>Fetched live from ESPN Scoreboard API on page load. Shows correct week automatically. No local storage — always fresh.</span>
        <span style={k}>Injury Data</span><span style={v}>R2: <code>injury_report.json</code> — from Sleeper API via daily orchestrator. Supplemented by live Sleeper player map fetch on page load. Live status synced back to player store.</span>
        <span style={k}>Weather</span><span style={v}>R2: <code>weather_forecast.json</code> — World Weather Online API. Dome teams auto-detected (ATL, ARI, CHI, DAL, DET, HOU, IND, LAC, LAR, LV, MIN, NO). Manual refresh button available.</span>
        <span style={k}>Start/Sit</span><span style={v}>R2: <code>weekly_startsit.json</code> — generated by Job 4 (Qwen3 14B). Top 200 daily, all players monthly.</span>
        <span style={k}>AI Writeups</span><span style={v}>R2: <code>player_writeups.json</code> — Job 3 (Qwen3 14B). Rostered players nightly, all players weekly.</span>
        <span style={k}>Watchlist</span><span style={v}>DuckDB: <code>watchlist</code> table. CLI: <code>python watchlist.py add/remove/list</code>. Tier 0 Google News priority.</span>
      </div>
    ),
    proj: (
      <div style={grid}>
        <span style={k}>Priority Chain</span><span style={v}>1. Live ESPN actual (green) → 2. Sleeper weekly proj → 3. 2025 season PPG → 4. Rookie Score (purple R) → 5. ADP/ECR estimate (purple E)</span>
        <span style={k}>Blue Number</span><span style={v}>Standard projection — Sleeper consensus or 2025 season average.</span>
        <span style={k}>Green Number</span><span style={v}>Actual live points from ESPN. Only during 2026 games.</span>
        <span style={k}>Purple R</span><span style={v}>Rookie estimate (<code>years_exp = 0</code> only). Formula: <code>base + (ceiling - base) × (score / 100)</code>. Ceilings: QB 22, RB 16, WR 14, TE 10.</span>
        <span style={k}>Purple E</span><span style={v}>ADP/ECR estimate for non-rookies with zero 2025 stats. Formula: <code>base - rank × slope</code>, clamped to floor.</span>
        <span style={k}>Out / IR</span><span style={v}>Shows "—" — no projection for inactive players.</span>
      </div>
    ),
    scoring: (
      <div style={grid}>
        <span style={k}>Pre-Season</span><span style={v}><strong>Simulated</strong> game stats (fake yardage, TDs) using deterministic seed per player/week. UI preview only — not real data. "0%" = no points accumulated yet.</span>
        <span style={k}>During Season</span><span style={v}><strong>Real</strong> ESPN play-by-play scoring. Updates live (e.g. "62% Live — PROJ 38%" at halftime).</span>
        <span style={k}>Scoring Rules</span><span style={v}>Half-PPR default. Pass: 0.04/yd, Rush/Rec: 0.1/yd, Pass TD: 4, Rush/Rec TD: 6, INT: -1, Fumble: -1. Yard bonuses in League Settings.</span>
      </div>
    ),
    startsit: (
      <div style={grid}>
        <span style={k}>Formula</span><span style={v}>Proj 30% + Matchup 20% + Opportunity 20% + Injury/Weather 15% + Trend 10% + Team Env 5%. × depth chart multiplier (QB3 = 0, RB2 = 0.4, WR3 = 0.25).</span>
        <span style={k}>START</span><span style={v}>Score ≥ 65, favorable/neutral matchup. Green.</span>
        <span style={k}>SIT</span><span style={v}>Score ≤ 35. Red.</span>
        <span style={k}>FLEX</span><span style={v}>Score 36-64, borderline. Sent to Qwen 14B. Yellow.</span>
        <span style={k}>MONITOR</span><span style={v}>Player is Questionable. Orange. Score computed but deferred to game-time.</span>
        <span style={k}>START - LOWER EXP</span><span style={v}>RB/WR/TE proj ≥ 15 vs tough defense. Elite players you still start. Green.</span>
        <span style={k}>Questionable</span><span style={v}>Loses 10/15 injury pts. Always MONITOR.</span>
        <span style={k}>Doubtful</span><span style={v}>Loses all 15 injury pts. Auto-SIT MEDIUM.</span>
      </div>
    ),
    optimal: (
      <div style={grid}>
        <span style={k}>Algorithm</span><span style={v}>Greedy fill: dedicated slots first (QB, RB, WR, TE, K, DST), then FLEX from remaining RB/WR. Ranks by availability (Active &gt; Q &gt; D &gt; Out) then projection.</span>
        <span style={k}>Out Players</span><span style={v}>Out/IR/PUP/Suspended/bye = 0 pts in optimizer. Always benched when healthy alternative exists. Live status from Sleeper overrides stale player store.</span>
        <span style={k}>Gain Display</span><span style={v}>Shows point delta vs current lineup. "Optimal ✓" = no improvement possible.</span>
      </div>
    ),
    news: (
      <div style={grid}>
        <span style={k}>Tier 1</span><span style={v}>Google News RSS — top 200 ADP + watchlist players. Daily. <code>bronze_google_news</code>.</span>
        <span style={k}>Tier 2</span><span style={v}>ESPN Team News API — all 32 teams, 20 articles each. Player-matched by name. <code>bronze_team_rss_news</code>.</span>
        <span style={k}>Tier 3</span><span style={v}>ESPN Player News API — direct player-linked articles. <code>bronze_player_news_espn_api</code>.</span>
        <span style={k}>Collapsed View</span><span style={v}>Top note preview + article count badge (📰 3). Click ▸ to expand.</span>
        <span style={k}>Expanded View</span><span style={v}>Injury notes, beat writer reports, AI writeups, Start/Sit with score bar, article dropdown. Sources: DATABRICKS, BEAT WRITER, FantasAI.</span>
        <span style={k}>Articles</span><span style={v}>Blue dropdown, last 7 days. Click opens in new tab. Merged from all 3 tiers + enriched news.</span>
      </div>
    ),
    dst: (
      <div style={grid}>
        <span style={k}>ECR/ADP</span><span style={v}>Positional rank (1-32) → overall: <code>120 + (rank - 1) × 4</code>. Range ~120-244.</span>
        <span style={k}>Projection</span><span style={v}><code>max(4, 15 - rank × 0.6)</code>. DST1 ≈ 14.4, DST16 ≈ 5.4, DST32 = 4.0.</span>
        <span style={k}>Start/Sit</span><span style={v}>Deterministic only (score ≥ 50 = START). Never FLEX. Never sent to LLM.</span>
      </div>
    ),
    rosters: (
      <div style={grid}>
        <span style={k}>Data Source</span><span style={v}>TEAM_ROSTERS from localStorage (synced via roster save API). Auto-assigns players to slots.</span>
        <span style={k}>Sort Order</span><span style={v}>Teams sorted by total starter projection (highest first).</span>
        <span style={k}>Columns</span><span style={v}>Same as My Roster: Slot, Player, Status, Bye, Opp, Trend, 2025 Pts, PPG, Proj, Start/Sit.</span>
      </div>
    ),
    swap: (
      <div style={grid}>
        <span style={k}>Position Filter</span><span style={v}>Free agents filtered to dropped player's position (drop WR → show WR only).</span>
        <span style={k}>Sort</span><span style={v}>By projection descending. Top 20 shown.</span>
        <span style={k}>Bench Swaps</span><span style={v}>Bench players shown if eligible for target slot (FLEX accepts RB/WR/TE).</span>
      </div>
    ),
  };

  return (
    <div style={{ margin: '0 0 8px', border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden' }}>
      <button
        onClick={() => setOpen(o => !o)}
        style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 16px', background: 'var(--panel)', border: 'none', cursor: 'pointer', color: 'var(--text-dim)', fontSize: 12, fontWeight: 700 }}
      >
        <span>Page Logic</span>
        <span style={{ fontSize: 14, color: 'var(--text-faint)' }}>{open ? '▾' : '▸'}</span>
      </button>
      {open && (
        <div style={{ background: 'var(--panel-1)' }}>
          <div style={{ display: 'flex', gap: 0, overflowX: 'auto', borderBottom: '1px solid var(--border)', padding: '0 8px' }}>
            {tabs.map(t => (
              <button
                key={t.id}
                onClick={() => setActiveTab(t.id)}
                style={{
                  padding: '8px 14px', fontSize: 10, fontWeight: activeTab === t.id ? 800 : 500,
                  cursor: 'pointer', border: 'none', borderBottom: activeTab === t.id ? '2px solid var(--accent-2)' : '2px solid transparent',
                  background: 'transparent', color: activeTab === t.id ? 'var(--accent-2)' : 'var(--text-faint)',
                  whiteSpace: 'nowrap', transition: 'all .12s',
                }}
              >{t.label}</button>
            ))}
          </div>
          <div style={{ padding: '14px 18px 18px', fontSize: 11, lineHeight: 1.6, color: 'var(--text-dim)' }}>
            {content[activeTab]}
          </div>
        </div>
      )}
    </div>
  );
}

function PlayerComparePopup({ playerA, playerB, onClose, nflSchedule, startSitMap, defVsPosIndex }) {
  const [aiResult, setAiResult] = React.useState(null);
  const [aiLoading, setAiLoading] = React.useState(false);

  if (!playerA || !playerB) return null;

  const schedA = nflSchedule[playerA.team] || {};
  const schedB = nflSchedule[playerB.team] || {};
  const oppA = schedA.opp ? (schedA.isAway ? `@${schedA.opp}` : schedA.opp) : (playerA.opp || '—');
  const oppB = schedB.opp ? (schedB.isAway ? `@${schedB.opp}` : schedB.opp) : (playerB.opp || '—');
  const ssA = startSitMap.get(playerA.name.toLowerCase().trim());
  const ssB = startSitMap.get(playerB.name.toLowerCase().trim());
  const delta = (playerA.proj || 0) - (playerB.proj || 0);

  const rows = [
    { label: 'Proj', a: playerA.proj?.toFixed(1) || '—', b: playerB.proj?.toFixed(1) || '—', better: (playerA.proj || 0) >= (playerB.proj || 0) ? 'a' : 'b' },
    { label: 'Avg', a: playerA.avg?.toFixed(1) || '—', b: playerB.avg?.toFixed(1) || '—', better: (playerA.avg || 0) >= (playerB.avg || 0) ? 'a' : 'b' },
    { label: 'ECR', a: playerA.ecr < 999 ? `#${playerA.ecr}` : '—', b: playerB.ecr < 999 ? `#${playerB.ecr}` : '—', better: (playerA.ecr || 999) <= (playerB.ecr || 999) ? 'a' : 'b' },
    { label: 'OPP', a: oppA, b: oppB },
    { label: 'Score', a: ssA?.start_score ?? '—', b: ssB?.start_score ?? '—', better: (ssA?.start_score || 0) >= (ssB?.start_score || 0) ? 'a' : 'b' },
    { label: 'Status', a: playerA.status || 'OK', b: playerB.status || 'OK' },
  ];

  async function askAI() {
    setAiLoading(true);
    try {
      const fmt = p => `${p.name} (${p.pos}, ${p.team}) — Proj: ${p.proj?.toFixed(1)}, Avg: ${p.avg?.toFixed(1)}, ECR: #${p.ecr}`;
      const question = `Should I start ${fmt(playerA)} or ${fmt(playerB)} this week? Consider matchup, projection, recent form, and upside. Give a direct answer in 2-3 sentences.`;
      const res = await fetch('https://api.fantasai.net/api/v1/chat', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question, tier: 'simple' }),
        signal: AbortSignal.timeout(30000),
      });
      if (res.ok) { const data = await res.json(); setAiResult(data.answer); }
    } catch {} finally { setAiLoading(false); }
  }

  return (
    <div className="drawer-overlay" onClick={onClose}>
      <div style={{ position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%,-50%)', background: 'var(--panel)', border: '1px solid var(--border-strong)', borderRadius: 14, padding: 24, width: 480, maxWidth: 'calc(100vw - 32px)', zIndex: 300 }} onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <div style={{ fontWeight: 900, fontSize: 15 }}>Start/Sit Comparison</div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--text-faint)', cursor: 'pointer', fontSize: 18 }}>✕</button>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 60px 1fr', gap: 0, marginBottom: 16 }}>
          <div style={{ textAlign: 'center', padding: '10px 8px', background: delta >= 0 ? 'rgba(26,255,160,.08)' : 'transparent', borderRadius: 8 }}>
            <PosBadge pos={playerA.pos} />
            <div style={{ fontWeight: 800, fontSize: 14, marginTop: 4 }}>{playerA.name}</div>
            <div style={{ fontSize: 11, color: 'var(--text-faint)' }}>{playerA.team}</div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 900, fontSize: 12, color: 'var(--text-faint)' }}>VS</div>
          <div style={{ textAlign: 'center', padding: '10px 8px', background: delta < 0 ? 'rgba(26,255,160,.08)' : 'transparent', borderRadius: 8 }}>
            <PosBadge pos={playerB.pos} />
            <div style={{ fontWeight: 800, fontSize: 14, marginTop: 4 }}>{playerB.name}</div>
            <div style={{ fontSize: 11, color: 'var(--text-faint)' }}>{playerB.team}</div>
          </div>
        </div>

        {rows.map(r => (
          <div key={r.label} style={{ display: 'grid', gridTemplateColumns: '1fr 60px 1fr', gap: 0, padding: '5px 0', borderBottom: '1px solid var(--border)' }}>
            <div style={{ textAlign: 'center', fontFamily: 'var(--font-mono)', fontSize: 13, fontWeight: 700, color: r.better === 'a' ? '#1affa0' : 'var(--text-dim)' }}>{r.a}</div>
            <div style={{ textAlign: 'center', fontSize: 10, color: 'var(--text-faint)', fontWeight: 700 }}>{r.label}</div>
            <div style={{ textAlign: 'center', fontFamily: 'var(--font-mono)', fontSize: 13, fontWeight: 700, color: r.better === 'b' ? '#1affa0' : 'var(--text-dim)' }}>{r.b}</div>
          </div>
        ))}

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 60px 1fr', gap: 0, padding: '8px 0', marginTop: 4 }}>
          <div style={{ textAlign: 'center', fontFamily: 'var(--font-display)', fontWeight: 900, fontSize: 20, color: delta >= 0 ? '#1affa0' : 'var(--text-dim)' }}>
            {delta >= 0 ? `+${delta.toFixed(1)}` : delta.toFixed(1)}
          </div>
          <div style={{ textAlign: 'center', fontSize: 9, color: 'var(--text-faint)', fontWeight: 700, alignSelf: 'center' }}>DELTA</div>
          <div style={{ textAlign: 'center', fontFamily: 'var(--font-display)', fontWeight: 900, fontSize: 20, color: delta < 0 ? '#1affa0' : 'var(--text-dim)' }}>
            {delta < 0 ? `+${Math.abs(delta).toFixed(1)}` : (-delta).toFixed(1)}
          </div>
        </div>

        <button
          className="btn"
          style={{ width: '100%', marginTop: 12, background: 'rgba(198,255,58,.12)', border: '1px solid rgba(198,255,58,.3)', color: '#c6ff3a', fontWeight: 700, fontSize: 12, padding: '10px', borderRadius: 8 }}
          disabled={aiLoading}
          onClick={askAI}
        >
          {aiLoading ? '⟳ Analyzing…' : aiResult ? '↻ Re-analyze' : '🤖 Ask FantasAI: Who should I start?'}
        </button>

        {aiResult && (
          <div style={{ marginTop: 10, fontSize: 12, color: 'var(--text)', lineHeight: 1.7, whiteSpace: 'pre-wrap', background: 'var(--panel-1)', borderRadius: 6, padding: '10px 12px', border: '1px solid rgba(198,255,58,.2)' }}>
            {aiResult}
          </div>
        )}
      </div>
    </div>
  );
}

function LineupLockCountdown({ nflSchedule, rosterPlayers }) {
  const [now, setNow] = React.useState(Date.now());
  React.useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 60000);
    return () => clearInterval(t);
  }, []);

  const seasonStart = H2H_SEASON_START.getTime();
  if (now < seasonStart) return null;

  const gameTimesSet = new Set();
  for (const p of rosterPlayers) {
    const sched = nflSchedule[p.team];
    if (sched?.time) gameTimesSet.add(sched.time);
  }
  if (gameTimesSet.size === 0) return null;

  const earliestLock = Math.min(...[...gameTimesSet].map(t => {
    const match = t.match(/(\w+)\s+(\d+):(\d+)\s*(AM|PM)/i);
    if (!match) return Infinity;
    let h = parseInt(match[2]);
    const m = parseInt(match[3]);
    const ampm = match[4].toUpperCase();
    if (ampm === 'PM' && h !== 12) h += 12;
    if (ampm === 'AM' && h === 12) h = 0;
    const today = new Date();
    const dayMap = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
    const targetDay = dayMap[match[1]] ?? today.getDay();
    const diff = (targetDay - today.getDay() + 7) % 7;
    const lockDate = new Date(today);
    lockDate.setDate(today.getDate() + (diff === 0 && today.getHours() > h ? 7 : diff));
    lockDate.setHours(h, m, 0, 0);
    return lockDate.getTime();
  }));

  if (!isFinite(earliestLock)) return null;
  const msLeft = earliestLock - now;
  if (msLeft <= 0) return null;

  const hours = Math.floor(msLeft / 3600000);
  const mins = Math.floor((msLeft % 3600000) / 60000);
  const urgent = hours < 1;
  const warning = hours < 4;
  const color = urgent ? '#ff4f4f' : warning ? '#ff9800' : '#1affa0';

  const questionable = rosterPlayers.filter(p => p.status === 'Q' || p.status === 'Questionable');

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: `${color}12`, border: `1px solid ${color}44`, borderRadius: 6, padding: '4px 10px' }}>
      <span style={{ fontSize: 11, fontFamily: 'var(--font-mono)', fontWeight: 800, color }}>
        🔒 Lock in {hours}h {mins}m
      </span>
      {questionable.length > 0 && (
        <span style={{ fontSize: 9, color: '#ff9800', fontWeight: 700 }}>
          ⚠ {questionable.length} Q starter{questionable.length > 1 ? 's' : ''}
        </span>
      )}
    </div>
  );
}

function StrengthOfSchedule({ rosterPlayers, fullSchedule, defVsPosIndex, starters }) {
  const weeks = Array.from({ length: 18 }, (_, i) => i + 1);
  const starterIds = new Set(starters.map(e => e.playerId).filter(Boolean));
  const players = rosterPlayers.filter(p => p.pos !== 'K' && starterIds.has(p.id));

  function getMatchupGrade(team, pos, week) {
    const sched = fullSchedule[week];
    if (!sched) return null;
    const entry = sched[team];
    if (!entry) return null;
    const opp = entry.opp?.replace(/^@/, '').toUpperCase();
    if (!opp) return null;
    let rank;
    if (pos === 'DST') {
      const offRanks = ['QB','RB','WR'].map(op => defVsPosIndex.get(`${opp}|${op}`)).filter(v => v != null);
      if (!offRanks.length) return null;
      rank = Math.round(33 - offRanks.reduce((s,v) => s+v, 0) / offRanks.length);
    } else {
      if (!pos) return null;
      rank = defVsPosIndex.get(`${opp}|${pos}`);
    }
    if (rank == null) return null;
    if (rank >= 28) return { label: 'SMASH', color: '#1affa0', score: 2 };
    if (rank >= 23) return { label: 'FAV', color: '#4ea8ff', score: 1 };
    if (rank <= 5)  return { label: 'AVOID', color: '#ff4f4f', score: -2 };
    if (rank <= 10) return { label: 'DIFF', color: '#ff9800', score: -1 };
    return { label: '', color: 'var(--text-faint)', score: 0 };
  }

  const hasScheduleData = Object.keys(fullSchedule).length > 0;

  const playerSOS = players.map(p => {
    const grades = weeks.map(w => p.bye === w ? 'BYE' : (getMatchupGrade(p.team, p.pos, w) || null));
    const rosTotal = grades.filter(g => g && g !== 'BYE').reduce((s, g) => s + g.score, 0);
    const playoffGrades = [15, 16, 17].map(w => p.bye === w ? 'BYE' : (getMatchupGrade(p.team, p.pos, w) || null));
    const playoffTotal = playoffGrades.filter(g => g && g !== 'BYE').reduce((s, g) => s + g.score, 0);
    return { player: p, grades, rosTotal, playoffGrades, playoffTotal };
  }).sort((a, b) => b.rosTotal - a.rosTotal);

  const teamRosAvg = playerSOS.length > 0 ? playerSOS.reduce((s, p) => s + p.rosTotal, 0) / playerSOS.length : 0;
  const teamPlayoffAvg = playerSOS.length > 0 ? playerSOS.reduce((s, p) => s + p.playoffTotal, 0) / playerSOS.length : 0;

  return (
    <div style={{ flex: 1, overflow: 'auto', padding: '12px 18px' }}>
      {/* Team summary */}
      <div style={{ display: 'flex', gap: 16, marginBottom: 14 }}>
        <div style={{ background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 8, padding: '10px 14px', flex: 1 }}>
          <div style={{ fontSize: 9, fontFamily: 'var(--font-mono)', color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '.08em', marginBottom: 4 }}>ROS Schedule Strength</div>
          <div style={{ fontFamily: 'var(--font-display)', fontWeight: 900, fontSize: 24, color: teamRosAvg > 0 ? '#1affa0' : teamRosAvg < 0 ? '#ff4f4f' : '#4ea8ff' }}>
            {teamRosAvg > 0 ? '+' : ''}{teamRosAvg.toFixed(1)}
          </div>
          <div style={{ fontSize: 10, color: 'var(--text-dim)' }}>{teamRosAvg > 2 ? 'Easy schedule ahead' : teamRosAvg < -2 ? 'Tough schedule ahead' : 'Average schedule'}</div>
        </div>
        <div style={{ background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 8, padding: '10px 14px', flex: 1 }}>
          <div style={{ fontSize: 9, fontFamily: 'var(--font-mono)', color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '.08em', marginBottom: 4 }}>Playoff Schedule (Wk 15-17)</div>
          <div style={{ fontFamily: 'var(--font-display)', fontWeight: 900, fontSize: 24, color: teamPlayoffAvg > 0 ? '#1affa0' : teamPlayoffAvg < 0 ? '#ff4f4f' : '#4ea8ff' }}>
            {teamPlayoffAvg > 0 ? '+' : ''}{teamPlayoffAvg.toFixed(1)}
          </div>
          <div style={{ fontSize: 10, color: 'var(--text-dim)' }}>{teamPlayoffAvg > 1 ? 'Favorable playoff matchups' : teamPlayoffAvg < -1 ? 'Tough playoff matchups' : 'Average playoff matchups'}</div>
        </div>
      </div>

      {/* Heatmap */}
      <div style={{ overflowX: 'auto' }}>
        <table className="data-table" style={{ fontSize: 11, minWidth: 900 }}>
          <thead>
            <tr>
              <th style={{ position: 'sticky', left: 0, background: 'var(--bg-2)', zIndex: 3, minWidth: 140 }}>Player</th>
              <th className="num" style={{ fontSize: 9, color: 'var(--text-faint)' }}>ROS</th>
              {weeks.map(w => (
                <th key={w} className="num" style={{
                  padding: '4px 5px', fontSize: 10, minWidth: 34, textAlign: 'center',
                  color: w >= 15 && w <= 17 ? 'var(--accent)' : 'var(--text-faint)',
                  fontWeight: w >= 15 && w <= 17 ? 800 : 400,
                  background: w >= 15 && w <= 17 ? 'rgba(198,255,58,.06)' : 'transparent',
                }}>{w}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {playerSOS.map(({ player: p, grades, rosTotal }) => (
              <tr key={p.id}>
                <td style={{ position: 'sticky', left: 0, background: 'var(--bg-2)', zIndex: 2, whiteSpace: 'nowrap' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                    <PosBadge pos={p.pos} />
                    <span style={{ fontWeight: 600 }}>{p.name}</span>
                  </div>
                </td>
                <td className="num" style={{ fontFamily: 'var(--font-mono)', fontWeight: 800, fontSize: 11, color: rosTotal > 0 ? '#1affa0' : rosTotal < 0 ? '#ff4f4f' : 'var(--text-dim)' }}>
                  {rosTotal > 0 ? '+' : ''}{rosTotal}
                </td>
                {grades.map((g, w) => {
                  const isBye = g === 'BYE';
                  const hasGrade = g && g !== 'BYE';
                  return (
                    <td key={w} style={{
                      textAlign: 'center', padding: '3px 4px', fontSize: 9, fontWeight: 700,
                      color: isBye ? '#ff4f4f' : hasGrade ? g.color : 'var(--text-faint)',
                      background: isBye ? 'rgba(255,60,60,.08)' : hasGrade ? (g.score >= 2 ? 'rgba(26,255,160,.12)' : g.score >= 1 ? 'rgba(78,168,255,.08)' : g.score <= -2 ? 'rgba(255,60,60,.12)' : g.score <= -1 ? 'rgba(255,152,0,.08)' : 'transparent') : 'transparent',
                      ...(w + 1 >= 15 && w + 1 <= 17 ? { borderLeft: w + 1 === 15 ? '2px solid rgba(198,255,58,.3)' : undefined, borderRight: w + 1 === 17 ? '2px solid rgba(198,255,58,.3)' : undefined } : {}),
                    }}>
                      {isBye ? 'BYE' : hasGrade ? (g.label || '—') : '—'}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ByeWeekPlanner({ rosterPlayers, starters, fullRoster }) {
  const weeks = Array.from({ length: 18 }, (_, i) => i + 1);
  const starterIds = new Set(starters.map(e => e.playerId).filter(Boolean));

  const weekData = React.useMemo(() => {
    return weeks.map(w => {
      const onBye = rosterPlayers.filter(p => p.bye === w);
      const startersOnBye = onBye.filter(p => starterIds.has(p.id));
      const baseProj = starters.reduce((s, e) => s + (findPlayer(e.playerId)?.proj || 0), 0);
      const lostProj = startersOnBye.reduce((s, p) => s + (p.proj || 0), 0);
      const adjProj = baseProj - lostProj;
      return { week: w, onBye, startersOnBye, lostProj, adjProj, baseProj };
    });
  }, [rosterPlayers, starters]);

  const worstWeek = weekData.reduce((worst, d) => d.startersOnBye.length > worst.startersOnBye.length ? d : worst, weekData[0]);
  const alerts = weekData.filter(d => d.startersOnBye.length >= 2);

  return (
    <div style={{ flex: 1, overflow: 'auto', padding: '12px 18px' }}>
      {/* Alerts */}
      {alerts.length > 0 && (
        <div style={{ background: 'rgba(255,152,0,.08)', border: '1px solid rgba(255,152,0,.3)', borderRadius: 8, padding: '10px 14px', marginBottom: 14 }}>
          <div style={{ fontWeight: 700, fontSize: 12, marginBottom: 6 }}>⚠ Bye Week Alerts</div>
          {alerts.map(d => (
            <div key={d.week} style={{ fontSize: 11, color: 'var(--text-dim)', marginBottom: 3 }}>
              <strong style={{ color: '#ff9800' }}>Week {d.week}:</strong> {d.startersOnBye.length} starters out ({d.startersOnBye.map(p => p.name).join(', ')}) — proj drops to <strong style={{ color: '#4ea8ff' }}>{d.adjProj.toFixed(1)}</strong> ({d.lostProj.toFixed(1)} pts lost)
              {d.week === worstWeek.week && <span style={{ fontSize: 9, fontWeight: 800, color: '#ff4f4f', marginLeft: 6 }}>WORST WEEK</span>}
            </div>
          ))}
        </div>
      )}

      {/* Calendar heatmap */}
      <div style={{ overflowX: 'auto' }}>
        <table className="data-table" style={{ fontSize: 11, minWidth: 900 }}>
          <thead>
            <tr>
              <th style={{ position: 'sticky', left: 0, background: 'var(--bg-2)', zIndex: 3, minWidth: 120 }}>Player</th>
              {weeks.map(w => (
                <th key={w} className="num" style={{ padding: '4px 6px', fontSize: 10, minWidth: 36, textAlign: 'center',
                  color: weekData[w-1].startersOnBye.length >= 2 ? '#ff4f4f' : 'var(--text-faint)',
                  fontWeight: weekData[w-1].startersOnBye.length >= 2 ? 800 : 400,
                }}>
                  {w}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rosterPlayers.filter(p => p.pos !== 'DST').map(p => {
              const isStarter = starterIds.has(p.id);
              return (
                <tr key={p.id} style={{ opacity: isStarter ? 1 : 0.5 }}>
                  <td style={{ position: 'sticky', left: 0, background: 'var(--bg-2)', zIndex: 2, whiteSpace: 'nowrap' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                      <PosBadge pos={p.pos} />
                      <span style={{ fontWeight: isStarter ? 700 : 400 }}>{p.name}</span>
                    </div>
                  </td>
                  {weeks.map(w => {
                    const isBye = p.bye === w;
                    return (
                      <td key={w} style={{
                        textAlign: 'center', padding: '3px 4px', fontSize: 10,
                        background: isBye
                          ? (isStarter ? 'rgba(255,60,60,.2)' : 'rgba(255,60,60,.08)')
                          : 'transparent',
                        color: isBye ? '#ff4f4f' : '#1affa0',
                        fontWeight: isBye ? 800 : 400,
                      }}>
                        {isBye ? 'BYE' : '✓'}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
            {/* Totals row */}
            <tr style={{ borderTop: '2px solid var(--border-strong)' }}>
              <td style={{ position: 'sticky', left: 0, background: 'var(--bg-2)', zIndex: 2, fontWeight: 800, fontSize: 10, color: 'var(--text-faint)' }}>STARTERS OUT</td>
              {weeks.map(w => {
                const d = weekData[w-1];
                const cnt = d.startersOnBye.length;
                return (
                  <td key={w} style={{
                    textAlign: 'center', padding: '3px 4px', fontFamily: 'var(--font-mono)', fontWeight: 800, fontSize: 11,
                    color: cnt >= 3 ? '#ff4f4f' : cnt >= 2 ? '#ff9800' : cnt >= 1 ? '#ffb547' : '#1affa0',
                    background: cnt >= 2 ? 'rgba(255,60,60,.08)' : 'transparent',
                  }}>
                    {cnt}
                  </td>
                );
              })}
            </tr>
            {/* Projected total row */}
            <tr>
              <td style={{ position: 'sticky', left: 0, background: 'var(--bg-2)', zIndex: 2, fontWeight: 800, fontSize: 10, color: 'var(--text-faint)' }}>PROJ TOTAL</td>
              {weeks.map(w => {
                const d = weekData[w-1];
                const pct = d.baseProj > 0 ? d.adjProj / d.baseProj : 1;
                return (
                  <td key={w} style={{
                    textAlign: 'center', padding: '3px 4px', fontFamily: 'var(--font-mono)', fontSize: 10, fontWeight: 700,
                    color: pct < 0.8 ? '#ff4f4f' : pct < 0.9 ? '#ff9800' : '#4ea8ff',
                  }}>
                    {d.adjProj.toFixed(0)}
                  </td>
                );
              })}
            </tr>
          </tbody>
        </table>
      </div>

      {/* Playoff focus */}
      <div style={{ marginTop: 16, background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 8, padding: '12px 14px' }}>
        <div style={{ fontWeight: 800, fontSize: 11, color: 'var(--accent)', marginBottom: 8 }}>Playoff Weeks (15-17)</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
          {[15, 16, 17].map(w => {
            const d = weekData[w-1];
            return (
              <div key={w} style={{ background: 'var(--panel-1)', borderRadius: 6, padding: '8px 10px', border: '1px solid var(--border)' }}>
                <div style={{ fontSize: 10, color: 'var(--text-faint)', fontFamily: 'var(--font-mono)', marginBottom: 4 }}>Week {w}</div>
                <div style={{ fontFamily: 'var(--font-display)', fontWeight: 900, fontSize: 20, color: d.startersOnBye.length > 0 ? '#ff9800' : '#1affa0' }}>
                  {d.adjProj.toFixed(1)}
                </div>
                {d.startersOnBye.length > 0 ? (
                  <div style={{ fontSize: 10, color: '#ff9800', marginTop: 3 }}>
                    {d.startersOnBye.map(p => p.name).join(', ')} on bye
                  </div>
                ) : (
                  <div style={{ fontSize: 10, color: '#1affa0', marginTop: 3 }}>Full squad available</div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function WaiverRecommendations({ myRosterIds, starters, fullRoster, onOpenPlayer, onAddPlayer, nflSchedule, startSitMap, defVsPosIndex }) {
  const allPlayers = usePlayers();
  const [waiverPos, setWaiverPos] = React.useState('ALL');
  const [aiLoading, setAiLoading] = React.useState(false);
  const [aiResult, setAiResult] = React.useState(null);

  const rosterPlayers = React.useMemo(
    () => [...myRosterIds].map(id => findPlayer(id)).filter(Boolean),
    [myRosterIds, allPlayers],
  );
  const posCounts = React.useMemo(() => {
    const m = {};
    for (const p of rosterPlayers) m[p.pos] = (m[p.pos] || 0) + 1;
    return m;
  }, [rosterPlayers]);
  const weakPositions = React.useMemo(() => {
    const ideal = { QB: 2, RB: 4, WR: 4, TE: 2, K: 1, DST: 1 };
    return Object.entries(ideal)
      .filter(([pos, min]) => (posCounts[pos] || 0) < min)
      .map(([pos]) => pos);
  }, [posCounts]);

  const freeAgents = React.useMemo(() => {
    const rostered = new Set([...myRosterIds]);
    return allPlayers
      .filter(p => !rostered.has(p.id) && p.pos !== 'DST' && p.pos !== 'K')
      .filter(p => waiverPos === 'ALL' || p.pos === waiverPos)
      .sort((a, b) => (b.proj || 0) - (a.proj || 0))
      .slice(0, 30);
  }, [allPlayers, myRosterIds, waiverPos]);

  const needBadge = weakPositions.length > 0;

  async function askAI() {
    setAiLoading(true);
    setAiResult(null);
    try {
      const rosterSummary = rosterPlayers.map(p => `${p.name} (${p.pos}, ${p.team}) proj ${p.proj?.toFixed(1)}`).join(', ');
      const topFA = freeAgents.slice(0, 10).map(p => `${p.name} (${p.pos}, ${p.team}) proj ${p.proj?.toFixed(1)}, ECR #${p.ecr}`).join('\n');
      const question = `My fantasy roster: ${rosterSummary}

Weak positions: ${weakPositions.length ? weakPositions.join(', ') : 'None'}
Position counts: ${Object.entries(posCounts).map(([k,v]) => `${k}:${v}`).join(', ')}

Top available free agents:
${topFA}

Give me your top 3 waiver wire pickups this week. For each, explain why they help my team specifically — consider my roster needs, matchup, and upside. Be direct, 2-3 sentences per player.`;

      const res = await fetch('https://api.fantasai.net/api/v1/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question, tier: 'medium' }),
        signal: AbortSignal.timeout(35000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setAiResult(data.answer || 'No response.');
    } catch (e) {
      setAiResult(`Error: ${e.message}`);
    } finally {
      setAiLoading(false);
    }
  }

  return (
    <div style={{ flex: 1, overflow: 'auto', padding: '12px 18px' }}>
      {/* Roster needs banner */}
      {needBadge && (
        <div style={{ background: 'rgba(255,152,0,.08)', border: '1px solid rgba(255,152,0,.3)', borderRadius: 8, padding: '10px 14px', marginBottom: 12, display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 16 }}>⚠</span>
          <div>
            <div style={{ fontWeight: 700, fontSize: 12 }}>Roster Needs Detected</div>
            <div style={{ fontSize: 11, color: 'var(--text-dim)' }}>
              You're thin at: {weakPositions.map(pos => (
                <span key={pos} style={{ fontFamily: 'var(--font-mono)', fontWeight: 800, color: '#ff9800', marginRight: 6 }}>{pos} ({posCounts[pos] || 0})</span>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Position filter + AI button */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
        {['ALL', 'QB', 'RB', 'WR', 'TE'].map(p => (
          <button
            key={p}
            onClick={() => setWaiverPos(p)}
            style={{
              padding: '5px 12px', borderRadius: 6, fontSize: 11, fontWeight: waiverPos === p ? 700 : 500,
              cursor: 'pointer', border: 'none',
              background: waiverPos === p ? 'var(--accent)' : 'var(--panel)',
              color: waiverPos === p ? 'var(--accent-ink)' : (weakPositions.includes(p) ? '#ff9800' : 'var(--text-dim)'),
            }}
          >{p}{weakPositions.includes(p) ? ' !' : ''}</button>
        ))}
        <div style={{ flex: 1 }} />
        <button
          className="btn"
          style={{ background: 'rgba(198,255,58,.12)', border: '1px solid rgba(198,255,58,.3)', color: '#c6ff3a', fontWeight: 700, fontSize: 11, padding: '6px 14px' }}
          disabled={aiLoading}
          onClick={askAI}
        >
          {aiLoading ? '⟳ Analyzing…' : '🤖 Ask FantasAI'}
        </button>
      </div>

      {/* AI result */}
      {aiResult && (
        <div style={{ background: 'var(--panel)', border: '1px solid rgba(198,255,58,.25)', borderRadius: 8, padding: '12px 14px', marginBottom: 14 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
            <span style={{ fontSize: 9, fontFamily: 'var(--font-mono)', fontWeight: 700, background: 'rgba(198,255,58,.15)', color: '#c6ff3a', padding: '1px 5px', borderRadius: 3 }}>AI</span>
            <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-dim)' }}>Waiver Recommendations</span>
          </div>
          <div style={{ fontSize: 12, color: 'var(--text)', lineHeight: 1.7, whiteSpace: 'pre-wrap' }}>{aiResult}</div>
        </div>
      )}

      {/* Free agent table */}
      <table className="data-table" style={{ fontSize: 12 }}>
        <thead>
          <tr>
            <th style={{ width: 30 }}>#</th>
            <th>Player</th>
            <th>OPP</th>
            <th className="num">Proj</th>
            <th className="num">ECR</th>
            <th className="num">Avg</th>
            <th>Start/Sit</th>
            <th style={{ width: 50 }}></th>
          </tr>
        </thead>
        <tbody>
          {freeAgents.map((p, i) => {
            const sched = nflSchedule[p.team] || {};
            const oppDisplay = sched.opp ? (sched.isAway ? `@${sched.opp}` : sched.opp) : (p.opp || '');
            const rawOpp = (sched.opp || p.opp || '').replace(/^@/, '').toUpperCase();
            const posRank = p.pos !== 'DST' && rawOpp ? defVsPosIndex.get(`${rawOpp}|${p.pos}`) ?? null : null;
            const matchup = posRank == null ? null
              : posRank <= 5 ? { label: 'AVOID', color: '#ff4f4f' }
              : posRank <= 10 ? { label: 'DIFFICULT', color: '#ff9800' }
              : posRank >= 28 ? { label: 'SMASH', color: '#1affa0' }
              : posRank >= 23 ? { label: 'FAVORABLE', color: '#1affa0' }
              : null;
            const ss = liveOverrideRec(startSitMap.get(p.name.toLowerCase().trim()), p.status);
            const rec = ss?.recommendation;
            const ssClr = rec === 'MONITOR' ? '#ff9800' : rec?.startsWith('START') ? '#1affa0' : rec?.startsWith('SIT') ? '#ff4f4f' : '#ffb547';
            const isNeed = weakPositions.includes(p.pos);
            return (
              <tr key={p.id} style={isNeed ? { background: 'rgba(255,152,0,.06)', borderLeft: '2px solid rgba(255,152,0,.4)' } : undefined}>
                <td className="rank">{i + 1}</td>
                <td onClick={() => onOpenPlayer?.(p.id)} style={{ cursor: 'pointer' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <PosBadge pos={p.pos} />
                    <span style={{ fontWeight: 600 }}>{p.name}</span>
                    <span style={{ fontSize: 10, color: 'var(--text-faint)' }}>{p.team}</span>
                    {isNeed && <span style={{ fontSize: 8, fontWeight: 800, color: '#ff9800', background: 'rgba(255,152,0,.15)', borderRadius: 3, padding: '1px 4px' }}>NEED</span>}
                  </div>
                </td>
                <td>
                  {oppDisplay ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                      <span className="mono" style={{ fontSize: 11, fontWeight: 700, color: matchup ? matchup.color : 'var(--text-dim)' }}>{oppDisplay}</span>
                      {matchup && <span style={{ fontSize: 8, fontWeight: 800, color: matchup.color }}>{matchup.label}</span>}
                    </div>
                  ) : <span className="faint">—</span>}
                </td>
                <td className="num" style={{ color: '#4ea8ff', fontWeight: 600 }}>{p.proj > 0 ? p.proj.toFixed(1) : '—'}</td>
                <td className="num" style={{ color: 'var(--text-dim)' }}>{p.ecr < 999 ? p.ecr : '—'}</td>
                <td className="num">{p.avg > 0 ? p.avg.toFixed(1) : '—'}</td>
                <td>
                  {ss ? (
                    <span style={{ fontSize: 9, fontFamily: 'var(--font-mono)', fontWeight: 800, padding: '1px 6px', borderRadius: 3, color: ssClr, background: `${ssClr}18`, border: `1px solid ${ssClr}55`, letterSpacing: '.06em', whiteSpace: 'nowrap' }}>
                      {rec}{ss.start_score != null ? ` ${ss.start_score}` : ''}
                    </span>
                  ) : <span className="faint" style={{ fontSize: 10 }}>—</span>}
                </td>
                <td>
                  <button className="btn sm primary" style={{ fontSize: 10, padding: '3px 8px' }} onClick={() => onAddPlayer?.(p.id)}>+ Add</button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function AllRostersView({ myTeamId, slotFrame, onOpenPlayer, nflSchedule, startSitMap, defRankByTeam, defVsPosIndex, weatherTeams }) {
  const [expandedTeam, setExpandedTeam] = React.useState(null);
  const allPlayers = usePlayers();
  const DOME_TEAMS = new Set(['ATL','ARI','CHI','DAL','DET','HOU','IND','LAC','LAR','LV','MIN','NO']);

  const teamRosters = React.useMemo(() => {
    return LEAGUE_TEAMS.map(t => {
      const rawEntries = TEAM_ROSTERS[t.id] || [];
      const rawIds = rawEntries.map(e => typeof e === 'object' ? e.playerId : e).filter(Boolean);
      const roster = rawIds.length > 0
        ? assignRoster(slotFrame, new Set(rawIds), {}, findPlayer)
        : [];
      const starters = roster.filter(r => r.slot !== 'BENCH' && r.playerId);
      const bench = roster.filter(r => r.slot === 'BENCH' && r.playerId);
      const totalProj = starters.reduce((s, r) => s + (findPlayer(r.playerId)?.proj || 0), 0);
      return { team: t, roster, starters, bench, totalProj, playerCount: rawIds.length };
    }).sort((a, b) => b.totalProj - a.totalProj);
  }, [slotFrame, allPlayers]);

  function renderPlayerRow(entry, i, isBench) {
    const p = entry.playerId ? findPlayer(entry.playerId) : null;
    if (!p) return (
      <tr key={`${isBench ? 'b' : 's'}${i}`} style={{ opacity: isBench ? 0.6 : 1 }}>
        <td><span style={{ fontSize: 10, fontFamily: 'var(--font-mono)', fontWeight: 700, color: 'var(--text-faint)' }}>{isBench ? 'BN' : entry.slot}</span></td>
        <td colSpan={8}><span className="faint">Empty</span></td>
      </tr>
    );
    const sched = nflSchedule[p.team] || {};
    const oppTeam = sched.opp || p.opp || '';
    const oppDisplay = sched.opp ? (sched.isAway ? `@${sched.opp}` : sched.opp) : (p.opp || '');
    const rawOpp = oppTeam.replace(/^@/, '').toUpperCase();
    const posKey = p.pos === 'DST' ? null : p.pos;
    const posRank = posKey && rawOpp ? defVsPosIndex.get(`${rawOpp}|${posKey}`) ?? null : null;
    const matchup = posRank == null ? null
      : posRank <= 5  ? { label: 'AVOID', color: '#ff4f4f' }
      : posRank <= 10 ? { label: 'DIFFICULT', color: '#ff9800' }
      : posRank >= 28 ? { label: 'SMASH', color: '#1affa0' }
      : posRank >= 23 ? { label: 'FAVORABLE', color: '#1affa0' }
      : null;
    const statusLabel = p.status === 'Q' ? 'Questionable' : p.status === 'D' ? 'Doubtful' : p.status === 'Out' || p.status === 'O' ? 'Out' : p.status === 'IR' ? 'IR' : '';
    const statusColor = (p.status === 'Q' || p.status === 'D') ? '#ff9800' : (p.status === 'O' || p.status === 'Out' || p.status === 'IR') ? '#ff4f4f' : '';
    const ss = liveOverrideRec(startSitMap.get(p.name.toLowerCase().trim()), p.status);
    const rec = ss?.recommendation;
    const ssClr = rec === 'MONITOR' ? '#ff9800' : rec?.startsWith('START') ? '#1affa0' : rec?.startsWith('SIT') ? '#ff4f4f' : '#ffb547';
    const td = getTrendData(p);
    const total2025 = p.pts2025 > 0 ? p.pts2025 : (p.last > 0 ? Math.round(p.last * 17 * 10) / 10 : null);

    return (
      <tr key={`${isBench ? 'b' : 's'}${i}`} style={{ opacity: isBench ? 0.6 : 1 }}>
        <td><span style={{ fontSize: 10, fontFamily: 'var(--font-mono)', fontWeight: 700, color: 'var(--text-faint)' }}>{isBench ? 'BN' : entry.slot}</span></td>
        <td onClick={() => onOpenPlayer?.(p.id)} style={{ cursor: 'pointer' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <PosBadge pos={p.pos} />
            <span style={{ fontWeight: 600 }}>{p.name}</span>
            <span style={{ fontSize: 10, color: 'var(--text-faint)' }}>{p.team}</span>
          </div>
        </td>
        <td>
          {statusLabel
            ? <span style={{ fontSize: 10, fontFamily: 'var(--font-mono)', fontWeight: 700, color: statusColor }}>{statusLabel}</span>
            : <span style={{ fontSize: 10, fontFamily: 'var(--font-mono)', fontWeight: 700, color: '#1affa0' }}>Active</span>}
        </td>
        <td className="num" style={{ fontSize: 11, color: 'var(--text-faint)' }}>{p.bye || '—'}</td>
        <td>
          {oppDisplay ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
              <span className="mono" style={{ fontSize: 11, fontWeight: 700, color: matchup ? matchup.color : 'var(--text-dim)' }}>{oppDisplay}</span>
              {matchup && <span style={{ fontSize: 8, fontWeight: 800, letterSpacing: '.06em', color: matchup.color }}>{matchup.label}</span>}
            </div>
          ) : <span className="faint">—</span>}
        </td>
        <td className="num" style={{ paddingRight: 6 }}>
          {td.length ? <Sparkline data={td} width={60} height={18} /> : <span className="faint">—</span>}
        </td>
        <td className="num">{total2025 != null ? <span style={{ fontWeight: 600 }}>{Number(total2025).toFixed(1)}</span> : <span className="faint">—</span>}</td>
        <td className="num">{p.last > 0 ? p.last.toFixed(1) : <span className="faint">—</span>}</td>
        <td className="num" style={{ color: '#4ea8ff', fontWeight: 600 }}>{p.proj > 0 ? p.proj.toFixed(1) : <span className="faint">—</span>}</td>
        <td>
          {ss ? (
            <span style={{ fontSize: 9, fontFamily: 'var(--font-mono)', fontWeight: 800, padding: '1px 6px', borderRadius: 3, color: ssClr, background: `${ssClr}18`, border: `1px solid ${ssClr}55`, letterSpacing: '.06em', whiteSpace: 'nowrap' }}>
              {rec}{ss.start_score != null ? ` ${ss.start_score}` : ''}
            </span>
          ) : <span className="faint" style={{ fontSize: 10 }}>—</span>}
        </td>
      </tr>
    );
  }

  return (
    <div style={{ flex: 1, overflow: 'auto', padding: '0 4px' }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '12px 0' }}>
        {teamRosters.map(({ team, starters, bench, totalProj, playerCount }) => {
          const isMe = team.id === myTeamId;
          const isExpanded = expandedTeam === team.id;
          return (
            <div key={team.id} style={{
              border: `1px solid ${isMe ? 'rgba(198,255,58,.35)' : 'var(--border)'}`,
              borderRadius: 10, overflow: 'hidden',
              background: isMe ? 'rgba(198,255,58,.04)' : 'var(--panel)',
            }}>
              <div
                onClick={() => setExpandedTeam(isExpanded ? null : team.id)}
                style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', cursor: 'pointer' }}
              >
                {team.logoImg ? (
                  <img src={team.logoImg} alt="" style={{ width: 40, height: 40, borderRadius: 10, objectFit: 'cover', flexShrink: 0 }} />
                ) : (
                  <span style={{
                    width: 40, height: 40, borderRadius: 10, background: team.color || '#555',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 16, fontWeight: 900, flexShrink: 0,
                  }}>{team.logo || '??'}</span>
                )}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ fontWeight: 800, fontSize: 14 }}>{team.name}</span>
                    {isMe && <span style={{ fontSize: 8, fontFamily: 'var(--font-mono)', color: '#fff', background: '#4caf82', borderRadius: 3, padding: '1px 5px', fontWeight: 800 }}>YOU</span>}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text-faint)', marginTop: 2 }}>
                    {team.owner || '—'} · {playerCount} players · {starters.length} starters
                  </div>
                </div>
                <div style={{ textAlign: 'right', flexShrink: 0 }}>
                  <div style={{ fontFamily: 'var(--font-display)', fontWeight: 900, fontStretch: '75%', fontSize: 24, color: '#4ea8ff', lineHeight: 1 }}>
                    {totalProj.toFixed(1)}
                  </div>
                  <div style={{ fontSize: 9, fontFamily: 'var(--font-mono)', color: 'var(--text-faint)', marginTop: 2 }}>PROJ</div>
                </div>
                <span style={{ fontSize: 14, color: 'var(--text-faint)', flexShrink: 0 }}>{isExpanded ? '▾' : '▸'}</span>
              </div>

              {isExpanded && (
                <div style={{ borderTop: '1px solid var(--border)', overflow: 'auto' }}>
                  <table className="data-table" style={{ fontSize: 12 }}>
                    <thead>
                      <tr>
                        <th style={{ width: 40 }}>Slot</th>
                        <th>Player</th>
                        <th>Status</th>
                        <th className="num">Bye</th>
                        <th>Opp</th>
                        <th className="num">Trend</th>
                        <th className="num">2025 Pts</th>
                        <th className="num">PPG</th>
                        <th className="num">Proj</th>
                        <th>Start/Sit</th>
                      </tr>
                    </thead>
                    <tbody>
                      {starters.map((entry, i) => renderPlayerRow(entry, i, false))}
                      {bench.length > 0 && (
                        <>
                          <tr><td colSpan={10} style={{ padding: '6px 12px', fontSize: 9, fontFamily: 'var(--font-mono)', color: 'var(--text-faint)', letterSpacing: '.08em', background: 'rgba(255,255,255,.02)' }}>BENCH</td></tr>
                          {bench.map((entry, i) => renderPlayerRow(entry, i, true))}
                        </>
                      )}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function RosterLegend() {
  const [open, setOpen] = React.useState(false);
  return (
    <div style={{ margin: '24px 0 8px', border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden' }}>
      <button
        onClick={() => setOpen(o => !o)}
        style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 16px', background: 'var(--panel)', border: 'none', cursor: 'pointer', color: 'var(--text-dim)', fontSize: 12, fontWeight: 700 }}
      >
        <span>Legend &amp; Glossary</span>
        <span style={{ fontSize: 14, color: 'var(--text-faint)' }}>{open ? '▾' : '▸'}</span>
      </button>
      {open && (
        <div style={{ padding: '14px 18px 18px', background: 'var(--panel-1)', display: 'flex', flexDirection: 'column', gap: 16, fontSize: 11, lineHeight: 1.6, color: 'var(--text-dim)' }}>

          <div>
            <div style={{ fontWeight: 800, fontSize: 10, letterSpacing: '.08em', color: 'var(--text-faint)', textTransform: 'uppercase', marginBottom: 6 }}>Roster Slots</div>
            <div style={{ display: 'grid', gridTemplateColumns: '70px 1fr', gap: '2px 12px' }}>
              <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 700 }}>QB</span><span>Quarterback</span>
              <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 700 }}>RB</span><span>Running Back</span>
              <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 700 }}>WR</span><span>Wide Receiver</span>
              <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 700 }}>TE</span><span>Tight End</span>
              <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 700 }}>FLEX</span><span>RB, WR, or TE — best remaining option</span>
              <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 700 }}>K</span><span>Kicker</span>
              <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 700 }}>DST</span><span>Team Defense / Special Teams</span>
              <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 700 }}>BENCH</span><span>Reserve — not scoring this week</span>
            </div>
          </div>

          <div>
            <div style={{ fontWeight: 800, fontSize: 10, letterSpacing: '.08em', color: 'var(--text-faint)', textTransform: 'uppercase', marginBottom: 6 }}>Injury Status</div>
            <div style={{ display: 'grid', gridTemplateColumns: '70px 1fr', gap: '2px 12px' }}>
              <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, color: '#1affa0' }}>Active</span><span>Healthy, expected to play</span>
              <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, color: '#ff8c00' }}>Q</span><span>Questionable — may or may not play, monitor practice reports</span>
              <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, color: '#ffb547' }}>D</span><span>Doubtful — unlikely to play, have a backup plan</span>
              <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, color: '#ff4f4f' }}>O</span><span>Out — confirmed not playing this week</span>
              <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, color: '#ff4f4f' }}>IR</span><span>Injured Reserve — out long-term (minimum 4 games)</span>
            </div>
          </div>

          <div>
            <div style={{ fontWeight: 800, fontSize: 10, letterSpacing: '.08em', color: 'var(--text-faint)', textTransform: 'uppercase', marginBottom: 6 }}>Start/Sit Recommendation</div>
            <div style={{ display: 'grid', gridTemplateColumns: '70px 1fr', gap: '2px 12px' }}>
              <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, color: '#1affa0' }}>START</span><span>Play this player in your lineup</span>
              <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, color: '#ffb547' }}>FLEX</span><span>Borderline — start only if no better option</span>
              <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, color: '#ff4f4f' }}>SIT</span><span>Bench this player, find an alternative</span>
            </div>
            <div style={{ marginTop: 6, display: 'grid', gridTemplateColumns: '70px 1fr', gap: '2px 12px' }}>
              <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 700 }}>HIGH</span><span>High confidence in the recommendation</span>
              <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 700 }}>MEDIUM</span><span>Moderate confidence — could go either way</span>
              <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 700 }}>LOW</span><span>Low confidence — monitor closely before game time</span>
            </div>
          </div>

          <div>
            <div style={{ fontWeight: 800, fontSize: 10, letterSpacing: '.08em', color: 'var(--text-faint)', textTransform: 'uppercase', marginBottom: 6 }}>Matchup Indicator</div>
            <div style={{ display: 'grid', gridTemplateColumns: '70px 1fr', gap: '2px 12px' }}>
              <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, color: '#1affa0' }}>GREEN</span><span>Favorable — opponent defense ranked 23-32 vs this position</span>
              <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, color: '#ffb547' }}>YELLOW</span><span>Neutral — opponent defense ranked 10-22</span>
              <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, color: '#ff4f4f' }}>RED</span><span>Tough — opponent defense ranked 1-9 vs this position</span>
            </div>
          </div>

          <div>
            <div style={{ fontWeight: 800, fontSize: 10, letterSpacing: '.08em', color: 'var(--text-faint)', textTransform: 'uppercase', marginBottom: 6 }}>Matchup Grades (OPP Column)</div>
            <div style={{ display: 'grid', gridTemplateColumns: '90px 1fr', gap: '2px 12px' }}>
              <span style={{ fontWeight: 700, color: '#1affa0' }}>SMASH</span><span>Elite matchup — defense ranked 28-32 vs position (bottom 5)</span>
              <span style={{ fontWeight: 700, color: '#4ea8ff' }}>FAVORABLE</span><span>Good matchup — defense ranked 23-27</span>
              <span style={{ fontWeight: 700, color: '#ff9800' }}>DIFFICULT</span><span>Hard matchup — defense ranked 6-10</span>
              <span style={{ fontWeight: 700, color: '#ff4f4f' }}>AVOID</span><span>Elite defense — ranked 1-5 vs this position</span>
            </div>
          </div>

          <div>
            <div style={{ fontWeight: 800, fontSize: 10, letterSpacing: '.08em', color: 'var(--text-faint)', textTransform: 'uppercase', marginBottom: 6 }}>Start Score (0-100)</div>
            <div style={{ display: 'grid', gridTemplateColumns: '70px 1fr', gap: '2px 12px' }}>
              <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 700 }}>65-100</span><span>Confident start territory</span>
              <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 700 }}>36-64</span><span>Borderline / FLEX range</span>
              <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 700 }}>0-35</span><span>Sit territory</span>
            </div>
            <div style={{ marginTop: 6, color: 'var(--text-faint)', fontSize: 10 }}>
              Weighted: Projection 30% · Matchup 20% · Opportunity 20% · Injury/Weather 15% · Trend 10% · Team Env 5%
            </div>
          </div>

          <div>
            <div style={{ fontWeight: 800, fontSize: 10, letterSpacing: '.08em', color: 'var(--text-faint)', textTransform: 'uppercase', marginBottom: 6 }}>Columns</div>
            <div style={{ display: 'grid', gridTemplateColumns: '70px 1fr', gap: '2px 12px' }}>
              <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 700 }}>OPP</span><span>This week's opponent — "@" prefix means away game</span>
              <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 700 }}>Pts 2025</span><span>Total fantasy points scored in the 2025 season</span>
              <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 700 }}>Last</span><span>Fantasy points in most recent game</span>
              <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 700 }}>Proj</span><span>Projected fantasy points this week (half-PPR)</span>
              <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 700 }}>Trend</span><span>6-week scoring sparkline — rising or falling production</span>
            </div>
          </div>

          <div>
            <div style={{ fontWeight: 800, fontSize: 10, letterSpacing: '.08em', color: 'var(--text-faint)', textTransform: 'uppercase', marginBottom: 6 }}>News Sources</div>
            <div style={{ display: 'grid', gridTemplateColumns: '90px 1fr', gap: '2px 12px' }}>
              <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, color: '#c6ff3a' }}>FantasAI</span><span>AI-generated player writeups and analysis (Qwen 14B)</span>
              <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, color: '#4ea8ff' }}>DATABRICKS</span><span>Injury reports and depth chart data from Sleeper API</span>
              <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 700 }}>BEAT WRITER</span><span>Team reporter notes and beat coverage</span>
              <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 700 }}>📰 Articles</span><span>Linked news from ESPN, Google News, and other sources</span>
            </div>
          </div>

          <div>
            <div style={{ fontWeight: 800, fontSize: 10, letterSpacing: '.08em', color: 'var(--text-faint)', textTransform: 'uppercase', marginBottom: 6 }}>Projection (Proj Column)</div>
            <div style={{ display: 'grid', gridTemplateColumns: '90px 1fr', gap: '2px 12px' }}>
              <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, color: '#4ea8ff' }}>12.4</span><span>Blue — standard projection from 2025 season stats or Sleeper consensus</span>
              <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, color: '#1affa0' }}>18.2</span><span>Green — actual/live points (ESPN game data during the season)</span>
              <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 700 }}>10.4 <span style={{ fontSize: 8, fontWeight: 800, color: '#a78bfa' }}>R</span></span><span>Purple <strong>R</strong> badge — rookie estimate derived from Rookie Score (0-100). Formula: positional floor + (ceiling - floor) x (score / 100). Ceilings: QB 22, RB 16, WR 14, TE 10</span>
              <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 700 }}>8.6 <span style={{ fontSize: 8, fontWeight: 800, color: '#a78bfa' }}>E</span></span><span>Purple <strong>E</strong> badge — estimated from ADP/ECR rank for players with no 2025 stats (e.g. injured all season). Formula: positional base - rank x slope, clamped to a floor</span>
            </div>
            <div style={{ marginTop: 6, fontSize: 10, color: 'var(--text-faint)' }}>
              Priority chain: Live ESPN actual → Sleeper projection → 2025 season avg → Rookie Score estimate → ADP/ECR estimate
            </div>
          </div>

          <div>
            <div style={{ fontWeight: 800, fontSize: 10, letterSpacing: '.08em', color: 'var(--text-faint)', textTransform: 'uppercase', marginBottom: 6 }}>Weather Impact</div>
            <div style={{ display: 'grid', gridTemplateColumns: '90px 1fr', gap: '2px 12px' }}>
              <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, color: '#1affa0' }}>Dome</span><span>Indoor stadium — no weather impact</span>
              <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, color: 'var(--text)' }}>72°F</span><span>Temperature — color-coded: blue (&lt;32°F), teal (32-50°F), green (50-75°F), orange (75-90°F), red (90°F+)</span>
              <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, color: '#ffd700' }}>15mph</span><span>Wind speed — yellow (10-15), orange (15-20), red (20-25), major alert (25+). Impacts QBs/WRs most</span>
              <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, color: 'var(--danger)' }}>💨 Gusts</span><span>Wind gusts 20+ mph — significant impact on passing game and kickers</span>
              <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, color: '#ffd700' }}>🌧 Rain</span><span>Precipitation detected — slight impact on ball handling, affects passing volume</span>
              <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, color: '#7ecff5' }}>❄ Snow</span><span>Snow/blizzard conditions — major impact, favors rushing game</span>
            </div>
            <div style={{ marginTop: 6, fontSize: 10, color: 'var(--text-faint)' }}>
              Weather data from World Weather Online. Home team's stadium determines conditions. Start Score deducts up to 15 points for severe weather (wind 25+ mph, heavy precip).
            </div>
          </div>

          <div>
            <div style={{ fontWeight: 800, fontSize: 10, letterSpacing: '.08em', color: 'var(--text-faint)', textTransform: 'uppercase', marginBottom: 6 }}>Depth Chart Labels</div>
            <div style={{ display: 'grid', gridTemplateColumns: '90px 1fr', gap: '2px 12px' }}>
              <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 700 }}>QB1 / RB1</span><span>Starter — full workload expected</span>
              <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 700 }}>RB2 / WR3</span><span>Backup — reduced role, boom/bust potential</span>
              <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, color: '#ffb547' }}>starter Q</span><span>Starter above is Questionable — upside if they sit</span>
              <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, color: '#ff4f4f' }}>starter OUT</span><span>Starter is out — this backup gets a major role boost</span>
            </div>
          </div>

          <div style={{ fontSize: 10, color: 'var(--text-faint)', borderTop: '1px solid var(--border)', paddingTop: 8 }}>
            Start/Sit scores powered by FantasAI (Qwen 14B). Updated daily during the season.
            Projections blend 2025 season averages, Sleeper consensus, and matchup context. Schedule from ESPN.
          </div>
        </div>
      )}
    </div>
  );
}

// ─── LiveRosterNews ────────────────────────────────────────────────────────────

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
    return { icon: '🏈', label: 'Fantasy', color: 'var(--good)', bg: 'rgba(26,255,160,.15)' };
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
                const timeLabel = n.mins < 60 ? `${n.mins}m ago` : n.mins < 1440 ? `${Math.floor(n.mins / 60)}h ago` : `${Math.floor(n.mins / 1440)}d ago`;
                const notesForDisplay = n.allNotes?.length ? n.allNotes : (n.title ? [{ note_text: n.title, impact_direction: 'neutral' }] : []);
                return (
                  <div key={n.id} onClick={() => onOpenPlayer?.(p.id)} style={{ padding: '12px 14px', borderRadius: 8, background: 'var(--panel-2)', border: '1px solid var(--border)', cursor: 'pointer', borderLeft: `3px solid ${impactColor}` }}>
                    {/* Header */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                      <span style={{ fontWeight: 700, fontSize: 13 }}>{p.name}</span>
                      <PosBadge pos={p.pos} />
                      {n.impact !== 'low' && <span style={{ fontSize: 9, fontFamily: 'var(--font-mono)', fontWeight: 700, color: impactColor, background: `${impactColor}18`, border: `1px solid ${impactColor}40`, borderRadius: 3, padding: '1px 5px', textTransform: 'uppercase' }}>{n.impact}</span>}
                      {n.hasInjury && n.injuryStatus && n.injuryStatus !== 'none' && (
                        <span style={{ fontSize: 9, fontFamily: 'var(--font-mono)', fontWeight: 700, color: 'var(--danger)', background: 'rgba(255,80,80,.1)', border: '1px solid rgba(255,80,80,.3)', borderRadius: 3, padding: '1px 5px', textTransform: 'uppercase' }}>{n.injuryStatus}</span>
                      )}
                      <span style={{ marginLeft: 'auto', fontSize: 9, fontFamily: 'var(--font-mono)', color: 'var(--text-faint)' }}>FantasAI · {timeLabel}</span>
                    </div>
                    {/* Notes */}
                    {notesForDisplay.length > 0 && (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 5, marginBottom: notesForDisplay.length ? 6 : 0 }}>
                        {notesForDisplay.slice(0, 5).map((note, ni) => {
                          const dirColor = note.impact_direction === 'positive' ? 'var(--good)' : note.impact_direction === 'negative' ? 'var(--danger)' : 'var(--text-faint)';
                          const bullet = note.impact_direction === 'positive' ? '▲' : note.impact_direction === 'negative' ? '▼' : '◆';
                          return (
                            <div key={ni} style={{ display: 'flex', gap: 6, alignItems: 'flex-start' }}>
                              <span style={{ color: dirColor, fontSize: 9, marginTop: 3, flexShrink: 0 }}>{bullet}</span>
                              <span style={{ fontSize: 12, color: ni === 0 ? 'var(--text)' : 'var(--text-dim)', lineHeight: 1.5 }}>{note.note_text}</span>
                            </div>
                          );
                        })}
                      </div>
                    )}
                    {/* Signals */}
                    {((n.waiverRelevance >= 5) || (n.dynastyRelevance >= 5) || (n.rookieRelevance >= 5)) && (
                      <div style={{ display: 'flex', gap: 5, marginTop: 4 }}>
                        {n.waiverRelevance >= 5 && <span style={{ fontSize: 9, fontFamily: 'var(--font-mono)', fontWeight: 700, color: 'var(--warn)', background: 'rgba(255,181,71,.1)', border: '1px solid rgba(255,181,71,.3)', borderRadius: 3, padding: '1px 5px' }}>WAIVER {Number(n.waiverRelevance).toFixed(1)}</span>}
                        {n.dynastyRelevance >= 5 && <span style={{ fontSize: 9, fontFamily: 'var(--font-mono)', fontWeight: 700, color: '#b4a0ff', background: 'rgba(180,160,255,.1)', border: '1px solid rgba(180,160,255,.3)', borderRadius: 3, padding: '1px 5px' }}>DYNASTY {Number(n.dynastyRelevance).toFixed(1)}</span>}
                        {n.rookieRelevance >= 5 && <span style={{ fontSize: 9, fontFamily: 'var(--font-mono)', fontWeight: 700, color: '#a78bfa', background: 'rgba(167,139,250,.1)', border: '1px solid rgba(167,139,250,.3)', borderRadius: 3, padding: '1px 5px' }}>ROOKIE {Number(n.rookieRelevance).toFixed(1)}</span>}
                      </div>
                    )}
                    {/* No content fallback */}
                    {!notesForDisplay.length && !n.waiverRelevance && !n.dynastyRelevance && (
                      <div style={{ fontSize: 11, color: 'var(--text-faint)', fontStyle: 'italic' }}>No analysis available yet — check back after the next pipeline run.</div>
                    )}
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
