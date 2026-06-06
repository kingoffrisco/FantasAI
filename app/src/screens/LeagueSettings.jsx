import React from 'react';
import { LEAGUE_TEAMS } from '../lib/data.js';
import { TeamLogoBadge } from '../components/ui.jsx';
import { getLiveTeams, getLiveSettings, getLeagueId } from '../lib/leagueStore.js';
import { api } from '../api.js';
import { sendLeaguePush } from '../lib/pushNotifications.js';

const STORAGE_KEY = 'fantasai_league_settings';
const MEDIA_KEY   = 'fantasai_commish_media';
const API_BASE    = 'https://api.fantasai.net';

const DEFAULTS = {
  // General
  fantasaiKey:  '',
  leagueName:   'ATO Tau League',
  leagueUrl:    'https://atotauleague.football.cbssports.com',
  leagueEmail:  'atotauleague@football.cbssports.com',
  numTeams:     12,
  entryFee:     200,
  playerPool:   'AFC and NFC Players',
  commishMessage: "Welcome to ATO Tau League! The league's commissioner can use this space to keep managers informed about important decisions, events or anything that requires everyone's attention. Check this message frequently in case there is an important announcement.",

  // Roster limits
  roster: {
    starters:        { min: 8,  max: 8  },
    bench:           { min: 6,  max: 6  },
    injuredPlayers:  { min: 0,  max: 0  },
    practicePlayers: { min: 0,  max: 0  },
    totalPlayers:    { min: 14, max: 14 },
  },
  positions: [
    { key: 'QB',    label: 'QB',     activeMin: 1, activeMax: 1, rosterTotal: '2'        },
    { key: 'RB',    label: 'RB',     activeMin: 1, activeMax: 1, rosterTotal: 'No Limit' },
    { key: 'WR',    label: 'WR',     activeMin: 1, activeMax: 1, rosterTotal: 'No Limit' },
    { key: 'TE',    label: 'TE',     activeMin: 1, activeMax: 1, rosterTotal: 'No Limit' },
    { key: 'RBWR',  label: 'RB-WR',  activeMin: 3, activeMax: 3, rosterTotal: 'No Limit' },
    { key: 'DST',   label: 'D/ST',   activeMin: 1, activeMax: 1, rosterTotal: 'No Limit' },
  ],
  extraRosterSettings: [
    'Illegal rosters score zero points in standings.',
    'Enforce strict roster limits during Add/Drops.',
  ],

  // Transactions
  transactions: {
    lineupPolicy:    'Managers may set lineups and change players\' positions from a list of their eligible positions.',
    lineupDeadline:  'Lineup deadline is five minutes before gametime for each player.',
    addDropPolicy:   'Add/Drops are handled by a waivers process.',
    addDropDeadline: 'Transactions will lock five minutes before the first game on Sunday (excluding Europe games). Players whose teams already played will be locked for the remainder of the scoring period.',
    waiversRun:      'Wednesday, Thursday, Friday and Saturday night.',
    waiverReset:     'The waiver order doesn\'t reset (always based on prior waivers run).',
    waiverPeriod:    'Dropped players remain on waivers for at least 1 day(s).',
    waiverLimits:    'No limit on the number of waiver offers per period.',
    tradePolicy:     'Trades must be approved by the commissioner.',
    tradeDeadline:   'No trades can be made after the trade deadline of 11:59 pm ET 12/4/26.',
    offseasonTrades: 'Managers may not make trades during the offseason.',
  },

  // Scoring — offensive
  offensiveScoring: [
    { code: 'FG',     name: 'Field Goals',                                                   value: '3 points' },
    { code: 'FL',     name: 'Fumble Lost, Including ST plays',                               value: '-1 point' },
    { code: 'Fum2PK', name: 'Fumble Recovery Two-point Conversion, Kicking formation',      value: '2 points' },
    { code: 'Fum2PT', name: 'Fumble Recovery Two-point Conversion, Two-point formation',    value: '2 points' },
    { code: 'OFRTD',  name: 'Offensive Fumble Recovery TD',                                  value: '6 points' },
    { code: 'Pa2P',   name: 'Passing Two-point Conversion',                                  value: '2 points' },
    { code: 'PaInt',  name: 'Passing Interception',                                          value: '-1 point' },
    { code: 'PaTD',   name: 'Passing TD',                                                    value: '4 points\nPlus 2 points for a PaTD of 50 to 99 Yds' },
    { code: 'PaYd',   name: 'Passing Yards',                                                 value: '0+ PaYds = .04 points for every 1 PaYd\nPlus a 2 point bonus @ 300+ PaYd\nPlus a 2 point bonus @ 400+ PaYd\nPlus a 3 point bonus @ 500+ PaYd' },
    { code: 'Re2P',   name: 'Receiving Two-point Conversion',                                value: '2 points' },
    { code: 'ReTD',   name: 'Receiving TD',                                                  value: '6 points\nPlus 2 points for a ReTD of 50 to 99 Yds' },
    { code: 'ReYd',   name: 'Receiving Yards',                                               value: '0+ ReYds = .1 points for every 1 ReYd\nPlus a 2 point bonus @ 100+ ReYd\nPlus a 2 point bonus @ 200+ ReYd\nPlus a 3 point bonus @ 300+ ReYd' },
    { code: 'Ru2P',   name: 'Rushing Two-point Conversion',                                  value: '2 points' },
    { code: 'RuTD',   name: 'Rushing TD',                                                    value: '6 points\nPlus 2 points for a RuTD of 40 to 99 Yds' },
    { code: 'RuYd',   name: 'Rushing Yards',                                                 value: '0+ RuYds = .1 points for every 1 RuYd\nPlus a 2 point bonus @ 100+ RuYd\nPlus a 2 point bonus @ 200+ RuYd\nPlus a 3 point bonus @ 300+ RuYd' },
    { code: 'XP',     name: 'Extra Points',                                                  value: '1 point' },
  ],

  // Scoring — defensive
  defensiveScoring: [
    { code: 'BFB',   name: 'Blocked Field Goals (ID/ST/DST)',                             value: '3 points' },
    { code: 'BP',    name: 'Blocked Punts (ID/ST/DST)',                                   value: '2 points' },
    { code: 'BXP',   name: 'Blocked Extra Points (ID/ST/DST)',                            value: '2 points' },
    { code: 'DFR',   name: 'Defensive/ST Fumble Recovered (ID/DT/DST)',                   value: '2 points' },
    { code: 'DSTPA', name: 'Points Against Defense/ST',                                   value: '0 - 6 DSTPAs = 8 points\n7 - 13 DSTPAs = 6 points\n14 - 20 DSTPAs = 4 points\n21 - 27 DSTPAs = 2 points' },
    { code: 'DTD',   name: 'Total Defensive and Special Teams TD',                        value: '6 points' },
    { code: 'Int',   name: 'Interceptions',                                               value: '2 points' },
    { code: 'SACK',  name: 'Sack',                                                        value: '1 point' },
    { code: 'ST2PT', name: 'Special Teams Conversion Return for Two-points (ID/ST/DST)', value: '2 points' },
    { code: 'STY',   name: 'Safety',                                                      value: '5 points' },
    { code: 'YDS',   name: 'Yards Allowed',                                               value: '0 points' },
  ],

  // Scoring policies
  scoringPolicies: {
    system:              'Head-to-Head, Points',
    perPeriod:           'Scoring based on total stats each period.',
    matchupTiebreaker:   'No tiebreaker. Ties are allowed.',
  },

  // Schedule & playoffs
  schedule: {
    matchupsPerPeriod:         1,
    playoffsStart:             'Week 15',
    playoffsLength:            '3 Weeks',
    automaticPlayoffs:         'No',
    archiveStandings:          'Yes',
    standingsTiebreaker:       'Winning Percentage, Total Points, Head to Head Record.',
    divisionWinnerTiebreaker:  'Ties for division winner are resolved using standings tiebreakers.',
    playoffsTiebreaker:        'Playoff ties go to the team with better TotYd.',
  },

  // Weekly events shown on the Dashboard calendar (Commissioner/Admin settable)
  weeklyEvents: [
    { id: 'thu-tnf',   day: 'Thursday',   time: '8:20 PM ET',  label: 'Thursday Night Football', type: 'game'   },
    { id: 'sun-early', day: 'Sunday',     time: '1:00 PM ET',  label: 'Early Games',             type: 'game'   },
    { id: 'sun-late',  day: 'Sunday',     time: '4:05 PM ET',  label: 'Late Games',              type: 'game'   },
    { id: 'sun-snf',   day: 'Sunday',     time: '8:20 PM ET',  label: 'Sunday Night Football',   type: 'game'   },
    { id: 'mon-mnf',   day: 'Monday',     time: '8:15 PM ET',  label: 'Monday Night Football',   type: 'game'   },
    { id: 'wed-wvr',   day: 'Wednesday',  time: '11:59 PM ET', label: 'Waivers Run',             type: 'waiver' },
    { id: 'sun-lock',  day: 'Sunday',     time: '12:55 PM ET', label: 'Lineup Lock',             type: 'lock'   },
  ],

  // Divisions & matchup schedule
  divisions: {
    div1: { name: 'Division 1', teamIds: [] },
    div2: { name: 'Division 2', teamIds: [] },
  },
  matchupSchedule: {}, // { [week]: [[homeId, awayId], ...] }

  // Waiver Rules
  waiverRules: {
    days: ['Wednesday', 'Thursday', 'Friday', 'Saturday'],
    resetPolicy: 'no-reset',
    period: 1,
    limits: 'no-limit',
    prioritySystem: 'continuous',
    faabBudget: 100,
    additionalRules: 'Waivers run Wednesday–Saturday night.\nWaiver order does not reset. Dropped players on waivers for 1 day minimum.',
  },

  // Draft Settings
  draft: {
    format: 'Snake',
    date: '',
  },

  // League Fees
  fees: {
    method: '',    // venmo | paypal | cashapp | zelle | other
    handle: '',
    amount: '',
    link: '',
    note: '',
    payments: {},  // teamId → { paid: bool, paidAt: string|null }
  },

  // Playoff Rules
  playoffRules: {
    startDate: '',
    startWeek: 15,
    numTeams: 6,
    length: 3,
    tiebreaker: 'Total Yards (TotYd)',
    bracket: {},
    additionalRules: 'Top 6 teams qualify. Playoffs start Week 15, last 3 weeks.\nPlayoff ties resolved by total yards (TotYd).',
  },
};

function load() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
    if (saved) return { ...DEFAULTS, ...saved };
  } catch {}
  return DEFAULTS;
}
function persist(data) { localStorage.setItem(STORAGE_KEY, JSON.stringify(data)); }

const TABS = [
  { id: 'general',        label: 'General' },
  { id: 'roster',         label: 'Roster' },
  { id: 'scoring',        label: 'Scoring' },
  { id: 'transactions',   label: 'Transactions' },
  { id: 'schedule',       label: 'Schedule' },
  { id: 'matchups',       label: 'Matchups' },
  { id: 'waivers',        label: 'Waiver Rules' },
  { id: 'playoffs',       label: 'Playoff Rules' },
  { id: 'league-message', label: 'League Message' },
];

// ── Schedule generation helpers ────────────────────────────

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function divisionRoundRobin(ids) {
  // Returns (n-1) weeks of matchups for an n-team division
  const n = ids.length;
  if (n < 2) return [];
  const weeks = [];
  const fixed = ids[0];
  const rest  = ids.slice(1);
  for (let w = 0; w < n - 1; w++) {
    const rot    = [...rest.slice(w), ...rest.slice(0, w)];
    const circle = [fixed, ...rot];
    const pairs  = [];
    for (let i = 0; i < Math.floor(n / 2); i++) pairs.push([circle[i], circle[n - 1 - i]]);
    weeks.push(pairs);
  }
  return weeks;
}

function generateMatchupSchedule(div1Ids, div2Ids, numWeeks = 14) {
  const d1RR = divisionRoundRobin(div1Ids); // 5 weeks (6-team div → 5 rounds)
  const d2RR = divisionRoundRobin(div2Ids);
  const len  = Math.min(d1RR.length, d2RR.length);

  // Two full division round-robins = 10 weeks
  const divWeeks = [];
  for (let i = 0; i < len; i++) divWeeks.push([...d1RR[i], ...d2RR[i]]);
  const schedule = [...divWeeks, ...divWeeks.map(w => shuffle([...w]))]; // 10 weeks

  // Cross-division weeks for the remainder
  const crossPairs = [];
  for (const a of div1Ids) for (const b of div2Ids) crossPairs.push([a, b]);
  const shuffledCross = shuffle(crossPairs);
  const gamesPerWeek  = Math.floor((div1Ids.length + div2Ids.length) / 2);
  for (let w = 0; w < numWeeks - 10; w++) {
    const start = w * gamesPerWeek;
    schedule.push(shuffledCross.slice(start, start + gamesPerWeek));
  }

  // Convert to keyed object { 1: [...], 2: [...], ... }
  const result = {};
  for (let i = 0; i < numWeeks && i < schedule.length; i++) result[i + 1] = schedule[i];
  return result;
}

export default function LeagueSettings({ user, onRosterReset, rosterResetState = 'idle', initialTab }) {
  const canEdit = user?.isAdmin || user?.isCommissioner;
  const editLabel = user?.isAdmin ? 'Admin Edit' : 'Commissioner Edit';
  const editColor = user?.isAdmin ? '#4ade80' : '#ffb547';
  const [data, setData]       = React.useState(load);
  const [activeTab, setTab]   = React.useState(initialTab || 'general');
  const [editingRule, setEditingRule] = React.useState(null);
  const [editingScore, setEditingScore] = React.useState(null);
  const [editingRoster, setEditingRoster] = React.useState(null);
  const [saved, setSaved]     = React.useState(false);
  const [weekData, setWeekData] = React.useState({ week: 1, season: new Date().getFullYear(), type: 'regular' });
  const [editingWeek, setEditingWeek] = React.useState(false);
  const [weekDraft, setWeekDraft] = React.useState({});
  const [resetConfirm, setResetConfirm] = React.useState(false);
  const [commishMedia, setCommishMedia] = React.useState(() => {
    try { return JSON.parse(localStorage.getItem(MEDIA_KEY) || 'null'); } catch { return null; }
  });
  const [commishUrlDraft, setCommishUrlDraft] = React.useState('');
  const mediaInputRef = React.useRef(null);

  // League Fees state
  const [editingFees, setEditingFees]     = React.useState(false);
  const [feesDraft, setFeesDraft]         = React.useState({});
  const [feeNotifyMsg, setFeeNotifyMsg]   = React.useState('');
  const [feeNotifySend, setFeeNotifySend] = React.useState(false);
  const [feeNotifyResult, setFeeNotifyResult] = React.useState(null);

  // Weekly-events editor state (used in Schedule tab)
  const [evtDraft,     setEvtDraft]     = React.useState({ day: 'Sunday', time: '', label: '', type: 'game' });
  const [editEvtId,    setEditEvtId]    = React.useState(null);
  const [editEvtDraft, setEditEvtDraft] = React.useState(null);

  function getEmbedUrl(raw) {
    try {
      const u = new URL(raw.trim());
      if (u.hostname.includes('youtube.com') && u.searchParams.get('v'))
        return `https://www.youtube.com/embed/${u.searchParams.get('v')}`;
      if (u.hostname === 'youtu.be')
        return `https://www.youtube.com/embed${u.pathname}`;
      if (u.hostname.includes('vimeo.com')) {
        const id = u.pathname.split('/').filter(Boolean).pop();
        return `https://player.vimeo.com/video/${id}`;
      }
      return raw.trim();
    } catch { return raw.trim(); }
  }

  function saveVideoUrl() {
    const url = commishUrlDraft.trim();
    const next = { ...(commishMedia || {}), videoUrl: url || undefined };
    if (!url) delete next.videoUrl;
    const val = Object.keys(next).length ? next : null;
    setCommishMedia(val);
    if (val) localStorage.setItem(MEDIA_KEY, JSON.stringify(val));
    else localStorage.removeItem(MEDIA_KEY);
    setCommishUrlDraft('');
  }

  function removeVideoUrl() {
    const next = { ...(commishMedia || {}) };
    delete next.videoUrl;
    const val = Object.keys(next).length ? next : null;
    setCommishMedia(val);
    if (val) localStorage.setItem(MEDIA_KEY, JSON.stringify(val));
    else localStorage.removeItem(MEDIA_KEY);
  }

  function handleMediaUpload(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    const isVideo = file.type.startsWith('video/');
    const isImage = file.type.startsWith('image/');
    if (!isVideo && !isImage) return;
    const reader = new FileReader();
    reader.onload = ev => {
      const media = { url: ev.target.result, type: isVideo ? 'video' : 'image', name: file.name };
      setCommishMedia(media);
      localStorage.setItem(MEDIA_KEY, JSON.stringify(media));
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  }

  function removeMedia() {
    setCommishMedia(null);
    localStorage.removeItem(MEDIA_KEY);
  }


  React.useEffect(() => {
    fetch(`${API_BASE}/api/v1/week/current`)
      .then(r => r.json())
      .then(d => setWeekData(d))
      .catch(() => {});
  }, []);

  async function saveWeek() {
    try {
      const res = await fetch(`${API_BASE}/api/v1/week/current`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(weekDraft),
      });
      if (res.ok) {
        setWeekData(weekDraft);
        setEditingWeek(false);
        flash();
      }
    } catch {}
  }

  async function testS3() {
    setS3TestState('loading');
    setS3TestResult(null);
    try {
      const res = await fetch(`${API_BASE}/api/v1/storage/test`);
      const data = await res.json();
      setS3TestResult(data);
      setS3TestState(data.allGood ? 'done' : 'error');
    } catch (err) {
      setS3TestResult({ error: err.message });
      setS3TestState('error');
    }
  }

  function handleResetRosters() {
    if (!resetConfirm) { setResetConfirm(true); return; }
    // Stamp the reset season locally
    const next = { ...data, rostersResetSeason: weekData.season };
    persist(next);
    setData(next);
    setResetConfirm(false);
    // Push the reset to S3 via the App-level callback
    onRosterReset?.();
    localStorage.removeItem('fantasai_slot_overrides');
    flash();
  }

  // For inline field editing
  const [editField, setEditField] = React.useState(null);
  const [fieldDraft, setFieldDraft] = React.useState('');

  function startFieldEdit(key, value) {
    setEditField(key);
    setFieldDraft(String(value));
  }

  function saveField(key, nested) {
    let next;
    if (nested) {
      next = { ...data, [nested]: { ...data[nested], [key]: fieldDraft } };
    } else {
      next = { ...data, [key]: fieldDraft };
    }
    persist(next);
    setData(next);
    setEditField(null);
    flash();
    logChange('general', `Updated ${key.replace(/([A-Z])/g, ' $1').toLowerCase()} → "${String(fieldDraft).slice(0, 80)}"`);
  }

  function togglePayment(teamId) {
    if (!canEdit) return;
    const payments = { ...(data.fees?.payments || {}) };
    const cur = payments[teamId];
    payments[teamId] = cur?.paid
      ? { paid: false, paidAt: null }
      : { paid: true, paidAt: new Date().toISOString().slice(0, 10) };
    const next = { ...data, fees: { ...data.fees, payments } };
    persist(next);
    setData(next);
  }

  function setPaymentDate(teamId, date) {
    const payments = { ...(data.fees?.payments || {}) };
    payments[teamId] = { ...(payments[teamId] || {}), paidAt: date };
    const next = { ...data, fees: { ...data.fees, payments } };
    persist(next);
    setData(next);
  }

  async function notifyUnpaid() {
    const msg = feeNotifyMsg.trim();
    if (!msg) return;
    const commishKey = (() => {
      try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}')?.fantasaiKey || ''; } catch { return ''; }
    })();
    if (!commishKey) { setFeeNotifyResult('error:Commissioner Key not set — add it in General settings.'); return; }
    const payments = data.fees?.payments || {};
    const unpaidTeams = LEAGUE_TEAMS.filter(t => !payments[t.id]?.paid);
    if (unpaidTeams.length === 0) { setFeeNotifyResult('ok:All teams have paid!'); return; }
    setFeeNotifySend(true);
    setFeeNotifyResult(null);
    try {
      const teamIds = unpaidTeams.map(t => t.id);
      const feeLabel = data.fees?.amount ? ` (${data.fees.amount})` : '';
      const res = await sendLeaguePush(
        'League Fee Reminder',
        msg + feeLabel,
        commishKey,
        '/',
        teamIds
      );
      setFeeNotifyResult(res.ok ? `ok:Sent to ${res.sent} device(s) — ${unpaidTeams.length} unpaid team(s)` : `error:${res.error}`);
    } catch { setFeeNotifyResult('error:Send failed — check Commissioner Key'); }
    setFeeNotifySend(false);
  }

  function saveRule(key, text) {
    const next = { ...data, rules: { ...data.rules, [key]: text } };
    persist(next);
    setData(next);
    setEditingRule(null);
    flash();
  }

  function saveScore(type, index, value) {
    const arr = type === 'offensive' ? 'offensiveScoring' : 'defensiveScoring';
    const rule = data[arr][index];
    const updated = data[arr].map((s, i) => i === index ? { ...s, value } : s);
    const next = { ...data, [arr]: updated };
    persist(next);
    setData(next);
    setEditingScore(null);
    flash();
    logChange('scoring', `Updated ${type} scoring rule "${rule?.name || rule?.code}" → ${value}`);
  }

  function saveRosterLimit(key, draft) {
    const next = { ...data, roster: { ...data.roster, [key]: { min: Number(draft.min), max: Number(draft.max) } } };
    persist(next);
    setData(next);
    setEditingRoster(null);
    flash();
    logChange('roster', `Updated roster limit "${key}" → min ${draft.min}, max ${draft.max}`);
  }

  function saveRosterPosition(index, draft) {
    const pos = data.positions[index];
    const positions = data.positions.map((p, i) =>
      i === index ? { ...p, activeMin: Number(draft.activeMin), activeMax: Number(draft.activeMax), rosterTotal: draft.rosterTotal } : p
    );
    const next = { ...data, positions };
    persist(next);
    setData(next);
    setEditingRoster(null);
    flash();
    logChange('roster', `Updated ${pos?.label || pos?.key || 'position'} roster limit → active ${draft.activeMin}–${draft.activeMax}, total ${draft.rosterTotal}`);
  }

  // ── S3 sync ────────────────────────────────────────────────────────────────
  const [schedSaveState, setSchedSaveState] = React.useState('idle'); // 'idle'|'saving'|'saved'|'error'
  const [schedLoadedAt, setSchedLoadedAt]   = React.useState(null);
  const s3Loaded = React.useRef(false); // true once initial S3 load applied

  // On mount: load full league settings from S3 (applies to all logged-in users)
  React.useEffect(() => {
    fetch(`${API_BASE}/api/v1/league-settings?leagueId=${getLeagueId()}`)
      .then(r => r.json())
      .then(d => {
        if (d.fromS3 && d.settings) {
          setData(prev => {
            const merged = { ...DEFAULTS, ...prev, ...d.settings };
            persist(merged);
            return merged;
          });
        }
      })
      .catch(() => {})
      .finally(() => { s3Loaded.current = true; });

    // Seed schedule load-time display
    fetch(`${API_BASE}/api/v1/schedule`)
      .then(r => r.json())
      .then(d => { if (d.fromS3 && d.savedAt) setSchedLoadedAt(d.savedAt); })
      .catch(() => {});
  }, []);

  // Debounced S3 sync whenever data changes (admin/commissioner only, after initial load)
  React.useEffect(() => {
    if (!s3Loaded.current || !canEdit) return;
    const timer = setTimeout(() => {
      const leagueId = getLeagueId();
      const teams = getLiveTeams()
        ?? LEAGUE_TEAMS.map(({ id, name, color, logo, record, pf, pa }) => ({ id, name, color, logo, record, pf, pa }));
      fetch(`${API_BASE}/api/v1/league-settings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ settings: data, teams, leagueId }),
      }).catch(() => {});
    }, 800);
    return () => clearTimeout(timer);
  }, [data, canEdit]);

  async function saveScheduleToS3(schedule) {
    setSchedSaveState('saving');
    try {
      const res = await fetch(`${API_BASE}/api/v1/schedule`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ schedule }),
      });
      if (res.ok) {
        const d = await res.json();
        setSchedSaveState('saved');
        setSchedLoadedAt(d.savedAt || null);
        setTimeout(() => setSchedSaveState('idle'), 3000);
      } else setSchedSaveState('error');
    } catch { setSchedSaveState('error'); }
  }

  // Matchups tab state
  const [matchupWeek, setMatchupWeek]           = React.useState(1);
  const [editingDivName, setEditingDivName]     = React.useState(null);
  const [divNameDraft, setDivNameDraft]         = React.useState('');
  const [editingMatchupIdx, setEditingMatchupIdx] = React.useState(null);
  const [matchupDraft, setMatchupDraft]         = React.useState([null, null]);

  // Waiver Rules tab state
  const [editingWaiver, setEditingWaiver]       = React.useState(false);
  const [waiverDraft, setWaiverDraft]           = React.useState({});
  const [editingDraft, setEditingDraft]         = React.useState(false);
  const [draftSettingsDraft, setDraftSettingsDraft] = React.useState({});
  const [s3TestState, setS3TestState]           = React.useState('idle'); // 'idle'|'loading'|'done'|'error'
  const [s3TestResult, setS3TestResult]         = React.useState(null);

  // Playoff Rules tab state
  const [editingPlayoffSettings, setEditingPlayoffSettings] = React.useState(false);
  const [playoffSettingsDraft, setPlayoffSettingsDraft]     = React.useState({});
  const [playoffBracketRound, setPlayoffBracketRound]       = React.useState(1);
  const [editingBracketIdx, setEditingBracketIdx]           = React.useState(null);
  const [bracketMatchupDraft, setBracketMatchupDraft]       = React.useState([null, null]);

  function handleAutoGenerate() {
    const allIds    = LEAGUE_TEAMS.map(t => t.id);
    const shuffled  = shuffle(allIds);
    const half      = Math.ceil(shuffled.length / 2);
    const div1Ids   = shuffled.slice(0, half);
    const div2Ids   = shuffled.slice(half);
    const schedule  = generateMatchupSchedule(div1Ids, div2Ids, 14);
    const next = {
      ...data,
      divisions: {
        div1: { name: data.divisions?.div1?.name || 'Division 1', teamIds: div1Ids },
        div2: { name: data.divisions?.div2?.name || 'Division 2', teamIds: div2Ids },
      },
      matchupSchedule: schedule,
    };
    persist(next);
    setData(next);
    flash();
    saveScheduleToS3(schedule);
    logChange('schedule', `Commissioner auto-generated a 14-week schedule with 2 divisions (${div1Ids.length} + ${div2Ids.length} teams)`, true);
  }

  function saveDivName(div) {
    const next = { ...data, divisions: { ...data.divisions, [div]: { ...data.divisions[div], name: divNameDraft } } };
    persist(next);
    setData(next);
    setEditingDivName(null);
    flash();
  }

  function moveTeamToDiv(teamId, targetDiv) {
    const otherDiv = targetDiv === 'div1' ? 'div2' : 'div1';
    const newTarget = [...(data.divisions[targetDiv]?.teamIds || []), teamId];
    const newOther  = (data.divisions[otherDiv]?.teamIds || []).filter(id => id !== teamId);
    const next = {
      ...data,
      divisions: {
        ...data.divisions,
        [targetDiv]: { ...data.divisions[targetDiv], teamIds: newTarget },
        [otherDiv]:  { ...data.divisions[otherDiv],  teamIds: newOther },
      },
    };
    persist(next);
    setData(next);
  }

  function saveMatchupEdit(week, idx) {
    const [a, b] = matchupDraft;
    if (!a || !b || a === b) return;
    const weekGames = [...(data.matchupSchedule[week] || [])];
    weekGames[idx] = [Number(a), Number(b)];
    const next = { ...data, matchupSchedule: { ...data.matchupSchedule, [week]: weekGames } };
    persist(next);
    setData(next);
    setEditingMatchupIdx(null);
    flash();
    const tA = LEAGUE_TEAMS.find(t => String(t.id) === String(a));
    const tB = LEAGUE_TEAMS.find(t => String(t.id) === String(b));
    logChange('matchup', `Manually set Week ${week} matchup: ${tA?.name || a} vs ${tB?.name || b}`, true);
  }

  function addMatchup(week) {
    const weekGames = [...(data.matchupSchedule[week] || []), [null, null]];
    const next = { ...data, matchupSchedule: { ...data.matchupSchedule, [week]: weekGames } };
    persist(next);
    setData(next);
    setEditingMatchupIdx(weekGames.length - 1);
    setMatchupDraft([null, null]);
  }

  function removeMatchup(week, idx) {
    const weekGames = (data.matchupSchedule[week] || []).filter((_, i) => i !== idx);
    const next = { ...data, matchupSchedule: { ...data.matchupSchedule, [week]: weekGames } };
    persist(next);
    setData(next);
    if (editingMatchupIdx === idx) setEditingMatchupIdx(null);
  }

  function flash() { setSaved(true); setTimeout(() => setSaved(false), 2000); }

  function logChange(category, description, highlight = false) {
    if (!canEdit) return;
    const who = user?.isAdmin ? 'Admin' : 'Commissioner';
    api.transactions.log({
      id: `${Date.now()}-settings-${Math.random().toString(36).slice(2, 6)}`,
      type: 'league_settings',
      timestamp: new Date().toISOString(),
      teamId: user?.teamId || 0,
      teamName: user?.teamName || who,
      category,
      description,
      highlight,
      changedBy: who,
    });
  }

  function saveWaiverRules() {
    const next = { ...data, waiverRules: { ...data.waiverRules, ...waiverDraft } };
    persist(next);
    setData(next);
    setEditingWaiver(false);
    flash();
    logChange('waivers', `Updated waiver rules — runs on ${(waiverDraft.days || []).join(', ') || 'unset'}, reset: ${waiverDraft.resetPolicy || 'unchanged'}`);
  }

  function saveWaiverAdditionalRules(text) {
    const next = { ...data, waiverRules: { ...data.waiverRules, additionalRules: text } };
    persist(next);
    setData(next);
    setEditingRule(null);
    flash();
  }

  function savePlayoffSettings() {
    const next = { ...data, playoffRules: { ...data.playoffRules, ...playoffSettingsDraft } };
    persist(next);
    setData(next);
    setEditingPlayoffSettings(false);
    flash();
    logChange('playoffs', `Updated playoff settings — starts Week ${playoffSettingsDraft.startWeek || data.playoffRules?.startWeek}, ${playoffSettingsDraft.numTeams || data.playoffRules?.numTeams} teams qualify`);
  }

  function savePlayoffAdditionalRules(text) {
    const next = { ...data, playoffRules: { ...data.playoffRules, additionalRules: text } };
    persist(next);
    setData(next);
    setEditingRule(null);
    flash();
  }

  function getBracketRoundLabel(round, totalRounds) {
    if (round === totalRounds) return 'Championship';
    if (round === totalRounds - 1) return 'Semifinals';
    return 'Wild Card';
  }

  function saveBracketMatchup(round, idx) {
    const [a, b] = bracketMatchupDraft;
    if (!a || !b || String(a) === String(b)) return;
    const pr = data.playoffRules || {};
    const bracket = { ...(pr.bracket || {}) };
    const rounds = bracket[round] ? [...bracket[round]] : [];
    rounds[idx] = [Number(a), Number(b)];
    bracket[round] = rounds;
    const next = { ...data, playoffRules: { ...pr, bracket } };
    persist(next);
    setData(next);
    setEditingBracketIdx(null);
    flash();
  }

  function addBracketMatchup(round) {
    const pr = data.playoffRules || {};
    const bracket = { ...(pr.bracket || {}) };
    const rounds = [...(bracket[round] || []), [null, null]];
    bracket[round] = rounds;
    const next = { ...data, playoffRules: { ...pr, bracket } };
    persist(next);
    setData(next);
    setEditingBracketIdx(rounds.length - 1);
    setBracketMatchupDraft([null, null]);
  }

  function removeBracketMatchup(round, idx) {
    const pr = data.playoffRules || {};
    const bracket = { ...(pr.bracket || {}) };
    bracket[round] = (bracket[round] || []).filter((_, i) => i !== idx);
    const next = { ...data, playoffRules: { ...pr, bracket } };
    persist(next);
    setData(next);
    if (editingBracketIdx === idx) setEditingBracketIdx(null);
  }

  function downloadSeed() {
    const teams = getLiveTeams()
      ?? LEAGUE_TEAMS.map(({ id, name, color, logo, record, pf, pa }) => ({ id, name, color, logo, record, pf, pa }));
    const seed = { leagueId: getLeagueId(), teams, savedAt: new Date().toISOString() };
    const blob = new Blob([JSON.stringify(seed, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'league-seed.json';
    a.click();
    URL.revokeObjectURL(a.href);
  }

  return (
    <div style={{ padding: '24px 28px', maxWidth: 860 }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <TeamLogoBadge team={null} size={40} />
          <div>
            <div style={{ fontSize: 18, fontWeight: 800, letterSpacing: '-.02em', marginBottom: 2 }}>{data.leagueName}</div>
            <div style={{ fontSize: 12, color: 'var(--text-dim)' }}>
              {data.numTeams} teams · {data.scoringPolicies?.system} · Entry fee ${data.entryFee}
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {saved && <span style={{ fontSize: 11, color: 'var(--accent)', fontWeight: 700 }}>Saved ✓</span>}
          {canEdit && (
            <button
              className="btn sm ghost"
              onClick={downloadSeed}
              title="Download league-seed.json — place in app/public/ to seed local development"
              style={{ fontSize: 11 }}
            >
              ↓ Download Seed
            </button>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 2, borderBottom: '1px solid var(--border)', marginBottom: 24, overflowX: 'auto' }}>
        {TABS.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)} style={{
            background: 'none', border: 'none', cursor: 'pointer', whiteSpace: 'nowrap',
            padding: '8px 14px', fontSize: 13, fontWeight: activeTab === t.id ? 700 : 400,
            color: activeTab === t.id ? 'var(--text)' : 'var(--text-dim)',
            borderBottom: activeTab === t.id ? '2px solid var(--accent)' : '2px solid transparent',
            marginBottom: -1,
          }}>
            {t.label}
          </button>
        ))}
      </div>

      {/* ── General ── */}
      {activeTab === 'general' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {!canEdit && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '9px 14px', borderRadius: 8, background: 'rgba(255,255,255,.04)', border: '1px solid var(--border)', fontSize: 12, color: 'var(--text-dim)' }}>
              <span style={{ fontSize: 14 }}>🔒</span>
              <span>View only — only <strong style={{ color: 'var(--text)' }}>Admins</strong> and <strong style={{ color: 'var(--text)' }}>Commissioners</strong> can edit league settings.</span>
            </div>
          )}
          <SettingsTable canEdit={canEdit} editLabel={editLabel} editColor={editColor} editField={editField} fieldDraft={fieldDraft}
            setFieldDraft={setFieldDraft} onEdit={startFieldEdit} onSave={saveField}
            rows={[
              { label: 'League Name',          key: 'leagueName',  value: data.leagueName },
              { label: 'League URL',           key: 'leagueUrl',   value: data.leagueUrl },
              { label: 'League Email',         key: 'leagueEmail', value: data.leagueEmail },
              { label: 'Number of Teams',      key: 'numTeams',    value: data.numTeams },
              { label: 'Entry Fee',            key: 'entryFee',    value: `$${data.entryFee}` },
              { label: 'Player Pool',          key: 'playerPool',  value: data.playerPool },
              ...(canEdit ? [{ label: 'Commissioner Key', key: 'fantasaiKey', value: data.fantasaiKey ? '••••••••' : '(not set)', editValue: '', password: true }] : []),
            ]}
          />
          <Card title="Draft Settings">
            {editingDraft ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    <label style={{ fontSize: 11, color: 'var(--text-dim)', fontWeight: 600 }}>Draft Format</label>
                    <select
                      className="input"
                      style={{ fontSize: 13, minWidth: 180 }}
                      value={draftSettingsDraft.format}
                      onChange={e => setDraftSettingsDraft(d => ({ ...d, format: e.target.value }))}
                    >
                      {['Snake', 'Auction', '3rd Round Reversal', 'Linear', 'Salary Cap'].map(f => (
                        <option key={f} value={f}>{f}</option>
                      ))}
                    </select>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    <label style={{ fontSize: 11, color: 'var(--text-dim)', fontWeight: 600 }}>Draft Date &amp; Time</label>
                    <input
                      type="datetime-local"
                      className="input"
                      style={{ fontSize: 13 }}
                      value={draftSettingsDraft.date}
                      onChange={e => setDraftSettingsDraft(d => ({ ...d, date: e.target.value }))}
                    />
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button className="btn primary sm" onClick={() => {
                    const next = { ...data, draft: { ...data.draft, ...draftSettingsDraft } };
                    persist(next); setData(next); setEditingDraft(false); flash();
                    logChange('draft', `Draft settings updated — format: ${draftSettingsDraft.format}${draftSettingsDraft.date ? `, date: ${new Date(draftSettingsDraft.date).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })}` : ''}`);
                  }}>Save Draft Settings</button>
                  <button className="btn ghost sm" onClick={() => setEditingDraft(false)}>Cancel</button>
                </div>
              </div>
            ) : (
              <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                <div style={{ flex: 1, display: 'flex', gap: 24 }}>
                  <span style={{ fontSize: 13 }}>
                    <span style={{ color: 'var(--text-dim)', marginRight: 6 }}>Format</span>
                    <strong>{data.draft?.format || 'Not set'}</strong>
                  </span>
                  <span style={{ fontSize: 13 }}>
                    <span style={{ color: 'var(--text-dim)', marginRight: 6 }}>Date</span>
                    <strong>{data.draft?.date ? new Date(data.draft.date).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : 'Not scheduled'}</strong>
                  </span>
                </div>
                {canEdit && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontSize: 10, fontWeight: 700, color: editColor }}>{editLabel}</span>
                    <button className="btn ghost sm" onClick={() => { setDraftSettingsDraft({ format: data.draft?.format || 'Snake', date: data.draft?.date || '' }); setEditingDraft(true); }}>Edit</button>
                  </div>
                )}
              </div>
            )}
          </Card>

          {/* ── League Fees ── */}
          <Card title="League Fees">
            {editingFees && canEdit ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
                  <div>
                    <label style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '.1em', display: 'block', marginBottom: 4 }}>Payment Method</label>
                    <select className="input" style={{ width: 130 }} value={feesDraft.method} onChange={e => setFeesDraft(d => ({ ...d, method: e.target.value }))}>
                      <option value="">None</option>
                      <option value="venmo">Venmo</option>
                      <option value="paypal">PayPal</option>
                      <option value="cashapp">Cash App</option>
                      <option value="zelle">Zelle</option>
                      <option value="other">Other</option>
                    </select>
                  </div>
                  <div>
                    <label style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '.1em', display: 'block', marginBottom: 4 }}>Handle / Username</label>
                    <input className="input" style={{ width: 160 }} placeholder="@yourhandle" value={feesDraft.handle} onChange={e => setFeesDraft(d => ({ ...d, handle: e.target.value }))} />
                  </div>
                  <div>
                    <label style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '.1em', display: 'block', marginBottom: 4 }}>Fee Amount</label>
                    <input className="input" style={{ width: 90 }} placeholder="$50" value={feesDraft.amount} onChange={e => setFeesDraft(d => ({ ...d, amount: e.target.value }))} />
                  </div>
                </div>
                <div>
                  <label style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '.1em', display: 'block', marginBottom: 4 }}>Note to Members (optional)</label>
                  <input className="input" style={{ width: '100%', maxWidth: 460 }} placeholder="Pay by Aug 1 · include your team name" value={feesDraft.note} onChange={e => setFeesDraft(d => ({ ...d, note: e.target.value }))} />
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button className="btn primary sm" onClick={() => {
                    const next = { ...data, fees: feesDraft };
                    persist(next); setData(next); setEditingFees(false); flash();
                    logChange('fees', `League fees updated — ${feesDraft.method || 'no method'} ${feesDraft.handle || ''} ${feesDraft.amount || ''}`.trim());
                  }}>Save</button>
                  <button className="btn ghost sm" onClick={() => setEditingFees(false)}>Cancel</button>
                </div>
              </div>
            ) : (
              <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
                {/* Payment method header */}
                {data.fees?.method ? (() => {
                  const f = data.fees;
                  const METHOD_ICONS = { venmo: '💳', paypal: '🅿', cashapp: '💵', zelle: '⚡', other: '💰' };
                  const payUrl = f.method === 'venmo'   ? `https://venmo.com/${f.handle.replace('@','')}?txn=pay&note=${encodeURIComponent(data.leagueName + ' League Fees')}&amount=${f.amount.replace(/[^0-9.]/g,'')}` :
                                 f.method === 'paypal'  ? `https://paypal.me/${f.handle.replace('@','')}/${f.amount.replace(/[^0-9.]/g,'')}` :
                                 f.method === 'cashapp' ? `https://cash.app/$${f.handle.replace(/[@$]/g,'')}` : null;
                  return (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 4 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                        <span style={{ fontSize: 14 }}>{METHOD_ICONS[f.method]}</span>
                        <span style={{ fontWeight: 700, fontSize: 13 }}>{f.method.charAt(0).toUpperCase() + f.method.slice(1)}</span>
                        {f.handle && <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--accent)' }}>{f.handle}</span>}
                        {f.amount && <span style={{ fontSize: 13, color: 'var(--text-dim)' }}>· {f.amount} per team</span>}
                        {payUrl && (
                          <a href={payUrl} target="_blank" rel="noreferrer"
                            style={{ fontSize: 12, fontWeight: 700, padding: '4px 14px', borderRadius: 6, background: 'var(--accent)', color: 'var(--accent-ink)', textDecoration: 'none' }}>
                            Pay Now ↗
                          </a>
                        )}
                      </div>
                      {f.note && <div style={{ fontSize: 12, color: 'var(--text-faint)', fontStyle: 'italic' }}>{f.note}</div>}
                    </div>
                  );
                })() : (
                  <span style={{ fontSize: 13, color: 'var(--text-faint)', display: 'block', marginBottom: 8 }}>No payment info configured.</span>
                )}

                {/* ── Per-team payment tracker ── */}
                {(() => {
                  const payments = data.fees?.payments || {};
                  const paidCount = LEAGUE_TEAMS.filter(t => payments[t.id]?.paid).length;
                  return (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 0, border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden' }}>
                      {/* Summary bar */}
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 14px', background: 'rgba(255,255,255,.03)', borderBottom: '1px solid var(--border)' }}>
                        <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '.06em' }}>Payment Status</span>
                        <span style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: paidCount === LEAGUE_TEAMS.length ? 'var(--good)' : 'var(--warn)', fontWeight: 700 }}>
                          {paidCount} / {LEAGUE_TEAMS.length} paid
                        </span>
                      </div>
                      {/* Team rows */}
                      {LEAGUE_TEAMS.map((t, i) => {
                        const p = payments[t.id] || {};
                        return (
                          <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 14px', borderBottom: i < LEAGUE_TEAMS.length - 1 ? '1px solid var(--border)' : 'none', background: p.paid ? 'rgba(76,175,130,.05)' : 'transparent' }}>
                            {/* Paid checkbox */}
                            <input
                              type="checkbox"
                              checked={!!p.paid}
                              disabled={!canEdit}
                              onChange={() => togglePayment(t.id)}
                              style={{ accentColor: 'var(--good)', width: 15, height: 15, flexShrink: 0, cursor: canEdit ? 'pointer' : 'default' }}
                            />
                            {/* Owner info */}
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <span style={{ fontSize: 12, fontWeight: 600, color: p.paid ? 'var(--text)' : 'var(--text-dim)' }}>{t.owner}</span>
                              <span style={{ fontSize: 11, color: 'var(--text-faint)', marginLeft: 6 }}>· {t.name}</span>
                            </div>
                            {/* Paid date */}
                            {p.paid && canEdit ? (
                              <input
                                type="date"
                                value={p.paidAt || ''}
                                onChange={e => setPaymentDate(t.id, e.target.value)}
                                style={{ fontSize: 11, padding: '2px 6px', borderRadius: 5, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)', fontFamily: 'var(--font-mono)' }}
                              />
                            ) : p.paid ? (
                              <span style={{ fontSize: 11, color: 'var(--good)', fontFamily: 'var(--font-mono)', fontWeight: 600 }}>
                                ✓ {p.paidAt || 'Paid'}
                              </span>
                            ) : (
                              <span style={{ fontSize: 11, color: 'var(--text-faint)' }}>Unpaid</span>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  );
                })()}

                {/* ── Notify unpaid section (commish only) ── */}
                {canEdit && (() => {
                  const payments = data.fees?.payments || {};
                  const unpaid = LEAGUE_TEAMS.filter(t => !payments[t.id]?.paid);
                  return unpaid.length > 0 ? (
                    <div style={{ marginTop: 10, padding: '12px 14px', background: 'rgba(255,184,0,.05)', border: '1px solid rgba(255,184,0,.2)', borderRadius: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
                      <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--warn)', textTransform: 'uppercase', letterSpacing: '.06em' }}>
                        Notify {unpaid.length} Unpaid {unpaid.length === 1 ? 'Owner' : 'Owners'}
                      </div>
                      <div style={{ fontSize: 10, color: 'var(--text-faint)' }}>
                        {unpaid.map(t => t.owner.split(' ')[0]).join(', ')}
                      </div>
                      <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
                        <input
                          className="input"
                          placeholder={`Pay your league fee of ${data.fees?.amount || '$200'} to ${data.fees?.handle || 'the commissioner'}!`}
                          value={feeNotifyMsg}
                          onChange={e => setFeeNotifyMsg(e.target.value)}
                          style={{ flex: 1, fontSize: 12 }}
                        />
                        <button
                          className="btn primary sm"
                          onClick={notifyUnpaid}
                          disabled={feeNotifySend || !feeNotifyMsg.trim()}
                          style={{ opacity: feeNotifySend || !feeNotifyMsg.trim() ? 0.5 : 1, whiteSpace: 'nowrap' }}
                        >{feeNotifySend ? 'Sending…' : `Send Alert`}</button>
                      </div>
                      {feeNotifyResult && (
                        <div style={{ fontSize: 11, fontWeight: 600, color: feeNotifyResult.startsWith('ok:') ? 'var(--good)' : 'var(--danger)' }}>
                          {feeNotifyResult.replace(/^(ok:|error:)/, '')}
                        </div>
                      )}
                    </div>
                  ) : (
                    <div style={{ marginTop: 8, fontSize: 12, color: 'var(--good)', fontWeight: 600 }}>✓ All teams have paid</div>
                  );
                })()}

                {canEdit && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
                    <span style={{ fontSize: 10, fontWeight: 700, color: editColor }}>{editLabel}</span>
                    <button className="btn ghost sm" onClick={() => { setFeesDraft(data.fees || {}); setEditingFees(true); }}>Edit Payment Info</button>
                  </div>
                )}
              </div>
            )}
          </Card>
        </div>
      )}

      {/* ── Roster ── */}
      {activeTab === 'roster' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <Card title="Roster Limits">
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border)' }}>
                  <Th>Status</Th>
                  <Th align="center" style={{ width: 90 }}>Min</Th>
                  <Th align="center" style={{ width: 90 }}>Max</Th>
                  {canEdit && <Th style={{ width: 110 }} />}
                </tr>
              </thead>
              <tbody>
                {[
                  ['starters',        'Starters',         data.roster.starters],
                  ['bench',           'Bench',             data.roster.bench],
                  ['injuredPlayers',  'Injured Players',   data.roster.injuredPlayers],
                  ['practicePlayers', 'Practice Players',  data.roster.practicePlayers],
                  ['totalPlayers',    'Total Players',     data.roster.totalPlayers],
                ].map(([key, label, r]) => {
                  const isActive = editingRoster?.section === 'limits' && editingRoster?.key === key;
                  const draft = isActive ? editingRoster.draft : null;
                  return (
                    <tr key={key} style={{ borderBottom: '1px solid var(--border)', background: isActive ? 'rgba(198,255,58,.05)' : 'transparent' }}>
                      <Td>{label}</Td>
                      <Td align="center">
                        {isActive
                          ? <NumInput value={draft.min} onChange={v => setEditingRoster(e => ({ ...e, draft: { ...e.draft, min: v } }))} />
                          : r.min}
                      </Td>
                      <Td align="center">
                        {isActive
                          ? <NumInput value={draft.max} onChange={v => setEditingRoster(e => ({ ...e, draft: { ...e.draft, max: v } }))} />
                          : r.max}
                      </Td>
                      {canEdit && (
                        <Td align="right">
                          {isActive ? (
                            <div style={{ display: 'flex', gap: 4, justifyContent: 'flex-end' }}>
                              <button className="btn primary sm" onClick={() => saveRosterLimit(key, draft)}>Save</button>
                              <button className="btn ghost sm" onClick={() => setEditingRoster(null)}>✕</button>
                            </div>
                          ) : (
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'flex-end' }}>
                              <span style={{ fontSize: 10, fontWeight: 700, color: editColor, whiteSpace: 'nowrap' }}>{editLabel}</span>
                              <button className="btn ghost sm"
                                disabled={!!editingRoster}
                                onClick={() => setEditingRoster({ section: 'limits', key, draft: { min: r.min, max: r.max } })}>
                                Edit
                              </button>
                            </div>
                          )}
                        </Td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </Card>

          <Card title="Position Limits">
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border)' }}>
                  <Th style={{ width: 80 }}>Position</Th>
                  <Th align="center" style={{ width: 100 }}>Active Min</Th>
                  <Th align="center" style={{ width: 100 }}>Active Max</Th>
                  <Th align="center">Roster Total</Th>
                  {canEdit && <Th style={{ width: 110 }} />}
                </tr>
              </thead>
              <tbody>
                {data.positions.map((p, i) => {
                  const isActive = editingRoster?.section === 'positions' && editingRoster?.index === i;
                  const draft = isActive ? editingRoster.draft : null;
                  return (
                    <tr key={p.key} style={{ borderBottom: '1px solid var(--border)', background: isActive ? 'rgba(198,255,58,.05)' : 'transparent' }}>
                      <Td><strong>{p.label}</strong></Td>
                      <Td align="center">
                        {isActive
                          ? <NumInput value={draft.activeMin} onChange={v => setEditingRoster(e => ({ ...e, draft: { ...e.draft, activeMin: v } }))} />
                          : p.activeMin}
                      </Td>
                      <Td align="center">
                        {isActive
                          ? <NumInput value={draft.activeMax} onChange={v => setEditingRoster(e => ({ ...e, draft: { ...e.draft, activeMax: v } }))} />
                          : p.activeMax}
                      </Td>
                      <Td align="center">
                        {isActive
                          ? <input className="input" value={draft.rosterTotal}
                              onChange={e => setEditingRoster(ev => ({ ...ev, draft: { ...ev.draft, rosterTotal: e.target.value } }))}
                              style={{ width: 90, textAlign: 'center', padding: '3px 6px' }} />
                          : p.rosterTotal}
                      </Td>
                      {canEdit && (
                        <Td align="right">
                          {isActive ? (
                            <div style={{ display: 'flex', gap: 4, justifyContent: 'flex-end' }}>
                              <button className="btn primary sm" onClick={() => saveRosterPosition(i, draft)}>Save</button>
                              <button className="btn ghost sm" onClick={() => setEditingRoster(null)}>✕</button>
                            </div>
                          ) : (
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'flex-end' }}>
                              <span style={{ fontSize: 10, fontWeight: 700, color: editColor, whiteSpace: 'nowrap' }}>{editLabel}</span>
                              <button className="btn ghost sm"
                                disabled={!!editingRoster}
                                onClick={() => setEditingRoster({ section: 'positions', index: i, draft: { activeMin: p.activeMin, activeMax: p.activeMax, rosterTotal: p.rosterTotal } })}>
                                Edit
                              </button>
                            </div>
                          )}
                        </Td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </Card>

          <Card title="Extra Roster Settings">
            <ul style={{ margin: 0, paddingLeft: 18 }}>
              {data.extraRosterSettings.map((s, i) => (
                <li key={i} style={{ fontSize: 13, color: 'var(--text-dim)', lineHeight: 1.8 }}>{s}</li>
              ))}
            </ul>
          </Card>

          {user?.isAdmin && (
            <Card title="R2 Storage Test">
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <div style={{ fontSize: 13, color: 'var(--text-dim)', lineHeight: 1.6 }}>
                  Verify that the Cloudflare Worker can read from and write to Cloudflare R2. Run this if league settings or roster resets are failing.
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                  <button
                    className="btn ghost sm"
                    disabled={s3TestState === 'loading'}
                    onClick={testS3}
                  >
                    {s3TestState === 'loading' ? 'Testing…' : '⟳ Test R2 Connection'}
                  </button>
                  {s3TestState === 'done' && (
                    <span style={{ fontSize: 12, color: 'var(--good)', fontWeight: 700 }}>✓ R2 read + write OK</span>
                  )}
                  {s3TestState === 'error' && (
                    <span style={{ fontSize: 12, color: 'var(--danger)', fontWeight: 700 }}>✕ R2 connection failed — see details below</span>
                  )}
                </div>
                {s3TestResult && (
                  <div style={{ background: 'var(--panel-1)', border: '1px solid var(--border)', borderRadius: 8, padding: '10px 14px', fontSize: 12, fontFamily: 'var(--font-mono)', display: 'flex', flexDirection: 'column', gap: 6 }}>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <span style={{ color: 'var(--text-faint)', minWidth: 120 }}>AWS key set</span>
                      <span style={{ color: s3TestResult.awsConfigured ? 'var(--good)' : 'var(--danger)', fontWeight: 700 }}>
                        {s3TestResult.awsConfigured ? '✓ yes' : '✕ no'}
                      </span>
                    </div>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <span style={{ color: 'var(--text-faint)', minWidth: 120 }}>Bucket</span>
                      <span style={{ color: 'var(--text-dim)' }}>{s3TestResult.bucket} ({s3TestResult.region})</span>
                    </div>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <span style={{ color: 'var(--text-faint)', minWidth: 120 }}>R2 read</span>
                      <span style={{ color: s3TestResult.read?.ok ? 'var(--good)' : 'var(--danger)', fontWeight: 700 }}>
                        {s3TestResult.read?.ok ? `✓ HTTP ${s3TestResult.read.status}` : `✕ ${s3TestResult.read?.error || 'failed'}`}
                      </span>
                    </div>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <span style={{ color: 'var(--text-faint)', minWidth: 120 }}>R2 write</span>
                      <span style={{ color: s3TestResult.write?.ok ? 'var(--good)' : 'var(--danger)', fontWeight: 700 }}>
                        {s3TestResult.write?.ok ? '✓ probe written + deleted' : `✕ ${s3TestResult.write?.error || 'failed'}`}
                      </span>
                    </div>
                    {!s3TestResult.awsConfigured && (
                      <div style={{ marginTop: 6, padding: '6px 10px', background: 'rgba(255,80,80,.07)', border: '1px solid rgba(255,80,80,.2)', borderRadius: 6 }}>
                        <div style={{ color: 'var(--danger)', fontWeight: 700, marginBottom: 4 }}>Fix: set Worker secrets</div>
                        <div style={{ color: 'var(--text-dim)', fontSize: 11, lineHeight: 1.7 }}>
                          cd worker-api<br />
                          wrangler secret put AWS_ACCESS_KEY_ID<br />
                          wrangler secret put AWS_SECRET_ACCESS_KEY<br />
                          wrangler secret put RESEND_API_KEY
                        </div>
                      </div>
                    )}
                    {s3TestResult.error && (
                      <div style={{ color: 'var(--danger)', marginTop: 4 }}>Error: {s3TestResult.error}</div>
                    )}
                    <div style={{ color: 'var(--text-faint)', fontSize: 10, marginTop: 2 }}>Tested at {s3TestResult.testedAt || '—'}</div>
                  </div>
                )}
              </div>
            </Card>
          )}

          {canEdit && (
            <Card title="Season Roster Reset">
              <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
                <div style={{ flex: 1, minWidth: 220 }}>
                  <div style={{ fontSize: 13, color: 'var(--text-dim)', lineHeight: 1.6 }}>
                    Wipe all team rosters and return every player to the free-agent pool. Use this at the start of a new season before the draft.
                    {' '}If the reset fails below, run the <strong>Test R2 Connection</strong> above to diagnose.
                  </div>
                  {data.rostersResetSeason && (
                    <div style={{ fontSize: 11, color: 'var(--text-faint)', marginTop: 4 }}>
                      Last reset: {data.rostersResetSeason} season
                    </div>
                  )}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 10, fontWeight: 700, color: editColor }}>{editLabel}</span>
                  {rosterResetState === 'done' && (
                    <span style={{ fontSize: 12, color: 'var(--good)', fontWeight: 700 }}>✓ All rosters cleared on R2</span>
                  )}
                  {rosterResetState === 'error' && (
                    <span style={{ fontSize: 12, color: 'var(--danger)', fontWeight: 700 }}>R2 reset failed — try again</span>
                  )}
                  {rosterResetState === 'loading' && (
                    <span style={{ fontSize: 12, color: 'var(--text-faint)' }}>Resetting…</span>
                  )}
                  {rosterResetState === 'idle' && (resetConfirm ? (
                    <>
                      <span style={{ fontSize: 12, color: '#ff5a6e', fontWeight: 600 }}>This wipes all 12 rosters from R2. Sure?</span>
                      <button className="btn sm" style={{ background: '#ff5a6e', color: '#fff', borderColor: '#ff5a6e' }} onClick={handleResetRosters}>Yes, Reset All</button>
                      <button className="btn ghost sm" onClick={() => setResetConfirm(false)}>Cancel</button>
                    </>
                  ) : (
                    <button className="btn ghost sm" style={{ color: '#ff5a6e', borderColor: '#ff5a6e' }} onClick={handleResetRosters}>
                      Reset All Rosters
                    </button>
                  ))}
                </div>
              </div>
            </Card>
          )}
        </div>
      )}

      {/* ── Scoring ── */}
      {activeTab === 'scoring' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <Card title="Scoring Policies">
            <Row label="Scoring System"     value={data.scoringPolicies.system} />
            <Row label="Scoring per Period" value={data.scoringPolicies.perPeriod} />
            <Row label="Matchup Tiebreaker" value={data.scoringPolicies.matchupTiebreaker} />
          </Card>

          <ScoringSection
            title="Offense"
            rows={data.offensiveScoring}
            type="offensive"
            canEdit={canEdit}
            editLabel={editLabel}
            editColor={editColor}
            editing={editingScore}
            onEdit={(index, draft) => setEditingScore({ type: 'offensive', index, draft })}
            onDraftChange={draft => setEditingScore(e => ({ ...e, draft }))}
            onSave={() => saveScore(editingScore.type, editingScore.index, editingScore.draft)}
            onCancel={() => setEditingScore(null)}
          />

          <ScoringSection
            title="Defense / Special Teams"
            rows={data.defensiveScoring}
            type="defensive"
            canEdit={canEdit}
            editLabel={editLabel}
            editColor={editColor}
            editing={editingScore}
            onEdit={(index, draft) => setEditingScore({ type: 'defensive', index, draft })}
            onDraftChange={draft => setEditingScore(e => ({ ...e, draft }))}
            onSave={() => saveScore(editingScore.type, editingScore.index, editingScore.draft)}
            onCancel={() => setEditingScore(null)}
          />
        </div>
      )}

      {/* ── Transactions ── */}
      {activeTab === 'transactions' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <Card title="Lineup">
            <Row label="Lineup Policy"   value={data.transactions.lineupPolicy} />
            <Row label="Lineup Deadline" value={data.transactions.lineupDeadline} />
          </Card>
          <Card title="Add / Drop & Waivers">
            <Row label="Add/Drop Policy"   value={data.transactions.addDropPolicy} />
            <Row label="Add/Drop Deadline" value={data.transactions.addDropDeadline} />
            <Row label="Waivers Run"       value={data.transactions.waiversRun} />
            <Row label="Waiver Reset"      value={data.transactions.waiverReset} />
            <Row label="Waiver Period"     value={data.transactions.waiverPeriod} />
            <Row label="Waiver Limits"     value={data.transactions.waiverLimits} />
          </Card>
          <Card title="Trades">
            <Row label="Trade Policy"     value={data.transactions.tradePolicy} />
            <Row label="Trade Deadline"   value={data.transactions.tradeDeadline} />
            <Row label="Offseason Trades" value={data.transactions.offseasonTrades} />
          </Card>
          <Card title="Player Policies">
            <Row label="Player Pool" value={data.playerPool} />
          </Card>
        </div>
      )}

      {/* ── Schedule ── */}
      {activeTab === 'schedule' && (() => {
        const DAY_ORDER = ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'];
        const TYPE_COLORS = { game: 'var(--accent-2)', waiver: 'var(--warn)', lock: 'var(--danger)', other: 'var(--text-faint)' };
        const events = data.weeklyEvents ?? [];

        function addEvent() {
          if (!evtDraft.label.trim() || !evtDraft.time.trim()) return;
          const next = { ...data, weeklyEvents: [...events, { id: `evt-${Date.now()}`, ...evtDraft }] };
          setData(next); persist(next);
          setEvtDraft({ day: 'Sunday', time: '', label: '', type: 'game' });
        }
        function removeEvent(id) {
          const next = { ...data, weeklyEvents: events.filter(e => e.id !== id) };
          setData(next); persist(next);
        }
        function startEditEvt(evt) { setEditEvtId(evt.id); setEditEvtDraft({ ...evt }); }
        function saveEditEvt() {
          const next = { ...data, weeklyEvents: events.map(e => e.id === editEvtId ? editEvtDraft : e) };
          setData(next); persist(next); setEditEvtId(null); setEditEvtDraft(null);
        }

        return (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <Card title="Season">
              <Row label="Matchups Per Period" value={data.schedule.matchupsPerPeriod} />
            </Card>
            <Card title="Playoffs">
              <Row label="Playoffs Start"             value={data.schedule.playoffsStart} />
              <Row label="Playoffs Length"            value={data.schedule.playoffsLength} />
              <Row label="Automatic Playoffs"         value={data.schedule.automaticPlayoffs} />
              <Row label="Archive Standings"          value={data.schedule.archiveStandings} />
            </Card>
            <Card title="Tiebreakers">
              <Row label="Standings Tiebreaker"         value={data.schedule.standingsTiebreaker} />
              <Row label="Division Winner Tiebreaker"   value={data.schedule.divisionWinnerTiebreaker} />
              <Row label="Playoffs Matchup Tiebreaker"  value={data.schedule.playoffsTiebreaker} />
            </Card>

            {/* Weekly Events Calendar */}
            <Card title="Weekly Events Calendar">
              <div style={{ fontSize: 12, color: 'var(--text-dim)', padding: '0 16px 12px' }}>
                Events shown on the Dashboard calendar each week. Set game times, waivers, and lineup locks.
                {!canEdit && <span style={{ marginLeft: 8, color: 'var(--text-faint)' }}>View only — Admin/Commissioner can edit.</span>}
              </div>
              {[...events].sort((a, b) => DAY_ORDER.indexOf(a.day) - DAY_ORDER.indexOf(b.day)).map(evt => (
                <div key={evt.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 16px', borderTop: '1px solid var(--border)' }}>
                  {editEvtId === evt.id ? (
                    <>
                      <select className="input" style={{ fontSize: 12, width: 110 }} value={editEvtDraft.day} onChange={e => setEditEvtDraft(d => ({ ...d, day: e.target.value }))}>
                        {DAY_ORDER.map(d => <option key={d} value={d}>{d}</option>)}
                      </select>
                      <input className="input" style={{ fontSize: 12, width: 110 }} placeholder="Time (e.g. 8:20 PM ET)" value={editEvtDraft.time} onChange={e => setEditEvtDraft(d => ({ ...d, time: e.target.value }))} />
                      <input className="input" style={{ fontSize: 12, flex: 1 }} placeholder="Label" value={editEvtDraft.label} onChange={e => setEditEvtDraft(d => ({ ...d, label: e.target.value }))} />
                      <select className="input" style={{ fontSize: 12, width: 90 }} value={editEvtDraft.type} onChange={e => setEditEvtDraft(d => ({ ...d, type: e.target.value }))}>
                        <option value="game">Game</option>
                        <option value="waiver">Waiver</option>
                        <option value="lock">Lock</option>
                        <option value="other">Other</option>
                      </select>
                      <button className="btn sm primary" onClick={saveEditEvt}>Save</button>
                      <button className="btn sm ghost" onClick={() => setEditEvtId(null)}>✕</button>
                    </>
                  ) : (
                    <>
                      <span style={{ fontSize: 10, fontFamily: 'var(--font-mono)', fontWeight: 700, color: TYPE_COLORS[evt.type] ?? TYPE_COLORS.other, background: 'rgba(255,255,255,.06)', borderRadius: 3, padding: '2px 6px', flexShrink: 0 }}>{evt.type.toUpperCase()}</span>
                      <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-dim)', width: 90, flexShrink: 0 }}>{evt.day}</span>
                      <span style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--text-faint)', width: 100, flexShrink: 0 }}>{evt.time}</span>
                      <span style={{ fontSize: 12, flex: 1 }}>{evt.label}</span>
                      {canEdit && (
                        <>
                          <button className="btn sm ghost" style={{ fontSize: 10, color: editColor }} onClick={() => startEditEvt(evt)}>{editLabel}</button>
                          <button className="btn sm ghost" style={{ fontSize: 10, color: 'var(--danger)' }} onClick={() => removeEvent(evt.id)}>✕</button>
                        </>
                      )}
                    </>
                  )}
                </div>
              ))}
              {events.length === 0 && <div style={{ padding: '12px 16px', fontSize: 12, color: 'var(--text-faint)' }}>No events configured.</div>}
              {canEdit && (
                <div style={{ display: 'flex', gap: 8, padding: '10px 16px', borderTop: '1px solid var(--border)', flexWrap: 'wrap' }}>
                  <select className="input" style={{ fontSize: 12, width: 110 }} value={evtDraft.day} onChange={e => setEvtDraft(d => ({ ...d, day: e.target.value }))}>
                    {DAY_ORDER.map(d => <option key={d} value={d}>{d}</option>)}
                  </select>
                  <input className="input" style={{ fontSize: 12, width: 120 }} placeholder="Time (8:20 PM ET)" value={evtDraft.time} onChange={e => setEvtDraft(d => ({ ...d, time: e.target.value }))} />
                  <input className="input" style={{ fontSize: 12, flex: 1, minWidth: 140 }} placeholder="Event label" value={evtDraft.label} onChange={e => setEvtDraft(d => ({ ...d, label: e.target.value }))} />
                  <select className="input" style={{ fontSize: 12, width: 90 }} value={evtDraft.type} onChange={e => setEvtDraft(d => ({ ...d, type: e.target.value }))}>
                    <option value="game">Game</option>
                    <option value="waiver">Waiver</option>
                    <option value="lock">Lock</option>
                    <option value="other">Other</option>
                  </select>
                  <button className="btn primary sm" onClick={addEvent} disabled={!evtDraft.label.trim() || !evtDraft.time.trim()}>+ Add Event</button>
                </div>
              )}
            </Card>
          </div>
        );
      })()}

      {/* ── Matchups ── */}
      {activeTab === 'matchups' && (() => {
        const div1 = data.divisions?.div1 || { name: 'Division 1', teamIds: [] };
        const div2 = data.divisions?.div2 || { name: 'Division 2', teamIds: [] };
        const allAssigned = new Set([...div1.teamIds, ...div2.teamIds]);
        const unassigned  = LEAGUE_TEAMS.filter(t => !allAssigned.has(t.id));
        const weekGames   = data.matchupSchedule?.[matchupWeek] || [];
        const hasSchedule = Object.keys(data.matchupSchedule || {}).length > 0;
        const NUM_WEEKS   = 14;

        return (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {/* Auto-generate button */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 10 }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 700, fontSize: 13 }}>Auto-Generate Schedule</div>
                <div style={{ fontSize: 12, color: 'var(--text-dim)', marginTop: 2 }}>
                  Randomly assigns all 12 owners to two divisions and generates a 14-week round-robin schedule (division games prioritized). Schedule is saved to Cloudflare R2 and loaded by all team views.
                </div>
                {schedLoadedAt && (
                  <div style={{ fontSize: 11, color: 'var(--text-faint)', marginTop: 4 }}>
                    Last synced: {new Date(schedLoadedAt).toLocaleString()}
                  </div>
                )}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6, flexShrink: 0 }}>
                {schedSaveState === 'saving' && <span style={{ fontSize: 11, color: 'var(--text-faint)' }}>Saving to R2…</span>}
                {schedSaveState === 'saved'  && <span style={{ fontSize: 11, color: 'var(--good)', fontWeight: 700 }}>✓ Saved to R2</span>}
                {schedSaveState === 'error'  && (
                  <span style={{ fontSize: 11, color: 'var(--danger)', fontWeight: 700 }} title="Worker not yet deployed — run: cd worker-api && npx wrangler deploy (off VPN)">
                    R2 save failed — schedule saved locally ✓
                  </span>
                )}
                {canEdit ? (
                  <button
                    className="btn primary"
                    disabled={schedSaveState === 'saving'}
                    onClick={handleAutoGenerate}
                  >
                    🎲 Auto-Generate
                  </button>
                ) : (
                  <span style={{ fontSize: 11, color: 'var(--text-faint)' }}>Admin / Commissioner only</span>
                )}
              </div>
            </div>

            {/* Divisions */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              {['div1', 'div2'].map(divKey => {
                const div = data.divisions?.[divKey] || { name: divKey === 'div1' ? 'Division 1' : 'Division 2', teamIds: [] };
                const otherDiv = divKey === 'div1' ? 'div2' : 'div1';
                return (
                  <div key={divKey} style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden' }}>
                    <div style={{ padding: '10px 14px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 8 }}>
                      {editingDivName === divKey ? (
                        <>
                          <input className="input" value={divNameDraft} onChange={e => setDivNameDraft(e.target.value)}
                            style={{ flex: 1, fontSize: 13, fontWeight: 700 }} autoFocus
                            onKeyDown={e => { if (e.key === 'Enter') saveDivName(divKey); if (e.key === 'Escape') setEditingDivName(null); }} />
                          <button className="btn primary sm" onClick={() => saveDivName(divKey)}>Save</button>
                          <button className="btn ghost sm" onClick={() => setEditingDivName(null)}>✕</button>
                        </>
                      ) : (
                        <>
                          <span style={{ flex: 1, fontSize: 13, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.06em', color: 'var(--text-faint)' }}>{div.name}</span>
                          {canEdit && (
                            <button className="btn ghost sm" onClick={() => { setEditingDivName(divKey); setDivNameDraft(div.name); }}>✏ Rename</button>
                          )}
                        </>
                      )}
                    </div>
                    <div>
                      {div.teamIds.length === 0 && (
                        <div style={{ padding: '16px', fontSize: 12, color: 'var(--text-faint)', textAlign: 'center' }}>
                          No teams assigned — click Auto-Generate or move teams here
                        </div>
                      )}
                      {div.teamIds.map(tid => {
                        const t = LEAGUE_TEAMS.find(x => x.id === tid);
                        if (!t) return null;
                        return (
                          <div key={tid} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 14px', borderBottom: '1px solid var(--border)', fontSize: 12 }}>
                            <span style={{ width: 26, height: 26, borderRadius: 6, background: t.color, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 9, fontWeight: 900, color: '#000', flexShrink: 0 }}>{t.logo}</span>
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.name}</div>
                              <div style={{ fontSize: 10, color: 'var(--text-dim)' }}>{t.owner}</div>
                            </div>
                            {canEdit && (
                              <button className="btn ghost sm" style={{ fontSize: 10, flexShrink: 0 }} onClick={() => moveTeamToDiv(tid, otherDiv)}>
                                → {(data.divisions?.[otherDiv]?.name || (otherDiv === 'div1' ? 'Div 1' : 'Div 2')).slice(0, 8)}
                              </button>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Unassigned teams warning */}
            {unassigned.length > 0 && (
              <div style={{ padding: '10px 14px', background: 'rgba(255,183,47,.08)', border: '1px solid rgba(255,183,47,.3)', borderRadius: 8, fontSize: 12, color: 'var(--warn)' }}>
                <strong>{unassigned.length} team{unassigned.length !== 1 ? 's' : ''} not in a division:</strong>{' '}
                {unassigned.map(t => t.name).join(', ')}
              </div>
            )}

            {/* Schedule */}
            <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden' }}>
              <div style={{ padding: '10px 16px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 12 }}>
                <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '.1em', flexShrink: 0 }}>
                  Schedule
                </span>
                <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap', flex: 1 }}>
                  {Array.from({ length: NUM_WEEKS }, (_, i) => i + 1).map(w => (
                    <button key={w} onClick={() => { setMatchupWeek(w); setEditingMatchupIdx(null); }} style={{
                      padding: '3px 8px', borderRadius: 4, fontSize: 11, fontWeight: 600, cursor: 'pointer',
                      border: '1px solid var(--border)',
                      background: w === matchupWeek ? 'var(--accent)' : 'transparent',
                      color: w === matchupWeek ? 'var(--accent-ink)' : 'var(--text-dim)',
                    }}>
                      {w}
                    </button>
                  ))}
                </div>
              </div>

              {!hasSchedule && (
                <div style={{ padding: '24px', textAlign: 'center', fontSize: 12, color: 'var(--text-faint)' }}>
                  No schedule yet — click <strong>Auto-Generate</strong> or add matchups manually.
                </div>
              )}

              {(hasSchedule || weekGames.length > 0) && (
                <div>
                  <div style={{ padding: '8px 16px 4px', fontSize: 10, fontWeight: 700, color: 'var(--text-faint)', letterSpacing: '.1em', textTransform: 'uppercase' }}>
                    Week {matchupWeek} · {weekGames.length} game{weekGames.length !== 1 ? 's' : ''}
                    {matchupWeek <= 10 ? ' · Division' : ' · Cross-Division'}
                  </div>

                  {weekGames.map((pair, idx) => {
                    const [aId, bId] = pair || [];
                    const teamA = LEAGUE_TEAMS.find(t => t.id === aId);
                    const teamB = LEAGUE_TEAMS.find(t => t.id === bId);
                    const isEditing = editingMatchupIdx === idx;

                    return (
                      <div key={idx} style={{ padding: '8px 16px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 10, fontSize: 12 }}>
                        {isEditing ? (
                          <>
                            <select className="input" value={matchupDraft[0] || ''} onChange={e => setMatchupDraft(d => [e.target.value, d[1]])} style={{ flex: 1, fontSize: 12 }}>
                              <option value="">— Home team —</option>
                              {LEAGUE_TEAMS.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                            </select>
                            <span style={{ color: 'var(--text-faint)', flexShrink: 0 }}>vs</span>
                            <select className="input" value={matchupDraft[1] || ''} onChange={e => setMatchupDraft(d => [d[0], e.target.value])} style={{ flex: 1, fontSize: 12 }}>
                              <option value="">— Away team —</option>
                              {LEAGUE_TEAMS.filter(t => String(t.id) !== String(matchupDraft[0])).map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                            </select>
                            <button className="btn primary sm" onClick={() => saveMatchupEdit(matchupWeek, idx)}>Save</button>
                            <button className="btn ghost sm" onClick={() => setEditingMatchupIdx(null)}>✕</button>
                            {canEdit && <button className="btn ghost sm" style={{ color: 'var(--danger)' }} onClick={() => removeMatchup(matchupWeek, idx)}>✕ Del</button>}
                          </>
                        ) : (
                          <>
                            <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 6 }}>
                              {teamA ? (
                                <>
                                  <span style={{ width: 22, height: 22, borderRadius: 4, background: teamA.color, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 8, fontWeight: 900, color: '#000', flexShrink: 0 }}>{teamA.logo}</span>
                                  <span style={{ fontWeight: 600 }}>{teamA.name}</span>
                                </>
                              ) : <span style={{ color: 'var(--text-faint)' }}>TBD</span>}
                            </div>
                            <span style={{ color: 'var(--text-faint)', fontWeight: 700, flexShrink: 0, fontSize: 11 }}>vs</span>
                            <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 6 }}>
                              {teamB ? (
                                <>
                                  <span style={{ fontWeight: 600 }}>{teamB.name}</span>
                                  <span style={{ width: 22, height: 22, borderRadius: 4, background: teamB.color, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 8, fontWeight: 900, color: '#000', flexShrink: 0 }}>{teamB.logo}</span>
                                </>
                              ) : <span style={{ color: 'var(--text-faint)' }}>TBD</span>}
                            </div>
                            {canEdit && (
                              <button className="btn ghost sm" style={{ flexShrink: 0 }} onClick={() => { setEditingMatchupIdx(idx); setMatchupDraft([aId, bId]); }}>Edit</button>
                            )}
                          </>
                        )}
                      </div>
                    );
                  })}

                  {canEdit && (
                    <div style={{ padding: '10px 16px' }}>
                      <button className="btn ghost sm" onClick={() => addMatchup(matchupWeek)}>+ Add Matchup</button>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        );
      })()}

      {/* ── Waiver Rules ── */}
      {activeTab === 'waivers' && (() => {
        const wr = data.waiverRules || DEFAULTS.waiverRules;
        const DAY_OPTIONS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
        const labelStyle = { fontSize: 10, fontWeight: 700, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '.1em', display: 'block', marginBottom: 6 };
        const fieldWrap = { marginBottom: 18 };

        return (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {!canEdit && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '9px 14px', borderRadius: 8, background: 'rgba(255,255,255,.04)', border: '1px solid var(--border)', fontSize: 12, color: 'var(--text-dim)' }}>
                <span style={{ fontSize: 14 }}>🔒</span>
                <span>View only — only <strong style={{ color: 'var(--text)' }}>Admins</strong> and <strong style={{ color: 'var(--text)' }}>Commissioners</strong> can edit waiver rules.</span>
              </div>
            )}

            {/* Waiver Settings Card */}
            <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 16px', borderBottom: '1px solid var(--border)' }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '.1em' }}>Waiver Settings</div>
                {canEdit && !editingWaiver && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontSize: 10, fontWeight: 700, color: editColor }}>{editLabel}</span>
                    <button className="btn ghost sm" onClick={() => { setWaiverDraft({ ...wr, days: [...(wr.days || [])] }); setEditingWaiver(true); }}>Edit</button>
                  </div>
                )}
                {canEdit && editingWaiver && (
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button className="btn ghost sm" onClick={() => setEditingWaiver(false)}>Cancel</button>
                    <button className="btn primary sm" onClick={saveWaiverRules}>Save</button>
                  </div>
                )}
              </div>
              <div style={{ padding: 16 }}>

                {/* Waivers Run Days */}
                <div style={fieldWrap}>
                  <label style={labelStyle}>Waivers Run</label>
                  {editingWaiver ? (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
                      {DAY_OPTIONS.map(day => (
                        <label key={day} style={{ display: 'flex', alignItems: 'center', gap: 5, cursor: 'pointer', fontSize: 13 }}>
                          <input type="checkbox"
                            checked={(waiverDraft.days || []).includes(day)}
                            onChange={e => setWaiverDraft(d => ({
                              ...d,
                              days: e.target.checked
                                ? [...(d.days || []), day]
                                : (d.days || []).filter(x => x !== day),
                            }))}
                          />
                          {day}
                        </label>
                      ))}
                    </div>
                  ) : (
                    <span style={{ fontSize: 13 }}>{(wr.days || []).join(', ') || 'Not set'}</span>
                  )}
                </div>

                {/* Priority Reset */}
                <div style={fieldWrap}>
                  <label style={labelStyle}>Waiver Priority Reset</label>
                  {editingWaiver ? (
                    <select className="input" value={waiverDraft.resetPolicy} onChange={e => setWaiverDraft(d => ({ ...d, resetPolicy: e.target.value }))}>
                      <option value="no-reset">Does not reset (based on prior waivers run)</option>
                      <option value="weekly">Resets weekly (worst standing picks first)</option>
                      <option value="snake">Snake draft order</option>
                    </select>
                  ) : (
                    <span style={{ fontSize: 13 }}>
                      {wr.resetPolicy === 'no-reset' ? "Doesn't reset (always based on prior waivers run)"
                        : wr.resetPolicy === 'weekly' ? 'Resets weekly (worst standing picks first)'
                        : 'Snake draft order'}
                    </span>
                  )}
                </div>

                {/* Waiver Period */}
                <div style={fieldWrap}>
                  <label style={labelStyle}>Waiver Period — days dropped players must remain on waivers</label>
                  {editingWaiver ? (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <input className="input" type="number" min={0} max={7} value={waiverDraft.period}
                        onChange={e => setWaiverDraft(d => ({ ...d, period: Number(e.target.value) }))}
                        style={{ width: 70 }} />
                      <span style={{ fontSize: 13, color: 'var(--text-dim)' }}>day(s)</span>
                    </div>
                  ) : (
                    <span style={{ fontSize: 13 }}>{wr.period} day{wr.period !== 1 ? 's' : ''}</span>
                  )}
                </div>

                {/* Claim Limit */}
                <div style={fieldWrap}>
                  <label style={labelStyle}>Claim Limit per Period</label>
                  {editingWaiver ? (
                    <select className="input" value={waiverDraft.limits} onChange={e => setWaiverDraft(d => ({ ...d, limits: e.target.value }))}>
                      <option value="no-limit">No limit</option>
                      {['1','2','3','4','5','10'].map(n => <option key={n} value={n}>{n} per period</option>)}
                    </select>
                  ) : (
                    <span style={{ fontSize: 13 }}>{wr.limits === 'no-limit' ? 'No limit' : `${wr.limits} per period`}</span>
                  )}
                </div>

                {/* Priority System */}
                <div style={{ marginBottom: editingWaiver && waiverDraft.prioritySystem === 'faab' ? 18 : 0 }}>
                  <label style={labelStyle}>Priority System</label>
                  {editingWaiver ? (
                    <select className="input" value={waiverDraft.prioritySystem} onChange={e => setWaiverDraft(d => ({ ...d, prioritySystem: e.target.value }))}>
                      <option value="continuous">Continuous rolling (never resets)</option>
                      <option value="weekly">Weekly reset (inverse standings)</option>
                      <option value="faab">Free Agent Acquisition Budget (FAAB)</option>
                      <option value="snake">Snake (alternating) order</option>
                    </select>
                  ) : (
                    <span style={{ fontSize: 13 }}>
                      {wr.prioritySystem === 'continuous' ? 'Continuous rolling'
                        : wr.prioritySystem === 'weekly' ? 'Weekly reset (inverse standings)'
                        : wr.prioritySystem === 'faab' ? `FAAB — $${wr.faabBudget} budget`
                        : 'Snake order'}
                    </span>
                  )}
                </div>

                {/* FAAB Budget (conditional) */}
                {editingWaiver && waiverDraft.prioritySystem === 'faab' && (
                  <div>
                    <label style={labelStyle}>FAAB Budget ($)</label>
                    <input className="input" type="number" min={50} max={1000} step={50} value={waiverDraft.faabBudget}
                      onChange={e => setWaiverDraft(d => ({ ...d, faabBudget: Number(e.target.value) }))}
                      style={{ width: 90 }} />
                  </div>
                )}
              </div>
            </div>

            {/* Additional Rules free-form */}
            <RuleCard label="Additional Waiver Rules" text={wr.additionalRules || ''} canEdit={canEdit}
              editLabel={editLabel} editColor={editColor}
              isEditing={editingRule === 'waivers-extra'} onEdit={() => setEditingRule('waivers-extra')}
              onCancel={() => setEditingRule(null)} onSave={saveWaiverAdditionalRules} />
          </div>
        );
      })()}

      {/* ── Playoff Rules ── */}
      {activeTab === 'playoffs' && (() => {
        const pr = data.playoffRules || DEFAULTS.playoffRules;
        const bracket = pr.bracket || {};
        const totalRounds = pr.length || 3;
        const roundMatchups = bracket[playoffBracketRound] || [];
        const labelStyle = { fontSize: 10, fontWeight: 700, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '.1em', display: 'block', marginBottom: 6 };
        const fieldWrap = { marginBottom: 18 };

        return (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {!canEdit && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '9px 14px', borderRadius: 8, background: 'rgba(255,255,255,.04)', border: '1px solid var(--border)', fontSize: 12, color: 'var(--text-dim)' }}>
                <span style={{ fontSize: 14 }}>🔒</span>
                <span>View only — only <strong style={{ color: 'var(--text)' }}>Admins</strong> and <strong style={{ color: 'var(--text)' }}>Commissioners</strong> can edit playoff rules.</span>
              </div>
            )}

            {/* Playoff Settings Card */}
            <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 16px', borderBottom: '1px solid var(--border)' }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '.1em' }}>Playoff Settings</div>
                {canEdit && !editingPlayoffSettings && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontSize: 10, fontWeight: 700, color: editColor }}>{editLabel}</span>
                    <button className="btn ghost sm" onClick={() => { setPlayoffSettingsDraft({ ...pr }); setEditingPlayoffSettings(true); }}>Edit</button>
                  </div>
                )}
                {canEdit && editingPlayoffSettings && (
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button className="btn ghost sm" onClick={() => setEditingPlayoffSettings(false)}>Cancel</button>
                    <button className="btn primary sm" onClick={savePlayoffSettings}>Save</button>
                  </div>
                )}
              </div>
              <div style={{ padding: 16 }}>

                {/* Playoff Start Date */}
                <div style={fieldWrap}>
                  <label style={labelStyle}>Playoff Start Date</label>
                  {editingPlayoffSettings ? (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                      <input className="input" type="date" value={playoffSettingsDraft.startDate || ''}
                        onChange={e => setPlayoffSettingsDraft(d => ({ ...d, startDate: e.target.value }))}
                        style={{ width: 170 }} />
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ fontSize: 12, color: 'var(--text-dim)' }}>NFL Week</span>
                        <select className="input" value={playoffSettingsDraft.startWeek || 15}
                          onChange={e => setPlayoffSettingsDraft(d => ({ ...d, startWeek: Number(e.target.value) }))}
                          style={{ width: 100 }}>
                          {Array.from({ length: 18 }, (_, i) => i + 1).map(w => (
                            <option key={w} value={w}>Week {w}</option>
                          ))}
                        </select>
                      </div>
                    </div>
                  ) : (
                    <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap' }}>
                      <span style={{ fontSize: 13 }}>
                        {pr.startDate
                          ? new Date(pr.startDate).toLocaleDateString('en-US', { weekday: 'short', month: 'long', day: 'numeric', year: 'numeric' })
                          : <span style={{ color: 'var(--text-faint)', fontStyle: 'italic' }}>Not set</span>}
                      </span>
                      <span style={{ fontSize: 13, color: 'var(--text-dim)' }}>NFL Week {pr.startWeek || 15}</span>
                    </div>
                  )}
                </div>

                {/* Qualifying Teams + Length */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 18 }}>
                  <div>
                    <label style={labelStyle}>Teams Qualifying</label>
                    {editingPlayoffSettings ? (
                      <select className="input" value={playoffSettingsDraft.numTeams}
                        onChange={e => setPlayoffSettingsDraft(d => ({ ...d, numTeams: Number(e.target.value) }))}>
                        {[4, 6, 8, 10, 12].map(n => <option key={n} value={n}>{n} teams</option>)}
                      </select>
                    ) : (
                      <span style={{ fontSize: 13 }}>{pr.numTeams} teams</span>
                    )}
                  </div>
                  <div>
                    <label style={labelStyle}>Playoff Length</label>
                    {editingPlayoffSettings ? (
                      <select className="input" value={playoffSettingsDraft.length}
                        onChange={e => setPlayoffSettingsDraft(d => ({ ...d, length: Number(e.target.value) }))}>
                        {[2, 3, 4].map(n => <option key={n} value={n}>{n} weeks</option>)}
                      </select>
                    ) : (
                      <span style={{ fontSize: 13 }}>{pr.length} weeks</span>
                    )}
                  </div>
                </div>

                {/* Tiebreaker */}
                <div>
                  <label style={labelStyle}>Playoff Tiebreaker</label>
                  {editingPlayoffSettings ? (
                    <select className="input" value={playoffSettingsDraft.tiebreaker}
                      onChange={e => setPlayoffSettingsDraft(d => ({ ...d, tiebreaker: e.target.value }))}>
                      <option value="Total Yards (TotYd)">Total Yards (TotYd)</option>
                      <option value="Most Points Scored">Most Points Scored</option>
                      <option value="Head-to-Head Record">Head-to-Head Record</option>
                      <option value="No tiebreaker (ties allowed)">No tiebreaker (ties allowed)</option>
                    </select>
                  ) : (
                    <span style={{ fontSize: 13 }}>{pr.tiebreaker}</span>
                  )}
                </div>
              </div>
            </div>

            {/* Playoff Bracket Builder */}
            <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 16px', borderBottom: '1px solid var(--border)' }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '.1em' }}>Playoff Bracket</div>
                {canEdit && (
                  <span style={{ fontSize: 10, fontWeight: 700, color: editColor }}>{editLabel}</span>
                )}
              </div>

              {/* Round selector */}
              <div style={{ display: 'flex', gap: 3, padding: '10px 16px', borderBottom: '1px solid var(--border)' }}>
                {Array.from({ length: totalRounds }, (_, i) => i + 1).map(r => (
                  <button key={r} onClick={() => { setPlayoffBracketRound(r); setEditingBracketIdx(null); }} style={{
                    padding: '4px 12px', borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: 'pointer',
                    border: '1px solid var(--border)',
                    background: r === playoffBracketRound ? 'var(--accent)' : 'transparent',
                    color: r === playoffBracketRound ? 'var(--accent-ink)' : 'var(--text-dim)',
                  }}>
                    {getBracketRoundLabel(r, totalRounds)}
                  </button>
                ))}
              </div>

              <div style={{ padding: '8px 0' }}>
                <div style={{ padding: '4px 16px 8px', fontSize: 10, fontWeight: 700, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '.1em' }}>
                  {getBracketRoundLabel(playoffBracketRound, totalRounds)} · Week {(pr.startWeek || 15) + playoffBracketRound - 1} · {roundMatchups.length} matchup{roundMatchups.length !== 1 ? 's' : ''}
                </div>

                {roundMatchups.length === 0 && (
                  <div style={{ padding: '16px', textAlign: 'center', fontSize: 12, color: 'var(--text-faint)' }}>
                    No matchups set for this round yet.
                    {canEdit && <span> Click <strong>+ Add Matchup</strong> below to set teams.</span>}
                  </div>
                )}

                {roundMatchups.map((pair, idx) => {
                  const [aId, bId] = pair || [];
                  const teamA = LEAGUE_TEAMS.find(t => t.id === aId);
                  const teamB = LEAGUE_TEAMS.find(t => t.id === bId);
                  const isEditing = editingBracketIdx === idx;

                  return (
                    <div key={idx} style={{ padding: '8px 16px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 10, fontSize: 12 }}>
                      {isEditing ? (
                        <>
                          <select className="input" value={bracketMatchupDraft[0] || ''} onChange={e => setBracketMatchupDraft(d => [e.target.value, d[1]])} style={{ flex: 1, fontSize: 12 }}>
                            <option value="">— Team A —</option>
                            {LEAGUE_TEAMS.map(t => <option key={t.id} value={t.id}>{t.name} ({t.owner})</option>)}
                          </select>
                          <span style={{ color: 'var(--text-faint)', fontWeight: 700, flexShrink: 0 }}>vs</span>
                          <select className="input" value={bracketMatchupDraft[1] || ''} onChange={e => setBracketMatchupDraft(d => [d[0], e.target.value])} style={{ flex: 1, fontSize: 12 }}>
                            <option value="">— Team B —</option>
                            {LEAGUE_TEAMS.filter(t => String(t.id) !== String(bracketMatchupDraft[0])).map(t => <option key={t.id} value={t.id}>{t.name} ({t.owner})</option>)}
                          </select>
                          <button className="btn primary sm" onClick={() => saveBracketMatchup(playoffBracketRound, idx)}>Save</button>
                          <button className="btn ghost sm" onClick={() => setEditingBracketIdx(null)}>✕</button>
                          {canEdit && <button className="btn ghost sm" style={{ color: 'var(--danger)' }} onClick={() => removeBracketMatchup(playoffBracketRound, idx)}>Del</button>}
                        </>
                      ) : (
                        <>
                          <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 6 }}>
                            {teamA ? (
                              <>
                                <span style={{ width: 22, height: 22, borderRadius: 4, background: teamA.color, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 8, fontWeight: 900, color: '#000', flexShrink: 0 }}>{teamA.logo}</span>
                                <div>
                                  <div style={{ fontWeight: 600 }}>{teamA.name}</div>
                                  <div style={{ fontSize: 10, color: 'var(--text-faint)' }}>{teamA.owner}</div>
                                </div>
                              </>
                            ) : <span style={{ color: 'var(--text-faint)' }}>TBD</span>}
                          </div>
                          <span style={{ color: 'var(--text-faint)', fontWeight: 700, flexShrink: 0, fontSize: 11 }}>vs</span>
                          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 6 }}>
                            {teamB ? (
                              <>
                                <div style={{ textAlign: 'right' }}>
                                  <div style={{ fontWeight: 600 }}>{teamB.name}</div>
                                  <div style={{ fontSize: 10, color: 'var(--text-faint)' }}>{teamB.owner}</div>
                                </div>
                                <span style={{ width: 22, height: 22, borderRadius: 4, background: teamB.color, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 8, fontWeight: 900, color: '#000', flexShrink: 0 }}>{teamB.logo}</span>
                              </>
                            ) : <span style={{ color: 'var(--text-faint)' }}>TBD</span>}
                          </div>
                          {canEdit && (
                            <button className="btn ghost sm" style={{ flexShrink: 0 }} onClick={() => { setEditingBracketIdx(idx); setBracketMatchupDraft([aId, bId]); }}>Edit</button>
                          )}
                        </>
                      )}
                    </div>
                  );
                })}

                {canEdit && (
                  <div style={{ padding: '10px 16px' }}>
                    <button className="btn ghost sm" onClick={() => addBracketMatchup(playoffBracketRound)}>+ Add Matchup</button>
                  </div>
                )}
              </div>
            </div>

            {/* Additional Playoff Rules free-form */}
            <RuleCard label="Additional Playoff Rules" text={pr.additionalRules || ''} canEdit={canEdit}
              editLabel={editLabel} editColor={editColor}
              isEditing={editingRule === 'playoffs-extra'} onEdit={() => setEditingRule('playoffs-extra')}
              onCancel={() => setEditingRule(null)} onSave={savePlayoffAdditionalRules} />
          </div>
        );
      })()}

      {/* ── League Message ── */}
      {activeTab === 'league-message' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <Card title="League Message">
            {commishMedia?.url && (
              <div style={{ padding: '0 16px 10px', position: 'relative' }}>
                {commishMedia.type === 'image'
                  ? <img src={commishMedia.url} alt={commishMedia.name} style={{ width: '100%', maxHeight: 220, objectFit: 'cover', borderRadius: 6, display: 'block' }} />
                  : <video src={commishMedia.url} controls autoPlay={false} style={{ width: '100%', maxHeight: 200, borderRadius: 6, display: 'block' }} />
                }
                {canEdit && (
                  <button onClick={removeMedia} style={{ position: 'absolute', top: 6, right: 22, background: 'rgba(0,0,0,.7)', border: 'none', borderRadius: 4, color: '#fff', fontSize: 11, padding: '2px 7px', cursor: 'pointer' }}>✕ Remove</button>
                )}
              </div>
            )}
            {commishMedia?.videoUrl && (
              <div style={{ padding: '0 16px 10px', position: 'relative' }}>
                <iframe
                  src={getEmbedUrl(commishMedia.videoUrl)}
                  style={{ width: '100%', height: 200, borderRadius: 6, border: 'none', display: 'block' }}
                  allow="accelerometer; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                  allowFullScreen
                  title="Commissioner Video"
                />
                {canEdit && (
                  <button onClick={removeVideoUrl} style={{ position: 'absolute', top: 6, right: 22, background: 'rgba(0,0,0,.7)', border: 'none', borderRadius: 4, color: '#fff', fontSize: 11, padding: '2px 7px', cursor: 'pointer' }}>✕ Remove URL</button>
                )}
              </div>
            )}
            {editField === 'commishMessage' ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <textarea className="input" value={fieldDraft} onChange={e => setFieldDraft(e.target.value)}
                  rows={6} style={{ width: '100%', boxSizing: 'border-box', resize: 'vertical', fontSize: 13, lineHeight: 1.6 }} />
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <input className="input" placeholder="YouTube / video URL (optional)…" value={commishUrlDraft} onChange={e => setCommishUrlDraft(e.target.value)} style={{ flex: 1, fontSize: 12 }} />
                  <button className="btn ghost sm" onClick={saveVideoUrl} disabled={!commishUrlDraft.trim()}>Set URL</button>
                </div>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <button className="btn primary sm" onClick={() => saveField('commishMessage')}>Save Message</button>
                  <button className="btn ghost sm" onClick={() => setEditField(null)}>Cancel</button>
                  <input ref={mediaInputRef} type="file" accept="image/*,video/*" style={{ display: 'none' }} onChange={handleMediaUpload} />
                  <button className="btn ghost sm" onClick={() => mediaInputRef.current?.click()} style={{ marginLeft: 'auto' }}>
                    {commishMedia?.url ? '📷 Replace File' : '📷 Upload Image / Video'}
                  </button>
                </div>
              </div>
            ) : (
              <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                <p style={{ fontSize: 13, color: 'var(--text-dim)', lineHeight: 1.7, margin: 0, flex: 1 }}>{data.commishMessage}</p>
                {canEdit && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                    <span style={{ fontSize: 10, fontWeight: 700, color: editColor, whiteSpace: 'nowrap' }}>{editLabel}</span>
                    <button className="btn ghost sm" onClick={() => { startFieldEdit('commishMessage', data.commishMessage); setCommishUrlDraft(commishMedia?.videoUrl || ''); }}>Edit</button>
                    <input ref={mediaInputRef} type="file" accept="image/*,video/*" style={{ display: 'none' }} onChange={handleMediaUpload} />
                    {!commishMedia?.url && <button className="btn ghost sm" onClick={() => mediaInputRef.current?.click()}>+ File</button>}
                    {!commishMedia?.videoUrl && (
                      <button className="btn ghost sm" onClick={() => { startFieldEdit('commishMessage', data.commishMessage); setCommishUrlDraft(''); }}>+ URL</button>
                    )}
                  </div>
                )}
              </div>
            )}
          </Card>
        </div>
      )}
    </div>
  );
}

// ── Shared primitives ──────────────────────────────────────────

function Card({ title, children }) {
  return (
    <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden' }}>
      <div style={{ padding: '10px 16px', borderBottom: '1px solid var(--border)', fontSize: 11, fontWeight: 700, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '.1em' }}>
        {title}
      </div>
      <div style={{ padding: 16 }}>{children}</div>
    </div>
  );
}

function Row({ label, value }) {
  return (
    <div style={{ display: 'flex', gap: 16, padding: '7px 0', borderBottom: '1px solid var(--border)', fontSize: 13, alignItems: 'flex-start' }}>
      <div style={{ minWidth: 200, color: 'var(--text-dim)', flexShrink: 0 }}>{label}</div>
      <div style={{ flex: 1 }}>{value}</div>
    </div>
  );
}

function SettingsTable({ rows, canEdit, editLabel, editColor, editField, fieldDraft, setFieldDraft, onEdit, onSave }) {
  return (
    <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden' }}>
      <div style={{ padding: '10px 16px', borderBottom: '1px solid var(--border)', fontSize: 11, fontWeight: 700, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '.1em' }}>
        League Info
      </div>
      {rows.map(({ label, key, value, editValue, password }) => (
        <div key={key} style={{ display: 'flex', gap: 16, padding: '10px 16px', borderBottom: '1px solid var(--border)', fontSize: 13, alignItems: 'center' }}>
          <div style={{ minWidth: 180, color: 'var(--text-dim)', flexShrink: 0 }}>{label}</div>
          <div style={{ flex: 1 }}>
            {editField === key ? (
              <div style={{ display: 'flex', gap: 8 }}>
                <input
                  className="input"
                  type={password ? 'password' : 'text'}
                  value={fieldDraft}
                  onChange={e => setFieldDraft(e.target.value)}
                  placeholder={password ? 'Enter key…' : ''}
                  style={{ flex: 1 }}
                  autoFocus
                />
                <button className="btn primary sm" onClick={() => onSave(key)}>Save</button>
                <button className="btn ghost sm" onClick={() => onEdit(null, '')}>✕</button>
              </div>
            ) : (
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span>{value}</span>
                {canEdit && (
                  <>
                    <span style={{ fontSize: 10, fontWeight: 700, color: editColor, marginLeft: 'auto', whiteSpace: 'nowrap' }}>{editLabel}</span>
                    <button className="btn ghost sm" onClick={() => onEdit(key, editValue !== undefined ? editValue : value)}>Edit</button>
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

function NumInput({ value, onChange }) {
  return (
    <input
      className="input"
      type="number"
      min={0}
      value={value}
      onChange={e => onChange(e.target.value)}
      style={{ width: 60, textAlign: 'center', padding: '3px 6px' }}
    />
  );
}

function Th({ children, align, style: s }) {
  return <th style={{ padding: '8px 12px', textAlign: align || 'left', fontSize: 11, fontWeight: 700, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '.08em', ...s }}>{children}</th>;
}
function Td({ children, align, style: s }) {
  return <td style={{ padding: '9px 12px', textAlign: align || 'left', color: 'var(--text)', verticalAlign: 'top', ...s }}>{children}</td>;
}

function ScoringSection({ title, rows, type, canEdit, editLabel, editColor, editing, onEdit, onDraftChange, onSave, onCancel }) {
  return (
    <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden' }}>
      <div style={{ padding: '10px 16px', borderBottom: '1px solid var(--border)', fontSize: 11, fontWeight: 700, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '.1em' }}>
        {title}
      </div>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
        <thead>
          <tr style={{ borderBottom: '1px solid var(--border)' }}>
            <Th style={{ width: 72 }}>Code</Th>
            <Th style={{ width: '30%' }}>Name</Th>
            <Th>Points / Rules</Th>
            {canEdit && <Th style={{ width: 100 }} />}
          </tr>
        </thead>
        <tbody>
          {rows.map((s, i) => {
            const isActive = editing && editing.type === type && editing.index === i;
            return (
              <tr key={s.code} style={{
                borderBottom: '1px solid var(--border)',
                background: isActive ? 'rgba(198,255,58,.05)' : 'transparent',
                transition: 'background .1s',
              }}>
                <Td>
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--accent)' }}>{s.code}</span>
                </Td>
                <Td>{s.name}</Td>
                <Td>
                  {isActive ? (
                    <textarea
                      className="input"
                      value={editing.draft}
                      onChange={e => onDraftChange(e.target.value)}
                      rows={Math.max(2, (editing.draft.match(/\n/g) || []).length + 1)}
                      autoFocus
                      style={{ width: '100%', boxSizing: 'border-box', resize: 'vertical', fontFamily: 'inherit', fontSize: 12, lineHeight: 1.55 }}
                    />
                  ) : (
                    <span style={{ color: 'var(--text-dim)', whiteSpace: 'pre-line', lineHeight: 1.65 }}>{s.value}</span>
                  )}
                </Td>
                {canEdit && (
                  <Td align="right">
                    {isActive ? (
                      <div style={{ display: 'flex', gap: 4, justifyContent: 'flex-end' }}>
                        <button className="btn primary sm" onClick={onSave}>Save</button>
                        <button className="btn ghost sm" onClick={onCancel}>✕</button>
                      </div>
                    ) : (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'flex-end' }}>
                        <span style={{ fontSize: 10, fontWeight: 700, color: editColor, whiteSpace: 'nowrap' }}>{editLabel}</span>
                        <button
                          className="btn ghost sm"
                          disabled={!!(editing && editing.type === type && editing.index !== i)}
                          onClick={() => onEdit(i, s.value)}
                        >
                          Edit
                        </button>
                      </div>
                    )}
                  </Td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function RuleCard({ label, text, canEdit, editLabel, editColor, isEditing, onEdit, onCancel, onSave }) {
  const [draft, setDraft] = React.useState(text);
  React.useEffect(() => { if (isEditing) setDraft(text); }, [isEditing, text]);
  return (
    <div style={{ background: 'var(--card)', border: `1px solid ${isEditing ? 'var(--accent)' : 'var(--border)'}`, borderRadius: 10, overflow: 'hidden' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 16px', borderBottom: '1px solid var(--border)' }}>
        <div style={{ fontSize: 13, fontWeight: 700 }}>{label}</div>
        {canEdit && !isEditing && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 10, fontWeight: 700, color: editColor, whiteSpace: 'nowrap' }}>{editLabel}</span>
            <button className="btn ghost sm" onClick={onEdit}>Edit</button>
          </div>
        )}
        {canEdit && isEditing && (
          <div style={{ display: 'flex', gap: 6 }}>
            <button className="btn ghost sm" onClick={onCancel}>Cancel</button>
            <button className="btn primary sm" onClick={() => onSave(draft)}>Save</button>
          </div>
        )}
      </div>
      <div style={{ padding: '12px 16px' }}>
        {isEditing ? (
          <textarea className="input" value={draft} onChange={e => setDraft(e.target.value)} rows={5}
            style={{ width: '100%', boxSizing: 'border-box', resize: 'vertical', fontFamily: 'inherit', fontSize: 13, lineHeight: 1.6 }} />
        ) : (
          <div style={{ fontSize: 13, color: 'var(--text-dim)', lineHeight: 1.7, whiteSpace: 'pre-line' }}>
            {text || <span style={{ color: 'var(--text-faint)', fontStyle: 'italic' }}>No rules defined yet.</span>}
          </div>
        )}
      </div>
    </div>
  );
}
