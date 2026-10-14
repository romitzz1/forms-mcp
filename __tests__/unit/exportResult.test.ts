// ABOUTME: Unit tests for export tool result shaping (summary text, previews, delivery lines)
// ABOUTME: Verifies preview caps, resource_link content, and per-mode download guidance

import {
  buildCsvPreview,
  buildEntriesJsonPreview,
  buildExportResult,
  buildFormJsonPreview,
  formatUtc,
} from '../../utils/exportResult';
import type { IExportRecord } from '../../utils/exportStore';

const record: IExportRecord = {
  id: 'AbCdEfGhIjKlMnOpQrStUv',
  filename: 'entries-form-1-20261013T003005Z.csv',
  mimeType: 'text/csv; charset=utf-8',
  size: 1234,
  createdAt: new Date(Date.UTC(2026, 9, 13, 0, 30)),
  expiresAt: new Date(Date.UTC(2026, 9, 20, 0, 30)),
  localPath: '/home/u/.gravity-forms-mcp/exports/store/AbCdEfGhIjKlMnOpQrStUv/entries-form-1-20261013T003005Z.csv',
};

const textOf = (r: ReturnType<typeof buildExportResult>) =>
  (r.content.find((c) => c.type === 'text') as { text: string }).text;

describe('exportResult', () => {
  it('formats UTC timestamps with a label', () => {
    expect(formatUtc(new Date(Date.UTC(2026, 9, 20, 14, 3, 59)))).toBe('2026-10-20 14:03 UTC');
  });

  it('returns a text block and a resource_link', () => {
    const r = buildExportResult({ record, summaryLines: ['Records exported: 2'], preview: 'id', extraNotes: ['NOTE'], delivery: { mode: 'stdio' } });
    expect(r.content).toHaveLength(2);
    expect(r.content[1]).toEqual({
      type: 'resource_link',
      uri: 'gf-export://AbCdEfGhIjKlMnOpQrStUv',
      name: record.filename,
      mimeType: record.mimeType,
      size: 1234,
    });
    const text = textOf(r);
    expect(text).toContain('Records exported: 2');
    expect(text).toContain('NOTE');
    expect(text).toContain('Retained until: 2026-10-20 00:30 UTC');
  });

  it('stdio delivery shows the local path and the retention warning', () => {
    const text = textOf(buildExportResult({ record, summaryLines: [], preview: '', extraNotes: [], delivery: { mode: 'stdio' } }));
    expect(text).toContain(record.localPath);
    expect(text).toContain('copy it somewhere permanent');
    expect(text).not.toContain('curl');
  });

  it('http delivery shows the URL, expiry, a curl into ~/Downloads, and a WebFetch warning', () => {
    const url = 'http://nas.local:9807/exports/AbCdEfGhIjKlMnOpQrStUv?exp=1&sig=s';
    const text = textOf(buildExportResult({
      record, summaryLines: [], preview: '', extraNotes: [],
      delivery: { mode: 'http', link: { url, expiresAt: new Date(Date.UTC(2026, 9, 13, 1, 30)) } },
    }));
    expect(text).toContain(url);
    expect(text).toContain('Link expires: 2026-10-13 01:30 UTC');
    expect(text).toContain(`curl -fsSL -o ~/Downloads/'${record.filename}' '${url}'`);
    expect(text).toContain('Do not use WebFetch');
    expect(text).toContain('get_export_link');
    expect(text).not.toContain(record.localPath);
  });

  it('http delivery without a base URL says links are disabled', () => {
    const text = textOf(buildExportResult({ record, summaryLines: [], preview: '', extraNotes: [], delivery: { mode: 'http', link: null } }));
    expect(text).toContain('download links disabled — set MCP_PUBLIC_BASE_URL');
  });

  it('caps CSV previews: 20 columns, 80-char cells, no raw newlines, ≤ 2048 bytes', () => {
    const header = Array.from({ length: 150 }, (_, i) => `col${i}`);
    const big = 'x'.repeat(20000) + '\nline2';
    const preview = buildCsvPreview([header, header.map(() => big), header.map(() => big), header.map(() => big)]);
    expect(Buffer.byteLength(preview, 'utf8')).toBeLessThanOrEqual(2048);
    const firstLine = preview.split('\n')[0];
    expect(firstLine.split(' | ')).toHaveLength(21); // 20 columns + "…130 more"
    expect(preview).not.toContain('line2');
  });

  it('previews entries JSON as count + first entry keys', () => {
    expect(buildEntriesJsonPreview([{ id: '1', '1.3': 'a' }, { id: '2' }])).toBe('2 entries; first entry keys: id, 1.3');
    expect(buildEntriesJsonPreview([])).toBe('0 entries');
  });

  it('previews a form as title, field count, and up to 20 labels', () => {
    const fields = Array.from({ length: 25 }, (_, i) => ({ label: `Field ${i}` }));
    const p = buildFormJsonPreview({ title: 'Event Signup', fields });
    expect(p).toContain('Title: Event Signup');
    expect(p).toContain('Fields: 25');
    expect(p).toContain('Field 19');
    expect(p).not.toContain('Field 20,');
    expect(p).toContain('…5 more');
  });
});
