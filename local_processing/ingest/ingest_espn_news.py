"""
ESPN News API — Player News Ingestion
Replaces: notebooks/01_Ingestion/Bronze/ESPN News API Ingestion.ipynb

Fetches news articles for NFL players from ESPN's free site API.
ESPN player IDs are sourced from the espn_id field stored in
bronze_player_news_raw (populated by ingest_sleeper_players.py).

Outputs:
  bronze_player_news_espn_api  — appended, deduplicated by (article_id, player_id)

Usage:
  python ingest_espn_news.py
  python ingest_espn_news.py --limit 50   # test with 50 players
  python ingest_espn_news.py --dry-run
"""

import argparse
import hashlib
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

import requests
import pandas as pd

sys.path.insert(0, str(Path(__file__).parent.parent))
import ssl_utils  # noqa: F401
from db import get_conn, init_schema

ESPN_NEWS_URL   = "https://site.api.espn.com/apis/site/v2/sports/football/nfl/news"
RATE_LIMIT_SEC  = 0.1
REQUEST_TIMEOUT = 10


def get_players_with_espn_ids(conn) -> pd.DataFrame:
    """Return players that have ESPN IDs from Sleeper bronze data."""
    df = conn.execute("""
        SELECT player_id, player_name, position, team, espn_id
        FROM bronze_player_news_raw
        WHERE espn_id IS NOT NULL AND espn_id != '' AND espn_id != '0'
        ORDER BY player_name
    """).df()
    print(f"   ✅ {len(df):,} players with ESPN IDs in DB")
    return df


def fetch_articles_for_player(espn_id: str) -> Optional[list]:
    try:
        r = requests.get(ESPN_NEWS_URL, params={"player": espn_id}, timeout=REQUEST_TIMEOUT)
        if r.status_code == 200:
            return r.json().get("articles", [])
        return None
    except Exception:
        return None


def parse_article(article: dict, player_id: str, espn_id: str, player_name: str) -> Optional[dict]:
    try:
        links  = article.get("links", {})
        images = article.get("images", [])
        categories = [c.get("description", "") for c in article.get("categories", []) if "description" in c]

        return {
            "article_id":     str(article.get("id", "")),
            "player_id":      player_id,
            "espn_player_id": espn_id,
            "player_name":    player_name,
            "headline":       article.get("headline", ""),
            "description":    article.get("description", ""),
            "article_type":   article.get("type", ""),
            "published_at":   article.get("published"),
            "last_modified":  article.get("lastModified"),
            "article_url":    links.get("web", {}).get("href"),
            "image_url":      images[0].get("url") if images else None,
            "categories":     categories,
            "fetched_at":     datetime.now(timezone.utc).replace(tzinfo=None),
        }
    except Exception:
        return None


def fetch_all(players_df: pd.DataFrame, limit: Optional[int]) -> list[dict]:
    if limit:
        players_df = players_df.head(limit)

    all_articles = []
    players_with_news = 0
    errors = 0

    print(f"\n📡 Fetching ESPN news for {len(players_df):,} players…")
    for i, row in enumerate(players_df.itertuples(), 1):
        if i % 100 == 0:
            print(f"   … {i}/{len(players_df)} ({players_with_news} with news, {len(all_articles)} articles)")

        articles = fetch_articles_for_player(row.espn_id)
        if articles:
            players_with_news += 1
            for art in articles:
                parsed = parse_article(art, row.player_id, row.espn_id, row.player_name)
                if parsed and parsed["article_id"]:
                    all_articles.append(parsed)
                else:
                    errors += 1
        time.sleep(RATE_LIMIT_SEC)

    print(f"\n📊 Fetch results:")
    print(f"   Players processed: {len(players_df):,}")
    print(f"   Players with news: {players_with_news:,}")
    print(f"   Total articles:    {len(all_articles):,}")
    print(f"   Errors:            {errors}")
    return all_articles


def write_to_db(conn, articles: list[dict], dry_run: bool):
    if not articles:
        print("⚠️  No articles to write")
        return
    if dry_run:
        print("🔵 Dry-run — skipping DB write")
        return

    df = pd.DataFrame(articles)
    df["published_at"]  = pd.to_datetime(df["published_at"],  errors="coerce", utc=True).dt.tz_localize(None)
    df["last_modified"] = pd.to_datetime(df["last_modified"], errors="coerce", utc=True).dt.tz_localize(None)

    conn.register("_espn_new", df)

    # Insert only rows not already in the table
    before = conn.execute("SELECT COUNT(*) FROM bronze_player_news_espn_api").fetchone()[0]
    conn.execute("""
        INSERT INTO bronze_player_news_espn_api
        SELECT n.*
        FROM _espn_new n
        WHERE NOT EXISTS (
            SELECT 1 FROM bronze_player_news_espn_api e
            WHERE e.article_id = n.article_id AND e.player_id = n.player_id
        )
    """)
    inserted = conn.execute("SELECT COUNT(*) FROM bronze_player_news_espn_api").fetchone()[0] - before

    print(f"   bronze_player_news_espn_api: +{inserted} new articles (skipped {len(df) - inserted} dupes)")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--limit",   type=int, default=None, help="Cap number of players (for testing)")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    print("=" * 70)
    print("ESPN News API — Player News Ingestion")
    print(f"Timestamp: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print("=" * 70)

    conn = get_conn()
    init_schema(conn)

    players_df = get_players_with_espn_ids(conn)
    if players_df.empty:
        print("⚠️  No players with ESPN IDs found. Run ingest_sleeper_players.py first.")
        conn.close()
        sys.exit(0)

    articles = fetch_all(players_df, args.limit)
    write_to_db(conn, articles, args.dry_run)
    conn.close()

    print("\n✅ ESPN news ingestion complete")


if __name__ == "__main__":
    main()
