# silo-lg

Ein nativer Client für LG-Fernseher mit webOS (ab Modelljahr 2021, webOS 6+) für den selbst gehosteten Medienserver [Silo](https://github.com/Silo-Server/silo-server).

> Kein offizielles Silo-Projekt. „Silo“ ist eine Marke von Silo Media L.L.C.; diese App ist ein unabhängiger Client für Silo. `silo-lg` ist ein Arbeitstitel.

## Stand

Phase 0 (Machbarkeit) ist geplant. Was die App können soll und in welcher Reihenfolge: [`docs/roadmap.md`](docs/roadmap.md).

## Technik

| Bereich | Wahl |
|---|---|
| Sprache | TypeScript |
| UI | React mit Vite, gebaut für Chromium 79 (webOS 6) als klassisches Skript |
| Daten | TanStack Query; API-Client generiert aus Silos OpenAPI (`/api/v2`) |
| Wiedergabe | natives `<video>` mit der Media-Pipeline des TVs; Silo-Wiedergabeprotokoll v3 |
| Tests | Vitest, React Testing Library, MSW, Playwright |
| TV-Werkzeuge | `@webos-tools/cli` (`ares-package`, `ares-install`, `ares-launch`, `ares-inspect`) |
| Prozess-Werkzeuge | PowerShell (`tools/`), git-cliff für das Changelog |

## Entwicklung

Regeln und Ablauf stehen in [`CLAUDE.md`](CLAUDE.md): Opus plant und prüft, ein Sonnet-Subagent setzt um, und jede Phase endet mit Gate, Gerätetest, Commit, Tag und generiertem Changelog.

Setup, Build und Installation auf dem TV werden hier ergänzt, sobald Phase 0 das Projektgerüst anlegt.

## Lizenz

Noch offen. Wird Code aus Silo-Web oder dem Roku-Client übernommen, gilt AGPL-3.0-or-later.
