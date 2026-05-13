# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **`_zodvex/api.lazy.js`** — new codegen-emitted file exposing `zodvexRegistry` as a cached dynamic-import thunk `() => Promise<Registry>`. Server-side wiring should import from here so esbuild can hoist the registry's transitive schema graph into a chunk under `_deps/`, dramatically reducing per-entrypoint heap under Convex's new per-entrypoint bundle analysis. At N=200 models, per-endpoint heap drops from ~57 MB to ~3 MB for zodvex (20× reduction).
- **`zodvex migrate` registry rewrite** — `applyRegistryLazyRewrite` automatically converts the legacy pattern `import { zodvexRegistry } from './_zodvex/api'` + `registry: () => zodvexRegistry` to the new lazy form. Idempotent; safe on already-migrated and non-registry files.
- **`zodvex init`** now emits a `_zodvex/api.lazy.ts` stub alongside the `api.ts` and `client.ts` stubs.

### Changed

- **`initZodvex` registry option** now accepts `() => AnyRegistry | Promise<AnyRegistry>`. `createActionCustomization` awaits the thunk and caches the resolved registry. The legacy sync shape `registry: () => zodvexRegistry` continues to work; the recommended form is `registry: zodvexRegistry` (importing from `_zodvex/api.lazy.js`).
- **Docs**: `docs/guide/codegen.md` updates the registry-wiring section to recommend `api.lazy.js`.

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
