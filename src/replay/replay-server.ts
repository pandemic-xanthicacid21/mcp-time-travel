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
        content: [{ type: 'text', text: `[mcp-time-travel] No more recorded tool calls (sequence exhausted)` }],
        isError: true,
      };
    }

    if (record.tool !== toolName) {
      process.stderr.write(
        `[mcp-time-travel] Warning: expected tool "${record.tool}" at seq ${record.seq}, got "${toolName}"\n`
      );
    }

    if (JSON.stringify(args) !== JSON.stringify(record.input)) {
      process.stderr.write(
        `[mcp-time-travel] Warning: input mismatch for "${record.tool}" at seq ${record.seq}\n`
      );
    }

    const applied = this.overrides.apply(record);
    return applied.output;
  }
}
