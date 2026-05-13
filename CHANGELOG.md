# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### TL;DR

zodvex apps now scale to the same endpoint count as plain Convex apps under
the new per-entrypoint deploy analyzer. Previously zodvex apps OOMed at
~155 endpoints (schema-eval) or ~400 endpoints (registry size). With the
fixes in this release, real Convex deploys pass cleanly at N=2000 — the
limit becomes Convex's own non-memory ceilings (function-file count,
TooManyReads at finish_push). No source migration is required for memory
relief beyond `bun zodvex migrate`. Userland surface is also smaller —
one import, one call.

### Added

- **Pure-Convex schema shape.** Userland `convex/schema.ts` now uses
  Convex's canonical `defineSchema(tables)` directly:
  ```ts
  import { defineSchema } from 'convex/server'
  import tables from './_zodvex/tables'
  export default defineSchema(tables)
  ```
  Codegen emits `_zodvex/tables.ts` containing pure-Convex
  `defineTable(...)` definitions plus a `DecodedDocs` type. Zero zod
  runtime in the schema-eval isolate.
- **Consolidated `_zodvex/server.ts`.** A single codegen-emitted file
  that exposes a pre-wired `initZodvex(server, options?)` closing over
  the project's schema, registry thunk, and tableMap thunk. Userland
  `functions.ts` becomes one import + one call:
  ```ts
  import { query, mutation, action, internalQuery, internalMutation, internalAction } from './_generated/server'
  import { initZodvex } from './_zodvex/server'
  export const { zq, zm, za, ziq, zim, zia } = initZodvex({
    query, mutation, action, internalQuery, internalMutation, internalAction,
  })
  ```
  Replaces the prior `api.lazy.{js,d.ts}` + `tableMap.lazy.{js,d.ts}` +
  `server.{js,d.ts}` files (four artifacts) with one TS file.
- **`_zodvex/convex.config.ts` marker.** A NOOP comment file emitted
  inside `_zodvex/` makes Convex's CLI walker skip the directory during
  entrypoint discovery (uses the documented nested-component
  convention). Removes the per-file 64 MB analysis isolate that was
  hitting the codegen-emitted `api.js` (~158 KB / ~600 inline zod
  schemas at N=200) once the schema-eval ceiling was cleared.
- **`defineZodvexSchema`** in `zodvex/server` for users who want the
  decoded-doc type token attached without writing it explicitly. Pure
  `defineSchema(tables)` is the recommended path; `defineZodvexSchema`
  is supported for callers using `InferFilterBuilder<typeof schema, T>`
  without an explicit `DecodedDocs` third type param.
- **`zodvex migrate` schema + initZodvex rewrites.** Two new transforms
  (`applySchemaRewrite`, `applyInitZodvexConsolidation`) automatically
  convert legacy `defineZodSchema({...models})` schema files and
  `initZodvex(schema, server, { registry, tableMap })` functions files
  to the new shape. Idempotent.

### Changed

- **`initZodvex` accepts a `tableMap?` option** (a thunk
  `() => ZodTableMap | Promise<ZodTableMap>`). `createZodvexCustomization`
  caches the resolved table map on first DB call.
  `schema.__zodTableMap` remains the legacy fallback.
- **`initZodvex` accepts `registry: () => AnyRegistry | Promise<AnyRegistry>`.**
  The library awaits and caches the resolved registry.
- **`Infer*` schema helpers** (`InferDataModel`, `InferTableInfo`,
  `InferDecodedDoc`, `InferFilterBuilder`) now accept any Convex
  `SchemaDefinition`, not just `defineZodSchema` results.
  `InferDecodedDoc` and `InferFilterBuilder` take an optional `DD`
  third type param so callers using pure `defineSchema(tables)` can
  pass `DecodedDocs` from `_zodvex/tables` explicitly for decoded-aware
  filter builders.
- **`defineZodModel`'s slim option exposes a slightly different shape**
  (covered by the `tableFromModel` function used at codegen time);
  hand-rolled models without `defineZodModel` are skipped with a
  warning in `_zodvex/tables.ts` generation.
- **`zodvex init`** writes the new `_zodvex/tables.ts` and
  `_zodvex/server.ts` stubs plus the `convex.config.ts` marker. The
  bootstrap `server.ts` is a no-op passthrough so first-run discovery
  resolves cleanly before the full content is emitted.
- **Convex CLI compatibility verified through 1.32.x.** No backend
  changes required; the marker file mechanism uses Convex's documented
  nested-component skip behavior.
- **Docs (`docs/guide/codegen.md`)** updated to reflect the new shape.

### Removed

- **`_zodvex/api.lazy.{js,d.ts}`** — superseded. The dynamic import
  for the registry now lives inside `_zodvex/server.ts`.
- **`_zodvex/tableMap.lazy.{js,d.ts}`** — superseded. The dynamic
  import for the runtime tableMap now lives inside `_zodvex/server.ts`.
- **`_zodvex/server.{js,d.ts}` pair** — replaced by single
  `_zodvex/server.ts`.

### Migration

Existing apps run:

```bash
bun zodvex migrate ./convex
bun zodvex generate
```

The migrate command rewrites `convex/schema.ts` and `convex/functions.ts`
to the new shape; generate emits the new codegen artifacts and cleans
up the deprecated files. Both commands are idempotent — safe to re-run.

### Memory ceiling (real Convex deploys, fresh-diff)

  Configuration                    Before          After
  ───────────────────────────────────────────────────────
  zodvex (default)                 OOM at N≈155    not OOM-bound
  zodvex + slim models             OOM at N≈350    not OOM-bound
  zodvex/mini                      OOM at N≈425    not OOM-bound
  zodvex/mini + slim               OOM at N≈700    not OOM-bound

After the fix, zodvex isn't OOM-bound at any tested N — the same
position pure-convex and convex-helpers+zod3 occupy. The wall that
remains for all memory-OK flavors is **TooManyReads at N≈800**, a
Convex backend transaction-level limit (`TRANSACTION_MAX_READ_SET_INTERVALS
= 4096`) hit when finish_push commits the schema+function-handle
diff in a single transaction. That's architectural to Convex, not
zodvex-specific.

For comparison: `convex-helpers + zod4` (same Convex adapter, same
schemas, but no equivalent optimization stack) still OOMs at N≈500.
zodvex now scales ~50% past that and matches the pure-convex
function-count headroom.

`bun zodvex migrate` updates legacy schema.ts + functions.ts files in
place. See `examples/stress-test/results/sweep-2026-05-13.md` for the
authoritative ceiling data, methodology, and reproducibility notes.

## [0.7.0] - 2026-04-02

### Added

- **zod/mini compatibility**: All exported type constraints and `instanceof` checks now use `$ZodType` and subclasses from `zod/v4/core`, following [Zod's library author guidance](https://zod.dev/library-authors). zodvex now works with both full `zod` and `zod/mini`.
- **`zodvex/mini` entrypoint**: Client-safe imports typed for `zod/mini` compatibility. Same API as `zodvex/core`, but `zx` helpers return `$ZodType` (no `.optional()` chaining — use `z.optional(zx.id(...))` instead).
- `zod-core.ts` internal module: Centralized re-export hub for `zod/v4/core` types and functions.
- `examples/task-manager-mini/`: Example app demonstrating `zod/mini` usage.

### Changed

- Type constraints widened from `z.ZodTypeAny` to `$ZodType` and `z.ZodRawShape` to `$ZodShape` across all public APIs. This is backwards-compatible — existing code using full `zod` types is unaffected.
- Internal `instanceof` checks migrated from `z.ZodObject` etc. to `$ZodObject` etc. from `zod/v4/core`.
- Internal property access migrated from `.shape`, `.options`, `.unwrap()` to `._zod.def.*` paths for core compatibility.
- Remediated ~80 `as any` casts introduced during the `zod/v4/core` migration, replacing them with typed `_zod.def` access after `instanceof` narrowing.

### Removed

- **BREAKING**: `zodvex/transform` subpath export removed. The transform/traverse utilities were superseded by the codec-in-schema pattern and had no production consumers. If you imported from `zodvex/transform`, use `zx.codec()` or Zod's native `z.codec()` instead.

## [0.6.0] - 2026-03-30

### Added

- `defineZodModel()` — primary API for defining Convex table schemas with full codec, index, search index, and vector index support. Replaces `zodTable()`.
- `initZodvex()` — one-time project setup returning pre-configured function builders (`zq`, `zm`, `za`, `ziq`, `zim`, `zia`) with codec-wrapped `ctx.db`.
- `zodvex/react` entrypoint with `useZodQuery` and `useZodMutation` hooks.
- `zodvex/client` entrypoint with `ZodvexClient` for vanilla JS usage.
- `zodvex generate` CLI for codegen (`zodvex/codegen`).
- DB wrapper layer: `ZodvexDatabaseReader` / `ZodvexDatabaseWriter` with automatic codec encode/decode.
- `.withRules()` on DB wrappers for RLS/FLS integration.
- `zodvexCodec()` / `zx.codec()` for creating branded codecs that preserve wire schema through type aliases.
- `ZodvexCodec<Wire, Runtime>` branded type for custom codec type safety.
- `decodeDoc()` / `encodeDoc()` / `encodePartialDoc()` primitives.

### Changed

- `zodTable()` deprecated in favor of `defineZodModel()`.
- Builder functions (`zQueryBuilder`, etc.) deprecated in favor of `initZodvex()`.

## [0.5.1] - 2026-02-09

### Added

- New `zodvex/core` entry point for client-safe imports
  - Contains: `zx`, `zodToConvex`, `zodToConvexFields`, codec utilities, registry, and more
  - No imports from `convex/server` or `convex-helpers/server`
  - Reduces client bundle size when used instead of root import
- New `zodvex/server` entry point for server-only utilities
  - Contains: `zodTable`, function builders, custom function utilities

### Changed

- Root `zodvex` import now re-exports from `zodvex/core` and `zodvex/server`
- No breaking changes — existing imports continue to work

## [0.1.0] - 2025-01-16

### Added

- Initial release of zodvex
- Core mapping functionality between Zod v4 and Convex validators
- Proper handling of optional vs nullable semantics
- Function wrappers for type-safe Convex functions (query, mutation, action)
- Codec system for encoding/decoding between Zod and Convex formats
- Table helper for defining Convex tables with Zod schemas
- Support for Date encoding/decoding
- Support for complex nested structures (arrays, objects, records)
- Integration with convex-helpers for ID handling

[0.7.0]: https://github.com/panzacoder/zodvex/compare/v0.6.0...v0.7.0
[0.6.0]: https://github.com/panzacoder/zodvex/compare/v0.5.1...v0.6.0
[0.5.1]: https://github.com/panzacoder/zodvex/compare/v0.1.0...v0.5.1
[0.1.0]: https://github.com/panzacoder/zodvex/releases/tag/v0.1.0
