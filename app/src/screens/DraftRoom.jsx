import React from 'react';
import { LEAGUE_TEAMS, DRAFT_PICKS, TEAMS_ORDER, QUEUE as INIT_QUEUE, CHAT_MESSAGES } from '../lib/data.js';
import { getPlayers, findPlayer } from '../lib/playerStore.js';
import { predictPicks } from '../lib/draft.js';
import { PosBadge, PlayerAvatar, PlayerCell, TeamLogoBadge } from '../components/ui.jsx';

export default function DraftRoom({ aiMode, user, onNav, onDraftPick }) {
  const REAL_currentPickNum = 40;
  const isCommissioner = user?.isAdmin || user?.isCommissioner;

  // Mock draft mode
  const [mockActive, setMockActive]       = React.useState(false);
  const [mockPicks, setMockPicks]         = React.useState(() => {
    // Restore in-progress mock picks so navigating away mid-draft doesn't lose them
    try { const s = JSON.parse(localStorage.getItem('fantasai_mock_picks_wip') || 'null'); return Array.isArray(s) ? s : []; } catch { return []; }
  });
  const [mockPickNum, setMockPickNum]     = React.useState(1);
  const [mockUserTeamId, setMockUserTeamId]   = React.useState(null);
  const [mockSetup, setMockSetup]             = React.useState(false);
  const [mockTeamsOrder, setMockTeamsOrder]   = React.useState([...TEAMS_ORDER]);
  const [mockSlotIndex, setMockSlotIndex]     = React.useState(null); // 0-based slot the user chose

  // ── Scheduled mock drafts ──────────────────────────────────────────────────
  const [mockSchedule, setMockSchedule] = React.useState(() => {
    try { return JSON.parse(localStorage.getItem('fantasai_mock_schedule') || '[]'); }
    catch { return []; }
  });
  const [showScheduleModal, setShowScheduleModal] = React.useState(false);
  const [scheduleDraft, setScheduleDraft] = React.useState({ date: '', rounds: 16, format: 'Snake' });
  const [joinDraftId, setJoinDraftId]     = React.useState(null);
  const [joinSlot, setJoinSlot]           = React.useState(null);

  function startMockDraft() {
    setMockPicks([]);
    setMockPickNum(1);
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
    try { localStorage.removeItem('fantasai_mock_picks_wip'); } catch {}
    setMockUserTeamId(null);
    setMockSetup(false);
    setMockSlotIndex(null);
    setMockTeamsOrder([...TEAMS_ORDER]);
    setPaused(false);
  }
  function draftPlayer(playerId) {
    if (!mockActive) return;
    const round = Math.ceil(mockPickNum / 12);
    const s     = (mockPickNum - 1) % 12;
    setMockPicks(prev => [...prev, { pickNum: mockPickNum, teamId: mockUserTeamId || 1, playerId, round, slot: s + 1 }]);
    setMockPickNum(n => n + 1);
    setQueue(q => q.filter(id => id !== playerId));
    // NOTE: mock draft intentionally does NOT call onDraftPick — it never affects the real roster
  }

  const [seconds, setSeconds] = React.useState(73);
  const [paused, setPaused]   = React.useState(false);
  const [queue, setQueue]     = React.useState(INIT_QUEUE);

  // Ref so the setTimeout callback inside AI auto-pick always reads current mockPicks,
  // even if React batches the state update after the effect captures its closure.
  const mockPicksRef = React.useRef(mockPicks);
  React.useEffect(() => { mockPicksRef.current = mockPicks; }, [mockPicks]);

  // AI auto-picks non-user slots during mock draft
  React.useEffect(() => {
    if (!mockActive || mockSetup || paused || mockPickNum > 192 || !mockUserTeamId) return;
    const round = Math.ceil(mockPickNum / 12);
    const s     = (mockPickNum - 1) % 12;
    // Use current mockTeamsOrder (now in deps — no stale closure)
    const onClockId = round % 2 === 1 ? mockTeamsOrder[s] : mockTeamsOrder[11 - s];
    if (onClockId === mockUserTeamId) return; // user's turn — wait
    const t = setTimeout(() => {
      // Read from ref so we never use a stale draftedSet even after a quick pick
      const draftedSet = new Set(mockPicksRef.current.map(p => p.playerId));
      const preds = predictPicks(onClockId, mockPickNum, draftedSet, 1);
      const pick  = preds[0];
      if (pick) {
        setMockPicks(prev => [...prev, { pickNum: mockPickNum, teamId: onClockId, playerId: pick.player.id, round, slot: s + 1 }]);
        setQueue(q => q.filter(id => id !== pick.player.id));
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

  const [boardPos, setBoardPos] = React.useState('ALL');
  const [boardSearch, setBoardSearch] = React.useState('');
  const [boardSortCol, setBoardSortCol] = React.useState('rank'); // 'rank' | 'tier' | 'adp'
  const [boardSortDir, setBoardSortDir] = React.useState('asc');
  const [hideDrafted, setHideDrafted] = React.useState(false); // false = show greyed, true = remove drafted
  const [showRecap, setShowRecap] = React.useState(false);
  const [hidden, setHidden] = React.useState({ ghosts: false, queue: false, picklog: false, teams: false });
  const [chatMessages, setChatMessages] = React.useState(CHAT_MESSAGES);
  const [chatInput, setChatInput] = React.useState('');
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
  const [commishPickSearch, setCommishPickSearch] = React.useState('');
  const [commishPickTeamId, setCommishPickTeamId] = React.useState(null); // null = use onClockTeamId
  const [apiPlayers, setApiPlayers]   = React.useState(null);
  const [apiLoading, setApiLoading]   = React.useState(false);
  const [apiError, setApiError]       = React.useState(null);

  // Persist live draft state so navigation away and back doesn't reset picks
  React.useEffect(() => {
    if (!mockActive) {
      try { localStorage.setItem('fantasai_live_picks', JSON.stringify(livePicks)); } catch {}
    }
  }, [livePicks, mockActive]);
  React.useEffect(() => {
    if (!mockActive) {
      try { localStorage.setItem('fantasai_live_pick_num', JSON.stringify(livePickNum)); } catch {}
    }
  }, [livePickNum, mockActive]);

  // Persist in-progress mock picks (WIP) so navigating away mid-draft doesn't lose them.
  // Save as completed when the pick counter passes 192 OR all 192 picks are recorded.
  React.useEffect(() => {
    if (!mockActive) return;
    try { localStorage.setItem('fantasai_mock_picks_wip', JSON.stringify(mockPicks)); } catch {}
    if (mockPicks.length >= 192 || mockPickNum > 192) {
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
    setScheduleDraft({ date: '', rounds: 16, format: 'Snake' });
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

  // Fetch live player pool from worker (Sleeper-backed, 1h cached)
  function fetchApiPlayers() {
    setApiLoading(true);
    setApiError(null);
    fetch('https://api.fantasai.net/api/v1/players?limit=300')
      .then(r => r.ok ? r.json() : Promise.reject(r.status))
      .then(data => { if (data?.players?.length) setApiPlayers(data.players); })
      .catch(err => setApiError(String(err)))
      .finally(() => setApiLoading(false));
  }
  React.useEffect(() => { fetchApiPlayers(); }, []);

  // ── Ranking sources ──────────────────────────────────────────────────────
  const RANK_SOURCES = [
    { id: 'sleeper', label: 'Sleeper ADP',     color: '#1c8eaf' },
    { id: 'cbs',     label: 'CBS Expert',       color: '#0d4ea2' },
    { id: 'fp',      label: 'FantasyPros ECR',  color: '#ee4c2e' },
    { id: 'owner',   label: 'My Rankings',      color: '#c6ff3a' },
  ];
  const [rankSource,    setRankSource]    = React.useState('sleeper');
  const [cbsRanks,      setCbsRanks]      = React.useState(null);   // [{ name, pos, team, rank }]
  const [cbsRankLoad,   setCbsRankLoad]   = React.useState(false);
  const [cbsRankErr,    setCbsRankErr]    = React.useState(null);
  const [fpRanks,       setFpRanks]       = React.useState(null);   // [{ player_name, player_positions, rank_ecr }]
  const [fpRankLoad,    setFpRankLoad]    = React.useState(false);
  const [fpRankErr,     setFpRankErr]     = React.useState(null);
  const [ownerRanks,    setOwnerRanks]    = React.useState(() => {
    try { return JSON.parse(localStorage.getItem('fantasai_owner_ranks') || '{}'); } catch { return {}; }
  });

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
      const fpUrl   = 'https://www.fantasypros.com/nfl/rankings/overall.json';
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
    try { localStorage.setItem('fantasai_owner_ranks', JSON.stringify(next)); } catch {}
  }

  // Returns sort rank for a player under the active ranking source
  function getRank(p) {
    if (rankSource === 'cbs' && cbsRanks) {
      const n = p.name?.toLowerCase();
      const r = cbsRanks.find(x => x.name?.toLowerCase() === n && x.pos === p.pos);
      return r ? r.rank : 9999;
    }
    if (rankSource === 'fp' && fpRanks) {
      const n = p.name?.toLowerCase();
      const r = fpRanks.find(x => x.player_name?.toLowerCase() === n);
      return r ? (r.rank_ecr ?? r.rank_avg ?? 9999) : 9999;
    }
    if (rankSource === 'owner') return ownerRanks[p.id] ?? 9999;
    return p.ecr ?? 9999; // sleeper (default)
  }

  function logCommish(type, message) {
    const ts = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    setCommishLog(prev => [...prev, { type, message, ts, id: Date.now() + Math.random() }]);
  }

  React.useEffect(() => {
    if (paused) return;
    const t = setInterval(() => setSeconds(s => Math.max(0, s - 1)), 1000);
    return () => clearInterval(t);
  }, [paused]);

  React.useEffect(() => {
    if (seconds === 0 && !paused) {
      const r = setTimeout(() => setSeconds(clockSeconds), 1200);
      return () => clearTimeout(r);
    }
  }, [seconds, paused, clockSeconds]);

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
    setPaused(true); // hold clock so auto-draft can't fire immediately after reversal
    if (mockActive) {
      setMockPicks(prev => prev.filter(p => !picksSet.has(p.pickNum)));
      setMockPickNum(minPick);
    } else {
      setLivePicks(prev => prev.map(p => picksSet.has(p.pickNum) ? { ...p, playerId: null } : p));
      setLivePickNum(minPick);
    }
    setSelectedPicks(new Set());
    flashFreed(freedPlayerIds);
  }

  function removeLastPicks(n) {
    const ts = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    setPaused(true); // hold clock so auto-draft can't fire immediately after undo
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
    setLivePicks(prev => prev.map(p => p.pickNum === pickNum ? { ...p, playerId, teamId } : p));
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
    // Clear mock picks
    setMockPicks([]);
    setMockPickNum(1);
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
    if (mockActive || paused || livePickNum > 192) return;
    const mode = teamModes[onClockTeamId];
    if (!mode || mode === 'manual') return;
    const draftedSet = new Set(livePicks.filter(p => p.playerId).map(p => p.playerId));
    const t = setTimeout(() => {
      let pickId = null;
      if (mode === 'ai') {
        const preds = predictPicks(onClockTeamId, livePickNum, draftedSet, 1);
        pickId = preds[0]?.player?.id ?? null;
      } else {
        const queueId = queue.find(id => !draftedSet.has(id));
        pickId = queueId ?? getPlayers().filter(p => !draftedSet.has(p.id)).sort((a, b) => a.ecr - b.ecr)[0]?.id ?? null;
      }
      if (pickId) {
        const pickNum = livePickNum;
        setLivePicks(prev => prev.map(p => p.pickNum === pickNum ? { ...p, playerId: pickId, teamId: onClockTeamId } : p));
        setLivePickNum(n => n + 1);
        setSeconds(clockSeconds);
        setQueue(q => q.filter(id => id !== pickId));
      }
    }, 1800);
    return () => clearTimeout(t);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mockActive, paused, livePickNum, teamModes, onClockTeamId]);

  const upcoming = [];
  for (let i = 1; i <= 6; i++) {
    const pn = currentPickNum + i;
    if (pn > 192) break;
    const round = Math.ceil(pn / 12);
    const s = ((pn - 1) % 12);
    const tid = round % 2 === 1 ? teamsOrder[s] : teamsOrder[11 - s];
    const team = LEAGUE_TEAMS.find(t => t.id === tid);
    upcoming.push({ pick: pn, round, team, teamId: tid });
  }

  const currentPrediction = predictPicks(onClockTeamId, currentPickNum, draftedIds, 3);

  // Normalize API player IDs to store IDs (matched by name+pos) so findPlayer
  // works in the pick log, teams grid, and drafted-set filtering throughout the draft.
  const playerPool = React.useMemo(() => {
    const store = getPlayers();
    if (!apiPlayers) return store;
    return apiPlayers.map(ap => {
      const local = store.find(lp => lp.name === ap.name && lp.pos === ap.pos);
      return local ? { ...ap, id: local.id } : ap;
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiPlayers]);

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

  const boardSortFn = (a, b) => {
    let av, bv;
    if (boardSortCol === 'tier') { av = a.tier ?? 99; bv = b.tier ?? 99; }
    else if (boardSortCol === 'adp') { av = a.adp ?? 9999; bv = b.adp ?? 9999; }
    else { av = getRank(a); bv = getRank(b); }
    return boardSortDir === 'asc' ? av - bv : bv - av;
  };

  const FLEX_POS = new Set(['RB', 'WR', 'TE']);
  function matchesPos(p, pos) {
    if (pos === 'ALL') return true;
    if (pos === 'FLEX') return FLEX_POS.has(p.pos);
    return p.pos === pos;
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

  const aiSuggestions = [
    { id: 31, why: 'Tier-2 RB with three-down workload — perfect handcuff to your CMC. Last #28 ECR available.' },
    { id: 82, why: 'TE5 still on the board. Position scarcity hits hard after pick 50; lock this now.' },
    { id: 6, why: "QB room is thin if Burrow tweaks again. Caleb is the contingency w/ rushing floor." },
  ];

  const rosterSlots = [
    { slot: 'QB', filled: 1 }, { slot: 'RB', filled: 1 }, { slot: 'RB', filled: 0 },
    { slot: 'WR', filled: 1 }, { slot: 'WR', filled: 0 }, { slot: 'TE', filled: 0 },
    { slot: 'FLEX', filled: 0 }, { slot: 'K', filled: 0 }, { slot: 'DST', filled: 0 },
    { slot: 'BENCH', filled: 0 }, { slot: 'BENCH', filled: 0 }, { slot: 'BENCH', filled: 0 },
    { slot: 'BENCH', filled: 0 }, { slot: 'BENCH', filled: 0 }, { slot: 'BENCH', filled: 0 },
    { slot: 'BENCH', filled: 0 },
  ];

  const myDraftTeamId = mockActive ? (mockUserTeamId || 1) : (user?.teamId || 1);
  const myPicks = allPicks.filter(p => p.teamId === myDraftTeamId && p.playerId);
  const teamsForCols = teamsOrder.map(id => LEAGUE_TEAMS.find(t => t.id === id));

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

  const draftComplete = currentPickNum > 192;
  const draftStatusText  = draftComplete ? 'Draft Complete' : paused ? 'Commissioner Paused Draft' : 'Draft Active';
  const draftStatusColor = draftComplete ? '#4caf82' : paused ? '#ff9800' : '#4caf82';

  if (!isLive && !mockActive) {
    const savedMockPicks = (() => { try { return JSON.parse(localStorage.getItem('fantasai_mock_picks_saved') || 'null') || []; } catch { return []; } })();
    const myTeamId = user?.teamId || 1;
    const savedMyPicks = savedMockPicks.filter(p => p.teamId === myTeamId && p.playerId);
    const hasMockResults = savedMyPicks.length > 0;

    function gradeResult(picks) {
      const myPks = picks.filter(p => p.teamId === myTeamId && p.playerId);
      if (!myPks.length) return { letter: '—', color: 'var(--text-faint)' };
      const adpAvg = myPks.reduce((s, pk) => {
        const p = findP(pk.playerId); return s + ((p?.adp || 200) - (pk.round * 12 + pk.slot));
      }, 0) / myPks.length;
      const letter = adpAvg > 8 ? 'A+' : adpAvg > 4 ? 'A' : adpAvg > 1 ? 'B+' : adpAvg > -2 ? 'B' : adpAvg > -5 ? 'C' : 'D';
      const color  = adpAvg > 1 ? 'var(--good)' : adpAvg > -3 ? 'var(--warn)' : 'var(--danger)';
      return { letter, color, adpAvg };
    }
    const grade = hasMockResults ? gradeResult(savedMockPicks) : null;

    const savedByRoundTeam = {};
    for (const pk of savedMockPicks) {
      if (!savedByRoundTeam[pk.round]) savedByRoundTeam[pk.round] = {};
      savedByRoundTeam[pk.round][pk.teamId] = pk;
    }

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

            {/* Mock Draft Results (if any previous mock was completed) */}
            {hasMockResults && <>
          {/* Header with grade */}
          <div style={{ padding: '16px 24px 12px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 16, flexShrink: 0, background: 'var(--panel-1)' }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 900, fontSize: 16, color: 'var(--text)', letterSpacing: '-.01em' }}>Mock Draft Results</div>
              <div style={{ fontSize: 11, color: '#ff9800', fontFamily: 'var(--font-mono)', fontWeight: 700, marginTop: 2, letterSpacing: '.06em' }}>
                {savedMockPicks.length} PICKS RECORDED · {savedMyPicks.length} FOR YOUR TEAM
              </div>
            </div>
            {grade && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                {grade.adpAvg != null && (
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: 9, color: 'var(--text-faint)', fontFamily: 'var(--font-mono)', letterSpacing: '.06em' }}>VS ADP</div>
                    <div style={{ fontSize: 14, fontFamily: 'var(--font-mono)', fontWeight: 700, color: grade.color }}>
                      {grade.adpAvg > 0 ? '+' : ''}{grade.adpAvg.toFixed(1)}
                    </div>
                  </div>
                )}
                <div style={{ width: 54, height: 54, borderRadius: 12, background: `${grade.color}22`, border: `2px solid ${grade.color}`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                  <span style={{ fontFamily: 'var(--font-display)', fontWeight: 900, fontSize: 28, fontStretch: '75%', color: grade.color }}>{grade.letter}</span>
                </div>
              </div>
            )}
          </div>

          {/* My Roster */}
          <div style={{ padding: '14px 24px 12px', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
            <div style={{ fontSize: 10, fontFamily: 'var(--font-mono)', fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--text-dim)', marginBottom: 10 }}>
              My Roster
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(155px, 1fr))', gap: 6 }}>
              {[...savedMyPicks].sort((a, b) => a.pickNum - b.pickNum).map(pk => {
                const p = findP(pk.playerId);
                if (!p) return null;
                return (
                  <div key={pk.pickNum} style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '5px 8px', borderRadius: 7, background: 'var(--panel-2)', border: '1px solid var(--border)' }}>
                    <span className={`pos-badge pos-${p.pos}`} style={{ fontSize: 9, minWidth: 28 }}>{p.pos}</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 11, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</div>
                      <div style={{ fontSize: 9, color: 'var(--text-faint)', fontFamily: 'var(--font-mono)' }}>R{pk.round}.{String(pk.slot).padStart(2, '0')}</div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Full Draft Board by Round × Team */}
          <div style={{ padding: '14px 24px 20px', flex: 1 }}>
            <div style={{ fontSize: 10, fontFamily: 'var(--font-mono)', fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--text-dim)', marginBottom: 10 }}>
              Full Draft Board
            </div>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ borderCollapse: 'collapse', fontSize: 11, width: '100%' }}>
                <thead>
                  <tr>
                    <th style={{ padding: '4px 8px', textAlign: 'left', fontSize: 9, fontFamily: 'var(--font-mono)', color: 'var(--text-faint)', fontWeight: 700, letterSpacing: '.06em', borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap' }}>RD</th>
                    {TEAMS_ORDER.map(tid => {
                      const t = LEAGUE_TEAMS.find(x => x.id === tid);
                      const isMe = tid === myTeamId;
                      return (
                        <th key={tid} style={{ padding: '4px 6px', textAlign: 'center', fontSize: 9, color: isMe ? 'var(--accent)' : 'var(--text-faint)', fontWeight: isMe ? 900 : 600, borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap', minWidth: 70 }}>
                          {t?.name?.split(' ').pop() || t?.name || tid}
                        </th>
                      );
                    })}
                  </tr>
                </thead>
                <tbody>
                  {Array.from({ length: 16 }, (_, ri) => {
                    const round = ri + 1;
                    return (
                      <tr key={round} style={{ background: round % 2 === 0 ? 'rgba(255,255,255,.018)' : 'transparent' }}>
                        <td style={{ padding: '3px 8px', fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--text-faint)', borderBottom: '1px solid rgba(255,255,255,.04)', whiteSpace: 'nowrap' }}>R{round}</td>
                        {TEAMS_ORDER.map(tid => {
                          const pk = savedByRoundTeam[round]?.[tid];
                          const p  = pk ? findP(pk.playerId) : null;
                          const isMe = tid === myTeamId;
                          return (
                            <td key={tid} style={{ padding: '4px 6px', textAlign: 'center', borderBottom: '1px solid rgba(255,255,255,.04)', background: isMe ? 'rgba(198,255,58,.07)' : 'transparent', maxWidth: 90 }}>
                              {p ? (
                                <div title={`${p.name} (${p.pos}) R${pk.round}.${pk.slot}`} style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 10, fontWeight: isMe ? 700 : 400, color: isMe ? 'var(--accent)' : 'var(--text-dim)' }}>
                                  {p.name.split(' ').slice(-1)[0]}
                                </div>
                              ) : (
                                <span style={{ color: 'var(--border-strong)', fontSize: 9 }}>—</span>
                              )}
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
          </>}
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
      {/* CLOCK BAR */}
      <div className="draft-clock">
        <div style={{ padding: '0 24px', borderRight: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 16, alignSelf: 'stretch' }}>
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
            <div className="name">{onClockTeam.name}</div>
            <div className="pick">{onClockTeam.owner} {isMyTurn && <span style={{ color: 'var(--accent)', marginLeft: 6 }}>· YOU'RE UP</span>}</div>
          </div>
          <div className="up-next">
            <span>UP NEXT →</span>
            {upcoming.map(u => (
              <span key={u.pick} className={`tn ${u.team.me ? 'me' : ''}`}>{u.pick}. {u.team.logo}</span>
            ))}
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
              onClick={() => {
                const next = !paused;
                setPaused(next);
                if (!mockActive) logCommish(next ? 'pause' : 'resume', next ? 'Commissioner paused the draft clock' : 'Commissioner resumed the draft clock');
              }}
              style={paused ? { color: 'var(--accent)', borderColor: 'var(--accent)' } : {}}
            >
              {paused ? '▶ Resume' : (mockActive ? '⏸ Pause AI' : '⏸ Pause')}
            </button>
            {mockActive && (
              <button className="btn ghost sm" style={{ color: '#ff6b6b', borderColor: 'rgba(255,107,107,.4)' }} onClick={exitMockDraft}>✕ Exit Mock</button>
            )}
            {isMyTurn && !mockActive && <button className="btn primary">▶ Draft Best Available</button>}
            {mockActive && isMyTurn && (
              <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--accent)', animation: 'pulse 1s infinite' }}>YOUR PICK</span>
            )}
            {mockActive && !isMyTurn && !paused && (
              <span style={{ fontSize: 11, color: 'var(--text-faint)', fontFamily: 'var(--font-mono)' }}>AI picking…</span>
            )}
            {mockActive && paused && (
              <span style={{ fontSize: 11, color: '#ffb547', fontFamily: 'var(--font-mono)' }}>AI paused</span>
            )}
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

      {/* GHOST PICKS STRIP */}
      <div className="draft-ghosts" style={hidden.ghosts ? { display: 'none' } : {}}>
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
            const ghostPreds = predictPicks(u.teamId, u.pick, draftedIds, 2);
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
      </div>

      {/* COMMISSIONER'S CONCIERGE — horizontal bar between ghost picks and big board */}
      {isCommissioner && (
        <div className="draft-concierge">

          {/* Label */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '0 12px', borderRight: '1px solid rgba(255,180,0,.2)', flexShrink: 0 }}>
            <span style={{ fontSize: 13 }}>👑</span>
            <div style={{ fontSize: 9, fontWeight: 900, color: '#ffb547', letterSpacing: '.07em', textTransform: 'uppercase', lineHeight: 1.2 }}>
              Commish<br />Concierge
            </div>
          </div>

          {/* ── Clock ── */}
          <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 4, padding: '0 12px', borderRight: '1px solid rgba(255,180,0,.15)' }}>
            <div style={{ fontSize: 9, fontWeight: 700, color: 'rgba(255,180,0,.55)', textTransform: 'uppercase', letterSpacing: '.08em' }}>Clock</div>
            <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
              <button className="btn ghost sm" style={{ fontSize: 10, padding: '2px 7px', ...(paused ? { color: 'var(--accent)', borderColor: 'var(--accent)' } : {}) }} onClick={() => { const next = !paused; setPaused(next); logCommish(next ? 'pause' : 'resume', next ? 'Commissioner paused the draft clock' : 'Commissioner resumed the draft clock'); }}>
                {paused ? '▶ Resume' : '⏸ Pause'}
              </button>
              <button className="btn ghost sm" style={{ fontSize: 10, padding: '2px 7px' }} onClick={() => { setSeconds(clockSeconds); setPaused(false); }}>
                ↺ Reset
              </button>
              <select
                className="input"
                style={{ fontSize: 10, padding: '2px 4px', width: 70 }}
                value={clockSeconds}
                onChange={e => { const v = Number(e.target.value); setClockSeconds(v); setSeconds(v); logCommish('clock', `Commissioner set pick clock to ${v < 60 ? `${v}s` : `${v / 60}m`}`); }}
                title="Seconds per pick"
              >
                {[30, 60, 90, 120, 180, 300].map(s => (
                  <option key={s} value={s}>{s < 60 ? `${s}s` : `${s/60}m`}</option>
                ))}
              </select>
            </div>
          </div>

          {/* ── Undo Picks ── */}
          <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 4, padding: '0 12px', borderRight: '1px solid rgba(255,180,0,.15)' }}>
            <div style={{ fontSize: 9, fontWeight: 700, color: 'rgba(255,180,0,.55)', textTransform: 'uppercase', letterSpacing: '.08em' }}>Undo Picks</div>
            <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
              <button className="btn ghost sm" style={{ fontSize: 10, padding: '2px 7px' }} onClick={() => removeLastPicks(1)}>↩ Last</button>
              {selectedPicks.size > 0 ? (
                <button
                  style={{ fontSize: 10, padding: '2px 8px', background: '#ff9800', color: '#000', border: '1px solid #ff9800', borderRadius: 4, cursor: 'pointer', fontWeight: 700 }}
                  onClick={() => reverseSelectedPicks()}
                >
                  ↩ {selectedPicks.size} selected
                </button>
              ) : (
                <span style={{ fontSize: 10, color: 'var(--text-faint)', fontStyle: 'italic' }}>select in log ↓</span>
              )}
            </div>
          </div>

          {/* ── Make Pick — always visible to commissioner in live mode ── */}
          {!mockActive && (() => {
            const pickTeamId = commishPickTeamId ?? onClockTeamId;
            const pickTeam   = LEAGUE_TEAMS.find(t => t.id === pickTeamId);
            const matches    = commishPickSearch.trim()
              ? bestAvail.filter(p => p.name.toLowerCase().includes(commishPickSearch.toLowerCase())).slice(0, 7)
              : [];
            return (
              <div style={{ position: 'relative', display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 4, padding: '0 12px', borderRight: '1px solid rgba(78,168,255,.3)', background: 'rgba(78,168,255,.06)', flexShrink: 0 }}>
                <div style={{ fontSize: 9, fontWeight: 700, color: 'var(--accent-2)', textTransform: 'uppercase', letterSpacing: '.08em' }}>
                  Make Pick · Pick #{livePickNum}
                </div>
                <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                  <select
                    className="input"
                    style={{ fontSize: 10, padding: '2px 4px', width: 100 }}
                    value={pickTeamId}
                    onChange={e => setCommishPickTeamId(Number(e.target.value))}
                    title="Team receiving this pick"
                  >
                    {LEAGUE_TEAMS.map(t => (
                      <option key={t.id} value={t.id}>{t.logo} {t.name}</option>
                    ))}
                  </select>
                  <input
                    className="input"
                    style={{ fontSize: 10, padding: '2px 6px', width: 120 }}
                    placeholder="Search player…"
                    value={commishPickSearch}
                    onChange={e => setCommishPickSearch(e.target.value)}
                    autoComplete="off"
                  />
                </div>
                {matches.length > 0 && (
                  <div style={{
                    position: 'absolute', top: '100%', left: 0, zIndex: 60,
                    background: 'var(--panel-2)', border: '1px solid var(--border-strong)',
                    borderRadius: 6, minWidth: 240, boxShadow: '0 6px 24px rgba(0,0,0,.6)', overflow: 'hidden',
                  }}>
                    <div style={{ padding: '5px 10px', fontSize: 9, fontFamily: 'var(--font-mono)', color: 'var(--accent-2)', background: 'rgba(78,168,255,.08)', borderBottom: '1px solid var(--border)' }}>
                      {pickTeam?.logo} {pickTeam?.name} · click to draft
                    </div>
                    {matches.map((p, i) => (
                      <div
                        key={p.id}
                        style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px', cursor: 'pointer', borderBottom: i < matches.length - 1 ? '1px solid var(--border)' : 'none' }}
                        onMouseEnter={e => e.currentTarget.style.background = 'var(--hover)'}
                        onMouseLeave={e => e.currentTarget.style.background = ''}
                        onClick={() => {
                          commishPick(p.id, pickTeamId);
                          setCommishPickSearch('');
                          setCommishPickTeamId(null);
                          setPaused(false);
                          logCommish('pick', `Commissioner drafted ${p.name} (${p.pos}) for ${pickTeam?.name}`);
                        }}
                      >
                        <span style={{ fontSize: 10, fontFamily: 'var(--font-mono)', padding: '1px 5px', borderRadius: 3, background: 'rgba(78,168,255,.15)', color: 'var(--accent-2)', flexShrink: 0 }}>{p.pos}</span>
                        <span style={{ fontWeight: 600, fontSize: 12, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</span>
                        <span style={{ fontSize: 10, color: 'var(--text-faint)', flexShrink: 0 }}>{p.team}</span>
                        <span style={{ fontSize: 10, color: 'var(--accent)', fontFamily: 'var(--font-mono)', fontWeight: 700, flexShrink: 0 }}>{p.proj?.toFixed(1)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })()}

          {/* ── Draft Date ── */}
          <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 4, padding: '0 12px', borderRight: '1px solid rgba(255,180,0,.15)' }}>
            <div style={{ fontSize: 9, fontWeight: 700, color: 'rgba(255,180,0,.55)', textTransform: 'uppercase', letterSpacing: '.08em' }}>Draft Date</div>
            {editingDraftDate ? (
              <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                <input
                  type="datetime-local"
                  className="input"
                  style={{ fontSize: 10, padding: '2px 4px' }}
                  value={draftDateDraft}
                  onChange={e => setDraftDateDraft(e.target.value)}
                />
                <button className="btn primary sm" style={{ fontSize: 10, padding: '2px 7px' }} onClick={saveDraftDate}>Save</button>
                <button className="btn ghost sm" style={{ fontSize: 10, padding: '2px 7px' }} onClick={() => setEditingDraftDate(false)}>✕</button>
              </div>
            ) : (
              <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                <span style={{ fontSize: 10, color: 'var(--text-dim)', whiteSpace: 'nowrap' }}>
                  {draftSettings.date ? new Date(draftSettings.date).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : 'Not set'}
                </span>
                <button className="btn ghost sm" style={{ fontSize: 10, padding: '2px 7px' }} onClick={() => { setDraftDateDraft(draftSettings.date || ''); setEditingDraftDate(true); }}>Edit</button>
              </div>
            )}
          </div>

          {/* ── Mock Draft ── */}
          <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 4, padding: '0 12px', borderRight: '1px solid rgba(255,180,0,.15)' }}>
            <div style={{ fontSize: 9, fontWeight: 700, color: 'rgba(255,180,0,.55)', textTransform: 'uppercase', letterSpacing: '.08em' }}>Mock Draft</div>
            {mockActive ? (
              <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                <span style={{ fontSize: 10, color: 'var(--text-faint)' }}>
                  {mockPickNum > 192 ? '✓ Done' : `Pick #${mockPickNum}`}
                </span>
                <button className="btn ghost sm" style={{ fontSize: 10, padding: '2px 7px' }} onClick={exitMockDraft}>✕ Exit</button>
              </div>
            ) : (
              <button className="btn ghost sm" style={{ fontSize: 10, padding: '2px 7px' }} onClick={startMockDraft} disabled={isLive}>
                ▶ Start Mock
              </button>
            )}
          </div>

          {/* ── Danger Zone ── */}
          <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 4, padding: '0 12px', marginLeft: 'auto' }}>
            <div style={{ fontSize: 9, fontWeight: 700, color: 'rgba(255,80,80,.5)', textTransform: 'uppercase', letterSpacing: '.08em' }}>Danger</div>
            {resetDraftConfirm2 ? (
              <div style={{ display: 'flex', gap: 4, alignItems: 'center', flexWrap: 'nowrap' }}>
                <span style={{ fontSize: 9, color: '#ff5a6e', whiteSpace: 'nowrap' }}>Absolutely sure?</span>
                <button className="btn sm" style={{ fontSize: 10, padding: '2px 7px', background: '#ff5a6e', color: '#fff', borderColor: '#ff5a6e', fontWeight: 900 }} onClick={resetDraft}>YES, RESET</button>
                <button className="btn ghost sm" style={{ fontSize: 10, padding: '2px 7px' }} onClick={() => { setResetDraftConfirm(false); setResetDraftConfirm2(false); }}>No</button>
              </div>
            ) : resetDraftConfirm ? (
              <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                <span style={{ fontSize: 10, color: '#ff5a6e' }}>Sure?</span>
                <button className="btn sm" style={{ fontSize: 10, padding: '2px 7px', background: '#ff9800', color: '#000', borderColor: '#ff9800' }} onClick={() => setResetDraftConfirm2(true)}>Yes</button>
                <button className="btn ghost sm" style={{ fontSize: 10, padding: '2px 7px' }} onClick={() => setResetDraftConfirm(false)}>No</button>
              </div>
            ) : (
              <button className="btn ghost sm" style={{ fontSize: 10, padding: '2px 7px', color: '#ff5a6e', borderColor: 'rgba(255,90,110,.35)' }} onClick={() => setResetDraftConfirm(true)}>
                ⚠ Reset Draft
              </button>
            )}
          </div>

        </div>
      )}

      {/* BIG BOARD */}
      <div className="draft-board">
        <div className="toolbar" style={{ padding: '10px 12px', borderBottom: '1px solid var(--border)', borderTop: 0 }}>
          <div className="card-title" style={{ flex: 1 }}>
            Big Board · {bestAvail.length} available
            {draftedIds.size > 0 && (
              <span style={{ fontSize: 10, fontWeight: 500, color: 'var(--text-faint)', marginLeft: 6 }}>
                · {draftedIds.size} drafted
              </span>
            )}
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            {apiLoading && <span style={{ fontSize: 10, color: 'var(--text-faint)', fontFamily: 'var(--font-mono)' }}>loading…</span>}
            {!apiLoading && apiPlayers && (
              <span style={{ fontSize: 10, color: '#4caf82', fontFamily: 'var(--font-mono)' }}>● live ({apiPlayers.length})</span>
            )}
            {!apiLoading && !apiPlayers && (
              <span style={{ fontSize: 10, color: 'var(--text-faint)', fontFamily: 'var(--font-mono)' }}>{apiError ? '⚠ static' : '○ static'}</span>
            )}
            <button
              className="btn ghost sm"
              style={{ fontSize: 10, padding: '2px 8px' }}
              onClick={fetchApiPlayers}
              disabled={apiLoading}
              title="Refresh player list from API"
            >
              ↻ Refresh
            </button>
          </div>
        </div>

        {/* Ranking source selector */}
        <div style={{ padding: '7px 12px', borderBottom: '1px solid var(--border)', display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <span style={{ fontSize: 9, fontFamily: 'var(--font-mono)', fontWeight: 700, letterSpacing: '.1em', textTransform: 'uppercase', color: 'var(--text-faint)', flexShrink: 0 }}>Rankings</span>
          {RANK_SOURCES.map(src => {
            const isActive = rankSource === src.id;
            const isLoading = (src.id === 'cbs' && cbsRankLoad) || (src.id === 'fp' && fpRankLoad);
            const hasErr    = (src.id === 'cbs' && cbsRankErr)  || (src.id === 'fp' && fpRankErr);
            const hasData   = (src.id === 'cbs' && cbsRanks)    || (src.id === 'fp' && fpRanks) || src.id === 'sleeper' || src.id === 'owner';
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
              · {Object.keys(ownerRanks).length} ranked · type a rank # in each row
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
                  {rankSource === 'sleeper' ? 'ADP' : rankSource === 'cbs' ? 'CBS' : rankSource === 'fp' ? 'FP ECR' : 'ADP'} {boardSortCol === 'adp' ? (boardSortDir === 'asc' ? '▲' : '▼') : ''}
                </th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {boardDisplay.slice(0, 120).map((p, idx) => {
                const isDrafted   = draftedIds.has(p.id);
                const inQueue     = queue.includes(p.id);
                const isJustFreed = justFreedIds.has(p.id);
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
                            <div style={{ fontSize: 12, color: 'var(--text-dim)', fontWeight: 600, textDecoration: 'line-through', textDecorationColor: 'rgba(255,255,255,.3)' }}>{p.name}</div>
                            <div className="player-meta"><PosBadge pos={p.pos} /> {p.team}</div>
                          </div>
                        </div>
                      </td>
                      <td className="tier" style={{ color: 'var(--text-faint)' }}>T{p.tier}</td>
                      <td className="num faint" style={{ fontSize: 11 }}>{p.adp != null ? p.adp.toFixed(1) : '—'}</td>
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
                  <tr key={p.id} style={isJustFreed ? { background: 'rgba(76,175,130,.1)', outline: '1px solid rgba(76,175,130,.3)' } : {}}>
                    <td className="rank" style={{ color: rank < 9999 ? undefined : 'var(--text-faint)' }}>{displayRank}</td>
                    <td>
                      <div className="player-cell">
                        <PlayerAvatar player={p} />
                        <div style={{ minWidth: 0, flex: 1 }}>
                          <div className="player-name" style={{ fontSize: 12 }}>{p.name}</div>
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
                    <td>
                      <div className="flex" style={{ gap: 4 }}>
                        <button className="btn sm icon" title="Add to queue"
                          onClick={() => setQueue(inQueue ? queue.filter(x => x !== p.id) : [...queue, p.id])}
                          style={inQueue ? { background: 'var(--accent)', color: 'var(--accent-ink)', borderColor: 'var(--accent)' } : {}}>
                          {inQueue ? '✓' : '+'}
                        </button>
                        {(isMyTurn || (isCommissioner && !mockActive)) && (
                          <button
                            className="btn sm primary"
                            style={{ padding: '4px 8px' }}
                            onClick={() => mockActive ? draftPlayer(p.id) : commishPick(p.id)}
                          >
                            {isCommissioner && !isMyTurn ? `→ ${onClockTeam?.logo}` : 'DRAFT'}
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

      {/* MY QUEUE */}
      <div className="draft-queue" style={hidden.queue ? { overflow: 'hidden' } : {}}>
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
                  <div className="player-name" style={{ fontSize: 12 }}>{p.name}</div>
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
          <span className="mono faint" style={{ fontSize: 10 }}>{currentPickNum - 1}/192</span>
        </div>
        <div style={{ flex: 1, overflow: 'auto', display: hidden.picklog ? 'none' : undefined }}>
          {/* Commissioner event entries — most recent first */}
          {commishLog.slice().reverse().map(entry => (
            <div key={`cl-${entry.id}`} style={{ padding: '6px 14px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 8, background: entry.type === 'reset' ? 'rgba(255,90,110,.08)' : 'rgba(91,156,246,.06)', borderLeft: `3px solid ${entry.type === 'reset' ? '#ff5a6e' : '#5b9cf6'}` }}>
              <span style={{ fontSize: 14, flexShrink: 0 }}>{entry.type === 'reset' ? '⚠' : entry.type === 'pause' ? '⏸' : entry.type === 'resume' ? '▶' : '⚙'}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ color: entry.type === 'reset' ? '#ff5a6e' : '#5b9cf6', fontWeight: 700, fontSize: 11 }}>{entry.message}</div>
                <div style={{ color: 'var(--text-faint)', fontSize: 10 }}>{entry.ts}</div>
              </div>
            </div>
          ))}
          {/* Reversal audit entries — most recent first */}
          {reversalLog.slice().reverse().map((entry, i) => {
            const rp = findPlayer(entry.playerId);
            const rt = LEAGUE_TEAMS.find(x => x.id === entry.teamId);
            if (!rp || !rt) return null;
            return (
              <div key={`rev-${i}`} style={{ padding: '6px 14px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 8, background: 'rgba(255,152,0,.07)', borderLeft: '3px solid #ff9800' }}>
                <span style={{ fontSize: 16, flexShrink: 0 }}>↩</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ color: '#ff9800', fontWeight: 700, fontSize: 11 }}>
                    Commissioner reversed {entry.round}.{entry.slot.toString().padStart(2, '0')}
                  </div>
                  <div style={{ color: 'var(--text-faint)', fontSize: 10 }}>
                    {rp.name} removed from {rt.logo} {rt.name} · {entry.reversedAt}
                  </div>
                </div>
              </div>
            );
          })}
          {/* Normal pick entries */}
          {allPicks.filter(pk => pk.playerId).slice().reverse().map(pk => {
            const p = findP(pk.playerId);
            const t = LEAGUE_TEAMS.find(x => x.id === pk.teamId);
            if (!p || !t) return null;
            const adpDelta = pk.pickNum - (p.adp ?? p.ecr);
            const ghost = ghostPredictions[pk.pickNum];
            const ghostMatch = ghost?.player?.id === pk.playerId;
            const deltaColor = adpDelta >= 3 ? '#4caf82' : adpDelta <= -3 ? '#ff5a6e' : 'var(--text-dim)';
            const isSelected = selectedPicks.has(pk.pickNum);
            return (
              <div key={pk.pickNum} style={{ padding: '7px 14px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, background: isSelected ? 'rgba(255,152,0,.1)' : t.me ? 'rgba(198,255,58,.03)' : '' }}>
                {isCommissioner && (
                  <input
                    type="checkbox"
                    checked={isSelected}
                    onChange={() => setSelectedPicks(prev => { const n = new Set(prev); n.has(pk.pickNum) ? n.delete(pk.pickNum) : n.add(pk.pickNum); return n; })}
                    style={{ cursor: 'pointer', accentColor: '#ff9800', width: 13, height: 13, flexShrink: 0 }}
                  />
                )}
                <div className="mono faint" style={{ width: 38, fontSize: 11, flexShrink: 0 }}>{pk.round}.{pk.slot.toString().padStart(2, '0')}</div>
                <PosBadge pos={p.pos} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 5, flexWrap: 'nowrap', overflow: 'hidden' }}>
                    <span className="player-name" style={{ fontSize: 12, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.name}</span>
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
              </div>
            );
          })}
        </div>
      </div>

      {/* RIGHT: AI + Roster + Chat */}
      <div className="draft-roster">
        {/* AI Pick Engine */}
        <div style={{ padding: '10px 12px', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
          <div className="suggest-card">
            <div className="head" style={{ marginBottom: 8 }}>
              <div className="ai-orb"></div>
              <span className="label">FantasAI Pick Engine</span>
              <span className="grow"></span>
              <span className="mono faint" style={{ fontSize: 10 }}>0.2s ago</span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {aiSuggestions.map((s, i) => {
                const p = findPlayer(s.id);
                if (!p) return null;
                return (
                  <div key={s.id} style={{ background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 6, padding: '8px 10px', display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span className="mono accent" style={{ fontSize: 10, fontWeight: 700, flexShrink: 0 }}>#{i + 1}</span>
                    <PlayerAvatar player={p} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div className="player-name" style={{ fontSize: 11 }}>{p.name}</div>
                      <div className="player-meta"><PosBadge pos={p.pos} /> {p.team}</div>
                    </div>
                    {(aiMode === 'centerpiece' || aiMode === 'copilot') && isMyTurn && (
                      <button className="btn ai sm" style={{ padding: '3px 8px', fontSize: 10 }}>DRAFT</button>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
        {(() => {
          const myTeamName = LEAGUE_TEAMS.find(t => t.id === myDraftTeamId)?.name || 'My Team';
          const isMock = mockActive;
          const savedMockPicks = (() => { try { return JSON.parse(localStorage.getItem('fantasai_mock_picks_saved') || 'null') || []; } catch { return []; } })();
          const displayPicks = myPicks; // always current (mock or live)

          // Grade based on avg ECR of picks
          function gradeMock(picks) {
            if (!picks.length) return { letter: '—', color: 'var(--text-faint)' };
            const myTeamPicks = picks.filter(p => p.teamId === myDraftTeamId && p.playerId);
            if (!myTeamPicks.length) return { letter: '—', color: 'var(--text-faint)' };
            const avgEcr = myTeamPicks.reduce((s, pk) => s + (findP(pk.playerId)?.ecr || 200), 0) / myTeamPicks.length;
            const adpAvg = myTeamPicks.reduce((s, pk, _i, arr) => {
              const p = findP(pk.playerId); return s + ((p?.adp || 200) - (pk.round * 12 + pk.slot));
            }, 0) / myTeamPicks.length;
            const letter = adpAvg > 8 ? 'A+' : adpAvg > 4 ? 'A' : adpAvg > 1 ? 'B+' : adpAvg > -2 ? 'B' : adpAvg > -5 ? 'C' : 'D';
            const color  = adpAvg > 1 ? 'var(--good)' : adpAvg > -3 ? 'var(--warn)' : 'var(--danger)';
            return { letter, color, adpAvg, avgEcr };
          }

          return (
            <>
              <div style={{ padding: '10px 14px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 8 }}>
                <div className="ai-orb" style={{ width: 18, height: 18, background: isMock ? '#ff9800' : 'var(--accent)', boxShadow: `0 0 8px ${isMock ? '#ff9800' : 'var(--accent)'}` }}></div>
                <div style={{ flex: 1 }}>
                  <div className="card-title" style={{ fontSize: 12 }}>{myTeamName}</div>
                  {isMock && <div style={{ fontSize: 9, fontFamily: 'var(--font-mono)', color: '#ff9800', fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase' }}>Mock Draft · No real roster impact</div>}
                </div>
                <div className="mono faint" style={{ fontSize: 11 }}>{displayPicks.length}/16</div>
              </div>
              {/* Flat pick list sorted by draft order — works for all positions including 3rd+ RB/WR */}
              <div style={{ padding: '6px 0', maxHeight: '50%', overflow: 'auto' }}>
                {displayPicks.length === 0 && (
                  <div className="faint" style={{ fontSize: 11, padding: '12px 14px' }}>No picks yet</div>
                )}
                {[...displayPicks].sort((a, b) => a.pickNum - b.pickNum).map(pk => {
                  const player = findP(pk.playerId);
                  if (!player) return null;
                  return (
                    <div key={pk.pickNum} style={{ padding: '4px 14px', display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, borderBottom: '1px solid var(--border)', minHeight: 38 }}>
                      <span className={`pos-badge pos-${player.pos}`} style={{ minWidth: 32, fontSize: 9 }}>{player.pos}</span>
                      <PlayerAvatar player={player} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div className="player-name" style={{ fontSize: 12 }}>{player.name}</div>
                        <div className="player-meta">{player.team} · ECR #{player.ecr}</div>
                      </div>
                      <div className="mono faint" style={{ fontSize: 10, flexShrink: 0 }}>R{pk.round}.{pk.slot}</div>
                    </div>
                  );
                })}
              </div>

              {/* Previous mock roster (shown only when not currently in a mock draft and a saved mock exists) */}
              {!isMock && savedMockPicks.length > 0 && (() => {
                const savedMyPicks = savedMockPicks.filter(p => p.teamId === myDraftTeamId && p.playerId);
                if (!savedMyPicks.length) return null;
                const grade = gradeMock(savedMockPicks);
                return (
                  <div style={{ borderTop: '1px solid var(--border)', padding: '10px 14px 6px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                      <div style={{ fontSize: 10, fontFamily: 'var(--font-mono)', fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase', color: '#ff9800', flex: 1 }}>
                        Previous Mock Draft
                      </div>
                      <div style={{ fontFamily: 'var(--font-display)', fontWeight: 900, fontStretch: '75%', fontSize: 18, color: grade.color, lineHeight: 1 }}>{grade.letter}</div>
                      {grade.adpAvg != null && (
                        <div style={{ fontSize: 9, fontFamily: 'var(--font-mono)', color: grade.color }}>
                          {grade.adpAvg > 0 ? '+' : ''}{grade.adpAvg.toFixed(1)} vs ADP
                        </div>
                      )}
                    </div>
                    {savedMyPicks.slice(0, 8).map((pk, i) => {
                      const p = findP(pk.playerId);
                      if (!p) return null;
                      return (
                        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '3px 0', borderBottom: i < Math.min(7, savedMyPicks.length - 1) ? '1px solid rgba(255,255,255,.04)' : 'none' }}>
                          <span className={`pos-badge pos-${p.pos}`} style={{ fontSize: 9 }}>{p.pos}</span>
                          <span style={{ fontSize: 11, fontWeight: 600, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</span>
                          <span className="mono faint" style={{ fontSize: 10 }}>R{pk.round}.{pk.slot}</span>
                        </div>
                      );
                    })}
                    {savedMyPicks.length > 8 && (
                      <div style={{ fontSize: 10, color: 'var(--text-faint)', paddingTop: 4 }}>+{savedMyPicks.length - 8} more picks</div>
                    )}
                  </div>
                );
              })()}
            </>
          );
        })()}

        <div style={{ borderTop: '1px solid var(--border)', display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden' }}>
          <div style={{ padding: '10px 14px', borderBottom: '1px solid var(--border)' }}>
            <div className="card-title">League Chat</div>
          </div>
          <div style={{ flex: 1, overflow: 'auto', padding: '8px 0' }}>
            {chatMessages.map((m, i) => (
              <div key={i} className="chat-msg" style={m.ai ? { borderLeft: '2px solid var(--accent)', background: 'rgba(198,255,58,.04)' } : {}}>
                <span className="ts">{m.ts}</span>
                <span className="who" style={{ color: m.color }}>{m.who}</span>
                <span>{m.msg}</span>
              </div>
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
      </div>

      {/* TEAMS GRID */}
      <div className="draft-teams" style={hidden.teams ? { display: 'none' } : {}}>
        <div className="teams-grid">
          {teamsForCols.map((t, colIdx) => {
            if (!t) return null;
            const teamPicks = allPicks.filter(pk => pk.teamId === t.id);
            return (
              <div key={t.id} className={`team-col ${t.me ? 'me' : ''} ${t.id === onClockTeamId ? 'active' : ''}`}>
                <div className="hdr">
                  <span>#{colIdx + 1}</span>
                  <span className="pts">{Math.round(teamPicks.filter(p => p.playerId).reduce((s, p) => s + (findP(p.playerId)?.avg || 0), 0))}</span>
                </div>
                <div className="team-name">{t.logo} {t.name}</div>
                {isCommissioner && (
                  <select
                    value={teamModes[t.id] || 'manual'}
                    onChange={e => setTeamModes(prev => ({ ...prev, [t.id]: e.target.value }))}
                    style={{ fontSize: 9, padding: '2px 3px', width: '100%', background: 'var(--panel)', color: teamModes[t.id] === 'ai' ? 'var(--accent)' : teamModes[t.id] === 'auto' ? '#ffb547' : 'var(--text-faint)', border: '1px solid var(--border)', borderRadius: 3, cursor: 'pointer', marginBottom: 2, fontWeight: 700 }}
                  >
                    <option value="manual">Manual</option>
                    <option value="auto">Auto Draft</option>
                    <option value="ai">AI Draft</option>
                  </select>
                )}
                {teamPicks.slice(0, 8).map(pk => {
                  if (!pk.playerId) return (
                    <div key={pk.pickNum} className="pick-cell empty"><span>R{pk.round}.{pk.slot}</span></div>
                  );
                  const p = findP(pk.playerId);
                  if (!p) return null;
                  return (
                    <div key={pk.pickNum} className="pick-cell" style={{ borderLeftWidth: 2, borderLeftStyle: 'solid', borderLeftColor: `var(--pos-${p.pos.toLowerCase() === 'dst' ? 'dst' : p.pos.toLowerCase()})` }}>
                      <PosBadge pos={p.pos} />
                      <span className="nm">{p.name.split(' ').slice(-1)[0]}</span>
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
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
