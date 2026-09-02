# FantasAI Football — Frontend & Workers Reference

**Last Updated:** August 27, 2026 — corrected to remove Databricks/AWS-for-Databricks framing (Databricks was decommissioned 2026-06-15; R2 is bound directly via the native `env.BUCKET` binding, not S3-compatible credentials) and to bring the route/secrets list in `worker-api` up to date. See [docs/API_ENDPOINTS.md](docs/API_ENDPOINTS.md) for the full, authoritative route list.

## Repository Layout

```
d:\Project\Fantasy\
├── app/                          React/Vite frontend  →  Cloudflare Pages
├── worker/                       CBS Worker           →  fantasai-cbs (cookie proxy for CBS Sports)
├── worker-api/                   Main API Worker      →  fantasai-api (api.fantasai.net)
├── local_processing/             Local Python/DuckDB ETL + Qwen (Ollama) pipeline → writes to R2
└── _Archive_20260601/databricks/ Archived — old Databricks SQL/notebooks, decommissioned 2026-06-15, not live
```

---

## The Three Deployable Pieces

### 1. Frontend — `app/`

React + Vite SPA deployed to **Cloudflare Pages**.

| | |
|---|---|
| Live URL | `https://fantasai.pages.dev` |
| Dev server | `npm run dev` (localhost:5173) |
| Build output | `app/dist/` |

**Environment variables** — set in Cloudflare Pages dashboard → Settings → Environment Variables:

| Variable | Value |
|---|---|
| `VITE_WORKER_URL` | CBS Worker URL, e.g. `https://fantasai-cbs.fantasai.workers.dev` |
| `VITE_FANTASAI_KEY` | Shared secret (must match both workers) |

```powershell
cd app
npm run dev          # local dev server (localhost:5173)
npm run build        # build → app/dist/
```

> To deploy, run `.\deploy` from `d:\Project\Fantasy\` — it handles all three pieces at once.

---

### 2. CBS Worker — `worker/`

Cloudflare Worker **`fantasai-cbs`**. Holds your CBS Sports session cookie as a secret
and proxies authenticated requests to CBS Sports so the browser never touches the cookie.

| | |
|---|---|
| Live URL | `https://fantasai-cbs.fantasai.workers.dev` |
| Wrangler name | `fantasai-cbs` |

**Routes:**
- `/api/cbs/league` `/api/cbs/teams` `/api/cbs/rosters` `/api/cbs/rankings` `/api/cbs/draft`
- `/api/cbs/players` `/api/cbs/transactions` `/api/cbs/scoring`
- `/api/cbs/sleeper-players` — Sleeper player pool (CORS bypass)
- `/api/v1/push/*` — web push notifications

**Secrets** (set once; survive redeployments):

```powershell
wrangler secret put CBS_COOKIE   --name fantasai-cbs   # CBS session cookie
wrangler secret put FANTASAI_KEY --name fantasai-cbs   # shared secret (optional)
```

```powershell
cd worker
npx wrangler tail            # live logs
```

> To deploy, run `.\deploy` from `d:\Project\Fantasy\` — it handles all three pieces at once.

> **Cookie refresh:** You do NOT need to redeploy to refresh the CBS cookie.
> Use the **Get Cookie** button on the Sources page instead — it sends the cookie
> as an `X-CBS-Cookie` header without touching the worker secret.

---

### 3. Main API Worker — `worker-api/`

Cloudflare Worker **`fantasai-api`**, served at **`api.fantasai.net`**.
Hub for R2 storage (primary data store), Sleeper, ESPN, CBS proxy, chat (local Qwen/OpenAI/Anthropic), draft, owners/auth, and push-notification routes. Databricks was decommissioned 2026-06-15 — a small handful of routes still fall back to it behind an R2 primary (see below), but it is not part of the primary path for anything.

| | |
|---|---|
| Live URL | `https://api.fantasai.net` |
| Wrangler name | `fantasai-api` |
| R2 bucket | `fantasai-r2` (bound as `env.BUCKET`) |

**Routes (selected — full list in [docs/API_ENDPOINTS.md](docs/API_ENDPOINTS.md)):**
- `/api/health`, `/api/v1/storage/test` — liveness / R2 probe
- `/api/v1/r2/{key}` (GET/PUT/DELETE) — R2 passthrough; this is how most JSON exports are read/written
- `/api/v1/players` — Sleeper full player pool (1h edge cache)
- `/api/v1/db/players`, `/api/v1/db/tables` — ⚠️ last-resort Databricks fallback, behind R2; status unconfirmed
- `/api/v1/news/articles` — player news (R2, actively maintained); `/api/v1/news/ai-summaries` and `/api/v1/opportunity/rankings` are ⚠️ Databricks fallback behind R2
- `/api/v1/nfl/scoreboard` `/api/v1/nfl/player-stats` — live scoring, R2-backed (written by the local `job_live_scores.py` poller); `/api/v1/nfl/schedule` `/api/v1/nfl/news` — direct ESPN
- `/api/v1/chat` — local Ollama first, OpenAI fallback, Anthropic last resort (NOT Databricks)
- `/api/v1/owners/config` `/api/v1/owners/verify` `/api/v1/owners/reset-*` — owner map + auth, R2-backed
- `/api/v1/draft/picks` `/api/v1/draft/archive` `/api/v1/draft/remote` — draft sync, R2-backed
- `/api/v1/draft/ghost-board` `/api/v1/draft/ghost-pick` `/api/v1/draft/ghost-reset` — AI Ghost Picks mock-draft engine
- `/api/v1/leagues/create` `/api/v1/leagues/import` — league management (requires `X-FantasAI-Key`)
- `/api/v1/week/current`, `/api/v1/schedule`, `/api/v1/league-settings`, `/api/v1/community*` — league config, R2-backed
- `/api/v1/proxy` — server-side CORS bypass for whitelisted third-party APIs; `/api/v1/scrape` — unrestricted server-side fetch (no host whitelist — treat as a hardening item)
- `/api/v1/transactions`, `/api/v1/trade-offers`, `/api/v1/waivers`, `/api/v1/user-prefs` — league state, R2-backed
- `/api/v1/labels/article`, `/api/v1/feedback/scores`, `/api/v1/feedback/vote` — human-in-the-loop labeling
- `/api/v1/login-log` — login audit log (requires `X-FantasAI-Key` to read)
- `/api/v1/push/subscribe` `/api/v1/push/unsubscribe` `/api/v1/push/send` — Web Push (VAPID); no-ops until `PUSH_SUBS` KV is provisioned

**Secrets** (actual `env.*` usages in `worker-api/src/index.js`):

```powershell
wrangler secret put FANTASAI_KEY          --name fantasai-api   # shared secret (required header: X-FantasAI-Key on gated routes)
wrangler secret put RESEND_API_KEY        --name fantasai-api   # resend.com → owner password-reset emails
wrangler secret put WWO_API_KEY           --name fantasai-api   # WorldWeatherOnline forecasts — never hardcode
wrangler secret put LOCAL_CHAT_URL        --name fantasai-api   # points at local chat_server.py for the first chat hop
wrangler secret put OPENAI_API_KEY        --name fantasai-api   # chat fallback tier
wrangler secret put ANTHROPIC_API_KEY     --name fantasai-api   # chat last-resort fallback tier
wrangler secret put VAPID_PRIVATE_KEY     --name fantasai-api   # web push (optional — degrades gracefully if unset)
wrangler secret put VAPID_PUBLIC_KEY      --name fantasai-api   # web push (optional)
```

Legacy, last-resort-fallback only — **not required for a new setup**, and status of the underlying warehouse is unconfirmed: `DATABRICKS_HOST`/`DATABRICKS_URL`, `DATABRICKS_TOKEN`, `DATABRICKS_WAREHOUSE_ID`/`DATABRICKS_HTTP_PATH`. There is no AWS S3 usage in `worker-api` — R2 is the store, bound directly as `env.BUCKET`.

```powershell
cd worker-api
npx wrangler tail            # live logs
```

> To deploy, run `.\deploy` from `d:\Project\Fantasy\` — it handles all three pieces at once.

---

## Full Redeploy (all three)

```powershell
# From d:\Project\Fantasy\
.\deploy
```

This runs `deploy.bat` which builds the app, then deploys all three pieces in order.

<details>
<summary>Manual steps (if you need to deploy individually)</summary>

```powershell
cd app       ; npm run build ; npx wrangler pages deploy dist --project-name fantasai ; cd ..
cd worker    ; npx wrangler deploy ; cd ..
cd worker-api; npx wrangler deploy ; cd ..
```
</details>

---

## Why Two Workers?

The CBS Worker (`worker/`) was built first as a focused cookie-proxy. The main API worker
(`worker-api/`) grew separately to handle everything that doesn't need the CBS cookie.
Keeping them separate means you can redeploy the CBS Worker when cookie-handling code changes
without touching the main API — and vice versa.

---

## CBS Cookie Refresh (when CBS data stops loading)

1. Open the app → **Sources** page → **CBS Worker Config** → click **Get Cookie**
2. Click **Open CBS Sports →** (opens your league in a new tab)
3. Open DevTools (F12) → **Network** tab → reload the page
4. Click any request to `cbssports.com` → **Request Headers** → find the `cookie:` row → copy the entire value
5. Paste into the modal → **Save Cookie**

The cookie is stored in your browser's `localStorage` and sent to the workers as
`X-CBS-Cookie` on every request. No `wrangler secret put` needed.

---

## Cross-Device State (R2 as source of truth)

All user settings and league state are stored in R2 — **no localStorage is used for settings**.
Every login pulls the full config from R2, so the app looks identical on every device and browser.

### Per-user preferences (`remotePrefs.js`)
Loaded on login via `loadUserPrefs(teamId)`. Saved automatically with an 800 ms debounce when any pref changes (`patchPrefs(patch)`).

Covers: theme, light/dark mode, watchlist, Sleeper username/league/weights, scoring weights, custom rankings, column visibility, CBS personal rankings, draft owner ranks, scoring test rules, news source toggles.

### League-wide shared state (`remoteState.js`)
Loaded on login via `loadRemoteState()`. Written immediately on change.

Covers: trade offers (all pending/accepted/rejected), waiver order, dropped players on waivers.

### What still uses localStorage (intentional)
| Key | Reason |
|---|---|
| `fantasai_user` | Session token — cleared on logout |
| `fantasai_cbs_cookie` | Security — never sent to R2 |
| `fantasai_live_picks` | Draft state — ephemeral, mock drafts |
| `fantasai_waiver_last_run` | Timing / scheduling signal |
| `fantasai_add_filter` | Ephemeral UI navigation state |

---

## R2 Data Layout

```
fantasai-r2/
└── fantasai/
    ├── user-prefs/
    │   └── {teamId}.json                    ← per-user preferences
    ├── trades/
    │   └── offers.json                      ← league-wide trade offers
    ├── waivers/
    │   └── state.json                       ← waiver order + dropped players
    ├── players/
    │   └── players_2026_draft.json          ← full NFL player pool for 2026 draft
    ├── analysis/
    │   ├── lineup_recommendations.json
    │   ├── performance_trends.json
    │   ├── trade_values.json
    │   ├── waiver_wire_recommendations.json
    │   ├── drop_candidates.json
    │   ├── breakout_candidates.json
    │   ├── sleeper_picks.json
    │   ├── weather_forecast.json
    │   └── player_news.json
    ├── news/
    │   ├── player_notes.json
    │   ├── critical_alerts.json
    │   ├── enriched_news.json
    │   └── ai_summaries.json
    └── injuries/
        └── silver_player_news.json
```
