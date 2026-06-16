"""
DST Performance Ingestion — Sleeper Stats API
Produces: analysis/defense_performance.json + fantasai/analysis/defense_performance.json

Fetches weekly DST fantasy scores (pts_ppr) for all 32 NFL teams from Sleeper's
public stats API and computes avg_last_4_weeks per team.

Frontend consumers:
  CurrentRoster.jsx → useR2DefensePerformance() → defRankByTeam (1=toughest matchup)
  Players.jsx       → same

Data shape emitted:
  { "data": [{ "team", "week", "season", "pts_ppr", "avg_last_4_weeks", ... }] }

Usage:
  python ingest_dst_performance.py              # fetch + store 2024 season
  python ingest_dst_performance.py --season 2023
  python ingest_dst_performance.py --dry-run
  python ingest_dst_performance.py --weeks 15,16,17,18  # specific weeks only
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

SLEEPER_STATS_URL = "https://api.sleeper.app/v1/stats/nfl/regular/{season}/{week}"
NFL_REGULAR_SEASON_WEEKS = 18

# DST player_ids in Sleeper = team abbreviation
DST_TEAMS = [
    "ARI","ATL","BAL","BUF","CAR","CHI","CIN","CLE",
    "DAL","DEN","DET","GB","HOU","IND","JAX","KC",
    "LAC","LAR","LV","MIA","MIN","NE","NO","NYG",
    "NYJ","PHI","PIT","SEA","SF","TB","TEN","WAS",
]


# ── Schema ────────────────────────────────────────────────────────────────────

SCHEMA_SQL = """
CREATE TABLE IF NOT EXISTS bronze_dst_weekly_stats (
    team          VARCHAR,
    week          INTEGER,
    season        INTEGER,
    pts_ppr       DOUBLE,
    pts_std       DOUBLE,
    sacks         DOUBLE,
    interceptions DOUBLE,
    fum_rec       DOUBLE,
    def_td        DOUBLE,
    safe          DOUBLE,
    pts_allow     DOUBLE,
    yds_allow     DOUBLE,
    fetched_at    TIMESTAMP,
    PRIMARY KEY (team, week, season)
);
"""


def ensure_schema(conn):
    for stmt in SCHEMA_SQL.split(";"):
        s = stmt.strip()
        if s:
            conn.execute(s)


# ── Fetch ─────────────────────────────────────────────────────────────────────

def fetch_week(season: int, week: int) -> dict[str, dict]:
    """Fetch all stats for a single week; return dict of player_id → stats."""
    url = SLEEPER_STATS_URL.format(season=season, week=week)
    resp = requests.get(url, timeout=20)
    resp.raise_for_status()
    return resp.json()


def build_rows(season: int, weeks: list[int], existing: set) -> list[dict]:
    rows = []
    now = datetime.now(timezone.utc).replace(tzinfo=None)

    for week in weeks:
        if (season, week) in existing:
            print(f"   Week {week}: already in DB — skipping")
            continue

        try:
            data = fetch_week(season, week)
        except Exception as e:
            print(f"   Week {week}: FAILED — {e}")
            time.sleep(1)
            continue

        week_count = 0
        for team in DST_TEAMS:
            stats = data.get(team, {})
            if not stats:
                continue
            rows.append({
                "team":          team,
                "week":          week,
                "season":        season,
                "pts_ppr":       stats.get("pts_ppr"),
                "pts_std":       stats.get("pts_std"),
                "sacks":         stats.get("sack"),
                "interceptions": stats.get("int"),
                "fum_rec":       stats.get("fum_rec"),
                "def_td":        stats.get("td"),
                "safe":          stats.get("safe"),
                "pts_allow":     stats.get("pts_allow"),
                "yds_allow":     stats.get("yds_allow"),
                "fetched_at":    now,
            })
            week_count += 1

        print(f"   Week {week}: {week_count} DST teams fetched")
        time.sleep(0.3)

    return rows


# ── DuckDB write ──────────────────────────────────────────────────────────────

def write_bronze(conn, rows: list[dict], dry_run: bool):
    if not rows or dry_run:
        if dry_run:
            print(f"   DRY RUN — would write {len(rows)} rows")
        return
    df = pd.DataFrame(rows)
    conn.register("_dst", df)
    conn.execute("INSERT OR REPLACE INTO bronze_dst_weekly_stats BY NAME SELECT * FROM _dst")
    print(f"   bronze_dst_weekly_stats: {len(rows)} rows written")


# ── R2 export ─────────────────────────────────────────────────────────────────

def export_to_r2(conn, season: int, dry_run: bool):
    """Compute avg_last_4_weeks per team and export to R2."""
    # Get latest 4 weeks with data for this season
    top_weeks = conn.execute("""
        SELECT DISTINCT week FROM bronze_dst_weekly_stats
        WHERE season = ?
        ORDER BY week DESC LIMIT 4
    """, [season]).df()["week"].tolist()

    if not top_weeks:
        print("   No DST data in DB — skipping R2 export")
        return

    latest_week = max(top_weeks)
    print(f"   Computing avg_last_4_weeks from weeks: {sorted(top_weeks)}")

    # Per-team avg over those 4 weeks + most recent week row
    rows = conn.execute("""
        SELECT
            t.team,
            t.week,
            t.season,
            t.pts_ppr,
            t.pts_std,
            t.sacks,
            t.interceptions,
            t.fum_rec,
            t.def_td,
            t.pts_allow,
            t.yds_allow,
            a.avg_last_4_weeks
        FROM bronze_dst_weekly_stats t
        JOIN (
            SELECT team, AVG(pts_ppr) AS avg_last_4_weeks
            FROM bronze_dst_weekly_stats
            WHERE season = ? AND week IN (SELECT DISTINCT week
                                          FROM bronze_dst_weekly_stats
                                          WHERE season = ?
                                          ORDER BY week DESC LIMIT 4)
            GROUP BY team
        ) a ON t.team = a.team
        WHERE t.season = ? AND t.week = ?
        ORDER BY a.avg_last_4_weeks DESC
    """, [season, season, season, latest_week]).df().to_dict(orient="records")

    now = datetime.now(timezone.utc).isoformat()
    payload = {
        "generated_at":   now,
        "season":         season,
        "latest_week":    latest_week,
        "weeks_averaged": sorted(top_weeks),
        "data":           rows,
    }

    for key in ["analysis/defense_performance.json",
                "fantasai/analysis/defense_performance.json"]:
        body = json.dumps(payload, default=str)
        size_kb = len(body.encode()) / 1024
        print(f"   {key}  ({len(rows)} teams, {size_kb:.1f} KB)")
        if dry_run:
            print("      DRY RUN")
            continue
        if not FANTASAI_KEY:
            print("      SKIP — FANTASAI_KEY not set")
            continue
        try:
            resp = requests.put(f"{R2_BASE}/{key}", data=body, headers=HEADERS_R2, timeout=30)
            print("      OK" if resp.ok else f"      FAIL HTTP {resp.status_code}")
        except Exception as e:
            print(f"      ERROR {e}")


# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--season",   type=int, default=2024, help="NFL season year (default: 2024)")
    parser.add_argument("--weeks",    type=str, default=None, help="Comma-separated week list, e.g. 15,16,17,18")
    parser.add_argument("--dry-run",  action="store_true")
    parser.add_argument("--export-only", action="store_true", help="Skip fetch, just re-export from existing DB data")
    args = parser.parse_args()

    print("=" * 70)
    print("DST Performance Ingestion — Sleeper Stats API")
    print(f"Timestamp: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print(f"Season:    {args.season}")
    print(f"Mode:      {'DRY RUN' if args.dry_run else 'LIVE'}")
    print("=" * 70)

    conn = get_conn()
    init_schema(conn)
    ensure_schema(conn)

    if not args.export_only:
        # Determine which weeks to fetch
        if args.weeks:
            weeks_to_fetch = [int(w.strip()) for w in args.weeks.split(",")]
        else:
            weeks_to_fetch = list(range(1, NFL_REGULAR_SEASON_WEEKS + 1))

        # Find weeks already in DB
        existing_raw = conn.execute(
            "SELECT season, week FROM bronze_dst_weekly_stats WHERE season = ?", [args.season]
        ).fetchall()
        existing = {(r[0], r[1]) for r in existing_raw}
        new_weeks = [w for w in weeks_to_fetch if (args.season, w) not in existing]

        count_before = conn.execute(
            "SELECT COUNT(*) FROM bronze_dst_weekly_stats WHERE season = ?", [args.season]
        ).fetchone()[0]
        print(f"\nExisting rows for {args.season}: {count_before}")
        print(f"Weeks to fetch: {new_weeks if new_weeks else 'none (all cached)'}")

        if new_weeks:
            print("\n── Fetching from Sleeper ─────────────────────────────────────────────")
            rows = build_rows(args.season, new_weeks, existing)
            write_bronze(conn, rows, args.dry_run)

    print("\n── Exporting to R2 ───────────────────────────────────────────────────")
    export_to_r2(conn, args.season, args.dry_run)

    conn.close()
    print("\n✅ DST performance ingestion complete")


if __name__ == "__main__":
    main()
