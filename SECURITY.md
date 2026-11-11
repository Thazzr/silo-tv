# Security policy

## Reporting a vulnerability

Please report security problems **privately**, not in a public issue:

→ [Report a vulnerability](https://github.com/Thazzr/silo-tv/security/advisories/new) (GitHub's private vulnerability reporting)

Describe what is affected, how to reproduce it, and what an attacker could gain. Never include real tokens, passwords or server addresses; placeholders are enough. You will usually get an answer within a week. Once a fix is released, the advisory is published with credit to you, unless you prefer otherwise.

## Supported versions

The project is before 1.0. Only the newest [release](https://github.com/Thazzr/silo-tv/releases) and the `main` branch get fixes.

## Scope

In scope:

- **The app:**
  - how it stores and sends sign-in tokens (the access token stays in memory; only the refresh token is stored on the TV);
  - how it handles media and subtitle URLs;
  - anything that lets a server or a network attacker run code in the app.
- **The bundled webOS JS service:** it must serve only this app, proxy only to a Silo server's `/api/v2/`, never reach the TV itself or link-local addresses, and never log headers or bodies.
- **The build and release pipeline:** the GitHub workflows and the published `.ipk`.

Out of scope here:

- **Vulnerabilities in the Silo server:** report them to the [Silo project](https://github.com/Silo-Server/silo-server/security).
- **Vulnerabilities in LG webOS:** report them to LG.
