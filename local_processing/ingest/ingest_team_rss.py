"""
Team News Ingestion — Tier 2/3 player coverage

Fetches team-level news from ESPN's public API and maps articles
to players by name matching. Covers players outside the Google News
top 200 (rookies, IR stashes, deep sleepers, watchlist players).

Outputs:
  bronze_team_rss_news — deduplicated by article_id

Usage:
  python ingest_team_rss.py
  python ingest_team_rss.py --dry-run
  python ingest_team_rss.py --team DET      # single team
"""

import argparse
import hashlib
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

import requests
import pandas as pd

sys.path.insert(0, str(Path(__file__).parent.parent))
import ssl_utils  # noqa: F401
from db import get_conn, init_schema

RATE_LIMIT_SEC = 0.3
ESPN_TEAM_API = "https://site.api.espn.com/apis/site/v2/sports/football/nfl/news"

TEAMS = [
    "ARI", "ATL", "BAL", "BUF", "CAR", "CHI", "CIN", "CLE",
    "DAL", "DEN", "DET", "GB", "HOU", "IND", "JAX", "KC",
    "LAC", "LAR", "LV", "MIA", "MIN", "NE", "NO", "NYG",
    "NYJ", "PHI", "PIT", "SEA", "SF", "TB", "TEN", "WAS",
]

ESPN_ABBR_MAP = {"WSH": "WAS", "JAX": "JAX", "LAR": "LAR"}


def espn_abbr(a):
    return ESPN_ABBR_MAP.get(a, a)


TEAM_FULL_NAMES = {
    'ARI': 'Cardinals', 'ATL': 'Falcons', 'BAL': 'Ravens', 'BUF': 'Bills',
    'CAR': 'Panthers', 'CHI': 'Bears', 'CIN': 'Bengals', 'CLE': 'Browns',
    'DAL': 'Cowboys', 'DEN': 'Broncos', 'DET': 'Lions', 'GB': 'Packers',
    'HOU': 'Texans', 'IND': 'Colts', 'JAX': 'Jaguars', 'KC': 'Chiefs',
    'LAC': 'Chargers', 'LAR': 'Rams', 'LV': 'Raiders', 'MIA': 'Dolphins',
    'MIN': 'Vikings', 'NE': 'Patriots', 'NO': 'Saints', 'NYG': 'Giants',
    'NYJ': 'Jets', 'PHI': 'Eagles', 'PIT': 'Steelers', 'SEA': 'Seahawks',
    'SF': '49ers', 'TB': 'Buccaneers', 'TEN': 'Titans', 'WAS': 'Commanders',
}

def build_player_lookup(conn):
    rows = conn.execute("""
        SELECT player_id, player_name, position, team
        FROM bronze_player_news_raw
        WHERE position IN ('QB','RB','WR','TE','K')
          AND player_name IS NOT NULL AND active = TRUE
    """).fetchall()
    lookup = {}
    for pid, name, pos, team in rows:
        key = name.lower().strip()
        lookup[key] = (pid, name, pos, team)
    for abbr, mascot in TEAM_FULL_NAMES.items():
        dst_name = f"{abbr} D/ST"
        lookup[f"{mascot.lower()} defense"] = (f"DST_{abbr}", dst_name, 'DST', abbr)
        lookup[f"{mascot.lower()} d/st"] = (f"DST_{abbr}", dst_name, 'DST', abbr)
    return lookup


def match_players_in_text(text, team, player_lookup):
    """Find all player name matches in text, filtered to team."""
    text_lower = text.lower()
    best = None
    best_len = 0
    for key, (pid, name, pos, pteam) in player_lookup.items():
        if len(key) < 5:
            continue
        if pteam and pteam.upper() != team.upper():
            continue
        if key in text_lower and len(key) > best_len:
            best = (pid, name, pos)
            best_len = len(key)
    return best


def fetch_team_news(conn, teams=None, dry_run=False):
    player_lookup = build_player_lookup(conn)
    now = datetime.now(timezone.utc)
    rows = []
    teams_to_fetch = teams if teams else TEAMS

    for team in teams_to_fetch:
        espn_team = team.lower()
        if team == "WAS":
            espn_team = "wsh"
        try:
            url = f"{ESPN_TEAM_API}?team={espn_team}&limit=20"
            resp = requests.get(url, timeout=15, verify=False)
            if not resp.ok:
                print(f"  {team}: HTTP {resp.status_code}")
                continue
            data = resp.json()
            articles = data.get("articles", [])
            matched_count = 0
            for art in articles:
                headline = art.get("headline", "")
                desc = art.get("description", "")
                link = art.get("links", {}).get("web", {}).get("href", "")
                if not link and art.get("links", {}).get("api"):
                    link = art["links"]["api"].get("news", {}).get("href", "")
                pub_str = art.get("published", "")
                try:
                    pub_dt = datetime.fromisoformat(pub_str.replace("Z", "+00:00")).replace(tzinfo=None) if pub_str else now.replace(tzinfo=None)
                except Exception:
                    pub_dt = now.replace(tzinfo=None)

                article_id = hashlib.sha256(
                    f"{link}:{headline}".encode()
                ).hexdigest()[:16]

                match = match_players_in_text(
                    f"{headline} {desc}", team, player_lookup
                )

                rows.append({
                    "article_id": article_id,
                    "team": team,
                    "title": headline[:500],
                    "link": link,
                    "description": (desc or "")[:1000],
                    "player_id": match[0] if match else None,
                    "player_name": match[1] if match else None,
                    "position": match[2] if match else None,
                    "published_at": pub_dt,
                    "fetched_at": now.replace(tzinfo=None),
                    "source_feed": f"espn-team-{team.lower()}",
                })
                if match:
                    matched_count += 1

            print(f"  {team}: {len(articles)} articles, {matched_count} matched to players")
        except Exception as e:
            print(f"  {team}: ERROR — {e}")
        time.sleep(RATE_LIMIT_SEC)

    if not rows:
        print("  No articles fetched")
        return

    df = pd.DataFrame(rows)
    matched = df[df["player_name"].notna()]
    print(f"\n  Total: {len(df)} articles, {len(matched)} matched to players")

    if dry_run:
        print("  DRY RUN — not writing to DuckDB")
        if len(matched):
            print(matched[["team", "player_name", "position", "title"]].head(20).to_string(index=False))
        return

    conn.register("_rss", df)
    conn.execute("""
        INSERT OR REPLACE INTO bronze_team_rss_news
        SELECT * FROM _rss
    """)
    conn.unregister("_rss")
    total = conn.execute("SELECT COUNT(*) FROM bronze_team_rss_news").fetchone()[0]
    print(f"  bronze_team_rss_news: {len(df)} upserted, {total} total")


def main():
    parser = argparse.ArgumentParser(description="Team RSS news ingestion")
    parser.add_argument("--team", type=str, default=None, help="Single team (e.g. DET)")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    conn = get_conn()
    init_schema(conn)

    print("\n── Team News Ingestion (ESPN API) ────────────────────────────────────")
    teams = [args.team.upper()] if args.team else None
    fetch_team_news(conn, teams=teams, dry_run=args.dry_run)

    conn.close()


if __name__ == "__main__":
    main()
