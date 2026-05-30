CREATE TABLE IF NOT EXISTS main.fantasai.bronze_players (
  player_id STRING,
  full_name STRING,
  first_name STRING,
  last_name STRING,
  team STRING,
  position STRING,
  status STRING,
  sport STRING,
  ingested_at TIMESTAMP
)
USING DELTA;

CREATE TABLE IF NOT EXISTS main.fantasai.silver_players (
  player_id STRING,
  full_name STRING,
  first_name STRING,
  last_name STRING,
  team STRING,
  position STRING,
  status STRING,
  sport STRING,
  ingested_at TIMESTAMP
)
USING DELTA;
