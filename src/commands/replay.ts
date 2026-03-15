import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import fs from 'node:fs';
import { SessionReader } from '../storage/session.js';
import { ReplayHandler } from '../replay/replay-server.js';
import { loadOverrides } from '../replay/overrides.js';
import { createReplayServer } from '../replay/server.js';

interface ReplayOptions {
  dir: string;
  override?: string;
}

export async function replayCommand(sessionId: string, options: ReplayOptions): Promise<void> {
  const reader = new SessionReader(options.dir, sessionId);
  const metadata = await reader.getMetadata();
  const records = await reader.getRecords();

  const overrides = options.override
    ? loadOverrides(fs.readFileSync(options.override, 'utf-8'))
    : [];

  const handler = new ReplayHandler(records, overrides);

  process.stderr.write(`[mcp-time-travel] Replaying session: ${sessionId}\n`);
  process.stderr.write(`[mcp-time-travel] Server: ${metadata.serverName}, ${metadata.toolCount} tool calls\n`);

  const server = createReplayServer(metadata.serverName, handler);
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
