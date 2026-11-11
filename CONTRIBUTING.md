# Contributing to silo-tv

Thank you for helping. Reports from TVs and webOS versions other than the test TV's are especially useful: the app is tested on webOS 24 and 26 so far, and it targets webOS 6 and newer.

## Reporting a bug or an idea

- Use the [issue forms](https://github.com/Thazzr/silo-tv/issues/new/choose). For a bug they ask for:
  - the TV model, the webOS version and the app version;
  - your Silo server's version;
  - for playback, how it played (direct play or HLS).
- A problem in the Silo server itself belongs to [Silo's issue tracker](https://github.com/Silo-Server/silo-server/issues).
- A security problem never goes into a public issue: see [`SECURITY.md`](SECURITY.md).
- Leave out your server address, account names and tokens. The Info panel's details (route, code, session) are enough.

## Before you write code

- For anything larger than a small fix, open an issue first, so we can agree on the behaviour before you build it.
- Setup, commands, running in the browser and installing on a TV are in [`docs/development.md`](docs/development.md).
- The full house rules are in [`CLAUDE.md`](CLAUDE.md). The ones that matter most:
  - **Everything in the repository is English**, except the German UI texts in `src/i18n/de.json`. Every UI text exists in German (informal "du") and English.
  - **Made for the remote:** every element is reachable with the arrow keys and OK, Back works everywhere, and the focus is always visible.
  - **Old browser engine:** the bundle runs on Chromium 79 (webOS 6). Newer APIs need a polyfill or a fallback.
  - **Silo's API** is used only through the generated client for `/api/v2`, never with a raw `fetch`.
  - **No code from Silo's repositories.** Their code is AGPL-licensed. Read it to understand the behaviour, then write your own.
  - **Nothing personal in the repository:** no server addresses, account names, e-mail addresses or tokens, in files or in commit messages.

## Tests

- Every change comes with tests that fail without it: Vitest and React Testing Library for units and components, Playwright for the flows, all driven by the keyboard like a remote.
- Build the unit under test inside each test, not in a `describe` body. The weekly mutation run only credits code that runs inside a test.
- Run the full gate before you open a pull request: `npm run verify`. CI runs the same gate.

## Commits and pull requests

- Write commits as [Conventional Commits](https://www.conventionalcommits.org), e.g. `fix(player): …`. The subject becomes a line in the changelog; the body says why, how, and how you checked it.
- Sign off every commit (`git commit -s`) to confirm the [Developer Certificate of Origin](https://developercertificate.org/). There is no contributor license agreement.
- Contributions are made under the project's license, the [MPL-2.0](LICENSE).
- Do not edit `CHANGELOG.md`: it is generated from the commits.
- AI-assisted contributions are welcome; this project is itself built with Claude Code. You remain responsible for what you submit, as with any other contribution.

Everyone taking part follows the [code of conduct](CODE_OF_CONDUCT.md).
