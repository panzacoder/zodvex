# zodvex

#### [Zod](https://zod.dev/) + [Convex](https://www.convex.dev/)

Type-safe Convex functions with Zod schemas. Preserve Convex's optional/nullable semantics while leveraging Zod's powerful validation.

> Built on top of [convex-helpers](https://github.com/get-convex/convex-helpers)

## Table of Contents

- [Installation](#installation)
- [Quick Start](#quick-start)
- [Defining Schemas](#defining-schemas)
- [Table Definitions](#table-definitions)
- [Building Your Schema](#building-your-schema)
- [Defining Functions](#defining-functions)
- [Working with Subsets](#working-with-subsets)
- [Form Validation](#form-validation)
- [API Reference](#api-reference)
- [Advanced Usage](#advanced-usage)

## Installation

```bash
npm install zodvex zod@^4.1.0 convex convex-helpers
```

**Peer dependencies:**

- `zod` (^4.1.0 or later)
- `convex` (>= 1.27.0)
- `convex-helpers` (>= 0.1.104)

## Quick Start

### 1. Set up your builders

Create a `convex/util.ts` file with reusable builders ([copy full example](./examples/queries.ts)):

```ts
// convex/util.ts
import { query, mutation, action } from './_generated/server'
import { zQueryBuilder, zMutationBuilder, zActionBuilder } from 'zodvex'

export const zq = zQueryBuilder(query)
export const zm = zMutationBuilder(mutation)
export const za = zActionBuilder(action)
```

### 2. Use builders to create type-safe functions

```ts
// convex/users.ts
import { z } from 'zod'
import { zid } from 'zodvex'
import { zq, zm } from './util'
import { Users } from './schemas/users'

export const getUser = zq({
  args: { id: zid('users') },
  returns: Users.zDoc.nullable(),
  handler: async (ctx, { id }) => {
    return await ctx.db.get(id)
  }
})

export const createUser = zm({
  args: Users.shape,
  returns: zid('users'),
  handler: async (ctx, user) => {
    // user is fully typed and validated
    return await ctx.db.insert('users', user)
  }
})
```

## Defining Schemas

Define your Zod schemas as plain objects for best type inference:

```ts
import { z } from 'zod'
import { zid } from 'zodvex'

// Plain object shape - recommended
export const userShape = {
  name: z.string(),
  email: z.string().email(),
  age: z.number().optional(),
  avatarUrl: z.string().url().nullable(),
  teamId: zid('teams').optional() // Convex ID reference
}

// Can also use z.object() if preferred
export const User = z.object(userShape)
```

## Table Definitions

Use `zodTable` as a drop-in replacement for Convex's `Table`:

```ts
// convex/schema.ts
import { z } from 'zod'
import { zodTable, zid } from 'zodvex'

export const Users = zodTable('users', {
  name: z.string(),
  email: z.string().email(),
  age: z.number().optional(), // → v.optional(v.float64())
  deletedAt: z.date().nullable(), // → v.union(v.float64(), v.null())
  teamId: zid('teams').optional()
})

// Access the underlying table
Users.table // Convex table definition
Users.shape // Original Zod shape
Users.zDoc // Zod schema with _id and _creationTime
Users.docArray // z.array(zDoc) for return types
```

## Building Your Schema

Use `zodTable().table` in your Convex schema:

```ts
// convex/schema.ts
import { defineSchema } from 'convex/server'
import { Users } from './tables/users'
import { Teams } from './tables/teams'

export default defineSchema({
  users: Users.table
    .index('by_email', ['email'])
    .index('by_team', ['teamId'])
    .searchIndex('search_name', { searchField: 'name' }),

  teams: Teams.table.index('by_created', ['_creationTime'])
})
```

## Defining Functions

Use your builders from `util.ts` to create type-safe functions:

```ts
import { z } from 'zod'
import { zid } from 'zodvex'
import { zq, zm } from './util'
import { Users } from './tables/users'

// Query with return type validation
export const listUsers = zq({
  args: {},
  returns: Users.docArray,
  handler: async (ctx) => {
    return await ctx.db.query('users').collect()
  }
})

// Mutation with Convex ID
export const deleteUser = zm({
  args: { id: zid('users') },
  returns: z.null(),
  handler: async (ctx, { id }) => {
    await ctx.db.delete(id)
    return null
  }
})

// Using the full schema
export const createUser = zm({
  args: Users.shape,
  returns: zid('users'),
  handler: async (ctx, user) => {
    return await ctx.db.insert('users', user)
  }
})
```

## Working with Subsets

Pick a subset of fields for focused operations:

```ts
import { z } from 'zod'
import { zid } from 'zodvex'
import { zm } from './util'
import { Users, zUsers } from './tables/users'

// Use Zod's .pick() to select fields
const UpdateFields = zUsers.pick({
  firstName: true,
  lastName: true,
  email: true
})

export const updateUserProfile = zm({
  args: {
    id: zid('users'),
    ...UpdateFields.shape
  },
  handler: async (ctx, { id, ...fields }) => {
    await ctx.db.patch(id, fields)
  }
})

// Or inline for simple cases
export const updateUserName = zm({
  args: {
    id: zid('users'),
    name: z.string()
  },
  handler: async (ctx, { id, name }) => {
    await ctx.db.patch(id, { name })
  }
})
```

## Form Validation

Use your schemas with form libraries like react-hook-form:

```tsx
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useMutation } from 'convex/react'
import { api } from '../convex/_generated/api'
import { Users } from '../convex/tables/users'

// Create form schema from your table schema
const CreateUserForm = z.object(Users.shape)
type CreateUserForm = z.infer<typeof CreateUserForm>

function UserForm() {
  const createUser = useMutation(api.users.createUser)

  const {
    register,
    handleSubmit,
    formState: { errors }
  } = useForm<CreateUserForm>({
    resolver: zodResolver(CreateUserForm)
  })

  const onSubmit = async (data: CreateUserForm) => {
    await createUser(data)
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)}>
      <input {...register('name')} />
      {errors.name && <span>{errors.name.message}</span>}

      <input {...register('email')} />
      {errors.email && <span>{errors.email.message}</span>}

      <button type="submit">Create User</button>
    </form>
  )
}
```

## API Reference

### Builders

**Basic builders** - Create type-safe functions without auth:

```ts
zQueryBuilder(query) // Creates query builder
zMutationBuilder(mutation) // Creates mutation builder
zActionBuilder(action) // Creates action builder
```

**Custom builders** - Add auth or custom context:

```ts
import { type QueryCtx } from './_generated/server'
import { customCtx } from 'zodvex'

const authQuery = zCustomQueryBuilder(
  query,
  customCtx(async (ctx: QueryCtx) => {
    const user = await getUserOrThrow(ctx)
    return { user }
  })
)

// Use with automatic context injection
export const getMyProfile = authQuery({
  args: {},
  returns: Users.zDoc.nullable(),
  handler: async (ctx) => {
    if (!ctx.user) return null
    return ctx.db.get(ctx.user._id)
  }
})
```

### Mapping Helpers

```ts
import { zodToConvex, zodToConvexFields } from 'zodvex'

// Convert single Zod type to Convex validator
const validator = zodToConvex(z.string().optional())
// → v.optional(v.string())

// Convert object shape to Convex field validators
const fields = zodToConvexFields({
  name: z.string(),
  age: z.number().nullable()
})
// → { name: v.string(), age: v.union(v.float64(), v.null()) }
```

### Codecs

Convert between Zod-shaped data and Convex-safe JSON:

```ts
import { convexCodec } from 'zodvex'

const UserSchema = z.object({
  name: z.string(),
  birthday: z.date().optional()
})

const codec = convexCodec(UserSchema)

// Encode: Date → timestamp, omit undefined
const encoded = codec.encode({
  name: 'Alice',
  birthday: new Date('1990-01-01')
})
// → { name: 'Alice', birthday: 631152000000 }

// Decode: timestamp → Date
const decoded = codec.decode(encoded)
// → { name: 'Alice', birthday: Date('1990-01-01') }
```

### Supported Types

| Zod Type             | Convex Validator                            |
| -------------------- | ------------------------------------------- |
| `z.string()`         | `v.string()`                                |
| `z.number()`         | `v.float64()`                               |
| `z.bigint()`         | `v.int64()`                                 |
| `z.boolean()`        | `v.boolean()`                               |
| `z.date()`           | `v.float64()` (timestamp)                   |
| `z.null()`           | `v.null()`                                  |
| `z.array(T)`         | `v.array(T)`                                |
| `z.object({...})`    | `v.object({...})`                           |
| `z.record(T)`        | `v.record(v.string(), T)`                   |
| `z.union([...])`     | `v.union(...)`                              |
| `z.literal(x)`       | `v.literal(x)`                              |
| `z.enum(['a', 'b'])` | `v.union(v.literal('a'), v.literal('b'))` ¹ |
| `z.optional(T)`      | `v.optional(T)`                             |
| `z.nullable(T)`      | `v.union(T, v.null())`                      |

**Zod v4 Enum Type Note:**

¹ Enum types in Zod v4 produce a slightly different TypeScript signature than manually created unions:

```typescript
// Manual union (precise tuple type)
const manual = v.union(v.literal('a'), v.literal('b'))
// Type: VUnion<"a" | "b", [VLiteral<"a", "required">, VLiteral<"b", "required">], "required", never>

// From Zod enum (array type)
const fromZod = zodToConvex(z.enum(['a', 'b']))
// Type: VUnion<"a" | "b", Array<VLiteral<"a" | "b", "required">>, "required", never>
```

**This difference is purely cosmetic with no functional impact:**

- ✅ Value types are identical (`"a" | "b"`)
- ✅ Runtime validation is identical
- ✅ Type safety for function arguments/returns is preserved
- ✅ Convex uses `T[number]` which works identically for both array and tuple types

This limitation exists because Zod v4 changed enum types from tuple-based to Record-based ([`ToEnum<T>`](https://github.com/colinhacks/zod/blob/v4/src/v4/core/util.ts#L83-L85)). TypeScript cannot convert a Record type to a specific tuple without knowing the keys at compile time. See [Zod v4 changelog](https://zod.dev/v4/changelog) and [enum evolution discussion](https://github.com/colinhacks/zod/discussions/2125) for more details.

**Convex IDs:**

```ts
import { zid } from 'zodvex'

zid('tableName') // → v.id('tableName')
zid('tableName').optional() // → v.optional(v.id('tableName'))
```

## Advanced Usage

### Custom Context Builders

Create builders with injected auth, permissions, or other context:

> **Best Practice:** Always add explicit type annotations to the `ctx` parameter in your `customCtx` functions. This improves TypeScript performance and prevents `ctx` from falling back to `any` in complex type scenarios. Import context types from `./_generated/server` (e.g., `QueryCtx`, `MutationCtx`, `ActionCtx`).

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

### Date Handling

zodvex automatically converts dates between JavaScript `Date` objects and Convex timestamps when using `z.date()` in your schemas.

#### Automatic Conversion (Recommended)

Use `z.date()` for automatic handling - no manual conversion needed:

```ts
const eventShape = {
  title: z.string(),
  startDate: z.date(),
  endDate: z.date().nullable(),
  createdAt: z.date().optional()
}

export const Events = zodTable('events', eventShape)

// In your function - dates work seamlessly
export const createEvent = zm({
  args: eventShape,
  handler: async (ctx, { startDate, endDate, title }) => {
    // startDate and endDate are already Date objects!
    console.log(startDate.toISOString()) // ✅ Works

    // Automatically converted to timestamps for storage
    return await ctx.db.insert('events', { title, startDate, endDate })
  }
})

// On the frontend - just pass Date objects
const createEvent = useMutation(api.events.createEvent)
await createEvent({
  title: 'My Event',
  startDate: new Date('2024-01-01'),
  endDate: new Date('2024-01-02')
})
// ✅ No manual conversion needed!
```

**How it works:**
- **Args**: Timestamps from client → automatically decoded to `Date` objects
- **Returns**: `Date` objects from handler → automatically encoded to timestamps
- **Storage**: Dates are stored as `v.float64()` (Convex doesn't have a native Date type)

#### Manual String Dates (Alternative)

If you prefer working with ISO strings instead of Date objects, use `z.string()`:

```ts
// ❌ Using z.string() means NO automatic conversion
const schema = {
  birthday: z.string() // Stored as ISO string
}

export const updateUser = zm({
  args: schema,
  handler: async (ctx, { birthday }) => {
    // birthday is a string, you must manually parse
    const date = new Date(birthday) // Manual conversion
    await ctx.db.insert('users', { birthday })
  }
})

// On frontend - manual conversion
await updateUser({
  birthday: new Date().toISOString() // Must manually convert
})
```

**When to use which:**
- ✅ **`z.date()`** - When you want automatic conversion and type-safe Date objects (recommended)
- ⚠️ **`z.string()`** - When you need ISO strings for display/formatting (requires manual parsing)

#### Edge Case: Date/Number Unions

If you need a field that accepts both dates and numbers (rare), use explicit transforms:

```ts
// Edge case: field that can be a date OR a timestamp
const flexibleDate = z.union([
  z.date(),
  z.number().transform(ts => new Date(ts))
])

// Most apps don't need this - fields are either dates OR numbers, not both
```

**Note:** In real-world schemas, mixing dates and numbers in unions is uncommon. Design your data model so fields have a single type.

### Return Type Helpers

```ts
import { returnsAs } from 'zodvex'

export const listUsers = zq({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db.query('users').collect()
    // Use returnsAs for type hint in tricky inference spots
    return returnsAs<typeof Users.docArray>()(rows)
  },
  returns: Users.docArray
})
```

### Working with Large Schemas

zodvex provides `pickShape` and `safePick` helpers as alternatives to Zod's `.pick()`:

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

### AI SDK Compatibility

zodvex schemas are fully compatible with [Vercel's AI SDK](https://sdk.vercel.ai/docs), including `zid` for Convex IDs.

#### Using with AI SDK

```ts
import { generateObject } from 'ai'
import { openai } from '@ai-sdk/openai'
import { z } from 'zod'
import { zid } from 'zodvex'

const userSchema = z.object({
  id: zid('users'),        // ✅ Works with AI SDK
  name: z.string(),
  email: z.string().email(),
  age: z.number().int(),
  teamId: zid('teams').optional()
})

const result = await generateObject({
  model: openai('gpt-4'),
  schema: userSchema,
  prompt: 'Generate a sample user profile'
})

// result.object is fully typed and validated
console.log(result.object.id) // Type: GenericId<'users'>
```

#### Why It Works

AI SDK requires schemas to be serializable (no `.transform()` or `.brand()`). zodvex's `zid` uses type-level branding instead of runtime transforms, making it compatible:

```ts
// zodvex approach (compatible)
zid('users') // String validator with type assertion → GenericId<'users'>

// Not compatible (using transforms)
z.string().transform(s => s as GenericId<'users'>) // ❌ AI SDK rejects
```

#### Schemas with Custom Transforms

If you have schemas with custom `.transform()` or `.pipe()`, AI SDK may reject them. For complex transformations, consider:

**Option 1: Separate schemas**
```ts
// For AI SDK (no transforms)
const aiUserSchema = z.object({
  createdAt: z.string() // ISO string
})

// For internal use (with transforms)
const internalUserSchema = z.object({
  createdAt: z.string().transform(s => new Date(s))
})
```

**Option 2: Use Zod 4 codecs** (Future enhancement)
```ts
// Research needed: Zod 4.1+ codec API
const dateCodec = z.codec(z.string(), z.date(), {
  encode: (date) => date.toISOString(),
  decode: (str) => new Date(str)
})
```

> **Note:** We're researching Zod 4's codec API and JSON schema annotations to provide better AI SDK integration for complex schemas. See [Issue #22](https://github.com/panzacoder/zodvex/issues/22) for updates.

## zodvex vs convex-helpers/zod4

Convex officially supports Zod 4 via `convex-helpers/server/zod4`. zodvex builds on those primitives to provide a batteries-included, opinionated solution.

**Use convex-helpers if you want:**
- Low-level control over encoding/decoding
- Explicit Zod codecs for all conversions
- Minimal abstractions
- Both Zod 3 and 4 support in one package

**Use zodvex if you want:**
- Automatic date handling (no manual codecs needed)
- Table helpers with `.table`, `.zDoc`, `.docArray`, `.shape`
- Builder pattern API for consistent function definitions
- Codec abstraction with `.pick()` for subsets
- Turnkey developer experience

**Key differences:**

| Feature | zodvex | convex-helpers/zod4 |
|---------|--------|---------------------|
| Date conversion | Automatic with `z.date()` | Manual `z.codec()` required |
| Table helpers | `zodTable()` with helpers | Not provided |
| Builder pattern | `zQueryBuilder()`, etc. | Not provided |
| Codec abstraction | `convexCodec()` with `.pick()` | Not provided |
| Philosophy | Batteries-included | Minimal primitives |

Both are valid choices - zodvex trades some explicitness for significantly better ergonomics.

## Why zodvex?

- **Correct optional/nullable semantics** - Preserves Convex's distinction
  - `.optional()` → `v.optional(T)` (field can be omitted)
  - `.nullable()` → `v.union(T, v.null())` (required but can be null)
  - Both → `v.optional(v.union(T, v.null()))`
- **Superior type safety** - Builders provide better type inference than wrapper functions
- **Automatic date handling** - `Date` ↔ timestamp conversion happens transparently
- **Table helpers** - `zodTable()` provides `.zDoc`, `.docArray`, and `.shape` for DRY schemas
- **End-to-end validation** - Same schema from database to frontend forms

## Compatibility

- **Zod**: ^4.1.0 or later
- **Convex**: >= 1.27.0
- **convex-helpers**: >= 0.1.104
- **TypeScript**: Full type inference support

## License

MIT

---

Built with ❤️ on top of [convex-helpers](https://github.com/get-convex/convex-helpers)
