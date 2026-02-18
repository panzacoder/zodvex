# Hotpot Migration Guide: zodvex v1 -> v2

## Overview

zodvex v2 simplifies the API by:
1. Using convex-helpers' `customCtx` directly (no zodvex wrappers)
2. Moving `onSuccess` before Zod encode (sees runtime types like Date, SensitiveWrapper)
3. Removing DB hooks from zodvex (consumer owns DB middleware via `customCtx`)
4. Fixing the Zod validation gap in `initZodvex` builders

## Migration Table

| v1 Usage | v2 Replacement |
|----------|---------------|
| `zCustomQueryBuilder(query, customization)` | `zCustomQuery(query, customization)` (rename) |
| `zCustomMutationBuilder(mutation, customization)` | `zCustomMutation(mutation, customization)` (rename) |
| `zCustomActionBuilder(action, customization)` | `zCustomAction(action, customization)` (rename) |
| `customCtxWithHooks(fn)` | `customCtx(fn)` from convex-helpers, or raw `{ args, input }` |
| `transforms.output` (audit logging) | `onSuccess` in customization `hooks` |
| `transforms.input` (arg transforms) | Transform args in `customCtx` `input()` |
| `createDatabaseHooks({...})` | Wrap `ctx.db` in `customCtx` (see examples below) |
| `composeHooks([...])` | Compose wrapper functions manually |
| `zCustomCtx(fn)` | `customCtx(fn)` from convex-helpers |
| `zq.withContext(ctx)` | `zCustomQuery(customization)` from `initZodvex` |
| `zq.withContext(ctx).withHooks(hooks)` | `zCustomQuery(customization)` with db wrapping in `customCtx` |

## Before / After Examples

### Blessed Builder with Auth

**Before (v1):**
```typescript
import { zCustomQueryBuilder, customCtxWithHooks } from 'zodvex/server'

const hotpotQuery = zCustomQueryBuilder(
  query,
  customCtxWithHooks(async (ctx: QueryCtx) => {
    const user = await getUser(ctx)
    return {
      ctx: { user },
      hooks: { onSuccess: ({ result }) => auditLog(result, user) },
      transforms: { output: (result) => sanitizeForAudit(result) }
    }
  })
)
```

**After (v2):**
```typescript
import { customCtx } from 'convex-helpers/server/customFunctions'

// Option A: via initZodvex (recommended — codec-aware ctx.db)
const { zCustomQuery } = initZodvex(schema, server)
const hotpotQuery = zCustomQuery({
  args: {},
  input: async (ctx) => {
    const user = await getUser(ctx)
    return {
      ctx: { user },
      args: {},
      hooks: {
        onSuccess: ({ result }) => {
          // result contains Date instances, SensitiveWrapper, etc.
          auditLog(result, user)
        }
      }
    }
  }
})

// Option B: standalone (no codec db wrapping)
import { zCustomQuery } from 'zodvex/server'
const hotpotQuery = zCustomQuery(
  query,
  customCtx(async (ctx) => {
    const user = await getUser(ctx)
    return { user }
  })
)
```

### DB Security Wrapping

**Before (v1):**
```typescript
const hooks = createDatabaseHooks({
  decode: {
    before: {
      one: async (ctx, wireDoc) => {
        if (!checkRLS(wireDoc, ctx.user)) return null
        return wireDoc
      }
    }
  }
})
const secureQuery = zq.withContext(authCtx).withHooks(hooks)
```

**After (v2):**
```typescript
const { zCustomQuery } = initZodvex(schema, server)
const secureQuery = zCustomQuery({
  args: {},
  input: async (ctx) => {
    const user = await getUser(ctx)
    // ctx.db is already codec-aware (returns Date, SensitiveWrapper, etc.)
    const secureDb = createSecureReader({ user }, ctx.db, securityRules)
    return { ctx: { user, db: secureDb }, args: {} }
  }
})
```

### SensitiveField in onSuccess

**Before (v1):**
```typescript
transforms: {
  output: (result, schema) => {
    // Had to use transforms.output because onSuccess ran AFTER encode
    const sensitive = findSensitiveFields(result)
    logSensitiveAccess(sensitive)
    return result
  }
}
```

**After (v2):**
```typescript
hooks: {
  onSuccess: ({ result }) => {
    // result.email is a SensitiveWrapper instance (runtime type)
    if (result.email instanceof SensitiveWrapper) {
      logSensitiveAccess(result.email.field, result.email.status)
    }
  }
}
```

## Key Behavioral Changes

1. **`onSuccess` timing:** Now runs BEFORE Zod encode. `result` contains runtime types (Date, SensitiveWrapper).
2. **`ctx.db` in customCtx:** Already codec-aware when using `initZodvex`. Reads return Date, SensitiveWrapper, etc.
3. **No hooks API:** Write wrapper functions around `ctx.db` for security filtering.
4. **Zod validation works:** `initZodvex` builders now validate args and encode returns correctly.
5. **Codec db preservation:** When using `initZodvex`'s `zCustomQuery`/`zCustomMutation`, the codec-wrapped `ctx.db` is automatically preserved even if your customization doesn't explicitly return it.

## Important: `onSuccess` with `customCtx`

`customCtx` from convex-helpers does NOT support `hooks` or `onSuccess`. If you need `onSuccess`, use a raw customization object:

```typescript
// This DOES NOT work — onSuccess ends up in ctx, not as a hook:
zCustomQuery(customCtx(async (ctx) => ({
  user,
  onSuccess: ({ result }) => { ... }  // This goes into ctx.user, not hooks!
})))

// This WORKS — raw customization with hooks:
zCustomQuery({
  args: {},
  input: async (ctx) => ({
    ctx: { user },
    args: {},
    hooks: {
      onSuccess: ({ result }) => { ... }  // Correctly registered as a hook
    }
  })
})
```
