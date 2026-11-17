# Public Google sign-in: one-time publisher setup

The desired user flow is install, sign in with Google, create or select a cloud
vault, then opt in to automatic sync. Users do not create a Google Cloud project.
Each user's authorization is separate and files go into that user's Drive.
No Threads backend stores notes or account refresh tokens.

## What the publisher must do

1. Create a production Google Cloud project separate from development/testing.
2. Enable Google Drive API and create a Desktop app OAuth client.
3. Configure the external app audience, app branding, support contact, authorized
   domains, home page, privacy policy, and other details Google requests.
4. Request only `https://www.googleapis.com/auth/drive.file` for Drive storage.
   It is a recommended non-sensitive per-file scope, not whole-Drive access.
5. Publish the app to production and complete any applicable Google branding
   or OAuth verification. External Testing is restricted to configured test
   users and these grants normally expire after seven days. Workspace admins
   can still restrict third-party access: not literally every account is guaranteed.
6. Download the Desktop client JSON and place it at `google-client.local.json`
   in the project. This path is ignored by Git. Do not paste the JSON into chat.
   Alternatively set THREADS_GOOGLE_CLIENT_FILE to an existing local file path.
7. Run `npm ci`, `npm test`, `npm run smoke`, then `npm run package:release`.
8. Distribute only main.js, manifest.json, and styles.css from dist/threads-sync.
   Do not distribute data.json, the local configuration file, account tokens,
   sync checkpoints, your vault, or node_modules.

The release build fails if the client file is absent or is not a Desktop client
JSON with an `installed` object. Normal dev builds still work unconfigured and
offer personal credentials under Advanced. Building does not publish your Google
app or bypass Google's approval process; those steps require the project owner.

## Public client versus account secrets

Google Desktop OAuth clients are public clients: the client ID and Google's
Desktop client-secret field are necessarily recoverable from a distributed
application. The build embeds ONLY those two app configuration values. They
identify Threads; they are not a user's password or refresh token. Never embed
a Web/server OAuth secret or a user's token in the release. PKCE, random state,
a system browser, and a loopback listener protect the authorization flow.

Each user authorizes their own account. Refresh tokens are stored locally using
Obsidian SecretStorage, never in Git or cloud note history. The ordinary local
plugin data can contain pending note content, so keep it private too.

Changing the OAuth app/project can change drive.file visibility. Keep the same
production client for users across releases and devices. Existing personal-client
users are not silently migrated: changing app configuration requires sign-in and
an intentional cloud-vault selection. Old manual uploads are not sync revisions.

## Release limits and acceptance gate

This build is a desktop Markdown preview. Do not market it as production-ready,
instant sync, full-vault backup, or iPad support. Before a public release, test
two real desktop clients with separate local vaults, reconnect/restart, offline
edits, simultaneous edits, conflict resolution, account switches, permission
revocation, 429 throttling, quota exhaustion, and a corrupted/missing revision.
Add attachments, tested mobile authorization, incremental change polling,
history retention, and recovery tooling in later milestones.

## Official references

- https://developers.google.com/identity/protocols/oauth2/native-app
- https://developers.google.com/identity/protocols/oauth2/policies
- https://developers.google.com/identity/protocols/oauth2/production-readiness/brand-verification
- https://support.google.com/cloud/answer/15549945
- https://developers.google.com/workspace/drive/api/guides/api-specific-auth
- https://developers.google.com/workspace/drive/api/guides/manage-uploads
