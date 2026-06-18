"""
FantasAI Chat Server — intent-based routing to Qwen3 8B / 14B
Receives chat requests from the Cloudflare Worker and returns AI answers.

Tiers (set by Worker keyword classifier, overridable by client):
  simple  → Qwen3 8B  — news, injury status, player bios
  medium  → Qwen3 14B — trades, start/sit, matchup analysis  (default)
  complex → Qwen3 14B — best local effort; Worker may escalate to GPT-5

Run:
  pip install fastapi uvicorn requests python-dotenv
  python chat_server.py

Expose publicly (choose one):
  cloudflared tunnel --url http://localhost:8000
  ngrok http 8000
"""

import argparse
import os
import time
from pathlib import Path

import requests
import uvicorn
from fastapi import FastAPI, Header, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

try:
    from dotenv import load_dotenv
    load_dotenv(Path(__file__).parent.parent / ".env")
except ImportError:
    pass

OLLAMA_URL = "http://localhost:11434/api/generate"

TIER_MODELS = {
    "simple":  "qwen3:8b",
    "medium":  "qwen3:14b",
    "complex": "qwen3:14b",  # local best-effort; Worker escalates to cloud for true complex
}

INTENT_PROMPT = (
    "/no_think\n"
    "Classify this fantasy football question into exactly one tier.\n\n"
    "simple  — news summary, injury status, player bio, depth chart, draft recap\n"
    "medium  — trade analysis, start/sit, player comparison, waiver add, matchup advice\n"
    "complex — dynasty rebuild, 3+ player trade, 3-team trade, full season roster strategy\n\n"
    'Question: "{question}"\n\n'
    "Reply with ONLY one word: simple  medium  or  complex"
)

SYSTEM_PROMPT = (
    "You are FantasAI, an expert fantasy football copilot. "
    "Answer concisely and directly. Use bullet points for lists. "
    "Focus on actionable advice — start/sit, waiver adds, trade values, injury impact. "
    "When roster context is provided, tailor your answer to those specific players."
)

FANTASAI_KEY = os.environ.get("FANTASAI_KEY", "")
if not FANTASAI_KEY:
    print("WARNING: FANTASAI_KEY not set — auth disabled (fine for local dev)")

app = FastAPI(title="FantasAI Chat Server", version="2.0.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["*"],
)


class ChatRequest(BaseModel):
    question: str
    context: str = ""
    rosterPlayers: list = []
    tier: str = "medium"  # simple | medium | complex


class ChatResponse(BaseModel):
    answer: str
    model: str
    tier: str
    elapsed_sec: float


class ClassifyResponse(BaseModel):
    tier: str
    model: str


def check_auth(key: str | None):
    if FANTASAI_KEY and key != FANTASAI_KEY:
        raise HTTPException(status_code=401, detail="Unauthorized")


def call_ollama(prompt: str, model: str) -> str:
    full_prompt = f"{SYSTEM_PROMPT}\n\n{prompt}"
    resp = requests.post(
        OLLAMA_URL,
        json={"model": model, "prompt": full_prompt, "stream": False},
        timeout=120,
    )
    resp.raise_for_status()
    return resp.json()["response"].strip()


def call_ollama_raw(prompt: str, model: str) -> str:
    """No system prompt — used for classification."""
    resp = requests.post(
        OLLAMA_URL,
        json={"model": model, "prompt": prompt, "stream": False},
        timeout=15,
    )
    resp.raise_for_status()
    return resp.json()["response"].strip()


def build_prompt(body: ChatRequest) -> str:
    parts = []
    if body.context.strip():
        parts.append(body.context.strip())
    if body.rosterPlayers:
        players_str = ", ".join(str(p) for p in body.rosterPlayers[:20])
        parts.append(f"My roster includes: {players_str}")
    parts.append(f"User question: {body.question.strip()}")
    return "\n\n".join(parts)


@app.get("/health")
def health():
    return {"status": "ok", "tiers": TIER_MODELS}


@app.post("/classify", response_model=ClassifyResponse)
def classify(
    body: ChatRequest,
    x_fantasai_key: str | None = Header(default=None),
):
    """Classify question tier using Qwen3 8B. Used for debugging."""
    check_auth(x_fantasai_key)
    if not body.question.strip():
        raise HTTPException(status_code=400, detail="question is required")
    try:
        prompt = INTENT_PROMPT.format(question=body.question[:500])
        raw = call_ollama_raw(prompt, TIER_MODELS["simple"])
        tier = raw.strip().lower().split()[0]
        if tier not in TIER_MODELS:
            tier = "medium"
    except Exception:
        tier = "medium"
    return ClassifyResponse(tier=tier, model=TIER_MODELS[tier])


@app.post("/chat", response_model=ChatResponse)
def chat(
    body: ChatRequest,
    x_fantasai_key: str | None = Header(default=None),
):
    check_auth(x_fantasai_key)
    if not body.question.strip():
        raise HTTPException(status_code=400, detail="question is required")

    tier = body.tier if body.tier in TIER_MODELS else "medium"
    model = TIER_MODELS[tier]
    prompt = build_prompt(body)

    start = time.time()
    try:
        answer = call_ollama(prompt, model)
    except requests.exceptions.ConnectionError:
        raise HTTPException(
            status_code=503,
            detail="Ollama not running — start with: ollama serve",
        )
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Ollama error: {e}")

    elapsed = round(time.time() - start, 2)
    return ChatResponse(answer=answer, model=model, tier=tier, elapsed_sec=elapsed)


@app.get("/models")
def list_models():
    try:
        resp = requests.get("http://localhost:11434/api/tags", timeout=5)
        resp.raise_for_status()
        models = [m["name"] for m in resp.json().get("models", [])]
        return {"models": models, "tiers": TIER_MODELS}
    except Exception as e:
        return {"models": [], "tiers": TIER_MODELS, "error": str(e)}


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, default=8000)
    parser.add_argument("--host", default="0.0.0.0")
    args = parser.parse_args()

    print("\n FantasAI Chat Server v2 — Intent-Based Routing")
    print(f"   simple  → {TIER_MODELS['simple']}")
    print(f"   medium  → {TIER_MODELS['medium']}")
    print(f"   complex → {TIER_MODELS['complex']} (local) / GPT-5 (cloud)")
    print(f"\n URL  : http://{args.host}:{args.port}")
    print(f" Auth : {'enabled' if FANTASAI_KEY else 'disabled (set FANTASAI_KEY)'}")
    print(f"\n Expose publicly:")
    print(f"   cloudflared tunnel --url http://localhost:{args.port}")
    print(f"   ngrok http {args.port}\n")

    uvicorn.run(app, host=args.host, port=args.port, log_level="info")
