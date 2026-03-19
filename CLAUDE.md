# Project: mcp-time-travel

CLI tool for recording, replaying, and debugging MCP tool call sessions.

## Changesets (required for releases)

Every commit that changes shipped package behavior **must** include a changeset file. Without one, no npm release will be created.

### How to add a changeset

Create a markdown file in `.changeset/` with this format:

```md
---
"mcp-time-travel": patch
---

Short description of the change
```

- Use `patch` for fixes and small behavior changes
- Use `minor` for backward-compatible features
- Use `major` for breaking changes
- Docs-only, workflow-only, and test-only changes do **not** need a changeset

### How releases work

1. A commit with a changeset lands on `main`
2. The Release workflow opens (or updates) a "Version Packages" PR
3. Merging that PR bumps the version, updates CHANGELOG.md, publishes to npm, and creates a GitHub Release

**Do not** manually edit `package.json` version, create git tags, or make GitHub Releases — the automation handles all of it.

## Build & Test

```bash
npm run check   # typecheck + lint
npm test        # vitest
```

## Key paths

- CLI entry: `src/cli.ts`
- Commands: `src/commands/`
- Tests: `test/` and co-located `*.test.ts` files
- Changeset config: `.changeset/config.json`
- CI/Release workflows: `.github/workflows/`
