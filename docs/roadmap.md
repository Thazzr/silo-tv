# Roadmap and features

Goal: the LG TV app should offer everything the Silo web client offers a viewer. The list is derived from the Silo web client (`silo-server/web/src/pages`) and the specification of the official Roku client (`silo-roku/docs/spec.md`, section 3). What the server offers only optionally is shown only when the server reports it through its capabilities.

Status: ⬜ planned · 🟨 in progress · ✅ done and checked on the TV (or, for repository items, done)

## Phase 0 – Feasibility (target v0.1.0)

Answers the platform questions before any real UI is built. Looks do not matter yet.

- ✅ Project scaffold: Vite, React, TypeScript, ESLint/Prettier, Vitest, Playwright, i18n basics
- ✅ Tooling: `tools/verify.ps1` with self-tests, `tools/update-changelog.ps1`, webOS CLI
- 🟨 Build for webOS 6: one classic script, Chromium 79 syntax, polyfills; `appinfo.json`, placeholder icons (built and packaged; not yet installed on a TV)
- ⬜ Install and launch the app on the TV
- ⬜ CORS test on the TV: direct `fetch` against `/api/v2`, otherwise a Luna JS service as a proxy; decide afterwards
- ⬜ Generated API client from Silo's OpenAPI, transport layer, required headers, token refresh
- ⬜ Check a server address (`/system/info`, `api_major == 2`)
- ⬜ Sign-in by code/QR (device login)
- ⬜ One title through playback protocol v3: direct play and HLS, progress every 10 s, stop
- ⬜ Device profile probe: which codecs, containers and HDR formats the TV really supports
- ⬜ Diagnostics overlay with plan, route and player state, without secrets

## Phase 1 – Foundation: server, account, profiles, shell (target v0.2.0)

- ⬜ Save several servers and switch between them; each keeps its sign-in
- ⬜ Sign in by code/QR (offered first) and by password with an on-screen keyboard; sign out
- ⬜ Profiles: picker, PIN, child profiles, create a profile
- ⬜ Profile at launch: automatic, every time, after 1 hour, after 12 hours
- ⬜ Switch profile and server
- ⬜ App shell with a top bar: Home, Movies, Series, For You, Calendar, Search, avatar menu
- ⬜ Focus navigation with arrows, OK and Back; focus memory; Magic Remote pointer
- ⬜ Server branding (server name); loading, empty and error states
- ⬜ German and English following the TV's language

## Phase 2 – Browse (target v0.3.0)

- ⬜ Home built from the server's home sections: Continue Watching, Next Up, Recently Added and every other row the admin configures
- ⬜ Rows of at most 20 cards plus an "Explore all" card that opens the full, paged page
- ⬜ Library tabs for Movies and Series:
  - Recommended rows
  - Browse grid with sort, filters and an alphabet rail
  - Collections
- ⬜ Search across movies, series and episodes; matching box sets first
- ⬜ Movie detail page: hero, description, credit line, external ratings, quality badges
- ⬜ Series detail page with seasons and episodes, cast, recommendations
- ⬜ Similar titles
- ⬜ Person page: biography and filmography, filtered by All, Movies or Series
- ⬜ Box sets: page with the films in release order, "Play next"
- ⬜ Trailers & More: local trailers and extras; YouTube trailers through the TV's YouTube app
- ⬜ Theme music on detail pages when the profile turns it on
- ⬜ Title art (logo instead of text) following the profile setting
- ⬜ Spoiler protection: blurred still and hidden description for unwatched episodes
- ⬜ AI translation of descriptions when the server offers it

## Phase 3 – Player (target v0.4.0)

- ⬜ Play, resume and start over, following the server's progress
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
- ⬜ Profile settings:
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

## Release (alongside, at the latest before v1.0)

The project is public and should be as usable for every Silo user as Silo itself.

- ⬜ Works with any Silo server: the address is entered in the app, nothing is built in
- ✅ License like Silo: AGPL-3.0-or-later
- ✅ No server addresses, account names or e-mail addresses in the repository or its history
- ✅ Repository in English (docs, comments, commit messages, changelog)
- ⬜ A name and icon of its own, following the Silo trademark policy
- ⬜ CI on GitHub: the gate on every push and pull request
- ⬜ Releases: tags, the `.ipk` as a release asset, changelog from git-cliff
- ⬜ Installation guide for Developer Mode and rooted TVs (Homebrew Channel); later perhaps an entry in the Homebrew Channel repository
- ⬜ Contribution guidelines and issue templates

## Deliberately not planned

- **Admin area:** server setup, libraries, users, plugins, metadata editing
- **Collections:** creating or editing them (no Silo TV app offers it)
- **Reading:** e-books, comics, manga, documents
- **Downloads** and offline playback
- **Live TV**, DVR, IPTV: Silo rules these out on principle
- **Browser sign-in** via OIDC/OAuth on the TV, and account sign-up. Code sign-in covers those accounts, because the confirmation happens in the phone's browser.
- **Server discovery on the network** (mDNS): a webOS web app cannot do it; the server address is entered.
