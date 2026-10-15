// ABOUTME: Contract test — tools/list as a real client sees it must not drift across SDK/Zod upgrades
// ABOUTME: Set UPDATE_TOOL_CONTRACT=1 only in a commit that intentionally changes a tool contract

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { promises as fsp } from 'node:fs';
import * as path from 'node:path';
import { GravityFormsMCPServer } from '../../index';
import { normalizeToolList } from '../utils/toolContract';

const FIXTURE = path.join(__dirname, '..', 'fixtures', 'toolContract.json');

describe('tools/list contract', () => {
  it('matches the committed contract fixture', async () => {
    const server = new GravityFormsMCPServer();
    const [clientT, serverT] = InMemoryTransport.createLinkedPair();
    await server.createSessionServer().connect(serverT);
    const client = new Client({ name: 'contract', version: '0.0.0' });
    await client.connect(clientT);
    const { tools } = await client.listTools();
    await client.close();

    const contract = normalizeToolList(tools);
    if (process.env.UPDATE_TOOL_CONTRACT === '1') {
      if (process.env.CI) {
        throw new Error('UPDATE_TOOL_CONTRACT must not be set in CI');
      }
      await fsp.writeFile(FIXTURE, JSON.stringify(contract, null, 2) + '\n');
    }
    const expected = JSON.parse(await fsp.readFile(FIXTURE, 'utf8')) as unknown;
    expect(contract).toStrictEqual(expected);
  });

  it('still applies defaults and accepts the documented argument shapes', async () => {
    const server = new GravityFormsMCPServer();
    const [clientT, serverT] = InMemoryTransport.createLinkedPair();
    await server.createSessionServer().connect(serverT);
    const client = new Client({ name: 'contract', version: '0.0.0' });
    await client.connect(clientT);
    // get_export_link with an unknown id fails inside the handler (not schema validation),
    // proving Zod 4 accepted the argument shape and the call reached dispatch.
    // A handler-thrown McpError surfaces either as an isError result or as a protocol
    // error depending on SDK version; both prove the call reached dispatch.
    let text: string;
    try {
      const result = await client.callTool({ name: 'get_export_link', arguments: { export_id: 'AbCdEfGhIjKlMnOpQrStUv' } });
      text = JSON.stringify(result.content);
    } catch (error) {
      text = String(error);
    }
    await client.close();
    expect(text).toContain('Export not found');
  });
});
