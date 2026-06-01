# Databricks notebook source
# MAGIC %md
# MAGIC # FantasAI Weather Ingestion — WorldWeatherOnline
# MAGIC
# MAGIC Fetches historical and forecast weather data for all NFL outdoor
# MAGIC stadium locations from the WorldWeatherOnline (WWO) Premium API.
# MAGIC
# MAGIC Source: https://api.worldweatheronline.com/premium/v1/weather.ashx
# MAGIC Free tier: 500 calls/day — 32 NFL teams, 7-day forecast = ~20 calls/run
# MAGIC
# MAGIC Prerequisites:
# MAGIC   Create a Databricks Secret:
# MAGIC     scope="fantasai"  key="wwo_api_key"  value=<your WWO key>
# MAGIC   (Also set wwo_api_key as a Cloudflare Worker secret for the frontend refresh button)
# MAGIC
# MAGIC Writes to:
# MAGIC   - main.fantasai.weather_forecasts  (current 7-day forecast, overwrite)
# MAGIC   - main.fantasai.weather_historical  (per-game historical snapshots, append)
# MAGIC
# MAGIC Schedule: Run once daily during the season; more frequent is fine but
# MAGIC   keep total runs under 70/day to stay within the 500-call free quota.

# COMMAND ----------

import json
import time
import requests
from datetime import datetime, timezone, timedelta
from pyspark.sql import Row, functions as F

try:
    spark    # type: ignore[name-defined]  # noqa: F821
    dbutils  # type: ignore[name-defined]  # noqa: F821
except NameError:
    pass

WWO_BASE = "https://api.worldweatheronline.com/premium/v1/weather.ashx"
WWO_KEY  = dbutils.secrets.get(scope="fantasai", key="wwo_api_key")  # noqa: F821

# ── NFL stadium locations ──────────────────────────────────────────────────────
# Only outdoor stadiums require weather fetches.
# Dome teams are stored with is_dome=True and no weather data.
NFL_TEAMS = {
    "ARI": ("Glendale, AZ",        True),
    "ATL": ("Atlanta, GA",          True),
    "BAL": ("Baltimore, MD",        False),
    "BUF": ("Orchard Park, NY",     False),
    "CAR": ("Charlotte, NC",        False),
    "CHI": ("Chicago, IL",          False),
    "CIN": ("Cincinnati, OH",       False),
    "CLE": ("Cleveland, OH",        False),
    "DAL": ("Arlington, TX",        True),
    "DEN": ("Denver, CO",           False),
    "DET": ("Detroit, MI",          True),
    "GB":  ("Green Bay, WI",        False),
    "HOU": ("Houston, TX",          True),
    "IND": ("Indianapolis, IN",     True),
    "JAX": ("Jacksonville, FL",     False),
    "KC":  ("Kansas City, MO",      False),
    "LAC": ("Inglewood, CA",        False),
    "LAR": ("Inglewood, CA",        True),
    "LV":  ("Las Vegas, NV",        True),
    "MIA": ("Miami Gardens, FL",    False),
    "MIN": ("Minneapolis, MN",      True),
    "NE":  ("Foxborough, MA",       False),
    "NO":  ("New Orleans, LA",      True),
    "NYG": ("East Rutherford, NJ",  False),
    "NYJ": ("East Rutherford, NJ",  False),
    "PHI": ("Philadelphia, PA",     False),
    "PIT": ("Pittsburgh, PA",       False),
    "SEA": ("Seattle, WA",          False),
    "SF":  ("Santa Clara, CA",      False),
    "TB":  ("Tampa, FL",            False),
    "TEN": ("Nashville, TN",        False),
    "WAS": ("Landover, MD",         False),
}

OUTDOOR_TEAMS = [(team, city) for team, (city, dome) in NFL_TEAMS.items() if not dome]
print(f"Outdoor stadiums to fetch: {len(OUTDOOR_TEAMS)}")
print(f"Dome stadiums (skip):      {sum(1 for _, (_, d) in NFL_TEAMS.items() if d)}")

# COMMAND ----------

def fetch_wwo(city, num_days=7):
    """Fetch forecast from WorldWeatherOnline for a single city."""
    params = {
        "key":         WWO_KEY,
        "q":           city,
        "format":      "json",
        "num_of_days": num_days,
        "hourly":      1,
        "tp":          1,       # 1-hour time periods
        "lang":        "en",
    }
    resp = requests.get(WWO_BASE, params=params, timeout=15)
    resp.raise_for_status()
    data = resp.json()
    if "error" in data.get("data", {}):
        raise ValueError(f"WWO error: {data['data']['error'][0]['msg']}")
    return data["data"]


def extract_game_hour(day_data, target_hour="1300"):
    """Return the hourly record closest to game-time (1 PM default)."""
    hourly = day_data.get("hourly", [])
    for h in hourly:
        if h.get("time") == target_hour:
            return h
    # Fallback: midday hour
    mid = len(hourly) // 2
    return hourly[mid] if hourly else {}


ingested_at = datetime.now(timezone.utc)
print(f"=== Weather Ingestion  {ingested_at.isoformat()} ===\n")

# COMMAND ----------

# ── Fetch weather for all outdoor teams ───────────────────────────────────────
forecast_rows = []
historical_rows = []
errors = []

for i, (team, city) in enumerate(OUTDOOR_TEAMS):
    try:
        data = fetch_wwo(city, num_days=7)
        weather_days = data.get("weather", [])

        for day in weather_days:
            game_h = extract_game_hour(day)

            # Forecast row (upsert key: team + date)
            forecast_rows.append(Row(
                team               = team,
                city               = city,
                is_dome            = False,
                forecast_date      = day.get("date"),
                max_temp_f         = int(day.get("maxtempF",  0)),
                min_temp_f         = int(day.get("mintempF",  0)),
                game_time_temp_f   = int(game_h.get("tempF",          0)),
                feels_like_f       = int(game_h.get("FeelsLikeF",     0)),
                wind_mph           = int(game_h.get("windspeedMiles",  0)),
                wind_dir           = game_h.get("winddir16Point",     ""),
                precip_in          = round(float(game_h.get("precipMM", 0)) / 25.4, 3),
                humidity_pct       = int(game_h.get("humidity",        0)),
                cloud_cover_pct    = int(game_h.get("cloudcover",      0)),
                condition          = (game_h.get("weatherDesc") or [{}])[0].get("value", ""),
                hourly_json        = json.dumps(day.get("hourly", [])),
                ingested_at        = ingested_at,
            ))

            # Historical row (append — one row per team per game date per run)
            historical_rows.append(Row(
                team               = team,
                city               = city,
                game_date          = day.get("date"),
                max_temp_f         = int(day.get("maxtempF",  0)),
                min_temp_f         = int(day.get("mintempF",  0)),
                game_time_temp_f   = int(game_h.get("tempF",          0)),
                wind_mph           = int(game_h.get("windspeedMiles",  0)),
                wind_dir           = game_h.get("winddir16Point",     ""),
                precip_in          = round(float(game_h.get("precipMM", 0)) / 25.4, 3),
                condition          = (game_h.get("weatherDesc") or [{}])[0].get("value", ""),
                ingested_at        = ingested_at,
            ))

        print(f"  {team} ({city}): {len(weather_days)} days fetched")
    except Exception as e:
        errors.append(f"{team}: {e}")
        print(f"  {team} ({city}): ✗ {e}")

    # Stay well within 500 calls/day — 1 call per team
    if i < len(OUTDOOR_TEAMS) - 1:
        time.sleep(0.5)

# COMMAND ----------

# ── Add dome placeholder rows ─────────────────────────────────────────────────
for team, (city, is_dome) in NFL_TEAMS.items():
    if not is_dome:
        continue
    forecast_rows.append(Row(
        team               = team,
        city               = city,
        is_dome            = True,
        forecast_date      = ingested_at.date().isoformat(),
        max_temp_f         = None,
        min_temp_f         = None,
        game_time_temp_f   = None,
        feels_like_f       = None,
        wind_mph           = None,
        wind_dir           = None,
        precip_in          = None,
        humidity_pct       = None,
        cloud_cover_pct    = None,
        condition          = "Dome",
        hourly_json        = None,
        ingested_at        = ingested_at,
    ))

print(f"\nTotal forecast rows: {len(forecast_rows)}")
print(f"Total historical rows: {len(historical_rows)}")
print(f"Errors: {len(errors)}")

# COMMAND ----------

if not forecast_rows:
    print("No data — skipping write.")
    dbutils.notebook.exit("no_data")  # noqa: F821

forecast_df = spark.createDataFrame(forecast_rows)  # noqa: F821

# Overwrite: frontend always reads the latest 7-day window
(
    forecast_df
    .write.format("delta")
    .mode("overwrite")
    .option("overwriteSchema", "true")
    .saveAsTable("main.fantasai.weather_forecasts")
)
print("  Wrote to main.fantasai.weather_forecasts (overwrite)")

# COMMAND ----------

if historical_rows:
    historical_df = spark.createDataFrame(historical_rows)  # noqa: F821
    (
        historical_df
        .write.format("delta")
        .mode("append")
        .saveAsTable("main.fantasai.weather_historical")
    )
    print("  Wrote to main.fantasai.weather_historical (append)")

# COMMAND ----------

# ── Export to R2 ──────────────────────────────────────────────────────────────
# Builds the same JSON shape the Worker produces so frontend works
# whether data came from Databricks or the live refresh button.

WORKER_API = "https://api.fantasai.net"
WORKER_KEY = dbutils.secrets.get(scope="fantasai", key="worker_api_key")  # noqa: F821

teams_payload = {}
for team, (city, is_dome) in NFL_TEAMS.items():
    if is_dome:
        teams_payload[team] = {"team": team, "city": city, "is_dome": True, "forecast": None}
    else:
        rows_for_team = [r.asDict() for r in forecast_df.filter(  # noqa: F821
            (F.col("team") == team) & (F.col("is_dome") == False)  # noqa: E712
        ).collect()]
        days = []
        for r in rows_for_team:
            hourly = json.loads(r.get("hourly_json") or "[]")
            shaped_hourly = [{
                "time":            h.get("time"),
                "temp_f":          int(h.get("tempF",         0)),
                "feels_like_f":    int(h.get("FeelsLikeF",    0)),
                "wind_mph":        int(h.get("windspeedMiles", 0)),
                "wind_dir":        h.get("winddir16Point", ""),
                "precip_in":       round(float(h.get("precipMM", 0)) / 25.4, 3),
                "humidity_pct":    int(h.get("humidity",   0)),
                "cloud_cover_pct": int(h.get("cloudcover", 0)),
                "condition":       (h.get("weatherDesc") or [{}])[0].get("value", ""),
            } for h in hourly]
            days.append({
                "date":       r.get("forecast_date"),
                "max_temp_f": r.get("max_temp_f"),
                "min_temp_f": r.get("min_temp_f"),
                "hourly":     shaped_hourly,
            })
        teams_payload[team] = {"team": team, "city": city, "is_dome": False, "forecast": days}

r2_payload = {
    "fetched_at":    ingested_at.isoformat(),
    "num_days":      7,
    "team_count":    len(teams_payload),
    "outdoor_count": len(OUTDOOR_TEAMS),
    "teams":         teams_payload,
}

try:
    res = requests.put(
        f"{WORKER_API}/api/v1/r2/fantasai/analysis/weather_forecast.json",
        data=json.dumps(r2_payload, default=str),
        headers={"Content-Type": "application/json", "X-FantasAI-Key": WORKER_KEY},
        timeout=30,
    )
    print(f"  R2 export: {'✓' if res.ok else f'✗ HTTP {res.status_code}'}")
except Exception as e:
    print(f"  R2 export: ✗ {e}")

# COMMAND ----------

print(f"\n=== Weather Ingestion Complete ===")
print(f"  Teams fetched  : {len(OUTDOOR_TEAMS) - len(errors)}/{len(OUTDOOR_TEAMS)} outdoor")
print(f"  Forecast rows  : {len(forecast_rows)}")
print(f"  Historical rows: {len(historical_rows)}")
print(f"  Ingested at    : {ingested_at.isoformat()}")

if errors:
    print(f"\nErrors ({len(errors)}):")
    for e in errors:
        print(f"  • {e}")
    raise Exception(f"Weather ingestion finished with {len(errors)} error(s)")
else:
    print("  All outdoor stadiums fetched successfully.")
