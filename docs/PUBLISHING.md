# Configure and publish Threads

Each device independently authorizes its own Google account. Notes stay in that
user's Drive. The publisher operates a small HTTPS authentication broker, which
does not relay notes but **does handle account tokens and must be trusted**.

## 1. Configure Google

1. Enable Google Drive API in your Google Cloud project.
2. Configure Google Auth Platform branding, audience, support contact, and
   `https://www.googleapis.com/auth/drive.file`. Start with explicit test users.
3. Create a **Web application** OAuth client for hosted sign-in, with exact redirect
   `https://YOUR_AUTH_DOMAIN/oauth/callback`.
4. Keep the Web client secret on the server only. Use the same public client ID
   and origin in the plugin and broker. Never distribute the Web secret, Web
   client JSON, or account tokens.
5. Before broad release, complete applicable Google production/branding/verification
   requirements and publish privacy/support pages explaining token handling.
   Testing grants can expire; organizational account policies can block access.

## 2. Deploy the broker

`services/auth-broker/server.mjs` uses Node.js 22.12+ built-ins, with no database
or runtime npm dependencies. It is a **single-instance pilot**, not an audited
multi-tenant production service.

| Runtime variable | Meaning |
| --- | --- |
| `AUTH_ORIGIN` | Exact HTTPS origin, no path or trailing slash |
| `GOOGLE_CLIENT_ID` | Public Web application client ID |
| `GOOGLE_CLIENT_SECRET` | Server-only Web client secret |
| `HOST` | Bind address, default `127.0.0.1` |
| `PORT` | Listen port, default `8787` |

Provide values through your secret manager/process environment and run
`node services/auth-broker/server.mjs`. The script does not load an env file
automatically. The public callback must be reachable over HTTPS; do not expose
the Node HTTP listener directly to the internet.

For the included Docker Compose/Caddy example, point a domain at your server.
Create an **untracked** `services/auth-broker/.env` containing:

```dotenv
AUTH_DOMAIN=auth.your-domain.example
GOOGLE_CLIENT_ID=replace-with-web-client-id
GOOGLE_CLIENT_SECRET=replace-with-server-only-value
```

Restrict file access, allow incoming HTTPS/HTTP for certificates, and from
`services/auth-broker/` run:

```sh
docker compose up --build -d
```

Compose injects secrets into the container environment; host administrators can
read them. Caddy terminates HTTPS and proxies internally. `GET /health` is a
generic health probe. Docker/HTTPS deployment has not been exercised here.

### Operational requirements

- Disable URL/query/body logging at every proxy, CDN, APM, and host layer. OAuth
  callback URLs contain codes. The example does not enable access logging.
- Session states, codes, and cached login results remain in memory for up to
  ten minutes. Restart interrupts sign-in. Run one instance; replicas require
  deliberately designed shared session storage.
- Bounds: 1000 sessions, 16 KiB request bodies, 120 requests and 20 login starts
  per IP per minute. Each pending login polls every 1.5 seconds. Behind the
  included proxy, all requests share its IP, so limits become conservative
  global limits. This is for a small pilot, not public scale. Add trusted-edge
  abuse controls and load tests first; do not blindly trust forwarded IP headers.
- No account database is stored. Refresh tokens pass through `/v1/refresh`.
  During service outages, cached access tokens work until expiry; local notes
  remain usable offline.
- Monitor sanitized counts/status, not credentials or content. Review container
  updates, secret rotation, and incident procedures.

## 3. Build a configured plugin

Build variables contain **public configuration only**:

```sh
export THREADS_AUTH_ORIGIN="https://auth.your-domain.example"
export THREADS_GOOGLE_WEB_CLIENT_ID="YOUR_ID.apps.googleusercontent.com"
npm ci
npm run test:all
npm run package:release
```

PowerShell:

```powershell
$env:THREADS_AUTH_ORIGIN = "https://auth.your-domain.example"
$env:THREADS_GOOGLE_WEB_CLIENT_ID = "YOUR_ID.apps.googleusercontent.com"
npm ci
npm run test:all
npm run package:release
```

The builder embeds the origin and public ID, never reads `GOOGLE_CLIENT_SECRET`,
and rejects a release with no app configuration. Ordinary `npm run package`
can build an unconfigured development artifact; build success does not mean
Google sign-in is ready.

Desktop-only personal development can use Advanced settings or an ignored
`google-client.local.json` downloaded for a **Desktop app** client (`installed`
JSON object). It uses loopback and does not enable mobile login. Do not ship it
as the cross-platform release.

## 4. Test, then publish a beta

Complete [real-device acceptance](VERIFICATION.md), including live Google Web
client exchange/refresh and the iPad browser return. Fixtures cannot prove
provider configuration or operating-system behavior.

The release workflow runs on a numeric tag such as `0.4.0`, without a `v`
prefix, matching the manifest. Configure repository Actions **variables**
`THREADS_AUTH_ORIGIN` and `THREADS_GOOGLE_WEB_CLIENT_ID`; no Web client secret
belongs in that workflow. Review/merge the source, then tag the tested commit
and push that tag. Tests run before a configured GitHub **prerelease** is created.

Assets are `main.js`, `manifest.json`, `styles.css`, and
`threads-sync-0.4.0.zip`. Keep package/lockfile, manifest, `versions.json`, and
tag consistent. GitHub source archives are not installable plugin packages;
CI artifacts are development builds, not configured public releases.

BRAT can install the beta on mobile and desktop. Community-directory publication
also requires Obsidian review and a repository license explicitly chosen by the
owner; this refactor does not select a legal license for you.

Pushing this code does not deploy the broker, publish the Google app, create a
release tag, or submit to Obsidian automatically.

## References

- [Google web-server OAuth](https://developers.google.com/identity/protocols/oauth2/web-server)
- [Google OAuth best practices](https://developers.google.com/identity/protocols/oauth2/resources/best-practices)
- [Drive scopes](https://developers.google.com/workspace/drive/api/guides/api-specific-auth)
- [Obsidian mobile development](https://docs.obsidian.md/Plugins/Getting%20started/Mobile%20development)
- [Obsidian sample releases](https://github.com/obsidianmd/obsidian-sample-plugin)
- [BRAT release assets](https://github.com/TfTHacker/obsidian42-brat/blob/main/BRAT-DEVELOPER-GUIDE.md)
