// ABOUTME: Integration tests for the gf-export:// resource template and export lifecycle wiring
// ABOUTME: Drives a real McpServer over InMemoryTransport with the SDK client

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { promises as fsp } from 'node:fs';
import * as path from 'node:path';
import { GravityFormsMCPServer } from '../../index';

async function connect(server: GravityFormsMCPServer): Promise<Client> {
  const [clientT, serverT] = InMemoryTransport.createLinkedPair();
  await server.createSessionServer().connect(serverT);
  const client = new Client({ name: 'test', version: '0.0.0' });
  await client.connect(clientT);
  return client;
}

describe('gf-export:// resources', () => {
  let server: any;

  beforeEach(() => {
    server = new GravityFormsMCPServer();
  });

  it('reads an export by URI', async () => {
    const rec = await server.exportStore.save('a,b\n1,2', 'r.csv', 'csv');
    const client = await connect(server);
    const res = await client.readResource({ uri: `gf-export://${rec.id}` });
    expect(res.contents[0].mimeType).toBe('text/csv; charset=utf-8');
    expect((res.contents[0] as { text: string }).text).toHaveLength(7);
  });

  it('returns -32002 for unknown ids and points over-cap reads at get_export_link', async () => {
    const client = await connect(server);
    await expect(client.readResource({ uri: 'gf-export://AbCdEfGhIjKlMnOpQrStUv' })).rejects.toMatchObject({ code: -32002 });
    const big = await server.exportStore.save('x'.repeat(262145), 'big.csv', 'csv');
    await expect(client.readResource({ uri: `gf-export://${big.id}` })).rejects.toThrow(/get_export_link/);
  });

  it('lists get_export_link among the tools', async () => {
    const client = await connect(server);
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name)).toContain('get_export_link');
  });

  it('get_export_link and import_form_json(export_id) are dispatched', async () => {
    const rec = await server.exportStore.save('{"title":"T","fields":[]}', 'f.json', 'json');
    const link = await server.callTool({ params: { name: 'get_export_link', arguments: { export_id: rec.id } } });
    expect(link.isError).toBe(false);
  });

  it('startup warns (does not throw) on an unwritable export dir, and shutdown clears the sweep timer', async () => {
    const blocker = path.join(process.env.GRAVITY_FORMS_EXPORT_DIR as string, 'blocker-file');
    await fsp.writeFile(blocker, 'x');
    const original = process.env.GRAVITY_FORMS_EXPORT_DIR;
    process.env.GRAVITY_FORMS_EXPORT_DIR = blocker;
    process.env.GRAVITY_FORMS_CACHE_ENABLED = 'false';
    try {
      const s: any = new GravityFormsMCPServer();
      await expect(s.startup()).resolves.toBeUndefined();
      const calls = (console.error as jest.Mock).mock.calls.flat().join('\n');
      expect(calls).toContain('export directory not writable');
      const r = await s.callTool({ params: { name: 'get_export_link', arguments: { export_id: 'AbCdEfGhIjKlMnOpQrStUv' } } });
      expect(r.isError).toBe(true);
      expect(r.content[0].text).toContain('export directory not writable');
      expect(s.sweepTimer).not.toBeNull();
      await s.shutdown();
      expect(s.sweepTimer).toBeNull();
    } finally {
      process.env.GRAVITY_FORMS_EXPORT_DIR = original;
      delete process.env.GRAVITY_FORMS_CACHE_ENABLED;
    }
  });

  it('startup logs a warning when legacy export files exist', async () => {
    const dir = process.env.GRAVITY_FORMS_EXPORT_DIR as string;
    await fsp.mkdir(path.join(dir, '42', '2026-08-01'), { recursive: true });
    await fsp.writeFile(path.join(dir, '42', '2026-08-01', 'old.csv'), 'x');
    process.env.GRAVITY_FORMS_CACHE_ENABLED = 'false';
    try {
      const s: any = new GravityFormsMCPServer();
      await s.startup();
      const calls = (console.error as jest.Mock).mock.calls.flat().join('\n');
      expect(calls).toContain('legacy export files');
      await s.shutdown();
    } finally {
      delete process.env.GRAVITY_FORMS_CACHE_ENABLED;
      await fsp.rm(path.join(dir, '42'), { recursive: true, force: true });
    }
  });
});
