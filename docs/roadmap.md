# Roadmap and features

Goal: the LG TV app should offer everything the Silo web client offers a viewer. The list is derived from the Silo web client (`silo-server/web/src/pages`) and the specification of the official Roku client (`silo-roku/docs/spec.md`, section 3). What the server offers only optionally is shown only when the server reports it through its capabilities.

Status: ⬜ planned · 🟨 built and tested in the browser, not yet checked on the TV · ✅ done and checked on the TV (or, for repository items, done)

## Phase 0 – Feasibility (target v0.1.0)

Answers the platform questions before any real UI is built. Looks do not matter yet.

- ✅ Project scaffold: Vite, React, TypeScript, ESLint/Prettier, Vitest, Playwright, i18n basics
- ✅ Tooling: `tools/verify.ps1` with self-tests, `tools/update-changelog.ps1`, webOS CLI
- 🟨 Build for webOS 6: one classic script, Chromium 79 syntax, polyfills; `appinfo.json`, placeholder icons (runs on webOS 24; webOS 6 not yet tested on hardware)
- ✅ Install and launch the app on the TV (webOS 24, 2026-11-08)
- ✅ CORS test on the TV: webOS does not enforce CORS for the packaged app, so the app talks to Silo directly; the JS service works as a fallback (Node v16 on webOS 24)
- ✅ Generated API client from Silo's OpenAPI, transport layer, required headers, token refresh
- 🟨 Check a server address (`/system/info`, `api_major == 2`)
- 🟨 Sign-in by code/QR (device login)
- 🟨 One title through playback protocol v3: direct play and HLS, progress every 10 s, stop
- 🟨 Device profile probe: which codecs, containers and HDR formats the TV really supports (probed on webOS 24: H.264, HEVC Main10, VP9, AV1, Dolby Vision 5/8, DTS, E-AC-3; turning it into Silo's device profile comes with playback)
- 🟨 Diagnostics overlay with plan, route and player state, without secrets

## Phase 1 – Foundation: server, account, profiles, shell (target v0.2.0)

- 🟨 Platform adapter: everything webOS-specific (Luna calls, device info, key codes, exit, launch parameters, secure storage, later the player) behind one `Platform` interface with a webOS and a browser implementation, so a Samsung Tizen port (Phase 6) adds an adapter instead of touching the app
- 🟨 Save several servers and switch between them; each keeps its sign-in
- 🟨 Sign in by code/QR (offered first) and by password with an on-screen keyboard; sign out
- 🟨 Profiles: picker, PIN, child profiles, create a profile
- 🟨 Profile at launch: automatic, every time, after 1 hour, after 12 hours
- 🟨 Switch profile and server
- 🟨 App shell with a top bar: Home, Movies, Series, For You, Calendar, Search, avatar menu (the tabs show the Phase 0 title list or "Coming soon" until Phase 2 and 4 fill them)
- 🟨 Focus navigation with arrows, OK and Back; focus memory; Magic Remote pointer; exit popup on the entry screen
- 🟨 Server branding from `GET /api/v2/theme/branding`: the server's name, its mark (icon) in the server list and top bar, its wordmark on the sign-in and server screens, its sign-in background and subtitle, and its accent colour for highlights (only when it stays readable on the dark UI; otherwise the default). The app's own launcher icon stays fixed, because webOS reads it from the package
- 🟨 Loading, empty and error states
- 🟨 German and English following the TV's language

## Phase 2 – Browse (target v0.3.0)

- 🟨 Home built from the server's home sections: Continue Watching, Next Up, Recently Added and every other row the admin configures
- 🟨 Rows of at most 20 cards plus an "Explore all" card that opens the full, paged page
- 🟨 Library tabs for Movies and Series:
  - Recommended rows
  - Browse grid with sort, filters (genre, decade) and an alphabet rail; watch-state and content-rating filters still to come through the documented `GET /catalog` parameters
  - Collections
- 🟨 Tabs and pills switch only on OK or a pointer click, never on focus or hover (TV test 2026-11-09)
- 🟨 Search with an on-screen keyboard of our own (ä ö ü ß, results while typing): matching box sets first, then people (when the server offers them), then movies, series and episodes (episodes when the server offers them), filtered by All, Movies or Series
- 🟨 Movie detail page: hero, description, credit line, external ratings, quality badges
- 🟨 Series detail page with seasons and episodes, cast, recommendations
- 🟨 Similar titles
- 🟨 Person page from the cast: portrait, dates, biography and filmography, filtered by All, Movies or Series
- 🟨 Box sets: page with the films in release order and "Play" / "Continue" for the first unwatched film; a box set row on movie pages
- 🟨 Long synopses and biographies scroll in the text dialog
- 🟨 Smooth scrolling on TV hardware: memoised rows and cards, artwork prefetched in the direction of travel, arrow keys in rows and grids move by index without the navigation library's layout measuring, permanent compositor layers over large pictures (measured with `npm run tv:profile`)
- 🟨 The Magic Remote wheel scrolls lists (LG recommendation): one wheel notch is one Up/Down step everywhere; suspended in the player and the probe
- ⬜ Trailers & More: local trailers and extras; YouTube trailers through the TV's YouTube app
- ⬜ Theme music on detail pages when the profile turns it on
- ⬜ Title art (logo instead of text) following the profile setting
- ⬜ Spoiler protection: blurred still and hidden description for unwatched episodes
- ⬜ AI translation of descriptions when the server offers it

## Phase 3 – Player (target v0.4.0)

- ✅ Play, resume and start over, following the server's progress; one resume rule everywhere (past 30 s and more than 5 s before the end, also for a rewatch of a played item); Continue Watching and Next Up cards resume directly (TV 2026-11-09)
- ✅ Rewind on resume: Silo's device setting `player.resume_rewind_seconds` (0–30 s, default 7, 0 turns it off) in the app's settings screen (TV 2026-11-09)
- ⬜ Choose version, audio track and subtitle on the detail page beforehand; save the choice as a server preference
- ⬜ Direct play, HLS remux and transcode, as protocol v3 plans them
  - device profile with H.264, HEVC, VP9, AV1, HDR10, HDR10+, Dolby Vision and multichannel audio, as far as the TV supports them
- ⬜ Controls:
  - play/pause, skip and seek steps
  - scrubbing with preview thumbnails (trickplay)
  - chapters: picker, display and marks on the timeline
- ⬜ Audio, subtitle and quality changes during playback (replan)
- ⬜ Search and download subtitles through the server's subtitle providers
- ⬜ Subtitle appearance following the profile setting (size, style)
- ⬜ Skip intro, recap and credits; automatic skipping following the profile setting
- ⬜ Up Next: next episode automatically, On Deck suggestions at the end of a movie
- ⬜ Shuffle for a library, collection, series and season
- ⬜ Report progress continuously and at the end
- ⬜ Sleep timer
- ⬜ Playback speed and aspect ratio (not possible in the Roku client, possible on webOS)
- ⬜ Audio and subtitle delay

## Phase 4 – Personal and discovery (target v0.5.0)

- ⬜ "For You" with the server's recommendation rows
- ⬜ Calendar: one week of releases and airings for followed, trending or all titles
- ⬜ Watchlist, favorites and history, each with removal
- ⬜ Mark as watched or unwatched: movie, series, season, episode
- ⬜ Requests, when the server offers them:
  - Discover rows
  - request, cancel, notify me
  - My Requests
  - request search for missing titles
- ⬜ Profile settings, in the settings screen that Phase 3 opens with the device settings:
  - playback, subtitle appearance, interface, home screen
  - metadata language, profile picker at launch
  - account and signed-in devices

## Phase 5 – Extras (from v0.6.0)

- ⬜ Watch Party: host and join rooms, host-pick and vote rooms, synchronized playback
- ⬜ Edit home rows
- ⬜ Notifications
- ⬜ Music and audiobooks with an audio player of their own
- ⬜ Launch parameters and deep links (e.g. straight to a title); presence in the LG home launcher
- ⬜ To investigate: remote control from the Silo phone app (SiloControl) and sign-in through the phone app. Both need network services a webOS app may not be allowed to provide.

## Phase 6 – Samsung Tizen port (after the LG release)

The same app for Samsung TVs running Tizen. Most of it is shared (UI, i18n, API client, sign-in, focus navigation, screens, playback protocol logic); the port adds what is platform-specific. Planned once the LG version is in the LG Content Store.

- ⬜ Tizen platform adapter: device info (`webapis.productinfo`), key codes (Back 10009, media keys registered through `tizen.tvinputdevice`), exit, launch parameters, storage
- ⬜ Player on Samsung's AVPlay API for 4K, HDR10, HDR10+ and Dolby Vision, with the device profile built from AVPlay's capability queries; protocol v3 logic shared with webOS
- ⬜ Build target for the oldest supported Tizen version (Tizen 5.5 / 2020 models ship Chromium 69 – decide the minimum model year before the port starts)
- ⬜ Packaging: `config.xml` with the network access policy (Tizen allows cross-origin requests by configuration, so no proxy service is needed), Tizen CLI, Samsung author and distributor certificates
- ⬜ Device tests on Samsung TVs in Developer Mode
- ⬜ Samsung Seller Office account and Samsung's app review (check first whether individual sellers can publish in the target countries)
- ⬜ Store material for Samsung: name, icon, screenshots, test account on the demo server

## Release – final goal: the LG Content Store

The project is public and should be as usable for every Silo user as Silo itself. The final goal is a listing in the LG Content Store; the requirements are summarised in `CLAUDE.md` → *LG Content Store rules*.

Repository and project:

- ⬜ Works with any Silo server: the address is entered in the app, nothing is built in
- ✅ License like Silo: AGPL-3.0-or-later
- ✅ No server addresses, account names or e-mail addresses in the repository or its history
- ✅ Repository in English (docs, comments, commit messages, changelog)
- ⬜ No code copied from Silo's repositories, so the store build carries only code this project owns
- ⬜ CI on GitHub: the gate on every push and pull request
- ⬜ Releases: tags, the `.ipk` as a release asset, changelog from git-cliff
- ⬜ Contribution guidelines and issue templates; a contributor agreement (CLA or DCO) that keeps store distribution possible

LG Content Store:

- ⬜ A name and icon of its own, following the Silo trademark policy; ask the Silo team (trademark@siloserver.org) before submitting
- ⬜ LG QA requirements built in from the start: 5-way navigation and Magic Remote pointer everywhere, a selection effect on every object, exit popup on Back at the entry page, loading cues, 75 px targets and 20 px text at 1080p
- ⬜ `requiredACG` in `appinfo.json` with exactly the ACG groups the app and its service use
- ⬜ JS service secured: callable only by this app, no requests to the TV itself or link-local addresses
- ⬜ Tokens stored as protected as the platform allows; no credentials in source or file names
- ⬜ Seller Lounge account (individual or corporate seller)
- ⬜ Demo Silo server for LG's testers: reachable from the internet, with a reviewer account and legally shareable content (e.g. Blender open movies)
- ⬜ Privacy policy (what the app stores on the TV and sends to the user's own server)
- ⬜ Submission material: screenshots, UX scenario, filled-in self-checklist (always the current form from Seller Lounge)
- ⬜ Device tests on as many webOS versions as possible (6, 22, 23, 24, 25)
- ⬜ For sideloading meanwhile: an installation guide for Developer Mode and the Homebrew Channel

## Deliberately not planned

- **Light mode:** the TV app stays dark only, like Silo's own TV apps (user decision 2026-11-08): bright surfaces glare in a dark room and wear OLED panels. Colours remain tokens, so the decision is cheap to revisit.
- **Admin area:** server setup, libraries, users, plugins, metadata editing
- **Collections:** creating or editing them (no Silo TV app offers it)
- **Reading:** e-books, comics, manga, documents
- **Downloads** and offline playback
- **Live TV**, DVR, IPTV: Silo rules these out on principle
- **Browser sign-in** via OIDC/OAuth on the TV, and account sign-up. Code sign-in covers those accounts, because the confirmation happens in the phone's browser.
- **Server discovery on the network** (mDNS): a webOS web app cannot do it; the server address is entered.
