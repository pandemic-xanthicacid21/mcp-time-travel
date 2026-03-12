# mcp-replay Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build an npm package (`mcp-replay`) that records, replays, and debugs MCP tool call sessions via a transparent stdio proxy.

**Architecture:** A single TypeScript CLI with three modes — record (proxy between agent and real MCP server, logging tool calls to JSONL), replay (MCP server serving recorded responses), and debug (interactive terminal step-through). Uses the `@modelcontextprotocol/sdk` for MCP protocol handling.

**Tech Stack:** TypeScript, `@modelcontextprotocol/sdk` 1.27.x, `commander` 14.x, `nanoid`, `chalk`, Node.js `readline`, `vitest` for testing.

---

### Task 1: Project Scaffolding

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `src/cli.ts` (minimal placeholder)
- Create: `vitest.config.ts`

**Step 1: Initialize package.json**

```bash
cd /Users/martin.demiddel/Develop/mcp-replay
npm init -y
```

Then edit `package.json` to:

```json
{
  "name": "mcp-replay",
  "version": "0.1.0",
  "description": "Record, replay, and debug MCP tool call sessions",
  "type": "module",
  "bin": {
    "mcp-replay": "./dist/cli.js"
  },
  "scripts": {
    "build": "tsc",
    "dev": "tsc --watch",
    "test": "vitest run",
    "test:watch": "vitest",
    "prepublishOnly": "npm run build"
  },
  "keywords": ["mcp", "replay", "debug", "agent", "tool-calls"],
  "license": "MIT",
  "engines": {
    "node": ">=18"
  }
}
```

**Step 2: Install dependencies**

```bash
npm install @modelcontextprotocol/sdk commander nanoid chalk
npm install -D typescript vitest @types/node
```

**Step 3: Create tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "Node16",
    "moduleResolution": "Node16",
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "declaration": true,
    "sourceMap": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist", "**/*.test.ts"]
}
```

**Step 4: Create vitest.config.ts**

```typescript
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
  },
});
```

**Step 5: Create minimal CLI entry point**

Create `src/cli.ts`:

```typescript
#!/usr/bin/env node
import { Command } from 'commander';

const program = new Command();

program
  .name('mcp-replay')
  .description('Record, replay, and debug MCP tool call sessions')
  .version('0.1.0');

program.parse();
```

**Step 6: Build and verify**

```bash
npx tsc
node dist/cli.js --help
```

Expected: prints help text with description and version.

**Step 7: Commit**

```bash
git add package.json package-lock.json tsconfig.json vitest.config.ts src/cli.ts
git commit -m "feat: scaffold mcp-replay project"
```

---

### Task 2: Types and Session Storage

**Files:**
- Create: `src/storage/types.ts`
- Create: `src/storage/session.ts`
- Create: `src/storage/session.test.ts`

**Step 1: Write the types**

Create `src/storage/types.ts`:

```typescript
export interface McpServerConfig {
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

export interface SessionMetadata {
  id: string;
  serverName: string;
  serverConfig: McpServerConfig;
  startTime: string;
  endTime: string;
  toolCount: number;
  tools: string[];
}

export interface ToolCallRecord {
  seq: number;
  timestamp: string;
  type: 'tool_call';
  tool: string;
  input: Record<string, unknown>;
  output: unknown;
  latency_ms: number;
  is_error: boolean;
}

export interface ToolsListRecord {
  timestamp: string;
  type: 'tools_list';
  tools: Array<{
    name: string;
    description?: string;
    inputSchema?: Record<string, unknown>;
  }>;
}

export type RecordEntry = ToolCallRecord | ToolsListRecord;
```

**Step 2: Write the failing tests**

Create `src/storage/session.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { SessionWriter, SessionReader, listSessions } from './session.js';
import type { ToolCallRecord, ToolsListRecord, SessionMetadata } from './types.js';

describe('SessionWriter', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-replay-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true });
  });

  it('creates session directory and metadata', async () => {
    const writer = new SessionWriter({
      baseDir: tmpDir,
      sessionId: 'test-session-1',
      serverName: 'my-server',
      serverConfig: { command: 'node', args: ['server.js'] },
    });
    await writer.initialize();

    const metadataPath = path.join(tmpDir, 'sessions', 'test-session-1', 'metadata.json');
    expect(fs.existsSync(metadataPath)).toBe(true);

    const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf-8'));
    expect(metadata.id).toBe('test-session-1');
    expect(metadata.serverName).toBe('my-server');
  });

  it('writes tool call records to JSONL', async () => {
    const writer = new SessionWriter({
      baseDir: tmpDir,
      sessionId: 'test-session-2',
      serverName: 'my-server',
      serverConfig: { command: 'node' },
    });
    await writer.initialize();

    const record: ToolCallRecord = {
      seq: 1,
      timestamp: '2026-03-12T10:00:00.000Z',
      type: 'tool_call',
      tool: 'read_file',
      input: { path: '/foo' },
      output: { content: [{ type: 'text', text: 'hello' }] },
      latency_ms: 42,
      is_error: false,
    };
    await writer.writeRecord(record);

    const record2: ToolCallRecord = {
      seq: 2,
      timestamp: '2026-03-12T10:00:01.000Z',
      type: 'tool_call',
      tool: 'write_file',
      input: { path: '/bar', content: 'world' },
      output: { content: [{ type: 'text', text: 'ok' }] },
      latency_ms: 15,
      is_error: false,
    };
    await writer.writeRecord(record2);

    const recordingPath = path.join(tmpDir, 'sessions', 'test-session-2', 'recording.jsonl');
    const lines = fs.readFileSync(recordingPath, 'utf-8').trim().split('\n');
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0]).tool).toBe('read_file');
    expect(JSON.parse(lines[1]).tool).toBe('write_file');
  });

  it('writes tools_list records', async () => {
    const writer = new SessionWriter({
      baseDir: tmpDir,
      sessionId: 'test-session-3',
      serverName: 'my-server',
      serverConfig: { command: 'node' },
    });
    await writer.initialize();

    const record: ToolsListRecord = {
      timestamp: '2026-03-12T10:00:00.000Z',
      type: 'tools_list',
      tools: [{ name: 'read_file', description: 'Read a file' }],
    };
    await writer.writeRecord(record);

    const recordingPath = path.join(tmpDir, 'sessions', 'test-session-3', 'recording.jsonl');
    const lines = fs.readFileSync(recordingPath, 'utf-8').trim().split('\n');
    expect(JSON.parse(lines[0]).type).toBe('tools_list');
  });

  it('finalizes session with endTime and toolCount', async () => {
    const writer = new SessionWriter({
      baseDir: tmpDir,
      sessionId: 'test-session-4',
      serverName: 'my-server',
      serverConfig: { command: 'node' },
    });
    await writer.initialize();

    const record: ToolCallRecord = {
      seq: 1,
      timestamp: '2026-03-12T10:00:00.000Z',
      type: 'tool_call',
      tool: 'read_file',
      input: { path: '/foo' },
      output: { content: [] },
      latency_ms: 10,
      is_error: false,
    };
    await writer.writeRecord(record);
    await writer.finalize();

    const metadataPath = path.join(tmpDir, 'sessions', 'test-session-4', 'metadata.json');
    const metadata: SessionMetadata = JSON.parse(fs.readFileSync(metadataPath, 'utf-8'));
    expect(metadata.endTime).toBeTruthy();
    expect(metadata.toolCount).toBe(1);
    expect(metadata.tools).toEqual(['read_file']);
  });
});

describe('SessionReader', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-replay-test-'));
    // Set up a session to read
    const writer = new SessionWriter({
      baseDir: tmpDir,
      sessionId: 'read-test',
      serverName: 'test-server',
      serverConfig: { command: 'echo' },
    });
    await writer.initialize();
    await writer.writeRecord({
      seq: 1,
      timestamp: '2026-03-12T10:00:00.000Z',
      type: 'tool_call',
      tool: 'read_file',
      input: { path: '/foo' },
      output: { content: [{ type: 'text', text: 'hello' }] },
      latency_ms: 42,
      is_error: false,
    });
    await writer.writeRecord({
      seq: 2,
      timestamp: '2026-03-12T10:00:01.000Z',
      type: 'tool_call',
      tool: 'write_file',
      input: { path: '/bar', content: 'x' },
      output: { content: [{ type: 'text', text: 'ok' }] },
      latency_ms: 15,
      is_error: false,
    });
    await writer.finalize();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true });
  });

  it('reads session metadata', async () => {
    const reader = new SessionReader(tmpDir, 'read-test');
    const metadata = await reader.getMetadata();
    expect(metadata.id).toBe('read-test');
    expect(metadata.serverName).toBe('test-server');
  });

  it('reads all records', async () => {
    const reader = new SessionReader(tmpDir, 'read-test');
    const records = await reader.getRecords();
    expect(records).toHaveLength(2);
    expect(records[0].type).toBe('tool_call');
  });

  it('reads only tool call records', async () => {
    const reader = new SessionReader(tmpDir, 'read-test');
    const toolCalls = await reader.getToolCalls();
    expect(toolCalls).toHaveLength(2);
    expect(toolCalls[0].tool).toBe('read_file');
    expect(toolCalls[1].tool).toBe('write_file');
  });
});

describe('listSessions', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-replay-test-'));
    for (const id of ['session-a', 'session-b']) {
      const writer = new SessionWriter({
        baseDir: tmpDir,
        sessionId: id,
        serverName: 'test-server',
        serverConfig: { command: 'echo' },
      });
      await writer.initialize();
      await writer.finalize();
    }
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true });
  });

  it('lists all sessions', async () => {
    const sessions = await listSessions(tmpDir);
    expect(sessions).toHaveLength(2);
    const ids = sessions.map(s => s.id);
    expect(ids).toContain('session-a');
    expect(ids).toContain('session-b');
  });
});
```

**Step 3: Run tests to verify they fail**

```bash
npx vitest run src/storage/session.test.ts
```

Expected: FAIL — modules don't exist yet.

**Step 4: Implement SessionWriter, SessionReader, and listSessions**

Create `src/storage/session.ts`:

```typescript
import fs from 'node:fs';
import path from 'node:path';
import type { SessionMetadata, McpServerConfig, RecordEntry, ToolCallRecord } from './types.js';

interface SessionWriterOptions {
  baseDir: string;
  sessionId: string;
  serverName: string;
  serverConfig: McpServerConfig;
}

export class SessionWriter {
  private sessionDir: string;
  private metadataPath: string;
  private recordingPath: string;
  private metadata: SessionMetadata;
  private toolNames: Set<string> = new Set();
  private toolCount = 0;

  constructor(private options: SessionWriterOptions) {
    this.sessionDir = path.join(options.baseDir, 'sessions', options.sessionId);
    this.metadataPath = path.join(this.sessionDir, 'metadata.json');
    this.recordingPath = path.join(this.sessionDir, 'recording.jsonl');
    this.metadata = {
      id: options.sessionId,
      serverName: options.serverName,
      serverConfig: options.serverConfig,
      startTime: new Date().toISOString(),
      endTime: '',
      toolCount: 0,
      tools: [],
    };
  }

  async initialize(): Promise<void> {
    fs.mkdirSync(this.sessionDir, { recursive: true });
    fs.writeFileSync(this.metadataPath, JSON.stringify(this.metadata, null, 2));
    fs.writeFileSync(this.recordingPath, '');
  }

  async writeRecord(record: RecordEntry): Promise<void> {
    const line = JSON.stringify(record) + '\n';
    fs.appendFileSync(this.recordingPath, line);
    if (record.type === 'tool_call') {
      this.toolCount++;
      this.toolNames.add(record.tool);
    }
  }

  async finalize(): Promise<void> {
    this.metadata.endTime = new Date().toISOString();
    this.metadata.toolCount = this.toolCount;
    this.metadata.tools = Array.from(this.toolNames);
    fs.writeFileSync(this.metadataPath, JSON.stringify(this.metadata, null, 2));
  }
}

export class SessionReader {
  private sessionDir: string;

  constructor(baseDir: string, sessionId: string) {
    this.sessionDir = path.join(baseDir, 'sessions', sessionId);
  }

  async getMetadata(): Promise<SessionMetadata> {
    const raw = fs.readFileSync(path.join(this.sessionDir, 'metadata.json'), 'utf-8');
    return JSON.parse(raw);
  }

  async getRecords(): Promise<RecordEntry[]> {
    const raw = fs.readFileSync(path.join(this.sessionDir, 'recording.jsonl'), 'utf-8');
    return raw
      .trim()
      .split('\n')
      .filter(line => line.length > 0)
      .map(line => JSON.parse(line));
  }

  async getToolCalls(): Promise<ToolCallRecord[]> {
    const records = await this.getRecords();
    return records.filter((r): r is ToolCallRecord => r.type === 'tool_call');
  }
}

export async function listSessions(baseDir: string): Promise<SessionMetadata[]> {
  const sessionsDir = path.join(baseDir, 'sessions');
  if (!fs.existsSync(sessionsDir)) return [];

  const entries = fs.readdirSync(sessionsDir, { withFileTypes: true });
  const sessions: SessionMetadata[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const metaPath = path.join(sessionsDir, entry.name, 'metadata.json');
    if (!fs.existsSync(metaPath)) continue;
    sessions.push(JSON.parse(fs.readFileSync(metaPath, 'utf-8')));
  }

  return sessions;
}
```

**Step 5: Run tests to verify they pass**

```bash
npx vitest run src/storage/session.test.ts
```

Expected: all tests PASS.

**Step 6: Commit**

```bash
git add src/storage/
git commit -m "feat: add session storage layer with types, writer, reader"
```

---

### Task 3: Config Loader

**Files:**
- Create: `src/config/loader.ts`
- Create: `src/config/loader.test.ts`

**Step 1: Write the failing tests**

Create `src/config/loader.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { loadServerConfig } from './loader.js';

describe('loadServerConfig', () => {
  let tmpDir: string;
  let configPath: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-config-test-'));
    configPath = path.join(tmpDir, 'mcp.json');
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true });
  });

  it('loads a server config by name', () => {
    fs.writeFileSync(configPath, JSON.stringify({
      mcpServers: {
        'my-server': { command: 'node', args: ['server.js'] },
        'other-server': { command: 'python', args: ['server.py'] },
      },
    }));

    const config = loadServerConfig(configPath, 'my-server');
    expect(config.command).toBe('node');
    expect(config.args).toEqual(['server.js']);
  });

  it('throws if server name not found', () => {
    fs.writeFileSync(configPath, JSON.stringify({
      mcpServers: {
        'my-server': { command: 'node' },
      },
    }));

    expect(() => loadServerConfig(configPath, 'missing')).toThrow(/not found/i);
  });

  it('throws if config file does not exist', () => {
    expect(() => loadServerConfig('/nonexistent/path.json', 'foo')).toThrow();
  });

  it('loads env from server config', () => {
    fs.writeFileSync(configPath, JSON.stringify({
      mcpServers: {
        'env-server': { command: 'node', env: { API_KEY: 'secret' } },
      },
    }));

    const config = loadServerConfig(configPath, 'env-server');
    expect(config.env).toEqual({ API_KEY: 'secret' });
  });
});
```

**Step 2: Run tests to verify they fail**

```bash
npx vitest run src/config/loader.test.ts
```

Expected: FAIL.

**Step 3: Implement the config loader**

Create `src/config/loader.ts`:

```typescript
import fs from 'node:fs';
import type { McpServerConfig } from '../storage/types.js';

interface McpConfigFile {
  mcpServers: Record<string, McpServerConfig>;
}

export function loadServerConfig(configPath: string, serverName: string): McpServerConfig {
  const raw = fs.readFileSync(configPath, 'utf-8');
  const config: McpConfigFile = JSON.parse(raw);

  if (!config.mcpServers || !config.mcpServers[serverName]) {
    const available = config.mcpServers ? Object.keys(config.mcpServers).join(', ') : 'none';
    throw new Error(
      `Server "${serverName}" not found in config. Available servers: ${available}`
    );
  }

  return config.mcpServers[serverName];
}
```

**Step 4: Run tests to verify they pass**

```bash
npx vitest run src/config/loader.test.ts
```

Expected: all tests PASS.

**Step 5: Commit**

```bash
git add src/config/
git commit -m "feat: add MCP config loader for Claude Code format"
```

---

### Task 4: Session ID Generation

**Files:**
- Create: `src/utils/id.ts`
- Create: `src/utils/id.test.ts`

**Step 1: Write the failing tests**

Create `src/utils/id.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { generateSessionId } from './id.js';

describe('generateSessionId', () => {
  it('generates a string', () => {
    const id = generateSessionId();
    expect(typeof id).toBe('string');
    expect(id.length).toBeGreaterThan(0);
  });

  it('generates unique IDs', () => {
    const ids = new Set(Array.from({ length: 100 }, () => generateSessionId()));
    expect(ids.size).toBe(100);
  });

  it('starts with a date-like prefix', () => {
    const id = generateSessionId();
    // Format: YYYYMMDD-HHmmss-<random>
    expect(id).toMatch(/^\d{8}-\d{6}-.+$/);
  });
});
```

**Step 2: Run tests to verify they fail**

```bash
npx vitest run src/utils/id.test.ts
```

Expected: FAIL.

**Step 3: Implement ID generation**

Create `src/utils/id.ts`:

```typescript
import { nanoid } from 'nanoid';

export function generateSessionId(): string {
  const now = new Date();
  const date = now.toISOString().replace(/[-:T]/g, '').slice(0, 8);
  const time = now.toISOString().replace(/[-:T]/g, '').slice(8, 14);
  return `${date}-${time}-${nanoid(6)}`;
}
```

**Step 4: Run tests to verify they pass**

```bash
npx vitest run src/utils/id.test.ts
```

Expected: all tests PASS.

**Step 5: Commit**

```bash
git add src/utils/
git commit -m "feat: add timestamp-based session ID generation"
```

---

### Task 5: JSON-RPC Interceptor

**Files:**
- Create: `src/proxy/interceptor.ts`
- Create: `src/proxy/interceptor.test.ts`

The interceptor parses newline-delimited JSON-RPC messages and identifies MCP method calls.

**Step 1: Write the failing tests**

Create `src/proxy/interceptor.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { parseJsonRpcMessage, isToolCallRequest, isToolCallResponse, isToolsListRequest, isToolsListResponse, matchResponse } from './interceptor.js';

describe('parseJsonRpcMessage', () => {
  it('parses a valid JSON-RPC request', () => {
    const msg = parseJsonRpcMessage('{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"read_file","arguments":{"path":"/foo"}}}');
    expect(msg).toBeTruthy();
    expect(msg!.method).toBe('tools/call');
    expect(msg!.id).toBe(1);
  });

  it('returns null for invalid JSON', () => {
    const msg = parseJsonRpcMessage('not json');
    expect(msg).toBeNull();
  });

  it('parses a JSON-RPC response', () => {
    const msg = parseJsonRpcMessage('{"jsonrpc":"2.0","id":1,"result":{"content":[{"type":"text","text":"hello"}]}}');
    expect(msg).toBeTruthy();
    expect(msg!.id).toBe(1);
    expect(msg!.result).toBeTruthy();
  });
});

describe('isToolCallRequest', () => {
  it('identifies tools/call requests', () => {
    const msg = { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'read_file', arguments: {} } };
    expect(isToolCallRequest(msg)).toBe(true);
  });

  it('rejects other methods', () => {
    const msg = { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} };
    expect(isToolCallRequest(msg)).toBe(false);
  });
});

describe('isToolsListRequest', () => {
  it('identifies tools/list requests', () => {
    const msg = { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} };
    expect(isToolsListRequest(msg)).toBe(true);
  });
});

describe('matchResponse', () => {
  it('matches response to request by id', () => {
    const req = { jsonrpc: '2.0', id: 5, method: 'tools/call', params: {} };
    const res = { jsonrpc: '2.0', id: 5, result: {} };
    expect(matchResponse(req, res)).toBe(true);
  });

  it('does not match different ids', () => {
    const req = { jsonrpc: '2.0', id: 5, method: 'tools/call', params: {} };
    const res = { jsonrpc: '2.0', id: 6, result: {} };
    expect(matchResponse(req, res)).toBe(false);
  });
});
```

**Step 2: Run tests to verify they fail**

```bash
npx vitest run src/proxy/interceptor.test.ts
```

Expected: FAIL.

**Step 3: Implement the interceptor**

Create `src/proxy/interceptor.ts`:

```typescript
export interface JsonRpcMessage {
  jsonrpc: string;
  id?: number | string;
  method?: string;
  params?: Record<string, unknown>;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

export function parseJsonRpcMessage(raw: string): JsonRpcMessage | null {
  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return null;
    return parsed as JsonRpcMessage;
  } catch {
    return null;
  }
}

export function isToolCallRequest(msg: JsonRpcMessage): boolean {
  return msg.method === 'tools/call' && msg.id !== undefined;
}

export function isToolsListRequest(msg: JsonRpcMessage): boolean {
  return msg.method === 'tools/list' && msg.id !== undefined;
}

export function isToolCallResponse(msg: JsonRpcMessage): boolean {
  return msg.id !== undefined && msg.method === undefined && (msg.result !== undefined || msg.error !== undefined);
}

export function isToolsListResponse(msg: JsonRpcMessage): boolean {
  return isToolCallResponse(msg); // structurally the same — differentiated by matching to request
}

export function matchResponse(request: JsonRpcMessage, response: JsonRpcMessage): boolean {
  return request.id !== undefined && request.id === response.id;
}
```

**Step 4: Run tests to verify they pass**

```bash
npx vitest run src/proxy/interceptor.test.ts
```

Expected: all tests PASS.

**Step 5: Commit**

```bash
git add src/proxy/
git commit -m "feat: add JSON-RPC message parser and MCP method detection"
```

---

### Task 6: Recording Proxy

**Files:**
- Create: `src/proxy/proxy.ts`
- Create: `src/proxy/proxy.test.ts`

The proxy spawns the real MCP server as a child process, intercepts stdio, and logs tool calls.

**Step 1: Write the failing tests**

Create `src/proxy/proxy.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { RecordingProxy } from './proxy.js';
import type { SessionWriter } from '../storage/session.js';

// We test the message-handling logic, not the actual child process spawning
describe('RecordingProxy message handling', () => {
  let mockWriter: SessionWriter;

  beforeEach(() => {
    mockWriter = {
      initialize: vi.fn(),
      writeRecord: vi.fn(),
      finalize: vi.fn(),
    } as unknown as SessionWriter;
  });

  it('records a tool call when request and response are processed', async () => {
    const proxy = new RecordingProxy(mockWriter);

    // Simulate agent sending tools/call request
    proxy.handleAgentMessage(JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name: 'read_file', arguments: { path: '/foo' } },
    }));

    // Simulate server responding
    await proxy.handleServerMessage(JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      result: { content: [{ type: 'text', text: 'file contents' }] },
    }));

    expect(mockWriter.writeRecord).toHaveBeenCalledTimes(1);
    const record = (mockWriter.writeRecord as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(record.type).toBe('tool_call');
    expect(record.tool).toBe('read_file');
    expect(record.input).toEqual({ path: '/foo' });
    expect(record.output).toEqual({ content: [{ type: 'text', text: 'file contents' }] });
    expect(record.latency_ms).toBeGreaterThanOrEqual(0);
    expect(record.is_error).toBe(false);
  });

  it('records error tool calls', async () => {
    const proxy = new RecordingProxy(mockWriter);

    proxy.handleAgentMessage(JSON.stringify({
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: { name: 'write_file', arguments: { path: '/x' } },
    }));

    await proxy.handleServerMessage(JSON.stringify({
      jsonrpc: '2.0',
      id: 2,
      result: { content: [{ type: 'text', text: 'error' }], isError: true },
    }));

    const record = (mockWriter.writeRecord as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(record.is_error).toBe(true);
  });

  it('records tools/list responses', async () => {
    const proxy = new RecordingProxy(mockWriter);

    proxy.handleAgentMessage(JSON.stringify({
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/list',
      params: {},
    }));

    await proxy.handleServerMessage(JSON.stringify({
      jsonrpc: '2.0',
      id: 3,
      result: { tools: [{ name: 'read_file', description: 'Read' }] },
    }));

    expect(mockWriter.writeRecord).toHaveBeenCalledTimes(1);
    const record = (mockWriter.writeRecord as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(record.type).toBe('tools_list');
    expect(record.tools).toEqual([{ name: 'read_file', description: 'Read' }]);
  });

  it('does not record non-tool messages', async () => {
    const proxy = new RecordingProxy(mockWriter);

    proxy.handleAgentMessage(JSON.stringify({
      jsonrpc: '2.0',
      id: 4,
      method: 'initialize',
      params: { capabilities: {} },
    }));

    await proxy.handleServerMessage(JSON.stringify({
      jsonrpc: '2.0',
      id: 4,
      result: { capabilities: {} },
    }));

    expect(mockWriter.writeRecord).not.toHaveBeenCalled();
  });

  it('increments sequence numbers', async () => {
    const proxy = new RecordingProxy(mockWriter);

    for (let i = 1; i <= 3; i++) {
      proxy.handleAgentMessage(JSON.stringify({
        jsonrpc: '2.0',
        id: i,
        method: 'tools/call',
        params: { name: 'tool_' + i, arguments: {} },
      }));
      await proxy.handleServerMessage(JSON.stringify({
        jsonrpc: '2.0',
        id: i,
        result: { content: [] },
      }));
    }

    const calls = (mockWriter.writeRecord as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls[0][0].seq).toBe(1);
    expect(calls[1][0].seq).toBe(2);
    expect(calls[2][0].seq).toBe(3);
  });
});
```

**Step 2: Run tests to verify they fail**

```bash
npx vitest run src/proxy/proxy.test.ts
```

Expected: FAIL.

**Step 3: Implement RecordingProxy**

Create `src/proxy/proxy.ts`:

```typescript
import { parseJsonRpcMessage, isToolCallRequest, isToolsListRequest, matchResponse } from './interceptor.js';
import type { JsonRpcMessage } from './interceptor.js';
import type { SessionWriter } from '../storage/session.js';
import type { ToolCallRecord, ToolsListRecord } from '../storage/types.js';

interface PendingRequest {
  message: JsonRpcMessage;
  method: string;
  startTime: number;
}

export class RecordingProxy {
  private pendingRequests = new Map<number | string, PendingRequest>();
  private seq = 0;

  constructor(private writer: SessionWriter) {}

  /**
   * Process a message from the agent (heading to the server).
   * Returns the raw message string to forward to the server.
   */
  handleAgentMessage(raw: string): string {
    const msg = parseJsonRpcMessage(raw);
    if (msg && msg.id !== undefined && (isToolCallRequest(msg) || isToolsListRequest(msg))) {
      this.pendingRequests.set(msg.id, {
        message: msg,
        method: msg.method!,
        startTime: Date.now(),
      });
    }
    return raw;
  }

  /**
   * Process a message from the server (heading to the agent).
   * Returns the raw message string to forward to the agent.
   */
  async handleServerMessage(raw: string): Promise<string> {
    const msg = parseJsonRpcMessage(raw);
    if (msg && msg.id !== undefined) {
      const pending = this.pendingRequests.get(msg.id);
      if (pending) {
        this.pendingRequests.delete(msg.id);
        const latency = Date.now() - pending.startTime;

        if (pending.method === 'tools/call') {
          this.seq++;
          const params = pending.message.params as { name: string; arguments?: Record<string, unknown> };
          const result = msg.result as { content?: unknown[]; isError?: boolean } | undefined;
          const record: ToolCallRecord = {
            seq: this.seq,
            timestamp: new Date().toISOString(),
            type: 'tool_call',
            tool: params.name,
            input: params.arguments ?? {},
            output: msg.error ? { error: msg.error } : (msg.result ?? {}),
            latency_ms: latency,
            is_error: !!(msg.error || result?.isError),
          };
          await this.writer.writeRecord(record);
        } else if (pending.method === 'tools/list') {
          const result = msg.result as { tools?: Array<{ name: string; description?: string; inputSchema?: Record<string, unknown> }> } | undefined;
          if (result?.tools) {
            const record: ToolsListRecord = {
              timestamp: new Date().toISOString(),
              type: 'tools_list',
              tools: result.tools.map(t => ({
                name: t.name,
                ...(t.description ? { description: t.description } : {}),
                ...(t.inputSchema ? { inputSchema: t.inputSchema } : {}),
              })),
            };
            await this.writer.writeRecord(record);
          }
        }
      }
    }
    return raw;
  }
}
```

**Step 4: Run tests to verify they pass**

```bash
npx vitest run src/proxy/proxy.test.ts
```

Expected: all tests PASS.

**Step 5: Commit**

```bash
git add src/proxy/proxy.ts src/proxy/proxy.test.ts
git commit -m "feat: add recording proxy with tool call interception"
```

---

### Task 7: Replay Matcher and Override System

**Files:**
- Create: `src/replay/matcher.ts`
- Create: `src/replay/overrides.ts`
- Create: `src/replay/matcher.test.ts`
- Create: `src/replay/overrides.test.ts`

**Step 1: Write the failing tests for matcher**

Create `src/replay/matcher.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { SequenceMatcher } from './matcher.js';
import type { ToolCallRecord } from '../storage/types.js';

const makeRecord = (seq: number, tool: string): ToolCallRecord => ({
  seq,
  timestamp: '2026-03-12T10:00:00.000Z',
  type: 'tool_call',
  tool,
  input: { key: `input-${seq}` },
  output: { content: [{ type: 'text', text: `output-${seq}` }] },
  latency_ms: 10,
  is_error: false,
});

describe('SequenceMatcher', () => {
  it('returns records in sequence order', () => {
    const records = [makeRecord(1, 'a'), makeRecord(2, 'b'), makeRecord(3, 'c')];
    const matcher = new SequenceMatcher(records);

    expect(matcher.next()?.tool).toBe('a');
    expect(matcher.next()?.tool).toBe('b');
    expect(matcher.next()?.tool).toBe('c');
  });

  it('returns null when sequence is exhausted', () => {
    const matcher = new SequenceMatcher([makeRecord(1, 'a')]);
    matcher.next();
    expect(matcher.next()).toBeNull();
  });

  it('reports remaining count', () => {
    const matcher = new SequenceMatcher([makeRecord(1, 'a'), makeRecord(2, 'b')]);
    expect(matcher.remaining()).toBe(2);
    matcher.next();
    expect(matcher.remaining()).toBe(1);
  });

  it('peeks without advancing', () => {
    const matcher = new SequenceMatcher([makeRecord(1, 'a'), makeRecord(2, 'b')]);
    expect(matcher.peek()?.tool).toBe('a');
    expect(matcher.peek()?.tool).toBe('a');
    expect(matcher.remaining()).toBe(2);
  });

  it('resets to a specific position', () => {
    const records = [makeRecord(1, 'a'), makeRecord(2, 'b'), makeRecord(3, 'c')];
    const matcher = new SequenceMatcher(records);
    matcher.next();
    matcher.next();
    matcher.resetTo(0);
    expect(matcher.next()?.tool).toBe('a');
  });
});
```

**Step 2: Write the failing tests for overrides**

Create `src/replay/overrides.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { OverrideManager } from './overrides.js';
import type { ToolCallRecord } from '../storage/types.js';

describe('OverrideManager', () => {
  it('returns original record when no override exists', () => {
    const mgr = new OverrideManager([]);
    const record: ToolCallRecord = {
      seq: 1, timestamp: '', type: 'tool_call', tool: 'a',
      input: { k: 'v' }, output: { content: [] }, latency_ms: 10, is_error: false,
    };
    const result = mgr.apply(record);
    expect(result.output).toEqual({ content: [] });
  });

  it('overrides output for matching sequence', () => {
    const mgr = new OverrideManager([
      { seq: 2, output: { content: [{ type: 'text', text: 'overridden' }] } },
    ]);
    const record: ToolCallRecord = {
      seq: 2, timestamp: '', type: 'tool_call', tool: 'a',
      input: { k: 'v' }, output: { content: [] }, latency_ms: 10, is_error: false,
    };
    const result = mgr.apply(record);
    expect(result.output).toEqual({ content: [{ type: 'text', text: 'overridden' }] });
  });

  it('overrides input for matching sequence', () => {
    const mgr = new OverrideManager([
      { seq: 1, input: { key: 'new-value' } },
    ]);
    const record: ToolCallRecord = {
      seq: 1, timestamp: '', type: 'tool_call', tool: 'a',
      input: { key: 'old' }, output: {}, latency_ms: 10, is_error: false,
    };
    const result = mgr.apply(record);
    expect(result.input).toEqual({ key: 'new-value' });
  });

  it('can override both input and output', () => {
    const mgr = new OverrideManager([
      { seq: 1, input: { q: 'new' }, output: { content: [{ type: 'text', text: 'new' }] } },
    ]);
    const record: ToolCallRecord = {
      seq: 1, timestamp: '', type: 'tool_call', tool: 'a',
      input: { q: 'old' }, output: { content: [] }, latency_ms: 10, is_error: false,
    };
    const result = mgr.apply(record);
    expect(result.input).toEqual({ q: 'new' });
    expect(result.output).toEqual({ content: [{ type: 'text', text: 'new' }] });
  });
});
```

**Step 3: Run tests to verify they fail**

```bash
npx vitest run src/replay/
```

Expected: FAIL.

**Step 4: Implement SequenceMatcher**

Create `src/replay/matcher.ts`:

```typescript
import type { ToolCallRecord } from '../storage/types.js';

export class SequenceMatcher {
  private position = 0;

  constructor(private records: ToolCallRecord[]) {}

  next(): ToolCallRecord | null {
    if (this.position >= this.records.length) return null;
    return this.records[this.position++];
  }

  peek(): ToolCallRecord | null {
    if (this.position >= this.records.length) return null;
    return this.records[this.position];
  }

  remaining(): number {
    return this.records.length - this.position;
  }

  resetTo(position: number): void {
    this.position = Math.max(0, Math.min(position, this.records.length));
  }

  currentPosition(): number {
    return this.position;
  }

  total(): number {
    return this.records.length;
  }
}
```

**Step 5: Implement OverrideManager**

Create `src/replay/overrides.ts`:

```typescript
import type { ToolCallRecord } from '../storage/types.js';

export interface Override {
  seq: number;
  input?: Record<string, unknown>;
  output?: unknown;
}

export class OverrideManager {
  private overrideMap: Map<number, Override>;

  constructor(overrides: Override[]) {
    this.overrideMap = new Map(overrides.map(o => [o.seq, o]));
  }

  apply(record: ToolCallRecord): ToolCallRecord {
    const override = this.overrideMap.get(record.seq);
    if (!override) return record;

    return {
      ...record,
      ...(override.input !== undefined ? { input: override.input } : {}),
      ...(override.output !== undefined ? { output: override.output } : {}),
    };
  }

  has(seq: number): boolean {
    return this.overrideMap.has(seq);
  }
}

export interface OverrideFile {
  overrides: Override[];
}

export function loadOverrides(raw: string): Override[] {
  const parsed: OverrideFile = JSON.parse(raw);
  return parsed.overrides ?? [];
}
```

**Step 6: Run tests to verify they pass**

```bash
npx vitest run src/replay/
```

Expected: all tests PASS.

**Step 7: Commit**

```bash
git add src/replay/
git commit -m "feat: add sequence matcher and override system for replay"
```

---

### Task 8: Replay Server

**Files:**
- Create: `src/replay/replay-server.ts`
- Create: `src/replay/replay-server.test.ts`

The replay server is an MCP server that serves recorded tool list and responses.

**Step 1: Write the failing tests**

Create `src/replay/replay-server.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { ReplayHandler } from './replay-server.js';
import type { ToolCallRecord, ToolsListRecord, RecordEntry } from '../storage/types.js';

const toolsList: ToolsListRecord = {
  timestamp: '2026-03-12T10:00:00.000Z',
  type: 'tools_list',
  tools: [
    { name: 'read_file', description: 'Read a file', inputSchema: { type: 'object', properties: { path: { type: 'string' } } } },
    { name: 'write_file', description: 'Write a file' },
  ],
};

const toolCalls: ToolCallRecord[] = [
  {
    seq: 1, timestamp: '2026-03-12T10:00:01.000Z', type: 'tool_call',
    tool: 'read_file', input: { path: '/foo' },
    output: { content: [{ type: 'text', text: 'hello' }] },
    latency_ms: 42, is_error: false,
  },
  {
    seq: 2, timestamp: '2026-03-12T10:00:02.000Z', type: 'tool_call',
    tool: 'write_file', input: { path: '/bar', content: 'world' },
    output: { content: [{ type: 'text', text: 'ok' }] },
    latency_ms: 15, is_error: false,
  },
];

describe('ReplayHandler', () => {
  let handler: ReplayHandler;

  beforeEach(() => {
    const records: RecordEntry[] = [toolsList, ...toolCalls];
    handler = new ReplayHandler(records, []);
  });

  it('returns the recorded tool list', () => {
    const tools = handler.getTools();
    expect(tools).toHaveLength(2);
    expect(tools[0].name).toBe('read_file');
    expect(tools[1].name).toBe('write_file');
  });

  it('returns recorded output for sequential tool calls', () => {
    const result1 = handler.handleToolCall('read_file', { path: '/foo' });
    expect(result1).toEqual({ content: [{ type: 'text', text: 'hello' }] });

    const result2 = handler.handleToolCall('write_file', { path: '/bar', content: 'world' });
    expect(result2).toEqual({ content: [{ type: 'text', text: 'ok' }] });
  });

  it('returns recorded output even if tool name differs (sequence-based)', () => {
    const result = handler.handleToolCall('different_tool', {});
    expect(result).toEqual({ content: [{ type: 'text', text: 'hello' }] });
  });

  it('returns an error when sequence is exhausted', () => {
    handler.handleToolCall('a', {});
    handler.handleToolCall('b', {});
    const result = handler.handleToolCall('c', {});
    expect(result).toHaveProperty('content');
    // Should return an error indicating no more recorded calls
  });

  it('applies overrides to output', () => {
    const records: RecordEntry[] = [toolsList, ...toolCalls];
    const overriddenHandler = new ReplayHandler(records, [
      { seq: 1, output: { content: [{ type: 'text', text: 'overridden!' }] } },
    ]);

    const result = overriddenHandler.handleToolCall('read_file', { path: '/foo' });
    expect(result).toEqual({ content: [{ type: 'text', text: 'overridden!' }] });
  });
});
```

**Step 2: Run tests to verify they fail**

```bash
npx vitest run src/replay/replay-server.test.ts
```

Expected: FAIL.

**Step 3: Implement ReplayHandler**

Create `src/replay/replay-server.ts`:

```typescript
import { SequenceMatcher } from './matcher.js';
import { OverrideManager } from './overrides.js';
import type { Override } from './overrides.js';
import type { RecordEntry, ToolCallRecord, ToolsListRecord } from '../storage/types.js';

interface ToolDefinition {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
}

export class ReplayHandler {
  private matcher: SequenceMatcher;
  private overrides: OverrideManager;
  private toolsListRecord: ToolsListRecord | null;

  constructor(records: RecordEntry[], overrides: Override[]) {
    const toolCalls = records.filter((r): r is ToolCallRecord => r.type === 'tool_call');
    this.matcher = new SequenceMatcher(toolCalls);
    this.overrides = new OverrideManager(overrides);
    this.toolsListRecord = records.find((r): r is ToolsListRecord => r.type === 'tools_list') ?? null;
  }

  getTools(): ToolDefinition[] {
    if (!this.toolsListRecord) return [];
    return this.toolsListRecord.tools;
  }

  handleToolCall(toolName: string, args: Record<string, unknown>): unknown {
    const record = this.matcher.next();
    if (!record) {
      return {
        content: [{ type: 'text', text: `[mcp-replay] No more recorded tool calls (sequence exhausted)` }],
        isError: true,
      };
    }

    if (record.tool !== toolName) {
      process.stderr.write(
        `[mcp-replay] Warning: expected tool "${record.tool}" at seq ${record.seq}, got "${toolName}"\n`
      );
    }

    const applied = this.overrides.apply(record);
    return applied.output;
  }
}
```

**Step 4: Run tests to verify they pass**

```bash
npx vitest run src/replay/replay-server.test.ts
```

Expected: all tests PASS.

**Step 5: Commit**

```bash
git add src/replay/replay-server.ts src/replay/replay-server.test.ts
git commit -m "feat: add replay handler serving recorded MCP responses"
```

---

### Task 9: Record Command

**Files:**
- Create: `src/commands/record.ts`
- Modify: `src/cli.ts`

This wires up the recording proxy as an actual stdio MCP proxy. It spawns the real server, pipes messages through the RecordingProxy, and writes to the session.

**Step 1: Implement the record command**

Create `src/commands/record.ts`:

```typescript
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
```

**Step 2: Wire up the CLI**

Update `src/cli.ts`:

```typescript
#!/usr/bin/env node
import { Command } from 'commander';
import { recordCommand } from './commands/record.js';
import path from 'node:path';
import os from 'node:os';

const program = new Command();

program
  .name('mcp-replay')
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

program.parse();
```

**Step 3: Build and verify**

```bash
npx tsc
node dist/cli.js record --help
```

Expected: prints record command help text.

**Step 4: Commit**

```bash
git add src/commands/record.ts src/cli.ts
git commit -m "feat: add record command with stdio proxy"
```

---

### Task 10: Replay Command

**Files:**
- Create: `src/commands/replay.ts`
- Modify: `src/cli.ts`

The replay command starts an MCP server on stdio that serves recorded responses.

**Step 1: Implement the replay command**

Create `src/commands/replay.ts`:

```typescript
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
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
    // Build a minimal zod schema from the recorded inputSchema
    // For replay, we accept any arguments
    server.registerTool(
      tool.name,
      {
        description: tool.description ?? `[replayed] ${tool.name}`,
      },
      async (args) => {
        if (speed > 0) {
          const record = records.find(r => r.type === 'tool_call') as { latency_ms: number } | undefined;
          if (record) {
            await new Promise(resolve => setTimeout(resolve, record.latency_ms * speed));
          }
        }
        const result = handler.handleToolCall(tool.name, args as Record<string, unknown>);
        return result as { content: Array<{ type: 'text'; text: string }> };
      },
    );
  }

  const transport = new StdioServerTransport();
  await server.connect(transport);
}
```

**Step 2: Wire up the CLI**

Add to `src/cli.ts` after the record command:

```typescript
import { replayCommand } from './commands/replay.js';

// ...after the record command registration:

program
  .command('replay <session-id>')
  .description('Replay a recorded MCP session')
  .option('--dir <dir>', 'Sessions directory', '.mcp-replay')
  .option('--speed <factor>', 'Replay speed: 0=instant, 1=real-time', '0')
  .option('--override <file>', 'JSON file with input/output overrides')
  .action(replayCommand);
```

**Step 3: Build and verify**

```bash
npx tsc
node dist/cli.js replay --help
```

Expected: prints replay command help text.

**Step 4: Commit**

```bash
git add src/commands/replay.ts src/cli.ts
git commit -m "feat: add replay command serving recorded MCP responses"
```

---

### Task 11: List Command

**Files:**
- Create: `src/commands/list.ts`
- Modify: `src/cli.ts`

**Step 1: Implement the list command**

Create `src/commands/list.ts`:

```typescript
import chalk from 'chalk';
import { listSessions } from '../storage/session.js';

interface ListOptions {
  dir: string;
}

export async function listCommand(options: ListOptions): Promise<void> {
  const sessions = await listSessions(options.dir);

  if (sessions.length === 0) {
    console.log('No recorded sessions found.');
    return;
  }

  // Header
  console.log(
    chalk.bold(
      padRight('SESSION ID', 30) +
      padRight('SERVER', 20) +
      padRight('CALLS', 8) +
      padRight('TOOLS', 30) +
      'DATE'
    )
  );
  console.log(chalk.dim('─'.repeat(100)));

  // Rows
  for (const session of sessions) {
    const date = session.startTime
      ? new Date(session.startTime).toLocaleString()
      : 'unknown';
    console.log(
      padRight(session.id, 30) +
      padRight(session.serverName, 20) +
      padRight(String(session.toolCount), 8) +
      padRight(session.tools.join(', ').slice(0, 28), 30) +
      date
    );
  }
}

function padRight(str: string, len: number): string {
  return str.length >= len ? str.slice(0, len - 1) + ' ' : str + ' '.repeat(len - str.length);
}
```

**Step 2: Wire up the CLI**

Add to `src/cli.ts`:

```typescript
import { listCommand } from './commands/list.js';

// ...after the replay command:

program
  .command('list')
  .description('List recorded sessions')
  .option('--dir <dir>', 'Sessions directory', '.mcp-replay')
  .action(listCommand);
```

**Step 3: Build and verify**

```bash
npx tsc
node dist/cli.js list --help
```

Expected: prints list command help text.

**Step 4: Commit**

```bash
git add src/commands/list.ts src/cli.ts
git commit -m "feat: add list command to display recorded sessions"
```

---

### Task 12: Debug Command

**Files:**
- Create: `src/debug/debugger.ts`
- Create: `src/commands/debug.ts`
- Modify: `src/cli.ts`

**Step 1: Implement the interactive debugger**

Create `src/debug/debugger.ts`:

```typescript
import chalk from 'chalk';
import readline from 'node:readline';
import type { ToolCallRecord, RecordEntry } from '../storage/types.js';

export class InteractiveDebugger {
  private toolCalls: ToolCallRecord[];
  private position: number;
  private rl: readline.Interface;

  constructor(records: RecordEntry[], startStep: number) {
    this.toolCalls = records.filter((r): r is ToolCallRecord => r.type === 'tool_call');
    this.position = Math.max(0, startStep - 1); // convert 1-based to 0-based
    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
  }

  async run(): Promise<void> {
    console.log(chalk.bold(`\nmcp-replay debugger`));
    console.log(chalk.dim(`${this.toolCalls.length} tool calls recorded\n`));
    this.showHelp();

    if (this.toolCalls.length > 0) {
      this.showCurrentCall();
    }

    await this.promptLoop();
  }

  private showCurrentCall(): void {
    if (this.position >= this.toolCalls.length) {
      console.log(chalk.yellow('\n  End of recording reached.\n'));
      return;
    }

    const call = this.toolCalls[this.position];
    console.log(chalk.bold.cyan(`\n  [${call.seq}/${this.toolCalls.length}] ${call.tool}`));
    console.log(chalk.dim(`  Timestamp: ${call.timestamp}`));
    console.log(chalk.dim(`  Latency:   ${call.latency_ms}ms`));
    if (call.is_error) console.log(chalk.red(`  ERROR`));
    console.log(chalk.green(`  Input:`));
    console.log(indent(JSON.stringify(call.input, null, 2)));
    console.log(chalk.yellow(`  Output:`));
    console.log(indent(JSON.stringify(call.output, null, 2)));
    console.log();
  }

  private showHelp(): void {
    console.log(chalk.dim('  Commands:'));
    console.log(chalk.dim('    n / next       → Next tool call'));
    console.log(chalk.dim('    p / prev       → Previous tool call'));
    console.log(chalk.dim('    l / list       → List all tool calls'));
    console.log(chalk.dim('    g <n>          → Go to step N'));
    console.log(chalk.dim('    m / modify     → Modify input (shows JSON, opens editor prompt)'));
    console.log(chalk.dim('    o / override   → Override output'));
    console.log(chalk.dim('    h / help       → Show this help'));
    console.log(chalk.dim('    q / quit       → Exit debugger'));
    console.log();
  }

  private async promptLoop(): Promise<void> {
    return new Promise<void>((resolve) => {
      const ask = () => {
        this.rl.question(chalk.bold('> '), async (input) => {
          const cmd = input.trim().toLowerCase();
          const parts = cmd.split(/\s+/);

          switch (parts[0]) {
            case 'n':
            case 'next':
              if (this.position < this.toolCalls.length - 1) {
                this.position++;
                this.showCurrentCall();
              } else {
                console.log(chalk.yellow('  Already at end of recording.'));
              }
              break;

            case 'p':
            case 'prev':
              if (this.position > 0) {
                this.position--;
                this.showCurrentCall();
              } else {
                console.log(chalk.yellow('  Already at start of recording.'));
              }
              break;

            case 'l':
            case 'list':
              this.listAll();
              break;

            case 'g':
            case 'goto':
              const n = parseInt(parts[1], 10);
              if (isNaN(n) || n < 1 || n > this.toolCalls.length) {
                console.log(chalk.red(`  Invalid step. Use 1-${this.toolCalls.length}`));
              } else {
                this.position = n - 1;
                this.showCurrentCall();
              }
              break;

            case 'm':
            case 'modify':
              await this.modifyInput();
              break;

            case 'o':
            case 'override':
              await this.overrideOutput();
              break;

            case 'h':
            case 'help':
              this.showHelp();
              break;

            case 'q':
            case 'quit':
              console.log(chalk.dim('  Exiting debugger.'));
              this.rl.close();
              resolve();
              return;

            default:
              console.log(chalk.red(`  Unknown command: ${cmd}. Type "h" for help.`));
          }
          ask();
        });
      };
      ask();
    });
  }

  private listAll(): void {
    console.log();
    for (let i = 0; i < this.toolCalls.length; i++) {
      const call = this.toolCalls[i];
      const marker = i === this.position ? chalk.cyan('→') : ' ';
      const error = call.is_error ? chalk.red(' ERROR') : '';
      console.log(
        `  ${marker} [${call.seq}] ${chalk.bold(call.tool)} ${chalk.dim(`${call.latency_ms}ms`)}${error}`
      );
    }
    console.log();
  }

  private async modifyInput(): Promise<void> {
    const call = this.toolCalls[this.position];
    console.log(chalk.dim('  Current input:'));
    console.log(indent(JSON.stringify(call.input, null, 2)));
    console.log(chalk.dim('  Enter new JSON input (single line):'));

    return new Promise<void>((resolve) => {
      this.rl.question(chalk.bold('  json> '), (line) => {
        try {
          const newInput = JSON.parse(line);
          this.toolCalls[this.position] = { ...call, input: newInput };
          console.log(chalk.green('  Input modified.'));
        } catch {
          console.log(chalk.red('  Invalid JSON. Input not modified.'));
        }
        resolve();
      });
    });
  }

  private async overrideOutput(): Promise<void> {
    const call = this.toolCalls[this.position];
    console.log(chalk.dim('  Current output:'));
    console.log(indent(JSON.stringify(call.output, null, 2)));
    console.log(chalk.dim('  Enter new JSON output (single line):'));

    return new Promise<void>((resolve) => {
      this.rl.question(chalk.bold('  json> '), (line) => {
        try {
          const newOutput = JSON.parse(line);
          this.toolCalls[this.position] = { ...call, output: newOutput };
          console.log(chalk.green('  Output overridden.'));
        } catch {
          console.log(chalk.red('  Invalid JSON. Output not modified.'));
        }
        resolve();
      });
    });
  }
}

function indent(text: string): string {
  return text.split('\n').map(line => '    ' + line).join('\n');
}
```

**Step 2: Implement the debug command**

Create `src/commands/debug.ts`:

```typescript
import { SessionReader } from '../storage/session.js';
import { InteractiveDebugger } from '../debug/debugger.js';

interface DebugOptions {
  dir: string;
  step: string;
}

export async function debugCommand(sessionId: string, options: DebugOptions): Promise<void> {
  const reader = new SessionReader(options.dir, sessionId);
  const metadata = await reader.getMetadata();
  const records = await reader.getRecords();
  const startStep = parseInt(options.step, 10);

  console.log(`Session: ${sessionId}`);
  console.log(`Server:  ${metadata.serverName}`);
  console.log(`Calls:   ${metadata.toolCount}`);

  const debugger_ = new InteractiveDebugger(records, startStep);
  await debugger_.run();
}
```

**Step 3: Wire up the CLI**

Add to `src/cli.ts`:

```typescript
import { debugCommand } from './commands/debug.js';

// ...after the list command:

program
  .command('debug <session-id>')
  .description('Interactive step-through debugger for a recorded session')
  .option('--dir <dir>', 'Sessions directory', '.mcp-replay')
  .option('--step <n>', 'Start at step N', '1')
  .action(debugCommand);
```

**Step 4: Build and verify**

```bash
npx tsc
node dist/cli.js debug --help
```

Expected: prints debug command help text.

**Step 5: Commit**

```bash
git add src/debug/ src/commands/debug.ts src/cli.ts
git commit -m "feat: add interactive debug command with step-through"
```

---

### Task 13: Integration Test — Record and Replay

**Files:**
- Create: `test/integration/record-replay.test.ts`
- Create: `test/fixtures/echo-server.ts` (a minimal MCP server for testing)

**Step 1: Create a test MCP server**

Create `test/fixtures/echo-server.ts`:

```typescript
#!/usr/bin/env node
/**
 * A minimal MCP server that echoes tool inputs back.
 * Used as a test fixture for integration tests.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

const server = new McpServer({ name: 'echo-server', version: '1.0.0' });

server.registerTool(
  'echo',
  { description: 'Echoes input back' },
  async (args) => ({
    content: [{ type: 'text' as const, text: JSON.stringify(args) }],
  }),
);

server.registerTool(
  'greet',
  { description: 'Returns a greeting' },
  async (args) => {
    const name = (args as Record<string, unknown>).name ?? 'world';
    return {
      content: [{ type: 'text' as const, text: `Hello, ${name}!` }],
    };
  },
);

const transport = new StdioServerTransport();
await server.connect(transport);
```

**Step 2: Write the integration test**

Create `test/integration/record-replay.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

describe('Record and Replay integration', () => {
  let tmpDir: string;
  let configPath: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-replay-integ-'));
    configPath = path.join(tmpDir, 'mcp.json');

    // Write config pointing to the echo server fixture
    fs.writeFileSync(configPath, JSON.stringify({
      mcpServers: {
        'echo': {
          command: 'npx',
          args: ['tsx', path.resolve('test/fixtures/echo-server.ts')],
        },
      },
    }));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true });
  });

  it('records tool calls through the proxy and replays them', async () => {
    const outputDir = path.join(tmpDir, '.mcp-replay');
    const sessionId = 'test-integ-1';

    // Step 1: Record — connect to mcp-replay in record mode
    const recordTransport = new StdioClientTransport({
      command: 'node',
      args: [
        path.resolve('dist/cli.js'),
        'record',
        '--server', 'echo',
        '--config', configPath,
        '--session', sessionId,
        '--output', outputDir,
      ],
    });

    const recordClient = new Client({ name: 'test-client', version: '1.0.0' });
    await recordClient.connect(recordTransport);

    // Call tools
    const tools = await recordClient.listTools();
    expect(tools.tools.length).toBeGreaterThanOrEqual(2);

    const echoResult = await recordClient.callTool({ name: 'echo', arguments: { msg: 'test' } });
    expect(echoResult.content).toBeTruthy();

    const greetResult = await recordClient.callTool({ name: 'greet', arguments: { name: 'Alice' } });
    expect(greetResult.content).toBeTruthy();

    await recordClient.close();

    // Verify recording files exist
    const sessionDir = path.join(outputDir, 'sessions', sessionId);
    expect(fs.existsSync(path.join(sessionDir, 'metadata.json'))).toBe(true);
    expect(fs.existsSync(path.join(sessionDir, 'recording.jsonl'))).toBe(true);

    const recording = fs.readFileSync(path.join(sessionDir, 'recording.jsonl'), 'utf-8');
    const lines = recording.trim().split('\n');
    expect(lines.length).toBeGreaterThanOrEqual(2);

    // Step 2: Replay — connect to mcp-replay in replay mode
    const replayTransport = new StdioClientTransport({
      command: 'node',
      args: [
        path.resolve('dist/cli.js'),
        'replay',
        sessionId,
        '--dir', outputDir,
      ],
    });

    const replayClient = new Client({ name: 'test-client', version: '1.0.0' });
    await replayClient.connect(replayTransport);

    // Tools should match recorded tools
    const replayTools = await replayClient.listTools();
    expect(replayTools.tools.length).toBe(tools.tools.length);

    // Tool call results should match recorded results
    const replayEcho = await replayClient.callTool({ name: 'echo', arguments: { msg: 'test' } });
    expect(replayEcho.content).toEqual(echoResult.content);

    const replayGreet = await replayClient.callTool({ name: 'greet', arguments: { name: 'Alice' } });
    expect(replayGreet.content).toEqual(greetResult.content);

    await replayClient.close();
  }, 30000);
});
```

**Step 3: Install tsx for running TypeScript fixtures**

```bash
npm install -D tsx
```

**Step 4: Build and run integration test**

```bash
npx tsc
npx vitest run test/integration/record-replay.test.ts
```

Expected: PASS — records tool calls through proxy and replays them identically.

**Step 5: Commit**

```bash
git add test/ package.json package-lock.json
git commit -m "test: add integration test for record and replay flow"
```

---

### Task 14: npm Publishing Setup

**Files:**
- Modify: `package.json` (files field, prepublishOnly)
- Create: `.npmignore`

**Step 1: Update package.json for publishing**

Add to `package.json`:

```json
{
  "files": [
    "dist",
    "README.md",
    "LICENSE"
  ]
}
```

**Step 2: Create .npmignore**

Create `.npmignore`:

```
src/
test/
*.test.ts
vitest.config.ts
tsconfig.json
.mcp-replay/
```

**Step 3: Add shebang handling**

The `dist/cli.js` needs a `#!/usr/bin/env node` shebang (already in src). Verify after build:

```bash
npx tsc
head -1 dist/cli.js
```

Expected: `#!/usr/bin/env node`

**Step 4: Test npx invocation locally**

```bash
npm link
npx mcp-replay --help
```

Expected: prints help text with all commands.

```bash
npm unlink mcp-replay
```

**Step 5: Commit**

```bash
git add package.json .npmignore
git commit -m "chore: configure npm publishing with files field"
```

---

### Task 15: Final Wiring — Complete CLI

**Files:**
- Modify: `src/cli.ts` (ensure all imports and commands are wired together)

**Step 1: Verify final cli.ts has all commands**

The final `src/cli.ts` should look like:

```typescript
#!/usr/bin/env node
import { Command } from 'commander';
import path from 'node:path';
import os from 'node:os';
import { recordCommand } from './commands/record.js';
import { replayCommand } from './commands/replay.js';
import { listCommand } from './commands/list.js';
import { debugCommand } from './commands/debug.js';

const program = new Command();

program
  .name('mcp-replay')
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

program.parse();
```

**Step 2: Build and run all tests**

```bash
npx tsc
npx vitest run
```

Expected: all unit and integration tests PASS.

**Step 3: Manual smoke test**

```bash
node dist/cli.js --help
node dist/cli.js record --help
node dist/cli.js replay --help
node dist/cli.js list --help
node dist/cli.js debug --help
```

Expected: all help texts display correctly with options.

**Step 4: Commit**

```bash
git add src/cli.ts
git commit -m "feat: wire all commands into CLI entry point"
```

---

## Summary

| Task | Component | Tests |
|------|-----------|-------|
| 1 | Project scaffolding | - |
| 2 | Types + Session storage | Unit |
| 3 | Config loader | Unit |
| 4 | Session ID generation | Unit |
| 5 | JSON-RPC interceptor | Unit |
| 6 | Recording proxy | Unit (mocked) |
| 7 | Matcher + Overrides | Unit |
| 8 | Replay handler | Unit |
| 9 | Record command | Build verify |
| 10 | Replay command | Build verify |
| 11 | List command | Build verify |
| 12 | Debug command | Build verify |
| 13 | Integration test | Integration |
| 14 | npm publishing setup | Manual |
| 15 | Final CLI wiring | All tests |
