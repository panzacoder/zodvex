# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**zodvex is a codec-aware data layer for Convex, built on Zod v4.** It preserves Convex's exact optional/nullable validator semantics, and its defining capability is a codec-aware `ctx.db` — `Date`, typed IDs, and custom codecs encode/decode automatically at the database boundary, with row-level rules (`.withRules()`) and audit hooks (`.audit()`) on the same wrapped db. You configure it once with `initZodvex` and get correct builders back.

**What it is not:** a function-composition or middleware framework. There is no builder chain to assemble — the "middleware" is the ambient codec-aware db, wired once via `initZodvex`. Validator *mapping* (Zod → Convex) is the foundation it stands on (via `convex-helpers`), not the product.

See [`docs/positioning.md`](docs/positioning.md) for the canonical positioning statement — lead with this framing in any comparison or summary.

## Monorepo Structure

This is a bun workspaces monorepo:

- `packages/zodvex/` — the publishable library (source, tests, build config)
- `examples/task-manager/` — full example app using zodvex via `workspace:*`
- `examples/task-manager-mini/` — same app using `zod/mini` to verify mini compatibility
- `examples/quickstart/` — minimal getting-started example
- `examples/stress-test/` — performance/edge-case testing
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

### Validation

- `bun run validate` - **Full pre-release validation.** Runs lint → type-check → test → verify:consumer-declarations → build → verify:examples (local) → verify:examples:network (deploys task-manager + task-manager-mini + quickstart to their Convex dev instances and runs real HTTP smoke tests) → full stress-test ceiling search. Requires `CONVEX_DEPLOYMENT` configured in each example's `.env.local` (one-time `npx convex dev --configure` per example). Run locally before trialing a release in downstream projects — CI can't do the Convex deploy step.
- `bun run verify:examples` - Local-only subset (no network). Typechecks + runs vitest + regenerates codegen in both task-manager apps.
- `bun run verify:examples:network` - Deploys schemas to real Convex and runs smoke tests. Standalone script if you want the Convex portion without the whole pipeline.

### Releasing

**Beta releases** (manual, fast):
- `bin/release-beta` — auto-increments prerelease number, builds, tests, tags, pushes
- `bin/release-beta 0.7.0-beta.0` — explicit version
- Tag push triggers `.github/workflows/release.yml` → npm publish with `--tag beta`
- No GitHub Release created for betas

**Stable releases**: No automated stable release workflow yet. Stable releases are cut manually.

**PR titles** must follow conventional commit format (`feat:`, `fix:`, `chore:`, etc.) — enforced by `.github/workflows/pr-title.yml`

## Architecture

### Core Modules

The library is organized into focused modules in `packages/zodvex/src/`:

- **zod-core.ts** - Central re-export of `zod/v4/core` types and functions. All instanceof checks and type constraints use these core types so zodvex works with both `zod` and `zod/mini`.

- **model.ts** - `defineZodModel()` — the primary API for defining Convex table schemas with codec support. Client-safe.

- **init.ts** - `initZodvex()` — one-time project setup that returns pre-configured function builders (`zq`, `zm`, `za`) with codec-wrapped `ctx.db`.

- **mapping/** - Core Zod to Convex validator conversion logic (`mapping/core.ts`) with type-specific handlers in `mapping/handlers/`.

- **codec.ts** - `convexCodec` / `zodvexCodec` for encoding/decoding between Zod-shaped data and Convex-safe JSON.

- **wrappers.ts** - Function wrappers (`zQuery`, `zMutation`, `zAction` and their internal variants) that add Zod validation to Convex functions.

- **custom.ts** - Custom function builders (`zCustomQuery`, `zCustomMutation`, `zCustomAction`). Supports convex-helpers' `onSuccess` callback convention.

- **codegen/** - `zodvex generate` CLI. Runtime discovery (`discover.ts`), schema-to-source serialization (`zodToSource.ts`), and file generation (`generate.ts`).

- **tables.ts** - `zodTable` for defining Convex tables from Zod schemas (legacy — prefer `defineZodModel`).

- **types.ts** - TypeScript type definitions and utility types.

- **utils.ts** - Shared utility functions.

### Entrypoints

- `zodvex` — everything (re-exports core + server)
- `zodvex/core` — client-safe: validators, codecs, model definitions, registry
- `zodvex/mini` — same as core but with `zx` typed for `zod/mini` compatibility
- `zodvex/server` — server-only: `initZodvex`, function builders, DB wrappers
- `zodvex/react` — React hooks (`useZodQuery`, `useZodMutation`)
- `zodvex/client` — vanilla JS client
- `zodvex/codegen` — CLI and generation utilities

### Key Design Principles

1. **Semantic Preservation**: The library carefully preserves the distinction between optional and nullable fields:
   - `.optional()` → `v.optional(T)`
   - `.nullable()` → `v.union(T, v.null())`
   - Both → `v.optional(v.union(T, v.null()))`

2. **Convex Integration**: Built on top of `convex-helpers/server/zodV4` and post-processes validators to maintain Convex's optional/null semantics.

3. **Type Safety**: Provides full TypeScript type inference from Zod schemas through to Convex validators and function arguments.

4. **zod/mini Compatibility**: All type constraints and instanceof checks use `$ZodType` and subclasses from `zod/v4/core`, following [Zod's library author guidance](https://zod.dev/library-authors). This ensures zodvex works with both full `zod` and `zod/mini`. Schema construction still uses `z.*()` from full zod internally.

## Testing Approach

Tests are located in `packages/zodvex/__tests__/` and use vitest. Run a specific test file:

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
- **Testing**: vitest
- **TypeScript**: v5.x with strict mode
