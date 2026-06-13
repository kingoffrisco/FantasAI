# FantasAI System Architecture

**Last Updated:** June 9, 2026  
**Version:** 2.1  
**Platform:** Databricks on AWS

---

## Table of Contents

1. [System Inventory](#system-inventory)
2. [System Overview](#system-overview)
3. [AI Architecture (3-Tier Design)](#ai-architecture-3-tier-design)
4. [Architecture Diagram](#architecture-diagram)
5. [Data Sources](#data-sources)
6. [Medallion Architecture](#medallion-architecture)
7. [ML Models](#ml-models)
8. [Frontend API & Tables](#frontend-api--tables)
9. [Job Schedules](#job-schedules)
10. [Repository Structure](#repository-structure)
11. [End-to-End Workflow](#end-to-end-workflow)
12. [Adding New Features](#adding-new-features)

---

## 📊 System Inventory (Last Updated: June 12, 2026)

### Current State
```
📓 NOTEBOOKS:  60 total
   ├─ Bronze Layer (Ingestion):        34
   ├─ Silver Layer (Transformation):    0
   ├─ Gold Layer (Business Logic):      1
   ├─ Analysis:                         0
   ├─ ML Training:                      4
   ├─ ML Registration:                  3
   ├─ Scheduled Jobs:                   7
   └─ Exports:                          3

⚙️ JOBS:      30 active (33% duplication) [Phase 1 Complete ✅]
   ├─ Optimal State:                   17
   ├─ Phase 1 Archived:                 4 (see ARCHIVED_JOBS.md)
   ├─ Remaining Duplicates:            11
   └─ Waste Remaining:                 33%
```

### Validation Rule

**This document is OUT OF DATE if:**
- Notebook count in repo ≠ documented notebook count
- Active job count ≠ documented job count
- New data sources exist without Bronze notebooks
- Exports to R2 exist without Export notebooks

**To validate counts:**
```bash
# Count notebooks
find /Workspace/Repos/kingoffrisco@yahoo.com/FantasAI/notebooks -name "*.py" -o -name "*.ipynb" | wc -l

# Count jobs
databricks jobs list --output JSON | jq '. | length'
```

**Update this section when:**
- ✅ Creating new notebooks
- ✅ Deleting old jobs
- ✅ Adding data sources
- ✅ Consolidating duplicates

**Archive File:** All removed/archived jobs are documented in [ARCHIVED_JOBS.md](#file-4166639283357659) with full configurations for restoration if needed.

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

## Job Schedules

**Last Updated:** June 12, 2026

### Critical Rule: Every Ingestion Job Must Have a Documented Output Path

**If data is ingested but not exported to R2, the UI will not see it. Always validate end-to-end flow.**

---

## 🚨 CRITICAL ISSUE: 44% Job Duplication Detected

**Audit Date:** June 12, 2026  
**Current State:** 34 jobs (15 duplicates)  
**Target State:** 19 consolidated jobs  
**Efficiency Gain:** 44% reduction

### Duplicate Jobs to Delete

#### Stats Ingestion Duplicates (12 jobs → 4 jobs)
**Keep ONE of each:**
- ✅ **nflverse**: Keep 444982717808117, Delete: 530144362139462, 988933669189816
- ✅ **Sleeper API**: Keep 307753042426414, Delete: 475179063418847, 442856552948533, 518453877190141
- ✅ **ESPN Public API**: Keep 778277626953647, Delete: 608639812767789, 763538880653266
- ✅ **API-Sports.io**: Keep 556044300919171, Delete: 1083340841351365, 878836084760675

#### News & Injury Duplicates (3 jobs → 1 job)
**Consolidate into: FantasAI - Daily News Ingestion (943551462212511)**
- Already has 3-task pipeline: Ingest → Transform → Export
- Delete: 185216139919059 (Daily NFL News & Injury Updates)
- Delete: 667550437388679 (Fantasy News Daily Refresh)

#### R2 Export Duplicates (4 jobs → 2 jobs)
**Two distinct purposes:**
- ✅ **News Export**: Now integrated into 943551462212511 (Task 3)
- ✅ **Analysis Export**: Keep 848536035023585, runs after analytics job
- Delete: 24271112387268 (duplicate analysis export)
- Delete: 533461232082366 (news export - now in orchestrator)
- Delete: 723299865616961 (every 6 hours - excessive)

#### Breakout Predictions (2 jobs → 1 job)
- Keep: 822442342570173
- Delete: 1029762522315672 (exact duplicate)

---

## Optimal Job Architecture

### Daily Jobs (Run Every Day)

#### 1. FantasAI - Daily News Ingestion (943551462212511)
**Schedule:** 7:00 AM UTC (2:00 AM Central)  
**Duration:** ~24 minutes  
**Tasks:**
1. news_orchestrator (17 min) → Ingest from Sleeper, ESPN, Google, NFL Transactions
2. gold_transformation (5 min) → Transform Bronze → Gold
3. r2_export (2 min) → Upload to R2 for UI

**Output:** `export_player_news` → R2 → UI

---

#### 2. Article Labeling Feedback - Daily Ingestion (803627611593135)
**Schedule:** 6:00 AM UTC (1:00 AM Central)  
**Duration:** ~5 minutes  
**Purpose:** Ingest commissioner corrections from R2 → bronze_article_labels

**Output:** `bronze_article_labels`, `gold_player_mapping_corrections`

---

#### 3. API-Sports.io Daily Stats Update (556044300919171)
**Schedule:** 2:00 AM Central  
**Duration:** ~10 minutes  
**Purpose:** Ingest daily game stats from API-Sports.io

**Output:** `bronze_weekly_stats` (daily updates)

---

#### 4. Daily Player Analytics Update (448879035335090)
**Schedule:** 4:00 AM Central  
**Duration:** ~15 minutes  
**Purpose:** Calculate player trends, opportunity scores, positional rankings

**Dependencies:** Runs after stats ingestion  
**Output:** `analytics_player_trends`, `analytics_positional_rankings`

---

#### 5. FantasAI - Export Analysis Data to R2 (848536035023585)
**Schedule:** 8:30 AM UTC (3:30 AM Central)  
**Duration:** ~5 minutes  
**Purpose:** Export analytics tables to R2 for UI

**Dependencies:** Runs after Daily Player Analytics (job 4)  
**Output:** Analytics data → R2 → UI

---

### Weekly Jobs (Tuesday Morning)

**Execution Order:**
```
1. Stats Ingestion (parallel) → 3:00 AM Central
   ├─ nflverse Weekly Stats (444982717808117)
   ├─ Sleeper API Weekly (307753042426414)
   └─ ESPN Public API Weekly (778277626953647)
        ↓
2. Weekly ML Model Training (763487314454311) → 5:00 AM Central
        ↓
3. Weekly Fantasy Breakout Predictions (822442342570173) → 10:00 AM Central
        ↓
4. Weekly Defense Rankings (867627996885375) → 10:30 AM Central
```

#### 6-8. Stats Ingestion (Parallel Execution)
**Schedule:** 3:00 AM Central, Tuesday
- **nflverse** (444982717808117): Season-long stats, depth charts
- **Sleeper API** (307753042426414): League data, rosters, matchups
- **ESPN Public API** (778277626953647): Player metadata, combine data

**Output:** Bronze layer stats tables

---

#### 9. Weekly ML Model Training (763487314454311)
**Schedule:** 5:00 AM Central, Tuesday  
**Duration:** ~30 minutes  
**Dependencies:** Waits for stats ingestion (jobs 6-8)

**Output:** Trained ML models for QB/RB/WR/TE predictions

---

#### 10. Weekly Fantasy Breakout Predictions (822442342570173)
**Schedule:** 10:00 AM Central, Tuesday  
**Duration:** ~15 minutes  
**Dependencies:** Waits for ML training (job 9)

**Output:** `breakout_predictions_current` → R2 export

---

#### 11. Weekly Defense Rankings Update (867627996885375)
**Schedule:** 10:30 AM Central, Tuesday  
**Duration:** ~10 minutes  
**Dependencies:** Waits for stats ingestion

**Output:** `defense_rankings_current` → R2 export

---

### Weekly Jobs (Monday)

#### 12. ADP Pipeline - Bronze to Gold (100016462470325)
**Schedule:** 7:00 AM UTC, Monday  
**Duration:** ~10 minutes  
**Purpose:** Ingest ADP data for PPR and Standard formats

**Output:** `gold_adp_ppr`, `gold_adp_standard`

---

#### 13. Export Players Draft Data (100559857891019)
**Schedule:** 8:00 AM UTC, Monday  
**Duration:** ~5 minutes  
**Dependencies:** Runs after ADP pipeline

**Output:** Draft data → R2

---

### Weekly Jobs (Wednesday)

#### 14. Weekly NFL Injury Updates (369873943083480)
**Schedule:** 3:00 AM Eastern, Wednesday  
**Duration:** ~10 minutes  
**Purpose:** Backfill injury reports to historical table

**Output:** `silver_injury_reports_historical`

---

#### 15. Weekly Stats Ingestion (432312901354426)
**Schedule:** 7:00 AM Eastern, Wednesday  
**Duration:** ~15 minutes  
**Purpose:** Additional weekly stats consolidation

---

#### 16. Opportunity Score Recalculation (935857894190744)
**Schedule:** 8:00 AM Eastern, Wednesday  
**Duration:** ~10 minutes  
**Purpose:** Recalculate weekly opportunity metrics

**Output:** `player_opportunity_scores`

---

#### 17. Vegas Totals Weekly Refresh (696826434401062)
**Schedule:** 10:00 PM Eastern, Tuesday  
**Duration:** ~5 minutes  
**Purpose:** Update game totals and betting lines

**Output:** `game_vegas_totals`

---

#### 18. FantasAI Weekly Stats Ingestion (862306600850562)
**Schedule:** 8:00 AM Central, Tuesday  
**Duration:** ~10 minutes  
**Purpose:** Consolidate all stats sources

---

#### 19. Fantasy Football Daily Analysis (712488215166349)
**Schedule:** 6:00 AM Central, Daily  
**Duration:** ~10 minutes  
**Purpose:** Generate daily fantasy insights

---

## Consolidation Action Plan

### Phase 1: Delete Unscheduled Duplicates (Immediate - No Impact)
**Delete these 4 jobs** (no schedule, likely dead):
- 530144362139462 (nflverse - no schedule)
- 475179063418847 (Sleeper - no schedule)
- 1083340841351365 (API-Sports - no schedule)
- 608639812767789 (ESPN - no schedule)

**Risk:** Zero (not running)

---

### Phase 2: Consolidate Stats Ingestion (Week 1)
**Test the "keep" jobs for 1 week:**
- 444982717808117 (nflverse)
- 307753042426414 (Sleeper)
- 778277626953647 (ESPN)
- 556044300919171 (API-Sports)

**If successful, delete duplicates:**
- 988933669189816 (nflverse)
- 442856552948533, 518453877190141 (Sleeper)
- 763538880653266 (ESPN)
- 878836084760675 (API-Sports)

**Savings:** 7 jobs deleted

---

### Phase 3: Consolidate R2 Exports (Week 2)
**Verify orchestrator job 943551462212511 exports news successfully**
- Task 3 should handle news export

**Delete standalone news export jobs:**
- 533461232082366 (FantasAI - Export Fantasy News to R2)
- 24271112387268 (R2 Export - Analysis Data - duplicate)
- 723299865616961 (FantasAI - Export to R2 Storage - every 6 hours)

**Savings:** 3 jobs deleted

---

### Phase 4: Delete Obvious Duplicates (Week 3)
**Delete exact duplicate breakout job:**
- 1029762522315672 (Weekly Fantasy Breakout Predictions)

**Delete duplicate news jobs** (after verifying 943551462212511 works):
- 185216139919059 (Daily NFL News & Injury Updates)
- 667550437388679 (Fantasy News Daily Refresh)

**Savings:** 3 jobs deleted

---

### Final State
**Before:** 34 jobs  
**After:** 17 jobs  
**Reduction:** 50%

**Benefits:**
- ✅ Clear execution order
- ✅ No duplicate work
- ✅ Easier troubleshooting
- ✅ Documented dependencies
- ✅ Predictable execution times

---

### News Ingestion Pipeline (Job ID: 943551462212511)

**Schedule:** Daily at 7:00 AM UTC (2 AM Central)

**End-to-End Flow:**

```
Task 1: News Orchestrator (17 min)
   ├─ Sleeper API → bronze_player_news_raw (4,254 players)
   ├─ ESPN News API → bronze_player_news_espn_api (12,240 articles)
   ├─ Google News RSS → bronze_google_news (7,786 articles)
   └─ NFL Transactions → bronze_nfl_transactions (125 transactions)
        ↓ (waits for success)
Task 2: Gold Transformation (5 min)
   └─ Runs: /Repos/.../01_Ingestion/Gold/Gold Layer - Player Consolidation
   └─ Updates: gold_enriched_news, export_player_news
        ↓ (waits for success)
Task 3: R2 Export (2 min)
   └─ Runs: /Repos/.../06_Exports/Export Fantasy News to R2
   └─ Uploads: export_player_news → R2 → UI
        ↓
✅ UI sees fresh articles
```

**Output Validation:**
- ✅ Bronze tables updated? Check `MAX(fetched_at)` = TODAY
- ✅ Gold tables updated? Check `gold_enriched_news` row count > 86
- ✅ R2 export succeeded? Check UI article count matches gold table

**Critical Note:** If Task 1 completes but UI shows old data, Tasks 2 and 3 did not run. Always verify the full chain.

---

### Other Scheduled Jobs

**Weekly Stats Ingestion**
- Schedule: Daily at 8:00 AM UTC
- Flow: Bronze → Silver → Gold → ML Features
- Output: R2 export for player stats

**ML Model Training**
- Schedule: Weekly on Sundays at 10:00 AM UTC
- Flow: Gold features → Model training → Predictions → R2 export
- Output: R2 export for predictions

**Breakout Predictions**
- Schedule: Daily at 9:00 AM UTC
- Flow: ML predictions → R2 export
- Output: R2 export for breakout candidates

---

## Repository Structure

### Notebook Inventory (60 notebooks)

#### 📥 Bronze Layer - Data Ingestion (34 notebooks)
**Location:** `/notebooks/01_Ingestion/Bronze/`

**Active Production Notebooks:**
1. `Player_News_Ingestion_Sleeper_API.ipynb` - Sleeper player news API (daily)
2. `ESPN News API Ingestion.ipynb` - ESPN news articles (daily)
3. `Google News RSS Ingestion.ipynb` - Google News RSS feed (daily)
4. `NFL Transactions Ingestion.ipynb` - NFL.com transaction wire (daily)
5. `API-Sports.io NFL Ingestion.ipynb` - Game stats from API-Sports (daily)
6. `ESPN Public API Ingestion.ipynb` - ESPN player metadata (weekly)
7. `Sleeper Ownership - Public Leagues.ipynb` - Ownership percentages (weekly)
8. `Import nflverse Player Data.ipynb` - Historical stats from nflverse (weekly)

**Development/Testing Notebooks:**
9. `00_api_test.ipynb` - API endpoint testing
10. `01_bronze_ingestion.py` - Generic bronze template
11. `02_bronze_ingestion.py` - Alternative bronze pattern
12. `02_silver_normalization.py` - Silver transformation template
13. `03_player_metadata_ingestion.py` - Player metadata
14. `04_league_ingestion.py` - League settings
15. `05_roster_ingestion.py` - Team rosters
16. `06_matchups_ingestion.py` - Weekly matchups
17. `07_news_ingestion.py` - News aggregation
18. `08_silver_domain_normalization.py` - Domain normalization
19. `09_injuries_ingestion.ipynb` - Injury reports
20. `10_stats_ingestion.ipynb` - Stats aggregation
21. `11_fantasydata_ingestion.ipynb` - FantasyData.com API
22. `11_projections_ingestion.ipynb` - Projection data
23. `13_espn_fantasy_ingestion.ipynb` - ESPN fantasy data
24. `14_nflverse_ingestion.ipynb` - nflverse library
25. `15_fantasy_data_pros_ingestion.ipynb` - FantasyPros API
26. `15_sleeper_api_ingestion.ipynb` - Sleeper API
27. `16_api_football_rapidapi_ingestion.ipynb` - RapidAPI football
28. `17_nflverse_schedules_ingestion.ipynb` - NFL schedules
29. `17_thesportsdb_ingestion.ipynb` - TheSportsDB API
30. `18_weatherapi_com_ingestion.ipynb` - Weather data
31. `19_injury_ingestion_historical.ipynb` - Historical injuries
32. `19_openweathermap_ingestion.ipynb` - OpenWeatherMap
33. `20_worldweatheronline_ingestion.ipynb` - WorldWeatherOnline
34. `Player News Sources - API Evaluation.ipynb` - Source comparison

#### 🔄 Silver Layer - Data Transformation (0 notebooks)
**Location:** `/notebooks/01_Ingestion/Silver/`

**Status:** No dedicated Silver notebooks. Transformations handled in Bronze or Gold layers.

#### ✨ Gold Layer - Business Logic (1 notebook)
**Location:** `/notebooks/01_Ingestion/Gold/`

1. `Gold Layer - Player Consolidation.ipynb` - Master player deduplication, news enrichment

#### 🤖 ML Training (4 notebooks)
**Location:** `/notebooks/03_ML_Training/`

1. `ml_feature_engineering.ipynb` - Create ml_player_features (70 features)
2. `ml_prediction_data_prep.ipynb` - Prepare training datasets
3. `ml_prediction_model_training.ipynb` - Train XGBoost models (QB/RB/WR/TE)
4. `ML Model Enhancement Analysis.ipynb` - Model evaluation and tuning

#### 📦 ML Registration (3 notebooks)
**Location:** `/notebooks/04_ML_Registration/`

1. `ml_model_registration.ipynb` - Register models to MLflow
2. `ml_vector_search.ipynb` - Vector search for player similarity
3. `fantasai_chat_api.ipynb` - Chat API integration

#### ⏰ Scheduled Jobs (7 notebooks)
**Location:** `/notebooks/05_Scheduled_Jobs/`

1. `00_News_Ingestion_Master_Orchestrator.ipynb` - Daily news orchestrator
2. `00_ML_Training_Master_Orchestrator.ipynb` - Weekly ML training orchestrator
3. `API-Sports.io - Scheduled Daily Update.ipynb` - Daily stats job
4. `ESPN Public API - Scheduled Weekly Update.ipynb` - Weekly ESPN job
5. `nflverse - Scheduled Weekly Update.ipynb` - Weekly nflverse job
6. `Sleeper API - Scheduled Weekly Update.ipynb` - Weekly Sleeper job
7. `R2 Export - Analysis Data.ipynb` - Daily analytics export

#### 📤 Exports (3 notebooks)
**Location:** `/notebooks/06_Exports/`

1. `Export Fantasy News to R2.ipynb` - News export (integrated into orchestrator)
2. `Export Breakout Predictions to R2.ipynb` - Breakout candidates export
3. `fantasai_chat_api_deployment.ipynb` - API deployment

---

### Expected Notebook-to-Job Mapping

**After consolidation (17 jobs → 60 notebooks):**

| Job Name | Notebooks Used | Count |
|----------|----------------|-------|
| News Ingestion Orchestrator | Sleeper News, ESPN News, Google RSS, NFL Transactions, Gold Consolidation, Export News | 6 |
| Article Labeling Feedback | (TBD - not yet created) | 1 |
| API-Sports Daily | API-Sports Ingestion | 1 |
| Daily Player Analytics | (Uses views, no dedicated notebook) | 0 |
| Export Analysis to R2 | R2 Export - Analysis Data | 1 |
| nflverse Weekly Stats | nflverse Ingestion | 1 |
| Sleeper API Weekly | Sleeper Ownership | 1 |
| ESPN Public API Weekly | ESPN Public API Ingestion | 1 |
| ML Training Orchestrator | Feature Engineering, Data Prep, Model Training | 3 |
| Breakout Predictions | Export Breakout Predictions | 1 |
| Defense Rankings | (TBD - not yet created) | 0 |
| ADP Pipeline | (TBD - not yet created) | 0 |
| Export Draft Data | (TBD - not yet created) | 0 |
| Weekly Injury Updates | Injury Ingestion | 1 |
| Opportunity Score Calc | (Uses views, no dedicated notebook) | 0 |
| Vegas Totals Refresh | (TBD - not yet created) | 0 |
| Stats Ingestion | Stats Ingestion | 1 |
| **TOTAL** | | **18 notebooks** |

**Notebook Usage:**
- 💚 **Active in jobs:** 18 notebooks
- 🟡 **Development/testing:** 34 notebooks
- 🔴 **Archived/unused:** 8 notebooks

**Rule:** If a job exists without a documented notebook, or a production notebook exists without a job, documentation is incomplete.

---

## End-to-End Workflow

### Adding a New Data Source

**Example: Adding a new news source (e.g., ProFootballTalk RSS)**

1. **Create Bronze Ingestion Notebook**
   - Path: `/notebooks/01_Ingestion/Bronze/PFT_News_Ingestion.ipynb`
   - Output table: `main.fantasai.bronze_pft_news`

2. **Add to News Orchestrator**
   - Edit: `/notebooks/05_Scheduled_Jobs/00_News_Ingestion_Master_Orchestrator.ipynb`
   - Add config flag: `RUN_PFT_NEWS = True`
   - Add notebook run: `dbutils.notebook.run("/Repos/.../PFT_News_Ingestion", ...)`

3. **Update Gold Transformation**
   - Edit: `/notebooks/01_Ingestion/Gold/Gold Layer - Player Consolidation.ipynb`
   - Add UNION to include `bronze_pft_news` in `gold_enriched_news`

4. **Verify R2 Export**
   - The existing R2 export notebook reads from `export_player_news`
   - No changes needed IF gold transformation populates that table

5. **Test End-to-End**
   - Run orchestrator job manually
   - Verify bronze table has data: `SELECT COUNT(*) FROM bronze_pft_news`
   - Verify gold table has data: `SELECT COUNT(*) FROM gold_enriched_news WHERE source = 'pft'`
   - Verify UI shows new articles

6. **Update This Document**
   - Add new source to "Data Sources" section
   - Update "News Ingestion Pipeline" flow diagram
   - Document expected row counts

**Rule: If you can't trace data from source → bronze → gold → R2 → UI, the pipeline is incomplete.**

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
