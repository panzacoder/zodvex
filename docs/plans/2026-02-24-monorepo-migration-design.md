# Bun Workspaces Monorepo Migration Design

**Goal:** Fix infinite `node_modules` nesting (breaking Time Machine) by migrating from `file:../../` to bun workspaces.

**Architecture:** Add `"workspaces": ["examples/*"]` to root `package.json`. Change example's zodvex dependency to `"workspace:*"`. No directory restructuring, no new tooling.

## Problem

`examples/task-manager/package.json` depends on `"zodvex": "file:../../"`. Bun resolves this by copying/linking the entire repo root into `node_modules/zodvex/` — which includes `examples/task-manager/` — creating an infinite directory loop that exceeds macOS path limits and breaks Time Machine backups.

## Solution

### Root package.json

Add workspaces field:

```json
{
  "name": "zodvex",
  "workspaces": ["examples/*"],
  ...
}
```

### Example package.json

Change dependency:

```json
{
  "zodvex": "workspace:*"
}
```

### Install flow

1. Delete `examples/task-manager/node_modules/`
2. `bun install` from root — bun hoists shared deps, links zodvex via workspace graph
3. Infinite loop eliminated

## What stays the same

- Directory structure (no files move)
- Build process (`bun run build` at root)
- Tests (`bun test` at root)
- tsconfig (root already excludes `examples/**/*`)
- Publishing (`npm publish` from root — `"workspaces"` stripped, `"files"` limits contents)

## What changes

- Root `bun.lock` includes example dependencies (standard monorepo behavior)
- `bun install` must run from root to resolve workspace links
- Future examples just need a directory in `examples/` to be auto-discovered
