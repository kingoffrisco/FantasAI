"""
O-Line Rookie Score Computation — FantasAI 2026

Computes a 0-100 draft-capital score for offensive line rookies, using real
2026 NFL Draft results from nflverse (nfl_data_py.import_draft_picks). This
powers the player popup's O-Line Starters card: when a new starter is a
rookie with no prior team performance data to measure against (there's
nothing in team_oline_index to compare before his first real season), this
gives a real, pre-season signal instead of no signal at all.

Deliberately narrower than bronze_rookie_scores (the skill-position rookie
score, which blends draft capital + combine athleticism + opportunity):
O-line prospects have no fantasy production to calibrate an opportunity
score from, and nflverse's combine dataset hasn't published the 2026 class
yet (confirmed live 2026-09-01 — combine_data.json tops out at draft_year
2025). So this is just draft capital, using the identical pick-to-score
curve as draft_capital_score() in ingest_rookie_scores.py for consistency.

Outputs:
  DuckDB : player_oline_rookie_scores
  R2     : fantasai/analysis/oline_rookie_scores.json

Usage:
  python ingest_oline_rookie_scores.py
  python ingest_oline_rookie_scores.py --dry-run
  python ingest_oline_rookie_scores.py --season 2026
"""

import argparse
import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

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

OL_POSITIONS = {"OT", "OG", "C", "G", "T"}


def draft_capital_score(pick) -> float | None:
    """Identical curve to draft_capital_score() in ingest_rookie_scores.py:
    Pick 1=100, Pick 32~88, Pick 64~73, Pick 100~57, Pick 200~26, UDFA=0."""
    if pick is None:
        return None
    ratio = max(0.0, (263 - pick) / 262)
    return round(100.0 * ratio ** 0.55, 1)


def build_oline_rookie_scores(season: int):
    import nfl_data_py as nfl
    df = nfl.import_draft_picks([season])
    df = df[df["position"].isin(OL_POSITIONS)].copy()
    if df.empty:
        return df

    # A few late-round picks (esp. UDFA-adjacent) have no gsis_id assigned yet
    # in nflverse's draft data; the frontend matches by player_name anyway, so
    # drop them rather than fail the NOT NULL primary key on gsis_id.
    df = df[df["gsis_id"].notna()].copy()
    df["draft_capital_score"] = df["pick"].apply(draft_capital_score)
    df["season"] = season
    df["imported_at"] = datetime.now(timezone.utc).replace(tzinfo=None)
    out = df.rename(columns={
        "pfr_player_name": "player_name",
        "position": "pos",
        "round": "draft_round",
        "pick": "draft_ovr",
    })
    return out[["season", "gsis_id", "player_name", "pos", "team",
                "draft_round", "draft_ovr", "draft_capital_score", "imported_at"]]


def write_oline_rookie_scores(conn, df, dry_run: bool):
    if df.empty:
        print("   No O-line rookie rows to write"); return
    if dry_run:
        print(f"   DRY RUN — would write {len(df)} O-line rookie rows"); return
    for season in df["season"].unique().tolist():
        conn.execute("DELETE FROM player_oline_rookie_scores WHERE season = ?", [int(season)])
    conn.register("_ol_rookies", df)
    conn.execute("INSERT INTO player_oline_rookie_scores BY NAME SELECT * FROM _ol_rookies")
    print(f"   💾 player_oline_rookie_scores: {len(df):,} rows written")


def export_r2(conn, dry_run: bool):
    rows = conn.execute(
        "SELECT * FROM player_oline_rookie_scores ORDER BY season DESC, draft_ovr"
    ).df()
    if rows.empty:
        print("   No O-line rookie rows in DB — skipping export"); return

    players = []
    for _, r in rows.iterrows():
        players.append({
            "season":              int(r["season"]),
            "gsis_id":             r["gsis_id"],
            "player_name":         r["player_name"],
            "pos":                 r["pos"],
            "team":                r["team"],
            "draft_round":         int(r["draft_round"]) if r["draft_round"] == r["draft_round"] else None,
            "draft_ovr":           int(r["draft_ovr"]) if r["draft_ovr"] == r["draft_ovr"] else None,
            "draft_capital_score": r["draft_capital_score"],
        })

    payload = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "methodology": (
            "Draft-capital-only score for O-line rookies (no fantasy production or 2026 combine "
            "data exists to add athleticism/opportunity components, unlike skill-position rookie "
            "scores). Pick 1=100, Pick 32~88, Pick 64~73, Pick 100~57, Pick 200~26, UDFA=0."
        ),
        "players": players,
    }
    key = "fantasai/analysis/oline_rookie_scores.json"
    body = json.dumps(payload, default=str)
    size_kb = len(body.encode()) / 1024
    print(f"   {key}  ({len(players)} O-line rookies, {size_kb:.1f} KB)")
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
    parser.add_argument("--season", type=int, default=2026)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    print("=" * 70)
    print("O-Line Rookie Score Computation — FantasAI")
    print(f"Timestamp : {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print(f"Season    : {args.season}")
    print(f"Mode      : {'DRY RUN' if args.dry_run else 'LIVE'}")
    print("=" * 70)

    conn = get_conn()
    init_schema(conn)

    print("\n── Fetching real NFL draft picks (nflverse) ────────────────────────")
    df = build_oline_rookie_scores(args.season)
    print(f"   {len(df)} O-line rookies found")
    if not df.empty:
        print(df[["player_name", "pos", "team", "draft_round", "draft_ovr", "draft_capital_score"]].to_string(index=False))

    print("\n── Writing to DuckDB ────────────────────────────────────────────────")
    write_oline_rookie_scores(conn, df, args.dry_run)

    print("\n── Exporting to R2 ─────────────────────────────────────────────────")
    export_r2(conn, args.dry_run)

    conn.close()
    print("\n✅ O-Line Rookie Score computation complete")


if __name__ == "__main__":
    main()
