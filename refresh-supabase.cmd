@echo off
setlocal
cd /d "%~dp0"

echo.
echo ============================================================
echo Refresh Supabase data (scrape sources + leagues, push to cloud)
echo ============================================================
echo.

if not exist ".venv\Scripts\python.exe" (
  echo Python virtual environment not found.
  echo Run start-app.cmd once first to create it, then re-run this.
  echo.
  pause
  exit /b 1
)

if not exist ".env" (
  echo No .env found. Create one at the project root with:
  echo   DATABASE_URL=postgresql://...  ^(your Supabase connection string^)
  echo.
  pause
  exit /b 1
)

rem Pass through any flags, e.g.  refresh-supabase.cmd --continuous
".venv\Scripts\python.exe" backend\refresh_supabase.py %*
set "EXITCODE=%ERRORLEVEL%"

echo.
if "%EXITCODE%"=="0" (
  echo Refresh complete. The live site now shows the updated data.
) else (
  echo Refresh finished with errors ^(exit %EXITCODE%^). Review the messages above.
)
echo.
pause
exit /b %EXITCODE%
