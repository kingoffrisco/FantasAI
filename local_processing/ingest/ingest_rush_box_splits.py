"""
Rush Box-Count Matchups — Runner-vs-Box-Count Splits from Real PBP
New (2026-08-25).

The run-game counterpart to Coverage Matchups: answers "does this RB actually
perform better against a light box or a stacked box — and how often does the
upcoming opponent actually load the box?" using real play-by-play data, not a
fabricated matchup score.

Source: nflverse's play-by-play data (nfl_data_py.import_pbp_data) natively
includes defenders_in_box on every play — verified live 2026-08-25: 100%
coverage on all 30,828 rush plays across 2024-2025 (0 missing). Bijan
Robinson specifically: 5.28 YPC on 368 carries vs a 6-man box, 4.15 YPC on
153 carries vs a 7-man box — a real, meaningful split, not noise.

What this does NOT give you: which specific defenders were in the box, gap
assignment, or blocking scheme (zone/gap/power) the offense ran. Just box
count vs outcome.

Computes two things:
  1. player_rush_box_splits — for every rusher with real carries, their
     attempts/yards/EPA broken out by box-count group (Light/Standard/
     Stacked) and by the exact defender count.
  2. team_rush_box_tendency — for every defense, what % of its run snaps
     were each box-count group/exact count — the matchup's other half.

Outputs (DuckDB):
  player_rush_box_splits, team_rush_box_tendency

Outputs (R2):
  fantasai/analysis/player_rush_box_splits.json
  fantasai/analysis/team_rush_box_tendency.json

Usage:
  python ingest_rush_box_splits.py
  python ingest_rush_box_splits.py --seasons 2024,2025
  python ingest_rush_box_splits.py --dry-run
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

DEFAULT_SEASONS = [2024, 2025]
MIN_ATTEMPTS_PER_SPLIT = 3  # exported regardless, frontend should treat below this as low-confidence


def box_group(n: float) -> str:
    if n <= 6:
        return "LIGHT_BOX"
    if n == 7:
        return "STANDARD_BOX"
    return "STACKED_BOX"


def load_pbp(seasons: list[int]):
    import nfl_data_py as nfl
    print(f"   Fetching play-by-play for {seasons} from nflverse...")
    pbp = nfl.import_pbp_data(seasons, downcast=True)
    print(f"   {len(pbp):,} total plays loaded")
    return pbp


def load_gsis_name_map() -> dict:
    """Same rationale as ingest_coverage_matchups.py — pbp's own
    rusher_player_name is abbreviated ("B.Robinson"), not the app's full-name
    convention ("Bijan Robinson"). Resolve via the real gsis_id crosswalk."""
    import nfl_data_py as nfl
    players = nfl.import_players()
    return dict(zip(players["gsis_id"], players["display_name"]))


def compute_player_splits(pbp, seasons_label: str, gsis_name_map: dict):
    import pandas as pd
    rushes = pbp[
        pbp["rusher_player_id"].notna()
        & pbp["defenders_in_box"].notna()
        & (pbp["rush_attempt"] == 1)
    ].copy()
    print(f"   {len(rushes):,} charted rush attempts with real box-count data")

    rushes["rusher_display_name"] = rushes["rusher_player_id"].map(gsis_name_map)
    rushes["rusher_display_name"] = rushes["rusher_display_name"].fillna(rushes["rusher_player_name"])
    rushes["box_group_val"] = rushes["defenders_in_box"].apply(box_group)
    rushes["box_count_val"] = rushes["defenders_in_box"].astype(int).astype(str)

    rushes["yards"] = rushes["rushing_yards"].fillna(0)
    rushes["td"]    = rushes["rush_touchdown"].fillna(0)

    rows = []
    now = datetime.now(timezone.utc).replace(tzinfo=None)

    def build_rows(group_col, split_type):
        g = rushes.groupby(["rusher_player_id", group_col], dropna=False)
        agg = g.agg(
            attempts=("yards", "count"),
            yards=("yards", "sum"),
            tds=("td", "sum"),
            avg_epa=("epa", "mean"),
            rusher_name=("rusher_display_name", "last"),
            team=("posteam", "last"),
        ).reset_index()
        for _, r in agg.iterrows():
            if not r[group_col] or r["attempts"] < 1:
                continue
            rows.append({
                "rusher_gsis_id":   r["rusher_player_id"],
                "rusher_name":      r["rusher_name"],
                "team":             r["team"],
                "split_type":       split_type,
                "split_value":      r[group_col],
                "attempts":         int(r["attempts"]),
                "yards":            int(r["yards"]),
                "tds":              int(r["tds"]),
                "avg_epa":          round(float(r["avg_epa"]), 3) if pd.notna(r["avg_epa"]) else None,
                "yards_per_carry":  round(r["yards"] / r["attempts"], 2),
                "seasons_included": seasons_label,
                "computed_at":      now,
            })

    build_rows("box_group_val", "box_group")
    build_rows("box_count_val", "box_count")
    return rows


def compute_team_tendency(pbp, seasons_label: str):
    import pandas as pd
    rushes = pbp[
        (pbp["rush_attempt"] == 1)
        & pbp["defenders_in_box"].notna()
        & pbp["defteam"].notna()
    ].copy()
    print(f"   {len(rushes):,} charted rush plays with real box-count data (defense side)")

    rushes["box_group_val"] = rushes["defenders_in_box"].apply(box_group)
    rushes["box_count_val"] = rushes["defenders_in_box"].astype(int).astype(str)

    rows = []
    now = datetime.now(timezone.utc).replace(tzinfo=None)

    def build_rows(col, split_type):
        for team, g in rushes.groupby("defteam"):
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
                    "pct_of_rush_plays": round(plays / total * 100, 1),
                    "seasons_included":  seasons_label,
                    "computed_at":       now,
                })

    build_rows("box_group_val", "box_group")
    build_rows("box_count_val", "box_count")
    return rows


def write_bronze(conn, player_rows: list[dict], team_rows: list[dict], dry_run: bool):
    if dry_run:
        print(f"   DRY RUN — would write {len(player_rows)} player-split rows, {len(team_rows)} team-tendency rows")
        return
    import pandas as pd

    df = pd.DataFrame(player_rows)
    conn.execute("DELETE FROM player_rush_box_splits")
    conn.register("_prbs", df)
    conn.execute("INSERT INTO player_rush_box_splits BY NAME SELECT * FROM _prbs")
    print(f"   player_rush_box_splits: {len(player_rows)} rows written")

    df2 = pd.DataFrame(team_rows)
    conn.execute("DELETE FROM team_rush_box_tendency")
    conn.register("_trbt", df2)
    conn.execute("INSERT INTO team_rush_box_tendency BY NAME SELECT * FROM _trbt")
    print(f"   team_rush_box_tendency: {len(team_rows)} rows written")


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
        SELECT rusher_gsis_id, rusher_name, team, split_type, split_value,
               attempts, yards, tds, avg_epa, yards_per_carry
        FROM player_rush_box_splits
        ORDER BY rusher_name, split_type, attempts DESC
    """).df()
    teams = conn.execute("""
        SELECT team, split_type, split_value, plays, pct_of_rush_plays
        FROM team_rush_box_tendency
        ORDER BY team, split_type, pct_of_rush_plays DESC
    """).df()

    now_iso = datetime.now(timezone.utc).isoformat()
    note = ("No blocking scheme, gap assignment, or which specific defenders were in the box — only "
            "real box-count outcomes charted by nflverse. Splits with fewer than a handful of attempts "
            "are low-confidence; check the attempts field before treating a split as meaningful.")

    _put_r2("fantasai/analysis/player_rush_box_splits.json", {
        "generated_at": now_iso,
        "seasons_included": seasons_label,
        "min_attempts_note": note,
        "player_count": players["rusher_gsis_id"].nunique() if not players.empty else 0,
        "row_count": len(players),
        "players": players.to_dict(orient="records"),
    }, dry_run)

    _put_r2("fantasai/analysis/team_rush_box_tendency.json", {
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
    print("Rush Box-Count Matchups — Runner-vs-Box-Count Splits")
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

    print("\n   Computing player rush box-count splits…")
    player_rows = compute_player_splits(pbp, seasons_label, gsis_name_map)
    print(f"   {len(player_rows)} player-split rows across {len(set(r['rusher_gsis_id'] for r in player_rows))} rushers")

    print("\n   Computing team rush box-count tendency…")
    team_rows = compute_team_tendency(pbp, seasons_label)
    print(f"   {len(team_rows)} team-tendency rows across {len(set(r['team'] for r in team_rows))} teams")

    print("\n── Writing ─────────────────────────────────────────────────────────")
    write_bronze(conn, player_rows, team_rows, args.dry_run)

    print("\n── Exporting to R2 ───────────────────────────────────────────────────")
    export_to_r2(conn, seasons_label, args.dry_run)

    conn.close()
    print("\n✅ Rush box-count matchup computation complete")


if __name__ == "__main__":
    main()
