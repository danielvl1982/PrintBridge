<#
  Removes the PrintBridge agent Scheduled Task and stops the running agent (current user, no administrator rights needed).
  Run it from a PowerShell window:  powershell -ExecutionPolicy Bypass -File agent\uninstall.ps1
  Not tested on the development machine: see agent\README.md.
#>
$ErrorActionPreference = 'Stop'
$TaskName = 'PrintBridge Agent'

if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) {
  Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
  Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
  Write-Host "Scheduled Task '$TaskName' removed." -ForegroundColor Green
} else {
  Write-Host "Scheduled Task '$TaskName' was not installed."
}

# Stopping the task does not always end the node process it started: stop any agent still running
Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" |
  Where-Object { $_.CommandLine -like '*printbridge-agent.js*' } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force; Write-Host "Stopped agent process $($_.ProcessId)." }
