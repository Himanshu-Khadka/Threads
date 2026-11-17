# Changelog

## 0.4.1 - Versioned updates

- Add a single version-preparation command for package, lockfile, manifest, and compatibility history.
- Publish new versions merged into main after explicit one-time publisher setup.
- Test all three desktop OSes before building a configured beta release.
- Stage uploads as a draft, verify SHA-256 digests, and publish only complete packages.
- Resume matching draft uploads; reject version reuse, mismatched tags, and downgrades.
- Document BRAT automatic updates across desktop/mobile and future community-directory updates.
- Preserve the installed plugin ID and local data; no sync-state schema changes.

Hosted-auth deployment and actual BRAT update acceptance remain outstanding.

## 0.4.0 - Cross-platform preview

- Separate auth, platform, Drive, sync, settings, and UI modules.
- Remove obsolete root tutorial sources; preserve earlier work in Git history.
- Replace shared Node hashing/random/Buffer usage with browser-compatible APIs.
- Add independent hosted Google sign-in and refresh for mobile and desktop.
- Add a bounded, short-lived auth broker with PKCE, state, and polling proofs.
- Pause scheduled sync while the app is hidden and resume when visible.
- Add a plugin ZIP, cross-platform installer, and three-OS CI configuration.
- Add a mobile sandbox that forbids Node/Electron imports and omits Buffer.

The service still requires deployment and Google OAuth configuration. Physical
mobile sign-in and sync have not been validated. Attachments, rename/delete
propagation, and reliable mobile background sync remain unsupported.
