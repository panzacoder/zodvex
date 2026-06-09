# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.7.4] - 2026-06-09

### Fixed

- **`.withContext()` empty-args type regression (#72 fallout).** With `args: {}` (or no `args`), `input`'s args parameter widened to `{ [x: string]: unknown }` instead of `Record<string, never>` — breaking **standalone** (shared) customizations whose `input` params were hand-annotated narrower than that wide index signature (`TS2345` at `zm.withContext` / `zim.withContext`). Empty/absent args now resolve to `Record<string, never>`. Surfaced in hotpot's shared secure-mutation wrappers; only triggers when `input`'s args param is explicitly annotated (inline customizations get contextual inference), which is why it slipped the test suite.

### Added

- **`defineContext(builder, customization)`** (`zodvex/server`) — author a reusable `.withContext()` customization with full type inference and zero hand-annotations. An identity at runtime; the `builder` argument pins the input ctx (so `input`'s `ctx`/`args` are inferred) and the output generics are inferred from your `input`'s return. The result carries no visibility, so **one** customization feeds both same-kind builders — `zm`+`zim`, `za`+`zia`, `zq`+`ziq`. This is the blessed way to share a customization across the public + internal builder of a kind. See `docs/guide/custom-context.md`.
- **`ZodvexCustomization<InputCtx, …>`** exported from `zodvex/server` — the raw structural shape of a `.withContext()` customization (parallel to convex-helpers' `Customization`). You supply every generic explicitly; it does no inference. For **authoring** a customization, use `defineContext` — `ZodvexCustomization` is only for the rare case of constraining a higher-order helper without a value. (There is intentionally no type-only "customization for builder B" alias: typing `input`'s `args` from declared args and propagating the output ctx both require inference from the value, which only a function can do — so `defineContext` is the single blessed path.)

## [0.7.3] - 2026-06-08

### Fixed

- **`za.withContext()` reliably narrows the action `ctx` to `ActionCtx`.** A side effect of the #72 retype: when a customization's `input` declares an `extra?` parameter, the action `ctx` previously collapsed to `Record<string, never>`, forcing an explicit `ActionCtx` annotation. It now infers cleanly — `ctx.auth` / `ctx.runQuery` / `ctx.scheduler` are accessible with no annotation. Guarded by the `examples/task-manager` action; verified against hotpot.
- **`.withContext()` customization args now go through the zod pipeline (#72).** A customization's declared `args` (e.g. a codec-typed `token`) were passed to Convex registration raw — no zod→Convex conversion — and handed to `input` **undecoded**; only per-function (consumer) args were handled. Now customization args are converted to Convex validators for registration and codec-**decoded** before `input` runs, symmetric with consumer args. The fix lives in the shared `customFnBuilder`, so it also covers direct `zCustomQuery` / `zCustomMutation` / `zCustomAction({ args: <zod>, input })`, not just `.withContext`. Pre-built Convex-validator customization args still pass through unchanged.

### Changed

- **`.withContext()` is now typed for zod args.** The customization's `args` are typed as a zod validator and `input` receives the **decoded runtime** values (`z.output`), matching the runtime behavior above. `CustomBuilder`'s custom-args slot became a resolved object type to express this. (#72)

## [0.7.2] - 2026-06-08

### Added

- **Codegen determinism guarantees** — `discoverModules` now sorts globbed files, and `generateApiFile` sorts every input collection (models, functions, codecs, model-embedded codecs, function-embedded codecs) by stable keys before emission. Regenerated output is byte-identical regardless of filesystem traversal order. Fixes cross-platform churn in `_zodvex/*.{js,d.ts}` (Hotpot MR 206).
- **Fingerprint ambiguity handling** — when multiple codecs share a structural fingerprint they are, by the fingerprint contract, behaviorally interchangeable, so codegen references one deterministically (prefers a same-source-file candidate, otherwise the stable-sorted-first) rather than gambling on insertion order. It never falls through to inline serialization, which silently drops the codec's transform. Fingerprints now fold in the decode/encode transform bodies as well as `.max()` / `.min()` / regex / format checks, so codecs that differ by constraint *or* transform are no longer conflated. A codec with no importable reference at all is a hard error (see Fixed).
- **Watch-mode regeneration** (`zodvex dev`) — the watcher now spawns a fresh `zodvex generate` subprocess on each change instead of regenerating in-process. A long-lived process can't reliably re-import edited modules: Bun caches ESM by resolved path and ignores the query-string cache-busting that works under Node, so in-process regen emitted stale output. A fresh process starts with an empty module cache on every runtime.
- **Codec provenance brands** — `zx.codec(wire, runtime, transforms, { brand })` attaches a stable, non-enumerable brand to a codec. Codegen matches a function-embedded codec to its importable twin by *declared* brand first (collision-free and namespaced across factories), then by structural fingerprint. Lets factory codecs (`tagged()`, `sensitive()`) whose every call returns a fresh instance resolve inline calls precisely instead of relying on fuzzy structural inference. Frontend-safe — the brand is discovery-time metadata and changes no generated imports. `examples/task-manager` brands its `tagged()` factory and demonstrates resolving an inline branded codec. See `docs/decisions/2026-06-08-codec-provenance-brands.md`.
- **`model.validator`** — every `defineZodModel(...)` result now exposes a `.validator` property that returns a parseable Zod schema typed exactly as the input the caller passed. For raw-shape input (`defineZodModel('events', { ... })`) it's `z.object(model.fields)`, built lazily and cached. For pre-built schema input (`defineZodModel('events', z.object({...}).refine(...))`) it's the exact schema you passed — refinements / checks / wrappers preserved. Drop-in suitable for TanStack Form's `validators.onChange` and other client-side validation. See #56.

### Changed

- **Examples updated** — `examples/task-manager` and `examples/task-manager-mini` now export shared `taggedEmail` / `taggedTag` codecs from `tagged.ts` and reference them across models + functions (instead of calling the `tagged()` factory inline at each site). Both also gain a `getTaskOrThrow(ctx: QueryCtx, id)` helper called from a mutation handler to demonstrate the `MutationCtx → QueryCtx` narrowing.
- **`ZodvexDatabaseWriter` now extends `ZodvexDatabaseReader`** — was previously a composition (`private reader: ZodvexDatabaseReader`) which tripped TypeScript's nominal-typing rule and blocked the native Convex idiom of typing read-only helpers as `ctx: QueryCtx` and calling them from mutations. Now a `ZodvexMutationCtx` is structurally assignable to `ZodvexQueryCtx` at the call site, no cast required. See #64.

### Fixed

- **`zodvex dev` regeneration ignored file edits under Bun.** The watcher fired and printed `Regenerating...`, but `_zodvex/api.js` was unchanged because Bun's loader returned the previously-cached module (query-string cache-busting is a Node-only trick Bun ignores — the per-run busting added in 0.7.2-beta.0 worked under Node/Vitest but not under real `bun run dev`). Now fixed by regenerating in a fresh subprocess. Reported by Heath; confirmed by the hotpot 0.7.2-beta smoke test.
- **Codec transforms silently dropped for fingerprint-ambiguous function args.** When a function's codec matched multiple equally-fingerprinted codecs (e.g. several `sensitive(...)` fields sharing a wire shape), codegen emitted the wire schema only — `z.string() /* codec: transforms lost */` — with no build or type error, breaking the client→server encode path at runtime. Codegen now references a fingerprint-equivalent codec instead (and hard-errors if none is importable). Surfaced by the hotpot 0.7.2-beta smoke test (`messages.send`).
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

[0.7.4]: https://github.com/panzacoder/zodvex/compare/v0.7.3...v0.7.4
[0.7.1]: https://github.com/panzacoder/zodvex/compare/v0.7.0...v0.7.1
[0.7.0]: https://github.com/panzacoder/zodvex/compare/v0.6.0...v0.7.0
[0.6.0]: https://github.com/panzacoder/zodvex/compare/v0.5.1...v0.6.0
[0.5.1]: https://github.com/panzacoder/zodvex/compare/v0.1.0...v0.5.1
[0.1.0]: https://github.com/panzacoder/zodvex/releases/tag/v0.1.0
