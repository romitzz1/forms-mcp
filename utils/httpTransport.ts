// ABOUTME: Express-based Streamable HTTP transport for the Gravity Forms MCP server.
// ABOUTME: Guards the /mcp endpoint with a shared bearer token for private-network use.
import type { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import express from 'express';
import { randomUUID } from 'node:crypto';
import type { Server as HttpServer } from 'node:http';

export function createBearerAuthMiddleware(expected: string): express.RequestHandler {
  return (req, res, next) => {
    if (req.headers.authorization !== `Bearer ${expected}`) {
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
  server: Server,
  opts: { port: number; token: string }
): Promise<HttpServer> {
  const app = express();
  app.use(express.json());

  const transports: Record<string, StreamableHTTPServerTransport> = {};
  const auth = createBearerAuthMiddleware(opts.token);

  app.post('/mcp', auth, async (req, res) => {
    const sessionId = req.headers['mcp-session-id'] as string | undefined;
    let transport: StreamableHTTPServerTransport;

    if (sessionId && transports[sessionId]) {
      transport = transports[sessionId];
    } else if (!sessionId && isInitializeRequest(req.body)) {
      transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (sid) => { transports[sid] = transport; },
      });
      transport.onclose = () => {
        if (transport.sessionId) delete transports[transport.sessionId];
      };
      await server.connect(transport);
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
    await transports[sessionId].handleRequest(req, res);
  };
  app.get('/mcp', auth, sessionRoute);
  app.delete('/mcp', auth, sessionRoute);

  return new Promise((resolve) => {
    const httpServer = app.listen(opts.port, () => resolve(httpServer));
  });
}
