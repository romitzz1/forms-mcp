// ABOUTME: Builds export tool results: capped summary text, preview, resource_link, and delivery lines
// ABOUTME: Shared by export_form_json, export_entries_formatted, and get_export_link

import type { ExportRecord } from './exportStore.js';

const MAX_PREVIEW_COLUMNS = 20;
const MAX_CELL_CHARS = 80;
const MAX_PREVIEW_BYTES = 2048;
const MAX_LABELS = 20;

export const SANITIZER_NOTE =
  'Note: notification recipients were replaced with {admin_email} and payment-gateway settings were removed. Review them before activating an imported copy.';

export type ExportContent =
  | { type: 'text'; text: string }
  | { type: 'resource_link'; uri: string; name: string; mimeType: string; size: number };

export interface ExportToolResult {
  content: ExportContent[];
}

export type ExportDelivery =
  | { mode: 'http'; link: { url: string; expiresAt: Date } | null }
  | { mode: 'stdio' };

export function exportResourceUri(id: string): string {
  return `gf-export://${id}`;
}

export function formatUtc(d: Date): string {
  return `${d.toISOString().slice(0, 16).replace('T', ' ')} UTC`;
}

function clampBytes(text: string, maxBytes: number): string {
  if (Buffer.byteLength(text, 'utf8') <= maxBytes) return text;
  let out = text;
  while (Buffer.byteLength(out + '…', 'utf8') > maxBytes) out = out.slice(0, -1);
  return out + '…';
}

function previewCell(value: string): string {
  const flat = value.replace(/[\r\n]+/g, ' ');
  return flat.length > MAX_CELL_CHARS ? flat.slice(0, MAX_CELL_CHARS - 1) + '…' : flat;
}

export function buildCsvPreview(rows: string[][]): string {
  const lines = rows.map((row) => {
    const cells = row.slice(0, MAX_PREVIEW_COLUMNS).map(previewCell);
    if (row.length > MAX_PREVIEW_COLUMNS) cells.push(`…${row.length - MAX_PREVIEW_COLUMNS} more`);
    return cells.join(' | ');
  });
  return clampBytes(lines.join('\n'), MAX_PREVIEW_BYTES);
}

export function buildEntriesJsonPreview(entries: unknown[]): string {
  if (entries.length === 0) return '0 entries';
  const first = entries[0];
  const keys = first && typeof first === 'object' ? Object.keys(first) : [];
  return clampBytes(`${entries.length} entries; first entry keys: ${keys.join(', ')}`, MAX_PREVIEW_BYTES);
}

export function buildFormJsonPreview(form: { title?: string; fields?: Array<{ label?: string }> }): string {
  const fields = form.fields ?? [];
  const labels = fields.slice(0, MAX_LABELS).map((f) => previewCell(f.label ?? '(no label)'));
  const more = fields.length > MAX_LABELS ? `, …${fields.length - MAX_LABELS} more` : '';
  const lines = [
    `Title: ${form.title ?? 'Untitled Form'}`,
    `Fields: ${fields.length}`,
    `Labels: ${labels.join(', ')}${more}`,
  ];
  return clampBytes(lines.join('\n'), MAX_PREVIEW_BYTES);
}

export function deliveryLines(record: ExportRecord, delivery: ExportDelivery): string[] {
  if (delivery.mode === 'stdio') {
    return [
      `Local file: ${record.localPath}`,
      `This file is deleted after ${formatUtc(record.expiresAt)}; copy it somewhere permanent if you need to keep it.`,
    ];
  }
  if (!delivery.link) {
    return ['Download: download links disabled — set MCP_PUBLIC_BASE_URL on the server to enable them.'];
  }
  const { url, expiresAt } = delivery.link;
  return [
    `Download: ${url}`,
    `Link expires: ${formatUtc(expiresAt)}`,
    `To save it from a terminal: curl -fsSL -o ~/Downloads/'${record.filename}' '${url}'`,
    'Do not use WebFetch for this link (it upgrades to HTTPS and summarizes the body). Call get_export_link for a fresh link.',
  ];
}

export function buildExportResult(p: {
  record: ExportRecord;
  summaryLines: string[];
  preview: string;
  extraNotes: string[];
  delivery: ExportDelivery;
}): ExportToolResult {
  const sections = [
    'Export completed successfully!',
    [
      ...p.summaryLines,
      `Filename: ${p.record.filename}`,
      `Size: ${p.record.size} bytes`,
      `Export ID: ${p.record.id}`,
      `Retained until: ${formatUtc(p.record.expiresAt)}`,
    ].join('\n'),
  ];
  if (p.extraNotes.length > 0) sections.push(p.extraNotes.join('\n'));
  if (p.preview !== '') sections.push(`Preview:\n${p.preview}`);
  sections.push(deliveryLines(p.record, p.delivery).join('\n'));

  return {
    content: [
      { type: 'text', text: sections.join('\n\n') },
      {
        type: 'resource_link',
        uri: exportResourceUri(p.record.id),
        name: p.record.filename,
        mimeType: p.record.mimeType,
        size: p.record.size,
      },
    ],
  };
}
