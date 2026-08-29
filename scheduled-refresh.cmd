@echo off
REM Compatibility launcher. Task Scheduler invokes scheduled-refresh.ps1 directly.
@powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "%~dp0scheduled-refresh.ps1"
@exit /b %ERRORLEVEL%
