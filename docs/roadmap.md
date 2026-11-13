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
- ✅ Save several servers and switch between them; each keeps its sign-in (TV 2026-11-11)
- ✅ Sign in by code/QR (offered first) and by password with an on-screen keyboard; sign out (TV 2026-11-09)
- ✅ Profiles: picker, PIN, child profiles, create a profile (TV 2026-11-10); the PIN entry is centred like the picker and its delete key is a backspace icon
- 🟨 A profile whose PIN proof the server no longer accepts (its PIN changed or was set elsewhere, the login ended) is locked again and the picker shows, as in the web app
- ✅ Profile at launch: automatic, every time, after 1 hour, after 12 hours (TV 2026-11-11)
- ✅ Switch profile and server (the profile switch on the TV 2026-11-09, both 2026-11-11)
- ✅ App shell with a top bar: Home, Movies, Series, For You, Calendar, Search, avatar menu; For You and Calendar show "Coming soon" until Phase 4 fills them (TV 2026-11-09)
- 🟨 The top bar floats over the content (user decision 2026-11-12): no band, the hero picture reaches the top edge, a gradient keeps the tabs readable (4.5:1 over white); the bar leaves with the content when it scrolls or goes into its rows and comes back at the top, on key focus, or with the pointer in the top edge
- ✅ Focus navigation with arrows, OK and Back; focus memory; Magic Remote pointer; exit popup on the entry screen (TV 2026-11-09)
- ✅ Server branding from `GET /api/v2/theme/branding`: the server's name, its mark (icon) in the server list and top bar, its wordmark on the sign-in and server screens, its sign-in background and subtitle, and its accent colour for highlights (only when it stays readable on the dark UI; otherwise the default). The app's own launcher icon stays fixed, because webOS reads it from the package (TV 2026-11-11)
- 🟨 Loading, empty and error states
- ✅ German and English: following the TV's language (German when the TV is German, otherwise English), or chosen in the app's settings (Automatic, Deutsch, English; stored on the TV) (TV 2026-11-10)

## Phase 2 – Browse (target v0.3.0)

- ✅ Home built from the server's home sections: Continue Watching, Next Up, Recently Added and every other row the admin configures (TV 2026-11-09)
- 🟨 Rows and cards as in Silo's web app: wide cards for Continue Watching and Next Up with the episode and time-left lines under them, posters with the title and the year ("1997 SERIE") in every other row, the web's sizes; the focused row stays inside the safe area
- 🟨 A card a row above already shows is dropped from a lower row, for the section types the server's recipe catalogue marks (`avoid_duplicates`), as the web app does; on Home and in the library's Recommended view
- 🟨 Row titles in the viewer's language: the server's built-in sections carry a title key, which the app shows in German as the web app does ("Diese Woche im Trend"); a title an admin typed shows as typed
- 🟨 Rows of at most 20 cards plus an "Explore all" card that opens the full, paged page
- 🟨 Library tabs for Movies and Series (the browse grid with its filters checked on the TV, 2026-11-09):
  - Recommended rows
  - Browse grid with sort, filters (genre, decade, content rating, and watch state – unwatched, watched, in progress – when a silent probe shows the server accepts its rules) and an alphabet rail
  - Collections
- ✅ Tabs and pills switch only on OK or a pointer click, never on focus or hover (TV 2026-11-09, again 2026-11-11)
- ✅ Search with an on-screen keyboard of our own (TV 2026-11-09) (ä ö ü ß, results while typing): matching box sets first, then people (when the server offers them), then movies, series and episodes (episodes when the server offers them), filtered by All, Movies or Series
- ✅ Movie detail page: hero, description, credit line, external ratings, quality badges (TV 2026-11-09)
- ✅ Series detail page with seasons and episodes, cast, recommendations (TV 2026-11-09)
- 🟨 Detail pages like Silo's web app (user decisions 2026-11-11, after measuring the web pages as a viewer). Order: after the player redesign; the missing API paths (watched, favorites, watchlist, ratings, not interested) come first in a package of their own:
  - 🟨 their own season and episode pages, as in the web app; OK on a season or episode card opens its page (also on Home, in search and in the library; Continue Watching and Next Up still play at once), and the remote's Play key plays from the card
  - 🟨 the hero of movie and series pages: poster (not on episode pages), the kicker line ("Series · AMC", "Movie · Studio"), title art or text, tagline, chips (years, rating, seasons and episodes, or runtime and air date), quality badges, ratings as text, the synopsis with More, the credit line with creator, director or writers and the genres; a breadcrumb on season and episode pages
  - TMDB's rating stays text; its logo only if TMDB's terms allow it, checked before the store submission
  - 🟨 the primary button as in the web app: "Start from Episode 1", "Play Next", "Resume", "Play First Episode", "Play Episode"; with progress, one Play button with a progress fill that asks "Resume playback?" (resume or start over), replacing the Resume and Start over pair
  - 🟨 the actions: mark watched or unwatched, favourite, a star rating (one focus stop: OK starts, Left/Right picks 1–5, OK saves, Back cancels, the set star again clears it), and a More menu with watchlist, not interested, mark unwatched and start over (shuffle joins with Shuffle)
  - 🟨 the series page: a row of season posters with the watched check and progress, specials first (a series with one season lists its episodes directly); the season page: a grid of its episodes (still, "S01E01 · Title", date and runtime, three lines of synopsis)
  - 🟨 the episode page: the still as the backdrop, "Series › Season 1 › Episode 3", runtime and air date with the quality badges, "Play Episode", and "More Episodes" with the current one marked (a sibling's page starts on its card in that row)
  - 🟨 cast and crew: on movies and series one row with the creator or director first, then the writers, then the cast, with group labels, as in the web app; on seasons and episodes a cast row and a crew row of person cards (directors, writers, producers, each person once with all their jobs)
  - 🟨 the sections in the web app's order per page type, with local extras (one row per kind) and "Trailers & More" (YouTube) as two sections; Down and Up walk them block by block
  - 🟨 quality and audio badges on cards, following the profile's card overlay settings (`ui.card_overlays`, `ui.card_overlays_enabled`) or the server's defaults, at most three per corner, with the web's icons where its style shows them; the watch status in the top right (a check, or the episodes left); the web's 16 px card radius
  - left out: media locations (curators only in the web app), download, marker editing, adding to a collection (see *Deliberately not planned*); Watch Party comes in Phase 5
- 🟨 Similar titles
- ✅ Person page from the cast: portrait, dates, biography and filmography, filtered by All, Movies or Series (TV 2026-11-09)
- ✅ Box sets: page with the films in release order and "Play" / "Continue" for the first unwatched film; a box set row on movie pages (the row on the TV 2026-11-09, the page 2026-11-11)
- ✅ Long synopses and biographies scroll in the text dialog (TV 2026-11-11)
- ✅ Smooth scrolling on TV hardware (TV 2026-11-09): memoised rows and cards, artwork prefetched in the direction of travel, arrow keys in rows and grids move by index without the navigation library's layout measuring, permanent compositor layers over large pictures (measured with `npm run tv:profile`)
- ✅ The Magic Remote wheel scrolls lists (LG recommendation): one wheel notch is one Up/Down step everywhere; suspended in the player and the probe (TV 2026-11-09)
- ✅ The Magic Remote pointer moves the focus but never scrolls the page at the screen edge (TV 2026-11-10)
- 🟨 Featured hero carousel, as in Silo's web app, on Home and on the Movies and Series tabs (user decision 2026-11-10):
  - it shows the featured section of the home layout or of the library (the title as text, meta, synopsis, Play and More Info, a "01 — 10" indicator; no "Featured — No. 01" line, as the web app shows it on 2026-11-12); a mixed library shows only the tab's kind
  - it turns every 8 s while the focus is elsewhere; Left/Right on the focusable indicator pages, OK pauses
  - in the rows below, the hero shows the focused card as before; the featured section is no longer a row of its own
- ✅ Profile settings read from the server (effective values, gated by the settings contract), shared by the features below (TV 2026-11-11)
- ✅ Trailers & More: local trailers and extras play in the app's player (since the detail pages follow the web app, in an "Extras" section of their own); YouTube videos go to the TV's YouTube app (hand-off verified on webOS 26, 2026-11-10; an embedded YouTube player is not possible from `file://`, YouTube answers error 153; TV 2026-11-11)
- ✅ Theme music on detail pages when the profile turns it on (`ui.theme_music_enabled`, `ui.theme_music_loop`) and the server offers it: quiet, only while the page is on top, stopped at once for the player or any other screen; series use the series' theme (a season's own theme comes later) (TV 2026-11-11)
- ✅ Title art (logo instead of text) following the profile setting `ui.title_art` (TV 2026-11-10)
- ✅ Spoiler protection following the profile settings: a blurred preview (ThumbHash, no CSS filter) instead of the still, and a hidden description, for unwatched episodes (TV 2026-11-11)
- 🟨 AI translation of descriptions when the server offers it: automatic or with a "Translate description" pill, as the server's mode says; the item's description and the shown season's episodes; "Translating…" and "Translated by AI" under the synopsis (detail page only for now)

## Phase 3 – Player (target v0.4.0)

- ✅ Play, resume and start over, following the server's progress; one resume rule everywhere (past 30 s and more than 5 s before the end, also for a rewatch of a played item); Continue Watching and Next Up cards resume directly (TV 2026-11-09)
- ✅ Rewind on resume: Silo's device setting `player.resume_rewind_seconds` (0–30 s, default 7, 0 turns it off) in the app's settings screen (TV 2026-11-09)
- 🟨 Choose version, audio track and subtitle on the detail page beforehand, as pills under the action row like Silo's web app ("Audio Auto: German · EAC3 · 5.1", "Subtitles Auto: …"; a Version pill only when the title has several versions). Audio and subtitle picks are saved as the title's server preferences; the version holds while the page is open (Silo keeps no version preference: the version played last is the next default)
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
  - below it the title and the episode line; in the middle skip back, play/pause, skip forward (previous and next episode joined with the redesign below)
  - on the right, menu buttons that open their menu above them: Audio, Chapters, Subtitles, a gear for quality, and Info (auto-play next moved to the settings with the redesign below)
  - left out on the TV: volume, marker editing, pop-out, fullscreen
- ✅ Quality menu: Auto plus the plan's qualities with bitrates; a change replans and holds for the current title only (TV 2026-11-10: 720p through hls.js)
- 🟨 A quality change that does not play falls back to the quality before it, at the same position, with a short hint
- ✅ Player polish (user decisions 2026-11-10; TV 2026-11-10 on webOS 26):
  - a menu closes after a successful pick, with the focus back on its button
  - one Info panel in two columns ("Now" and "Source file", with live buffer, bandwidth and dropped frames; limits, server warnings and errors under the source file), also on the blue key; the old diagnostics window is gone; the error page shows short details only (route, code, session)
  - a slim scrub preview card like the web's, without the chapter title (replaced by the web's own card in the redesign below)
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
- 🟨 Audio and subtitle menus: changes during playback (replan) are saved for the series or movie, as in Silo's web client; a subtitle no route can show is refused with a note, and the old picture plays on. Audio shows from two tracks on: the web player shows it dimmed with one track, but on a TV a button that does nothing would be a dead focus stop
- ⬜ Search and download subtitles through the server's subtitle providers
- 🟨 Subtitles drawn by the app from WebVTT sidecars, in the profile's appearance (size, colours, background style, position)
- 🟨 Subtitle appearance as Silo's web dialog (user decision 2026-11-11, replacing the TV-only page of 2026-11-10): size, font, colours, opacity, outline, background style, colour and opacity, position, with a live preview; each change is saved at once for the profile on all devices (`playback.subtitle_appearance` at `profile`; this TV's own value is dropped, as the web app does), and "Use fallback style" returns to the server's default; opened from "Appearance…" in the player's Subtitles menu and from the settings' Playback section
- ✅ Skip intro, recap, credits and previews; automatic skipping following the profile settings (TV 2026-11-10)
- 🟨 "Als Nächstes" as Silo's web player does it (user decision 2026-11-12, after checking the web live; it replaces the earlier corner-card plan):
  - a card bottom right at the credits (or the preview, with `playback.auto_play_next_preview`): "Als Nächstes in N Sek.", Play now and Cancel; after 10 s the next episode starts and the rest of the credits is skipped. With `playback.auto_play_next` off the card waits without a countdown, and while it is open the end screen does not come by time (both differ from the web, see below)
  - for series episodes the end screen 30 s before the end: the finishing episode keeps playing in a mini player on the left (OK returns to the full picture; the end of the episode brings the screen back), and one column on the right with the next episode, Play now with a countdown that starts once the video has ended, the Autoplay switch (`playback.auto_play_next` for the profile), Close, and "Laufend", the titles of the profile's watch progress (`/api/v2/progress`, as the web reads it) without the current series; after the last episode the finished state
  - a movie ends on its page, as on the web
- 🟨 Still watching: after `player.passout_threshold` automatic starts in a row (default 3, 0 never; kept on this TV only, as Silo's settings contract defines it, and set in the settings) the card and the end screen wait without a countdown; any start the viewer makes resets the count. Like the web, no question pops up.
- ⬜ Shuffle for a library, collection, series and season, where the server offers that scope. Silo has no shuffle for box sets or people.
- ❌ Playback speed: dropped (user decision 2026-11-11). On the TV, direct play through the native video element accepts a new speed but then stutters at about half speed with no sound (TV probe 2026-11-11, webOS 26: 1.5× measured 0.49×, 0.5× measured 0.27×). A difference from the web app's speed slider that the TV forces.
- ❌ Aspect ratio (fit, fill, stretch): dropped (user decision 2026-11-11). Not needed on the TV, where the picture fills the screen as the TV's own settings say.
- 🟨 Subtitle delay in the Subtitles menu (`player.subtitle_sync_ms`, ±100 ms per press up to ±10 s, saved 600 ms after the last press for the profile, as Silo's web client does); an audio delay is not possible with the webOS video element
- 🟨 Start subtitles from the profile's subtitle settings (mode, language, show forced subtitles) exactly as Silo's web app resolves them; with Silo's default settings that is the forced track in the playing audio's language, which also follows an audio change until the viewer picks a subtitle (user decisions 2026-11-11). Bitmap subtitles count as burned in on the TV, which cannot draw them, so a text track wins where the web player would draw PGS itself
- 🟨 Player redesign after Silo's web player (user decisions 2026-11-11, after the TV test of v0.3.0 found the bar bulky; the time keeps its place above the scrubber):
  - 🟨 a slimmer bar with Lucide icons, the web's order (previous episode, back, play, forward, next episode in the middle; icon-only Audio, Chapters, Subtitles with a dot while one plays, a quality pill and Info on the right), and the web player's seek bar and preview card: fine chapter ticks only when the file has chapters, intro, recap, credits and preview tinted on the track with the one under the preview time raised as a pill, and a card with the thumbnail, the time, the chapter and the segment with its range
  - 🟨 previous and next episode as the web player finds them (the current and the next season, playable episodes only; Next crosses into the next season); a press stops the session and opens the episode in the player's place, so Back goes where it would have gone
  - 🟨 the menus like the web player's: audio rows with codec, channel and default badges and a detail line (the active track in blue); subtitle rows with format and source badges and the label line, in the web's source order; the subtitle delay in one row (−, value, +, Reset); chapters with the server's thumbnails; the gear with quality and bitrates only; the clock hides while a menu is open, since the menus open over it
  - 🟨 "Auto-play next episode" left the gear for the settings screen, in a new profile section "Playback": the web player has no toggle for it; it is saved for the profile, and this TV's own value is dropped, as the web app does
  - 🟨 the subtitle appearance as the web's dialog, saved for the profile on all devices as the web app does
- ❌ Sleep timer: dropped (user decision 2026-11-10). LG TVs have a sleep timer of their own, and the progress reported every 10 s keeps the resume point when the TV turns off.

## Phase 4 – Personal and discovery (target v0.5.0)

- ⬜ "For You" with the server's recommendation rows
- ⬜ Calendar: one week of releases and airings for followed, trending or all titles
- ⬜ Watchlist, favorites and history pages, each with removal (marking watched, favourites, ratings and the watchlist on the detail page come with the detail pages in Phase 2)
- ⬜ Requests, when the server offers them:
  - Discover rows
  - request, cancel, notify me
  - My Requests
  - request search for missing titles
- ⬜ Profile settings, in the settings screen that Phase 3 opens with its section "This TV" (user decisions 2026-11-10 and 2026-11-11):
  - every setting Silo's web app offers a viewer that has a meaning on a TV is offered here too, read from the server and written back with the same key and scope; the app behaves as the web app does (rule in `CLAUDE.md`, TV UI rules)
  - the profile sections go above "This TV", each with a note that it applies to the profile on all devices; a change on the TV is written for the whole profile
  - playback: preferred quality, maximum bitrate, lower quality when buffering, skip intros, auto-skip recaps and credits, start next at preview, the video skip intervals (auto-play next is already there, see the player redesign)
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
- ✅ For sideloading meanwhile: [`docs/install.md`](install.md) walks users through Developer Mode and installing a release with webOS Dev Manager, without a command line, including how to keep Developer Mode from expiring; installing from source is in [`docs/development.md`](development.md#install-it-on-a-tv)

## Where the TV differs from Silo's web app

The app follows the web app wherever a TV allows it (user decision 2026-11-11). These differences are forced by the remote, the distance or the TV's engine:

- **A top bar, not a sidebar:** the web navigates through a left sidebar; the TV keeps its tabs in a bar that floats over the top of the content and leaves with it, since a remote reaches a row of tabs above the content in one press.
- **No hover:** cards have no play disc and no More button (whether a remote key should offer the web's card actions is still open); OK on a card opens its page and the remote's Play key plays it. Rows have no scroll arrows; the focus moves them.
- **Popovers become list dialogs** with 75 px rows (the More menu, the resume question, later the track pickers); Back closes them.
- **"Alle entdecken" is the last card of a row**, not a link beside the row title: a header link would need a focus stop of its own in every row.
- **Breadcrumbs are text:** Back is the way back, so the crumbs on season and episode pages are not focusable.
- **Episode hops do not stack:** moving from an episode to another one of its season through "Weitere Folgen" replaces the page, so one Back leaves the walk and lands on the last episode viewed. The web keeps each hop in the browser history, but a remote has no breadcrumb to jump up with (user, 2026-11-12).
- **The episode grid scrolls** inside the page instead of showing at most four rows first; a long season stays one grid.
- **The cover stands beside the title block**, as tall as it, and the synopsis, credits and buttons run below at full width (user decision 2026-11-12). The web bottom-aligns the poster with a narrow text column, which on a TV hero that cannot scroll left the cover far below the title.
- **A movie's synopsis is cut to the lines that fit** (at most six, at least two, the rest under "Mehr"): the web shows a movie's whole overview and lets the page scroll, but on the TV the hero's buttons and pills must stay on screen. Series, seasons and episodes keep the web's three lines.
- **The crew of a season or an episode is a row of cards** under the cast, not the web's text box with a line of names per job: cards are the one pattern the arrows walk everywhere, and the box's sideways-scrolling lines of text were the only exception (user decision 2026-11-13). The jobs and names are the web's.
- **The credits card follows "Auto-play next episode"** (user decision 2026-11-13): with the setting off it waits for the viewer without a countdown, as the setting promises and Silo's Roku app does; the web's card counts down either way.
- **The credits card keeps the screen while it is open** (user decision 2026-11-13): when the last 30 s begin under the card, the end screen comes only at the end of the episode; the web's end screen cancels the card.
- **Translation of episode overviews** starts from the translate pill in the action row, not from a chip in the grid's heading.
- **Sizes:** text is at least 20 px and targets at least 75 px at 1080p, so captions, badges and chips are larger than the web's, and section headings keep the app's TV type scale.
- **No blur or filters:** glass surfaces are opaque; spoiler protection blurs with a ThumbHash picture instead of a CSS filter.
- **Card badges in one look:** the profile's badge style (classic, pill, plate, …) only decides whether a badge shows its icon; every badge is drawn in one style with 20 px text. Brand wordmarks (Dolby Vision, Dolby Atmos, HDR10, AV1) stay text, because the app's icons come from Lucide only.
- **Playback speed** is left out (see Phase 3): the TV's video element cannot play at another speed cleanly.

## Deliberately not planned

- **Light mode:** the TV app stays dark only, like Silo's own TV apps (user decision 2026-11-08): bright surfaces glare in a dark room and wear OLED panels. Colours remain tokens, so the decision is cheap to revisit.
- **Admin area:** server setup, libraries, users, plugins, metadata editing, media locations (the web app shows file paths to curators only)
- **Collections:** creating or editing them (no Silo TV app offers it)
- **Reading:** e-books, comics, manga, documents
- **Downloads** and offline playback
- **Live TV**, DVR, IPTV: Silo rules these out on principle
- **Browser sign-in** via OIDC/OAuth on the TV, and account sign-up. Code sign-in covers those accounts, because the confirmation happens in the phone's browser.
- **Server discovery on the network** (mDNS): a webOS web app cannot do it; the server address is entered.
