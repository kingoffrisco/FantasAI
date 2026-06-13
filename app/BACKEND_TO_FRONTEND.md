# FantasAI Backend-to-Frontend Integration Guide

**Last Updated:** June 5, 2026  
**Version:** 1.0  
**Target:** Frontend developers integrating with FantasAI Databricks backend

---

## 🎯 Overview

This document describes all data available from the FantasAI backend, how to access it, and how to integrate it into your frontend application.

### Data Delivery Method

**Primary:** Cloudflare R2 Object Storage (S3-compatible)  
**Format:** Gzipped JSON  
**Refresh:** Daily at 08:00 UTC  
**Base URL:** `https://api.fantasai.net/api/v1/r2/fantasai/`

---

## 📦 Available Data Exports

### 1. 2026 Draft Players (`export_players_2026_draft`)

**Purpose:** All active 2026 fantasy draft candidates with tiers, rankings, and recent performance.

**Refresh Schedule:** Daily 08:00 UTC  
**Records:** 997 players (all `isDraftable: true` — retired players removed June 12, 2026)  
**Worker Endpoint:** `GET https://api.fantasai.net/api/v1/db/players`  
**Source Table:** `main.fantasai.export_players_2026_draft`

**Live R2 Schema (camelCase):**
```json
{
  "playerId": "string",
  "name": "string",
  "position": "string (QB, RB, WR, TE, K, DEF, FB)",
  "team": "string (3-letter code e.g. 'KC', 'PHI')",
  "proj": "float | null (projected fantasy points)",
  "avg": "string (season average e.g. '22.5')",
  "last": "string (last game score)",
  "trend": "string (JSON array of 6 recent scores)",
  "positionRank": "integer | null",
  "percentile": "float | null (0-100)",
  "tier": "string (Elite | High | Mid | Low | Unproven)",
  "isDraftable": "string ('true' for all 997)",
  "status": "string (Active | Injured | Questionable)",
  "lastSeasonPlayed": "string (e.g. '2025')",
  "experience": "string (years in NFL e.g. '3')",
  "isRookie": "string ('true' | 'false')"
}
```

> **Note:** ADP is not yet in this export. It is a planned ETL addition.

**Position breakdown:** QB(124) · RB(198) · WR(391) · TE(204) · K(43) · FB(5) · DEF(32)

**Frontend Usage:**
- Draft board player lists
- Player comparison tools
- Athletic profile cards
- Mock draft interfaces

---

### 2. ML Predictions (`ml_predictions.json`)

**Purpose:** Weekly fantasy point predictions from position-specific XGBoost models

**Refresh Schedule:** Weekly (Monday 06:00 UTC after games)  
**Records:** ~500 active players  
**Source Table:** `main.fantasai.export_ml_predictions`

**Schema:**
```json
{
  "player_id": "string",
  "player_name": "string",
  "position": "string",
  "team": "string",
  "week": "integer (1-18)",
  "season": "integer (2026)",
  "predicted_fantasy_pts": "float",
  "prediction_confidence": "float (0-1, model confidence score)",
  "prediction_range": {
    "low": "float (pessimistic scenario)",
    "high": "float (optimistic scenario)"
  },
  "actual_fantasy_pts": "float (null for future weeks)",
  "prediction_error": "float (null for future weeks)",
  "model_version": "string (e.g., qb_fantasy_predictor_v2)"
}
```

**Frontend Usage:**
- Start/sit recommendations
- Weekly lineup optimizer
- Projected points displays
- Model performance tracking

---

### 3. Player Trends (`player_trends.json`)

**Purpose:** Statistical trends and momentum indicators for waiver wire and trade analysis

**Refresh Schedule:** Daily 08:00 UTC  
**Records:** ~800 players with recent activity  
**Source Table:** `main.fantasai.export_player_trends`

**Schema:**
```json
{
  "player_id": "string",
  "player_name": "string",
  "position": "string",
  "team": "string",
  "trend_window": "string (Last_3_Weeks, Last_5_Weeks)",
  "trending_direction": "string (UP, DOWN, STABLE)",
  "fantasy_pts_trend": "float (% change over window)",
  "snap_share_trend": "float (% change in offensive snaps)",
  "target_share_trend": "float (% change in targets, WR/TE only)",
  "touch_share_trend": "float (% change in carries+targets, RB only)",
  "opportunity_score": "float (0-100, composite opportunity metric)",
  "momentum_indicator": "string (HOT, WARM, COLD)",
  "trend_start_date": "timestamp",
  "trend_end_date": "timestamp"
}
```

**Frontend Usage:**
- Waiver wire prioritization
- Trade value assessment
- Player cards with trend arrows
- "Hot hand" player lists

---

### 4. Positional Rankings (`positional_rankings.json`)

**Purpose:** Expert consensus rankings aggregated from Fantasy Pros, ESPN, Yahoo

**Refresh Schedule:** Daily 08:00 UTC  
**Records:** ~600 ranked players per week  
**Source Table:** `main.fantasai.export_positional_rankings`

**Schema:**
```json
{
  "player_id": "string",
  "player_name": "string",
  "position": "string",
  "team": "string",
  "week": "integer",
  "overall_rank": "integer (1-600)",
  "position_rank": "integer (rank within position)",
  "consensus_tier": "string (Tier 1, Tier 2, etc.)",
  "expert_ranks": {
    "fantasy_pros": "integer",
    "espn": "integer",
    "yahoo": "integer"
  },
  "rank_variance": "float (standard deviation across sources)",
  "confidence_level": "string (High, Medium, Low)"
}
```

**Frontend Usage:**
- Draft rankings display
- Trade value charts
- Start/sit tiers
- Expert consensus comparisons

---

### 5. Breakout Candidates (`breakout_candidates.json`)

**Purpose:** ML-identified players likely to exceed expectations (waiver wire targets)

**Refresh Schedule:** Weekly (Tuesday 10:00 AM ET)  
**Records:** ~50 candidates per week  
**Source Table:** `main.fantasai.export_breakout_candidates`

**Schema:**
```json
{
  "player_id": "string",
  "player_name": "string",
  "position": "string",
  "team": "string",
  "week": "integer",
  "opportunity_score": "float (0-100, ML-generated breakout probability)",
  "snap_share_delta": "float (% change in snap share)",
  "avg_snap_share": "float (% snaps over last 3 weeks)",
  "target_share_delta": "float (WR/TE/RB only)",
  "depth_chart_change": "boolean (true if moved up)",
  "breakout_reasoning": "string (e.g., 'Increased snap share + weak matchup')",
  "confidence_level": "string (High, Medium, Low)"
}
```

**Frontend Usage:**
- Waiver wire recommendations
- Weekly "Pick Up These Players" articles
- Breakout alert notifications
- Fantasy tips feed

---

### 6. Sleeper Picks (`sleeper_picks.json`)

**Purpose:** Undervalued players with low ownership but high upside

**Refresh Schedule:** Weekly (Tuesday 10:00 AM ET)  
**Records:** ~30 sleeper picks per week  
**Source Table:** `main.fantasai.export_sleeper_picks`

**Schema:**
```json
{
  "player_id": "string",
  "player_name": "string",
  "position": "string",
  "team": "string",
  "ownership_pct": "float (% rostered on Sleeper platform)",
  "projected_pts": "float (weekly projection)",
  "value_score": "float (0-100, upside/ownership ratio)",
  "reason": "string (explanation for the sleeper pick)",
  "matchup_grade": "string (A+, A, B+, etc.)",
  "weeks_to_breakout": "integer (estimated weeks until value realized)"
}
```

**⚠️ Known Issue:** `ownership_pct` currently returns 0 for all records. Fix pending in the Gold → Export pipeline (ownership join not yet wired).

**Frontend Usage:**
- Deep sleeper recommendations
- Championship week stashes
- Dynasty league targets
- Low-ownership DFS plays

---

### 7. Player News (`player_news.json`) ✨ NEW

**Purpose:** Recent NFL player news headlines with article URLs for frontend scraping

**Refresh Schedule:** Daily 08:00 UTC  
**Records:** 1,075 articles (top 5 per player, 271 players)  
**Source Table:** `main.fantasai.export_player_news`  
**Data Retention:** 60 days

**Schema:**
```json
{
  "metadata": {
    "generated_at": "timestamp (ISO 8601)",
    "total_players": "integer (271)",
    "total_articles": "integer (1075)",
    "max_articles_per_player": "integer (5)",
    "data_retention_days": "integer (60)"
  },
  "data": [
    {
      "player_id": "string",
      "player_name": "string",
      "position": "string",
      "team": "string",
      "headline": "string (article title)",
      "article_url": "string (full URL to original article)",
      "publisher": "string (e.g., ESPN, The New York Times, Sports Illustrated)",
      "published_at": "timestamp (ISO 8601)",
      "article_rank": "integer (1-5, 1 = most recent)"
    }
  ]
}
```

**Frontend Integration Pattern:**

**Display (No Description):**
```jsx
// Fetch news for player
const response = await fetch('https://api.fantasai.net/api/v1/r2/fantasai/analysis/player_news.json');
const { data: allNews } = await response.json();
const playerNews = allNews.filter(n => n.player_id === playerId).slice(0, 3);

// Render headlines only
{playerNews.map(article => (
  <div className="news-item">
    <h4>{article.headline}</h4>
    <div className="news-meta">
      {article.publisher} • {formatDate(article.published_at)}
    </div>
    <button onClick={() => scrapeAndShowArticle(article.article_url)}>
      Read Full Article
    </button>
  </div>
))}
```

**On-Demand Scraping (User Clicks "Read More"):**
```jsx
async function scrapeAndShowArticle(url) {
  // Check cache first
  const cached = localStorage.getItem(`article_${btoa(url)}`);
  if (cached) {
    return showArticleModal(JSON.parse(cached));
  }
  
  // Scrape on-demand (your frontend scraper)
  const content = await yourScraper.fetch(url);
  
  // Cache for 24 hours
  localStorage.setItem(`article_${btoa(url)}`, JSON.stringify({
    content,
    cachedAt: Date.now()
  }));
  
  // Display in modal/sidebar
  showArticleModal(content);
}
```

**Why No Descriptions?**
- Google News RSS feeds don't provide article summaries (only title + URL)
- Backend provides headline + link only
- Frontend scrapes full content on-demand when user clicks "Read More"
- This avoids 15-minute backend scraping delays and respects rate limits

**Frontend Responsibilities:**
1. Display headlines, publisher, publish date, and clickable URL
2. Implement article scraper (your choice: Puppeteer, Cheerio, etc.)
3. Cache scraped content per URL to avoid re-scraping
4. Handle paywalls, 404s, and scraping failures gracefully

---

## 🔗 API Endpoints

### Primary Exports (R2 Storage)

All exports available at: `https://api.fantasai.net/api/v1/r2/fantasai/analysis/`

 File | URL | Refresh |
------|-----|---------|
 Draft Roster | `draft_ready_roster_2026.json` | Daily 08:00 UTC |
 ML Predictions | `ml_predictions.json` | Weekly Mon 06:00 UTC |
 Player Trends | `player_trends.json` | Daily 08:00 UTC |
 Rankings | `positional_rankings.json` | Daily 08:00 UTC |
 Breakout Candidates | `breakout_candidates.json` | Weekly Tue 10:00 AM ET |
 Sleeper Picks | `sleeper_picks.json` | Weekly Tue 10:00 AM ET |
 Player News | `player_news.json` | Daily 08:00 UTC |

### Response Format

All endpoints return:
```json
{
  "metadata": {
    "generated_at": "2026-06-05T08:00:00Z",
    "record_count": 1234,
    "source_table": "main.fantasai.{table_name}"
  },
  "data": [ /* array of records */ ]
}
```

---

## 📁 Schema Files

All table schemas are documented in: `/Repos/kingoffrisco@yahoo.com/FantasAI/app/schemas/`

**Available Schema Files:**
- `export_player_news_schema.json` ✅
- `draft_ready_roster_2026_schema.json` (pending)
- `export_ml_predictions_schema.json` (pending)
- `export_player_trends_schema.json` (pending)

**Schema File Format:**
```json
{
  "table_name": "string",
  "description": "string",
  "refresh_schedule": "string",
  "retention": "string",
  "records": "string",
  "use_case": "string",
  "columns": [
    {
      "name": "string",
      "type": "string",
      "description": "string"
    }
  ],
  "relationships": {
    "related_table": "join relationship description"
  },
  "frontend_usage": {
    "display": "string",
    "scraping": "string",
    "caching": "string"
  },
  "sample_data": []
}
```

---

## 🔄 Refresh Schedules

### Daily (08:00 UTC)
- Draft roster
- Player trends
- Positional rankings
- Player news

### Weekly (Monday 06:00 UTC)
- ML predictions (after games complete)

### Weekly (Tuesday 10:00 AM ET)
- Breakout candidates
- Sleeper picks

### Manual Triggers
All exports can be manually triggered via Databricks Jobs API (contact backend team)

---

## 🎨 Frontend Integration Patterns

### 1. Fetching Data

**Recommended Approach:**
```javascript
class FantasAIClient {
  constructor() {
    this.baseURL = 'https://api.fantasai.net/api/v1/r2/fantasai/analysis';
    this.cache = new Map();
    this.cacheExpiry = 60 * 60 * 1000; // 1 hour
  }

  async fetch(endpoint) {
    const cacheKey = endpoint;
    const cached = this.cache.get(cacheKey);
    
    if (cached && Date.now() - cached.timestamp < this.cacheExpiry) {
      return cached.data;
    }

    const response = await fetch(`${this.baseURL}/${endpoint}`);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    
    const data = await response.json();
    this.cache.set(cacheKey, { data, timestamp: Date.now() });
    
    return data;
  }

  async getDraftRoster() {
    return this.fetch('draft_ready_roster_2026.json');
  }

  async getPredictions() {
    return this.fetch('ml_predictions.json');
  }

  async getPlayerNews() {
    return this.fetch('player_news.json');
  }
}

// Usage
const client = new FantasAIClient();
const roster = await client.getDraftRoster();
```

### 2. Caching Strategy

**Client-Side Cache:**
- Cache API responses for 1 hour (data refreshes daily/weekly)
- Use localStorage for scraped article content (24-hour expiry)
- Invalidate cache on user-triggered refresh

**Service Worker Cache:**
```javascript
// cache-first for static data exports
self.addEventListener('fetch', (event) => {
  if (event.request.url.includes('fantasai.net/api/v1/r2')) {
    event.respondWith(
      caches.match(event.request).then((response) => {
        return response || fetch(event.request);
      })
    );
  }
});
```

### 3. Error Handling

```javascript
async function fetchWithRetry(url, retries = 3) {
  for (let i = 0; i < retries; i++) {
    try {
      const response = await fetch(url);
      if (response.ok) return await response.json();
      
      // Exponential backoff
      await new Promise(r => setTimeout(r, 1000 * Math.pow(2, i)));
    } catch (err) {
      if (i === retries - 1) throw err;
    }
  }
}
```

### 4. Real-Time Updates

**Polling Strategy:**
- Draft roster: Poll every 6 hours (updates daily)
- Predictions: Poll every 30 minutes on game days
- Player news: Poll every 15 minutes during peak hours

**WebSocket (Future Enhancement):**
- Backend doesn't currently support WebSockets
- Consider using Server-Sent Events (SSE) for live score updates

---

## ⚠️ Known Issues & Limitations

### Current Issues

1. **Sleeper Picks Ownership Data:**
   - `ownership_pct` returns 0 for all records
   - Fix pending: Requires JOIN to `bronze_sleeper_ownership` table
   - Expected fix: June 7, 2026

2. **NFL Combine Data Not in ML Models:**
   - Combine metrics available in draft roster
   - NOT yet integrated into ML prediction models
   - Retrain required (scheduled June 10, 2026)

3. **Player News No Descriptions:**
   - Google News RSS limitation (design decision, not a bug)
   - Frontend must scrape article content on-demand
   - See "Player News" section for integration pattern

### Rate Limits

**R2 Storage:**
- No rate limits on GET requests
- Cached at CDN edge (Cloudflare)
- Safe for high-traffic applications

**Sleeper API (Backend):**
- 1,000 calls/day limit (backend manages this)
- Frontend has no direct Sleeper API access

**ESPN API (Backend):**
- No documented limits
- Backend manages all API calls

---

## 🧪 Testing & Validation

### Data Quality Checks

**Before consuming data, validate:**

```javascript
// Check for suspicious zero values
function validateData(data) {
  const zeroChecks = {
    sleeper_picks: ['ownership_pct'],
    breakout_candidates: ['opportunity_score'],
    ml_predictions: ['predicted_fantasy_pts']
  };

  for (const [table, fields] of Object.entries(zeroChecks)) {
    fields.forEach(field => {
      const zeros = data.filter(r => r[field] === 0).length;
      const total = data.length;
      const pct = (zeros / total) * 100;
      
      if (pct > 50) {
        console.warn(`⚠️ ${table}.${field}: ${pct.toFixed(1)}% zeros`);
      }
    });
  }
}
```

### Sample Data

Test endpoints always return valid JSON:
```bash
curl https://api.fantasai.net/api/v1/r2/fantasai/analysis/player_news.json | jq '.data[0]'
```

---

## 📞 Support & Escalation

### Backend Team Contact
- Slack: `#fantasai-backend`
- Email: backend@fantasai.net

### Request New Data Exports
1. Document required fields and use case
2. Submit request in `#fantasai-backend` channel
3. Expected turnaround: 2-3 business days

### Report Data Issues
- Include: table name, timestamp, sample problematic records
- Tag: `@backend-team` in Slack

---

## 📝 Change Log

### June 5, 2026
- ✅ Added `player_news.json` export (1,075 articles, 271 players)
- ✅ Created comprehensive frontend integration guide
- ✅ Documented on-demand article scraping pattern
- ✅ Added schema documentation in `/app/schemas/`

### June 2, 2026
- ✅ Added NFL Combine metrics to draft roster
- ✅ Fixed player deduplication in gold layer
- ⚠️ Identified zero-value issue in sleeper picks (pending fix)

### May 28, 2026
- ✅ Launched R2 export pipeline
- ✅ Fixed secret scope configuration

---

## 🚀 Quick Start Checklist

**For new frontend developers:**

- [ ] Clone FantasAI repo: `/Repos/kingoffrisco@yahoo.com/FantasAI/`
- [ ] Review schema files in `/app/schemas/`
- [ ] Test API endpoint: `https://api.fantasai.net/api/v1/r2/fantasai/analysis/player_news.json`
- [ ] Implement FantasAIClient class (see "Frontend Integration Patterns")
- [ ] Add caching layer (localStorage + service worker)
- [ ] Build article scraper for player news (your choice of library)
- [ ] Set up error handling and retry logic
- [ ] Subscribe to `#fantasai-backend` Slack channel for updates

---

**Questions? Reach out to the backend team!** 🏈
