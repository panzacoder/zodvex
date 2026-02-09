# zodvex

#### [Zod](https://zod.dev/) + [Convex](https://www.convex.dev/)

Type-safe Convex functions with Zod schemas. Preserve Convex's optional/nullable semantics while leveraging Zod's powerful validation.

> Built on top of [convex-helpers](https://github.com/get-convex/convex-helpers)

## Table of Contents

- [Installation](#installation)
- [Import Paths](#import-paths)
- [Quick Start](#quick-start)
- [Defining Schemas](#defining-schemas)
- [Table Definitions](#table-definitions)
- [Building Your Schema](#building-your-schema)
- [Defining Functions](#defining-functions)
- [Working with Subsets](#working-with-subsets)
- [Form Validation](#form-validation)
- [API Reference](#api-reference)
  - [The zx Namespace](#the-zx-namespace)
- [Advanced Usage](#advanced-usage)
  - [Custom Context Builders](#custom-context-builders)
    - [Hooks and Transforms](#hooks-and-transforms)
  - [Custom Codecs](#custom-codecs)
  - [Date Handling](#date-handling)
  - [Return Type Helpers](#return-type-helpers)
  - [Working with Large Schemas](#working-with-large-schemas)
  - [Polymorphic Tables with Unions](#polymorphic-tables-with-unions)
  - [AI SDK Compatibility](#ai-sdk-compatibility)
- [Migration Guide](./MIGRATION.md)

## Installation

```bash
npm install zodvex zod@^4.1.0 convex convex-helpers
```

**Peer dependencies:**

- `zod` (^4.1.0 or later)
- `convex` (>= 1.27.0)
- `convex-helpers` (>= 0.1.104)

## Import Paths

zodvex provides multiple entry points for optimal bundle sizes:

### `zodvex/core` - Client-Safe (Recommended for client code)

Use this in React components, hooks, and any client-side code:

```typescript
import { zx, zodToConvex } from 'zodvex/core'

// Define schemas that can be used anywhere
const userSchema = z.object({
  id: zx.id('users'),
  createdAt: zx.date(),
})
```

### `zodvex/server` - Server-Only

Use this in Convex functions and schema definitions:

```typescript
import { zodTable, zCustomQuery } from 'zodvex/server'

// In convex/schema.ts
const Users = zodTable('users', userShape)
```

### `zodvex` - Full Library (Backwards Compatible)

For convenience or when you don't care about bundle size:

```typescript
import { zx, zodTable } from 'zodvex'
```

> **Note:** This pulls in server code. Use `zodvex/core` for client bundles.

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
import { zx } from 'zodvex'
import { zq, zm } from './util'
import { Users } from './schemas/users'

export const getUser = zq({
  args: { id: zx.id('users') },
  returns: Users.zDoc.nullable(),
  handler: async (ctx, { id }) => {
    return await ctx.db.get(id)
  }
})

export const createUser = zm({
  args: Users.shape,
  returns: zx.id('users'),
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
import { zx } from 'zodvex'

// Plain object shape - recommended
export const userShape = {
  name: z.string(),
  email: z.string().email(),
  age: z.number().optional(),
  avatarUrl: z.string().url().nullable(),
  createdAt: zx.date(),            // Date ↔ timestamp codec
  teamId: zx.id('teams').optional() // Convex ID reference
}

// Can also use z.object() if preferred
export const User = z.object(userShape)
```

## Table Definitions

Use `zodTable` as a drop-in replacement for Convex's `Table`:

```ts
// convex/schema.ts
import { z } from 'zod'
import { zodTable, zx } from 'zodvex'

export const Users = zodTable('users', {
  name: z.string(),
  email: z.string().email(),
  age: z.number().optional(),        // → v.optional(v.float64())
  createdAt: zx.date(),              // → v.float64() (explicit codec)
  deletedAt: zx.date().nullable(),   // → v.union(v.float64(), v.null())
  teamId: zx.id('teams').optional()  // → v.optional(v.id('teams'))
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
import { zx } from 'zodvex'
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
  args: { id: zx.id('users') },
  returns: z.null(),
  handler: async (ctx, { id }) => {
    await ctx.db.delete(id)
    return null
  }
})

// Using the full schema
export const createUser = zm({
  args: Users.shape,
  returns: zx.id('users'),
  handler: async (ctx, user) => {
    return await ctx.db.insert('users', user)
  }
})
```

## Working with Subsets

Pick a subset of fields for focused operations:

```ts
import { z } from 'zod'
import { zx } from 'zodvex'
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
    id: zx.id('users'),
    ...UpdateFields.shape
  },
  handler: async (ctx, { id, ...fields }) => {
    await ctx.db.patch(id, fields)
  }
})

// Or inline for simple cases
export const updateUserName = zm({
  args: {
    id: zx.id('users'),
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

### The zx Namespace

The `zx` namespace provides zodvex-specific validators and codecs. The name signals "zodvex" or "zod + convex" - explicit transformations for Convex compatibility.

```ts
import { z } from 'zod'
import { zx } from 'zodvex'

const schema = z.object({
  id: zx.id('users'),      // Convex ID
  createdAt: zx.date(),    // Date ↔ timestamp
  secret: zx.codec(...)    // Custom codec
})
```

| Helper | Wire Format | Runtime Format | Use Case |
|--------|------------|----------------|----------|
| `zx.id('table')` | `string` | `GenericId<T>` | Convex document IDs |
| `zx.date()` | `number` | `Date` | Timestamps |
| `zx.codec(wire, runtime, transforms)` | Custom | Custom | Custom transformations |

**Why `zx.*` instead of `z.*`?**

- Makes Convex-specific transformations explicit (no "magic")
- Clearly distinct from standard Zod types
- Discoverable via IDE autocomplete on `zx.`

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
import { z } from 'zod'
import { zx, convexCodec } from 'zodvex'

const UserSchema = z.object({
  name: z.string(),
  birthday: zx.date().optional()  // Use zx.date() for Date ↔ timestamp
})

const codec = convexCodec(UserSchema)

// Encode: Date → timestamp, strip undefined
const encoded = codec.encode({
  name: 'Alice',
  birthday: new Date('1990-01-01')
})
// → { name: 'Alice', birthday: 631152000000 }

// Decode: timestamp → Date
const decoded = codec.decode(encoded)
// → { name: 'Alice', birthday: Date('1990-01-01') }
```

> **Note:** `convexCodec` will throw an error if the schema contains native `z.date()`. Use `zx.date()` instead for automatic Date ↔ timestamp conversion.

### Supported Types

| Zod Type             | Convex Validator                            |
| -------------------- | ------------------------------------------- |
| `z.string()`         | `v.string()`                                |
| `z.number()`         | `v.float64()`                               |
| `z.bigint()`         | `v.int64()`                                 |
| `z.boolean()`        | `v.boolean()`                               |
| `z.null()`           | `v.null()`                                  |
| `z.array(T)`         | `v.array(T)`                                |
| `z.object({...})`    | `v.object({...})`                           |
| `z.record(T)`        | `v.record(v.string(), T)`                   |
| `z.union([...])`     | `v.union(...)`                              |
| `z.literal(x)`       | `v.literal(x)`                              |
| `z.enum(['a', 'b'])` | `v.union(v.literal('a'), v.literal('b'))` ¹ |
| `z.optional(T)`      | `v.optional(T)`                             |
| `z.nullable(T)`      | `v.union(T, v.null())`                      |

> **Note:** Native `z.date()` is **not supported** - use `zx.date()` instead. See [Date Handling](#date-handling) for details.

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

**Convex IDs and Dates (zx namespace):**

```ts
import { zx } from 'zodvex'

// Convex IDs
zx.id('tableName')           // → v.id('tableName')
zx.id('tableName').optional() // → v.optional(v.id('tableName'))

// Dates (explicit codec - no magic!)
zx.date()           // → v.float64() (timestamp)
zx.date().optional() // → v.optional(v.float64())
zx.date().nullable() // → v.union(v.float64(), v.null())
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

#### Hooks and Transforms

For advanced use cases like logging, analytics, or data transformations, use `customCtxWithHooks`:

```ts
import { zCustomMutationBuilder, customCtxWithHooks } from 'zodvex'
import { type MutationCtx, mutation } from './_generated/server'

export const secureMutation = zCustomMutationBuilder(
  mutation,
  customCtxWithHooks(async (ctx: MutationCtx) => {
    const securityCtx = await getSecurityContext(ctx)

    return {
      // Custom context (same as customCtx)
      ctx: { securityCtx },

      // Hooks: observe execution (side effects, no return value)
      hooks: {
        onSuccess: ({ ctx, args, result }) => {
          // Called after successful execution
          console.log('Mutation succeeded:', { args, result })
          analytics.track('mutation_success', { userId: ctx.securityCtx.userId })
        }
      },

      // Transforms: modify data in the flow
      transforms: {
        // Transform args after validation, before handler
        input: (args, schema) => {
          // e.g., Convert wire format to runtime objects
          return transformIncomingArgs(args, securityCtx)
        },
        // Transform result after handler, before response
        output: (result, schema) => {
          // e.g., Mask sensitive fields based on permissions
          return transformOutgoingResult(result, securityCtx)
        }
      }
    }
  })
)
```

**Execution order:**

1. Args received from client
2. Zod validation on args
3. `transforms.input` runs (if provided)
4. Handler executes
5. Zod validation on returns (if provided)
6. `hooks.onSuccess` runs (if provided)
7. `transforms.output` runs (if provided)
8. Response sent to client

**Use cases:**

| Feature | Use Case |
|---------|----------|
| `hooks.onSuccess` | Logging, analytics, audit trails, cache invalidation |
| `transforms.input` | Wire format → runtime objects, field decryption, data hydration |
| `transforms.output` | Sensitive field masking, data redaction, format conversion |

**Note:** Both `transforms.input` and `transforms.output` can be async:

```ts
transforms: {
  input: async (args, schema) => {
    const decrypted = await decrypt(args.sensitiveField)
    return { ...args, sensitiveField: decrypted }
  }
}
```

### Custom Codecs

For complex type transformations beyond the built-in `zx.date()` and `zx.id()`, use `zx.codec()` to create custom codecs that automatically work with validator generation and runtime encoding/decoding.

#### When to Use Custom Codecs

- **Sensitive data**: Encrypt/decrypt fields before storage
- **Complex objects**: Serialize/deserialize custom class instances
- **Wire format transformations**: Convert between API formats and internal representations

#### Creating a Custom Codec

```ts
import { z } from 'zod'
import { zx, type ZodvexCodec } from 'zodvex'

// Define wire (storage) and runtime schemas
type SensitiveCodec = ZodvexCodec<
  z.ZodObject<{ encrypted: z.ZodString }>,
  z.ZodCustom<string>
>

function sensitiveString(): SensitiveCodec {
  return zx.codec(
    z.object({ encrypted: z.string() }),  // Wire format (stored in Convex)
    z.custom<string>(() => true),          // Runtime format (used in code)
    {
      decode: (wire) => decrypt(wire.encrypted),
      encode: (value) => ({ encrypted: encrypt(value) })
    }
  )
}

// Use in your schema
const userShape = {
  name: z.string(),
  ssn: sensitiveString()  // Automatically encrypted/decrypted
}
```

#### Automatic Codec Detection

zodvex automatically detects codecs created with `zx.codec()` and native `z.codec()`. No manual registration required:

```ts
import { z } from 'zod'
import { zodToConvex } from 'zodvex'

const codec = sensitiveString()

// Validator generation - uses wire schema automatically
const validator = zodToConvex(codec)
// → v.object({ encrypted: v.string() })

// Runtime encoding - use Zod's native z.encode()
const convexValue = z.encode(codec, 'my-secret')
// → { encrypted: '<encrypted-value>' }

// Runtime decoding - use schema.parse()
const runtimeValue = codec.parse({ encrypted: '<encrypted-value>' })
// → 'my-secret'
```

#### Nested Codecs

Codecs work correctly when nested in object schemas:

```ts
const schema = z.object({
  id: z.string(),
  secret: sensitiveString(),  // Custom codec
  createdAt: zx.date()        // Built-in zx.date() codec
})

// All fields automatically encoded/decoded using Zod's native functions
const encoded = z.encode(schema, {
  id: 'user-123',
  secret: 'password',
  createdAt: new Date()
})
// → { id: 'user-123', secret: { encrypted: '...' }, createdAt: 1234567890 }

// Decode with schema.parse()
const decoded = schema.parse(encoded)
// → { id: 'user-123', secret: 'password', createdAt: Date(...) }
```

#### Why `zx.codec()` Instead of `z.codec()`

Use `zx.codec()` instead of native `z.codec()` for better type inference when using type aliases:

```ts
// ❌ Type alias loses codec structure
type MyCodec = z.ZodType<string>
const codec: MyCodec = z.codec(wire, runtime, transforms)
zodToConvex(codec)  // → v.any() (type lost)

// ✅ ZodvexCodec preserves wire schema type
type MyCodec = ZodvexCodec<WireSchema, RuntimeSchema>
const codec: MyCodec = zx.codec(wire, runtime, transforms)
zodToConvex(codec)  // → v.object({ ... }) (correct inference)
```

### Date Handling

Use `zx.date()` for explicit, type-safe date handling. This codec transforms between JavaScript `Date` objects and Convex timestamps.

#### Using zx.date() (Recommended)

```ts
import { zx } from 'zodvex'

const eventShape = {
  title: z.string(),
  startDate: zx.date(),
  endDate: zx.date().nullable(),
  createdAt: zx.date().optional()
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
// ✅ Automatically encoded to timestamps
```

**How it works:**
- **Args**: Timestamps from client → decoded to `Date` objects via codec
- **Returns**: `Date` objects from handler → encoded to timestamps via codec
- **Storage**: Dates are stored as `v.float64()` (Convex doesn't have a native Date type)

**Why `zx.date()` instead of `z.date()`?**

The `zx.date()` codec makes the transformation explicit - you know at a glance that wire format conversion is happening. This avoids "magic" behavior that can be confusing.

#### Alternative: Manual String Dates

If you prefer working with ISO strings instead of Date objects, use `z.string()`:

```ts
// Using z.string() means NO automatic conversion
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
```

**When to use which:**
- ✅ **`zx.date()`** - When you want automatic conversion and type-safe Date objects (recommended)
- ⚠️ **`z.string()`** - When you need ISO strings for display/formatting (requires manual parsing)

#### z.date() Is Not Supported

Using native `z.date()` will throw an error at runtime with guidance to migrate:

```ts
// ❌ This will throw an error
const schema = z.object({
  createdAt: z.date()  // Error: z.date() is not compatible with Convex
})

// ✅ Use zx.date() instead
const schema = z.object({
  createdAt: zx.date()  // Works correctly
})
```

**Why?** Convex stores dates as timestamps (numbers), which native `z.date()` cannot parse directly. The `zx.date()` codec handles the timestamp ↔ Date conversion automatically.

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

### Polymorphic Tables with Unions

zodvex fully supports polymorphic tables using discriminated unions! Use `zodTable()` directly with union schemas:

```ts
import { zodTable, zid } from 'zodvex'
import { z } from 'zod'

// Define your discriminated union schema
const shapeSchema = z.union([
  z.object({
    kind: z.literal('circle'),
    cx: z.number(),
    cy: z.number(),
    r: z.number()
  }),
  z.object({
    kind: z.literal('rectangle'),
    x: z.number(),
    y: z.number(),
    width: z.number(),
    height: z.number()
  }),
  z.object({
    kind: z.literal('path'),
    path: z.string()
  })
])

// Define the table - zodTable() accepts unions!
export const Shapes = zodTable('shapes', shapeSchema)

// Use in schema
export default defineSchema({
  shapes: Shapes.table
})

// docArray automatically includes system fields for each variant
export const getShapes = zq({
  args: {},
  returns: Shapes.docArray,  // ✅ Each variant has _id and _creationTime
  handler: async (ctx) => ctx.db.query('shapes').collect()
})

// Create with type-safe discriminated unions
export const createShape = zm({
  args: shapeSchema,
  handler: async (ctx, shape) => {
    // shape is discriminated - TypeScript knows the fields based on `kind`
    return await ctx.db.insert('shapes', shape)
  }
})
```

#### Union Table Helpers

Union tables provide different helpers than object tables:

```ts
const Shapes = zodTable('shapes', shapeSchema)

// Available properties:
Shapes.table          // TableDefinition for schema
Shapes.tableName      // 'shapes'
Shapes.schema         // Original union schema
Shapes.validator      // Convex validator (union)
Shapes.docArray       // Array schema with system fields added to each variant
Shapes.withSystemFields()  // Returns union with _id and _creationTime on each variant

// NOT available (specific to object tables):
// Shapes.shape       - unions don't have a fixed shape
// Shapes.zDoc        - use withSystemFields() instead
```

#### Advanced Union Patterns

**Shared base schema:**

```ts
const baseShape = z.object({
  color: z.string(),
  strokeWidth: z.number()
})

const shapeSchema = z.union([
  baseShape.extend({
    kind: z.literal('circle'),
    radius: z.number()
  }),
  baseShape.extend({
    kind: z.literal('rectangle'),
    width: z.number(),
    height: z.number()
  })
])

export const Shapes = zodTable('shapes', shapeSchema)
```

**Using z.discriminatedUnion:**

```ts
const shapeSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('circle'), r: z.number() }),
  z.object({ kind: z.literal('rectangle'), w: z.number(), h: z.number() })
])

export const Shapes = zodTable('shapes', shapeSchema)
```

**When to use discriminated unions:**
- Polymorphic data (e.g., different shape types, notification variants)
- Tables with multiple distinct subtypes sharing common fields
- Event sourcing patterns with different event types
- When you need type-safe variant handling in TypeScript

**Learn more:**
- [Convex Polymorphic Data](https://docs.convex.dev/database/types#polymorphic-types)
- [Zod Discriminated Unions](https://zod.dev/discriminated-unions)

### AI SDK Compatibility

zodvex schemas are fully compatible with [Vercel's AI SDK](https://sdk.vercel.ai/docs), including `zx.id()` for Convex IDs.

#### Using with AI SDK

```ts
import { generateObject } from 'ai'
import { openai } from '@ai-sdk/openai'
import { z } from 'zod'
import { zx } from 'zodvex'

const userSchema = z.object({
  id: zx.id('users'),        // ✅ Works with AI SDK
  name: z.string(),
  email: z.string().email(),
  age: z.number().int(),
  teamId: zx.id('teams').optional()
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

AI SDK requires schemas to be serializable (no `.transform()` or `.brand()`). zodvex's `zx.id()` uses type-level branding instead of runtime transforms, making it compatible:

```ts
// zodvex approach (compatible)
zx.id('users') // String validator with type assertion → GenericId<'users'>

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

**Option 2: Use zodvex's JSON Schema helper**
```ts
import { zx, toJSONSchema } from 'zodvex'

const schema = z.object({
  userId: zx.id('users'),
  createdAt: zx.date(),
  name: z.string()
})

// Automatically handles zx.id() and zx.date() for JSON Schema generation
const jsonSchema = toJSONSchema(schema)
// Use with AI SDK or other JSON Schema consumers
```

The `toJSONSchema` helper automatically handles zodvex-managed types:
- `zx.id('tableName')` → `{ type: "string", format: "convex-id:tableName" }`
- `zx.date()` → `{ type: "string", format: "date-time" }`

For custom overrides, use `zodvexJSONSchemaOverride` directly:
```ts
import { zodvexJSONSchemaOverride, composeOverrides } from 'zodvex'

const jsonSchema = z.toJSONSchema(schema, {
  unrepresentable: 'any',
  override: composeOverrides(myCustomOverride, zodvexJSONSchemaOverride)
})
```

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
| Date conversion | Explicit with `zx.date()` | Manual `z.codec()` required |
| ID handling | `zx.id('table')` with type branding | Manual setup |
| Table helpers | `zodTable()` with helpers | Not provided |
| Builder pattern | `zQueryBuilder()`, etc. | Not provided |
| Codec abstraction | `zx.codec()` / `convexCodec()` | Not provided |
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
