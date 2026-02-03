# Migration Guide

This guide helps you upgrade between zodvex versions with breaking changes.

## Table of Contents

- [Upgrading to Codec-First Architecture](#upgrading-to-codec-first-architecture)
  - [z.date() Now Throws an Error](#zdate-now-throws-an-error)
  - [toConvexJS and fromConvexJS Removed](#toconvexjs-and-fromconvexjs-removed)
  - [registerBaseCodec Removed](#registerbasecodec-removed)
- [Upgrading to the zx Namespace](#upgrading-to-the-zx-namespace)
  - [zid() → zx.id()](#zid--zxid)
  - [z.date() → zx.date()](#zdate--zxdate)
  - [zodvexCodec() → zx.codec()](#zodvexcodec--zxcodec)
- [Upgrading to v0.3.0](#upgrading-to-v030)
  - [zid() Implementation Change](#zid-implementation-change)
  - [zCrud Removal](#zcrud-removal)
  - [skipConvexValidation Behavior Change](#skipconvexvalidation-behavior-change)

---

## Upgrading to Codec-First Architecture

zodvex has adopted a codec-first architecture that uses Zod's native `z.encode()` and `schema.parse()` functions for wire format transformations. This simplifies the codebase and provides better integration with Zod v4's codec system.

### z.date() Now Throws an Error

**What changed:**

Using native `z.date()` in args or returns schemas now throws an error at runtime with guidance to migrate to `zx.date()`.

**Before (worked with deprecation):**
```ts
const schema = z.object({
  createdAt: z.date()  // Previously worked but was discouraged
})
```

**After (throws error):**
```ts
// ❌ This will throw:
// "[zodvex] Native z.date() found in args. Convex stores dates as timestamps (numbers),
// which z.date() cannot parse. Fix: Replace z.date() with zx.date()"

const schema = z.object({
  createdAt: z.date()  // Error!
})

// ✅ Use zx.date() instead
import { zx } from 'zodvex'

const schema = z.object({
  createdAt: zx.date()  // Works correctly
})
```

**Migration:**

Find and replace all instances of `z.date()` with `zx.date()`:

```bash
# Find z.date() usages
grep -r "z\.date()" --include="*.ts" src/ convex/
```

### toConvexJS and fromConvexJS Removed

**What changed:**

The `toConvexJS` and `fromConvexJS` functions have been removed. Use Zod's native `z.encode()` and `schema.parse()` instead.

**Before:**
```ts
import { toConvexJS, fromConvexJS } from 'zodvex'

// Encoding
const wireValue = toConvexJS(schema, runtimeValue)

// Decoding
const runtimeValue = fromConvexJS(wireValue, schema)
```

**After:**
```ts
import { z } from 'zod'

// Encoding - use Zod's native z.encode()
const wireValue = z.encode(schema, runtimeValue)

// Decoding - use schema.parse()
const runtimeValue = schema.parse(wireValue)
```

**Why the change:**

Zod v4 introduced native codec support with `z.codec()`, `z.encode()`, and `schema.parse()`. These provide the same functionality as `toConvexJS`/`fromConvexJS` but are part of Zod's standard API. This:

- Reduces zodvex's API surface
- Provides better integration with Zod tooling
- Fixes a double-parsing bug where codecs were being decoded twice

### registerBaseCodec Removed

**What changed:**

The `registerBaseCodec` function has been removed from the public API.

**Before:**
```ts
import { registerBaseCodec } from 'zodvex/registry'

registerBaseCodec({
  check: (schema) => schema instanceof MyCustomZodType,
  toValidator: (schema) => v.object({ /* ... */ }),
  toConvex: (value, schema) => serializeMyClass(value),
  fromConvex: (value, schema) => deserializeMyClass(value)
})
```

**After:**

Use `zx.codec()` to create custom codecs:

```ts
import { z } from 'zod'
import { zx } from 'zodvex'

// Create a codec with wire and runtime schemas
const myCodec = zx.codec(
  z.object({ /* wire format */ }),  // How data is stored in Convex
  z.custom<MyType>(() => true),      // Runtime type
  {
    decode: (wire) => /* wire → runtime */,
    encode: (runtime) => /* runtime → wire */
  }
)
```

**Why the change:**

The base codec registry was a complex, global-state-based solution. Zod v4's native codec system provides the same capabilities with a simpler, local approach. Creating codecs with `zx.codec()` or `z.codec()`:

- Avoids global mutable state
- Works automatically with `zodToConvex()` (uses wire schema)
- Works automatically with `z.encode()`/`schema.parse()`
- Is more discoverable and type-safe

---

## Upgrading to the zx Namespace

zodvex now provides the `zx` namespace for explicit, discoverable helpers. The old functions still work but show deprecation warnings.

### zid() → zx.id()

**What changed:**

`zid()` is deprecated in favor of `zx.id()`. The functionality is identical.

**Before:**
```ts
import { zid } from 'zodvex'

const schema = z.object({
  userId: zid('users'),
  teamId: zid('teams').optional()
})
```

**After:**
```ts
import { zx } from 'zodvex'

const schema = z.object({
  userId: zx.id('users'),
  teamId: zx.id('teams').optional()
})
```

### z.date() → zx.date()

**What changed:**

`z.date()` is no longer supported and will throw an error. You must use `zx.date()` instead. The `zx.date()` codec makes the Date ↔ timestamp transformation explicit.

**Before:**
```ts
const schema = z.object({
  createdAt: z.date(),
  updatedAt: z.date().nullable()
})
```

**After:**
```ts
import { zx } from 'zodvex'

const schema = z.object({
  createdAt: zx.date(),
  updatedAt: zx.date().nullable()
})
```

**Why the change:**

Convex stores dates as timestamps (numbers), which native `z.date()` cannot parse. Using `zx.date()` makes it immediately clear that a wire format transformation is happening (Date ↔ timestamp) and correctly handles the conversion.

### zodvexCodec() → zx.codec()

**What changed:**

`zodvexCodec()` is now also available as `zx.codec()` for consistency.

**Before:**
```ts
import { zodvexCodec } from 'zodvex'

const myCodec = zodvexCodec(wireSchema, runtimeSchema, transforms)
```

**After:**
```ts
import { zx } from 'zodvex'

const myCodec = zx.codec(wireSchema, runtimeSchema, transforms)
```

Both forms continue to work - `zx.codec()` is simply an alias for `zodvexCodec()`.

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
