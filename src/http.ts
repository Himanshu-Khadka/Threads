import { ThreadsError } from './errors';

export interface HttpRequest {
  url: string;
  method: 'GET' | 'POST';
  headers?: Record<string, string>;
  body?: string;
}
export interface HttpResponse { status: number; text: string }
export type Transport = (request: HttpRequest) => Promise<HttpResponse>;

export function assertGoogleUrl(raw: string): void {
  const url = new URL(raw);
  if (url.protocol !== 'https:' || url.username || url.password || url.port ||
    !['oauth2.googleapis.com', 'www.googleapis.com'].includes(url.hostname)) {
    throw new ThreadsError('Blocked an unexpected network destination.');
  }
}

export class GoogleHttp {
  constructor(private transport: Transport) {}

  async send(request: HttpRequest): Promise<string> {
    assertGoogleUrl(request.url);
    let response: HttpResponse;
    try { response = await this.transport(request); }
    catch { throw new ThreadsError('Google could not be reached. Check your internet connection.'); }
    if (response.status < 200 || response.status >= 300) {
      if (response.status === 401) throw new ThreadsError('Google authorization expired. Reconnect Google in Threads settings.');
      if (response.status === 403) throw new ThreadsError('Google denied access. Check that Drive API is enabled and the requested permission was granted.');
      if (response.status === 429) throw new ThreadsError('Google rate limit reached. Wait before trying again.');
      if (response.status === 400 && request.url === 'https://oauth2.googleapis.com/token') {
        throw new ThreadsError('Google rejected authorization. Check the Desktop OAuth credentials, or reconnect if the grant expired.');
      }
      throw new ThreadsError(`Google request failed (HTTP ${response.status}). Try again later.`);
    }
    return response.text;
  }

  async json(request: HttpRequest): Promise<unknown> {
    const text = await this.send(request);
    try { return JSON.parse(text) as unknown; }
    catch { throw new ThreadsError('Google returned an invalid response.'); }
  }
}

export function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ThreadsError('Google returned an unexpected response.');
  }
  return value as Record<string, unknown>;
}
