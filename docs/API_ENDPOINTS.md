# FantasAI API Endpoints Documentation

**Last Updated:** August 22, 2026
**Source of truth:** `worker-api/src/index.js` (2,703 lines) — this document supersedes the June 7, 2026 version, which described a Databricks-only backend that no longer reflects reality.

> **Note:** The header comment block at the top of `worker-api/src/index.js` itself is stale and undocumented for ~40 routes added since it was written. Treat the dispatch table (the `if (url.pathname === ...)` chain starting ~line 149) as authoritative, not that comment — and treat this document, generated from a full read of that dispatch table, as the current reference.

---

## Overview

Two backends are in play:

1. **`https://api.fantasai.net`** — the primary Cloudflare Worker (`fantasai-api`), R2 bucket `fantasai-r2` bound as `BUCKET`. This is what almost everything below refers to.
2. **`https://fantasai-cbs.fantasai.workers.dev`** — a separate, legacy Worker used only to proxy CBS Sports Fantasy (cookie-authenticated). Routes: `/api/cbs/league`, `/api/cbs/teams`, `/api/cbs/rankings`, `/api/cbs/draft`, `/api/cbs/rosters`, `/api/cbs/sleeper-players`.

**Auth model:** There is no session/JWT system. A shared secret header, `X-FantasAI-Key`, gates a subset of routes (see each section below). Most POST routes have **no auth check at all** — the code comment literally says "POST routes (no auth — called directly by the app)". Team login is separate and simpler: an owner email/password map lives in R2 (`fantasai/owners-config.json`) and is checked client-side; the Worker only stores/serves it plus handles token-based password reset via Resend email.

---

## 1. Health / Diagnostics

| Method | Path | Description |
|---|---|---|
| GET | `/api/health`, `/health`, `/` | Health check — reports `r2Configured`, `emailConfigured`, `cbsConfigured`, `authRequired` |
| GET | `/api/v1/storage/test` | Live R2 read/write probe |

## 2. R2 Passthrough (generic object access)

Gated by `X-FantasAI-Key` if `FANTASAI_KEY` is configured.

| Method | Path | Description |
|---|---|---|
| GET | `/api/v1/r2/list?prefix=&limit=` | List objects (key, size, uploaded, contentType), capped at 5000 |
| GET | `/api/v1/r2/{key}` | Raw object fetch — this is how most JSON exports are actually read by the frontend |
| PUT | `/api/v1/r2/{key}` | Raw object write — this is how the local pipeline writes most exports |
| DELETE | `/api/v1/r2/{key}` | Delete |

**Common R2 key prefixes** (see [DATA_SCHEMAS.md](DATA_SCHEMAS.md) for shapes):
`fantasai/players/`, `fantasai/news/`, `fantasai/analysis/`, `fantasai/stats/`, `fantasai/live/`, `fantasai/draft/`, `fantasai/leagues/`, `fantasai/league/`, `fantasai/labeling/`, `fantasai/feedback/`, `fantasai/user-prefs/`, `fantasai/trades/`, `fantasai/waivers/`, `fantasai/admin/`.

## 3. Player Data

| Method | Path | Description | Backend |
|---|---|---|---|
| GET | `/api/v1/players?limit=&pos=` | Full player pool, ranked by Sleeper `search_rank`, public, 1h edge cache | Sleeper API (direct) |
| GET | `/api/v1/db/players` | Player list, tries a priority table list until one has rows | **Databricks** ⚠️ unmigrated |
| GET | `/api/v1/db/tables` | `SHOW TABLES IN main.fantasai` | **Databricks** ⚠️ unmigrated |
| GET | `/api/v1/player/{name}` | Single player profile | **Databricks** ⚠️ unmigrated |
| GET | `/api/v1/r2/fantasai/players/export_players_2026_draft.json` | Draft board — recommended primary source now | R2 (local pipeline) |

⚠️ = still queries the old Databricks SQL Warehouse via `queryDatabricks()`. Whether Databricks is still reachable is unconfirmed — treat these as possibly dead. Prefer the R2-backed equivalent where one exists.

## 4. News

| Method | Path | Description | Backend |
|---|---|---|---|
| GET | `/api/v1/news/articles?limit=` | Player news articles — **recommended, actively maintained**, explicit code comment confirms Databricks fallback was removed because it always returned empty | R2 `fantasai/analysis/player_news.json`, falls back to `fantasai/news/enriched_news.json` |
| GET | `/api/v1/news/latest` | News feed | **Databricks** ⚠️ unmigrated |
| GET | `/api/v1/news/critical` | Critical alerts | **Databricks** ⚠️ unmigrated |
| GET | `/api/v1/news/ai-summaries` | AI summaries | **Databricks** ⚠️ unmigrated (falls back to `export_player_news` table, also Databricks) |
| GET | `/api/v1/twitter/beat` | Beat writer tweets — scrapes 30 hardcoded reporter handles via Nitter RSS mirrors (14 instances tried), falls back to PFT/NFL.com RSS | Nitter / RSS (external, live) |

## 5. Analysis (R2, local-pipeline-backed)

All read via `/api/v1/r2/{key}` — see [DATA_SCHEMAS.md](DATA_SCHEMAS.md) for shapes.

| Data | R2 Key |
|---|---|
| Breakout candidates | `fantasai/analysis/breakout_candidates.json` |
| Deep reasoning (Job 5, new) | `fantasai/analysis/deep_reasoning.json` |
| Player scores (Job 2) | `fantasai/analysis/player_scores.json` |
| Weekly start/sit (Job 4) | `fantasai/analysis/weekly_startsit.json` |
| Player writeups (Job 3) | `players/player_writeups.json` |
| Injury report | `fantasai/analysis/injury_report.json` |
| Defense vs. position | `fantasai/analysis/defense_vs_pos.json` |
| Defense performance | `fantasai/analysis/defense_performance.json` |
| College stats (rookies) | `fantasai/analysis/college_stats.json` |
| Rookie scores (new) | `fantasai/analysis/rookie_scores.json` |
| O-Line Index (new) | `fantasai/analysis/oline_index.json`, `player_team_history.json` |
| O-Line Stability (new) | `fantasai/analysis/oline_stability.json`, `player_oline_stability.json` |
| Offensive weapon/support scores (new) | `fantasai/analysis/player_weapon_scores.json`, `team_support_scores.json` |
| Weather forecast | `fantasai/analysis/weather_forecast.json` |
| NFL schedule / opponent lookup | `fantasai/analysis/nfl_schedule.json`, `opponent_lookup.json` |
| Player ownership | `fantasai/analysis/player_ownership.json` |
| Combine data | `fantasai/analysis/combine_data.json` |
| ADP (PPR/Standard) | `players/adp_ppr.json`, `players/adp_standard.json` |
| Performance trends | `fantasai/analysis/performance_trends.json` |
| Weekly stats (large, ~50-100MB) | `fantasai/stats/gold_weekly_stats.json` |

| Method | Path | Description | Backend |
|---|---|---|---|
| GET | `/api/v1/opportunity/rankings` | Opportunity scores | **Databricks** ⚠️ unmigrated (frontend falls back to this if R2 `breakoutCandidates` read fails) |
| GET | `/api/v1/leaderboard/live` | Live leaderboard | **Databricks** ⚠️ unmigrated |
| GET | `/api/v1/games/active` | In-progress/halftime games | **Databricks** ⚠️ unmigrated — note this predates and duplicates the newer R2-backed live scoring below |
| POST | `/api/v1/weather/refresh` | Fetch fresh WWO forecasts for 32 teams (30-min cooldown, dome teams skipped) | WWO API → R2 |

## 6. Live Scoring (migrated to local pipeline as of 2026-08-20)

ESPN began 403-ing Cloudflare Workers' shared egress IPs on 2026-08-20. These two routes no longer call ESPN directly — they now read R2 keys written locally by `local_processing/job_live_scores.py` (hourly auto-poll, tightens cadence during live games).

| Method | Path | Description |
|---|---|---|
| GET | `/api/v1/nfl/scoreboard?week=&season=&type=` | Live game scores | R2 `fantasai/live/scoreboard_{season}_{type}_{week}.json` |
| GET | `/api/v1/nfl/player-stats?week=&season=&type=` | Live per-player box scores | R2 `fantasai/live/player_stats_{season}_{type}_{week}.json` |

If no cached data exists yet for a requested week, response returns empty arrays with a note. Keys are permanent per (season, type, week) — historical weeks stay queryable. The frontend (`app/src/lib/liveScoring.js`) falls back to calling ESPN directly from the browser if these return empty.

Still-live direct-ESPN routes (unaffected by the IP block, schedule/news don't need per-play polling):

| Method | Path | Description |
|---|---|---|
| GET | `/api/v1/nfl/schedule?week=&season=` | Weekly schedule + odds | ESPN (direct) |
| GET | `/api/v1/nfl/news?limit=` | ESPN NFL news feed | ESPN (direct) |

## 7. Draft — Real (live sync between owners)

| Method | Path | Description |
|---|---|---|
| GET/POST | `/api/v1/draft/picks` | Full draft-picks array (overwrite on POST) | R2 `fantasai/league/draft_picks.json` |

Draft chat/queue/state are R2-only, no dedicated route — read/written directly via the R2 passthrough:
`fantasai/draft/chat_log.json`, `fantasai/draft/queue_by_team.json`, `fantasai/draft/state.json`.

## 8. Draft — Ghost Picks (AI mock-draft probability engine)

Pure-math scoring at request time (no LLM call) — `need(30%) + history(25%) + rumor(25%) + value(10%) + athletic(10%)`, using pre-computed data from `job_ghost_picks_builder.py` (Qwen3 14B, run manually once a year before the NFL Draft).

| Method | Path | Description |
|---|---|---|
| GET | `/api/v1/draft/ghost-board?pick=&team=&top=` | AI-simulated top picks for a slot | R2 `fantasai/draft/ghost_picks/*` |
| POST | `/api/v1/draft/ghost-pick` | Record a pick, recompute next-pick predictions | same |
| POST | `/api/v1/draft/ghost-reset` | Wipe ghost draft state | same |

## 9. Rosters / League / Community

| Method | Path | Description | Auth |
|---|---|---|---|
| GET | `/api/v1/rosters/load?teamId=` | Load rosters | open |
| POST | `/api/v1/rosters/save` | Save one team's roster | open |
| POST | `/api/v1/rosters/bulk-save` | Save all teams in one PUT (avoids read-modify-write race) | open |
| POST | `/api/v1/rosters/reset` | Wipe all rosters | open |
| GET/POST | `/api/v1/schedule` | Matchup schedule | open |
| GET/POST | `/api/v1/league-settings?leagueId=` | League settings + teams (per-league key, falls back to legacy shared key) | open |
| GET/POST | `/api/v1/community` | Champions Corner / commish media / happy hours | open |
| POST | `/api/v1/community/media` | Binary media upload | open |
| GET/POST | `/api/v1/week/current` | Current week/season/type | open |
| GET/POST | `/api/v1/transactions` | Transaction log (capped 300, prepend-newest) | open |
| GET/POST | `/api/v1/trade-offers` | League trade offers | open |
| GET/POST | `/api/v1/waivers` | Waiver claims + priority order | open |
| GET/POST | `/api/v1/user-prefs?teamId=` | Per-team prefs (watchlist, overrides, theme) | open |

## 10. Owners / Password Reset

| Method | Path | Description |
|---|---|---|
| GET | `/api/v1/owners/config` | Owner map (strips reset tokens from response) |
| POST | `/api/v1/owners/config` | Write owner map |
| POST | `/api/v1/owners/reset-request` | Generate reset token, email link via Resend |
| GET | `/api/v1/owners/reset-verify?token=` | Validate a reset token |
| POST | `/api/v1/owners/reset-complete` | Apply new password |

## 11. League Management (create/import)

Requires `X-FantasAI-Key` — a code comment notes this was previously open and got hit by an unauthenticated request creating an unexplained league.

| Method | Path | Description |
|---|---|---|
| POST | `/api/v1/leagues/create` | Create a new league | R2 `fantasai/leagues/{leagueId}/*` |
| POST | `/api/v1/leagues/import` | Import from Sleeper (validated) or another platform | same |

## 12. Chat

| Method | Path | Description |
|---|---|---|
| POST | `/api/v1/chat` | See [ARCHITECTURE.md → AI Architecture → Chat](../ARCHITECTURE.md#ai-architecture) for the full local/OpenAI/Anthropic routing logic. Response includes a `source` field identifying which backend actually answered. |

## 13. Sleeper / CBS Proxies

Sleeper routes require `X-FantasAI-Key` if configured (`PROTECTED_GET`):

| Method | Path | Description |
|---|---|---|
| GET | `/api/v1/injuries` | League-wide injury report |
| GET | `/api/v1/stats/week?week=&season=&type=` | Weekly stat lines |
| GET | `/api/v1/projections?week=&season=&type=` | Weekly projections |
| GET | `/api/v1/league`, `/api/v1/rosters`, `/api/v1/draft?year=` | CBS proxy (requires `X-FantasAI-Key`) |
| GET | `/api/v1/cbs/players` | CBS players + RotoWire news, public, cached 300s. Accepts `X-CBS-Cookie` header for authenticated CBS account data. |
| GET | `/api/v1/cbs/rankings?pos=` | CBS rankings, public, cached 900s |

## 14. Generic Proxy / Scrape

| Method | Path | Description |
|---|---|---|
| GET | `/api/v1/proxy?url=&keyHeader=&keyValue=&keyHost=` | Server-side fetch, host-whitelisted (Sleeper, ESPN, Yahoo, RapidAPI Tank01, TheSportsDB, GitHub, FantasyPros, leaguelogs.com) |
| POST | `/api/v1/scrape` | Fetch **any** http/https URL server-side, return raw HTML capped at 600KB. **No host whitelist** — treat as an SSRF-shaped surface, don't expose unauthenticated in a hardening pass. |

## 15. Labeling / Feedback (human-in-the-loop)

| Method | Path | Description | Auth |
|---|---|---|---|
| GET | `/api/v1/labels/article` | List article labels | open |
| POST | `/api/v1/labels/article` | Add/replace a label | requires `X-FantasAI-Key` |
| GET | `/api/v1/feedback/scores` | Aggregate article relevance scores | open |
| POST | `/api/v1/feedback/vote` | Vote on labels (BREAKOUT/SLEEPER/INJURY_IMPACT/etc.) — comment notes Databricks used to ingest these nightly; unconfirmed if that still runs | open |

## 16. Admin

| Method | Path | Description | Auth |
|---|---|---|---|
| POST | `/api/v1/login-log` | Append a login event | open |
| GET | `/api/v1/login-log` | Full login history including every user's email — **sensitive, code comment flags this explicitly** | requires `X-FantasAI-Key` |

## 17. Push Notifications

Full RFC 8291 Web Push implementation from scratch (VAPID). `PUSH_SUBS` KV binding is **commented out / not provisioned** in `wrangler.toml` — code degrades gracefully but sends will no-op until it's provisioned.

| Method | Path | Description | Auth |
|---|---|---|---|
| POST | `/api/v1/push/subscribe` | Store a subscription | open |
| POST | `/api/v1/push/unsubscribe` | Remove a subscription | open |
| POST | `/api/v1/push/send` | Send a notification (optionally to `teamIds` subset) | requires `X-FantasAI-Key` + VAPID secrets |

---

## Response Format

Most R2-backed endpoints return:
```json
{
  "data": [ /* array of records */ ],
  "metadata": {
    "generated_at": "ISO 8601 timestamp",
    "record_count": 123
  }
}
```
Some newer endpoints (live scoring, ghost picks) return bespoke shapes — see [DATA_SCHEMAS.md](DATA_SCHEMAS.md).

## Caching

R2 objects served via `/api/v1/r2/{key}` generally carry `Cache-Control: public, max-age=3600`. A few routes use tighter/looser caching: `/api/v1/players` (1h edge cache), `/api/v1/cbs/players` (300s), `/api/v1/cbs/rankings` (900s), chat responses (5-minute SHA-256-keyed edge cache).

## Secrets / Bindings Referenced (names only)

`FANTASAI_KEY`, `RESEND_API_KEY`, `WWO_API_KEY`, `LOCAL_CHAT_URL`, `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `DATABRICKS_HOST`/`DATABRICKS_URL`, `DATABRICKS_TOKEN`, `DATABRICKS_HTTP_PATH`/`DATABRICKS_WAREHOUSE_ID`, `VAPID_PRIVATE_KEY`, `VAPID_PUBLIC_KEY`. Bindings: `BUCKET` (R2), `PUSH_SUBS` (KV, unprovisioned).

---

**Generated:** 2026-08-22 from a full read of `worker-api/src/index.js` and `worker-api/wrangler.toml`.
