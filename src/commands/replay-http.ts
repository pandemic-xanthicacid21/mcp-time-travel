import { createServer } from 'node:http';
import fs from 'node:fs';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import { SessionReader } from '../storage/session.js';
import { ReplayHandler } from '../replay/replay-server.js';
import { loadOverrides } from '../replay/overrides.js';
import { randomUUID } from 'node:crypto';
import { createReplayServer } from '../replay/server.js';

interface ReplayHttpOptions {
  dir: string;
  port: string;
  override?: string;
}

export async function replayHttpCommand(sessionId: string, options: ReplayHttpOptions): Promise<void> {
  const reader = new SessionReader(options.dir, sessionId);
  const metadata = await reader.getMetadata();
  const records = await reader.getRecords();
  const port = parseInt(options.port, 10);

  const overrides = options.override
    ? loadOverrides(fs.readFileSync(options.override, 'utf-8'))
    : [];

  const handler = new ReplayHandler(records, overrides);

  process.stderr.write(`[mcp-time-travel] Replaying HTTP session: ${sessionId}\n`);
  process.stderr.write(`[mcp-time-travel] Server: ${metadata.serverName}, ${metadata.toolCount} tool calls\n`);
  process.stderr.write(`[mcp-time-travel] Listening on port ${port}\n`);

  const transports = new Map<string, StreamableHTTPServerTransport>();

  const httpServer = createServer(async (req, res) => {
    const sessionIdHeader = req.headers['mcp-session-id'] as string | undefined;

    // Read body for POST
    let body: string | undefined;
    if (req.method === 'POST') {
      const chunks: Buffer[] = [];
      for await (const chunk of req) {
        chunks.push(chunk as Buffer);
      }
      body = Buffer.concat(chunks).toString('utf-8');
    }

    if (req.method === 'POST') {
      // Existing session
      if (sessionIdHeader && transports.has(sessionIdHeader)) {
        const transport = transports.get(sessionIdHeader)!;
        await transport.handleRequest(req, res, body ? JSON.parse(body) : undefined);
        return;
      }

      // New session — only for initialize requests
      const parsed = body ? JSON.parse(body) : undefined;
      if (!parsed || !isInitializeRequest(parsed)) {
        res.writeHead(400, { 'content-type': 'application/json' });
        res.end(JSON.stringify({
          jsonrpc: '2.0',
          error: { code: -32000, message: 'Bad Request: No valid session ID provided' },
          id: null,
        }));
        return;
      }

      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (sid) => {
          transports.set(sid, transport);
        },
      });

      transport.onclose = () => {
        if (transport.sessionId) {
          transports.delete(transport.sessionId);
        }
      };

      const replayServer = createReplayServer(metadata.serverName, handler);
      await replayServer.connect(transport);
      await transport.handleRequest(req, res, parsed);
    } else if (req.method === 'GET') {
      if (sessionIdHeader && transports.has(sessionIdHeader)) {
        const transport = transports.get(sessionIdHeader)!;
        await transport.handleRequest(req, res);
      } else {
        res.writeHead(400, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: 'Missing or invalid session ID' }));
      }
    } else if (req.method === 'DELETE') {
      if (sessionIdHeader && transports.has(sessionIdHeader)) {
        const transport = transports.get(sessionIdHeader)!;
        await transport.handleRequest(req, res);
      } else {
        res.writeHead(400, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: 'Missing or invalid session ID' }));
      }
    } else {
      res.writeHead(405, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'Method not allowed' }));
    }
  });

  httpServer.listen(port, () => {
    process.stderr.write(`[mcp-time-travel] HTTP replay server ready\n`);
  });

  process.on('SIGINT', () => {
    httpServer.close();
    process.exit(0);
  });

  process.on('SIGTERM', () => {
    httpServer.close();
    process.exit(0);
  });
}
