# FantasAI — Databricks → Local DuckDB Migration Checklist

**Migration date:** June 15, 2026  
**Last updated:** June 16, 2026  
**Status:** ✅ Migration complete. All scripts tested and running on Task Scheduler.

---

## Infrastructure

| Item | Status | Notes |
|------|--------|-------|
| DuckDB installed | ✅ Done | `pip install duckdb` |
| DuckDB schema initialized | ✅ Done | `local_processing/db.py` — 24 tables |
| `truststore` SSL fix | ✅ Done | `ssl_utils.py` — injects Windows cert store |
| `FANTASAI_KEY` in `.env` | ✅ Done | Never commit to source |
| `API_SPORTS_KEY` in `.env` | ✅ Done | Moved from hardcoded |
| Remove `REQUESTS_CA_BUNDLE` from `.env` | ✅ Done | Removed; truststore supersedes it |
| Python 3.14 numpy fix | ✅ Done | `pip install "numpy>=2.0"` for cp314 wheels |
| `PYTHONIOENCODING=utf-8` | ✅ Done | Set in terminal or Task Scheduler env |
| Databricks workspace access | ❌ Lost | All jobs/notebooks inaccessible |
| Old Unity Catalog Delta tables | ❌ Gone | Replaced by DuckDB |

---

## Data Sources

### Daily Sources (tested ✅)

| Source | Script | Status | Output | Notes |
|--------|--------|--------|--------|-------|
| Sleeper API | `ingest/ingest_sleeper_players.py` | ✅ Tested | 4,254 players, 258 news, 167 injuries, 100 trending | Runs first (populates ESPN IDs) |
| ESPN News | `ingest/ingest_espn_news.py` | ✅ Tested | 120 articles | Requires Sleeper ESPN IDs |
| Google News RSS | `ingest/ingest_google_news.py` | ✅ Tested | 48 articles (5-player test) | Falls back to bronze if gold empty |
| NFL Transactions | `ingest/ingest_nfl_transactions.py` | ✅ Tested | 27 transactions | 30-day rolling window |

### Weekly Sources

| Source | Script | Status | Output | Notes |
|--------|--------|--------|--------|-------|
| nflverse (headshots, YAC, NGS, depth charts) | `ingest/ingest_nflverse.py` | ✅ Tested | 5,597 rows 2024 stats in `silver_weekly_stats` | 2025 data returns 404 (expected — not yet released) |
| API-Sports.io stats | `ingest/ingest_apisports.py` | ✅ Tested (dry-run) | 713 records (Week 18/2024) | Key in `.env` as `API_SPORTS_KEY` |
| NFL schedules (nflverse) | `ingest/ingest_schedules.py` | ✅ Tested | 570 games (285 × 2024 + 285 × 2025); `nfl_schedule.json` + `opponent_lookup.json` live in R2 | `--seasons 2024,2025 --export-season 2025` |
| Player ownership (Sleeper) | `ingest/ingest_ownership.py` | ✅ Written | Crawls ~500 public leagues; `player_ownership.json` → R2; non-fatal in orchestrator | Run with `--target 300` for faster test |
| NFL Combine measurables | `ingest/ingest_combine.py` | ✅ Tested | 650 rows (2023-2025) in `bronze_combine_data`; `combine_data.json` live in R2 | 40-time, bench, vertical, cone, shuttle; feeds ghost picks athletic score |

### Sources Archived / Not Migrated

| Source | Reason |
|--------|--------|
| SportsData.io | API key invalid (all 4 auth methods failed); notebook archived |
| CBS Sports | ✅ N/A — roster data served by Cloudflare Worker (`/api/cbs/rosters`); `job3` calls it directly; no local ingest needed |
| NFL Draft Capital | `NFL_Draft_Capital_Ingestion.py` in notebooks; low priority (draft is over) |
| Article Labeling Feedback | `article_labeling_feedback_ingestion.py` in notebooks; superseded by Job1/Job2 AI pipeline |

---

## ETL Pipeline

| Step | Script | Status | Notes |
|------|--------|--------|-------|
| Bronze ingest — Sleeper | ✅ | See above | |
| Bronze ingest — ESPN | ✅ | See above | |
| Bronze ingest — Google News | ✅ | See above | |
| Bronze ingest — NFL Transactions | ✅ | See above | |
| Bronze ingest — nflverse | ✅ | 5,597 rows, 2024 season | |
| Silver — player news | ✅ | Built by Sleeper script | |
| Silver — injury reports | ✅ | Built by Sleeper script | |
| Silver — trending players | ✅ | Built by Sleeper script | |
| Silver — weekly stats | ✅ | 5,597 rows (2024 via nflverse) | Empty on daily runs until 2025 season starts |
| `db.py` `executescript` bug | ✅ Fixed | Split on `;` and loop | |
| Sleeper trending column order bug | ✅ Fixed | Explicit column reorder in `build_trending()` |
| Google News INTERVAL parameterization | ✅ Fixed | f-string `INTERVAL {N} DAY` | |
| Gold consolidation empty-stats fallback | ✅ Fixed | Builds from Sleeper bronze when silver empty |
| `rowcount` returns -1 cosmetic display | ✅ Fixed | count before/after INSERT in `ingest_espn_news.py`, `ingest_google_news.py`, `ingest_nfl_transactions.py` |

---

## Gold Layer

| Table | Status | Notes |
|-------|--------|-------|
| `gold_player_dim` | ✅ Populated | 4,151 unique players |
| `gold_player_id_mapping` | ✅ Populated | Cross-reference all source IDs → master |
| `gold_weekly_stats` | ✅ Populated | 5,597 rows (2024 season via nflverse) |
| Breakout candidates logic | ⚠️ Limited | Queries `gold_weekly_stats`; 2024 data loaded but 2025 data not yet on nflverse |

---

## R2 Key → Job Mapping (Full Audit — June 16, 2026)

Frontend reads R2 via `api.r2.*` in `app/src/api.js`. Every key below was found in that file.

### Produced and Working

| R2 Key | Produced By | Frontend Function | Status |
|--------|------------|------------------|--------|
| `fantasai/news/player_notes.json` | `export_to_r2.py` → overwritten by `job1` AI enrichment | `api.r2.playerNotes()` | ✅ |
| `fantasai/news/enriched_news.json` | `export_to_r2.py` | `api.r2.enrichedNews()` | ✅ |
| `fantasai/news/critical_alerts.json` | `export_to_r2.py` | `api.r2.criticalAlerts()` | ✅ |
| `fantasai/analysis/player_news.json` | `export_to_r2.py` | `api.r2.playerNewsLinks()` | ✅ |
| `fantasai/players/export_players_2026_draft.json` | `export_to_r2.py` | `api.r2.players2026()` fallback #2 | ✅ |
| `fantasai/players/injury_overlay.json` | `export_to_r2.py` | `api.r2.injuries()` | ✅ |
| `fantasai/analysis/injury_report.json` | `export_to_r2.py` | Worker-api internal | ✅ (not consumed by frontend directly) |
| `fantasai/analysis/nfl_transactions.json` | `export_to_r2.py` | Not in `api.js` | ✅ (orphaned — no frontend consumer) |
| `fantasai/analysis/trending_players.json` | `export_to_r2.py` | Not in `api.js` | ✅ (orphaned — no frontend consumer) |
| `fantasai/news/ai_summaries.json` | `job1_news_processor.py` | `api.r2.aiSummaries()` — News screen | ✅ (requires Ollama running) |
| `fantasai/analysis/player_scores.json` | `job2_fantasy_analyzer.py` | `api.r2.playerScores()` | ✅ (requires Ollama running) |
| `fantasai/analysis/waiver_wire_recommendations.json` | `job2_fantasy_analyzer.py` | `api.r2.waivers()` | ✅ (requires Ollama running) |
| `fantasai/analysis/trade_values.json` | `job2_fantasy_analyzer.py` | `api.r2.trade()` | ✅ (requires Ollama running) |
| `fantasai/analysis/lineup_recommendations.json` | `job2_fantasy_analyzer.py` | `api.r2.lineup()` | ✅ (requires Ollama running) |
| `players/player_writeups.json` | `job3_player_writeups.py` | `api.r2.playerWriteups()` | ✅ (requires Ollama running) |
| `fantasai/analysis/nfl_schedule.json` | `ingest/ingest_schedules.py` | `api.r2.nflSchedule()` | ✅ 272 REG games (2025 season) |
| `fantasai/analysis/opponent_lookup.json` | `ingest/ingest_schedules.py` | `api.r2.opponentLookup()` | ✅ 32-team week-by-week opponent map |
| `fantasai/analysis/player_ownership.json` | `ingest/ingest_ownership.py` | `api.r2.playerOwnership()` | ✅ Top-500 players by ownership % |
| `fantasai/analysis/combine_data.json` | `ingest/ingest_combine.py` | `api.r2.combineData()` | ✅ 650 combine participants (2023-2025) |
| `fantasai/analysis/performance_trends.json` | `export/export_to_r2.py` | `api.r2.trends()` | ✅ Produced (requires gold_weekly_stats data to be non-empty) |
| `fantasai/draft/ghost_picks/board.json` | `job_ghost_picks_builder.py` | Draft screen | ✅ (manual trigger, pre-draft only) |
| `fantasai/analysis/oline_index.json` | `ingest/ingest_oline_index.py` | `api.r2.olineIndex()` | ✅ Proprietary Run/Pass/Overall block score per team/season, derived from free nflverse PBP (no PFF data) |
| `fantasai/analysis/player_team_history.json` | `ingest/ingest_oline_index.py` | `api.r2.playerTeamHistory()` | ✅ Which team a player suited up for each season (handles in-season trades), from `silver_weekly_stats` |

### Produced but Not Wired / Empty

| R2 Key | Produced By | Issue |
|--------|------------|-------|
| `fantasai/analysis/breakout_candidates.json` | `export_to_r2.py` | ⚠️ Empty — `gold_weekly_stats` empty until nflverse runs |
| `fantasai/stats/gold_weekly_stats.json` | `export_to_r2.py` | ⚠️ Empty — needs nflverse run |

### Frontend Reads but NO Local Job Produces

| R2 Key | Frontend Function | What Should Produce It | Priority |
|--------|------------------|----------------------|----------|
| `predictions/defense_predictions.json` | `api.r2.defensePredictions()` | ML pipeline (future — requires LightGBM training notebooks) | 🔵 Future |
| `fantasai/analysis/waiver_claims.json` | `AICopilot.jsx` internal | User-written; AICopilot POST to `/api/v1/transactions` | 🟢 Low (user-specific) |

---

## Notebook Consolidation (June 15, 2026)

All notebooks now live in `notebooks/`. The `databricks/` directory has been cleaned up.

### What Was Moved/Archived

| File | Action | Destination |
|------|--------|-------------|
| `databricks/Notebook/.../article_labeling_feedback_ingestion.py` | ✅ Copied to notebooks/ | `notebooks/01_Ingestion/Bronze/` |
| `databricks/Notebook/.../NFL_Draft_Capital_Ingestion.py` | ✅ Copied to notebooks/ | `notebooks/01_Ingestion/Bronze/` |
| `databricks/Notebook/.../ADP_Consolidation_Gold.py` | ✅ Copied to notebooks/ | `notebooks/01_Ingestion/Gold/` |
| `databricks/Notebook/.../gold_player_mapping_corrections.py` | ✅ Copied to notebooks/ | `notebooks/01_Ingestion/Gold/` |
| `databricks/notebooks/08_weather_ingestion.py` | ✅ Copied to notebooks/ | `notebooks/01_Ingestion/Bronze/` |
| `databricks/notebooks/07_news_ingestion.py` (both versions) | ✅ Archived | `notebooks/_Archive_20260601/` |
| `databricks/r2_export.py` | ✅ Archived | `notebooks/_Archive_20260601/databricks_r2_export_SUPERSEDED.py` |
| `databricks/Notebook/` originals | ✅ Archived | `notebooks/_Archive_20260601/databricks_Notebook/` |
| `ESPN Public API - Scheduled Weekly Update.ipynb` | ✅ Archived | `notebooks/_Archive_20260601/` — duplicate of `13_espn_fantasy_ingestion.ipynb` |
| `ESPN Public API Ingestion.ipynb` | ✅ Archived | `notebooks/_Archive_20260601/SportsDataIO_NFL_Stats_Ingestion.ipynb` — mislabeled, actually SportsData.io |

### SQL File Consolidation

All SQL files are now in `sql/`. These are historical Databricks Unity Catalog DDL — the live DuckDB schema is in `local_processing/db.py`.

| # | File | Description |
|---|------|-------------|
| 01-09 | Root `sql/` (pre-existing) | Core Bronze/Silver/Gold schema for Databricks |
| 10 | `sql/10_create_injury_news_tables.sql` | Injury + news Bronze/Silver/Gold tables |
| 11 | `sql/11_create_weather_tables.sql` | Weather forecast + historical tables |
| — | `sql/create_user_settings_table.sql` | User preferences table |
| — | `sql/update_draft_ready_roster_2026_with_adp.sql` | Draft roster view with ADP |
| — | `sql/update_draft_ready_roster_2026_with_rookie_status.sql` | Rookie flags on draft roster view |

### Notebooks Directory Tree (as of June 15, 2026 rev 2)

```
notebooks/
├── _Archive_20260601/             # 53 files — all superseded/duplicate/Databricks-only
│   ├── Bronze/                    # 24 notebooks moved June 15 (numbered pipeline + named replacements)
│   ├── Gold/                      # 3 notebooks moved June 15 (ADP, consolidation, corrections)
│   ├── 05_Scheduled_Jobs/         # 5 orchestrator notebooks moved June 15
│   ├── 06_Exports/                # 2 export notebooks moved June 15
│   ├── databricks_Notebook/       # 4 py files from original databricks/ directory
│   └── databricks_sql/            # 5 SQL DDL files from original databricks/sql/
├── 01_Ingestion/
│   ├── Bronze/                    # 13 files — future port candidates + ML reference
│   └── (Gold/ empty — all 3 files archived)
├── 02_Analysis_Metrics/           # 4 files — analysis, not runnable locally
├── 03_ML_Training/                # 4 files — LightGBM pipeline (future local ML)
├── 03_Predictions/                # 3 files — breakout prediction engine
├── 04_ML_Registration/            # 3 files — MLflow registration
├── 05_Scheduled_Jobs/             # 1 file — ML Training Orchestrator (Databricks ref only)
└── 06_Exports/                    # 2 files — breakout predictions + chat API deployment
```

### Active Notebooks (30 remaining — all Databricks reference only)

**Group 2 — Keep as ML/Analysis Reference (not portable):**

| Notebook | Purpose |
|---|---|
| `02_Analysis_Metrics/` (4) | Data source coverage analysis, player performance metrics |
| `03_ML_Training/` (4) | LightGBM QB/RB/WR/TE training pipeline |
| `03_Predictions/` (3) | Breakout prediction engine |
| `04_ML_Registration/` (3) | MLflow model registration, vector search, chat API |
| `05_Scheduled_Jobs/00_ML_Training_Master_Orchestrator.ipynb` | ML training orchestration |
| `06_Exports/Export Breakout Predictions to R2.ipynb` | Predictions export schema |
| `06_Exports/fantasai_chat_api_deployment.ipynb` | Chat API deployment |
| `Bronze/00_api_test.ipynb` | Worker API endpoint test suite |
| `Bronze/10_stats_ingestion.ipynb` | Stats via Cloudflare Worker |
| `Bronze/11_fantasydata_ingestion.ipynb` | FantasyData.com alternative |
| `Bronze/11_projections_ingestion.ipynb` | Sleeper weekly projections |
| `Bronze/13_espn_fantasy_ingestion.ipynb` | ESPN Public API game scores |
| `Bronze/14_nflverse_ingestion.ipynb` | 10-year nflverse stats history |
| `Bronze/Player News Sources - API Evaluation.ipynb` | API comparison |

**Group 3 — Future Port Candidates (unique data not yet in local pipeline):**

| Notebook | What's Unique | Priority |
|---|---|---|
| `Bronze/17_nflverse_schedules_ingestion.ipynb` | NFL game schedules (venue, home/away, scores) | ✅ Ported → `ingest/ingest_schedules.py` |
| `Bronze/Sleeper Ownership - Public Leagues.ipynb` | Player ownership % from 1,000 public leagues | ✅ Ported → `ingest/ingest_ownership.py` |
| `Bronze/15_fantasy_data_pros_ingestion.ipynb` | 22 seasons historical stats (1999-2020) | 🟢 Low |
| `Bronze/19_injury_ingestion_historical.ipynb` | Historical injuries 2016-2026 (nflverse) | 🟢 Low |
| `01_Ingestion/NFL_Draft_Capital_Ingestion.py` | 2026 NFL Draft capital values | 🟢 Low |
| `01_Ingestion/Defense Rankings Ingestion - FantasyPros.ipynb` | DST expert rankings (may be covered by ingest_adp.py) | 🟢 Low |

### All Notebooks Archived (superseded by `local_processing/`)

39 notebooks moved to `_Archive_20260601/` on June 15, 2026. Full replacement mapping:

| Archived Notebook | Replaced By |
|---|---|
| `Player_News_Ingestion_Sleeper_API.ipynb` | `ingest/ingest_sleeper_players.py` |
| `ESPN News API Ingestion.ipynb` | `ingest/ingest_espn_news.py` |
| `Google News RSS Ingestion.ipynb` | `ingest/ingest_google_news.py` |
| `NFL Transactions Ingestion.ipynb` | `ingest/ingest_nfl_transactions.py` |
| `Import nflverse Player Data.ipynb` | `ingest/ingest_nflverse.py` |
| `API-Sports.io NFL Ingestion.ipynb` | `ingest/ingest_apisports.py` |
| `08_weather_ingestion.py` (both copies) | `ingest/ingest_weather.py` |
| `ADP_Consolidation_Gold.py` (both copies) | `ingest/ingest_adp.py` |
| `Gold Layer - Player Consolidation.ipynb` | `gold/gold_player_consolidation.py` |
| `Export Fantasy News to R2.ipynb` | `export/export_to_r2.py` |
| `r2_export.py` (Databricks version) | `export/export_to_r2.py` |
| `R2 Export - Analysis Data.ipynb` | `export/export_to_r2.py` |
| `00_News_Ingestion_Master_Orchestrator.ipynb` | `orchestrator_daily.py` |
| `Sleeper API - Scheduled Weekly Update.ipynb` | `orchestrator_weekly.py` |
| `nflverse - Scheduled Weekly Update.ipynb` | `orchestrator_weekly.py` |
| `API-Sports.io - Scheduled Daily Update.ipynb` | `orchestrator_daily.py` |
| `01-08_*.py` (numbered Spark pipeline) | All replaced by ingest_*.py scripts |
| `15_sleeper_api_ingestion.ipynb` | `ingest_sleeper_players.py` |
| `16_api_football_rapidapi_ingestion.ipynb` | `ingest_apisports.py` |
| `17_thesportsdb_ingestion.ipynb` | `ingest_nflverse.py` (better schedule data) |
| `18_weatherapi_com_ingestion.ipynb` | `ingest_weather.py` (chose WWO) |
| `19_openweathermap_ingestion.ipynb` | `ingest_weather.py` (chose WWO) |
| `20_worldweatheronline_ingestion.ipynb` | `ingest_weather.py` |
| `gold_player_mapping_corrections.py` | `gold/gold_player_consolidation.py` |
| `article_labeling_feedback_ingestion.py` | Superseded by Job1/Job2 AI pipeline |

---

## Task Scheduler

| Task | Schedule | Status | Registration Command |
|------|----------|--------|---------------------|
| `FantasAI - Daily News Orchestrator` | Daily 7:00 AM | ✅ Registered | `\FantasAI\` task path, RunLevel Highest |
| `FantasAI - Weekly Stats Orchestrator` | Tue 3:00 AM | ✅ Registered | `\FantasAI\` task path, RunLevel Highest |

**Registration (run once in elevated PowerShell):**
```powershell
# Daily orchestrator
$action  = New-ScheduledTaskAction -Execute "C:\Python314\python.exe" `
             -Argument "D:\Project\Fantasy\local_processing\orchestrator_daily.py" `
             -WorkingDirectory "D:\Project\Fantasy\local_processing"
$trigger = New-ScheduledTaskTrigger -Daily -At "07:00AM"
$settings= New-ScheduledTaskSettingsSet -ExecutionTimeLimit (New-TimeSpan -Hours 2) `
             -StartWhenAvailable -DontStopOnIdleEnd
Register-ScheduledTask -TaskName "FantasAI - Daily News Orchestrator" `
  -TaskPath "\FantasAI\" -Action $action -Trigger $trigger `
  -Settings $settings -RunLevel Highest -Force
```

---

## AI Pipeline (Local Qwen)

| Job | Script | Model | Trigger | Status |
|-----|--------|-------|---------|--------|
| Job 1 — Bulk news processing | `job1_news_processor.py` | Qwen 8B | Daily (after ingest) | ✅ Wired in orchestrator |
| Job 2 — Fantasy scoring | `job2_fantasy_analyzer.py` | Qwen 14B | Daily (after job1) | ✅ Wired in orchestrator |
| Job 3 — Player writeups | `job3_player_writeups.py` | Qwen 14B | Nightly 2AM (rostered) + Sunday 3AM (all) | ✅ Wired in orchestrator; exports `players/player_writeups.json` |
| Ghost picks builder | `job_ghost_picks_builder.py` | Qwen 14B | Manual pre-draft (April) | ✅ Manual trigger only — not a recurring schedule |

---

## Frontend Compatibility

| Frontend Feature | Backend Status | Notes |
|-----------------|---------------|-------|
| News feed (`/news`) | ✅ | `player_news.json` + `enriched_news.json` updating |
| Injury report | ✅ | `injury_report.json` + `critical_alerts.json` |
| Player roster (`/roster`) | ✅ | `export_players_2026_draft.json` |
| Injury overlay (per-player) | ✅ | `injury_overlay.json` |
| Trending players | ✅ | `trending_players.json` |
| Weekly stats / scoring | ⚠️ Empty | `gold_weekly_stats.json` — needs nflverse run |
| Breakout candidates | ⚠️ Empty | `breakout_candidates.json` — needs nflverse run |
| Player writeups / AI notes | ✅ | `player_writeups.json` — nightly rostered + weekly all-player via Job 3 |

---

## Remaining Work (Priority Order)

### ✅ Completed (June 15, 2026)
- nflverse tested — 5,597 rows of 2024 stats in `silver_weekly_stats`; `gold_weekly_stats` rebuilt
- Task Scheduler registered — both orchestrators in `\FantasAI\`, RunLevel Highest
- `players_2026_draft.json` alias added to `export_to_r2.py`
- `analysis/sleeper_picks.json` alias added (mirrors `trending_players.json`)
- `gold_player_consolidation.py` fixed — `INSERT BY NAME` prevents column order mismatch
- `ingest_nflverse.py` fixed — SSL fix + college column guard

### ✅ Completed (June 16, 2026 continued)
- `drop_candidates.json` added to job2 (5th output, derived from sit_score + injury_risk)
- Weather ingestion ported → `local_processing/ingest/ingest_weather.py`; 164 rows in DuckDB, `weather_forecast.json` live in R2 (22 outdoor + 10 domes)
- Weather tables (`weather_forecasts`, `weather_historical`) added to DuckDB schema in `db.py`
- `WWO_API_KEY` added to `.env`; `REQUESTS_CA_BUNDLE` stale line removed
- Job3 wired into `orchestrator_daily.py` as Task 4 (non-fatal, after R2 export, requires Ollama)
- `--skip-ai` flag added to orchestrator for runs without Ollama
- ADP Consolidation ported → `local_processing/ingest/ingest_adp.py`; 852 rows (413 PPR + 407 Standard + 32 DST); 4 R2 keys live (`players/adp_ppr.json`, `players/adp_standard.json`, `analysis/gold_adp_defense.json`, `fantasai/analysis/gold_adp_defense.json`)
- `players_2026_draft.json` + `analysis/sleeper_picks.json` aliases added to `export_to_r2.py`
- Pip cache redirected to D:\pip-cache (freed 8 GB from C:; C: now at ~24 GB free)
- DST performance ported → `local_processing/ingest/ingest_dst_performance.py`; 544 rows (18 weeks × 32 teams) in `bronze_dst_weekly_stats`; `analysis/defense_performance.json` + `fantasai/analysis/defense_performance.json` live in R2
- ADP + DST performance wired into `orchestrator_weekly.py` (Phase 1 stats ingestion)
- NFL schedules ported → `local_processing/ingest/ingest_schedules.py`; 570 games (2024+2025) in `bronze_nfl_schedules`; `nfl_schedule.json` (272 REG 2025 games, 59.9 KB) + `opponent_lookup.json` (74.8 KB) live in R2
- Player ownership ported → `local_processing/ingest/ingest_ownership.py`; Sleeper public league crawl → `player_ownership.json` in R2 (non-fatal in orchestrator)
- Both scripts wired into `orchestrator_weekly.py` Phase 1
- R2 keys added to `app/src/api.js` (`nflSchedule`, `opponentLookup`, `playerOwnership`) and hooks exported from `app/src/hooks.js` (`useR2NflSchedule`, `useR2OpponentLookup`, `useR2PlayerOwnership`)
- `17_nflverse_schedules_ingestion.ipynb` + `Sleeper Ownership - Public Leagues.ipynb` marked ✅ Ported in ARCHITECTURE.md

### ✅ Completed (June 16, 2026)
- Fixed `-1` rowcount display in `ingest_espn_news.py`, `ingest_google_news.py`, `ingest_nfl_transactions.py` (count before/after INSERT)
- NFL Combine data ported → `ingest/ingest_combine.py`; 650 rows (2023-2025); `combine_data.json` live in R2; wired into `orchestrator_weekly.py`; `api.r2.combineData()` + `useR2CombineData` added
- `performance_trends.json` added to `export/export_to_r2.py` (last-4-weeks vs season avg; gracefully skips when gold_weekly_stats empty)
- Ownership seed list expanded: 44 → ~430 seeds (first names, last names, NFL team handles, numbered variants 1–10)
- `ingest_google_news.py` player selection rewritten: ADP-ranked priority order with 4 tiers (ADP top-200 with no news, rookies with no news, ADP top-200 refresh, remaining rookies); cap raised 200 → 300; `--top-n` flag added
- CBS ingestion confirmed N/A — Worker handles it; ghost picks confirmed manual pre-draft only

### 🟡 Medium Priority (Remaining)
_All medium items complete._

### 🟢 Low Priority / Cleanup
10. ✅ **Remove `REQUESTS_CA_BUNDLE`** from `.env` — already done (truststore supersedes it)
11. ✅ **Fix `-1` rowcount display** — fixed in `ingest_espn_news.py`, `ingest_google_news.py`, `ingest_nfl_transactions.py` (count before/after instead of `.rowcount`)
12. ✅ **CBS ingestion** — not needed; CBS roster data flows through Cloudflare Worker (`/api/cbs/rosters`); `job3_player_writeups.py` calls it directly
13. ✅ **Ghost picks builder** — pre-draft only, not a recurring schedule; run manually with `python job_ghost_picks_builder.py` before each NFL Draft (April)
14. **ML pipeline** — `predictions/defense_predictions.json` requires ML training notebooks; future work
15. ✅ **NFL Combine data** — `ingest/ingest_combine.py`; 650 rows (2023-2025); `combine_data.json` live in R2; wired into `orchestrator_weekly.py`
16. ✅ **`performance_trends.json`** — added to `export/export_to_r2.py` (skips gracefully when `gold_weekly_stats` is empty; will auto-populate after 2025 season data lands)

---

## Notes for Fresh Machine Setup

```bash
cd D:\Project\Fantasy\local_processing

# Python 3.14 required for numpy 2.x wheels
pip install duckdb pandas requests feedparser python-dotenv truststore
pip install "numpy>=2.0"      # must precede nfl_data_py
pip install nfl_data_py

# Set env before running (avoids Windows cp1252 emoji errors)
$env:PYTHONIOENCODING = "utf-8"

# Bootstrap order (first run)
python ingest\ingest_sleeper_players.py
python ingest\ingest_espn_news.py
python ingest\ingest_google_news.py
python ingest\ingest_nfl_transactions.py
python ingest\ingest_nflverse.py       # weekly only; populates silver_weekly_stats
python gold\gold_player_consolidation.py
python export\export_to_r2.py
```
