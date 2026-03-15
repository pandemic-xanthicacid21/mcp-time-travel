import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type CallToolResult,
} from '@modelcontextprotocol/sdk/types.js';
import { CLI_VERSION } from '../version.js';
import { ReplayHandler } from './replay-server.js';

export function createReplayServer(serverName: string, handler: ReplayHandler): Server {
  const server = new Server({
    name: `mcp-time-travel:${serverName}`,
    version: CLI_VERSION,
  });

  server.registerCapabilities({
    tools: {
      listChanged: false,
    },
  });

  server.setRequestHandler(ListToolsRequestSchema, () => ({
    tools: handler.getTools(),
  }));

  server.setRequestHandler(CallToolRequestSchema, (request) => {
    const args = request.params.arguments ?? {};
    return handler.handleToolCall(request.params.name, args) as CallToolResult;
  });

  return server;
}
