"""
Depth Chart History — real per-week O-Line starting lineups, 2021-2025
Feeds the O-Line Stability Index (ingest_oline_stability.py) — continuity and
chemistry can't be computed from a single "current snapshot" (that's all
depth_charts/ingest_nflverse.py keeps), so this reconstructs real history instead.

nflverse serves two completely different depth-chart schemas depending on season,
and this script auto-detects which one came back:

  2021-2024 ("weekly" schema) — a genuine per-week `week` column already exists.
  Filter formation=='Offense' & depth_position in {LT,LG,C,RG,RT} & depth_team=='1'
  & game_type=='REG' gives real starters, one row per team per week, no
  reconstruction needed. Confirmed against real 2024 events (ARI's O-line:
  Evan Brown/Froholdt/Hernandez/Williams/Paris Johnson early season, then Kelvin
  Beachum sliding in at RT week 3).

  2025+ ("snapshot" schema) — no week column at all, just ~221 dated snapshots
  (dt) spanning the whole season. Reconstructed by joining each team's schedule
  (bronze_nfl_schedules) to the latest snapshot dt <= that week's gameday — i.e.
  "who was starting entering that game."

Outputs (DuckDB): depth_chart_history

Usage:
  python ingest_depth_chart_history.py                   # DEFAULT_SEASONS
  python ingest_depth_chart_history.py --seasons 2024,2025
  python ingest_depth_chart_history.py --dry-run
"""

import argparse
import sys
from datetime import datetime, timezone
from pathlib import Path

import pandas as pd

sys.path.insert(0, str(Path(__file__).parent.parent))
import ssl_utils  # noqa: F401 — injects Windows cert store
from db import get_conn, init_schema

try:
    import nfl_data_py as nfl
except ImportError:
    print("ERROR: nfl_data_py not installed. Run: pip install nfl_data_py")
    sys.exit(1)

DEFAULT_SEASONS = [2021, 2022, 2023, 2024, 2025]
OL_POS_ABB = {"LT", "LG", "C", "RG", "RT"}


def _normalize_weekly_schema(conn, raw: pd.DataFrame, season: int) -> pd.DataFrame:
    """2021-2024: real week column, depth_team ranks, depth_position slots."""
    sub = raw[
        (raw["formation"] == "Offense")
        & (raw["depth_position"].isin(OL_POS_ABB))
        & (raw["depth_team"] == "1")
        & (raw["game_type"] == "REG")
    ].copy()
    if sub.empty:
        return sub
    sub = sub.rename(columns={
        "club_code": "team", "depth_position": "pos_abb", "full_name": "player_name",
    })
    sub["season"] = season
    sub["week"] = sub["week"].astype(int)
    sub["pos_rank"] = 1
    sub["source_schema"] = "weekly"
    sub["snapshot_dt"] = pd.NaT
    # A handful of team-weeks have duplicate depth_team=='1' rows for the same
    # slot (data-quality noise in the source) — keep the first.
    sub = sub.drop_duplicates(subset=["season", "week", "team", "pos_abb"], keep="first")

    # nflverse's old depth-chart feed includes a spurious extra week (confirmed
    # real case: 2023 ARI has a "week 19, game_type='REG'" entry, but the 2023
    # REG season only had 18 weeks/17 games and ARI didn't make the playoffs —
    # this looks like an end-of-season "final" snapshot mislabeled as a real
    # game week). Cross-check against the actual schedule and drop any
    # (team, week) with no real scheduled game, so "starts" can't exceed a
    # team's actual games played.
    sched = conn.execute("""
        SELECT home_team AS team, week FROM bronze_nfl_schedules WHERE season = ? AND game_type = 'REG'
        UNION
        SELECT away_team AS team, week FROM bronze_nfl_schedules WHERE season = ? AND game_type = 'REG'
    """, [season, season]).df()
    if not sched.empty:
        valid = set(zip(sched["team"], sched["week"]))
        sub = sub[sub.apply(lambda r: (r["team"], r["week"]) in valid, axis=1)]

    return sub[["season", "week", "team", "pos_abb", "pos_rank", "player_name",
                "gsis_id", "source_schema", "snapshot_dt"]]


def _normalize_snapshot_schema(conn, raw: pd.DataFrame, season: int) -> pd.DataFrame:
    """2025+: dt snapshots only, no week — reconstruct via schedule gameday join.

    nflverse's snapshot feed is a changelog, not a full re-publish each time: a
    position only gets a new row when its starter actually changes (confirmed
    real case: GB's RT, Zach Tom, has exactly ONE row all season, from a single
    preseason snapshot — the position was simply stable). An earlier version of
    this function picked one team-wide "latest dt" per week and exact-matched
    all 5 slots against it, which silently dropped any position whose last real
    update predated that team-wide dt (i.e. any stable position) from every
    week except the rare one where the team-wide dt happened to equal that
    position's own timestamp. The fix: resolve each (team, position) slot's
    "as of this gameday" starter independently — a per-position carry-forward,
    not a team-wide snapshot lookup.
    """
    off = raw[
        (raw["pos_grp"] == "3WR 1TE") & (raw["pos_abb"].isin(OL_POS_ABB)) & (raw["pos_rank"] == 1)
    ].copy()
    if off.empty:
        return off
    off["dt"] = pd.to_datetime(off["dt"]).dt.tz_localize(None)

    sched = conn.execute("""
        SELECT home_team AS team, week, gameday, game_id FROM bronze_nfl_schedules
        WHERE season = ? AND game_type = 'REG'
        UNION ALL
        SELECT away_team AS team, week, gameday, game_id FROM bronze_nfl_schedules
        WHERE season = ? AND game_type = 'REG'
    """, [season, season]).df()
    if sched.empty:
        print(f"     ⚠️  No {season} schedule data — cannot reconstruct weeks, skipping")
        return pd.DataFrame()
    sched["gameday"] = pd.to_datetime(sched["gameday"])

    rows = []
    for (team, pos_abb), grp in off.groupby(["team", "pos_abb"]):
        team_sched = sched[sched["team"] == team].sort_values("gameday")
        if team_sched.empty:
            continue
        grp_sorted = grp.sort_values("dt")[["dt", "player_name", "gsis_id"]].drop_duplicates(subset="dt", keep="last")
        matched = pd.merge_asof(
            team_sched.sort_values("gameday"), grp_sorted,
            left_on="gameday", right_on="dt", direction="backward",
        ).dropna(subset=["dt"])
        for _, wk in matched.iterrows():
            rows.append({
                "season": season, "week": int(wk["week"]), "team": team,
                "pos_abb": pos_abb, "pos_rank": 1,
                "player_name": wk["player_name"], "gsis_id": wk["gsis_id"],
                "source_schema": "snapshot", "snapshot_dt": wk["dt"],
                "game_id": wk["game_id"],
            })

    if not rows:
        return pd.DataFrame()
    result = pd.DataFrame(rows)
    # Same (season, week, team, pos_abb) can appear twice if the team played
    # twice in a week's date window (shouldn't happen in REG season, but be safe).
    return result.drop_duplicates(subset=["season", "week", "team", "pos_abb"], keep="last")


def fetch_and_normalize_season(conn, season: int) -> pd.DataFrame:
    print(f"   {season}: downloading depth charts…", end=" ", flush=True)
    try:
        raw = nfl.import_depth_charts(years=[season])
    except Exception as e:
        print(f"FAILED — {e}")
        return pd.DataFrame()

    if "week" in raw.columns and "depth_position" in raw.columns:
        clean = _normalize_weekly_schema(conn, raw, season)
    elif "pos_grp" in raw.columns:
        clean = _normalize_snapshot_schema(conn, raw, season)
    else:
        print(f"unrecognized schema (columns: {list(raw.columns)[:8]}...)")
        return pd.DataFrame()

    print(f"{len(clean):,} O-line starter-weeks")
    return clean


def write_depth_chart_history(conn, df: pd.DataFrame, dry_run: bool):
    if df.empty:
        print("   No depth chart history rows to write"); return
    if dry_run:
        print(f"   DRY RUN — would write {len(df)} rows"); return
    # game_id is only present for 'snapshot' rows — add it as NULL for 'weekly'
    # rows so the two schema outputs can be concatenated/inserted uniformly.
    if "game_id" not in df.columns:
        df["game_id"] = None
    df["imported_at"] = datetime.now(timezone.utc).replace(tzinfo=None)
    for season in df["season"].unique().tolist():
        conn.execute("DELETE FROM depth_chart_history WHERE season = ?", [int(season)])
    conn.register("_dch", df)
    conn.execute("INSERT INTO depth_chart_history BY NAME SELECT * FROM _dch")
    print(f"   💾 depth_chart_history: {len(df):,} rows written")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--seasons", type=str, default=None,
                        help="Comma-separated years, e.g. 2024,2025")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    seasons = [int(y) for y in args.seasons.split(",")] if args.seasons else DEFAULT_SEASONS

    print("=" * 70)
    print("Depth Chart History — real per-week O-Line starting lineups")
    print(f"Timestamp: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print(f"Seasons:   {seasons}")
    print(f"Mode:      {'DRY RUN' if args.dry_run else 'LIVE'}")
    print("=" * 70)

    conn = get_conn()
    init_schema(conn)

    print("\n── Fetching + reconstructing weekly lineups ────────────────────────")
    parts = [fetch_and_normalize_season(conn, s) for s in seasons]
    parts = [p for p in parts if not p.empty]
    if not parts:
        print("   ⚠️  No depth chart history data imported")
        conn.close()
        sys.exit(1)

    combined = pd.concat(parts, ignore_index=True)
    write_depth_chart_history(conn, combined, args.dry_run)

    conn.close()
    print("\n✅ Depth Chart History complete")


if __name__ == "__main__":
    main()
