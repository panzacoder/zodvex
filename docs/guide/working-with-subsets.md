# Working with Subsets

Pick a subset of fields from a model for focused operations like partial updates and filtered queries. See the [README](../../README.md) for a full overview of zodvex.

## Picking Fields from a Model

Use Zod's `.pick()` on `UserModel.fields` to select specific fields:

```ts
import { z } from 'zod'
import { zx } from 'zodvex/core'
import { zm } from './util'
import { UserModel } from './tables/users'

// Use Zod's .pick() to select fields from the model's fields object
const UpdateFields = z.object(UserModel.fields).pick({
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
```

## Inline for Simple Cases

For small updates, inline the fields directly:

```ts
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

## Using `.fields` vs `.shape`

With `defineZodModel`, access fields via `.fields` (not `.shape`):

```ts
import { defineZodModel } from 'zodvex/server'

export const UserModel = defineZodModel('users', {
  name: z.string(),
  email: z.string().email(),
  age: z.number().optional(),
  createdAt: zx.date(),
})

// Access fields for spread/pick operations
UserModel.fields  // The original Zod shape object
UserModel.name    // 'users' (table name)
UserModel.schema.doc     // Zod schema with _id and _creationTime
UserModel.schema.docArray  // z.array(zDoc) for return types
```

## TypeScript Performance Tip

If you hit TypeScript instantiation depth limits (rare, 100+ fields), use `pickShape` or `safePick` from zodvex instead of `.pick()`:

```ts
import { pickShape, safePick } from 'zodvex'

// pickShape returns a plain object shape
const userFields = pickShape(z.object(UserModel.fields), ['email', 'firstName', 'lastName'])
const UserUpdate = z.object(userFields)

// safePick is a convenience wrapper
const UserUpdate = safePick(z.object(UserModel.fields), {
  email: true,
  firstName: true,
  lastName: true
})
```

Standard Zod `.pick()` works great for most schemas — only reach for these helpers if you encounter the TypeScript depth limit error.
