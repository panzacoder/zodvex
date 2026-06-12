# Real Convex deploy verification — 2026-05-13

Validates the local per-endpoint bench against actual Convex backend behavior.
Each row below is a real `npx convex dev --once` against
`dev:tangible-jellyfish-256`. Status of `ok` means the push completed;
`oom` means the backend returned `maximum memory usage: 64 MB`. Pushes
take 3-18 s including bundle upload.

## Headline finding: two independent 64 MB ceilings

The new per-entrypoint backend imposes **two distinct memory budgets**,
not one:

1. **Schema evaluation** — `schema.ts` is loaded into a 64 MB isolate.
   It statically imports every model, so model count × per-model heap
   is the binding constraint here. No amount of lazy-loading inside
   endpoint files affects this.
2. **Module loading** — each function file is loaded into its own 64 MB
   isolate. Lazy patterns inside the entry (dynamic imports for
   registry, etc.) keep their targets out of the entry's heap because
   esbuild hoists them into separate chunks.

Our prior bench measured (2) only. The real-deploy data shows (1) hits
first for zodvex apps with many models.

## Real-deploy ceilings (zodvex flavor)

| Variant | OOM around | Site |
|---|---:|---|
| zodvex (full zod, default models, no registry) | **150–175** | schema-eval |
| zodvex + `{ schemaHelpers: false }` (slim models) | **300–400** | schema-eval |
| zodvex-mini | **400–450** | schema-eval |
| zodvex-mini + slim | **600–800** | schema-eval |
| zodvex + lazy registry + N=200 (no slim) | OOM at schema-eval | schema-eval |
| zodvex + slim + static registry + N=200 | **ok** (18.5 s) | — |
| zodvex + slim + lazy registry + N=200 | **ok** (5.9 s) | — |

Headroom multipliers, relative to plain-zodvex baseline:
- Slim models: **~2× endpoints**
- zod/mini: **~2.5× endpoints**
- Slim + mini compound: **~4× endpoints**

## The three optimizations and what they actually do

### 1. Slim models (`{ schemaHelpers: false }`, PR #57)

The biggest single lever. Cuts the per-model schema-eval footprint
roughly in half because models no longer carry attached `.doc`,
`.insert`, `.update`, `.docArray`, `.paginatedDoc` schemas at
construction time (those are constructed lazily via `zx.*` when
needed). Schema-eval ceiling moves from ~155 to ~350.

### 2. zod/mini (vs full zod)

Cuts the per-zod-instance own-property count from ~61 to ~15, which
shows up at schema-eval as a ~2.5× endpoint count headroom.
Independently composable with slim.

### 3. Lazy registry (`_zodvex/api.lazy.js`, this PR)

Solves a *different* OOM site than the above two. The registry is
imported by `convex/functions.ts` (or wherever `initZodvex` is called)
and is consumed at action invocation time. With the old
`import { zodvexRegistry } from './_zodvex/api'` static form, the
registry's transitive schemas are inlined into every endpoint's
bundle that imports `functions.ts`. With the lazy form, the registry
graph is hoisted into a separate chunk and never enters the
entrypoint's heap-on-load.

This matters **specifically** for the per-endpoint module-loading
budget — the second of the two ceilings. Without lazy, a real
codegen-emitted registry containing inline `z.object({...})` and
`z.union([...])` calls for every function will eventually push
per-endpoint heap past 64 MB even when schema-eval passes.

## Test methodology caveat

Our composed `registry.ts` imports model exports and pushes them onto
globalThis. It does NOT mirror real codegen, which builds *inline*
`args: z.object({...})` and `returns: ...` zod schemas per function
path. The real registry is significantly heavier per entry. So the
N=200 static-registry test passed under slim only because our
synthesized registry is optimistic — a real codegen registry at
N=200 would still OOM. The lazy registry win remains correct; it's
just larger in practice than my bench numbers suggested for the
registry mode specifically.

A follow-up test should use real codegen output (regenerate
task-manager at varying scales) instead of the synthesized form, to
measure the *real* registry cost.

## Recommendations for zodvex consumers

1. **Default to `{ schemaHelpers: false }`** when defining models at
   scale. The convenience properties (`.doc`, `.insert`, etc.) are
   reconstructable via `zx.doc(Model)` etc. on demand. We should
   consider flipping this default in the library if no consumer is
   actively relying on the eager form.
2. **Use the lazy registry import.** Codegen now emits
   `_zodvex/api.lazy.js`; new examples and migrated existing apps use
   it. `bun zodvex migrate` rewrites the legacy pattern.
3. **Consider zod/mini for very large schemas.** The codemod
   migration is a one-shot. ~2.5× more headroom at the schema-eval
   ceiling.

## Files

- `realDeploy.ts` — fresh, designed for fast iteration (~5 s per push
  at N≤200)
- `_deploy/` — self-contained scaffold (package.json, convex.config.ts,
  symlinks to parent `node_modules` and `.env.local`)
- This results file
