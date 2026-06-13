"""
FantasAI Chat Server — FastAPI + Ollama (Qwen3:14b)
Receives chat requests from the Cloudflare Worker and returns AI answers.

Run:
  pip install fastapi uvicorn requests python-dotenv
  python chat_server.py                      # port 8000
  python chat_server.py --port 8001
  python chat_server.py --model qwen3:8b     # lighter model for testing

Expose publicly (choose one):
  Option A — Cloudflare Tunnel (stable subdomain, recommended):
    cloudflared tunnel --url http://localhost:8000

  Option B — ngrok (quick test):
    ngrok http 8000
"""

import argparse
import json
import os
import sys
import time
from pathlib import Path

import requests
import uvicorn
from fastapi import FastAPI, Header, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

try:
    from dotenv import load_dotenv
    load_dotenv(Path(__file__).parent.parent / ".env")
except ImportError:
    pass

OLLAMA_URL   = "http://localhost:11434/api/generate"
DEFAULT_MODEL = "qwen3:14b"

FANTASAI_KEY = os.environ.get("FANTASAI_KEY", "")
if not FANTASAI_KEY:
    print("WARNING: FANTASAI_KEY not set — auth disabled (fine for local dev)")

SYSTEM_PROMPT = (
    "You are FantasAI, an expert fantasy football copilot. "
    "Answer concisely and directly. Use bullet points for lists. "
    "Focus on actionable advice — start/sit decisions, waiver adds, trade values, injury impact. "
    "When roster context is provided, tailor your answer to those specific players."
)

app = FastAPI(title="FantasAI Chat Server", version="1.0.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["*"],
)

_model = DEFAULT_MODEL


class ChatRequest(BaseModel):
    question: str
    context: str = ""
    rosterPlayers: list = []


class ChatResponse(BaseModel):
    answer: str
    model: str
    elapsed_sec: float


def check_auth(x_fantasai_key: str | None):
    if FANTASAI_KEY and x_fantasai_key != FANTASAI_KEY:
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


@app.get("/health")
def health():
    return {"status": "ok", "model": _model}


@app.post("/chat", response_model=ChatResponse)
def chat(
    body: ChatRequest,
    x_fantasai_key: str | None = Header(default=None),
):
    check_auth(x_fantasai_key)

    if not body.question.strip():
        raise HTTPException(status_code=400, detail="question is required")

    # Build the full prompt with any provided context
    parts = []
    if body.context.strip():
        parts.append(body.context.strip())
    if body.rosterPlayers:
        players_str = ", ".join(str(p) for p in body.rosterPlayers[:20])
        parts.append(f"My roster includes: {players_str}")
    parts.append(f"User question: {body.question.strip()}")
    prompt = "\n\n".join(parts)

    start = time.time()
    try:
        answer = call_ollama(prompt, _model)
    except requests.exceptions.ConnectionError:
        raise HTTPException(
            status_code=503,
            detail="Ollama not running — start with: ollama serve",
        )
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Ollama error: {e}")

    elapsed = round(time.time() - start, 2)
    return ChatResponse(answer=answer, model=_model, elapsed_sec=elapsed)


@app.get("/models")
def list_models():
    try:
        resp = requests.get("http://localhost:11434/api/tags", timeout=5)
        resp.raise_for_status()
        models = [m["name"] for m in resp.json().get("models", [])]
        return {"models": models, "active": _model}
    except Exception as e:
        return {"models": [], "active": _model, "error": str(e)}


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--port",  type=int, default=8000)
    parser.add_argument("--host",  default="0.0.0.0")
    parser.add_argument("--model", default=DEFAULT_MODEL)
    args = parser.parse_args()

    _model = args.model
    print(f"\n FantasAI Chat Server")
    print(f" Model : {_model}")
    print(f" URL   : http://{args.host}:{args.port}")
    print(f" Auth  : {'enabled' if FANTASAI_KEY else 'disabled (set FANTASAI_KEY)'}")
    print(f"\n Expose publicly:")
    print(f"   cloudflared tunnel --url http://localhost:{args.port}")
    print(f"   ngrok http {args.port}\n")

    uvicorn.run(app, host=args.host, port=args.port, log_level="info")
