# FantasAI Football — Frontend & Workers Reference

## Repository Layout

```
d:\Project\Fantasy\
├── app/             React/Vite frontend  →  Cloudflare Pages
├── worker/          CBS Worker           →  fantasai-cbs (cookie proxy for CBS Sports)
├── worker-api/      Main API Worker      →  fantasai-api (api.fantasai.net)
└── databricks/      ETL scripts that write NFL data to Cloudflare R2
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
Hub for R2 storage, Databricks, ESPN, Sleeper, and CBS proxy routes.

| | |
|---|---|
| Live URL | `https://api.fantasai.net` |
| Wrangler name | `fantasai-api` |
| R2 bucket | `fantasai-r2` |

**Routes:**
- `/api/health` — liveness check
- `/api/v1/r2/*` — R2 storage proxy (Databricks exports)
- `/api/v1/league` `/api/v1/rosters` `/api/v1/injuries` `/api/v1/draft` — proxies to CBS Worker
- `/api/v1/players` — Sleeper full player pool (1h edge cache)
- `/api/v1/nfl/scoreboard` `/api/v1/nfl/schedule` `/api/v1/nfl/news` — ESPN data
- `/api/v1/chat` — Databricks AI chat
- `/api/v1/owners/*` — owner map stored in R2
- `/api/v1/week/current` — current week/season setting
- `/api/v1/schedule` `/api/v1/league-settings` — league config stored in R2
- `/api/v1/proxy` — server-side CORS bypass for whitelisted third-party APIs
- `/api/v1/transactions` — transaction log
- `/api/v1/user-prefs` — per-user preferences (GET `?teamId=N`, POST `{ teamId, prefs }`)
- `/api/v1/trade-offers` — league-wide trade offers (GET, POST `{ offers }`)
- `/api/v1/waivers` — waiver order + dropped players (GET, POST `{ claims, order }`)

**Secrets:**

```powershell
wrangler secret put FANTASAI_KEY          --name fantasai-api   # shared secret (required header: X-FantasAI-Key)
wrangler secret put RESEND_API_KEY        --name fantasai-api   # resend.com → owner password-reset emails
wrangler secret put AWS_ACCESS_KEY_ID     --name fantasai-api   # R2 token for Databricks → R2 writes
wrangler secret put AWS_SECRET_ACCESS_KEY --name fantasai-api   # R2 token secret
wrangler secret put DATABRICKS_HOST       --name fantasai-api   # Databricks workspace URL
wrangler secret put DATABRICKS_TOKEN      --name fantasai-api   # Databricks personal access token
```

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
