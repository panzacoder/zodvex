# Return Type Helpers

`returnsAs` provides a type hint helper for spots where TypeScript's inference needs a nudge.

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

`returnsAs` is a no-op at runtime — it only exists to satisfy TypeScript when return type inference is ambiguous.
