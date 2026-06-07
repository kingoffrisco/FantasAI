import React from 'react';
import { NEWS, FREE_DATA_SOURCES, LIMITED_FREE_SOURCES, SOURCE_META, TEAM_ROSTERS, findTeam } from '../lib/data.js';
import { getPlayers, findPlayer, findPlayerByName } from '../lib/playerStore.js';
import { PosBadge, PlayerAvatar, TeamLogoBadge } from '../components/ui.jsx';
import { fetchSleeperPlayerStats } from '../lib/sleeper.js';
import { useR2PlayerNotes, useR2AiSummaries, useR2PlayerNewsLinks, useR2EnrichedNews } from '../hooks.js';

// Players currently on any roster
const ROSTERED_IDS = new Set(
  Object.values(TEAM_ROSTERS).flatMap(entries => entries.map(e => e.playerId).filter(Boolean))
);

const FANTASAI_SRC = { id: 'fantasai-notes', name: 'FantasAI', color: '#c6ff3a', kind: 'ai' };

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

function makeLiveItem(src, player, note, titleOverride, publishedAt) {
  return {
    id:          `${src.id}-${player.id}-${Date.now()}`,
    playerId:    player.id,
    type:        guessType(note),
    impact:      guessImpact(note),
    mins:        0,
    fetchedAt:   Date.now(),
    publishedAt: publishedAt ? new Date(publishedAt).getTime() || null : null,
    source:      src.name,
    sourceId:    src.id,
    color:       src.color,
    title:       titleOverride || extractTitle(note),
    body:        note,
  };
}

function fmtNewsDate(ts) {
  if (!ts) return null;
  const d = new Date(ts);
  if (isNaN(d.getTime())) return null;
  const now = new Date();
  const time = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  if (d.toDateString() === now.toDateString()) return `Today ${time}`;
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) return `Yesterday ${time}`;
  return `${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} ${time}`;
}

function srcColor(item) {
  return item.color || SOURCE_META[item.source]?.color || 'var(--text-faint)';
}

// Last names that belong to exactly one player (min 5 chars to avoid short common words).
// Used as a fallback when an ESPN article doesn't include a player's first name.
const UNIQUE_LAST_NAMES = (() => {
  const byLast = {};
  for (const p of getPlayers()) {
    const last = p.name.split(' ').slice(1).join(' ');
    if (last.length < 5) continue;
    if (!byLast[last]) byLast[last] = [];
    byLast[last].push(p);
  }
  const result = {};
  for (const [last, players] of Object.entries(byLast)) {
    if (players.length === 1) result[last] = players[0];
  }
  return result;
})();

// ── Component ─────────────────────────────────────────────────────────────────

export default function NewsScreen({ onOpenPlayer, sourcesState, user }) {
  const [mainTab,  setMainTab]  = React.useState('news'); // 'news' | 'addrop' | 'trades' | 'waivers' | 'notstarted'
  const [filter,   setFilter]   = React.useState('all');
  const [impact,   setImpact]   = React.useState('all');
  const [pos,      setPos]      = React.useState('ALL');
  const [search,   setSearch]   = React.useState('');
  const [faFilter, setFaFilter] = React.useState('all'); // 'all' | 'fa' | 'sleeper'

  const { data: r2PlayerNotes, fetchedAt: r2NotesFetchedAt } = useR2PlayerNotes();
  const { data: r2AiSummaries } = useR2AiSummaries();
  const { data: r2PlayerNewsLinks } = useR2PlayerNewsLinks(); // legacy — may be empty
  const { data: r2EnrichedRaw }     = useR2EnrichedNews();   // enriched_news.json — written by r2_export

  // Live fetch from Databricks gold tables via worker
  const [dbArticles,    setDbArticles]    = React.useState([]);
  const [dbArticlesSrc, setDbArticlesSrc] = React.useState(null);
  const [dbArticlesLoading, setDbArticlesLoading] = React.useState(true);

  React.useEffect(() => {
    let cancelled = false;
    setDbArticlesLoading(true);
    fetch(`${API_BASE}/api/v1/news/articles?limit=500`, { signal: AbortSignal.timeout(20000) })
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (cancelled || !data) return;
        const arr = Array.isArray(data.articles) ? data.articles : [];
        setDbArticles(arr);
        setDbArticlesSrc(data.source || null);
      })
      .catch(() => {})
      .finally(() => { if (!cancelled) setDbArticlesLoading(false); });
    return () => { cancelled = true; };
  }, []);

  // Parse legacy R2 player_news.json (may not exist)
  const r2Articles = React.useMemo(() => {
    if (Array.isArray(r2PlayerNewsLinks)) return r2PlayerNewsLinks;
    if (Array.isArray(r2PlayerNewsLinks?.data)) return r2PlayerNewsLinks.data;
    if (Array.isArray(r2PlayerNewsLinks?.articles)) return r2PlayerNewsLinks.articles;
    return [];
  }, [r2PlayerNewsLinks]);

  // Normalize enriched_news.json from R2 (written by r2_export from main.fantasai.silver_news).
  // Fields: headline, full_text, source_url, primary_player_id, published_at, mentioned_players
  const r2EnrichedArticles = React.useMemo(() => {
    const raw = Array.isArray(r2EnrichedRaw) ? r2EnrichedRaw
              : Array.isArray(r2EnrichedRaw?.data) ? r2EnrichedRaw.data : [];
    if (!raw.length) return [];
    const players = getPlayers();
    // Build sleeperId → player lookup once
    const bySleeperMap = new Map();
    players.forEach(p => { if (p.sleeperId) bySleeperMap.set(String(p.sleeperId), p); });
    return raw.map(a => {
      const headline    = a.headline || a.title || '';
      const article_url = a.source_url || a.article_url || a.url || '';
      const published_at= a.published_at || null;
      const description = a.full_text || a.description || a.summary || '';
      if (!headline || !article_url) return null;
      // Resolve player from primary_player_id (Sleeper ID)
      const pl = a.primary_player_id ? bySleeperMap.get(String(a.primary_player_id)) : null;
      return {
        headline,
        article_url,
        player_name: pl?.name || a.player_name || '',
        position:    (pl?.pos || a.position || '').toUpperCase(),
        team:        pl?.team || a.team || '',
        published_at,
        publisher:   a.publisher || a.source || 'FantasAI',
        description,
      };
    }).filter(Boolean);
  }, [r2EnrichedRaw]);

  // Merge all article sources: Databricks live (highest priority) > R2 enriched > R2 legacy
  // Deduplicate by article_url.
  const mergedArticles = React.useMemo(() => {
    const byUrl = new Map();
    // Lowest priority first
    for (const a of r2Articles)         { if (a.headline && a.article_url) byUrl.set(a.article_url, a); }
    for (const a of r2EnrichedArticles) { if (a.headline && a.article_url) byUrl.set(a.article_url, a); }
    // Databricks live wins on conflict
    for (const a of dbArticles)         { if (a.headline && a.article_url) byUrl.set(a.article_url, a); }
    return [...byUrl.values()].sort((a, b) => {
      const ta = a.published_at ? new Date(a.published_at).getTime() : 0;
      const tb = b.published_at ? new Date(b.published_at).getTime() : 0;
      return tb - ta;
    });
  }, [r2Articles, r2EnrichedArticles, dbArticles]);

  // All articles sorted newest-first for the Articles tab
  const allArticles = mergedArticles;

  // Map: normalized player_name → sorted article array (for inline article strips in FeedView)
  const playerNewsMap = React.useMemo(() => {
    const m = new Map();
    for (const a of mergedArticles) {
      const key = (a.player_name || '').toLowerCase().trim();
      if (!key || !a.article_url) continue;
      if (!m.has(key)) m.set(key, []);
      m.get(key).push(a);
    }
    m.forEach(arr => arr.sort((a, b) => (a.article_rank ?? 9) - (b.article_rank ?? 9)));
    return m;
  }, [mergedArticles]);

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

  // Convert R2 player_notes → liveItems when data arrives
  React.useEffect(() => {
    if (!r2PlayerNotes) return;
    const arr = Array.isArray(r2PlayerNotes) ? r2PlayerNotes : [];
    const items = [];
    for (const pn of arr) {
      if (!pn.notes?.length) continue;
      const note   = pn.notes[0];
      const player = matchPlayer(pn.player_name || '');
      if (!player) continue;
      const impact = pn.has_critical_news || note.priority === 'critical' ? 'high'
                   : note.priority === 'high'                              ? 'med'
                   : note.impact_direction === 'positive'                  ? 'good'
                   : 'low';
      items.push({
        id:          `fantasai-${player.id}`,
        playerId:    player.id,
        type:        pn.has_injury_concern ? 'injury' : 'analysis',
        impact,
        mins:        0,
        fetchedAt:   pn.last_updated ? new Date(pn.last_updated).getTime() : Date.now(),
        publishedAt: note.published_at ? new Date(note.published_at).getTime() : null,
        source:      'FantasAI',
        sourceId:    'fantasai-notes',
        color:       '#c6ff3a',
        title:       note.note_text ? note.note_text.slice(0, 120) : '',
        body:        pn.notes.slice(0, 3).map(n => n.note_text).filter(Boolean).join(' · '),
        impactScore: pn.overall_impact_score,
      });
    }
    setLiveItems(prev => ({ ...prev, 'fantasai-notes': items }));
  }, [r2PlayerNotes]); // eslint-disable-line react-hooks/exhaustive-deps

  // Convert R2 ai_summaries → liveItems when data arrives
  React.useEffect(() => {
    if (!r2AiSummaries) return;
    const arr = Array.isArray(r2AiSummaries) ? r2AiSummaries : [];
    const now = Date.now();
    const items = [];
    for (const s of arr) {
      // Skip expired or low-relevance summaries
      if (s.expires_at && new Date(s.expires_at).getTime() < now) continue;
      if ((s.fantasy_relevance_score ?? 1) < 0.5) continue;
      const impacted = Array.isArray(s.impacted_players) ? s.impacted_players : [];
      // Primary player = highest magnitude
      const primary = impacted.slice().sort((a, b) => (b.impact_magnitude ?? 0) - (a.impact_magnitude ?? 0))[0];
      if (!primary) continue;
      const player = matchPlayer(primary.player_name || '');
      if (!player) continue;
      const impact = s.priority_level === 'critical' ? 'high'
                   : s.priority_level === 'high'     ? 'med'
                   : primary.impact_direction === 'positive' ? 'good'
                   : 'low';
      const title = s.fantasy_insight ? s.fantasy_insight.slice(0, 120) : extractTitle(s.summary_text);
      const body  = s.summary_text || '';
      // Other players affected (ripple)
      const ripple = impacted
        .filter(p => p.player_name !== primary.player_name)
        .slice(0, 4)
        .map(p => ({ name: p.player_name, direction: p.impact_direction }));
      items.push({
        id:          `ai-sum-${s.summary_id || player.id}-${s.generated_at}`,
        playerId:    player.id,
        type:        s.impact_category === 'injury' ? 'injury' : 'analysis',
        impact,
        mins:        0,
        fetchedAt:   s.generated_at ? new Date(s.generated_at).getTime() : Date.now(),
        publishedAt: s.generated_at ? new Date(s.generated_at).getTime() : null,
        source:      'FantasAI AI',
        sourceId:    'fantasai-ai',
        color:       '#c6ff3a',
        title,
        body,
        ripple,
        confidence:  s.llm_confidence ?? null,
      });
    }
    setLiveItems(prev => ({ ...prev, 'fantasai-ai': items }));
  }, [r2AiSummaries]); // eslint-disable-line react-hooks/exhaustive-deps

  const activatedSources = React.useMemo(() => {
    // FantasAI first (R2/Databricks), then Sleeper, CBS, then user-toggled sources
    const result = [FANTASAI_SRC, SLEEPER_SRC, CBS_NEWS_SRC];
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

  // Auto-fetch every activated source on page load
  // eslint-disable-next-line react-hooks/exhaustive-deps
  React.useEffect(() => {
    activatedSources.forEach(src => handleRefreshSource(src));
  }, []);

  // Targets for per-player APIs: top-100 by ECR
  const newsTargets = React.useMemo(
    () => getPlayers().slice().sort((a, b) => (a.ecr || 999) - (b.ecr || 999)).slice(0, 100),
    [],
  );

  // Match a name string to a player store entry
  function matchPlayer(name = '') {
    const n = name.toLowerCase();
    return getPlayers().find(p => {
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
            newItems.push(makeLiveItem(src, match, body.slice(0, 800), cp.newsTitle || undefined, cp.newsDate || cp.updatedDate || null));
          }
        }
      }

      // ── ESPN NFL news feed ───────────────────────────────────────────────
      else if (src.id === 'espn-nfl') {
        // Fetch 3 pages in parallel; fall back gracefully if pagination isn't supported
        const pages = await Promise.allSettled([
          fetch(`${API_BASE}/api/v1/nfl/news?limit=50`,           { signal: AbortSignal.timeout(10000) }),
          fetch(`${API_BASE}/api/v1/nfl/news?limit=50&page=2`,    { signal: AbortSignal.timeout(10000) }),
          fetch(`${API_BASE}/api/v1/nfl/news?limit=50&page=3`,    { signal: AbortSignal.timeout(10000) }),
        ]);
        const seenHeadlines = new Set();
        const allArticles = [];
        for (const p of pages) {
          if (p.status !== 'fulfilled' || !p.value.ok) continue;
          try {
            const { articles = [] } = await p.value.json();
            for (const a of articles) {
              if (!a.headline || seenHeadlines.has(a.headline)) continue;
              seenHeadlines.add(a.headline);
              allArticles.push(a);
            }
          } catch {}
        }
        total = allArticles.length;
        for (const article of allArticles) {
          const text = `${article.headline} ${article.description || ''}`;
          const tl = text.toLowerCase();
          // 1. Full name: both first and last appear (case-insensitive)
          let match = getPlayers().find(p => {
            const parts = p.name.split(' ');
            const first = parts[0].toLowerCase();
            const last  = parts.slice(1).join(' ').toLowerCase();
            return last.length > 2 && tl.includes(first) && tl.includes(last);
          });
          // 2. Abbreviated name: "G. Kittle" or "G Kittle" style
          if (!match) {
            match = getPlayers().find(p => {
              const parts = p.name.split(' ');
              const initial = parts[0][0].toLowerCase();
              const last    = parts.slice(1).join(' ').toLowerCase();
              return last.length > 2 && (tl.includes(`${initial}. ${last}`) || tl.includes(`${initial} ${last}`));
            });
          }
          // 3. Unique last name fallback (≥5 chars, only one player in the pool has it)
          if (!match) {
            for (const [last, player] of Object.entries(UNIQUE_LAST_NAMES)) {
              if (tl.includes(last.toLowerCase())) { match = player; break; }
            }
          }
          if (!match) continue;
          const body = article.description || article.headline;
          newItems.push({ ...makeLiveItem(src, match, body, null, article.published || article.lastModified || null), title: article.headline });
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
          const _pl = getPlayers();
          total = _pl.length;
          for (const p of _pl) {
            const row = latest[p.name] ?? latest[Object.keys(latest).find(n => n.toLowerCase() === p.name.toLowerCase())];
            if (!row) continue;
            const status = row.report_status || row.practice_status || '';
            if (!status || ['', 'Active', 'Full Participation', 'DNE'].includes(status)) continue;
            const injury = row.report_primary_injury || row.practice_primary_injury || '';
            const note   = injury ? `${status} · ${injury}` : status;
            // nflverse has no per-row timestamp; approximate from season+week
            const season = parseInt(row.season) || null;
            const week   = parseInt(row.week) || null;
            let nflverseDate = null;
            if (season && week) {
              // NFL week 1 of season starts early Sep; approximate Mon of that week
              const sep1 = new Date(season, 8, 1);
              const dayOfWeek = sep1.getDay();
              const daysToMonday = dayOfWeek === 0 ? 1 : dayOfWeek === 1 ? 0 : 8 - dayOfWeek;
              const week1Monday = new Date(sep1);
              week1Monday.setDate(sep1.getDate() + daysToMonday);
              nflverseDate = week1Monday.getTime() + (week - 1) * 7 * 24 * 60 * 60 * 1000;
            }
            newItems.push(makeLiveItem(src, p, note, undefined, nflverseDate));
          }
        }
      }

      // ── Beat Writers (Twitter/X via Nitter RSS) ──────────────────────────
      else if (src.id === 'beat-writers') {
        const res = await fetch(`${API_BASE}/api/v1/twitter/beat`, { signal: AbortSignal.timeout(40000) });
        if (res.ok) {
          const { items: tweets = [], count = 0 } = await res.json();
          total = count;
          for (const tweet of tweets) {
            const text = tweet.text || '';
            if (!text) continue;
            const tl = text.toLowerCase();
            // Three-tier player matching (same as ESPN)
            let match = getPlayers().find(p => {
              const parts = p.name.split(' ');
              const first = parts[0].toLowerCase();
              const last  = parts.slice(1).join(' ').toLowerCase();
              return last.length > 2 && tl.includes(first) && tl.includes(last);
            });
            if (!match) {
              match = getPlayers().find(p => {
                const parts = p.name.split(' ');
                const initial = parts[0][0].toLowerCase();
                const last    = parts.slice(1).join(' ').toLowerCase();
                return last.length > 2 && (tl.includes(`${initial}. ${last}`) || tl.includes(`${initial} ${last}`));
              });
            }
            if (!match) {
              for (const [last, player] of Object.entries(UNIQUE_LAST_NAMES)) {
                if (tl.includes(last.toLowerCase())) { match = player; break; }
              }
            }
            if (!match) continue;
            // Prefix reporter handle so it's visible in the cell text
            const displayText = tweet.reporter ? `@${tweet.handle}: ${text}` : text;
            newItems.push(makeLiveItem(src, match, displayText.slice(0, 600), undefined, tweet.publishedAt));
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

  const addropCount   = allNews.filter(n => n.sources?.some(s => s.type === 'transaction')).length;
  const sleeperCount2 = allNews.filter(n => !ROSTERED_IDS.has(n.playerId) && (n.impact === 'good' || n.sources?.some(s => s.type === 'analysis' || s.impact === 'good'))).length;

  // Apply tab-level filter on top of existing filters
  let news = allNews;
  if (mainTab === 'addrop')  news = allNews.filter(n => n.sources?.some(s => s.type === 'transaction'));
  else if (mainTab === 'waivers') news = allNews.filter(n => !ROSTERED_IDS.has(n.playerId));

  if (filter !== 'all') news = news.filter(n => n.sources?.some(s => s.type === filter));
  if (pos === 'FLEX') {
    news = news.filter(n => ['RB', 'WR'].includes(findPlayer(n.playerId)?.pos));
  } else if (pos === 'DST') {
    const dstTeams = new Set(getPlayers().filter(p => p.pos === 'DST').map(p => p.team));
    news = news.filter(n => {
      const player = findPlayer(n.playerId);
      return player && (player.pos === 'DST' || dstTeams.has(player.team));
    });
  } else if (pos !== 'ALL') {
    news = news.filter(n => findPlayer(n.playerId)?.pos === pos);
  }
  if (search.trim()) news = news.filter(n => findPlayer(n.playerId)?.name.toLowerCase().includes(search.trim().toLowerCase()));

  if (faFilter === 'fa')      news = news.filter(n => !ROSTERED_IDS.has(n.playerId));
  else if (faFilter === 'sleeper') news = news.filter(n => !ROSTERED_IDS.has(n.playerId) && (n.impact === 'good' || n.sources?.some(s => s.type === 'analysis' || s.impact === 'good')));

  const faCount        = allNews.filter(n => !ROSTERED_IDS.has(n.playerId)).length;
  const uniqueSrcCount = new Set(news.flatMap(n => n.sources?.map(s => s.sourceId || s.source) || [])).size;

  const TABS = [
    { id: 'news',       label: 'Player News',  count: allNews.length },
    { id: 'addrop',     label: 'Add/Drop',     count: addropCount },
    { id: 'trades',     label: 'Trades',       count: 0 },
    { id: 'waivers',    label: 'Waivers',      count: faCount },
    { id: 'notstarted', label: 'Not Started',  count: null },
    { id: 'articles',   label: '📰 Articles',  count: allArticles.length || null },
  ];

  return (
    <div className="col" style={{ height: '100%' }}>

      {/* ── Header ── */}
      <div className="page-head" style={{ paddingBottom: 0, borderBottom: 'none' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flex: 1 }}>
          {user && <TeamLogoBadge team={user.teamId ? findTeam(user.teamId) : null} size={40} />}
          <div><h1>News &amp; Updates</h1></div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {r2PlayerNotes && (
            <span style={{ fontSize: 10, fontFamily: 'var(--font-mono)', fontWeight: 600, color: 'var(--accent)', opacity: 0.8 }}>
              ◆ AI
            </span>
          )}
          <button
            className="btn sm"
            style={{ fontSize: 11 }}
            disabled={fetchingSourceIds.size > 0}
            onClick={() => activatedSources.filter(s => s.kind !== 'ai').forEach(src => handleRefreshSource(src))}
          >
            {fetchingSourceIds.size > 0 ? `⟳ ${fetchingSourceIds.size}…` : '↻ Refresh'}
          </button>
        </div>
      </div>

      {/* ── Main tab row ── */}
      <div style={{ display: 'flex', borderBottom: '1px solid var(--border)', paddingLeft: 20, gap: 0, overflowX: 'auto', flexShrink: 0 }}>
        {TABS.map(t => (
          <button
            key={t.id}
            onClick={() => setMainTab(t.id)}
            style={{
              background: 'none', border: 'none', cursor: 'pointer', padding: '10px 18px',
              fontSize: 13, fontWeight: mainTab === t.id ? 700 : 500,
              color: mainTab === t.id ? 'var(--text)' : 'var(--text-faint)',
              borderBottom: `2px solid ${mainTab === t.id ? 'var(--accent)' : 'transparent'}`,
              marginBottom: -1, whiteSpace: 'nowrap',
              display: 'flex', alignItems: 'center', gap: 6,
            }}
          >
            {t.label}
            {t.count != null && t.count > 0 && (
              <span style={{
                fontSize: 10, fontFamily: 'var(--font-mono)', fontWeight: 700,
                background: mainTab === t.id ? 'var(--accent)' : 'var(--panel-3)',
                color: mainTab === t.id ? '#0a1300' : 'var(--text-faint)',
                borderRadius: 10, padding: '1px 6px',
              }}>
                {t.count}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* ── Filters row ── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 20px', borderBottom: '1px solid var(--border)', flexWrap: 'wrap', flexShrink: 0 }}>
        {/* Position pills */}
        <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
          <span style={{ fontSize: 11, color: 'var(--text-faint)', marginRight: 2 }}>Position</span>
          {['All', 'QB', 'RB', 'WR', 'TE', 'K', 'DST'].map(p => {
            const val = p === 'All' ? 'ALL' : p;
            return (
              <button key={p} onClick={() => setPos(val)} style={{
                background: pos === val ? 'var(--accent)' : 'var(--panel-3)',
                color: pos === val ? '#0a1300' : 'var(--text-dim)',
                border: 'none', borderRadius: 4, padding: '3px 9px', fontSize: 11,
                fontWeight: pos === val ? 700 : 500, cursor: 'pointer',
              }}>{p}</button>
            );
          })}
        </div>

        <div style={{ width: 1, height: 18, background: 'var(--border)', flexShrink: 0 }} />

        {/* FA / Sleeper toggles */}
        <button onClick={() => setFaFilter(f => f === 'fa' ? 'all' : 'fa')} style={{
          background: faFilter === 'fa' ? 'rgba(78,168,255,.18)' : 'var(--panel-3)',
          color: faFilter === 'fa' ? '#4ea8ff' : 'var(--text-faint)',
          border: `1px solid ${faFilter === 'fa' ? '#4ea8ff44' : 'transparent'}`,
          borderRadius: 4, padding: '3px 10px', fontSize: 11, cursor: 'pointer',
        }}>Free Agent{faCount > 0 ? ` (${faCount})` : ''}</button>

        <button onClick={() => setFaFilter(f => f === 'sleeper' ? 'all' : 'sleeper')} style={{
          background: faFilter === 'sleeper' ? 'rgba(198,255,58,.12)' : 'var(--panel-3)',
          color: faFilter === 'sleeper' ? 'var(--accent)' : 'var(--text-faint)',
          border: `1px solid ${faFilter === 'sleeper' ? 'rgba(198,255,58,.3)' : 'transparent'}`,
          borderRadius: 4, padding: '3px 10px', fontSize: 11, cursor: 'pointer',
        }}>⚡ Sleeper{sleeperCount2 > 0 ? ` (${sleeperCount2})` : ''}</button>

        <div style={{ flex: 1 }} />

        {/* Search */}
        <input
          className="input search"
          placeholder="Search players…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          style={{ width: 200, fontSize: 12 }}
        />

        {(pos !== 'ALL' || search || faFilter !== 'all') && (
          <button className="btn sm ghost" onClick={() => { setPos('ALL'); setSearch(''); setFaFilter('all'); }} style={{ fontSize: 11 }}>✕</button>
        )}
        <span style={{ fontSize: 11, color: 'var(--text-faint)', fontFamily: 'var(--font-mono)', whiteSpace: 'nowrap' }}>
          {news.length} story{news.length !== 1 ? 's' : ''}
        </span>
      </div>

      {/* ── Feed ── */}
      <div style={{ flex: 1, overflow: 'auto' }}>
        {mainTab === 'articles' ? (
          <ArticlesFeedTab articles={allArticles} rosteredIds={ROSTERED_IDS} loading={dbArticlesLoading} dbSource={dbArticlesSrc} />
        ) : mainTab === 'trades' ? (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '50%', gap: 8, color: 'var(--text-faint)' }}>
            <div style={{ fontSize: 28 }}>🔄</div>
            <div style={{ fontSize: 13, color: 'var(--text-dim)' }}>Trade news coming soon</div>
          </div>
        ) : mainTab === 'notstarted' ? (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '50%', gap: 8, color: 'var(--text-faint)' }}>
            <div style={{ fontSize: 28 }}>🏈</div>
            <div style={{ fontSize: 13, color: 'var(--text-dim)' }}>Lineup decisions on Lineup Decisions page</div>
          </div>
        ) : news.length === 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '50%', gap: 10, color: 'var(--text-faint)' }}>
            <div style={{ fontSize: 28 }}>📰</div>
            <div style={{ fontSize: 13, color: 'var(--text-dim)' }}>No stories yet — click ↻ Refresh above</div>
          </div>
        ) : (
          <FeedView news={news} onOpenPlayer={onOpenPlayer} rosteredIds={ROSTERED_IDS} playerNewsMap={playerNewsMap} />
        )}
      </div>
    </div>
  );
}

/* ── Articles tab — Databricks gold tables + R2 fallback ────────────────── */
function ArticlesFeedTab({ articles, rosteredIds, loading, dbSource }) {
  const [posFilter,    setPosFilter]    = React.useState('ALL');
  const [search,       setSearch]       = React.useState('');
  const [rosterOnly,   setRosterOnly]   = React.useState(false);

  const filtered = React.useMemo(() => {
    let list = articles;
    if (rosterOnly) {
      const players = getPlayers();
      list = list.filter(a => {
        const p = players.find(pl => pl.name.toLowerCase() === (a.player_name || '').toLowerCase().trim());
        return p && rosteredIds.has(p.id);
      });
    }
    if (posFilter !== 'ALL') list = list.filter(a => (a.position || '').toUpperCase() === posFilter);
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(a =>
        (a.player_name || '').toLowerCase().includes(q) ||
        (a.headline    || '').toLowerCase().includes(q) ||
        (a.publisher   || '').toLowerCase().includes(q)
      );
    }
    return list;
  }, [articles, posFilter, search, rosterOnly, rosteredIds]);

  if (loading && !articles.length) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '50%', gap: 10, color: 'var(--text-faint)' }}>
        <div className="ai-orb" style={{ width: 18, height: 18 }} />
        <div style={{ fontSize: 13, color: 'var(--text-dim)' }}>Loading articles from Databricks…</div>
      </div>
    );
  }

  if (!articles.length) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '50%', gap: 10, color: 'var(--text-faint)' }}>
        <div style={{ fontSize: 28 }}>📰</div>
        <div style={{ fontSize: 13, color: 'var(--text-dim)' }}>No articles yet — Databricks pipeline hasn't run</div>
      </div>
    );
  }

  const srcLabel = dbSource === 'enriched_news' ? 'Databricks · enriched_news' : dbSource === 'raw_rss_articles' ? 'Databricks · raw_rss_articles' : dbSource === 'api_news_feed' ? 'Databricks · api_news_feed' : 'R2 cache';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Filter bar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 20px', borderBottom: '1px solid var(--border)', flexWrap: 'wrap', flexShrink: 0 }}>
        {/* Roster toggle */}
        <div style={{ display: 'flex', gap: 2, background: 'var(--panel-3)', borderRadius: 6, padding: 2 }}>
          {[['All NFL', false], ['My Roster', true]].map(([label, val]) => (
            <button key={label} onClick={() => setRosterOnly(val)} style={{
              background: rosterOnly === val ? 'var(--accent)' : 'transparent',
              color: rosterOnly === val ? '#0a1300' : 'var(--text-dim)',
              border: 'none', borderRadius: 4, padding: '3px 10px', fontSize: 11,
              fontWeight: rosterOnly === val ? 700 : 500, cursor: 'pointer', whiteSpace: 'nowrap',
            }}>{label}</button>
          ))}
        </div>
        <div style={{ width: 1, height: 16, background: 'var(--border)', flexShrink: 0 }} />
        {/* Position pills */}
        {['ALL', 'QB', 'RB', 'WR', 'TE', 'K'].map(p => (
          <button key={p} onClick={() => setPosFilter(p)} style={{
            background: posFilter === p ? 'var(--accent)' : 'var(--panel-3)',
            color: posFilter === p ? '#0a1300' : 'var(--text-dim)',
            border: 'none', borderRadius: 4, padding: '3px 8px', fontSize: 11,
            fontWeight: posFilter === p ? 700 : 400, cursor: 'pointer',
          }}>{p}</button>
        ))}
        <div style={{ width: 1, height: 16, background: 'var(--border)', flexShrink: 0 }} />
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search player or headline…"
          style={{ fontSize: 11, background: 'var(--panel-2)', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: 4, padding: '4px 8px', width: 180 }}
        />
        <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--text-faint)', fontFamily: 'var(--font-mono)', whiteSpace: 'nowrap', display: 'flex', alignItems: 'center', gap: 8 }}>
          {loading && <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: '#c6ff3a', animation: 'pulse 1.2s ease-in-out infinite' }} />}
          {filtered.length} of {articles.length}
          {dbSource && <span style={{ fontSize: 9, color: '#4ea8ff', fontWeight: 700, letterSpacing: '.04em', textTransform: 'uppercase' }}>{srcLabel}</span>}
        </span>
      </div>

      {/* Articles list */}
      <div style={{ flex: 1, overflow: 'auto' }}>
        {filtered.length === 0 ? (
          <div style={{ padding: '40px 24px', textAlign: 'center', color: 'var(--text-faint)', fontSize: 13 }}>No articles match the current filter.</div>
        ) : (
          <div style={{ maxWidth: 820, margin: '0 auto', padding: '0 0 40px' }}>
            {filtered.map((a, i) => {
              const ago = fmtRelative(a.published_at);
              return (
                <div key={i} style={{ display: 'flex', gap: 14, padding: '14px 20px', borderBottom: '1px solid var(--border)', alignItems: 'flex-start' }}>
                  {/* Position badge */}
                  <div style={{ flexShrink: 0, marginTop: 2 }}>
                    {a.position ? (
                      <PosBadge pos={a.position} />
                    ) : (
                      <span style={{ fontSize: 10, color: 'var(--text-faint)', fontFamily: 'var(--font-mono)' }}>—</span>
                    )}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    {/* Player row */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 5, flexWrap: 'wrap' }}>
                      <span style={{ fontWeight: 700, fontSize: 13, color: 'var(--text)' }}>{a.player_name}</span>
                      {a.team && <span style={{ fontSize: 10, color: 'var(--text-faint)', fontFamily: 'var(--font-mono)' }}>{a.team}</span>}
                    </div>
                    {/* Headline */}
                    <a
                      href={a.article_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{ display: 'block', fontSize: 14, fontWeight: 600, color: 'var(--text)', textDecoration: 'none', lineHeight: 1.5, marginBottom: 6 }}
                      onMouseEnter={e => e.currentTarget.style.color = '#4ea8ff'}
                      onMouseLeave={e => e.currentTarget.style.color = 'var(--text)'}
                    >
                      {a.headline}
                    </a>
                    {/* Attribution + link */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                      <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-dim)' }}>{a.publisher}</span>
                      {ago && (
                        <>
                          <span style={{ fontSize: 11, color: 'var(--text-faint)' }}>·</span>
                          <span style={{ fontSize: 11, color: 'var(--text-faint)' }}>{ago}</span>
                        </>
                      )}
                      <a
                        href={a.article_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{ marginLeft: 4, fontSize: 11, fontWeight: 700, color: '#4ea8ff', textDecoration: 'none', padding: '2px 8px', background: 'rgba(78,168,255,.1)', border: '1px solid rgba(78,168,255,.25)', borderRadius: 4 }}
                        onMouseEnter={e => e.currentTarget.style.background = 'rgba(78,168,255,.22)'}
                        onMouseLeave={e => e.currentTarget.style.background = 'rgba(78,168,255,.1)'}
                      >
                        Read Article →
                      </a>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

/* ── Relative-time helper for Google News timestamps ────────────────────────── */
function fmtRelative(ts) {
  if (!ts) return null;
  const d = new Date(ts);
  if (isNaN(d.getTime())) return null;
  const diff = Date.now() - d.getTime();
  const mins = Math.round(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return days === 1 ? 'yesterday' : `${days}d ago`;
}

/* ── Google News article links strip ────────────────────────────────────────── */
function ArticleLinks({ articles }) {
  const [expanded, setExpanded] = React.useState(false);
  if (!articles?.length) return null;
  const shown = expanded ? articles : articles.slice(0, 2);
  return (
    <div
      style={{ marginTop: 12, padding: '10px 12px', background: 'rgba(78,168,255,.06)', border: '1px solid rgba(78,168,255,.15)', borderRadius: 6 }}
      onClick={e => e.stopPropagation()}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
        <span style={{ fontSize: 9, fontWeight: 800, color: '#4ea8ff', fontFamily: 'var(--font-mono)', letterSpacing: '.08em', textTransform: 'uppercase' }}>📰 Headlines</span>
        <span style={{ fontSize: 9, color: 'var(--text-faint)', fontFamily: 'var(--font-mono)' }}>{articles.length} articles</span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {shown.map((a, i) => {
          const ago = fmtRelative(a.published_at);
          return (
            <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <a
                  href={a.article_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)', textDecoration: 'none', lineHeight: 1.4, display: 'block' }}
                  onMouseEnter={e => e.currentTarget.style.color = '#4ea8ff'}
                  onMouseLeave={e => e.currentTarget.style.color = 'var(--text)'}
                >
                  {a.headline}
                </a>
                <div style={{ fontSize: 10, color: 'var(--text-faint)', marginTop: 2, display: 'flex', alignItems: 'center', gap: 5 }}>
                  <span style={{ fontWeight: 600, color: 'var(--text-dim)' }}>{a.publisher}</span>
                  {ago && <><span>·</span><span>{ago}</span></>}
                </div>
              </div>
              <a
                href={a.article_url}
                target="_blank"
                rel="noopener noreferrer"
                style={{ flexShrink: 0, fontSize: 10, fontWeight: 700, color: '#4ea8ff', background: 'rgba(78,168,255,.12)', border: '1px solid rgba(78,168,255,.25)', borderRadius: 4, padding: '3px 8px', textDecoration: 'none', whiteSpace: 'nowrap' }}
                onMouseEnter={e => { e.currentTarget.style.background = 'rgba(78,168,255,.22)'; }}
                onMouseLeave={e => { e.currentTarget.style.background = 'rgba(78,168,255,.12)'; }}
              >
                Read →
              </a>
            </div>
          );
        })}
      </div>
      {articles.length > 2 && (
        <button
          onClick={() => setExpanded(x => !x)}
          style={{ marginTop: 8, background: 'none', border: 'none', cursor: 'pointer', fontSize: 10, color: '#4ea8ff', padding: 0, fontWeight: 600 }}
        >
          {expanded ? '▲ Show less' : `▼ +${articles.length - 2} more articles`}
        </button>
      )}
    </div>
  );
}

/* ── Feed — full RotoWire-style article cards ───────────────────────────────── */
function FeedView({ news, onOpenPlayer, rosteredIds, playerNewsMap }) {
  const IMPACT_COLOR = { high: 'var(--danger)', med: 'var(--warn)', good: 'var(--good)', low: 'var(--text-faint)' };
  return (
    <div style={{ maxWidth: 820, margin: '0 auto', padding: '0 0 40px' }}>
      {news.map(n => {
        const player = findPlayer(n.playerId);
        if (!player) return null;

        const sources   = n.sources || [n];
        const best      = sources.find(s => s.sourceId === 'fantasai-notes') || sources.find(s => s.sourceId === 'fantasai-ai') || sources[0];
        const title     = best?.title || n.title || '';
        const body      = best?.body  || n.body  || '';
        const srcLabel  = best?.source || best?.sourceId || '';
        const dateStr   = fmtNewsDate(best?.publishedAt || best?.fetchedAt);
        const isFA      = !rosteredIds?.has(n.playerId);
        const impColor  = IMPACT_COLOR[n.impact] || 'var(--text-faint)';
        const articles  = playerNewsMap?.get(player.name.toLowerCase().trim()) || [];

        return (
          <article
            key={n.playerId}
            onClick={() => onOpenPlayer(player.id)}
            style={{
              padding: '20px 24px',
              borderBottom: '1px solid var(--border)',
              cursor: 'pointer',
              transition: 'background .12s',
            }}
            onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,.03)'}
            onMouseLeave={e => e.currentTarget.style.background = ''}
          >
            {/* Player identity row */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
              <PlayerAvatar player={player} size="sm" style={{ flexShrink: 0 }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <span style={{ fontWeight: 800, fontSize: 14, letterSpacing: '.01em' }}>{player.name}</span>
                  <PosBadge pos={player.pos} />
                  <span style={{ fontSize: 12, color: 'var(--text-faint)', fontWeight: 600 }}>• {player.team}</span>
                  {n.impact !== 'low' && (
                    <span style={{
                      fontSize: 9, fontFamily: 'var(--font-mono)', fontWeight: 800,
                      color: impColor, background: `${impColor}18`,
                      border: `1px solid ${impColor}40`,
                      borderRadius: 3, padding: '1px 6px', textTransform: 'uppercase', letterSpacing: '.06em',
                    }}>
                      {n.impact === 'good' ? 'BOOST' : n.impact}
                    </span>
                  )}
                  {articles.length > 0 && (
                    <span style={{ fontSize: 9, fontFamily: 'var(--font-mono)', fontWeight: 700, color: '#4ea8ff', background: 'rgba(78,168,255,.12)', border: '1px solid rgba(78,168,255,.2)', borderRadius: 3, padding: '1px 5px' }}>
                      📰 {articles.length}
                    </span>
                  )}
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-faint)', marginTop: 2 }}>
                  {isFA ? 'Free Agent' : 'Rostered'}
                </div>
              </div>
            </div>

            {/* Headline */}
            {title && (
              <div style={{ fontSize: 14, fontWeight: 700, lineHeight: 1.45, marginBottom: 6, color: 'var(--text)' }}>
                {title}
              </div>
            )}

            {/* Source + date attribution */}
            <div style={{ fontSize: 11, color: 'var(--text-faint)', marginBottom: body && body !== title ? 10 : 0, display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
              {srcLabel && (
                <>
                  <span style={{ color: 'var(--text-dim)' }}>by</span>
                  <span style={{ color: srcColor(best), fontWeight: 600 }}>{srcLabel}</span>
                  <span>·</span>
                </>
              )}
              {dateStr && <span>{dateStr}</span>}
            </div>

            {/* Full article body */}
            {body && body !== title && (
              <div style={{ fontSize: 13, color: 'var(--text-dim)', lineHeight: 1.65, marginBottom: 8 }}>
                {body}
              </div>
            )}

            {/* Ripple row */}
            {best?.ripple?.length > 0 && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginTop: 8, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 10, color: 'var(--text-faint)' }}>Also affects:</span>
                {best.ripple.map((r, i) => (
                  <span key={i} style={{
                    fontSize: 10, fontFamily: 'var(--font-mono)', fontWeight: 600,
                    color: r.direction === 'positive' ? 'var(--good)' : r.direction === 'negative' ? 'var(--danger)' : 'var(--text-faint)',
                  }}>
                    {r.direction === 'positive' ? '▲' : r.direction === 'negative' ? '▼' : '◆'} {r.name}
                  </span>
                ))}
              </div>
            )}

            {/* Google News article links */}
            <ArticleLinks articles={articles} />
          </article>
        );
      })}
    </div>
  );
}

