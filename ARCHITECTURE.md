# FantasAI System Architecture

**Last Updated:** June 16, 2026  
**Version:** 3.3  
**Platform:** Local Python / DuckDB / Windows Task Scheduler

> **Migration Notice (June 15, 2026):** Databricks infrastructure (30 jobs, Unity Catalog, 79 Delta tables) has been decommissioned. The full ETL pipeline now runs locally on the RTX 4080 server using DuckDB as the data warehouse. All notebook logic has been converted to standalone Python scripts under `local_processing/`. Cloudflare R2 exports and the frontend are unchanged.

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

## 📊 System Inventory (Last Updated: June 16, 2026)

### Current State
```
📓 NOTEBOOKS:  30 active (reference only — pipeline runs from local_processing/)
   ├─ Bronze Layer — future/reference:  13  (schedules, historical, ML data, API evals)
   ├─ Analysis:                          4  (data source comparison, player metrics)
   ├─ ML Training:                       4  (LightGBM QB/RB/WR/TE pipeline)
   ├─ ML Registration:                   3  (MLflow, vector search, chat API)
   ├─ Scheduled Jobs:                    1  (ML Training Orchestrator — Databricks ref)
   └─ Exports:                           2  (breakout predictions R2, chat API deployment)

   _Archive_20260601/:  53 files  ← all notebooks superseded by local_processing/ scripts

🗄️  DATABASE:   DuckDB (local_processing/db/fantasai.duckdb)
   ├─ Bronze tables:                   10  (+ bronze_adp_rankings, bronze_dst_weekly_stats, bronze_nfl_schedules, bronze_player_ownership, bronze_combine_data)
   ├─ Silver tables:                    4
   ├─ Gold tables:                      3
   ├─ Export tables:                    1
   ├─ Supplemental (headshots, YAC, NGS, depth):  4
   └─ Analysis (weather, DST perf):     3  (weather_forecasts, weather_historical, bronze_dst_weekly_stats)

⚙️ JOBS:       2 Windows Task Scheduler tasks (replaced 30 Databricks jobs)
   ├─ orchestrator_daily.py    — 7:00 AM daily  (Sleeper → ESPN → Google → Gold → R2)
   └─ orchestrator_weekly.py   — Tuesday 3:00 AM (nflverse → API-Sports → ADP → DST → Schedules → Combine → Ownership → Gold → R2)

🤖 LOCAL AI:   Runs as Task 4 inside orchestrator_daily.py (with --skip-ai flag)
   ├─ job1_news_processor.py   — Qwen 8B, bulk news enrichment
   ├─ job2_fantasy_analyzer.py — Qwen 14B, fantasy scoring + drop/waiver/trade/lineup
   ├─ job3_player_writeups.py  — Qwen 14B, nightly (rostered) + Sunday (all players)
   └─ pipeline_runner.py       — watcher / sequencer for Jobs 1-2 (standalone mode)
```

### Validation Rule

**This document is OUT OF DATE if:**
- New data sources exist without Bronze notebooks AND without `local_processing/ingest/` scripts
- Exports to R2 exist without a corresponding key in `local_processing/export/export_to_r2.py`

**To validate local pipeline state:**
```bash
# Count Python scripts in local pipeline
ls local_processing/ingest/ local_processing/gold/ local_processing/export/

# Check DuckDB tables
python -c "import duckdb; c=duckdb.connect('local_processing/db/fantasai.duckdb'); print(c.execute('SHOW TABLES').fetchall())"

# Check Task Scheduler jobs
# PowerShell: Get-ScheduledTask -TaskPath "\FantasAI\"
```

**Update this section when:**
- ✅ Adding new `local_processing/ingest/` scripts
- ✅ Adding new R2 export keys
- ✅ Adding new DuckDB tables in `local_processing/db.py`

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

**Last Updated:** June 13, 2026  
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
- ✅ **Player writeups** (Job 3) — 2-3 paragraph narrative profiles grounded in real 2025 stats

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
│              (Local Python Pipeline — RTX 4080 Server)           │
├─────────────────────────────────────────────────────────────────┤
│  Daily (7:00 AM):                                               │
│    orchestrator_daily.py                                         │
│    → ingest_sleeper_players.py  (Sleeper API, ESPN IDs)         │
│    → ingest_espn_news.py        (ESPN News API)                 │
│    → ingest_google_news.py      (Google News RSS)               │
│    → ingest_nfl_transactions.py (ESPN Transactions)             │
│    → gold_player_consolidation.py                               │
│    → export_to_r2.py            (all JSON exports → Worker API) │
│                                                                  │
│  Weekly Tue 3:00 AM:                                            │
│    orchestrator_weekly.py                                        │
│    → ingest_nflverse.py         (nfl_data_py: stats, NGS, YAC) │
│    → ingest_apisports.py        (API-Sports.io game stats)      │
│    → ingest_sleeper_players.py                                   │
│    → ingest_adp.py              (FantasyPros PPR+Std+DST)       │
│    → ingest_dst_performance.py  (Sleeper DST pts_ppr)           │
│    → ingest_schedules.py        (nflverse game schedule)        │
│    → ingest_combine.py          (nflverse combine measurables)  │
│    → ingest_ownership.py        (Sleeper public league crawl)   │
│    → gold_player_consolidation.py → export_to_r2.py             │
│                                                                  │
│  Database: local_processing/db/fantasai.duckdb                  │
│    Bronze → Silver → Gold → Export tables                       │
└───────────────────────────┬─────────────────────────────────────┘
                            │ export_to_r2.py
                            │ PUT https://api.fantasai.net/api/v1/r2/{key}
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│                      R2 Storage (Enriched Data)                  │
│  player_news.json | injury_report.json | player_scores.json     │
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
│    • Player writeups (job3_player_writeups.py)                  │
└───────────────────────────┬─────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│              R2 Storage (AI-Enriched Scores)                     │
│  player_notes.json | ai_summaries.json | player_scores.json     │
└───────────────────────────┬─────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│                 STAGE 3: API LAYER                               │
│                  (Cloudflare Workers — api.fantasai.net)         │
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

**Notebooks (consolidated June 15, 2026):**
- `notebooks/01_Ingestion/Bronze/article_labeling_feedback_ingestion.py` (bronze ingestion)
- `notebooks/01_Ingestion/Gold/gold_player_mapping_corrections.py` (gold transformation)

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

**Last Updated:** June 15, 2026

> **Note:** Databricks jobs (30 total) were decommissioned June 15, 2026. All scheduling now runs via Windows Task Scheduler on the local RTX 4080 server.

### Critical Rule: Every Ingestion Job Must Have a Documented Output Path

**If data is ingested but not exported to R2, the UI will not see it. Always validate end-to-end flow.**

---

## Local Pipeline Jobs (Windows Task Scheduler)

**Register all tasks:**
```powershell
# See registration commands in each orchestrator's module docstring:
#   local_processing/orchestrator_daily.py
#   local_processing/orchestrator_weekly.py
```

### Daily Pipeline — `orchestrator_daily.py`

**Schedule:** 7:00 AM daily  
**Task Scheduler Name:** `FantasAI - Daily Pipeline`  
**Duration:** ~20 minutes

| Phase | Script | Output |
|-------|--------|--------|
| 1 | ingest_sleeper_players.py | bronze_player_news_raw (w/ ESPN IDs), silver tables |
| 1 | ingest_espn_news.py | bronze_player_news_espn_api |
| 1 | ingest_google_news.py | bronze_google_news (7-day rolling) |
| 1 | ingest_nfl_transactions.py | bronze_nfl_transactions |
| 2 | gold_player_consolidation.py | gold_player_dim, gold_player_id_mapping, gold_weekly_stats |
| 3 | export_to_r2.py | 11 JSON keys → R2 via Worker API |

**R2 Keys Written:**
- `fantasai/news/player_notes.json`, `injury_report.json`, `critical_alerts.json`
- `fantasai/news/enriched_news.json`, `player_news.json`
- `fantasai/analysis/breakout_candidates.json`, `nfl_transactions.json`, `trending_players.json`, `injury_overlay.json`
- `fantasai/players/export_players_2026_draft.json`
- `fantasai/stats/gold_weekly_stats.json`

---

### Weekly Pipeline — `orchestrator_weekly.py`

**Schedule:** Tuesday 3:00 AM  
**Task Scheduler Name:** `FantasAI - Weekly Stats Orchestrator`  
**Duration:** ~60 minutes

| Phase | Script | Output |
|-------|--------|--------|
| 1 | ingest_nflverse.py | headshots, YAC, NGS, depth_charts, silver_weekly_stats |
| 1 | ingest_apisports.py | bronze_weekly_stats (source=api_sports) |
| 1 | ingest_sleeper_players.py | bronze_player_news_raw refresh |
| 1 | ingest_adp.py | bronze_adp_rankings (PPR + Standard + DST) |
| 1 | ingest_dst_performance.py | bronze_dst_weekly_stats (32 teams × N weeks) |
| 1 | ingest_schedules.py | bronze_nfl_schedules (570 games — 2 R2 keys) |
| 1 | ingest_ownership.py | bronze_player_ownership (ownership % — non-fatal) |
| 1 | ingest_combine.py | bronze_combine_data (NFL Combine measurables, 2023-2025) |
| 2 | gold_player_consolidation.py | gold tables refreshed |
| 3 | export_to_r2.py | Full R2 sync |

**Free-tier limits:** API-Sports.io = 100 req/day (1 + N_games per run). Runs weekly to stay within quota.

**R2 Keys Written (weekly, in addition to daily keys):**
- `players/adp_ppr.json`, `players/adp_standard.json`
- `analysis/gold_adp_defense.json`, `fantasai/analysis/gold_adp_defense.json`
- `analysis/defense_performance.json`, `fantasai/analysis/defense_performance.json`
- `fantasai/analysis/weather_forecast.json`
- `fantasai/analysis/nfl_schedule.json`, `fantasai/analysis/opponent_lookup.json`
- `fantasai/analysis/player_ownership.json`
- `fantasai/analysis/combine_data.json`
- `fantasai/analysis/performance_trends.json` (from `export_to_r2.py`, requires gold_weekly_stats data)

---

### Local Qwen Pipeline Jobs (Windows Task Scheduler)

These jobs run on the local RTX 4080 server via Windows Task Scheduler and upload results directly to R2.

#### Job 1 — News Processor (`job1_news_processor.py`)
**Model:** Qwen3 8B  
**Schedule:** Triggered by pipeline watcher (R2 new-data signal), or manually  
**Mode:** Incremental by default — skips articles already in cache  
**Input:** `fantasai/news/enriched_news.json` (R2)  
**Output:** `fantasai/news/player_notes.json`, `fantasai/news/ai_summaries.json` (R2)

---

#### Job 2 — Fantasy Analyzer (`job2_fantasy_analyzer.py`)
**Model:** Qwen3 14B  
**Schedule:** Runs after Job 1 completes (via `pipeline_runner.py`)  
**Mode:** Incremental — skips players whose relevance score hasn't changed by > 0.5  
**Input:** `fantasai/news/player_notes.json` (R2)  
**Output:** `fantasai/analysis/player_scores.json` (R2) → ingested to Databricks Gold

---

#### Job 3a — Player Writeups: Rostered (`job3_player_writeups.py --mode rostered`)
**Model:** Qwen3 14B  
**Schedule:** Nightly at **2:00 AM** (Windows Task Scheduler: `FantasAI - Job3 Rostered Writeups (Nightly)`)  
**Execution time limit:** 3 hours  
**Players:** ~180 players — live CBS roster data when cookie is valid; falls back to ADP top-200 proxy when CBS is unavailable  
**Cache behavior:** Skips any player generated within the last **20 hours** (safe to re-run)  
**Output:** `players/player_writeups.json` (R2) — merged with existing entries  

**PowerShell to register:**
```powershell
$action = New-ScheduledTaskAction `
    -Execute "C:\Python314\python.exe" `
    -Argument "D:\Project\Fantasy\local_processing\job3_player_writeups.py --mode rostered" `
    -WorkingDirectory "D:\Project\Fantasy\local_processing"
$trigger = New-ScheduledTaskTrigger -Daily -At "02:00AM"
$settings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit (New-TimeSpan -Hours 3) -StartWhenAvailable -DontStopOnIdleEnd
Register-ScheduledTask -TaskName "FantasAI - Job3 Rostered Writeups (Nightly)" -TaskPath "\FantasAI\" -Action $action -Trigger $trigger -Settings $settings -RunLevel Highest -Force
```

---

#### Job 3b — Player Writeups: All Players (`job3_player_writeups.py --mode all`)
**Model:** Qwen3 14B  
**Schedule:** Weekly, **Sunday at 3:00 AM** (Windows Task Scheduler: `FantasAI - Job3 All Player Writeups (Weekly)`)  
**Execution time limit:** 10 hours  
**Players:** ~977 skill position players (QB/RB/WR/TE with games, news, or ADP rank)  
**Cache behavior:** Skips any player generated within the last **6 days** (safe to re-run)  
**Output:** `players/player_writeups.json` (R2) — incremental merge, preserves nightly rostered writeups  

**PowerShell to register:**
```powershell
$action2 = New-ScheduledTaskAction `
    -Execute "C:\Python314\python.exe" `
    -Argument "D:\Project\Fantasy\local_processing\job3_player_writeups.py --mode all" `
    -WorkingDirectory "D:\Project\Fantasy\local_processing"
$trigger2 = New-ScheduledTaskTrigger -Weekly -WeeksInterval 1 -DaysOfWeek Sunday -At "03:00AM"
$settings2 = New-ScheduledTaskSettingsSet -ExecutionTimeLimit (New-TimeSpan -Hours 10) -StartWhenAvailable -DontStopOnIdleEnd
Register-ScheduledTask -TaskName "FantasAI - Job3 All Player Writeups (Weekly)" -TaskPath "\FantasAI\" -Action $action2 -Trigger $trigger2 -Settings $settings2 -RunLevel Highest -Force
```

**Job 3 R2 Output Format:**
```json
{
  "generated_at": "2026-06-13T02:00:00Z",
  "model": "qwen3:14b",
  "mode": "rostered",
  "player_count": 178,
  "players": {
    "Bijan Robinson": {
      "player_name": "Bijan Robinson",
      "position": "RB",
      "team": "ATL",
      "writeup": "Bijan Robinson dominated in 2025, rushing for 1,456 yards...",
      "summary": "Bijan Robinson dominated in 2025, rushing for 1,456 yards.",
      "injury_status": "Active",
      "adp_rank_ppr": 3,
      "generated_at": "2026-06-13T02:14:22Z",
      "_cache_key": "a3f92b1c4d7e",
      "_mode": "rostered"
    }
  }
}
```

**Rostered Player Detection (priority order):**
1. `GET /api/v1/cbs/players` — live CBS roster sync (requires valid CBS cookie)
2. `percent_owned > 0` in `fantasai/players/export_players_2026_draft.json` R2 export
3. ADP rank ≤ 200 fallback (covers all roster spots + handcuffs when CBS unavailable)

**To verify Task Scheduler jobs:**
```powershell
Get-ScheduledTask -TaskPath "\FantasAI\"
```

---

### News Ingestion Pipeline (Daily)

**Schedule:** 7:00 AM daily via `orchestrator_daily.py`

**End-to-End Flow:**
```
Phase 1: Ingest (~15 min)
   ├─ Sleeper API → bronze_player_news_raw (4,000+ players, includes espn_id)
   ├─ ESPN News API → bronze_player_news_espn_api (uses espn_id from Sleeper)
   ├─ Google News RSS → bronze_google_news (7-day window, 60-day purge)
   └─ NFL Transactions → bronze_nfl_transactions (MD5-dedup)
        ↓
Phase 2: Gold Consolidation (~3 min)
   └─ gold_player_consolidation.py
   └─ Updates: gold_player_dim, gold_player_id_mapping, gold_weekly_stats
        ↓
Phase 3: R2 Export (~2 min)
   └─ export_to_r2.py → PUT api.fantasai.net/api/v1/r2/{key}
        ↓
✅ UI sees fresh data
```

**Output Validation:**
```python
import duckdb
c = duckdb.connect("local_processing/db/fantasai.duckdb")
# Bronze updated today?
print(c.execute("SELECT MAX(fetched_at) FROM bronze_player_news_raw").fetchone())
# Gold updated?
print(c.execute("SELECT COUNT(*) FROM gold_player_dim").fetchone())
```

---

### Stats Ingestion Pipeline (Weekly)

**Schedule:** Tuesday 3:00 AM via `orchestrator_weekly.py`

```
Phase 1: Ingest (~60 min)
   ├─ nflverse (headshots, YAC, NGS, depth_charts, weekly_stats)
   ├─ API-Sports.io (bronze_weekly_stats, source=api_sports)
   ├─ Sleeper API (refresh bronze_player_news_raw)
   ├─ FantasyPros ADP (bronze_adp_rankings: PPR + Standard + DST)
   ├─ Sleeper Stats API (bronze_dst_weekly_stats: DST pts_ppr all 32 teams)
   ├─ nflverse schedules (bronze_nfl_schedules: home/away, venue, scores)
   ├─ nflverse combine (bronze_combine_data: 40-time, bench, vertical, etc.)
   └─ Sleeper public leagues (bronze_player_ownership: ownership % — non-fatal)
        ↓
Phase 2: Gold Consolidation (~3 min)
        ↓
Phase 3: R2 Export (~2 min)
        ↓
✅ Updated stats available in UI
```

---

## Repository Structure

> **Note:** Notebooks in `/notebooks/` are historical reference for data source logic. The active production pipeline is under `local_processing/`. Do not run notebooks directly — they contain Databricks/PySpark code that will not work locally.

### Local Pipeline (`local_processing/`)

```
local_processing/
├── db.py                          # DuckDB connection + schema init (24 tables)
├── db/
│   └── fantasai.duckdb            # Single-file data warehouse (D: drive)
├── ssl_utils.py                   # Windows certificate store injection (truststore)
├── orchestrator_daily.py          # Daily 7AM: news → gold → R2 (+ AI as Task 4)
├── orchestrator_weekly.py         # Tue 3AM: stats → ADP → DST → schedules → combine → ownership → gold → R2
├── ingest/
│   ├── ingest_sleeper_players.py  # Sleeper API (bronze_player_news_raw + espn_id)
│   ├── ingest_espn_news.py        # ESPN News API (uses espn_id from Sleeper)
│   ├── ingest_google_news.py      # Google News RSS (feedparser, 60-day rolling)
│   ├── ingest_nfl_transactions.py # ESPN Transactions API (MD5 dedup)
│   ├── ingest_apisports.py        # API-Sports.io game stats (100 req/day limit)
│   ├── ingest_nflverse.py         # nfl_data_py: headshots, YAC, NGS, depth, stats
│   ├── ingest_adp.py              # FantasyPros ADP (PPR + Standard + DST via HTML scrape)
│   ├── ingest_weather.py          # WorldWeatherOnline 7-day forecasts (22 outdoor stadiums)
│   ├── ingest_dst_performance.py  # Sleeper Stats API: weekly DST fantasy scores (all 32 teams)
│   ├── ingest_schedules.py        # nflverse: NFL game schedule (home/away, venue, scores) → 2 R2 keys
│   ├── ingest_ownership.py        # Sleeper: public league crawl → player ownership % → R2
│   └── ingest_combine.py          # nflverse: NFL Combine measurables (40-time, bench, vertical, etc.)
├── gold/
│   └── gold_player_consolidation.py  # master_player_id (SHA-256), gold tables
├── export/
│   └── export_to_r2.py            # PUT api.fantasai.net/api/v1/r2/{key} (15+ keys)
├── job1_news_processor.py         # Qwen 8B: article enrichment (bulk, incremental)
├── job2_fantasy_analyzer.py       # Qwen 14B: fantasy scores + drop/waiver/trade/lineup
├── job3_player_writeups.py        # Qwen 14B: player narrative writeups
├── pipeline_runner.py             # Watcher/sequencer for Jobs 1-2 (standalone mode)
└── chat_server.py                 # Local chat API server
```

### DuckDB Schema (`local_processing/db.py`)

| Layer | Table | Source |
|-------|-------|--------|
| Bronze | bronze_player_news_raw | Sleeper API (includes espn_id) |
| Bronze | bronze_player_news_espn_api | ESPN News API |
| Bronze | bronze_google_news | Google News RSS |
| Bronze | bronze_nfl_transactions | ESPN Transactions |
| Bronze | bronze_weekly_stats | API-Sports.io |
| Bronze | bronze_adp_rankings | FantasyPros HTML scrape (PPR + Standard + DST) |
| Bronze | bronze_dst_weekly_stats | Sleeper Stats API (DST pts_ppr per week per team) |
| Bronze | bronze_nfl_schedules | nflverse: game_id, week, home/away teams, scores, venue, roof |
| Bronze | bronze_player_ownership | Sleeper public leagues: ownership_pct per player_id |
| Bronze | bronze_combine_data | nflverse: 40-time, bench, vertical, cone, shuttle per draft class |
| Silver | silver_player_news | Normalized from Sleeper (7-day) |
| Silver | silver_injury_reports | Injury status from Sleeper |
| Silver | silver_trending_players | Trending from Sleeper |
| Silver | silver_weekly_stats | Aggregated game stats |
| Supplemental | player_headshots | nfl_data_py |
| Supplemental | player_yac_stats | nfl_data_py play-by-play |
| Supplemental | player_nextgen_stats | NGS (YACOE) |
| Supplemental | depth_charts | nfl_data_py |
| Gold | gold_player_dim | SHA-256 master_player_id |
| Gold | gold_player_id_mapping | Cross-source ID mapping |
| Gold | gold_weekly_stats | Aggregated stats (all sources) |
| Export | export_player_news | Frontend-ready news feed |
| Weather | weather_forecasts | WorldWeatherOnline 7-day per-team (full replace each run) |
| Weather | weather_historical | WorldWeatherOnline historical per-team per-date (append) |

### Notebook Reference (`notebooks/`)

> **Rule:** Do NOT run these notebooks directly. All contain Databricks/PySpark code (`spark`, `dbutils`, `%python` magic). They are retained as blueprints for logic that may be ported to `local_processing/` in the future.

#### 📥 Bronze Layer — Future/Reference (13 notebooks)
**Location:** `/notebooks/01_Ingestion/Bronze/` and `/notebooks/01_Ingestion/` root

| Notebook | Status | Notes |
|---|---|---|
| `17_nflverse_schedules_ingestion.ipynb` | ✅ Ported | → `ingest/ingest_schedules.py` — 570 games (2024+2025), 3 R2 keys |
| `Sleeper Ownership - Public Leagues.ipynb` | ✅ Ported | → `ingest/ingest_ownership.py` — public league crawl → `player_ownership.json` |
| `14_nflverse_ingestion.ipynb` | 🟢 Reference | 10-year nflverse stats (2016-2025) — ML training history |
| `15_fantasy_data_pros_ingestion.ipynb` | 🟢 Reference | 22 seasons historical (1999-2020) — deep ML training data |
| `19_injury_ingestion_historical.ipynb` | 🟢 Reference | Historical injuries 2016-2026 — ML feature engineering |
| `NFL_Draft_Capital_Ingestion.py` | 🟢 Reference | 2026 NFL Draft pick capital values |
| `Defense Rankings Ingestion - FantasyPros.ipynb` | 🟢 Reference | FantasyPros DST expert rankings (covered by ingest_adp.py) |
| `00_api_test.ipynb` | 🟢 Reference | Worker API endpoint test suite |
| `10_stats_ingestion.ipynb` | 🟢 Reference | Weekly stats via Cloudflare Worker API |
| `11_fantasydata_ingestion.ipynb` | 🟢 Reference | FantasyData.com — alternative stats source |
| `11_projections_ingestion.ipynb` | 🟢 Reference | Sleeper weekly projections |
| `13_espn_fantasy_ingestion.ipynb` | 🟢 Reference | ESPN Public API game scores/stats |
| `Player News Sources - API Evaluation.ipynb` | 🟢 Reference | API source comparison analysis |

#### 🤖 ML Pipeline (11 notebooks)
**Locations:** `02_Analysis_Metrics/`, `03_ML_Training/`, `03_Predictions/`, `04_ML_Registration/`

*(LightGBM QB/RB/WR/TE training, breakout prediction engine, MLflow model registration — all Databricks-specific. Blueprint for future local ML pipeline.)*

#### ⏰ Scheduled Jobs — ML Only (1 notebook)
**Location:** `/notebooks/05_Scheduled_Jobs/`

- `00_ML_Training_Master_Orchestrator.ipynb` — ML training orchestration (Databricks reference)
- All other scheduled job notebooks archived (replaced by `orchestrator_daily.py` / `orchestrator_weekly.py`)

#### 📤 Exports — Partial Reference (2 notebooks)
**Location:** `/notebooks/06_Exports/`

- `Export Breakout Predictions to R2.ipynb` — Predictions export schema (partially replaced by job2/job3)
- `fantasai_chat_api_deployment.ipynb` — Chat API deployment reference

#### 🗄️ Archived (53 files in `_Archive_20260601/`)
All notebooks fully superseded by `local_processing/` scripts as of June 15, 2026:
- 39 notebooks moved to archive in latest consolidation pass
- 14 previously archived from databricks/ directory removal

**To see what replaced a specific archived notebook:** check the "Superseded By Local Scripts" table in `docs/LOCAL_MIGRATION_CHECKLIST.md`.

---

## End-to-End Workflow

### Adding a New Data Source

**Example: Adding a new news source (e.g., ProFootballTalk RSS)**

1. **Create ingest script**
   - Path: `local_processing/ingest/ingest_pft_news.py`
   - Add `bronze_pft_news` table to `local_processing/db.py` → `init_schema()`

2. **Add to daily orchestrator**
   - Edit: `local_processing/orchestrator_daily.py`
   - Add call in Phase 1 after existing news ingests

3. **Update Gold Consolidation**
   - Edit: `local_processing/gold/gold_player_consolidation.py`
   - Add `bronze_pft_news` to the player source UNION

4. **Add R2 export key**
   - Edit: `local_processing/export/export_to_r2.py`
   - Add export function for any new derived data

5. **Test End-to-End**
   ```python
   python local_processing/ingest/ingest_pft_news.py
   python -c "import duckdb; c=duckdb.connect('local_processing/db/fantasai.duckdb'); print(c.execute('SELECT COUNT(*) FROM bronze_pft_news').fetchone())"
   python local_processing/gold/gold_player_consolidation.py
   python local_processing/export/export_to_r2.py
   ```

6. **Update This Document**
   - Add new source to "Data Sources" section
   - Add table to DuckDB Schema table above

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
