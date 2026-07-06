# Return Type Helpers

`returnsAs` provides a type hint helper for spots where TypeScript's inference needs a nudge — typically when a handler's return type is widened by intermediate transforms (mapping over query results, conditional branches) and no longer matches the declared `returns` schema exactly.

```ts
import { z } from 'zod'
import { zx, returnsAs } from 'zodvex'
import { zq } from './functions'
import { Users } from './models'

const UserDocs = zx.docArray(Users)

export const listUsers = zq({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db.query('users').collect()
    // Use returnsAs for a type hint in tricky inference spots
    return returnsAs<typeof UserDocs>()(rows)
  },
  returns: UserDocs
})
```

`returnsAs` is a no-op at runtime — it only exists to satisfy TypeScript when return type inference is ambiguous. Most functions don't need it; reach for it only when the compiler complains about a handler return that you know matches the `returns` schema.
