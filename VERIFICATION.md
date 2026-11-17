# Threads 0.3.0 verification

Date: 2026-11-16

## Passed in the build environment

- TypeScript strict type checking.
- esbuild CommonJS bundle generation.
- 106 Vitest tests across 8 files, including automatic reconciliation,
  concurrent heads, conflict preservation/resolution, interrupted uploads,
  restart checkpoints, malformed history, pagination, and idempotent Drive IDs.
- Compiled-bundle smoke test with a simulated Obsidian host and Google API:
  lifecycle, settings control construction, loopback sign-in, serialized
  round trips, nested note upload and verification, full folder-tree reuse, token refresh
  after a simulated restart, tutorial-credential migration, credential clearing,
  credential/settings separation, and unload behavior.
- A second compiled-plugin simulation exercises two desktops, nested paths,
  event-triggered scheduling, offline retry, conflicts, account isolation,
  pause, restart, disconnect, and unload.
- Public-release build correctly refuses to run without app configuration.
- A release build with a nonfunctional test Desktop client correctly embeds
  that client, passes both smoke tests, and does not retain account authorization
  after Disconnect. The final local bundle is rebuilt without test credentials.

Environment: Linux, Node.js 24.22.1. OAuth callback tests use actual local
HTTP sockets; Google responses and Obsidian host behavior are simulated.

## Not yet verified

- Live OAuth approval and refresh with your Google Cloud project.
- Windows Obsidian installation, visual UI behavior, browser launch, firewall,
  and SecretStorage persistence across an actual application restart.
- PowerShell installer execution on Windows. A manual-copy installation
  method is supplied as well.
- Real Drive storage, scope visibility, service quotas, or errors.
- Mac and iPad execution. iPad support is disabled in the manifest.
- Live multi-device sync, actual Drive list consistency, real crash/power-loss
  recovery, editor buffer interactions, and large-vault performance.
- Public OAuth app publication, brand review, and sign-in by unrelated users.

This is a sync preview, not a production release. The next acceptance gate is
the real-device test sequence in START_HERE.md, followed by conflict and offline
tests using disposable vaults on two physical desktops.
