import React from 'react';
import { PLAYERS, findPlayer, LEAGUE_TEAMS, DRAFT_PICKS, TEAMS_ORDER, QUEUE as INIT_QUEUE, CHAT_MESSAGES } from '../lib/data.js';
import { predictPicks } from '../lib/draft.js';
import { PosBadge, PlayerAvatar, PlayerCell } from '../components/ui.jsx';

export default function DraftRoom({ aiMode, user, onNav }) {
  const REAL_currentPickNum = 40;
  const isCommissioner = user?.isAdmin || user?.isCommissioner;

  // Mock draft mode
  const [mockActive, setMockActive]   = React.useState(false);
  const [mockPicks, setMockPicks]     = React.useState([]);
  const [mockPickNum, setMockPickNum] = React.useState(1);

  function startMockDraft() {
    setMockPicks([]);
    setMockPickNum(1);
    setMockActive(true);
  }
  function exitMockDraft() {
    setMockActive(false);
    setMockPicks([]);
    setMockPickNum(1);
  }
  function draftPlayer(playerId) {
    if (!mockActive) return;
    const round = Math.ceil(mockPickNum / 12);
    const s     = (mockPickNum - 1) % 12;
    setMockPicks(prev => [...prev, { pickNum: mockPickNum, teamId: 1, playerId, round, slot: s + 1 }]);
    setMockPickNum(n => n + 1);
    setQueue(q => q.filter(id => id !== playerId));
  }

  // AI auto-picks non-user slots during mock draft
  React.useEffect(() => {
    if (!mockActive || mockPickNum > 192) return;
    const round = Math.ceil(mockPickNum / 12);
    const s     = (mockPickNum - 1) % 12;
    const onClockId = round % 2 === 1 ? TEAMS_ORDER[s] : TEAMS_ORDER[11 - s];
    if (onClockId === 1) return; // user's turn — wait
    const draftedSet = new Set(mockPicks.map(p => p.playerId));
    const t = setTimeout(() => {
      const preds = predictPicks(onClockId, mockPickNum, draftedSet, 1);
      const pick  = preds[0];
      if (pick) {
        setMockPicks(prev => [...prev, { pickNum: mockPickNum, teamId: onClockId, playerId: pick.player.id, round, slot: s + 1 }]);
        setQueue(q => q.filter(id => id !== pick.player.id));
      }
      setMockPickNum(n => n + 1);
    }, 450);
    return () => clearTimeout(t);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mockActive, mockPickNum]);

  // Read draft date from league settings (stateful so saves are reflected immediately)
  const [draftSettings, setDraftSettings] = React.useState(() => {
    try { return JSON.parse(localStorage.getItem('fantasai_league_settings') || 'null')?.draft || {}; } catch { return {}; }
  });
  const draftDate = draftSettings.date ? new Date(draftSettings.date) : null;
  const isLive = !draftDate || draftDate <= new Date();

  const [seconds, setSeconds] = React.useState(73);
  const [paused, setPaused] = React.useState(false);
  const [queue, setQueue] = React.useState(INIT_QUEUE);
  const [boardPos, setBoardPos] = React.useState('ALL');
  const [boardSearch, setBoardSearch] = React.useState('');
  const [showRecap, setShowRecap] = React.useState(false);
  const [hidden, setHidden] = React.useState({ ghosts: false, queue: false, picklog: false, teams: false });
  const togglePanel = id => setHidden(h => ({ ...h, [id]: !h[id] }));

  // Mutable picks (so commissioner can undo/reset)
  const [livePicks, setLivePicks] = React.useState(DRAFT_PICKS);

  // Commissioner's Concierge state
  const [editingDraftDate, setEditingDraftDate] = React.useState(false);
  const [draftDateDraft, setDraftDateDraft] = React.useState(draftSettings.date || '');
  const [resetDraftConfirm, setResetDraftConfirm] = React.useState(false);
  const [resetDraftConfirm2, setResetDraftConfirm2] = React.useState(false);
  const [clockSeconds, setClockSeconds] = React.useState(90);
  const [selectedPicks, setSelectedPicks] = React.useState(new Set());
  const [reversalLog, setReversalLog] = React.useState([]);
  const [commishLog, setCommishLog] = React.useState([]);
  const [livePickNum, setLivePickNum] = React.useState(REAL_currentPickNum);
  const [teamModes, setTeamModes] = React.useState({}); // teamId -> 'manual'|'auto'|'ai'

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

  function reverseSelectedPicks(overrideSet) {
    const picksSet = overrideSet !== undefined ? overrideSet : selectedPicks;
    const current = mockActive ? mockPicks : livePicks;
    const picks = current.filter(p => picksSet.has(p.pickNum) && p.playerId);
    if (picks.length === 0) return;
    const ts = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    setReversalLog(prev => [...prev, ...picks.map(pk => ({ ...pk, type: 'reversal', reversedAt: ts }))]);
    const minPick = Math.min(...picks.map(p => p.pickNum));
    if (mockActive) {
      setMockPicks(prev => prev.filter(p => !picksSet.has(p.pickNum)));
      setMockPickNum(minPick);
    } else {
      setLivePicks(prev => prev.map(p => picksSet.has(p.pickNum) ? { ...p, playerId: null } : p));
      setLivePickNum(minPick);
    }
    setSelectedPicks(new Set());
  }

  function removeLastPicks(n) {
    const ts = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    if (mockActive) {
      setMockPicks(prev => {
        const filled = prev.filter(p => p.playerId).sort((a, b) => a.pickNum - b.pickNum);
        const toRemove = filled.slice(-n);
        if (!toRemove.length) return prev;
        const nums = new Set(toRemove.map(p => p.pickNum));
        setReversalLog(r => [...r, ...toRemove.map(pk => ({ ...pk, type: 'reversal', reversedAt: ts }))]);
        setMockPickNum(Math.min(...toRemove.map(p => p.pickNum)));
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
        return prev.map(p => nums.has(p.pickNum) ? { ...p, playerId: null } : p);
      });
    }
  }

  function commishPick(playerId) {
    const pickNum = livePickNum;
    setLivePicks(prev => prev.map(p => p.pickNum === pickNum ? { ...p, playerId, teamId: onClockTeamId } : p));
    setLivePickNum(n => n + 1);
    setSeconds(clockSeconds);
    setQueue(q => q.filter(id => id !== playerId));
  }

  function resetDraft() {
    const ts = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    setLivePicks(DRAFT_PICKS.map(p => ({ ...p, playerId: null })));
    setLivePickNum(1);
    setReversalLog([]);
    setSelectedPicks(new Set());
    setCommishLog(prev => [...prev, { type: 'reset', message: 'DRAFT RESET — All players returned to the player pool', ts, id: Date.now() }]);
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

  const teamsOrder = TEAMS_ORDER;
  const currentRound = Math.ceil(currentPickNum / 12);
  const slot = ((currentPickNum - 1) % 12);
  const onClockTeamId = currentRound % 2 === 1 ? teamsOrder[slot] : teamsOrder[11 - slot];
  const onClockTeam = LEAGUE_TEAMS.find(t => t.id === onClockTeamId);

  // Auto-draft for live mode when a team's mode is 'auto' or 'ai'
  React.useEffect(() => {
    if (mockActive || livePickNum > 192) return;
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
        pickId = queueId ?? PLAYERS.filter(p => !draftedSet.has(p.id)).sort((a, b) => a.ecr - b.ecr)[0]?.id ?? null;
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
  }, [mockActive, livePickNum, teamModes, onClockTeamId]);

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

  let bestAvail = PLAYERS.filter(p => !draftedIds.has(p.id));
  if (boardPos !== 'ALL') bestAvail = bestAvail.filter(p => p.pos === boardPos);
  if (boardSearch) bestAvail = bestAvail.filter(p => p.name.toLowerCase().includes(boardSearch.toLowerCase()));
  bestAvail.sort((a, b) => a.ecr - b.ecr);

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

  const myPicks = allPicks.filter(p => p.teamId === 1 && p.playerId);
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
  const isMyTurn = onClockTeamId === 1;

  const draftComplete = currentPickNum > 192;
  const draftStatusText  = draftComplete ? 'Draft Complete' : paused ? 'Commissioner Paused Draft' : 'Draft Active';
  const draftStatusColor = draftComplete ? '#4caf82' : paused ? '#ff9800' : '#4caf82';

  if (!isLive && !mockActive) {
    const fmt = draftDate.toLocaleString([], { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
    const msLeft = draftDate - new Date();
    const days   = Math.floor(msLeft / 86400000);
    const hrs    = Math.floor((msLeft % 86400000) / 3600000);
    const mins   = Math.floor((msLeft % 3600000) / 60000);
    const countdown = days > 0 ? `${days}d ${hrs}h ${mins}m` : `${hrs}h ${mins}m`;
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', gap: 18, padding: 40, textAlign: 'center' }}>
        <div style={{ fontSize: 48 }}>📋</div>
        <div style={{ fontWeight: 900, fontSize: 22, color: 'var(--text)', letterSpacing: '-.01em' }}>Draft Room Not Yet Open</div>
        <div style={{ fontSize: 14, color: 'var(--text-dim)', maxWidth: 380, lineHeight: 1.6 }}>
          The {draftSettings.format || 'Snake'} draft is scheduled for:
        </div>
        <div style={{ fontWeight: 800, fontSize: 18, color: 'var(--accent)' }}>{fmt}</div>
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: 13, color: 'var(--text-faint)', background: 'var(--panel-1)', padding: '8px 18px', borderRadius: 8, border: '1px solid var(--border)' }}>
          Opens in {countdown}
        </div>
        <div style={{ fontSize: 12, color: 'var(--text-faint)', marginTop: 4 }}>
          Commissioners can change the date in{' '}
          <button
            onClick={() => onNav?.('settings')}
            style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: 'var(--accent)', fontWeight: 700, fontSize: 12, textDecoration: 'underline' }}
          >
            Rules &amp; Settings → Draft Settings
          </button>
        </div>
        <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
          <button
            className="btn primary"
            style={{ fontSize: 14, padding: '10px 28px', letterSpacing: '.03em' }}
            onClick={startMockDraft}
          >
            ▶ Start Mock Draft
          </button>
          <div style={{ fontSize: 11, color: 'var(--text-faint)' }}>
            Practice with AI opponents — picks reset when you exit
          </div>
        </div>
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
                MOCK DRAFT
              </span>
            )}
            <button className="btn ghost sm" onClick={() => setShowRecap(!showRecap)}>Round {currentRound - 1} Recap</button>
            <button className="btn ghost sm" onClick={() => { const next = !paused; setPaused(next); logCommish(next ? 'pause' : 'resume', next ? 'Commissioner paused the draft clock' : 'Commissioner resumed the draft clock'); }} style={paused ? { color: 'var(--accent)', borderColor: 'var(--accent)' } : {}}>
              {paused ? '▶ Resume' : '⏸ Pause'}
            </button>
            {isMyTurn && !mockActive && <button className="btn primary">▶ Draft Best Available</button>}
            {mockActive && isMyTurn && (
              <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--accent)', animation: 'pulse 1s infinite' }}>YOUR PICK</span>
            )}
            {mockActive && !isMyTurn && (
              <span style={{ fontSize: 11, color: 'var(--text-faint)', fontFamily: 'var(--font-mono)' }}>AI picking…</span>
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
          <div className="card-title" style={{ flex: 1 }}>Big Board · {bestAvail.length} available</div>
        </div>
        <div style={{ padding: '8px 12px', borderBottom: '1px solid var(--border)', display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <div className="chips">
            {['ALL', 'QB', 'RB', 'WR', 'TE', 'K', 'DST'].map(p => (
              <div key={p} className={`chip ${boardPos === p ? 'accent active' : ''}`} onClick={() => setBoardPos(p)}>{p}</div>
            ))}
          </div>
        </div>
        <div style={{ padding: '8px 12px' }}>
          <input className="input search" placeholder="Find player" value={boardSearch} onChange={e => setBoardSearch(e.target.value)} style={{ width: '100%' }} />
        </div>
        <div style={{ flex: 1, overflow: 'auto' }}>
          <table className="data-table" style={{ fontSize: 12 }}>
            <thead>
              <tr><th>#</th><th>Player</th><th className="num">Tier</th><th className="num">ADP</th><th></th></tr>
            </thead>
            <tbody>
              {bestAvail.slice(0, 60).map((p) => {
                const inQueue = queue.includes(p.id);
                return (
                  <tr key={p.id}>
                    <td className="rank">{p.ecr}</td>
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
                    <td className="num faint" style={{ fontSize: 11 }}>{p.adp.toFixed(1)}</td>
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
            return (
              <div className="queue-item" key={id}>
                <span className="grip">≡</span>
                <span className="num">{i + 1}</span>
                <PlayerAvatar player={p} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="player-name" style={{ fontSize: 12 }}>{p.name}</div>
                  <div className="player-meta"><PosBadge pos={p.pos} /> {p.team} · ECR #{p.ecr}</div>
                </div>
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
            const p = findPlayer(pk.playerId);
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
        <div style={{ padding: '10px 14px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center' }}>
          <div className="ai-orb" style={{ width: 18, height: 18, background: 'var(--accent)', boxShadow: '0 0 8px var(--accent)' }}></div>
          <div className="card-title" style={{ flex: 1, marginLeft: 10 }}>Armed Rodgery</div>
          <div className="mono faint" style={{ fontSize: 11 }}>{myPicks.length}/16</div>
        </div>
        <div style={{ padding: '6px 0', maxHeight: '50%', overflow: 'auto' }}>
          {rosterSlots.map((rs, i) => {
            const myPicksOfPos = myPicks.filter(pk => findPlayer(pk.playerId)?.pos === rs.slot);
            const fillIdx = rosterSlots.slice(0, i).filter(x => x.slot === rs.slot).length;
            const filled = myPicksOfPos[fillIdx];
            const player = filled ? findPlayer(filled.playerId) : null;
            return (
              <div key={i} style={{ padding: '4px 14px', display: 'flex', alignItems: 'center', gap: 10, fontSize: 12, borderBottom: '1px solid var(--border)', minHeight: 40 }}>
                <span className={`pos-badge pos-${rs.slot}`} style={{ minWidth: 36 }}>{rs.slot}</span>
                {player ? (
                  <React.Fragment>
                    <PlayerAvatar player={player} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div className="player-name" style={{ fontSize: 12 }}>{player.name}</div>
                      <div className="player-meta">{player.team} · ECR #{player.ecr}</div>
                    </div>
                    <div className="mono faint" style={{ fontSize: 11 }}>R{filled.round}.{filled.slot}</div>
                  </React.Fragment>
                ) : (
                  <div className="faint" style={{ fontSize: 11, flex: 1 }}>empty</div>
                )}
              </div>
            );
          })}
        </div>

        <div style={{ borderTop: '1px solid var(--border)', display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden' }}>
          <div style={{ padding: '10px 14px', borderBottom: '1px solid var(--border)' }}>
            <div className="card-title">League Chat</div>
          </div>
          <div style={{ flex: 1, overflow: 'auto', padding: '8px 0' }}>
            {CHAT_MESSAGES.map((m, i) => (
              <div key={i} className="chat-msg" style={m.ai ? { borderLeft: '2px solid var(--accent)', background: 'rgba(198,255,58,.04)' } : {}}>
                <span className="ts">{m.ts}</span>
                <span className="who" style={{ color: m.color }}>{m.who}</span>
                <span>{m.msg}</span>
              </div>
            ))}
          </div>
          <div style={{ padding: 8, borderTop: '1px solid var(--border)' }}>
            <input className="input" placeholder="Type to chat..." style={{ width: '100%', fontSize: 12 }} />
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
                  <span className="pts">{Math.round(teamPicks.filter(p => p.playerId).reduce((s, p) => s + (findPlayer(p.playerId)?.avg || 0), 0))}</span>
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
                  const p = findPlayer(pk.playerId);
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
