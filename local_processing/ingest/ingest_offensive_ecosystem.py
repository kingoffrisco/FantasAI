"""
FantasAI Offensive Ecosystem — QB Support Score + Player Weapon Score
Reads only from tables already ingested by ingest_nflverse.py and ingest_oline_index.py
(player_nextgen_stats, player_efficiency_stats, gold_weekly_stats, team_oline_index,
depth_charts) — no new external fetch, just composite scoring on top of real data.

Instead of a flat depth chart (QB/RB/WR1/WR2/TE), this computes two transparent,
percentile-based composite scores — same approach as team_oline_index, no fabricated
"PFF-style" numbers:

  Player Weapon Score (WR/TE/RB, 0-100) — how good a receiving weapon this player is:
    WR/TE = 30% target share + 20% separation + 20% YAC-over-expected
          + 15% red zone touches + 10% ADOT (deep-threat) + 5% catch rate
    RB    = 30% target share + 25% EPA/target + 15% catch rate
          + 15% yards/target + 10% red zone touches + 5% explosive-reception rate
    (NFL's free NGS receiving feed only covers WR/TE — zero RB rows exist in it at all —
    so RB substitutes real, RB-covering metrics from player_efficiency_stats for the
    separation/YACOE/ADOT trio: EPA/target in place of YACOE, yards/target in place of
    separation, explosive-reception rate in place of ADOT. Same weight distribution
    philosophy — usage (target share) dominant, reliability/efficiency second, deep-shot
    variance weighted low — just sourced from data that actually exists for a running
    back. WR/TE and RB are percentile-ranked in separate pools per season; WR and TE share
    a pool since both compete for the same targets within an offense.)
    Guardrails: WR/TE need >=30 targets and >=6 games; RB (receiving weapon only) needs
    >=20 targets and >=6 games. Below threshold = no row, not a fabricated 0.

  Team Support Score / ESCV (0-100) — how good a QB's supporting cast is:
    35% O-Line score (team_oline_index.overall_score) + 25% best WR/TE weapon score
    + 15% best RB weapon score + 10% offensive pace + 15% red zone volume
    If no WR/TE or RB qualifies for a Weapon Score that season (e.g. a run-heavy offense
    with no 30-target receiver), that component's weight is dropped and the remaining
    weights are renormalized proportionally rather than scoring the missing piece 0 —
    a data/usage gap shouldn't tank a team's score the same as an actual weakness.

No "Coaching" grade — no legitimate free data source exists for that; Offensive Pace
(plays/game) and Red Zone Volume (team red-zone touches) are honest, real proxies
instead. No individual O-Line player grades — only real starter names/positions from
depth_charts (LT/LG/C/RG/RT), no invented per-lineman numbers.

Data availability note: gold_weekly_stats.stats is a JSON blob whose key schema depends
on source — source='sleeper' (current season) uses Sleeper's key names (rec_tgt, rec,
pass_att, rush_att, ...); source='nflverse' (prior completed seasons) uses nflverse's
own, entirely different key names. Target share, catch rate, and offensive pace here are
all computed via json_extract_string() against the Sleeper-style keys only, so they
silently resolve to NULL for 'nflverse' rows — DEFAULT_SEASONS is deliberately just the
current season to avoid computing (and shipping) silently-wrong numbers for prior
seasons. The frontend only ever surfaces the latest available season anyway, so this
has no effect on the feature as built; extending to prior seasons would require adding
a second json_extract_string() branch (or COALESCE) for nflverse's key names first.

Outputs (DuckDB): player_weapon_scores, team_support_scores
Outputs (R2):
  fantasai/analysis/player_weapon_scores.json  — { players: [ {player_name, season, ...} ] }
  fantasai/analysis/team_support_scores.json   — { teams: { TEAM: { season: {...} } } }

Usage:
  python ingest_offensive_ecosystem.py                   # DEFAULT_SEASONS
  python ingest_offensive_ecosystem.py --seasons 2025
  python ingest_offensive_ecosystem.py --dry-run
  python ingest_offensive_ecosystem.py --export-only      # skip compute, re-export from DB
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

# gold_weekly_stats's JSON key schema only resolves correctly for source='sleeper' rows
# (see module docstring) — that's the current season only. Override with --seasons if a
# 'nflverse' key mapping gets added later to support prior seasons too.
DEFAULT_SEASONS = [2025]

WR_TE_WEIGHTS = {
    "target_share_score": 0.30, "separation_score": 0.20, "yacoe_score": 0.20,
    "redzone_score": 0.15, "adot_score": 0.10, "catch_rate_score": 0.05,
}
RB_WEIGHTS = {
    "target_share_score": 0.30, "epa_per_target_score": 0.25, "catch_rate_score": 0.15,
    "yards_per_target_score": 0.15, "redzone_score": 0.10, "explosive_rec_rate_score": 0.05,
}

TIER_CUTS = [(85, "Elite"), (70, "Good"), (50, "Average"), (30, "Below Average"), (0, "Poor")]


def score_to_tier(score):
    if score is None:
        return None
    for cut, label in TIER_CUTS:
        if score >= cut:
            return label
    return "Poor"


def _pctile_score(s: pd.Series, higher_is_better: bool = True) -> pd.Series:
    """Percentile-rank a metric to 0-100 within its group (season, position)."""
    pct = s.rank(pct=True)
    if not higher_is_better:
        pct = 1 - pct
    return pct * 100


# ── Player Weapon Score ────────────────────────────────────────────────────────
#
# NFL's free NGS receiving feed only publishes WR/TE rows (confirmed: zero RB rows
# exist in nfl_data_py's import_ngs_data('receiving', ...) for any season) — so a RB's
# skill trio (separation/YAC-over-expected/ADOT) can never be sourced from NGS. RB uses
# a different skill trio from player_efficiency_stats instead (epa_per_target in place
# of yacoe, yards_per_target in place of separation, explosive_rec_rate in place of
# ADOT) — same weight distribution philosophy, real data that actually covers RBs.

def build_weapon_scores(conn, seasons: list[int]) -> pd.DataFrame:
    season_list = ",".join(str(s) for s in seasons)

    # Target share: player's share of their team's total RB/WR/TE targets that season.
    target_share = conn.execute(f"""
        WITH team_targets AS (
            SELECT team, season,
                   SUM(CAST(json_extract_string(stats, '$.rec_tgt') AS DOUBLE)) AS team_targets
            FROM gold_weekly_stats
            WHERE stats IS NOT NULL AND position IN ('RB','WR','TE') AND season IN ({season_list})
            GROUP BY team, season
        ),
        player_targets AS (
            SELECT LOWER(TRIM(player_name)) AS name_key, team, season,
                   SUM(CAST(json_extract_string(stats, '$.rec_tgt') AS DOUBLE)) AS targets_gws
            FROM gold_weekly_stats
            WHERE stats IS NOT NULL AND position IN ('RB','WR','TE') AND season IN ({season_list})
            GROUP BY LOWER(TRIM(player_name)), team, season
        )
        SELECT p.name_key, p.team, p.season,
               p.targets_gws / NULLIF(t.team_targets, 0) * 100 AS target_share
        FROM player_targets p JOIN team_targets t USING (team, season)
    """).df()

    # Games/targets/receptions — from gold_weekly_stats (covers RB too, unlike NGS).
    receiving_totals = conn.execute(f"""
        SELECT LOWER(TRIM(player_name)) AS name_key, season,
               COUNT(DISTINCT week) AS games,
               SUM(CAST(json_extract_string(stats, '$.rec_tgt') AS DOUBLE)) AS targets,
               SUM(CAST(json_extract_string(stats, '$.rec') AS DOUBLE)) AS receptions
        FROM gold_weekly_stats
        WHERE stats IS NOT NULL AND position IN ('RB','WR','TE') AND season IN ({season_list})
        GROUP BY LOWER(TRIM(player_name)), season
    """).df()

    # WR/TE-only skill trio from NGS — weighted by weekly targets so a 2-target
    # bye-adjacent game doesn't count the same as a 12-target game.
    ngs_skill = conn.execute(f"""
        SELECT LOWER(TRIM(player_name)) AS name_key, season,
               SUM(avg_separation * targets) / NULLIF(SUM(targets), 0)          AS avg_separation,
               SUM(avg_intended_air_yards * targets) / NULLIF(SUM(targets), 0)  AS adot,
               SUM(yacoe * targets) / NULLIF(SUM(targets), 0)                   AS yacoe
        FROM player_nextgen_stats
        WHERE season IN ({season_list}) AND targets > 0
        GROUP BY LOWER(TRIM(player_name)), season
    """).df()

    # Red zone touches (all positions) + RB-only skill trio, both from efficiency stats.
    eff_skill = conn.execute(f"""
        SELECT LOWER(TRIM(player_name)) AS name_key, season,
               SUM(redzone_touches) AS redzone_touches,
               SUM(epa_per_target * targets) / NULLIF(SUM(targets), 0)     AS epa_per_target,
               SUM(yards_per_target * targets) / NULLIF(SUM(targets), 0)  AS yards_per_target,
               SUM(explosive_rec_rate * targets) / NULLIF(SUM(targets), 0) AS explosive_rec_rate
        FROM player_efficiency_stats
        WHERE season IN ({season_list})
        GROUP BY LOWER(TRIM(player_name)), season
    """).df()

    # position/team (player_efficiency_stats.position is unpopulated, so pull from
    # gold_weekly_stats via arg_max on week — most recent team, matching the convention
    # already used in export/export_to_r2.py).
    pos_team = conn.execute(f"""
        SELECT LOWER(TRIM(player_name)) AS name_key, season,
               ARG_MAX(position, week) AS position,
               ARG_MAX(player_name, week) AS player_name,
               ARG_MAX(team, week) AS team
        FROM gold_weekly_stats
        WHERE position IN ('RB','WR','TE') AND season IN ({season_list})
        GROUP BY LOWER(TRIM(player_name)), season
    """).df()

    base = receiving_totals.merge(target_share[["name_key", "season", "target_share"]], on=["name_key", "season"], how="inner")
    base = base.merge(eff_skill[["name_key", "season", "redzone_touches"]], on=["name_key", "season"], how="left")
    base = base.merge(pos_team, on=["name_key", "season"], how="inner")
    base["redzone_touches"] = base["redzone_touches"].fillna(0)
    base["catch_rate"] = (base["receptions"] / base["targets"] * 100).where(base["targets"] > 0)

    wrte = base[(base["position"].isin(["WR", "TE"])) & (base["targets"] >= 30) & (base["games"] >= 6)].copy()
    wrte = wrte.merge(ngs_skill, on=["name_key", "season"], how="left")

    rb = base[(base["position"] == "RB") & (base["targets"] >= 20) & (base["games"] >= 6)].copy()
    rb = rb.merge(
        eff_skill[["name_key", "season", "epa_per_target", "yards_per_target", "explosive_rec_rate"]],
        on=["name_key", "season"], how="left",
    )

    parts = []
    for pool, weights in [(wrte, WR_TE_WEIGHTS), (rb, RB_WEIGHTS)]:
        if pool.empty:
            continue
        for _season, grp in pool.groupby("season"):
            grp = grp.copy()
            grp["target_share_score"] = _pctile_score(grp["target_share"])
            grp["catch_rate_score"]   = _pctile_score(grp["catch_rate"])
            grp["redzone_score"]      = _pctile_score(grp["redzone_touches"])
            if "avg_separation" in grp.columns:  # WR/TE
                grp["separation_score"] = _pctile_score(grp["avg_separation"])
                grp["yacoe_score"]      = _pctile_score(grp["yacoe"])
                grp["adot_score"]       = _pctile_score(grp["adot"])
            else:  # RB
                grp["epa_per_target_score"]     = _pctile_score(grp["epa_per_target"])
                grp["yards_per_target_score"]   = _pctile_score(grp["yards_per_target"])
                grp["explosive_rec_rate_score"] = _pctile_score(grp["explosive_rec_rate"])
            grp["weapon_score"] = sum(grp[col] * w for col, w in weights.items())
            # A player can pass the targets/games guardrail but still have a skill field
            # entirely null for the season (e.g. NGS omits separation below its own
            # sub-threshold routes) — drop rather than rank a fabricated NaN score.
            grp = grp.dropna(subset=["weapon_score"])
            if grp.empty:
                continue
            grp["weapon_rank"] = grp["weapon_score"].rank(ascending=False, method="min").astype(int)
            parts.append(grp)

    if not parts:
        return pd.DataFrame()

    result = pd.concat(parts, ignore_index=True)
    result["weapon_tier"] = result["weapon_score"].apply(score_to_tier)
    round_cols = {
        "target_share": 2, "catch_rate": 1, "target_share_score": 1, "catch_rate_score": 1,
        "redzone_score": 1, "weapon_score": 1,
        "avg_separation": 2, "adot": 2, "yacoe": 2,
        "separation_score": 1, "yacoe_score": 1, "adot_score": 1,
        "epa_per_target": 3, "yards_per_target": 2, "explosive_rec_rate": 3,
        "epa_per_target_score": 1, "yards_per_target_score": 1, "explosive_rec_rate_score": 1,
    }
    result = result.round({k: v for k, v in round_cols.items() if k in result.columns})
    result["targets"] = result["targets"].astype(int)
    result["redzone_touches"] = result["redzone_touches"].astype(int)
    result["imported_at"] = datetime.now(timezone.utc).replace(tzinfo=None)

    out_cols = [
        "season", "player_name", "position", "team", "games", "targets", "target_share",
        "catch_rate", "redzone_touches", "adot", "avg_separation", "yacoe",
        "epa_per_target", "yards_per_target", "explosive_rec_rate",
        "target_share_score", "catch_rate_score", "redzone_score",
        "adot_score", "separation_score", "yacoe_score",
        "epa_per_target_score", "yards_per_target_score", "explosive_rec_rate_score",
        "weapon_score", "weapon_rank", "weapon_tier", "imported_at",
    ]
    for col in out_cols:
        if col not in result.columns:
            result[col] = None
    return result[out_cols]


def write_weapon_scores(conn, df: pd.DataFrame, dry_run: bool):
    if df.empty:
        print("   No weapon score rows to write"); return
    if dry_run:
        print(f"   DRY RUN — would write {len(df)} player-weapon-score rows"); return
    for season in df["season"].unique().tolist():
        conn.execute("DELETE FROM player_weapon_scores WHERE season = ?", [int(season)])
    conn.register("_weapon", df)
    conn.execute("INSERT INTO player_weapon_scores BY NAME SELECT * FROM _weapon")
    print(f"   💾 player_weapon_scores: {len(df):,} rows written")


# ── Team Support Score ──────────────────────────────────────────────────────────

def build_team_pace(conn, seasons: list[int]) -> pd.DataFrame:
    season_list = ",".join(str(s) for s in seasons)
    return conn.execute(f"""
        WITH team_week_plays AS (
            SELECT team, season, week,
                   SUM(CAST(json_extract_string(stats, '$.pass_att') AS DOUBLE)) AS pass_att,
                   SUM(CAST(json_extract_string(stats, '$.rush_att') AS DOUBLE)) AS rush_att
            FROM gold_weekly_stats
            WHERE stats IS NOT NULL AND season IN ({season_list})
            GROUP BY team, season, week
        )
        SELECT team, season, AVG(pass_att + rush_att) AS plays_per_game
        FROM team_week_plays
        GROUP BY team, season
        HAVING COUNT(DISTINCT week) >= 8
    """).df()


def build_team_redzone(conn, seasons: list[int]) -> pd.DataFrame:
    season_list = ",".join(str(s) for s in seasons)
    return conn.execute(f"""
        SELECT team, season, SUM(redzone_touches) AS redzone_touches_total
        FROM player_efficiency_stats
        WHERE season IN ({season_list})
        GROUP BY team, season
    """).df()


def build_oline_starters(conn) -> dict:
    """{team: {slot: player_name}} from the current depth_charts snapshot.

    depth_charts is a rolling "who's on the roster right now" table (fully rebuilt from
    nflverse on every ingest run — see ingest_nflverse.py's import_depth_charts), not a
    per-season history. Its season tag reflects whatever nflverse currently considers
    "now" (typically the upcoming season during the offseason), which generally differs
    from the season whose completed stats feed the rest of this script's Weapon/Support
    Scores (the most recently *finished* season). Rather than trying to match seasons
    between two fundamentally different kinds of data, this always returns whichever
    season is latest in depth_charts and applies those starters to every team-season row
    — showing the current O-Line lineup alongside a score built from last season's
    performance is the correct pairing for a "how good is this situation right now"
    feature.
    """
    rows = conn.execute("""
        SELECT team, pos_abb, player_name
        FROM depth_charts
        WHERE pos_rank = 1 AND pos_abb IN ('LT','LG','C','RG','RT')
          AND season = (SELECT MAX(season) FROM depth_charts)
    """).fetchall()
    out = {}
    for team, pos_abb, player_name in rows:
        out.setdefault(team, {})[pos_abb] = player_name
    return out


def build_support_scores(conn, seasons: list[int]) -> pd.DataFrame:
    season_list = ",".join(str(s) for s in seasons)
    oline = conn.execute(f"""
        SELECT season, team, overall_score AS oline_score, overall_rank AS oline_rank
        FROM team_oline_index WHERE season IN ({season_list})
    """).df()
    if oline.empty:
        return pd.DataFrame()

    weapons = conn.execute(f"""
        SELECT season, team, position, player_name, weapon_score
        FROM player_weapon_scores WHERE season IN ({season_list})
    """).df()
    pace = build_team_pace(conn, seasons)
    rz = build_team_redzone(conn, seasons)
    starters = build_oline_starters(conn)

    def best_weapon(season, team, pos_list):
        pool = weapons[(weapons["season"] == season) & (weapons["team"] == team) & (weapons["position"].isin(pos_list))]
        if pool.empty:
            return None, None
        row = pool.loc[pool["weapon_score"].idxmax()]
        return row["weapon_score"], row["player_name"]

    rows = []
    for _, o in oline.iterrows():
        season, team = int(o["season"]), o["team"]
        best_wrte_score, best_wrte_name = best_weapon(season, team, ["WR", "TE"])
        best_rb_score, best_rb_name = best_weapon(season, team, ["RB"])
        pace_row = pace[(pace["season"] == season) & (pace["team"] == team)]
        rz_row = rz[(rz["season"] == season) & (rz["team"] == team)]
        rows.append({
            "season": season, "team": team,
            "oline_score": o["oline_score"], "oline_rank": o["oline_rank"],
            "best_wrte_weapon_score": best_wrte_score, "best_wrte_player_name": best_wrte_name,
            "best_rb_weapon_score": best_rb_score, "best_rb_player_name": best_rb_name,
            "pace_plays_per_game": pace_row["plays_per_game"].iloc[0] if len(pace_row) else None,
            "redzone_touches_total": rz_row["redzone_touches_total"].iloc[0] if len(rz_row) else None,
            "oline_starters": starters.get(team, {}),
        })
    df = pd.DataFrame(rows)

    parts = []
    for _season, grp in df.groupby("season"):
        grp = grp.copy()
        # O-Line/pace/red-zone are expected for every team with a full season on record —
        # a team missing any of these has a genuine partial-season data gap and shouldn't
        # get a Support Score row this season (mirrors team_oline_index's own guardrails).
        grp = grp.dropna(subset=["oline_score", "pace_plays_per_game", "redzone_touches_total"])
        if grp.empty:
            continue
        grp["pace_score"]    = _pctile_score(grp["pace_plays_per_game"])
        grp["redzone_score"] = _pctile_score(grp["redzone_touches_total"])

        # WR/TE and RB weapon components are each optional — a team can genuinely lack a
        # qualifying receiver (e.g. a run-heavy offense with no 30-target WR/TE that
        # season). When missing, drop that weight and renormalize across whatever's left,
        # rather than scoring the missing component 0 (which would tank a team for a
        # data/usage gap rather than an actual weakness).
        has_wrte = grp["best_wrte_weapon_score"].notna()
        has_rb   = grp["best_rb_weapon_score"].notna()
        total = (
            grp["oline_score"] * 0.35
            + grp["pace_score"] * 0.10
            + grp["redzone_score"] * 0.15
            + grp["best_wrte_weapon_score"].fillna(0) * 0.25
            + grp["best_rb_weapon_score"].fillna(0) * 0.15
        )
        active_weight = 0.35 + 0.10 + 0.15 + has_wrte * 0.25 + has_rb * 0.15
        grp["support_score"] = (total / active_weight).round(1)
        grp["support_rank"]  = grp["support_score"].rank(ascending=False, method="min").astype(int)
        parts.append(grp)

    result = pd.concat(parts, ignore_index=True)
    result["support_tier"] = result["support_score"].apply(score_to_tier)
    result["oline_starters_json"] = result["oline_starters"].apply(json.dumps)
    result = result.round({
        "oline_score": 1, "pace_plays_per_game": 1, "pace_score": 1, "redzone_score": 1,
        "best_wrte_weapon_score": 1, "best_rb_weapon_score": 1,
    })
    result["redzone_touches_total"] = result["redzone_touches_total"].fillna(0).astype(int)
    result["imported_at"] = datetime.now(timezone.utc).replace(tzinfo=None)
    return result[[
        "season", "team", "oline_score", "oline_rank",
        "best_wrte_weapon_score", "best_wrte_player_name",
        "best_rb_weapon_score", "best_rb_player_name",
        "pace_plays_per_game", "pace_score", "redzone_touches_total", "redzone_score",
        "support_score", "support_rank", "support_tier", "oline_starters_json", "imported_at",
    ]]


def write_support_scores(conn, df: pd.DataFrame, dry_run: bool):
    if df.empty:
        print("   No support score rows to write"); return
    if dry_run:
        print(f"   DRY RUN — would write {len(df)} team-support-score rows"); return
    for season in df["season"].unique().tolist():
        conn.execute("DELETE FROM team_support_scores WHERE season = ?", [int(season)])
    conn.register("_support", df)
    conn.execute("INSERT INTO team_support_scores BY NAME SELECT * FROM _support")
    print(f"   💾 team_support_scores: {len(df):,} rows written")


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


def export_weapon_scores_r2(conn, dry_run: bool):
    rows = conn.execute("SELECT * FROM player_weapon_scores ORDER BY season, weapon_rank").df()
    if rows.empty:
        print("   No weapon score rows in DB — skipping export"); return
    # WR/TE rows have NaN in the RB-only columns (epa_per_target etc.) and vice versa —
    # pandas' NaN serializes via json.dumps as the bare token `NaN`, which isn't valid
    # JSON and makes the whole file unparseable by the browser's strict JSON.parse (even
    # though Python's own json.loads silently accepts it, which is why this slipped past
    # backend-only verification). Convert to None so it serializes as `null` instead.
    rows = rows.astype(object).where(pd.notna(rows), None)
    players = rows.drop(columns=["imported_at"]).to_dict(orient="records")
    payload = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "seasons": sorted({str(int(s)) for s in rows["season"].unique()}),
        "methodology": (
            "FantasAI Weapon Score — composite score built from real NFL Next Gen Stats "
            "(separation, YAC over expected, intended air yards) and nflverse-derived "
            "efficiency stats (EPA/target, yards/target, explosive-reception rate, red zone "
            "touches), percentile-ranked within each season and position pool. WR/TE = 30% "
            "target share + 20% separation + 20% YAC-over-expected + 15% red zone touches + "
            "10% ADOT + 5% catch rate. RB (receiving) = 30% target share + 25% EPA/target + "
            "15% catch rate + 15% yards/target + 10% red zone touches + 5% explosive-reception "
            "rate — NGS doesn't publish separation/YACOE/ADOT for running backs at all, so RB "
            "substitutes real efficiency-stat equivalents rather than leaving the axis blank. "
            "Minimum sample: 30 targets/6 games (WR/TE), 20 targets/6 games (RB) — below "
            "threshold, no score is shown rather than a fabricated low number."
        ),
        "players": players,
    }
    _put_r2("fantasai/analysis/player_weapon_scores.json", payload, dry_run)


def export_support_scores_r2(conn, dry_run: bool):
    rows = conn.execute("SELECT * FROM team_support_scores ORDER BY season, team").df()
    if rows.empty:
        print("   No support score rows in DB — skipping export"); return
    # Teams with no qualifying RB Weapon Score have NaN in best_rb_weapon_score/
    # best_rb_player_name — same NaN-isn't-valid-JSON issue as export_weapon_scores_r2
    # above. Convert to None so it serializes as `null`, not the bare token `NaN`.
    rows = rows.astype(object).where(pd.notna(rows), None)

    teams: dict = {}
    for _, r in rows.iterrows():
        season_key = str(int(r["season"]))
        teams.setdefault(r["team"], {})[season_key] = {
            "oline_score":               r["oline_score"],
            "oline_rank":                int(r["oline_rank"]),
            "best_wrte_weapon_score":    r["best_wrte_weapon_score"],
            "best_wrte_player_name":     r["best_wrte_player_name"],
            "best_rb_weapon_score":      r["best_rb_weapon_score"],
            "best_rb_player_name":       r["best_rb_player_name"],
            "pace_plays_per_game":       r["pace_plays_per_game"],
            "pace_score":                r["pace_score"],
            "redzone_touches_total":     int(r["redzone_touches_total"]),
            "redzone_score":             r["redzone_score"],
            "support_score":             r["support_score"],
            "support_rank":              int(r["support_rank"]),
            "support_tier":              r["support_tier"],
            "oline_starters":            json.loads(r["oline_starters_json"] or "{}"),
        }

    payload = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "seasons": sorted({str(int(s)) for s in rows["season"].unique()}),
        "methodology": (
            "FantasAI Support Score (ESCV) — how good a QB's supporting cast is, built "
            "entirely from real data: 35% O-Line Index score + 25% best WR/TE Weapon Score "
            "on the team + 15% best receiving-RB Weapon Score + 10% offensive pace "
            "(plays/game, percentile) + 15% red zone volume (team red-zone touches, "
            "percentile). If no WR/TE or RB qualifies for a Weapon Score that season, that "
            "weight is dropped and the rest is renormalized rather than scoring it 0. No "
            "fabricated 'coaching' grade or individual O-Line player grades — oline_starters "
            "lists real depth-chart names/positions only."
        ),
        "teams": teams,
    }
    _put_r2("fantasai/analysis/team_support_scores.json", payload, dry_run)


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
    print("FantasAI Offensive Ecosystem — Support Score + Weapon Score")
    print(f"Timestamp: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print(f"Seasons:   {seasons}")
    print(f"Mode:      {'DRY RUN' if args.dry_run else 'LIVE'}")
    print("=" * 70)

    conn = get_conn()
    init_schema(conn)

    if not args.export_only:
        print("\n── Computing Player Weapon Scores ──────────────────────────────────")
        weapon_df = build_weapon_scores(conn, seasons)
        write_weapon_scores(conn, weapon_df, args.dry_run)

        print("\n── Computing Team Support Scores ───────────────────────────────────")
        support_df = build_support_scores(conn, seasons)
        write_support_scores(conn, support_df, args.dry_run)

    print("\n── Exporting to R2 ─────────────────────────────────────────────────")
    export_weapon_scores_r2(conn, args.dry_run)
    export_support_scores_r2(conn, args.dry_run)

    conn.close()
    print("\n✅ Offensive Ecosystem complete")


if __name__ == "__main__":
    main()
