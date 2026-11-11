# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and
[Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/). This file is
generated automatically from the commit messages with [git-cliff](https://git-cliff.org) –
**do not edit it by hand**.

## [Unreleased]

### Added

- **build**: Project scaffold and webOS build for Chromium 79
- **tools**: Gate, changelog tool and E2E tests over file://
- **platform**: Luna bridge, device and media probes, JS proxy service
- **probe**: TV probe screen, CORS probe and tv-eval tool
- **api**: Generated Silo client, transport layer and token refresh
- **app**: Server check, device-code sign-in, profile picker, first title list
- **playback**: Test playback through Silo playback protocol v3
- **nav**: Spatial navigation, screen stack with focus memory, exit popup, design tokens
- **shell**: Top bar with tabs, avatar menu and server branding
- **servers**: Several servers with their own sign-in, server list, password sign-in
- **profiles**: Profile picker with avatars, kids profiles, create profile, profile at launch
- **shell**: Confirm sign-out from the avatar menu
- **home**: Server home sections as rows of cards with a hero
- **detail**: Detail pages for movies and series with seasons and episodes
- **library**: Movies and Series tabs with recommended rows, browse, filters, alphabet and collections
- **player**: Resume rewatches, resume Continue Watching directly, rewind on resume
- **person**: Person pages with filmography; long texts scroll in the text dialog
- **boxset**: Box set pages, a box set row on movie pages, and box set cards
- **search**: Search tab with an on-screen keyboard, box sets, people and episodes
- **nav**: The Magic Remote wheel scrolls lists
- **library**: Content-rating filter in Browse
- **library**: Watch-state filter in Browse, behind a server probe
- **settings**: Read the profile's effective settings; title art follows ui.title_art
- **spoilers**: Hide unwatched episodes' stills and descriptions when the profile asks
- **detail**: Trailers & More with local extras and a YouTube hand-off
- **detail**: Theme music on detail pages when the profile turns it on
- **detail**: AI translation of descriptions on detail pages
- **settings**: Typed profile settings for the player
- **player**: Playback core for the full player
- **player**: On-screen controls, skips and scrubbing with the remote
- **player**: Scrub previews from trickplay and chapter marks
- **player**: Skip intro, recap and credits
- **player**: Subtitles drawn by the app in the profile's appearance
- **player**: Options panel with info, quality, auto-play next and chapters
- **player**: Overlay in the layout of Silo's web player
- **player**: Fall back to the previous quality when a change does not play
- **player**: Two-column info, a clock above the scrubber and an app language setting
- **settings**: Subtitle appearance for this TV, with a live preview
- **player**: Honour the profile's bitrate cap and keep a seek made during a replan
- **player**: Lower the quality when playback keeps buffering

### Changed

- Adopt the development process from core and add the roadmap
- **claude**: Set permissions for project commands
- **claude**: Record the dev account
- **claude**: Restrict package installs and git output options
- Remove user-specific details from the repository
- AGPL-3.0-or-later license and release goals
- Switch the repository language to English
- Make the LG Content Store the final goal
- Record the first TV probe results
- Plan a Samsung Tizen port after the LG release
- **roadmap**: Phase 0 built, waiting for the TV device test
- **platform**: Put everything webOS-specific behind a Platform adapter
- Rename the working title to silo-tv and the app ID to io.github.thazzr.silotv
- **roadmap**: Keep the TV app dark only
- Phase 1 built, waiting for the TV device test
- Phase 2 state and the resume plan
- **e2e**: Detail page scrolls up without native scrolling; long season rows stay visible
- **detail**: Permanent compositor layers over the backdrop; even scroll up and down
- **api**: Person and box-set operations in the generated client
- **media**: Rows and grids redraw only what a focus move changes; artwork arrives before it is seen
- **tools**: CPU profiles from the TV and a readable profiling build
- **nav**: Arrow keys in rows and grids move by index; DOM focus never scrolls on its own
- Phase 2 search, person pages, box sets and TV performance in the roadmap
- **api**: Settings, theme music, AI translation and capability operations
- **license**: Relicense under MPL-2.0
- **repo**: No machine-specific paths in the repository
- Phase 2 state after filters, title art, spoilers and Trailers & More
- Phase 2 built; theme music and AI translation in the roadmap
- **readme**: Screenshots and a fuller README; commits under the name Thazzr
- **gitignore**: Ignore the Playwright MCP browser output
- **api**: Trickplay, audio and subtitle preferences, subtitle search, shuffles
- **lint**: Ignore agent worktrees and Playwright MCP output
- **roadmap**: Phase 3 state after the playback core, controls, skips and subtitles
- **roadmap**: Decisions for the rest of Phase 3
- **roadmap**: Player overlay in the layout of Silo's web player
- README and roadmap after the TV tests of the player
- **player**: Split the playback controller into modules
- **security**: Pin the refresh edge cases and the progress single flight
- README and roadmap after the player polish, the controller split and the token changes
- **player**: Unit tests for the session modules
- **roadmap**: The player polish, the language choice and the token changes pass the TV test
- **e2e**: Wait for the state the next key needs, so the suite holds on slow machines
- CI and mutation score badges, how the quality checks can be verified
- **tools**: Keep the CI job's summary and outputs out of the baseline CLI tests
- **playback**: Pin the device profile, image prefetch and service transport row by row
- A shorter README with live test results, and a development guide for everything else
- **readme**: Give the feature table a header row

### Fixed

- **player**: Diagnostics overlay readable on the TV
- **ui**: TV test findings: tabs switch on OK only, visible progress bars, a steady detail page
- **detail**: The hero holds tall content, blocks snap to measured tops, smoother scroll
- **detail**: Softer page scroll on the TV
- **nav**: The Magic Remote pointer moves the focus but never scrolls
- **home**: Rows load at once; API requests give up after 30 s
- **player**: Stop the session only after the video is unloaded
- **player**: Play HLS with hls.js, so transcodes play on webOS
- **profiles**: Centre the PIN entry and show a backspace key
- **library**: The filter panel moves the focus to the first facet when it arrives late
- **settings**: Keep newer subtitle edits over a late reset and retry failed saves

### Security

- **sec-service**: Restrict the JS proxy service to this app and safe targets
- **security**: Keep the access token in memory and out of HLS and subtitle URLs

### Merge

- Bring the silo-tv rename from main into phase-1


