# Working with Large Schemas

zodvex provides `pickShape` and `safePick` helpers as alternatives to Zod's `.pick()` when dealing with schemas that have many fields.

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

These helpers extract the raw shape object rather than operating through Zod's `.pick()` method, which avoids the deep recursive type instantiation that causes slowdowns at 100+ fields.
