"""
Failure notification helper — shows a Windows toast notification.

No credentials, no internet, no setup required.
Appears in the bottom-right corner of the screen when a job fails.

Usage (from orchestrators):
  from notify import send_failure
  if failed:
      send_failure(failed, orchestrator="Daily")
      sys.exit(1)

Stand-alone test:
  python notify.py
"""

import subprocess
from datetime import datetime, timezone


def send_failure(failed_jobs: list[str], orchestrator: str = "FantasAI") -> bool:
    """
    Show a Windows toast notification listing which jobs failed.
    Returns True on success. Silent on failure so it never crashes the orchestrator.
    """
    now      = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
    jobs_str = ", ".join(failed_jobs)
    title    = f"FantasAI {orchestrator} FAILED"
    message  = f"{len(failed_jobs)} job(s) failed: {jobs_str}\\n{now}"

    ps = f"""
[Windows.UI.Notifications.ToastNotificationManager,
 Windows.UI.Notifications, ContentType=WindowsRuntime] | Out-Null
$xml = [Windows.UI.Notifications.ToastNotificationManager]::GetTemplateContent(
    [Windows.UI.Notifications.ToastTemplateType]::ToastText02)
$xml.GetElementsByTagName('text')[0].AppendChild(
    $xml.CreateTextNode('{title}')) | Out-Null
$xml.GetElementsByTagName('text')[1].AppendChild(
    $xml.CreateTextNode('{message}')) | Out-Null
$toast = [Windows.UI.Notifications.ToastNotification]::new($xml)
[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier(
    'FantasAI').Show($toast)
"""

    try:
        subprocess.run(
            ["powershell", "-WindowStyle", "Hidden", "-Command", ps],
            timeout=10,
            check=True,
        )
        print(f"   [notify] Desktop notification shown — {title}")
        return True
    except Exception as exc:
        print(f"   [notify] Could not show notification: {exc}")
        return False


if __name__ == "__main__":
    ok = send_failure(["test_job_a", "test_job_b"], orchestrator="Test")
    if ok:
        print("Test notification sent — check bottom-right of your screen.")
    else:
        print("Notification failed.")
