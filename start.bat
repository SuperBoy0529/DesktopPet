@echo off
setlocal
cd /d "%~dp0"
title Worldline Divergence Meter

rem ---------------------------------------------------------------------------
rem This file is intentionally ASCII-only: cmd.exe reads .bat files using the
rem system ANSI code page (GBK on a Chinese Windows). Non-ASCII text here
rem desyncs the batch parser and can swallow following lines, including the
rem "pause" that is supposed to keep this window open on failure.
rem ---------------------------------------------------------------------------

where node >nul 2>nul
if errorlevel 1 (
  echo [error] Node.js not found in PATH.
  echo         Install Node.js, or run the app with: npm start
  pause
  exit /b 1
)

if not exist "node_modules\electron\dist\electron.exe" (
  echo [setup] Electron runtime missing, trying to install it...
  call npm install --no-audit --no-fund
  if errorlevel 1 (
    echo [error] npm install failed.
    pause
    exit /b 1
  )
  node "node_modules\electron\install.js"
  if errorlevel 1 (
    echo [error] Electron runtime download failed.
    echo         If github.com is unreachable, set the mirror first:
    echo           set ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/
    echo           set ELECTRON_CUSTOM_DIR={{ version }}
    echo           set ELECTRON_CUSTOM_FILENAME=electron-v44.9.0-win32-x64.zip
    pause
    exit /b 1
  )
)

echo [boot] starting Worldline Divergence Meter...
node launch.js
if errorlevel 1 (
  echo.
  echo [error] Startup failed. See logs\app.log for details.
  pause
  exit /b 1
)
exit /b 0
