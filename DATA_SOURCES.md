# FantasAI Data Sources Reference

**Last Updated:** August 27, 2026
**Purpose:** Reference for all data sources feeding the local FantasAI pipeline

> This replaces the June 2, 2026 version, which described a Databricks/Unity Catalog setup (`main.fantasai.*` tables, ingestion notebooks under `/Repos/...`). Databricks was decommissioned on 2026-06-15. All ingestion now runs locally against DuckDB — see [ARCHITECTURE.md](ARCHITECTURE.md) for the canonical pipeline reference and [docs/API_ENDPOINTS.md](docs/API_ENDPOINTS.md) for how this data reaches the frontend.

---

## Data Flow

```
nflverse / Sleeper / CBS Sports / CFBD / ESPN & Google News / API-Sports / WWO weather
        │
        ▼
local_processing/ingest/*.py  →  DuckDB (Bronze → Silver → Gold)
        │
        ▼
Local Qwen pipeline (Jobs 1–5, via Ollama) enriches Gold data
        │
        ▼
export_to_r2.py + direct R2 writes from jobs/ingest scripts
        │
        ▼
Cloudflare R2  →  worker-api (api.fantasai.net)  →  React frontend
```

The frontend never queries DuckDB or any external API directly (aside from a couple of live-only ESPN routes called straight from the Worker, and CBS calls proxied through `worker/`). Everything else is R2-backed.

---

## Primary Sources

### nflverse (GitHub Parquet releases)

Play-by-play and weekly stats, EPA, air yards, YAC, PACR/RACR/WOPR, snap counts, NextGen Stats, depth charts, headshots. Ingested via `local_processing/ingest/ingest_nflverse.py` (`nfl_data_py`) plus several supplemental scripts (`ingest_depth_chart_history.py`, `ingest_rush_box_splits.py`, `ingest_coverage_matchups.py`). No API key required; no meaningful rate limit, but new-season data can lag until nflverse publishes it.

### Sleeper API

Player pool, weekly stats/projections, ADP. Ingested via `ingest_sleeper_players.py` and `ingest_sleeper_stats.py`. Also read live (not through DuckDB) by `worker-api`'s `/api/v1/players` for the full player pool.

**Rate limit:** ~1,000 calls/day — batch, don't poll ad hoc.

### CBS Sports (scraped)

League, roster, and draft-results pages, scraped through the cookie-authenticated Cloudflare Worker in `worker/` (`fantasai-cbs.fantasai.workers.dev`). The local pipeline calls this proxy rather than hitting CBS directly, since CBS requires an authenticated session cookie.

### CFBD (College Football Data)

College stats, recruiting, and draft-pick data for rookie projections. Free tier. Ingested via `local_processing/ingest_cfbd.py` / `ingest/ingest_cfbd.py`, feeding `ingest_rookie_scores.py` and the rookie-scoring analysis. See `reference_cfbd_api` project notes for endpoint details.

### News (ESPN + Google News)

`ingest_espn_news.py` and `ingest_google_news.py` pull raw articles; `job1_news_processor.py` (Qwen3 8B, local Ollama) classifies them for relevance/sentiment/injury signal before export.

### API-Sports.io

Backup game-level stats source, limited/experimental coverage. `ingest_apisports.py`. Requires `API_SPORTS_KEY`.

### WorldWeatherOnline (WWO)

Game-day weather forecasts for all 32 teams (dome teams skipped). `ingest_weather.py` / `POST /api/v1/weather/refresh`. Requires `WWO_API_KEY` — stored as a Cloudflare Worker secret, never hardcoded.

### DraftKings / Kalshi

DFS slates/salaries and prediction-market data for the newer DFS Optimizer and Kalshi screens. `ingest_draftkings.py`, `ingest_kalshi.py`. See `docs/BETTING_DATA_SOURCES.md` for cost/provider notes.

---

## Local Data Warehouse

`local_processing/db/fantasai.duckdb` — 49 tables across Bronze (raw ingestion), Silver (cleaned), Gold (consolidated, `master_player_id`-joined), plus supplemental groups for nflverse extras, O-Line Index, O-Line Stability, Coverage/Rush Box Matchups, and Offensive Ecosystem. Schema defined in `local_processing/db.py`. There is no catalog/schema hierarchy like Unity Catalog — it's a single local `.duckdb` file.

```bash
# Inspect the schema
python -c "import duckdb; c=duckdb.connect('local_processing/db/fantasai.duckdb'); print(c.execute('SHOW TABLES').fetchall())"
```

## R2 Exports

Gold-layer and job outputs are written to Cloudflare R2 as JSON, either via `local_processing/export/export_to_r2.py` (bulk) or directly from individual ingest/job scripts (`PUT api.fantasai.net/api/v1/r2/{key}`). ~30+ distinct keys exist under the `fantasai/` prefix. Full key list: [docs/DATA_SCHEMAS.md](docs/DATA_SCHEMAS.md).

## Narrow AWS S3 Usage

A small `s3Fetch` helper (not the primary store, not Databricks-related) is used only for: owners-config, rosters, community, league-settings, and schedule data. Everything else — player data, news, analysis, live scoring — goes through R2.

---

## Known Limitations

- **nflverse lag:** new-season weekly data can be unavailable for the first few weeks until nflverse publishes it; the ingest job exits gracefully rather than failing.
- **Sleeper rate limit:** 1,000 calls/day hard limit — the pipeline batches once daily rather than polling.
- **CBS scraping is fragile:** depends on a manually refreshed session cookie (see `worker/` — Sources page has a "Get Cookie" flow) and on CBS's page structure not changing.
- **NextGen Stats coverage:** limited to featured/high-usage players; left-join and handle nulls, don't assume every player has a row.

---

## Adding a New Data Source

1. Write an ingest script under `local_processing/ingest/`.
2. Add/extend the corresponding table(s) in `local_processing/db.py`.
3. Document the table in `app/schemas/` (see [app/schemas/README.md](app/schemas/README.md) — this is still project law).
4. Export to R2 (either add a key to `export_to_r2.py` or write directly from the job).
5. Update [ARCHITECTURE.md](ARCHITECTURE.md) and [docs/DATA_SCHEMAS.md](docs/DATA_SCHEMAS.md) so they stay the source of truth.

---

**For complete system architecture, see:** [ARCHITECTURE.md](ARCHITECTURE.md)
**For job schedules, see:** ARCHITECTURE.md → Job Schedules
