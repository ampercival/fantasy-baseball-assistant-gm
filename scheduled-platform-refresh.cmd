@echo off
REM Unattended Ottoneu platform value-curve refresh -> Supabase.
REM Invoked by the "FantasyBaseball Platform Curve Refresh" Windows scheduled task at 3am daily.
REM Uses the sample size saved in Supabase and writes to logs\scheduled-platform-refresh.log.
setlocal
cd /d "%~dp0"

if not exist "logs" mkdir "logs"
if not exist ".venv\Scripts\python.exe" (
  echo [%DATE% %TIME%] ERROR: .venv not found - run start-app.cmd once first.>> "logs\scheduled-platform-refresh.log"
  exit /b 1
)
if not exist ".env" (
  echo [%DATE% %TIME%] ERROR: .env not found - needs DATABASE_URL for Supabase.>> "logs\scheduled-platform-refresh.log"
  exit /b 1
)

echo.>> "logs\scheduled-platform-refresh.log"
echo ============================================================>> "logs\scheduled-platform-refresh.log"
echo [%DATE% %TIME%] Starting scheduled Ottoneu platform curve refresh>> "logs\scheduled-platform-refresh.log"
".venv\Scripts\python.exe" backend\refresh_supabase.py --skip-sources --skip-leagues --skip-lineup >> "logs\scheduled-platform-refresh.log" 2>&1
set "refreshExit=%ERRORLEVEL%"
echo [%DATE% %TIME%] Exit code %refreshExit%>> "logs\scheduled-platform-refresh.log"
exit /b %refreshExit%
