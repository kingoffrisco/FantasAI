// FantasAI API Worker
// Serves api.fantasai.net — aggregates Sleeper + CBS data for the ETL pipeline.
//
// Routes:
//   GET /api/v1/injuries
//   GET /api/v1/stats/week?week=N&season=Y&type=regular|pre|post
//   GET /api/v1/projections?week=N&season=Y&type=regular|pre|post
//   GET /api/v1/league
//   GET /api/v1/rosters
//   GET /api/v1/draft?year=Y
//   GET /api/health

const ROUTES = {
  "/api/health":          handleHealth,
  "/api/v1/injuries":     handleInjuries,
  "/api/v1/stats/week":   handleStats,
  "/api/v1/projections":  handleProjections,
  "/api/v1/league":       handleLeague,
  "/api/v1/rosters":      handleRosters,
  "/api/v1/draft":        handleDraft,
};

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders() });
    }

    if (request.method !== "GET") {
      return json({ error: "Method not allowed" }, 405);
    }

    // Optional shared-secret auth (skip for health check)
    if (env.FANTASAI_KEY && url.pathname !== "/api/health") {
      const key = request.headers.get("X-FantasAI-Key");
      if (key !== env.FANTASAI_KEY) {
        return json({ error: "Unauthorized" }, 401);
      }
    }

    const handler = ROUTES[url.pathname];
    if (!handler) {
      return json({ error: "Not found", path: url.pathname }, 404);
    }

    try {
      const data = await handler(url, env);
      return json(data, 200);
    } catch (err) {
      console.error(err.stack || err);
      return json({ error: err.message }, 502);
    }
  },
};

// ============================================================
// Handlers
// ============================================================

function handleHealth(url, env) {
  return {
    ok: true,
    service: "fantasai-api",
    cbsWorkerConfigured: !!env.CBS_WORKER_URL,
    authRequired: !!env.FANTASAI_KEY,
    routes: Object.keys(ROUTES),
  };
}

// Pulls all NFL players from Sleeper and returns those with a non-null injury status.
async function handleInjuries(url, env) {
  const players = await sleeperFetch(env, "/players/nfl");
  const injured = Object.entries(players)
    .filter(([, p]) => p.injury_status && p.injury_status !== "Na")
    .map(([id, p]) => ({
      player_id:      id,
      full_name:      p.full_name || `${p.first_name} ${p.last_name}`,
      position:       p.position,
      team:           p.team,
      injury_status:  p.injury_status,
      injury_body_part: p.injury_body_part || null,
      injury_notes:   p.injury_notes || null,
      injury_start_date: p.injury_start_date || null,
    }));

  return {
    source:      "sleeper",
    fetchedAt:   new Date().toISOString(),
    count:       injured.length,
    injuries:    injured,
  };
}

// Sleeper stats: /stats/nfl/{season_type}/{season}/{week}
async function handleStats(url, env) {
  const { week, season, type } = resolveWeekParams(url);
  const data = await sleeperFetch(env, `/stats/nfl/${type}/${season}/${week}`);
  return {
    source:  "sleeper",
    fetchedAt: new Date().toISOString(),
    season,
    week,
    type,
    stats: data,
  };
}

// Sleeper projections: /projections/nfl/{season_type}/{season}/{week}
async function handleProjections(url, env) {
  const { week, season, type } = resolveWeekParams(url);
  const data = await sleeperFetch(env, `/projections/nfl/${type}/${season}/${week}`);
  return {
    source:  "sleeper",
    fetchedAt: new Date().toISOString(),
    season,
    week,
    type,
    projections: data,
  };
}

async function handleLeague(url, env) {
  return cbsFetch(env, "/api/cbs/league");
}

async function handleRosters(url, env) {
  return cbsFetch(env, "/api/cbs/rosters");
}

async function handleDraft(url, env) {
  const year = url.searchParams.get("year") || new Date().getFullYear();
  return cbsFetch(env, `/api/cbs/draft?year=${year}`);
}

// ============================================================
// Sleeper helper
// ============================================================
async function sleeperFetch(env, path) {
  const base = env.SLEEPER_BASE || "https://api.sleeper.app/v1";
  const res = await fetch(`${base}${path}`, {
    headers: { "Accept": "application/json" },
    cf: { cacheTtl: 300, cacheEverything: true },
  });
  if (!res.ok) throw new Error(`Sleeper ${path} returned ${res.status}`);
  return res.json();
}

// ============================================================
// CBS Worker proxy helper
// ============================================================
async function cbsFetch(env, path) {
  if (!env.CBS_WORKER_URL) {
    throw new Error("CBS_WORKER_URL is not configured. Set it in wrangler.toml [vars].");
  }
  const res = await fetch(`${env.CBS_WORKER_URL}${path}`, {
    headers: {
      "Accept": "application/json",
      ...(env.FANTASAI_KEY ? { "X-FantasAI-Key": env.FANTASAI_KEY } : {}),
    },
  });
  if (!res.ok) throw new Error(`CBS Worker ${path} returned ${res.status}`);
  return res.json();
}

// ============================================================
// Helpers
// ============================================================
function resolveWeekParams(url) {
  const week   = parseInt(url.searchParams.get("week")   || "1");
  const season = parseInt(url.searchParams.get("season") || new Date().getFullYear());
  const type   = url.searchParams.get("type") || "regular";
  return { week, season, type };
}

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin":  "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-FantasAI-Key",
    "Access-Control-Max-Age":       "86400",
  };
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      ...corsHeaders(),
      "Content-Type": "application/json; charset=utf-8",
    },
  });
}
