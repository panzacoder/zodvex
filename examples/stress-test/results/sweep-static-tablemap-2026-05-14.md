# Runtime-verified ceiling sweep — static tableMap

Single dated snapshot of every flavor × N cell with deployment resets
between each push **and a runtime smoke call on each N=200 cell** to
catch regressions like the dynamic-import-unsupported bug that the
prior (deploy-only) `sweep-2026-05-13.md` did not detect.

> **Status correction.** The 2026-05-13 sweep claimed zodvex matched
> pure-Convex deploy headroom. That was true at deploy time but the
> deployed Q/M handlers crashed at runtime because the lazy tableMap
> used dynamic `import()` from inside Convex's V8 sandbox (which
> forbids it). The current sweep was run with the static tableMap
> revert (`feat/static-tablemap-runtime-fix`) plus a `bunx convex run`
> smoke call after the first deploy per flavor. Every passing cell
> below represents code that both deploys cleanly *and* serves a
> codec-wrapped Q/M request.

## Numbers (real Convex deploys + runtime smoke, `dev:tangible-jellyfish-256`)

Times include the smoke call on N=200 (~1–3s overhead). 5 flavors × 7
N values = 35 cells, each with `resetDeployment()` between them.

| flavor | N=200 | N=400 | N=500 | N=600 | N=700 | N=750 | N=800 |
|---|---|---|---|---|---|---|---|
| **convex** (plain) | ✓ ok (13s) | ✓ ok (21s) | ✓ ok (26s) | ✓ ok (30s) | ✓ ok (35s) | ✓ ok (38s) | ✗ TooManyReads |
| **convex-helpers + zod3** | ✓ ok (15s) | ✓ ok (22s) | ✓ ok (27s) | ✓ ok (31s) | ✓ ok (38s) | ✓ ok (41s) | ✗ TooManyReads |
| **convex-helpers + zod4** | ✓ ok (17s) | ✓ ok (26s) | ✗ OOM | ✗ OOM | ✗ OOM | ✗ OOM | ✗ OOM |
| **zodvex** (static tableMap) | ✓ ok (16s) | ✓ ok (25s) | ✓ ok (30s) | ✓ ok (37s) | ✓ ok (42s) | ✓ ok (43s) | ✗ TooManyReads |
| **zodvex-mini** (same) | ✓ ok (18s) | ✓ ok (25s) | ✓ ok (29s) | ✓ ok (36s) | ✓ ok (41s) | ✓ ok (44s) | ✗ TooManyReads |

Raw JSON: `results/sweep-static-tablemap-2026-05-14.json`.

## What changed since 2026-05-13

The deploy outcomes are identical to the previous sweep. The new
information is **runtime correctness**:

- `bunx convex run endpoints/activity_0000:listActivities '{}'` now
  succeeds after every zodvex/zodvex-mini deploy at N=200. Pre-fix,
  this call crashed every time with
  `dynamic module import unsupported`.
- The static tableMap construction inside `_zodvex/server.ts` keeps
  the Q/M codepath dynamic-import-free. Userland `functions.ts`
  imports `server.ts`, server.ts statically imports every model, the
  per-entrypoint analyzer evaluates the full graph.
- The action registry stays lazy (`import('./api.js')` inside the
  `_registry` thunk) because actions run in Node where dynamic
  imports work — same pattern beta.17–beta.20 already shipped.

## Why the analyzer didn't OOM with static model imports

Going in, the concern was that statically importing every model from
`_zodvex/server.ts` would re-introduce the per-entrypoint analyzer
OOM at high N. The data says it doesn't — every zodvex cell up to
N=750 passes the analyzer without OOM, identical to the prior
deploy-only numbers.

Hypothesis: the schema-eval ceiling (~N=155 default, ~N=700
mini+slim, pre-overhaul) was set by *schema.ts* importing every
model with zod construction at module init. With the new pure-Convex
`defineSchema(tables)` shape, schema.ts no longer imports models —
the model graph is reachable only through `_zodvex/server.ts`
which `functions.ts` imports. The functions.ts per-entrypoint
analyzer apparently has either a larger budget than the schema-eval
isolate or evaluates the static graph more lightly. Either way, the
empirical ceiling sits at Convex's TooManyReads wall regardless.

## What this means for the beta

The unreleased changelog entry's claim "zodvex matches pure-Convex
deploy headroom" is now true with an additional asterisk: at the
*runtime* level too. The dynamic-import regression that motivated
this branch is gone.

Remaining work before beta:

- Land `feat/static-tablemap-runtime-fix` into the parent
  `feat/zodvex-codegen-overhaul` branch (or supersede it)
- Update the CHANGELOG to remove the runtime-regression banner and
  describe the static-tableMap shape
- Update the orientation doc (`ceilings-and-regression-2026-05-13.md`)
  with the corrected story
- Update userland docs that describe `_zodvex/server.ts` to mention
  the static import graph (so users understand why functions.ts will
  appear to import every model)
