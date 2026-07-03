import { createBearerAuthMiddleware, startHttpServer } from '../../utils/httpTransport';
import type { Server } from '@modelcontextprotocol/sdk/server/index.js';
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
    const fakeServer = {} as unknown as Server;
    const httpServer = await startHttpServer(fakeServer, { port: 0, token: 'unused' });
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
