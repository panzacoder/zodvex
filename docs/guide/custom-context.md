# Custom Context Builders

Add auth, permissions, or other context to all your Zod-validated functions using builder patterns.

> **Best Practice:** Always add explicit type annotations to the `ctx` parameter in your `customCtx` functions. This improves TypeScript performance and prevents `ctx` from falling back to `any` in complex type scenarios. Import context types from `./_generated/server` (e.g., `QueryCtx`, `MutationCtx`, `ActionCtx`).

## Recommended: `.withContext()` (v0.6+)

When using `initZodvex`, the returned builders (`zq`, `zm`, `za`) expose a `.withContext()` method for composing custom context:

```ts
import { customCtx } from 'zodvex/server'
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

## Shared customizations across builders (`defineContext`)

Public and internal builders of the same kind share the **same input ctx** — `zm`/`zim`, `za`/`zia`, and `zq`/`ziq` differ only in function visibility. A common pattern is to author **one** customization and apply it to both, so the public and internal variants can't drift:

```ts
import { defineContext } from 'zodvex/server'

const authed = defineContext(zm, {
  args: {},
  input: async (ctx, _args, extra?: { required?: Entitlement[] }) => {
    const identity = await resolveIdentity(ctx) // ctx is fully typed — no annotation
    return { ctx: { ...ctx, identity }, args: {} }
  },
})

export const appMutation         = zm.withContext(authed)
export const appInternalMutation = zim.withContext(authed)
```

### Why `defineContext` (not a bare object or a type annotation)

Inline customizations (`zm.withContext({ … })`) get **contextual typing** — `input`'s `ctx`/`args` are inferred with no annotations. But a **standalone** customization object (extracted so two builders can share it) has no contextual type, so under `noImplicitAny` you'd be forced to hand-annotate `input`'s parameters — and those hand annotations drift from zodvex's internal types (the cause of the 0.7.3→0.7.4 break).

`defineContext(builder, customization)` solves this. It is an **identity function at runtime** (it returns the customization unchanged); its only job is to be a type inference site:

- The `builder` argument **pins the input ctx**, so `input`'s `ctx` and `args` are inferred — zero annotations.
- The output generics (the ctx your `input` adds, the `extra` shape, any `onSuccess`) are **inferred from your `input`'s return**, so handlers downstream still see the precise merged ctx.

Pass either builder of the pair (`zm` or `zim`) — the result is identical and carries no visibility, so both `.withContext()` calls accept it.

### `ZodvexCustomizationFor<typeof builder>` (type-only alternative)

If you'd rather annotate than wrap, `ZodvexCustomizationFor` is the matching type:

```ts
import type { ZodvexCustomizationFor } from 'zodvex/server'

const authed: ZodvexCustomizationFor<typeof zm> = {
  args: {},
  input: async (ctx, _args) => ({ ctx, args: {} }), // ctx/args contextually typed
}
```

It pins the input ctx (so `input` needs no annotations), but a **type annotation cannot infer the output generics from your value** — `CustomCtx` and friends fall back to permissive types. So if your `input` adds ctx fields the handler reads (e.g. `ctx.identity`), prefer `defineContext`, which infers them. Use `ZodvexCustomizationFor` for customizations that add no ctx, or that re-type what they add explicitly.

> **Empty-args note (v0.7.4):** with `args: {}` (or no `args`), `input`'s args parameter types as `Record<string, never>`. v0.7.3 widened it to `{ [x: string]: unknown }`, which broke standalone customizations whose `input` params were hand-annotated `Record<string, never>`. v0.7.4 fixes that resolution whether or not you adopt `defineContext`.

## Legacy: `zCustomQueryBuilder` / `zCustomMutationBuilder`

For projects not using `initZodvex`, the standalone builders remain available:

```ts
import { zCustomQueryBuilder, zCustomMutationBuilder, customCtx } from 'zodvex/server'
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
import { zCustomMutationBuilder } from 'zodvex/server'
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
