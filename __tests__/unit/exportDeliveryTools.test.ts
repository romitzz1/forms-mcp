// ABOUTME: Tests export handlers end-to-end against a real temp ExportStore (http and stdio delivery)
// ABOUTME: Covers get_export_link, output_path rejection, ignored legacy flags, and zero-entry exports

import { promises as fsp } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { DataExporter } from '../../utils/dataExporter';
import { deriveLinkKey } from '../../utils/exportLinks';
import { ExportStore } from '../../utils/exportStore';
import {
  exportEntriesFormatted,
  exportFormJson,
  getExportLink,
  OUTPUT_PATH_REMOVED,
} from '../../utils/exportTools';
import type { ExportEntriesFormattedArgs, ExportToolContext } from '../../utils/exportTools';
import { ValidationHelper } from '../../utils/validation';

const textOf = (r: { content: Array<{ type: string; text?: string }> }) =>
  r.content.find((c) => c.type === 'text')?.text ?? '';
const linkOf = (r: { content: Array<{ type: string; uri?: string }> }) =>
  r.content.find((c) => c.type === 'resource_link')?.uri ?? '';

describe('export delivery tools', () => {
  let dir: string;
  let store: ExportStore;
  let nowMs: number;

  function ctx(mode: 'http' | 'stdio', response: unknown, publicBaseUrl: string | undefined = 'http://nas.local:9807'): ExportToolContext {
    return {
      makeRequest: jest.fn(() => Promise.resolve(response)) as unknown as ExportToolContext['makeRequest'],
      validator: new ValidationHelper(),
      dataExporter: new DataExporter(),
      getExportStore: () => store,
      delivery: { mode, publicBaseUrl, linkKey: mode === 'http' ? deriveLinkKey('tok') : null, linkTtlMinutes: 60 },
      now: () => new Date(nowMs),
    };
  }

  beforeEach(async () => {
    dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'gf-tools-'));
    nowMs = Date.now();
    store = new ExportStore({ dir, retentionDays: 7, now: () => new Date(nowMs) });
  });

  afterEach(async () => {
    await fsp.rm(dir, { recursive: true, force: true });
  });

  const entries = { total_count: 2, entries: [{ id: '1', '1': 'A' }, { id: '2', '1': 'B' }] };

  it('exports entries over http with summary, preview, resource_link, and a signed URL', async () => {
    const r = await exportEntriesFormatted(ctx('http', entries), { form_id: '7', format: 'csv' });
    const text = textOf(r);
    expect(text).toContain('Records exported: 2');
    expect(text).toContain('Preview:');
    expect(text).toMatch(/Download: http:\/\/nas\.local:9807\/exports\/[A-Za-z0-9_-]{22}\?exp=\d+&sig=/);
    expect(text).toContain("curl -fsSL -o ~/Downloads/'entries-form-7-");
    expect(linkOf(r)).toMatch(/^gf-export:\/\/[A-Za-z0-9_-]{22}$/);
    expect(text).not.toContain('Base64');
  });

  it('exports entries in stdio mode with a real local path and no URL', async () => {
    const r = await exportEntriesFormatted(ctx('stdio', entries), { form_id: '7', format: 'json' });
    const text = textOf(r);
    const id = linkOf(r).replace('gf-export://', '');
    const rec = await store.get(id);
    expect(text).toContain(`Local file: ${rec.localPath}`);
    expect(text).not.toContain('Download:');
    // Object key order here reflects plain JS semantics: integer-like keys
    // ('1') are always enumerated before non-numeric keys ('id'), regardless
    // of declaration order.
    expect(text).toContain('2 entries; first entry keys: 1, id');
  });

  it('says links are disabled in http mode without a base URL', async () => {
    // Built inline rather than via the `ctx` helper: that helper's third
    // parameter has a JS default value, which also applies when the caller
    // passes an explicit `undefined` — so it can't express "no base URL".
    const r = await exportEntriesFormatted({
      makeRequest: jest.fn(() => Promise.resolve(entries)) as unknown as ExportToolContext['makeRequest'],
      validator: new ValidationHelper(),
      dataExporter: new DataExporter(),
      getExportStore: () => store,
      delivery: { mode: 'http', publicBaseUrl: undefined, linkKey: deriveLinkKey('tok'), linkTtlMinutes: 60 },
      now: () => new Date(nowMs),
    }, { form_id: '7', format: 'csv' });
    expect(textOf(r)).toContain('download links disabled');
  });

  it('rejects output_path and ignores save_to_disk / skip_base64', async () => {
    await expect(exportEntriesFormatted(ctx('http', entries), { form_id: '7', format: 'csv', output_path: '/tmp/x.csv' }))
      .rejects.toThrow(OUTPUT_PATH_REMOVED);
    await expect(exportFormJson(ctx('http', { id: '7', title: 'T', fields: [] }), { form_id: '7', output_path: '/tmp' }))
      .rejects.toThrow(OUTPUT_PATH_REMOVED);
    const r = await exportEntriesFormatted(
      ctx('http', entries),
      { form_id: '7', format: 'csv', save_to_disk: true, skip_base64: true } as unknown as ExportEntriesFormattedArgs
    );
    expect(linkOf(r)).toMatch(/^gf-export:\/\//);
  });

  it('saves nothing for zero entries', async () => {
    const r = await exportEntriesFormatted(ctx('http', { total_count: 0, entries: [] }), { form_id: '7', format: 'csv' });
    expect(textOf(r)).toContain('No entries found');
    expect(r.content.some((c) => c.type === 'resource_link')).toBe(false);
  });

  it('keeps pagination guidance', async () => {
    const big = { total_count: 5000, entries: Array.from({ length: 1000 }, (_, i) => ({ id: String(i + 1) })) };
    const text = textOf(await exportEntriesFormatted(ctx('http', big), { form_id: '7', format: 'csv' }));
    expect(text).toContain('Large Dataset Safety Limit Applied!');
    expect(text).toContain('current_page": 2');
  });

  it('exports form JSON with the sanitizer note and a form preview', async () => {
    const form = { id: '7', title: 'League Signup', fields: [{ label: 'Name' }], notifications: [{ to: 'treasurer@club.org' }] };
    const r = await exportFormJson(ctx('http', form), { form_id: '7' });
    const text = textOf(r);
    expect(text).toContain('Title: League Signup');
    expect(text).toContain('{admin_email}');
    const id = linkOf(r).replace('gf-export://', '');
    const saved = JSON.parse(await store.readText(id, 1_000_000)) as { notifications: Array<{ to: string }> };
    expect(saved.notifications[0].to).toBe('{admin_email}');
    expect((await store.get(id)).filename).toBe('form-7-league-signup.json');
  });

  it('get_export_link re-mints a link and warns when the export is about to expire', async () => {
    const r = await exportEntriesFormatted(ctx('http', entries), { form_id: '7', format: 'csv' });
    const id = linkOf(r).replace('gf-export://', '');
    const fresh = textOf(await getExportLink(ctx('http', null), { export_id: id }));
    expect(fresh).toMatch(/Download: http:\/\/nas\.local:9807\/exports\//);
    expect(fresh).not.toContain('expires soon');

    nowMs += 7 * 24 * 60 * 60 * 1000 - 5 * 60 * 1000;
    const late = textOf(await getExportLink(ctx('http', null), { export_id: id }));
    expect(late).toContain('expires soon');
  });

  it('get_export_link reports not found and expired', async () => {
    await expect(getExportLink(ctx('http', null), { export_id: 'AbCdEfGhIjKlMnOpQrStUv' })).rejects.toThrow('Export not found');
    await expect(getExportLink(ctx('http', null), {})).rejects.toThrow('export_id is required');
    const r = await exportEntriesFormatted(ctx('http', entries), { form_id: '7', format: 'csv' });
    const id = linkOf(r).replace('gf-export://', '');
    nowMs += 8 * 24 * 60 * 60 * 1000;
    await expect(getExportLink(ctx('http', null), { export_id: id })).rejects.toThrow('Export expired');
  });
});
