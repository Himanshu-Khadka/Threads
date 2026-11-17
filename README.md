# Threads 0.3.0 - desktop Markdown sync preview

Start with START_HERE.md. Maintainers configuring public Google sign-in must
also read PUBLISHING.md. A developer must supply the app's Desktop OAuth
configuration before distributing a sign-in-ready release.

**Preview, not a production sync release. Test with disposable vaults and keep
independent backups. Automated tests simulate Google and Obsidian.**

## Included functionality

- A simple sign-in screen with developer credentials and diagnostics hidden
  under Advanced. Bundled app configuration means end users need no Cloud project.
- Google Desktop OAuth with the publisher's project, system browser, loopback callback,
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
- Explicit opt-in to create or join a cloud vault on the signed-in user's Drive.
- Automatic two-way Markdown transfers while desktop Obsidian is open:
  1.2-second edit debounce, 10-second polling after success, and retry backoff
  up to five minutes. These are scheduling intervals, not latency guarantees.
- Persisted in-flight upload checkpoints, preallocated Drive IDs, immutable
  revisions, SHA-256 verification, and account/client-bound sync selections.
- Conflict copies and explicit resolution using the current original note.

## Not included

Attachments, automatic text merging, rename/delete propagation, plugin settings,
iPad support, syncing while Obsidian is closed, history compaction, encryption
against Google, and a notification relay are not implemented. Renames upload
the new path but retain the old cloud path. Local deletion does not delete the
cloud note and is not automatically undone on the same device.

Limits: 1 MiB UTF-8 per note, 1000 supported note paths, 5000 retained revisions
per cloud vault. Large vaults need an incremental Drive change feed and history
retention before production use. Invalid Windows paths and hidden folders are
excluded; case/Unicode-equivalent paths stop sync for manual correction.

Each manual upload creates a separate copy. It never overwrites the original
note or an older remote copy. Markdown links remain intact as text, but their
attachments are not transferred. Automatic sync separately transfers supported
Markdown notes. This is not a complete-vault backup system.

The folder fix applies to new uploads only; existing flat copies are left
untouched. The last-upload setting shows the destination path and folder URL.
Only folders created by this OAuth app with the matching Threads role are
reused, not unrelated folders that happen to have the same name. Ambiguous
matching folders stop the upload instead of selecting one arbitrarily.
Manual-copy folders still use names. Automatic cloud vaults instead have distinct
IDs: select the same ID on another computer, even if its local vault name differs.
Concurrent folder creation can still produce duplicate folders; the client stops
on ambiguity. Rename extra folders in Drive instead of deleting their contents.

Automatic sync stores readable, immutable Markdown revisions under the original
subfolders, with revision IDs in filenames and metadata in Drive descriptions.
Obsidian gets the normal original filenames. The Drive layout is history storage,
not an editable current-file mirror. Do not manually edit, move between vaults,
or delete revision files: integrity checks may stop syncing. Old manual-copy
uploads are not automatically imported into the new protocol.

## Requirements

Desktop Obsidian 1.11.4+ and a Google account permitted by the publisher's OAuth
configuration. The publisher needs a Google Cloud project with Drive API,
a Desktop app OAuth client, and drive.file permission. Node.js 22.12+ is needed only
for development, not prebuilt installation.

No hosted backend or original developer's authentication service is used.
The login listener binds only to 127.0.0.1 and closes after completion,
cancellation, or a three-minute timeout.

## Commands

| Command/action | Behavior |
| --- | --- |
| Connect Google | Authorize using your browser and obtain a refresh token |
| Sync now | Reconcile the selected cloud vault and local Markdown notes |
| Resolve conflict using current note | Confirm publishing the saved original note over observed conflict heads |
| Check Google connection | Refresh if necessary and show the authorized account |
| Run Google Drive sample test | Verify a generated sample upload/download |
| Upload current note copy | Create and verify a copy of the open saved Markdown note |
| Save folder | Set the next note-copy folder name; no remote rename |
| Reset folder / Reset note folder | Forget the selection without deleting cloud files |
| Clear credentials | Clear current credentials and known tutorial secret keys |

The command ID sync-now now performs actual reconciliation. Manual note-copy
upload is retained as upload-note-copy. Nothing is automatically deleted.

## Source map

| File | Responsibility |
| --- | --- |
| src/main.ts | Lifecycle, simple UI, scheduling, account checks and serialized actions |
| src/app-client.ts | Build-time public app configuration and personal-client override |
| src/sync.ts | Validated revision graph, durable pending writes and reconciliation |
| src/sync-drive.ts | Cloud vault discovery, paginated history, idempotent writes |
| src/sync-local.ts | Atomic compare-and-write, path guards and conflict copies |
| src/oauth.ts | Browser login, callback validation, token exchange and refresh |
| src/settings.ts | Validated settings, credential parsing, tutorial migration |
| src/http.ts | Google endpoint allowlist and sanitized HTTP errors |
| src/drive.ts | Account, folders, Markdown upload/download |
| src/roundtrip.ts | Generated-sample transfer test |
| src/snapshot.ts | Size-limited, uniquely named note copies and verification |
| src/errors.ts | User-safe error formatting |
| tests/ | Automated success/failure-path tests |
| scripts/smoke.mjs | Compiled plugin test using a simulated Obsidian host |
| scripts/sync-smoke.mjs | Two-device sync and lifecycle integration simulation |
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

Preserve your existing Git history and review changes before committing. Do not commit
node_modules, .obsidian, data.json, credentials, or generated login values.
Keep package-lock.json tracked.

## State and migration

Ordinary plugin settings contain folder names/IDs, a secret reference, sync
baselines, and the content of one pending upload, but not account refresh tokens.
Keep data.json private and do not sync the plugin configuration directory.
Publisher Desktop client configuration is embedded in the release bundle;
it identifies a public client, not an account or a server secret. SecretStorage is shared
plugin infrastructure, not a guarantee of OS-keychain protection or isolation
from all other plugins.

The first upgrade checks threads-google-desktop-client for tutorial credentials.
It imports the client ID and secret only if the new secret reference has none.
It preserves driveFolderName and records migration completion so clearing
credentials does not silently reimport them. Reauthorize using Connect Google.
Legacy tutorial secrets remain for rollback until Clear credentials is used;
that clears both the current key and the two known tutorial keys.

Reconnecting or replacing client credentials pauses sync. A cloud selection is
bound to the Google permission ID and OAuth client ID; it cannot be reused under
another account. Selecting a different cloud vault backs up the previous sync
state and any pending content locally in the plugin folder. It never uploads
that old checkpoint to the new account. Changing the manual note-copy folder
does not change the automatic sync vault.

## Security and limits

- Use a test vault outside filesystem sync folders; keep separate backups.
- Readable Markdown on Drive is not end-to-end encryption against Google.
- drive.file does not grant access to every pre-existing file inside an
  arbitrary folder. This build creates/manages its own folders and files.
- External OAuth apps in Testing can receive seven-day refresh tokens for these
  scopes. Reconnect when grants expire or are revoked.
- Clear credentials removes local authorization, not Google's grant. Revoke
  access separately at https://myaccount.google.com/permissions.
- No automatic network access until sync is explicitly enabled. Enabled sync
  resumes after restart while Obsidian is open. Disconnect and Pause stop timers.
- Automatic revision writes are checkpointed before upload and retried with
  the same preallocated ID. A 409 is accepted only after metadata/content verification.
- Offline edits remain in local notes and are rediscovered on the next successful
  scan. This is not a keystroke journal; edits deleted before a scan are not retained.
- Manual tests/copies and cloud-vault creation are not idempotent; a lost response
  can leave an extra copy or vault. Use Find existing vaults before creating again.
- Unloading stops future steps, but an API request already in flight can finish
  remotely. No force-cancel button is implemented for uploads.
- A stalled HTTP request can remain pending until the host network stack ends it.

## Verification

See VERIFICATION.md. Google responses and host behavior were simulated during
automated verification. Windows UI, real Google authorization, and actual Drive
storage have not been exercised with this release. The user's earlier
successful upload was in the previous manual-upload version, not this sync build.

## Primary references

- https://developers.google.com/identity/protocols/oauth2/native-app
- https://developers.google.com/identity/protocols/oauth2
- https://developers.google.com/workspace/drive/api/guides/api-specific-auth
- https://developers.google.com/workspace/drive/api/guides/manage-uploads
- https://github.com/obsidianmd/obsidian-api
- https://docs.obsidian.md/plugins/guides/secret-storage
- https://www.electronjs.org/docs/latest/api/shell
