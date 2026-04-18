# convex-auto-optimistic

Automatic optimistic updates for Convex mutations — driven by the table-dependency graph produced by [`convex-table-graph`](../convex-table-graph).

**Status:** Work in progress. Not published.

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

```ts
import { createAutoOptimistic } from 'convex-auto-optimistic/react'
import { tableGraph } from './convex-table-graph.generated'
import { api } from './convex/_generated/api'

const { useAutoMutation } = createAutoOptimistic({ graph: tableGraph, api })

// Insert
const createTask = useAutoMutation(api.tasks.create, (args) => ({
  kind: 'insert',
  doc: { ...args, _id: crypto.randomUUID(), _creationTime: Date.now() }
}))

// Patch
const updateTask = useAutoMutation(api.tasks.update, (args) => ({
  kind: 'patch',
  id: args.taskId,
  changes: { status: args.status }
}))

// Delete
const archiveTask = useAutoMutation(api.tasks.archive, (args) => ({
  kind: 'delete',
  id: args.taskId
}))
```

The helper automatically invalidates every query the graph says reads a table this mutation writes. No enumeration, no drift.

## How prediction maps to query results

The prediction describes what the mutation is expected to do. The helper applies it to each affected query result based on its shape:

| Query result shape                     | Insert                         | Patch                          | Delete                          |
| -------------------------------------- | ------------------------------ | ------------------------------ | ------------------------------- |
| `Document[]` (list)                    | Append (dedup on `_id`)        | Replace matching `_id`         | Filter out matching `_id`       |
| `Document \| null` (first/unique/get)  | Replace `null` with doc        | Replace if `_id` matches       | Replace with `null` if match    |
| `{ page, isDone, continueCursor }`     | Skip (filter semantics unknown) | Operate on `page` array        | Operate on `page` array         |
| Other shapes                           | Skip (emit diagnostic)         | Skip                           | Skip                            |

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
