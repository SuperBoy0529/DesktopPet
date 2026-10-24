@echo off
rem  IExpress entry point. Runs the PowerShell installer from the extract dir.
title Worldline Divergence Meter - Setup
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0install.ps1"
exit /b %errorlevel%
