# Time-travel debugging for MCP agents

If you're experimenting with MCP agents and find this useful,
a ⭐ helps others discover the project.

Agents are difficult to debug.

Common problems:

• a tool call fails but you can't reproduce it
• workflows depend on external APIs
• debugging requires rerunning the agent
• failures are nondeterministic

mcp-time-travel solves this by recording MCP sessions and replaying them deterministically.

mcp-time-travel is a transparent proxy that sits between an AI agent (Claude Code, Cursor, etc.) and a real MCP server. It captures every tool call with full input/output and timing metadata. Recorded sessions can be replayed deterministically or stepped through interactively for debugging.

## Features

• Transparent MCP proxy
• Deterministic replay of tool sessions
• Interactive step debugger
• Modify inputs/outputs during debugging
• Works offline
• No changes required to existing MCP servers

## Compatible with:

• Claude Code
• Cursor
• any MCP server using stdio

## Quick Start

### Record a session

```bash
npx mcp-time-travel record --server my-server --config ~/.claude/mcp.json
```

This proxies all traffic between the agent and the real MCP server, logging every tool call to disk.

### Replay a session

```bash
npx mcp-time-travel replay <session-id>
```

Serves recorded responses as a fully functional MCP server. No real server needed — works offline.

### Debug a session

```bash
npx mcp-time-travel debug <session-id>
```

Interactive step-through debugger. Inspect each tool call, modify inputs, override outputs.

### List sessions

```bash
npx mcp-time-travel list
```

## Configuration

### Recording with Claude Code

Point Claude Code at mcp-time-travel instead of the real server. In your `~/.claude/mcp.json`:

```json
{
  "mcpServers": {
    "my-server-recorded": {
      "command": "npx",
      "args": ["mcp-time-travel", "record", "--server", "my-server"]
    }
  }
}
```

The `--server` flag refers to another entry in the same config file — mcp-time-travel reads it to spawn the real server.

### Replaying with Claude Code

```json
{
  "mcpServers": {
    "my-server-replay": {
      "command": "npx",
      "args": ["mcp-time-travel", "replay", "SESSION_ID"]
    }
  }
}
```

## CLI Reference

### `record`

```
npx mcp-time-travel record --server <name> [options]

Options:
  --server <name>    Server name in the config file (required)
  --config <path>    Path to MCP config JSON (default: ~/.claude/mcp.json)
  --session <id>     Custom session ID (default: auto-generated)
  --output <dir>     Output directory (default: .mcp-replay/)
```

### `replay <session-id>`

```
npx mcp-time-travel replay <session-id> [options]

Options:
  --dir <dir>        Sessions directory (default: .mcp-replay/)
  --speed <factor>   0 = instant, 1 = real-time (default: 0)
  --override <file>  JSON file with input/output overrides
```

### `debug <session-id>`

```
npx mcp-time-travel debug <session-id> [options]

Options:
  --dir <dir>        Sessions directory (default: .mcp-replay/)
  --step <n>         Start at step N (default: 1)

Interactive commands:
  n / next       Next tool call
  p / prev       Previous tool call
  l / list       List all tool calls
  g <n>          Go to step N
  m / modify     Edit input JSON
  o / override   Override output JSON
  h / help       Show help
  q / quit       Exit
```

### `list`

```
npx mcp-time-travel list [options]

Options:
  --dir <dir>        Sessions directory (default: .mcp-replay/)
```

## Session Storage

Sessions are stored in `.mcp-replay/sessions/<session-id>/`:

```
.mcp-replay/
  sessions/
    <session-id>/
      metadata.json      # Session info, timestamps, tool list
      recording.jsonl     # Tool calls as newline-delimited JSON
```

### metadata.json

```json
{
  "id": "20260312-100000-abc",
  "serverName": "my-server",
  "serverConfig": { "command": "node", "args": ["server.js"] },
  "startTime": "2026-03-12T10:00:00.000Z",
  "endTime": "2026-03-12T10:05:00.000Z",
  "toolCount": 5,
  "tools": ["read_file", "write_file", "run_query"]
}
```

### recording.jsonl

Each line is a JSON object:

```json
{"seq": 1, "timestamp": "2026-03-12T10:00:01.000Z", "type": "tool_call", "tool": "read_file", "input": {"path": "/foo/bar.ts"}, "output": {"content": [{"type": "text", "text": "..."}]}, "latency_ms": 42, "is_error": false}
```

## Override System

Create a JSON file to override specific tool call responses during replay:

```json
{
  "overrides": [
    { "seq": 3, "output": { "content": [{ "type": "text", "text": "modified response" }] } },
    { "seq": 5, "input": { "query": "SELECT * FROM users LIMIT 1" } }
  ]
}
```

Use with `--override`:

```bash
npx mcp-time-travel replay SESSION_ID --override overrides.json
```

During replay, if an override exists for the current sequence number, it replaces the recorded data.

## How It Works

### Record Mode

```
Agent (Claude Code, Cursor, etc.)
  |  stdio (JSON-RPC)
  v
mcp-time-travel (proxy)
  |  ├── Intercepts tools/call messages
  |  ├── Logs to .mcp-replay/sessions/<id>/recording.jsonl
  |  └── Forwards everything to real server
  v
Real MCP Server (child process, stdio)
```

The proxy reads the real server config from Claude Code's `mcpServers` format, spawns the server as a child process, and pipes all JSON-RPC traffic through. Tool calls are captured with input, output, and latency. All other messages pass through unchanged.

### Replay Mode

```
Agent
  |  stdio (JSON-RPC)
  v
mcp-time-travel (replay server)
  |  ├── Reads recording.jsonl
  |  ├── tools/list → returns recorded tool list
  |  └── tools/call → returns recorded output (matched by sequence)
  |
  (no real server needed)
```

Full replacement for the real server. Tool calls are matched by sequence number — the Nth call returns the Nth recorded response. If the agent sends a different tool name than expected, a warning is logged but the recorded output is still returned to keep replay deterministic.

### Debug Mode

```
Terminal
  |
mcp-time-travel debug <session-id>
  |  ├── Reads recording.jsonl
  |  ├── Displays each call interactively
  |  └── Allows modify/skip/override
```

Not an MCP server — a standalone terminal UI for inspecting and modifying recorded sessions.

## License

MIT

Contributing

## Issues and PRs welcome.

If you use MCP agents and run into debugging problems, I'd love to hear how you use mcp-time-travel.
