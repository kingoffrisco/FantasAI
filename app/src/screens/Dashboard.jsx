import React from 'react';
import { TEAM_ROSTERS, findTeam, NEWS, LEAGUE_TEAMS, buildRosterFrame, assignRoster } from '../lib/data.js';
import { computeOptimal } from './LineupDecisions.jsx';
import { buildPowerData } from '../lib/powerUtils.js';
import { findPlayer, usePlayers } from '../lib/playerStore.js';
import { PlayerCell, StatusDot, Sparkline, PosBadge, SourceBadge } from '../components/ui.jsx';
import { api } from '../api.js';
import { useApi, useR2CriticalAlerts, useR2BreakoutCandidates } from '../hooks.js';
import { fetchSleeperPlayerStats } from '../lib/sleeper.js';
import { sendLeaguePush } from '../lib/pushNotifications.js';
const SLOT_ELIGIBLE = {
  QB: ['QB'], RB: ['RB'], WR: ['WR'], TE: ['TE'],
  K: ['K'], DST: ['DST'], FLEX: ['RB', 'WR'],
};

function computeOptimalLineup(startingSlots, allPlayers) {
  const byPos = {};
  for (const p of allPlayers) {
    if (!byPos[p.pos]) byPos[p.pos] = [];
    byPos[p.pos].push(p);
  }
  for (const pos in byPos) byPos[pos].sort((a, b) => (b.proj ?? 0) - (a.proj ?? 0));
  const assigned = new Set();
  const result = [];
  for (const { slot } of startingSlots) {
    if (slot === 'FLEX') continue;
    const eligible = (SLOT_ELIGIBLE[slot] || [slot]).flatMap(pos => byPos[pos] || []).filter(p => !assigned.has(p.id)).sort((a, b) => (b.proj ?? 0) - (a.proj ?? 0));
    const best = eligible[0] ?? null;
    result.push({ slot, playerId: best?.id ?? null });
    if (best) assigned.add(best.id);
  }
  for (const { slot } of startingSlots) {
    if (slot !== 'FLEX') continue;
    const eligible = ['RB', 'WR'].flatMap(pos => byPos[pos] || []).filter(p => !assigned.has(p.id)).sort((a, b) => (b.proj ?? 0) - (a.proj ?? 0));
    const best = eligible[0] ?? null;
    result.push({ slot, playerId: best?.id ?? null });
    if (best) assigned.add(best.id);
  }
  return result;
}

function LineupSummaryCard({ myRosterIds, slotOverrides, onOpenPlayer }) {
  const allPlayersList = usePlayers();
  const settings = React.useMemo(() => {
    try { return JSON.parse(localStorage.getItem('fantasai_league_settings') || 'null') || null; } catch { return null; }
  }, []);
  const frame = React.useMemo(() => buildRosterFrame(settings), [settings]);
  const rosterEntries = React.useMemo(() => assignRoster(frame, [...myRosterIds], slotOverrides ?? {}, findPlayer), [frame, myRosterIds, slotOverrides, allPlayersList]);
  const startingSlots = rosterEntries.filter(e => e.slot !== 'BENCH');
  const allPlayers = [...myRosterIds].map(id => findPlayer(id)).filter(Boolean);
  const optimalSlots = computeOptimalLineup(startingSlots, allPlayers);

  const optimalMap = {};
  const counts = {};
  for (const { slot, playerId } of optimalSlots) {
    const idx = counts[slot] ?? 0;
    optimalMap[`${slot}-${idx}`] = playerId;
    counts[slot] = idx + 1;
  }

  const swaps = [];
  const seen = {};
  for (const cur of startingSlots) {
    const idx = seen[cur.slot] ?? 0;
    seen[cur.slot] = idx + 1;
    const optId = optimalMap[`${cur.slot}-${idx}`];
    if (optId && optId !== cur.playerId) {
      const curP = cur.playerId ? findPlayer(cur.playerId) : null;
      const optP = findPlayer(optId);
      if (optP) {
        const gain = (optP.proj ?? 0) - (curP?.proj ?? 0);
        if (gain > 0.05) swaps.push({ curP, optP, gain, slot: cur.slot });
      }
    }
  }

  const totalGain = swaps.reduce((s, c) => s + c.gain, 0);

  return (
    <>
      {swaps.length === 0 ? (
        <div style={{ fontSize: 13, color: 'var(--good)', fontWeight: 600 }}>Lineup looks optimal — no changes needed.</div>
      ) : (
        <>
          <ul style={{ margin: 0, padding: '0 0 0 18px', display: 'flex', flexDirection: 'column', gap: 6 }}>
            {swaps.map((s, i) => (
              <li key={i} style={{ fontSize: 13, lineHeight: 1.4 }}>
                Replace{' '}
                <span style={{ fontWeight: 700, cursor: 'pointer', color: 'var(--text)' }} onClick={() => onOpenPlayer?.(s.curP?.id)}>{s.curP?.name ?? '—'}</span>
                {' '}with{' '}
                <span style={{ fontWeight: 700, cursor: 'pointer', color: 'var(--accent)' }} onClick={() => onOpenPlayer?.(s.optP.id)}>{s.optP.name}</span>
                <span style={{ color: 'var(--good)', fontFamily: 'var(--font-mono)', fontSize: 12, marginLeft: 6 }}>+{s.gain.toFixed(1)} pts</span>
              </li>
            ))}
          </ul>
          <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid var(--border)', fontSize: 12, color: 'var(--text-dim)' }}>
            Total upside: <span style={{ color: 'var(--good)', fontWeight: 700, fontFamily: 'var(--font-mono)' }}>+{totalGain.toFixed(1)} pts</span>
          </div>
        </>
      )}
    </>
  );
}

const API_BASE = 'https://api.fantasai.net';

const NFL_SCHEDULE = [
  { key: 'hof',  label: 'Hall of Fame Game',  start: '2026-08-06', end: '2026-08-12', pre: true },
  { key: 'pre1', label: 'Preseason Week 1',   start: '2026-08-13', end: '2026-08-19', pre: true },
  { key: 'pre2', label: 'Preseason Week 2',   start: '2026-08-20', end: '2026-08-26', pre: true },
  { key: 'pre3', label: 'Preseason Week 3',   start: '2026-08-27', end: '2026-09-01', pre: true },
  { key: 'wk1',  label: 'Week 1',  num: 1,    start: '2026-09-09', end: '2026-09-15' },
  { key: 'wk2',  label: 'Week 2',  num: 2,    start: '2026-09-16', end: '2026-09-22' },
  { key: 'wk3',  label: 'Week 3',  num: 3,    start: '2026-09-23', end: '2026-09-29' },
  { key: 'wk4',  label: 'Week 4',  num: 4,    start: '2026-09-30', end: '2026-10-06' },
  { key: 'wk5',  label: 'Week 5',  num: 5,    start: '2026-10-07', end: '2026-10-13' },
  { key: 'wk6',  label: 'Week 6',  num: 6,    start: '2026-10-14', end: '2026-10-20' },
  { key: 'wk7',  label: 'Week 7',  num: 7,    start: '2026-10-21', end: '2026-10-27' },
  { key: 'wk8',  label: 'Week 8',  num: 8,    start: '2026-10-28', end: '2026-11-03' },
  { key: 'wk9',  label: 'Week 9',  num: 9,    start: '2026-11-04', end: '2026-11-10' },
  { key: 'wk10', label: 'Week 10', num: 10,   start: '2026-11-11', end: '2026-11-17' },
  { key: 'wk11', label: 'Week 11', num: 11,   start: '2026-11-19', end: '2026-11-24' },
  { key: 'wk12', label: 'Week 12', num: 12,   start: '2026-11-25', end: '2026-12-01' },
  { key: 'wk13', label: 'Week 13', num: 13,   start: '2026-12-02', end: '2026-12-08' },
  { key: 'wk14', label: 'Week 14', num: 14,   start: '2026-12-09', end: '2026-12-15' },
  { key: 'wk15', label: 'Week 15', num: 15,   start: '2026-12-16', end: '2026-12-22' },
  { key: 'wk16', label: 'Week 16', num: 16,   start: '2026-12-23', end: '2026-12-29' },
  { key: 'wk17', label: 'Week 17', num: 17,   start: '2026-12-30', end: '2027-01-05' },
  { key: 'wk18', label: 'Week 18', num: 18,   start: '2027-01-06', end: '2027-01-12' },
];

function getCurrentWeek() {
  const today = new Date().toISOString().slice(0, 10);
  const found = NFL_SCHEDULE.find(w => today >= w.start && today <= w.end);
  if (found) return found;
  if (today < NFL_SCHEDULE[0].start) return { key: 'offseason', label: 'Offseason · 2026', pre: true };
  return { key: 'offseason', label: 'Offseason', pre: true };
}

function getNextWeek() {
  const today = new Date().toISOString().slice(0, 10);
  const idx = NFL_SCHEDULE.findIndex(w => today < w.start);
  return idx >= 0 ? NFL_SCHEDULE[idx] : null;
}

// Round-robin schedule for opponent lookup (mirrors HeadToHead.jsx)
function buildRRSchedule(ids, weeks) {
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
const RR_SCHEDULE = buildRRSchedule(LEAGUE_TEAMS.map(t => t.id), 14);

function getOpponent(myTeamId, weekNum) {
  if (!weekNum || weekNum < 1 || weekNum > 14) return null;
  const matchups = RR_SCHEDULE[weekNum - 1] || [];
  const match = matchups.find(([a, b]) => a === myTeamId || b === myTeamId);
  if (!match) return null;
  const oppId = match[0] === myTeamId ? match[1] : match[0];
  return LEAGUE_TEAMS.find(t => t.id === oppId) ?? null;
}

function buildStandings(cbsRaw) {
  if (!cbsRaw) return null;
  const teams = Array.isArray(cbsRaw) ? cbsRaw
    : cbsRaw.teams || cbsRaw.body?.teams || cbsRaw.data || [];
  if (!Array.isArray(teams) || !teams.length) return null;
  const rows = teams.map(ct => {
    const cbsId = String(ct.id || ct.team_id || '');
    const mock = LEAGUE_TEAMS.find(t => t.cbsId === cbsId) || LEAGUE_TEAMS.find(t => t.name === ct.name);
    const w = ct.w ?? ct.wins ?? 0;
    const l = ct.l ?? ct.losses ?? 0;
    const pf = ct.pf ?? ct.points_for ?? 0;
    const pa = ct.pa ?? ct.points_against ?? 0;
    const liveTeam = mock?.id ? findTeam(mock.id) : null;
    return { id: mock?.id, name: ct.name || mock?.name || '—', logo: mock?.logo || '??', logoImg: liveTeam?.logoImg || null, color: mock?.color || '#555', w, l, pf, pa, me: liveTeam?.me || false };
  });

  return rows.sort((a, b) => (b.w - a.w) || (b.pf - a.pf) || (a.pa - b.pa));
}

function getScoringRules() {
  try {
    const s = JSON.parse(localStorage.getItem('fantasai_league_settings') || 'null');
    if (s?.scoring) return s.scoring;
  } catch {}
  return { passYd: 0.04, passTD: 4, passInt: -2, rushYd: 0.1, rushTD: 6, recYd: 0.1, recTD: 6, rec: 0.5, fumbleLost: -2 };
}

function calcFantasyPts(stats, rules) {
  return Math.max(0,
    (stats.passYards ?? 0) * (rules.passYd ?? 0.04) +
    (stats.passTDs   ?? 0) * (rules.passTD  ?? 4)   +
    (stats.passInts  ?? 0) * (rules.passInt  ?? -2)  +
    (stats.rushYards ?? 0) * (rules.rushYd   ?? 0.1) +
    (stats.rushTDs   ?? 0) * (rules.rushTD   ?? 6)   +
    (stats.recYards  ?? 0) * (rules.recYd    ?? 0.1) +
    (stats.recTDs    ?? 0) * (rules.recTD    ?? 6)   +
    (stats.receptions?? 0) * (rules.rec      ?? 0.5) +
    (stats.fumbleLost?? 0) * (rules.fumbleLost ?? -2)
  );
}

function parseEspnBoxScore(boxscorePlayers, rules) {
  const byPlayer = {};
  for (const teamData of (boxscorePlayers ?? [])) {
    for (const group of (teamData.statistics ?? [])) {
      const cat  = (group.name ?? '').toLowerCase();
      const keys = group.keys ?? [];
      const idx  = k => keys.indexOf(k);
      for (const ath of (group.athletes ?? [])) {
        const name = (ath.athlete?.displayName ?? '').toLowerCase();
        if (!name) continue;
        if (!byPlayer[name]) byPlayer[name] = {};
        const s = byPlayer[name];
        const st = ath.stats ?? [];
        const get = (...ks) => { for (const k of ks) { const i = idx(k); if (i >= 0) return parseFloat(st[i]) || 0; } return null; };
        if (cat === 'passing')   { s.passYards = get('passingYards', 'yards') ?? s.passYards ?? 0; s.passTDs = get('passingTouchdowns', 'touchdowns') ?? s.passTDs ?? 0; s.passInts = get('interceptions') ?? s.passInts ?? 0; }
        if (cat === 'rushing')   { s.rushYards = get('rushingYards', 'yards') ?? s.rushYards ?? 0; s.rushTDs = get('rushingTouchdowns', 'touchdowns') ?? s.rushTDs ?? 0; }
        if (cat === 'receiving') { s.recYards = get('receivingYards', 'yards') ?? s.recYards ?? 0; s.recTDs = get('receivingTouchdowns', 'touchdowns') ?? s.recTDs ?? 0; s.receptions = get('receptions') ?? s.receptions ?? 0; }
        if (cat === 'fumbles')   { s.fumbleLost = get('fumblesLost', 'lost') ?? s.fumbleLost ?? 0; }
      }
    }
  }
  const actuals = {};
  for (const [name, stats] of Object.entries(byPlayer)) actuals[name] = calcFantasyPts(stats, rules);
  return actuals;
}

function getGameProgress(gameInfo) {
  if (!gameInfo || gameInfo.statusName === 'STATUS_SCHEDULED') return 0;
  if (gameInfo.statusName === 'STATUS_FINAL') return 1;
  const parts = (gameInfo.clock || '15:00').split(':');
  const timeLeft = parseInt(parts[0] || '15') * 60 + parseInt(parts[1] || '0');
  const qSecs    = 15 * 60;
  const done     = Math.max(0, (gameInfo.period || 1) - 1) * qSecs + Math.max(0, qSecs - timeLeft);
  return Math.min(0.99, done / (4 * qSecs));
}

function DraftCountdown({ canEdit }) {
  const [draftDate, setDraftDate] = React.useState(() => {
    try { return JSON.parse(localStorage.getItem('fantasai_league_settings') || 'null')?.draftDate ?? null; } catch { return null; }
  });
  const [draftAddress, setDraftAddress] = React.useState(() => {
    try { return JSON.parse(localStorage.getItem('fantasai_league_settings') || 'null')?.draftAddress ?? ''; } catch { return ''; }
  });
  const [editing, setEditing] = React.useState(false);
  const [draft, setDraft]     = React.useState('');
  const [draftAddrDraft, setDraftAddrDraft] = React.useState('');
  const [timeLeft, setTimeLeft] = React.useState(null);

  React.useEffect(() => {
    if (!draftDate) { setTimeLeft(null); return; }
    function tick() {
      const diff = new Date(draftDate).getTime() - Date.now();
      if (diff <= 0) { setTimeLeft({ done: true }); return; }
      setTimeLeft({
        done: false,
        d: Math.floor(diff / 86400000),
        h: Math.floor((diff % 86400000) / 3600000),
        m: Math.floor((diff % 3600000) / 60000),
        s: Math.floor((diff % 60000) / 1000),
      });
    }
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [draftDate]);

  function save() {
    try {
      const saved = JSON.parse(localStorage.getItem('fantasai_league_settings') || '{}');
      localStorage.setItem('fantasai_league_settings', JSON.stringify({ ...saved, draftDate: draft, draftAddress: draftAddrDraft }));
    } catch {}
    setDraftDate(draft);
    setDraftAddress(draftAddrDraft);
    setEditing(false);
  }

  if (editing) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxWidth: 340 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <input type="datetime-local" className="input" style={{ fontSize: 12, padding: '4px 8px', flex: 1 }}
            value={draft} onChange={e => setDraft(e.target.value)} />
        </div>
        <input
          className="input"
          placeholder="Draft location / address (optional)…"
          value={draftAddrDraft}
          onChange={e => setDraftAddrDraft(e.target.value)}
          style={{ fontSize: 12, padding: '4px 8px' }}
        />
        <div style={{ display: 'flex', gap: 6 }}>
          <button className="btn sm primary" onClick={save}>Save</button>
          <button className="btn sm ghost" onClick={() => setEditing(false)}>✕</button>
        </div>
      </div>
    );
  }

  if (!draftDate) {
    if (!canEdit) return null;
    return (
      <button className="btn ghost" style={{ fontSize: 11 }}
        onClick={() => { setDraft(''); setDraftAddrDraft(''); setEditing(true); }}>
        + Set Draft Date
      </button>
    );
  }

  if (timeLeft?.done) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--good)' }}>Draft Complete ✓</span>
        {canEdit && (
          <button style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-faint)', fontSize: 13, padding: 0 }}
            onClick={() => { setDraft(draftDate); setEditing(true); }} title="Edit draft date">✏</button>
        )}
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <div style={{
        background: 'rgba(255,215,0,.1)', border: '1px solid rgba(255,215,0,.35)',
        borderRadius: 8, padding: '5px 12px', display: 'flex', alignItems: 'center', gap: 10,
      }}>
        <span style={{ fontSize: 10, fontWeight: 800, color: '#FFD700', textTransform: 'uppercase', letterSpacing: '.1em' }}>Draft In</span>
        {timeLeft ? (
          <div style={{ display: 'flex', gap: 5, alignItems: 'baseline' }}>
            {timeLeft.d > 0 && (
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 14, fontWeight: 800, color: '#FFD700' }}>
                {timeLeft.d}<span style={{ fontSize: 9, marginLeft: 1, color: 'rgba(255,215,0,.7)' }}>d</span>
              </span>
            )}
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 14, fontWeight: 800, color: '#FFD700' }}>
              {String(timeLeft.h).padStart(2, '0')}<span style={{ fontSize: 9, marginLeft: 1, color: 'rgba(255,215,0,.7)' }}>h</span>
            </span>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 14, fontWeight: 800, color: '#FFD700' }}>
              {String(timeLeft.m).padStart(2, '0')}<span style={{ fontSize: 9, marginLeft: 1, color: 'rgba(255,215,0,.7)' }}>m</span>
            </span>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 14, fontWeight: 800, color: '#FFD700' }}>
              {String(timeLeft.s).padStart(2, '0')}<span style={{ fontSize: 9, marginLeft: 1, color: 'rgba(255,215,0,.7)' }}>s</span>
            </span>
          </div>
        ) : (
          <span className="faint" style={{ fontSize: 12 }}>—</span>
        )}
        {draftDate && (
          <span style={{ fontSize: 10, color: 'rgba(255,215,0,.55)', fontFamily: 'var(--font-mono)' }}>
            {new Date(draftDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
          </span>
        )}
      </div>
      {canEdit && (
        <button style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-faint)', fontSize: 14, padding: 0, lineHeight: 1 }}
          onClick={() => { setDraft(draftDate || ''); setDraftAddrDraft(draftAddress || ''); setEditing(true); }} title="Edit draft date">✏</button>
      )}
    </div>
  );
}

export default function Dashboard({ onNav, onOpenPlayer, user, myRosterIds = new Set(), sourcesState, slotOverrides = {}, watchlistIds = new Set(), tradeOffers = [] }) {
  const [isMobile, setIsMobile] = React.useState(() => window.matchMedia('(max-width: 1100px)').matches);
  React.useEffect(() => {
    const mq = window.matchMedia('(max-width: 1100px)');
    const handler = e => setIsMobile(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);
  const [dashTab, setDashTab] = React.useState('standings');
  const [mobileScoringOpen, setMobileScoringOpen] = React.useState(false);

  const { data: cbsTeams } = useApi(() => api.teams(), []);
  const { data: r2Alerts, fetchedAt: r2AlertsFetchedAt } = useR2CriticalAlerts();
  const { data: r2Breakouts } = useR2BreakoutCandidates();
  const standings = React.useMemo(() => buildStandings(cbsTeams), [cbsTeams]);
  const currentWeek = React.useMemo(getCurrentWeek, []);
  const nextWeek    = React.useMemo(getNextWeek, []);
  const weekLabel   = currentWeek.label;
  const isOffseason = currentWeek.key === 'offseason';
  const isPre       = currentWeek.pre;

  const allPlayersList = usePlayers();

  // Power rank from the same buildPowerData used on the Power Rankings screen
  const powerRankMap = React.useMemo(() => {
    const weekNum = isOffseason ? 0 : (currentWeek.num || 0);
    const rOv  = user?.teamId && myRosterIds?.size ? { [user.teamId]: myRosterIds } : {};
    const slOv = user?.teamId && Object.keys(slotOverrides).length ? { [user.teamId]: slotOverrides } : {};
    const data = buildPowerData(weekNum, rOv, slOv);
    return new Map(data.map((d, i) => [d.team.id, i + 1]));
  }, [isOffseason, currentWeek, allPlayersList, myRosterIds, slotOverrides]);

  // Standings sorted: pre-season = power ranking only; in-season = wins → PF → PA → PR
  const sortedStandings = React.useMemo(() => {
    if (!standings) return null;
    const hasGames = standings.some(t => t.w > 0 || t.l > 0);
    if (!hasGames) {
      return [...standings].sort((a, b) =>
        (powerRankMap.get(a.id) ?? Infinity) - (powerRankMap.get(b.id) ?? Infinity)
      );
    }
    return [...standings].sort((a, b) => {
      if (b.w !== a.w) return b.w - a.w;
      if (b.pf !== a.pf) return b.pf - a.pf;
      if (a.pa !== b.pa) return a.pa - b.pa;
      return (powerRankMap.get(a.id) ?? Infinity) - (powerRankMap.get(b.id) ?? Infinity);
    });
  }, [standings, powerRankMap]);

  // Load commissioner message + media + league name from league settings
  const [commishData, setCommishData] = React.useState(() => {
    try {
      const saved      = JSON.parse(localStorage.getItem('fantasai_league_settings') || 'null');
      const media      = JSON.parse(localStorage.getItem('fantasai_commish_media') || 'null');
      const text       = saved?.commishMessage ?? "Welcome to ATO Tau League! Use Rules & Settings → Commissioner Message to post updates for your managers.";
      const leagueName = saved?.leagueName ?? 'ATO Tau League';
      return { text, media, leagueName };
    } catch { return { text: null, media: null, leagueName: 'ATO Tau League' }; }
  });

  const canEditCommish = user?.isAdmin || user?.isCommissioner;

  // ── Push notifications (commish send) ───────────────────────────────────────
  const [pushModal, setPushModal]     = React.useState(false);
  const [pushTitle, setPushTitle]     = React.useState('');
  const [pushBody, setPushBody]       = React.useState('');
  const [pushSending, setPushSending] = React.useState(false);
  const [pushResult, setPushResult]   = React.useState(null);
  const [pushTargets, setPushTargets] = React.useState(() => new Set(LEAGUE_TEAMS.map(t => t.id)));
  function getCommishKey() {
    try { return JSON.parse(localStorage.getItem('fantasai_league_settings') || '{}')?.fantasaiKey || ''; } catch { return ''; }
  }
  const commishKey = getCommishKey();

  function togglePushTarget(id) {
    setPushTargets(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  const allSelected = pushTargets.size === LEAGUE_TEAMS.length;

  async function sendPushAlert() {
    if (!pushTitle.trim()) return;
    setPushSending(true);
    setPushResult(null);
    const teamIds = allSelected ? null : [...pushTargets];
    const key = getCommishKey();
    try {
      const res = await sendLeaguePush(pushTitle.trim(), pushBody.trim(), key, '/', teamIds);
      if (res.ok) {
        setPushResult(`Sent to ${res.sent} device(s)`);
        setTimeout(() => { setPushModal(false); setPushResult(null); setPushTitle(''); setPushBody(''); }, 2000);
      } else if (res.error === 'Unauthorized') {
        setPushResult('Key mismatch — go to Rules & Settings → General → Commissioner Key and enter the same value you set as FANTASAI_KEY in Cloudflare.');
      } else {
        setPushResult(`Error: ${res.error}`);
      }
    } catch {
      setPushResult('Send failed — check your network connection.');
    }
    setPushSending(false);
  }
  // ── End push ────────────────────────────────────────────────────────────────

  const [editingCommish, setEditingCommish] = React.useState(false);
  const [commishTextDraft, setCommishTextDraft] = React.useState('');
  const [commishMediaDraft, setCommishMediaDraft] = React.useState(null);
  const [commishUrlDraft, setCommishUrlDraft] = React.useState('');
  const commishMediaRef = React.useRef(null);

  function getCommishEmbedUrl(raw) {
    try {
      const u = new URL(raw);
      if (u.hostname.includes('youtube.com') && u.searchParams.get('v'))
        return `https://www.youtube.com/embed/${u.searchParams.get('v')}?autoplay=0`;
      if (u.hostname === 'youtu.be')
        return `https://www.youtube.com/embed${u.pathname}?autoplay=0`;
      if (u.hostname.includes('vimeo.com'))
        return `https://player.vimeo.com/video/${u.pathname.split('/').filter(Boolean).pop()}?autoplay=0`;
    } catch {}
    return raw;
  }

  function startEditCommish() {
    setCommishTextDraft(commishData.text || '');
    setCommishMediaDraft(commishData.media ? { ...commishData.media } : null);
    setCommishUrlDraft(commishData.media?.videoUrl || '');
    setEditingCommish(true);
  }

  function saveCommishMessage() {
    const url = commishUrlDraft.trim();
    const finalMedia = commishMediaDraft
      ? { ...commishMediaDraft, ...(url ? { videoUrl: url } : {}) }
      : url ? { videoUrl: url } : null;
    if (finalMedia && !url) delete finalMedia.videoUrl;
    try {
      const saved = JSON.parse(localStorage.getItem('fantasai_league_settings') || '{}');
      localStorage.setItem('fantasai_league_settings', JSON.stringify({ ...saved, commishMessage: commishTextDraft }));
      if (finalMedia) localStorage.setItem('fantasai_commish_media', JSON.stringify(finalMedia));
      else localStorage.removeItem('fantasai_commish_media');
    } catch {}
    setCommishData(d => ({ ...d, text: commishTextDraft, media: finalMedia }));
    setEditingCommish(false);
    pushCommunity(undefined, finalMedia, undefined);
  }

  function handleCommishMediaUpload(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    const isVideo = file.type.startsWith('video/');
    const isImage = file.type.startsWith('image/');
    if (!isVideo && !isImage) return;
    const reader = new FileReader();
    reader.onload = ev => setCommishMediaDraft({ url: ev.target.result, type: isVideo ? 'video' : 'image', name: file.name });
    reader.readAsDataURL(file);
  }

  // Resolve owner info from logged-in user
  const teamId   = user?.teamId || 1;
  const team     = findTeam(teamId);
  const ownerName = team?.owner || user?.teamName || 'Manager';
  const teamName  = team?.name || user?.teamName || 'My Team';
  const logoTextColor = React.useMemo(() => {
    try { return JSON.parse(localStorage.getItem('fantasai_team_prefs') || 'null')?.logoTextColor ?? '#000000'; } catch { return '#000000'; }
  }, []);

  // 2026 season record from live standings (0-0 until games are played)
  const myStanding = standings?.find(s => s.me) ?? null;
  const record2026 = myStanding ? `${myStanding.w}-${myStanding.l}` : '0-0';

  // Waiver priority = inverse of standings rank (last place picks first = priority #1)
  const totalTeams = LEAGUE_TEAMS.length;
  const myStandingsRank = sortedStandings ? sortedStandings.findIndex(s => s.me) + 1 : null;
  const waiverPosition  = myStandingsRank ? (totalTeams - myStandingsRank + 1) : null;

  // Build starting lineup from league settings frame (stays in sync with CurrentRoster)
  const rosterSettings = React.useMemo(() => {
    try { return JSON.parse(localStorage.getItem('fantasai_league_settings') || 'null'); } catch { return null; }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const slotFrame  = React.useMemo(() => buildRosterFrame(rosterSettings), [rosterSettings]);
  const fullRoster = React.useMemo(
    () => assignRoster(slotFrame, myRosterIds, slotOverrides, findPlayer),
    [slotFrame, myRosterIds, slotOverrides, allPlayersList],
  );

  const starters   = fullRoster.filter(r => r.slot !== 'BENCH' && r.playerId);
  const rosterIds  = new Set(fullRoster.map(r => r.playerId).filter(Boolean));
  const starterIds = new Set(starters.map(r => r.playerId).filter(Boolean));
  const totalProj  = starters.reduce((s, r) => s + (findPlayer(r.playerId)?.proj || 0), 0);
  const rosterPlayers = allPlayersList.filter(p => rosterIds.has(p.id));
  const optimalSlots  = React.useMemo(
    () => {
      const wk = currentWeek.num || 0;
      const projFn = p => {
        if (!p) return 0;
        const s = (p.status || '').toUpperCase();
        if (['OUT', 'O', 'IR', 'NFI', 'PUP', 'SUSPENDED'].includes(s)) return 0;
        if (p.bye && p.bye === wk) return 0;
        return p.proj ?? 0;
      };
      return computeOptimal(starters, rosterPlayers, projFn, wk);
    },
    [starters, rosterPlayers, currentWeek.num],
  );
  const optimalTotal  = optimalSlots.reduce((s, e) => s + (findPlayer(e.playerId)?.proj ?? 0), 0);
  const optimalGain   = Math.max(0, optimalTotal - totalProj);
  const isOptimal     = optimalGain <= 0.05;

  // Valid only when every starter slot has a player — no empty starters allowed.
  const starterSlots = fullRoster.filter(r => r.slot !== 'BENCH');
  const isValidRoster = starterSlots.length > 0 && starterSlots.every(r => r.playerId != null);
  const hasStarterInjury = starters.some(r => findPlayer(r.playerId)?.status !== 'OK');

  // ── Live roster data from Sleeper (projections + injury news) ─────────────
  const sleeperOn = sourcesState?.freeApis?.['sleeper-api'] !== false;
  // { [playerId]: { proj: number|null, status: string, injuryBodyPart: string } }
  const [sleeperRosterData, setSleeperRosterData] = React.useState({});
  const [newsLoading, setNewsLoading] = React.useState(false);

  const allRosterIds = [...rosterIds].join(',');
  React.useEffect(() => {
    if (!sleeperOn) { setSleeperRosterData({}); return; }
    const targets = [...rosterIds].map(id => findPlayer(id)).filter(Boolean);
    if (!targets.length) return;
    setNewsLoading(true);
    Promise.allSettled(targets.map(p => fetchSleeperPlayerStats(p.name, p.pos)))
      .then(results => {
        const data = {};
        results.forEach((r, i) => {
          if (r.status !== 'fulfilled' || !r.value?.found) return;
          const d = r.value;
          const proj = d.projection?.pts_half_ppr ?? d.projection?.pts_std ?? null;
          data[targets[i].id] = {
            proj:           proj != null ? Number(proj) : null,
            status:         d.status || 'Active',
            injuryBodyPart: d.injuryBodyPart || '',
          };
        });
        setSleeperRosterData(data);
        setNewsLoading(false);
      });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sleeperOn, allRosterIds]);

  // ── ESPN game data + player actuals ─────────────────────────────────────────
  const [espnGameMap, setEspnGameMap]         = React.useState({}); // TEAMABBR → { statusName, period, clock, eventId }
  const [espnPlayerActuals, setEspnPlayerActuals] = React.useState({}); // playerName(lower) → actual pts

  React.useEffect(() => {
    const wkNum = currentWeek.num;
    if (!wkNum) return;
    const rules = getScoringRules();
    fetch(`https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?week=${wkNum}&seasontype=2`)
      .then(r => r.json())
      .then(data => {
        const gameMap   = {};
        const eventIds  = [];
        for (const event of (data.events || [])) {
          const comp       = event.competitions?.[0];
          if (!comp) continue;
          const statusName = event.status?.type?.name ?? 'STATUS_SCHEDULED';
          const period     = event.status?.period ?? 0;
          const clock      = event.status?.displayClock ?? '15:00';
          const displayState = event.status?.type?.shortDetail ?? '';
          for (const comp2 of (event.competitions || [])) {
            for (const c of (comp2.competitors || [])) {
              const abbr = (c.team?.abbreviation ?? '').toUpperCase();
              if (abbr) gameMap[abbr] = { statusName, period, clock, displayState, eventId: event.id };
            }
          }
          if (statusName !== 'STATUS_SCHEDULED') eventIds.push(event.id);
        }
        setEspnGameMap(gameMap);
        if (!eventIds.length) return;
        Promise.allSettled(eventIds.map(id =>
          fetch(`https://site.api.espn.com/apis/site/v2/sports/football/nfl/summary?event=${id}`)
            .then(r => r.json())
        )).then(results => {
          let merged = {};
          for (const r of results) {
            if (r.status !== 'fulfilled') continue;
            const partial = parseEspnBoxScore(r.value?.boxscore?.players, rules);
            for (const [k, v] of Object.entries(partial)) merged[k] = (merged[k] ?? 0) + v;
          }
          setEspnPlayerActuals(merged);
        });
      })
      .catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentWeek.num]);

  // Build projection columns
  const projCols = [
    { id: 'base',    label: 'Proj', sub: 'FantasAI',   color: 'var(--accent)',   get: p => p.proj?.toFixed(1) ?? '—' },
    ...(sleeperOn ? [{ id: 'sleeper', label: 'Proj', sub: 'Sleeper API', color: 'var(--accent-2)', get: p => sleeperRosterData[p.id]?.proj != null ? sleeperRosterData[p.id].proj.toFixed(1) : '—' }] : []),
  ];

  // Build news: starters only — live Sleeper items first, mock NEWS as fallback
  const INJURY_IMPACT = { Out: 'high', IR: 'high', Doubtful: 'high', PUP: 'high', Questionable: 'med', Suspended: 'med' };
  const liveNewsItems = sleeperOn
    ? Object.entries(sleeperRosterData)
        .filter(([pid, d]) => starterIds.has(Number(pid)) && d.status && d.status !== 'Active')
        .map(([pid, d]) => {
          const p = findPlayer(Number(pid));
          if (!p) return null;
          return {
            id:       `live-${pid}`,
            playerId: Number(pid),
            impact:   INJURY_IMPACT[d.status] || 'low',
            title:    d.injuryBodyPart ? `${d.status} · ${d.injuryBodyPart} injury` : `Status: ${d.status}`,
            body:     d.injuryBodyPart
              ? `${p.name} is listed ${d.status} with a ${d.injuryBodyPart} injury. Monitor practice reports.`
              : `${p.name} injury status updated to ${d.status}.`,
            source:   'Sleeper API',
            mins:     0,
            live:     true,
          };
        })
        .filter(Boolean)
    : [];

  const livePlayerIds = new Set(liveNewsItems.map(n => n.playerId));
  const mockNews = NEWS
    .filter(n => starterIds.has(n.playerId) && !livePlayerIds.has(n.playerId));

  const rosterNews = [...liveNewsItems, ...mockNews]
    .sort((a, b) => {
      const aHigh = a.impact === 'high' || findPlayer(a.playerId)?.status !== 'OK';
      const bHigh = b.impact === 'high' || findPlayer(b.playerId)?.status !== 'OK';
      if (aHigh !== bHigh) return aHigh ? -1 : 1;
      return (a.mins ?? 0) - (b.mins ?? 0);
    })
    .slice(0, 6);

  const subLine = isOffseason
    ? `Next: ${nextWeek ? nextWeek.label + ' · starts ' + new Date(nextWeek.start).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '—'}`
    : isPre
    ? `${currentWeek.label} · Exhibition games`
    : `${currentWeek.label} · ${new Date(currentWeek.start).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} – ${new Date(currentWeek.end).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`;

  // ── Champions Corner ────────────────────────────────────────────────────────
  const CHAMP_KEY   = 'fantasai_champions';
  const THIS_YEAR   = new Date().getFullYear();
  const CHAMP_YEARS = Array.from({ length: 10 }, (_, i) => THIS_YEAR - 10 + i); // 10 yr window ending THIS_YEAR-1

  const [champions, setChampions] = React.useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(CHAMP_KEY) || 'null');
      if (saved && Array.isArray(saved)) return saved;
    } catch {}
    return CHAMP_YEARS.map(yr => ({ year: yr, champion: '', asterisk: false, note: '' }));
  });
  const [editingChampions, setEditingChampions]     = React.useState(false);
  const [champDraft, setChampDraft]                 = React.useState([]);
  const [champTooltip, setChampTooltip]             = React.useState(null);
  const [championsOpen, setChampionsOpen]           = React.useState(true);
  const canEditChampions = user?.isAdmin || user?.isCommissioner;
  const champPhotoRef = React.useRef(null);
  const [champPhotoIdx, setChampPhotoIdx] = React.useState(null);
  const [champComments, setChampComments] = React.useState(() => {
    try { return JSON.parse(localStorage.getItem('fantasai_champ_comments') || '[]'); } catch { return []; }
  });
  const [champCommentText, setChampCommentText] = React.useState('');
  const [champCommentGifUrl, setChampCommentGifUrl] = React.useState('');
  const [showEmojiPicker, setShowEmojiPicker] = React.useState(false);
  const [showGifInput, setShowGifInput] = React.useState(false);
  const champTextareaRef = React.useRef(null);

  function startEditChampions() {
    setChampDraft(champions.map(c => ({ ...c })));
    setEditingChampions(true);
  }
  function saveChampions() {
    setChampions(champDraft);
    localStorage.setItem(CHAMP_KEY, JSON.stringify(champDraft));
    setEditingChampions(false);
    pushCommunity(champDraft, undefined, undefined);
  }
  function updateDraft(i, patch) {
    setChampDraft(prev => prev.map((c, idx) => idx === i ? { ...c, ...patch } : c));
  }
  function addChampComment() {
    const text = champCommentText.trim();
    const gifUrl = champCommentGifUrl.trim();
    if (!text && !gifUrl) return;
    const comment = {
      id: Date.now().toString(),
      teamId: user?.teamId ?? null,
      teamName: team?.name || user?.teamName || 'League Member',
      text,
      gifUrl: gifUrl || null,
      timestamp: new Date().toISOString(),
    };
    const updated = [comment, ...champComments];
    setChampComments(updated);
    localStorage.setItem('fantasai_champ_comments', JSON.stringify(updated));
    setChampCommentText('');
    setChampCommentGifUrl('');
    setShowGifInput(false);
    setShowEmojiPicker(false);
  }

  function insertEmoji(emoji) {
    const ta = champTextareaRef.current;
    if (!ta) { setChampCommentText(t => t + emoji); return; }
    const start = ta.selectionStart;
    const end   = ta.selectionEnd;
    const next  = champCommentText.slice(0, start) + emoji + champCommentText.slice(end);
    setChampCommentText(next);
    requestAnimationFrame(() => {
      ta.focus();
      ta.setSelectionRange(start + emoji.length, start + emoji.length);
    });
  }

  function deleteChampComment(id) {
    const updated = champComments.filter(c => c.id !== id);
    setChampComments(updated);
    localStorage.setItem('fantasai_champ_comments', JSON.stringify(updated));
  }

  function handleChampPhoto(e, i) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => updateDraft(i, { photo: ev.target.result });
    reader.readAsDataURL(file);
    e.target.value = '';
  }

  // ── League Transactions (from R2) ────────────────────────────────────────────
  const [transactions, setTransactions] = React.useState([]);
  const [txLoading, setTxLoading]       = React.useState(false);
  const [txTeamFilter, setTxTeamFilter] = React.useState(null);

  React.useEffect(() => {
    setTxLoading(true);
    api.transactions.get()
      .then(data => { setTransactions(Array.isArray(data) ? data : []); })
      .finally(() => setTxLoading(false));
  }, []);

  // ── H2H win probability (shared between scoreboard card + stats grid) ──────
  const h2hWinData = React.useMemo(() => {
    const wkNum = currentWeek.num;
    if (!wkNum) return null;
    const opp = getOpponent(teamId, wkNum);
    if (!opp) return null;
    const myProj = starters.reduce((s, r) => {
      const live = sleeperRosterData[r.playerId];
      return s + (live?.proj != null ? live.proj : (findPlayer(r.playerId)?.proj || 0));
    }, 0);
    const oppRoster    = TEAM_ROSTERS[opp.id] || [];
    const oppStarters  = oppRoster.filter(r => r.slot !== 'BENCH' && r.playerId);
    const oppProj      = oppStarters.reduce((s, e) => s + (findPlayer(e.playerId)?.proj || findPlayer(e.playerId)?.avg || 0), 0);
    const myLive = starters.reduce((s, r) => {
      const p = findPlayer(r.playerId);
      if (!p) return s;
      const proj     = sleeperRosterData[r.playerId]?.proj ?? p.proj ?? 0;
      const gameInfo = espnGameMap[(p.team ?? '').toUpperCase()];
      const actual   = espnPlayerActuals[(p.name ?? '').toLowerCase()] ?? null;
      if (!gameInfo || gameInfo.statusName === 'STATUS_SCHEDULED') return s + proj;
      const progress = getGameProgress(gameInfo);
      if (actual != null) return s + (progress >= 1 ? actual : actual + proj * (1 - progress));
      return s + proj;
    }, 0);
    const liveCount  = starters.filter(r => { const p = findPlayer(r.playerId); const g = espnGameMap[(p?.team ?? '').toUpperCase()]; return g?.statusName === 'STATUS_IN_PROGRESS'; }).length;
    const finalCount = starters.filter(r => { const p = findPlayer(r.playerId); const g = espnGameMap[(p?.team ?? '').toUpperCase()]; return g?.statusName === 'STATUS_FINAL'; }).length;
    const hasLive    = Object.keys(espnGameMap).length > 0;
    const myScore    = hasLive ? myLive : myProj;
    const oppScore   = hasLive ? oppProj : oppProj;
    const diff       = myScore - oppScore;
    const isWinning  = diff >= 0;
    const winPct     = myScore + oppScore > 0 ? Math.round((myScore / (myScore + oppScore)) * 100) : 50;
    return { opp, oppStarters, myProj, myLive, oppProj, myScore, oppScore, diff, isWinning, winPct, liveCount, finalCount, hasLive };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [starters, sleeperRosterData, espnGameMap, espnPlayerActuals, teamId, currentWeek]);

  return (
    <div className="col" style={{ height: '100%', overflow: isMobile ? 'auto' : 'hidden', display: 'flex', flexDirection: 'column', paddingBottom: isMobile ? 0 : 24 }}>
      <div className="page-head" style={{ flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
          {/* League name — large, far left */}
          <span style={{ fontFamily: 'var(--font-display)', fontStretch: '75%', fontSize: 30, fontWeight: 900, color: '#FFD700', letterSpacing: '-.01em', lineHeight: 1, whiteSpace: 'nowrap' }}>
            {commishData.leagueName}
          </span>

          {/* Trade pending badge — right of league name */}
          {(() => {
            const pending = tradeOffers.filter(o => o.status === 'pending' && (o.fromTeamId === teamId || o.toTeamId === teamId));
            if (!pending.length) return null;
            const incoming = pending.filter(o => o.toTeamId === teamId);
            const outgoing = pending.filter(o => o.fromTeamId === teamId);
            return (
              <span
                onClick={() => onNav('roster')}
                style={{ cursor: 'pointer', fontSize: 12, fontWeight: 900, color: '#1a0d00', background: '#FFD700', borderRadius: 6, padding: '3px 10px', letterSpacing: '.02em', display: 'flex', alignItems: 'center', gap: 5, flexShrink: 0 }}
                title="Click to view trade offers on your roster"
              >
                ↔ TRADE PENDING
                {(incoming.length + outgoing.length) > 1 && (
                  <span style={{ background: 'rgba(0,0,0,.2)', borderRadius: 4, padding: '0 5px', fontSize: 10 }}>
                    {incoming.length + outgoing.length}
                  </span>
                )}
              </span>
            );
          })()}

          {/* Dashboard label — smaller, after badge */}
          <div>
            <div style={{ fontSize: 12, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '.12em', color: 'var(--text-dim)', lineHeight: 1 }}>
              {weekLabel} Dashboard
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-faint)', marginTop: 3 }}>{subLine}</div>
          </div>

        </div>
        <div className="flex gap-8" style={{ alignItems: 'center' }}>
          <button className="btn primary" onClick={() => onNav('draft')}>▶ Open Draft Room</button>
        </div>
      </div>

      {/* ── Live H2H Scoreboard ──────────────────────────────────────────────── */}
      {h2hWinData && (() => {
        const { opp, oppStarters, myProj, myLive, oppProj, myScore, oppScore, diff, isWinning, winPct, liveCount, finalCount, hasLive } = h2hWinData;
        const wkNum    = currentWeek.num;
        const winColor = isWinning ? 'var(--good)' : 'var(--danger)';
        const isLiveWeek = !isOffseason && !isPre;
        const liveLabel  = liveCount > 0 ? `${liveCount} LIVE` : finalCount > 0 ? `${finalCount} FINAL` : 'PROJECTED';
        const liveColor  = liveCount > 0 ? 'var(--good)' : finalCount > 0 ? 'var(--accent)' : 'var(--text-faint)';

        return (
          <div style={{ padding: '0 24px 16px', flexShrink: 0 }}>
            <div style={{
              borderRadius: 12,
              border: `1px solid ${isWinning ? 'rgba(76,175,130,.35)' : 'rgba(255,90,110,.3)'}`,
              background: isWinning ? 'rgba(76,175,130,.06)' : 'rgba(255,90,110,.06)',
              padding: '14px 20px',
              display: 'flex',
              alignItems: 'center',
              gap: 0,
            }}>
              {/* Label */}
              <div style={{ minWidth: 110 }}>
                <div style={{ fontSize: 9, fontFamily: 'var(--font-mono)', fontWeight: 700, letterSpacing: '.1em', textTransform: 'uppercase', color: 'var(--text-faint)', marginBottom: 3 }}>
                  Week {wkNum} · H2H
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                  {liveCount > 0 && (
                    <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--good)', boxShadow: '0 0 6px var(--good)', flexShrink: 0, animation: 'pulse 2s infinite' }} />
                  )}
                  <span style={{ fontSize: 10, fontWeight: 700, color: liveColor }}>{isLiveWeek ? liveLabel : 'PROJECTED'}</span>
                </div>
              </div>

              {/* My team */}
              <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 10 }}>
                {team?.logoImg ? (
                  <img src={team.logoImg} alt="" style={{ width: 36, height: 36, borderRadius: 8, objectFit: 'cover', flexShrink: 0 }} />
                ) : (
                  <span style={{ width: 36, height: 36, borderRadius: 8, background: team?.color || 'var(--accent)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, fontWeight: 900, color: logoTextColor, flexShrink: 0 }}>
                    {team?.logo || '??'}
                  </span>
                )}
                <div>
                  <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text)' }}>{teamName}</div>
                  <div style={{ fontSize: 9, color: 'var(--text-faint)' }}>
                    {hasLive ? `PROJ ${myProj.toFixed(1)}` : sleeperOn ? 'Sleeper proj' : 'FantasAI proj'}
                  </div>
                </div>
                <div style={{ textAlign: 'right', marginLeft: 'auto' }}>
                  <div style={{ fontFamily: 'var(--font-display)', fontWeight: 900, fontStretch: '75%', fontSize: 32, color: hasLive ? '#1affa0' : '#4ea8ff', lineHeight: 1 }}>
                    {myScore.toFixed(1)}
                  </div>
                  {hasLive && myLive !== myProj && (
                    <div style={{ fontSize: 9, fontFamily: 'var(--font-mono)', color: 'var(--text-faint)', marginTop: 2 }}>
                      LIVE
                    </div>
                  )}
                </div>
              </div>

              {/* VS + diff */}
              <div style={{ padding: '0 20px', textAlign: 'center', flexShrink: 0 }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-faint)', marginBottom: 4 }}>vs</div>
                <div style={{
                  fontSize: 13, fontWeight: 900, color: winColor,
                  background: isWinning ? 'rgba(76,175,130,.15)' : 'rgba(255,90,110,.15)',
                  border: `1px solid ${isWinning ? 'rgba(76,175,130,.3)' : 'rgba(255,90,110,.3)'}`,
                  borderRadius: 6, padding: '2px 8px', fontFamily: 'var(--font-mono)',
                }}>
                  {diff >= 0 ? '+' : ''}{diff.toFixed(1)}
                </div>
                <div style={{ fontSize: 9, color: 'var(--text-faint)', marginTop: 4 }}>{winPct}% win</div>
              </div>

              {/* Opponent */}
              <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 10, flexDirection: 'row-reverse' }}>
                {opp.logoImg ? (
                  <img src={opp.logoImg} alt="" style={{ width: 36, height: 36, borderRadius: 8, objectFit: 'cover', flexShrink: 0 }} />
                ) : (
                  <span style={{ width: 36, height: 36, borderRadius: 8, background: opp.color || '#555', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, fontWeight: 900, flexShrink: 0 }}>
                    {opp.logo || '??'}
                  </span>
                )}
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text)' }}>{opp.name}</div>
                  <div style={{ fontSize: 9, color: 'var(--text-faint)' }}>{oppStarters.length} starters</div>
                </div>
                <div style={{ fontFamily: 'var(--font-display)', fontWeight: 900, fontStretch: '75%', fontSize: 32, color: hasLive ? '#1affa0' : '#4ea8ff', lineHeight: 1, marginRight: 'auto' }}>
                  {oppScore.toFixed(1)}
                </div>
              </div>

              {/* Nav button */}
              <button
                className="btn ghost sm"
                onClick={() => onNav('h2h')}
                style={{ marginLeft: 16, flexShrink: 0, fontSize: 11 }}
              >
                Full H2H →
              </button>
            </div>
          </div>
        );
      })()}

      {/* ── Weekly Recap Banner ─────────────────────────────────────────────── */}
      <WeeklyRecapBanner
        h2hWinData={h2hWinData}
        starters={starters}
        weekLabel={weekLabel}
        teamName={teamName}
      />

      <div style={{ padding: isMobile ? '12px 14px' : 24, display: 'grid', gridTemplateColumns: isMobile ? 'repeat(2, 1fr)' : 'repeat(4, 1fr)', gap: isMobile ? 8 : 12, flexShrink: 0 }}>
        <div className="stat">
          <div className="k">Starters Projected</div>
          <div className="v" style={{ color: '#4ea8ff' }}>{totalProj.toFixed(1)}</div>
          <div className="sub">{weekLabel} · {starters.length} of 8 slots</div>
        </div>
        {h2hWinData ? (
          <div className="stat">
            <div className="k">Win Probability</div>
            <div className="v" style={{ color: h2hWinData.isWinning ? 'var(--good)' : 'var(--danger)' }}>{h2hWinData.winPct}%</div>
            <div className="sub" style={{ color: 'var(--text-faint)' }}>
              <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, color: h2hWinData.isWinning ? 'var(--good)' : 'var(--text)' }}>{h2hWinData.myScore.toFixed(1)}</span>
              {' – '}
              <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, color: !h2hWinData.isWinning ? 'var(--danger)' : 'var(--text-dim)' }}>{h2hWinData.oppScore.toFixed(1)}</span>
              {' vs '}{h2hWinData.opp.name}
            </div>
          </div>
        ) : (
          <div className="stat"><div className="k">Win Probability</div><div className="v">—</div><div className="sub">No matchup</div></div>
        )}
        <div className="stat"><div className="k">Season Avg</div><div className="v">128.5</div><div className="sub">2nd in league</div></div>
        <div className="stat"><div className="k">Playoff Odds</div><div className="v">84.2%</div><div className="sub">Top seed: 21.8%</div></div>
      </div>

      {/* ── League Standings + Commish + Transactions + Champions Corner ── */}
      {isMobile && (
        <div style={{ flexShrink: 0, background: 'var(--bg-2)', borderBottom: '1px solid var(--border)', position: 'sticky', top: 0, zIndex: 10 }}>
          <div style={{ display: 'flex', overflowX: 'auto', scrollbarWidth: 'none' }}>
            {[
              { id: 'standings',    label: 'Standings', icon: '🏆' },
              { id: 'commish',      label: 'Commish',   icon: '📢' },
              { id: 'transactions', label: 'Moves',     icon: '↔' },
              { id: 'events',       label: 'Events',    icon: '📅' },
              { id: 'champions',    label: 'Champions', icon: '🥇' },
            ].map(t => (
              <button key={t.id} onClick={() => setDashTab(t.id)} style={{
                flex: '0 0 auto',
                padding: '10px 16px 8px',
                fontSize: 12, fontWeight: dashTab === t.id ? 700 : 500,
                border: 'none',
                borderBottom: `2px solid ${dashTab === t.id ? 'var(--accent)' : 'transparent'}`,
                background: 'transparent',
                color: dashTab === t.id ? 'var(--accent)' : 'var(--text-dim)',
                cursor: 'pointer', whiteSpace: 'nowrap',
                display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2,
              }}>
                <span style={{ fontSize: 16 }}>{t.icon}</span>
                <span>{t.label}</span>
              </button>
            ))}
          </div>
        </div>
      )}
      <div style={{ padding: isMobile ? '0 14px 24px' : '0 24px 24px', display: isMobile ? 'block' : 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gridTemplateRows: isMobile ? undefined : '1fr', gap: 16, alignItems: 'stretch', flex: isMobile ? undefined : 1, minHeight: isMobile ? undefined : 0 }}>
        {(!isMobile || dashTab === 'standings') && <div className="card" style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden', marginBottom: isMobile ? 0 : undefined }}>
          <div className="card-head" style={{ flexShrink: 0 }}>
            <div className="card-title">League Standings · {weekLabel}</div>
            <span className="mono faint" style={{ fontSize: 10 }}>{standings ? 'CBS · live' : 'mock data'}</span>
          </div>
          <div style={{ flex: 1, overflowY: 'auto' }}>
          <table className="data-table">
            <thead>
              <tr><th style={{ width: 32 }}>#</th><th>Team</th><th className="num">W</th><th className="num">L</th><th className="num">PF</th><th className="num">PA</th><th className="num" title="Power Ranking — weighted by points scored (60%) and win % (40%)">PR</th></tr>
            </thead>
            <tbody>
              {(sortedStandings || LEAGUE_TEAMS.map(t => { const lt = findTeam(t.id); return { ...t, ...lt, w: 0, l: 0, pf: 0, pa: 0 }; })).map((row, i) => (
                <tr key={row.id || i} style={row.me ? { background: 'rgba(198,255,58,.04)' } : {}}>
                  <td className="mono dim" style={{ fontSize: 12 }}>{i + 1}</td>
                  <td>
                    <div className="flex gap-8" style={{ alignItems: 'center' }}>
                      {row.logoImg
                        ? <img src={row.logoImg} alt={row.logo} style={{ width: 22, height: 22, borderRadius: 5, objectFit: 'cover', flexShrink: 0 }} />
                        : <span className="logo" style={{ background: row.color, width: 22, height: 22, fontSize: 8 }}>{row.logo}</span>
                      }
                      <span style={row.me ? { color: 'var(--accent)', fontWeight: 700 } : {}}>{row.name}</span>
                      {row.me && <span className="mono faint" style={{ fontSize: 9 }}>YOU</span>}
                    </div>
                  </td>
                  <td className="num mono" style={{ fontWeight: 700 }}>{row.w}</td>
                  <td className="num mono dim">{row.l}</td>
                  <td className="num mono">{typeof row.pf === 'number' && row.pf > 0 ? row.pf.toFixed(1) : '—'}</td>
                  <td className="num mono dim">{typeof row.pa === 'number' && row.pa > 0 ? row.pa.toFixed(1) : '—'}</td>
                  {(() => {
                    const pr = powerRankMap.get(row.id);
                    return (
                      <td className="num" style={{ fontWeight: 700, fontSize: 12, fontFamily: 'var(--font-mono)',
                        color: !pr ? 'var(--text-faint)'
                          : pr <= 3 ? '#4ed87b'
                          : pr <= 6 ? 'var(--text)'
                          : pr <= 8 ? '#f5a623'
                          : '#ff5a6e',
                      }}>
                        {pr === 1 ? '💪' : pr === totalTeams ? '💩' : (pr ?? '—')}
                      </td>
                    );
                  })()}
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        </div>}

        {/* ── Col 2: Commissioner Message + Transactions ── */}
        {(!isMobile || dashTab === 'commish' || dashTab === 'transactions') && <div style={{ display: 'flex', flexDirection: 'column', gap: 12, height: '100%' }}>

        {/* Commissioner Message */}
        {(!isMobile || dashTab === 'commish') && <div className="card" style={{ borderLeft: '3px solid var(--accent)', flexShrink: 0, minHeight: 280 }}>
          <div className="card-head" style={{ paddingBottom: 6 }}>
            <div className="card-title" style={{ fontSize: 12 }}>
              <span style={{ marginRight: 6 }}>📢</span>Commissioner Message
            </div>
            {canEditCommish && !editingCommish && (
              <button className="btn ghost sm" style={{ fontSize: 10, padding: '2px 8px' }} onClick={startEditCommish}>Edit</button>
            )}
          </div>
          {editingCommish ? (
            <div style={{ padding: '0 16px 14px', display: 'flex', flexDirection: 'column', gap: 8 }}>
              {commishMediaDraft?.url && (
                <div style={{ position: 'relative' }}>
                  {commishMediaDraft.type === 'image'
                    ? <img src={commishMediaDraft.url} alt="" style={{ width: '100%', maxHeight: 160, objectFit: 'cover', borderRadius: 6, display: 'block' }} />
                    : <video src={commishMediaDraft.url} controls autoPlay={false} style={{ width: '100%', maxHeight: 140, borderRadius: 6, display: 'block' }} />
                  }
                  <button onClick={() => setCommishMediaDraft(null)} style={{ position: 'absolute', top: 5, right: 5, background: 'rgba(0,0,0,.7)', border: 'none', borderRadius: 4, color: '#fff', fontSize: 11, padding: '2px 7px', cursor: 'pointer' }}>✕ Remove</button>
                </div>
              )}
              <textarea className="input" rows={4} value={commishTextDraft} onChange={e => setCommishTextDraft(e.target.value)} style={{ resize: 'vertical', fontSize: 12, lineHeight: 1.6, width: '100%', boxSizing: 'border-box' }} placeholder="Type your commissioner message…" />
              <input className="input" placeholder="YouTube / Vimeo URL (optional)…" value={commishUrlDraft} onChange={e => setCommishUrlDraft(e.target.value)} style={{ fontSize: 12 }} />
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                <input ref={commishMediaRef} type="file" accept="image/*,video/*" style={{ display: 'none' }} onChange={handleCommishMediaUpload} />
                <button className="btn ghost sm" onClick={() => commishMediaRef.current?.click()} style={{ fontSize: 11 }}>📷 {commishMediaDraft?.url ? 'Replace File' : 'Upload Image / Video'}</button>
                <button className="btn primary sm" onClick={saveCommishMessage}>Save</button>
                <button className="btn ghost sm" onClick={() => setEditingCommish(false)}>Cancel</button>
                <div style={{ flex: 1 }} />
                <button
                  className="btn sm"
                  style={{ background: 'rgba(255,180,0,.12)', border: '1px solid rgba(255,180,0,.35)', color: 'rgba(255,180,0,.9)', fontWeight: 700, fontSize: 11 }}
                  onClick={() => { setPushTitle(''); setPushBody(''); setPushResult(null); setPushModal(true); }}
                >📣 Push Alert</button>
              </div>
            </div>
          ) : (
            <>
              {commishData.media?.url && (
                <div style={{ padding: '0 16px 8px' }}>
                  {commishData.media.type === 'image'
                    ? <img src={commishData.media.url} alt="Commissioner media" style={{ width: '100%', maxHeight: 200, objectFit: 'cover', borderRadius: 6, display: 'block' }} />
                    : <video src={commishData.media.url} controls autoPlay={false} style={{ width: '100%', maxHeight: 180, borderRadius: 6, display: 'block' }} />
                  }
                </div>
              )}
              {commishData.media?.videoUrl && (
                <div style={{ padding: '0 16px 8px' }}>
                  <iframe src={getCommishEmbedUrl(commishData.media.videoUrl)} style={{ width: '100%', height: 180, borderRadius: 6, border: 'none', display: 'block' }} allow="accelerometer; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowFullScreen title="Commissioner Video" />
                </div>
              )}
              {commishData.text && (
                <div style={{ padding: '4px 16px 14px', fontSize: 12, color: 'var(--text-dim)', lineHeight: 1.65 }}>{commishData.text}</div>
              )}
            </>
          )}
        </div>}

        {/* Transactions */}
        {(!isMobile || dashTab === 'transactions') && <div className="card" style={{ width: '100%', boxSizing: 'border-box', flex: '0 1 615px', minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <div className="card-head" style={{ flexShrink: 0 }}>
            <div className="card-title">Transactions</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginLeft: 'auto' }}>
              {waiverPosition != null && (
                <span style={{ fontSize: 11, fontFamily: 'var(--font-mono)', fontWeight: 700, background: 'rgba(234,179,8,.14)', border: '1px solid rgba(234,179,8,.4)', borderRadius: 5, padding: '2px 8px', color: '#facc15' }}>
                  WVR Pick #{waiverPosition} of {totalTeams}
                </span>
              )}
              {txLoading && <span className="mono faint" style={{ fontSize: 9 }}>fetching…</span>}
            </div>
          </div>
          {/* Team filter chips */}
          {!txLoading && transactions.length > 0 && (() => {
            const teams = [...new Set(transactions.map(tx => tx.teamName).filter(Boolean))];
            if (teams.length < 2) return null;
            return (
              <div style={{ padding: '5px 10px 6px', borderBottom: '1px solid var(--border)', display: 'flex', gap: 4, overflowX: 'auto', flexShrink: 0 }}>
                <button
                  onClick={() => setTxTeamFilter(null)}
                  style={{ fontSize: 10, padding: '2px 8px', borderRadius: 10, border: `1px solid ${txTeamFilter === null ? 'var(--accent)' : 'var(--border)'}`, background: txTeamFilter === null ? 'rgba(198,255,58,.14)' : 'transparent', color: txTeamFilter === null ? 'var(--accent)' : 'var(--text-faint)', cursor: 'pointer', whiteSpace: 'nowrap', fontWeight: txTeamFilter === null ? 700 : 400, flexShrink: 0 }}
                >All</button>
                {teams.map(name => (
                  <button
                    key={name}
                    onClick={() => setTxTeamFilter(n => n === name ? null : name)}
                    style={{ fontSize: 10, padding: '2px 8px', borderRadius: 10, border: `1px solid ${txTeamFilter === name ? 'var(--accent)' : 'var(--border)'}`, background: txTeamFilter === name ? 'rgba(198,255,58,.14)' : 'transparent', color: txTeamFilter === name ? 'var(--accent)' : 'var(--text-faint)', cursor: 'pointer', whiteSpace: 'nowrap', fontWeight: txTeamFilter === name ? 700 : 400, flexShrink: 0 }}
                  >{name}</button>
                ))}
              </div>
            );
          })()}
          <div style={{ flex: 1, overflowY: 'auto' }}>
          {txLoading ? (
            <div style={{ padding: '14px 16px', fontSize: 12, color: 'var(--text-faint)', display: 'flex', alignItems: 'center', gap: 8 }}>
              <div className="ai-orb" style={{ width: 12, height: 12 }} />Loading transactions…
            </div>
          ) : transactions.length === 0 ? (
            <div style={{ padding: '12px 14px', fontSize: 12, color: 'var(--text-faint)' }}>No transactions yet — adds, drops, and trades will appear here.</div>
          ) : (
            <div>
              {transactions.filter(tx => !txTeamFilter || tx.teamName === txTeamFilter).map((tx, idx) => {
                const isTrade   = tx.type === 'trade' || tx.type === 'trade_offer';
                const typeLabel = isTrade ? (tx.type === 'trade_offer' ? 'Offer' : 'Trade') : tx.type === 'drop' ? 'Drop' : 'Add';
                const typeColor = isTrade ? '#c6ff3a' : tx.type === 'drop' ? 'var(--danger)' : 'var(--good)';
                const diff = Date.now() - new Date(tx.date || tx.timestamp || 0).getTime();
                const ago  = diff < 3600000 ? `${Math.round(diff / 60000)}m ago` : diff < 86400000 ? `${Math.round(diff / 3600000)}h ago` : `${Math.round(diff / 86400000)}d ago`;
                const PlayerLine = ({ p, action }) => (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 2 }}>
                    <span style={{ color: action === 'add' ? 'var(--good)' : 'var(--danger)', fontWeight: 700, fontSize: 10, minWidth: 10 }}>{action === 'add' ? '+' : '−'}</span>
                    <span style={{ fontWeight: 600, color: action === 'add' ? 'var(--text)' : 'var(--text-dim)' }}>{p.name || '—'}</span>
                    {p.pos && <span style={{ fontSize: 9, color: 'var(--accent-2)', fontFamily: 'var(--font-mono)' }}>{p.pos}</span>}
                    {p.nflTeam && <span style={{ fontSize: 9, color: 'var(--text-faint)', fontFamily: 'var(--font-mono)' }}>{p.nflTeam}</span>}
                  </div>
                );
                if (isTrade) return (
                  <div key={tx.id || idx} style={{ padding: '9px 14px', borderBottom: '1px solid var(--border)', borderLeft: `2px solid ${typeColor}` }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 5 }}>
                      <span style={{ fontSize: 9, fontFamily: 'var(--font-mono)', fontWeight: 700, color: typeColor, background: `${typeColor}18`, border: `1px solid ${typeColor}44`, borderRadius: 3, padding: '1px 5px' }}>{typeLabel.toUpperCase()}</span>
                      <span style={{ fontSize: 10, color: 'var(--text-faint)', fontFamily: 'var(--font-mono)' }}>{ago}</span>
                    </div>
                    <div style={{ marginBottom: 5 }}>
                      <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-dim)', marginBottom: 2 }}>{tx.teamName || tx.teamId}</div>
                      {(tx.got  || []).map((p, i) => <PlayerLine key={i} p={p} action="add" />)}
                      {(tx.gave || []).map((p, i) => <PlayerLine key={i} p={p} action="drop" />)}
                    </div>
                    {tx.otherTeamName && (
                      <div>
                        <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-dim)', marginBottom: 2 }}>{tx.otherTeamName}</div>
                        {(tx.gave || []).map((p, i) => <PlayerLine key={i} p={p} action="add" />)}
                        {(tx.got  || []).map((p, i) => <PlayerLine key={i} p={p} action="drop" />)}
                      </div>
                    )}
                  </div>
                );
                const players = tx.players || [];
                const isMyAdd = tx.type === 'add' && (tx.teamId === user?.teamId || tx.teamName === user?.teamName);
                const wvrBefore = tx.waiverPick ?? (isMyAdd ? waiverPosition : null);
                const wvrAfter  = tx.newWaiverPick ?? (isMyAdd && wvrBefore != null ? totalTeams : null);
                return (
                  <div key={tx.id || idx} style={{ padding: '8px 14px', borderBottom: '1px solid var(--border)', borderLeft: `2px solid ${typeColor}` }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span style={{ fontSize: 9, fontFamily: 'var(--font-mono)', fontWeight: 700, color: typeColor, background: `${typeColor}18`, border: `1px solid ${typeColor}44`, borderRadius: 3, padding: '1px 5px' }}>{typeLabel.toUpperCase()}</span>
                        {wvrBefore != null && (
                          <span style={{ fontSize: 9, fontFamily: 'var(--font-mono)', fontWeight: 700, color: '#facc15', background: 'rgba(234,179,8,.12)', border: '1px solid rgba(234,179,8,.35)', borderRadius: 3, padding: '1px 5px' }}>
                            WVR #{wvrBefore}{wvrAfter != null ? ` → #${wvrAfter}` : ''}
                          </span>
                        )}
                      </div>
                      <span style={{ fontSize: 10, color: 'var(--text-faint)', fontFamily: 'var(--font-mono)' }}>{ago}</span>
                    </div>
                    {tx.teamName && <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-dim)', marginBottom: 3 }}>{tx.teamName}</div>}
                    {players.map((p, i) => <PlayerLine key={i} p={p} action={p.action || tx.type} />)}
                  </div>
                );
              })}
            </div>
          )}
          </div>{/* end scroll wrapper */}
        </div>}

        </div>}{/* end col 2 */}

        {/* ── Col 3: Weekly Events ── */}
        {(!isMobile || dashTab === 'events') && <WeeklyCalendar weekLabel={weekLabel} waiverPosition={waiverPosition} totalTeams={totalTeams} user={user} currentWeek={currentWeek} onNav={onNav} />}

        {/* ── Col 4: Champions Corner ── */}
        {(!isMobile || dashTab === 'champions') && <div style={{
          background: 'linear-gradient(135deg, rgba(255,215,0,.07) 0%, rgba(255,215,0,.02) 100%)',
          border: '1px solid rgba(255,215,0,.22)',
          borderRadius: 10,
          overflow: 'hidden',
          width: '100%',
          height: '100%',
          boxSizing: 'border-box',
        }}>
          {/* Header / toggle bar */}
          <div
            style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px', cursor: 'pointer', userSelect: 'none' }}
            onClick={() => { if (!editingChampions) setChampionsOpen(o => !o); }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
              <span style={{ fontSize: 14 }}>🏆</span>
              <span style={{ fontWeight: 900, fontSize: 11, color: '#FFD700', letterSpacing: '.07em', textTransform: 'uppercase' }}>Champions Corner</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              {canEditChampions && championsOpen && !editingChampions && (
                <button
                  className="btn ghost sm"
                  style={{ fontSize: 10, padding: '2px 8px', borderColor: 'rgba(255,215,0,.3)', color: 'rgba(255,215,0,.7)' }}
                  onClick={e => { e.stopPropagation(); startEditChampions(); }}
                >Edit</button>
              )}
              <span style={{ fontSize: 11, color: 'rgba(255,215,0,.5)', marginLeft: 2 }}>{championsOpen ? '▲' : '▼'}</span>
            </div>
          </div>

          {/* Collapsed: show most recent champion */}
          {!championsOpen && (
            <div style={{ padding: '0 14px 10px', display: 'flex', alignItems: 'center', gap: 8 }}>
              {(() => {
                const latest = [...champions].reverse().find(c => c.champion);
                return latest ? (
                  <>
                    {latest.photo && (
                      <img src={latest.photo} alt={latest.champion} style={{ width: 28, height: 28, borderRadius: 4, objectFit: 'cover', border: '1px solid rgba(255,215,0,.4)', flexShrink: 0 }} />
                    )}
                    <span style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'rgba(255,215,0,.5)' }}>{latest.year}</span>
                    <span style={{ fontSize: 14, fontWeight: 800, color: '#FFD700' }}>{latest.champion}{latest.asterisk ? '*' : ''}</span>
                  </>
                ) : (
                  <span style={{ fontSize: 11, color: 'rgba(255,255,255,.2)', fontFamily: 'var(--font-mono)' }}>No data yet</span>
                );
              })()}
              <span style={{ fontSize: 10, color: 'rgba(255,215,0,.35)', fontFamily: 'var(--font-mono)', marginLeft: 'auto' }}>Click to expand</span>
            </div>
          )}

          {/* Expanded */}
          {championsOpen && (
            <>
            <div style={{ borderTop: '1px solid rgba(255,215,0,.12)', padding: '10px 14px' }}>
              {editingChampions ? (
                <div>
                  <input ref={champPhotoRef} type="file" accept="image/*" style={{ display: 'none' }}
                    onChange={e => { handleChampPhoto(e, champPhotoIdx); setChampPhotoIdx(null); }}
                  />
                  {champDraft.map((c, i) => (
                    <div key={c.year} style={{ marginBottom: 8 }}>
                      <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr auto', gap: 6, alignItems: 'center' }}>
                        <span style={{ fontSize: 11, fontFamily: 'var(--font-mono)', fontWeight: 800, color: '#FFD700', minWidth: 38 }}>{c.year}</span>
                        <input
                          className="input"
                          value={c.champion}
                          onChange={e => updateDraft(i, { champion: e.target.value })}
                          placeholder="Team name…"
                          style={{ fontSize: 11, padding: '3px 7px', background: 'rgba(255,215,0,.05)', borderColor: 'rgba(255,215,0,.2)' }}
                        />
                        <label style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer', fontSize: 11, color: 'rgba(255,215,0,.6)', whiteSpace: 'nowrap' }}
                          title={c.asterisk ? c.note || 'Add a note below' : 'Mark as contested/asterisk'}>
                          <input
                            type="checkbox"
                            checked={c.asterisk}
                            onChange={e => updateDraft(i, { asterisk: e.target.checked, note: e.target.checked ? (champDraft[i]?.note || '') : '' })}
                            style={{ accentColor: '#FFD700', cursor: 'pointer' }}
                          />
                          *
                        </label>
                      </div>
                      {c.asterisk && (
                        <input
                          className="input"
                          value={c.note}
                          onChange={e => updateDraft(i, { note: e.target.value })}
                          placeholder="Reason for asterisk…"
                          style={{ marginTop: 4, fontSize: 10, padding: '2px 7px', background: 'rgba(255,215,0,.04)', borderColor: 'rgba(255,215,0,.15)', width: '100%', boxSizing: 'border-box' }}
                        />
                      )}
                      {c.champion && (
                        <div style={{ marginTop: 4, display: 'flex', alignItems: 'center', gap: 6 }}>
                          {c.photo && (
                            <img src={c.photo} alt={c.champion} style={{ width: 36, height: 36, borderRadius: 4, objectFit: 'cover', border: '1px solid rgba(255,215,0,.3)' }} />
                          )}
                          <button
                            className="btn ghost sm"
                            onClick={() => { setChampPhotoIdx(i); champPhotoRef.current?.click(); }}
                            style={{ fontSize: 10, padding: '2px 8px', borderColor: 'rgba(255,215,0,.3)', color: 'rgba(255,215,0,.7)' }}
                          >
                            {c.photo ? '📷 Replace Photo' : '📷 Add Photo'}
                          </button>
                          {c.photo && (
                            <button
                              className="btn ghost sm"
                              onClick={() => updateDraft(i, { photo: null })}
                              style={{ fontSize: 10, padding: '2px 8px', borderColor: 'rgba(255,100,100,.3)', color: 'rgba(255,100,100,.7)' }}
                            >Remove</button>
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                  <div style={{ display: 'flex', gap: 6, marginTop: 10 }}>
                    <button className="btn primary sm" onClick={saveChampions}>Save</button>
                    <button className="btn ghost sm" style={{ borderColor: 'rgba(255,215,0,.3)', color: 'rgba(255,215,0,.6)' }} onClick={() => setEditingChampions(false)}>Cancel</button>
                  </div>
                </div>
              ) : (
                (() => {
                  const featuredChamp = [...champions].reverse().find(c => c.champion && c.photo);
                  return (
                    <div style={{ display: 'flex', gap: 12, alignItems: 'stretch' }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        {champions.map((c, i) => {
                          const hasNote = c.asterisk && c.note;
                          return (
                            <div
                              key={c.year}
                              style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0', borderBottom: i < champions.length - 1 ? '1px solid rgba(255,215,0,.07)' : 'none', position: 'relative' }}
                              onMouseEnter={() => hasNote && setChampTooltip(c.year)}
                              onMouseLeave={() => setChampTooltip(null)}
                            >
                              {c.photo && (!featuredChamp || c.year !== featuredChamp.year) && (
                                <img src={c.photo} alt={c.champion} style={{ width: 26, height: 26, borderRadius: 4, objectFit: 'cover', border: '1px solid rgba(255,215,0,.35)', flexShrink: 0 }} />
                              )}
                              <span style={{ fontSize: 14, fontFamily: 'var(--font-mono)', color: 'rgba(255,215,0,.5)', fontWeight: 700, minWidth: 42 }}>{c.year}</span>
                              {c.champion ? (
                                <span style={{ fontSize: 14, fontWeight: 700, color: '#FFD700', flex: 1 }}>
                                  {c.champion}
                                  {c.asterisk && <span style={{ fontSize: 10, color: 'rgba(255,215,0,.55)', marginLeft: 1, cursor: hasNote ? 'help' : 'default' }}>*</span>}
                                </span>
                              ) : (
                                <span style={{ flex: 1, fontSize: 11, color: 'rgba(255,255,255,.15)', fontFamily: 'var(--font-mono)' }}>—</span>
                              )}
                              {champTooltip === c.year && hasNote && (
                                <div style={{
                                  position: 'absolute', bottom: '110%', left: 0, zIndex: 50,
                                  background: 'var(--card)', border: '1px solid rgba(255,215,0,.35)',
                                  borderRadius: 6, padding: '5px 10px', whiteSpace: 'nowrap',
                                  fontSize: 14, color: 'var(--text-dim)', boxShadow: '0 4px 16px rgba(0,0,0,.5)',
                                  pointerEvents: 'none',
                                }}>
                                  <span style={{ color: '#FFD700', fontWeight: 700, marginRight: 4 }}>*</span>{c.note}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                      {featuredChamp && (
                        <div style={{ width: 180, flexShrink: 0, borderRadius: 8, overflow: 'hidden', border: '2px solid rgba(255,215,0,.45)', position: 'relative' }}>
                          <img
                            src={featuredChamp.photo}
                            alt={featuredChamp.champion}
                            style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                          />
                          <div style={{
                            position: 'absolute', bottom: 0, left: 0, right: 0,
                            background: 'linear-gradient(transparent, rgba(0,0,0,.88))',
                            padding: '22px 8px 8px',
                            textAlign: 'center',
                          }}>
                            <div style={{ fontSize: 9, fontFamily: 'var(--font-mono)', color: 'rgba(255,215,0,.7)', fontWeight: 700, letterSpacing: '.08em', marginBottom: 2 }}>
                              {featuredChamp.year} CHAMPION
                            </div>
                            <div style={{ fontSize: 14, fontWeight: 800, color: '#FFD700', lineHeight: 1.2 }}>
                              {featuredChamp.champion}
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })()
              )}
            </div>

            {/* ── Champions Comments ── */}
            {!editingChampions && (
              <div style={{ borderTop: '1px solid rgba(255,215,0,.12)', padding: '10px 14px 14px' }}>
                <div style={{ fontSize: 9, fontFamily: 'var(--font-mono)', fontWeight: 700, color: 'rgba(255,215,0,.55)', textTransform: 'uppercase', letterSpacing: '.1em', marginBottom: 9 }}>
                  💬 Comments
                </div>
                <div style={{ position: 'relative', marginBottom: 10 }}>
                  <textarea
                    ref={champTextareaRef}
                    className="input"
                    value={champCommentText}
                    onChange={e => setChampCommentText(e.target.value)}
                    placeholder="Leave a comment… (emojis welcome!)"
                    rows={2}
                    style={{ width: '100%', boxSizing: 'border-box', resize: 'none', fontSize: 11, background: 'rgba(255,215,0,.04)', borderColor: 'rgba(255,215,0,.15)', lineHeight: 1.5 }}
                    onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) addChampComment(); }}
                    onFocus={() => setShowEmojiPicker(false)}
                  />
                  {/* Emoji picker popup */}
                  {showEmojiPicker && (
                    <div style={{
                      position: 'absolute', top: '100%', left: 0, zIndex: 100, marginTop: 4,
                      background: 'var(--card)', border: '1px solid rgba(255,215,0,.3)', borderRadius: 8,
                      padding: 8, boxShadow: '0 6px 24px rgba(0,0,0,.5)', width: 240,
                    }}>
                      {[
                        ['😂','😭','🔥','💀','🏆','👑','💯','🎉','😤','🤣'],
                        ['😎','🙏','👀','💪','🤡','🥶','😬','🤦','🎯','⚡'],
                        ['🏈','🦅','🐻','🐅','🦁','🐆','🐝','🦅','🐺','🦊'],
                        ['📉','📈','💸','🚀','💣','🧠','🎲','🃏','⏰','🔔'],
                      ].map((row, ri) => (
                        <div key={ri} style={{ display: 'flex', gap: 2, marginBottom: 2 }}>
                          {row.map(em => (
                            <button key={em} onClick={() => insertEmoji(em)}
                              style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 18, padding: '2px 3px', borderRadius: 4, lineHeight: 1 }}
                              title={em}
                            >{em}</button>
                          ))}
                        </div>
                      ))}
                    </div>
                  )}
                  {/* GIF URL input */}
                  {showGifInput && (
                    <div style={{ marginTop: 6, display: 'flex', gap: 6, alignItems: 'center' }}>
                      <input
                        className="input"
                        value={champCommentGifUrl}
                        onChange={e => setChampCommentGifUrl(e.target.value)}
                        placeholder="Paste GIF URL (Tenor, Giphy, direct .gif)…"
                        style={{ flex: 1, fontSize: 10, padding: '3px 8px', background: 'rgba(255,215,0,.04)', borderColor: 'rgba(255,215,0,.2)' }}
                      />
                      {champCommentGifUrl && (
                        <button onClick={() => setChampCommentGifUrl('')} style={{ background: 'none', border: 'none', color: 'rgba(255,100,100,.6)', cursor: 'pointer', fontSize: 14, padding: 0 }}>✕</button>
                      )}
                    </div>
                  )}
                  {/* GIF preview */}
                  {champCommentGifUrl.trim() && (
                    <img src={champCommentGifUrl.trim()} alt="GIF preview" style={{ marginTop: 6, maxWidth: '100%', maxHeight: 120, borderRadius: 6, border: '1px solid rgba(255,215,0,.25)', display: 'block' }} />
                  )}
                  <div style={{ display: 'flex', gap: 6, marginTop: 6, alignItems: 'center' }}>
                    <button
                      onClick={() => { setShowEmojiPicker(p => !p); setShowGifInput(false); }}
                      style={{ background: 'none', border: '1px solid rgba(255,215,0,.2)', borderRadius: 5, padding: '3px 8px', cursor: 'pointer', fontSize: 13, color: 'rgba(255,215,0,.7)', lineHeight: 1 }}
                      title="Emoji picker"
                    >😊</button>
                    <button
                      onClick={() => { setShowGifInput(p => !p); setShowEmojiPicker(false); }}
                      style={{ background: showGifInput ? 'rgba(255,215,0,.12)' : 'none', border: '1px solid rgba(255,215,0,.2)', borderRadius: 5, padding: '3px 8px', cursor: 'pointer', fontSize: 10, fontWeight: 700, color: 'rgba(255,215,0,.7)', fontFamily: 'var(--font-mono)' }}
                      title="Attach GIF"
                    >GIF</button>
                    <button
                      onClick={addChampComment}
                      disabled={!champCommentText.trim() && !champCommentGifUrl.trim()}
                      style={{ marginLeft: 'auto', padding: '5px 14px', fontSize: 11, fontWeight: 700, cursor: 'pointer', border: '1px solid rgba(255,215,0,.35)', borderRadius: 6, background: 'rgba(255,215,0,.1)', color: '#FFD700', opacity: (champCommentText.trim() || champCommentGifUrl.trim()) ? 1 : 0.4 }}
                    >Post</button>
                  </div>
                </div>
                {champComments.length === 0 ? (
                  <div style={{ fontSize: 11, color: 'rgba(255,255,255,.18)', fontFamily: 'var(--font-mono)' }}>No comments yet — be the first!</div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
                    {champComments.map(c => {
                      const diff = Date.now() - new Date(c.timestamp).getTime();
                      const ago = diff < 3600000 ? `${Math.round(diff / 60000)}m ago`
                                : diff < 86400000 ? `${Math.round(diff / 3600000)}h ago`
                                : `${Math.round(diff / 86400000)}d ago`;
                      const canDel = canEditChampions || c.teamId === user?.teamId;
                      return (
                        <div key={c.id} style={{ padding: '8px 10px', background: 'rgba(255,215,0,.04)', border: '1px solid rgba(255,215,0,.1)', borderRadius: 7 }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                            <span style={{ fontSize: 10, fontWeight: 700, color: 'rgba(255,215,0,.8)', fontFamily: 'var(--font-mono)' }}>{c.teamName}</span>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                              <span style={{ fontSize: 9, color: 'rgba(255,255,255,.25)', fontFamily: 'var(--font-mono)' }}>{ago}</span>
                              {canDel && (
                                <button style={{ background: 'none', border: 'none', color: 'rgba(255,100,100,.45)', cursor: 'pointer', fontSize: 11, padding: 0, lineHeight: 1 }} onClick={() => deleteChampComment(c.id)}>✕</button>
                              )}
                            </div>
                          </div>
                          {c.text && <div style={{ fontSize: 12, color: 'var(--text-dim)', lineHeight: 1.55 }}>{c.text}</div>}
                          {c.gifUrl && (
                            <img
                              src={c.gifUrl}
                              alt="gif"
                              style={{ marginTop: c.text ? 6 : 0, maxWidth: '100%', maxHeight: 180, borderRadius: 6, display: 'block', border: '1px solid rgba(255,215,0,.15)' }}
                              loading="lazy"
                            />
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
            </>
          )}
        </div>}{/* end col 4 / Champions Corner */}
      </div>



      {/* ── Breakout Candidates (mobile only — desktop is viewport-fit) ── */}
      {mobileScoringOpen && (
        <MobileScoringPopup
          onClose={() => setMobileScoringOpen(false)}
          myTeamId={teamId}
          week={currentWeek.num || null}
          espnGameMap={espnGameMap}
          espnPlayerActuals={espnPlayerActuals}
        />
      )}

      {isMobile && Array.isArray(r2Breakouts) && r2Breakouts.length > 0 && (
        <div style={{ padding: '0 14px 16px' }}>
          <div className="card" style={{ borderLeft: '3px solid #c6ff3a' }}>
            <div className="card-head">
              <div className="card-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 14 }}>↑</span> Breakout Candidates
                <span style={{ fontSize: 9, fontFamily: 'var(--font-mono)', fontWeight: 700, color: '#c6ff3a', background: 'rgba(198,255,58,.12)', border: '1px solid rgba(198,255,58,.35)', borderRadius: 3, padding: '1px 6px' }}>
                  FANTASAI ML · AUC 0.728
                </span>
              </div>
              <span className="mono faint" style={{ fontSize: 10 }}>Snap share + opportunity model · top {Math.min(r2Breakouts.length, 10)}</span>
            </div>
            <div style={{ overflowX: 'auto' }}>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Player</th>
                    <th>Pos</th>
                    <th>Team</th>
                    <th className="num">Snap Δ</th>
                    <th className="num">Opp Score</th>
                    <th className="num">Avg Snap%</th>
                    <th className="num">Wk</th>
                  </tr>
                </thead>
                <tbody>
                  {r2Breakouts.slice(0, 10).map((b, i) => {
                    const snapDelta = typeof b.snap_share_delta === 'number' ? b.snap_share_delta : 0;
                    const oppScore  = typeof b.opportunity_score === 'number' ? b.opportunity_score : 0;
                    const avgSnap   = typeof b.avg_snap_share === 'number' ? b.avg_snap_share
                                    : typeof b.avg_snap_share_prev_2wk === 'number' ? b.avg_snap_share_prev_2wk : null;
                    return (
                      <tr key={i}>
                        <td className="rank" style={{ color: 'var(--text-faint)' }}>{i + 1}</td>
                        <td style={{ fontWeight: 600 }}>{b.player_name || '—'}</td>
                        <td><span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, fontWeight: 700, color: 'var(--accent-2)' }}>{b.position || '—'}</span></td>
                        <td className="mono faint" style={{ fontSize: 11 }}>{b.team || '—'}</td>
                        <td className="num">
                          <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 800, fontSize: 12, color: snapDelta > 0.15 ? '#c6ff3a' : snapDelta > 0.08 ? 'var(--warn)' : 'var(--text-dim)' }}>
                            +{(snapDelta * 100).toFixed(0)}%
                          </span>
                        </td>
                        <td className="num">
                          <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, fontSize: 12, color: oppScore > 7 ? '#c6ff3a' : oppScore > 4 ? 'var(--warn)' : 'var(--text-dim)' }}>
                            {oppScore.toFixed(1)}
                          </span>
                        </td>
                        <td className="num mono faint" style={{ fontSize: 11 }}>
                          {avgSnap != null ? `${(avgSnap * 100).toFixed(0)}%` : '—'}
                        </td>
                        <td className="num mono faint" style={{ fontSize: 11 }}>{b.week ?? '—'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ── Push alert modal (commish only) ─────────────────────────────────── */}
      {pushModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(5,10,0,.88)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9000 }}
          onClick={e => { if (e.target === e.currentTarget) setPushModal(false); }}>
          <div style={{ background: 'var(--panel, #141a0d)', border: '1px solid var(--border)', borderRadius: 12, padding: 24, width: 420, maxWidth: '92vw', display: 'flex', flexDirection: 'column', gap: 14, boxShadow: '0 24px 60px rgba(0,0,0,.7)' }}>
            <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--text)' }}>📣 Send Push Alert</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <input
                className="input"
                placeholder="Title (e.g. Happy Hour Reminder!)"
                value={pushTitle}
                onChange={e => setPushTitle(e.target.value)}
                style={{ fontSize: 13 }}
              />
              <textarea
                className="input"
                placeholder="Message body (optional)"
                value={pushBody}
                onChange={e => setPushBody(e.target.value)}
                rows={2}
                style={{ fontSize: 13, resize: 'vertical' }}
              />
            </div>
            {/* Owner picker */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '.06em' }}>Send To</span>
                <button
                  style={{ fontSize: 10, color: 'var(--accent)', background: 'none', border: 'none', cursor: 'pointer', padding: 0, fontWeight: 700 }}
                  onClick={() => setPushTargets(allSelected ? new Set() : new Set(LEAGUE_TEAMS.map(t => t.id)))}
                >{allSelected ? 'Deselect All' : 'Select All'}</button>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px 10px', maxHeight: 180, overflowY: 'auto', padding: '6px 8px', background: 'rgba(255,255,255,.03)', borderRadius: 8, border: '1px solid var(--border)' }}>
                {LEAGUE_TEAMS.map(t => (
                  <label key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', padding: '3px 0' }}>
                    <input
                      type="checkbox"
                      checked={pushTargets.has(t.id)}
                      onChange={() => togglePushTarget(t.id)}
                      style={{ accentColor: 'var(--accent)', width: 13, height: 13, flexShrink: 0 }}
                    />
                    <span style={{ fontSize: 11, color: pushTargets.has(t.id) ? 'var(--text)' : 'var(--text-dim)', lineHeight: 1.3, fontWeight: pushTargets.has(t.id) ? 600 : 400 }}>
                      {t.owner.split(' ')[0]} <span style={{ color: 'var(--text-faint)', fontWeight: 400 }}>· {t.name}</span>
                    </span>
                  </label>
                ))}
              </div>
              <div style={{ fontSize: 10, color: 'var(--text-faint)' }}>
                {pushTargets.size === 0 ? 'No owners selected' : allSelected ? 'All owners with alerts enabled' : `${pushTargets.size} of ${LEAGUE_TEAMS.length} owners`}
              </div>
            </div>
            {!getCommishKey() && (
              <div style={{ fontSize: 10, color: 'var(--danger)', padding: '4px 8px', background: 'rgba(224,94,94,.1)', borderRadius: 5 }}>
                Commissioner Key not set — go to Rules &amp; Settings → General → Commissioner Key.
              </div>
            )}
            {pushResult && (
              <div style={{ fontSize: 12, color: pushResult.startsWith('Error') || pushResult.startsWith('Send') || pushResult.startsWith('Key') ? 'var(--danger)' : 'var(--good)', fontWeight: 600, lineHeight: 1.5 }}>
                {pushResult}
              </div>
            )}
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button className="btn" onClick={() => setPushModal(false)}>Cancel</button>
              <button
                className="btn primary"
                onClick={sendPushAlert}
                disabled={pushSending || !pushTitle.trim() || pushTargets.size === 0}
                style={{ opacity: pushSending || !pushTitle.trim() || pushTargets.size === 0 ? 0.5 : 1 }}
              >{pushSending ? 'Sending…' : allSelected ? 'Send to All' : `Send to ${pushTargets.size}`}</button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}

function MobileScoringPopup({ onClose, myTeamId, week, espnGameMap, espnPlayerActuals }) {
  const wkNum   = typeof week === 'number' ? week : null;
  const matchups = wkNum ? (RR_SCHEDULE[wkNum - 1] || []) : [];

  function computeTeamScore(teamId) {
    const roster   = TEAM_ROSTERS[teamId] || [];
    const starters = roster.filter(r => r.slot !== 'BENCH' && r.playerId);
    return starters.reduce((total, r) => {
      const p = findPlayer(r.playerId);
      if (!p) return total;
      const proj     = p.proj || p.avg || 0;
      const gameInfo = espnGameMap[(p.team || '').toUpperCase()];
      const actual   = espnPlayerActuals[(p.name || '').toLowerCase()] ?? null;
      if (!gameInfo || gameInfo.statusName === 'STATUS_SCHEDULED') return total + proj;
      const progress = getGameProgress(gameInfo);
      if (actual != null) return total + (progress >= 1 ? actual : actual + proj * (1 - progress));
      return total + proj;
    }, 0);
  }

  const TeamRow = ({ team, teamId, score, winning }) => (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
      <span style={{
        width: 44, height: 44, borderRadius: 10,
        background: team?.color || '#555',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 18, fontWeight: 900, color: '#fff', flexShrink: 0,
      }}>
        {team?.logo || '??'}
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 700, fontSize: 15, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{team?.name || 'Team'}</div>
        {teamId === myTeamId && (
          <span style={{ fontSize: 9, color: 'var(--accent)', fontFamily: 'var(--font-mono)', fontWeight: 800, letterSpacing: '.06em' }}>YOU</span>
        )}
      </div>
      <div style={{ fontFamily: 'var(--font-display)', fontWeight: 900, fontStretch: '75%', fontSize: 32, color: winning ? 'var(--good)' : 'var(--text-dim)', lineHeight: 1 }}>
        {score.toFixed(1)}
      </div>
    </div>
  );

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 9999, background: 'var(--bg)', display: 'flex', flexDirection: 'column' }}>
      {/* Header */}
      <div style={{ background: 'var(--bg-2)', borderBottom: '1px solid var(--border)', padding: '16px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
        <div>
          <div style={{ fontWeight: 900, fontSize: 18, letterSpacing: '-.01em' }}>Week {wkNum ?? '—'} Scores</div>
          <div style={{ fontSize: 11, color: 'var(--text-faint)', marginTop: 2 }}>Live H2H Matchups</div>
        </div>
        <button
          onClick={onClose}
          style={{ background: 'rgba(255,255,255,.08)', border: '1px solid var(--border)', color: 'var(--text)', fontSize: 20, cursor: 'pointer', borderRadius: '50%', width: 38, height: 38, display: 'flex', alignItems: 'center', justifyContent: 'center', lineHeight: 1, flexShrink: 0 }}
        >✕</button>
      </div>

      {/* Scrollable matchup cards */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '16px 16px 32px', display: 'flex', flexDirection: 'column', gap: 14 }}>
        {!wkNum ? (
          <div style={{ textAlign: 'center', color: 'var(--text-faint)', fontSize: 14, marginTop: 48 }}>No active week — check back during the season.</div>
        ) : matchups.length === 0 ? (
          <div style={{ textAlign: 'center', color: 'var(--text-faint)', fontSize: 14, marginTop: 48 }}>No matchups found for this week.</div>
        ) : (
          matchups.map(([aId, bId]) => {
            const teamA  = LEAGUE_TEAMS.find(t => t.id === aId);
            const teamB  = LEAGUE_TEAMS.find(t => t.id === bId);
            const scoreA = computeTeamScore(aId);
            const scoreB = computeTeamScore(bId);
            const isMyMatch = aId === myTeamId || bId === myTeamId;
            const aWinning  = scoreA >= scoreB;
            const diff      = Math.abs(scoreA - scoreB);

            return (
              <div key={`${aId}-${bId}`} style={{
                background: 'var(--panel)',
                border: `1px solid ${isMyMatch ? 'rgba(198,255,58,.35)' : 'var(--border)'}`,
                borderRadius: 14,
                padding: '16px 18px',
                ...(isMyMatch ? { boxShadow: '0 0 0 1px rgba(198,255,58,.1)' } : {}),
              }}>
                <TeamRow team={teamA} teamId={aId} score={scoreA} winning={aWinning} />
                <div style={{ margin: '12px 0', display: 'flex', alignItems: 'center', gap: 10 }}>
                  <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
                  <span style={{ fontSize: 12, fontFamily: 'var(--font-mono)', fontWeight: 800, color: aWinning ? 'var(--good)' : 'var(--danger)', background: aWinning ? 'rgba(76,175,130,.12)' : 'rgba(255,90,110,.12)', border: `1px solid ${aWinning ? 'rgba(76,175,130,.3)' : 'rgba(255,90,110,.3)'}`, borderRadius: 6, padding: '2px 10px' }}>
                    {diff.toFixed(1)}
                  </span>
                  <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
                </div>
                <TeamRow team={teamB} teamId={bId} score={scoreB} winning={!aWinning} />
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

const DAY_ORDER = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const TYPE_COLOR = { game: 'var(--accent-2)', waiver: 'var(--warn)', lock: 'var(--danger)', other: 'var(--text-faint)' };
const TYPE_LABEL = { game: 'GAME', waiver: 'WAIVER', lock: 'LOCK', other: 'EVENT' };

const DEFAULT_EVENTS = [
  { id: 'thu-tnf',   day: 'Thursday',  time: '8:20 PM ET',  label: 'Thursday Night Football', type: 'game'   },
  { id: 'sun-early', day: 'Sunday',    time: '1:00 PM ET',  label: 'Early Games',             type: 'game'   },
  { id: 'sun-late',  day: 'Sunday',    time: '4:05 PM ET',  label: 'Late Games',              type: 'game'   },
  { id: 'sun-snf',   day: 'Sunday',    time: '8:20 PM ET',  label: 'Sunday Night Football',   type: 'game'   },
  { id: 'mon-mnf',   day: 'Monday',    time: '8:15 PM ET',  label: 'Monday Night Football',   type: 'game'   },
  { id: 'wed-wvr',   day: 'Wednesday', time: '11:59 PM ET', label: 'Waivers Run',             type: 'waiver' },
  { id: 'sun-lock',  day: 'Sunday',    time: '12:55 PM ET', label: 'Lineup Lock',             type: 'lock'   },
];

// Maps broadcast names to event slot keys (primetime games only)
const BROADCAST_SLOT = {
  'TNF': 'thu-tnf', 'PRIME VIDEO': 'thu-tnf', 'AMAZON PRIME': 'thu-tnf', 'AMAZON': 'thu-tnf',
  'NBC': 'sun-snf',
  'ESPN': 'mon-mnf', 'ABC': 'mon-mnf', 'ESPN2': 'mon-mnf',
};

const INJURY_STATUS_SHORT = {
  Questionable: 'Q', Doubtful: 'D', Out: 'O', Injured_Reserve: 'IR',
  Non_Football_Injury: 'NFI', Suspended: 'SUS', 'Physically Unable to Perform': 'PUP',
};
const INJURY_COLOR = { Q: '#ff8c00', D: 'var(--warn)', O: 'var(--danger)', IR: 'var(--danger)', SUS: '#cc44ff', NFI: '#aaa', PUP: '#aaa' };

function formatGameTime(isoDate) {
  if (!isoDate) return null;
  try {
    return new Date(isoDate).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York', hour12: true }) + ' ET';
  } catch { return null; }
}

function fmtTimeCompact(isoDate) {
  if (!isoDate) return null;
  try {
    return new Date(isoDate)
      .toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'America/New_York' })
      .replace(':00', '').replace(' AM', 'a').replace(' PM', 'p');
  } catch { return null; }
}

function isGameLocked(isoDate) {
  if (!isoDate) return false;
  return new Date(isoDate) <= new Date();
}

function formatSpread(odds, away, home) {
  if (!odds?.details) return null;
  // ESPN "details" is already formatted, e.g. "KC -3" or "PK"
  return odds.details;
}

// ── Roster Deadlines Countdown ────────────────────────────────────────────────
function useCountdown(targetDate) {
  const [ms, setMs] = React.useState(targetDate ? targetDate - Date.now() : 0);
  React.useEffect(() => {
    if (!targetDate) return;
    const id = setInterval(() => setMs(targetDate - Date.now()), 1000);
    return () => clearInterval(id);
  }, [targetDate]);
  if (!targetDate || ms <= 0) return null;
  const totalSec = Math.floor(ms / 1000);
  const d = Math.floor(totalSec / 86400);
  const h = Math.floor((totalSec % 86400) / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m ${s}s`;
  return `${m}m ${s}s`;
}

function nextSundayLock() {
  const now  = new Date();
  const d    = new Date(now);
  const day  = d.getDay(); // 0=Sun
  const diff = day === 0 ? 0 : 7 - day;
  d.setDate(d.getDate() + diff);
  d.setHours(13, 0, 0, 0); // 1:00 PM ET  ≈ 18:00 UTC (not adjusting tz here)
  if (d <= now) d.setDate(d.getDate() + 7);
  return d;
}

function nextWaiverRun() {
  const now = new Date();
  const d   = new Date(now);
  // Next Wednesday 11:59 PM
  const daysUntilWed = ((3 - d.getDay()) + 7) % 7 || 7;
  d.setDate(d.getDate() + daysUntilWed);
  d.setHours(23, 59, 0, 0);
  return d;
}

function RosterDeadlines({ currentWeek, onNav }) {
  const settings = React.useMemo(() => {
    try { return JSON.parse(localStorage.getItem('fantasai_league_settings') || 'null') || null; } catch { return null; }
  }, []);
  const lockTarget   = React.useMemo(() => nextSundayLock().getTime(),  []);
  const waiverTarget = React.useMemo(() => nextWaiverRun().getTime(),   []);
  const tradeWeekCutoff = settings?.tradeCutoffWeek ?? 11;
  const isOffseason = !currentWeek.num;

  const lockCountdown   = useCountdown(lockTarget);
  const waiverCountdown = useCountdown(waiverTarget);

  const items = [
    {
      label: 'Lineup Lock',
      icon: '🔒',
      countdown: lockCountdown ?? 'Locked',
      urgent: lockTarget - Date.now() < 4 * 3600 * 1000,
      action: () => onNav('roster'),
      actionLabel: 'Set Lineup',
      color: 'var(--danger)',
    },
    {
      label: 'Waivers Run',
      icon: '📋',
      countdown: waiverCountdown ?? 'Processing',
      urgent: waiverTarget - Date.now() < 12 * 3600 * 1000,
      action: () => onNav('players'),
      actionLabel: 'View Players',
      color: 'var(--warn)',
    },
    {
      label: 'Trade Deadline',
      icon: '↔',
      countdown: currentWeek.num >= tradeWeekCutoff ? 'Closed' : `Week ${tradeWeekCutoff}`,
      urgent: false,
      action: () => onNav('trade'),
      actionLabel: 'Trade Analyzer',
      color: 'var(--accent-2)',
    },
    {
      label: 'Playoff Picture',
      icon: '🏆',
      countdown: isOffseason ? 'Starts Wk13' : currentWeek.num >= 13 ? 'IN PLAYOFFS' : `${13 - (currentWeek.num || 0)} weeks away`,
      urgent: currentWeek.num >= 13,
      action: () => onNav('power'),
      actionLabel: 'Power Rankings',
      color: '#FFD700',
    },
  ];

  return (
    <div style={{ padding: '0 24px 16px' }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10 }}>
        {items.map(it => (
          <div key={it.label} style={{ background: 'var(--panel)', border: `1px solid ${it.urgent ? it.color + '66' : 'var(--border)'}`, borderRadius: 10, padding: '10px 14px', transition: 'border-color .2s' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
              <span style={{ fontSize: 14 }}>{it.icon}</span>
              <span style={{ fontSize: 10, color: 'var(--text-faint)', fontFamily: 'var(--font-mono)', textTransform: 'uppercase', letterSpacing: '.08em' }}>{it.label}</span>
            </div>
            <div style={{ fontFamily: 'var(--font-mono)', fontWeight: 800, fontSize: 15, color: it.urgent ? it.color : 'var(--text)', marginBottom: 6, lineHeight: 1 }}>
              {it.countdown}
              {it.urgent && <span style={{ width: 6, height: 6, borderRadius: '50%', background: it.color, display: 'inline-block', marginLeft: 6, animation: 'pulse 2s infinite', verticalAlign: 'middle' }} />}
            </div>
            <button onClick={it.action} style={{ fontSize: 10, padding: '3px 8px', background: 'none', border: `1px solid var(--border)`, borderRadius: 4, color: 'var(--text-faint)', cursor: 'pointer', fontFamily: 'var(--font-mono)' }}>
              {it.actionLabel} →
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Playoff Schedule Optimizer ─────────────────────────────────────────────────
function PlayoffOptimizer({ teamId, currentWeek, inline = false }) {
  const ids = LEAGUE_TEAMS.map(t => t.id);
  const n   = ids.length;
  const PLAYOFF_WEEKS = [13, 14, 15];

  const schedule = React.useMemo(() => {
    return Array.from({ length: 15 }, (_, w) => {
      const rest   = ids.slice(1);
      const rot    = w % (n - 1);
      const circle = [ids[0], ...[...rest.slice(rot), ...rest.slice(0, rot)]];
      return Array.from({ length: n / 2 }, (_, i) => [circle[i], circle[n - 1 - i]]);
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function simTeamScore(tid, week) {
    const roster   = TEAM_ROSTERS[tid] || [];
    const starters = roster.filter(r => r.slot !== 'BENCH' && r.playerId);
    const base = starters.reduce((s, e) => s + (findPlayer(e.playerId)?.avg || 0), 0);
    const noise = Math.sin(tid * 11.3 + week * 7.1) * 12 + Math.cos(tid * 3.7 + week * 2.9) * 6;
    return Math.max(0, Math.round((base + noise) * 10) / 10);
  }

  const playoffData = React.useMemo(() => {
    if (!teamId) return null;
    return PLAYOFF_WEEKS.map(wk => {
      const matchup = schedule[wk - 1]?.find(([a, b]) => a === teamId || b === teamId);
      if (!matchup) return { week: wk, opp: null, myProj: 0, oppProj: 0, winPct: 50 };
      const oppId   = matchup[0] === teamId ? matchup[1] : matchup[0];
      const opp     = LEAGUE_TEAMS.find(t => t.id === oppId);
      const myProj  = simTeamScore(teamId, wk);
      const oppProj = simTeamScore(oppId, wk);
      const winPct  = myProj + oppProj > 0 ? Math.round(myProj / (myProj + oppProj) * 100) : 50;
      return { week: wk, opp, myProj, oppProj, winPct };
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [teamId, schedule]);

  if (!playoffData) return null;
  const combined = playoffData.reduce((acc, w) => acc * (w.winPct / 100), 1);

  const inner = (
    <>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: inline ? 8 : 12 }}>
        <span style={{ fontSize: inline ? 14 : 18 }}>🏆</span>
        <div>
          <div style={{ fontWeight: 800, fontSize: inline ? 11 : 13 }}>Playoff Schedule Optimizer</div>
          <div style={{ fontSize: 10, color: 'var(--text-faint)' }}>Wks 13–15 · Projected matchups</div>
        </div>
        <div style={{ marginLeft: 'auto', textAlign: 'center' }}>
          <div style={{ fontSize: 9, fontFamily: 'var(--font-mono)', textTransform: 'uppercase', color: 'var(--text-faint)', marginBottom: 2 }}>Champ Odds</div>
          <div style={{ fontFamily: 'var(--font-display)', fontWeight: 900, fontStretch: '75%', fontSize: inline ? 18 : 22, color: '#FFD700', lineHeight: 1 }}>{Math.round(combined * 100)}%</div>
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: inline ? 6 : 10 }}>
        {playoffData.map(({ week, opp, myProj, oppProj, winPct }) => {
          const isCurrentWeek = week === currentWeek.num;
          const color = winPct >= 60 ? 'var(--good)' : winPct >= 45 ? 'var(--accent)' : 'var(--danger)';
          return (
            <div key={week} style={{
              background: isCurrentWeek ? 'rgba(198,255,58,.08)' : (inline ? 'rgba(255,255,255,.03)' : 'var(--panel)'),
              border: `1px solid ${isCurrentWeek ? 'rgba(198,255,58,.3)' : 'rgba(255,215,0,.15)'}`,
              borderRadius: 8, padding: inline ? '8px 10px' : '10px 12px',
            }}>
              <div style={{ fontSize: 9, fontFamily: 'var(--font-mono)', textTransform: 'uppercase', color: 'var(--text-faint)', marginBottom: 4 }}>
                Wk{week}{isCurrentWeek ? ' · NOW' : week === 15 ? ' · CHAMP' : ''}
              </div>
              {opp ? (
                <>
                  <div style={{ fontWeight: 700, fontSize: 11, marginBottom: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>vs {opp.name}</div>
                  <div style={{ fontSize: 9, fontFamily: 'var(--font-mono)', color: 'var(--text-faint)', marginBottom: 4 }}>
                    {myProj.toFixed(1)} – {oppProj.toFixed(1)}
                  </div>
                  <div style={{ height: 3, background: 'rgba(255,255,255,.08)', borderRadius: 2, overflow: 'hidden', marginBottom: 3 }}>
                    <div style={{ height: '100%', width: `${winPct}%`, background: color, borderRadius: 2, transition: 'width .5s' }} />
                  </div>
                  <div style={{ fontFamily: 'var(--font-mono)', fontWeight: 800, fontSize: 12, color }}>{winPct}%</div>
                </>
              ) : (
                <div style={{ color: 'var(--text-faint)', fontSize: 11 }}>TBD</div>
              )}
            </div>
          );
        })}
      </div>
    </>
  );

  if (inline) {
    return (
      <div style={{ padding: '10px 14px 12px', borderBottom: '1px solid var(--border)', background: 'linear-gradient(135deg, rgba(255,215,0,.04) 0%, rgba(198,255,58,.02) 100%)' }}>
        {inner}
      </div>
    );
  }

  return (
    <div style={{ padding: '0 24px 16px' }}>
      <div style={{ background: 'linear-gradient(135deg, rgba(255,215,0,.06) 0%, rgba(198,255,58,.04) 100%)', border: '1px solid rgba(255,215,0,.25)', borderRadius: 12, padding: '14px 18px' }}>
        {inner}
      </div>
    </div>
  );
}

function WeeklyCalendar({ weekLabel, waiverPosition, totalTeams, user, currentWeek, onNav }) {
  const lockTarget      = React.useMemo(() => nextSundayLock().getTime(), []);
  const waiverTarget    = React.useMemo(() => nextWaiverRun().getTime(),  []);
  const canEditCommish  = user?.isAdmin || user?.isCommissioner;

  // Fantasy matchup — who am I playing this week?
  const myTeamId  = user?.teamId ?? LEAGUE_TEAMS.find(t => t.me)?.id;
  const oppTeam   = React.useMemo(() => getOpponent(myTeamId, currentWeek?.num), [myTeamId, currentWeek?.num]);
  // slotMap: playerId → { slot, isBench }
  const mySlotMap  = React.useMemo(() => {
    const m = {};
    (TEAM_ROSTERS[myTeamId] || []).forEach(r => { if (r.playerId) m[r.playerId] = r.slot; });
    return m;
  }, [myTeamId]);
  const oppSlotMap = React.useMemo(() => {
    const m = {};
    (oppTeam ? TEAM_ROSTERS[oppTeam.id] || [] : []).forEach(r => { if (r.playerId) m[r.playerId] = r.slot; });
    return m;
  }, [oppTeam]);
  const dlSettings   = React.useMemo(() => {
    try { return JSON.parse(localStorage.getItem('fantasai_league_settings') || 'null') || null; } catch { return null; }
  }, []);
  const tradeWeekCutoff    = dlSettings?.tradeCutoffWeek ?? 11;
  const isDeadlineOffseason = !currentWeek?.num;
  const lockCountdown   = useCountdown(lockTarget);
  const waiverCountdown = useCountdown(waiverTarget);
  const deadlineItems = [
    { label: 'Lineup Lock',    icon: '🔒', countdown: lockCountdown   ?? 'Locked',     urgent: lockTarget   - Date.now() < 4  * 3600000, action: () => onNav?.('roster'),  actionLabel: 'Set Lineup',     color: 'var(--danger)'   },
    { label: 'Waivers Run',    icon: '📋', countdown: waiverCountdown ?? 'Processing', urgent: waiverTarget - Date.now() < 12 * 3600000, action: () => onNav?.('players'), actionLabel: 'View Players',   color: 'var(--warn)'     },
    { label: 'Trade Deadline', icon: '↔', countdown: (currentWeek?.num ?? 0) >= tradeWeekCutoff ? 'Closed' : `Week ${tradeWeekCutoff}`, urgent: false, action: () => onNav?.('trade'), actionLabel: 'Trade Analyzer', color: 'var(--accent-2)' },
    { label: 'Playoff Picture', icon: '🏆', countdown: isDeadlineOffseason ? 'Starts Wk13' : (currentWeek?.num ?? 0) >= 13 ? 'IN PLAYOFFS' : `${13 - (currentWeek?.num || 0)} wks away`, urgent: (currentWeek?.num ?? 0) >= 13, action: () => onNav?.('power'), actionLabel: 'Power Rankings', color: '#FFD700' },
  ];

  const events = React.useMemo(() => {
    try {
      const saved = JSON.parse(localStorage.getItem('fantasai_league_settings') || 'null');
      return saved?.weeklyEvents ?? DEFAULT_EVENTS;
    } catch { return DEFAULT_EVENTS; }
  }, []);

  const [nflGames,      setNflGames]      = React.useState([]);
  const [injuryByTeam,  setInjuryByTeam]  = React.useState({});  // { [teamAbbr]: [{name, pos, status}] }

  React.useEffect(() => {
    fetch(`${API_BASE}/api/v1/nfl/schedule`, { signal: AbortSignal.timeout(8000) })
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d?.games) setNflGames(d.games); })
      .catch(() => {});

    // Fetch Sleeper player pool for league-wide injury data (top 500 by ECR, status field mapped)
    fetch(`${API_BASE}/api/v1/players?limit=500`, { signal: AbortSignal.timeout(12000) })
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        if (!d?.players) return;
        const byTeam = {};
        for (const p of d.players) {
          if (!p.status || p.status === 'OK' || !p.team || p.team === 'FA') continue;
          const abbr = p.team.toUpperCase();
          if (!byTeam[abbr]) byTeam[abbr] = [];
          byTeam[abbr].push({ name: p.name || '', pos: p.pos || '', status: p.status });
        }
        setInjuryByTeam(byTeam);
      })
      .catch(() => {});
  }, []);

  // Map broadcast slot → full game object (first match wins)
  const slotGame = React.useMemo(() => {
    const map = {};
    for (const g of nflGames) {
      for (const b of (g.broadcasts || [])) {
        const key = BROADCAST_SLOT[b.toUpperCase()];
        if (key && !map[key]) map[key] = g;
      }
    }
    return map;
  }, [nflGames]);

  // Today's day of week for highlighting
  const todayDay = new Date().toLocaleDateString('en-US', { weekday: 'long' });

  // ── Happy Hour ───────────────────────────────────────────────────────────────
  const [happyHours, setHappyHours] = React.useState(() => {
    try { return JSON.parse(localStorage.getItem('fantasai_happy_hours') || '[]'); } catch { return []; }
  });
  const [showHHModal, setShowHHModal] = React.useState(false);
  const [hhDraft, setHhDraft]         = React.useState(null);
  const [hhCollapsed, setHhCollapsed]       = React.useState(new Set());
  const [hhCommentDrafts, setHhCommentDrafts] = React.useState({});

  // Draft location (set by admin/commissioner in DraftCountdown)
  const draftSettings = React.useMemo(() => {
    try {
      const s = JSON.parse(localStorage.getItem('fantasai_league_settings') || 'null');
      return { date: s?.draftDate ?? null, address: s?.draftAddress ?? '' };
    } catch { return { date: null, address: '' }; }
  }, []);

  function getWeekDay(dateStr) {
    try { return new Date(dateStr.slice(0, 10) + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long' }); } catch { return null; }
  }

  function fmt12(t) {
    try { const [h, m] = t.split(':').map(Number); return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`; }
    catch { return t; }
  }

  function openHHModal() {
    setHhDraft({ id: Date.now().toString(), title: 'Happy Hour', date: new Date().toISOString().slice(0, 10), time: '17:00', address: '', teamIds: LEAGUE_TEAMS.map(t => t.id) });
    setShowHHModal(true);
  }

  function editHH(hh) {
    setHhDraft({ ...hh });
    setShowHHModal(true);
  }

  function saveHH() {
    if (!hhDraft) return;
    const updated = [...happyHours.filter(h => h.id !== hhDraft.id), hhDraft]
      .sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
    setHappyHours(updated);
    localStorage.setItem('fantasai_happy_hours', JSON.stringify(updated));
    setShowHHModal(false);
    setHhDraft(null);
    pushCommunity(undefined, undefined, updated);
  }

  function deleteHH(id) {
    const updated = happyHours.filter(h => h.id !== id);
    setHappyHours(updated);
    localStorage.setItem('fantasai_happy_hours', JSON.stringify(updated));
    pushCommunity(undefined, undefined, updated);
  }

  function rsvpHH(id, teamId, response) {
    const updated = happyHours.map(h => {
      if (h.id !== id) return h;
      const rsvps = { ...(h.rsvps || {}) };
      if (response === null) delete rsvps[String(teamId)];
      else rsvps[String(teamId)] = response;
      return { ...h, rsvps };
    });
    setHappyHours(updated);
    localStorage.setItem('fantasai_happy_hours', JSON.stringify(updated));
    pushCommunity(undefined, undefined, updated);
  }

  function addCommentHH(id, teamId, text) {
    const trimmed = text.trim();
    if (!trimmed) return;
    const updated = happyHours.map(h => {
      if (h.id !== id) return h;
      const comments = [...(h.comments || []), { teamId: String(teamId), text: trimmed, at: Date.now() }];
      return { ...h, comments };
    });
    setHappyHours(updated);
    localStorage.setItem('fantasai_happy_hours', JSON.stringify(updated));
    pushCommunity(undefined, undefined, updated);
  }

  function deleteCommentHH(id, idx) {
    const updated = happyHours.map(h => {
      if (h.id !== id) return h;
      const comments = (h.comments || []).filter((_, i) => i !== idx);
      return { ...h, comments };
    });
    setHappyHours(updated);
    localStorage.setItem('fantasai_happy_hours', JSON.stringify(updated));
    pushCommunity(undefined, undefined, updated);
  }

  // ── R2 community sync (Champions, Commish media, Happy Hours) ────────────────
  function pushCommunity(overChampions, overCommishMedia, overHappyHours) {
    const payload = {
      champions:    overChampions   ?? champions,
      commishMedia: overCommishMedia !== undefined ? overCommishMedia : (commishData?.media ?? null),
      happyHours:   overHappyHours  ?? happyHours,
    };
    const headers = { 'Content-Type': 'application/json' };
    const key = localStorage.getItem('fantasai.workerKey');
    if (key) headers['X-FantasAI-Key'] = key;
    fetch(`${API_BASE}/api/v1/community`, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
    }).catch(() => {});
  }

  React.useEffect(() => {
    fetch(`${API_BASE}/api/v1/community`, { signal: AbortSignal.timeout(8000) })
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (!data) return;
        if (Array.isArray(data.champions) && data.champions.length > 0) {
          setChampions(data.champions);
          localStorage.setItem('fantasai_champions', JSON.stringify(data.champions));
        }
        if (data.commishMedia !== undefined) {
          const m = data.commishMedia;
          if (m) localStorage.setItem('fantasai_commish_media', JSON.stringify(m));
          else localStorage.removeItem('fantasai_commish_media');
          setCommishData(d => ({ ...d, media: m }));
        }
        if (Array.isArray(data.happyHours) && data.happyHours.length > 0) {
          setHappyHours(data.happyHours);
          localStorage.setItem('fantasai_happy_hours', JSON.stringify(data.happyHours));
        }
      })
      .catch(() => {});
  }, []);

  const [draftRsvp, setDraftRsvp] = React.useState(() => {
    try { return JSON.parse(localStorage.getItem('fantasai_draft_rsvp') || '{}'); } catch { return {}; }
  });

  function rsvpDraft(teamId, response) {
    const updated = { ...draftRsvp };
    if (response === null) delete updated[String(teamId)];
    else updated[String(teamId)] = response;
    setDraftRsvp(updated);
    localStorage.setItem('fantasai_draft_rsvp', JSON.stringify(updated));
  }

  const grouped = React.useMemo(() => {
    const g = {};
    for (const evt of events) {
      if (!g[evt.day]) g[evt.day] = [];
      g[evt.day].push(evt);
    }
    for (const hh of happyHours) {
      const day = getWeekDay(hh.date);
      if (!day) continue;
      if (!g[day]) g[day] = [];
      g[day].push({ ...hh, _isHH: true });
    }
    if (draftSettings.date) {
      const day = getWeekDay(draftSettings.date);
      if (day) {
        if (!g[day]) g[day] = [];
        const draftTime = draftSettings.date.includes('T') ? draftSettings.date.split('T')[1].slice(0, 5) : '';
        g[day].push({ id: '__draft__', _isDraft: true, date: draftSettings.date, time: draftTime, address: draftSettings.address });
      }
    }
    return g;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [events, happyHours, draftSettings.date, draftSettings.address]);

  const activeDays = DAY_ORDER.filter(d => grouped[d]?.length > 0);

  // Compute Sun–Sat dates for this NFL week (calendar display)
  const calWeekDates = React.useMemo(() => {
    const now = new Date();
    const sun = new Date(now.getFullYear(), now.getMonth(), now.getDate() - now.getDay());
    const NAMES = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
    const ABBRS = ['SUN','MON','TUE','WED','THU','FRI','SAT'];
    return NAMES.map((name, i) => ({
      name,
      abbr: ABBRS[i],
      num: new Date(sun.getFullYear(), sun.getMonth(), sun.getDate() + i).getDate(),
    }));
  }, []);

  return (
    <>
    <div className="card" style={{ height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <div className="card-head" style={{ flexShrink: 0 }}>
        <div className="card-title">Weekly Events</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button className="btn primary sm" style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.02em' }} onClick={openHHModal}>🍺 Create Happy Hour</button>
          <span className="mono faint" style={{ fontSize: 10 }}>{weekLabel}</span>
        </div>
      </div>
      {/* ── Deadline strip ── */}
      <div style={{ display: 'flex', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
        {deadlineItems.map((it, idx) => (
          <button key={it.label} onClick={it.action} style={{
            flex: 1, padding: '9px 0 8px', cursor: 'pointer', background: it.urgent ? `${it.color}09` : 'none',
            border: 'none', borderRight: idx < 3 ? '1px solid var(--border)' : 'none',
            borderTop: `2px solid ${it.urgent ? it.color : 'transparent'}`,
            display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3,
            transition: 'background .12s',
          }}>
            <span style={{ fontSize: 8, fontFamily: 'var(--font-mono)', fontWeight: 700, letterSpacing: '.07em', textTransform: 'uppercase', color: it.urgent ? it.color : 'var(--text-faint)', lineHeight: 1, display: 'flex', alignItems: 'center', gap: 3 }}>
              {it.icon} {it.label}
            </span>
            <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 900, fontSize: 13, color: it.urgent ? it.color : 'var(--text)', lineHeight: 1, display: 'flex', alignItems: 'center', gap: 4 }}>
              {it.countdown}
              {it.urgent && <span style={{ width: 5, height: 5, borderRadius: '50%', background: it.color, animation: 'pulse 2s infinite', display: 'inline-block', flexShrink: 0 }} />}
            </span>
          </button>
        ))}
      </div>
      {/* ── Week Calendar + Events ── */}
      <div style={{ padding: '12px 12px 8px', flex: 1, overflow: 'auto', minHeight: 0 }}>
        {/* ── 7-column calendar grid ── */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden', marginBottom: 12 }}>
          {calWeekDates.map(({ name, abbr, num }, colIdx) => {
            const isToday = name === todayDay;
            const dayEvts = [...(grouped[name] || [])].sort((a, b) => (a.time || '').localeCompare(b.time || ''));
            return (
              <div key={name} style={{
                display: 'flex', flexDirection: 'column',
                borderRight: colIdx < 6 ? '1px solid var(--border)' : 'none',
                background: isToday ? 'rgba(198,255,58,.04)' : 'transparent',
                minHeight: 110,
              }}>
                {/* Day header cell */}
                <div style={{
                  padding: '6px 4px 5px', textAlign: 'center',
                  borderBottom: '1px solid var(--border)',
                  background: isToday ? 'rgba(198,255,58,.09)' : 'rgba(255,255,255,.02)',
                }}>
                  <div style={{ fontSize: 8, fontFamily: 'var(--font-mono)', fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase', color: isToday ? 'var(--accent)' : 'var(--text-faint)', marginBottom: 3 }}>{abbr}</div>
                  <div style={{
                    width: 22, height: 22, borderRadius: '50%', margin: '0 auto',
                    background: isToday ? 'var(--accent)' : 'transparent',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 11, fontWeight: isToday ? 900 : 500,
                    color: isToday ? 'var(--accent-ink)' : 'var(--text-dim)',
                  }}>{num}</div>
                </div>
                {/* Event slots */}
                <div style={{ padding: '4px 3px', display: 'flex', flexDirection: 'column', gap: 3, flex: 1 }}>
                  {dayEvts.map(evt => {
                    if (evt._isHH) return (
                      <div key={evt.id} title={evt.title || 'Happy Hour'} style={{ fontSize: 12, fontWeight: 700, background: 'rgba(255,180,0,.18)', border: '1px solid rgba(255,180,0,.35)', borderRadius: 3, padding: '2px 4px', color: '#ffb400', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>🍺 {evt.title || 'Happy Hour'}</div>
                    );
                    if (evt._isDraft) return (
                      <div key="__draft__" title="Fantasy Draft" style={{ fontSize: 12, fontWeight: 700, background: 'rgba(198,255,58,.15)', border: '1px solid rgba(198,255,58,.35)', borderRadius: 3, padding: '2px 4px', color: '#c6ff3a', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>🏈 Draft</div>
                    );
                    if (evt.type === 'lock') return null;
                    const isPrimetime = evt.id === 'mon-mnf' || evt.id === 'sun-snf';
                    const typeColor   = isPrimetime ? '#FFD700' : (TYPE_COLOR[evt.type] ?? TYPE_COLOR.other);
                    const chipLabel   = isPrimetime ? (evt.id === 'mon-mnf' ? 'MNF' : 'SNF') : (TYPE_LABEL[evt.type] ?? evt.label);
                    const chipGame    = slotGame[evt.id];
                    const chipTime    = chipGame ? fmtTimeCompact(chipGame.date) : null;
                    const chipLocked  = chipGame ? isGameLocked(chipGame.date) : false;
                    return (
                      <div key={evt.id} title={`${evt.label}${chipTime ? ' · ' + chipTime : ''}${chipLocked ? ' · LOCKED' : ''}`} style={{
                        fontSize: isPrimetime ? 14 : 12,
                        fontWeight: 700,
                        letterSpacing: '.02em',
                        color: chipLocked ? 'var(--text-faint)' : typeColor,
                        background: chipLocked ? 'rgba(255,255,255,.04)' : isPrimetime ? 'rgba(255,215,0,.15)' : `${typeColor}1a`,
                        border: `1px solid ${chipLocked ? 'rgba(255,255,255,.1)' : isPrimetime ? 'rgba(255,215,0,.45)' : typeColor + '44'}`,
                        borderRadius: 3, padding: '2px 3px', overflow: 'hidden', display: 'flex', flexDirection: 'column', gap: 1,
                      }}>
                        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'flex', alignItems: 'center', gap: 2 }}>
                          {chipLocked && <span style={{ fontSize: isPrimetime ? 13 : 11 }}>🔒</span>}
                          {chipLabel}
                        </span>
                        {chipTime && <span style={{ fontSize: isPrimetime ? 13 : 11, opacity: 0.75, whiteSpace: 'nowrap' }}>{chipTime}</span>}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>

        {/* ── Rich event detail cards (HH, Draft, primetime games) ── */}
        {DAY_ORDER.flatMap(day => {
          const isToday = day === todayDay;
          const dayEvts = [...(grouped[day] || [])].sort((a, b) => (a.time || '').localeCompare(b.time || ''));
          const richEvts = dayEvts.filter(evt => evt._isHH || evt._isDraft || !!slotGame[evt.id]);
          if (richEvts.length === 0) return [];
          return [(
            <div key={day} style={{ borderTop: '1px solid var(--border)' }}>
              <div style={{ padding: '5px 14px 3px', fontSize: 12, fontWeight: 700, letterSpacing: '.1em', textTransform: 'uppercase', color: isToday ? 'var(--accent)' : 'var(--text-faint)', display: 'flex', alignItems: 'center', gap: 6 }}>
                {day}
                {isToday && <span style={{ fontSize: 8, background: 'var(--accent)', color: '#0a1300', borderRadius: 3, padding: '1px 5px', fontWeight: 800 }}>TODAY</span>}
              </div>
              {richEvts.map(evt => {
                // ── Happy Hour event ──
                if (evt._isHH) {
                  const dateLabel = (() => { try { return new Date(evt.date + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }); } catch { return evt.date; } })();
                  const allTeams  = (evt.teamIds || []).length === LEAGUE_TEAMS.length;
                  const collapsed = hhCollapsed.has(evt.id);
                  const toggleCollapse = () => setHhCollapsed(s => {
                    const n = new Set(s);
                    n.has(evt.id) ? n.delete(evt.id) : n.add(evt.id);
                    return n;
                  });
                  return (
                    <div key={evt.id} style={{ margin: '4px 10px 6px', borderRadius: 7, border: '1px solid rgba(255,180,0,.28)', background: 'rgba(255,180,0,.05)', overflow: 'hidden' }}>
                      <div style={{ minWidth: 0, display: 'flex', flexDirection: 'column' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 10px 6px', borderBottom: collapsed ? 'none' : '1px solid rgba(255,255,255,.06)', cursor: 'pointer' }} onClick={toggleCollapse}>
                          <span style={{ fontSize: 15 }}>🍺</span>
                          <div style={{ flex: 1 }}>
                            <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>{evt.title || 'Happy Hour'}</div>
                            <div style={{ fontSize: 9, fontFamily: 'var(--font-mono)', color: 'rgba(255,180,0,.8)', marginTop: 1 }}>
                              {dateLabel}{evt.time ? ` · ${fmt12(evt.time)}` : ''}
                            </div>
                          </div>
                          <span style={{ fontSize: 10, color: 'var(--text-faint)', marginRight: 2 }}>{collapsed ? '▶' : '▼'}</span>
                          {canEditCommish && (
                            <button style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-faint)', fontSize: 12, padding: '2px 4px', lineHeight: 1 }} onClick={e => { e.stopPropagation(); editHH(evt); }} title="Edit">✏️</button>
                          )}
                          <button style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-faint)', fontSize: 12, padding: '2px 4px', lineHeight: 1 }} onClick={e => { e.stopPropagation(); deleteHH(evt.id); }} title="Remove">✕</button>
                        </div>
                        {!collapsed && <>
                        <div style={{ padding: '5px 10px 4px' }}>
                          {allTeams ? (
                            <span style={{ fontSize: 9, fontFamily: 'var(--font-mono)', color: 'rgba(255,180,0,.7)' }}>All {LEAGUE_TEAMS.length} teams invited</span>
                          ) : (
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                              {(evt.teamIds || []).map(tid => {
                                const t = LEAGUE_TEAMS.find(x => x.id === tid);
                                return t ? <span key={tid} style={{ fontSize: 9, background: 'rgba(255,180,0,.12)', border: '1px solid rgba(255,180,0,.3)', borderRadius: 3, padding: '1px 6px', color: 'rgba(255,215,0,.9)', fontFamily: 'var(--font-mono)', fontWeight: 700 }}>{t.logo}</span> : null;
                              })}
                            </div>
                          )}
                        </div>
                        {evt.address && (
                          <div style={{ padding: '0 10px 4px', fontSize: 10, color: 'var(--text-dim)', display: 'flex', alignItems: 'center', gap: 5 }}>
                            <span>📍</span>
                            <a href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(evt.address)}`} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--accent-2)', textDecoration: 'none', fontWeight: 600 }}>{evt.address}</a>
                          </div>
                        )}
                        {/* RSVP + Share section */}
                        {(() => {
                          const invitedIds  = evt.teamIds || [];
                          const myIdStr     = String(myTeamId || '');
                          const myIsInvited = !!myTeamId && invitedIds.map(String).includes(myIdStr);
                          const myRsvp      = evt.rsvps?.[myIdStr];
                          const going = [], notGoing = [];
                          for (const tid of invitedIds) {
                            const r = evt.rsvps?.[String(tid)];
                            const t = LEAGUE_TEAMS.find(x => String(x.id) === String(tid));
                            if (!t) continue;
                            if (r === 'yes') going.push(t);
                            else if (r === 'no') notGoing.push(t);
                          }
                          function shareEvent() {
                            const dateLabel = (() => { try { return new Date(evt.date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' }); } catch { return evt.date; } })();
                            const text = [
                              `🍺 ${evt.title || 'Happy Hour'}`,
                              `📅 ${dateLabel}${evt.time ? ' at ' + fmt12(evt.time) : ''}`,
                              evt.address ? `📍 ${evt.address}` : '',
                            ].filter(Boolean).join('\n');
                            const fallback = () => {
                              // Try SMS deep link (works on mobile even without native share)
                              try { window.open(`sms:?body=${encodeURIComponent(text)}`, '_blank'); return; } catch {}
                              navigator.clipboard?.writeText(text)
                                .then(() => alert('Copied to clipboard!'))
                                .catch(() => {});
                            };
                            if (navigator.share) {
                              navigator.share({ title: evt.title || 'Happy Hour', text }).catch(fallback);
                            } else {
                              fallback();
                            }
                          }
                          return (
                            <div style={{ padding: '6px 10px 8px', borderTop: '1px solid rgba(255,180,0,.12)', marginTop: 2 }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginBottom: going.length > 0 ? 8 : 0 }}>
                                {myIsInvited && (
                                  <button onClick={() => rsvpHH(evt.id, myIdStr, myRsvp === 'yes' ? null : 'yes')}
                                    style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, padding: '4px 12px', borderRadius: 6, border: `1px solid ${myRsvp === 'yes' ? 'rgba(76,175,130,.7)' : 'rgba(255,180,0,.35)'}`, cursor: 'pointer', background: myRsvp === 'yes' ? 'rgba(76,175,130,.2)' : 'rgba(255,180,0,.08)', color: myRsvp === 'yes' ? '#4caf82' : 'rgba(255,180,0,.9)', fontWeight: 700, transition: 'all .15s' }}>
                                    {myRsvp === 'yes' ? '✓ I\'m Going!' : '🍺 I\'m Coming'}
                                  </button>
                                )}
                                {myIsInvited && myRsvp === 'yes' && (
                                  <button onClick={() => rsvpHH(evt.id, myIdStr, null)}
                                    style={{ fontSize: 10, padding: '3px 8px', borderRadius: 5, border: '1px solid rgba(255,255,255,.12)', cursor: 'pointer', background: 'transparent', color: 'var(--text-faint)' }}>
                                    Can't make it
                                  </button>
                                )}
                                <button onClick={shareEvent}
                                  style={{ marginLeft: 'auto', fontSize: 10, padding: '3px 10px', borderRadius: 5, border: '1px solid rgba(255,255,255,.15)', cursor: 'pointer', background: 'transparent', color: 'var(--text-dim)', display: 'flex', alignItems: 'center', gap: 4 }}>
                                  📲 Send to Phone
                                </button>
                              </div>
                              {going.length > 0 && (
                                <div>
                                  <div style={{ fontSize: 8, color: '#4caf82', fontWeight: 700, letterSpacing: '.08em', marginBottom: 4 }}>GOING ({going.length})</div>
                                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                                    {going.map(t => (
                                      <span key={t.id} style={{ fontSize: 10, background: 'rgba(76,175,130,.1)', border: '1px solid rgba(76,175,130,.3)', borderRadius: 4, padding: '2px 7px', color: '#4caf82', fontFamily: 'var(--font-mono)', fontWeight: 700 }}>{t.logo} {t.name}</span>
                                    ))}
                                  </div>
                                </div>
                              )}
                            </div>
                          );
                        })()}
                      {/* Comments section */}
                      {(() => {
                        const comments = evt.comments || [];
                        const myIdStr  = String(myTeamId || '');
                        const draft    = hhCommentDrafts[evt.id] || '';
                        const setDraft = v => setHhCommentDrafts(d => ({ ...d, [evt.id]: v }));
                        const submit   = () => { if (!draft.trim()) return; addCommentHH(evt.id, myIdStr, draft); setDraft(''); };
                        return (
                          <div style={{ padding: '6px 10px 8px', borderTop: '1px solid rgba(255,180,0,.10)' }}>
                            {comments.length > 0 && (
                              <div style={{ marginBottom: 6, display: 'flex', flexDirection: 'column', gap: 4 }}>
                                {comments.map((c, ci) => {
                                  const t = LEAGUE_TEAMS.find(x => String(x.id) === String(c.teamId));
                                  const isMine = c.teamId === myIdStr;
                                  return (
                                    <div key={ci} style={{ display: 'flex', alignItems: 'flex-start', gap: 6 }}>
                                      <span style={{ fontSize: 13, flexShrink: 0 }}>{t?.logo || '👤'}</span>
                                      <div style={{ flex: 1, minWidth: 0 }}>
                                        <span style={{ fontSize: 9, fontWeight: 700, color: 'rgba(255,180,0,.7)', fontFamily: 'var(--font-mono)', marginRight: 5 }}>{t?.name || 'Owner'}</span>
                                        <span style={{ fontSize: 11, color: 'var(--text-dim)', wordBreak: 'break-word' }}>{c.text}</span>
                                      </div>
                                      {(isMine || canEditCommish) && (
                                        <button onClick={() => deleteCommentHH(evt.id, ci)} style={{ background: 'none', border: 'none', color: 'var(--text-faint)', fontSize: 10, cursor: 'pointer', padding: '0 2px', flexShrink: 0 }}>✕</button>
                                      )}
                                    </div>
                                  );
                                })}
                              </div>
                            )}
                            {myTeamId && (
                              <div style={{ display: 'flex', gap: 6 }}>
                                <input className="input" value={draft}
                                  onChange={e => setDraft(e.target.value)}
                                  onKeyDown={e => { if (e.key === 'Enter') submit(); }}
                                  placeholder="Add a comment..."
                                  style={{ flex: 1, fontSize: 11, padding: '4px 8px', background: 'rgba(255,255,255,.05)', border: '1px solid rgba(255,180,0,.2)', borderRadius: 5 }}
                                />
                                <button className="btn sm" onClick={submit}
                                  style={{ fontSize: 11, background: 'rgba(255,180,0,.15)', border: '1px solid rgba(255,180,0,.3)', color: 'rgba(255,180,0,.9)' }}
                                >Send</button>
                              </div>
                            )}
                          </div>
                        );
                      })()}
                      {/* Map — below details, constrained width */}
                      {evt.address && (
                        <div style={{ padding: '0 10px 10px' }}>
                          <iframe
                            title={`Map: ${evt.address}`}
                            src={`https://maps.google.com/maps?q=${encodeURIComponent(evt.address)}&output=embed`}
                            style={{ width: '100%', maxWidth: 400, height: 160, border: 'none', borderRadius: 6, display: 'block', opacity: 0.9 }}
                          />
                        </div>
                      )}
                      </>}
                    </div>
                  </div>
                  );
                }

                // ── Draft event ──
                if (evt._isDraft) {
                  const dateLabel = (() => { try { return new Date(evt.date).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }); } catch { return evt.date; } })();
                  const timeLabel = (() => { try { return new Date(evt.date).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true }); } catch { return ''; } })();
                  const myDraftRsvp = draftRsvp[String(myTeamId)];
                  const draftGoing = [], draftNotGoing = [];
                  for (const t of LEAGUE_TEAMS) {
                    const r = draftRsvp[String(t.id)];
                    if (r === 'yes') draftGoing.push(t);
                    else if (r === 'no') draftNotGoing.push(t);
                  }
                  return (
                    <div key="__draft__" style={{ margin: '4px 10px 6px', borderRadius: 7, border: '1px solid rgba(198,255,58,.3)', background: 'rgba(198,255,58,.05)', overflow: 'hidden' }}>
                      <div style={{ minWidth: 0, display: 'flex', flexDirection: 'column' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 10px 6px', borderBottom: '1px solid rgba(255,255,255,.06)' }}>
                          <span style={{ fontSize: 15 }}>🏈</span>
                          <div style={{ flex: 1 }}>
                            <div style={{ fontSize: 11, fontWeight: 700, color: '#c6ff3a' }}>Fantasy Draft</div>
                            <div style={{ fontSize: 9, fontFamily: 'var(--font-mono)', color: 'rgba(198,255,58,.7)', marginTop: 1 }}>
                              {dateLabel}{timeLabel ? ` · ${timeLabel}` : ''}
                            </div>
                          </div>
                        </div>
                        {evt.address && (
                          <div style={{ padding: '6px 10px 4px', fontSize: 10, color: 'var(--text-dim)', display: 'flex', alignItems: 'center', gap: 5 }}>
                            <span>📍</span>
                            <a href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(evt.address)}`} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--accent-2)', textDecoration: 'none', fontWeight: 600 }}>{evt.address}</a>
                          </div>
                        )}
                        {/* Draft RSVP section */}
                        <div style={{ padding: '4px 10px 8px', borderTop: '1px solid rgba(198,255,58,.12)', marginTop: 2 }}>
                          {myTeamId && (
                            <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 5 }}>
                              <span style={{ fontSize: 9, color: 'var(--text-faint)', fontFamily: 'var(--font-mono)' }}>RSVP:</span>
                              <button onClick={() => rsvpDraft(myTeamId, myDraftRsvp === 'yes' ? null : 'yes')}
                                style={{ fontSize: 9, padding: '2px 8px', borderRadius: 4, border: `1px solid ${myDraftRsvp === 'yes' ? 'rgba(76,175,130,.6)' : 'rgba(255,255,255,.15)'}`, cursor: 'pointer', background: myDraftRsvp === 'yes' ? 'rgba(76,175,130,.25)' : 'transparent', color: myDraftRsvp === 'yes' ? '#4caf82' : 'var(--text-dim)', fontWeight: myDraftRsvp === 'yes' ? 700 : 400 }}>
                                ✓ Going
                              </button>
                              <button onClick={() => rsvpDraft(myTeamId, myDraftRsvp === 'no' ? null : 'no')}
                                style={{ fontSize: 9, padding: '2px 8px', borderRadius: 4, border: `1px solid ${myDraftRsvp === 'no' ? 'rgba(224,94,94,.5)' : 'rgba(255,255,255,.15)'}`, cursor: 'pointer', background: myDraftRsvp === 'no' ? 'rgba(224,94,94,.2)' : 'transparent', color: myDraftRsvp === 'no' ? '#e05e5e' : 'var(--text-dim)', fontWeight: myDraftRsvp === 'no' ? 700 : 400 }}>
                                ✗ Not Going
                              </button>
                            </div>
                          )}
                          {(draftGoing.length > 0 || draftNotGoing.length > 0) && (
                            <div style={{ display: 'flex', gap: 14 }}>
                              {draftGoing.length > 0 && (
                                <div>
                                  <div style={{ fontSize: 8, color: '#4caf82', fontWeight: 700, letterSpacing: '.08em', marginBottom: 3 }}>GOING ({draftGoing.length})</div>
                                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3 }}>
                                    {draftGoing.map(t => <span key={t.id} title={t.name} style={{ fontSize: 11 }}>{t.logo}</span>)}
                                  </div>
                                </div>
                              )}
                              {draftNotGoing.length > 0 && (
                                <div>
                                  <div style={{ fontSize: 8, color: '#e05e5e', fontWeight: 700, letterSpacing: '.08em', marginBottom: 3 }}>NOT GOING ({draftNotGoing.length})</div>
                                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3, opacity: 0.6 }}>
                                    {draftNotGoing.map(t => <span key={t.id} title={t.name} style={{ fontSize: 11 }}>{t.logo}</span>)}
                                  </div>
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                      {/* Map — below details, constrained */}
                      {evt.address && (
                        <div style={{ padding: '0 10px 10px' }}>
                          <iframe title="Draft location map" src={`https://maps.google.com/maps?q=${encodeURIComponent(evt.address)}&output=embed`}
                            style={{ width: '100%', maxWidth: 400, height: 160, border: 'none', borderRadius: 6, display: 'block', opacity: 0.9 }} />
                        </div>
                      )}
                    </div>
                  );
                }

                const game      = slotGame[evt.id];
                const typeColor = TYPE_COLOR[evt.type] ?? TYPE_COLOR.other;

                if (!game) return null;

                // Rich game card for primetime matchups with live ESPN data
                const awayAbbr   = game.away?.abbr?.toUpperCase() ?? '';
                const homeAbbr   = game.home?.abbr?.toUpperCase() ?? '';
                const awayName   = game.away?.name ?? awayAbbr;
                const homeName   = game.home?.name ?? homeAbbr;
                const gameTime   = formatGameTime(game.date);
                const gameLocked = isGameLocked(game.date);
                const spread     = formatSpread(game.odds, game.away, game.home);
                const overUnder  = game.odds?.overUnder != null ? `O/U ${game.odds.overUnder}` : null;
                const network    = game.broadcasts?.filter(b => b && b.trim()).join(' · ') || null;
                const awayInjuries = (injuryByTeam[awayAbbr] || []).slice(0, 4);
                const homeInjuries = (injuryByTeam[homeAbbr] || []).slice(0, 4);
                const hasInjuries  = awayInjuries.length > 0 || homeInjuries.length > 0;

                return (
                  <div key={evt.id} style={{ margin: '4px 10px 6px', borderRadius: 7, border: `1px solid ${gameLocked ? 'rgba(255,255,255,.1)' : 'rgba(78,168,255,.18)'}`, background: gameLocked ? 'rgba(255,255,255,.02)' : 'rgba(78,168,255,.04)', overflow: 'hidden' }}>
                    {/* Header row: label + time */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px 4px', borderBottom: '1px solid rgba(255,255,255,.06)' }}>
                      <span style={{ fontSize: 9, fontFamily: 'var(--font-mono)', fontWeight: 700, color: gameLocked ? 'var(--text-faint)' : typeColor, flexShrink: 0, display: 'flex', alignItems: 'center', gap: 4 }}>
                        {gameLocked && <span title="Game locked — lineup frozen">🔒</span>}
                        {TYPE_LABEL[evt.type] ?? 'GAME'}
                      </span>
                      <span style={{ fontSize: 11, fontWeight: 700, color: gameLocked ? 'var(--text-dim)' : 'var(--text)', flex: 1 }}>{evt.label}</span>
                      {gameTime && (
                        <span style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: gameLocked ? 'var(--danger)' : 'var(--text-faint)', flexShrink: 0, fontWeight: gameLocked ? 700 : 400 }}>
                          {gameLocked ? 'LOCKED' : gameTime}
                        </span>
                      )}
                    </div>

                    {/* Matchup + network + odds */}
                    <div style={{ padding: '5px 10px', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                      <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 800, fontSize: 13, color: 'var(--accent-2)', letterSpacing: '.03em' }}>
                        {awayAbbr} <span style={{ color: 'var(--text-faint)', fontWeight: 400, fontSize: 10 }}>@</span> {homeAbbr}
                      </span>
                      {network && (
                        <span style={{ fontSize: 9, fontFamily: 'var(--font-mono)', fontWeight: 700, color: '#fff', background: 'rgba(78,168,255,.25)', border: '1px solid rgba(78,168,255,.4)', borderRadius: 3, padding: '1px 5px', flexShrink: 0 }}>
                          {network}
                        </span>
                      )}
                      {spread && (
                        <span style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--text-dim)', flexShrink: 0 }}>
                          {spread}
                        </span>
                      )}
                      {overUnder && (
                        <span style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--text-faint)', flexShrink: 0 }}>
                          {overUnder}
                        </span>
                      )}
                    </div>

                    {/* Injury report */}
                    {hasInjuries && (
                      <div style={{ padding: '0 10px 7px', display: 'flex', gap: 14, flexWrap: 'wrap' }}>
                        {[[awayAbbr, awayInjuries], [homeAbbr, homeInjuries]].map(([abbr, list]) =>
                          list.length === 0 ? null : (
                            <div key={abbr}>
                              <div style={{ fontSize: 8, fontFamily: 'var(--font-mono)', fontWeight: 700, color: 'var(--text-faint)', letterSpacing: '.08em', textTransform: 'uppercase', marginBottom: 3 }}>{abbr}</div>
                              {list.map((inj, i) => {
                                const code  = INJURY_STATUS_SHORT[inj.status] || inj.status;
                                const color = INJURY_COLOR[code] || 'var(--text-faint)';
                                return (
                                  <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 2 }}>
                                    <span style={{ fontSize: 8, fontFamily: 'var(--font-mono)', fontWeight: 700, color, background: `${color}22`, border: `1px solid ${color}55`, borderRadius: 2, padding: '1px 4px', flexShrink: 0 }}>{code}</span>
                                    <span style={{ fontSize: 10, color: 'var(--text-dim)', whiteSpace: 'nowrap' }}>{inj.name}</span>
                                    <span style={{ fontSize: 9, color: 'var(--text-faint)', fontFamily: 'var(--font-mono)' }}>{inj.pos}</span>
                                  </div>
                                );
                              })}
                            </div>
                          )
                        )}
                      </div>
                    )}

                    {/* Fantasy matchup — show for MNF / SNF only */}
                    {(evt.id === 'mon-mnf' || evt.id === 'sun-snf') && (() => {
                      const gameTeams = new Set([awayAbbr, homeAbbr]);
                      const myPlayers  = Object.entries(mySlotMap)
                        .map(([pid, slot]) => ({ p: findPlayer(Number(pid)), slot }))
                        .filter(({ p }) => p && gameTeams.has((p.team || '').toUpperCase()));
                      const oppPlayers = oppTeam ? Object.entries(oppSlotMap)
                        .map(([pid, slot]) => ({ p: findPlayer(Number(pid)), slot }))
                        .filter(({ p }) => p && gameTeams.has((p.team || '').toUpperCase())) : [];
                      if (!myPlayers.length && !oppPlayers.length) return null;
                      const renderList = (players, accentColor, label) => (
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 9, fontFamily: 'var(--font-mono)', fontWeight: 800, color: accentColor, letterSpacing: '.08em', textTransform: 'uppercase', marginBottom: 4 }}>{label}</div>
                          {players.map(({ p, slot }) => {
                            const isBench = slot === 'BENCH';
                            return (
                              <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 3, opacity: isBench ? 0.55 : 1 }}>
                                <PosBadge pos={p.pos} />
                                <span style={{ fontSize: 12, fontWeight: isBench ? 400 : 700, color: isBench ? 'var(--text-dim)' : 'var(--text)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</span>
                                {isBench && <span style={{ fontSize: 8, fontFamily: 'var(--font-mono)', color: 'var(--text-faint)', flexShrink: 0 }}>BENCH</span>}
                              </div>
                            );
                          })}
                        </div>
                      );
                      return (
                        <div style={{ margin: '0 10px 8px', borderTop: '1px solid rgba(255,255,255,.07)', paddingTop: 7, display: 'flex', gap: 12 }}>
                          {myPlayers.length > 0  && renderList(myPlayers,  '#4caf82', 'My Team')}
                          {oppPlayers.length > 0 && renderList(oppPlayers, 'var(--danger)', `vs ${oppTeam?.name ?? 'Opp'}`)}
                        </div>
                      );
                    })()}
                  </div>
                );
              })}
            </div>
          )];
        })}
      </div>
    </div>

    {/* ── Happy Hour Modal ─────────────────────────────────────────────────── */}
    {showHHModal && hhDraft && (
      <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.72)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}
        onClick={e => { if (e.target === e.currentTarget) { setShowHHModal(false); setHhDraft(null); } }}>
        <div style={{ background: 'var(--panel)', border: '1px solid var(--border-strong)', borderRadius: 14, padding: 24, width: 420, maxWidth: '100%', maxHeight: '90vh', overflowY: 'auto' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18 }}>
            <div style={{ fontSize: 15, fontWeight: 800 }}>{happyHours.some(h => h.id === hhDraft?.id) ? '🍺 Edit Happy Hour' : '🍺 Schedule Happy Hour'}</div>
            <button style={{ background: 'none', border: 'none', color: 'var(--text-faint)', fontSize: 18, cursor: 'pointer', lineHeight: 1 }} onClick={() => { setShowHHModal(false); setHhDraft(null); }}>✕</button>
          </div>

          {/* Event name */}
          <div style={{ marginBottom: 12 }}>
            <label style={{ fontSize: 11, color: 'var(--text-faint)', display: 'block', marginBottom: 4 }}>Event Name</label>
            <input className="input" value={hhDraft.title} onChange={e => setHhDraft(d => ({ ...d, title: e.target.value }))} placeholder="Happy Hour" style={{ width: '100%', boxSizing: 'border-box' }} />
          </div>

          {/* Date + Time */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 12 }}>
            <div>
              <label style={{ fontSize: 11, color: 'var(--text-faint)', display: 'block', marginBottom: 4 }}>Date</label>
              <input type="date" className="input" value={hhDraft.date} onChange={e => setHhDraft(d => ({ ...d, date: e.target.value }))} style={{ width: '100%', boxSizing: 'border-box' }} />
            </div>
            <div>
              <label style={{ fontSize: 11, color: 'var(--text-faint)', display: 'block', marginBottom: 4 }}>Time</label>
              <input type="time" className="input" value={hhDraft.time} onChange={e => setHhDraft(d => ({ ...d, time: e.target.value }))} style={{ width: '100%', boxSizing: 'border-box' }} />
            </div>
          </div>

          {/* Address */}
          <div style={{ marginBottom: 12 }}>
            <label style={{ fontSize: 11, color: 'var(--text-faint)', display: 'block', marginBottom: 4 }}>Address <span style={{ color: 'var(--text-faint)', fontWeight: 400 }}>(optional — shows map)</span></label>
            <input className="input" value={hhDraft.address} onChange={e => setHhDraft(d => ({ ...d, address: e.target.value }))} placeholder="123 Main St, City, State" style={{ width: '100%', boxSizing: 'border-box' }} />
          </div>

          {/* Teams */}
          <div style={{ marginBottom: 18 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
              <label style={{ fontSize: 11, color: 'var(--text-faint)' }}>Invite Teams</label>
              <button className="btn ghost sm" style={{ fontSize: 10 }}
                onClick={() => setHhDraft(d => ({ ...d, teamIds: d.teamIds.length === LEAGUE_TEAMS.length ? [] : LEAGUE_TEAMS.map(t => t.id) }))}>
                {hhDraft.teamIds.length === LEAGUE_TEAMS.length ? 'Deselect All' : 'Select All'}
              </button>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 5, maxHeight: 210, overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 7, padding: 8 }}>
              {LEAGUE_TEAMS.map(t => {
                const checked = hhDraft.teamIds.includes(t.id);
                return (
                  <label key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', padding: '4px 6px', borderRadius: 5, background: checked ? 'rgba(198,255,58,.08)' : 'transparent', border: `1px solid ${checked ? 'rgba(198,255,58,.25)' : 'transparent'}`, transition: 'background .12s' }}>
                    <input type="checkbox" checked={checked}
                      onChange={() => setHhDraft(d => ({ ...d, teamIds: checked ? d.teamIds.filter(id => id !== t.id) : [...d.teamIds, t.id] }))}
                      style={{ accentColor: 'var(--accent)', cursor: 'pointer', flexShrink: 0 }} />
                    <span style={{ fontSize: 10, fontFamily: 'var(--font-mono)', fontWeight: 800, color: t.color || 'var(--accent)', minWidth: 22 }}>{t.logo}</span>
                    <span style={{ fontSize: 11, color: 'var(--text-dim)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.name}</span>
                  </label>
                );
              })}
            </div>
          </div>

          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button className="btn ghost sm" onClick={() => { setShowHHModal(false); setHhDraft(null); }}>Cancel</button>
            <button className="btn primary sm" onClick={saveHH} disabled={!hhDraft.date}>Save Event</button>
          </div>
        </div>
      </div>
    )}
    </>
  );
}

const RECAP_API = (typeof import.meta !== 'undefined' && import.meta.env?.VITE_API_BASE) || 'https://api.fantasai.net';

function WeeklyRecapBanner({ h2hWinData, starters, weekLabel, teamName }) {
  const [aiRecap, setAiRecap] = React.useState(null);
  const [aiLoading, setAiLoading] = React.useState(false);
  const [dismissed, setDismissed] = React.useState(false);

  if (!h2hWinData || dismissed) return null;
  const { opp, myScore, oppScore, isWinning, hasLive, finalCount } = h2hWinData;
  if (!hasLive) return null;

  const mvp = starters.reduce((best, e) => {
    const p = e.playerId ? findPlayer(e.playerId) : null;
    if (!p) return best;
    const pts = p.last || p.proj || 0;
    return pts > (best?.pts || 0) ? { name: p.name, pts, pos: p.pos } : best;
  }, null);

  const dud = starters.reduce((worst, e) => {
    const p = e.playerId ? findPlayer(e.playerId) : null;
    if (!p) return worst;
    const pts = p.last || p.proj || 0;
    return pts < (worst?.pts ?? 999) ? { name: p.name, pts, pos: p.pos } : worst;
  }, null);

  async function getAIRecap() {
    setAiLoading(true);
    try {
      const starterLines = starters.map(e => {
        const p = e.playerId ? findPlayer(e.playerId) : null;
        return p ? `${p.name} (${p.pos}): ${(p.last || p.proj || 0).toFixed(1)} pts` : null;
      }).filter(Boolean).join(', ');
      const question = `Write a 3-4 sentence weekly fantasy football recap for my team "${teamName}".
My team scored ${myScore.toFixed(1)} vs ${opp?.name} ${oppScore.toFixed(1)}. ${isWinning ? 'I WON.' : 'I LOST.'}
My starters: ${starterLines}
MVP: ${mvp?.name} (${mvp?.pts?.toFixed(1)} pts). Dud: ${dud?.name} (${dud?.pts?.toFixed(1)} pts).
Be fun and direct. Highlight the key performer and the biggest disappointment. End with one actionable tip for next week.`;
      const res = await fetch(`${RECAP_API}/api/v1/chat`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question, tier: 'simple' }),
        signal: AbortSignal.timeout(30000),
      });
      if (res.ok) { const data = await res.json(); setAiRecap(data.answer || ''); }
    } catch {} finally { setAiLoading(false); }
  }

  const resultColor = isWinning ? '#1affa0' : '#ff4f4f';
  const resultBg = isWinning ? 'rgba(26,255,160,.06)' : 'rgba(255,79,79,.06)';
  const resultBorder = isWinning ? 'rgba(26,255,160,.3)' : 'rgba(255,79,79,.3)';

  return (
    <div style={{ margin: '0 24px 8px', background: resultBg, border: `1px solid ${resultBorder}`, borderRadius: 10, padding: '14px 18px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: aiRecap ? 10 : 0 }}>
        <div style={{ fontSize: 22 }}>{isWinning ? '🏆' : '😤'}</div>
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 800, fontSize: 14, color: resultColor }}>
            {isWinning ? 'Victory!' : 'Tough Loss'} — {weekLabel}
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-dim)', marginTop: 2 }}>
            {teamName} <strong style={{ color: resultColor }}>{myScore.toFixed(1)}</strong> vs {opp?.name} {oppScore.toFixed(1)}
            {mvp && <span style={{ marginLeft: 8 }}>MVP: <strong>{mvp.name}</strong> ({mvp.pts.toFixed(1)})</span>}
            {dud && <span style={{ marginLeft: 8 }}>Dud: {dud.name} ({dud.pts.toFixed(1)})</span>}
          </div>
        </div>
        <button className="btn sm" style={{ background: 'rgba(198,255,58,.12)', borderColor: 'rgba(198,255,58,.3)', color: '#c6ff3a', fontWeight: 700, fontSize: 10 }} disabled={aiLoading} onClick={getAIRecap}>
          {aiLoading ? '⟳ Writing…' : aiRecap ? '↻ Refresh' : '🤖 AI Recap'}
        </button>
        <button onClick={() => setDismissed(true)} style={{ background: 'none', border: 'none', color: 'var(--text-faint)', cursor: 'pointer', fontSize: 14, padding: '4px', lineHeight: 1 }}>✕</button>
      </div>
      {aiRecap && (
        <div style={{ fontSize: 12, color: 'var(--text)', lineHeight: 1.7, whiteSpace: 'pre-wrap', borderTop: `1px solid ${resultBorder}`, paddingTop: 10 }}>
          {aiRecap}
        </div>
      )}
    </div>
  );
}
