import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import { GoogleHttp, record } from './http';
import { ThreadsError } from './errors';

export const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file';
export interface Credentials {
  clientId: string;
  clientSecret: string;
  refreshToken?: string;
}
interface AccessToken { value: string; expiresAt: number }

export function pkceChallenge(verifier: string): string {
  return createHash('sha256').update(verifier).digest('base64url');
}

function matchesState(actual: string | null, expected: string): boolean {
  const left = Buffer.from(actual ?? '');
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

export class GoogleAuth {
  private cached?: AccessToken;
  private refreshing?: Promise<string>;
  private cancelLogin?: () => void;
  private generation = 0;

  constructor(
    private http: GoogleHttp,
    private read: () => Credentials,
    private save: (credentials: Credentials) => void,
    private openBrowser: (url: string) => Promise<void>,
    private timeoutMs = 180_000,
  ) {}

  reset(): void {
    this.generation++;
    this.cancelLogin?.();
    this.cached = undefined;
  }

  async connect(): Promise<void> {
    if (this.cancelLogin) throw new ThreadsError('Google sign-in is already open.');
    const credentials = this.read();
    if (!credentials.clientId || !credentials.clientSecret) {
      throw new ThreadsError('Save your Google Desktop OAuth client ID and client secret first.');
    }
    const generation = this.generation;
    const verifier = randomBytes(32).toString('base64url');
    const state = randomBytes(32).toString('base64url');
    const { code, redirectUri } = await this.receiveCode(credentials.clientId, verifier, state);
    if (generation !== this.generation) throw new ThreadsError('Sign-in was cancelled.');
    const body = new URLSearchParams({
      client_id: credentials.clientId, client_secret: credentials.clientSecret,
      code, code_verifier: verifier, redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    });
    const token = record(await this.http.json({
      url: 'https://oauth2.googleapis.com/token', method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: body.toString(),
    }));
    if (generation !== this.generation) throw new ThreadsError('Sign-in was cancelled.');
    if (typeof token.refresh_token !== 'string' || !token.refresh_token) {
      throw new ThreadsError('Google did not issue offline access. Reconnect and approve the requested permission.');
    }
    if (typeof token.scope === 'string' && !token.scope.split(' ').includes(DRIVE_SCOPE)) {
      throw new ThreadsError('Google Drive file access was not granted.');
    }
    const access = this.parseToken(token);
    this.save({ ...credentials, refreshToken: token.refresh_token });
    this.cached = access;
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
    const token = record(await this.http.json({
      url: 'https://oauth2.googleapis.com/token', method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: body.toString(),
    }));
    if (generation !== this.generation) throw new ThreadsError('Authorization changed. Try connecting again.');
    this.cached = this.parseToken(token);
    return this.cached.value;
  }

  private parseToken(token: Record<string, unknown>): AccessToken {
    if (typeof token.access_token !== 'string' || !token.access_token ||
      typeof token.expires_in !== 'number' || !Number.isFinite(token.expires_in) || token.expires_in <= 0 ||
      token.token_type !== 'Bearer') throw new ThreadsError('Google returned an invalid access token.');
    return { value: token.access_token, expiresAt: Date.now() + token.expires_in * 1000 };
  }

  private receiveCode(clientId: string, verifier: string, state: string): Promise<{ code: string; redirectUri: string }> {
    return new Promise((resolve, reject) => {
      let redirectUri = '';
      let completed = false;
      let server: Server;
      const finish = (error?: ThreadsError, code?: string) => {
        if (completed) return;
        completed = true;
        clearTimeout(timer);
        this.cancelLogin = undefined;
        server.close();
        server.closeAllConnections();
        if (error) reject(error);
        else resolve({ code: code!, redirectUri });
      };
      server = createServer((req, res) => {
        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        res.setHeader('Cache-Control', 'no-store');
        res.setHeader('Content-Security-Policy', "default-src 'none'");
        let url: URL;
        try { url = new URL(req.url ?? '/', 'http://127.0.0.1'); }
        catch { res.writeHead(400).end('Invalid request.'); return; }
        if (req.method !== 'GET' || url.pathname !== '/oauth/callback') {
          res.writeHead(404).end('Not found.'); return;
        }
        if (!matchesState(url.searchParams.get('state'), state)) {
          res.writeHead(400).end('Invalid sign-in state. Return to the original Google sign-in tab.'); return;
        }
        if (url.searchParams.has('error')) {
          res.end('Sign-in was not completed. Return to Obsidian.', () =>
            finish(new ThreadsError('Google sign-in was declined or cancelled.')));
          return;
        }
        const code = url.searchParams.get('code');
        if (!code) { res.writeHead(400).end('Missing authorization code.'); return; }
        res.end('Authorization received. Return to Obsidian to check the connection result.', () => finish(undefined, code));
      });
      const timer = setTimeout(() => finish(new ThreadsError('Sign-in timed out. Click Connect Google to try again.')), this.timeoutMs);
      this.cancelLogin = () => finish(new ThreadsError('Google sign-in was cancelled.'));
      server.on('error', () => finish(new ThreadsError('Could not open the local sign-in callback. Try again.')));
      server.listen(0, '127.0.0.1', () => {
        if (completed) { server.close(); return; }
        const address = server.address();
        if (!address || typeof address === 'string') {
          finish(new ThreadsError('Could not start the local sign-in callback.')); return;
        }
        redirectUri = `http://127.0.0.1:${address.port}/oauth/callback`;
        const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
        url.search = new URLSearchParams({
          client_id: clientId, redirect_uri: redirectUri, response_type: 'code',
          scope: DRIVE_SCOPE, access_type: 'offline', prompt: 'consent',
          state, code_challenge: pkceChallenge(verifier), code_challenge_method: 'S256',
        }).toString();
        void this.openBrowser(url.toString()).catch(() => finish(new ThreadsError('Could not open your default browser.')));
      });
    });
  }
}
