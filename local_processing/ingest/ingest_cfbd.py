"""
College Football Data (CFBD) Ingestion — Rookie Projection Foundation

Fetches collegiate production stats for NFL draft-eligible players.
Used to build rookie projection models: College Dominator, Market Share,
Breakout Age, Yards Per Route Run, etc.

Data pulled:
  - Player season stats (passing, rushing, receiving)
  - Player game stats (for consistency/variance analysis)
  - Recruiting ratings (star rankings, composite scores)
  - Draft picks (capital mapping)

Outputs (DuckDB):
  bronze_cfbd_player_stats — season-level college stats
  bronze_cfbd_recruiting   — recruiting rankings

API: https://api.collegefootballdata.com
Auth: Bearer token (free tier, register at collegefootballdata.com)

Usage:
  python ingest_cfbd.py                          # current + last 2 seasons
  python ingest_cfbd.py --seasons 2020,2021,2022,2023,2024,2025
  python ingest_cfbd.py --dry-run
  python ingest_cfbd.py --section stats           # stats only
  python ingest_cfbd.py --section recruiting      # recruiting only

Environment:
  CFBD_API_KEY — register free at collegefootballdata.com/key
"""

import argparse
import os
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

import pandas as pd
import requests

sys.path.insert(0, str(Path(__file__).parent.parent))
from db import get_conn, init_schema

try:
    from dotenv import load_dotenv
    load_dotenv(Path(__file__).parent.parent.parent / ".env")
except ImportError:
    pass

CFBD_BASE = "https://api.collegefootballdata.com"
CFBD_KEY  = os.environ.get("CFBD_API_KEY", "")
HEADERS   = {"Authorization": f"Bearer {CFBD_KEY}", "Accept": "application/json"}
RATE_SEC  = 0.5
DEFAULT_SEASONS = [2023, 2024, 2025]

SKILL_CATEGORIES = ["passing", "rushing", "receiving"]


def cfbd_get(endpoint, params=None):
    url = f"{CFBD_BASE}{endpoint}"
    r = requests.get(url, headers=HEADERS, params=params, timeout=20)
    if r.status_code == 401:
        print("   ERROR: CFBD_API_KEY not set or invalid. Register at collegefootballdata.com/key")
        return []
    if not r.ok:
        print(f"   HTTP {r.status_code}: {r.text[:200]}")
        return []
    return r.json()


def fetch_player_stats(seasons):
    """Fetch season-level player stats for skill positions."""
    all_rows = []
    for season in seasons:
        for cat in SKILL_CATEGORIES:
            print(f"   {season} {cat}...")
            data = cfbd_get("/stats/player/season", {
                "year": season,
                "category": cat,
            })
            for row in data:
                all_rows.append({
                    "season": season,
                    "player_name": row.get("player"),
                    "team": row.get("team"),
                    "conference": row.get("conference"),
                    "category": cat,
                    "stat_type": row.get("statType"),
                    "stat_value": float(row.get("stat", 0)),
                })
            time.sleep(RATE_SEC)
    return pd.DataFrame(all_rows) if all_rows else pd.DataFrame()


def fetch_recruiting(seasons):
    """Fetch recruiting rankings (star ratings, composite scores)."""
    all_rows = []
    for season in seasons:
        print(f"   Recruiting {season}...")
        data = cfbd_get("/recruiting/players", {"year": season})
        for row in data:
            all_rows.append({
                "season": season,
                "player_name": row.get("name"),
                "school": row.get("committedTo"),
                "position": row.get("position"),
                "state": row.get("stateProvince"),
                "city": row.get("city"),
                "stars": row.get("stars"),
                "rating": row.get("rating"),
                "ranking": row.get("ranking"),
            })
        time.sleep(RATE_SEC)
    return pd.DataFrame(all_rows) if all_rows else pd.DataFrame()


def pivot_stats(df):
    """Pivot stat rows into one row per player/season with columns per stat."""
    if df.empty:
        return df
    pivoted = df.pivot_table(
        index=["season", "player_name", "team", "conference"],
        columns="stat_type",
        values="stat_value",
        aggfunc="sum",
    ).reset_index()
    pivoted.columns = [c if isinstance(c, str) else c for c in pivoted.columns]
    return pivoted


def write_stats(conn, df, seasons, dry_run):
    if df.empty:
        print("   No stats data")
        return
    pivoted = pivot_stats(df)
    # Normalize column names to lowercase, replace spaces
    pivoted.columns = [str(c).lower().replace(' ', '_') for c in pivoted.columns]
    if dry_run:
        print(f"   DRY RUN — {len(pivoted)} player-seasons, cols: {list(pivoted.columns)}")
        print(pivoted.head(10).to_string(index=False))
        return
    # Drop and recreate to handle dynamic columns from CFBD
    conn.execute("DROP TABLE IF EXISTS bronze_cfbd_player_stats")
    conn.register("_cfbd_stats", pivoted)
    conn.execute("CREATE TABLE bronze_cfbd_player_stats AS SELECT * FROM _cfbd_stats")
    conn.unregister("_cfbd_stats")
    print(f"   bronze_cfbd_player_stats: {len(pivoted)} rows, {len(pivoted.columns)} cols")
    print(f"   Columns: {', '.join(pivoted.columns)}")


def write_recruiting(conn, df, seasons, dry_run):
    if df.empty:
        print("   No recruiting data")
        return
    if dry_run:
        print(f"   DRY RUN — {len(df)} recruits")
        print(df.head(10).to_string(index=False))
        return
    conn.execute("DROP TABLE IF EXISTS bronze_cfbd_recruiting")
    conn.register("_cfbd_rec", df)
    conn.execute("CREATE TABLE bronze_cfbd_recruiting AS SELECT * FROM _cfbd_rec")
    conn.unregister("_cfbd_rec")
    print(f"   bronze_cfbd_recruiting: {len(df)} rows written")


def main():
    parser = argparse.ArgumentParser(description="CFBD college stats ingestion")
    parser.add_argument("--seasons", type=str, default=None)
    parser.add_argument("--section", choices=["stats", "recruiting", "all"], default="all")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    if not CFBD_KEY:
        print("ERROR: Set CFBD_API_KEY in .env (free at collegefootballdata.com/key)")
        sys.exit(1)

    seasons = [int(y) for y in args.seasons.split(",")] if args.seasons else DEFAULT_SEASONS
    conn = get_conn()
    init_schema(conn)

    print(f"\n── CFBD College Football Data ────────────────────────────────────────")
    print(f"   Seasons: {seasons}")

    if args.section in ("stats", "all"):
        print("\n── Player Season Stats ──────────────────────────────────────────────")
        stats_df = fetch_player_stats(seasons)
        write_stats(conn, stats_df, seasons, args.dry_run)

    if args.section in ("recruiting", "all"):
        print("\n── Recruiting Rankings ──────────────────────────────────────────────")
        rec_df = fetch_recruiting(seasons)
        write_recruiting(conn, rec_df, seasons, args.dry_run)

    conn.close()
    print("\n✅ CFBD ingestion complete")


if __name__ == "__main__":
    main()
