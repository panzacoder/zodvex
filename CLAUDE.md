# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

zodvex is a TypeScript library that provides Zod v4 → Convex validator mapping with correct optional and nullable semantics. It acts as a thin, practical glue around `convex-helpers` that preserves Convex's notion of optional fields while offering ergonomic wrappers and codecs for working with Zod schemas in Convex applications.

## Key Commands

### Development

- `bun run dev` - Run tsup in watch mode for continuous builds
- `bun run build` - Build the library with tsup
- `bun run type-check` - Type check with TypeScript (no emit)

### Testing

- `bun test` - Run tests with Bun's built-in test runner
- `bun run test:vitest` - Run tests with Vitest
- `bun run test:coverage` - Run tests with code coverage

### Code Quality

- `bun run lint` - Check code with Biome (linting and formatting)
- `bun run lint:fix` - Fix code issues with Biome
- `bun run format` - Format code with Biome

### Publishing

- `bun run prepublishOnly` - Runs build, test, and type-check before publishing

## Architecture

### Core Modules

The library is organized into focused modules in the `src/` directory:

- **mapping.ts** - Core Zod to Convex validator conversion logic. Handles the translation of Zod schemas to Convex validators with proper optional/nullable semantics.

- **codec.ts** - Provides the `convexCodec` abstraction for encoding/decoding between Zod-shaped data and Convex-safe JSON (handling Date conversions, undefined omission).

- **wrappers.ts** - Function wrappers (`zQuery`, `zMutation`, `zAction` and their internal variants) that add Zod validation to Convex functions.

- **custom.ts** - Custom function builders (`zCustomQuery`, `zCustomMutation`, `zCustomAction`) for more advanced use cases. Also provides `customCtxWithHooks` for defining customizations with hooks (side effects like `onSuccess`) and transforms (data modifications like `transforms.output` for wire-boundary transforms).

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

Tests are located in `__tests__/` directory and use Vitest. Run a specific test file:

```bash
pnpm vitest run __tests__/mapping.test.ts
pnpm vitest run __tests__/codec.test.ts
```

## Dependencies

This is a library package with peer dependencies on:

- `zod` (v4.x)
- `convex` (>= 1.27)
- `convex-helpers` (>= 0.1.101-alpha.1)

The library is built with tsup and can run on:

- Node.js 20+
- Bun 1.0+

## Tooling

- **Runtime/Package Manager**: Bun (replaces pnpm)
- **Linting/Formatting**: Biome (replaces ESLint + Prettier)
- **Building**: tsup (powered by esbuild)
- **Testing**: Bun test runner or Vitest
- **TypeScript**: v5.x with strict mode
