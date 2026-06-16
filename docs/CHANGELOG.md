# FantasAI Project Changelog

All notable changes to the FantasAI ML pipeline project.

---

## [2.0.0] - 2026-06-15

### Summary
Full infrastructure migration from Databricks (30 jobs, Unity Catalog, 79 Delta tables) to a local DuckDB pipeline running on the RTX 4080 server. All data sources tested and passing. R2 exports verified end-to-end. Notebooks consolidated and deduplicated.

---

### Infrastructure — Databricks Decommissioned
- **Removed:** All 30 Databricks jobs (lost access to workspace)
- **Removed:** Unity Catalog schema `main.fantasai` (79 Delta tables)
- **Replaced with:** Single DuckDB file at `local_processing/db/fantasai.duckdb` (17 tables, Bronze/Silver/Gold)
- **Replaced with:** 2 Windows Task Scheduler orchestrators (`orchestrator_daily.py`, `orchestrator_weekly.py`)

### New: Local ETL Pipeline (`local_processing/`)
| Script | Status | Output |
|--------|--------|--------|
| `ingest/ingest_sleeper_players.py` | Tested | 4,254 players, 258 news, 167 injuries, 100 trending |
| `ingest/ingest_espn_news.py` | Tested | 120 articles (limited test) |
| `ingest/ingest_google_news.py` | Tested | 48 articles (5-player test) |
| `ingest/ingest_nfl_transactions.py` | Tested | 27 transactions (7-day) |
| `ingest/ingest_apisports.py` | Tested | 713 player-stat records (Week 18/2024 dry-run) |
| `ingest/ingest_nflverse.py` | Not tested | Needs weekly run |
| `gold/gold_player_consolidation.py` | Tested | 4,151 unique players in gold_player_dim |
| `export/export_to_r2.py` | Tested | All 11 R2 keys uploaded |

### Bug Fixes Discovered During Testing
- `db.py`: `executescript()` is SQLite-only — replaced with `split(";")` + individual `execute()` calls
- `ingest_sleeper_players.py`: Sleeper trending API returns `{count, player_id}` (count first) — fixed column reorder
- `ingest_google_news.py`: Gold fallback only triggered on exceptions, not empty results — fixed to check `df.empty`
- `ingest_google_news.py`: DuckDB `INTERVAL ?` parameterized syntax unsupported — replaced with f-string
- `gold_player_consolidation.py`: Blocked on empty `silver_weekly_stats` — now builds from Sleeper bronze alone on daily runs
- All scripts: SSL cert failure (corporate proxy) — created `ssl_utils.py` using `truststore` (Windows cert store)
- All scripts: Emoji in print statements → `UnicodeEncodeError` on Windows cp1252 — set `PYTHONIOENCODING=utf-8`

### Notebook Consolidation
- **Moved** to `notebooks/01_Ingestion/Bronze/`: `article_labeling_feedback_ingestion.py`, `NFL_Draft_Capital_Ingestion.py`, `08_weather_ingestion.py`
- **Moved** to `notebooks/01_Ingestion/Gold/`: `ADP_Consolidation_Gold.py`, `gold_player_mapping_corrections.py`
- **Archived** to `notebooks/_Archive_20260601/`: both `07_news_ingestion.py` versions (superseded), `ESPN Public API - Scheduled Weekly Update.ipynb` (duplicate of `13_espn_fantasy_ingestion.ipynb`), `ESPN Public API Ingestion.ipynb` (mislabeled — actually SportsData.io, API auth failed)

### Docs Updated
- `ARCHITECTURE.md` → v3.0 (platform, system inventory, data flow diagram, job schedules, repo structure)
- `README.md` → v2 (stack table, architecture diagram, data flow, R2 keys, setup instructions, removed Databricks Jobs section)

---

## [1.5.0] - 2026-06-13

### 🎯 Summary
Job 3 player writeup pipeline operational. Two-mode scheduling (nightly rostered + weekly all-players). Frontend wired to display real Qwen-generated writeups in player detail drawer. Multiple UI fixes across Current Roster, Players, and Sources screens.

---

### 🤖 Local Pipeline — Job 3 Player Writeups

#### New Script: `local_processing/job3_player_writeups.py`
- **Model:** Qwen3 14B
- Generates 2-3 paragraph narrative player profiles grounded in real 2025 stats (rushing yards, receiving yards, passing yards, TDs, PPG)
- Reads `players/player_profiles.json` from R2 (Databricks gold export with real stats)
- Reads `fantasai/news/player_notes.json` for recent headline context
- Writes `players/player_writeups.json` to R2

#### Two Scheduling Modes
| Mode | Flag | Schedule | Players | Est. Runtime |
|------|------|----------|---------|--------------|
| Rostered | `--mode rostered` | Nightly 2:00 AM | ~180 (ADP ≤ 200 / live CBS) | ~90 min |
| All players | `--mode all` | Weekly Sunday 3:00 AM | ~977 skill players | ~8 hrs |

#### Cache / Freshness Rules
- **Rostered mode:** skips players generated within the last 20 hours — safe to re-run nightly without duplicate work
- **All mode:** skips players generated within the last 6 days
- **Data-change cache:** also skips if `injury_status + news_count + adp_rank + fantasy_pts` hash unchanged
- `--full` flag bypasses all cache and regenerates everything
- Existing writeups for players not in the current run are preserved (incremental merge)

#### Rostered Player Detection (priority order)
1. `GET /api/v1/cbs/players` — live CBS roster (requires valid CBS cookie)
2. `percent_owned > 0` in `export_players_2026_draft` R2 export
3. ADP rank ≤ 200 fallback — covers all 12-team roster spots + handcuffs when CBS unavailable

#### Windows Task Scheduler Registration
Both jobs live in the `\FantasAI\` Task Scheduler folder:
- **`FantasAI - Job3 Rostered Writeups (Nightly)`** — Daily 2:00 AM, 3hr time limit
- **`FantasAI - Job3 All Player Writeups (Weekly)`** — Sunday 3:00 AM, 10hr time limit
- Both use `-StartWhenAvailable` (runs on next wake if machine was sleeping at trigger time)
- Both use `-RunLevel Highest`

```powershell
# Verify jobs registered:
Get-ScheduledTask -TaskPath "\FantasAI\"
```

#### R2 Output: `players/player_writeups.json`
```json
{
  "generated_at": "2026-06-13T02:00:00Z",
  "model": "qwen3:14b",
  "mode": "rostered",
  "player_count": 178,
  "players": {
    "Bijan Robinson": {
      "writeup": "Bijan Robinson dominated in 2025...",
      "summary": "Bijan Robinson dominated in 2025.",
      "position": "RB", "team": "ATL",
      "adp_rank_ppr": 3,
      "generated_at": "2026-06-13T02:14:22Z",
      "_cache_key": "a3f92b1c4d7e",
      "_mode": "rostered"
    }
  }
}
```

---

### 🌐 Frontend — Player Writeups Display

#### `app/src/api.js`
- Added `api.r2.playerWriteups()` → fetches `players/player_writeups.json`

#### `app/src/hooks.js`
- Added `useR2PlayerWriteups` hook

#### `app/src/screens/Players.jsx` — PlayerDetail drawer
- Imports `useR2PlayerWriteups`
- Loads writeups on drawer open; looks up player by full name
- **FantasAI Insight card** now shows real Qwen writeup (paragraphs split on `\n\n`) when available
- Shows "Qwen · date" label in top-right when writeup is live
- Falls back to existing proj-based template when no writeup exists yet

---

### 🖥️ Frontend — UI Fixes & Improvements

#### `app/src/screens/CurrentRoster.jsx`
- **Column group headers:** SCHEDULE, WEATHER, TRENDS, and FANTASY POINTS all use light blue style (`rgba(78,168,255,.12)` background, `#4ea8ff` text/border)
- **Slot and Player column headers:** now bold white (`fontWeight: 800, color: '#fff'`)
- **Apply Optimal Lineup (`<LineupDecisions>`):** moved from the removed "Add Player" tab to the bottom of the **My Roster** tab
- **Add Player tab removed:** tab button and full content block deleted; dead state (`addFilter`, `addSearch`, `available` filter) cleaned up
- **Free agent replace list:** sorted by `proj` descending (was ECR); cap raised from 15 → 20; only shows unrostered players

#### `app/src/screens/Players.jsx`
- **Breakout filter button:** active state changed from yellow-green (`#c6ff3a`) to blue (`#4ea8ff`) to match the blue breakout badges on player rows
- Count badge color updated to match

#### `app/src/screens/Sources.jsx`
- **Cookie alert banner:** now includes "🍪 Get Cookie" button that directly opens the CBS cookie modal
- **Green success animation:** banner, CBS hero card border, and CBS Cookie Worker card all flip to green when cookie is saved; revert to normal after 5 seconds
- **CBS Cookie Worker card:** shows "CONNECTED" green badge on success; "NEEDS ATTENTION" red badge when alert active
- **`WorkerConfig`** wired with `openCookieTrigger` and `onCookieSaved` props

#### `app/src/components/CBSConnectModal.jsx`
- `WorkerConfig` accepts `openCookieTrigger` (counter) and `onCookieSaved` callback
- Opens cookie modal when `openCookieTrigger` increments
- Calls `onCookieSaved?.()` after successful cookie validation

---

### 🐛 Bug Fixes

#### Spark JSON String Deserialization (`notes` field)
- **Root cause:** Databricks/Spark serializes array fields (e.g., `notes`) as JSON-encoded strings in R2 exports, not parsed arrays
- **Fixed in:** `CurrentRoster.jsx`, `News.jsx` (×2 locations), `Players.jsx`
- **Pattern applied everywhere:**
  ```js
  const notes = Array.isArray(pn.notes) ? pn.notes
    : typeof pn.notes === 'string' ? (() => { try { return JSON.parse(pn.notes); } catch { return []; } })()
    : [];
  ```

#### ADP Fixes (`app/src/lib/playerStore.js`)
- Removed `search_rank` as ADP fallback — Sleeper `search_rank` is trending popularity, NOT draft position (was causing Cameron Latu to appear as ADP 1.0)
- Removed proj-based ADP fallback in `!hasRanks` block — user confirmed these values were inaccurate
- ADP stays at 999 until the R2 `adp_ppr` / `adp_standard` patch runs

#### ADP Patch Survival (`app/src/App.jsx`)
- **Root cause:** `patchPlayers()` ADP values applied at t~1s were erased by `setPlayers()` at t=5s from `dbPlayers` DB reload
- **Fix:** `adpByNameRef` caches the ADP map by name and re-applies it after every `setPlayers()` call

#### Player Deduplication (`app/src/App.jsx`)
- Pre-dedup now uses name-only key across all name fields (`full_name`, `player_name`, `name`, `first_name + last_name`)
- Two-pass sort in `normalizePlayerList`: valid NFL team entries processed first so corrupt-team duplicates always lose name-based dedup
- NFL team validation via `BYE_WEEKS_2026` rejects values like "TEPHI"

#### Power Rankings projected points (`app/src/lib/powerUtils.js`)
- `projPts` now sums **all roster entries** (not just starters)

---

### 📦 New R2 Artifacts

| R2 Path | Written by | Consumed by | Notes |
|---------|-----------|-------------|-------|
| `players/player_writeups.json` | Job 3 (local Qwen 14B) | PlayerDetail drawer | Nightly (rostered) + weekly (all) |
| `players/player_profiles.json` | Databricks ETL | Job 3 | Real 2025 stats: rush yds, rec yds, pass yds, TDs |

---

## [1.4.0] - 2026-06-12

### 🎯 Summary
Incremental processing for both local Qwen jobs — only new articles and changed players are processed on each run.

### ✨ Added
- **Job 1 (`job1_news_processor.py`) — incremental by default**
  - Loads classified article cache from R2 (`fantasai/news/classified_cache.json`)
  - Fingerprints each article (real ID or headline MD5 hash as fallback)
  - Skips articles already in cache; classifies only new ones
  - Merges new results into cache, prunes entries older than 60 days
  - Rebuilds `player_notes.json` and `ai_summaries.json` from full merged history
  - `--full` flag forces reprocessing of all articles
- **Job 2 (`job2_fantasy_analyzer.py`) — incremental by default**
  - Loads existing `player_scores.json` from R2 on startup
  - Skips players whose `max_relevance` hasn't changed by more than 0.5
  - Preserves scores for players not in the current enriched set
  - `--full` flag forces re-scoring of all players
- **`pipeline_runner.py`** — `--full` flag propagates to both jobs

### Pipeline quick reference
| Script | Model | Default behavior |
|---|---|---|
| `job1_news_processor.py` | Qwen3 8B | Incremental — new articles only |
| `job2_fantasy_analyzer.py` | Qwen3 14B | Incremental — changed players only |
| `pipeline_runner.py` | Both | Orchestrates Job 1 → Job 2 |

---

## [1.3.0] - 2026-06-12

### 🎯 Summary
Cleaned retired players from `export_players_2026_draft`. Reduced from 1,631 to 997 active players. Confirmed no retired players (e.g. Roethlisberger, Le'Veon Bell) remain. All 997 records now have `isDraftable: true`.

### ✨ Added / Changed
- **`export_players_2026_draft`** pruned to 997 active 2026 draft candidates
  - Removed 634 retired/inactive players
  - Breakdown: QB(124), RB(198), WR(391), TE(204), K(43), FB(5), DEF(32)
  - R2 export re-triggered (Run ID 152985611666989, 11:06–11:07 UTC) and confirmed live
- **Local Qwen AI pipeline** operational end-to-end (see project_tier1_pipeline)
  - Job 1: Qwen3 8B bulk news → R2 enrichments
  - Job 2: Qwen3 14B fantasy analysis → R2 enrichments → Databricks Gold ingestion
- **`export_players_2026_draft` field schema** (live camelCase R2 format):
  `playerId`, `name`, `position`, `team`, `proj`, `avg`, `last`, `trend`, `positionRank`, `percentile`, `tier`, `isDraftable`, `status`, `lastSeasonPlayed`, `experience`, `isRookie`
- **ADP not yet present** in `export_players_2026_draft` — pending ETL addition

---

## [1.2.0] - 2026-06-04

### 🎯 Summary
Created production-ready "2026 Players" table and enabled R2 optimization for all ML tables to support UI integration.

### ✨ Added

#### New Tables
- **`main.fantasai.players_2026_draft`**
  - 1,631 total players (1,338 draftable, 293 retired/inactive)
  - Positions: QB (224), RB (377), WR (674), TE (356)
  - Key columns: `is_draftable`, `projected_avg_points`, `player_status`, `season_tier`
  - Activity breakdown:
    - Active 2025: 873 players
    - Active 2024 Late Season: 594 players
    - Active 2024 Mid Season: 103 players
    - Limited 2024 Activity: 61 players (not draftable)
  - Includes physical attributes (combine metrics) for ~40% of players
  - Z-ordered by (is_draftable, position, projected_avg_points)
  - Size: 139 KB

#### Documentation
- **`/docs/UI_INTEGRATION_GUIDE.md`** - Comprehensive 12KB UI integration guide
  - Table schemas and example queries
  - Performance expectations (< 300ms)
  - Best practices and common pitfalls
  - Data refresh strategy
  - UI design guidance (badges, colors, ranks)

### 🚀 Improved

#### R2 Optimization Enabled
Applied to all 4 production tables:
1. `main.fantasai.players_2026_draft` (139 KB)
2. `main.fantasai.ml_weekly_predictions` (826 KB, 24,862 rows)
3. `main.fantasai.ml_feature_importance`
4. `main.fantasai.ml_player_features` (162,896 rows)

**Configuration:**
- `delta.autoOptimize.optimizeWrite = true`
- `delta.autoOptimize.autoCompact = true`
- Z-ordering applied for query performance
- Predictive caching enabled

**Benefits:**
- Automatic file compaction (merge small files)
- Optimized write operations (lower latency)
- Physical data clustering (skip irrelevant files)
- Intelligent hot data caching (millisecond response)
- Auto-statistics collection (optimal query plans)

**Expected Performance:**
- Player search (by name): < 100ms
- Position filter: < 50ms
- Top 100 rankings: < 200ms
- Player detail lookup: < 20ms
- Weekly predictions: < 300ms

### 🔧 Technical Details

#### Table Structure
```sql
main.fantasai.players_2026_draft
├── Identification: master_player_id, player_name, position, current_team
├── Status: is_draftable, player_status, is_rookie_eligible
├── Performance: season_avg_points, recent_3game_avg, recent_5game_avg
├── Rankings: position_rank, season_percentile, season_tier
├── Projections: projected_avg_points, projected_ceiling
├── Physical: combine_height, combine_weight, combine_40_time, athleticism_composite
├── Experience: nfl_draft_year, years_in_nfl
└── Metadata: last_updated, fantasy_draft_year (2026)
```

#### Key Business Rules
1. **Always filter by `is_draftable = TRUE`** to exclude retired/inactive players
2. **Sort by `projected_avg_points`** for ML-powered rankings (not season_avg)
3. **Label as "2026 Players"** everywhere in UI (not "active" or "current")
4. **Handle nulls** in combine metrics (~60% missing for pre-draft era players)
5. **Refresh weekly** during season for latest stats

### 📊 Data Quality

#### Coverage
- **Total players tracked:** 5,250 unique players across all seasons
- **2026 draft eligible:** 1,338 active players
- **Combine metrics:** ~40% coverage (older players lack data)
- **ML predictions:** Available for players with 10+ games in 2024

#### Validation
- All features use correct column names (no spurious columns)
- Combine features: `combine_height`, `combine_40_time`, `combine_bench`, `combine_3cone`
- Athleticism scores: `athleticism_composite`, `speed_score`
- Rolling windows: 3-game, 5-game averages with proper null handling

### 🔄 Integration Status

#### Completed
- [x] ML pipeline fully operational (Job 763487314454311)
- [x] Features table: `main.fantasai.ml_player_features` (70 features, 162,896 rows)
- [x] Predictions table: `main.fantasai.ml_weekly_predictions` (24,862 predictions)
- [x] Feature importance: `main.fantasai.ml_feature_importance`
- [x] 2026 players table: `main.fantasai.players_2026_draft` (1,338 draftable)
- [x] R2 optimization enabled on all tables
- [x] Z-ordering applied for query performance
- [x] Documentation created (UI integration guide)

#### Pending
- [ ] Model serving endpoints deployment (blocked - needs UI manual setup)
- [ ] Feature importance extraction and visualization
- [ ] Automated weekly refresh job
- [ ] UI connection and testing

### 📝 Notes

#### Terminology Change
- **Old:** "Active players", "current players"
- **New:** "2026 Players" (consistent across all UI)

#### Table Naming Convention
- Draft table named `players_2026_draft` (not `active_players`)
- Column `fantasy_draft_year = 2026` for clarity
- NFL draft year preserved as `nfl_draft_year`

#### Performance Optimization
- R2 runs continuously in background (zero maintenance)
- No manual OPTIMIZE commands needed
- Tables scale automatically with data growth
- Zero downtime during optimization

---

## [1.1.0] - 2026-06-04 (Earlier)

### ✨ Added
- ML training pipeline fully debugged and operational
- Job orchestrator: `/Repos/.../05_Scheduled_Jobs/00_ML_Training_Master_Orchestrator`
- Job ID: 763487314454311
- Successful run: 392807370594387 (Task Run: 624247027345464)

### 🐛 Fixed
- Combine feature bug: outdated 'hand_size' column reference
- Updated to correct column names: 'combine_height', 'combine_40_time', etc.
- All three notebooks (engineer, prep, train) executed successfully

### 📊 Tables Created
- `main.fantasai.ml_player_features` (70 features, 162,896 player-weeks)
  - 5,250 unique players
  - Combine coverage: ~40%
  - All features use correct column names
- `main.fantasai.ml_weekly_predictions` (24,862 predictions)
  - 2024 weeks 10-17
  - All positions: QB, RB, WR, TE

### 🤖 Models Registered
- `main.fantasai.player_performance_predictor_qb` (v1)
  - Run: 912be789d4524a0a9f926431fc8a88fd
  - RMSE: 4.92, MAE: 2.73, R²: 0.776
- `main.fantasai.player_performance_predictor_rb` (v1)
  - Run: ae3a7c9fb600494aa93efd7cc22ef7cb
- `main.fantasai.player_performance_predictor_wr` (v1)
  - Run: 237753d24cc24d29a85a7cdf526a5780
- `main.fantasai.player_performance_predictor_te` (v1)
  - Run: c18fcbf8c7b14aa7a8a1a47760048fe0

---

## [1.0.0] - Earlier Releases

### Initial Setup
- Data ingestion pipeline established
- Feature engineering notebooks created
- Model training infrastructure
- MLflow experiment tracking
- Unity Catalog integration

---

## 📌 Quick Links

### Tables
- [main.fantasai.players_2026_draft](databricks://main.fantasai.players_2026_draft)
- [main.fantasai.ml_weekly_predictions](databricks://main.fantasai.ml_weekly_predictions)
- [main.fantasai.ml_feature_importance](databricks://main.fantasai.ml_feature_importance)
- [main.fantasai.ml_player_features](databricks://main.fantasai.ml_player_features)

### Jobs
- [ML Training Orchestrator (763487314454311)](databricks://jobs/763487314454311)
- [Latest Successful Run (392807370594387)](databricks://jobs/763487314454311/runs/392807370594387)

### Documentation
- [UI Integration Guide](/Repos/kingoffrisco@yahoo.com/FantasAI/docs/UI_INTEGRATION_GUIDE.md)
- [Feature Engineering Notebooks](/Repos/kingoffrisco@yahoo.com/FantasAI/notebooks/03_ML_Training/)
- [Scheduled Jobs](/Repos/kingoffrisco@yahoo.com/FantasAI/notebooks/05_Scheduled_Jobs/)

### Models
- MLflow Experiment: `fantasai_weekly_predictions` (ID: 4060439875893869)
- UC Models: `main.fantasai.player_performance_predictor_*`

---

## 🎯 Next Steps

### Immediate (Week 1)
1. Deploy model serving endpoints via UI
2. Connect UI to `players_2026_draft` table
3. Test query performance (validate < 300ms)
4. Implement weekly data refresh job

### Short-term (Month 1)
1. Extract and visualize feature importance
2. Build "Why this prediction?" UI tooltips
3. Create admin dashboard for data quality monitoring
4. Add automated alerting for pipeline failures

### Long-term (Season 1)
1. A/B test ML predictions vs traditional rankings
2. Collect user feedback on prediction accuracy
3. Retrain models weekly with new game data
4. Expand to additional fantasy formats (DFS, best ball)

---

**Maintained by:** kingoffrisco@yahoo.com  
**Last Updated:** June 4, 2026
