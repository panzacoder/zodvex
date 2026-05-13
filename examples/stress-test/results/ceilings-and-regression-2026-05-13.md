# Ceilings vs. regression: how to read our stress-test results

Two distinct questions, two distinct results files. Both matter; they
answer different things.

## The two questions

### "Where does each flavor actually break?" — ceiling sweep
Run rarely. Resource-intensive. Lives in
`results/post-consolidation-2026-05-13.md` and
`results/cross-library-real-deploy-2026-05-13.md`. Use it for
announcements, blog posts, marketing claims about scale.

### "Did we regress at the high-water mark we promise?" — regression
Run on every PR. Cheap. Lives in `regression.ts` + the dated
`results/regression-<date>.{md,json}` snapshots. Use it as a release
gate.

## Current ceilings (real Convex deploys)

Most-recent consolidated picture across all flavors. Non-zodvex
flavors are external libraries unchanged by our work; their ceilings
come from `cross-library-real-deploy-2026-05-13.md`. zodvex/zodvex-mini
flavors run with the new shape — lazy-tables + marker + consolidated
`_zodvex/server.ts`.

| flavor | N=200 | N=500 | N=800 | N=1000 | N=1500 | N=2000 | N=2500 |
|---|---|---|---|---|---|---|---|
| **convex** (plain) | ok | ok | ok | ok | — | TooManyReads | n/a |
| **convex-helpers + zod3** | ok | ok | ok | ok | ok | ok | 4096-file cap |
| **convex-helpers + zod4** | ok | OOM | OOM | OOM | OOM | OOM | OOM |
| **zodvex (new shape)** | ok | ok | ok | ok | ok | TooManyReads | n/a |
| **zodvex-mini (new shape)** | ok | ok | ok | ok | ok | TooManyReads | n/a |

### Reading the failure modes

**OOM** — JavaScript heap exhaustion at deploy analysis (64 MB isolate
limit). Either schema-eval or per-module loading. The improvement work
addressed this.

**TooManyReads** — Convex backend's per-transaction read-set cap (4096
distinct read intervals) hit during `finish_push`. Not memory. Convex
commits the entire deploy in one transaction; diffing this many
function entries exceeds the read-set budget. Hard backend constant on
Convex Cloud (`TRANSACTION_MAX_READ_SET_INTERVALS = 4096` in
`convex-backend/crates/common/src/knobs.rs`).

**4096-file cap** — Convex's `MAX_FUNCTION_FILES` ceiling
(`MAX_FUNCTION_FILES = 4096`). Hit when total `.ts/.js` files in
`convex/` (excluding `_generated/`, `_deps/`, marker-skipped dirs, etc.)
exceeds 4,096. Our stress test composes ~2 files per N (a model and an
endpoint file) plus generated codegen, so this hits around N=2500.

### What the table shows

1. **zodvex now matches pure-convex headroom.** Both flavors deploy
   through N=2000 and hit Convex's own non-memory ceilings, not memory.
2. **zodvex (either variant) outperforms `convex-helpers + zod4` by
   ~4×** at the OOM ceiling. zod4 + the convex-helpers adapter OOMs at
   N=500 with no in-library fix path; zodvex passes the same N with
   `bun zodvex migrate`.
3. **zodvex-mini and zodvex are equivalent at the OOM ceiling.** Mini
   is ~5–10% faster to deploy but doesn't unlock more headroom under
   the new shape. Mini remains useful for bundle-size-sensitive cases.
4. **`convex-helpers + zod3` is the headroom king.** zod3 is lighter
   per-object than zod4. zodvex doesn't replace this — it offers
   codecs + auto-decode + DB wrappers that the plain ch + zod3 stack
   doesn't.

## Regression target — N=800

The regression suite picks one N and runs all 5 flavors at it.

Why **N=800** specifically:

- 800 endpoints ≈ 4,000 functions. Real-world-large but a recognizable
  Convex usage scale.
- Sits under all of Convex's documented limits
  ([source](https://docs.convex.dev/production/state/limits)): 8,192
  functions, 4,096 read intervals per transaction, 4,096 function
  files.
- Tolerates diff-stacking from prior deploys against the same
  deployment. The empirical TooManyReads wall is at ~N=2000;
  back-to-back N=800 pushes add 4,000 functions over residual state,
  still well under.
- Big enough that all of our memory work matters (a 4,000-function
  zodvex app would have OOMed at N≈155 before the overhaul).

## How to run

```bash
# regression — what CI runs
bun run regression.ts                  # default: N=800
bun run regression.ts --target=400     # different N

# ceiling work — when re-checking after backend changes
bun run bench.ts --all --count=2000 --lazy-tables
bun run bench.ts --flavor=zodvex --count=1500 --lazy-tables --registry --keep
bun run realDeploy.ts --source=tmp/zodvex/composed
```

The regression script exits 0 iff every flavor matched its expected
outcome. Use as a release gate.

## When to refresh the ceiling table

The numbers above are real Convex deploys, dated 2026-05-13. They will
shift if:

- **Convex changes the backend** (e.g. raises `TRANSACTION_MAX_READ_SET_INTERVALS`,
  adds chunked finish_push, changes the per-entrypoint analyzer
  behavior).
- **zod / zod-mini change per-object memory footprint** (zod4.x is
  active development).
- **convex-helpers changes its adapter** (its OOM ceiling could shift
  if they make zod-eval lazier).
- **zodvex's codegen or runtime changes** in a way that touches deploy
  footprint.

Re-run the ceiling sweep on any of these. Regression covers most
day-to-day "did we accidentally regress" surface area.

## Heap-as-proxy caveat

The endpoint and schema heap columns in our regression results are
**Node v8 heap-on-load measurements** in an isolated subprocess. They
correlate with Convex's deploy isolate behavior but they are not the
same thing. Specifically:

- Our measurer bundles each entry the same way Convex's CLI does
  (matching its esbuild config), then loads it in
  `node --max-old-space-size=64`. The number we report is Node's
  `getHeapStatistics().used_heap_size` delta.
- Convex's deploy analyzer runs in its own isolate with different V8
  flags, additional bookkeeping (analysis metadata, source maps,
  function-handle diffs), and module-resolution semantics. The actual
  heap during deploy can be meaningfully higher than our local measure.

The headline example: at N=800, `convex-helpers + zod4` measures
**2.29 MB endpoint / 7.75 MB schema** in our proxy — apparently *less*
than zodvex (2.69 / 8.09) — yet OOMs on Convex while zodvex doesn't.
The reason is that ch/zod4's `schema.ts` statically imports 800
zod-flavored model files; our local proxy doesn't fully capture what
the deploy isolate does with that graph. zodvex's `schema.ts` under
the new shape imports only pure-Convex `defineTable(...)` calls from
`_zodvex/tables.ts` — zero zod runtime in the schema-eval isolate —
so its real-deploy footprint is much lighter than the proxy suggests.

**Ground truth is the deploy outcome.** The heap delta is a leading
indicator and a regression signal, not an absolute number. Treat it
as "did this number jump unexpectedly between releases" rather than
"this is what fits in 64 MB."

## Files

- `regression.ts` — orchestrator (compose → measure → deploy → classify)
- `results/regression-<date>.{md,json}` — dated regression snapshots
- `results/post-consolidation-2026-05-13.md` — most recent zodvex
  ceiling sweep with the new shape
- `results/cross-library-real-deploy-2026-05-13.md` — non-zodvex
  flavor ceilings
- `results/final-ceilings-2026-05-13.md` — earlier ceiling pass; same
  data, more narrative around the marker-file discovery
- This file — orientation
