"""
Quick connectivity test for local Ollama setup.
Verifies both qwen3:8b and qwen3:14b are reachable and returns structured JSON.
Run: python test_ollama.py
"""

import requests
import urllib3
import json
import time
urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

OLLAMA_URL = "http://localhost:11434/api/generate"

SAMPLE_ARTICLE = (
    "Aaron Jones was a full participant in practice Wednesday after missing "
    "last week's game with a hamstring injury. The Packers head coach said "
    "Jones is expected to play Sunday against the Bears. His backup, "
    "AJ Dillon, is listed as questionable."
)

PROMPT = f"""Analyze this NFL news snippet for fantasy football relevance.
Return ONLY valid JSON with this exact structure:
{{
  "players": ["list of player names mentioned"],
  "relevance": <float 0-10>,
  "sentiment": "positive|negative|neutral",
  "injury_related": <true|false>,
  "summary": "<one sentence>"
}}

Article: {SAMPLE_ARTICLE}"""


def test_model(model: str) -> dict:
    start = time.time()
    resp = requests.post(
        OLLAMA_URL,
        json={"model": model, "prompt": PROMPT, "stream": False},
        timeout=120,
    )
    resp.raise_for_status()
    elapsed = round(time.time() - start, 1)
    raw = resp.json()["response"].strip()

    # Strip markdown code fences if present
    if raw.startswith("```"):
        raw = raw.split("```")[1]
        if raw.startswith("json"):
            raw = raw[4:]

    parsed = json.loads(raw)
    return {"model": model, "elapsed_sec": elapsed, "result": parsed}


if __name__ == "__main__":
    for model in ["qwen3:8b", "qwen3:14b"]:
        print(f"\n--- Testing {model} ---")
        try:
            out = test_model(model)
            print(f"Time : {out['elapsed_sec']}s")
            print(json.dumps(out["result"], indent=2))
        except Exception as e:
            print(f"FAILED: {e}")
