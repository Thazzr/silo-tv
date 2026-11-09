# Design

The app should feel like a Silo app on the TV without using Silo's logo, wordmark or icons (Silo trademark policy: colours and the general look may be reused, the marks may not). The visual language follows Silo's own TV clients: dark, monochrome, content first, with focus shown by light fills and outlines instead of colour. Values below are this project's own tokens; they are not copied code.

All sizes are CSS pixels on the 1920×1080 layout (the TV renders it at device pixel ratio 2 on 4K panels).

## Tokens

| Token | Value | Use |
|---|---|---|
| `--bg` | `#000000` | page background |
| `--surface` | `#0A0A0A` | cards at rest, panels |
| `--surface-raised` | `#15171C` | dialogs, menus, the exit popup |
| `--text` | `#EDEDED` | primary text |
| `--text-secondary` | `rgba(237, 237, 237, 0.6)` | metadata, hints |
| `--hairline` | `rgba(255, 255, 255, 0.12)` | dividers |
| `--chrome` | `rgba(255, 255, 255, 0.07)` fill, `rgba(255, 255, 255, 0.09)` border | pills, chips, inputs at rest |
| `--chrome-selected` | `rgba(255, 255, 255, 0.14)` fill | selected pill or tab |
| `--focus-fill` | `#FFFFFF` with black content | focused buttons and pills |
| `--focus-ring` | 4 px `rgba(255, 255, 255, 0.7)` inside the edge | focused cards |
| `--accent` | none by default; the server's branding accent when it keeps 4.5:1 contrast on `--bg` | small highlights only, never the only focus cue |
| `--error` / `--warning` / `--danger` | `#FF6961` / `#F4C869` / `#FF453A` | messages, sign out |
| `--progress` | fill `#FFFFFF` (or the server accent when it passes the contrast rule) on a track of `rgba(0, 0, 0, 0.6)` with a 1 px `rgba(255, 255, 255, 0.35)` outline, 6 px high, radius 3 px, inset 10 px from the left, right and bottom edge of the artwork | progress on cards and in the player – it must stay visible on bright artwork (TV test 2026-11-09: a 4 px light bar on the edge of bright posters was almost invisible) |
| `--radius-card` | 12 px | cards; 18 px for episode stills |
| `--font` | Inter (OFL), bundled: Regular 400, Medium 500, SemiBold 600, Bold 700 | everything; tabular digits for timecodes |

## Layout

- Safe area: 5 % (96 px left/right, 54 px top/bottom) for anything that must stay visible; full-bleed artwork may extend under it.
- Side inset 88 px for the top bar and the home hero; 80 px for row headers and grids; 100 px on detail pages.
- Poster card 176×264 in rows, 260×390 in browse grids; landscape card 360×200 for Continue Watching and other in-progress rows.
- Card gap 40 px; rows 10 px apart plus 14 px padding above and below each strip.

## Type (px, weight)

- Home hero title 84 (700), meta 20 (500, secondary), synopsis 22 (400, secondary).
- Row title 36 (600); card title 24 (500, 600 when focused); card second line 20 (400).
- Top bar tab 26 (600).
- Detail title 84 (700), metadata 24 (500), synopsis 26 (400), section header 36 (600).
- First-run headline 88 (700), body 28 (400). Profile picker title 64 (700).
- Player title 36 (600), series line 20 (500).
- Nothing below 20 px (LG checklist).

## Focus and interaction

- **Cards:** scale 1.05 on whole pixels, the 4 px inner ring, a soft shadow (black 50 %, 20 px blur, 10 px down). Animate only `transform` and `opacity`, 150 ms ease-out.
- **Buttons and pills:** focused = white fill with black content; scale 1.04 for fields and the sort pill, no scale for others.
- **Page scroll** (detail page): `--scroll-transition`, 400 ms `cubic-bezier(0.33, 1, 0.68, 1)` (ease-out cubic), transform only, the page on its own compositor layer (`will-change: transform`). The focused block's first line sits on the top safe-area line (54 px), measured from the real layout; blocks above it fade out (opacity), so nothing shows half-cut at the top. Once scrolled, the backdrop is dimmed to at least 85 % black across the full width.
- **Every focusable element has a visible focus state and a hover state** (Magic Remote pointer); hover moves focus. Targets are at least 75×75 px.
- **Tabs and pills switch only on activation** (OK or a pointer click), never on focus or hover, for every bar: top bar, library views, seasons. The shown tab keeps a "selected" mark that differs from focus. Down from a focused tab that is not selected enters the content that is shown; coming back up lands on the selected tab (user decision 2026-11-09).
- **Focus memory:** returning to a screen or row restores the item that was focused; Back lands on the card you came from.
- **Back:** goes one step back; on the entry screen it opens the exit popup ("Exit the app?" – Exit / Cancel, Cancel focused), Exit calls `platform.exitApp()`.
- **Loading:** skeletons shaped like the layout they replace; a spinner only inside buttons and the player.

## Branding from the server

`GET /api/v2/theme/branding` may provide a server name, a mark, a wordmark, a sign-in background, a sign-in subtitle and an accent colour. The app shows the mark in the server list and the top bar, the wordmark and background on the server and sign-in screens, and the accent only where it passes the contrast check above. Without branding it shows the server's name (or host) and a neutral initial badge. The app's own launcher icon is fixed in the package and never changes per server.
