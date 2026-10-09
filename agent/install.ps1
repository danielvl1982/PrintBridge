<#
  Installs the PrintBridge agent for the current user (no administrator rights needed):
  registers a Scheduled Task "PrintBridge Agent" that starts the agent hidden at every logon, and starts it now.
  Run it from a PowerShell window:  powershell -ExecutionPolicy Bypass -File agent\install.ps1
  Remove it with agent\uninstall.ps1. Not tested on the development machine: see agent\README.md.
#>
$ErrorActionPreference = 'Stop'
$TaskName = 'PrintBridge Agent'
$AgentDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$AgentFile = Join-Path $AgentDir 'printbridge-agent.js'

# Node must be on PATH (the task runs the full path found here, so it does not depend on the PATH at logon)
$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) {
  Write-Host 'Node.js was not found on PATH. Install the LTS version from https://nodejs.org and run this script again.' -ForegroundColor Red
  exit 1
}
if (-not (Test-Path $AgentFile)) {
  Write-Host "Cannot find $AgentFile" -ForegroundColor Red
  exit 1
}

# Replace an older registration, if any
if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) {
  Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
  Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
}

# At logon of the current user, hidden window, restart if it stops, no time limit
$action = New-ScheduledTaskAction -Execute $node.Source -Argument "`"$AgentFile`"" -WorkingDirectory $AgentDir
$trigger = New-ScheduledTaskTrigger -AtLogOn -User "$env:USERDOMAIN\$env:USERNAME"
$principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet -Hidden -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
  -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1)
Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Principal $principal -Settings $settings `
  -Description 'Local print agent for the PrintBridge label viewer (127.0.0.1 only)' | Out-Null

Start-ScheduledTask -TaskName $TaskName
Start-Sleep -Seconds 2

Write-Host "Installed. The agent starts at every logon and is running now: http://127.0.0.1:9631/health" -ForegroundColor Green
Write-Host 'Open the app, expand the "Impresion" panel and pick a printer. To remove it: agent\uninstall.ps1'
