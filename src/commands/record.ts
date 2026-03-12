import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { loadServerConfig } from '../config/loader.js';
import { SessionWriter } from '../storage/session.js';
import { RecordingProxy } from '../proxy/proxy.js';
import { generateSessionId } from '../utils/id.js';

interface RecordOptions {
  server: string;
  config: string;
  session?: string;
  output: string;
}

export async function recordCommand(options: RecordOptions): Promise<void> {
  const serverConfig = loadServerConfig(options.config, options.server);
  const sessionId = options.session ?? generateSessionId();

  const writer = new SessionWriter({
    baseDir: options.output,
    sessionId,
    serverName: options.server,
    serverConfig,
  });
  await writer.initialize();

  process.stderr.write(`[mcp-replay] Recording session: ${sessionId}\n`);
  process.stderr.write(`[mcp-replay] Server: ${options.server} (${serverConfig.command})\n`);

  // Spawn the real MCP server
  const child = spawn(serverConfig.command, serverConfig.args ?? [], {
    stdio: ['pipe', 'pipe', 'inherit'],
    env: { ...process.env, ...(serverConfig.env ?? {}) },
  });

  const proxy = new RecordingProxy(writer);

  // Agent → Proxy → Real Server
  const agentInput = createInterface({ input: process.stdin });
  agentInput.on('line', (line) => {
    const forwarded = proxy.handleAgentMessage(line);
    child.stdin.write(forwarded + '\n');
  });

  // Real Server → Proxy → Agent
  const serverOutput = createInterface({ input: child.stdout });
  serverOutput.on('line', async (line) => {
    const forwarded = await proxy.handleServerMessage(line);
    process.stdout.write(forwarded + '\n');
  });

  // Handle shutdown
  const cleanup = async () => {
    await writer.finalize();
    process.stderr.write(`[mcp-replay] Session saved: ${sessionId}\n`);
  };

  child.on('exit', async () => {
    await cleanup();
    process.exit(0);
  });

  process.on('SIGINT', async () => {
    child.kill();
    await cleanup();
    process.exit(0);
  });

  process.on('SIGTERM', async () => {
    child.kill();
    await cleanup();
    process.exit(0);
  });
}
