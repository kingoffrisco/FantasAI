"""
Ghost Picks Builder (Qwen3:14b) — runs BEFORE the NFL Draft.

Reads raw team/prospect data from R2, uses Qwen3:14b to generate:
  - Team draft tendency profiles with explanations
  - Per-prospect ghost scores (need + history + rumor + value + athletic)
  - Pre-built "why they might pick this player" explanations

Outputs to R2 (read by the Cloudflare Worker's real-time draft engine):
  fantasai/draft/ghost_picks/team_profiles.json
  fantasai/draft/ghost_picks/prospect_scores.json
  fantasai/draft/ghost_picks/board.json

Input data expected in R2:
  fantasai/draft/ghost_picks/teams_raw.json     — team needs + draft history
  fantasai/draft/ghost_picks/prospects_raw.json — prospect pool with measurables
  fantasai/news/enriched_news.json              — recent rumors/signals

Usage:
  python job_ghost_picks_builder.py             # full build
  python job_ghost_picks_builder.py --dry-run   # don't upload to R2
  python job_ghost_picks_builder.py --team DAL  # rebuild single team only
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

VERIFY_SSL   = False
OLLAMA_URL   = "http://localhost:11434/api/generate"
R2_BASE      = "https://api.fantasai.net/api/v1/r2"
MODEL        = "qwen3:14b"

FANTASAI_KEY = os.environ.get("FANTASAI_KEY", "")
if not FANTASAI_KEY:
    print("ERROR: FANTASAI_KEY not set")
    sys.exit(1)

HEADERS = {"X-FantasAI-Key": FANTASAI_KEY}

# ── Ghost Score weights ────────────────────────────────────────────────────────
WEIGHTS = {
    "need":     0.30,  # positional need (0-100)
    "history":  0.25,  # historical tendency for this position/conference
    "rumor":    0.25,  # news signals: visits, workouts, insider reports
    "value":    0.10,  # positional value at this pick number
    "athletic": 0.10,  # combine/measurable score
}

# ── Prompts ────────────────────────────────────────────────────────────────────

TEAM_PROFILE_PROMPT = """You are an NFL draft analyst. Analyze this team's draft history and produce a structured profile.

Team: {team_name} ({team_code})
Current Needs: {needs}
Draft History (last 5 years): {draft_history}
Free Agency Moves: {fa_moves}
Coaching Staff Notes: {coach_notes}

Return ONLY valid JSON (no markdown):
{{
  "team_code": "{team_code}",
  "team_name": "{team_name}",
  "draft_philosophy": "brief 1-2 sentence description of how this team drafts",
  "position_tendencies": {{
    "QB": <float 0-1>,
    "RB": <float 0-1>,
    "WR": <float 0-1>,
    "TE": <float 0-1>,
    "OL": <float 0-1>,
    "DL": <float 0-1>,
    "LB": <float 0-1>,
    "DB": <float 0-1>,
    "EDGE": <float 0-1>
  }},
  "conference_tendencies": {{
    "SEC": <float 0-1>,
    "Big10": <float 0-1>,
    "ACC": <float 0-1>,
    "Pac12": <float 0-1>,
    "BigXII": <float 0-1>,
    "Other": <float 0-1>
  }},
  "traits_valued": ["speed","physicality","etc — 3-5 traits this team consistently targets"],
  "round1_needs": ["position1","position2","position3"],
  "history_score": <float 0-100, how predictable/consistent is their draft approach>,
  "surprise_factor": <float 0-1, likelihood they trade up/down or take unexpected player>
}}"""

PLAYER_EXPLANATION_PROMPT = """You are an NFL draft analyst. Explain why this NFL team might draft this prospect.

Team: {team_name}
Team needs: {needs}
Team draft tendencies: {tendencies}

Prospect: {player_name} ({position}, {college})
Player traits: {traits}
News signals: {rumors}

Write a 2-3 sentence explanation of why this team might select this player.
Be specific — reference actual team needs, coaching preferences, or historical patterns.
Return ONLY the explanation text, no JSON, no headers."""


# ── Data helpers ───────────────────────────────────────────────────────────────

def r2_get(key: str) -> dict | list | None:
    resp = requests.get(f"{R2_BASE}/{key}", headers=HEADERS, timeout=30, verify=VERIFY_SSL)
    if resp.status_code == 404:
        return None
    resp.raise_for_status()
    return resp.json()


def r2_put(key: str, payload: dict | list) -> bool:
    resp = requests.put(
        f"{R2_BASE}/{key}",
        headers={**HEADERS, "Content-Type": "application/json"},
        data=json.dumps(payload),
        timeout=30,
        verify=VERIFY_SSL,
    )
    ok = resp.status_code in (200, 201)
    print(f"  {'OK' if ok else 'FAIL'} → {key}")
    return ok


def query_model(prompt: str, expect_json: bool = True) -> str | dict:
    resp = requests.post(
        OLLAMA_URL,
        json={"model": MODEL, "prompt": prompt, "stream": False},
        timeout=180,
    )
    resp.raise_for_status()
    raw = resp.json()["response"].strip()
    if expect_json:
        if raw.startswith("```"):
            lines = raw.split("\n")
            raw = "\n".join(l for l in lines if not l.strip().startswith("```"))
        return json.loads(raw)
    return raw


# ── Score calculators (pure math — no AI, runs in Worker too) ─────────────────

def need_score(team: dict, position: str) -> float:
    """0-100: how badly does this team need this position."""
    needs = team.get("needs", {})
    return float(needs.get(position, 0))


def history_score(profile: dict, position: str, conference: str) -> float:
    """0-100: blend of position + conference tendencies from AI-generated profile."""
    pos_val  = profile.get("position_tendencies", {}).get(position, 0.1) * 100
    conf_val = profile.get("conference_tendencies", {}).get(conference, 0.1) * 100
    return round((pos_val * 0.6 + conf_val * 0.4), 1)


def value_score(position: str, pick_number: int) -> float:
    """0-100: is it good value to take this position at this pick?"""
    # Rough value-by-position curves (pick 1-32)
    early  = pick_number <= 10
    mid    = 11 <= pick_number <= 20
    pos_value = {
        "QB":   100 if early else (80 if mid else 50),
        "EDGE": 90  if early else (80 if mid else 65),
        "WR":   80  if early else (75 if mid else 70),
        "OL":   70  if early else (75 if mid else 80),
        "CB":   75  if early else (70 if mid else 65),
        "DL":   70  if early else (65 if mid else 60),
        "RB":   40  if early else (55 if mid else 65),
        "TE":   60  if early else (60 if mid else 55),
        "LB":   55  if early else (60 if mid else 60),
        "DB":   55  if early else (60 if mid else 60),
        "S":    55  if early else (60 if mid else 60),
    }
    return pos_value.get(position, 50)


def rumor_score(player: dict, team_code: str) -> float:
    """0-100: news signal strength for this player → team connection."""
    rumor_scores = player.get("rumor_scores", {})
    return float(rumor_scores.get(team_code, 0))


def athletic_score(player: dict) -> float:
    """0-100: combine/measurable score (provided in prospect data or defaulted)."""
    return float(player.get("athletic_score", 50))


def ghost_score(team: dict, profile: dict, player: dict, pick_number: int) -> dict:
    """Compute full ghost score for a team × player pair."""
    pos      = player.get("position", "")
    conf     = player.get("conference", "Other")
    team_cod = team.get("team_code", "")

    n = need_score(team, pos)
    h = history_score(profile, pos, conf)
    r = rumor_score(player, team_cod)
    v = value_score(pos, pick_number)
    a = athletic_score(player)

    total = round(
        n * WEIGHTS["need"]     +
        h * WEIGHTS["history"]  +
        r * WEIGHTS["rumor"]    +
        v * WEIGHTS["value"]    +
        a * WEIGHTS["athletic"],
        1,
    )
    return {
        "ghost_score":  total,
        "need":         round(n, 1),
        "history":      round(h, 1),
        "rumor":        round(r, 1),
        "value":        round(v, 1),
        "athletic":     round(a, 1),
    }


# ── Builder stages ─────────────────────────────────────────────────────────────

def build_team_profiles(teams_raw: list, target_team: str | None = None) -> dict:
    """Run Qwen3:14b once per team to generate structured tendency profiles."""
    profiles = {}
    for team in teams_raw:
        code = team.get("team_code", "")
        if target_team and code != target_team:
            continue

        print(f"  Building profile: {code} — {team.get('name', '')}...")
        prompt = TEAM_PROFILE_PROMPT.format(
            team_code    = code,
            team_name    = team.get("name", code),
            needs        = json.dumps(team.get("needs", {})),
            draft_history= json.dumps(team.get("draft_history", [])),
            fa_moves     = json.dumps(team.get("fa_moves", [])),
            coach_notes  = team.get("coach_notes", "No notes available"),
        )
        start = time.time()
        try:
            profile = query_model(prompt, expect_json=True)
            elapsed = round(time.time() - start, 1)
            profiles[code] = {**profile, "_generated_at": datetime.now(timezone.utc).isoformat()}
            print(f"    Done in {elapsed}s — philosophy: {profile.get('draft_philosophy','')[:60]}")
        except Exception as e:
            print(f"    ERROR for {code}: {e}")
            profiles[code] = {"team_code": code, "error": str(e)}

    return profiles


def build_prospect_explanations(prospects: list, team_profiles: dict, top_n_per_team: int = 5) -> dict:
    """Generate Qwen3:14b explanations for top ghost score pairings only."""
    explanations: dict[str, dict] = {}  # player_id → { team_code: explanation }

    # Only generate explanations for high-value pairings (score > 60)
    pairings = []
    for player in prospects:
        pid = player.get("player_id", player.get("name", ""))
        for team_code, profile in team_profiles.items():
            if profile.get("error"):
                continue
            # Quick pre-filter: skip if need for this position is very low
            position = player.get("position", "")
            pos_tend = profile.get("position_tendencies", {}).get(position, 0)
            if pos_tend < 0.2:
                continue
            pairings.append((team_code, player, profile))

    # Sort by estimated ghost score, take top N per team
    from collections import defaultdict
    per_team: dict[str, list] = defaultdict(list)
    for team_code, player, profile in pairings:
        per_team[team_code].append((player, profile))

    total_generated = 0
    for team_code, candidates in per_team.items():
        top = candidates[:top_n_per_team]
        for player, profile in top:
            pid    = player.get("player_id", player.get("name", ""))
            prompt = PLAYER_EXPLANATION_PROMPT.format(
                team_name  = profile.get("team_name", team_code),
                needs      = json.dumps(profile.get("round1_needs", [])),
                tendencies = profile.get("draft_philosophy", ""),
                player_name= player.get("name", pid),
                position   = player.get("position", ""),
                college    = player.get("college", ""),
                traits     = ", ".join(player.get("traits", [])),
                rumors     = "; ".join(player.get("news_rumors", [])[:3]),
            )
            try:
                explanation = query_model(prompt, expect_json=False)
                if pid not in explanations:
                    explanations[pid] = {}
                explanations[pid][team_code] = str(explanation).strip()
                total_generated += 1
            except Exception as e:
                print(f"    Explanation error ({pid} × {team_code}): {e}")

    print(f"  Generated {total_generated} team×player explanations")
    return explanations


def build_board(teams_raw: list, prospects: list, team_profiles: dict,
                explanations: dict, round1_picks: dict) -> dict:
    """
    Full draft board: for each pick position, rank all available players
    by ghost score for the drafting team.
    """
    board = {}
    for pick_info in round1_picks:
        pick_num  = pick_info["pick"]
        team_code = pick_info["team"]
        team_data = next((t for t in teams_raw if t["team_code"] == team_code), {})
        profile   = team_profiles.get(team_code, {})

        if not team_data or profile.get("error"):
            continue

        scored = []
        for player in prospects:
            pid   = player.get("player_id", player.get("name", ""))
            score = ghost_score(team_data, profile, player, pick_num)
            expl  = explanations.get(pid, {}).get(team_code, "")
            scored.append({
                "player_id":   pid,
                "player_name": player.get("name", ""),
                "position":    player.get("position", ""),
                "college":     player.get("college", ""),
                "conference":  player.get("conference", ""),
                **score,
                "explanation": expl,
            })

        scored.sort(key=lambda p: p["ghost_score"], reverse=True)
        board[str(pick_num)] = {
            "pick":       pick_num,
            "team":       team_code,
            "team_name":  team_data.get("name", team_code),
            "top_picks":  scored[:10],
        }

    return {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "model":        MODEL,
        "pick_count":   len(board),
        "board":        board,
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--team",    default=None, help="Rebuild one team only (e.g. DAL)")
    parser.add_argument("--skip-explanations", action="store_true",
                        help="Skip per-player explanations (faster run)")
    args = parser.parse_args()

    print(f"[Ghost Picks Builder] Loading data from R2 with {MODEL}...")

    teams_raw    = r2_get("fantasai/draft/ghost_picks/teams_raw.json")
    prospects    = r2_get("fantasai/draft/ghost_picks/prospects_raw.json")
    round1_picks = r2_get("fantasai/draft/ghost_picks/round1_order.json")

    if not teams_raw:
        print("ERROR: fantasai/draft/ghost_picks/teams_raw.json not found in R2")
        print("Upload team needs/history data first. See sample format below:")
        sample = [{
            "team_code": "DAL", "name": "Dallas Cowboys",
            "needs": {"RB": 80, "WR": 60, "OL": 50},
            "draft_history": [{"year": 2025, "picks": [{"round": 1, "position": "OL", "college": "Penn State"}]}],
            "fa_moves": ["Released Pollard", "Signed backup RB"],
            "coach_notes": "Mike McCarthy favors SEC linemen and physical RBs",
        }]
        print(json.dumps(sample, indent=2))
        sys.exit(1)

    if not prospects:
        print("ERROR: fantasai/draft/ghost_picks/prospects_raw.json not found in R2")
        print("Upload prospect pool first.")
        sys.exit(1)

    if not round1_picks:
        print("WARNING: fantasai/draft/ghost_picks/round1_order.json not found — using default 1-32")
        round1_picks = [{"pick": i, "team": f"TEAM_{i}"} for i in range(1, 33)]

    print(f"  {len(teams_raw)} teams | {len(prospects)} prospects | {len(round1_picks)} picks")

    # Stage 1: AI team profiles
    print(f"\n[Stage 1] Building team profiles...")
    existing_profiles = r2_get("fantasai/draft/ghost_picks/team_profiles.json") or {}
    if args.team:
        existing_profiles.update(build_team_profiles(teams_raw, target_team=args.team))
        team_profiles = existing_profiles
    else:
        team_profiles = build_team_profiles(teams_raw)

    # Stage 2: AI explanations
    explanations = {}
    if not args.skip_explanations:
        print(f"\n[Stage 2] Building player explanations...")
        explanations = build_prospect_explanations(prospects, team_profiles)

    # Stage 3: Score every player for every pick (pure math)
    print(f"\n[Stage 3] Computing ghost board...")
    board = build_board(teams_raw, prospects, team_profiles, explanations, round1_picks)
    print(f"  Board: {board['pick_count']} picks computed")

    # Also build a flat prospect_scores.json (player → base athletic/value scores)
    prospect_scores = {
        p.get("player_id", p.get("name", str(i))): {
            "name":          p.get("name", ""),
            "position":      p.get("position", ""),
            "college":       p.get("college", ""),
            "conference":    p.get("conference", "Other"),
            "athletic_score": p.get("athletic_score", 50),
            "traits":        p.get("traits", []),
            "news_rumors":   p.get("news_rumors", []),
            "rumor_scores":  p.get("rumor_scores", {}),
        }
        for i, p in enumerate(prospects)
    }

    if args.dry_run:
        out = Path(__file__).parent / "ghost_picks_dry_run.json"
        out.write_text(json.dumps({
            "team_profiles":   team_profiles,
            "explanations":    explanations,
            "board":           board,
            "prospect_scores": prospect_scores,
        }, indent=2))
        print(f"\n[Ghost Picks] Dry run saved → {out}")
        return

    print("\n[Ghost Picks] Uploading to R2...")
    r2_put("fantasai/draft/ghost_picks/team_profiles.json", team_profiles)
    r2_put("fantasai/draft/ghost_picks/prospect_scores.json", prospect_scores)
    r2_put("fantasai/draft/ghost_picks/board.json", board)

    # Init empty draft state (Worker manages this during the live draft)
    existing_state = r2_get("fantasai/draft/ghost_picks/draft_state.json")
    if not existing_state:
        r2_put("fantasai/draft/ghost_picks/draft_state.json", {
            "picks_made": [],
            "current_pick": 1,
            "available_player_ids": list(prospect_scores.keys()),
            "last_updated": datetime.now(timezone.utc).isoformat(),
        })
        print("  Initialized empty draft state")

    print("\n[Ghost Picks Builder] Complete.")
    print("  Run during draft: the Cloudflare Worker handles real-time pick recording.")
    print("  POST /api/v1/draft/ghost-pick to record each selection.")


if __name__ == "__main__":
    main()
