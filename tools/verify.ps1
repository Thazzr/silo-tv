#!/usr/bin/env pwsh
# The full local gate: script tests, type check, lint, unit tests, build, bundle check, E2E, package probe.
#
#   pwsh -NoProfile -File tools/verify.ps1                  # all steps
#   pwsh -NoProfile -File tools/verify.ps1 -Only lint,build # only these steps, in gate order
#
# Exit code: 0 = everything ok (or skipped), 1 = at least one step failed,
# 2 = -Only names an unknown step (then nothing runs).
param(
    [string[]]$Only,
    # Replaceable so that tools/verify.Tests.ps1 can substitute a fake npm.
    [string]$NpmCommand = "npm",
    # Where the table is also written when CI is set (tools/ci-summary.mjs reads it). Relative paths are
    # relative to the repository root. Replaceable so that the tests do not touch the real reports.
    [string]$ReportDir = "reports"
)

$ErrorActionPreference = "Stop"

# One thread, one step after another. A failed step stops nothing, so a run shows all failures;
# only the steps that need the build result are skipped when "build" fails.
#
# $ErrorActionPreference = "Stop" does NOT apply to native programs (npm, pwsh): they report errors through the
# exit code, and PowerShell does not turn that into an error. Without the explicit $LASTEXITCODE check in
# Invoke-Step, every failure would have been swallowed. Do not remove that check.
#
# The decision logic lives in functions; when the file is dot-sourced, it defines only these
# (see below). tools/verify.Tests.ps1 tests the gate as a process and is the first step of the gate.

# `pwsh -File ... -Only lint,build` hands "lint,build" over as ONE string; no step name has a comma.
if ($Only) {
    $Only = @($Only | ForEach-Object { $_ -split "," } | ForEach-Object { $_.Trim() } | Where-Object { $_ })
}

$DependsOnBuild = @("bundle check", "e2e", "package")

function Format-Duration {
    param([TimeSpan]$Span)
    '{0}:{1:00}' -f [int][math]::Floor($Span.TotalMinutes), $Span.Seconds
}

# The script tests start gates in their own processes. If a gate itself runs under the script tests, this step
# would start them again, endlessly. The tests therefore set VERIFY_SCRIPT_TESTS_RUNNING, and the step
# then reports itself as "skipped" (Get-SkipReason).
function Invoke-VerifyScriptTests {
    & (Get-Process -Id $PID).Path -NoProfile -File "tools/verify.Tests.ps1"
}

function Get-Steps {
    @(
        # First, so the gate checks its own error handling before it relies on it.
        @{ Name = "verify script tests"; Command = { Invoke-VerifyScriptTests } },
        @{ Name = "typecheck"; Command = { & $NpmCommand run typecheck } },
        @{ Name = "lint"; Command = { & $NpmCommand run lint } },
        @{ Name = "unit tests"; Command = { & $NpmCommand run test } },
        @{ Name = "build"; Command = { & $NpmCommand run build } },
        @{ Name = "bundle check"; Command = { & $NpmCommand run check:bundle } },
        @{ Name = "e2e"; Command = { & $NpmCommand run test:e2e } },
        @{ Name = "package"; Command = { & $NpmCommand run package } }
    )
}

function Get-StepNames {
    foreach ($step in (Get-Steps)) {
        $step.Name
    }
}

# Names from -Only that no step is called. Such a name must not lead to a run that silently does less.
function Get-UnknownStepNames {
    param([string[]]$Requested)
    $known = @(Get-StepNames)
    @($Requested | Where-Object { $_ -notin $known })
}

# Why a step does not run, or "" if it runs. $Results are the results of the steps so far.
function Get-SkipReason {
    param(
        [string]$Name,
        [object[]]$Results
    )
    if ($Name -eq "verify script tests" -and $env:VERIFY_SCRIPT_TESTS_RUNNING) {
        return "already running (recursion guard)"
    }
    if ($Name -in $DependsOnBuild) {
        $build = @($Results | Where-Object { $_.Step -eq "build" })
        if ($build.Count -gt 0 -and $build[0].Result -eq "failed") {
            return "build failed"
        }
    }
    ""
}

# Every result other than "ok" and "skipped" is a failure, so that even a new or misspelled result
# turns the gate red.
function Get-FailedResults {
    param([object[]]$Results)
    @($Results | Where-Object { $_.Result -notin @("ok", "skipped") })
}

function Get-GateExitCode {
    param([object[]]$Results)
    if (@(Get-FailedResults $Results).Count -gt 0) { 1 } else { 0 }
}

function Invoke-Step {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Name,
        [Parameter(Mandatory = $true)]
        [scriptblock]$Command
    )

    Write-Host ""
    Write-Host "==> $Name" -ForegroundColor Cyan
    $global:LASTEXITCODE = 0
    $watch = [System.Diagnostics.Stopwatch]::StartNew()
    $exitCode = 0
    try {
        # Out-Host, not the pipeline: whatever a native program prints would otherwise be returned from this
        # function together with the result.
        & $Command | Out-Host
        $exitCode = $LASTEXITCODE
    }
    catch {
        Write-Host "Step '$Name' threw: $($_.Exception.Message)" -ForegroundColor Red
        $exitCode = 1
    }
    $watch.Stop()

    $duration = Format-Duration $watch.Elapsed
    $ok = $exitCode -eq 0
    if ($ok) {
        Write-Host "==> $Name ($duration)" -ForegroundColor Cyan
    }
    else {
        Write-Host "==> $Name ($duration) FAILED with exit code $exitCode" -ForegroundColor Red
    }

    [pscustomobject]@{
        Step     = $Name
        Duration = $duration
        Result   = if ($ok) { "ok" } else { "failed" }
        Reason   = if ($ok) { "" } else { "exit $exitCode" }
    }
}

# The table as lines: header, one line per step, total. Shared by the console output and the CI report file.
function Get-SummaryLines {
    param(
        [object[]]$Results,
        [TimeSpan]$Total
    )

    $nameWidth = [math]::Max("Step".Length, [int]($Results | ForEach-Object { $_.Step.Length } | Measure-Object -Maximum).Maximum)
    $lines = @([pscustomobject]@{ Text = ("{0,-$nameWidth} {1,6}  {2}" -f "Step", "Time", "Result"); Failed = $false })
    foreach ($result in $Results) {
        $text = $result.Result
        if ($result.Reason) { $text += " ($($result.Reason))" }
        $lines += [pscustomobject]@{
            Text   = ("{0,-$nameWidth} {1,6}  {2}" -f $result.Step, $result.Duration, $text)
            Failed = $result.Result -eq "failed"
        }
    }
    $lines += [pscustomobject]@{ Text = ("Total: {0}" -f (Format-Duration $Total)); Failed = $false }
    $lines
}

function Write-Summary {
    param(
        [object[]]$Results,
        [TimeSpan]$Total
    )

    Write-Host ""
    Write-Host "==> summary" -ForegroundColor Cyan
    foreach ($line in (Get-SummaryLines -Results $Results -Total $Total)) {
        if ($line.Failed) { Write-Host $line.Text -ForegroundColor Red } else { Write-Host $line.Text }
    }
}

# Only on CI: the same table as a plain file for tools/ci-summary.mjs. LF line endings on every platform.
function Write-SummaryFile {
    param(
        [object[]]$Results,
        [TimeSpan]$Total,
        [string]$Directory
    )

    New-Item -ItemType Directory -Path $Directory -Force | Out-Null
    $lines = @("==> summary") + @(Get-SummaryLines -Results $Results -Total $Total | ForEach-Object { $_.Text })
    [System.IO.File]::WriteAllText((Join-Path $Directory "gate.txt"), (($lines -join "`n") + "`n"))
}

# When dot-sourced (`. tools/verify.ps1`), the script only defines its functions and is done: the gate runs only
# when the script is invoked.
if ($MyInvocation.InvocationName -eq ".") {
    return
}

# Before any step: an unknown name must not lead to a run that silently does less than requested.
if ($Only) {
    $unknownSteps = @(Get-UnknownStepNames -Requested $Only)
    if ($unknownSteps.Count -gt 0) {
        $unknownText = ($unknownSteps | ForEach-Object { "'$_'" }) -join ", "
        $validText = (Get-StepNames | ForEach-Object { "'$_'" }) -join ", "
        Write-Host "Unknown step name(s) for -Only: $unknownText. Valid names: $validText." -ForegroundColor Red
        exit 2
    }
}

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
Push-Location $repoRoot
try {
    $watch = [System.Diagnostics.Stopwatch]::StartNew()
    $results = @()
    foreach ($step in (Get-Steps)) {
        if ($Only -and ($step.Name -notin $Only)) {
            continue
        }
        $reason = Get-SkipReason -Name $step.Name -Results $results
        if ($reason) {
            Write-Host ""
            Write-Host "==> $($step.Name) skipped: $reason" -ForegroundColor Yellow
            $results += [pscustomobject]@{ Step = $step.Name; Duration = "-"; Result = "skipped"; Reason = $reason }
            continue
        }
        $results += Invoke-Step -Name $step.Name -Command $step.Command
    }
    $watch.Stop()
    Write-Summary -Results $results -Total $watch.Elapsed
    if ($env:CI) {
        $reportPath = if ([System.IO.Path]::IsPathRooted($ReportDir)) { $ReportDir } else { Join-Path $repoRoot $ReportDir }
        Write-SummaryFile -Results $results -Total $watch.Elapsed -Directory $reportPath
    }

    foreach ($failure in (Get-FailedResults $results)) {
        Write-Host ("Verification failed at '{0}': {1}." -f $failure.Step, $failure.Reason) -ForegroundColor Red
    }
    exit (Get-GateExitCode $results)
}
finally {
    Pop-Location
}
