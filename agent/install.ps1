<#
  Downloads the PrintBridge agent and starts it (current user, no administrator rights needed).

  One-liner (downloads the latest agent into %LOCALAPPDATA%\PrintBridge and starts it in the background):
    irm https://raw.githubusercontent.com/danielvl1982/PrintBridge/main/agent/install.ps1 | iex

  With options (a piped script cannot take parameters, so wrap it in a script block):
    & ([scriptblock]::Create((irm https://raw.githubusercontent.com/danielvl1982/PrintBridge/main/agent/install.ps1))) -Autostart

  From a checkout of the repository the files next to this script are used (nothing is downloaded):
    powershell -ExecutionPolicy Bypass -File agent\install.ps1 [-Autostart] [-Foreground] [-Uninstall]

  -Autostart   Also register the Scheduled Task "PrintBridge Agent": the agent starts hidden at every logon and is restarted if it stops.
  -Foreground  Run the agent in this window instead of in the background (Ctrl+C stops it): useful to see its log lines.
  -Uninstall   Stop the agent, remove the Scheduled Task and delete the downloaded files (config.json is kept).
  -InstallDir  Where the agent is downloaded (default %LOCALAPPDATA%\PrintBridge). Ignored when running from a checkout.
  -TaskName    Name of the Scheduled Task (default "PrintBridge Agent").
  -BaseUrl     Where the files are downloaded from (default: the main branch of the GitHub repository; change it to use a fork or a tag).
#>
param(
  [switch]$Autostart,
  [switch]$Foreground,
  [switch]$Uninstall,
  [string]$TaskName = 'PrintBridge Agent',
  [string]$InstallDir = (Join-Path $env:LOCALAPPDATA 'PrintBridge'),
  [string]$BaseUrl = 'https://raw.githubusercontent.com/danielvl1982/PrintBridge/main/agent'
)
$ErrorActionPreference = 'Stop'
$Files = @('printbridge-agent.js', 'config.example.json')

# $PSScriptRoot is empty when the script arrives through "irm | iex" or a script block: then the files must be downloaded
$local = $PSScriptRoot -and (Test-Path (Join-Path $PSScriptRoot 'printbridge-agent.js'))
$AgentDir = if ($local) { $PSScriptRoot } else { $InstallDir }
$AgentFile = Join-Path $AgentDir 'printbridge-agent.js'

# The port comes from config.json when there is one (see agent\README.md), otherwise it is the default
$port = 9631
$configFile = Join-Path $AgentDir 'config.json'
if (Test-Path $configFile) {
  try { $configured = (Get-Content $configFile -Raw | ConvertFrom-Json).port; if ($configured) { $port = [int]$configured } } catch { }
}
$HealthUrl = "http://127.0.0.1:$port/health"

function Stop-Agent {
  # Stopping the task does not always end the node process it started: stop the agent of THIS folder if it is still running
  Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -like "*$AgentFile*" } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue; Write-Host "Stopped the agent process $($_.ProcessId)." }
}

function Remove-AgentTask {
  if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) {
    Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
    return $true
  }
  return $false
}

if ($Uninstall) {
  if (Remove-AgentTask) { Write-Host "Scheduled Task '$TaskName' removed." -ForegroundColor Green }
  else { Write-Host "Scheduled Task '$TaskName' was not installed." }
  Stop-Agent
  if (-not $local -and (Test-Path $AgentDir)) {
    foreach ($name in $Files) { Remove-Item (Join-Path $AgentDir $name) -Force -ErrorAction SilentlyContinue }
    if (-not (Get-ChildItem $AgentDir -Force)) { Remove-Item $AgentDir -Force }
    Write-Host "Removed the downloaded files from $AgentDir (config.json, if you made one, is kept)."
  }
  return
}

# Node 18 or newer must be on PATH (the task runs the full path found here, so it does not depend on the PATH at logon)
$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) {
  Write-Host 'Node.js was not found on PATH. Install the LTS version from https://nodejs.org, open a new terminal and run this again.' -ForegroundColor Red
  return
}
$major = [int]((& $node.Source --version).TrimStart('v').Split('.')[0])
if ($major -lt 18) {
  Write-Host "Node.js $major is too old: the agent needs version 18 or newer (https://nodejs.org)." -ForegroundColor Red
  return
}

# An agent that is running keeps its file busy and its port taken: stop it before replacing anything
Stop-Agent

if (-not $local) {
  Write-Host "Downloading the agent into $AgentDir ..."
  New-Item -ItemType Directory -Path $AgentDir -Force | Out-Null
  # Windows PowerShell 5.1 does not offer TLS 1.2 by default, which GitHub requires
  [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
  $ProgressPreference = 'SilentlyContinue'
  foreach ($name in $Files) {
    # Download beside the target and move it into place, so a failed download never leaves a half-written agent behind
    $target = Join-Path $AgentDir $name
    $partial = "$target.download"
    try {
      Invoke-WebRequest -Uri "$($BaseUrl.TrimEnd('/'))/$name" -OutFile $partial -UseBasicParsing
    } catch {
      Remove-Item $partial -Force -ErrorAction SilentlyContinue
      Write-Host "Could not download $name from $BaseUrl : $($_.Exception.Message)" -ForegroundColor Red
      return
    }
    Move-Item $partial $target -Force
  }
} elseif (-not (Test-Path $AgentFile)) {
  Write-Host "Cannot find $AgentFile" -ForegroundColor Red
  return
}

if ($Foreground) {
  Write-Host 'Running the agent in this window. Press Ctrl+C to stop it.'
  & $node.Source $AgentFile
  return
}

if ($Autostart) {
  # At logon of the current user, hidden window, restart if it stops, no time limit
  Remove-AgentTask | Out-Null
  $action = New-ScheduledTaskAction -Execute $node.Source -Argument "`"$AgentFile`"" -WorkingDirectory $AgentDir
  $trigger = New-ScheduledTaskTrigger -AtLogOn -User "$env:USERDOMAIN\$env:USERNAME"
  $principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive -RunLevel Limited
  $settings = New-ScheduledTaskSettingsSet -Hidden -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
    -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1)
  Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Principal $principal -Settings $settings `
    -Description 'Local print agent for the PrintBridge label viewer (127.0.0.1 only)' | Out-Null
  Start-ScheduledTask -TaskName $TaskName
} else {
  Start-Process -FilePath $node.Source -ArgumentList "`"$AgentFile`"" -WorkingDirectory $AgentDir -WindowStyle Hidden
}

# Wait up to ~6 seconds for the agent to answer
$version = $null
for ($i = 0; $i -lt 12 -and -not $version; $i++) {
  Start-Sleep -Milliseconds 500
  try { $version = (Invoke-RestMethod -Uri $HealthUrl -TimeoutSec 2).version } catch { }
}
if (-not $version) {
  Write-Host "The agent was started but does not answer at $HealthUrl. Run this again with -Foreground to see its messages." -ForegroundColor Red
  return
}

Write-Host "PrintBridge agent $version is running: $HealthUrl" -ForegroundColor Green
if ($Autostart) { Write-Host "It will start by itself at every logon (Scheduled Task '$TaskName')." }
else { Write-Host 'It runs until you log off or restart. Run this again with -Autostart to start it at every logon.' }
Write-Host 'Open the app, expand the Print panel and pick a printer. To remove everything, run this again with -Uninstall.'
