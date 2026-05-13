# Regression baseline — N=800

Real Convex deploys at the new regression target. Captures the
post-overhaul state of zodvex against the comparison flavors.

## Numbers

| flavor | deploy | endpoint heap (max MB) | schema heap (MB) | deploy time |
|---|---|---:|---:|---:|
| `convex` (plain validators) | ✓ ok | 0.41 | 6.90 | 38.0 s |
| `convex-helpers` + zod3 | ✓ ok | 1.20 | 7.04 | 9.6 s |
| **`zodvex` (full zod)** | **✓ ok** | **2.69** | **8.09** | **18.9 s** |
| **`zodvex-mini`** | **✓ ok** | **2.09** | **7.87** | **11.6 s** |
| `convex-helpers` + zod4 | ✗ OOM | 2.29 | 7.75 | 10.3 s |

Target: N=800 endpoints (~4,000 functions). One sample per flavor.

## Read

**zodvex now sits at the pure-convex tier for deploy headroom.** At
N=800 — comfortably above Convex's documented 8,192-function ceiling
divided across 5 endpoints per model — zodvex and zodvex-mini both
deploy cleanly. The schema heap (~8 MB) is comparable across flavors
because the lazy-tables shape keeps `schema.ts` pure Convex
regardless.

**`convex-helpers` + zod4 still OOMs at the same N.** This is the
direct apples-to-apples comparison: same Convex backend, same Convex
adapter library, same schema shapes — but no equivalent optimization
stack. zod4 + the convex-helpers adapter doesn't deploy at this scale
without zod3 downgrading or migration to zodvex.

**zodvex/mini is faster to deploy** (11.6s vs 18.9s) even though both
pass. That's the bundle/transport difference; mini's per-endpoint
bundle is ~5–10% smaller.

## What's still binding at higher N

At ~N=2000 (10,000 functions) all four passing flavors hit Convex's
`TooManyReads` limit during `finish_push` — not memory. The 4,096
read-interval cap on a single backend transaction prevents diffing
that many functions in a single deploy.

Convex's own published function limit is 8,192. Most real apps will
not exceed ~1,000 endpoints. N=800 was chosen as the regression
target because it:
1. Exercises the per-entrypoint analyzer at a real-world-large scale
2. Stays under all documented Convex limits
3. Survives diff-stacking from prior deploys (a 4,000-function diff
   against a residual 4,000-function deployment still fits the
   read-set budget)

## Running it

```bash
# At the default target
bun run regression.ts

# At a different N
bun run regression.ts --target=400

# Writes results to results/regression-<YYYY-MM-DD>.json
```

Exit code 0 if all flavors hit their expected deploy outcomes; non-zero
otherwise. Useful as a release gate.

## Sweep mode is still available

`bench.ts` retains its full sweep capability for ceiling-finding work:

```bash
bun run bench.ts --all --count=2000 --lazy-tables
bun run bench.ts --flavor=zodvex --count=1500 --lazy-tables --registry --keep
```

The regression script is for "is the library still working at our
chosen high-water mark." The bench is for "where does it break."

## Methodology notes

- `realDeploy.ts` pushes via `npx convex dev --once --typecheck=disable`
  against a configured Convex dev deployment (`dev:tangible-jellyfish-256`).
- `convex` and `convex-helpers*` flavors do not use lazy-tables (it
  doesn't apply — those flavors don't use zodvex's codegen). zodvex
  flavors run with `--lazy-tables` which exercises the full new shape:
  `_zodvex/server.ts`, `_zodvex/tables.ts`, marker file, schema.ts
  using `defineSchema(tables)`.
- The `OOM` outcome for `convex-helpers` (zod4) is the *expected*
  outcome — it confirms our improvement claim. If it stops OOMing at
  this N (e.g. because the convex-helpers library ships its own fix),
  the regression will fail until we revise expectations.

## Where this fits in our story

For docs / blog / Ian response:

> "Before this overhaul, zodvex deployed up to ~155 endpoints before
> hitting Convex's schema-eval isolate (64 MB). After: 800 endpoints
> in ~19 seconds, matching pure-convex headroom. No zod/mini
> migration or schema simplification required — `bun zodvex migrate`
> moves an existing app to the new shape automatically. For
> reference, the equivalent convex-helpers + zod4 deploy still OOMs
> at this scale."
