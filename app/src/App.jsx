import React from 'react';
import { findPlayer, findTeam, MY_ROSTER, TEAM_ROSTERS, PLAYERS, LEAGUE_TEAMS, FREE_DATA_SOURCES, RANKING_SOURCES } from './lib/data.js';
import { Sidebar, TopBar, MobileNav } from './components/layout.jsx';
import AICopilot from './components/AICopilot.jsx';
import { TweaksPanel, TweakSection, TweakColor, TweakRadio, TweakToggle, useTweaks } from './components/TweaksPanel.jsx';

import Login from './screens/Login.jsx';
import Dashboard from './screens/Dashboard.jsx';
import PlayersScreen, { PlayerDetail } from './screens/Players.jsx';
import NewsScreen from './screens/News.jsx';
import CompareScreen from './screens/Compare.jsx';
import WatchlistScreen from './screens/Watchlist.jsx';
import TradeScreen from './screens/Trade.jsx';
import DraftRoom from './screens/DraftRoom.jsx';
import OwnerIntelScreen from './screens/OwnerIntel.jsx';
import { CBSRankingsScreen } from './components/CBSConnectModal.jsx';
import SourcesScreen from './screens/Sources.jsx';
import AdminOwners from './screens/AdminOwners.jsx';
import CurrentRosterScreen from './screens/CurrentRoster.jsx';
import WaiversScreen from './screens/Waivers.jsx';

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
  waivers:   ['League', 'Waivers'],
  compare:   ['Tools', 'Compare'],
  watchlist: ['Tools', 'Watchlist'],
  trade:     ['Tools', 'Trade Analyzer'],
  draft:     ['Draft', 'Live Draft Room'],
  owners:    ['Draft', 'Owner Intel · Draft DNA'],
  cbs:       ['Draft', 'CBS Sports Rankings'],
  sources:       ['Setup', 'Sources & Connections'],
  'admin-owners': ['Admin', 'Owner Management'],
};

export default function App() {
  const [tweaks, setTweak] = useTweaks(TWEAK_DEFAULTS);
  const [active, setActive] = React.useState('dashboard');
  const [openPlayer, setOpenPlayer] = React.useState(null);
  const [user, setUser] = React.useState(() => {
    try { return JSON.parse(localStorage.getItem('fantasai_user') || 'null'); } catch { return null; }
  });
  const [myRosterIds, setMyRosterIds] = React.useState(() => {
    try {
      const u = JSON.parse(localStorage.getItem('fantasai_user') || 'null');
      const roster = (u ? TEAM_ROSTERS[u.teamId] : null) || MY_ROSTER;
      return new Set(roster.map(r => r.playerId).filter(Boolean));
    } catch { return new Set(MY_ROSTER.map(r => r.playerId)); }
  });

  const [rosterSlotOverrides, setRosterSlotOverrides] = React.useState(() => {
    try { return JSON.parse(localStorage.getItem('fantasai_slot_overrides') || '{}'); } catch { return {}; }
  });
  function handleSlotOverridesChange(overrides) {
    setRosterSlotOverrides(overrides);
    localStorage.setItem('fantasai_slot_overrides', JSON.stringify(overrides));
  }

  function handleLogin(u) {
    localStorage.setItem('fantasai_user', JSON.stringify(u));
    setUser(u);
    const roster = TEAM_ROSTERS[u.teamId] || MY_ROSTER;
    setMyRosterIds(new Set(roster.map(r => r.playerId).filter(Boolean)));
    // Clear slot overrides when switching accounts
    setRosterSlotOverrides({});
    localStorage.removeItem('fantasai_slot_overrides');
  }

  function handleLogout() {
    localStorage.removeItem('fantasai_user');
    localStorage.removeItem('fantasai_slot_overrides');
    setUser(null);
    setMyRosterIds(new Set(MY_ROSTER.map(r => r.playerId)));
    setRosterSlotOverrides({});
  }

  const handleAddPlayer = React.useCallback(id => setMyRosterIds(prev => new Set([...prev, id])), []);
  const handleDropPlayer = React.useCallback(id => setMyRosterIds(prev => { const n = new Set(prev); n.delete(id); return n; }), []);

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
  const shellClass = `shell ${showAI ? 'has-ai' : ''} ${tweaks.showMobile ? 'mobile-mode' : ''}`;
  const playerObj = openPlayer ? findPlayer(openPlayer) : null;

  if (!user) return <Login onLogin={handleLogin} />;

  return (
    <React.Fragment>
      <div className={shellClass} style={tweaks.showMobile ? { maxWidth: 414, margin: '0 auto', boxShadow: '0 0 60px rgba(0,0,0,.6)' } : {}}>
        <div className="logo-area">
          <span className="logo-dot"></span>
          <span className="logo"><span className="ai-mark">AI</span>FANTAS</span>
        </div>
        <TopBar
          crumbs={CRUMBS[active] || ['FantasAI']}
          showMobile={tweaks.showMobile}
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
        <Sidebar active={active} onNav={setActive} user={user} />

        <div className="main">
          {active === 'dashboard' && <Dashboard onNav={setActive} onOpenPlayer={setOpenPlayer} user={user} myRosterIds={myRosterIds} sourcesState={sourcesState} slotOverrides={rosterSlotOverrides} />}
          {active === 'players'   && <PlayersScreen onOpenPlayer={setOpenPlayer} aiMode={aiMode} myRosterIds={myRosterIds} onAddPlayer={handleAddPlayer} user={user} watchlistIds={watchlistIds} onToggleWatch={handleToggleWatch} />}
          {active === 'news'      && <NewsScreen onOpenPlayer={setOpenPlayer} />}
          {active === 'roster'    && <CurrentRosterScreen user={user} myRosterIds={myRosterIds} onAddPlayer={handleAddPlayer} onDropPlayer={handleDropPlayer} onOpenPlayer={setOpenPlayer} watchlistIds={watchlistIds} onToggleWatch={handleToggleWatch} sourcesState={sourcesState} slotOverrides={rosterSlotOverrides} onSlotOverridesChange={handleSlotOverridesChange} />}
          {active === 'waivers'   && <WaiversScreen user={user} myRosterIds={myRosterIds} onAddPlayer={handleAddPlayer} onDropPlayer={handleDropPlayer} onOpenPlayer={setOpenPlayer} />}
          {active === 'compare'   && <CompareScreen />}
          {active === 'watchlist' && <WatchlistScreen onOpenPlayer={setOpenPlayer} />}
          {active === 'trade'     && <TradeScreen />}
          {active === 'draft'     && <DraftRoom aiMode={aiMode} />}
          {active === 'owners'    && <OwnerIntelScreen onOpenPlayer={setOpenPlayer} />}
          {active === 'cbs'       && <CBSRankingsScreen onOpenPlayer={setOpenPlayer} />}
          {active === 'sources'       && <SourcesScreen onNav={setActive} sourcesState={sourcesState} onSourcesChange={handleSourcesChange} />}
          {active === 'admin-owners'  && <AdminOwners />}
        </div>

        {showAI && <AICopilot active={active} aiMode={aiMode} />}
        <MobileNav active={active} onNav={setActive} user={user} />
      </div>

      {playerObj && <PlayerDetail player={playerObj} onClose={() => setOpenPlayer(null)} myRosterIds={myRosterIds} onAddPlayer={handleAddPlayer} sourcesState={sourcesState} />}

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
