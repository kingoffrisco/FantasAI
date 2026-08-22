# FantasAI Data Schemas

**Last Updated:** August 22, 2026
**Schema Version:** 2.0.0

> **August 22, 2026 update:** Added schemas for the endpoints/exports that shipped since June (Job 2 player scores, Job 5 deep reasoning, live scoreboard/player-stats, O-Line Index/Stability, Offensive Ecosystem, rookie scores). The `source: "databricks"` field described below in the original schemas is now misleading for most endpoints — see [API_ENDPOINTS.md](API_ENDPOINTS.md) for which endpoints are still Databricks-backed (a shrinking minority) vs. R2/local-pipeline-backed (everything else). Base URL for all R2-backed schemas below is `https://api.fantasai.net/api/v1/r2/{key}`, not `r2.yourdomain.com` as the original version of this doc stated.

---

## New Since June 2026

### Player Scores Schema (Job 2)

**Endpoint:** `fantasai/analysis/player_scores.json`

| Field | Type | Description |
|---|---|---|
| `player_name` | string | Player's full name |
| `position` | string | Player position |
| `team` | string | Team abbreviation |
| `week` | number | NFL week scored for |
| `waiver_score` | number | 0-10 |
| `trade_buy_score` | number | 0-10 |
| `trade_sell_score` | number | 0-10 |
| `start_score` | number | 0-10 |
| `sit_score` | number | 0-10 |
| `injury_risk` | number | 0-10 |
| `dynasty_score` | number | 0-10 |
| `matchup_score` | number | 0-10 |
| `rookie_score` | number | 0-10 |

Four derived files are written alongside the master file, each a filtered/re-sorted view: `fantasai/analysis/waiver_wire_recommendations.json`, `trade_values.json`, `lineup_recommendations.json`, `drop_candidates.json`.

### Deep Reasoning Schema (Job 5, new)

**Endpoint:** `fantasai/analysis/deep_reasoning.json`
**Schema file:** `app/schemas/deep_reasoning_schema.json`

Generated weekly (Wed 1:30 AM) by Qwen3 30B for the top ~20 highest-signal candidates only (ranked by Job 2 scores + breakout opportunity score) — this is NOT a full-roster export.

| Field | Type | Description |
|---|---|---|
| `player_name` | string | Player's full name |
| `position` | string | Player position |
| `team` | string | Team abbreviation |
| `breakout_score` | number | 0-100 |
| `confidence` | number | 0-100 |
| `primary_reason` | string | LLM-generated rationale |
| `risk_flag` | string | Key risk factor |
| `recommendation` | string | `"BUY"`, `"HOLD"`, or `"AVOID"` |
| `_consistency_warning` | string \| null | Flags internal contradictions, e.g. a BUY recommendation paired with a low breakout_score |
| `_elapsed_sec` | number | Generation time for this player (typically 1-3s) |

Sample data available in `local_processing/job5_deep_reasoner_dry_run.json`.

### Live Scoreboard Schema (new — replaces direct ESPN calls)

**Endpoint:** `fantasai/live/scoreboard_{season}_{type}_{week}.json`

Written by `local_processing/job_live_scores.py` (hourly auto-poll, tightens cadence during live windows). Read via `GET /api/v1/nfl/scoreboard?week=&season=&type=`. Shape is a normalized port of ESPN's scoreboard response — game status, home/away teams, scores, clock/period. See `local_processing/job_live_scores_dry_run.json` for a real sample (2026 preseason, e.g. CIN 16-14 DET).

### Live Player Stats Schema (new)

**Endpoint:** `fantasai/live/player_stats_{season}_{type}_{week}.json`

Written by the same job. Per-player live box-score stats used for real-time fantasy scoring in the Head-to-Head screen. Sample fields per player: `rec`, `recYds`, `rushAtt`, `rushYds`, `pts`, etc. — the exact fantasy-point calculation (`calcFantasyPts`) is duplicated in three places that must stay in sync: `job_live_scores.py`, `worker-api/src/index.js`'s `handleNflPlayerStats`, and `app/src/lib/liveScoring.js`.

**Note:** both live keys are per-(season, type, week) and permanent — historical weeks remain queryable, never overwritten. A discovery index is also written at `fantasai/live/index.json`.

### O-Line Index Schema (new)

**Endpoints:** `fantasai/analysis/oline_index.json` (team-level), `fantasai/analysis/player_team_history.json`

Proprietary pass/run block quality score computed from nflverse play-by-play data (no PFF dependency), percentile-ranked per team/season. `player_team_history.json` tracks which team a player played for each season, for trade-aware context.

### O-Line Stability Schema (new)

**Endpoints:** `fantasai/analysis/oline_stability.json` (team-level OLSI), `fantasai/analysis/player_oline_stability.json` (per-lineman)

O-Line Stability Index — a continuity/chemistry/health/experience/penalties composite. Depends on real per-week O-line lineup history (`depth_chart_history`, 2021-2025) and the O-Line Index above.

### Offensive Ecosystem Schema (new)

**Endpoints:** `fantasai/analysis/player_weapon_scores.json` (WR/TE/RB), `fantasai/analysis/team_support_scores.json` (QB)

Percentile-composite "Player Weapon Score" for pass-catchers and a QB "Support Score" / ESCV (Environment-Supported Composite Value) combining O-Line quality, weapon quality, pace, and red-zone opportunity.

### Rookie Scores Schema (new)

**Endpoint:** `fantasai/analysis/rookie_scores.json`

0-100 rookie score per position, weighting draft capital + athleticism (combine) + landing-spot opportunity, with fantasy point projections via historical cohort curves. Computed internally (`ingest_rookie_scores.py`), no new external fetch — reads combine, draft, and depth-chart data already in DuckDB. Complements college production data from `ingest_cfbd.py` (College Football Data API).

### Weekly Start/Sit Schema (Job 4, new)

**Endpoint:** `fantasai/analysis/weekly_startsit.json`

Hybrid deterministic-score + LLM-narrative recommendation. Weighting: 30% projection vs. baseline, 20% matchup, 20% opportunity, 15% team environment, 10% recent trend, 5% weather/injury.

---

## Combined Player News Schema

**Endpoint:** `fantasai/analysis/player_news.json`

### Fields

| Field | Type | Required | Description | Example |
|-------|------|----------|-------------|----------|
| `news_id` | string | Yes | Unique identifier for the news article | `"enriched_b29f2566-9a37-3d87-9b69-9d1264e86616"` |
| `headline` | string | Yes | Article headline | `"Justin Jefferson questionable for Week 15"` |
| `source_url` | string | Yes | Original article URL | `"https://espn.com/..."` |
| `full_text` | string | Yes | Complete article text | `"Vikings WR Justin Jefferson..."` |
| `player_id` | string | Yes | Sleeper player ID | `"sleeper_123"` |
| `player_name` | string | Yes | Player's full name | `"Justin Jefferson"` |
| `position` | string | Yes | Player position | `"WR"`, `"RB"`, `"QB"`, `"TE"`, `"K"` |
| `team` | string | Yes | Team abbreviation (3 letters) | `"MIN"`, `"DAL"`, `"KC"` |
| `summary_text` | string | Yes | AI-generated concise summary | `"Jefferson limited in practice with ankle..."` |
| `fantasy_insight` | string | Yes | AI fantasy impact analysis | `"Concerning for Week 15 lineups. Monitor practice reports."` |
| `impact_score` | number | Yes | Fantasy relevance score (0-10) | `8.5` |
| `impact_category` | string | Yes | Type of impact | `"injury"`, `"trade"`, `"performance"`, `"depth_chart"`, `"opportunity"` |
| `published_at` | string (ISO 8601) | Yes | Original article publication time | `"2026-05-31T19:15:00Z"` |
| `enriched_at` | string (ISO 8601) | Yes | When article was processed | `"2026-05-31T19:34:34Z"` |
| `ai_generated_at` | string (ISO 8601) | Yes | When AI summary was created | `"2026-05-31T19:35:45Z"` |

### Metadata Schema

| Field | Type | Description |
|-------|------|-------------|
| `total_articles` | number | Total number of articles in response |
| `exported_at` | string (ISO 8601) | When export was generated |
| `source` | string | Historically always `"databricks"`; this endpoint (`fantasai/analysis/player_news.json`) is now written by the local pipeline (`export_to_r2.py`), so the field name is stale — don't rely on its value to mean "queried live from Databricks" |
| `description` | string | Endpoint description |

---

## Player Notes Schema

**Endpoint:** `fantasai/news/player_notes.json`

### Main Object Fields

| Field | Type | Required | Description | Example |
|-------|------|----------|-------------|----------|
| `player_id` | string | Yes | Sleeper player ID | `"sleeper_123"` |
| `player_name` | string | Yes | Player's full name | `"Justin Jefferson"` |
| `position` | string | Yes | Player position | `"WR"` |
| `team` | string | Yes | Team abbreviation | `"MIN"` |
| `notes` | array | Yes | Array of note objects | See below |
| `overall_sentiment` | string | Yes | Aggregated sentiment | `"positive"`, `"negative"`, `"neutral"` |
| `overall_impact_score` | number | Yes | Averaged impact score | `7.5` |
| `has_critical_news` | boolean | Yes | If any critical news exists | `true` |
| `has_injury_concern` | boolean | Yes | If injury-related news exists | `true` |
| `has_opportunity_change` | boolean | Yes | If opportunity-related news | `false` |
| `note_count` | number | Yes | Total number of notes | `3` |
| `last_updated` | string (ISO 8601) | Yes | Most recent note timestamp | `"2026-05-31T19:15:00Z"` |
| `updated_at` | string (ISO 8601) | Yes | When aggregation was updated | `"2026-06-07T08:00:00Z"` |

### Note Object Fields

| Field | Type | Required | Description | Example |
|-------|------|----------|-------------|----------|
| `note_id` | string | Yes | Unique note identifier | `"note_001"` |
| `note_text` | string | Yes | Note content | `"Limited in Wednesday practice"` |
| `impact_type` | string | Yes | Type of impact | `"injury"`, `"trade"`, `"performance"` |
| `impact_direction` | string | Yes | Direction of impact | `"positive"`, `"negative"`, `"neutral"` |
| `priority` | string | Yes | Note priority | `"high"`, `"medium"`, `"low"` |
| `source_url` | string | Yes | Source article URL | `"https://..."` |
| `published_at` | string (ISO 8601) | Yes | Note publication time | `"2026-05-31T19:15:00Z"` |
| `is_time_sensitive` | boolean | Yes | If note is time-sensitive | `true` |

---

## Draft Roster Schema

**Endpoint:** `fantasai/players/export_players_2026_draft.json`

### Fields

| Field | Type | Required | Description | Example |
|-------|------|----------|-------------|----------|
| `master_player_id` | string | Yes | Unique player ID | `"sleeper_123"` |
| `player_name` | string | Yes | Player's full name | `"Justin Jefferson"` |
| `position` | string | Yes | Player position | `"WR"` |
| `team` | string | Yes | Current team | `"MIN"` |
| `season_total_points_2025` | number | No | Total fantasy points in 2025 | `285.5` |
| `season_avg_points_2025` | number | No | Average fantasy points per game | `17.8` |
| `games_played_2025` | number | No | Games played in 2025 | `16` |
| `draft_year` | number | No | NFL draft year | `2020` |
| `forty_time` | number | No | 40-yard dash time (seconds) | `4.43` |
| `vertical_jump` | number | No | Vertical jump (inches) | `38.5` |
| `bench_reps` | number | No | Bench press reps at 225 lbs | `12` |
| `athleticism_score` | number | No | RAS athleticism score (0-10) | `9.2` |
| `total_career_points` | number | No | Career fantasy points total | `1256.3` |
| `seasons_played` | number | No | NFL seasons played | `5` |
| `career_ppg` | number | No | Career points per game | `15.7` |
| `experience_level` | string | Yes | Experience classification | `"Rookie 2026"`, `"Sophomore"`, `"Young"`, `"Veteran"` |
| `season_2025_status` | string | Yes | 2025 season availability | `"Full Season"`, `"Most Games"`, `"Limited Action"`, `"Spot Duty"`, `"No 2025 Stats"` |
| `draft_tier` | string | Yes | Fantasy draft tier | `"QB1"`, `"RB2"`, `"WR1"`, `"TE2"`, `"Flex/Depth"`, `"Unproven"` |

---

## Weekly Stats Schema

**Endpoint:** `fantasai/stats/gold_weekly_stats.json`

### Fields

| Field | Type | Required | Description | Example |
|-------|------|----------|-------------|----------|
| `master_player_id` | string | Yes | Unique player ID | `"sleeper_123"` |
| `player_name` | string | Yes | Player's full name | `"Justin Jefferson"` |
| `position` | string | Yes | Player position | `"WR"` |
| `team` | string | Yes | Team abbreviation | `"MIN"` |
| `season` | number | Yes | NFL season year | `2025` |
| `week` | number | Yes | NFL week (1-18) | `14` |
| `fantasy_points` | number | Yes | Total fantasy points | `24.3` |
| `pass_attempts` | number | No | Passing attempts (QBs) | `35` |
| `pass_completions` | number | No | Passing completions | `24` |
| `pass_yards` | number | No | Passing yards | `312` |
| `pass_tds` | number | No | Passing touchdowns | `3` |
| `interceptions` | number | No | Interceptions thrown | `1` |
| `rush_attempts` | number | No | Rushing attempts | `18` |
| `rush_yards` | number | No | Rushing yards | `87` |
| `rush_tds` | number | No | Rushing touchdowns | `1` |
| `targets` | number | No | Targets (WR/TE/RB) | `12` |
| `receptions` | number | No | Receptions | `8` |
| `receiving_yards` | number | No | Receiving yards | `125` |
| `receiving_tds` | number | No | Receiving touchdowns | `1` |
| `fumbles_lost` | number | No | Fumbles lost | `0` |
| `two_point_conversions` | number | No | 2-point conversions | `0` |
| `source` | string | Yes | Data source | `"api_sports"`, `"sleeper"` |

---

## Breakout Candidates Schema

**Endpoint:** `analysis/breakout_candidates.json`

### Fields

| Field | Type | Required | Description | Example |
|-------|------|----------|-------------|----------|
| `player_name` | string | Yes | Player's full name | `"Ryan Flournoy"` |
| `position` | string | Yes | Player position | `"WR"` |
| `team` | string | Yes | Team abbreviation | `"DAL"` |
| `snap_share_delta` | number | Yes | Change in snap share | `0.25` (25% increase) |
| `opportunity_score` | number | Yes | Breakout opportunity score (0-10) | `8.5` |
| `avg_snap_share` | number | Yes | Average snap share (0-1) | `0.65` (65% of snaps) |
| `week` | number | Yes | Week of prediction | `14` |

---

## Sleeper Picks Schema

**Endpoint:** `analysis/sleeper_picks.json`

### Fields

| Field | Type | Required | Description | Example |
|-------|------|----------|-------------|----------|
| `player_name` | string | Yes | Player's full name | `"Jauan Jennings"` |
| `position` | string | Yes | Player position | `"WR"` |
| `team` | string | Yes | Team abbreviation | `"SF"` |
| `ownership_pct` | number | Yes | League ownership % | `15.5` |
| `value_score` | number | Yes | Value rating (0-10) | `9.2` |
| `recent_trend` | string | Yes | Recent performance trend | `"up"`, `"down"`, `"stable"` |
| `recommendation` | string | Yes | Add recommendation | `"Strong Add"`, `"Add"`, `"Watch"` |

---

## Defense Performance Schema

**Endpoint:** `analysis/defense_performance.json`

### Fields

| Field | Type | Required | Description | Example |
|-------|------|----------|-------------|----------|
| `team` | string | Yes | Team abbreviation | `"BAL"` |
| `team_name` | string | Yes | Full team name | `"Baltimore Ravens"` |
| `week` | number | Yes | NFL week | `14` |
| `fantasy_points` | number | Yes | Total defense fantasy points | `18.5` |
| `avg_last_4_weeks` | number | Yes | 4-week rolling average | `16.2` |
| `sacks` | number | Yes | Total sacks | `4` |
| `interceptions` | number | Yes | Total interceptions | `2` |
| `fumbles_recovered` | number | Yes | Fumbles recovered | `1` |
| `defensive_tds` | number | Yes | Defensive/ST touchdowns | `1` |
| `points_allowed` | number | Yes | Points allowed to opponent | `13` |
| `yards_allowed` | number | No | Total yards allowed | `285` |
| `safeties` | number | No | Safeties scored | `0` |

---

## Defense Predictions Schema

**Endpoint:** `predictions/defense_predictions.json`

### Fields

| Field | Type | Required | Description | Example |
|-------|------|----------|-------------|----------|
| `team` | string | Yes | Team abbreviation | `"BAL"` |
| `season` | number | Yes | NFL season | `2026` |
| `predicted_week` | number | Yes | Week of prediction | `15` |
| `predicted_points` | number | Yes | Predicted fantasy points | `14.5` |
| `predicted_lower_80` | number | Yes | Lower bound (80% CI) | `10.2` |
| `predicted_upper_80` | number | Yes | Upper bound (80% CI) | `18.8` |
| `confidence_width` | number | Yes | Prediction confidence width | `8.6` |
| `last_week_actual_points` | number | Yes | Previous week actual points | `18.5` |
| `rolling_5g_fantasy_pts` | number | Yes | 5-game rolling average | `16.2` |
| `momentum_score` | number | Yes | Momentum indicator (0-1) | `0.85` |
| `prediction_date` | string (YYYY-MM-DD) | Yes | Date prediction was made | `"2026-06-07"` |
| `model_version` | string | Yes | ML model version | `"v2.1"` |

---

## Injury Status Schema

**Endpoint:** `fantasai/injuries/silver_player_news.json`

### Fields

| Field | Type | Required | Description | Example |
|-------|------|----------|-------------|----------|
| `player_id` | string | Yes | Sleeper player ID | `"sleeper_123"` |
| `player_name` | string | Yes | Player's full name | `"Justin Jefferson"` |
| `position` | string | Yes | Player position | `"WR"` |
| `team` | string | Yes | Team abbreviation | `"MIN"` |
| `news_updated` | string (ISO 8601) | No | Last news update time | `"2026-06-07T10:30:00Z"` |
| `injury_status` | string | No | Current injury status | `"Questionable"`, `"Doubtful"`, `"Out"`, `"IR"`, `null` |
| `injury_notes` | string | No | Injury details | `"Ankle injury, day-to-day"` |
| `status` | string | Yes | Roster status | `"Active"`, `"Injured Reserve"`, `"PUP"` |
| `depth_chart_order` | number | No | Position on depth chart | `1` |
| `depth_chart_position` | string | No | Depth chart designation | `"WR1"`, `"RB2"`, `"Backup QB"` |
| `fetched_at` | string (ISO 8601) | Yes | Data fetch timestamp | `"2026-06-07T08:00:00Z"` |

---

## Enumerations

### Positions
```
QB  - Quarterback
RB  - Running Back
WR  - Wide Receiver
TE  - Tight End
K   - Kicker
DEF - Defense/Special Teams
```

### Impact Categories
```
injury         - Injury-related news
trade          - Trade or transaction
performance    - Performance/stats related
depth_chart    - Depth chart changes
opportunity    - Playing time/opportunity changes
```

### Sentiments
```
positive  - Positive fantasy impact
negative  - Negative fantasy impact
neutral   - Neutral/unclear impact
```

### Priority Levels
```
high    - Urgent/critical news
medium  - Important but not urgent
low     - Minor/informational
```

### Experience Levels
```
Rookie 2026   - Rookie entering 2026
Sophomore     - Second year (drafted 2025)
Young         - 2-3 years experience
Veteran       - 4+ years experience
```

### Draft Tiers
```
QB1, QB2, QB3              - Quarterback tiers
RB1, RB2, RB3              - Running back tiers
WR1, WR2, WR3              - Wide receiver tiers
TE1, TE2                   - Tight end tiers
K1                         - Kicker tier
Flex/Depth                 - Flex or depth player
Unproven                   - No significant stats
```

---

## Timestamp Format

All timestamps use **ISO 8601 format with UTC timezone**:

```
YYYY-MM-DDTHH:MM:SSZ
```

**Examples:**
- `2026-06-07T08:00:00Z` - June 7, 2026 at 8:00 AM UTC
- `2026-05-31T19:15:00Z` - May 31, 2026 at 7:15 PM UTC

---

## Data Types

| Type | Description | Example |
|------|-------------|----------|
| `string` | Text value | `"Justin Jefferson"` |
| `number` | Numeric value (integer or decimal) | `24.3`, `14` |
| `boolean` | True/false value | `true`, `false` |
| `array` | List of values | `["MIN", "DAL"]` |
| `string (ISO 8601)` | ISO 8601 timestamp string | `"2026-06-07T08:00:00Z"` |
| `string (YYYY-MM-DD)` | Date-only string | `"2026-06-07"` |

---

## Null Values

- Fields marked as **Required = Yes** will never be `null`
- Fields marked as **Required = No** may be `null` or missing
- Empty strings (`""`) are distinct from `null`
- Zero values (`0`) are distinct from `null`

---

**Generated:** 2026-06-07 (original schemas below this point), updated 2026-08-22 (see "New Since June 2026" section above)
**Schema Version:** 2.0.0
**Maintained by:** FantasAI Data Team

---

## Known-Stale / Unconfirmed Schemas

The following schemas from the original June 7 version were **not re-verified** in the August 22 audit — the underlying endpoints (`predictions/defense_predictions.json`, `analysis/sleeper_picks.json`'s `ownership_pct` field) were not confirmed present in the current `export_to_r2.py` output or worker-api routes. Treat them as historical reference, not a guarantee, until spot-checked against a live R2 fetch.