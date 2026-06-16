"""
NFL Schedule Ingestion — nflverse (nfl_data_py)
Replaces: notebooks/01_Ingestion/Bronze/17_nflverse_schedules_ingestion.ipynb

Fetches NFL game schedules for the current (and optionally historical) seasons.
Stores in DuckDB and exports two R2 keys used by the frontend for:
  - Displaying weekly matchups per team on roster/player pages
  - Home/away context for weather forecasts
  - Opponent difficulty lookups

Outputs (DuckDB):
  bronze_nfl_schedules — one row per game (season, week, home/away teams, scores, venue)

Outputs (R2):
  fantasai/analysis/nfl_schedule.json     — full current-season schedule, organized by week
  fantasai/analysis/opponent_lookup.json  — { team: { week: { opponent, is_home, date, ... } } }

Usage:
  python ingest_schedules.py                   # current season only
  python ingest_schedules.py --seasons 2024,2025
  python ingest_schedules.py --dry-run
  python ingest_schedules.py --export-only     # skip fetch, re-export from DB
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
import ssl_utils  # noqa: F401
from db import get_conn, init_schema

try:
    from dotenv import load_dotenv
    load_dotenv(Path(__file__).parent.parent.parent / ".env")
except ImportError:
    pass

R2_BASE      = "https://api.fantasai.net/api/v1/r2"
FANTASAI_KEY = os.environ.get("FANTASAI_KEY", "")
HEADERS_R2   = {"X-FantasAI-Key": FANTASAI_KEY, "Content-Type": "application/json"}

CURRENT_SEASON = 2025  # Most recent completed; 2026 starts Sep 2026


# ── Schema ────────────────────────────────────────────────────────────────────

SCHEMA_SQL = """
CREATE TABLE IF NOT EXISTS bronze_nfl_schedules (
    game_id      VARCHAR PRIMARY KEY,
    season       INTEGER,
    week         INTEGER,
    game_type    VARCHAR,   -- REG, POST, PRE
    gameday      VARCHAR,   -- YYYY-MM-DD
    gametime     VARCHAR,   -- HH:MM ET
    weekday      VARCHAR,
    home_team    VARCHAR,
    away_team    VARCHAR,
    home_score   INTEGER,
    away_score   INTEGER,
    stadium      VARCHAR,
    location     VARCHAR,   -- Home / Away / Neutral
    roof         VARCHAR,   -- dome, outdoors, retractable, open
    surface      VARCHAR,
    ingested_at  TIMESTAMP
);
"""


def ensure_schema(conn):
    for stmt in SCHEMA_SQL.split(";"):
        s = stmt.strip()
        if s:
            conn.execute(s)


# ── Fetch ─────────────────────────────────────────────────────────────────────

def fetch_seasons(seasons: list[int]) -> pd.DataFrame:
    try:
        import nfl_data_py as nfl
    except ImportError:
        print("   ERROR: nfl_data_py not installed — pip install nfl_data_py")
        sys.exit(1)

    all_dfs = []
    for season in seasons:
        print(f"   Season {season}: fetching…", end=" ", flush=True)
        try:
            df = nfl.import_schedules([season])
            if df is not None and len(df):
                all_dfs.append(df)
                print(f"{len(df)} games")
            else:
                print("0 games")
        except Exception as e:
            print(f"FAILED — {e}")
        time.sleep(0.5)

    if not all_dfs:
        return pd.DataFrame()
    return pd.concat(all_dfs, ignore_index=True)


# ── DuckDB write ──────────────────────────────────────────────────────────────

def write_bronze(conn, df: pd.DataFrame, seasons: list[int], dry_run: bool):
    if df.empty or dry_run:
        if dry_run:
            print(f"   DRY RUN — would write {len(df)} rows")
        return

    now = datetime.now(timezone.utc).replace(tzinfo=None)

    def _safe_int(val):
        try:
            v = int(val)
            return None if v < 0 else v
        except (TypeError, ValueError):
            return None

    rows = []
    for _, g in df.iterrows():
        game_id = str(g.get("game_id", ""))
        if not game_id or game_id == "nan":
            continue
        rows.append({
            "game_id":    game_id,
            "season":     _safe_int(g.get("season")),
            "week":       _safe_int(g.get("week")),
            "game_type":  str(g.get("game_type", "REG")),
            "gameday":    str(g.get("gameday", "")) if pd.notna(g.get("gameday")) else None,
            "gametime":   str(g.get("gametime", "")) if pd.notna(g.get("gametime")) else None,
            "weekday":    str(g.get("weekday", "")) if pd.notna(g.get("weekday")) else None,
            "home_team":  str(g.get("home_team", "")),
            "away_team":  str(g.get("away_team", "")),
            "home_score": _safe_int(g.get("home_score")),
            "away_score": _safe_int(g.get("away_score")),
            "stadium":    str(g.get("stadium", "")) if pd.notna(g.get("stadium")) else None,
            "location":   str(g.get("location", "")) if pd.notna(g.get("location")) else None,
            "roof":       str(g.get("roof", "")) if pd.notna(g.get("roof")) else None,
            "surface":    str(g.get("surface", "")) if pd.notna(g.get("surface")) else None,
            "ingested_at": now,
        })

    if not rows:
        print("   No valid rows to write")
        return

    # Delete existing rows for these seasons, then insert fresh
    for s in seasons:
        conn.execute("DELETE FROM bronze_nfl_schedules WHERE season = ?", [s])

    out = pd.DataFrame(rows)
    conn.register("_sched", out)
    conn.execute("INSERT INTO bronze_nfl_schedules BY NAME SELECT * FROM _sched")
    print(f"   bronze_nfl_schedules: {len(rows)} rows written ({len(seasons)} season(s))")


# ── R2 export ─────────────────────────────────────────────────────────────────

def export_to_r2(conn, export_season: int, dry_run: bool):
    """Export current-season schedule + opponent lookup to R2."""
    rows = conn.execute("""
        SELECT game_id, season, week, game_type, gameday, gametime,
               weekday, home_team, away_team, home_score, away_score,
               stadium, location, roof, surface
        FROM bronze_nfl_schedules
        WHERE season = ?
          AND game_type = 'REG'
        ORDER BY week, gameday, gametime
    """, [export_season]).df()

    if rows.empty:
        print(f"   No REG season data for {export_season} — skipping R2 export")
        return

    now = datetime.now(timezone.utc).isoformat()

    # ── Key 1: full schedule by week ──────────────────────────────────────────
    by_week: dict[str, list] = {}
    for _, g in rows.iterrows():
        wk = str(int(g["week"]))
        by_week.setdefault(wk, []).append({
            "game_id":    g["game_id"],
            "gameday":    g["gameday"],
            "gametime":   g["gametime"],
            "weekday":    g["weekday"],
            "home_team":  g["home_team"],
            "away_team":  g["away_team"],
            "home_score": None if pd.isna(g["home_score"]) else int(g["home_score"]),
            "away_score": None if pd.isna(g["away_score"]) else int(g["away_score"]),
            "stadium":    g["stadium"],
            "roof":       g["roof"],
        })

    schedule_payload = {
        "generated_at": now,
        "season":       export_season,
        "weeks":        sorted(by_week.keys(), key=int),
        "schedule":     by_week,
    }

    # ── Key 2: opponent lookup — team → week → game context ──────────────────
    # { "KC": { "1": { "opponent": "BAL", "is_home": true, "gameday": "...", ... } } }
    opponent_lookup: dict[str, dict] = {}
    for _, g in rows.iterrows():
        wk = str(int(g["week"]))
        home, away = str(g["home_team"]), str(g["away_team"])
        day = g["gameday"]
        gt  = g["gametime"]
        std = g["stadium"]
        roof = g["roof"]

        for team, opp, is_home in [(home, away, True), (away, home, False)]:
            opponent_lookup.setdefault(team, {})[wk] = {
                "opponent":    opp,
                "is_home":     is_home,
                "gameday":     day,
                "gametime":    gt,
                "stadium":     std,
                "roof":        roof,
            }

    lookup_payload = {
        "generated_at": now,
        "season":       export_season,
        "teams":        opponent_lookup,
    }

    # ── Upload ────────────────────────────────────────────────────────────────
    total_games = len(rows)
    for key, payload in [
        ("fantasai/analysis/nfl_schedule.json",    schedule_payload),
        ("fantasai/analysis/opponent_lookup.json", lookup_payload),
    ]:
        body = json.dumps(payload, default=str)
        size_kb = len(body.encode()) / 1024
        print(f"   {key}  ({total_games} games, {size_kb:.1f} KB)")
        if dry_run:
            print("      DRY RUN"); continue
        if not FANTASAI_KEY:
            print("      SKIP — FANTASAI_KEY not set"); continue
        try:
            resp = requests.put(f"{R2_BASE}/{key}", data=body, headers=HEADERS_R2, timeout=30)
            print("      OK" if resp.ok else f"      FAIL HTTP {resp.status_code}")
        except Exception as e:
            print(f"      ERROR {e}")


# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--seasons",      type=str, default=None,
                        help=f"Comma-separated season years, default: {CURRENT_SEASON}")
    parser.add_argument("--export-season", type=int, default=CURRENT_SEASON,
                        help="Which season to export to R2 (default: current)")
    parser.add_argument("--dry-run",      action="store_true")
    parser.add_argument("--export-only",  action="store_true",
                        help="Skip fetch; re-export from existing DB data")
    args = parser.parse_args()

    seasons = [int(s.strip()) for s in args.seasons.split(",")] if args.seasons \
              else [CURRENT_SEASON]

    print("=" * 70)
    print("NFL Schedule Ingestion — nflverse")
    print(f"Timestamp:  {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print(f"Seasons:    {seasons}")
    print(f"Export:     {args.export_season}")
    print(f"Mode:       {'DRY RUN' if args.dry_run else 'LIVE'}")
    print("=" * 70)

    conn = get_conn()
    init_schema(conn)
    ensure_schema(conn)

    if not args.export_only:
        existing = {r[0] for r in conn.execute(
            "SELECT DISTINCT season FROM bronze_nfl_schedules"
        ).fetchall()}
        to_fetch = seasons  # always re-fetch to pick up score updates
        print(f"\nExisting seasons in DB: {sorted(existing)}")
        print(f"Fetching: {to_fetch}")

        print("\n── Fetching from nflverse ────────────────────────────────────────────")
        df = fetch_seasons(to_fetch)
        print(f"   Total games fetched: {len(df)}")

        write_bronze(conn, df, seasons, args.dry_run)

    # Count what's in DB
    counts = conn.execute("""
        SELECT season, COUNT(*) as games
        FROM bronze_nfl_schedules
        GROUP BY season ORDER BY season
    """).fetchall()
    print("\nDB contents:")
    for s, c in counts:
        print(f"   {s}: {c} games")

    print("\n── Exporting to R2 ───────────────────────────────────────────────────")
    export_to_r2(conn, args.export_season, args.dry_run)

    conn.close()
    print("\n✅ Schedule ingestion complete")


if __name__ == "__main__":
    main()
