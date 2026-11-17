# Folder-aware note uploads

New note copies use this layout:

`My Drive / Threads / Your vault / Original note folders / Timestamped note.md`

The top-level name comes from Settings > Threads > Note-copy folder. Existing
Threads-created folders are reused. Existing uploads are not moved or deleted.
This remains manual copy upload, not automatic synchronization.

Run `npm ci`, `npm test`, `npm run smoke`, and `npm run package`.
Disable Threads in Obsidian and copy the three files from `dist/threads-sync`
to your vault's `.obsidian/plugins/threads-sync`, keeping `data.json` untouched.
Re-enable Threads, open a note inside a subfolder, and upload its copy.
Last verified note upload shows the destination path and Drive folder URL.

If developing directly in the installed plugin folder, `npm run dev` updates
`main.js`; disable and re-enable Threads after the build.

Verified with mocked Google responses: 66 tests, strict type checking, bundle
build, and the compiled plugin smoke test. Live Windows/Drive testing is still
needed. Connection-test files intentionally remain in their separate test folder.
