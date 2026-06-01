import React from 'react';
import { findPlayer, findTeam, MY_ROSTER, TEAM_ROSTERS, PLAYERS, LEAGUE_TEAMS, FREE_DATA_SOURCES, RANKING_SOURCES, buildRosterFrame, assignRoster } from './lib/data.js';
import { api } from './api.js';
import { applyLeagueData, clearLeagueData } from './lib/leagueStore.js';
import { Sidebar, TopBar, MobileNav } from './components/layout.jsx';
import AICopilot from './components/AICopilot.jsx';
import { TweaksPanel, TweakSection, TweakColor, TweakRadio, TweakToggle, useTweaks } from './components/TweaksPanel.jsx';

import Login from './screens/Login.jsx';
import ChangePassword, { ResetPasswordScreen } from './screens/ChangePassword.jsx';
import Dashboard from './screens/Dashboard.jsx';
import PlayersScreen, { PlayerDetail } from './screens/Players.jsx';
import NewsScreen from './screens/News.jsx';
import CompareScreen from './screens/Compare.jsx';
import WatchlistScreen from './screens/Watchlist.jsx';
import TradeScreen from './screens/Trade.jsx';
import DraftRoom from './screens/DraftRoom.jsx';
import OwnerIntelScreen from './screens/OwnerIntel.jsx';
import { PlayerDraftRankingsScreen } from './components/CBSConnectModal.jsx';
import SourcesScreen from './screens/Sources.jsx';
import AdminOwners from './screens/AdminOwners.jsx';
import ScoringTestScreen from './screens/ScoringTest.jsx';
import LeagueSettings from './screens/LeagueSettings.jsx';
import CurrentRosterScreen from './screens/CurrentRoster.jsx';
import WaiversScreen from './screens/Waivers.jsx';
import HeadToHeadScreen from './screens/HeadToHead.jsx';
import AccountEditScreen from './screens/AccountEdit.jsx';
import LineupDecisions from './screens/LineupDecisions.jsx';
import TransactionsScreen from './screens/Transactions.jsx';

function loadLeagueSettings() {
  try { return JSON.parse(localStorage.getItem('fantasai_league_settings') || 'null') || null; } catch { return null; }
}

const API_BASE = 'https://api.fantasai.net';

async function fetchS3Roster(teamId) {
  try {
    const res = await Promise.race([
      fetch(`${API_BASE}/api/v1/rosters/load?teamId=${teamId}`),
      new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 4000)),
    ]);
    if (!res.ok) return null;
    const data = await res.json();
    if (!data.fromS3 || data.playerIds === null) return null;
    return data.playerIds.map(Number);
  } catch { return null; }
}

async function loadLeagueData(leagueId) {
  const cacheKey = `fantasai_league_data_${leagueId}`;

  // Seed file on first run (fast, local — gitignored so never stale from code changes)
  if (!localStorage.getItem(cacheKey)) {
    try {
      const r = await Promise.race([
        fetch('/league-seed.json'),
        new Promise((_, rej) => setTimeout(() => rej('timeout'), 2000)),
      ]);
      if (r.ok) {
        const seed = await r.json();
        const payload = { ...seed, leagueId };
        applyLeagueData(payload);
        localStorage.setItem(cacheKey, JSON.stringify(payload));
      }
    } catch {}
  }

  // S3 is always authoritative — overrides seed and cache
  try {
    const res = await Promise.race([
      fetch(`${API_BASE}/api/v1/league-settings?leagueId=${leagueId}`),
      new Promise((_, rej) => setTimeout(() => rej('timeout'), 5000)),
    ]);
    if (!res.ok) return;
    const data = await res.json();
    if (data.fromS3) {
      const payload = { leagueId, teams: data.teams ?? null, settings: data.settings ?? null, savedAt: data.savedAt ?? null };
      applyLeagueData(payload);
      localStorage.setItem(cacheKey, JSON.stringify(payload));
    }
  } catch {}
}

async function syncRosterToS3(teamId, playerIds) {
  try {
    const res = await fetch(`${API_BASE}/api/v1/rosters/save`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ teamId: String(teamId), playerIds: [...playerIds] }),
    });
    return res.ok;
  } catch { return false; }
}

function validateRosterAdd(playerId, currentIds) {
  const settings  = loadLeagueSettings();
  const player    = PLAYERS.find(p => p.id === playerId);
  if (!player) return null;

  const totalMax  = settings?.roster?.totalPlayers?.max ?? 14;
  const positions = settings?.positions ?? [
    { key: 'QB', rosterTotal: '2' },
    { key: 'RB', rosterTotal: 'No Limit' },
    { key: 'WR', rosterTotal: 'No Limit' },
    { key: 'TE', rosterTotal: 'No Limit' },
    { key: 'K',  rosterTotal: 'No Limit' },
    { key: 'DST',rosterTotal: 'No Limit' },
  ];

  if (currentIds.size >= totalMax) {
    return {
      title: 'Invalid Roster Request',
      detail: `Your roster is full (${currentIds.size}/${totalMax} players). Drop a player first or see Rules & Settings.`,
    };
  }

  const posEntry = positions.find(p => p.key === player.pos);
  if (posEntry) {
    const limitStr = posEntry.rosterTotal;
    const limitNum = limitStr === 'No Limit' ? Infinity : parseInt(limitStr, 10);
    if (!isNaN(limitNum) && isFinite(limitNum)) {
      const currentOfPos = [...currentIds].filter(id => PLAYERS.find(p => p.id === id)?.pos === player.pos).length;
      if (currentOfPos >= limitNum) {
        return {
          title: 'Invalid Roster Request',
          detail: `You already have ${currentOfPos} ${player.pos}${currentOfPos !== 1 ? 's' : ''} — the limit is ${limitNum}. See Rules & Settings.`,
        };
      }
    }
  }
  return null;
}

const TWEAK_DEFAULTS = {
  accent: '#c6ff3a',
  density: 'default',
  aiMode: 'copilot',
  showMobile: false,
  showChat: false,
};

const ACCENT_INK = {
  '#c6ff3a': '#0a1300',
  '#ff5a6e': '#1a0405',
  '#4ea8ff': '#02132a',
  '#ffb547': '#1a0d00',
};

const CRUMBS = {
  dashboard: ['League', 'Dashboard'],
  players:   ['League', 'Players'],
  news:      ['League', 'Player News'],
  roster:    ['League', 'Current Roster'],
  lineup:    ['League', 'Lineup Decisions'],
  waivers:   ['League', 'Waivers'],
  h2h:          ['League', 'Head to Head'],
  transactions: ['League', 'Transactions'],
  compare:   ['Tools', 'Compare'],
  watchlist: ['Tools', 'Watchlist'],
  trade:     ['Tools', 'Trade Analyzer'],
  draft:     ['Draft', 'Live Draft Room'],
  owners:    ['Draft', 'Owner Intel · Draft DNA'],
  cbs:       ['Draft', 'Player Draft Rankings'],
  sources:       ['Setup', 'Sources & Connections'],
  'admin-owners':   ['Admin', 'Owner Management'],
  'admin-scoring':  ['Admin', 'Scoring System Test'],
  settings:         ['Setup', 'Rules & League Settings'],
};

export default function App() {
  const [tweaks, setTweak] = useTweaks(TWEAK_DEFAULTS);

  // Auto-detect mobile device. Matches the CSS breakpoint so JS state always
  // agrees with the media query that hides the sidebar and shows MobileNav.
  const [isMobileDevice, setIsMobileDevice] = React.useState(
    () => window.matchMedia('(max-width: 900px)').matches
  );
  React.useEffect(() => {
    const mq = window.matchMedia('(max-width: 900px)');
    const handler = e => setIsMobileDevice(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);
  // Merge: either the manual desktop-preview toggle or an actual mobile device.
  const showMobile = tweaks.showMobile || isMobileDevice;

  const [active, setActive] = React.useState('dashboard');
  const [openPlayer, setOpenPlayer] = React.useState(null);
  const [user, setUser] = React.useState(() => {
    try { return JSON.parse(localStorage.getItem('fantasai_user') || 'null'); } catch { return null; }
  });
  const [myRosterIds, setMyRosterIds] = React.useState(() => new Set());
  const [rosterLoading, setRosterLoading] = React.useState(true);

  // Stable ref so callbacks don't need user in their dep array
  const userRef = React.useRef(user);
  React.useEffect(() => { userRef.current = user; }, [user]);

  const [rosterSlotOverrides, setRosterSlotOverrides] = React.useState(() => {
    try { return JSON.parse(localStorage.getItem('fantasai_slot_overrides') || '{}'); } catch { return {}; }
  });
  function handleSlotOverridesChange(overrides) {
    setRosterSlotOverrides(overrides);
    localStorage.setItem('fantasai_slot_overrides', JSON.stringify(overrides));
  }

  // Count starters with injury/questionable status — drives the sidebar badge on Lineup Decisions
  const lineupAlertCount = React.useMemo(() => {
    const settings  = loadLeagueSettings();
    const slotFrame = buildRosterFrame(settings);
    const starters  = assignRoster(slotFrame, myRosterIds, rosterSlotOverrides)
      .filter(e => e.slot !== 'BENCH' && e.playerId);
    return starters.filter(e => {
      const p = findPlayer(e.playerId);
      return p && p.status && p.status !== 'OK';
    }).length;
  }, [myRosterIds, rosterSlotOverrides]);

  const [needsPasswordChange, setNeedsPasswordChange] = React.useState(false);
  const [resetToken, setResetToken] = React.useState(() => {
    return new URLSearchParams(window.location.search).get('reset') || null;
  });

  function handleLogin(u) {
    localStorage.setItem('fantasai_user', JSON.stringify(u));
    setUser(u);
    userRef.current = u;
    loadLeagueData(u.leagueId || 'tau');
    setMyRosterIds(new Set());
    setRosterSlotOverrides({});
    localStorage.removeItem('fantasai_slot_overrides');
    if (u.needsPasswordChange) setNeedsPasswordChange(true);
    if (u.teamId) {
      setRosterLoading(true);
      fetchS3Roster(u.teamId).then(s3Ids => {
        setMyRosterIds(new Set(s3Ids ?? []));
        setRosterLoading(false);
      });
    } else {
      setRosterLoading(false);
    }
  }

  // Keep browser tab title in sync with the logged-in league name
  React.useEffect(() => {
    try {
      const s = JSON.parse(localStorage.getItem('fantasai_league_settings') || 'null');
      const leagueName = s?.leagueName?.trim() || null;
      document.title = leagueName ? `FantasAI — ${leagueName}` : 'FantasAI';
    } catch {
      document.title = 'FantasAI';
    }
  }, [user]);

  // On cold load (already logged in): restore league data from cache, then fetch fresh
  React.useEffect(() => {
    const leagueId = user?.leagueId || 'tau';
    try {
      const cached = JSON.parse(localStorage.getItem(`fantasai_league_data_${leagueId}`) || 'null');
      if (cached) applyLeagueData(cached);
    } catch {}
    loadLeagueData(leagueId);

    if (!user?.teamId) { setRosterLoading(false); return; }
    setRosterLoading(true);
    fetchS3Roster(user.teamId).then(s3Ids => {
      setMyRosterIds(new Set(s3Ids ?? []));
      setRosterLoading(false);
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // intentionally runs only once on mount

  function handlePasswordChanged() {
    setNeedsPasswordChange(false);
  }

  function handleLogout() {
    localStorage.removeItem('fantasai_user');
    localStorage.removeItem('fantasai_slot_overrides');
    setUser(null);
    setMyRosterIds(new Set());
    setRosterLoading(false);
    setRosterSlotOverrides({});
    clearLeagueData();
  }

  // Admin / Commissioner: reset all rosters on S3 and clear local state
  const [rosterResetState, setRosterResetState] = React.useState('idle'); // idle | loading | done | error
  async function handleRosterReset() {
    setRosterResetState('loading');
    try {
      const res = await fetch(`${API_BASE}/api/v1/rosters/reset`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    '{}',
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      // Clear local roster for whoever is looking
      setMyRosterIds(new Set());
      setRosterResetState('done');
      setTimeout(() => setRosterResetState('idle'), 4000);
    } catch {
      setRosterResetState('error');
      setTimeout(() => setRosterResetState('idle'), 4000);
    }
  }

  const [rosterError, setRosterError] = React.useState(null);
  const [rosterSyncBadge, setRosterSyncBadge] = React.useState(null); // null | 'saving' | 'saved' | 'error'
  const syncTimerRef = React.useRef(null);
  function doSync(teamId, ids) {
    if (syncTimerRef.current) clearTimeout(syncTimerRef.current);
    setRosterSyncBadge('saving');
    syncRosterToS3(teamId, ids).then(ok => {
      setRosterSyncBadge(ok ? 'saved' : 'error');
      syncTimerRef.current = setTimeout(() => setRosterSyncBadge(null), 3000);
    });
  }

  const [tradeInit, setTradeInit] = React.useState({ key: 0, otherTeamId: null, getIds: [] });
  const handleTradePlayer = React.useCallback((playerId, ownerTeamId) => {
    setTradeInit(prev => ({ key: prev.key + 1, otherTeamId: ownerTeamId, getIds: [playerId] }));
    setActive('trade');
  }, []);

  const handleAddPlayer = React.useCallback(id => {
    let nextIds = null;
    setMyRosterIds(prev => {
      const err = validateRosterAdd(id, prev);
      if (err) { setRosterError(err); return prev; }
      nextIds = new Set([...prev, id]);
      return nextIds;
    });
    if (nextIds && userRef.current?.teamId) {
      doSync(userRef.current.teamId, nextIds);
      const p = findPlayer(id);
      if (p) api.transactions.log({
        id: `${Date.now()}-add-${id}`,
        type: 'add',
        timestamp: new Date().toISOString(),
        teamId:   userRef.current.teamId,
        teamName: userRef.current.teamName || userRef.current.teamId,
        players:  [{ id, name: p.name, pos: p.pos, nflTeam: p.team, action: 'add' }],
      });
    }
  }, []);
  const [waiverQueue, setWaiverQueue] = React.useState(() => {
    try {
      const raw = JSON.parse(localStorage.getItem('fantasai_waivers') || '{}');
      const now = Date.now();
      // Drop expired entries on load
      return Object.fromEntries(Object.entries(raw).filter(([, v]) => new Date(v.expiresAt).getTime() > now));
    } catch { return {}; }
  });

  const [tradeOffers, setTradeOffers] = React.useState(() => {
    try { return JSON.parse(localStorage.getItem('fantasai_trade_offers') || '[]'); } catch { return []; }
  });

  function handleSendTradeOffer({ fromTeamId, toTeamId, giveIds, getIds }) {
    const offer = { id: Date.now(), fromTeamId, toTeamId, giveIds, getIds, sentAt: new Date().toISOString(), status: 'pending' };
    setTradeOffers(prev => {
      const next = [...prev, offer];
      localStorage.setItem('fantasai_trade_offers', JSON.stringify(next));
      return next;
    });
    // Log as pending trade — will be superseded by the accept log if accepted
    const myTeam = findTeam(fromTeamId);
    const theirTeam = findTeam(toTeamId);
    api.transactions.log({
      id: `${Date.now()}-trade-offer-${fromTeamId}`,
      type: 'trade_offer',
      timestamp: new Date().toISOString(),
      teamId:      fromTeamId,
      teamName:    myTeam?.name || fromTeamId,
      otherTeamId: toTeamId,
      otherTeamName: theirTeam?.name || toTeamId,
      gave: giveIds.map(id => { const p = findPlayer(id); return p ? { id, name: p.name, pos: p.pos, nflTeam: p.team } : { id }; }),
      got:  getIds.map(id  => { const p = findPlayer(id); return p ? { id, name: p.name, pos: p.pos, nflTeam: p.team } : { id }; }),
    });
  }

  function handleDeleteTradeOffer(offerId) {
    setTradeOffers(prev => {
      const next = prev.filter(o => o.id !== offerId);
      localStorage.setItem('fantasai_trade_offers', JSON.stringify(next));
      return next;
    });
  }

  function handleRespondTradeOffer(offerId, response, comment = '') {
    const offer = tradeOffers.find(o => o.id === offerId);
    if (offer && response === 'accepted') {
      let nextIds = null;
      setMyRosterIds(prev => {
        const next = new Set(prev);
        offer.getIds.forEach(id => next.delete(id));
        offer.giveIds.forEach(id => next.add(id));
        nextIds = next;
        return next;
      });
      if (nextIds && userRef.current?.teamId) doSync(userRef.current.teamId, nextIds);
      const myTeam    = findTeam(offer.toTeamId);
      const theirTeam = findTeam(offer.fromTeamId);
      api.transactions.log({
        id: `${Date.now()}-trade-${offerId}`,
        type: 'trade',
        timestamp: new Date().toISOString(),
        teamId:       offer.toTeamId,
        teamName:     myTeam?.name    || offer.toTeamId,
        otherTeamId:  offer.fromTeamId,
        otherTeamName: theirTeam?.name || offer.fromTeamId,
        gave: offer.getIds.map(id  => { const p = findPlayer(id); return p ? { id, name: p.name, pos: p.pos, nflTeam: p.team } : { id }; }),
        got:  offer.giveIds.map(id => { const p = findPlayer(id); return p ? { id, name: p.name, pos: p.pos, nflTeam: p.team } : { id }; }),
      });
    }
    setTradeOffers(prev => {
      const patch = { status: response };
      if (comment) patch.responseComment = comment;
      const next = prev.map(o => o.id === offerId ? { ...o, ...patch } : o);
      localStorage.setItem('fantasai_trade_offers', JSON.stringify(next));
      return next;
    });
  }

  const handleDropPlayer = React.useCallback(id => {
    let nextIds = null;
    setMyRosterIds(prev => {
      const n = new Set(prev);
      n.delete(id);
      nextIds = n;
      return n;
    });
    if (nextIds && userRef.current?.teamId) {
      doSync(userRef.current.teamId, nextIds);
      const p = findPlayer(id);
      if (p) api.transactions.log({
        id: `${Date.now()}-drop-${id}`,
        type: 'drop',
        timestamp: new Date().toISOString(),
        teamId:   userRef.current.teamId,
        teamName: userRef.current.teamName || userRef.current.teamId,
        players:  [{ id, name: p.name, pos: p.pos, nflTeam: p.team, action: 'drop' }],
      });
    }
    // Place player on waivers: minimum 1 day, then the next Wed/Thu/Fri/Sat at 11:59 PM
    const drop = new Date();
    const earliest = new Date(drop.getTime() + 24 * 60 * 60 * 1000);
    earliest.setHours(23, 59, 0, 0);
    const waiver_days = new Set([3, 4, 5, 6]); // Wed Thu Fri Sat
    while (!waiver_days.has(earliest.getDay())) earliest.setDate(earliest.getDate() + 1);
    const entry = { droppedAt: drop.toISOString(), expiresAt: earliest.toISOString(), teamId: userRef.current?.teamId };
    setWaiverQueue(prev => {
      const next = { ...prev, [id]: entry };
      localStorage.setItem('fantasai_waivers', JSON.stringify(next));
      return next;
    });
  }, []);

  const [watchlistIds, setWatchlistIds] = React.useState(() => {
    try { return new Set(JSON.parse(localStorage.getItem('fantasai_watchlist') || '[]')); } catch { return new Set(); }
  });
  const handleToggleWatch = React.useCallback(id => {
    setWatchlistIds(prev => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id); else n.add(id);
      localStorage.setItem('fantasai_watchlist', JSON.stringify([...n]));
      return n;
    });
  }, []);

  const [sourcesState, setSourcesState] = React.useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem('fantasai_sources') || 'null');
      if (saved?.freeApis && saved?.feeds) return saved;
    } catch {}
    return {
      freeApis: Object.fromEntries(FREE_DATA_SOURCES.map(s => [s.id, s.enabled])),
      feeds: Object.fromEntries(RANKING_SOURCES.map(s => [s.id, { enabled: s.enabled, weight: s.weight }])),
    };
  });
  function handleSourcesChange(next) {
    setSourcesState(next);
    localStorage.setItem('fantasai_sources', JSON.stringify(next));
  }

  function handleExport() {
    let rows = [];
    let filename = 'fantasai-export.csv';

    if (active === 'players' || active === 'waivers') {
      filename = `fantasai-players.csv`;
      rows = [
        ['Name','Pos','Team','Proj','Last','Avg','Owned%','ADP','ECR','Status'],
        ...PLAYERS.map(p => [p.name, p.pos, p.team, p.proj, p.last, p.avg, p.owned, p.adp, p.ecr, p.status]),
      ];
    } else if (active === 'roster') {
      filename = `fantasai-roster.csv`;
      const roster = TEAM_ROSTERS[user?.teamId || 1] || [];
      rows = [
        ['Slot','Name','Pos','Team','Proj','Last','Avg','Status'],
        ...roster.map(r => {
          const p = r.playerId ? findPlayer(r.playerId) : null;
          return [r.slot, p?.name || '—', p?.pos || '—', p?.team || '—', p?.proj || 0, p?.last || 0, p?.avg || 0, p?.status || '—'];
        }),
      ];
    } else if (active === 'dashboard') {
      filename = `fantasai-standings.csv`;
      rows = [
        ['Team','Record','PF','PA'],
        ...LEAGUE_TEAMS.map(t => [t.name, t.record, t.pf, t.pa]),
      ];
    } else {
      filename = `fantasai-${active}.csv`;
      rows = [['FantasAI export'], [`Screen: ${active}`], [`Exported: ${new Date().toISOString()}`]];
    }

    const csv = rows.map(r => r.map(v => `"${String(v).replace(/"/g,'""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename; a.click();
    URL.revokeObjectURL(url);
  }

  React.useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty('--accent', tweaks.accent);
    root.style.setProperty('--accent-ink', ACCENT_INK[tweaks.accent] || '#000');
    root.setAttribute('data-density', tweaks.density);
  }, [tweaks.accent, tweaks.density]);

  const aiMode = tweaks.aiMode;
  const showAI = tweaks.showChat;
  const shellClass = `shell ${showAI ? 'has-ai' : ''} ${showMobile ? 'mobile-mode' : ''}`;
  const playerObj = openPlayer ? findPlayer(openPlayer) : null;

  if (resetToken) return (
    <ResetPasswordScreen token={resetToken} onDone={() => {
      setResetToken(null);
      window.history.replaceState({}, '', window.location.pathname);
    }} />
  );
  if (!user) return <Login onLogin={handleLogin} />;
  if (needsPasswordChange) return <ChangePassword user={user} onDone={handlePasswordChanged} />;

  return (
    <React.Fragment>
      <div className={shellClass} style={tweaks.showMobile && !isMobileDevice ? { maxWidth: 414, margin: '0 auto', boxShadow: '0 0 60px rgba(0,0,0,.6)' } : {}}>
        <div className="logo-area">
          <span className="logo-dot"></span>
          <span className="logo">FANTAS<span className="ai-mark">AI</span></span>
        </div>
        <TopBar
          crumbs={CRUMBS[active] || ['FantasAI']}
          showMobile={showMobile}
          onToggleView={v => setTweak('showMobile', v)}
          showChat={tweaks.showChat}
          onToggleChat={() => setTweak('showChat', !tweaks.showChat)}
          user={user}
          onLogout={handleLogout}
          onExport={handleExport}
          right={
            <div className="flex gap-8 hide-mobile">
              <button className="btn ghost sm" onClick={() => setActive('roster')}>+ Add / Drop</button>
              <button className="btn ghost sm" onClick={() => setActive('trade')}>↔ Trades</button>
              <button className="btn ghost sm" onClick={() => setActive('waivers')}>⏰ Waivers</button>
            </div>
          }
        />
        <Sidebar active={active} onNav={setActive} user={user} lineupAlertCount={lineupAlertCount} myRosterIds={myRosterIds} />

        <div className="main">
          {active === 'dashboard' && <Dashboard onNav={setActive} onOpenPlayer={setOpenPlayer} user={user} myRosterIds={myRosterIds} sourcesState={sourcesState} slotOverrides={rosterSlotOverrides} watchlistIds={watchlistIds} tradeOffers={tradeOffers} />}
          {active === 'players'   && <PlayersScreen onOpenPlayer={setOpenPlayer} aiMode={aiMode} myRosterIds={myRosterIds} onAddPlayer={handleAddPlayer} onTradePlayer={handleTradePlayer} user={user} watchlistIds={watchlistIds} onToggleWatch={handleToggleWatch} waiverQueue={waiverQueue} />}
          {active === 'news'      && <NewsScreen onOpenPlayer={setOpenPlayer} sourcesState={sourcesState} user={user} />}
          {active === 'roster'    && <CurrentRosterScreen onNav={setActive} user={user} myRosterIds={myRosterIds} onAddPlayer={handleAddPlayer} onDropPlayer={handleDropPlayer} onOpenPlayer={setOpenPlayer} watchlistIds={watchlistIds} onToggleWatch={handleToggleWatch} sourcesState={sourcesState} slotOverrides={rosterSlotOverrides} onSlotOverridesChange={handleSlotOverridesChange} tradeOffers={tradeOffers} onRespondTradeOffer={handleRespondTradeOffer} rosterSyncBadge={rosterSyncBadge} rosterLoading={rosterLoading} />}
          {active === 'lineup'    && <LineupDecisions myRosterIds={myRosterIds} slotOverrides={rosterSlotOverrides} onSlotOverridesChange={handleSlotOverridesChange} onOpenPlayer={setOpenPlayer} />}
          {active === 'waivers'   && <WaiversScreen user={user} myRosterIds={myRosterIds} onAddPlayer={handleAddPlayer} onDropPlayer={handleDropPlayer} onOpenPlayer={setOpenPlayer} sourcesState={sourcesState} />}
          {active === 'h2h'       && <HeadToHeadScreen onOpenPlayer={setOpenPlayer} user={user} myRosterIds={myRosterIds} slotOverrides={rosterSlotOverrides} />}
          {active === 'compare'   && <CompareScreen />}
          {active === 'watchlist' && <WatchlistScreen onOpenPlayer={setOpenPlayer} />}
          {active === 'trade'     && <TradeScreen key={tradeInit.key} initOtherTeamId={tradeInit.otherTeamId} initGetIds={tradeInit.getIds} myRosterIds={myRosterIds} user={user} onSendTradeOffer={handleSendTradeOffer} tradeOffers={tradeOffers} onRespondTradeOffer={handleRespondTradeOffer} onDeleteTradeOffer={handleDeleteTradeOffer} />}
          {active === 'draft'     && <DraftRoom aiMode={aiMode} user={user} onNav={setActive} onDraftPick={id => {
            let nextIds = null;
            setMyRosterIds(prev => {
              const next = new Set([...prev, id]);
              nextIds = next;
              return next;
            });
            if (nextIds && userRef.current?.teamId) doSync(userRef.current.teamId, nextIds);
          }} />}
          {active === 'owners'    && <OwnerIntelScreen onOpenPlayer={setOpenPlayer} user={user} myRosterIds={myRosterIds} slotOverrides={rosterSlotOverrides} />}
          {active === 'cbs'       && <PlayerDraftRankingsScreen onOpenPlayer={setOpenPlayer} />}
          {active === 'sources'       && <SourcesScreen onNav={setActive} sourcesState={sourcesState} onSourcesChange={handleSourcesChange} user={user} myRosterIds={myRosterIds} />}
          {active === 'admin-owners'  && <AdminOwners />}
          {active === 'admin-scoring'  && <ScoringTestScreen user={user} />}
          {active === 'transactions'  && <TransactionsScreen />}
          {active === 'account'       && <AccountEditScreen user={user} />}
          {active === 'settings'      && <LeagueSettings user={user} onRosterReset={handleRosterReset} rosterResetState={rosterResetState} />}
        </div>

        {showAI && <AICopilot active={active} aiMode={aiMode} user={user} myRosterIds={myRosterIds} />}
        <MobileNav active={active} onNav={setActive} user={user} lineupAlertCount={lineupAlertCount} />
      </div>

      {playerObj && <PlayerDetail player={playerObj} onClose={() => setOpenPlayer(null)} myRosterIds={myRosterIds} onAddPlayer={handleAddPlayer} sourcesState={sourcesState} />}

      {rosterError && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,.6)', backdropFilter: 'blur(4px)' }}
          onClick={() => setRosterError(null)}>
          <div style={{ background: 'var(--card)', border: '1px solid #ff5a6e', borderRadius: 14, padding: '28px 32px', maxWidth: 400, width: '90%', boxShadow: '0 24px 60px rgba(0,0,0,.5)' }}
            onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
              <span style={{ fontSize: 22 }}>🚫</span>
              <div style={{ fontSize: 15, fontWeight: 800, color: '#ff5a6e' }}>{rosterError.title}</div>
            </div>
            <div style={{ fontSize: 13, color: 'var(--text-dim)', lineHeight: 1.65, marginBottom: 20 }}>{rosterError.detail}</div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn ghost sm" onClick={() => { setRosterError(null); setActive('settings'); }}>
                View Rules & Settings
              </button>
              <button className="btn primary sm" onClick={() => setRosterError(null)}>OK</button>
            </div>
          </div>
        </div>
      )}

      {rosterSyncBadge && (
        <div style={{ position: 'fixed', bottom: 80, right: 20, zIndex: 9998, display: 'flex', alignItems: 'center', gap: 8,
          background: 'var(--card)',
          border: `1px solid ${rosterSyncBadge === 'saving' ? '#555' : rosterSyncBadge === 'saved' ? '#c6ff3a' : '#ff5a6e'}`,
          borderRadius: 10, padding: '8px 14px', fontSize: 13, boxShadow: '0 8px 24px rgba(0,0,0,.4)',
          transition: 'border-color 0.2s' }}>
          <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%',
            background: rosterSyncBadge === 'saving' ? '#888' : rosterSyncBadge === 'saved' ? '#c6ff3a' : '#ff5a6e' }} />
          {rosterSyncBadge === 'saving' && 'Saving roster…'}
          {rosterSyncBadge === 'saved'  && 'Roster saved'}
          {rosterSyncBadge === 'error'  && 'Roster save failed'}
        </div>
      )}

      <TweaksPanel title="Tweaks">
        <TweakSection label="Brand Accent">
          <TweakColor value={tweaks.accent} onChange={v => setTweak('accent', v)} options={['#c6ff3a', '#4ea8ff', '#ff5a6e', '#ffb547']} />
        </TweakSection>
        <TweakSection label="AI Prominence">
          <TweakRadio value={tweaks.aiMode} onChange={v => setTweak('aiMode', v)} options={[
            { value: 'subtle', label: 'Subtle' },
            { value: 'copilot', label: 'Co-Pilot' },
            { value: 'centerpiece', label: 'Centerpiece' },
          ]} />
          <div className="dim" style={{ fontSize: 11, marginTop: 6, padding: '0 4px' }}>
            {aiMode === 'subtle' && 'Inline ◆ hints on player rows only.'}
            {aiMode === 'copilot' && 'Persistent sidebar comments on every screen.'}
            {aiMode === 'centerpiece' && 'AI proposes picks/lineups; you confirm.'}
          </div>
        </TweakSection>
        <TweakSection label="Density">
          <TweakRadio value={tweaks.density} onChange={v => setTweak('density', v)} options={[
            { value: 'compact', label: 'Compact' },
            { value: 'default', label: 'Default' },
            { value: 'comfy', label: 'Comfy' },
          ]} />
        </TweakSection>
        <TweakSection label="Form Factor">
          <TweakToggle label="Mobile preview frame" value={tweaks.showMobile} onChange={v => setTweak('showMobile', v)} />
        </TweakSection>
      </TweaksPanel>
    </React.Fragment>
  );
}
