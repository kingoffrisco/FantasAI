"""
Pipeline runner — orchestrates Job 1 → Job 2 in sequence.

Jobs:
  Job 1 (qwen3:8b):  Classify articles → player_notes + ai_summaries → R2
  Job 2 (qwen3:14b): Analyze player data → waiver/lineup/trade → R2

Both jobs run incrementally by default — only new/changed articles and
players are processed. Use --full to force a complete rerun.

Usage:
  python pipeline_runner.py               # incremental pipeline (default)
  python pipeline_runner.py --full        # reprocess everything
  python pipeline_runner.py --job 1       # job 1 only
  python pipeline_runner.py --job 2       # job 2 only (requires job 1 to have run)
  python pipeline_runner.py --limit 50    # cap articles (fast test)
  python pipeline_runner.py --dry-run     # run models but don't upload to R2
  python pipeline_runner.py --task waiver # job 2 single task only
"""

import argparse
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path


HERE = Path(__file__).parent


def run_job(script: str, extra_args: list[str]) -> int:
    cmd = [sys.executable, str(HERE / script)] + extra_args
    print(f"\n{'='*60}")
    print(f"Running: {' '.join(cmd)}")
    print(f"{'='*60}")
    start = time.time()
    result = subprocess.run(cmd)
    elapsed = round(time.time() - start, 1)
    status = "OK" if result.returncode == 0 else f"FAILED (exit {result.returncode})"
    print(f"\n[pipeline] {script} finished in {elapsed}s — {status}")
    return result.returncode


def main():
    parser = argparse.ArgumentParser(description="FantasAI GPU processing pipeline")
    parser.add_argument("--job",     choices=["1", "2", "all"], default="all")
    parser.add_argument("--limit",   type=int, default=None, help="Cap articles for Job 1")
    parser.add_argument("--dry-run", action="store_true", help="Don't upload to R2")
    parser.add_argument("--full",    action="store_true",
                        help="Reprocess all articles/players (ignore cache)")
    parser.add_argument("--task",    choices=["waiver", "lineup", "trade"], default=None,
                        help="Run only this task in Job 2")
    args = parser.parse_args()

    run_all = args.job == "all"
    run1    = run_all or args.job == "1"
    run2    = run_all or args.job == "2"

    start_time = time.time()
    print(f"\n[pipeline] Starting — {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M UTC')}")
    print(f"[pipeline] Jobs: {'1+2' if run_all else args.job} | "
          f"Limit: {args.limit or 'all'} | Dry-run: {args.dry_run}")

    job1_args = []
    if args.limit:
        job1_args += ["--limit", str(args.limit)]
    if args.dry_run:
        job1_args.append("--dry-run")
    if args.full:
        job1_args.append("--full")

    job2_args = []
    if args.task:
        job2_args += ["--task", args.task]
    if args.dry_run:
        job2_args.append("--dry-run")
    if args.full:
        job2_args.append("--full")

    failed = []

    if run1:
        rc = run_job("job1_news_processor.py", job1_args)
        if rc != 0:
            failed.append("job1")
            if run_all:
                print("[pipeline] Job 1 failed — skipping Job 2 (no fresh player notes)")
                run2 = False

    if run2:
        rc = run_job("job2_fantasy_analyzer.py", job2_args)
        if rc != 0:
            failed.append("job2")

    total = round(time.time() - start_time, 1)
    print(f"\n{'='*60}")
    if failed:
        print(f"[pipeline] DONE in {total}s — FAILED: {', '.join(failed)}")
        sys.exit(1)
    else:
        print(f"[pipeline] DONE in {total}s — all jobs succeeded")


if __name__ == "__main__":
    main()
