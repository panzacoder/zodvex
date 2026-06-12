# Lazy-tables validation — schema-only-thin under real Convex

Composer was extended with `--lazy-tables` to emit the new schema shape
end-to-end:
- `schema.ts` → `defineZodvexSchema<typeof tables, DecodedDocs>(tables)`
- `_zodvex/tables.ts` → emitted by invoking `zodvex generate` on the
  composed tree (so we exercise the real codegen path).

Bench was extended to bundle and measure `schema.ts` separately from the
endpoint entries.

## Local heap: dramatic win

Schema.ts heap-on-load, per the per-bundle measurer:

| N | Baseline schema heap | `--lazy-tables` schema heap | Reduction |
|---|---:|---:|---|
| 100 | 20.4 MB | 2.4 MB | **8.5×** |
| 200 | 38.3 MB | 3.2 MB | **12×** |
| 400 | 73.6 MB (>cap) | 4.9 MB | **15×** |

The new shape correctly keeps zod out of `schema.ts`'s static graph.
Local measurement says we should be well clear of the 64 MB schema-eval
isolate cap at scale.

## Real Convex deploy: unchanged ceiling

| N | Baseline (no lazy-tables) | `--lazy-tables` |
|---|---|---|
| 100 | ok | ok |
| 150 | ok | **OOM (module load)** |
| 175 | OOM (schema-eval) | OOM (module load) |
| 200 | OOM (schema-eval) | OOM (module load) |

The OOM site moved from "Hit an error while evaluating your schema" to
"Loading the pushed modules encountered the following error" — same
64 MB cap. The overall ceiling is **the same N≈125-150 range** as
before. Schema-only-thin doesn't move the deploy ceiling on its own.

## What this tells us

The Convex deploy pipeline has at least two memory budgets we hit
sequentially:

1. **Schema evaluation** — `schema.ts` loaded into a 64 MB isolate.
   Schema-only-thin (this PR) keeps this thin.
2. **Module loading** — happens after schema-eval succeeds. Reports
   "Loading the pushed modules" when OOM. Empirically still bounded by
   aggregate cost, not per-endpoint cost, on this deployment.

The per-entrypoint analysis Ian described handles some check the
deployment runs, but not the "load modules to verify" step that fires
when schema-eval passes.

## Module-load cost in our composer

Each composed endpoint:
- Imports zodvex + zod (~2 MB)
- Imports its own model file (small)
- Imports `'../functions'` (uses fake `{ __zodTableMap: {} }`)

Per-endpoint heap: ~2.7 MB measured locally. 150 endpoints × 2.7 MB =
~405 MB if loaded together. That matches the OOM — module loading is
still aggregate across all functions, at least for some check phase.

## What still works (and what doesn't, yet)

- **Schema-only-thin removes one ceiling.** Apps using small numbers of
  *very heavy* schemas (deep discriminated unions, codecs, etc.) will
  benefit. The schema isolate is no longer the bottleneck.
- **Module-loading aggregate is the next ceiling.** This is what
  `{ schemaHelpers: false }` (slim models) addresses — it shrinks each
  per-endpoint footprint. Combined with schema-only-thin, slim should
  unlock the headroom we observed in our cross-library measurements.
- The compile-away approach in #63 attacks both by removing zod
  entirely from runtime. That stays a fallback for very large apps.

## Open question

What does the "per-entrypoint analyzer" Ian referenced actually
analyze? Empirically:
- It does NOT replace the schema-eval isolate (still 64 MB).
- It does NOT replace the module-load aggregate budget (still 64 MB).
- It may be a *separate* per-entrypoint memory measurement that we
  haven't observed in our test data yet.

Worth asking upstream before further optimization.

## Next steps (recommendation)

1. Make `{ schemaHelpers: false }` the default in `defineZodModel`
   (PR #57's slim mode). Biggest single per-endpoint win, addresses
   the module-load ceiling.
2. Combine slim + schema-only-thin to see if the ceiling jumps to
   the pure-convex range (~2000 endpoints).
3. Hold schema-only-thin as a separate landed feature regardless —
   it's correct, isolated, and removes one of the two ceilings even
   if it's not the binding one on this deployment.

## Files

- `examples/stress-test/composeFlavor.ts` (updated) — `lazyTables` knob;
  invokes `bunx zodvex generate` on the composed tree
- `examples/stress-test/bench.ts` (updated) — bundles and measures
  schema.ts as a separate entry; `--lazy-tables` CLI flag
- `examples/stress-test/results/lazy-tables-validation-2026-05-13.md`
  (this file)
