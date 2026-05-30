import React from 'react';
import { TEAM_ROSTERS, PLAYERS, findPlayer, findTeam, NEWS, LEAGUE_TEAMS, buildRosterFrame, assignRoster } from '../lib/data.js';
import { PlayerCell, StatusDot, Sparkline, PosBadge, SourceBadge } from '../components/ui.jsx';
import { api } from '../api.js';
import { useApi } from '../hooks.js';
import { fetchSleeperPlayerStats } from '../lib/sleeper.js';
const SLOT_ELIGIBLE = {
  QB: ['QB'], RB: ['RB'], WR: ['WR'], TE: ['TE'],
  K: ['K'], DST: ['DST'], FLEX: ['RB', 'WR', 'TE'],
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
    const eligible = ['RB', 'WR', 'TE'].flatMap(pos => byPos[pos] || []).filter(p => !assigned.has(p.id)).sort((a, b) => (b.proj ?? 0) - (a.proj ?? 0));
    const best = eligible[0] ?? null;
    result.push({ slot, playerId: best?.id ?? null });
    if (best) assigned.add(best.id);
  }
  return result;
}

function LineupSummaryCard({ myRosterIds, slotOverrides, onOpenPlayer }) {
  const settings = React.useMemo(() => {
    try { return JSON.parse(localStorage.getItem('fantasai_league_settings') || 'null') || null; } catch { return null; }
  }, []);
  const frame = React.useMemo(() => buildRosterFrame(settings), [settings]);
  const rosterEntries = React.useMemo(() => assignRoster(frame, [...myRosterIds], slotOverrides ?? {}), [frame, myRosterIds, slotOverrides]);
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
    <div className="card">
      <div style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '.1em', marginBottom: 10 }}>
        Lineup Decisions
      </div>
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
    </div>
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
  return teams.map(ct => {
    const cbsId = String(ct.id || ct.team_id || '');
    const mock = LEAGUE_TEAMS.find(t => t.cbsId === cbsId) || LEAGUE_TEAMS.find(t => t.name === ct.name);
    const w = ct.w ?? ct.wins ?? 0;
    const l = ct.l ?? ct.losses ?? 0;
    const pf = ct.pf ?? ct.points_for ?? 0;
    const pa = ct.pa ?? ct.points_against ?? 0;
    const liveTeam = mock?.id ? findTeam(mock.id) : null;
    return { id: mock?.id, name: ct.name || mock?.name || '—', logo: mock?.logo || '??', logoImg: liveTeam?.logoImg || null, color: mock?.color || '#555', w, l, pf, pa, me: mock?.me };
  }).sort((a, b) => b.w - a.w || b.pf - a.pf);
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
  const [editing, setEditing] = React.useState(false);
  const [draft, setDraft]     = React.useState('');
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
      localStorage.setItem('fantasai_league_settings', JSON.stringify({ ...saved, draftDate: draft }));
    } catch {}
    setDraftDate(draft);
    setEditing(false);
  }

  if (editing) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <input type="datetime-local" className="input" style={{ fontSize: 12, padding: '4px 8px' }}
          value={draft} onChange={e => setDraft(e.target.value)} />
        <button className="btn sm primary" onClick={save}>Save</button>
        <button className="btn sm ghost" onClick={() => setEditing(false)}>✕</button>
      </div>
    );
  }

  if (!draftDate) {
    if (!canEdit) return null;
    return (
      <button className="btn ghost" style={{ fontSize: 11 }}
        onClick={() => { setDraft(''); setEditing(true); }}>
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
          onClick={() => { setDraft(draftDate || ''); setEditing(true); }} title="Edit draft date">✏</button>
      )}
    </div>
  );
}

export default function Dashboard({ onNav, onOpenPlayer, user, myRosterIds = new Set(), sourcesState, slotOverrides = {}, watchlistIds = new Set(), tradeOffers = [] }) {
  const { data: cbsTeams } = useApi(() => api.teams(), []);
  const standings = React.useMemo(() => buildStandings(cbsTeams), [cbsTeams]);
  const currentWeek = React.useMemo(getCurrentWeek, []);
  const nextWeek    = React.useMemo(getNextWeek, []);
  const weekLabel   = currentWeek.label;
  const isOffseason = currentWeek.key === 'offseason';
  const isPre       = currentWeek.pre;

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
  const [editingCommish, setEditingCommish] = React.useState(false);
  const [commishTextDraft, setCommishTextDraft] = React.useState('');
  const [commishMediaDraft, setCommishMediaDraft] = React.useState(null);
  const [commishUrlDraft, setCommishUrlDraft] = React.useState('');
  const commishMediaRef = React.useRef(null);

  function getCommishEmbedUrl(raw) {
    try {
      const u = new URL(raw);
      if (u.hostname.includes('youtube.com') && u.searchParams.get('v'))
        return `https://www.youtube.com/embed/${u.searchParams.get('v')}`;
      if (u.hostname === 'youtu.be')
        return `https://www.youtube.com/embed${u.pathname}`;
      if (u.hostname.includes('vimeo.com'))
        return `https://player.vimeo.com/video/${u.pathname.split('/').filter(Boolean).pop()}`;
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
  const myStandingsRank = standings ? standings.findIndex(s => s.me) + 1 : null;
  const waiverPosition  = myStandingsRank ? (totalTeams - myStandingsRank + 1) : null;

  // Build starting lineup from league settings frame (stays in sync with CurrentRoster)
  const rosterSettings = React.useMemo(() => {
    try { return JSON.parse(localStorage.getItem('fantasai_league_settings') || 'null'); } catch { return null; }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const slotFrame  = React.useMemo(() => buildRosterFrame(rosterSettings), [rosterSettings]);
  const fullRoster = React.useMemo(
    () => assignRoster(slotFrame, myRosterIds, slotOverrides),
    [slotFrame, myRosterIds, slotOverrides],
  );

  const starters   = fullRoster.filter(r => r.slot !== 'BENCH' && r.playerId);
  const rosterIds  = new Set(fullRoster.map(r => r.playerId).filter(Boolean));
  const starterIds = new Set(starters.map(r => r.playerId).filter(Boolean));
  const totalProj  = starters.reduce((s, r) => s + (findPlayer(r.playerId)?.proj || 0), 0);

  // Roster validity (same rules as HeadToHead isRosterSet)
  const _hasSlot = slot => starters.some(r => r.slot === slot);
  const _countSlot = slot => starters.filter(r => r.slot === slot).length;
  const isValidRoster = _hasSlot('QB') && _hasSlot('DST') && _countSlot('RB') >= 1 && _countSlot('WR') >= 1
    && starters.filter(r => ['RB', 'WR', 'TE', 'FLEX'].includes(r.slot)).length >= 5;
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
  const [championsOpen, setChampionsOpen]           = React.useState(false);
  const canEditChampions = user?.isAdmin || user?.isCommissioner;

  function startEditChampions() {
    setChampDraft(champions.map(c => ({ ...c })));
    setEditingChampions(true);
  }
  function saveChampions() {
    setChampions(champDraft);
    localStorage.setItem(CHAMP_KEY, JSON.stringify(champDraft));
    setEditingChampions(false);
  }
  function updateDraft(i, patch) {
    setChampDraft(prev => prev.map((c, idx) => idx === i ? { ...c, ...patch } : c));
  }

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
    <div className="col" style={{ height: '100%', overflow: 'auto' }}>
      <div className="page-head">
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
          <DraftCountdown canEdit={canEditCommish} />
          <button className="btn ghost" onClick={() => onNav('roster')}>Set Lineup</button>
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
          <div style={{ padding: '0 24px 16px' }}>
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
                  <div style={{ fontFamily: 'var(--font-display)', fontWeight: 900, fontStretch: '75%', fontSize: 32, color: isWinning ? 'var(--good)' : 'var(--text)', lineHeight: 1 }}>
                    {myScore.toFixed(1)}
                  </div>
                  {hasLive && myLive !== myProj && (
                    <div style={{ fontSize: 9, fontFamily: 'var(--font-mono)', color: 'var(--text-faint)', marginTop: 2 }}>
                      LIVE ADJ
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
                <div style={{ fontFamily: 'var(--font-display)', fontWeight: 900, fontStretch: '75%', fontSize: 32, color: !isWinning ? 'var(--danger)' : 'var(--text-dim)', lineHeight: 1, marginRight: 'auto' }}>
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

      <div style={{ padding: 24, display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
        <div className="stat">
          <div className="k">Starters Projected</div>
          <div className="v accent">{totalProj.toFixed(1)}</div>
          <div className="sub">{starters.length} of 8 slots filled</div>
        </div>
        {h2hWinData ? (
          <div className="stat">
            <div className="k">Win Probability</div>
            <div className="v" style={{ color: h2hWinData.isWinning ? 'var(--good)' : 'var(--danger)' }}>{h2hWinData.winPct}%</div>
            <div className="sub" style={{ color: h2hWinData.isWinning ? 'var(--good)' : 'var(--danger)' }}>
              vs {h2hWinData.opp.name} · {h2hWinData.diff >= 0 ? '+' : ''}{h2hWinData.diff.toFixed(1)} pts
            </div>
          </div>
        ) : (
          <div className="stat"><div className="k">Win Probability</div><div className="v">—</div><div className="sub">No matchup</div></div>
        )}
        <div className="stat"><div className="k">Season Avg</div><div className="v">128.5</div><div className="sub">2nd in league</div></div>
        <div className="stat"><div className="k">Playoff Odds</div><div className="v">84.2%</div><div className="sub">Top seed: 21.8%</div></div>
      </div>

      <div style={{ padding: '0 24px 24px', display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: 16 }}>
        <div className="card">
          <div className="card-head">
            <div style={{ display: 'flex', alignItems: 'center', gap: 14, flex: 1 }}>
              {team?.logoImg ? (
                <img src={team.logoImg} alt="logo" style={{ width: 56, height: 56, borderRadius: 10, objectFit: 'cover', flexShrink: 0, boxShadow: '0 2px 12px rgba(0,0,0,.4)' }} />
              ) : (
                <span style={{ width: 56, height: 56, borderRadius: 10, background: team?.color || 'var(--accent)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, fontWeight: 900, color: logoTextColor, flexShrink: 0, boxShadow: '0 2px 12px rgba(0,0,0,.4)' }}>
                  {team?.logo || '??'}
                </span>
              )}
            <div>
              <div className="card-title" style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                Starting Lineup — {teamName}
                {(() => {
                  const wkNum  = currentWeek.num;
                  const opp    = wkNum ? getOpponent(teamId, wkNum) : null;
                  const wkStr  = wkNum ? `Wk${wkNum}${opp ? ` vs ${opp.name}` : ''}` : null;
                  if (!isValidRoster) {
                    return (
                      <span style={{ fontSize: 10, fontFamily: 'var(--font-mono)', fontWeight: 700, color: '#fff', background: 'var(--danger)', borderRadius: 4, padding: '2px 7px' }}>
                        Roster Not Set{wkStr ? ` · ${wkStr}` : ''}
                      </span>
                    );
                  }
                  if (hasStarterInjury) {
                    return (
                      <span style={{ fontSize: 10, fontFamily: 'var(--font-mono)', fontWeight: 700, color: '#1a0d00', background: 'var(--warn)', borderRadius: 4, padding: '2px 7px' }}>
                        Valid Roster · Injury Watch{wkStr ? ` · ${wkStr}` : ''}
                      </span>
                    );
                  }
                  return (
                    <span style={{ fontSize: 10, fontFamily: 'var(--font-mono)', fontWeight: 700, color: '#042210', background: 'var(--good)', borderRadius: 4, padding: '2px 7px' }}>
                      Valid Roster{wkStr ? ` · ${wkStr}` : ''}
                    </span>
                  );
                })()}
              </div>
              <div style={{ fontSize: 11, color: 'var(--text-faint)', marginTop: 4, display: 'flex', alignItems: 'center', gap: 10 }}>
                <span>Manager: <strong style={{ color: 'var(--text-dim)', fontWeight: 600 }}>{ownerName}</strong></span>
                <span style={{ color: 'var(--border-strong)' }}>·</span>
                <span>
                  Record:{' '}
                  <span className="mono" style={{ fontWeight: 700, color: record2026 === '0-0' ? 'var(--text-faint)' : 'var(--accent)', fontSize: 11 }}>
                    {record2026}
                  </span>
                  {record2026 === '0-0' && (
                    <span className="mono faint" style={{ fontSize: 9, marginLeft: 4 }}>no games yet</span>
                  )}
                </span>
              </div>
            </div>
            </div>
            <button className="btn sm ghost" onClick={() => onNav('roster')}>Edit →</button>
          </div>
          <table className="data-table">
            <thead>
              <tr>
                <th>Slot</th>
                <th>Player</th>
                <th>Opp</th>
                {projCols.map(c => (
                  <th key={c.id} className="num" style={{ whiteSpace: 'nowrap' }}>
                    <span style={{ color: c.color }}>{c.label}</span>
                    <div style={{ fontSize: 8, fontFamily: 'var(--font-mono)', color: 'var(--text-faint)', fontWeight: 400, textTransform: 'uppercase', letterSpacing: '.06em', marginTop: 1 }}>{c.sub}</div>
                  </th>
                ))}
                <th>Status</th>
                <th className="num">Trend</th>
              </tr>
            </thead>
            <tbody>
              {starters.length === 0 && (
                <tr>
                  <td colSpan={4 + projCols.length} style={{ textAlign: 'center', padding: '24px 0', color: 'var(--text-faint)', fontSize: 12 }}>
                    No starters found — <button className="btn ghost sm" onClick={() => onNav('roster')} style={{ fontSize: 11 }}>Set your lineup</button>
                  </td>
                </tr>
              )}
              {starters.map(r => {
                const p = findPlayer(r.playerId);
                if (!p) return null;
                return (
                  <tr key={r.playerId} onClick={() => onOpenPlayer(p.id)} style={{ cursor: 'pointer' }}>
                    <td><PosBadge pos={r.slot} /></td>
                    <td><PlayerCell player={p} /></td>
                    <td className="mono dim" style={{ fontSize: 11 }}>vs {p.opp}</td>
                    {projCols.map(c => (
                      <td key={c.id} className="num">
                        <strong style={{ color: c.color }}>{c.get(p)}</strong>
                      </td>
                    ))}
                    <td>
                      {p.status !== 'OK'
                        ? <span className="status-pill"><StatusDot status={p.status} /> {p.status}</span>
                        : <span className="faint" style={{ fontSize: 11 }}>—</span>}
                    </td>
                    <td className="num"><Sparkline data={p.trend} /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* ── Middle column: Commissioner Message then Lineup Decisions ── */}
        <div className="col gap-12" style={{ alignSelf: 'start' }}>

        {/* Commissioner Message — center column */}
        <div className="card" style={{ borderLeft: '3px solid var(--accent)', alignSelf: 'start' }}>
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
              {/* Media preview while editing */}
              {commishMediaDraft?.url && (
                <div style={{ position: 'relative' }}>
                  {commishMediaDraft.type === 'image'
                    ? <img src={commishMediaDraft.url} alt="" style={{ width: '100%', maxHeight: 160, objectFit: 'cover', borderRadius: 6, display: 'block' }} />
                    : <video src={commishMediaDraft.url} controls autoPlay={false} style={{ width: '100%', maxHeight: 140, borderRadius: 6, display: 'block' }} />
                  }
                  <button
                    onClick={() => setCommishMediaDraft(null)}
                    style={{ position: 'absolute', top: 5, right: 5, background: 'rgba(0,0,0,.7)', border: 'none', borderRadius: 4, color: '#fff', fontSize: 11, padding: '2px 7px', cursor: 'pointer' }}
                  >✕ Remove</button>
                </div>
              )}
              {/* Message textarea */}
              <textarea
                className="input"
                rows={4}
                value={commishTextDraft}
                onChange={e => setCommishTextDraft(e.target.value)}
                style={{ resize: 'vertical', fontSize: 12, lineHeight: 1.6, width: '100%', boxSizing: 'border-box' }}
                placeholder="Type your commissioner message…"
              />
              {/* Video URL */}
              <input
                className="input"
                placeholder="YouTube / Vimeo URL (optional)…"
                value={commishUrlDraft}
                onChange={e => setCommishUrlDraft(e.target.value)}
                style={{ fontSize: 12 }}
              />
              {/* File upload + actions */}
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                <input ref={commishMediaRef} type="file" accept="image/*,video/*" style={{ display: 'none' }} onChange={handleCommishMediaUpload} />
                <button className="btn ghost sm" onClick={() => commishMediaRef.current?.click()} style={{ fontSize: 11 }}>
                  📷 {commishMediaDraft?.url ? 'Replace File' : 'Upload Image / Video'}
                </button>
                <button className="btn primary sm" onClick={saveCommishMessage}>Save</button>
                <button className="btn ghost sm" onClick={() => setEditingCommish(false)}>Cancel</button>
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
                  <iframe
                    src={getCommishEmbedUrl(commishData.media.videoUrl)}
                    style={{ width: '100%', height: 180, borderRadius: 6, border: 'none', display: 'block' }}
                    allow="accelerometer; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                    allowFullScreen
                    title="Commissioner Video"
                  />
                </div>
              )}
              {commishData.text && (
                <div style={{ padding: '4px 16px 14px', fontSize: 12, color: 'var(--text-dim)', lineHeight: 1.65 }}>
                  {commishData.text}
                </div>
              )}
            </>
          )}
        </div>

        {/* Lineup Decisions — bullet summary */}
        <LineupSummaryCard myRosterIds={myRosterIds} slotOverrides={slotOverrides} onOpenPlayer={onOpenPlayer} />

        </div>{/* end middle column */}

        {/* Right column: Champions Corner + News */}
        <div className="col gap-12">

        {/* ── Champions Corner — expandable card ── */}
        <div style={{
          background: 'linear-gradient(135deg, rgba(255,215,0,.07) 0%, rgba(255,215,0,.02) 100%)',
          border: '1px solid rgba(255,215,0,.22)',
          borderRadius: 10,
          overflow: 'hidden',
          alignSelf: 'start',
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
                    <span style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'rgba(255,215,0,.5)' }}>{latest.year}</span>
                    <span style={{ fontSize: 12, fontWeight: 800, color: '#FFD700' }}>{latest.champion}{latest.asterisk ? '*' : ''}</span>
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
            <div style={{ borderTop: '1px solid rgba(255,215,0,.12)', padding: '10px 14px' }}>
              {editingChampions ? (
                <div>
                  {champDraft.map((c, i) => (
                    <div key={c.year} style={{ display: 'grid', gridTemplateColumns: 'auto 1fr auto', gap: 6, alignItems: 'center', marginBottom: 6 }}>
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
                      {c.asterisk && (
                        <input
                          className="input"
                          value={c.note}
                          onChange={e => updateDraft(i, { note: e.target.value })}
                          placeholder="Reason for asterisk…"
                          style={{ gridColumn: '2 / 4', fontSize: 10, padding: '2px 7px', background: 'rgba(255,215,0,.04)', borderColor: 'rgba(255,215,0,.15)', marginTop: -2 }}
                        />
                      )}
                    </div>
                  ))}
                  <div style={{ display: 'flex', gap: 6, marginTop: 10 }}>
                    <button className="btn primary sm" onClick={saveChampions}>Save</button>
                    <button className="btn ghost sm" style={{ borderColor: 'rgba(255,215,0,.3)', color: 'rgba(255,215,0,.6)' }} onClick={() => setEditingChampions(false)}>Cancel</button>
                  </div>
                </div>
              ) : (
                <div>
                  {champions.map((c, i) => {
                    const hasNote = c.asterisk && c.note;
                    return (
                      <div
                        key={c.year}
                        style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0', borderBottom: i < champions.length - 1 ? '1px solid rgba(255,215,0,.07)' : 'none', position: 'relative' }}
                        onMouseEnter={() => hasNote && setChampTooltip(c.year)}
                        onMouseLeave={() => setChampTooltip(null)}
                      >
                        <span style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'rgba(255,215,0,.5)', fontWeight: 700, minWidth: 36 }}>{c.year}</span>
                        {c.champion ? (
                          <span style={{ fontSize: 12, fontWeight: 700, color: '#FFD700', flex: 1 }}>
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
                            fontSize: 11, color: 'var(--text-dim)', boxShadow: '0 4px 16px rgba(0,0,0,.5)',
                            pointerEvents: 'none',
                          }}>
                            <span style={{ color: '#FFD700', fontWeight: 700, marginRight: 4 }}>*</span>{c.note}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>

          <div className="card">
            <div className="card-head">
              <div className="card-title">
                {ownerName}'s Lineup News
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                {newsLoading && <span className="mono faint" style={{ fontSize: 9 }}>fetching…</span>}
                {sleeperOn && !newsLoading && liveNewsItems.length > 0 && (
                  <span style={{ fontSize: 9, fontFamily: 'var(--font-mono)', color: 'var(--accent-2)', background: 'rgba(78,168,255,.1)', border: '1px solid rgba(78,168,255,.25)', borderRadius: 3, padding: '1px 5px' }}>
                    SLEEPER · LIVE
                  </span>
                )}
                {!sleeperOn && <span className="mono faint" style={{ fontSize: 9 }}>mock data</span>}
              </div>
            </div>
            <div>
              {rosterNews.length === 0 && !newsLoading && (
                <div style={{ padding: '14px 16px', fontSize: 12, color: 'var(--text-faint)' }}>No news for your starters — all clear.</div>
              )}
              {newsLoading && rosterNews.length === 0 && (
                <div style={{ padding: '14px 16px', fontSize: 12, color: 'var(--text-faint)', display: 'flex', alignItems: 'center', gap: 8 }}>
                  <div className="ai-orb" style={{ width: 12, height: 12 }} />
                  Checking Sleeper for roster news…
                </div>
              )}
              {rosterNews.map(n => {
                const p = findPlayer(n.playerId);
                if (!p) return null;
                const impactColor = n.impact === 'high' ? 'var(--danger)' : n.impact === 'good' ? 'var(--good)' : n.impact === 'med' ? 'var(--warn)' : 'var(--text-faint)';
                return (
                  <div
                    key={n.id}
                    style={{
                      padding: '10px 14px',
                      borderBottom: '1px solid var(--border)',
                      fontSize: 12,
                      cursor: 'pointer',
                      borderLeft: n.live ? `2px solid ${impactColor}` : undefined,
                    }}
                    onClick={() => onOpenPlayer(p.id)}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 3 }}>
                      <span className="mono dim" style={{ fontSize: 11 }}>{p.name} · {p.pos} · {p.team}</span>
                      <div style={{ display: 'flex', gap: 5, alignItems: 'center' }}>
                        {n.live && (
                          <span style={{ fontSize: 8, fontFamily: 'var(--font-mono)', color: 'var(--accent-2)' }}>LIVE</span>
                        )}
                        <span className={`news-impact impact-${n.impact}`} style={{ fontSize: 9 }}>{n.impact}</span>
                      </div>
                    </div>
                    <div style={{ fontWeight: 600, marginBottom: n.body ? 3 : 0 }}>{n.title}</div>
                    {n.body && <div className="dim" style={{ fontSize: 11, lineHeight: 1.4 }}>{n.body}</div>}
                    <div style={{ marginTop: 4 }}><SourceBadge source={n.source} /></div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
      <div style={{ padding: '0 24px 24px', display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 16, alignItems: 'start' }}>
        <div className="card">
          <div className="card-head">
            <div className="card-title">League Standings · {weekLabel}</div>
            <span className="mono faint" style={{ fontSize: 10 }}>{standings ? 'CBS · live' : 'mock data'}</span>
          </div>
          <table className="data-table">
            <thead>
              <tr><th style={{ width: 32 }}>#</th><th>Team</th><th className="num">W</th><th className="num">L</th><th className="num">PF</th><th className="num">PA</th></tr>
            </thead>
            <tbody>
              {(standings || LEAGUE_TEAMS.map(t => { const lt = findTeam(t.id); return { ...t, ...lt, w: 0, l: 0, pf: 0, pa: 0 }; })).map((row, i) => (
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
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <WeeklyCalendar weekLabel={weekLabel} waiverPosition={waiverPosition} totalTeams={totalTeams} />
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

function formatSpread(odds, away, home) {
  if (!odds?.details) return null;
  // ESPN "details" is already formatted, e.g. "KC -3" or "PK"
  return odds.details;
}

function WeeklyCalendar({ weekLabel, waiverPosition, totalTeams }) {
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

  const grouped = React.useMemo(() => {
    const g = {};
    for (const evt of events) {
      if (!g[evt.day]) g[evt.day] = [];
      g[evt.day].push(evt);
    }
    return g;
  }, [events]);

  const activeDays = DAY_ORDER.filter(d => grouped[d]?.length > 0);

  return (
    <div className="card" style={{ position: 'sticky', top: 0 }}>
      <div className="card-head">
        <div className="card-title">Weekly Events</div>
        <span className="mono faint" style={{ fontSize: 10 }}>{weekLabel}</span>
      </div>
      <div>
        {activeDays.map(day => {
          const isToday = day === todayDay;
          const dayEvts = [...(grouped[day] || [])].sort((a, b) => a.time.localeCompare(b.time));
          return (
            <div key={day} style={{ borderTop: '1px solid var(--border)' }}>
              <div style={{
                padding: '6px 14px 4px', fontSize: 10, fontWeight: 700,
                letterSpacing: '.1em', textTransform: 'uppercase',
                color: isToday ? 'var(--accent)' : 'var(--text-faint)',
                background: isToday ? 'rgba(198,255,58,.06)' : undefined,
                display: 'flex', alignItems: 'center', gap: 6,
              }}>
                {day}
                {isToday && <span style={{ fontSize: 8, background: 'var(--accent)', color: '#0a1300', borderRadius: 3, padding: '1px 5px', fontWeight: 800 }}>TODAY</span>}
              </div>

              {dayEvts.map(evt => {
                const game     = slotGame[evt.id];
                const isWaiver = evt.type === 'waiver';
                const typeColor = TYPE_COLOR[evt.type] ?? TYPE_COLOR.other;

                // For non-game events or events without live data — compact row
                if (!game) {
                  return (
                    <div key={evt.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 14px 5px 18px' }}>
                      <span style={{ fontSize: 9, fontFamily: 'var(--font-mono)', fontWeight: 700, color: typeColor, flexShrink: 0, width: 44 }}>
                        {TYPE_LABEL[evt.type] ?? 'EVENT'}
                      </span>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <span style={{ fontSize: 11, color: 'var(--text-dim)' }}>{evt.label}</span>
                        {isWaiver && waiverPosition && (
                          <span style={{ marginLeft: 7, fontSize: 9, fontFamily: 'var(--font-mono)', color: 'var(--warn)' }}>
                            #{waiverPosition}{totalTeams ? ` of ${totalTeams}` : ''} priority
                          </span>
                        )}
                      </div>
                      <span style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--text-faint)', flexShrink: 0 }}>{evt.time}</span>
                    </div>
                  );
                }

                // Rich game card for primetime matchups with live ESPN data
                const awayAbbr   = game.away?.abbr?.toUpperCase() ?? '';
                const homeAbbr   = game.home?.abbr?.toUpperCase() ?? '';
                const awayName   = game.away?.name ?? awayAbbr;
                const homeName   = game.home?.name ?? homeAbbr;
                const gameTime   = formatGameTime(game.date);
                const spread     = formatSpread(game.odds, game.away, game.home);
                const overUnder  = game.odds?.overUnder != null ? `O/U ${game.odds.overUnder}` : null;
                const network    = game.broadcasts?.filter(b => b && b.trim()).join(' · ') || null;
                const awayInjuries = (injuryByTeam[awayAbbr] || []).slice(0, 4);
                const homeInjuries = (injuryByTeam[homeAbbr] || []).slice(0, 4);
                const hasInjuries  = awayInjuries.length > 0 || homeInjuries.length > 0;

                return (
                  <div key={evt.id} style={{ margin: '4px 10px 6px', borderRadius: 7, border: `1px solid rgba(78,168,255,.18)`, background: 'rgba(78,168,255,.04)', overflow: 'hidden' }}>
                    {/* Header row: label + time */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px 4px', borderBottom: '1px solid rgba(255,255,255,.06)' }}>
                      <span style={{ fontSize: 9, fontFamily: 'var(--font-mono)', fontWeight: 700, color: typeColor, flexShrink: 0 }}>
                        {TYPE_LABEL[evt.type] ?? 'GAME'}
                      </span>
                      <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text)', flex: 1 }}>{evt.label}</span>
                      {gameTime && (
                        <span style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--text-faint)', flexShrink: 0 }}>{gameTime}</span>
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
                  </div>
                );
              })}
            </div>
          );
        })}
        {activeDays.length === 0 && (
          <div style={{ padding: '14px 16px', fontSize: 12, color: 'var(--text-faint)' }}>No events — set them in Rules &amp; Settings → Schedule.</div>
        )}
      </div>
    </div>
  );
}
