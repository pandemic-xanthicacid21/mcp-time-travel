import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import fs from 'node:fs';
import { SessionReader } from '../storage/session.js';
import { ReplayHandler } from '../replay/replay-server.js';
import { loadOverrides } from '../replay/overrides.js';

interface ReplayOptions {
  dir: string;
  speed: string;
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
  const speed = parseFloat(options.speed);

  process.stderr.write(`[mcp-replay] Replaying session: ${sessionId}\n`);
  process.stderr.write(`[mcp-replay] Server: ${metadata.serverName}, ${metadata.toolCount} tool calls\n`);

  const server = new McpServer({
    name: `mcp-replay:${metadata.serverName}`,
    version: '0.1.0',
  });

  // Register all recorded tools
  const tools = handler.getTools();
  for (const tool of tools) {
    const toolName = tool.name;
    server.tool(
      toolName,
      tool.description ?? `[replayed] ${toolName}`,
      async () => {
        const result = handler.handleToolCall(toolName, {});
        return result as CallToolResult;
      },
    );
  }

  const transport = new StdioServerTransport();
  await server.connect(transport);
}
