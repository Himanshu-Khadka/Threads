# Install Threads 0.3.0 on Windows

Use a disposable test vault first. This is a desktop Markdown sync preview,
not a production backup service. Keep an independent copy of your notes.

## Upgrade your existing plugin

1. Open the project in VS Code and run `npm ci`, then `npm run package`.
2. In Obsidian, disable Threads under Settings > Community plugins.
3. Open your test vault's `.obsidian/plugins/threads-sync` in File Explorer.
4. Replace only `main.js` and `manifest.json` with those from this zip's
   `dist/threads-sync` folder. Also put its `styles.css` there.
5. Leave the installed `data.json` untouched. Do not delete your vault, notes,
   existing Git repository, or source history.
6. Enable Threads again and open Settings > Threads.
7. Click Sign in with Google. An existing personal OAuth setup is retained.
   An unconfigured development build needs personal credentials under Advanced;
   public releases must be configured by the publisher using PUBLISHING.md.
8. Read the sync scope and click Create cloud vault on the first device.
   This opts in to uploading supported Markdown notes and downloading cloud notes.
9. On another desktop, sign in to the same account with the same app build,
   click Find existing vaults, select the matching vault, and click Start syncing.
10. Edit a test note and wait for the status to report synced. New and changed
    Markdown notes should transfer in both directions while both apps are open.

Pause with the Automatic sync toggle. Sync now runs one manual pass.
Conflicts keep your original note and put cloud versions in `_Threads conflicts`.
Review those files, edit the original as needed, then use Ctrl+P > Threads:
Resolve conflict using current note and confirm. Nothing is automatically deleted.

Attachments, settings, deletions, and iPad are not supported in this preview.
Renaming creates a new synced path but retains the old cloud note. Do not delete
Drive history to clean it up; that will stop integrity checks. On Drive, revision
filenames include IDs; normal note names are restored inside Obsidian.

## Optional Windows installer

With Threads disabled, use PowerShell inside the extracted `threads` folder:

```powershell
.\Install-Threads.ps1 -VaultPath 'C:\Users\YOUR-NAME\Documents\Sync-Lab' -Update
```

Use your actual vault path. The script backs up old code files under
`install-backups` in the extracted project, replaces only three runtime files,
and preserves data.json. Omit `-Update` for first installation. If Windows
blocks the script, use manual installation; no execution-policy change is needed.

## Working on the source

Open the extracted project in VS Code. Implementation files are now under
`src/`; do not mix this build with the loose tutorial files.

```powershell
npm ci
npm test
npm run package
```

Use the resulting `dist/threads-sync` files when updating Obsidian. README.md
explains the architecture, commands, security, and limitations.

## Troubleshooting

- Plugin missing: check the exact folder name `threads-sync` and ensure its
  manifest.json is directly inside it, not inside another nested folder.
- Old UI: update the vault you actually opened, then disable/re-enable Threads.
- Sign-in denied: check your test user, Desktop app OAuth client, and Drive API
  enablement in the same Google Cloud project.
- Invalid grant: reconnect. External Testing grants can expire after seven days.
- No cloud vaults: verify the same Google account AND the same OAuth app are
  used on both devices. Files created by a different app may not be visible.
- Missing history or integrity error: pause sync and restore affected Drive
  revisions from Trash or a backup. Do not reset checkpoints to hide the error.
- Another account: find/select a cloud vault belonging to the newly signed-in
  account. The previous checkpoint is backed up locally, not reused across accounts.
- Node import errors: use the included tsconfig.json with `types: ["node"]`,
  run npm ci, and ensure VS Code has this project folder open.

Do not put account tokens or private configuration in source, screenshots, chat,
or Git commits. Publisher configuration belongs in the ignored local file
described in PUBLISHING.md; personal configuration goes in Advanced settings.
