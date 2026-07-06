@echo off
setlocal
cd /d "%~dp0"

echo.
echo ============================================================
echo Refresh worker - watches Supabase for "Refresh" requests from
echo the website and scrapes on demand (pushing results to Supabase).
echo Keep this window open, or set it to auto-start at login.
echo Press Ctrl+C to stop.
echo ============================================================
echo.

if not exist ".venv\Scripts\python.exe" (
  echo Python virtual environment not found. Run start-app.cmd once first.
  echo.
  pause
  exit /b 1
)
if not exist ".env" (
  echo No .env found ^(needs DATABASE_URL for Supabase^).
  echo.
  pause
  exit /b 1
)

".venv\Scripts\python.exe" backend\refresh_worker.py %*
pause
