import React from 'react';
import { LEAGUE_TEAMS, TEAM_ROSTERS, findTeam, buildRosterFrame, assignRoster } from '../lib/data.js';
import { findPlayer, usePlayers } from '../lib/playerStore.js';
import { getSubscriptionState, subscribeToPush, unsubscribeFromPush, showLocalNotification } from '../lib/pushNotifications.js';
import { getPrefs } from '../lib/remotePrefs.js';

function getDraftStatus() {
  try {
    const s = JSON.parse(localStorage.getItem('fantasai_league_settings') || 'null');
    const draft = s?.draft || {};
    const picks = Array.isArray(draft.picks) ? draft.picks : [];
    if (picks.length >= 192) return { badge: 'COMPLETE', live: false };
    const d = draft.date ? new Date(draft.date) : null;
    const now = new Date();
    if (d && d <= now) return { badge: 'LIVE', live: true };
    if (d) {
      const label = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      return { badge: label, live: false };
    }
    return { badge: 'SOON', live: false };
  } catch { return { badge: 'SOON', live: false }; }
}

const H2H_SEASON_START = new Date('2026-09-09');
const H2H_WEEKS = 14;

function getH2HWeek() {
  const today = new Date();
  if (today < H2H_SEASON_START) return 1;
  const msPerWeek = 7 * 24 * 60 * 60 * 1000;
  return Math.min(Math.max(Math.floor((today - H2H_SEASON_START) / msPerWeek) + 1, 1), H2H_WEEKS);
}


export const TopBar = ({ crumbs, right, onMenu, showMobile, onToggleView, showChat, onToggleChat, user, onLogout, onExport, draftInProgress, draftMeta, fontSize, onFontSizeChange }) => {
  const isComplete = draftInProgress && draftMeta?.draftComplete;
  const isPaused   = draftInProgress && !isComplete && draftMeta?.draftPaused;
  const isActive   = draftInProgress && !isComplete && !isPaused;
  return (
  <div className="topbar" style={isComplete ? {
    background: 'linear-gradient(180deg, rgba(76,175,130,.14) 0%, rgba(76,175,130,.05) 100%)',
  } : isActive ? {
    background: 'linear-gradient(180deg, rgba(76,175,130,.18) 0%, rgba(76,175,130,.07) 100%)',
    animation: 'blink 2.2s ease-in-out infinite',
  } : {}}>
    <div className="crumbs" style={{ display: 'flex', alignItems: 'center', gap: 0, flexWrap: 'nowrap' }}>
      {crumbs.map((c, i) => (
        <React.Fragment key={i}>
          {i > 0 && <span className="sep">/</span>}
          <span className={i === crumbs.length - 1 ? 'cur' : ''}>{c}</span>
        </React.Fragment>
      ))}
      {isComplete && (
        <span style={{ marginLeft: 10, display: 'inline-flex', alignItems: 'center', gap: 4, background: 'rgba(76,175,130,.15)', border: '1px solid rgba(76,175,130,.4)', borderRadius: 6, padding: '2px 8px', fontSize: 11, fontWeight: 800, color: '#4caf82', letterSpacing: '.05em', whiteSpace: 'nowrap' }}>
          ✓ DRAFT COMPLETE
        </span>
      )}
      {isPaused && (
        <span style={{ marginLeft: 10, display: 'inline-flex', alignItems: 'center', gap: 4, background: 'rgba(255,90,110,.2)', border: '1px solid rgba(255,90,110,.5)', borderRadius: 6, padding: '2px 8px', fontSize: 11, fontWeight: 800, color: '#ff5a6e', letterSpacing: '.05em', whiteSpace: 'nowrap', animation: 'blink 1s ease-in-out infinite' }}>
          ⏸ DRAFT PAUSED
        </span>
      )}
      {isActive && draftMeta?.onClockTeamName && (
        <span style={{ marginLeft: 10, display: 'inline-flex', alignItems: 'center', gap: 4, background: 'rgba(76,175,130,.2)', border: '1px solid rgba(76,175,130,.4)', borderRadius: 6, padding: '2px 8px', fontSize: 11, fontWeight: 800, color: '#4caf82', letterSpacing: '.05em', whiteSpace: 'nowrap' }}>
          {draftMeta.onClockTeamLogo} {draftMeta.onClockTeamName} ON CLOCK
        </span>
      )}
    </div>
    <div className="topbar-right">
      {right}
      {onFontSizeChange && (
        <div className="hide-mobile" style={{ display: 'flex', alignItems: 'center', gap: 6, marginRight: 8, background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 6, padding: '4px 10px' }}>
          <span style={{ fontSize: 10, color: 'var(--text-faint)', fontWeight: 600 }}>Aa</span>
          <input type="range" min={10} max={20} step={1} value={fontSize || 12}
            onChange={e => onFontSizeChange(Number(e.target.value))}
            style={{ width: 80, height: 4, accentColor: 'var(--accent-2)', cursor: 'pointer' }}
            title={`Font size: ${fontSize}px`}
          />
          <span style={{ fontSize: 16, color: 'var(--text-faint)', fontWeight: 700 }}>Aa</span>
          <span style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--accent-2)', fontWeight: 700, minWidth: 22, textAlign: 'center' }}>{fontSize || 12}</span>
        </div>
      )}
      {onExport && (
        <button
          className="btn ghost sm hide-mobile"
          onClick={onExport}
          title="Export current page data"
          style={{ gap: 5 }}
        >
          ⇣ Export
        </button>
      )}
      {onToggleView && (
        <div className="view-toggle hide-mobile" title="Switch between mobile preview and full desktop layout">
          <button className={`vt-btn${showMobile ? ' active' : ''}`} onClick={() => onToggleView(true)}>
            <span>▣</span> Mobile
          </button>
          <button className={`vt-btn${!showMobile ? ' active' : ''}`} onClick={() => onToggleView(false)}>
            <span>⬛</span> Desktop
          </button>
        </div>
      )}
      {onToggleChat && (
        <button
          className={`chat-toggle-btn hide-mobile${showChat ? ' active' : ''}`}
          onClick={onToggleChat}
          title={showChat ? 'Hide FantasAI Chat' : 'Show FantasAI Chat'}
        >
          <span className="ct-orb" />
          <span className="ai-mark" style={{ fontSize: 9, padding: '1px 4px', borderRadius: 3, marginRight: 2 }}>AI</span>
          Chat
        </button>
      )}
      {user && (
        <div className="user-avatar-wrap hide-mobile">
          <div
            className="avatar"
            style={{ width: 28, height: 28, background: user.color || '#c6ff3a', fontSize: 10, color: '#0a1300', cursor: 'default' }}
            title={user.teamName}
          >
            <span style={{ position: 'relative', zIndex: 1 }}>{user.logo}</span>
          </div>
          <button className="btn ghost sm" onClick={onLogout} title="Sign out" style={{ padding: '4px 8px', fontSize: 11 }}>
            Sign Out
          </button>
        </div>
      )}
    </div>
  </div>
  );
};

function SidebarPushButton({ teamId }) {
  const [state, setState]   = React.useState('init'); // init|unsupported|unsubscribed|subscribed|denied
  const [busy, setBusy]     = React.useState(false);

  React.useEffect(() => { getSubscriptionState().then(setState); }, []);

  async function toggle() {
    if (busy || state === 'denied' || state === 'unsupported') return;
    setBusy(true);
    if (state === 'subscribed') {
      await unsubscribeFromPush();
      setState('unsubscribed');
    } else {
      const sub = await subscribeToPush(teamId ?? null);
      if (sub) {
        showLocalNotification('FantasAI Alerts Active', 'Push notifications are now enabled.');
        setState('subscribed');
      } else {
        setState(Notification.permission === 'denied' ? 'denied' : 'unsubscribed');
      }
    }
    setBusy(false);
  }

  if (state === 'init' || state === 'unsupported') return null;

  const on = state === 'subscribed';
  const denied = state === 'denied';

  return (
    <button
      onClick={toggle}
      disabled={busy || denied}
      title={denied ? 'Notifications blocked — enable in browser settings' : on ? 'Click to turn off push alerts' : 'Click to enable push alerts'}
      style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'none', border: 'none', padding: '2px 0', cursor: denied ? 'not-allowed' : 'pointer', opacity: busy ? 0.6 : 1 }}
    >
      {/* Toggle track */}
      <span style={{
        position: 'relative', display: 'inline-block',
        width: 32, height: 18, borderRadius: 9, flexShrink: 0,
        background: on ? 'var(--accent)' : denied ? 'rgba(255,255,255,.1)' : 'rgba(255,255,255,.15)',
        transition: 'background .2s',
        border: `1px solid ${on ? 'var(--accent)' : 'rgba(255,255,255,.2)'}`,
      }}>
        <span style={{
          position: 'absolute', top: 2, left: on ? 14 : 2,
          width: 12, height: 12, borderRadius: '50%',
          background: on ? '#0a1300' : denied ? 'rgba(255,255,255,.3)' : '#fff',
          transition: 'left .2s',
        }} />
      </span>
      <span style={{
        fontSize: 10, fontFamily: 'var(--font-mono)', fontWeight: 700,
        color: on ? 'var(--accent)' : denied ? 'var(--text-faint)' : 'var(--text-dim)',
        letterSpacing: '.04em',
      }}>
        {denied ? 'Alerts Blocked' : on ? 'Push Alerts On' : 'Push Alerts Off'}
      </span>
    </button>
  );
}

export const Sidebar = ({ active, onNav, user, lineupAlertCount = 0, myRosterIds, cookieAlert = false, collapsed = false, onToggleCollapse }) => {
  const isAdmin = user?.isAdmin;
  const allPlayers = usePlayers(); // subscribe so h2hInfo recomputes when player projections load

  const h2hInfo = React.useMemo(() => {
    const teamId = user?.teamId;
    if (!teamId) return null;

    const week = getH2HWeek();

    // Prefer the commissioner-set schedule stored in localStorage
    let weekMatchups = null;
    try {
      const saved = JSON.parse(localStorage.getItem('fantasai_league_settings') || 'null');
      const ms = saved?.matchupSchedule;
      if (ms) weekMatchups = ms[week] || ms[String(week)] || null;
    } catch {}

    // Fallback: generate a round-robin from LEAGUE_TEAMS
    if (!weekMatchups) {
      const ids = LEAGUE_TEAMS.map(t => t.id);
      const n = ids.length;
      const rest = ids.slice(1);
      const rot = (week - 1) % (n - 1);
      const rotated = [...rest.slice(rot), ...rest.slice(0, rot)];
      const circle = [ids[0], ...rotated];
      weekMatchups = Array.from({ length: Math.floor(n / 2) }, (_, i) => [circle[i], circle[n - 1 - i]]);
    }

    const pair = weekMatchups.find(([a, b]) => a === teamId || b === teamId);
    if (!pair) return null;

    const oppId = pair[0] === teamId ? pair[1] : pair[0];
    const oppTeam = LEAGUE_TEAMS.find(t => t.id === oppId);

    // Use slot-aware assignRoster for both sides — same logic as the H2H page's WinProbabilityBar
    function rosterStarterProj(rosterIds, slotOverrides = {}) {
      try {
        const settings = JSON.parse(localStorage.getItem('fantasai_league_settings') || 'null');
        const slotFrame = buildRosterFrame(settings);
        const roster = assignRoster(slotFrame, rosterIds, slotOverrides, findPlayer);
        return roster
          .filter(r => r.slot !== 'BENCH' && r.playerId)
          .reduce((s, e) => { const p = findPlayer(e.playerId); return s + Math.max(0, p?.proj || p?.avg || 0); }, 0);
      } catch { return 0; }
    }

    const myIds = myRosterIds && myRosterIds.size > 0
      ? myRosterIds
      : new Set((TEAM_ROSTERS[teamId] || []).map(e => e.playerId).filter(Boolean));
    const mySlotOverrides = getPrefs().slotOverrides || {};

    const oppIds = new Set((TEAM_ROSTERS[oppId] || []).map(e => e.playerId).filter(Boolean));

    const myProj  = rosterStarterProj(myIds, mySlotOverrides);
    const oppProj = rosterStarterProj(oppIds);
    const isWinning = myProj >= oppProj;
    const winPct = myProj + oppProj > 0 ? Math.round((myProj / (myProj + oppProj)) * 100) : 50;

    return { week, oppTeam, isWinning, winPct, myProj: Math.round(myProj * 10) / 10, oppProj: Math.round(oppProj * 10) / 10 };
  }, [user?.teamId, myRosterIds, allPlayers]);

  const items = [
    { group: 'League' },
    { id: 'dashboard', label: 'Dashboard',      icon: '🏈' },
    { id: 'roster',    label: 'Current Roster',  icon: '📋' },
    { id: 'h2h',       label: 'Head to Head',    icon: '⚔' },
    { id: 'power',     label: 'Power Rankings',  icon: '⚡' },
    { id: 'players',   label: 'Players',          icon: '👥' },
    { id: 'news',      label: 'News & Updates',   icon: '📰' },
    { id: 'transactions',  label: 'Transactions',      icon: '📒' },
    { group: 'Tools' },
    { id: 'account',   label: 'My Account / Team', icon: '⊙' },
    { id: 'compare',   label: 'Compare',           icon: '⚖' },
    { id: 'trade',     label: 'Trade Analyzer',    icon: '↔' },
    { group: 'Draft' },
    { id: 'draft',      label: 'Draft Room',        icon: '●', ...(() => { const ds = getDraftStatus(); return { badge: ds.badge, live: ds.live }; })() },
    { id: 'owners',     label: 'Owner Intel',       icon: '◉' },
    { id: 'cbs',        label: 'Player Draft Rankings',     icon: '▦' },
    { group: 'Betting' },
    { id: 'dfs-optimizer', label: 'DFS Optimizer',  icon: '💰' },
    { group: 'Setup' },
    { id: 'sources',  label: 'Sources',          icon: '⌁', ...(cookieAlert ? { badge: '!', alert: true } : {}) },
    { id: 'settings', label: 'Rules & Settings',  icon: '📋' },
    ...(isAdmin ? [
      { group: 'Admin' },
      { id: 'admin-owners',  label: 'Owners',       icon: '👤' },
      { id: 'admin-scoring', label: 'Scoring Test',  icon: '🧮' },
      { id: 'admin-loginlog', label: 'Login Log',    icon: '🔑' },
      { id: 'admin-leagues',  label: 'Leagues',       icon: '🏆' },
    ] : []),
  ];

  return (
    <div className="side" style={{ padding: collapsed ? '10px 6px' : '12px 8px' }}>
      <div style={{ display: 'flex', justifyContent: collapsed ? 'center' : 'flex-end', marginBottom: 8 }}>
        <button
          className="btn ghost sm"
          onClick={() => onToggleCollapse?.()}
          title={collapsed ? 'Expand navigation' : 'Collapse navigation'}
          style={{
            minWidth: collapsed ? 30 : 44,
            height: 28,
            padding: collapsed ? '0 6px' : '0 10px',
            fontSize: 13,
            lineHeight: 1,
            justifyContent: 'center',
          }}
        >
          {collapsed ? '»' : '«'}
        </button>
      </div>
      {(() => {
        const myTeam = findTeam(user?.teamId || 1) || LEAGUE_TEAMS[0];
        return (
          <div className="team-card" style={collapsed ? { padding: 8, margin: '8px 4px' } : undefined}>
            {!collapsed && <div className="label">My Team</div>}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: collapsed ? 'center' : undefined, gap: 12, marginBottom: collapsed ? 0 : 8 }}>
              {myTeam.logoImg ? (
                <img src={myTeam.logoImg} alt="logo" title={myTeam.name} style={{ width: collapsed ? 40 : 80, height: collapsed ? 40 : 80, borderRadius: collapsed ? 10 : 14, objectFit: 'cover', flexShrink: 0, boxShadow: '0 4px 16px rgba(0,0,0,.45)' }} />
              ) : (
                <span title={myTeam.name} style={{ width: collapsed ? 40 : 80, height: collapsed ? 40 : 80, borderRadius: collapsed ? 10 : 14, background: myTeam.color, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: collapsed ? 18 : 28, fontWeight: 900, color: '#000', flexShrink: 0, boxShadow: '0 4px 16px rgba(0,0,0,.45)' }}>
                  {myTeam.logo}
                </span>
              )}
              {!collapsed && <div className="name" style={{ margin: 0, lineHeight: 1.2 }}>{myTeam.name}</div>}
            </div>
            {!collapsed && new Date() >= H2H_SEASON_START && (
            <div className="stats">
              <div><div className="k">Rec</div><div className="v">{myTeam.record || '0–0'}</div></div>
              <div><div className="k">PF</div><div className="v">{(myTeam.pf || 0).toLocaleString('en', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}</div></div>
            </div>
            )}
          </div>
        );
      })()}
      {items.map((it, i) => it.group ? (
        collapsed ? null :
        <div key={i} className="nav-section">{it.group}</div>
      ) : it.id === 'h2h' ? (
        <div key="h2h"
          className={`nav-item ${active === 'h2h' ? 'active' : ''}`}
          onClick={() => onNav('h2h')}
          title="Head to Head"
          style={collapsed
            ? { justifyContent: 'center', padding: '10px 8px' }
            : { alignItems: h2hInfo ? 'flex-start' : 'center' }}>
          <span className="icon" style={{ marginTop: h2hInfo ? 2 : 0 }}>⚔</span>
          {!collapsed && <div style={{ flex: 1, minWidth: 0 }}>
            <span>Head to Head</span>
            {h2hInfo && (() => {
              const isClose = Math.abs(h2hInfo.winPct - 50) <= 3; // matches H2H bar: |homePct - awayPct| <= 6
              const color = isClose ? '#e0c84b' : h2hInfo.isWinning ? '#4ed87b' : '#ff5a6e';
              const verb  = isClose ? 'vs' : h2hInfo.isWinning ? 'Beating' : 'Losing to';
              const opp   = h2hInfo.oppTeam?.logo || '??';
              const bgAlpha   = isClose ? 'rgba(224,200,75,.2)'  : h2hInfo.isWinning ? 'rgba(78,216,123,.2)'  : 'rgba(255,90,110,.2)';
              const bdrAlpha  = isClose ? 'rgba(224,200,75,.4)'  : h2hInfo.isWinning ? 'rgba(78,216,123,.4)'  : 'rgba(255,90,110,.4)';
              return (
                <div style={{ fontSize: 10, fontWeight: 700, color, marginTop: 3, lineHeight: 1.3, display: 'flex', alignItems: 'center', gap: 5 }}>
                  <span>Wk{h2hInfo.week} · {verb} {opp}</span>
                  <span style={{
                    fontFamily: 'var(--font-mono)', fontSize: 10, fontWeight: 800,
                    background: bgAlpha, color, border: `1px solid ${bdrAlpha}`,
                    borderRadius: 4, padding: '1px 5px', flexShrink: 0,
                  }}>{h2hInfo.winPct}%</span>
                </div>
              );
            })()}
          </div>}
        </div>
      ) : (
        <div key={it.id}
          className={`nav-item ${active === it.id ? 'active' : ''} ${it.live ? 'live' : ''}`}
          onClick={() => onNav(it.id)}
          title={it.label}
          style={collapsed ? { justifyContent: 'center', padding: '10px 8px', position: 'relative' } : undefined}>
          <span className="icon">{it.icon}</span>
          {!collapsed && <span style={{ flex: 1 }}>{it.label}</span>}
          {it.badge && (
            <span
              className="badge"
              style={
                collapsed
                  ? {
                      position: 'absolute',
                      top: 5,
                      right: 6,
                      marginLeft: 0,
                      ...(it.alert ? { background: 'var(--danger)', color: '#fff', fontWeight: 900, animation: 'pulse 2s infinite' } : {}),
                    }
                  : (it.alert ? { background: 'var(--danger)', color: '#fff', fontWeight: 900, animation: 'pulse 2s infinite' } : undefined)
              }
            >
              {it.badge}
            </span>
          )}
        </div>
      ))}
      <div style={{ padding: collapsed ? '12px 8px' : '16px 14px', borderTop: '1px solid var(--border)', marginTop: 20, display: 'flex', flexDirection: 'column', gap: 8, alignItems: collapsed ? 'center' : undefined }}>
        <SidebarPushButton teamId={user?.teamId} />
      </div>
    </div>
  );
};

const BASE_SECTIONS = [
  {
    group: 'League',
    items: [
      { id: 'dashboard', label: 'Dashboard',       icon: '🏈' },
      { id: 'roster',    label: 'Current Roster',  icon: '📋' },
      { id: 'power',     label: 'Power Rankings',  icon: '⚡' },
        { id: 'players',   label: 'Players',          icon: '👥' },
      { id: 'news',      label: 'News & Updates',   icon: '📰' },
    ],
  },
  {
    group: 'Tools',
    items: [
      { id: 'compare',   label: 'Compare',         icon: '⚖' },
      { id: 'trade',     label: 'Trade Analyzer',  icon: '↔' },
    ],
  },
  {
    group: 'Draft',
    items: [
      { id: 'draft',      label: 'Draft Room',      icon: '●',  ...(() => { const ds = getDraftStatus(); return { badge: ds.badge, live: ds.live }; })() },
      { id: 'owners',     label: 'Owner Intel',    icon: '◉' },
      { id: 'cbs',        label: 'Player Draft Rankings',   icon: '▦' },
    ],
  },
  {
    group: 'Betting',
    items: [
      { id: 'dfs-optimizer', label: 'DFS Optimizer', icon: '💰' },
    ],
  },
  {
    group: 'Setup',
    items: [
      { id: 'sources',  label: 'Sources',          icon: '⌁' },
      { id: 'settings', label: 'Rules & Settings', icon: '📋' },
    ],
  },
];

export const MobileNav = ({ active, onNav, user, lineupAlertCount = 0 }) => {
  const [showMore, setShowMore] = React.useState(false);
  const isAdmin = user?.isAdmin;
  // Inject the dynamic lineup alert badge into the static BASE_SECTIONS
  const MORE_SECTIONS = React.useMemo(() => {
    const sections = BASE_SECTIONS.map(sec => ({
      ...sec,
      items: sec.items.map(it =>
        it.id === 'lineup' && lineupAlertCount > 0
          ? { ...it, badge: String(lineupAlertCount), alert: true }
          : it
      ),
    }));
    return [...sections, ...(isAdmin ? [{ group: 'Admin', items: [{ id: 'admin-owners', label: 'Owners', icon: '👤' }, { id: 'admin-scoring', label: 'Scoring Test', icon: '🧮' }, { id: 'admin-loginlog', label: 'Login Log', icon: '🔑' }, { id: 'admin-leagues', label: 'Leagues', icon: '🏆' }] }] : [])];
  }, [isAdmin, lineupAlertCount]);

  const tabs = [
    { id: 'dashboard', label: 'Home',    icon: '🏈' },
    { id: 'players',   label: 'Players', icon: '👥' },
    { id: 'news',      label: 'News',    icon: '📰' },
    { id: 'draft',     label: 'Draft',   icon: '●' },
  ];

  function navigate(id) {
    onNav(id);
    setShowMore(false);
  }

  return (
    <>
      <div className="mob-nav">
        {tabs.map(it => (
          <div key={it.id} className={`item ${active === it.id && !showMore ? 'active' : ''}`}
            onClick={() => { setShowMore(false); onNav(it.id); }}>
            <div style={{ fontSize: 16 }}>{it.icon}</div>
            <div>{it.label}</div>
          </div>
        ))}
        <div className={`item ${showMore ? 'active' : ''}`} onClick={() => setShowMore(v => !v)}>
          <div style={{ fontSize: 18, lineHeight: 1 }}>⋯</div>
          <div>More</div>
        </div>
      </div>

      {showMore && (
        <div className="mob-menu-overlay" onClick={() => setShowMore(false)}>
          <div className="mob-menu" onClick={e => e.stopPropagation()}>
            <div className="mob-menu-handle" />
            <div style={{ padding: '4px 16px 10px', fontFamily: 'var(--font-display)', fontWeight: 900, fontStretch: '75%', fontSize: 15, letterSpacing: '-.01em', textTransform: 'uppercase', color: 'var(--text)' }}>
              <span style={{ background: 'var(--accent)', color: 'var(--accent-ink)', padding: '1px 5px', borderRadius: 4, marginRight: 4, fontSize: 11 }}>AI</span>
              FantasAI
            </div>
            {MORE_SECTIONS.map(sec => (
              <div key={sec.group}>
                <div className="mob-menu-section">{sec.group}</div>
                {sec.items.map(it => (
                  <div key={it.id}
                    className={`mob-menu-item ${active === it.id ? 'active' : ''} ${it.live ? 'live' : ''}`}
                    onClick={() => navigate(it.id)}>
                    <span className="mob-menu-icon">{it.icon}</span>
                    <span className="mob-menu-label">{it.label}</span>
                    {it.badge && (
                      <span
                        className={`mob-menu-badge ${it.live ? 'live' : ''}`}
                        style={it.alert ? { background: 'var(--danger)', color: '#fff', fontWeight: 900 } : undefined}
                      >{it.badge}</span>
                    )}
                    {active === it.id && <span style={{ marginLeft: 'auto', color: 'var(--accent)', fontSize: 14 }}>●</span>}
                  </div>
                ))}
              </div>
            ))}
            <div style={{ height: 8 }} />
          </div>
        </div>
      )}
    </>
  );
};
