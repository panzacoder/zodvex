# Staged Indexes

Adding an index to a large table backfills it synchronously during `convex deploy`. On a
table with enough documents that push can run past your deploy timeout and fail, leaving you
stuck: the index is not applied, so the next deploy tries the same backfill again.

Pass `{ staged: true }` and Convex backfills in the background instead — the push does not
block on it:

```ts
import { z } from 'zod'
import { defineZodModel } from 'zodvex'

export const Events = defineZodModel('events', {
  channel: z.string(),
  payload: z.string()
})
  .index('byChannel', ['channel'], { staged: true })
```

The three-argument form above is zodvex's own. Convex's builder only has the object form, which
zodvex also accepts if you would rather mirror `defineTable`:

```ts
.index('byChannel', { fields: ['channel'], staged: true })
```

`searchIndex` and `vectorIndex` take the flag in their config object:

```ts
export const Docs = defineZodModel('docs', {
  body: z.string(),
  embedding: z.array(z.number())
})
  .searchIndex('searchBody', { searchField: 'body', staged: true })
  .vectorIndex('vecEmbedding', { vectorField: 'embedding', dimensions: 1536, staged: true })
```

## Making the index real

A staged index is not queryable, so zodvex keeps it out of the typed index names. Dropping
the flag is what makes it real — that is the second deploy of the two-deploy flow:

```ts
// Deploy 1: staged, push succeeds immediately, backfill runs in the background.
// Deploy 2 (once the backfill has finished): drop `staged` to enable the index.
export const Events = defineZodModel('events', {
  channel: z.string(),
  payload: z.string()
}).index('byChannel', ['channel'])
```

Until then, `withIndex('byChannel')` is a type error — the same guarantee Convex gives for
its own staged indexes. Staged declarations are readable on the model as
`model.stagedIndexes`, `model.stagedSearchIndexes`, and `model.stagedVectorIndexes`;
`model.indexes` and friends only ever hold what you can query today.

## Notes

- `staged` must be a literal, exactly as in Convex. A hoisted object widens to `boolean`, which
  matches neither overload, so write `{ staged: true } as const`.
- Available on full-Zod and `zod/mini` models, and on slim models (`schemaHelpers: false`).
- Re-declaring a name replaces the earlier entry. Declaring one name both staged and live
  leaves it in both records, the same as Convex's builder, and `convex deploy` rejects it.
