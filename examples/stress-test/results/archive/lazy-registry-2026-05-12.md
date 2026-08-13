# Lazy registry — the win is already in the library

Built on the fan-in baseline. Adds a third compose mode: `registryMode='lazy'`
emits `() => import('../registry')` instead of a top-level static import on the
registry module. This mirrors PR #60's recommended consumer pattern (which
was already merged into `initZodvex` as async-thunk support) but is not how
the example apps actually consume the registry today (`functions.ts` still
imports `zodvexRegistry` statically).

## Numbers at N=200, sample=10, max heap per endpoint

| Flavor | Baseline (no registry) | Static registry | **Lazy registry** | Lazy vs static |
|---|---:|---:|---:|---:|
| convex (plain) | 0.4 MB | 2.1 MB | **0.4 MB** | 5× drop |
| convex-helpers-zod3 | 1.2 MB | 2.9 MB | **1.2 MB** | 2.4× drop |
| convex-helpers (zod4) | 2.3 MB | 4.1 MB | **2.3 MB** | 1.8× drop |
| zodvex-mini | 2.1 MB | 25.9 MB | **2.2 MB** | 12× drop |
| **zodvex (full zod)** | 2.7 MB | **57.4 MB** | **2.9 MB** | **20× drop** |

Lazy registry brings every flavor back to its no-registry baseline. The win
is biggest for zodvex because the registry IS the dominant cost driver
under static linking.

## Why it works

Bundle topology for `zodvex` at N=200, registry/lazy:

```
endpoints/<endpoint>.js   ~79 KB    (entry — loaded at push-time analysis)
_deps/<hash>.js          ~450 KB    (registry's transitive schema graph)
_deps/<hash>.js          ~130 KB    (zod + zodvex runtime, shared)
```

esbuild with `splitting: true` (Convex's default isolate config) hoists
the dynamic-import target into a separate chunk under `_deps/`. The entry
file references the chunk by URL but does not load it at module init.
Heap-on-load measures only the entry's cost. The 580 KB of chunked schema
sits on disk for runtime loading but does not enter the isolate's heap
during push analysis.

## What this implies

1. **The fix already exists in the library.** PR #60 added async-thunk
   support to `createActionCustomization`. Nothing in the library blocks
   the lazy pattern.

2. **The examples don't use it.** `examples/task-manager/convex/functions.ts`
   does:
   ```ts
   import { zodvexRegistry } from './_zodvex/api.js'   // static
   ...
   registry: () => zodvexRegistry                       // sync thunk
   ```
   Should be:
   ```ts
   registry: async () => (await import('./_zodvex/api.js')).zodvexRegistry
   ```

3. **`zodvex generate` should emit the lazy pattern.** Today it emits a
   `functions.ts` snippet that callers paste in. That template should
   produce the async thunk by default. Codegen-driven projects then
   inherit the win without thinking about it.

4. **Caveat: bundle bytes vs heap bytes.** With lazy registry, the
   `bundle bytes` column in the table is unchanged (~644 KB) — those
   are entry+chunks, what gets pushed. Per-endpoint heap drops 20×
   because chunks aren't loaded at push-time analysis. If Convex's
   new per-entrypoint backend analyzes heap only (entrypoint module
   load), lazy is a complete win. If it also imposes a chunks-included
   bundle-size cap, lazy dodges the memory ceiling but not the bytes
   ceiling. The bytes ceiling is much more generous — single
   entrypoint+deps under ~1 MB is comfortable territory — but worth
   confirming against a real Convex deploy.

5. **The codemod issue is still worth fixing** (#65) — it's how
   consumers reach the mini side of this table. Without the codemod
   the mini variant's "lazy registry" win is gated on hand-rewriting
   their seeds.

## Next steps (suggested)

- Patch `examples/task-manager*` and `examples/quickstart` to use the
  async-thunk pattern. Quick smoke test confirms `za` still works.
- Update `zodvex generate` so emitted `functions.ts` snippet uses
  async-thunk by default.
- Verify against a real Convex deploy: take one app at N≈200 with
  static-registry pattern, push, observe (expected: passes under new
  backend because per-entry is fine even without lazy, but bytes are
  similar). Then switch to lazy, push, observe difference.
- Update the memory-optimization decision doc / README story:
  "use the lazy registry thunk" becomes a first-class recommendation.

## Why this matters beyond the immediate fix

The compile-away CLI (#63) targeted the *aggregate* ceiling at huge
endpoint counts. Under per-entrypoint analysis, lazy-registry hits
the same goal (no per-endpoint schema tax) with a 5-line consumer
change instead of a 600-line CLI. If lazy holds up under real-deploy
verification, #63's value proposition narrows considerably.

## Repro

```bash
# Static (current example apps' pattern)
bun run bench.ts --all --count=200 --sample=10 --registry

# Lazy (PR #60 recommended pattern)
bun run bench.ts --all --count=200 --sample=10 --registry --lazy-registry
```
