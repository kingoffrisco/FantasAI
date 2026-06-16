"""
Weather Ingestion — WorldWeatherOnline
Replaces: notebooks/01_Ingestion/Bronze/08_weather_ingestion.py (Databricks)

Fetches 7-day weather forecasts for all NFL outdoor stadium locations.
Free tier: 500 calls/day — 32 NFL teams uses ~20 calls per run.

Writes to DuckDB:
  weather_forecasts   — current 7-day forecast per team (full replace each run)
  weather_historical  — per-team per-date snapshots (append)

Then exports to R2:
  fantasai/analysis/weather_forecast.json

Prerequisites:
  WWO_API_KEY in .env  (WorldWeatherOnline free key)

Usage:
  python ingest_weather.py
  python ingest_weather.py --dry-run        # fetch but skip DuckDB + R2 writes
  python ingest_weather.py --team KC,GB     # single team test
"""

import argparse
import json
import os
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

import pandas as pd
import requests

sys.path.insert(0, str(Path(__file__).parent.parent))
import ssl_utils  # noqa: F401 — injects Windows cert store
from db import get_conn, init_schema

try:
    from dotenv import load_dotenv
    load_dotenv(Path(__file__).parent.parent.parent / ".env")
except ImportError:
    pass

WWO_BASE     = "https://api.worldweatheronline.com/premium/v1/weather.ashx"
WWO_KEY      = os.environ.get("WWO_API_KEY", "")
R2_BASE      = "https://api.fantasai.net/api/v1/r2"
FANTASAI_KEY = os.environ.get("FANTASAI_KEY", "")

# ── NFL stadium locations ─────────────────────────────────────────────────────
# (team, city, is_dome)
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

OUTDOOR_TEAMS = [(t, c) for t, (c, dome) in NFL_TEAMS.items() if not dome]


def fetch_wwo(city: str, num_days: int = 7) -> dict:
    params = {
        "key":         WWO_KEY,
        "q":           city,
        "format":      "json",
        "num_of_days": num_days,
        "hourly":      1,
        "tp":          1,
        "lang":        "en",
    }
    resp = requests.get(WWO_BASE, params=params, timeout=15)
    resp.raise_for_status()
    data = resp.json()
    if "error" in data.get("data", {}):
        raise ValueError(f"WWO error: {data['data']['error'][0]['msg']}")
    return data["data"]


def extract_game_hour(day_data: dict, target_hour: str = "1300") -> dict:
    hourly = day_data.get("hourly", [])
    for h in hourly:
        if h.get("time") == target_hour:
            return h
    mid = len(hourly) // 2
    return hourly[mid] if hourly else {}


def build_rows(teams_filter: list | None, ingested_at: datetime):
    forecast_rows = []
    historical_rows = []
    errors = []
    r2_teams = {}

    outdoor = [(t, c) for t, c in OUTDOOR_TEAMS if not teams_filter or t in teams_filter]
    print(f"   Fetching {len(outdoor)} outdoor stadiums…")

    for i, (team, city) in enumerate(outdoor):
        try:
            data = fetch_wwo(city)
            weather_days = data.get("weather", [])
            team_days = []

            for day in weather_days:
                game_h = extract_game_hour(day)

                def _int(val, default=0):
                    try:
                        return int(val)
                    except (TypeError, ValueError):
                        return default

                def _float(val, default=0.0):
                    try:
                        return float(val)
                    except (TypeError, ValueError):
                        return default

                forecast_rows.append({
                    "team":             team,
                    "city":             city,
                    "is_dome":          False,
                    "forecast_date":    day.get("date"),
                    "max_temp_f":       _int(day.get("maxtempF")),
                    "min_temp_f":       _int(day.get("mintempF")),
                    "game_time_temp_f": _int(game_h.get("tempF")),
                    "feels_like_f":     _int(game_h.get("FeelsLikeF")),
                    "wind_mph":         _int(game_h.get("windspeedMiles")),
                    "wind_dir":         game_h.get("winddir16Point", ""),
                    "precip_in":        round(_float(game_h.get("precipMM")) / 25.4, 3),
                    "humidity_pct":     _int(game_h.get("humidity")),
                    "cloud_cover_pct":  _int(game_h.get("cloudcover")),
                    "condition":        (game_h.get("weatherDesc") or [{}])[0].get("value", ""),
                    "hourly_json":      json.dumps(day.get("hourly", [])),
                    "ingested_at":      ingested_at.replace(tzinfo=None),
                })
                historical_rows.append({
                    "team":             team,
                    "city":             city,
                    "game_date":        day.get("date"),
                    "max_temp_f":       _int(day.get("maxtempF")),
                    "min_temp_f":       _int(day.get("mintempF")),
                    "game_time_temp_f": _int(game_h.get("tempF")),
                    "wind_mph":         _int(game_h.get("windspeedMiles")),
                    "wind_dir":         game_h.get("winddir16Point", ""),
                    "precip_in":        round(_float(game_h.get("precipMM")) / 25.4, 3),
                    "condition":        (game_h.get("weatherDesc") or [{}])[0].get("value", ""),
                    "ingested_at":      ingested_at.replace(tzinfo=None),
                })

                # Build day payload for R2
                hourly_shaped = [{
                    "time":            h.get("time"),
                    "temp_f":          _int(h.get("tempF")),
                    "feels_like_f":    _int(h.get("FeelsLikeF")),
                    "wind_mph":        _int(h.get("windspeedMiles")),
                    "wind_dir":        h.get("winddir16Point", ""),
                    "precip_in":       round(_float(h.get("precipMM")) / 25.4, 3),
                    "humidity_pct":    _int(h.get("humidity")),
                    "cloud_cover_pct": _int(h.get("cloudcover")),
                    "condition":       (h.get("weatherDesc") or [{}])[0].get("value", ""),
                } for h in day.get("hourly", [])]
                team_days.append({
                    "date":       day.get("date"),
                    "max_temp_f": _int(day.get("maxtempF")),
                    "min_temp_f": _int(day.get("mintempF")),
                    "hourly":     hourly_shaped,
                })

            r2_teams[team] = {"team": team, "city": city, "is_dome": False, "forecast": team_days}
            print(f"   {team} ({city}): {len(weather_days)} days OK")

        except Exception as e:
            errors.append(f"{team}: {e}")
            print(f"   {team} ({city}): FAILED — {e}")

        if i < len(outdoor) - 1:
            time.sleep(0.5)

    # Add dome placeholder rows (for teams not queried)
    for team, (city, is_dome) in NFL_TEAMS.items():
        if not is_dome:
            continue
        if teams_filter and team not in teams_filter:
            continue
        forecast_rows.append({
            "team": team, "city": city, "is_dome": True,
            "forecast_date": ingested_at.date().isoformat(),
            "max_temp_f": None, "min_temp_f": None, "game_time_temp_f": None,
            "feels_like_f": None, "wind_mph": None, "wind_dir": None,
            "precip_in": None, "humidity_pct": None, "cloud_cover_pct": None,
            "condition": "Dome", "hourly_json": None,
            "ingested_at": ingested_at.replace(tzinfo=None),
        })
        r2_teams[team] = {"team": team, "city": city, "is_dome": True, "forecast": None}

    return forecast_rows, historical_rows, r2_teams, errors


def write_to_db(conn, forecast_rows: list, historical_rows: list, dry_run: bool):
    if dry_run:
        print("   DRY RUN — skipping DB writes")
        return

    if forecast_rows:
        forecast_df = pd.DataFrame(forecast_rows)
        conn.execute("DELETE FROM weather_forecasts")
        conn.register("_fc", forecast_df)
        conn.execute("INSERT INTO weather_forecasts BY NAME SELECT * FROM _fc")
        print(f"   weather_forecasts: {len(forecast_rows)} rows (full replace)")

    if historical_rows:
        hist_df = pd.DataFrame(historical_rows)
        conn.register("_hist", hist_df)
        conn.execute("INSERT INTO weather_historical BY NAME SELECT * FROM _hist")
        print(f"   weather_historical: +{len(historical_rows)} rows (append)")


def export_to_r2(r2_teams: dict, ingested_at: datetime, dry_run: bool):
    if dry_run:
        print("   DRY RUN — skipping R2 upload")
        return
    if not FANTASAI_KEY:
        print("   WARNING: FANTASAI_KEY not set — skipping R2 upload")
        return

    payload = {
        "fetched_at":    ingested_at.isoformat(),
        "num_days":      7,
        "team_count":    len(r2_teams),
        "outdoor_count": len(OUTDOOR_TEAMS),
        "teams":         r2_teams,
    }
    try:
        resp = requests.put(
            f"{R2_BASE}/fantasai/analysis/weather_forecast.json",
            data=json.dumps(payload, default=str),
            headers={"Content-Type": "application/json", "X-FantasAI-Key": FANTASAI_KEY},
            timeout=30,
        )
        if resp.ok:
            print(f"   R2 upload OK — fantasai/analysis/weather_forecast.json ({len(r2_teams)} teams)")
        else:
            print(f"   R2 upload FAILED — HTTP {resp.status_code}")
    except Exception as e:
        print(f"   R2 upload ERROR — {e}")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--team", type=str, default=None,
                        help="Comma-separated team codes, e.g. KC,GB")
    args = parser.parse_args()

    teams_filter = [t.strip().upper() for t in args.team.split(",")] if args.team else None

    if not WWO_KEY:
        print("ERROR: WWO_API_KEY not set in .env")
        sys.exit(1)

    ingested_at = datetime.now(timezone.utc)

    print("=" * 70)
    print("Weather Ingestion — WorldWeatherOnline")
    print(f"Timestamp: {ingested_at.strftime('%Y-%m-%d %H:%M UTC')}")
    print(f"Mode:      {'DRY RUN' if args.dry_run else 'LIVE'}")
    if teams_filter:
        print(f"Teams:     {', '.join(teams_filter)}")
    print("=" * 70)

    forecast_rows, historical_rows, r2_teams, errors = build_rows(teams_filter, ingested_at)

    print(f"\nForecast rows:  {len(forecast_rows)}")
    print(f"Historical rows: {len(historical_rows)}")
    print(f"Errors:         {len(errors)}")

    conn = get_conn()
    init_schema(conn)
    write_to_db(conn, forecast_rows, historical_rows, args.dry_run)
    conn.close()

    export_to_r2(r2_teams, ingested_at, args.dry_run)

    print("\n✅ Weather ingestion complete")
    if errors:
        print(f"\nErrors ({len(errors)}):")
        for e in errors:
            print(f"  • {e}")
        sys.exit(1)


if __name__ == "__main__":
    main()
