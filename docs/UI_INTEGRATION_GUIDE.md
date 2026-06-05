# FantasAI UI Integration Guide

**Last Updated:** June 4, 2026  
**Status:** ✅ Production Ready  
**Database:** Databricks Unity Catalog (main.fantasai)

---

## 📋 Quick Start

### Primary Table: 2026 Players

Use **`main.fantasai.players_2026_draft`** as your main player source for the 2026 fantasy draft season.

**Key Stats:**
- **1,631 total players** (1,338 draftable)
- **Positions:** QB, RB, WR, TE
- **Coverage:** Active 2024-2025 NFL players
- **Updates:** Weekly during season

---

## 🔑 Critical Implementation Rules

### 1. Always Filter by `is_draftable`
```sql
WHERE is_draftable = TRUE  -- Removes retired/inactive players (293 filtered)
```

### 2. Default Sort by ML Predictions
```sql
ORDER BY projected_avg_points DESC  -- Most accurate ranking
```

### 3. Use "2026 Players" Label
Replace all UI labels like "active players" or "current players" with **"2026 Players"**

### 4. Handle Nulls Gracefully
- Combine data missing for ~60% of players (older players pre-draft)
- Predictions missing for players with limited playing time
- Use `COALESCE()` or hide missing values

---

## 📊 Table Reference

### 🏈 Table 1: players_2026_draft

**Full Name:** `main.fantasai.players_2026_draft`  
**Size:** 139 KB | 1,631 rows  
**Purpose:** Draft player list, rankings, search, filtering

#### Key Columns

| Column | Type | Purpose | Notes |
|--------|------|---------|-------|
| `master_player_id` | STRING | Unique player identifier | Primary key |
| `player_name` | STRING | Display name | e.g., "Patrick Mahomes" |
| `position` | STRING | QB/RB/WR/TE | Filter value |
| `current_team` | STRING | Team abbreviation | e.g., "KAN", "TAM" |
| `is_draftable` | BOOLEAN | ⚠️ CRITICAL filter | TRUE = active, FALSE = retired |
| `player_status` | STRING | Human-readable status | "Active 2025" (best) to "Limited 2024 Activity" |
| `projected_avg_points` | DOUBLE | ML prediction | Best for rankings |
| `season_avg_points` | DOUBLE | Historical average | Last season actual |
| `recent_3game_avg` | DOUBLE | Last 3 games | Recent form |
| `recent_5game_avg` | DOUBLE | Last 5 games | Consistency |
| `position_rank` | INTEGER | Within-position rank | 1 = best at position |
| `season_percentile` | DOUBLE | 0-100 percentile | Higher = better |
| `season_tier` | STRING | Elite/High/Mid/Low | Badge/color coding |
| `projected_ceiling` | DOUBLE | Best-case projection | Max predicted points |
| `combine_height` | DOUBLE | Height (inches) | ~40% coverage |
| `combine_weight` | DOUBLE | Weight (pounds) | ~40% coverage |
| `combine_40_time` | DOUBLE | 40-yard dash | ~40% coverage |
| `athleticism_composite` | DOUBLE | Overall athleticism | Composite score |
| `speed_score` | DOUBLE | Speed rating | Normalized metric |
| `years_in_nfl` | INTEGER | Experience | 0 = rookie |
| `is_rookie_eligible` | BOOLEAN | Rookie filter | <= 1 year |
| `nfl_draft_year` | INTEGER | NFL draft year | e.g., 2020 |
| `fantasy_draft_year` | INTEGER | Always 2026 | Constant |
| `last_updated` | TIMESTAMP | Data freshness | Last refresh |

#### Example Queries

**Get all draftable players (ranked):**
```sql
SELECT 
  player_name,
  position,
  current_team,
  projected_avg_points,
  position_rank,
  season_tier
FROM main.fantasai.players_2026_draft
WHERE is_draftable = TRUE
ORDER BY projected_avg_points DESC
LIMIT 100;
```

**Search players by name (autocomplete):**
```sql
SELECT 
  master_player_id,
  player_name,
  position,
  current_team,
  projected_avg_points,
  player_status
FROM main.fantasai.players_2026_draft
WHERE is_draftable = TRUE
  AND LOWER(player_name) LIKE LOWER('%mahomes%')
ORDER BY projected_avg_points DESC
LIMIT 10;
```

**Filter by position (e.g., QBs only):**
```sql
SELECT 
  player_name,
  current_team,
  projected_avg_points,
  position_rank,
  season_tier,
  recent_3game_avg
FROM main.fantasai.players_2026_draft
WHERE is_draftable = TRUE
  AND position = 'QB'
ORDER BY projected_avg_points DESC;
```

**Get player detail card:**
```sql
SELECT *
FROM main.fantasai.players_2026_draft
WHERE master_player_id = '<player_id>';
```

**Rookies only:**
```sql
SELECT 
  player_name,
  position,
  current_team,
  projected_avg_points,
  years_in_nfl
FROM main.fantasai.players_2026_draft
WHERE is_draftable = TRUE
  AND is_rookie_eligible = TRUE
ORDER BY projected_avg_points DESC;
```

---

### 📈 Table 2: ml_weekly_predictions

**Full Name:** `main.fantasai.ml_weekly_predictions`  
**Size:** 826 KB | 24,862 rows  
**Purpose:** In-season weekly projections, start/sit recommendations

#### Key Columns

| Column | Type | Purpose |
|--------|------|---------|
| `master_player_id` | STRING | Join to players_2026_draft |
| `player_name` | STRING | Display name |
| `position` | STRING | QB/RB/WR/TE |
| `season` | INTEGER | 2024, 2025, etc. |
| `week` | INTEGER | Week number (1-18) |
| `predicted_next_week_points` | DOUBLE | ML prediction for this week |
| `target_next_week_points` | DOUBLE | Actual points (after game) |
| `prediction_generated_at` | TIMESTAMP | When prediction was made |

#### Example Query

**Get week 18 projections:**
```sql
SELECT 
  pred.player_name,
  pred.position,
  d.current_team,
  pred.predicted_next_week_points,
  d.season_avg_points as season_avg
FROM main.fantasai.ml_weekly_predictions pred
JOIN main.fantasai.players_2026_draft d 
  ON pred.master_player_id = d.master_player_id
WHERE pred.season = 2024 
  AND pred.week = 18
  AND d.is_draftable = TRUE
ORDER BY pred.predicted_next_week_points DESC
LIMIT 50;
```

---

### 🧠 Table 3: ml_feature_importance

**Full Name:** `main.fantasai.ml_feature_importance`  
**Purpose:** Model explainability, "Why this prediction?" tooltips

#### Key Columns

| Column | Type | Purpose |
|--------|------|---------|
| `feature` | STRING | Feature name |
| `importance_pct` | DOUBLE | % contribution to predictions |
| `model_position` | STRING | QB/RB/WR/TE |

#### Top Features

1. **wow_change** (23%) - Week-over-week performance change (momentum)
2. **rolling_3g_avg** (22%) - Last 3 games average (recent form)
3. **rolling_5g_stddev** (6%) - Consistency metric

**Use for tooltips:** "This prediction is based primarily on recent momentum (23%) and 3-game average (22%)"

---

### 📊 Table 4: ml_player_features

**Full Name:** `main.fantasai.ml_player_features`  
**Size:** 162,896 rows | 70 features  
**Purpose:** Advanced analytics, historical analysis, power user exports

**⚠️ WARNING:** Large table - always use WHERE clauses!

---

## ⚡ Performance & Optimization

### R2 Storage Enabled

All tables configured with:
- ✅ Auto Optimize (automatic compaction)
- ✅ Auto Compaction (merge small files)
- ✅ Z-Ordering (physical clustering)
- ✅ Predictive Optimization (intelligent caching)

### Expected Query Performance

| Query Type | Expected Latency |
|------------|------------------|
| Player search (by name) | < 100ms |
| Position filter (QBs) | < 50ms |
| Top 100 rankings | < 200ms |
| Player detail lookup | < 20ms |
| Weekly predictions | < 300ms |

### Query Best Practices

1. **Always filter by `is_draftable`** - reduces dataset by 18%
2. **Use indexed columns** - position, master_player_id, is_draftable
3. **Limit result sets** - use `LIMIT` for paginated lists
4. **Cache hot queries** - top 100 rankings, position filters
5. **Batch lookups** - use `IN` clause for multiple player IDs

---

## 🔄 Data Refresh Strategy

### During Season

| Table | Refresh Frequency | When |
|-------|------------------|------|
| `players_2026_draft` | Weekly | Monday mornings |
| `ml_weekly_predictions` | Weekly | Before each game week |
| `ml_feature_importance` | Monthly | After model retraining |
| `ml_player_features` | Weekly | Monday mornings |

### Off-Season

- **players_2026_draft:** Monthly (roster changes)
- **ml_weekly_predictions:** N/A (no games)
- **ml_feature_importance:** Quarterly
- **ml_player_features:** Monthly

---

## 🎨 UI Design Guidance

### Player Status Badges

```
"Active 2025"              → 🟢 Green badge (safe to draft)
"Active 2024 Late Season"  → 🟡 Yellow badge (likely active)
"Active 2024 Mid Season"   → 🟠 Orange badge (verify status)
"Limited 2024 Activity"    → 🔴 Red badge (avoid)
```

### Season Tier Colors

```
"Elite" → 🟣 Purple or Gold
"High"  → 🔵 Blue
"Mid"   → 🟢 Green
"Low"   → ⚪ Gray
```

### Position Rank Display

```
Position Rank 1-10:   Show as "Top 10 <Position>"
Position Rank 11-25:  Show rank number
Position Rank 26+:    Show percentile instead
```

---

## 🚨 Common Pitfalls to Avoid

### ❌ Don't Do This

1. **Query without `is_draftable` filter**
   - Returns 293 inactive players
   
2. **Sort by `season_avg_points` only**
   - Use `projected_avg_points` for forward-looking rankings
   
3. **Assume combine data exists**
   - ~60% of players missing combine metrics (pre-draft era)
   
4. **Query `ml_player_features` without WHERE**
   - 162K rows will slow UI

5. **Hard-code team names**
   - Use `current_team` from table (handles trades)

### ✅ Do This Instead

1. **Always filter:** `WHERE is_draftable = TRUE`
2. **Prefer ML predictions:** `ORDER BY projected_avg_points DESC`
3. **Handle nulls:** `COALESCE(combine_height, 0)` or hide in UI
4. **Filter large tables:** Add season, position, player_id filters
5. **Dynamic team display:** Use live `current_team` value

---

## 📞 Technical Details

### Database Connection

- **Platform:** Databricks Unity Catalog
- **Catalog:** `main`
- **Schema:** `fantasai`
- **Endpoint:** Databricks SQL Warehouse
- **Authentication:** Service principal or user token

### API Options

1. **Databricks SQL Connector (Python)**
   ```python
   from databricks import sql
   
   connection = sql.connect(
       server_hostname=os.getenv("DATABRICKS_SERVER_HOSTNAME"),
       http_path=os.getenv("DATABRICKS_HTTP_PATH"),
       access_token=os.getenv("DATABRICKS_TOKEN")
   )
   ```

2. **REST API**
   - Use SQL Statement API
   - Endpoint: `/api/2.0/sql/statements`

3. **JDBC/ODBC**
   - Standard Databricks connectors

---

## 📚 Additional Resources

### Related Documentation

- **Pipeline Documentation:** `/Repos/kingoffrisco@yahoo.com/FantasAI/notebooks/03_ML_Training/`
- **Model Registry:** Unity Catalog models under `main.fantasai.player_performance_predictor_*`
- **Job Orchestrator:** Job ID `763487314454311`

### Model Details

| Position | Model ID | Version | Experiment |
|----------|----------|---------|------------|
| QB | `main.fantasai.player_performance_predictor_qb` | v1 | fantasai_weekly_predictions |
| RB | `main.fantasai.player_performance_predictor_rb` | v1 | fantasai_weekly_predictions |
| WR | `main.fantasai.player_performance_predictor_wr` | v1 | fantasai_weekly_predictions |
| TE | `main.fantasai.player_performance_predictor_te` | v1 | fantasai_weekly_predictions |

### Model Performance

- **QB:** RMSE=4.92, MAE=2.73, R²=0.776
- **RB/WR/TE:** Similar performance metrics

---

## ✅ Production Readiness Checklist

- [x] Tables created and optimized
- [x] R2 storage enabled (auto-optimization)
- [x] Z-ordering applied for query performance
- [x] 2026 player list filtered (1,338 draftable)
- [x] ML predictions generated (24,862 rows)
- [x] Feature importance documented
- [x] Query patterns tested
- [x] Performance validated (< 300ms)
- [x] Data refresh strategy defined
- [x] UI integration guide complete

---

## 🎯 Summary

**Your UI should:**
1. Query `main.fantasai.players_2026_draft` for all player data
2. Always filter by `is_draftable = TRUE`
3. Sort by `projected_avg_points` for rankings
4. Label everything as "2026 Players"
5. Handle nulls in combine metrics gracefully
6. Expect sub-second query performance
7. Refresh data weekly during season

**Questions?** Contact: kingoffrisco@yahoo.com

---

**Document Version:** 1.0  
**Last Modified:** June 4, 2026  
**Next Review:** Start of 2026 NFL Season
