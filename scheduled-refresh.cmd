@echo off
REM Unattended ranking-source + connected-league refresh -> Supabase.
REM Invoked by the "FantasyBaseball Refresh" Windows scheduled task (5am + noon daily).
REM The Ottoneu platform curve has its own 3am task so the large sample runs once daily.
REM Logs each run to logs\scheduled-refresh.log. Run start-app.cmd once first to create .venv.
setlocal
cd /d "%~dp0"

if not exist "logs" mkdir "logs"
if not exist ".venv\Scripts\python.exe" (
  echo [%DATE% %TIME%] ERROR: .venv not found - run start-app.cmd once first.>> "logs\scheduled-refresh.log"
  exit /b 1
)
if not exist ".env" (
  echo [%DATE% %TIME%] ERROR: .env not found - needs DATABASE_URL for Supabase.>> "logs\scheduled-refresh.log"
  exit /b 1
)

echo.>> "logs\scheduled-refresh.log"
echo ============================================================>> "logs\scheduled-refresh.log"
echo [%DATE% %TIME%] Starting scheduled refresh (sources + connected leagues)>> "logs\scheduled-refresh.log"
".venv\Scripts\python.exe" backend\refresh_supabase.py --skip-platform >> "logs\scheduled-refresh.log" 2>&1
set "refreshExit=%ERRORLEVEL%"
echo [%DATE% %TIME%] Exit code %refreshExit%>> "logs\scheduled-refresh.log"
exit /b %refreshExit%
