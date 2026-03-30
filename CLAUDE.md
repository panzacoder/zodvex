# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

zodvex is a TypeScript library that provides Zod v4 → Convex validator mapping with correct optional and nullable semantics. It acts as a thin, practical glue around `convex-helpers` that preserves Convex's notion of optional fields while offering ergonomic wrappers and codecs for working with Zod schemas in Convex applications.

## Monorepo Structure

This is a bun workspaces monorepo:

- `packages/zodvex/` — the publishable library (source, tests, build config)
- `examples/task-manager/` — example app using zodvex via `workspace:*`
- Root `package.json` — workspace root (private, not published)

All commands can be run from the repo root — they delegate to `packages/zodvex/`.

## Key Commands

### Development

- `bun run dev` - Run tsup in watch mode for continuous builds
- `bun run build` - Build the library with tsup
- `bun run type-check` - Type check with TypeScript (no emit)

### Testing

- `bun run test` - Run tests via vitest (NEVER use `bun test` — it invokes Bun's built-in runner which fails on vitest APIs)

### Code Quality

- `bun run lint` - Check code with Biome (linting and formatting)
- `bun run lint:fix` - Fix code issues with Biome
- `bun run format` - Format code with Biome

### Releasing

**Beta releases** (manual, fast):
- `bin/release-beta` — auto-increments prerelease number, builds, tests, tags, pushes
- `bin/release-beta 0.7.0-beta.0` — explicit version
- Tag push triggers `.github/workflows/release.yml` → npm publish with `--tag beta`
- No GitHub Release created for betas

**Stable releases** (automated via release-please):
- Conventional commits on `main` are accumulated by release-please into a persistent Release PR
- Merge the Release PR → `.github/workflows/release-please.yml` → npm publish with `--tag latest` + GitHub Release + CHANGELOG
- release-please config: `release-please-config.json`, manifest: `.release-please-manifest.json`

**PR titles** must follow conventional commit format (`feat:`, `fix:`, `chore:`, etc.) — enforced by `.github/workflows/pr-title.yml`

## Architecture

### Core Modules

The library is organized into focused modules in `packages/zodvex/src/`:

- **mapping.ts** - Core Zod to Convex validator conversion logic. Handles the translation of Zod schemas to Convex validators with proper optional/nullable semantics.

- **codec.ts** - Provides the `convexCodec` abstraction for encoding/decoding between Zod-shaped data and Convex-safe JSON (handling Date conversions, undefined omission).

- **wrappers.ts** - Function wrappers (`zQuery`, `zMutation`, `zAction` and their internal variants) that add Zod validation to Convex functions.

- **custom.ts** - Custom function builders (`zCustomQuery`, `zCustomMutation`, `zCustomAction`) for more advanced use cases. Supports convex-helpers' `onSuccess` callback convention.

- **tables.ts** - Table helpers including `zodTable` for defining Convex tables from Zod schemas.

- **types.ts** - TypeScript type definitions and utility types used throughout the library.

- **utils.ts** - Shared utility functions.

### Key Design Principles

1. **Semantic Preservation**: The library carefully preserves the distinction between optional and nullable fields:
   - `.optional()` → `v.optional(T)`
   - `.nullable()` → `v.union(T, v.null())`
   - Both → `v.optional(v.union(T, v.null()))`

2. **Convex Integration**: Built on top of `convex-helpers/server/zodV4` and post-processes validators to maintain Convex's optional/null semantics.

3. **Type Safety**: Provides full TypeScript type inference from Zod schemas through to Convex validators and function arguments.

## Testing Approach

Tests are located in `packages/zodvex/__tests__/` and use Bun's test runner. Run a specific test file:

```bash
bun run test -- packages/zodvex/__tests__/mapping.test.ts
bun run test -- packages/zodvex/__tests__/codec.test.ts
```

## Dependencies

This is a library package with peer dependencies on:

- `zod` (v4.x)
- `convex` (>= 1.27)
- `convex-helpers` (>= 0.1.101-alpha.1)

The library is built with tsup and can run on:

- Node.js 20+
- Bun 1.0+

## Convex Reference

See `docs/convex_rules.txt` for official Convex agent guidance (query patterns, schema design, function registration, etc.). This is the canonical reference for how Convex APIs should be used — always consult it before writing or reviewing Convex code.

## Tooling

- **Runtime/Package Manager**: Bun (replaces pnpm)
- **Linting/Formatting**: Biome (replaces ESLint + Prettier)
- **Building**: tsup (powered by esbuild)
- **Testing**: Bun test runner
- **TypeScript**: v5.x with strict mode
