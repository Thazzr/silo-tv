#!/usr/bin/env pwsh
# Regenerates CHANGELOG.md from the Conventional Commits history with git-cliff (over the whole history).
#
# CHANGELOG.md is NEVER edited by hand - always use this script.
#
# Versioning: SemVer 0.MINOR.PATCH (see CLAUDE.md -> "Versioning"). A tag is set at the end of every
# completed phase (MINOR if the phase contains >=1 feat/breaking commit, otherwise PATCH).
# cliff.toml groups CHANGELOG.md by existing tags automatically - as soon as a tag exists, the [Unreleased]
# block accumulated up to then falls into its own `## [x.y.z] - date` section.
#
# Usual use (after a commit, without a version bump):
#   pwsh tools/update-changelog.ps1
#   git commit -m "docs(changelog): update" CHANGELOG.md   # does not itself show up in the changelog
#
# Atomic (changelog entry in the SAME commit as the change):
#   git add -A
#   pwsh tools/update-changelog.ps1 -WithCommit "feat(scope): subject"
#   git add CHANGELOG.md
#   git commit -m "feat(scope): subject" -m "...body with details (cause, solution, verification)..."
#
# Phase completion with a version tag (sets the tag on HEAD, then regenerates):
#   pwsh tools/update-changelog.ps1 -Tag v0.2.0 -TagMessage "Short description of the phase"
#   git add CHANGELOG.md
#   git commit -m "docs(changelog): update"
#
# Prerequisite: `npm ci` (git-cliff is a devDependency and runs through npx, without a download).
param(
    [string]$WithCommit,
    [string]$Tag,
    [string]$TagMessage
)
$ErrorActionPreference = 'Stop'
if ($Tag -and -not $TagMessage) {
    throw "-TagMessage is required when -Tag is set (an annotated tag needs a description)."
}
$repoRoot = Split-Path -Parent $PSScriptRoot
Push-Location $repoRoot
try {
    if ($Tag) {
        git tag -a $Tag -m $TagMessage
        if ($LASTEXITCODE -ne 0) { throw "git tag $Tag failed (exit code $LASTEXITCODE)." }
        Write-Host "Tag $Tag set on HEAD."
    }

    $cliffArgs = @('-c', 'cliff.toml', '-o', 'CHANGELOG.md')
    if ($WithCommit) { $cliffArgs += @('--with-commit', $WithCommit) }

    # --no-install: never fetch a package from the network if git-cliff is missing from node_modules.
    & npx --no-install git-cliff @cliffArgs
    if ($LASTEXITCODE -ne 0) { throw "git-cliff failed (exit code $LASTEXITCODE)." }
    Write-Host "CHANGELOG.md regenerated."
}
finally {
    Pop-Location
}
