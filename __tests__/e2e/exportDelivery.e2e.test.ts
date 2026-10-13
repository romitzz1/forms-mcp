// ABOUTME: Opt-in end-to-end test of export delivery against the live Gravity Forms site
// ABOUTME: Creates and force-deletes its own synthetic form; never reads real form data

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { createHash, randomBytes } from 'node:crypto';
import { promises as fsp } from 'node:fs';
import * as net from 'node:net';
import * as os from 'node:os';
import * as path from 'node:path';
import type { Server as HttpServer } from 'node:http';

try { process.loadEnvFile('.env'); } catch { /* .env is optional */ }

const enabled = process.env.RUN_E2E === '1'
  && !!process.env.GRAVITY_FORMS_BASE_URL
  && !!process.env.GRAVITY_FORMS_CONSUMER_KEY
  && !!process.env.GRAVITY_FORMS_CONSUMER_SECRET;

if (!enabled) {
  console.warn('[e2e] skipped: set RUN_E2E=1 and Gravity Forms credentials to run the export delivery E2E test');
}

const sha = (b: Buffer | string): string => createHash('sha256').update(b).digest('hex');

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.listen(0, '127.0.0.1', () => {
      const addr = s.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      s.close(() => resolve(port));
    });
    s.on('error', reject);
  });
}

(enabled ? describe : describe.skip)('export delivery (live site)', () => {
  const prefix = `zz-e2e-export-${randomBytes(4).toString('hex')}`;
  let exportDir: string;
  let httpServer: HttpServer;
  let client: Client;
  let api: { makeRequest<T = unknown>(endpoint: string, method?: string, body?: unknown): Promise<T> };
  let formId: string;

  beforeAll(async () => {
    const port = await freePort();
    const token = randomBytes(24).toString('hex');
    exportDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'gf-e2e-'));
    process.env.MCP_TRANSPORT = 'http';
    process.env.MCP_AUTH_TOKEN = token;
    process.env.MCP_PUBLIC_BASE_URL = `http://127.0.0.1:${port}`;
    process.env.GRAVITY_FORMS_EXPORT_DIR = exportDir;
    process.env.GRAVITY_FORMS_CACHE_ENABLED = 'false';

    const { GravityFormsMCPServer } = await import('../../index');
    const { startHttpServer } = await import('../../utils/httpTransport');
    const { GravityFormsClient } = await import('../../utils/gravityFormsClient');
    api = new GravityFormsClient({
      baseUrl: process.env.GRAVITY_FORMS_BASE_URL as string,
      consumerKey: process.env.GRAVITY_FORMS_CONSUMER_KEY as string,
      consumerSecret: process.env.GRAVITY_FORMS_CONSUMER_SECRET as string,
      authMethod: 'basic',
    });

    const server = new GravityFormsMCPServer();
    httpServer = await startHttpServer(() => server.createSessionServer(), { port, token, exports: server.getHttpExportOptions() });

    client = new Client({ name: 'e2e', version: '0.0.0' });
    await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp`), {
      requestInit: { headers: { Authorization: `Bearer ${token}` } },
    }));

    const form = await api.makeRequest<{ id: string | number }>('/forms', 'POST', {
      title: prefix,
      fields: [
        { id: 1, type: 'text', label: 'Name' },
        { id: 2, type: 'email', label: 'Email' },
      ],
    });
    formId = String(form.id);
    for (const name of ['Test Person', 'Another Tester']) {
      await api.makeRequest('/entries', 'POST', { form_id: formId, '1': name, '2': 'e2e@example.invalid' });
    }
  });

  afterAll(async () => {
    const leftovers: string[] = [];
    try {
      const forms = await api.makeRequest<Record<string, { id: string; title: string }>>('/forms');
      for (const f of Object.values(forms)) {
        if (!f.title.startsWith(prefix)) continue;
        const entries = await api.makeRequest<{ entries?: Array<{ id: string }> }>(`/forms/${f.id}/entries?paging[page_size]=100`);
        for (const e of entries.entries ?? []) {
          await api.makeRequest(`/entries/${e.id}?force=1`, 'DELETE').catch(() => leftovers.push(`entry ${e.id}`));
        }
        await api.makeRequest(`/forms/${f.id}?force=1`, 'DELETE').catch(() => leftovers.push(`form ${f.id}`));
      }
    } finally {
      if (leftovers.length > 0) console.error(`[e2e] cleanup left behind: ${leftovers.join(', ')}`);
      await client?.close();
      await new Promise<void>((resolve) => httpServer.close(() => resolve()));
      await fsp.rm(exportDir, { recursive: true, force: true });
    }
  });

  // client.callTool()'s declared return type is a union with the legacy `toolResult` shape
  // used only when a caller passes the compatibility result schema; this suite never does, so
  // the response is always the modern content-array shape described by CallToolResult.
  const callTool = async (name: string, args: Record<string, unknown>): Promise<CallToolResult> =>
    (await client.callTool({ name, arguments: args })) as unknown as CallToolResult;

  const textOf = (r: CallToolResult): string => {
    const item = r.content.find((c) => c.type === 'text');
    return item && item.type === 'text' ? item.text : '';
  };
  const idOf = (r: CallToolResult): string => {
    const item = r.content.find((c) => c.type === 'resource_link');
    const uri = item && item.type === 'resource_link' ? item.uri : '';
    return uri.replace('gf-export://', '');
  };
  const urlOf = (r: CallToolResult): string => (textOf(r).match(/Download: (\S+)/) ?? [])[1] ?? '';

  it('delivers an entries export through the resource and the signed URL with identical bytes', async () => {
    const r = await callTool('export_entries_formatted', { form_id: formId, format: 'csv' });
    const id = idOf(r);
    expect(id).toMatch(/^[A-Za-z0-9_-]{22}$/);
    const resource = await client.readResource({ uri: `gf-export://${id}` });
    const viaResource = (resource.contents[0] as { text: string }).text;
    const download = await fetch(urlOf(r));
    expect(download.status).toBe(200);
    const viaUrl = Buffer.from(await download.arrayBuffer());
    expect(sha(viaUrl)).toBe(sha(viaResource));
  });

  it('re-mints a link and imports a form copy by export_id', async () => {
    const exp = await callTool('export_form_json', { form_id: formId, filename: `${prefix}-copy` });
    const id = idOf(exp);
    const link = await callTool('get_export_link', { export_id: id });
    expect((await fetch(urlOf(link))).status).toBe(200);
    const imported = await callTool('import_form_json', { export_id: id, force_import: true });
    expect(imported.isError).toBeFalsy();
    expect(textOf(imported)).toContain('{admin_email}');
  });
});
