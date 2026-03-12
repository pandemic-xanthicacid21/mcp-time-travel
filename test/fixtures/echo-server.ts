#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

const server = new McpServer({ name: 'echo-server', version: '1.0.0' });

server.tool(
  'echo',
  'Echoes input back',
  { message: z.string().optional() },
  async (args) => ({
    content: [{ type: 'text' as const, text: JSON.stringify(args) }],
  }),
);

server.tool(
  'greet',
  'Returns a greeting',
  { name: z.string().optional() },
  async (args) => ({
    content: [{ type: 'text' as const, text: `Hello, ${args.name ?? 'world'}!` }],
  }),
);

const transport = new StdioServerTransport();
await server.connect(transport);
