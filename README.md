# FantasAI

AI-powered fantasy football platform. React frontend, Cloudflare Worker API, local DuckDB pipeline, local GPU inference.

**Last Updated:** June 19, 2026 | **Data Warehouse:** `local_processing/db/fantasai.duckdb` (17 tables)

> **Migration (June 15, 2026):** Databricks infrastructure decommissioned. ETL now runs entirely on the local RTX 4080 server using DuckDB. R2 exports and the frontend are unchanged.

---

## Architecture

```
Sleeper / ESPN / Google News / API-Sports / nflverse
        │
        ▼
Local DuckDB Pipeline  (RTX 4080 server)
  Bronze → Silver → Gold
  local_processing/orchestrator_daily.py   — 7:00 AM daily
  local_processing/orchestrator_weekly.py  — Tue 3:00 AM
        │
        ▼  export_to_r2.py  →  PUT api.fantasai.net/api/v1/r2/{key}
        │
        ▼
  Cloudflare R2 (gzipped JSON)    ◄── Local Qwen GPU Pipeline
        │                              job1_news_processor.py  (Qwen 8B)
        ▼                              job2_fantasy_analyzer.py (Qwen 14B)
                                       job3_player_writeups.py  (Qwen 14B)
                                       job4_weekly_startsit.py  (Qwen 14B)
                                       job_gameday.py           (no LLM — game-day only)
  Cloudflare Worker  api.fantasai.net
        │
        ▼
  React Frontend  (Cloudflare Pages)
```

## Stack

| Layer | Tech | Details |
|---|---|---|
| **Frontend** | React + Vite | `app/src/` — 22 screens, deployed to Cloudflare Pages |
| **Worker API** | Cloudflare Worker | `worker-api/src/index.js` at `api.fantasai.net` |
| **Ghost Worker** | Cloudflare Worker | `worker/` — secondary worker project |
| **Storage** | Cloudflare R2 | Primary data store; Worker binds as `env.BUCKET` |
| **Data Warehouse** | DuckDB | `local_processing/db/fantasai.duckdb` — 17 tables, Bronze/Silver/Gold |
| **ETL Scheduler** | Windows Task Scheduler | 7 tasks: daily news, weekly stats, Job 3 × 2, pipeline runner, 5 game-day windows |
| **Local AI** | Qwen3 8B + 14B via Ollama | `local_processing/` — GPU pipeline on RTX 4080 |

## Key Directories

```
app/                    React + Vite frontend
  src/
    screens/            22 UI screens
    components/         Shared components
    hooks.js            R2 data hooks
    lib/                Stores, API client, data helpers
worker-api/             Primary Cloudflare Worker
  src/index.js          All API routes
worker/                 Ghost Cloudflare Worker
local_processing/       Local ETL + AI pipeline
  db.py                       DuckDB connection + schema (17 tables)
  db/fantasai.duckdb          Data warehouse file
  orchestrator_daily.py       Daily pipeline (7AM)
  orchestrator_weekly.py      Weekly pipeline (Tue 3AM)
  ingest/
    ingest_sleeper_players.py   Sleeper API + ESPN IDs
    ingest_espn_news.py         ESPN News API
    ingest_google_news.py       Google News RSS
    ingest_nfl_transactions.py  ESPN Transactions
    ingest_apisports.py         API-Sports.io game stats
    ingest_nflverse.py          nfl_data_py stats/depth/NGS
  gold/
    gold_player_consolidation.py  master_player_id + gold tables
  export/
    export_to_r2.py             Uploads 11 JSON keys to R2
  job1_news_processor.py      Bulk news (Qwen3 8B)
  job2_fantasy_analyzer.py    Fantasy analysis (Qwen3 14B) + sleeper picks
  job3_player_writeups.py     Player writeups (Qwen3 14B)
  job4_weekly_startsit.py     Weekly start/sit advisor (Qwen3 14B) — run Thu/Fri
  job_gameday.py              Game-day injuries/inactives/news (no LLM)
  pipeline_runner.py          Sequencer for Jobs 1-4
  requirements-local.txt      pip dependencies
notebooks/              Reference notebooks (Databricks source logic)
databricks/             SQL + archived notebook backups
docs/                   Documentation
```

## Local Pipeline Setup

```bash
# Install dependencies
pip install -r local_processing/requirements-local.txt

# Initialize DuckDB schema
python -c "from local_processing.db import get_conn, init_schema; init_schema(get_conn())"

# Set environment variables (.env file)
FANTASAI_KEY=<worker api key>
API_SPORTS_KEY=<api-sports.io key>

# Run daily pipeline manually
python local_processing/orchestrator_daily.py

# Register Windows Task Scheduler tasks (see docstrings in each orchestrator)
# Get-ScheduledTask -TaskPath "\FantasAI\"
```

## Data Flow

The frontend **never queries DuckDB directly**. All data goes through R2:

1. `orchestrator_daily.py` ingests Sleeper → ESPN → Google News → Transactions → DuckDB Bronze/Silver/Gold
2. `export_to_r2.py` uploads 11 JSON snapshots to R2 via Worker API (`PUT api.fantasai.net/api/v1/r2/{key}`)
3. Worker API reads R2 via `env.BUCKET` and serves to frontend
4. Frontend hooks (`useR2Analysis`, etc.) consume via `api.fantasai.net`

Local Qwen pipeline reads enriched news from R2, scores players, writes results back to R2.

## R2 Data Keys (Frontend Data Sources)

| R2 Key | Purpose |
|---|---|
| `fantasai/news/player_notes.json` | AI-enriched player notes (Job 1) |
| `fantasai/news/injury_report.json` | Current injury statuses |
| `fantasai/news/critical_alerts.json` | High-priority news alerts |
| `fantasai/news/enriched_news.json` | Full enriched news feed |
| `fantasai/news/player_news.json` | Combined ESPN + Google news |
| `fantasai/news/gameday_updates.json` | Game-day injuries/inactives/news (job_gameday.py) |
| `analysis/sleeper_picks.json` | Sleeper picks — 50% news + 50% value blend (Job 2) |
| `fantasai/analysis/breakout_candidates.json` | Breakout candidates |
| `fantasai/analysis/weekly_startsit.json` | Weekly start/sit advisor (Job 4) |
| `fantasai/analysis/nfl_transactions.json` | Transaction wire |
| `fantasai/analysis/trending_players.json` | Trending players |
| `fantasai/analysis/injury_overlay.json` | Injury overlay data |
| `fantasai/players/export_players_2026_draft.json` | Draft board (997 players) |
| `fantasai/stats/gold_weekly_stats.json` | Weekly stats |

## Worker API Routes (Selected)

| Route | Handler | Description |
|---|---|---|
| `GET /api/v1/players` | `handlePlayers` | Sleeper player pool (1h cache) |
| `GET /api/v1/r2/get` | `handleR2Proxy` | Raw R2 access (auth required) |
| `PUT /api/v1/r2/{key}` | — | R2 write (used by local pipeline) |
| `GET /api/v1/news/latest` | `handleDbNews` | Latest news from R2 |

**Auth:** `X-FantasAI-Key` header must match `env.FANTASAI_KEY` secret.

## Local AI Pipeline

Five jobs on local GPU via Ollama (Jobs 1-4 use Qwen; job_gameday has no LLM):

| Job | Model | Schedule | Purpose |
|---|---|---|---|
| `job1_news_processor.py` | Qwen3 8B | Daily 7 AM (via orchestrator) | Classify articles → `player_notes.json`, `ai_summaries.json` |
| `job2_fantasy_analyzer.py` | Qwen3 14B | After Job 1 | Score players (9 dimensions) + sleeper picks (50/50 blend) → waiver/trade/lineup |
| `job3_player_writeups.py --mode rostered` | Qwen3 14B | Nightly 2:00 AM | Narrative writeups for ~180 rostered players |
| `job3_player_writeups.py --mode all` | Qwen3 14B | Sunday 3:00 AM | Writeups for ~977 skill position players |
| `job4_weekly_startsit.py` | Qwen3 14B | Sunday 2:30 AM | Weekly start/sit advisor with hybrid scoring (0-100 score + LLM for borderline) |
| `job_gameday.py` | None | 5× per game day (see below) | Game-day injuries, inactives, team news for teams playing only |
| `pipeline_runner.py` | — | On demand | Sequencer for Jobs 1-4 |

**Game-day schedule (Central Time):**

| Window | Day/Time | Teams |
|---|---|---|
| `--window tnf` | Thursday 6:00 PM | TNF teams only |
| `--window sun_early` | Sunday 10:45 AM | 1 PM ET game teams + inactives |
| `--window sun_late` | Sunday 2:15 PM | 4:25 PM ET game teams + inactives |
| `--window snf` | Sunday 6:00 PM | SNF teams only |
| `--window mnf` | Monday 6:00 PM | MNF teams only |

## Frontend Screens

Dashboard · DraftRoom · CurrentRoster · Players · Waivers · News · Trade · WarRoom · Compare · HeadToHead · LeagueSettings · PowerRankings · LineupDecisions · OwnerIntel · Transactions · SeasonPerformance · DraftRecap · Watchlist · ScoringTest · Sources · AccountEdit · AdminOwners

## Secrets

| Secret | Location | Purpose |
|---|---|---|
| `FANTASAI_KEY` | Cloudflare Worker secret + `.env` | API auth header |
| `WWO_API_KEY` | Cloudflare Worker secret | Weather API — never hardcode |
| `API_SPORTS_KEY` | `.env` only | API-Sports.io stats — never hardcode |

---

**Contact:** kingoffrisco@yahoo.com | **API:** https://api.fantasai.net
