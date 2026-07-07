# Builders

Builders are the primary way to create type-safe Convex functions with Zod validation. See the [README](../../README.md) for a full overview of zodvex.

## Recommended: `initZodvex` (v0.6+)

`initZodvex` is the recommended API for setting up builders. It takes your schema and the Convex server primitives, and returns pre-configured builders for all function types.

```typescript
// convex/util.ts
import { query, mutation, action, internalQuery, internalMutation, internalAction } from './_generated/server'
import { initZodvex } from 'zodvex/server'
import schema from './schema'

export const { zq, zm, za, ziq, zim, zia } = initZodvex(schema, {
  query,
  mutation,
  action,
  internalQuery,
  internalMutation,
  internalAction
})
```

The returned builders:

| Builder | Purpose |
|---------|---------|
| `zq` | Public queries |
| `zm` | Public mutations |
| `za` | Public actions |
| `ziq` | Internal queries |
| `zim` | Internal mutations |
| `zia` | Internal actions |

### Using the builders

```typescript
// convex/users.ts
import { z } from 'zod'
import { zx } from 'zodvex'
import { zq, zm } from './util'
import { UserModel } from './models/user'

export const getUser = zq({
  args: { id: zx.id('users') },
  returns: zx.doc(UserModel).nullable(),
  handler: async (ctx, { id }) => {
    return await ctx.db.get(id)
  }
})

export const createUser = zm({
  args: UserModel.fields,
  returns: zx.id('users'),
  handler: async (ctx, user) => {
    return await ctx.db.insert('users', user)
  }
})
```

### Custom context with `zq.withContext()`

Add auth or other context to your builders using `.withContext()`:

```typescript
import { type QueryCtx } from './_generated/server'
import { customCtx } from 'zodvex/server'
import { zq, zm } from './util'

export const authQuery = zq.withContext(
  customCtx(async (ctx: QueryCtx) => {
    const user = await getUserOrThrow(ctx)
    return { user }
  })
)

export const getMyProfile = authQuery({
  args: {},
  returns: zx.doc(UserModel).nullable(),
  handler: async (ctx) => {
    // ctx.user is available
    return ctx.db.get(ctx.user._id)
  }
})
```

> **Best Practice:** Always add explicit type annotations to the `ctx` parameter in your context functions. This improves TypeScript performance and prevents `ctx` from falling back to `any` in complex type scenarios. Import context types from `./_generated/server` (e.g., `QueryCtx`, `MutationCtx`, `ActionCtx`).

For `onSuccess` hooks and other customization patterns, see [Custom Context](./custom-context.md).

### Composing with convex-helpers triggers (`underlyingDb`)

Libraries like [`convex-helpers/server/triggers`](https://github.com/get-convex/convex-helpers#triggers) work by wrapping `ctx.db` — the same slot zodvex's codec wrapper occupies. The `underlyingDb` option lets them compose: zodvex's codec wrapper delegates to a db you resolve from the raw ctx, so the trigger layer sits **under** the codec layer.

```typescript
import { Triggers } from 'convex-helpers/server/triggers'
import type { DataModel } from './_generated/dataModel'

const triggers = new Triggers<DataModel>()
triggers.register('tasks', async (ctx, change) => {
  // change.newDoc / change.oldDoc are wire-format documents (native shape) —
  // codec fields are already encoded (e.g. zx.date() → number).
  // ctx.innerDb is the raw Convex writer.
})

export const { zq, zm, za, ziq, zim, zia } = initZodvex(schema, server, {
  underlyingDb: {
    mutation: (ctx) => triggers.wrapDB(ctx).db,
    // query?: (ctx) => ...  — same hook for readers (e.g. RLS layers)
  },
})
```

The resulting stack is `codec (zodvex) → triggers (convex-helpers) → real db`: handlers keep working with decoded values (`Date`, typed IDs), zodvex encodes at the write boundary, and the trigger layer observes exactly the native wire-format writes it was written against. This is what enables the aggregate component's table-trigger mode (auto-maintained counts) under zodvex mutations. `.withRules()` and `.audit()` keep working on top of the composed stack.

Two related escape hatches:

- `ctx.db.unwrap()` returns the database the codec wrapper delegates to (the trigger-wrapped writer above, or the bare Convex db when `underlyingDb` isn't set). It bypasses codec, rules, and audit — reads are undecoded and writes must be wire-format.
- `createZodvexCustomization(tableMap, { underlyingDb })` accepts the same option for manual composition.

Design notes: [docs/decisions/2026-07-07-db-wrap-compose-not-absorb.md](../decisions/2026-07-07-db-wrap-compose-not-absorb.md). Working example: [examples/task-manager/convex/triggersCompose.ts](../../examples/task-manager/convex/triggersCompose.ts).

## Deprecated: individual builders

`zQueryBuilder` / `zMutationBuilder` / `zActionBuilder` (and the `zCustom*Builder` variants) still work but are deprecated, migration-only APIs — new projects should use `initZodvex`. See the [migration guide](../../MIGRATION.md) for the renames.
