# Tools

Developer tools for local verification and maintenance (PowerShell 7, `pwsh`).

| Script | Purpose |
|---|---|
| `verify.ps1` | The full gate, one strand in order: script tests, `typecheck`, `lint`, `unit tests`, `build`, `bundle check`, `e2e`, `package`. A failing step stops nothing; only a failed `build` skips `bundle check`, `e2e` and `package`. It ends with a table of each step's time and result. `-Only "<step>",…` runs single steps (an unknown name exits with code 2). Also available as `npm run verify`. |
| `verify.Tests.ps1` | Tests the pass/fail logic of `verify.ps1` (without Pester, with a fake npm) and runs as the gate's first step. The environment marker `VERIFY_SCRIPT_TESTS_RUNNING` keeps the step from starting itself again. |
| `update-changelog.ps1` | Regenerates `CHANGELOG.md` with [git-cliff](https://git-cliff.org) from the Conventional Commits history. `-WithCommit` includes a commit subject that is not committed yet; `-Tag` and `-TagMessage` set a version tag first. `CHANGELOG.md` is never edited by hand. |
