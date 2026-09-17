# Eager versus memoizing-getter registries — 2026-09-17

Since 0.7.11, `zodvex generate` emits each `zodvexRegistry` entry as a memoizing
getter instead of an eager object literal (see
[`docs/decisions/2026-09-16-lazy-registry-getters.md`](../../../../docs/decisions/2026-09-16-lazy-registry-getters.md)).
Every server function imports the registry through `initZodvex`, and the Convex
isolate evaluates module top-level code per execution, so the eager shape rebuilt
every entry's schemas on every call. This study adds `full_registry_lazy` and
`mini_registry_lazy` to the [codec workload benchmark](../../capacity/README.md):
the same 128 entries as `full_registry` / `mini_registry`, in the getter shape.
`compose.test.ts` checks that fixture against the real generator output.

## What we observed

Runs used Convex 1.32.0, convex-helpers 0.1.113, Zod 4.6.5, and the library tree at
`78b4393989160fec91fd4c2d9c329078bb4f83eb` (package version 0.7.11-beta.1) on the
dedicated development deployment `dutiful-llama-148`. Hosted backend revision,
machine placement and true cold/warm isolate state are not observed. Default
settings: 640-byte payload field, 256 seeded rows, batches 1/64/256, seven
interleaved rounds, order seed 42; 220 sample calls per run, every call correct.

Median query server milliseconds, `[Q1, Q3]` over seven uncached samples, from the
[committed-harness run](capacity-lazy-registry.md):

| Rows | full_models | full_registry (eager) | full_registry_lazy | mini_models | mini_registry (eager) | mini_registry_lazy |
|---:|---|---|---|---|---|---|
| 1 | 31.78 [27.09, 32.46] | 48.90 [48.02, 52.14] | 31.21 [23.87, 32.16] | 20.55 [19.11, 22.88] | 38.11 [36.97, 39.98] | 19.93 [18.85, 20.73] |
| 64 | 40.47 [39.62, 46.08] | 56.63 [56.24, 60.61] | 33.03 [32.62, 36.07] | 28.83 [28.74, 32.94] | 45.95 [39.57, 52.08] | 35.44 [30.24, 37.00] |
| 256 | 69.59 [63.34, 96.45] | 93.07 [88.92, 107.08] | 73.25 [67.42, 81.56] | 64.50 [63.13, 67.09] | 84.32 [77.56, 87.36] | 65.42 [61.50, 67.87] |

The 128 eager entries add about 17 ms (full) and 18 ms (mini) to every call over the
same 32-model graph without a registry. The getter registry adds nothing measurable:
its medians sit inside the models-only interquartile range at every batch size, and
the eager and lazy interquartile ranges do not overlap at one row. The
[earlier repeat](capacity-lazy-registry-repeat.md) on the same fixture (recorded
against the pre-amend commit `d4283d2`, whose composer is byte-identical: same
fixture hash `f5085c2c…`) shows the same separation: 47.77 vs 28.91 (full) and
37.65 vs 24.69 (mini) at one row.

This fixture cost is the construction of the entries themselves. The
[two-field control](capacity-two-field-control.md) used the first draft of this
fixture (recorded against main `59dda9a` with the harness change uncommitted; fixture
hash `4007eaeb…`), whose entries were a two-field `args` object: 128 of them cost about 3 ms warm in Node, and
eager and lazy were indistinguishable inside run-to-run noise (29.92 vs 30.77 full,
27.81 vs 24.69 mini at one row). The promoted runs therefore use a ten-field argument
schema per entry, the local Zod baseline corpus, which is closer to what a generated
entry inlines. Real registries vary: the saving scales with the number and size of
entries a function's import graph carries, not with the number of functions called.

This agrees with the consumer measurement that motivated the change, where a
62-function registry cost about 35 ms per call on Convex Cloud. The models graph
itself (lean → models, about 17 ms here) is untouched by this change.

## Scope

One indexed read, modeled decode, domain transform and full return encoding; no
measured heap, no cold-start claim, no capacity ceiling. The eager and lazy variants
share models, schema, workload and driver; only `registry.ts` differs. Timings
describe successful uncached samples. `summary.json` carries every run's metadata and
per-cell summaries; `evidence.tar.gz` holds raw calls, completions, graph manifests,
logs and the committed-harness run's composed fixture; `SHA256SUMS` checks the archive.
