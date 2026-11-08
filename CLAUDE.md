## Projekt

Ein nativer Client für LG-Fernseher mit webOS für den selbst gehosteten Medienserver [Silo](https://github.com/Silo-Server/silo-server). Er soll alles können, was der Silo-Web-Client für Zuschauer kann (Feature-Plan und Phasen: [`docs/roadmap.md`](docs/roadmap.md)). Den Admin-Bereich braucht er nicht.

- **Sprache:** TypeScript. Die App selbst ist React mit Vite. Ein kleiner webOS-JS-Service in Node ist geplant, falls Phase 0 ihn als CORS-Proxy braucht. Die Werkzeuge in `tools/` sind PowerShell.
- **Referenzen** (nur lesen, nie Code ungeprüft übernehmen):
  - `Silo-Server/silo-server`: API-Doku in `docs/*-api.md` und `docs/architecture/`, die OpenAPI-Datei `contracts/api/v2/openapi.json` und der React-Web-Client in `web/src`.
  - `Silo-Server/silo-roku`: Der native Roku-Client. Seine `docs/spec.md` ist die beste Vorlage für Verhalten und Abläufe eines TV-Clients.
  - Beide stehen unter AGPL-3.0-or-later. Übernommener Code macht diese App ebenfalls AGPL.
- **Testserver:** `<Testserver aus CLAUDE.local.md>`. Das ist der echte Server des Nutzers, hinter Cloudflare. Gearbeitet wird mit einem eigenen Dev-Konto ohne Admin-Rechte (siehe *Zugangsdaten*).
- **Testgerät:** ein LG-TV ab Modelljahr 2021 im Entwicklermodus. Der Nutzer richtet es einmalig mit `ares-setup-device` ein; die Passphrase tippt nur er.

## Workflow

- Vor Architekturänderungen oder breiten Umbauten erst planen.
- Bei größeren Codeblöcken (>20 Zeilen) für unveränderte Abschnitte kurze Platzhalter verwenden, z. B. `// ... existing code ...`.
- Änderungen mit den Edit-Werkzeugen umsetzen; Codeblöcke im Text nur, um hypothetische Optionen aufzuzählen.
- Codeblöcke bekommen Sprache und Dateinamen im Info-String.
- Nach jeder abgeschlossenen Umsetzung die passende Verifikation laufen lassen, bevor geantwortet wird.
- Abgeschlossene, verifizierte Arbeit mit Conventional Commits committen.
- `CHANGELOG.md` wird von [git-cliff](https://git-cliff.org) aus den Commit-Messages **generiert**: Konfiguration `cliff.toml`, Helfer `tools/update-changelog.ps1`. **Nie von Hand bearbeiten.**
  - Der Commit-*Subject* wird zur Changelog-Zeile.
  - Ursache, Lösung und Verifikation gehören in den Commit-*Body*.
- Nach jeder abgeschlossenen Aufgabe die nächsten sinnvollen Schritte vorschlagen.
- Keinen Dev-Server und keine App auf dem TV starten, wenn die Aufgabe es nicht braucht.

### Arbeitsteilung: planen und kontrollieren – umsetzen (übernommen aus `core`, Nutzerentscheidung 2026-11-08)

- **Die Hauptsitzung (Opus) plant und kontrolliert. Sie schreibt keinen Produktcode.**
  - Sie klärt die Anforderung und zerlegt sie in Arbeitspakete.
  - Sie prüft das Ergebnis, schreibt Commit-Nachrichten und setzt Tags.
  - Sie pflegt `README.md`, `CLAUDE.md`, `docs/roadmap.md` und das Gedächtnis.
  - Code und Tests gehen als Paket an einen Subagenten, auch kleine Korrekturen aus dem Review und Werkzeugskripte.
- **Umsetzen: Subagent `implementer`** (Sonnet, `.claude/agents/implementer.md`). Ein Paket pro Aufruf, mit
  - Ziel,
  - betroffenen Dateien bzw. Bereichen,
  - Akzeptanzkriterien,
  - den zu schreibenden Tests,
  - den Prüfbefehlen.

  Produktentscheidungen trifft die Hauptsitzung vorher mit dem Nutzer. Ein Paket enthält keine offene Frage, die der Subagent raten müsste.
- **Parallel nur, was keine Dateien teilt.** Gemeinsame Engstellen sind die i18n-JSONs (`src/i18n/*.json`), der generierte API-Client (`src/api/generated/`), `package.json`/`package-lock.json` und `appinfo.json`. Pakete, die sie berühren, laufen nacheinander. Parallele Pakete laufen mit `isolation: "worktree"`; ein Worktree hat kein `node_modules`, also zuerst `npm ci`.
- **Kontrollieren, bevor committet wird.** Die Hauptsitzung
  1. liest den Diff (`git diff`) gegen Paket und Hausregeln;
  2. lässt den Subagenten `mutation-checker` (Sonnet, `.claude/agents/mutation-checker.md`) die neuen Tests mit gezielten Gegenproben prüfen;
  3. führt `tools/verify.ps1` aus;
  4. sieht sichtbare Änderungen an: im Browser bei 1920×1080 mit Tastatur-Navigation, und am Ende einer Phase auf dem TV.

  Befunde gehen als neues Paket zurück an den `implementer`. Committet wird erst, wenn Diff, Gegenproben und Gate stimmen.
- **Subagenten** committen, taggen und pushen nicht. Sie starten keine weiteren Subagenten und berichten nach dem festen Schema ihrer Definition. Der Bericht ist Material, kein Beweis: Was er behauptet, prüft die Hauptsitzung selbst nach.

### Nach JEDER Phase (obligatorisch, in dieser Reihenfolge)

1. **`README.md` und `docs/roadmap.md` prüfen und ggf. aktualisieren.** Das gilt, wenn die Phase Struktur, Setup, Architektur, Testzahlen, Prüfbefehle, Abhängigkeiten oder den Stand eines Features ändert.
2. **Commit mit Conventional Commit.** Format `type(scope): description`, z. B. `feat(player): Intro überspringen`.
   - Der Subject wird zur Changelog-Zeile, deshalb **immer einen Body** schreiben: Ursache, Lösung, Verifikation, bei Phasenende auch das Ergebnis des TV-Tests.
   - Typ → Sektion: `feat`→Added, `fix`→Fixed, `perf`/`refactor`/`docs`/`test`/`chore`/`build`→Changed, `revert`→Removed, `fix(sec…)`/`sec…`→Security.
3. **Versions-Tag setzen und `CHANGELOG.md` generieren.**
   - Ist die Phase eigenständig abgeschlossen: `pwsh tools/update-changelog.ps1 -Tag v0.X.0 -TagMessage "<Kurzbeschreibung>"`.
   - Sonst reicht `pwsh tools/update-changelog.ps1`.
   - Die aktualisierte `CHANGELOG.md` als `docs(changelog): update` mitcommitten.
4. **Nächste Schritte vorschlagen.**
5. **Keine offenen Änderungen mitschleifen.** Vor Beginn der nächsten Phase ist `git status` clean.

## Versioning

- **Schema:** SemVer `0.MINOR.PATCH`, solange das Projekt pre-1.0 ist. MAJOR bleibt `0`, bis der Nutzer die App ausdrücklich für „stabil im Alltag“ erklärt.
- **Bump:** MINOR, wenn die Phase mindestens einen `feat`- oder Breaking-Commit enthält, sonst PATCH.
- **Version in der App:** `appinfo.json` und `package.json` tragen dieselbe Version. Der Tag-Commit hebt beide an.
- **Tags** werden lokal gesetzt. Pushen ist ein eigener, ausdrücklicher Schritt.

## MemPalace (Projektgedächtnis)

Ein lokaler MemPalace-Server hängt als MCP-Server (`palace_query` / `palace_exec`) in dieser Session. Wing dieses Projekts: `wing_silo_lg`. Die Hooks filen Sessions laufend in `sessions`.

- **Vor Aussagen über frühere Entscheidungen** zuerst suchen: `palace_query FIND "…" IN wing_silo_lg LIMIT 5`. Findet sich nichts, das sagen und nichts erfinden.
- **Gefundenes wörtlich zitieren**, nicht paraphrasieren.
- **Bei Widerspruch gewinnt das Repo.** Transkripte konservieren auch verworfene Zwischenstände.
- **Dauerhafte Ergebnisse ablegen** (`palace_exec ADD IN wing_silo_lg/decisions "…"`): Entscheidungen samt Begründung, bestätigte Befunde, Geräte-Erkenntnisse vom TV. Nie Secrets, Tokens oder Zugangsdaten.

## Project State

- Frühe Entwicklung. Es gibt keine veröffentlichte Version und keine fremden Nutzer.
- Breaking Changes an Code, Struktur und gespeicherten App-Daten (`localStorage`) sind erlaubt, wenn sie das Fundament verbessern. Altes Verhalten nur erhalten, wenn der Nutzer es verlangt.
- **Der Silo-Server ist nicht disposable.** Er ist der echte Server des Nutzers. Die App ändert dort nur, was ein Zuschauer selbst ändern darf: Fortschritt, Merkliste, Gesehen-Status, Präferenzen des Dev-Profils. Nie Admin-Endpunkte aufrufen.

## webOS-Plattformregeln

- **Zielplattform: webOS TV 6.0 und neuer** (LG ab 2021). Deren Web-Engine ist Chromium 79; webOS 22 bringt Chromium 87, 23 Chromium 94, 24 Chromium 108.
- **Syntax:** Das Bundle darf keine Syntax enthalten, die Chromium 79 nicht kennt.
  - Vite baut mit `build.target: 'chrome79'`, das senkt `?.`/`??` und Klassenfelder ab.
  - `es-check` prüft das gebaute Bundle im Gate.
- **APIs jünger als Chromium 79** (`Array.prototype.at`, `Object.hasOwn`, `structuredClone`, `String.prototype.replaceAll`, `Promise.any`, `AbortSignal.timeout`, …) nur mit Polyfill aus `core-js`, der zentral in `src/polyfills.ts` importiert wird. Im Zweifel `caniuse` für Chrome 79 prüfen.
- **Keine ES-Module im ausgelieferten HTML.** Eine installierte App läuft unter `file://`, und dort blockiert webOS `<script type="module">`.
  - Der Build erzeugt ein klassisches Skript (IIFE, ein Bundle, kein dynamischer Chunk-Import).
  - Ein Gate-Schritt prüft, dass `dist/index.html` kein `type="module"` enthält.
- **CORS:** Silos `/api/v2` sendet keine CORS-Header. Geprüft am 2026-11-08 gegen `dem Testserver`: `OPTIONS` gibt 405 ohne `Access-Control-Allow-Origin`.
  - Ob webOS das für eine `file://`-App durchsetzt, klärt Phase 0 auf dem TV.
  - Bis dahin läuft jeder API-Aufruf über eine **Transport-Schicht** (`src/api/transport/`), die zwischen direktem `fetch` und dem Luna-Proxy-Service umschalten kann.
  - `<video>`, `<img>` und `<track>` laden direkt; Medien-Elemente unterliegen nicht CORS.
- **Fernbedienung:**
  - Jedes interaktive Element ist mit den Pfeiltasten erreichbar, und OK löst es aus.
  - Zurück (webOS-Keycode 461, im Browser `Escape`/`Backspace`) ist überall definiert.
  - Der Magic-Remote-Zeiger funktioniert zusätzlich, ist aber nie der einzige Weg.
- **Performance auf TV-Hardware:**
  - Lange Reihen und Raster virtualisieren.
  - Bilder in passender Breite anfordern (`poster_width`, `backdrop_width`, …).
  - Kein `backdrop-filter`, keine großen Schatten-Animationen, keine Layout-Animationen; Animation nur über `transform`/`opacity`.
- **Bildschirm:** Das Layout wird für 1920×1080 entworfen und skaliert auf 1280×720. Sicherer Bereich: 5 % Rand.

## Silo-API-Regeln

- **Nur die native API `/api/v2`.** Die Jellyfin-Kompatibilität und `/api/v1` werden nicht benutzt.
- **Jeder API-Aufruf läuft über den generierten Client.** Er wird mit `openapi-typescript` aus der gepinnten Spezifikation `openapi/silo-v2.json` erzeugt, mit `npm run generate:api`.
  - Rohes `fetch` auf API-Endpunkte ist verboten. Einzige Ausnahme ist die Transport-Schicht selbst.
  - Fehlt ein Endpunkt im Client, wird die Spezifikation vom Server neu geholt und der Client neu erzeugt. Das ist ein eigenes Paket, kein Workaround.
- **Header bei jedem Aufruf:**
  - `X-Silo-Device-Id` (stabil pro Installation), `X-Silo-Device-Name`, `X-Silo-Device-Platform: webos`
  - `X-Silo-Client`, `X-Silo-Client-Version`
  - authentifiziert zusätzlich `Authorization: Bearer …`, `X-Profile-Id` und gegebenenfalls `X-Profile-Token`
- **Fehler** sind RFC-9457-Problem-Details.
  - Bei `401 invalid_token` bzw. `token_refresh_required` genau einmal refreshen (Single-Flight: parallele Aufrufe warten auf denselben Refresh) und genau einmal wiederholen.
  - Ein abgelehnter Refresh meldet ab.
  - Bei 503 die Tokens behalten und später erneut versuchen.
- **Medien-URLs sind opak.** Sie werden nie selbst gebaut oder verändert.
  - Braucht ein `<video>` den Token, wird `token=` nur an URLs auf dem Origin des Silo-Servers gehängt, nie an einen Proxy- oder Transcode-Node-Origin.
- **Wiedergabe nur über Protokoll v3:** `capabilities` → `start` → `progress` (alle 10 s, `sequence` steigend) → `DELETE` zum Stoppen, `replan` für Spur- und Qualitätswechsel. Das Geräteprofil (`client_capabilities`, `client_playback_context`) meldet nur, was der TV wirklich kann.
- **Feature-Erkennung statt Annahmen:** Was der Server über Capabilities-Endpunkte anbietet (Requests, Shuffle, Watchlist, Box-Sets, KI-Übersetzung, …), zeigt die App nur, wenn er es anbietet.

## TV-UI-Regeln

- **Aussehen:** Die App sieht aus wie eine Silo-App. Farben und Drei-Balken-Motiv dürfen übernommen werden. **Logo, Wortmarke und Icons von Silo nicht**, außer unverändert auf einem „Mit Silo verbinden“-Hinweis.
- **Name:** Die App braucht einen eigenen Namen (Silo-Markenrichtlinie). Nicht erlaubt sind „Silo …“, „Silo[Wort]“ und „[Wort]Silo“; ein Wortspiel ist erlaubt. Die Beschreibung lautet „ein Client für Silo“. Bis der Nutzer entscheidet, heißt sie im Code und in `appinfo.json` Arbeitstitel `silo-lg`.
- **Text:**
  - UI-Texte gibt es auf Deutsch (mit „du“) und Englisch.
  - Jeder Schlüssel steht in `src/i18n/de.json` und `src/i18n/en.json`.
  - Die Sprache folgt der TV-Sprache.
- **Fokus:** Der fokussierte Zustand ist immer klar sichtbar (Rahmen und Skalierung) und bleibt beim Zurücknavigieren erhalten: Zurück landet auf der Karte, von der man kam.
- **Ladezustände:** Jedes Lade-Skeleton entspricht dem Layout, das es ersetzt (Reihen-Skeleton für Reihen, Raster-Skeleton für Raster).
- **Daten** laufen über React Query. Eine `queryFn` wirft bei Fehlern.

## Zugangsdaten

- **Claude tippt nie Passwörter, Tokens oder API-Keys** in Formulare, Dateien oder Befehle und gibt keine aus.
- **Anmeldung auf dem TV:** per Code/QR (Device-Login). Der Nutzer bestätigt den Code selbst unter `der /activate-Seite des Testservers`.
- **Automatisierte Live-Prüfungen** gegen den Server lesen ihre Zugangsdaten aus `.env.local`. Die Datei ist gitignored, nur der Nutzer füllt sie, und ihr Inhalt wird nie angezeigt. Ohne `.env.local` werden Live-Prüfungen übersprungen, und das wird so gemeldet.
- **TV-Zugang:** Die Geräte-Passphrase des Entwicklermodus gibt nur der Nutzer ein (`ares-setup-device`, `ares-novacom --getkey`).

## Testing Rules

- **Jede neue Regel, jeder Hook, jede Komponente und jedes UI-Verhalten bekommt einen Test, der ohne die Änderung fehlschlagen würde.**
- **Unit- und Komponententests:** Vitest mit React Testing Library und jsdom.
  - Die API wird mit MSW gemockt.
  - Fixtures sind gegen die generierten Typen getippt, sodass eine Spec-Änderung sie brechen lässt.
- **Fokus-Navigation** wird mit Tastaturereignissen getestet: Pfeile, Enter, Zurück.
- **E2E:** Playwright in Chromium bei 1920×1080 gegen den MSW- bzw. Mock-Server.
  - Bedienung nur über die Tastatur, wie mit der Fernbedienung.
  - Kritische Abläufe: Anmelden, Startseite, Detailseite, Wiedergabe starten, Fortschritt melden.
- **Gerätetest am Phasenende** auf dem TV:
  1. installieren, starten;
  2. die Abläufe der Phase durchgehen;
  3. Wiedergabe mit Direct Play und HLS prüfen.

  Das Ergebnis gehört in den Commit-Body des Phasenabschlusses.
- **Live-Prüfungen** gegen `dem Testserver` (`npm run test:live`) sind nur lesend, außer Fortschritt und Stopp einer kurzen Testwiedergabe.

## Verification

`tools/verify.ps1` ist das vollständige Gate. Es führt diese Schritte aus:

1. die eigenen Skripttests (`tools/verify.Tests.ps1`);
2. `tsc --noEmit -p tsconfig.app.json`;
3. ESLint und Prettier-Check;
4. Vitest;
5. Build;
6. die Bundle-Prüfungen (`es-check`, kein `type="module"`);
7. Playwright-E2E;
8. `ares-package` als Paket-Probe.

Am Ende druckt es eine Tabelle mit Dauer und Ergebnis jedes Schritts. Es endet mit einem Exit-Code ungleich 0, sobald ein Schritt weder `ok` noch `skipped` ist. Mit `-Only "<Schritt>"` laufen nur einzelne Schritte.

Schnelle Prüfungen pro Änderung: `npx tsc --noEmit -p tsconfig.app.json`, `npm run lint`, `npx vitest run <pfade>`.
