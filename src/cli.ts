#!/usr/bin/env node
import { Command } from 'commander';
import path from 'node:path';
import os from 'node:os';
import { recordCommand } from './commands/record.js';
import { replayCommand } from './commands/replay.js';
import { recordHttpCommand } from './commands/record-http.js';
import { replayHttpCommand } from './commands/replay-http.js';
import { listCommand } from './commands/list.js';
import { debugCommand } from './commands/debug.js';
import { inspectCommand } from './commands/inspect.js';

const program = new Command();

program
  .name('mcp-time-travel')
  .description('Record, replay, and debug MCP tool call sessions')
  .version('0.1.0');

program
  .command('record')
  .description('Record an MCP session by proxying to a real server')
  .requiredOption('--server <name>', 'Name of the server in the config file')
  .option('--config <path>', 'Path to MCP config JSON', path.join(os.homedir(), '.claude', 'mcp.json'))
  .option('--session <id>', 'Custom session ID')
  .option('--output <dir>', 'Output directory', '.mcp-replay')
  .action(recordCommand);

program
  .command('replay <session-id>')
  .description('Replay a recorded MCP session')
  .option('--dir <dir>', 'Sessions directory', '.mcp-replay')
  .option('--speed <factor>', 'Replay speed: 0=instant, 1=real-time', '0')
  .option('--override <file>', 'JSON file with input/output overrides')
  .action(replayCommand);

program
  .command('record-http')
  .description('Record an MCP session by proxying HTTP to an upstream server')
  .requiredOption('--upstream <url>', 'Upstream MCP server URL')
  .option('--port <port>', 'Local proxy port', '8080')
  .option('--session <id>', 'Custom session ID')
  .option('--output <dir>', 'Output directory', '.mcp-replay')
  .action(recordHttpCommand);

program
  .command('replay-http <session-id>')
  .description('Replay a recorded MCP session over HTTP')
  .option('--dir <dir>', 'Sessions directory', '.mcp-replay')
  .option('--port <port>', 'Server port', '8080')
  .option('--override <file>', 'JSON file with input/output overrides')
  .action(replayHttpCommand);

program
  .command('list')
  .description('List recorded sessions')
  .option('--dir <dir>', 'Sessions directory', '.mcp-replay')
  .action(listCommand);

program
  .command('debug <session-id>')
  .description('Interactive step-through debugger for a recorded session')
  .option('--dir <dir>', 'Sessions directory', '.mcp-replay')
  .option('--step <n>', 'Start at step N', '1')
  .action(debugCommand);

program
  .command('inspect <session-id>')
  .description('Print a non-interactive summary of a recorded session')
  .option('--dir <dir>', 'Sessions directory', '.mcp-replay')
  .action(inspectCommand);

program.parse();
