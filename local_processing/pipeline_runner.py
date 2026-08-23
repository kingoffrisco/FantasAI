"""
Pipeline runner — orchestrates the local AI jobs in sequence.

Jobs:
  Job 1 (qwen3:8b):  Classify articles → player_notes + ai_summaries → R2
  Job 2 (qwen3:14b): Analyze player data → waiver/lineup/trade → R2
  Job 3 (qwen3:14b): Generate player writeups → player_writeups.json → R2
                     Requires players/player_profiles.json from Databricks export.
  Job 4 (qwen3:14b): Weekly start/sit advisor → weekly_startsit.json → R2
                     Analyzes matchup, weather, form, snap trends per rostered player.
                     Run Thursday/Friday each week.
    Job 5 (qwen3:30b): Deep fantasy reasoning → deep_reasoning.json → R2
                                         Separate high-complexity lane.

All jobs run incrementally by default — only new/changed data is processed.
Use --full to force a complete rerun.

Usage:
  python pipeline_runner.py               # incremental pipeline (all jobs)
  python pipeline_runner.py --full        # reprocess everything
  python pipeline_runner.py --job 1       # job 1 only
  python pipeline_runner.py --job 2       # job 2 only (requires job 1 to have run)
  python pipeline_runner.py --job 3       # job 3 only (requires player_profiles.json)
  python pipeline_runner.py --job 4       # job 4 only — weekly start/sit
    python pipeline_runner.py --job 5       # job 5 only — 30B deep reasoning
  python pipeline_runner.py --limit 50    # cap articles (fast test)
    python pipeline_runner.py --reasoning-limit 15  # override Job 5's default (300) for a fast test run
  python pipeline_runner.py --dry-run     # run models but don't upload to R2
  python pipeline_runner.py --task waiver # job 2 single task only
  python pipeline_runner.py --pos QB,RB   # job 3/4 position filter
  python pipeline_runner.py --week 3      # job 4 force NFL week
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
    parser.add_argument("--job",     choices=["1", "2", "3", "4", "5", "all"], default="all")
    parser.add_argument("--limit",   type=int, default=None, help="Cap articles for Job 1")
    parser.add_argument("--reasoning-limit", type=int, default=300,
                        help="Cap candidates for Job 5 deep reasoning (default: 300, matching "
                             "orchestrator_weekly_reasoning.py — was silently falling back to "
                             "job5_deep_reasoner.py's own --limit default of 20 whenever this "
                             "script ran without an explicit --reasoning-limit)")
    parser.add_argument("--dry-run", action="store_true", help="Don't upload to R2")
    parser.add_argument("--full",    action="store_true",
                        help="Reprocess all articles/players (ignore cache)")
    parser.add_argument("--task",    choices=["waiver", "lineup", "trade"], default=None,
                        help="Run only this task in Job 2")
    parser.add_argument("--pos",     type=str, default=None,
                        help="Job 3/4 position filter, e.g. QB,RB")
    parser.add_argument("--week",    type=int, default=None,
                        help="Override NFL week for Job 4")
    args = parser.parse_args()

    run_all = args.job == "all"
    run1    = run_all or args.job == "1"
    run2    = run_all or args.job == "2"
    run3    = run_all or args.job == "3"
    run4    = run_all or args.job == "4"
    run5    = run_all or args.job == "5"

    start_time = time.time()
    print(f"\n[pipeline] Starting — {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M UTC')}")
    jobs_label = "1+2+3+4" if run_all else args.job
    print(f"[pipeline] Jobs: {jobs_label} | "
          f"Limit: {args.limit or 'all'} | Dry-run: {args.dry_run}")
    if run_all or (run1 and run4):
        print("[pipeline] NOTE: Jobs 1 and 4 both use Qwen — they run sequentially.")
        print("           To allow 2 concurrent Qwen requests (needs 2x VRAM for 14B):")
        print("           Set OLLAMA_NUM_PARALLEL=2 in the Ollama service environment.")

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

    job3_args = []
    if args.dry_run:
        job3_args.append("--dry-run")
    if args.full:
        job3_args.append("--full")
    if args.pos:
        job3_args += ["--pos", args.pos]

    job4_args = []
    if args.dry_run:
        job4_args.append("--dry-run")
    if args.full:
        job4_args.append("--full")
    if args.pos:
        job4_args += ["--pos", args.pos]
    if args.week:
        job4_args += ["--week", str(args.week)]

    job5_args = []
    if args.reasoning_limit:
        job5_args += ["--limit", str(args.reasoning_limit)]
    if args.dry_run:
        job5_args.append("--dry-run")
    if args.full:
        job5_args.append("--full")

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

    if run3:
        rc = run_job("job3_player_writeups.py", job3_args)
        if rc != 0:
            failed.append("job3")

    if run4:
        rc = run_job("job4_weekly_startsit.py", job4_args)
        if rc != 0:
            failed.append("job4")

    if run5:
        rc = run_job("job5_deep_reasoner.py", job5_args)
        if rc != 0:
            failed.append("job5")

    total = round(time.time() - start_time, 1)
    print(f"\n{'='*60}")
    if failed:
        print(f"[pipeline] DONE in {total}s — FAILED: {', '.join(failed)}")
        sys.exit(1)
    else:
        print(f"[pipeline] DONE in {total}s — all jobs succeeded")


if __name__ == "__main__":
    main()
