---
"mcp-time-travel": patch
---

fix: persist metadata on every tool call so sessions survive SIGKILL

- Metadata (toolCount, tools) is now written after each tool call, not only on finalize. This fixes sessions showing 0 calls when the process is killed without graceful shutdown (e.g. Claude Code disconnecting).
- Rename default storage directory from `.mcp-replay/` to `.mcp-time-travel/`
- Default config resolution now checks `.mcp.json` in cwd before falling back to `~/.claude/mcp.json`
