import React from 'react';
import { LEAGUE_TEAMS, DRAFT_PICKS, TEAMS_ORDER, DRAFT_ROUNDS, QUEUE as INIT_QUEUE, CHAT_MESSAGES, ROSTER_CONFIG, findTeam } from '../lib/data.js';
import { getPlayers, usePlayers, findPlayer } from '../lib/playerStore.js';
import { predictPicks } from '../lib/draft.js';
import { PosBadge, PlayerAvatar, PlayerCell, TeamLogoBadge } from '../components/ui.jsx';
import { useR2BreakoutCandidates } from '../hooks.js';
import { fetchSleeperPlayerStats } from '../lib/sleeper.js';
import { getPrefs, patchPrefs } from '../lib/remotePrefs.js';
import { api } from '../api.js';

const dstOverallRank = (posRank) => 150 + (posRank - 1) * 3;

// ── "Your turn" chime options — each is a list of [frequency, delaySeconds] tone pairs
// played through the shared playChime() synthesizer (no audio files). ────────────────
const TURN_CHIMES = [
  { id: 'classic',  label: 'Classic Chime',  notes: [[880, 0], [1100, 0.15], [1320, 0.3]] },
  { id: 'alert',    label: 'Alert Beep',     notes: [[880, 0], [880, 0.16], [880, 0.32]] },
  { id: 'bell',     label: 'Bell',           notes: [[1046.5, 0], [1318.5, 0.05], [1046.5, 0.35]] },
  { id: 'trill',    label: 'Trill',          notes: [[900, 0], [1200, 0.09], [900, 0.18], [1200, 0.27]] },
  { id: 'horn',     label: 'Horn',           notes: [[440, 0], [440, 0.22], [660, 0.44]] },
  { id: 'buzzer',   label: 'Buzzer',         notes: [[600, 0], [500, 0.13], [400, 0.26]] },
];
const DEFAULT_TURN_CHIME = TURN_CHIMES[0].id;

// ── Next Gen stat definitions per position ────────────────────────────────
const NG_STATS = {
  QB: [
    { id: 'snap_pct',   label: 'Snap%',     tip: 'Average snap share %' },
    { id: 'opp_score',  label: 'Opp Score', tip: 'Opportunity Score — snap + target opportunity combined' },
  ],
  RB: [
    { id: 'opp_score',  label: 'Opp Score', tip: 'Opportunity Score — snap + touch + target opportunity combined' },
    { id: 'snap_pct',   label: 'Snap%',     tip: 'Average snap share %' },
    { id: 'snap_delta', label: 'Snap Δ',    tip: 'Snap share change vs prior weeks (positive = trending up)' },
    { id: 'tgt_share',  label: 'Tgt Share', tip: 'Target share — % of team targets' },
    { id: 'yac',        label: 'YAC',       tip: 'Yards after catch per reception' },
  ],
  WR: [
    { id: 'opp_score',  label: 'Opp Score', tip: 'Opportunity Score' },
    { id: 'tgt_share',  label: 'Tgt Share', tip: 'Target share — % of team targets' },
    { id: 'snap_pct',   label: 'Snap%',     tip: 'Average snap share %' },
    { id: 'yac',        label: 'YAC',       tip: 'Yards after catch per reception' },
    { id: 'snap_delta', label: 'Snap Δ',    tip: 'Snap share change vs prior weeks' },
  ],
  TE: [
    { id: 'opp_score',  label: 'Opp Score', tip: 'Opportunity Score' },
    { id: 'tgt_share',  label: 'Tgt Share', tip: 'Target share — % of team targets' },
    { id: 'snap_pct',   label: 'Snap%',     tip: 'Average snap share %' },
  ],
};

function getNgVal(p, statId, breakoutByName) {
  const b = breakoutByName?.get(p.name.toLowerCase());
  switch (statId) {
    case 'opp_score':  return b?.opportunity_score != null ? +b.opportunity_score.toFixed(1) : null;
    case 'snap_pct':   return b?.avg_snap_share != null ? +(b.avg_snap_share * 100).toFixed(1) : null;
    case 'snap_delta': return b?.snap_share_delta != null ? +(b.snap_share_delta * 100).toFixed(1) : null;
    case 'tgt_share':  return p.targetShare > 0 ? +(p.targetShare * 100).toFixed(1) : null;
    case 'yac':        return p.yac > 0 ? +p.yac.toFixed(1) : null;
    default:           return null;
  }
}

function fmtNg(val, statId) {
  if (val == null) return '—';
  if (statId === 'snap_delta') return (val > 0 ? '+' : '') + val.toFixed(0) + '%';
  if (statId === 'snap_pct' || statId === 'tgt_share') return val.toFixed(0) + '%';
  if (statId === 'opp_score') return val.toFixed(1);
  return String(val);
}

export default function DraftRoom({ aiMode, user, onNav, onDraftPick, onDraftComplete, onDraftStatusChange, onOpenPlayer }) {
  const REAL_currentPickNum = 40;
  const isCommissioner = user?.isAdmin || user?.isCommissioner;

  // Mock draft mode — state is persisted to localStorage so navigating away and back resumes seamlessly
  const [mockPicks, setMockPicks] = React.useState(() => {
    try { const s = JSON.parse(localStorage.getItem('fantasai_mock_picks_wip') || 'null'); return Array.isArray(s) ? s : []; } catch { return []; }
  });
  const _session = (() => { try { return JSON.parse(localStorage.getItem('fantasai_mock_session') || 'null'); } catch { return null; } })();
  const _hasWip  = (() => { try { const s = JSON.parse(localStorage.getItem('fantasai_mock_picks_wip') || 'null'); return Array.isArray(s) && s.length > 0; } catch { return false; } })();
  const [mockActive, setMockActive]           = React.useState(() => _session?.active === true && _hasWip);
  const [mockPickNum, setMockPickNum]         = React.useState(() => _session?.active === true && _hasWip ? (_session.pickNum ?? 1) : 1);
  const [mockUserTeamId, setMockUserTeamId]   = React.useState(() => _session?.userTeamId ?? null);
  const [mockSetup, setMockSetup]             = React.useState(false);
  const [mockTeamsOrder, setMockTeamsOrder]   = React.useState(() => _session?.teamsOrder ?? [...TEAMS_ORDER]);
  const [mockSlotIndex, setMockSlotIndex]     = React.useState(null);

  // Persist mock session to localStorage whenever active state changes
  React.useEffect(() => {
    if (mockActive) {
      try {
        localStorage.setItem('fantasai_mock_session', JSON.stringify({
          active: true,
          userTeamId: mockUserTeamId,
          teamsOrder: mockTeamsOrder,
          pickNum: mockPickNum,
        }));
      } catch {}
    } else {
      try { localStorage.removeItem('fantasai_mock_session'); } catch {}
    }
    onDraftStatusChange?.(mockActive ? 'mock' : null);
  }, [mockActive, mockUserTeamId, mockTeamsOrder, mockPickNum]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Scheduled mock drafts ──────────────────────────────────────────────────
  const [mockSchedule, setMockSchedule] = React.useState(() => {
    try { return JSON.parse(localStorage.getItem('fantasai_mock_schedule') || '[]'); }
    catch { return []; }
  });
  const [showScheduleModal, setShowScheduleModal] = React.useState(false);
  const [scheduleDraft, setScheduleDraft] = React.useState({ date: '', rounds: DRAFT_ROUNDS, format: 'Snake' });
  const [joinDraftId, setJoinDraftId]     = React.useState(null);
  const [joinSlot, setJoinSlot]           = React.useState(null);

  function startMockDraft() {
    setMockPicks([]);
    setMockPickNum(1);
    setQueue([]);
    try { localStorage.removeItem('fantasai_mock_picks_wip'); } catch {}
    setMockUserTeamId(null);
    setMockSlotIndex(null);
    setMockTeamsOrder([...TEAMS_ORDER]);
    setMockSetup(true);
    setMockActive(true);
  }
  function beginMockDraft(slotIndex) {
    const myTeamId = user?.teamId || 1;
    const others   = TEAMS_ORDER.filter(id => id !== myTeamId);
    const newOrder = [...others.slice(0, slotIndex), myTeamId, ...others.slice(slotIndex)];
    setMockTeamsOrder(newOrder);
    setMockUserTeamId(myTeamId);
    setMockSetup(false);
    setPaused(false);
  }
  function exitMockDraft() {
    setMockActive(false);
    setMockPicks([]);
    setMockPickNum(1);
    setQueue([]);
    try { localStorage.removeItem('fantasai_mock_picks_wip'); } catch {}
    try { localStorage.removeItem('fantasai_mock_session'); } catch {}
    setMockUserTeamId(null);
    setMockSetup(false);
    setMockSlotIndex(null);
    setMockTeamsOrder([...TEAMS_ORDER]);
    setPaused(false);
    try { localStorage.removeItem('fantasai_draft_paused'); } catch {}
    // Don't let Autodraft/AI-Draft mode carry over into the idle "no draft active" state
    setUserDraftMode('manual');
    onDraftStatusChange?.(null);
  }
  const [draftLimitToast, setDraftLimitToast] = React.useState(null);
  React.useEffect(() => { if (draftLimitToast) { const t = setTimeout(() => setDraftLimitToast(null), 3000); return () => clearTimeout(t); } }, [draftLimitToast]);

  const posLimits = React.useMemo(() => {
    const base = { ...(ROSTER_CONFIG.rosterLimits || {}) };
    try {
      const settings = JSON.parse(localStorage.getItem('fantasai_league_settings') || 'null');
      const positions = settings?.positions || [];
      for (const p of positions) {
        const pos = p.key === 'RBWR' ? 'FLEX' : p.key;
        const total = p.rosterTotal;
        const activeMax = Number(p.activeMax);
        if (total === '0' || total === 0 || activeMax === 0) base[pos] = 0;
        else if (total !== 'No Limit' && total != null && total !== '') base[pos] = Number(total);
      }
    } catch {}
    return base;
  }, []);

  function checkPosLimit(playerId, teamId, existingPicks) {
    const p = findP(playerId);
    if (!p) return null;
    const max = posLimits[p.pos];
    if (max === 0) return `${p.pos} is not allowed in this league`;
    if (max == null) return null;
    const count = existingPicks.filter(pk => pk.teamId === teamId && pk.playerId).map(pk => findP(pk.playerId)).filter(x => x?.pos === p.pos).length;
    if (count >= max) return `${p.pos} limit reached (max ${max})`;
    return null;
  }

  function draftPlayer(playerId) {
    if (!mockActive) return;
    const teamId = mockUserTeamId || 1;
    const err = checkPosLimit(playerId, teamId, mockPicks);
    if (err) { setDraftLimitToast(err); return; }
    const round = Math.ceil(mockPickNum / 12);
    const s     = (mockPickNum - 1) % 12;
    setMockPicks(prev => [...prev, { pickNum: mockPickNum, teamId, playerId, round, slot: s + 1 }]);
    setMockPickNum(n => n + 1);
    setSeconds(clockSeconds);
    setQueue(q => q.filter(id => id !== playerId));
  }
  // Commish draft-on-behalf in mock mode: records pick for an arbitrary team at the current pick slot
  function commishMockPick(playerId, forTeamId) {
    if (!mockActive) return;
    const round = Math.ceil(mockPickNum / 12);
    const s     = (mockPickNum - 1) % 12;
    setMockPicks(prev => [...prev, { pickNum: mockPickNum, teamId: forTeamId, playerId, round, slot: s + 1 }]);
    setMockPickNum(n => n + 1);
    setSeconds(clockSeconds);
    setQueue(q => q.filter(id => id !== playerId));
  }

  const [seconds, setSeconds] = React.useState(73);
  const [paused, setPaused]   = React.useState(() => {
    try { return JSON.parse(localStorage.getItem('fantasai_draft_paused') || 'false'); } catch { return false; }
  });
  React.useEffect(() => {
    try { localStorage.setItem('fantasai_draft_paused', JSON.stringify(paused)); } catch {}
  }, [paused]);
  const [queue, setQueue]     = React.useState(INIT_QUEUE);

  // Ref so the setTimeout callback inside AI auto-pick always reads current mockPicks,
  // even if React batches the state update after the effect captures its closure.
  const mockPicksRef = React.useRef(mockPicks);
  React.useEffect(() => { mockPicksRef.current = mockPicks; }, [mockPicks]);

  // AI auto-picks non-user slots during mock draft
  React.useEffect(() => {
    if (!mockActive || mockSetup || paused || mockPickNum > TOTAL_PICKS || !mockUserTeamId) return;
    const round = Math.ceil(mockPickNum / 12);
    const s     = (mockPickNum - 1) % 12;
    // Use current mockTeamsOrder (now in deps — no stale closure)
    const onClockId = round % 2 === 1 ? mockTeamsOrder[s] : mockTeamsOrder[11 - s];
    if (onClockId === mockUserTeamId) return; // user's turn — wait
    const t = setTimeout(() => {
      // Read from ref so we never use a stale draftedSet even after a quick pick
      const currentPicks = mockPicksRef.current;
      const draftedSet = new Set(currentPicks.map(p => p.playerId));
      const pickedId = pickForTeamAuto(onClockId, mockPickNum, currentPicks, draftedSet);
      if (pickedId) {
        setMockPicks(prev => [...prev, { pickNum: mockPickNum, teamId: onClockId, playerId: pickedId, round, slot: s + 1 }]);
        setQueue(q => q.filter(id => id !== pickedId));
      }
      setMockPickNum(n => n + 1);
    }, 450);
    return () => clearTimeout(t);
  }, [mockActive, mockSetup, paused, mockPickNum, mockUserTeamId, mockTeamsOrder]);

  // Read draft date from league settings (stateful so saves are reflected immediately)
  const [draftSettings, setDraftSettings] = React.useState(() => {
    try { return JSON.parse(localStorage.getItem('fantasai_league_settings') || 'null')?.draft || {}; } catch { return {}; }
  });
  const draftDate = draftSettings.date ? new Date(draftSettings.date) : null;
  const isLive = !draftDate || draftDate <= new Date();
  const DRAFT_TEAM_COUNT  = draftSettings.teams  || LEAGUE_TEAMS.length;
  const DRAFT_ROUND_COUNT = draftSettings.rounds || DRAFT_ROUNDS; // 14 = 8 starters + 6 bench
  const TOTAL_PICKS       = DRAFT_TEAM_COUNT * DRAFT_ROUND_COUNT;

  const [isMobile, setIsMobile] = React.useState(() => window.matchMedia('(max-width: 900px)').matches);
  React.useEffect(() => {
    const mq = window.matchMedia('(max-width: 900px)');
    const h = e => setIsMobile(e.matches);
    mq.addEventListener('change', h);
    return () => mq.removeEventListener('change', h);
  }, []);
  const [mobileDraftTab, setMobileDraftTab] = React.useState('board'); // 'board' | 'picks' | 'chat'

  const [boardPos, setBoardPos] = React.useState('ALL');
  const [boardSearch, setBoardSearch] = React.useState('');
  const [boardSortCol, setBoardSortCol] = React.useState('rank'); // 'rank' | 'tier' | 'adp'
  const [ngColsByPos, setNgColsByPos] = React.useState({
    QB: new Set(),
    RB: new Set(['opp_score']),
    WR: new Set(['opp_score', 'tgt_share']),
    TE: new Set(['opp_score', 'tgt_share']),
  });
  function toggleNgCol(pos, statId) {
    setNgColsByPos(prev => {
      const cur = new Set(prev[pos] || []);
      if (cur.has(statId)) cur.delete(statId); else cur.add(statId);
      return { ...prev, [pos]: cur };
    });
  }
  const [boardSortDir, setBoardSortDir] = React.useState('asc');
  const [hideDrafted, setHideDrafted] = React.useState(false); // false = show greyed, true = remove drafted
  const [showRecap, setShowRecap] = React.useState(false);
  const [hidden, setHidden] = React.useState({ ghosts: false, queue: true, picklog: false, teams: false });
  const [detailPlayer, setDetailPlayer] = React.useState(null); // player clicked for detail panel
  const [chatMessages, setChatMessages] = React.useState(CHAT_MESSAGES);
  const [chatInput, setChatInput] = React.useState('');
  const [rosterPanelView, setRosterPanelView] = React.useState('roster'); // 'roster' | 'grid' | 'chat'
  const togglePanel = id => setHidden(h => ({ ...h, [id]: !h[id] }));

  // Mutable picks (so commissioner can undo/reset) — persisted so navigation doesn't lose state
  const [livePicks, setLivePicks] = React.useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem('fantasai_live_picks') || 'null');
      if (Array.isArray(saved) && saved.length === DRAFT_PICKS.length) return saved;
    } catch {}
    return DRAFT_PICKS;
  });

  // Commissioner's Concierge state
  const [editingDraftDate, setEditingDraftDate] = React.useState(false);
  const [draftDateDraft, setDraftDateDraft] = React.useState(draftSettings.date || '');
  const [resetDraftConfirm, setResetDraftConfirm] = React.useState(false);
  const [resetDraftConfirm2, setResetDraftConfirm2] = React.useState(false);
  const [clockSeconds, setClockSeconds] = React.useState(90);
  const [selectedPicks, setSelectedPicks] = React.useState(new Set());
  const [reversalLog, setReversalLog] = React.useState([]);
  const [commishLog, setCommishLog] = React.useState([]);
  const [livePickNum, setLivePickNum] = React.useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem('fantasai_live_pick_num') || 'null');
      return typeof saved === 'number' ? saved : REAL_currentPickNum;
    } catch { return REAL_currentPickNum; }
  });
  const [justFreedIds, setJustFreedIds] = React.useState(new Set()); // briefly highlighted after reversal
  const [teamModes, setTeamModes] = React.useState({}); // teamId -> 'manual'|'auto'|'ai'
  const [userDraftMode, setUserDraftMode] = React.useState('manual'); // 'manual' | 'auto' | 'ai'
  const myName = user?.name || user?.email?.split('@')[0] || 'You';
  function postChat(msg, extra = {}) {
    const ts = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    setChatMessages(prev => [...prev, { who: '⚡ System', color: 'var(--text-faint)', ts, msg, ai: true, ...extra }]);
  }

  // Draft sound on/off — persisted across sessions
  const [soundOn, setSoundOn] = React.useState(() => {
    try { return JSON.parse(localStorage.getItem('fantasai_draft_sound') ?? 'true'); } catch { return true; }
  });
  React.useEffect(() => {
    try { localStorage.setItem('fantasai_draft_sound', JSON.stringify(soundOn)); } catch {}
  }, [soundOn]);

  // Which chime plays for "your turn" — persisted across sessions
  const [turnChimeId, setTurnChimeId] = React.useState(() => {
    try {
      const saved = localStorage.getItem('fantasai_draft_turn_chime');
      return saved && TURN_CHIMES.some(c => c.id === saved) ? saved : DEFAULT_TURN_CHIME;
    } catch { return DEFAULT_TURN_CHIME; }
  });
  React.useEffect(() => {
    try { localStorage.setItem('fantasai_draft_turn_chime', turnChimeId); } catch {}
  }, [turnChimeId]);

  // Toast for autodraft on/off announcements (distinct from the red error toast below)
  const [autodraftToast, setAutodraftToast] = React.useState(null);
  React.useEffect(() => {
    if (autodraftToast) { const t = setTimeout(() => setAutodraftToast(null), 3500); return () => clearTimeout(t); }
  }, [autodraftToast]);

  // Shared draft audio-cue player — synthesized tones, no asset files. Gated by soundOn.
  function playChime(notes) {
    if (!soundOn) return;
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const now = ctx.currentTime;
      notes.forEach(([freq, delay]) => {
        const t0 = now + delay;
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.frequency.value = freq;
        gain.gain.setValueAtTime(0, t0);
        gain.gain.linearRampToValueAtTime(0.25, t0 + 0.04);
        gain.gain.exponentialRampToValueAtTime(0.001, t0 + 0.3);
        osc.start(t0);
        osc.stop(t0 + 0.3);
      });
    } catch {}
  }

  // Spoken voice announcement (Web Speech API — no audio files). Gated by soundOn, same as playChime.
  function speak(text) {
    if (!soundOn) return;
    try {
      if (!window.speechSynthesis) return;
      window.speechSynthesis.cancel(); // don't let announcements queue up and pile behind each other
      const utter = new SpeechSynthesisUtterance(text);
      utter.rate = 1.05;
      window.speechSynthesis.speak(utter);
    } catch {}
  }
  const [commishPickSearch, setCommishPickSearch] = React.useState('');
  const [commishPickTeamId, setCommishPickTeamId] = React.useState(null); // null = use onClockTeamId
  const storePlayerList = usePlayers(); // reactive — updates when R2/Sleeper data loads in App.jsx

  // Persist live draft state so navigation away and back doesn't reset picks
  React.useEffect(() => {
    if (!mockActive) {
      try { localStorage.setItem('fantasai_live_picks', JSON.stringify(livePicks)); } catch {}
      // Sync filled picks to R2 so draft origin (who/when) is visible to every
      // browser, not just the one that ran the draft.
      const filled = livePicks.filter(p => p.playerId);
      if (filled.length) api.draftPicks.save(filled);
    }
  }, [livePicks, mockActive]);
  React.useEffect(() => {
    if (!mockActive) {
      try { localStorage.setItem('fantasai_live_pick_num', JSON.stringify(livePickNum)); } catch {}
    }
  }, [livePickNum, mockActive]);

  // Persist in-progress mock picks (WIP) so navigating away mid-draft doesn't lose them.
  // Save as completed when the pick counter passes TOTAL_PICKS OR all picks are recorded.
  React.useEffect(() => {
    if (!mockActive) return;
    try { localStorage.setItem('fantasai_mock_picks_wip', JSON.stringify(mockPicks)); } catch {}
    if (mockPicks.length >= TOTAL_PICKS || mockPickNum > TOTAL_PICKS) {
      try { localStorage.setItem('fantasai_mock_picks_saved', JSON.stringify(mockPicks)); } catch {}
    }
  }, [mockPicks, mockPickNum, mockActive]);

  React.useEffect(() => {
    try { localStorage.setItem('fantasai_mock_schedule', JSON.stringify(mockSchedule)); } catch {}
  }, [mockSchedule]);

  // ── Scheduled mock draft helpers ───────────────────────────────────────────
  function createScheduledMock() {
    if (!scheduleDraft.date) return;
    const myTeamId = user?.teamId || 1;
    setMockSchedule(prev => [...prev, {
      id:          `mock_${Date.now()}`,
      hostTeamId:  myTeamId,
      date:        scheduleDraft.date,
      rounds:      scheduleDraft.rounds,
      format:      scheduleDraft.format,
      maxSlots:    12,
      participants: [{ teamId: myTeamId, slot: 0 }],
      status:      'scheduled',
      createdAt:   new Date().toISOString(),
    }]);
    setShowScheduleModal(false);
    setScheduleDraft({ date: '', rounds: DRAFT_ROUNDS, format: 'Snake' });
  }

  function joinScheduledMock(draftId, slot) {
    const myTeamId = user?.teamId || 1;
    setMockSchedule(prev => prev.map(d => {
      if (d.id !== draftId) return d;
      const others = d.participants.filter(p => p.teamId !== myTeamId);
      return { ...d, participants: [...others, { teamId: myTeamId, slot }] };
    }));
    setJoinDraftId(null);
    setJoinSlot(null);
  }

  function leaveScheduledMock(draftId) {
    const myTeamId = user?.teamId || 1;
    setMockSchedule(prev => prev.map(d =>
      d.id !== draftId ? d : { ...d, participants: d.participants.filter(p => p.teamId !== myTeamId) }
    ));
  }

  function cancelScheduledMock(draftId) {
    setMockSchedule(prev => prev.filter(d => d.id !== draftId));
  }

  function launchScheduledMock(draft) {
    const myTeamId = user?.teamId || 1;
    // Build a 12-slot order: human participants fill their chosen slots, AI teams fill the rest
    const order = new Array(draft.maxSlots).fill(null);
    for (const p of draft.participants) {
      if (p.slot < draft.maxSlots) order[p.slot] = p.teamId;
    }
    const participantIds = new Set(draft.participants.map(p => p.teamId));
    const aiTeams = TEAMS_ORDER.filter(id => !participantIds.has(id));
    let ai = 0;
    for (let i = 0; i < draft.maxSlots; i++) {
      if (order[i] === null) order[i] = aiTeams[ai++] ?? TEAMS_ORDER[i];
    }
    setMockPicks([]);
    setMockPickNum(1);
    try { localStorage.removeItem('fantasai_mock_picks_wip'); } catch {}
    setMockTeamsOrder(order);
    setMockUserTeamId(myTeamId);
    setMockSetup(false);
    setMockActive(true);
    setPaused(false);
    setMockSchedule(prev => prev.map(d => d.id === draft.id ? { ...d, status: 'in_progress' } : d));
  }

  // Player pool comes from the global store (loaded from R2 players_2026_draft in App.jsx).
  // No separate fetch needed — store already has filtered, deduped, 2026-accurate data.

  // Next gen stats from R2 breakout candidates (opp score, snap%, etc.)
  const { data: r2BreakoutsNg } = useR2BreakoutCandidates();
  const breakoutByName = React.useMemo(() => {
    if (!Array.isArray(r2BreakoutsNg)) return new Map();
    const m = new Map();
    r2BreakoutsNg.forEach(b => { if (b.player_name) m.set(b.player_name.toLowerCase(), b); });
    return m;
  }, [r2BreakoutsNg]);

  // ── Ranking sources ──────────────────────────────────────────────────────
  const RANK_SOURCES = [
    { id: 'cbs',      label: 'CBS Expert',     color: '#0d4ea2' },
    { id: 'fp',       label: 'FantasyPros ECR', color: '#ee4c2e' },
    { id: 'owner',    label: 'My Rankings',    color: '#a78bfa' },
  ];
  const [rankSource,    setRankSource]    = React.useState('fp');
  const [cbsRanks,      setCbsRanks]      = React.useState(null);
  const [cbsRankLoad,   setCbsRankLoad]   = React.useState(false);
  const [cbsRankErr,    setCbsRankErr]    = React.useState(null);
  const [fpRanks,       setFpRanks]       = React.useState(null);
  const [fpRankLoad,    setFpRankLoad]    = React.useState(false);
  const [fpRankErr,     setFpRankErr]     = React.useState(null);
  const [ownerRanks,    setOwnerRanks]    = React.useState(() => {
    const personal = getPrefs().personalRankings;
    if (Array.isArray(personal) && personal.length > 0) {
      const m = {};
      personal.forEach((id, i) => { m[Number(id)] = i + 1; m[String(id)] = i + 1; });
      return m;
    }
    return getPrefs().draftOwnerRanks || {};
  });

  // FantasAI ranks: sorted by proj PPG desc, ADP asc as tiebreaker — no fetch needed
  const fantasaiRankMap = React.useMemo(() => {
    const pool = storePlayerList.length > 0 ? storePlayerList : getPlayers();
    const sorted = [...pool]
      .filter(p => p.proj > 0 || p.adp < 999)
      .sort((a, b) => (b.proj - a.proj) || (a.adp - b.adp));
    const m = new Map();
    sorted.forEach((p, i) => m.set(p.id, i + 1));
    return m;
  }, [storePlayerList]);

  async function fetchCbsRankings() {
    if (cbsRanks || cbsRankLoad) return;
    setCbsRankLoad(true);
    setCbsRankErr(null);
    try {
      const res = await fetch('https://api.fantasai.net/api/v1/cbs/rankings?pos=ALL', { signal: AbortSignal.timeout(15000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setCbsRanks(data.rankings || []);
    } catch (e) { setCbsRankErr(e.message); }
    finally { setCbsRankLoad(false); }
  }

  async function fetchFpRankings() {
    if (fpRanks || fpRankLoad) return;
    setFpRankLoad(true);
    setFpRankErr(null);
    try {
      const fpUrl    = 'https://www.fantasypros.com/nfl/rankings/overall.json';
      const proxyUrl = `https://api.fantasai.net/api/v1/proxy?url=${encodeURIComponent(fpUrl)}`;
      const res = await fetch(proxyUrl, { signal: AbortSignal.timeout(15000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setFpRanks(data.players || []);
    } catch (e) { setFpRankErr(e.message); }
    finally { setFpRankLoad(false); }
  }

  function selectRankSource(id) {
    setRankSource(id);
    if (id === 'cbs') fetchCbsRankings();
    if (id === 'fp')  fetchFpRankings();
  }

  function setOwnerRank(playerId, rank) {
    const next = { ...ownerRanks };
    if (!rank || isNaN(rank)) { delete next[playerId]; }
    else { next[playerId] = Number(rank); }
    setOwnerRanks(next);
    patchPrefs({ draftOwnerRanks: next });
    const ordered = Object.entries(next).sort((a, b) => a[1] - b[1]).map(([id]) => Number(id));
    patchPrefs({ personalRankings: ordered });
  }

  // Returns sort rank for a player under the active ranking source
  // DSTs always use their overall ADP as a floor — never rank above it
  function getRank(p) {
    const dstFloor = p.pos === 'DST' ? (p.adp || 999) : 0;
    let rank;
    if (rankSource === 'fantasai') {
      rank = fantasaiRankMap.get(p.id) ?? 9999;
    } else if (rankSource === 'cbs' && cbsRanks) {
      const n = p.name?.toLowerCase();
      const r = cbsRanks.find(x => x.name?.toLowerCase() === n && x.pos === p.pos);
      rank = r ? r.rank : 9999;
    } else if (rankSource === 'fp' && fpRanks) {
      const n = p.name?.toLowerCase();
      const r = fpRanks.find(x => x.player_name?.toLowerCase() === n);
      rank = r ? (r.rank_ecr ?? r.rank_avg ?? 9999) : 9999;
    } else if (rankSource === 'owner') {
      rank = ownerRanks[p.id] ?? 9999;
    } else {
      rank = p.ecr ?? 9999;
    }
    return Math.max(rank, dstFloor);
  }

  function logCommish(type, message) {
    const ts = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    setCommishLog(prev => [...prev, { type, message, ts, id: Date.now() + Math.random(), pickNum: currentPickNum }]);
  }

  // Only run the pick clock when a draft is actually happening (mock in progress, or the live
  // draft window is open). DraftRoom stays mounted at all times so the "Return to Draft" banner
  // and background auto-picks keep working when the user navigates elsewhere — without this
  // guard, the clock (and everything downstream of it: turn chimes, autodraft) would keep running
  // against stale/default pick data even with no real draft active.
  React.useEffect(() => {
    if (paused || !(mockActive || isLive)) return;
    const t = setInterval(() => setSeconds(s => Math.max(0, s - 1)), 1000);
    return () => clearInterval(t);
  }, [paused, mockActive, isLive]);

  // When a non-user team's clock expires in a live draft, auto-draft a pick for them and switch
  // them to Autodraft for the rest of the draft so the room doesn't keep stalling on them.
  // (Mock-draft bot teams don't rely on this — they're already auto-picked the instant it becomes
  // their turn, well before the clock could expire.) The user's own timer-expiry auto-pick is
  // handled by a separate effect further down (after isMyTurn is defined) so the pick doesn't get
  // double-submitted by both effects firing at once.
  React.useEffect(() => {
    if (seconds === 0 && !paused) {
      const r = setTimeout(() => {
        if (!mockActive && !isMyTurn && !draftComplete) {
          const draftedSet = new Set(allPicks.filter(p => p.playerId).map(p => p.playerId));
          const pickId = pickForTeamAuto(onClockTeamId, currentPickNum, allPicks, draftedSet);
          if (pickId) {
            commishPick(pickId, onClockTeamId);
            if (getTeamMode(onClockTeamId) === 'manual') {
              const team = LEAGUE_TEAMS.find(x => x.id === onClockTeamId) || findTeam(onClockTeamId);
              setTeamModes(prev => ({ ...prev, [onClockTeamId]: 'auto' }));
              postChat(`${team?.name}'s pick clock expired — Autodraft turned ON for their remaining picks ⚡`);
              setAutodraftToast(`${team?.name} timed out — Autodraft turned ON`);
              playChime([[420, 0], [420, 0.18]]);
            }
            return;
          }
        }
        setSeconds(clockSeconds);
      }, 900);
      return () => clearTimeout(r);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seconds, paused, clockSeconds]); // isMyTurn/draftComplete/onClockTeamId/allPicks defined after this hook — read via closure

  function flashFreed(ids) {
    const s = new Set(ids);
    setJustFreedIds(s);
    setTimeout(() => setJustFreedIds(new Set()), 5000);
  }

  function reverseSelectedPicks(overrideSet) {
    const picksSet = overrideSet !== undefined ? overrideSet : selectedPicks;
    const current = mockActive ? mockPicks : livePicks;
    const picks = current.filter(p => picksSet.has(p.pickNum) && p.playerId);
    if (picks.length === 0) return;
    const ts = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const freedPlayerIds = picks.map(pk => pk.playerId);
    setReversalLog(prev => [...prev, ...picks.map(pk => ({ ...pk, type: 'reversal', reversedAt: ts }))]);
    const minPick = Math.min(...picks.map(p => p.pickNum));
    setPaused(true);
    if (mockActive) {
      setMockPicks(prev => prev.filter(p => !picksSet.has(p.pickNum)));
      setMockPickNum(minPick);
    } else {
      setLivePicks(prev => prev.map(p => picksSet.has(p.pickNum) ? { ...p, playerId: null } : p));
      setLivePickNum(minPick);
    }
    setSelectedPicks(new Set());
    flashFreed(freedPlayerIds);
    // Auto-resume after 3 seconds so the commish doesn't have to manually click Resume
    setTimeout(() => setPaused(false), 3000);
  }

  function removeLastPicks(n) {
    const ts = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    setPaused(true);
    setTimeout(() => setPaused(false), 3000);
    if (mockActive) {
      setMockPicks(prev => {
        const filled = prev.filter(p => p.playerId).sort((a, b) => a.pickNum - b.pickNum);
        const toRemove = filled.slice(-n);
        if (!toRemove.length) return prev;
        const nums = new Set(toRemove.map(p => p.pickNum));
        setReversalLog(r => [...r, ...toRemove.map(pk => ({ ...pk, type: 'reversal', reversedAt: ts }))]);
        setMockPickNum(Math.min(...toRemove.map(p => p.pickNum)));
        flashFreed(toRemove.map(p => p.playerId));
        return prev.filter(p => !nums.has(p.pickNum));
      });
    } else {
      setLivePicks(prev => {
        const filled = prev.filter(p => p.playerId).sort((a, b) => a.pickNum - b.pickNum);
        const toRemove = filled.slice(-n);
        if (!toRemove.length) return prev;
        const nums = new Set(toRemove.map(p => p.pickNum));
        setReversalLog(r => [...r, ...toRemove.map(pk => ({ ...pk, type: 'reversal', reversedAt: ts }))]);
        setLivePickNum(Math.min(...toRemove.map(p => p.pickNum)));
        flashFreed(toRemove.map(p => p.playerId));
        return prev.map(p => nums.has(p.pickNum) ? { ...p, playerId: null } : p);
      });
    }
  }

  function commishPick(playerId, overrideTeamId) {
    const pickNum = livePickNum;
    const teamId  = overrideTeamId ?? onClockTeamId;
    const err = checkPosLimit(playerId, teamId, livePicks.filter(p => p.playerId));
    if (err) { setDraftLimitToast(err); return; }
    setLivePicks(prev => prev.map(p => p.pickNum === pickNum ? { ...p, playerId, teamId, pickedAt: new Date().toISOString() } : p));
    setLivePickNum(n => n + 1);
    setSeconds(clockSeconds);
    setQueue(q => q.filter(id => id !== playerId));
    // Sync to roster when the logged-in user's team makes a live draft pick
    if (teamId === (user?.teamId)) onDraftPick?.(playerId);
  }

  function resetDraft() {
    const ts = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const msg = mockActive
      ? 'MOCK DRAFT RESET — All picks cleared, starting from pick 1'
      : 'DRAFT RESET — All players returned to the player pool';
    // Clear mock picks (state + localStorage)
    setMockPicks([]);
    setMockPickNum(1);
    try { localStorage.removeItem('fantasai_mock_picks_wip'); } catch {}
    try { localStorage.removeItem('fantasai_mock_session'); } catch {}
    // Clear live picks
    const clearedPicks = DRAFT_PICKS.map(p => ({ ...p, playerId: null }));
    setLivePicks(clearedPicks);
    setLivePickNum(1);
    try { localStorage.setItem('fantasai_live_picks', JSON.stringify(clearedPicks)); localStorage.setItem('fantasai_live_pick_num', '1'); } catch {}
    setReversalLog([]);
    setSelectedPicks(new Set());
    setJustFreedIds(new Set());
    setQueue(INIT_QUEUE);
    setPaused(true);
    setSeconds(clockSeconds);
    setTeamModes({});
    setCommishPickSearch('');
    setCommishPickTeamId(null);
    setCommishLog([{ type: 'reset', message: msg, ts, id: Date.now() }]);
    setResetDraftConfirm(false);
    setResetDraftConfirm2(false);
  }

  function saveDraftDate() {
    try {
      const saved = JSON.parse(localStorage.getItem('fantasai_league_settings') || '{}');
      const newDraft = { ...(saved.draft || {}), date: draftDateDraft };
      localStorage.setItem('fantasai_league_settings', JSON.stringify({ ...saved, draft: newDraft }));
      setDraftSettings(newDraft);
    } catch {}
    setEditingDraftDate(false);
  }

  const allPicks       = mockActive ? mockPicks : livePicks;
  const currentPickNum = mockActive ? mockPickNum : livePickNum;
  const draftedIds = new Set(allPicks.filter(p => p.playerId).map(p => p.playerId));

  const teamsOrder = mockActive ? mockTeamsOrder : TEAMS_ORDER;
  const currentRound = Math.ceil(currentPickNum / 12);
  const slot = ((currentPickNum - 1) % 12);
  const onClockTeamId = currentRound % 2 === 1 ? teamsOrder[slot] : teamsOrder[11 - slot];
  const onClockTeam = LEAGUE_TEAMS.find(t => t.id === onClockTeamId);

  // Auto-draft for live mode when a team's mode is 'auto' or 'ai'
  React.useEffect(() => {
    if (mockActive || !isLive || paused || livePickNum > TOTAL_PICKS) return;
    const mode = teamModes[onClockTeamId];
    if (!mode || mode === 'manual') return;
    const draftedSet = new Set(livePicks.filter(p => p.playerId).map(p => p.playerId));
    const t = setTimeout(() => {
      let pickId = null;
      if (mode === 'ai') {
        pickId = pickForTeamAuto(onClockTeamId, livePickNum, livePicks, draftedSet);
      } else {
        const queueId = queue.find(id => !draftedSet.has(id));
        pickId = queueId ?? pickForTeamAuto(onClockTeamId, livePickNum, livePicks, draftedSet);
      }
      if (pickId) {
        const pickNum = livePickNum;
        setLivePicks(prev => prev.map(p => p.pickNum === pickNum ? { ...p, playerId: pickId, teamId: onClockTeamId, pickedAt: new Date().toISOString() } : p));
        setLivePickNum(n => n + 1);
        setSeconds(clockSeconds);
        setQueue(q => q.filter(id => id !== pickId));
      }
    }, 1800);
    return () => clearTimeout(t);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mockActive, isLive, paused, livePickNum, teamModes, onClockTeamId]);

  const upcoming = [];
  for (let i = 1; i <= 12; i++) {
    const pn = currentPickNum + i;
    if (pn > TOTAL_PICKS) break;
    const round = Math.ceil(pn / 12);
    const s = ((pn - 1) % 12);
    const tid = round % 2 === 1 ? teamsOrder[s] : teamsOrder[11 - s];
    const team = findTeam(tid) || LEAGUE_TEAMS.find(t => t.id === tid);
    upcoming.push({ pick: pn, round, team, teamId: tid });
  }

  const currentPrediction = predictPicks(onClockTeamId, currentPickNum, draftedIds, 3);

  // Normalize API player IDs to store IDs (matched by name+pos) so findPlayer
  // works in the pick log, teams grid, and drafted-set filtering throughout the draft.
  // playerPool is the store list (R2 players_2026_draft, or Sleeper fallback).
  // Reactive via storePlayerList — re-renders when live data arrives.
  const playerPool = storePlayerList.length > 0 ? storePlayerList : getPlayers();

  // Searches playerPool first (includes API players not in local PLAYERS), then local PLAYERS.
  // Use this instead of findPlayer() anywhere a pick's playerId might be an API-only player.
  const findP = (id) => playerPool.find(p => p.id === id) || findPlayer(id);

  function handleBoardSort(col) {
    if (boardSortCol === col) {
      setBoardSortDir(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      setBoardSortCol(col);
      setBoardSortDir('asc');
    }
  }

  function getAdp(p) {
    const raw = p.adp ?? 9999;
    if (p.pos === 'DST') return Math.max(raw, dstOverallRank(1));
    return raw;
  }
  const boardSortFn = (a, b) => {
    let av, bv;
    if (boardSortCol === 'tier') { av = a.tier ?? 99; bv = b.tier ?? 99; }
    else if (boardSortCol === 'adp') { av = getAdp(a); bv = getAdp(b); }
    else { av = getRank(a); bv = getRank(b); }
    return boardSortDir === 'asc' ? av - bv : bv - av;
  };

  const FLEX_POS = new Set(['RB', 'WR']);
  function matchesPos(p, pos) {
    if (pos === 'ALL') return true;
    if (pos === 'FLEX') return FLEX_POS.has(p.pos);
    return p.pos === pos;
  }

  const DRAFT_MAX = React.useMemo(() => {
    const defaults = { QB: 2, RB: 6, WR: 6, TE: 2, K: 1, DST: 1 };
    for (const [pos, max] of Object.entries(posLimits)) {
      if (pos === 'FLEX') continue;
      defaults[pos] = max;
    }
    return defaults;
  }, [posLimits]);
  const DRAFT_MIN = { QB: 1, RB: 2, WR: 2, TE: 1, K: posLimits.K === 0 ? 0 : 1, DST: 1 };

  // Position-aware auto-pick for a given team (non-user AI turns + live auto mode)
  function pickForTeamAuto(teamId, pickNum, currentPicks, draftedSet) {
    const allPlayers = getPlayers();
    const available = allPlayers.filter(p => !draftedSet.has(p.id));
    const teamPickIds = currentPicks.filter(p => p.teamId === teamId && p.playerId).map(p => p.playerId);
    const posCounts = {};
    teamPickIds.forEach(pid => {
      const pl = allPlayers.find(x => x.id === pid);
      if (pl) posCounts[pl.pos] = (posCounts[pl.pos] || 0) + 1;
    });
    const round = Math.ceil(pickNum / (DRAFT_TEAM_COUNT || 12));
    // Late rounds: force fill any missing position minimums
    if (round >= 11) {
      for (const [pos, min] of Object.entries(DRAFT_MIN)) {
        if ((posCounts[pos] || 0) < min) {
          const fill = available.filter(p => p.pos === pos).sort((a, b) => (a.ecr || 999) - (b.ecr || 999))[0];
          if (fill) return fill.id;
        }
      }
    }
    // Use predictPicks but filter out positions that hit their max
    const preds = predictPicks(teamId, pickNum, draftedSet, 5);
    const validPred = preds.find(pred => (posCounts[pred.player.pos] || 0) < (DRAFT_MAX[pred.player.pos] ?? 99));
    if (validPred) return validPred.player.id;
    // Fallback: best ECR available within max caps
    const best = available
      .filter(p => (posCounts[p.pos] || 0) < (DRAFT_MAX[p.pos] ?? 99))
      .sort((a, b) => (a.ecr || 999) - (b.ecr || 999))[0];
    return best?.id ?? available.sort((a, b) => (a.ecr || 999) - (b.ecr || 999))[0]?.id ?? null;
  }

  function pickBestAvailable(draftedSet, myPickIds, pickNum, mode) {
    const allPlayers = getPlayers();
    const available = allPlayers.filter(p => !draftedSet.has(p.id));
    const posCounts = {};
    myPickIds.forEach(pid => {
      const pl = allPlayers.find(x => x.id === pid);
      if (pl) posCounts[pl.pos] = (posCounts[pl.pos] || 0) + 1;
    });

    // 1. Queue first
    const queueId = queue.find(id => !draftedSet.has(id));
    if (queueId) return queueId;

    // 2. AI mode — use predictPicks
    if (mode === 'ai') {
      const preds = predictPicks(onClockTeamId, pickNum, draftedSet, 1);
      return preds[0]?.player?.id ?? null;
    }

    // 3. Late-round emergency: fill missing minimums starting round 11
    const round = Math.ceil(pickNum / (draftSettings.teams || 12));
    if (round >= 11) {
      for (const [pos, min] of Object.entries(DRAFT_MIN)) {
        if ((posCounts[pos] || 0) < min) {
          const fill = available.filter(p => p.pos === pos).sort((a, b) => getRank(a) - getRank(b))[0];
          if (fill) return fill.id;
        }
      }
    }

    // 4. Best available respecting MAX limits
    const best = available
      .filter(p => (posCounts[p.pos] || 0) < (DRAFT_MAX[p.pos] ?? 99))
      .sort((a, b) => getRank(a) - getRank(b))[0];
    return best?.id ?? available.sort((a, b) => getRank(a) - getRank(b))[0]?.id ?? null;
  }

  // bestAvail = available only (used by commissioner search + "N available" count)
  let bestAvail = playerPool.filter(p => !draftedIds.has(p.id));
  if (boardPos !== 'ALL') bestAvail = bestAvail.filter(p => matchesPos(p, boardPos));
  if (boardSearch) bestAvail = bestAvail.filter(p => p.name.toLowerCase().includes(boardSearch.toLowerCase()));
  bestAvail.sort(boardSortFn);

  // boardDisplay = all players in rank order, drafted ones greyed in place (or hidden when toggled)
  let boardDisplay = playerPool.slice();
  if (boardPos !== 'ALL') boardDisplay = boardDisplay.filter(p => matchesPos(p, boardPos));
  if (boardSearch) boardDisplay = boardDisplay.filter(p => p.name.toLowerCase().includes(boardSearch.toLowerCase()));
  if (hideDrafted) boardDisplay = boardDisplay.filter(p => !draftedIds.has(p.id));
  boardDisplay.sort(boardSortFn);

  // Lookup map: playerId → pick info (round, slot, teamId)
  const pickByPlayerId = React.useMemo(() => {
    const m = {};
    for (const pk of allPicks) { if (pk.playerId) m[pk.playerId] = pk; }
    return m;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allPicks]);

  // Derived from currentPrediction so Big Board blue highlights match Ghost Picks exactly
  const aiSuggestions = currentPrediction.map((g, i) => ({
    id: g.player.id,
    why: `AI pick #${i + 1} for ${onClockTeam?.name ?? 'this team'} · ${g.likelihood}% likelihood · ${g.player.pos} ${g.player.name}`,
  }));

  // Active next gen stat columns for the current board position filter
  const activeNgCols = React.useMemo(() => {
    if (!NG_STATS[boardPos]) return [];
    const active = ngColsByPos[boardPos] || new Set();
    return NG_STATS[boardPos].filter(s => active.has(s.id));
  }, [boardPos, ngColsByPos]);

  const myDraftTeamId = mockActive ? (mockUserTeamId || 1) : (user?.teamId || 1);
  const myPicks = allPicks.filter(p => p.teamId === myDraftTeamId && p.playerId);
  const teamsForCols = teamsOrder.map(id => findTeam(id) || LEAGUE_TEAMS.find(t => t.id === id));

  // Unified autodraft-mode lookup: my own team uses userDraftMode; every other team uses the
  // commissioner-assignable teamModes map. Only meaningful in live drafts — in mock drafts every
  // non-user team is always AI-controlled anyway (not an "elected" autodraft state).
  function getTeamMode(teamId) {
    if (teamId === myDraftTeamId) return userDraftMode;
    return mockActive ? 'manual' : (teamModes[teamId] || 'manual');
  }
  // Unified setter — announces, toasts, and chimes consistently whether the owner set it themselves
  // or the commissioner assigned it on their behalf.
  function setTeamMode(teamId, mode) {
    const isMe = teamId === myDraftTeamId;
    if (isMe) setUserDraftMode(mode);
    else setTeamModes(prev => ({ ...prev, [teamId]: mode }));
    const team = LEAGUE_TEAMS.find(x => x.id === teamId) || findTeam(teamId);
    const label = mode === 'ai' ? 'AI-Draft (Ghost)' : 'Autodraft';
    if (mode === 'manual') {
      postChat(isMe
        ? `${myName} disabled ${label} — back to manual picking`
        : `Commissioner disabled autodraft for ${team?.name} — back to manual picking`);
      return;
    }
    const detail = mode === 'ai' ? 'AI is picking for them each round 🤖' : 'picking best available each round ⚡';
    postChat(isMe
      ? `${myName} enabled ${label} — ${detail}`
      : `Commissioner set ${team?.name} to ${label} — ${detail}`);
    setAutodraftToast(`${team?.name} — ${label} turned ON`);
    playChime(mode === 'ai' ? [[520, 0], [660, 0.16]] : [[420, 0], [420, 0.18]]);
  }

  const BELL_GRADES = ['A+','A','A-','B+','B','B-','C+','C','C-','D+','D','F'];
  const BELL_COLORS = { 'A+':'#1affa0','A':'#1affa0','A-':'#4caf82','B+':'#4ea8ff','B':'#4ea8ff','B-':'#4ea8ff','C+':'var(--text-dim)','C':'var(--text-dim)','C-':'var(--text-dim)','D+':'#ff9800','D':'#ff9800','F':'#ff4f4f' };
  const teamBellGrades = React.useMemo(() => {
    const scores = teamsForCols.filter(Boolean).map(t => {
      const picks = allPicks.filter(pk => pk.teamId === t.id && pk.playerId);
      const sum = picks.reduce((s, pk) => {
        const p = findP(pk.playerId);
        const rawAdp = p?.adp ?? p?.ecr ?? 999;
        return s + (rawAdp < 500 ? pk.pickNum - rawAdp : 0);
      }, 0);
      return { teamId: t.id, avg: picks.length ? sum / picks.length : -999 };
    }).sort((a, b) => b.avg - a.avg);
    const m = {};
    const n = scores.filter(s => s.avg > -999).length;
    scores.forEach((s, i) => {
      if (s.avg <= -999) { m[s.teamId] = null; return; }
      const pct = n > 1 ? i / (n - 1) : 0.5;
      m[s.teamId] = BELL_GRADES[Math.min(BELL_GRADES.length - 1, Math.floor(pct * BELL_GRADES.length))];
    });
    return m;
  }, [allPicks, teamsForCols]);

  const ghostPredictions = React.useMemo(() => {
    const drafted = new Set();
    const result = {};
    const completed = allPicks.filter(pk => pk.playerId).sort((a, b) => a.pickNum - b.pickNum);
    for (const pk of completed) {
      const preds = predictPicks(pk.teamId, pk.pickNum, drafted, 1);
      result[pk.pickNum] = preds[0] || null;
      drafted.add(pk.playerId);
    }
    return result;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allPicks]);
  const clockClass = seconds < 10 ? 'danger' : seconds < 30 ? 'warn' : '';
  const isMyTurn = onClockTeamId === myDraftTeamId;

  const draftComplete = currentPickNum > TOTAL_PICKS;

  // Count picks until the user's next turn (0 when it's their turn)
  const picksAway = React.useMemo(() => {
    if (isMyTurn) return 0;
    const total = teamsOrder.length || 12;
    for (let p = currentPickNum; p <= TOTAL_PICKS; p++) {
      const r = Math.ceil(p / total) - 1;
      const s = (p - 1) % total;
      const ord = r % 2 === 0 ? teamsOrder : [...teamsOrder].reverse();
      if (ord[s] === myDraftTeamId) return p - currentPickNum;
    }
    return 0;
  }, [isMyTurn, currentPickNum, teamsOrder, myDraftTeamId]);

  // Play audio alert when it becomes the user's turn — only when they'd actually need to act.
  // Skip it when Autodraft/AI-Draft is on, since the pick happens automatically a moment later
  // (this fires in the background even while browsing other screens — DraftRoom stays mounted —
  // so without this guard it produces a random-seeming chime every time an autodraft pick occurs).
  const isMyTurnRef = React.useRef(false);
  React.useEffect(() => {
    if (isMyTurn && !isMyTurnRef.current && !draftComplete && !paused && userDraftMode === 'manual' && (mockActive || isLive)) {
      const chime = TURN_CHIMES.find(c => c.id === turnChimeId) || TURN_CHIMES[0];
      playChime(chime.notes);
      setTimeout(() => speak('You are on the clock'), 400);
    }
    isMyTurnRef.current = isMyTurn;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isMyTurn, draftComplete, paused, soundOn, turnChimeId, userDraftMode, mockActive, isLive]);

  // Play a lighter "on deck" chime when the user becomes next up (one pick away) — same
  // manual-mode guard as the turn chime above.
  const picksAwayRef = React.useRef(null);
  React.useEffect(() => {
    if (picksAway === 1 && picksAwayRef.current !== 1 && !isMyTurn && !draftComplete && !paused && userDraftMode === 'manual' && (mockActive || isLive)) {
      playChime([[660, 0], [780, 0.16]]);
      setTimeout(() => speak('You are on deck'), 350);
    }
    picksAwayRef.current = picksAway;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [picksAway, isMyTurn, draftComplete, paused, soundOn, userDraftMode, mockActive, isLive]);

  // Push live draft metadata to App.jsx so the Return-to-Draft banner can show pick count & clock
  React.useEffect(() => {
    if (!mockActive && !isLive) return;
    const type = mockActive ? 'mock' : 'live';
    // Compute picks until next user turn
    let picksAway = 0;
    if (!isMyTurn) {
      const total = teamsOrder.length || 12;
      for (let p = currentPickNum; p <= TOTAL_PICKS; p++) {
        const r = Math.ceil(p / total) - 1;
        const s = (p - 1) % total;
        const ord = r % 2 === 0 ? teamsOrder : [...teamsOrder].reverse();
        if (ord[s] === myDraftTeamId) { picksAway = p - currentPickNum; break; }
      }
    }
    onDraftStatusChange?.(type, { isMyTurn, picksAway, seconds, currentPickNum, draftComplete, draftPaused: paused, onClockTeamName: onClockTeam?.name, onClockTeamLogo: onClockTeam?.logo });
  }, [mockActive, isLive, isMyTurn, currentPickNum, seconds, draftComplete, paused]); // eslint-disable-line react-hooks/exhaustive-deps
  const draftStatusText  = draftComplete ? 'Draft Complete' : paused ? 'Commissioner Paused Draft' : 'Draft Active';
  const draftStatusColor = draftComplete ? '#4caf82' : paused ? '#ff9800' : '#4caf82';

  // Timer expiry auto-pick: when the clock hits 0 on the user's turn, auto-draft best available.
  // Since they weren't watching the clock, also switch them to Autodraft for the rest of the
  // draft so future picks don't get missed the same way.
  React.useEffect(() => {
    if (seconds !== 0 || paused || !isMyTurn || draftComplete) return;
    const r = setTimeout(() => {
      const draftedSet = new Set(allPicks.filter(p => p.playerId).map(p => p.playerId));
      const myPickIds  = allPicks.filter(p => p.teamId === myDraftTeamId && p.playerId).map(p => p.playerId);
      const pickId = pickBestAvailable(draftedSet, myPickIds, currentPickNum, 'auto');
      if (pickId) {
        if (mockActive) { draftPlayer(pickId); }
        else { commishPick(pickId); }
        if (userDraftMode === 'manual') {
          setUserDraftMode('auto');
          postChat(`${myName}'s pick clock expired — Autodraft turned ON for the rest of the draft ⚡`);
          setAutodraftToast(`${onClockTeam?.name || myName} timed out — Autodraft turned ON`);
          playChime([[420, 0], [420, 0.18]]);
        }
      } else {
        setSeconds(clockSeconds);
      }
    }, 900);
    return () => clearTimeout(r);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seconds, paused, isMyTurn, draftComplete, currentPickNum, clockSeconds, mockActive]);

  // User autodraft/AI-draft: fires automatically on the user's turn when they've opted in
  React.useEffect(() => {
    if (paused || !(mockActive || isLive) || userDraftMode === 'manual' || !isMyTurn || draftComplete) return;
    const draftedSet = new Set(allPicks.filter(p => p.playerId).map(p => p.playerId));
    const myPickIds  = allPicks.filter(p => p.teamId === myDraftTeamId && p.playerId).map(p => p.playerId);
    const t = setTimeout(() => {
      const pickId = pickBestAvailable(draftedSet, myPickIds, currentPickNum, userDraftMode);
      if (pickId) {
        if (mockActive) { draftPlayer(pickId); }
        else { commishPick(pickId); }
      }
    }, 1500);
    return () => clearTimeout(t);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isMyTurn, userDraftMode, paused, draftComplete, currentPickNum, mockActive, isLive]);

  // When draft finishes, show DRAFT COMPLETE banner for 60 s then clear everything
  React.useEffect(() => {
    if (!draftComplete) return;
    // Notify parent so it can sync rosters from draft picks immediately
    onDraftComplete?.();
    const t = setTimeout(() => {
      onDraftStatusChange?.(null);
      try { localStorage.removeItem('fantasai_draft_paused'); } catch {}
      if (mockActive) {
        try { localStorage.removeItem('fantasai_mock_session'); } catch {}
        try { localStorage.removeItem('fantasai_mock_picks_wip'); } catch {}
      }
      // Don't let Autodraft/AI-Draft mode carry over into the idle "no draft active" state
      setUserDraftMode('manual');
    }, 60000);
    return () => clearTimeout(t);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftComplete]);

  // Notify parent when live draft is active (no mock running)
  React.useEffect(() => {
    if (isLive && !mockActive && !draftComplete) {
      onDraftStatusChange?.('live');
      return () => onDraftStatusChange?.(null);
    }
  }, [isLive, mockActive, draftComplete]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!isLive && !mockActive) {
    const myTeamId = user?.teamId || 1;
    const hasMockResults = (() => { try { const s = JSON.parse(localStorage.getItem('fantasai_mock_picks_saved') || 'null'); return Array.isArray(s) && s.filter(p => p.teamId === myTeamId && p.playerId).length > 0; } catch { return false; } })();

    const fmt = draftDate.toLocaleString([], { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
    const msLeft = draftDate - new Date();
    const days   = Math.floor(msLeft / 86400000);
    const hrs    = Math.floor((msLeft % 86400000) / 3600000);
    const mins   = Math.floor((msLeft % 3600000) / 60000);
    const countdown = days > 0 ? `${days}d ${hrs}h ${mins}m` : `${hrs}h ${mins}m`;

    const leftPanel = (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 18, padding: hasMockResults ? '32px 28px' : 40, textAlign: 'center' }}>
        <TeamLogoBadge team={null} size={48} />
        <div style={{ fontWeight: 900, fontSize: 22, color: 'var(--text)', letterSpacing: '-.01em' }}>Draft Room Not Yet Open</div>
        <div style={{ fontSize: 14, color: 'var(--text-dim)', maxWidth: 340, lineHeight: 1.6 }}>
          The {draftSettings.format || 'Snake'} draft is scheduled for:
        </div>
        <div style={{ fontWeight: 800, fontSize: 18, color: 'var(--accent)' }}>{fmt}</div>
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: 13, color: 'var(--text-faint)', background: 'var(--panel-1)', padding: '8px 18px', borderRadius: 8, border: '1px solid var(--border)' }}>
          Opens in {countdown}
        </div>
        <div style={{ fontSize: 12, color: 'var(--text-faint)', marginTop: 4 }}>
          Commissioners can change the date in{' '}
          <button onClick={() => onNav?.('settings')} style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: 'var(--accent)', fontWeight: 700, fontSize: 12, textDecoration: 'underline' }}>
            Rules &amp; Settings → Draft Settings
          </button>
        </div>
        <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, width: '100%', maxWidth: 280 }}>
          <button className="btn primary" style={{ fontSize: 14, padding: '10px 28px', letterSpacing: '.03em', width: '100%' }} onClick={startMockDraft}>
            ▶ Start Solo Mock
          </button>
          <button className="btn ghost" style={{ fontSize: 13, padding: '8px 20px', width: '100%' }} onClick={() => setShowScheduleModal(true)}>
            📅 Schedule Multi-Team Mock
          </button>
          <div style={{ fontSize: 11, color: 'var(--text-faint)', textAlign: 'center' }}>Solo: AI opponents only · Multi: invite league teammates</div>
        </div>
      </div>
    );

    const activeMocks    = mockSchedule.filter(d => d.status === 'scheduled');
    const hasRightContent = hasMockResults || activeMocks.length > 0;

    // ── Schedule modal ──────────────────────────────────────────────────────
    const scheduleModal = showScheduleModal && (
      <div className="drawer-overlay" onClick={() => setShowScheduleModal(false)}>
        <div style={{ position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%,-50%)', background: 'var(--panel)', border: '1px solid var(--border-strong)', borderRadius: 14, padding: 28, width: 400, maxWidth: 'calc(100vw - 32px)', zIndex: 400 }} onClick={e => e.stopPropagation()}>
          <div style={{ fontFamily: 'var(--font-display)', fontWeight: 900, fontStretch: '75%', fontSize: 18, marginBottom: 16 }}>Schedule Mock Draft</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div>
              <label style={{ fontSize: 11, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '.08em', display: 'block', marginBottom: 6 }}>Date &amp; Time</label>
              <input type="datetime-local" className="input" style={{ width: '100%' }} value={scheduleDraft.date} onChange={e => setScheduleDraft(p => ({ ...p, date: e.target.value }))} />
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div>
                <label style={{ fontSize: 11, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '.08em', display: 'block', marginBottom: 6 }}>Rounds</label>
                <select className="input" style={{ width: '100%' }} value={scheduleDraft.rounds} onChange={e => setScheduleDraft(p => ({ ...p, rounds: Number(e.target.value) }))}>
                  {[8, 10, 12, 14, 16, 18, 20].map(r => <option key={r} value={r}>{r} rounds</option>)}
                </select>
              </div>
              <div>
                <label style={{ fontSize: 11, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '.08em', display: 'block', marginBottom: 6 }}>Format</label>
                <select className="input" style={{ width: '100%' }} value={scheduleDraft.format} onChange={e => setScheduleDraft(p => ({ ...p, format: e.target.value }))}>
                  <option value="Snake">Snake</option>
                  <option value="Linear">Linear</option>
                </select>
              </div>
            </div>
          </div>
          <div style={{ marginTop: 20, display: 'flex', gap: 10 }}>
            <button className="btn primary" style={{ flex: 1 }} disabled={!scheduleDraft.date} onClick={createScheduledMock}>Create Lobby</button>
            <button className="btn ghost" onClick={() => setShowScheduleModal(false)}>Cancel</button>
          </div>
        </div>
      </div>
    );

    // ── Join slot picker modal ──────────────────────────────────────────────
    // ── Lobby card — inline slot picker ───────────────────────────────────
    function LobbyCard({ draft }) {
      const myTeamId = user?.teamId || 1;
      const myEntry  = draft.participants.find(p => p.teamId === myTeamId);
      const isHost   = draft.hostTeamId === myTeamId;
      const joined   = !!myEntry;
      const hostTeam = LEAGUE_TEAMS.find(t => t.id === draft.hostTeamId);
      const draftTime = new Date(draft.date);
      const timeLabel = draftTime.toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
      const filled    = draft.participants.length;

      function handleSlotClick(slotIdx) {
        const occupant = draft.participants.find(p => p.slot === slotIdx);
        if (occupant && occupant.teamId !== myTeamId) return; // taken by someone else
        joinScheduledMock(draft.id, slotIdx); // join or move to this slot
      }

      return (
        <div style={{ border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden', background: 'var(--panel-1)' }}>

          {/* Header */}
          <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ width: 32, height: 32, borderRadius: 8, background: hostTeam?.color || 'var(--accent)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 15, flexShrink: 0 }}>{hostTeam?.logo || '?'}</div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 700, fontSize: 13 }}>{hostTeam?.name || 'Unknown'}&apos;s Mock Draft</div>
              <div style={{ fontSize: 11, color: 'var(--text-dim)' }}>{timeLabel} · {draft.format} · {draft.rounds} rounds</div>
            </div>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, fontWeight: 700, color: filled >= draft.maxSlots ? 'var(--good)' : 'var(--accent)' }}>
              {filled}/{draft.maxSlots} joined
            </div>
          </div>

          {/* Instruction hint */}
          <div style={{ padding: '8px 16px 2px', fontSize: 11, color: 'var(--text-faint)' }}>
            {joined
              ? `You're in slot #${(myEntry.slot ?? 0) + 1} — click any open slot to move`
              : 'Click a slot below to claim your draft position'}
          </div>

          {/* Slot grid — 6 × 2, directly clickable */}
          <div style={{ padding: '8px 16px 12px', display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 8 }}>
            {Array.from({ length: draft.maxSlots }, (_, i) => {
              const occupant   = draft.participants.find(p => p.slot === i);
              const t          = occupant ? LEAGUE_TEAMS.find(x => x.id === occupant.teamId) : null;
              const isMe       = occupant?.teamId === myTeamId;
              const isOpen     = !occupant;
              const clickable  = isOpen || isMe; // can click open slots or your own (to leave — handled by leave btn)

              return (
                <div
                  key={i}
                  onClick={() => isOpen ? handleSlotClick(i) : undefined}
                  title={isOpen ? `Take slot #${i + 1}` : isMe ? 'Your slot' : `${t?.name ?? 'Team'} — slot taken`}
                  style={{
                    borderRadius: 9,
                    border: `2px solid ${isMe ? 'var(--accent)' : isOpen ? 'rgba(255,255,255,.1)' : 'var(--border)'}`,
                    background: isMe ? 'rgba(198,255,58,.14)' : isOpen ? 'var(--panel-2)' : 'var(--panel-3)',
                    cursor: isOpen ? 'pointer' : 'default',
                    padding: '10px 6px 8px',
                    display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 5,
                    opacity: !isOpen && !isMe ? 0.85 : 1,
                    transition: 'border-color .12s, background .12s',
                  }}
                  onMouseEnter={e => { if (isOpen) e.currentTarget.style.borderColor = 'var(--accent)'; }}
                  onMouseLeave={e => { if (isOpen) e.currentTarget.style.borderColor = 'rgba(255,255,255,.1)'; }}
                >
                  <span style={{ fontSize: 9, fontFamily: 'var(--font-mono)', color: isMe ? 'var(--accent)' : 'var(--text-faint)', fontWeight: isMe ? 700 : 400 }}>
                    Pick #{i + 1}
                  </span>
                  {t ? (
                    <>
                      <div style={{ width: 30, height: 30, borderRadius: 7, background: t.color || 'var(--panel-3)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 15, flexShrink: 0 }}>
                        {t.logo}
                      </div>
                      <span style={{ fontSize: 9, fontWeight: 700, color: isMe ? 'var(--accent)' : 'var(--text-dim)', textAlign: 'center', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', width: '100%' }}>
                        {isMe ? 'YOU' : (t.name?.split(' ').pop() ?? t.name)}
                      </span>
                    </>
                  ) : (
                    <>
                      <div style={{ width: 30, height: 30, borderRadius: 7, border: '1px dashed rgba(255,255,255,.18)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'rgba(255,255,255,.25)', fontSize: 18 }}>+</div>
                      <span style={{ fontSize: 9, color: 'var(--text-faint)', textAlign: 'center' }}>Open</span>
                    </>
                  )}
                </div>
              );
            })}
          </div>

          {/* Actions footer */}
          <div style={{ padding: '10px 16px', borderTop: '1px solid var(--border)', display: 'flex', gap: 8, alignItems: 'center' }}>
            {isHost && (
              <button className="btn ai sm" disabled={!joined} onClick={() => launchScheduledMock(draft)}>
                <span>▶</span> Start Now
              </button>
            )}
            {joined && !isHost && (
              <button className="btn ghost sm" style={{ color: 'var(--danger)' }} onClick={() => leaveScheduledMock(draft.id)}>
                Leave
              </button>
            )}
            {isHost && (
              <button className="btn ghost sm" style={{ color: 'var(--danger)', marginLeft: 'auto' }} onClick={() => cancelScheduledMock(draft.id)}>
                Cancel Draft
              </button>
            )}
            {!isHost && (
              <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--text-faint)' }}>
                {joined ? `You're in slot #${(myEntry?.slot ?? 0) + 1}` : `${draft.maxSlots - filled} slots still open`}
              </span>
            )}
          </div>
        </div>
      );
    }

    if (!hasRightContent) {
      return (
        <>
          {scheduleModal}
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
            {leftPanel}
          </div>
        </>
      );
    }

    return (
      <>
        {scheduleModal}
        <div style={{ display: 'flex', height: '100%', overflow: 'hidden' }}>
          {/* Left: countdown + start mock */}
          <div style={{ borderRight: '1px solid var(--border)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', flexShrink: 0, minWidth: 300 }}>
            {leftPanel}
          </div>

          {/* Right: lobby + optional mock draft results */}
          <div style={{ flex: 1, overflow: 'auto', display: 'flex', flexDirection: 'column' }}>

            {/* Scheduled mock lobby */}
            {activeMocks.length > 0 && (
              <div style={{ padding: '16px 24px', borderBottom: hasMockResults ? '1px solid var(--border)' : 'none', flexShrink: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                  <div style={{ fontWeight: 900, fontSize: 15, letterSpacing: '-.01em' }}>Mock Draft Lobby</div>
                  <button className="btn ghost sm" onClick={() => setShowScheduleModal(true)}>+ Schedule New</button>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  {activeMocks.map(d => <LobbyCard key={d.id} draft={d} />)}
                </div>
              </div>
            )}

            {/* Mock results banner — links to Draft Recap page */}
            {hasMockResults && (
              <div style={{ padding: '16px 24px', borderBottom: activeMocks.length > 0 ? '1px solid var(--border)' : 'none', display: 'flex', alignItems: 'center', gap: 14, background: 'rgba(255,165,0,.06)', borderTop: '1px solid rgba(255,165,0,.25)' }}>
                <div style={{ fontSize: 22 }}>📋</div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 800, fontSize: 14 }}>Mock Draft Results Available</div>
                  <div style={{ fontSize: 11, color: 'var(--text-faint)', marginTop: 2 }}>Your last mock draft has been graded — see picks, ADP comparison, and full board.</div>
                </div>
                <button className="btn primary sm" onClick={() => onNav?.('draftrecap')}>
                  View Draft Recap →
                </button>
              </div>
            )}
        </div>
        </div>
      </>
    );
  }

  // Mock draft slot-picker setup screen
  if (mockActive && mockSetup) {
    const myTeam = LEAGUE_TEAMS.find(t => t.id === (user?.teamId || 1));
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', gap: 22, padding: 40, textAlign: 'center' }}>
        <div style={{ fontSize: 36 }}>🏈</div>
        <div style={{ fontWeight: 900, fontSize: 22, color: 'var(--text)', letterSpacing: '-.01em' }}>Mock Draft Setup</div>

        {/* Logged-in team display */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 20px', borderRadius: 10, background: `${myTeam?.color}18`, border: `1px solid ${myTeam?.color}55` }}>
          <div style={{ width: 36, height: 36, borderRadius: 8, background: myTeam?.color, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16, fontWeight: 800, flexShrink: 0 }}>
            {myTeam?.logo}
          </div>
          <div style={{ textAlign: 'left' }}>
            <div style={{ fontWeight: 800, fontSize: 14, color: 'var(--text)' }}>{myTeam?.name}</div>
            <div style={{ fontSize: 11, color: 'var(--text-faint)' }}>Your team — choose which draft slot to occupy</div>
          </div>
        </div>

        {/* 12 slot cards */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10, width: '100%', maxWidth: 560 }}>
          {Array.from({ length: 12 }, (_, i) => i).map(slotIdx => {
            const isSelected = mockSlotIndex === slotIdx;
            const r1Pick = slotIdx + 1;
            const r2Pick = 12 - slotIdx;
            return (
              <button
                key={slotIdx}
                onClick={() => setMockSlotIndex(slotIdx)}
                style={{
                  background: isSelected ? `${myTeam?.color}22` : 'var(--panel)',
                  border: `1px solid ${isSelected ? myTeam?.color : 'var(--border)'}`,
                  borderRadius: 8, padding: '12px 8px', cursor: 'pointer',
                  display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4,
                  transition: 'all .12s', outline: isSelected ? `2px solid ${myTeam?.color}55` : 'none',
                }}
              >
                <span style={{ fontSize: 22, fontWeight: 900, color: isSelected ? myTeam?.color : 'var(--text-dim)', fontFamily: 'var(--font-mono)', lineHeight: 1 }}>
                  #{r1Pick}
                </span>
                <span style={{ fontSize: 9, color: 'var(--text-faint)', fontFamily: 'var(--font-mono)' }}>
                  R1:#{r1Pick} · R2:#{r2Pick}
                </span>
              </button>
            );
          })}
        </div>

        <div style={{ display: 'flex', gap: 12, marginTop: 4 }}>
          <button className="btn ghost" style={{ padding: '10px 22px' }} onClick={exitMockDraft}>Cancel</button>
          <button
            className="btn primary"
            disabled={mockSlotIndex === null}
            onClick={() => beginMockDraft(mockSlotIndex)}
            style={{ padding: '10px 28px', fontSize: 14, opacity: mockSlotIndex !== null ? 1 : 0.4 }}
          >
            ▶ Start Mock Draft
          </button>
        </div>

        {mockSlotIndex !== null && (
          <div style={{ fontSize: 11, color: 'var(--text-faint)' }}>
            {myTeam?.logo} {myTeam?.name} will draft at slot <strong style={{ color: myTeam?.color }}>#{mockSlotIndex + 1}</strong> —
            pick #{mockSlotIndex + 1} in odd rounds, pick #{12 - mockSlotIndex} in even rounds
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="draft-grid">
      {draftLimitToast && (
        <div style={{ position: 'fixed', top: 80, left: '50%', transform: 'translateX(-50%)', zIndex: 9999, background: '#ff4f4f', color: '#fff', padding: '10px 24px', borderRadius: 8, fontWeight: 700, fontSize: 14, boxShadow: '0 4px 20px rgba(0,0,0,.5)' }}>
          {draftLimitToast}
        </div>
      )}
      {autodraftToast && (
        <div style={{ position: 'fixed', top: 130, left: '50%', transform: 'translateX(-50%)', zIndex: 9999, background: 'var(--accent)', color: 'var(--accent-ink)', padding: '10px 24px', borderRadius: 8, fontWeight: 700, fontSize: 14, boxShadow: '0 4px 20px rgba(0,0,0,.5)' }}>
          ⚡ {autodraftToast}
        </div>
      )}
      {/* CLOCK BAR */}
      <div className="draft-clock" style={paused ? { background: 'linear-gradient(180deg, rgba(255,90,110,.18) 0%, rgba(255,90,110,.08) 100%)', animation: 'blink 1.2s infinite' } : isMyTurn ? { background: 'linear-gradient(180deg, rgba(76,175,130,.22) 0%, rgba(76,175,130,.10) 100%)' } : {}}>
        <div style={{ padding: '0 24px', borderRight: `1px solid ${paused ? 'rgba(255,90,110,.3)' : 'var(--border)'}`, display: 'flex', alignItems: 'center', gap: 16, alignSelf: 'stretch' }}>
          <span className={`clock-time ${clockClass}`} style={{ fontSize: 48 }}>
            {`${Math.floor(seconds / 60)}:${(seconds % 60).toString().padStart(2, '0')}`}
          </span>
          <div>
            <div className="mono dim" style={{ fontSize: 10, letterSpacing: '.12em', textTransform: 'uppercase', fontWeight: 700 }}>ON THE CLOCK</div>
            <div className="mono" style={{ fontSize: 11, color: 'var(--text)' }}>Pick #{currentPickNum} · Round {currentRound}</div>
          </div>
        </div>

        <div className="on-clock" style={{ flex: 1 }}>
          <div className="avatar lg" style={{ background: `linear-gradient(135deg, ${onClockTeam.color}cc, ${onClockTeam.color}33)`, color: '#fff' }}>
            <span style={{ position: 'relative', zIndex: 1 }}>{onClockTeam.logo}</span>
          </div>
          <div>
            <div className="name" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              {onClockTeam.name}
              {getTeamMode(onClockTeamId) !== 'manual' && (
                <span title={getTeamMode(onClockTeamId) === 'ai' ? 'This team is on AI-Draft (Ghost)' : 'This team is on Autodraft'} style={{
                  fontSize: 9, fontWeight: 800, padding: '1px 6px', borderRadius: 8, letterSpacing: '.04em',
                  background: getTeamMode(onClockTeamId) === 'ai' ? 'rgba(78,168,255,.15)' : 'rgba(198,255,58,.15)',
                  color: getTeamMode(onClockTeamId) === 'ai' ? 'var(--accent-2)' : 'var(--accent)',
                }}>
                  {getTeamMode(onClockTeamId) === 'ai' ? '🤖 AI' : '⚡ AUTO'}
                </span>
              )}
            </div>
            <div className="pick">{onClockTeam.owner}</div>
            {paused ? (
              <div style={{ fontSize: 13, fontWeight: 900, color: '#ff5a6e', letterSpacing: '.10em', textTransform: 'uppercase', animation: 'blink 1s infinite', marginTop: 3 }}>
                ⏸ DRAFT PAUSED
              </div>
            ) : isMyTurn ? (
              <div style={{ fontSize: 13, fontWeight: 900, color: '#4caf82', letterSpacing: '.10em', textTransform: 'uppercase', animation: 'blink 0.75s infinite', marginTop: 3 }}>
                ⚡ YOUR PICK
              </div>
            ) : !draftComplete && myDraftTeamId && (
              <div style={{ fontSize: 11, fontWeight: 800, color: '#ffb547', letterSpacing: '.08em', textTransform: 'uppercase', marginTop: 3 }}>
                PICK IN {picksAway} TURN{picksAway !== 1 ? 'S' : ''}
              </div>
            )}
          </div>
          <div className="up-next">
            <div style={{ fontSize: 9, fontWeight: 800, color: 'var(--text-faint)', letterSpacing: '.14em', textTransform: 'uppercase', flexShrink: 0, writingMode: 'vertical-rl', transform: 'rotate(180deg)' }}>NEXT</div>
            {upcoming.map((u, i) => {
              const isMe = u.team?.me || u.teamId === myDraftTeamId;
              const uMode = getTeamMode(u.teamId);
              return (
                <div key={u.pick} className={`tn ${isMe ? 'me' : ''}`} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '4px 7px', gap: 2, position: 'relative', minWidth: 36 }}>
                  {uMode !== 'manual' && (
                    <div
                      title={uMode === 'ai' ? 'On AI-Draft (Ghost)' : 'On Autodraft'}
                      style={{
                        position: 'absolute', top: 0, right: 2, width: 7, height: 7, borderRadius: '50%',
                        background: uMode === 'ai' ? 'var(--accent-2)' : 'var(--accent)',
                        boxShadow: `0 0 4px ${uMode === 'ai' ? 'var(--accent-2)' : 'var(--accent)'}`,
                      }}
                    />
                  )}
                  <div style={{ fontSize: 11, lineHeight: 1 }}>{u.team?.logo ?? '?'}</div>
                  <div style={{ fontSize: 9, fontFamily: 'var(--font-mono)', fontWeight: 700, color: isMe ? 'inherit' : 'var(--text-dim)', lineHeight: 1 }}>#{u.pick}</div>
                  {isMe && <div style={{ fontSize: 7, fontWeight: 900, letterSpacing: '.06em', lineHeight: 1, color: 'var(--accent-ink)' }}>YOU</div>}
                </div>
              );
            })}
          </div>
        </div>

        <div style={{ padding: '0 16px', display: 'flex', flexDirection: 'column', gap: 6, alignSelf: 'center' }}>
          <div style={{ fontSize: 15, fontWeight: 900, letterSpacing: '.04em', color: draftStatusColor, textShadow: `0 0 12px ${draftStatusColor}66`, lineHeight: 1 }}>
            {draftStatusText}
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            {mockActive && (
              <span style={{ fontSize: 10, fontWeight: 700, color: '#ffb547', background: 'rgba(255,180,0,.12)', border: '1px solid rgba(255,180,0,.3)', borderRadius: 4, padding: '2px 8px', letterSpacing: '.06em' }}>
                MOCK · {LEAGUE_TEAMS.find(t => t.id === mockUserTeamId)?.logo}
              </span>
            )}
            <button className="btn ghost sm" onClick={() => setShowRecap(!showRecap)}>Round {currentRound - 1} Recap</button>
            <button
              className="btn ghost sm"
              onClick={() => setSoundOn(s => !s)}
              title={soundOn ? 'Mute draft sounds (turn/on-deck chimes + voice announcements, autodraft alerts)' : 'Unmute draft sounds'}
              style={soundOn ? {} : { color: 'var(--text-faint)' }}
            >
              {soundOn ? '🔊 Sound' : '🔇 Muted'}
            </button>
            <select
              className="input"
              value={turnChimeId}
              onChange={e => setTurnChimeId(e.target.value)}
              disabled={!soundOn}
              title="Sound played when it becomes your turn to draft"
              style={{ fontSize: 11, padding: '2px 4px', width: 118 }}
            >
              {TURN_CHIMES.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
            </select>
            <button
              className="btn ghost sm"
              disabled={!soundOn}
              title="Preview this chime"
              onClick={() => {
                const chime = TURN_CHIMES.find(c => c.id === turnChimeId) || TURN_CHIMES[0];
                playChime(chime.notes);
              }}
              style={{ padding: '3px 8px' }}
            >
              ▶
            </button>
            {mockActive && !isMyTurn && !paused && (
              <span style={{ fontSize: 11, color: 'var(--text-faint)', fontFamily: 'var(--font-mono)' }}>AI picking…</span>
            )}
            {mockActive && paused && (
              <span style={{ fontSize: 11, color: '#ffb547', fontFamily: 'var(--font-mono)' }}>AI paused</span>
            )}
            <button className="btn sm" style={{ marginLeft: 8, background: '#ff4f4f', color: '#fff', borderColor: '#ff4f4f', fontWeight: 700 }} onClick={() => { if (mockActive) exitMockDraft(); onNav?.('roster'); }}>✕ Exit Draft</button>
          </div>
          {/* Panel visibility toggles */}
          <div style={{ display: 'flex', gap: 12, alignItems: 'center', paddingLeft: 2 }}>
            <span className="mono faint" style={{ fontSize: 9, letterSpacing: '.1em' }}>PANELS</span>
            {[
              { id: 'ghosts',  label: 'Ghost Picks' },
              { id: 'queue',   label: 'My Queue' },
              { id: 'picklog', label: 'Pick Log' },
              { id: 'teams',   label: 'Teams Grid' },
            ].map(p => (
              <label key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer', fontSize: 11, color: hidden[p.id] ? 'var(--text-faint)' : 'var(--text-dim)', userSelect: 'none' }}>
                <input type="checkbox" checked={!hidden[p.id]} onChange={() => togglePanel(p.id)}
                  style={{ cursor: 'pointer', accentColor: 'var(--accent)', width: 13, height: 13 }} />
                {p.label}
              </label>
            ))}
          </div>
        </div>
      </div>

      {/* Mobile tab bar — only visible on small screens */}
      {isMobile && (
        <div style={{ display: 'flex', gap: 0, borderBottom: '1px solid var(--border)', background: 'var(--bg-2)', gridColumn: '1 / -1' }}>
          {[
            { id: 'board', label: 'Board',   icon: '📋' },
            { id: 'picks', label: 'Picks',   icon: '🎯' },
            { id: 'chat',  label: 'Chat',    icon: '💬' },
          ].map(t => (
            <button key={t.id} onClick={() => setMobileDraftTab(t.id)} style={{
              flex: 1, padding: '10px 0', fontSize: 12, fontWeight: mobileDraftTab === t.id ? 700 : 500,
              border: 'none', borderBottom: mobileDraftTab === t.id ? '2px solid var(--accent)' : '2px solid transparent',
              background: 'transparent', color: mobileDraftTab === t.id ? 'var(--accent)' : 'var(--text-dim)',
              cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2,
            }}>
              <span style={{ fontSize: 16 }}>{t.icon}</span>
              <span>{t.label}</span>
            </button>
          ))}
        </div>
      )}

      {/* GHOST PICKS STRIP + CONCIERGE (right side) */}
      <div className="draft-ghosts" style={(hidden.ghosts || (isMobile && mobileDraftTab !== 'board')) ? { display: 'none' } : {}}>
        <div className="draft-ghosts-inner">
        <div className="ghost-label">
          <div className="ai-orb" style={{ width: 16, height: 16 }}></div>
          <span>GHOST PICKS</span>
          <span className="faint" style={{ fontWeight: 400, letterSpacing: 0, textTransform: 'none' }}>· predicted next moves based on each owner's draft DNA</span>
        </div>
        <div className="ghost-strip">
          <div className={`ghost-card oc ${isMyTurn ? 'me' : ''}`}>
            <div className="ghost-head">
              <span className="ghost-pick mono">#{currentPickNum}</span>
              <span className="ghost-owner">{onClockTeam.logo} {onClockTeam.owner}</span>
              <span className="ghost-now">ON CLOCK</span>
            </div>
            <div className="ghost-targets">
              {currentPrediction.map((g, i) => (
                <GhostTarget key={g.player.id} g={g} rank={i} isMe={isMyTurn} />
              ))}
            </div>
          </div>

          {upcoming.slice(0, 5).map(u => {
            const ghostPreds = predictPicks(u.teamId, u.pick, draftedIds, 3);
            return (
              <div key={u.pick} className={`ghost-card ${u.team.me ? 'me' : ''}`}>
                <div className="ghost-head sm">
                  <span className="ghost-pick mono">#{u.pick}</span>
                  <span className="ghost-owner sm">{u.team.logo} {u.team.owner}</span>
                </div>
                <div className="ghost-targets sm">
                  {ghostPreds.map((g, i) => (
                    <GhostTarget key={g.player.id} g={g} rank={i} compact />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
        </div>{/* closes draft-ghosts-inner */}
        {isCommissioner && (
        <div className="draft-concierge">

          {/* Label */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0, paddingRight: 10, borderRight: '1px solid rgba(255,180,0,.2)' }}>
            <span style={{ fontSize: 14 }}>👑</span>
            <span style={{ fontSize: 11, fontWeight: 900, color: '#ffb547', letterSpacing: '.07em', textTransform: 'uppercase', lineHeight: 1.2 }}>Commish<br/>Concierge</span>
          </div>

          {/* Pause / Resume */}
          <button
            style={{
              padding: '5px 16px', fontSize: 13, fontWeight: 900, flexShrink: 0,
              borderRadius: 6, cursor: 'pointer', letterSpacing: '.05em',
              border: `1.5px solid ${paused ? 'var(--accent)' : 'rgba(255,180,0,.5)'}`,
              background: paused ? 'rgba(198,255,58,.12)' : 'rgba(255,180,0,.1)',
              color: paused ? 'var(--accent)' : '#ffb547',
              boxShadow: paused ? '0 0 12px rgba(198,255,58,.2)' : 'none',
              transition: 'all .2s',
            }}
            onClick={() => {
              const next = !paused;
              setPaused(next);
              logCommish(next ? 'pause' : 'resume', next ? 'Commissioner paused the draft clock' : 'Commissioner resumed the draft clock');
            }}
          >
            {paused ? '▶ Resume' : '⏸ Pause'}
          </button>

          {/* Clock controls */}
          <div style={{ display: 'flex', gap: 4, alignItems: 'center', flexShrink: 0, paddingLeft: 2, borderLeft: '1px solid rgba(255,180,0,.15)' }}>
            <button className="btn ghost sm" style={{ fontSize: 12 }} onClick={() => { setSeconds(clockSeconds); setPaused(false); }}>↺ Reset</button>
            <select
              className="input"
              style={{ fontSize: 12, padding: '2px 4px', width: 64 }}
              value={clockSeconds}
              onChange={e => { const v = Number(e.target.value); setClockSeconds(v); setSeconds(v); logCommish('clock', `Commissioner set pick clock to ${v < 60 ? `${v}s` : `${v / 60}m`}`); }}
              title="Seconds per pick"
            >
              {[30, 60, 90, 120, 180, 300].map(s => (
                <option key={s} value={s}>{s < 60 ? `${s}s` : `${s/60}m`}</option>
              ))}
            </select>
          </div>

          {/* Undo picks */}
          <div style={{ display: 'flex', gap: 4, alignItems: 'center', flexShrink: 0, paddingLeft: 2, borderLeft: '1px solid rgba(255,180,0,.15)' }}>
            <button className="btn ghost sm" style={{ fontSize: 12 }} onClick={() => removeLastPicks(1)}>↩ Undo Last</button>
            {selectedPicks.size > 0 ? (
              <button style={{ fontSize: 12, padding: '3px 10px', background: '#ff9800', color: '#000', border: '1px solid #ff9800', borderRadius: 4, cursor: 'pointer', fontWeight: 700 }} onClick={() => reverseSelectedPicks()}>
                ↩ {selectedPicks.size} sel.
              </button>
            ) : (
              <span style={{ fontSize: 12, color: 'var(--text-faint)', fontStyle: 'italic' }}>select in log</span>
            )}
          </div>

          {/* Draft on behalf of — team + player picker, works in both mock and live mode */}
          {(() => {
            const pickTeamId = commishPickTeamId ?? onClockTeamId;
            const pickTeam   = LEAGUE_TEAMS.find(t => t.id === pickTeamId);
            const searchPool = mockActive
              ? playerPool.filter(p => !new Set(mockPicks.map(x => x.playerId)).has(p.id))
              : bestAvail;
            const matches    = commishPickSearch.trim()
              ? searchPool.filter(p => p.name.toLowerCase().includes(commishPickSearch.toLowerCase())).slice(0, 7)
              : [];
            function handleDraftOnBehalf(p) {
              if (mockActive) {
                commishMockPick(p.id, pickTeamId);
              } else {
                commishPick(p.id, pickTeamId);
                setPaused(false);
              }
              setCommishPickSearch('');
              setCommishPickTeamId(null);
              logCommish('pick', `Commissioner drafted ${p.name} (${p.pos}) for ${pickTeam?.name}`);
            }
            return (
              <div style={{ position: 'relative', display: 'flex', gap: 6, alignItems: 'center', flexShrink: 0, paddingLeft: 10, borderLeft: '1px solid rgba(78,168,255,.3)' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 1, flexShrink: 0 }}>
                  <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--accent-2)', textTransform: 'uppercase', letterSpacing: '.07em', lineHeight: 1.2 }}>Draft on</span>
                  <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--accent-2)', textTransform: 'uppercase', letterSpacing: '.07em', lineHeight: 1.2 }}>behalf of</span>
                </div>
                <select
                  className="input"
                  style={{ fontSize: 12, padding: '2px 4px', width: 110 }}
                  value={pickTeamId}
                  onChange={e => setCommishPickTeamId(Number(e.target.value))}
                >
                  {LEAGUE_TEAMS.map(t => (
                    <option key={t.id} value={t.id}>{t.logo} {t.name}</option>
                  ))}
                </select>
                <input
                  className="input"
                  style={{ fontSize: 12, padding: '2px 6px', width: 148 }}
                  placeholder="Search player…"
                  value={commishPickSearch}
                  onChange={e => setCommishPickSearch(e.target.value)}
                  autoComplete="off"
                />
                {matches.length > 0 && (
                  <div style={{
                    position: 'absolute', top: '100%', left: 0, zIndex: 60,
                    background: 'var(--panel-2)', border: '1px solid var(--border-strong)',
                    borderRadius: 6, minWidth: 280, boxShadow: '0 6px 24px rgba(0,0,0,.6)', overflow: 'hidden',
                  }}>
                    <div style={{ padding: '5px 10px', fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--accent-2)', background: 'rgba(78,168,255,.08)', borderBottom: '1px solid var(--border)' }}>
                      {pickTeam?.logo} {pickTeam?.name} · Pick #{currentPickNum}{mockActive ? ' (mock)' : ''}
                    </div>
                    {matches.map((p, i) => (
                      <div
                        key={p.id}
                        style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '7px 10px', cursor: 'pointer', borderBottom: i < matches.length - 1 ? '1px solid var(--border)' : 'none' }}
                        onMouseEnter={e => e.currentTarget.style.background = 'var(--hover)'}
                        onMouseLeave={e => e.currentTarget.style.background = ''}
                        onClick={() => handleDraftOnBehalf(p)}
                      >
                        <span style={{ fontSize: 11, padding: '1px 5px', borderRadius: 3, background: 'rgba(78,168,255,.15)', color: 'var(--accent-2)', flexShrink: 0 }}>{p.pos}</span>
                        <span style={{ fontWeight: 600, fontSize: 13, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</span>
                        <span style={{ fontSize: 12, color: 'var(--text-faint)', fontFamily: 'var(--font-mono)' }}>{p.team}</span>
                        <span style={{ fontSize: 12, color: 'var(--accent)', fontFamily: 'var(--font-mono)', fontWeight: 700 }}>{p.proj?.toFixed(1)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })()}

          {/* Mock Draft status (only shown once a mock is running — started from the pre-draft lobby, not from here) */}
          {mockActive && (
            <div style={{ display: 'flex', gap: 4, alignItems: 'center', flexShrink: 0, paddingLeft: 8, borderLeft: '1px solid rgba(255,180,0,.15)' }}>
              <span style={{ fontSize: 12, color: '#ffb547', whiteSpace: 'nowrap' }}>Mock · {mockPickNum > TOTAL_PICKS ? 'Done' : `Pick #${mockPickNum}`}</span>
            </div>
          )}

          {/* Danger — pushed to far right */}
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 4, alignItems: 'center', paddingLeft: 8, borderLeft: '1px solid rgba(255,80,80,.2)' }}>
            {resetDraftConfirm2 ? (
              <>
                <span style={{ fontSize: 11, color: '#ff5a6e', whiteSpace: 'nowrap' }}>Absolutely sure?</span>
                <button className="btn sm" style={{ fontSize: 12, background: '#ff5a6e', color: '#fff', borderColor: '#ff5a6e', fontWeight: 900 }} onClick={resetDraft}>YES, RESET</button>
                <button className="btn ghost sm" style={{ fontSize: 12 }} onClick={() => { setResetDraftConfirm(false); setResetDraftConfirm2(false); }}>No</button>
              </>
            ) : resetDraftConfirm ? (
              <>
                <span style={{ fontSize: 12, color: '#ff5a6e' }}>Sure?</span>
                <button className="btn sm" style={{ fontSize: 12, background: '#ff9800', color: '#000', borderColor: '#ff9800' }} onClick={() => setResetDraftConfirm2(true)}>Yes</button>
                <button className="btn ghost sm" style={{ fontSize: 12 }} onClick={() => setResetDraftConfirm(false)}>No</button>
              </>
            ) : (
              <button className="btn ghost sm" style={{ fontSize: 12, color: '#ff5a6e', borderColor: 'rgba(255,90,110,.3)' }} onClick={() => setResetDraftConfirm(true)}>⚠ Reset Draft</button>
            )}
          </div>

        </div>
        )}{/* closes isCommissioner concierge */}
      </div>{/* closes draft-ghosts */}

      {/* BIG BOARD */}
      <div className="draft-board" style={isMobile && mobileDraftTab !== 'board' ? { display: 'none' } : {}}>
        <div className="toolbar" style={{ padding: '10px 12px', borderBottom: '1px solid var(--border)', borderTop: 0 }}>
          <div className="card-title" style={{ flex: 1 }}>
            Big Board · {bestAvail.length} available
            {draftedIds.size > 0 && (
              <span style={{ fontSize: 10, fontWeight: 500, color: 'var(--text-faint)', marginLeft: 6 }}>
                · {draftedIds.size} drafted
              </span>
            )}
          </div>
          <button
            className={`btn ${userDraftMode === 'auto' ? 'primary' : 'secondary'} sm`}
            onClick={() => {
              const next = userDraftMode === 'auto' ? 'manual' : 'auto';
              setUserDraftMode(next);
              postChat(next === 'auto'
                ? `${myName} enabled Autodraft — picking best available automatically each round ⚡`
                : `${myName} disabled Autodraft — back to manual picking`);
              if (next === 'auto') {
                setAutodraftToast(`${LEAGUE_TEAMS.find(t => t.id === myDraftTeamId)?.name || myName} — Autodraft turned ON`);
                playChime([[420, 0], [420, 0.18]]);
              }
            }}
            title="Autodraft — picks best available based on ranking and roster needs"
          >
            {userDraftMode === 'auto' ? '⏸ Autodraft ON' : '⚡ Autodraft'}
          </button>
          <button
            className={`btn ${userDraftMode === 'ai' ? 'primary' : 'secondary'} sm`}
            onClick={() => {
              const next = userDraftMode === 'ai' ? 'manual' : 'ai';
              setUserDraftMode(next);
              postChat(next === 'ai'
                ? `${myName} enabled AI-Draft (Ghost) — AI is picking for them each round 🤖`
                : `${myName} disabled AI-Draft (Ghost) — back to manual picking`);
              if (next === 'ai') {
                setAutodraftToast(`${LEAGUE_TEAMS.find(t => t.id === myDraftTeamId)?.name || myName} — AI-Draft (Ghost) turned ON`);
                playChime([[520, 0], [660, 0.16]]);
              }
            }}
            title="AI-Draft (Ghost) — AI picks for you every round"
          >
            {userDraftMode === 'ai' ? '⏸ AI-Draft ON' : '🤖 AI-Draft (Ghost)'}
          </button>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            {storePlayerList.length > 0
              ? <span style={{ fontSize: 10, color: '#4caf82', fontFamily: 'var(--font-mono)' }}>● live ({storePlayerList.length})</span>
              : <span style={{ fontSize: 10, color: 'var(--text-faint)', fontFamily: 'var(--font-mono)' }}>loading…</span>
            }
          </div>
        </div>

        {/* Ranking source selector */}
        <div style={{ padding: '7px 12px', borderBottom: '1px solid var(--border)', display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <span style={{ fontSize: 9, fontFamily: 'var(--font-mono)', fontWeight: 700, letterSpacing: '.1em', textTransform: 'uppercase', color: 'var(--text-faint)', flexShrink: 0 }}>Rankings</span>
          {RANK_SOURCES.map(src => {
            const isActive = rankSource === src.id;
            const isLoading = (src.id === 'cbs' && cbsRankLoad) || (src.id === 'fp' && fpRankLoad);
            const hasErr    = (src.id === 'cbs' && cbsRankErr)  || (src.id === 'fp' && fpRankErr);
            const hasData   = (src.id === 'cbs' && cbsRanks)    || (src.id === 'fp' && fpRanks)
                           || src.id === 'sleeper' || src.id === 'owner' || src.id === 'fantasai';
            return (
              <button
                key={src.id}
                onClick={() => selectRankSource(src.id)}
                style={{
                  fontSize: 10, padding: '3px 10px', borderRadius: 4, cursor: 'pointer', fontWeight: isActive ? 700 : 500,
                  border: `1px solid ${isActive ? src.color : 'var(--border)'}`,
                  background: isActive ? `${src.color}22` : 'transparent',
                  color: isActive ? src.color : hasErr ? 'var(--danger)' : 'var(--text-dim)',
                  whiteSpace: 'nowrap', transition: 'all .12s',
                }}
                title={hasErr ? `Error: ${src.id === 'cbs' ? cbsRankErr : fpRankErr}` : undefined}
              >
                {isLoading ? `⟳ ${src.label}` : `${isActive ? '● ' : ''}${src.label}${hasErr ? ' ⚠' : !hasData && !isLoading ? ' ↓' : ''}`}
              </button>
            );
          })}
          {rankSource === 'owner' && (
            <span style={{ fontSize: 10, color: 'var(--text-faint)', fontStyle: 'italic' }}>
              · {Object.keys(ownerRanks).length} ranked · type a rank # in the My # column
            </span>
          )}
          {rankSource === 'fantasai' && (
            <span style={{ fontSize: 10, color: 'var(--text-faint)', fontStyle: 'italic' }}>
              · ranked by projected PPG from our pipeline
            </span>
          )}
        </div>

        <div style={{ padding: '8px 12px', borderBottom: '1px solid var(--border)', display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <div className="chips">
            {['ALL', 'QB', 'RB', 'WR', 'TE', 'FLEX', 'K', 'DST'].map(p => (
              <div key={p} className={`chip ${boardPos === p ? 'accent active' : ''}`} onClick={() => setBoardPos(p)}>{p}</div>
            ))}
          </div>
          {/* Hide Drafted slider */}
          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
            <span style={{ fontSize: 10, color: hideDrafted ? 'var(--text-faint)' : 'var(--text-dim)', whiteSpace: 'nowrap' }}>
              {hideDrafted ? 'Drafted hidden' : `${draftedIds.size} drafted`}
            </span>
            <button
              onClick={() => setHideDrafted(h => !h)}
              title={hideDrafted ? 'Show drafted players (greyed)' : 'Hide drafted players'}
              style={{
                width: 36, height: 20, borderRadius: 10, border: 'none', padding: 0,
                background: hideDrafted ? 'var(--accent)' : 'var(--border-strong)',
                position: 'relative', cursor: 'pointer', flexShrink: 0,
                transition: 'background .15s',
              }}
            >
              <span style={{
                position: 'absolute', top: 3, left: hideDrafted ? 19 : 3,
                width: 14, height: 14, borderRadius: '50%', background: '#fff',
                display: 'block', transition: 'left .15s',
              }} />
            </button>
            <span style={{ fontSize: 10, fontWeight: 700, color: hideDrafted ? 'var(--accent)' : 'var(--text-faint)', whiteSpace: 'nowrap' }}>
              Hide
            </span>
          </div>
        </div>
        <div style={{ padding: '8px 12px' }}>
          <input className="input search" placeholder="Find player" value={boardSearch} onChange={e => setBoardSearch(e.target.value)} style={{ width: '100%' }} />
        </div>

        {/* Inline player detail — replaces fixed right-side overlay */}
        {detailPlayer && (
          <InlinePlayerDetail
            player={detailPlayer}
            onClose={() => setDetailPlayer(null)}
            canDraft={isMyTurn || (isCommissioner && !mockActive)}
            isCommissioner={isCommissioner}
            isMyTurn={isMyTurn}
            onClockTeam={onClockTeam}
            onDraft={id => { mockActive ? draftPlayer(id) : commishPick(id); setDetailPlayer(null); }}
            inQueue={queue.includes(detailPlayer.id)}
            onToggleQueue={() => setQueue(q => q.includes(detailPlayer.id) ? q.filter(x => x !== detailPlayer.id) : [...q, detailPlayer.id])}
            breakoutByName={breakoutByName}
            onOpenPlayer={onOpenPlayer}
          />
        )}

        {/* Next Gen stat column selector — shown when a position is filtered */}
        {NG_STATS[boardPos] && (
          <div style={{ padding: '5px 12px 7px', borderBottom: '1px solid var(--border)', background: 'rgba(198,255,58,.025)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 9, fontWeight: 800, fontFamily: 'var(--font-mono)', color: '#c6ff3a', textTransform: 'uppercase', letterSpacing: '.1em', flexShrink: 0, opacity: 0.7 }}>
                Next Gen
              </span>
              {NG_STATS[boardPos].map(stat => {
                const on = (ngColsByPos[boardPos] || new Set()).has(stat.id);
                return (
                  <button
                    key={stat.id}
                    onClick={() => toggleNgCol(boardPos, stat.id)}
                    title={stat.tip}
                    style={{
                      fontSize: 10, padding: '2px 9px', borderRadius: 10,
                      border: `1px solid ${on ? 'var(--accent)' : 'var(--border)'}`,
                      background: on ? 'rgba(198,255,58,.14)' : 'transparent',
                      color: on ? 'var(--accent)' : 'var(--text-faint)',
                      cursor: 'pointer', fontWeight: on ? 700 : 400,
                    }}
                  >
                    {on ? '✓ ' : ''}{stat.label}
                  </button>
                );
              })}
              {activeNgCols.length > 0 && (
                <span style={{ fontSize: 9, color: 'var(--text-faint)', marginLeft: 2, fontStyle: 'italic' }}>
                  columns added ↓
                </span>
              )}
            </div>
          </div>
        )}

        {/* Autodraft / AI-Draft active banner */}
        {userDraftMode !== 'manual' && (
          <div style={{
            display: 'flex', alignItems: 'center', gap: 8,
            padding: '7px 12px',
            background: userDraftMode === 'ai' ? 'rgba(78,168,255,.10)' : 'rgba(198,255,58,.08)',
            borderBottom: `1px solid ${userDraftMode === 'ai' ? 'rgba(78,168,255,.28)' : 'rgba(198,255,58,.28)'}`,
            borderLeft: `3px solid ${userDraftMode === 'ai' ? 'var(--accent-2)' : 'var(--accent)'}`,
          }}>
            <div className="live-dot" style={{
              background: userDraftMode === 'ai' ? 'var(--accent-2)' : 'var(--accent)',
              boxShadow: `0 0 0 4px ${userDraftMode === 'ai' ? 'rgba(78,168,255,.18)' : 'rgba(198,255,58,.18)'}`,
              flexShrink: 0,
            }} />
            <span style={{ fontSize: 11, fontWeight: 800, fontFamily: 'var(--font-mono)', color: userDraftMode === 'ai' ? 'var(--accent-2)' : 'var(--accent)', letterSpacing: '.08em', textTransform: 'uppercase' }}>
              {userDraftMode === 'ai' ? 'AI-Draft Active' : 'Autodraft Active'}
            </span>
            <span style={{ fontSize: 11, color: 'var(--text-dim)' }}>
              — {userDraftMode === 'ai' ? 'AI is picking for you each round' : 'picking best available each round'}
            </span>
            <button
              className="btn ghost sm"
              style={{ fontSize: 10, padding: '1px 7px', marginLeft: 'auto', color: 'var(--text-faint)', flexShrink: 0 }}
              onClick={() => {
                setUserDraftMode('manual');
                postChat(`${myName} disabled ${userDraftMode === 'ai' ? 'AI-Draft (Ghost)' : 'Autodraft'} — back to manual picking`);
              }}
            >
              Cancel
            </button>
          </div>
        )}

        {justFreedIds.size > 0 && (
          <div style={{ padding: '8px 12px', background: 'rgba(76,175,130,.12)', borderBottom: '1px solid rgba(76,175,130,.3)' }}>
            <div style={{ fontSize: 9, fontWeight: 800, color: '#4caf82', textTransform: 'uppercase', letterSpacing: '.08em', marginBottom: 5 }}>
              ↩ Returned to pool — draft again or close
            </div>
            {[...justFreedIds].map(id => {
              const p = findPlayer(id);
              if (!p) return null;
              const inQueue = queue.includes(p.id);
              return (
                <div key={id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0', fontSize: 11 }}>
                  <PosBadge pos={p.pos} />
                  <span style={{ fontWeight: 700, color: '#4caf82' }}>{p.name}</span>
                  <span style={{ color: 'var(--text-faint)', fontFamily: 'var(--font-mono)', fontSize: 10 }}>{p.team} · ECR {p.ecr}</span>
                  <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
                    <button className="btn sm icon" style={inQueue ? { background: 'var(--accent)', color: 'var(--accent-ink)', borderColor: 'var(--accent)' } : {}}
                      onClick={() => setQueue(inQueue ? queue.filter(x => x !== p.id) : [...queue, p.id])}>
                      {inQueue ? '✓' : '+'}
                    </button>
                    {(isMyTurn || (isCommissioner && !mockActive)) && (
                      <button className="btn sm primary" style={{ padding: '3px 10px', fontSize: 10, background: '#4caf82', borderColor: '#4caf82' }}
                        onClick={() => { mockActive ? draftPlayer(p.id) : commishPick(p.id); setJustFreedIds(prev => { const n = new Set(prev); n.delete(p.id); return n; }); }}>
                        Re-draft →
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
        <div style={{ flex: 1, overflow: 'auto' }}>
          <table className="data-table" style={{ fontSize: 12 }}>
            <thead>
              <tr>
                <th
                  onClick={() => handleBoardSort('rank')}
                  style={{ cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap' }}
                  title="Sort by ranking"
                >
                  # {boardSortCol === 'rank' ? (boardSortDir === 'asc' ? '▲' : '▼') : ''}
                </th>
                <th>Player</th>
                <th
                  className="num"
                  onClick={() => handleBoardSort('tier')}
                  style={{ cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap' }}
                  title="Sort by tier"
                >
                  Tier {boardSortCol === 'tier' ? (boardSortDir === 'asc' ? '▲' : '▼') : ''}
                </th>
                <th
                  className="num"
                  onClick={() => handleBoardSort('adp')}
                  style={{ cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap' }}
                  title="Sort by ADP"
                >
                  {rankSource === 'fantasai' ? 'AI Rank' : rankSource === 'sleeper' ? 'ADP' : rankSource === 'cbs' ? 'CBS' : rankSource === 'fp' ? 'FP ECR' : rankSource === 'owner' ? 'My #' : 'Rank'} {boardSortCol === 'adp' ? (boardSortDir === 'asc' ? '▲' : '▼') : ''}
                </th>
                {activeNgCols.map(s => (
                  <th key={s.id} className="num" title={s.tip} style={{ fontSize: 10, color: '#c6ff3a', whiteSpace: 'nowrap', opacity: 0.85, cursor: 'default', letterSpacing: '.02em' }}>
                    {s.label}
                  </th>
                ))}
                <th></th>
              </tr>
            </thead>
            <tbody>
              {(boardPos === 'K' || boardPos === 'DST' ? boardDisplay : boardDisplay.slice(0, 150)).map((p, idx) => {
                const isDrafted   = draftedIds.has(p.id);
                const inQueue     = queue.includes(p.id);
                const isJustFreed = justFreedIds.has(p.id);
                const isAiPick    = aiSuggestions.some(s => s.id === p.id);
                const aiPickRank  = isAiPick ? aiSuggestions.findIndex(s => s.id === p.id) : -1;
                const rank        = getRank(p);
                const displayRank = rankSource === 'owner'
                  ? (ownerRanks[p.id] != null ? ownerRanks[p.id] : '—')
                  : rank < 9999 ? rank : '—';
                const pk   = isDrafted ? pickByPlayerId[p.id] : null;
                const pkTeam = pk ? LEAGUE_TEAMS.find(t => t.id === pk.teamId) : null;
                const pickLabel = pk ? `${pk.round}.${String(pk.slot).padStart(2, '0')}` : null;

                if (isDrafted) {
                  return (
                    <tr key={p.id} style={{ opacity: 0.35, background: 'rgba(255,255,255,.012)' }}>
                      <td className="rank" style={{ color: 'var(--text-faint)' }}>{displayRank}</td>
                      <td>
                        <div className="player-cell">
                          <PlayerAvatar player={p} />
                          <div style={{ minWidth: 0, flex: 1 }}>
                            <div style={{ fontSize: 14, color: 'var(--text-dim)', fontWeight: 600, textDecoration: 'line-through', textDecorationColor: 'rgba(255,255,255,.3)' }}>{p.name}</div>
                            <div className="player-meta"><PosBadge pos={p.pos} /> {p.team}</div>
                          </div>
                        </div>
                      </td>
                      <td className="tier" style={{ color: 'var(--text-faint)' }}>T{p.tier}</td>
                      <td className="num faint" style={{ fontSize: 11 }}>{p.adp != null ? getAdp(p).toFixed(1) : '—'}</td>
                      {activeNgCols.map(s => (
                        <td key={s.id} className="num" style={{ fontSize: 10, color: 'var(--text-faint)', opacity: 0.5 }}>
                          {fmtNg(getNgVal(p, s.id, breakoutByName), s.id)}
                        </td>
                      ))}
                      <td>
                        {pickLabel && (
                          <span style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--text-faint)', whiteSpace: 'nowrap' }}>
                            {pickLabel}{pkTeam ? ` ${pkTeam.logo}` : ''}
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                }

                return (
                  <tr key={p.id} style={
                    isJustFreed ? { background: 'rgba(76,175,130,.1)', outline: '1px solid rgba(76,175,130,.3)' }
                    : isAiPick  ? { background: 'rgba(78,168,255,.08)', outline: `1px solid rgba(78,168,255,${aiPickRank === 0 ? '.45' : '.22'})` }
                    : {}
                  }>
                    <td className="rank" style={{ color: rank < 9999 ? undefined : 'var(--text-faint)' }}>{displayRank}</td>
                    <td>
                      <div className="player-cell" style={{ cursor: 'pointer' }} onClick={() => setDetailPlayer(prev => prev?.id === p.id ? null : p)}>
                        <PlayerAvatar player={p} />
                        <div style={{ minWidth: 0, flex: 1 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                            <div className="player-name" style={{ fontSize: 14 }}>{p.name}</div>
                            {isAiPick && (
                              <span style={{ fontSize: 8, fontWeight: 900, letterSpacing: '.05em', background: 'var(--accent-2)', color: 'var(--accent-2-ink)', borderRadius: 3, padding: '1px 4px', lineHeight: 1.4, flexShrink: 0 }}>
                                AI#{aiPickRank + 1}
                              </span>
                            )}
                          </div>
                          <div className="player-meta"><PosBadge pos={p.pos} /> {p.team}</div>
                        </div>
                      </div>
                    </td>
                    <td className="tier">T{p.tier}</td>
                    <td className="num faint" style={{ fontSize: 11 }}>
                      {rankSource === 'owner' ? (
                        <input
                          type="number"
                          min={1} max={500}
                          value={ownerRanks[p.id] ?? ''}
                          placeholder={idx + 1}
                          onChange={e => setOwnerRank(p.id, e.target.value)}
                          style={{ width: 44, fontSize: 10, padding: '2px 4px', background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 3, color: ownerRanks[p.id] ? 'var(--accent)' : 'var(--text-faint)', textAlign: 'center' }}
                        />
                      ) : (
                        p.adp != null ? p.adp.toFixed(1) : '—'
                      )}
                    </td>
                    {activeNgCols.map(s => {
                      const val = getNgVal(p, s.id, breakoutByName);
                      const isHot = val != null && (
                        (s.id === 'opp_score'  && val >= 7) ||
                        (s.id === 'snap_pct'   && val >= 70) ||
                        (s.id === 'snap_delta' && val >= 8) ||
                        (s.id === 'tgt_share'  && val >= 20)
                      );
                      return (
                        <td key={s.id} className="num" style={{ fontSize: 10, fontFamily: 'var(--font-mono)', fontWeight: isHot ? 700 : 400, color: isHot ? '#c6ff3a' : val != null ? 'var(--text-dim)' : 'var(--text-faint)', whiteSpace: 'nowrap' }}>
                          {fmtNg(val, s.id)}
                        </td>
                      );
                    })}
                    <td>
                      <div className="flex" style={{ gap: 4 }}>
                        <button className="btn sm icon" title="Add to queue"
                          onClick={() => setQueue(inQueue ? queue.filter(x => x !== p.id) : [...queue, p.id])}
                          style={inQueue ? { background: 'var(--accent)', color: 'var(--accent-ink)', borderColor: 'var(--accent)' } : {}}>
                          {inQueue ? '✓' : '+'}
                        </button>
                        {(isMyTurn || (isCommissioner && !mockActive)) && (
                          <button
                            className={`btn sm ${aiSuggestions.some(s => s.id === p.id) ? 'ai' : 'primary'}`}
                            style={{ padding: '4px 8px' }}
                            onClick={() => mockActive ? draftPlayer(p.id) : commishPick(p.id)}
                            title={aiSuggestions.find(s => s.id === p.id)?.why}
                          >
                            {isCommissioner && !isMyTurn ? `→ ${onClockTeam?.logo}` : (aiSuggestions.some(s => s.id === p.id) ? '★ DRAFT' : 'DRAFT')}
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* MIDDLE COLUMN: Queue (1/3) + Pick Log (2/3) */}
      <div className="draft-middle" style={isMobile && mobileDraftTab !== 'picks' ? { display: 'none' } : {}}>
      {/* MY QUEUE */}
      <div className="draft-queue" style={hidden.queue ? { flex: '0 0 auto', maxHeight: 42, overflow: 'hidden' } : {}}>
        <div style={{ padding: '10px 14px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', flexShrink: 0 }}>
          <div className="card-title" style={{ flex: 1 }}>My Queue · {queue.length}</div>
          <button className="btn sm icon ghost" onClick={() => togglePanel('queue')} title={hidden.queue ? 'Expand' : 'Minimize'} style={{ marginRight: 4, fontSize: 10 }}>
            {hidden.queue ? '▼' : '▲'}
          </button>
          <button className="btn sm ghost" onClick={() => setQueue([])}>Clear</button>
        </div>
        <div style={{ flex: 1, overflow: 'auto', display: hidden.queue ? 'none' : undefined }}>
          {queue.map((id, i) => {
            const p = findPlayer(id);
            if (!p) return null;
            const alreadyDrafted = draftedIds.has(p.id);
            const canPick = (isMyTurn || (isCommissioner && !mockActive)) && !alreadyDrafted;
            return (
              <div className="queue-item" key={id} style={alreadyDrafted ? { opacity: 0.4 } : {}}>
                <span className="grip">≡</span>
                <span className="num">{i + 1}</span>
                <PlayerAvatar player={p} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="player-name" style={{ fontSize: 14 }}>{p.name}</div>
                  <div className="player-meta"><PosBadge pos={p.pos} /> {p.team} · ECR #{p.ecr}</div>
                </div>
                {canPick && (
                  <button
                    className="btn sm primary"
                    style={{ padding: '3px 8px', fontSize: 10, flexShrink: 0 }}
                    title="Draft this player now"
                    onClick={() => {
                      if (mockActive) draftPlayer(p.id); else commishPick(p.id);
                      setQueue(q => q.filter(x => x !== id));
                    }}
                  >
                    DRAFT
                  </button>
                )}
                {alreadyDrafted && (
                  <span style={{ fontSize: 9, fontFamily: 'var(--font-mono)', color: 'var(--text-faint)', flexShrink: 0 }}>gone</span>
                )}
                <button className="btn sm icon ghost" onClick={() => setQueue(queue.filter(x => x !== id))}>✕</button>
              </div>
            );
          })}
          {queue.length === 0 && (
            <div className="empty">Queue empty<br /><span className="faint" style={{ fontSize: 11 }}>Add players from the Big Board.</span></div>
          )}
        </div>
      </div>

      {/* PICK LOG */}
      <div className="draft-picklog" style={hidden.picklog ? { overflow: 'hidden' } : {}}>
        <div style={{ padding: '10px 14px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', flexShrink: 0 }}>
          <div className="card-title" style={{ flex: 1 }}>Pick Log</div>
          {isCommissioner && selectedPicks.size > 0 && (
            <button
              style={{ fontSize: 10, padding: '2px 8px', background: '#ff9800', color: '#000', border: '1px solid #ff9800', borderRadius: 4, cursor: 'pointer', fontWeight: 700, marginRight: 8 }}
              onClick={() => reverseSelectedPicks()}
            >
              ↩ Reverse {selectedPicks.size}
            </button>
          )}
          <button className="btn sm icon ghost" onClick={() => togglePanel('picklog')} title={hidden.picklog ? 'Expand' : 'Minimize'} style={{ marginRight: 8, fontSize: 10 }}>
            {hidden.picklog ? '▼' : '▲'}
          </button>
          <span className="mono faint" style={{ fontSize: 10 }}>{currentPickNum - 1}/{TOTAL_PICKS}</span>
        </div>
        <div style={{ flex: 1, overflow: 'auto', display: hidden.picklog ? 'none' : undefined }}>
          {/* Merge picks, commish events, and reversals into one chronological stream (most recent first) */}
          {(() => {
            const rows = [];
            // Deduplicate by pickNum — if somehow a slot has multiple entries, keep the last one
            const pickMap = new Map();
            allPicks.filter(pk => pk.playerId).forEach(pk => pickMap.set(pk.pickNum, pk));
            pickMap.forEach(pk => rows.push({ kind: 'pick', pickNum: pk.pickNum, pk }));
            commishLog.forEach(entry => rows.push({ kind: 'event', pickNum: entry.pickNum ?? 0, entry }));
            reversalLog.forEach((entry, i) => rows.push({ kind: 'reversal', pickNum: entry.pickNum ?? 0, i, entry }));
            rows.sort((a, b) => b.pickNum - a.pickNum || (b.entry?.id ?? 0) - (a.entry?.id ?? 0));
            return rows.map(row => {
            if (row.kind === 'event') {
              const entry = row.entry;
              const entryColor = entry.type === 'reset' ? '#ff5a6e' : entry.type === 'pause' ? '#ff9800' : entry.type === 'resume' ? '#4caf82' : '#5b9cf6';
              const entryBg    = entry.type === 'reset' ? 'rgba(255,90,110,.08)' : entry.type === 'pause' ? 'rgba(255,152,0,.07)' : entry.type === 'resume' ? 'rgba(76,175,130,.07)' : 'rgba(91,156,246,.06)';
              return (
                <div key={`cl-${entry.id}`} style={{ padding: '6px 14px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 8, background: entryBg, borderLeft: `3px solid ${entryColor}` }}>
                  <span style={{ fontSize: 14, flexShrink: 0 }}>{entry.type === 'reset' ? '⚠' : entry.type === 'pause' ? '⏸' : entry.type === 'resume' ? '▶' : '⚙'}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ color: entryColor, fontWeight: 700, fontSize: 11 }}>{entry.message}</div>
                    <div style={{ color: 'var(--text-faint)', fontSize: 10 }}>Pick #{entry.pickNum} · {entry.ts}</div>
                  </div>
                </div>
              );
            }
            if (row.kind === 'reversal') {
              const entry = row.entry;
              const rp = findPlayer(entry.playerId);
              const rt = LEAGUE_TEAMS.find(x => x.id === entry.teamId);
              if (!rp || !rt) return null;
              return (
                <div key={`rev-${row.i}`} style={{ padding: '6px 14px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 8, background: 'rgba(255,152,0,.07)', borderLeft: '3px solid #ff9800' }}>
                  <span style={{ fontSize: 16, flexShrink: 0 }}>↩</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ color: '#ff9800', fontWeight: 700, fontSize: 11 }}>
                      Commissioner reversed {entry.round}.{entry.slot?.toString().padStart(2, '0')}
                    </div>
                    <div style={{ color: 'var(--text-faint)', fontSize: 10 }}>
                      {rp.name} removed from {rt.logo} {rt.name} · {entry.reversedAt}
                    </div>
                  </div>
                </div>
              );
            }
            // Normal pick
            const pk = row.pk;
            const p = findP(pk.playerId);
            const t = LEAGUE_TEAMS.find(x => x.id === pk.teamId);
            if (!p || !t) return null;
            const adpDelta = pk.pickNum - (p.adp ?? p.ecr);
            const ghost = ghostPredictions[pk.pickNum];
            const ghostMatch = ghost?.player?.id === pk.playerId;
            const deltaColor = adpDelta >= 3 ? '#4caf82' : adpDelta <= -3 ? '#ff5a6e' : 'var(--text-dim)';
            const isSelected = selectedPicks.has(pk.pickNum);
            // Bell-curve grading: average pick (ADP ≈ pickNum) → C; steals → A/B; reaches → D/F
            const safeAdpDelta = (p.adp ?? p.ecr ?? 999) < 500 ? adpDelta : 0;
            const grade = safeAdpDelta > 18 ? 'A+' : safeAdpDelta > 10 ? 'A' : safeAdpDelta > 3 ? 'B' : safeAdpDelta >= -3 ? 'C' : safeAdpDelta >= -10 ? 'D' : 'F';
            const gradeColor = safeAdpDelta > 10 ? '#4caf82' : safeAdpDelta > 3 ? '#4ea8ff' : safeAdpDelta >= -3 ? 'var(--text-dim)' : safeAdpDelta >= -10 ? 'var(--warn)' : 'var(--danger)';
            return (
              <div key={pk.pickNum} style={{ padding: '7px 14px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, background: isSelected ? 'rgba(255,152,0,.13)' : t.me ? 'rgba(198,255,58,.10)' : '', borderLeft: t.me && !isSelected ? '3px solid var(--accent)' : isSelected ? '3px solid #ff9800' : '3px solid transparent' }}>
                {isCommissioner && (
                  <input
                    type="checkbox"
                    checked={isSelected}
                    onChange={() => setSelectedPicks(prev => { const n = new Set(prev); n.has(pk.pickNum) ? n.delete(pk.pickNum) : n.add(pk.pickNum); return n; })}
                    style={{ cursor: 'pointer', accentColor: '#ff9800', width: 13, height: 13, flexShrink: 0 }}
                  />
                )}
                <div className="mono faint" style={{ width: 42, fontSize: 11, flexShrink: 0, lineHeight: 1.3 }}>
                  {pk.round}.{pk.slot.toString().padStart(2, '0')}
                  <div style={{ fontSize: 9, color: 'var(--text-faint)' }}>#{pk.pickNum}</div>
                </div>
                <PosBadge pos={p.pos} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 5, flexWrap: 'nowrap', overflow: 'hidden' }}>
                    <span className="player-name" style={{ fontSize: 13, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.name}</span>
                    <span className="faint mono" style={{ fontSize: 10, flexShrink: 0 }}>{p.team}</span>
                    <span style={{ fontSize: 10, fontWeight: 700, color: deltaColor, flexShrink: 0, marginLeft: 'auto' }}>
                      {adpDelta >= 0 ? '+' : ''}{adpDelta.toFixed(1)}
                    </span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span className="player-meta" style={{ color: t.me ? 'var(--accent)' : 'var(--text-dim)', fontSize: 10 }}>→ {t.logo} {t.name}</span>
                    {ghost && (
                      ghostMatch
                        ? <span style={{ fontSize: 9, color: '#4caf82', fontWeight: 700, marginLeft: 'auto', flexShrink: 0 }}>✓ Ghost</span>
                        : <span style={{ fontSize: 9, color: 'var(--text-dim)', marginLeft: 'auto', flexShrink: 0 }}>Ghost: {ghost.player.name.split(' ').slice(-1)[0]}</span>
                    )}
                  </div>
                </div>
                <div style={{ textAlign: 'center', flexShrink: 0 }}>
                  <div style={{ fontFamily: 'var(--font-display)', fontStretch: '75%', fontWeight: 900, fontSize: 16, color: gradeColor, lineHeight: 1 }}>{grade}</div>
                  <div style={{ fontSize: 9, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '.05em' }}>AI</div>
                </div>
                {(() => {
                  const myRank = getRank(p);
                  const rankLabel = rankSource === 'owner' ? 'My Rnk' : rankSource === 'cbs' ? 'CBS' : rankSource === 'fp' ? 'FP' : 'ECR';
                  return (
                    <div style={{ textAlign: 'right', flexShrink: 0, minWidth: 36 }}>
                      <div className="mono" style={{ fontSize: 11, fontWeight: 700, color: myRank < 9999 ? 'var(--text)' : 'var(--text-faint)' }}>
                        {myRank < 9999 ? `#${myRank}` : '—'}
                      </div>
                      <div style={{ fontSize: 9, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '.05em' }}>{rankLabel}</div>
                    </div>
                  );
                })()}
              </div>
            );
          }); // closes rows.map
          })()}
        </div>
      </div>
      </div>{/* /draft-middle */}

      {/* RIGHT: Roster / All Teams / Chat panel */}
      <div className="draft-roster" style={isMobile && mobileDraftTab !== 'chat' ? { display: 'none' } : { display: 'flex', flexDirection: 'column' }}>
        {/* Tab strip */}
        <div style={{ display: 'flex', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
          {[
            { id: 'roster', label: '🏈 My Roster' },
            { id: 'grid',   label: '▦ All Teams' },
            { id: 'chat',   label: '💬 Chat' },
          ].map(tab => (
            <button key={tab.id}
              onClick={() => setRosterPanelView(tab.id)}
              style={{
                flex: 1, padding: '8px 4px', fontSize: 11, fontWeight: rosterPanelView === tab.id ? 800 : 500,
                background: rosterPanelView === tab.id ? 'rgba(198,255,58,.08)' : 'transparent',
                color: rosterPanelView === tab.id ? 'var(--accent)' : 'var(--text-dim)',
                border: 'none', borderBottom: rosterPanelView === tab.id ? '2px solid var(--accent)' : '2px solid transparent',
                cursor: 'pointer', transition: 'all 0.15s',
              }}
            >{tab.label}</button>
          ))}
        </div>

        {/* MY ROSTER view */}
        {rosterPanelView === 'roster' && (() => {
          const POS_ORDER = ['QB', 'RB', 'WR', 'TE', 'K', 'DST'].filter(pos => posLimits[pos] !== 0);
          const grouped = POS_ORDER.map(pos => ({
            pos,
            picks: myPicks.map(pk => findP(pk.playerId)).filter(p => p?.pos === pos),
          }));
          return (
            <div style={{ flex: 1, overflow: 'auto', padding: '8px 0' }}>
              {grouped.map(({ pos, picks }) => (
                <div key={pos}>
                  <div style={{ padding: '4px 12px 2px', fontSize: 9, fontWeight: 800, color: `var(--pos-${pos.toLowerCase() === 'dst' ? 'dst' : pos.toLowerCase()})`, letterSpacing: '.14em', textTransform: 'uppercase', background: 'var(--bg-2)' }}>
                    {pos}
                  </div>
                  {picks.length === 0 ? (
                    <div style={{ padding: '5px 12px', fontSize: 11, color: 'var(--text-faint)', fontStyle: 'italic' }}>— open —</div>
                  ) : picks.map((p, i) => (
                    <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 12px', borderBottom: '1px solid var(--border)', background: i % 2 === 0 ? 'transparent' : 'rgba(255,255,255,.02)' }}>
                      <PlayerAvatar player={p} size={24} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</div>
                        <div style={{ fontSize: 10, color: 'var(--text-dim)' }}>{p.team} · avg {p.avg?.toFixed(1) ?? '—'}</div>
                      </div>
                    </div>
                  ))}
                </div>
              ))}
              {myPicks.length === 0 && (
                <div style={{ padding: 24, textAlign: 'center', color: 'var(--text-faint)', fontSize: 13 }}>No picks yet</div>
              )}
            </div>
          );
        })()}

        {/* ALL TEAMS grid view */}
        {rosterPanelView === 'grid' && (
          <div style={{ flex: 1, overflow: 'auto' }}>
            {teamsForCols.map((t) => {
              if (!t) return null;
              const teamPicks = allPicks.filter(pk => pk.teamId === t.id && pk.playerId);
              const teamGradeSum = teamPicks.reduce((s, pk) => {
                const p = findP(pk.playerId);
                const rawAdp = p?.adp ?? p?.ecr ?? 999;
                return s + (rawAdp < 500 ? pk.pickNum - rawAdp : 0);
              }, 0);
              const teamGradeAvg = teamPicks.length ? teamGradeSum / teamPicks.length : 0;
              const teamGradeLabel = teamBellGrades[t.id] || '—';
              const teamGradeColor = BELL_COLORS[teamGradeLabel] || 'var(--text-dim)';
              const mode = getTeamMode(t.id);
              const nextMode = mode === 'manual' ? 'auto' : mode === 'auto' ? 'ai' : 'manual';
              const canAssign = isCommissioner && !mockActive; // commissioner assigns autodraft for any team, live drafts only
              return (
                <div key={t.id} style={{ borderBottom: '1px solid var(--border)', background: t.id === onClockTeamId ? 'rgba(76,175,130,.06)' : t.me ? 'rgba(198,255,58,.04)' : 'transparent' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 10px', background: t.id === onClockTeamId ? 'rgba(76,175,130,.12)' : 'var(--bg-2)' }}>
                    <span style={{ fontSize: 14 }}>{t.logo}</span>
                    <span style={{ fontSize: 11, fontWeight: t.me ? 800 : 600, color: t.id === onClockTeamId ? '#4caf82' : 'var(--text)', flex: 1 }}>{t.name}</span>
                    {mode !== 'manual' && (
                      <span title={mode === 'ai' ? 'AI-Draft (Ghost) is active for this team' : 'Autodraft is active for this team'} style={{
                        fontSize: 9, fontWeight: 800, padding: '1px 6px', borderRadius: 8, flexShrink: 0, letterSpacing: '.04em',
                        background: mode === 'ai' ? 'rgba(78,168,255,.15)' : 'rgba(198,255,58,.15)',
                        color: mode === 'ai' ? 'var(--accent-2)' : 'var(--accent)',
                      }}>
                        {mode === 'ai' ? '🤖 AI' : '⚡ AUTO'}
                      </span>
                    )}
                    {canAssign && (
                      <button
                        className="btn ghost sm"
                        style={{ fontSize: 9, padding: '1px 6px', flexShrink: 0 }}
                        title={`Commissioner: set ${t.name} to ${nextMode === 'manual' ? 'Manual' : nextMode === 'auto' ? 'Autodraft' : 'AI-Draft (Ghost)'}`}
                        onClick={() => setTeamMode(t.id, nextMode)}
                      >
                        {mode === 'manual' ? 'Set Auto' : '↻'}
                      </button>
                    )}
                    {teamPicks.length > 0 && (
                      <span style={{ fontFamily: 'var(--font-display)', fontStretch: '75%', fontWeight: 900, fontSize: 15, color: teamGradeColor }}>{teamGradeLabel}</span>
                    )}
                    {t.id === onClockTeamId && <span style={{ fontSize: 9, fontWeight: 900, color: '#4caf82', letterSpacing: '.1em' }}>ON CLOCK</span>}
                    <span style={{ fontSize: 10, color: 'var(--text-faint)', fontFamily: 'var(--font-mono)' }}>{teamPicks.length}</span>
                  </div>
                  {teamPicks.length > 0 && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 2, padding: '3px 10px 6px' }}>
                      {teamPicks.map(pk => {
                        const p = findP(pk.playerId);
                        if (!p) return null;
                        const pickDelta = (p.adp ?? p.ecr ?? 999) < 500 ? pk.pickNum - (p.adp ?? p.ecr) : 0;
                        const grade = pickDelta > 18 ? 'A+' : pickDelta > 10 ? 'A' : pickDelta > 3 ? 'B' : pickDelta >= -3 ? 'C' : pickDelta >= -10 ? 'D' : 'F';
                        const gradeColor = pickDelta > 10 ? '#4caf82' : pickDelta > 3 ? '#4ea8ff' : pickDelta >= -3 ? 'var(--text-dim)' : pickDelta >= -10 ? 'var(--warn)' : 'var(--danger)';
                        const round = Math.ceil(pk.pickNum / 12);
                        return (
                          <div key={pk.pickNum} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            <span style={{ fontSize: 9, fontFamily: 'var(--font-mono)', color: 'var(--text-faint)', width: 32, flexShrink: 0 }}>R{round}.{pk.slot ?? ((pk.pickNum - 1) % 12) + 1}</span>
                            <span style={{ fontSize: 9, fontFamily: 'var(--font-mono)', color: 'var(--text-faint)', width: 22, flexShrink: 0 }}>#{pk.pickNum}</span>
                            <PosBadge pos={p.pos} />
                            <span style={{ fontSize: 11, fontWeight: 600, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</span>
                            <span style={{ fontSize: 10, fontWeight: 800, color: gradeColor, flexShrink: 0 }}>{grade}</span>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* CHAT view */}
        {rosterPanelView === 'chat' && (
          <div style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden' }}>
            <div style={{ flex: 1, overflow: 'auto', padding: '8px 0' }}>
              {chatMessages.map((m, i) => (
                <div key={i} className="chat-msg" style={m.ai ? { borderLeft: '2px solid var(--accent)', background: 'rgba(198,255,58,.04)' } : {}}>
                  <span className="ts">{m.ts}</span>
                  <span className="who" style={{ color: m.color }}>{m.who}</span>
                  <span>{m.msg}</span>
                </div>
              ))}
            </div>
            {/* Emoji quick-picks */}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, padding: '6px 8px', borderTop: '1px solid var(--border)', background: 'var(--bg-2)' }}>
              {['🏈','⚡','🔥','💪','⭐','🏆','🎯','👑','💯','🎉','😤','🙌','👏','🤯','💀','😱','🥶','😂'].map(emoji => (
                <button key={emoji}
                  onClick={() => setChatInput(prev => prev + emoji)}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 16, padding: '2px', borderRadius: 4, lineHeight: 1 }}
                  title={emoji}
                >{emoji}</button>
              ))}
            </div>
            <div style={{ padding: 8, borderTop: '1px solid var(--border)' }}>
              <input
                className="input"
                placeholder="Type to chat..."
                style={{ width: '100%', fontSize: 12 }}
                value={chatInput}
                onChange={e => setChatInput(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter' && chatInput.trim()) {
                    const ts = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                    const myName = user?.name || user?.email?.split('@')[0] || 'You';
                    setChatMessages(prev => [...prev, { who: myName, color: '#c6ff3a', ts, msg: chatInput.trim() }]);
                    setChatInput('');
                  }
                }}
              />
            </div>
          </div>
        )}
      </div>

      {showRecap && <DraftRecap round={currentRound - 1} onClose={() => setShowRecap(false)} />}

    </div>
  );
}

function DraftRecap({ round, onClose }) {
  const picks = DRAFT_PICKS.filter(p => p.round === round && p.playerId);
  const grades = LEAGUE_TEAMS.map(t => {
    const myPick = picks.find(p => p.teamId === t.id);
    const player = myPick ? findPlayer(myPick.playerId) : null;
    const value = player ? Math.round(((player.adp - myPick.pickNum) + 20) / 6) : 0;
    return {
      team: t, player, pickNum: myPick?.pickNum,
      grade: value > 4 ? 'A+' : value > 3 ? 'A' : value > 2 ? 'B+' : value > 1 ? 'B' : value > 0 ? 'C' : 'D',
      gradeColor: value > 3 ? 'var(--accent)' : value > 1 ? 'var(--warn)' : 'var(--danger)',
      delta: player ? player.adp - myPick.pickNum : 0,
    };
  });
  return (
    <div className="drawer-overlay" onClick={onClose}>
      <div style={{ position: 'fixed', inset: '60px', background: 'var(--bg-2)', border: '1px solid var(--border)', borderRadius: 12, padding: 24, overflow: 'auto', zIndex: 60 }} onClick={e => e.stopPropagation()}>
        <div className="flex" style={{ alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
          <div>
            <h1 style={{ fontFamily: 'var(--font-display)', fontStretch: '75%', fontWeight: 900, fontSize: 28, margin: 0, textTransform: 'uppercase' }}>Round {round} Recap</h1>
            <div className="sub dim" style={{ fontSize: 12, marginTop: 4 }}>FantasAI graded each pick by value vs ADP</div>
          </div>
          <button className="btn ghost" onClick={onClose}>Close ✕</button>
        </div>
        <table className="data-table">
          <thead><tr><th>Pick</th><th>Team</th><th>Player</th><th className="num">ADP</th><th className="num">Δ</th><th className="num">Grade</th><th>Take</th></tr></thead>
          <tbody>
            {grades.filter(g => g.player).sort((a, b) => a.pickNum - b.pickNum).map(g => (
              <tr key={g.team.id}>
                <td className="mono">{Math.ceil(g.pickNum / 12)}.{((g.pickNum - 1) % 12) + 1}</td>
                <td className="player-cell" style={{ padding: '8px 14px' }}>
                  <div className="avatar" style={{ background: g.team.color, color: '#fff' }}>{g.team.logo}</div>
                  <div className="player-name">{g.team.name}</div>
                </td>
                <td><PlayerCell player={g.player} /></td>
                <td className="num">{g.player.adp.toFixed(1)}</td>
                <td className="num" style={{ color: g.delta > 0 ? 'var(--good)' : g.delta < -5 ? 'var(--danger)' : 'var(--text-dim)' }}>
                  {g.delta > 0 ? '+' : ''}{g.delta.toFixed(1)}
                </td>
                <td className="num"><span style={{ fontFamily: 'var(--font-display)', fontStretch: '75%', fontWeight: 900, fontSize: 18, color: g.gradeColor }}>{g.grade}</span></td>
                <td className="dim" style={{ fontSize: 11 }}>
                  {g.delta > 5 ? 'Massive value — fell past ADP' : g.delta > 0 ? 'Solid pick at right spot' : g.delta < -5 ? 'Reach — gone earlier than expected' : 'On target'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function GhostTarget({ g, rank, compact, isMe }) {
  const p = g.player;
  return (
    <div className={`ghost-target rank-${rank} ${compact ? 'compact' : ''} ${isMe ? 'me' : ''}`} title={`${p.name} · ${g.likelihood}% likely`}>
      <span className={`pos-badge pos-${p.pos}`}>{p.pos}</span>
      <span className="ghost-name">{compact ? p.name.split(' ').slice(-1)[0] : p.name}</span>
      <span className="ghost-pct mono">{g.likelihood}%</span>
    </div>
  );
}

// ── Draft Player Detail Panel ─────────────────────────────────────────────────
function statRow(label, val) {
  if (val == null || val === '—') return null;
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '4px 0', borderBottom: '1px solid var(--border)' }}>
      <span style={{ fontSize: 11, color: 'var(--text-dim)' }}>{label}</span>
      <span style={{ fontSize: 12, fontWeight: 700, fontFamily: 'var(--font-mono)', color: 'var(--text)' }}>{val}</span>
    </div>
  );
}

function SeasonStatBlock({ label, tot, pos }) {
  if (!tot) return <div style={{ fontSize: 11, color: 'var(--text-faint)', padding: '8px 0' }}>No data</div>;
  const fp = tot.pts_half_ppr != null ? tot.pts_half_ppr.toFixed(1) : '—';
  const gp = tot._gp || '?';
  const avg = tot.pts_half_ppr != null && tot._gp ? (tot.pts_half_ppr / tot._gp).toFixed(1) : '—';
  return (
    <div style={{ fontSize: 11, fontFamily: 'var(--font-mono)', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '2px 12px' }}>
      {pos === 'QB' && <>
        {statRow('Pass Yds', Math.round(tot.pass_yd || 0))}
        {statRow('Pass TDs', Math.round(tot.pass_td || 0))}
        {statRow('INTs', Math.round(tot.pass_int || 0))}
        {statRow('Rush Yds', Math.round(tot.rush_yd || 0))}
      </>}
      {pos === 'RB' && <>
        {statRow('Rush Att', Math.round(tot.rush_att || 0))}
        {statRow('Rush Yds', Math.round(tot.rush_yd || 0))}
        {statRow('Rush TDs', Math.round(tot.rush_td || 0))}
        {statRow('Rec', Math.round(tot.rec || 0))}
        {statRow('Rec Yds', Math.round(tot.rec_yd || 0))}
      </>}
      {(pos === 'WR' || pos === 'TE') && <>
        {statRow('Targets', Math.round(tot.rec_tgt || 0))}
        {statRow('Rec', Math.round(tot.rec || 0))}
        {statRow('Rec Yds', Math.round(tot.rec_yd || 0))}
        {statRow('Rec TDs', Math.round(tot.rec_td || 0))}
        {statRow('Catch%', tot.rec_tgt > 0 ? ((tot.rec / tot.rec_tgt) * 100).toFixed(0) + '%' : '—')}
      </>}
      {pos === 'K' && <>
        {statRow('FG Made', Math.round(tot.fgm || 0))}
        {statRow('FG Att', Math.round(tot.fga || 0))}
        {statRow('XP Made', Math.round(tot.xpm || 0))}
      </>}
      {statRow('Games', gp)}
      {statRow('Avg Pts', avg)}
      {statRow('Total Pts', fp)}
    </div>
  );
}

// ── Compact season stats for inline panel ────────────────────────────────────
function CompactSeasonStats({ tot, pos }) {
  if (!tot) return <div style={{ fontSize: 9, color: 'var(--text-faint)', fontFamily: 'var(--font-mono)' }}>no data</div>;
  const fmt = (v, dec = 0) => v != null && !isNaN(v) ? (dec ? Number(v).toFixed(dec) : Math.round(v)) : '—';
  const fp  = tot.pts_half_ppr != null ? Number(tot.pts_half_ppr).toFixed(1) : '—';
  const avg = tot.pts_half_ppr != null && tot._gp ? (tot.pts_half_ppr / tot._gp).toFixed(1) : '—';
  const rows = pos === 'QB'
    ? [['Pass Yds', fmt(tot.pass_yd)], ['TDs/INT', `${fmt(tot.pass_td)}/${fmt(tot.pass_int)}`], ['Rush Yds', fmt(tot.rush_yd)]]
    : pos === 'RB'
    ? [['Att/Yds', `${fmt(tot.rush_att)}/${fmt(tot.rush_yd)}`], ['Rush TDs', fmt(tot.rush_td)], ['Rec/Yds', `${fmt(tot.rec)}/${fmt(tot.rec_yd)}`]]
    : pos === 'WR' || pos === 'TE'
    ? [['Tgt/Rec', `${fmt(tot.rec_tgt)}/${fmt(tot.rec)}`], ['Rec Yds', fmt(tot.rec_yd)], ['TDs', fmt(tot.rec_td)]]
    : pos === 'K'
    ? [['FGM/FGA', `${fmt(tot.fgm)}/${fmt(tot.fga)}`], ['XPM', fmt(tot.xpm)]]
    : [];
  rows.push(['Pts/G', avg], ['Total', fp]);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
      {rows.map(([k, v]) => (
        <div key={k} style={{ display: 'flex', justifyContent: 'space-between', gap: 6, fontSize: 9, fontFamily: 'var(--font-mono)' }}>
          <span style={{ color: 'var(--text-faint)' }}>{k}</span>
          <span style={{ color: 'var(--text)', fontWeight: 600 }}>{v}</span>
        </div>
      ))}
    </div>
  );
}

// ── Inline player detail strip — shows inside Big Board on player click ───────
function InlinePlayerDetail({ player: p, onClose, canDraft, isMyTurn, isCommissioner, onClockTeam, onDraft, inQueue, onToggleQueue, breakoutByName, onOpenPlayer }) {
  const [seasons, setSeasons] = React.useState({});
  const [loading, setLoading] = React.useState(true);
  const [news, setNews]       = React.useState([]);
  const [collegeStats, setCollegeStats] = React.useState(null);

  const avatarUrl = p.photoUrl || (p.sleeperId ? `https://sleepercdn.com/content/nfl/players/thumb/${p.sleeperId}.jpg` : null);
  const pos = p.pos;
  const oppScore = breakoutByName?.get(p.name.toLowerCase())?.opportunity_score ?? null;

  React.useEffect(() => {
    let cancelled = false;
    setLoading(true); setSeasons({}); setNews([]);
    async function load() {
      const [s25, s24, s23] = await Promise.allSettled([
        fetchSleeperPlayerStats(p.name, pos, 2025),
        fetchSleeperPlayerStats(p.name, pos, 2024),
        fetchSleeperPlayerStats(p.name, pos, 2023),
      ]);
      if (cancelled) return;
      function toTot(r) {
        if (r.status !== 'fulfilled' || !r.value?.found) return null;
        const tot = r.value.seasonTotals || {}; tot._gp = r.value.gamesPlayed || 0; return tot;
      }
      setSeasons({ 2025: toTot(s25), 2024: toTot(s24), 2023: toTot(s23) });
      setLoading(false);
      // Fetch college stats for rookies
      try {
        const csRes = await fetch('https://api.fantasai.net/api/v1/r2/fantasai/analysis/college_stats.json', { signal: AbortSignal.timeout(8000) });
        if (csRes.ok && !cancelled) {
          const csData = await csRes.json();
          const csArr = Array.isArray(csData) ? csData : csData?.data || [];
          const pKey = p.name?.toLowerCase().trim();
          let mine = csArr.filter(r => r.player_name?.toLowerCase().trim() === pKey);
          if (!mine.length) {
            const lastName = pKey.split(' ').slice(1).join(' ');
            if (lastName) mine = csArr.filter(r => (r.player_name?.toLowerCase().trim() || '').endsWith(lastName));
          }
          if (mine.length) setCollegeStats(mine.sort((a, b) => (a.season || 0) - (b.season || 0)));
        }
      } catch {}
      const parts = p.name.trim().split(' ');
      const fl = parts[0].toLowerCase(); const ll = parts.slice(1).join(' ').toLowerCase();
      try {
        const res  = await fetch('https://api.fantasai.net/api/v1/nfl/news?limit=50');
        const json = res.ok ? await res.json() : null;
        if (!cancelled && json?.articles) {
          setNews(json.articles.filter(a => { const t = `${a.headline||''} ${a.description||''}`.toLowerCase(); return t.includes(fl) && t.includes(ll); }).slice(0, 2));
        }
      } catch {}
    }
    load();
    return () => { cancelled = true; };
  }, [p.id]);

  const pill = (k, v, hi) => (
    <div key={k} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', minWidth: 34 }}>
      <span style={{ fontSize: 8, fontFamily: 'var(--font-mono)', letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--text-faint)', lineHeight: 1 }}>{k}</span>
      <span style={{ fontSize: 13, fontWeight: 800, fontFamily: 'var(--font-mono)', color: hi ? 'var(--accent-2)' : 'var(--text)', lineHeight: 1.3 }}>{v}</span>
    </div>
  );

  return (
    <div style={{ borderBottom: '2px solid var(--border-strong)', background: 'linear-gradient(180deg,rgba(78,168,255,.08) 0%,rgba(78,168,255,.02) 100%)', borderLeft: '3px solid var(--accent-2)' }}>

      {/* Row 1 — identity + actions */}
      <div style={{ padding: '8px 10px', display: 'flex', alignItems: 'center', gap: 8 }}>
        {avatarUrl && (
          <img src={avatarUrl} alt={p.name} style={{ width: 42, height: 42, borderRadius: 6, objectFit: 'cover', background: 'var(--panel-2)', flexShrink: 0 }}
            onError={e => { e.target.style.display = 'none'; }} />
        )}
        <div style={{ display: 'flex', alignItems: 'center', gap: 5, flex: 1, minWidth: 0, flexWrap: 'nowrap' }}>
          <span className={`pos-badge pos-${pos}`}>{pos}</span>
          {p.status && p.status !== 'OK' && (
            <span style={{ fontSize: 9, fontWeight: 700, padding: '2px 5px', borderRadius: 3, flexShrink: 0,
              background: p.status === 'Q' ? 'rgba(255,140,0,.15)' : 'rgba(255,60,60,.15)',
              color: p.status === 'Q' ? '#ffb547' : '#ff5a6e',
              border: `1px solid ${p.status === 'Q' ? 'rgba(255,140,0,.4)' : 'rgba(255,60,60,.4)'}`,
              fontFamily: 'var(--font-mono)', letterSpacing: '.06em' }}>{p.status}</span>
          )}
          <span style={{ fontWeight: 900, fontSize: 15, letterSpacing: '-.01em', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.name}</span>
          <span style={{ fontSize: 10, color: 'var(--text-faint)', fontFamily: 'var(--font-mono)', whiteSpace: 'nowrap', flexShrink: 0 }}>
            {p.team}{p.num ? ` #${p.num}` : ''}{p.age ? ` · ${p.age}yr` : ''}
          </span>
        </div>
        <div style={{ display: 'flex', gap: 5, alignItems: 'center', flexShrink: 0 }}>
          {canDraft && (
            <button className="btn primary sm" style={{ fontWeight: 900, letterSpacing: '.04em' }} onClick={() => onDraft(p.id)}>
              {isCommissioner && !isMyTurn ? '→ DRAFT' : '★ DRAFT'}
            </button>
          )}
          <button
            className={`btn sm ${inQueue ? 'primary' : 'ghost'}`}
            style={inQueue ? { background: 'var(--accent)', color: 'var(--accent-ink)', borderColor: 'var(--accent)' } : {}}
            onClick={onToggleQueue}
          >{inQueue ? '✓ Queued' : '+ Queue'}</button>
          {onOpenPlayer && (
            <button className="btn ghost sm" onClick={() => { onOpenPlayer(p.id); }} style={{ fontSize: 10, fontFamily: 'var(--font-mono)', letterSpacing: '.04em', whiteSpace: 'nowrap' }}>
              ↗ Profile
            </button>
          )}
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--text-faint)', fontSize: 14, cursor: 'pointer', padding: '2px 6px', lineHeight: 1 }}>✕</button>
        </div>
      </div>

      {/* Row 2 — stat pills */}
      <div style={{ padding: '2px 12px 7px', display: 'flex', gap: 14, alignItems: 'flex-end', flexWrap: 'wrap' }}>
        {pill('ECR', p.ecr < 999 ? `#${p.ecr}` : '—')}
        {pill('ADP', p.adp < 999 ? p.adp.toFixed(1) : '—')}
        {pill('Tier', p.tier || '—')}
        {pill('%Own', p.owned > 0 ? `${p.owned.toFixed(0)}%` : '—')}
        {pill('Bye', p.bye > 0 ? p.bye : '—')}
        <div style={{ width: 1, height: 28, background: 'var(--border)', alignSelf: 'center' }} />
        {pill('Proj', p.proj > 0 ? p.proj.toFixed(1) : '—')}
        {pill('Last', p.last > 0 ? p.last.toFixed(1) : '—')}
        {pill('Avg', p.avg > 0 ? p.avg.toFixed(1) : '—')}
        {oppScore != null && <>{pill('Opp', oppScore.toFixed(1), true)}</>}
      </div>

      {/* Row 3 — 3-year stats table */}
      {loading
        ? <div style={{ padding: '5px 12px 7px', color: 'var(--text-faint)', fontSize: 10, display: 'flex', alignItems: 'center', gap: 6 }}><div className="ai-orb" style={{ width: 10, height: 10 }} /> Loading stats…</div>
        : (() => {
          // A player's NFL rookie season is whichever of 2023-2025 they first recorded real NFL
          // games in — not just "2026" for anyone under 24, which mislabeled already-completed
          // rookie seasons (e.g. Ashton Jeanty's 2025 rookie year) as "College".
          const firstNflSeason = [2023, 2024, 2025].find(yr => seasons[yr]?._gp > 0);
          const isRookie = p.rookie || (p.age && p.age <= 24 && !seasons[2023]?._gp && !seasons[2024]?._gp);
          const nflStart = firstNflSeason ?? (isRookie ? 2026 : 2023);
          const nflCols = pos === 'QB'
            ? [{ k: 'G', fn: s => s._gp }, { k: 'Cmp', fn: s => s.pass_cmp }, { k: 'Att', fn: s => s.pass_att }, { k: 'Yds', fn: s => s.pass_yd }, { k: 'TD', fn: s => s.pass_td }, { k: 'INT', fn: s => s.pass_int }, { k: 'Pts', fn: s => s.pts_half_ppr?.toFixed(1) }]
            : pos === 'RB'
            ? [{ k: 'G', fn: s => s._gp }, { k: 'Att', fn: s => s.rush_att }, { k: 'RuYd', fn: s => s.rush_yd }, { k: 'RuTD', fn: s => s.rush_td }, { k: 'Rec', fn: s => s.rec }, { k: 'ReYd', fn: s => s.rec_yd }, { k: 'Pts', fn: s => s.pts_half_ppr?.toFixed(1) }]
            : [{ k: 'G', fn: s => s._gp }, { k: 'Tgt', fn: s => s.rec_tgt }, { k: 'Rec', fn: s => s.rec }, { k: 'Yds', fn: s => s.rec_yd }, { k: 'TD', fn: s => s.rec_td }, { k: 'Pts', fn: s => s.pts_half_ppr?.toFixed(1) }];
          const collegeCols = pos === 'QB'
            ? [{ k: 'Cmp', fn: s => s.completions }, { k: 'Att', fn: s => s.att }, { k: 'Yds', fn: s => s.yds }, { k: 'TD', fn: s => s.td }, { k: 'INT', fn: s => s.int }]
            : pos === 'RB'
            ? [{ k: 'Car', fn: s => s.car }, { k: 'Yds', fn: s => s.yds }, { k: 'TD', fn: s => s.td }, { k: 'Rec', fn: s => s.rec }, { k: 'YPC', fn: s => s.ypc?.toFixed(1) }]
            : [{ k: 'Rec', fn: s => s.rec }, { k: 'Yds', fn: s => s.yds }, { k: 'TD', fn: s => s.td }, { k: 'YPR', fn: s => s.ypr?.toFixed(1) }];
          const hasCollege = collegeStats && collegeStats.length > 0;
          return (
            <div style={{ borderTop: '1px solid var(--border)', overflowX: 'auto' }}>
              {/* College stats table */}
              {hasCollege && (
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11, fontFamily: 'var(--font-mono)' }}>
                  <thead>
                    <tr style={{ background: 'rgba(167,139,250,.08)' }}>
                      <th style={{ padding: '4px 8px', textAlign: 'left', fontSize: 9, fontWeight: 700, color: '#a78bfa', letterSpacing: '.06em' }}>College</th>
                      <th style={{ padding: '4px 6px', textAlign: 'left', fontSize: 9, fontWeight: 700, color: 'var(--text-faint)' }}>Team</th>
                      {collegeCols.map(c => <th key={c.k} style={{ padding: '4px 6px', textAlign: 'right', fontSize: 9, fontWeight: 700, color: 'var(--text-faint)' }}>{c.k}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {collegeStats.map(cs => (
                      <tr key={cs.season} style={{ borderTop: '1px solid var(--border)' }}>
                        <td style={{ padding: '4px 8px', fontWeight: 700, fontSize: 10, color: '#a78bfa' }}>{cs.season}</td>
                        <td style={{ padding: '4px 6px', fontSize: 10, color: 'var(--text-dim)' }}>{cs.team}</td>
                        {collegeCols.map(c => (
                          <td key={c.k} style={{ padding: '4px 6px', textAlign: 'right', color: 'var(--text)' }}>
                            {c.fn(cs) != null ? Math.round(Number(c.fn(cs))) || c.fn(cs) : '—'}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              {/* NFL stats table — hidden for rookies with college data and no NFL seasons */}
              {(() => {
                const nflRows = [2023, 2024, 2025].filter(yr => yr >= nflStart || !hasCollege);
                if (nflRows.length === 0) return null;
                return (
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11, fontFamily: 'var(--font-mono)' }}>
                    <thead>
                      <tr style={{ background: 'rgba(78,168,255,.06)' }}>
                        <th style={{ padding: '4px 8px', textAlign: 'left', fontSize: 9, fontWeight: 700, color: 'var(--accent-2)', letterSpacing: '.06em' }}>NFL</th>
                        {nflCols.map(c => <th key={c.k} style={{ padding: '4px 6px', textAlign: 'right', fontSize: 9, fontWeight: 700, color: 'var(--text-faint)' }}>{c.k}</th>)}
                      </tr>
                    </thead>
                    <tbody>
                      {nflRows.map(yr => {
                        const s = seasons[yr];
                        const inNfl = yr >= nflStart;
                        const hasStats = s && s._gp > 0;
                        return (
                          <tr key={yr} style={{ borderTop: '1px solid var(--border)' }}>
                            <td style={{ padding: '4px 8px', fontWeight: 700, fontSize: 10, color: hasStats ? 'var(--accent-2)' : 'var(--text-faint)' }}>
                              {yr}
                              {!inNfl && <span style={{ fontSize: 8, color: '#a78bfa', marginLeft: 4 }}>College</span>}
                              {inNfl && !hasStats && <span style={{ fontSize: 8, color: '#ff9800', marginLeft: 4 }}>Rookie</span>}
                            </td>
                            {nflCols.map(c => (
                              <td key={c.k} style={{ padding: '4px 6px', textAlign: 'right', color: hasStats ? 'var(--text)' : 'var(--text-faint)', fontWeight: c.k === 'Pts' ? 700 : 400 }}>
                                {hasStats ? (c.fn(s) ?? '—') : '—'}
                              </td>
                            ))}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                );
              })()}
            </div>
          );
        })()
      }

      {/* FantasAI Notes — expandable */}
      <DraftNotesBlock player={p} news={news} loading={loading} />
    </div>
  );
}

function DraftNotesBlock({ player: p, news, loading }) {
  const [expanded, setExpanded] = React.useState(false);
  const { data: writeupsRaw } = useR2BreakoutCandidates(); // reuse hook — we'll get writeups separately
  const [writeup, setWriteup] = React.useState(null);

  React.useEffect(() => {
    fetch('https://api.fantasai.net/api/v1/r2/players/player_writeups.json', { signal: AbortSignal.timeout(8000) })
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (!data?.players) return;
        const key = p.name?.toLowerCase().trim();
        const entry = data.players[key] || data.players[p.name];
        if (entry?.writeup) setWriteup(entry.writeup);
      }).catch(() => {});
  }, [p.id]);

  const hasContent = writeup || news?.length > 0 || p.news;
  if (!hasContent && loading) return null;
  if (!hasContent) return null;

  return (
    <div style={{ borderTop: '1px solid var(--border)', background: 'rgba(0,0,0,.08)' }}>
      <div
        onClick={() => setExpanded(e => !e)}
        style={{ padding: '5px 12px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}
      >
        <span style={{ fontSize: 10, color: 'var(--text-faint)', fontWeight: 700 }}>{expanded ? '▾' : '▸'}</span>
        <span style={{ fontSize: 10, fontFamily: 'var(--font-mono)', fontWeight: 700, color: '#c6ff3a', letterSpacing: '.06em' }}>FantasAI Notes</span>
        {news?.length > 0 && <span style={{ fontSize: 9, color: 'var(--accent-2)', fontFamily: 'var(--font-mono)' }}>📰 {news.length}</span>}
      </div>
      {expanded && (
        <div style={{ padding: '0 12px 8px' }}>
          {writeup && (
            <div style={{ fontSize: 11, color: 'var(--text-dim)', lineHeight: 1.6, marginBottom: 8 }}>
              {writeup}
            </div>
          )}
          {news?.length > 0 && news.map((n, i) => (
            <div key={i} style={{ fontSize: 10, color: 'var(--text-dim)', lineHeight: 1.4, marginBottom: 4, borderLeft: '2px solid var(--accent-2)', paddingLeft: 8 }}>
              {n.headline && <strong style={{ color: 'var(--text)', marginRight: 4 }}>{n.headline}</strong>}
              {n.description?.slice(0, 150)}
            </div>
          ))}
          {!writeup && !news?.length && p.news && (
            <div style={{ fontSize: 10, color: 'var(--text-dim)', lineHeight: 1.4 }}>{p.news}</div>
          )}
        </div>
      )}
    </div>
  );
}

function DraftPlayerDetail({ player: p, onClose, canDraft, isMyTurn, isCommissioner, onClockTeam, onDraft, inQueue, onToggleQueue, breakoutByName }) {
  const [seasons, setSeasons] = React.useState({});   // { 2023: data, 2024: data, 2025: data }
  const [loading, setLoading] = React.useState(true);
  const [news, setNews] = React.useState([]);

  const avatarUrl = p.photoUrl ||
    (p.sleeperId ? `https://sleepercdn.com/content/nfl/players/thumb/${p.sleeperId}.jpg` : null);

  React.useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setSeasons({});
    setNews([]);

    async function load() {
      // Fetch 3 seasons in parallel
      const [s25, s24, s23] = await Promise.allSettled([
        fetchSleeperPlayerStats(p.name, p.pos, 2025),
        fetchSleeperPlayerStats(p.name, p.pos, 2024),
        fetchSleeperPlayerStats(p.name, p.pos, 2023),
      ]);
      if (cancelled) return;

      function toTot(result) {
        if (result.status !== 'fulfilled' || !result.value?.found) return null;
        const d = result.value;
        const tot = d.seasonTotals || {};
        tot._gp = d.gamesPlayed || 0;
        return tot;
      }

      setSeasons({ 2025: toTot(s25), 2024: toTot(s24), 2023: toTot(s23) });
      setLoading(false);

      // News: fetch ESPN articles mentioning this player
      const parts = p.name.trim().split(' ');
      const fl = parts[0].toLowerCase();
      const ll = parts.slice(1).join(' ').toLowerCase();
      try {
        const res = await fetch('https://api.fantasai.net/api/v1/nfl/news?limit=50');
        const json = res.ok ? await res.json() : null;
        if (!cancelled && json?.articles) {
          const matched = json.articles.filter(a => {
            const t = `${a.headline||''} ${a.description||''}`.toLowerCase();
            return t.includes(fl) && t.includes(ll);
          }).slice(0, 4);
          setNews(matched);
        }
      } catch {}
    }

    load();
    return () => { cancelled = true; };
  }, [p.id]);

  const oppScore = breakoutByName?.get(p.name.toLowerCase())?.opportunity_score ?? null;
  const pos = p.pos;

  const panelStyle = {
    position: 'fixed', top: 0, right: 0, bottom: 0,
    width: 420, maxWidth: '100vw',
    background: 'var(--panel)', borderLeft: '1px solid var(--border-strong)',
    zIndex: 600, overflowY: 'auto', display: 'flex', flexDirection: 'column',
    boxShadow: '-8px 0 32px rgba(0,0,0,.5)',
  };

  return (
    <>
      <div style={{ position: 'fixed', inset: 0, zIndex: 599, background: 'rgba(0,0,0,.45)' }} onClick={onClose} />
      <div style={panelStyle}>

        {/* Hero */}
        <div style={{ padding: '20px 20px 16px', borderBottom: '1px solid var(--border)', display: 'flex', gap: 14, alignItems: 'flex-start', background: 'linear-gradient(135deg, rgba(78,168,255,.08), rgba(78,168,255,.02))' }}>
          {avatarUrl && (
            <img src={avatarUrl} alt={p.name} style={{ width: 72, height: 72, borderRadius: 10, objectFit: 'cover', background: 'var(--panel-2)', flexShrink: 0 }}
              onError={e => { e.target.style.display = 'none'; }} />
          )}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4, flexWrap: 'wrap' }}>
              <span className={`pos-badge pos-${pos}`}>{pos}</span>
              {p.status && p.status !== 'OK' && (
                <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 6px', borderRadius: 4,
                  background: p.status === 'Q' ? 'rgba(255,140,0,.15)' : 'rgba(255,60,60,.15)',
                  color: p.status === 'Q' ? '#ffb547' : '#ff5a6e',
                  border: `1px solid ${p.status === 'Q' ? 'rgba(255,140,0,.4)' : 'rgba(255,60,60,.4)'}`,
                  fontFamily: 'var(--font-mono)', letterSpacing: '.06em' }}>
                  {p.status}
                </span>
              )}
              <span style={{ fontSize: 10, color: 'var(--text-faint)', fontFamily: 'var(--font-mono)' }}>{p.team}{p.num ? ` · #${p.num}` : ''}{p.age ? ` · Age ${p.age}` : ''}</span>
            </div>
            <div style={{ fontSize: 20, fontWeight: 900, letterSpacing: '-.01em', marginBottom: 6 }}>{p.name}</div>
            <div style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--text-faint)', display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <span>ECR #{p.ecr < 999 ? p.ecr : '—'}</span>
              <span>ADP {p.adp < 999 ? p.adp.toFixed(1) : '—'}</span>
              <span>T{p.tier || '—'}</span>
              <span>{p.owned > 0 ? p.owned.toFixed(0) + '% own' : ''}</span>
              {p.bye > 0 && <span>Bye {p.bye}</span>}
            </div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--text-faint)', fontSize: 18, cursor: 'pointer', padding: '2px 4px', flexShrink: 0, lineHeight: 1 }}>✕</button>
        </div>

        {/* Action buttons */}
        <div style={{ padding: '10px 16px', borderBottom: '1px solid var(--border)', display: 'flex', gap: 8 }}>
          {canDraft && (
            <button
              className="btn primary"
              style={{ flex: 1, fontWeight: 900, letterSpacing: '.04em' }}
              onClick={() => onDraft(p.id)}
            >
              {isCommissioner && !isMyTurn ? `→ ${onClockTeam?.logo} DRAFT` : '★ DRAFT'}
            </button>
          )}
          <button
            className={`btn ${inQueue ? 'primary' : 'ghost'} sm`}
            style={inQueue ? { background: 'var(--accent)', color: 'var(--accent-ink)', borderColor: 'var(--accent)' } : {}}
            onClick={onToggleQueue}
          >
            {inQueue ? '✓ In Queue' : '+ Queue'}
          </button>
        </div>

        {/* Key stats bar */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 1, background: 'var(--border)', borderBottom: '1px solid var(--border)' }}>
          {[
            ['Proj', p.proj > 0 ? p.proj.toFixed(1) : '—'],
            ['Last', p.last > 0 ? p.last.toFixed(1) : '—'],
            ['Avg', p.avg > 0 ? p.avg.toFixed(1) : '—'],
            ['ADP', p.adp < 999 ? p.adp.toFixed(1) : '—'],
            ['%Own', p.owned > 0 ? p.owned.toFixed(0) + '%' : '—'],
            oppScore != null ? ['Opp Sc', oppScore.toFixed(1)] : ['Bye Wk', p.bye > 0 ? p.bye : '—'],
          ].map(([k, v]) => (
            <div key={k} style={{ background: 'var(--panel)', padding: '8px 10px', textAlign: 'center' }}>
              <div style={{ fontSize: 9, fontFamily: 'var(--font-mono)', letterSpacing: '.1em', textTransform: 'uppercase', color: 'var(--text-faint)', marginBottom: 2 }}>{k}</div>
              <div style={{ fontSize: 16, fontWeight: 800, color: k === 'Opp Sc' ? 'var(--accent-2)' : 'var(--text)', fontFamily: 'var(--font-mono)' }}>{v}</div>
            </div>
          ))}
        </div>

        {/* 3-year stats */}
        <div style={{ padding: 16, flex: 1 }}>
          <div style={{ fontSize: 10, fontFamily: 'var(--font-mono)', fontWeight: 700, letterSpacing: '.12em', textTransform: 'uppercase', color: 'var(--text-faint)', marginBottom: 12 }}>Season History</div>

          {loading && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '12px 0', color: 'var(--text-faint)', fontSize: 12 }}>
              <div className="ai-orb" style={{ width: 14, height: 14 }} /> Loading stats…
            </div>
          )}

          {!loading && [2025, 2024, 2023].map(yr => (
            <div key={yr} style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 11, fontWeight: 700, fontFamily: 'var(--font-mono)', color: seasons[yr] ? 'var(--accent-2)' : 'var(--text-faint)', marginBottom: 6, letterSpacing: '.06em' }}>
                {yr} Season {seasons[yr] ? `· ${seasons[yr]._gp}G` : '· no data'}
              </div>
              <SeasonStatBlock label={yr} tot={seasons[yr]} pos={pos} />
            </div>
          ))}

          {/* News */}
          {news.length > 0 && (
            <div style={{ marginTop: 8 }}>
              <div style={{ fontSize: 10, fontFamily: 'var(--font-mono)', fontWeight: 700, letterSpacing: '.12em', textTransform: 'uppercase', color: 'var(--text-faint)', marginBottom: 10 }}>Recent News</div>
              {news.map((a, i) => (
                <div key={i} style={{ marginBottom: 10, padding: '10px 12px', background: 'var(--panel-2)', borderRadius: 6, borderLeft: '3px solid var(--border-strong)' }}>
                  {a.headline && <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 3 }}>{a.headline}</div>}
                  {a.description && <div style={{ fontSize: 11, color: 'var(--text-dim)', lineHeight: 1.5 }}>{a.description}</div>}
                  <div style={{ fontSize: 10, color: 'var(--text-faint)', marginTop: 4, fontFamily: 'var(--font-mono)' }}>ESPN</div>
                </div>
              ))}
            </div>
          )}
          {!loading && news.length === 0 && p.news && (
            <div style={{ marginTop: 8, padding: '10px 12px', background: 'var(--panel-2)', borderRadius: 6, borderLeft: '3px solid var(--border-strong)' }}>
              <div style={{ fontSize: 12, color: 'var(--text-dim)', lineHeight: 1.5 }}>{p.news}</div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
