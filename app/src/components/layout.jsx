import React from 'react';

export const TopBar = ({ crumbs, right, onMenu, showMobile, onToggleView, showChat, onToggleChat, user, onLogout, onExport }) => (
  <div className="topbar">
    <div className="crumbs">
      {crumbs.map((c, i) => (
        <React.Fragment key={i}>
          {i > 0 && <span className="sep">/</span>}
          <span className={i === crumbs.length - 1 ? 'cur' : ''}>{c}</span>
        </React.Fragment>
      ))}
    </div>
    <div className="topbar-right">
      {right}
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

export const Sidebar = ({ active, onNav, user }) => {
  const isAdmin = user?.isAdmin;
  const items = [
    { group: 'League' },
    { id: 'dashboard', label: 'Dashboard',      icon: '🏈' },
    { id: 'roster',    label: 'Current Roster',  icon: '📋' },
    { id: 'players',   label: 'Players',          icon: '👥', badge: 'All' },
    { id: 'news',      label: 'News & Updates',   icon: '📰', badge: '9', live: true },
    { id: 'waivers',   label: 'Waivers',           icon: '📑' },
    { group: 'Tools' },
    { id: 'compare',   label: 'Compare',           icon: '⚖' },
    { id: 'watchlist', label: 'Watchlist',          icon: '★', badge: '8' },
    { id: 'trade',     label: 'Trade Analyzer',    icon: '↔' },
    { group: 'Draft' },
    { id: 'draft',     label: 'Draft Room',        icon: '●', badge: 'LIVE', live: true },
    { id: 'owners',    label: 'Owner Intel',       icon: '◉', badge: '12' },
    { id: 'cbs',       label: 'CBS Rankings',      icon: '▦', badge: '432' },
    { group: 'Setup' },
    { id: 'sources',   label: 'Sources',           icon: '⌁', badge: 'CBS' },
    ...(isAdmin ? [
      { group: 'Admin' },
      { id: 'admin-owners', label: 'Owners', icon: '👤' },
    ] : []),
  ];
  return (
    <div className="side">
      <div className="team-card">
        <div className="label">My Team</div>
        <div className="name">Armed Rodgery</div>
        <div className="stats">
          <div><div className="k">Rec</div><div className="v">7–3</div></div>
          <div><div className="k">PF</div><div className="v">1,284.6</div></div>
          <div><div className="k">Rank</div><div className="v">#3</div></div>
        </div>
      </div>
      {items.map((it, i) => it.group ? (
        <div key={i} className="nav-section">{it.group}</div>
      ) : (
        <div key={it.id}
          className={`nav-item ${active === it.id ? 'active' : ''} ${it.live ? 'live' : ''}`}
          onClick={() => onNav(it.id)}>
          <span className="icon">{it.icon}</span>
          <span>{it.label}</span>
          {it.badge && <span className="badge">{it.badge}</span>}
        </div>
      ))}
      <div style={{ padding: '20px 14px', borderTop: '1px solid var(--border)', marginTop: 20 }}>
        <div style={{ fontSize: 10, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '.12em', marginBottom: 6, fontWeight: 700 }}>Week 11 · 2025</div>
        <div style={{ fontSize: 11, color: 'var(--text-dim)' }}>Lock: Sun 1:00pm ET</div>
        <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 2, fontFamily: 'var(--font-mono)' }}>3d 14h 22m</div>
      </div>
    </div>
  );
};

const BASE_SECTIONS = [
  {
    group: 'League',
    items: [
      { id: 'dashboard', label: 'Dashboard',      icon: '🏈' },
      { id: 'roster',    label: 'Current Roster', icon: '📋' },
      { id: 'players',   label: 'Players',         icon: '👥', badge: 'All' },
      { id: 'news',      label: 'News & Updates',  icon: '📰', badge: '9',  live: true },
      { id: 'waivers',   label: 'Waivers',          icon: '📑' },
    ],
  },
  {
    group: 'Tools',
    items: [
      { id: 'compare',   label: 'Compare',         icon: '⚖' },
      { id: 'watchlist', label: 'Watchlist',        icon: '★',  badge: '8' },
      { id: 'trade',     label: 'Trade Analyzer',  icon: '↔' },
    ],
  },
  {
    group: 'Draft',
    items: [
      { id: 'draft',     label: 'Draft Room',      icon: '●',  badge: 'LIVE', live: true },
      { id: 'owners',    label: 'Owner Intel',     icon: '◉',  badge: '12' },
      { id: 'cbs',       label: 'CBS Rankings',    icon: '▦',  badge: '432' },
    ],
  },
  {
    group: 'Setup',
    items: [
      { id: 'sources',   label: 'Sources',         icon: '⌁',  badge: 'CBS' },
    ],
  },
];

export const MobileNav = ({ active, onNav, user }) => {
  const [showMore, setShowMore] = React.useState(false);
  const isAdmin = user?.isAdmin;
  const MORE_SECTIONS = [
    ...BASE_SECTIONS,
    ...(isAdmin ? [{ group: 'Admin', items: [{ id: 'admin-owners', label: 'Owners', icon: '👤' }] }] : []),
  ];

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
                      <span className={`mob-menu-badge ${it.live ? 'live' : ''}`}>{it.badge}</span>
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
