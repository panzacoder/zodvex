# Ceilings vs. regression: how to read our stress-test results

> **Updates**:
> - 2026-05-13: An earlier version of this document reported
>   ceilings at N=2000/2500 because tests ran back-to-back without
>   resetting the deployment between them. Authoritative ceiling
>   data with resets is in `sweep-2026-05-13.md`.
> - 2026-05-14: The 2026-05-13 sweep measured deploy outcome only.
>   It missed a runtime regression: the lazy tableMap thunk used
>   dynamic `import()` which Convex's Q/M V8 sandbox forbids.
>   Authoritative runtime-verified ceiling data is now in
>   `sweep-static-tablemap-2026-05-14.md`. Numbers happen to be the
>   same — ceilings are stable across the static-tableMap revert —
>   but every passing cell is now confirmed to serve real Q/M
>   requests via a `bunx convex run` smoke step after each deploy.

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

## Current ceilings (real Convex deploys, fresh-diff)

Methodology: each test starts with `resetDeployment()` — pushes a
placeholder schema so the next deploy's `finish_push` diff is
"0 → N" (additions only), not "M → N". This captures the true
single-push ceiling.

| flavor | N=200 | N=400 | N=500 | N=600 | N=700 | N=750 | N=800 |
|---|---|---|---|---|---|---|---|
| **convex** (plain) | ok | ok | ok | ok | ok | ok | TooManyReads |
| **convex-helpers + zod3** | ok | ok | ok | ok | ok | ok | TooManyReads |
| **convex-helpers + zod4** | ok | ok | OOM | OOM | OOM | OOM | OOM |
| **zodvex** (new shape) | ok | ok | ok | ok | ok | ok | TooManyReads |
| **zodvex-mini** (new shape) | ok | ok | ok | ok | ok | ok | TooManyReads |

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

## Regression target — N=600

The regression suite picks one N and runs all 5 flavors at it.

Why **N=600** specifically:

- The fresh-diff TooManyReads wall sits between N=750 and N=800. N=600
  leaves a 25% buffer below that wall.
- Above ch/zod4's OOM at N=500, so the apples-to-apples comparison
  (zodvex passes, ch/zod4 OOMs) remains intact.
- 3,000 functions is real-world-large; well below Convex's published
  8,192 function limit.
- Survives a fresh single deploy with no diff-stacking magic. Every
  regression run starts from a near-empty state via `resetDeployment()`.

The previous default of N=800 in this codebase was set against
sloppy methodology — passes only happened because residual state from
prior tests shrank the diff. With the correct reset-each-test
methodology, N=800 is exactly at the TooManyReads wall.

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
