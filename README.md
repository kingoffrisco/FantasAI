# FantasAI

AI-powered fantasy football platform. React frontend, Cloudflare Worker API, local DuckDB pipeline, local GPU inference.

**Last Updated:** August 27, 2026 | **Data Warehouse:** `local_processing/db/fantasai.duckdb` (49 tables)

> **Migration (June 15, 2026):** Databricks infrastructure decommissioned. ETL now runs entirely on the local RTX 4080 server using DuckDB. R2 exports and the frontend are unchanged. A handful of `worker-api` routes (`/api/v1/db/players`, `/api/v1/db/tables`, `/api/v1/news/ai-summaries`, `/api/v1/opportunity/rankings`) still issue last-resort fallback queries against the old Databricks SQL Warehouse behind an R2 primary — status unconfirmed, see [docs/API_ENDPOINTS.md](docs/API_ENDPOINTS.md). Every other route is R2/local-pipeline-backed.

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
    local_processing/orchestrator_weekly_reasoning.py — Wed 1:30 AM
        │
        ▼  export_to_r2.py  →  PUT api.fantasai.net/api/v1/r2/{key}
        │
        ▼
  Cloudflare R2 (gzipped JSON)    ◄── Local Qwen GPU Pipeline
        │                              job1_news_processor.py  (Qwen 8B)
        ▼                              job2_fantasy_analyzer.py (Qwen 14B)
                                       job3_player_writeups.py  (Qwen 14B)
                                       job4_weekly_startsit.py  (Qwen 14B)
                 job5_deep_reasoner.py   (Qwen 30B)
                                       job_gameday.py           (no LLM — game-day only)
  Cloudflare Worker  api.fantasai.net
        │
        ▼
  React Frontend  (Cloudflare Pages)
```

## Stack

| Layer | Tech | Details |
|---|---|---|
| **Frontend** | React + Vite | `app/src/` — 29 screens, deployed to Cloudflare Pages |
| **Worker API** | Cloudflare Worker | `worker-api/src/index.js` at `api.fantasai.net` |
| **CBS Worker** | Cloudflare Worker | `worker/` — cookie-authenticated CBS Sports scrape proxy, `fantasai-cbs.fantasai.workers.dev` |
| **Storage** | Cloudflare R2 | Primary data store; Worker binds as `env.BUCKET` |
| **Data Warehouse** | DuckDB | `local_processing/db/fantasai.duckdb` — 49 tables, Bronze/Silver/Gold |
| **ETL Scheduler** | Windows Task Scheduler | 14 tasks: daily news, weekly stats, weekly deep reasoning, Job 3 × 2, live scores auto-poll, pipeline runner, chat server, 5 game-day windows, one-off catchup |
| **Local AI** | Qwen3 8B + 14B + 30B via Ollama | `local_processing/` — GPU pipeline on RTX 4080 |

## Key Directories

```
app/                    React + Vite frontend
  src/
    screens/            26 UI screens
    components/         Shared components
    hooks.js            R2 data hooks
    lib/                Stores, API client, data helpers (incl. liveScoring.js)
worker-api/             Primary Cloudflare Worker — api.fantasai.net
  src/index.js          All API routes
worker/                 CBS Worker — fantasai-cbs.fantasai.workers.dev (cookie-authenticated CBS Sports scrape proxy)
local_processing/       Local ETL + AI pipeline (no Databricks anywhere in this tree)
  db.py                       DuckDB connection + schema (49 tables, Bronze/Silver/Gold + supplements)
  db/fantasai.duckdb          Data warehouse file
  orchestrator_daily.py       Daily pipeline (7AM)
  orchestrator_weekly.py      Weekly pipeline (Tue 3AM)
  orchestrator_weekly_reasoning.py  Weekly deep reasoning (Wed 1:30AM)
  ingest/                 ~25 ingest scripts: nflverse, Sleeper, CBS (via worker/ proxy), CFBD (rookies),
                          ESPN/Google News, API-Sports, weather, DraftKings, Kalshi, and more
  gold/
    gold_player_consolidation.py  master_player_id + gold tables
  export/
    export_to_r2.py             Uploads JSON keys to R2 (~30+ distinct keys across all export/job scripts)
  job1_news_processor.py      Bulk news (Qwen3 8B)
  job2_fantasy_analyzer.py    Fantasy analysis (Qwen3 14B) + sleeper picks
  job3_player_writeups.py     Player writeups (Qwen3 14B / 8B)
  job4_weekly_startsit.py     Weekly start/sit advisor (Qwen3 14B)
  job5_deep_reasoner.py       Deep fantasy reasoning (Qwen3 30B) — weekly overnight
  job_gameday.py              Game-day injuries/inactives/news (no LLM)
  job_live_scores.py          Local live-scoring poller (R2-backed, replaces direct ESPN calls from the Worker)
  chat_server.py               Local FastAPI chat backend (port 8000), first hop for worker-api's /api/v1/chat
  pipeline_runner.py          Sequencer for Jobs 1-4
  requirements-local.txt      pip dependencies
_Archive_20260601/databricks/  Archived — old Databricks SQL/notebooks, not live
docs/                   Documentation
```

## Local Pipeline Setup

```bash
# Install dependencies
pip install -r local_processing/requirements-local.txt

# Install Ollama and pull the models the jobs use
ollama pull qwen3:8b
ollama pull qwen3:14b
ollama pull qwen3:30b

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

1. `orchestrator_daily.py` / `orchestrator_weekly.py` ingest nflverse, Sleeper, CBS (via `worker/` proxy), CFBD, news, etc. into DuckDB Bronze/Silver/Gold
2. `export_to_r2.py` (plus several job/ingest scripts directly) upload JSON snapshots to R2 via Worker API (`PUT api.fantasai.net/api/v1/r2/{key}`)
3. Worker API reads R2 via `env.BUCKET` and serves to frontend; `/api/v1/db/players` remains as a narrow last-resort fallback only, not the primary read path
4. Frontend hooks (`useR2Analysis`, etc.) consume via `api.fantasai.net`

Local Qwen pipeline (via a locally-hosted Ollama server) reads enriched news from R2, scores players, writes results back to R2. There is no "gold layer" ingestion into Databricks — that step was deleted in the 2026-06-15 migration.

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
| `fantasai/analysis/deep_reasoning.json` | 30B deep reasoning outputs (Job 5) |
| `fantasai/analysis/nfl_transactions.json` | Transaction wire |
| `fantasai/analysis/trending_players.json` | Trending players |
| `fantasai/analysis/injury_overlay.json` | Injury overlay data |
| `fantasai/players/export_players_2026_draft.json` | Draft board (997 players) |
| `fantasai/stats/gold_weekly_stats.json` | Weekly stats |

## Worker API Routes (Selected)

Full list in [docs/API_ENDPOINTS.md](docs/API_ENDPOINTS.md). Selected highlights:

| Route | Description |
|---|---|
| `GET /api/v1/players` | Sleeper player pool (1h edge cache) |
| `GET/PUT/DELETE /api/v1/r2/{key}` | Raw R2 passthrough — how most exports are read/written |
| `GET /api/v1/news/articles` | Player news, R2-backed (recommended over the legacy `/api/v1/news/ai-summaries`) |
| `GET /api/v1/db/players` | Last-resort fallback player list — still Databricks-backed, behind the R2 draft board |
| `GET/POST /api/v1/owners/config`, `POST /api/v1/owners/verify` | Owner map + password login, R2-backed |
| `GET/POST /api/v1/draft/archive`, `POST /api/v1/draft/remote` | Draft archive + remote/mock draft sync |
| `GET/POST /api/v1/draft/picks` | Live draft picks array |
| `GET /api/v1/draft/ghost-board`, `POST /api/v1/draft/ghost-pick` | AI Ghost Picks mock-draft engine |
| `POST /api/v1/chat` | Chat — local Qwen first, OpenAI/Anthropic fallback (not Databricks) |
| `GET/POST /api/v1/labels/article`, `GET /api/v1/feedback/scores`, `POST /api/v1/feedback/vote` | Human-in-the-loop article labeling/feedback |

**Auth:** `X-FantasAI-Key` header must match `env.FANTASAI_KEY` secret on gated routes; most POST routes have no auth check at all.

## Local AI Pipeline

Five jobs on local GPU via Ollama (Jobs 1-4 use Qwen; job_gameday has no LLM):

| Job | Model | Schedule | Purpose |
|---|---|---|---|
| `job1_news_processor.py` | Qwen3 8B | Daily 7 AM (via orchestrator) | Classify articles → `player_notes.json`, `ai_summaries.json` |
| `job2_fantasy_analyzer.py` | Qwen3 14B | After Job 1 | Score players (9 dimensions) + sleeper picks (50/50 blend) → waiver/trade/lineup |
| `job3_player_writeups.py --mode rostered` | Qwen3 14B | Nightly 2:00 AM | Narrative writeups for ~180 rostered players |
| `job3_player_writeups.py --mode all` | Qwen3 14B | Sunday 3:00 AM | Writeups for ~977 skill position players |
| `job4_weekly_startsit.py` | Qwen3 14B | Sunday 2:30 AM | Weekly start/sit advisor with hybrid scoring (0-100 score + LLM for borderline) |
| `job5_deep_reasoner.py` | Qwen3 30B | Wednesday 1:30 AM | Deep reasoning on top fantasy candidates with separate overnight lane |
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

Dashboard · DraftRoom · CurrentRoster · Players · Waivers · News · Trade · WarRoom · Compare · HeadToHead · LeagueSettings · PowerRankings · LineupDecisions · OwnerIntel · Transactions · SeasonPerformance · DraftRecap · Watchlist · ScoringTest · Sources · AccountEdit · AdminOwners · AdminLeagues · Login · LoginLog · ChangePassword · PreviousDrafts · Kalshi · DfsOptimizer

See [app/BACKEND_TO_FRONTEND.md](app/BACKEND_TO_FRONTEND.md) for the full screen-to-endpoint mapping.

## Secrets

| Secret | Location | Purpose |
|---|---|---|
| `FANTASAI_KEY` | Cloudflare Worker secret + `.env` | `X-FantasAI-Key` auth header, gates a subset of routes |
| `WWO_API_KEY` | Cloudflare Worker secret | WorldWeatherOnline forecast API — never hardcode |
| `RESEND_API_KEY` | Cloudflare Worker secret | Password-reset emails |
| `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` | Cloudflare Worker secret | Chat fallback tiers behind local Qwen |
| `LOCAL_CHAT_URL` | Cloudflare Worker secret | Points the Worker at `chat_server.py` on the local machine |
| `API_SPORTS_KEY` | `local_processing/.env` only | API-Sports.io stats — never hardcode |

---

**Contact:** kingoffrisco@yahoo.com | **API:** https://api.fantasai.net
