# Human-in-the-Loop & User Settings Integration Guide

**Last Updated:** June 8, 2026
**Status:** ✅ Ready for Implementation

> **⚠️ Not re-verified August 22, 2026.** This doc's data flow ends in Databricks Bronze/Gold tables (`bronze_article_labels`, `gold_player_mapping_corrections`) and ML retraining. Per [ARCHITECTURE.md](../ARCHITECTURE.md)'s June 15, 2026 migration, most Databricks dependencies were removed — but the worker-api route `POST /api/v1/feedback/vote` still carries a code comment claiming "Databricks ingests these nightly," which was not confirmed live in the August audit. The R2-facing steps below (frontend → Worker API → `fantasai/labeling/article_labels.json`) are still accurate; treat everything downstream of R2 in this doc (Databricks bronze/gold ingestion, retraining) as unconfirmed until checked directly.

---

## 🎯 Overview

Two new systems have been integrated into FantasAI:

1. **Article Labeling Feedback System** (Human-in-the-Loop) - Commissioners correct pipeline mistakes
2. **User Settings Persistence** - Cross-browser/device preference storage

---

## 📊 Article Labeling Feedback System

### Purpose
Allow commissioners to correct player name extraction errors, providing high-quality training data for ML model improvement.

### Data Flow

```
Frontend UI (Commissioner Labels Article)
    ↓
Worker API (POST /labeling/article)
    ↓
R2 Storage (fantasai/labeling/article_labels.json)
    ↓
Databricks Bronze Layer (bronze_article_labels)
    ↓
Databricks Gold Layer (gold_player_mapping_corrections)
    ↓
ML Model Retraining (player_name_extractor)
```

### Tables Created

#### 1. `main.fantasai.bronze_article_labels`
**Purpose:** Raw ingestion of all labeled articles  
**Refresh:** Hourly (or on-demand)  
**Records:** All labels (including non-corrections)

**Key Columns:**
- `label_id` - Unique identifier
- `article_url` - Deduplication key
- `original_player_name` - Pipeline's guess (may be wrong)
- `labeled_player_name` - Commissioner's correction (ground truth)
- `relevance_score` - 1-5 rating
- `is_relevant` - Fantasy relevance flag

#### 2. `main.fantasai.gold_player_mapping_corrections`
**Purpose:** High-quality training examples (corrections only)  
**Refresh:** After bronze ingestion  
**Records:** Only where original != labeled AND is_relevant = true AND relevance_score >= 3

**Use Case:** Training data for ML model

### Notebooks Created

1. **Bronze Ingestion:**  
   `/Repos/.../databricks/Notebook/01_Ingestion/Bronze/article_labeling_feedback_ingestion.py`
   - Reads from R2 bucket
   - Writes to `bronze_article_labels`
   - Handles deduplication by `label_id`
   - Mode: INCREMENTAL (merge) or FULL_REFRESH

2. **Gold Corrections:**  
   `/Repos/.../databricks/Notebook/01_Ingestion/Gold/gold_player_mapping_corrections.py`
   - Filters for corrections only
   - Applies quality filters (relevance >= 3)
   - Writes to `gold_player_mapping_corrections`

### How to Use This Data

#### Query Corrections for ML Training

```sql
-- Get all player name corrections
SELECT 
    headline,                    -- Model input (article text)
    original_player_name,        -- Model prediction
    labeled_player_name,         -- Ground truth (target)
    publisher,
    relevance_score
FROM main.fantasai.gold_player_mapping_corrections
WHERE player_name_corrected = true
ORDER BY relevance_score DESC;
```

#### Identify Common Mistakes

```sql
-- Most commonly corrected players
SELECT 
    original_player_name,
    labeled_player_name,
    COUNT(*) as correction_count
FROM main.fantasai.gold_player_mapping_corrections
WHERE player_name_corrected = true
GROUP BY original_player_name, labeled_player_name
ORDER BY correction_count DESC
LIMIT 20;
```

#### ML Model Training Pattern

```python
# Load corrections as training data
corrections_df = spark.table("main.fantasai.gold_player_mapping_corrections")

# Filter for player name corrections
training_data = corrections_df.filter(
    F.col("player_name_corrected") == True
).select(
    "headline",                  # Feature: Article text
    "publisher",                 # Feature: News source
    "original_player_name",      # What model predicted
    "labeled_player_name"        # What it should have predicted
)

# Train model
# model.fit(X=features, y=labeled_player_name)
```

---

## 👤 User Settings Persistence

### Purpose
Store user preferences (draft settings, UI layout, notifications) for cross-browser/device consistency.

### Table Schema

**Table:** `main.fantasai.user_settings`

**Key Columns:**
- `user_id` (PK) - User email or auth ID
- `setting_category` (PK) - draft_preferences, ui_layout, notifications, league_settings
- `setting_key` (PK) - Specific setting name
- `setting_value` - JSON-encoded value
- `updated_at` - Last modified timestamp

### Setting Categories

#### 1. Draft Preferences
```json
{
  "scoring_format": "PPR",
  "roster_size": 15,
  "flex_positions": ["RB/WR/TE"],
  "draft_timer": 90
}
```

#### 2. UI Layout
```json
{
  "view_mode": "grid",
  "column_order": ["name", "position", "team", "proj"],
  "active_filters": {"position": ["QB", "RB"]},
  "theme": "dark",
  "sidebar_collapsed": false
}
```

#### 3. Notifications
```json
{
  "waiver_alerts": true,
  "injury_alerts": true,
  "start_sit_reminders": false,
  "email_frequency": "daily"
}
```

#### 4. League Settings
```json
{
  "default_league_id": "12345",
  "favorite_players": ["player_123", "player_456"],
  "watch_list": ["player_789"]
}
```

### API Endpoints

#### GET User Settings
```http
GET /api/v1/user/{user_id}/settings?category=ui_layout

Response:
{
  "user_id": "user@example.com",
  "settings": [
    {
      "category": "ui_layout",
      "key": "view_mode",
      "value": "grid",
      "updated_at": "2026-06-08T12:00:00Z"
    }
  ]
}
```

#### PUT User Settings
```http
PUT /api/v1/user/{user_id}/settings

Body:
{
  "category": "draft_preferences",
  "key": "scoring_format",
  "value": "PPR",
  "type": "string"
}

Response: 200 OK
```

#### DELETE User Setting
```http
DELETE /api/v1/user/{user_id}/settings/ui_layout/view_mode

Response: 204 No Content
```

### SQL Operations

#### Create Table
```sql
-- Run this SQL to create the table
SOURCE /Workspace/Repos/kingoffrisco@yahoo.com/FantasAI/databricks/sql/create_user_settings_table.sql
```

#### Insert/Update Setting (MERGE)
```sql
MERGE INTO main.fantasai.user_settings target
USING (
    SELECT 
        'user@example.com' as user_id,
        'draft_preferences' as setting_category,
        'scoring_format' as setting_key,
        '"PPR"' as setting_value,
        'string' as setting_type,
        current_timestamp() as updated_at
) source
ON target.user_id = source.user_id 
   AND target.setting_category = source.setting_category 
   AND target.setting_key = source.setting_key
WHEN MATCHED THEN UPDATE SET 
    setting_value = source.setting_value,
    updated_at = source.updated_at
WHEN NOT MATCHED THEN INSERT *;
```

#### Query User Settings
```sql
-- Get all settings for a user
SELECT 
    setting_category,
    setting_key,
    setting_value,
    updated_at
FROM main.fantasai.user_settings
WHERE user_id = 'user@example.com'
ORDER BY setting_category, setting_key;
```

---

## 🚀 Implementation Checklist

### Article Labeling System

- [x] Create Bronze ingestion notebook
- [x] Create Gold corrections notebook
- [x] Document schema in `/app/schemas/`
- [ ] Run Bronze ingestion to create table
- [ ] Run Gold corrections to create table
- [ ] Schedule hourly job for ingestion
- [ ] Integrate with ML model retraining pipeline
- [ ] Add monitoring dashboard for correction rate

### User Settings System

- [x] Create table SQL script
- [x] Document schema in `/app/schemas/`
- [ ] Execute SQL to create table
- [ ] Implement backend API endpoints (GET/PUT/DELETE)
- [ ] Add authentication/authorization
- [ ] Frontend integration (load on login, save on change)
- [ ] Add caching layer for frequently accessed settings

---

## 📈 Monitoring & Metrics

### Article Labeling Metrics to Track

1. **Correction Rate:** % of labels where original != labeled
2. **Labeling Volume:** New labels per day/week
3. **Relevance Distribution:** % of labels marked relevant
4. **Category Distribution:** injury, trade, depth_chart, etc.
5. **Model Improvement:** Accuracy before/after retraining

### User Settings Metrics to Track

1. **Settings Per User:** Avg number of customized settings
2. **Most Changed Settings:** Which settings users modify most
3. **Setting Sync Rate:** % of users with settings across multiple devices
4. **Popular Configurations:** Common setting combinations

---

## 🔧 Troubleshooting

### Article Labeling Issues

**Problem:** No labels appearing in bronze table  
**Solution:** Check R2 bucket permissions, verify mount path `/mnt/r2/`

**Problem:** Correction rate is 0%  
**Solution:** Verify filter logic (original != labeled), check data types

### User Settings Issues

**Problem:** Settings not persisting  
**Solution:** Verify primary key constraint, check MERGE logic

**Problem:** Settings overwriting between devices  
**Solution:** Check updated_at timestamps, ensure last-write-wins logic

---

## 📚 Additional Resources

- **Schema Documentation:** `/Repos/.../FantasAI/app/schemas/`
- **Notebooks:** `/Repos/.../FantasAI/databricks/Notebook/01_Ingestion/`
- **SQL Scripts:** `/Repos/.../FantasAI/databricks/sql/`
- **Architecture:** `/Repos/.../FantasAI/ARCHITECTURE.md`

---

**Next Steps:**
1. Execute table creation SQL
2. Run Bronze ingestion notebook (test with sample data)
3. Run Gold corrections notebook
4. Schedule jobs
5. Integrate with frontend UI

