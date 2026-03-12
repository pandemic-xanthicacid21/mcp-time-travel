import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SessionWriter, SessionReader, listSessions } from './session.js';
import type { ToolCallRecord, ToolsListRecord, McpServerConfig } from './types.js';

describe('SessionWriter', () => {
  let baseDir: string;
  const sessionId = 'test-session-001';
  const serverName = 'test-server';
  const serverConfig: McpServerConfig = {
    command: 'node',
    args: ['server.js'],
    env: { DEBUG: '1' },
  };

  beforeEach(async () => {
    baseDir = await mkdtemp(join(tmpdir(), 'mcp-replay-test-'));
  });

  afterEach(async () => {
    await rm(baseDir, { recursive: true, force: true });
  });

  it('creates session directory and metadata', async () => {
    const writer = new SessionWriter({ baseDir, sessionId, serverName, serverConfig });
    await writer.initialize();

    const metadataPath = join(baseDir, sessionId, 'metadata.json');
    const raw = await readFile(metadataPath, 'utf-8');
    const metadata = JSON.parse(raw);

    expect(metadata.id).toBe(sessionId);
    expect(metadata.serverName).toBe(serverName);
    expect(metadata.serverConfig).toEqual(serverConfig);
    expect(metadata.startTime).toBeTruthy();
    expect(metadata.endTime).toBe('');
    expect(metadata.toolCount).toBe(0);
    expect(metadata.tools).toEqual([]);
  });

  it('writes tool call records to JSONL', async () => {
    const writer = new SessionWriter({ baseDir, sessionId, serverName, serverConfig });
    await writer.initialize();

    const record: ToolCallRecord = {
      seq: 1,
      timestamp: new Date().toISOString(),
      type: 'tool_call',
      tool: 'readFile',
      input: { path: '/tmp/test.txt' },
      output: { content: 'hello' },
      latency_ms: 42,
      is_error: false,
    };

    await writer.writeRecord(record);

    const jsonlPath = join(baseDir, sessionId, 'recording.jsonl');
    const raw = await readFile(jsonlPath, 'utf-8');
    const lines = raw.trim().split('\n');
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0])).toEqual(record);
  });

  it('writes tools_list records', async () => {
    const writer = new SessionWriter({ baseDir, sessionId, serverName, serverConfig });
    await writer.initialize();

    const record: ToolsListRecord = {
      timestamp: new Date().toISOString(),
      type: 'tools_list',
      tools: [
        { name: 'readFile', description: 'Read a file' },
        { name: 'writeFile', description: 'Write a file' },
      ],
    };

    await writer.writeRecord(record);

    const jsonlPath = join(baseDir, sessionId, 'recording.jsonl');
    const raw = await readFile(jsonlPath, 'utf-8');
    const lines = raw.trim().split('\n');
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0])).toEqual(record);
  });

  it('finalizes session with endTime and toolCount', async () => {
    const writer = new SessionWriter({ baseDir, sessionId, serverName, serverConfig });
    await writer.initialize();

    const toolCall: ToolCallRecord = {
      seq: 1,
      timestamp: new Date().toISOString(),
      type: 'tool_call',
      tool: 'readFile',
      input: { path: '/tmp/test.txt' },
      output: { content: 'hello' },
      latency_ms: 42,
      is_error: false,
    };

    const toolsList: ToolsListRecord = {
      timestamp: new Date().toISOString(),
      type: 'tools_list',
      tools: [{ name: 'readFile', description: 'Read a file' }],
    };

    await writer.writeRecord(toolsList);
    await writer.writeRecord(toolCall);
    await writer.finalize();

    const metadataPath = join(baseDir, sessionId, 'metadata.json');
    const raw = await readFile(metadataPath, 'utf-8');
    const metadata = JSON.parse(raw);

    expect(metadata.endTime).toBeTruthy();
    expect(metadata.toolCount).toBe(1);
    expect(metadata.tools).toEqual(['readFile']);
  });
});

describe('SessionReader', () => {
  let baseDir: string;
  const sessionId = 'test-session-002';
  const serverName = 'test-server';
  const serverConfig: McpServerConfig = {
    command: 'node',
    args: ['server.js'],
  };

  beforeEach(async () => {
    baseDir = await mkdtemp(join(tmpdir(), 'mcp-replay-test-'));

    // Set up a session with data
    const writer = new SessionWriter({ baseDir, sessionId, serverName, serverConfig });
    await writer.initialize();

    const toolsList: ToolsListRecord = {
      timestamp: new Date().toISOString(),
      type: 'tools_list',
      tools: [
        { name: 'readFile', description: 'Read a file' },
        { name: 'writeFile', description: 'Write a file' },
      ],
    };

    const toolCall1: ToolCallRecord = {
      seq: 1,
      timestamp: new Date().toISOString(),
      type: 'tool_call',
      tool: 'readFile',
      input: { path: '/tmp/a.txt' },
      output: { content: 'aaa' },
      latency_ms: 10,
      is_error: false,
    };

    const toolCall2: ToolCallRecord = {
      seq: 2,
      timestamp: new Date().toISOString(),
      type: 'tool_call',
      tool: 'writeFile',
      input: { path: '/tmp/b.txt', content: 'bbb' },
      output: { success: true },
      latency_ms: 20,
      is_error: false,
    };

    await writer.writeRecord(toolsList);
    await writer.writeRecord(toolCall1);
    await writer.writeRecord(toolCall2);
    await writer.finalize();
  });

  afterEach(async () => {
    await rm(baseDir, { recursive: true, force: true });
  });

  it('reads session metadata', async () => {
    const reader = new SessionReader(baseDir, sessionId);
    const metadata = await reader.getMetadata();

    expect(metadata.id).toBe(sessionId);
    expect(metadata.serverName).toBe(serverName);
    expect(metadata.toolCount).toBe(2);
    expect(metadata.tools).toEqual(['readFile', 'writeFile']);
  });

  it('reads all records', async () => {
    const reader = new SessionReader(baseDir, sessionId);
    const records = await reader.getRecords();

    expect(records).toHaveLength(3);
    expect(records[0].type).toBe('tools_list');
    expect(records[1].type).toBe('tool_call');
    expect(records[2].type).toBe('tool_call');
  });

  it('reads only tool call records', async () => {
    const reader = new SessionReader(baseDir, sessionId);
    const toolCalls = await reader.getToolCalls();

    expect(toolCalls).toHaveLength(2);
    expect(toolCalls[0].tool).toBe('readFile');
    expect(toolCalls[1].tool).toBe('writeFile');
    expect(toolCalls.every((r) => r.type === 'tool_call')).toBe(true);
  });
});

describe('listSessions', () => {
  let baseDir: string;
  const serverConfig: McpServerConfig = { command: 'node', args: ['server.js'] };

  beforeEach(async () => {
    baseDir = await mkdtemp(join(tmpdir(), 'mcp-replay-test-'));
  });

  afterEach(async () => {
    await rm(baseDir, { recursive: true, force: true });
  });

  it('lists all sessions', async () => {
    // Create two sessions
    const writer1 = new SessionWriter({
      baseDir,
      sessionId: 'session-a',
      serverName: 'server-a',
      serverConfig,
    });
    await writer1.initialize();
    await writer1.finalize();

    const writer2 = new SessionWriter({
      baseDir,
      sessionId: 'session-b',
      serverName: 'server-b',
      serverConfig,
    });
    await writer2.initialize();
    await writer2.finalize();

    const sessions = await listSessions(baseDir);
    expect(sessions).toHaveLength(2);

    const ids = sessions.map((s) => s.id).sort();
    expect(ids).toEqual(['session-a', 'session-b']);
  });

  it('returns empty array for non-existent directory', async () => {
    const sessions = await listSessions(join(baseDir, 'nonexistent'));
    expect(sessions).toEqual([]);
  });
});
