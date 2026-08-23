"""
Coverage Matchups — Receiver-vs-Coverage-Scheme Splits from Real PBP
New (2026-08-23).

Answers "does this WR/TE/receiving-RB actually perform better against man
or zone coverage, and against which specific scheme — and what does the
upcoming opponent actually run?" using real play-by-play charting data,
not a fabricated matchup score.

Source: nflverse's play-by-play data (nfl_data_py.import_pbp_data) already
embeds defense_coverage_type / defense_man_zone_type / route on every
charted pass play — verified live 2026-08-23 against the 2025 season:
100% of CeeDee Lamb's 117 targets had real coverage data (Man 50 targets/
11.98 Y/T/+0.49 EPA vs Zone 67 targets/7.13 Y/T/+0.06 EPA — a real,
meaningful split, not noise).

What this does NOT give you (confirmed absent from every nflverse field
checked): which specific CB covered which WR, or L/R/slot alignment.
That layer would need PFF (paid, proprietary charting) or the NFL's
internal Coverage Responsibility model (tracking-data-based, not public).
Don't let anything downstream present a "CB1 vs WR1" style matchup from
this data — it isn't there.

Computes two things:
  1. player_coverage_splits — for every receiver with a real target in the
     window, their targets/receptions/yards/EPA broken out by man-vs-zone
     and by individual coverage scheme (Cover 0-9, 2-Man, etc).
  2. team_coverage_tendency — for every defense, what % of its pass plays
     were each coverage type — the other half of "is this a good matchup,"
     since a great vs-zone receiver facing a defense that plays almost
     no zone isn't actually helped by that split.

Outputs (DuckDB):
  player_coverage_splits, team_coverage_tendency

Outputs (R2):
  fantasai/analysis/player_coverage_splits.json
  fantasai/analysis/team_coverage_tendency.json

Usage:
  python ingest_coverage_matchups.py
  python ingest_coverage_matchups.py --seasons 2024,2025
  python ingest_coverage_matchups.py --dry-run
"""

import argparse
import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

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

DEFAULT_SEASONS = [2024, 2025]  # ~2 seasons — enough volume per coverage bucket, still recent
MIN_TARGETS_PER_SPLIT = 3       # below this, exported but the frontend should treat it as low-confidence


def load_pbp(seasons: list[int]):
    import nfl_data_py as nfl
    print(f"   Fetching play-by-play for {seasons} from nflverse...")
    pbp = nfl.import_pbp_data(seasons, downcast=True)
    print(f"   {len(pbp):,} total plays loaded")
    return pbp


def load_gsis_name_map() -> dict:
    """
    pbp's own receiver_player_name is abbreviated ("C.Lamb", not "CeeDee
    Lamb") — doesn't match the app's full-name convention anywhere, so any
    name-based lookup against it would silently fail for ~every player.
    Verified live 2026-08-23: gsis_id 00-0036358 -> receiver_player_name
    "C.Lamb" in pbp, but import_players()'s display_name for that same ID
    is "CeeDee Lamb". Use the real crosswalk instead of pbp's own name field.
    """
    import nfl_data_py as nfl
    players = nfl.import_players()
    return dict(zip(players["gsis_id"], players["display_name"]))


def compute_player_splits(pbp, seasons_label: str, gsis_name_map: dict):
    import pandas as pd
    targets = pbp[
        pbp["receiver_player_id"].notna()
        & pbp["defense_coverage_type"].notna()
    ].copy()
    print(f"   {len(targets):,} charted targets with real coverage data")

    # Resolve real display names from the gsis_id crosswalk — pbp's own
    # receiver_player_name is abbreviated ("C.Lamb") and won't match the
    # app's full-name convention. Falls back to the abbreviated form only
    # if a player is somehow missing from the crosswalk.
    targets["receiver_display_name"] = targets["receiver_player_id"].map(gsis_name_map)
    targets["receiver_display_name"] = targets["receiver_display_name"].fillna(targets["receiver_player_name"])

    targets["reception"] = targets["complete_pass"].fillna(0)
    targets["yards"]     = targets["yards_gained"].fillna(0)
    targets["td"]        = targets["pass_touchdown"].fillna(0)

    rows = []
    now = datetime.now(timezone.utc).replace(tzinfo=None)

    def build_rows(group_col, split_type):
        g = targets.groupby(["receiver_player_id", group_col], dropna=False)
        agg = g.agg(
            targets=("reception", "count"),
            receptions=("reception", "sum"),
            yards=("yards", "sum"),
            tds=("td", "sum"),
            avg_epa=("epa", "mean"),
            receiver_name=("receiver_display_name", "last"),
            team=("posteam", "last"),
        ).reset_index()
        for _, r in agg.iterrows():
            if not r[group_col] or r["targets"] < 1:
                continue
            rows.append({
                "receiver_gsis_id": r["receiver_player_id"],
                "receiver_name":    r["receiver_name"],
                "team":             r["team"],
                "split_type":       split_type,
                "split_value":      r[group_col],
                "targets":          int(r["targets"]),
                "receptions":       int(r["receptions"]),
                "yards":            int(r["yards"]),
                "tds":              int(r["tds"]),
                "avg_epa":          round(float(r["avg_epa"]), 3) if pd.notna(r["avg_epa"]) else None,
                "catch_rate_pct":   round(r["receptions"] / r["targets"] * 100, 1),
                "yds_per_target":   round(r["yards"] / r["targets"], 2),
                "seasons_included": seasons_label,
                "computed_at":      now,
            })

    build_rows("defense_man_zone_type", "man_zone")
    build_rows("defense_coverage_type", "coverage_type")
    return rows


def compute_team_tendency(pbp, seasons_label: str):
    import pandas as pd
    passes = pbp[
        (pbp["pass_attempt"] == 1)
        & pbp["defense_coverage_type"].notna()
        & pbp["defteam"].notna()
    ].copy()
    print(f"   {len(passes):,} charted pass plays with real coverage data (defense side)")

    rows = []
    now = datetime.now(timezone.utc).replace(tzinfo=None)

    def build_rows(col, split_type):
        for team, g in passes.groupby("defteam"):
            total = len(g)
            if total == 0:
                continue
            counts = g[col].value_counts()
            for value, plays in counts.items():
                if not value:
                    continue
                rows.append({
                    "team":              team,
                    "split_type":        split_type,
                    "split_value":       value,
                    "plays":             int(plays),
                    "pct_of_pass_plays": round(plays / total * 100, 1),
                    "seasons_included":  seasons_label,
                    "computed_at":       now,
                })

    build_rows("defense_man_zone_type", "man_zone")
    build_rows("defense_coverage_type", "coverage_type")
    return rows


def write_bronze(conn, player_rows: list[dict], team_rows: list[dict], dry_run: bool):
    if dry_run:
        print(f"   DRY RUN — would write {len(player_rows)} player-split rows, {len(team_rows)} team-tendency rows")
        return
    import pandas as pd

    df = pd.DataFrame(player_rows)
    conn.execute("DELETE FROM player_coverage_splits")
    conn.register("_pcs", df)
    conn.execute("INSERT INTO player_coverage_splits BY NAME SELECT * FROM _pcs")
    print(f"   player_coverage_splits: {len(player_rows)} rows written")

    df2 = pd.DataFrame(team_rows)
    conn.execute("DELETE FROM team_coverage_tendency")
    conn.register("_tct", df2)
    conn.execute("INSERT INTO team_coverage_tendency BY NAME SELECT * FROM _tct")
    print(f"   team_coverage_tendency: {len(team_rows)} rows written")


def _put_r2(key: str, payload: dict, dry_run: bool):
    body = json.dumps(payload, default=str, allow_nan=False)
    size_kb = len(body.encode()) / 1024
    print(f"   {key}  ({size_kb:.1f} KB)")
    if dry_run:
        print("      DRY RUN"); return
    if not FANTASAI_KEY:
        print("      SKIP — FANTASAI_KEY not set"); return
    try:
        resp = requests.put(f"{R2_BASE}/{key}", data=body, headers=HEADERS_R2, timeout=30)
        print("      OK" if resp.ok else f"      FAIL HTTP {resp.status_code}")
    except Exception as e:
        print(f"      ERROR {e}")


def export_to_r2(conn, seasons_label: str, dry_run: bool):
    players = conn.execute("""
        SELECT receiver_gsis_id, receiver_name, team, split_type, split_value,
               targets, receptions, yards, tds, avg_epa, catch_rate_pct, yds_per_target
        FROM player_coverage_splits
        ORDER BY receiver_name, split_type, targets DESC
    """).df()
    teams = conn.execute("""
        SELECT team, split_type, split_value, plays, pct_of_pass_plays
        FROM team_coverage_tendency
        ORDER BY team, split_type, pct_of_pass_plays DESC
    """).df()

    now_iso = datetime.now(timezone.utc).isoformat()
    note = ("No CB assignment or receiver alignment (L/R/slot) in this data — only real coverage-scheme "
            "outcomes charted by nflverse. Splits with fewer than a handful of targets are low-confidence; "
            "check the targets field before treating a split as meaningful.")

    _put_r2("fantasai/analysis/player_coverage_splits.json", {
        "generated_at": now_iso,
        "seasons_included": seasons_label,
        "min_targets_note": note,
        "player_count": players["receiver_gsis_id"].nunique() if not players.empty else 0,
        "row_count": len(players),
        "players": players.to_dict(orient="records"),
    }, dry_run)

    _put_r2("fantasai/analysis/team_coverage_tendency.json", {
        "generated_at": now_iso,
        "seasons_included": seasons_label,
        "team_count": teams["team"].nunique() if not teams.empty else 0,
        "row_count": len(teams),
        "teams": teams.to_dict(orient="records"),
    }, dry_run)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--seasons", type=str, default=",".join(str(s) for s in DEFAULT_SEASONS),
                        help="Comma-separated seasons, e.g. 2024,2025")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    seasons = [int(s) for s in args.seasons.split(",") if s.strip()]
    seasons_label = ",".join(str(s) for s in seasons)

    print("=" * 70)
    print("Coverage Matchups — Receiver-vs-Coverage-Scheme Splits")
    print(f"Timestamp:  {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print(f"Seasons:    {seasons_label}")
    print(f"Mode:       {'DRY RUN' if args.dry_run else 'LIVE'}")
    print("=" * 70)

    conn = get_conn()
    init_schema(conn)

    print("\n   Loading nflverse play-by-play…")
    pbp = load_pbp(seasons)

    print("\n   Loading player ID -> display name crosswalk…")
    gsis_name_map = load_gsis_name_map()
    print(f"   {len(gsis_name_map):,} players in crosswalk")

    print("\n   Computing player coverage splits…")
    player_rows = compute_player_splits(pbp, seasons_label, gsis_name_map)
    print(f"   {len(player_rows)} player-split rows across {len(set(r['receiver_gsis_id'] for r in player_rows))} receivers")

    print("\n   Computing team coverage tendency…")
    team_rows = compute_team_tendency(pbp, seasons_label)
    print(f"   {len(team_rows)} team-tendency rows across {len(set(r['team'] for r in team_rows))} teams")

    print("\n── Writing ─────────────────────────────────────────────────────────")
    write_bronze(conn, player_rows, team_rows, args.dry_run)

    print("\n── Exporting to R2 ───────────────────────────────────────────────────")
    export_to_r2(conn, seasons_label, args.dry_run)

    conn.close()
    print("\n✅ Coverage matchup computation complete")


if __name__ == "__main__":
    main()
