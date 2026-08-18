"""
Quick connectivity test for local Ollama setup.
Verifies qwen3:8b, qwen3:14b, and qwen3:30b are reachable and returns
structured JSON.
Run: python test_ollama.py
"""

import json
import time

import urllib3

from ollama_utils import run_ollama_json

urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

OLLAMA_URL = "http://localhost:11434/api/generate"

SAMPLE_ARTICLE = (
    "Aaron Jones full practice after hamstring; "
    "AJ Dillon questionable."
)

PROMPT = f"""Analyze this NFL news snippet for fantasy football relevance.
Return ONLY valid JSON with this exact structure and keep every string short:
{{
  "players": ["list of player names mentioned"],
  "relevance": <float 0-10>,
  "sentiment": "positive|negative|neutral",
  "injury_related": <true|false>,
    "summary": "<one word: healthy|injury|uncertain>"
}}

Article: {SAMPLE_ARTICLE}"""


def test_model(model: str) -> dict:
    start = time.time()
    parsed = run_ollama_json(
        model,
        PROMPT,
        think=False,
        keepalive="10m",
        timeout=120,
    )
    elapsed = round(time.time() - start, 1)
    return {"model": model, "elapsed_sec": elapsed, "result": parsed}


if __name__ == "__main__":
    for model in ["qwen3:8b", "qwen3:14b", "qwen3:30b"]:
        print(f"\n--- Testing {model} ---")
        try:
            out = test_model(model)
            print(f"Time : {out['elapsed_sec']}s")
            print(json.dumps(out["result"], indent=2))
        except Exception as e:
            print(f"FAILED: {e}")
