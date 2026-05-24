// FantasAI API Worker — api.fantasai.net
//
// GET  /api/health
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

const S3_KEY              = 'fantasai/owners-config.json';
const S3_LEAGUE_KEY       = 'fantasai/league-config.json';
const S3_ROSTERS_KEY      = 'fantasai/rosters.json';
const S3_SCHEDULE_KEY     = 'fantasai/schedule.json';
const S3_SETTINGS_KEY     = 'fantasai/league-settings.json';

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

    try {
      // ── POST routes (no auth — called directly by the app) ──────────────
      if (method === 'POST') {
        if (url.pathname === '/api/v1/owners/config')         return handleOwnersConfigPost(request, env);
        if (url.pathname === '/api/v1/owners/reset-request')  return handleResetRequest(request, env);
        if (url.pathname === '/api/v1/owners/reset-complete') return handleResetComplete(request, env);
        if (url.pathname === '/api/v1/week/current')          return handleWeekSet(request, env);
        if (url.pathname === '/api/v1/rosters/save')          return handleRosterSave(request, env);
        if (url.pathname === '/api/v1/rosters/reset')         return handleRosterReset(request, env);
        if (url.pathname === '/api/v1/schedule')              return handleScheduleSave(request, env);
        if (url.pathname === '/api/v1/league-settings')       return handleLeagueSettingsSave(request, env);
        return json({ error: 'Not found' }, 404);
      }

      if (method !== 'GET') return json({ error: 'Method not allowed' }, 405);

      // ── Public GET routes ────────────────────────────────────────────────
      if (url.pathname === '/api/health')                  return json(handleHealth(env), 200);
      if (url.pathname === '/api/v1/owners/config')        return handleOwnersConfigGet(env);
      if (url.pathname === '/api/v1/owners/reset-verify')  return handleResetVerify(url, env);
      if (url.pathname === '/api/v1/week/current')         return handleWeekGet(env);
      if (url.pathname === '/api/v1/rosters/load')         return handleRosterLoad(url, env);
      if (url.pathname === '/api/v1/schedule')             return handleScheduleLoad(env);
      if (url.pathname === '/api/v1/league-settings')     return handleLeagueSettingsLoad(url, env);
      if (url.pathname === '/api/v1/proxy')               return handleProxy(url);

      // ── Authenticated GET routes ─────────────────────────────────────────
      if (env.FANTASAI_KEY) {
        const k = request.headers.get('X-FantasAI-Key');
        if (k !== env.FANTASAI_KEY) return json({ error: 'Unauthorized' }, 401);
      }
      const handler = PROTECTED_GET[url.pathname];
      if (!handler) return json({ error: 'Not found', path: url.pathname }, 404);
      return json(await handler(url, env), 200);

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
    awsConfigured:   !!env.AWS_ACCESS_KEY_ID,
    emailConfigured: !!env.RESEND_API_KEY,
    cbsConfigured:   !!env.CBS_WORKER_URL,
    authRequired:    !!env.FANTASAI_KEY,
  };
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

async function handleLeague(url, env) { return cbsFetch(env, '/api/cbs/league'); }
async function handleRosters(url, env) { return cbsFetch(env, '/api/cbs/rosters'); }
async function handleDraft(url, env) {
  const year = url.searchParams.get('year') || new Date().getFullYear();
  return cbsFetch(env, `/api/cbs/draft?year=${year}`);
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

async function cbsFetch(env, path) {
  if (!env.CBS_WORKER_URL) throw new Error('CBS_WORKER_URL not configured');
  const res = await fetch(`${env.CBS_WORKER_URL}${path}`, {
    headers: {
      Accept: 'application/json',
      ...(env.FANTASAI_KEY ? { 'X-FantasAI-Key': env.FANTASAI_KEY } : {}),
    },
  });
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
  'www.thesportsdb.com',
  'api.github.com',
  'api.mysportsfeeds.com',
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

// ── AWS S3 (inline Signature V4) ──────────────────────────────────────────────

const _enc = s => new TextEncoder().encode(s);
const _hex = b => [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, '0')).join('');

async function _sha256hex(str) {
  return _hex(await crypto.subtle.digest('SHA-256', _enc(str)));
}

async function _hmac(key, msg) {
  const k = await crypto.subtle.importKey(
    'raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  return new Uint8Array(await crypto.subtle.sign('HMAC', k, _enc(msg)));
}

async function s3Fetch(env, method, s3key, body) {
  const bucket = env.S3_BUCKET || 'aws-kingoffisco-s3-bucket';
  const region = env.AWS_REGION || 'us-east-2';
  const keyId  = env.AWS_ACCESS_KEY_ID;
  const secret = env.AWS_SECRET_ACCESS_KEY;
  if (!keyId || !secret) throw new Error('AWS credentials not configured');

  const host     = `${bucket}.s3.${region}.amazonaws.com`;
  const bodyStr  = body != null ? JSON.stringify(body) : '';
  const bodyHash = await _sha256hex(bodyStr);

  const iso     = new Date().toISOString();
  const amzDate = iso.slice(0, 19).replace(/[-:]/g, '') + 'Z'; // 20230801T120000Z
  const day     = amzDate.slice(0, 8);

  const hdrMap = {
    host,
    'x-amz-date': amzDate,
    'x-amz-content-sha256': bodyHash,
    ...(bodyStr ? { 'content-type': 'application/json' } : {}),
  };
  const sortedKeys   = Object.keys(hdrMap).sort();
  const canonHeaders = sortedKeys.map(k => `${k}:${hdrMap[k]}\n`).join('');
  const signedHdrs   = sortedKeys.join(';');
  const canonReq     = [method, `/${s3key}`, '', canonHeaders, signedHdrs, bodyHash].join('\n');
  const scope        = `${day}/${region}/s3/aws4_request`;
  const strToSign    = `AWS4-HMAC-SHA256\n${amzDate}\n${scope}\n${await _sha256hex(canonReq)}`;

  let sigKey = _enc(`AWS4${secret}`);
  for (const part of [day, region, 's3', 'aws4_request']) sigKey = await _hmac(sigKey, part);
  const sig = _hex(await _hmac(sigKey, strToSign));

  return fetch(`https://${host}/${s3key}`, {
    method,
    headers: {
      ...hdrMap,
      authorization: `AWS4-HMAC-SHA256 Credential=${keyId}/${scope}, SignedHeaders=${signedHdrs}, Signature=${sig}`,
    },
    body: bodyStr || undefined,
  });
}

// ── Shared helpers ────────────────────────────────────────────────────────────

function resolveWeekParams(url) {
  const week   = parseInt(url.searchParams.get('week')   || '1');
  const season = parseInt(url.searchParams.get('season') || new Date().getFullYear());
  const type   = url.searchParams.get('type') || 'regular';
  return { week, season, type };
}

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin':  '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-FantasAI-Key',
    'Access-Control-Max-Age':       '86400',
  };
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { ...corsHeaders(), 'Content-Type': 'application/json; charset=utf-8' },
  });
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
