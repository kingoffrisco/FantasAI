"""
Job 1 - Bulk news processor (Qwen3:8b)
Pulls articles from R2, classifies each one, then:
  1. Builds per-player note aggregates -> R2
  2. Extracts beat writer draft signals -> R2

Outputs:
  fantasai/news/player_notes.json
  fantasai/news/ai_summaries.json
  fantasai/draft/ghost_picks/beat_writer_signals.json

Usage:
  python job1_news_processor.py
  python job1_news_processor.py --limit 50
  python job1_news_processor.py --dry-run
"""

import argparse
import hashlib
import json
import os
import re
import sys
import time
from datetime import datetime, timedelta, timezone
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
MODEL = "qwen3:8b"
CACHE_KEY = "fantasai/news/classified_cache.json"
CACHE_TTL_DAYS = 60
LABELS_KEY = "fantasai/labeling/article_labels.json"
FEEDBACK_SCORES_KEY = "fantasai/feedback/article_scores.json"

FANTASAI_KEY = os.environ.get("FANTASAI_KEY", "")
if not FANTASAI_KEY:
    print("ERROR: FANTASAI_KEY not set - add it to .env")
    sys.exit(1)

HEADERS = {"X-FantasAI-Key": FANTASAI_KEY}

# Overridden by --model at runtime
_ACTIVE_MODEL = MODEL

# -- Prompts ----------------------------------------------------------------

CLASSIFY_PROMPT = """Analyze this NFL news snippet for fantasy football.
Return ONLY valid JSON (no markdown, no explanation):
{{
  "players": ["full name(s) of individual NFL players mentioned"],
  "relevance": <float 0-10>,
  "sentiment": "positive|negative|neutral",
  "injury_related": <true|false>,
  "injury_status": "out|doubtful|questionable|probable|active|none",
  "impact_category": "injury|transaction|analysis|performance|other",
  "priority_level": "critical|high|medium|low",
  "waiver_relevance": <float 0-10>,
  "dynasty_relevance": <float 0-10>,
  "rookie_relevance": <float 0-10>,
  "summary": "<one actionable sentence for fantasy managers>"
}}

Rules for "players":
- Only individual human players by first+last name (e.g. "Joe Burrow").
- Never a team, city, or nickname alone (e.g. NOT "49ers", "Bengals", "Cowboys WR").
- Never a vague group reference (e.g. NOT "other Bengals players", "Vikings WR",
  "Colts' Receiver", "Rams' skill players").
- If the article is about a team/defense in general with no named player, return [].

Article: {text}"""

DRAFT_SIGNAL_PROMPT = """Does this article link a team to a draft prospect?
(visits, workouts, combine meetings, insider interest, mock drafts)

Article: {text}

Return ONLY valid JSON (no markdown):
{{
  "is_draft_signal": <true|false>,
  "team": "<NFL team abbreviation or null>",
  "player": "<prospect full name or null>",
  "signal_type": "visit|workout|meeting|interest|mock|other|null",
  "confidence": <float 0-1>
}}"""


# -- Helpers ----------------------------------------------------------------

def _normalize_name(name: str) -> str:
    name = (name or "").strip().lower()
    name = re.sub(r"[.']", "", name)
    name = re.sub(r"\s+(jr|sr|ii|iii|iv)$", "", name)
    name = re.sub(r"\s+", " ", name)
    return name


def load_roster_names() -> dict:
    """normalized name -> canonical full_name, from the 2026 draft roster export.

    Used to reject player names the news-classifier LLM hallucinates or
    over-extracts from article text (team names, generic group references
    like "Vikings WR") — anything that isn't an exact/near-exact match to a
    real roster entry never makes it into player_notes.json.
    """
    for path in (
        "fantasai/players/players_2026_draft.json",
        "fantasai/players/export_players_2026_draft.json",
    ):
        raw = r2_get(path)
        if not raw:
            continue
        arr = raw if isinstance(raw, list) else (
            raw.get("data") or raw.get("players") or []
        )
        lookup = {}
        for p in arr:
            if not isinstance(p, dict):
                continue
            full_name = p.get("full_name") or p.get("player_name") or ""
            if not full_name:
                continue
            lookup[_normalize_name(full_name)] = full_name
        print("[Job 1] Roster loaded: %d players from %s" % (len(lookup), path))
        return lookup
    print("[Job 1] Roster export not found — skipping player-name validation")
    return {}


def _fingerprint(article: dict) -> str:
    """Stable ID for an article — real ID preferred, headline hash as fallback."""
    real = (
        article.get("news_id")
        or article.get("id")
        or article.get("article_id")
    )
    if real and not str(real).isdigit():
        return str(real)
    headline = article.get("headline", article.get("title", ""))
    return "h:" + hashlib.md5(headline.encode()).hexdigest()[:12]


# -- R2 helpers -------------------------------------------------------------

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


def fetch_articles() -> list:
    data = r2_get("fantasai/news/enriched_news.json")
    if data is None:
        return []
    if isinstance(data, list):
        return data
    return data.get("data", data.get("articles", data.get("items", [])))


def r2_put(key: str, payload) -> bool:
    resp = requests.put(
        f"{R2_BASE}/{key}",
        headers={**HEADERS, "Content-Type": "application/json"},
        data=json.dumps(payload),
        timeout=30,
        verify=VERIFY_SSL,
    )
    ok = resp.status_code in (200, 201)
    label = "OK" if ok else "FAIL %d" % resp.status_code
    print("  %s -> %s" % (label, key))
    return ok


def fetch_labels() -> list:
    """Human corrections from the Article Labeler UI — ground truth per article."""
    data = r2_get(LABELS_KEY)
    return data if isinstance(data, list) else []


def fetch_feedback_scores() -> dict:
    """Community quality-tag scores from the News feed's rating widget, keyed by article_url."""
    data = r2_get(FEEDBACK_SCORES_KEY)
    return data if isinstance(data, dict) else {}


def build_alias_map(labels: list) -> dict:
    """LLM-output player name -> human-corrected name, learned from past labels.

    Applied to every future article, not just the one that was labeled — fixes
    recurring LLM naming mistakes (nicknames, suffixes, misspellings) for good.
    """
    alias_map = {}
    for lbl in labels:
        orig  = (lbl.get("original_player_name") or "").strip()
        fixed = (lbl.get("labeled_player_name") or "").strip()
        if orig and fixed and orig.lower() != fixed.lower():
            alias_map[orig.lower()] = fixed
    return alias_map


def build_label_overrides(labels: list) -> dict:
    """article_url -> human ground truth, for exact-match override on re-classification."""
    overrides = {}
    for lbl in labels:
        url = lbl.get("article_url")
        if not url:
            continue
        overrides[url] = {
            "player_name": (lbl.get("labeled_player_name") or "").strip(),
            "is_relevant": lbl.get("is_relevant", True),
        }
    return overrides


def _article_url(article: dict) -> str:
    return (
        article.get("source_url")
        or article.get("article_url")
        or article.get("url")
        or ""
    )


def _apply_player_corrections(players: list, article_url: str, alias_map: dict, overrides: dict) -> list:
    override = overrides.get(article_url)
    if override and override["player_name"]:
        return [override["player_name"]]
    return [alias_map.get((p or "").strip().lower(), p) for p in players]


def _recorrect_cached_articles(articles: list, alias_map: dict, overrides: dict) -> list:
    """Re-apply the current alias map / label overrides to already-classified
    (cached) articles. Labels are usually added against articles that were
    classified in a prior run, so without this a correction would silently
    never take effect unless the article happened to be re-classified from
    scratch (--full). Pure Python transform — no LLM calls, cheap to run
    on every invocation.
    """
    out = []
    for a in articles:
        if not a.get("players"):
            out.append(a)
            continue
        url = a.get("article_url") or ""
        corrected = _apply_player_corrections(a["players"], url, alias_map, overrides)
        out.append({**a, "players": corrected} if corrected != a["players"] else a)
    return out


# -- Model calls ------------------------------------------------------------

def _call_model(prompt: str) -> dict:
    resp = requests.post(
        OLLAMA_URL,
        json={"model": _ACTIVE_MODEL, "prompt": prompt, "stream": False},
        timeout=120,
    )
    resp.raise_for_status()
    raw = resp.json()["response"].strip()
    if raw.startswith("```"):
        raw = "\n".join(
            line for line in raw.split("\n")
            if not line.strip().startswith("```")
        )
    return json.loads(raw)


def classify_article(text: str) -> dict:
    return _call_model(CLASSIFY_PROMPT.format(text=text[:900]))


def extract_draft_signal(text: str) -> dict:
    return _call_model(DRAFT_SIGNAL_PROMPT.format(text=text[:700]))


# -- Aggregation helpers ----------------------------------------------------

def build_player_notes(classified: list, roster_lookup: dict = None) -> dict:
    players: dict = {}
    dropped_non_roster = 0

    for item in classified:
        for player in item.get("players", []):
            if not player or len(player) < 3:
                continue
            name = player.strip()
            if roster_lookup:
                canonical = roster_lookup.get(_normalize_name(name))
                if not canonical:
                    dropped_non_roster += 1
                    continue
                name = canonical
            if name not in players:
                players[name] = {
                    "player_name": name,
                    "articles": [],
                    "injury_flag": False,
                    "injury_status": "none",
                    "max_relevance": 0.0,
                    "max_waiver_relevance": 0.0,
                    "max_dynasty_relevance": 0.0,
                    "max_rookie_relevance": 0.0,
                    "latest_summary": "",
                    "latest_sentiment": "neutral",
                    "article_count": 0,
                }
            entry = players[name]
            entry["article_count"] += 1

            rel = item.get("relevance", 0)
            if rel > entry["max_relevance"]:
                entry["max_relevance"] = rel
                entry["latest_summary"] = item.get("summary", "")
                entry["latest_sentiment"] = item.get("sentiment", "neutral")

            wrel = item.get("waiver_relevance", 0)
            if wrel > entry["max_waiver_relevance"]:
                entry["max_waiver_relevance"] = wrel

            drel = item.get("dynasty_relevance", 0)
            if drel > entry["max_dynasty_relevance"]:
                entry["max_dynasty_relevance"] = drel

            rrel = item.get("rookie_relevance", 0)
            if rrel > entry["max_rookie_relevance"]:
                entry["max_rookie_relevance"] = rrel

            if item.get("injury_related"):
                entry["injury_flag"] = True
                status = item.get("injury_status", "none")
                if status != "none":
                    entry["injury_status"] = status

            entry["articles"].append({
                "headline": item.get("headline", "")[:100],
                "summary": item.get("summary", ""),
                "relevance": rel,
                "waiver_relevance": wrel,
                "dynasty_relevance": drel,
                "rookie_relevance": rrel,
                "priority": item.get("priority_level", "low"),
                "sentiment": item.get("sentiment", "neutral"),
                "injury_related": item.get("injury_related", False),
            })

    for p in players.values():
        p["articles"] = sorted(
            p["articles"], key=lambda a: a["relevance"], reverse=True
        )[:5]

    if roster_lookup and dropped_non_roster:
        print(
            "[Job 1] Dropped %d non-roster name mentions (team names, "
            "vague group references, etc.)" % dropped_non_roster
        )

    return {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "player_count": len(players),
        "players": players,
    }


def build_ai_summaries(classified: list, feedback_scores: dict = None, top_n: int = 50) -> dict:
    feedback_scores = feedback_scores or {}
    priority_order = {"critical": 0, "high": 1, "medium": 2, "low": 3}
    fb_score = lambda a: feedback_scores.get(a.get("article_url", ""), {}).get("score", 0)
    top = sorted(
        [
            a for a in classified
            if a.get("priority_level") in ("critical", "high")
        ],
        key=lambda a: (
            priority_order.get(a.get("priority_level", "low"), 3),
            -fb_score(a),
            -a.get("relevance", 0),
        ),
    )[:top_n]
    return {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "article_count": len(top),
        "summaries": [
            {
                "headline": a.get("headline", ""),
                "summary": a.get("summary", ""),
                "players": a.get("players", []),
                "relevance": a.get("relevance", 0),
                "waiver_relevance": a.get("waiver_relevance", 0),
                "dynasty_relevance": a.get("dynasty_relevance", 0),
                "rookie_relevance": a.get("rookie_relevance", 0),
                "priority_level": a.get("priority_level", "low"),
                "sentiment": a.get("sentiment", "neutral"),
                "injury_related": a.get("injury_related", False),
                "source": a.get("source", ""),
            }
            for a in top
        ],
    }


def build_beat_writer_signals(classified: list) -> dict:
    """
    Aggregate team x player draft signals from beat writer articles.
    Feeds the Ghost Picks engine's rumor_scores.
    """
    signals: list = []
    rumor_scores: dict = {}

    for item in classified:
        sig = item.get("_draft_signal")
        if not sig or not sig.get("is_draft_signal"):
            continue
        team = sig.get("team")
        player = sig.get("player")
        confidence = float(sig.get("confidence", 0))
        if not team or not player or confidence < 0.4:
            continue

        signals.append({
            "team": team,
            "player": player,
            "signal_type": sig.get("signal_type", "other"),
            "confidence": confidence,
            "headline": item.get("headline", "")[:100],
            "source": item.get("source", ""),
        })

        if player not in rumor_scores:
            rumor_scores[player] = {}
        existing = rumor_scores[player].get(team, 0)
        rumor_scores[player][team] = round(
            max(existing, confidence * 100), 1
        )

    return {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "signal_count": len(signals),
        "signals": signals,
        "rumor_scores": rumor_scores,
    }


# -- Main -------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--limit", type=int, default=None)
    parser.add_argument(
        "--dry-run", action="store_true",
        help="Classify but don't upload to R2",
    )
    parser.add_argument(
        "--no-draft-signals", action="store_true",
        help="Skip beat writer draft signal extraction",
    )
    parser.add_argument(
        "--model", type=str, default=MODEL,
        help="Ollama model to use (default: %s)" % MODEL,
    )
    parser.add_argument(
        "--full", action="store_true",
        help="Re-classify all articles, ignoring cache",
    )
    args = parser.parse_args()

    global _ACTIVE_MODEL
    _ACTIVE_MODEL = args.model

    # Load human corrections (Article Labeler) and community feedback scores —
    # closes the loop so labeling/rating in the UI actually improves future runs.
    labels = fetch_labels()
    alias_map = build_alias_map(labels)
    label_overrides = build_label_overrides(labels)
    feedback_scores = fetch_feedback_scores()
    print(
        "[Job 1] Loaded %d labels (%d name aliases learned), %d feedback scores"
        % (len(labels), len(alias_map), len(feedback_scores))
    )
    roster_lookup = load_roster_names()

    # Load classified cache so we can skip already-processed articles
    cached_articles: list = []
    processed_ids: set = set()
    if not args.full:
        cached_data = r2_get(CACHE_KEY) or {}
        if isinstance(cached_data, dict):
            cached_articles = cached_data.get("articles", [])
        elif isinstance(cached_data, list):
            cached_articles = cached_data
        processed_ids = {
            a["_fid"] for a in cached_articles if a.get("_fid")
        }
        if processed_ids:
            print(
                "[Job 1] Cache: %d previously classified articles"
                % len(cached_articles)
            )

    print("[Job 1] Fetching articles from R2...")
    try:
        articles = fetch_articles()
    except Exception as exc:
        print("ERROR fetching articles: %s" % exc)
        sys.exit(1)

    # Filter to only new articles
    if processed_ids:
        all_count = len(articles)
        articles = [
            a for a in articles
            if _fingerprint(a) not in processed_ids
        ]
        skipped = all_count - len(articles)
        print("[Job 1] %d new articles (%d already cached)" % (len(articles), skipped))

    if not articles and cached_articles:
        print("[Job 1] No new articles — rebuilding outputs from cache.")
        recorrected = _recorrect_cached_articles(cached_articles, alias_map, label_overrides)
        player_notes = build_player_notes(recorrected, roster_lookup)
        ai_summaries = build_ai_summaries(recorrected, feedback_scores)
        beat_signals = build_beat_writer_signals(recorrected)
        if not args.dry_run:
            r2_put("fantasai/news/player_notes.json", player_notes)
            r2_put("fantasai/news/ai_summaries.json", ai_summaries)
            sig_count = beat_signals["signal_count"]
            if sig_count > 0:
                r2_put(
                    "fantasai/draft/ghost_picks/beat_writer_signals.json",
                    beat_signals,
                )
        print("[Job 1] Complete (no new articles).")
        return

    if args.limit:
        articles = articles[:args.limit]

    print(
        "[Job 1] Processing %d articles with %s..." % (len(articles), _ACTIVE_MODEL)
    )
    classified = []
    errors = 0

    for i, article in enumerate(articles):
        text = (
            article.get("full_text")
            or article.get("text")
            or article.get("content")
            or article.get("description")
            or ""
        )
        if not text:
            continue

        article_url = _article_url(article)
        override = label_overrides.get(article_url)

        # A human already flagged this exact article as irrelevant — trust it
        # and skip the LLM call entirely rather than re-litigating it forever.
        if override and not override["is_relevant"]:
            classified.append({
                "article_id": (
                    article.get("news_id")
                    or article.get("id")
                    or article.get("article_id")
                    or i
                ),
                "_fid": _fingerprint(article),
                "article_url": article_url,
                "classified_at": datetime.now(timezone.utc).isoformat(),
                "headline": article.get("headline", "")[:100],
                "source": article.get("source_name", ""),
                "elapsed_sec": 0,
                "_draft_signal": None,
                "players": [], "relevance": 0, "sentiment": "neutral",
                "injury_related": False, "injury_status": "none",
                "impact_category": "other", "priority_level": "low",
                "waiver_relevance": 0, "dynasty_relevance": 0,
                "rookie_relevance": 0, "summary": "",
            })
            print("  [%d/%d] SKIP (labeled not relevant)" % (i + 1, len(articles)))
            continue

        t0 = time.time()
        try:
            result = classify_article(text)
            result["players"] = _apply_player_corrections(
                result.get("players", []), article_url, alias_map, label_overrides
            )
            elapsed = round(time.time() - t0, 2)

            draft_signal = None
            if not args.no_draft_signals:
                cat = result.get("impact_category", "")
                low300 = text.lower()[:300]
                is_draft = (
                    "draft" in low300
                    or "pick" in low300
                    or "prospect" in low300
                )
                if is_draft or cat == "transaction":
                    try:
                        draft_signal = extract_draft_signal(text)
                    except Exception:
                        pass

            classified.append({
                "article_id": (
                    article.get("news_id")
                    or article.get("id")
                    or article.get("article_id")
                    or i
                ),
                "_fid": _fingerprint(article),
                "article_url": article_url,
                "classified_at": datetime.now(timezone.utc).isoformat(),
                "headline": article.get("headline", "")[:100],
                "source": article.get("source_name", ""),
                "elapsed_sec": elapsed,
                "_draft_signal": draft_signal,
                **result,
            })
            players = result.get("players", [])[:2]
            priority = result.get("priority_level", "low")
            print(
                "  [%d/%d] %.2fs [%s] %s"
                % (i + 1, len(articles), elapsed, priority, players)
            )
        except Exception as exc:
            errors += 1
            print("  [%d/%d] ERROR: %s" % (i + 1, len(articles), exc))

    total = round(sum(r["elapsed_sec"] for r in classified), 1)
    avg = round(total / len(classified), 2) if classified else 0
    print(
        "[Job 1] Done: %d classified, %d errors, %.2fs avg"
        % (len(classified), errors, avg)
    )

    # Merge new results into cache and prune old entries. Re-apply corrections
    # to the cached portion — `classified` already went through corrections
    # in the loop above, but previously-cached articles never have.
    cutoff = (
        datetime.now(timezone.utc) - timedelta(days=CACHE_TTL_DAYS)
    ).isoformat()
    recorrected_cache = _recorrect_cached_articles(
        [a for a in cached_articles if a.get("classified_at", "9999") >= cutoff],
        alias_map, label_overrides,
    )
    merged = recorrected_cache + classified
    # Deduplicate by _fid (keep latest)
    seen: set = set()
    deduped = []
    for a in reversed(merged):
        fid = a.get("_fid") or a.get("article_id")
        if fid not in seen:
            seen.add(fid)
            deduped.append(a)
    deduped.reverse()

    player_notes = build_player_notes(deduped, roster_lookup)
    ai_summaries = build_ai_summaries(deduped, feedback_scores)
    beat_signals = build_beat_writer_signals(deduped)

    sig_count = beat_signals["signal_count"]
    print(
        "[Job 1] %d players, %d draft signals (cache now %d articles)"
        % (player_notes["player_count"], sig_count, len(deduped))
    )

    if args.dry_run:
        model_slug = _ACTIVE_MODEL.replace(":", "_").replace(".", "_")
        out = Path(__file__).parent / ("job1_dry_run_%s.json" % model_slug)
        out.write_text(json.dumps({
            "model": _ACTIVE_MODEL,
            "player_notes": player_notes,
            "ai_summaries": ai_summaries,
            "beat_writer_signals": beat_signals,
        }, indent=2))
        print("[Job 1] Dry run saved -> %s" % out)
        return

    cache_payload = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "article_count": len(deduped),
        "articles": deduped,
    }
    r2_put(CACHE_KEY, cache_payload)
    r2_put("fantasai/news/player_notes.json", player_notes)
    r2_put("fantasai/news/ai_summaries.json", ai_summaries)
    if sig_count > 0:
        r2_put(
            "fantasai/draft/ghost_picks/beat_writer_signals.json",
            beat_signals,
        )
    print("[Job 1] Complete.")


if __name__ == "__main__":
    main()
