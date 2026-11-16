# Uploaded folder correction - 2026-11-16

The project contains both the earlier tutorial files in the root and the
complete desktop implementation under src/. esbuild already builds src/main.ts,
but tsconfig.json was checking only root-level *.ts files.

Updated tsconfig.json to check src/**/*.ts and tests/**/*.ts. This aligns
type checking with the code actually installed in Obsidian.

Use src/ for further development. The older root TypeScript files and files
with "copy" in their names were preserved unchanged for reference; they are
not build entry points. Git metadata and the original dependency files were
also preserved in the returned archive. No Git commit or push was made.

Run npm ci in your local project before developing, so dependencies match
package-lock.json and your operating system. Use npm run package to rebuild
dist/threads-sync, then follow START_HERE.md to update Obsidian.

This correction does not add automatic multi-device synchronization. Live
Windows/Google testing remains required.

Verification after the correction: package build passed, all 53 tests passed,
and the compiled-plugin smoke test passed. TypeScript's resolved file list
includes all src/ and tests/ files and excludes the legacy root TypeScript files.
