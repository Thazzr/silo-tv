#!/usr/bin/env pwsh
# Das vollständige lokale Gate: Skripttests, Typprüfung, Lint, Unit-Tests, Build, Bundle-Prüfung, E2E, Paket-Probe.
#
#   pwsh -NoProfile -File tools/verify.ps1                  # alle Schritte
#   pwsh -NoProfile -File tools/verify.ps1 -Only lint,build # nur diese Schritte, in Gate-Reihenfolge
#
# Exit-Code: 0 = alles ok (oder skipped), 1 = mindestens ein Schritt ist fehlgeschlagen,
# 2 = -Only nennt einen unbekannten Schritt (dann läuft nichts).
param(
    [string[]]$Only,
    # Austauschbar, damit tools/verify.Tests.ps1 ein gefälschtes npm einsetzen kann.
    [string]$NpmCommand = "npm"
)

$ErrorActionPreference = "Stop"

# Ein Strang, nacheinander. Ein fehlgeschlagener Schritt stoppt nichts, damit ein Lauf alle Fehler zeigt;
# nur die Schritte, die das Build-Ergebnis brauchen, werden übersprungen, wenn "build" fehlschlägt.
#
# $ErrorActionPreference = "Stop" gilt NICHT für native Programme (npm, pwsh): sie melden Fehler über den
# Exit-Code, und PowerShell macht daraus keinen Fehler. Ohne die ausdrückliche $LASTEXITCODE-Prüfung in
# Invoke-Step wäre jeder Fehlschlag verschluckt worden. Diese Prüfung nicht entfernen.
#
# Die Entscheidungslogik steckt in Funktionen; wird die Datei dot-sourced, definiert sie nur diese
# (siehe unten). tools/verify.Tests.ps1 testet das Gate als Prozess und ist der erste Schritt des Gates.

# `pwsh -File ... -Only lint,build` hands "lint,build" over as ONE string; no step name has a comma.
if ($Only) {
    $Only = @($Only | ForEach-Object { $_ -split "," } | ForEach-Object { $_.Trim() } | Where-Object { $_ })
}

$DependsOnBuild = @("bundle check", "e2e", "package")

function Format-Duration {
    param([TimeSpan]$Span)
    '{0}:{1:00}' -f [int][math]::Floor($Span.TotalMinutes), $Span.Seconds
}

# Die Skripttests starten Gates in eigenen Prozessen. Läuft ein Gate selbst unter den Skripttests, würde dieser
# Schritt sie erneut starten, ohne Ende. Die Tests setzen deshalb VERIFY_SCRIPT_TESTS_RUNNING, und der Schritt
# meldet sich dann als "skipped" (Get-SkipReason).
function Invoke-VerifyScriptTests {
    & (Get-Process -Id $PID).Path -NoProfile -File "tools/verify.Tests.ps1"
}

function Get-Steps {
    @(
        # Zuerst, damit das Gate seine eigene Fehlerbehandlung prüft, bevor es sich auf sie verlässt.
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

# Namen aus -Only, die kein Schritt heißt. Ein solcher Name darf nicht zu einem Lauf führen, der still weniger tut.
function Get-UnknownStepNames {
    param([string[]]$Requested)
    $known = @(Get-StepNames)
    @($Requested | Where-Object { $_ -notin $known })
}

# Warum ein Schritt nicht läuft, oder "" wenn er läuft. $Results sind die Ergebnisse der bisherigen Schritte.
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

# Jedes Ergebnis außer "ok" und "skipped" ist ein Fehler, damit auch ein neues oder falsch geschriebenes Ergebnis
# das Gate rot macht.
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
        # Out-Host, nicht die Pipeline: Was ein natives Programm druckt, würde sonst zusammen mit dem Ergebnis
        # aus dieser Funktion zurückgegeben.
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

function Write-Summary {
    param(
        [object[]]$Results,
        [TimeSpan]$Total
    )

    Write-Host ""
    Write-Host "==> summary" -ForegroundColor Cyan
    $nameWidth = [math]::Max("Step".Length, [int]($Results | ForEach-Object { $_.Step.Length } | Measure-Object -Maximum).Maximum)
    Write-Host ("{0,-$nameWidth} {1,6}  {2}" -f "Step", "Time", "Result")
    foreach ($result in $Results) {
        $text = $result.Result
        if ($result.Reason) { $text += " ($($result.Reason))" }
        $line = "{0,-$nameWidth} {1,6}  {2}" -f $result.Step, $result.Duration, $text
        if ($result.Result -eq "failed") { Write-Host $line -ForegroundColor Red } else { Write-Host $line }
    }
    Write-Host ("Total: {0}" -f (Format-Duration $Total))
}

# Dot-sourced (`. tools/verify.ps1`) definiert das Skript nur seine Funktionen und ist fertig: das Gate läuft nur,
# wenn es aufgerufen wird.
if ($MyInvocation.InvocationName -eq ".") {
    return
}

# Vor jedem Schritt: ein unbekannter Name darf nicht zu einem Lauf führen, der still weniger tut als verlangt.
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

    foreach ($failure in (Get-FailedResults $results)) {
        Write-Host ("Verification failed at '{0}': {1}." -f $failure.Step, $failure.Reason) -ForegroundColor Red
    }
    exit (Get-GateExitCode $results)
}
finally {
    Pop-Location
}
