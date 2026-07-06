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

## Deprecated: individual builders

`zQueryBuilder` / `zMutationBuilder` / `zActionBuilder` (and the `zCustom*Builder` variants) still work but are deprecated, migration-only APIs — new projects should use `initZodvex`. See the [migration guide](../../MIGRATION.md) for the renames.
