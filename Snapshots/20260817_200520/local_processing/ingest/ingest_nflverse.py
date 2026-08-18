"""
nflverse Data Import — Headshots, YAC, Next Gen Stats, Depth Charts
Replaces: notebooks/01_Ingestion/Bronze/Import nflverse Player Data.ipynb
          notebooks/05_Scheduled_Jobs/nflverse - Scheduled Weekly Update.ipynb

Uses the nfl_data_py library (free, no API key required).

Outputs:
  player_headshots        — skill position players with headshot URLs
  player_yac_stats        — weekly YAC aggregated from play-by-play
  player_nextgen_stats    — NGS receiving data (YACOE, air yards, etc.)
  depth_charts            — weekly depth chart positions
  silver_weekly_stats     — nflverse seasonal stats (upserted)
  player_snap_counts      — weekly offense snap share (real snap-share-delta source)
  player_efficiency_stats — EPA/play, success rate, explosive play rate, red zone/
                            goal-line usage, and a public-data Elusiveness Score
                            (proxy for PFF's missed-tackles-forced, which isn't public)
  player_roster_bio       — O-line age/experience/college/draft info (for OLSI)
  player_penalties        — O-line holding/false-start penalties, real referee data (for OLSI)

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
# nflverse depth charts group offense entirely under pos_grp == "3WR 1TE" (personnel
# package), with these real pos_abb values — includes the O-Line slots (LT/LG/C/RG/RT)
# needed for the Offensive Ecosystem feature, on top of the skill positions above.
OFFENSE_POS_ABB = {"QB", "RB", "FB", "WR", "TE", "LT", "LG", "C", "RG", "RT"}
# nflverse's snap-count position labels for the offensive line — generic (no left/
# right side), used by the O-Line Stability Index (ingest_oline_stability.py) to get
# real per-week snap counts for O-line players by name+team.
OL_SNAP_POSITIONS = {"C", "G", "T", "OL", "FB"}
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

    for season in weekly["season"].unique().tolist():
        conn.execute("DELETE FROM player_yac_stats WHERE season = ?", [int(season)])
    conn.register("_yac", weekly)
    conn.execute("INSERT INTO player_yac_stats SELECT * FROM _yac")
    print(f"   💾 player_yac_stats: {len(weekly):,} rows")


# ── Snap Counts ───────────────────────────────────────────────────────────────

def import_snap_counts(conn, seasons: list[int], dry_run: bool):
    print("\n🔢 Section: Snap Counts (offense snap share)")
    snap_parts = []
    for season in seasons:
        print(f"   {season}: downloading snap counts…")
        try:
            snaps = nfl.import_snap_counts(years=[season])
            sub = snaps[snaps["position"].isin(SKILL_POSITIONS | OL_SNAP_POSITIONS)].copy()
            print(f"     ✅ {len(sub):,} records")
            snap_parts.append(sub)
        except Exception as e:
            print(f"     ⚠️  {season}: {e}")

    if not snap_parts:
        print("   ⚠️  No snap count data imported")
        return

    snaps_df = pd.concat(snap_parts, ignore_index=True)
    clean = snaps_df.rename(columns={"player": "player_name"})[[
        "season", "week", "player_name", "position", "team", "offense_snaps", "offense_pct"
    ]].copy()
    # Sum across game_type duplicates (e.g. regular season vs. playoffs in the same week key)
    clean = (
        clean.groupby(["season", "week", "player_name", "position", "team"], as_index=False)
        .agg(offense_snaps=("offense_snaps", "sum"), offense_pct=("offense_pct", "max"))
    )
    clean["imported_at"] = datetime.now(timezone.utc).replace(tzinfo=None)

    print(f"   ✅ {len(clean):,} player-week snap count records")
    if dry_run:
        return

    for season in clean["season"].unique().tolist():
        conn.execute("DELETE FROM player_snap_counts WHERE season = ?", [int(season)])
    conn.register("_snaps", clean)
    conn.execute("INSERT INTO player_snap_counts SELECT * FROM _snaps")
    print(f"   💾 player_snap_counts: {len(clean):,} rows")


# ── Efficiency metrics (EPA, success rate, explosive plays, RZ/goal-line usage) ─

def import_efficiency_stats(conn, seasons: list[int], dry_run: bool):
    print("\n⚡ Section: Efficiency Metrics (EPA, success rate, explosive plays)")
    PBP_COLS = [
        "season", "week", "posteam", "play_type", "down", "ydstogo", "yards_gained",
        "epa", "yardline_100",
        "rush_attempt", "rusher_player_id", "rusher_player_name",
        "pass_attempt", "complete_pass", "receiver_player_id", "receiver_player_name",
    ]
    eff_parts = []
    for season in seasons:
        print(f"   {season}: downloading play-by-play…")
        try:
            pbp = nfl.import_pbp_data([season], columns=PBP_COLS)
            eff_parts.append(pbp)
            print(f"     ✅ {len(pbp):,} plays")
        except Exception as e:
            print(f"     ⚠️  {season}: {e}")

    if not eff_parts:
        print("   ⚠️  No play-by-play data imported")
        return

    pbp = pd.concat(eff_parts, ignore_index=True)

    # Standard success-rate definition: 40%+ of needed yards on 1st down, 60%+ on 2nd, 100%+ on 3rd/4th
    def _is_success(row):
        if pd.isna(row["down"]) or pd.isna(row["ydstogo"]) or row["ydstogo"] <= 0:
            return False
        needed = row["ydstogo"] * (0.4 if row["down"] == 1 else 0.6 if row["down"] == 2 else 1.0)
        return row["yards_gained"] >= needed

    # ── Rushing plays ──
    rush = pbp[(pbp["rush_attempt"] == 1) & pbp["rusher_player_id"].notna()].copy()
    rush["is_success"]  = rush.apply(_is_success, axis=1)
    rush["is_explosive"] = rush["yards_gained"] >= 15
    rush["is_goalline"]  = rush["yardline_100"] <= 5
    rush["is_redzone"]   = rush["yardline_100"] <= 20
    rush_agg = rush.groupby(["season", "week", "rusher_player_id"]).agg(
        player_name       = ("rusher_player_name", "first"),
        team              = ("posteam", "first"),
        rush_attempts     = ("rush_attempt", "sum"),
        rush_epa_total    = ("epa", "sum"),
        rush_success_ct   = ("is_success", "sum"),
        explosive_run_ct  = ("is_explosive", "sum"),
        goalline_carries  = ("is_goalline", "sum"),
        redzone_rushes    = ("is_redzone", "sum"),
    ).reset_index().rename(columns={"rusher_player_id": "player_id"})

    # ── Passing targets (receiver side) ──
    tgt = pbp[(pbp["pass_attempt"] == 1) & pbp["receiver_player_id"].notna()].copy()
    tgt["is_success"]   = tgt.apply(_is_success, axis=1)
    tgt["is_complete"]  = tgt["complete_pass"] == 1
    tgt["is_explosive"] = tgt["is_complete"] & (tgt["yards_gained"] >= 20)
    tgt["is_redzone"]   = tgt["yardline_100"] <= 20
    tgt_agg = tgt.groupby(["season", "week", "receiver_player_id"]).agg(
        player_name        = ("receiver_player_name", "first"),
        team                = ("posteam", "first"),
        targets             = ("pass_attempt", "sum"),
        receptions          = ("is_complete", "sum"),
        receiving_yards     = ("yards_gained", "sum"),
        tgt_epa_total       = ("epa", "sum"),
        tgt_success_ct      = ("is_success", "sum"),
        explosive_rec_ct    = ("is_explosive", "sum"),
        redzone_targets     = ("is_redzone", "sum"),
    ).reset_index().rename(columns={"receiver_player_id": "player_id"})

    # ── Merge rush + target sides per player-week ──
    merged = pd.merge(rush_agg, tgt_agg, on=["season", "week", "player_id"], how="outer", suffixes=("_rush", "_tgt"))
    merged["player_name"] = merged["player_name_rush"].fillna(merged["player_name_tgt"])
    merged["team"]        = merged["team_rush"].fillna(merged["team_tgt"])

    # Play-by-play names are abbreviated ("M.Nabers"), but every other table in this pipeline
    # (snap counts, weekly stats, roster) uses full display names ("Mike Nabers") — resolve via
    # player_headshots, which is keyed by the same gsis_id and stores nfl_data_py's full names.
    try:
        id_to_name = conn.execute(
            "SELECT gsis_id, player_name FROM player_headshots WHERE player_name IS NOT NULL"
        ).df().drop_duplicates("gsis_id").set_index("gsis_id")["player_name"].to_dict()
    except Exception:
        id_to_name = {}
    if id_to_name:
        resolved = merged["player_id"].map(id_to_name)
        merged["player_name"] = resolved.fillna(merged["player_name"])
    for c in ["rush_attempts", "rush_epa_total", "rush_success_ct", "explosive_run_ct", "goalline_carries", "redzone_rushes",
              "targets", "receptions", "receiving_yards", "tgt_epa_total", "tgt_success_ct", "explosive_rec_ct", "redzone_targets"]:
        merged[c] = merged[c].fillna(0)

    total_opps = merged["rush_attempts"] + merged["targets"]
    total_epa  = merged["rush_epa_total"] + merged["tgt_epa_total"]
    total_success = merged["rush_success_ct"] + merged["tgt_success_ct"]

    out = pd.DataFrame({
        "season":              merged["season"].astype(int),
        "week":                merged["week"].astype(int),
        "player_name":         merged["player_name"],
        "position":            None,  # joined/labeled downstream from player_headshots/roster data
        "team":                merged["team"],
        "rush_attempts":       merged["rush_attempts"].astype(int),
        "targets":             merged["targets"].astype(int),
        "epa_per_play":        (total_epa / total_opps.replace(0, float("nan"))),
        "epa_per_rush":        (merged["rush_epa_total"] / merged["rush_attempts"].replace(0, float("nan"))),
        "epa_per_target":      (merged["tgt_epa_total"] / merged["targets"].replace(0, float("nan"))),
        "epa_per_opportunity": (total_epa / total_opps.replace(0, float("nan"))),
        "success_rate":        (total_success / total_opps.replace(0, float("nan"))),
        "explosive_run_rate":  (merged["explosive_run_ct"] / merged["rush_attempts"].replace(0, float("nan"))),
        "explosive_rec_rate":  (merged["explosive_rec_ct"] / merged["receptions"].replace(0, float("nan"))),
        "yards_per_target":    (merged["receiving_yards"] / merged["targets"].replace(0, float("nan"))),
        "redzone_touches":     (merged["redzone_rushes"] + merged["redzone_targets"]).astype(int),
        "goalline_carries":    merged["goalline_carries"].astype(int),
    })
    out = out[out["player_name"].notna() & (total_opps >= 3)].copy()  # drop tiny/noisy samples

    # Elusiveness Score — composite proxy for "missed tackles forced" (no public source; PFF-only).
    # 0.35 YAC-rate-esque rush efficiency (epa_per_rush) + 0.25 explosive run rate + 0.20 success
    # rate + 0.20 EPA/rush again as a stand-in for YAC (nflverse YAC is receiving-only, tracked
    # separately in player_yac_stats — this composite uses what's available on the rushing side).
    # Normalized 0-1 within each season+week slate before blending so the components are comparable.
    def _norm(s):
        lo, hi = s.min(), s.max()
        span = (hi - lo) or 1
        return (s - lo) / span
    rushers = out[out["rush_attempts"] > 0].copy()
    if not rushers.empty:
        rushers["_epaN"]  = rushers.groupby(["season", "week"])["epa_per_rush"].transform(_norm)
        rushers["_expN"]  = rushers.groupby(["season", "week"])["explosive_run_rate"].transform(_norm)
        rushers["_sucN"]  = rushers.groupby(["season", "week"])["success_rate"].transform(_norm)
        rushers["elusiveness_score"] = (
            0.35 * rushers["_epaN"] + 0.25 * rushers["_expN"] + 0.20 * rushers["_sucN"] + 0.20 * rushers["_epaN"]
        ) * 100
        out = out.merge(
            rushers[["season", "week", "player_name", "team", "elusiveness_score"]],
            on=["season", "week", "player_name", "team"], how="left",
        )
    else:
        out["elusiveness_score"] = None

    out["imported_at"] = datetime.now(timezone.utc).replace(tzinfo=None)
    out = out.round({
        "epa_per_play": 3, "epa_per_rush": 3, "epa_per_target": 3, "epa_per_opportunity": 3,
        "success_rate": 3, "explosive_run_rate": 3, "explosive_rec_rate": 3, "elusiveness_score": 1,
        "yards_per_target": 2,
    })

    print(f"   ✅ {len(out):,} player-week efficiency records")
    if dry_run:
        return

    for season in out["season"].unique().tolist():
        conn.execute("DELETE FROM player_efficiency_stats WHERE season = ?", [int(season)])
    conn.register("_eff", out)
    conn.execute("INSERT INTO player_efficiency_stats BY NAME SELECT * FROM _eff")
    print(f"   💾 player_efficiency_stats: {len(out):,} rows")


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

    for season in ngs_clean["season"].unique().tolist():
        conn.execute("DELETE FROM player_nextgen_stats WHERE season = ?", [int(season)])
    conn.register("_ngs", ngs_clean)
    conn.execute("INSERT INTO player_nextgen_stats SELECT * FROM _ngs")
    print(f"   💾 player_nextgen_stats: {len(ngs_clean):,} rows")


# ── Depth Charts ──────────────────────────────────────────────────────────────

def import_depth_charts(conn, seasons: list[int], dry_run: bool):
    print("\n📋 Section 4: Depth Charts")
    # nflverse's depth chart schema changed entirely (old columns: season/week/game_type/
    # position/depth_team/formation are gone). New shape: dt (snapshot timestamp), team,
    # player_name, pos_grp (personnel package — offense is "3WR 1TE"), pos_abb, pos_rank,
    # pos_slot, gsis_id, espn_id. Multiple dt snapshots exist per season with no reliable
    # week mapping, so we keep only the latest snapshot per (season, team) as the current
    # depth chart rather than attempting per-week history.
    depth_parts = []
    for season in seasons:
        print(f"   {season}: downloading depth charts…")
        try:
            depth = nfl.import_depth_charts(years=[season])
            off = depth[(depth["pos_grp"] == "3WR 1TE") & (depth["pos_abb"].isin(OFFENSE_POS_ABB))].copy()
            off["season"] = season
            print(f"     ✅ {len(off):,} records")
            depth_parts.append(off)
        except Exception as e:
            print(f"     ⚠️  {season}: {e}")

    if not depth_parts:
        print("   ⚠️  No depth chart data imported")
        return

    depth_df = pd.concat(depth_parts, ignore_index=True)
    depth_df["dt"] = pd.to_datetime(depth_df["dt"])
    latest = depth_df.groupby(["season", "team"])["dt"].transform("max")
    current = depth_df[depth_df["dt"] == latest].drop_duplicates(
        subset=["season", "team", "pos_abb", "pos_rank"], keep="first"
    )
    want_cols = ["season", "team", "pos_abb", "pos_rank", "pos_slot",
                 "player_name", "gsis_id", "espn_id", "dt"]
    have_cols = [c for c in want_cols if c in current.columns]
    if len(have_cols) < len(want_cols):
        missing = set(want_cols) - set(have_cols)
        print(f"   ⚠️  Depth chart columns missing (skipping): {missing}")
    depth_clean = current[have_cols].copy()
    depth_clean["imported_at"] = datetime.now(timezone.utc).replace(tzinfo=None)

    print(f"   ✅ {len(depth_clean):,} depth chart records")
    if dry_run:
        return

    conn.execute("DELETE FROM depth_charts")
    conn.register("_depth", depth_clean)
    conn.execute("INSERT INTO depth_charts BY NAME SELECT * FROM _depth")
    print(f"   💾 depth_charts: {len(depth_clean):,} rows")


# ── O-Line roster bio (for O-Line Stability Index) ────────────────────────────

def import_roster_bio(conn, seasons: list[int], dry_run: bool):
    print("\n🧾 Section: O-Line Roster Bio")
    parts = []
    for season in seasons:
        print(f"   {season}: downloading seasonal rosters…", end=" ", flush=True)
        try:
            ros = nfl.import_seasonal_rosters([season])
            sub = ros[ros["position"] == "OL"].copy()
            sub["season"] = season
            parts.append(sub)
            print(f"{len(sub):,} OL records")
        except Exception as e:
            print(f"FAILED — {e}")

    if not parts:
        print("   ⚠️  No roster bio data imported")
        return

    df = pd.concat(parts, ignore_index=True)
    df = df.rename(columns={"player_id": "gsis_id"})
    # A player can have multiple roster rows per season (team changes, weekly
    # updates) — keep one row per (season, gsis_id), preferring the latest week.
    if "week" in df.columns:
        df = df.sort_values("week").drop_duplicates(subset=["season", "gsis_id"], keep="last")
    else:
        df = df.drop_duplicates(subset=["season", "gsis_id"], keep="last")
    want_cols = ["season", "gsis_id", "player_name", "position", "team", "height",
                 "weight", "age", "years_exp", "college", "draft_number",
                 "entry_year", "rookie_year"]
    have_cols = [c for c in want_cols if c in df.columns]
    clean = df[have_cols].copy()
    clean["imported_at"] = datetime.now(timezone.utc).replace(tzinfo=None)

    print(f"   ✅ {len(clean):,} O-line bio records")
    if dry_run:
        return

    for season in clean["season"].unique().tolist():
        conn.execute("DELETE FROM player_roster_bio WHERE season = ?", [int(season)])
    conn.register("_bio", clean)
    conn.execute("INSERT INTO player_roster_bio BY NAME SELECT * FROM _bio")
    print(f"   💾 player_roster_bio: {len(clean):,} rows")


# ── O-Line penalties (for O-Line Stability Index) ─────────────────────────────

def import_penalties(conn, seasons: list[int], dry_run: bool):
    print("\n🚩 Section: O-Line Penalties (holding / false start)")
    parts = []
    for season in seasons:
        print(f"   {season}: downloading play-by-play…", end=" ", flush=True)
        try:
            pbp = nfl.import_pbp_data([season], columns=[
                "game_id", "play_id", "season", "week", "posteam",
                "penalty", "penalty_team", "penalty_type",
                "penalty_player_id", "penalty_player_name", "penalty_yards",
            ])
            pens = pbp[
                (pbp["penalty"] == 1)
                & (pbp["penalty_type"].isin(["Offensive Holding", "False Start"]))
                & pbp["penalty_player_id"].notna()
            ].copy()
            parts.append(pens)
            print(f"{len(pens):,} O-line penalties")
        except Exception as e:
            print(f"FAILED — {e}")

    if not parts:
        print("   ⚠️  No penalty data imported")
        return

    df = pd.concat(parts, ignore_index=True)
    clean = df.rename(columns={
        "penalty_team": "team",
        "penalty_player_id": "gsis_id",
        "penalty_player_name": "player_name",
    })[[
        "game_id", "play_id", "season", "week", "team", "gsis_id",
        "player_name", "penalty_type", "penalty_yards",
    ]].copy()
    clean["imported_at"] = datetime.now(timezone.utc).replace(tzinfo=None)

    print(f"   ✅ {len(clean):,} O-line penalty records")
    if dry_run:
        return

    for season in clean["season"].unique().tolist():
        conn.execute("DELETE FROM player_penalties WHERE season = ?", [int(season)])
    conn.register("_pens", clean)
    conn.execute("INSERT INTO player_penalties BY NAME SELECT * FROM _pens")
    print(f"   💾 player_penalties: {len(clean):,} rows")


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
    parser.add_argument("--section",  choices=["headshots", "yac", "ngs", "depth", "stats", "snaps", "efficiency", "bio", "penalties", "all"],
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
    if run_all or args.section == "snaps":       import_snap_counts(conn, seasons, args.dry_run)
    if run_all or args.section == "efficiency":  import_efficiency_stats(conn, seasons, args.dry_run)
    if run_all or args.section == "bio":         import_roster_bio(conn, seasons, args.dry_run)
    if run_all or args.section == "penalties":   import_penalties(conn, seasons, args.dry_run)

    conn.close()
    print("\n✅ nflverse import complete")


if __name__ == "__main__":
    main()
