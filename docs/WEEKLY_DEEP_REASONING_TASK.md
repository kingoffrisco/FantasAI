# Weekly Deep Reasoning Task

This task runs the dedicated Qwen3:30b deep-reasoning lane on its own weekly
overnight schedule. It does not run ingestion or the normal 8B/14B jobs.

> **2026-08-22:** Bumped from 15 to 300 players/week after validating output
> quality on smaller batches (see the deep-reasoning validation pass in the
> project history). `ExecutionTimeLimit` should be raised from the original
> `2H` to at least `6H` to match — see the update command below. At the
> ~2s/player pace seen once the model is warm, 300 players is only ~10
> minutes, but per-player time has spiked to ~2 minutes when something else
> on the box evicted the 30B model from VRAM mid-run, so the ceiling needs
> real headroom, not just the expected-case number.

## What it runs

- `local_processing/orchestrator_weekly_reasoning.py`
- Which calls `local_processing/job5_deep_reasoner.py`
- Which writes `fantasai/analysis/deep_reasoning.json`

## Schedule

- Wednesday at 1:30 AM
- Task name: `FantasAI - Weekly Deep Reasoning`
- Task path: `\FantasAI\`

## Register the task

Run this from an elevated PowerShell prompt:

```powershell
$action = New-ScheduledTaskAction `
    -Execute 'C:\Python314\python.exe' `
    -Argument 'D:\Project\Fantasy\local_processing\orchestrator_weekly_reasoning.py' `
    -WorkingDirectory 'D:\Project\Fantasy\local_processing'

$trigger = New-ScheduledTaskTrigger `
    -Weekly -WeeksInterval 1 -DaysOfWeek Wednesday -At '01:30AM'

$settings = New-ScheduledTaskSettingsSet `
    -ExecutionTimeLimit (New-TimeSpan -Hours 6) `
    -StartWhenAvailable -DontStopOnIdleEnd

Register-ScheduledTask `
    -TaskName 'FantasAI - Weekly Deep Reasoning' `
    -TaskPath '\FantasAI\' `
    -Action $action `
    -Trigger $trigger `
    -Settings $settings `
    -RunLevel Highest `
    -Force
```

## Update an already-registered task (no need to fully re-register)

If the task already exists and you just need to bump `ExecutionTimeLimit`
(e.g. after raising `--limit`), run this instead, from an elevated prompt:

```powershell
$task = Get-ScheduledTask -TaskName 'FantasAI - Weekly Deep Reasoning' -TaskPath '\FantasAI\'
$task.Settings.ExecutionTimeLimit = 'PT6H'
Set-ScheduledTask -TaskName 'FantasAI - Weekly Deep Reasoning' -TaskPath '\FantasAI\' -Settings $task.Settings
```

## Notes

- Adjust `C:\Python314\python.exe` if your Python interpreter lives elsewhere.
- If you want a different overnight window, change the `-DaysOfWeek` and `-At`
  values in the trigger.