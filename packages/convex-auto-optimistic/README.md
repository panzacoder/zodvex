# convex-auto-optimistic

Automatic optimistic updates for Convex mutations — driven by the table-dependency graph produced by [`convex-table-graph`](../convex-table-graph).

**Status:** Work in progress. Not published. Validated end-to-end against `examples/task-manager` (real Convex dev deployment — see `examples/task-manager/test/optimistic-smoke.ts` and the wired UI in `examples/task-manager/src/App.tsx`).

## The pain point

Convex's [`withOptimisticUpdate`](https://docs.convex.dev/client/react/optimistic-updates) requires developers to manually enumerate every query a mutation affects:

```ts
const createTask = useMutation(api.tasks.create).withOptimisticUpdate(
  (localStore, args) => {
    // Developer must list every query that might show this data:
    const list = localStore.getQuery(api.tasks.list, {})
    if (list) localStore.setQuery(api.tasks.list, {}, [...list, tempTask])

    const byStatus = localStore.getQuery(api.tasks.byStatus, { status: 'todo' })
    if (byStatus) localStore.setQuery(api.tasks.byStatus, { status: 'todo' }, [...byStatus, tempTask])

    // ...and any that you forget stays stale until the subscription update arrives
  }
)
```

This is the only Convex API that asks you to reason about the reactive graph explicitly — and it directly contradicts Convex's "realtime just works" philosophy for queries and subscriptions.

## The fix

`convex-auto-optimistic` uses the static table-dependency graph to figure out which queries are affected by which mutations. You describe the mutation's effect once; the helper applies it to every matching cached query.

## Integration steps (as done in examples/task-manager)

1. **Generate the graph.** Add a `convex-table-graph.config.json` next to your app registering any wrapper builders, then add a script:

   ```jsonc
   // convex-table-graph.config.json — zodvex example
   {
     "builders": {
       "query": ["zq"], "mutation": ["zm", "auditedMutation"], "action": ["za"],
       "internalQuery": ["ziq"], "internalMutation": ["zim"], "internalAction": ["zia"]
     },
     "dbFactories": ["zodvexStream"]
   }
   ```

   ```jsonc
   // package.json
   "generate:graph": "convex-table-graph ./convex -o src/table-graph.generated.ts -f ts"
   ```

   Re-run it whenever your Convex functions change (put it next to `convex codegen` in your pipeline).

2. **Create the hooks** once at module level:

   ```ts
   import { createAutoOptimistic } from 'convex-auto-optimistic/react'
   import { api } from '../convex/_generated/api'
   import { tableGraph } from './table-graph.generated'

   const { useAutoMutation } = createAutoOptimistic({ graph: tableGraph, api })
   ```

3. **Wire mutations** with a prediction per mutation:

   ```ts
   // Insert — `at: 'start'` because tasks:list is ordered desc
   const createTask = useAutoMutation(api.tasks.create, (args) => ({
     kind: 'insert',
     at: 'start',
     doc: { ...args, _id: `optimistic:${Date.now()}`, _creationTime: Date.now() }
   }))

   // Patch
   const completeTask = useAutoMutation(api.tasks.complete, (args) => ({
     kind: 'patch',
     id: args.id,
     changes: { status: 'done' }
   }))

   // Delete
   const deleteTask = useAutoMutation(api.tasks.remove, (args) => ({
     kind: 'delete',
     id: args.id
   }))
   ```

The helper automatically patches every query the graph says reads a table this mutation writes. No enumeration, no drift.

## The codec contract (zodvex and friends)

**Convex's optimistic local store holds wire-shaped (Convex JSON) values** — whatever your queries return over the wire, before any client-side codec decode. Predictions patch store contents, so **predictions must be authored in wire shape**.

If your app has a codec layer (e.g. zodvex: `Date` ⇄ timestamp, `{hours, minutes}` ⇄ minutes), pass its boundary helpers to the factory:

```ts
import { encodeArgs, decodeResult } from '../convex/_zodvex/client'

const { useAutoMutation } = createAutoOptimistic({
  graph: tableGraph,
  api,
  encodeArgs,   // runtime args -> wire args, applied once before send AND before predict()
  decodeResult  // wire result -> runtime result
})
```

The flow is: call site passes **runtime-shaped** args → `encodeArgs` runs once → the **wire-shaped** args go to both the network call and your `predict` function. So inside `predict`, `args` is already wire-shaped and can be spread straight into a predicted doc. Without `encodeArgs`, args pass through untouched (correct for codec-free apps).

## How prediction maps to query results

The prediction describes what the mutation is expected to do. The helper applies it to each affected query result based on its shape:

| Query result shape                     | Insert                                      | Patch                          | Delete                          |
| -------------------------------------- | ------------------------------------------- | ------------------------------ | ------------------------------- |
| `Document[]` (list)                    | Append, or prepend with `at: 'start'` (dedup on `_id`) | Replace matching `_id`         | Filter out matching `_id`       |
| `Document \| null` (first/unique/get)  | Replace `null` with doc                     | Replace if `_id` matches       | Replace with `null` if match    |
| `{ page, isDone, continueCursor }`     | Requires `at` hint (see below); skipped otherwise | Operate on `page` array        | Operate on `page` array         |
| Other shapes                           | Skip                                        | Skip                           | Skip                            |

### Paginated inserts and the `at` hint

An insert prediction can carry `at: 'start' | 'end'` describing where the doc lands in ordered results:

- `at: 'start'` — prepend. For paginated queries, applies **only to the first page**: the cached entry whose `paginationOpts.cursor` is `null` (Convex requires the pagination argument to be named `paginationOpts`, so this is detectable). Use for `desc`-ordered lists where new docs appear on top.
- `at: 'end'` — append. For paginated queries, applies only to the final page (`isDone: true`).
- omitted — plain arrays append; paginated results are skipped, because without ordering information a misplaced insert is worse than a ~100ms delay.

The hint is per-*mutation*, but it applies to every affected query. If one mutation feeds queries with conflicting orderings, the hint will misplace the doc in some of them until the server confirms (subscription corrects it). That's inherent to table-level granularity — see "Caveats".

For filtered queries (e.g. `tasks:byStatus({ status: 'todo' })`), the naive insert may include docs that don't match the filter — the subscription update will correct this within ~100ms. If this matters for your UI, use Convex's native `withOptimisticUpdate` for that specific mutation.

## Entrypoints

- **`convex-auto-optimistic`** — framework-agnostic core: `applyPrediction`, `applyPredictionToStore`, graph lookup helpers. No React dependency.
- **`convex-auto-optimistic/react`** — `createAutoOptimistic` factory and `useAutoMutation` hook built on `convex/react`.

The split lets you build custom wrappers (Vue, Solid, vanilla client) without pulling in React.

## Diagnostics

The helper emits diagnostics when something can't be resolved — e.g. a query path in the graph doesn't exist in the `api` object, or a cached query result is an unexpected shape. Default handler logs to `console.warn` in non-production builds. Override via `onDiagnostic` in the factory config:

```ts
createAutoOptimistic({
  graph,
  api,
  onDiagnostic: (d) => reportToTelemetry(d)
})
```

## Caveats

1. **Filtered queries** — optimistic state may briefly include docs that don't match a filter. Gets corrected on server confirmation.
2. **Complex return shapes** — if your query returns a custom shape (not `Document[]`, `Document | null`, or paginated), the helper can't patch it. Use native `withOptimisticUpdate` for those.
3. **Conflicting mutations** — if two optimistic updates fire before either confirms, they stack in order. Rollback behavior matches Convex's native semantics.
4. **Stale graph** — if you regenerate your code without regenerating the graph, new functions are invisible to the helper. Run `convex-table-graph` in your build pipeline.
5. **One `at` hint for all affected queries** — insert placement is declared per mutation but applied per query; queries with different orderings than the hint assumes show the doc in the wrong position until the subscription corrects it.
6. **Predictions are wire-shaped** — see "The codec contract" above. Authoring predictions in runtime shape (e.g. a `Date` in a doc field) silently produces store values your components won't expect.
