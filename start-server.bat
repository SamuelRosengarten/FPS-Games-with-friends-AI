@echo off
rem Breachpoint server launcher for Windows - double-click me.
cd /d "%~dp0"
title Breachpoint server
where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo   Node.js is not installed.
  echo   Install the LTS version from https://nodejs.org and double-click this file again.
  echo.
  start "" "https://nodejs.org/en/download"
  pause
  exit /b 1
)
node server\index.js %*
echo.
echo   Server stopped.
pause
