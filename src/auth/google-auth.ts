import { randomToken } from '../platform/crypto';
export { pkceChallenge } from '../platform/crypto';
import { DesktopLogin } from '../platform/desktop-login';
import { HostedLogin, type HostedTransport } from './hosted-login';
import { GoogleHttp, record } from '../drive/http';
import { ThreadsError } from '../shared/errors';
import { DRIVE_SCOPE } from './constants';

export { DRIVE_SCOPE } from './constants';
export interface Credentials {
  clientId: string;
  clientSecret: string;
  refreshToken?: string;
  brokerUrl?: string;
}
interface AccessToken { value: string; expiresAt: number }

export class GoogleAuth {
  private cached?: AccessToken;
  private refreshing?: Promise<string>;
  private desktopLogin: DesktopLogin;
  private hostedLogin?: HostedLogin;
  private connecting = false;
  private generation = 0;

  constructor(
    private http: GoogleHttp,
    private read: () => Credentials,
    private save: (credentials: Credentials) => void,
    private openBrowser: (url: string) => Promise<void>,
    timeoutMs = 180_000,
    private desktop = true,
    private hostedTransport?: HostedTransport,
  ) { this.desktopLogin = new DesktopLogin(openBrowser, timeoutMs); }

  reset(): void {
    this.generation++;
    this.desktopLogin.cancel();
    this.hostedLogin?.cancel();
    this.cached = undefined;
  }

  async connect(): Promise<void> {
    if (this.connecting) throw new ThreadsError('Google sign-in is already open.');
    this.connecting = true;
    try {
      const credentials = this.read();
      const generation = this.generation;
      let token: Record<string, unknown>;
      if (credentials.brokerUrl) {
        if (!this.hostedTransport) throw new ThreadsError('Hosted sign-in transport is unavailable.');
        this.hostedLogin = new HostedLogin(credentials.brokerUrl, credentials.clientId, this.hostedTransport, this.openBrowser);
        token = await this.hostedLogin.connect();
      } else {
        if (!this.desktop) throw new ThreadsError('Mobile sign-in requires a hosted-auth release. Desktop OAuth cannot run on this device.');
        if (!credentials.clientId || !credentials.clientSecret) throw new ThreadsError('Save your Google Desktop OAuth client ID and client secret first.');
        const verifier = randomToken();
        const { code, redirectUri } = await this.desktopLogin.receiveCode(credentials.clientId, verifier, randomToken());
        if (generation !== this.generation) throw new ThreadsError('Sign-in was cancelled.');
        const body = new URLSearchParams({ client_id: credentials.clientId, client_secret: credentials.clientSecret,
          code, code_verifier: verifier, redirect_uri: redirectUri, grant_type: 'authorization_code' });
        token = record(await this.http.json({ url: 'https://oauth2.googleapis.com/token', method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: body.toString() }));
      }
      if (generation !== this.generation) throw new ThreadsError('Sign-in was cancelled.');
      if (typeof token.refresh_token !== 'string' || !token.refresh_token) throw new ThreadsError('Google did not issue offline access. Reconnect and approve the requested permission.');
      if (typeof token.scope === 'string' && !token.scope.split(' ').includes(DRIVE_SCOPE)) throw new ThreadsError('Google Drive file access was not granted.');
      const access = this.parseToken(token);
      this.save({ ...credentials, refreshToken: token.refresh_token });
      this.cached = access;
    } finally { this.connecting = false; }
  }

  async accessToken(): Promise<string> {
    if (this.cached && this.cached.expiresAt > Date.now() + 60_000) return this.cached.value;
    if (this.refreshing) return this.refreshing;
    this.refreshing = this.refresh();
    try { return await this.refreshing; }
    finally { this.refreshing = undefined; }
  }

  private async refresh(): Promise<string> {
    const generation = this.generation;
    const credentials = this.read();
    if (!credentials.refreshToken) throw new ThreadsError('Connect Google in Threads settings first.');
    const body = new URLSearchParams({
      client_id: credentials.clientId, client_secret: credentials.clientSecret,
      refresh_token: credentials.refreshToken, grant_type: 'refresh_token',
    });
    let token: Record<string, unknown>;
    if (credentials.brokerUrl) {
      if (!this.hostedTransport) throw new ThreadsError('Hosted sign-in transport is unavailable.');
      token = await new HostedLogin(credentials.brokerUrl, credentials.clientId, this.hostedTransport, this.openBrowser).refresh(credentials.refreshToken);
    } else {
      if (!this.desktop) throw new ThreadsError('Desktop grants cannot be refreshed on mobile. Sign in using a hosted-auth release.');
      token = record(await this.http.json({
        url: 'https://oauth2.googleapis.com/token', method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: body.toString(),
      }));
    }
    if (generation !== this.generation) throw new ThreadsError('Authorization changed. Try connecting again.');
    const access = this.parseToken(token);
    if (typeof token.refresh_token === 'string' && token.refresh_token && token.refresh_token !== credentials.refreshToken) {
      this.save({ ...credentials, refreshToken: token.refresh_token });
    }
    this.cached = access;
    return this.cached.value;
  }

  private parseToken(token: Record<string, unknown>): AccessToken {
    if (typeof token.access_token !== 'string' || !token.access_token ||
      typeof token.expires_in !== 'number' || !Number.isFinite(token.expires_in) || token.expires_in <= 0 ||
      token.token_type !== 'Bearer') throw new ThreadsError('Google returned an invalid access token.');
    return { value: token.access_token, expiresAt: Date.now() + token.expires_in * 1000 };
  }

}
