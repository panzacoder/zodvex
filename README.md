# zodvex

#### [Zod](https://zod.dev/) + [Convex](https://www.convex.dev/)

Use Zod v4 as your schema language for Convex — define your data once and use it end to end, with automatic validation and codecs at every boundary.

## Table of Contents

- [Why zodvex?](#why-zodvex)
- [Installation](#installation)
- [Quick Start](#quick-start)
- [Import Paths](#import-paths)
- [Features](#features)
  - [Codec-Aware Database](#codec-aware-database)
  - [Row-Level Rules & Audit](#row-level-rules--audit)
  - [Codegen & Client-Side Schema Sharing](#codegen--client-side-schema-sharing)
- [Supported Types](#supported-types)
- [Upgrading?](#upgrading)
- [API Reference](#api-reference)
- [Roadmap](#roadmap)
- [License](#license)

## Why zodvex?

**zodvex lets you use Zod v4 as your schema language for Convex.** Define your tables, function arguments, and return types once as Zod schemas and use them end to end — database to frontend. Two things make that real:

- **Functions run full Zod pipelines.** Your argument and return schemas execute as real Zod at runtime — refinements like `.min()` and `.email()`, transformations, codecs — not erased down to structural checks.

- **The database is Zod-validated, automatically.** `ctx.db` parses every read and encodes every write through your schemas: `.email()` holds at the row level where Convex's structural checks stop, and codecs live in the schema itself — handlers see `Date` objects and branded IDs while Convex stores plain values.

On the same foundation: row-level rules (`.withRules()`) and audit hooks (`.audit()`) on the wrapped db, client-safe models you can import in React, and optional codegen with typed hooks. All of it wired once with `initZodvex` — see [Features](#features).

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
import { zx, defineZodModel } from 'zodvex'

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
import { zx } from 'zodvex'
import { zq, zm } from './functions'
import { EventModel } from './models'

export const list = zq({
  args: {},
  returns: zx.docArray(EventModel),
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

> `zx.id('events')` is a typed Convex ID validator — type branding for `GenericId<'events'>` with no wire transform (not a codec). `zx.date()` and `zx.codec()` are codecs.

See the full [quickstart example](./examples/quickstart/) for a runnable project.

## Import Paths

Four primary entry points:

- **`zodvex`** — Client-safe full-Zod surface. Use in React components and shared code.
- **`zodvex/server`** — Server-only. Use in Convex functions and schema definitions.
- **`zodvex/mini`** — Client-safe zod/mini surface.
- **`zodvex/mini/server`** — Server-only zod/mini surface.

Two deprecated paths remain for migration only:

- **`zodvex/legacy`** — Deprecated runtime APIs kept only for migration.
- **`zodvex/core`** — Deprecated compatibility alias for `zodvex`.

## Features

### Codec-Aware Database

`initZodvex` wraps `ctx.db` so reads decode automatically and writes encode automatically. Codecs are opt-in per field — schemas without them get the same validation, typed IDs, and correct optional/nullable mapping through the exact same setup.

- **`zx.date()`** — Date ↔ timestamp codec. Stored as `v.float64()`, used as `Date` in handlers.
- **`zx.codec(wire, runtime, transforms)`** — Custom codecs for complex transformations (encryption, serialization, etc.).
- **`zx.id('table')`** — Typed Convex ID validator with `GenericId<T>` branding — no wire transform (not a codec).

Guides: [Custom Codecs](./docs/guide/custom-codecs.md), [Date Handling](./docs/guide/date-handling.md)

### Row-Level Rules & Audit

The same wrapped `ctx.db` carries per-row security and observability — both operating on decoded documents (`Date` objects, typed IDs), never wire values:

- **`.withRules(ruleCtx, rules)`** — gate and transform reads and writes per table (`read`, `insert`, `patch`, `replace`, `delete`), with an optional deny-by-default policy.
- **`.audit({ afterRead, afterWrite })`** — observe successful reads and writes; composes with `.withRules()`, so audit sees only what the rules allowed.

Guide: [Rules & Audit](./docs/guide/rules-and-audit.md)

### Codegen & Client-Side Schema Sharing

zodvex includes an optional CLI that generates typed client code:

- **Typed hooks** — `useZodQuery`, `useZodMutation` with automatic codec decode
- **Boundary helpers** — `encodeArgs`, `decodeResult` for custom client integrations
- **Cross-function auto-codec** — `ctx.runQuery` / `ctx.runMutation` encode args + decode results, and `ctx.scheduler.runAfter` / `ctx.scheduler.runAt` encode args, via the registry. Pass natural decoded values; zodvex encodes them to wire at the call site.

```bash
zodvex generate   # one-shot generation
zodvex dev        # watch mode
```

**When you need codegen:** Full-stack apps with React frontends wanting typed client hooks.

**When you DON'T:** Server-side codec-aware DB works with just `initZodvex` — no codegen needed.

Guides: [Codegen](./docs/guide/codegen.md) | Example: [examples/task-manager/](./examples/task-manager/)

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

¹ Enum unions carry a cosmetically different TypeScript signature than hand-written `v.union(v.literal(...))` calls — identical values, runtime validation, and type safety. Details: [Mapping Helpers](./docs/guide/mapping-helpers.md#zod-v4-enum-type-note).

**zx namespace types:**

```ts
import { zx } from 'zodvex'

// Convex IDs — typed validator (type branding, no wire transform)
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

> **Upgrading from a previous version?** Read the [migration guide](./MIGRATION.md) for what changed in each release and why.

Automated renames are available:

```bash
npx zodvex migrate ./convex            # apply renames
npx zodvex migrate ./convex --dry-run  # preview changes
```

## API Reference

- [The zx Namespace](./docs/guide/zx-namespace.md) — `zx.id()`, `zx.date()`, `zx.codec()`
- [Builders](./docs/guide/builders.md) — `initZodvex` and legacy builders
- [Custom Context](./docs/guide/custom-context.md) — `.withContext()`, `onSuccess`
- [Rules & Audit](./docs/guide/rules-and-audit.md) — `.withRules()`, `.audit()` on `ctx.db`
- [Custom Codecs](./docs/guide/custom-codecs.md) — `zx.codec()`, `decodeDoc`/`encodeDoc`
- [Date Handling](./docs/guide/date-handling.md) — `zx.date()` deep dive
- [Form Validation](./docs/guide/form-validation.md) — react-hook-form integration
- [Working with Subsets](./docs/guide/working-with-subsets.md) — `.pick()`, `.fields`
- [Mapping Helpers](./docs/guide/mapping-helpers.md) — `zodToConvex`, `zodToConvexFields`
- [Return Type Helpers](./docs/guide/return-type-helpers.md) — `returnsAs`
- [Large Schemas](./docs/guide/large-schemas.md) — `pickShape`, `safePick`
- [Polymorphic Tables](./docs/guide/polymorphic-tables.md) — Union/discriminated union tables
- [Streams](./docs/guide/streams.md) — `zodvexStream`, `zodvexMergedStream` for fan-out pagination
- [AI SDK Compatibility](./docs/guide/ai-sdk.md) — Vercel AI SDK integration
- [Codegen](./docs/guide/codegen.md) — CLI, registry, typed hooks

## Roadmap

See the [roadmap](./docs/roadmap.md) for where zodvex is heading — deploy-scale performance, ecosystem interop, and the model/namespace evolution.

## License

MIT

---

Built with ❤️ for the [Convex](https://www.convex.dev/) ecosystem. Thanks to [convex-helpers](https://github.com/get-convex/convex-helpers) for the early foundations.
