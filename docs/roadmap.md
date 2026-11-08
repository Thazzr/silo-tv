# Fahrplan und Features

Ziel: Auf dem LG-TV soll alles gehen, was der Silo-Web-Client einem Zuschauer bietet. Die Liste ist aus dem Silo-Web-Client (`silo-server/web/src/pages`) und der Spezifikation des offiziellen Roku-Clients (`silo-roku/docs/spec.md`, Abschnitt 3) abgeleitet. Was der Server nur optional anbietet, zeigt die App nur, wenn er es über seine Capabilities meldet.

Status: ⬜ geplant · 🟨 in Arbeit · ✅ fertig und auf dem TV geprüft

## Phase 0 – Machbarkeit (Ziel v0.1.0)

Beantwortet die Plattformfragen, bevor UI gebaut wird. Das Aussehen ist hier noch egal.

- ⬜ Projektgerüst: Vite, React, TypeScript, ESLint/Prettier, Vitest, Playwright, i18n-Grundgerüst
- ⬜ Werkzeuge: `tools/verify.ps1` mit Selbsttest, `tools/update-changelog.ps1`, webOS-CLI
- ⬜ Build für webOS 6: ein klassisches Skript, Chromium-79-Syntax, Polyfills; `appinfo.json`, Icons mit Arbeitstitel
- ⬜ App auf den TV installieren und starten
- ⬜ CORS-Test auf dem TV: direktes `fetch` gegen `/api/v2`, sonst ein Luna-JS-Service als Proxy. Danach fällt die Entscheidung.
- ⬜ Generierter API-Client aus Silos OpenAPI, Transport-Schicht, Pflicht-Header, Token-Refresh
- ⬜ Server-URL prüfen (`/system/info`, `api_major == 2`)
- ⬜ Anmeldung per Code/QR (Device-Login)
- ⬜ Ein Titel per Wiedergabeprotokoll v3: Direct Play und HLS, Fortschritt alle 10 s, Stopp
- ⬜ Geräteprofil-Probe: welche Codecs, Container und HDR-Formate der TV wirklich kann
- ⬜ Diagnose-Overlay mit Plan, Route und Player-Zustand, ohne Geheimnisse

## Phase 1 – Fundament: Server, Konto, Profile, Shell (Ziel v0.2.0)

- ⬜ Mehrere Server speichern und wechseln; jeder behält seine Anmeldung
- ⬜ Anmelden per Code/QR (zuerst angeboten) und per Passwort mit Bildschirmtastatur; Abmelden
- ⬜ Profile: Auswahl, PIN, Kinderprofile, Profil anlegen
- ⬜ Profil beim Start: Automatisch, Jedes Mal, nach 1 Stunde, nach 12 Stunden
- ⬜ Profil und Server wechseln
- ⬜ App-Shell mit oberer Leiste: Startseite, Filme, Serien, Für dich, Kalender, Suche, Avatar-Menü
- ⬜ Fokus-Navigation mit Pfeilen, OK und Zurück; Fokus-Gedächtnis; Magic-Remote-Zeiger
- ⬜ Server-Branding (Servername), Lade-, Leer- und Fehlerzustände
- ⬜ Deutsch und Englisch nach TV-Sprache

## Phase 2 – Stöbern (Ziel v0.3.0)

- ⬜ Startseite aus den Server-Sektionen: Weiterschauen, Next Up, Neu hinzugefügt und alle weiteren Zeilen, die der Admin konfiguriert
- ⬜ Reihen mit höchstens 20 Karten und einer „Alle anzeigen“-Karte, die die volle Seite mit Paging öffnet
- ⬜ Bibliotheks-Tabs Filme und Serien:
  - Empfohlen-Zeilen
  - Durchsuchen-Raster mit Sortierung, Filtern und Alphabet-Leiste
  - Sammlungen
- ⬜ Suche über Filme, Serien und Folgen; passende Box-Sets zuerst
- ⬜ Film-Detailseite: Hero, Beschreibung, Credit-Zeile, externe Bewertungen, Qualitäts-Badges
- ⬜ Serien-Detailseite mit Staffeln und Folgen, Besetzung, Empfehlungen
- ⬜ Ähnliche Titel
- ⬜ Personenseite: Biografie und Filmografie, gefiltert nach Alle, Filme oder Serien
- ⬜ Box-Sets: Seite mit Filmen in Erscheinungsreihenfolge, „Nächsten abspielen“
- ⬜ Trailer & mehr: lokale Trailer und Extras; YouTube-Trailer über die YouTube-App des TVs
- ⬜ Titelmusik auf Detailseiten, wenn das Profil sie einschaltet
- ⬜ Title-Art (Logo statt Text) nach Profileinstellung
- ⬜ Spoilerschutz: Standbild unscharf und Beschreibung verborgen bei ungesehenen Folgen
- ⬜ KI-Übersetzung von Beschreibungen, wenn der Server sie anbietet

## Phase 3 – Player (Ziel v0.4.0)

- ⬜ Abspielen, Fortsetzen, Von vorn, jeweils nach dem Server-Fortschritt
- ⬜ Version, Tonspur und Untertitel vorab auf der Detailseite wählen; Auswahl als Präferenz am Server speichern
- ⬜ Direct Play, HLS-Remux und Transcode, wie Protokoll v3 sie plant
  - Geräteprofil mit H.264, HEVC, VP9, AV1, HDR10, HDR10+, Dolby Vision und Mehrkanal-Ton, soweit der TV sie kann
- ⬜ Steuerung:
  - Play/Pause, Springen und Spulstufen
  - Scrubbing mit Vorschaubildern (Trickplay)
  - Kapitel: Auswahl, Anzeige und Marken auf der Zeitleiste
- ⬜ Ton-, Untertitel- und Qualitätswechsel während der Wiedergabe (Replan)
- ⬜ Untertitel suchen und herunterladen über die Untertitel-Anbieter des Servers
- ⬜ Untertitel-Darstellung nach Profileinstellung (Größe, Stil)
- ⬜ Intro, Recap und Abspann überspringen; automatisches Überspringen nach Profileinstellung
- ⬜ Up Next: nächste Folge automatisch, On-Deck-Vorschläge am Ende eines Films
- ⬜ Shuffle für Bibliothek, Sammlung, Serie und Staffel
- ⬜ Fortschritt laufend und am Ende melden
- ⬜ Sleep-Timer
- ⬜ Wiedergabegeschwindigkeit und Bildformat (beim Roku-Client nicht möglich, auf webOS schon)
- ⬜ Ton- und Untertitelverzögerung

## Phase 4 – Persönliches und Entdecken (Ziel v0.5.0)

- ⬜ „Für dich“ mit den Empfehlungszeilen des Servers
- ⬜ Kalender: eine Woche mit Veröffentlichungen und Ausstrahlungen für gefolgte, trendende oder alle Titel
- ⬜ Merkliste, Favoriten und Verlauf, jeweils mit Entfernen
- ⬜ Als gesehen oder ungesehen markieren: Film, Serie, Staffel, Folge
- ⬜ Requests, wenn der Server sie anbietet:
  - Discover-Zeilen
  - Anfragen, Abbrechen, Benachrichtigen
  - Meine Requests
  - Request-Suche für fehlende Titel
- ⬜ Einstellungen des Profils:
  - Wiedergabe, Untertitel-Aussehen, Oberfläche, Startseite
  - Metadaten-Sprache, Profilauswahl beim Start
  - Konto und angemeldete Geräte

## Phase 5 – Extras (ab v0.6.0)

- ⬜ Watch Party: Räume hosten und beitreten, Host- und Abstimmungsräume, synchrone Wiedergabe
- ⬜ Startseiten-Zeilen bearbeiten
- ⬜ Benachrichtigungen
- ⬜ Musik und Hörbücher mit eigenem Audio-Player
- ⬜ Start-Parameter und Deep Links (z. B. direkt zu einem Titel); Anzeige im LG-Home-Launcher
- ⬜ Prüfen: Fernsteuerung durch die Silo-Handy-App (SiloControl) und Anmeldung über die Handy-App. Beides braucht Netzwerkdienste, die eine webOS-App eventuell nicht anbieten darf.
- ⬜ Eigener App-Name und eigenes Icon; später eventuell der LG Content Store

## Bewusst nicht geplant

- **Admin-Bereich:** Server-Einrichtung, Bibliotheken, Benutzer, Plugins, Metadaten bearbeiten
- **Sammlungen** anlegen oder bearbeiten (bietet keine Silo-TV-App)
- **Lesen:** E-Books, Comics, Manga, Dokumente
- **Downloads** und Offline-Wiedergabe
- **Live-TV**, DVR, IPTV: Silo schließt das grundsätzlich aus
- **Browser-Anmeldung** per OIDC/OAuth auf dem TV und Registrierung. Die Code-Anmeldung deckt diese Konten ab, weil die Bestätigung im Browser des Handys passiert.
- **Server-Suche im Netzwerk** (mDNS): Eine webOS-Web-App kann das nicht; die Server-Adresse wird eingegeben.
