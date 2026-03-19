# mcp-time-travel

## 0.3.3

### Patch Changes

- 1f72bbd: fix: correct default config path in README to show both .mcp.json and ~/.claude/mcp.json

## 0.3.2

### Patch Changes

- 3293738: Fix demo README to reference project-level .mcp.json instead of global ~/.claude/mcp.json

## 0.3.1

### Patch Changes

- 4ce8417: fix: persist metadata on every tool call so sessions survive SIGKILL

  - Metadata (toolCount, tools) is now written after each tool call, not only on finalize. This fixes sessions showing 0 calls when the process is killed without graceful shutdown (e.g. Claude Code disconnecting).
  - Rename default storage directory from `.mcp-replay/` to `.mcp-time-travel/`
  - Default config resolution now checks `.mcp.json` in cwd before falling back to `~/.claude/mcp.json`
