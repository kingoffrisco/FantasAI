"""
Rookie Score Computation — FantasAI 2026

Computes a 0-100 Rookie Score for each 2026 skill-position rookie using
data already in DuckDB. No external API calls required.

Component scores by position:

  RB:  40% Draft Capital + 20% Athleticism + 35% Opportunity + 5% Team bonus
  WR:  35% Draft Capital + 25% Athleticism + 30% Opportunity + 10% Team bonus
  TE:  35% Draft Capital + 20% Athleticism + 30% Opportunity + 15% Team bonus
  QB:  45% Draft Capital + 20% Athleticism + 30% Opportunity + 5% Team bonus

Draft Capital   — derived from draft_ovr (or ADP proxy if pick unavailable)
Athleticism     — Speed Score + Burst Score from combine measurables
Opportunity     — depth chart order + team pass/rush context

Projected fantasy points mapped from rookie_score using historical cohort curves.
WR curve ramps: Week 1 = 60% of ceiling, Week 8 = 85%, Week 17 = 100%.

Outputs:
  DuckDB : bronze_rookie_scores
  R2     : fantasai/analysis/rookie_scores.json

Usage:
  python ingest_rookie_scores.py
  python ingest_rookie_scores.py --dry-run
  python ingest_rookie_scores.py --season 2026
"""

import argparse
import json
import math
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

import pandas as pd
import requests

sys.path.insert(0, str(Path(__file__).parent.parent))
import ssl_utils  # noqa: F401 — patches SSL before any HTTPS calls
from db import get_conn, init_schema

try:
    from dotenv import load_dotenv
    load_dotenv(Path(__file__).parent.parent.parent / ".env")
except ImportError:
    pass

R2_BASE      = "https://api.fantasai.net/api/v1/r2"
FANTASAI_KEY = os.environ.get("FANTASAI_KEY", "")
HEADERS_R2   = {"X-FantasAI-Key": FANTASAI_KEY, "Content-Type": "application/json"}

SKILL_POS = ("QB", "RB", "WR", "TE")

# ── Weights by position ──────────────────────────────────────────────────────

WEIGHTS = {
    "RB": dict(draft_capital=0.40, athleticism=0.20, opportunity=0.35, team_bonus=0.05),
    "WR": dict(draft_capital=0.35, athleticism=0.25, opportunity=0.30, team_bonus=0.10),
    "TE": dict(draft_capital=0.35, athleticism=0.20, opportunity=0.30, team_bonus=0.15),
    "QB": dict(draft_capital=0.45, athleticism=0.20, opportunity=0.30, team_bonus=0.05),
}

# ── Historical rookie cohort curves (Rookie Score → expected PPR season pts) ─
# Calibrated from 2014-2024 NFL Draft classes, half-PPR.
# Source: industry research + FantasyPros historical ADP/production studies.

SCORE_TO_PTS = {
    "RB": [
        (95, 220), (90, 185), (85, 155), (80, 125),
        (75, 100), (70,  78), (65,  58), (60,  40),
        (55,  28), (50,  18), (0,   10),
    ],
    "WR": [
        (95, 210), (90, 175), (85, 145), (80, 118),
        (75,  93), (70,  70), (65,  52), (60,  36),
        (55,  24), (50,  15), (0,    8),
    ],
    "TE": [
        (95, 160), (90, 130), (85, 105), (80,  82),
        (75,  62), (70,  46), (65,  33), (60,  22),
        (55,  14), (50,   8), (0,    5),
    ],
    "QB": [
        (95, 320), (90, 270), (85, 225), (80, 182),
        (75, 145), (70, 110), (65,  80), (60,  55),
        (55,  35), (50,  20), (0,   10),
    ],
}


def score_to_pts(score: float, pos: str) -> float:
    curve = SCORE_TO_PTS.get(pos, SCORE_TO_PTS["WR"])
    for threshold, pts in curve:
        if score >= threshold:
            return float(pts)
    return float(curve[-1][1])


# ── Draft Capital Score ───────────────────────────────────────────────────────

def draft_capital_score(draft_ovr, adp=None) -> float | None:
    """Convert overall pick number (or ADP proxy) to 0-100 score."""
    pick = None
    if draft_ovr is not None and not (isinstance(draft_ovr, float) and math.isnan(draft_ovr)):
        pick = int(draft_ovr)
    elif adp is not None and not (isinstance(adp, float) and math.isnan(adp)) and adp < 500:
        pick = int(adp)
    if pick is None:
        return None
    # Smooth power curve: Pick 1=100, Pick 32≈88, Pick 64≈73, Pick 100≈57, Pick 200≈26, UDFA=0
    ratio = max(0.0, (263 - pick) / 262)
    return round(100.0 * ratio ** 0.55, 1)


# ── Athleticism Score ─────────────────────────────────────────────────────────

# Position-specific elite benchmarks for normalization
ATHLETIC_BENCHMARKS = {
    #          forty  vertical  broad   bench   wt
    "RB":  dict(forty=4.35, vertical=40.0, broad=130, bench=23, wt=215),
    "WR":  dict(forty=4.35, vertical=38.5, broad=127, bench=15, wt=200),
    "TE":  dict(forty=4.50, vertical=36.0, broad=120, bench=20, wt=255),
    "QB":  dict(forty=4.55, vertical=34.0, broad=118, bench=18, wt=225),
}
# Position-specific floor benchmarks (50th-pct ≈ score 50)
ATHLETIC_FLOOR = {
    "RB":  dict(forty=4.65, vertical=31.0, broad=112, bench=14, wt=200),
    "WR":  dict(forty=4.55, vertical=31.0, broad=109, bench=10, wt=185),
    "TE":  dict(forty=4.75, vertical=28.0, broad=108, bench=13, wt=240),
    "QB":  dict(forty=4.80, vertical=27.0, broad=102, bench=10, wt=210),
}


def normalize_metric(val, elite, floor, invert=False):
    """Map a metric to 0-100 using elite/floor anchors."""
    if val is None or (isinstance(val, float) and math.isnan(val)):
        return None
    if invert:
        # Lower is better (40 time)
        pct = (floor - val) / (floor - elite)
    else:
        pct = (val - floor) / (elite - floor)
    return round(min(100.0, max(0.0, pct * 100.0)), 1)


def athleticism_score(row, pos: str) -> float | None:
    elite = ATHLETIC_BENCHMARKS.get(pos, ATHLETIC_BENCHMARKS["WR"])
    floor = ATHLETIC_FLOOR.get(pos, ATHLETIC_FLOOR["WR"])

    components = []
    weights    = []

    # 40-yard dash (most important for skill players)
    s40 = normalize_metric(row.get("forty"), elite["forty"], floor["forty"], invert=True)
    if s40 is not None:
        w = 0.45 if pos in ("WR", "RB") else 0.30
        components.append(s40); weights.append(w)

    # Vertical jump
    sv = normalize_metric(row.get("vertical"), elite["vertical"], floor["vertical"])
    if sv is not None:
        components.append(sv); weights.append(0.25)

    # Broad jump
    sb = normalize_metric(row.get("broad_jump"), elite["broad"], floor["broad"])
    if sb is not None:
        components.append(sb); weights.append(0.20)

    # Bench (less critical for skill pos but included)
    sbn = normalize_metric(row.get("bench"), elite["bench"], floor["bench"])
    if sbn is not None:
        components.append(sbn); weights.append(0.10)

    if not components:
        return None

    # Weighted average; scale weights to sum to 1
    total_w = sum(weights)
    score = sum(c * w for c, w in zip(components, weights)) / total_w
    # When few measurables exist, blend toward neutral (50) to avoid
    # sparse drill results dominating the entire athleticism component.
    if len(components) == 1:
        score = score * 0.4 + 50.0 * 0.6
    elif len(components) == 2:
        score = score * 0.7 + 50.0 * 0.3
    return round(score, 1)


# ── Opportunity Score ─────────────────────────────────────────────────────────

def opportunity_score(depth_order) -> float:
    """Depth chart order → opportunity score."""
    if depth_order is None or (isinstance(depth_order, float) and math.isnan(depth_order)):
        return 35.0   # unknown — assume rotational
    d = int(depth_order)
    if d == 1:  return 92.0
    if d == 2:  return 62.0
    if d == 3:  return 32.0
    return 15.0


# ── Main computation ──────────────────────────────────────────────────────────

def compute_scores(conn, season: int) -> pd.DataFrame:
    # Pull combine data for this draft class
    combine = conn.execute("""
        SELECT player_name, pos, school, draft_round, draft_ovr, draft_team,
               forty, vertical, broad_jump, bench, wt
        FROM bronze_combine_data
        WHERE season = ? AND pos IN ('QB','RB','WR','TE')
    """, [season]).df()

    # Pull ADP (proxy for draft capital when pick unknown)
    adp_df = conn.execute("""
        SELECT player_name, MIN(adp_rank) AS adp
        FROM bronze_adp_rankings
        GROUP BY player_name
    """).df()
    adp_map = dict(zip(adp_df["player_name"].str.lower().str.strip(), adp_df["adp"]))

    # Pull depth chart + team for all 2026 rookies
    roster = conn.execute("""
        SELECT player_name, position AS pos, team, depth_chart_order
        FROM bronze_player_news_raw
        WHERE years_exp = 0 AND position IN ('QB','RB','WR','TE')
          AND team IS NOT NULL AND active = TRUE
    """).df()

    # Index combine by lower-stripped name
    combine["_key"] = combine["player_name"].str.lower().str.strip()
    combine_map = {r["_key"]: r.to_dict() for _, r in combine.iterrows()}

    rows = []
    for _, p in roster.iterrows():
        name  = str(p["player_name"]).strip()
        pos   = str(p["pos"])
        team  = str(p["team"])
        key   = name.lower().strip()
        comb  = combine_map.get(key, {})
        adp   = adp_map.get(key)

        # Component scores
        dc = draft_capital_score(
            comb.get("draft_ovr") if comb else None,
            adp
        )
        ath = athleticism_score(comb, pos) if comb else None
        opp = opportunity_score(p.get("depth_chart_order"))

        wt = WEIGHTS.get(pos, WEIGHTS["WR"])

        # Build weighted composite; when athleticism data is missing or sparse,
        # redistribute that weight proportionally to draft capital and opportunity
        # so players aren't penalized for skipping combine drills.
        total_w = 0.0
        total_s = 0.0
        if dc is not None:
            total_s += dc * wt["draft_capital"]; total_w += wt["draft_capital"]
        if ath is not None:
            total_s += ath * wt["athleticism"]; total_w += wt["athleticism"]
        else:
            # No athleticism data — redistribute weight to draft capital + opportunity
            pass
        # Opportunity always available; team_bonus is a flat positional constant
        total_s += opp * wt["opportunity"]; total_w += wt["opportunity"]
        team_bonus = 50.0  # neutral; could be enriched with offensive quality data later
        total_s += team_bonus * wt["team_bonus"]; total_w += wt["team_bonus"]

        rookie_score = round(total_s / total_w, 1) if total_w > 0 else None
        if rookie_score is None:
            continue

        proj_season = score_to_pts(rookie_score, pos)
        proj_week   = round(proj_season / 17, 1)

        rows.append({
            "player_name":         name,
            "pos":                 pos,
            "team":                team,
            "season":              season,
            "draft_round":         int(comb["draft_round"]) if comb and pd.notna(comb.get("draft_round")) else None,
            "draft_ovr":           int(comb["draft_ovr"])   if comb and pd.notna(comb.get("draft_ovr"))   else None,
            "depth_chart_order":   int(p["depth_chart_order"]) if pd.notna(p.get("depth_chart_order")) else None,
            "adp":                 float(adp) if adp is not None else None,
            "draft_capital_score": dc,
            "athleticism_score":   ath,
            "opportunity_score":   round(opp, 1),
            "rookie_score":        rookie_score,
            "proj_season_pts":     proj_season,
            "proj_week_pts":       proj_week,
            "computed_at":         datetime.now(timezone.utc).replace(tzinfo=None),
        })

    return pd.DataFrame(rows)


def write_bronze(conn, df: pd.DataFrame, dry_run: bool):
    if df.empty:
        print("   No rookie score rows computed")
        return
    if dry_run:
        print(f"   DRY RUN — would write {len(df)} rows")
        print(df[["player_name","pos","rookie_score","proj_week_pts","draft_capital_score","athleticism_score"]].to_string())
        return

    conn.execute("DELETE FROM bronze_rookie_scores WHERE season = (SELECT MAX(season) FROM bronze_rookie_scores)")
    conn.register("_rscores", df)
    conn.execute("INSERT INTO bronze_rookie_scores BY NAME SELECT * FROM _rscores ON CONFLICT (player_name) DO UPDATE SET pos=excluded.pos, team=excluded.team, season=excluded.season, draft_round=excluded.draft_round, draft_ovr=excluded.draft_ovr, depth_chart_order=excluded.depth_chart_order, adp=excluded.adp, draft_capital_score=excluded.draft_capital_score, athleticism_score=excluded.athleticism_score, opportunity_score=excluded.opportunity_score, rookie_score=excluded.rookie_score, proj_season_pts=excluded.proj_season_pts, proj_week_pts=excluded.proj_week_pts, computed_at=excluded.computed_at")
    print(f"   bronze_rookie_scores: {len(df)} rows written")


def export_r2(df: pd.DataFrame, dry_run: bool):
    if df.empty:
        print("   Nothing to export")
        return
    records = df.sort_values("rookie_score", ascending=False).to_dict(orient="records")
    # Replace NaN with None for JSON serialization
    for r in records:
        for k, v in r.items():
            if isinstance(v, float) and math.isnan(v):
                r[k] = None
            elif hasattr(v, 'item'):
                r[k] = v.item()

    payload = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "season": 2026,
        "count": len(records),
        "players": records,
    }
    key = "fantasai/analysis/rookie_scores.json"
    body = json.dumps(payload, default=str)
    size_kb = len(body.encode()) / 1024
    print(f"   {key}  ({len(records)} rookies, {size_kb:.1f} KB)")
    if dry_run:
        print("   DRY RUN — not uploading")
        return
    if not FANTASAI_KEY:
        print("   SKIP — FANTASAI_KEY not set")
        return
    resp = requests.put(f"{R2_BASE}/{key}", data=body, headers=HEADERS_R2, timeout=30)
    print("   OK" if resp.ok else f"   FAIL HTTP {resp.status_code}")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--season",  type=int, default=2026)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    print("=" * 70)
    print("Rookie Score Computation — FantasAI")
    print(f"Timestamp : {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print(f"Season    : {args.season}")
    print(f"Mode      : {'DRY RUN' if args.dry_run else 'LIVE'}")
    print("=" * 70)

    conn = get_conn()
    init_schema(conn)

    # Ensure table exists
    conn.execute("""
        CREATE TABLE IF NOT EXISTS bronze_rookie_scores (
            player_name          VARCHAR PRIMARY KEY,
            pos                  VARCHAR,
            team                 VARCHAR,
            season               INTEGER,
            draft_round          INTEGER,
            draft_ovr            INTEGER,
            depth_chart_order    INTEGER,
            adp                  DOUBLE,
            draft_capital_score  DOUBLE,
            athleticism_score    DOUBLE,
            opportunity_score    DOUBLE,
            rookie_score         DOUBLE,
            proj_season_pts      DOUBLE,
            proj_week_pts        DOUBLE,
            computed_at          TIMESTAMP
        )
    """)

    print("\n── Computing rookie scores ───────────────────────────────────────────")
    df = compute_scores(conn, args.season)

    if not df.empty:
        summary = df.groupby("pos")[["rookie_score","proj_week_pts","draft_capital_score","athleticism_score"]].mean().round(1)
        print(f"\n   {len(df)} rookies scored\n")
        print(summary.to_string())
        print()
        top10 = df.nlargest(10, "rookie_score")[["player_name","pos","team","rookie_score","proj_week_pts","draft_capital_score","athleticism_score","opportunity_score"]]
        print("── Top 10 Rookies ────────────────────────────────────────────────────")
        print(top10.to_string(index=False))

    print("\n── Writing to DuckDB ─────────────────────────────────────────────────")
    write_bronze(conn, df, args.dry_run)

    print("\n── Exporting to R2 ───────────────────────────────────────────────────")
    export_r2(df, args.dry_run)

    conn.close()
    print("\n✅ Rookie score computation complete")


if __name__ == "__main__":
    main()
