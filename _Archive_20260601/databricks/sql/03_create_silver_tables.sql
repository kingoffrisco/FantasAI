CREATE TABLE IF NOT EXISTS main.fantasai.silver_nfl_state (
  season STRING,
  season_type STRING,
  week INT,
  league_season STRING,
  ingested_at TIMESTAMP
)
USING DELTA;

CREATE TABLE IF NOT EXISTS main.fantasai.silver_trending_players (
  player_id STRING,
  trend_count INT,
  add_drop STRING,
  lookback_hours INT,
  ingested_at TIMESTAMP
)
USING DELTA;
