// ABOUTME: Unit tests for the filesystem export store (save/get/open/read, sweep, legacy scan)
// ABOUTME: Uses a real temp dir and an injected clock; never prints file contents

import { createHash } from 'node:crypto';
import { promises as fsp } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  ExportDirUnwritableError,
  ExportExpiredError,
  ExportNotFoundError,
  ExportStore,
  ExportTooLargeError,
  isValidExportId,
  sanitizeExportFilename,
} from '../../utils/exportStore';

const DAY = 24 * 60 * 60 * 1000;
const sha = (s: string | Buffer) => createHash('sha256').update(s).digest('hex');

describe('ExportStore', () => {
  let dir: string;
  let nowMs: number;
  let store: ExportStore;

  beforeEach(async () => {
    dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'gf-store-'));
    nowMs = Date.now();
    store = new ExportStore({ dir, retentionDays: 7, now: () => new Date(nowMs) });
  });

  afterEach(async () => {
    await fsp.rm(dir, { recursive: true, force: true });
  });

  it('saves under store/<id>/ and gets it back with metadata', async () => {
    const rec = await store.save('a,b\n1,2', 'report.csv', 'csv');
    expect(isValidExportId(rec.id)).toBe(true);
    expect(rec.localPath).toBe(path.join(dir, 'store', rec.id, 'report.csv'));
    expect(rec.mimeType).toBe('text/csv; charset=utf-8');
    expect(rec.size).toBe(7);
    expect(rec.expiresAt.getTime() - rec.createdAt.getTime()).toBe(7 * DAY);
    const again = await store.get(rec.id);
    expect(again.filename).toBe('report.csv');
    expect(sha(await store.readText(rec.id, 1000))).toBe(sha('a,b\n1,2'));
  });

  it('leaves nothing in staging after a save', async () => {
    await store.save('{}', 'x.json', 'json');
    expect(await fsp.readdir(path.join(dir, 'store', '.staging'))).toEqual([]);
  });

  it('rejects malformed ids as not found (no traversal)', async () => {
    for (const bad of ['..', '../../etc', 'a/b', 'short', 'x'.repeat(23)]) {
      await expect(store.get(bad)).rejects.toBeInstanceOf(ExportNotFoundError);
    }
    await expect(store.get('AbCdEfGhIjKlMnOpQrStUv')).rejects.toBeInstanceOf(ExportNotFoundError);
  });

  it('sanitizes filenames and forces the format extension', () => {
    expect(sanitizeExportFilename('../../etc/passwd', 'json')).toBe('_.._etc_passwd.json');
    expect(sanitizeExportFilename('Résumé list.csv', 'csv')).toBe('R_sum__list.csv');
    expect(sanitizeExportFilename('backup.txt', 'json')).toBe('backup.txt.json');
    expect(sanitizeExportFilename('...', 'csv')).toBe('export.csv');
    expect(sanitizeExportFilename('a'.repeat(300), 'csv')).toHaveLength(128);
  });

  it('reports expiry past retention', async () => {
    const rec = await store.save('x', 'x.csv', 'csv');
    nowMs += 8 * DAY;
    await expect(store.get(rec.id)).rejects.toBeInstanceOf(ExportExpiredError);
  });

  it('enforces the read cap', async () => {
    const rec = await store.save('x'.repeat(100), 'x.csv', 'csv');
    await expect(store.readText(rec.id, 10)).rejects.toMatchObject({ size: 100 });
    await expect(store.readText(rec.id, 10)).rejects.toBeInstanceOf(ExportTooLargeError);
  });

  it('keeps streaming full content from an opened handle after the file is deleted', async () => {
    const body = 'y'.repeat(50000);
    const rec = await store.save(body, 'big.csv', 'csv');
    const { handle, record } = await store.open(rec.id);
    await fsp.rm(path.join(dir, 'store', rec.id), { recursive: true, force: true });
    const data = await handle.readFile();
    await handle.close();
    expect(record.size).toBe(50000);
    expect(sha(data)).toBe(sha(body));
  });

  it('sweeps expired exports and stale staging, but never touches siblings of store/', async () => {
    const keep = await store.save('k', 'k.csv', 'csv');
    const old = await store.save('o', 'o.csv', 'csv');
    const oldTime = new Date(nowMs - 8 * DAY);
    await fsp.utimes(old.localPath, oldTime, oldTime);
    const staleStaging = path.join(dir, 'store', '.staging', 'AbCdEfGhIjKlMnOpQrStUv');
    await fsp.mkdir(staleStaging, { recursive: true });
    const twoHoursAgo = new Date(nowMs - 2 * 60 * 60 * 1000);
    await fsp.utimes(staleStaging, twoHoursAgo, twoHoursAgo);
    // Legacy-shaped and user-made siblings, all ancient
    const legacy = path.join(dir, '300', '2026-05-02');
    await fsp.mkdir(legacy, { recursive: true });
    await fsp.writeFile(path.join(legacy, 'analyze.mjs'), 'x');
    await fsp.mkdir(path.join(dir, 'Club_Roster_2024_Final'));
    await fsp.utimes(path.join(legacy, 'analyze.mjs'), oldTime, oldTime);

    const removed = await store.sweep();

    expect(removed).toBe(2);
    await expect(store.get(old.id)).rejects.toBeInstanceOf(ExportNotFoundError);
    expect((await store.get(keep.id)).id).toBe(keep.id);
    await expect(fsp.stat(path.join(legacy, 'analyze.mjs'))).resolves.toBeDefined();
    await expect(fsp.stat(path.join(dir, 'Club_Roster_2024_Final'))).resolves.toBeDefined();
  });

  it('counts legacy-layout files without deleting them', async () => {
    await fsp.mkdir(path.join(dir, '95', '2026-01-10'), { recursive: true });
    await fsp.writeFile(path.join(dir, '95', '2026-01-10', 'a.json'), '1');
    await fsp.writeFile(path.join(dir, '95', '2026-01-10', 'b.csv'), '1');
    await fsp.mkdir(path.join(dir, '2026-02-01'), { recursive: true });
    await fsp.writeFile(path.join(dir, '2026-02-01', 'c.csv'), '1');
    await fsp.mkdir(path.join(dir, 'notes'), { recursive: true });
    await fsp.writeFile(path.join(dir, 'notes', 'd.txt'), '1');
    expect(await store.countLegacyFiles()).toBe(3);
    expect(await store.countLegacyFiles()).toBe(3);
  });

  it('skips an unreadable legacy subdirectory instead of rejecting', async () => {
    if (process.getuid?.() === 0) return; // root bypasses permission bits
    await fsp.mkdir(path.join(dir, '95', '2026-01-10'), { recursive: true });
    await fsp.writeFile(path.join(dir, '95', '2026-01-10', 'a.json'), '1');
    const blockedDateDir = path.join(dir, '42', '2026-01-01');
    await fsp.mkdir(blockedDateDir, { recursive: true });
    await fsp.writeFile(path.join(blockedDateDir, 'b.csv'), '1');
    await fsp.chmod(blockedDateDir, 0o000);
    try {
      await expect(store.countLegacyFiles()).resolves.toBe(1);
    } finally {
      await fsp.chmod(blockedDateDir, 0o755);
    }
  });

  it('returns 0 legacy files and sweeps nothing when the dir does not exist yet', async () => {
    const fresh = new ExportStore({ dir: path.join(dir, 'missing'), retentionDays: 7 });
    expect(await fresh.countLegacyFiles()).toBe(0);
    expect(await fresh.sweep()).toBe(0);
  });

  it('init creates store/.staging and throws ExportDirUnwritableError when it cannot', async () => {
    await store.init();
    await expect(fsp.stat(path.join(dir, 'store', '.staging'))).resolves.toBeDefined();
    const blocker = path.join(dir, 'file-not-dir');
    await fsp.writeFile(blocker, 'x');
    const broken = new ExportStore({ dir: blocker, retentionDays: 7 });
    await expect(broken.init()).rejects.toBeInstanceOf(ExportDirUnwritableError);
  });

  it('removes the staging dir when a save fails', async () => {
    const blocker = path.join(dir, 'file-not-dir');
    await fsp.writeFile(blocker, 'x');
    const broken = new ExportStore({ dir: blocker, retentionDays: 7 });
    await expect(broken.save('x', 'x.csv', 'csv')).rejects.toBeDefined();
    expect(await fsp.readFile(blocker, 'utf8')).toBe('x');
  });
});
