CREATE TABLE IF NOT EXISTS main.fantasai.bronze_matchups (
  league_id STRING,
  week INT,
  roster_id INT,
  matchup_id INT,
  points DOUBLE,
  players STRING,
  ingested_at TIMESTAMP
)
USING DELTA;
