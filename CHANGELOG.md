# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### TL;DR

What this release actually changes, in product terms (all numbers are
real-deploy, codec-wiring-on, from
`examples/stress-test/results/where-we-sit-2026-06-12.md`):

- **The full zodvex solution (codecs on) is bounded by MODEL count, on
  main and on this release alike: ~100–150 models full-zod, ~300 with
  zod/mini (consolidated shape).** This release does not move the
  full-zod codec-on ceiling — the all-models import graph binds either
  way. What it does: no regression vs main's documented shape, a 1.5–2×
  mini ceiling via the args-only scheduler registry, and a smaller
  userland surface (one import, one call via the pre-wired `initZodvex`
  in `_zodvex/server.ts`; `bun zodvex migrate` covers the source
  migration).
- **The capacity now exists for codecs to scale to pure-convex parity,
  but is not yet consumable.** With the schema isolate de-zodded
  (`defineSchema(tables)` over the codegen-emitted `_zodvex/tables.ts`)
  and no centralized model graph, zodvex's floor measures clean deploys
  at N=750 with the wall being Convex's own TooManyReads at N=800 —
  identical to pure-convex and helpers-zod3 measured the same day. The
  follow-up that lets the CODEC-ON shape reach this is per-endpoint
  model registration (each endpoint's isolate evaluates only the models
  it imports).

> **Scale caveat — consolidated `server.ts`.** The sweep ceilings above
> are measured with the harness function shape, which does not import
> `_zodvex/server.ts`. The consolidated `server.ts` statically imports
> EVERY model (required: the Q/M V8 sandbox forbids dynamic `import()`,
> so the runtime tableMap can't load lazily), and that model-import
> graph alone costs ~59 MB/endpoint at N=200 full-zod — a real deploy
> of the consolidated shape OOMs at N=200. It is the right DX for
> small/medium apps (tens of functions: huge headroom); large apps
> need a future per-endpoint registration design. See
> `examples/stress-test/results/server-ts-shape-findings-2026-06-12.md`.

> **Runtime path note.** An earlier draft used lazy dynamic-import
> thunks for the runtime tableMap and the registry. That deployed
> cleanly but crashed every Q/M call because Convex's Q/M V8 sandbox
> forbids dynamic `import()`
> (`examples/stress-test/results/dynamic-import-runtime-finding-2026-05-14.md`).
> The shipped shape: the tableMap is static; the registry is SPLIT —
> lazy full registry for actions (Node), static args-only
> `api.args.js` for the mutation scheduler path that 0.7.5 added
> (`schedulerRegistry` option). A static FULL registry is not an
> option: its returns/model-doc graph alone measured 57.4 MB/endpoint
> at N=200 (`results/archive/lazy-registry-2026-05-12.md`).

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
  The library awaits and caches the resolved registry for the action
  customization (runQuery/runMutation + scheduler), composed with 0.7.5's
  `createCodecCallOverrides`.
- **`initZodvex` accepts `schedulerRegistry: () => AnyRegistry`** — the
  V8-safe registry for the MUTATION scheduler-encoding path
  (`scheduler.runAfter`/`runAt` in `zm`/`zim`, added in 0.7.5). Mutations
  cannot dynamic-import, and the scheduler only consults `args` schemas,
  so codegen emits an args-only `_zodvex/api.args.js` (no `returns` —
  the heavy model-doc graph stays out of static bundles) and wires it
  here. When omitted, mutations fall back to `registry` (compatible with
  the sync `registry: () => zodvexRegistry` pattern); a dynamic-import
  backed `registry` thunk is never executed on the mutation path when
  `schedulerRegistry` is provided.
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

- **`_zodvex/api.lazy.{js,d.ts}`** — superseded. The registry is now a
  static import inside `_zodvex/server.ts` (required since 0.7.5:
  mutations consume it for scheduler codec-arg encoding in the Q/M V8
  sandbox, where dynamic `import()` is forbidden).
- **`_zodvex/tableMap.lazy.{js,d.ts}`** — superseded. The runtime
  tableMap is built from static model imports inside `_zodvex/server.ts`.
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
place. See
`examples/stress-test/results/sweep-static-tablemap-2026-05-14.md` for
the authoritative ceiling data — runtime-verified with a
`bunx convex run` smoke call per cell — plus methodology and
reproducibility notes. The earlier `sweep-2026-05-13.md` measured
deploy outcome only; the numbers happened to be the same, but it
didn't catch the dynamic-import runtime regression that the
2026-05-14 sweep is designed to.

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
