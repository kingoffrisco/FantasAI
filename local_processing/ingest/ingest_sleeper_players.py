"""
Sleeper API — Player News Ingestion
Replaces: notebooks/01_Ingestion/Bronze/Player_News_Ingestion_Sleeper_API.ipynb

Fetches all NFL players + trending adds from Sleeper's free public API and
stores them in DuckDB (bronze + silver layers).

Outputs:
  bronze_player_news_raw      — all players, full payload
  silver_player_news          — players with news updated in last 7 days
  silver_injury_reports       — players with active injury status
  silver_trending_players     — top 100 trending waiver adds (24h)

Usage:
  python ingest_sleeper_players.py
  python ingest_sleeper_players.py --dry-run
"""

import argparse
import json
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

import requests
import pandas as pd

sys.path.insert(0, str(Path(__file__).parent.parent))
import ssl_utils  # noqa: F401 — injects Windows cert store
from db import get_conn, init_schema

PLAYERS_URL  = "https://api.sleeper.app/v1/players/nfl"
TRENDING_URL = "https://api.sleeper.app/v1/players/nfl/trending/add?lookback_hours=24&limit=100"
RELEVANT_POSITIONS = {"QB", "RB", "WR", "TE", "K", "DEF"}
NEWS_LOOKBACK_DAYS = 7


def fetch_players() -> dict:
    print(f"📡 Fetching all NFL players from Sleeper…")
    r = requests.get(PLAYERS_URL, timeout=30)
    r.raise_for_status()
    data = r.json()
    print(f"   ✅ {len(data):,} players returned")
    return data


def fetch_trending() -> list:
    print(f"📡 Fetching trending adds (24h)…")
    r = requests.get(TRENDING_URL, timeout=30)
    r.raise_for_status()
    data = r.json()
    print(f"   ✅ {len(data)} trending players")
    return data


def build_players_df(raw: dict) -> pd.DataFrame:
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    rows = []
    for pid, p in raw.items():
        if p.get("position") not in RELEVANT_POSITIONS:
            continue
        rows.append({
            "player_id":            pid,
            "player_name":          (p.get("full_name") or
                                     f"{p.get('first_name','')} {p.get('last_name','')}").strip(),
            "first_name":           p.get("first_name"),
            "last_name":            p.get("last_name"),
            "position":             p.get("position"),
            "team":                 p.get("team"),
            "status":               p.get("status"),
            "injury_status":        p.get("injury_status"),
            "injury_body_part":     p.get("injury_body_part"),
            "injury_notes":         p.get("injury_notes"),
            "injury_start_date":    p.get("injury_start_date"),
            "years_exp":            p.get("years_exp"),
            "active":               bool(p.get("active", True)),
            "age":                  p.get("age"),
            "number":               str(p.get("number")) if p.get("number") is not None else None,
            "depth_chart_order":    p.get("depth_chart_order"),
            "depth_chart_position": p.get("depth_chart_position"),
            "news_updated":         p.get("news_updated"),   # Unix ms timestamp
            "fantasy_positions":    ",".join(p.get("fantasy_positions") or []) or None,
            "espn_id":              str(p["espn_id"]) if p.get("espn_id") else None,
            "fetched_at":           now,
            "raw_data":             json.dumps(p),
        })
    df = pd.DataFrame(rows)
    print(f"   ✅ {len(df):,} skill-position players parsed")
    return df


def build_silver_news(df: pd.DataFrame) -> pd.DataFrame:
    cutoff_ms = (datetime.now(timezone.utc) - timedelta(days=NEWS_LOOKBACK_DAYS)).timestamp() * 1000
    news_df = df[df["news_updated"].notna() & (df["news_updated"] >= cutoff_ms)].copy()
    news_df["news_updated"] = pd.to_datetime(news_df["news_updated"], unit="ms", utc=True).dt.tz_localize(None)
    return news_df[[
        "player_id", "player_name", "position", "team",
        "news_updated", "injury_status", "injury_notes",
        "status", "depth_chart_order", "depth_chart_position", "fetched_at"
    ]]


def build_injuries(df: pd.DataFrame) -> pd.DataFrame:
    inj = df[df["injury_status"].notna()].copy()
    return inj[[
        "player_id", "player_name", "position", "team",
        "injury_status", "injury_body_part", "injury_notes",
        "injury_start_date", "fetched_at"
    ]]


def build_trending(raw_trending: list, players_df: pd.DataFrame) -> pd.DataFrame:
    if not raw_trending:
        return pd.DataFrame()
    trend_df = pd.DataFrame(raw_trending)           # player_id, count
    trend_df = trend_df.merge(
        players_df[["player_id", "player_name", "position", "team"]],
        on="player_id", how="left"
    )
    trend_df["fetched_at"] = datetime.now(timezone.utc).replace(tzinfo=None)
    return trend_df[["player_id", "count", "player_name", "position", "team", "fetched_at"]]


def write_to_db(conn, df_raw, df_news, df_injuries, df_trending, dry_run: bool):
    if dry_run:
        print("🔵 Dry-run — skipping DB writes")
        return

    # bronze_player_news_raw — full replace (Sleeper is source of truth)
    conn.execute("DELETE FROM bronze_player_news_raw")
    conn.register("_raw", df_raw)
    conn.execute("INSERT INTO bronze_player_news_raw SELECT * FROM _raw")
    print(f"   💾 bronze_player_news_raw: {len(df_raw):,} rows (full refresh)")

    # silver_player_news — full replace
    conn.execute("DELETE FROM silver_player_news")
    if not df_news.empty:
        conn.register("_news", df_news)
        conn.execute("INSERT INTO silver_player_news SELECT * FROM _news")
    print(f"   💾 silver_player_news: {len(df_news):,} rows")

    # silver_injury_reports — full replace
    conn.execute("DELETE FROM silver_injury_reports")
    if not df_injuries.empty:
        conn.register("_inj", df_injuries)
        conn.execute("INSERT INTO silver_injury_reports SELECT * FROM _inj")
    print(f"   💾 silver_injury_reports: {len(df_injuries):,} rows")

    # silver_trending_players — full replace
    conn.execute("DELETE FROM silver_trending_players")
    if not df_trending.empty:
        conn.register("_trend", df_trending)
        conn.execute("INSERT INTO silver_trending_players SELECT * FROM _trend")
    print(f"   💾 silver_trending_players: {len(df_trending):,} rows")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    print("=" * 70)
    print("Sleeper API — Player News Ingestion")
    print(f"Timestamp: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print("=" * 70)

    raw_players   = fetch_players()
    raw_trending  = fetch_trending()

    df_raw      = build_players_df(raw_players)
    df_news     = build_silver_news(df_raw)
    df_injuries = build_injuries(df_raw)
    df_trending = build_trending(raw_trending, df_raw)

    print(f"\n📊 Summary:")
    print(f"   All players:        {len(df_raw):,}")
    print(f"   With recent news:   {len(df_news):,}")
    print(f"   With injuries:      {len(df_injuries):,}")
    print(f"   Trending adds:      {len(df_trending):,}")

    injury_counts = df_injuries["injury_status"].value_counts().to_dict() if not df_injuries.empty else {}
    for status, cnt in sorted(injury_counts.items(), key=lambda x: -x[1]):
        print(f"     {status}: {cnt}")

    conn = get_conn()
    init_schema(conn)
    write_to_db(conn, df_raw, df_news, df_injuries, df_trending, args.dry_run)
    conn.close()

    print("\n✅ Sleeper ingestion complete")


if __name__ == "__main__":
    main()
