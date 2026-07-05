// ABOUTME: Express-based Streamable HTTP transport for the Gravity Forms MCP server.
// ABOUTME: Guards the /mcp endpoint with a shared bearer token for private-network use.
import type { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import express from 'express';
import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import type { Server as HttpServer } from 'node:http';

const SESSION_SWEEP_INTERVAL_MS = 5 * 60 * 1000;
const SESSION_IDLE_TIMEOUT_MS = 30 * 60 * 1000;

export function createBearerAuthMiddleware(expected: string): express.RequestHandler {
  return (req, res, next) => {
    const expectedHeader = `Bearer ${expected}`;
    const provided = req.headers.authorization ?? '';
    const a = createHash('sha256').update(provided).digest();
    const b = createHash('sha256').update(expectedHeader).digest();
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      res.status(401).json({
        jsonrpc: '2.0',
        error: { code: -32000, message: 'Unauthorized' },
        id: null,
      });
      return;
    }
    next();
  };
}

export function startHttpServer(
  createServer: () => Server,
  opts: { port: number; token: string }
): Promise<HttpServer> {
  const app = express();
  app.use(express.json());

  // Unauthenticated liveness probe for container/orchestrator health checks.
  app.get('/health', (_req, res) => {
    res.status(200).json({ status: 'ok' });
  });

  const transports: Record<string, StreamableHTTPServerTransport> = {};
  const lastActivity: Record<string, number> = {};
  const auth = createBearerAuthMiddleware(opts.token);

  app.post('/mcp', auth, async (req, res) => {
    const sessionId = req.headers['mcp-session-id'] as string | undefined;
    let transport: StreamableHTTPServerTransport;

    if (sessionId && transports[sessionId]) {
      transport = transports[sessionId];
      lastActivity[sessionId] = Date.now();
    } else if (!sessionId && isInitializeRequest(req.body)) {
      transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (sid) => {
          transports[sid] = transport;
          lastActivity[sid] = Date.now();
        },
      });
      // Each session gets its own MCP server: a server can only connect to a
      // single transport, so reusing one across sessions throws "Already
      // connected to a transport" and 500s every client after the first.
      const sessionServer = createServer();
      transport.onclose = () => {
        // Only clean up our session bookkeeping here. Do NOT call sessionServer.close():
        // connect() makes the server and transport reciprocal, so closing the server
        // re-closes the transport, which re-fires this onclose — infinite recursion and
        // a stack-overflow crash. A transport-initiated close already tears the server
        // down via connect(); dropping our references lets it be garbage-collected.
        if (transport.sessionId) {
          delete transports[transport.sessionId];
          delete lastActivity[transport.sessionId];
        }
      };
      await sessionServer.connect(transport);
      await transport.handleRequest(req, res, req.body);
      return;
    } else {
      res.status(400).json({
        jsonrpc: '2.0',
        error: { code: -32000, message: 'Bad Request: No valid session ID provided' },
        id: null,
      });
      return;
    }
    await transport.handleRequest(req, res, req.body);
  });

  const sessionRoute: express.RequestHandler = async (req, res) => {
    const sessionId = req.headers['mcp-session-id'] as string | undefined;
    if (!sessionId || !transports[sessionId]) {
      res.status(400).send('Invalid or missing session ID');
      return;
    }
    lastActivity[sessionId] = Date.now();
    await transports[sessionId].handleRequest(req, res);
  };
  app.get('/mcp', auth, sessionRoute);
  app.delete('/mcp', auth, sessionRoute);

  const sweepInterval = setInterval(async () => {
    const now = Date.now();
    for (const sessionId of Object.keys(lastActivity)) {
      if (now - lastActivity[sessionId] > SESSION_IDLE_TIMEOUT_MS) {
        if (transports[sessionId]) {
          await transports[sessionId].close();
        }
        delete lastActivity[sessionId];
      }
    }
  }, SESSION_SWEEP_INTERVAL_MS);
  sweepInterval.unref();

  return new Promise((resolve, reject) => {
    const httpServer = app.listen(opts.port, () => resolve(httpServer));
    httpServer.on('error', (error) => {
      // Rejects a failed bind (e.g. EADDRINUSE) before startup; after the server
      // is listening the promise is already settled, so this just surfaces
      // later runtime errors instead of swallowing them.
      console.error('HTTP server error:', error);
      reject(error);
    });
  });
}
