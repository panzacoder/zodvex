# zodvex

#### [Zod](https://zod.dev/) + [Convex](https://www.convex.dev/)

Type-safe Convex functions with Zod v4 schemas. Codecs in the schema — `zx.date()`, custom transformations — plus typed IDs, all wired up through `initZodvex`.

> Built on top of [convex-helpers](https://github.com/get-convex/convex-helpers)

## Table of Contents

- [Why zodvex?](#why-zodvex)
- [Installation](#installation)
- [Quick Start](#quick-start)
- [Import Paths](#import-paths)
- [Features](#features)
  - [Codec-Aware Database](#codec-aware-database)
  - [Codegen & Client-Side Schema Sharing](#codegen--client-side-schema-sharing)
  - [Using zodvex Without Codecs](#using-zodvex-without-codecs)
- [Supported Types](#supported-types)
- [Upgrading?](#upgrading)
- [API Reference](#api-reference)
- [Roadmap](#roadmap)
- [License](#license)

## Why zodvex?

- **Codec-aware database** — `zx.date()`, `zx.codec()` encode/decode automatically at `ctx.db` boundaries
- **Correct optional/nullable semantics** — preserves Convex's distinction (`.optional()` → `v.optional(T)`, `.nullable()` → `v.union(T, v.null())`)
- **Client-safe models** — `defineZodModel` is importable in React
- **End-to-end type safety** — same schema from database to frontend forms

| Feature | zodvex | convex-helpers/zod4 |
|---------|--------|---------------------|
| Codec-aware DB | `initZodvex` wraps `ctx.db` automatically | Manual |
| Date handling | `zx.date()` — automatic Date ↔ timestamp | Manual `z.codec()` |
| Typed IDs | `zx.id('table')` with type branding | Manual |
| Custom codecs | `zx.codec()` with auto-detection | Not provided |
| Client-safe models | `defineZodModel` (importable in React) | Not provided |
| Codegen | Optional typed hooks, boundary helpers | Not provided |

Both are valid choices — zodvex trades some explicitness for significantly better ergonomics.

## Installation

```bash
npm install zodvex zod convex convex-helpers
```

**Peer dependencies:**

- `zod` (^4.3.6)
- `convex` (^1.28.0)
- `convex-helpers` (^0.1.104)
- TypeScript 5.x recommended

## Quick Start

### Step 1. Define your models

```ts
// convex/models.ts
import { z } from 'zod'
import { zx, defineZodModel } from 'zodvex/core'

export const EventModel = defineZodModel('events', {
  title: z.string(),
  startDate: zx.date(),
  endDate: zx.date().optional(),
  location: z.string().optional(),
})
```

> `defineZodModel` is client-safe — you can import it in React.

### Step 2. Build your schema

```ts
// convex/schema.ts
import { defineZodSchema } from 'zodvex/server'
import { EventModel } from './models'

export default defineZodSchema({
  events: EventModel,
})
```

### Step 3. Set up builders

```ts
// convex/functions.ts
import { initZodvex } from 'zodvex/server'
import {
  query, mutation, action,
  internalQuery, internalMutation, internalAction,
} from './_generated/server'
import schema from './schema'

export const { zq, zm, za, ziq, zim, zia } = initZodvex(schema, {
  query, mutation, action,
  internalQuery, internalMutation, internalAction,
})
```

`initZodvex` returns builders for all six Convex function types. By default, `zq` and `zm` (and internal variants) wrap `ctx.db` with automatic codec encode/decode.

### Step 4. Write functions — Date conversion Just Works

```ts
// convex/events.ts
import { z } from 'zod'
import { zx } from 'zodvex/core'
import { zq, zm } from './functions'
import { EventModel } from './models'

export const list = zq({
  args: {},
  returns: EventModel.schema.docArray,
  handler: async (ctx) => {
    // Dates come back as Date objects, not numbers
    return await ctx.db.query('events').collect()
  },
})

export const create = zm({
  args: {
    title: z.string(),
    startDate: zx.date(),
    endDate: zx.date().optional(),
    location: z.string().optional(),
  },
  returns: zx.id('events'),
  handler: async (ctx, args) => {
    // Dates are automatically encoded to timestamps on write
    return await ctx.db.insert('events', args)
  },
})
```

> `zx.id('events')` is a typed Convex ID validator — it provides type branding for `GenericId<'events'>` but is NOT a codec (no wire transformation happens). `zx.date()` and `zx.codec()` ARE codecs.

See the full [quickstart example](./examples/quickstart/) for a runnable project.

## Import Paths

Three entry points:

- **`zodvex/core`** — Client-safe. Use in React components and shared code.
- **`zodvex/server`** — Server-only. Use in Convex functions and schema definitions.
- **`zodvex`** — Full library. Convenient but pulls in server code.

> Use `zodvex/core` for client bundles to keep them small.

## Features

### Codec-Aware Database

`initZodvex` wraps `ctx.db` so reads decode automatically and writes encode automatically.

- **`zx.date()`** — Date ↔ timestamp codec. Stored as `v.float64()`, used as `Date` in handlers.
- **`zx.codec(wire, runtime, transforms)`** — Custom codecs for complex transformations (encryption, serialization, etc.).
- **`zx.id('table')`** — Typed Convex ID validator with `GenericId<T>` branding. This is NOT a codec — no wire transformation happens.

Guides: [Custom Codecs](./docs/guide/custom-codecs.md), [Date Handling](./docs/guide/date-handling.md)

### Codegen & Client-Side Schema Sharing

zodvex includes an optional CLI that generates typed client code:

- **Typed hooks** — `useZodQuery`, `useZodMutation` with automatic codec decode
- **Boundary helpers** — `encodeArgs`, `decodeResult` for custom client integrations
- **Action auto-decode** — `ctx.runQuery` / `ctx.runMutation` decode via registry

```bash
zodvex generate   # one-shot generation
zodvex dev        # watch mode
```

**When you need codegen:** Full-stack apps with React frontends wanting typed client hooks.

**When you DON'T:** Server-side codec-aware DB works with just `initZodvex` — no codegen needed.

Guides: [Codegen](./docs/guide/codegen.md) | Example: [examples/task-manager/](./examples/task-manager/)

### Using zodvex Without Codecs

`zodTable` and `zQueryBuilder` still work without `initZodvex`:

```ts
import { zodTable, zQueryBuilder } from 'zodvex/server'
import { query } from './_generated/server'

const Users = zodTable('users', { name: z.string() })
const zq = zQueryBuilder(query)
```

At this level, zodvex is roughly equivalent to convex-helpers. This is a valid stepping-stone — when you're ready for codecs, see the [Quick Start](#quick-start) above.

## Supported Types

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

> **Note:** Native `z.date()` is **not supported** — use `zx.date()` instead. See [Date Handling](./docs/guide/date-handling.md) for details.

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

- Value types are identical (`"a" | "b"`)
- Runtime validation is identical
- Type safety for function arguments/returns is preserved
- Convex uses `T[number]` which works identically for both array and tuple types

This limitation exists because Zod v4 changed enum types from tuple-based to Record-based ([`ToEnum<T>`](https://github.com/colinhacks/zod/blob/v4/src/v4/core/util.ts#L83-L85)). TypeScript cannot convert a Record type to a specific tuple without knowing the keys at compile time. See [Zod v4 changelog](https://zod.dev/v4/changelog) and [enum evolution discussion](https://github.com/colinhacks/zod/discussions/2125) for more details.

**zx namespace types:**

```ts
import { zx } from 'zodvex'

// Convex IDs — typed validator, NOT a codec
zx.id('tableName')            // → v.id('tableName')
zx.id('tableName').optional() // → v.optional(v.id('tableName'))

// Dates — codec (Date ↔ timestamp)
zx.date()            // → v.float64() (timestamp)
zx.date().optional() // → v.optional(v.float64())
zx.date().nullable() // → v.union(v.float64(), v.null())

// Custom codecs
zx.codec(wireSchema, runtimeSchema, { encode, decode })
```

## Upgrading?

> **Upgrading from a previous version?** Read the [migration guide](./docs/migration/v0.6.md) for what changed and why. Key takeaway: the CLI/codegen is optional — the Quick Start path above needs no codegen.

Automated renames are available:

```bash
npx zodvex migrate ./convex            # apply renames
npx zodvex migrate ./convex --dry-run  # preview changes
```

## API Reference

- [The zx Namespace](./docs/guide/zx-namespace.md) — `zx.id()`, `zx.date()`, `zx.codec()`
- [Builders](./docs/guide/builders.md) — `initZodvex` and legacy builders
- [Custom Context](./docs/guide/custom-context.md) — `.withContext()`, `onSuccess`
- [Custom Codecs](./docs/guide/custom-codecs.md) — `zx.codec()`, `decodeDoc`/`encodeDoc`
- [Date Handling](./docs/guide/date-handling.md) — `zx.date()` deep dive
- [Form Validation](./docs/guide/form-validation.md) — react-hook-form integration
- [Working with Subsets](./docs/guide/working-with-subsets.md) — `.pick()`, `.fields`
- [Mapping Helpers](./docs/guide/mapping-helpers.md) — `zodToConvex`, `zodToConvexFields`
- [Return Type Helpers](./docs/guide/return-type-helpers.md) — `returnsAs`
- [Large Schemas](./docs/guide/large-schemas.md) — `pickShape`, `safePick`
- [Polymorphic Tables](./docs/guide/polymorphic-tables.md) — Union/discriminated union tables
- [AI SDK Compatibility](./docs/guide/ai-sdk.md) — Vercel AI SDK integration
- [Codegen](./docs/guide/codegen.md) — CLI, registry, typed hooks

## Roadmap

- Migration tooling: vanilla Convex → zodvex (for new adopters with existing Convex projects)
- Migration tooling: pre-0.5 → current zodvex
- Additional example projects (e.g., full-stack with React, codegen showcase)
- Per-feature READMEs in examples/task-manager/

## License

MIT

---

Built with ❤️ on top of [convex-helpers](https://github.com/get-convex/convex-helpers)
