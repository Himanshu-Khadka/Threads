# Install once, receive updates

Threads is distributed as a versioned **Obsidian plugin package**, not an npm
package that end users install. Its permanent plugin ID is `threads-sync`.
Every release has its own numeric version, Git tag, runtime files, ZIP, and
SHA-256 checksums. Normal updates replace code, not notes or local settings.

## Users: one-time setup

After the first configured release is published:

1. Install **BRAT** from Obsidian's Community plugins on each device.
2. Add `Himanshu-Khadka/Threads` as a beta plugin using **Latest**, not a frozen
   release tag. Enable Threads if it is not already enabled.
3. In BRAT settings, enable its automatic update check when Obsidian starts,
   or use its command to check for and update beta plugins manually.

BRAT manages downloading and reloading the plugin on desktop and mobile.
You do not need Node, Git, a terminal, or manual file copies for later updates.
Automatic checks depend on BRAT being enabled, the app running, network access,
and GitHub availability. This is not a push update while an iPad is suspended.

The existing plugin folder must remain `threads-sync`. Do not uninstall Threads
to update: uninstalling can remove its local settings. Use the same OAuth app
and account to retain your connection. Back up notes before beta updates, finish
an active sync, and review release notes. Refresh grants can still expire or be
revoked independently of an update.

Once Threads is accepted into Obsidian's community directory, users can switch
from BRAT to Obsidian's built-in update checks. That approval has not happened
yet. We do not install a second custom self-updater inside Threads.

## Maintainer: publish new features

Configure this once in GitHub Settings > Secrets and variables > Actions > Variables:

| Variable | Value |
| --- | --- |
| `THREADS_AUTH_ORIGIN` | Your deployed broker's plain HTTPS origin |
| `THREADS_GOOGLE_WEB_CLIENT_ID` | Matching public Web OAuth client ID |
| `THREADS_RELEASES_ENABLED` | `true`, after hosted sign-in and real-device acceptance |

The **Web client secret stays on the auth server**, never in this workflow or
the plugin package. Merge this workflow into `main` before expecting releases.

For a new patch release, from the repository:

```sh
npm run release:prepare -- patch
npm run test:all
```

Use `minor` for a new feature, `major` for an intentionally breaking release,
or an explicit higher `x.y.z`. The command updates package/lockfile, manifest,
and compatibility history together. It does not commit, tag, or publish.
Update `CHANGELOG.md`, commit the feature and version changes, then push/merge
into `main`. Work on a feature branch if you want review before distribution.

The Publish update workflow then:

1. Checks metadata and whether this version already exists.
2. Runs the complete test suite on Windows, macOS, and Linux.
3. Builds one hosted-auth plugin package from the triggering commit.
4. Creates a draft GitHub prerelease tied to that exact commit.
5. Uploads the five expected assets and compares GitHub's SHA-256 digests.
6. Publishes only after every asset matches. GitHub creates the version tag
   when needed. BRAT users following Latest can receive that release.

Pushing code **without a version bump does not replace an existing release**.
The first configured version is published if no release exists. While the
enable variable is absent/false, publication is skipped and regular CI still runs.
The Actions workflow can also be run manually on `main` after initial setup.
It intentionally produces beta releases until we make a separate stable-release
decision; a green test run is not permission to call the sync engine production-ready.

## Package contents

`npm run package` builds a local developer package. `npm run package:release`
requires hosted sign-in configuration. Both write a version-specific directory
under `dist/releases/<version>/`:

| Asset | Purpose |
| --- | --- |
| `main.js` | Compiled plugin, directly consumed by Obsidian/BRAT |
| `manifest.json` | Stable ID, version, and minimum Obsidian version |
| `styles.css` | Plugin styles |
| `threads-sync-<version>.zip` | Manual-install package containing only those three files |
| `SHA256SUMS` | Checksums for the other four assets |

`dist/threads-sync/` remains available for the local installer. The publisher
uses an exact allowlist, not every file in `dist`. It never includes `data.json`,
sync checkpoints, notes, credentials, source, or `node_modules`. Checksums detect
corruption; they are not an independent publisher signature. Users still trust
the repository owner and GitHub/BRAT distribution chain.

## Failure and recovery

- Failed tests/configuration: nothing is published.
- Interrupted upload: the release stays a draft. Rerun the **same workflow run**;
  matching assets are reused. A draft tied to another commit is rejected.
- Hash mismatch/extra asset: publication stops. Inspect the draft; do not
  overwrite a published release or force-move its tag.
- Bad published code: fix it and publish a higher patch version. Do not replace
  bytes under an existing version number.
- Emergency local rollback: disable auto-updates, pause Threads, back up the
  vault/settings, then explicitly install a previously tested version. Downgrades
  are not guaranteed compatible with future settings or cloud protocol changes.

Keep settings and cloud-format migrations explicit and backward-compatible
where possible. Unknown settings schemas already stop loading instead of
resetting user data. This release changes packaging, not the sync-state schema.
The authentication broker is deployed separately; this workflow updates only
the plugin. Keep its `/v1` API compatible with already installed clients and
deploy any required server changes before a dependent plugin release.

## Current readiness

There is no configured hosted release yet. The auth broker still needs deployment,
Google OAuth configuration, and real-device acceptance. The publisher is tested
against simulated GitHub responses; actual publication and BRAT update delivery
remain acceptance checks after that setup. Nothing here promises flawless updates.

References: [BRAT update controls](https://tfthacker.com/brat-quick-guide),
[Obsidian release format](https://docs.obsidian.md/plugins/releasing/submit-plugin),
[GitHub asset digests](https://github.blog/changelog/2025-06-03-releases-now-expose-digests-for-release-assets/).
