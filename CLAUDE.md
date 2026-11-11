## Project

A native client for LG webOS TVs for the self-hosted media server [Silo](https://github.com/Silo-Server/silo-server). It should do everything the Silo web client offers a viewer (feature plan and phases: [`docs/roadmap.md`](docs/roadmap.md)); it does not need the admin area.

- **Language:** TypeScript. The app is React with Vite. A small webOS JS service in Node is planned in case Phase 0 shows it is needed as a CORS proxy. The tooling in `tools/` is PowerShell.
- **Repository language: English.** Everything in the repository is English: docs, code comments, script output, test names, commit messages and the generated changelog (user decision 2026-11-08). The only German in the repository is the app's German translation, `src/i18n/de.json`. Conversation with the user stays German.
- **Public project:** The repository is public, and the app should be as usable for every Silo user as Silo itself. It works with any Silo server.
  - **Nothing user-specific goes into the repository:** no server addresses, account names, e-mail addresses or tokens, neither in files nor in commit messages.
  - Such details live in the git-ignored `CLAUDE.local.md`.
  - Commits use the name `Thazzr` and the GitHub noreply address, both set in this repository's local git config (user decision 2026-11-09; the history was rewritten to that name before it spread).
- **Final goal: publication in the LG Content Store** (user decision 2026-11-08). Every decision is measured against LG's app QA (see *LG Content Store rules*), not just against Developer Mode.
- **Next platform: Samsung Tizen** (user decision 2026-11-08, Phase 6, after the LG release). From Phase 1 on, platform-specific code lives only behind the `Platform` adapter in `src/platform/` (webOS and browser implementations now, Tizen later). Screens, features, the API layer and the playback protocol logic never call webOS globals, Luna or `ares` specifics directly.
- **License:** MPL-2.0 (user decision 2026-11-09, before anything was published; it was AGPL-3.0-or-later until then). File-level copyleft: changed files stay open, and it works in app stores without a contributor licence agreement. The Exhibit A notice stands once in `README.md` next to `LICENSE`, not in every file. New dependencies must be compatible with MPL-2.0 (permissive licences and MPL are; GPL-only code is not).
- **References** (read for behaviour, do not copy code):
  - `Silo-Server/silo-server`: API docs in `docs/*-api.md` and `docs/architecture/`, the OpenAPI file `contracts/api/v2/openapi.json`, and the React web client in `web/src`.
  - `Silo-Server/silo-roku`: the native Roku client. Its `docs/spec.md` is the best reference for how a TV client behaves.
  - Both are AGPL-3.0-or-later and owned by Silo Media L.L.C. **No code is copied from them.** The store build should carry only code this project owns, so that distributing it under LG's store terms cannot conflict with someone else's copyleft. Reading them to understand the API and the behaviour is fine.
- **Test server and dev account:** both are named in `CLAUDE.local.md`. The test server is the user's real server. Work only with the dev account, which has no admin rights, never with the user's main account.
- **Test device:** an LG TV from model year 2021 or later in Developer Mode. The user sets it up once with `ares-setup-device`; only the user types its passphrase.

## Workflow

- Plan before architecture-level changes or broad refactors.
- For larger code blocks (>20 lines), use brief placeholders for unmodified sections, e.g. `// ... existing code ...`.
- Make changes with the edit tools; write code blocks in text only to enumerate hypothetical options.
- Code blocks carry the language and file name in the info string.
- After a completed implementation task, run the relevant verification before answering.
- Commit completed, verified work with Conventional Commits, in English.
- `CHANGELOG.md` is **generated** by [git-cliff](https://git-cliff.org) from the commit messages: config `cliff.toml`, helper `tools/update-changelog.ps1`. **Never edit it by hand.**
  - The commit *subject* becomes the changelog line.
  - Root cause, fix and verification go into the commit *body*.
- After each completed task, suggest the next sensible steps.
- Do not start a dev server or launch the app on the TV unless the task needs it.

### Division of work: plan and review – implement (adopted from `core`, user decision 2026-11-08)

- **The main session (Opus) plans and reviews. It writes no product code.**
  - It clarifies the requirement and splits it into work packages.
  - It reviews the result, writes commit messages and sets tags.
  - It maintains `README.md`, `CLAUDE.md`, `docs/roadmap.md`, `docs/development.md`, `docs/design.md` and the memory.
  - Code and tests go to a subagent as a package, including small review fixes and tooling scripts.
- **Implementation: subagent `implementer`** (Sonnet, `.claude/agents/implementer.md`). One package per call, with
  - the goal,
  - the files or areas involved,
  - the acceptance criteria,
  - the tests to write,
  - the checks to run.

  The main session makes product decisions beforehand, with the user. A package contains no open question the subagent would have to guess.
- **Parallel only what shares no files.** Shared bottlenecks are the i18n JSONs (`src/i18n/*.json`), the generated API client (`src/api/generated/`), `package.json`/`package-lock.json` and `appinfo.json`. Packages that touch them run one after another. Parallel packages run with `isolation: "worktree"`; a worktree has no `node_modules`, so run `npm ci` first.
- **Review before committing.** The main session
  1. reads the diff (`git diff`) against the package and the house rules;
  2. has the subagent `mutation-checker` (Sonnet, `.claude/agents/mutation-checker.md`) check the new tests with targeted counter-tests;
  3. runs `tools/verify.ps1`;
  4. looks at visible changes: in the browser at 1920×1080 with keyboard navigation, and at the end of a phase on the TV.

  Findings go back to the `implementer` as a new package. Commit only when diff, counter-tests and gate agree.
- **Subagents** do not commit, tag or push. They start no other subagents and report in the fixed schema of their definition, in English. A report is material, not proof: the main session verifies what it claims.

### After EVERY phase (mandatory, in this order)

1. **Check `README.md`, `docs/roadmap.md` and `docs/development.md` and update them if needed.** This applies when the phase changes structure, setup, architecture, commands, verification, CI, dependencies or the state of a feature. The README stays short: features, status and links. Setup, commands, TV installation and the checks belong in `docs/development.md`, and test counts in the README's results card, which CI draws.
2. **Commit with a Conventional Commit.** Format `type(scope): description`, e.g. `feat(player): skip intro`.
   - The subject becomes the changelog line, so **always write a body**: root cause, fix, verification, and at the end of a phase the result of the TV test.
   - Type → section: `feat`→Added, `fix`→Fixed, `perf`/`refactor`/`docs`/`test`/`chore`/`build`→Changed, `revert`→Removed, `fix(sec…)`/`sec…`→Security.
3. **Set the version tag and generate `CHANGELOG.md`.**
   - When the phase is complete on its own: `pwsh tools/update-changelog.ps1 -Tag v0.X.0 -TagMessage "<short description>"`.
   - Otherwise `pwsh tools/update-changelog.ps1` is enough.
   - Commit the updated `CHANGELOG.md` as `docs(changelog): update`.
4. **Suggest the next steps.**
5. **Carry nothing over.** Before the next phase starts, `git status` is clean.

## Versioning

- **Scheme:** SemVer `0.MINOR.PATCH` while the project is pre-1.0. MAJOR stays `0` until the user explicitly declares the app stable for everyday use.
- **Bump:** MINOR when the phase contains at least one `feat` or breaking commit, otherwise PATCH.
- **Version in the app:** `appinfo.json` and `package.json` carry the same version. The tag commit raises both.
- **Tags** are set locally. Pushing is a separate, explicit step.

## MemPalace (project memory)

A local MemPalace server is attached to this session as an MCP server (`palace_query` / `palace_exec`). This project's wing is `wing_silo_lg`. Hooks file sessions into `sessions` continuously.

- **Before stating anything about earlier decisions,** search first: `palace_query FIND "…" IN wing_silo_lg LIMIT 5`. If nothing turns up, say so and invent nothing.
- **Quote what you find verbatim**; do not paraphrase.
- **On conflict, the repository wins.** Transcripts also preserve discarded intermediate states.
- **Store lasting results** (`palace_exec ADD IN wing_silo_lg/decisions "…"`): decisions with their reasons, confirmed findings, device findings from the TV. Never secrets, tokens or credentials. The palace is local, so it may name the test server; the repository may not.

## Project State

- Early development. There is no released version and there are no outside users yet.
- Breaking changes to code, structure and stored app data (`localStorage`) are allowed when they improve the foundation. Keep old behaviour only when the user asks for it.
- **The Silo server is not disposable.** It is the user's real server. The app changes only what a viewer may change there: progress, watchlist, watched state, the dev profile's preferences. Never call admin endpoints.

## webOS platform rules

- **Target platform: webOS TV 6.0 and newer** (LG from 2021). Its web engine is Chromium 79; webOS 22 ships Chromium 87, 23 Chromium 94, 24 Chromium 108.
- **Syntax:** The bundle must not contain syntax that Chromium 79 does not know.
  - Vite builds with `build.target: 'chrome79'`, which lowers `?.`/`??` and class fields.
  - `es-check es2019` checks the built bundle in the gate.
- **APIs newer than Chromium 79** (`Array.prototype.at`, `Object.hasOwn`, `structuredClone`, `String.prototype.replaceAll`, `Promise.any`, …) come from `core-js/stable`, imported first in `src/polyfills.ts`. Web APIs that core-js does not cover (e.g. `Intl.DisplayNames`, `AbortSignal.timeout`) must not be used without a check against Chrome 79 and a fallback.
- **No ES modules in the shipped HTML.** An installed app runs under `file://`, and there webOS blocks `<script type="module">` and `crossorigin` loads.
  - The build produces one classic script (IIFE, one bundle, no dynamic chunks) loaded with `defer`.
  - The bundle check fails on `type="module"`, `crossorigin`, absolute paths or more than one JS file.
- **CORS:** Silo's `/api/v2` sends no CORS headers (checked 2026-11-08: `OPTIONS` returns 405 without `Access-Control-Allow-Origin`).
  - **webOS does not enforce CORS for the packaged `file://` app** (TV probe 2026-11-08 on webOS 24 / Chrome 120: simple GET, preflighted GET and POST via fetch and XHR all reached the server). The transport default is therefore `direct`.
  - The **transport layer** (`src/api/transport/`) keeps the JS service as a fallback (launch parameter `transport=service`) until older webOS versions (6, 22, 23) are probed too.
  - `<video>`, `<img>` and `<track>` load directly; media elements are not subject to CORS.
- **Device facts** (first test TV, 2026-11-08): webOS 24, Chrome 120, window 1920×1080 at device pixel ratio 2 on a 3840×2160 panel. The JS service runs on Node v16.20.2 there, and `message.sender` is exactly the app ID. The codec matrix and HDR flags are stored in the project memory; the device profile must read them on each TV, never assume them.
- **Device identifiers are private:** `com.webos.service.config/getConfigs` with wildcards returns the TV's serial number among ~300 keys. The probe may show it on screen for diagnostics, but app code queries only named keys (e.g. `tv.model.supportHDR`, `tv.model.supportDolbyVisionHDR`, `tv.config.supportDolbyTVATMOS`) and never sends device identifiers anywhere.
- **JS service code** (if needed) runs on the TV's own Node.js, which is old on older TVs: plain CommonJS JavaScript, ES2019 at most, no optional chaining.
- **`requiredACG`** (ACG permission groups in `appinfo.json`) is mandatory for the Seller Lounge eligibility check from webOS 27 on, and enforced for every Luna call once present (webOS 26 can enforce it for testing; 25 and lower ignore it). Before the first store submission, `appinfo.json` declares every ACG group the app and its JS service use (`[]` if none), and every new Luna call adds its group in the same change. Until the TV probe has shown which calls we keep, the field stays out.
- **JS service security:** the bundled service may be called by any app on the TV. It only serves our own app (caller check on `message.sender`), only proxies to `/api/v2/`, never to the TV itself or link-local addresses, and never logs headers or bodies.
- **Remote control:**
  - Every interactive element is reachable with the arrow keys and activated with OK.
  - Back (webOS key code 461; `Escape`/`Backspace` in the browser) is defined everywhere.
  - The Magic Remote pointer works too, but is never the only way.
- **Performance on TV hardware:**
  - Virtualize long rows and grids.
  - Request images at a fitting width (`poster_width`, `backdrop_width`, …).
  - No `backdrop-filter`, no large shadow animations, no layout animations; animate only `transform`/`opacity`.
- **Screen:** The layout is designed for 1920×1080 and scales to 1280×720. Safe area: 5 % margin.

## Silo API rules

- **Only the native API `/api/v2`.** The Jellyfin compatibility API and `/api/v1` are not used.
- **Every API call goes through the generated client.** It is generated with `openapi-typescript` from the pinned specification in `openapi/`, with `npm run generate:api`.
  - Raw `fetch` against API endpoints is forbidden. The only exception is the transport layer itself.
  - If an endpoint is missing from the client, fetch the specification from the server again and regenerate the client. That is a package of its own, not a workaround.
- **Headers on every call:**
  - `X-Silo-Device-Id` (stable per installation), `X-Silo-Device-Name`, `X-Silo-Device-Platform: webos`
  - `X-Silo-Client`, `X-Silo-Client-Version`
  - authenticated calls also `Authorization: Bearer …`, `X-Profile-Id` and, where needed, `X-Profile-Token`
- **Errors** are RFC 9457 problem details.
  - On `401 invalid_token` or `token_refresh_required`, refresh exactly once (single flight: parallel calls wait for the same refresh) and retry exactly once.
  - A refused refresh signs the user out.
  - On 503, keep the tokens and try again later.
- **Media URLs are opaque.** Never build or modify one yourself.
  - When a `<video>` needs the token, append `token=` only to URLs on the Silo server's origin, never to a proxy or transcode-node origin.
- **Playback only through protocol v3:** `capabilities` → `start` → `progress` (every 10 s, increasing `sequence`) → `DELETE` to stop, `replan` for track and quality changes. The device profile (`client_capabilities`, `client_playback_context`) reports only what the TV really can do.
- **Feature detection, not assumptions:** what the server offers through its capability endpoints (requests, shuffle, watchlist, box sets, AI translation, …) is shown only when the server offers it.

## TV UI rules

- **Look:** The app looks like a Silo app. Colours and the three-bar motif may be reused. **Silo's logo, wordmark and icons may not**, except unchanged on a "Connect to Silo" hint.
- **Name:** The app needs a name of its own (Silo trademark policy). "Silo …", "Silo[word]" and "[word]Silo" are not allowed; wordplay is. The description reads "a client for Silo". Until the user decides, it is called `silo-tv` (repository Thazzr/silo-tv, app ID `io.github.thazzr.silotv`, fixed before the first store release).
- **Text:**
  - UI text exists in German (informal "du") and English.
  - Every key is in both `src/i18n/de.json` and `src/i18n/en.json`.
  - The language follows the TV's language.
- **Focus:** The focused state is always clearly visible (outline and scale) and is kept when navigating back: Back lands on the card you came from.
- **Loading states:** Every loading skeleton matches the layout it replaces (a row skeleton for rows, a grid skeleton for grids).
- **Data** goes through React Query. A `queryFn` throws on errors.

## LG Content Store rules

From LG's app self-checklist, approval process, Back button, Magic Remote and ACG guides (read 2026-11-08). The full checklist is a download in Seller Lounge; re-read it before every submission, because LG rejects outdated checklist forms.

- **Mandatory for QA:**
  - Every navigation key works: Up/Down/Left/Right, OK, Back (461). All apps must support 5-way navigation **and** the Magic Remote pointer; every screen cursor must be operable.
  - Every object provides a selection (focus/hover) effect, "with NO EXCEPTION".
  - Back on the entry page: on webOS 6+ ask whether to exit (our own popup, then `window.close()`); LG's checklist also expects the Home screen on webOS 23–25 – confirm the exact expectation through the Seller Lounge 1:1 Q&A before submitting. Back on other pages goes to the previous page.
  - The filled-in self-checklist with real test results, uploaded with the submission.
- **Recommended, and adopted here:** 1920×1080 layout; clickable targets at least 75×75 px and text at least 20 px at 1080p; a visual cue while loading; the mouse wheel scrolls lists like a mouse; play/pause keys toggle playback.
- **Submission material:** the `.ipk`, images and screenshots, a UX scenario for the testers, the self-checklist, and – because the app needs a server and an account – a reachable demo Silo server with a reviewer account and legally shareable content.
- **Content and privacy:** nothing that facilitates piracy (Silo itself rules out IPTV and remote streams); no credentials or tokens in source or file names; tokens on the TV are stored as protected as the platform allows.
- **Approval:** pretest, function test and content test; a failed app comes back with a list of issues. Every update after approval goes through approval again, including new ACG groups.

## Credentials

- **Claude never types passwords, tokens or API keys** into forms, files or commands, and never prints any.
- **Sign-in on the TV:** by code/QR (device login). The user confirms the code on the server's `/activate` page, in a browser that is signed in with the dev account. Otherwise the TV gets whichever account that browser is signed in with.
- **Automated live checks** against the server read their credentials from `.env.local`. The file is git-ignored, only the user fills it, and its content is never shown. Without `.env.local`, live checks are skipped, and that is reported.
- **TV access:** Only the user types the Developer Mode device passphrase (`ares-setup-device`, `ares-novacom --getkey`).

## Testing Rules

- **Every new rule, hook, component and UI behaviour gets a test that would fail without it.**
- **Unit and component tests:** Vitest with React Testing Library and jsdom.
  - The API is mocked with MSW.
  - Fixtures are typed against the generated types, so a spec change breaks them.
- **Focus navigation** is tested with keyboard events: arrows, Enter, Back.
- **E2E:** Playwright in Chromium at 1920×1080, loading `dist/index.html` over `file://`, the way the TV loads the app.
  - Operated by keyboard only, like a remote control.
  - Critical flows: sign-in, home, detail page, starting playback, reporting progress.
- **Device test at the end of a phase** on the TV:
  1. install, launch;
  2. walk through the phase's flows;
  3. check playback with direct play and HLS.

  The result belongs in the commit body that closes the phase.
- **Live checks** against the test server are not built yet. When they come (as `npm run test:live`), they are read-only, except progress and stop of a short test playback.
- **Mutation testing** (StrykerJS, weekly in CI, baseline 77 % on the merged score):
  - The unit under test is built and called inside each test, never in a `describe` body. Stryker credits a mutant only to code that runs inside a test, so a build at collection time leaves its mutants uncaught even when the tests check the values.
  - A hardening package that targets surviving mutants proves each kill by running the mutant (a targeted Stryker run or the mutation-checker's definitions), not by test design alone.

## Verification

`tools/verify.ps1` is the full gate. It runs these steps in order:

1. `verify script tests` – its own tests (`tools/verify.Tests.ps1`);
2. `typecheck` – app and tooling configs;
3. `lint` – ESLint and the Prettier check;
4. `unit tests` – Vitest;
5. `build`;
6. `bundle check` – `es-check`, classic script, relative paths, one JS file, matching versions;
7. `e2e` – Playwright;
8. `package` – `ares-package` as a packaging probe.

A failing step stops nothing, except that a failed `build` skips the three steps that need it. At the end it prints a table with each step's time and result, and it exits non-zero as soon as a result is neither `ok` nor `skipped`. `-Only "<step>"` runs single steps; an unknown name exits 2 before anything runs.

Quick checks per change: `npm run typecheck`, `npm run lint`, `npx vitest run <paths>`.
