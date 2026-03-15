import { createServer, request as httpRequest } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { SessionWriter } from '../storage/session.js';
import { RecordingProxy } from '../proxy/proxy.js';
import { generateSessionId } from '../utils/id.js';
import { extractSSEEvents } from '../transport/sse.js';
import type { JsonRpcMessage } from '../proxy/interceptor.js';
import { AsyncWorkTracker } from '../utils/async-work-tracker.js';

// Headers that should not be forwarded between client and upstream
const SKIP_REQUEST_HEADERS = new Set([
  'connection', 'keep-alive', 'transfer-encoding', 'te',
  'trailer', 'upgrade', 'proxy-authorization', 'proxy-authenticate',
  'host',
]);

interface RecordHttpOptions {
  upstream: string;
  port: string;
  session?: string;
  output: string;
}

export async function recordHttpCommand(options: RecordHttpOptions): Promise<void> {
  const upstreamUrl = new URL(options.upstream);
  const port = parseInt(options.port, 10);
  const sessionId = options.session ?? generateSessionId();

  const writer = new SessionWriter({
    baseDir: options.output,
    sessionId,
    serverName: upstreamUrl.host,
    serverConfig: { url: options.upstream },
    transport: 'http',
  });
  await writer.initialize();

  const proxy = new RecordingProxy(writer);
  const activeRequests = new AsyncWorkTracker();
  const pendingWrites = new AsyncWorkTracker();
  let shuttingDown = false;
  let cleanupPromise: Promise<void> | null = null;

  process.stderr.write(`[mcp-time-travel] Recording HTTP session: ${sessionId}\n`);
  process.stderr.write(`[mcp-time-travel] Upstream: ${options.upstream}\n`);
  process.stderr.write(`[mcp-time-travel] Listening on port ${port}\n`);

  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    if (shuttingDown) {
      res.writeHead(503, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'server shutting down' }));
      return;
    }

    const requestWork = (async () => {
      try {
        await handleRequest(req, res, upstreamUrl, proxy, pendingWrites);
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        process.stderr.write(`[mcp-time-travel] Proxy error: ${errMsg}\n`);
        if (!res.headersSent) {
          res.writeHead(502, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ error: 'proxy error' }));
        }
      }
    })();

    void activeRequests.track(requestWork);
  });

  server.listen(port, () => {
    process.stderr.write(`[mcp-time-travel] HTTP proxy ready\n`);
  });

  const cleanup = async () => {
    if (cleanupPromise) {
      return cleanupPromise;
    }

    shuttingDown = true;
    cleanupPromise = (async () => {
      const closeServer = new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });

      await activeRequests.drain();
      await pendingWrites.drain();
      server.closeIdleConnections?.();
      server.closeAllConnections?.();
      await closeServer;
      await writer.finalize();
      process.stderr.write(`[mcp-time-travel] Session saved: ${sessionId}\n`);
    })();

    return cleanupPromise;
  };

  const shutdown = (signal: 'SIGINT' | 'SIGTERM') => {
    void (async () => {
      try {
        await cleanup();
        process.exit(0);
      } catch (error) {
        const errMsg = error instanceof Error ? error.message : String(error);
        process.stderr.write(`[mcp-time-travel] Shutdown error on ${signal}: ${errMsg}\n`);
        process.exit(1);
      }
    })();
  };

  process.on('SIGINT', () => {
    shutdown('SIGINT');
  });

  process.on('SIGTERM', () => {
    shutdown('SIGTERM');
  });
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString('utf-8');
}

function buildUpstreamHeaders(incoming: IncomingMessage): Record<string, string> {
  const headers: Record<string, string> = {};

  for (const [key, value] of Object.entries(incoming.headers)) {
    if (SKIP_REQUEST_HEADERS.has(key)) continue;
    if (typeof value === 'string') {
      headers[key] = value;
    } else if (Array.isArray(value)) {
      headers[key] = value.join(', ');
    }
  }

  return headers;
}

async function interceptMessages(
  proxy: RecordingProxy,
  body: string,
  direction: 'request' | 'response',
): Promise<void> {
  try {
    const parsed = JSON.parse(body);
    const messages: JsonRpcMessage[] = Array.isArray(parsed) ? parsed : [parsed];
    for (const msg of messages) {
      if (direction === 'request') {
        proxy.handleAgentRequest(msg);
      } else {
        await proxy.handleServerResponse(msg);
      }
    }
  } catch {
    // Not valid JSON — skip interception
  }
}

/**
 * Forward an HTTP request to the upstream using node:http.request.
 * We use http.request instead of fetch to avoid undici's connection pooling
 * issues (SocketError: other side closed) when upstream closes SSE connections.
 */
function forwardToUpstream(
  method: string,
  upstreamUrl: URL,
  headers: Record<string, string>,
  body?: string,
): Promise<IncomingMessage> {
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      {
        hostname: upstreamUrl.hostname,
        port: upstreamUrl.port,
        path: upstreamUrl.pathname + upstreamUrl.search,
        method,
        headers,
        agent: false, // Disable connection pooling — each request gets a fresh connection
      },
      (upstreamRes) => resolve(upstreamRes),
    );
    req.on('error', reject);
    if (body) {
      req.write(body);
    }
    req.end();
  });
}

async function handleRequest(
  req: IncomingMessage,
  res: ServerResponse,
  upstreamUrl: URL,
  proxy: RecordingProxy,
  pendingWrites: AsyncWorkTracker,
): Promise<void> {
  const method = req.method ?? 'GET';
  const headers = buildUpstreamHeaders(req);
  let body: string | undefined;

  // For POST, read body and intercept
  if (method === 'POST') {
    body = await readBody(req);
    await interceptMessages(proxy, body, 'request');
  }

  const upstreamRes = await forwardToUpstream(method, upstreamUrl, headers, body);

  // Copy response headers, filtering hop-by-hop
  const responseHeaders: Record<string, string | string[]> = {};
  for (const [key, value] of Object.entries(upstreamRes.headers)) {
    if (key === 'transfer-encoding' || key === 'connection') continue;
    if (value !== undefined) {
      responseHeaders[key] = value;
    }
  }

  const contentType = upstreamRes.headers['content-type'] ?? '';

  if (contentType.includes('text/event-stream')) {
    // SSE response — stream through, intercepting data fields for recording
    res.writeHead(upstreamRes.statusCode ?? 200, responseHeaders);

    let sseBuffer = '';
    let responseError: unknown;
    let responseChain = Promise.resolve();

    const queueResponseIntercept = (payload: string): void => {
      responseChain = responseChain
        .then(() => pendingWrites.track(interceptMessages(proxy, payload, 'response')))
        .catch((error) => {
          responseError ??= error;
        });
    };

    await new Promise<void>((resolve, reject) => {
      let settled = false;

      const cleanupListeners = (): void => {
        upstreamRes.off('data', onData);
        upstreamRes.off('end', onEnd);
        upstreamRes.off('error', onError);
        res.off('close', onClose);
      };

      const finish = (): void => {
        if (settled) return;
        settled = true;
        cleanupListeners();
        resolve();
      };

      const fail = (error: unknown): void => {
        if (settled) return;
        settled = true;
        cleanupListeners();
        reject(error);
      };

      const onData = (chunk: Buffer): void => {
        if (settled) return;

        const text = chunk.toString('utf-8');
        sseBuffer += text;

        const { complete, remaining } = extractSSEEvents(sseBuffer);
        sseBuffer = remaining;

        for (const event of complete) {
          if (event.data) {
            queueResponseIntercept(event.data);
          }
        }

        // Forward the raw chunk unchanged
        res.write(chunk);
      };

      const onEnd = (): void => {
        void (async () => {
          try {
            if (sseBuffer.trim()) {
              const { complete } = extractSSEEvents(sseBuffer + '\n\n');
              for (const event of complete) {
                if (event.data) {
                  queueResponseIntercept(event.data);
                }
              }
            }

            await responseChain;
            if (responseError) {
              throw responseError;
            }

            if (!res.writableEnded) {
              res.end();
            }
            finish();
          } catch (error) {
            fail(error);
          }
        })();
      };

      const onError = (err: Error): void => {
        process.stderr.write(`[mcp-time-travel] Upstream SSE error: ${err.message}\n`);
        if (!res.writableEnded) {
          res.end();
        }
        fail(err);
      };

      const onClose = (): void => {
        if (!upstreamRes.destroyed) {
          upstreamRes.destroy();
        }
        finish();
      };

      upstreamRes.on('data', onData);
      upstreamRes.on('end', onEnd);
      upstreamRes.on('error', onError);
      res.on('close', onClose);
    });
  } else {
    // Non-SSE response — read full body and intercept
    const chunks: Buffer[] = [];
    for await (const chunk of upstreamRes) {
      chunks.push(chunk as Buffer);
    }
    const responseBody = Buffer.concat(chunks).toString('utf-8');

    if (contentType.includes('application/json')) {
      await interceptMessages(proxy, responseBody, 'response');
    }

    res.writeHead(upstreamRes.statusCode ?? 200, responseHeaders);
    res.end(responseBody);
  }
}
