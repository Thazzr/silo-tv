#!/usr/bin/env pwsh
# Tests der Fehlerlogik von tools/verify.ps1: wann sagt das Gate "failed", und bleibt es rot.
#
# Ohne Pester, mit einem gefälschten npm (eine .cmd im Temp-Ordner), dessen Exit-Code pro Skriptname über
# FAKE_NPM_FAIL steuerbar ist ("lint,build"). Jeder Fall startet ein Gate als eigenen Prozess und prüft Exit-Code,
# Tabelle und die Liste der Skripte, die das gefälschte npm wirklich aufgerufen hat.
#
# Ausgabe: je Fall PASS/FAIL. Exit-Code 0 nur, wenn alle Fälle PASS sind.

$ErrorActionPreference = "Stop"

$verify = Join-Path $PSScriptRoot "verify.ps1"
$pwsh = (Get-Process -Id $PID).Path

$tempDir = Join-Path ([System.IO.Path]::GetTempPath()) "silo-lg-verify-tests-$PID"
New-Item -ItemType Directory -Path $tempDir -Force | Out-Null
$fakeNpm = Join-Path $tempDir "fake-npm.cmd"
$fakeLog = Join-Path $tempDir "calls.log"
# %2 ist der Skriptname in `npm run <name>`.
$fakeScript = @(
    "@echo off",
    '>>"%FAKE_NPM_LOG%" echo %2',
    "echo fake npm %*",
    'echo ,%FAKE_NPM_FAIL%, | findstr /C:",%2," >nul && exit /b 1',
    "exit /b 0"
)
Set-Content -LiteralPath $fakeNpm -Encoding ascii -Value $fakeScript

$allCalls = "typecheck,lint,test,build,check:bundle,test:e2e,package"

# Startet ein Gate. $Fail: Skriptnamen, bei denen das gefälschte npm scheitert. Die Rekursionsmarke ist immer
# gesetzt: ein Gate-Lauf der Tests darf den Schritt "verify script tests" nie wirklich starten.
function Invoke-Gate {
    param([string[]]$GateArgs = @(), [string]$Fail = "")
    Remove-Item -LiteralPath $fakeLog -Force -ErrorAction SilentlyContinue
    $env:FAKE_NPM_LOG = $fakeLog
    $env:FAKE_NPM_FAIL = $Fail
    $env:VERIFY_SCRIPT_TESTS_RUNNING = "1"
    $output = & $pwsh -NoProfile -File $verify -NpmCommand $fakeNpm @GateArgs 2>&1 | ForEach-Object { "$_" }
    $exit = $LASTEXITCODE
    $calls = if (Test-Path -LiteralPath $fakeLog) { @(Get-Content -LiteralPath $fakeLog | Where-Object { $_ }) } else { @() }
    [pscustomobject]@{ Exit = $exit; Output = @($output); Calls = $calls }
}

# Das Ergebnis eines Schritts aus der Tabelle am Ende: "ok", "failed (exit 1)", "skipped (build failed)".
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
    $run = Invoke-Gate -GateArgs @("-Only", "gibtsnicht")
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
