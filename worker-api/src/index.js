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
        if (url.pathname === '/api/v1/labels/article')        return await handleLabelsPost(request, env);
        if (url.pathname === '/api/v1/feedback/vote')         return await handleFeedbackVote(request, env);
        if (url.pathname === '/api/v1/user-prefs')            return await handleUserPrefsPost(request, env);
        if (url.pathname === '/api/v1/trade-offers')          return await handleTradeOffersPost(request, env);
        if (url.pathname === '/api/v1/waivers')               return await handleWaiversPost(request, env);
        if (url.pathname === '/api/v1/draft/ghost-pick')      return await handleGhostPick(request, env);
        if (url.pathname === '/api/v1/draft/ghost-reset')     return await handleGhostReset(request, env);
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
      if (url.pathname === '/api/v1/cbs/players')         return await handleCbsPlayers(request, env);
      if (url.pathname === '/api/v1/weather')            return await handleWeatherGet(env);
      if (url.pathname === '/api/v1/transactions')      return await handleTransactionsGet(env);
      if (url.pathname === '/api/v1/cbs/rankings')        return await handleCbsRankings(url, request, env);
      if (url.pathname === '/api/v1/twitter/beat')        return await handleBeatWriterNews();
      if (url.pathname.startsWith('/api/v1/player/'))   return await handlePlayerProfile(url, env);
      if (url.pathname === '/api/v1/db/players')          return await handleDbPlayers(env);
      if (url.pathname === '/api/v1/db/tables')           return await handleDbTables(env);
      if (url.pathname === '/api/v1/news/latest')        return await handleDbNews(env);
      if (url.pathname === '/api/v1/news/critical')      return await handleDbCritical(env);
      if (url.pathname === '/api/v1/news/articles')      return await handleDbArticles(url, env);
      if (url.pathname === '/api/v1/news/ai-summaries') return await handleDbAiSummaries(env);
      if (url.pathname === '/api/v1/labels/article')     return await handleLabelsGet(env);
      if (url.pathname === '/api/v1/feedback/scores')    return await handleFeedbackScores(env);
      if (url.pathname === '/api/v1/user-prefs')         return await handleUserPrefsGet(url, env);
      if (url.pathname === '/api/v1/trade-offers')       return await handleTradeOffersGet(env);
      if (url.pathname === '/api/v1/waivers')            return await handleWaiversGet(env);
      if (url.pathname === '/api/v1/draft/ghost-board')  return await handleGhostBoard(url, env);
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

async function handleCbsRankings(url, request, env) {
  if (!env.CBS_WORKER_URL) return json({ error: 'CBS_WORKER_URL not configured', rankings: [], source: 'cbs' }, 503);
  const pos    = url.searchParams.get('pos') || 'ALL';
  const cookie = request?.headers?.get('X-CBS-Cookie') || null;
  const data   = await cbsFetch(env, `/api/cbs/rankings?pos=${pos}`, cookie);
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: { ...corsHeaders(), 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=900' },
  });
}

async function handleCbsPlayers(request, env) {
  if (!env.CBS_WORKER_URL) return json({ error: 'CBS_WORKER_URL not configured', players: [], count: 0, source: 'cbs' }, 503);
  const cookie = request?.headers?.get('X-CBS-Cookie') || null;
  const data   = await cbsFetch(env, '/api/cbs/players', cookie);
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: { ...corsHeaders(), 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=300' },
  });
}

// ── Players (public, cached 1 h) ──────────────────────────────────────────────
// Includes: active roster, IR, suspended, practice squad, recent free agents.
// Excludes: retired players, college-only players, non-fantasy positions.

async function handlePlayers(url) {
  const limit     = Math.min(parseInt(url.searchParams.get('limit') || '2500', 10), 2500);
  const posFilter = (url.searchParams.get('pos') || 'QB,RB,WR,TE,K,DEF').split(',');

  const base = 'https://api.sleeper.app/v1';
  const res  = await fetch(`${base}/players/nfl`, {
    headers: { Accept: 'application/json' },
    cf: { cacheTtl: 3600, cacheEverything: true },
  });
  if (!res.ok) throw new Error(`Sleeper /players/nfl → ${res.status}`);

  const raw = await res.json();
  const players = Object.entries(raw)
    .filter(([, p]) => {
      if (!posFilter.includes(p.position)) return false;
      // Active/contracted players: active roster, IR, suspended, practice squad
      if (p.active) return true;
      // Free agents who have NFL experience and are still fantasy-relevant
      if (!p.team && p.years_exp > 0 && p.search_rank != null && p.search_rank < 500) return true;
      return false;
    })
    .map(([sleeperId, p]) => ({
      id:         sleeperId,
      name:       p.full_name || [p.first_name, p.last_name].filter(Boolean).join(' '),
      pos:        p.position,
      team:       p.team || 'FA',
      num:        p.number    || null,
      age:        p.age       || null,
      years_exp:  p.years_exp ?? null,
      status:     p.injury_status && p.injury_status !== 'Na' ? p.injury_status : 'OK',
      ecr:        p.search_rank   ?? 9999,
      adp:        p.search_rank   ?? 9999,
      owned:      p.search_rank != null
                    ? parseFloat(Math.max(0, 100 - p.search_rank * 0.28).toFixed(1))
                    : 0,
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

// ── FantasAI Chat ──────────────────────────────────────────────────────────────
// Priority: LOCAL_CHAT_URL (Ollama) → OPENAI_API_KEY (GPT-4o mini) → ANTHROPIC_API_KEY
// Recommended: set OPENAI_API_KEY for cloud chat — best reasoning + 128k context at ~$0.001/msg
const CHAT_SYSTEM_PROMPT =
  'You are FantasAI, an expert fantasy football copilot. ' +
  'Answer concisely and directly. Use bullet points for lists. ' +
  'Focus on actionable advice — start/sit decisions, waiver adds, trade values, injury impact. ' +
  'When roster context is provided, tailor your answer to those specific players.';

// ── Intent classification ────────────────────────────────────────────────────

const SIMPLE_RE  = /what happened|summarize|explain|who is|tell me about|injury report|depth chart|why is .{1,40} ranked|draft recap|news on|latest on/i;
const COMPLEX_RE = /dynasty|rebuild|3-team|three.team|\b3\+\s*player|\bfive.player|\bsalary cap|championship plan|multi.year|future pick|offseason plan|full season/i;

function classifyByKeywords(question) {
  if (COMPLEX_RE.test(question)) return 'complex';
  if (SIMPLE_RE.test(question))  return 'simple';
  return 'medium';
}

// ── Local chat server ────────────────────────────────────────────────────────

async function callLocalChat(userContent, rosterPlayers, tier, localUrl, fantasaiKey) {
  // 150s — 14B cold-start (model load ~30s) + generation (~60-90s) can exceed 90s
  const res = await fetch(localUrl.replace(/\/$/, '') + '/chat', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json', 'X-FantasAI-Key': fantasaiKey || '' },
    body:    JSON.stringify({ question: userContent, rosterPlayers, tier }),
    signal:  AbortSignal.timeout(150000),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`Local chat [${tier}] ${res.status}: ${detail.slice(0, 200)}`);
  }
  const data = await res.json();
  return data.answer ?? '';
}

// ── Cloud backends ───────────────────────────────────────────────────────────

// model: 'gpt-4o-mini' for medium fallback, 'gpt-4o' for complex
async function callOpenAI(userContent, apiKey, model = 'gpt-4o-mini') {
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method:  'POST',
    headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body:    JSON.stringify({
      model,
      max_tokens: 1024,
      messages:   [
        { role: 'system', content: CHAT_SYSTEM_PROMPT },
        { role: 'user',   content: userContent },
      ],
    }),
    signal: AbortSignal.timeout(28000),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`OpenAI [${model}] ${res.status}: ${detail.slice(0, 200)}`);
  }
  const data = await res.json();
  return data?.choices?.[0]?.message?.content ?? '';
}

async function callAnthropic(userContent, apiKey) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method:  'POST',
    headers: {
      'x-api-key':         apiKey,
      'anthropic-version': '2023-06-01',
      'content-type':      'application/json',
    },
    body:   JSON.stringify({
      model:      'claude-opus-4-8',
      max_tokens: 1024,
      system:     CHAT_SYSTEM_PROMPT,
      messages:   [{ role: 'user', content: userContent }],
    }),
    signal: AbortSignal.timeout(28000),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`Anthropic ${res.status}: ${detail.slice(0, 200)}`);
  }
  const data = await res.json();
  return data?.content?.[0]?.text ?? '';
}

async function handleChat(request, env) {
  let body;
  try { body = await request.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }

  const question      = (body.question || '').trim();
  if (!question) return json({ error: 'question is required' }, 400);

  const context       = (body.context || '').trim();
  const rosterPlayers = Array.isArray(body.rosterPlayers) ? body.rosterPlayers : [];

  const hasLocal     = !!env.LOCAL_CHAT_URL;
  const hasOpenAI    = !!env.OPENAI_API_KEY;
  const hasAnthropic = !!env.ANTHROPIC_API_KEY;
  if (!hasLocal && !hasOpenAI && !hasAnthropic) {
    return json({ error: 'No AI backend configured. Set OPENAI_API_KEY (recommended), LOCAL_CHAT_URL, or ANTHROPIC_API_KEY.' }, 503);
  }

  // Classify intent — explicit tier from client wins, otherwise keyword classify
  const tier = ['simple', 'medium', 'complex'].includes(body.tier)
    ? body.tier
    : classifyByKeywords(question);

  // Live enrichment: real-time injury data for roster players
  let liveEnrichment = '';
  if (rosterPlayers.length > 0) {
    try { liveEnrichment = await buildLiveEnrichment(rosterPlayers, env); }
    catch (err) { console.warn('Live enrichment skipped:', err.message); }
  }

  const enrichedContext = liveEnrichment ? `${context}\n\n${liveEnrichment}` : context;
  const userContent     = enrichedContext ? `${enrichedContext}\n\nUser question: ${question}` : question;

  // CF Cache: check before calling any AI
  const cacheKey = await chatCacheKey(userContent);
  const cache    = caches.default;
  const cached   = await cache.match(cacheKey);
  if (cached) {
    const data = await cached.json();
    return new Response(JSON.stringify({ ...data, cached: true }), {
      status: 200,
      headers: { ...corsHeaders(), 'Content-Type': 'application/json' },
    });
  }

  let answer, source, lastErr;

  // ── Routing logic ──────────────────────────────────────────────────────────
  // simple / medium  → local Qwen (8B or 14B) → cloud fallback
  // complex          → cloud first (GPT-4o)   → local fallback

  if (tier !== 'complex' && hasLocal) {
    try {
      answer = await callLocalChat(userContent, rosterPlayers, tier, env.LOCAL_CHAT_URL, env.FANTASAI_KEY);
      source = tier === 'simple' ? 'local-8b' : 'local-14b';
    } catch (err) {
      lastErr = err;
      console.warn(`Local [${tier}] failed: ${err.message} — escalating to cloud`);
    }
  }

  // Complex → GPT-4o directly; simple/medium cloud fallback → GPT-4o-mini
  if (answer == null && hasOpenAI) {
    const model = tier === 'complex' ? 'gpt-4o' : 'gpt-4o-mini';
    try {
      answer = await callOpenAI(userContent, env.OPENAI_API_KEY, model);
      source = `openai-${model}`;
      lastErr = null;
    } catch (err) {
      lastErr = err;
      console.warn(`OpenAI [${model}] failed: ${err.message} — trying Anthropic`);
    }
  }

  // Complex local fallback — if cloud unavailable, try local 14B
  if (answer == null && tier === 'complex' && hasLocal) {
    try {
      answer = await callLocalChat(userContent, rosterPlayers, 'complex', env.LOCAL_CHAT_URL, env.FANTASAI_KEY);
      source = 'local-14b-fallback';
      lastErr = null;
    } catch (err) {
      lastErr = err;
      console.warn(`Local complex fallback failed: ${err.message} — trying Anthropic`);
    }
  }

  // Anthropic — last resort for any tier
  if (answer == null && hasAnthropic) {
    for (let attempt = 0; attempt < 3; attempt++) {
      if (attempt > 0) await sleep(1500 * attempt);
      try {
        answer  = await callAnthropic(userContent, env.ANTHROPIC_API_KEY);
        source  = 'anthropic';
        lastErr = null;
        break;
      } catch (err) {
        lastErr = err;
        console.warn(`Anthropic attempt ${attempt + 1}/3 failed: ${err.message}`);
      }
    }
  }

  if (answer == null) return json({ error: `AI unreachable: ${lastErr?.message}` }, 502);

  // Store in CF Cache for 5 minutes
  const payload       = { answer, tier, source };
  const cacheResponse = new Response(JSON.stringify(payload), {
    status:  200,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=300' },
  });
  await cache.put(cacheKey, cacheResponse);

  console.log(`Chat [${tier}] answered via ${source}`);
  return json(payload, 200);
}

async function loadDefenseRanks(env) {
  // Returns { TEAM: rank } where rank 1 = toughest defense, 32 = easiest
  try {
    const r2Key = 'analysis/defense_performance.json';
    const obj   = await env.BUCKET.get(r2Key);
    if (!obj) return {};
    const data  = await obj.json();
    const arr   = data?.data || (Array.isArray(data) ? data : []);

    const latestByTeam = {};
    for (const row of arr) {
      const t = row.team;
      if (t && (!latestByTeam[t] || row.week > latestByTeam[t].week))
        latestByTeam[t] = row;
    }
    const sorted = Object.values(latestByTeam)
      .sort((a, b) => (b.avg_last_4_weeks || 0) - (a.avg_last_4_weeks || 0));
    const ranks = {};
    sorted.forEach((row, i) => { ranks[row.team] = i + 1; });
    return ranks;
  } catch {
    return {};
  }
}

async function buildLiveEnrichment(rosterPlayers, env) {
  const base = env.SLEEPER_BASE || 'https://api.sleeper.app/v1';

  // Fetch Sleeper player data and defense ranks in parallel
  const [sleeperRes, defRanks] = await Promise.all([
    fetch(`${base}/players/nfl`, {
      headers: { Accept: 'application/json' },
      cf: { cacheTtl: 600, cacheEverything: true },
    }),
    loadDefenseRanks(env),
  ]);

  if (!sleeperRes.ok) throw new Error(`Sleeper /players/nfl → ${sleeperRes.status}`);
  const allPlayers = await sleeperRes.json();

  // Build name → Sleeper player map
  const byName = {};
  for (const p of Object.values(allPlayers)) {
    const name = p.full_name || [p.first_name, p.last_name].filter(Boolean).join(' ');
    if (name) byName[name.toLowerCase()] = p;
  }

  const hasDefRanks = Object.keys(defRanks).length > 0;
  const lines = [];
  for (const rp of rosterPlayers) {
    const sp = byName[rp.name?.toLowerCase()];
    if (!sp) continue;
    const status  = sp.injury_status && sp.injury_status !== 'Na' ? sp.injury_status : 'Active';
    const injNote = sp.injury_notes    ? ` — ${sp.injury_notes}` : '';
    const injPart = sp.injury_body_part ? ` (${sp.injury_body_part})` : '';

    let defNote = '';
    if (hasDefRanks && rp.opp) {
      const rank = defRanks[rp.opp];
      if (rank) {
        const label = rank <= 5 ? 'elite defense (tough matchup)'
          : rank <= 10 ? 'strong defense'
          : rank <= 20 ? 'average defense'
          : 'weak defense (favorable matchup)';
        defNote = ` | vs ${rp.opp} def rank #${rank}/32 — ${label}`;
      }
    }

    lines.push(`  ${rp.pos}: ${rp.name} (${rp.team}) — Status: ${status}${injPart}${injNote}${defNote}`);
  }

  return lines.length > 0
    ? `LIVE ROSTER DATA (real-time injury + defense matchup):\n${lines.join('\n')}`
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

// Preferred player tables in priority order — export/gold only, never silver/bronze
const PLAYER_TABLE_CANDIDATES = [
  'export_players_2026_draft',
  'draft_ready_roster_2026',
  'gold_player_dim',
  'gold_players',
  'dim_players',
  'players',
  'player_dim',
];

async function handleDbPlayers(env) {
  // Try the priority list first without a SHOW TABLES round-trip
  let chosenTable = null;
  let rows = null;

  for (const candidate of PLAYER_TABLE_CANDIDATES) {
    try {
      const r = await queryDatabricks(
        `SELECT * FROM main.fantasai.${candidate} LIMIT 2500`, env
      );
      if (r && r.length > 0) { chosenTable = candidate; rows = r; break; }
    } catch {}
  }

  if (!chosenTable || !rows) {
    return json({
      source: 'databricks', error: 'No player table found',
      fetchedAt: new Date().toISOString(), count: 0, players: [],
    }, 200);
  }

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

  // Primary: export_player_news — combined gold table, player context already resolved
  try {
    const rows = await queryDatabricks(
      `SELECT news_id, headline, source_url, full_text, player_name, position, team, summary_text, fantasy_insight, impact_score, published_at FROM main.fantasai.export_player_news ORDER BY published_at DESC LIMIT ${limit}`, env
    );
    if (rows.length > 0) {
      articles = rows.map(r => {
        if (!r.headline || !r.source_url) return null;
        return {
          headline:        r.headline,
          article_url:     r.source_url,
          player_name:     r.player_name     || '',
          position:        (r.position || '').toUpperCase(),
          team:            r.team             || '',
          published_at:    r.published_at     || null,
          publisher:       'FantasAI',
          description:     r.summary_text     || r.full_text || '',
          summary_text:    r.summary_text     || '',
          fantasy_insight: r.fantasy_insight  || '',
          article_rank:    r.impact_score     ?? null,
          ai_processed:    !!(r.summary_text  || r.fantasy_insight),
        };
      }).filter(Boolean);
      source = 'export_player_news';
    }
  } catch (_) {}

  // Fallback: gold_enriched_news (full articles with entity extraction)
  if (articles.length === 0) {
    try {
      const rows = await queryDatabricks(
        `SELECT headline, source_url, full_text, source_name, published_at FROM main.fantasai.gold_enriched_news ORDER BY published_at DESC LIMIT ${limit}`, env
      );
      if (rows.length > 0) {
        articles = rows.map(r => normalizeArticleRow({ ...r, article_url: r.source_url, publisher: r.source_name })).filter(Boolean);
        source = 'gold_enriched_news';
      }
    } catch (_) {}
  }

  // silver_news fallback removed — violates medallion architecture (silver is internal-only)

  return json({
    status: 'success',
    source,
    articles,
    metadata: { timestamp: new Date().toISOString(), count: articles.length },
  }, 200);
}

async function handleDbAiSummaries(env) {
  let summaries = [];
  let source = 'none';

  // Primary: gold_news_ai_summaries
  try {
    const rows = await queryDatabricks(
      `SELECT summary_id, news_id, headline, summary_text, fantasy_insight, fantasy_relevance_score, impact_category, priority_level, impacted_players, is_time_sensitive, published_at FROM main.fantasai.gold_news_ai_summaries ORDER BY published_at DESC LIMIT 100`, env
    );
    if (rows.length > 0) { summaries = rows; source = 'gold_news_ai_summaries'; }
  } catch (_) {}

  // Fallback: export_player_news (has summary_text + fantasy_insight fields)
  if (summaries.length === 0) {
    try {
      const rows = await queryDatabricks(
        `SELECT news_id, headline, summary_text, fantasy_insight, impact_score AS fantasy_relevance_score, NULL AS impact_category, NULL AS priority_level, player_name, published_at FROM main.fantasai.export_player_news WHERE fantasy_insight IS NOT NULL AND fantasy_insight != '' ORDER BY published_at DESC LIMIT 100`, env
      );
      if (rows.length > 0) { summaries = rows; source = 'export_player_news'; }
    } catch (_) {}
  }

  return json({ status: 'success', source, summaries, metadata: { timestamp: new Date().toISOString(), count: summaries.length } }, 200);
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

// ── Article Labeling ──────────────────────────────────────────────────────────

const LABELS_R2_KEY = 'fantasai/labeling/article_labels.json';

async function handleLabelsGet(env) {
  try {
    const obj = await env.BUCKET.get(LABELS_R2_KEY);
    if (!obj) return json({ status: 'ok', labels: [], metadata: { count: 0 } }, 200);
    const labels = JSON.parse(await obj.text());
    const arr = Array.isArray(labels) ? labels : [];
    return json({ status: 'ok', labels: arr, metadata: { count: arr.length } }, 200);
  } catch (err) {
    return json({ status: 'ok', labels: [], error: err.message }, 200);
  }
}

async function handleLabelsPost(request, env) {
  if (env.FANTASAI_KEY) {
    const k = request.headers.get('X-FantasAI-Key');
    if (k !== env.FANTASAI_KEY) return json({ error: 'Unauthorized' }, 401);
  }
  const body = await request.json().catch(() => ({}));
  const { article_url, headline, publisher, published_at, original_player_name, original_position,
          original_team, labeled_player_name, labeled_position, labeled_team, player_sleeper_id,
          impact_category, impact_direction, relevance_score, is_relevant, notes, user_id } = body;
  if (!article_url || !labeled_position) return json({ error: 'article_url and labeled_position are required' }, 400);

  let existing = [];
  try {
    const obj = await env.BUCKET.get(LABELS_R2_KEY);
    if (obj) { existing = JSON.parse(await obj.text()); if (!Array.isArray(existing)) existing = []; }
  } catch (_) {}

  const label = {
    label_id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    article_url,
    headline: headline || '',
    publisher: publisher || '',
    published_at: published_at || null,
    original_player_name: original_player_name || '',
    original_position: original_position || '',
    original_team: original_team || '',
    labeled_player_name: labeled_player_name || '',
    labeled_position,
    labeled_team: labeled_team || '',
    player_sleeper_id: player_sleeper_id || null,
    impact_category: impact_category || 'analysis',
    impact_direction: impact_direction || 'neutral',
    relevance_score: Number(relevance_score) || 3,
    is_relevant: is_relevant !== false,
    notes: notes || '',
    labeled_by: user_id ? String(user_id) : 'commissioner',
    labeled_at: new Date().toISOString(),
    label_source: 'ui_labeler',
  };

  existing = existing.filter(l => l.article_url !== article_url);
  existing.unshift(label);

  await env.BUCKET.put(LABELS_R2_KEY, JSON.stringify(existing, null, 2), {
    httpMetadata: { contentType: 'application/json' },
  });

  return json({ status: 'ok', label, metadata: { total_labels: existing.length } }, 200);
}

// ── Human-in-the-Loop Feedback Voting ────────────────────────────────────────

const FEEDBACK_LABEL_SCORES = {
  BREAKOUT: 10, INJURY_IMPACT: 15, DEPTH_CHART: 8, START_SIT: 5,
  WAIVER_WIRE: 8, TRADE_IMPACT: 7, COACH_SPEAK: 2,
  HYPE_ONLY: -10, OLD_NEWS: -5, CLICKBAIT: -15,
};
const FEEDBACK_SCORES_KEY = 'fantasai/feedback/article_scores.json';

async function handleFeedbackVote(request, env) {
  const body = await request.json().catch(() => ({}));
  const { article_url, headline, user_id, labels, confidence } = body;
  if (!article_url || !Array.isArray(labels) || !labels.length) {
    return json({ error: 'article_url and labels[] required' }, 400);
  }

  const now = new Date();
  const [yr, mo, dy] = now.toISOString().slice(0, 10).split('-');
  const dailyKey = `fantasai/feedback/${yr}/${mo}/${dy}/votes.json`;

  const vote = {
    article_url,
    headline:    headline || '',
    user_id:     user_id  || 'anon',
    timestamp:   now.toISOString(),
    labels:      labels.filter(l => FEEDBACK_LABEL_SCORES.hasOwnProperty(l)),
    confidence:  Math.min(5, Math.max(1, Number(confidence) || 3)),
  };

  // 1. Append to daily file (Databricks ingests these nightly)
  let daily = [];
  try {
    const obj = await env.BUCKET.get(dailyKey);
    if (obj) { daily = JSON.parse(await obj.text()); if (!Array.isArray(daily)) daily = []; }
  } catch (_) {}
  daily.push(vote);
  await env.BUCKET.put(dailyKey, JSON.stringify(daily, null, 2), { httpMetadata: { contentType: 'application/json' } });

  // 2. Update running score aggregate (keyed by article_url)
  let scores = {};
  try {
    const obj = await env.BUCKET.get(FEEDBACK_SCORES_KEY);
    if (obj) { scores = JSON.parse(await obj.text()); if (typeof scores !== 'object' || Array.isArray(scores)) scores = {}; }
  } catch (_) {}

  const prev = scores[article_url] || { vote_count: 0, score: 0, label_counts: {}, headline: '', last_voted: '' };
  prev.headline   = headline || prev.headline;
  prev.last_voted = now.toISOString();
  prev.vote_count += 1;

  const voteScore = vote.labels.reduce((s, l) => s + (FEEDBACK_LABEL_SCORES[l] || 0), 0);
  prev.score = Math.round(((prev.score * (prev.vote_count - 1)) + voteScore) / prev.vote_count);

  vote.labels.forEach(l => { prev.label_counts[l] = (prev.label_counts[l] || 0) + 1; });
  prev.top_labels = Object.entries(prev.label_counts).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([l]) => l);

  scores[article_url] = prev;
  await env.BUCKET.put(FEEDBACK_SCORES_KEY, JSON.stringify(scores, null, 2), { httpMetadata: { contentType: 'application/json' } });

  return json({ status: 'ok', vote, aggregate: prev }, 200);
}

async function handleFeedbackScores(env) {
  try {
    const obj = await env.BUCKET.get(FEEDBACK_SCORES_KEY);
    if (!obj) return json({ status: 'ok', scores: {} }, 200);
    const scores = JSON.parse(await obj.text());
    return json({ status: 'ok', scores: typeof scores === 'object' && !Array.isArray(scores) ? scores : {} }, 200);
  } catch (err) {
    return json({ status: 'ok', scores: {}, error: err.message }, 200);
  }
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

// ── Per-user preferences ─────────────────────────────────────────────────────
// Stored in R2 as fantasai/user-prefs/{teamId}.json
// Contains: watchlist, slotOverrides, customRankings, scoringWeights, theme, etc.

const USER_PREFS_PREFIX = 'fantasai/user-prefs/';

async function handleUserPrefsGet(url, env) {
  const teamId = url.searchParams.get('teamId');
  if (!teamId) return json({ error: 'teamId required' }, 400);
  try {
    const obj = await env.BUCKET.get(`${USER_PREFS_PREFIX}${teamId}.json`);
    if (!obj) return json({ status: 'ok', prefs: {} }, 200);
    const prefs = JSON.parse(await obj.text());
    return json({ status: 'ok', prefs: typeof prefs === 'object' ? prefs : {} }, 200);
  } catch (_) {
    return json({ status: 'ok', prefs: {} }, 200);
  }
}

async function handleUserPrefsPost(request, env) {
  const body = await request.json().catch(() => ({}));
  const { teamId, prefs } = body;
  if (!teamId) return json({ error: 'teamId required' }, 400);
  if (typeof prefs !== 'object' || prefs === null) return json({ error: 'prefs object required' }, 400);
  await env.BUCKET.put(
    `${USER_PREFS_PREFIX}${teamId}.json`,
    JSON.stringify({ ...prefs, _savedAt: new Date().toISOString() }),
    { httpMetadata: { contentType: 'application/json' } }
  );
  return json({ status: 'ok' }, 200);
}

// ── League-wide trade offers ──────────────────────────────────────────────────
// Stored in R2 as fantasai/trades/offers.json
// Full array replacement on POST — client owns the list.

const TRADE_OFFERS_KEY = 'fantasai/trades/offers.json';

async function handleTradeOffersGet(env) {
  try {
    const obj = await env.BUCKET.get(TRADE_OFFERS_KEY);
    if (!obj) return json({ status: 'ok', offers: [] }, 200);
    const offers = JSON.parse(await obj.text());
    return json({ status: 'ok', offers: Array.isArray(offers) ? offers : [] }, 200);
  } catch (_) {
    return json({ status: 'ok', offers: [] }, 200);
  }
}

async function handleTradeOffersPost(request, env) {
  const body = await request.json().catch(() => ({}));
  const { offers } = body;
  if (!Array.isArray(offers)) return json({ error: 'offers array required' }, 400);
  await env.BUCKET.put(
    TRADE_OFFERS_KEY,
    JSON.stringify(offers),
    { httpMetadata: { contentType: 'application/json' } }
  );
  return json({ status: 'ok', count: offers.length }, 200);
}

// ── League-wide waiver state ──────────────────────────────────────────────────
// Stored in R2 as fantasai/waivers/state.json
// Shape: { claims: { [playerId]: { droppedAt, expiresAt, teamId } }, order: [teamId, ...] }

const WAIVERS_KEY = 'fantasai/waivers/state.json';

async function handleWaiversGet(env) {
  try {
    const obj = await env.BUCKET.get(WAIVERS_KEY);
    if (!obj) return json({ status: 'ok', claims: {}, order: [] }, 200);
    const data = JSON.parse(await obj.text());
    return json({ status: 'ok', claims: data.claims || {}, order: data.order || [] }, 200);
  } catch (_) {
    return json({ status: 'ok', claims: {}, order: [] }, 200);
  }
}

async function handleWaiversPost(request, env) {
  const body = await request.json().catch(() => ({}));
  const { claims, order } = body;
  // Read existing so a partial update (only claims or only order) merges cleanly
  let existing = { claims: {}, order: [] };
  try {
    const obj = await env.BUCKET.get(WAIVERS_KEY);
    if (obj) existing = JSON.parse(await obj.text());
  } catch (_) {}
  const merged = {
    claims: claims !== undefined ? claims : existing.claims,
    order:  order  !== undefined ? order  : existing.order,
    _savedAt: new Date().toISOString(),
  };
  await env.BUCKET.put(WAIVERS_KEY, JSON.stringify(merged), { httpMetadata: { contentType: 'application/json' } });
  return json({ status: 'ok' }, 200);
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

// ── Ghost Picks — Real-Time NFL Draft Engine ──────────────────────────────────
// Pre-computed AI data (team profiles + prospect scores) lives in R2.
// During the draft the Worker does pure math — no LLM, sub-50ms per pick.
//
// R2 keys (written by job_ghost_picks_builder.py before draft):
//   fantasai/draft/ghost_picks/team_profiles.json
//   fantasai/draft/ghost_picks/prospect_scores.json
//   fantasai/draft/ghost_picks/board.json
//   fantasai/draft/ghost_picks/draft_state.json

const GHOST_PREFIX = 'fantasai/draft/ghost_picks/';

const GHOST_WEIGHTS = { need: 0.30, history: 0.25, rumor: 0.25, value: 0.10, athletic: 0.10 };

const POSITION_VALUE = {
  QB: [100,100,100, 80, 80, 70, 60, 50, 50, 50, 45, 45],
  EDGE:[90, 90, 85, 80, 80, 75, 70, 65, 60, 55, 50, 45],
  WR: [80, 80, 78, 76, 74, 72, 71, 70, 70, 68, 65, 62],
  OL: [65, 65, 68, 70, 73, 75, 77, 80, 80, 78, 76, 74],
  CB: [75, 75, 73, 72, 71, 70, 68, 65, 63, 62, 60, 58],
  DL: [70, 68, 66, 65, 65, 64, 62, 60, 58, 56, 54, 52],
  RB: [30, 35, 40, 45, 50, 55, 60, 65, 68, 70, 70, 68],
  TE: [55, 55, 58, 60, 60, 62, 62, 62, 60, 58, 56, 54],
  LB: [50, 52, 55, 58, 60, 60, 60, 60, 60, 58, 56, 55],
  S:  [50, 52, 54, 56, 58, 60, 62, 62, 60, 58, 56, 54],
};

function ghostPositionValue(position, pickNumber) {
  const band = Math.min(Math.floor((pickNumber - 1) / 3), 11);
  return (GHOST_WEIGHTS.value > 0) ? (GHOST_WEIGHTS.value, (POSITION_VALUE[position]?.[band] ?? 50)) : 50;
}

function computeGhostScore(teamNeeds, teamProfile, prospect, rumor, pickNumber) {
  const pos   = prospect.position || '';
  const conf  = prospect.conference || 'Other';
  const tid   = teamProfile?.team_code || '';

  const n = parseFloat(teamNeeds?.[pos] ?? 0);
  const posTend  = parseFloat(teamProfile?.position_tendencies?.[pos] ?? 0.1) * 100;
  const confTend = parseFloat(teamProfile?.conference_tendencies?.[conf] ?? 0.1) * 100;
  const h = posTend * 0.6 + confTend * 0.4;
  const r = parseFloat(prospect.rumor_scores?.[tid] ?? rumor ?? 0);
  const band = Math.min(Math.floor((pickNumber - 1) / 3), 11);
  const v = POSITION_VALUE[pos]?.[band] ?? 50;
  const a = parseFloat(prospect.athletic_score ?? 50);

  const total = n * GHOST_WEIGHTS.need + h * GHOST_WEIGHTS.history +
                r * GHOST_WEIGHTS.rumor + v * GHOST_WEIGHTS.value  +
                a * GHOST_WEIGHTS.athletic;

  return { ghost_score: Math.round(total * 10) / 10, need: Math.round(n), history: Math.round(h), rumor: Math.round(r), value: v, athletic: Math.round(a) };
}

async function loadGhostData(env) {
  const [profilesObj, prospectsObj, boardObj, stateObj] = await Promise.all([
    env.BUCKET.get(GHOST_PREFIX + 'team_profiles.json'),
    env.BUCKET.get(GHOST_PREFIX + 'prospect_scores.json'),
    env.BUCKET.get(GHOST_PREFIX + 'board.json'),
    env.BUCKET.get(GHOST_PREFIX + 'draft_state.json'),
  ]);
  return {
    profiles:  profilesObj  ? JSON.parse(await profilesObj.text())  : null,
    prospects: prospectsObj ? JSON.parse(await prospectsObj.text()) : null,
    board:     boardObj     ? JSON.parse(await boardObj.text())     : null,
    state:     stateObj     ? JSON.parse(await stateObj.text())     : { picks_made: [], current_pick: 1, available_player_ids: [] },
  };
}

// GET /api/v1/draft/ghost-board?pick=1&team=DAL&top=10
async function handleGhostBoard(url, env) {
  if (!env.BUCKET) return json({ error: 'R2 not configured' }, 503);

  const { profiles, prospects, board, state } = await loadGhostData(env);
  if (!profiles || !prospects) {
    return json({ error: 'Ghost Picks not initialized — run job_ghost_picks_builder.py first', initialized: false }, 404);
  }

  const pickParam  = parseInt(url.searchParams.get('pick') || state.current_pick || '1');
  const teamParam  = url.searchParams.get('team') || null;
  const topN       = Math.min(parseInt(url.searchParams.get('top') || '10'), 32);

  // Determine which player IDs are still available
  const draftedIds = new Set((state.picks_made || []).map(p => String(p.player_id)));
  const availableIds = (state.available_player_ids || Object.keys(prospects))
    .filter(id => !draftedIds.has(String(id)));

  // If a specific team is requested, compute live scores for that team
  if (teamParam) {
    const profile   = profiles[teamParam] || {};
    const rawNeeds  = profile.needs || {};
    const teamNeeds = typeof rawNeeds === 'object' ? rawNeeds : {};

    const scored = availableIds.map(pid => {
      const p  = prospects[pid];
      if (!p) return null;
      const s  = computeGhostScore(teamNeeds, profile, p, 0, pickParam);
      const precomputed = board?.board?.[String(pickParam)]?.top_picks?.find(tp => String(tp.player_id) === String(pid));
      return {
        player_id:   pid,
        player_name: p.name,
        position:    p.position,
        college:     p.college,
        ...s,
        explanation: precomputed?.explanation || '',
      };
    }).filter(Boolean);

    scored.sort((a, b) => b.ghost_score - a.ghost_score);
    return json({
      pick:       pickParam,
      team:       teamParam,
      team_name:  profile.team_name || teamParam,
      philosophy: profile.draft_philosophy || '',
      top_picks:  scored.slice(0, topN),
      picks_made: state.picks_made?.length || 0,
      available:  availableIds.length,
    });
  }

  // No team specified — return the pre-built board for this pick
  const pickBoard = board?.board?.[String(pickParam)];
  if (pickBoard) {
    const filtered = (pickBoard.top_picks || []).filter(p => !draftedIds.has(String(p.player_id)));
    return json({ ...pickBoard, top_picks: filtered.slice(0, topN), picks_made: state.picks_made?.length || 0 });
  }

  return json({ error: `No board data for pick ${pickParam}` }, 404);
}

// POST /api/v1/draft/ghost-pick
// Body: { pick: 32, team: "TEN", player_id: "jeanty_ashton", player_name: "Ashton Jeanty", position: "RB" }
async function handleGhostPick(request, env) {
  if (!env.BUCKET) return json({ error: 'R2 not configured' }, 503);

  let body;
  try { body = await request.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }

  const { pick, team, player_id, player_name, position } = body;
  if (!pick || !team || !player_id) return json({ error: 'pick, team, and player_id required' }, 400);

  const { profiles, prospects, board, state } = await loadGhostData(env);
  if (!prospects) return json({ error: 'Ghost Picks not initialized' }, 404);

  // Record the pick
  const pickRecord = { pick, team, player_id: String(player_id), player_name, position, recorded_at: new Date().toISOString() };
  const newPicks   = [...(state.picks_made || []), pickRecord];

  // Remove player from available pool
  const newAvailable = (state.available_player_ids?.length > 0
    ? state.available_player_ids
    : Object.keys(prospects)
  ).filter(id => String(id) !== String(player_id));

  // Update team needs: lower the need for the position they just drafted
  const updatedProfiles = { ...profiles };
  if (updatedProfiles[team]) {
    const needs = { ...(updatedProfiles[team].needs || {}) };
    if (needs[position]) needs[position] = Math.max(0, needs[position] - 40);
    updatedProfiles[team] = { ...updatedProfiles[team], needs };
  }

  const newState = {
    picks_made:          newPicks,
    current_pick:        pick + 1,
    available_player_ids: newAvailable,
    last_updated:        new Date().toISOString(),
  };

  await env.BUCKET.put(GHOST_PREFIX + 'draft_state.json', JSON.stringify(newState), { httpMetadata: { contentType: 'application/json' } });
  await env.BUCKET.put(GHOST_PREFIX + 'team_profiles.json', JSON.stringify(updatedProfiles), { httpMetadata: { contentType: 'application/json' } });

  // Return predictions for next pick
  const nextPick      = pick + 1;
  const nextPickBoard = board?.board?.[String(nextPick)];
  const draftedIds    = new Set(newPicks.map(p => String(p.player_id)));
  const nextTopPicks  = nextPickBoard
    ? (nextPickBoard.top_picks || []).filter(p => !draftedIds.has(String(p.player_id))).slice(0, 5)
    : [];

  return json({
    recorded:      pickRecord,
    picks_made:    newPicks.length,
    remaining:     newAvailable.length,
    next_pick:     nextPick,
    next_top_picks: nextTopPicks,
  }, 200);
}

// POST /api/v1/draft/ghost-reset  — wipe draft state, restart
async function handleGhostReset(request, env) {
  if (!env.BUCKET) return json({ error: 'R2 not configured' }, 503);

  const prospects = await env.BUCKET.get(GHOST_PREFIX + 'prospect_scores.json');
  const prospectIds = prospects ? Object.keys(JSON.parse(await prospects.text())) : [];

  const resetState = {
    picks_made:           [],
    current_pick:         1,
    available_player_ids: prospectIds,
    last_updated:         new Date().toISOString(),
  };
  await env.BUCKET.put(GHOST_PREFIX + 'draft_state.json', JSON.stringify(resetState), { httpMetadata: { contentType: 'application/json' } });

  return json({ status: 'reset', available: prospectIds.length });
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
