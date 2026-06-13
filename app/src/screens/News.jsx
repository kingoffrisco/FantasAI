import React from 'react';
import { NEWS, FREE_DATA_SOURCES, LIMITED_FREE_SOURCES, SOURCE_META, TEAM_ROSTERS, LEAGUE_TEAMS, findTeam } from '../lib/data.js';
import { getPlayers, findPlayer, findPlayerByName } from '../lib/playerStore.js';
import { PosBadge, PlayerAvatar, TeamLogoBadge } from '../components/ui.jsx';
import { fetchSleeperPlayerStats } from '../lib/sleeper.js';
import { useR2PlayerNotes, useR2AiSummaries, useR2PlayerNewsLinks, useR2EnrichedNews } from '../hooks.js';

// Full NFL team list with name + city (data.js NFL_TEAMS only has abbr+color)
const NFL_TEAMS_FULL = [
  { abbr: 'ARI', name: 'Cardinals',    city: 'Arizona' },
  { abbr: 'ATL', name: 'Falcons',      city: 'Atlanta' },
  { abbr: 'BAL', name: 'Ravens',       city: 'Baltimore' },
  { abbr: 'BUF', name: 'Bills',        city: 'Buffalo' },
  { abbr: 'CAR', name: 'Panthers',     city: 'Carolina' },
  { abbr: 'CHI', name: 'Bears',        city: 'Chicago' },
  { abbr: 'CIN', name: 'Bengals',      city: 'Cincinnati' },
  { abbr: 'CLE', name: 'Browns',       city: 'Cleveland' },
  { abbr: 'DAL', name: 'Cowboys',      city: 'Dallas' },
  { abbr: 'DEN', name: 'Broncos',      city: 'Denver' },
  { abbr: 'DET', name: 'Lions',        city: 'Detroit' },
  { abbr: 'GB',  name: 'Packers',      city: 'Green Bay' },
  { abbr: 'HOU', name: 'Texans',       city: 'Houston' },
  { abbr: 'IND', name: 'Colts',        city: 'Indianapolis' },
  { abbr: 'JAX', name: 'Jaguars',      city: 'Jacksonville' },
  { abbr: 'KC',  name: 'Chiefs',       city: 'Kansas City' },
  { abbr: 'LAC', name: 'Chargers',     city: 'Los Angeles' },
  { abbr: 'LAR', name: 'Rams',         city: 'Los Angeles' },
  { abbr: 'LV',  name: 'Raiders',      city: 'Las Vegas' },
  { abbr: 'MIA', name: 'Dolphins',     city: 'Miami' },
  { abbr: 'MIN', name: 'Vikings',      city: 'Minnesota' },
  { abbr: 'NE',  name: 'Patriots',     city: 'New England' },
  { abbr: 'NO',  name: 'Saints',       city: 'New Orleans' },
  { abbr: 'NYG', name: 'Giants',       city: 'New York' },
  { abbr: 'NYJ', name: 'Jets',         city: 'New York' },
  { abbr: 'PHI', name: 'Eagles',       city: 'Philadelphia' },
  { abbr: 'PIT', name: 'Steelers',     city: 'Pittsburgh' },
  { abbr: 'SEA', name: 'Seahawks',     city: 'Seattle' },
  { abbr: 'SF',  name: '49ers',        city: 'San Francisco' },
  { abbr: 'TB',  name: 'Buccaneers',   city: 'Tampa Bay' },
  { abbr: 'TEN', name: 'Titans',       city: 'Tennessee' },
  { abbr: 'WAS', name: 'Commanders',   city: 'Washington' },
];

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
  const [mainTab,     setMainTab]     = React.useState('news');
  const [filter,      setFilter]      = React.useState('all');
  const [impact,      setImpact]      = React.useState('all');
  const [pos,         setPos]         = React.useState('ALL');
  const [search,      setSearch]      = React.useState('');
  const [teamFilter,  setTeamFilter]  = React.useState('ALL');
  const [fantasyTeam, setFantasyTeam] = React.useState('ALL');

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

  // Normalize R2 player_news.json — unified pipeline output (primary source).
  // Handles multiple field name conventions: source_url/article_url/url, headline/title, etc.
  const r2Articles = React.useMemo(() => {
    const raw = Array.isArray(r2PlayerNewsLinks) ? r2PlayerNewsLinks
              : Array.isArray(r2PlayerNewsLinks?.data) ? r2PlayerNewsLinks.data
              : Array.isArray(r2PlayerNewsLinks?.articles) ? r2PlayerNewsLinks.articles : [];
    return raw.map(a => {
      const headline    = a.headline || a.title || a.article_title || '';
      const article_url = a.article_url || a.source_url || a.url || a.link || '';
      if (!headline) return null;
      return {
        ...a,
        headline,
        article_url,
        player_name:     a.player_name || a.primary_player_name || a.mentioned_player || '',
        position:        (a.position || a.player_position || a.pos || '').toUpperCase(),
        team:            a.team || a.player_team || '',
        published_at:    a.published_at || a.published_date || a.created_at || null,
        publisher:       a.publisher || a.source || a.feed_source || 'FantasAI',
        description:     a.description || a.full_text || a.summary || a.summary_text || '',
      };
    }).filter(Boolean);
  }, [r2PlayerNewsLinks]);

  // Normalize enriched_news.json from R2 (sourced from main.fantasai.gold_enriched_news via export pipeline).
  // Fields: headline, full_text, source_url, primary_player_id, published_at, mentioned_players
  const r2EnrichedArticles = React.useMemo(() => {
    const raw = Array.isArray(r2EnrichedRaw) ? r2EnrichedRaw
              : Array.isArray(r2EnrichedRaw?.data) ? r2EnrichedRaw.data : [];
    if (!raw.length) return [];
    const players = getPlayers();
    const bySleeperMap = new Map();
    players.forEach(p => { if (p.sleeperId) bySleeperMap.set(String(p.sleeperId), p); });
    return raw.map(a => {
      const headline    = a.headline || a.title || '';
      const article_url = a.source_url || a.article_url || a.url || '';
      const published_at= a.published_at || null;
      const description = a.full_text || a.description || a.summary || '';
      if (!headline) return null;
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

  // Merge all article sources. Priority (highest wins on key conflict):
  //   player_news.json (unified pipeline) > Databricks live API > R2 enriched
  // Key = article_url when present, else headline (handles notes without a URL).
  const mergedArticles = React.useMemo(() => {
    const byKey = new Map();
    const artKey = a => a.article_url || a.headline;
    for (const a of r2EnrichedArticles) { const k = artKey(a); if (k && a.headline) byKey.set(k, a); }
    for (const a of dbArticles)         { const k = artKey(a); if (k && a.headline) byKey.set(k, a); }
    // Unified pipeline output wins — preserves ai_generated_at, enriched_at, fantasy_insight
    for (const a of r2Articles)         { const k = artKey(a); if (k && a.headline) byKey.set(k, a); }
    return [...byKey.values()].sort((a, b) => {
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
      if (!key) continue;
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
                   : (pn.sentiment || note.impact_direction) === 'positive' ? 'good'
                   : 'low';
      items.push({
        id:              `fantasai-${player.id}`,
        playerId:        player.id,
        type:            pn.has_injury_concern ? 'injury' : 'analysis',
        impact,
        mins:            0,
        fetchedAt:       pn.last_updated ? new Date(pn.last_updated).getTime() : Date.now(),
        publishedAt:     note.published_at ? new Date(note.published_at).getTime() : null,
        source:          'FantasAI',
        sourceId:        'fantasai-notes',
        color:           '#c6ff3a',
        title:           note.note_text ? note.note_text.slice(0, 120) : '',
        body:            pn.notes.slice(0, 3).map(n => n.note_text).filter(Boolean).join(' · '),
        impactScore:     pn.overall_impact_score,
        sentiment:       pn.sentiment || null,
        waiverRelevance: pn.waiver_relevance || null,
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
      // Skip expired summaries; relevance threshold handles both 0-1 (old) and 0-10 (Qwen) scales
      if (s.expires_at && new Date(s.expires_at).getTime() < now) continue;
      const rel = s.fantasy_relevance_score ?? 1;
      if (rel < (rel > 1 ? 3 : 0.3)) continue; // <3/10 for Qwen, <0.3/1.0 for old format
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
        const cbsCookie = (() => { try { return localStorage.getItem('fantasai_cbs_cookie') || ''; } catch { return ''; } })();
        const res = await fetch(`${API_BASE}/api/v1/cbs/players`, {
          headers: cbsCookie ? { 'X-CBS-Cookie': cbsCookie } : {},
          signal: AbortSignal.timeout(20000),
        });
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

  // Map of teamId → Set<playerId> for fantasy team filtering (must precede news filter)
  const rosterByTeam = React.useMemo(() => {
    const result = {};
    for (const [tid, entries] of Object.entries(TEAM_ROSTERS)) {
      result[tid] = new Set(entries.map(e => e.playerId).filter(Boolean));
    }
    return result;
  }, []);

  // Set of lowercase player names for the selected fantasy team (used by article tabs)
  const fantasyRosterNames = React.useMemo(() => {
    if (fantasyTeam === 'ALL') return null;
    const ids = rosterByTeam[fantasyTeam] || new Set();
    const names = new Set();
    for (const p of getPlayers()) {
      if (ids.has(p.id)) names.add(p.name.toLowerCase().trim());
    }
    return names;
  }, [fantasyTeam, rosterByTeam]);

  let news = allNews;

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
  if (fantasyTeam !== 'ALL') {
    const rIds = rosterByTeam[fantasyTeam] || new Set();
    news = news.filter(n => rIds.has(n.playerId));
  }
  if (search.trim()) {
    const q = search.trim().toLowerCase();
    news = news.filter(n => {
      const player = findPlayer(n.playerId);
      return player?.name.toLowerCase().includes(q) ||
             (n.title || '').toLowerCase().includes(q) ||
             (n.body  || '').toLowerCase().includes(q);
    });
  }

  const uniqueSrcCount = new Set(news.flatMap(n => n.sources?.map(s => s.sourceId || s.source) || [])).size;

  const r2AiSummariesArr  = React.useMemo(() => Array.isArray(r2AiSummaries) ? r2AiSummaries : (Array.isArray(r2AiSummaries?.data) ? r2AiSummaries.data : []), [r2AiSummaries]);
  const r2EnrichedArr     = React.useMemo(() => Array.isArray(r2EnrichedRaw)  ? r2EnrichedRaw  : (Array.isArray(r2EnrichedRaw?.data)  ? r2EnrichedRaw.data  : []), [r2EnrichedRaw]);
  const r2PlayerNotesArr  = React.useMemo(() => Array.isArray(r2PlayerNotes)  ? r2PlayerNotes  : (Array.isArray(r2PlayerNotes?.data)  ? r2PlayerNotes.data  : []), [r2PlayerNotes]);

  // My own roster IDs for the three-column Articles view
  const myRosterIds = React.useMemo(() => {
    if (!user?.teamId) return new Set();
    const entries = TEAM_ROSTERS[user.teamId] || [];
    return new Set(entries.map(e => e.playerId).filter(Boolean));
  }, [user]);

  const TABS = [
    { id: 'news',     label: 'Player News',              count: allNews.length },
    { id: 'articles', label: '🤖 Articles & AI Summaries', count: allArticles.length || null },
    { id: 'labels',   label: '🏷️ Labels',                count: null },
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

        {/* NFL team filter */}
        <select value={teamFilter} onChange={e => setTeamFilter(e.target.value)} style={{
          fontSize: 11, background: 'var(--panel-2)', color: 'var(--text)',
          border: `1px solid ${teamFilter !== 'ALL' ? 'var(--accent)' : 'var(--border)'}`,
          borderRadius: 4, padding: '3px 7px', cursor: 'pointer',
        }}>
          <option value="ALL">All NFL Teams</option>
          {NFL_TEAMS_FULL.map(t => <option key={t.abbr} value={t.abbr}>{t.abbr} — {t.city} {t.name}</option>)}
        </select>

        <div style={{ width: 1, height: 18, background: 'var(--border)', flexShrink: 0 }} />

        {/* Fantasy team filter */}
        <select value={fantasyTeam} onChange={e => setFantasyTeam(e.target.value)} style={{
          fontSize: 11, background: 'var(--panel-2)', color: 'var(--text)',
          border: `1px solid ${fantasyTeam !== 'ALL' ? 'var(--accent)' : 'var(--border)'}`,
          borderRadius: 4, padding: '3px 7px', cursor: 'pointer',
        }}>
          <option value="ALL">All Fantasy Teams</option>
          {LEAGUE_TEAMS.map(t => (
            <option key={t.id} value={t.id}>{t.name}{t.me ? ' (Me)' : ''}</option>
          ))}
        </select>

        <div style={{ flex: 1 }} />

        {/* Search */}
        <input
          className="input search"
          placeholder="Search player or headline…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          style={{ width: 220, fontSize: 12 }}
        />

        {(pos !== 'ALL' || search || teamFilter !== 'ALL' || fantasyTeam !== 'ALL') && (
          <button className="btn sm ghost" onClick={() => { setPos('ALL'); setSearch(''); setTeamFilter('ALL'); setFantasyTeam('ALL'); }} style={{ fontSize: 11 }}>✕</button>
        )}
        {mainTab === 'news' && (
          <span style={{ fontSize: 11, color: 'var(--text-faint)', fontFamily: 'var(--font-mono)', whiteSpace: 'nowrap' }}>
            {news.length} story{news.length !== 1 ? 's' : ''}
          </span>
        )}
      </div>

      {/* ── Feed ── */}
      <div style={{ flex: 1, overflow: 'auto' }}>
        {mainTab === 'articles' ? (
          <ArticlesFeedTab articles={allArticles} loading={dbArticlesLoading} dbSource={dbArticlesSrc} user={user} posFilter={pos} search={search} teamFilter={teamFilter} fantasyRosterNames={fantasyRosterNames} />
        ) : mainTab === 'labels' ? (
          <ArticleLabelerTab articles={allArticles} user={user} search={search} />
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

/* ── Shared article card ─────────────────────────────────────────────────────── */
function ArticleCard({ a, onSelect, selected, score }) {
  const ago = fmtRelative(a.published_at);
  const topLabel = score?.top_labels?.[0];
  const topMeta  = topLabel ? FEEDBACK_LABELS.find(x => x.id === topLabel) : null;
  return (
    <div
      onClick={() => onSelect(a)}
      style={{
        display: 'flex', gap: 10, padding: '12px 14px',
        borderBottom: '1px solid var(--border)', alignItems: 'flex-start',
        cursor: 'pointer',
        background: selected ? 'rgba(198,255,58,.06)' : 'transparent',
        borderLeft: selected ? '2px solid var(--accent)' : '2px solid transparent',
        transition: 'background .12s',
      }}
      onMouseEnter={e => { if (!selected) e.currentTarget.style.background = 'rgba(255,255,255,.03)'; }}
      onMouseLeave={e => { if (!selected) e.currentTarget.style.background = 'transparent'; }}
    >
      <div style={{ flexShrink: 0, marginTop: 2 }}>
        {a.position ? <PosBadge pos={a.position} /> : <span style={{ fontSize: 10, color: 'var(--text-faint)', fontFamily: 'var(--font-mono)' }}>—</span>}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 3, flexWrap: 'wrap' }}>
          <span style={{ fontWeight: 700, fontSize: 12, color: 'var(--text)' }}>{a.player_name}</span>
          {a.team && <span style={{ fontSize: 10, color: 'var(--text-faint)', fontFamily: 'var(--font-mono)' }}>{a.team}</span>}
          {isBreaking(a.published_at) && (
            <span style={{ fontSize: 9, fontFamily: 'var(--font-mono)', fontWeight: 800, color: '#ff4d4d', background: 'rgba(255,77,77,.12)', border: '1px solid rgba(255,77,77,.3)', borderRadius: 3, padding: '1px 5px', letterSpacing: '.06em' }}>⚡ BREAKING</span>
          )}
          {score && (
            <span style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 4 }}>
              {topMeta && <span style={{ fontSize: 9, fontFamily: 'var(--font-mono)', fontWeight: 700, color: topMeta.color, background: `${topMeta.color}18`, border: `1px solid ${topMeta.color}33`, borderRadius: 3, padding: '0 4px' }}>{topMeta.label}</span>}
              <span style={{ fontSize: 10, fontFamily: 'var(--font-mono)', fontWeight: 700, color: score.score >= 0 ? 'var(--good)' : 'var(--danger)' }}>{score.score >= 0 ? '+' : ''}{score.score}</span>
            </span>
          )}
        </div>
        <div style={{ fontSize: 12, fontWeight: 600, color: selected ? 'var(--accent)' : 'var(--text)', lineHeight: 1.45, marginBottom: 3 }}>{a.headline}</div>
        {(a.fantasy_insight || a.summary_text) && (
          <div style={{ fontSize: 11, color: 'var(--accent)', lineHeight: 1.4, fontStyle: 'italic', marginBottom: 3, opacity: 0.85 }}>
            {a.fantasy_insight || a.summary_text}
          </div>
        )}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          {ago && <span style={{ fontSize: 10, color: 'var(--text-faint)' }}>{ago}</span>}
          {a.ai_generated_at && (
            <span style={{ fontSize: 9, fontFamily: 'var(--font-mono)', fontWeight: 700, color: '#c6ff3a', background: 'rgba(198,255,58,.08)', border: '1px solid rgba(198,255,58,.2)', borderRadius: 3, padding: '1px 5px' }}>
              🤖 {fmtAiAge(a.ai_generated_at)}
            </span>
          )}
          {score?.vote_count > 0 && <span style={{ fontSize: 9, color: 'var(--text-faint)', fontFamily: 'var(--font-mono)' }}>{score.vote_count} vote{score.vote_count !== 1 ? 's' : ''}</span>}
        </div>
      </div>
    </div>
  );
}


/* ── Reading pane ─────────────────────────────────────────────────────────────── */
function ReadingPane({ article, onClose, user, existingScore, onVote }) {
  const ago = fmtRelative(article.published_at);
  return (
    <div style={{ width: 400, flexShrink: 0, display: 'flex', flexDirection: 'column', borderLeft: '1px solid var(--border)', background: 'var(--panel)', overflow: 'auto' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px', borderBottom: '1px solid var(--border)', flexShrink: 0, background: 'var(--panel-2)', position: 'sticky', top: 0, zIndex: 1 }}>
        {article.position && <PosBadge pos={article.position} />}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 700, fontSize: 12, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {article.player_name || 'Article'}
            {article.team && <span style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--text-faint)', marginLeft: 6 }}>{article.team}</span>}
          </div>
          {ago && <div style={{ fontSize: 10, color: 'var(--text-faint)' }}>{ago}</div>}
        </div>
        <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-faint)', fontSize: 16, lineHeight: 1, padding: '2px 4px', borderRadius: 4 }}
          onMouseEnter={e => e.currentTarget.style.color = 'var(--text)'}
          onMouseLeave={e => e.currentTarget.style.color = 'var(--text-faint)'}
        >✕</button>
      </div>
      {/* Content */}
      <div style={{ padding: '16px 16px 8px', display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)', lineHeight: 1.5 }}>{article.headline}</div>
        {(article.fantasy_insight || article.summary_text) && (
          <div style={{ fontSize: 12, color: 'var(--accent)', lineHeight: 1.65, fontStyle: 'italic', padding: '10px 12px', background: 'rgba(198,255,58,.06)', border: '1px solid rgba(198,255,58,.18)', borderRadius: 7 }}>
            {article.fantasy_insight || article.summary_text}
          </div>
        )}
        {(article.description || article.full_text) && (
          <div style={{ fontSize: 13, color: 'var(--text-dim)', lineHeight: 1.7 }}>
            {(article.description || article.full_text).slice(0, 800)}
            {(article.description || article.full_text).length > 800 ? '…' : ''}
          </div>
        )}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', paddingTop: 4, borderTop: '1px solid var(--border)' }}>
          {article.publisher && <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-dim)' }}>{article.publisher}</span>}
          {article.published_at && <span style={{ fontSize: 10, color: 'var(--text-faint)' }}>Published {fmtRelative(article.published_at)}</span>}
          <a href={article.article_url} target="_blank" rel="noopener noreferrer"
            style={{ fontSize: 11, fontWeight: 700, color: '#4ea8ff', textDecoration: 'none', padding: '4px 12px', background: 'rgba(78,168,255,.1)', border: '1px solid rgba(78,168,255,.3)', borderRadius: 6 }}
          >Open Full Article ↗</a>
        </div>
        {(article.ai_generated_at || article.enriched_at) && (
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', padding: '8px 16px', background: 'rgba(198,255,58,.03)', borderTop: '1px solid rgba(198,255,58,.1)' }}>
            {article.ai_generated_at && (
              <span style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: '#c6ff3a', display: 'flex', alignItems: 'center', gap: 4 }}>
                🤖 AI analyzed {fmtAiAge(article.ai_generated_at)}
              </span>
            )}
            {article.enriched_at && (
              <span style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--text-faint)', display: 'flex', alignItems: 'center', gap: 4 }}>
                ◆ Enriched {fmtAiAge(article.enriched_at)}
              </span>
            )}
          </div>
        )}
      </div>
      {/* Feedback widget */}
      <FeedbackWidget article={article} user={user} initialScore={existingScore} onVote={onVote} />
    </div>
  );
}

/* ── Inline rating panel — shown below the card on click, no duplicate content ── */
function ArticleInlineDetail({ article, onClose, user, existingScore, onVote }) {
  const [editRating, setEditRating] = React.useState(false);
  const storageKey = `fb_${article.article_url}`;
  const alreadyVoted = (() => { try { return !!sessionStorage.getItem(storageKey); } catch { return false; } })();

  return (
    <div style={{ background: 'rgba(198,255,58,.03)', borderLeft: '3px solid var(--accent)', borderBottom: '1px solid var(--border)', padding: '10px 14px', display: 'flex', flexDirection: 'column', gap: 8 }}>
      {/* Action row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        {article.article_url && (
          <a href={article.article_url} target="_blank" rel="noopener noreferrer"
            style={{ fontSize: 11, fontWeight: 700, color: '#4ea8ff', textDecoration: 'none', padding: '3px 10px', background: 'rgba(78,168,255,.1)', border: '1px solid rgba(78,168,255,.3)', borderRadius: 5 }}
          >Open Full Article ↗</a>
        )}
        {alreadyVoted && !editRating && (
          <button onClick={() => setEditRating(true)} style={{ fontSize: 11, padding: '3px 10px', borderRadius: 5, border: '1px solid var(--border)', background: 'var(--panel-3)', color: 'var(--text-faint)', cursor: 'pointer', fontWeight: 600 }}>
            ↻ Change Rating
          </button>
        )}
        <button onClick={onClose} style={{ marginLeft: 'auto', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-faint)', fontSize: 14, lineHeight: 1, padding: '2px 6px', borderRadius: 4 }}
          onMouseEnter={e => e.currentTarget.style.color = 'var(--text)'}
          onMouseLeave={e => e.currentTarget.style.color = 'var(--text-faint)'}
        >✕</button>
      </div>
      {/* Community rating + vote form */}
      <FeedbackWidget article={article} user={user} initialScore={existingScore} onVote={onVote} forceEdit={editRating} onRated={() => setEditRating(false)} />
    </div>
  );
}

/* ── Articles tab — two columns with inline expansion ────────────────────────── */
function ArticlesFeedTab({ articles, loading, dbSource, user, posFilter = 'ALL', search = '', teamFilter = 'ALL', fantasyRosterNames = null }) {
  const [selectedArticle, setSelectedArticle] = React.useState(null);
  const [articleScores,   setArticleScores]   = React.useState({});
  const [freshAiOnly,     setFreshAiOnly]     = React.useState(false);
  const [votedOnly,       setVotedOnly]       = React.useState(false);
  const [sortBy,          setSortBy]          = React.useState('published'); // 'published' | 'ai_analyzed'

  React.useEffect(() => {
    fetch(`${API_BASE}/api/v1/feedback/scores`, { signal: AbortSignal.timeout(10000) })
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d?.scores) setArticleScores(d.scores); })
      .catch(() => {});
  }, []);

  const filtered = React.useMemo(() => {
    let list = articles;
    if (posFilter !== 'ALL') list = list.filter(a => (a.position || '').toUpperCase() === posFilter);
    if (teamFilter !== 'ALL') list = list.filter(a => (a.team || '').toUpperCase() === teamFilter);
    if (fantasyRosterNames) list = list.filter(a => fantasyRosterNames.has((a.player_name || '').toLowerCase().trim()));
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(a =>
        (a.player_name || '').toLowerCase().includes(q) ||
        (a.headline    || '').toLowerCase().includes(q)
      );
    }
    if (freshAiOnly) {
      const cutoff = Date.now() - 60 * 60 * 1000;
      list = list.filter(a => a.ai_generated_at && new Date(a.ai_generated_at).getTime() > cutoff);
    }
    if (votedOnly) {
      list = list.filter(a => { try { return !!sessionStorage.getItem('fb_' + a.article_url); } catch { return false; } });
    }
    if (sortBy === 'ai_analyzed') {
      list = [...list].sort((a, b) => {
        const ta = a.ai_generated_at ? new Date(a.ai_generated_at).getTime() : 0;
        const tb = b.ai_generated_at ? new Date(b.ai_generated_at).getTime() : 0;
        return tb - ta;
      });
    }
    return list;
  }, [articles, posFilter, teamFilter, fantasyRosterNames, search, freshAiOnly, votedOnly, sortBy]);

  const srcLabel = { export_player_news: 'export_player_news', gold_enriched_news: 'enriched_news' }[dbSource] || (dbSource || 'R2 cache');

  function handleSelect(a) {
    setSelectedArticle(prev => prev?.article_url === a.article_url ? null : a);
  }

  if (loading && !articles.length) return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '50%', gap: 10 }}>
      <div className="ai-orb" style={{ width: 18, height: 18 }} />
      <div style={{ fontSize: 13, color: 'var(--text-dim)' }}>Loading articles from Databricks…</div>
    </div>
  );

  if (!articles.length) return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '50%', gap: 10 }}>
      <div style={{ fontSize: 28 }}>📰</div>
      <div style={{ fontSize: 13, color: 'var(--text-dim)' }}>No articles yet — Databricks pipeline hasn't run</div>
    </div>
  );

  const labeled   = filtered.filter(a => a.player_name && a.position);
  const unlabeled = filtered.filter(a => !a.player_name || !a.position);

  function renderList(list, emptyMsg) {
    if (list.length === 0) return <div style={{ padding: '40px 20px', textAlign: 'center', color: 'var(--text-faint)', fontSize: 12 }}>{emptyMsg}</div>;
    return list.map((a, i) => (
      <React.Fragment key={i}>
        <ArticleCard a={a} onSelect={handleSelect} selected={selectedArticle?.article_url === a.article_url} score={articleScores?.[a.article_url] || null} />
        {selectedArticle?.article_url === a.article_url && (
          <ArticleInlineDetail
            article={selectedArticle}
            onClose={() => setSelectedArticle(null)}
            user={user}
            existingScore={articleScores[selectedArticle.article_url] || null}
            onVote={(url, agg) => setArticleScores(s => ({ ...s, [url]: agg }))}
          />
        )}
      </React.Fragment>
    ));
  }

  return (
    <div style={{ display: 'flex', height: '100%', overflow: 'hidden' }}>

      {/* ── Labeled column ── */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', borderRight: '1px solid var(--border)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 14px', borderBottom: '1px solid var(--border)', flexShrink: 0, background: 'var(--panel-2)', flexWrap: 'wrap' }}>
          <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--accent)' }}>Labeled</span>
          <span style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--text-faint)' }}>{labeled.length}</span>
          <div style={{ display: 'flex', gap: 4, marginLeft: 8 }}>
            <button
              onClick={() => setFreshAiOnly(f => !f)}
              title="Show only articles AI-analyzed in the last hour"
              style={{ fontSize: 9, padding: '2px 8px', borderRadius: 3, border: `1px solid ${freshAiOnly ? 'rgba(198,255,58,.4)' : 'var(--border)'}`, cursor: 'pointer', fontFamily: 'var(--font-mono)', fontWeight: 700, background: freshAiOnly ? 'rgba(198,255,58,.12)' : 'var(--panel-3)', color: freshAiOnly ? '#c6ff3a' : 'var(--text-faint)' }}
            >⚡ Fresh AI</button>
            <button
              onClick={() => setSortBy(s => s === 'published' ? 'ai_analyzed' : 'published')}
              title="Toggle sort: Published date ↔ AI analyzed date"
              style={{ fontSize: 9, padding: '2px 8px', borderRadius: 3, border: `1px solid ${sortBy === 'ai_analyzed' ? 'rgba(198,255,58,.4)' : 'var(--border)'}`, cursor: 'pointer', fontFamily: 'var(--font-mono)', fontWeight: 700, background: sortBy === 'ai_analyzed' ? 'rgba(198,255,58,.12)' : 'var(--panel-3)', color: sortBy === 'ai_analyzed' ? '#c6ff3a' : 'var(--text-faint)' }}
            >Sort: {sortBy === 'ai_analyzed' ? '🤖 AI' : '📅 Published'}</button>
            <button
              onClick={() => setVotedOnly(v => !v)}
              title="Show only articles you've rated this session"
              style={{ fontSize: 9, padding: '2px 8px', borderRadius: 3, border: `1px solid ${votedOnly ? 'rgba(78,168,255,.4)' : 'var(--border)'}`, cursor: 'pointer', fontFamily: 'var(--font-mono)', fontWeight: 700, background: votedOnly ? 'rgba(78,168,255,.12)' : 'var(--panel-3)', color: votedOnly ? '#4ea8ff' : 'var(--text-faint)' }}
            >✓ Voted On</button>
          </div>
          {loading && <span style={{ display: 'inline-block', width: 6, height: 6, borderRadius: '50%', background: '#c6ff3a', animation: 'pulse 1.2s ease-in-out infinite', marginLeft: 'auto' }} />}
          {dbSource && <span style={{ fontSize: 9, color: '#4ea8ff', fontWeight: 700, letterSpacing: '.04em', textTransform: 'uppercase', marginLeft: loading ? 4 : 'auto' }}>{srcLabel}</span>}
        </div>
        <div style={{ flex: 1, overflow: 'auto' }}>
          {renderList(labeled, 'No labeled articles match filters')}
        </div>
      </div>

      {/* ── Unlabeled column ── */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 14px', borderBottom: '1px solid var(--border)', flexShrink: 0, background: 'var(--panel-2)' }}>
          <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: '.06em', textTransform: 'uppercase', color: '#ff9800' }}>Un-Labeled</span>
          <span style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--text-faint)' }}>{unlabeled.length}</span>
        </div>
        <div style={{ flex: 1, overflow: 'auto' }}>
          {renderList(unlabeled, 'All articles are labeled')}
        </div>
      </div>
    </div>
  );
}

/* ── AI Summaries tab — gold_news_ai_summaries via R2 + live DB fallback ──────── */
function AiSummariesTab({ data, pos = 'ALL', search = '', fantasyRosterNames = null }) {
  const [liveData,   setLiveData]   = React.useState(null);
  const [liveSource, setLiveSource] = React.useState(null);

  React.useEffect(() => {
    if (data.length) return;
    let cancelled = false;
    fetch(`${API_BASE}/api/v1/news/ai-summaries`, { signal: AbortSignal.timeout(20000) })
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        if (cancelled || !d) return;
        setLiveData(Array.isArray(d.summaries) ? d.summaries : []);
        setLiveSource(d.source || null);
      })
      .catch(() => { if (!cancelled) setLiveData([]); });
    return () => { cancelled = true; };
  }, [data.length]);

  const allData = data.length ? data : (liveData || []);
  const loading = !data.length && liveData === null;

  const items = React.useMemo(() => {
    let list = allData;
    // Position filter — check impacted_players against player store
    if (pos !== 'ALL') {
      list = list.filter(s => {
        const players = (() => { try { return Array.isArray(s.impacted_players) ? s.impacted_players : (s.impacted_players ? JSON.parse(s.impacted_players) : []); } catch { return []; } })();
        return players.some(p => {
          const name = typeof p === 'string' ? p : (p?.player_name || p?.name || '');
          const pl = findPlayerByName(name);
          return pl?.pos === pos;
        });
      });
    }
    if (fantasyRosterNames) {
      list = list.filter(s => {
        const players = (() => { try { return Array.isArray(s.impacted_players) ? s.impacted_players : (s.impacted_players ? JSON.parse(s.impacted_players) : []); } catch { return []; } })();
        return players.some(p => {
          const name = typeof p === 'string' ? p : (p?.player_name || p?.name || '');
          return fantasyRosterNames.has(name.toLowerCase().trim());
        });
      });
    }
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(s =>
        (s.headline        || '').toLowerCase().includes(q) ||
        (s.summary_text    || '').toLowerCase().includes(q) ||
        (s.fantasy_insight || '').toLowerCase().includes(q)
      );
    }
    return list;
  }, [allData, pos, search]);

  const PRIORITY_COLOR = { critical: '#ff4d4d', high: '#ff9800', medium: '#4ea8ff', low: 'var(--text-faint)' };

  if (loading) return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '50%', gap: 10, color: 'var(--text-faint)' }}>
      <div className="ai-orb" style={{ width: 18, height: 18 }} />
      <div style={{ fontSize: 13, color: 'var(--text-dim)' }}>Loading AI summaries from Databricks…</div>
    </div>
  );

  if (!allData.length) return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '50%', gap: 10, color: 'var(--text-faint)' }}>
      <div style={{ fontSize: 28 }}>🤖</div>
      <div style={{ fontSize: 13, color: 'var(--text-dim)' }}>AI Summaries not yet available — run Databricks pipeline</div>
      <div style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--text-faint)' }}>main.fantasai.gold_news_ai_summaries</div>
    </div>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 14px', borderBottom: '1px solid var(--border)', flexShrink: 0, background: 'var(--panel-2)' }}>
        <span style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--text-faint)' }}>{items.length} of {allData.length} summaries</span>
        <span style={{ fontSize: 9, color: '#c6ff3a', fontWeight: 700, letterSpacing: '.05em', textTransform: 'uppercase' }}>{liveSource || 'gold_news_ai_summaries'}</span>
      </div>
      <div style={{ flex: 1, overflow: 'auto' }}>
        <div style={{ maxWidth: 820, margin: '0 auto', padding: '0 0 40px' }}>
          {items.map((s, i) => {
            const pColor = PRIORITY_COLOR[s.priority_level] || 'var(--text-faint)';
            const players = (() => { try { return Array.isArray(s.impacted_players) ? s.impacted_players : (s.impacted_players ? JSON.parse(s.impacted_players) : []); } catch { return []; } })();
            return (
              <div key={i} style={{ padding: '14px 20px', borderBottom: '1px solid var(--border)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6, flexWrap: 'wrap' }}>
                  {s.priority_level && <span style={{ fontSize: 9, fontFamily: 'var(--font-mono)', fontWeight: 800, letterSpacing: '.08em', textTransform: 'uppercase', color: pColor, border: `1px solid ${pColor}44`, borderRadius: 4, padding: '1px 6px' }}>{s.priority_level}</span>}
                  {s.impact_category && <span style={{ fontSize: 9, fontFamily: 'var(--font-mono)', color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '.06em' }}>{s.impact_category}</span>}
                  {s.sentiment === 'positive' && <span style={{ fontSize: 9, fontFamily: 'var(--font-mono)', fontWeight: 700, color: 'var(--good)', border: '1px solid rgba(54,211,154,.3)', borderRadius: 4, padding: '1px 6px' }}>▲ POS</span>}
                  {s.sentiment === 'negative' && <span style={{ fontSize: 9, fontFamily: 'var(--font-mono)', fontWeight: 700, color: 'var(--danger)', border: '1px solid rgba(255,90,110,.3)', borderRadius: 4, padding: '1px 6px' }}>▼ NEG</span>}
                  {s.is_time_sensitive && <span style={{ fontSize: 9, fontFamily: 'var(--font-mono)', fontWeight: 700, color: '#ff9800' }}>⚡ TIME SENSITIVE</span>}
                  {s.waiver_relevance >= 7 && <span style={{ fontSize: 9, fontFamily: 'var(--font-mono)', fontWeight: 700, color: 'var(--warn)', border: '1px solid rgba(255,181,71,.3)', borderRadius: 4, padding: '1px 6px' }}>W {Number(s.waiver_relevance).toFixed(1)}</span>}
                  {s.dynasty_relevance >= 7 && <span style={{ fontSize: 9, fontFamily: 'var(--font-mono)', fontWeight: 700, color: '#b4a0ff', border: '1px solid rgba(180,160,255,.3)', borderRadius: 4, padding: '1px 6px' }}>DYN {Number(s.dynasty_relevance).toFixed(1)}</span>}
                  {s.fantasy_relevance_score != null && <span style={{ fontSize: 9, fontFamily: 'var(--font-mono)', color: 'var(--text-faint)', marginLeft: 'auto' }}>rel {Number(s.fantasy_relevance_score).toFixed(1)}</span>}
                </div>
                <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)', marginBottom: 6, lineHeight: 1.5 }}>{s.headline}</div>
                {s.summary_text && <div style={{ fontSize: 12, color: 'var(--text-dim)', lineHeight: 1.6, marginBottom: 6 }}>{s.summary_text}</div>}
                {s.fantasy_insight && <div style={{ fontSize: 12, color: 'var(--accent)', lineHeight: 1.5, fontStyle: 'italic', marginBottom: 6 }}>{s.fantasy_insight}</div>}
                {players.length > 0 && (
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 4 }}>
                    {players.map((p, j) => {
                      const name = typeof p === 'string' ? p : (p?.player_name || p?.name || JSON.stringify(p));
                      return <span key={j} style={{ fontSize: 10, fontFamily: 'var(--font-mono)', background: 'rgba(78,168,255,.1)', border: '1px solid rgba(78,168,255,.25)', borderRadius: 4, padding: '1px 7px', color: '#4ea8ff' }}>{name}</span>;
                    })}
                  </div>
                )}
                {s.published_at && <div style={{ fontSize: 10, color: 'var(--text-faint)', marginTop: 6 }}>{fmtRelative(s.published_at)}</div>}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/* ── Enriched News tab — gold_enriched_news via R2 ──────────────────────────── */
function EnrichedNewsTab({ data }) {
  const [search, setSearch] = React.useState('');
  const items = React.useMemo(() => {
    if (!data.length) return [];
    const q = search.trim().toLowerCase();
    if (!q) return data;
    return data.filter(a =>
      (a.headline || '').toLowerCase().includes(q) ||
      (a.full_text || '').toLowerCase().includes(q)
    );
  }, [data, search]);

  if (!data.length) return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '50%', gap: 10, color: 'var(--text-faint)' }}>
      <div style={{ fontSize: 28 }}>🔎</div>
      <div style={{ fontSize: 13, color: 'var(--text-dim)' }}>Enriched articles not yet available — run Databricks pipeline</div>
      <div style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--text-faint)' }}>fantasai/news/enriched_news.json</div>
    </div>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 20px', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search articles…"
          style={{ fontSize: 11, background: 'var(--panel-2)', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: 4, padding: '4px 8px', width: 200 }} />
        <span style={{ marginLeft: 'auto', fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--text-faint)' }}>{items.length} of {data.length}</span>
        <span style={{ fontSize: 9, color: '#4ea8ff', fontWeight: 700, letterSpacing: '.05em', textTransform: 'uppercase' }}>gold_enriched_news</span>
      </div>
      <div style={{ flex: 1, overflow: 'auto' }}>
        <div style={{ maxWidth: 820, margin: '0 auto', padding: '0 0 40px' }}>
          {items.map((a, i) => {
            const players = (() => { try { return Array.isArray(a.mentioned_players) ? a.mentioned_players : (a.mentioned_players ? JSON.parse(a.mentioned_players) : []); } catch { return []; } })();
            const teams   = (() => { try { return Array.isArray(a.mentioned_teams)   ? a.mentioned_teams   : (a.mentioned_teams   ? JSON.parse(a.mentioned_teams)   : []); } catch { return []; } })();
            return (
              <div key={i} style={{ padding: '14px 20px', borderBottom: '1px solid var(--border)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 5, flexWrap: 'wrap' }}>
                  {a.publisher && <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-dim)' }}>{a.publisher}</span>}
                  {a.extraction_confidence != null && <span style={{ fontSize: 9, fontFamily: 'var(--font-mono)', color: 'var(--text-faint)' }}>conf {Number(a.extraction_confidence).toFixed(2)}</span>}
                  {a.published_at && <span style={{ fontSize: 10, color: 'var(--text-faint)', marginLeft: 'auto' }}>{fmtRelative(a.published_at)}</span>}
                </div>
                {a.article_url ? (
                  <a href={a.article_url} target="_blank" rel="noopener noreferrer"
                    style={{ display: 'block', fontSize: 14, fontWeight: 700, color: 'var(--text)', textDecoration: 'none', lineHeight: 1.5, marginBottom: 6 }}
                    onMouseEnter={e => e.currentTarget.style.color = '#4ea8ff'}
                    onMouseLeave={e => e.currentTarget.style.color = 'var(--text)'}
                  >{a.headline}</a>
                ) : (
                  <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)', lineHeight: 1.5, marginBottom: 6 }}>{a.headline}</div>
                )}
                {a.full_text && <div style={{ fontSize: 12, color: 'var(--text-dim)', lineHeight: 1.6, marginBottom: 8 }}>{a.full_text.slice(0, 400)}{a.full_text.length > 400 ? '…' : ''}</div>}
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {players.map((p, j) => <span key={j} style={{ fontSize: 10, background: 'rgba(198,255,58,.08)', border: '1px solid rgba(198,255,58,.2)', borderRadius: 4, padding: '1px 7px', color: 'var(--accent)' }}>{typeof p === 'string' ? p : (p?.name || JSON.stringify(p))}</span>)}
                  {teams.map((t, j) => <span key={`t${j}`} style={{ fontSize: 10, background: 'var(--panel-3)', border: '1px solid var(--border)', borderRadius: 4, padding: '1px 7px', color: 'var(--text-faint)' }}>{typeof t === 'string' ? t : (t?.name || JSON.stringify(t))}</span>)}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/* ── Player Notes tab — gold_player_notes via R2 ────────────────────────────── */
function PlayerNotesTab({ data }) {
  const [search, setSearch] = React.useState('');
  const [onlyInjury, setOnlyInjury] = React.useState(false);
  const items = React.useMemo(() => {
    let list = data;
    if (onlyInjury) list = list.filter(p => p.has_injury_concern || p.has_critical_news);
    const q = search.trim().toLowerCase();
    if (q) list = list.filter(p => (p.player_name || '').toLowerCase().includes(q));
    return list;
  }, [data, search, onlyInjury]);

  if (!data.length) return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '50%', gap: 10, color: 'var(--text-faint)' }}>
      <div style={{ fontSize: 28 }}>📋</div>
      <div style={{ fontSize: 13, color: 'var(--text-dim)' }}>Player notes not yet available — run Databricks pipeline</div>
      <div style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--text-faint)' }}>fantasai/news/player_notes.json</div>
    </div>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 20px', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search player…"
          style={{ fontSize: 11, background: 'var(--panel-2)', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: 4, padding: '4px 8px', width: 160 }} />
        <button onClick={() => setOnlyInjury(f => !f)} style={{
          fontSize: 11, padding: '3px 10px', borderRadius: 4, cursor: 'pointer',
          background: onlyInjury ? 'rgba(255,152,0,.18)' : 'var(--panel-3)',
          color: onlyInjury ? '#ff9800' : 'var(--text-faint)',
          border: `1px solid ${onlyInjury ? '#ff980044' : 'transparent'}`,
        }}>⚠ Injury Concern</button>
        <span style={{ marginLeft: 'auto', fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--text-faint)' }}>{items.length} of {data.length}</span>
        <span style={{ fontSize: 9, color: '#c6ff3a', fontWeight: 700, letterSpacing: '.05em', textTransform: 'uppercase' }}>gold_player_notes</span>
      </div>
      <div style={{ flex: 1, overflow: 'auto' }}>
        <div style={{ maxWidth: 820, margin: '0 auto', padding: '0 0 40px' }}>
          {items.map((pn, i) => {
            const notes = Array.isArray(pn.notes) ? pn.notes : [];
            const isCrit = pn.has_critical_news;
            const isInj  = pn.has_injury_concern;
            return (
              <div key={i} style={{ padding: '14px 20px', borderBottom: '1px solid var(--border)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 14, fontWeight: 800, color: isCrit ? '#ff4d4d' : isInj ? '#ff9800' : 'var(--text)' }}>{pn.player_name}</span>
                  {isCrit && <span style={{ fontSize: 9, fontFamily: 'var(--font-mono)', fontWeight: 800, color: '#ff4d4d', border: '1px solid #ff4d4d44', borderRadius: 4, padding: '1px 6px' }}>CRITICAL</span>}
                  {isInj  && !isCrit && <span style={{ fontSize: 9, fontFamily: 'var(--font-mono)', fontWeight: 800, color: '#ff9800', border: '1px solid #ff980044', borderRadius: 4, padding: '1px 6px' }}>INJURY</span>}
                  {pn.sentiment === 'positive' && <span style={{ fontSize: 9, fontFamily: 'var(--font-mono)', fontWeight: 700, color: 'var(--good)', border: '1px solid rgba(54,211,154,.3)', borderRadius: 4, padding: '1px 6px' }}>▲ POS</span>}
                  {pn.sentiment === 'negative' && <span style={{ fontSize: 9, fontFamily: 'var(--font-mono)', fontWeight: 700, color: 'var(--danger)', border: '1px solid rgba(255,90,110,.3)', borderRadius: 4, padding: '1px 6px' }}>▼ NEG</span>}
                  {pn.waiver_relevance >= 7 && <span style={{ fontSize: 9, fontFamily: 'var(--font-mono)', fontWeight: 700, color: 'var(--warn)', border: '1px solid rgba(255,181,71,.3)', borderRadius: 4, padding: '1px 6px' }}>W {Number(pn.waiver_relevance).toFixed(1)}</span>}
                  {pn.dynasty_relevance >= 7 && <span style={{ fontSize: 9, fontFamily: 'var(--font-mono)', fontWeight: 700, color: '#b4a0ff', border: '1px solid rgba(180,160,255,.3)', borderRadius: 4, padding: '1px 6px' }}>DYN {Number(pn.dynasty_relevance).toFixed(1)}</span>}
                  {pn.overall_impact_score != null && <span style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--text-faint)', marginLeft: 'auto' }}>impact {Number(pn.overall_impact_score).toFixed(1)}</span>}
                </div>
                {notes.map((n, j) => {
                  const dirColor = n.impact_direction === 'positive' ? 'var(--good)' : n.impact_direction === 'negative' ? 'var(--danger)' : 'var(--text-faint)';
                  return (
                    <div key={j} style={{ display: 'flex', gap: 10, marginBottom: 8, paddingLeft: 8, borderLeft: `2px solid ${dirColor}` }}>
                      <div style={{ flex: 1 }}>
                        {n.priority && <span style={{ fontSize: 9, fontFamily: 'var(--font-mono)', fontWeight: 700, color: dirColor, textTransform: 'uppercase', marginRight: 8 }}>{n.priority}</span>}
                        <span style={{ fontSize: 12, color: 'var(--text-dim)', lineHeight: 1.6 }}>{n.note_text}</span>
                        {n.published_at && <span style={{ display: 'block', fontSize: 10, color: 'var(--text-faint)', marginTop: 2 }}>{fmtRelative(n.published_at)}</span>}
                      </div>
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
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

function isBreaking(published_at) {
  if (!published_at) return false;
  return Date.now() - new Date(published_at).getTime() < 6 * 60 * 60 * 1000;
}

function fmtAiAge(ts) {
  if (!ts) return null;
  const d = new Date(ts);
  if (isNaN(d.getTime())) return null;
  const mins = Math.round((Date.now() - d.getTime()) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
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
        const rawSrcLabel = best?.source || best?.sourceId || '';
        const srcLabel  = (rawSrcLabel === 'Sleeper' || rawSrcLabel === 'sleeper-api') ? '' : rawSrcLabel;
        const pubStr    = best?.publishedAt ? fmtNewsDate(best.publishedAt) : null;
        const fetchStr  = best?.fetchedAt  ? fmtNewsDate(best.fetchedAt)  : null;
        // Only show fetched date if there's no published date, or they differ by >5 min
        const showFetch = !pubStr || (best?.fetchedAt && best?.publishedAt && Math.abs(best.fetchedAt - best.publishedAt) > 5 * 60 * 1000);
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
              </div>
            </div>

            {/* Headline */}
            {title && (
              <div style={{ fontSize: 14, fontWeight: 700, lineHeight: 1.45, marginBottom: 6, color: 'var(--text)' }}>
                {title}
              </div>
            )}

            {/* Source + date attribution */}
            <div style={{ fontSize: 11, color: 'var(--text-faint)', marginBottom: (body && body !== title) || sources.length > 1 ? 6 : 0, display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
              {srcLabel && (
                <>
                  <span style={{ color: 'var(--text-dim)' }}>by</span>
                  <span style={{ color: srcColor(best), fontWeight: 600 }}>{srcLabel}</span>
                  <span>·</span>
                </>
              )}
              {pubStr && <span title="Date source published this update">{pubStr}</span>}
              {showFetch && fetchStr && (
                <span style={{ color: 'var(--text-faint)', fontSize: 10 }} title="When we fetched this">
                  {pubStr ? `(fetched ${fetchStr})` : fetchStr}
                </span>
              )}
            </div>

            {/* Multi-source status breakdown — when multiple sources have data on this player */}
            {sources.length > 1 && (
              <div style={{ marginBottom: body && body !== title ? 8 : 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
                {sources.map((s, si) => {
                  const sPub   = s.publishedAt ? fmtNewsDate(s.publishedAt) : null;
                  const sFetch = s.fetchedAt   ? fmtNewsDate(s.fetchedAt)   : null;
                  const sDate  = sPub || sFetch;
                  const sDateLabel = sPub ? sPub : sFetch ? `fetched ${sFetch}` : null;
                  return (
                    <div key={si} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11 }}>
                      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9, fontWeight: 700, padding: '1px 5px', borderRadius: 3, background: `${srcColor(s)}22`, color: srcColor(s), border: `1px solid ${srcColor(s)}44`, whiteSpace: 'nowrap' }}>
                        {s.source}
                      </span>
                      <span style={{ color: 'var(--text-dim)', flex: 1 }}>{s.title || s.body || '—'}</span>
                      {sDateLabel && (
                        <span style={{ color: sPub ? 'var(--text-faint)' : 'var(--text-faint)', fontFamily: 'var(--font-mono)', fontSize: 10, whiteSpace: 'nowrap' }} title={sPub ? 'Source published date' : 'Fetched date'}>
                          {sPub ? '📅 ' : '⬇ '}{sDateLabel}
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

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

/* ── Human-in-the-loop feedback ─────────────────────────────────────────────── */

const FEEDBACK_LABELS = [
  { id: 'BREAKOUT',      label: 'Breakout',      color: '#c6ff3a', score: +10 },
  { id: 'INJURY_IMPACT', label: 'Injury Impact', color: '#ff4d4d', score: +15 },
  { id: 'DEPTH_CHART',   label: 'Depth Chart',   color: '#4ea8ff', score: +8  },
  { id: 'START_SIT',     label: 'Start/Sit',     color: '#a78bfa', score: +5  },
  { id: 'WAIVER_WIRE',   label: 'Waiver Wire',   color: '#34d399', score: +8  },
  { id: 'TRADE_IMPACT',  label: 'Trade Impact',  color: '#fb923c', score: +7  },
  { id: 'COACH_SPEAK',   label: 'Coach Speak',   color: '#94a3b8', score: +2  },
  { id: 'HYPE_ONLY',     label: 'Hype Only',     color: '#6b7280', score: -10 },
  { id: 'OLD_NEWS',      label: 'Old News',      color: '#6b7280', score: -5  },
  { id: 'CLICKBAIT',     label: 'Clickbait',     color: '#ef4444', score: -15 },
];

function FeedbackWidget({ article, user, initialScore, onVote, forceEdit = false, onRated }) {
  const storageKey = `fb_${article.article_url}`;
  const [selected,    setSelected]    = React.useState([]);
  const [confidence,  setConfidence]  = React.useState(3);
  const [submitting,  setSubmitting]  = React.useState(false);
  const [aggregate,   setAggregate]   = React.useState(initialScore);
  const [voted,       setVoted]       = React.useState(() => {
    try { return !!sessionStorage.getItem(storageKey); } catch { return false; }
  });

  // Re-sync when switching articles
  React.useEffect(() => {
    setAggregate(initialScore);
    setSelected([]);
    setConfidence(3);
    try { setVoted(!!sessionStorage.getItem(storageKey)); } catch {}
  }, [article.article_url]);

  function toggle(id) {
    setSelected(s => s.includes(id) ? s.filter(x => x !== id) : [...s, id]);
  }

  async function submit() {
    if (!selected.length || submitting) return;
    setSubmitting(true);
    try {
      const res = await fetch(`${API_BASE}/api/v1/feedback/vote`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          article_url: article.article_url,
          headline:    article.headline,
          user_id:     user?.teamId || 'anon',
          labels:      selected,
          confidence,
        }),
      });
      const data = await res.json();
      if (res.ok && data.status === 'ok') {
        setAggregate(data.aggregate);
        setVoted(true);
        try { sessionStorage.setItem(storageKey, '1'); } catch {}
        onVote?.(article.article_url, data.aggregate);
        onRated?.();
      }
    } catch (_) {}
    setSubmitting(false);
  }

  const scoreColor = !aggregate ? 'var(--text-faint)' : aggregate.score >= 8 ? 'var(--good)' : aggregate.score <= -5 ? 'var(--danger)' : 'var(--text-dim)';

  return (
    <div style={{ borderTop: '2px solid var(--border)', background: 'rgba(198,255,58,.02)', margin: '0 0 0 0' }}>

      {/* Community score header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 16px 0', flexWrap: 'wrap' }}>
        <span style={{ fontSize: 10, fontFamily: 'var(--font-mono)', fontWeight: 800, color: 'var(--accent)', letterSpacing: '.08em', textTransform: 'uppercase' }}>Community Rating</span>
        {aggregate ? (
          <>
            <span style={{ fontSize: 14, fontWeight: 800, color: scoreColor, fontFamily: 'var(--font-mono)' }}>{aggregate.score >= 0 ? '+' : ''}{aggregate.score}</span>
            <span style={{ fontSize: 10, color: 'var(--text-faint)', fontFamily: 'var(--font-mono)' }}>{aggregate.vote_count} vote{aggregate.vote_count !== 1 ? 's' : ''}</span>
            <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
              {aggregate.top_labels?.map(l => {
                const m = FEEDBACK_LABELS.find(x => x.id === l);
                return m ? <span key={l} style={{ fontSize: 9, fontFamily: 'var(--font-mono)', fontWeight: 700, color: m.color, background: `${m.color}18`, border: `1px solid ${m.color}33`, borderRadius: 3, padding: '1px 5px' }}>{m.label}</span> : null;
              })}
            </div>
          </>
        ) : (
          <span style={{ fontSize: 10, color: 'var(--text-faint)' }}>No votes yet — be the first</span>
        )}
      </div>

      {/* Vote form or confirmation */}
      {voted && !forceEdit ? (
        <div style={{ padding: '10px 16px 14px' }}>
          <div style={{ fontSize: 11, color: 'var(--text-faint)', fontStyle: 'italic' }}>✓ You rated this article this session</div>
        </div>
      ) : (
        <div style={{ padding: '12px 16px 16px', display: 'flex', flexDirection: 'column', gap: 10 }}>

          {/* Label grid */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
            {FEEDBACK_LABELS.map(({ id, label, color }) => {
              const active = selected.includes(id);
              return (
                <button key={id} onClick={() => toggle(id)} style={{
                  fontSize: 10, padding: '4px 10px', borderRadius: 4, cursor: 'pointer',
                  border: `1px solid ${active ? color : 'var(--border)'}`,
                  background: active ? `${color}1a` : 'var(--panel-3)',
                  color: active ? color : 'var(--text-faint)',
                  fontWeight: active ? 700 : 500, transition: 'all .1s',
                }}>{label}</button>
              );
            })}
          </div>

          {/* Fantasy Impact stars */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 10, color: 'var(--text-faint)', minWidth: 80 }}>Fantasy Impact</span>
            {[1,2,3,4,5].map(n => (
              <button key={n} onClick={() => setConfidence(n)} style={{
                background: 'none', border: 'none', cursor: 'pointer', padding: '0 1px',
                fontSize: 16, color: n <= confidence ? '#fbbf24' : 'var(--border)', transition: 'color .1s',
              }}>★</button>
            ))}
            <span style={{ fontSize: 9, fontFamily: 'var(--font-mono)', color: 'var(--text-faint)' }}>{confidence}/5</span>
          </div>

          {/* Submit */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <button onClick={submit} disabled={!selected.length || submitting} style={{
              fontSize: 11, padding: '6px 16px', borderRadius: 5, border: 'none',
              cursor: !selected.length || submitting ? 'not-allowed' : 'pointer',
              background: !selected.length || submitting ? 'var(--panel-3)' : 'var(--accent)',
              color: !selected.length || submitting ? 'var(--text-faint)' : '#0a1300',
              fontWeight: 700,
            }}>{submitting ? 'Submitting…' : 'Submit Rating'}</button>
            {!selected.length && <span style={{ fontSize: 10, color: 'var(--text-faint)', fontStyle: 'italic' }}>Select at least one label above</span>}
          </div>

        </div>
      )}
    </div>
  );
}

/* ── Article Labeling (open to all owners) ───────────────────────────────────── */


function detectDST(headline = '') {
  const h = headline.toLowerCase();
  const isDst = /\bdefense\b|\bdefensive\b|\bd\/st\b|\bdefenders?\b|\blinebackers?\b|\bcornerback|\bpass rush|\bsacks?\b|\binterceptions?\b|\bsafety\b/.test(h);
  if (!isDst) return null;
  for (const t of NFL_TEAMS_FULL) {
    if (h.includes(t.name.toLowerCase()) || h.includes(t.city.toLowerCase())) {
      return { labeled_player_name: `${t.abbr} D/ST`, labeled_position: 'DST', labeled_team: t.abbr };
    }
  }
  return null;
}

const BLANK_FORM = { labeled_player_name: '', labeled_position: '', labeled_team: '', impact_category: 'analysis', impact_direction: 'neutral', relevance_score: 3, is_relevant: true, notes: '' };

function ArticleLabelerTab({ articles, user, search = '' }) {
  const myId = user?.teamId ? String(user.teamId) : null;

  const [filter,        setFilter]        = React.useState('unlabeled');
  const [selected,      setSelected]      = React.useState(null);
  const [form,          setForm]          = React.useState(BLANK_FORM);
  const [saving,        setSaving]        = React.useState(false);
  const [saveMsg,       setSaveMsg]       = React.useState(null);
  // Existing labels from R2 (fetched on mount)
  const [labelByUrl,    setLabelByUrl]    = React.useState(new Map()); // Map<url, label>
  const [loadingLabels, setLoadingLabels] = React.useState(true);

  // Fetch all saved labels from R2 on mount
  React.useEffect(() => {
    let cancelled = false;
    fetch(`${API_BASE}/api/v1/labels/article`, { signal: AbortSignal.timeout(15000) })
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        if (cancelled || !d) return;
        const arr = Array.isArray(d.labels) ? d.labels : [];
        // Keep most-recent label per URL (array is newest-first from the API)
        const m = new Map();
        for (const l of arr) { if (l.article_url && !m.has(l.article_url)) m.set(l.article_url, l); }
        setLabelByUrl(m);
      })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoadingLabels(false); });
    return () => { cancelled = true; };
  }, []);

  // After a successful save, update the local map without a full refetch
  function patchLabel(label) {
    setLabelByUrl(prev => new Map(prev).set(label.article_url, label));
  }

  const myLabeledCount = React.useMemo(() => {
    let n = 0;
    for (const l of labelByUrl.values()) {
      if (!myId || l.labeled_by === myId || l.labeled_by === 'commissioner') n++;
    }
    return n;
  }, [labelByUrl, myId]);

  const displayed = React.useMemo(() => {
    let list = articles;
    if (filter === 'unlabeled') {
      list = list.filter(a => !labelByUrl.has(a.article_url));
    } else if (filter === 'mine') {
      list = list.filter(a => {
        const l = labelByUrl.get(a.article_url);
        return l && (!myId || l.labeled_by === myId || l.labeled_by === 'commissioner');
      });
    }
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(a =>
        (a.player_name || '').toLowerCase().includes(q) ||
        (a.headline    || '').toLowerCase().includes(q)
      );
    }
    return list;
  }, [articles, filter, search, labelByUrl, myId]);

  function selectArticle(a) {
    setSelected(a);
    setSaveMsg(null);
    const existing = labelByUrl.get(a.article_url);
    if (existing) {
      // Pre-fill form from saved label so the owner can review / update it
      setForm({
        labeled_player_name: existing.labeled_player_name || '',
        labeled_position:    existing.labeled_position    || '',
        labeled_team:        existing.labeled_team        || '',
        impact_category:     existing.impact_category     || 'analysis',
        impact_direction:    existing.impact_direction    || 'neutral',
        relevance_score:     existing.relevance_score     ?? 3,
        is_relevant:         existing.is_relevant         !== false,
        notes:               existing.notes               || '',
      });
    } else {
      const dst = detectDST(a.headline || '');
      if (dst) {
        setForm(f => ({ ...f, ...dst }));
      } else {
        setForm({ ...BLANK_FORM, labeled_player_name: a.player_name || '', labeled_position: a.position || '', labeled_team: a.team || '' });
      }
    }
  }

  async function submitLabel() {
    if (!selected || !form.labeled_position) return;
    const apiKey = import.meta.env.VITE_FANTASAI_KEY || '';
    if (!apiKey) {
      setSaveMsg({ ok: false, text: 'VITE_FANTASAI_KEY not set — add it to app/.env and Cloudflare Pages env vars, then redeploy' });
      return;
    }
    setSaving(true);
    setSaveMsg(null);
    try {
      const res = await fetch(`${API_BASE}/api/v1/labels/article`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-FantasAI-Key': apiKey },
        body: JSON.stringify({
          article_url:          selected.article_url,
          headline:             selected.headline,
          publisher:            selected.publisher,
          published_at:         selected.published_at,
          original_player_name: selected.player_name || '',
          original_position:    selected.position    || '',
          original_team:        selected.team        || '',
          user_id:              myId || 'commissioner',
          ...form,
        }),
      });
      const data = await res.json();
      if (res.ok && data.status === 'ok') {
        patchLabel(data.label);
        setSaveMsg({ ok: true, text: `Saved! ${data.metadata?.total_labels ?? ''} total labels` });
        setSelected(null);
        setForm(BLANK_FORM);
      } else {
        setSaveMsg({ ok: false, text: data.error || 'Save failed' });
      }
    } catch (err) {
      setSaveMsg({ ok: false, text: err.message });
    } finally {
      setSaving(false);
    }
  }

  const unlabeledCount = articles.filter(a => !labelByUrl.has(a.article_url)).length;

  return (
    <div style={{ display: 'flex', height: '100%', overflow: 'hidden' }}>

      {/* ── Left: article list ── */}
      <div style={{ width: 440, flexShrink: 0, borderRight: '1px solid var(--border)', display: 'flex', flexDirection: 'column' }}>

        {/* Filter tabs */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 14px', borderBottom: '1px solid var(--border)', flexShrink: 0, flexWrap: 'wrap' }}>
          {[
            { id: 'unlabeled', label: `⚠ Unlabeled`, count: unlabeledCount, col: '#ff9800' },
            { id: 'mine',      label: `✓ My Labels`,  count: myLabeledCount, col: '#4ade80' },
            { id: 'all',       label: 'All',          count: articles.length, col: null   },
          ].map(t => (
            <button key={t.id} onClick={() => setFilter(t.id)} style={{
              fontSize: 11, padding: '3px 9px', borderRadius: 4, cursor: 'pointer', border: 'none',
              background: filter === t.id ? (t.col ? `${t.col}22` : 'var(--accent)') : 'var(--panel-3)',
              color: filter === t.id ? (t.col || '#0a1300') : 'var(--text-faint)',
              fontWeight: filter === t.id ? 700 : 500,
            }}>
              {t.label} <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10 }}>({t.count})</span>
            </button>
          ))}
          {loadingLabels && (
            <span style={{ marginLeft: 'auto', fontSize: 10, color: 'var(--text-faint)', fontFamily: 'var(--font-mono)' }}>loading labels…</span>
          )}
          {!loadingLabels && labelByUrl.size > 0 && (
            <span style={{ marginLeft: 'auto', fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--accent)' }}>{labelByUrl.size} labeled total</span>
          )}
        </div>

        {/* Pipeline timing note */}
        <div style={{ padding: '6px 14px', background: 'rgba(78,168,255,.04)', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
          <span style={{ fontSize: 10, color: 'var(--text-faint)', lineHeight: 1.4, display: 'block' }}>
            Labels save to R2 instantly · Databricks picks them up <strong style={{ color: 'var(--text-dim)' }}>next day</strong> to retrain the player-mapping model
          </span>
        </div>

        <div style={{ flex: 1, overflow: 'auto' }}>
          {displayed.length === 0 ? (
            <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-faint)', fontSize: 13 }}>
              {filter === 'unlabeled' ? 'All articles have been labeled' :
               filter === 'mine'      ? 'No labels from you yet — switch to Unlabeled to get started' :
               'No articles loaded'}
            </div>
          ) : displayed.map((a, i) => {
            const existingLabel = labelByUrl.get(a.article_url);
            const isMine   = existingLabel && (!myId || existingLabel.labeled_by === myId || existingLabel.labeled_by === 'commissioner');
            const isOther  = existingLabel && !isMine;
            const isSel    = selected?.article_url === a.article_url;
            const ago      = fmtRelative(a.published_at);
            const labelAgo = existingLabel?.labeled_at ? fmtRelative(existingLabel.labeled_at) : null;

            let borderColor = 'transparent';
            let bgColor = 'transparent';
            if (isSel)       { borderColor = 'var(--accent)'; bgColor = 'rgba(198,255,58,.06)'; }
            else if (isMine) { borderColor = '#4ade80'; bgColor = 'rgba(74,222,128,.03)'; }
            else if (isOther){ borderColor = '#4ea8ff'; bgColor = 'rgba(78,168,255,.03)'; }

            return (
              <div key={i} onClick={() => selectArticle(a)} style={{
                padding: '10px 14px', borderBottom: '1px solid var(--border)',
                cursor: 'pointer', background: bgColor, borderLeft: `3px solid ${borderColor}`,
              }}
                onMouseEnter={e => { if (!isSel) e.currentTarget.style.background = 'rgba(255,255,255,.03)'; }}
                onMouseLeave={e => { if (!isSel) e.currentTarget.style.background = bgColor; }}
              >
                <div style={{ fontSize: 12, fontWeight: 600, lineHeight: 1.4, color: 'var(--text)', marginBottom: 4 }}>{a.headline}</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                  {/* Original article tags */}
                  {a.position && <span style={{ fontSize: 9, fontFamily: 'var(--font-mono)', fontWeight: 700, color: 'var(--accent)', background: 'rgba(198,255,58,.12)', borderRadius: 3, padding: '1px 5px' }}>{a.position}</span>}
                  {a.player_name && <span style={{ fontSize: 10, color: 'var(--text-dim)', fontWeight: 600 }}>{a.player_name}</span>}
                  {!a.position && !a.player_name && !existingLabel && <span style={{ fontSize: 9, color: '#ff9800', fontFamily: 'var(--font-mono)', fontWeight: 700 }}>UNMAPPED</span>}

                  {/* Existing label summary */}
                  {existingLabel && (
                    <>
                      <span style={{ fontSize: 9, fontFamily: 'var(--font-mono)', fontWeight: 800,
                        color: isMine ? '#4ade80' : '#4ea8ff',
                        background: isMine ? 'rgba(74,222,128,.12)' : 'rgba(78,168,255,.12)',
                        border: `1px solid ${isMine ? 'rgba(74,222,128,.3)' : 'rgba(78,168,255,.3)'}`,
                        borderRadius: 3, padding: '1px 5px',
                      }}>
                        ✓ {existingLabel.labeled_position}{existingLabel.labeled_team ? ` · ${existingLabel.labeled_team}` : ''}
                      </span>
                      {existingLabel.labeled_player_name && existingLabel.labeled_player_name !== a.player_name && (
                        <span style={{ fontSize: 10, color: 'var(--text-dim)', fontWeight: 600 }}>{existingLabel.labeled_player_name}</span>
                      )}
                      {existingLabel.relevance_score != null && (
                        <span style={{ fontSize: 9, fontFamily: 'var(--font-mono)', fontWeight: 700, color: '#fbbf24', background: 'rgba(251,191,36,.1)', border: '1px solid rgba(251,191,36,.25)', borderRadius: 3, padding: '1px 5px' }}>★ {existingLabel.relevance_score}/5</span>
                      )}
                      {(() => {
                        const lbRaw = existingLabel.labeled_by;
                        const lbId  = lbRaw === 'commissioner' ? (myId ? parseInt(myId) : null) : (lbRaw ? parseInt(lbRaw) : null);
                        const lbTeam = lbId ? findTeam(lbId) : null;
                        return lbTeam ? (
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                            <TeamLogoBadge team={lbTeam} size={14} />
                            <span style={{ fontSize: 9, color: 'var(--text-faint)' }}>{lbTeam.owner || lbTeam.name}</span>
                          </span>
                        ) : null;
                      })()}
                      {labelAgo && <span style={{ fontSize: 9, color: 'var(--text-faint)', fontFamily: 'var(--font-mono)' }}>{labelAgo}</span>}
                    </>
                  )}

                  {ago && <span style={{ fontSize: 10, color: 'var(--text-faint)', marginLeft: 'auto' }}>{ago}</span>}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* ── Right: label form ── */}
      <div style={{ flex: 1, overflow: 'auto', padding: '20px 24px', maxWidth: 560 }}>
        {!selected ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16, paddingTop: 40 }}>
            <div style={{ fontSize: 28, textAlign: 'center' }}>🏷️</div>
            <div style={{ textAlign: 'center', fontSize: 14, fontWeight: 700, color: 'var(--text)' }}>Article Labeler</div>
            <div style={{ textAlign: 'center', fontSize: 12, color: 'var(--text-faint)', lineHeight: 1.6 }}>
              Select an article on the left to label it.<br />
              Already-labeled articles (green border) will pre-fill with your previous answer — update and re-save to correct them.<br />
              Labels save instantly to R2 at <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-dim)' }}>fantasai/labeling/article_labels.json</span>.<br />
              Databricks picks them up the next day to retrain the player-mapping model.
            </div>
            {!loadingLabels && (
              <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
                <div style={{ textAlign: 'center', padding: '10px 20px', background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 6 }}>
                  <div style={{ fontSize: 22, fontWeight: 800, color: 'var(--accent)', fontFamily: 'var(--font-mono)' }}>{labelByUrl.size}</div>
                  <div style={{ fontSize: 10, color: 'var(--text-faint)', marginTop: 2 }}>total labeled</div>
                </div>
                <div style={{ textAlign: 'center', padding: '10px 20px', background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 6 }}>
                  <div style={{ fontSize: 22, fontWeight: 800, color: '#4ade80', fontFamily: 'var(--font-mono)' }}>{myLabeledCount}</div>
                  <div style={{ fontSize: 10, color: 'var(--text-faint)', marginTop: 2 }}>labeled by me</div>
                </div>
                <div style={{ textAlign: 'center', padding: '10px 20px', background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 6 }}>
                  <div style={{ fontSize: 22, fontWeight: 800, color: '#ff9800', fontFamily: 'var(--font-mono)' }}>{unlabeledCount}</div>
                  <div style={{ fontSize: 10, color: 'var(--text-faint)', marginTop: 2 }}>remaining</div>
                </div>
              </div>
            )}
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {/* Already-labeled banner */}
            {labelByUrl.has(selected.article_url) && (() => {
              const l = labelByUrl.get(selected.article_url);
              const lAgo = l.labeled_at ? fmtRelative(l.labeled_at) : null;
              const isMineLabel = !myId || l.labeled_by === myId || l.labeled_by === 'commissioner';
              return (
                <div style={{ padding: '8px 12px', background: isMineLabel ? 'rgba(74,222,128,.08)' : 'rgba(78,168,255,.08)', border: `1px solid ${isMineLabel ? 'rgba(74,222,128,.3)' : 'rgba(78,168,255,.3)'}`, borderRadius: 5, fontSize: 11 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <span style={{ fontWeight: 700, color: isMineLabel ? '#4ade80' : '#4ea8ff' }}>
                      {isMineLabel ? '✓ You labeled this' : '✓ Labeled'}
                    </span>
                    {(() => {
                      const lbRaw = l.labeled_by;
                      const lbId  = lbRaw === 'commissioner' ? (myId ? parseInt(myId) : null) : (lbRaw ? parseInt(lbRaw) : null);
                      const lbTeam = lbId ? findTeam(lbId) : null;
                      return lbTeam ? (
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                          <TeamLogoBadge team={lbTeam} size={18} />
                          <span style={{ fontWeight: 600, color: 'var(--text-dim)' }}>{lbTeam.owner || lbTeam.name}</span>
                        </span>
                      ) : null;
                    })()}
                    {l.relevance_score != null && (
                      <span style={{ fontSize: 10, fontFamily: 'var(--font-mono)', fontWeight: 700, color: '#fbbf24', background: 'rgba(251,191,36,.1)', border: '1px solid rgba(251,191,36,.25)', borderRadius: 3, padding: '1px 6px' }}>★ {l.relevance_score}/5</span>
                    )}
                    {lAgo && <span style={{ color: 'var(--text-faint)', fontSize: 10 }}>{lAgo}</span>}
                  </div>
                  {l.notes && <div style={{ color: 'var(--text-faint)', marginTop: 4, fontStyle: 'italic' }}>"{l.notes}"</div>}
                  <div style={{ color: 'var(--text-faint)', marginTop: 2 }}>Form pre-filled — update and re-save to change it</div>
                </div>
              );
            })()}

            {/* Article preview */}
            <div style={{ padding: '12px 14px', background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 6 }}>
              <div style={{ fontSize: 13, fontWeight: 700, lineHeight: 1.4, marginBottom: 6 }}>{selected.headline}</div>
              <div style={{ display: 'flex', gap: 10, alignItems: 'center', fontSize: 11, color: 'var(--text-faint)' }}>
                <span>{selected.publisher}</span>
                {selected.published_at && <span>· {fmtRelative(selected.published_at)}</span>}
              </div>
              {selected.description && <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 8, lineHeight: 1.5 }}>{selected.description.slice(0, 200)}{selected.description.length > 200 ? '…' : ''}</div>}
              {selected.article_url && <a href={selected.article_url} target="_blank" rel="noopener noreferrer" style={{ display: 'block', marginTop: 6, fontSize: 11, color: '#4ea8ff', textDecoration: 'none' }}>Open article ↗</a>}
            </div>

            {/* Auto-detect hint */}
            {!labelByUrl.has(selected.article_url) && detectDST(selected.headline || '') && (
              <div style={{ padding: '6px 12px', background: 'rgba(198,255,58,.08)', border: '1px solid rgba(198,255,58,.2)', borderRadius: 4, fontSize: 11, color: 'var(--accent)' }}>
                ⚡ Auto-detected as DST — verify team below
              </div>
            )}

            {/* Label form */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-dim)' }}>
                Player Name / Entity
                <input
                  value={form.labeled_player_name}
                  onChange={e => setForm(f => ({ ...f, labeled_player_name: e.target.value }))}
                  placeholder="e.g. Bills D/ST  or  Patrick Mahomes"
                  style={{ display: 'block', width: '100%', marginTop: 4, fontSize: 12, background: 'var(--panel-2)', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: 4, padding: '6px 10px', boxSizing: 'border-box' }}
                />
              </label>

              <div style={{ display: 'flex', gap: 10 }}>
                <label style={{ flex: 1, fontSize: 11, fontWeight: 700, color: 'var(--text-dim)' }}>
                  Position *
                  <select value={form.labeled_position} onChange={e => setForm(f => ({ ...f, labeled_position: e.target.value }))}
                    style={{ display: 'block', width: '100%', marginTop: 4, fontSize: 12, background: 'var(--panel-2)', color: 'var(--text)', border: `1px solid ${!form.labeled_position ? 'rgba(255,80,80,.5)' : 'var(--border)'}`, borderRadius: 4, padding: '6px 8px' }}
                  >
                    <option value="">-- select --</option>
                    {['QB', 'RB', 'WR', 'TE', 'K', 'DST'].map(p => <option key={p} value={p}>{p}</option>)}
                  </select>
                </label>
                <label style={{ flex: 1, fontSize: 11, fontWeight: 700, color: 'var(--text-dim)' }}>
                  Team
                  <select value={form.labeled_team} onChange={e => setForm(f => ({ ...f, labeled_team: e.target.value }))}
                    style={{ display: 'block', width: '100%', marginTop: 4, fontSize: 12, background: 'var(--panel-2)', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: 4, padding: '6px 8px' }}
                  >
                    <option value="">-- none --</option>
                    {NFL_TEAMS_FULL.map(t => <option key={t.abbr} value={t.abbr}>{t.abbr} — {t.city} {t.name}</option>)}
                  </select>
                </label>
              </div>

              <div style={{ display: 'flex', gap: 10 }}>
                <label style={{ flex: 1, fontSize: 11, fontWeight: 700, color: 'var(--text-dim)' }}>
                  Impact Category
                  <select value={form.impact_category} onChange={e => setForm(f => ({ ...f, impact_category: e.target.value }))}
                    style={{ display: 'block', width: '100%', marginTop: 4, fontSize: 12, background: 'var(--panel-2)', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: 4, padding: '6px 8px' }}
                  >
                    {['analysis', 'injury', 'transaction', 'performance', 'other'].map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                </label>
                <label style={{ flex: 1, fontSize: 11, fontWeight: 700, color: 'var(--text-dim)' }}>
                  Direction
                  <select value={form.impact_direction} onChange={e => setForm(f => ({ ...f, impact_direction: e.target.value }))}
                    style={{ display: 'block', width: '100%', marginTop: 4, fontSize: 12, background: 'var(--panel-2)', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: 4, padding: '6px 8px' }}
                  >
                    {['positive', 'negative', 'neutral'].map(d => <option key={d} value={d}>{d}</option>)}
                  </select>
                </label>
              </div>

              <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-dim)' }}>
                Relevance Score (1–5)
                <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
                  {[1, 2, 3, 4, 5].map(n => (
                    <button key={n} onClick={() => setForm(f => ({ ...f, relevance_score: n }))} style={{
                      width: 36, height: 36, borderRadius: 4, border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 700,
                      background: form.relevance_score === n ? 'var(--accent)' : 'var(--panel-3)',
                      color: form.relevance_score === n ? '#0a1300' : 'var(--text-faint)',
                    }}>{n}</button>
                  ))}
                </div>
              </label>

              <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-dim)' }}>
                Notes
                <textarea value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
                  placeholder="Why this label is correct, edge cases, etc."
                  rows={3}
                  style={{ display: 'block', width: '100%', marginTop: 4, fontSize: 12, background: 'var(--panel-2)', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: 4, padding: '6px 10px', boxSizing: 'border-box', resize: 'vertical', fontFamily: 'inherit' }}
                />
              </label>

              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 4, flexWrap: 'wrap' }}>
                <button onClick={submitLabel} disabled={saving || !form.labeled_position} style={{
                  padding: '8px 20px', borderRadius: 5, border: 'none',
                  cursor: saving || !form.labeled_position ? 'not-allowed' : 'pointer',
                  background: saving || !form.labeled_position ? 'var(--panel-3)' : 'var(--accent)',
                  color: saving || !form.labeled_position ? 'var(--text-faint)' : '#0a1300',
                  fontWeight: 700, fontSize: 13,
                }}>
                  {saving ? 'Saving…' : labelByUrl.has(selected.article_url) ? '↻ Update Label' : '✓ Save Label'}
                </button>
                <button onClick={() => { setSelected(null); setForm(BLANK_FORM); setSaveMsg(null); }} style={{ fontSize: 12, background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-faint)' }}>
                  Cancel
                </button>
                {saveMsg && (
                  <span style={{ fontSize: 12, fontWeight: 600, color: saveMsg.ok ? 'var(--good)' : 'var(--danger)' }}>
                    {saveMsg.ok ? '✓ ' : '✗ '}{saveMsg.text}
                  </span>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

