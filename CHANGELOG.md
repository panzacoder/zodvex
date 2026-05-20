# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **Codegen determinism guarantees** — `discoverModules` now sorts globbed files, and `generateApiFile` sorts every input collection (models, functions, codecs, model-embedded codecs, function-embedded codecs) by stable keys before emission. Regenerated output is byte-identical regardless of filesystem traversal order. Fixes cross-platform churn in `_zodvex/*.{js,d.ts}` (Hotpot MR 206).
- **Fingerprint ambiguity handling** — when multiple codecs share a structural fingerprint, codegen no longer silently picks one by insertion order. Instead it tracks all candidates and either chooses one with a matching source file or emits inline with a clear warning. Codec fingerprints are also tightened to include `.max()` / `.min()` / regex / format checks so `sensitive(z.string())` and `sensitive(z.string().max(100))` are no longer treated as interchangeable.
- **Watch-mode cache busting** (`zodvex dev`) — successive codegen runs in the same process now pick up file edits. Previously the ESM dynamic-import cache returned stale modules on each tick, making it look like the debounce fired without effect. Opt-in via the new `freshImports` option on `discoverModules`/`generate`; the `dev` command opts in automatically.

### Changed

- **Examples updated** — `examples/task-manager` and `examples/task-manager-mini` now export a shared `taggedEmail` / `taggedTag` codec from `tagged.ts` and reference it across models + functions, instead of calling the `tagged()` factory inline at each site. This demonstrates the recommended pattern for the fingerprint-ambiguity rule above and produces a cleaner generated registry.

### Fixed

- **`zodvex dev` regeneration ignored file edits.** Watcher fired and printed `Regenerating...`, but `_zodvex/api.js` was unchanged because the dynamic `import()` returned the previously-cached module. Cold-restarting the dev process picked up changes. Now fixed by per-run cache-busting in the watch path.
- **`zod-to-mini` codemod safety** (`zodvex/labs`, internal `packages/zod-to-mini`) — `transformWrappers` no longer rewrites every `.nullable()` / `.optional()` chain unconditionally. With a type checker available, it confirms the receiver is a Zod schema; without one (string-in `transformCode`) it falls back to the same `z.<ctor>` / `zx.<ctor>` heuristic the rest of the codemod uses (now generalized to strip leading parens and `as <Type>` casts so common idioms work). And the codemod now injects `import { z } from 'zod/mini'` automatically when any transform emits `z.*` and the source didn't already import `z` — closes the runtime `ReferenceError: z is not defined` crash reported in #65.

## [0.7.1] - 2026-05-19

Memory-focused release. Roughly **3.7×** more endpoints fit in Convex's 64 MB push-time isolate when combining the new slim-model option with `zod/mini` (stress-test ceiling: 135 → 500 endpoints).

### Added

- **`defineZodModel(name, fields, { schemaHelpers: false })`** — slim models. Object-slim carries zero pre-built schemas; union-slim retains only the user-supplied schema. All derived schemas come from cached `zx.*` helpers on demand. Headline of the ceiling gain.
- **`zx.base(model)`** — base (no system fields) schema helper. Replaces direct `__zodTableMap[name].base` access.
- **`zx.paginationOpts`** / **`zx.paginationResult(schema)`** — Convex pagination helpers. WeakMap-cached on the underlying schema, so they don't allocate per call site.
- Per-model `zx` caches (`zx.doc` / `zx.base` / `zx.update` / `zx.docArray`) keyed on stable identity (fields or user schema) and survive `.index()`-chain methods. Caches live on `globalThis` via `Symbol.for`, so every tsup-bundled copy of `zx.ts` in a process shares state — eliminates duplicate schemas across bundle boundaries.
- WeakMap memoization on the internal `zodToConvex` validator builder, keyed on Zod schema instance identity.
- **`examples/stress-test/`** — black-box harness for measuring real-Convex-deploy memory ceilings across flavors (`convex`, `convex-helpers/zod3`, `convex-helpers/zod4`, `zodvex`, `zodvex-mini`) and N values. Used to verify ceiling claims in this release.

### Changed

- **Lazy `__zodTableMap`** — shrunk from 6 fields (`doc/base/insert/update/docArray/paginatedDoc`) to 2 (`doc/insert`). Only what the DB wrapper reads at runtime. Codegen and user code derive the rest from `zx.*`. Reduces retained schema graph per table.
- **`.withRules()` / `.audit()`** — replaced the dynamic-import workaround in `db.ts` with a synchronous install pattern (`installRulesSubclasses`). No public API change; calls made as the first statement after import now resolve cleanly instead of intermittently throwing *"zodvex rules module not yet loaded"*. Fixes the race that previously forced consumers (e.g. Hotpot) into Proxy workarounds.

### Removed

- **BREAKING**: `ZodTableSchemas` (exported type) shrunk to `{ doc, insert }`. External code that read `__zodTableMap[name].{docArray, paginatedDoc, base, update}` must migrate to the matching `zx.*` helper — e.g. `zx.docArray(model)` instead of `__zodTableMap.foo.docArray`.
- **BREAKING**: Slim object models no longer expose `.schema` or `.doc` on the model itself. Use `zx.base(model)` / `zx.doc(model)`. Union-slim models keep `.schema` (unchanged). Non-slim models (the default) are unaffected.

### Stress-test ceiling gains (64 MB budget)

| Variant     | Pre-0.7.1 | 0.7.1   | Δ    |
|-------------|-----------|---------|------|
| zod         | 135       | **166** | +23% |
| zod + slim  | 110       | **219** | +99% |
| mini        | 316       | **372** | +18% |
| mini + slim | 263       | **500** | +90% |

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

[0.7.1]: https://github.com/panzacoder/zodvex/compare/v0.7.0...v0.7.1
[0.7.0]: https://github.com/panzacoder/zodvex/compare/v0.6.0...v0.7.0
[0.6.0]: https://github.com/panzacoder/zodvex/compare/v0.5.1...v0.6.0
[0.5.1]: https://github.com/panzacoder/zodvex/compare/v0.1.0...v0.5.1
[0.1.0]: https://github.com/panzacoder/zodvex/releases/tag/v0.1.0
