"""
Weekly Deep Reasoning Orchestrator

Runs the dedicated Qwen3:30b lane on a weekly overnight schedule. This is a
separate task from the weekly stats orchestrator so the 30B model only runs on
the highest-value players after the 8B/14B jobs have already populated R2.

Execution:
  Job 5 — Deep fantasy reasoning (Qwen3:30b)
    └─ Reads player_scores + breakout_candidates + player_notes from R2
    └─ Writes fantasai/analysis/deep_reasoning.json

Schedule (Windows Task Scheduler):
  Wednesday at 1:30 AM — "FantasAI - Weekly Deep Reasoning"

Registration command:
    See the README / task notes for the exact PowerShell registration block.

Usage:
  python orchestrator_weekly_reasoning.py
  python orchestrator_weekly_reasoning.py --limit 15
  python orchestrator_weekly_reasoning.py --dry-run
"""

import argparse
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path


HERE = Path(__file__).parent

try:
    from notify import send_failure
except ImportError:
    def send_failure(*a, **kw):
        pass


def run(script: str, extra_args: list[str], label: str) -> bool:
    cmd = [sys.executable, str(HERE / script)] + extra_args
    print(f"\n{'─' * 60}")
    print(f"▶  {label}")
    print(f"   {' '.join(cmd)}")
    print(f"{'─' * 60}")
    t0 = time.time()
    result = subprocess.run(cmd)
    elapsed = round(time.time() - t0, 1)
    ok = result.returncode == 0
    status = "✅ OK" if ok else f"❌ FAILED (exit {result.returncode})"
    print(f"\n   {status}  [{elapsed}s]")
    return ok


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--limit", type=int, default=15)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    extra = []
    if args.limit:
        extra += ["--limit", str(args.limit)]
    if args.dry_run:
        extra.append("--dry-run")

    print("=" * 70)
    print("FantasAI — Weekly Deep Reasoning")
    started_at = datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M UTC')
    print(f"Started: {started_at}")
    print("=" * 70)

    started = time.time()
    failed = []

    if not run(
        "job5_deep_reasoner.py",
        extra,
        "Job 5 — Deep fantasy reasoning (Qwen 30B)",
    ):
        failed.append("job5")

    elapsed = round(time.time() - started)
    print(f"\n{'=' * 70}")
    finished_at = datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M UTC')
    print(f"Finished: {finished_at}")
    print(f"Duration: {elapsed}s ({elapsed // 60}m {elapsed % 60}s)")
    if failed:
        print(f"❌ FAILED tasks: {', '.join(failed)}")
        send_failure(failed, orchestrator="Weekly Deep Reasoning")
        sys.exit(1)

    print("✅ Weekly deep reasoning complete")


if __name__ == "__main__":
    main()
