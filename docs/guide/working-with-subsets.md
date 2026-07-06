# Working with Subsets

Pick a subset of fields from a model for focused operations like partial updates and filtered queries. See the [README](../../README.md) for a full overview of zodvex.

## Picking Fields from a Model

Use Zod's `.pick()` on `UserModel.fields` to select specific fields:

```ts
import { z } from 'zod'
import { zx } from 'zodvex'
import { zm } from './util'
import { UserModel } from './models/user'

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
import { defineZodModel } from 'zodvex'

export const UserModel = defineZodModel('users', {
  name: z.string(),
  email: z.string().email(),
  age: z.number().optional(),
  createdAt: zx.date(),
})

// Access fields for spread/pick operations
UserModel.fields         // The original Zod shape object
UserModel.name           // 'users' (table name)
UserModel.validator      // User-facing Zod schema (refinements preserved)

// Derive doc schemas with zx helpers (preferred — works for slim models too)
zx.doc(UserModel)        // Zod schema with _id and _creationTime
zx.docArray(UserModel)   // z.array(doc) for return types
zx.update(UserModel)     // _id required, all other fields optional
```

Full models also expose the same schemas eagerly as `UserModel.schema.doc` / `UserModel.schema.docArray`; prefer the `zx.*` form in new code — it works for both full and slim models.

## TypeScript Performance Tip

Standard Zod `.pick()` works great for most schemas. If you hit TypeScript instantiation depth limits (rare, 100+ fields), zodvex ships `pickShape` and `safePick` as drop-in alternatives — see [Large Schemas](./large-schemas.md).
