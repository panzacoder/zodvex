# Working with Large Schemas

zodvex provides `pickShape` and `safePick` helpers as alternatives to Zod's `.pick()` when dealing with schemas that have many fields.

```ts
import { pickShape, safePick } from 'zodvex'

// Standard Zod .pick() works great for most schemas
const UserUpdate = User.pick({ email: true, firstName: true, lastName: true })

// If you hit TypeScript instantiation depth limits (rare, 100+ fields),
// use pickShape or safePick:
const userShape = pickShape(User, ['email', 'firstName', 'lastName'])
const UserUpdate = z.object(userShape)

// Or use safePick (convenience wrapper that does the same thing)
const UserUpdate = safePick(User, {
  email: true,
  firstName: true,
  lastName: true
})
```

These helpers extract the raw shape object rather than operating through Zod's `.pick()` method, which avoids the deep recursive type instantiation that causes slowdowns at 100+ fields.

## Staged indexes

Adding an index to a large table backfills it synchronously during `convex deploy`. On a
table with enough documents that push can run past your deploy timeout and fail, leaving you
stuck: the index is not applied, so the next deploy tries the same backfill again.

Pass `{ staged: true }` and Convex backfills in the background instead — the push does not
block on it:

```ts
import { defineZodModel } from 'zodvex'

export const Events = defineZodModel('events', {
  channel: z.string(),
  payload: z.string()
})
  .index('byChannel', ['channel'], { staged: true })
```

Convex's own object form works too, if you prefer to mirror `defineTable`:

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
