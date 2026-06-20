"""
NFL Combine Data Ingestion — nflverse (nfl_data_py)

Fetches NFL Scouting Combine measurables for recent draft classes.
Used by:
  - Ghost picks builder (athletic score component)
  - Player profile pages (measurables display)
  - Future ML features (combine → production correlation)

Columns fetched: season, draft_year, draft_round, draft_ovr, player_name,
  pos, school, ht, wt, forty, bench, vertical, broad_jump, cone, shuttle

Outputs (DuckDB):
  bronze_combine_data — one row per combine participant per season

Outputs (R2):
  fantasai/analysis/combine_data.json — all recent seasons, sorted by draft_year desc

Usage:
  python ingest_combine.py                    # 2023,2024,2025
  python ingest_combine.py --seasons 2020,2021,2022,2023,2024,2025
  python ingest_combine.py --dry-run
  python ingest_combine.py --export-only
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
import ssl_utils  # noqa: F401 — must load before nfl_data_py fetches parquet
from db import get_conn, init_schema

try:
    from dotenv import load_dotenv
    load_dotenv(Path(__file__).parent.parent.parent / ".env")
except ImportError:
    pass

R2_BASE      = "https://api.fantasai.net/api/v1/r2"
FANTASAI_KEY = os.environ.get("FANTASAI_KEY", "")
HEADERS_R2   = {"X-FantasAI-Key": FANTASAI_KEY, "Content-Type": "application/json"}

DEFAULT_SEASONS = [2024, 2025, 2026]

SCHEMA_SQL = """
CREATE TABLE IF NOT EXISTS bronze_combine_data (
    player_name  VARCHAR,
    pos          VARCHAR,
    school       VARCHAR,
    season       INTEGER,
    draft_year   INTEGER,
    draft_team   VARCHAR,
    draft_round  INTEGER,
    draft_ovr    INTEGER,
    pfr_id       VARCHAR,
    ht           VARCHAR,
    wt           DOUBLE,
    forty        DOUBLE,
    bench        INTEGER,
    vertical     DOUBLE,
    broad_jump   INTEGER,
    cone         DOUBLE,
    shuttle      DOUBLE,
    ingested_at  TIMESTAMP,
    PRIMARY KEY (player_name, season)
);
"""


def ensure_schema(conn):
    for stmt in SCHEMA_SQL.split(";"):
        s = stmt.strip()
        if s:
            conn.execute(s)


def fetch_draft_picks(nfl, seasons: list[int]) -> pd.DataFrame:
    """Fetch draft round/pick/team from nflverse draft picks table and normalize columns."""
    try:
        picks = nfl.import_draft_picks(seasons)
        # Normalize whatever column names nflverse returns
        picks.columns = [c.lower().strip() for c in picks.columns]
        renames = {}
        for c in picks.columns:
            if c in ('round',):            renames[c] = 'draft_round'
            elif c in ('pick', 'overall'): renames[c] = 'draft_ovr'
            elif c in ('team', 'nfl_team', 'pfr_team', 'draft_team'): renames[c] = 'draft_team'
            elif 'player' in c and 'name' in c: renames[c] = 'player_name'
        picks = picks.rename(columns=renames)
        keep = [c for c in ('season', 'player_name', 'draft_round', 'draft_ovr', 'draft_team', 'pos', 'age', 'college') if c in picks.columns]
        picks = picks[keep].copy()
        picks['player_name'] = picks['player_name'].astype(str).str.strip()
        print(f"   Draft picks fetched: {len(picks)} rows")
        return picks
    except Exception as e:
        print(f"   Could not fetch draft picks ({e}) — draft_ovr/round will remain NULL")
        return pd.DataFrame()


def fetch_seasons(seasons: list[int]) -> pd.DataFrame:
    try:
        import nfl_data_py as nfl
    except ImportError:
        print("   ERROR: nfl_data_py not installed")
        sys.exit(1)

    print(f"   Fetching combine data for seasons {seasons}...")
    try:
        df = nfl.import_combine_data(seasons)
        print(f"   {len(df)} combine participants fetched")
    except Exception as e:
        print(f"   FAILED — {e}")
        return pd.DataFrame()

    # Merge real draft round/pick/team from draft picks table.
    # import_combine_data often has draft_ovr=NULL before nflverse links the draft results.
    picks = fetch_draft_picks(nfl, seasons)
    if not picks.empty and 'player_name' in picks.columns and 'draft_ovr' in picks.columns:
        df['player_name'] = df['player_name'].astype(str).str.strip()
        merge_cols = [c for c in ('season', 'player_name', 'draft_round', 'draft_ovr', 'draft_team') if c in picks.columns]
        picks_slim = picks[merge_cols].drop_duplicates(subset=['season', 'player_name'])
        df = df.merge(picks_slim, on=['season', 'player_name'], how='left', suffixes=('', '_pick'))
        for col in ('draft_round', 'draft_ovr', 'draft_team'):
            pick_col = f'{col}_pick'
            if pick_col in df.columns:
                df[col] = df[col].where(df[col].notna(), df[pick_col])
                df.drop(columns=[pick_col], inplace=True)
        filled = df['draft_ovr'].notna().sum()
        print(f"   Draft capital merged: {filled}/{len(df)} players have pick data")

    return df


def write_bronze(conn, df: pd.DataFrame, seasons: list[int], dry_run: bool):
    if df.empty:
        print("   No data to write")
        return
    if dry_run:
        print(f"   DRY RUN — would write {len(df)} rows")
        return

    now = datetime.now(timezone.utc).replace(tzinfo=None)

    rows = []
    for _, r in df.iterrows():
        season = int(r.get("season", 0)) if pd.notna(r.get("season")) else None
        if not season:
            continue
        rows.append({
            "player_name": str(r.get("player_name", "")),
            "pos":         str(r.get("pos", "")) if pd.notna(r.get("pos")) else None,
            "school":      str(r.get("school", "")) if pd.notna(r.get("school")) else None,
            "season":      season,
            "draft_year":  int(r["draft_year"]) if pd.notna(r.get("draft_year")) else None,
            "draft_team":  str(r["draft_team"]) if pd.notna(r.get("draft_team")) else None,
            "draft_round": int(r["draft_round"]) if pd.notna(r.get("draft_round")) else None,
            "draft_ovr":   int(r["draft_ovr"]) if pd.notna(r.get("draft_ovr")) else None,
            "pfr_id":      str(r["pfr_id"]) if pd.notna(r.get("pfr_id")) else None,
            "ht":          str(r["ht"]) if pd.notna(r.get("ht")) else None,
            "wt":          float(r["wt"]) if pd.notna(r.get("wt")) else None,
            "forty":       float(r["forty"]) if pd.notna(r.get("forty")) else None,
            "bench":       int(r["bench"]) if pd.notna(r.get("bench")) else None,
            "vertical":    float(r["vertical"]) if pd.notna(r.get("vertical")) else None,
            "broad_jump":  int(r["broad_jump"]) if pd.notna(r.get("broad_jump")) else None,
            "cone":        float(r["cone"]) if pd.notna(r.get("cone")) else None,
            "shuttle":     float(r["shuttle"]) if pd.notna(r.get("shuttle")) else None,
            "ingested_at": now,
        })

    if not rows:
        print("   No valid rows")
        return

    for s in seasons:
        conn.execute("DELETE FROM bronze_combine_data WHERE season = ?", [s])

    out = pd.DataFrame(rows).drop_duplicates(subset=["player_name", "season"], keep="first")
    conn.register("_combine", out)
    conn.execute("""
        INSERT INTO bronze_combine_data BY NAME SELECT * FROM _combine
        ON CONFLICT (player_name, season) DO UPDATE SET
            pos=excluded.pos, school=excluded.school, draft_year=excluded.draft_year,
            draft_team=excluded.draft_team, draft_round=excluded.draft_round,
            draft_ovr=excluded.draft_ovr, ht=excluded.ht, wt=excluded.wt,
            forty=excluded.forty, bench=excluded.bench, vertical=excluded.vertical,
            broad_jump=excluded.broad_jump, cone=excluded.cone, shuttle=excluded.shuttle,
            ingested_at=excluded.ingested_at
    """)
    print(f"   bronze_combine_data: {len(out)} rows written")


def export_to_r2(conn, dry_run: bool):
    rows = conn.execute("""
        SELECT player_name, pos, school, season, draft_year, draft_team,
               draft_round, draft_ovr, ht, wt, forty, bench, vertical,
               broad_jump, cone, shuttle
        FROM bronze_combine_data
        WHERE pos IN ('QB','RB','WR','TE','OL','DL','LB','DB','EDGE','K','P','LS','FB')
        ORDER BY draft_year DESC, draft_ovr ASC NULLS LAST
    """).df()

    if rows.empty:
        print("   No combine data — skipping R2 export")
        return

    payload = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "player_count": len(rows),
        "seasons":      sorted(rows["season"].dropna().astype(int).unique().tolist()),
        "players":      rows.to_dict(orient="records"),
    }

    key = "fantasai/analysis/combine_data.json"
    body = json.dumps(payload, default=str)
    size_kb = len(body.encode()) / 1024
    print(f"   {key}  ({len(rows)} players, {size_kb:.1f} KB)")
    if dry_run:
        print("      DRY RUN")
        return
    if not FANTASAI_KEY:
        print("      SKIP — FANTASAI_KEY not set")
        return
    try:
        resp = requests.put(
            f"{R2_BASE}/{key}", data=body, headers=HEADERS_R2, timeout=30
        )
        print("      OK" if resp.ok else f"      FAIL HTTP {resp.status_code}")
    except Exception as e:
        print(f"      ERROR {e}")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--seasons", type=str, default=None,
        help=f"Comma-separated seasons (default: {DEFAULT_SEASONS})"
    )
    parser.add_argument("--dry-run",     action="store_true")
    parser.add_argument("--export-only", action="store_true",
                        help="Skip fetch; re-export from existing DB data")
    args = parser.parse_args()

    seasons = (
        [int(s.strip()) for s in args.seasons.split(",")]
        if args.seasons else DEFAULT_SEASONS
    )

    print("=" * 70)
    print("NFL Combine Data Ingestion — nflverse")
    print(f"Timestamp: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print(f"Seasons:   {seasons}")
    print(f"Mode:      {'DRY RUN' if args.dry_run else 'LIVE'}")
    print("=" * 70)

    conn = get_conn()
    init_schema(conn)
    ensure_schema(conn)

    if not args.export_only:
        df = fetch_seasons(seasons)
        write_bronze(conn, df, seasons, args.dry_run)

    existing = conn.execute(
        "SELECT season, COUNT(*) FROM bronze_combine_data GROUP BY season ORDER BY season"
    ).fetchall()
    print("\nDB contents:")
    for s, c in existing:
        print(f"   {s}: {c} participants")

    print("\n── Exporting to R2 ───────────────────────────────────────────────────")
    export_to_r2(conn, args.dry_run)

    conn.close()
    print("\n✅ Combine ingestion complete")


if __name__ == "__main__":
    main()
