// ABOUTME: Filesystem-only export store: <dir>/store/<id>/<filename>, atomic staging, retention sweep
// ABOUTME: Never deletes anything outside <dir>/store; legacy files are only counted for a warning

import { randomBytes } from 'node:crypto';
import { promises as fsp } from 'node:fs';
import type { FileHandle } from 'node:fs/promises';
import * as path from 'node:path';
import type { ExportFormat } from './dataExporter.js';

const ID_PATTERN = /^[A-Za-z0-9_-]{22}$/;
const DATE_DIR = /^\d{4}-\d{2}-\d{2}$/;
const DIGITS_DIR = /^\d+$/;
const MAX_FILENAME = 128;
const DAY_MS = 24 * 60 * 60 * 1000;
const STAGING_MAX_AGE_MS = 60 * 60 * 1000;
const MIME: Record<ExportFormat, string> = { csv: 'text/csv; charset=utf-8', json: 'application/json' };

export interface IExportRecord {
  id: string;
  filename: string;
  mimeType: string;
  size: number;
  createdAt: Date;
  expiresAt: Date;
  localPath: string;
}

export class ExportNotFoundError extends Error {
  constructor() { super('Export not found'); this.name = 'ExportNotFoundError'; }
}

export class ExportExpiredError extends Error {
  constructor() { super('Export expired; re-run the export'); this.name = 'ExportExpiredError'; }
}

export class ExportTooLargeError extends Error {
  constructor(public readonly size: number) {
    super(`Export is ${size} bytes, over the read limit`);
    this.name = 'ExportTooLargeError';
  }
}

export class ExportDirUnwritableError extends Error {
  constructor(public readonly dir: string, cause: string) {
    super(`export directory not writable: ${dir} (${cause})`);
    this.name = 'ExportDirUnwritableError';
  }
}

export function isValidExportId(id: string): boolean {
  return ID_PATTERN.test(id);
}

export function sanitizeExportFilename(name: string, format: ExportFormat): string {
  const ext = `.${format}`;
  let stem = name.replace(/[^A-Za-z0-9._-]/g, '_').replace(/^\.+/, '');
  if (stem.toLowerCase().endsWith(ext)) stem = stem.slice(0, -ext.length);
  if (stem === '' || /^\.*$/.test(stem)) stem = 'export';
  return stem.slice(0, MAX_FILENAME - ext.length) + ext;
}

function formatFromFilename(filename: string): ExportFormat {
  return filename.endsWith('.json') ? 'json' : 'csv';
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export class ExportStore {
  readonly root: string;
  private readonly legacyDir: string;
  private readonly staging: string;
  private readonly retentionMs: number;
  private readonly now: () => Date;

  constructor(opts: { dir: string; retentionDays: number; now?: () => Date }) {
    this.root = path.join(opts.dir, 'store');
    this.staging = path.join(this.root, '.staging');
    this.retentionMs = opts.retentionDays * DAY_MS;
    this.now = opts.now ?? (() => new Date());
    this.legacyDir = opts.dir;
  }

  async init(): Promise<void> {
    try {
      await fsp.mkdir(this.staging, { recursive: true });
      const probe = path.join(this.staging, `.probe-${randomBytes(6).toString('hex')}`);
      await fsp.writeFile(probe, '');
      await fsp.unlink(probe);
    } catch (error) {
      throw new ExportDirUnwritableError(this.root, errorMessage(error));
    }
  }

  async save(content: string, filename: string, format: ExportFormat): Promise<IExportRecord> {
    const id = randomBytes(16).toString('base64url');
    const safeName = sanitizeExportFilename(filename, format);
    const stagingDir = path.join(this.staging, id);
    try {
      await fsp.mkdir(stagingDir, { recursive: true });
      await fsp.writeFile(path.join(stagingDir, safeName), content, 'utf8');
      await fsp.rename(stagingDir, path.join(this.root, id));
    } catch (error) {
      await fsp.rm(stagingDir, { recursive: true, force: true }).catch(() => undefined);
      throw error;
    }
    return this.get(id);
  }

  private async locate(id: string): Promise<{ filename: string; filePath: string }> {
    if (!isValidExportId(id)) throw new ExportNotFoundError();
    let names: string[];
    try {
      names = await fsp.readdir(path.join(this.root, id));
    } catch {
      throw new ExportNotFoundError();
    }
    const filename = names.find((n) => !n.startsWith('.'));
    if (!filename) throw new ExportNotFoundError();
    return { filename, filePath: path.join(this.root, id, filename) };
  }

  private toRecord(id: string, filename: string, filePath: string, size: number, mtime: Date): IExportRecord {
    const record: IExportRecord = {
      id,
      filename,
      mimeType: MIME[formatFromFilename(filename)],
      size,
      createdAt: mtime,
      expiresAt: new Date(mtime.getTime() + this.retentionMs),
      localPath: filePath,
    };
    if (this.now().getTime() >= record.expiresAt.getTime()) throw new ExportExpiredError();
    return record;
  }

  async get(id: string): Promise<IExportRecord> {
    const { filename, filePath } = await this.locate(id);
    let stat;
    try {
      stat = await fsp.stat(filePath);
    } catch {
      throw new ExportNotFoundError();
    }
    return this.toRecord(id, filename, filePath, stat.size, stat.mtime);
  }

  async open(id: string): Promise<{ record: IExportRecord; handle: FileHandle }> {
    const { filename, filePath } = await this.locate(id);
    let handle: FileHandle;
    try {
      handle = await fsp.open(filePath, 'r');
    } catch {
      throw new ExportNotFoundError();
    }
    try {
      const stat = await handle.stat();
      return { record: this.toRecord(id, filename, filePath, stat.size, stat.mtime), handle };
    } catch (error) {
      await handle.close();
      throw error;
    }
  }

  async readText(id: string, maxBytes: number): Promise<string> {
    const record = await this.get(id);
    if (record.size > maxBytes) throw new ExportTooLargeError(record.size);
    return fsp.readFile(record.localPath, 'utf8');
  }

  async sweep(): Promise<number> {
    let removed = 0;
    let entries: string[];
    try {
      entries = await fsp.readdir(this.root);
    } catch {
      return 0;
    }
    const nowMs = this.now().getTime();
    for (const name of entries) {
      if (!isValidExportId(name)) continue;
      try {
        const dirPath = path.join(this.root, name);
        const files = (await fsp.readdir(dirPath)).filter((n) => !n.startsWith('.'));
        const target = files.length > 0 ? path.join(dirPath, files[0]) : dirPath;
        const { mtime } = await fsp.stat(target);
        if (nowMs - mtime.getTime() >= this.retentionMs) {
          await fsp.rm(dirPath, { recursive: true, force: true });
          removed++;
        }
      } catch (error) {
        console.error(`[WARN] export sweep skipped ${name}: ${errorMessage(error)}`);
      }
    }
    removed += await this.sweepStaging(nowMs);
    return removed;
  }

  private async sweepStaging(nowMs: number): Promise<number> {
    let removed = 0;
    let entries: string[];
    try {
      entries = await fsp.readdir(this.staging);
    } catch {
      return 0;
    }
    for (const name of entries) {
      try {
        const entryPath = path.join(this.staging, name);
        const { mtime } = await fsp.stat(entryPath);
        if (nowMs - mtime.getTime() >= STAGING_MAX_AGE_MS) {
          await fsp.rm(entryPath, { recursive: true, force: true });
          removed++;
        }
      } catch (error) {
        console.error(`[WARN] export staging sweep skipped ${name}: ${errorMessage(error)}`);
      }
    }
    return removed;
  }

  async countLegacyFiles(): Promise<number> {
    const countFilesIn = async (dirPath: string): Promise<number> => {
      try {
        const items = await fsp.readdir(dirPath, { withFileTypes: true });
        return items.filter((i) => i.isFile()).length;
      } catch (error) {
        console.error(`[WARN] legacy export scan skipped ${dirPath}: ${errorMessage(error)}`);
        return 0;
      }
    };
    let top;
    try {
      top = await fsp.readdir(this.legacyDir, { withFileTypes: true });
    } catch {
      return 0;
    }
    let count = 0;
    for (const entry of top) {
      if (!entry.isDirectory()) continue;
      const entryPath = path.join(this.legacyDir, entry.name);
      if (DATE_DIR.test(entry.name)) {
        count += await countFilesIn(entryPath);
      } else if (DIGITS_DIR.test(entry.name)) {
        let subs;
        try {
          subs = await fsp.readdir(entryPath, { withFileTypes: true });
        } catch (error) {
          console.error(`[WARN] legacy export scan skipped ${entryPath}: ${errorMessage(error)}`);
          continue;
        }
        for (const sub of subs) {
          if (sub.isDirectory() && DATE_DIR.test(sub.name)) count += await countFilesIn(path.join(entryPath, sub.name));
        }
      }
    }
    return count;
  }
}
