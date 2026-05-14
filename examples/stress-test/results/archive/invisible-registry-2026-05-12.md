# Invisible registry — codegen carries the laziness, consumer writes today's sync code

Follow-on to `lazy-registry-2026-05-12.md`. Tests whether the dynamic
import can live inside `functions.ts` (codegen output) so consumers
write no async code and don't touch the registry at all.

## Setup

Three compose modes for `--registry`:

- **static** (today's example apps): endpoint does
  `import { __registry } from '../registry'`. Pulls full schema graph
  into the entrypoint's static bundle.
- **lazy**: endpoint does
  `() => import('../registry')`. Pattern PR #60 documents but examples
  don't use.
- **invisible** (this run): endpoint imports nothing registry-related.
  `functions.ts` contains
  `const __loader = () => import('./registry')`. Models a codegen-driven
  workflow where consumers never write async code.

## Numbers at N=200, sample=10, max heap per endpoint

| Flavor | Static | Lazy (endpoint thunk) | **Invisible (functions.ts thunk)** |
|---|---:|---:|---:|
| convex | 2.1 MB | 0.4 MB | **0.4 MB** |
| convex-helpers-zod3 | 2.9 MB | 1.2 MB | **1.2 MB** |
| convex-helpers (zod4) | 4.1 MB | 2.3 MB | **2.3 MB** |
| zodvex-mini | 25.9 MB | 2.2 MB | **2.1 MB** |
| **zodvex (full zod)** | **57.4 MB** | 2.9 MB | **2.9 MB** |

**Invisible is byte-equivalent to explicit lazy.** Same chunk topology,
same heap delta, same bundle bytes. The dynamic import is hoisted by
esbuild regardless of which file contains the `() => import(...)` call.

## Bundle topology under invisible mode (zodvex N=200)

```
endpoints/<endpoint>.js       78,769 B   ← what Convex loads per-entrypoint
_deps/<hash>.js              450,214 B   ← registry's schema graph (chunk)
_deps/<hash>.js              130,389 B   ← zod + zodvex runtime (shared chunk)
```

Entry bundle is 79 KB. Registry schemas live in a separate chunk that
isn't loaded at module init. Heap-on-load: 2.86 MB.

## What changes for consumers

**Before** (current example apps):
```ts
// convex/functions.ts
import { initZodvex } from 'zodvex/server'
import { zodvexRegistry } from './_zodvex/api.js'   // static, heavy
import { ... } from './_generated/server'

export const { zq, zm, za, ... } = initZodvex(schema, server, {
  registry: () => zodvexRegistry,   // sync thunk closes over static import
})
```

**After** (codegen-driven invisible lazy):
```ts
// convex/functions.ts — emitted by `zodvex generate`
import { initZodvex } from 'zodvex/server'
import { ... } from './_generated/server'

export const { zq, zm, za, ... } = initZodvex(schema, server, {
  registry: () => import('./_zodvex/api.js').then(m => m.zodvexRegistry),
})
```

Consumer's endpoint files are unchanged. They import `zq`, `zm`, `za`
from `functions` exactly as today. The whole change is one line in
`functions.ts` and it's emitted by codegen.

## Implications

1. **The optimization can be invisible.** Library code already supports
   async-thunk registry (PR #60). All that's left is for codegen to
   emit the lazy form by default in `functions.ts`.

2. **No consumer migration needed.** Existing apps regenerate with the
   new codegen and inherit the per-endpoint heap drop. No code changes
   beyond `bun run generate`.

3. **The example apps need the same update**, since the example
   `functions.ts` files are hand-written, not generated. Quick fix.

4. **#63's compile-away CLI is even less load-bearing now.** It targeted
   the aggregate ceiling; under per-entrypoint analysis lazy registry
   already hits 20× drop with a one-line codegen change. The compile-
   away CLI had additional benefits (e.g., removing zod from runtime
   at all) but they're now optimizations on top of an already-acceptable
   baseline rather than a necessity.

## Caveats unchanged from prior write-up

- We're measuring node-isolated heap-on-load. Need one real Convex
  deploy to confirm Convex's per-entrypoint backend actually doesn't
  charge chunks against the entrypoint's memory budget.
- Codemod (#65) still needed for the zod/mini path to be invisibly
  available to consumers.

## Repro

```bash
bun run bench.ts --all --count=200 --sample=10 --registry --invisible-registry
```
