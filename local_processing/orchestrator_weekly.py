"""
Weekly Stats Ingestion Orchestrator
Replaces: Databricks Jobs:
  444982717808117  — nflverse Weekly Stats  (Tuesday 3:00 AM Central)
  307753042426414  — Sleeper API Weekly      (Tuesday 3:00 AM Central)
  100016462470325  — ADP Pipeline            (Monday 7:00 AM UTC)
  100559857891019  — Export Players Draft    (Monday 8:00 AM UTC)
  369873943083480  — Weekly Injury Updates   (Wednesday 3:00 AM Eastern)

Execution order:
  Phase 1 — Stats ingestion (nflverse + API-Sports for specified week)
  Phase 2 — Gold consolidation (rebuild gold_player_dim + gold_weekly_stats)
  Phase 3 — Full R2 export (all data including analysis)

Schedule (Windows Task Scheduler):
  Tuesday at 3:00 AM — "FantasAI - Weekly Stats Orchestrator"

Registration command:
  $action  = New-ScheduledTaskAction -Execute "C:\Python314\python.exe" `
               -Argument "D:\Project\Fantasy\local_processing\orchestrator_weekly.py" `
               -WorkingDirectory "D:\Project\Fantasy\local_processing"
  $trigger = New-ScheduledTaskTrigger -Weekly -WeeksInterval 1 `
               -DaysOfWeek Tuesday -At "03:00AM"
  $settings= New-ScheduledTaskSettingsSet -ExecutionTimeLimit (New-TimeSpan -Hours 3) `
               -StartWhenAvailable -DontStopOnIdleEnd
  Register-ScheduledTask -TaskName "FantasAI - Weekly Stats Orchestrator" `
    -TaskPath "\FantasAI\" -Action $action -Trigger $trigger `
    -Settings $settings -RunLevel Highest -Force

Usage:
  python orchestrator_weekly.py
  python orchestrator_weekly.py --week 1 --season 2025
  python orchestrator_weekly.py --skip-stats     # gold + export only
  python orchestrator_weekly.py --dry-run
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
    parser.add_argument("--week",        type=int, default=None)
    parser.add_argument("--season",      type=int, default=None)
    parser.add_argument("--seasons",     type=str, default=None, help="nflverse seasons: 2024,2025")
    parser.add_argument("--skip-stats",  action="store_true")
    parser.add_argument("--dry-run",     action="store_true")
    args = parser.parse_args()

    extra = ["--dry-run"] if args.dry_run else []

    print("=" * 70)
    print("FantasAI — Weekly Stats Orchestrator")
    print(f"Started: {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M UTC')}")
    print("=" * 70)

    t_start = time.time()
    failed  = []

    # ── Phase 1: Stats Ingestion ───────────────────────────────────────────────
    if not args.skip_stats:
        print("\n\n══ PHASE 1: STATS INGESTION ════════════════════════════════════════")

        # nflverse (historical + current season stats, headshots, YAC, depth charts)
        nflverse_args = extra[:]
        if args.seasons:
            nflverse_args += ["--seasons", args.seasons]
        if not run("ingest/ingest_nflverse.py", nflverse_args, "nflverse — headshots, YAC, NGS, depth charts, weekly stats"):
            failed.append("nflverse")

        # API-Sports for specific week (uses free tier 100 req/day)
        apisports_args = extra[:]
        if args.week:
            apisports_args += ["--week", str(args.week)]
        if args.season:
            apisports_args += ["--season", str(args.season)]
        if not run("ingest/ingest_apisports.py", apisports_args, "API-Sports.io — weekly game stats"):
            failed.append("apisports")
            print("   ⚠️  API-Sports has 100 req/day free tier — may be exhausted")

        # Sleeper players (refresh roster, injuries, trending — also runs in daily)
        if not run("ingest/ingest_sleeper_players.py", extra, "Sleeper API — full player refresh"):
            failed.append("sleeper")

        # ADP (weekly refresh — FantasyPros consensus rankings)
        if not run("ingest/ingest_adp.py", extra, "ADP — FantasyPros consensus rankings"):
            failed.append("adp")

        # DST performance (weekly scores from Sleeper stats API)
        dst_args = extra[:]
        if args.season:
            dst_args += ["--season", str(args.season)]
        if args.week:
            dst_args += ["--weeks", str(args.week)]
        if not run("ingest/ingest_dst_performance.py", dst_args, "DST performance — Sleeper weekly fantasy scores"):
            failed.append("dst_performance")

        # NFL schedules (nflverse — home/away, venue, dates, scores)
        sched_args = extra[:]
        if args.seasons:
            sched_args += ["--seasons", args.seasons]
        if not run("ingest/ingest_schedules.py", sched_args, "NFL schedules — nflverse game schedule"):
            failed.append("schedules")

        # NFL Combine measurables (nflverse — 40-time, bench, vertical, cone, shuttle)
        combine_args = extra[:]
        if args.seasons:
            combine_args += ["--seasons", args.seasons]
        if not run("ingest/ingest_combine.py", combine_args, "NFL Combine data — nflverse measurables"):
            failed.append("combine")

        # Player ownership (Sleeper public league sampling — runs weekly, non-fatal)
        if not run("ingest/ingest_ownership.py", extra, "Player ownership % — Sleeper public leagues"):
            print("   ⚠️  Ownership crawl failed (non-fatal)")
            # Not added to failed[] — ownership is best-effort

    # ── Phase 2: Gold Consolidation ────────────────────────────────────────────
    print("\n\n══ PHASE 2: GOLD CONSOLIDATION ══════════════════════════════════════")
    if not run("gold/gold_player_consolidation.py", extra, "Gold player consolidation"):
        failed.append("gold")

    # ── Phase 3: Full R2 Export ────────────────────────────────────────────────
    print("\n\n══ PHASE 3: R2 EXPORT ═══════════════════════════════════════════════")
    if not run("export/export_to_r2.py", ["--only", "all"] + extra, "Export all data to Cloudflare R2"):
        failed.append("r2_export")

    elapsed = round(time.time() - t_start)
    print(f"\n{'=' * 70}")
    print(f"Finished: {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M UTC')}")
    print(f"Duration: {elapsed}s ({elapsed // 60}m {elapsed % 60}s)")
    if failed:
        print(f"❌ FAILED tasks: {', '.join(failed)}")
        send_failure(failed, orchestrator="Weekly")
        sys.exit(1)
    else:
        print("✅ Weekly orchestration complete")


if __name__ == "__main__":
    main()
