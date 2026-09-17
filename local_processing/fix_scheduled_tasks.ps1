# Run this from an elevated PowerShell (right-click PowerShell -> "Run as Administrator")

# 1. Fix "FantasAI Pipeline Runner" — it's been running under Miniconda3's Python,
#    which is missing `duckdb`, silently degrading Job 3's writeup quality every
#    Monday (college/combine/efficiency enrichment gets dropped, caught by a
#    try/except so it never shows up as a failure).
$action = New-ScheduledTaskAction -Execute "C:\Python314\python.exe" -Argument "pipeline_runner.py" -WorkingDirectory "D:\Project\Fantasy\local_processing"
Set-ScheduledTask -TaskName "FantasAI Pipeline Runner" -TaskPath "\FantasAI\" -Action $action
Write-Host "Fixed Pipeline Runner interpreter."

# 2. Create a dedicated schedule for Job 4 (weekly start/sit advisor) — it
#    currently has NO schedule of its own; it only ever ran via Pipeline Runner's
#    once-a-week Monday slot. Job 4's own docstring says it should run
#    Thursday/Friday, right before games, so injury reports are current.
#    Its last real output was 6 days stale (generated 8/30) at time of writing.
$action4  = New-ScheduledTaskAction -Execute "C:\Python314\python.exe" `
              -Argument "D:\Project\Fantasy\local_processing\job4_weekly_startsit.py" `
              -WorkingDirectory "D:\Project\Fantasy\local_processing"
$trigger4 = New-ScheduledTaskTrigger -Weekly -WeeksInterval 1 -DaysOfWeek Thursday -At "03:00AM"
$settings4= New-ScheduledTaskSettingsSet -ExecutionTimeLimit (New-TimeSpan -Hours 2) `
              -StartWhenAvailable -DontStopOnIdleEnd
Register-ScheduledTask -TaskName "FantasAI - Job4 Weekly StartSit" -TaskPath "\FantasAI\" `
  -Action $action4 -Trigger $trigger4 -Settings $settings4 -RunLevel Highest -Force
Write-Host "Registered dedicated Job 4 schedule (Thursday 3:00 AM)."

# Verify both
Get-ScheduledTask -TaskPath "\FantasAI\" | Where-Object { $_.TaskName -match "Pipeline Runner|Job4" } |
  ForEach-Object { $_.Actions | Select-Object @{n='Task';e={$_.TaskPath}}, Execute, Arguments }
