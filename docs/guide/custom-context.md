# Custom Context Builders

Add auth, permissions, or other context to all your Zod-validated functions using builder patterns.

> **Best Practice:** Always add explicit type annotations to the `ctx` parameter in your `customCtx` functions. This improves TypeScript performance and prevents `ctx` from falling back to `any` in complex type scenarios. Import context types from `./_generated/server` (e.g., `QueryCtx`, `MutationCtx`, `ActionCtx`).

## Recommended: `.withContext()` (v0.6+)

When using `initZodvex`, the returned builders (`zq`, `zm`, `za`) expose a `.withContext()` method for composing custom context:

```ts
import { customCtx } from 'zodvex'
import { type QueryCtx, type MutationCtx } from './_generated/server'

// Add user to all queries
export const authedQuery = zq.withContext(
  customCtx(async (ctx: QueryCtx) => {
    const user = await getUserOrThrow(ctx)
    return { user }
  })
)

// Add user + permissions to mutations
export const authedMutation = zm.withContext(
  customCtx(async (ctx: MutationCtx) => {
    const user = await getUserOrThrow(ctx)
    const permissions = await getPermissions(ctx, user)
    return { user, permissions }
  })
)

// Use them
export const updateProfile = authedMutation({
  args: { name: z.string() },
  returns: z.null(),
  handler: async (ctx, { name }) => {
    // ctx.user and ctx.permissions are available
    if (!ctx.permissions.canEdit) {
      throw new Error('No permission')
    }
    await ctx.db.patch(ctx.user._id, { name })
    return null
  }
})
```

## Legacy: `zCustomQueryBuilder` / `zCustomMutationBuilder`

For projects not using `initZodvex`, the standalone builders remain available:

```ts
import { zCustomQueryBuilder, zCustomMutationBuilder, customCtx } from 'zodvex'
import { type QueryCtx, type MutationCtx, query, mutation } from './_generated/server'

// Add user to all queries
export const authQuery = zCustomQueryBuilder(
  query,
  customCtx(async (ctx: QueryCtx) => {
    const user = await getUserOrThrow(ctx)
    return { user }
  })
)

// Add user + permissions to mutations
export const authMutation = zCustomMutationBuilder(
  mutation,
  customCtx(async (ctx: MutationCtx) => {
    const user = await getUserOrThrow(ctx)
    const permissions = await getPermissions(ctx, user)
    return { user, permissions }
  })
)

// Use them
export const updateProfile = authMutation({
  args: { name: z.string() },
  returns: z.null(),
  handler: async (ctx, { name }) => {
    // ctx.user and ctx.permissions are available
    if (!ctx.permissions.canEdit) {
      throw new Error('No permission')
    }
    await ctx.db.patch(ctx.user._id, { name })
    return null
  }
})
```

## onSuccess Hook

The `onSuccess` callback follows convex-helpers' `Customization` convention and is the only hook point zodvex exposes. Return it from your customization's `input` function:

```ts
import { zCustomMutationBuilder } from 'zodvex'
import { type MutationCtx, mutation } from './_generated/server'

export const secureMutation = zCustomMutationBuilder(mutation, {
  args: {},
  input: async (ctx: MutationCtx) => {
    const securityCtx = await getSecurityContext(ctx)
    return {
      ctx: { securityCtx },
      args: {},
      onSuccess: ({ ctx, args, result }) => {
        console.log('Mutation succeeded:', { args, result })
      }
    }
  }
})
```

`onSuccess` runs after the handler and Zod return validation, seeing runtime types (e.g., `Date`, not timestamps).
