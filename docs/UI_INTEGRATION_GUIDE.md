# FantasAI UI Integration Guide

**Last Updated:** August 27, 2026
**Status:** ✅ Production Ready
**Data Store:** Cloudflare R2 (primary) — see correction below

> **Correction (2026-08-27):** This guide originally described Databricks Unity Catalog as "the Database" and `GET /api/v1/db/players` as the primary read path. That's no longer accurate. Databricks was decommissioned on 2026-06-15 (see [ARCHITECTURE.md](../ARCHITECTURE.md)). **Cloudflare R2 is the primary data store.** `/api/v1/db/players` still exists in `worker-api`, but only as a narrow last-resort fallback behind an R2 read — its status (whether Databricks credentials are even still provisioned) is unconfirmed. Table/record-count details below reflect the original Databricks-era export tables; the equivalent data now lives in R2 as JSON (see [DATA_SCHEMAS.md](./DATA_SCHEMAS.md) for current shapes) and record counts have drifted since.

---

## ⚠️ Data Source Rules

**Always consume the R2-backed JSON exports. Treat the legacy `/api/v1/db/*` routes as fallback-only:**

| Source | Status |
|-------|--------|
| ✅ USE | `GET /api/v1/r2/{key}` (e.g. `fantasai/players/export_players_2026_draft.json`) — primary, local-pipeline-backed |
| ⚠️ FALLBACK ONLY | `GET /api/v1/db/players`, `/api/v1/db/tables`, `/api/v1/news/ai-summaries`, `/api/v1/opportunity/rankings` — still issue a live Databricks SQL Warehouse query behind an R2 primary; prefer the R2 equivalent |

**Frontend-facing R2 exports (formerly the Export-table layer):**

| Data | R2 Key | Purpose |
|-------|---------|---------|
| Draft board | `fantasai/players/export_players_2026_draft.json` | Draft board with tiers/rankings — all active, all draftable |
| Player news | `fantasai/analysis/player_news.json` (falls back to `fantasai/news/enriched_news.json`) | AI-enriched news with fantasy insights |
| Defense performance | `fantasai/analysis/defense_performance.json` | Weekly matchup rankings |
| Breakout candidates | `fantasai/analysis/breakout_candidates.json` | ML/LLM-powered sleeper picks |
| Sleeper picks | part of `fantasai/analysis/player_scores.json` (Job 2) | High-value waiver targets |

Full current key list: [DATA_SCHEMAS.md](./DATA_SCHEMAS.md) and [API_ENDPOINTS.md](./API_ENDPOINTS.md).

**Current data flow:**
```
nflverse / Sleeper / CBS / CFBD / news sources → local DuckDB (Bronze → Silver → Gold)
  → local Qwen enrichment (Jobs 1-5) → R2 (JSON) → worker-api → Frontend
```

---

## 📋 Quick Start

### Primary Table: 2026 Players

Use **`export_players_2026_draft`** (via R2 / Worker API) as your main player source for the 2026 fantasy draft season.

> **Data Access:** Frontend reads the R2 snapshot directly via `GET api.fantasai.net/api/v1/r2/fantasai/players/export_players_2026_draft.json`. `GET /api/v1/db/players` still exists but is a last-resort fallback only, behind this R2 read — don't build new code against it as the primary source.

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

**Origin table (local DuckDB, pre-export):** `export_players_2026_draft`
**Primary R2 Access:** `GET api.fantasai.net/api/v1/r2/fantasai/players/export_players_2026_draft.json`
**Fallback (last-resort, unconfirmed live):** `GET api.fantasai.net/api/v1/db/players` — still queries the old Databricks SQL Warehouse
**Records:** ~997 as of the original count (all `isDraftable: true`); verify current count via the live R2 payload since it refreshes daily  
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

**Fetch draftable players (via Worker API, R2-backed — recommended):**
```js
const res = await fetch('https://api.fantasai.net/api/v1/r2/fantasai/players/export_players_2026_draft.json');
const { data: players } = await res.json();
```

**Legacy fallback (unconfirmed live, avoid in new code):**
```js
const res = await fetch('https://api.fantasai.net/api/v1/db/players');
const { source, table, count, players } = await res.json();
// source: "databricks" — only reached if the R2 read above fails
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

### 📈 Weekly Predictions / Start-Sit — Current Equivalent

> **Correction (2026-08-27):** The original Tables 2-4 here (`ml_weekly_predictions`, `ml_feature_importance`, `ml_player_features`) described a Databricks-trained, position-specific XGBoost model registry that no longer exists — it was decommissioned along with the rest of Databricks on 2026-06-15. There is no ML model registry or feature-importance table in the current system. The equivalent functionality is now produced by the local Qwen pipeline instead of trained ML models:

| Need | Current source |
|---|---|
| Weekly projections / start-sit | `fantasai/analysis/weekly_startsit.json` (Job 4, hybrid deterministic score + Qwen3 14B for borderline calls) |
| Player scoring (waiver/trade/dynasty/matchup) | `fantasai/analysis/player_scores.json` (Job 2, Qwen3 14B, 9-dimension scoring) |
| "Why this prediction?" style reasoning | `fantasai/analysis/deep_reasoning.json` (Job 5, Qwen3 30B — narrative reasoning, not a feature-importance table; covers only the weekly top-slice, not the full pool) |

There is no `is_draftable`-style SQL filtering step for these — each is a flat JSON array fetched via `/api/v1/r2/{key}`; filter/sort client-side.

---

## ⚡ Performance & Caching

R2 objects served via `/api/v1/r2/{key}` generally carry `Cache-Control: public, max-age=3600`. There is no query engine or indexing layer in front of these files — the frontend fetches the JSON snapshot and filters/sorts client-side.

### Query/Filter Best Practices

1. **Always filter by `isDraftable`** when working with the draft board — the export always contains only draftable players, but new fields may not
2. **Limit result sets client-side** for large payloads (`fantasai/stats/gold_weekly_stats.json` is ~50-100MB — don't fetch eagerly)
3. **Cache hot fetches in the frontend** (top rankings, position filters) rather than re-fetching the same R2 key repeatedly

---

## 🔄 Data Refresh Strategy

Refresh cadence varies per export — see [ARCHITECTURE.md → Job Schedules](../ARCHITECTURE.md#job-schedules) for the authoritative per-job schedule. Rough guide:

| Export | Refresh Frequency | When |
|-------|------------------|------|
| Draft board (`export_players_2026_draft.json`) | Daily | 08:00 UTC via orchestrator |
| Weekly start/sit | Weekly | Sunday 2:30 AM |
| Deep reasoning | Weekly | Wednesday 1:30 AM |
| Player scores | Daily (after Job 1) | ~7 AM |

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

### Data Access

- **Primary store:** Cloudflare R2 (bucket `fantasai-r2`, bound as `env.BUCKET` in `worker-api`)
- **Access pattern:** `GET https://api.fantasai.net/api/v1/r2/{key}` — no query engine, no auth for most reads
- **Local warehouse (not directly reachable from the frontend):** DuckDB, `local_processing/db/fantasai.duckdb`
- **Legacy fallback only:** `GET /api/v1/db/players` still issues a Databricks SQL Warehouse query via `queryDatabricks()` in `worker-api/src/index.js`, gated behind `DATABRICKS_HOST`/`DATABRICKS_TOKEN`/`DATABRICKS_WAREHOUSE_ID` secrets whose current validity is unconfirmed

### API Options

1. **R2 passthrough (recommended):**
   ```js
   const res = await fetch('https://api.fantasai.net/api/v1/r2/fantasai/players/export_players_2026_draft.json');
   const { data } = await res.json();
   ```
2. **Local DuckDB (internal tooling only, not reachable from the deployed frontend):**
   ```python
   import duckdb
   conn = duckdb.connect('local_processing/db/fantasai.duckdb')
   conn.execute("SELECT * FROM export_players_2026_draft LIMIT 50").fetchall()
   ```

---

## 📚 Additional Resources

- **Architecture:** [ARCHITECTURE.md](../ARCHITECTURE.md) — canonical system reference
- **Endpoint list:** [API_ENDPOINTS.md](./API_ENDPOINTS.md)
- **JSON shapes:** [DATA_SCHEMAS.md](./DATA_SCHEMAS.md)
- **Local pipeline jobs:** `local_processing/job1_news_processor.py` through `job5_deep_reasoner.py` (Qwen3 8B/14B/30B via Ollama) — there is no separate ML model registry; scoring/prediction logic lives in these jobs

---

## ✅ Production Readiness Checklist

- [x] Local DuckDB pipeline replacing Databricks (migrated 2026-06-15)
- [x] R2 exports live and serving the frontend
- [x] Draft board filtered to draftable players
- [x] Weekly start/sit + player scoring produced by Jobs 2/4 (Qwen3 14B)
- [x] Deep reasoning produced by Job 5 (Qwen3 30B, weekly top-slice)
- [ ] Legacy `/api/v1/db/*` and `/api/v1/news/ai-summaries` routes — Databricks connectivity unconfirmed, don't rely on them

---

## 🎯 Summary

**Your UI should:**
1. Fetch `fantasai/players/export_players_2026_draft.json` via `/api/v1/r2/{key}` for player data — not `/api/v1/db/players`
2. Filter/sort client-side (`isDraftable`, position, projected points)
3. Label everything as "2026 Players"
4. Handle nulls in combine metrics and deep-reasoning fields gracefully (deep reasoning only covers ~top slice of players/week)
5. Respect each export's own refresh cadence rather than assuming uniform daily/weekly

**Questions?** Contact: kingoffrisco@yahoo.com

---

**Document Version:** 2.0
**Last Modified:** August 27, 2026
**Next Review:** As architecture changes further
