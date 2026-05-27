import React from 'react';
import { NEWS, PLAYERS, findPlayer, FREE_DATA_SOURCES, LIMITED_FREE_SOURCES, SOURCE_META, TEAM_ROSTERS } from '../lib/data.js';

// Players currently on any roster
const ROSTERED_IDS = new Set(
  Object.values(TEAM_ROSTERS).flatMap(entries => entries.map(e => e.playerId).filter(Boolean))
);
import { PosBadge, PlayerAvatar } from '../components/ui.jsx';
import { fetchSleeperPlayerStats } from '../lib/sleeper.js';

const API_BASE = 'https://api.fantasai.net';

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtAge(mins, fetchedAt) {
  if (fetchedAt) {
    const m = Math.round((Date.now() - fetchedAt) / 60000);
    return m < 1 ? 'just now' : m < 60 ? `${m}m ago` : `${Math.floor(m / 60)}h ago`;
  }
  return mins < 60 ? `${mins}m ago` : `${Math.floor(mins / 60)}h ago`;
}

function guessType(text = '') {
  const t = text.toLowerCase();
  if (/injur|injured|\bout\b|questionable|doubtful|limited|dnp|\bir\b|pup|surgery|hamstring|knee|shoulder|ankle/.test(t)) return 'injury';
  if (/trade|waiv|sign|released?\b|cut\b|claim|acquired|transaction/.test(t)) return 'transaction';
  return 'analysis';
}

function guessImpact(text = '') {
  const t = text.toLowerCase();
  if (/\bout\b|placed on ir|season.ending|torn|fracture|surgery|won.t play|ruled out/.test(t)) return 'high';
  if (/questionable|doubtful|limited|miss.*game|expected to miss/.test(t)) return 'med';
  if (/full practice|no limitation|cleared|activated|returned|expected to play/.test(t)) return 'good';
  return 'low';
}

function extractTitle(text = '', maxLen = 110) {
  const sentence = text.replace(/\n/g, ' ').split(/(?<=[.!?])\s+/)[0].trim();
  return sentence.length > maxLen ? sentence.slice(0, maxLen) + '…' : sentence;
}

function makeLiveItem(src, player, note, titleOverride) {
  return {
    id:        `${src.id}-${player.id}-${Date.now()}`,
    playerId:  player.id,
    type:      guessType(note),
    impact:    guessImpact(note),
    mins:      0,
    fetchedAt: Date.now(),
    source:    src.name,
    sourceId:  src.id,
    color:     src.color,
    title:     titleOverride || extractTitle(note),
    body:      note,
  };
}

function srcColor(item) {
  return item.color || SOURCE_META[item.source]?.color || 'var(--text-faint)';
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function NewsScreen({ onOpenPlayer, sourcesState }) {
  const [filter,   setFilter]   = React.useState('all');
  const [impact,   setImpact]   = React.useState('all');
  const [pos,      setPos]      = React.useState('ALL');
  const [search,   setSearch]   = React.useState('');
  const [grouped,  setGrouped]  = React.useState(false);
  const [faFilter, setFaFilter] = React.useState('all'); // 'all' | 'fa' | 'sleeper'

  // liveItems: { [sourceId]: newsItem[] }
  const [liveItems,         setLiveItems]         = React.useState({});
  const [fetchingSourceIds, setFetchingSourceIds] = React.useState(new Set());
  const [lastFetched,       setLastFetched]       = React.useState({});
  const [refreshResults,    setRefreshResults]    = React.useState({});
  const [sourceErrors,      setSourceErrors]      = React.useState({});

  // Sleeper and CBS are always shown — no toggle required
  const SLEEPER_SRC = React.useMemo(
    () => ({ ...FREE_DATA_SOURCES.find(s => s.id === 'sleeper-api'), kind: 'free' }),
    [],
  );
  const CBS_NEWS_SRC = React.useMemo(
    () => ({ ...FREE_DATA_SOURCES.find(s => s.id === 'cbs-news'), kind: 'free' }),
    [],
  );

  const activatedSources = React.useMemo(() => {
    // Sleeper first (default), CBS second, then user-toggled sources
    const result = [SLEEPER_SRC, CBS_NEWS_SRC];
    for (const src of FREE_DATA_SOURCES) {
      if (src.id === 'sleeper-api' || src.id === 'cbs-news') continue;
      if (sourcesState?.freeApis?.[src.id]) result.push({ ...src, kind: 'free' });
    }
    try {
      const saved = JSON.parse(localStorage.getItem('fantasai_limited_apis') || '{}');
      for (const src of LIMITED_FREE_SOURCES) {
        const cfg = saved[src.id];
        if (cfg?.enabled) result.push({ ...src, apiKey: cfg.apiKey || src.defaultKey || '', kind: 'limited' });
      }
    } catch {}
    return result;
  }, [sourcesState, SLEEPER_SRC, CBS_NEWS_SRC]);

  // Auto-fetch Sleeper (default) and CBS on page load
  // eslint-disable-next-line react-hooks/exhaustive-deps
  React.useEffect(() => {
    handleRefreshSource(SLEEPER_SRC);
    handleRefreshSource(CBS_NEWS_SRC);
  }, []);

  // Targets for per-player APIs: top-100 by ECR
  const newsTargets = React.useMemo(
    () => PLAYERS.slice().sort((a, b) => (a.ecr || 999) - (b.ecr || 999)).slice(0, 100),
    [],
  );

  // Match a name string to a PLAYERS entry
  function matchPlayer(name = '') {
    const n = name.toLowerCase();
    return PLAYERS.find(p => {
      const pn = p.name.toLowerCase();
      if (n === pn) return true;
      const nParts = n.split(' ');
      const pParts = pn.split(' ');
      return nParts.at(-1) === pParts.at(-1) && nParts[0]?.[0] === pParts[0]?.[0];
    });
  }

  async function handleRefreshSource(src) {
    if (fetchingSourceIds.has(src.id)) return;
    setFetchingSourceIds(prev => new Set([...prev, src.id]));
    setSourceErrors(prev => { const n = { ...prev }; delete n[src.id]; return n; });

    const newItems = [];
    let total = 0;
    let fetchError = null;

    try {
      // ── CBS League News ──────────────────────────────────────────────────
      if (src.id === 'cbs-news') {
        const res = await fetch(`${API_BASE}/api/v1/cbs/players`, { signal: AbortSignal.timeout(20000) });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        {
          const { players: cbsPlayers = [] } = await res.json();
          const withNews = cbsPlayers.filter(cp => cp.news);
          total = withNews.length;
          for (const cp of withNews) {
            const match = matchPlayer(cp.name);
            if (!match) continue;
            // CBS status supplements the news body when present
            const body = cp.status && cp.status !== 'Active'
              ? `[${cp.status}] ${cp.news}`
              : cp.news;
            newItems.push(makeLiveItem(src, match, body.slice(0, 800), cp.newsTitle || undefined));
          }
        }
      }

      // ── ESPN NFL news feed ───────────────────────────────────────────────
      else if (src.id === 'espn-nfl') {
        const res = await fetch(`${API_BASE}/api/v1/nfl/news?limit=100`, { signal: AbortSignal.timeout(10000) });
        if (res.ok) {
          const { articles = [] } = await res.json();
          total = articles.length;
          for (const article of articles) {
            if (!article.headline) continue;
            const text = `${article.headline} ${article.description || ''}`;
            const match = PLAYERS.find(p => {
              const parts = p.name.split(' ');
              const first = parts[0];
              const last  = parts.slice(1).join(' ');
              return last.length > 2 && text.includes(first) && text.includes(last);
            });
            if (!match) continue;
            const body = article.description || article.headline;
            newItems.push({ ...makeLiveItem(src, match, body), title: article.headline });
          }
        }
      }

      // ── Sleeper API ──────────────────────────────────────────────────────
      else if (src.id === 'sleeper-api') {
        total = newsTargets.length;
        const results = await Promise.allSettled(
          newsTargets.map(p => fetchSleeperPlayerStats(p.name, p.pos))
        );
        results.forEach((r, i) => {
          if (r.status !== 'fulfilled' || !r.value?.found) return;
          const d = r.value;
          const p = newsTargets[i];
          const parts = [];
          if (d.status && d.status !== 'Active') parts.push(d.status);
          if (d.injuryBodyPart) parts.push(d.injuryBodyPart);
          if (!parts.length) return;
          newItems.push(makeLiveItem(src, p, parts.join(' · ')));
        });
      }

      // ── nflverse injury CSV ──────────────────────────────────────────────
      else if (src.id === 'nflverse') {
        const year = new Date().getFullYear();
        let csvText = null;
        for (const y of [year, year - 1]) {
          const rawUrl   = `https://github.com/nflverse/nflverse-data/releases/download/injuries/injuries_${y}.csv`;
          const proxyUrl = `${API_BASE}/api/v1/proxy?url=${encodeURIComponent(rawUrl)}`;
          try {
            const res = await fetch(proxyUrl, { signal: AbortSignal.timeout(20000) });
            if (res.ok) { csvText = await res.text(); break; }
          } catch {}
        }
        if (csvText) {
          const lines   = csvText.split('\n').filter(Boolean);
          const headers = lines[0].split(',').map(h => h.replace(/"/g, '').trim());
          const rows    = lines.slice(1).map(line => {
            const vals = line.split(',').map(v => v.replace(/"/g, '').trim());
            const row  = {};
            headers.forEach((h, idx) => { row[h] = vals[idx] ?? ''; });
            return row;
          });
          // Keep most recent week per player
          const latest = {};
          for (const row of rows) {
            const name = row.full_name;
            if (!name) continue;
            const key = (parseInt(row.season) || 0) * 100 + (parseInt(row.week) || 0);
            if (!latest[name] || latest[name]._key < key) latest[name] = { ...row, _key: key };
          }
          total = PLAYERS.length;
          for (const p of PLAYERS) {
            const row = latest[p.name] ?? latest[Object.keys(latest).find(n => n.toLowerCase() === p.name.toLowerCase())];
            if (!row) continue;
            const status = row.report_status || row.practice_status || '';
            if (!status || ['', 'Active', 'Full Participation', 'DNE'].includes(status)) continue;
            const injury = row.report_primary_injury || row.practice_primary_injury || '';
            const note   = injury ? `${status} · ${injury}` : status;
            newItems.push(makeLiveItem(src, p, note));
          }
        }
      }
    } catch (err) {
      fetchError = err?.name === 'TimeoutError' ? 'timeout' : (err?.message || 'failed');
    }

    if (fetchError) setSourceErrors(prev => ({ ...prev, [src.id]: fetchError }));
    // Deduplicate within this source's result set: one entry per player
    const seenPlayers = new Set();
    const deduped = newItems.filter(item => {
      if (seenPlayers.has(item.playerId)) return false;
      seenPlayers.add(item.playerId);
      return true;
    });
    setLiveItems(prev => ({ ...prev, [src.id]: deduped }));
    setRefreshResults(prev => ({ ...prev, [src.id]: { updated: newItems.length, total } }));
    setLastFetched(prev => ({ ...prev, [src.id]: Date.now() }));
    setFetchingSourceIds(prev => { const n = new Set(prev); n.delete(src.id); return n; });
  }

  // Merge all sources into one entry per player.
  // CBS replaces static Beat Writer entries; all live sources are combined under the same player card.
  const IMPACT_RANK = { high: 3, med: 2, good: 1, low: 0 };
  const allNews = React.useMemo(() => {
    const allLive = Object.values(liveItems).flat();
    const cbsIds  = new Set((liveItems['cbs-news'] || []).map(i => i.playerId));
    const base    = NEWS.filter(n => !cbsIds.has(n.playerId));
    const raw     = [...base, ...allLive];

    // Group by player — one card per player, sources[] accumulates each entry
    const byPlayer = new Map();
    for (const item of raw) {
      if (!byPlayer.has(item.playerId)) {
        byPlayer.set(item.playerId, { ...item, sources: [item] });
      } else {
        const merged = byPlayer.get(item.playerId);
        // One entry per (source, player): injury/status sources produce exactly one
        // update per player so any second entry from the same source is a duplicate.
        const isDup = merged.sources.some(s => s.sourceId === item.sourceId);
        if (isDup) continue;
        merged.sources.push(item);
        // Escalate impact to worst seen
        if ((IMPACT_RANK[item.impact] ?? 0) > (IMPACT_RANK[merged.impact] ?? 0)) {
          merged.impact = item.impact;
          merged.title  = item.title;
          merged.type   = item.type;
        }
        // Keep most-recent fetchedAt
        if (item.fetchedAt && item.fetchedAt > (merged.fetchedAt || 0)) {
          merged.fetchedAt = item.fetchedAt;
        }
      }
    }

    return [...byPlayer.values()].sort((a, b) => {
      const aAge = a.fetchedAt ? 0 : (a.mins ?? 9999);
      const bAge = b.fetchedAt ? 0 : (b.mins ?? 9999);
      return aAge - bAge;
    });
  }, [liveItems]);

  // Apply filters — filter on the merged card's worst impact/type
  let news = allNews;
  if (filter !== 'all') news = news.filter(n => n.sources.some(s => s.type === filter));
  if (impact !== 'all') news = news.filter(n => n.impact === impact);
  if (pos === 'FLEX')   news = news.filter(n => ['RB', 'WR', 'TE'].includes(findPlayer(n.playerId)?.pos));
  else if (pos !== 'ALL') news = news.filter(n => findPlayer(n.playerId)?.pos === pos);
  if (search.trim())    news = news.filter(n => findPlayer(n.playerId)?.name.toLowerCase().includes(search.trim().toLowerCase()));

  // Free agent / sleeper filters
  if (faFilter === 'fa') {
    news = news.filter(n => !ROSTERED_IDS.has(n.playerId));
  } else if (faFilter === 'sleeper') {
    // Free agent + positive news (good impact or analysis type with returning/boost signal)
    news = news.filter(n => {
      if (ROSTERED_IDS.has(n.playerId)) return false;
      return n.impact === 'good' || n.sources.some(s => s.type === 'analysis' || s.impact === 'good');
    });
  }

  const uniqueSrcCount = new Set(news.flatMap(n => n.sources.map(s => s.sourceId || s.source))).size;
  const faCount       = allNews.filter(n => !ROSTERED_IDS.has(n.playerId)).length;
  const sleeperCount  = allNews.filter(n => !ROSTERED_IDS.has(n.playerId) && (n.impact === 'good' || n.sources.some(s => s.type === 'analysis' || s.impact === 'good'))).length;

  return (
    <div className="col" style={{ height: '100%' }}>

      {/* PAGE HEAD */}
      <div className="page-head" style={{ alignItems: 'flex-start', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h1>News &amp; Updates</h1>
          <div className="sub">Injury reports, transactions, analysis · multi-source</div>
        </div>

        {/* Source refresh buttons — same pattern as Current Roster */}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6, marginLeft: 'auto' }}>
          <div style={{ fontSize: 10, fontFamily: 'var(--font-mono)', fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--text-faint)' }}>
            Data Source Refresh
          </div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
            {activatedSources.map(src => {
              const isFetching = fetchingSourceIds.has(src.id);
              const ts  = lastFetched[src.id];
              const ago = ts ? Math.round((Date.now() - ts) / 60000) : null;
              return (
                <button
                  key={src.id}
                  className="btn sm ghost"
                  style={{ fontSize: 10, borderColor: src.color, color: isFetching ? 'var(--text-faint)' : src.color, whiteSpace: 'nowrap' }}
                  disabled={isFetching}
                  onClick={() => handleRefreshSource(src)}
                >
                  {isFetching ? `⟳ ${src.name}…` : `↻ ${src.name}${ago != null ? ` · ${ago}m ago` : ''}`}
                </button>
              );
            })}
          </div>
          {activatedSources.some(s => refreshResults[s.id] || sourceErrors[s.id]) && (
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
              {activatedSources.filter(s => refreshResults[s.id] || sourceErrors[s.id]).map(src => {
                const err = sourceErrors[src.id];
                if (err) {
                  return (
                    <span key={src.id} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 10, fontFamily: 'var(--font-mono)' }}>
                      <span style={{ color: '#ff6b6b', fontWeight: 700 }}>{src.name}</span>
                      <span style={{ color: '#ff6b6b', opacity: 0.85 }}>⚠ {err}</span>
                    </span>
                  );
                }
                const { updated, total } = refreshResults[src.id];
                return (
                  <span key={src.id} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 10, fontFamily: 'var(--font-mono)' }}>
                    <span style={{ color: updated > 0 ? src.color : 'var(--text-faint)', fontWeight: 700 }}>{src.name}</span>
                    <span style={{ color: updated > 0 ? src.color : 'var(--text-faint)', opacity: 0.85 }}>{updated}/{total}</span>
                  </span>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* FILTERS — type + impact */}
      <div className="toolbar" style={{ flexWrap: 'wrap', gap: 8 }}>
        <div className="chips">
          {[['all', 'All'], ['injury', 'Injury'], ['transaction', 'Trans'], ['analysis', 'Analysis'], ['matchup', 'Matchup']].map(([k, v]) => (
            <div key={k} className={`chip ${filter === k ? 'accent active' : ''}`} onClick={() => setFilter(k)}>{v}</div>
          ))}
        </div>
        <div className="chips">
          {[['all', 'All Impact'], ['high', 'High'], ['med', 'Med'], ['low', 'Low'], ['good', 'Good']].map(([k, v]) => (
            <div key={k} className={`chip ${impact === k ? 'active' : ''}`} onClick={() => setImpact(k)}>{v}</div>
          ))}
        </div>
        <div className="grow" />
        <div className="view-toggle hide-mobile">
          <button className={`vt-btn${!grouped ? ' active' : ''}`} onClick={() => setGrouped(false)}>Timeline</button>
          <button className={`vt-btn${grouped ? ' active' : ''}`} onClick={() => setGrouped(true)}>By Player</button>
        </div>
      </div>

      {/* FILTERS — pos + search + FA/sleeper */}
      <div className="toolbar" style={{ borderTop: 'none', paddingTop: 0, gap: 8 }}>
        <div className="chips">
          {['ALL', 'QB', 'RB', 'WR', 'TE', 'FLEX', 'K', 'DST'].map(p => (
            <div key={p} className={`chip ${pos === p ? 'accent active' : ''}`} onClick={() => setPos(p)}>{p}</div>
          ))}
        </div>
        <div style={{ width: 1, height: 20, background: 'var(--border)', flexShrink: 0 }} />
        <button
          className={`btn sm${faFilter === 'fa' ? '' : ' ghost'}`}
          style={{
            fontSize: 11, fontFamily: 'var(--font-mono)',
            background: faFilter === 'fa' ? 'rgba(78,168,255,.18)' : undefined,
            borderColor: faFilter === 'fa' ? '#4ea8ff' : undefined,
            color: faFilter === 'fa' ? '#4ea8ff' : 'var(--text-faint)',
          }}
          onClick={() => setFaFilter(f => f === 'fa' ? 'all' : 'fa')}
        >
          Free Agent{faCount > 0 ? ` · ${faCount}` : ''}
        </button>
        <button
          className={`btn sm${faFilter === 'sleeper' ? '' : ' ghost'}`}
          style={{
            fontSize: 11, fontFamily: 'var(--font-mono)',
            background: faFilter === 'sleeper' ? 'rgba(198,255,58,.12)' : undefined,
            borderColor: faFilter === 'sleeper' ? 'var(--accent)' : undefined,
            color: faFilter === 'sleeper' ? 'var(--accent)' : 'var(--text-faint)',
          }}
          onClick={() => setFaFilter(f => f === 'sleeper' ? 'all' : 'sleeper')}
        >
          ⚡ Possible Sleeper{sleeperCount > 0 ? ` · ${sleeperCount}` : ''}
        </button>
        <input
          className="input search"
          placeholder="Search player…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          style={{ width: 200 }}
        />
        {(pos !== 'ALL' || search || faFilter !== 'all') && (
          <button className="btn sm ghost" onClick={() => { setPos('ALL'); setSearch(''); setFaFilter('all'); }}>✕ Clear</button>
        )}
        <div className="grow" />
        <span className="faint mono" style={{ fontSize: 11 }}>
          {news.length} item{news.length !== 1 ? 's' : ''} · {uniqueSrcCount} source{uniqueSrcCount !== 1 ? 's' : ''}
        </span>
      </div>

      <div style={{ flex: 1, overflow: 'auto' }}>
        {news.length === 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '60%', gap: 12, color: 'var(--text-faint)' }}>
            <div style={{ fontSize: 32 }}>📰</div>
            <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-dim)' }}>No news loaded yet</div>
            <div style={{ fontSize: 12, textAlign: 'center', maxWidth: 320, lineHeight: 1.6 }}>
              Click <span style={{ color: '#0d4ea2', fontWeight: 700 }}>↻ CBS League News</span> above to pull live articles from your CBS league, or refresh any other source.
            </div>
            {sourceErrors['cbs-news'] && (
              <div style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: '#ff6b6b', background: 'rgba(255,107,107,.08)', border: '1px solid rgba(255,107,107,.2)', borderRadius: 6, padding: '8px 16px', maxWidth: 360, textAlign: 'center' }}>
                CBS: {sourceErrors['cbs-news']}
                {sourceErrors['cbs-news'].includes('502') && (
                  <div style={{ marginTop: 4, fontSize: 10, color: 'var(--text-faint)' }}>
                    CBS worker is deployed but the session cookie may have expired — run <code>wrangler secret put CBS_COOKIE</code> in <code>worker/</code> and redeploy.
                  </div>
                )}
              </div>
            )}
          </div>
        ) : grouped
          ? <GroupedView news={news} onOpenPlayer={onOpenPlayer} />
          : <TimelineView news={news} onOpenPlayer={onOpenPlayer} />
        }
      </div>
    </div>
  );
}

/* ── Source badge — handles both static SOURCE_META names and live colored sources ── */
function SrcBadge({ item }) {
  const color = srcColor(item);
  return (
    <span style={{
      fontSize: 9, fontFamily: 'var(--font-mono)', fontWeight: 700,
      letterSpacing: '.05em', padding: '2px 6px', borderRadius: 3,
      background: `${color}22`, color, border: `1px solid ${color}55`,
      whiteSpace: 'nowrap',
    }}>
      {item.source}
    </span>
  );
}

/* ── Shared player card — used by both Timeline and Grouped views ─────────────── */
function PlayerNewsCard({ n, onOpenPlayer, compact = false }) {
  const player = findPlayer(n.playerId);
  if (!player) return null;
  const srcs = n.sources || [n];

  return (
    <div
      style={{ borderBottom: '1px solid var(--border)', cursor: 'pointer' }}
      onClick={() => onOpenPlayer(player.id)}
    >
      {/* Player header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: compact ? '10px 16px 6px' : '12px 20px 8px', background: 'var(--panel-1)' }}>
        <PlayerAvatar player={player} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span style={{ fontWeight: 700, fontSize: 14 }}>{player.name}</span>
            <PosBadge pos={player.pos} />
            <span style={{ fontSize: 11, color: 'var(--text-dim)' }}>{player.team}</span>
            <span style={{ fontSize: 10, color: 'var(--accent)', fontFamily: 'var(--font-mono)' }}>{fmtAge(n.mins, n.fetchedAt)}</span>
            {srcs.length > 1 && (
              <span style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--accent-2)', background: 'rgba(78,168,255,.12)', border: '1px solid rgba(78,168,255,.3)', borderRadius: 4, padding: '1px 6px' }}>
                {srcs.length} sources
              </span>
            )}
          </div>
          <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', marginTop: 4 }}>
            {srcs.map((s, i) => <SrcBadge key={i} item={s} />)}
          </div>
        </div>
        <div className={`news-impact impact-${n.impact}`}>{n.impact === 'good' ? 'BOOST' : n.impact?.toUpperCase()}</div>
      </div>

      {/* One section per source */}
      {srcs.map((s, i) => (
        <div key={i} style={{
          padding: compact ? '8px 16px 8px 52px' : '10px 20px 10px 56px',
          borderTop: '1px solid var(--border)',
          background: i % 2 === 0 ? 'transparent' : 'rgba(255,255,255,.015)',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
            <SrcBadge item={s} />
            {srcs.length > 1 && (
              <div className={`news-impact impact-${s.impact}`} style={{ fontSize: 9, padding: '1px 6px' }}>
                {s.impact === 'good' ? 'BOOST' : s.impact?.toUpperCase()}
              </div>
            )}
          </div>
          {s.title && <div className="title" style={{ marginBottom: s.body ? 3 : 0 }}>{s.title}</div>}
          {s.body  && <div className="body">{s.body}</div>}
        </div>
      ))}
    </div>
  );
}

/* ── Timeline view ───────────────────────────────────────────────────────────── */
function TimelineView({ news, onOpenPlayer }) {
  return (
    <>
      {news.map(n => <PlayerNewsCard key={n.id} n={n} onOpenPlayer={onOpenPlayer} />)}
    </>
  );
}

/* ── Grouped view — same cards, just labelled differently in the toggle ──────── */
function GroupedView({ news, onOpenPlayer }) {
  return (
    <>
      {news.map(n => <PlayerNewsCard key={n.id} n={n} onOpenPlayer={onOpenPlayer} compact />)}
    </>
  );
}

