param(
    [switch]$InteractiveOnly
)

$ErrorActionPreference = "Stop"

$taskName = "FantasyBaseball Refresh"
$refreshScript = Join-Path $PSScriptRoot "scheduled-refresh.ps1"
$powerShell = Join-Path $env:SystemRoot "System32\WindowsPowerShell\v1.0\powershell.exe"
$currentIdentity = [System.Security.Principal.WindowsIdentity]::GetCurrent()
$currentPrincipal = New-Object System.Security.Principal.WindowsPrincipal($currentIdentity)
$isAdministrator = $currentPrincipal.IsInRole([System.Security.Principal.WindowsBuiltInRole]::Administrator)

if (-not $isAdministrator) {
    $elevatedArguments = @(
        "-NoProfile"
        "-ExecutionPolicy"
        "Bypass"
        "-File"
        "`"$PSCommandPath`""
    )
    if ($InteractiveOnly) {
        $elevatedArguments += "-InteractiveOnly"
    }
    Write-Host "Administrator approval is required to replace the existing scheduled task."
    $elevated = Start-Process `
        -FilePath $powerShell `
        -ArgumentList $elevatedArguments `
        -Verb RunAs `
        -WindowStyle Hidden `
        -Wait `
        -PassThru
    exit $elevated.ExitCode
}

if (-not (Test-Path -LiteralPath $refreshScript)) {
    throw "Refresh script was not found: $refreshScript"
}

$action = New-ScheduledTaskAction `
    -Execute $powerShell `
    -Argument "-NoProfile -NonInteractive -ExecutionPolicy Bypass -File `"$refreshScript`"" `
    -WorkingDirectory $PSScriptRoot
$triggers = @(
    New-ScheduledTaskTrigger -Daily -At "5:00 AM"
    New-ScheduledTaskTrigger -Daily -At "12:00 PM"
)
$userId = $currentIdentity.Name
$logonType = if ($InteractiveOnly) { "Interactive" } else { "S4U" }
$principal = New-ScheduledTaskPrincipal `
    -UserId $userId `
    -LogonType $logonType `
    -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet `
    -ExecutionTimeLimit (New-TimeSpan -Hours 1) `
    -StartWhenAvailable `
    -WakeToRun `
    -MultipleInstances IgnoreNew `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries

Register-ScheduledTask `
    -TaskName $taskName `
    -Action $action `
    -Trigger $triggers `
    -Principal $principal `
    -Settings $settings `
    -Description "Refresh ranking sources, connected leagues, and lineup caches at 5 AM and noon. Exit 2 means a partial refresh." `
    -Force | Out-Null

$task = Get-ScheduledTask -TaskName $taskName
$info = Get-ScheduledTaskInfo -TaskName $taskName
[pscustomobject]@{
    TaskName = $task.TaskName
    State = $task.State
    LogonType = $task.Principal.LogonType
    NextRunTime = $info.NextRunTime
    Execute = $task.Actions.Execute
    Arguments = $task.Actions.Arguments
    Triggers = ($task.Triggers.StartBoundary -join ", ")
}
