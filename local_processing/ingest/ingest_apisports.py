"""
API-Sports.io — Weekly NFL Stats Ingestion
Replaces: notebooks/01_Ingestion/Bronze/API-Sports.io NFL Ingestion.ipynb
          notebooks/05_Scheduled_Jobs/API-Sports.io - Scheduled Daily Update.ipynb

Free tier: 100 requests/day. This script uses ~1 + N_games requests per run.
Fetches player stats for a given week/season and upserts into DuckDB.

Outputs:
  bronze_weekly_stats  — upserted by (player_id, week, season, source='api_sports')
  silver_weekly_stats  — same records, deduplicated

Usage:
  python ingest_apisports.py
  python ingest_apisports.py --week 1 --season 2025
  python ingest_apisports.py --dry-run
"""

import argparse
import json
import os
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

import requests

sys.path.insert(0, str(Path(__file__).parent.parent))
import ssl_utils  # noqa: F401
from db import get_conn, init_schema

try:
    from dotenv import load_dotenv
    load_dotenv(Path(__file__).parent.parent.parent / ".env")
except ImportError:
    pass

BASE_URL        = "https://v1.american-football.api-sports.io"
REQUEST_TIMEOUT = 30
RATE_LIMIT_SEC  = 0.5

API_KEY = os.environ.get("API_SPORTS_KEY", "")
if not API_KEY:
    print("ERROR: API_SPORTS_KEY not set in .env")
    sys.exit(1)

HEADERS = {"x-apisports-key": API_KEY}


def get_current_week_season() -> tuple[int, int]:
    """Default to current NFL week if not specified."""
    now = datetime.now(timezone.utc)
    # NFL season typically runs Sep–Jan; off-season defaults to previous year week 1
    season = now.year if now.month >= 9 else now.year - 1
    return 1, season   # Safe default — let user override via --week/--season


def fetch_game_ids(week: int, season: int) -> list[int]:
    print(f"📡 Fetching games for Week {week}, Season {season}…")
    r = requests.get(f"{BASE_URL}/games",
                     headers=HEADERS,
                     params={"league": "1", "season": str(season)},
                     timeout=REQUEST_TIMEOUT)
    r.raise_for_status()
    all_games = r.json().get("response", [])

    week_label = f"Week {week}"
    week_games = [g for g in all_games if g.get("game", {}).get("week") == week_label]
    game_ids   = [g["game"]["id"] for g in week_games if g.get("game", {}).get("id")]

    available_weeks = sorted({g.get("game", {}).get("week") for g in all_games if g.get("game", {}).get("week")})
    print(f"   ✅ {len(game_ids)} games for {week_label} | Available weeks: {available_weeks[:8]}…")
    return game_ids


def fetch_player_stats(game_ids: list[int]) -> list[dict]:
    all_records = []
    print(f"📡 Fetching player stats for {len(game_ids)} games…")

    for i, gid in enumerate(game_ids, 1):
        r = requests.get(f"{BASE_URL}/games/statistics/players",
                         headers=HEADERS,
                         params={"id": str(gid)},
                         timeout=REQUEST_TIMEOUT)
        if r.status_code != 200:
            print(f"   ⚠️  Game {gid}: HTTP {r.status_code}")
            continue

        for team_data in r.json().get("response", []):
            team_name = team_data.get("team", {}).get("name")
            for group in team_data.get("groups", []):
                group_name = group.get("name")
                for pe in group.get("players", []):
                    pi     = pe.get("player", {})
                    stats  = {s.get("name", "").lower().replace(" ", "_"): s.get("value")
                              for s in pe.get("statistics", [])}
                    all_records.append({
                        "player_id":   str(pi.get("id", "")),
                        "player_name": pi.get("name"),
                        "team":        team_name,
                        "stat_group":  group_name,
                        "statistics":  stats,
                        "game_id":     gid,
                    })
        print(f"   … game {i}/{len(game_ids)}: {len(all_records)} total records so far")
        time.sleep(RATE_LIMIT_SEC)

    print(f"   ✅ {len(all_records):,} player-stat records fetched")
    return all_records


def build_rows(records: list[dict], week: int, season: int) -> list[dict]:
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    rows = []
    for r in records:
        rows.append({
            "player_id":     r["player_id"],
            "week":          week,
            "season":        season,
            "fantasy_points": 0.0,   # calculated downstream
            "stats":         json.dumps({
                "player_name": r["player_name"],
                "team":        r["team"],
                "stat_group":  r["stat_group"],
                "game_id":     r["game_id"],
                "statistics":  r["statistics"],
            }),
            "source":        "api_sports",
            "ingested_at":   now,
        })
    return rows


def write_to_db(conn, rows: list[dict], dry_run: bool):
    if not rows:
        print("⚠️  No records to write")
        return
    if dry_run:
        print("🔵 Dry-run — skipping DB write")
        return

    import pandas as pd
    df = pd.DataFrame(rows)
    conn.register("_apisports", df)

    # Upsert into bronze
    conn.execute("""
        INSERT INTO bronze_weekly_stats BY NAME
        SELECT * FROM _apisports
        ON CONFLICT (player_id, week, season, source) DO UPDATE SET
            fantasy_points = excluded.fantasy_points,
            stats          = excluded.stats,
            ingested_at    = excluded.ingested_at
    """)
    print(f"   💾 bronze_weekly_stats: {len(df):,} rows upserted (source=api_sports)")

    # Mirror into silver (simpler copy, deduped)
    conn.execute("""
        INSERT INTO silver_weekly_stats (
            player_id, week, season, fantasy_points, stats, source,
            player_name, position, team, ingested_at
        )
        SELECT
            player_id, week, season, fantasy_points, stats, source,
            JSON_EXTRACT_STRING(stats, '$.player_name') AS player_name,
            NULL AS position,
            JSON_EXTRACT_STRING(stats, '$.team') AS team,
            ingested_at
        FROM _apisports
        ON CONFLICT (player_id, week, season, source) DO UPDATE SET
            fantasy_points = excluded.fantasy_points,
            stats          = excluded.stats,
            player_name    = excluded.player_name,
            team           = excluded.team,
            ingested_at    = excluded.ingested_at
    """)
    print(f"   💾 silver_weekly_stats: {len(df):,} rows upserted (source=api_sports)")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--week",    type=int, default=None)
    parser.add_argument("--season",  type=int, default=None)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    default_week, default_season = get_current_week_season()
    week   = args.week   or default_week
    season = args.season or default_season

    print("=" * 70)
    print(f"API-Sports.io — Weekly Stats Ingestion  (Week {week}, {season})")
    print(f"Timestamp: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print("=" * 70)

    game_ids = fetch_game_ids(week, season)
    if not game_ids:
        print("⚠️  No games found for this week. Check --week / --season.")
        sys.exit(0)

    records = fetch_player_stats(game_ids)
    rows    = build_rows(records, week, season)

    conn = get_conn()
    init_schema(conn)
    write_to_db(conn, rows, args.dry_run)
    conn.close()

    remaining_requests = 100 - 1 - len(game_ids)
    print(f"\n⚠️  API-Sports free tier: used ~{1 + len(game_ids)} requests, ~{remaining_requests} remaining today")
    print("\n✅ API-Sports ingestion complete")


if __name__ == "__main__":
    main()
