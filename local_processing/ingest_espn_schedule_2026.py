"""
ingest_espn_schedule_2026.py — Full 2026 preseason + regular-season schedule,
sourced directly from ESPN (not nflverse — nflverse lags well behind live
data and doesn't have preseason at all; see ingest/ingest_schedules.py's own
comment: "2026 starts Sep 2026").

Why this exists: job_live_scores.py's --auto mode trusts each ESPN event's
own embedded season.type/week.number to decide what to poll. On 2026-08-20
that produced a discrepancy — events for the night's remaining games were
tagged week.number=3, but the real preseason week 2 slate was still
in progress (confirmed live: Raiders @ Texans, 49ers @ Chargers). Rather
than guess at a per-event correction, this pulls the full schedule (every
week of both preseason and regular season) into one table, keyed by real
game date, that can be checked directly instead of trusting one query's
week label in isolation.

Output (R2): fantasai/live/season_schedule_2026.json — flat array, one row
per game: date, teams, ESPN's own season type + week number, status.

Usage:
  python ingest_espn_schedule_2026.py --dry-run
  python ingest_espn_schedule_2026.py
"""

import argparse
import json
import os
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

import requests
import urllib3

urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

try:
    from dotenv import load_dotenv
    load_dotenv(Path(__file__).parent.parent / ".env")
except ImportError:
    pass

VERIFY_SSL = False
R2_BASE = "https://api.fantasai.net/api/v1/r2"
ESPN_BASE = "https://site.api.espn.com/apis/site/v2/sports/football/nfl"
SCHEDULE_KEY = "fantasai/live/season_schedule_2026.json"
SEASON = 2026

# These week ranges are ESPN's OWN numbering, queried directly — for
# preseason that includes the Hall of Fame Game as week 1 (confirmed
# 2026-08-20), so week 2-4 here are what everyone actually calls preseason
# weeks 1-3. See fetch_week()'s commonWeek field for the corrected number.
# Regular season: standard 18 weeks, no offset.
SEASON_TYPES = [
    ("pre", 1, range(1, 5)),
    ("regular", 2, range(1, 19)),
]

FANTASAI_KEY = os.environ.get("FANTASAI_KEY", "")
if not FANTASAI_KEY:
    print("ERROR: FANTASAI_KEY not set — add to .env")
    sys.exit(1)

HEADERS = {"X-FantasAI-Key": FANTASAI_KEY}


def r2_put(key: str, payload) -> bool:
    resp = requests.put(
        f"{R2_BASE}/{key}",
        headers={**HEADERS, "Content-Type": "application/json"},
        data=json.dumps(payload, default=str),
        timeout=30,
        verify=VERIFY_SSL,
    )
    ok = resp.status_code in (200, 201)
    print(f"  {'OK' if ok else f'FAIL {resp.status_code}'} -> {key}")
    return ok


def espn_fetch(path: str) -> dict:
    resp = requests.get(f"{ESPN_BASE}{path}", headers={"Accept": "application/json"}, timeout=20, verify=VERIFY_SSL)
    if not resp.ok:
        raise RuntimeError(f"ESPN {path} -> {resp.status_code}")
    return resp.json()


def fetch_week(season_type_str: str, season_type_num: int, week: int) -> list:
    data = espn_fetch(f"/scoreboard?seasontype={season_type_num}&week={week}&season={SEASON}")
    rows = []
    for event in data.get("events", []):
        comp = (event.get("competitions") or [{}])[0]
        competitors = comp.get("competitors") or []
        home = next((c for c in competitors if c.get("homeAway") == "home"), {})
        away = next((c for c in competitors if c.get("homeAway") == "away"), {})
        status = (event.get("status") or {}).get("type") or {}
        espn_week = (event.get("week") or {}).get("number")
        # commonWeek: ESPN's preseason week.number counts the Hall of Fame
        # Game as "week 1" (confirmed 2026-08-20 against the official NFL
        # calendar), shifting everything else by one vs. how everyone
        # actually refers to preseason weeks. commonWeek is the corrected
        # value — use THIS everywhere outside of raw ESPN queries, never
        # espnWeek. Regular season has no offset.
        common_week = (
            (espn_week - 1) if season_type_str == "pre" and espn_week is not None
            else espn_week
        )
        rows.append({
            "id": event.get("id"),
            "date": event.get("date"),
            "homeAbbr": (home.get("team") or {}).get("abbreviation"),
            "awayAbbr": (away.get("team") or {}).get("abbreviation"),
            "homeScore": home.get("score"),
            "awayScore": away.get("score"),
            "state": status.get("state", "pre"),
            "completed": status.get("completed", False),
            "description": status.get("description", ""),
            "queriedAs": {"type": season_type_str, "week": week},
            "espnSeasonType": (event.get("season") or {}).get("type"),
            "espnWeek": espn_week,
            "commonWeek": common_week,
        })
    return rows


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    all_games = {}  # dedupe by event id — a game can appear under >1 query
    for season_type_str, season_type_num, weeks in SEASON_TYPES:
        for week in weeks:
            try:
                rows = fetch_week(season_type_str, season_type_num, week)
            except Exception as e:
                print(f"  [{season_type_str} week {week}] {e}")
                continue
            print(f"  {season_type_str} week {week}: {len(rows)} games")
            for r in rows:
                all_games[r["id"]] = r
            time.sleep(0.3)  # be polite to ESPN's edge

    games = sorted(all_games.values(), key=lambda g: g["date"] or "")
    payload = {
        "season": SEASON,
        "fetchedAt": datetime.now(timezone.utc).isoformat(),
        "gameCount": len(games),
        "games": games,
    }

    # Flag any game whose embedded week/type disagrees with the query that
    # found it — this is exactly the inconsistency that motivated this script.
    mismatches = [
        g for g in games
        if g["espnSeasonType"] is not None and g["espnWeek"] is not None
        and (g["queriedAs"]["week"] != g["espnWeek"])
    ]
    if mismatches:
        print(f"\n[Schedule] {len(mismatches)} games where ESPN's embedded week disagrees with the query that found them:")
        for g in mismatches[:20]:
            print(f"    {g['date']} {g['awayAbbr']}@{g['homeAbbr']} — queried as {g['queriedAs']['type']} wk{g['queriedAs']['week']}, ESPN tags it wk{g['espnWeek']}")

    if args.dry_run:
        out = Path(__file__).parent / "espn_schedule_2026_dry_run.json"
        out.write_text(json.dumps(payload, indent=2, default=str))
        print(f"\n[Schedule] Dry run saved -> {out} ({len(games)} total games)")
    else:
        print(f"\n[Schedule] {len(games)} total games")
        r2_put(SCHEDULE_KEY, payload)


if __name__ == "__main__":
    main()
