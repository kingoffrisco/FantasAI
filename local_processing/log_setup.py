"""
Persistent run-logging for the orchestrators.

Windows Task Scheduler runs these headless with no stdout/stderr capture, and
the Task Scheduler Operational event log is disabled on this machine — so
without this, a failed or truncated run leaves zero evidence behind.

Usage (from an orchestrator's main()):
  from log_setup import setup_logging
  log_fh = setup_logging("daily")
  ...
  run(script, args, label, log_fh=log_fh)   # pass through to run()
"""

import os
import sys
from datetime import datetime, timezone
from pathlib import Path

LOG_DIR = Path(__file__).parent / "logs"
RETAIN_DAYS = 14


def child_env():
    """
    Env for subprocess.run() calls whose stdout is redirected to a file.

    Forces UTF-8 I/O in the child. Without this, redirecting a script's
    stdout to anything other than a real console (a file, DEVNULL, a pipe)
    makes Python fall back to the system ANSI codepage (cp1252 here), and
    every emoji/arrow print() in these scripts then crashes with
    UnicodeEncodeError. Task Scheduler's default no-redirection launch
    doesn't hit this, but capturing output to a log file does.
    """
    env = os.environ.copy()
    env["PYTHONUTF8"] = "1"
    return env


class _Tee:
    """Writes to both the original stream (if any) and the log file."""

    def __init__(self, original, log_fh):
        self._original = original
        self._log_fh = log_fh

    def write(self, data):
        if self._original:
            try:
                self._original.write(data)
            except Exception:
                pass
        self._log_fh.write(data)

    def flush(self):
        if self._original:
            try:
                self._original.flush()
            except Exception:
                pass
        self._log_fh.flush()


def _prune_old_logs():
    if not LOG_DIR.exists():
        return
    cutoff = datetime.now().timestamp() - RETAIN_DAYS * 86400
    for f in LOG_DIR.glob("*.log"):
        try:
            if f.stat().st_mtime < cutoff:
                f.unlink()
        except OSError:
            pass


def setup_logging(orchestrator_name: str):
    """
    Opens logs/<name>_<YYYYMMDD_HHMMSS>.log, tees sys.stdout/sys.stderr into it,
    and returns the raw file handle (for passing to subprocess.run as
    stdout/stderr so child-process output lands in the same file).
    """
    LOG_DIR.mkdir(exist_ok=True)
    _prune_old_logs()

    stamp = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
    log_path = LOG_DIR / f"{orchestrator_name}_{stamp}.log"
    log_fh = open(log_path, "w", encoding="utf-8", buffering=1)

    sys.stdout = _Tee(sys.stdout, log_fh)
    sys.stderr = _Tee(sys.stderr, log_fh)

    print(f"[log_setup] Logging this run to {log_path}")
    return log_fh
