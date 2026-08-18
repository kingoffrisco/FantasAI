"""
FantasAI O-Line Stability Index (OLSI) — continuity, chemistry, no fabricated grades
Built entirely from real, verifiable counting stats (per the user's own explicit
design): who started together and for how long, how many snaps they shared, how
healthy/experienced the group is, and how many holding/false-start penalties they
committed — all real, referee-recorded or roster data, never an invented grade.

Reads: depth_chart_history, player_roster_bio, player_penalties, player_snap_counts,
       team_oline_index, bronze_nfl_schedules (all already ingested).
No new external fetch — pure composite scoring on top of real data, same philosophy
as ingest_oline_index.py and ingest_offensive_ecosystem.py.

Continuity / Chemistry (exact definitions — "same five" means same five PLAYERS,
not same exact slot assignment; a team sliding its RG to RT for two games with a
new backup at RG is still "the same five people," which is the real signal, and
snap-count data has no left/right slot granularity anyway):
  - Weekly starting five = the 5 pos_rank=1 gsis_ids in depth_chart_history that
    week (only counted when all 5 slots resolve).
  - Primary starters = the most common weekly five across the season (ties broken
    lexicographically by sorted gsis_id tuple — deliberately simple; true tie-break
    by total snaps would create a circular dependency on the shared-snaps figure
    this same step feeds, and ties are rare).
  - Games Started Together = weeks matching the primary five exactly.
  - Shared Snaps = sum, over those matching weeks, of MIN(offense_snaps) across
    the 5 (a starter who left with an injury in the 1st quarter contributes their
    real low snap count, not a full game credit).
  - Chemistry Score (raw ratios, NOT percentile-ranked — meant to read as "% of
    achievable," not "top X% of the league"): 40% returning-starters-from-last-
    season + 30% games-together-rate + 30% shared-snap-rate.

OLSI (all six percentile-ranked 0-100 within season across 32 teams, reusing the
_pctile_score approach from ingest_oline_index.py):
  30% Continuity + 20% Health (fewer games missed by the primary five) +
  15% Experience (avg years_exp of the primary five) + 15% Penalty rate (whole
  O-line room, inverse) + 10% team sack rate (reused from team_oline_index,
  inverse) + 10% team rushing efficiency (reused from team_oline_index).

Outputs (DuckDB): team_oline_stability, player_oline_stability
Outputs (R2):
  fantasai/analysis/oline_stability.json         — { teams: { TEAM: { season: {...} } } }
  fantasai/analysis/player_oline_stability.json  — { players: [ {...} ] }

Usage:
  python ingest_oline_stability.py                   # DEFAULT_SEASONS
  python ingest_oline_stability.py --seasons 2024,2025
  python ingest_oline_stability.py --dry-run
  python ingest_oline_stability.py --export-only      # skip compute, re-export from DB
"""

import argparse
import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

import pandas as pd
import requests

sys.path.insert(0, str(Path(__file__).parent.parent))
import ssl_utils  # noqa: F401 — injects Windows cert store
from db import get_conn, init_schema

try:
    from dotenv import load_dotenv
    load_dotenv(Path(__file__).parent.parent.parent / ".env")
except ImportError:
    pass

R2_BASE      = "https://api.fantasai.net/api/v1/r2"
FANTASAI_KEY = os.environ.get("FANTASAI_KEY", "")
HEADERS_R2   = {"X-FantasAI-Key": FANTASAI_KEY, "Content-Type": "application/json"}

DEFAULT_SEASONS = [2021, 2022, 2023, 2024, 2025]
OL_SLOTS = ["LT", "LG", "C", "RG", "RT"]

TIER_CUTS = [(85, "Elite"), (70, "Good"), (50, "Average"), (30, "Below Average"), (0, "Poor")]


def name_key(name: str) -> str:
    """Normalize a player_name for joining against player_snap_counts, which has
    no gsis_id. nflverse's different feeds don't always agree on generational
    suffixes (confirmed real case: depth charts' "Jon Gaines II" vs snap counts'
    "Jon Gaines") — strip Jr/Sr/II/III/IV so the two feeds actually match."""
    import re
    s = (name or "").lower().strip()
    return re.sub(r"\s+(jr|sr|ii|iii|iv|v)\.?$", "", s).strip()


def score_to_tier(score):
    if score is None or pd.isna(score):
        return None
    for cut, label in TIER_CUTS:
        if score >= cut:
            return label
    return "Poor"


def _pctile_score(s: pd.Series, higher_is_better: bool = True) -> pd.Series:
    """Percentile-rank a metric to 0-100 within its group (season)."""
    pct = s.rank(pct=True)
    if not higher_is_better:
        pct = 1 - pct
    return pct * 100


# ── Weekly starting fives + primary starters ──────────────────────────────────

def build_starter_weeks(conn, seasons: list[int]) -> pd.DataFrame:
    season_list = ",".join(str(s) for s in seasons)
    df = conn.execute(f"""
        SELECT season, week, team, pos_abb, gsis_id, player_name
        FROM depth_chart_history
        WHERE season IN ({season_list}) AND pos_rank = 1
    """).df()
    return df.dropna(subset=["gsis_id"])


def build_weekly_sets(starter_weeks: pd.DataFrame) -> pd.DataFrame:
    """One row per (season, team, week) with a frozenset of 5 gsis_ids — only
    when all 5 O-line slots resolve that week."""
    def _to_set(g):
        ids = frozenset(g["gsis_id"])
        return ids if len(ids) == 5 else None

    grouped = starter_weeks.groupby(["season", "team", "week"]).apply(_to_set).reset_index(name="starter_set")
    return grouped[grouped["starter_set"].notna()]


def compute_primary_starters(weekly_sets: pd.DataFrame) -> pd.DataFrame:
    """Mode starting-five per (season, team). Tie-break: lexicographically
    smallest sorted gsis_id tuple (simple and deterministic — see module docstring)."""
    rows = []
    for (season, team), grp in weekly_sets.groupby(["season", "team"]):
        counts = grp["starter_set"].value_counts()
        if counts.empty:
            continue
        top_count = counts.max()
        candidates = [s for s in counts.index if counts[s] == top_count]
        primary = min(candidates, key=lambda s: tuple(sorted(s)))
        rows.append({"season": season, "team": team, "primary_set": primary})
    return pd.DataFrame(rows)


# ── Snap lookup (name+team+week join — snap_counts has no gsis_id) ────────────

def build_snap_lookup(conn, seasons: list[int]) -> pd.DataFrame:
    season_list = ",".join(str(s) for s in seasons)
    df = conn.execute(f"""
        SELECT season, week, team, player_name, offense_snaps
        FROM player_snap_counts
        WHERE season IN ({season_list})
    """).df()
    df["name_key"] = df["player_name"].apply(name_key)
    return df.groupby(["season", "week", "team", "name_key"], as_index=False)["offense_snaps"].sum()


# ── Continuity ──────────────────────────────────────────────────────────────

def build_continuity(conn, seasons, weekly_sets, primary_df, starter_weeks, snap_lookup) -> pd.DataFrame:
    season_list = ",".join(str(s) for s in seasons)
    sched = conn.execute(f"""
        SELECT team, season, COUNT(DISTINCT week) AS team_games_played FROM (
            SELECT home_team AS team, season, week FROM bronze_nfl_schedules
            WHERE season IN ({season_list}) AND game_type = 'REG'
            UNION ALL
            SELECT away_team AS team, season, week FROM bronze_nfl_schedules
            WHERE season IN ({season_list}) AND game_type = 'REG'
        ) GROUP BY team, season
    """).df()

    plays = conn.execute(f"""
        SELECT season, team, dropbacks + rush_plays AS team_offensive_plays
        FROM team_oline_index WHERE season IN ({season_list})
    """).df()

    # gsis_id -> player_name (latest wins) for joining primary-starter names to snap_lookup
    name_map = (
        starter_weeks.sort_values("week")
        .drop_duplicates(subset=["season", "team", "gsis_id"], keep="last")
        [["season", "team", "gsis_id", "player_name"]]
    )

    rows = []
    merged = weekly_sets.merge(primary_df, on=["season", "team"], how="inner")
    for (season, team), grp in merged.groupby(["season", "team"]):
        primary_set = grp["primary_set"].iloc[0]
        matching_weeks = grp[grp["starter_set"] == primary_set]["week"].tolist()
        games_started_together = len(matching_weeks)

        names = name_map[
            (name_map["season"] == season) & (name_map["team"] == team)
            & (name_map["gsis_id"].isin(primary_set))
        ]["player_name"].apply(name_key).tolist()

        # nflverse's free snap-count feed has real completeness gaps — both whole-
        # season (confirmed: ARI's Valentin Senn, CIN's Cordell Volson never
        # appear at all) and scattered mid-season weeks for otherwise-tracked
        # players (confirmed: SF's Spencer Burford/Ben Bartch miss several
        # weeks each with no explicit 0 row, just no row). A missing row isn't
        # a confirmed 0 — we don't actually know they played zero snaps, we
        # just don't have the data — so assuming 0 would be a fabrication, not
        # a conservative estimate. Each week's MIN is taken over whichever of
        # the 5 primary starters have a recorded row that week, but only when
        # at least 4 of 5 do — a MIN over 1-2 present players isn't a
        # meaningful "shared snaps" figure for a five-man unit, so those weeks
        # are skipped (not scored as 0) rather than credited on thin data. This
        # ends up 0 for many teams in practice (nflverse's free snap-count feed
        # has real, uneven per-player weekly coverage — confirmed across
        # several teams, not an isolated case) — shared_snaps is kept as an
        # honest supplementary number for the UI, but continuity_score/OLSI
        # below is driven by games_started_together instead (see below), which
        # comes straight from depth_chart_history and has no such gaps.
        shared_snaps = 0
        for wk in matching_weeks:
            wk_snaps = snap_lookup[
                (snap_lookup["season"] == season) & (snap_lookup["team"] == team)
                & (snap_lookup["week"] == wk) & (snap_lookup["name_key"].isin(names))
            ]
            if len(wk_snaps) < 4:
                continue
            shared_snaps += wk_snaps["offense_snaps"].min()

        rows.append({
            "season": season, "team": team,
            "games_started_together": games_started_together,
            "shared_snaps": int(shared_snaps),
        })

    result = pd.DataFrame(rows)
    result = result.merge(sched, on=["season", "team"], how="left")
    result = result.merge(plays, on=["season", "team"], how="left")
    # Primary continuity signal: games started together as a share of the
    # season, from depth_chart_history (complete, reliable). shared_snaps/
    # team_offensive_plays would be the more precise "how much of the actual
    # offense was run with this exact five" version, but nflverse's free
    # snap-count feed isn't complete enough per-player to trust as the driver
    # of a scored metric — see comment above.
    result["continuity_pct"] = (result["games_started_together"] / result["team_games_played"] * 100)
    return result


# ── Health, Experience, Penalties, Returning Starters ──────────────────────────

def build_health(conn, seasons, primary_df, starter_weeks, snap_lookup) -> pd.DataFrame:
    """avg_games_missed across the 5 primary starters, per (season, team)."""
    season_list = ",".join(str(s) for s in seasons)
    sched_weeks = conn.execute(f"""
        SELECT home_team AS team, season, week FROM bronze_nfl_schedules
        WHERE season IN ({season_list}) AND game_type = 'REG'
        UNION ALL
        SELECT away_team AS team, season, week FROM bronze_nfl_schedules
        WHERE season IN ({season_list}) AND game_type = 'REG'
    """).df()

    name_map = (
        starter_weeks.sort_values("week")
        .drop_duplicates(subset=["season", "team", "gsis_id"], keep="last")
        [["season", "team", "gsis_id", "player_name"]]
    )
    first_week = starter_weeks.groupby(["season", "team", "gsis_id"])["week"].min().reset_index()
    first_week = first_week.rename(columns={"week": "first_week"})

    rows = []
    for (season, team), grp in primary_df.groupby(["season", "team"]):
        primary_set = grp["primary_set"].iloc[0]
        team_sched = sched_weeks[(sched_weeks["season"] == season) & (sched_weeks["team"] == team)]
        missed_list = []
        for gsis_id in primary_set:
            fw = first_week[
                (first_week["season"] == season) & (first_week["team"] == team)
                & (first_week["gsis_id"] == gsis_id)
            ]
            if fw.empty:
                continue
            first_wk = fw["first_week"].iloc[0]
            eligible_weeks = team_sched[team_sched["week"] >= first_wk]["week"].tolist()
            name_row = name_map[
                (name_map["season"] == season) & (name_map["team"] == team) & (name_map["gsis_id"] == gsis_id)
            ]
            if name_row.empty:
                continue
            nkey = name_key(name_row["player_name"].iloc[0])
            played_weeks = snap_lookup[
                (snap_lookup["season"] == season) & (snap_lookup["team"] == team)
                & (snap_lookup["name_key"] == nkey) & (snap_lookup["offense_snaps"] > 0)
            ]["week"].tolist()
            missed = len(set(eligible_weeks) - set(played_weeks))
            missed_list.append(missed)
        rows.append({
            "season": season, "team": team,
            "avg_games_missed": (sum(missed_list) / len(missed_list)) if missed_list else None,
        })
    return pd.DataFrame(rows)


def build_experience(conn, seasons, primary_df) -> pd.DataFrame:
    season_list = ",".join(str(s) for s in seasons)
    bio = conn.execute(f"""
        SELECT season, gsis_id, years_exp FROM player_roster_bio WHERE season IN ({season_list})
    """).df().set_index(["season", "gsis_id"])["years_exp"].to_dict()

    rows = []
    for _, r in primary_df.iterrows():
        exps = [bio.get((r["season"], gid)) for gid in r["primary_set"]]
        exps = [e for e in exps if e is not None and not pd.isna(e)]
        rows.append({
            "season": r["season"], "team": r["team"],
            "avg_years_exp": (sum(exps) / len(exps)) if exps else None,
        })
    return pd.DataFrame(rows)


def build_penalty_rate(conn, seasons) -> pd.DataFrame:
    """ALL players who appear at any O-line slot that team/season (not just the
    primary 5) — a backup's holding call still hurts the team."""
    season_list = ",".join(str(s) for s in seasons)
    ol_gsis = conn.execute(f"""
        SELECT DISTINCT season, team, gsis_id FROM depth_chart_history
        WHERE season IN ({season_list})
    """).df()
    pens = conn.execute(f"""
        SELECT season, team, gsis_id, COUNT(*) AS n FROM player_penalties
        WHERE season IN ({season_list}) GROUP BY season, team, gsis_id
    """).df()
    merged = ol_gsis.merge(pens, on=["season", "team", "gsis_id"], how="left")
    merged["n"] = merged["n"].fillna(0)
    return merged.groupby(["season", "team"], as_index=False)["n"].sum().rename(columns={"n": "ol_penalty_count"})


def build_returning_starters(conn, primary_df: pd.DataFrame) -> pd.DataFrame:
    """For most (historical) seasons, "returning starters" compares that
    season's primary five against the season before it — a pure backward-
    looking stability stat. For the single latest season in primary_df,
    that comparison is against the *current* depth_charts snapshot instead
    (the actual current/upcoming roster) rather than the season before it —
    "how many of today's presumed starters already started together last
    season" is the question that actually matters for a tool used in the
    offseason, and it's a different (and more useful) question than "was
    last season stable relative to the season before that."
    """
    latest_season = int(primary_df["season"].max())
    current_starters = conn.execute("""
        SELECT team, gsis_id FROM depth_charts
        WHERE pos_rank = 1 AND pos_abb IN ('LT','LG','C','RG','RT')
    """).df()
    current_by_team = current_starters.groupby("team")["gsis_id"].apply(frozenset).to_dict()

    rows = []
    lookup = {(r["season"], r["team"]): r["primary_set"] for _, r in primary_df.iterrows()}
    for _, r in primary_df.iterrows():
        if r["season"] == latest_season:
            baseline = current_by_team.get(r["team"])
        else:
            baseline = lookup.get((r["season"] - 1, r["team"]))
        if baseline is None:
            rows.append({"season": r["season"], "team": r["team"], "returning_starters_ct": None})
        else:
            rows.append({
                "season": r["season"], "team": r["team"],
                "returning_starters_ct": len(r["primary_set"] & baseline),
            })
    return pd.DataFrame(rows)


# ── Team OLSI + Chemistry ───────────────────────────────────────────────────────

def build_team_oline_stability(conn, seasons: list[int]) -> pd.DataFrame:
    season_list = ",".join(str(s) for s in seasons)

    starter_weeks = build_starter_weeks(conn, seasons)
    if starter_weeks.empty:
        return pd.DataFrame()
    weekly_sets = build_weekly_sets(starter_weeks)
    primary_df = compute_primary_starters(weekly_sets)
    if primary_df.empty:
        return pd.DataFrame()
    snap_lookup = build_snap_lookup(conn, seasons)

    continuity = build_continuity(conn, seasons, weekly_sets, primary_df, starter_weeks, snap_lookup)
    health = build_health(conn, seasons, primary_df, starter_weeks, snap_lookup)
    experience = build_experience(conn, seasons, primary_df)
    penalties = build_penalty_rate(conn, seasons)
    returning = build_returning_starters(conn, primary_df)

    oline = conn.execute(f"""
        SELECT season, team, pass_block_score, run_block_score,
               sack_rate, rush_epa_per_play, rush_success_rate
        FROM team_oline_index WHERE season IN ({season_list})
    """).df()

    df = primary_df.merge(continuity, on=["season", "team"], how="left")
    df = df.merge(health, on=["season", "team"], how="left")
    df = df.merge(experience, on=["season", "team"], how="left")
    df = df.merge(penalties, on=["season", "team"], how="left")
    df = df.merge(returning, on=["season", "team"], how="left")
    df = df.merge(oline, on=["season", "team"], how="inner")

    # Guardrail mirrors team_oline_index's own thresholds — only score a team-season
    # with a substantial sample of the actual season played.
    df = df[df["team_games_played"] >= 8].copy()
    df["ol_penalty_rate"] = df["ol_penalty_count"] / df["team_offensive_plays"]

    parts = []
    for _season, grp in df.groupby("season"):
        grp = grp.copy()
        grp["continuity_score"] = _pctile_score(grp["continuity_pct"], higher_is_better=True)
        grp["health_score"] = _pctile_score(
            1 - grp["avg_games_missed"] / grp["team_games_played"], higher_is_better=True
        )
        grp["experience_score"] = _pctile_score(grp["avg_years_exp"], higher_is_better=True)
        grp["penalty_score"] = _pctile_score(grp["ol_penalty_rate"], higher_is_better=False)
        grp["sack_rate_score"] = _pctile_score(grp["sack_rate"], higher_is_better=False)
        grp["rush_efficiency_score"] = (
            _pctile_score(grp["rush_epa_per_play"], higher_is_better=True)
            + _pctile_score(grp["rush_success_rate"], higher_is_better=True)
        ) / 2

        grp["olsi_score"] = (
            0.30 * grp["continuity_score"] + 0.20 * grp["health_score"]
            + 0.15 * grp["experience_score"] + 0.15 * grp["penalty_score"]
            + 0.10 * grp["sack_rate_score"] + 0.10 * grp["rush_efficiency_score"]
        )
        grp = grp.dropna(subset=["olsi_score"])
        if grp.empty:
            continue
        grp["olsi_rank"] = grp["olsi_score"].rank(ascending=False, method="min").astype(int)
        parts.append(grp)

    if not parts:
        return pd.DataFrame()
    result = pd.concat(parts, ignore_index=True)
    result["olsi_tier"] = result["olsi_score"].apply(score_to_tier)

    # Chemistry: raw ratios, NOT percentile-ranked (see module docstring).
    # shared_snaps_pct is the true shared-snap ratio (distinct from continuity_pct,
    # which is games_started_together-based — see build_continuity's comment on
    # why that drives the percentile-ranked OLSI instead of the fragile
    # per-player snap-count join).
    returning_pct = result["returning_starters_ct"] / 5 * 100
    games_together_pct = result["games_started_together"] / result["team_games_played"] * 100
    shared_snaps_pct = (result["shared_snaps"] / result["team_offensive_plays"] * 100).clip(upper=100)
    has_prior = returning_pct.notna()
    chem = pd.Series(index=result.index, dtype=float)
    chem[has_prior] = (
        0.40 * returning_pct[has_prior] + 0.30 * games_together_pct[has_prior] + 0.30 * shared_snaps_pct[has_prior]
    )
    chem[~has_prior] = 0.5 * games_together_pct[~has_prior] + 0.5 * shared_snaps_pct[~has_prior]
    result["returning_starters_pct"] = returning_pct
    result["chemistry_score"] = chem.round(1)

    result["primary_starters_json"] = result["primary_set"].apply(lambda s: json.dumps(sorted(s)))
    result["imported_at"] = datetime.now(timezone.utc).replace(tzinfo=None)
    result = result.round({
        "continuity_pct": 1, "continuity_score": 1, "avg_games_missed": 2, "health_score": 1,
        "avg_years_exp": 1, "experience_score": 1, "ol_penalty_rate": 4, "penalty_score": 1,
        "sack_rate_score": 1, "rush_efficiency_score": 1, "olsi_score": 1,
    })
    result["games_started_together"] = result["games_started_together"].astype(int)
    result["team_games_played"] = result["team_games_played"].astype(int)
    result["shared_snaps"] = result["shared_snaps"].astype(int)
    result["team_offensive_plays"] = result["team_offensive_plays"].astype(int)
    result["ol_penalty_count"] = result["ol_penalty_count"].astype(int)

    out_cols = [
        "season", "team", "primary_starters_json", "games_started_together", "team_games_played",
        "shared_snaps", "team_offensive_plays", "continuity_pct", "continuity_score",
        "avg_games_missed", "health_score", "avg_years_exp", "experience_score",
        "ol_penalty_count", "ol_penalty_rate", "penalty_score", "sack_rate", "sack_rate_score",
        "rush_epa_per_play", "rush_success_rate", "rush_efficiency_score",
        "pass_block_score", "run_block_score", "olsi_score", "olsi_rank", "olsi_tier",
        "returning_starters_ct", "returning_starters_pct", "chemistry_score", "imported_at",
    ]
    return result[out_cols]


def write_team_oline_stability(conn, df: pd.DataFrame, dry_run: bool):
    if df.empty:
        print("   No team O-line stability rows to write"); return
    if dry_run:
        print(f"   DRY RUN — would write {len(df)} team-season rows"); return
    for season in df["season"].unique().tolist():
        conn.execute("DELETE FROM team_oline_stability WHERE season = ?", [int(season)])
    conn.register("_stab", df)
    conn.execute("INSERT INTO team_oline_stability BY NAME SELECT * FROM _stab")
    print(f"   💾 team_oline_stability: {len(df):,} rows written")


# ── Individual lineman card ────────────────────────────────────────────────────

def build_player_oline_stability(conn, seasons: list[int]) -> pd.DataFrame:
    season_list = ",".join(str(s) for s in seasons)

    starter_weeks = build_starter_weeks(conn, seasons)
    if starter_weeks.empty:
        return pd.DataFrame()
    weekly_sets = build_weekly_sets(starter_weeks)
    primary_df = compute_primary_starters(weekly_sets)
    primary_lookup = {(r["season"], r["team"]): r["primary_set"] for _, r in primary_df.iterrows()}
    snap_lookup = build_snap_lookup(conn, seasons)

    sched_weeks = conn.execute(f"""
        SELECT home_team AS team, season, week FROM bronze_nfl_schedules
        WHERE season IN ({season_list}) AND game_type = 'REG'
        UNION ALL
        SELECT away_team AS team, season, week FROM bronze_nfl_schedules
        WHERE season IN ({season_list}) AND game_type = 'REG'
    """).df()

    bio = conn.execute(f"""
        SELECT season, gsis_id, age, years_exp FROM player_roster_bio WHERE season IN ({season_list})
    """).df().set_index(["season", "gsis_id"])

    pens = conn.execute(f"""
        SELECT season, gsis_id, penalty_type, COUNT(*) AS n FROM player_penalties
        WHERE season IN ({season_list}) GROUP BY season, gsis_id, penalty_type
    """).df()
    pens_pivot = pens.pivot_table(index=["season", "gsis_id"], columns="penalty_type", values="n", fill_value=0)

    current = conn.execute("""
        SELECT season, team, gsis_id, pos_abb FROM depth_charts WHERE pos_rank = 1
    """).df().set_index("gsis_id")["pos_abb"].to_dict()

    rows = []
    for (season, team, gsis_id), grp in starter_weeks.groupby(["season", "team", "gsis_id"]):
        player_name = grp["player_name"].iloc[-1]
        weeks_started = sorted(grp["week"].unique().tolist())
        starts = len(weeks_started)
        nkey = name_key(player_name)

        snap_rows = snap_lookup[
            (snap_lookup["season"] == season) & (snap_lookup["team"] == team)
            & (snap_lookup["name_key"] == nkey)
        ]
        snaps = int(snap_rows[snap_rows["week"].isin(weeks_started)]["offense_snaps"].sum())

        first_wk = min(weeks_started)
        eligible_weeks = sched_weeks[
            (sched_weeks["season"] == season) & (sched_weeks["team"] == team) & (sched_weeks["week"] >= first_wk)
        ]["week"].tolist()
        played_weeks = snap_rows[snap_rows["offense_snaps"] > 0]["week"].tolist()
        games_missed = len(set(eligible_weeks) - set(played_weeks))

        bio_row = bio.loc[(season, gsis_id)] if (season, gsis_id) in bio.index else None
        pen_row = pens_pivot.loc[(season, gsis_id)] if (season, gsis_id) in pens_pivot.index else None
        holding = int(pen_row.get("Offensive Holding", 0)) if pen_row is not None else 0
        false_start = int(pen_row.get("False Start", 0)) if pen_row is not None else 0

        primary_set = primary_lookup.get((season, team))
        is_primary = bool(primary_set and gsis_id in primary_set)
        continuity_games = 0
        if is_primary:
            matching = weekly_sets[
                (weekly_sets["season"] == season) & (weekly_sets["team"] == team)
                & (weekly_sets["starter_set"] == primary_set)
            ]
            continuity_games = len(matching)

        rows.append({
            "season": season, "gsis_id": gsis_id, "player_name": player_name, "team": team,
            "current_pos_abb": current.get(gsis_id),
            "age": bio_row["age"] if bio_row is not None else None,
            "years_exp": bio_row["years_exp"] if bio_row is not None else None,
            "starts": starts, "snaps": snaps, "games_missed": games_missed,
            "penalties_total": holding + false_start,
            "penalties_holding": holding, "penalties_false_start": false_start,
            "is_primary_starter": is_primary, "continuity_games": continuity_games,
        })

    result = pd.DataFrame(rows)
    if result.empty:
        return result
    result["imported_at"] = datetime.now(timezone.utc).replace(tzinfo=None)
    return result


def write_player_oline_stability(conn, df: pd.DataFrame, dry_run: bool):
    if df.empty:
        print("   No player O-line stability rows to write"); return
    if dry_run:
        print(f"   DRY RUN — would write {len(df)} player-season rows"); return
    for season in df["season"].unique().tolist():
        conn.execute("DELETE FROM player_oline_stability WHERE season = ?", [int(season)])
    conn.register("_pstab", df)
    conn.execute("INSERT INTO player_oline_stability BY NAME SELECT * FROM _pstab")
    print(f"   💾 player_oline_stability: {len(df):,} rows written")


# ── R2 export ─────────────────────────────────────────────────────────────────

def _put_r2(key: str, payload: dict, dry_run: bool):
    body = json.dumps(payload, default=str)
    # NaN is not valid JSON — json.dumps renders it as the bare token `NaN`, which
    # Python's own json.loads silently tolerates but a browser's strict JSON.parse
    # does not, silently poisoning the whole file for every team (this exact bug
    # broke the Offensive Ecosystem feature earlier this session). Hard-stop here
    # rather than ship a repeat.
    assert "NaN" not in body, "unsanitized NaN in payload — would break browser JSON.parse"
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


def export_team_oline_stability_r2(conn, dry_run: bool):
    rows = conn.execute("SELECT * FROM team_oline_stability ORDER BY season, team").df()
    if rows.empty:
        print("   No team O-line stability rows in DB — skipping export"); return
    # Teams missing a prior-season baseline (2021) or a health/experience join
    # miss have NaN in some columns — sanitize to None (valid JSON null) before
    # building the payload. See _put_r2's NaN assertion above for why this matters.
    rows = rows.astype(object).where(pd.notna(rows), None)

    teams: dict = {}
    for _, r in rows.iterrows():
        season_key = str(int(r["season"]))
        teams.setdefault(r["team"], {})[season_key] = {
            "olsi_score": r["olsi_score"], "olsi_rank": int(r["olsi_rank"]), "olsi_tier": r["olsi_tier"],
            "pass_block_score": r["pass_block_score"], "run_block_score": r["run_block_score"],
            "continuity_score": r["continuity_score"], "continuity_pct": r["continuity_pct"],
            "health_score": r["health_score"], "avg_games_missed": r["avg_games_missed"],
            "experience_score": r["experience_score"], "avg_years_exp": r["avg_years_exp"],
            "penalty_score": r["penalty_score"], "ol_penalty_count": int(r["ol_penalty_count"]),
            "ol_penalty_rate": r["ol_penalty_rate"],
            "sack_rate_score": r["sack_rate_score"], "sack_rate": r["sack_rate"],
            "rush_efficiency_score": r["rush_efficiency_score"],
            "rush_epa_per_play": r["rush_epa_per_play"], "rush_success_rate": r["rush_success_rate"],
            "games_started_together": int(r["games_started_together"]),
            "team_games_played": int(r["team_games_played"]),
            "shared_snaps": int(r["shared_snaps"]), "team_offensive_plays": int(r["team_offensive_plays"]),
            "returning_starters_ct": r["returning_starters_ct"], "returning_starters_pct": r["returning_starters_pct"],
            "chemistry_score": r["chemistry_score"],
            "primary_starters": json.loads(r["primary_starters_json"] or "[]"),
        }

    payload = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "seasons": sorted({str(int(s)) for s in rows["season"].unique()}),
        "methodology": (
            "FantasAI O-Line Stability Index (OLSI) — no fabricated player grades, just real "
            "counting stats: 30% Continuity (shared snaps among that season's most common "
            "starting five, reconstructed from real per-week nflverse depth chart history) + "
            "20% Health (games missed by the primary five, from real snap-count data) + 15% "
            "Experience (average years in the league among the primary five) + 15% Penalty rate "
            "(real holding/false-start penalties, whole O-line room, inverse — fewer is better) "
            "+ 10% team sack rate (inverse) + 10% team rushing efficiency (EPA/rush + success "
            "rate). All six percentile-ranked within season across 32 teams. Chemistry Score is "
            "a separate 0-100 raw-ratio blend (not percentile-ranked) of returning starters, "
            "games started together, and shared snaps — meant to read as a % of achievable, not "
            "a league rank. For the latest season, 'returning starters' compares the CURRENT "
            "depth chart against that season's primary five (how many of today's presumed "
            "starters already started together last season); for earlier seasons it compares "
            "that season's primary five against the season before it."
        ),
        "teams": teams,
    }
    _put_r2("fantasai/analysis/oline_stability.json", payload, dry_run)


def export_player_oline_stability_r2(conn, dry_run: bool):
    rows = conn.execute("SELECT * FROM player_oline_stability ORDER BY season, team, current_pos_abb").df()
    if rows.empty:
        print("   No player O-line stability rows in DB — skipping export"); return
    rows = rows.astype(object).where(pd.notna(rows), None)
    players = rows.drop(columns=["imported_at"]).to_dict(orient="records")

    payload = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "seasons": sorted({str(int(s)) for s in rows["season"].unique()}),
        "methodology": (
            "Individual O-line counting stats — no fabricated grades. starts/snaps are real "
            "per-week appearances at an O-line slot (reconstructed nflverse depth chart "
            "history + real snap counts); penalties are real referee-recorded holding/false-"
            "start calls; games_missed is scheduled games since first appearance minus weeks "
            "with a recorded snap; continuity_games is how many weeks this player was part of "
            "the team's season-long most-common starting five."
        ),
        "players": players,
    }
    _put_r2("fantasai/analysis/player_oline_stability.json", payload, dry_run)


# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--seasons", type=str, default=None,
                        help="Comma-separated years, e.g. 2024,2025")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--export-only", action="store_true",
                        help="Skip compute; re-export from existing DB data")
    args = parser.parse_args()

    seasons = [int(y) for y in args.seasons.split(",")] if args.seasons else DEFAULT_SEASONS

    print("=" * 70)
    print("FantasAI O-Line Stability Index (OLSI)")
    print(f"Timestamp: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print(f"Seasons:   {seasons}")
    print(f"Mode:      {'DRY RUN' if args.dry_run else 'LIVE'}")
    print("=" * 70)

    conn = get_conn()
    init_schema(conn)

    if not args.export_only:
        print("\n── Computing Team O-Line Stability (OLSI + Chemistry) ──────────────")
        team_df = build_team_oline_stability(conn, seasons)
        write_team_oline_stability(conn, team_df, args.dry_run)

        print("\n── Computing Individual Lineman Stability ───────────────────────────")
        player_df = build_player_oline_stability(conn, seasons)
        write_player_oline_stability(conn, player_df, args.dry_run)

    print("\n── Exporting to R2 ─────────────────────────────────────────────────")
    export_team_oline_stability_r2(conn, args.dry_run)
    export_player_oline_stability_r2(conn, args.dry_run)

    conn.close()
    print("\n✅ O-Line Stability Index complete")


if __name__ == "__main__":
    main()
