# Roadmap and features

Goal: the LG TV app should offer everything the Silo web client offers a viewer. The list is derived from the Silo web client (`silo-server/web/src/pages`) and the specification of the official Roku client (`silo-roku/docs/spec.md`, section 3). What the server offers only optionally is shown only when the server reports it through its capabilities.

Status: ⬜ planned · 🟨 built and tested in the browser, not yet checked on the TV · ✅ done and checked on the TV (or, for repository items, done) · ❌ dropped, with the reason

## Phase 0 – Feasibility (target v0.1.0)

Answers the platform questions before any real UI is built. Looks do not matter yet.

- ✅ Project scaffold: Vite, React, TypeScript, ESLint/Prettier, Vitest, Playwright, i18n basics
- ✅ Tooling: `tools/verify.ps1` with self-tests, `tools/update-changelog.ps1`, webOS CLI
- 🟨 Build for webOS 6: one classic script, Chromium 79 syntax, polyfills; `appinfo.json`, placeholder icons (runs on webOS 24; webOS 6 not yet tested on hardware)
- ✅ Install and launch the app on the TV (webOS 24, 2026-11-08)
- ✅ CORS test on the TV: webOS does not enforce CORS for the packaged app, so the app talks to Silo directly; the JS service works as a fallback (Node v16 on webOS 24)
- ✅ Generated API client from Silo's OpenAPI, transport layer, required headers, token refresh
- ✅ Check a server address (`/system/info`, `api_major == 2`)
- ✅ Sign-in by code/QR (device login)
- ✅ One title through playback protocol v3: direct play and HLS, progress every 10 s, stop (TV 2026-11-10 on webOS 26: MKV direct play, HLS remux and transcode through hls.js)
- ✅ Device profile probe: which codecs, containers and HDR formats the TV really supports (probed on webOS 24: H.264, HEVC Main10, VP9, AV1, Dolby Vision 5/8, DTS, E-AC-3); the player builds Silo's device profile from it on every TV (Phase 3)
- ✅ Diagnostics overlay with plan, route and player state, without secrets (replaced in Phase 3 by the player's Info panel)

## Phase 1 – Foundation: server, account, profiles, shell (target v0.2.0)

- ✅ Platform adapter: everything webOS-specific (Luna calls, device info, key codes, exit, launch parameters, secure storage, the player engine) behind one `Platform` interface with a webOS and a browser implementation, so a Samsung Tizen port (Phase 6) adds an adapter instead of touching the app (runs on webOS 24 and 26)
- 🟨 Save several servers and switch between them; each keeps its sign-in
- ✅ Sign in by code/QR (offered first) and by password with an on-screen keyboard; sign out (TV 2026-11-09)
- ✅ Profiles: picker, PIN, child profiles, create a profile (TV 2026-11-10); the PIN entry is centred like the picker and its delete key is a backspace icon
- 🟨 Profile at launch: automatic, every time, after 1 hour, after 12 hours
- 🟨 Switch profile and server (switching the profile checked on the TV, 2026-11-09)
- ✅ App shell with a top bar: Home, Movies, Series, For You, Calendar, Search, avatar menu; For You and Calendar show "Coming soon" until Phase 4 fills them (TV 2026-11-09)
- ✅ Focus navigation with arrows, OK and Back; focus memory; Magic Remote pointer; exit popup on the entry screen (TV 2026-11-09)
- 🟨 Server branding from `GET /api/v2/theme/branding`: the server's name, its mark (icon) in the server list and top bar, its wordmark on the sign-in and server screens, its sign-in background and subtitle, and its accent colour for highlights (only when it stays readable on the dark UI; otherwise the default). The app's own launcher icon stays fixed, because webOS reads it from the package
- 🟨 Loading, empty and error states
- ✅ German and English: following the TV's language (German when the TV is German, otherwise English), or chosen in the app's settings (Automatic, Deutsch, English; stored on the TV) (TV 2026-11-10)

## Phase 2 – Browse (target v0.3.0)

- ✅ Home built from the server's home sections: Continue Watching, Next Up, Recently Added and every other row the admin configures (TV 2026-11-09)
- 🟨 Rows of at most 20 cards plus an "Explore all" card that opens the full, paged page
- 🟨 Library tabs for Movies and Series (the browse grid with its filters checked on the TV, 2026-11-09):
  - Recommended rows
  - Browse grid with sort, filters (genre, decade, content rating, and watch state – unwatched, watched, in progress – when a silent probe shows the server accepts its rules) and an alphabet rail
  - Collections
- 🟨 Tabs and pills switch only on OK or a pointer click, never on focus or hover (TV test 2026-11-09)
- ✅ Search with an on-screen keyboard of our own (TV 2026-11-09) (ä ö ü ß, results while typing): matching box sets first, then people (when the server offers them), then movies, series and episodes (episodes when the server offers them), filtered by All, Movies or Series
- ✅ Movie detail page: hero, description, credit line, external ratings, quality badges (TV 2026-11-09)
- ✅ Series detail page with seasons and episodes, cast, recommendations (TV 2026-11-09)
- 🟨 Similar titles
- ✅ Person page from the cast: portrait, dates, biography and filmography, filtered by All, Movies or Series (TV 2026-11-09)
- 🟨 Box sets: page with the films in release order and "Play" / "Continue" for the first unwatched film; a box set row on movie pages (the row checked on the TV, 2026-11-09)
- 🟨 Long synopses and biographies scroll in the text dialog
- ✅ Smooth scrolling on TV hardware (TV 2026-11-09): memoised rows and cards, artwork prefetched in the direction of travel, arrow keys in rows and grids move by index without the navigation library's layout measuring, permanent compositor layers over large pictures (measured with `npm run tv:profile`)
- ✅ The Magic Remote wheel scrolls lists (LG recommendation): one wheel notch is one Up/Down step everywhere; suspended in the player and the probe (TV 2026-11-09)
- ✅ The Magic Remote pointer moves the focus but never scrolls the page at the screen edge (TV 2026-11-10)
- ⬜ Featured hero carousel, as in Silo's web app, on Home and on the Movies and Series tabs (user decision 2026-11-10):
  - it shows the featured section of the home layout or of the library ("Featured — No. 01", title, meta, synopsis, Play and More Info, a "01 — 09" indicator); a mixed library shows only the tab's kind
  - it turns every 8 s while the focus is elsewhere; Left/Right on the focusable indicator pages, OK pauses
  - in the rows below, the hero shows the focused card as before; the featured section is no longer a row of its own
- 🟨 Profile settings read from the server (effective values, gated by the settings contract), shared by the features below
- 🟨 Trailers & More: local trailers and extras play in the app's player; YouTube videos go to the TV's YouTube app (hand-off verified on webOS 26, 2026-11-10; an embedded YouTube player is not possible from `file://`, YouTube answers error 153)
- 🟨 Theme music on detail pages when the profile turns it on (`ui.theme_music_enabled`, `ui.theme_music_loop`) and the server offers it: quiet, only while the page is on top, stopped at once for the player or any other screen; series use the series' theme (a season's own theme comes later)
- ✅ Title art (logo instead of text) following the profile setting `ui.title_art` (TV 2026-11-10)
- 🟨 Spoiler protection following the profile settings: a blurred preview (ThumbHash, no CSS filter) instead of the still, and a hidden description, for unwatched episodes
- 🟨 AI translation of descriptions when the server offers it: automatic or with a "Translate description" pill, as the server's mode says; the item's description and the shown season's episodes; "Translating…" and "Translated by AI" under the synopsis (detail page only for now)

## Phase 3 – Player (target v0.4.0)

- ✅ Play, resume and start over, following the server's progress; one resume rule everywhere (past 30 s and more than 5 s before the end, also for a rewatch of a played item); Continue Watching and Next Up cards resume directly (TV 2026-11-09)
- ✅ Rewind on resume: Silo's device setting `player.resume_rewind_seconds` (0–30 s, default 7, 0 turns it off) in the app's settings screen (TV 2026-11-09)
- ⬜ Choose version, audio track and subtitle on the detail page beforehand, as pills under the action row like Silo's web app ("Audio Auto: German · EAC3 · 5.1", "Subtitles Auto: …"; a Version pill only when the title has several versions). Audio and subtitle picks are saved as the title's server preferences; the version holds while the page is open (Silo keeps no version preference: the version played last is the next default)
- ✅ Playback core on protocol v3 (TV 2026-11-10 on webOS 26):
  - an engine interface over the video element (a Tizen engine follows in Phase 6), local seeks and `seek_reanchor`, every replan operation with a loop guard, reconnect after network drops, restarts when the server loses the session, progress while paused, pause in the background, the position before the first frame keeps the resume point
  - progress reports go out one at a time: one waits while another is in flight, the newest wins, nothing is retried
  - the controller is split into small modules in `src/playback/session/` (start, progress, stop, replan, recovery), so the features below extend one module each
  - the session stop goes out 2 s after the video is unloaded: on webOS 26 a stop that aborts a stream the media stack still reads makes every later direct-play MKV hang
  - a load that brings neither metadata nor an error within 20 s asks the server for another route
  - implausible times from webOS (INT64_MAX nanoseconds, "unknown") never reach the overlay or the progress report
- ✅ Direct play, HLS remux and transcode verified on the TV (webOS 26, 2026-11-10)
  - HLS plays through hls.js over Media Source Extensions: Silo's transcode playlists use HLS variable substitution (`EXT-X-DEFINE`), which webOS's own HLS player cannot read; direct play stays on the native element
  - 🟨 device profile with H.264, HEVC, VP9, AV1, HDR10, HDR10+, Dolby Vision and multichannel audio, as far as the TV supports them (HDR and Dolby Vision titles still to be checked)
- ✅ Controls (TV 2026-11-10 on webOS 26):
  - overlay that hides after 5 s
  - play/pause, skips by the profile's steps (taps add up), scrubbing at 2–16× by holding or with Rewind/Fast Forward
  - scrub previews from the server's trickplay sheets, chapter marks on the scrubber, intro, recap, credits and previews coloured on the track as in the web player
- ✅ Overlay in the layout of Silo's web player, adapted to the TV (user decision 2026-11-10; TV 2026-11-10):
  - Exit at the top left; a full-width scrubber with the buffer
  - below it the title and the episode line; in the middle skip back, play/pause, skip forward (the next episode joins with Up Next)
  - on the right, menu buttons that open their menu above them: Chapters, a gear for quality and auto-play next, and Info (Audio and Subtitles join with their menus)
  - left out on the TV: volume, marker editing, pop-out, fullscreen
- ✅ Quality menu: Auto plus the plan's qualities with bitrates; a change replans and holds for the current title only (TV 2026-11-10: 720p through hls.js)
- 🟨 A quality change that does not play falls back to the quality before it, at the same position, with a short hint
- ✅ Player polish (user decisions 2026-11-10; TV 2026-11-10 on webOS 26):
  - a menu closes after a successful pick, with the focus back on its button
  - one Info panel in two columns ("Now" and "Source file", with live buffer, bandwidth and dropped frames; limits, server warnings and errors under the source file), also on the blue key; the old diagnostics window is gone; the error page shows short details only (route, code, session)
  - a slim scrub preview card like the web's, without the chapter title
  - the time sits above the scrubber on the right, in a mode chosen in the app's settings: elapsed / total · ends at (default), elapsed / total, remaining, ends at; 12 h or 24 h follows the profile's `ui.time_format`
  - one centred loading view from the start; slightly translucent menus and Info panel
- 🟨 The profile's maximum bitrate and "lower quality when buffering" are honoured by the player
  - 🟨 the maximum bitrate goes with every start and replan, and Info shows it
  - 🟨 a seek during a quality or track change waits for it and lands where the viewer asked
  - 🟨 lower quality when buffering, following Silo's buffering-quality design:
    - in `always` mode, a stall of 6 s or two stalls within 2 minutes lower Auto at once, with a "Restore quality" pill;
    - `ask`, or a quality the viewer picked, asks first ("Lower quality" / "Keep quality");
    - `never` only watches;
    - an outage (no media data at all) is no reason to lower;
    - the prompt and the pill hold the focus for 15 s (user decision 2026-11-11)
    - still to check on the TV: whether webOS reports media data on direct play (`progress` events, a growing buffer)
- ⬜ Audio and subtitle menus: changes during playback (replan) are saved for the series or movie, as in Silo's web client
- ⬜ Search and download subtitles through the server's subtitle providers
- 🟨 Subtitles drawn by the app from WebVTT sidecars, in the profile's appearance (size, colours, background style, position)
- 🟨 Subtitle appearance for this TV in the app's settings, with a live preview: size, font, colours, opacity, background style, outline, position; stored per profile for this TV (`playback.subtitle_appearance` at `profile_device`); Reset returns to the profile's own appearance
- ✅ Skip intro, recap, credits and previews; automatic skipping following the profile settings (TV 2026-11-10)
- ⬜ Up Next for episodes: a card in the corner, opened `playback.next_up_prompt_seconds` before the end, with a countdown to the next episode when `playback.auto_play_next` is on
  - skipping credits that run to the end opens the card at once, with a 10 s countdown
  - an Up Next button on the overlay opens it without a countdown
- ⬜ "Are you still watching?" after `player.passout_threshold` episodes that started on their own without a key press (default 3, 0 never asks). It is kept on the TV only, as Silo's settings contract defines it.
- ⬜ On Deck at the end of a movie and of a series' last episode: Continue Watching and Next Up items, nothing starts on its own
- ⬜ Shuffle for a library, collection, series and season, where the server offers that scope. Silo has no shuffle for box sets or people.
- ⬜ Playback speed and aspect ratio, for the current title only (not possible in the Roku client; on webOS to be probed on the TV first)
- ⬜ Subtitle delay (`player.subtitle_sync_ms`; the renderer already takes an offset); an audio delay is not possible with the webOS video element
- ❌ Sleep timer: dropped (user decision 2026-11-10). LG TVs have a sleep timer of their own, and the progress reported every 10 s keeps the resume point when the TV turns off.

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
- ⬜ Profile settings, in the settings screen that Phase 3 opens with its section "This TV" (user decisions 2026-11-10 and 2026-11-11):
  - every setting Silo's web app offers a viewer that has a meaning on a TV is offered here too, read from the server and written back with the same key and scope; the app behaves as the web app does (rule in `CLAUDE.md`, TV UI rules)
  - the profile sections go above "This TV", each with a note that it applies to the profile on all devices; a change on the TV is written for the whole profile
  - playback: preferred quality, maximum bitrate, lower quality when buffering, skip intros, auto-skip recaps and credits, start next at preview, auto-play next, the video skip intervals
  - language and subtitles: audio and subtitle language, subtitle mode, show forced subtitles, subtitle appearance
  - the settings left out on 2026-11-10, decided again on 2026-11-11:
    - marker confidence and source come in, because they decide what Skip Intro and Skip Credits act on;
    - the audiobook intervals come with audiobooks (Phase 5);
    - browser decoding comes in if it steers anything the TV player has; otherwise it is left out as a browser-only setting, with its reason here;
    - the connection speed test comes in, as an action rather than a setting.
  - interface, home screen, metadata language, profile picker at launch
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
- ✅ License: MPL-2.0 (file-level copyleft that works in app stores; switched from AGPL-3.0 before the first push, 2026-11-09)
- ✅ No server addresses, account names or e-mail addresses in the repository or its history
- ✅ Repository in English (docs, comments, commit messages, changelog)
- ⬜ No code copied from Silo's repositories, so the store build carries only code this project owns
- ✅ CI on GitHub: the gate on every push and pull request, with test counts and coverage in each run's summary and the reports as artifacts
- ✅ Test results on the README: a card with the gate's steps, test counts, coverage and the mutation score, drawn after every CI run on `main` and every mutation run and published on GitHub Pages, so it updates without a commit
- ✅ Development and deployment guide: [`docs/development.md`](development.md)
- ✅ Mutation testing: a weekly StrykerJS run over all app code in 24 parallel shards; the merged report and the score badge are published on GitHub Pages. Baseline from the first full run (2026-11-11): 79.3 % over 15,215 mutants. A run below 77 % fails the workflow.
- ✅ Releases: a version tag publishes a GitHub release with the `.ipk`, its SHA-256, the third-party license notices and notes from git-cliff; only a tag with a pre-release suffix (`-rc.1`) becomes a pre-release (first release v0.3.0, 2026-11-11)
- ✅ Contribution guidelines, issue forms, a pull request template, a security policy with private reporting, a code of conduct and an accessibility statement; contributions under the same MPL-2.0 with a DCO sign-off (no CLA needed for store distribution)
- ⬜ An "About" page in the app's settings: version, licence, link to the source code, and the licence notices of the bundled third-party packages. The notices already ship in the `.ipk` as `THIRD_PARTY_NOTICES.txt` and with each release; the page still has to show them.

LG Content Store:

- ⬜ A name and icon of its own, following the Silo trademark policy; ask the Silo team (trademark@siloserver.org) before submitting
- ⬜ LG QA requirements built in from the start: 5-way navigation and Magic Remote pointer everywhere, a selection effect on every object, exit popup on Back at the entry page, loading cues, 75 px targets and 20 px text at 1080p
- ⬜ `requiredACG` in `appinfo.json` with exactly the ACG groups the app and its service use
- ⬜ JS service secured: callable only by this app, no requests to the TV itself or link-local addresses
- 🟨 Tokens stored as protected as the platform allows; no credentials in source or file names
  - done (2026-11-10): the access token lives in memory only, only the refresh token is stored; HLS through hls.js and subtitle sidecars authenticate with a header instead of `token=` in the URL (direct play keeps it, a media element cannot send headers). TV 2026-11-10: the sign-in survived the update to the new storage format, and a longer HLS session with pause and resume played through
  - open: encrypt the stored refresh token with keymanager3 on webOS 24+ (ACG group `securitykey.operation`), after a TV probe
- ⬜ Seller Lounge account (individual or corporate seller)
- ⬜ Demo Silo server for LG's testers: reachable from the internet, with a reviewer account and legally shareable content (e.g. Blender open movies)
- ⬜ Privacy policy (what the app stores on the TV and sends to the user's own server)
- ⬜ Submission material: screenshots, UX scenario, filled-in self-checklist (always the current form from Seller Lounge)
- ⬜ Device tests on as many webOS versions as possible (6, 22, 23, 24, 25)
- 🟨 For sideloading meanwhile: installing in Developer Mode, from source or from a package that CI built, is described in [`docs/development.md`](development.md#install-it-on-a-tv); the Homebrew Channel is still to describe

## Deliberately not planned

- **Light mode:** the TV app stays dark only, like Silo's own TV apps (user decision 2026-11-08): bright surfaces glare in a dark room and wear OLED panels. Colours remain tokens, so the decision is cheap to revisit.
- **Admin area:** server setup, libraries, users, plugins, metadata editing
- **Collections:** creating or editing them (no Silo TV app offers it)
- **Reading:** e-books, comics, manga, documents
- **Downloads** and offline playback
- **Live TV**, DVR, IPTV: Silo rules these out on principle
- **Browser sign-in** via OIDC/OAuth on the TV, and account sign-up. Code sign-in covers those accounts, because the confirmation happens in the phone's browser.
- **Server discovery on the network** (mDNS): a webOS web app cannot do it; the server address is entered.
