"""
Manual player status overrides — for situations no automated source can
represent on its own: suspensions, the NFL's Commissioner's Exempt List, etc.

Real incident this exists for: Josh Jacobs was placed on the Commissioner's
Exempt List on 8/30/2026 (domestic violence charges) and cannot play or
practice at all. But:
  - Sleeper's injury_status enum has no category for a legal/suspension
    situation — only physical injuries. It cannot represent this, ever.
  - player_profiles.json (Databricks) is a periodic export snapshot; even if
    it could represent the status, the next refresh has no reason to know
    about a fact nothing in its own pipeline observed.
  - ecr_ppr.json / ecr_std.json mirror FantasyPros' public rankings verbatim;
    they self-correct once FantasyPros' own experts react, but only on our
    next scrape, and only as fully as FantasyPros happens to react.
  - A one-off manual edit to any of those exported files gets silently wiped
    the next time that file's normal ingest job runs — this has already
    happened once this session.

This file is the fix: a small, separately-stored override that the frontend
(App.jsx's statusOverrides patch effect) applies AFTER all of the above load,
so it survives every future automated refresh until someone explicitly clears
it — e.g. once a player is reinstated.

Writes: fantasai/players/status_overrides.json

Usage:
  python set_player_status_override.py "Josh Jacobs" --label "Exempt List" \
      --note "Placed on NFL Commissioner's Exempt List 8/30/2026 (domestic violence charges) — cannot play or practice pending league review."
  python set_player_status_override.py "Josh Jacobs" --clear
  python set_player_status_override.py --list
"""

import argparse
import json
import os
import sys
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

VERIFY_SSL = False  # matches job3_player_writeups.py — local cert store issue
API_BASE = "https://api.fantasai.net"
R2_KEY   = "fantasai/players/status_overrides.json"
FANTASAI_KEY = os.environ.get("FANTASAI_KEY", "")
HEADERS = {"X-FantasAI-Key": FANTASAI_KEY, "Content-Type": "application/json"}


def load() -> dict:
    resp = requests.get(f"{API_BASE}/api/v1/r2/{R2_KEY}", headers=HEADERS, timeout=20, verify=VERIFY_SSL)
    if resp.status_code == 404:
        return {"overrides": {}}
    resp.raise_for_status()
    data = resp.json()
    if not isinstance(data, dict) or not isinstance(data.get("overrides"), dict):
        return {"overrides": {}}
    return data


def save(data: dict):
    if not FANTASAI_KEY:
        print("ERROR: FANTASAI_KEY not set — add to .env")
        sys.exit(1)
    data["updated_at"] = datetime.now(timezone.utc).isoformat()
    body = json.dumps(data, indent=2)
    resp = requests.put(f"{API_BASE}/api/v1/r2/{R2_KEY}", data=body, headers=HEADERS, timeout=30, verify=VERIFY_SSL)
    if resp.ok:
        print(f"OK -> {R2_KEY}")
    else:
        print(f"FAIL HTTP {resp.status_code}: {resp.text[:200]}")
        sys.exit(1)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("player_name", nargs="?", help="Exact full name, e.g. \"Josh Jacobs\"")
    parser.add_argument("--label", default="Unavailable", help="Short status label shown in the app")
    parser.add_argument("--note",  default="", help="Longer explanation, for reference")
    parser.add_argument("--clear", action="store_true", help="Remove the override for this player")
    parser.add_argument("--list",  action="store_true", help="List all current overrides")
    args = parser.parse_args()

    data = load()

    if args.list:
        overrides = data.get("overrides", {})
        if not overrides:
            print("No overrides set.")
            return
        for key, o in overrides.items():
            print(f"  {o.get('player_name', key)!r} — {o.get('status_label')} (set {o.get('set_at')})")
            if o.get("note"):
                print(f"      {o['note']}")
        return

    if not args.player_name:
        parser.error("player_name is required unless --list is given")

    key = args.player_name.strip().lower()

    if args.clear:
        if key in data["overrides"]:
            del data["overrides"][key]
            save(data)
            print(f"Cleared override for {args.player_name!r}")
        else:
            print(f"No override was set for {args.player_name!r}")
        return

    data["overrides"][key] = {
        "player_name": args.player_name.strip(),
        "available": False,
        "status_label": args.label,
        "note": args.note,
        "set_at": datetime.now(timezone.utc).strftime("%Y-%m-%d"),
    }
    save(data)
    print(f"Set {args.player_name!r} unavailable ({args.label})")


if __name__ == "__main__":
    main()
