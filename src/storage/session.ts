import { mkdir, readFile, writeFile, appendFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import type {
  McpServerConfig,
  HttpServerConfig,
  SessionMetadata,
  RecordEntry,
  ToolCallRecord,
} from './types.js';

export interface SessionWriterOptions {
  baseDir: string;
  sessionId: string;
  serverName: string;
  serverConfig: McpServerConfig | HttpServerConfig;
  transport?: 'stdio' | 'http';
}

export class SessionWriter {
  private readonly sessionDir: string;
  private readonly metadataPath: string;
  private readonly recordingPath: string;
  private readonly serverName: string;
  private readonly serverConfig: McpServerConfig | HttpServerConfig;
  private readonly sessionId: string;
  private readonly transport: 'stdio' | 'http';
  private metadata!: SessionMetadata;
  private toolCallCount: number = 0;
  private toolNames: Set<string> = new Set();

  constructor(options: SessionWriterOptions) {
    this.sessionId = options.sessionId;
    this.serverName = options.serverName;
    this.serverConfig = options.serverConfig;
    this.transport = options.transport ?? 'stdio';
    this.sessionDir = join(options.baseDir, options.sessionId);
    this.metadataPath = join(this.sessionDir, 'metadata.json');
    this.recordingPath = join(this.sessionDir, 'recording.jsonl');
  }

  async initialize(): Promise<void> {
    await mkdir(this.sessionDir, { recursive: true });

    this.metadata = {
      id: this.sessionId,
      serverName: this.serverName,
      serverConfig: this.serverConfig,
      startTime: new Date().toISOString(),
      endTime: '',
      toolCount: 0,
      tools: [],
      transport: this.transport,
    };

    await writeFile(this.metadataPath, JSON.stringify(this.metadata, null, 2), 'utf-8');
  }

  async writeRecord(record: RecordEntry): Promise<void> {
    const line = JSON.stringify(record) + '\n';
    await appendFile(this.recordingPath, line, 'utf-8');

    if (record.type === 'tool_call') {
      this.toolCallCount++;
      this.toolNames.add(record.tool);
      this.metadata.toolCount = this.toolCallCount;
      this.metadata.tools = Array.from(this.toolNames);
      await writeFile(this.metadataPath, JSON.stringify(this.metadata, null, 2), 'utf-8');
    }
  }

  async finalize(): Promise<void> {
    this.metadata.endTime = new Date().toISOString();
    this.metadata.toolCount = this.toolCallCount;
    this.metadata.tools = Array.from(this.toolNames);

    await writeFile(this.metadataPath, JSON.stringify(this.metadata, null, 2), 'utf-8');
  }
}

export class SessionReader {
  private readonly sessionDir: string;
  private readonly metadataPath: string;
  private readonly recordingPath: string;

  constructor(baseDir: string, sessionId: string) {
    this.sessionDir = join(baseDir, sessionId);
    this.metadataPath = join(this.sessionDir, 'metadata.json');
    this.recordingPath = join(this.sessionDir, 'recording.jsonl');
  }

  async getMetadata(): Promise<SessionMetadata> {
    const raw = await readFile(this.metadataPath, 'utf-8');
    return JSON.parse(raw) as SessionMetadata;
  }

  async getRecords(): Promise<RecordEntry[]> {
    const raw = await readFile(this.recordingPath, 'utf-8');
    const lines = raw.trim().split('\n').filter((line) => line.length > 0);
    return lines.map((line) => JSON.parse(line) as RecordEntry);
  }

  async getToolCalls(): Promise<ToolCallRecord[]> {
    const records = await this.getRecords();
    return records.filter((r): r is ToolCallRecord => r.type === 'tool_call');
  }
}

export async function listSessions(baseDir: string): Promise<SessionMetadata[]> {
  let entries: string[];
  try {
    entries = await readdir(baseDir);
  } catch {
    return [];
  }

  const sessions: SessionMetadata[] = [];

  for (const entry of entries) {
    try {
      const metadataPath = join(baseDir, entry, 'metadata.json');
      const raw = await readFile(metadataPath, 'utf-8');
      sessions.push(JSON.parse(raw) as SessionMetadata);
    } catch {
      // Skip directories without valid metadata
    }
  }

  return sessions;
}
