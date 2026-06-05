CREATE TABLE IF NOT EXISTS main.fantasai.silver_leagues (
  league_id STRING,
  name STRING,
  season STRING,
  sport STRING,
  status STRING,
  total_rosters INT,
  ingested_at TIMESTAMP
)
USING DELTA;

CREATE TABLE IF NOT EXISTS main.fantasai.silver_rosters (
  league_id STRING,
  roster_id INT,
  owner_id STRING,
  starters STRING,
  players STRING,
  reserve STRING,
  ingested_at TIMESTAMP
)
USING DELTA;

CREATE TABLE IF NOT EXISTS main.fantasai.silver_matchups (
  league_id STRING,
  week INT,
  roster_id INT,
  matchup_id INT,
  points DOUBLE,
  players STRING,
  ingested_at TIMESTAMP
)
USING DELTA;

CREATE TABLE IF NOT EXISTS main.fantasai.silver_news (
  news_id STRING,
  player_id STRING,
  title STRING,
  summary STRING,
  source STRING,
  published_at STRING,
  ingested_at TIMESTAMP
)
USING DELTA;
