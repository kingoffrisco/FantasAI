# FantasAI Data Sources Reference

**Last Updated:** June 2, 2026  
**Purpose:** Comprehensive reference for all data sources used in FantasAI platform

---

## Table of Contents

1. [**Data Ingestion Strategy**](#data-ingestion-strategy) 🔥 **NEW**
2. [**Ingestion Notebook Inventory**](#ingestion-notebook-inventory) 🔥 **NEW**
3. [Primary Weekly Stats Sources](#primary-weekly-stats-sources)
4. [Specialized Data Sources](#specialized-data-sources)
5. [Historical Data Sources](#historical-data-sources)
6. [Field Availability Matrix](#field-availability-matrix)
7. [Known Limitations](#known-limitations)
8. [Update Schedules](#update-schedules)

---

## Data Ingestion Strategy

### Core Principle: INCREMENTAL vs FULL-REFRESH

**When to use INCREMENTAL mode (default for scheduled jobs):**
- ✅ You already have historic data in the table
- ✅ You're pulling the latest week/season only
- ✅ Schema has NOT changed (no new columns/fields)
- ✅ Example: Weekly stat updates, daily news ingestion

**When to use FULL-REFRESH mode (one-time backfill):**
- 🔴 You're adding a **new feature or data point** (e.g., YAC, headshot_url, NextGen Stats)
- 🔴 Schema has changed (new columns added)
- 🔴 Data quality issues require reprocessing
- 🔴 Initial historical backfill (first time ingesting a source)

### Implementation Pattern

All ingestion notebooks should support both modes:

```python
# Configuration at top of notebook
MODE = 'INCREMENTAL'  # or 'HISTORICAL'

if MODE == 'HISTORICAL':
    # Pull ALL available data (e.g., 2016-2025)
    seasons = range(2016, 2026)
    print("🔄 HISTORICAL MODE: Backfilling all seasons")
else:
    # Pull only latest data not yet in table
    seasons = [2025]
    print("⚡ INCREMENTAL MODE: Fetching latest data only")
```

### Critical Rules

1. **ALWAYS check for existing notebooks before creating new ones** 🔴 **MANDATORY**  
   Before creating a new ingestion notebook:
   - Search for existing notebooks: `searchAssets(searchQuery="<source_name> ingestion")`
   - Check `/Repos/.../01_Ingestion/Bronze/` for active production notebooks
   - Review the "Ingestion Notebook Inventory" section above
   - **Only create a new notebook if:**
     - No notebook exists for that data source, OR
     - The existing notebook is too large (>500 lines) and needs to be split logically
   - **If splitting, document why:**
     - Add comment in old notebook: `# ⚠️ This notebook split on [date]. See [new_notebook_name] for [reason]`
     - Add comment in new notebook: `# 🆕 Split from [old_notebook_name] on [date] because [reason]`

2. **New columns = FULL-REFRESH required**  
   If you add `headshot_url` or `receiving_yards_after_catch` to nflverse ingestion, you MUST run HISTORICAL mode to populate those fields for all existing records.

3. **Schema evolution requires downstream updates**  
   When adding new fields:
   - Update Bronze ingestion (add field extraction)
   - Update Silver transformation (parse new fields)
   - Update Gold layer (include in consolidation)
   - Use `.option("overwriteSchema", "true")` on write

4. **Check existing data before running**  
   Always query the table first to see what you already have:
   ```sql
   SELECT 
     MIN(season) as first_season, 
     MAX(season) as last_season,
     COUNT(DISTINCT season) as seasons_covered
   FROM main.fantasai.table_name;
   ```

5. **Deduplicate on write**  
   Use MERGE operations or `.dropDuplicates()` to avoid inserting duplicate records during HISTORICAL runs.

---

## Ingestion Notebook Inventory

### Active Production Notebooks

| Data Source | Notebook Path | Mode Support | Status |
|-------------|---------------|--------------|--------|
| **Sleeper API** | `/Repos/.../01_Ingestion/Bronze/15_sleeper_api_ingestion` | ✅ HISTORICAL + INCREMENTAL | **Production** |
| **ESPN Public** | `/Repos/.../01_Ingestion/Bronze/13_espn_fantasy_ingestion` | ⚠️ Needs mode support | **Production** |
| **nflverse Stats** | `/Repos/.../02_Analysis_Metrics/14_nflverse_ingestion` | ⚠️ Needs mode support | **Production** |
| **NFL Combine** | `/Users/.../02_Analysis_Metrics/nfl_combine_ingestion` | Manual CSV (annual) | **Production** |
| **NextGen Stats** | Embedded in nflverse notebook | ⚠️ Needs dedicated notebook | **Planned** |

### Consolidation Recommendations

**🔴 HIGH PRIORITY - Duplicate Cleanup:**

1. **Sleeper Notebooks (5 total)**
   - ✅ **Keep:** `/Repos/.../15_sleeper_api_ingestion` (has HISTORICAL/INCREMENTAL)
   - 🗑️ **Archive:** 4 duplicate versions in `_Archive_Old_Notebooks/` and `Trash/`

2. **ESPN Notebooks (5 total)**
   - ✅ **Keep:** `/Repos/.../13_espn_fantasy_ingestion`
   - 🔧 **Add:** HISTORICAL/INCREMENTAL mode support
   - 🗑️ **Archive:** 4 duplicate versions

3. **nflverse Notebooks (5+ total)**
   - ✅ **Keep:** `/Repos/.../14_nflverse_ingestion` (in 02_Analysis_Metrics)
   - 🔧 **Add:** HISTORICAL/INCREMENTAL mode support
   - 🔧 **Extract:** NextGen Stats into separate notebook (see TODO #9)
   - 🗑️ **Archive:** 4 duplicate versions

4. **NextGen Stats (No dedicated notebook)**
   - 🔴 **Create:** `/Repos/.../01_Ingestion/Bronze/16_nextgen_stats_ingestion`
   - 🔧 **Backfill:** 2016-2020 data (TODO #9)
   - 🔧 **Separate:** Rushing, Passing, Receiving into 3 endpoints

### Notebook Naming Convention

```
{number}_{source}_{type}.py

Examples:
- 13_espn_fantasy_ingestion.py
- 14_nflverse_ingestion.py
- 15_sleeper_api_ingestion.py
- 16_nextgen_stats_ingestion.py (to be created)
```

---


## Primary Weekly Stats Sources

These sources provide weekly player performance data and feed into `bronze_weekly_stats` → `silver_weekly_stats` → `gold_weekly_stats`.

### 1. Sleeper API

**Coverage:** 2024-2025 seasons (weeks 1-18)  
**Records:** 81,658 total | 3,411 unique players  
**Last Updated:** June 2, 2026 08:10 UTC  
**Table:** `main.fantasai.bronze_weekly_stats` (source = 'sleeper')

**Capabilities:**
- ✅ Real-time weekly stats updates
- ✅ PPR scoring built-in
- ✅ IDP (defensive) stats
- ✅ Snap counts (team offensive/defensive/special teams)
- ✅ Player metadata (height, weight, years in NFL)
- ✅ Position rankings (std, PPR, half-PPR)

**Key Fields Available:**
```
Offensive Stats:
- pts_ppr, pts_half_ppr, pts_std
- pass_yd, pass_td, pass_int, pass_cmp, pass_att, pass_2pt
- rush_yd, rush_td, rush_att, rush_2pt
- rec, rec_yd, rec_td, rec_2pt
- fum, fum_lost

Advanced:
- tm_off_snp, tm_def_snp, tm_st_snp (team snap counts)
- pos_rank_ppr, pos_rank_std, pos_rank_half_ppr
- gp (games played), gms_active

IDP:
- idp_tkl, idp_tkl_ast, idp_sack, idp_int, idp_ff, idp_fum_rec
```

**API Limits:**
- ⚠️ **1,000 calls/day** (HARD LIMIT)
- Use sparingly, cache aggressively
- Schedule: Daily at 06:00 UTC

**JSON Structure:**
```json
{
  "player_name": "Player Name",
  "position": "RB",
  "team": "SF",
  "stats": {
    "pts_ppr": 18.5,
    "rush_yd": 85,
    "rush_td": 1,
    "rec": 3,
    "rec_yd": 20
  },
  "player_metadata": {
    "height": "5-10",
    "weight": "205",
    "years_exp": "5"
  }
}
```

---

### 2. ESPN Public API

**Coverage:** 2024-2025 seasons (weeks 1-18)  
**Records:** 34,360 total | 1,855 unique players  
**Last Updated:** June 2, 2026 08:02 UTC  
**Table:** `main.fantasai.bronze_weekly_stats` (source = 'espn_public')

**Capabilities:**
- ✅ No API limits (public endpoint)
- ✅ Game-level boxscore stats
- ✅ Multi-stat categories per player
- ✅ Real-time during games
- ❌ No advanced metrics (EPA, air yards, etc.)
- ❌ No snap counts

**Key Fields Available:**
```
Passing:
- comp_att (e.g. "20/30")
- yards, average, passing_touch_downs
- interceptions, sacks, rating, two_pt

Rushing:
- total_rushes, yards, average
- rushing_touch_downs, longest_rush, two_pt

Receiving:
- receptions, yards, average
- receiving_touch_downs, longest_reception, two_pt
- targets

Kicking/Defense:
- fg_made, fg_att, xp_made, xp_att
- tackles, sacks, int, forced_fumbles
```

**JSON Structure:**
```json
{
  "player_name": "Player Name",
  "team": "San Francisco 49ers",
  "position": "RB",
  "game_id": 13147,
  "game_name": "SF @ LAR",
  "receiving": {
    "receptions": "5",
    "yards": "62",
    "receiving_touch_downs": "1"
  },
  "rushing": {
    "total_rushes": "12",
    "yards": "98",
    "rushing_touch_downs": "1"
  }
}
```

**Advantages:**
- No rate limits
- Good for backfilling missing Sleeper data
- Reliable game-level stats

**Limitations:**
- Less detailed than nflverse
- No EPA, air yards, or advanced metrics
- Requires parsing nested stat groups

---

### 3. nflverse (GitHub Parquet Files)

**Coverage:** 2021-2024 seasons (72 season-weeks)  
**Records:** 48,516 total | 1,091 unique players  
**Last Updated:** June 2, 2026 13:58 UTC  
**Table:** `main.fantasai.bronze_weekly_stats` (source = 'nflverse')

**Capabilities:**
- ✅ **Most comprehensive stat set**
- ✅ EPA (Expected Points Added)
- ✅ Air yards, yards after catch (YAC)
- ✅ PACR, RACR, WOPR advanced metrics
- ✅ Player headshots (headshot_url)
- ✅ No API limits (direct parquet downloads)
- ❌ **2025 data NOT available** (404 errors, unpublished)

**Key Fields Available:**
```
Basic Stats:
- passing_yards, passing_tds, interceptions, attempts, completions
- rushing_yards, rushing_tds, carries
- receiving_yards, receiving_tds, receptions, targets
- fantasy_points, fantasy_points_ppr

Advanced Metrics:
- passing_epa, rushing_epa, receiving_epa
- passing_air_yards, passing_yards_after_catch
- receiving_air_yards, receiving_yards_after_catch ⭐
- air_yards_share, target_share, wopr
- pacr (passing air conversion ratio)
- racr (receiver air conversion ratio)
- dakota (QB metric)

Player Info:
- player_id (nflverse ID format: 00-0012345)
- player_name, player_display_name
- headshot_url ⭐ (player avatar/photo)
- position, position_group
- recent_team, opponent_team
```

**JSON Structure:**
```json
{
  "player_id": "00-0023459",
  "player_name": "A.Rodgers",
  "player_display_name": "Aaron Rodgers",
  "position": "QB",
  "headshot_url": "https://static.www.nfl.com/image/upload/...",
  "recent_team": "NYJ",
  "season": 2024,
  "week": 1,
  "passing_yards": 167,
  "passing_tds": 1,
  "passing_epa": 3.258,
  "passing_air_yards": 164,
  "passing_yards_after_catch": 93,
  "fantasy_points_ppr": 8.58
}
```

**⚠️ Known Issues:**
- **2025 Season:** All weeks return 404 errors (data not published by nflverse yet)
- Graceful exit implemented in ingestion job
- Historical data (2021-2024) remains intact
- Monitor nflverse GitHub for 2025 data availability

**Update Pattern:**
- Historical data: One-time backfill
- Current season: Weekly updates (when available)
- Schedule: Monday 12:00 UTC (after games)

---

### 4. API-Sports.io

**Coverage:** 2024 season (6 weeks)  
**Records:** 7,388 total | 2,166 unique players  
**Last Updated:** May 30, 2026 07:01 UTC  
**Table:** `main.fantasai.bronze_weekly_stats` (source = 'api_sports')

**Status:** ⚠️ **Limited/Experimental**

**Capabilities:**
- ✅ Similar structure to ESPN
- ✅ Game-level stats
- ❌ Incomplete coverage (only 6 weeks in 2024)
- ❌ Not actively maintained

**Current Use:** Backup source only, not primary

**JSON Structure:**
```json
{
  "player_id": "142",
  "player_name": "Bailey Zappe",
  "team": "New England Patriots",
  "stat_group": "Passing",
  "game_id": 13147,
  "statistics": {
    "comp_att": "12/20",
    "yards": "108",
    "passing_touch_downs": "0",
    "interceptions": "0",
    "rating": "74.6"
  }
}
```

---

### 5. Unnamed Source (Historical)

**Coverage:** 2016-2025 (88 season-weeks)  
**Records:** 144,175 total | 8,601 unique players  
**Last Updated:** May 31, 2026 01:18 UTC  
**Table:** `main.fantasai.bronze_weekly_stats` (source = NULL)

**Status:** ⚠️ **Legacy data, source unknown**

This appears to be historical backfill data from an unidentified source. Large dataset spanning multiple seasons, likely from a one-time import or migration.

**Recommendation:** Investigate origin if additional historical data is needed.

---

### 6. Fantasy Data Pros Historical

**Coverage:** 1999-2020 seasons  
**Records:** 13,088 total | 13,050 unique players  
**Last Updated:** May 27, 2026 02:35 UTC  
**Table:** `main.fantasai.bronze_weekly_stats` (source = 'fantasy_data_pros_historical')

**Purpose:** Historical player performance archive

**Capabilities:**
- ✅ 20+ years of historical data
- ✅ Good for long-term trend analysis
- ✅ Training data for ML models
- ❌ No current season data
- ❌ One-time import (not updated)

**Use Cases:**
- Historical player performance lookups
- Career trajectory analysis
- ML model training (historical patterns)
- Rookie comparisons

---

## Specialized Data Sources

These provide targeted data for specific analytics use cases.

### 1. Player Snap Counts

**Table:** `main.fantasai.player_snap_counts`  
**Coverage:** 2021-2025 seasons  
**Records:** 132,540 total | 6,316 unique players

**Sources:**
- `nflverse`: 31,374 records (2021-2025)
- `nflverse_snap_counts`: 101,166 records (2021-2024)

**Fields:**
```
- game_id, pfr_game_id
- season, week, game_type
- player, pfr_player_id, position, team, opponent
- offense_snaps, offense_pct
- defense_snaps, defense_pct
- st_snaps, st_pct
```

**Use Cases:**
- Workload analysis (snap share trends)
- Breakout candidate identification
- Player opportunity scoring
- Injury impact assessment

**Key Metrics Derived:**
- Snap share delta (week-over-week change)
- Average snap share (rolling windows)
- Position group snap distribution

---

### 2. NextGen Stats

**Table:** `main.fantasai.player_nextgen_stats`  
**Coverage:** 2021-2025 seasons  
**Records:** 7,351 total | 445 unique players  
**Source:** nflverse NextGen dataset

**Fields:**
```
Receiving:
- avg_cushion (DB distance at snap)
- avg_separation (separation at catch)
- avg_intended_air_yards
- percent_share_of_intended_air_yards
- receptions, targets
- avg_yac (yards after catch)
- avg_expected_yac
- yacoe (YAC over expected)

Rushing:
- efficiency, percent_attempts_gte_eight_defenders
- avg_time_to_los (time to line of scrimmage)

Passing:
- avg_time_to_throw
- avg_completed_air_yards
- avg_intended_air_yards
- aggressiveness, max_completed_air_distance
```

**⚠️ Important Notes:**
- **Limited player coverage** (only 445 players across 5 seasons)
- Focuses on skill position players with significant targets/attempts
- Not available for all players in bronze_weekly_stats
- Best used for WR/TE route analysis and QB passing metrics

**Use Cases:**
- WR route-running analysis (separation, cushion)
- TE/WR opportunity metrics (air yards share)
- QB decision-making (aggressiveness, air yards)
- RB efficiency metrics

---

### 3. NFL Combine Results

**Table:** `main.fantasai.player_combine_results`  
**Coverage:** 2000-2025 draft classes  
**Records:** 7,195 total | 7,079 unique players  
**Source:** Manual CSV uploads (annual)

**Fields:**
```
Timing:
- forty_time (40-yard dash)
- shuttle (short shuttle)
- cone (3-cone drill)

Explosiveness:
- vertical_jump, broad_jump

Strength:
- bench_reps (225 lbs bench press)

Bio:
- player_name, position, draft_year, drafted_team
- school, height, weight
```

**⚠️ Column Naming:**
- Use `forty_time`, `vertical_jump`, `bench_reps`
- NOT `forty`, `vertical`, `bench`
- Check schema before feature engineering

**Use Cases:**
- Draft prospect evaluation
- Athletic profile analysis
- ML model features (speed, explosiveness, strength)
- Position-specific thresholds (e.g., 4.4s forty for WR)

**Update Process:**
- Manual CSV upload after NFL Combine each February
- Merge with existing data (no duplicates)
- Schema validation required

**Status:**
- ✅ 2025 data loaded (June 2, 2026)
- ⚠️ Not yet integrated into ML models (retrain pending)

---

### 4. Player Opportunity Scores

**Table:** `main.fantasai.player_opportunity_scores`  
**Coverage:** 2024 season  
**Records:** 411 total | 305 unique players  
**Source:** Derived table (analytics layer)

**Purpose:** Composite metric combining volume, efficiency, and team context

**Fields:**
```
Volume:
- routes_per_game, snap_share
- air_yards_share, rz_total_touches

Efficiency:
- consistency_score

Context:
- team_pace

Percentiles:
- routes_percentile, snap_percentile
- air_yards_percentile, rz_percentile
- consistency_percentile, pace_percentile

Output:
- opportunity_score (0-100 composite)
- opportunity_tier (Elite/High/Medium/Low)
```

**Use Cases:**
- Breakout candidate identification
- Waiver wire targets
- Trade value assessment
- Undervalued player discovery

**Calculation Logic:** See `notebooks/02_Analysis/Player Opportunity Scores`

---

### 5. Breakout Predictions

**Tables:**
- `main.fantasai.breakout_predictions_current` (latest predictions)
- `main.fantasai.breakout_predictions_history` (historical archive)
- `main.fantasai.breakout_training_data` (training features)
- `main.fantasai.breakout_training_data_enhanced` (with news signals)

**Coverage:** 2025 season (week 18 latest)  
**Records (current):** 483 player-week predictions

**Fields:**
```
Player Info:
- player_name, position, team
- season, week

Opportunity Signals:
- snap_share, snap_share_delta
- touches, targets, targets_delta
- opportunity_score
- avg_snap_share_prev_2wk

Performance:
- fantasy_points
- avg_fantasy_points_prev_2wk

News Signals:
- news_sentiment, news_impact_score
- news_volume, has_opportunity_news, has_injury_news
- news_buzz_score

Output:
- breakout_score (0-1 probability)
- alert_level (HIGH/MEDIUM/LOW)
```

**Use Cases:**
- Waiver wire recommendations
- Add/drop decisions
- Weekly start/sit analysis
- Sleeper pick identification

**Model:** Ensemble (position-specific XGBoost models)

---

### 6. Player Trend Analytics

**Table:** `main.fantasai.analytics_player_trends`  
**Source:** Derived from gold_weekly_stats

**Fields:**
```
Rolling Averages:
- avg_fantasy_points (season-to-date)
- last_3_games_avg, last_5_games_avg
- season_avg_to_date

Trend Metrics:
- momentum_score
- trend_direction (Ascending/Descending/Stable)
- wow_change (week-over-week %)
- scoring_streak (consecutive games with points)
```

**Update Schedule:** Daily at 08:00 UTC

---

### 7. Positional Rankings

**Table:** `main.fantasai.analytics_positional_rankings`  
**Source:** Derived from player trends + gold stats

**Fields:**
```
- player_name, position, team
- season, week
- position_rank (1-N within position)
- tier (Tier 1 / Tier 2 / Tier 3)
- avg_points, total_points
- games_played
```

**Use Cases:**
- Draft rankings
- Trade value comparisons
- Positional scarcity analysis

---

## Field Availability Matrix

| Field Category | Sleeper | ESPN | nflverse | API-Sports |
|----------------|---------|------|----------|------------|
| **Basic Stats** | ✅ | ✅ | ✅ | ✅ |
| Passing yards/TDs | ✅ | ✅ | ✅ | ✅ |
| Rushing yards/TDs | ✅ | ✅ | ✅ | ✅ |
| Receiving yards/TDs | ✅ | ✅ | ✅ | ✅ |
| **Advanced Stats** |
| EPA (Expected Points) | ❌ | ❌ | ✅ | ❌ |
| Air Yards | ❌ | ❌ | ✅ | ❌ |
| Yards After Catch (YAC) | ❌ | ❌ | ✅ | ❌ |
| PACR / RACR / WOPR | ❌ | ❌ | ✅ | ❌ |
| Target Share | ❌ | ❌ | ✅ | ❌ |
| Air Yards Share | ❌ | ❌ | ✅ | ❌ |
| **Context** |
| Player Headshot URL | ❌ | ❌ | ✅ | ❌ |
| Snap Counts | ✅ | ❌ | ❌ | ❌ |
| Position Rankings | ✅ | ❌ | ❌ | ❌ |
| IDP Stats | ✅ | ✅ | ❌ | ❌ |
| **Availability** |
| 2025 Season | ✅ | ✅ | ❌ | ⚠️ |
| API Limits | 1K/day | None | None | Unknown |

---

## Known Limitations

### nflverse 2025 Data

**Issue:** All 2025 season weeks return 404 errors  
**Status:** Data not yet published by nflverse  
**Impact:**
- No nflverse data for current (2025) season
- Missing: EPA, air yards, YAC, headshot URLs for 2025
- Gold layer YAC columns will be NULL for 2025 players

**Workaround:**
- Use Sleeper + ESPN as primary sources for 2025
- Historical nflverse data (2021-2024) remains intact
- Ingestion job implements graceful exit (no failures)

**Monitoring:**
- Check nflverse GitHub for 2025 data release
- Backfill when available
- Update schedule: Weekly Monday 12:00 UTC

---

### Sleeper API Rate Limits

**Limit:** 1,000 API calls per day (HARD)

**Impact:**
- Cannot query real-time during games
- Must batch requests efficiently
- Cache results aggressively

**Mitigation:**
- Daily batch job (06:00 UTC)
- Single full-roster pull per day
- No ad-hoc queries during development
- Use cached bronze tables for analytics

**Monitoring:**
- Job logs track API call count
- Alert if approaching 800 calls/day

---

### Ownership Data Gaps

**Issue:** Ownership % only available for Sleeper league members  
**Coverage:** Limited to users' specific leagues

**Impact:**
- No platform-wide ownership data
- Sleeper picks export uses league-specific ownership
- May not reflect broader fantasy landscape

**Workaround:**
- Use roster counts across multiple leagues
- Normalize by total league count
- Consider 0% ownership as "available in all leagues"

---

### NextGen Stats Coverage

**Limitation:** Only 445 players across 5 seasons

**Missing:**
- Low-target WRs and TEs
- Backup QBs with <50 attempts
- RBs with limited snap counts

**Use Case Restrictions:**
- Route analysis only for featured receivers
- Passing metrics only for starting QBs
- Do NOT assume all players have NextGen data

**Best Practice:**
- Left join NextGen tables (not inner join)
- Handle NULLs gracefully
- Document when NextGen metrics unavailable

---

## Update Schedules

### Daily Updates

| Time (UTC) | Source | Job | Table(s) Updated |
|------------|--------|-----|------------------|
| 06:00 | Sleeper | Sleeper Ingestion | bronze_weekly_stats (sleeper) |
| 07:00 | ESPN | ESPN Ingestion | bronze_weekly_stats (espn_public) |
| 08:00 | Derived | Analytics Jobs | analytics_player_trends, analytics_positional_rankings |
| 08:00 | Export | R2 Export (GitHub Actions) | JSON files to Cloudflare R2 |

### Weekly Updates (Monday after games)

| Time (UTC) | Source | Job | Table(s) Updated |
|------------|--------|-----|------------------|
| 06:00 | ML Training | ML Training Orchestrator (Job 763487314454311) | Position-specific models |
| 12:00 | nflverse | nflverse Weekly Update | bronze_weekly_stats (nflverse), player_snap_counts, player_nextgen_stats |

### One-Time / Manual

| Source | Frequency | Method | Table(s) |
|--------|-----------|--------|----------|
| NFL Combine | Annual (Feb) | Manual CSV upload | player_combine_results |
| Fantasy Data Pros | One-time | Historical import | bronze_weekly_stats (fantasy_data_pros_historical) |

---

## Integration Guidelines

### When Building New Features

1. **Check this document first** - Understand what data is available before querying
2. **Verify coverage** - Confirm source has data for your target season/week
3. **Handle NULLs** - Not all sources have all fields (use coalesce/fallbacks)
4. **Respect limits** - Never query Sleeper API directly in notebooks
5. **Document gaps** - Note when expected data is unavailable

### Choosing a Data Source

**For current season (2025) stats:**
- Primary: Sleeper (most complete, real-time)
- Backup: ESPN (no limits, good coverage)
- Avoid: nflverse (404 errors)

**For advanced metrics (EPA, air yards, YAC):**
- Use: nflverse (2021-2024 only)
- Limitation: Not available for 2025

**For player photos/avatars:**
- Use: nflverse headshot_url (2021-2024)
- Limitation: NULL for 2025 players

**For snap counts:**
- Use: player_snap_counts table (nflverse source)
- Coverage: 2021-2025

**For combine metrics:**
- Use: player_combine_results
- Coverage: 2000-2025 draft classes

### Gold Layer Consolidation

The gold layer (`gold_weekly_stats`, `gold_player_dim`) unifies all sources:
- Master player ID across sources
- Single record per player-week
- Source priority: nflverse > Sleeper > ESPN > API-Sports
- Fantasy points calculated consistently

**Always use gold layer for analytics** unless you need source-specific fields.

---

## Quick Reference: Common Queries

### Get available seasons/weeks by source
```sql
SELECT 
    source,
    MIN(season) as earliest,
    MAX(season) as latest,
    COUNT(DISTINCT CONCAT(season, '-', week)) as coverage
FROM main.fantasai.bronze_weekly_stats
GROUP BY source;
```

### Check if a field exists in a source
```sql
SELECT stats
FROM main.fantasai.bronze_weekly_stats
WHERE source = 'nflverse'
LIMIT 1;
```

### Get latest data update timestamp
```sql
SELECT 
    source,
    MAX(ingested_at) as last_updated
FROM main.fantasai.bronze_weekly_stats
GROUP BY source;
```

### Find players with NextGen data
```sql
SELECT DISTINCT player_name, position
FROM main.fantasai.player_nextgen_stats
WHERE season = 2024;
```

### Check combine data availability
```sql
SELECT 
    draft_year,
    COUNT(*) as players_tested
FROM main.fantasai.player_combine_results
GROUP BY draft_year
ORDER BY draft_year DESC;
```

---

## Appendix: Source Contact & Documentation

### Sleeper API
- **Documentation:** https://docs.sleeper.com/
- **Rate Limit Info:** https://docs.sleeper.com/#rate-limiting
- **Status Page:** https://status.sleeper.com/

### ESPN Public API
- **Endpoints:** Undocumented (reverse-engineered)
- **Reliability:** High (public-facing)
- **No official docs**

### nflverse
- **GitHub:** https://github.com/nflverse/nflverse-data
- **Documentation:** https://nflverse.nflverse.com/
- **Data Releases:** https://github.com/nflverse/nflverse-data/releases
- **Status:** Check GitHub for 2025 data availability

### NFL Combine
- **Official Site:** https://www.nfl.com/combine/
- **Data Export:** Manual from NFL.com after each combine

---

**For complete system architecture, see:** `/Users/kingoffrisco@yahoo.com/FantasAI/ARCHITECTURE.md`  
**For job schedules and workflows, see:** ARCHITECTURE.md Section 5 (Job Schedules)
