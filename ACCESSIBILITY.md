# Accessibility

silo-tv is a TV app, used from the couch with a remote control. These are the commitments it is built and tested against:

- **The remote is enough.** Every element is reachable with the arrow keys and activated with OK, and Back works everywhere. The Magic Remote pointer and wheel work too, but are never the only way.
- **The focus is always visible:** an outline and a slight enlargement on everything that can be focused, never colour alone. Back returns to the element you came from.
- **Readable from a distance:** text is at least 20 px and click targets at least 75×75 px on the 1080p layout, following LG's recommendations.
- **Contrast:** the interface is dark with light text. A server's accent colour is only used when it keeps a 4.5:1 contrast.
- **Subtitles:** size, font, colours, opacity, background and position can be set per TV, with a live preview.
- **Language:** German and English, following the TV's language or chosen in the app.

## Known limitations

- LG's screen reader ("Audio Guidance") has not been tested with the app yet, so it is not known how well it reads the focused elements.
- There is no high-contrast or light mode. The dark interface is a deliberate decision; the colours are tokens, so a high-contrast variant is possible later.
- Motion is limited to short fades and slight enlargements; there is no setting to turn it off yet.

## Reporting a barrier

If something in the app is hard or impossible to use for you, please [open an issue](https://github.com/Thazzr/silo-tv/issues/new/choose) and describe what you tried, your TV model and how you use it (remote, pointer, screen reader). Barriers are treated as bugs.
