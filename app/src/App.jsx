import React from 'react';
import { findTeam, MY_ROSTER, TEAM_ROSTERS, LEAGUE_TEAMS, TEAMS_ORDER, FREE_DATA_SOURCES, RANKING_SOURCES, buildRosterFrame, assignRoster, refreshTeamRosters, clearAllRosters } from './lib/data.js';
import { findPlayer, getPlayers, setPlayers, patchPlayers, normalizePlayerList, BYE_WEEKS_2026 } from './lib/playerStore.js';
import { api } from './api.js';
import { getPlayerMap, fetchBulkProjections } from './lib/sleeper.js';
import { registerServiceWorker, getSubscriptionState, requestNotificationPermission, showLocalNotification } from './lib/pushNotifications.js';
import { applyLeagueData, clearLeagueData, getScoringFormat } from './lib/leagueStore.js';
import { loadUserPrefs, patchPrefs, getPrefs, clearPrefs } from './lib/remotePrefs.js';
import { loadRemoteState, getTradeOffers, getWaivers, saveTradeOffers, saveWaivers, clearRemoteState } from './lib/remoteState.js';
import { Sidebar, TopBar, MobileNav } from './components/layout.jsx';
import AICopilot from './components/AICopilot.jsx';
import { TweaksPanel, TweakSection, TweakColor, TweakRadio, TweakToggle, useTweaks } from './components/TweaksPanel.jsx';

import Login from './screens/Login.jsx';
import ChangePassword, { ResetPasswordScreen } from './screens/ChangePassword.jsx';
import Dashboard from './screens/Dashboard.jsx';
import PlayersScreen, { PlayerDetail } from './screens/Players.jsx';
import NewsScreen from './screens/News.jsx';
import CompareScreen from './screens/Compare.jsx';
import TradeScreen from './screens/Trade.jsx';
import DraftRoom from './screens/DraftRoom.jsx';
import OwnerIntelScreen from './screens/OwnerIntel.jsx';
import { PlayerDraftRankingsScreen } from './components/CBSConnectModal.jsx';
import SourcesScreen from './screens/Sources.jsx';
import AdminOwners from './screens/AdminOwners.jsx';
import ScoringTestScreen from './screens/ScoringTest.jsx';
import LeagueSettings from './screens/LeagueSettings.jsx';
import CurrentRosterScreen from './screens/CurrentRoster.jsx';
import HeadToHeadScreen from './screens/HeadToHead.jsx';
import AccountEditScreen from './screens/AccountEdit.jsx';
import TransactionsScreen from './screens/Transactions.jsx';
import PowerRankingsScreen from './screens/PowerRankings.jsx';
import DraftRecapScreen from './screens/DraftRecap.jsx';

// DST positional rank (1-32) → overall draft rank (~120-244).
// Keeps defenses in the correct draft range instead of competing with top picks.
const dstOverallRank = (posRank) => 150 + (posRank - 1) * 3;
const stripSuffix = (n) => (n || '').toLowerCase().trim().replace(/\s+(jr\.?|sr\.?|ii|iii|iv|v)$/i, '').trim();

// ── Live Score Ticker ─────────────────────────────────────────────────────────
const TICKER_SEASON_START = new Date('2026-09-09');

function tickerSimScore(teamId, week) {
  const roster   = TEAM_ROSTERS[teamId] || [];
  const starters = roster.filter(r => r.slot !== 'BENCH' && r.playerId);
  const base = starters.reduce((s, e) => s + (findPlayer(e.playerId)?.avg || 0), 0);
  const noise = Math.sin(teamId * 11.3 + week * 7.1) * 12 + Math.cos(teamId * 3.7 + week * 2.9) * 6;
  return Math.max(0, Math.round((base + noise) * 10) / 10);
}

function buildTickerSchedule(ids, weeks) {
  const n = ids.length;
  return Array.from({ length: weeks }, (_, w) => {
    const rest   = ids.slice(1);
    const rot    = w % (n - 1);
    const circle = [ids[0], ...[...rest.slice(rot), ...rest.slice(0, rot)]];
    return Array.from({ length: n / 2 }, (_, i) => [circle[i], circle[n - 1 - i]]);
  });
}

function LiveScoreTicker({ myTeamId, onNav }) {
  const [visible, setVisible] = React.useState(true);
  const today = new Date();
  const isInSeason = today >= TICKER_SEASON_START;
  const week = isInSeason
    ? Math.min(Math.floor((today - TICKER_SEASON_START) / (7 * 86400000)) + 1, 14)
    : null;

  const matchups = React.useMemo(() => {
    if (!week) return [];
    const ids  = LEAGUE_TEAMS.map(t => t.id);
    const sched = buildTickerSchedule(ids, 14);
    return (sched[week - 1] || []).map(([aId, bId]) => {
      const a    = LEAGUE_TEAMS.find(t => t.id === aId);
      const b    = LEAGUE_TEAMS.find(t => t.id === bId);
      const aScore = tickerSimScore(aId, week);
      const bScore = tickerSimScore(bId, week);
      const isMe   = aId === myTeamId || bId === myTeamId;
      return { a, b, aScore, bScore, isMe };
    });
  }, [week, myTeamId]);

  if (!week || matchups.length === 0 || !visible) return null;

  return (
    <div style={{
      position: 'fixed', top: 0, left: 0, right: 0, zIndex: 5000,
      background: 'rgba(8,12,8,.96)', backdropFilter: 'blur(8px)',
      borderBottom: '1px solid rgba(198,255,58,.2)',
      display: 'flex', alignItems: 'center', gap: 0,
      height: 32, overflow: 'hidden',
    }}>
      <div style={{ flexShrink: 0, padding: '0 10px', fontSize: 9, fontFamily: 'var(--font-mono)', fontWeight: 800, color: 'var(--accent)', textTransform: 'uppercase', letterSpacing: '.1em', borderRight: '1px solid rgba(255,255,255,.1)', height: '100%', display: 'flex', alignItems: 'center', gap: 5 }}>
        <span style={{ width: 5, height: 5, borderRadius: '50%', background: '#c6ff3a', display: 'inline-block', animation: 'pulse 2s infinite' }} />
        Wk{week}
      </div>
      <div style={{ flex: 1, overflow: 'hidden', position: 'relative' }}>
        <div style={{ display: 'flex', gap: 0, animation: matchups.length > 5 ? 'ticker-scroll 30s linear infinite' : 'none', whiteSpace: 'nowrap' }}>
          {[...matchups, ...matchups].map(({ a, b, aScore, bScore, isMe }, i) => {
            const aWin = aScore > bScore;
            return (
              <div key={i} onClick={() => onNav('h2h')} style={{
                cursor: 'pointer', flexShrink: 0, display: 'flex', alignItems: 'center', gap: 8,
                padding: '0 14px', height: 32, borderRight: '1px solid rgba(255,255,255,.06)',
                background: isMe ? 'rgba(198,255,58,.06)' : 'transparent',
              }}>
                <span style={{ fontSize: 10, fontWeight: aWin ? 800 : 400, color: aWin ? 'var(--text)' : 'var(--text-dim)', fontFamily: 'var(--font-mono)' }}>{a?.abbr ?? a?.logo}</span>
                <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 800, fontSize: 12, color: aWin ? 'var(--accent)' : 'var(--text-dim)' }}>{aScore}</span>
                <span style={{ fontSize: 9, color: 'var(--text-faint)' }}>–</span>
                <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 800, fontSize: 12, color: !aWin ? 'var(--accent)' : 'var(--text-dim)' }}>{bScore}</span>
                <span style={{ fontSize: 10, fontWeight: !aWin ? 800 : 400, color: !aWin ? 'var(--text)' : 'var(--text-dim)', fontFamily: 'var(--font-mono)' }}>{b?.abbr ?? b?.logo}</span>
                {isMe && <span style={{ fontSize: 8, color: 'var(--accent)', fontFamily: 'var(--font-mono)', fontWeight: 700 }}>YOU</span>}
              </div>
            );
          })}
        </div>
      </div>
      <button onClick={() => setVisible(false)} style={{ flexShrink: 0, background: 'none', border: 'none', color: 'var(--text-faint)', cursor: 'pointer', padding: '0 10px', fontSize: 14, height: '100%', display: 'flex', alignItems: 'center' }}>
        ✕
      </button>
      <style>{`
        @keyframes ticker-scroll {
          from { transform: translateX(0); }
          to   { transform: translateX(-50%); }
        }
      `}</style>
    </div>
  );
}

// ── Push Notification Button ──────────────────────────────────────────────────
function PushNotificationButton() {
  const [state, setState] = React.useState('loading'); // loading | unsupported | default | granted | subscribed | denied | error

  React.useEffect(() => {
    getSubscriptionState().then(setState);
  }, []);

  async function handleEnable() {
    const perm = await requestNotificationPermission();
    if (perm === 'granted') {
      showLocalNotification('FantasAI Alerts Enabled', 'You\'ll be notified about lineup locks, waiver claims, and trades.');
      setState('subscribed');
    } else {
      setState(perm);
    }
  }

  if (state === 'loading' || state === 'unsupported') return null;
  if (state === 'subscribed' || state === 'granted') {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 10, color: 'var(--good)', fontFamily: 'var(--font-mono)', padding: '6px 0' }}>
        <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--good)', display: 'inline-block' }} />
        Push Alerts On
      </div>
    );
  }
  if (state === 'denied') {
    return (
      <div style={{ fontSize: 10, color: 'var(--text-faint)', fontFamily: 'var(--font-mono)' }}>
        Notifications blocked in browser
      </div>
    );
  }
  return (
    <button
      onClick={handleEnable}
      style={{ fontSize: 10, padding: '5px 10px', background: 'rgba(198,255,58,.1)', border: '1px solid rgba(198,255,58,.3)', borderRadius: 6, color: 'var(--accent)', cursor: 'pointer', fontFamily: 'var(--font-mono)', fontWeight: 700 }}
    >
      🔔 Enable Push Alerts
    </button>
  );
}

// In-app push notification banner — shown when a push arrives and the tab is already in focus.
// The service worker posts { type: 'PUSH_RECEIVED', title, body } to open clients; this component
// displays that payload as a transient overlay that auto-dismisses after 5 s.
function PushBanner({ title, body, onDismiss }) {
  React.useEffect(() => {
    const t = setTimeout(onDismiss, 5000);
    return () => clearTimeout(t);
  }, [onDismiss]);

  return (
    <div style={{
      position: 'fixed', top: 16, right: 16, zIndex: 10000,
      background: 'rgba(8,14,4,.97)', backdropFilter: 'blur(14px)',
      border: '1px solid rgba(198,255,58,.35)', borderRadius: 12,
      padding: '12px 16px', minWidth: 260, maxWidth: 340,
      boxShadow: '0 8px 32px rgba(0,0,0,.55), 0 0 20px rgba(198,255,58,.1)',
      display: 'flex', flexDirection: 'column', gap: 4,
      animation: 'push-banner-in .25s ease',
    }}>
      <style>{`@keyframes push-banner-in { from { opacity:0; transform:translateX(20px); } to { opacity:1; transform:translateX(0); } }`}</style>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
          <span style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--accent)', flexShrink: 0, boxShadow: '0 0 6px var(--accent)', animation: 'pulse 2s infinite' }} />
          <span style={{ fontSize: 12, fontWeight: 800, color: 'var(--text)', fontFamily: 'var(--font-display)', letterSpacing: '.01em' }}>{title}</span>
        </div>
        <button onClick={onDismiss} style={{ background: 'none', border: 'none', color: 'var(--text-faint)', cursor: 'pointer', fontSize: 14, padding: '0 2px', lineHeight: 1, flexShrink: 0 }}>✕</button>
      </div>
      {body && <div style={{ fontSize: 11, color: 'var(--text-dim)', paddingLeft: 14, lineHeight: 1.5 }}>{body}</div>}
    </div>
  );
}

function loadLeagueSettings() {
  try { return JSON.parse(localStorage.getItem('fantasai_league_settings') || 'null') || null; } catch { return null; }
}

const API_BASE      = 'https://api.fantasai.net';
const ADMIN_EMAIL   = 'admin@fantasai.net';
const OWNERS_KEY    = 'fantasai_owners_config';

// Re-derive the authoritative user profile from R2 owner config.
// Returns a patched user object, or null if the session can't be validated.
async function refreshUserSession(cachedUser) {
  if (!cachedUser?.email) return null;
  // Admin identity is server-independent — just confirm the flag
  if (cachedUser.email === ADMIN_EMAIL) return { ...cachedUser, isAdmin: true };
  try {
    const res = await Promise.race([
      fetch(`${API_BASE}/api/v1/owners/config`),
      new Promise((_, rej) => setTimeout(() => rej(), 5000)),
    ]);
    if (!res.ok) return null;
    const config = await res.json();
    localStorage.setItem(OWNERS_KEY, JSON.stringify(config));
    // Find the entry that matches the cached user's email
    for (const [, entry] of Object.entries(config)) {
      if (typeof entry !== 'object' || !entry.email) continue;
      if (entry.email.toLowerCase() === cachedUser.email.toLowerCase()) {
        return {
          ...cachedUser,
          isAdmin:        false,
          isCommissioner: !!entry.isCommissioner,
          teamName:       entry.name || cachedUser.teamName,
        };
      }
    }
  } catch {}
  return null;
}

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

// Build the authoritative roster for a team by merging:
//   1. Saved draft picks (primary — captures every pick made in the draft room)
//   2. S3 roster (adds/drops made after the draft)
// Excludes players currently on waivers (dropped).
function buildMergedRoster(teamId, s3Ids) {
  try {
    const { claims: waiverRaw } = getWaivers();
    const droppedIds = new Set(Object.keys(waiverRaw).map(Number));

    // Use whichever pick source has the most filled picks for this team
    const tryParse = key => { try { return JSON.parse(localStorage.getItem(key) || 'null'); } catch { return null; } };
    const live  = tryParse('fantasai_live_picks');
    const saved = tryParse('fantasai_mock_picks_saved');
    const wip   = tryParse('fantasai_mock_picks_wip');
    const countForTeam = arr => Array.isArray(arr) ? arr.filter(p => Number(p.teamId) === Number(teamId) && p.playerId).length : 0;
    let picks;
    if (countForTeam(live) >= countForTeam(saved) && countForTeam(live) >= countForTeam(wip)) picks = live;
    else if (countForTeam(saved) >= countForTeam(wip)) picks = saved;
    else picks = wip;

    const pickIds = Array.isArray(picks)
      ? picks
          .filter(p => Number(p.teamId) === Number(teamId) && p.playerId && !droppedIds.has(Number(p.playerId)))
          .map(p => Number(p.playerId))
      : [];

    // Start from draft picks, layer in S3 additions, exclude drops
    const merged = new Set(pickIds);
    if (s3Ids) {
      for (const id of s3Ids) {
        if (!droppedIds.has(Number(id))) merged.add(Number(id));
      }
    }
    return merged;
  } catch {
    return new Set(s3Ids || []);
  }
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

function backupRoster(teamId, ids) {
  if (!teamId || !ids || ids.size === 0) return;
  try {
    const key = `fantasai_roster_backup_${teamId}`;
    const existing = JSON.parse(localStorage.getItem(key) || 'null');
    if (existing && existing.ids.length > ids.size) {
      const histKey = `fantasai_roster_history_${teamId}`;
      const history = JSON.parse(localStorage.getItem(histKey) || '[]');
      history.push({ ids: existing.ids, savedAt: existing.savedAt, reason: 'overwritten' });
      if (history.length > 10) history.shift();
      localStorage.setItem(histKey, JSON.stringify(history));
    }
    localStorage.setItem(key, JSON.stringify({ ids: [...ids], savedAt: new Date().toISOString() }));
  } catch {}
}

function restoreRosterBackup(teamId) {
  try {
    const key = `fantasai_roster_backup_${teamId}`;
    const data = JSON.parse(localStorage.getItem(key) || 'null');
    if (data?.ids?.length) return new Set(data.ids);
  } catch {}
  return null;
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
  const player    = findPlayer(playerId);
  if (!player) return null;

  const totalMax  = settings?.roster?.totalPlayers?.max ?? 14;
  const positions = settings?.positions ?? [
    { key: 'QB', rosterTotal: '2' },
    { key: 'RB', rosterTotal: 'No Limit' },
    { key: 'WR', rosterTotal: 'No Limit' },
    { key: 'TE', rosterTotal: 'No Limit' },
    { key: 'K',  rosterTotal: '0' },
    { key: 'DST',rosterTotal: 'No Limit' },
  ];

  // Count filled slots by running the same assignRoster logic the UI uses.
  // Counting raw IDs in the Set is wrong — old IDs from trades/drops accumulate
  // and inflate the count past the slot cap even when bench spots are truly open.
  const frame      = buildRosterFrame(settings);
  const totalSlots = frame.length;
  const assigned   = assignRoster(frame, currentIds, {}, findPlayer);
  const filledSlots = assigned.filter(e => e.playerId != null).length;
  if (filledSlots >= totalSlots) {
    return {
      title: 'Roster Full',
      detail: `All ${totalSlots} roster spots are filled (${filledSlots} players). Drop a player first, or see Rules & Settings.`,
    };
  }

  const posEntry = positions.find(p => p.key === player.pos);
  if (posEntry) {
    const limitStr = posEntry.rosterTotal;
    const limitNum = limitStr === 'No Limit' ? Infinity : parseInt(limitStr, 10);
    if (!isNaN(limitNum) && isFinite(limitNum)) {
      const currentOfPos = [...currentIds].filter(id => findPlayer(id)?.pos === player.pos).length;
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
  dashboard:    ['League', 'Dashboard'],
  players:      ['League', 'Players'],
  news:         ['League', 'Player News'],
  roster:       ['League', 'Current Roster'],
  waivers:      ['League', 'Waivers'],
  h2h:          ['League', 'Head to Head'],
  transactions: ['League', 'Transactions'],
  power:        ['League', 'Power Rankings'],
  compare:      ['Tools', 'Compare'],
  trade:        ['Tools', 'Trade Analyzer'],
  draft:        ['Draft', 'Draft Room'],
  owners:       ['Draft', 'Owner Intel · Draft DNA'],
  cbs:          ['Draft', 'Player Draft Rankings'],
  sources:          ['Setup', 'Sources & Connections'],
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
  const [appFontSize, setAppFontSize] = React.useState(() => Number(localStorage.getItem('fantasai_font_size') ?? 12));
  function handleAppFontSize(v) { setAppFontSize(v); localStorage.setItem('fantasai_font_size', v); }
  const [settingsInitialTab, setSettingsInitialTab] = React.useState('general');
  const [openPlayer, setOpenPlayer] = React.useState(null);

  // 'mock' | 'live' | null — set by DraftRoom via onDraftStatusChange callback
  // Also seed from localStorage so a page refresh still shows the banner
  const [draftTab, setDraftTab] = React.useState('room'); // 'room' | 'recap'
  const [playersTab, setPlayersTab] = React.useState('players'); // 'players' | 'watchlist'

  // Redirect legacy 'watchlist' nav to Players › Watchlist tab
  React.useEffect(() => {
    if (active === 'watchlist') { setActive('players'); setPlayersTab('watchlist'); }
  }, [active]);

  const [draftInProgress, setDraftInProgress] = React.useState(() => {
    try {
      const session = JSON.parse(localStorage.getItem('fantasai_mock_session') || 'null');
      const wip     = JSON.parse(localStorage.getItem('fantasai_mock_picks_wip') || 'null');
      const u       = JSON.parse(localStorage.getItem('fantasai_user') || 'null');
      if (session?.active === true && Array.isArray(wip) && wip.length > 0 && session.userTeamId === u?.teamId) return 'mock';
      return null;
    } catch { return null; }
  });
  const [draftMeta, setDraftMeta] = React.useState(() => {
    try { return { isMyTurn: false, picksAway: 0, seconds: 90, currentPickNum: 1, draftComplete: false, draftPaused: JSON.parse(localStorage.getItem('fantasai_draft_paused') || 'false') }; } catch { return { isMyTurn: false, picksAway: 0, seconds: 90, currentPickNum: 1, draftComplete: false, draftPaused: false }; }
  });
  const handleDraftStatusChange = React.useCallback((type, meta) => {
    setDraftInProgress(type);
    if (meta) setDraftMeta(meta);
  }, []);
  const [user, setUser] = React.useState(() => {
    try { return JSON.parse(localStorage.getItem('fantasai_user') || 'null'); } catch { return null; }
  });
  const [myRosterIds, setMyRosterIds] = React.useState(() => new Set());
  const [rosterLoading, setRosterLoading] = React.useState(true);

  // Stable ref so callbacks don't need user in their dep array
  const userRef = React.useRef(user);
  // Cache the ADP/ECR byName maps so they can be re-applied if players load after the patch
  const adpByNameRef = React.useRef(null);
  const ecrByNameRef = React.useRef(null);
  React.useEffect(() => { userRef.current = user; }, [user]);

  const [rosterSlotOverrides, setRosterSlotOverrides] = React.useState({});
  function handleSlotOverridesChange(overrides) {
    setRosterSlotOverrides(overrides);
    patchPrefs({ slotOverrides: overrides });
  }

  // Count starters with injury/questionable status — drives the sidebar badge on Lineup Decisions
  const lineupAlertCount = React.useMemo(() => {
    const settings  = loadLeagueSettings();
    const slotFrame = buildRosterFrame(settings);
    const starters  = assignRoster(slotFrame, myRosterIds, rosterSlotOverrides, findPlayer)
      .filter(e => e.slot !== 'BENCH' && e.playerId);
    return starters.filter(e => {
      const p = findPlayer(e.playerId);
      return p && p.status && p.status !== 'OK';
    }).length;
  }, [myRosterIds, rosterSlotOverrides]);

  const [needsPasswordChange, setNeedsPasswordChange] = React.useState(() => {
    try { return JSON.parse(localStorage.getItem('fantasai_user') || 'null')?.needsPasswordChange || false; } catch { return false; }
  });
  const [resetToken, setResetToken] = React.useState(() => {
    return new URLSearchParams(window.location.search).get('reset') || null;
  });

  function handleLogin(u) {
    const prev = (() => { try { return JSON.parse(localStorage.getItem('fantasai_user') || 'null'); } catch { return null; } })();
    const keep = ['fantasai_league_settings', 'fantasai_owners_config', 'fantasai.workerUrl', 'fantasai.workerKey', 'fantasai_debug_api_key', 'fantasai_cbs_cookie', 'fantasai_cbs_cookie_saved_at'];
    const saved = {};
    for (const k of keep) { const v = localStorage.getItem(k); if (v != null) saved[k] = v; }
    const allKeys = Object.keys(localStorage).filter(k => k.startsWith('fantasai'));
    for (const k of allKeys) localStorage.removeItem(k);
    for (const [k, v] of Object.entries(saved)) localStorage.setItem(k, v);
    localStorage.setItem('fantasai_user', JSON.stringify(u));
    window.location.reload();
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

  // Register service worker for push notifications (once on mount)
  React.useEffect(() => { registerServiceWorker(); }, []);

  // In-app push banner — catches PUSH_RECEIVED messages from the service worker.
  // Uses BroadcastChannel (Firefox/Safari friendly) + postMessage fallback (Chrome).
  const [pushBanner, setPushBanner] = React.useState(null);
  React.useEffect(() => {
    function showBanner(data) {
      setPushBanner({ title: data.title || 'FantasAI', body: data.body || '' });
    }
    let bc = null;
    try { bc = new BroadcastChannel('fantasai-push'); bc.onmessage = e => { if (e.data?.type === 'PUSH_RECEIVED') showBanner(e.data); }; } catch {}
    function onSWMessage(e) { if (e.data?.type === 'PUSH_RECEIVED') showBanner(e.data); }
    if (navigator.serviceWorker) navigator.serviceWorker.addEventListener('message', onSWMessage);
    return () => {
      bc?.close();
      if (navigator.serviceWorker) navigator.serviceWorker.removeEventListener('message', onSWMessage);
    };
  }, []);

  // On cold load (already logged in): restore league data from server, then load remote prefs.
  // Also silently re-validates the cached user against R2 so isAdmin/isCommissioner
  // are always current — regardless of which browser or device you're on.
  React.useEffect(() => {
    const leagueId = user?.leagueId || 'tau';
    loadLeagueData(leagueId);

    // Load per-user prefs and shared league state from R2 (cold reload path)
    if (user?.teamId) {
      const teamId = user.teamId;
      Promise.all([
        loadUserPrefs(teamId),
        loadRemoteState(),
      ]).then(([prefs]) => {
        if (prefs.slotOverrides && Object.keys(prefs.slotOverrides).length)
          setRosterSlotOverrides(prefs.slotOverrides);
        if (Array.isArray(prefs.watchlist))
          setWatchlistIds(new Set(prefs.watchlist));
        if (prefs.sources?.freeApis && prefs.sources?.feeds) {
          const mergedApis = { ...prefs.sources.freeApis };
          FREE_DATA_SOURCES.forEach(s => { if (s.enabled && mergedApis[s.id] === false) mergedApis[s.id] = true; });
          setSourcesState({ ...prefs.sources, freeApis: mergedApis });
        }

        const offers = getTradeOffers();
        setTradeOffers(offers);
        const { claims } = getWaivers();
        const now = Date.now();
        setWaiverQueue(
          Object.fromEntries(Object.entries(claims).filter(([, v]) => new Date(v.expiresAt).getTime() > now))
        );
      });
    }

    // Refresh permissions from R2 (fire-and-forget — UI renders from cache first)
    if (user) {
      refreshUserSession(user).then(fresh => {
        if (!fresh) return;
        const changed =
          fresh.isAdmin        !== user.isAdmin ||
          fresh.isCommissioner !== user.isCommissioner ||
          fresh.teamName       !== user.teamName;
        if (changed) {
          setUser(fresh);
          userRef.current = fresh;
          localStorage.setItem('fantasai_user', JSON.stringify(fresh));
        }
      });
    }

    if (!user?.teamId) { setRosterLoading(false); return; }
    setRosterLoading(true);
    fetchS3Roster(user.teamId).then(s3Ids => {
      setMyRosterIds(buildMergedRoster(user.teamId, s3Ids));
      setRosterLoading(false);
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // intentionally runs only once on mount

  // Load live player list from Databricks → Sleeper fallback.
  // Load 2026 player pool from R2 (fantasai/players/export_players_2026_draft.json).
  // Refreshed daily at 8:00 AM UTC by the Databricks ETL — 988 active+IR roster players.
  // No fallbacks: if R2 is unavailable the store stays empty and the UI shows 0 players.
  React.useEffect(() => {
    api.r2.players2026()
      .then(rows => {
        const arr = Array.isArray(rows) ? rows : [];
        if (arr.length > 0) {
          setPlayers(normalizePlayerList(arr));
          // Re-apply ADP/ECR if those fetches already completed before players loaded
          if (adpByNameRef.current) {
            const byName = adpByNameRef.current;
            patchPlayers(p => {
              const adp = byName.get(p.name?.toLowerCase().trim()) ?? byName.get(stripSuffix(p.name));
              if (adp != null && p.pos !== 'DST' && p.pos !== 'K') return { ...p, adp };
              return p;
            });
          }
          if (ecrByNameRef.current) {
            const byName = ecrByNameRef.current;
            patchPlayers(p => {
              const ecr = byName.get(p.name?.toLowerCase().trim());
              return ecr != null ? { ...p, ecr } : p;
            });
          }
        }
      })
      .catch(() => {})
      // After players are loaded (regardless of source), backfill bye weeks from Sleeper.
      // Chained here so patchPlayers always runs after setPlayers, avoiding the race where
      // the separate effect would win and find _players still empty.
      .then(() =>
        getPlayerMap().then(map => {
          const byeByName = {};
          const photoByName = {};
          for (const p of Object.values(map)) {
            const full = p.full_name || `${p.first_name || ''} ${p.last_name || ''}`.trim();
            if (!full) continue;
            const key = full.toLowerCase().trim();
            if (p.bye_week) byeByName[key] = p.bye_week;
            const url = p.headshot_url || p.avatar_url;
            if (url) photoByName[key] = url;
          }
          patchPlayers(player => {
            let changed = false;
            let updated = { ...player };
            if (!player.bye || player.bye <= 0) {
              const fromSleeper = byeByName[player.name?.toLowerCase().trim()];
              const bye = fromSleeper || BYE_WEEKS_2026[player.team] || 0;
              if (bye) { updated.bye = bye; changed = true; }
            }
            if (!player.photoUrl) {
              const photo = photoByName[player.name?.toLowerCase().trim()];
              if (photo) { updated.photoUrl = photo; changed = true; }
            }
            return changed ? updated : player;
          });
        }).catch(() => {})
      )
      // After bye weeks, warm all player projections from Sleeper via a single bulk fetch
      // (2 HTTP calls total). Also applies a localStorage cache so subsequent page loads
      // get correct PROJ values instantly — before any async work completes.
      .then(() => {
        const CACHE_KEY = 'fantasai_sleeper_proj_v1';
        const CACHE_TTL = 30 * 60 * 1000; // 30 min

        // Synchronous path: apply cached projections immediately so H2H/Dashboard
        // are correct even before the async refresh completes.
        try {
          const cached = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null');
          if (cached?.updates?.length && Date.now() - cached.at < CACHE_TTL) {
            const m = new Map(cached.updates);
            patchPlayers(p => {
              const sleeperProj = m.get(p.id);
              if (sleeperProj == null) return p;
              const baseline = Math.max(p.proj || 0, p.avg || 0, p.last || 0);
              if (baseline > 2 && sleeperProj < baseline * 0.25) return p;
              return { ...p, proj: sleeperProj };
            });
          }
        } catch {}

        // Async path: bulk Sleeper projection fetch for all players (2 API calls).
        fetchBulkProjections(getPlayers()).then(updates => {
          if (!updates.length) return;
          const m = new Map(updates);
          const accepted = [];
          patchPlayers(p => {
            const sleeperProj = m.get(p.id);
            if (sleeperProj == null) return p;
            const baseline = Math.max(p.proj || 0, p.avg || 0, p.last || 0);
            if (baseline > 2 && sleeperProj < baseline * 0.25) return p;
            accepted.push([p.id, sleeperProj]);
            return { ...p, proj: sleeperProj };
          });
          try {
            localStorage.setItem(CACHE_KEY, JSON.stringify({ at: Date.now(), updates: accepted }));
          } catch {}
        }).catch(() => {});
      })
      // export_players_2026_draft.json has no DSTs — add them from the defense ADP file.
      .then(async () => {
        if (getPlayers().some(p => p.pos === 'DST')) return;
        const clean = await api.r2.defenseAdp().catch(() => null);
        const cleanArr = clean?.data || (Array.isArray(clean) ? clean : []);
        if (!cleanArr.length) return;
        const DST_NAME_MAP = { 'Arizona Cardinals':'ARI','Atlanta Falcons':'ATL','Baltimore Ravens':'BAL','Buffalo Bills':'BUF','Carolina Panthers':'CAR','Chicago Bears':'CHI','Cincinnati Bengals':'CIN','Cleveland Browns':'CLE','Dallas Cowboys':'DAL','Denver Broncos':'DEN','Detroit Lions':'DET','Green Bay Packers':'GB','Houston Texans':'HOU','Indianapolis Colts':'IND','Jacksonville Jaguars':'JAX','Kansas City Chiefs':'KC','Las Vegas Raiders':'LV','Los Angeles Chargers':'LAC','Los Angeles Rams':'LAR','Miami Dolphins':'MIA','Minnesota Vikings':'MIN','New England Patriots':'NE','New Orleans Saints':'NO','New York Giants':'NYG','New York Jets':'NYJ','Philadelphia Eagles':'PHI','Pittsburgh Steelers':'PIT','San Francisco 49ers':'SF','Seattle Seahawks':'SEA','Tampa Bay Buccaneers':'TB','Tennessee Titans':'TEN','Washington Commanders':'WAS' };
        const sorted = [...cleanArr].sort((a, b) => (a.adp_rank || 999) - (b.adp_rank || 999));
        const dsts = sorted.map((row, i) => {
          const posRank = row.adp_rank || (i + 1);
          const teamAbbr = (row.team && row.team.trim()) || DST_NAME_MAP[row.player_name] || '';
          if (!teamAbbr) return null;
          return {
          id: 90000 + i,
          name: `${teamAbbr} D/ST`,
          pos: 'DST', team: teamAbbr,
          ecr: dstOverallRank(posRank), adp: dstOverallRank(posRank),
          proj: parseFloat(Math.max(4, 15 - posRank * 0.6).toFixed(1)),
          last: row.avg_last_4_weeks || 0, avg: row.avg_last_4_weeks || 0,
          bye: 0, opp: '', owned: 0, tier: 0, num: 0, age: 0, pts2025: 0,
          trend: [], depth: 1, targetShare: 0, routes: 0, yac: 0,
          photoUrl: null, news: '', status: '', seasonTier: null,
          sleeperId: null, masterId: null, oppRank: 0,
        };}).filter(Boolean);
        setPlayers([...getPlayers(), ...dsts]);
        // Re-apply ECR for newly-added DSTs if ECR patch already completed
        if (ecrByNameRef.current) {
          const byName = ecrByNameRef.current;
          patchPlayers(p => {
            const ecr = byName.get(p.name?.toLowerCase().trim());
            return ecr != null ? { ...p, ecr } : p;
          });
        }
      });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Background cookie health check — fires 8 s after mount, sets alert if CBS cookie is missing or returns 401.
  const [cookieAlert, setCookieAlert] = React.useState(false);
  React.useEffect(() => {
    const t = setTimeout(async () => {
      const cookie = (() => { try { return localStorage.getItem('fantasai_cbs_cookie') || ''; } catch { return ''; } })();
      if (!cookie) { setCookieAlert(true); return; }
      try {
        const headers = { 'X-CBS-Cookie': cookie };
        const key = import.meta.env.VITE_FANTASAI_KEY || 'fantasai2026';
        headers['X-FantasAI-Key'] = key;
        const res = await fetch('https://api.fantasai.net/api/v1/league', { headers, signal: AbortSignal.timeout(8000) });
        if (!res.ok) setCookieAlert(true);
      } catch { /* network error — don't alert, may be offline */ }
    }, 8000);
    return () => clearTimeout(t);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Patch ADP from dedicated scoring-format ADP file (top ~425 players) — fires after main player load.
  // Standard scoring uses adp_standard.json; PPR and Half-PPR both use adp_ppr.json.
  React.useEffect(() => {
    const format = getScoringFormat();
    const fetcher = format === 'standard' ? api.r2.adpStandard : api.r2.adpPPR;
    fetcher().then(raw => {
      const arr = Array.isArray(raw) ? raw : Array.isArray(raw?.players) ? raw.players : Array.isArray(raw?.data) ? raw.data : [];
      if (!arr.length) return;
      const byName = new Map();
      for (const r of arr) {
        const name = (r.full_name || r.player_name || r.name || '').toLowerCase().trim();
        // R2 file uses adp_value (float pick#) or adp_rank (int); fall back to bare adp
        const adpVal = r.adp_value ?? r.adp_rank ?? r.adp;
        if (name && adpVal != null) {
          byName.set(name, Number(adpVal));
          const stripped = stripSuffix(name);
          if (stripped !== name && !byName.has(stripped)) byName.set(stripped, Number(adpVal));
        }
      }
      if (byName.size === 0) return;
      adpByNameRef.current = byName;
      patchPlayers(p => {
        const adp = byName.get(p.name?.toLowerCase().trim()) ?? byName.get(stripSuffix(p.name));
        if (adp != null && p.pos !== 'DST' && p.pos !== 'K') return { ...p, adp };
        return p;
      });
    }).catch(() => {});
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Patch ECR from FantasyPros consensus rankings (ecr_ppr.json / ecr_std.json).
  // Replaces the weak Sleeper search_rank that playerStore uses as a fallback ECR.
  React.useEffect(() => {
    const format = getScoringFormat();
    const fetcher = format === 'standard' ? api.r2.ecrStandard : api.r2.ecrPPR;
    fetcher().then(raw => {
      const arr = Array.isArray(raw) ? raw : Array.isArray(raw?.players) ? raw.players : [];
      if (!arr.length) return;
      const byName = new Map();
      for (const r of arr) {
        const name = (r.player_name || r.full_name || r.name || '').toLowerCase().trim();
        const ecr = r.ecr_rank ?? r.ecr_avg ?? r.rank;
        if (name && ecr != null) {
          byName.set(name, Math.round(Number(ecr)));
          const stripped = stripSuffix(name);
          if (stripped !== name && !byName.has(stripped)) byName.set(stripped, Math.round(Number(ecr)));
        }
      }
      if (byName.size === 0) return;
      ecrByNameRef.current = byName;
      patchPlayers(p => {
        const ecr = byName.get(p.name?.toLowerCase().trim()) ?? byName.get(stripSuffix(p.name));
        return ecr != null ? { ...p, ecr } : p;
      });
    }).catch(() => {});
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Patch DST ECR + ADP from defense ranking data (2025 stats until 2026 games begin).
  // Primary: gold_adp_defense.json — clean 32-row table from main.fantasai.gold_adp_defense.
  //   Fields: team, adp_rank (pre-computed 1-32), avg_last_4_weeks. No duplicates.
  // Fallback: defense_performance.json — weekly DST fantasy scores; has duplicate rows per team
  //   (export ran multiple times). We deduplicate by taking latest week and averaging dupes.
  React.useEffect(() => {
    async function patchDstRanks() {
      // ── Try the clean gold_adp_defense table first ──────────────────────────
      const clean = await api.r2.defenseAdp().catch(() => null);
      const cleanArr = clean?.data || (Array.isArray(clean) ? clean : []);
      if (cleanArr.length > 0) {
        const rankByTeam = {};
        // gold_adp_defense has adp_rank pre-computed; fall back to array position if missing
        const DST_PATCH_MAP = { 'Arizona Cardinals':'ARI','Atlanta Falcons':'ATL','Baltimore Ravens':'BAL','Buffalo Bills':'BUF','Carolina Panthers':'CAR','Chicago Bears':'CHI','Cincinnati Bengals':'CIN','Cleveland Browns':'CLE','Dallas Cowboys':'DAL','Denver Broncos':'DEN','Detroit Lions':'DET','Green Bay Packers':'GB','Houston Texans':'HOU','Indianapolis Colts':'IND','Jacksonville Jaguars':'JAX','Kansas City Chiefs':'KC','Las Vegas Raiders':'LV','Los Angeles Chargers':'LAC','Los Angeles Rams':'LAR','Miami Dolphins':'MIA','Minnesota Vikings':'MIN','New England Patriots':'NE','New Orleans Saints':'NO','New York Giants':'NYG','New York Jets':'NYJ','Philadelphia Eagles':'PHI','Pittsburgh Steelers':'PIT','San Francisco 49ers':'SF','Seattle Seahawks':'SEA','Tampa Bay Buccaneers':'TB','Tennessee Titans':'TEN','Washington Commanders':'WAS' };
        const sorted = [...cleanArr].sort((a, b) => (a.adp_rank || 999) - (b.adp_rank || 999));
        sorted.forEach((row, i) => {
          const posRank = row.adp_rank || (i + 1);
          const teamAbbr = (row.team && row.team.trim()) || DST_PATCH_MAP[row.player_name] || '';
          if (teamAbbr) rankByTeam[teamAbbr.toUpperCase()] = dstOverallRank(posRank);
        });
        patchPlayers(p => {
          if (p.pos !== 'DST') return p;
          const rank = rankByTeam[p.team?.toUpperCase()];
          return rank ? { ...p, ecr: rank, adp: rank } : p;
        });
        return;
      }

      // ── Fallback: defense_performance.json (has duplicate rows per team) ────
      const perf = await api.r2.defensePerformance().catch(() => null);
      const perfArr = perf?.data || (Array.isArray(perf) ? perf : []);
      if (!perfArr.length) return;
      const byTeam = {};
      for (const row of perfArr) {
        const t = row.team;
        if (!t) continue;
        const wk = row.week || 0;
        if (!byTeam[t] || wk > byTeam[t].maxWeek) {
          byTeam[t] = { maxWeek: wk, rows: [row] };
        } else if (wk === byTeam[t].maxWeek) {
          byTeam[t].rows.push(row);
        }
      }
      const scored = Object.entries(byTeam).map(([team, { rows }]) => ({
        team,
        score: rows.reduce((s, r) => s + (r.avg_last_4_weeks || 0), 0) / rows.length,
      }));
      scored.sort((a, b) => b.score - a.score);
      const rankByTeam = {};
      scored.forEach(({ team }, i) => { rankByTeam[team] = dstOverallRank(i + 1); });
      patchPlayers(p => {
        if (p.pos !== 'DST') return p;
        const rank = rankByTeam[p.team?.toUpperCase()];
        return rank ? { ...p, ecr: rank, adp: rank } : p;
      });
    }
    patchDstRanks();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Player source: R2 export_players_2026_draft.json only (loaded above).
  // The Databricks background refresh has been disabled — R2 is the authoritative 2026 player list.

  function handlePasswordChanged() {
    setNeedsPasswordChange(false);
  }

  function handleLogout() {
    localStorage.removeItem('fantasai_user');
    localStorage.removeItem('fantasai_mock_session');
    localStorage.removeItem('fantasai_mock_picks_wip');
    localStorage.removeItem('fantasai_draft_paused');
    setUser(null);
    setDraftInProgress(null);
    setMyRosterIds(new Set());
    setRosterLoading(false);
    setRosterSlotOverrides({});
    setWatchlistIds(new Set());
    setTradeOffers([]);
    setWaiverQueue({});
    setSourcesState({
      freeApis: Object.fromEntries(FREE_DATA_SOURCES.map(s => [s.id, s.enabled])),
      feeds:    Object.fromEntries(RANKING_SOURCES.map(s => [s.id, { enabled: s.enabled, weight: s.weight }])),
    });
    clearPrefs();
    clearRemoteState();
    clearLeagueData();
  }

  // Commissioner: wipe all rosters everywhere — R2, localStorage, and in-memory state.
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

      // Wipe mock draft state (legitimately local/ephemeral)
      ['fantasai_mock_picks_saved', 'fantasai_live_picks',
       'fantasai_mock_picks_wip',   'fantasai_mock_session'].forEach(k => localStorage.removeItem(k));

      // Wipe R2 waiver and slot-override state
      await Promise.allSettled([
        saveWaivers({}, []),
        (async () => { patchPrefs({ slotOverrides: {} }); })(),
      ]);

      // Reset in-memory TEAM_ROSTERS so all screens see empty state immediately
      clearAllRosters();

      // Reset React state for the current session
      setMyRosterIds(new Set());
      setRosterSlotOverrides({});
      setWaiverQueue({});
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
      if (err) { setRosterError({ ...err, addingPlayerId: id }); return prev; }
      nextIds = new Set([...prev, id]);
      return nextIds;
    });
    if (nextIds && userRef.current?.teamId) {
      backupRoster(userRef.current.teamId, nextIds);
      doSync(userRef.current.teamId, nextIds);
      const p = findPlayer(id);
      if (p) {
        const totalTeams = LEAGUE_TEAMS.length;
        const sorted = [...LEAGUE_TEAMS].sort((a, b) => {
          const [aw] = (a.record || '0-0').split('-').map(Number);
          const [bw] = (b.record || '0-0').split('-').map(Number);
          return bw - aw;
        });
        const myRank = sorted.findIndex(t => t.id === userRef.current?.teamId) + 1;
        const waiverPick = myRank ? totalTeams - myRank + 1 : null;
        api.transactions.log({
          id: `${Date.now()}-add-${id}`,
          type: 'add',
          timestamp: new Date().toISOString(),
          teamId:      userRef.current.teamId,
          teamName:    userRef.current.teamName || userRef.current.teamId,
          players:     [{ id, name: p.name, pos: p.pos, nflTeam: p.team, action: 'add' }],
          waiverPick,
          newWaiverPick: waiverPick != null ? totalTeams : null,
        });
      }
    }
  }, []);
  // Initialized from remoteState on login — no localStorage
  const [waiverQueue, setWaiverQueue] = React.useState({});
  const [tradeOffers, setTradeOffers] = React.useState([]);

  function handleSendTradeOffer({ fromTeamId, toTeamId, giveIds, getIds }) {
    const offer = { id: Date.now(), fromTeamId, toTeamId, giveIds, getIds, sentAt: new Date().toISOString(), status: 'pending' };
    setTradeOffers(prev => {
      const next = [...prev, offer];
      saveTradeOffers(next);
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
      saveTradeOffers(next);
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
      saveTradeOffers(next);
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
      backupRoster(userRef.current.teamId, nextIds);
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
      saveWaivers(next, undefined);
      return next;
    });
  }, []);

  // Atomic claim: drop + add in one state update so validation sees the freed slot.
  // logType lets callers distinguish a genuine waiver claim (consumes waiver
  // priority, moves the team to the back of the order) from an instant swap
  // that shouldn't touch waiver priority at all.
  const handleClaimPlayer = React.useCallback((addId, dropId, logType = 'waiver_claim') => {
    let nextIds = null;
    setMyRosterIds(prev => {
      const working = new Set(prev);
      if (dropId) working.delete(dropId);
      const err = validateRosterAdd(addId, working);
      if (err) { setRosterError(err); return prev; }
      working.add(addId);
      nextIds = working;
      return working;
    });
    if (nextIds && userRef.current?.teamId) {
      doSync(userRef.current.teamId, nextIds);
      const addedPlayer  = findPlayer(addId);
      const droppedPlayer = dropId ? findPlayer(dropId) : null;
      const players = [];
      if (addedPlayer)  players.push({ id: addId,  name: addedPlayer.name,  pos: addedPlayer.pos,  nflTeam: addedPlayer.team,  action: 'add' });
      if (droppedPlayer) players.push({ id: dropId, name: droppedPlayer.name, pos: droppedPlayer.pos, nflTeam: droppedPlayer.team, action: 'drop' });
      if (players.length) {
        const tx = {
          id: `${Date.now()}-claim-${addId}`,
          type: dropId ? logType : 'add',
          timestamp: new Date().toISOString(),
          teamId:   userRef.current.teamId,
          teamName: userRef.current.teamName || userRef.current.teamId,
          players,
        };
        // A genuine waiver claim consumes priority — record the claim number
        // and move this team to the back of the waiver order.
        if (dropId && logType === 'waiver_claim') {
          const { order } = getWaivers();
          const currentOrder = Array.isArray(order) && order.length ? order : [...TEAMS_ORDER].reverse();
          const myIdx = currentOrder.indexOf(userRef.current.teamId);
          tx.waiverPick = myIdx >= 0 ? myIdx + 1 : currentOrder.length + 1;
          const remaining = currentOrder.filter(id => id !== userRef.current.teamId);
          const newOrder = [...remaining, userRef.current.teamId];
          saveWaivers(undefined, newOrder);
          tx.newWaiverPick = newOrder.length;
        }
        api.transactions.log(tx);
      }
    }
    if (dropId) {
      const drop = new Date();
      const earliest = new Date(drop.getTime() + 24 * 60 * 60 * 1000);
      earliest.setHours(23, 59, 0, 0);
      const waiver_days = new Set([3, 4, 5, 6]);
      while (!waiver_days.has(earliest.getDay())) earliest.setDate(earliest.getDate() + 1);
      const entry = { droppedAt: drop.toISOString(), expiresAt: earliest.toISOString(), teamId: userRef.current?.teamId };
      setWaiverQueue(prev => {
        const next = { ...prev, [dropId]: entry };
        saveWaivers(next, undefined);
        return next;
      });
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Initialized from remotePrefs on login — no localStorage
  const [watchlistIds, setWatchlistIds] = React.useState(new Set());
  const handleToggleWatch = React.useCallback(id => {
    setWatchlistIds(prev => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id); else n.add(id);
      patchPrefs({ watchlist: [...n] });
      return n;
    });
  }, []);

  const [sourcesState, setSourcesState] = React.useState(() => ({
    freeApis: Object.fromEntries(FREE_DATA_SOURCES.map(s => [s.id, s.enabled])),
    feeds:    Object.fromEntries(RANKING_SOURCES.map(s => [s.id, { enabled: s.enabled, weight: s.weight }])),
  }));
  function handleSourcesChange(next) {
    setSourcesState(next);
    patchPrefs({ sources: next });
  }

  function handleExport() {
    let rows = [];
    let filename = 'fantasai-export.csv';

    if (active === 'players' || active === 'waivers') {
      filename = `fantasai-players.csv`;
      rows = [
        ['Name','Pos','Team','Proj','Last','Avg','Owned%','ADP','ECR','Status'],
        ...getPlayers().map(p => [p.name, p.pos, p.team, p.proj, p.last, p.avg, p.owned, p.adp, p.ecr, p.status]),
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
  const _draftPausedOnOtherPage = draftInProgress && active !== 'draft' && draftMeta?.draftPaused && !draftMeta?.draftComplete;
  const shellClass = `shell ${showAI ? 'has-ai' : ''} ${showMobile ? 'mobile-mode' : ''} ${_draftPausedOnOtherPage ? 'draft-paused' : ''}`;
  const playerObj = openPlayer ? findPlayer(openPlayer) : null;

  if (resetToken) return (
    <ResetPasswordScreen token={resetToken} onDone={() => {
      setResetToken(null);
      window.history.replaceState({}, '', window.location.pathname);
    }} />
  );
  if (!user) return <Login onLogin={handleLogin} />;
  if (needsPasswordChange) return <ChangePassword user={user} onDone={handlePasswordChanged} onCancel={handleLogout} />;

  return (
    <React.Fragment>
      <LiveScoreTicker myTeamId={user?.teamId} onNav={setActive} />
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
          draftInProgress={active !== 'draft' ? draftInProgress : null}
          draftMeta={draftMeta}
          fontSize={appFontSize}
          onFontSizeChange={handleAppFontSize}
        />
        <Sidebar active={active} onNav={id => setActive(id)} user={user} lineupAlertCount={lineupAlertCount} myRosterIds={myRosterIds} cookieAlert={cookieAlert} />

        <div className="main" style={{ zoom: appFontSize / 12 }}>
          {active === 'dashboard' && <Dashboard onNav={setActive} onOpenPlayer={setOpenPlayer} user={user} myRosterIds={myRosterIds} sourcesState={sourcesState} slotOverrides={rosterSlotOverrides} watchlistIds={watchlistIds} tradeOffers={tradeOffers} showMobile={showMobile} />}
          {active === 'players'   && <PlayersScreen onOpenPlayer={setOpenPlayer} aiMode={aiMode} myRosterIds={myRosterIds} onAddPlayer={handleAddPlayer} onDropPlayer={handleDropPlayer} onClaimPlayer={handleClaimPlayer} onTradePlayer={handleTradePlayer} user={user} watchlistIds={watchlistIds} onToggleWatch={handleToggleWatch} waiverQueue={waiverQueue} playersTab={playersTab} onPlayersTabChange={setPlayersTab} />}
          {active === 'news'      && <NewsScreen onOpenPlayer={setOpenPlayer} sourcesState={sourcesState} user={user} />}
          {active === 'roster'    && <CurrentRosterScreen onNav={setActive} user={user} myRosterIds={myRosterIds} onAddPlayer={handleAddPlayer} onDropPlayer={handleDropPlayer} onClaimPlayer={handleClaimPlayer} onOpenPlayer={setOpenPlayer} watchlistIds={watchlistIds} onToggleWatch={handleToggleWatch} sourcesState={sourcesState} slotOverrides={rosterSlotOverrides} onSlotOverridesChange={handleSlotOverridesChange} tradeOffers={tradeOffers} onRespondTradeOffer={handleRespondTradeOffer} rosterSyncBadge={rosterSyncBadge} rosterLoading={rosterLoading} showMobile={showMobile} />}
          {active === 'h2h'       && <HeadToHeadScreen onOpenPlayer={setOpenPlayer} user={user} myRosterIds={myRosterIds} slotOverrides={rosterSlotOverrides} />}
          {active === 'compare'   && <CompareScreen />}
          {active === 'trade'     && <TradeScreen key={tradeInit.key} initOtherTeamId={tradeInit.otherTeamId} initGetIds={tradeInit.getIds} myRosterIds={myRosterIds} user={user} onSendTradeOffer={handleSendTradeOffer} tradeOffers={tradeOffers} onRespondTradeOffer={handleRespondTradeOffer} onDeleteTradeOffer={handleDeleteTradeOffer} />}
          {/* Draft — always mounted so timer and AI auto-picks continue when user navigates to another screen */}
          {(() => {
            const isDraftPage = active === 'draft' || active === 'draftrecap';
            const tab = active === 'draftrecap' ? 'recap' : draftTab;
            return (
              <div style={{ display: isDraftPage ? 'flex' : 'none', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
                <div className="tabs" style={{ padding: '0 18px', flexShrink: 0, borderBottom: '1px solid var(--border)', background: 'var(--bg-2)' }}>
                  <div className={`tab ${tab === 'room' ? 'active' : ''}`} onClick={() => { setActive('draft'); setDraftTab('room'); }}>● Draft Room</div>
                  <div className={`tab ${tab === 'recap' ? 'active' : ''}`} onClick={() => { setActive('draft'); setDraftTab('recap'); }}>🏆 Draft Recap</div>
                </div>
                <div style={{ flex: 1, overflow: 'hidden', minHeight: 0 }}>
                  {/* DraftRoom kept mounted at all times — display:none hides it without unmounting */}
                  <div style={{ display: tab === 'room' ? 'flex' : 'none', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
                    <DraftRoom aiMode={aiMode} user={user} onNav={id => { if (id === 'draftrecap') { setActive('draft'); setDraftTab('recap'); } else setActive(id); }} onDraftStatusChange={handleDraftStatusChange} onOpenPlayer={setOpenPlayer} onDraftPick={id => {
                      let nextIds = null;
                      setMyRosterIds(prev => {
                        const next = new Set([...prev, id]);
                        nextIds = next;
                        return next;
                      });
                      if (nextIds && userRef.current?.teamId) { backupRoster(userRef.current.teamId, nextIds); doSync(userRef.current.teamId, nextIds); }
                    }} onDraftComplete={() => {
                      refreshTeamRosters();
                      if (userRef.current?.teamId) {
                        const merged = buildMergedRoster(userRef.current.teamId, null);
                        setMyRosterIds(merged);
                        backupRoster(userRef.current.teamId, merged);
                        doSync(userRef.current.teamId, merged);
                      }
                    }} />
                  </div>
                  {tab === 'recap' && <DraftRecapScreen user={user} />}
                </div>
              </div>
            );
          })()}
          {active === 'owners'    && <OwnerIntelScreen onOpenPlayer={setOpenPlayer} user={user} myRosterIds={myRosterIds} slotOverrides={rosterSlotOverrides} />}
          {active === 'cbs'       && <PlayerDraftRankingsScreen onOpenPlayer={setOpenPlayer} />}
          {active === 'sources'       && <SourcesScreen onNav={setActive} sourcesState={sourcesState} onSourcesChange={handleSourcesChange} user={user} myRosterIds={myRosterIds} cookieAlert={cookieAlert} onCookieAlertDismiss={() => setCookieAlert(false)} />}
          {active === 'admin-owners'  && <AdminOwners />}
          {active === 'admin-scoring'  && <ScoringTestScreen user={user} />}
          {active === 'transactions'  && <TransactionsScreen />}
          {active === 'power'         && <PowerRankingsScreen user={user} myRosterIds={myRosterIds} slotOverrides={rosterSlotOverrides} showMobile={showMobile} />}
          {active === 'account'       && <AccountEditScreen user={user} />}
          {active === 'settings'      && <LeagueSettings user={user} onRosterReset={handleRosterReset} rosterResetState={rosterResetState} initialTab={settingsInitialTab} />}
        </div>

        {showAI && <AICopilot active={active} aiMode={aiMode} user={user} myRosterIds={myRosterIds} />}
        <MobileNav active={active} onNav={setActive} user={user} lineupAlertCount={lineupAlertCount} />

        {/* Return-to-Draft floating banner — shown when a mock or live draft is active and user navigated away */}
        {draftInProgress && active !== 'draft' && (() => {
          const isMock      = draftInProgress === 'mock';
          const isPaused    = draftMeta?.draftPaused;
          const isComplete  = draftMeta?.draftComplete;
          const accent      = isComplete ? '#4caf82' : isPaused ? '#ff5a6e' : isMock ? '#ffb547' : 'var(--accent-2)';
          const { isMyTurn, picksAway, seconds, currentPickNum } = draftMeta;
          const clockStr    = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
          return (
            <div style={{
              position: 'fixed', top: 36, left: '50%', transform: 'translateX(-50%)',
              zIndex: 9000, display: 'flex', alignItems: 'center', gap: 14,
              background: isComplete ? 'rgba(4,24,14,.97)' : isPaused ? 'rgba(40,8,12,.97)' : isMock ? 'rgba(30,24,0,.97)' : 'rgba(0,20,40,.97)',
              border: `1.5px solid ${accent}`,
              borderRadius: 16, padding: '12px 20px',
              boxShadow: `0 8px 40px rgba(0,0,0,.7), 0 0 28px ${isComplete ? 'rgba(76,175,130,.4)' : isPaused ? 'rgba(255,90,110,.35)' : isMock ? 'rgba(255,181,71,.3)' : 'rgba(78,168,255,.3)'}`,
              cursor: 'pointer', minWidth: 340,
              animation: isPaused && !isComplete ? 'blink 1s ease-in-out infinite' : 'none',
            }} onClick={() => setActive('draft')}>
              {/* Status dot */}
              <div style={{ width: 12, height: 12, borderRadius: '50%', background: accent, boxShadow: `0 0 10px ${accent}`, animation: isComplete ? 'none' : 'blink 0.8s infinite', flexShrink: 0 }} />

              <div style={{ flex: 1, minWidth: 0 }}>
                {/* Top row */}
                <div style={{ fontSize: 11, fontWeight: 800, color: accent, letterSpacing: '.08em', textTransform: 'uppercase', lineHeight: 1 }}>
                  {isComplete ? '✓ DRAFT COMPLETE' : isPaused ? '⏸ DRAFT PAUSED' : `${isMock ? '🏈 Mock Draft' : '🏈 Live Draft'} In Progress · Pick #${currentPickNum}`}
                </div>
                {/* Bottom row */}
                {isComplete ? (
                  <div style={{ fontSize: 13, color: 'var(--text-dim)', marginTop: 4 }}>
                    All picks are in — <span style={{ color: accent, fontWeight: 700 }}>view the Draft Recap</span>
                  </div>
                ) : isPaused ? (
                  <div style={{ fontSize: 13, color: 'var(--text-dim)', marginTop: 4 }}>
                    Commissioner paused — <span style={{ color: accent, fontWeight: 700 }}>return to draft to resume</span>
                  </div>
                ) : isMyTurn ? (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
                    <span style={{ fontSize: 15, fontWeight: 900, color: '#4caf82', letterSpacing: '.06em', animation: 'blink 0.75s infinite' }}>⚡ YOUR PICK</span>
                    <span style={{ fontFamily: 'monospace', fontSize: 20, fontWeight: 900, color: seconds < 10 ? '#ff5a6e' : seconds < 30 ? '#ff9800' : '#4caf82', animation: seconds < 10 ? 'blink 0.5s infinite' : 'none' }}>{clockStr}</span>
                    <span style={{ fontSize: 11, color: 'var(--text-dim)' }}>left on clock</span>
                  </div>
                ) : (
                  <div style={{ fontSize: 13, color: 'var(--text-dim)', marginTop: 4 }}>
                    <span style={{ color: 'var(--text)', fontWeight: 700 }}>{picksAway}</span> pick{picksAway !== 1 ? 's' : ''} until your turn
                  </div>
                )}
              </div>

              <button
                style={{ background: isComplete ? '#4caf82' : '#1affa0', color: '#000', border: 'none', borderRadius: 10, padding: '10px 22px', fontSize: 13, fontWeight: 900, cursor: 'pointer', flexShrink: 0, letterSpacing: '.05em', whiteSpace: 'nowrap', boxShadow: '0 2px 12px rgba(26,255,160,.3)' }}
                onClick={e => { e.stopPropagation(); setActive('draft'); }}
              >
                {isComplete ? '📋 View Recap' : '▶ Join Draft'}
              </button>
            </div>
          );
        })()}
      </div>

      {playerObj && <PlayerDetail player={playerObj} onClose={() => setOpenPlayer(null)} myRosterIds={myRosterIds} onAddPlayer={handleAddPlayer} onTradePlayer={handleTradePlayer} sourcesState={sourcesState} />}

      {rosterError && (() => {
        const isRosterFull = rosterError.title === 'Roster Full' && rosterError.addingPlayerId;
        const addingPlayer = isRosterFull ? findPlayer(rosterError.addingPlayerId) : null;
        const POS_ORDER = ['QB','RB','WR','TE','K','DST'];
        const rosterPlayers = isRosterFull
          ? [...myRosterIds]
              .map(id => findPlayer(id))
              .filter(Boolean)
              .sort((a, b) => (POS_ORDER.indexOf(a.pos) - POS_ORDER.indexOf(b.pos)) || (b.avg || 0) - (a.avg || 0))
          : [];
        const POS_COLOR = { QB: 'var(--pos-qb)', RB: 'var(--pos-rb)', WR: 'var(--pos-wr)', TE: 'var(--pos-te)', K: 'var(--pos-k)', DST: 'var(--pos-dst)' };
        return (
          <div style={{ position: 'fixed', inset: 0, zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,.65)', backdropFilter: 'blur(4px)' }}
            onClick={() => setRosterError(null)}>
            <div style={{ background: 'var(--card)', border: `1px solid ${isRosterFull ? 'var(--border)' : '#ff5a6e'}`, borderRadius: 14, padding: isRosterFull ? '0' : '28px 32px', maxWidth: isRosterFull ? 460 : 400, width: '94%', boxShadow: '0 24px 60px rgba(0,0,0,.55)', display: 'flex', flexDirection: 'column', maxHeight: '85vh' }}
              onClick={e => e.stopPropagation()}>
              {isRosterFull ? (
                <>
                  {/* Header */}
                  <div style={{ padding: '16px 18px 12px', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 800, color: 'var(--text)', marginBottom: 4 }}>Drop a player to add</div>
                    {addingPlayer && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                        <span style={{ fontSize: 10, fontWeight: 800, fontFamily: 'var(--font-mono)', color: POS_COLOR[addingPlayer.pos] || 'var(--accent)', background: `${POS_COLOR[addingPlayer.pos] || 'var(--accent)'}22`, border: `1px solid ${POS_COLOR[addingPlayer.pos] || 'var(--accent)'}55`, borderRadius: 4, padding: '1px 5px' }}>{addingPlayer.pos}</span>
                        <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--accent)' }}>{addingPlayer.name}</span>
                        <span style={{ fontSize: 11, color: 'var(--text-faint)', fontFamily: 'var(--font-mono)' }}>{addingPlayer.team}</span>
                        {addingPlayer.avg != null && <span style={{ fontSize: 11, color: 'var(--good)', fontFamily: 'var(--font-mono)', marginLeft: 2 }}>{(+addingPlayer.avg).toFixed(1)} avg</span>}
                      </div>
                    )}
                  </div>
                  {/* Roster list */}
                  <div style={{ overflowY: 'auto', flex: 1, padding: '6px 0' }}>
                    {rosterPlayers.map(p => (
                      <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 18px', borderBottom: '1px solid rgba(255,255,255,.04)' }}>
                        <span style={{ fontSize: 9, fontWeight: 800, fontFamily: 'var(--font-mono)', color: POS_COLOR[p.pos] || 'var(--text-dim)', background: `${POS_COLOR[p.pos] || '#888'}22`, border: `1px solid ${POS_COLOR[p.pos] || '#888'}44`, borderRadius: 3, padding: '1px 4px', flexShrink: 0 }}>{p.pos}</span>
                        <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</span>
                        <span style={{ fontSize: 10, color: 'var(--text-faint)', fontFamily: 'var(--font-mono)', flexShrink: 0 }}>{p.team}</span>
                        {p.avg != null && <span style={{ fontSize: 10, color: 'var(--text-dim)', fontFamily: 'var(--font-mono)', flexShrink: 0, minWidth: 32, textAlign: 'right' }}>{(+p.avg).toFixed(1)}</span>}
                        <button
                          onClick={() => { handleClaimPlayer(rosterError.addingPlayerId, p.id); setRosterError(null); }}
                          style={{ flexShrink: 0, fontSize: 10, fontWeight: 700, padding: '4px 10px', borderRadius: 6, border: '1px solid rgba(255,90,110,.5)', background: 'rgba(255,90,110,.12)', color: '#ff5a6e', cursor: 'pointer' }}
                        >Drop & Add</button>
                      </div>
                    ))}
                  </div>
                  {/* Footer */}
                  <div style={{ padding: '10px 18px', borderTop: '1px solid var(--border)', flexShrink: 0, display: 'flex', gap: 8 }}>
                    <button className="btn ghost sm" onClick={() => setRosterError(null)}>Cancel</button>
                    <button className="btn ghost sm" style={{ marginLeft: 'auto' }} onClick={() => { setRosterError(null); setSettingsInitialTab('roster'); setActive('settings'); }}>
                      Roster Rules
                    </button>
                  </div>
                </>
              ) : (
                <div style={{ padding: '28px 32px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
                    <span style={{ fontSize: 22 }}>🚫</span>
                    <div style={{ fontSize: 15, fontWeight: 800, color: '#ff5a6e' }}>{rosterError.title}</div>
                  </div>
                  <div style={{ fontSize: 13, color: 'var(--text-dim)', lineHeight: 1.65, marginBottom: 20 }}>{rosterError.detail}</div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button className="btn ghost sm" onClick={() => { setRosterError(null); setSettingsInitialTab('roster'); setActive('settings'); }}>
                      View Roster Rules
                    </button>
                    <button className="btn primary sm" onClick={() => setRosterError(null)}>OK</button>
                  </div>
                </div>
              )}
            </div>
          </div>
        );
      })()}

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

      {pushBanner && <PushBanner title={pushBanner.title} body={pushBanner.body} onDismiss={() => setPushBanner(null)} />}

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
