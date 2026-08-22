"""
Job 5 — Deep Fantasy Reasoner (Qwen3:30b)

This job is intentionally separate from the 8B/14B pipeline jobs. It reads the
structured outputs that the cheaper models already produced, then uses
Qwen3:30b only on the highest-value players where multi-factor reasoning
matters.

Inputs from R2:
  fantasai/analysis/player_scores.json
  fantasai/analysis/breakout_candidates.json
  fantasai/news/player_notes.json

Output to R2:
  fantasai/analysis/deep_reasoning.json

Usage:
  python job5_deep_reasoner.py
  python job5_deep_reasoner.py --limit 15
  python job5_deep_reasoner.py --dry-run
  python job5_deep_reasoner.py --full
"""

import argparse
import hashlib
import json
import os
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

import requests
import urllib3

from ollama_utils import run_ollama_json

urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

try:
    from dotenv import load_dotenv
    load_dotenv(Path(__file__).parent.parent / ".env")
except ImportError:
    pass

VERIFY_SSL = False
API_BASE = "https://api.fantasai.net"
R2_BASE = f"{API_BASE}/api/v1/r2"
MODEL = "qwen3:30b"
R2_OUT_KEY = "fantasai/analysis/deep_reasoning.json"

FANTASAI_KEY = os.environ.get("FANTASAI_KEY", "")
if not FANTASAI_KEY:
    print("ERROR: FANTASAI_KEY not set — add to .env")
    sys.exit(1)

HEADERS = {"X-FantasAI-Key": FANTASAI_KEY}


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


def _normalize(name: str) -> str:
    return (name or "").strip().lower()


def _packet_hash(packet: dict) -> str:
    blob = json.dumps(packet, sort_keys=True, default=str).encode("utf-8")
    return hashlib.md5(blob).hexdigest()[:12]


def load_player_scores() -> dict:
    data = r2_get("fantasai/analysis/player_scores.json") or {}
    players = data.get("players") if isinstance(data, dict) else {}
    return players if isinstance(players, dict) else {}


def load_breakout_candidates() -> dict:
    data = r2_get("fantasai/analysis/breakout_candidates.json") or {}
    arr = data if isinstance(data, list) else (
        data.get("data") or data.get("players") or []
    )
    lookup = {}
    for row in arr:
        if not isinstance(row, dict):
            continue
        name = _normalize(row.get("player_name") or row.get("full_name") or "")
        if name:
            lookup[name] = row
    return lookup


def load_player_notes() -> dict:
    data = r2_get("fantasai/news/player_notes.json") or {}
    players = data.get("players") if isinstance(data, dict) else {}
    return players if isinstance(players, dict) else {}


def build_packet(
    name: str,
    player: dict,
    breakout_lookup: dict,
    notes_lookup: dict,
) -> dict:
    breakout = breakout_lookup.get(_normalize(name), {})
    notes = notes_lookup.get(name, {})
    articles = notes.get("articles", []) if isinstance(notes, dict) else []
    top_articles = []
    for article in articles[:3]:
        if not isinstance(article, dict):
            continue
        top_articles.append({
            "headline": article.get("headline", ""),
            "summary": article.get("summary", article.get("note_text", "")),
            "relevance": article.get("relevance", 0),
            "sentiment": article.get("sentiment", "neutral"),
        })

    return {
        "player_name": name,
        "position": player.get("position", ""),
        "team": player.get("team", ""),
        "injury_status": player.get("injury_status", "none"),
        "injury_flag": bool(player.get("injury_flag", False)),
        "latest_sentiment": player.get("latest_sentiment", "neutral"),
        "latest_summary": (
            player.get("start_reason")
            or player.get("trade_reason")
            or player.get("waiver_reason")
            or ""
        ),
        "job2_scores": {
            "waiver_score": player.get("waiver_score", 0),
            "trade_buy": player.get("trade_buy", 0),
            "trade_sell": player.get("trade_sell", 0),
            "start_score": player.get("start_score", 0),
            "sit_score": player.get("sit_score", 0),
            "injury_risk": player.get("injury_risk", 0),
            "dynasty_score": player.get("dynasty_score", 0),
            "matchup_score": player.get("matchup_score", 0),
            "rookie_score": player.get("rookie_score", 0),
        },
        "breakout_signal": {
            "opportunity_score": breakout.get("opportunity_score", 0),
            "snap_share_delta": breakout.get("snap_share_delta"),
            "avg_snap_share": breakout.get("avg_snap_share"),
            "week": breakout.get("week"),
        },
        "recent_headlines": top_articles,
    }


def candidate_priority(player: dict, packet: dict) -> float:
    breakout = packet.get("breakout_signal", {})
    values = [
        float(player.get("waiver_score") or 0),
        float(player.get("trade_buy") or 0),
        float(player.get("trade_sell") or 0),
        float(player.get("start_score") or 0),
        float(player.get("dynasty_score") or 0),
        float(player.get("matchup_score") or 0),
        float(breakout.get("opportunity_score") or 0),
    ]
    return max(values)


PROMPT_TEMPLATE = """Return exactly one valid JSON object and nothing else.

Use only the provided player packet. This is a deep fantasy reasoning task,
not a summary.

Player packet:
{packet_json}

Rules:
- breakout_score: integer 0-100
- confidence: integer 0-100
- primary_reason: short string
- risk_flag: short string
- recommendation: BUY, HOLD, or AVOID
- Do not invent stats or names
- No markdown, no thinking text, no extra keys
"""


def _consistency_warning(breakout_score: int, recommendation: str) -> str:
    """Flag model output where the recommendation contradicts its own score.

    qwen3:30b occasionally returns e.g. breakout_score=0 with
    recommendation=BUY. There's no cheap way to force the model to be
    internally consistent, so instead of trusting it silently, tag it —
    downstream consumers (and whoever reviews deep_reasoning.json) can see
    which rows to distrust.
    """
    rec = (recommendation or "").upper()
    if rec == "BUY" and breakout_score < 30:
        return f"BUY with low breakout_score ({breakout_score})"
    if rec == "AVOID" and breakout_score > 70:
        return f"AVOID with high breakout_score ({breakout_score})"
    return ""


def _dedup_stutter(text: str) -> str:
    """Collapse an exact immediate word repeat qwen3:30b sometimes emits at the
    end of a generated string (e.g. "...offense offense" -> "...offense").
    Deliberately narrow — only removes an EXACT repeated word, so it can't
    mangle legitimate text. Partial-word stutters ("wit with", "sentime
    sentiment") aren't safely detectable this way and are left alone; they
    show up occasionally and are a known qwen3 flakiness pattern, not a bug
    in this script — flag for a human reviewer instead of guessing a fix.
    """
    if not text:
        return text
    return re.sub(r"\b(\w+)(\s+\1)+\b", r"\1", text, flags=re.IGNORECASE)


def reason_about_player(packet: dict) -> dict:
    prompt = PROMPT_TEMPLATE.format(
        packet_json=json.dumps(packet, indent=2, sort_keys=True, default=str)
    )
    return run_ollama_json(
        MODEL,
        prompt,
        think=False,
        keepalive="30m",
        timeout=240,
    )


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--limit",
        type=int,
        default=20,
        help="Max players to process",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Score but do not upload",
    )
    parser.add_argument(
        "--full",
        action="store_true",
        help="Ignore existing cache",
    )
    args = parser.parse_args()

    print("[Job 5] Loading source data from R2...")
    player_scores = load_player_scores()
    breakout_lookup = load_breakout_candidates()
    notes_lookup = load_player_notes()

    if not player_scores:
        print("ERROR: player_scores.json not found — run job2 first")
        sys.exit(1)

    existing_data = {} if args.full else (r2_get(R2_OUT_KEY) or {})
    existing_players = {}
    if isinstance(existing_data, dict):
        existing_players = existing_data.get("players", {})

    ranked = []
    skipped_unidentified = 0
    for name, player in player_scores.items():
        packet = build_packet(name, player, breakout_lookup, notes_lookup)
        priority = candidate_priority(player, packet)
        if priority <= 0:
            continue
        # No position/team means upstream couldn't confirm this is a real
        # roster player (team names, group references, retired/unrostered
        # names occasionally slip through job1/job2). Not worth spending
        # 30B-model time reasoning about an unidentified entity.
        if not packet.get("position") and not packet.get("team"):
            skipped_unidentified += 1
            continue
        ranked.append((priority, name, packet))

    if skipped_unidentified:
        print(
            f"[Job 5] Skipped {skipped_unidentified} candidates with no "
            f"position/team (likely non-roster names from upstream)"
        )

    ranked.sort(key=lambda item: (-item[0], item[1]))
    selected = ranked[: max(args.limit, 0)]

    print(f"[Job 5] Reasoning about {len(selected)} players with {MODEL}...")
    results: dict = {}
    errors = 0

    for idx, (priority, name, packet) in enumerate(selected, start=1):
        input_hash = _packet_hash(packet)
        cached = {}
        if isinstance(existing_players, dict):
            cached = existing_players.get(name, {})
        if cached and cached.get("input_hash") == input_hash:
            results[name] = cached
            print(f"  [{idx}/{len(selected)}] {name} (cached)")
            continue

        try:
            t0 = datetime.now(timezone.utc)
            output = reason_about_player(packet)
            elapsed = (datetime.now(timezone.utc) - t0).total_seconds()
            breakout_score = int(output.get("breakout_score", 0))
            recommendation = output.get("recommendation", "HOLD")
            warning = _consistency_warning(breakout_score, recommendation)
            results[name] = {
                "player_name": name,
                "position": packet.get("position", ""),
                "team": packet.get("team", ""),
                "priority": round(priority, 2),
                "input_hash": input_hash,
                "breakout_score": breakout_score,
                "confidence": int(output.get("confidence", 0)),
                "primary_reason": _dedup_stutter(output.get("primary_reason", "")),
                "risk_flag": str(output.get("risk_flag", "")).strip().lower(),
                "recommendation": recommendation,
                "_consistency_warning": warning,
                "packet": packet,
                "_elapsed_sec": round(elapsed, 2),
            }
            flag = f" [!] {warning}" if warning else ""
            print(
                f"  [{idx}/{len(selected)}] {name} "
                f"score={results[name]['breakout_score']} "
                f"rec={results[name]['recommendation']} "
                f"({results[name]['_elapsed_sec']}s){flag}"
            )
        except Exception as exc:
            errors += 1
            print(f"  [{idx}/{len(selected)}] ERROR {name}: {exc}")

    master = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "model": MODEL,
        "player_count": len(results),
        "focus": "30B deep reasoning on high-priority fantasy players",
        "players": results,
    }

    if args.dry_run:
        out = Path(__file__).parent / "job5_deep_reasoner_dry_run.json"
        out.write_text(json.dumps(master, indent=2, default=str))
        print(f"[Job 5] Dry run saved -> {out}")
        return

    print("[Job 5] Uploading to R2...")
    r2_put(R2_OUT_KEY, master)
    print(f"[Job 5] Complete — {len(results)} players, {errors} errors")


if __name__ == "__main__":
    main()
