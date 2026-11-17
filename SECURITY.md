# Security

This is preview software, not an audited sync service. Test disposable vaults
and keep separate backups. Report vulnerabilities through the repository's
private vulnerability reporting feature if enabled; otherwise contact the
maintainer privately. Never paste credentials or private notes into public issues.

The hosted broker is a sensitive trust boundary: it handles Google authorization
codes and account access/refresh tokens. It does not receive note contents or
store an account database, but the service operator can technically access the
authorized Drive files using these tokens. Users must trust the operator.
Login results remain in process memory for at most ten minutes to handle lost
responses; refresh responses are not retained by the application. Disable
request/body/query-string logging in every proxy, CDN, and monitoring layer.

Only the server receives the Google Web client secret. The plugin contains
only the public Web client ID and HTTPS service origin. Refresh tokens are
stored in Obsidian SecretStorage, which is not isolation from all other plugins.
Tokens and OAuth codes never appear in mobile deep links.

Do not disable scanning globally for a false-positive finding. Review and
document the exact finding. Rotate genuine exposed credentials before attempting
history cleanup. The old `url.password` property-read finding is not a stored
password and does not justify removing URL validation.
