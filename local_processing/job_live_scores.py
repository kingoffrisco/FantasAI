"""
job_live_scores.py — Local-pipeline source for live NFL scoring.

Wired into production: worker-api's /api/v1/nfl/scoreboard and
/api/v1/nfl/player-stats now read the R2 keys this job writes
(fantasai/live/scoreboard.json, fantasai/live/player_stats.json) instead of
calling ESPN directly.

Why this exists: ESPN's site API started returning 403 to the Cloudflare
Worker specifically on 2026-08-20 (same request from a plain machine
returns 200 cleanly) — looks like ESPN rate-limiting/blocking Cloudflare
Workers' shared egress IPs, not an ESPN outage. job_gameday.py already
calls ESPN directly from this local machine without issue, so this job
follows the same pattern: poll ESPN from here instead of from the Worker.

Parsing and scoring logic here are a deliberate line-for-line port of
worker-api/src/index.js's handleNflPlayerStats/normalizeGame and
app/src/lib/liveScoring.js's calcFantasyPts — same field names, same
formula, same defaults — so output is identical regardless of which path
ends up serving it. If you change scoring in one place, change it in both.

--auto mode (what Task Scheduler runs): checks ESPN's schedule for today
directly (/scoreboard?dates=YYYYMMDD) rather than assuming a fixed
day-of-week window like job_gameday.py's TNF/SNF/MNF pattern — preseason
games don't follow that pattern, and this avoids hardcoding the real NFL
schedule anywhere. Each ESPN event carries its own season/week/type, so no
separate week-detection logic is needed. Task Scheduler invokes this hourly
(see LOOKAHEAD_MIN's comment for why hourly, not more often). If nothing is
live or starting within LOOKAHEAD_MIN, it exits immediately (cheap). If
something is, it switches into tiered polling — deliberately conservative
during live play, see the PRE_KICKOFF_INTERVAL/LIVE_INTERVAL/etc. constants
and their comment for why: ESPN already rate-limited/blocked one of our IPs
tonight (the Cloudflare Worker's) for polling too aggressively, and this
machine calling ESPN every 10-15s through a full live slate risks the same
thing here. Exits once every game in the slate is confirmed final (one
extra poll ~2 min after first seeing "final", then stops) — so the next
hourly tick just finds nothing live and exits quickly again.

Usage:
  python job_live_scores.py --week 2 --season 2026 --type pre --dry-run
  python job_live_scores.py --week 2 --season 2026 --type pre --loop
  python job_live_scores.py --auto              # what Task Scheduler runs
"""

import argparse
import json
import os
import re
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timedelta, timezone
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
R2_BASE = "https://api.fantasai.net/api/v1/r2"
ESPN_BASE = "https://site.api.espn.com/apis/site/v2/sports/football/nfl"

# Per (season, type, week) — NOT a single fixed key. Every week's data is
# retained permanently once written; moving on to a new week never
# overwrites an earlier one. INDEX_KEY tracks which combos have data so
# they can be discovered without probing every possible week.
def scoreboard_key(season: int, season_type: str, week: int) -> str:
    return f"fantasai/live/scoreboard_{season}_{season_type}_{week}.json"


def player_stats_key(season: int, season_type: str, week: int) -> str:
    return f"fantasai/live/player_stats_{season}_{season_type}_{week}.json"


INDEX_KEY = "fantasai/live/index.json"

ET = ZoneInfo("America/New_York")
# --auto's outer Task Scheduler check runs hourly (not every 15 min — no
# reason to hit ESPN that often on days with zero games). LOOKAHEAD_MIN
# needs to comfortably exceed that interval or an hourly check could land
# just after a game's own 15-min lookahead window closed and miss it —
# 65 guarantees every hourly check already sees anything kicking off within
# the next hour.
LOOKAHEAD_MIN = 65

FANTASAI_KEY = os.environ.get("FANTASAI_KEY", "")
if not FANTASAI_KEY:
    print("ERROR: FANTASAI_KEY not set — add to .env")
    sys.exit(1)

HEADERS = {"X-FantasAI-Key": FANTASAI_KEY}


# -- R2 helpers ---------------------------------------------------------

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


def _update_index(season: int, season_type: str, week: int, game_count: int, player_count: int):
    """Upsert this (season, type, week) into the index rather than
    overwriting the whole thing — every week ever polled stays listed,
    so old data can be discovered and referenced later instead of only
    ever knowing about whatever was most recently written."""
    index = r2_get(INDEX_KEY) or {"weeks": []}
    entries = index.get("weeks", [])
    now = datetime.now(timezone.utc).isoformat()
    for e in entries:
        if e["season"] == season and e["type"] == season_type and e["week"] == week:
            e["gameCount"] = game_count
            e["playerCount"] = player_count
            e["lastUpdated"] = now
            break
    else:
        entries.append({
            "season": season, "type": season_type, "week": week,
            "gameCount": game_count, "playerCount": player_count,
            "lastUpdated": now,
            "scoreboardKey": scoreboard_key(season, season_type, week),
            "playerStatsKey": player_stats_key(season, season_type, week),
        })
    entries.sort(key=lambda e: (e["season"], e["type"], e["week"]))
    r2_put(INDEX_KEY, {"weeks": entries, "updatedAt": now})


# -- Roster (authoritative position source) --------------------------------

def _normalize_name(name: str) -> str:
    name = (name or "").strip().lower()
    name = re.sub(r"[.']", "", name)
    name = re.sub(r"\s+(jr|sr|ii|iii|iv)$", "", name)
    name = re.sub(r"\s+", " ", name)
    return name


def load_roster_lookup() -> dict:
    """normalized name -> {pos, team, fullName} from the 2026 draft roster.

    ESPN's box score sometimes leaves position blank (confirmed repeatedly
    tonight), and any stats-based guess at position is inherently
    ambiguous for a player with both rushing and receiving stats (e.g.
    MarShawn Lloyd, a real RB, guessed as WR because he had 1 catch
    alongside his rushing line — receiving was checked first in priority
    order). The roster export is the actual source of truth for position;
    use it as the primary correction, not a fallback.
    """
    for path in ("fantasai/players/players_2026_draft.json", "fantasai/players/export_players_2026_draft.json"):
        raw = r2_get(path)
        if not raw:
            continue
        arr = raw if isinstance(raw, list) else (raw.get("data") or raw.get("players") or [])
        lookup = {}
        for p in arr:
            if not isinstance(p, dict):
                continue
            full_name = p.get("full_name") or p.get("player_name") or ""
            if not full_name:
                continue
            lookup[_normalize_name(full_name)] = {
                "pos": p.get("position") or "",
                "team": p.get("team") or "",
                "fullName": full_name,
            }
        print(f"[Live Scores] Roster loaded: {len(lookup)} players from {path}")
        return lookup
    print("[Live Scores] Roster export not found — falling back to stats-based position inference only")
    return {}


_ROSTER_CACHE = None


def get_roster_lookup() -> dict:
    """Loaded once per process and reused — the roster doesn't meaningfully
    change minute-to-minute, no reason to re-fetch it every poll cycle."""
    global _ROSTER_CACHE
    if _ROSTER_CACHE is None:
        _ROSTER_CACHE = load_roster_lookup()
    return _ROSTER_CACHE


# -- ESPN -----------------------------------------------------------------

def espn_fetch(path: str) -> dict:
    resp = requests.get(f"{ESPN_BASE}{path}", headers={"Accept": "application/json"}, timeout=20, verify=VERIFY_SSL)
    if not resp.ok:
        raise RuntimeError(f"ESPN {path} -> {resp.status_code}")
    return resp.json()


def espn_season_type(type_str: str) -> int:
    return {"pre": 1, "post": 3}.get(type_str, 2)


# ESPN's own week.number for preseason counts the Hall of Fame Game as
# "week 1", shifting everything else by one relative to how everyone
# actually refers to preseason weeks (confirmed 2026-08-20: ESPN tags the
# real Aug 20-26 "Pre Week 2" slate — Raiders @ Texans, 49ers @ Chargers
# live that night — as week.number=3). Regular season has no such offset
# (ESPN's week 1 really is Sep 6-15). Apply this ONLY at the ESPN-fetch
# boundary — every R2 key, log line, and function param elsewhere in this
# file uses the common/real week number, never ESPN's.
def to_espn_week(week: int, season_type: str) -> int:
    return week + 1 if season_type == "pre" else week


def from_espn_week(espn_week: int, season_type: str) -> int:
    return espn_week - 1 if season_type == "pre" else espn_week


def normalize_game(event: dict) -> dict:
    comp = (event.get("competitions") or [{}])[0]
    competitors = comp.get("competitors") or []

    def team_info(side):
        c = next((c for c in competitors if c.get("homeAway") == side), None)
        if not c:
            return None
        team = c.get("team") or {}
        return {
            "id": team.get("id"),
            "name": team.get("displayName"),
            "abbr": team.get("abbreviation"),
            "score": c.get("score"),
        }

    status = (event.get("status") or {}).get("type") or {}
    return {
        "id": event.get("id"),
        "date": event.get("date"),
        "name": event.get("name"),
        "home": team_info("home"),
        "away": team_info("away"),
        "status": {
            "state": status.get("state", "pre"),
            "completed": status.get("completed", False),
            "description": status.get("description", ""),
            "clock": (event.get("status") or {}).get("displayClock"),
            "period": (event.get("status") or {}).get("period"),
        },
    }


def fetch_scoreboard(week: int, season: int, season_type: str) -> list:
    espn_week = to_espn_week(week, season_type)
    data = espn_fetch(f"/scoreboard?seasontype={espn_season_type(season_type)}&week={espn_week}&season={season}")
    season_floor = datetime(season, 7, 1, tzinfo=timezone.utc)
    season_ceil = datetime(season + 1, 3, 1, tzinfo=timezone.utc)
    games = []
    for event in data.get("events", []):
        g = normalize_game(event)
        if not g["date"]:
            continue
        d = datetime.fromisoformat(g["date"].replace("Z", "+00:00"))
        if season_floor <= d < season_ceil:
            games.append(g)
    return games


_ESPN_SEASON_TYPE_STR = {1: "pre", 2: "regular", 3: "post"}


def fetch_todays_slates() -> list:
    """What's on ESPN's schedule for today (ET), grouped by (season, week,
    type) — usually one group, but query date-based so nothing needs to
    guess the current week/season-type itself; each event carries its own.

    Returns a list of dicts: {season, week, type, games: [...]}.
    """
    date_str = datetime.now(ET).strftime("%Y%m%d")
    data = espn_fetch(f"/scoreboard?dates={date_str}")
    events = data.get("events", [])

    slates: dict = {}
    for event in events:
        season = (event.get("season") or {}).get("year")
        season_type_num = (event.get("season") or {}).get("type")
        espn_week = (event.get("week") or {}).get("number")
        if not season or not espn_week or season_type_num not in _ESPN_SEASON_TYPE_STR:
            continue
        season_type = _ESPN_SEASON_TYPE_STR[season_type_num]
        week = from_espn_week(espn_week, season_type)  # correct ESPN's HOF-game preseason offset
        key = (season, week, season_type)
        slates.setdefault(key, []).append(normalize_game(event))

    return [
        {"season": s, "week": w, "type": t, "games": games}
        for (s, w, t), games in slates.items()
    ]


def relevant_games(games: list) -> list:
    """Games that are live now, or within the near-term kickoff window —
    NOT every game in the full multi-day week slate. This matters for more
    than just the initial "should I start polling" check: a preseason
    week spans Thu-Sun, so without this filter, a Sunday game still sitting
    at state=pre would look like "still something to wait for" and keep
    the polling loop alive for days after tonight's games are actually
    done (confirmed bug, 2026-08-21 — LV@HOU and SF@LAC were both Final
    but the job kept running because of Sunday's games in the same week)."""
    now = datetime.now(timezone.utc)
    relevant = []
    for g in games:
        if g["status"]["state"] == "in":
            relevant.append(g)
            continue
        if g["status"]["state"] == "pre" and g["date"]:
            kickoff = datetime.fromisoformat(g["date"].replace("Z", "+00:00"))
            if kickoff - timedelta(minutes=LOOKAHEAD_MIN) <= now < kickoff + timedelta(hours=4):
                relevant.append(g)
    return relevant


def slate_needs_polling(games: list) -> bool:
    """True if any game in the slate is live now, or kicks off within
    LOOKAHEAD_MIN minutes."""
    return len(relevant_games(games)) > 0


def _stat_val(keys: list, stats: list, key: str) -> float:
    if key not in keys:
        return 0.0
    v = stats[keys.index(key)]
    if not v or v == "--":
        return 0.0
    try:
        return float(v)
    except (TypeError, ValueError):
        return 0.0


def _split_slash(keys: list, stats: list, key: str) -> tuple:
    if key not in keys:
        return 0.0, 0.0
    v = stats[keys.index(key)] or ""
    parts = v.split("/")
    try:
        a = float(parts[0])
    except (IndexError, ValueError):
        a = 0.0
    try:
        b = float(parts[1])
    except (IndexError, ValueError):
        b = 0.0
    return a, b


def _stat_val_first(keys: list, stats: list, *candidates) -> float:
    for k in candidates:
        if k in keys:
            v = stats[keys.index(k)]
            return float(v) if v and v != "--" else 0.0
    return 0.0


def _fetch_summaries(game_ids: list) -> dict:
    """Fetch every game's box score concurrently instead of one at a time —
    a full 16-game Sunday slate was previously ~16 sequential ESPN
    round-trips before the R2 write could happen. Bounded worker count
    (a short burst, not sustained polling) so this doesn't look like the
    kind of aggressive pattern that got the Cloudflare Worker rate-limited."""
    results: dict = {}
    with ThreadPoolExecutor(max_workers=8) as pool:
        future_to_id = {pool.submit(espn_fetch, f"/summary?event={gid}"): gid for gid in game_ids}
        for future in as_completed(future_to_id):
            gid = future_to_id[future]
            try:
                results[gid] = future.result()
            except Exception as e:
                print(f"  [player-stats] event {gid}: {e}")
                results[gid] = None
    return results


# ESPN sometimes omits an athlete's position entirely from a box-score
# entry — real, known gap, confirmed 2026-08-20 (e.g. Amar Johnson, Camden
# Brown, Jordan Love's own backups). A blank pos silently breaks anything
# that filters/groups by position downstream (ScoringTest.jsx's own
# Player Scores-style filter, PlayerScoresTab's QB/RB/WR/etc. buttons), not
# just display. Same priority order as ScoringTest.jsx's normalizePos() —
# can't reliably distinguish WR vs TE from stats alone, so WR is the
# fallback for any receiving-only line; DST isn't inferable this way at all
# (ptsAllowed is tagged on every player on that team, not just defense) so
# it's left blank rather than guessed.
def _infer_pos(stats: dict) -> str:
    s = stats
    if s.get("passYds", 0) > 10 or s.get("passTds", 0) > 0:
        return "QB"
    if s.get("fgMade", 0) > 0 or s.get("fgAtt", 0) > 0 or s.get("xpMade", 0) > 0:
        return "K"
    if s.get("recYds", 0) > 0 or s.get("rec", 0) > 0 or s.get("targets", 0) > 0:
        return "WR"
    if s.get("rushYds", 0) > 0 or s.get("rushTds", 0) > 0:
        return "RB"
    return ""


def fetch_player_stats(events: list, roster_lookup: dict = None) -> list:
    """Port of worker-api's handleNflPlayerStats box-score parsing loop."""
    game_ids = [e["id"] for e in events[:16]]
    player_map: dict = {}
    summaries = _fetch_summaries(game_ids)

    for game_id in game_ids:
        data = summaries.get(game_id)
        if data is None:
            continue

        boxscore = data.get("boxscore") or {}
        event = next((e for e in events if e["id"] == game_id), {})
        team_scores = {}
        for c in [event.get("home"), event.get("away")]:
            if c and c.get("abbr"):
                team_scores[c["abbr"]] = int(c.get("score") or 0)

        for team_data in boxscore.get("players", []):
            team_abbr = (team_data.get("team") or {}).get("abbreviation", "")
            opponent_abbr = next((a for a in team_scores if a != team_abbr), None)
            pts_allowed = team_scores.get(opponent_abbr) if opponent_abbr else None

            for stat_group in team_data.get("statistics", []):
                name = stat_group.get("name")
                keys = stat_group.get("keys") or []
                for athlete_entry in stat_group.get("athletes", []):
                    athlete = athlete_entry.get("athlete") or {}
                    stats_arr = athlete_entry.get("stats") or []
                    pid = athlete.get("id")
                    if not pid:
                        continue

                    if pid not in player_map:
                        player_map[pid] = {
                            "id": pid,
                            "name": athlete.get("displayName", ""),
                            "pos": (athlete.get("position") or {}).get("abbreviation", ""),
                            "team": team_abbr,
                            "stats": {},
                        }
                    s = player_map[pid]["stats"]

                    if name == "passing":
                        # ESPN's own key for this varies by game — seen both
                        # "completionsAttempts" and "completions/passingAttempts"
                        # (confirmed 2026-08-20 against a real box score: the
                        # latter). Try both rather than silently getting 0/0.
                        ca, att = 0.0, 0.0
                        for cand in ("completionsAttempts", "completions/passingAttempts"):
                            if cand in keys:
                                ca, att = _split_slash(keys, stats_arr, cand)
                                break
                        s["passComp"] = s.get("passComp", 0) + ca
                        s["passAtt"] = s.get("passAtt", 0) + att
                        s["passYds"] = s.get("passYds", 0) + _stat_val(keys, stats_arr, "passingYards")
                        s["passTds"] = s.get("passTds", 0) + _stat_val(keys, stats_arr, "passingTouchdowns")
                        s["passInt"] = s.get("passInt", 0) + _stat_val(keys, stats_arr, "interceptions")
                    elif name == "rushing":
                        s["rushAtt"] = s.get("rushAtt", 0) + _stat_val(keys, stats_arr, "rushingAttempts")
                        s["rushYds"] = s.get("rushYds", 0) + _stat_val(keys, stats_arr, "rushingYards")
                        s["rushTds"] = s.get("rushTds", 0) + _stat_val(keys, stats_arr, "rushingTouchdowns")
                    elif name == "receiving":
                        s["rec"] = s.get("rec", 0) + _stat_val(keys, stats_arr, "receptions")
                        s["recYds"] = s.get("recYds", 0) + _stat_val(keys, stats_arr, "receivingYards")
                        s["recTds"] = s.get("recTds", 0) + _stat_val(keys, stats_arr, "receivingTouchdowns")
                        s["targets"] = s.get("targets", 0) + _stat_val(keys, stats_arr, "receivingTargets")
                    elif name == "kicking":
                        fg_made, fg_att = _split_slash(keys, stats_arr, "fieldGoalsMadeFieldGoalsAttempted")
                        xp_made, _ = _split_slash(keys, stats_arr, "extraPointsMadeExtraPointsAttempted")
                        s["fgMade"] = s.get("fgMade", 0) + fg_made
                        s["fgAtt"] = s.get("fgAtt", 0) + fg_att
                        s["xpMade"] = s.get("xpMade", 0) + xp_made
                        s["fgMade50"] = s.get("fgMade50", 0) + _stat_val_first(
                            keys, stats_arr, "fieldGoalsMade50Plus", "fieldGoals50PlusMade", "fg50"
                        )
                        if not player_map[pid]["pos"]:
                            player_map[pid]["pos"] = "K"
                    elif name == "defensive":
                        s["sacks"] = s.get("sacks", 0) + _stat_val(keys, stats_arr, "sacks")
                        s["ints"] = s.get("ints", 0) + _stat_val(keys, stats_arr, "interceptions")
                        s["fumRec"] = s.get("fumRec", 0) + _stat_val(keys, stats_arr, "fumbleRecoveries")
                        s["tds"] = s.get("tds", 0) + _stat_val(keys, stats_arr, "defensiveTouchdowns")
                        s["safeties"] = s.get("safeties", 0) + _stat_val(keys, stats_arr, "safeties")
                    elif name == "fumbles":
                        s["fumLost"] = s.get("fumLost", 0) + _stat_val_first(keys, stats_arr, "fumblesLost", "lost")

                    if pts_allowed is not None:
                        s["ptsAllowed"] = pts_allowed

    pos_norm = {"HB": "RB", "FB": "RB", "WB": "RB", "FL": "WR", "SE": "WR", "SWR": "WR", "D/ST": "DST", "DEF": "DST", "PK": "K"}
    for p in player_map.values():
        p["pos"] = pos_norm.get(p["pos"], p["pos"])
        # Roster is authoritative — takes priority over both ESPN's own tag
        # and stats-based inference (which is only a guess, and can be
        # wrong for anyone with stats in more than one category, e.g. an
        # RB with a catch — see MarShawn Lloyd, 2026-08-21).
        roster_entry = (roster_lookup or {}).get(_normalize_name(p["name"]))
        if roster_entry and roster_entry["pos"]:
            p["pos"] = roster_entry["pos"]
        elif not p["pos"]:
            p["pos"] = _infer_pos(p["stats"])

    players = [
        p for p in player_map.values()
        if any(p["stats"].get(k, 0) for k in ("passYds", "rushYds", "recYds", "rec", "fgMade", "fgAtt", "sacks", "ints", "tds"))
        or p["stats"].get("xpMade", 0) > 0
    ]
    return players


# -- Scoring (must match app/src/lib/liveScoring.js exactly) --------------

def get_scoring_rules() -> dict:
    settings = r2_get("fantasai/league-settings.json")
    scoring = (settings or {}).get("scoring")
    if scoring:
        return scoring
    return {
        "passYd": 0.04, "passTD": 4, "passInt": -2,
        "rushYd": 0.1, "rushTD": 6,
        "recYd": 0.1, "recTD": 6, "rec": 0.5,
        "fumbleLost": -2,
        "kFg50": 5, "kFgUnder50": 3, "kFgMiss": -1,
    }


def calc_fantasy_pts(stats: dict, rules: dict) -> float:
    s = stats or {}
    r = rules or {}
    fg_made50 = s.get("fgMade50", 0)
    fg_made_under50 = max(0, s.get("fgMade", 0) - fg_made50)
    fg_missed = max(0, s.get("fgAtt", 0) - s.get("fgMade", 0))
    pts = (
        s.get("passYds", 0) * r.get("passYd", 0.04)
        + s.get("passTds", 0) * r.get("passTD", 4)
        + s.get("passInt", 0) * r.get("passInt", -2)
        + s.get("rushYds", 0) * r.get("rushYd", 0.1)
        + s.get("rushTds", 0) * r.get("rushTD", 6)
        + s.get("recYds", 0) * r.get("recYd", 0.1)
        + s.get("recTds", 0) * r.get("recTD", 6)
        + s.get("rec", 0) * r.get("rec", 0.5)
        + s.get("fumLost", 0) * r.get("fumbleLost", -2)
        + fg_made50 * r.get("kFg50", 5)
        + fg_made_under50 * r.get("kFgUnder50", 3)
        + fg_missed * r.get("kFgMiss", -1)
    )
    return round(max(0.0, pts), 2)


# -- Main -------------------------------------------------------------------

def run_once(week: int, season: int, season_type: str, dry_run: bool, print_top5: bool = True) -> tuple:
    """Fetches and writes the FULL week's data to R2 (the frontend needs
    the whole week regardless of what's live right now). Returns
    (games, scored_players) — the full week's worth of both. When
    print_top5 is False (used by --auto, which does its own filtered
    print afterward — see run_auto), skips the built-in unfiltered
    top-5 print, which otherwise shows whichever game scored highest
    across the ENTIRE week — often an already-finished game from days
    earlier, not whatever's actually being polled right now (confirmed
    confusing, 2026-08-21)."""
    now = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S UTC")
    print(f"[Live Scores] [{now}] Fetching scoreboard: week={week} season={season} type={season_type}")
    games = fetch_scoreboard(week, season, season_type)
    print(f"  {len(games)} games")

    print("[Live Scores] Fetching player box scores...")
    raw_players = fetch_player_stats(games, roster_lookup=get_roster_lookup())
    print(f"  {len(raw_players)} players with recorded stats")

    rules = get_scoring_rules()
    scored_players = [
        {**p, "pts": calc_fantasy_pts(p["stats"], rules)}
        for p in raw_players
    ]
    scored_players.sort(key=lambda p: -p["pts"])

    scoreboard_payload = {
        "source": "espn-local", "fetchedAt": datetime.now(timezone.utc).isoformat(),
        "season": season, "week": week, "type": season_type,
        "gameCount": len(games), "games": games,
    }
    stats_payload = {
        "source": "espn-local", "fetchedAt": datetime.now(timezone.utc).isoformat(),
        "season": season, "week": week, "type": season_type,
        "players": scored_players,
    }

    if dry_run:
        out = Path(__file__).parent / "job_live_scores_dry_run.json"
        out.write_text(json.dumps({"scoreboard": scoreboard_payload, "player_stats": stats_payload}, indent=2, default=str))
        print(f"[Live Scores] Dry run saved -> {out}")
    else:
        r2_put(scoreboard_key(season, season_type, week), scoreboard_payload)
        r2_put(player_stats_key(season, season_type, week), stats_payload)
        _update_index(season, season_type, week, len(games), len(scored_players))

    if print_top5:
        print("  top scorers this week:")
        for p in scored_players[:5]:
            print(f"    {p['name']:22} {p['pos']:4} {p['team']:4} {p['pts']:5.1f} pts")

    return games, scored_players


# Tiered polling cadence — deliberately conservative during live play.
# ESPN already rate-limited/blocked one of our IPs once tonight (the
# Cloudflare Worker's) for making requests too often/automatically; polling
# every 10-15s through a full slate of live games would be a much more
# aggressive pattern that risks the same thing happening to this machine.
PRE_KICKOFF_INTERVAL = 300   # 5 min — within LOOKAHEAD_MIN of kickoff
LIVE_INTERVAL = 60           # 1 min — active play
HALFTIME_INTERVAL = 120      # 2 min — nothing to gain polling faster
FINAL_CONFIRM_DELAY = 120    # one extra poll ~2 min after final, then stop


def _tier_of(relevant: list) -> str:
    """Most urgent state across the RELEVANT (near-term) games only: live >
    halftime > pre > final. An empty relevant list means final — nothing
    live or imminent right now, regardless of what else is later in the
    week's full slate."""
    if not relevant:
        return "final"
    states = set()
    for g in relevant:
        st = g["status"]
        if st["state"] == "in":
            states.add("halftime" if "halftime" in (st.get("description") or "").lower() else "live")
        elif st["state"] == "pre":
            states.add("pre")
    if "live" in states:
        return "live"
    if "halftime" in states:
        return "halftime"
    if "pre" in states:
        return "pre"
    return "final"


def _describe_game(g: dict) -> str:
    away, home = g["away"]["abbr"], g["home"]["abbr"]
    return f"{away}@{home} ({g['status']['description'] or g['status']['state']})"


def run_auto(dry_run: bool):
    """Check today's real ESPN schedule; poll only the slate(s) that are
    live or about to kick off, then exit. Designed to be invoked hourly by
    Task Scheduler — cheap no-op when nothing's happening, self-sustaining
    tiered polling for as long as something is."""
    print("[Live Scores] --auto: checking today's schedule...")
    try:
        slates = fetch_todays_slates()
    except Exception as e:
        print(f"  [auto] Failed to fetch today's schedule: {e}")
        return

    if not slates:
        print("[Live Scores] No NFL games scheduled today — nothing to do.")
        return

    active = [s for s in slates if slate_needs_polling(s["games"])]
    if not active:
        kicks = ", ".join(f"{s['type']} wk{s['week']}" for s in slates)
        print(f"[Live Scores] Games today ({kicks}) but none live or starting within {LOOKAHEAD_MIN} min — nothing to do yet.")
        return

    for slate in active:
        season, week, season_type = slate["season"], slate["week"], slate["type"]
        print(f"[Live Scores] Active slate: {season_type} week {week} ({season})")
        confirmed_final = False
        while True:
            games, scored_players = run_once(week, season, season_type, dry_run, print_top5=False)
            relevant = relevant_games(games)
            tier = _tier_of(relevant)
            now = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S UTC")

            if relevant:
                print(f"[Live Scores] [{now}] Polling: {', '.join(_describe_game(g) for g in relevant)}")
                highlight_teams = {abbr for g in relevant for abbr in (g["home"]["abbr"], g["away"]["abbr"]) if abbr}
                pool = [p for p in scored_players if p["team"] in highlight_teams]
                print("  top scorers in the game(s) being polled:")
                for p in pool[:5]:
                    print(f"    {p['name']:22} {p['pos']:4} {p['team']:4} {p['pts']:5.1f} pts")
                if not pool:
                    print("    (no recorded stats yet)")
            else:
                print(f"[Live Scores] [{now}] No games currently live or imminent in {season_type} week {week}.")

            if tier == "final":
                if confirmed_final:
                    print(f"[Live Scores] {season_type} week {week}: final confirmed — stopping this slate.")
                    break
                print(f"[Live Scores] {season_type} week {week}: all final — one confirm poll in {FINAL_CONFIRM_DELAY}s, then stopping.")
                confirmed_final = True
                time.sleep(FINAL_CONFIRM_DELAY)
                continue

            confirmed_final = False
            sleep_s = {"live": LIVE_INTERVAL, "halftime": HALFTIME_INTERVAL, "pre": PRE_KICKOFF_INTERVAL}[tier]
            print(f"[Live Scores] {season_type} week {week}: tier={tier} — next poll in {sleep_s}s")
            time.sleep(sleep_s)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--week", type=int)
    parser.add_argument("--season", type=int, default=2026)
    parser.add_argument("--type", choices=["pre", "regular", "post"], default="regular")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--loop", action="store_true", help="Keep polling while a game is live (flat --interval, for manual testing — --auto uses tiered cadence instead)")
    parser.add_argument("--interval", type=int, default=30, help="Seconds between polls in --loop mode")
    parser.add_argument("--auto", action="store_true", help="Check today's real schedule and poll only if something's live/imminent, at a tiered cadence (what Task Scheduler runs)")
    args = parser.parse_args()

    if args.auto:
        run_auto(args.dry_run)
        return

    if args.week is None:
        print("ERROR: --week is required unless --auto is set")
        sys.exit(1)

    if not args.loop:
        run_once(args.week, args.season, args.type, args.dry_run)
        return

    print(f"[Live Scores] Looping every {args.interval}s while a game is live (Ctrl+C to stop)...")
    while True:
        games, _ = run_once(args.week, args.season, args.type, args.dry_run)
        if not any(g["status"]["state"] == "in" for g in games):
            print("[Live Scores] No game currently live — stopping.")
            break
        time.sleep(args.interval)


if __name__ == "__main__":
    main()
