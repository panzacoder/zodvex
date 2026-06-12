# Where we sit: main vs perf/codegen-overhaul — full real-deploy comparison

Date: 2026-06-12. All cells are REAL Convex deploys (`dev:first-skunk-786`,
convex CLI 1.32.0, zod 4.3.6, convex-helpers 0.1.104) with a deployment
reset before each cell and the healthcheck smoke (codec decode + scheduler
encoding where the shape wires a registry) on every passing cell. N = model
count = endpoint-file count (legacy 1:1 axis; ~5–6 functions per endpoint
file). Raw data: `sweep-main-explicit-2026-06-12.json`,
`sweep-parity-2026-06-12.json` (both on the `test/stress-harness` branch),
`sweep-branch-{consolidated,explicit,harness}-2026-06-12.json` (this
branch).

## The headline table

| | N=50 | 100 | 150 | 200 | 300 | 400 | 600 | 750 | 800 |
|---|---|---|---|---|---|---|---|---|---|
| **parity: convex** | | | | ok | | | ok | ok | TMR |
| **parity: helpers-zod3** | | | | ok | | | ok | ok | TMR |
| **parity: helpers-zod4** | | | | ok | | | OOM | OOM | OOM |
| **MAIN zodvex, explicit** | ok | ok | **OOM** | OOM | | | | | |
| **MAIN zodvex-mini, explicit** | ok | ok | ok | ok | ? | ? | | | |
| **BRANCH zodvex, explicit** | ok | ok | **OOM** | OOM | | | | | |
| **BRANCH zodvex-mini, explicit** | ok | ok | ok | ok | ? | ? | | | |
| **BRANCH zodvex, consolidated** | ok | ok | **OOM** | OOM | OOM | OOM | | | |
| **BRANCH zodvex-mini, consolidated** | ok | ok | ok | ok | ok | **OOM** | | | |
| **BRANCH zodvex, harness (floor)** | | | | ok | | | ok | ok | TMR |
| **BRANCH zodvex-mini, harness (floor)** | | | | ok | | | ok | ok | TMR |

TMR = TooManyReads, Convex's own fresh-diff schema-push wall — pure convex
hits it identically, so 750 is "matches pure-convex headroom".
`?` = unmeasured (main-mini's cliff above 200 is the one open cell).

## What this says

1. **Main today (0.7.5, documented shape): full-zod apps cap at 100–150
   models.** The binding constraint is per-endpoint (post-#414 model):
   `functions.ts` statically imports the full schema (`defineZodSchema`,
   every model) AND the full registry (`api.js`, args+returns) — at N=150
   that graph is ~70 MB proxy, over the 64 MB analyzer budget. zodvex-mini
   extends this to ≥200 (cliff not yet probed).

2. **The branch does not regress the explicit shape** — cell-for-cell
   identical to main.

3. **The branch's consolidated shape is cliff-equivalent to main's explicit
   shape for full zod** (100 ok / 150 OOM): the all-models import graph
   binds either way; swapping the full registry for the args-only one
   doesn't buy a bracket at this granularity. Where it DOES pay:
   **zodvex-mini consolidated reaches N=300** (OOM at 400) — the
   args-only registry + mini's lighter allocation together.

4. **The branch's floor (thin schema, no codec wiring) is at pure-convex
   parity** (750 ok / 800 TMR) for BOTH zod and mini — same wall, same N,
   as `convex` and `helpers-zod3` measured the same day. This is the
   capacity the schema-thin fix unlocked; no documented consumer shape
   reaches it yet, which is the gap the per-endpoint model-registration
   design (or equivalent) has to close.

5. **helpers-zod4 (rolling your own, no mitigations) OOMs at 600** — at
   small-to-mid N the harness shape shows zodvex's library overhead is
   no longer the limiting factor; the model/registry graphs are.

## Calibration data for the heap proxy

Real-deploy outcomes now bracket the per-endpoint heap proxy:

| proxy reading | real deploy |
|---:|---|
| 37.5 MB (mini consolidated @200) | ok |
| ~56 MB (mini consolidated @300, extrapolated) | ok |
| ~63 MB (zodvex consolidated @150, extrapolated) | OOM |
| ~75 MB (mini consolidated @400, extrapolated) | OOM |
| 84.4 MB (zodvex consolidated @200) | OOM |

The proxy threshold sits at roughly **~60 MB proxy ≈ the real 64 MB cap** —
close enough that the proxy can pre-screen ladders with a ±1-bracket
margin before spending real deploys.

## Open cells / next measurements

- Main-mini explicit cliff (≥200, probably 200–400).
- Model-axis vs function-axis ladders at the consolidated shape
  (`--models` / `--endpoints` are wired; per-axis slopes measured so far
  only via the bench proxy: ~0.18 MB/model, ~0.22 MB/endpoint-file).
- Re-run everything when convex CLI is bumped from 1.32 (1.41 current) —
  the metadata stamps will keep the snapshots comparable.
