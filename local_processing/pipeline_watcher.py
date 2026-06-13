"""
Pipeline Watcher — polls R2 for Databricks ETL refresh, triggers local pipeline.

Databricks writes fantasai/etl/last_refresh.json at the end of each ETL run:
  { "timestamp": "2026-06-10T15:30:00Z", "tables": ["players","news","injuries"] }

This watcher polls that key every POLL_INTERVAL seconds. When a newer timestamp
is found, it immediately triggers pipeline_runner.py (Job 1 → Job 2).

Usage:
  python pipeline_watcher.py                     # poll every 5 min (default)
  python pipeline_watcher.py --interval 120      # poll every 2 min
  python pipeline_watcher.py --once              # check once and exit (cron-friendly)
  python pipeline_watcher.py --once --force      # run pipeline regardless of timestamp

Setup (Windows Task Scheduler — runs every 5 min):
  Action: python "D:\\Project\\Fantasy\\local_processing\\pipeline_watcher.py" --once
  Trigger: every 5 minutes
"""

import argparse
import json
import os
import subprocess
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

VERIFY_SSL      = False
R2_BASE         = "https://api.fantasai.net/api/v1/r2"
ETL_MARKER_KEY  = "fantasai/etl/last_refresh.json"
POLL_INTERVAL   = 300   # 5 minutes default
STATE_FILE      = Path(__file__).parent / ".watcher_state.json"

FANTASAI_KEY = os.environ.get("FANTASAI_KEY", "")
if not FANTASAI_KEY:
    print("ERROR: FANTASAI_KEY not set — add to .env")
    sys.exit(1)

HEADERS = {"X-FantasAI-Key": FANTASAI_KEY}
HERE    = Path(__file__).parent


def load_state() -> dict:
    if STATE_FILE.exists():
        try:
            return json.loads(STATE_FILE.read_text())
        except Exception:
            pass
    return {"last_processed_ts": None, "last_run": None, "runs": 0}


def save_state(state: dict):
    STATE_FILE.write_text(json.dumps(state, indent=2))


def fetch_etl_marker() -> dict | None:
    try:
        resp = requests.get(
            f"{R2_BASE}/{ETL_MARKER_KEY}",
            headers=HEADERS,
            timeout=10,
            verify=VERIFY_SSL,
        )
        if resp.status_code == 404:
            return None
        resp.raise_for_status()
        return resp.json()
    except Exception as e:
        print(f"[watcher] Could not fetch ETL marker: {e}")
        return None


def is_newer(marker_ts: str, last_processed: str | None) -> bool:
    if not last_processed:
        return True
    try:
        marker_dt   = datetime.fromisoformat(marker_ts.replace("Z", "+00:00"))
        last_dt     = datetime.fromisoformat(last_processed.replace("Z", "+00:00"))
        return marker_dt > last_dt
    except Exception:
        return True


def run_pipeline(tables_updated: list[str]) -> bool:
    """Run Job 1 always; run Job 2 only if news or injuries changed."""
    job_arg  = "1"
    run_both = any(t in tables_updated for t in ("news", "injuries", "players", "depthcharts"))
    if run_both:
        job_arg = "all"

    cmd = [sys.executable, str(HERE / "pipeline_runner.py"), "--job", job_arg]
    print(f"[watcher] Triggering: {' '.join(cmd)}")

    result = subprocess.run(cmd)
    return result.returncode == 0


def check_and_run(force: bool = False) -> bool:
    state  = load_state()
    marker = fetch_etl_marker()

    if not marker:
        print("[watcher] No ETL marker found — Databricks may not have written one yet")
        print(f"[watcher] Expected: PUT {R2_BASE}/{ETL_MARKER_KEY}")
        print('[watcher] Marker format: {"timestamp":"2026-06-10T15:30:00Z","tables":["news","players"]}')
        return False

    marker_ts = marker.get("timestamp", "")
    tables    = marker.get("tables", [])
    job_id    = marker.get("job_id", "unknown")

    if not force and not is_newer(marker_ts, state.get("last_processed_ts")):
        print(f"[watcher] No new data (ETL: {marker_ts}, last run: {state.get('last_processed_ts')})")
        return False

    print(f"[watcher] New ETL data detected — job_id={job_id}, tables={tables}, ts={marker_ts}")
    ok = run_pipeline(tables)

    if ok:
        state["last_processed_ts"] = marker_ts
        state["last_run"]          = datetime.now(timezone.utc).isoformat()
        state["runs"]              = state.get("runs", 0) + 1
        save_state(state)
        print(f"[watcher] Pipeline complete. Total runs: {state['runs']}")
    else:
        print("[watcher] Pipeline failed — will retry on next tick")

    return ok


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--interval", type=int, default=POLL_INTERVAL,
                        help="Seconds between polls (default 300)")
    parser.add_argument("--once",  action="store_true",
                        help="Check once and exit (use with Task Scheduler)")
    parser.add_argument("--force", action="store_true",
                        help="Run pipeline regardless of timestamp")
    parser.add_argument("--status", action="store_true",
                        help="Show watcher state and exit")
    args = parser.parse_args()

    if args.status:
        state  = load_state()
        marker = fetch_etl_marker()
        print(json.dumps({
            "watcher_state": state,
            "etl_marker":    marker,
        }, indent=2))
        return

    if args.once:
        check_and_run(force=args.force)
        return

    print(f"[watcher] Starting — polling every {args.interval}s")
    print(f"[watcher] ETL marker: {ETL_MARKER_KEY}")
    print(f"[watcher] State file: {STATE_FILE}")
    print("[watcher] Press Ctrl+C to stop\n")

    while True:
        try:
            check_and_run(force=args.force)
        except KeyboardInterrupt:
            print("\n[watcher] Stopped")
            break
        except Exception as e:
            print(f"[watcher] Unexpected error: {e}")
        time.sleep(args.interval)


if __name__ == "__main__":
    main()
