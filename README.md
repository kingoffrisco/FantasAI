# FantasAI - Fantasy Football Analytics Platform

**Last Updated:** June 7, 2026  
**Platform:** Databricks on AWS  
**Unity Catalog:** `main.fantasai` (79 tables, 21 quota remaining)

---

## 📚 Documentation

* **[ARCHITECTURE.md](./ARCHITECTURE.md)** - Complete system architecture, data pipeline, job schedules
* **[docs/API_ENDPOINTS.md](./docs/API_ENDPOINTS.md)** - R2 API endpoint reference (11 endpoints)
* **[docs/DATA_SCHEMAS.md](./docs/DATA_SCHEMAS.md)** - Detailed data schemas and field definitions

---

## 🚀 Quick Start

### Frontend Developers

All data is served via **Cloudflare R2** (S3-compatible):

```javascript
// Fetch combined player news with AI summaries
const response = await fetch(
  'https://r2.yourdomain.com/fantasai/analysis/player_news.json'
);
const { data } = await response.json();
// 86 articles with 3 timestamps each
```

**Key Endpoint:** `fantasai/analysis/player_news.json` ⭐  
Combines news + AI analysis with three-timestamp tracking:
* `published_at` - Original article time
* `enriched_at` - Processing time
* `ai_generated_at` - AI summary creation time

See [API_ENDPOINTS.md](./docs/API_ENDPOINTS.md) for all 11 endpoints.

---

### Data Engineers

**Unity Catalog Schema:** `main.fantasai`

**Medallion Architecture:**
```
Bronze (Raw) → Silver (Cleaned) → Gold (Enriched) → Export (R2)
```

**Key Tables:**
```sql
-- Combined news for export
SELECT * FROM main.fantasai.export_player_news LIMIT 10;

-- Draft-ready players
SELECT * FROM main.fantasai.draft_ready_roster_2026 
WHERE season_total_points_2025 > 150
ORDER BY season_total_points_2025 DESC;

-- Weekly stats (583K records)
SELECT * FROM main.fantasai.gold_weekly_stats
WHERE season = 2025 AND week = 18;
```

**Scheduled Jobs:**
* News Export: Daily 08:00 UTC ([Job #533461232082366](https://dbc-60fb4a1c-8bce.cloud.databricks.com/jobs/533461232082366))
* Analysis Export: Daily 08:30 UTC ([Job #848536035023585](https://dbc-60fb4a1c-8bce.cloud.databricks.com/jobs/848536035023585))

See [ARCHITECTURE.md](./ARCHITECTURE.md) for complete job schedules and dependencies.

---

## 📊 System Overview

### Data Sources
* **Sleeper API** - Fantasy stats, rosters (1,000/day limit)
* **ESPN API** - Player projections, stats (no limit)
* **nflverse** - Official NFL play-by-play, weekly stats
* **NFL Combine** - Athletic metrics (7,195 players)

### Pipeline
```
Data Sources → Bronze Layer → Silver Layer → Gold Layer
     │                                              │
     └───────────── AI Analysis (GPT-4) ───────┘
                            │
                    Export Tables
                            │
                    Cloudflare R2
                            │
                     Frontend UI
```

### Features
* ✅ **AI-Powered News** - GPT-4 summaries with fantasy insights
* ✅ **Three-Timestamp System** - Published/enriched/AI generation times
* ✅ **ML Predictions** - Breakout candidates, sleeper picks, defense projections
* ✅ **Automated Exports** - Daily R2 uploads at 08:00 & 08:30 UTC
* ✅ **4,823 Draft Players** - Complete 2026 roster with combine data

---

## 🔄 Recent Updates

### June 7, 2026

#### Added
* ✅ Combined player news endpoint (`fantasai/analysis/player_news.json`)
* ✅ Three-timestamp system for all news articles
* ✅ Automated R2 export jobs (Databricks-native, replacing GitHub Actions)
* ✅ Complete API and schema documentation

#### Fixed
* ✅ Timestamp serialization (`default=str` in all exports)
* ✅ Compute configuration (Serverless CPU for exports)
* ✅ boto3 installation in export notebooks

#### Removed
* ✅ Deprecated `fantasai_news` schema (freed 3 tables)
* ✅ 7 unused tables (total: 10 tables freed, 21 quota remaining)
* ✅ Old draft prediction tables

---

## 🛠️ Tech Stack

* **Data Platform:** Databricks (Unity Catalog)
* **Compute:** Serverless Spark
* **AI/ML:** OpenAI GPT-4, XGBoost, LightGBM
* **Storage:** Cloudflare R2 (S3-compatible)
* **Languages:** Python, SQL
* **Orchestration:** Databricks Jobs

---

## 📞 Resources

* **Databricks Workspace:** https://dbc-60fb4a1c-8bce.cloud.databricks.com
* **Unity Catalog:** `main.fantasai` (79 tables)
* **Git Repository:** `/Repos/kingoffrisco@yahoo.com/FantasAI/`
* **Working Directory:** `/Users/kingoffrisco@yahoo.com/FantasAI/`

---

**Maintained by:** FantasAI Data Team  
**Next Review:** July 7, 2026