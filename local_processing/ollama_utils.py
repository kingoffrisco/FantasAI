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


def _run_once(model: str, prompt: str, think: bool, keepalive: str, timeout: int) -> str:
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
    return raw


def _parse_json(raw: str) -> dict[str, Any]:
    """Parse a raw Ollama response, working around common decoding glitches."""
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

        # The model occasionally emits a raw, unescaped control character
        # (usually a newline) inside a string value — valid text, invalid
        # JSON. None of these prompts ask for multi-line string values, so
        # it's always a glitch, never real content.
        repaired = re.sub(r"[\x00-\x1f]", " ", raw)
        if repaired != raw:
            for candidate in (repaired, repaired[repaired.find("{"):repaired.rfind("}") + 1]):
                try:
                    return json.loads(candidate)
                except json.JSONDecodeError:
                    continue

        # Another distinct stutter shape: a whole extra line that's just a
        # duplicated trailing fragment of the line before it, e.g.
        #   "primary_reason": "...strong 2025 outlook",
        #   outlook",
        # A bare fragment+comma line like that is never valid JSON on its
        # own, so if dropping it makes the object parse, it was the glitch.
        deduped = _dedupe_stutter_lines(raw)
        if deduped != raw:
            try:
                return json.loads(deduped)
            except json.JSONDecodeError:
                start = deduped.find("{")
                end = deduped.rfind("}")
                if start != -1 and end != -1 and end > start:
                    try:
                        return json.loads(deduped[start:end + 1])
                    except json.JSONDecodeError:
                        pass

        raise RuntimeError(
            "Ollama returned non-JSON output: %s" % raw[:500]
        ) from exc


def _dedupe_stutter_lines(raw: str) -> str:
    """Drop any line whose stripped content is a trailing-fragment repeat of
    the line immediately before it — a stochastic Qwen3 token-stutter, not
    real content. Deliberately conservative: only drops a line that is a
    strict suffix of, and shorter than, the previous line.
    """
    lines = raw.split("\n")
    out: list[str] = []
    for line in lines:
        stripped = line.strip()
        if out:
            prev_stripped = out[-1].strip()
            if stripped and len(stripped) < len(prev_stripped) and prev_stripped.endswith(stripped):
                continue
        out.append(line)
    return "\n".join(out)


def run_ollama_json(
    model: str,
    prompt: str,
    *,
    think: bool = False,
    keepalive: str = "30m",
    timeout: int = 240,
    retries: int = 1,
) -> dict[str, Any]:
    """Run Ollama and return parsed JSON output.

    Some decoding glitches (a duplicated/stuttered token that breaks JSON
    grammar, not just an escaping issue) can't be repaired at the string
    level — the safest fix is a fresh generation, since it's a stochastic
    artifact rather than a property of the prompt. Retries a full failed
    call up to `retries` times before giving up.
    """
    last_exc: Exception | None = None
    for attempt in range(retries + 1):
        raw = _run_once(model, prompt, think, keepalive, timeout)
        try:
            return _parse_json(raw)
        except RuntimeError as exc:
            last_exc = exc
            continue
    raise last_exc
