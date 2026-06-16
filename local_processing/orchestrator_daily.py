"""
Daily News Ingestion Orchestrator
Replaces: Databricks Job 943551462212511 (FantasAI - Daily News Ingestion)
          Databricks Job 556044300919171  (API-Sports.io Daily Stats)

Execution order (mirrors Databricks 3-task job):
  Task 1 — Ingest from all news sources
    ├─ Sleeper API  (players, injuries, trending)
    ├─ ESPN News    (articles per player)
    ├─ Google News  (RSS, top 200 players, incremental)
    └─ NFL Transactions (last 30 days)
  Task 2 — Gold transformation (player consolidation)
  Task 3 — R2 export (news + analysis data)
  Task 4 — AI pipeline (optional, non-fatal)
    ├─ Job 1 — Bulk news processor (Qwen 8B)
    ├─ Job 2 — Fantasy scorer (Qwen 14B)
    └─ Job 3 — Player writeups (Qwen 14B, rostered players only)

Schedule (Windows Task Scheduler):
  Daily at 7:00 AM — "FantasAI - Daily News Orchestrator"

Registration command:
  $action  = New-ScheduledTaskAction -Execute "C:\Python314\python.exe" `
               -Argument "D:\Project\Fantasy\local_processing\orchestrator_daily.py" `
               -WorkingDirectory "D:\Project\Fantasy\local_processing"
  $trigger = New-ScheduledTaskTrigger -Daily -At "07:00AM"
  $settings= New-ScheduledTaskSettingsSet -ExecutionTimeLimit (New-TimeSpan -Hours 2) `
               -StartWhenAvailable -DontStopOnIdleEnd
  Register-ScheduledTask -TaskName "FantasAI - Daily News Orchestrator" `
    -TaskPath "\FantasAI\" -Action $action -Trigger $trigger `
    -Settings $settings -RunLevel Highest -Force

Usage:
  python orchestrator_daily.py
  python orchestrator_daily.py --skip-ingest   # gold + export only
  python orchestrator_daily.py --skip-export   # ingest + gold only
  python orchestrator_daily.py --dry-run
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
    def send_failure(*a, **kw): pass


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
    parser.add_argument("--skip-ingest", action="store_true", help="Skip ingestion, run gold+export only")
    parser.add_argument("--skip-export", action="store_true", help="Skip R2 export")
    parser.add_argument("--skip-ai",     action="store_true", help="Skip AI pipeline (job1/job2/job3)")
    parser.add_argument("--dry-run",     action="store_true", help="Pass --dry-run to all scripts")
    args = parser.parse_args()

    extra = ["--dry-run"] if args.dry_run else []

    print("=" * 70)
    print("FantasAI — Daily News Orchestrator")
    print(f"Started: {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M UTC')}")
    print("=" * 70)

    t_start = time.time()
    failed  = []

    # ── Task 1: Ingestion ──────────────────────────────────────────────────────
    if not args.skip_ingest:
        print("\n\n══ TASK 1: NEWS INGESTION ══════════════════════════════════════════")

        if not run("ingest/ingest_sleeper_players.py", extra, "Sleeper API — players, injuries, trending"):
            failed.append("sleeper")

        if not run("ingest/ingest_espn_news.py", extra, "ESPN News API — articles"):
            failed.append("espn_news")

        if not run("ingest/ingest_google_news.py", ["--mode", "incremental"] + extra,
                   "Google News RSS — incremental (last 7 days)"):
            failed.append("google_news")

        if not run("ingest/ingest_nfl_transactions.py", ["--days", "30"] + extra,
                   "NFL Transactions — last 30 days"):
            failed.append("transactions")

    # ── Task 2: Gold Transformation ────────────────────────────────────────────
    print("\n\n══ TASK 2: GOLD TRANSFORMATION ══════════════════════════════════════")
    if not run("gold/gold_player_consolidation.py", extra, "Gold player consolidation"):
        failed.append("gold")

    # ── Task 3: R2 Export ──────────────────────────────────────────────────────
    if not args.skip_export:
        print("\n\n══ TASK 3: R2 EXPORT ════════════════════════════════════════════════")
        if not run("export/export_to_r2.py", ["--only", "all"] + extra, "Export to Cloudflare R2"):
            failed.append("r2_export")

    # ── Task 4: AI Pipeline (optional — needs Ollama running) ─────────────────
    if not args.skip_ai and not args.dry_run:
        print("\n\n══ TASK 4: AI PIPELINE ══════════════════════════════════════════════")
        # Non-fatal: AI failures don't block the pipeline
        if not run("job1_news_processor.py", [], "Job 1 — Bulk news processor (Qwen 8B)"):
            print("   ⚠️  Job 1 failed — Ollama may not be running; skipping job2/job3")
        else:
            run("job2_fantasy_analyzer.py", [], "Job 2 — Fantasy scorer (Qwen 14B)")
            run("job3_player_writeups.py", ["--mode", "rostered"], "Job 3 — Player writeups (rostered only)")

    elapsed = round(time.time() - t_start)
    print(f"\n{'=' * 70}")
    print(f"Finished: {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M UTC')}")
    print(f"Duration: {elapsed}s ({elapsed // 60}m {elapsed % 60}s)")
    if failed:
        print(f"❌ FAILED tasks: {', '.join(failed)}")
        send_failure(failed, orchestrator="Daily")
        sys.exit(1)
    else:
        print("✅ Daily orchestration complete — UI sees fresh data")


if __name__ == "__main__":
    main()
