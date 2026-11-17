# Install Threads

Use a disposable local vault and a separate backup. Install Obsidian 1.11.4+ on
each device. Threads is a plugin, not a standalone app. Do not run another sync
provider over the same vault during testing.

## Release prerequisite

For one-button sign-in on every device, the publisher must deploy the broker
and build a configured release: [publishing](PUBLISHING.md). This revision
supplies the code, not an already running service. An unconfigured development
ZIP loads but cannot sign users in on mobile.

## Windows, MacBook, and Linux

From the repository in VS Code's terminal:

```sh
npm ci
npm run package
npm run install:vault -- --vault "/absolute/path/to/test-vault"
```

Example paths: `C:\Users\Himanshu\Documents\Threads Test` on Windows,
`/Users/himanshu/Documents/Threads-Test` on macOS, or
`/home/himanshu/Documents/Threads-Test` on Linux. Keep the path quoted.
Open the vault in Obsidian first to create its default `.obsidian` folder.

To update, disable Threads, package again, then run:

```sh
npm run install:vault -- --vault "/absolute/path/to/test-vault" --update
```

Previous runtime files are backed up under the repository's ignored
`install-backups/` directory. Existing `data.json` is preserved. Restart
Obsidian after a manifest change and enable Threads in Settings > Community plugins.

For a prebuilt release, Node is unnecessary: extract `threads-sync-<version>.zip`
into `<vault>/.obsidian/plugins/`. The three runtime files must sit directly
under `<vault>/.obsidian/plugins/threads-sync/`, without an extra nested folder.
Command+Shift+Period reveals hidden folders on macOS. Custom configuration-folder
users should install manually into their actual config directory; the installer
intentionally targets `.obsidian` only.

The older PowerShell alternative is `scripts/install-windows.ps1`. The Node
installer is the common path covered by automated installer tests.

## iPad, iPhone, and Android beta installation

These steps apply **after** a configured GitHub beta release exists.
Pushing source alone does not produce release assets.

1. Create a local test vault in Obsidian on the device.
2. Install and enable **BRAT** from Obsidian's Community plugins directory.
3. In BRAT, add a beta plugin from `Himanshu-Khadka/Threads`, selecting Latest
   to follow new releases instead of freezing one version.
4. Enable Threads and open its settings.
5. Sign in with Google in the system browser, then return to Obsidian. The
   callback page's Open Obsidian link is optional; manually returning also works.
6. Retry sign-in if the app restarted or was suspended for over ten minutes.

BRAT installs the release assets without needing hidden-folder access in the
iPad Files app. It is a separate third-party plugin; install it only if you
trust it. Threads is not submitted to the community directory, so searching
there for Threads is not an installation path yet.
See [BRAT's guide](https://github.com/TfTHacker/obsidian42-brat/blob/main/BRAT-DEVELOPER-GUIDE.md).
Enable BRAT's automatic update check in its settings to receive future releases.
See [updates and recovery](UPDATES.md); do not uninstall Threads to update it.

## Connect the same knowledge vault

1. On the first device, choose Sign in with Google, then Create cloud vault.
   This opts in to uploading supported Markdown notes and downloading revisions.
2. On each additional device, sign in with the same account, choose Find
   existing vaults, select the same vault ID, and start syncing. Local names
   can differ; do not create a second cloud vault by mistake.
3. Keep both apps in the foreground for initial sync. Create/edit a small note,
   then use Sync now on the second device to verify it.
4. Complete the [acceptance checklist](VERIFICATION.md) before real notes.

End users of a configured release need no Google Cloud project. Google's Testing
mode only admits configured test users; Workspace policies can restrict access.

## Upgrade a personal Desktop-client installation

Stored credentials override bundled publisher config. Pause sync and back up
before changing clients. In Advanced, clear local credentials, then sign in
again with the hosted release. Select a cloud vault intentionally: the old
selection is bound to the old account/client ID.

Changing Google projects may make old `drive.file` data invisible to the new
app. Keep the old files; create a new cloud vault from a verified local backup
if necessary. No automated cross-project migration is included.

Disconnect clears local grants, not Google's permission. Revoke separately in
[Google Account permissions](https://myaccount.google.com/permissions).
Never transfer `data.json`, refresh tokens, or SecretStorage values between
devices. Each device obtains its own grant.

## Troubleshooting

| Symptom | Action |
| --- | --- |
| Plugin absent | Check folder ID, runtime files, Obsidian version; restart |
| Developer build / no configuration | Use a configured release; desktop developers can use Advanced personal credentials |
| Desktop grant on mobile | Clear old credentials and sign in with a hosted build |
| Sign-in timeout or HTTP 429 | Return to Obsidian and retry; operator should inspect limits without logging tokens |
| Cloud vault absent | Check account and OAuth client/project; do not delete old Drive files |
| Conflicts | Review conflict copies, save the desired original, then explicitly resolve |
| No sync while phone locked | Expected; resume Obsidian and sync in the foreground |

Automated simulations are not physical-device certification. Report OS, Obsidian
version, and sanitized symptoms only.
