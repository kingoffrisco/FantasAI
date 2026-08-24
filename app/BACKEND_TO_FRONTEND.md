# FantasAI Backend-to-Frontend Integration Guide

**Last Updated:** August 22, 2026
**Target:** Frontend developers working on the FantasAI React app

> This replaces the June 5, 2026 version, which described a Databricks-only backend and a much smaller app. Rewritten from a full read of `app/src/api.js`, `App.jsx`, `app/src/components/layout.jsx`, `app/src/lib/liveScoring.js`, and the full `app/src/screens/` directory (26 files).

---

## 🎯 Overview

**Backends:**
- **`https://api.fantasai.net`** — primary Cloudflare Worker. Almost everything goes here.
- **`https://fantasai-cbs.fantasai.workers.dev`** (overridable via `VITE_WORKER_URL`) — legacy, used only for CBS Sports Fantasy proxy calls (`/api/cbs/*`).

**Auth header:** `X-FantasAI-Key` (env `VITE_FANTASAI_KEY`, defaults to the literal `'fantasai2026'` baked into the client bundle) — required by most `api.fantasai.net` reads/writes. CBS calls additionally send `X-CBS-Cookie` from localStorage when the user has connected a CBS account.

**⚠️ Known issue:** `https://api.fantasai.net` is hardcoded as a local `API_BASE` constant independently in at least 10 files (`App.jsx`, `AdminOwners.jsx`, `ChangePassword.jsx`, `Login.jsx`, `Compare.jsx`, `CurrentRoster.jsx`, `Sources.jsx`, `LeagueSettings.jsx`, and others) instead of being imported from `app/src/api.js`. If the API domain ever changes, all of these need to be updated individually. New code should import from `api.js` instead of redeclaring the constant.

**Data delivery:** Mostly Cloudflare R2 JSON, read through the Worker's `/api/v1/r2/{key}` passthrough. A few routes (`/api/v1/db/players`, `/api/v1/news/ai-summaries`, `/api/v1/opportunity/rankings`) still query Databricks directly, but only as a last-resort fallback behind an R2 primary — see [docs/API_ENDPOINTS.md](../docs/API_ENDPOINTS.md). Five other Databricks-backed routes with no frontend caller were removed 2026-08-23.

---

## 📦 `app/src/api.js` — Function-to-Endpoint Map

This is the central API client; prefer it over ad-hoc `fetch()` calls in screens.

### CBS Worker proxy (`BASE`)
| Function | Endpoint |
|---|---|
| `api.league()` | `GET /api/cbs/league` |
| `api.teams()` | `GET /api/cbs/teams` |
| `api.rankings(pos)` | `GET /api/cbs/rankings?pos=` |
| `api.draft(year)` | `GET /api/cbs/draft?year=` |
| `api.rosters()` | `GET /api/cbs/rosters` |
| `api.sleeperPlayers()` | `GET /api/cbs/sleeper-players` |

### Player pool (`API_BASE`)
| Function | Endpoint | Notes |
|---|---|---|
| `api.dbPlayers()` | `GET /api/v1/db/players` | ⚠️ Databricks-backed, unconfirmed live |
| `api.allPlayers(limit)` | `GET /api/v1/players?limit=` | Sleeper-backed fallback |

### R2 data (`api.r2.*`, all `GET /api/v1/r2/{key}`)

~37 distinct keys. Notable ones (see [docs/DATA_SCHEMAS.md](../docs/DATA_SCHEMAS.md) for shapes):

`players2026`, `lineup`, `injuries`, `trends`, `playerScores`, `trade`, `waivers`, `drops`, `playerNotes`, `playerNewsLinks`, `criticalAlerts`, `enrichedNews`, `aiSummaries`, `breakoutCandidates` (falls back to `/api/v1/opportunity/rankings` — ⚠️ Databricks-backed), `sleeperPicks`, `weatherForecast`, `defenseAdp`, `defensePerformance`, `defensePredictions`, `defenseVsPos`, `rookieScores`, `collegeStats`, `weeklyStats` (583K records — on-demand only, don't fetch eagerly), `adpPPR`, `adpStandard`, `ecrPPR`, `ecrStandard`, `playerWriteups`, `nflSchedule`, `opponentLookup`, `playerOwnership`, `combineData`, `playerStats2025`, `olineIndex`, `playerTeamHistory`, `weaponScores`, `teamSupportScores`, `olineStability`, `playerOlineStability`, `weeklyStartSit`, `deepReasoning` *(new, 2026-08-22 — Job 5 output, only covers the weekly top-slice ~300 players, not the full pool)*, `dkSlates`, `dkSalaries`, `kalshiNflMarkets`

The Player detail popup (`Players.jsx`) now shows a "Deep Reasoning" card (breakout score, confidence, risk flag, recommendation) below the existing Job 3 writeup card whenever `deepReasoning` has an entry for that player — it's additive, not a replacement, since Job 5 doesn't cover the full player pool.

`api.r2.list(prefix)` → `GET /api/v1/r2/list?prefix=`

### Transactions
`api.transactions.get/log` → `GET/POST /api/v1/transactions`

### Draft state
| Function | Endpoint |
|---|---|
| `api.draftPicks.get/save` | `GET/POST /api/v1/draft/picks` |
| `api.draftChat.get/save` | `GET/PUT /api/v1/r2/fantasai/draft/chat_log.json` |
| `api.draftQueue.get/save` | `GET/PUT /api/v1/r2/fantasai/draft/queue_by_team.json` |
| `api.draftState.get/save` | `GET/PUT /api/v1/r2/fantasai/draft/state.json` |

### Auth/admin
| Function | Endpoint |
|---|---|
| `api.loginLog.record/list` | `POST`(keepalive)`/GET /api/v1/login-log` |
| `api.leagues.list()` | R2 list + fetch each `fantasai/leagues/*/league-config.json` |
| `api.leagues.delete(leagueId)` | `DELETE /api/v1/r2/fantasai/leagues/{leagueId}/{league-config.json,owners-config.json}` |

### Called directly with `fetch()`, outside `api.js`
`/api/v1/owners/config` (GET/POST — `App.jsx`, `AdminOwners.jsx`, `ChangePassword.jsx`, `Login.jsx`), `/api/v1/rosters/load`, `/api/v1/rosters/save`, `/api/v1/rosters/reset`, `/api/v1/league-settings`, `/api/v1/league` (cookie health check), plus the live-scoring endpoints (see below).

---

## 🖥️ Screen Inventory (`app/src/screens/*.jsx`)

26 files, 23 routed from `App.jsx`, 2 embedded-only, **3 orphaned**.

| Screen | Purpose | Status |
|---|---|---|
| `Dashboard.jsx` | Home — standings, lineup summary, alerts, live scores | routed (`dashboard`) |
| `Players.jsx` | Main player pool/rankings, hosts Watchlist tab, heaviest R2 consumer | routed (`players`) |
| `News.jsx` | Player news feed | routed (`news`) |
| `CurrentRoster.jsx` | Roster/slots, AI lineup panel, trade responses, embeds `LineupDecisions.jsx` | routed (`roster`) |
| `HeadToHead.jsx` | Weekly matchup + **live in-game scoring** | routed (`h2h`) |
| `Compare.jsx` | Player comparison + "Ask FantasAI" verdict | routed (`compare`) |
| `Trade.jsx` | Trade builder/grader | routed (`trade`) |
| `DraftRoom.jsx` | Mock + live draft, Ghost Picks, Big Board, chat (~3,400 lines) | routed (`draft`) |
| `DraftRecap.jsx` | Post-draft grading vs. ADP | routed (`draft` → recap) |
| `OwnerIntel.jsx` | Owner profiles, draft-tendency insight | routed (`owners`) |
| `Sources.jsx` | Data source config + fallback-chain diagnostic | routed (`sources`) |
| `LeagueSettings.jsx` | Scoring rules, roster limits, push notifications | routed (`settings`) |
| `AccountEdit.jsx` | Theme, AI scoring weights, team prefs | routed (`account`) |
| `Transactions.jsx` | League transaction log | routed (`transactions`) |
| `PowerRankings.jsx` | Rankings/points/schedule, sparklines | routed (`power`) |
| `AdminOwners.jsx` | Admin: owner management | routed (`admin-owners`, admin only) |
| `ScoringTest.jsx` | Admin: scoring math test harness | routed (`admin-scoring`, admin only) |
| `LoginLog.jsx` | Admin: login activity log | routed (`admin-loginlog`, admin only) |
| `AdminLeagues.jsx` | Admin: created/imported leagues management | routed (`admin-leagues`, admin only) |
| `Login.jsx` | Login + league create/import + password reset entry | routed (pre-auth gate) |
| `ChangePassword.jsx` | Forced password change + reset flow | routed (conditional gate) |
| `LineupDecisions.jsx` | Start/sit optimizer (`computeOptimal`) | embedded in `CurrentRoster.jsx` |
| `Watchlist.jsx` | Watchlist table | embedded in `Players.jsx` |
| `Waivers.jsx` | Standalone waiver-order/claims screen | **⚠️ orphaned — not imported anywhere** |
| `WarRoom.jsx` | Draft-prep mock-draft-batch analyzer | **⚠️ orphaned — not imported anywhere** |
| `SeasonPerformance.jsx` | Full-season score simulation | **⚠️ orphaned — not imported anywhere** |

The 3 orphaned screens exist on disk with no route wiring anywhere in `App.jsx` or any other component (confirmed via grep). Decide whether to wire them in, delete them, or leave as intentional reference — they currently just add dead weight to the bundle.

---

## 🧭 Routing (`App.jsx`)

No router library — a single `useState('dashboard')` string (`active`) drives a big conditional render. Auth gate sequence: `?reset=` token → `ResetPasswordScreen`; no `user` → `Login`; `needsPasswordChange` → `ChangePassword`; otherwise the main shell.

Admin routes (`admin-owners`, `admin-scoring`, `admin-loginlog`, `admin-leagues`) are gated only by nav-item visibility in `Sidebar`/`MobileNav` (`user.isAdmin`) — `App.jsx` does not re-check `isAdmin` before rendering if `active` is somehow set to one of those values directly. This is nav-visibility gating, not a hard route guard.

`DraftRoom` is always mounted (kept alive with `display:none` when inactive) so pick timers and AI auto-picks continue while the user browses elsewhere; a floating "Return to Draft" banner appears app-wide during an active draft.

Admin identity: `admin@fantasai.net` is treated as always-admin independent of server state; other users' `isAdmin`/`isCommissioner` flags are re-validated against R2 owner config on each cold load.

---

## 🧭 Navigation Structure (`app/src/components/layout.jsx`)

- **League:** Dashboard, Current Roster, Head to Head, Power Rankings, Players, News & Updates, Transactions
- **Tools:** My Account/Team, Compare, Trade Analyzer
- **Draft:** Draft Room, Owner Intel, Player Draft Rankings
- **Setup:** Sources, Rules & Settings
- **Admin** (if `user.isAdmin`): Owners, Scoring Test, Login Log, Leagues

---

## 🏈 Live In-Game Scoring (`app/src/lib/liveScoring.js`)

Consumed only by `HeadToHead.jsx` — not used in `DraftRoom.jsx`.

- `getScoringRules()` — reads league scoring config from `localStorage`.
- `calcFantasyPts(stats, rules)` — raw box-score stats → fantasy points. **This calculation is duplicated in 3 places** (here, `worker-api`'s `handleNflPlayerStats`, and `local_processing/job_live_scores.py`) — must be kept in sync manually if scoring rules change.
- `getGameProgress()` / `blendProjectedFinal()` — blends live points-so-far with a pace-adjusted remaining-game projection.
- `fetchEspnScoreboardDirect()` / `fetchEspnPlayerStatsDirect()` — **browser-direct ESPN fallback**, used only when the Worker/R2 cache has no data yet for the requested week. Display-only, never written back to R2.

**Integration:** `HeadToHead.jsx` polls `GET {workerUrl}/api/v1/nfl/scoreboard?week=&season=&type=` and `.../player-stats` every 60s, but only while at least one game is in progress (stops once the week is final). Falls back to the direct-ESPN functions above if the Worker returns zero games (i.e., `job_live_scores.py` hasn't populated R2 for that week yet). Scores are matched to rostered players by lowercased/trimmed name.

---

## 🎨 Draft Room (`DraftRoom.jsx`, ~3,400 lines)

Large, self-contained draft experience:
- **Mock draft mode** — full setup flow, slot selection, scheduled mocks, session persisted to `localStorage` so it survives navigation/refresh.
- **Live draft mode** — synced via `api.draftPicks`/`draftState`/`draftQueue`/`draftChat` so all owners see the same board in real time; commissioner-only per-team "team mode" controls.
- **Ghost Picks** tab — AI-predicted picks for teams still on the clock (see [ARCHITECTURE.md → AI Architecture → Ghost Picks](../ARCHITECTURE.md#ai-architecture)).
- **Big Board** — full pool with NextGen Stats columns, inline player detail.
- **Turn chimes**, **per-team draft queues**, **chat & activity feed** (all R2-persisted).
- Cross-references CFBD college stats and live Sleeper stats for rookie/prospect context.
- Reports status to `App.jsx` (drives sidebar badge, "Return to Draft" banner, topbar LIVE/PAUSED/COMPLETE indicator).

---

## ⚠️ Known Frontend Issues

1. **3 orphaned screens** — `Waivers.jsx`, `WarRoom.jsx`, `SeasonPerformance.jsx`. Not routed anywhere.
2. **Duplicated `API_BASE` constant** — see Overview above.
3. **`breakoutCandidates` fallback hits a Databricks-backed route** (`/api/v1/opportunity/rankings`) if the R2 read fails — silent degradation if Databricks is down, worth a health check.
4. **`weeklyStats` R2 key is ~50-100MB** — confirmed still true; fetch on-demand only, never eagerly on page load.

---

**Generated:** 2026-08-22 from a full read of `app/src/api.js`, `App.jsx`, `layout.jsx`, `liveScoring.js`, and all 26 files in `app/src/screens/`.
