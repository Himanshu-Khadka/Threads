# Threads

An Obsidian plugin that syncs Markdown notes through **your own Google Drive**.
Obsidian remains the editor, backlink index, and knowledge graph. Threads handles
authentication, cloud history, transfers, and conflict preservation.

**0.4.0 is a cross-platform preview. Use disposable vaults and independent backups.**
Mobile-compatible code is included, but the authentication service has not been
deployed and physical-device acceptance is pending. A source checkout or CI
artifact is not automatically a sign-in-ready public release.

## Platform status

| Platform | Installation | Sign-in | Verification in this revision |
| --- | --- | --- | --- |
| Windows, macOS, Linux | Runtime files or Node installer | Hosted service or personal Desktop OAuth | Simulated Obsidian host; real devices pending |
| iPadOS, iOS, Android | BRAT after a configured beta release is published | Hosted service required; no desktop pairing | Node-free mobile sandbox; real devices pending |
| Web browsers, other operating systems | Not a standalone app | Not supported | No coverage |

Requires Obsidian **1.11.4+** with SecretStorage. Node is needed for development
or the CLI installer, not prebuilt plugin installation. Each device signs in
independently and chooses the same cloud vault. No Google Drive desktop app or
shared filesystem mount is required.

## Get started

- [Install and connect devices](docs/INSTALLATION.md)
- [Configure sign-in and publish a beta](docs/PUBLISHING.md)
- [Architecture and storage protocol](docs/ARCHITECTURE.md)
- [Verification and real-device checklist](docs/VERIFICATION.md)
- [Contributing](CONTRIBUTING.md), [security](SECURITY.md), [changes](CHANGELOG.md)

From this repository in VS Code's terminal:

```sh
npm ci
npm run test:all
npm run package
npm run install:vault -- --vault "/absolute/path/to/test-vault"
```

Use Node.js 24 (minimum 22.12). PowerShell users can use `npm.cmd` when script
policy blocks `npm.ps1`. `npm run dev` watches and rebuilds root `main.js`;
it does not install or reload the plugin. Package and install again after editing.
Generated files and local credentials are ignored by Git.

## What sync does

- Explicitly create or join a cloud vault in the signed-in user's Drive.
- Upload edits after a 1.2-second debounce; poll history roughly every 10 seconds
  after success. Retry failures with bounded backoff.
- Keep readable immutable revisions under original note subfolders. Revision
  filenames contain IDs; local notes retain their original names.
- Checkpoint uploads before sending, reuse Drive IDs on retry, and verify hashes.
- Preserve conflicts under `_Threads conflicts` and require explicit resolution.
- Stop scheduling while hidden; reconcile when Obsidian returns to the foreground.

This is **near-real-time foreground sync, not guaranteed instant or background
sync**. Mobile operating systems can suspend the app. Notes stay local offline.
The broker handles authentication; note requests go directly to Google Drive.
It handles account tokens, so users must trust its operator. See [security](SECURITY.md).

## Boundaries

Markdown only: no attachments, Canvas files, plugin settings, automatic merge,
rename/delete propagation, end-to-end encryption, or history compaction.
Limits: 1 MiB UTF-8 per note, 1000 note paths, 5000 revisions per cloud vault.
Hidden/configuration folders are excluded. Incompatible path names are skipped;
case/Unicode-equivalent collisions stop sync for correction.

Renaming uploads a new path without removing the old cloud path. Local deletion
does not delete cloud history. Do not edit, move, or delete revisions in Drive:
it is history storage, not a current-file mirror. Keep separate backups and
do not run another sync tool over the same local vault.

## Repository layout

| Path | Responsibility |
| --- | --- |
| `src/main.ts`, `src/plugin.ts` | Entry point, lifecycle, orchestration |
| `src/auth/` | Google grants, hosted sign-in, public build configuration |
| `src/platform/` | Portable crypto and isolated desktop callback |
| `src/drive/` | Google requests, folders, revision I/O |
| `src/sync/` | Reconciliation engine and Obsidian vault adapter |
| `src/settings/`, `src/ui/` | Validated config, settings, resolution modal |
| `src/features/`, `src/shared/` | Manual copies, diagnostics, safe errors |
| `services/auth-broker/` | Authentication service, tests, Docker/Caddy example |
| `tests/`, `scripts/` | Unit tests, integration simulations, packaging, installers |
| `docs/`, `docs/history/` | Current guides and archived milestone notes |
| `.github/workflows/` | Three-OS CI and beta-release automation |

Only `main.js`, `manifest.json`, and `styles.css` belong in an installed plugin
folder. Obsolete root tutorial sources are removed; their history remains in
Git. Do not copy source or `node_modules` into the vault.
