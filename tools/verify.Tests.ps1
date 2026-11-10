#!/usr/bin/env pwsh
# Tests of the error logic in tools/verify.ps1: when does the gate say "failed", and does it stay red.
#
# Without Pester, using a fake npm (a .cmd on Windows, a shell script elsewhere, in the temp folder) whose exit code per script name is controlled
# through FAKE_NPM_FAIL ("lint,build"). Each case starts a gate as its own process and checks the exit code,
# the table, and the list of scripts the fake npm was actually called with.
#
# Output: PASS/FAIL per case. Exit code 0 only if all cases PASS.

$ErrorActionPreference = "Stop"

$verify = Join-Path $PSScriptRoot "verify.ps1"
$pwsh = (Get-Process -Id $PID).Path

$tempDir = Join-Path ([System.IO.Path]::GetTempPath()) "silo-tv-verify-tests-$PID"
New-Item -ItemType Directory -Path $tempDir -Force | Out-Null
$fakeLog = Join-Path $tempDir "calls.log"
$reportDir = Join-Path $tempDir "reports"
# The script name is the second argument in `npm run <name>`.
if ($IsWindows) {
    $fakeNpm = Join-Path $tempDir "fake-npm.cmd"
    $fakeScript = @(
        "@echo off",
        '>>"%FAKE_NPM_LOG%" echo %2',
        "echo fake npm %*",
        'echo ,%FAKE_NPM_FAIL%, | findstr /C:",%2," >nul && exit /b 1',
        "exit /b 0"
    )
    Set-Content -LiteralPath $fakeNpm -Encoding ascii -Value $fakeScript
}
else {
    $fakeNpm = Join-Path $tempDir "fake-npm.sh"
    $fakeScript = @(
        "#!/bin/sh",
        'echo "$2" >> "$FAKE_NPM_LOG"',
        'echo "fake npm $*"',
        'case ",$FAKE_NPM_FAIL," in *",$2,"*) exit 1;; esac',
        "exit 0"
    )
    # LF line endings, or the shebang line breaks.
    [System.IO.File]::WriteAllText($fakeNpm, (($fakeScript -join "`n") + "`n"))
    chmod +x $fakeNpm
}

$allCalls = "typecheck,lint,test,build,check:bundle,test:e2e,package"

# Starts a gate. $Fail: script names for which the fake npm fails. The recursion marker is always
# set: a gate run by the tests must never actually start the "verify script tests" step.
function Invoke-Gate {
    param([string[]]$GateArgs = @(), [string]$Fail = "")
    Remove-Item -LiteralPath $fakeLog -Force -ErrorAction SilentlyContinue
    $env:FAKE_NPM_LOG = $fakeLog
    $env:FAKE_NPM_FAIL = $Fail
    $env:VERIFY_SCRIPT_TESTS_RUNNING = "1"
    # -ReportDir: with CI set, a gate run by the tests must not overwrite the real reports/gate.txt.
    $output = & $pwsh -NoProfile -File $verify -NpmCommand $fakeNpm -ReportDir $reportDir @GateArgs 2>&1 | ForEach-Object { "$_" }
    $exit = $LASTEXITCODE
    $calls = if (Test-Path -LiteralPath $fakeLog) { @(Get-Content -LiteralPath $fakeLog | Where-Object { $_ }) } else { @() }
    [pscustomobject]@{ Exit = $exit; Output = @($output); Calls = $calls }
}

# The result of a step from the table at the end: "ok", "failed (exit 1)", "skipped (build failed)".
function Get-TableResult {
    param($Run, [string]$Step)
    $summaryAt = [array]::IndexOf($Run.Output, "==> summary")
    if ($summaryAt -lt 0) { return $null }
    foreach ($line in $Run.Output[$summaryAt..($Run.Output.Count - 1)]) {
        if ($line -match "^$([regex]::Escape($Step))\s+(\S+)\s+(.+?)\s*$") { return $Matches[2] }
    }
    $null
}

$cases = [ordered]@{}

$cases["all steps ok -> exit 0, table shows ok"] = {
    $run = Invoke-Gate
    $problems = @()
    if ($run.Exit -ne 0) { $problems += "exit $($run.Exit), expected 0" }
    foreach ($step in "typecheck", "lint", "unit tests", "build", "bundle check", "e2e", "package") {
        $r = Get-TableResult $run $step
        if ($r -ne "ok") { $problems += "'$step' is '$r', expected ok" }
    }
    # The marker is set, so the script tests step must not have run.
    $r = Get-TableResult $run "verify script tests"
    if ($r -notlike "skipped*") { $problems += "'verify script tests' is '$r', expected skipped" }
    if (($run.Calls -join ",") -ne $allCalls) { $problems += "calls were: $($run.Calls -join ',')" }
    $problems
}

$cases["lint fails -> exit 1, the other steps still run"] = {
    $run = Invoke-Gate -Fail "lint"
    $problems = @()
    if ($run.Exit -ne 1) { $problems += "exit $($run.Exit), expected 1" }
    $r = Get-TableResult $run "lint"
    if ($r -notlike "failed*") { $problems += "'lint' is '$r', expected failed" }
    foreach ($step in "typecheck", "unit tests", "build", "bundle check", "e2e", "package") {
        $r = Get-TableResult $run $step
        if ($r -ne "ok") { $problems += "'$step' is '$r', expected ok" }
    }
    if (($run.Calls -join ",") -ne $allCalls) { $problems += "calls were: $($run.Calls -join ',')" }
    $problems
}

$cases["build fails -> exit 1, bundle check/e2e/package skipped with reason"] = {
    $run = Invoke-Gate -Fail "build"
    $problems = @()
    if ($run.Exit -ne 1) { $problems += "exit $($run.Exit), expected 1" }
    $r = Get-TableResult $run "build"
    if ($r -notlike "failed*") { $problems += "'build' is '$r', expected failed" }
    foreach ($step in "bundle check", "e2e", "package") {
        $r = Get-TableResult $run $step
        if ($r -ne "skipped (build failed)") { $problems += "'$step' is '$r', expected 'skipped (build failed)'" }
    }
    if (($run.Calls -join ",") -ne "typecheck,lint,test,build") { $problems += "calls were: $($run.Calls -join ',')" }
    $problems
}

$cases["-Only lint runs only lint"] = {
    $run = Invoke-Gate -GateArgs @("-Only", "lint")
    $problems = @()
    if ($run.Exit -ne 0) { $problems += "exit $($run.Exit), expected 0" }
    if (($run.Calls -join ",") -ne "lint") { $problems += "calls were: $($run.Calls -join ',')" }
    if ((Get-TableResult $run "lint") -ne "ok") { $problems += "'lint' is not ok in the table" }
    if ($null -ne (Get-TableResult $run "build")) { $problems += "'build' is in the table" }
    $problems
}

$cases["-Only with an unknown name -> exit 2, nothing runs"] = {
    $run = Invoke-Gate -GateArgs @("-Only", "doesnotexist")
    $problems = @()
    if ($run.Exit -ne 2) { $problems += "exit $($run.Exit), expected 2" }
    if ($run.Calls.Count -ne 0) { $problems += "calls were: $($run.Calls -join ',')" }
    if (-not ($run.Output -join "`n").Contains("Valid names")) { $problems += "no list of valid names in the output" }
    $problems
}

$cases["recursion guard -> 'verify script tests' is skipped, not run"] = {
    $run = Invoke-Gate -GateArgs @("-Only", "verify script tests")
    $problems = @()
    if ($run.Exit -ne 0) { $problems += "exit $($run.Exit), expected 0" }
    $r = Get-TableResult $run "verify script tests"
    if ($r -notlike "skipped*") { $problems += "'verify script tests' is '$r', expected skipped" }
    if ($run.Output -contains "==> verify script tests") { $problems += "the step header was printed, so it started" }
    $problems
}

$cases["CI set -> the table is also written to <ReportDir>/gate.txt, with the failures in it"] = {
    $before = $env:CI
    try {
        $env:CI = "true"
        $run = Invoke-Gate -Fail "lint"
    }
    finally {
        $env:CI = $before
    }
    $problems = @()
    $file = Join-Path $reportDir "gate.txt"
    if (-not (Test-Path -LiteralPath $file)) { return @("$file was not written") }
    $text = [System.IO.File]::ReadAllText($file)
    $lines = $text -split "`n"
    if ($lines[0] -ne "==> summary") { $problems += "first line is '$($lines[0])', expected '==> summary'" }
    if ($text.Contains("`r")) { $problems += "the file contains CR characters" }
    if (-not ($lines | Where-Object { $_ -match "^lint\s+\S+\s+failed \(exit 1\)$" })) { $problems += "no failed lint line in the file" }
    if (-not ($lines | Where-Object { $_ -match "^Total: " })) { $problems += "no Total line in the file" }
    # The file has the same step lines as the console table.
    $summaryAt = [array]::IndexOf($run.Output, "==> summary")
    $console = @($run.Output[($summaryAt + 1)..($run.Output.Count - 1)] | Where-Object { $_ -notlike "Verification failed*" })
    if (($console -join "`n") -ne (($lines | Select-Object -Skip 1 | Where-Object { $_ }) -join "`n")) { $problems += "file and console table differ" }
    $problems
}

$cases["CI not set -> no report file is written"] = {
    Remove-Item -LiteralPath $reportDir -Recurse -Force -ErrorAction SilentlyContinue
    $before = $env:CI
    try {
        $env:CI = $null
        $null = Invoke-Gate -GateArgs @("-Only", "lint")
    }
    finally {
        $env:CI = $before
    }
    if (Test-Path -LiteralPath (Join-Path $reportDir "gate.txt")) { return @("gate.txt was written without CI") }
}

$failed = 0
try {
    foreach ($name in $cases.Keys) {
        $problems = @()
        try {
            $problems = @(& $cases[$name] | Where-Object { $_ })
        }
        catch {
            $problems = @("threw: $($_.Exception.Message)")
        }
        if ($problems.Count -eq 0) {
            Write-Host "PASS  $name" -ForegroundColor Green
        }
        else {
            $failed++
            Write-Host "FAIL  $name" -ForegroundColor Red
            $problems | ForEach-Object { Write-Host "      $_" -ForegroundColor Red }
        }
    }
}
finally {
    $env:FAKE_NPM_LOG = $null
    $env:FAKE_NPM_FAIL = $null
    $env:VERIFY_SCRIPT_TESTS_RUNNING = $null
    Remove-Item -LiteralPath $tempDir -Recurse -Force -ErrorAction SilentlyContinue
}

Write-Host ""
if ($failed -eq 0) {
    Write-Host "All $($cases.Count) cases passed."
    exit 0
}
Write-Host "$failed of $($cases.Count) cases failed."
exit 1
