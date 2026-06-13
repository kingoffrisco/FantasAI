# FantasAI

AI-powered fantasy football platform. Full production app — React frontend, Cloudflare Worker API, Databricks Delta Lake, local GPU inference pipeline.

**Last Updated:** June 13, 2026 | **Unity Catalog:** `main.fantasai` (79 tables)

---

## Architecture

```
Sleeper / ESPN / CBS / WWO APIs
        │
        ▼
Databricks (main.fantasai.*)     ◄── Local Qwen GPU Pipeline
  Bronze → Silver → Gold → Export
        │
        ▼
  r2_export job (daily 08:00 UTC)
        │
        ▼
  Cloudflare R2 (gzipped JSON)
        │
        ▼
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
| **Data Warehouse** | Databricks Unity Catalog | `main.fantasai` on AWS, Serverless Spark |
| **ETL** | AWS S3 + GitHub Actions | `aws-kingoffrisco-s3-bucket`, runs via `.github/workflows/` |
| **Local AI** | Qwen3 8B + 14B via Ollama | `local_processing/` — GPU pipeline on local machine |

## Key Directories

```
app/                    React + Vite frontend
  src/
    screens/            22 UI screens
    components/         Shared components
    hooks.js            R2 data hooks
    lib/                Stores, API client, data helpers
worker-api/             Primary Cloudflare Worker
  src/index.js          All API routes (~1800 lines)
worker/                 Ghost Cloudflare Worker
local_processing/       Local Qwen AI pipeline
  job1_news_processor.py      Bulk news (Qwen3 8B)
  job2_fantasy_analyzer.py    Fantasy analysis (Qwen3 14B)
  pipeline_runner.py          Orchestrator
  pipeline_watcher.py         R2 trigger watcher
databricks/             Notebook + SQL backups
docs/                   Documentation
```

## Data Flow

The frontend **never queries Databricks directly**. All data goes through R2:

1. Databricks notebooks ingest raw data (Bronze)
2. Silver/Gold layers clean and enrich
3. `r2_export.py` jobs write gzipped JSON snapshots to R2 (daily 08:00 UTC)
4. Worker API reads R2 via `env.BUCKET` and serves to frontend
5. Frontend hooks (`useR2Analysis`, etc.) consume via `api.fantasai.net`

Local Qwen pipeline classifies and scores articles, writes enrichments back to R2, then ingests to Databricks Gold tables.

## Export Tables (Frontend Data Sources)

| Table | Records | Purpose |
|---|---|---|
| `export_players_2026_draft` | 997 | Draft board — all active 2026 players (all draftable) |
| `export_player_news` | ~86 articles | AI-enriched news with fantasy insights |
| `export_defense_performance` | 606 | Weekly matchup rankings |
| `export_breakout_candidates` | ~7 | ML-powered sleeper picks |
| `export_sleeper_picks` | ~24 | High-value waiver targets |

## Worker API Routes (Selected)

| Route | Handler | Description |
|---|---|---|
| `GET /api/v1/players` | `handlePlayers` | Sleeper player pool (1h cache) |
| `GET /api/v1/db/players` | `handleDbPlayers` | Databricks `export_players_2026_draft` direct |
| `GET /api/v1/news/latest` | `handleDbNews` | Latest news from Databricks Gold |
| `GET /api/v1/r2/get` | `handleR2Proxy` | Raw R2 access (auth required) |

**Auth:** `X-FantasAI-Key` header must match `env.FANTASAI_KEY` secret.

## Local AI Pipeline

Two Qwen jobs running on local GPU via Ollama — both incremental by default:

| Job | Model | Purpose |
|---|---|---|
| `job1_news_processor.py` | Qwen3 8B | Classify articles → `player_notes.json`, `ai_summaries.json` |
| `job2_fantasy_analyzer.py` | Qwen3 14B | Score players (9 dimensions) → waiver/trade/lineup outputs |
| `pipeline_runner.py` | Both | Orchestrator — `python pipeline_runner.py` |

Scheduled daily via Windows Task Scheduler at **7:15 AM UTC** (2-3 min buffer after Databricks R2 export at ~7:12 UTC).

## Databricks Jobs

| Job | ID | Schedule |
|---|---|---|
| News Export | [533461232082366](https://dbc-60fb4a1c-8bce.cloud.databricks.com/jobs/533461232082366) | Daily 08:00 UTC |
| Analysis Export | [848536035023585](https://dbc-60fb4a1c-8bce.cloud.databricks.com/jobs/848536035023585) | Daily 08:30 UTC |
| ML Training Orchestrator | [763487314454311](https://dbc-60fb4a1c-8bce.cloud.databricks.com/jobs/763487314454311) | Weekly |

## Frontend Screens

Dashboard · DraftRoom · CurrentRoster · Players · Waivers · News · Trade · WarRoom · Compare · HeadToHead · LeagueSettings · PowerRankings · LineupDecisions · OwnerIntel · Transactions · SeasonPerformance · DraftRecap · Watchlist · ScoringTest · Sources · AccountEdit · AdminOwners

## Secrets

| Secret | Location | Purpose |
|---|---|---|
| `FANTASAI_KEY` | Cloudflare Worker secret | API auth header |
| `WWO_API_KEY` | Cloudflare Worker secret + Databricks secret `fantasai/wwo_api_key` | Weather API — never hardcode |
| `DATABRICKS_TOKEN` | Cloudflare Worker secret | Direct Databricks queries |

---

**Contact:** kingoffrisco@yahoo.com | **Workspace:** https://dbc-60fb4a1c-8bce.cloud.databricks.com | **API:** https://api.fantasai.net
