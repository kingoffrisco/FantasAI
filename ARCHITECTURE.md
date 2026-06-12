# FantasAI System Architecture

**Last Updated:** June 9, 2026  
**Version:** 2.1  
**Platform:** Databricks on AWS

---

## Table of Contents

1. [System Overview](#system-overview)
2. [AI Architecture (3-Tier Design)](#ai-architecture-3-tier-design)
3. [Architecture Diagram](#architecture-diagram)
4. [Data Sources](#data-sources)
5. [Medallion Architecture](#medallion-architecture)
6. [ML Models](#ml-models)
7. [Frontend API & Tables](#frontend-api--tables)
8. [Job Schedules](#job-schedules)
9. [Repository Structure](#repository-structure)
10. [End-to-End Workflow](#end-to-end-workflow)
11. [Adding New Features](#adding-new-features)

---

## System Overview

FantasAI is a comprehensive fantasy football analytics platform that ingests data from multiple sources, processes it through a medallion architecture (Bronze → Silver → Gold), trains ML models for predictions, and serves data to a frontend UI via R2/S3 exports.

**Key Components:**
- **Data Ingestion:** Multi-source NFL/fantasy data collection
- **Data Processing:** Bronze/Silver/Gold medallion architecture
- **Analytics:** Player trends, rankings, matchups, combine metrics
- **ML Pipeline:** Feature engineering → Model training → Predictions
- **Data Export:** Scheduled exports to Cloudflare R2 for UI consumption
- **API Layer:** REST endpoints serving preprocessed data
- **Human-in-the-Loop Article Labeling Feedback:** Commissioners correct pipeline errors in player name extraction via a UI, stored in R2, feeding bronze/gold article label tables and ML retraining.

---


---

## AI Architecture (3-Tier Design)

**Last Updated:** June 10, 2026  
**Design Principle:** Optimize for latency & quality first, cost second

### Overview

FantasAI uses a **3-tier AI architecture** that separates workloads by volume, complexity, and user-facing requirements. This design pushes 90-95% of AI compute to local GPU infrastructure, reserving expensive frontier models only for premium interactive features where users notice the quality difference.

**Architecture Philosophy:**
- **Tier 1** (High-volume): Batch processing thousands of articles → Local Qwen 8B
- **Tier 2** (Fantasy reasoning): Generate scores and recommendations → Local Qwen 14B/32B
- **Tier 3** (Premium chat): Interactive user-facing AI → OpenAI frontier models

---

### Tier 1: High-Volume Processing (Local Qwen 8B)

**Purpose:** Structured extraction from thousands of news articles daily

**Infrastructure:**
- **Model:** Qwen 8B (or Gemma 3 12B, Llama 4 Scout as alternatives)
- **Hardware:** RTX 4080 GPU (local server)
- **Throughput:** 1000+ articles/day
- **Latency:** Not critical (batch processing)

**Tasks:**
- ✅ Player name extraction
- ✅ Team extraction
- ✅ Injury detection (Out, Questionable, IR, Doubtful, etc.)
- ✅ Sentiment analysis
- ✅ Fantasy relevance scoring (0-100)
- ✅ Waiver wire relevance scoring
- ✅ Dynasty relevance scoring
- ✅ Rookie relevance scoring
- ✅ Beat writer signal extraction (team + player + confidence)

**Data Flow:**
```
Databricks ETL → Bronze News
       ↓
Upload to R2
       ↓
Local Qwen 8B Server (polling every 5 min)
       ↓
Enriched Metadata (JSON)
       ↓
Upload back to R2
       ↓
Bronze/Silver Ingestion (hourly/daily)
```

**Output Format (per article):**
```json
{
  "news_id": "abc123",
  "extracted_players": ["Bijan Robinson", "Drake London"],
  "extracted_teams": ["ATL"],
  "injury_tags": ["Questionable", "Week-to-Week"],
  "sentiment": "negative",
  "relevance_score": 87,
  "waiver_relevance": 92,
  "dynasty_relevance": 65,
  "rookie_relevance": 15,
  "beat_writer_signal": {
    "team": "ATL",
    "player": "Bijan Robinson",
    "confidence": 0.82
  }
}
```

**Why Not Frontier Models?**
- These are structured extraction problems (not reasoning)
- No need for GPT-4o, Claude, or reasoning models
- Local 8B models handle this at 1/100th the cost

---

### Tier 2: Fantasy Reasoning (Local Qwen 14B/32B)

**Purpose:** Generate fantasy football scores and recommendations

**Infrastructure:**
- **Model:** Qwen 14B or Qwen 32B (depending on complexity)
- **Hardware:** RTX 4080 GPU (local server)
- **Schedule:** Every 2 hours or triggered after Databricks data refresh
- **Latency:** Not critical (pre-computation)

**Key Design Decision: Scores, Not Conclusions**

Instead of generating:
- ❌ `waiver_targets: ["Player A", "Player B"]` (rigid conclusions)
- ❌ `trade_targets: ["Player C"]` (not flexible)

Generate:
- ✅ **Scores** that the UI can use flexibly

**Output Format (per player):**
```json
{
  "player": "Bijan Robinson",
  "position": "RB",
  "team": "ATL",
  "week": 10,
  
  // Fantasy Scores
  "waiver_score": 9.8,
  "trade_buy_score": 8.2,
  "trade_sell_score": 1.2,
  "start_score": 9.5,
  "dynasty_value": 94,
  "injury_risk": 2.1,
  "matchup_score": 8.7,
  
  // Context (for explanations)
  "recent_trend": "up",
  "key_factors": ["Strong matchup", "RB1 volume", "Healthy"]
}
```

**Why Scores Are Better:**
- ✅ UI can instantly build: Waiver pages, Trade pages, Rankings, Start/Sit pages
- ✅ No AI invocation needed for page rendering
- ✅ Users can sort/filter by any score dimension
- ✅ Flexible for different league settings (PPR, dynasty, etc.)

**Tasks Tier 2 Handles:**
- Weekly player scoring (all rostered players + top 200 free agents)
- Trade candidate identification (buy/sell scores)
- Waiver wire priority rankings
- Start/sit recommendations
- Matchup analysis
- Injury impact assessment
- Dynasty asset valuation

**Data Flow:**
```
Databricks Refresh (players, stats, matchups)
       ↓
Upload to R2
       ↓
Local Qwen 14B Server
       ↓
Generate Scores for All Players
       ↓
Store Results in R2
       ↓
UI Loads Instantly (no AI call needed)
```

**Pre-Computation Optimization:**
Don't generate recommendations on-demand. Generate them after every data refresh (every 2 hours).

**Result:** 95% of users simply read precomputed scores. Only AI chat uses live model inference.

---

### Tier 3: Premium Chat (Frontier Models)

**Purpose:** Interactive user-facing AI assistant for complex reasoning

**Infrastructure:**
- **Primary Model:** OpenAI GPT-4o-mini (or latest frontier reasoning model)
- **Fallback Model:** Cloudflare AI (Llama 3.1 70B) for simpler queries
- **Deployment:** Cloudflare Worker
- **Latency:** Critical (500-1000ms target)

**When to Use Frontier Models:**

✅ **Questions Requiring Reasoning:**
- "Should I trade my WR depth for a RB1?"
- "What if my RB gets hurt for 3 weeks?"
- "Compare my roster to the top team in my league"
- "What's my optimal draft strategy given these keepers?"

❌ **Don't Use for:**
- Simple lookups ("What did Player X score?") → Use R2 data directly
- Pre-computed recommendations ("Who should I start?") → Use Tier 2 scores

**Architecture:**
```
User Question
      ↓
Cloudflare Worker
      ↓
Retrieve League Data from R2
      ↓
Build Context
      ↓
Query Classification:
  - Simple query → Cloudflare AI (Llama 3.1 70B)
  - Complex reasoning → OpenAI GPT-4o-mini
      ↓
Response
```

**Cost Optimization:**
- 80% of queries → Cloudflare AI ($0.011/1K requests)
- 20% of complex queries → OpenAI ($0.15/1M tokens)
- Expected: 90-95% of AI compute stays local (Tier 1 & 2)

**Why Frontier Models Still Matter:**
- Superior reasoning for multi-step strategy questions
- Better long-context handling (full league rosters + history)
- Noticeable quality difference in trade explanations
- Premium subscriber feature justification

---

### Ghost Picks Architecture (Probability Model, Not LLM)

**Purpose:** Real-time NFL draft pick predictions during live draft

**Design Principle:** Move AWAY from LLMs entirely during draft. Use probability scoring engine instead.

**Pre-Draft Preparation (Local Qwen 14B):**

Run heavy AI analysis **before** the draft to generate:

```json
{
  "team": "Dallas Cowboys",
  "needs": ["RB", "WR"],
  "historical_tendencies": {
    "SEC": 0.31,
    "Big10": 0.24,
    "senior_bowl": 0.42
  },
  "coach_preferences": {
    "athletic_testing": "high",
    "age_preference": "young"
  },
  "gm_preferences": {
    "trade_frequency": "medium",
    "position_value": ["OL", "DL", "RB"]
  },
  "probable_targets": [
    {"player": "Ashton Jeanty", "probability": 0.67},
    {"player": "Luther Burden", "probability": 0.22}
  ],
  "explanations": {
    "Ashton Jeanty": "Cowboys have drafted RBs in 3 of the last 5 drafts, hosted a private workout, and rank 28th in rushing efficiency."
  }
}
```

**Store all pre-computed intelligence in R2.**

**During Draft (Real-Time Probability Engine):**

**DO NOT** ask Qwen or ChatGPT "Who will Dallas draft?" for every pick.

**Too slow:** 10-30 seconds per pick

**Instead:** Maintain a live probability scoring engine.

**Inputs:**
1. Historical Draft Data (last 10 drafts)
2. Current Roster Needs (depth chart analysis)
3. Available Players (not yet drafted)
4. News Signals (beat writer reports, visits, workouts)
5. Team Tendencies (position preferences, conference preferences)

**Ghost Score Formula:**
```
Ghost Score = Need Score (25%)
            + Historical Score (20%)
            + Rumor Score (25%)
            + Value Score (20%)
            + Athletic Score (10%)
```

**Example:**
```
Ashton Jeanty (RB, Boise State)

Need Score: 25 (Cowboys rank 28th in rushing)
Historical Score: 12 (RBs drafted in 3/5 drafts)
Rumor Score: 18 (private workout reported)
Value Score: 20 (projected Round 1 value)
Athletic Score: 10 (95th percentile RAS)

Ghost Score: 75 → 67% probability
```

**When Pick 1 Is Made:**
```
Titans draft QB Shedeur Sanders
      ↓
Remove player from board
      ↓
Recalculate all probabilities
      ↓
Update UI
      ↓
Time: 100-500ms (NOT 10-30 seconds)
```

**Why This Works:**
- Probability engine is pure code (fast)
- AI-generated explanations are pre-computed (fast)
- No LLM inference during draft (fast)
- User sees instant updates with context

**UI Display:**
```
Ghost Pick: RB Ashton Jeanty (67%)

Why?
Dallas has drafted RBs in 3 of the last 5 drafts,
hosted a private workout, and ranks 28th in rushing efficiency.
```

**Probabilities:** Code-generated (real-time)  
**Explanations:** AI-generated (pre-computed)

**Where Qwen 14B Helps (Before Draft):**
- Generate team tendency narratives
- Write player scouting summaries
- Explain historical draft patterns
- Create context for each team's likely strategy

**Result:** Sub-second Ghost Pick updates during live draft, powered by probability model + pre-computed AI intelligence.

---

### Data Flow Summary

**Full Architecture:**

```
┌─────────────────────────────────────────────────────────────────┐
│                    STAGE 1: DATA COLLECTION                      │
│                         (Databricks ETL)                         │
└───────────────────────────┬─────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│                      R2 Storage (Raw Data)                       │
│  players.parquet | news.parquet | injuries.parquet | matchups   │
└───────────────────────────┬─────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│               STAGE 2: LOCAL AI PROCESSING                       │
│                   (RTX 4080 Local Server)                        │
├─────────────────────────────────────────────────────────────────┤
│  Tier 1 (Qwen 8B):                                              │
│    • News processing (player extraction, injury tagging)        │
│    • Beat writer signal extraction                              │
│    • Relevance scoring                                          │
│                                                                  │
│  Tier 2 (Qwen 14B):                                             │
│    • Fantasy scoring (waiver, trade, start/sit)                 │
│    • Pre-draft Ghost Pick profiles                              │
│    • Dynasty valuations                                         │
└───────────────────────────┬─────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│              R2 Storage (Enriched Data + Scores)                 │
│  fantasy_metadata.json | player_scores.json | ghost_picks.json  │
└───────────────────────────┬─────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│                 STAGE 3: API LAYER                               │
│                  (Cloudflare Workers)                            │
├─────────────────────────────────────────────────────────────────┤
│  • Serve pre-computed scores (no AI)                            │
│  • Real-time Ghost Picks probability engine (no AI)             │
│  • Premium chat → Tier 3 AI                                     │
└───────────────────────────┬─────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│                         FRONTEND UI                              │
│  • Instant page loads (reads pre-computed scores)               │
│  • Real-time draft updates (probability engine)                 │
│  • Premium chat (OpenAI inference)                              │
└─────────────────────────────────────────────────────────────────┘
```

---

### Cost & Performance Summary

| Tier | Workload | Model | Infrastructure | Cost | Latency |
|------|----------|-------|----------------|------|---------|
| **Tier 1** | News processing (1000+ articles/day) | Qwen 8B | Local GPU | ~$0 | Not critical |
| **Tier 2** | Fantasy scoring (500+ players) | Qwen 14B | Local GPU | ~$0 | Not critical |
| **Tier 3** | Premium chat (100-500 queries/day) | OpenAI GPT-4o-mini | Cloud API | ~$2-5/day | 500-1000ms |

**Result:** 90-95% of AI compute runs locally. Only premium chat uses paid APIs.

**Why This Works:**
- Local GPU handles high-volume batch processing
- Pre-computation eliminates on-demand AI costs
- Frontier models reserved for features where users notice quality
- Latency optimized where it matters (user-facing chat, live draft)

---

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           DATA SOURCES                                   │
├─────────────────────────────────────────────────────────────────────────┤
│  Sleeper API    │  ESPN API   │  nflverse   │  NFL Combine  │  Manual   │
│  (1000/day)     │  (No limit) │  (Parquet)  │  (CSV Upload) │  (CSV)    │
│  Article Labeling UI  │  R2 Storage │
└────────┬────────┴─────┬───────┴──────┬──────┴───────┬───────┴───────┬───┘
         │              │              │              │               │
         │   (Commissioners provide corrections via UI)                │
         └──────────────┴──────────────┴──────────────┴───────────────┘
                                      │
                                      ▼
         ┌────────────────────────────────────────────────────────┐
         │              BRONZE LAYER (Raw Ingestion)              │
         ├────────────────────────────────────────────────────────┤
         │  • bronze_weekly_stats                                 │
         │  • bronze_players                                      │
         │  • bronze_rosters                                      │
         │  • bronze_player_news_raw                              │
         │  • bronze_trending_players                             │
         │  • bronze_article_labels         ⬅️ NEW (commissioner correction labels)
         └───────────────────────┬────────────────────────────────┘
                                 │
                                 ▼
         ┌────────────────────────────────────────────────────────┐
         │           SILVER LAYER (Cleaned & Validated)           │
         ├────────────────────────────────────────────────────────┤
         │  • silver_weekly_stats                                 │
         │  • silver_players                                      │
         │  • silver_player_news                                  │
         │  • silver_trending_players                             │
         └───────────────────────┬────────────────────────────────┘
                                 │
                                 ▼
         ┌────────────────────────────────────────────────────────┐
         │          GOLD LAYER (Business Logic Applied)           │
         ├────────────────────────────────────────────────────────┤
         │  • gold_weekly_stats                                   │
         │  • gold_player_dim                                     │
         │  • gold_player_id_mapping                              │
         │  • player_combine_results                              │
         │  • gold_player_mapping_corrections   ⬅️ NEW (ML training corrections)
         └───────────────────────┬────────────────────────────────┘
                                 │
                ┌────────────────┴────────────────┐
                │                                 │
                ▼                                 ▼
       ┌────────────────────────┐      ┌──────────────────────────┐
       │   ANALYTICS LAYER      │      │      ML PIPELINE         │
       ├────────────────────────┤      ├──────────────────────────┤
       │ • analytics_player_    │      │ • ml_player_features     │
       │   trends               │      │ • ml_trained_models      │
       │ • analytics_positional_│      │ • ml_predictions         │
       │   rankings             │      │   - QB predictions       │
       │ • analytics_player_    │      │   - RB predictions       │
       │   season_stats         │      │   - WR predictions       │
       │ • player_opportunity_  │      │   - TE predictions       │
       │   scores               │      │                          │
       └────────┬───────────────┘      └──────────┬───────────────┘
                │                                 │
                └────────────┬────────────────────┘
                             │
                             ▼
           ┌────────────────────────────────────────────────────────┐
           │            EXPORT & API SERVING LAYER                  │
           ├────────────────────────────────────────────────────────┤
           │  • Cloudflare R2 / S3 Exports (via GitHub Actions)    │
           │  • draft_ready_roster_2026 (Unity Catalog View)        │
           │  • API Endpoints (serve precomputed data)              │
           └────────────────────────────────────────────────────────┘
                                      │
                                      ▼
           ┌────────────────────────────────────────────────────────┐
           │                    FRONTEND UI                         │
```

---

## Human-in-the-Loop Article Labeling Feedback System

**Overview:**
- Enables commissioners and admins to correct player name extraction errors in football news articles or pipeline output.
- All corrections are saved via the UI to R2, ingested hourly/daily to the bronze_article_labels table.
- Corrections are mapped to ML training data in gold_player_mapping_corrections
- Drives feedback loop for ML model retraining (player name extraction)

**Key Tables:**
- `main.fantasai.bronze_article_labels` — Raw corrections from commissioners, source: R2 JSON
- `main.fantasai.gold_player_mapping_corrections` — Cleaned mapped corrections suitable for ML training (error_pattern, correction_type, etc.)
- `main.fantasai.user_settings` — User persistence table (data for UI/commissioner experience)

**Notebooks:**
- `/Repos/kingoffrisco@yahoo.com/FantasAI/databricks/Notebook/01_Ingestion/Bronze/article_labeling_feedback_ingestion.py` (bronze ingestion)
- `/Repos/kingoffrisco@yahoo.com/FantasAI/databricks/Notebook/01_Ingestion/Gold/gold_player_mapping_corrections.py` (gold transformation)

**Guide:**
- `/Repos/kingoffrisco@yahoo.com/FantasAI/docs/HUMAN_IN_THE_LOOP_INTEGRATION.md`

**Job Schedule:**
- Article Labeling Feedback Job runs daily at 6:00 AM UTC, then triggers gold pipeline + ML retraining

**Expected Impact:**
- Identifies and corrects errors (abbreviated names, missing first names, wrong positions)
- Delivers 50–100 corrections/month
- ML accuracy improvement: +10–20%
- Feedback loop: Label → retrain → deploy (2 weeks)

---

## 2026 Draft Roster (draft_ready_roster_2026)

**Overview:**
- Unity Catalog view providing the official 2026 NFL fantasy draft player pool
- Used by frontend UI for draft boards, player searches, and roster management
- **Source of Truth:** `bronze_players` table (latest 2026 roster ingestion from Sleeper API)
- **Updated:** June 8-9, 2026 - Now pulls from actual 2026 NFL rosters with rookie status

**Player Count:** **988 active players**
- 700 veterans (with 2025 stats)
- 288 rookies/new signees (no 2025 stats)

**Position Breakdown:**
| Position | Count |
|----------|-------|
| WR | 390 |
| TE | 210 |
| RB | 203 |
| QB | 129 |
| K | 45 |
| FB | 11 |

**Filtering Logic:**
1. Pull latest 2026 roster from `bronze_players` (ingested from Sleeper API)
2. Filter to: `status IN ('Active', 'Injured Reserve')` AND `team IS NOT NULL`
3. Filter to fantasy positions: `QB, RB, WR, TE, K, FB`
4. LEFT JOIN to `gold_player_dim` for master_player_id (keeps all 2026 players even if not matched)
5. Enrich with 2025 stats, combine metrics, career totals, draft tiers
6. **NEW (June 9):** Add rookie status from Sleeper `years_exp` field

**Schema (26 columns total):**

**Core Identity:**
- `master_player_id` — Unified player ID (uses bronze player_id for unmatched players)
- `player_name` — Display name
- `position` — QB/RB/WR/TE/K/FB
- `team` — Current 2026 team (3-letter code)

**NEW: Rookie & Experience Data (from Sleeper API):**
- `years_exp` — NFL experience years (INT, 0 = rookie)
- `is_rookie` — TRUE if years_exp = 0, FALSE otherwise (BOOLEAN)
- `age` — Player age (INT)
- `birth_date` — Birth date (STRING)
- `college` — College attended (STRING)
- `experience_level` — Rookie/Sophomore/Young/Veteran (STRING, prioritizes years_exp)

**NEW: Depth Chart Data (from Sleeper API):**
- `depth_chart_order` — 1=starter, 2=backup, 3+=depth (INT)
- `depth_chart_position` — Position-specific depth: WR1, RB2, etc. (STRING)
- `depth_chart_role` — Starter/Backup/Depth/Unknown (STRING, calculated)

**2025 Performance:**
- `season_total_points_2025` — 2025 fantasy points total
- `season_avg_points_2025` — 2025 fantasy PPG
- `games_played_2025` — 2025 games played

**Combine Metrics:**
- `draft_year` — NFL draft year (INT, from combine table)
- `forty_time`, `vertical_jump`, `bench_reps`, `athleticism_score` — Combine metrics

**Career Stats:**
- `total_career_points`, `seasons_played`, `career_ppg` — Career stats

**Classifications:**
- `season_2025_status` — Full Season/Most Games/Limited Action/Spot Duty/No 2025 Stats
- `draft_tier` — QB1/QB2/QB3, RB1/RB2/RB3, WR1/WR2/WR3, TE1/TE2, K1, Flex/Depth, Unproven

**Export:**
- **R2 Path:** `fantasai/players/export_players_2026_draft.json`
- **Job:** R2 Export - Analysis Data
- **Schedule:** Daily at 10:00 AM UTC (via notebook job)
- **Format:** Gzipped JSON with metadata

**Key Changes:**

**June 8, 2026:**
- ✅ **Fixed:** Now uses 2026 Bronze roster as source of truth (previously used outdated `gold_player_dim.current_team`)
- ✅ **Fixed:** Includes ALL 2026 active players (988) instead of just matched gold_player_dim records (727)
- ✅ **Fixed:** Excludes retired/historical players (previously included 3,872 retired players)
- ✅ **Fixed:** Includes 2026 rookies and recent signees (288 players previously missing)

**June 9, 2026:**
- ✅ **Added:** Rookie identification via Sleeper API `years_exp` field (no external ADP API needed!)
- ✅ **Added:** Depth chart data (starter/backup classification)
- ✅ **Added:** Player demographics (age, birth_date, college)
- ✅ **Updated:** `experience_level` logic prioritizes `years_exp` over `draft_year`
- ✅ **Result:** Full rookie roster visible without waiting for NFL Combine CSV updates

**Implementation Files:**
- View SQL: `/databricks/sql/update_draft_ready_roster_2026_with_rookie_status.sql`
- Bronze Ingestion: `/notebooks/01_Ingestion/Bronze/03_player_metadata_ingestion` (updated)
- Schema Doc: `/app/schemas/draft_ready_roster_2026_schema.json`

**Historical Players (Not in 2026 Draft List):**
- Players not playing in 2026 are tracked separately for ML model training purposes
- Used for historical inference and model accuracy improvements
- Not exposed to frontend draft UI

**ADP Data:**
- ❌ **Not available from Sleeper API** (tested endpoints returned 404)
- ⏳ **Recommendation:** Integrate SportsDataIO API ($19-99/month) for industry-standard ADP
- 🔄 **Alternatives:** FantasyPros API, Underdog Fantasy API (free best-ball), or web scraping
- 📋 **Status:** Pending decision on ADP data source

---

[...remaining content unchanged...]
