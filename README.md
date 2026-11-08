# silo-lg

A native client for LG TVs running webOS (model year 2021 and later, webOS 6+) for the self-hosted media server [Silo](https://github.com/Silo-Server/silo-server).

> Not an official Silo project. "Silo" is a trademark of Silo Media L.L.C.; this app is an independent client for Silo. `silo-lg` is a working title.

## Status

Phase 0 (feasibility) is in progress. What the app is meant to do, and in which order: [`docs/roadmap.md`](docs/roadmap.md).

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

Connect a TV once (the passphrase is shown in the Developer Mode app):

```bash
npx ares-setup-device --add tv --info "{'host':'<TV-IP>','port':'9922','username':'prisoner'}"
```

```bash
npx ares-novacom --device tv --getkey
```

Rules and workflow are in [`CLAUDE.md`](CLAUDE.md): Opus plans and reviews, a Sonnet subagent implements, and every phase ends with the gate, a device test, a commit, a tag and a generated changelog.

## License

[GNU Affero General Public License v3.0 or later](LICENSE) (`AGPL-3.0-or-later`), like Silo itself. Anyone may use, change and share the app. Whoever shares a modified version must publish its source code under the same license.
