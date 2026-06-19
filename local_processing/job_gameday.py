"""
job_gameday.py — Lightweight game-day injury, inactive & news updater.

No LLM. Pure data fetch for teams playing in the specified window only.
Runs via Windows Task Scheduler before each NFL game window.

Game windows — run times (Central Time):
  tnf        Thu  6:00 PM CT  Thursday Night Football  (kickoff ~7:20 PM CT / 8:20 PM ET)
  sun_early  Sun 10:45 AM CT  Sunday 1 PM ET games     (inactives post ~10:30 AM CT)
  sun_late   Sun  2:15 PM CT  Sunday 4:25 PM ET games  (inactives post ~2:55 PM CT)
  snf        Sun  6:00 PM CT  Sunday Night Football    (kickoff ~7:20 PM CT / 8:20 PM ET)
  mnf        Mon  6:00 PM CT  Monday Night Football    (kickoff ~7:15 PM CT / 8:15 PM ET)

Output: fantasai/news/gameday_updates.json

Usage:
  python job_gameday.py --window sun_early
  python job_gameday.py --window tnf --dry-run
  python job_gameday.py --window sun_late --season 2026 --week 4

Task Scheduler registration (run once per window):
  $py = "C:\\Python314\\python.exe"
  $script = "D:\\Project\\Fantasy\\local_processing\\job_gameday.py"
  $wd = "D:\\Project\\Fantasy\\local_processing"
  $settings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit (New-TimeSpan -Minutes 10) -StartWhenAvailable

  # Thursday Night Football — 6:00 PM CT Thursday
  Register-ScheduledTask -TaskName "FantasAI - Gameday TNF" -TaskPath "\\FantasAI\\" `
    -Action (New-ScheduledTaskAction -Execute $py -Argument "$script --window tnf" -WorkingDirectory $wd) `
    -Trigger (New-ScheduledTaskTrigger -Weekly -DaysOfWeek Thursday -At "06:00PM") `
    -Settings $settings -RunLevel Highest -Force

  # Sunday Early (1 PM ET) — 10:45 AM CT Sunday (inactives window)
  Register-ScheduledTask -TaskName "FantasAI - Gameday Sun Early" -TaskPath "\\FantasAI\\" `
    -Action (New-ScheduledTaskAction -Execute $py -Argument "$script --window sun_early" -WorkingDirectory $wd) `
    -Trigger (New-ScheduledTaskTrigger -Weekly -DaysOfWeek Sunday -At "10:45AM") `
    -Settings $settings -RunLevel Highest -Force

  # Sunday Late (4:25 PM ET) — 2:15 PM CT Sunday (inactives window)
  Register-ScheduledTask -TaskName "FantasAI - Gameday Sun Late" -TaskPath "\\FantasAI\\" `
    -Action (New-ScheduledTaskAction -Execute $py -Argument "$script --window sun_late" -WorkingDirectory $wd) `
    -Trigger (New-ScheduledTaskTrigger -Weekly -DaysOfWeek Sunday -At "02:15PM") `
    -Settings $settings -RunLevel Highest -Force

  # Sunday Night Football — 6:00 PM CT Sunday
  Register-ScheduledTask -TaskName "FantasAI - Gameday SNF" -TaskPath "\\FantasAI\\" `
    -Action (New-ScheduledTaskAction -Execute $py -Argument "$script --window snf" -WorkingDirectory $wd) `
    -Trigger (New-ScheduledTaskTrigger -Weekly -DaysOfWeek Sunday -At "06:00PM") `
    -Settings $settings -RunLevel Highest -Force

  # Monday Night Football — 6:00 PM CT Monday
  Register-ScheduledTask -TaskName "FantasAI - Gameday MNF" -TaskPath "\\FantasAI\\" `
    -Action (New-ScheduledTaskAction -Execute $py -Argument "$script --window mnf" -WorkingDirectory $wd) `
    -Trigger (New-ScheduledTaskTrigger -Weekly -DaysOfWeek Monday -At "06:00PM") `
    -Settings $settings -RunLevel Highest -Force
"""

import argparse
import json
import os
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

import requests
import urllib3

urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

try:
    from dotenv import load_dotenv
    load_dotenv(Path(__file__).parent.parent / ".env")
except ImportError:
    pass

VERIFY_SSL = False
R2_BASE          = "https://api.fantasai.net/api/v1/r2"
ESPN_SCOREBOARD  = "https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard"
ESPN_TEAM_NEWS   = "https://site.api.espn.com/apis/site/v2/sports/football/nfl/news"
ESPN_INJURIES    = "https://site.api.espn.com/apis/site/v2/sports/football/nfl/injuries"
SLEEPER_PLAYERS  = "https://api.sleeper.app/v1/players/nfl"

ET = ZoneInfo("America/New_York")

FANTASAI_KEY = os.environ.get("FANTASAI_KEY", "")
if not FANTASAI_KEY:
    print("ERROR: FANTASAI_KEY not set — add to .env")
    sys.exit(1)

HEADERS = {"X-FantasAI-Key": FANTASAI_KEY}

# ── Window definitions ────────────────────────────────────────────────────────
# Keyed by --window arg.
# days: 0=Mon 1=Tue 2=Wed 3=Thu 4=Fri 5=Sat 6=Sun (Python weekday())
# et_hour range is the kickoff window in Eastern Time (inclusive start, exclusive end)
WINDOWS = {
    "tnf":       {"label": "Thursday Night Football", "days": [3],    "et_min": 18, "et_max": 23},
    "sun_early": {"label": "Sunday Early (1 PM ET)",  "days": [6],    "et_min": 12, "et_max": 15},
    "sun_late":  {"label": "Sunday Late (4 PM ET)",   "days": [6],    "et_min": 15, "et_max": 19},
    "snf":       {"label": "Sunday Night Football",   "days": [6],    "et_min": 19, "et_max": 23},
    "mnf":       {"label": "Monday Night Football",   "days": [0],    "et_min": 19, "et_max": 23},
}

# ── R2 helpers ────────────────────────────────────────────────────────────────

def r2_get(key: str):
    try:
        resp = requests.get(f"{R2_BASE}/{key}", headers=HEADERS, timeout=20, verify=VERIFY_SSL)
        if resp.status_code == 404:
            return None
        resp.raise_for_status()
        return resp.json()
    except Exception as e:
        print(f"  [r2_get] {key}: {e}")
        return None


def r2_put(key: str, payload) -> bool:
    try:
        resp = requests.put(
            f"{R2_BASE}/{key}",
            headers={**HEADERS, "Content-Type": "application/json"},
            data=json.dumps(payload),
            timeout=30,
            verify=VERIFY_SSL,
        )
        ok = resp.status_code in (200, 201)
        print(f"  {'OK' if ok else 'FAIL ' + str(resp.status_code)} -> {key}")
        return ok
    except Exception as e:
        print(f"  [r2_put] {key}: {e}")
        return False

# ── ESPN helpers ──────────────────────────────────────────────────────────────

def _espn_get(url: str, params: dict = None) -> dict:
    try:
        resp = requests.get(url, params=params, timeout=20, verify=VERIFY_SSL)
        resp.raise_for_status()
        return resp.json()
    except Exception as e:
        print(f"  [ESPN] {url}: {e}")
        return {}


def get_games_for_window(window: str, season: int = 2026, week: int | None = None) -> list[dict]:
    """
    Returns list of {home, away, kickoff_et, game_id, status} for games in the window.
    Tries regular season first (seasontype=2), then preseason (seasontype=1).
    """
    cfg = WINDOWS[window]

    params_base = {"dates": season}
    if week:
        params_base["week"] = week

    games = []
    for seasontype in (2, 1):
        p = {**params_base, "seasontype": seasontype}
        data = _espn_get(ESPN_SCOREBOARD, params=p)
        events = data.get("events", [])
        if not events:
            continue

        for ev in events:
            date_str = ev.get("date", "")
            if not date_str:
                continue
            try:
                kickoff_utc = datetime.fromisoformat(date_str.rstrip("Z")).replace(tzinfo=timezone.utc)
                kickoff_et  = kickoff_utc.astimezone(ET)
            except ValueError:
                continue

            dow  = kickoff_et.weekday()
            hour = kickoff_et.hour

            if dow not in cfg["days"]:
                continue
            if not (cfg["et_min"] <= hour < cfg["et_max"]):
                continue

            comps = ev.get("competitions", [{}])[0].get("competitors", [])
            teams = [c["team"]["abbreviation"] for c in comps if c.get("team", {}).get("abbreviation")]
            status = ev.get("status", {}).get("type", {}).get("name", "STATUS_SCHEDULED")

            if len(teams) == 2:
                games.append({
                    "home": next((c["team"]["abbreviation"] for c in comps if c.get("homeAway") == "home"), teams[0]),
                    "away": next((c["team"]["abbreviation"] for c in comps if c.get("homeAway") == "away"), teams[1]),
                    "kickoff_et": kickoff_et.strftime("%Y-%m-%d %H:%M ET"),
                    "status": status,
                })

        if games:
            break  # found games in this season type

    return games


def fetch_espn_injuries(teams: list[str]) -> list[dict]:
    """
    Calls ESPN /injuries endpoint and filters to requested teams.
    Returns list of {player_name, team, position, status, detail}.
    """
    data = _espn_get(ESPN_INJURIES)
    results = []
    team_set = {t.upper() for t in teams}

    for item in data.get("injuries", []):
        team_abbr = (item.get("team", {}).get("abbreviation") or "").upper()
        if team_abbr not in team_set:
            continue
        athlete = item.get("athlete", {})
        results.append({
            "player_name": athlete.get("displayName") or athlete.get("fullName") or "",
            "team":        team_abbr,
            "position":    athlete.get("position", {}).get("abbreviation", ""),
            "status":      item.get("status") or "",
            "detail":      item.get("details", {}).get("detail") or item.get("type", {}).get("text") or "",
            "return_date": item.get("details", {}).get("returnDate") or None,
            "source":      "espn_injuries",
        })

    return results


def fetch_espn_news(teams: list[str]) -> list[dict]:
    """
    Fetches ESPN team news for each team and returns the top 5 headlines per team.
    """
    articles = []
    for abbr in teams:
        data = _espn_get(ESPN_TEAM_NEWS, params={"team": abbr, "limit": 8})
        for item in data.get("articles", [])[:5]:
            articles.append({
                "headline":     item.get("headline") or item.get("title") or "",
                "description":  item.get("description") or "",
                "team":         abbr,
                "player":       next((kw for kw in item.get("keywords", []) if kw.get("type") == "player"), {}).get("displayName") or "",
                "published_at": item.get("published") or item.get("lastModified") or "",
                "source":       "espn_news",
            })
        time.sleep(0.15)  # be polite to ESPN's public API

    # sort by published_at descending
    articles.sort(key=lambda a: a["published_at"], reverse=True)
    return articles


def fetch_sleeper_injuries(teams: list[str]) -> list[dict]:
    """
    Fetches Sleeper full player list and returns injury/status info for
    players on the specified teams.
    """
    team_set = {t.upper() for t in teams}
    try:
        resp = requests.get(SLEEPER_PLAYERS, timeout=45, verify=VERIFY_SSL)
        resp.raise_for_status()
        all_players = resp.json()
    except Exception as e:
        print(f"  [Sleeper] fetch failed: {e}")
        return []

    results = []
    for pid, p in all_players.items():
        team = (p.get("team") or "").upper()
        if team not in team_set:
            continue
        status = p.get("injury_status") or p.get("status") or ""
        if not status or status.lower() in ("active", ""):
            continue
        results.append({
            "player_name":  p.get("full_name") or p.get("first_name", "") + " " + p.get("last_name", ""),
            "team":         team,
            "position":     p.get("position") or "",
            "status":       status,
            "body_part":    p.get("injury_body_part") or p.get("injury_type") or "",
            "depth_chart":  p.get("depth_chart_order") or None,
            "source":       "sleeper",
        })

    results.sort(key=lambda p: (p["team"], p["position"]))
    return results


# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description="FantasAI game-day injury & news updater")
    parser.add_argument("--window",  required=True, choices=list(WINDOWS.keys()),
                        help="Game window to fetch for")
    parser.add_argument("--season",  type=int, default=2026,
                        help="NFL season year (default 2026)")
    parser.add_argument("--week",    type=int, default=None,
                        help="Force specific NFL week (auto-detected if omitted)")
    parser.add_argument("--dry-run", action="store_true",
                        help="Fetch and print, don't upload to R2")
    args = parser.parse_args()

    window = args.window
    label  = WINDOWS[window]["label"]
    now_et = datetime.now(ET)
    print(f"\n[Gameday] {label} — {now_et.strftime('%A %Y-%m-%d %I:%M %p ET')}")
    print(f"[Gameday] Season {args.season} | Window: {window}")

    # 1. Find teams playing in this window
    print("[Gameday] Fetching schedule from ESPN...")
    games = get_games_for_window(window, season=args.season, week=args.week)

    if not games:
        print(f"[Gameday] No {label} games found — nothing to do.")
        # Write an empty update so the frontend knows we checked
        if not args.dry_run:
            r2_put("fantasai/news/gameday_updates.json", {
                "generated_at": datetime.now(timezone.utc).isoformat(),
                "window": window, "label": label, "teams": [], "games": [],
                "injuries": [], "news": [], "sleeper_status": [],
            })
        return

    teams = sorted({g["home"] for g in games} | {g["away"] for g in games})
    print(f"[Gameday] {len(games)} game(s) | Teams: {', '.join(teams)}")
    for g in games:
        print(f"          {g['away']} @ {g['home']} — {g['kickoff_et']} ({g['status']})")

    # 2. Fetch ESPN injuries (league-wide, filtered to these teams)
    print(f"\n[Gameday] Fetching ESPN injuries for {len(teams)} teams...")
    injuries = fetch_espn_injuries(teams)
    print(f"          {len(injuries)} injury entries found")

    # 3. Fetch ESPN news headlines for each team
    print(f"[Gameday] Fetching ESPN news for {len(teams)} teams...")
    news = fetch_espn_news(teams)
    print(f"          {len(news)} headlines found")

    # 4. Fetch Sleeper status for players on these teams
    print("[Gameday] Fetching Sleeper status...")
    sleeper_status = fetch_sleeper_injuries(teams)
    print(f"          {len(sleeper_status)} players with non-active status")

    # 5. Determine if this is an inactives window
    #    Inactives are officially released ~90 min before kickoff.
    #    sun_early: we run at 10:45 AM CT, kickoff is 12 PM CT — 75 min window.
    #    sun_late:  we run at  2:15 PM CT, kickoff is 3:25 PM CT — 70 min window.
    is_inactives_window = window in ("sun_early", "sun_late")

    payload = {
        "generated_at":      datetime.now(timezone.utc).isoformat(),
        "window":            window,
        "label":             label,
        "is_inactives":      is_inactives_window,
        "teams":             teams,
        "games":             games,
        "injuries":          injuries,
        "sleeper_status":    sleeper_status,
        "news":              news,
    }

    if args.dry_run:
        out = Path(__file__).parent / f"gameday_{window}_dry_run.json"
        out.write_text(json.dumps(payload, indent=2))
        print(f"\n[Gameday] Dry run saved -> {out}")
        print(f"[Gameday] Summary: {len(injuries)} injuries | {len(sleeper_status)} statuses | {len(news)} headlines")
        return

    print("\n[Gameday] Uploading to R2...")
    r2_put("fantasai/news/gameday_updates.json", payload)
    print(f"[Gameday] Done. {len(injuries)} injuries | {len(sleeper_status)} statuses | {len(news)} headlines")


if __name__ == "__main__":
    main()
