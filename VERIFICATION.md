# Threads 0.2.0 verification

Date: 2026-11-16

## Passed in the build environment

- TypeScript strict type checking.
- esbuild CommonJS bundle generation.
- 66 Vitest tests across 6 files, including folder hierarchy, reuse, query
  escaping, invalid paths, and ambiguous folder search failures.
- Compiled-bundle smoke test with a simulated Obsidian host and Google API:
  lifecycle, settings control construction, loopback sign-in, serialized
  round trips, nested note upload and verification, full folder-tree reuse, token refresh
  after a simulated restart, tutorial-credential migration, credential clearing,
  credential/settings separation, and unload behavior.
- npm audit: 0 reported vulnerabilities, including development dependencies.

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
- Any form of automatic multi-device sync, conflict recovery, or migration.

This is a connection prototype, not a production sync release. The first
real-device acceptance gate is the Windows workflow in README.md.
