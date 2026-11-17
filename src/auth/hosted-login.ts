import { pkceChallenge, randomToken } from '../platform/crypto';
import { ThreadsError } from '../shared/errors';
import { record } from '../drive/http';
import { DRIVE_SCOPE } from './constants';

export type HostedTransport = (url: string, body: string) => Promise<{ status: number; text: string }>;
export function brokerOrigin(raw: string): string {
  const url = new URL(raw);
  if (url.protocol !== 'https:' || url.username || url.password || url.port || url.pathname !== '/' || url.search || url.hash) {
    throw new ThreadsError('The authentication service must use a plain HTTPS origin.');
  }
  return url.origin;
}

export class HostedLogin {
  private cancelled = false;
  private wake?: () => void;
  private origin: string;
  constructor(origin: string, private clientId: string, private send: HostedTransport,
    private openBrowser: (url: string) => Promise<void>, private interval = 1500, private timeout = 600_000) {
    this.origin = brokerOrigin(origin);
  }
  cancel(): void { this.cancelled = true; this.wake?.(); }
  private active(): void { if (this.cancelled) throw new ThreadsError('Sign-in was cancelled.'); }
  private async request(path: string, data: Record<string, string>): Promise<Record<string, unknown>> {
    this.active();
    let response;
    try { response = await this.send(`${this.origin}${path}`, JSON.stringify(data)); }
    catch { throw new ThreadsError('Authentication service could not be reached. Retry sign-in.'); }
    this.active();
    if (response.status < 200 || response.status >= 300) throw new ThreadsError(`Authentication service rejected the request (HTTP ${response.status}). Retry sign-in.`);
    try { return record(JSON.parse(response.text)); }
    catch { throw new ThreadsError('Invalid authentication service response.'); }
  }
  async connect(): Promise<Record<string, unknown>> {
    const verifier = randomToken();
    const claimToken = randomToken();
    const started = await this.request('/v1/sessions', { challenge: pkceChallenge(verifier), claimHash: pkceChallenge(claimToken) });
    if (typeof started.id !== 'string' || !/^[\w-]{20,100}$/.test(started.id) || typeof started.authorizationUrl !== 'string') throw new ThreadsError('Invalid sign-in session.');
    const url = new URL(started.authorizationUrl);
    if (url.origin !== 'https://accounts.google.com' || url.pathname !== '/o/oauth2/v2/auth' ||
      url.searchParams.get('client_id') !== this.clientId || url.searchParams.get('code_challenge') !== pkceChallenge(verifier) ||
      url.searchParams.get('code_challenge_method') !== 'S256' || url.searchParams.get('redirect_uri') !== `${this.origin}/oauth/callback` ||
      url.searchParams.get('scope') !== DRIVE_SCOPE) throw new ThreadsError('Unexpected Google authorization URL.');
    await this.openBrowser(url.toString());
    const deadline = Date.now() + this.timeout;
    while (Date.now() < deadline) {
      const result = await this.request(`/v1/sessions/${started.id}/claim`, { verifier, claimToken });
      if (result.status !== 'pending') return result;
      await new Promise<void>(resolve => {
        const timer = setTimeout(() => { this.wake = undefined; resolve(); }, this.interval);
        this.wake = () => { clearTimeout(timer); this.wake = undefined; resolve(); };
      });
      this.active();
    }
    throw new ThreadsError('Sign-in timed out. Please try again.');
  }
  async refresh(refreshToken: string): Promise<Record<string, unknown>> {
    return this.request('/v1/refresh', { refreshToken });
  }
}
