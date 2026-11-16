# Threads 0.2.0 - complete desktop milestone source

All source, build configuration, tests, the dependency lockfile, a Windows
installer, and prebuilt plugin files are included. Start with START_HERE.md.
No additional snippets are needed.

**This completes the desktop authentication and file-transfer milestone.
It is not the final automatic multi-device sync product.**

## Included functionality

- Google Desktop OAuth with your own project, system browser, loopback callback,
  random state, PKCE, code exchange, and offline access.
- Refresh-token persistence in Obsidian SecretStorage. Access tokens stay in
  memory and refresh when needed, including after a restart.
- Check connection: read the authorized Google account from Drive.
- Sample round trip: upload generated Markdown, download it, compare exact
  content, then create a new local sample note.
- Upload current note copy: capture saved Markdown, create a uniquely named
  .md file on Drive, download it, and verify exact text.
- Persistent folder-name preference, visible status, and safe error handling.
- Folder-aware uploads: configured Drive root / vault name / original note
  folders / timestamped note copy. Threads-created folders are reused.
- One-time import of tutorial client credentials and folder-name preference.
  Unversioned tutorial tokens are not imported: reconnect once after upgrading.
- Install/update script preserving data.json and backing up old runtime files.

## Not included

Automatic sync, change polling, durable outgoing queues, conflict merging,
second-device join/download, whole-vault mirroring, rename/delete propagation,
attachments, iPad support, background operation, and a notification relay are
not implemented.

Each manual upload creates a separate copy. It never overwrites the original
note or an older remote copy. Markdown links remain intact as text, but their
referenced notes and attachments are not transferred automatically. This is not
a complete-vault backup system.

The folder fix applies to new uploads only; existing flat copies are left
untouched. The last-upload setting shows the destination path and folder URL.
Only folders created by this OAuth app with the matching Threads role are
reused, not unrelated folders that happen to have the same name. Ambiguous
matching folders stop the upload instead of selecting one arbitrarily.
Different vaults with the same name share a destination; use distinct vault
names or different configured root names. Concurrent devices can still race
to create folders: this milestone does not provide multi-device coordination.

## Requirements

Desktop Obsidian 1.11.4+, your own Google Cloud project with Drive API enabled,
a Desktop app OAuth client, and drive.file permission. Add your Google account
as a test user while the OAuth app is in Testing. Node.js 22.12+ is needed only
for development, not prebuilt installation.

No hosted backend or original developer's authentication service is used.
The login listener binds only to 127.0.0.1 and closes after completion,
cancellation, or a three-minute timeout.

## Commands

| Command/action | Behavior |
| --- | --- |
| Connect Google | Authorize using your browser and obtain a refresh token |
| Check Google connection | Refresh if necessary and show the authorized account |
| Run Google Drive sample test | Verify a generated sample upload/download |
| Upload current note copy | Create and verify a copy of the open saved Markdown note |
| Save folder | Set the next note-copy folder name; no remote rename |
| Reset folder / Reset note folder | Forget the selection without deleting cloud files |
| Clear credentials | Clear current credentials and known tutorial secret keys |

The legacy command ID sync-now now displays the honest label **Upload current
note copy**. It does not perform continuous sync. Notes are limited to 1 MiB of
UTF-8 text; binaries are unsupported. Partial failures can leave remote test
files/copies. Nothing is automatically deleted.

## Source map

| File | Responsibility |
| --- | --- |
| src/main.ts | Lifecycle, UI, commands, migration, serialized manual actions |
| src/oauth.ts | Browser login, callback validation, token exchange and refresh |
| src/settings.ts | Validated settings, credential parsing, tutorial migration |
| src/http.ts | Google endpoint allowlist and sanitized HTTP errors |
| src/drive.ts | Account, folders, Markdown upload/download |
| src/roundtrip.ts | Generated-sample transfer test |
| src/snapshot.ts | Size-limited, uniquely named note copies and verification |
| src/errors.ts | User-safe error formatting |
| tests/ | Automated success/failure-path tests |
| scripts/smoke.mjs | Compiled plugin test using a simulated Obsidian host |
| scripts/package.mjs | Populate the installable dist/threads-sync directory |
| Install-Threads.ps1 | Windows installation/upgrade with code backups |
| manifest.json | Obsidian identity and compatibility |
| esbuild.config.mjs | Bundle entry point and external host modules |
| tsconfig.json | Strict checking with Node types |
| package.json / package-lock.json | Commands and pinned dependencies |

This is a consistent replacement project. Do not combine it with the root-level
main.ts, settings.ts, credentials.ts, oauth.ts, callback.ts, or tokens.ts from the
tutorial. Their responsibilities are covered by src/. Both compiler and bundler
target that directory.

## Build and test

From the provided project directory in VS Code's terminal:

```powershell
npm ci
npm test
npm run smoke
npm run package
```

The package command produces main.js, manifest.json, and styles.css under
dist/threads-sync. The dev command watches changes and rebuilds root main.js;
it does not install or reload the plugin. Run package again before deploying
with the installer. If PowerShell blocks npm.ps1, use npm.cmd instead.

This archive does not include .git or modify your existing repository. Preserve
your existing Git history and review changes before committing. Do not commit
node_modules, .obsidian, data.json, credentials, or generated login values.
Keep package-lock.json tracked.

## State and migration

Ordinary plugin settings contain folder names/IDs, a secret reference, and
last-result text, not client secrets or refresh tokens. SecretStorage is shared
plugin infrastructure, not a guarantee of OS-keychain protection or isolation
from all other plugins.

The first upgrade checks threads-google-desktop-client for tutorial credentials.
It imports the client ID and secret only if the new secret reference has none.
It preserves driveFolderName and records migration completion so clearing
credentials does not silently reimport them. Reauthorize using Connect Google.
Legacy tutorial secrets remain for rollback until Clear credentials is used;
that clears both the current key and the two known tutorial keys.

Reconnecting or replacing client credentials forgets remote folder selections
to avoid mixing accounts. It does not remove old Drive folders. Changing the
note-copy folder name selects a new folder on the next upload.

## Security and limits

- Use a test vault outside filesystem sync folders; keep separate backups.
- Readable Markdown on Drive is not end-to-end encryption against Google.
- drive.file does not grant access to every pre-existing file inside an
  arbitrary folder. This build creates/manages its own folders and files.
- External OAuth apps in Testing can receive seven-day refresh tokens for these
  scopes. Reconnect when grants expire or are revoked.
- Clear credentials removes local authorization, not Google's grant. Revoke
  access separately at https://myaccount.google.com/permissions.
- Only explicit manual actions contact Google. There is no startup polling.
- Creates are not automatically retried. A lost response can leave a remote
  copy even if the UI reports failure; retrying may create an additional copy.
- Unloading stops future steps, but an API request already in flight can finish
  remotely. No force-cancel button is implemented for uploads.
- A stalled HTTP request can remain pending until the host network stack ends it.

## Verification

See VERIFICATION.md. Google responses and host behavior were simulated during
automated verification. Windows UI, real Google authorization, and actual Drive
storage have not been exercised with this release. The user's earlier
successful browser callback was in the tutorial, not this packaged build.

## Primary references

- https://developers.google.com/identity/protocols/oauth2/native-app
- https://developers.google.com/identity/protocols/oauth2
- https://developers.google.com/workspace/drive/api/guides/api-specific-auth
- https://developers.google.com/workspace/drive/api/guides/manage-uploads
- https://github.com/obsidianmd/obsidian-api
- https://docs.obsidian.md/plugins/guides/secret-storage
- https://www.electronjs.org/docs/latest/api/shell
