CREATE TABLE IF NOT EXISTS main.fantasai.bronze_leagues (
  league_id STRING,
  name STRING,
  season STRING,
  sport STRING,
  status STRING,
  total_rosters INT,
  ingested_at TIMESTAMP
)
USING DELTA;
