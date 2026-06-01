import React from 'react';
import { MY_ROSTER, DRAFT_PICKS, TEAM_ROSTERS, findTeam, NFL_TEAMS, NEWS, SOURCE_META, FREE_DATA_SOURCES, RANKING_SOURCES, buildRosterFrame, assignRoster } from '../lib/data.js';
import { usePlayers, isLiveData } from '../lib/playerStore.js';

const FREE_DATA_SOURCES_LIST = FREE_DATA_SOURCES.map(s => ({ id: s.id, name: s.name, defaultEnabled: s.enabled }));
const FEED_NAMES = Object.fromEntries(RANKING_SOURCES.map(s => [s.id, s.name.replace(' (ECR)', '').replace(' Fantasy', '').replace(' Sports Rankings', '').replace(' Rankings', '')]));

import { PosBadge, StatusDot, PlayerAvatar, PlayerCell, Sparkline, ProjBar, Delta, AIHint, SourceBadge, TeamLogoBadge } from '../components/ui.jsx';
import { useR2BreakoutCandidates, useR2Injuries, useR2PlayerNotes } from '../hooks.js';
import { fetchSleeperPlayerStats, getPlayerMap, fetchBulkWeekStats } from '../lib/sleeper.js';

const WORKER   = (import.meta.env?.VITE_WORKER_URL || '').replace(/\/$/, '');
const API_BASE = 'https://api.fantasai.net';

// Fields where a lower value is better (invert when normalizing)
const LOWER_IS_BETTER = new Set(['ecr', 'adp', 'tier', 'oppRank']);

function loadScoringWeights() {
  try {
    const raw = localStorage.getItem('fantasai_scoring_weights');
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

function computeSleeperScores(playerList, weights) {
  if (!weights) return {};
  // Group by position for per-position normalization
  const byPos = {};
  for (const p of playerList) {
    if (!byPos[p.pos]) byPos[p.pos] = [];
    byPos[p.pos].push(p);
  }
  // Compute min/max per feature per position
  const ranges = {};
  for (const [pos, players] of Object.entries(byPos)) {
    const posWeights = weights[pos];
    if (!posWeights) continue;
    ranges[pos] = {};
    for (const { key } of posWeights) {
      const vals = players.map(p => p[key] ?? 0);
      ranges[pos][key] = { min: Math.min(...vals), max: Math.max(...vals) };
    }
  }
  // Score each player
  const scores = {};
  for (const p of playerList) {
    const posWeights = weights[p.pos];
    if (!posWeights || !ranges[p.pos]) { scores[p.id] = 0; continue; }
    let total = 0;
    let totalWeight = 0;
    for (const { key, weight } of posWeights) {
      if (!weight) continue;
      const { min, max } = ranges[p.pos][key] || { min: 0, max: 1 };
      const span = max - min || 1;
      const raw = p[key] ?? 0;
      const norm = LOWER_IS_BETTER.has(key)
        ? (max - raw) / span
        : (raw - min) / span;
      total += norm * weight;
      totalWeight += weight;
    }
    scores[p.id] = totalWeight > 0 ? total / totalWeight : 0;
  }
  return scores;
}

function formatWaiverExpiry(isoStr) {
  const d   = new Date(isoStr);
  const now = new Date();
  const diffH = (d - now) / 3_600_000;
  if (diffH < 24) return `Tonight ${d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`;
  const tomorrow = new Date(now); tomorrow.setDate(tomorrow.getDate() + 1);
  if (d.toDateString() === tomorrow.toDateString()) return 'Tomorrow night';
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

// Build once — maps playerId → owning teamId from the base roster data
const PLAYER_OWNER_MAP = (() => {
  const map = {};
  for (const [teamId, entries] of Object.entries(TEAM_ROSTERS)) {
    for (const entry of entries) {
      if (entry.playerId) map[entry.playerId] = Number(teamId);
    }
  }
  return map;
})();

export default function PlayersScreen({ onOpenPlayer, aiMode, myRosterIds = new Set(), onAddPlayer, onTradePlayer, user, watchlistIds = new Set(), onToggleWatch, waiverQueue = {} }) {
  const [pos, setPos] = React.useState('ALL');
  const [search, setSearch] = React.useState('');
  const [sort, setSort] = React.useState('rank');
  const [avail, setAvail] = React.useState('all');
  const [useSleeperSort, setUseSleeperSort] = React.useState(false);
  const [breakoutOnly, setBreakoutOnly] = React.useState(false);

  // ── Custom Rankings (import + scrape) ────────────────────────────────────────
  const [customRankings, setCustomRankings] = React.useState(() => {
    try { return JSON.parse(localStorage.getItem('fantasai_custom_rankings') || '[]'); } catch { return []; }
  });
  const [activeRankingId, setActiveRankingId] = React.useState(null);

  const [showImportModal, setShowImportModal] = React.useState(false);
  const [importName, setImportName]           = React.useState('');
  const [importFileName, setImportFileName]   = React.useState('');
  const [importFileText, setImportFileText]   = React.useState('');
  const [importError, setImportError]         = React.useState('');
  const importFileRef                         = React.useRef(null);

  const [showScrapeModal, setShowScrapeModal] = React.useState(false);
  const [scrapeName, setScrapeName]           = React.useState('');
  const [scrapeUrl, setScrapeUrl]             = React.useState('');
  const [scrapeLoading, setScrapeLoading]     = React.useState(false);
  const [scrapeError, setScrapeError]         = React.useState('');

  const sleeperWeights = React.useMemo(() => loadScoringWeights(), []);

  const { data: r2Breakouts } = useR2BreakoutCandidates();
  const breakoutSet = React.useMemo(() => {
    const s = new Map(); // player_name (lower) → { snap_share_delta, opportunity_score }
    const arr = Array.isArray(r2Breakouts) ? r2Breakouts : [];
    for (const b of arr) {
      if (b.player_name) s.set(b.player_name.toLowerCase().trim(), b);
    }
    return s;
  }, [r2Breakouts]);

  // Global player store — seeds from static data, replaced with live Databricks/Sleeper on startup
  const apiPlayerList = usePlayers();

  // R2 injury overlay — real status + depth chart from Databricks silver_player_news
  const { data: r2InjuryData } = useR2Injuries();
  const { data: r2Notes } = useR2PlayerNotes();

  // Index R2 injury data by name and by Sleeper player_id for fast lookup
  const r2InjuryIndex = React.useMemo(() => {
    const byName = {};
    const byId   = {};
    const arr = Array.isArray(r2InjuryData) ? r2InjuryData : [];
    for (const r of arr) {
      if (r.player_name) byName[r.player_name.toLowerCase().trim()] = r;
      if (r.player_id)   byId[String(r.player_id)] = r;
    }
    return { byName, byId };
  }, [r2InjuryData]);

  // Index player_notes by name for news overlay
  const r2NotesIndex = React.useMemo(() => {
    const byName = {};
    const arr = Array.isArray(r2Notes) ? r2Notes : [];
    for (const n of arr) {
      if (n.player_name) byName[n.player_name.toLowerCase().trim()] = n;
    }
    return byName;
  }, [r2Notes]);

  // Merge R2 injury overlay into the player list when it arrives.
  // R2 has more current injury_status + depth_chart_order than Databricks bronze table.
  const allPlayersList = React.useMemo(() => {
    if (!r2InjuryData && !r2Notes) return apiPlayerList;
    return apiPlayerList.map(p => {
      const r2 = r2InjuryIndex.byName[p.name.toLowerCase().trim()]
               || (p.sleeperId ? r2InjuryIndex.byId[String(p.sleeperId)] : null);
      const note = r2NotesIndex[p.name.toLowerCase().trim()];
      const injSt = r2?.injury_status;
      const updates = {};
      if (injSt) {
        updates.status = injSt === 'Questionable' ? 'Q'
                       : injSt === 'Doubtful'     ? 'D'
                       : injSt === 'Out'           ? 'Out'
                       : injSt === 'IR' || injSt === 'Injured_Reserve' ? 'IR'
                       : p.status;
        if (r2.injury_notes) updates.injuryNotes = r2.injury_notes;
      }
      if (r2?.depth_chart_order != null) updates.depthChartOrder = r2.depth_chart_order;
      if (r2?.depth_chart_position)      updates.depthChartPos   = r2.depth_chart_position;
      if (note?.notes?.length) {
        const topNote = note.notes[0];
        updates.news = topNote.note_text ? topNote.note_text.slice(0, 100) : p.news;
        updates.hasCriticalNews   = note.has_critical_news   || false;
        updates.hasInjuryConcern  = note.has_injury_concern  || false;
        updates.overallImpact     = note.overall_impact_score ?? null;
      }
      return Object.keys(updates).length ? { ...p, ...updates } : p;
    });
  }, [apiPlayerList, r2InjuryData, r2Notes, r2InjuryIndex, r2NotesIndex]);

  const sleeperScores  = React.useMemo(
    () => useSleeperSort ? computeSleeperScores(allPlayersList, sleeperWeights) : {},
    [useSleeperSort, sleeperWeights, allPlayersList],
  );
  const [selected, setSelected] = React.useState(null);
  const [depthData,  setDepthData]  = React.useState({});
  const [snapsData,  setSnapsData]  = React.useState({});
  const [injuryData, setInjuryData] = React.useState({});

  React.useEffect(() => {
    let cancelled = false;
    async function loadDepthAndSnaps() {
      try {
        const [map, weekStats] = await Promise.all([
          getPlayerMap(),
          fetchBulkWeekStats(2025, 18),
        ]);
        if (cancelled) return;
        const depths  = {};
        const snaps   = {};
        const injuries = {};
        for (const [sid, p] of Object.entries(map)) {
          if (!p.full_name && !p.first_name) continue;
          const name = (p.full_name || `${p.first_name} ${p.last_name}`).toLowerCase().trim();
          if (p.depth_chart_order && p.depth_chart_position) {
            depths[name] = `${p.depth_chart_position}${p.depth_chart_order}`;
          }
          if (weekStats) {
            const s = weekStats[sid];
            const snpVal = s?.off_snp ?? s?.snp;
            if (snpVal != null) snaps[name] = Math.round(snpVal);
          }
          if (p.injury_status && p.injury_status !== 'Na') {
            injuries[name] = {
              status:   p.injury_status,
              bodyPart: p.injury_body_part  || null,
              notes:    p.injury_notes      || null,
            };
          }
        }
        setDepthData(depths);
        setSnapsData(snaps);
        setInjuryData(injuries);
      } catch {
        // Sleeper unavailable — columns remain empty
      }
    }
    loadDepthAndSnaps();
    return () => { cancelled = true; };
  }, []);

  const draftedIds = new Set(DRAFT_PICKS.filter(p => p.playerId).map(p => p.playerId));

  const now = new Date();
  const activeWaivers = new Set(
    Object.entries(waiverQueue)
      .filter(([, v]) => new Date(v.expiresAt) > now)
      .map(([id]) => Number(id))
  );

  let players = allPlayersList.filter(p => {
    if (pos === 'FLEX' && !['RB', 'WR', 'TE'].includes(p.pos)) return false;
    if (pos !== 'ALL' && pos !== 'FLEX' && p.pos !== pos) return false;
    if (search && !p.name.toLowerCase().includes(search.toLowerCase())) return false;
    if (avail === 'free' && (draftedIds.has(p.id) || activeWaivers.has(p.id) || PLAYER_OWNER_MAP[p.id] != null || myRosterIds.has(p.id))) return false;
    if (avail === 'waivers' && !activeWaivers.has(p.id)) return false;
    if (avail === 'rostered' && !draftedIds.has(p.id) && !myRosterIds.has(p.id) && PLAYER_OWNER_MAP[p.id] == null) return false;
    if (breakoutOnly && !breakoutSet.has(p.name.toLowerCase().trim())) return false;
    return true;
  });

  const activeRanking = customRankings.find(r => r.id === activeRankingId) ?? null;
  const customRankMap = React.useMemo(() => {
    if (!activeRanking) return null;
    const m = new Map();
    for (const p of activeRanking.players) m.set(p.name.toLowerCase().trim(), p.rank);
    return m;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeRankingId, customRankings]);

  if (useSleeperSort) {
    players.sort((a, b) => (sleeperScores[b.id] ?? 0) - (sleeperScores[a.id] ?? 0));
  } else if (sort === 'custom' && customRankMap) {
    players.sort((a, b) => {
      const ra = customRankMap.get(a.name.toLowerCase().trim()) ?? Infinity;
      const rb = customRankMap.get(b.name.toLowerCase().trim()) ?? Infinity;
      return ra - rb;
    });
  } else {
    players.sort((a, b) => {
      if (sort === 'proj') return b.proj - a.proj;
      if (sort === 'last') return b.last - a.last;
      if (sort === 'avg') return b.avg - a.avg;
      if (sort === 'owned') return b.owned - a.owned;
      if (sort === 'adp') return a.adp - b.adp;
      if (sort === 'rank') return a.ecr - b.ecr;
      return 0;
    });
  }

  // ── Custom ranking helpers ───────────────────────────────────────────────────
  function saveCustomRanking(ranking) {
    const updated = [...customRankings.filter(r => r.id !== ranking.id), ranking];
    setCustomRankings(updated);
    localStorage.setItem('fantasai_custom_rankings', JSON.stringify(updated));
    setActiveRankingId(ranking.id);
    setSort('custom');
  }

  function deleteCustomRanking(id) {
    const updated = customRankings.filter(r => r.id !== id);
    setCustomRankings(updated);
    localStorage.setItem('fantasai_custom_rankings', JSON.stringify(updated));
    if (activeRankingId === id) { setActiveRankingId(null); setSort('proj'); }
  }

  function parseRankingText(text, filename) {
    const ext = (filename || '').split('.').pop().toLowerCase();
    if (ext === 'json') {
      const raw = JSON.parse(text);
      const arr = Array.isArray(raw) ? raw : (raw.players || raw.rankings || Object.values(raw));
      if (!Array.isArray(arr) || !arr.length) throw new Error('No array found in JSON');
      if (typeof arr[0] === 'string')
        return arr.map((n, i) => ({ name: n.trim(), rank: i + 1 })).filter(p => p.name);
      return arr.map((d, i) => ({
        name: (d.name || d.player_name || d.player || d.full_name || '').trim(),
        rank: Number(d.rank || d.ecr || d.adp || i + 1),
        pos:  d.pos || d.position || '',
        team: d.team || d.team_abbr || '',
      })).filter(p => p.name);
    }
    const lines = text.trim().split('\n').map(l => l.trim()).filter(Boolean);
    if (!lines.length) throw new Error('File is empty');
    const firstCols = lines[0].split(',').map(c => c.replace(/"/g, '').trim().toLowerCase());
    const hasHeader = firstCols.some(c => ['name','player','rank','pos','position','ecr','adp'].includes(c));
    if (hasHeader) {
      const ni = firstCols.findIndex(c => ['name','player','player_name'].includes(c));
      const ri = firstCols.findIndex(c => ['rank','ecr','adp','rk'].includes(c));
      const pi = firstCols.findIndex(c => ['pos','position'].includes(c));
      if (ni < 0) throw new Error('No player name column found (expected "name" or "player" header)');
      return lines.slice(1).map((l, i) => {
        const c = l.split(',').map(v => v.replace(/"/g, '').trim());
        return { name: c[ni] || '', rank: ri >= 0 ? (parseInt(c[ri]) || i+1) : i+1, pos: pi >= 0 ? c[pi] : '' };
      }).filter(p => p.name);
    }
    return lines.map((l, i) => {
      const m = l.match(/^(\d+)[.):\s]+(.+?)(?:\s*[([].*)?$/);
      if (m) return { rank: parseInt(m[1]), name: m[2].trim() };
      const parts = l.split(',').map(p => p.replace(/"/g,'').trim());
      if (parts.length >= 2 && !isNaN(parts[0])) return { rank: parseInt(parts[0]), name: parts[1] };
      return { rank: i+1, name: l.replace(/^\d+[.):\s]+/, '').trim() };
    }).filter(p => p.name && p.name.length > 1);
  }

  function parseScrapedHtml(html) {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    // Strategy 1: FantasyPros / embedded JSON in scripts
    for (const script of doc.querySelectorAll('script')) {
      const txt = script.textContent || '';
      const fpM = txt.match(/var\s+(?:ecrData|rankingData|playersData)\s*=\s*(\{[\s\S]*?\});\s*(?:var\s|\n|$)/);
      if (fpM) {
        try {
          const d = JSON.parse(fpM[1]);
          const arr = d.players || d.rankings;
          if (Array.isArray(arr) && arr.length >= 5)
            return arr.map((p,i) => ({ rank: p.rank_ecr||p.rank||i+1, name: (p.player_name||p.name||'').trim(), pos: p.pos||'', team: p.team_abbr||'' })).filter(p=>p.name);
        } catch {}
      }
      // Generic JSON array with player-like keys
      const arrM = txt.match(/(?:=|:)\s*(\[\s*\{[^[\]]{10,3000}\}\s*\])/);
      if (arrM) {
        try {
          const arr = JSON.parse(arrM[1]);
          if (Array.isArray(arr) && arr.length >= 10) {
            const first = arr[0];
            if (first.player_name || first.name || first.full_name)
              return arr.map((p,i) => ({ rank: p.rank||p.ecr||i+1, name:(p.player_name||p.name||p.full_name||'').trim(), pos:p.pos||p.position||'', team:p.team||'' })).filter(p=>p.name);
          }
        } catch {}
      }
    }
    // Strategy 2: HTML tables
    for (const table of doc.querySelectorAll('table')) {
      const hdrs = [...table.querySelectorAll('th')].map(th => th.textContent.trim().toLowerCase());
      const ni = hdrs.findIndex(h => h.includes('player') || h === 'name');
      const ri = hdrs.findIndex(h => ['rank','#','rk','ecr','adp'].includes(h));
      const pi = hdrs.findIndex(h => ['pos','position'].includes(h));
      if (ni < 0 && ri < 0) continue;
      const rows = [...table.querySelectorAll('tbody tr')];
      if (rows.length < 5) continue;
      const items = rows.map((row,i) => {
        const cells = [...row.querySelectorAll('td')];
        const col = ni >= 0 ? ni : 1;
        if (cells.length <= col) return null;
        const rawName = cells[col].textContent.replace(/\s+/g,' ').trim();
        const name = rawName.split(/\s+(QB|RB|WR|TE|K|DST|DEF|D\/ST)\s*[-–]/)[0].trim();
        return { rank: ri >= 0 ? (parseInt(cells[ri]?.textContent)||i+1) : i+1, name, pos: pi >= 0 ? cells[pi]?.textContent.trim() : '' };
      }).filter(p => p && p.name && p.name.length > 2 && !/^\d+$/.test(p.name));
      if (items.length >= 10) return items;
    }
    // Strategy 3: ordered lists
    for (const ol of doc.querySelectorAll('ol')) {
      const items = [...ol.querySelectorAll('li')].map((li,i) => ({
        rank: i+1, name: li.textContent.replace(/\s+/g,' ').split('(')[0].split(' - ')[0].trim(),
      })).filter(p => p.name.length > 2);
      if (items.length >= 15) return items;
    }
    // Strategy 4: text pattern "1. Name" or "1) Name"
    const bodyText = doc.body?.textContent || '';
    const matches = [...bodyText.matchAll(/(?:^|\n)\s*(\d{1,3})[.):\s]+([A-Z][a-z]+(?:[\s'-][A-Z][a-z'.]+)+)/gm)];
    if (matches.length >= 10) return matches.map(m => ({ rank: parseInt(m[1]), name: m[2].trim() }));
    return [];
  }

  function handleImportFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setImportFileName(file.name);
    setImportError('');
    const reader = new FileReader();
    reader.onload = ev => setImportFileText(ev.target.result || '');
    reader.readAsText(file);
    e.target.value = '';
  }

  function handleImportSave() {
    if (!importName.trim()) { setImportError('Please enter a name for this ranking.'); return; }
    if (!importFileText)    { setImportError('Please choose a file.'); return; }
    try {
      const players = parseRankingText(importFileText, importFileName);
      if (!players.length) { setImportError('No players found — check the file format.'); return; }
      saveCustomRanking({ id: Date.now().toString(), name: importName.trim(), players, source: 'import', createdAt: new Date().toISOString() });
      setShowImportModal(false); setImportName(''); setImportFileName(''); setImportFileText(''); setImportError('');
    } catch (err) { setImportError(`Parse error: ${err.message}`); }
  }

  async function handleScrape() {
    if (!scrapeName.trim()) { setScrapeError('Please enter a name for this ranking.'); return; }
    if (!scrapeUrl.trim())  { setScrapeError('Please enter a URL to scrape.'); return; }
    setScrapeLoading(true); setScrapeError('');
    try {
      const res = await fetch('https://api.fantasai.net/api/v1/scrape', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: scrapeUrl.trim() }),
      });
      const data = await res.json();
      if (!res.ok || data.error) throw new Error(data.error || `HTTP ${res.status}`);
      const players = parseScrapedHtml(data.html || '');
      if (!players.length) throw new Error('No player rankings detected on this page. Try a direct rankings URL (e.g. FantasyPros overall rankings page).');
      saveCustomRanking({ id: Date.now().toString(), name: scrapeName.trim(), players, source: 'scrape', url: scrapeUrl.trim(), createdAt: new Date().toISOString() });
      setShowScrapeModal(false); setScrapeName(''); setScrapeUrl(''); setScrapeError('');
    } catch (err) { setScrapeError(err.message); }
    finally { setScrapeLoading(false); }
  }

  return (
    <div style={{ display: 'flex', height: '100%', overflow: 'hidden' }}>
    <div className="col" style={{ flex: 1, minWidth: 0, overflow: 'hidden', height: '100%' }}>
      <div className="page-head">
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          {user && <TeamLogoBadge team={user.teamId ? findTeam(user.teamId) : null} size={40} />}
          <div>
            <h1>Players</h1>
            <div className="sub">
              {`${players.length} of ${allPlayersList.length} players · ${isLiveData() ? 'Live data' : 'Static seed'}`}
            </div>
          </div>
        </div>
        <div className="flex gap-8">
          <button className="btn ghost" onClick={() => { setShowScrapeModal(true); setScrapeError(''); setScrapeUrl(''); setScrapeName(''); }}>🌐 Scrape Rankings</button>
          <button className="btn ghost" onClick={() => { setShowImportModal(true); setImportError(''); setImportName(''); setImportFileName(''); setImportFileText(''); }}>↑ Import Rankings</button>
          <button className="btn ghost"><span>⇣</span> Export</button>
        </div>
      </div>

      <div className="toolbar">
        <div className="chips">
          {['ALL', 'QB', 'RB', 'WR', 'TE', 'FLEX', 'K', 'DST'].map(p => (
            <div key={p} className={`chip ${pos === p ? 'accent active' : ''}`} onClick={() => setPos(p)}>{p}</div>
          ))}
        </div>
        <input className="input search" placeholder="Filter by name" value={search} onChange={e => setSearch(e.target.value)} style={{ width: 220 }} />
        <div className="chips">
          {[
            ['all', 'All'],
            ['free', 'Available'],
            ['waivers', `Waivers${activeWaivers.size > 0 ? ` (${activeWaivers.size})` : ''}`],
            ['rostered', 'Rostered'],
          ].map(([k, v]) => (
            <div key={k} className={`chip ${avail === k ? 'active' : ''}`}
              style={k === 'waivers' && activeWaivers.size > 0 ? { color: '#ff9500', borderColor: 'rgba(255,149,0,.4)' } : undefined}
              onClick={() => setAvail(k)}>{v}</div>
          ))}
        </div>
        <button
          onClick={() => setBreakoutOnly(b => !b)}
          disabled={breakoutSet.size === 0}
          style={{
            padding: '5px 12px', borderRadius: 6, fontSize: 12, fontWeight: 700,
            cursor: breakoutSet.size === 0 ? 'default' : 'pointer',
            border: `1px solid ${breakoutOnly ? 'rgba(198,255,58,.6)' : 'var(--border)'}`,
            background: breakoutOnly ? 'rgba(198,255,58,.12)' : 'transparent',
            color: breakoutOnly ? '#c6ff3a' : breakoutSet.size === 0 ? 'var(--text-faint)' : 'var(--text-dim)',
            display: 'flex', alignItems: 'center', gap: 5, flexShrink: 0,
            transition: 'all .15s',
            opacity: breakoutSet.size === 0 ? 0.5 : 1,
          }}
          title={breakoutSet.size === 0 ? 'No breakout data yet — run the Databricks export job' : `${breakoutSet.size} breakout candidate${breakoutSet.size !== 1 ? 's' : ''} identified by FantasAI ML`}
        >
          <span style={{ fontSize: 13 }}>↑</span>
          Breakout
          {breakoutOnly && <span style={{ fontSize: 10, fontFamily: 'var(--font-mono)', opacity: 0.8 }}>ON</span>}
          {breakoutSet.size > 0 && !breakoutOnly && <span style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: '#c6ff3a', opacity: 0.8 }}>{breakoutSet.size}</span>}
        </button>
        <button
          onClick={() => setUseSleeperSort(s => !s)}
          style={{
            padding: '5px 12px', borderRadius: 6, fontSize: 12, fontWeight: 700,
            cursor: 'pointer', border: `1px solid ${useSleeperSort ? 'var(--accent)' : 'var(--border)'}`,
            background: useSleeperSort ? 'rgba(198,255,58,.12)' : 'transparent',
            color: useSleeperSort ? 'var(--accent)' : 'var(--text-dim)',
            display: 'flex', alignItems: 'center', gap: 5, flexShrink: 0,
            transition: 'all .15s',
          }}
          title={sleeperWeights ? 'Sort by your Sleeper Slider weights (Account → Sleeper tab)' : 'No Sleeper weights saved — configure them in Account → Sleeper tab'}
        >
          <span style={{ fontSize: 13 }}>😴</span>
          Sleeper Slider
          {useSleeperSort && <span style={{ fontSize: 10, fontFamily: 'var(--font-mono)', opacity: 0.8 }}>ON</span>}
          {!sleeperWeights && <span style={{ fontSize: 10, color: 'var(--warn)', fontFamily: 'var(--font-mono)' }}>!</span>}
        </button>
        <select
          className="input"
          value={sort === 'custom' && activeRankingId ? `custom:${activeRankingId}` : sort}
          onChange={e => {
            const v = e.target.value;
            setUseSleeperSort(false);
            if (v.startsWith('custom:')) { setActiveRankingId(v.slice(7)); setSort('custom'); }
            else { setSort(v); setActiveRankingId(null); }
          }}
          disabled={useSleeperSort}
          style={{ opacity: useSleeperSort ? 0.4 : 1 }}
        >
          <option value="proj">Sort: Projection</option>
          <option value="last">Sort: Last Week</option>
          <option value="avg">Sort: Season Avg</option>
          <option value="owned">Sort: % Owned</option>
          <option value="adp">Sort: ADP</option>
          <option value="rank">Sort: Expert Rank</option>
          {customRankings.length > 0 && <option disabled>── My Rankings ──</option>}
          {customRankings.map(r => <option key={r.id} value={`custom:${r.id}`}>📋 {r.name}</option>)}
        </select>
        {/* Active custom ranking indicator */}
        {activeRanking && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '3px 10px', background: 'rgba(198,255,58,.1)', border: '1px solid rgba(198,255,58,.3)', borderRadius: 6, flexShrink: 0 }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--accent)' }}>📋 {activeRanking.name}</span>
            <span style={{ fontSize: 10, color: 'var(--text-faint)', fontFamily: 'var(--font-mono)' }}>{activeRanking.players.length} players</span>
            <button style={{ background:'none', border:'none', cursor:'pointer', color:'var(--text-faint)', fontSize:13, padding:0, lineHeight:1 }}
              onClick={() => { setActiveRankingId(null); setSort('proj'); }}>✕</button>
          </div>
        )}
        {/* Custom rankings chips (if any saved) */}
        {customRankings.length > 0 && (
          <div style={{ display:'flex', gap:4, flexWrap:'nowrap', alignItems:'center' }}>
            {customRankings.map(r => (
              <div key={r.id} style={{ display:'flex', alignItems:'center', gap:0, borderRadius:6, border:`1px solid ${activeRankingId===r.id ? 'rgba(198,255,58,.5)' : 'var(--border)'}`, overflow:'hidden', flexShrink:0 }}>
                <button
                  style={{ padding:'3px 9px', fontSize:11, fontWeight:600, background: activeRankingId===r.id ? 'rgba(198,255,58,.12)' : 'transparent', border:'none', cursor:'pointer', color: activeRankingId===r.id ? 'var(--accent)' : 'var(--text-dim)', whiteSpace:'nowrap' }}
                  onClick={() => { setActiveRankingId(r.id); setSort('custom'); setUseSleeperSort(false); }}
                >📋 {r.name}</button>
                <button style={{ padding:'3px 7px', fontSize:11, background:'transparent', border:'none', borderLeft:`1px solid ${activeRankingId===r.id ? 'rgba(198,255,58,.3)' : 'var(--border)'}`, cursor:'pointer', color:'var(--text-faint)', lineHeight:1 }}
                  onClick={() => deleteCustomRanking(r.id)}>✕</button>
              </div>
            ))}
          </div>
        )}
        <div className="grow"></div>
        <span style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--text-faint)', whiteSpace: 'nowrap' }}>
          {isLiveData() ? '◆ Live' : '○ Static'} · {allPlayersList.length} players
          {r2InjuryData ? ' · R2 injuries' : ''}
        </span>
        <span className="faint mono" style={{ fontSize: 11 }}>HALF PPR</span>
      </div>

      <div style={{ flex: 1, overflow: 'auto' }}>
        <table className="data-table">
          <thead>
            <tr>
              <th>#</th>
              <th>Player</th>
              <th>Opp</th>
              {useSleeperSort && <th className="num sorted" style={{ color: 'var(--accent)' }}>Score</th>}
              <th className={`num ${!useSleeperSort && sort === 'proj' ? 'sorted' : ''}`} onClick={() => { setSort('proj'); setUseSleeperSort(false); }}>Proj</th>
              <th className={`num ${!useSleeperSort && sort === 'last' ? 'sorted' : ''}`} onClick={() => { setSort('last'); setUseSleeperSort(false); }}>Last</th>
              <th className={`num ${!useSleeperSort && sort === 'avg' ? 'sorted' : ''}`} onClick={() => { setSort('avg'); setUseSleeperSort(false); }}>Avg</th>
              <th className="num">Trend</th>
              <th className={`num ${!useSleeperSort && sort === 'owned' ? 'sorted' : ''}`} onClick={() => { setSort('owned'); setUseSleeperSort(false); }}>%Own</th>
              <th className={`num ${!useSleeperSort && sort === 'adp' ? 'sorted' : ''}`} onClick={() => { setSort('adp'); setUseSleeperSort(false); }}>ADP</th>
              <th className="num">Depth</th>
              <th className="num">Snaps</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {!isLiveData() && players.length === 0 && Array.from({ length: 20 }).map((_, i) => (
              <tr key={`skel-${i}`}>
                {Array.from({ length: 13 }).map((__, c) => (
                  <td key={c}><div style={{ height: 12, borderRadius: 4, background: 'rgba(255,255,255,.06)', width: c === 1 ? 140 : c === 0 ? 24 : 48, animation: 'pulse 1.4s ease-in-out infinite' }} /></td>
                ))}
              </tr>
            ))}
            {players.map((p, i) => {
              const isOnMyRoster  = myRosterIds.has(p.id);
              const waiverEntry   = waiverQueue[p.id];
              const isOnWaivers   = !!(waiverEntry && new Date(waiverEntry.expiresAt) > new Date());
              const isAvail       = !draftedIds.has(p.id) && !isOnMyRoster && !isOnWaivers;
              const aiPick = aiMode !== 'subtle' ? null :
                (p.id === 65 ? 'fade — hammy' : p.id === 62 ? 'BUY' : p.id === 80 ? 'TE1 lock' : null);
              const pKey = p.name.toLowerCase().trim();
              // R2 overlay takes priority for depth; fall back to Sleeper getPlayerMap data
              const depthLabel = p.depthChartPos
                ? `${p.depthChartPos}${p.depthChartOrder != null ? p.depthChartOrder : ''}`
                : depthData[pKey];
              const snapCount   = snapsData[pKey];
              // Injury notes: prefer R2 overlay, fall back to Sleeper getPlayerMap
              const injNotes    = p.injuryNotes || (injuryData[pKey] ? [injuryData[pKey].bodyPart, injuryData[pKey].notes].filter(Boolean).join(' · ') : null);
              const breakoutData = breakoutSet.get(pKey);
              return (
                <tr key={p.id} className={selected === p.id ? 'selected' : ''} onClick={() => setSelected(p.id)}
                  style={isOnWaivers ? { background: 'rgba(255,149,0,.04)' } : undefined}>
                  <td className="rank">{i + 1}</td>
                  <td onClick={(e) => { e.stopPropagation(); onOpenPlayer(p.id); }} style={{ cursor: 'pointer' }}>
                    <PlayerCell player={p} watched={watchlistIds.has(p.id)} />
                  </td>
                  <td>
                    <span className="mono dim" style={{ fontSize: 11 }}>vs {p.opp}</span>
                    <div className="mono faint" style={{ fontSize: 10 }}>D #{p.oppRank}</div>
                  </td>
                  {useSleeperSort && (
                    <td className="num">
                      <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 800, fontSize: 12, color: 'var(--accent)' }}>
                        {((sleeperScores[p.id] ?? 0) * 100).toFixed(0)}
                      </span>
                    </td>
                  )}
                  <td className="num">
                    <span style={{ fontWeight: 600 }}>{p.proj.toFixed(1)}</span>
                    <ProjBar value={p.proj} />
                  </td>
                  <td className="num">{p.last.toFixed(1)}</td>
                  <td className="num">{p.avg.toFixed(1)}</td>
                  <td className="num"><Sparkline data={p.trend} /></td>
                  <td className="num">{p.owned.toFixed(1)}%</td>
                  <td className="num faint">{p.adp.toFixed(1)}</td>
                  <td className="num">
                    {depthLabel
                      ? <span style={{
                          fontFamily: 'var(--font-mono)', fontSize: 11, fontWeight: 700,
                          color: depthLabel.endsWith('1') ? 'var(--accent)' : depthLabel.endsWith('2') ? 'var(--accent-2)' : 'var(--text-faint)',
                        }}>{depthLabel}</span>
                      : <span className="faint" style={{ fontSize: 11 }}>—</span>}
                  </td>
                  <td className="num mono" style={{ fontSize: 11 }}>
                    {snapCount != null ? snapCount : <span className="faint">—</span>}
                  </td>
                  <td>
                    {isOnWaivers ? (
                      <span style={{
                        display: 'inline-flex', alignItems: 'center', gap: 4,
                        fontSize: 10, fontWeight: 700, fontFamily: 'var(--font-mono)',
                        color: '#ff9500',
                        background: 'rgba(255,149,0,.12)',
                        border: '1px solid rgba(255,149,0,.35)',
                        borderRadius: 4, padding: '2px 7px', whiteSpace: 'nowrap',
                      }}>
                        ⏳ Waiver Queue · Clears {formatWaiverExpiry(waiverEntry.expiresAt)}
                      </span>
                    ) : p.status !== 'OK' ? (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                        <span className="status-pill"><StatusDot status={p.status} /> {p.status}</span>
                        {injNotes && (
                          <span style={{ fontSize: 10, color: 'var(--text-faint)', lineHeight: 1.4, maxWidth: 160 }}>
                            {injNotes}
                          </span>
                        )}
                      </div>
                    ) : null}
                    {breakoutData && (
                      <div title={`Snap Δ +${((breakoutData.snap_share_delta || 0) * 100).toFixed(0)}% · Opp Score ${(breakoutData.opportunity_score || 0).toFixed(1)}`}>
                        <span style={{
                          display: 'inline-flex', alignItems: 'center', gap: 3,
                          fontSize: 9, fontWeight: 800, fontFamily: 'var(--font-mono)',
                          color: '#c6ff3a', background: 'rgba(198,255,58,.12)',
                          border: '1px solid rgba(198,255,58,.4)',
                          borderRadius: 4, padding: '2px 6px', letterSpacing: '.04em',
                        }}>↑ BREAKOUT</span>
                      </div>
                    )}
                    {aiPick && <div><AIHint>{aiPick}</AIHint></div>}
                  </td>
                  <td>
                    <div className="flex gap-8" style={{ alignItems: 'center' }}>
                      <button
                        className={`btn sm icon${watchlistIds.has(p.id) ? ' watch-active' : ''}`}
                        title={watchlistIds.has(p.id) ? 'Remove from watchlist' : 'Add to watchlist'}
                        onClick={e => { e.stopPropagation(); onToggleWatch?.(p.id); }}
                      >{watchlistIds.has(p.id) ? '★' : '☆'}</button>
                      {isOnMyRoster ? (
                        <button className="btn sm success" disabled onClick={e => e.stopPropagation()}>✓ Rostered</button>
                      ) : isOnWaivers ? (() => {
                        const dropTeam = waiverEntry.teamId ? findTeam(waiverEntry.teamId) : null;
                        return (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 2, alignItems: 'flex-start' }}>
                            <span style={{
                              fontSize: 9, fontWeight: 700, fontFamily: 'var(--font-mono)',
                              color: '#ff9500', background: 'rgba(255,149,0,.12)',
                              border: '1px solid rgba(255,149,0,.35)',
                              borderRadius: 3, padding: '1px 5px', letterSpacing: '.04em',
                            }}>WAIVERS</span>
                            {dropTeam && (
                              <span style={{ fontSize: 10, color: 'var(--text-dim)', whiteSpace: 'nowrap' }}>
                                Dropped by {dropTeam.name} · {new Date(waiverEntry.droppedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                              </span>
                            )}
                          </div>
                        );
                      })() : isAvail ? (
                        <button className="btn sm primary" onClick={e => { e.stopPropagation(); onAddPlayer?.(p.id); }}>+ Add</button>
                      ) : (() => {
                        const ownerTeamId = PLAYER_OWNER_MAP[p.id];
                        const ownerTeam   = ownerTeamId ? findTeam(ownerTeamId) : null;
                        return (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 3, alignItems: 'flex-start' }}>
                            {ownerTeam && (
                              <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 10, color: 'var(--text-dim)', whiteSpace: 'nowrap' }}>
                                <span style={{ width: 7, height: 7, borderRadius: '50%', background: ownerTeam.color, flexShrink: 0, display: 'inline-block' }} />
                                {ownerTeam.name}
                              </span>
                            )}
                            <div style={{ display: 'flex', gap: 4 }}>
                              <button className="btn sm ghost" disabled onClick={e => e.stopPropagation()}
                                style={{ opacity: .65 }}>On Roster</button>
                              <button className="btn sm ghost" onClick={e => { e.stopPropagation(); onTradePlayer?.(p.id, ownerTeamId); }}
                                style={{ color: 'var(--accent-2)', borderColor: 'rgba(78,168,255,.35)' }}>Trade</button>
                            </div>
                          </div>
                        );
                      })()}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
    {user && <RosterPanel teamId={user.teamId} myRosterIds={myRosterIds} onOpenPlayer={onOpenPlayer} />}

    {/* ── Import Rankings Modal ─────────────────────────────────────────────── */}
    {showImportModal && (
      <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,.72)', zIndex:1000, display:'flex', alignItems:'center', justifyContent:'center', padding:16 }}
        onClick={e => { if (e.target===e.currentTarget) setShowImportModal(false); }}>
        <div style={{ background:'var(--panel)', border:'1px solid var(--border-strong)', borderRadius:14, padding:24, width:440, maxWidth:'100%', maxHeight:'90vh', overflowY:'auto' }}>
          <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:18 }}>
            <div style={{ fontSize:15, fontWeight:800 }}>↑ Import Rankings</div>
            <button style={{ background:'none', border:'none', color:'var(--text-faint)', fontSize:18, cursor:'pointer' }} onClick={() => setShowImportModal(false)}>✕</button>
          </div>
          <div style={{ marginBottom:12 }}>
            <label style={{ fontSize:11, color:'var(--text-faint)', display:'block', marginBottom:4 }}>Rankings Name</label>
            <input className="input" value={importName} onChange={e => setImportName(e.target.value)} placeholder="e.g. My Pre-Draft Rankings" style={{ width:'100%', boxSizing:'border-box' }} />
          </div>
          <div style={{ marginBottom:12 }}>
            <label style={{ fontSize:11, color:'var(--text-faint)', display:'block', marginBottom:4 }}>File <span style={{ fontWeight:400 }}>(CSV, JSON, or TXT)</span></label>
            <input ref={importFileRef} type="file" accept=".csv,.json,.txt" style={{ display:'none' }} onChange={handleImportFile} />
            <div style={{ display:'flex', alignItems:'center', gap:8 }}>
              <button className="btn ghost sm" onClick={() => importFileRef.current?.click()}>Choose File</button>
              {importFileName && <span style={{ fontSize:11, color:'var(--text-dim)', fontFamily:'var(--font-mono)' }}>{importFileName}</span>}
              {!importFileName && <span style={{ fontSize:11, color:'var(--text-faint)' }}>No file chosen</span>}
            </div>
          </div>
          <div style={{ background:'rgba(255,255,255,.04)', border:'1px solid var(--border)', borderRadius:7, padding:'10px 12px', marginBottom:14 }}>
            <div style={{ fontSize:10, fontWeight:700, color:'var(--text-faint)', textTransform:'uppercase', letterSpacing:'.08em', marginBottom:6 }}>Supported Formats</div>
            <div style={{ fontSize:11, color:'var(--text-dim)', lineHeight:1.7 }}>
              <div><span style={{ fontFamily:'var(--font-mono)', color:'var(--accent-2)' }}>CSV</span> — with headers: <span style={{ fontFamily:'var(--font-mono)' }}>rank,name,pos,team</span> or <span style={{ fontFamily:'var(--font-mono)' }}>name,rank</span></div>
              <div><span style={{ fontFamily:'var(--font-mono)', color:'var(--accent-2)' }}>JSON</span> — array of <span style={{ fontFamily:'var(--font-mono)' }}>{'{name, rank, pos}'}</span> or array of strings</div>
              <div><span style={{ fontFamily:'var(--font-mono)', color:'var(--accent-2)' }}>TXT</span> — one player per line, optionally prefixed with rank (e.g. <span style={{ fontFamily:'var(--font-mono)' }}>1. Josh Allen</span>)</div>
            </div>
          </div>
          {importError && <div style={{ color:'var(--danger)', fontSize:12, marginBottom:10, padding:'6px 10px', background:'rgba(255,90,110,.08)', borderRadius:5 }}>{importError}</div>}
          {importFileText && !importError && (
            <div style={{ fontSize:10, color:'var(--text-faint)', marginBottom:10, fontFamily:'var(--font-mono)' }}>
              Preview: {importFileText.trim().split('\n').slice(0,3).map(l => l.slice(0,60)).join(' | ')}…
            </div>
          )}
          <div style={{ display:'flex', gap:8, justifyContent:'flex-end' }}>
            <button className="btn ghost sm" onClick={() => setShowImportModal(false)}>Cancel</button>
            <button className="btn primary sm" onClick={handleImportSave} disabled={!importName.trim() || !importFileText}>Import Rankings</button>
          </div>
        </div>
      </div>
    )}

    {/* ── Scrape Rankings Modal ─────────────────────────────────────────────── */}
    {showScrapeModal && (
      <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,.72)', zIndex:1000, display:'flex', alignItems:'center', justifyContent:'center', padding:16 }}
        onClick={e => { if (e.target===e.currentTarget && !scrapeLoading) setShowScrapeModal(false); }}>
        <div style={{ background:'var(--panel)', border:'1px solid var(--border-strong)', borderRadius:14, padding:24, width:460, maxWidth:'100%', maxHeight:'90vh', overflowY:'auto' }}>
          <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:18 }}>
            <div style={{ fontSize:15, fontWeight:800 }}>🌐 Scrape Rankings</div>
            <button style={{ background:'none', border:'none', color:'var(--text-faint)', fontSize:18, cursor:'pointer' }} onClick={() => { if (!scrapeLoading) setShowScrapeModal(false); }}>✕</button>
          </div>
          <div style={{ marginBottom:12 }}>
            <label style={{ fontSize:11, color:'var(--text-faint)', display:'block', marginBottom:4 }}>Rankings Name</label>
            <input className="input" value={scrapeName} onChange={e => setScrapeName(e.target.value)} placeholder="e.g. FantasyPros ECR Week 1" style={{ width:'100%', boxSizing:'border-box' }} disabled={scrapeLoading} />
          </div>
          <div style={{ marginBottom:12 }}>
            <label style={{ fontSize:11, color:'var(--text-faint)', display:'block', marginBottom:4 }}>URL to Scrape</label>
            <input className="input" value={scrapeUrl} onChange={e => setScrapeUrl(e.target.value)} placeholder="https://www.fantasypros.com/nfl/rankings/overall.php" style={{ width:'100%', boxSizing:'border-box' }} disabled={scrapeLoading} />
          </div>
          <div style={{ background:'rgba(78,168,255,.06)', border:'1px solid rgba(78,168,255,.2)', borderRadius:7, padding:'10px 12px', marginBottom:14, fontSize:11, color:'var(--text-dim)', lineHeight:1.7 }}>
            <div style={{ fontWeight:700, color:'var(--accent-2)', marginBottom:3 }}>ℹ Best results from:</div>
            <div>• FantasyPros overall / position rankings</div>
            <div>• CBS Sports / ESPN rankings pages</div>
            <div>• Sites with numbered lists or data tables</div>
            <div style={{ marginTop:4, color:'var(--text-faint)', fontSize:10 }}>Note: sites behind login or heavy JavaScript may not parse correctly.</div>
          </div>
          {scrapeError && <div style={{ color:'var(--danger)', fontSize:12, marginBottom:10, padding:'6px 10px', background:'rgba(255,90,110,.08)', borderRadius:5 }}>{scrapeError}</div>}
          <div style={{ display:'flex', gap:8, justifyContent:'flex-end' }}>
            <button className="btn ghost sm" onClick={() => { if (!scrapeLoading) setShowScrapeModal(false); }}>Cancel</button>
            <button className="btn primary sm" onClick={handleScrape} disabled={scrapeLoading || !scrapeName.trim() || !scrapeUrl.trim()}>
              {scrapeLoading ? '⟳ Scraping…' : '🌐 Scrape & Import'}
            </button>
          </div>
        </div>
      </div>
    )}
    </div>
  );
}

// ─── RosterPanel ─────────────────────────────────────────────────────────────

function RosterPanel({ teamId, myRosterIds, onOpenPlayer }) {
  const team = findTeam(teamId);

  const rosterSettings = React.useMemo(() => {
    try { return JSON.parse(localStorage.getItem('fantasai_league_settings') || 'null'); } catch { return null; }
  }, []);

  const slotFrame  = React.useMemo(() => buildRosterFrame(rosterSettings), [rosterSettings]);
  const fullRoster = React.useMemo(
    () => assignRoster(slotFrame, myRosterIds, {}),
    [slotFrame, myRosterIds],
  );

  const starters   = fullRoster.filter(r => r.slot !== 'BENCH' && r.playerId);
  const totalProj  = starters.reduce((s, r) => s + (findPlayer(r.playerId)?.proj || 0), 0);

  return (
    <div className="roster-panel">
      <div className="roster-panel-head">
        <span className="roster-team-dot" style={{ background: team?.color || 'var(--accent)' }} />
        <div style={{ minWidth: 0 }}>
          <div className="roster-team-name">{team?.name || 'My Roster'}</div>
          <div style={{ fontSize: 10, color: 'var(--text-faint)' }}>
            Proj: <span style={{ color: 'var(--accent)', fontWeight: 600 }}>{totalProj.toFixed(1)}</span>
          </div>
        </div>
      </div>
      <div className="roster-list">
        {fullRoster.map((entry, i) => {
          const p = entry.playerId ? findPlayer(entry.playerId) : null;
          const isBench = entry.slot === 'BENCH';
          return (
            <div
              key={i}
              className={`roster-row${isBench ? ' bench' : ''}`}
              onClick={() => p && onOpenPlayer?.(p.id)}
              style={{ cursor: p ? 'pointer' : 'default' }}
            >
              <span className="roster-slot-tag">{entry.slot}</span>
              {p ? (
                <>
                  <span className="roster-name">{p.name}</span>
                  <span className="roster-team-abbr">{p.team}</span>
                  <span className="roster-proj">{p.proj.toFixed(1)}</span>
                </>
              ) : (
                <span style={{ flex: 1, fontSize: 11, color: 'var(--text-faint)' }}>Empty</span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── helpers ────────────────────────────────────────────────────────────────

function fmtStat(v, dec = 0) {
  if (v == null) return '—';
  return dec > 0 ? Number(v).toFixed(dec) : String(Math.round(v));
}

function LiveBadge() {
  return (
    <span style={{ display:'inline-flex', alignItems:'center', gap:4, fontSize:9,
      fontFamily:'var(--font-mono)', letterSpacing:'.1em', color:'var(--accent-2)',
      background:'rgba(78,168,255,.1)', border:'1px solid rgba(78,168,255,.3)',
      borderRadius:4, padding:'1px 6px', textTransform:'uppercase' }}>
      <span style={{ width:5, height:5, borderRadius:'50%', background:'var(--accent-2)',
        boxShadow:'0 0 6px var(--accent-2)', animation:'pulse 2s infinite', display:'inline-block' }}/>
      Live
    </span>
  );
}

// Position-aware game-log columns
function glCols(pos) {
  if (pos === 'QB')  return ['Att','Cmp','Yds','TD','INT','Pts'];
  if (pos === 'RB')  return ['Att','Ru Yds','Rec','Re Yds','TD','Pts'];
  if (pos === 'K')   return ['FGM','FGA','XP','Pts'];
  if (pos === 'DST') return ['Sack','INT','FR','TD','Pts'];
  return ['Snp','Tgt','Rec','Yds','TD','Pts'];  // WR / TE
}

function glRow(pos, s) {
  if (!s) return null;
  const pts = s.pts_half_ppr ?? s.pts_std;
  if (pos === 'QB')  return [fmtStat(s.pass_att), fmtStat(s.pass_cmp), fmtStat(s.pass_yd), fmtStat(s.pass_td), fmtStat(s.pass_int), fmtStat(pts, 1)];
  if (pos === 'RB')  return [fmtStat(s.rush_att), fmtStat(s.rush_yd), fmtStat(s.rec), fmtStat(s.rec_yd), fmtStat((s.rush_td||0)+(s.rec_td||0)), fmtStat(pts, 1)];
  if (pos === 'K')   return [fmtStat(s.fgm), fmtStat(s.fga), fmtStat(s.xpm), fmtStat(pts, 1)];
  if (pos === 'DST') return [fmtStat(s.sack), fmtStat(s.def_int), fmtStat(s.def_fr), fmtStat(s.def_td), fmtStat(pts, 1)];
  return [fmtStat(s.off_snp), fmtStat(s.rec_tgt), fmtStat(s.rec), fmtStat(s.rec_yd), fmtStat(s.rec_td), fmtStat(pts, 1)];
}

function SeasonStatBar({ label, val, max }) {
  const pct = Math.min(100, (val / max) * 100);
  return (
    <div style={{ marginBottom: 8 }}>
      <div className="flex" style={{ justifyContent:'space-between', marginBottom: 3 }}>
        <span className="dim" style={{ fontSize: 11 }}>{label}</span>
        <span style={{ fontFamily:'var(--font-mono)', fontSize: 12, fontWeight: 600 }}>{val ?? '—'}</span>
      </div>
      <div style={{ height: 3, background:'var(--panel-3)', borderRadius: 2 }}>
        <div style={{ width:`${pct}%`, height:'100%', background:'var(--accent-2)', borderRadius: 2, transition:'width .4s' }} />
      </div>
    </div>
  );
}

// ─── PlayerNewsCard ───────────────────────────────────────────────────────────
function PlayerNewsCard({ items = [], loading = false, playerName = '' }) {
  if (loading) {
    return (
      <div className="card">
        <div className="card-head">
          <div className="card-title">News · {playerName}</div>
        </div>
        <div style={{ padding:'12px 16px', display:'flex', alignItems:'center', gap:8 }}>
          <div className="ai-orb" style={{ width:14, height:14 }} />
          <span className="dim" style={{ fontSize:12 }}>Fetching news from all sources…</span>
        </div>
      </div>
    );
  }
  const sources = [...new Set(items.map(n => n.source))];
  return (
    <div className="card">
      <div className="card-head">
        <div className="card-title">News · {playerName}</div>
        {sources.length > 0 && (
          <div style={{ display:'flex', gap:4, flexWrap:'wrap' }}>
            {sources.map(s => <SourceBadge key={s} source={s} />)}
          </div>
        )}
      </div>
      <div className="card-body" style={{ padding:0 }}>
        {items.length === 0 ? (
          <div style={{ padding:'12px 16px', fontSize:12, color:'var(--text-faint)' }}>
            No recent news found. Try refreshing your data sources.
          </div>
        ) : items.map((n, i) => {
          const color = n.sourceColor || SOURCE_META[n.source]?.color || 'var(--accent-2)';
          const minsAgo = n.fetchedAt ? Math.round((Date.now() - n.fetchedAt) / 60000) : null;
          return (
            <div key={i} style={{ padding:'10px 16px', borderTop: i > 0 ? '1px solid var(--border)' : 'none', background: i % 2 !== 0 ? 'rgba(255,255,255,.015)' : 'transparent' }}>
              <div style={{ display:'flex', alignItems:'center', gap:6, marginBottom:5 }}>
                <span style={{ fontSize:9, fontFamily:'var(--font-mono)', fontWeight:700, padding:'2px 6px', borderRadius:3, background:`${color}22`, color, border:`1px solid ${color}55`, whiteSpace:'nowrap' }}>
                  {n.source}
                </span>
                {minsAgo != null && (
                  <span style={{ fontSize:10, color:'var(--accent)', fontFamily:'var(--font-mono)' }}>
                    {minsAgo < 1 ? 'just now' : `${minsAgo}m ago`}
                  </span>
                )}
                {n.mins != null && minsAgo == null && (
                  <span style={{ fontSize:10, color:'var(--text-faint)', fontFamily:'var(--font-mono)' }}>
                    {n.mins < 60 ? `${n.mins}m ago` : `${Math.floor(n.mins/60)}h ago`}
                  </span>
                )}
                <span style={{ flex:1 }} />
                {n.impact && n.impact !== 'low' && (
                  <span className={`news-impact impact-${n.impact}`} style={{ fontSize:9, padding:'1px 6px' }}>
                    {n.impact === 'good' ? 'BOOST' : n.impact?.toUpperCase()}
                  </span>
                )}
              </div>
              {n.title && <div style={{ fontSize:12, fontWeight:600, marginBottom:n.body ? 3 : 0, lineHeight:1.4 }}>{n.title}</div>}
              {n.body  && <div style={{ fontSize:11, color:'var(--text-dim)', lineHeight:1.6 }}>{n.body}</div>}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── PlayerDetail ─────────────────────────────────────────────────────────────

export function PlayerDetail({ player, onClose, myRosterIds = new Set(), onAddPlayer, sourcesState }) {
  if (!player) return null;
  const [activeTab, setTab] = React.useState('overview');
  const [added, setAdded] = React.useState(false);
  const [fetchedNewsItems, setFetchedNewsItems] = React.useState([]);
  const [newsLoading, setNewsLoading] = React.useState(true);

  React.useEffect(() => { setAdded(false); }, [player.id]);

  React.useEffect(() => {
    let cancelled = false;
    setFetchedNewsItems([]);
    setNewsLoading(true);
    async function fetchPlayerNews() {
      const items = [];
      const nameParts = player.name.trim().split(' ');
      const firstName = nameParts[0];
      const lastName  = nameParts.slice(1).join(' ');
      const now = Date.now();
      try {
        const [cbsRes, espnRes] = await Promise.allSettled([
          fetch(`${API_BASE}/api/v1/cbs/players`).then(r => r.ok ? r.json() : null),
          fetch(`${API_BASE}/api/v1/nfl/news?limit=50`).then(r => r.ok ? r.json() : null),
        ]);
        if (cancelled) return;

        if (cbsRes.status === 'fulfilled' && cbsRes.value?.players) {
          const fl = firstName.toLowerCase();
          const ll = lastName.toLowerCase();
          const match = cbsRes.value.players.find(p => {
            const n = (p.name || '').toLowerCase();
            return n.includes(fl) && n.includes(ll);
          });
          if (match && (match.newsTitle || match.news)) {
            items.push({
              source: 'CBS Sports',
              sourceColor: '#0d4ea2',
              title: match.newsTitle || null,
              body:  match.news     || null,
              fetchedAt: now,
              impact: /^out$/i.test(match.status||'') ? 'bad'
                : /questionable/i.test(match.status||'') ? 'medium'
                : 'low',
            });
          }
        }

        if (espnRes.status === 'fulfilled' && espnRes.value?.articles) {
          const fl = firstName.toLowerCase();
          const ll = lastName.toLowerCase();
          for (const art of espnRes.value.articles) {
            const text = `${art.headline||''} ${art.description||''}`.toLowerCase();
            if (text.includes(fl) && text.includes(ll)) {
              items.push({
                source: 'ESPN',
                sourceColor: '#cc0000',
                title: art.headline    || null,
                body:  art.description || null,
                fetchedAt: art.published ? new Date(art.published).getTime() : now,
                impact: 'low',
              });
            }
          }
        }
      } catch { /* network error — show whatever we have */ }
      if (!cancelled) {
        setFetchedNewsItems(items);
        setNewsLoading(false);
      }
    }
    fetchPlayerNews();
    return () => { cancelled = true; };
  }, [player.id]);

  const isOnRoster = myRosterIds.has(player.id);
  const sleeperEnabled = sourcesState?.freeApis?.['sleeper-api'] !== false;

  function handleAdd() {
    if (isOnRoster || added) return;
    onAddPlayer?.(player.id);
    setAdded(true);
    setTimeout(onClose, 1300);
  }

  const { data: live, loading, error } = useApi(
    () => sleeperEnabled
      ? fetchSleeperPlayerStats(player.name, player.pos)
      : Promise.resolve(null),
    [player.id, sleeperEnabled]
  );

  const hasLive = !loading && live?.found && live.weeklyStats && Object.keys(live.weeklyStats).length > 0;
  const statusFromLive = live?.status && live.status !== 'Active' ? live.status : null;

  const playerNewsItems = React.useMemo(() => {
    const items = [...fetchedNewsItems];
    if (!loading && live?.status && !['Active','OK','Na',''].includes(live.status)) {
      const isBad = ['Out','Injured_Reserve','IR','Non_Football_Injury','NFI'].includes(live.status);
      items.unshift({
        source: 'Sleeper',
        sourceColor: '#7c5cbf',
        title: `${live.status}${live.injuryBodyPart ? ` — ${live.injuryBodyPart}` : ''}`,
        body: null,
        fetchedAt: Date.now(),
        impact: isBad ? 'bad' : live.status === 'Questionable' || live.status === 'Doubtful' ? 'medium' : 'low',
      });
    }
    // Fall back to static news when live APIs returned nothing
    if (!newsLoading && items.length === 0) {
      const staticItems = NEWS.filter(n => n.playerId === player.id);
      for (const n of staticItems) {
        items.push({
          source: n.source || 'Beat Writer',
          sourceColor: '#888',
          title: n.title || null,
          body:  n.body  || null,
          mins:  n.mins  || null,
          impact: n.impact === 'high' ? 'bad' : n.impact || 'low',
        });
      }
      if (player.news && items.length === 0) {
        items.push({
          source: 'Beat Writer',
          sourceColor: '#888',
          title: player.news,
          body: player.status && player.status !== 'OK'
            ? `${player.name} listed as ${player.status}. Monitor practice reports.`
            : null,
          fetchedAt: Date.now() - 3_600_000,
          impact: player.status && player.status !== 'OK' ? 'medium' : 'low',
        });
      }
    }
    return items;
  }, [fetchedNewsItems, live, loading, newsLoading, player]);

  const sleeperAvatarUrl = live?.sleeperId
    ? `https://sleepercdn.com/avatars/${live.sleeperId}`
    : null;

  // Game log rows from live data or mock fallback
  const liveRows = hasLive
    ? Object.entries(live.weeklyStats)
        .map(([wk, s]) => ({ wk: Number(wk), s }))
        .sort((a, b) => b.wk - a.wk)
    : null;

  const mockGameLog = [
    { wk: 10, opp: player.opp,  snaps: 64, tar: 9,  rec: 6, yds: 78,  td: 1, pts: player.last },
    { wk: 9,  opp: 'BYE',       snaps:'—', tar:'—', rec:'—',yds:'—', td:'—', pts:'—' },
    { wk: 8,  opp: '@NE',       snaps: 58, tar: 7,  rec: 5, yds: 64,  td: 0, pts: player.trend[4] },
    { wk: 7,  opp: 'NYG',       snaps: 67, tar: 11, rec: 8, yds: 102, td: 1, pts: player.trend[3] },
    { wk: 6,  opp: '@SF',       snaps: 54, tar: 6,  rec: 3, yds: 41,  td: 0, pts: player.trend[2] },
    { wk: 5,  opp: 'TB',        snaps: 62, tar: 8,  rec: 6, yds: 88,  td: 1, pts: player.trend[1] },
    { wk: 4,  opp: '@DAL',      snaps: 60, tar: 5,  rec: 4, yds: 54,  td: 0, pts: player.trend[0] },
  ];

  // Season stats derived from live totals or mock
  const tot = hasLive ? live.seasonTotals : null;
  const gp  = hasLive ? live.gamesPlayed : 10;
  const liveLastPts = hasLive && live.currentWeek
    ? (live.weeklyStats[live.currentWeek] ?? live.weeklyStats[live.currentWeek - 1])?.pts_half_ppr
    : null;
  const liveAvg = tot?.pts_half_ppr != null && gp > 0 ? (tot.pts_half_ppr / gp) : null;

  return (
    <React.Fragment>
      <div className="drawer-overlay" onClick={onClose}></div>
      <div className="drawer">

        {/* ── Hero ── */}
        <div className="detail-hero">
          <PlayerAvatar player={player} size="xl" src={sleeperAvatarUrl} />
          <div>
            <div className="flex gap-8" style={{ alignItems: 'center', flexWrap: 'wrap' }}>
              <PosBadge pos={player.pos} solid />
              <span className="mono dim" style={{ fontSize: 11 }}>{player.team} · #{player.num} · Age {player.age}</span>
              {(player.status !== 'OK' || statusFromLive) &&
                <span className="status-pill"><StatusDot status={player.status} /> {statusFromLive || player.status}</span>}
              {hasLive && <LiveBadge />}
            </div>
            <h2>{player.name}</h2>
            <div className="meta">
              <span>ECR #{player.ecr}</span><span className="dot"></span>
              <span>ADP {player.adp.toFixed(1)}</span><span className="dot"></span>
              <span>Tier {player.tier}</span><span className="dot"></span>
              <span>{player.owned.toFixed(1)}% rostered</span>
            </div>
          </div>
          <div className="flex col gap-8" style={{ alignItems: 'stretch' }}>
            {isOnRoster || added ? (
              <button className="btn success" disabled>✓ {added ? 'Added!' : 'On Roster'}</button>
            ) : (
              <button className="btn primary" onClick={handleAdd}>+ Add to Roster</button>
            )}
            <button className="btn ghost">★ Watchlist</button>
            <button className="btn ghost icon" onClick={onClose} style={{ alignSelf: 'flex-end' }}>✕</button>
          </div>
        </div>

        {/* ── Tabs ── */}
        <div className="tabs">
          {[['overview','Overview'],['gamelog','Game Log'],['news','News'],['matchup','Matchup']].map(([k,v]) => (
            <div key={k} className={`tab ${activeTab===k?'active':''}`} onClick={() => setTab(k)}>{v}</div>
          ))}
        </div>

        <div style={{ padding: 18 }}>

          {/* ── Overview ── */}
          {activeTab === 'overview' && (
            <React.Fragment>
              <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:10, marginBottom:16 }}>
                <div className="stat">
                  <div className="k">
                    Wk {live?.currentWeek || '—'} Proj
                    {hasLive && <span style={{ marginLeft: 5, fontSize: 8, fontFamily: 'var(--font-mono)', color: 'var(--accent-2)', verticalAlign: 'middle' }}>SLEEPER</span>}
                  </div>
                  <div className="v accent">
                    {(live?.projection?.pts_half_ppr ?? live?.projection?.pts_std ?? player.proj).toFixed(1)}
                  </div>
                  <div className="sub">vs {player.opp} (D #{player.oppRank})</div>
                </div>
                <div className="stat">
                  <div className="k">Last Week</div>
                  <div className="v">{(liveLastPts ?? player.last).toFixed(1)}</div>
                  <div className="sub"><Delta from={liveAvg ?? player.avg} to={liveLastPts ?? player.last} /> vs avg</div>
                </div>
                <div className="stat">
                  <div className="k">Season Avg</div>
                  <div className="v">{(liveAvg ?? player.avg).toFixed(1)}</div>
                  <div className="sub">{gp} games {hasLive ? <LiveBadge /> : 'played'}</div>
                </div>
                <div className="stat">
                  <div className="k">6-Wk Trend</div>
                  <div className="v"><Sparkline data={player.trend} width={80} height={28} /></div>
                  <div className="sub mono">{player.trend.join(' · ')}</div>
                </div>
              </div>

              {/* Season Stats */}
              {loading && (
                <div className="muted-card" style={{ marginBottom:16, padding:14, display:'flex', alignItems:'center', gap:10 }}>
                  <div className="ai-orb" style={{ width:16, height:16 }} />
                  <span className="dim" style={{ fontSize:12 }}>Fetching live stats from Sleeper…</span>
                </div>
              )}
              {!loading && error && (
                <div className="muted-card" style={{ marginBottom:16, padding:'10px 14px', borderLeft:'3px solid var(--border-strong)' }}>
                  <span className="dim" style={{ fontSize:11 }}>
                    Sleeper API error — showing projected data.{' '}
                    <span className="mono faint" style={{ fontSize:10 }}>{String(error)}</span>
                  </span>
                </div>
              )}
              {!loading && !error && !hasLive && !sleeperEnabled && (
                <div className="muted-card" style={{ marginBottom:16, padding:'10px 14px', borderLeft:'3px solid var(--border)' }}>
                  <span className="dim" style={{ fontSize:11 }}>
                    Sleeper API is disabled — showing projected data.{' '}
                    <span className="mono faint" style={{ fontSize:10 }}>Enable in Sources → Free Data APIs</span>
                  </span>
                </div>
              )}
              {hasLive && tot && (
                <div className="card" style={{ marginBottom:16 }}>
                  <div className="card-head">
                    <div className="card-title">2025 Season Stats</div>
                    <div style={{ display:'flex', alignItems:'center', gap:6 }}>
                      <LiveBadge />
                      <span className="mono faint" style={{ fontSize:9 }}>Sleeper API · direct</span>
                    </div>
                  </div>
                  <div className="card-body" style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'0 24px' }}>
                    {player.pos === 'QB' && <>
                      <SeasonStatBar label="Pass Yards"  val={Math.round(tot.pass_yd  || 0)} max={5000} />
                      <SeasonStatBar label="Pass TDs"    val={Math.round(tot.pass_td  || 0)} max={50}   />
                      <SeasonStatBar label="Completions" val={Math.round(tot.pass_cmp || 0)} max={400}  />
                      <SeasonStatBar label="INTs"        val={Math.round(tot.pass_int || 0)} max={20}   />
                      <SeasonStatBar label="Rush Yards"  val={Math.round(tot.rush_yd  || 0)} max={800}  />
                      <SeasonStatBar label="Fantasy Pts" val={fmtStat(tot.pts_half_ppr,1)} max={400}  />
                    </>}
                    {player.pos === 'RB' && <>
                      <SeasonStatBar label="Rush Attempts" val={Math.round(tot.rush_att || 0)} max={300} />
                      <SeasonStatBar label="Rush Yards"    val={Math.round(tot.rush_yd  || 0)} max={1800}/>
                      <SeasonStatBar label="Rush TDs"      val={Math.round(tot.rush_td  || 0)} max={20}  />
                      <SeasonStatBar label="Receptions"    val={Math.round(tot.rec      || 0)} max={100} />
                      <SeasonStatBar label="Rec Yards"     val={Math.round(tot.rec_yd   || 0)} max={800} />
                      <SeasonStatBar label="Fantasy Pts"   val={fmtStat(tot.pts_half_ppr,1)} max={350}  />
                    </>}
                    {(player.pos === 'WR' || player.pos === 'TE') && <>
                      <SeasonStatBar label="Targets"     val={Math.round(tot.rec_tgt || 0)} max={200} />
                      <SeasonStatBar label="Receptions"  val={Math.round(tot.rec     || 0)} max={150} />
                      <SeasonStatBar label="Rec Yards"   val={Math.round(tot.rec_yd  || 0)} max={1800}/>
                      <SeasonStatBar label="Rec TDs"     val={Math.round(tot.rec_td  || 0)} max={20}  />
                      <SeasonStatBar label="Catch %"     val={tot.rec_tgt > 0 ? fmtStat((tot.rec/tot.rec_tgt)*100,1)+'%' : '—'} max={100} />
                      <SeasonStatBar label="Fantasy Pts" val={fmtStat(tot.pts_half_ppr,1)} max={350}  />
                    </>}
                  </div>
                </div>
              )}

              {/* Sources strip */}
              {sourcesState && (
                <div style={{ marginBottom:14, display:'flex', flexWrap:'wrap', gap:6, alignItems:'center' }}>
                  <span className="mono faint" style={{ fontSize:10, letterSpacing:'.08em' }}>DATA SOURCES</span>
                  {FREE_DATA_SOURCES_LIST.map(s => {
                    const on = sourcesState.freeApis?.[s.id] !== false && sourcesState.freeApis?.[s.id] !== undefined
                      ? sourcesState.freeApis[s.id]
                      : s.defaultEnabled;
                    return (
                      <span key={s.id} style={{
                        display:'inline-flex', alignItems:'center', gap:4, fontSize:10,
                        fontFamily:'var(--font-mono)', padding:'2px 7px', borderRadius:4,
                        background: on ? 'rgba(78,168,255,.1)' : 'var(--panel-2)',
                        border: `1px solid ${on ? 'rgba(78,168,255,.35)' : 'var(--border)'}`,
                        color: on ? 'var(--accent-2)' : 'var(--text-faint)',
                      }}>
                        <span style={{ width:5, height:5, borderRadius:'50%', background: on ? 'var(--accent-2)' : 'var(--text-faint)', display:'inline-block', flexShrink:0 }} />
                        {s.name}{on ? ' · live' : ' · off'}
                      </span>
                    );
                  })}
                  {Object.entries(sourcesState.feeds || {}).filter(([,v]) => v.enabled).slice(0, 4).map(([id]) => {
                    const name = FEED_NAMES[id] || id;
                    return (
                      <span key={id} style={{
                        fontSize:10, fontFamily:'var(--font-mono)', padding:'2px 7px', borderRadius:4,
                        background:'rgba(198,255,58,.07)', border:'1px solid rgba(198,255,58,.2)',
                        color:'var(--accent)',
                      }}>{name}</span>
                    );
                  })}
                  {Object.entries(sourcesState.feeds || {}).filter(([,v]) => v.enabled).length > 4 && (
                    <span className="faint mono" style={{ fontSize:10 }}>
                      +{Object.entries(sourcesState.feeds).filter(([,v]) => v.enabled).length - 4} more
                    </span>
                  )}
                </div>
              )}

              {/* AI insight */}
              <div className="muted-card" style={{ marginBottom:16, borderLeft:'3px solid var(--accent-2)' }}>
                <div className="flex gap-8" style={{ alignItems:'center', marginBottom:8 }}>
                  <div className="ai-orb" style={{ width:20, height:20 }}></div>
                  <span style={{ fontFamily:'var(--font-display)', fontStretch:'87%', fontWeight:800, fontSize:11, letterSpacing:'.12em', textTransform:'uppercase', color:'var(--accent-2)' }}>FantasAI Insight</span>
                </div>
                <div style={{ fontSize:13, lineHeight:1.55 }}>
                  {player.proj > 18
                    ? `Lock 'em in. Matchup model loves ${player.opp.replace('@','')} — ${player.name} should see volume at depth. Proj ${player.proj.toFixed(1)} is conservative; 75th-pct is ${(player.proj*1.25).toFixed(1)}.`
                    : `Mixed signals. Volume is fine but ${player.opp.replace('@','')} has been stingy near the goal line. Floor ${(player.proj*0.6).toFixed(1)}, ceiling ${(player.proj*1.4).toFixed(1)}.`}
                </div>
              </div>

              <PlayerNewsCard items={playerNewsItems} loading={newsLoading || loading} playerName={player.name} />
            </React.Fragment>
          )}

          {/* ── Game Log ── */}
          {activeTab === 'gamelog' && (
            loading
              ? <div className="muted-card" style={{ padding:18, display:'flex', alignItems:'center', gap:10 }}>
                  <div className="ai-orb" style={{ width:16, height:16 }} />
                  <span className="dim" style={{ fontSize:12 }}>Loading game log from Sleeper…</span>
                </div>
              : liveRows
                ? <>
                    <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:10 }}>
                      <span className="dim" style={{ fontSize:11 }}>2025 Season · Half PPR</span>
                      <LiveBadge />
                      <span className="mono faint" style={{ fontSize:9 }}>Sleeper API</span>
                    </div>
                    <table className="gamelog">
                      <thead>
                        <tr>
                          <th>Wk</th>
                          {glCols(player.pos).map(c => <th key={c}>{c}</th>)}
                        </tr>
                      </thead>
                      <tbody>
                        {liveRows.map(({ wk, s }) => {
                          const cells = glRow(player.pos, s);
                          if (!cells) return null;
                          const ptsIdx = cells.length - 1;
                          return (
                            <tr key={wk}>
                              <td className="mono" style={{ color:'var(--text-faint)' }}>{wk}</td>
                              {cells.map((c, i) => (
                                <td key={i} style={i===ptsIdx ? { fontWeight:600, color:'var(--accent)' } : {}}>{c}</td>
                              ))}
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </>
                : <>
                    {error && <div className="dim" style={{ fontSize:11, marginBottom:10 }}>Live data unavailable — showing sample data.</div>}
                    <table className="gamelog">
                      <thead><tr><th>Wk</th><th>Opp</th><th>Snp</th><th>Tar</th><th>Rec</th><th>Yds</th><th>TD</th><th>Pts</th></tr></thead>
                      <tbody>
                        {mockGameLog.map(g => (
                          <tr key={g.wk}>
                            <td>{g.wk}</td><td>{g.opp}</td><td>{g.snaps}</td>
                            <td>{g.tar}</td><td>{g.rec}</td><td>{g.yds}</td><td>{g.td}</td>
                            <td style={{ fontWeight:600, color:'var(--accent)' }}>{typeof g.pts==='number' ? g.pts.toFixed(1) : g.pts}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </>
          )}

          {/* ── News ── */}
          {activeTab === 'news' && (
            <PlayerNewsCard items={playerNewsItems} loading={newsLoading || loading} playerName={player.name} />
          )}

          {/* ── Matchup ── */}
          {activeTab === 'matchup' && (
            <div>
              <div className="muted-card" style={{ marginBottom:16 }}>
                <div className="flex gap-16" style={{ justifyContent:'space-around', textAlign:'center' }}>
                  <div>
                    <div className="mono dim" style={{ fontSize:11 }}>{player.team}</div>
                    <div style={{ fontFamily:'var(--font-display)', fontStretch:'75%', fontSize:28, fontWeight:900 }}>7-3</div>
                  </div>
                  <div style={{ fontFamily:'var(--font-display)', fontStretch:'75%', fontSize:28, fontWeight:900, color:'var(--text-faint)', alignSelf:'center' }}>vs</div>
                  <div>
                    <div className="mono dim" style={{ fontSize:11 }}>{player.opp}</div>
                    <div style={{ fontFamily:'var(--font-display)', fontStretch:'75%', fontSize:28, fontWeight:900 }}>5-5</div>
                  </div>
                </div>
                <div style={{ textAlign:'center', fontSize:11, color:'var(--text-faint)', marginTop:8 }} className="mono">SUN 1:00PM ET · O/U 47.5 · {player.team} -3.5</div>
              </div>
              <div className="card-title" style={{ marginBottom:8 }}>Defense vs Position ({player.pos})</div>
              <table className="gamelog">
                <thead><tr><th>Metric</th><th>{player.opp}</th><th>NFL Avg</th><th>Rank</th></tr></thead>
                <tbody>
                  <tr><td>FP Allowed/G</td><td>{(20-player.oppRank*0.3).toFixed(1)}</td><td>15.8</td><td style={{ color:player.oppRank>20?'var(--good)':'var(--danger)' }}>#{player.oppRank}</td></tr>
                  <tr><td>Yds Allowed/G</td><td>284</td><td>241</td><td>#26</td></tr>
                  <tr><td>TDs Allowed</td><td>18</td><td>14</td><td>#28</td></tr>
                  <tr><td>Pressure %</td><td>22.4%</td><td>24.1%</td><td>#19</td></tr>
                </tbody>
              </table>
            </div>
          )}

        </div>
      </div>
    </React.Fragment>
  );
}
