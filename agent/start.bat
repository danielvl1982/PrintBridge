@echo off
rem Runs the PrintBridge agent in this console (close the window or press Ctrl+C to stop it).
rem Use install.ps1 instead to have it start by itself at every logon.
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js was not found on PATH. Install the LTS version from https://nodejs.org
  pause
  exit /b 1
)
title PrintBridge agent
node "%~dp0printbridge-agent.js"
pause
