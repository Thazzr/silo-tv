#!/usr/bin/env pwsh
# Regeneriert CHANGELOG.md aus der Conventional-Commits-Historie mit git-cliff (über die ganze Historie).
#
# CHANGELOG.md wird NIE von Hand editiert - immer dieses Skript verwenden.
#
# Versionierung: SemVer 0.MINOR.PATCH (siehe CLAUDE.md -> "Versioning"). Ein Tag wird am Ende jeder
# abgeschlossenen Phase gesetzt (MINOR wenn die Phase >=1 feat-/Breaking-Commit enthält, sonst PATCH).
# cliff.toml gruppiert CHANGELOG.md automatisch nach vorhandenen Tags - sobald ein Tag existiert, fällt der bis
# dahin angesammelte [Unreleased]-Block in einen eigenen `## [x.y.z] - Datum`-Abschnitt.
#
# Übliche Nutzung (nach einem Commit, ohne Versions-Sprung):
#   pwsh tools/update-changelog.ps1
#   git commit -m "docs(changelog): update" CHANGELOG.md   # taucht selbst nicht im Changelog auf
#
# Atomar (Changelog-Eintrag im SELBEN Commit wie die Änderung):
#   git add -A
#   pwsh tools/update-changelog.ps1 -WithCommit "feat(scope): subject"
#   git add CHANGELOG.md
#   git commit -m "feat(scope): subject" -m "...Body mit Details (Ursache, Lösung, Verifikation)..."
#
# Phasenabschluss mit Versions-Tag (setzt den Tag auf HEAD, dann Regenerierung):
#   pwsh tools/update-changelog.ps1 -Tag v0.2.0 -TagMessage "Kurzbeschreibung der Phase"
#   git add CHANGELOG.md
#   git commit -m "docs(changelog): update"
#
# Voraussetzung: `npm ci` (git-cliff ist eine devDependency und läuft über npx, ohne Download).
param(
    [string]$WithCommit,
    [string]$Tag,
    [string]$TagMessage
)
$ErrorActionPreference = 'Stop'
if ($Tag -and -not $TagMessage) {
    throw "-TagMessage ist erforderlich, wenn -Tag gesetzt wird (annotierter Tag braucht eine Beschreibung)."
}
$repoRoot = Split-Path -Parent $PSScriptRoot
Push-Location $repoRoot
try {
    if ($Tag) {
        git tag -a $Tag -m $TagMessage
        if ($LASTEXITCODE -ne 0) { throw "git tag $Tag ist fehlgeschlagen (Exit-Code $LASTEXITCODE)." }
        Write-Host "Tag $Tag gesetzt auf HEAD."
    }

    $cliffArgs = @('-c', 'cliff.toml', '-o', 'CHANGELOG.md')
    if ($WithCommit) { $cliffArgs += @('--with-commit', $WithCommit) }

    # --no-install: nie ein Paket aus dem Netz holen, falls git-cliff in node_modules fehlt.
    & npx --no-install git-cliff @cliffArgs
    if ($LASTEXITCODE -ne 0) { throw "git-cliff ist fehlgeschlagen (Exit-Code $LASTEXITCODE)." }
    Write-Host "CHANGELOG.md regeneriert."
}
finally {
    Pop-Location
}
