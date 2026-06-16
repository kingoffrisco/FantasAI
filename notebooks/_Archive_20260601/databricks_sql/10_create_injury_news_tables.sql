-- FantasAI — Injury & News Silver/Gold Tables
-- All in main.fantasai (single schema, no fantasai_news)
-- Run once to create; subsequent ingestion uses MERGE/overwrite.

-- Bronze: raw per-player injury + news snapshot from Sleeper
CREATE TABLE IF NOT EXISTS main.fantasai.bronze_player_injuries (
  player_id             STRING,
  player_name           STRING,
  position              STRING,
  team                  STRING,
  injury_status         STRING,   -- Questionable | Doubtful | Out | Injured_Reserve | null
  injury_body_part      STRING,
  injury_notes          STRING,
  practice_participation STRING,  -- Full | Limited | DNP | null
  news_text             STRING,   -- latest news blurb from Sleeper
  ingested_at           TIMESTAMP
)
USING DELTA;

-- Silver: deduplicated, normalized view of injuries
CREATE TABLE IF NOT EXISTS main.fantasai.silver_player_injuries (
  player_id             STRING,
  player_name           STRING,
  position              STRING,
  team                  STRING,
  injury_status         STRING,
  injury_body_part      STRING,
  injury_notes          STRING,
  practice_participation STRING,
  news_text             STRING,
  has_injury_concern    BOOLEAN,
  is_critical           BOOLEAN,
  ingested_at           TIMESTAMP
)
USING DELTA;

-- Gold: per-player news aggregation shaped for the frontend
--   exported → fantasai/news/player_notes.json
CREATE TABLE IF NOT EXISTS main.fantasai.gold_player_notes (
  player_name           STRING,
  position              STRING,
  team                  STRING,
  has_injury_concern    BOOLEAN,
  has_critical_news     BOOLEAN,
  note_text             STRING,
  priority              STRING,   -- critical | high | medium | low
  impact_direction      STRING,   -- negative | neutral | positive
  published_at          STRING,
  last_updated          STRING,
  overall_impact_score  DOUBLE
)
USING DELTA;
