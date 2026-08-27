"""
FantasAI Offensive Line Index — proprietary O-line quality score
Derived entirely from free nflverse play-by-play (no PFF/ESPN subscription exists
in this pipeline — see notebooks/02_Analysis_Metrics/21_data_source_comparison_analysis
for the "PFF — not ingested" gap this replaces).

Rather than importing someone else's static rank, this computes two explainable
sub-scores per team per season plus an overall blend:

  Pass Block Score = 35% sack rate (inv) + 25% pressure rate proxy — QB hit rate (inv)
                    + 20% EPA/dropback + 20% pass success rate
  Run Block Score  = 30% rush success rate + 25% EPA/rush + 20% stuff rate (inv)
                    + 15% explosive run rate + 10% short-yardage success rate
  Overall          = 50% Pass Block + 50% Run Block

Each raw metric is percentile-ranked 0-100 within its season across all 32 teams
before blending, so the weights above are comparable regardless of raw units.
True pressure rate and yards-before-contact aren't in free play-by-play — QB hit
rate stands in for pressure rate, and yards-before-contact is dropped from the
run-block formula (weight redistributed to success rate / EPA).

Also builds player_team_seasons — which team a player suited up for each season
(and how many games, for players traded mid-season) — sourced from the
silver_weekly_stats table (nflverse for historical seasons, sleeper for the
current in-progress season — nflverse PBP isn't published until a season wraps),
so the frontend can show "this RB moved from a bad O-line to a good one" context
on the player popup.

Outputs (DuckDB): team_oline_index, player_team_seasons
Outputs (R2):
  fantasai/analysis/oline_index.json          — { teams: { TEAM: { season: {...} } } }
  fantasai/analysis/player_team_history.json  — { players: [ { player_name, seasons: {...} } ] }

Usage:
  python ingest_oline_index.py                   # DEFAULT_SEASONS
  python ingest_oline_index.py --seasons 2023,2024,2025
  python ingest_oline_index.py --dry-run
  python ingest_oline_index.py --export-only      # skip PBP fetch, re-export from DB
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
import ssl_utils  # noqa: F401 — injects Windows cert store
from db import get_conn, init_schema

try:
    import nfl_data_py as nfl
except ImportError:
    print("ERROR: nfl_data_py not installed. Run: pip install nfl_data_py")
    sys.exit(1)

try:
    from dotenv import load_dotenv
    load_dotenv(Path(__file__).parent.parent.parent / ".env")
except ImportError:
    pass

R2_BASE      = "https://api.fantasai.net/api/v1/r2"
FANTASAI_KEY = os.environ.get("FANTASAI_KEY", "")
HEADERS_R2   = {"X-FantasAI-Key": FANTASAI_KEY, "Content-Type": "application/json"}

DEFAULT_SEASONS = [2021, 2022, 2023, 2024, 2025]

PBP_COLS = [
    "season", "week", "posteam", "defteam", "play_type", "down", "ydstogo", "yards_gained",
    "epa", "sack", "qb_hit", "rush_attempt", "pass_attempt", "qb_dropback",
    "rusher_player_id", "rusher_player_name",
    "receiver_player_id", "receiver_player_name",
    "passer_player_id", "passer_player_name",
]


# ── Fetch ─────────────────────────────────────────────────────────────────────

def fetch_pbp(seasons: list[int]) -> pd.DataFrame:
    parts = []
    for season in seasons:
        print(f"   {season}: downloading play-by-play…", end=" ", flush=True)
        try:
            pbp = nfl.import_pbp_data([season], columns=PBP_COLS)
            parts.append(pbp)
            print(f"{len(pbp):,} plays")
        except Exception as e:
            print(f"FAILED — {e}")
        time.sleep(0.5)
    if not parts:
        return pd.DataFrame()
    return pd.concat(parts, ignore_index=True)


# ── O-Line Index computation ───────────────────────────────────────────────────

def _is_success(row):
    """Standard success-rate definition: 40%+ of needed yards on 1st down, 60%+ on 2nd, 100%+ on 3rd/4th."""
    if pd.isna(row["down"]) or pd.isna(row["ydstogo"]) or row["ydstogo"] <= 0:
        return False
    needed = row["ydstogo"] * (0.4 if row["down"] == 1 else 0.6 if row["down"] == 2 else 1.0)
    return row["yards_gained"] >= needed


def _pctile_score(s: pd.Series, higher_is_better: bool = True) -> pd.Series:
    """Percentile-rank a metric to 0-100 within its group (season)."""
    pct = s.rank(pct=True)
    if not higher_is_better:
        pct = 1 - pct
    return pct * 100


def build_oline_index(pbp: pd.DataFrame) -> pd.DataFrame:
    pbp = pbp[pbp["posteam"].notna() & (pbp["posteam"] != "")].copy()

    # ── Pass protection: every dropback (attempts, sacks, scrambles) ──
    drop = pbp[pbp["qb_dropback"] == 1].copy()
    drop["is_success"] = drop.apply(_is_success, axis=1)
    pass_agg = drop.groupby(["season", "posteam"]).agg(
        dropbacks       = ("qb_dropback", "sum"),
        sacks           = ("sack", "sum"),
        qb_hits         = ("qb_hit", "sum"),
        pass_epa_total  = ("epa", "sum"),
        pass_success_ct = ("is_success", "sum"),
    ).reset_index().rename(columns={"posteam": "team"})
    pass_agg["sack_rate"         ] = pass_agg["sacks"]        / pass_agg["dropbacks"]
    pass_agg["pressure_rate"     ] = pass_agg["qb_hits"]      / pass_agg["dropbacks"]
    pass_agg["pass_epa_per_play" ] = pass_agg["pass_epa_total"]  / pass_agg["dropbacks"]
    pass_agg["pass_success_rate" ] = pass_agg["pass_success_ct"] / pass_agg["dropbacks"]

    # ── Run blocking ──
    rush = pbp[pbp["rush_attempt"] == 1].copy()
    rush["is_success"]   = rush.apply(_is_success, axis=1)
    rush["is_stuffed"]   = rush["yards_gained"] <= 0
    rush["is_explosive"] = rush["yards_gained"] >= 15
    rush["is_shortyd"]   = rush["ydstogo"] <= 2
    rush_agg = rush.groupby(["season", "posteam"]).agg(
        rush_plays      = ("rush_attempt", "sum"),
        rush_epa_total  = ("epa", "sum"),
        rush_success_ct = ("is_success", "sum"),
        stuffed_ct      = ("is_stuffed", "sum"),
        explosive_ct    = ("is_explosive", "sum"),
    ).reset_index().rename(columns={"posteam": "team"})
    rush_agg["rush_epa_per_play"]  = rush_agg["rush_epa_total"] / rush_agg["rush_plays"]
    rush_agg["rush_success_rate"] = rush_agg["rush_success_ct"] / rush_agg["rush_plays"]
    rush_agg["stuff_rate"]        = rush_agg["stuffed_ct"]      / rush_agg["rush_plays"]
    rush_agg["explosive_run_rate"] = rush_agg["explosive_ct"]   / rush_agg["rush_plays"]

    short = rush[rush["is_shortyd"]].groupby(["season", "posteam"]).agg(
        shortyd_plays   = ("is_shortyd", "sum"),
        shortyd_success = ("is_success", "sum"),
    ).reset_index().rename(columns={"posteam": "team"})
    rush_agg = rush_agg.merge(short, on=["season", "team"], how="left")
    rush_agg["short_yardage_success_rate"] = (
        rush_agg["shortyd_success"] / rush_agg["shortyd_plays"]
    ).where(rush_agg["shortyd_plays"] > 0)
    # Too few short-yardage runs to be meaningful — fall back to overall rush success rate
    rush_agg["short_yardage_success_rate"] = rush_agg["short_yardage_success_rate"].fillna(
        rush_agg["rush_success_rate"]
    )

    out = pd.merge(
        pass_agg[["season", "team", "dropbacks", "sack_rate", "pressure_rate", "pass_epa_per_play", "pass_success_rate"]],
        rush_agg[["season", "team", "rush_plays", "stuff_rate", "explosive_run_rate", "rush_epa_per_play",
                  "rush_success_rate", "short_yardage_success_rate"]],
        on=["season", "team"], how="inner",
    )
    # Drop tiny/partial samples (relocations, strike-shortened weeks, bad joins)
    out = out[(out["dropbacks"] >= 100) & (out["rush_plays"] >= 50)].copy()

    parts = []
    for _season, grp in out.groupby("season"):
        grp = grp.copy()
        grp["pass_block_score"] = (
            0.35 * _pctile_score(grp["sack_rate"],          higher_is_better=False) +
            0.25 * _pctile_score(grp["pressure_rate"],      higher_is_better=False) +
            0.20 * _pctile_score(grp["pass_epa_per_play"],  higher_is_better=True)  +
            0.20 * _pctile_score(grp["pass_success_rate"],  higher_is_better=True)
        )
        grp["run_block_score"] = (
            0.30 * _pctile_score(grp["rush_success_rate"],         higher_is_better=True)  +
            0.25 * _pctile_score(grp["rush_epa_per_play"],          higher_is_better=True)  +
            0.20 * _pctile_score(grp["stuff_rate"],                 higher_is_better=False) +
            0.15 * _pctile_score(grp["explosive_run_rate"],         higher_is_better=True)  +
            0.10 * _pctile_score(grp["short_yardage_success_rate"], higher_is_better=True)
        )
        grp["overall_score"]    = 0.5 * grp["pass_block_score"] + 0.5 * grp["run_block_score"]
        grp["pass_block_rank"]  = grp["pass_block_score"].rank(ascending=False, method="min").astype(int)
        grp["run_block_rank"]   = grp["run_block_score"].rank(ascending=False, method="min").astype(int)
        grp["overall_rank"]     = grp["overall_score"].rank(ascending=False, method="min").astype(int)
        parts.append(grp)

    result = pd.concat(parts, ignore_index=True)
    result = result.round({
        "sack_rate": 4, "pressure_rate": 4, "pass_epa_per_play": 3, "pass_success_rate": 3,
        "stuff_rate": 4, "explosive_run_rate": 4, "rush_epa_per_play": 3, "rush_success_rate": 3,
        "short_yardage_success_rate": 3,
        "pass_block_score": 1, "run_block_score": 1, "overall_score": 1,
    })
    result["dropbacks"]  = result["dropbacks"].astype(int)
    result["rush_plays"] = result["rush_plays"].astype(int)
    result["imported_at"] = datetime.now(timezone.utc).replace(tzinfo=None)
    return result


def write_oline_index(conn, df: pd.DataFrame, dry_run: bool):
    if df.empty:
        print("   No O-line index rows to write"); return
    if dry_run:
        print(f"   DRY RUN — would write {len(df)} team-season rows"); return
    for season in df["season"].unique().tolist():
        conn.execute("DELETE FROM team_oline_index WHERE season = ?", [int(season)])
    conn.register("_oline", df)
    conn.execute("INSERT INTO team_oline_index BY NAME SELECT * FROM _oline")
    print(f"   💾 team_oline_index: {len(df):,} rows written")


# ── Player → team-per-season (handles in-season trades) ───────────────────────

def load_gsis_name_map() -> dict:
    """pbp's own player-name fields are abbreviated ("D.Montgomery"), not the
    app's full-name convention ("David Montgomery") — same crosswalk pattern
    as ingest_coverage_matchups.py / ingest_rush_box_splits.py."""
    import nfl_data_py as nfl
    players = nfl.import_players()
    return dict(zip(players["gsis_id"], players["display_name"]))


def build_player_team_seasons(pbp: pd.DataFrame, gsis_name_map: dict) -> pd.DataFrame:
    """Built directly from play-by-play (posteam per play), not
    silver_weekly_stats. Sleeper's /stats/nfl/regular/{season}/{week} response
    has no per-week team field at all (confirmed live 2026-08-27) —
    ingest_sleeper_stats.py falls back to the player's CURRENT roster team
    from Sleeper's player database for every row it writes, silently
    rewriting every past week to a player's new team the moment they're
    traded. Real case: David Montgomery's entire 2025 season (17/17 games,
    confirmed via nflverse play-by-play) was mislabeled HOU — his 2026 team —
    instead of DET. Play-by-play's posteam is genuinely per-play/historical
    and has no such issue, and (confirmed live) silver_weekly_stats has zero
    nflverse-sourced rows for the entire 2025 season to fall back on anyway.
    """
    roles = [
        ("rusher_player_id", "rusher_player_name"),
        ("receiver_player_id", "receiver_player_name"),
        ("passer_player_id", "passer_player_name"),
    ]
    frames = []
    for id_col, name_col in roles:
        sub = pbp[pbp[id_col].notna()][[id_col, name_col, "season", "week", "posteam"]].copy()
        sub.columns = ["gsis_id", "raw_name", "season", "week", "team"]
        frames.append(sub)
    combined = pd.concat(frames, ignore_index=True)
    combined = combined[combined["team"].notna() & (combined["team"] != "")]
    combined["player_name"] = combined["gsis_id"].map(gsis_name_map).fillna(combined["raw_name"])

    df = (
        combined.groupby(["player_name", "season", "team"])["week"]
        .nunique()
        .reset_index(name="games")
    )
    df = df[df["player_name"].notna() & (df["player_name"] != "")]
    df["games"] = df["games"].astype(int)
    df = df.sort_values(["player_name", "season", "games"], ascending=[True, True, False])
    # First row per (player_name, season) after sorting by games desc = the team they played most for
    df["is_primary"] = ~df.duplicated(subset=["player_name", "season"], keep="first")
    df["imported_at"] = datetime.now(timezone.utc).replace(tzinfo=None)
    return df


def write_player_team_seasons(conn, df: pd.DataFrame, dry_run: bool):
    if df.empty:
        print("   No player-team-season rows to write"); return
    if dry_run:
        print(f"   DRY RUN — would write {len(df)} player-team-season rows"); return
    conn.execute("DELETE FROM player_team_seasons")
    conn.register("_pts", df)
    conn.execute("INSERT INTO player_team_seasons BY NAME SELECT * FROM _pts")
    print(f"   💾 player_team_seasons: {len(df):,} rows written")


# ── R2 export ─────────────────────────────────────────────────────────────────

def _put_r2(key: str, payload: dict, dry_run: bool):
    body = json.dumps(payload, default=str)
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


def export_oline_r2(conn, dry_run: bool):
    rows = conn.execute("SELECT * FROM team_oline_index ORDER BY season, team").df()
    if rows.empty:
        print("   No O-line index rows in DB — skipping export"); return

    teams: dict = {}
    for _, r in rows.iterrows():
        season_key = str(int(r["season"]))
        teams.setdefault(r["team"], {})[season_key] = {
            "dropbacks":                  int(r["dropbacks"]),
            "rush_plays":                 int(r["rush_plays"]),
            "sack_rate":                  r["sack_rate"],
            "pressure_rate":              r["pressure_rate"],
            "pass_epa_per_play":          r["pass_epa_per_play"],
            "pass_success_rate":          r["pass_success_rate"],
            "stuff_rate":                 r["stuff_rate"],
            "explosive_run_rate":         r["explosive_run_rate"],
            "rush_epa_per_play":          r["rush_epa_per_play"],
            "rush_success_rate":          r["rush_success_rate"],
            "short_yardage_success_rate": r["short_yardage_success_rate"],
            "pass_block_score":           r["pass_block_score"],
            "run_block_score":            r["run_block_score"],
            "overall_score":              r["overall_score"],
            "pass_block_rank":            int(r["pass_block_rank"]),
            "run_block_rank":             int(r["run_block_rank"]),
            "overall_rank":               int(r["overall_rank"]),
        }

    payload = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "seasons": sorted({str(int(s)) for s in rows["season"].unique()}),
        "methodology": (
            "FantasAI Offensive Line Index — composite score built from free nflverse play-by-play "
            "(no paid PFF/ESPN data used). Pass Block = 35% sack rate (inv) + 25% pressure rate "
            "proxy via QB hit rate (inv) + 20% EPA/dropback + 20% pass success rate. Run Block = "
            "30% rush success rate + 25% EPA/rush + 20% stuff rate (inv) + 15% explosive run rate "
            "+ 10% short-yardage success rate. Each component is percentile-ranked 0-100 within its "
            "season across all 32 teams before blending. Overall = 50% Pass Block + 50% Run Block. "
            "Rank 1 = best O-line that season."
        ),
        "teams": teams,
    }
    _put_r2("fantasai/analysis/oline_index.json", payload, dry_run)


def export_player_team_history_r2(conn, dry_run: bool):
    rows = conn.execute(
        "SELECT * FROM player_team_seasons ORDER BY player_name, season, games DESC"
    ).df()
    if rows.empty:
        print("   No player-team-season rows in DB — skipping export"); return

    players: dict = {}
    for _, r in rows.iterrows():
        entry = players.setdefault(r["player_name"], {})
        season_key = str(int(r["season"]))
        rec = entry.setdefault(season_key, {"team": None, "games": 0, "all_teams": []})
        rec["all_teams"].append({"team": r["team"], "games": int(r["games"])})
        if bool(r["is_primary"]):
            rec["team"]  = r["team"]
            rec["games"] = int(r["games"])

    payload = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "players": [{"player_name": name, "seasons": seasons} for name, seasons in players.items()],
    }
    _put_r2("fantasai/analysis/player_team_history.json", payload, dry_run)


# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--seasons", type=str, default=None,
                        help="Comma-separated years, e.g. 2023,2024,2025")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--export-only", action="store_true",
                        help="Skip PBP fetch; rebuild team history + re-export from existing DB data")
    args = parser.parse_args()

    seasons = [int(y) for y in args.seasons.split(",")] if args.seasons else DEFAULT_SEASONS

    print("=" * 70)
    print("FantasAI Offensive Line Index — nflverse play-by-play")
    print(f"Timestamp: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print(f"Seasons:   {seasons}")
    print(f"Mode:      {'DRY RUN' if args.dry_run else 'LIVE'}")
    print("=" * 70)

    conn = get_conn()
    init_schema(conn)

    if not args.export_only:
        print("\n── Downloading play-by-play ────────────────────────────────────────")
        pbp = fetch_pbp(seasons)
        if pbp.empty:
            print("   ⚠️  No play-by-play data imported — aborting")
            conn.close()
            sys.exit(1)

        print("\n── Computing O-Line Index ──────────────────────────────────────────")
        oline_df = build_oline_index(pbp)
        write_oline_index(conn, oline_df, args.dry_run)

        print("\n── Building player-team-season history ─────────────────────────────")
        gsis_name_map = load_gsis_name_map()
        print(f"   Loaded {len(gsis_name_map):,} gsis_id → name mappings")
        pts_df = build_player_team_seasons(pbp, gsis_name_map)
        write_player_team_seasons(conn, pts_df, args.dry_run)

    print("\n── Exporting to R2 ─────────────────────────────────────────────────")
    export_oline_r2(conn, args.dry_run)
    export_player_team_history_r2(conn, args.dry_run)

    conn.close()
    print("\n✅ Offensive Line Index complete")


if __name__ == "__main__":
    main()
