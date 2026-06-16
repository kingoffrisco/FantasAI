"""
Sleeper Ownership Ingestion — Public League Sampling
Replaces: notebooks/01_Ingestion/Bronze/Sleeper Ownership - Public Leagues.ipynb

Discovers ~500 public Sleeper leagues by crawling from seed usernames,
then counts how many leagues each player appears on a roster.

Result: realistic ownership % per player, usable for:
  - Identifying low-ownership high-value waiver targets
  - Improving sleeper pick recommendations (job2_fantasy_analyzer.py)
  - Frontend display of ownership context

Strategy:
  1. Seed phase: resolve ~50 common usernames → user_ids → leagues
  2. Expansion: from each league's rosters, collect owner_ids → more leagues
  3. Crawl until TARGET_LEAGUES reached or no more to discover
  4. Count per-player roster appearances → ownership_pct

Free API: Sleeper public API — no key required, 1,000 req/day generous limit.

Outputs (DuckDB):
  bronze_player_ownership — player_id, ownership_pct, leagues_sampled

Outputs (R2):
  fantasai/analysis/player_ownership.json — top 500 players by ownership %

Usage:
  python ingest_ownership.py
  python ingest_ownership.py --target 300    # smaller sample, faster
  python ingest_ownership.py --dry-run
  python ingest_ownership.py --export-only   # re-export from existing DB data
"""

import argparse
import json
import os
import sys
import time
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

import requests

sys.path.insert(0, str(Path(__file__).parent.parent))
import ssl_utils  # noqa: F401
from db import get_conn, init_schema

try:
    from dotenv import load_dotenv
    load_dotenv(Path(__file__).parent.parent.parent / ".env")
except ImportError:
    pass

R2_BASE      = "https://api.fantasai.net/api/v1/r2"
FANTASAI_KEY = os.environ.get("FANTASAI_KEY", "")
HEADERS_R2   = {"X-FantasAI-Key": FANTASAI_KEY, "Content-Type": "application/json"}

SLEEPER_BASE = "https://api.sleeper.app/v1"
CURRENT_YEAR = str(datetime.now().year)
TARGET_LEAGUES = 500

# Seed usernames — common fantasy football handles to bootstrap discovery.
# These are realistic Sleeper usernames (short, common, no spaces).
# More seeds = more leagues discovered in Phase 1 = better ownership data.
SEED_USERNAMES = [
    # Generic fantasy handles
    "fantasy", "football", "nfl", "dynasty", "sleeper", "redraft",
    "bestball", "commish", "commissioner", "league", "pigskin",
    "gridiron", "touchdown", "playoffs", "draftday", "waiverwire",
    "tradebait", "moneyball", "autodraft", "lastplace", "champ",

    # Common first names (high hit rate on Sleeper)
    "mike", "john", "dave", "chris", "matt", "tom", "bob", "jim",
    "ryan", "adam", "josh", "jake", "kevin", "steve", "jason", "brian",
    "scott", "eric", "paul", "mark", "dan", "rick", "tony", "bill",
    "nick", "zach", "kyle", "tyler", "brad", "chad", "derek", "sean",
    "james", "alex", "andrew", "michael", "daniel", "joseph", "ben",
    "sam", "max", "joe", "rob", "tim", "greg", "jeff", "justin",

    # Common last names used as usernames
    "smith", "jones", "johnson", "williams", "brown", "davis", "miller",
    "wilson", "moore", "taylor", "anderson", "thomas", "jackson", "white",
    "harris", "martin", "garcia", "martinez", "robinson", "clark",

    # Fantasy-specific handles
    "ffnerd", "fftoday", "fantasypros", "footballguy", "devy",
    "sfb", "startup", "rebuild", "contender", "tanking",
    "dadleague", "beerleague", "workleague", "sharks", "wolves",
    "dynasty1", "redraft1", "bestball1", "keeper1",

    # NFL team fan handles
    "chiefs", "eagles", "cowboys", "niners", "ravens", "bills",
    "dolphins", "patriots", "jets", "bengals", "browns", "steelers",
    "texans", "colts", "jaguars", "titans", "broncos", "raiders",
    "chargers", "rams", "cardinals", "seahawks", "bears", "lions",
    "packers", "vikings", "falcons", "panthers", "saints", "buccaneers",
    "commanders", "giants",
]

# Generate numbered variants (username1 ... username10) — increases hit rate
SEED_USERNAMES_EXPANDED = SEED_USERNAMES[:]
for base in SEED_USERNAMES[:40]:
    SEED_USERNAMES_EXPANDED += [f"{base}{i}" for i in range(1, 11)]


# ── Schema ────────────────────────────────────────────────────────────────────

SCHEMA_SQL = """
CREATE TABLE IF NOT EXISTS bronze_player_ownership (
    player_id       VARCHAR PRIMARY KEY,
    player_name     VARCHAR,
    position        VARCHAR,
    team            VARCHAR,
    ownership_pct   DOUBLE,
    leagues_rostered INTEGER,
    leagues_sampled  INTEGER,
    updated_at      TIMESTAMP
);
"""


def ensure_schema(conn):
    for stmt in SCHEMA_SQL.split(";"):
        s = stmt.strip()
        if s:
            conn.execute(s)


# ── Sleeper API helpers ───────────────────────────────────────────────────────

def _get(url: str, timeout: int = 10) -> dict | list | None:
    try:
        r = requests.get(url, timeout=timeout)
        if r.status_code == 200:
            return r.json()
    except Exception:
        pass
    return None


def get_user(username: str) -> dict | None:
    return _get(f"{SLEEPER_BASE}/user/{username}")


def get_user_leagues(user_id: str, year: str = CURRENT_YEAR) -> list:
    data = _get(f"{SLEEPER_BASE}/user/{user_id}/leagues/nfl/{year}")
    return data if isinstance(data, list) else []


def get_league_rosters(league_id: str) -> list:
    data = _get(f"{SLEEPER_BASE}/league/{league_id}/rosters")
    return data if isinstance(data, list) else []


def get_all_players() -> dict:
    """Fetch all Sleeper player metadata (name, position, team)."""
    print("   Fetching Sleeper player metadata…")
    data = _get(f"{SLEEPER_BASE}/players/nfl", timeout=60)
    return data if isinstance(data, dict) else {}


# ── Crawl ─────────────────────────────────────────────────────────────────────

def crawl_leagues(target: int) -> tuple[Counter, int]:
    """
    Returns (player_league_counts, total_leagues_sampled).
    player_league_counts: Counter of player_id → leagues they appear in.
    """
    discovered_leagues: set[str] = set()
    sampled_leagues: set[str]    = set()
    discovered_users: set[str]   = set()
    player_counts: Counter        = Counter()

    def process_roster(league_id: str):
        if league_id in sampled_leagues:
            return
        rosters = get_league_rosters(league_id)
        if not rosters:
            return
        sampled_leagues.add(league_id)
        for roster in rosters:
            players = roster.get("players") or []
            for pid in players:
                player_counts[str(pid)] += 1
            # Expand: collect owner_ids to discover more leagues
            owner_id = str(roster.get("owner_id", ""))
            if owner_id and owner_id not in discovered_users:
                discovered_users.add(owner_id)
                new_leagues = get_user_leagues(owner_id)
                for lg in new_leagues:
                    lid = str(lg.get("league_id", ""))
                    if lid and lid not in discovered_leagues:
                        discovered_leagues.add(lid)
        time.sleep(0.05)

    # ── Phase 1: seed usernames ────────────────────────────────────────────
    print(f"\n   Phase 1: seeding from {len(SEED_USERNAMES_EXPANDED)} usernames…")
    seed_leagues_found = 0
    for uname in SEED_USERNAMES_EXPANDED:
        if len(discovered_leagues) >= target * 2:
            break
        user = get_user(uname)
        if not user:
            continue
        uid = str(user.get("user_id", ""))
        if not uid or uid in discovered_users:
            continue
        discovered_users.add(uid)
        leagues = get_user_leagues(uid)
        for lg in leagues:
            lid = str(lg.get("league_id", ""))
            if lid:
                discovered_leagues.add(lid)
                seed_leagues_found += 1
        time.sleep(0.1)

    print(f"   Seed phase: {len(discovered_users)} users, "
          f"{len(discovered_leagues)} leagues discovered")

    # ── Phase 2: sample discovered leagues ────────────────────────────────
    print(f"\n   Phase 2: sampling leagues (target: {target})…")
    league_list = list(discovered_leagues)
    for i, lid in enumerate(league_list):
        if len(sampled_leagues) >= target:
            break
        process_roster(lid)
        if (i + 1) % 50 == 0:
            print(f"   Progress: {len(sampled_leagues)}/{target} leagues sampled, "
                  f"{len(player_counts)} players seen")

    print(f"\n   Crawl complete: {len(sampled_leagues)} leagues, "
          f"{len(player_counts)} unique players")
    return player_counts, len(sampled_leagues)


# ── DuckDB write ──────────────────────────────────────────────────────────────

def write_bronze(conn, player_counts: Counter, total_leagues: int,
                 player_meta: dict, dry_run: bool):
    if dry_run:
        print(f"   DRY RUN — would write {len(player_counts)} rows")
        return

    now = datetime.now(timezone.utc).replace(tzinfo=None)
    rows = []
    for pid, count in player_counts.items():
        meta = player_meta.get(pid, {})
        rows.append({
            "player_id":       pid,
            "player_name":     meta.get("full_name") or meta.get("first_name", ""),
            "position":        meta.get("position", ""),
            "team":            meta.get("team", ""),
            "ownership_pct":   round(count / total_leagues * 100, 2),
            "leagues_rostered": count,
            "leagues_sampled": total_leagues,
            "updated_at":      now,
        })

    import pandas as pd
    df = pd.DataFrame(rows)
    conn.execute("DELETE FROM bronze_player_ownership")
    conn.register("_own", df)
    conn.execute("INSERT INTO bronze_player_ownership BY NAME SELECT * FROM _own")
    print(f"   bronze_player_ownership: {len(rows)} rows written")


# ── R2 export ─────────────────────────────────────────────────────────────────

def export_to_r2(conn, dry_run: bool):
    rows = conn.execute("""
        SELECT player_id, player_name, position, team,
               ownership_pct, leagues_rostered, leagues_sampled
        FROM bronze_player_ownership
        WHERE position IN ('QB','RB','WR','TE','K','DEF')
          AND player_name IS NOT NULL AND player_name != ''
        ORDER BY ownership_pct DESC
        LIMIT 500
    """).df()

    if rows.empty:
        print("   No ownership data — skipping R2 export")
        return

    meta = conn.execute(
        "SELECT MAX(updated_at), MAX(leagues_sampled) FROM bronze_player_ownership"
    ).fetchone()
    updated_at    = str(meta[0]) if meta[0] else datetime.now(timezone.utc).isoformat()
    leagues_count = int(meta[1]) if meta[1] else 0

    payload = {
        "generated_at":   updated_at,
        "leagues_sampled": leagues_count,
        "player_count":   len(rows),
        "players":        rows.to_dict(orient="records"),
    }

    key = "fantasai/analysis/player_ownership.json"
    body = json.dumps(payload, default=str)
    size_kb = len(body.encode()) / 1024
    print(f"   {key}  ({len(rows)} players, {size_kb:.1f} KB)")
    if dry_run:
        print("      DRY RUN"); return
    if not FANTASAI_KEY:
        print("      SKIP — FANTASAI_KEY not set"); return
    try:
        resp = requests.put(f"{R2_BASE}/{key}", data=body, headers=HEADERS_R2, timeout=30)
        print("      OK" if resp.ok else f"      FAIL HTTP {resp.status_code}")
    except Exception as e:
        print(f"      ERROR {e}")


# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--target",      type=int, default=TARGET_LEAGUES,
                        help=f"Target number of leagues to sample (default: {TARGET_LEAGUES})")
    parser.add_argument("--dry-run",     action="store_true")
    parser.add_argument("--export-only", action="store_true",
                        help="Skip crawl; re-export from existing DB data")
    args = parser.parse_args()

    print("=" * 70)
    print("Sleeper Ownership Ingestion — Public League Sampling")
    print(f"Timestamp: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print(f"Season:    {CURRENT_YEAR}")
    print(f"Target:    {args.target} leagues")
    print(f"Mode:      {'DRY RUN' if args.dry_run else 'LIVE'}")
    print("=" * 70)

    conn = get_conn()
    init_schema(conn)
    ensure_schema(conn)

    if not args.export_only:
        # Fetch player metadata for name/position enrichment
        player_meta = get_all_players()
        print(f"   Player metadata: {len(player_meta)} players")

        # Crawl leagues
        player_counts, total_leagues = crawl_leagues(args.target)

        if total_leagues == 0:
            print("\n   WARNING: No leagues sampled — check network connectivity")
            conn.close()
            return

        write_bronze(conn, player_counts, total_leagues, player_meta, args.dry_run)
    else:
        count = conn.execute("SELECT COUNT(*) FROM bronze_player_ownership").fetchone()[0]
        print(f"\n── Using existing bronze_player_ownership ({count} rows) ─────────────")

    print("\n── Exporting to R2 ───────────────────────────────────────────────────")
    export_to_r2(conn, args.dry_run)

    conn.close()
    print("\n✅ Ownership ingestion complete")


if __name__ == "__main__":
    main()
