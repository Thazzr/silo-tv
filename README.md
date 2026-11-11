<div align="center">

# silo-tv

**A native TV app for [Silo](https://github.com/Silo-Server/silo-server) on LG webOS TVs**<br>
made for the remote control and the couch

[![CI](https://github.com/Thazzr/silo-tv/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/Thazzr/silo-tv/actions/workflows/ci.yml)
[![Mutation score](https://img.shields.io/endpoint?url=https%3A%2F%2Fthazzr.github.io%2Fsilo-tv%2Fbadge.json)](https://thazzr.github.io/silo-tv/mutation/)
[![Release](https://img.shields.io/github/v/release/Thazzr/silo-tv?include_prereleases&label=release)](https://github.com/Thazzr/silo-tv/releases)
[![License: MPL-2.0](https://img.shields.io/badge/license-MPL--2.0-blue.svg)](LICENSE)
![Platform: LG webOS 6+](https://img.shields.io/badge/platform-LG%20webOS%206%2B-a50034.svg)
![Status: in development](https://img.shields.io/badge/status-in%20development-orange.svg)

</div>

![The Home screen: a hero with the title's logo and the Trending row below it](docs/screenshots/home.webp)

> [!NOTE]
> Not an official Silo project. "Silo" is a trademark of Silo Media L.L.C.; this app is an independent client for Silo. `silo-tv` is a working title: the app gets a name of its own before the first store release.

## What it does

It works with any Silo server (API v2): you enter the server's address on the TV, nothing is built in.

| Area | What you get |
|---|---|
| **Sign-in from the couch** | a code or QR code you confirm on your phone, or a password with the on-screen keyboard; several servers, each with its own sign-in |
| **Profiles** | a picker with avatars, PIN-protected and kids profiles, creating a profile, and how the app picks the profile at launch |
| **Home** | the rows your server's home page is built from (Continue Watching, Next Up, Recently Added and the rest), with a hero |
| **Movies and Series** | recommended rows, collections, and a browse grid with sort, filters (genre, decade, content rating, watch state) and a letter rail |
| **Detail pages** | title art, ratings, quality badges, seasons and episodes, cast, similar titles, box sets, and person pages with filmography |
| **Search** | results while you type: box sets, people, movies, series and episodes; the keyboard has ä, ö, ü and ß |
| **Playback** | Silo's playback protocol v3: direct play, and HLS remux and transcode through hls.js; resume and start over, with an optional rewind on resume |
| **The player** | the layout of Silo's web player: a scrubber with buffer, trickplay previews, chapters and coloured intro, recap and credits; skips by your profile's steps; skip intro, recap and credits; a quality menu that respects your bitrate limit; an Info panel; subtitles in your appearance, which you can set per TV with a live preview |
| **Extras** | Trailers & More (YouTube trailers open in the TV's YouTube app), theme music, spoiler protection for unwatched episodes, AI translation of descriptions, each when your profile and server turn it on |
| **Made for the remote** | arrows, OK and Back everywhere, the Magic Remote pointer and wheel, and focus that comes back to where you were |
| **Your server's look** | its name, logo, sign-in background and accent colour |
| **German and English** | following the TV's language, or chosen in the app's settings |
| **Careful with your sign-in** | the access token stays in memory, only the refresh token is stored on the TV, and HLS and subtitles send it in a header instead of the URL |

## Screenshots

| | |
|---|---|
| ![A series detail page with title art, rating, synopsis, cast line and season pills](docs/screenshots/series-detail.webp) | ![The episode row of a season and the Trailers & More row below it](docs/screenshots/episodes.webp) |
| **Detail page**: title art, ratings, seasons | **Episodes** and Trailers & More |
| ![Search with the on-screen keyboard and results while typing](docs/screenshots/search.webp) | ![The browse grid with sort, filter and the letter rail](docs/screenshots/browse.webp) |
| **Search** with an on-screen keyboard for the remote | **Browse** with sort, filters and a letter rail |

<sub>Taken at 1920×1080 against a test server. Posters, stills and logos belong to their rights holders and are not covered by this project's license.</sub>

## Test results

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://thazzr.github.io/silo-tv/status/test-results-dark.svg">
  <img alt="Test results of the latest CI run on main: the gate's steps, unit and end-to-end test counts, code coverage and the mutation score" src="https://thazzr.github.io/silo-tv/status/test-results-light.svg">
</picture>

This card updates itself after every CI run on `main` and every weekly mutation run:

- **CI** runs the full gate on every push: types, lint, unit and component tests, the webOS bundle check, end-to-end tests in a browser driven like a remote, and packaging. → [CI runs](https://github.com/Thazzr/silo-tv/actions/workflows/ci.yml)
- **Mutation testing** changes the code in thousands of small ways and counts how many of these changes the tests catch. A run below the 77 % baseline fails. → [Mutation report](https://thazzr.github.io/silo-tv/mutation/)
- **On a real TV:** every phase ends with a test of its flows, with direct play and HLS.

What each check does, and how to run it yourself: [Tests and quality checks](docs/development.md#tests-and-quality-checks).

## Status

Early development; there is no release yet. The goal is a listing in the LG Content Store.

| Phase | Scope | State |
|---|---|---|
| 0 · Feasibility | build for webOS, CORS, API client, code sign-in, a first playback | ✅ on the TV (webOS 24 and 26); webOS 6 itself not yet tested on hardware |
| 1 · Foundation | servers, sign-in, profiles, app shell, TV navigation | 🟨 on the TV, except two servers and the profile at launch |
| 2 · Browse | home, libraries, detail pages, search, person pages, extras | 🟨 mostly on the TV; spoiler protection, theme music and AI translation still to check there, the featured hero still to build |
| 3 · Player | playback, overlay, skips, quality, subtitles; next: audio and subtitle menus, Up Next, shuffle | 🟨 in progress; the playback core, the overlay, skips and the quality menu are checked on the TV |
| 4 · Personal | For You, calendar, watchlist, requests, profile settings | ⬜ planned |
| 5 · Extras | Watch Party, notifications, music and audiobooks | ⬜ planned |
| 6 · Samsung Tizen | the same app for Samsung TVs | ⬜ after the LG release |

Every feature and its state: [roadmap](docs/roadmap.md).

## Try it on your TV

It is not in the LG Content Store yet. You can install it on an LG TV from 2021 or later (webOS 6 and newer) in Developer Mode, from a [release](https://github.com/Thazzr/silo-tv/releases) or from source. You need a Silo server.

→ **[Install it on a TV](docs/development.md#install-it-on-a-tv)**

## How it is built

- It talks only to Silo's native `/api/v2`, through a client generated from Silo's OpenAPI specification.
- It is written from scratch against Silo's documentation. No code is taken from Silo's repositories.
- It is built for the TV's old browser engine: React and TypeScript, compiled for Chromium 79 (webOS 6) into one classic script.
- Direct play uses the TV's own video element; HLS plays through [hls.js](https://github.com/video-dev/hls.js).
- Everything webOS-specific sits behind one platform adapter, so a Samsung Tizen port adds an adapter instead of touching the app.
- It is written with heavy AI assistance (Claude Code): one session plans and reviews, a subagent implements each package, and every change passes the full gate.

| Area | Choice |
|---|---|
| UI | React, Vite, TanStack Query, [Norigin spatial navigation](https://github.com/NoriginMedia/Norigin-Spatial-Navigation) for the remote |
| Playback | `<video>` and hls.js over Media Source Extensions; Silo playback protocol v3 |
| Tests | Vitest, React Testing Library, MSW, Playwright, StrykerJS |
| TV tooling | `@webos-tools/cli` |

## Documentation

| Document | What is in it |
|---|---|
| [Development and deployment](docs/development.md) | setup, commands, running in the browser, installing on a TV, diagnostics, tests and CI |
| [Roadmap](docs/roadmap.md) | every feature by phase, with its state |
| [Design](docs/design.md) | colours, type, layout and focus rules |
| [Changelog](CHANGELOG.md) | generated from the commit history |
| [`CLAUDE.md`](CLAUDE.md) | the house rules for every change |
| [Tools](tools/README.md) | the gate, CI and mutation tooling |

## Contributing

Issues, ideas and pull requests are welcome. Reports from webOS versions other than the test TV's are especially useful. How to report and how to contribute: [`CONTRIBUTING.md`](CONTRIBUTING.md). Security problems go to a [private report](SECURITY.md), never into a public issue. Everyone follows the [code of conduct](CODE_OF_CONDUCT.md); what the app does for accessibility is in [`ACCESSIBILITY.md`](ACCESSIBILITY.md).

## License

[Mozilla Public License 2.0](LICENSE) (`MPL-2.0`). Anyone may use, change and share the app, also through app stores. Whoever shares a modified version must publish the source code of the files they changed under the same license; files of their own may carry another license.

This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
