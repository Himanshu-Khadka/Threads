# Contributing

Use Node.js 24 and npm. Run `npm ci`, `npm run test:all`, and `npm run package`.
Use `src/main.ts` only as the Obsidian entry point; application wiring belongs
in `src/plugin.ts`. UI belongs in `src/ui`, authentication in `src/auth`,
platform-specific APIs in `src/platform`, Drive access in `src/drive`, and
the host-independent reconciliation engine in `src/sync`.

Never import Node or Electron at module scope in shipped plugin code. Guard
desktop-only calls with platform detection and keep the mobile sandbox smoke
test passing. Use Web APIs or bundled browser-compatible libraries for shared code.

Add tests for account changes, cancellation, interruptions, conflicts, and
untrusted paths when touching auth or sync. Do not commit account tokens,
client configuration, `.env` files, plugin data, notes, or build output.
Report security issues privately as described in SECURITY.md.

CI checks Linux, Windows, and macOS. Mobile sandbox tests do not replace
physical iPad/iPhone/Android acceptance tests. Record actual devices and results
in docs/VERIFICATION.md before claiming device support.
