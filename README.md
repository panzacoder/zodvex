zodvex

Zod v4 → Convex validator mapping with correct optional vs nullable semantics. Thin, practical glue around `convex-helpers` that preserves Convex’s notion of optional fields and offers ergonomic wrappers/codecs.

Why

- Convex treats optional object fields only when wrapped with `v.optional(...)`.
- Some mappers represent `.optional()` as `v.union(T, v.null())`, which still requires the key and changes semantics.
- zodvex normalizes per-field validators so that:
  - optional only → `v.optional(T)`
  - nullable only → `v.union(T, v.null())`
  - optional + nullable → `v.optional(v.union(T, v.null()))`

What’s Included

- Low-level mapping helpers
  - `zodToConvex(z: ZodTypeAny): Validator`
  - `zodToConvexFields(shapeOrObject: ZodRawShape | Record<string, ZodTypeAny> | ZodObject<any>): Record<string, Validator>`
- Function wrappers (typed, Zod-validated)
  - `zQuery(query, input, handler, { returns? })`
  - `zMutation(mutation, input, handler, { returns? })`
  - `zAction(action, input, handler, { returns? })`
  - `zInternalQuery(...)`, `zInternalMutation(...)`, `zInternalAction(...)`
  - Input can be a Zod object, a raw shape object, or a single Zod type. If a single Zod type is provided, args normalize to `{ value: ... }`.
  - Optional `returns` lets you specify a Zod schema for return validation (see notes below for Dates/encoding).
- Codecs
  - `convexCodec(schema)` with:
    - `toConvexSchema()` → Convex validators (object fields or a single validator)
    - `encode(data)` → zod-shaped data → Convex-safe JSON (omits `undefined`, converts `Date` → timestamp)
    - `decode(data)` → Convex JSON → zod-shaped data (timestamps → `Date`)
    - `pick({ key: true })` → derive a sub-codec (ZodObject only)
- Table helper
  - `zodTable(name, zodObject)` → returns a helper with:
    - `.table` → feed into `defineSchema`
    - `.schema` → original Zod schema
    - `.codec` → codec built from the schema (`toConvexSchema/encode/decode`)
- CRUD helper
  - `zCrud(table, queryBuilder, mutationBuilder)` → returns `{ create, read, paginate, update, destroy }` using Zod-validated args and `zid(tableName)`

Usage

Define a table from Zod in one place

```ts
import { z } from 'zod'
import { zodTable } from 'zodvex'

const zAgencies = z.object({
  name: z.string(),
  managerList: z.array(z.string()).optional() // → v.optional(v.array(v.string()))
})

export const Agencies = zodTable('agencies', zAgencies)
// In schema.ts → Agencies.table.index(...)
```

Zod-validated Convex functions

```ts
import { z } from 'zod'
import { query, mutation } from './_generated/server'
import { zQuery, zMutation } from 'zodvex'

export const getById = zQuery(
  query,
  { id: z.string() },
  async (ctx, { id }) => ctx.db.get(id)
)

export const setName = zMutation(
  mutation,
  z.object({ id: z.string(), name: z.string() }),
  async (ctx, { id, name }) => ctx.db.patch(id, { name })
)

// Single-value args normalize to { value }
export const ping = zQuery(query, z.string(), async (ctx, { value }) => value)
```

CRUD scaffold from a table

```ts
import { zCrud } from 'zodvex'
import { query, mutation } from './_generated/server'
import { Agencies } from './schemas/agencies'

export const agenciesCrud = zCrud(Agencies, query, mutation)
// agenciesCrud.create/read/paginate/update/destroy
```

Codec usage

```ts
import { convexCodec } from 'zodvex'
import { z } from 'zod'

const zUser = z.object({
  name: z.string(),
  birthday: z.date().optional()
})

const UserCodec = convexCodec(zUser)
const validators = UserCodec.toConvexSchema() // for Table(...)
const toWrite = UserCodec.encode({ name: 'A', birthday: new Date() }) // Date → timestamp
const toRead = UserCodec.decode({ name: 'A', birthday: Date.now() }) // timestamp → Date
```

Behavior & Semantics

- Optional vs nullable
  - `.optional()` becomes `v.optional(T)`
  - `.nullable()` becomes `v.union(T, v.null())`
  - Both → `v.optional(v.union(T, v.null()))`
- Arrays/objects/records
  - Mapping uses Zod v4 public APIs (`shape`, `element`, `options`, `valueType`).
- Returns validation
  - If you supply `returns`, wrappers validate the handler’s return value with the Zod schema and encode it to Convex-safe JSON (e.g., `z.date()` → timestamp) before returning.
- Numbers
  - `z.number()` maps to `v.float64()` to match Convex JSON. If you need integers, prefer `z.bigint()` (→ `v.int64()`) or handle integer checks at runtime.
- IDs
  - Use `zid('table')` from `convex-helpers/server/zodV4` inside Zod schemas for Convex Ids.
- Fallbacks
  - Unsupported Zod types (e.g., `ZodEffects` transforms, `ZodTuple`, `ZodIntersection`, maps/sets) fall back to `v.any()`.

Compatibility

- Zod v4 only. This library uses only Zod’s public v4 APIs and does not attempt v3 compatibility.

Notes

- Defaults imply optional at the Convex schema level; apply runtime defaults in app code as needed.
- This package builds on `convex-helpers/server/zodV4` and post-processes validators to preserve Convex’s optional/null semantics.

Install

- Peer dependencies (must be installed by the host app):
  - `zod` (v4)
  - `convex` (>= 1.27)
  - `convex-helpers` (>= 0.1.101-alpha.1)

Using pnpm:

```bash
# add peers (if not already present)
pnpm add zod convex convex-helpers

# add this package
pnpm add zodvex
```

Using npm:

```bash
npm install zod convex convex-helpers
npm install zodvex
```

Using yarn:

```bash
yarn add zod convex convex-helpers
yarn add zodvex
```
