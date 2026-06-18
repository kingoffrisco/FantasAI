"""
nflverse Data Import — Headshots, YAC, Next Gen Stats, Depth Charts
Replaces: notebooks/01_Ingestion/Bronze/Import nflverse Player Data.ipynb
          notebooks/05_Scheduled_Jobs/nflverse - Scheduled Weekly Update.ipynb

Uses the nfl_data_py library (free, no API key required).

Outputs:
  player_headshots       — skill position players with headshot URLs
  player_yac_stats       — weekly YAC aggregated from play-by-play
  player_nextgen_stats   — NGS receiving data (YACOE, air yards, etc.)
  depth_charts           — weekly depth chart positions
  silver_weekly_stats    — nflverse seasonal stats (upserted)

Usage:
  pip install nfl_data_py
  python ingest_nflverse.py
  python ingest_nflverse.py --seasons 2024,2025
  python ingest_nflverse.py --section headshots   # one section only
  python ingest_nflverse.py --dry-run
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

SKILL_POSITIONS = {"QB", "RB", "WR", "TE"}
DEFAULT_SEASONS = [2021, 2022, 2023, 2024, 2025]


# ── Headshots ─────────────────────────────────────────────────────────────────

def import_headshots(conn, dry_run: bool):
    print("\n📸 Section 1: Player Headshots")
    try:
        players = nfl.import_players()
    except Exception as e:
        print(f"   ⚠️  Could not fetch players: {e}")
        return

    available = set(players.columns)
    keep      = [c for c in [
        "gsis_id", "position", "headshot", "status", "birth_date",
        "height", "weight", "years_of_experience",
        "display_name", "short_name", "first_name", "last_name",
        "team_abbr", "current_team_id", "college_name"
    ] if c in available]
    df = players[keep].copy()

    if "display_name" in df.columns:
        df["player_name"] = df["display_name"]
    elif "short_name" in df.columns:
        df["player_name"] = df["short_name"]
    elif {"first_name", "last_name"} <= available:
        df["player_name"] = df["first_name"].fillna("") + " " + df["last_name"].fillna("")

    df["team"] = df.get("team_abbr", df.get("current_team_id"))
    if "college_name" in df.columns:
        df["college"] = df["college_name"]
    else:
        df["college"] = None

    df = df[df["headshot"].notna() & df["position"].isin(SKILL_POSITIONS)].copy()
    df["imported_at"] = datetime.now(timezone.utc).replace(tzinfo=None)

    print(f"   ✅ {len(df):,} players with headshots")
    if dry_run:
        return

    # Only select columns that exist in the schema
    select_cols = ["gsis_id", "player_name", "position", "team", "headshot",
                   "status", "birth_date", "height", "weight",
                   "years_of_experience", "college", "imported_at"]
    select_cols = [c for c in select_cols if c in df.columns]

    conn.execute("DELETE FROM player_headshots")
    conn.register("_heads", df[select_cols])
    conn.execute("INSERT INTO player_headshots SELECT * FROM _heads")
    print(f"   💾 player_headshots: {len(df):,} rows")


# ── YAC ───────────────────────────────────────────────────────────────────────

def import_yac(conn, seasons: list[int], dry_run: bool):
    print("\n🏈 Section 2: Yards After Catch (YAC)")
    yac_parts = []
    for season in seasons:
        print(f"   {season}: downloading play-by-play…")
        try:
            pbp = nfl.import_pbp_data([season], columns=[
                "season", "week", "receiver_player_id", "receiver_player_name",
                "complete_pass", "yards_after_catch", "receiving_yards", "air_yards"
            ])
            sub = pbp[
                (pbp["complete_pass"] == 1) &
                pbp["yards_after_catch"].notna() &
                pbp["receiver_player_id"].notna()
            ].copy()
            print(f"     ✅ {len(sub):,} complete passes with YAC")
            yac_parts.append(sub)
        except Exception as e:
            print(f"     ⚠️  {season}: {e}")

    if not yac_parts:
        print("   ⚠️  No YAC data imported")
        return

    yac_df = pd.concat(yac_parts, ignore_index=True)
    # Group by player_id only (not name) to avoid dupes when name varies across plays
    weekly = (
        yac_df.groupby(["season", "week", "receiver_player_id"])
        .agg(
            player_name       = ("receiver_player_name", "first"),
            total_yac         = ("yards_after_catch", "sum"),
            yac_per_reception = ("yards_after_catch", "mean"),
            receptions        = ("yards_after_catch", "count"),
            receiving_yards   = ("receiving_yards",   "sum"),
            air_yards         = ("air_yards",         "sum"),
        )
        .reset_index()
        .rename(columns={"receiver_player_id": "gsis_id"})
    )
    weekly["yac_percentage"] = (weekly["total_yac"] / weekly["receiving_yards"] * 100).fillna(0).clip(0, 100).round(1)
    weekly["yac_per_reception"] = weekly["yac_per_reception"].round(2)
    weekly["imported_at"] = datetime.now(timezone.utc).replace(tzinfo=None)

    print(f"   ✅ {len(weekly):,} player-week YAC records")
    if dry_run:
        return

    conn.execute("DELETE FROM player_yac_stats")
    conn.register("_yac", weekly)
    conn.execute("INSERT INTO player_yac_stats SELECT * FROM _yac")
    print(f"   💾 player_yac_stats: {len(weekly):,} rows")


# ── Next Gen Stats ─────────────────────────────────────────────────────────────

def import_ngs(conn, seasons: list[int], dry_run: bool):
    print("\n📊 Section 3: Next Gen Stats (YACOE)")
    ngs_parts = []
    for season in seasons:
        print(f"   {season}: downloading NGS receiving…")
        try:
            ngs = nfl.import_ngs_data(stat_type="receiving", years=[season])
            print(f"     ✅ {len(ngs):,} records")
            ngs_parts.append(ngs)
        except Exception as e:
            print(f"     ⚠️  {season}: {e}")

    if not ngs_parts:
        print("   ⚠️  No NGS data imported")
        return

    ngs_df = pd.concat(ngs_parts, ignore_index=True)
    ngs_clean = ngs_df.rename(columns={
        "player_gsis_id":             "gsis_id",
        "player_display_name":        "player_name",
        "avg_yac_above_expectation":  "yacoe",
    })[[
        "season", "week", "gsis_id", "player_name",
        "avg_cushion", "avg_separation", "avg_intended_air_yards",
        "percent_share_of_intended_air_yards", "receptions", "targets",
        "avg_yac", "avg_expected_yac", "yacoe"
    ]].copy()
    ngs_clean["imported_at"] = datetime.now(timezone.utc).replace(tzinfo=None)

    print(f"   ✅ {len(ngs_clean):,} NGS records")
    if dry_run:
        return

    conn.execute("DELETE FROM player_nextgen_stats")
    conn.register("_ngs", ngs_clean)
    conn.execute("INSERT INTO player_nextgen_stats SELECT * FROM _ngs")
    print(f"   💾 player_nextgen_stats: {len(ngs_clean):,} rows")


# ── Depth Charts ──────────────────────────────────────────────────────────────

def import_depth_charts(conn, seasons: list[int], dry_run: bool):
    print("\n📋 Section 4: Depth Charts")
    depth_parts = []
    for season in seasons:
        print(f"   {season}: downloading depth charts…")
        try:
            depth = nfl.import_depth_charts(years=[season])
            sub   = depth[depth["position"].isin(SKILL_POSITIONS)].copy()
            print(f"     ✅ {len(sub):,} records")
            depth_parts.append(sub)
        except Exception as e:
            print(f"     ⚠️  {season}: {e}")

    if not depth_parts:
        print("   ⚠️  No depth chart data imported")
        return

    depth_df = pd.concat(depth_parts, ignore_index=True)
    # nflverse renamed 'team' → 'club_code' in 2024+; handle both
    col_renames = {"full_name": "player_name", "club_code": "team"}
    depth_df = depth_df.rename(columns={k: v for k, v in col_renames.items() if k in depth_df.columns})
    want_cols = ["season", "week", "game_type", "team", "position",
                 "depth_team", "formation", "gsis_id", "player_name",
                 "first_name", "last_name", "jersey_number"]
    have_cols = [c for c in want_cols if c in depth_df.columns]
    if len(have_cols) < len(want_cols):
        missing = set(want_cols) - set(have_cols)
        print(f"   ⚠️  Depth chart columns missing (skipping): {missing}")
    depth_clean = depth_df[have_cols].copy()
    depth_clean["imported_at"] = datetime.now(timezone.utc).replace(tzinfo=None)

    print(f"   ✅ {len(depth_clean):,} depth chart records")
    if dry_run:
        return

    conn.execute("DELETE FROM depth_charts")
    conn.register("_depth", depth_clean)
    conn.execute("INSERT INTO depth_charts SELECT * FROM _depth")
    print(f"   💾 depth_charts: {len(depth_clean):,} rows")


# ── nflverse weekly stats (for silver_weekly_stats) ───────────────────────────

def _fetch_weekly_stats_direct(season: int) -> "pd.DataFrame":
    """Fallback for seasons where nfl_data_py's URL no longer works.
    nflverse renamed the file from player_stats_{y}.parquet to
    stats_player_week_{y}.parquet starting with the 2025 season.
    """
    import io, urllib.request
    url = (
        f"https://github.com/nflverse/nflverse-data/releases/download/"
        f"player_stats/stats_player_week_{season}.parquet"
    )
    print(f"     Trying new URL pattern: stats_player_week_{season}.parquet")
    with urllib.request.urlopen(url, timeout=60) as resp:
        return pd.read_parquet(io.BytesIO(resp.read()))


def import_weekly_stats(conn, seasons: list[int], dry_run: bool):
    print("\n📈 Section 5: nflverse Weekly Stats")
    import json
    stats_parts = []
    for season in seasons:
        print(f"   {season}: downloading weekly stats…")
        try:
            stats = nfl.import_weekly_data([season])
            print(f"     ✅ {len(stats):,} player-week records")
            stats_parts.append(stats)
        except Exception as e:
            print(f"     ⚠️  {season}: {e} — trying direct URL fallback")
            try:
                stats = _fetch_weekly_stats_direct(season)
                print(f"     ✅ {len(stats):,} player-week records (direct URL)")
                stats_parts.append(stats)
            except Exception as e2:
                print(f"     ⚠️  {season}: direct URL also failed — {e2}")

    if not stats_parts:
        print("   ⚠️  No weekly stats imported")
        return

    df = pd.concat(stats_parts, ignore_index=True)
    now = datetime.now(timezone.utc).replace(tzinfo=None)

    # Build rows for bronze_weekly_stats / silver_weekly_stats
    rows = []
    for _, row in df.iterrows():
        player_id = row.get("player_id") or row.get("gsis_id") or ""
        if not player_id:
            continue
        stats_dict = {c: (None if pd.isna(v) else v) for c, v in row.items()}
        rows.append({
            "player_id":     str(player_id),
            "week":          int(row.get("week", 0)),
            "season":        int(row.get("season", 0)),
            "fantasy_points": float(row.get("fantasy_points_ppr") or row.get("fantasy_points") or 0),
            "stats":         json.dumps(stats_dict, default=str),
            "source":        "nflverse",
            "player_name":   str(row.get("player_display_name") or row.get("player_name") or ""),
            "position":      str(row.get("position") or ""),
            "team":          str(row.get("recent_team") or row.get("team") or ""),
            "ingested_at":   now,
            "receiving_yards_after_catch": float(row["receiving_yards_after_catch"])
                                           if "receiving_yards_after_catch" in row and not pd.isna(row.get("receiving_yards_after_catch")) else None,
            "passing_yards_after_catch":  float(row["passing_air_yards"])
                                           if "passing_air_yards" in row and not pd.isna(row.get("passing_air_yards")) else None,
            "headshot_url":  str(row.get("headshot_url") or "") or None,
        })

    import_df = pd.DataFrame(rows)
    print(f"   ✅ {len(import_df):,} nflverse stat rows prepared")
    if dry_run or import_df.empty:
        return

    conn.register("_nflv", import_df)
    conn.execute("""
        INSERT INTO silver_weekly_stats BY NAME
        SELECT * FROM _nflv
        ON CONFLICT (player_id, week, season, source) DO UPDATE SET
            fantasy_points               = excluded.fantasy_points,
            stats                        = excluded.stats,
            player_name                  = excluded.player_name,
            position                     = excluded.position,
            team                         = excluded.team,
            ingested_at                  = excluded.ingested_at,
            receiving_yards_after_catch  = excluded.receiving_yards_after_catch,
            passing_yards_after_catch    = excluded.passing_yards_after_catch,
            headshot_url                 = excluded.headshot_url
    """)
    print(f"   💾 silver_weekly_stats: {len(import_df):,} rows upserted (source=nflverse)")


# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--seasons",  type=str, default=None,
                        help="Comma-separated years, e.g. 2024,2025")
    parser.add_argument("--section",  choices=["headshots", "yac", "ngs", "depth", "stats", "all"],
                        default="all")
    parser.add_argument("--dry-run",  action="store_true")
    args = parser.parse_args()

    seasons = [int(y) for y in args.seasons.split(",")] if args.seasons else DEFAULT_SEASONS

    print("=" * 70)
    print("nflverse Data Import")
    print(f"Seasons: {seasons}")
    print(f"Section: {args.section}")
    print(f"Timestamp: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print("=" * 70)

    conn = get_conn()
    init_schema(conn)

    run_all = args.section == "all"
    if run_all or args.section == "headshots": import_headshots(conn, args.dry_run)
    if run_all or args.section == "yac":       import_yac(conn, seasons, args.dry_run)
    if run_all or args.section == "ngs":       import_ngs(conn, seasons, args.dry_run)
    if run_all or args.section == "depth":     import_depth_charts(conn, seasons, args.dry_run)
    if run_all or args.section == "stats":     import_weekly_stats(conn, seasons, args.dry_run)

    conn.close()
    print("\n✅ nflverse import complete")


if __name__ == "__main__":
    main()
