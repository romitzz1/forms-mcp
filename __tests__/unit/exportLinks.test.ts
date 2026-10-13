// ABOUTME: Unit tests for signed export download links (HMAC signing, integrity, expiry)
// ABOUTME: Covers tampering, wrong keys, malformed inputs, and the export-expiry cap

import {
  checkSignature,
  deriveLinkKey,
  isLinkExpired,
  linkExpiryUnix,
  signExportUrl,
} from '../../utils/exportLinks';

const ID = 'AbCdEfGhIjKlMnOpQrStUv';
const key = deriveLinkKey('token-one');

function parse(url: string): { id: string; exp: string; sig: string } {
  const u = new URL(url);
  return {
    id: u.pathname.split('/').pop() ?? '',
    exp: u.searchParams.get('exp') ?? '',
    sig: u.searchParams.get('sig') ?? '',
  };
}

describe('exportLinks', () => {
  it('builds <base>/exports/<id>?exp=&sig= and strips a trailing slash from base', () => {
    const url = signExportUrl('http://nas.local:9807/', ID, 1900000000, key);
    expect(url.startsWith(`http://nas.local:9807/exports/${ID}?exp=1900000000&sig=`)).toBe(true);
  });

  it('round-trips a valid signature', () => {
    const { id, exp, sig } = parse(signExportUrl('http://h:1', ID, 1900000000, key));
    expect(checkSignature(id, exp, sig, key)).toBe(true);
  });

  it('rejects a tampered id, exp, or sig', () => {
    const { id, exp, sig } = parse(signExportUrl('http://h:1', ID, 1900000000, key));
    expect(checkSignature('ZZZZZZZZZZZZZZZZZZZZZZ', exp, sig, key)).toBe(false);
    expect(checkSignature(id, '1900000001', sig, key)).toBe(false);
    expect(checkSignature(id, exp, sig.slice(0, -1) + (sig.endsWith('A') ? 'B' : 'A'), key)).toBe(false);
  });

  it('rejects a signature made with a different token', () => {
    const { id, exp, sig } = parse(signExportUrl('http://h:1', ID, 1900000000, deriveLinkKey('token-two')));
    expect(checkSignature(id, exp, sig, key)).toBe(false);
  });

  it('rejects non-numeric exp and length-mismatched sig without throwing', () => {
    expect(checkSignature(ID, 'soon', 'abc', key)).toBe(false);
    expect(checkSignature(ID, '1900000000', 'x', key)).toBe(false);
    expect(checkSignature(ID, '1900000000', '', key)).toBe(false);
  });

  it('reports link expiry', () => {
    expect(isLinkExpired(100, 99)).toBe(false);
    expect(isLinkExpired(100, 100)).toBe(true);
  });

  it('caps link expiry at the export expiry', () => {
    const now = Date.UTC(2026, 9, 13, 12, 0, 0);
    const exportExpiresSoon = new Date(now + 5 * 60 * 1000);
    const exportExpiresLater = new Date(now + 24 * 60 * 60 * 1000);
    expect(linkExpiryUnix(now, 60, exportExpiresSoon)).toBe(Math.floor(exportExpiresSoon.getTime() / 1000));
    expect(linkExpiryUnix(now, 60, exportExpiresLater)).toBe(Math.floor(now / 1000) + 3600);
  });
});
