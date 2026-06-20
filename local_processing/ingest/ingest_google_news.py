"""
Google News RSS — Player News Ingestion
Replaces: notebooks/01_Ingestion/Bronze/Google News RSS Ingestion.ipynb

Fetches player-specific news from Google News RSS and stores to DuckDB.
Runs in incremental mode by default (last 7 days only).
Purges articles older than 60 days on every run.

Outputs:
  bronze_google_news  — appended, deduplicated by (article_id, player_id)

Usage:
  python ingest_google_news.py
  python ingest_google_news.py --mode historical   # all available articles
  python ingest_google_news.py --limit 50          # test with 50 players
  python ingest_google_news.py --dry-run
"""

import argparse
import email.utils
import hashlib
import sys
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib.parse import quote_plus
from typing import Optional

import feedparser
import pandas as pd

sys.path.insert(0, str(Path(__file__).parent.parent))
import ssl_utils  # noqa: F401
from db import get_conn, init_schema

GOOGLE_RSS_URL    = "https://news.google.com/rss/search"
RATE_LIMIT_SEC    = 0.05
REQUEST_TIMEOUT   = 10
INCREMENTAL_DAYS  = 7
RETENTION_DAYS    = 60
DEFAULT_TOP_N     = 300   # ADP top players + rookies + no-news fill


def get_players(conn, top_n: int = DEFAULT_TOP_N) -> pd.DataFrame:
    """
    Return prioritized player list for Google News fetch.

    Priority order (all tiers combined, deduped, capped at top_n):
      Tier 1 — ADP top 200 with NO news in last 7 days (must-cover gap)
      Tier 2 — Rookies with NO news in last 7 days
      Tier 3 — ADP top 200 (already have some news — refresh)
      Tier 4 — Remaining rookies + low-ownership high-upside players

    Falls back to alphabetical bronze list if ADP data not yet populated.
    """
    # Players with no Google news in the last 7 days
    no_recent_news_sql = """
        NOT EXISTS (
            SELECT 1 FROM bronze_google_news g
            WHERE g.player_id = p.player_id
              AND g.published_at >= NOW() - INTERVAL 7 DAY
        )
    """

    # Try ADP-ranked list first (requires ingest_adp.py to have run)
    has_adp = conn.execute(
        "SELECT COUNT(*) FROM bronze_adp_rankings"
    ).fetchone()[0] > 0

    # Check if watchlist table exists
    has_watchlist = conn.execute(
        "SELECT COUNT(*) FROM information_schema.tables WHERE table_name = 'watchlist'"
    ).fetchone()[0] > 0
    watchlist_join = """
        LEFT JOIN watchlist w ON LOWER(w.player_name) = LOWER(p.player_name)
    """ if has_watchlist else ""
    watchlist_col = "w.player_name IS NOT NULL" if has_watchlist else "FALSE"

    if has_adp:
        df = conn.execute(f"""
            WITH adp AS (
                SELECT player_name, MIN(adp_rank) AS adp_rank
                FROM bronze_adp_rankings
                WHERE format = 'PPR'
                GROUP BY player_name
            ),
            players AS (
                SELECT
                    p.player_id,
                    p.player_name,
                    p.position,
                    p.team,
                    COALESCE(p.years_exp, 1) AS years_exp,
                    a.adp_rank,
                    CASE WHEN {no_recent_news_sql} THEN 1 ELSE 0 END AS no_recent_news,
                    CASE WHEN {watchlist_col} THEN TRUE ELSE FALSE END AS on_watchlist
                FROM bronze_player_news_raw p
                LEFT JOIN adp a ON LOWER(a.player_name) = LOWER(p.player_name)
                {watchlist_join}
                WHERE p.position IN ('QB','RB','WR','TE')
                  AND p.player_name IS NOT NULL
                  AND p.active = TRUE
            )
            SELECT player_id, player_name, position, team,
                   adp_rank, years_exp, no_recent_news,
                   -- Priority: 0=watchlist, 1=top200 no news, 2=rookie no news,
                   --           3=top200 with news, 4=rookie, 5=rest
                   CASE
                     WHEN on_watchlist AND no_recent_news = 1  THEN 0
                     WHEN adp_rank <= 200 AND no_recent_news = 1 THEN 1
                     WHEN years_exp = 0   AND no_recent_news = 1 THEN 2
                     WHEN on_watchlist                            THEN 0
                     WHEN adp_rank <= 200                        THEN 3
                     WHEN years_exp = 0                          THEN 4
                     ELSE 5
                   END AS priority
            FROM players
            ORDER BY priority ASC,
                     CASE WHEN adp_rank IS NULL THEN 9999 ELSE adp_rank END ASC,
                     player_name ASC
            LIMIT ?
        """, [top_n]).df()

        # Log tier breakdown
        if not df.empty:
            for tier, label in [
                (0, "Watchlist (priority)"),
                (1, "ADP top-200, no recent news"),
                (2, "Rookies, no recent news"),
                (3, "ADP top-200 (refresh)"),
                (4, "Rookies (refresh)"),
                (5, "Other"),
            ]:
                n = len(df[df["priority"] == tier])
                if n:
                    print(f"   Tier {tier} ({label}): {n} players")
    else:
        # Fallback: alphabetical bronze list grouped by position
        df = conn.execute(f"""
            SELECT p.player_id, p.player_name, p.position, p.team,
                   NULL AS adp_rank,
                   COALESCE(p.years_exp, 1) AS years_exp,
                   CASE WHEN {no_recent_news_sql} THEN 1 ELSE 0 END AS no_recent_news,
                   CASE WHEN COALESCE(p.years_exp, 1) = 0 THEN 1 ELSE 2 END AS priority
            FROM bronze_player_news_raw p
            WHERE p.position IN ('QB','RB','WR','TE')
              AND p.player_name IS NOT NULL
              AND p.active = TRUE
            ORDER BY priority, no_recent_news DESC, p.player_name
            LIMIT ?
        """, [top_n]).df()
        print("   ADP data not available — using bronze fallback (run ingest_adp.py first)")

    print(f"   {len(df)} players selected  "
          f"({df['no_recent_news'].sum() if 'no_recent_news' in df.columns else '?'} with no recent news, "
          f"{len(df[df['years_exp'] == 0]) if 'years_exp' in df.columns else '?'} rookies)")
    return df[["player_id", "player_name", "position", "team"]]


def parse_rfc2822(ts_str: str) -> Optional[datetime]:
    if not ts_str:
        return None
    try:
        return email.utils.parsedate_to_datetime(ts_str).replace(tzinfo=None)
    except Exception:
        try:
            return datetime.fromisoformat(ts_str.replace("Z", "+00:00")).replace(tzinfo=None)
        except Exception:
            return None


def fetch_feed(player_name: str) -> list:
    query = quote_plus(f"{player_name} NFL")
    url   = f"{GOOGLE_RSS_URL}?q={query}"
    try:
        feed = feedparser.parse(url)
        return getattr(feed, "entries", [])
    except Exception:
        return []


def parse_entry(entry, player_id: str, player_name: str, position: str, team: str) -> Optional[dict]:
    try:
        title = entry.get("title", "")
        source = "Google News"
        if " - " in title:
            parts = title.rsplit(" - ", 1)
            title, source = parts[0], parts[1]

        link       = entry.get("link", "")
        article_id = hashlib.sha256(f"{title}{link}".encode()).hexdigest()[:16]
        published  = parse_rfc2822(entry.get("published", ""))

        return {
            "article_id":  article_id,
            "player_id":   player_id,
            "player_name": player_name,
            "position":    position,
            "team":        team,
            "title":       title,
            "description": entry.get("summary", entry.get("description", "")),
            "link":        link,
            "published_at": published,
            "source":      source,
            "fetched_at":  datetime.now(timezone.utc).replace(tzinfo=None),
        }
    except Exception:
        return None


def fetch_all(players_df: pd.DataFrame, mode: str, limit: Optional[int]) -> list[dict]:
    if limit:
        players_df = players_df.head(limit)

    cutoff = (datetime.now(timezone.utc) - timedelta(days=INCREMENTAL_DAYS)).replace(tzinfo=None) \
             if mode == "incremental" else None

    all_articles = []
    players_with_news = 0

    print(f"\n📡 Fetching Google News RSS for {len(players_df)} players ({mode} mode)…")
    for i, row in enumerate(players_df.itertuples(), 1):
        if i % 50 == 0:
            print(f"   … {i}/{len(players_df)} ({players_with_news} with news, {len(all_articles)} articles)")

        entries = fetch_feed(row.player_name)
        if entries:
            players_with_news += 1
            for entry in entries:
                parsed = parse_entry(entry, row.player_id, row.player_name,
                                     row.position, row.team)
                if not parsed:
                    continue
                if cutoff and parsed["published_at"] and parsed["published_at"] < cutoff:
                    continue
                all_articles.append(parsed)

        time.sleep(RATE_LIMIT_SEC)

    print(f"\n📊 Fetch results:")
    print(f"   Players processed:  {len(players_df)}")
    print(f"   Players with news:  {players_with_news}")
    print(f"   Total articles:     {len(all_articles):,}")
    return all_articles


def write_to_db(conn, articles: list[dict], dry_run: bool):
    if not articles:
        print("⚠️  No articles to write")
        return
    if dry_run:
        print("🔵 Dry-run — skipping DB write")
        return

    df = pd.DataFrame(articles)
    conn.register("_gnews", df)

    before = conn.execute("SELECT COUNT(*) FROM bronze_google_news").fetchone()[0]
    conn.execute("""
        INSERT INTO bronze_google_news
        SELECT n.*
        FROM _gnews n
        WHERE NOT EXISTS (
            SELECT 1 FROM bronze_google_news g
            WHERE g.article_id = n.article_id AND g.player_id = n.player_id
        )
    """)
    inserted = conn.execute("SELECT COUNT(*) FROM bronze_google_news").fetchone()[0] - before
    print(f"   bronze_google_news: +{inserted} new articles (skipped {len(df) - inserted} dupes)")

    # Purge old articles (INTERVAL doesn't support ? placeholder in DuckDB)
    before_purge = conn.execute("SELECT COUNT(*) FROM bronze_google_news").fetchone()[0]
    conn.execute(f"""
        DELETE FROM bronze_google_news
        WHERE published_at < NOW() - INTERVAL {RETENTION_DAYS} DAY
    """)
    purged = before_purge - conn.execute("SELECT COUNT(*) FROM bronze_google_news").fetchone()[0]
    if purged:
        print(f"   Purged {purged} articles older than {RETENTION_DAYS} days")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--mode",    choices=["incremental", "historical"], default="incremental")
    parser.add_argument("--limit",   type=int, default=None,
                        help="Cap articles fetched per run (for testing)")
    parser.add_argument("--top-n",   type=int, default=DEFAULT_TOP_N,
                        help=f"Total players to fetch news for (default: {DEFAULT_TOP_N})")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    print("=" * 70)
    print("Google News RSS — Player News Ingestion")
    print(f"Timestamp: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print("=" * 70)

    conn = get_conn()
    init_schema(conn)

    players_df = get_players(conn, top_n=args.top_n)
    if players_df.empty:
        print("⚠️  No players found. Run ingest_sleeper_players.py first.")
        conn.close()
        sys.exit(0)

    articles = fetch_all(players_df, args.mode, args.limit)
    write_to_db(conn, articles, args.dry_run)
    conn.close()

    print("\n✅ Google News ingestion complete")


if __name__ == "__main__":
    main()
