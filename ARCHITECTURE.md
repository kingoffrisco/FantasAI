# FantasAI System Architecture

**Last Updated:** August 22, 2026
**Version:** 4.0
**Platform:** Local Python / DuckDB / Windows Task Scheduler / Cloudflare Workers

> **Migration Notice (June 15, 2026):** Databricks infrastructure (30 jobs, Unity Catalog, 79 Delta tables) was decommissioned. The full ETL pipeline runs locally on the RTX 4080 server using DuckDB as the data warehouse. Cloudflare R2 exports and the frontend are otherwise unchanged.
>
> **Correction (August 22, 2026):** The migration is not 100% complete. Several `worker-api` endpoints (`/api/v1/db/players`, `/api/v1/db/tables`, `/api/v1/news/latest`, `/api/v1/news/critical`, `/api/v1/news/ai-summaries`, `/api/v1/player/{name}`, `/api/v1/leaderboard/live`, `/api/v1/games/active`, `/api/v1/opportunity/rankings`) still issue live queries against the old Databricks SQL Warehouse (`queryDatabricks()` in `worker-api/src/index.js`). Whether Databricks credentials are still valid/provisioned is unconfirmed — these routes may be silently dead. Every other route is R2/local-pipeline-backed. See [docs/API_ENDPOINTS.md](docs/API_ENDPOINTS.md) for the full endpoint-by-endpoint split.

---

## Table of Contents

1. [System Inventory](#system-inventory)
2. [System Overview](#system-overview)
3. [AI Architecture](#ai-architecture)
4. [Architecture Diagram](#architecture-diagram)
5. [DuckDB Schema](#duckdb-schema)
6. [Job Schedules](#job-schedules)
7. [Repository Structure](#repository-structure)
8. [Worker API](#worker-api)
9. [Frontend](#frontend)
10. [Known Issues & Vestigial Code](#known-issues--vestigial-code)
11. [End-to-End Workflow](#end-to-end-workflow)

---

## System Inventory

**As of August 22, 2026 (verified against live Windows Task Scheduler and full source read):**

```
🗄️  DATABASE:   DuckDB (local_processing/db/fantasai.duckdb) — 49 tables (verified live 2026-08-27)
   ├─ Bronze:        18
   ├─ Silver:         4
   ├─ Gold:           3
   ├─ Export:         1
   ├─ Weather:        2
   ├─ nflverse supplement:  6  (headshots, YAC, NGS, depth, snaps, efficiency)
   ├─ O-Line Index:   2  (team_oline_index, player_team_seasons)
   ├─ Offensive Ecosystem: 2  (player_weapon_scores, team_support_scores)
   ├─ O-Line Stability: 5  (depth_chart_history, player_roster_bio, player_penalties,
   │                        team_oline_stability, player_oline_stability)
   ├─ Coverage/Rush Box Matchups: 4  (player_coverage_splits, team_coverage_tendency,
   │                        player_rush_box_splits, team_rush_box_tendency)
   ├─ Floor/Ceiling Projections: 1  (player_floor_ceiling)
   └─ Misc:           1  (watchlist)

⚙️ JOBS:       14 Windows Task Scheduler tasks under \FantasAI\ (confirmed live)
   ├─ FantasAI - Daily News Orchestrator          7:00 AM daily
   ├─ FantasAI - Weekly Stats Orchestrator         Tue 3:00 AM
   ├─ FantasAI - Weekly Deep Reasoning             Wed 1:30 AM
   ├─ FantasAI - Job3 Rostered Writeups (Nightly)  2:00 AM daily
   ├─ FantasAI - Job3 All Player Writeups (Weekly) Sun 3:00 AM
   ├─ FantasAI - Live Scores Auto-Poll             hourly (games-aware)
   ├─ FantasAI - Gameday TNF / Sun Early / Sun Late / SNF / MNF  (5 tasks, kickoff-timed)
   ├─ FantasAI Pipeline Runner                     2:30 AM daily
   ├─ FantasAI - Chat Server                       always-on (no discrete schedule)
   └─ FantasAI - Deep Reasoning One-Time Catchup   one-off backfill, not recurring

🤖 LOCAL AI:   Ollama serving Qwen3 models (8B / 14B / 30B) on the RTX 4080
   ├─ job1_news_processor.py    — Qwen3 8B, bulk news enrichment
   ├─ job2_fantasy_analyzer.py  — Qwen3 14B, 9-dimension fantasy scoring
   ├─ job3_player_writeups.py   — Qwen3 14B (top 200 ADP) / 8B (rest), narrative writeups
   ├─ job4_weekly_startsit.py   — Qwen3 14B, hybrid score + narrative start/sit
   ├─ job5_deep_reasoner.py     — Qwen3 30B, breakout/buy-sell reasoning on top ~300 candidates/week (bumped from 15 on 2026-08-22)
   ├─ job_ghost_picks_builder.py — Qwen3 14B, pre-draft team/prospect profiles (manual, pre-NFL-draft only)
   └─ chat_server.py            — FastAPI on :8000, routes simple/medium chat to Qwen3 8B/14B
```

### Validation Rule

**This document is OUT OF DATE if:**
- New data sources exist without a corresponding `local_processing/ingest/` script
- Exports to R2 exist without a corresponding key in `local_processing/export/export_to_r2.py` **or** a direct `r2_put`/`env.BUCKET.put` call in another script/worker route
- `Get-ScheduledTask -TaskPath "\FantasAI\"` shows tasks not listed in [Job Schedules](#job-schedules)

**To validate:**
```powershell
# Ground truth for what's actually scheduled
Get-ScheduledTask -TaskPath "\FantasAI\" | Select-Object TaskName, State
Get-ScheduledTask -TaskPath "\FantasAI\" | Get-ScheduledTaskInfo | Select-Object TaskName,LastRunTime,NextRunTime
```
```bash
# DuckDB tables
python -c "import duckdb; c=duckdb.connect('local_processing/db/fantasai.duckdb'); print(c.execute('SHOW TABLES').fetchall())"
```

---

## System Overview

FantasAI is a fantasy football analytics platform that ingests NFL/fantasy data from many sources, runs it through a local Bronze → Silver → Gold pipeline, enriches it with a locally-hosted 3-tier Qwen3 LLM stack, and serves the results to a React frontend via Cloudflare R2 + a Cloudflare Worker API. It also runs a live draft room (real + AI "Ghost Picks" mock draft), live in-game scoring, and an AI chat assistant.

**Key Components:**
- **Data Ingestion:** ~20 ingest scripts across Sleeper, ESPN, nflverse, API-Sports, FantasyPros, Google News, CFBD, WorldWeatherOnline, plus internally-computed proprietary metrics (O-Line Index, O-Line Stability, Offensive Ecosystem, Rookie Scores)
- **Data Processing:** Bronze/Silver/Gold medallion architecture in DuckDB
- **AI Enrichment:** 5 sequential local LLM jobs (news → scoring → writeups → start/sit → deep reasoning) plus an on-demand chat server
- **Data Export:** ~30+ distinct R2 JSON keys, written by `export_to_r2.py` and by several ingest/job scripts directly
- **API Layer:** Cloudflare Worker (`api.fantasai.net`) serving R2 data, plus a handful of still-Databricks-backed routes (see migration notice above)
- **Live Features:** In-game scoring (local poller → R2 → Worker → frontend), live draft sync, AI Ghost Picks
- **Human-in-the-Loop:** Article label corrections feed ML retraining (see original `docs/HUMAN_IN_THE_LOOP_INTEGRATION.md` — largely unchanged, still R2 `fantasai/labeling/article_labels.json` + `fantasai/feedback/*`)

---

## AI Architecture

**Design Principle:** Push high-volume/latency-insensitive work to local GPU; reserve frontier models for the few cases where quality is user-visible in real time.

### Local Batch Tiers (unchanged in spirit, Job 5 added)

| Job | Model | Purpose | Schedule | Output |
|---|---|---|---|---|
| Job 1 — `job1_news_processor.py` | Qwen3 8B | Article classification: relevance, sentiment, injury tags, beat-writer signals | Task 4 of daily orchestrator, ~7 AM | `fantasai/news/player_notes.json`, `ai_summaries.json` |
| Job 2 — `job2_fantasy_analyzer.py` | Qwen3 14B | 9-dimension player scoring (waiver/trade buy/trade sell/start/sit/injury risk/dynasty/matchup/rookie) | after Job 1 | `fantasai/analysis/player_scores.json` + 4 derived files |
| Job 3 — `job3_player_writeups.py` | Qwen3 14B (top 200 ADP) / 8B (rest) | 2-3 paragraph narrative player profiles | Nightly 2 AM (rostered), Sun 3 AM (all ~977 players) | `players/player_writeups.json` |
| Job 4 — `job4_weekly_startsit.py` | Qwen3 14B | Hybrid deterministic + LLM start/sit advisor | on-demand / weekly | `fantasai/analysis/weekly_startsit.json` |
| **Job 5 — `job5_deep_reasoner.py`** *(new)* | **Qwen3 30B** | Deep breakout/buy-sell reasoning on the top ~300 highest-signal candidates/week (ranked by Job 2 scores + breakout opportunity; bumped from 15 on 2026-08-22), with a self-consistency check | Wed 1:30 AM via `orchestrator_weekly_reasoning.py` | `fantasai/analysis/deep_reasoning.json` |

Job 5 is deliberately kept off the daily 8B/14B chain — the 30B model is expensive enough that it only runs overnight, once a week, on a small pre-filtered candidate set. See `docs/WEEKLY_DEEP_REASONING_TASK.md`.

`ollama_utils.py` is a shared, more robust Ollama harness (JSON repair for Qwen3 output flakiness, `ollama run` CLI with `--think=false --format json --keepalive 30m`) — currently only Job 5 uses it; Jobs 1–4 and `chat_server.py` still hit the raw `http://localhost:11434/api/generate` HTTP endpoint directly.

### Chat — Corrected (was: "Tier 3 = OpenAI + Cloudflare AI fallback")

Chat routing actually happens in **two layers**:

1. **`local_processing/chat_server.py`** (FastAPI, port 8000) — classifies intent as `simple`/`medium`/`complex` and answers `simple`/`medium` with local Qwen3 8B/14B. `complex` gets a local-best-effort 14B answer, but the code explicitly notes the Worker layer may escalate.
2. **`worker-api`'s `POST /api/v1/chat`** — does its own independent intent classification (regex-based), then routes:
   - `simple`/`medium` → **local Ollama first** (`env.LOCAL_CHAT_URL` → `chat_server.py`) → falls back to OpenAI `gpt-4o-mini` on failure
   - `complex` → **OpenAI `gpt-4o` first** → falls back to local Ollama 14B → falls back to **Anthropic `claude-opus-4-8`** (3 retries) as last resort
   - Live enrichment (real-time injury status, opponent defense-rank) is injected into every prompt before it's sent anywhere
   - Response includes a `source` field: `local-8b`, `local-14b`, `local-14b-fallback`, `openai-gpt-4o-mini`, `openai-gpt-4o`, or `anthropic`

**Cloudflare Workers AI is not used anywhere** — no `env.AI` binding exists in `worker-api/src/index.js`. The old doc's "80% Cloudflare AI / 20% OpenAI" cost model no longer applies; replace with: local-first, OpenAI as primary cloud fallback, Anthropic as last resort.

### Ghost Picks — Draft Probability Engine (unchanged design, now confirmed implemented)

Two-phase design, confirmed present in both `local_processing/job_ghost_picks_builder.py` and `worker-api`'s `/api/v1/draft/ghost-*` routes:

- **Pre-draft (Qwen3 14B, manual trigger, once per year before the NFL Draft):** `job_ghost_picks_builder.py` generates team tendency profiles and per-prospect scores, writes `fantasai/draft/ghost_picks/{team_profiles,prospect_scores,board}.json`. Not on any recurring schedule — this is intentionally a manual, once-a-year run.
- **Live during draft (pure math, no LLM):** Worker computes `Ghost Score = need(30%) + history(25%) + rumor(25%) + value(10%) + athletic(10%)` per available prospect, sub-50ms per pick, served via `GET /api/v1/draft/ghost-board` and updated via `POST /api/v1/draft/ghost-pick`.

This matches the original design intent exactly — no correction needed here, just confirmation it shipped.

### Cost & Performance Summary

| Tier | Workload | Model | Infra | Cost |
|---|---|---|---|---|
| Batch (Jobs 1–5) | News, scoring, writeups, start/sit, deep reasoning | Qwen3 8B/14B/30B | Local RTX 4080 | ~$0 |
| Chat simple/medium | Interactive Q&A | Qwen3 8B/14B (local) → OpenAI gpt-4o-mini fallback | Local + cloud fallback | ~$0 typical, small fallback cost |
| Chat complex | Multi-step strategy reasoning | OpenAI gpt-4o → local 14B fallback → Anthropic claude-opus-4-8 last resort | Cloud-first | Variable, capped by fallback chain |
| Ghost Picks (live) | Draft-day probability scoring | None (pure code) | Cloudflare Worker | ~$0 |

---

## Architecture Diagram

```
┌───────────────────────────────────────────────────────────────────────────┐
│                              DATA SOURCES                                   │
│  Sleeper │ ESPN │ nflverse │ API-Sports │ FantasyPros │ Google News │ CFBD  │
│  WorldWeatherOnline │ ESPN team RSS │ internal (O-Line/Ecosystem/Rookie)    │
└───────────────────────────┬───────────────────────────────────────────────┘
                             ▼
         Bronze (raw) → Silver (cleaned) → Gold (business logic)
         local_processing/db/fantasai.duckdb  (49 tables)
                             │
                             ▼  export_to_r2.py + direct r2_put() calls
┌───────────────────────────────────────────────────────────────────────────┐
│                     R2 Storage (~30+ JSON keys)                             │
│  players/ · news/ · analysis/ · stats/ · live/ · draft/ · leagues/ ...      │
└───────────────────────────┬───────────────────────────────────────────────┘
                             │
              ┌──────────────┴───────────────┐
              ▼                               ▼
  Local AI (Ollama, Qwen3 8B/14B/30B)   worker-api (Cloudflare Worker,
  Jobs 1-5 write scores/writeups/       api.fantasai.net) — reads R2,
  deep-reasoning back to R2             proxies Sleeper/ESPN/CBS/weather,
                                          routes chat, computes Ghost Picks,
                                          (+ a few routes still hit Databricks)
              │                               │
              └──────────────┬───────────────┘
                             ▼
                    Frontend (React/Vite, app.fantasai.net)
                    29 screens, 26 routed, 3 orphaned (see Known Issues)
```

---

## DuckDB Schema (`local_processing/db.py`)

**Bronze (raw ingestion):**

| Table | Source | Ingest Script |
|---|---|---|
| bronze_player_news_raw | Sleeper API (full player payload, incl. espn_id) | `ingest_sleeper_players.py` |
| bronze_player_news_espn_api | ESPN News API | `ingest_espn_news.py` |
| bronze_google_news | Google News RSS | `ingest_google_news.py` |
| bronze_nfl_transactions | ESPN Transactions API | `ingest_nfl_transactions.py` |
| bronze_weekly_stats | API-Sports.io | `ingest_apisports.py` |
| bronze_adp_rankings | FantasyPros HTML scrape | `ingest_adp.py` |
| bronze_dst_weekly_stats | Sleeper Stats API | `ingest_dst_performance.py` |
| bronze_nfl_schedules | nflverse | `ingest_schedules.py` |
| bronze_player_ownership | Sleeper public-league crawl | `ingest_ownership.py` |
| bronze_combine_data | nflverse | `ingest_combine.py` |
| **bronze_rookie_scores** *(new)* | Internal computation (no external API) | `ingest_rookie_scores.py` |
| **bronze_team_rss_news** *(new)* | ESPN team-level news feed | `ingest_team_rss.py` |
| bronze_cfbd_player_stats, bronze_cfbd_recruiting *(new)* | College Football Data API | `ingest_cfbd.py` |

**Silver:** silver_player_news, silver_injury_reports, silver_trending_players (`ingest_sleeper_players.py`); silver_weekly_stats (`ingest_nflverse.py` / `ingest_apisports.py` / `ingest_sleeper_stats.py`)

**Gold:** gold_player_dim, gold_player_id_mapping, gold_weekly_stats (`gold/gold_player_consolidation.py`)

**Export:** export_player_news (written by `job1_news_processor.py`)

**Weather:** weather_forecasts, weather_historical (`ingest_weather.py`)

**nflverse supplement:** player_headshots, player_yac_stats, player_nextgen_stats, depth_charts, player_snap_counts, player_efficiency_stats (all `ingest_nflverse.py`)

**O-Line Index** *(new subsystem)*: team_oline_index, player_team_seasons — proprietary pass/run block quality score from nflverse play-by-play, no PFF dependency (`ingest_oline_index.py`)

**Offensive Ecosystem** *(new subsystem)*: player_weapon_scores, team_support_scores — percentile-composite "weapon score" for pass-catchers and QB "Support Score/ESCV" (`ingest_offensive_ecosystem.py`, reads only — no new fetch, depends on O-Line Index)

**O-Line Stability** *(new subsystem)*: depth_chart_history (`ingest_depth_chart_history.py`, real per-week O-line lineups 2021-2025), player_roster_bio, player_penalties (both `ingest_nflverse.py`), team_oline_stability, player_oline_stability (`ingest_oline_stability.py` — continuity/chemistry/health composite, reads only)

**Misc:** watchlist (`watchlist.py`, manual CLI tool for pinning players outside top-200 ADP for news coverage)

**Betting/DFS** *(new, 2026-08-22, not yet scheduled — see `docs/BETTING_DATA_SOURCES.md`)*: bronze_dk_slates, bronze_dk_salaries (`ingest_draftkings.py`, unofficial DraftKings DFS endpoints — salaries/slates only, no Sportsbook odds yet); bronze_kalshi_nfl_markets (`ingest_kalshi.py`, official Kalshi public REST API, append-only for line-movement history)

**Floor/Ceiling** *(new, 2026-08-22, not yet scheduled)*: player_floor_ceiling (`ingest_floor_ceiling.py`) — empirical 25th/90th percentile from each player's own real game log in `gold_weekly_stats` (most recent ~24 games, min 6 required), not a simulation. 1,038 players covered as of first run. Feeds both the Player popup and the DFS AI Lineup Analysis.

**Total: ~36 tables**, up from 24 at the June 16 snapshot (`docs/LOCAL_MIGRATION_CHECKLIST.md`).

---

## Job Schedules

**Ground truth confirmed via `Get-ScheduledTask -TaskPath "\FantasAI\"` on August 22, 2026 — 14 tasks:**

| Task | Schedule | Runs |
|---|---|---|
| FantasAI - Daily News Orchestrator | 7:00 AM daily | `orchestrator_daily.py` |
| FantasAI - Weekly Stats Orchestrator | Tue 3:00 AM | `orchestrator_weekly.py` |
| FantasAI - Weekly Deep Reasoning | Wed 1:30 AM | `orchestrator_weekly_reasoning.py` → Job 5 |
| FantasAI - Job3 Rostered Writeups (Nightly) | 2:00 AM daily | `job3_player_writeups.py --mode rostered` |
| FantasAI - Job3 All Player Writeups (Weekly) | Sun 3:00 AM | `job3_player_writeups.py --mode all` |
| FantasAI - Live Scores Auto-Poll | hourly, self-throttles to tight polling during live games | `job_live_scores.py --auto` |
| FantasAI - Gameday TNF | Thu ~6:00 PM CT | `job_gameday.py` |
| FantasAI - Gameday Sun Early | Sun ~10:45 AM CT | `job_gameday.py` |
| FantasAI - Gameday Sun Late | Sun ~2:15 PM CT | `job_gameday.py` |
| FantasAI - Gameday SNF | Sun ~6:00 PM CT | `job_gameday.py` |
| FantasAI - Gameday MNF | Mon ~6:00 PM CT | `job_gameday.py` |
| FantasAI Pipeline Runner | 2:30 AM daily | `pipeline_runner.py` (exact args not confirmed from Task Scheduler metadata alone) |
| FantasAI - Chat Server | always-on (no discrete trigger observed) | `chat_server.py` |
| FantasAI - Deep Reasoning One-Time Catchup | one-off, already run 8/21, not recurring | manual Job 5 backfill |

**Not scheduled (manual/on-demand only), confirmed by absence from the live task list:**
- `job_ghost_picks_builder.py` — run once a year before the NFL Draft
- `local_processing/ingest_espn_schedule_2026.py` — standalone utility supporting `job_live_scores.py --auto`, not wired into either orchestrator
- `pipeline_watcher.py` — see [Known Issues](#known-issues--vestigial-code), likely vestigial
- `news_classifier.py` — dev/comparison tool, not production
- `ingest/ingest_draftkings.py`, `ingest/ingest_kalshi.py` *(new, 2026-08-22)* — built and verified live, but deliberately manual for now; `bronze_kalshi_nfl_markets` needs a recurring schedule before it accumulates any real line-movement history. See `docs/BETTING_DATA_SOURCES.md`.

### Daily Pipeline — `orchestrator_daily.py`

| Phase | Scripts | Output |
|---|---|---|
| 1. Ingest | `ingest_sleeper_players.py`, `ingest_espn_news.py`, `ingest_google_news.py --mode incremental`, `ingest_nfl_transactions.py --days 30`, `ingest_team_rss.py` | Bronze tables |
| 2. Gold | `gold/gold_player_consolidation.py` | Gold tables |
| 3. Export | `export/export_to_r2.py --only all` | R2 |
| 4. AI (optional, non-fatal, skipped with `--dry-run`) | Job 1 → Job 2 → Job 3 `--mode rostered` | R2 |

Flags: `--skip-ingest`, `--skip-export`, `--skip-ai`, `--dry-run`. Job 5 is explicitly **not** run here — it's a separate weekly lane.

### Weekly Pipeline — `orchestrator_weekly.py`

| Phase | Scripts | Output |
|---|---|---|
| 1. Stats + proprietary metrics | `ingest_nflverse.py`, `ingest_apisports.py`, `ingest_sleeper_players.py`, `ingest_adp.py`, `ingest_dst_performance.py`, `ingest_schedules.py`, `ingest_combine.py`, then in dependency order: `ingest_oline_index.py` → `ingest_offensive_ecosystem.py` → `ingest_depth_chart_history.py` → `ingest_oline_stability.py`, then `ingest_ownership.py` (non-fatal) | Bronze + proprietary tables |
| 2. Gold | `gold/gold_player_consolidation.py` | Gold tables |
| 3. Export | `export/export_to_r2.py --only all` | R2 |

### Weekly Deep Reasoning — `orchestrator_weekly_reasoning.py`

Single-purpose wrapper: runs only Job 5 (`--limit 300` default, bumped from 15 on 2026-08-22) on Wednesday 1:30 AM, after the weekly stats pipeline has refreshed player data. `ExecutionTimeLimit` was raised from 2h to 6h to match. See `docs/WEEKLY_DEEP_REASONING_TASK.md` for the exact registration/update commands.

---

## Repository Structure

```
local_processing/
├── db.py                              # DuckDB schema (49 tables)
├── db/fantasai.duckdb
├── ssl_utils.py                       # Windows cert store (truststore)
├── orchestrator_daily.py              # 7 AM: news → gold → R2 (+ AI Task 4)
├── orchestrator_weekly.py             # Tue 3 AM: stats + proprietary metrics → gold → R2
├── orchestrator_weekly_reasoning.py   # Wed 1:30 AM: Job 5 only
├── ingest_espn_schedule_2026.py       # Standalone: ESPN pre/regular season schedule → R2 (not in ingest/, not scheduled)
├── ingest/
│   ├── ingest_sleeper_players.py
│   ├── ingest_espn_news.py
│   ├── ingest_google_news.py
│   ├── ingest_nfl_transactions.py
│   ├── ingest_apisports.py
│   ├── ingest_nflverse.py
│   ├── ingest_adp.py
│   ├── ingest_weather.py
│   ├── ingest_dst_performance.py
│   ├── ingest_schedules.py
│   ├── ingest_ownership.py
│   ├── ingest_combine.py
│   ├── ingest_sleeper_stats.py        # Sleeper per-week fantasy stats (completed seasons)
│   ├── ingest_cfbd.py                 # College Football Data API — rookie college production
│   ├── ingest_rookie_scores.py        # Internal — 0-100 rookie score, cohort-curve projections
│   ├── ingest_team_rss.py             # ESPN team news — Tier 2/3 player coverage
│   ├── ingest_oline_index.py          # Proprietary O-Line pass/run block score
│   ├── ingest_offensive_ecosystem.py  # Weapon scores, QB Support Score/ESCV
│   ├── ingest_depth_chart_history.py  # Real per-week O-line lineups 2021-2025
│   └── ingest_oline_stability.py      # O-Line Stability Index (OLSI)
├── gold/gold_player_consolidation.py
├── export/export_to_r2.py             # ~17 keys via PUT api.fantasai.net/api/v1/r2/{key}
├── job1_news_processor.py             # Qwen3 8B
├── job2_fantasy_analyzer.py           # Qwen3 14B
├── job3_player_writeups.py            # Qwen3 14B/8B
├── job4_weekly_startsit.py            # Qwen3 14B
├── job5_deep_reasoner.py              # Qwen3 30B (new)
├── job_ghost_picks_builder.py         # Qwen3 14B, pre-draft, manual
├── job_gameday.py                     # No LLM — gameday injury/inactive updates
├── job_live_scores.py                 # No LLM — local ESPN poller, feeds worker-api live endpoints
├── ollama_utils.py                    # Shared Ollama CLI harness w/ JSON repair (Job 5 only, so far)
├── chat_server.py                     # FastAPI :8000, local chat backend for worker-api
├── pipeline_runner.py                 # Manual/scheduled sequencer for Jobs 1-5
├── pipeline_watcher.py                # Vestigial — polls a Databricks ETL marker that's no longer written
├── news_classifier.py                 # Dev/comparison tool, not production
├── notify.py                          # Windows toast on orchestrator failure
└── watchlist.py                       # CLI: manually pin players for news coverage
```

---

## Worker API

Full endpoint-by-endpoint reference: [docs/API_ENDPOINTS.md](docs/API_ENDPOINTS.md). Summary:

- **Base URL:** `https://api.fantasai.net` (Cloudflare Worker `fantasai-api`, R2 bucket `fantasai-r2` bound as `BUCKET`)
- **Auth:** No session/JWT system. A shared secret header `X-FantasAI-Key` gates a subset of routes (mostly reads that expose raw data, plus a few admin POSTs); most POST routes have no auth check at all ("called directly by the app"). Team login is a separate, simpler mechanism — an owner email/password map stored in R2, checked client-side.
- **R2 passthrough:** `GET/PUT/DELETE /api/v1/r2/{key}` and `GET /api/v1/r2/list?prefix=` — generic access to any R2 object, gated by `X-FantasAI-Key` if configured.
- **Databricks-backed routes still in the worker:** `/api/v1/db/players`, `/api/v1/db/tables`, `/api/v1/news/ai-summaries`, `/api/v1/opportunity/rankings` — call `queryDatabricks()`, but each is a last-resort fallback behind an R2 primary (never the sole source for any live screen). Live status of the Databricks warehouse itself is unconfirmed.
  Removed 2026-08-23 (queried Databricks tables with no active producer and had no frontend caller): `/api/v1/news/latest`, `/api/v1/news/critical`, `/api/v1/player/{name}`, `/api/v1/leaderboard/live`, `/api/v1/games/active`.
- **Live scoring:** `/api/v1/nfl/scoreboard` and `/api/v1/nfl/player-stats` moved from direct ESPN calls to reading R2 keys written by `job_live_scores.py`, after ESPN began 403-ing Cloudflare Workers' shared egress IPs on 2026-08-20.
- **Ghost Picks:** `/api/v1/draft/ghost-board`, `/api/v1/draft/ghost-pick`, `/api/v1/draft/ghost-reset` — pure-math scoring engine over data from `job_ghost_picks_builder.py`.
- **External proxies:** CBS Sports (via a separate `fantasai-cbs.fantasai.workers.dev` Worker, cookie passthrough), Sleeper (direct), ESPN (direct, schedule/news only), Nitter/RSS (beat writer tweets), WorldWeatherOnline, a generic host-whitelisted proxy, and an unrestricted `POST /api/v1/scrape`.
- **Chat:** see [AI Architecture → Chat](#ai-architecture).

---

## Frontend

Full detail: [app/BACKEND_TO_FRONTEND.md](app/BACKEND_TO_FRONTEND.md). Summary:

- React/Vite SPA, no router library — a single `active` string in `App.jsx` drives conditional rendering across 23 routed screens.
- **3 screens exist on disk but are not imported/routed anywhere:** `Waivers.jsx`, `WarRoom.jsx`, `SeasonPerformance.jsx` — dead code or shelved features, worth a decision.
- Draft Room (`DraftRoom.jsx`, ~3,400 lines) supports both mock and live drafting, Ghost Picks, a Big Board with NextGen Stats, per-team queues, chat, and turn chimes — always mounted (kept alive off-screen) so picks/timers continue while browsing elsewhere.
- Live in-game scoring (`app/src/lib/liveScoring.js`) is consumed only by `HeadToHead.jsx`: polls `worker-api`'s live endpoints every 60s while a game is in progress, with a direct-ESPN browser fallback if R2 has no data yet for that week.
- Two backend base URLs are in use: `api.fantasai.net` (primary) and the legacy `fantasai-cbs.fantasai.workers.dev` (CBS proxy only). The primary URL is duplicated as a local constant in ~10 separate screen files rather than imported from `api.js` — a consistency risk worth cleaning up.

---

## Known Issues & Vestigial Code

- **`pipeline_watcher.py`** polls an R2 marker (`fantasai/etl/last_refresh.json`) that Databricks used to write on each ETL run. Databricks access is fully gone per `docs/LOCAL_MIGRATION_CHECKLIST.md`, so this marker is likely never updated — the watcher is probably dead weight. The orchestrators now run on their own Task Scheduler cadence and don't depend on it. Recommend confirming and removing, or repointing it at a local completion marker if the trigger behavior is still wanted.
- **Orphaned frontend screens:** `Waivers.jsx`, `WarRoom.jsx`, `SeasonPerformance.jsx` are not reachable from any route. Confirm whether they should be wired in, deleted, or left as reference.
- **Duplicate `API_BASE` constant:** `https://api.fantasai.net` is hardcoded independently in `App.jsx`, `AdminOwners.jsx`, `ChangePassword.jsx`, `Login.jsx`, `Compare.jsx`, `CurrentRoster.jsx`, `Sources.jsx`, `LeagueSettings.jsx`, and others, instead of being imported from `app/src/api.js`. A future URL change would require touching every file.
- **Databricks-backed endpoints:** see migration notice at the top of this document — 9 worker-api routes still depend on Databricks; recommend either confirming they still work or migrating/retiring them to match the "fully local" story.
- **`FantasAI Pipeline Runner`** task (2:30 AM daily) — confirmed live in Task Scheduler, but its exact CLI arguments weren't recoverable from Task Scheduler metadata alone. Worth checking the actual registered command against `pipeline_runner.py`'s flags (`--job`, `--limit`, `--reasoning-limit`, `--full`) to confirm what it actually runs nightly, since Job 1-3 also run via the daily orchestrator and Job3-all/Job5 have their own dedicated tasks — possible overlap.
- **Job 3 scheduling split:** `orchestrator_daily.py`'s own docstring describes Job 3 rostered-mode as its Task 4, but Task Scheduler shows it as an independent task (`FantasAI - Job3 Rostered Writeups (Nightly)`), separate from `FantasAI - Daily News Orchestrator`. Not a bug, but the docstring should be updated to avoid confusion.

---

## End-to-End Workflow

### Adding a New Data Source

1. **Create ingest script** at `local_processing/ingest/ingest_<name>.py`; add its table(s) to `local_processing/db.py` → `init_schema()`.
2. **Wire into an orchestrator** — `orchestrator_daily.py` Phase 1 for daily-cadence sources, `orchestrator_weekly.py` Phase 1 for weekly ones. Respect dependency order if the new source reads other tables (see O-Line Stability's dependency on O-Line Index + depth chart history for a real example).
3. **Update Gold consolidation** (`gold/gold_player_consolidation.py`) if the new source should merge into the player dimension.
4. **Add an R2 export key** — either add a function to `export/export_to_r2.py`, or have the ingest script `PUT` directly to `https://api.fantasai.net/api/v1/r2/{key}` (both patterns are in active use; direct-write is now more common for the proprietary-metric scripts).
5. **Add a worker-api route** if the frontend needs it served through something other than a raw R2 read (most new data is served via the generic `/api/v1/r2/{key}` passthrough with no route code needed).
6. **Test end-to-end**, then update this document (System Inventory, DuckDB Schema, Job Schedules, Repository Structure) and `docs/API_ENDPOINTS.md` / `docs/DATA_SCHEMAS.md` if a new endpoint or schema was added.

**Rule: if you can't trace data from source → bronze → gold → R2 → worker-api → frontend, the pipeline is incomplete.**
