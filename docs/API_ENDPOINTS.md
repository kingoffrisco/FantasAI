# FantasAI API Endpoints Documentation

**Last Updated:** June 7, 2026  
**Export Pipeline:** Automated daily exports to Cloudflare R2

---

## 📋 Table of Contents

1. [Overview](#overview)
2. [Base URL](#base-url)
3. [News Endpoints](#news-endpoints)
4. [Analysis Endpoints](#analysis-endpoints)
5. [Player Data Endpoints](#player-data-endpoints)
6. [Statistics Endpoints](#statistics-endpoints)
7. [Defense Endpoints](#defense-endpoints)
8. [Response Format](#response-format)
9. [Timestamps](#timestamps)
10. [Caching](#caching)

---

## Overview

All FantasAI data is exported daily to Cloudflare R2 storage as JSON files. Frontend applications fetch data directly from R2 endpoints.

**Export Schedule:**
- **News Export:** Daily at 08:00 UTC
- **Analysis Export:** Daily at 08:30 UTC

---

## Base URL

```
https://r2.yourdomain.com/
```

---

## News Endpoints

### 1. Combined Player News ⭐ RECOMMENDED

**Endpoint:** `fantasai/analysis/player_news.json`

**Description:** Unified endpoint combining enriched news articles, AI-generated summaries, and player context. Includes all three timestamp types.

**Records:** ~86 articles (last 60 days)

**Sample Response:**
```json
{
  "data": [
    {
      "news_id": "enriched_b29f2566-9a37-3d87-9b69-9d1264e86616",
      "headline": "Badgers hire longtime NFL exec as next GM",
      "source_url": "https://...",
      "full_text": "Full article text...",
      "player_id": "sleeper_123",
      "player_name": "Justin Jefferson",
      "position": "WR",
      "team": "MIN",
      "summary_text": "AI-generated summary...",
      "fantasy_insight": "Fantasy impact analysis...",
      "impact_score": 8.5,
      "impact_category": "injury",
      "published_at": "2026-05-31T19:15:00Z",
      "enriched_at": "2026-05-31T19:34:34Z",
      "ai_generated_at": "2026-05-31T19:35:45Z"
    }
  ],
  "metadata": {
    "total_articles": 86,
    "exported_at": "2026-06-07T08:00:00Z",
    "source": "databricks"
  }
}
```

**Key Fields:**
- `published_at` - Original article publication timestamp
- `enriched_at` - When article was processed by FantasAI
- `ai_generated_at` - When AI summary was generated
- `impact_score` - Fantasy relevance (0-10)
- `impact_category` - Type: injury, trade, performance, depth_chart

---

### 2. Player Notes

**Endpoint:** `fantasai/news/player_notes.json`

**Description:** Aggregated news notes grouped by player.

**Records:** ~70 players

---

### 3. AI Summaries

**Endpoint:** `fantasai/news/ai_summaries.json`

**Description:** AI-generated summaries with fantasy insights (most recent 100).

**Records:** 100 most recent

---

### 4. Enriched News

**Endpoint:** `fantasai/news/enriched_news.json`

**Description:** Full article text with player/team extraction (most recent 200).

**Records:** 200 most recent

---

### 5. Player Injuries

**Endpoint:** `fantasai/injuries/silver_player_news.json`

**Description:** Current player injury status and depth chart information.

**Records:** ~246 players

---

## Analysis Endpoints

### 6. Breakout Candidates

**Endpoint:** `analysis/breakout_candidates.json`

**Description:** Weekly breakout predictions based on opportunity metrics.

**Records:** ~7 candidates per week

---

### 7. Sleeper Picks

**Endpoint:** `analysis/sleeper_picks.json`

**Description:** Undervalued waiver wire targets with low ownership.

**Records:** ~24 picks

---

## Player Data Endpoints

### 8. Draft Roster 2026

**Endpoint:** `fantasai/players/export_players_2026_draft.json`

**Description:** Complete player roster with combine metrics and 2025 performance.

**Records:** 4,823 players

---

## Statistics Endpoints

### 9. Gold Weekly Stats

**Endpoint:** `fantasai/stats/gold_weekly_stats.json`

**Description:** Complete weekly player statistics (all seasons).

**Records:** 583,916 records

**⚠️ Warning:** Large file (~50-100 MB).

---

## Defense Endpoints

### 10. Defense Performance

**Endpoint:** `analysis/defense_performance.json`

**Description:** Historical defense/special teams performance.

---

### 11. Defense Predictions

**Endpoint:** `predictions/defense_predictions.json`

**Description:** ML-powered defense fantasy point predictions.

---

## Response Format

All endpoints return JSON with this structure:

```json
{
  "data": [...],
  "metadata": {
    "generated_at": "ISO 8601 timestamp",
    "record_count": 123,
    "source_table": "main.fantasai.table_name"
  }
}
```

---

## Timestamps

All timestamps are in **ISO 8601 format** with UTC timezone:

```
2026-06-07T08:00:00Z
```

### Timestamp Types

| Field | Description | Example Use Case |
|-------|-------------|------------------|
| `published_at` | Original article/event timestamp | "Show breaking news from last 6 hours" |
| `enriched_at` | When FantasAI processed the data | "Recently updated articles" |
| `ai_generated_at` | When AI analysis was created | "Fresh AI insights badge" |
| `generated_at` | When export file was created | "Data freshness indicator" |
| `fetched_at` | When data was ingested from source | "Last sync time" |

---

## Caching

All R2 objects are served with `Cache-Control: public, max-age=3600` (1 hour).

### Recommended Frontend Strategy

```javascript
const CACHE_KEY = 'fantasai_player_news';
const CACHE_TTL = 60 * 60 * 1000; // 1 hour

async function getPlayerNews() {
  const cached = localStorage.getItem(CACHE_KEY);
  if (cached) {
    const { data, timestamp } = JSON.parse(cached);
    if (Date.now() - timestamp < CACHE_TTL) {
      return data;
    }
  }
  
  const response = await fetch(
    'https://r2.yourdomain.com/fantasai/analysis/player_news.json'
  );
  const data = await response.json();
  
  localStorage.setItem(CACHE_KEY, JSON.stringify({
    data,
    timestamp: Date.now()
  }));
  
  return data;
}
```

---

## Export Jobs

| Job | ID | Schedule | Notebook |
|-----|-----|----------|----------|
| Export Fantasy News to R2 | 533461232082366 | Daily 08:00 UTC | `/notebooks/06_Exports/Export Fantasy News to R2` |
| Export Analysis Data to R2 | 848536035023585 | Daily 08:30 UTC | `/notebooks/05_Scheduled_Jobs/R2 Export - Analysis Data` |

---

**Generated:** 2026-06-07  
**Version:** 1.0.0