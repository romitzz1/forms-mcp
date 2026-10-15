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
      await fsp.writeFile(FIXTURE, JSON.stringify(contract, null, 2) + '\n');
    }
    const expected = JSON.parse(await fsp.readFile(FIXTURE, 'utf8')) as unknown;
    expect(contract).toStrictEqual(expected);
  });
});
