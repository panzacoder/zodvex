# Dynamic imports fail at runtime in Convex's V8 sandbox

> **Status**: Beta-blocking finding. The deploy ceiling improvements
> documented in `sweep-2026-05-13.md` and the `Unreleased` CHANGELOG
> entry are based on lazy thunks that use dynamic `import()`. Those
> deploys succeed, but **queries and mutations fail at runtime** with
> `dynamic module import unsupported` because Convex's query/mutation
> V8 sandbox forbids dynamic imports.

## What broke

`verify:examples:network` first ran end-to-end on this branch on
2026-05-14. Every example failed its smoke test on the first
mutation with:

```
Uncaught TypeError: dynamic module import unsupported
    at _tableMap (../../convex/_zodvex/server.ts:82:16)
    at resolve (../../../../packages/zodvex/src/internal/customization.ts:40:9)
    at input (../../../../packages/zodvex/src/internal/customization.ts:55:15)
```

The `_tableMap` thunk fires on every query/mutation through the codec
customization layer. Convex's V8 sandbox aborts the call before the
handler body runs.

## Why the deploy passed and the sweep showed N=750 ✓ ok

`finish_push` only typechecks and analyzes. esbuild splits dynamic
`import()` targets into chunks (under `_deps/`); the analyzer doesn't
follow them, so the per-entrypoint isolate stays small. The chunks
are part of the deploy bundle, but they're never *loaded* until a
function call triggers them at runtime — which is when the V8 sandbox
rejects the import.

The N=600/N=750 sweep results in `sweep-2026-05-13.md` measured deploy
success only. No runtime smoke test ran during the sweep. The numbers
do not represent runnable code.

## The runtime-vs-deploy split

| | Deploy analyzer | Convex runtime |
|---|---|---|
| **Q/M handlers** | esbuild + per-entrypoint isolate analysis | **V8 sandbox — no dynamic imports** |
| **Action handlers** | esbuild + per-entrypoint isolate analysis | Node runtime — dynamic imports OK |
| Dynamic `import()` | Splits into `_deps/` chunks. Analyzer doesn't follow. ✓ | Q/M: ✗. Actions: ✓ |
| Static imports | Analyzer evaluates the full graph in one 64 MB isolate | Loaded eagerly with the function bundle |

The two sides have *opposite* incentives:

- **Deploy memory** wants imports to be dynamic so each entrypoint
  isolate stays small.
- **Q/M runtime** requires every dependency to be statically reachable
  so the sandbox can load it.

The deploy-time memory work resolved one OOM (schema-eval) by moving
to pure `defineSchema(tables)` and a second OOM (`_zodvex/api.js` as
its own entrypoint) via the `_zodvex/convex.config.ts` marker. Then
to keep `convex/functions.ts`'s per-entrypoint analyzer from pulling
in every model file (which would recreate the OOM), we made the
runtime tableMap a lazy dynamic `import()`. That is the step that
breaks at runtime.

## Beta.20 is not latently broken

Beta.17–beta.20 introduced a similar dynamic-import lazy thunk, but
*only for the action registry*:

```ts
// beta.20 userland functions.ts
registry: async () => (await import('./_zodvex/api.js')).zodvexRegistry,
```

Actions run in Node. Dynamic imports there work. The pattern is safe
for the action path. Beta.20 doesn't use dynamic imports anywhere in
the Q/M path — `__zodTableMap` is sync (built by `defineZodSchema` at
schema-module load), so codec wrapping resolves without needing a
runtime import.

## What changes for the beta plan

The unreleased branch's claim of "zodvex matches pure-Convex deploy
headroom" needs an asterisk: that's true at deploy time only. At
runtime, the current shape fails on every Q/M call.

Three paths forward:

1. **Revert the tableMap thunk to static imports.** Q/M runtime
   works. Deploy memory regresses to wherever the static-import
   ceiling sits — needs measurement. Keep the registry thunk (it
   only fires in actions, where dynamic imports work).
2. **Move codec wrapping out of Q/M entirely.** Only decode on
   action boundaries / client side. Big API change.
3. **Find a Convex pattern we don't know about.** Component
   isolation, lazy compile, etc. Open question.

(1) is the most likely path. The follow-up branch will:

- Restore static imports for `__zodTableMap` construction (likely
  back into `_zodvex/server.ts` directly, or via a sync re-export
  from `_zodvex/api.js`)
- Keep the registry as a thunk (validated by beta.20's smoke test)
- Re-run `verify:examples:network` end-to-end before any further
  ceiling claims
- Re-run the ceiling sweep against runnable code
- Compare to the prior memory work: with the schema-eval fix
  retained but functions.ts now pulling the model graph statically,
  the ceiling will likely sit between the pre-fix range (N≈155
  default, N≈700 mini+slim) and the (deploy-only) post-fix N≈750.

## Methodology note for the sweep

`sweep.ts` and `regression.ts` only measure deploy outcome. To be
trustworthy as a release gate, they need to also run a smoke
mutation per flavor after each deploy. The
`verify:examples:network` step already does this for the
non-stressed example apps; the stress-test composed apps need an
equivalent.

Files affected:

- `examples/stress-test/realDeploy.ts` — already deploys; add
  smoke-call step
- `examples/stress-test/regression.ts` — gate on smoke pass too
- `examples/stress-test/sweep.ts` — same

This is also necessary work for the revert branch — without runtime
verification, we can't tell a real ceiling from a deploy-only one.
