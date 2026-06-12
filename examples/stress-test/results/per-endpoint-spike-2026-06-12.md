# SPIKE RESULT: per-endpoint model registration — hypothesis PROVEN

Date: 2026-06-12. Shape: `--shape=per-endpoint` (compose-layer spike, ZERO
library changes — models self-register via an appended import side effect;
`initZodvex` receives a live registry view through the existing `tableMap`
thunk option). Codecs fully ON: wrapDb + scheduler registry, healthcheck
asserting decode AND scheduler encoding at every cell.

## The ladder (full zod, real deploys, reset per cell)

| | N=200 | 400 | 600 | 750 | 800 |
|---|---|---|---|---|---|
| per-endpoint (codecs ON) | ✓ 8s | ✓ 10s | ✓ 12s | ✓ 14s | ✓ 15s |
| centralized shapes (codecs ON), same day | OOM at 150 | | | | |
| floor (codecs OFF), same day | ✓ | | ✓ | ✓ | TMR |

- Deployment completeness verified via `convex function-spec`: 4,003
  functions / 801 modules at N=800, healthcheck present.
- Per-endpoint heap proxy: **2.5 MB flat at N=200** (floor: 2.4;
  centralized: 84.4).
- N=800 passing (where floor/convex/zod3 hit TooManyReads the same day)
  is within that wall's known 750–800 boundary variance — treat the
  spike as "≥ floor", not "beats the platform wall".

**Conclusion: the codec machinery has no scale cost. The 100–150-model
ceiling is purely the centralized model-import topology. Removing it
takes full-zod zodvex WITH codecs from ~150 models to ≥800 — past
pure-convex's same-day showing.**

## The spike also reproduced the design's hazard — organically

First run failed at runtime: the healthcheck endpoint writes
`healthchecks` by table NAME without importing its model, so the table
never registered in that isolate, the writer passed a raw `Date`
through, and Convex's serializer threw. Two lessons, both already in the
plan (docs/plans/per-endpoint-model-registration.md):

1. The relation-follow / name-only-access pattern is real and WILL be
   hit (we hit it ourselves within minutes).
2. The miss is SILENT by default — it only surfaced loudly because Date
   isn't a Convex type; a number-backed codec would have written wrong
   wire data without a peep. This is the argument for the manifest +
   throw-by-default semantics.

Fix was the design's own medicine: one side-effect import
(`import '../models/healthcheck'`).

## What this changes about the decision

The ergonomics question ("explicit model imports for codec tables feel
like a nonstarter") is now priced: the import discipline buys a 5×+
codec-on ceiling (150 → ≥800). If the discipline is unacceptable, the
alternatives to investigate are UX softeners on TOP of this mechanism
(migrate codemod injecting the imports; codegen emitting per-endpoint
import shims; warn-first rollout) — not a different mechanism, because
the spike shows the topology is the entire problem.
