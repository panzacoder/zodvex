# Post-consolidation flavor sweep

Final validation after merging api.lazy.* + tableMap.lazy.* into a single
`_zodvex/server.ts`. Both flavors now scale identically to pure-convex
limits.

## Real Convex deploys

  Flavor               N=500      N=1000     N=2000
  ──────────────────────────────────────────────────
  zodvex               ok 30s     ok 37s     TooManyReads
  zodvex-mini          ok 11s     ok 34s     TooManyReads

`TooManyReads` is Convex's own per-function-execution operation limit
during `finish_push` (4096 records). Not a memory ceiling. The same
N≈2000 wall pure-convex and convex-helpers/zod3 hit.

## Where this lands the memory story

Stack of fixes that combined to get here:

  1. lazy registry inside server.ts (was api.lazy.js)
  2. schema-only-thin: defineZodvexSchema + codegen tables.ts
  3. lazy tableMap inside server.ts (was tableMap.lazy.js)
  4. _zodvex/convex.config.ts marker — Convex skips the directory

Each fix targets a distinct ceiling. Removing any one of them brings
the ceiling back at a lower N. With all four, zodvex matches the
pure-convex baseline.

## Userland surface

What the consumer now writes:

```ts
// convex/schema.ts
import { defineZodvexSchema } from 'zodvex/server'
import tables, { type DecodedDocs } from './_zodvex/tables'
export default defineZodvexSchema<typeof tables, DecodedDocs>(tables)

// convex/functions.ts
import {
  query, mutation, action,
  internalQuery, internalMutation, internalAction,
} from './_generated/server'
import { initZodvex } from './_zodvex/server'

export const { zq, zm, za, ziq, zim, zia } = initZodvex({
  query, mutation, action, internalQuery, internalMutation, internalAction,
})
```

No async/await knowledge. No `registry:` or `tableMap:` lines. No
awareness that lazy patterns exist. The marker file is invisible.
Two imports per file, one call.

## What still ships in `_zodvex/`

  api.js + api.d.ts          heavy registry, lazy-loaded
  client.js + client.d.ts    pre-bound hooks for frontend
  schema.js + schema.d.ts    model re-exports for client codegen
  server.ts                  consolidated: context types, lazy thunks,
                             pre-wired initZodvex
  tables.ts                  pure-Convex defineTable map + DecodedDocs
  convex.config.ts           NOOP marker (Convex skips this directory)

Down from 8 files (after this PR's additions but before consolidation)
to 6.

## Out of scope

- `examples/task-manager-mini` and `examples/quickstart` still on the
  pre-consolidation shape.
- Migrate transform to flip existing apps to the new userland surface.
- CHANGELOG entry consolidating the memory story.
- Convex feedback on whether `convex.config.ts` is the intended marker
  mechanism, or whether they'd prefer a more purpose-built convention.
