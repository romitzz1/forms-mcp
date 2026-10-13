import { createBearerAuthMiddleware, startHttpServer } from '../../utils/httpTransport';
import type { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import * as http from 'node:http';

function mockRes() {
  const res: any = { statusCode: 200, body: undefined };
  res.status = (c: number) => { res.statusCode = c; return res; };
  res.json = (b: unknown) => { res.body = b; return res; };
  return res;
}

describe('createBearerAuthMiddleware', () => {
  it('calls next() when the Authorization header matches the expected bearer token', () => {
    const mw = createBearerAuthMiddleware('sekret');
    const req: any = { headers: { authorization: 'Bearer sekret' } };
    const res = mockRes();
    let called = false;
    mw(req, res, () => { called = true; });
    expect(called).toBe(true);
    expect(res.statusCode).toBe(200);
  });

  it('responds 401 and does not call next() when the token is missing or wrong', () => {
    const mw = createBearerAuthMiddleware('sekret');
    for (const authorization of [undefined, 'Bearer nope', 'sekret']) {
      const req: any = { headers: { authorization } };
      const res = mockRes();
      let called = false;
      mw(req, res, () => { called = true; });
      expect(called).toBe(false);
      expect(res.statusCode).toBe(401);
    }
  });
});

describe('GET /health', () => {
  it('returns 200 {status:ok} without authentication', async () => {
    const httpServer = await startHttpServer(() => ({} as unknown as Server), { port: 0, token: 'unused' });
    const addr = httpServer.address();
    const port = typeof addr === 'object' && addr ? addr.port : 0;
    try {
      // Uses node:http directly rather than global fetch: __tests__/setup.ts
      // replaces global.fetch with a Gravity Forms API mock that 404s any
      // path it doesn't recognize, which would mask the real server response.
      const { status, body } = await new Promise<{ status: number; body: string }>((resolve, reject) => {
        http
          .get(`http://127.0.0.1:${port}/health`, (res) => {
            let data = '';
            res.on('data', (chunk) => { data += chunk; });
            res.on('end', () => resolve({ status: res.statusCode ?? 0, body: data }));
          })
          .on('error', reject);
      });
      expect(status).toBe(200);
      expect(JSON.parse(body)).toEqual({ status: 'ok' });
    } finally {
      await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    }
  });
});

describe('POST /mcp session handling', () => {
  const TOKEN = 'sekret';

  function postInitialize(port: number): Promise<{ status: number; sessionId?: string }> {
    const payload = JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 't', version: '1' } },
    });
    return new Promise((resolve, reject) => {
      const req = http.request(
        {
          host: '127.0.0.1',
          port,
          path: '/mcp',
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json, text/event-stream',
            Authorization: `Bearer ${TOKEN}`,
            'Content-Length': Buffer.byteLength(payload),
          },
        },
        (res) => {
          res.on('data', () => { /* drain */ });
          res.on('end', () =>
            resolve({ status: res.statusCode ?? 0, sessionId: res.headers['mcp-session-id'] as string | undefined })
          );
        }
      );
      req.on('error', reject);
      req.write(payload);
      req.end();
    });
  }

  function deleteSession(port: number, sessionId: string): Promise<number> {
    return new Promise((resolve, reject) => {
      const req = http.request(
        {
          host: '127.0.0.1',
          port,
          path: '/mcp',
          method: 'DELETE',
          headers: {
            Accept: 'application/json, text/event-stream',
            Authorization: `Bearer ${TOKEN}`,
            'mcp-session-id': sessionId,
          },
        },
        (res) => {
          res.on('data', () => { /* drain */ });
          res.on('end', () => resolve(res.statusCode ?? 0));
        }
      );
      req.on('error', reject);
      req.end();
    });
  }

  it('cleans up a session on close without recursing into a stack overflow', async () => {
    const createServer = () => new McpServer({ name: 'test', version: '1.0.0' }).server;
    const httpServer = await startHttpServer(createServer, { port: 0, token: TOKEN });
    const addr = httpServer.address();
    const port = typeof addr === 'object' && addr ? addr.port : 0;
    try {
      const { sessionId } = await postInitialize(port);
      expect(sessionId).toBeTruthy();

      // Closing the transport used to recurse: onclose -> sessionServer.close() ->
      // transport.close() -> onclose -> ... crashing the process with a stack overflow.
      // It must now complete cleanly and remove the session.
      const status = await deleteSession(port, sessionId!);
      expect([200, 204]).toContain(status);

      // Session is gone — a second DELETE for the same id is rejected as invalid.
      const second = await deleteSession(port, sessionId!);
      expect(second).toBe(400);
    } finally {
      await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    }
  });

  it('gives every session its own server so a second client is not rejected with 500', async () => {
    let built = 0;
    const createServer = () => {
      built++;
      return new McpServer({ name: 'test', version: '1.0.0' }).server;
    };

    const httpServer = await startHttpServer(createServer, { port: 0, token: TOKEN });
    const addr = httpServer.address();
    const port = typeof addr === 'object' && addr ? addr.port : 0;
    try {
      const first = await postInitialize(port);
      const second = await postInitialize(port);

      // Regression: the second initialize used to 500 with "Already connected
      // to a transport" because a single server was reused across sessions.
      expect(first.status).toBe(200);
      expect(second.status).toBe(200);
      expect(first.sessionId).toBeTruthy();
      expect(second.sessionId).toBeTruthy();
      expect(first.sessionId).not.toBe(second.sessionId);
      expect(built).toBe(2); // one fresh server per session
    } finally {
      await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    }
  });
});

import { createHash } from 'node:crypto';
import { promises as fsp } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { deriveLinkKey, signExportUrl } from '../../utils/exportLinks';
import { ExportStore } from '../../utils/exportStore';

function httpGet(url: string, headers: Record<string, string> = {}): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: Buffer }> {
  return new Promise((resolve, reject) => {
    http.get(url, { headers }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks) }));
    }).on('error', reject);
  });
}

describe('GET /exports/:id', () => {
  const key = deriveLinkKey('tok');
  let dir: string;
  let store: ExportStore;
  let nowMs: number;
  let server: import('node:http').Server;
  let base: string;

  beforeEach(async () => {
    dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'gf-dl-'));
    nowMs = Date.now();
    store = new ExportStore({ dir, retentionDays: 7, now: () => new Date(nowMs) });
    server = await startHttpServer(() => ({} as unknown as Server), { port: 0, token: 'tok', exports: { store, linkKey: key } });
    const addr = server.address();
    base = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await fsp.rm(dir, { recursive: true, force: true });
  });

  const expIn = (seconds: number) => Math.floor(Date.now() / 1000) + seconds;

  it('streams the file with download headers', async () => {
    const body = 'a,b\n1,2';
    const rec = await store.save(body, 'r.csv', 'csv');
    const res = await httpGet(signExportUrl(base, rec.id, expIn(600), key));
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('text/csv; charset=utf-8');
    expect(res.headers['content-length']).toBe(String(Buffer.byteLength(body)));
    expect(res.headers['content-disposition']).toBe('attachment; filename="r.csv"');
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(createHash('sha256').update(res.body).digest('hex')).toBe(createHash('sha256').update(body).digest('hex'));
  });

  it('403s a tampered link and 404s an unknown or malformed id', async () => {
    const rec = await store.save('x', 'r.csv', 'csv');
    const url = signExportUrl(base, rec.id, expIn(600), key);
    expect((await httpGet(`${url}x`)).status).toBe(403);
    expect((await httpGet(signExportUrl(base, 'AbCdEfGhIjKlMnOpQrStUv', expIn(600), key))).status).toBe(404);
    expect((await httpGet(`${base}/exports/..%2F..%2Fetc?exp=1&sig=x`)).status).toBe(404);
  });

  it('410s an expired link with fresh-link guidance', async () => {
    const rec = await store.save('x', 'r.csv', 'csv');
    const res = await httpGet(signExportUrl(base, rec.id, expIn(-1), key));
    expect(res.status).toBe(410);
    expect(res.body.toString()).toContain('get_export_link');
  });

  it('410s an expired export as "Export expired" even when the link is also expired', async () => {
    const rec = await store.save('x', 'r.csv', 'csv');
    nowMs += 8 * 24 * 60 * 60 * 1000;
    const res = await httpGet(signExportUrl(base, rec.id, expIn(-1), key));
    expect(res.status).toBe(410);
    expect(res.body.toString()).toBe('Export expired');
  });

  it('does not require the bearer token, while /mcp still does', async () => {
    const rec = await store.save('x', 'r.csv', 'csv');
    expect((await httpGet(signExportUrl(base, rec.id, expIn(600), key))).status).toBe(200);
    const mcp = await new Promise<number>((resolve, reject) => {
      const req = http.request(`${base}/mcp`, { method: 'POST', headers: { 'content-type': 'application/json' } }, (res) => resolve(res.statusCode ?? 0));
      req.on('error', reject);
      req.end('{}');
    });
    expect(mcp).toBe(401);
  });
});
