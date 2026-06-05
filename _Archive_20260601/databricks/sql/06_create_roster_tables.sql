CREATE TABLE IF NOT EXISTS main.fantasai.bronze_rosters (
  league_id STRING,
  roster_id INT,
  owner_id STRING,
  starters STRING,
  players STRING,
  reserve STRING,
  ingested_at TIMESTAMP
)
USING DELTA;
