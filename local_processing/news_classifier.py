"""
Local GPU news classifier — replaces Databricks AI summary generation.
Pulls articles from R2 enriched_news.json, classifies with qwen3:8b,
and writes results to local JSON for comparison against Databricks output.

Usage:
  python news_classifier.py                  # process all articles
  python news_classifier.py --limit 20       # quick batch test
  python news_classifier.py --model qwen3:14b
"""

import argparse
import json
import os
import time
import sys
from pathlib import Path
import requests
import urllib3
urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

try:
    from dotenv import load_dotenv
    load_dotenv(Path(__file__).parent.parent / ".env")
except ImportError:
    pass

# Corporate VPN uses an SSL proxy that breaks cert verification
VERIFY_SSL = False

OLLAMA_URL = "http://localhost:11434/api/generate"
R2_BASE = "https://api.fantasai.net/api/v1/r2/fantasai"
R2_ARTICLES_URL = R2_BASE + "/news/enriched_news.json"
OUTPUT_DIR = Path(__file__).parent

FANTASAI_KEY = os.environ.get("FANTASAI_KEY", "")
if not FANTASAI_KEY:
    print(
        "ERROR: FANTASAI_KEY env var not set. "
        "Add it to d:\\Project\\Fantasy\\.env"
    )
    sys.exit(1)

HEADERS = {"X-FantasAI-Key": FANTASAI_KEY}

CLASSIFICATION_PROMPT = """Analyze this NFL news snippet for fantasy football.
Return ONLY valid JSON — no markdown, no explanation:
{{
  "players": ["player names mentioned"],
  "relevance": <float 0-10>,
  "sentiment": "positive|negative|neutral",
  "injury_related": <true|false>,
  "impact_category": "injury|transaction|analysis|other",
  "priority_level": "critical|high|medium|low",
  "summary": "<one concise sentence>"
}}

Article: {text}"""


def classify(text: str, model: str) -> dict:
    prompt = CLASSIFICATION_PROMPT.format(text=text[:800])
    resp = requests.post(
        OLLAMA_URL,
        json={"model": model, "prompt": prompt, "stream": False},
        timeout=120,
    )
    resp.raise_for_status()
    raw = resp.json()["response"].strip()

    if raw.startswith("```"):
        raw = raw.split("```")[1]
        if raw.startswith("json"):
            raw = raw[4:]

    return json.loads(raw)


def fetch_articles() -> list:
    resp = requests.get(
        R2_ARTICLES_URL, headers=HEADERS, timeout=30, verify=VERIFY_SSL
    )
    resp.raise_for_status()
    data = resp.json()
    if isinstance(data, list):
        return data
    return data.get("data", data.get("articles", data.get("items", [])))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--limit", type=int, default=None, help="Max articles to process"
    )
    parser.add_argument(
        "--model", default="qwen3:8b", help="Ollama model to use"
    )
    parser.add_argument(
        "--output", default=None, help="Output file (default: classified_<model>.json)"
    )
    args = parser.parse_args()

    safe_model = args.model.replace(":", "_").replace("/", "_")
    output_file = Path(args.output) if args.output else (
        OUTPUT_DIR / f"classified_{safe_model}.json"
    )

    print("Fetching articles from R2...")
    try:
        articles = fetch_articles()
    except Exception as e:
        print(f"Failed to fetch articles: {e}")
        sys.exit(1)

    if args.limit:
        articles = articles[: args.limit]

    print(f"Processing {len(articles)} articles with {args.model}...")
    results = []
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

        start = time.time()
        try:
            classification = classify(text, args.model)
            elapsed = round(time.time() - start, 2)
            results.append({
                "article_id": (
                    article.get("news_id")
                    or article.get("id")
                    or article.get("article_id")
                    or i
                ),
                "headline": article.get("headline", "")[:80],
                "source": article.get("source_name", "unknown"),
                "elapsed_sec": elapsed,
                **classification,
            })
            players = classification.get("players", [])[:2]
            print(f"[{i+1}/{len(articles)}] {elapsed}s — {players}")
        except Exception as e:
            errors += 1
            print(f"[{i+1}/{len(articles)}] ERROR: {e}")

    output_file.write_text(json.dumps(results, indent=2))
    total = round(sum(r["elapsed_sec"] for r in results), 1)
    avg = round(total / len(results), 2) if results else 0
    rate = round(len(results) / total, 1) if total else 0

    print(f"\nDone: {len(results)} classified, {errors} errors")
    print(f"Total: {total}s | Avg: {avg}s/article | Rate: {rate} art/s")
    print(f"Output: {output_file}")


if __name__ == "__main__":
    main()
