// FantasAI API Worker — api.fantasai.net
//
// POST /api/v1/chat                         — proxy to Databricks FantasAI chat endpoint (public, rate-limited by CF)
// GET  /api/health
// GET  /api/v1/storage/test              — live S3 connectivity check (read + write probe)
// GET  /api/v1/owners/config              — read owner map from S3 (no auth)
// POST /api/v1/owners/config              — write owner map to S3  (no auth)
// POST /api/v1/owners/reset-request       — generate token + send reset email
// GET  /api/v1/owners/reset-verify?token= — verify a reset token
// POST /api/v1/owners/reset-complete      — apply new password from token
// GET  /api/v1/week/current               — get current week/season (public)
// POST /api/v1/week/current               — set current week/season (commissioner)
// GET  /api/v1/injuries
// GET  /api/v1/stats/week?week=N&season=Y&type=regular|pre|post
// GET  /api/v1/projections?week=N&season=Y&type=regular|pre|post
// GET  /api/v1/league
// GET  /api/v1/rosters
// GET  /api/v1/draft?year=Y
// GET  /api/v1/schedule                   — read matchup schedule from S3 (public)
// POST /api/v1/schedule                   — write matchup schedule to S3 (commissioner)
// GET  /api/v1/league-settings            — read all league settings from S3 (public)
// POST /api/v1/league-settings            — write all league settings to S3 (commissioner)
// GET  /api/v1/proxy?url=<encoded>        — server-side fetch proxy (CORS bypass for whitelisted hosts)
// GET  /api/v1/nfl/scoreboard?week=N&season=Y&type=pre|regular|post — ESPN live scores (public)
// GET  /api/v1/nfl/schedule?week=N&season=Y  — ESPN weekly schedule (public)
// GET  /api/v1/nfl/news?limit=N              — ESPN NFL news feed (public)
// GET  /api/v1/players?limit=N&pos=QB,...   — Sleeper player pool ranked by search_rank (public, 1h cache)
// GET  /api/v1/cbs/players                 — CBS league player list with RotoWire news (requires CBS_WORKER_URL)

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

const NITTER_INSTANCES = [
  'https://nitter.kavin.rocks',
  'https://nitter.unixfox.eu',
  'https://nitter.it',
  'https://nitter.nl',
  'https://nitter.moomoo.me',
  'https://nitter.rawbit.ninja',
  'https://nitter.esmailelbob.xyz',
  'https://nitter.tiekoetter.com',
  'https://nitter.eu',
  'https://nitter.d420.de',
  'https://nitter.lunar.icu',
  'https://nitter.privacydev.net',
  'https://nitter.poast.org',
  'https://nitter.1d4.us',
  'https://bird.trom.tf',
];

// Stable NFL news RSS feeds used as fallback when all Nitter instances are down.
// PFT and NFL.com aggregate content from the same national reporters.
const BEAT_FALLBACK_RSS = [
  { url: 'https://profootballtalk.nbcsports.com/feed/', handle: 'PFT', reporter: 'Pro Football Talk', category: 'national' },
  { url: 'https://www.nfl.com/rss/rsslanding?searchString=news', handle: 'NFLcom', reporter: 'NFL.com News', category: 'national' },
];

// ── NFL team stadium map ──────────────────────────────────────────────────────
// Used by weather refresh to fetch forecasts for outdoor venues only.
// Dome teams get a "DOME" indicator — weather has no fantasy impact.
const NFL_TEAMS = {
  ARI: { city: 'Glendale, AZ',        dome: true  },
  ATL: { city: 'Atlanta, GA',          dome: true  },
  BAL: { city: 'Baltimore, MD',        dome: false },
  BUF: { city: 'Orchard Park, NY',     dome: false },
  CAR: { city: 'Charlotte, NC',        dome: false },
  CHI: { city: 'Chicago, IL',          dome: false },
  CIN: { city: 'Cincinnati, OH',       dome: false },
  CLE: { city: 'Cleveland, OH',        dome: false },
  DAL: { city: 'Arlington, TX',        dome: true  },
  DEN: { city: 'Denver, CO',           dome: false },
  DET: { city: 'Detroit, MI',          dome: true  },
  GB:  { city: 'Green Bay, WI',        dome: false },
  HOU: { city: 'Houston, TX',          dome: true  },
  IND: { city: 'Indianapolis, IN',     dome: true  },
  JAX: { city: 'Jacksonville, FL',     dome: false },
  KC:  { city: 'Kansas City, MO',      dome: false },
  LAC: { city: 'Inglewood, CA',        dome: false },
  LAR: { city: 'Inglewood, CA',        dome: true  },
  LV:  { city: 'Las Vegas, NV',        dome: true  },
  MIA: { city: 'Miami Gardens, FL',    dome: false },
  MIN: { city: 'Minneapolis, MN',      dome: true  },
  NE:  { city: 'Foxborough, MA',       dome: false },
  NO:  { city: 'New Orleans, LA',      dome: true  },
  NYG: { city: 'East Rutherford, NJ',  dome: false },
  NYJ: { city: 'East Rutherford, NJ',  dome: false },
  PHI: { city: 'Philadelphia, PA',     dome: false },
  PIT: { city: 'Pittsburgh, PA',       dome: false },
  SEA: { city: 'Seattle, WA',          dome: false },
  SF:  { city: 'Santa Clara, CA',      dome: false },
  TB:  { city: 'Tampa, FL',            dome: false },
  TEN: { city: 'Nashville, TN',        dome: false },
  WAS: { city: 'Landover, MD',         dome: false },
};

const S3_KEY              = 'fantasai/owners-config.json';
const S3_LEAGUE_KEY       = 'fantasai/league-config.json';
const S3_ROSTERS_KEY      = 'fantasai/rosters.json';
const S3_SCHEDULE_KEY     = 'fantasai/schedule.json';
const S3_SETTINGS_KEY     = 'fantasai/league-settings.json';
const S3_WEATHER_KEY      = 'fantasai/analysis/weather_forecast.json';
const S3_COMMUNITY_KEY    = 'fantasai/community.json';

// Weather refresh cooldown: 30 minutes (prevents burning WWO quota on rapid clicks)
const WEATHER_COOLDOWN_MS = 30 * 60 * 1000;

const PROTECTED_GET = {
  '/api/v1/injuries':    handleInjuries,
  '/api/v1/stats/week':  handleStats,
  '/api/v1/projections': handleProjections,
  '/api/v1/league':      handleLeague,
  '/api/v1/rosters':     handleRosters,
  '/api/v1/draft':       handleDraft,
};

export default {
  async fetch(request, env) {
    const url    = new URL(request.url);
    const method = request.method;

    if (method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders() });
    }

    // ── R2 Proxy for Databricks ──────────────────────────────────────────
    if (url.pathname.startsWith('/api/v1/r2')) {
      return handleR2Proxy(request, env, url);
    }

    try {
      // ── POST routes (no auth — called directly by the app) ──────────────
      if (method === 'POST') {
        if (url.pathname === '/api/v1/chat')                  return handleChat(request, env);
        if (url.pathname === '/api/v1/owners/config')         return handleOwnersConfigPost(request, env);
        if (url.pathname === '/api/v1/owners/reset-request')  return handleResetRequest(request, env);
        if (url.pathname === '/api/v1/owners/reset-complete') return handleResetComplete(request, env);
        if (url.pathname === '/api/v1/week/current')          return handleWeekSet(request, env);
        if (url.pathname === '/api/v1/rosters/save')          return handleRosterSave(request, env);
        if (url.pathname === '/api/v1/rosters/bulk-save')     return handleRosterBulkSave(request, env);
        if (url.pathname === '/api/v1/rosters/reset')         return handleRosterReset(request, env);
        if (url.pathname === '/api/v1/schedule')              return handleScheduleSave(request, env);
        if (url.pathname === '/api/v1/league-settings')       return handleLeagueSettingsSave(request, env);
        if (url.pathname === '/api/v1/community')             return handleCommunitySave(request, env);
        if (url.pathname === '/api/v1/community/media')       return handleCommunityMediaUpload(url, request, env);
        if (url.pathname === '/api/v1/weather/refresh')       return handleWeatherRefresh(request, env);
        if (url.pathname === '/api/v1/transactions')          return handleTransactionsPost(request, env);
        if (url.pathname === '/api/v1/scrape')                return handleScrape(request);
        // Push notifications (open — anyone with the app can subscribe/unsubscribe)
        if (url.pathname === '/api/v1/push/subscribe')        return handlePushSubscribe(request, env);
        if (url.pathname === '/api/v1/push/unsubscribe')      return handlePushUnsubscribe(request, env);
        // Push send — commish only, requires X-FantasAI-Key
        if (url.pathname === '/api/v1/push/send')             return handlePushSend(request, env);
        // League management
        if (url.pathname === '/api/v1/leagues/create')        return handleLeagueCreate(request, env);
        if (url.pathname === '/api/v1/leagues/import')        return handleLeagueImport(request, env);
        return json({ error: 'Not found' }, 404);
      }

      if (method !== 'GET') return json({ error: 'Method not allowed' }, 405);


      // ── Public GET routes ────────────────────────────────────────────────
      if (url.pathname === '/api/health')                  return json(handleHealth(env), 200);
      if (url.pathname === '/api/v1/storage/test')         return handleStorageTest(env);
      if (url.pathname === '/api/v1/owners/config')        return handleOwnersConfigGet(env);
      if (url.pathname === '/api/v1/owners/reset-verify')  return handleResetVerify(url, env);
      if (url.pathname === '/api/v1/week/current')         return handleWeekGet(env);
      if (url.pathname === '/api/v1/rosters/load')         return handleRosterLoad(url, env);
      if (url.pathname === '/api/v1/schedule')             return handleScheduleLoad(env);
      if (url.pathname === '/api/v1/league-settings')     return handleLeagueSettingsLoad(url, env);
      if (url.pathname === '/api/v1/community')           return handleCommunityLoad(env);
      if (url.pathname === '/api/v1/proxy')               return handleProxy(url);
      if (url.pathname === '/api/v1/nfl/scoreboard')      return handleNflScoreboard(url);
      if (url.pathname === '/api/v1/nfl/player-stats')   return handleNflPlayerStats(url);
      if (url.pathname === '/api/v1/nfl/schedule')        return handleNflSchedule(url);
      if (url.pathname === '/api/v1/nfl/news')            return handleNflNews(url);
      if (url.pathname === '/api/v1/players')             return handlePlayers(url);
      if (url.pathname === '/api/v1/cbs/players')         return await handleCbsPlayers(env);
      if (url.pathname === '/api/v1/weather')            return await handleWeatherGet(env);
      if (url.pathname === '/api/v1/transactions')      return await handleTransactionsGet(env);
      if (url.pathname === '/api/v1/cbs/rankings')        return await handleCbsRankings(url, env);
      if (url.pathname === '/api/v1/twitter/beat')        return await handleBeatWriterNews();
      if (url.pathname.startsWith('/api/v1/player/'))   return await handlePlayerProfile(url, env);
      if (url.pathname === '/api/v1/db/players')          return await handleDbPlayers(env);
      if (url.pathname === '/api/v1/db/tables')           return await handleDbTables(env);
      if (url.pathname === '/api/v1/news/latest')        return await handleDbNews(env);
      if (url.pathname === '/api/v1/news/critical')      return await handleDbCritical(env);
      if (url.pathname === '/api/v1/news/articles')      return await handleDbArticles(url, env);
      if (url.pathname === '/api/v1/leaderboard/live')   return await handleDbLeaderboard(env);
      if (url.pathname === '/api/v1/games/active')       return await handleDbActiveGames(env);
      if (url.pathname === '/api/v1/opportunity/rankings') return await handleDbOpportunity(env);
      if (url.pathname === '/health' || url.pathname === '/') return json(handleHealth(env), 200);

      // ── Authenticated GET routes ─────────────────────────────────────────
      if (env.FANTASAI_KEY) {
        const k = request.headers.get('X-FantasAI-Key');
        if (k !== env.FANTASAI_KEY) return json({ error: 'Unauthorized' }, 401);
      }
      const handler = PROTECTED_GET[url.pathname];
      if (!handler) return json({ error: 'Not found', path: url.pathname }, 404);
      return json(await handler(url, env, request), 200);

    } catch (err) {
      console.error(err.stack || err);
      return json({ error: err.message }, 502);
    }
  },
};

// ── Owner Config ─────────────────────────────────────────────────────────────

async function handleOwnersConfigGet(env) {
  try {
    const res = await s3Fetch(env, 'GET', S3_KEY, null);
    if (res.status === 404) return json({}, 200);
    if (!res.ok) throw new Error(`S3 ${res.status}`);
    const { resetTokens: _drop, ...publicData } = await res.json();
    return json(publicData, 200);
  } catch (err) {
    console.error('S3 GET owners/config:', err.message);
    return json({}, 200); // graceful fallback so login still works
  }
}

async function handleOwnersConfigPost(request, env) {
  const incoming = await request.json();
  const { resetTokens: _drop, ...ownerUpdates } = incoming; // clients never supply tokens

  let existing = {};
  try {
    const res = await s3Fetch(env, 'GET', S3_KEY, null);
    if (res.ok) existing = await res.json();
  } catch {}

  const merged = { ...ownerUpdates, resetTokens: existing.resetTokens || {} };
  const put = await s3Fetch(env, 'PUT', S3_KEY, merged);
  if (!put.ok) throw new Error(`S3 PUT ${put.status}: ${await put.text()}`);
  return json({ ok: true }, 200);
}

// ── Password Reset ────────────────────────────────────────────────────────────

async function handleResetRequest(request, env) {
  // Always respond ok — never leak whether an email is registered
  const { email } = await request.json().catch(() => ({}));
  if (!email || !env.RESEND_API_KEY) return json({ ok: true }, 200);

  try {
    let config = {};
    const res = await s3Fetch(env, 'GET', S3_KEY, null);
    if (res.ok) config = await res.json();

    const trimmed = email.trim().toLowerCase();
    const entry = Object.entries(config)
      .filter(([k]) => k !== 'resetTokens')
      .find(([, v]) => (v.email || '').toLowerCase() === trimmed);

    if (!entry) return json({ ok: true }, 200);
    const [teamId, ownerData] = entry;

    const token = crypto.randomUUID();
    config.resetTokens = config.resetTokens || {};

    // Purge expired tokens
    for (const [t, d] of Object.entries(config.resetTokens)) {
      if (d.expires < Date.now()) delete config.resetTokens[t];
    }
    config.resetTokens[token] = { teamId, expires: Date.now() + 3_600_000 };

    await s3Fetch(env, 'PUT', S3_KEY, config);

    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: 'FantasAI <noreply@fantasai.net>',
        to: trimmed,
        subject: 'Reset your FantasAI password',
        html: resetEmailHtml(`https://fantasai.net?reset=${token}`, ownerData.name || 'Manager'),
      }),
    });
  } catch (err) {
    console.error('Reset request error:', err.message);
  }

  return json({ ok: true }, 200);
}

async function handleResetVerify(url, env) {
  const token = url.searchParams.get('token');
  if (!token) return json({ valid: false }, 200);

  try {
    const res = await s3Fetch(env, 'GET', S3_KEY, null);
    if (!res.ok) return json({ valid: false }, 200);
    const config = await res.json();
    const data = config.resetTokens?.[token];
    if (!data || Date.now() > data.expires) return json({ valid: false }, 200);
    const teamId = data.teamId;
    const owner = config[teamId];
    return json({ valid: true, teamId, teamName: owner?.name || '' }, 200);
  } catch {
    return json({ valid: false }, 200);
  }
}

async function handleResetComplete(request, env) {
  const { token, newPassword } = await request.json().catch(() => ({}));
  if (!token || !newPassword) return json({ error: 'Token and password required' }, 400);

  let config = {};
  try {
    const res = await s3Fetch(env, 'GET', S3_KEY, null);
    if (res.ok) config = await res.json();
  } catch {}

  const tokenData = config.resetTokens?.[token];
  if (!tokenData) return json({ error: 'Invalid or expired link.' }, 400);
  if (Date.now() > tokenData.expires) {
    delete config.resetTokens[token];
    await s3Fetch(env, 'PUT', S3_KEY, config).catch(() => {});
    return json({ error: 'This link has expired. Please request a new one.' }, 400);
  }

  const { teamId } = tokenData;
  config[teamId] = { ...config[teamId], password: newPassword, passwordSet: true };
  delete config.resetTokens[token];
  await s3Fetch(env, 'PUT', S3_KEY, config);

  return json({ ok: true, teamId }, 200);
}

// ── Current week ──────────────────────────────────────────────────────────────

const DEFAULT_WEEK = { week: 1, season: new Date().getFullYear(), type: 'regular' };

async function handleWeekGet(env) {
  try {
    const res = await s3Fetch(env, 'GET', S3_LEAGUE_KEY, null);
    if (res.status === 404) return json(DEFAULT_WEEK, 200);
    if (!res.ok) throw new Error(`S3 ${res.status}`);
    const cfg = await res.json();
    return json({ week: cfg.week ?? 1, season: cfg.season ?? new Date().getFullYear(), type: cfg.type ?? 'regular' }, 200);
  } catch {
    return json(DEFAULT_WEEK, 200);
  }
}

async function handleWeekSet(request, env) {
  const body = await request.json().catch(() => ({}));
  const week   = parseInt(body.week)   || 1;
  const season = parseInt(body.season) || new Date().getFullYear();
  const type   = ['pre', 'regular', 'post'].includes(body.type) ? body.type : 'regular';

  let existing = {};
  try {
    const res = await s3Fetch(env, 'GET', S3_LEAGUE_KEY, null);
    if (res.ok) existing = await res.json();
  } catch {}

  const merged = { ...existing, week, season, type };
  const put = await s3Fetch(env, 'PUT', S3_LEAGUE_KEY, merged);
  if (!put.ok) throw new Error(`S3 PUT ${put.status}`);
  return json({ ok: true, week, season, type }, 200);
}

// ── Static handlers ───────────────────────────────────────────────────────────

function handleHealth(env) {
  return {
    ok: true,
    service: 'fantasai-api',
    r2Configured:    !!env.BUCKET,
    emailConfigured: !!env.RESEND_API_KEY,
    cbsConfigured:   !!env.CBS_WORKER_URL,
    authRequired:    !!env.FANTASAI_KEY,
  };
}

async function handleStorageTest(env) {
  const result = {
    r2Configured: !!env.BUCKET,
    bucket: 'fantasai-r2',
    testedAt: new Date().toISOString(),
    read: null,
    write: null,
    error: null,
  };

  if (!result.r2Configured) {
    result.error = 'R2 binding BUCKET not configured — check wrangler.toml [[r2_buckets]]';
    return json(result, 200);
  }

  // Read test — GET the settings file (null = not found, both null and found are valid)
  try {
    const readRes = await s3Fetch(env, 'GET', S3_SETTINGS_KEY, null);
    result.read = { status: readRes.status, ok: readRes.status === 200 || readRes.status === 404 };
  } catch (err) {
    result.read = { ok: false, error: err.message };
  }

  // Write test — PUT a tiny probe file, then DELETE it
  const probeKey = 'fantasai/_storage_probe.json';
  try {
    const writeRes = await s3Fetch(env, 'PUT', probeKey, { probe: true, at: result.testedAt });
    result.write = { status: writeRes.status, ok: writeRes.ok };
    if (!writeRes.ok) {
      result.write.error = `HTTP ${writeRes.status}`;
    } else {
      await s3Fetch(env, 'DELETE', probeKey, null).catch(() => {});
    }
  } catch (err) {
    result.write = { ok: false, error: err.message };
  }

  result.allGood = !!(result.read?.ok && result.write?.ok);
  return json(result, 200);
}

async function handleInjuries(url, env) {
  const players = await sleeperFetch(env, '/players/nfl');
  const injured = Object.entries(players)
    .filter(([, p]) => p.injury_status && p.injury_status !== 'Na')
    .map(([id, p]) => ({
      player_id:         id,
      full_name:         p.full_name || `${p.first_name} ${p.last_name}`,
      position:          p.position,
      team:              p.team,
      injury_status:     p.injury_status,
      injury_body_part:  p.injury_body_part  || null,
      injury_notes:      p.injury_notes      || null,
      injury_start_date: p.injury_start_date || null,
    }));
  return { source: 'sleeper', fetchedAt: new Date().toISOString(), count: injured.length, injuries: injured };
}

async function handleStats(url, env) {
  const { week, season, type } = resolveWeekParams(url);
  const data = await sleeperFetch(env, `/stats/nfl/${type}/${season}/${week}`);
  return { source: 'sleeper', fetchedAt: new Date().toISOString(), season, week, type, stats: data };
}

async function handleProjections(url, env) {
  const { week, season, type } = resolveWeekParams(url);
  const data = await sleeperFetch(env, `/projections/nfl/${type}/${season}/${week}`);
  return { source: 'sleeper', fetchedAt: new Date().toISOString(), season, week, type, projections: data };
}

async function handleLeague(url, env, req) { return cbsFetch(env, '/api/cbs/league', req?.headers?.get('X-CBS-Cookie')); }
async function handleRosters(url, env, req) { return cbsFetch(env, '/api/cbs/rosters', req?.headers?.get('X-CBS-Cookie')); }
async function handleDraft(url, env, req) {
  const year = url.searchParams.get('year') || new Date().getFullYear();
  return cbsFetch(env, `/api/cbs/draft?year=${year}`, req?.headers?.get('X-CBS-Cookie'));
}

async function handleCbsRankings(url, env) {
  if (!env.CBS_WORKER_URL) return json({ error: 'CBS_WORKER_URL not configured', rankings: [], source: 'cbs' }, 503);
  const pos  = url.searchParams.get('pos') || 'ALL';
  const data = await cbsFetch(env, `/api/cbs/rankings?pos=${pos}`);
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: { ...corsHeaders(), 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=900' },
  });
}

async function handleCbsPlayers(env) {
  if (!env.CBS_WORKER_URL) return json({ error: 'CBS_WORKER_URL not configured', players: [], count: 0, source: 'cbs' }, 503);
  const data = await cbsFetch(env, '/api/cbs/players');
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: { ...corsHeaders(), 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=300' },
  });
}

// ── Players (public, cached 1 h) ──────────────────────────────────────────────

async function handlePlayers(url) {
  const limit     = Math.min(parseInt(url.searchParams.get('limit') || '300', 10), 500);
  const posFilter = (url.searchParams.get('pos') || 'QB,RB,WR,TE,K,DEF').split(',');

  const base = 'https://api.sleeper.app/v1';
  const res  = await fetch(`${base}/players/nfl`, {
    headers: { Accept: 'application/json' },
    cf: { cacheTtl: 3600, cacheEverything: true },
  });
  if (!res.ok) throw new Error(`Sleeper /players/nfl → ${res.status}`);

  const raw = await res.json();
  const players = Object.entries(raw)
    .filter(([, p]) => p.active && posFilter.includes(p.position) && p.search_rank != null)
    .map(([sleeperId, p]) => ({
      id:     sleeperId,
      name:   p.full_name || [p.first_name, p.last_name].filter(Boolean).join(' '),
      pos:    p.position,
      team:   p.team || 'FA',
      num:    p.number   || null,
      age:    p.age      || null,
      status: p.injury_status && p.injury_status !== 'Na' ? p.injury_status : 'OK',
      ecr:    p.search_rank,
      adp:    p.search_rank,
      owned:  parseFloat(Math.max(0, 100 - p.search_rank * 0.28).toFixed(1)),
    }))
    .sort((a, b) => a.ecr - b.ecr)
    .slice(0, limit);

  return new Response(JSON.stringify({ players, fetchedAt: new Date().toISOString(), source: 'sleeper' }), {
    status: 200,
    headers: { ...corsHeaders(), 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=3600' },
  });
}

// ── Sleeper ───────────────────────────────────────────────────────────────────

async function sleeperFetch(env, path) {
  const base = env.SLEEPER_BASE || 'https://api.sleeper.app/v1';
  const res = await fetch(`${base}${path}`, {
    headers: { Accept: 'application/json' },
    cf: { cacheTtl: 300, cacheEverything: true },
  });
  if (!res.ok) throw new Error(`Sleeper ${path} → ${res.status}`);
  return res.json();
}

// ── CBS Worker proxy ──────────────────────────────────────────────────────────

async function cbsFetch(env, path, cbsCookie = null) {
  if (!env.CBS_WORKER_URL) throw new Error('CBS_WORKER_URL not configured');
  const headers = {
    Accept: 'application/json',
    ...(env.FANTASAI_KEY ? { 'X-FantasAI-Key': env.FANTASAI_KEY } : {}),
  };
  if (cbsCookie) headers['X-CBS-Cookie'] = cbsCookie;
  const res = await fetch(`${env.CBS_WORKER_URL}${path}`, { headers });
  if (!res.ok) throw new Error(`CBS Worker ${path} → ${res.status}`);
  return res.json();
}

// ── Roster management ─────────────────────────────────────────────────────────

async function handleRosterLoad(url, env) {
  try {
    const res = await s3Fetch(env, 'GET', S3_ROSTERS_KEY, null);
    if (res.status === 404) return json({ rosters: {}, fromS3: false }, 200);
    if (!res.ok) return json({ rosters: {}, fromS3: false }, 200);
    const data = await res.json();
    const rosters = data.rosters || {};
    const teamId = url.searchParams.get('teamId');
    if (teamId) {
      const key = String(teamId);
      const playerIds = Object.prototype.hasOwnProperty.call(rosters, key) ? rosters[key] : null;
      return json({ teamId: parseInt(teamId), playerIds, fromS3: playerIds !== null }, 200);
    }
    return json({ rosters, fromS3: true, resetAt: data.resetAt || null }, 200);
  } catch {
    return json({ rosters: {}, fromS3: false }, 200);
  }
}

async function handleRosterSave(request, env) {
  const body = await request.json().catch(() => ({}));
  const { teamId, playerIds } = body;
  if (!teamId || !Array.isArray(playerIds)) return json({ error: 'teamId and playerIds required' }, 400);

  let existing = { rosters: {} };
  try {
    const res = await s3Fetch(env, 'GET', S3_ROSTERS_KEY, null);
    if (res.ok) existing = await res.json();
  } catch {}

  existing.rosters = existing.rosters || {};
  existing.rosters[String(teamId)] = playerIds.map(Number).filter(Boolean);
  existing.savedAt = new Date().toISOString();

  const put = await s3Fetch(env, 'PUT', S3_ROSTERS_KEY, existing);
  if (!put.ok) throw new Error(`S3 PUT ${put.status}`);
  return json({ ok: true, teamId, count: playerIds.length }, 200);
}

async function handleRosterReset(request, env) {
  const reset = { rosters: {}, resetAt: new Date().toISOString() };
  const put = await s3Fetch(env, 'PUT', S3_ROSTERS_KEY, reset);
  if (!put.ok) throw new Error(`S3 PUT ${put.status}`);
  return json({ ok: true, resetAt: reset.resetAt }, 200);
}

// Writes all team rosters in a single R2 PUT — avoids the race condition that
// occurs when many concurrent /rosters/save calls all read-modify-write the same key.
async function handleRosterBulkSave(request, env) {
  const body = await request.json().catch(() => ({}));
  // body.rosters: { "1": [playerId, ...], "2": [...], ... }
  const incoming = body.rosters;
  if (!incoming || typeof incoming !== 'object') {
    return json({ error: 'rosters object required: { "teamId": [playerIds] }' }, 400);
  }

  const rosters = {};
  for (const [teamId, playerIds] of Object.entries(incoming)) {
    if (Array.isArray(playerIds)) {
      rosters[String(teamId)] = playerIds.map(Number).filter(Boolean);
    }
  }

  const payload = { rosters, savedAt: new Date().toISOString() };
  const put = await s3Fetch(env, 'PUT', S3_ROSTERS_KEY, payload);
  if (!put.ok) throw new Error(`R2 PUT ${put.status}`);

  const counts = Object.fromEntries(Object.entries(rosters).map(([id, ids]) => [id, ids.length]));
  return json({ ok: true, savedAt: payload.savedAt, teamCount: Object.keys(rosters).length, counts }, 200);
}

// ── ESPN / NFL Public APIs ────────────────────────────────────────────────────

const ESPN_BASE = 'https://site.api.espn.com/apis/site/v2/sports/football/nfl';
const ESPN_CACHE = { cacheTtl: 60, cacheEverything: true };

function espnSeasonType(type) {
  return type === 'pre' ? 1 : type === 'post' ? 3 : 2;
}

async function espnFetch(path) {
  const res = await fetch(`${ESPN_BASE}${path}`, {
    headers: { Accept: 'application/json' },
    cf: ESPN_CACHE,
  });
  if (!res.ok) throw new Error(`ESPN ${path} → ${res.status}`);
  return res.json();
}

function normalizeGame(event) {
  const comp = event.competitions?.[0];
  const competitors = (comp?.competitors || []).map(c => ({
    id:       c.team?.id,
    name:     c.team?.displayName,
    abbr:     c.team?.abbreviation,
    logo:     c.team?.logo,
    score:    c.score ?? null,
    homeAway: c.homeAway,
    winner:   c.winner ?? false,
    record:   c.records?.[0]?.summary ?? null,
  }));
  const home = competitors.find(c => c.homeAway === 'home');
  const away = competitors.find(c => c.homeAway === 'away');
  const status = event.status?.type;
  return {
    id:          event.id,
    date:        event.date,
    name:        event.name,
    shortName:   event.shortName,
    home,
    away,
    venue:       comp?.venue?.fullName ?? null,
    status: {
      state:     status?.state ?? 'pre',   // pre | in | post
      completed: status?.completed ?? false,
      description: status?.description ?? '',
      clock:     event.status?.displayClock ?? null,
      period:    event.status?.period ?? null,
    },
    broadcasts:  (comp?.broadcasts || []).flatMap(b => b.names || []),
    odds:        comp?.odds?.[0]?.details ?? null,
  };
}

async function handleNflScoreboard(url) {
  const { week, season, type } = resolveWeekParams(url);
  const seasonType = espnSeasonType(type);
  const data = await espnFetch(`/scoreboard?seasontype=${seasonType}&week=${week}&season=${season}`);
  // NFL season runs Aug–Jan; filter to only games that belong to the requested season year
  // so ESPN can't silently return prior-season data when the new season hasn't dropped yet.
  const seasonFloor = new Date(`${season}-07-01`);
  const seasonCeil  = new Date(`${season + 1}-03-01`);
  const allGames    = (data.events || []).map(normalizeGame);
  const games       = allGames.filter(g => {
    const d = new Date(g.date);
    return d >= seasonFloor && d < seasonCeil;
  });
  return json({
    source:          'espn',
    fetchedAt:       new Date().toISOString(),
    season,
    week,
    type,
    gameCount:       games.length,
    games,
    seasonAvailable: games.length > 0,
  }, 200);
}

async function handleNflSchedule(url) {
  const { week, season, type } = resolveWeekParams(url);
  const seasonType = espnSeasonType(type);
  const data = await espnFetch(`/scoreboard?seasontype=${seasonType}&week=${week}&season=${season}`);
  const games = (data.events || []).map(e => {
    const comp = e.competitions?.[0];
    const competitors = (comp?.competitors || []).map(c => ({
      name:     c.team?.displayName,
      abbr:     c.team?.abbreviation,
      homeAway: c.homeAway,
    }));
    const rawOdds = comp?.odds?.[0];
    const odds = rawOdds ? {
      details:    rawOdds.details  ?? null,
      overUnder:  rawOdds.overUnder != null ? Number(rawOdds.overUnder) : null,
      spread:     rawOdds.spread   != null ? Number(rawOdds.spread)    : null,
      homeML:     rawOdds.homeTeamOdds?.moneyLine ?? null,
      awayML:     rawOdds.awayTeamOdds?.moneyLine ?? null,
    } : null;
    return {
      id:          e.id,
      date:        e.date,
      name:        e.shortName,
      statusState: e.status?.type?.state ?? 'pre',          // pre | in | post
      statusDetail:e.status?.type?.shortDetail ?? null,     // e.g. "8:20 PM ET"
      venue:       comp?.venue?.fullName ?? null,
      home:        competitors.find(c => c.homeAway === 'home'),
      away:        competitors.find(c => c.homeAway === 'away'),
      completed:   e.status?.type?.completed ?? false,
      broadcasts:  (comp?.broadcasts || []).flatMap(b => b.names || []),
      odds,
    };
  });
  return json({ source: 'espn', fetchedAt: new Date().toISOString(), season, week, type, games }, 200);
}

async function handleNflNews(url) {
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '50'), 100);
  const data = await espnFetch(`/news?limit=${limit}`);
  const articles = (data.articles || []).map(a => ({
    id:          a.dataSourceIdentifier || a.id,
    headline:    a.headline,
    description: a.description,
    published:   a.published,
    byline:      a.byline ?? null,
    category:    a.categories?.find(c => c.type === 'team')?.description ?? null,
    image:       a.images?.[0]?.url ?? null,
    link:        a.links?.web?.href ?? null,
  }));
  return json({ source: 'espn', fetchedAt: new Date().toISOString(), count: articles.length, articles }, 200);
}

// ── NFL Player Stats (ESPN box scores) ──────────────────────────────────────
async function handleNflPlayerStats(url) {
  const { week, season, type } = resolveWeekParams(url);
  const seasonType = espnSeasonType(type);

  // Step 1: get the scoreboard to find game IDs
  const board = await espnFetch(`/scoreboard?seasontype=${seasonType}&week=${week}&season=${season}`);
  const events = (board.events || []).filter(e => {
    const d = new Date(e.date);
    return d >= new Date(`${season}-07-01`) && d < new Date(`${season + 1}-03-01`);
  });

  if (events.length === 0) {
    return json({ source: 'espn', week, season, gameCount: 0, players: [], fetchedAt: new Date().toISOString() }, 200);
  }

  // Step 2: fetch box scores for each game in parallel (cap at 16 games)
  const gameIds = events.slice(0, 16).map(e => e.id);
  const summaries = await Promise.allSettled(
    gameIds.map(id => espnFetch(`/summary?event=${id}`))
  );

  // Step 3: parse player stats from each game
  const playerMap = {};

  for (let i = 0; i < summaries.length; i++) {
    const result = summaries[i];
    if (result.status !== 'fulfilled') continue;
    const data = result.value;
    const boxscore = data.boxscore || {};

    // Determine team scores for DST pts-allowed calculation
    const teamScores = {};
    for (const comp of (events[i]?.competitions?.[0]?.competitors || [])) {
      const abbr = comp.team?.abbreviation || '';
      teamScores[abbr] = parseInt(comp.score || '0', 10);
    }

    // Parse individual player stats
    for (const teamData of (boxscore.players || [])) {
      const teamAbbr = teamData.team?.abbreviation || '';
      const opponentAbbr = Object.keys(teamScores).find(k => k !== teamAbbr) || '';
      const ptsAllowed = teamScores[opponentAbbr] ?? null;

      for (const statGroup of (teamData.statistics || [])) {
        const { name, keys = [], athletes = [] } = statGroup;
        for (const athleteEntry of athletes) {
          const athlete = athleteEntry.athlete || {};
          const statsArr = athleteEntry.stats || [];
          const pid = athlete.id;
          if (!pid) continue;

          if (!playerMap[pid]) {
            playerMap[pid] = {
              id: pid,
              name: athlete.displayName || '',
              pos: athlete.position?.abbreviation || '',
              team: teamAbbr,
              stats: {},
            };
          }
          const p = playerMap[pid];

          function sv(key) {
            const idx = keys.indexOf(key);
            if (idx < 0) return 0;
            const v = statsArr[idx];
            return v && v !== '--' ? parseFloat(v) || 0 : 0;
          }
          function splitSlash(key) {
            const idx = keys.indexOf(key);
            const v = idx >= 0 ? (statsArr[idx] || '') : '';
            const parts = v.split('/');
            return { a: parseFloat(parts[0]) || 0, b: parseFloat(parts[1]) || 0 };
          }
          function splitDash(key) {
            const idx = keys.indexOf(key);
            const v = idx >= 0 ? (statsArr[idx] || '') : '';
            const parts = v.split('-');
            return parseFloat(parts[0]) || 0;
          }

          if (name === 'passing') {
            const ca = splitSlash('completionsAttempts');
            p.stats.passComp = (p.stats.passComp || 0) + ca.a;
            p.stats.passAtt  = (p.stats.passAtt  || 0) + ca.b;
            p.stats.passYds  = (p.stats.passYds  || 0) + sv('passingYards');
            p.stats.passTds  = (p.stats.passTds  || 0) + sv('passingTouchdowns');
            p.stats.passInt  = (p.stats.passInt  || 0) + sv('interceptions');
          } else if (name === 'rushing') {
            p.stats.rushAtt = (p.stats.rushAtt || 0) + sv('rushingAttempts');
            p.stats.rushYds = (p.stats.rushYds || 0) + sv('rushingYards');
            p.stats.rushTds = (p.stats.rushTds || 0) + sv('rushingTouchdowns');
          } else if (name === 'receiving') {
            p.stats.rec     = (p.stats.rec     || 0) + sv('receptions');
            p.stats.recYds  = (p.stats.recYds  || 0) + sv('receivingYards');
            p.stats.recTds  = (p.stats.recTds  || 0) + sv('receivingTouchdowns');
            p.stats.targets = (p.stats.targets || 0) + sv('receivingTargets');
          } else if (name === 'kicking') {
            const fg = splitSlash('fieldGoalsMadeFieldGoalsAttempted');
            const xp = splitSlash('extraPointsMadeExtraPointsAttempted');
            p.stats.fgMade  = (p.stats.fgMade  || 0) + fg.a;
            p.stats.fgAtt   = (p.stats.fgAtt   || 0) + fg.b;
            p.stats.xpMade  = (p.stats.xpMade  || 0) + xp.a;
            if (!p.pos || p.pos === '') p.pos = 'K';
          } else if (name === 'defensive') {
            p.stats.sacks   = (p.stats.sacks   || 0) + sv('sacks');
            p.stats.ints    = (p.stats.ints    || 0) + sv('interceptions');
            p.stats.fumRec  = (p.stats.fumRec  || 0) + sv('fumbleRecoveries');
            p.stats.tds     = (p.stats.tds     || 0) + sv('defensiveTouchdowns');
            p.stats.safeties= (p.stats.safeties|| 0) + sv('safeties');
          }

          // Tag DST players with ptsAllowed for their team's defense
          if (ptsAllowed !== null) p.stats.ptsAllowed = ptsAllowed;
        }
      }
    }
  }

  // Normalize ESPN position abbreviations to fantasy slot names
  const POS_NORM = { HB: 'RB', FB: 'RB', WB: 'RB', FL: 'WR', SE: 'WR', SWR: 'WR', 'D/ST': 'DST', DEF: 'DST', PK: 'K' };
  for (const p of Object.values(playerMap)) {
    const t = (p.pos || '').trim();
    p.pos = POS_NORM[t] || t;
  }

  // Filter to players with at least some recorded stats.
  // Kickers are included if they appeared in the kicking stat group (fgAtt > 0) even if they missed all FGs.
  const players = Object.values(playerMap).filter(p => {
    const s = p.stats;
    return (s.passYds || s.rushYds || s.recYds || s.rec || s.fgMade || s.fgAtt || s.sacks || s.ints || s.tds) > 0
      || (s.xpMade || 0) > 0;
  });

  return json({
    source: 'espn',
    fetchedAt: new Date().toISOString(),
    week,
    season,
    gameCount: gameIds.length,
    players,
  }, 200);
}

// ── Proxy (CORS bypass for whitelisted third-party APIs) ─────────────────────

const PROXY_WHITELIST = [
  'leaguelogs.com',
  'api.leaguelogs.com',
  'api.sleeper.app',
  'fantasysports.yahooapis.com',
  'site.api.espn.com',
  'sports.core.api.espn.com',
  'v1.american-football.api-sports.io',
  'tank01-fantasy-stats.p.rapidapi.com',
  'tank01-nfl-live-in-game-real-time-statistics-nfl.p.rapidapi.com',
  'www.thesportsdb.com',
  'api.github.com',
  'github.com',
  'raw.githubusercontent.com',
  'objects.githubusercontent.com',
  'api.mysportsfeeds.com',
  'www.fantasypros.com',
  'partners.fantasypros.com',
];

async function handleProxy(url) {
  const target    = url.searchParams.get('url');
  const keyHeader = url.searchParams.get('keyHeader');
  const keyValue  = url.searchParams.get('keyValue');
  const keyHost   = url.searchParams.get('keyHost');

  if (!target) return json({ error: 'url param required' }, 400);

  let parsed;
  try { parsed = new URL(target); } catch { return json({ error: 'invalid url' }, 400); }

  const allowed = PROXY_WHITELIST.some(h => parsed.hostname === h || parsed.hostname.endsWith(`.${h}`));
  if (!allowed) return json({ error: 'host not whitelisted' }, 403);

  const extraHeaders = {};
  if (keyHeader && keyValue) extraHeaders[keyHeader] = keyValue;
  if (keyHost)               extraHeaders['x-rapidapi-host'] = keyHost;

  try {
    const res = await fetch(target, {
      headers: { Accept: 'application/json', 'User-Agent': 'FantasAI-Proxy/1.0', ...extraHeaders },
      cf: { cacheTtl: 60, cacheEverything: true },
    });
    const body = await res.text();
    return new Response(body, {
      status: res.status,
      headers: {
        ...corsHeaders(),
        'Content-Type': res.headers.get('Content-Type') || 'application/json',
        'X-Proxy-Status': String(res.status),
      },
    });
  } catch (err) {
    return json({ error: `Proxy fetch failed: ${err.message}` }, 502);
  }
}

// ── Schedule ──────────────────────────────────────────────────────────────────

async function handleScheduleLoad(env) {
  try {
    const res = await s3Fetch(env, 'GET', S3_SCHEDULE_KEY, null);
    if (res.status === 404) return json({ schedule: null, fromS3: false }, 200);
    if (!res.ok) return json({ schedule: null, fromS3: false }, 200);
    const data = await res.json();
    return json({ schedule: data.schedule || null, savedAt: data.savedAt || null, fromS3: true }, 200);
  } catch {
    return json({ schedule: null, fromS3: false }, 200);
  }
}

async function handleScheduleSave(request, env) {
  const body = await request.json().catch(() => ({}));
  const { schedule } = body;
  if (!schedule || typeof schedule !== 'object') return json({ error: 'schedule object required' }, 400);

  const payload = { schedule, savedAt: new Date().toISOString() };
  const put = await s3Fetch(env, 'PUT', S3_SCHEDULE_KEY, payload);
  if (!put.ok) throw new Error(`S3 PUT ${put.status}`);
  return json({ ok: true, savedAt: payload.savedAt }, 200);
}

// ── League Settings (all commissioner/admin config) ───────────────────────────

async function handleLeagueSettingsLoad(url, env) {
  const leagueId = url.searchParams.get('leagueId');

  // Try leagueId-scoped key first (new path)
  if (leagueId) {
    try {
      const res = await s3Fetch(env, 'GET', `${leagueId}/league-settings.json`, null);
      if (res.ok) {
        const data = await res.json();
        return json({ settings: data.settings ?? null, teams: data.teams ?? null, savedAt: data.savedAt ?? null, fromS3: true }, 200);
      }
    } catch {}
  }

  // Fall back to legacy key
  try {
    const res = await s3Fetch(env, 'GET', S3_SETTINGS_KEY, null);
    if (res.status === 404) return json({ settings: null, teams: null, fromS3: false }, 200);
    if (!res.ok)            return json({ settings: null, teams: null, fromS3: false }, 200);
    const data = await res.json();
    return json({ settings: data.settings ?? null, teams: data.teams ?? null, savedAt: data.savedAt ?? null, fromS3: true }, 200);
  } catch {
    return json({ settings: null, teams: null, fromS3: false }, 200);
  }
}

async function handleLeagueSettingsSave(request, env) {
  const body = await request.json().catch(() => ({}));
  const { settings, teams, leagueId } = body;
  if (!settings && !teams) return json({ error: 'settings or teams required' }, 400);

  const s3key = leagueId ? `${leagueId}/league-settings.json` : S3_SETTINGS_KEY;

  // Read existing so we only overwrite fields the caller sent
  let existing = {};
  try {
    const res = await s3Fetch(env, 'GET', s3key, null);
    if (res.ok) existing = await res.json();
  } catch {}

  const payload = {
    settings: settings ?? existing.settings ?? null,
    teams:    teams    ?? existing.teams    ?? null,
    savedAt:  new Date().toISOString(),
  };
  const put = await s3Fetch(env, 'PUT', s3key, payload);
  if (!put.ok) throw new Error(`S3 PUT ${put.status}`);
  return json({ ok: true, savedAt: payload.savedAt }, 200);
}

// ── Community data (Champions Corner, Commish media, Happy Hours) ─────────────

async function handleCommunityLoad(env) {
  try {
    const res = await s3Fetch(env, 'GET', S3_COMMUNITY_KEY, null);
    if (res.status === 404) return json({ champions: [], commishMedia: null, happyHours: [] }, 200);
    if (!res.ok) return json({ champions: [], commishMedia: null, happyHours: [] }, 200);
    return json(await res.json(), 200);
  } catch {
    return json({ champions: [], commishMedia: null, happyHours: [] }, 200);
  }
}

async function handleCommunitySave(request, env) {
  const body = await request.json().catch(() => null);
  if (!body) return json({ error: 'JSON body required' }, 400);
  await s3Fetch(env, 'PUT', S3_COMMUNITY_KEY, body);
  return json({ ok: true, savedAt: new Date().toISOString() }, 200);
}

async function handleCommunityMediaUpload(url, request, env) {
  const filename = (url.searchParams.get('filename') || 'media').replace(/[^a-zA-Z0-9._-]/g, '_');
  const contentType = request.headers.get('Content-Type') || 'application/octet-stream';
  const key = `fantasai/media/${Date.now()}_${filename}`;
  const body = await request.arrayBuffer();
  if (!body.byteLength) return json({ error: 'Empty body' }, 400);
  await env.BUCKET.put(key, body, { httpMetadata: { contentType } });
  return json({ ok: true, key, path: `/api/v1/r2/${key}` }, 200);
}

// ── R2 Proxy (raw object access for Databricks) ───────────────────────────────

async function handleR2Proxy(request, env, url) {
  const method = request.method;

  if (env.FANTASAI_KEY) {
    const k = request.headers.get('X-FantasAI-Key');
    if (k !== env.FANTASAI_KEY) return json({ error: 'Unauthorized' }, 401);
  }

  if (!env.BUCKET) return json({ error: 'R2 binding not configured' }, 503);

  // GET /api/v1/r2/list?prefix=fantasai/&limit=1000
  if (url.pathname === '/api/v1/r2/list' && method === 'GET') {
    const prefix = url.searchParams.get('prefix') || '';
    const limit  = Math.min(parseInt(url.searchParams.get('limit') || '1000'), 5000);
    const listed  = await env.BUCKET.list({ prefix, limit });
    const objects = listed.objects.map(o => ({
      key:         o.key,
      size:        o.size,
      uploaded:    o.uploaded.toISOString(),
      contentType: o.httpMetadata?.contentType || null,
    }));
    return json({ objects, truncated: listed.truncated }, 200);
  }

  const key = decodeURIComponent(url.pathname.replace('/api/v1/r2/', ''));
  if (!key || key === '/api/v1/r2') return json({ error: 'Object key required' }, 400);

  if (method === 'GET') {
    const obj = await env.BUCKET.get(key);
    if (!obj) return json({ error: 'Not found' }, 404);
    const headers = {
      ...corsHeaders(),
      'Content-Type':   obj.httpMetadata?.contentType || 'application/octet-stream',
      'Content-Length': obj.size.toString(),
      'X-R2-Uploaded':  obj.uploaded.toISOString(),
    };
    if (obj.httpMetadata?.contentEncoding) headers['Content-Encoding'] = obj.httpMetadata.contentEncoding;
    return new Response(obj.body, { status: 200, headers });
  }

  if (method === 'PUT') {
    const contentType = request.headers.get('Content-Type') || 'application/octet-stream';
    await env.BUCKET.put(key, request.body, { httpMetadata: { contentType } });
    return json({ ok: true, key }, 201);
  }

  if (method === 'DELETE') {
    await env.BUCKET.delete(key);
    return json({ ok: true, key }, 200);
  }

  if (method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders() });

  return json({ error: 'Method not allowed' }, 405);
}

// ── Weather (WorldWeatherOnline) ──────────────────────────────────────────────

async function handleWeatherGet(env) {
  if (!env.BUCKET) return json({ teams: {}, fetched_at: null, cached: false }, 200);
  try {
    const obj = await env.BUCKET.get(S3_WEATHER_KEY);
    if (!obj) return json({ teams: {}, fetched_at: null, cached: false }, 200);
    const data = JSON.parse(await obj.text());
    return json({ ...data, cached: true }, 200);
  } catch (err) {
    return json({ teams: {}, fetched_at: null, cached: false, error: err.message }, 200);
  }
}

async function handleWeatherRefresh(request, env) {
  if (!env.BUCKET) return json({ error: 'R2 binding not configured' }, 503);
  if (!env.WWO_API_KEY) {
    return json({ error: 'WWO_API_KEY not configured — run: wrangler secret put WWO_API_KEY' }, 503);
  }

  // Enforce 30-minute cooldown to protect WWO daily quota (500 calls/day free tier)
  try {
    const existing = await env.BUCKET.get(S3_WEATHER_KEY);
    if (existing) {
      const prev = JSON.parse(await existing.text());
      const age  = Date.now() - new Date(prev.fetched_at || 0).getTime();
      if (age < WEATHER_COOLDOWN_MS) {
        const nextRefreshSec = Math.ceil((WEATHER_COOLDOWN_MS - age) / 1000);
        return json({
          ok: false, cached: true, teams: prev.teams || {},
          fetched_at: prev.fetched_at,
          message: `Rate limited — refresh available in ${nextRefreshSec}s`,
          next_refresh_sec: nextRefreshSec,
        }, 200);
      }
    }
  } catch {}

  const body = await request.json().catch(() => ({}));
  const numDays = Math.min(parseInt(body.days || '7'), 7);

  const results = {};
  const errors  = [];

  // Dome teams — no weather data needed
  for (const [team, info] of Object.entries(NFL_TEAMS)) {
    if (info.dome) results[team] = { team, city: info.city, is_dome: true, forecast: null };
  }

  // Fetch outdoor teams in batches of 5 (WWO allows ~5 concurrent)
  const outdoor    = Object.entries(NFL_TEAMS).filter(([, v]) => !v.dome);
  const BATCH_SIZE = 5;

  for (let i = 0; i < outdoor.length; i += BATCH_SIZE) {
    const batch = outdoor.slice(i, i + BATCH_SIZE);
    await Promise.all(batch.map(async ([team, info]) => {
      try {
        const wwoUrl = `https://api.worldweatheronline.com/premium/v1/weather.ashx` +
          `?key=${env.WWO_API_KEY}&q=${encodeURIComponent(info.city)}` +
          `&format=json&num_of_days=${numDays}&hourly=1&tp=1&lang=en`;
        const res = await fetch(wwoUrl, { signal: AbortSignal.timeout(12000) });
        if (!res.ok) throw new Error(`WWO HTTP ${res.status}`);
        const data = await res.json();
        if (data.data?.error) throw new Error(data.data.error[0]?.msg || 'WWO error');
        results[team] = { team, city: info.city, is_dome: false, forecast: shapeWWOForecast(data) };
      } catch (err) {
        errors.push(`${team}: ${err.message}`);
        results[team] = { team, city: info.city, is_dome: false, forecast: null, error: err.message };
      }
    }));
    if (i + BATCH_SIZE < outdoor.length) await sleep(1100); // ~1 req/sec headroom
  }

  const payload = {
    fetched_at:    new Date().toISOString(),
    num_days:      numDays,
    team_count:    Object.keys(results).length,
    outdoor_count: outdoor.length,
    teams:         results,
  };

  await env.BUCKET.put(S3_WEATHER_KEY, JSON.stringify(payload), {
    httpMetadata: { contentType: 'application/json' },
  });

  return json({
    ok:          true,
    fetched_at:  payload.fetched_at,
    team_count:  payload.team_count,
    error_count: errors.length,
    errors,
    teams:       results,
  }, 200);
}

function shapeWWOForecast(raw) {
  return (raw.data?.weather || []).map(day => ({
    date:       day.date,
    max_temp_f: parseInt(day.maxtempF  || 0),
    min_temp_f: parseInt(day.mintempF  || 0),
    hourly: (day.hourly || []).map(h => ({
      time:            h.time,
      temp_f:          parseInt(h.tempF          || 0),
      feels_like_f:    parseInt(h.FeelsLikeF     || 0),
      wind_mph:        parseInt(h.windspeedMiles  || 0),
      wind_dir:        h.winddir16Point           || '',
      precip_in:       Math.round((parseFloat(h.precipMM || 0) / 25.4) * 100) / 100,
      humidity_pct:    parseInt(h.humidity       || 0),
      cloud_cover_pct: parseInt(h.cloudcover     || 0),
      condition:       h.weatherDesc?.[0]?.value || '',
    })),
  }));
}

// ── League Transactions (R2-backed, no auth required for reads or writes) ────
const TX_R2_KEY = 'fantasai/league/transactions.json';
const TX_MAX    = 300;

async function handleTransactionsGet(env) {
  if (!env.BUCKET) return json([], 200);
  const obj = await env.BUCKET.get(TX_R2_KEY);
  if (!obj) return json([], 200);
  try {
    const data = await obj.json();
    return json(Array.isArray(data) ? data : [], 200);
  } catch {
    return json([], 200);
  }
}

async function handleTransactionsPost(request, env) {
  if (!env.BUCKET) return json({ error: 'R2 not configured' }, 503);
  let tx;
  try { tx = await request.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }
  if (!tx || !tx.type || !tx.timestamp) return json({ error: 'Missing type or timestamp' }, 400);

  const obj = await env.BUCKET.get(TX_R2_KEY);
  let existing = [];
  if (obj) { try { existing = await obj.json(); } catch {} }
  if (!Array.isArray(existing)) existing = [];

  const updated = [tx, ...existing].slice(0, TX_MAX);
  await env.BUCKET.put(TX_R2_KEY, JSON.stringify(updated), {
    httpMetadata: { contentType: 'application/json' },
  });
  return json({ ok: true, count: updated.length }, 200);
}

// ── Web Scrape Proxy ─────────────────────────────────────────────────────────
// POST /api/v1/scrape — fetch any public URL server-side (bypasses CORS)
// Returns { html, url } or { error }. Caps response at 600 KB.

async function handleScrape(request) {
  let body;
  try { body = await request.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }
  const target = (body.url || '').trim();
  if (!target) return json({ error: 'url required' }, 400);
  let parsed;
  try { parsed = new URL(target); } catch { return json({ error: 'Invalid URL' }, 400); }
  if (!['http:', 'https:'].includes(parsed.protocol)) return json({ error: 'Only http/https URLs allowed' }, 400);

  try {
    const res = await fetch(target, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Cache-Control': 'no-cache',
      },
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) return json({ error: `Site returned HTTP ${res.status}` }, 502);
    const text = await res.text();
    return json({ html: text.slice(0, 600000), url: target, status: res.status }, 200);
  } catch (err) {
    return json({ error: `Fetch failed: ${err.message}` }, 502);
  }
}

// ── Cloudflare R2 (native binding) ───────────────────────────────────────────
// Wraps env.BUCKET with the same call signature as the old s3Fetch so every
// handler above stays unchanged: s3Fetch(env, 'GET'|'PUT'|'DELETE', key, body)

async function s3Fetch(env, method, key, body) {
  if (!env.BUCKET) throw new Error('R2 binding BUCKET not configured — check wrangler.toml [[r2_buckets]]');

  if (method === 'GET') {
    const obj = await env.BUCKET.get(key);
    if (!obj) {
      return { ok: false, status: 404, text: async () => '', json: async () => ({}) };
    }
    const text = await obj.text();
    return { ok: true, status: 200, text: async () => text, json: async () => JSON.parse(text) };
  }

  if (method === 'PUT' || method === 'POST') {
    const bodyStr = body != null ? JSON.stringify(body) : '';
    await env.BUCKET.put(key, bodyStr, { httpMetadata: { contentType: 'application/json' } });
    return { ok: true, status: 200, text: async () => '' };
  }

  if (method === 'DELETE') {
    await env.BUCKET.delete(key);
    return { ok: true, status: 204, text: async () => '' };
  }

  throw new Error(`Unsupported method: ${method}`);
}

// ── Shared helpers ────────────────────────────────────────────────────────────

function resolveWeekParams(url) {
  const week   = parseInt(url.searchParams.get('week')   || '1');
  const season = parseInt(url.searchParams.get('season') || new Date().getFullYear());
  const type   = url.searchParams.get('type') || 'regular';
  return { week, season, type };
}

// ── FantasAI Chat (Databricks proxy) ─────────────────────────────────────────
async function handleChat(request, env) {
  let body;
  try { body = await request.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }

  const question      = (body.question || '').trim();
  if (!question) return json({ error: 'question is required' }, 400);

  const context       = (body.context || '').trim();
  const rosterPlayers = Array.isArray(body.rosterPlayers) ? body.rosterPlayers : [];

  const workspaceUrl = (env.DATABRICKS_URL || '').replace(/\/$/, '');
  const token        = env.DATABRICKS_TOKEN;
  if (!workspaceUrl || !token) {
    return json({ error: 'AI endpoint not configured — set DATABRICKS_URL and DATABRICKS_TOKEN secrets' }, 503);
  }

  // #2 — Server-side live enrichment: fetch real-time injury data for roster players
  let liveEnrichment = '';
  if (rosterPlayers.length > 0) {
    try { liveEnrichment = await buildLiveEnrichment(rosterPlayers, env); }
    catch (err) { console.warn('Live enrichment skipped:', err.message); }
  }

  const enrichedContext = liveEnrichment ? `${context}\n\n${liveEnrichment}` : context;
  const fullQuestion    = enrichedContext ? `${enrichedContext}\n\nUser question: ${question}` : question;

  // #3 — CF Cache: check before hitting Databricks
  const cacheKey = await chatCacheKey(fullQuestion);
  const cache    = caches.default;
  const cached   = await cache.match(cacheKey);
  if (cached) {
    const data = await cached.json();
    return new Response(JSON.stringify({ ...data, cached: true }), {
      status: 200,
      headers: { ...corsHeaders(), 'Content-Type': 'application/json' },
    });
  }

  // #1 — Retry logic: up to 3 attempts with backoff (handles Databricks cold starts)
  const endpointUrl = `${workspaceUrl}/serving-endpoints/fantasai-chat-api/invocations`;
  let answer, lastErr;
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) await sleep(1500 * attempt);
    try {
      const res = await fetch(endpointUrl, {
        method:  'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body:    JSON.stringify({ inputs: { question: [fullQuestion] } }),
        signal:  AbortSignal.timeout(28000),
      });
      if (!res.ok) {
        const detail = await res.text().catch(() => '');
        throw new Error(`Databricks ${res.status}: ${detail.slice(0, 200)}`);
      }
      const data = await res.json();
      const raw  = data?.predictions?.[0];
      answer  = typeof raw === 'string' ? raw : (raw?.answer ?? JSON.stringify(raw));
      lastErr = null;
      break;
    } catch (err) {
      lastErr = err;
      console.warn(`Databricks attempt ${attempt + 1}/3 failed: ${err.message}`);
    }
  }

  if (lastErr) return json({ error: `Databricks unreachable: ${lastErr.message}` }, 502);

  // #3 — Store in CF Cache for 5 minutes
  const payload      = { answer };
  const cacheResponse = new Response(JSON.stringify(payload), {
    status:  200,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=300' },
  });
  await cache.put(cacheKey, cacheResponse);

  return json(payload, 200);
}

async function buildLiveEnrichment(rosterPlayers, env) {
  const base = env.SLEEPER_BASE || 'https://api.sleeper.app/v1';
  const res  = await fetch(`${base}/players/nfl`, {
    headers: { Accept: 'application/json' },
    cf: { cacheTtl: 600, cacheEverything: true },
  });
  if (!res.ok) throw new Error(`Sleeper /players/nfl → ${res.status}`);
  const allPlayers = await res.json();

  // Build name → Sleeper player map
  const byName = {};
  for (const p of Object.values(allPlayers)) {
    const name = p.full_name || [p.first_name, p.last_name].filter(Boolean).join(' ');
    if (name) byName[name.toLowerCase()] = p;
  }

  const lines = [];
  for (const rp of rosterPlayers) {
    const sp = byName[rp.name?.toLowerCase()];
    if (!sp) continue;
    const status   = sp.injury_status && sp.injury_status !== 'Na' ? sp.injury_status : 'Active';
    const injNote  = sp.injury_notes ? ` — ${sp.injury_notes}` : '';
    const injPart  = sp.injury_body_part ? ` (${sp.injury_body_part})` : '';
    lines.push(`  ${rp.pos}: ${rp.name} (${rp.team}) — Status: ${status}${injPart}${injNote}`);
  }

  return lines.length > 0
    ? `LIVE INJURY DATA (real-time):\n${lines.join('\n')}`
    : '';
}

async function chatCacheKey(prompt) {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(prompt));
  const hex  = [...new Uint8Array(hash)].map(x => x.toString(16).padStart(2, '0')).join('');
  return `https://cache.fantasai.internal/chat/${hex}`;
}

// ── Beat Writers (Nitter RSS) ─────────────────────────────────────────────────

function parseRSS(xml) {
  const items = [];
  const itemRe = /<item>([\s\S]*?)<\/item>/gi;
  let m;
  while ((m = itemRe.exec(xml)) !== null) {
    const block = m[1];
    const get = tag => {
      const re = new RegExp(`<${tag}[^>]*>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?<\\/${tag}>`, 'i');
      return (re.exec(block)?.[1] || '').trim();
    };
    const rawTitle = get('title');
    const pubDate  = get('pubDate') || get('updated');
    const link     = get('link') || get('guid');
    const text = rawTitle
      .replace(/^[^:]+:\s*/, '')   // strip "handle: " prefix that Nitter adds
      .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
      .replace(/&#39;/g, "'").replace(/&quot;/g, '"')
      .trim();
    if (text && text.length > 10) {
      items.push({ text, publishedAt: pubDate ? new Date(pubDate).toISOString() : null, url: link });
    }
  }
  return items;
}

async function handleBeatWriterNews() {
  const ua   = 'Mozilla/5.0 (compatible; FantasAI/1.0)';
  const hdrs = { 'User-Agent': ua, 'Accept': 'application/rss+xml, application/xml, text/xml, */*' };

  // ── 1. Try Nitter ────────────────────────────────────────────────────────────
  let workingInstance = null;
  let nitterItems = [];
  const first = BEAT_WRITERS[0];

  for (const inst of NITTER_INSTANCES) {
    try {
      const res = await fetch(`${inst}/${first.handle}/rss`, { signal: AbortSignal.timeout(4000), headers: hdrs });
      if (res.ok) {
        const parsed = parseRSS(await res.text());
        if (parsed.length > 0) { workingInstance = inst; nitterItems = parsed; break; }
      }
    } catch {}
  }

  if (workingInstance) {
    const settled = await Promise.allSettled(
      BEAT_WRITERS.slice(1).map(async writer => {
        try {
          const res = await fetch(`${workingInstance}/${writer.handle}/rss`, { signal: AbortSignal.timeout(8000), headers: hdrs });
          if (!res.ok) return null;
          return { writer, items: parseRSS(await res.text()) };
        } catch { return null; }
      })
    );
    const allItems = nitterItems.slice(0, 20).map(i => ({
      ...i, handle: first.handle, reporter: first.name, category: first.category, team: first.team || null,
    }));
    for (const f of settled) {
      if (f.status !== 'fulfilled' || !f.value) continue;
      const { writer, items } = f.value;
      for (const item of items.slice(0, 20))
        allItems.push({ ...item, handle: writer.handle, reporter: writer.name, category: writer.category, team: writer.team || null });
    }
    allItems.sort((a, b) => (new Date(b.publishedAt||0) - new Date(a.publishedAt||0)));
    return json({ source: 'beat-writers', fetchedAt: new Date().toISOString(), via: 'nitter', instance: workingInstance, writerCount: BEAT_WRITERS.length, count: allItems.length, items: allItems.slice(0, 500) }, 200);
  }

  // ── 2. Nitter unavailable — fall back to stable NFL news RSS feeds ────────────
  const fallbackSettled = await Promise.allSettled(
    BEAT_FALLBACK_RSS.map(async feed => {
      try {
        const res = await fetch(feed.url, { signal: AbortSignal.timeout(10000), headers: hdrs });
        if (!res.ok) return null;
        const items = parseRSS(await res.text());
        return { feed, items };
      } catch { return null; }
    })
  );

  const fallbackItems = [];
  for (const f of fallbackSettled) {
    if (f.status !== 'fulfilled' || !f.value) continue;
    const { feed, items } = f.value;
    for (const item of items.slice(0, 100)) {
      fallbackItems.push({ ...item, handle: feed.handle, reporter: feed.reporter, category: feed.category, team: null });
    }
  }

  if (fallbackItems.length === 0) {
    return json({ source: 'beat-writers', fetchedAt: new Date().toISOString(), via: 'none', error: 'Nitter unavailable and fallback RSS feeds failed', writerCount: BEAT_WRITERS.length, items: [] }, 200);
  }

  fallbackItems.sort((a, b) => (new Date(b.publishedAt||0) - new Date(a.publishedAt||0)));
  return json({ source: 'beat-writers', fetchedAt: new Date().toISOString(), via: 'rss-fallback', writerCount: BEAT_WRITERS.length, count: fallbackItems.length, items: fallbackItems.slice(0, 500) }, 200);
}

// ── Databricks SQL Warehouse ──────────────────────────────────────────────────

async function queryDatabricks(sql, env) {
  let host = (env.DATABRICKS_HOST || env.DATABRICKS_URL || '').replace(/\/$/, '');
  if (host && !host.startsWith('http')) host = `https://${host}`;
  const token = env.DATABRICKS_TOKEN;
  // DATABRICKS_HTTP_PATH (from Databricks "Connection Details") takes precedence over
  // DATABRICKS_WAREHOUSE_ID because the HTTP path contains the real short warehouse ID.
  // Format: /sql/1.0/warehouses/<hex-id>
  let warehouseId = env.DATABRICKS_WAREHOUSE_ID;
  if (env.DATABRICKS_HTTP_PATH) {
    const m = env.DATABRICKS_HTTP_PATH.match(/\/warehouses\/([a-f0-9]+)/i);
    if (m) warehouseId = m[1];
  }
  if (!host || !token || !warehouseId) throw new Error('DATABRICKS_HOST, DATABRICKS_TOKEN, and DATABRICKS_WAREHOUSE_ID (or DATABRICKS_HTTP_PATH) must be set');

  const res = await fetch(`${host}/api/2.0/sql/statements`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ statement: sql, warehouse_id: warehouseId, wait_timeout: '30s' }),
    signal: AbortSignal.timeout(35000),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(`Databricks HTTP ${res.status}: ${data.message || data.error_code || JSON.stringify(data).slice(0, 300)}`);
  }
  if (!data.status) {
    throw new Error(`Databricks unexpected response: ${JSON.stringify(data).slice(0, 300)}`);
  }
  if (data.status.state !== 'SUCCEEDED') {
    const errMsg = data.status.error?.message
      || (data.status.state === 'PENDING' ? `warehouse is starting — state: PENDING (statement_id: ${data.statement_id})` : JSON.stringify(data.status));
    throw new Error(`Query failed [${data.status.state}]: ${errMsg}`);
  }
  const columns = data.manifest?.schema?.columns || [];
  const rows    = data.result?.data_array || [];
  return rows.map(row => {
    const obj = {};
    columns.forEach((col, idx) => { obj[col.name] = row[idx]; });
    return obj;
  });
}

async function handlePlayerProfile(url, env) {
  const raw  = url.pathname.split('/').pop();
  const name = decodeURIComponent(raw).replace(/'/g, "''"); // escape single quotes
  const rows = await queryDatabricks(
    `SELECT * FROM main.fantasai_news.api_player_profile WHERE player_name = '${name}' LIMIT 1`, env
  );
  return json({ status: 'success', data: rows[0] || null, metadata: { timestamp: new Date().toISOString() } }, 200);
}

// Preferred player tables in priority order (gold > silver > bronze dim > fallback)
const PLAYER_TABLE_CANDIDATES = [
  'gold_player_dim', 'silver_player_dim', 'dim_players', 'players',
  'player_dim', 'silver_players', 'gold_players', 'bronze_player_dim',
];

async function handleDbPlayers(env) {
  // Discover which player table exists in main.fantasai
  const tables = await queryDatabricks(`SHOW TABLES IN main.fantasai`, env);
  const tableNames = tables.map(t => t.tableName || t.table_name || '').filter(Boolean);

  let chosenTable = PLAYER_TABLE_CANDIDATES.find(c => tableNames.includes(c));
  if (!chosenTable) {
    // Fall back to any table whose name contains 'player'
    chosenTable = tableNames.find(n => n.includes('player'));
  }
  if (!chosenTable) {
    return json({
      source: 'databricks', error: 'No player table found',
      availableTables: tableNames,
      fetchedAt: new Date().toISOString(), count: 0, players: [],
    }, 200);
  }

  const rows = await queryDatabricks(`SELECT * FROM main.fantasai.${chosenTable} LIMIT 2000`, env);
  return json({ source: 'databricks', table: chosenTable, fetchedAt: new Date().toISOString(), count: rows.length, players: rows }, 200);
}

async function handleDbTables(env) {
  const rows = await queryDatabricks(`SHOW TABLES IN main.fantasai`, env);
  return json({ source: 'databricks', fetchedAt: new Date().toISOString(), tables: rows }, 200);
}

async function handleDbNews(env) {
  const rows = await queryDatabricks(`SELECT * FROM main.fantasai_news.api_news_feed LIMIT 20`, env);
  return json({ status: 'success', data: rows, metadata: { timestamp: new Date().toISOString(), count: rows.length } }, 200);
}

// Normalize a Databricks row to the frontend article shape regardless of column naming conventions
function normalizeArticleRow(r) {
  const headline    = r.headline    || r.title       || r.article_title || '';
  const article_url = r.article_url || r.url         || r.source_url    || r.link || '';
  const player_name = r.player_name || r.primary_player_name || r.mentioned_player || '';
  const position    = r.position    || r.player_position     || r.pos  || '';
  const team        = r.team        || r.player_team         || '';
  const published_at= r.published_at|| r.published_date      || r.created_at || null;
  const publisher   = r.publisher   || r.source      || r.feed_source   || r.domain || '';
  const description = r.description || r.summary     || r.full_text     || r.snippet || '';
  const article_rank= r.article_rank ?? r.rank ?? r.relevance_score ?? null;
  if (!headline || !article_url) return null;
  return { headline, article_url, player_name, position: (position || '').toUpperCase(), team, published_at, publisher, description, article_rank };
}

async function handleDbArticles(url, env) {
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '500'), 1000);
  let articles = [];
  let source = 'none';

  // Try enriched_news first (articles tagged with player mentions) — gold layer
  try {
    const rows = await queryDatabricks(
      `SELECT * FROM main.fantasai_news.enriched_news ORDER BY published_at DESC LIMIT ${limit}`, env
    );
    if (rows.length > 0) {
      articles = rows.map(normalizeArticleRow).filter(Boolean);
      source = 'enriched_news';
    }
  } catch (_) {}

  // Fall back to raw_rss_articles if enriched_news is empty or unavailable
  if (articles.length === 0) {
    try {
      const rows = await queryDatabricks(
        `SELECT * FROM main.fantasai_news.raw_rss_articles ORDER BY published_at DESC LIMIT ${limit}`, env
      );
      if (rows.length > 0) {
        articles = rows.map(normalizeArticleRow).filter(Boolean);
        source = 'raw_rss_articles';
      }
    } catch (_) {}
  }

  // Final fallback: api_news_feed view (always available, fewer rows)
  if (articles.length === 0) {
    try {
      const rows = await queryDatabricks(
        `SELECT * FROM main.fantasai_news.api_news_feed ORDER BY published_at DESC LIMIT 100`, env
      );
      articles = rows.map(normalizeArticleRow).filter(Boolean);
      source = 'api_news_feed';
    } catch (_) {}
  }

  return json({
    status: 'success',
    source,
    articles,
    metadata: { timestamp: new Date().toISOString(), count: articles.length },
  }, 200);
}

async function handleDbCritical(env) {
  const rows = await queryDatabricks(`SELECT * FROM main.fantasai_news.api_critical_alerts LIMIT 20`, env);
  return json({ status: 'success', data: rows, metadata: { timestamp: new Date().toISOString(), count: rows.length } }, 200);
}

async function handleDbLeaderboard(env) {
  const rows = await queryDatabricks(`SELECT * FROM main.fantasai_news.api_live_leaderboard LIMIT 50`, env);
  return json({ status: 'success', data: rows, metadata: { timestamp: new Date().toISOString(), count: rows.length } }, 200);
}

async function handleDbActiveGames(env) {
  const rows = await queryDatabricks(
    `SELECT DISTINCT game_id, game_status, quarter, time_remaining FROM main.fantasai_news.live_game_stats WHERE game_status IN ('in progress', 'halftime')`, env
  );
  return json({ status: 'success', data: rows, metadata: { timestamp: new Date().toISOString(), count: rows.length } }, 200);
}

async function handleDbOpportunity(env) {
  const rows = await queryDatabricks(
    `SELECT player_name, position, team, opportunity_score, opportunity_tier as tier FROM main.fantasai.player_opportunity_scores ORDER BY opportunity_score DESC LIMIT 100`, env
  );
  return json({ status: 'success', data: rows, metadata: { timestamp: new Date().toISOString(), count: rows.length } }, 200);
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ============================================================
// Web Push — VAPID JWT + RFC 8291 payload encryption
// ============================================================

function wpB64url(input) {
  let bytes;
  if (typeof input === 'string') bytes = new TextEncoder().encode(input);
  else if (input instanceof ArrayBuffer) bytes = new Uint8Array(input);
  else bytes = input;
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

function wpFromB64url(str) {
  const p = str.replace(/-/g, '+').replace(/_/g, '/');
  const padded = p + '='.repeat((4 - p.length % 4) % 4);
  const raw = atob(padded);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

function wpJoin(...parts) {
  const u8s = parts.map(p =>
    typeof p === 'string' ? new TextEncoder().encode(p) :
    p instanceof ArrayBuffer ? new Uint8Array(p) :
    Array.isArray(p) ? new Uint8Array(p) : p
  );
  const out = new Uint8Array(u8s.reduce((n, a) => n + a.length, 0));
  let off = 0;
  for (const a of u8s) { out.set(a, off); off += a.length; }
  return out;
}

async function wpHmac(keyBytes, data) {
  const key = await crypto.subtle.importKey(
    'raw', keyBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, data));
}

async function wpHkdf(salt, ikm, info, len) {
  const prk = await wpHmac(salt, ikm);
  const infoBytes = typeof info === 'string' ? new TextEncoder().encode(info) : info;
  const blocks = [];
  let prev = new Uint8Array(0);
  while (blocks.reduce((n, b) => n + b.length, 0) < len) {
    prev = await wpHmac(prk, wpJoin(prev, infoBytes, new Uint8Array([blocks.length + 1])));
    blocks.push(prev);
  }
  return wpJoin(...blocks).slice(0, len);
}

async function wpVapidJWT(endpoint, privJwk) {
  const origin = new URL(endpoint).origin;
  const now    = Math.floor(Date.now() / 1000);
  const header  = wpB64url(JSON.stringify({ typ: 'JWT', alg: 'ES256' }));
  const payload = wpB64url(JSON.stringify({ aud: origin, exp: now + 43200, sub: 'mailto:kingoffrisco@yahoo.com' }));
  const sigInput = `${header}.${payload}`;
  const privKey = await crypto.subtle.importKey(
    'jwk', privJwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']
  );
  const sig = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' }, privKey, new TextEncoder().encode(sigInput)
  );
  return `${sigInput}.${wpB64url(sig)}`;
}

async function wpEncrypt(sub, payloadStr) {
  const p256dh = wpFromB64url(sub.keys.p256dh);
  const auth   = wpFromB64url(sub.keys.auth);
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
  const salt  = crypto.getRandomValues(new Uint8Array(16));
  const ikm   = await wpHkdf(auth, sharedSecret, wpJoin('WebPush: info\x00', p256dh, senderPubRaw), 32);
  const cek   = await wpHkdf(salt, ikm, 'Content-Encoding: aes128gcm\x00', 16);
  const nonce = await wpHkdf(salt, ikm, 'Content-Encoding: nonce\x00', 12);
  const cekKey = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  const record = wpJoin(new TextEncoder().encode(payloadStr), [2]);
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, cekKey, record)
  );
  const hdr = new Uint8Array(21 + senderPubRaw.length);
  hdr.set(salt, 0);
  new DataView(hdr.buffer).setUint32(16, 4096, false);
  hdr[20] = senderPubRaw.length;
  hdr.set(senderPubRaw, 21);
  return wpJoin(hdr, ciphertext);
}

async function wpSendOne(sub, notification, env) {
  const privJwk = JSON.parse(env.VAPID_PRIVATE_KEY);
  const jwt  = await wpVapidJWT(sub.endpoint, privJwk);
  const body = await wpEncrypt(sub, JSON.stringify(notification));
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

async function wpSubKey(endpoint) {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(endpoint));
  return 'sub:' + Array.from(new Uint8Array(hash)).slice(0, 12)
    .map(b => b.toString(16).padStart(2, '0')).join('');
}

async function handlePushSubscribe(request, env) {
  let sub;
  try { sub = await request.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }
  if (!sub?.endpoint || !sub?.keys?.p256dh || !sub?.keys?.auth)
    return json({ error: 'Invalid subscription' }, 400);
  if (env.PUSH_SUBS) {
    const key = await wpSubKey(sub.endpoint);
    await env.PUSH_SUBS.put(key, JSON.stringify(sub));
  }
  return json({ ok: true });
}

async function handlePushUnsubscribe(request, env) {
  let body;
  try { body = await request.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }
  if (env.PUSH_SUBS && body?.endpoint) {
    const key = await wpSubKey(body.endpoint);
    await env.PUSH_SUBS.delete(key);
  }
  return json({ ok: true });
}

async function handlePushSend(request, env) {
  // Require commish key
  const k = request.headers.get('X-FantasAI-Key');
  if (!env.FANTASAI_KEY || k !== env.FANTASAI_KEY) return json({ error: 'Unauthorized' }, 401);
  if (!env.VAPID_PRIVATE_KEY || !env.VAPID_PUBLIC_KEY)
    return json({ error: 'VAPID secrets not configured — add VAPID_PRIVATE_KEY and VAPID_PUBLIC_KEY in Worker settings' }, 500);
  if (!env.PUSH_SUBS)
    return json({ error: 'PUSH_SUBS KV not bound — see wrangler.toml' }, 500);

  let payload;
  try { payload = await request.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }
  const { teamIds, ...notification } = payload;

  const list = await env.PUSH_SUBS.list({ prefix: 'sub:' });
  let subs = (await Promise.all(
    list.keys.map(k => env.PUSH_SUBS.get(k.name).then(v => v ? JSON.parse(v) : null))
  )).filter(Boolean);

  // If specific team IDs requested, filter to only their subscriptions
  if (Array.isArray(teamIds) && teamIds.length > 0) {
    subs = subs.filter(s => teamIds.includes(s._teamId));
  }

  const results = await Promise.allSettled(
    subs.map(async sub => {
      const status = await wpSendOne(sub, notification, env);
      if (status === 410 || status === 404) {
        const key = await wpSubKey(sub.endpoint);
        await env.PUSH_SUBS.delete(key);
      }
      return status;
    })
  );

  return json({
    ok: true,
    sent: subs.length,
    statuses: results.map(r => r.status === 'fulfilled' ? r.value : `err:${r.reason?.message}`),
  });
}

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin':  '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-FantasAI-Key, X-CBS-Cookie',
    'Access-Control-Max-Age':       '86400',
  };
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { ...corsHeaders(), 'Content-Type': 'application/json; charset=utf-8' },
  });
}

// ── League Management ─────────────────────────────────────────────────────────

async function handleLeagueCreate(request, env) {
  const { name, teams, email, password } = await request.json();
  if (!name || !email || !password) return json({ error: 'name, email, and password are required.' }, 400);

  // Generate a short unique league ID (timestamp + random)
  const leagueId = `league_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
  const configKey = `fantasai/leagues/${leagueId}/owners-config.json`;
  const leagueKey = `fantasai/leagues/${leagueId}/league-config.json`;

  const commissionerEntry = { email, password, isCommissioner: true, passwordSet: true, name: 'Commissioner' };
  const ownersConfig = { '1': commissionerEntry };
  const leagueConfig = { leagueId, name, teams: parseInt(teams) || 12, createdAt: new Date().toISOString(), platform: 'fantasai' };

  try {
    await env.BUCKET.put(configKey, JSON.stringify(ownersConfig), { httpMetadata: { contentType: 'application/json' } });
    await env.BUCKET.put(leagueKey, JSON.stringify(leagueConfig), { httpMetadata: { contentType: 'application/json' } });
  } catch (err) {
    return json({ error: `Storage error: ${err.message}` }, 500);
  }

  return json({ ok: true, leagueId, name }, 200);
}

async function handleLeagueImport(request, env) {
  const { platform, leagueId, email, password } = await request.json();
  if (!platform || !leagueId || !email || !password) return json({ error: 'platform, leagueId, email, and password are required.' }, 400);

  let leagueName = `${platform} League`;
  let teams = 12;

  // For Sleeper, validate the league exists via the public API
  if (platform === 'sleeper') {
    try {
      const res = await fetch(`https://api.sleeper.app/v1/league/${leagueId}`, { signal: AbortSignal.timeout(8000) });
      if (!res.ok) return json({ error: `Sleeper league "${leagueId}" not found. Check your league ID.` }, 404);
      const data = await res.json();
      leagueName  = data.name || leagueName;
      teams       = data.total_rosters || teams;
    } catch {
      return json({ error: 'Could not reach Sleeper API — check your league ID and try again.' }, 502);
    }
  }

  const internalLeagueId = `import_${platform}_${leagueId.slice(0, 12)}`;
  const configKey  = `fantasai/leagues/${internalLeagueId}/owners-config.json`;
  const leagueKey  = `fantasai/leagues/${internalLeagueId}/league-config.json`;

  const commissionerEntry = { email, password, isCommissioner: true, passwordSet: true, name: 'Commissioner' };
  const ownersConfig = { '1': commissionerEntry };
  const leagueConfig = { leagueId: internalLeagueId, externalId: leagueId, name: leagueName, teams, platform, importedAt: new Date().toISOString() };

  try {
    await env.BUCKET.put(configKey, JSON.stringify(ownersConfig), { httpMetadata: { contentType: 'application/json' } });
    await env.BUCKET.put(leagueKey, JSON.stringify(leagueConfig), { httpMetadata: { contentType: 'application/json' } });
  } catch (err) {
    return json({ error: `Storage error: ${err.message}` }, 500);
  }

  return json({ ok: true, leagueId: internalLeagueId, name: leagueName }, 200);
}

function resetEmailHtml(link, name) {
  return `<!DOCTYPE html><html><body style="font-family:sans-serif;background:#0d0d0d;color:#e5e5e5;padding:32px">
<div style="max-width:440px;margin:0 auto;background:#181818;border-radius:12px;padding:32px;border:1px solid #2a2a2a">
  <div style="font-size:22px;font-weight:900;letter-spacing:-.03em;margin-bottom:4px">
    <span style="background:#c6ff3a;color:#0a1300;padding:2px 8px;border-radius:4px;font-size:13px;margin-right:6px">AI</span>FantasAI
  </div>
  <div style="color:#888;font-size:12px;margin-bottom:28px">Fantasy League Management</div>
  <h2 style="font-size:18px;margin:0 0 12px;color:#fff">Password reset, ${name}</h2>
  <p style="color:#aaa;font-size:14px;line-height:1.6;margin:0 0 28px">
    We received a request to reset your FantasAI password. Click the button below — this link expires in 1 hour.
  </p>
  <a href="${link}" style="display:inline-block;background:#c6ff3a;color:#0a1300;font-weight:800;font-size:14px;padding:12px 32px;border-radius:8px;text-decoration:none;letter-spacing:-.01em">
    Reset Password →
  </a>
  <p style="color:#444;font-size:11px;margin:28px 0 0;line-height:1.5">
    If you didn't request this, you can safely ignore this email. Your password won't change.
  </p>
</div></body></html>`;
}
