CREATE TABLE IF NOT EXISTS main.fantasai.bronze_news (
  news_id STRING,
  player_id STRING,
  title STRING,
  summary STRING,
  source STRING,
  published_at STRING,
  ingested_at TIMESTAMP
)
USING DELTA;
