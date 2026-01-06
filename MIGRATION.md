# Migration Guide

This guide helps you upgrade between zodvex versions with breaking changes.

## Table of Contents

- [Upgrading to v0.3.0](#upgrading-to-v030)
  - [zid() Implementation Change](#zid-implementation-change)
  - [zCrud Removal](#zcrud-removal)
  - [skipConvexValidation Behavior Change](#skipconvexvalidation-behavior-change)

---

## Upgrading to v0.3.0

### zid() Implementation Change

**What changed:**

`zid()` no longer uses Zod's `.transform()` or `.brand()` methods. It now uses type-level branding via TypeScript type assertions instead of runtime transforms.

**Why:**

This change makes `zid` compatible with Vercel's AI SDK and other tools that require serializable schemas (schemas that can be converted to JSON Schema without runtime transforms).

**Impact:**

For **99.9% of users**, this is a non-breaking change. The runtime behavior is identical:

```ts
// Before and after - works the same
const userId = zid('users')
userId.parse('abc123') // Returns 'abc123' typed as GenericId<'users'>
```

**Who might be affected:**

- Code that introspects the Zod schema structure directly
- Type guards that check for `.brand()` presence
- Tests that assert on the internal schema representation

**Migration:**

If you were checking for the brand in type guards:

```ts
// Before (no longer works)
if ('_def' in schema && schema._def.typeName === 'ZodBranded') {
  // Handle branded type
}

// After
if ('_tableName' in schema) {
  // It's a zid schema
  const tableName = schema._tableName
}
```

If you were relying on JSON Schema output, note that `zid` now produces a simpler string schema with a description:

```ts
import { zodToJsonSchema } from 'zod-to-json-schema'

const schema = z.object({ userId: zid('users') })
const jsonSchema = zodToJsonSchema(schema)
// { type: 'object', properties: { userId: { type: 'string', description: 'convexId:users' } } }
```

---

### zCrud Removal

**What changed:**

The `zCrud` function has been removed from zodvex.

**Why:**

Following Convex's guidance, we recommend writing explicit functions over generic CRUD patterns. Explicit functions provide:

- Better security (fine-grained access control)
- Clearer API contracts
- Easier debugging and testing
- More flexibility for business logic

**Migration:**

Replace `zCrud` with explicit query and mutation functions:

```ts
// Before
export const users = zCrud('users', UserSchema)
// Provided: users.get, users.list, users.create, users.update, users.delete

// After - write explicit functions
import { zq, zm } from './util'
import { Users } from './tables/users'
import { zid } from 'zodvex'

export const getUser = zq({
  args: { id: zid('users') },
  returns: Users.zDoc.nullable(),
  handler: async (ctx, { id }) => ctx.db.get(id)
})

export const listUsers = zq({
  args: {},
  returns: Users.docArray,
  handler: async (ctx) => ctx.db.query('users').collect()
})

export const createUser = zm({
  args: Users.shape,
  returns: zid('users'),
  handler: async (ctx, user) => ctx.db.insert('users', user)
})

export const updateUser = zm({
  args: {
    id: zid('users'),
    ...Users.shape  // or pick specific fields
  },
  returns: z.null(),
  handler: async (ctx, { id, ...fields }) => {
    await ctx.db.patch(id, fields)
    return null
  }
})

export const deleteUser = zm({
  args: { id: zid('users') },
  returns: z.null(),
  handler: async (ctx, { id }) => {
    await ctx.db.delete(id)
    return null
  }
})
```

**Benefits of explicit functions:**

```ts
// Add authorization
export const deleteUser = authMutation({
  args: { id: zid('users') },
  handler: async (ctx, { id }) => {
    // Only admins can delete
    if (!ctx.user.isAdmin) throw new Error('Unauthorized')
    await ctx.db.delete(id)
  }
})

// Add business logic
export const createUser = zm({
  args: Users.shape,
  handler: async (ctx, user) => {
    // Check for duplicate email
    const existing = await ctx.db
      .query('users')
      .withIndex('by_email', q => q.eq('email', user.email))
      .first()
    if (existing) throw new Error('Email already exists')

    return ctx.db.insert('users', user)
  }
})
```

---

### skipConvexValidation Behavior Change

**What changed:**

When using `skipConvexValidation: true` in custom function builders, Zod validation is now **always** run on both args and returns.

Previously, `skipConvexValidation: true` would skip both Convex and Zod validation. Now it only skips Convex validation while still running Zod validation.

**Why:**

This change ensures schema enforcement, type safety, and stripping of unknown fields even when Convex validation is skipped for performance reasons.

**Before (v0.2.x):**

```ts
const myQuery = customQuery({
  args: z.object({ name: z.string().min(1) }),
  skipConvexValidation: true,  // Skipped BOTH Convex and Zod validation
  handler: async (ctx, args) => {
    // args.name could be empty string or wrong type
  }
})
```

**After (v0.3.0):**

```ts
const myQuery = customQuery({
  args: z.object({ name: z.string().min(1) }),
  skipConvexValidation: true,  // Only skips Convex validation, Zod still validates
  handler: async (ctx, args) => {
    // args.name is guaranteed to be a non-empty string
  }
})
```

**Impact:**

- If your handlers assumed invalid data could pass through, they may now receive `ZodError` exceptions
- Unknown fields are now stripped from args even with `skipConvexValidation: true`
- Return values are validated against the `returns` schema

**Migration:**

If you need to pass through invalid data for testing or specific use cases:

```ts
// Option 1: Use a permissive schema
const myQuery = customQuery({
  args: z.object({ data: z.any() }),  // Allow anything
  skipConvexValidation: true,
  handler: async (ctx, { data }) => {
    // Validate manually as needed
  }
})

// Option 2: Use z.passthrough() to keep unknown fields
const myQuery = customQuery({
  args: z.object({ name: z.string() }).passthrough(),
  skipConvexValidation: true,
  handler: async (ctx, args) => {
    // Unknown fields are preserved
  }
})
```

---

## Version Compatibility Matrix

| zodvex | Zod | Convex | convex-helpers |
|--------|-----|--------|----------------|
| 0.3.x  | ^4.1.0 | >= 1.27.0 | >= 0.1.104 |
| 0.2.x  | ^4.0.0 | >= 1.27.0 | >= 0.1.101-alpha.1 |
| 0.1.x  | ^4.0.0 | >= 1.27.0 | >= 0.1.101-alpha.1 |

---

## Getting Help

If you encounter issues migrating:

1. Check the [CHANGELOG.md](./CHANGELOG.md) for detailed change notes
2. Open an issue at [github.com/panzacoder/zodvex](https://github.com/panzacoder/zodvex/issues)
3. See the [README.md](./README.md) for updated usage examples
