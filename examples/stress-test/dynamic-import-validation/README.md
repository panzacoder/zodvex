# Dynamic-import memory validation

Validates the premise behind enabling dynamic `import()` in Convex
queries/mutations, using **actions** (where Convex already enables it) as the
testbed — per Ian's ask:

> "Could you validate this in actions — see if doing dynamic imports in actions
> allows your schema to avoid memory limits when only dynamically importing a
> subset?"

## The hypothesis

A V8 action (same isolate environment as q/m, but with `import()` enabled) that
dynamically imports only **K of N** deployed model modules should pay memory for
**K**, not N. The N−K unimported models are bundled/deployed but never
*evaluated*, so they cost nothing until touched. If that holds in actions, it
should hold once Convex enables `import()` in q/m.

## What's here

- `generate.ts` — stamps N copies of the real zodvex seed models (heavy
  schemas ≈ real per-model eval cost) plus the action under test.
  - `dynamic`: `loadSubset(count)` dynamically imports the first `count` models.
  - `static`: `loadEager` statically imports all N (the eager baseline).
- `sweep.ts` — drives real deploys + invocations against the configured Convex
  dev deployment (reuses the harness's `realDeploy.ts`).
- `proxy.ts` — fast local Bun/Node heap proxy (confirms deferred evaluation;
  NOT Convex's isolate).

## Critical methodology notes

- **V8 action, NOT `"use node"`.** The action uses `actionGeneric` with no
  `"use node"` directive, so it runs in Convex's V8 action runtime — the same
  environment as q/m. A Node action would have a different heap model and would
  NOT predict q/m behavior. Do not add `"use node"`.
- **Static-specifier dynamic imports.** Each loader is `() => import('./models/model_NNNN')`
  with a literal path, so Convex stores each model as its own module and routes
  the import to its runtime loader (a computed specifier would not bundle).
- **Deploy is expected to succeed for `dynamic`.** The analyzer doesn't follow
  dynamic imports, so N=750 models + the action push fine; the test is at
  *runtime invocation*, not deploy.

## Prerequisites (on the Mac with the real environment)

The harness deploys to a real Convex dev deployment via `examples/stress-test/_deploy`.
One-time, if not already configured:

```bash
cd examples/stress-test/_deploy
npx convex dev --configure        # writes _deploy/.env.local with CONVEX_DEPLOYMENT
```

Then from `examples/stress-test`: `bun install` (workspace deps).

## Running

Fast local signal (no Convex):

```bash
cd examples/stress-test
bun run dynamic-import-validation/proxy.ts --models=750
```

The real test — N=750 deployed, sweep K:

```bash
cd examples/stress-test
bun run dynamic-import-validation/sweep.ts --mode=dynamic --models=750
```

The eager baseline (expected to OOM the analyzer at low N):

```bash
bun run dynamic-import-validation/sweep.ts --mode=static --ladder=50,100,150,200,250
```

Results land in `dynamic-import-validation/results/*.json` (git SHA + timestamp
stamped).

## Reading the result

**Premise confirmed** if, with N=750 models deployed:
- small-K `loadSubset` invocations succeed comfortably (the 750 deployed models
  cost nothing unimported), and
- the OOM threshold scales with **K** (importing enough models eventually OOMs
  the runtime isolate), not with the deployed N, and
- the `static` baseline OOMs at a much lower N (eager eval of everything).

That combination is the evidence Ian asked for: dynamic-import-of-a-subset
avoids the per-isolate eval ceiling. The remaining zodvex-side work (selecting
*which* table modules to import on a data-dependent touch) is separate and does
not affect this memory premise.
