// ============================================================
// FantasAI CBS Worker
// Cloudflare Worker that proxies your CBS Sports fantasy league.
// Holds your CBS session cookie as a secret and exposes JSON
// endpoints the FantasAI Football app can call.
//
// Deploy: see README.md
// ============================================================

const CBS_BASE = "https://atotauleague.football.cbssports.com";

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;

    // CORS preflight
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders(env, request) });
    }

    // Route
    try {
      const handler = routes[path];
      if (!handler) {
        return json({ error: "Not found", path }, 404, env, request);
      }
      // Optional shared-secret check — push subscribe/unsubscribe are open (public)
      const NO_AUTH = new Set(['/api/health', '/api/v1/push/subscribe', '/api/v1/push/unsubscribe']);
      if (env.FANTASAI_KEY && !NO_AUTH.has(path)) {
        const key = request.headers.get("X-FantasAI-Key");
        if (key !== env.FANTASAI_KEY) {
          return json({ error: "Unauthorized" }, 401, env, request);
        }
      }
      const result = await handler(request, env, url);
      // Handlers may return a raw Response (for custom status codes)
      if (result instanceof Response) return result;
      return json(result, 200, env, request);
    } catch (err) {
      console.error(err.stack || err);
      return json({ error: err.message, stack: err.stack }, 500, env, request);
    }
  },
};

// ============================================================
// Route table
// ============================================================
const routes = {
  "/api/health":              health,
  "/api/cbs/league":          getLeague,
  "/api/cbs/teams":           getTeams,
  "/api/cbs/rosters":         getRosters,
  "/api/cbs/rankings":        getRankings,
  "/api/cbs/players":         getPlayers,
  "/api/cbs/draft":           getDraft,
  "/api/cbs/remote-draft":    getRemoteDraft,
  "/api/cbs/transactions":    getTransactions,
  "/api/cbs/scoring":         getScoring,
  "/api/cbs/sleeper-players": getSleeperPlayers,
  "/api/debug/fetch":         debugFetch,
  "/api/v1/twitter/beat":     getBeatWriterNews,
  "/api/v1/push/subscribe":   handleSubscribe,
  "/api/v1/push/unsubscribe": handleUnsubscribe,
  "/api/v1/push/send":        handleSendPush,
};

// ── Beat writer handles ────────────────────────────────────────────────────────
const BEAT_WRITERS = [
  { handle: 'AdamSchefter',    name: 'Adam Schefter',       category: 'national' },
  { handle: 'RapSheet',        name: 'Ian Rapoport',        category: 'national' },
  { handle: 'TomPelissero',    name: 'Tom Pelissero',       category: 'national' },
  { handle: 'MikeGarafolo',    name: 'Mike Garafolo',       category: 'national' },
  { handle: 'Schultz_Report',  name: 'Jordan Schultz',      category: 'national' },
  { handle: 'MySportsUpdate',  name: 'Ari Meirov',          category: 'national' },
  { handle: 'DMRussini',       name: 'Dianna Russini',      category: 'national' },
  { handle: 'AlbertBreer',     name: 'Albert Breer',        category: 'national' },
  { handle: 'FieldYates',      name: 'Field Yates',         category: 'national' },
  { handle: 'JFowlerESPN',     name: 'Jeremy Fowler',       category: 'national' },
  { handle: 'MatthewBerryTMR', name: 'Matthew Berry',       category: 'fantasy' },
  { handle: 'Ihartitz',        name: 'Ian Hartitz',         category: 'fantasy' },
  { handle: 'dwainmcfarland',  name: 'Dwain McFarland',     category: 'fantasy' },
  { handle: 'LateRoundQB',     name: 'JJ Zachariason',      category: 'fantasy' },
  { handle: 'Pat_Thorman',     name: 'Pat Thorman',         category: 'fantasy' },
  { handle: 'SigmundBloom',    name: 'Sigmund Bloom',       category: 'fantasy' },
  { handle: 'LordReebs',       name: 'Rich Hribar',         category: 'fantasy' },
  { handle: 'ScottBarrettDFB', name: 'Scott Barrett',       category: 'fantasy' },
  { handle: 'jonmachota',      name: 'Jon Machota',         category: 'beat', team: 'DAL' },
  { handle: 'clarencehilljr',  name: 'Clarence Hill Jr.',   category: 'beat', team: 'DAL' },
  { handle: 'SlaterNFL',       name: 'Jane Slater',         category: 'beat', team: 'DAL' },
  { handle: 'ByNateTaylor',    name: 'Nate Taylor',         category: 'beat', team: 'KC'  },
  { handle: 'mattderrick',     name: 'Matt Derrick',        category: 'beat', team: 'KC'  },
  { handle: 'JoeBuscaglia',    name: 'Joe Buscaglia',       category: 'beat', team: 'BUF' },
  { handle: 'SalSports',       name: 'Sal Capaccio',        category: 'beat', team: 'BUF' },
  { handle: 'ZBerm',           name: 'Zach Berman',         category: 'beat', team: 'PHI' },
  { handle: 'JimmyKempski',    name: 'Jimmy Kempski',       category: 'beat', team: 'PHI' },
  { handle: 'mattbarrows',     name: 'Matt Barrows',        category: 'beat', team: 'SF'  },
  { handle: 'LombardiHimself', name: 'David Lombardi',      category: 'beat', team: 'SF'  },
  { handle: 'davebirkett',     name: 'Dave Birkett',        category: 'beat', team: 'DET' },
  { handle: 'colton_pouncy',   name: 'Colton Pouncy',       category: 'beat', team: 'DET' },
];

// Nitter instances tried in order — first one to respond wins for the whole batch
const NITTER_INSTANCES = [
  'https://nitter.privacydev.net',
  'https://nitter.poast.org',
  'https://nitter.net',
  'https://nitter.1d4.us',
];

// ============================================================
// Handlers
// ============================================================

async function health(request, env) {
  return {
    ok: true,
    hasCookie: !!env.CBS_COOKIE,
    requiresKey: !!env.FANTASAI_KEY,
    base: CBS_BASE,
    routes: Object.keys(routes),
    cacheStats: await getCacheStats(env),
  };
}

async function getLeague(req, env) {
  const html = await cbsFetch(env, "/", req);
  const league = parseLeague(html);
  return { source: "cbs", fetchedAt: new Date().toISOString(), league };
}

async function getTeams(req, env) {
  const html = await cbsFetch(env, "/standings", req);
  const teams = await parseTeams(html);
  return { source: "cbs", fetchedAt: new Date().toISOString(), teams };
}

async function getRosters(req, env) {
  const teams = (await getTeams(req, env)).teams;
  const rosters = {};
  for (const t of teams) {
    const html = await cbsFetch(env, `/teams/${t.id}`, req);
    rosters[t.id] = await parseRoster(html);
  }
  return { source: "cbs", fetchedAt: new Date().toISOString(), rosters };
}

async function getRankings(req, env, url) {
  const pos = url.searchParams.get("pos") || "ALL";
  const html = await cbsFetch(env, "/players/rankings/top200/season/non-ppr", req);
  const all = await parseRankings(html);
  const rankings = pos.toUpperCase() === "ALL" ? all : all.filter(p => p.pos.toUpperCase() === pos.toUpperCase());
  return {
    source: "cbs",
    fetchedAt: new Date().toISOString(),
    position: pos,
    count: rankings.length,
    rankings,
  };
}

async function getPlayers(req, env) {
  const html = await cbsFetch(env, '/players/all/all?source_id=cbs&print_rows=9999', req);
  const players = parsePlayers(html);
  return { source: 'cbs', fetchedAt: new Date().toISOString(), count: players.length, players };
}

// Proxy Sleeper's full player map server-side (no CORS) and filter to active fantasy-relevant players.
// Cached for 1 hour in CF edge cache — response is ~5 MB raw but filters down to ~1500 players.
async function getSleeperPlayers(req, env) {
  const cacheKey = 'sleeper-players-v1';
  if (env.CACHE) {
    const cached = await env.CACHE.get(cacheKey);
    if (cached) return JSON.parse(cached);
  }

  const res = await fetch('https://api.sleeper.app/v1/players/nfl', {
    headers: { 'User-Agent': 'FantasAI/1.0' },
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) throw new Error(`Sleeper returned ${res.status}`);
  const map = await res.json();

  const VALID_POS = new Set(['QB', 'RB', 'WR', 'TE', 'K', 'DEF']);
  const players = [];
  for (const [id, p] of Object.entries(map)) {
    if (!p.team || p.status === 'Inactive') continue;
    const pos = p.position;
    if (!VALID_POS.has(pos)) continue;
    players.push({
      player_id: id,
      full_name: pos === 'DEF' ? `${p.team} D/ST` : (p.full_name || `${p.first_name || ''} ${p.last_name || ''}`.trim()),
      position: pos === 'DEF' ? 'DST' : pos,
      fantasy_positions: p.fantasy_positions,
      team: p.team,
      status: p.status,
      injury_status: p.injury_status,
      age: p.age,
      number: p.number,
      search_rank: p.search_rank,
      adp: p.adp,
      bye_week: p.bye_week,
      headshot_url: p.headshot_url,
      is_draftable: p.status !== 'Inactive',
    });
  }

  const result = { source: 'sleeper-proxy', fetchedAt: new Date().toISOString(), count: players.length, players };

  if (env.CACHE) {
    await env.CACHE.put(cacheKey, JSON.stringify(result), { expirationTtl: 3600 });
  }

  return result;
}

// Parse the full player list page — returns { id, name, pos, team, status, newsTitle, news }.
//
// Multi-strategy: uses playerpage link positions as row delimiters so it handles
// both <tr class="row1"> table layouts and card/div layouts. For each player it
// extracts the news HEADLINE separately from the BODY so News.jsx can display them
// as a proper article (title + full paragraph), not a single concatenated blob.
function parsePlayers(html) {
  const players = [];

  // Convert an HTML fragment to structured lines, preserving block-level boundaries.
  function htmlToLines(fragment) {
    return fragment
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(?:p|div|h[1-6]|li|td|th|span|section)[^>]*>/gi, '\n')
      .replace(/<[^>]+>/g, '')
      .replace(/&nbsp;/g, ' ')
      .replace(/&#\d+;/g, ' ')
      .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
      .replace(/[ \t]+/g, ' ')
      .split('\n')
      .map(l => l.trim())
      .filter(Boolean);
  }

  // Find every unique playerpage link (first occurrence wins when a page has
  // duplicate links for the same player, e.g. desktop + mobile).
  const seenIds   = new Set();
  const linkRe    = /href='\/players\/playerpage\/(\d+)'/g;
  const linkPositions = [];
  let lm;
  while ((lm = linkRe.exec(html)) !== null) {
    if (!seenIds.has(lm[1])) {
      seenIds.add(lm[1]);
      linkPositions.push({ idx: lm.index, id: lm[1] });
    }
  }

  for (const { idx, id } of linkPositions) {
    // Grab the enclosing <tr> … </tr> — this contains all columns for the player.
    const trStart = html.lastIndexOf('<tr', idx);
    const trEnd   = html.indexOf('</tr>', idx);
    if (trStart < 0 || trEnd < 0) continue;
    const rowHtml = html.slice(trStart, trEnd + 5);

    // Player name from the link text.
    const nameMatch = rowHtml.match(/href='\/players\/playerpage\/\d+'[^>]*>([^<]{1,60})<\/a>/);
    if (!nameMatch) continue;
    const name = nameMatch[1].trim();
    if (!name) continue;

    // pos + team from aria-label (most reliable CBS source for pos/team).
    let pos = '', team = '';
    const ariaMatch = rowHtml.match(/aria-label=['"]([^'"]{3,80})['"]/);
    if (ariaMatch) {
      const label = ariaMatch[1]
        .replace(/&#\d+;/g, ' ').replace(/[•·|]/g, ' ').trim();
      const parts = label.split(/\s+/).filter(Boolean);
      team = parts.at(-1) || '';
      pos  = parts.at(-2) || '';
    }

    // Iterate <td> cells, skip the player-info cell (contains the playerLink).
    const cells = [...rowHtml.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)];

    let newsTitle = null;
    let newsBody  = null;
    let status    = null;

    for (const cellMatch of cells) {
      const cellHtml = cellMatch[1];

      // Skip the player-name cell.
      if (cellHtml.includes('/players/playerpage/')) continue;

      const lines    = htmlToLines(cellHtml);
      const fullText = lines.join(' ').trim();

      // ── Status detection (short keyword cells) ──────────────────────────
      if (!status && fullText.length < 35) {
        if (/^(Active|Out|Questionable|Doubtful|IR\b|Suspended|PUP|NFI|Limited|DNP)/i.test(fullText)) {
          status = fullText;
          continue;
        }
      }

      // ── News cell: must be at least 60 chars ────────────────────────────
      if (fullText.length < 60) continue;

      // ── Title extraction — four strategies in order ──────────────────────

      // 1. Anchor whose href contains "news", "article", or "story"
      if (!newsTitle) {
        const m = cellHtml.match(/href=['"][^'"]*(?:news|article|story)[^'"]*['"][^>]*>([^<]{20,180})<\/a>/i);
        if (m) newsTitle = m[1].trim();
      }

      // 2. Element with a news/headline class name
      if (!newsTitle) {
        const m = cellHtml.match(/class=['"][^'"]*(?:title|headline|newsTitle|news-title|article-title)[^'"]*['"][^>]*>([\s\S]*?)<\/[^>]+>/i);
        if (m) {
          const t = m[1].replace(/<[^>]+>/g, '').trim();
          if (t.length >= 20) newsTitle = t;
        }
      }

      // 3. H2/H3/H4 element
      if (!newsTitle) {
        const m = cellHtml.match(/<(?:h2|h3|h4)[^>]*>([\s\S]*?)<\/(?:h2|h3|h4)>/i);
        if (m) {
          const t = m[1].replace(/<[^>]+>/g, '').trim();
          if (t.length >= 20) newsTitle = t;
        }
      }

      // 4. Scan structured lines for a headline-shaped sentence
      //    - starts with capital letter and contains lowercase (not ALL-CAPS labels)
      //    - 20–200 chars
      //    - not "by Source", not a timestamp, not ownership/status boilerplate
      if (!newsTitle) {
        const skipRe = /^(by |from |via |\d+\s*(hr|min|day)|Free Agent|Active$|Out$|Questionable$|Doubtful$|Owned by )/i;
        for (const line of lines) {
          if (line.length < 20 || line.length > 200) continue;
          if (skipRe.test(line)) continue;
          if (/^[A-Z]/.test(line) && /[a-z]/.test(line)) {
            newsTitle = line;
            break;
          }
        }
      }

      // ── Body extraction ──────────────────────────────────────────────────
      // Strip the title line, attribution ("by RotoWire | RotoWire"), and
      // age ("5 hrs ago") from the remaining lines to get clean body text.
      const attrRe   = /^by\s+\S|\d+\s*(?:hr|min|day)s?\s+ago/i;
      const titleIdx = newsTitle
        ? lines.findIndex(l => l.includes(newsTitle.slice(0, Math.min(30, newsTitle.length))))
        : -1;

      const bodyLines = lines
        .slice(Math.max(0, titleIdx + 1))
        .filter(l => !attrRe.test(l) && l !== newsTitle && l.length > 15);

      if (bodyLines.length > 0) {
        newsBody = bodyLines.join(' ').trim().slice(0, 1000);
      } else {
        // Fallback: strip known noise from full text
        let body = fullText;
        if (newsTitle) body = body.replace(newsTitle, '').trim();
        body = body
          .replace(/by\s+\S[^|·\n]{0,60}[\|·][^\n]{0,60}\s*/gi, '')
          .replace(/\d+\s*(?:hr|min|day)s?\s+ago\s*/gi, '')
          .replace(/(?:Free Agent|Active|Out|Questionable|Doubtful)\s*/gi, '')
          .trim();
        if (body.length > 15) newsBody = body.slice(0, 1000);
      }

      if (newsTitle || newsBody) break; // done with this player
    }

    if (!newsTitle && !newsBody) continue; // no news — skip

    players.push({ id, name, pos, team, status, newsTitle: newsTitle || null, news: newsBody || null });
  }

  return players;
}

// CBS's real draft-results URL is /draft/results/{year}:Pre-season:Tau%20League%20Draft/
// — NOT /draft/results?year={year}, which silently serves a static/empty template
// (same 168 blank rows, same team order, every year) instead of a 404. Confirmed
// live 2026-08-24 for 2021-2025 with the query-param form before finding this.
const DRAFT_EVENT_NAME = "Pre-season:Tau League Draft";

async function getDraft(req, env, url) {
  const year = url.searchParams.get("year") || new Date().getFullYear();
  const path = `/draft/results/${year}:${encodeURIComponent(DRAFT_EVENT_NAME)}/`;
  const html = await cbsFetch(env, path, req);
  const picks = await parseDraft(html);
  const teams = parseDraftTeamIds(html);
  return {
    source: "cbs",
    fetchedAt: new Date().toISOString(),
    year: parseInt(year),
    picks,
    teams, // { cbsTeamId: teamNameAtDraftTime } — use cbsTeamId to match across renames
  };
}

// Fetch and parse an arbitrary cbssports.com draft page (e.g. a public mock
// draft lobby, which lives on its own mockdraftN-XXXXXXX.football.cbssports.com
// subdomain, not the league's own domain) using the same cookie-based auth and
// parsing as the league's own draft-results page. Restricted to *.cbssports.com
// hosts only — this is not a general-purpose URL proxy.
async function getRemoteDraft(req, env, url) {
  const target = url.searchParams.get("url") || "";
  let parsed;
  try { parsed = new URL(target); } catch { throw new Error("Invalid or missing url parameter"); }
  if (!/(^|\.)cbssports\.com$/i.test(parsed.hostname)) {
    throw new Error("Only cbssports.com URLs are supported");
  }

  const cookie = (req && req.headers.get("X-CBS-Cookie")) || env.CBS_COOKIE;
  if (!cookie) {
    throw new Error("No CBS session cookie provided (connect your CBS cookie first)");
  }

  const res = await fetch(parsed.toString(), {
    headers: {
      "Cookie": cookie,
      "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9",
      "Cache-Control": "no-cache",
    },
    redirect: "follow",
  });

  if (res.status === 401 || res.status === 403) {
    throw new Error(`CBS auth failed (${res.status}). Session cookie likely expired — refresh it.`);
  }
  if (!res.ok) {
    throw new Error(`CBS returned ${res.status} for ${parsed.pathname}`);
  }

  const html = await res.text();
  if (html.includes("/login") && html.includes("password") && html.length < 30000) {
    throw new Error("CBS returned the login page — session cookie expired, or doesn't have access to this room.");
  }

  const picks = await parseDraft(html);
  const teams = parseDraftTeamIds(html);
  return {
    source: "cbs",
    url: parsed.toString(),
    fetchedAt: new Date().toISOString(),
    htmlLength: html.length,
    picks,
    teams,
    note: picks.length === 0
      ? "No picks parsed from this page — confirmed live 2026-08-24 that CBS's live mock draft rooms (mockdraftN-*.football.cbssports.com) render their board entirely client-side over a websocket, with no server-rendered pick data at all, so this can't see it. Completed league drafts (/api/v1/draft?year=N) don't have this problem — those pages are plain server-rendered HTML."
      : undefined,
  };
}

async function getTransactions(req, env) {
  const html = await cbsFetch(env, "/transactions", req);
  const txns = await parseTransactions(html);
  return { source: "cbs", fetchedAt: new Date().toISOString(), transactions: txns };
}

async function getScoring(req, env) {
  const html = await cbsFetch(env, "/league/scoring", req);
  const scoring = parseScoring(html);
  return { source: "cbs", fetchedAt: new Date().toISOString(), scoring };
}

async function debugFetch(req, env, url) {
  const path = url.searchParams.get("path") || "/";
  const html = await cbsFetch(env, path, req);
  return {
    source: "cbs",
    path,
    fetchedAt: new Date().toISOString(),
    length: html.length,
    preview: html.slice(0, 4000),
    full: url.searchParams.get("full") === "1" ? html : "(use &full=1 to see all)",
  };
}

// ============================================================
// CBS fetch — authenticated request with caching
// ============================================================
async function cbsFetch(env, path, request) {
  // Accept a one-time cookie override from the frontend (stored in user's browser)
  // Falls back to the worker secret set via `wrangler secret put CBS_COOKIE`
  const cookie = (request && request.headers.get('X-CBS-Cookie')) || env.CBS_COOKIE;
  if (!cookie) {
    throw new Error("CBS_COOKIE secret not set. Run: wrangler secret put CBS_COOKIE");
  }

  // Try cache first (5 minute TTL for HTML pages)
  const cacheKey = `cbs:${path}`;
  if (env.CACHE) {
    const cached = await env.CACHE.get(cacheKey);
    if (cached) return cached;
  }

  const res = await fetch(CBS_BASE + path, {
    headers: {
      "Cookie": cookie,
      "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9",
      "Cache-Control": "no-cache",
    },
    redirect: "follow",
  });

  if (res.status === 401 || res.status === 403) {
    throw new Error(`CBS auth failed (${res.status}). Session cookie likely expired — refresh it.`);
  }
  if (!res.ok) {
    throw new Error(`CBS returned ${res.status} for ${path}`);
  }

  const html = await res.text();

  // Detect login wall (CBS redirects unauth'd users to login page)
  if (html.includes("/login") && html.includes("password") && html.length < 30000) {
    throw new Error("CBS returned the login page — session cookie expired.");
  }

  // Cache for 5 minutes
  if (env.CACHE) {
    await env.CACHE.put(cacheKey, html, { expirationTtl: 300 });
  }

  return html;
}

// Parse RSS/Atom XML — handles both plain text and CDATA content
function parseRSS(xml) {
  const items = [];
  const itemRe = /<item>([\s\S]*?)<\/item>/gi;
  let m;
  while ((m = itemRe.exec(xml)) !== null) {
    const block = m[1];
    const get = (tag) => {
      const re = new RegExp(`<${tag}[^>]*>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?<\\/${tag}>`, 'i');
      return (re.exec(block)?.[1] || '').trim();
    };
    const rawTitle = get('title');
    const pubDate  = get('pubDate') || get('updated');
    const link     = get('link') || get('guid');
    // Nitter prefixes title with "handle: tweet text" — strip the handle prefix
    const text = rawTitle.replace(/^[^:]+:\s*/, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#39;/g, "'").replace(/&quot;/g, '"').trim();
    if (text && text.length > 10) {
      items.push({ text, publishedAt: pubDate ? new Date(pubDate).toISOString() : null, url: link });
    }
  }
  return items;
}

async function getBeatWriterNews(req, env) {
  const ua = 'Mozilla/5.0 (compatible; FantasAI/1.0; +https://fantasai.net)';

  // Find a working nitter instance by probing the first handle
  let workingInstance = null;
  let probeItems = [];
  const firstWriter = BEAT_WRITERS[0];

  for (const inst of NITTER_INSTANCES) {
    try {
      const res = await fetch(`${inst}/${firstWriter.handle}/rss`, {
        signal: AbortSignal.timeout(5000),
        headers: { 'User-Agent': ua, 'Accept': 'application/rss+xml, application/xml, text/xml' },
      });
      if (res.ok) {
        const xml = await res.text();
        const parsed = parseRSS(xml);
        if (parsed.length > 0) {
          workingInstance = inst;
          probeItems = parsed;
          break;
        }
      }
    } catch {}
  }

  if (!workingInstance) {
    return { source: 'beat-writers', fetchedAt: new Date().toISOString(), error: 'All nitter instances unavailable', items: [] };
  }

  // Fetch remaining writers in parallel from the working instance
  const remaining = BEAT_WRITERS.slice(1);
  const fetched = await Promise.allSettled(
    remaining.map(async writer => {
      try {
        const res = await fetch(`${workingInstance}/${writer.handle}/rss`, {
          signal: AbortSignal.timeout(8000),
          headers: { 'User-Agent': ua, 'Accept': 'application/rss+xml, application/xml, text/xml' },
        });
        if (!res.ok) return null;
        const xml = await res.text();
        return { writer, items: parseRSS(xml) };
      } catch { return null; }
    })
  );

  const allItems = [
    ...probeItems.slice(0, 20).map(i => ({ ...i, handle: firstWriter.handle, reporter: firstWriter.name, category: firstWriter.category, team: firstWriter.team || null })),
  ];

  for (const f of fetched) {
    if (f.status !== 'fulfilled' || !f.value) continue;
    const { writer, items } = f.value;
    for (const item of items.slice(0, 20)) {
      allItems.push({ ...item, handle: writer.handle, reporter: writer.name, category: writer.category, team: writer.team || null });
    }
  }

  // Sort newest-first and cap at 500 total items
  allItems.sort((a, b) => {
    const ta = a.publishedAt ? new Date(a.publishedAt).getTime() : 0;
    const tb = b.publishedAt ? new Date(b.publishedAt).getTime() : 0;
    return tb - ta;
  });

  return {
    source:      'beat-writers',
    fetchedAt:   new Date().toISOString(),
    instance:    workingInstance,
    writerCount: BEAT_WRITERS.length,
    count:       allItems.length,
    items:       allItems.slice(0, 500),
  };
}

// ============================================================
// Web Push — VAPID JWT + RFC 8291 payload encryption
// ============================================================

function b64url(input) {
  let bytes;
  if (typeof input === 'string') bytes = new TextEncoder().encode(input);
  else if (input instanceof ArrayBuffer) bytes = new Uint8Array(input);
  else bytes = input;
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

function fromB64url(str) {
  const p = str.replace(/-/g, '+').replace(/_/g, '/');
  const padded = p + '='.repeat((4 - p.length % 4) % 4);
  const raw = atob(padded);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

function joinBytes(...parts) {
  const u8s = parts.map(p =>
    typeof p === 'string' ? new TextEncoder().encode(p) :
    p instanceof ArrayBuffer ? new Uint8Array(p) :
    Array.isArray(p) ? new Uint8Array(p) : p
  );
  const total = u8s.reduce((n, a) => n + a.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const a of u8s) { out.set(a, off); off += a.length; }
  return out;
}

async function hmacSha256(keyBytes, data) {
  const key = await crypto.subtle.importKey(
    'raw', keyBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, data));
}

async function hkdf(salt, ikm, info, len) {
  const prk = await hmacSha256(salt, ikm);
  const infoBytes = typeof info === 'string' ? new TextEncoder().encode(info) : info;
  const blocks = [];
  let prev = new Uint8Array(0);
  while (blocks.reduce((n, b) => n + b.length, 0) < len) {
    const counter = new Uint8Array([blocks.length + 1]);
    prev = await hmacSha256(prk, joinBytes(prev, infoBytes, counter));
    blocks.push(prev);
  }
  return joinBytes(...blocks).slice(0, len);
}

async function vapidJWT(endpoint, privJwk) {
  const origin = new URL(endpoint).origin;
  const now = Math.floor(Date.now() / 1000);
  const header  = b64url(JSON.stringify({ typ: 'JWT', alg: 'ES256' }));
  const payload = b64url(JSON.stringify({ aud: origin, exp: now + 43200, sub: 'mailto:kingoffrisco@yahoo.com' }));
  const sigInput = `${header}.${payload}`;
  const privKey = await crypto.subtle.importKey(
    'jwk', privJwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']
  );
  const sig = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' }, privKey, new TextEncoder().encode(sigInput)
  );
  return `${sigInput}.${b64url(sig)}`;
}

async function encryptWebPush(sub, payloadStr) {
  const p256dh = fromB64url(sub.keys.p256dh);
  const auth   = fromB64url(sub.keys.auth);

  const recipientKey = await crypto.subtle.importKey(
    'raw', p256dh, { name: 'ECDH', namedCurve: 'P-256' }, true, []
  );
  const ephemeral = await crypto.subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']
  );
  const senderPubRaw = new Uint8Array(await crypto.subtle.exportKey('raw', ephemeral.publicKey));
  const sharedSecret = new Uint8Array(
    await crypto.subtle.deriveBits({ name: 'ECDH', public: recipientKey }, ephemeral.privateKey, 256)
  );

  const salt = crypto.getRandomValues(new Uint8Array(16));

  // RFC 8291 §3.3 — key derivation
  const ikm   = await hkdf(auth, sharedSecret, joinBytes('WebPush: info\x00', p256dh, senderPubRaw), 32);
  const cek   = await hkdf(salt, ikm, 'Content-Encoding: aes128gcm\x00', 16);
  const nonce = await hkdf(salt, ikm, 'Content-Encoding: nonce\x00', 12);

  const cekKey = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  // Payload + delimiter byte 0x02 (RFC 8291 record padding)
  const record = joinBytes(new TextEncoder().encode(payloadStr), [2]);
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, cekKey, record)
  );

  // aes128gcm header: salt(16) + rs(4 BE) + idlen(1) + keyid(senderPubRaw)
  const hdr = new Uint8Array(21 + senderPubRaw.length);
  hdr.set(salt, 0);
  new DataView(hdr.buffer).setUint32(16, 4096, false);
  hdr[20] = senderPubRaw.length;
  hdr.set(senderPubRaw, 21);
  return joinBytes(hdr, ciphertext);
}

async function sendOnePush(sub, notification, env) {
  const privJwk = JSON.parse(env.VAPID_PRIVATE_KEY);
  const jwt  = await vapidJWT(sub.endpoint, privJwk);
  const body = await encryptWebPush(sub, JSON.stringify(notification));
  const resp = await fetch(sub.endpoint, {
    method: 'POST',
    headers: {
      'Authorization': `vapid t=${jwt}, k=${env.VAPID_PUBLIC_KEY}`,
      'Content-Type': 'application/octet-stream',
      'Content-Encoding': 'aes128gcm',
      'TTL': '86400',
    },
    body,
  });
  return resp.status;
}

async function subKey(endpoint) {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(endpoint));
  return 'sub:' + Array.from(new Uint8Array(hash)).slice(0, 12)
    .map(b => b.toString(16).padStart(2, '0')).join('');
}

// ── Push handlers ─────────────────────────────────────────────────────────────

async function handleSubscribe(request, env) {
  if (request.method !== 'POST') return { error: 'POST required' };
  let sub;
  try { sub = await request.json(); } catch { return { error: 'Invalid JSON' }; }
  if (!sub?.endpoint || !sub?.keys?.p256dh || !sub?.keys?.auth)
    return { error: 'Invalid subscription object' };
  if (env.PUSH_SUBS) {
    const key = await subKey(sub.endpoint);
    await env.PUSH_SUBS.put(key, JSON.stringify(sub));
  }
  return { ok: true };
}

async function handleUnsubscribe(request, env) {
  if (request.method !== 'POST') return { error: 'POST required' };
  let body;
  try { body = await request.json(); } catch { return { error: 'Invalid JSON' }; }
  if (env.PUSH_SUBS && body?.endpoint) {
    const key = await subKey(body.endpoint);
    await env.PUSH_SUBS.delete(key);
  }
  return { ok: true };
}

async function handleSendPush(request, env, url, rawRequest) {
  if (request.method !== 'POST') return { error: 'POST required' };
  // Always require commish key for sending
  const k = request.headers.get('X-FantasAI-Key');
  if (!env.FANTASAI_KEY || k !== env.FANTASAI_KEY)
    return json({ error: 'Unauthorized' }, 401, env, request);
  if (!env.VAPID_PRIVATE_KEY || !env.VAPID_PUBLIC_KEY)
    return { error: 'VAPID secrets not configured — run: wrangler secret put VAPID_PRIVATE_KEY' };
  if (!env.PUSH_SUBS)
    return { error: 'PUSH_SUBS KV not bound — see wrangler.toml' };

  let notification;
  try { notification = await request.json(); } catch { return { error: 'Invalid JSON' }; }

  const list = await env.PUSH_SUBS.list({ prefix: 'sub:' });
  const subs = (await Promise.all(
    list.keys.map(k => env.PUSH_SUBS.get(k.name).then(v => v ? JSON.parse(v) : null))
  )).filter(Boolean);

  const results = await Promise.allSettled(
    subs.map(async sub => {
      const status = await sendOnePush(sub, notification, env);
      if (status === 410 || status === 404) {
        const key = await subKey(sub.endpoint);
        await env.PUSH_SUBS.delete(key);
      }
      return status;
    })
  );

  return {
    ok: true,
    sent: subs.length,
    statuses: results.map(r => r.status === 'fulfilled' ? r.value : `err:${r.reason?.message}`),
  };
}

async function getCacheStats(env) {
  if (!env.CACHE) return { configured: false };
  return { configured: true, note: "KV-backed, 5min TTL per path" };
}

// ============================================================
// Parsers — HTMLRewriter-based
//
// IMPORTANT: The selectors below are EDUCATED GUESSES.
// CBS Sports doesn't publish their fantasy HTML schema.
// Use /api/debug/fetch?path=/ to see what CBS actually returns,
// then update these selectors to match real elements.
//
// HTMLRewriter docs:
//   https://developers.cloudflare.com/workers/runtime-apis/html-rewriter/
// ============================================================

async function parseHTML(html, handlers) {
  const out = {};
  let rewriter = new HTMLRewriter();
  for (const { selector, on } of handlers) {
    rewriter = rewriter.on(selector, on(out));
  }
  await rewriter.transform(new Response(html)).text();
  return out;
}

function parseLeague(html) {
  // Try to find league name + season from page metadata
  const nameMatch = html.match(/<title>([^<]+)<\/title>/);
  const seasonMatch = html.match(/(\d{4})\s*season/i) || html.match(/year[^>]*>(\d{4})</i);
  const sizeMatch = html.match(/(\d+)[\s-]*team/i);
  const scoringMatch = html.match(/(Standard|PPR|Half PPR|Half-PPR|0\.5 PPR)/i);

  return {
    name: nameMatch ? nameMatch[1].split(/\s*[-|]\s*CBS/i)[0].trim() : "Atotau League",
    season: seasonMatch ? parseInt(seasonMatch[1]) : new Date().getFullYear(),
    leagueSize: sizeMatch ? parseInt(sizeMatch[1]) : 12,
    scoring: scoringMatch ? (/half/i.test(scoringMatch[1]) ? "Half PPR" : scoringMatch[1].toUpperCase()) : "Unknown",
    leagueId: "atotauleague",
    leagueUrl: CBS_BASE.replace(/^https?:\/\//, ""),
  };
}

// Parse the standings/teams page.
// CBS HTML: <tr id="N" class="row1|row2|bgFan">
//   <td><img><a href='/teams/N'>Team Name</a></td>
//   <td>W</td><td>L</td><td>T</td><td>PCT</td><td>GB</td>
//   <td>Streak</td><td>Wks</td><td>PF</td><td>Back</td><td>PA</td>
async function parseTeams(html) {
  const teams = [];
  const rowRe = /<tr[^>]+\bid="(\d+)"[^>]*>[\s\S]*?<a\s+href='\/teams\/\d+'>([^<]+)<\/a>\s*<\/td>\s*<td[^>]*>(\d+)<\/td>\s*<td[^>]*>(\d+)<\/td>\s*<td[^>]*>(\d+)<\/td>[\s\S]*?<td[^>]*>([\d.]+)<\/td>\s*<td[^>]*>[^<]*<\/td>\s*<td[^>]*>([\d.]+)<\/td>/g;
  let m;
  while ((m = rowRe.exec(html)) !== null) {
    const [, id, name, w, l, t, pf, pa] = m;
    teams.push({
      id,
      name: name.trim(),
      owner: "",
      record: `${w}-${l}-${t}`,
      w: parseInt(w),
      l: parseInt(l),
      t: parseInt(t),
      pf: parseFloat(pf),
      pa: parseFloat(pa),
    });
  }
  return teams;
}

// Parse a team's roster page
async function parseRoster(html) {
  const roster = [];
  let current = null;

  await new HTMLRewriter()
    .on("tr.player, .roster-row, [data-player-id]", {
      element(el) {
        const id = el.getAttribute("data-player-id");
        const pos = el.getAttribute("data-position") || "";
        const slot = el.getAttribute("data-slot") || "";
        if (id) {
          current = { playerId: id, slot, pos, name: "", team: "" };
          roster.push(current);
        }
      },
    })
    .on(".player-name, .playerName, td.player a", {
      text(t) { if (current && t.text.trim()) current.name += t.text.trim(); },
    })
    .on(".player-team, .nflTeam", {
      text(t) { if (current && t.text.trim()) current.team += t.text.trim(); },
    })
    .transform(new Response(html))
    .text();

  return roster;
}

// Parse the rankings page.
// Page has 4 side-by-side expert columns; only parse the first table (consensus).
// CBS HTML: <tr class="row1|row2|bgFan">
//   <td class="rank">N</td>
//   <td><a class='playerLink' aria-label=' Name POS TEAM' href='/players/playerpage/ID'>...</a></td>
async function parseRankings(html) {
  const tableStart = html.indexOf('<table class="data borderTop"');
  const tableEnd = html.indexOf('</table>', tableStart);
  const tableHtml = tableStart >= 0 && tableEnd >= 0 ? html.slice(tableStart, tableEnd) : html;

  const rankings = [];
  // name from link text (handles apostrophes like Ja'Marr); pos/team from span
  const rowRe = /<tr class="(?:row1|row2|bgFan)"[^>]*>\s*<td[^>]*class="rank"[^>]*>(\d+)<\/td>[\s\S]*?href='\/players\/playerpage\/(\d+)'[^>]*>([^<]+)<\/a>\s*<span[^>]*>([A-Z/]+)\s*&#\d+;\s*([A-Z]+)/g;
  let m;
  while ((m = rowRe.exec(tableHtml)) !== null) {
    const [, rank, playerId, name, pos, team] = m;
    rankings.push({ rank: parseInt(rank), playerId, name: name.trim(), pos, team });
  }
  return rankings;
}

// Parse the draft results page.
// CBS HTML: <tr class="subtitle"><td>Round N</td></tr> as section headers, then
// <tr class="row1|row2|bgFan" align="right" valign="top"> pick rows (that exact
// attribute pair distinguishes real pick rows from the draft-chat-log rows, which
// reuse the same row1/row2 classes with different attributes). The player cell is
// <a class='playerLink' ...>Name</a> <span class="playerPositionAndTeam">POS • TEAM</span>
// — sometimes followed by extra injury/news icon markup (its own nested <a class="playerLink">
// links) before the </td>, which breaks a single end-to-end regex, so each row is captured
// as a block first, then player/pos/team extracted from within it independently.
// Numeric character references 128-159 are Windows-1252 holdovers, not real
// Unicode code points at those values — the HTML5 spec (and every real browser)
// remaps them. Confirmed live: CBS emits &#149; for the position/team separator,
// which is Windows-1252 0x95 = the bullet "•" (U+2022), not literal U+0095.
const WIN1252_C1_REMAP = {
  128: 0x20AC, 130: 0x201A, 131: 0x0192, 132: 0x201E, 133: 0x2026, 134: 0x2020,
  135: 0x2021, 136: 0x02C6, 137: 0x2030, 138: 0x0160, 139: 0x2039, 140: 0x0152,
  142: 0x017D, 145: 0x2018, 146: 0x2019, 147: 0x201C, 148: 0x201D, 149: 0x2022,
  150: 0x2013, 151: 0x2014, 152: 0x02DC, 153: 0x2122, 154: 0x0161, 155: 0x203A,
  156: 0x0153, 158: 0x017E, 159: 0x0178,
};
function decodeHtmlEntities(s) {
  return s
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(WIN1252_C1_REMAP[+n] || parseInt(n, 10)))
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'");
}

async function parseDraft(html) {
  const picks = [];
  const events = [];
  const roundRe = /<tr class="subtitle"><td[^>]*>Round (\d+)<\/td><\/tr>/g;
  const rowRe   = /<tr class="(?:row1|row2|bgFan)" align="right" valign="top">([\s\S]*?)<\/tr>/g;
  let m;
  while ((m = roundRe.exec(html)) !== null) events.push({ at: m.index, round: parseInt(m[1]) });
  while ((m = rowRe.exec(html)) !== null) events.push({ at: m.index, row: m[1] });
  events.sort((a, b) => a.at - b.at);

  let round = 0;
  let overallPick = 0;
  const teamPickRe   = /<td[^>]*>(\d+)<\/td>\s*<td[^>]*>([^<]*)<\/td>/;
  const playerRe     = /<a class='playerLink'[^>]*>([^<]*)<\/a>/;
  const posTeamRe    = /<span class="playerPositionAndTeam">([^<]*)<\/span>/;
  for (const ev of events) {
    if (ev.round != null) { round = ev.round; continue; }
    const tm = teamPickRe.exec(ev.row);
    if (!tm) continue;
    overallPick++;
    const pm = playerRe.exec(ev.row);
    const pp = posTeamRe.exec(ev.row);
    let pos = null, nflTeam = null;
    if (pp) {
      const parts = decodeHtmlEntities(pp[1]).trim().split(/\s*•\s*/);
      if (parts.length === 2) [pos, nflTeam] = parts;
    }
    picks.push({
      pickNum: overallPick,
      round,
      pickInRound: parseInt(tm[1]),
      team: decodeHtmlEntities(tm[2]).trim(),
      player: pm ? decodeHtmlEntities(pm[1]).trim() : null,
      pos,
      nflTeam,
    });
  }
  return picks;
}

// Extract the { cbsTeamId: teamName } map embedded in the page's own JSON data
// island — the same page that lists picks also lists each team's stable CBS id
// alongside its CURRENT display name, so this always matches the picks table's
// team-name text from the exact same page load, regardless of any later rename.
// Field order inside each "team": {...} block is NOT stable (confirmed live —
// varies per team depending on which optional fields, like custom logo params,
// that owner has set), so each block is isolated first and name/id pulled out
// independently rather than matched via one fixed-order regex.
function parseDraftTeamIds(html) {
  const blockRe = /"team"\s*:\s*\{([^{}]*)\}/g;
  const nameRe  = /"name"\s*:\s*"([^"]*)"/;
  const idRe    = /"id"\s*:\s*"(\d+)"/;
  const teams = {};
  let m;
  while ((m = blockRe.exec(html)) !== null) {
    const block = m[1];
    const nm = nameRe.exec(block);
    const im = idRe.exec(block);
    if (nm && im) teams[im[1]] = decodeHtmlEntities(nm[1]).trim();
  }
  return teams;
}

// Parse the transactions page.
// CBS HTML: <tr class="row1|row2"> with Date | Team | Players | Effective columns
async function parseTransactions(html) {
  const txns = [];
  const rowRe = /<tr class="(?:row1|row2)"[^>]*>\s*<td[^>]*>([^<]*)<\/td>\s*<td[^>]*>([\s\S]*?)<\/td>\s*<td[^>]*>([\s\S]*?)<\/td>\s*<td[^>]*>([^<]*)<\/td>\s*<\/tr>/g;
  let idx = 0;
  let m;
  while ((m = rowRe.exec(html)) !== null) {
    const [, date, teamHtml, playersHtml, effective] = m;
    const team = (teamHtml.match(/>([^<]+)<\/a>/) || [, teamHtml])[1].trim();
    const players = playersHtml.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    txns.push({ id: `t-${idx++}`, date: date.trim(), team, players, effective: effective.trim() });
  }
  return txns;
}

function parseScoring(html) {
  // Scoring settings are usually a table. Quick regex pull.
  const isHalfPPR = /half[\s-]?ppr|0\.5/i.test(html);
  const isPPR = /\bPPR\b/i.test(html) && !isHalfPPR;
  return {
    format: isHalfPPR ? "Half PPR" : isPPR ? "PPR" : "Standard",
    detected: { isHalfPPR, isPPR },
  };
}

// ============================================================
// Response helpers
// ============================================================
function corsHeaders(env, request) {
  const origin = request?.headers?.get("Origin") || "*";
  const allowed = (env?.ALLOWED_ORIGINS || "*").split(",").map(s => s.trim());
  const allowOrigin = allowed.includes("*") ? "*" : (allowed.includes(origin) ? origin : allowed[0]);
  return {
    "Access-Control-Allow-Origin": allowOrigin,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-FantasAI-Key, X-CBS-Cookie",
    "Access-Control-Max-Age": "86400",
  };
}

function json(data, status, env, request) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      ...corsHeaders(env, request),
      "Content-Type": "application/json; charset=utf-8",
    },
  });
}
