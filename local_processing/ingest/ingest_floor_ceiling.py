"""
Floor/Ceiling Projections — Empirical Percentiles from Real Game Logs
New (2026-08-22).

Computes each player's floor/median/ceiling from their ACTUAL historical
fantasy-point game log (gold_weekly_stats — nflverse + API-Sports, 2021-2025,
28K+ rows) rather than fabricating a number. This is real answered from a
real question: "does this player sometimes smash and have a high ceiling,
or are they dependable with a high floor?" — not a Monte Carlo simulation
(no player-level distributional model exists for that yet), just genuine
percentiles from what they've actually done.

Method:
  - Only the player's most recent MAX_GAMES_WINDOW games count, so a
    role change (post-injury, new team, depth chart move) isn't diluted by
    years-old, no-longer-relevant history.
  - Only games with fantasy_points > 0 count as "played" — gold_weekly_stats
    has no separate active/inactive flag, so a logged 0 is treated as a bye
    or inactive week, not a real scoring floor of zero. This slightly
    inflates the floor for anyone who has had a genuine scoreless active
    game, but that's rare enough at skill positions to be an acceptable
    tradeoff versus counting every bye week as a "floor" data point.
  - Requires MIN_GAMES games in the window to compute at all — an unstable
    percentile off 2-3 games is worse than no number.

Floor = 25th percentile, Ceiling = 90th percentile of that game log — both
standard DFS/fantasy conventions, not something invented for this script.

Outputs (DuckDB):
  player_floor_ceiling — one row per player with a big enough sample

Outputs (R2):
  fantasai/analysis/floor_ceiling.json

Usage:
  python ingest_floor_ceiling.py
  python ingest_floor_ceiling.py --dry-run
  python ingest_floor_ceiling.py --min-games 4       # lower the bar (default 6)
  python ingest_floor_ceiling.py --window 16         # smaller recency window (default 24)
"""

import argparse
import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
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

MAX_GAMES_WINDOW = 24  # ~1.5 seasons — recent role, not career-long history
MIN_GAMES = 6          # below this, a percentile is more noise than signal


def compute_floor_ceiling(conn, max_games: int, min_games: int):
    df = conn.execute("""
        SELECT master_player_id, player_name, position, team, season, week, fantasy_points
        FROM gold_weekly_stats
        WHERE fantasy_points > 0
          AND position IN ('QB', 'RB', 'WR', 'TE', 'K')
        ORDER BY master_player_id, season DESC, week DESC
    """).df()

    if df.empty:
        return []

    rows = []
    for pid, g in df.groupby("master_player_id"):
        recent = g.head(max_games)
        n = len(recent)
        if n < min_games:
            continue
        pts = recent["fantasy_points"].to_numpy()
        median = float(np.percentile(pts, 50))
        floor = float(np.percentile(pts, 25))
        ceiling = float(np.percentile(pts, 90))
        mean = float(np.mean(pts))
        boom_rate = float(np.mean(pts >= median * 1.5)) if median > 0 else 0.0
        bust_rate = float(np.mean(pts < median * 0.5)) if median > 0 else 0.0
        latest = recent.iloc[0]
        rows.append({
            "master_player_id": pid,
            "player_name":      latest["player_name"],
            "position":         latest["position"],
            "team":             latest["team"],
            "games_sample":     n,
            "floor_pts":        round(floor, 1),
            "median_pts":       round(median, 1),
            "ceiling_pts":      round(ceiling, 1),
            "mean_pts":         round(mean, 1),
            "boom_rate":        round(boom_rate * 100, 1),
            "bust_rate":        round(bust_rate * 100, 1),
            "computed_at":      datetime.now(timezone.utc).replace(tzinfo=None),
        })
    return rows


def write_bronze(conn, rows: list[dict], dry_run: bool):
    if dry_run:
        print(f"   DRY RUN — would write {len(rows)} rows")
        return
    import pandas as pd
    df = pd.DataFrame(rows)
    conn.execute("DELETE FROM player_floor_ceiling")
    conn.register("_floor_ceiling", df)
    conn.execute("INSERT INTO player_floor_ceiling BY NAME SELECT * FROM _floor_ceiling")
    print(f"   player_floor_ceiling: {len(rows)} rows written")


def export_to_r2(conn, dry_run: bool):
    rows = conn.execute("""
        SELECT master_player_id, player_name, position, team, games_sample,
               floor_pts, median_pts, ceiling_pts, mean_pts, boom_rate, bust_rate
        FROM player_floor_ceiling
        ORDER BY ceiling_pts DESC
    """).df()

    if rows.empty:
        print("   No floor/ceiling data — skipping R2 export")
        return

    payload = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "method": f"25th/90th percentile of each player's most recent {MAX_GAMES_WINDOW} games "
                   f"with fantasy_points > 0 (min {MIN_GAMES} games required)",
        "player_count": len(rows),
        "players": rows.to_dict(orient="records"),
    }

    key = "fantasai/analysis/floor_ceiling.json"
    body = json.dumps(payload, default=str, allow_nan=False)
    size_kb = len(body.encode()) / 1024
    print(f"   {key}  ({len(rows)} players, {size_kb:.1f} KB)")
    if dry_run:
        print("      DRY RUN"); return
    if not FANTASAI_KEY:
        print("      SKIP — FANTASAI_KEY not set"); return
    try:
        resp = requests.put(f"{R2_BASE}/{key}", data=body, headers=HEADERS_R2, timeout=30)
        print("      OK" if resp.ok else f"      FAIL HTTP {resp.status_code}")
    except Exception as e:
        print(f"      ERROR {e}")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--min-games", type=int, default=MIN_GAMES)
    parser.add_argument("--window",    type=int, default=MAX_GAMES_WINDOW)
    parser.add_argument("--dry-run",   action="store_true")
    args = parser.parse_args()

    print("=" * 70)
    print("Floor/Ceiling Projections — Empirical Percentiles")
    print(f"Timestamp:  {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print(f"Window:     most recent {args.window} games, min {args.min_games} required")
    print(f"Mode:       {'DRY RUN' if args.dry_run else 'LIVE'}")
    print("=" * 70)

    conn = get_conn()
    init_schema(conn)

    print("\n   Computing from gold_weekly_stats…")
    rows = compute_floor_ceiling(conn, args.window, args.min_games)
    print(f"   {len(rows)} players with a big enough sample")

    print("\n── Writing ─────────────────────────────────────────────────────────")
    write_bronze(conn, rows, args.dry_run)

    print("\n── Exporting to R2 ───────────────────────────────────────────────────")
    export_to_r2(conn, args.dry_run)

    conn.close()
    print("\n✅ Floor/Ceiling computation complete")


if __name__ == "__main__":
    main()
