# Fan-in baseline — 2026-05-12

The previous baseline (`baseline-2026-05-12.md`) showed that with isolated
seeds (each endpoint imports only its own model), every flavor sits at
<5 MB heap per endpoint. Comfortable headroom under the 64 MB isolate cap.

This run adds two fan-in knobs to `composeFlavor.ts`:

- `--fanin=K` — each endpoint imports K other random models (with a
  side-effecting reference so esbuild can't tree-shake them).
- `--registry` — emits a `registry.ts` that imports every model in the
  project and adds an import of it to every endpoint. Mirrors the worst
  case for zodvex's codegen-emitted `_zodvex/api.ts`.

## Plus a mini fix

Before this run, the mini flavor was double-bundling: seeds wrote
`import { z } from 'zod'`, so bundles contained both full zod and zod/mini.
Fix: `applyFlavorImportRewrites` runs the `zod-to-mini` codemod on the
seed source for the mini flavor, then rewrites `'zod'` → `'zod/mini'`
and `'zodvex'` → `'zodvex/mini'`. After the fix mini bundles drop from
541 KB / 2.95 MB to 492 KB / 2.10 MB — a real ~22% improvement per
endpoint.

## Numbers at N=200, sample=10

| Flavor | Baseline (no fan-in) | fanin=20 | registry (all 200) |
|---|---:|---:|---:|
| `convex` (plain) | 0.4 MB | 0.6 MB | **2.1 MB** |
| `convex-helpers-zod3` | 1.2 MB | 1.4 MB | **2.9 MB** |
| `convex-helpers` (zod4) | 2.3 MB | 2.6 MB | **4.1 MB** |
| `zodvex-mini` | 2.1 MB | 4.6 MB | **25.9 MB** |
| `zodvex` (full zod) | 2.7 MB | 8.2 MB | **57.4 MB** |

All measurements are the *max* heap delta across the sampled endpoints
(min ≈ max within each variant; per-endpoint cost is uniform).

## What the registry column means

Each endpoint imports a module that statically references every other
endpoint's schema. Under Convex's new per-entrypoint analysis, that
single endpoint's isolate must hold all those schemas. **For zodvex at
N=200 with the registry pattern we are at 57 MB per endpoint, 90% of
the 64 MB cap.** Projecting forward: zodvex hits the ceiling between
N=200 and N=250 endpoints under this pattern. zod/mini doubles the
runway to ~N=500.

The two convex-helpers flavors barely move because their model files
don't retain the zod schemas at module scope — they convert via
`zodToConvexFields()` at import time. zodvex retains the zod schemas
(needed for codecs, doc inference, etc.), which is the load-bearing
difference.

## Implications

1. **The new backend ceiling IS reachable by zodvex** — but only under
   the registry pattern. Without it, we have 20× headroom per endpoint.

2. **`_zodvex/api.ts` is the load-bearing artifact.** Anything that
   imports it inherits the full schema graph. zodvex's `za` actions
   import it for auto-decode. If most endpoints are `zq`/`zm` (no
   registry import), they're cheap. If you have an action-heavy app
   (or the codegen registry leaks into more places than it should),
   you scale much worse.

3. **zod/mini's value is now per-endpoint, not just aggregate.** Under
   the old constraint, mini doubled the aggregate ceiling (155 → 365).
   Under per-endpoint analysis, mini cuts a single registry-import
   endpoint's cost in half (57 → 26 MB). That's the same multiplier
   reapplied to a different denominator.

4. **The codemod has a known limitation** worth fixing upstream: it
   rewrites `zx.foo().nullable()` (a zodvex-typed chain) into
   `z.nullable(zx.foo())` even when `z` is not imported in the source.
   Workaround in compose: inject `import { z } from 'zod/mini'` when
   needed. Real fix is type-aware skip when receiver type isn't a
   `$ZodType`.

5. **Convex-helpers is much closer to plain convex than zodvex.** That's
   not necessarily a recommendation — convex-helpers loses zodvex's
   codec / doc inference benefits — but it tells us *where* the cost
   lives in zodvex's design.

## Files

- `composeFlavor.ts` — added `fanIn`, `registry`, mini-codemod
- `bench.ts` — added `--fanin=N`, `--registry` flags
- `results/baseline-200.json` — no fan-in baseline
- `results/fanin-20-200.json` — fanin=20 sweep
- `results/fanin-registry-200.json` — registry sweep
