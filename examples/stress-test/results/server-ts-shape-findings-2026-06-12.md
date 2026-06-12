# Post-0.7.5 rebase: sweep parity + the consolidated server.ts does NOT scale

Date: 2026-06-12. Context: `perf/codegen-overhaul` (squash-port of
`feat/zodvex-codegen-overhaul` onto main/0.7.5). Deployment:
`dev:first-skunk-786` (panzacoder / zodvex-stress-test).

## 1. Ceiling sweep re-run — harness shape unchanged

`bun run sweep -- --ns=200,600,750,800 --flavors=zodvex,zodvex-mini --continue`
(results: `sweep-static-registry-2026-06-12.json`)

| flavor | 200 | 600 | 750 | 800 |
|---|---|---|---|---|
| zodvex | ok | ok | ok | too-many-reads |
| zodvex-mini | ok | ok | ok | too-many-reads |

Cell-for-cell identical to `sweep-2026-05-19.json` (outcomes, schema heap to
the hundredth of a MB). The schema-thin fix (`_zodvex/tables.ts`) survives the
0.7.5 rebase intact.

**However:** the harness's composed `functions.ts` is
`initZodvex(schema, server, { wrapDb: false })` with a stub tableMap and NO
registry — it never imports `_zodvex/server.ts`. These ceilings validate the
schema-eval fix only. They say nothing about the consolidated consumer shape.

## 2. The consolidated `_zodvex/server.ts` shape OOMs at N=200 (real deploy)

Rewrote the composed tree's `functions.ts` to the branch-documented shape
(`import { initZodvex } from './_zodvex/server'`) and real-deployed at N=200:

```
deploy outcome: oom — "JavaScript execution ran out of memory" (start_push)
```

Per-endpoint heap decomposition (heap proxy, full zod, N=200, sample=10;
baseline = harness shape at 2.4 MB):

| variant | per-endpoint heap (p50) |
|---|---|
| harness shape (no server.ts) | 2.4 MB |
| + `../schema.js` import only | 4.7 MB |
| + 200 static model imports, EMPTY tableMap | **59.1 MB** |
| + eager `zx.doc()/zx.base()` tableMap entries | 59.4 MB |
| + static args-only registry (`api.args.js`) | 84.4 MB |

The dominant cost is **importing all model modules** (each evaluates its zod
field objects at module init) — not the `zx.doc()` calls and not the registry.
Lazy-getter tableMaps or slimmer registries cannot fix this; any `server.ts`
that statically imports every model is over the 64 MB analyzer budget by
N≈150–200 for full zod.

The May sweeps never caught this because the harness shape bypasses
`server.ts` entirely. `17c53eb` ("static tableMap — Q/M runtime now works")
fixed runtime *correctness* at small N; the *memory* cost of the static model
graph was never deploy-priced.

## 3. Registry split (implemented on this branch)

Independent of #2, the registry itself is now split per runtime constraint:

- **Actions** (Node): lazy full registry via `import('./api.js')` — the
  returns/model-doc graph never enters static bundles
  (see `archive/lazy-registry-2026-05-12.md`: static full registry alone was
  57.4 MB/endpoint at N=200).
- **Mutations** (Q/M V8, no dynamic import): static args-only
  `api.args.js` (no `returns` schemas), consumed by the scheduler
  `runAfter`/`runAt` encoding path that 0.7.5 added. Library option:
  `schedulerRegistry`.

This is the right shape for the registry — but per #2 the consolidated
`server.ts` remains analyzer-bound on its model imports regardless.

## Implications

- The consolidated `server.ts` is fine (and great DX) for small/medium apps
  — hotpot-scale (tens of functions) has huge headroom.
- For large apps, the codec **DB-wrapping** story needs a design that avoids
  importing all models from one module every endpoint touches. Candidate:
  models self-register their table schemas into a module-global on import
  ("invisible registry" pattern from `archive/invisible-registry-2026-05-12.md`)
  so each endpoint pays only for the models it already imports. Not designed
  or built yet.
- Either way, the README/docs should not claim the consolidated shape matches
  pure-Convex headroom — that claim holds only for the schema-eval isolate
  (tables.ts) and the wrapDb-less function shape.
