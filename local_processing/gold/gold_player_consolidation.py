"""
Gold Layer — Player Consolidation
Replaces: notebooks/01_Ingestion/Gold/Gold Layer - Player Consolidation.ipynb

Consolidates player data from all bronze/silver sources into:
  gold_player_dim        — master player registry (one row per player)
  gold_player_id_mapping — cross-reference of source IDs → master IDs
  gold_weekly_stats      — silver_weekly_stats joined to master player IDs

Matching strategy: normalized player name (uppercase, suffixes stripped).
master_player_id = SHA-256 of normalized name (deterministic).

Usage:
  python gold_player_consolidation.py
  python gold_player_consolidation.py --dry-run
"""

import argparse
import hashlib
import json
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

import pandas as pd

sys.path.insert(0, str(Path(__file__).parent.parent))
import ssl_utils  # noqa: F401
from db import get_conn, init_schema

POSITION_PRIORITY = {"QB": 5, "RB": 5, "WR": 5, "TE": 5, "K": 4, "DEF": 4}


def normalize_name(name: str) -> str:
    if not name or name.strip().upper() in ("UNKNOWN", ""):
        return "UNKNOWN"
    name = name.upper().strip()
    for suffix in (" JR.", " SR.", " III", " II", " IV", " V"):
        name = name.replace(suffix, "")
    name = re.sub(r"[.,']", "", name)
    return re.sub(r"\s+", " ", name).strip()


def master_id(normalized: str) -> str:
    return hashlib.sha256(normalized.encode()).hexdigest()


def extract_player_meta(stats_json: str, source: str) -> tuple[str, str, str]:
    """Return (player_name, position, team) from JSON stats blob."""
    try:
        s = json.loads(stats_json)
        name = s.get("player_name") or s.get("full_name") or s.get("name") or "Unknown"
        pos  = s.get("position") or s.get("pos") or "UNK"
        team = s.get("team") or s.get("team_abbr") or "UNK"
        return name, pos, team
    except Exception:
        return "Unknown", "UNK", "UNK"


# ── Step 1: Build enriched player table ───────────────────────────────────────

def build_enriched(conn) -> pd.DataFrame:
    """Extract player metadata from silver_weekly_stats + bronze_player_news_raw (Sleeper)."""
    print("📥 Loading player sources…")
    stats_df = conn.execute("SELECT player_id, source, season, week, fantasy_points, stats, ingested_at FROM silver_weekly_stats").df()

    # Always pull Sleeper bronze — it's the fastest and most complete player list
    sleeper = conn.execute("""
        SELECT player_id, player_name, position, team,
               NULL AS headshot_url,
               'sleeper' AS source
        FROM bronze_player_news_raw
        WHERE player_name IS NOT NULL
    """).df()

    if stats_df.empty and sleeper.empty:
        print("   ⚠️  No player data found — run ingestion scripts first")
        return pd.DataFrame()

    if stats_df.empty:
        print(f"   silver_weekly_stats empty — building from Sleeper only ({len(sleeper):,} players)")
    else:
        print(f"   silver_weekly_stats: {len(stats_df):,} rows | Sleeper: {len(sleeper):,} players")

    df = stats_df

    # Parse stats JSON to extract player metadata
    rows = []
    for _, r in df.iterrows():
        name, pos, team = extract_player_meta(r["stats"], r["source"])
        headshot = None
        try:
            s = json.loads(r["stats"])
            headshot = s.get("headshot_url")
        except Exception:
            pass
        rows.append({
            "player_id":   r["player_id"],
            "source":      r["source"],
            "player_name": name,
            "position":    pos,
            "team":        team,
            "headshot_url": headshot,
        })

    stats_meta = pd.DataFrame(rows)

    # Supplement with Sleeper data
    all_players = pd.concat([stats_meta, sleeper], ignore_index=True)
    all_players = all_players[all_players["player_name"].notna() &
                               (all_players["player_name"] != "Unknown")]

    print(f"   ✅ {len(all_players):,} player-source records loaded")
    return all_players


# ── Step 2: Build gold_player_dim ─────────────────────────────────────────────

def build_player_dim(all_players: pd.DataFrame) -> pd.DataFrame:
    if all_players.empty:
        return pd.DataFrame()

    all_players["player_name_normalized"] = all_players["player_name"].map(normalize_name)
    all_players["pos_priority"] = all_players["position"].map(lambda p: POSITION_PRIORITY.get(p, 1))

    # Group by normalized name; pick best position and most recent headshot
    dim_rows = []
    for norm_name, grp in all_players.groupby("player_name_normalized"):
        best = grp.sort_values("pos_priority", ascending=False).iloc[0]
        headshot = grp["headshot_url"].dropna().iloc[0] if grp["headshot_url"].notna().any() else None
        sources  = sorted(grp["source"].dropna().unique().tolist())
        dim_rows.append({
            "master_player_id":       master_id(norm_name),
            "display_name":           best["player_name"],
            "player_name_normalized": norm_name,
            "position":               best["position"],
            "current_team":           best["team"],
            "headshot_url":           headshot,
            "sources":                sources,
            "source_count":           len(grp),
            "created_at":             datetime.now(timezone.utc).replace(tzinfo=None),
        })

    dim = pd.DataFrame(dim_rows)
    print(f"   ✅ gold_player_dim: {len(dim):,} unique players")
    return dim


# ── Step 3: Build gold_player_id_mapping ──────────────────────────────────────

def build_id_mapping(all_players: pd.DataFrame, dim: pd.DataFrame) -> pd.DataFrame:
    if all_players.empty or dim.empty:
        return pd.DataFrame()

    all_players["player_name_normalized"] = all_players["player_name"].map(normalize_name)
    mapping = all_players.merge(
        dim[["master_player_id", "player_name_normalized"]],
        on="player_name_normalized", how="left"
    )
    mapping = mapping[mapping["master_player_id"].notna()].copy()
    mapping["created_at"] = datetime.now(timezone.utc).replace(tzinfo=None)
    mapping = mapping.rename(columns={"player_id": "source_player_id", "player_name": "source_player_name"})
    mapping = mapping[[
        "master_player_id", "source", "source_player_id",
        "source_player_name", "position", "team", "created_at"
    ]].drop_duplicates(subset=["source", "source_player_id"])

    print(f"   ✅ gold_player_id_mapping: {len(mapping):,} mappings")
    return mapping


# ── Step 4: Build gold_weekly_stats ───────────────────────────────────────────

def build_gold_stats(conn, mapping: pd.DataFrame) -> pd.DataFrame:
    if mapping.empty:
        return pd.DataFrame()

    silver = conn.execute("""
        SELECT player_id, source, season, week, fantasy_points, stats,
               player_name, position, team, ingested_at,
               receiving_yards_after_catch, passing_yards_after_catch, headshot_url
        FROM silver_weekly_stats
    """).df()

    if silver.empty:
        return pd.DataFrame()

    mapping_subset = mapping[["master_player_id", "source", "source_player_id"]].rename(
        columns={"source_player_id": "player_id"}
    )
    gold = silver.merge(mapping_subset, on=["player_id", "source"], how="left")
    gold = gold[gold["master_player_id"].notna()].copy()
    gold = gold.rename(columns={"player_id": "source_player_id"})

    print(f"   ✅ gold_weekly_stats: {len(gold):,} records")
    return gold


# ── Write ──────────────────────────────────────────────────────────────────────

def write_all(conn, dim: pd.DataFrame, mapping: pd.DataFrame, gold_stats: pd.DataFrame, dry_run: bool):
    if dry_run:
        print("🔵 Dry-run — skipping DB writes")
        return

    if not dim.empty:
        conn.execute("DELETE FROM gold_player_dim")
        conn.register("_dim", dim)
        conn.execute("INSERT INTO gold_player_dim SELECT * FROM _dim")
        print(f"   💾 gold_player_dim: {len(dim):,} rows")

    if not mapping.empty:
        conn.execute("DELETE FROM gold_player_id_mapping")
        conn.register("_map", mapping)
        conn.execute("INSERT INTO gold_player_id_mapping SELECT * FROM _map")
        print(f"   💾 gold_player_id_mapping: {len(mapping):,} rows")

    if not gold_stats.empty:
        conn.execute("DELETE FROM gold_weekly_stats")
        conn.register("_gold", gold_stats)
        conn.execute("INSERT INTO gold_weekly_stats BY NAME SELECT * FROM _gold")
        print(f"   💾 gold_weekly_stats: {len(gold_stats):,} rows")


# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    print("=" * 70)
    print("Gold Layer — Player Consolidation")
    print(f"Timestamp: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print("=" * 70)

    conn = get_conn()
    init_schema(conn)

    all_players = build_enriched(conn)
    if all_players.empty:
        print("⚠️  No player data to consolidate. Run ingestion scripts first.")
        conn.close()
        return

    dim        = build_player_dim(all_players)
    mapping    = build_id_mapping(all_players, dim)
    gold_stats = build_gold_stats(conn, mapping)

    write_all(conn, dim, mapping, gold_stats, args.dry_run)
    conn.close()

    print("\n✅ Gold consolidation complete")


if __name__ == "__main__":
    main()
