# Direct `.js` + `.d.ts` Code Generation

**Date:** 2026-03-05
**Status:** Approved

## Summary

Modify `zodvex generate` to emit `.js` + `.d.ts` file pairs instead of `.ts` files. No transpilation step, no new dependencies. Follows the same pattern Convex uses for `_generated/` output.

## Motivation

- Eliminates a transpilation step (no shelling out to `tsc`, no race conditions)
- Matches Convex's `_generated/` convention (`.js` + `.d.ts`)
- Single atomic codegen step — generate strings and write files

## Import Conventions

- All imports use `.js` extensions (ESM-correct)
- Consumer `.ts` source files referenced as `.js` — esbuild resolves `.js` → `.ts` at bundle time
- `import type` statements only appear in `.d.ts` files
- Bare specifiers (`zodvex/core`, `zod`) unchanged

## Per-File Strategy

### `api.js` + `api.d.ts`

**`.js`:** Model imports, `extractCodec()` calls, `zodvexRegistry` object literal. `as const` dropped (not valid JS).

**`.d.ts`:** Typed export for `zodvexRegistry` — either a full literal type or `typeof import('./api.js').zodvexRegistry`.

### `schema.js` + `schema.d.ts`

**`.js`:** Value re-exports: `export { FooModel } from '../models/foo.js'`

**`.d.ts`:** Mirrors the `.js` re-exports (TS resolves types from the `.js` targets).

### `server.js` + `server.d.ts`

**`.js`:** Empty or minimal — no runtime code exists in this file.

**`.d.ts`:** `QueryCtx`, `MutationCtx`, `ActionCtx` type aliases using `import type` for `DataModel`, schema, and zodvex server types.

### `client.js` + `client.d.ts`

**`.js`:** `createZodvexHooks(zodvexRegistry)`, `createClient`, `createReactClient`, `encodeArgs`/`decodeResult`, `mantineResolver` — all stripped of type annotations.

**`.d.ts`:** Typed function signatures referencing `FunctionReference`, `ZodvexClientOptions`, `ZodvexReactClientOptions`.

## Generator Changes

- Each `generate*File()` function returns `{ js: string, dts: string }` instead of `string`
- File-writing step writes `*.js` + `*.d.ts` pairs (no `.ts` files written)
- Stub creation (bootstrap) also emits `.js` + `.d.ts`
- Import paths in generated code: strip `.ts` extensions, add `.js`

## What Doesn't Change

- Discovery pipeline (runtime introspection, `__zodvexMeta`)
- `zodToSource()` serialization (already emits valid JS)
- Identity map / codec map resolution
- CLI interface (`zodvex generate`, `zodvex dev`)

## Prior Art

Convex's `_generated/` uses the same pattern: template functions generate `.js` and `.d.ts` strings directly, formatted with Prettier, written without any transpilation. Convex's `.js` files only import from npm packages (bare specifiers), while zodvex's `.js` files also import from consumer source files using `.js` extensions (resolved by esbuild at bundle time).
