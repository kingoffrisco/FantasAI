# FantasAI UI Integration Guide

**Last Updated:** June 9, 2026  
**Status:** ✅ Production Ready  
**Database:** Databricks Unity Catalog (main.fantasai)

---

## ⚠️ Data Source Rules

**ALWAYS consume from Export tables. NEVER from Bronze or Silver:**

| Layer | Tables | Status |
|-------|--------|--------|
| ✅ USE | `main.fantasai.export_*` | Filtered, enriched, frontend-optimized |
| ❌ AVOID | `main.fantasai.bronze_*` | Raw dumps — nulls, duplicates, untrusted |
| ❌ AVOID | `main.fantasai.silver_*` | Internal operational data — incomplete joins, sensitive fields |

**Why it matters:**

| Aspect | `silver_player_news` ❌ | `export_player_news` ✅ |
|--------|------------------------|------------------------|
| Rows | 242 (everything) | 86 (filtered to relevant) |
| Columns | 11 (operational) | 15 (frontend-optimized) |
| AI Summary | No | Yes (`summary_text`) |
| Fantasy Insight | No | Yes (`fantasy_insight`) |
| Impact Score | No | Yes (`impact_score`) |
| Source | Bronze → Silver | Gold → Export |

**Correct ETL flow:**
```
Bronze (raw APIs) → Silver (cleaned) → Gold (enriched) → Export (frontend snapshots) → R2 (gzipped JSON) → Frontend
```

**Frontend-ready Export tables:**

| Table | Records | Purpose |
|-------|---------|---------|
| `export_players_2026_draft` | 997 | Draft board with tiers/rankings — all active, all draftable |
| `export_player_news` | 86 articles | AI-enriched news with fantasy insights |
| `export_defense_performance` | 606 | Weekly matchup rankings |
| `export_breakout_candidates` | 7 | ML-powered sleeper picks |
| `export_sleeper_picks` | 24 | High-value waiver targets |

---

## 📋 Quick Start

### Primary Table: 2026 Players

Use **`export_players_2026_draft`** (via R2 / Worker API) as your main player source for the 2026 fantasy draft season.

> **Data Access:** Frontend reads R2 snapshots via `api.fantasai.net/api/v1/db/players` — direct Databricks queries are not used in production.

**Key Stats:**
- **997 total players** (all have `isDraftable: true` — retired players removed June 12, 2026)
- **Positions:** QB(124), RB(198), WR(391), TE(204), K(43), FB(5), DEF(32)
- **Coverage:** Active 2026 NFL players
- **Updates:** Daily R2 export at 08:00 UTC

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

### 🏈 Table 1: export_players_2026_draft

**Full Name:** `main.fantasai.export_players_2026_draft`  
**R2 Access:** `GET api.fantasai.net/api/v1/db/players` (source: `databricks`, table: `export_players_2026_draft`)  
**Records:** 997 (all `isDraftable: true` — retired players removed June 12, 2026)  
**Purpose:** Draft board, player lists, rankings, search

#### Live R2 Field Schema (camelCase)

| Field | Type | Notes |
|--------|------|-------|
| `playerId` | string | Unique player identifier |
| `name` | string | Display name e.g. "Patrick Mahomes" |
| `position` | string | QB / RB / WR / TE / K / DEF / FB |
| `team` | string | 3-letter team code e.g. "KC", "PHI" |
| `proj` | number \| null | Projected fantasy points |
| `avg` | string | Season average (e.g. "22.5") |
| `last` | string | Last game score |
| `trend` | string | JSON array of 6 recent scores e.g. `["22","18","24","0","0","0"]` |
| `positionRank` | number \| null | Within-position rank |
| `percentile` | number \| null | 0–100 percentile vs position peers |
| `tier` | string | "Elite" / "High" / "Mid" / "Low" / "Unproven" |
| `isDraftable` | string | `"true"` for all 997 records |
| `status` | string | "Active", "Injured", "Questionable" |
| `lastSeasonPlayed` | string | e.g. "2025" |
| `experience` | string | Years in NFL e.g. "3" |
| `isRookie` | string | `"true"` or `"false"` |

> **Note:** ADP is not yet in this table. It is a planned addition to the ETL pipeline.

#### Example Queries

**Fetch all 997 draftable players (via Worker API):**
```js
const res = await fetch('https://api.fantasai.net/api/v1/db/players');
const { source, table, count, players } = await res.json();
// source: "databricks", table: "export_players_2026_draft", count: 997
```

**Filter by position (client-side):**
```js
const qbs = players.filter(p => p.position === 'QB');
const ranked = [...players].sort((a, b) => (b.proj ?? 0) - (a.proj ?? 0));
```

**Search by name:**
```js
const results = players.filter(p =>
  p.name.toLowerCase().includes(query.toLowerCase())
);
```

**Rookies only:**
```js
const rookies = players.filter(p => p.isRookie === 'true');
```

**If querying Databricks directly** (internal tooling only — not frontend):
```sql
SELECT * FROM main.fantasai.export_players_2026_draft LIMIT 2500;
-- All 997 rows have isDraftable = 'true'
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
