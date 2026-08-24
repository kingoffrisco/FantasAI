"""
Job 3 — Player Writeup Generator (Qwen3:14b)
Generates 2-3 paragraph narrative writeups for fantasy-relevant players.

Reads:  players/player_profiles.json   (Databricks export — stats + ADP + news)
        fantasai/news/player_notes.json (Job 1 output — article headlines)
Writes: players/player_writeups.json

Each writeup covers:
  - 2025 season performance (stats-grounded)
  - Current news / injury context
  - 2026 fantasy outlook with draft positioning

Incremental: caches by a hash of injury_status + recent_news_count + adp_rank +
             recent headline text + total_fantasy_points_2025. Regenerates when
             any of those change, OR unconditionally once a cached entry is
             older than MAX_CACHE_KEY_SKIP_DAYS (21 days) — a hard ceiling so a
             writeup can never go stale forever just because those specific
             signals happened to stay flat.

Two modes:
  --mode rostered   Only players currently on a fantasy roster (nightly, ~15 min)
  --mode all        All fantasy-relevant skill position players (weekly, ~8 hr)

Usage:
  python job3_player_writeups.py --mode rostered
  python job3_player_writeups.py --mode all
  python job3_player_writeups.py --mode rostered --dry-run
  python job3_player_writeups.py --mode all --limit 50
  python job3_player_writeups.py --mode all --pos QB,RB
  python job3_player_writeups.py --mode all --full
"""

import argparse
import hashlib
import json
import os
import re
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

VERIFY_SSL      = False
OLLAMA_URL      = "http://localhost:11434/api/generate"
API_BASE        = "https://api.fantasai.net"
R2_BASE         = f"{API_BASE}/api/v1/r2"
MODEL_TIER1     = "qwen3:14b"   # top-200 ADP — starters, high-value handcuffs
MODEL_TIER2     = "qwen3:8b"    # ADP 201+ — depth players, backups, dart throws
ADP_TIER_CUTOFF = 200           # players ranked above this use MODEL_TIER1
SKILL_POSITIONS = {"QB", "RB", "WR", "TE", "DST"}
BATCH_SIZE      = 40            # upload checkpoint to R2 after every N newly generated writeups

# Back-compat alias used in output metadata
MODEL = MODEL_TIER1

FANTASAI_KEY = os.environ.get("FANTASAI_KEY", "")
if not FANTASAI_KEY:
    print("ERROR: FANTASAI_KEY not set — add to .env")
    sys.exit(1)

HEADERS = {"X-FantasAI-Key": FANTASAI_KEY}


# ── Prompt ──────────────────────────────────────────────────────────────────

WRITEUP_PROMPT = """/no_think
You are a senior fantasy football analyst writing player profiles for a fantasy app.
Write a 2-3 paragraph player writeup. Be direct, analytical, and stats-grounded.
Do NOT invent stats. Only reference numbers provided below.
Do NOT use headers or bullet points — flowing prose only.

PLAYER: {player_name} ({position}, {team})
AGE: {age}  |  NFL EXPERIENCE: {years_exp_label}  |  {physical}
COLLEGE: {college}
INJURY STATUS: {injury_status}

2025 SEASON ({games_played} games):
  Fantasy points: {fantasy_pts:.1f} total  ({ppg:.1f} PPG)
{stats_block}  Touchdowns:     {tds}

{efficiency_block}DRAFT CONTEXT:
  ADP rank (PPR):      {adp_rank_ppr}
  ADP value (PPR):     {adp_ppr}
  ADP rank (Standard): {adp_rank_std}

RECENT NEWS ({news_count} articles in last 30 days):
{news_block}

{college_stats_block}{combine_block}Paragraph 1: {para1_instruction}
Paragraph 2: Discuss current news, team situation, and any injury/role concerns.
Paragraph 3: Give a 2026 fantasy draft outlook — who should target them, at what round, and why.

Write the three paragraphs now (no labels, no headers):"""

DST_WRITEUP_PROMPT = """/no_think
You are a senior fantasy football analyst writing team defense profiles for a fantasy app.
Write a 2-3 paragraph DST writeup. Be direct, analytical, and stats-grounded.
Do NOT invent stats. Only reference numbers provided below.
Do NOT use headers or bullet points — flowing prose only.

DEFENSE: {team} D/ST
INJURY STATUS: {injury_status}

2025 SEASON ({games_played} games):
  Fantasy points: {fantasy_pts:.1f} total  ({ppg:.1f} PPG)
  Sacks:          {sacks}
  Interceptions:  {interceptions}
  Defensive TDs:  {def_tds}
  Points allowed: {pts_allowed}

DRAFT CONTEXT:
  ADP rank (PPR):      {adp_rank_ppr}
  ADP rank (Standard): {adp_rank_std}

RECENT NEWS ({news_count} articles in last 30 days):
{news_block}

Paragraph 1: Summarize the 2025 defensive performance — scoring, turnover generation, big plays.
Paragraph 2: Discuss coaching staff, key personnel, any changes heading into 2026.
Paragraph 3: Give a 2026 fantasy draft outlook — strength of schedule, matchup upside, target round.

Write the three paragraphs now (no labels, no headers):"""


def _news_block(profile: dict, notes_lookup: dict) -> str:
    """Build the news context block from profile + job1 article headlines."""
    lines = []

    for item in (profile.get("recent_news") or [])[:5]:
        if isinstance(item, dict):
            title = item.get("title") or item.get("headline") or ""
            sent  = item.get("sentiment", "")
        elif isinstance(item, (list, tuple)):
            title = str(item[0]) if len(item) > 0 and item[0] else ""
            sent  = str(item[2]) if len(item) > 2 and item[2] else ""
        else:
            continue
        if title:
            lines.append(f"- {title}" + (f" [{sent}]" if sent else ""))

    name_key = profile.get("full_name", "").strip()
    if name_key in notes_lookup:
        player_notes = notes_lookup[name_key]
        articles = (player_notes.get("articles", []) if isinstance(player_notes, dict) else [])
        for a in articles[:3]:
            headline = (a.get("headline") or a.get("note_text") or "") if isinstance(a, dict) else ""
            if headline and not any(headline in l for l in lines):
                lines.append(f"- {headline}")

    return "\n".join(lines) if lines else "No recent news."


def _recent_headline_titles(profile: dict) -> list[str]:
    """Extract just the headline text from profile['recent_news'], same
    defensive shape-handling as _news_block (dict / list-tuple / skip)."""
    titles = []
    for item in (profile.get("recent_news") or [])[:5]:
        if isinstance(item, dict):
            title = item.get("title") or item.get("headline") or ""
        elif isinstance(item, (list, tuple)):
            title = str(item[0]) if len(item) > 0 and item[0] else ""
        else:
            continue
        if title:
            titles.append(title)
    return titles


def _cache_key(profile: dict) -> str:
    # NOTE: recent_news_count staying flat does NOT mean nothing happened —
    # a rolling news window can hold the same *count* of totally different
    # articles (e.g. a contract extension replacing an older story). Hashing
    # the actual headline text, not just how many there are, is what makes
    # the cache actually bust when something newsworthy happens.
    sig = "|".join([
        str(profile.get("injury_status") or ""),
        str(profile.get("recent_news_count") or 0),
        str(profile.get("adp_rank_ppr") or 0),
        str(profile.get("total_fantasy_points_2025") or 0),
        "|".join(_recent_headline_titles(profile)),
    ])
    return hashlib.md5(sig.encode()).hexdigest()[:12]


def _already_fresh(entry: dict, mode: str) -> bool:
    """Return True if this player's writeup is fresh enough to skip."""
    ts = entry.get("generated_at")
    if not ts:
        return False
    try:
        generated = datetime.fromisoformat(ts.replace("Z", "+00:00"))
        now = datetime.now(timezone.utc)
        age_hours = (now - generated).total_seconds() / 3600
        if mode == "rostered":
            return age_hours < 20        # skip if generated within the last 20 hours
        else:
            return age_hours < 6 * 24    # skip if generated within the last 6 days
    except Exception:
        return False


MAX_CACHE_KEY_SKIP_DAYS = 21  # hard ceiling — see _too_stale_to_trust_cache_key


def _too_stale_to_trust_cache_key(entry: dict) -> bool:
    """A matching _cache_key means the signature fields haven't moved, but
    that's a handful of narrow signals (injury/adp/news-count/points) — not
    a guarantee nothing fantasy-relevant happened. This shipped a real bug:
    Bijan Robinson's writeup sat unchanged for 2+ months across every weekly
    "all" run because his cache_key never budged, even through a real
    contract extension. Past this ceiling, force a regenerate regardless of
    cache_key — a stale writeup is worse than a wasted Qwen call.
    """
    ts = entry.get("generated_at")
    if not ts:
        return True
    try:
        generated = datetime.fromisoformat(ts.replace("Z", "+00:00"))
        age_days = (datetime.now(timezone.utc) - generated).total_seconds() / 86400
        return age_days >= MAX_CACHE_KEY_SKIP_DAYS
    except Exception:
        return True


# ── R2 helpers ──────────────────────────────────────────────────────────────

def r2_get(key: str):
    resp = requests.get(
        f"{R2_BASE}/{key}",
        headers=HEADERS,
        timeout=30,
        verify=VERIFY_SSL,
    )
    if resp.status_code == 404:
        return None
    resp.raise_for_status()
    return resp.json()


def r2_put(key: str, payload) -> bool:
    resp = requests.put(
        f"{R2_BASE}/{key}",
        headers={**HEADERS, "Content-Type": "application/json"},
        data=json.dumps(payload, default=str),
        timeout=60,
        verify=VERIFY_SSL,
    )
    ok = resp.status_code in (200, 201)
    print(f"  {'OK' if ok else f'FAIL {resp.status_code}'} -> {key}")
    return ok


# ── Sleeper bio enrichment ──────────────────────────────────────────────────

def load_sleeper_bio() -> dict:
    """Fetch Sleeper all-players endpoint. Returns dict keyed by player_id string."""
    try:
        resp = requests.get(
            "https://api.sleeper.app/v1/players/nfl",
            timeout=60,
            verify=VERIFY_SSL,
        )
        if resp.ok:
            return resp.json()
    except Exception as e:
        print(f"[Job 3] Sleeper bio fetch failed: {e}")
    return {}


def enrich_profiles_with_sleeper(profiles: list, sleeper: dict) -> None:
    """Mutates profiles in-place, filling years_exp, age, height, weight, college from Sleeper."""
    for p in profiles:
        pid = str(p.get("player_id", ""))
        sp  = sleeper.get(pid) or {}
        if not sp:
            continue
        if not p.get("years_exp"):
            p["years_exp"] = sp.get("years_exp")
        if not p.get("age"):
            p["age"] = sp.get("age")
        # Physical / bio fields — only add, never overwrite
        p.setdefault("height_in", sp.get("height"))   # inches
        p.setdefault("weight_lbs", sp.get("weight"))  # lbs
        p.setdefault("college", sp.get("college") or "")
        p.setdefault("rookie_year", (sp.get("metadata") or {}).get("rookie_year"))


# Which yardage categories are actually worth reporting per position — keeps the LLM
# from being handed (and then "grounding" a writeup in) stats that don't apply to a
# position at all, e.g. a QB's receiving yards, which are essentially always 0.
POSITION_STAT_LINES = {
    "QB": [("Passing yards", "pass_yds"), ("Rushing yards", "rush_yds")],
    "RB": [("Rushing yards", "rush_yds"), ("Receiving yards", "recv_yds")],
    "WR": [("Receiving yards", "recv_yds")],
    "TE": [("Receiving yards", "recv_yds")],
}


def _stats_block(pos: str, rush_yds, recv_yds, pass_yds) -> str:
    """Build the indented yardage-stat lines for WRITEUP_PROMPT, limited to whichever
    categories are actually relevant to the player's position."""
    values = {"rush_yds": rush_yds, "recv_yds": recv_yds, "pass_yds": pass_yds}
    lines = POSITION_STAT_LINES.get(pos)
    if lines is None:
        # Unknown/unexpected position — fall back to showing everything rather than
        # silently dropping stats the LLM might actually need.
        lines = [("Rushing yards", "rush_yds"), ("Receiving yards", "recv_yds"), ("Passing yards", "pass_yds")]
    return "".join(f"  {label + ':':<16}{values[key]}\n" for label, key in lines)


def _efficiency_block(pos: str, eff_row: dict) -> str:
    """Build an ADVANCED EFFICIENCY prompt section from a player_efficiency_stats row
    (same source as analysis/breakout_candidates.json — EPA, success rate, explosive plays).
    Returns "" if no row is available so the prompt section is simply omitted."""
    if not eff_row:
        return ""
    lines = []
    epa = eff_row.get("epa_per_opportunity")
    if epa is not None:
        lines.append(f"  EPA per opportunity: {epa:+.2f}")
    sr = eff_row.get("success_rate")
    if sr is not None:
        lines.append(f"  Success rate: {sr * 100:.0f}%")
    explosive = eff_row.get("explosive_rec_rate") if pos in ("WR", "TE") else eff_row.get("explosive_run_rate")
    if explosive is not None:
        label = "Explosive reception rate" if pos in ("WR", "TE") else "Explosive run rate"
        lines.append(f"  {label}: {explosive * 100:.0f}%")
    ypt = eff_row.get("yards_per_target")
    if ypt is not None and pos in ("WR", "TE", "RB"):
        lines.append(f"  Yards per target: {ypt:.1f}")
    elus = eff_row.get("elusiveness_score")
    if elus is not None and pos in ("RB", "QB"):
        lines.append(f"  Elusiveness score: {elus:.0f}/100")
    if not lines:
        return ""
    return "ADVANCED EFFICIENCY (nflverse play-by-play, most recent week charted):\n" + "\n".join(lines) + "\n\n"


def _years_exp_label(profile: dict) -> str:
    """Return a human-readable NFL experience string for the prompt."""
    ye = profile.get("years_exp")
    ry = profile.get("rookie_year")
    if ye is None and ry:
        try:
            ye = 2026 - int(ry)
        except (ValueError, TypeError):
            pass
    if ye is None:
        return "unknown"
    if ye == 0:
        return "Rookie (2026)"
    if ye == 1:
        return "2nd-year player"
    return f"{ye}-year veteran"


def _physical_label(profile: dict) -> str:
    h = profile.get("height_in")
    w = profile.get("weight_lbs")
    if h and w:
        ft, inch = divmod(int(h), 12)
        return f"{ft}'{inch}\", {w} lbs"
    if h:
        ft, inch = divmod(int(h), 12)
        return f"{ft}'{inch}\""
    if w:
        return f"{w} lbs"
    return "—"


def _college_stats_block(profile: dict, college_stats: dict) -> str:
    name = (profile.get("full_name") or "").strip()
    if not name or not college_stats:
        return ""
    key = name.lower()
    seasons = college_stats.get(key)
    if not seasons:
        return ""
    lines = ["COLLEGE PRODUCTION:"]
    for s in sorted(seasons, key=lambda x: x.get("season", 0)):
        yr = s.get("season", "?")
        team = s.get("team", "?")
        rec = s.get("rec", 0) or 0
        rec_yds = s.get("yds", 0) or 0
        td = s.get("td", 0) or 0
        car = s.get("car", 0) or 0
        rush_yds = s.get("rush_yds", 0) or 0
        att = s.get("att", 0) or 0
        completions = s.get("completions", 0) or 0
        pass_yds = s.get("pass_yds", 0) or 0
        parts = [f"  {yr} ({team}):"]
        if completions > 0:
            parts.append(f"Pass {completions}/{att} for {pass_yds} yds, {td} TD")
        if car > 10:
            parts.append(f"Rush {car} att, {rush_yds if rush_yds else rec_yds} yds")
        if rec > 0:
            parts.append(f"Rec {rec} for {rec_yds} yds, {td} TD")
        lines.append(" | ".join(parts))
    return "\n".join(lines) + "\n\n"


def _combine_block(profile: dict, combine_data: dict) -> str:
    name = (profile.get("full_name") or "").strip()
    if not name or not combine_data:
        return ""
    row = combine_data.get(name.lower())
    if not row:
        return ""
    parts = ["COMBINE / ATHLETIC PROFILE:"]
    if row.get("forty"): parts.append(f"  40-yard: {row['forty']}s")
    if row.get("vertical"): parts.append(f"  Vertical: {row['vertical']}\"")
    if row.get("broad_jump"): parts.append(f"  Broad jump: {row['broad_jump']}\"")
    if row.get("bench"): parts.append(f"  Bench: {row['bench']} reps")
    if row.get("wt"): parts.append(f"  Weight: {row['wt']} lbs")
    if row.get("draft_round") and row.get("draft_ovr"):
        parts.append(f"  Draft: Round {row['draft_round']}, Pick #{row['draft_ovr']}")
    if len(parts) <= 1:
        return ""
    return "\n".join(parts) + "\n\n"


def _load_college_stats(conn) -> dict:
    """Load CFBD college stats into a dict keyed by lowercase player name."""
    try:
        rows = conn.execute(
            "SELECT * FROM bronze_cfbd_player_stats"
        ).fetchall()
        cols = [c[0] for c in conn.description]
        by_name = {}
        for row in rows:
            d = dict(zip(cols, row))
            key = (d.get("player_name") or "").lower().strip()
            if not key:
                continue
            if key not in by_name:
                by_name[key] = []
            by_name[key].append(d)
        return by_name
    except Exception:
        return {}


def _load_combine_data(conn) -> dict:
    """Load combine measurables into a dict keyed by lowercase player name."""
    try:
        rows = conn.execute(
            "SELECT * FROM bronze_combine_data WHERE forty IS NOT NULL OR vertical IS NOT NULL"
        ).fetchall()
        cols = [c[0] for c in conn.description]
        by_name = {}
        for row in rows:
            d = dict(zip(cols, row))
            key = (d.get("player_name") or "").lower().strip()
            if key:
                by_name[key] = d
        return by_name
    except Exception:
        return {}


def _load_efficiency_data(conn) -> dict:
    """Load each player's most recent nflverse-derived efficiency row, keyed by lowercase name.
    Same source (player_efficiency_stats) that feeds analysis/breakout_candidates.json."""
    try:
        rows = conn.execute("""
            SELECT * FROM (
                SELECT *, ROW_NUMBER() OVER (
                    PARTITION BY LOWER(TRIM(player_name)) ORDER BY season DESC, week DESC
                ) AS rn
                FROM player_efficiency_stats
            ) WHERE rn = 1
        """).fetchall()
        cols = [c[0] for c in conn.description]
        by_name = {}
        for row in rows:
            d = dict(zip(cols, row))
            key = (d.get("player_name") or "").lower().strip()
            if key:
                by_name[key] = d
        return by_name
    except Exception:
        return {}


# ── Rostered player lookup ───────────────────────────────────────────────────

def load_rostered_names() -> set:
    """
    Returns a set of lowercase full names for players currently on a fantasy roster.
    Tries CBS /api/v1/cbs/players first (live roster sync), then falls back to
    percent_owned > 0 in the players_2026_draft R2 export.
    """
    names = set()

    # Source 1: CBS roster proxy — only returns players assigned to a team
    try:
        resp = requests.get(
            f"{API_BASE}/api/v1/cbs/players",
            headers=HEADERS,
            timeout=20,
            verify=VERIFY_SSL,
        )
        if resp.ok:
            data = resp.json()
            players = data.get("players") or (data if isinstance(data, list) else [])
            for p in players:
                name = (p.get("name") or p.get("full_name") or "").strip()
                # CBS only returns rostered players — any name here is on a roster
                if name:
                    names.add(name.lower())
            if names:
                print(f"[Job 3] Rostered: {len(names)} players from CBS roster sync.")
                return names
    except Exception as e:
        print(f"[Job 3] CBS roster fetch failed: {e} — trying R2 fallback.")

    # Source 2: players_2026_draft R2 export — filter percent_owned > 0
    for path in ["fantasai/players/players_2026_draft.json", "fantasai/players/export_players_2026_draft.json"]:
        raw = r2_get(path)
        if not raw:
            continue
        arr = raw if isinstance(raw, list) else (raw.get("data") or raw.get("players") or [])
        for p in arr:
            owned = float(p.get("percent_owned") or 0)
            if owned > 0:
                name = (p.get("full_name") or p.get("name") or "").strip()
                if name:
                    names.add(name.lower())
        if names:
            print(f"[Job 3] Rostered: {len(names)} players (percent_owned > 0) from {path}.")
            return names

    print("[Job 3] WARNING: Could not determine rostered players — running on all skill players.")
    return set()


# ── Fallback profile loader ──────────────────────────────────────────────────

def _extract_array(raw) -> list:
    if not raw:
        return []
    if isinstance(raw, list):
        return raw
    return raw.get("data") or raw.get("players") or []


def _to_profile(p: dict) -> dict:
    return {
        "player_id":                     p.get("player_id") or p.get("id") or "",
        "full_name":                     p.get("full_name") or p.get("name") or "",
        "position":                      p.get("position") or "",
        "team":                          p.get("team") or "",
        "age":                           p.get("age"),
        "years_exp":                     p.get("years_exp") or p.get("experience"),
        "injury_status":                 p.get("injury_status") or p.get("status") or "",
        "total_fantasy_points_2025":     p.get("total_fantasy_points_2025") or 0,
        "games_played_2025":             p.get("games_played_2025") or 0,
        "avg_fantasy_points_per_game_2025": p.get("avg_fantasy_points_per_game_2025") or 0,
        "rushing_yards_2025":            p.get("rushing_yards_2025") or 0,
        "receiving_yards_2025":          p.get("receiving_yards_2025") or 0,
        "passing_yards_2025":            p.get("passing_yards_2025") or 0,
        "total_touchdowns_2025":         p.get("total_touchdowns_2025") or 0,
        "adp_ppr":                       p.get("adp_ppr") or p.get("adp"),
        "adp_rank_ppr":                  p.get("adp_rank_ppr") or p.get("adp_rank"),
        "adp_standard":                  p.get("adp_standard"),
        "adp_rank_standard":             p.get("adp_rank_standard"),
        "recent_news_count":             p.get("recent_news_count") or 0,
        "avg_news_relevance":            p.get("avg_news_relevance") or 0,
        "recent_news":                   p.get("recent_news") or [],
    }


NAME_SUFFIX_RE = re.compile(r"\b(jr|sr|ii|iii|iv|v)\.?$")


def _normalize_name_for_adp_match(name: str) -> str:
    """Lowercase, strip punctuation and a trailing generational suffix, so
    'Marvin Harrison' (as frozen in the stale Databricks gold_player_profiles
    export) matches 'Marvin Harrison Jr.' (as scraped fresh by ingest_adp.py).
    Without this, every suffixed player's ADP join silently misses and falls
    back to the gold export's frozen 999 sentinel — confirmed live 2026-08-23:
    Marvin Harrison Jr. showed adp_rank_ppr=999 in a writeup despite a real,
    current ADP of 67 in players/adp_ppr.json.
    """
    n = re.sub(r"[.'’]", "", (name or "").strip().lower())
    n = NAME_SUFFIX_RE.sub("", n).strip()
    return re.sub(r"\s+", " ", n)


def _load_fresh_adp_lookup() -> dict:
    """players/player_profiles.json (the Databricks gold export Job 3 reads
    for stats/ADP/news context) has no active producer left in this repo and
    can go stale indefinitely — confirmed frozen at a single profile_updated_at
    of 2026-06-15 with adp_rank_ppr=999 for 636 of its 998 records. The local
    ingest_adp.py pipeline scrapes FantasyPros fresh and correctly, so overlay
    its output on top of the gold export rather than trusting the latter's ADP.
    Returns {normalized_name: {"adp_rank_ppr", "adp_ppr", "adp_rank_standard", "adp_standard"}}.
    """
    lookup: dict = {}
    ppr = r2_get("players/adp_ppr.json") or {}
    for row in (ppr.get("players") or []):
        key = _normalize_name_for_adp_match(row.get("player_name"))
        if key:
            lookup.setdefault(key, {})["adp_rank_ppr"] = row.get("adp_rank")
            lookup[key]["adp_ppr"] = row.get("adp_value")
    std = r2_get("players/adp_standard.json") or {}
    for row in (std.get("players") or []):
        key = _normalize_name_for_adp_match(row.get("player_name"))
        if key:
            lookup.setdefault(key, {})["adp_rank_standard"] = row.get("adp_rank")
            lookup[key]["adp_standard"] = row.get("adp_value")
    print(f"[Job 3] Fresh ADP overlay: {len(lookup)} players from ingest_adp.py's live output.")
    return lookup


def _apply_fresh_adp_overlay(profiles_list: list, adp_lookup: dict) -> int:
    overlaid = 0
    for p in profiles_list:
        key = _normalize_name_for_adp_match(p.get("full_name") or p.get("name"))
        fresh = adp_lookup.get(key)
        if not fresh:
            continue
        p.update(fresh)
        overlaid += 1
    return overlaid


def load_profiles_fallback() -> list:
    """Try existing R2 player exports in priority order, then the live DB endpoint."""
    r2_paths = [
        "fantasai/players/players_2026_draft.json",
        "fantasai/players/export_players_2026_draft.json",
        "players/adp_ppr.json",
    ]
    for path in r2_paths:
        raw = r2_get(path)
        if not raw:
            continue
        arr = _extract_array(raw)
        if arr:
            print(f"[Job 3] Fallback: {len(arr)} players from {path}")
            return [_to_profile(p) for p in arr]

    print(f"[Job 3] Fallback: querying {API_BASE}/api/v1/db/players ...")
    try:
        resp = requests.get(
            f"{API_BASE}/api/v1/db/players",
            headers=HEADERS,
            timeout=30,
            verify=VERIFY_SSL,
        )
        if resp.ok:
            arr = _extract_array(resp.json())
            if arr:
                print(f"[Job 3] Fallback: {len(arr)} players from DB endpoint")
                return [_to_profile(p) for p in arr]
    except Exception as e:
        print(f"[Job 3] DB fallback failed: {e}")

    return []


# ── Model call ──────────────────────────────────────────────────────────────

def generate_writeup(profile: dict, notes_lookup: dict, model: str = MODEL_TIER1, college_stats: dict = None, combine_data: dict = None, efficiency_data: dict = None) -> str:
    news_count  = profile.get("recent_news_count") or 0
    games       = profile.get("games_played_2025") or 0
    fantasy_pts = float(profile.get("total_fantasy_points_2025") or 0)
    ppg         = (fantasy_pts / games) if games > 0 else 0.0
    pos         = (profile.get("position") or "").upper()

    if pos == "DST":
        prompt = DST_WRITEUP_PROMPT.format(
            team           = profile.get("team", "Unknown"),
            injury_status  = profile.get("injury_status") or "Active/Healthy",
            games_played   = games,
            fantasy_pts    = fantasy_pts,
            ppg            = ppg,
            sacks          = profile.get("sacks_2025") or profile.get("sacks") or "—",
            interceptions  = profile.get("interceptions_2025") or profile.get("interceptions") or "—",
            def_tds        = profile.get("defensive_tds_2025") or profile.get("def_tds") or "—",
            pts_allowed    = profile.get("points_allowed_2025") or profile.get("points_allowed") or "—",
            adp_rank_ppr   = profile.get("adp_rank_ppr") or "unranked",
            adp_rank_std   = profile.get("adp_rank_standard") or "unranked",
            news_count     = news_count,
            news_block     = _news_block(profile, notes_lookup),
        )
    else:
        is_rookie = int(profile.get("years_exp") or 99) <= 1
        college_block = _college_stats_block(profile, college_stats) if is_rookie and college_stats else ""
        comb_block = _combine_block(profile, combine_data) if is_rookie and combine_data else ""
        eff_row = (efficiency_data or {}).get((profile.get("full_name") or "").lower().strip())
        eff_block = _efficiency_block(pos, eff_row)
        para1 = ("Summarize their college production and what it means for their NFL transition. Ground it in their actual college stats."
                 if is_rookie and games == 0 and college_block
                 else "Summarize their 2025 performance. Ground it in their actual stats.")

        prompt = WRITEUP_PROMPT.format(
            player_name    = profile.get("full_name", "Unknown"),
            position       = pos,
            team           = profile.get("team", ""),
            age            = profile.get("age") or "—",
            years_exp_label= _years_exp_label(profile),
            physical       = _physical_label(profile),
            college        = profile.get("college") or "—",
            injury_status  = profile.get("injury_status") or "Active/Healthy",
            games_played   = games,
            fantasy_pts    = fantasy_pts,
            ppg            = ppg,
            stats_block    = _stats_block(
                pos,
                profile.get("rushing_yards_2025") or 0,
                profile.get("receiving_yards_2025") or 0,
                profile.get("passing_yards_2025") or 0,
            ),
            tds            = profile.get("total_touchdowns_2025") or 0,
            efficiency_block = eff_block,
            adp_rank_ppr   = profile.get("adp_rank_ppr") or "unranked",
            adp_ppr        = profile.get("adp_ppr") or "—",
            adp_rank_std   = profile.get("adp_rank_standard") or "unranked",
            news_count     = news_count,
            news_block     = _news_block(profile, notes_lookup),
            college_stats_block = college_block,
            combine_block  = comb_block,
            para1_instruction = para1,
        )

    resp = requests.post(
        OLLAMA_URL,
        json={"model": model, "prompt": prompt, "stream": False},
        timeout=300,
    )
    resp.raise_for_status()
    text = resp.json()["response"].strip()

    if text.startswith("```"):
        lines = text.split("\n")
        text = "\n".join(ln for ln in lines if not ln.strip().startswith("```")).strip()

    return text


# ── Checkpoint upload ────────────────────────────────────────────────────────

def upload_checkpoint(players_out: dict, existing: dict, mode: str, batch_num: int, dry_run: bool):
    """Merge current run results with existing R2 data and upload a checkpoint."""
    merged = {**existing, **players_out}   # players_out wins on conflict
    payload = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "model":        MODEL,
        "mode":         mode,
        "player_count": len(merged),
        "players":      merged,
    }
    if dry_run:
        print(f"  [checkpoint {batch_num}] dry-run — skipping upload ({len(players_out)} players so far)")
        return
    print(f"  [checkpoint {batch_num}] uploading {len(merged)} total writeups to R2...")
    r2_put("players/player_writeups.json", payload)


# ── Main ────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--mode",    choices=["rostered", "all"], default="rostered",
                        help="rostered = nightly (players on rosters only); all = weekly (everyone)")
    parser.add_argument("--limit",   type=int,  default=None,  help="Cap player count for testing")
    parser.add_argument("--dry-run", action="store_true",       help="Generate but don't upload")
    parser.add_argument("--full",    action="store_true",       help="Ignore cache, regenerate all")
    parser.add_argument("--pos",     type=str,  default=None,   help="Comma-separated positions, e.g. QB,RB")
    args = parser.parse_args()

    pos_filter = set(p.strip().upper() for p in args.pos.split(",")) if args.pos else None

    print(f"[Job 3] Mode: {'ROSTERED (nightly)' if args.mode == 'rostered' else 'ALL PLAYERS (weekly)'}")

    # ── Load player profiles ─────────────────────────────────────────────────
    print("[Job 3] Loading player profiles from R2...")
    raw = r2_get("players/player_profiles.json")
    if raw:
        profiles_list = raw if isinstance(raw, list) else (raw.get("data") or [])
        seen, deduped = set(), []
        for p in profiles_list:
            key = p.get("player_id") or p.get("full_name") or ""
            if key and key not in seen:
                seen.add(key)
                deduped.append(p)
        if len(deduped) < len(profiles_list):
            print(f"[Job 3] Deduplicated {len(profiles_list)} -> {len(deduped)} profiles.")
        profiles_list = deduped
        print(f"[Job 3] {len(profiles_list)} profiles loaded from gold_player_profiles export.")
    else:
        print("[Job 3] players/player_profiles.json not in R2 yet — using fallback sources.")
        profiles_list = load_profiles_fallback()
        if not profiles_list:
            print("ERROR: No player data available. Exiting.")
            sys.exit(1)
        print(f"[Job 3] Fallback: {len(profiles_list)} profiles ready.")

    # ── Overlay fresh ADP over the (possibly stale) profile export ──────────
    adp_lookup = _load_fresh_adp_lookup()
    if adp_lookup:
        overlaid = _apply_fresh_adp_overlay(profiles_list, adp_lookup)
        print(f"[Job 3] Overlaid fresh ADP onto {overlaid}/{len(profiles_list)} profiles.")

    # ── Enrich profiles with Sleeper bio data ───────────────────────────────
    print("[Job 3] Fetching Sleeper bio data (years_exp, age, height, weight, college)...")
    sleeper_bio = load_sleeper_bio()
    if sleeper_bio:
        enrich_profiles_with_sleeper(profiles_list, sleeper_bio)
        print(f"[Job 3] Sleeper bio loaded — {len(sleeper_bio)} players available.")
    else:
        print("[Job 3] Sleeper bio unavailable — years_exp/physical data may be missing.")

    # ── Load rostered names (only needed in rostered mode) ───────────────────
    rostered_names: set = set()
    if args.mode == "rostered":
        rostered_names = load_rostered_names()
        if not rostered_names:
            print("[Job 3] CBS roster unavailable — using ADP top-200 as rostered proxy.")
            adp_proxy = sorted(
                [p for p in profiles_list if (p.get("adp_rank_ppr") or 9999) <= 200
                 and (p.get("position") or "").upper() in SKILL_POSITIONS],
                key=lambda p: p.get("adp_rank_ppr") or 9999,
            )
            rostered_names = {(p.get("full_name") or "").strip().lower() for p in adp_proxy}
            print(f"[Job 3] ADP proxy: {len(rostered_names)} players (ADP rank <= 200).")

    # ── Load Job 1 player notes ──────────────────────────────────────────────
    print("[Job 3] Loading player notes from R2 (Job 1 enrichment)...")
    notes_raw  = r2_get("fantasai/news/player_notes.json") or {}
    notes_dict = notes_raw.get("players", {}) if isinstance(notes_raw, dict) else {}
    print(f"[Job 3] {len(notes_dict)} player note records available.")

    # ── Load college stats + combine data for rookie writeups ────────────────
    try:
        from db import get_conn as _get_db_conn
        _db = _get_db_conn()
        college_stats = _load_college_stats(_db)
        combine_data = _load_combine_data(_db)
        efficiency_data = _load_efficiency_data(_db)
        _db.close()
        print(f"[Job 3] College stats: {len(college_stats)} players, Combine: {len(combine_data)} players, "
              f"Efficiency: {len(efficiency_data)} players")
    except Exception as e:
        print(f"[Job 3] College/combine/efficiency data unavailable: {e}")
        college_stats = {}
        combine_data = {}
        efficiency_data = {}

    # ── Load existing writeups for incremental skip ──────────────────────────
    existing: dict = {}
    if not args.full:
        existing_data = r2_get("players/player_writeups.json") or {}
        existing = existing_data.get("players", {}) if isinstance(existing_data, dict) else {}
        if existing:
            print(f"[Job 3] Incremental: {len(existing)} existing writeups loaded.")

    # ── Filter and sort candidates ───────────────────────────────────────────
    candidates = []
    for p in profiles_list:
        pos = (p.get("position") or "").upper()
        if pos_filter and pos not in pos_filter:
            continue
        if pos not in SKILL_POSITIONS:
            continue
        has_games = (p.get("games_played_2025") or 0) > 0
        has_news  = (p.get("recent_news_count") or 0) > 0
        has_adp   = (p.get("adp_rank_ppr") or 0) > 0
        if not (has_games or has_news or has_adp):
            continue
        if args.mode == "rostered":
            name = (p.get("full_name") or "").strip().lower()
            if name not in rostered_names:
                continue
        candidates.append(p)

    # Rostered mode: injured + news-heavy players first, then ADP order
    # All mode: same sort
    candidates.sort(key=lambda p: (
        -(p.get("recent_news_count") or 0),
        p.get("adp_rank_ppr") or 9999,
    ))

    if args.limit:
        candidates = candidates[:args.limit]

    est_min = len(candidates) * 31 / 60
    print(f"[Job 3] {len(candidates)} players to process (~{est_min:.0f} min estimated)")

    players_out: dict = {}
    errors        = 0
    newly_generated = 0
    batch_num     = 0

    for i, profile in enumerate(candidates):
        name = profile.get("full_name", f"player_{i}")
        cache_key = _cache_key(profile)

        if not args.full and name in existing:
            entry = existing[name]
            if _already_fresh(entry, args.mode):
                players_out[name] = entry
                print(f"  [{i+1}/{len(candidates)}] {name} (fresh — skipping)")
                continue
            if entry.get("_cache_key") == cache_key and not _too_stale_to_trust_cache_key(entry):
                players_out[name] = entry
                print(f"  [{i+1}/{len(candidates)}] {name} (cached — data unchanged)")
                continue

        adp_rank = profile.get("adp_rank_ppr") or 9999
        model    = MODEL_TIER1 if adp_rank <= ADP_TIER_CUTOFF else MODEL_TIER2
        tier_tag = "14b" if model == MODEL_TIER1 else "8b"

        t0 = time.time()
        try:
            writeup = generate_writeup(profile, notes_dict, model, college_stats, combine_data, efficiency_data)
            elapsed = round(time.time() - t0, 1)
            summary = writeup.split(".")[0].strip() + "." if writeup else ""

            players_out[name] = {
                "player_id":     profile.get("player_id", ""),
                "player_name":   name,
                "position":      profile.get("position", ""),
                "team":          profile.get("team", ""),
                "writeup":       writeup,
                "summary":       summary,
                "injury_status": profile.get("injury_status") or "Active",
                "adp_rank_ppr":  profile.get("adp_rank_ppr"),
                "generated_at":  datetime.now(timezone.utc).isoformat(),
                "_cache_key":    cache_key,
                "_elapsed_sec":  elapsed,
                "_mode":         args.mode,
                "_model":        model,
            }
            newly_generated += 1
            print(f"  [{i+1}/{len(candidates)}] {name} ({profile.get('position')}, {profile.get('team')}) [{tier_tag}] — {elapsed}s")

            # Checkpoint upload every BATCH_SIZE newly generated writeups
            if newly_generated % BATCH_SIZE == 0:
                batch_num += 1
                upload_checkpoint(players_out, existing, args.mode, batch_num, args.dry_run)

        except Exception as e:
            errors += 1
            print(f"  [{i+1}/{len(candidates)}] ERROR {name}: {e}")

    if not players_out:
        print("[Job 3] No writeups generated — exiting")
        sys.exit(1)

    # Final upload — always runs, even if last batch was < BATCH_SIZE
    elapsed_vals = [p.get("_elapsed_sec", 0) for p in players_out.values()]
    total_time   = round(sum(v for v in elapsed_vals if v), 1)
    cached       = len(players_out) - newly_generated - errors
    print(f"\n[Job 3] Done: {newly_generated} new, {cached} cached, {errors} errors | {total_time}s total")

    if args.dry_run:
        merged = {**existing, **players_out}
        out = Path(__file__).parent / "job3_writeups_dry_run.json"
        out.write_text(json.dumps({
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "model": MODEL, "mode": args.mode,
            "player_count": len(merged), "players": merged,
        }, indent=2, default=str))
        print(f"[Job 3] Dry run saved -> {out}")
        return

    print("[Job 3] Final upload to R2...")
    upload_checkpoint(players_out, existing, args.mode, batch_num + 1, dry_run=False)
    print("[Job 3] Complete.")


if __name__ == "__main__":
    main()
