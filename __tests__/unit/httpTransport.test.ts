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
