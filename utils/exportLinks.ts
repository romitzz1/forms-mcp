// ABOUTME: Signs and verifies short-lived export download URLs with HMAC-SHA256
// ABOUTME: Key is derived from MCP_AUTH_TOKEN; integrity and expiry are checked separately

import { createHmac, timingSafeEqual } from 'node:crypto';

const KEY_CONTEXT = 'gf-export-links';

export function deriveLinkKey(authToken: string): Buffer {
  return createHmac('sha256', authToken).update(KEY_CONTEXT).digest();
}

function sign(id: string, exp: string, key: Buffer): string {
  return createHmac('sha256', key).update(`${id}.${exp}`).digest('base64url');
}

export function signExportUrl(baseUrl: string, id: string, expUnix: number, key: Buffer): string {
  const base = baseUrl.replace(/\/+$/, '');
  const exp = String(expUnix);
  return `${base}/exports/${id}?exp=${exp}&sig=${sign(id, exp, key)}`;
}

export function checkSignature(id: string, exp: string, sig: string, key: Buffer): boolean {
  if (!/^\d+$/.test(exp)) return false;
  const expected = Buffer.from(sign(id, exp, key));
  const provided = Buffer.from(sig);
  if (expected.length !== provided.length) return false;
  return timingSafeEqual(expected, provided);
}

export function isLinkExpired(expUnix: number, nowUnix: number): boolean {
  return nowUnix >= expUnix;
}

export function linkExpiryUnix(nowMs: number, ttlMinutes: number, exportExpiresAt: Date): number {
  const ttlExpiry = nowMs + ttlMinutes * 60 * 1000;
  return Math.floor(Math.min(ttlExpiry, exportExpiresAt.getTime()) / 1000);
}
