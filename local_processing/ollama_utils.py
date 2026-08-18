"""
Shared Ollama helpers for local_processing jobs.

Uses the Ollama CLI so we can reliably pass the same flags validated manually:
  --think=false --hidethinking --format json --keepalive 30m
"""

from __future__ import annotations

import json
import os
import re
import subprocess
from typing import Any


OLLAMA_BIN = os.environ.get("OLLAMA_BIN", "ollama")
ANSI_RE = re.compile(r"\x1b\[[0-?]*[ -/]*[@-~]")
CTRL_RE = re.compile(r"[\x00-\x08\x0b-\x1f\x7f]")


def _clean_output(text: str) -> str:
    cleaned = ANSI_RE.sub("", text or "")
    cleaned = CTRL_RE.sub("", cleaned)
    return cleaned.strip()


def run_ollama_json(
    model: str,
    prompt: str,
    *,
    think: bool = False,
    keepalive: str = "30m",
    timeout: int = 240,
) -> dict[str, Any]:
    """Run Ollama and return parsed JSON output."""
    cmd = [
        OLLAMA_BIN,
        "run",
        model,
        f"--think={'true' if think else 'false'}",
        "--hidethinking",
        "--format",
        "json",
        "--keepalive",
        keepalive,
        prompt,
    ]
    result = subprocess.run(
        cmd,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        timeout=timeout,
    )
    if result.returncode != 0:
        raise RuntimeError(
            "Ollama failed (exit %s): %s" % (
                result.returncode,
                (result.stderr or result.stdout or "").strip(),
            )
        )

    raw = _clean_output(result.stdout or "")
    if not raw:
        raise RuntimeError("Ollama returned no output")

    try:
        return json.loads(raw)
    except json.JSONDecodeError as exc:
        start = raw.find("{")
        end = raw.rfind("}")
        if start != -1 and end != -1 and end > start:
            try:
                return json.loads(raw[start:end + 1])
            except json.JSONDecodeError:
                pass
        try:
            decoder = json.JSONDecoder()
            parsed, _ = decoder.raw_decode(raw.lstrip())
            return parsed
        except json.JSONDecodeError:
            pass
        raise RuntimeError(
            "Ollama returned non-JSON output: %s" % raw[:500]
        ) from exc
