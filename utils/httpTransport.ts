// ABOUTME: Express-based Streamable HTTP transport for the Gravity Forms MCP server.
// ABOUTME: Guards /mcp with a shared bearer token; serves exports via signed, short-lived links.
import type { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import express from 'express';
import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import type { Server as HttpServer } from 'node:http';
import { checkSignature, isLinkExpired } from './exportLinks.js';
import { ExportExpiredError, ExportNotFoundError, isValidExportId } from './exportStore.js';
import type { ExportStore } from './exportStore.js';

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

function sendText(res: express.Response, status: number, text: string): void {
  res.status(status).type('text/plain').send(text);
}

export function createExportDownloadHandler(
  store: ExportStore,
  linkKey: Buffer,
  now: () => number = () => Date.now()
): express.RequestHandler {
  return async (req, res) => {
    const id = String(req.params.id);
    const exp = typeof req.query.exp === 'string' ? req.query.exp : '';
    const sig = typeof req.query.sig === 'string' ? req.query.sig : '';

    if (!isValidExportId(id)) {
      sendText(res, 404, 'Export not found');
      return;
    }
    if (!checkSignature(id, exp, sig, linkKey)) {
      sendText(res, 403, 'Invalid link');
      return;
    }

    let opened;
    try {
      opened = await store.open(id);
    } catch (error) {
      if (error instanceof ExportNotFoundError) {
        sendText(res, 404, 'Export not found');
      } else if (error instanceof ExportExpiredError) {
        sendText(res, 410, 'Export expired');
      } else {
        console.error('Export download failed:', error);
        sendText(res, 500, 'Download failed');
      }
      return;
    }

    if (isLinkExpired(Number(exp), Math.floor(now() / 1000))) {
      await opened.handle.close().catch(() => undefined);
      sendText(res, 410, 'Link expired; ask Claude for a fresh link (get_export_link)');
      return;
    }

    const { record, handle } = opened;

    // The client can disconnect while `store.open` above was pending; `res.on('close', ...)`
    // below is registered too late to catch that, so check explicitly before piping — a
    // destroyed response would otherwise strand the stream and leak the file handle.
    if (res.destroyed) {
      await handle.close();
      return;
    }

    res.status(200);
    res.setHeader('Content-Type', record.mimeType);
    res.setHeader('Content-Length', String(record.size));
    res.setHeader('Content-Disposition', `attachment; filename="${record.filename}"`);
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');

    // The handle was opened before streaming starts, so a concurrent sweep that
    // unlinks the file cannot truncate this response. autoClose releases it once
    // piping starts; earlier exits close it explicitly.
    const stream = handle.createReadStream();
    stream.on('error', (error) => {
      console.error('Export stream error:', error);
      res.destroy(error);
    });
    res.on('close', () => stream.destroy());
    stream.pipe(res);
  };
}

export function startHttpServer(
  createServer: () => Server,
  opts: { port: number; token: string; exports?: { store: ExportStore; linkKey: Buffer } }
): Promise<HttpServer> {
  const app = express();
  app.use(express.json());

  // Unauthenticated liveness probe for container/orchestrator health checks.
  app.get('/health', (_req, res) => {
    res.status(200).json({ status: 'ok' });
  });

  // Signature-guarded, not bearer-guarded: links must work from a browser click.
  if (opts.exports) {
    app.get('/exports/:id', createExportDownloadHandler(opts.exports.store, opts.exports.linkKey));
  }

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
