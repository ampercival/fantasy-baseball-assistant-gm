param(
    [string]$PythonPath = (Join-Path $PSScriptRoot ".venv\Scripts\python.exe"),
    [string]$RefreshScript = (Join-Path $PSScriptRoot "backend\refresh_supabase.py"),
    [string]$LogPath = (Join-Path $PSScriptRoot "logs\scheduled-refresh.log")
)

$ErrorActionPreference = "Stop"
$utf8 = New-Object System.Text.UTF8Encoding($false)
$logDirectory = Split-Path -Parent $LogPath
$stdoutPath = Join-Path $logDirectory ("scheduled-refresh-{0}.stdout.tmp" -f [guid]::NewGuid())
$stderrPath = Join-Path $logDirectory ("scheduled-refresh-{0}.stderr.tmp" -f [guid]::NewGuid())
$refreshExit = 1

function Add-RefreshLog {
    param([string]$Text)
    [System.IO.File]::AppendAllText($LogPath, $Text, $utf8)
}

try {
    New-Item -ItemType Directory -Path $logDirectory -Force | Out-Null
    Add-RefreshLog "`r`n============================================================`r`n"
    Add-RefreshLog "[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] Starting scheduled refresh (sources + connected leagues + lineup cache)`r`n"

    if (-not (Test-Path -LiteralPath $PythonPath)) {
        throw "Python virtual environment was not found: $PythonPath. Run start-app.cmd once first."
    }
    if (-not (Test-Path -LiteralPath (Join-Path $PSScriptRoot ".env"))) {
        throw "The project .env file is missing; DATABASE_URL is required for Supabase."
    }
    if (-not (Test-Path -LiteralPath $RefreshScript)) {
        throw "Refresh script was not found: $RefreshScript"
    }

    & $PythonPath $RefreshScript --skip-platform 1> $stdoutPath 2> $stderrPath
    $refreshExit = $LASTEXITCODE

    foreach ($outputPath in @($stdoutPath, $stderrPath)) {
        if (Test-Path -LiteralPath $outputPath) {
            $output = [System.IO.File]::ReadAllText($outputPath)
            if ($output) {
                Add-RefreshLog $output
                if (-not $output.EndsWith("`n")) {
                    Add-RefreshLog "`r`n"
                }
            }
        }
    }
}
catch {
    Add-RefreshLog "ERROR: $($_.Exception.Message)`r`n"
    $refreshExit = 1
}
finally {
    Add-RefreshLog "[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] Exit code $refreshExit`r`n"
    foreach ($temporaryPath in @($stdoutPath, $stderrPath)) {
        if (Test-Path -LiteralPath $temporaryPath) {
            Remove-Item -LiteralPath $temporaryPath -Force
        }
    }
}

exit $refreshExit
