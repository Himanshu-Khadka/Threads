# Install Threads 0.2.0 on Windows

This zip contains all source files and an already-built plugin. You do not
need to assemble the earlier chat snippets or compile anything to try it.

## Upgrade your existing plugin

1. Extract the zip and open its `threads` folder.
2. In Obsidian, disable Threads under Settings > Community plugins.
3. Open your test vault's `.obsidian/plugins/threads-sync` in File Explorer.
4. Replace only `main.js` and `manifest.json` with those from this zip's
   `threads/dist/threads-sync` folder. Also put its `styles.css` there.
5. Leave the installed `data.json` untouched. Do not delete your vault, notes,
   existing Git repository, or source history.
6. Enable Threads again. Settings > Threads should show version 0.2.0.
7. Your tutorial Client ID and secret should be imported automatically. Click
   Connect Google once to authorize this build. If credentials are absent,
   enter them in settings and click Save credentials first.
8. Click Check connection, then Run sample test.
9. Open a disposable Markdown note and use Ctrl+P > Threads: Upload current
   note copy. Find the new copy under your configured Drive folder, then your
   vault name and the note's original subfolders.

The expected results are an account connection notice, a passing sample test
with a new local sample note, and a verified Markdown copy on Drive.
Automatic synchronization and iPad support are not included yet.

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
- Folder missing: use the appropriate Reset folder action. Existing remote
  files are not deleted. Note uploads find or create the matching Threads
  folder; sample tests create a new test folder.
- Node import errors: use the included tsconfig.json with `types: ["node"]`,
  run npm ci, and ensure VS Code has this project folder open.

Do not put real credentials in source, terminal commands, screenshots, chat,
or Git commits. Enter them only in Threads settings.
