import { sha256 } from '@noble/hashes/sha2.js';

const encoder = new TextEncoder();
export const byteLength = (text: string): number => encoder.encode(text).length;
export const digest = (text: string): string => Array.from(sha256(encoder.encode(text)), b => b.toString(16).padStart(2, '0')).join('');
export function base64url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
export const pkceChallenge = (text: string): string => base64url(sha256(encoder.encode(text)));
export function randomToken(): string { return base64url(globalThis.crypto.getRandomValues(new Uint8Array(32))); }
export function randomUUID(): string {
  const b = globalThis.crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6]! & 15) | 64; b[8] = (b[8]! & 63) | 128;
  const h = Array.from(b, v => v.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
