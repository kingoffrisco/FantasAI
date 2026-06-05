CREATE TABLE IF NOT EXISTS main.fantasai.bronze_nfl_state (
  season STRING,
  season_type STRING,
  week INT,
  league_season STRING,
  leg INT,
  display_week INT,
  ingested_at TIMESTAMP
)
USING DELTA;

CREATE TABLE IF NOT EXISTS main.fantasai.bronze_trending_players (
  player_id STRING,
  count INT,
  add_drop STRING,
  lookback_hours INT,
  ingested_at TIMESTAMP
)
USING DELTA;
