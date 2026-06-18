"""
Sleeper Weekly Stats Ingestion
Fetches per-player fantasy stats from Sleeper's free public API for every
week of a completed NFL season and upserts into silver_weekly_stats.

Sleeper returns pts_ppr / pts_std directly, so no manual scoring needed.

Outputs:
  silver_weekly_stats — upserted by (player_id, week, season, source='sleeper')

Usage:
  python ingest_sleeper_stats.py                  # 2025 regular season
  python ingest_sleeper_stats.py --season 2024    # prior season
  python ingest_sleeper_stats.py --weeks 1,2,3    # specific weeks only
  python ingest_sleeper_stats.py --dry-run
"""

import argparse
import json
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

import pandas as pd
import requests

sys.path.insert(0, str(Path(__file__).parent.parent))
import ssl_utils  # noqa: F401 — injects Windows cert store
from db import get_conn, init_schema  # noqa: E402

SLEEPER_STATS_URL = (
    "https://api.sleeper.app/v1/stats/nfl/regular/{season}/{week}"
)
SLEEPER_PLAYERS_URL = "https://api.sleeper.app/v1/players/nfl"

RELEVANT_POSITIONS = {"QB", "RB", "WR", "TE", "K", "DEF"}
REGULAR_SEASON_WEEKS = list(range(1, 19))  # weeks 1-18

# PPR scoring weights — fallback if Sleeper doesn't return pts_ppr directly
PPR_WEIGHTS = {
    "pass_yd": 0.04,
    "pass_td": 4.0,
    "pass_int": -2.0,
    "rush_yd": 0.1,
    "rush_td": 6.0,
    "rec": 1.0,
    "rec_yd": 0.1,
    "rec_td": 6.0,
    "fum_lost": -2.0,
    "2pt": 2.0,
    "ret_td": 6.0,
    "pts_allow_0": 10.0,
    "pts_allow_1_6": 7.0,
    "pts_allow_7_13": 4.0,
    "pts_allow_14_20": 1.0,
    "pts_allow_21_27": 0.0,
    "pts_allow_28_34": -1.0,
    "pts_allow_35p": -4.0,
    "sack": 1.0,
    "int": 2.0,
    "fum_rec": 2.0,
    "def_td": 6.0,
    "safe": 2.0,
    "blk_kick": 2.0,
}


def fetch_player_index() -> dict:
    """Fetch master player list from Sleeper to get names/positions/teams."""
    print("Fetching Sleeper player index...")
    r = requests.get(SLEEPER_PLAYERS_URL, timeout=60)
    r.raise_for_status()
    data = r.json()
    print(f"  {len(data):,} players in index")
    return data


def fetch_week(season: int, week: int) -> dict:
    """Fetch raw stats dict for one week. Returns {} on failure."""
    url = SLEEPER_STATS_URL.format(season=season, week=week)
    try:
        r = requests.get(url, timeout=30)
        if r.status_code == 404:
            print(f"  Week {week}: 404 (no data published yet)")
            return {}
        r.raise_for_status()
        data = r.json()
        if not data:
            print(f"  Week {week}: empty response")
            return {}
        print(f"  Week {week}: {len(data):,} player records")
        return data
    except Exception as e:
        print(f"  Week {week}: error -- {e}")
        return {}


def compute_ppr(stats: dict) -> float:
    """Return pts_ppr from Sleeper stats; fall back to manual calculation."""
    total = float(stats.get("pts_ppr") or 0)
    if total:
        return round(total, 2)
    for key, weight in PPR_WEIGHTS.items():
        val = stats.get(key)
        if val:
            total += float(val) * weight
    return round(total, 2)


def build_rows(
    season: int,
    week: int,
    raw_stats: dict,
    player_index: dict,
    now: datetime,
) -> list[dict]:
    rows = []
    for player_id, stats in raw_stats.items():
        if not stats:
            continue
        pinfo = player_index.get(str(player_id), {})
        pos = pinfo.get("position") or stats.get("pos") or ""
        if pos not in RELEVANT_POSITIONS:
            continue

        fantasy_pts = compute_ppr(stats)
        # Skip bye/inactive players with zero activity
        active_keys = ("pass_yd", "rush_yd", "rec_yd", "pts_ppr", "sack")
        if fantasy_pts == 0 and not any(stats.get(k) for k in active_keys):
            continue

        first = pinfo.get("first_name", "")
        last = pinfo.get("last_name", "")
        name = (
            pinfo.get("full_name")
            or f"{first} {last}".strip()
            or stats.get("player_name", "")
        )
        team = pinfo.get("team") or stats.get("team") or ""

        rows.append({
            "player_id": str(player_id),
            "week": int(week),
            "season": int(season),
            "fantasy_points": fantasy_pts,
            "stats": json.dumps(stats, default=str),
            "source": "sleeper",
            "player_name": name,
            "position": pos,
            "team": team,
            "ingested_at": now,
            "receiving_yards_after_catch": None,
            "passing_yards_after_catch": None,
            "headshot_url": None,
        })
    return rows


def upsert_rows(conn, rows: list[dict]) -> int:
    if not rows:
        return 0
    df = pd.DataFrame(rows)
    conn.register("_sleeper_stats", df)
    conn.execute("""
        INSERT INTO silver_weekly_stats BY NAME
        SELECT * FROM _sleeper_stats
        ON CONFLICT (player_id, week, season, source) DO UPDATE SET
            fantasy_points  = excluded.fantasy_points,
            stats           = excluded.stats,
            player_name     = excluded.player_name,
            position        = excluded.position,
            team            = excluded.team,
            ingested_at     = excluded.ingested_at
    """)
    conn.unregister("_sleeper_stats")
    return len(rows)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--season", type=int, default=2025,
        help="NFL season year (default: 2025)",
    )
    parser.add_argument(
        "--weeks", type=str, default=None,
        help="Comma-separated weeks, e.g. 1,2,3 (default: all 18)",
    )
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    weeks = (
        [int(w) for w in args.weeks.split(",")]
        if args.weeks
        else REGULAR_SEASON_WEEKS
    )

    print("=" * 70)
    print("Sleeper Weekly Stats Ingestion")
    print(f"Season: {args.season}")
    print(f"Weeks:  {weeks[0]}-{weeks[-1]}  ({len(weeks)} weeks)")
    print(f"Mode:   {'DRY RUN' if args.dry_run else 'LIVE'}")
    print("=" * 70)

    conn = get_conn()
    init_schema(conn)

    player_index = fetch_player_index()
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    total_rows = 0
    empty_streak = 0

    for week in weeks:
        raw = fetch_week(args.season, week)
        if not raw:
            empty_streak += 1
            if empty_streak >= 3:
                print("  3 consecutive empty weeks -- stopping early")
                break
            continue
        empty_streak = 0

        rows = build_rows(args.season, week, raw, player_index, now)
        if args.dry_run:
            print(f"  Week {week}: {len(rows)} rows (dry run)")
        else:
            total_rows += upsert_rows(conn, rows)

        time.sleep(0.3)  # polite delay for Sleeper's free API

    if not args.dry_run:
        print(
            f"\nsilver_weekly_stats: {total_rows:,} rows upserted "
            f"(source=sleeper, season={args.season})"
        )

    result = conn.execute(
        "SELECT season, COUNT(*) as rows, COUNT(DISTINCT player_id) as players"
        " FROM silver_weekly_stats WHERE season = ? GROUP BY season",
        [args.season],
    ).fetchone()
    if result:
        print(
            f"Verification: season {result[0]} -- "
            f"{result[1]:,} rows, {result[2]:,} players"
        )
    else:
        print("Verification: no rows found for this season")

    conn.close()
    print("\nDone.")


if __name__ == "__main__":
    main()
