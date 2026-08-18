# Weekly Deep Reasoning Task

This task runs the dedicated Qwen3:30b deep-reasoning lane on its own weekly
overnight schedule. It does not run ingestion or the normal 8B/14B jobs.

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
    -ExecutionTimeLimit (New-TimeSpan -Hours 2) `
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

## Notes

- Adjust `C:\Python314\python.exe` if your Python interpreter lives elsewhere.
- If you want a different overnight window, change the `-DaysOfWeek` and `-At`
  values in the trigger.