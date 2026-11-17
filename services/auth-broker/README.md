# Threads auth broker

Independent Google authorization for Obsidian desktop and mobile. This is an
optional deployment for desktop-only personal OAuth, but required for mobile.
The service handles account tokens, not note payloads. Users must trust its operator.

Read [publisher setup](../../docs/PUBLISHING.md) before deploying and
[security](../../SECURITY.md) before enabling telemetry. The Docker/Caddy example
is a single-instance pilot, not a production scalability claim.

Tests: `node --test services/auth-broker/server.test.mjs` from the repository root.
Start: `node services/auth-broker/server.mjs` after securely configuring
`AUTH_ORIGIN`, `GOOGLE_CLIENT_ID`, and `GOOGLE_CLIENT_SECRET` in the environment.
The service does not automatically load an env file; Docker Compose does.

| Endpoint | Purpose |
| --- | --- |
| `GET /health` | Generic health result |
| `POST /v1/sessions` | Create a ten-minute PKCE/claim-bound login |
| `GET /oauth/callback` | Validate state and receive Google's code |
| `POST /v1/sessions/:id/claim` | Verify proofs and return the exchanged grant |
| `POST /v1/refresh` | Refresh a supplied device grant using the server client |

Request/session/IP bounds are enforced in code. No persistent account database
is kept. Restarting loses pending sessions. Proxy logs must omit callback URLs
and all request/response bodies. See the publisher guide for rate-limit caveats.
