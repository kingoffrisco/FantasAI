"""
Job 2 — Fantasy Scoring Engine (Qwen3:14b)
Generates per-player scores across all fantasy dimensions.
Stores scores, not conclusions. The UI derives any page
(waiver, trade, start/sit, dynasty, rankings) directly from scores.

Output:
  fantasai/analysis/player_scores.json                master scores file
  fantasai/analysis/waiver_wire_recommendations.json   derived
  fantasai/analysis/trade_values.json                  derived
  fantasai/analysis/lineup_recommendations.json         derived
  fantasai/analysis/drop_candidates.json               derived (sit_score + injury_risk)

Score dimensions per player (0-10 each):
  waiver_score   waiver wire priority (10 = must-add)
  trade_buy      how aggressively to acquire in a trade
  trade_sell     how aggressively to sell high
  start_score    start this week (10 = must-start)
  sit_score      bench this week (10 = must-sit)
  injury_risk    injury concern (10 = high risk)
  dynasty_score  long-term dynasty / keeper value
  matchup_score  favorable matchup this week
  rookie_score   rookie draft / development value

Usage:
  python job2_fantasy_analyzer.py
  python job2_fantasy_analyzer.py --limit 50
  python job2_fantasy_analyzer.py --dry-run
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
OLLAMA_URL = "http://localhost:11434/api/generate"
R2_BASE = "https://api.fantasai.net/api/v1/r2"
MODEL = "qwen3:14b"

FANTASAI_KEY = os.environ.get("FANTASAI_KEY", "")
if not FANTASAI_KEY:
    print("ERROR: FANTASAI_KEY not set — add to .env")
    sys.exit(1)

HEADERS = {"X-FantasAI-Key": FANTASAI_KEY}

# ── Prompt ──────────────────────────────────────────────────────────────────────

SCORE_PROMPT = """You are an expert fantasy football analyst.
Score this player across all fantasy dimensions.

Player: {player_name} ({position}, {team})
Injury status: {injury_status}
Injury flag: {injury_flag}
Latest news: {latest_summary}
Sentiment: {sentiment}
Recent headlines:
{headlines}

Score each dimension 0-10. Use the full range:
10 = elite/must-act, 5 = average, 0 = irrelevant.

Return ONLY valid JSON (no markdown, no explanation):
{{
  "waiver_score":  <float 0-10>,
  "trade_buy":     <float 0-10>,
  "trade_sell":    <float 0-10>,
  "start_score":   <float 0-10>,
  "sit_score":     <float 0-10>,
  "injury_risk":   <float 0-10>,
  "dynasty_score": <float 0-10>,
  "matchup_score": <float 0-10>,
  "rookie_score":  <float 0-10>,
  "waiver_reason": "<one sentence>",
  "trade_reason":  "<one sentence>",
  "start_reason":  "<one sentence>"
}}"""


# ── R2 helpers ──────────────────────────────────────────────────────────────────

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
        data=json.dumps(payload),
        timeout=30,
        verify=VERIFY_SSL,
    )
    ok = resp.status_code in (200, 201)
    status = "OK" if ok else f"FAIL {resp.status_code}"
    print(f"  {status} → {key}")
    return ok


# ── Model call ──────────────────────────────────────────────────────────────────

def score_player(player_data: dict) -> dict:
    articles = player_data.get("articles", [])[:4]
    headline_lines = [
        f"- {a.get('headline', '')}"
        for a in articles if a.get("headline")
    ]
    headlines = "\n".join(headline_lines) or "No recent headlines."

    prompt = SCORE_PROMPT.format(
        player_name=player_data.get("player_name", "Unknown"),
        position=player_data.get("position", ""),
        team=player_data.get("team", ""),
        injury_status=player_data.get("injury_status", "none"),
        injury_flag=player_data.get("injury_flag", False),
        latest_summary=player_data.get("latest_summary", "No recent news."),
        sentiment=player_data.get("latest_sentiment", "neutral"),
        headlines=headlines,
    )
    resp = requests.post(
        OLLAMA_URL,
        json={"model": MODEL, "prompt": prompt, "stream": False},
        timeout=180,
    )
    resp.raise_for_status()
    raw = resp.json()["response"].strip()
    if raw.startswith("```"):
        lines = raw.split("\n")
        raw = "\n".join(
            ln for ln in lines if not ln.strip().startswith("```")
        )
    return json.loads(raw)


# ── Derived files (backward-compat with existing frontend R2 keys) ──────────────

def _priority(score: float) -> str:
    if score >= 8.5:
        return "must_add"
    if score >= 7.0:
        return "strong_add"
    return "speculative"


def _trend(buy: float, sell: float) -> str:
    if sell > buy + 2:
        return "rising"
    if buy > sell + 2:
        return "falling"
    return "stable"


def _advice(buy: float, sell: float) -> str:
    if sell >= 7.5:
        return "sell"
    if buy >= 7.5:
        return "buy"
    return "hold"


def _confidence(score: float) -> str:
    if score >= 8.5:
        return "high"
    if score >= 7.5:
        return "medium"
    return "low"


def derive_waiver_file(scores: dict) -> dict:
    players = sorted(
        [p for p in scores.values() if p.get("waiver_score", 0) >= 5.0],
        key=lambda p: p.get("waiver_score", 0),
        reverse=True,
    )[:40]
    return {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "model": MODEL,
        "recommendations": [
            {
                "player_name": p["player_name"],
                "position": p.get("position", ""),
                "team": p.get("team", ""),
                "priority": _priority(p["waiver_score"]),
                "waiver_score": p["waiver_score"],
                "reason": p.get("waiver_reason", ""),
                "injury_flag": p.get("injury_flag", False),
            }
            for p in players
        ],
    }


def derive_trade_file(scores: dict) -> dict:
    players = sorted(
        scores.values(),
        key=lambda p: max(p.get("trade_buy", 0), p.get("trade_sell", 0)),
        reverse=True,
    )
    buy_lows = [
        p["player_name"] for p in players if p.get("trade_buy", 0) >= 8.0
    ][:10]
    sell_highs = [
        p["player_name"] for p in players if p.get("trade_sell", 0) >= 8.0
    ][:10]
    return {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "model": MODEL,
        "trade_values": [
            {
                "player_name": p["player_name"],
                "position": p.get("position", ""),
                "team": p.get("team", ""),
                "trade_buy": p.get("trade_buy", 5.0),
                "trade_sell": p.get("trade_sell", 5.0),
                "dynasty_score": p.get("dynasty_score", 5.0),
                "trend": _trend(
                    p.get("trade_buy", 5), p.get("trade_sell", 5)
                ),
                "trade_advice": _advice(
                    p.get("trade_buy", 5), p.get("trade_sell", 5)
                ),
                "reason": p.get("trade_reason", ""),
            }
            for p in players
        ],
        "top_buy_lows": buy_lows,
        "top_sell_highs": sell_highs,
    }


def load_player_export() -> dict:
    """Returns lowercase-name → {owned, proj, pos, team} from R2 player export."""
    paths = [
        "fantasai/players/players_2026_draft.json",
        "fantasai/players/export_players_2026_draft.json",
    ]
    for path in paths:
        raw = r2_get(path)
        if not raw:
            continue
        arr = raw if isinstance(raw, list) else (
            raw.get("data") or raw.get("players") or []
        )
        if not arr:
            continue
        lookup = {}
        for p in arr:
            name = (p.get("player_name") or p.get("full_name") or "").strip()
            if not name:
                continue
            lookup[name.lower()] = {
                "owned": float(p.get("ownership_pct") or p.get("percent_owned") or 0),
                "proj":  float(p.get("season_avg_points_2025") or p.get("proj") or 0),
                "pos":   p.get("position") or p.get("pos") or "",
                "team":  p.get("team") or "",
            }
        print(f"[Job 2] Player export loaded: {len(lookup)} players from {path}")
        return lookup
    print("[Job 2] Player export not found — value signal will be zero")
    return {}


def derive_sleeper_file(scored_players: dict, player_export: dict) -> dict:
    """
    Sleeper picks: 50% news signal + 50% value signal.

    News signal (0-10):  Qwen waiver_score, boosted for positive sentiment,
                         penalized for injury flag.
    Value signal (0-10): proj / max(owned, 1), min-max normalized across candidates.
    Filters: owned < 60%, not OUT/IR, fantasy-eligible positions.
    """
    ELIGIBLE_POS = {"QB", "RB", "WR", "TE", "DST"}
    OUT_STATUSES = {"out", "ir", "pup", "susp"}
    MAX_OWNED = 60.0

    candidates = []
    for name, p in scored_players.items():
        pos = p.get("position", "").upper()
        if pos not in ELIGIBLE_POS:
            continue
        if p.get("injury_status", "none").lower() in OUT_STATUSES:
            continue

        export = player_export.get(name.lower().strip(), {})
        owned = export.get("owned", 0.0)
        proj  = export.get("proj", 0.0)

        if owned > MAX_OWNED:
            continue  # already well-known, not a sleeper

        # News signal — Qwen score adjusted for sentiment and injury
        news_raw = float(p.get("waiver_score") or 0)
        if p.get("latest_sentiment") == "positive":
            news_raw = min(10.0, news_raw * 1.15)
        if p.get("injury_flag"):
            news_raw *= 0.6

        candidates.append({
            "player_name":   name,
            "position":      pos,
            "team":          p.get("team") or export.get("team", ""),
            "ownership_pct": owned,
            "projected_pts": proj,
            "news_score":    round(news_raw, 2),
            "_value_raw":    proj / max(owned, 1.0),
            "reason":        p.get("waiver_reason") or p.get("start_reason") or "",
            "sentiment":     p.get("latest_sentiment", "neutral"),
            "injury_flag":   p.get("injury_flag", False),
        })

    if not candidates:
        return {
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "model": MODEL,
            "players": [],
        }

    # Normalize value_raw → 0-10 across the candidate set
    max_val = max(c["_value_raw"] for c in candidates) or 1.0
    for c in candidates:
        c["value_score"]   = round(min(10.0, c["_value_raw"] / max_val * 10.0), 2)
        c["sleeper_score"] = round(c["news_score"] * 0.5 + c["value_score"] * 0.5, 2)
        del c["_value_raw"]

    candidates.sort(key=lambda c: c["sleeper_score"], reverse=True)

    return {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "model": MODEL,
        "formula": "50% news (Qwen waiver_score + sentiment) + 50% value (proj/ownership normalized)",
        "players": candidates[:25],
    }


def derive_drop_file(scores: dict) -> dict:
    players = sorted(
        [p for p in scores.values()
         if p.get("sit_score", 0) >= 6.0 or p.get("injury_risk", 0) >= 7.0],
        key=lambda p: p.get("sit_score", 0) * 0.6 + p.get("injury_risk", 0) * 0.4,
        reverse=True,
    )[:25]
    return {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "model": MODEL,
        "drop_candidates": [
            {
                "player_name":  p["player_name"],
                "position":     p.get("position", ""),
                "team":         p.get("team", ""),
                "sit_score":    p.get("sit_score", 0),
                "injury_risk":  p.get("injury_risk", 0),
                "drop_score":   round(p.get("sit_score", 0) * 0.6 + p.get("injury_risk", 0) * 0.4, 2),
                "reason":       p.get("start_reason", ""),
            }
            for p in players
        ],
    }


def derive_lineup_file(scores: dict) -> dict:
    all_players = list(scores.values())
    starts = sorted(
        [p for p in all_players if p.get("start_score", 0) >= 7.0],
        key=lambda p: -p.get("start_score", 0),
    )[:15]
    sits = sorted(
        [p for p in all_players if p.get("sit_score", 0) >= 6.5],
        key=lambda p: -p.get("sit_score", 0),
    )[:10]
    return {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "model": MODEL,
        "starts": [
            {
                "player_name": p["player_name"],
                "position": p.get("position", ""),
                "team": p.get("team", ""),
                "start_score": p.get("start_score", 0),
                "confidence": _confidence(p["start_score"]),
                "reason": p.get("start_reason", ""),
            }
            for p in starts
        ],
        "sits": [
            {
                "player_name": p["player_name"],
                "position": p.get("position", ""),
                "team": p.get("team", ""),
                "sit_score": p.get("sit_score", 0),
                "reason": p.get("start_reason", ""),
            }
            for p in sits
        ],
    }


# ── Main ────────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--limit", type=int, default=None,
        help="Cap players for quick test",
    )
    parser.add_argument(
        "--dry-run", action="store_true",
        help="Score but don't upload",
    )
    parser.add_argument(
        "--min-relevance", type=float, default=3.0,
        help="Skip players below this relevance (default 3.0)",
    )
    parser.add_argument(
        "--full", action="store_true",
        help="Re-score all players, ignoring existing scores",
    )
    args = parser.parse_args()

    print("[Job 2] Loading player notes from R2...")
    player_notes = r2_get("fantasai/news/player_notes.json")
    injuries = r2_get("fantasai/players/injury_overlay.json") or {}

    if not player_notes or not player_notes.get("players"):
        print("ERROR: player_notes.json not found — run job1 first")
        sys.exit(1)

    # Load existing scores for incremental mode
    existing_scores: dict = {}
    if not args.full:
        existing_data = r2_get("fantasai/analysis/player_scores.json") or {}
        existing_scores = existing_data.get("players", {})
        if existing_scores:
            print(
                "[Job 2] Incremental: %d existing scores loaded"
                % len(existing_scores)
            )

    inj_players = injuries.get("players", injuries) if injuries else {}
    if isinstance(inj_players, dict) and "players" in inj_players:
        inj_players = inj_players["players"]

    players_raw = list(player_notes["players"].values())

    inj_lookup: dict = {}
    if isinstance(inj_players, list):
        inj_lookup = {
            p.get("player_name", p.get("full_name", "")): p
            for p in inj_players
        }
    elif isinstance(inj_players, dict):
        inj_lookup = {
            v.get("player_name", v.get("full_name", k)): v
            for k, v in inj_players.items()
            if isinstance(v, dict)
        }

    enriched = []
    for p in players_raw:
        name = p.get("player_name", "")
        inj = inj_lookup.get(name, {})
        enriched.append({
            **p,
            "position": inj.get("position") or p.get("position", ""),
            "team": inj.get("team") or p.get("team", ""),
        })

    enriched = [
        p for p in enriched
        if p.get("max_relevance", 0) >= args.min_relevance
    ]
    enriched.sort(key=lambda p: p.get("max_relevance", 0), reverse=True)

    if args.limit:
        enriched = enriched[:args.limit]

    print(f"[Job 2] Scoring {len(enriched)} players with {MODEL}...")
    scored_players: dict = {}
    errors = 0

    for i, player in enumerate(enriched):
        name = player.get("player_name", f"player_{i}")

        # Skip if already scored and relevance unchanged
        if existing_scores and name in existing_scores:
            cached_rel = existing_scores[name].get("max_relevance", 0)
            current_rel = player.get("max_relevance", 0)
            if abs(current_rel - cached_rel) < 0.5:
                scored_players[name] = existing_scores[name]
                print(f"  [{i+1}/{len(enriched)}] {name} (cached)")
                continue

        t0 = time.time()
        try:
            scores = score_player(player)
            elapsed = round(time.time() - t0, 1)
            scored_players[name] = {
                "player_name": name,
                "position": player.get("position", ""),
                "team": player.get("team", ""),
                "injury_flag": player.get("injury_flag", False),
                "injury_status": player.get("injury_status", "none"),
                "latest_sentiment": player.get("latest_sentiment", "neutral"),
                "max_relevance": player.get("max_relevance", 0),
                "articles": [
                    {
                        "headline": a.get("headline", ""),
                        "relevance": a.get("relevance", 0),
                    }
                    for a in player.get("articles", [])[:3]
                ],
                **scores,
                "_elapsed_sec": elapsed,
            }
            ws = scores.get("waiver_score", 0)
            ss = scores.get("start_score", 0)
            ds = scores.get("dynasty_score", 0)
            print(
                f"  [{i+1}/{len(enriched)}] {name} "
                f"waiver={ws} start={ss} dynasty={ds} ({elapsed}s)"
            )
        except Exception as e:
            errors += 1
            print(f"  [{i+1}/{len(enriched)}] ERROR {name}: {e}")

    if not scored_players:
        print("[Job 2] No players scored — exiting")
        sys.exit(1)

    # Preserve existing scores for players not in this run's enriched set
    for name, score in existing_scores.items():
        if name not in scored_players:
            scored_players[name] = score

    master = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "model": MODEL,
        "player_count": len(scored_players),
        "players": scored_players,
    }

    waiver_file  = derive_waiver_file(scored_players)
    trade_file   = derive_trade_file(scored_players)
    lineup_file  = derive_lineup_file(scored_players)
    drop_file    = derive_drop_file(scored_players)
    player_export = load_player_export()
    sleeper_file  = derive_sleeper_file(scored_players, player_export)

    elapsed_vals = [p.get("_elapsed_sec", 0) for p in scored_players.values()]
    total_time = round(sum(elapsed_vals), 1)
    avg_time = round(total_time / len(scored_players), 2) if scored_players else 0
    print(
        f"\n[Job 2] Done: {len(scored_players)} scored, "
        f"{errors} errors, {avg_time}s avg"
    )

    if args.dry_run:
        out = Path(__file__).parent / "job2_scores_dry_run.json"
        out.write_text(json.dumps(master, indent=2))
        sl_out = Path(__file__).parent / "job2_sleepers_dry_run.json"
        sl_out.write_text(json.dumps(sleeper_file, indent=2))
        print(f"[Job 2] Dry run saved → {out}")
        print(f"[Job 2] Sleepers dry run → {sl_out} ({len(sleeper_file.get('players', []))} players)")
        return

    print("[Job 2] Uploading to R2...")
    r2_put("fantasai/analysis/player_scores.json", master)
    r2_put("fantasai/analysis/waiver_wire_recommendations.json", waiver_file)
    r2_put("fantasai/analysis/trade_values.json", trade_file)
    r2_put("fantasai/analysis/lineup_recommendations.json", lineup_file)
    r2_put("fantasai/analysis/drop_candidates.json", drop_file)
    r2_put("analysis/sleeper_picks.json", sleeper_file)

    print("[Job 2] Complete.")


if __name__ == "__main__":
    main()
