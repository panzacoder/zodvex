# Decision: Generate the function registry as memoizing getters

**Date:** 2026-09-16
**Status:** Accepted (implemented; ships in the next release)
**Context:** Hotpot handoff, 2026-09-16 — per-call cost of the generated registry measured on Convex Cloud.
**Relates-to:** `docs/guide/codegen.md` (registry wiring), [#80](https://github.com/panzacoder/zodvex/pull/80) (parked descriptor codegen, which included a codec-args-only server registry), `docs/issues/2026-06-08-validator-handler-decoupling.md`

---

## Problem

`zodvex generate` emitted `zodvexRegistry` as one eager object literal: `args` and `returns`
Zod schemas for every public function. Every server function file imports the app's
`initZodvex` wrapper (`functions.ts`), which imports the registry, so evaluating any one
function constructed every other function's validators first. The Convex isolate evaluates
module top-level code per execution (measured downstream, not documented), so that cost was
paid on every call.

Hotpot measured, on Convex Cloud (p50 of 20 no-op mutation calls, back-to-back deploys):

| no-op mutation imports | eager registry | getter registry |
|---|---:|---:|
| the full hotpot graph (62 functions, 14 models) | 85 ms | 53 ms |
| same, through hotpot's system-mutation wrapper | 86 ms | 41 ms |

Node per-module evaluation of the same bundle put the registry at 5.4 ms of 22.4 ms, the
single largest module, dropping to ~0 with getters. Locally, the task-manager example (45
entries) imports its whole registry graph in ~61 ms eager vs ~46 ms with getters under bun,
and one entry then builds in ~0.14 ms on first access.

## Decision

Emit each registry entry as an own, enumerable getter that builds the entry on first access
and memoizes it by key. A small `__memo` / `__lazy` pair is emitted above the registry only
when it has entries. Imports, the `extractCodec(...)` helper consts, the module graph, and
the declared `.d.ts` type are unchanged. This is the default output — no flag — because the
observable contract is the same: the registry is only ever read by key
(`createBoundaryHelpers`, `createCodecCallOverrides`, the pagination codec, the form
resolvers), and enumeration still lists every path.

## Why this over the alternatives

- **Dynamic `import()` per entry or for the registry as a whole.** Rejected: the Convex V8
  runtime has no dynamic `import()` (established during #80), so the registry must stay
  statically reachable. Getters defer construction without touching the module graph.
- **A codec-args-only registry for the server** (#80's `_zodvex/api.args.js`). Not now: it
  needs a second generated file and a `functions.ts` migration, and it would still import
  every codec-bearing model. It remains a valid follow-on if the residual matters; getters
  make it cheaper rather than redundant.
- **Not importing the registry from `functions.ts` at all.** Convex has no per-deployment
  init hook, so something has to import it; the existing thunk already defers the *read*,
  and getters now defer the *construction*. Nothing further is available without a graph
  change.
- **A `Proxy` or function-based lookup.** Would keep laziness but change what consumers
  see (`Object.keys`, property descriptors, the declared `Record` type). Per-entry getters
  keep the object shape and are more granular: a function that calls one other function
  builds one entry.
- **Leaving it eager behind a `--lazy` flag.** No semantic reason to keep two shapes; the
  only behavioral difference is error timing (below) and it favors nobody at deploy time.

## Consequences

- Per-execution server cost of importing the registry drops to its imports only. Client
  bundles pay construction on first use per entry instead of at module evaluation.
- Push-time analysis isolates no longer hold every function's registry schemas, which
  reduces the per-entrypoint memory footprint measured in
  `docs/decisions/2026-04-03-memory-optimization-strategy.md` by the registry's share.
  Not re-measured here; the model graph remains the dominant term.
- **Error timing changes.** An entry whose construction throws (for example a codec import
  that fails when called) now surfaces on that entry's first access rather than at module
  evaluation, so Convex's push analysis will not catch it. Codegen builds every emitted
  schema from a live runtime discovery, and the codegen e2e tests evaluate the generated
  file, so the exposure is limited to consumer-side breakage between generations. A
  `generate`-time self-check that imports the fresh output and enumerates it is the natural
  mitigation if this bites.
- Enumerating the registry (`Object.values`, `Object.entries`, a spread) builds every entry.
  Tooling that does this pays the old cost once, which is fine; server code should not.
- The residual per-call cost in a large app is the registry's *imports*: every model and
  codec module referenced by any function. That is the structural item the
  validator-handler decoupling issue and the descriptor work address; this change does not.

## Verification

- `packages/zodvex/__tests__/codegen-generate.test.ts`: getter shape, empty-registry
  output, and a counting-proxy evaluation of the generated module proving zero construction
  at evaluation, per-entry construction on first access, memoized identity, and full
  enumeration.
- `packages/zodvex/__tests__/codegen-e2e.test.ts`: imports the written `api.js` and checks
  keys, accessor descriptors, and stable identity.
- Both example apps regenerated; `bun run validate:local` green.
- Hosted workload benchmark, eager versus getter registry on the same 32-model graph
  (`examples/stress-test/results/capacity-2026-09-17-lazy-registry/`): 128 eager
  ten-field entries add ~17 ms per call; the getter registry is indistinguishable from
  no registry.
