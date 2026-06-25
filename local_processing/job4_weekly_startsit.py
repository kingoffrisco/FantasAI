"""
Job 4 — Weekly Start/Sit Advisor (Qwen3:14b)
Hybrid scoring: deterministic start_score (0-100) + LLM narrative for borderline cases.

Scoring weights:
  30%  Projection vs positional baseline
  20%  Matchup (def rank vs position)
  20%  Opportunity (snap share, targets, carries)
  15%  Team environment (proj vs season avg)
  10%  Recent trend (last week vs avg)
   5%  Weather/injury adjustment

Output per player:
  start_score      0-100  numeric ranking
  matchup_indicator  SMASH / FAVORABLE / NEUTRAL / DIFFICULT / AVOID
  recommendation   START / FLEX / SIT
  confidence       HIGH / MEDIUM / LOW
  summary          ≤20-word sentence
  factors          3 bullets with sentiment

Reads (all from R2):
  fantasai/players/players_2026_draft.json
  fantasai/analysis/defense_vs_pos.json
  fantasai/analysis/weather_forecast.json
  fantasai/news/player_notes.json

Writes:
  fantasai/analysis/weekly_startsit.json

Usage:
  python job4_weekly_startsit.py                 # top 200 players, auto-detect week
  python job4_weekly_startsit.py --dry-run       # run models, don't upload
  python job4_weekly_startsit.py --week 3        # force specific NFL week
  python job4_weekly_startsit.py --limit 10      # cap players (fast test)
  python job4_weekly_startsit.py --pos QB,RB     # specific positions only
  python job4_weekly_startsit.py --full          # ignore cache, regenerate all
  python job4_weekly_startsit.py --top 300       # change pool size (default 200)
  python job4_weekly_startsit.py --all           # all skill players (monthly full run)
"""

import argparse
import json
import os
import re
import sys
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
OLLAMA_URL = "http://localhost:11434/api/generate"
API_BASE   = "https://api.fantasai.net"
R2_BASE    = f"{API_BASE}/api/v1/r2"
MODEL      = "qwen3:14b"
R2_OUT_KEY = "fantasai/analysis/weekly_startsit.json"
BATCH_SIZE = 20
SKILL_POS  = {"QB", "RB", "WR", "TE", "DST"}

DOME_TEAMS = {"ATL", "ARI", "CHI", "DAL", "DET", "HOU", "IND", "LAC", "LAR", "LV", "MIN", "NO"}

FANTASAI_KEY = os.environ.get("FANTASAI_KEY", "")
if not FANTASAI_KEY:
    print("ERROR: FANTASAI_KEY not set — add to .env")
    sys.exit(1)

HEADERS = {"X-FantasAI-Key": FANTASAI_KEY}


# ── Prompt ────────────────────────────────────────────────────────────────────

STARTSIT_PROMPT = """/no_think
You are an expert fantasy football analyst. Analyze this player for Week {week}.
Use ONLY the data below. Output JSON only — no markdown, no explanation.

{json_block}

Score context: start_score {start_score}/100 | matchup: {matchup_indicator}

Return exactly this JSON shape:
{{
  "recommendation": "START",
  "confidence": "HIGH",
  "summary": "one sharp sentence ≤20 words specific to this matchup",
  "factors": [
    {{"label": "Matchup",  "text": "...", "sentiment": "positive"}},
    {{"label": "Usage",    "text": "...", "sentiment": "positive"}},
    {{"label": "Trend",    "text": "...", "sentiment": "neutral"}}
  ]
}}

Rules:
- recommendation: START | FLEX | SIT  (align with start_score: ≥65=START, ≤35=SIT, else FLEX)
- confidence: HIGH | MEDIUM | LOW
- factors: exactly 3 objects, each has label/text/sentiment
- sentiment: positive | negative | neutral
- Injured/Out: always SIT HIGH
"""


# ── R2 helpers ────────────────────────────────────────────────────────────────

def r2_get(key: str):
    try:
        resp = requests.get(f"{R2_BASE}/{key}", headers=HEADERS, timeout=30, verify=VERIFY_SSL)
        if resp.status_code == 404:
            return None
        resp.raise_for_status()
        return resp.json()
    except Exception as e:
        print(f"[R2 GET] {key} — {e}")
        return None


def r2_put(key: str, payload) -> bool:
    try:
        resp = requests.put(
            f"{R2_BASE}/{key}",
            headers={**HEADERS, "Content-Type": "application/json"},
            data=json.dumps(payload, default=str),
            timeout=60, verify=VERIFY_SSL,
        )
        ok = resp.status_code in (200, 201)
        print(f"  {'OK' if ok else f'FAIL {resp.status_code}'} -> {key}")
        return ok
    except Exception as e:
        print(f"[R2 PUT] {key} — {e}")
        return False


# ── Sleeper helpers ───────────────────────────────────────────────────────────

def get_current_nfl_week() -> int:
    try:
        resp = requests.get("https://api.sleeper.app/v1/state/nfl", timeout=10, verify=VERIFY_SSL)
        if resp.ok:
            data = resp.json()
            return int(data.get("display_week") or data.get("week") or 1)
    except Exception as e:
        print(f"[Sleeper] Week detection failed: {e}")
    return 1


def parse_trend_string(trend_str) -> list:
    """Parse numpy array string '[38.8 11.8 23. ...]' into a float list."""
    if not trend_str:
        return []
    if isinstance(trend_str, list):
        return [float(v) for v in trend_str if v is not None]
    s = str(trend_str).strip().strip("[]").replace("\n", " ")
    vals = []
    for tok in s.split():
        try:
            vals.append(float(tok))
        except ValueError:
            pass
    return vals


def weighted_proj_from_trend(trend_vals: list, season_avg: float) -> float:
    """
    Recency-weighted projection from last 3 non-zero weeks.
    Falls back to season_avg if trend is too sparse.
    """
    played = [v for v in trend_vals if v and v > 0]
    if not played:
        return season_avg
    recent = played[-3:]
    if len(recent) >= 3:
        return round(recent[-1] * 0.45 + recent[-2] * 0.35 + recent[-3] * 0.20, 2)
    if len(recent) == 2:
        return round(recent[-1] * 0.60 + recent[-2] * 0.40, 2)
    return recent[-1]


def load_2025_late_season_stats(weeks=(15, 16, 17, 18)) -> dict:
    """
    Fetch the last N weeks of 2025 regular season stats from Sleeper (4 bulk calls).
    Returns {sleeper_player_id: {"proj": float, "avg": float, "last": float}}
    Used as preseason fallback when 2026 proj/avg/last are all zero.
    """
    weekly_pts: dict[str, dict[int, float]] = {}
    for week in weeks:
        try:
            url = f"https://api.sleeper.app/v1/stats/nfl/regular/2025/{week}"
            resp = requests.get(url, timeout=20, verify=VERIFY_SSL)
            if not resp.ok:
                print(f"  [Sleeper] 2025 week {week}: HTTP {resp.status_code}")
                continue
            data = resp.json()
            if not isinstance(data, dict):
                continue
            for pid, stats in data.items():
                if not stats:
                    continue
                pts = float(
                    stats.get("pts_half_ppr")
                    or stats.get("pts_ppr")
                    or stats.get("pts_std")
                    or 0
                )
                if pid not in weekly_pts:
                    weekly_pts[pid] = {}
                weekly_pts[pid][week] = pts
        except Exception as e:
            print(f"  [Sleeper] 2025 week {week} error: {e}")

    result: dict[str, dict] = {}
    for pid, wk_data in weekly_pts.items():
        # Only weeks where the player actually scored (skip byes / DNP)
        played = [(wk, pts) for wk, pts in sorted(wk_data.items()) if pts > 0]
        if not played:
            continue
        pts_vals = [pts for _, pts in played[-3:]]
        avg = round(sum(pts_vals) / len(pts_vals), 2)
        last = pts_vals[-1]
        # Recency-weighted projection
        if len(pts_vals) >= 3:
            proj = round(pts_vals[-1] * 0.45 + pts_vals[-2] * 0.35 + pts_vals[-3] * 0.20, 2)
        elif len(pts_vals) == 2:
            proj = round(pts_vals[-1] * 0.60 + pts_vals[-2] * 0.40, 2)
        else:
            proj = last
        result[pid] = {"proj": proj, "avg": avg, "last": last}
    return result


def proj_from_adp(adp_rank, pos: str) -> float:
    """
    Estimate a fantasy point projection from ADP rank.
    Used as last-resort fallback for rookies and players with no 2025 data.
    ADP 1 -> ~1.8x positional median, ADP 200 -> ~0.3x median.
    """
    try:
        rank = int(float(adp_rank))
    except (TypeError, ValueError):
        return 0.0
    median = POS_PROJ_MEDIANS.get(pos, 10.0)
    factor = max(0.30, 1.80 - (rank - 1) * (1.50 / 199))
    return round(median * factor, 1)


def get_sleeper_snap_trend(player_id: str, season: int = 2026, weeks: int = 4) -> dict:
    if not player_id:
        return {}
    try:
        url = f"https://api.sleeper.app/v1/stats/nfl/player/{player_id}?season_type=regular&season={season}&grouping=week"
        resp = requests.get(url, timeout=15, verify=VERIFY_SSL)
        if not resp.ok:
            return {}
        data = resp.json()
        if not isinstance(data, dict):
            return {}

        week_keys = sorted(data.keys(), key=lambda x: int(x) if x.isdigit() else 0)
        recent = week_keys[-weeks:] if len(week_keys) >= weeks else week_keys

        snaps, targets, carries = [], [], []
        for wk in recent:
            s = data[wk] or {}
            snap_pct = s.get("tm_spc")
            tgt      = s.get("rec_tgt")
            rush     = s.get("rush_att")
            if snap_pct is not None:
                snaps.append(round(float(snap_pct) * 100, 1))
            if tgt is not None:
                targets.append(int(tgt))
            if rush is not None:
                carries.append(int(rush))

        result = {}
        if snaps:
            avg_snap = round(sum(snaps) / len(snaps), 1)
            trend_dir = "^" if len(snaps) >= 2 and snaps[-1] > snaps[0] else ("v" if len(snaps) >= 2 and snaps[-1] < snaps[0] else "-")
            result["snap_pct_trend"] = snaps
            result["avg_snap_pct"]   = avg_snap
            result["snap_trend_dir"] = trend_dir
        if targets:
            result["target_trend"] = targets
            result["avg_targets"]  = round(sum(targets) / len(targets), 1)
        if carries:
            result["carry_trend"] = carries
            result["avg_carries"] = round(sum(carries) / len(carries), 1)
        return result
    except Exception as e:
        print(f"[Sleeper] Snap trend for {player_id}: {e}")
        return {}


# ── Schedule loader ──────────────────────────────────────────────────────────

def load_opponent_lookup(nfl_week: int, season: int = 2026) -> dict:
    """
    Returns {TEAM: opp_str} for the given week.
    opp_str: "@OPP" if away, "OPP" if home.

    Priority:
      1. R2 opponent_lookup.json (if season matches)
      2. nflverse schedules CSV (fetched live)
    """
    # 1. Try R2
    raw = r2_get("fantasai/analysis/opponent_lookup.json")
    if raw and raw.get("season") == season:
        teams = raw.get("teams") or {}
        out = {}
        for team, weeks in teams.items():
            wk_data = (weeks or {}).get(str(nfl_week)) or {}
            opp = (wk_data.get("opponent") or "").upper()
            if opp:
                is_home = wk_data.get("is_home", True)
                out[team.upper()] = opp if is_home else f"@{opp}"
        if out:
            print(f"  Schedule: {len(out)} teams from R2 (season {season} wk {nfl_week})")
            return out

    # 2. ESPN public scoreboard API (covers current + future seasons)
    try:
        url = (
            f"https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard"
            f"?seasontype=2&week={nfl_week}&dates={season}"
        )
        resp = requests.get(url, timeout=20, verify=VERIFY_SSL)
        if not resp.ok:
            print(f"  [Schedule] ESPN HTTP {resp.status_code}")
            return {}
        events = resp.json().get("events") or []
        out = {}
        for ev in events:
            comps = (ev.get("competitions") or [{}])[0]
            teams = comps.get("competitors") or []
            game: dict = {}
            for t in teams:
                abbr    = (t.get("team") or {}).get("abbreviation", "").upper()
                home_aw = t.get("homeAway", "")
                if abbr and home_aw:
                    game[home_aw] = abbr
            home = game.get("home", "")
            away = game.get("away", "")
            if home and away:
                out[home] = away         # home team faces away team
                out[away] = f"@{home}"  # away team travels to home
        if out:
            print(f"  Schedule: {len(out)} teams from ESPN (season {season} wk {nfl_week})")
        else:
            print(f"  Schedule: no {season} week {nfl_week} data from ESPN")
        return out
    except Exception as e:
        print(f"  [Schedule] ESPN fetch error: {e}")
        return {}


# ── Data loaders ──────────────────────────────────────────────────────────────

def load_player_list() -> list:
    for path in [
        "fantasai/players/players_2026_draft.json",
        "fantasai/players/export_players_2026_draft.json",
    ]:
        raw = r2_get(path)
        if not raw:
            continue
        arr = raw if isinstance(raw, list) else (raw.get("data") or raw.get("players") or [])
        if arr:
            print(f"[Job 4] Players: {len(arr)} from {path}")
            return arr
    return []


def load_rostered_names(top_n: int = 200) -> set:
    """Top N players by ECR/ADP as the analysis pool."""
    raw = load_player_list()
    ranked = []
    for p in raw:
        name = (p.get("full_name") or p.get("name") or "").strip()
        pos = (p.get("position") or p.get("pos") or "").upper()
        if not name or pos not in SKILL_POS:
            continue
        ecr = float(p.get("positionRank") or p.get("position_rank")
                     or p.get("ecr") or 9999)
        adp = float(p.get("adp") or p.get("adp_ppr") or p.get("adp_rank_ppr") or 9999)
        rank = min(ecr, adp)
        ranked.append((rank, name.lower()))
    ranked.sort()
    names = set(n for _, n in ranked[:top_n])
    print(f"[Job 4] Top {top_n} players selected for analysis")
    return names


def load_defense_vs_pos(raw) -> dict:
    out = {}
    arr = raw if isinstance(raw, list) else (raw.get("data") or []) if raw else []
    for row in arr:
        team = (row.get("def_team") or row.get("team") or "").upper()
        pos  = (row.get("position") or row.get("pos") or "").upper()
        if team and pos:
            out[(team, pos)] = {
                "rank_vs_pos":     row.get("rank_vs_pos") or row.get("rank") or "?",
                "avg_pts_allowed": row.get("avg_pts_allowed") or row.get("pts_allowed") or "?",
            }
    return out


def load_weather(raw) -> dict:
    if not raw:
        return {}
    if isinstance(raw, dict) and "forecasts" in raw:
        return raw["forecasts"]
    if isinstance(raw, dict) and all(isinstance(v, dict) for v in raw.values() if not isinstance(v, str)):
        return {k.upper(): v for k, v in raw.items() if k not in ("generated_at", "week")}
    if isinstance(raw, list):
        out = {}
        for item in raw:
            team = (item.get("team") or "").upper()
            if team:
                out[team] = item
        return out
    return {}


def load_notes_lookup(raw) -> dict:
    if not raw:
        return {}
    out = {}
    if isinstance(raw, list):
        players_collection = raw
    elif isinstance(raw, dict):
        inner = raw.get("players") or raw.get("data")
        players_collection = inner if inner is not None else raw
    else:
        return {}

    if isinstance(players_collection, list):
        for item in players_collection:
            if not isinstance(item, dict):
                continue
            name  = (item.get("player_name") or "").strip().lower()
            notes = item.get("notes") or []
            texts = [n.get("note_text", "") for n in notes if isinstance(n, dict) and n.get("note_text")]
            if name:
                out[name] = texts
    elif isinstance(players_collection, dict):
        for key, val in players_collection.items():
            if isinstance(val, dict):
                notes = val.get("notes") or []
                texts = [n.get("note_text", "") for n in notes if isinstance(n, dict) and n.get("note_text")]
            elif isinstance(val, list):
                texts = [n.get("note_text", "") for n in val if isinstance(n, dict) and n.get("note_text")]
            else:
                continue
            out[key.lower().strip()] = texts
    return out


# ── Scoring framework ─────────────────────────────────────────────────────────

POS_PROJ_MEDIANS = {"QB": 18.0, "RB": 10.0, "WR": 10.0, "TE": 8.0, "DST": 8.0}

# Depth chart multipliers keyed by position and depth order.
# Reflects how often each depth slot actually produces fantasy points.
# Format: { pos: { depth_order: (healthy_mult, questionable_mult, out_mult) } }
# out_mult = starter is OUT/IR (backup now starts)
# questionable_mult = starter is Q/D (game-time decision)
# healthy_mult = starter is Active (backup sits unless injury)
DC_MULTIPLIERS = {
    "QB":  {1: (1.00, 1.00, 1.00), 2: (0.10, 0.60, 1.00), 3: (0.00, 0.00, 0.00)},
    "RB":  {1: (1.00, 1.00, 1.00), 2: (0.40, 0.70, 0.90), 3: (0.10, 0.20, 0.40)},
    "WR":  {1: (1.00, 1.00, 1.00), 2: (0.60, 0.75, 0.85), 3: (0.25, 0.35, 0.50)},
    "TE":  {1: (1.00, 1.00, 1.00), 2: (0.12, 0.55, 0.95), 3: (0.02, 0.08, 0.20)},
    "DST": {1: (1.00, 1.00, 1.00)},
}
STARTER_OUT_STATUSES = {"OUT", "IR", "NFI-R", "PUP", "SUSPENDED"}
STARTER_DOUBT_STATUSES = {"DOUBTFUL", "QUESTIONABLE"}


def build_depth_chart_lookup(player_list: list) -> dict:
    """
    Returns {(team, pos): [{"depth": int, "name": str, "status": str}, ...]}
    sorted ascending by depth (1 = starter first).
    """
    lookup: dict = {}
    for p in player_list:
        pos  = (p.get("position") or "").upper()
        team = (p.get("team") or "").upper()
        if not team or pos not in SKILL_POS:
            continue
        depth  = p.get("depth_chart_order")
        status = (p.get("injury_status") or p.get("status") or "Active").strip()
        name   = (p.get("full_name") or p.get("name") or "").strip()
        key = (team, pos)
        if key not in lookup:
            lookup[key] = []
        lookup[key].append({
            "depth":  int(depth) if depth is not None else 99,
            "name":   name,
            "status": status,
        })
    for key in lookup:
        lookup[key].sort(key=lambda x: x["depth"])
    return lookup


def depth_chart_multiplier(pos: str, depth_order: int, starter_status: str) -> tuple:
    """
    Returns (multiplier, depth_label) for start score adjustment.
    multiplier: 0.0-1.0 factor applied to raw start score.
    depth_label: human-readable string like "QB1", "RB2 (starter Q)", etc.
    """
    if depth_order is None:
        depth_order = 1
    depth_order = max(1, int(depth_order))

    pos_table = DC_MULTIPLIERS.get(pos, DC_MULTIPLIERS["WR"])
    # Clamp to last defined tier (e.g. depth 4+ uses depth 3 row)
    effective_depth = min(depth_order, max(pos_table.keys()))
    row = pos_table.get(effective_depth, (0.05, 0.10, 0.20))

    starter_up = starter_status.upper() if starter_status else "ACTIVE"
    if starter_up in STARTER_OUT_STATUSES:
        mult  = row[2]
        label = f"{pos}{depth_order} (starter OUT)"
    elif starter_up in STARTER_DOUBT_STATUSES:
        mult  = row[1]
        label = f"{pos}{depth_order} (starter {starter_status})"
    else:
        mult  = row[0]
        label = f"{pos}{depth_order}"

    return mult, label


def matchup_indicator(def_rank) -> str:
    try:
        r = int(def_rank)
    except (TypeError, ValueError):
        return "NEUTRAL"
    if r >= 28:
        return "SMASH"
    if r >= 23:
        return "FAVORABLE"
    if r <= 5:
        return "AVOID"
    if r <= 10:
        return "DIFFICULT"
    return "NEUTRAL"


def weather_penalty_score(player: dict, weather_by_team: dict) -> float:
    """0 = no impact, 5 = severe weather (outdoor + high wind/precip)."""
    team      = (player.get("team") or "").upper()
    opp_raw   = (player.get("opp") or "")
    is_away   = opp_raw.startswith("@")
    opp_clean = opp_raw.lstrip("@").upper()
    home_team = opp_clean if is_away else team

    if home_team in DOME_TEAMS:
        return 0.0

    wx = weather_by_team.get(home_team) or {}
    if not wx:
        return 0.0

    wind   = float(wx.get("wind_mph") or wx.get("wind") or 0)
    precip = float(wx.get("precip_in") or wx.get("precipitation") or 0)

    penalty = 0.0
    if wind > 25:
        penalty += 3.0
    elif wind > 20:
        penalty += 2.0
    elif wind > 15:
        penalty += 1.0
    if precip > 0.10:
        penalty += 1.5
    elif precip > 0.05:
        penalty += 0.5

    return min(5.0, penalty)


def compute_start_score(
    proj: float,
    season_avg: float,
    last_pts: float,
    def_rank,
    snap_pct: float,
    avg_targets: float,
    avg_carries: float,
    pos: str,
    is_out: bool,
    wx_penalty: float,
    injury_status: str = "",
) -> float:
    """
    Returns 0-100 start score.
    Weights: Projection 30%, Matchup 20%, Opportunity 20%,
             Team env 15%, Recent trend 10%, Weather 5%.
    """
    if is_out:
        return 0.0

    # 1. Projection (30 pts)
    median    = POS_PROJ_MEDIANS.get(pos, 10.0)
    proj_norm = min(proj / (median * 1.8), 1.0) if proj > 0 else 0.30
    score     = proj_norm * 30

    # 2. Matchup (20 pts): rank 32 (easiest) -> 1.0, rank 1 (toughest) -> 0.0
    try:
        rank         = int(def_rank)
        matchup_norm = (rank - 1) / 31
    except (TypeError, ValueError):
        matchup_norm = 0.5
    score += matchup_norm * 20

    # 3. Opportunity (20 pts)
    opp_norm = 0.5
    if pos in ("WR", "TE"):
        tgt_norm = min(avg_targets / 8, 1.0) if avg_targets else 0.4
        snp_norm = min(snap_pct / 100, 1.0) if snap_pct else 0.5
        opp_norm = tgt_norm * 0.65 + snp_norm * 0.35
    elif pos == "RB":
        cry_norm = min(avg_carries / 18, 1.0) if avg_carries else 0.4
        tgt_norm = min(avg_targets / 5, 1.0) if avg_targets else 0.3
        snp_norm = min(snap_pct / 100, 1.0) if snap_pct else 0.5
        opp_norm = cry_norm * 0.55 + tgt_norm * 0.25 + snp_norm * 0.20
    elif pos == "QB":
        opp_norm = min(snap_pct / 100, 1.0) if snap_pct else 0.90
    elif pos == "DST":
        opp_norm = 1.0 - matchup_norm  # weak offense = opportunity
    score += opp_norm * 20

    # 4. Recent trend (10 pts)
    trend_norm = 0.5
    if last_pts and season_avg and season_avg > 0:
        delta      = (last_pts - season_avg) / season_avg
        trend_norm = max(0.0, min(1.0, 0.5 + delta))
    score += trend_norm * 10

    # 5. Injury/Weather (15 pts — major weekly swing factor)
    # wx_penalty is 0-5 (higher = worse conditions)
    inj = injury_status.upper()
    if inj in ("DOUBTFUL",):
        score += 0.0  # doubtful = lose all 15 injury/weather pts
    elif inj in ("QUESTIONABLE",):
        score += 5.0  # questionable = keep only 5 of 15 pts
    else:
        score += max(0.0, 15.0 - (wx_penalty / 5.0) * 15.0)

    # 6. Team environment — projection vs season avg as proxy (5 pts)
    env_norm = 0.5
    if season_avg > 0 and proj > 0:
        ratio    = proj / season_avg
        env_norm = min(max((ratio - 0.5) / 1.5, 0), 1.0)
    score += env_norm * 5

    return round(min(100.0, max(0.0, score)), 1)


def auto_recommend(start_score: float, mi: str, is_out: bool, pos: str = "",
                   is_questionable: bool = False, is_doubtful: bool = False,
                   proj: float = 0):
    """
    Returns (recommendation, confidence) for clear-cut cases.
    Returns (None, None) for borderline — send to model.
    """
    if is_out:
        return "SIT", "HIGH"
    if is_doubtful:
        return "SIT", "MEDIUM"
    if start_score >= 75 and mi not in ("AVOID", "DIFFICULT") and not is_questionable:
        return "START", "HIGH"
    if start_score >= 65 and mi in ("SMASH", "FAVORABLE") and not is_questionable:
        return "START", "MEDIUM"
    if is_questionable:
        return "MONITOR", "LOW"
    if start_score <= 20:
        return "SIT", "HIGH"
    if start_score <= 30:
        return "SIT", "MEDIUM"
    if pos in ("RB", "WR", "TE") and proj >= 15 and mi in ("AVOID", "DIFFICULT"):
        return "START - LOWER EXPECTATIONS", "MEDIUM"
    if pos == "DST":
        rec = "START" if start_score >= 50 else "SIT"
        return rec, "MEDIUM"
    return None, None  # borderline — call model


# ── Context builders ──────────────────────────────────────────────────────────

def _matchup_grade(rank) -> str:
    try:
        r = int(rank)
    except (TypeError, ValueError):
        return "Unknown"
    if r >= 28:
        return "SMASH — elite matchup (bottom 5 defense)"
    if r >= 23:
        return "FAVORABLE"
    if r >= 10:
        return "NEUTRAL"
    if r >= 6:
        return "TOUGH"
    return "AVOID — one of the best defenses vs this position"


def _dst_matchup_grade(rank) -> str:
    """DST matchup grade — based on opponent's offensive quality.
    High rank = facing weak offense (good for DST). Low rank = strong offense."""
    try:
        r = int(rank)
    except (TypeError, ValueError):
        return "Unknown"
    if r >= 28:
        return "SMASH — facing bottom 5 offense, expect turnovers and low scoring"
    if r >= 23:
        return "FAVORABLE — weak offense, good sack and turnover upside"
    if r >= 10:
        return "NEUTRAL — average offense, standard DST floor"
    if r >= 6:
        return "DIFFICULT — strong offense, limited ceiling"
    return "AVOID — elite offense with explosive playmakers"


def _weather_label(player: dict, weather_by_team: dict, wx_penalty: float) -> str:
    team      = (player.get("team") or "").upper()
    opp_raw   = (player.get("opp") or "")
    is_away   = opp_raw.startswith("@")
    opp_clean = opp_raw.lstrip("@").upper()
    home_team = opp_clean if is_away else team

    if home_team in DOME_TEAMS:
        return "Indoor — no weather impact"

    wx = weather_by_team.get(home_team) or {}
    if not wx:
        return "No weather data"

    wind   = float(wx.get("wind_mph") or wx.get("wind") or 0)
    temp   = wx.get("temp_f") or wx.get("temp") or "?"
    cond   = wx.get("condition") or "Unknown"
    precip = float(wx.get("precip_in") or wx.get("precipitation") or 0)

    flags = []
    if wind > 20:
        flags.append(f"HIGH WIND {wind:.0f}mph (!)")
    elif wind > 12:
        flags.append(f"Wind {wind:.0f}mph")
    if precip > 0.05:
        flags.append(f"Rain/snow ({precip:.2f}\")")

    flag_str = " | ".join(flags) if flags else "Clear"
    return f"{cond}, {temp}°F, {flag_str}"


def _coverage_note(pos: str, news_texts: list) -> str:
    if pos not in ("WR", "TE"):
        return ""
    keywords = ["shadow", "blanket", "shutdown", "press", "cover", "cornerback"]
    for note in news_texts[:5]:
        if any(kw in note.lower() for kw in keywords):
            return note[:100]
    return ""


def build_player_json(
    p: dict, pos: str, name: str, team: str, opp_display: str,
    has_opp: bool, proj: float, last_pts: float, season_avg: float,
    def_rank, def_avg, matchup_gr: str, snap_data: dict,
    news_texts: list, wx_label: str, start_score: float, mi: str,
    nfl_week: int,
) -> dict:
    """Build the structured data dict passed to the LLM prompt."""
    d: dict = {
        "player":       name,
        "position":     pos,
        "team":         team,
        "opponent":     opp_display,
        "week":         nfl_week,
        "projection_halfppr": proj if proj > 0 else None,
        "last_week_pts":      last_pts if last_pts > 0 else None,
        "season_avg_pts":     season_avg if season_avg > 0 else None,
        "start_score":        start_score,
        "matchup_indicator":  mi,
    }
    if has_opp:
        d["opponent_def_rank_vs_pos"] = def_rank   # 1=toughest, 32=easiest
        d["avg_pts_allowed_to_pos"]   = def_avg
        d["matchup_grade"]            = matchup_gr
    d["weather"] = wx_label
    if snap_data.get("avg_snap_pct") is not None:
        d["snap_share_pct"]   = snap_data["avg_snap_pct"]
        d["snap_trend"]       = snap_data.get("snap_pct_trend", [])
    if snap_data.get("avg_targets") is not None:
        d["avg_targets_per_game"] = snap_data["avg_targets"]
        d["target_trend"]         = snap_data.get("target_trend", [])
    if snap_data.get("avg_carries") is not None:
        d["avg_carries_per_game"] = snap_data["avg_carries"]
        d["carry_trend"]          = snap_data.get("carry_trend", [])
    coverage = _coverage_note(pos, news_texts)
    if coverage:
        d["coverage_alert"] = coverage
    d["recent_news"] = news_texts[:3] if news_texts else []
    return d


# ── Model call ────────────────────────────────────────────────────────────────

def call_qwen(prompt: str) -> str:
    """
    Call Ollama with retry on timeout or empty response.
    Timeout is generous (300s) because when Job 1 is running simultaneously,
    Job 4 requests queue behind it — Ollama processes one request at a time by
    default (set OLLAMA_NUM_PARALLEL=2 in the Ollama service env to allow two
    concurrent requests, but only if GPU VRAM supports two 14B model instances).
    """
    import time as _time
    payload = {
        "model":  MODEL,
        "prompt": prompt,
        "stream": False,
        "options": {
            "temperature": 0.2,
            "num_predict": 2000,  # thinking tokens count against budget; 2000 gives room
            "think": False,       # Qwen3-specific: disable chain-of-thought
        },
    }
    for attempt in range(3):
        try:
            resp = requests.post(OLLAMA_URL, json=payload, timeout=300)
            resp.raise_for_status()
            text = resp.json().get("response", "")
            # Strip <think>...</think> blocks that Qwen3 emits despite /no_think
            text = re.sub(r"<think>[\s\S]*?</think>", "", text, flags=re.IGNORECASE).strip()
            if text:
                return text
            # Empty response — model may still be loading; brief wait then retry
            if attempt < 2:
                print(f"  [Qwen] Empty response (attempt {attempt+1}/3), retrying in 4s...")
                _time.sleep(4)
        except requests.Timeout:
            if attempt < 2:
                print(f"  [Qwen] Timeout (attempt {attempt+1}/3) — another job may be using the model, waiting 10s...")
                _time.sleep(10)
            else:
                raise
        except Exception:
            raise
    return ""


def parse_recommendation(text: str) -> dict | None:
    text = text.strip()
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        pass
    text = re.sub(r"^```(?:json)?\s*", "", text, flags=re.MULTILINE)
    text = re.sub(r"\s*```$", "", text, flags=re.MULTILINE)
    try:
        return json.loads(text.strip())
    except json.JSONDecodeError:
        pass
    m = re.search(r"\{[\s\S]+\}", text)
    if m:
        try:
            return json.loads(m.group(0))
        except json.JSONDecodeError:
            pass
    return None


def clamp_dst_rec(rec: dict, pos: str, start_score: float) -> dict:
    """DST can't roster FLEX — force to START or SIT."""
    if pos == "DST" and rec.get("recommendation") == "FLEX":
        rec["recommendation"] = "START" if start_score >= 50 else "SIT"
    return rec


def validate_rec(rec: dict) -> dict:
    valid_recs = {"START", "SIT", "FLEX", "MONITOR", "START - LOWER EXPECTATIONS"}
    valid_conf = {"HIGH", "MEDIUM", "LOW"}
    valid_sent = {"positive", "negative", "neutral"}

    rec["recommendation"] = (rec.get("recommendation") or "FLEX").upper()
    if rec["recommendation"] not in valid_recs:
        rec["recommendation"] = "FLEX"

    rec["confidence"] = (rec.get("confidence") or "LOW").upper()
    if rec["confidence"] not in valid_conf:
        rec["confidence"] = "MEDIUM"

    rec["summary"] = (rec.get("summary") or "").strip()[:200]

    factors    = rec.get("factors") or []
    clean_facs = []
    for f in factors[:3]:
        if isinstance(f, dict):
            clean_facs.append({
                "label":     str(f.get("label", ""))[:30],
                "text":      str(f.get("text", ""))[:200],
                "sentiment": f.get("sentiment") if f.get("sentiment") in valid_sent else "neutral",
            })
    rec["factors"] = clean_facs
    return rec


def deterministic_factors(
    name: str, pos: str, start_score: float, mi: str, matchup_gr: str,
    opp_display: str, def_rank, def_avg, snap_data: dict, last_pts: float,
    season_avg: float, wx_label: str, is_out: bool, status: str,
    p: dict = None,
) -> list:
    """Generate factor bullets without calling the LLM."""
    if is_out:
        return [
            {"label": "Status",  "text": f"Listed {status} — expected to miss game.", "sentiment": "negative"},
            {"label": "Matchup", "text": f"vs {opp_display} ({matchup_gr})", "sentiment": "neutral"},
            {"label": "Action",  "text": "Find streaming replacement on waiver wire.", "sentiment": "neutral"},
        ]
    facs = []
    # Matchup factor
    mi_sent = "positive" if mi in ("SMASH", "FAVORABLE") else ("negative" if mi in ("AVOID", "DIFFICULT") else "neutral")
    rank_str = f"#{def_rank}/32" if def_rank and def_rank != "?" else ""
    avg_str  = f"{def_avg} pts/game" if def_avg and def_avg != "?" else ""
    detail   = " | ".join(filter(None, [rank_str, avg_str, matchup_gr]))
    facs.append({
        "label":     "Matchup",
        "text":      f"vs {opp_display}{(' -- ' + detail) if detail else ''}.",
        "sentiment": mi_sent,
    })
    # Usage factor — pull from Sleeper snap_data first, fall back to R2 export fields
    usage_parts = []
    _snap = snap_data.get("avg_snap_pct") or float(p.get("snap_pct") or 0) if p else 0
    _tgts = snap_data.get("avg_targets") or float(p.get("avg_targets_g") or 0) if p else 0
    _cars = snap_data.get("avg_carries") or float(p.get("avg_carries_g") or 0) if p else 0
    _tshare = float(p.get("target_share") or 0) if p else 0
    _rz = float(p.get("avg_rz_att_g") or 0) if p else 0
    if _snap:
        usage_parts.append(f"{_snap:.0f}% snap share")
    if _tgts:
        usage_parts.append(f"{_tgts:.1f} tgts/g")
    if _tshare:
        usage_parts.append(f"{_tshare:.0f}% tgt share")
    if _cars:
        usage_parts.append(f"{_cars:.1f} car/g")
    if _rz:
        usage_parts.append(f"{_rz:.1f} RZ att/g")
    usage_text = ", ".join(usage_parts) if usage_parts else "Usage data unavailable."
    facs.append({"label": "Usage", "text": usage_text, "sentiment": "neutral"})
    # Trend factor
    if last_pts and season_avg and season_avg > 0:
        delta_pct = ((last_pts - season_avg) / season_avg) * 100
        if delta_pct >= 25:
            trend_text = f"HOT — {last_pts:.1f} last week vs {season_avg:.1f} avg (+{delta_pct:.0f}%)"
            trend_sent = "positive"
        elif delta_pct <= -25:
            trend_text = f"COLD — {last_pts:.1f} last week vs {season_avg:.1f} avg ({delta_pct:.0f}%)"
            trend_sent = "negative"
        else:
            trend_text = f"On trend — {last_pts:.1f} last, {season_avg:.1f} avg"
            trend_sent = "neutral"
    else:
        trend_text = "No recent game data."
        trend_sent = "neutral"
    facs.append({"label": "Trend", "text": trend_text, "sentiment": trend_sent})
    return facs


def auto_summary(name: str, rec: str, mi: str, opp_display: str, start_score: float,
                 injury_status: str = "") -> str:
    inj = injury_status.upper()
    if inj == "DOUBTFUL":
        return f"Sit {name} — listed Doubtful, unlikely to play vs {opp_display}."
    if inj == "QUESTIONABLE":
        tag = f"{name} is Questionable"
        return f"{tag} vs {opp_display} — have a backup ready in case inactive (score {start_score})."
    if rec == "START":
        return f"{name} is a confident start vs {opp_display} ({mi} matchup, score {start_score})."
    if rec == "SIT":
        return f"Fade {name} this week — {mi} matchup vs {opp_display}, score {start_score}."
    return f"{name} is a borderline FLEX vs {opp_display} — start if needed."


# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--week",    type=int, default=None)
    parser.add_argument("--limit",   type=int, default=None)
    parser.add_argument("--pos",     type=str, default=None)
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--full",    action="store_true")
    parser.add_argument("--all",     action="store_true", help="All skill players, not just top N")
    parser.add_argument("--top",     type=int, default=200, help="Pool size (default 200)")
    args = parser.parse_args()

    pos_filter = set(p.strip().upper() for p in args.pos.split(",")) if args.pos else None

    nfl_week = args.week or get_current_nfl_week()
    print(f"\n[Job 4] NFL Week: {nfl_week}")

    print("[Job 4] Loading R2 data...")
    player_list  = load_player_list()
    opp_lookup   = load_opponent_lookup(nfl_week, season=2026)
    def_vs_pos   = load_defense_vs_pos(r2_get("fantasai/analysis/defense_vs_pos.json"))
    weather_raw  = r2_get("fantasai/analysis/weather_forecast.json")
    weather      = load_weather(weather_raw)
    notes_raw    = r2_get("fantasai/news/player_notes.json")
    notes_lookup = load_notes_lookup(notes_raw)

    # Injury report — cross-reference with player export (which lacks injury_status)
    injury_raw   = r2_get("fantasai/analysis/injury_report.json")
    injury_by_name = {}
    if injury_raw:
        inj_arr = injury_raw if isinstance(injury_raw, list) else (injury_raw.get("data") or [])
        for inj in inj_arr:
            name_key = (inj.get("player_name") or "").lower().strip()
            if name_key and inj.get("injury_status"):
                injury_by_name[name_key] = inj["injury_status"]

    print(f"  Defense matchup rows: {len(def_vs_pos)}")
    print(f"  Weather teams:        {len(weather)}")
    print(f"  News entries:         {len(notes_lookup)}")
    print(f"  Injury reports:       {len(injury_by_name)}")

    # 2025 season stats (avg, last, trend) are embedded in the player export.
    # No additional API calls needed — proj is derived per-player in the loop.
    depth_chart = build_depth_chart_lookup(player_list)
    print(f"  Depth chart entries: {sum(len(v) for v in depth_chart.values())} players across {len(depth_chart)} team/pos slots")

    existing = {}
    if not args.full:
        raw_existing = r2_get(R2_OUT_KEY)
        if raw_existing:
            existing_week = raw_existing.get("week")
            if existing_week == nfl_week:
                existing = raw_existing.get("players") or {}
                print(f"  Cached results week {nfl_week}: {len(existing)} players")

    if args.all:
        rostered_names = set()
        print("[Job 4] --all flag: processing all skill position players")
    else:
        rostered_names = load_rostered_names(top_n=args.top)

    require_opp = not rostered_names and not args.all

    no_opp_count = 0
    candidates   = []
    for p in player_list:
        name = (p.get("full_name") or p.get("name") or "").strip()
        pos  = (p.get("position") or p.get("pos") or "").upper()
        if pos not in SKILL_POS:
            continue
        if pos_filter and pos not in pos_filter:
            continue
        if rostered_names and name.lower() not in rostered_names:
            continue
        raw_opp = p.get("opp") or p.get("opponent") or ""
        team    = (p.get("team") or "").upper()
        has_opp = bool(raw_opp and raw_opp not in ("?", "BYE")) or bool(opp_lookup.get(team))
        if require_opp and not has_opp:
            continue
        if not has_opp:
            no_opp_count += 1
        candidates.append(p)

    if require_opp:
        print("  No roster data — running players with opponents assigned only.")
    if no_opp_count:
        print(f"  {no_opp_count} players have no opponent yet (bye/preseason)")

    if args.limit:
        candidates = candidates[:args.limit]

    print(f"[Job 4] Players to analyze: {len(candidates)}")

    results   = dict(existing)
    processed = 0
    skipped   = 0
    model_calls = 0

    for i, p in enumerate(candidates):
        name  = (p.get("full_name") or p.get("name") or "").strip()
        pos   = (p.get("position") or p.get("pos") or "").upper()
        team  = (p.get("team") or "").upper()
        opp   = p.get("opp") or p.get("opponent") or ""
        # Actual Sleeper ID field in the Databricks export is master_player_id
        pid = str(
            p.get("master_player_id") or p.get("player_id")
            or p.get("sleeper_id") or p.get("id") or ""
        )
        # Fall back to schedule lookup when player data has no opponent
        if (not opp or opp in ("?", "BYE")) and team and opp_lookup:
            opp = opp_lookup.get(team, "")
        has_opp     = bool(opp and opp not in ("?", "BYE"))
        opp_display = opp if has_opp else "TBD"

        if name in existing and not args.full:
            skipped += 1
            continue

        print(f"\n[{i+1}/{len(candidates)}] {name} ({pos}, {team}) vs {opp_display}")

        raw_status = (p.get("injury_status") or p.get("status") or "").strip()
        if not raw_status or raw_status.upper() in ("ACTIVE", "NA", ""):
            raw_status = injury_by_name.get(name.lower(), "Active")
        status = raw_status
        status_up = status.upper()
        is_out  = status_up in ("OUT", "IR", "NFI-R", "PUP", "SUSPENDED", "INJURED_RESERVE")
        is_questionable = status_up in ("QUESTIONABLE", "Q")
        is_doubtful     = status_up in ("DOUBTFUL", "D")

        # Player export has 2025 season stats built in — use them directly.
        # Field names from Databricks export_players_2026_draft:
        #   season_avg_points_2025, last_pts, trend (numpy array string)
        season_avg  = float(p.get("season_avg_points_2025") or p.get("avg") or p.get("avg_pts") or 0)
        last_pts    = float(p.get("last_pts") or p.get("last") or p.get("last_week") or 0)
        trend_vals  = parse_trend_string(p.get("trend") or [])
        # Projection: use full 2025 season average as the preseason baseline.
        # Recency-weighted trend is NOT used for proj — coaches rest starters in
        # Week 17/18, which would unfairly tank elite players' projections.
        # The trend signal is still used separately in the scoring (10% weight).
        proj        = float(p.get("proj") or p.get("projection") or 0)
        proj_source = "2026"
        if proj == 0:
            if season_avg > 0:
                proj        = season_avg   # full-season avg is the best preseason estimate
                proj_source = "2025"
            elif p.get("adp_rank"):
                proj        = proj_from_adp(p["adp_rank"], pos)
                season_avg  = proj
                last_pts    = proj
                proj_source = "adp"

        opp_team = opp.lstrip("@").upper() if has_opp else ""
        if pos == "DST" and opp_team:
            # For DSTs, evaluate the OPPONENT'S OFFENSE — not their defense
            # Look up how many pts the opponent's offense scores (higher = tougher for DST)
            # Use QB + RB + WR avg pts allowed as proxy for offensive quality
            off_pts = []
            for opos in ("QB", "RB", "WR"):
                row = def_vs_pos.get((opp_team, opos)) or {}
                if row.get("avg_pts_allowed"):
                    off_pts.append(float(row["avg_pts_allowed"]))
            if off_pts:
                # Higher avg_pts_allowed = stronger offense = harder for DST
                # Invert: rank 32 (allows most pts = strong offense) is bad for DST
                avg_off = sum(off_pts) / len(off_pts)
                # Get all teams' offensive averages to compute relative rank
                all_off = []
                for t_abbr in set(k[0] for k in def_vs_pos.keys()):
                    t_pts = []
                    for opos in ("QB", "RB", "WR"):
                        r = def_vs_pos.get((t_abbr, opos)) or {}
                        if r.get("avg_pts_allowed"):
                            t_pts.append(float(r["avg_pts_allowed"]))
                    if t_pts:
                        all_off.append(sum(t_pts) / len(t_pts))
                all_off.sort()
                # Rank: 1 = weakest offense (best for DST), 32 = strongest (worst for DST)
                def_rank = 1
                for val in all_off:
                    if avg_off > val:
                        def_rank += 1
                # Invert so high rank = good for DST (facing weak offense)
                def_rank = max(1, len(all_off) + 1 - def_rank)
                def_avg = round(avg_off, 1)
            else:
                def_rank = "?"
                def_avg = "?"
        else:
            def_key  = (opp_team, pos)
            def_row  = def_vs_pos.get(def_key) or {} if opp_team else {}
            def_rank = def_row.get("rank_vs_pos", "?")
            def_avg  = def_row.get("avg_pts_allowed", "?")

        snap_data  = get_sleeper_snap_trend(pid) if pid else {}
        news_texts = notes_lookup.get(name.lower()) or []

        wx_penalty = weather_penalty_score(p, weather) if has_opp else 0.0
        wx_label   = _weather_label(p, weather, wx_penalty) if has_opp else "No game scheduled"

        avg_targets = snap_data.get("avg_targets", 0) or float(p.get("avg_targets_g") or 0)
        avg_carries = snap_data.get("avg_carries", 0) or float(p.get("avg_carries_g") or 0)
        snap_pct    = snap_data.get("avg_snap_pct", 0) or float(p.get("snap_pct") or 0)

        start_score = compute_start_score(
            proj, season_avg, last_pts, def_rank,
            snap_pct, avg_targets, avg_carries, pos,
            is_out, wx_penalty, status,
        )
        mi         = matchup_indicator(def_rank) if has_opp else "NEUTRAL"
        if pos == "DST" and has_opp:
            matchup_gr = _dst_matchup_grade(def_rank)
        else:
            matchup_gr = _matchup_grade(def_rank) if has_opp else "No opponent scheduled"

        # Depth chart adjustment
        depth_order = p.get("depth_chart_order")
        if depth_order is None:
            depth_order = 1
        depth_order = max(1, int(depth_order))
        # Find the starter's injury status for this team/pos
        dc_slot = depth_chart.get((team, pos), [])
        starter_entry = next((x for x in dc_slot if x["depth"] == 1), None)
        starter_status_dc = (starter_entry["status"] if starter_entry else "Active")
        # Don't penalize yourself based on your own status — only look at the depth-1 player
        if depth_order == 1:
            starter_status_dc = "Active"  # starter injury handled by is_out above
        dc_mult, dc_label = depth_chart_multiplier(pos, depth_order, starter_status_dc)
        start_score = round(start_score * dc_mult, 1)

        inj_tag = f" | ⚠ {status}" if (is_questionable or is_doubtful or is_out) else ""
        print(f"  Score: {start_score}/100 | {dc_label} | Matchup: {mi} | Proj: {proj:.1f} ({proj_source}){inj_tag}")

        # Auto-assign clear-cut cases — no model call needed.
        # Also skip model when opponent is TBD: matchup is the model's main value-add,
        # and without it the model hallucinates or stalls, causing empty responses.
        auto_rec, auto_conf = auto_recommend(start_score, mi, is_out, pos, is_questionable, is_doubtful, proj)
        if not has_opp and auto_rec is None:
            # Force deterministic for TBD opponents regardless of score
            auto_rec  = "START" if start_score >= 65 else ("SIT" if start_score <= 35 else "FLEX")
            auto_conf = "LOW"

        if auto_rec:
            rec = {
                "recommendation": auto_rec,
                "confidence":     auto_conf,
                "summary":        auto_summary(name, auto_rec, mi, opp_display, start_score, status),
                "factors":        deterministic_factors(
                    name, pos, start_score, mi, matchup_gr, opp_display,
                    def_rank, def_avg, snap_data, last_pts, season_avg,
                    wx_label, is_out, status, p,
                ),
            }
            print(f"  [OK] {rec['recommendation']} ({rec['confidence']}) -- deterministic")
        else:
            # Borderline — call model for nuanced narrative
            player_json = build_player_json(
                p, pos, name, team, opp_display, has_opp,
                proj, last_pts, season_avg,
                def_rank, def_avg, matchup_gr,
                snap_data, news_texts, wx_label,
                start_score, mi, nfl_week,
            )
            prompt = STARTSIT_PROMPT.format(
                week             = nfl_week,
                json_block       = json.dumps(player_json, indent=2),
                start_score      = start_score,
                matchup_indicator = mi,
            )
            try:
                raw_output = call_qwen(prompt)
                model_calls += 1
                rec = parse_recommendation(raw_output)
                if rec is None:
                    print(f"  [WARN] Parse failed -- raw: {raw_output[:200]}")
                    # Fall back to deterministic
                    rec = {
                        "recommendation": "FLEX",
                        "confidence":     "LOW",
                        "summary":        auto_summary(name, "FLEX", mi, opp_display, start_score, status),
                        "factors":        deterministic_factors(
                            name, pos, start_score, mi, matchup_gr, opp_display,
                            def_rank, def_avg, snap_data, last_pts, season_avg,
                            wx_label, is_out, status,
                        ),
                    }
                else:
                    rec = validate_rec(rec)
                    # Sanity-check: if score strongly disagrees with model, nudge confidence down
                    if rec["recommendation"] == "START" and start_score < 35:
                        rec["confidence"] = "LOW"
                    if rec["recommendation"] == "SIT" and start_score > 65:
                        rec["confidence"] = "LOW"
                print(f"  [OK] {rec['recommendation']} ({rec['confidence']}) -- {rec.get('summary','')[:60]}")
            except Exception as e:
                print(f"  [ERR] Model error: {e}")
                continue

        clamp_dst_rec(rec, pos, start_score)

        rec.update({
            "player_name":       name,
            "pos":               pos,
            "team":              team,
            "opponent":          opp_display,
            "week":              nfl_week,
            "start_score":       start_score,
            "matchup_indicator": mi,
            "depth_label":       dc_label,
            "depth_order":       depth_order,
            "generated_at":      datetime.now(timezone.utc).isoformat(),
            "def_rank":          def_rank,
            "def_avg_pts":       def_avg,
            "matchup_grade":     matchup_gr,
            "matchup_type":      "Offense Matchup" if pos == "DST" else "Defense Matchup",
            "proj":              proj,
            "proj_avg":          season_avg,
            "proj_last":         last_pts,
            "proj_source":       proj_source,
            "injury_status":     status if status_up not in ("ACTIVE", "ACTIVE 2025", "NA", "") else None,
        })

        results[name] = rec
        processed += 1

        if not args.dry_run and processed % BATCH_SIZE == 0:
            payload = {
                "generated_at": datetime.now(timezone.utc).isoformat(),
                "week":         nfl_week,
                "player_count": len(results),
                "players":      results,
            }
            r2_put(R2_OUT_KEY, payload)
            print(f"  [checkpoint] {len(results)} players uploaded")

    payload = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "week":         nfl_week,
        "player_count": len(results),
        "model":        MODEL,
        "players":      results,
    }

    print(f"\n[Job 4] Done — {processed} new, {skipped} cached, {len(results)} total")
    print(f"[Job 4] Model calls: {model_calls} (borderline cases only)")

    if args.dry_run:
        print("[Job 4] DRY RUN — skipping R2 upload")
        sample = list(results.values())[:2]
        print(json.dumps(sample, indent=2, default=str))
    else:
        r2_put(R2_OUT_KEY, payload)
        print(f"[Job 4] Uploaded to {R2_OUT_KEY}")


if __name__ == "__main__":
    main()
