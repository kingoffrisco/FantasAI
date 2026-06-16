-- FantasAI — Weather Tables
-- All in main.fantasai (single schema)
-- Run once. Subsequent runs use overwrite (forecasts) or append (historical).

-- Current 7-day forecast per team — overwritten every run
CREATE TABLE IF NOT EXISTS main.fantasai.weather_forecasts (
  team               STRING,    -- NFL team abbreviation (BUF, KC, etc.)
  city               STRING,    -- Stadium city / metro area
  is_dome            BOOLEAN,   -- True = indoor, weather has no fantasy impact
  forecast_date      STRING,    -- YYYY-MM-DD
  max_temp_f         INT,
  min_temp_f         INT,
  game_time_temp_f   INT,       -- Temperature at ~1 PM game time
  feels_like_f       INT,
  wind_mph           INT,
  wind_dir           STRING,    -- e.g. "NW", "SSE"
  precip_in          DOUBLE,    -- Precipitation in inches (game hour)
  humidity_pct       INT,
  cloud_cover_pct    INT,
  condition          STRING,    -- "Partly cloudy", "Heavy snow", etc.
  hourly_json        STRING,    -- Full hourly array as JSON string
  ingested_at        TIMESTAMP
)
USING DELTA;

-- Historical snapshots — appended each run for ML training
-- Key insight: cold/windy/snowy weather suppresses passing stats,
-- hurts kickers, and reduces scoring — valuable ML signal.
CREATE TABLE IF NOT EXISTS main.fantasai.weather_historical (
  team               STRING,
  city               STRING,
  game_date          STRING,    -- YYYY-MM-DD
  max_temp_f         INT,
  min_temp_f         INT,
  game_time_temp_f   INT,
  wind_mph           INT,
  wind_dir           STRING,
  precip_in          DOUBLE,
  condition          STRING,
  ingested_at        TIMESTAMP
)
USING DELTA;
