import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const PROJECT_ROOT = path.resolve(import.meta.dirname, '../..');
const CLI_PATH = path.join(PROJECT_ROOT, 'dist', 'cli.js');
const ECHO_SERVER_PATH = path.join(PROJECT_ROOT, 'test', 'fixtures', 'echo-server.ts');
const TSX_PATH = path.join(PROJECT_ROOT, 'node_modules', '.bin', 'tsx');

describe('Integration: record and replay flow', () => {
  let tmpDir: string;
  let configPath: string;
  let outputDir: string;
  const SESSION_ID = 'test-integration-1';

  // Results from the recording phase to compare against replay
  let recordedTools: Awaited<ReturnType<Client['listTools']>>;
  let recordedEchoResult: Awaited<ReturnType<Client['callTool']>>;
  let recordedGreetResult: Awaited<ReturnType<Client['callTool']>>;

  beforeAll(() => {
    // Create temp directory with MCP config
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-replay-integ-'));
    outputDir = path.join(tmpDir, 'sessions');
    configPath = path.join(tmpDir, 'mcp-config.json');

    const config = {
      mcpServers: {
        echo: {
          command: TSX_PATH,
          args: [ECHO_SERVER_PATH],
        },
      },
    };

    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
  });

  afterAll(() => {
    // Clean up temp directory
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('should record a session with tool calls', async () => {
    const transport = new StdioClientTransport({
      command: 'node',
      args: [
        CLI_PATH,
        'record',
        '--server', 'echo',
        '--config', configPath,
        '--session', SESSION_ID,
        '--output', outputDir,
      ],
      stderr: 'pipe',
    });

    const client = new Client(
      { name: 'integration-test', version: '1.0.0' },
    );

    await client.connect(transport);

    // List tools
    recordedTools = await client.listTools();
    expect(recordedTools.tools.length).toBe(2);
    const toolNames = recordedTools.tools.map((t) => t.name).sort();
    expect(toolNames).toEqual(['echo', 'greet']);

    // Call echo tool
    recordedEchoResult = await client.callTool({
      name: 'echo',
      arguments: { message: 'hello' },
    });
    expect(recordedEchoResult).toBeDefined();

    // Call greet tool
    recordedGreetResult = await client.callTool({
      name: 'greet',
      arguments: { name: 'Alice' },
    });
    expect(recordedGreetResult).toBeDefined();

    // Disconnect the client (this should also trigger session finalization)
    await client.close();
  }, 30_000);

  it('should have created recording files', () => {
    const sessionDir = path.join(outputDir, SESSION_ID);
    const metadataPath = path.join(sessionDir, 'metadata.json');
    const recordingPath = path.join(sessionDir, 'recording.jsonl');

    expect(fs.existsSync(metadataPath)).toBe(true);
    expect(fs.existsSync(recordingPath)).toBe(true);

    const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf-8'));
    expect(metadata.id).toBe(SESSION_ID);
    expect(metadata.serverName).toBe('echo');

    const lines = fs.readFileSync(recordingPath, 'utf-8').trim().split('\n');
    expect(lines.length).toBeGreaterThanOrEqual(3); // tools_list + 2 tool_calls

    // Verify we have a tools_list record and two tool_call records
    const records = lines.map((line) => JSON.parse(line));
    const toolsList = records.filter((r: { type: string }) => r.type === 'tools_list');
    const toolCalls = records.filter((r: { type: string }) => r.type === 'tool_call');
    expect(toolsList.length).toBe(1);
    expect(toolCalls.length).toBe(2);
  });

  it('should replay the recorded session with matching results', async () => {
    const transport = new StdioClientTransport({
      command: 'node',
      args: [
        CLI_PATH,
        'replay',
        SESSION_ID,
        '--dir', outputDir,
      ],
      stderr: 'pipe',
    });

    const client = new Client(
      { name: 'integration-test-replay', version: '1.0.0' },
    );

    await client.connect(transport);

    // List tools from replay
    const replayedTools = await client.listTools();
    expect(replayedTools.tools.length).toBe(recordedTools.tools.length);
    const replayToolNames = replayedTools.tools.map((t) => t.name).sort();
    expect(replayToolNames).toEqual(['echo', 'greet']);

    // Call echo tool from replay
    const replayedEchoResult = await client.callTool({
      name: 'echo',
      arguments: { message: 'hello' },
    });

    // The replay server returns the recorded output.
    // The recorded output is the full CallToolResult structure stored in recording.jsonl.
    // Verify the replayed content matches the original content.
    if ('content' in recordedEchoResult && 'content' in replayedEchoResult) {
      expect(replayedEchoResult.content).toEqual(recordedEchoResult.content);
    }

    // Call greet tool from replay
    const replayedGreetResult = await client.callTool({
      name: 'greet',
      arguments: { name: 'Alice' },
    });

    if ('content' in recordedGreetResult && 'content' in replayedGreetResult) {
      expect(replayedGreetResult.content).toEqual(recordedGreetResult.content);
    }

    await client.close();
  }, 30_000);
});
