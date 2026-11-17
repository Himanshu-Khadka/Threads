import type { Server } from 'node:http';
import { ThreadsError } from '../shared/errors';
import { pkceChallenge } from './crypto';
import { DRIVE_SCOPE } from '../auth/constants';

function matchesState(actual: string | null, expected: string): boolean {
  const { timingSafeEqual } = require('node:crypto') as typeof import('node:crypto');
  const left = new TextEncoder().encode(actual ?? '');
  const right = new TextEncoder().encode(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

export class DesktopLogin {
  private cancelLogin?: () => void;
  constructor(private openBrowser: (url: string) => Promise<void>, private timeoutMs: number) {}
  cancel(): void { this.cancelLogin?.(); }
  receiveCode(clientId: string, verifier: string, state: string): Promise<{ code: string; redirectUri: string }> {
    const { createServer } = require('node:http') as typeof import('node:http');
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
          scope: DRIVE_SCOPE, access_type: 'offline', prompt: 'consent select_account',
          state, code_challenge: pkceChallenge(verifier), code_challenge_method: 'S256',
        }).toString();
        void this.openBrowser(url.toString()).catch(() => finish(new ThreadsError('Could not open your default browser.')));
      });
    });
  }
}
