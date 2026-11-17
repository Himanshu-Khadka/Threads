# Threads 0.4.1 verification

Date: 2026-11-17. Environment: Linux, Node.js 24.22.1.
Google endpoints and the Obsidian host are simulated unless stated otherwise.

## Passed locally

| Check | Result |
| --- | --- |
| TypeScript strict checking | Passed, including unused-symbol checks |
| Plugin tests | 116 passed across 9 files |
| Broker tests | 7 passed using real loopback HTTP sockets and mocked Google |
| Release workflow logic | 12 tests passed against a simulated GitHub API |
| Package/installer tests | 3 passed; exact assets, reproducible ZIP, checksums, data preservation, code backup |
| Compiled desktop host smoke | Lifecycle, controls, OAuth callback, copies, restart, migration, disconnect |
| Compiled desktop two-device smoke | Folders, offline retry, conflicts, account isolation, foreground scheduling |
| Compiled mobile sandbox smoke | Same sync cases plus hosted sign-in/pending poll; no Node/Electron/Buffer |
| Release configuration | Missing config refused; dummy hosted config builds; server-only marker absent |
| Release version check | Version helper keeps four files aligned; reused tags/downgrades rejected |

Broker tests cover state and claim proof rejection, PKCE exchange, concurrent
claim retries, denial/expiry, request/session limits, provider failure sanitation,
and server-only secret use. Plugin tests cover revision integrity, durable
pending uploads, account binding, safe paths, token refresh, and cancellation.
Release tests cover incomplete uploads staying as drafts, resuming matching
assets, checksum mismatches, published-release no-ops, mismatched commits,
pagination, annotated tags, and preventing token uploads to an unexpected host.

The configured build was tested only with nonfunctional example configuration.
The final local developer artifact is rebuilt without it. The three-OS GitHub
Actions workflow is included; local Linux tests are not evidence of a passing
Windows/macOS runner or native Obsidian installation.

## Not yet verified

- Deployed broker, real TLS/reverse proxy, Docker Compose, load/abuse behavior.
- Live Google Web client exchange, project visibility, approval, and refresh.
- Physical MacBook, Windows, Linux desktop, iPad, iPhone, or Android installation.
- Actual mobile external-browser launch/return and OS suspension behavior.
- Real SecretStorage persistence, visual settings layout, editor buffer behavior.
- Live Drive consistency, permission/quota errors, multi-device crash recovery.
- BRAT installation of a configured release; no release is published by this refactor.
- Actual GitHub draft/upload/publish execution with the repository's Actions token,
  followed by a second higher-version release delivered through BRAT.
- Obsidian community-directory review or Google production publication.

## Physical-device acceptance gate

Use two disposable local vaults, one desktop and one mobile, before using real notes.

1. Install a configured beta on each device. Record device/OS/Obsidian/build versions.
2. Sign in independently, return from the browser, confirm account, create one
   cloud vault, and join its exact ID from the other device.
3. Upload/download nested Markdown and Unicode text both directions. Confirm
   configuration files, credentials, attachments, and hidden paths do not upload.
4. Restart each app, force access-token expiry in a test build, and confirm
   refresh without copying credentials between devices.
5. Edit offline and reconnect. Make simultaneous divergent edits; verify both
   originals survive and conflict copies exist. Explicitly resolve and resync.
6. Type during a remote download; ensure unsaved/current local changes are not
   silently lost. Interrupt an upload and reopen; verify idempotent retry.
7. Background/lock the mobile device, edit on desktop, then foreground mobile.
   Confirm eventual reconciliation, without claiming locked-device sync.
8. Deny sign-in, close the browser, expire a session, restart the broker during
   login, revoke Google access, and switch accounts. Verify understandable errors
   and no cross-account uploads.
9. Simulate throttling/service outage; preserve local notes and retry safely.
   Check corrupted/missing remote revisions stop sync rather than overwrite.
10. Update the plugin; verify settings/checkpoints remain. Test uninstall/reinstall
    recovery from backups separately, then document actual results.

Do not mark this gate complete based on VM simulations. The manifest permits
mobile installation, but device support remains a preview until these checks pass.
