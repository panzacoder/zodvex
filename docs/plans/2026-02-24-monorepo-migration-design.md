# Bun Workspaces Monorepo Migration Design

**Goal:** Fix infinite `node_modules` nesting (breaking Time Machine) by migrating from `file:../../` to bun workspaces with a `packages/` layout.

**Architecture:** Move zodvex library into `packages/zodvex/`. Root becomes a bare workspace root. Example uses `"zodvex": "workspace:*"`. Standard monorepo pattern.

## Problem

`examples/task-manager/package.json` depends on `"zodvex": "file:../../"`. Bun resolves this by copying/linking the entire repo root into `node_modules/zodvex/` — which includes `examples/task-manager/` — creating an infinite directory loop that exceeds macOS path limits and breaks Time Machine backups.

Bun's `workspace:*` protocol only resolves against workspace *members* (subdirectories matched by the `workspaces` glob), not the root package. So the library must move into a subdirectory.

## Solution

### Directory layout

```
zodvex/                           # git repo root = workspace root
├── package.json                  # workspace root (private, not published)
├── packages/
│   └── zodvex/                   # the publishable library
│       ├── package.json          # name: "zodvex", all exports/bin/deps
│       ├── src/
│       ├── __tests__/
│       ├── tsconfig.json
│       ├── tsup.config.ts
│       └── biome.json
├── examples/
│   └── task-manager/             # "zodvex": "workspace:*"
│       ├── package.json
│       └── convex/
└── docs/                         # repo-level docs (stays at root)
```

### What moves to packages/zodvex/

- `src/`
- `__tests__/`
- `tsconfig.json`
- `tsup.config.ts`
- `biome.json`
- `scratch/`
- Library's `package.json` (current root minus workspaces field)

### What stays at root

- `package.json` (rewritten as workspace root)
- `docs/`, `examples/`
- `.gitignore`, `CLAUDE.md`, `README.md`, `LICENSE`
- `.github/` (CI — paths updated)

### Root package.json (new)

```json
{
  "name": "zodvex-root",
  "private": true,
  "workspaces": ["packages/*", "examples/*"],
  "scripts": {
    "build": "bun run --cwd packages/zodvex build",
    "test": "bun run --cwd packages/zodvex test",
    "lint": "bun run --cwd packages/zodvex lint"
  }
}
```

### packages/zodvex/package.json

Current root package.json minus `workspaces` field. Name, exports, bin, peer deps all unchanged.

### Example package.json

```json
{
  "zodvex": "workspace:*"
}
```

### Git history

`git mv` preserves blame. Single restructure commit.

## Verification

1. `bun install` from root succeeds
2. `bun test` passes (621+ tests)
3. `bun run build` produces dist/ in packages/zodvex/
4. No infinite nesting in node_modules
5. `npm pack --dry-run` from packages/zodvex/ shows correct files
