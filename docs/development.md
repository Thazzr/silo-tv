# Development and deployment

How to build silo-tv, run it in the browser, install it on an LG TV and check it. The house rules for changes are in [`CLAUDE.md`](../CLAUDE.md); the feature plan is in [`roadmap.md`](roadmap.md).

- [Requirements and setup](#requirements-and-setup)
- [Run it in the browser](#run-it-in-the-browser)
- [Install it on a TV](#install-it-on-a-tv)
- [Diagnostics on the TV](#diagnostics-on-the-tv)
- [Commands](#commands)
- [Tests and quality checks](#tests-and-quality-checks)
- [The Silo API client](#the-silo-api-client)
- [Project layout](#project-layout)
- [Commits, changelog and versions](#commits-changelog-and-versions)

## Requirements and setup

- Node.js 24 and npm
- PowerShell 7 (`pwsh`) for the gate and the changelog tooling
- For the TV: an LG TV from 2021 or later (webOS 6 and newer) in Developer Mode

```bash
npm ci
```

```bash
npx playwright install chromium --only-shell
```

## Run it in the browser

```bash
npm run dev
```

The Vite dev server opens the app at `http://localhost:5173`. Arrow keys, Enter and Escape or Backspace stand in for the remote's arrows, OK and Back.

**Against a real Silo server:** Silo sends no CORS headers, so the browser cannot call it directly. Start the dev server with `SILO_SERVER` set, for example `SILO_SERVER=https://silo.example.com npm run dev`. It then forwards `/api` to that server. In the app, enter the dev server itself (`http://localhost:5173`) as the server address, not the real one. The packaged app on the TV needs none of this: webOS does not enforce CORS for an installed app.

Launch parameters work as query strings in the browser:

| Parameter | Effect |
|---|---|
| `?server=<address>` | pre-fills the server address |
| `?probe` | opens the diagnostics probe instead of the app |
| `?transport=direct` or `?transport=service` | how the app talks to Silo (default `direct`; `service` uses the bundled JS service as a proxy) |

## Install it on a TV

The app is not in the LG Content Store yet. To install a release without a command line, follow [`install.md`](install.md). To install it from source:

1. Install LG's **Developer Mode** app on the TV, sign in with an LG developer account and turn Developer Mode on. The Developer Mode session expires unless you extend it in that app.
2. Connect the TV once. The passphrase is shown in the Developer Mode app.

   ```bash
   npx ares-setup-device --add tv --info "{'host':'<TV-IP>','port':'9922','username':'prisoner'}"
   ```

   ```bash
   npx ares-novacom --device tv --getkey
   ```

3. Build, package, install and launch:

   ```bash
   npm run tv:deploy
   ```

`tv:deploy` installs on the device named `tv`; `WEBOS_DEVICE` names another one. It passes launch parameters from the environment:

- `SILO_SERVER` pre-fills the server.
- `PROBE=1` opens the diagnostics probe instead of the app.
- `TRANSPORT=direct|service` chooses how the app talks to Silo (default `direct`).

**A released `.ipk`:** each [release](https://github.com/Thazzr/silo-tv/releases) carries the package with its SHA-256 and the license notices of the bundled third-party packages. With the TV connected as above (steps 1 and 2), install it with:

```bash
npx ares-install --device tv io.github.thazzr.silotv_<version>_all.ipk
```

Between releases, every CI run keeps the package it built as the artifact `ipk` for 30 days (open a run under [Actions → CI](https://github.com/Thazzr/silo-tv/actions/workflows/ci.yml); downloading needs a GitHub account).

## Diagnostics on the TV

| Command | What it does |
|---|---|
| `PROBE=1 npm run tv:deploy` | opens the probe: the codecs, containers, HDR flags and network checks of this TV |
| `npm run tv:eval` | reads the probe report, or any expression, from the running app through the webOS Web Inspector |
| `npm run tv:profile` | records a sampling CPU profile of the running app into `perf-results/*.cpuprofile` and prints the most expensive functions (`--seconds`, `--interval`, `--out`). Deploy with `PERF_BUILD=1 npm run tv:deploy` first for readable function names. |
| `npm run perf:scroll` | local scroll profiling against a fake server: an unminified build, CPU throttle 6, task time per key, long tasks, slow frames, React commits and renders per key press, and the compositor layers at rest (not part of the gate). Scenarios `homewalk`, `home`, `recommended`, `browse`; pick one with `-- -g homewalk`. `PERF_THROTTLE`, `PERF_ROWS` (Home rows, default 7), `PERF_FEATURED=0` (no carousel, for commits before it) and `PERF_LABEL` (names `perf-results/scroll-<label>.json`) adjust a run. |

## Commands

| Command | What it does |
|---|---|
| `npm run dev` | the Vite dev server in the browser |
| `npm run build` | the production bundle in `dist/`: one classic script for webOS |
| `npm run check:bundle` | checks `dist/` for webOS: ES2019 syntax, a classic script, relative paths, one JS file, matching versions |
| `npm run package` | builds the `.ipk` in `out/` |
| `npm run tv:deploy` | builds, packages, installs and launches on the TV |
| `npm run verify` | the full gate, see below |
| `npm run typecheck` / `npm run lint` | TypeScript for the app, the tooling and the service; ESLint and Prettier |
| `npm test` | the unit and component tests (Vitest) |
| `npm run test:e2e` | the end-to-end tests (Playwright) on the built bundle |
| `npm run test:coverage` | the unit tests with a coverage report in `reports/coverage/` |
| `npm run test:mutation` | the mutation run with [StrykerJS](https://stryker-mutator.io); hours for all files, `STRYKER_SHARD=3/24` runs one of the 24 shards the CI uses |
| `npm run openapi:update` | refreshes the slim Silo API spec from `SILO_SERVER` (no address is stored) |
| `npm run generate:api` | regenerates the typed API client from `openapi/silo-v2.json` |
| `npm run icons` | regenerates the app icons |

## Tests and quality checks

### The gate

`tools/verify.ps1` (also `npm run verify`) is the gate every change passes. It runs eight steps in order:

1. **verify script tests**: the gate's own tests
2. **typecheck**: the app, the tooling and the service
3. **lint**: ESLint and the Prettier check
4. **unit tests**: Vitest with React Testing Library and jsdom; the API is mocked with MSW, and fixtures are typed against the generated API types
5. **build**
6. **bundle check**: `es-check` for ES2019 (Chromium 79 on webOS 6), a classic script, relative paths, one JS file, matching versions
7. **e2e**: Playwright in Chromium at 1920×1080. It loads `dist/index.html` over `file://`, the way the TV loads the app, and drives it by keyboard only, like a remote.
8. **package**: `ares-package` as a packaging probe

A failing step stops nothing, except that a failed build skips the three steps that need it. The gate ends with a table of each step's time and result and exits non-zero unless every step is `ok` or `skipped`. `-Only "<step>"` runs single steps. For a quick check while working: `npm run typecheck`, `npm run lint` and `npx vitest run <paths>`.

Before a phase ends, its flows are also tested on a real TV, with direct play and HLS.

### Continuous integration

- **CI** ([`.github/workflows/ci.yml`](../.github/workflows/ci.yml)) runs the same gate on every push and pull request, on GitHub's Ubuntu runners.
  - Each run's summary shows the gate's table, the unit and E2E test counts and the code coverage.
  - The JUnit files, the coverage report, the Playwright report and the `.ipk` are kept as artifacts for 30 days.
  - No secrets are used.
- **Mutation testing** ([`.github/workflows/mutation.yml`](../.github/workflows/mutation.yml)) runs StrykerJS over all app code once a week and on demand.
  - Stryker changes the code in small ways (a `<` becomes `<=`, a condition becomes `true`, …) and counts how many of these mutants the tests catch.
  - The files are split into 24 shards that run in parallel and are merged into one report. Results are cached, so a weekly run only re-tests code or tests that changed.
  - The first full run (2026-11-11) scored 79.3 % over 15,215 mutants. The workflow fails when the merged score drops below the baseline of 77 % (`MUTATION_BREAK`).
  - One pitfall: Stryker credits a mutant only to tests that run the code inside a test. A unit built once in a `describe` body leaves its mutants uncaught, even when the tests check its values.
- **GitHub Pages** ([`.github/workflows/pages.yml`](../.github/workflows/pages.yml)) publishes the results after each CI run on `main` and each mutation run:
  - the [test results card](https://thazzr.github.io/silo-tv/status/test-results-dark.svg) in the README, drawn from the latest CI run and the latest mutation run;
  - the [mutation report](https://thazzr.github.io/silo-tv/mutation/);
  - the badge data.

  It is the only workflow that deploys the site. The others hand it their results as artifacts.

## The Silo API client

The app talks only to Silo's native `/api/v2`, through a client generated with `openapi-typescript` from the pinned specification in `openapi/silo-v2.json`. Raw `fetch` calls against the API are not allowed outside the transport layer (`src/api/transport/`).

When an endpoint is missing, refresh the specification and regenerate the client:

```bash
npm run openapi:update
```

```bash
npm run generate:api
```

`openapi:update` reads the server from `SILO_SERVER` and stores a slimmed copy of its specification, never the address.

## Project layout

| Path | What is there |
|---|---|
| `src/api/` | the generated client, the transport layer (direct or through the JS service), sign-in tokens and refresh |
| `src/app/` | app root, flow and routing, the shell with the top bar, focus navigation (`nav/`), server list |
| `src/features/` | the screens: sign-in, profiles, home, library, detail, box sets, person, search, settings, branding |
| `src/playback/` | the player: engine over the video element and hls.js, the protocol v3 session (`session/`), the overlay (`osd/`), menus, skips, subtitles, the device profile |
| `src/platform/` | the `Platform` adapter: everything webOS-specific, with a browser implementation (a Tizen one follows in Phase 6) |
| `src/ui/` | shared UI: cards, rows, grids, skeletons, images |
| `src/i18n/` | German and English texts |
| `src/probe/` | the diagnostics probe |
| `service/` | the optional webOS JS service that can proxy API calls |
| `e2e/` | Playwright tests |
| `scripts/` | build, bundle check, TV deploy and diagnostics scripts (Node) |
| `tools/` | the gate, CI and mutation tooling, the changelog script, see [`tools/README.md`](../tools/README.md) |
| `openapi/` | the pinned Silo API specification |

## Commits, changelog and versions

- Commits follow [Conventional Commits](https://www.conventionalcommits.org) in English, with a body that says why.
- `CHANGELOG.md` is generated by [git-cliff](https://git-cliff.org) from the commit subjects (`pwsh tools/update-changelog.ps1`) and is never edited by hand.
- Versions are SemVer `0.MINOR.PATCH` while the project is before 1.0. `package.json`, `public/appinfo.json` and `service/package.json` carry the same version.
- A phase ends with a version tag: `pwsh tools/update-changelog.ps1 -Tag v0.X.0 -TagMessage "<short description>"`.
- **Releases:** pushing the tag starts [`.github/workflows/release.yml`](../.github/workflows/release.yml).
  - It checks that the tag and the versions agree, and runs the full gate.
  - It then publishes a GitHub release with the `.ipk`, its SHA-256, `THIRD_PARTY_NOTICES.txt`, and notes built from the tag message and the changelog.
  - A tag with a SemVer pre-release suffix (`v0.4.0-rc.1`) becomes a pre-release; every other tag becomes a normal release, marked as the latest.
- The build writes `THIRD_PARTY_NOTICES.txt` into the bundle (`scripts/third-party-notices.mjs`). It fails when a bundled package has a license that is not compatible with the MPL-2.0.
