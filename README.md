# silo-tv

A native TV client for the self-hosted media server [Silo](https://github.com/Silo-Server/silo-server): first for LG TVs running webOS (model year 2021 and later, webOS 6+), later also for Samsung TVs running Tizen.

> Not an official Silo project. "Silo" is a trademark of Silo Media L.L.C.; this app is an independent client for Silo. `silo-tv` is a working title; the app name will be chosen before the first store release.

## Status

Phase 0 (feasibility) and Phase 1 (foundation: servers, sign-in, profiles, app shell, TV navigation) are built and run on the first test TV. Phase 2 (browse) is built: Home, the Movies and Series tabs, the detail pages and resuming are checked on the TV; search, person pages, box sets, the content-rating and watch-state filters, title art, spoiler protection, Trailers & More, theme music and AI translation wait for the device test that closes the phase. What the app is meant to do, and in which order: [`docs/roadmap.md`](docs/roadmap.md); the look: [`docs/design.md`](docs/design.md).

## Tech stack

| Area | Choice |
|---|---|
| Language | TypeScript |
| UI | React with Vite, built for Chromium 79 (webOS 6) as one classic script |
| Data | TanStack Query; API client generated from Silo's OpenAPI (`/api/v2`) |
| Playback | the native `<video>` element with the TV's media pipeline; Silo playback protocol v3 |
| Tests | Vitest, React Testing Library, MSW, Playwright |
| TV tooling | `@webos-tools/cli` (`ares-package`, `ares-install`, `ares-launch`, `ares-inspect`) |
| Process tooling | PowerShell (`tools/`), git-cliff for the changelog |

## Development

Requirements: Node.js 24, PowerShell 7 (`pwsh`), and for the TV an LG TV in Developer Mode.

```bash
npm ci
npx playwright install chromium --only-shell
```

| Command | What it does |
|---|---|
| `npm run dev` | Vite dev server in the browser |
| `npm run build` | production bundle in `dist/` (one classic script for webOS) |
| `npm run check:bundle` | checks `dist/` for webOS compatibility |
| `npm run package` | builds the `.ipk` in `out/` |
| `npm run verify` | the full gate (see [`tools/README.md`](tools/README.md)) |
| `npm run tv:deploy` | build, package, install and launch on the TV named `tv` (`WEBOS_DEVICE` overrides it) |
| `npm run tv:eval` | read the TV probe report (or any expression) from the running app through the webOS Web Inspector |
| `npm run tv:profile` | record a sampling CPU profile of the running app on the TV (`--seconds`, `--interval`, `--out`) into `perf-results/*.cpuprofile` and print the most expensive functions; deploy with `PERF_BUILD=1 npm run tv:deploy` first for readable function names |
| `npm run perf:scroll` | local scroll profiling: unminified build, CPU throttle 6, long tasks, slow frames and renders per key press (not part of the gate) |
| `npm run openapi:update` | refresh the slim Silo API spec from `SILO_SERVER` (no address is stored) |
| `npm run generate:api` | regenerate the typed API client from `openapi/silo-v2.json` |

`tv:deploy` passes launch parameters from the environment: `SILO_SERVER` pre-fills the server, `PROBE=1` opens the diagnostics probe instead of the app, `TRANSPORT=direct|service` chooses how the app talks to Silo (default `direct`). In the browser the same parameters work as query strings, e.g. `?probe` or `?server=…`.

For browser development against a real server, start `npm run dev` with `SILO_SERVER` set: the dev server proxies `/api` to it, because Silo sends no CORS headers.

Connect a TV once (the passphrase is shown in the Developer Mode app):

```bash
npx ares-setup-device --add tv --info "{'host':'<TV-IP>','port':'9922','username':'prisoner'}"
```

```bash
npx ares-novacom --device tv --getkey
```

Rules and workflow are in [`CLAUDE.md`](CLAUDE.md): Opus plans and reviews, a Sonnet subagent implements, and every phase ends with the gate, a device test, a commit, a tag and a generated changelog.

## License

[Mozilla Public License 2.0](LICENSE) (`MPL-2.0`). Anyone may use, change and share the app, also through app stores. Whoever shares a modified version must publish the source code of the files they changed under the same license; files of their own may carry another license.

This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
