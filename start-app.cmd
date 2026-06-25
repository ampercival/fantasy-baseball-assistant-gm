@echo off
setlocal

set "ROOT=%~dp0"
set "ROOT=%ROOT:~0,-1%"

cd /d "%ROOT%" || goto fail

echo.
echo Fantasy Baseball Assistant GM
echo Working directory: %ROOT%
echo.

where node >nul 2>nul || (
  echo Node.js was not found on PATH. Install Node.js 24 LTS and reopen PowerShell.
  goto fail
)

where npm >nul 2>nul || (
  echo npm was not found on PATH. Install Node.js 24 LTS and reopen PowerShell.
  goto fail
)

where python >nul 2>nul
if errorlevel 1 (
  where py >nul 2>nul || (
    echo Python was not found on PATH. Install Python 3.12+ and reopen PowerShell.
    goto fail
  )
  set "PY_CREATE=py -3"
) else (
  set "PY_CREATE=python"
)

for /f "tokens=*" %%v in ('node -v') do set "NODE_VERSION=%%v"
for /f "tokens=*" %%v in ('npm -v') do set "NPM_VERSION=%%v"
echo Node: %NODE_VERSION%
echo npm:  %NPM_VERSION%
echo.

for /f "tokens=*" %%i in ('powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "$privatePattern = '^(10\.|192\.168\.|172\.(1[6-9]|2[0-9]|3[0-1])\.)'; $ip = Get-NetIPConfiguration | Where-Object { $_.IPv4DefaultGateway -and $_.IPv4Address } | ForEach-Object { $_.IPv4Address | Where-Object { $_.IPAddress -match $privatePattern } | Select-Object -ExpandProperty IPAddress -First 1 } | Select-Object -First 1; if (-not $ip) { $ip = Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.IPAddress -match $privatePattern -and $_.IPAddress -notlike '169.254.*' } | Select-Object -ExpandProperty IPAddress -First 1 }; if ($ip) { Write-Output $ip }"') do set "LAN_IP=%%i"

if not defined LAN_IP (
  echo No private LAN IPv4 address was found.
  echo Connect this computer to your local network and run this script again.
  goto fail
)

echo Local network IP: %LAN_IP%
echo.

call "%ROOT%\stop-app.cmd"
if errorlevel 1 (
  echo.
  echo Some existing app listeners could not be stopped automatically.
  echo The script will start this app on fresh local ports instead.
  echo.
)

if not exist ".venv\Scripts\python.exe" (
  echo Creating Python virtual environment...
  %PY_CREATE% -m venv .venv || goto fail
)

echo Installing backend dependencies...
".venv\Scripts\python.exe" -m pip install --disable-pip-version-check -r backend\requirements.txt || goto fail

if not exist "frontend\node_modules" (
  echo Installing frontend dependencies...
  pushd frontend || goto fail
  npm install || (
    popd
    goto fail
  )
  popd
) else (
  echo Frontend dependencies already installed.
)

call :findFreePort 8000 8020 BACKEND_PORT
if not defined BACKEND_PORT (
  echo No free backend port found between 8000 and 8020.
  goto fail
)

call :findFreePort 5173 5190 FRONTEND_PORT
if not defined FRONTEND_PORT (
  echo No free frontend port found between 5173 and 5190.
  goto fail
)

set "API_URL=http://127.0.0.1:%BACKEND_PORT%"
set "APP_URL=http://%LAN_IP%:%FRONTEND_PORT%"

echo Starting backend on %API_URL% ...
start "Assistant GM API" powershell.exe -NoExit -NoProfile -ExecutionPolicy Bypass -Command "Set-Location -LiteralPath '%ROOT%'; & '.\.venv\Scripts\python.exe' -m uvicorn app.main:app --app-dir backend --host 127.0.0.1 --port %BACKEND_PORT%"

echo Starting frontend on %APP_URL% ...
start "Assistant GM UI" powershell.exe -NoExit -NoProfile -ExecutionPolicy Bypass -Command "$env:ASSISTANT_GM_API_URL='%API_URL%'; $env:ASSISTANT_GM_UI_PORT='%FRONTEND_PORT%'; Set-Location -LiteralPath '%ROOT%\frontend'; npm run dev -- --host %LAN_IP% --port %FRONTEND_PORT%"

echo Opening %APP_URL% ...
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "Start-Sleep -Seconds 4"
start "" "%APP_URL%"

echo.
echo Startup complete.
echo Use this URL from devices on the same local network: %APP_URL%
echo The backend is private to this computer; clients use the frontend proxy for data.
echo Close the API and UI terminal windows to stop the app.
exit /b 0

:findFreePort
set "%3="
for /f "tokens=*" %%p in ('powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "for ($p = [int]%1; $p -le [int]%2; $p++) { if (-not (Get-NetTCPConnection -LocalPort $p -State Listen -ErrorAction SilentlyContinue)) { Write-Output $p; break } }"') do set "%3=%%p"
exit /b 0

:fail
echo.
echo Startup failed. Review the message above.
pause
exit /b 1
