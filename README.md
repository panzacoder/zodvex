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
import { customCtx } from 'zodvex'

const authQuery = zCustomQueryBuilder(
  query,
  customCtx(async (ctx) => {
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

| Zod Type          | Convex Validator          |
| ----------------- | ------------------------- |
| `z.string()`      | `v.string()`              |
| `z.number()`      | `v.float64()`             |
| `z.bigint()`      | `v.int64()`               |
| `z.boolean()`     | `v.boolean()`             |
| `z.date()`        | `v.float64()` (timestamp) |
| `z.null()`        | `v.null()`                |
| `z.array(T)`      | `v.array(T)`              |
| `z.object({...})` | `v.object({...})`         |
| `z.record(T)`     | `v.record(v.string(), T)` |
| `z.union([...])`  | `v.union(...)`            |
| `z.literal(x)`    | `v.literal(x)`            |
| `z.enum([...])`   | `v.union(literals...)`    |
| `z.optional(T)`   | `v.optional(T)`           |
| `z.nullable(T)`   | `v.union(T, v.null())`    |

**Convex IDs:**

```ts
import { zid } from 'zodvex'

zid('tableName') // → v.id('tableName')
zid('tableName').optional() // → v.optional(v.id('tableName'))
```

## Advanced Usage

### Custom Context Builders

Create builders with injected auth, permissions, or other context:

```ts
import { zCustomQueryBuilder, zCustomMutationBuilder, customCtx } from 'zodvex'
import { query, mutation } from './_generated/server'

// Add user to all queries
export const authQuery = zCustomQueryBuilder(
  query,
  customCtx(async (ctx) => {
    const user = await getUserOrThrow(ctx)
    return { user }
  })
)

// Add user + permissions to mutations
export const authMutation = zCustomMutationBuilder(
  mutation,
  customCtx(async (ctx) => {
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

Dates are automatically converted to timestamps:

```ts
const eventShape = {
  title: z.string(),
  startDate: z.date(),
  endDate: z.date().nullable()
}

export const Events = zodTable('events', eventShape)

export const createEvent = zm({
  args: eventShape,
  handler: async (ctx, event) => {
    // event.startDate is a Date object
    // Automatically converted to timestamp for storage
    return await ctx.db.insert('events', event)
  }
})
```

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

## Why zodvex?

- **Correct optional/nullable semantics** - Preserves Convex's distinction
  - `.optional()` → `v.optional(T)` (field can be omitted)
  - `.nullable()` → `v.union(T, v.null())` (required but can be null)
  - Both → `v.optional(v.union(T, v.null()))`
- **Superior type safety** - Builders provide better type inference than wrapper functions
- **Date handling** - Automatic `Date` ↔ timestamp conversion
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
