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
