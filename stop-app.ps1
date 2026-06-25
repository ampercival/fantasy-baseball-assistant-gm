$ErrorActionPreference = "SilentlyContinue"

$Root = (Resolve-Path $PSScriptRoot).Path
$CurrentPid = $PID
$Ports = @((8000..8020) + (5173..5190)) | ForEach-Object { $_ }
$Patterns = @(
    "uvicorn\s+app\.main:app.*--app-dir\s+backend",
    "npm\s+run\s+dev\s+--\s+--host\s+\S+\s+--port\s+51\d{2}",
    "vite(?:\.js)?\s+--host\s+\S+\s+--port\s+51\d{2}"
)

function Stop-ProcessId {
    param([int]$ProcessId)

    if ($ProcessId -le 0 -or $ProcessId -eq $CurrentPid) {
        return
    }

    Stop-Process -Id $ProcessId -Force -ErrorAction SilentlyContinue
    if (Get-Process -Id $ProcessId -ErrorAction SilentlyContinue) {
        & taskkill.exe /F /PID $ProcessId 2>$null | Out-Null
    }
}

Write-Host "Stopping existing Assistant GM backend/frontend processes..."

$processes = Get-CimInstance Win32_Process | Where-Object {
    $CommandLine = $_.CommandLine
    $_.ProcessId -ne $CurrentPid -and
    $CommandLine -and
    $CommandLine.Contains($Root) -and
    ($Patterns | Where-Object { $CommandLine -match $_ })
}

foreach ($process in $processes) {
    Stop-ProcessId -ProcessId ([int]$process.ProcessId)
}

foreach ($port in $Ports) {
    $connections = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
    foreach ($connection in $connections) {
        Stop-ProcessId -ProcessId ([int]$connection.OwningProcess)
    }
}

Start-Sleep -Milliseconds 750

$remaining = foreach ($port in $Ports) {
    Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
}

if ($remaining) {
    Write-Host "Some app ports are still listening:"
    foreach ($connection in $remaining) {
        Write-Host "  Port $($connection.LocalPort), PID $($connection.OwningProcess)"
    }
    Write-Host "If Windows says that PID does not exist, close the old Assistant GM terminal window manually or reboot to clear the stale listener."
    exit 1
}

Write-Host "No Assistant GM servers are listening on Assistant GM backend/frontend ports."
