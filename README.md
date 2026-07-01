# zodvex

#### [Zod](https://zod.dev/) + [Convex](https://www.convex.dev/)

Use Zod v4 as your schema language for Convex — define your data once and use it end to end, with automatic validation and codecs at every boundary.

> Interoperates with [convex-helpers](https://github.com/get-convex/convex-helpers) — custom function contexts and streams work out of the box

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

**zodvex lets you use Zod v4 as your schema language for Convex.** Define your tables, function arguments, and return types once as Zod schemas and use them end to end — database to frontend. On top of that foundation, zodvex adds what plain validator-mapping doesn't: function I/O is validated automatically, and `ctx.db` is codec-aware.

- **Define your schema once, in Zod.** Model your tables, arguments, and return types as Zod v4 schemas, then reuse the same definitions across your database, server, and client. `defineZodModel` builds the table; `defineZodSchema` assembles the Convex schema from your models.

- **Automatic runtime validation at every boundary.** Function arguments and return values are validated against your schemas — *and so is every document read at the database layer*. Validating at the database boundary, not just at function edges, is a differentiator on its own: most Zod-and-Convex setups validate function I/O but hand you unvalidated rows.

- **Codecs at your application boundaries.** `zx.date()`, `zx.codec()`, and typed IDs encode and decode automatically wherever data crosses a boundary — database reads and writes, function arguments, and return values. Your handlers work with `Date` objects and branded IDs while the wire format stays Convex-safe.

- **Codegen that complements Convex's own.** An optional CLI emits a `_zodvex/` folder alongside Convex's `_generated/` (it complements it, never replaces it), giving you:
  - **Client-safe schema imports** — import your Zod models on the frontend from one stable path, without reaching into server-only backend code.
  - **Inferred validators for frontend queries** — typed hooks (`useZodQuery` / `useZodMutation`) infer argument and return types straight from your function definitions, so your Convex functions stay the single source of truth.

zodvex ships its own Zod → Convex mapping layer — codec awareness and Convex's exact optional/nullable semantics require deeper integration than a standalone converter can offer. If one-shot validator conversion is all you need, `convex-helpers/zod4` provides that with less machinery; zodvex is for when Zod is your schema language across the whole app. (`convex-helpers` remains a peer dependency — zodvex uses its custom-function convention and stream primitives, and composes with the rest of its ecosystem. And zodvex is not a middleware or function-composition framework: its "middleware" is the codec-aware db, configured once via `initZodvex`.)

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

`initZodvex` wraps `ctx.db` so reads decode automatically and writes encode automatically.

- **`zx.date()`** — Date ↔ timestamp codec. Stored as `v.float64()`, used as `Date` in handlers.
- **`zx.codec(wire, runtime, transforms)`** — Custom codecs for complex transformations (encryption, serialization, etc.).
- **`zx.id('table')`** — Typed Convex ID validator with `GenericId<T>` branding. This is NOT a codec — no wire transformation happens.

Guides: [Custom Codecs](./docs/guide/custom-codecs.md), [Date Handling](./docs/guide/date-handling.md)

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

### Using zodvex Without Codecs

`zodTable` and `zQueryBuilder` still work without `initZodvex`:

```ts
import { zodTable, zQueryBuilder } from 'zodvex/legacy'
import { query } from './_generated/server'

const Users = zodTable('users', { name: z.string() })
const zq = zQueryBuilder(query)
```

At this level, zodvex offers roughly what `convex-helpers/zod4` does. This is a valid stepping-stone, but the API is deprecated. When you're ready for codecs, see the [Quick Start](#quick-start) above.

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

- Migration tooling: vanilla Convex → zodvex (for new adopters with existing Convex projects)
- Migration tooling: pre-0.5 → current zodvex
- Additional example projects (e.g., full-stack with React, codegen showcase)
- Per-feature READMEs in examples/task-manager/

## License

MIT

---

Built with ❤️ for the [Convex](https://www.convex.dev/) ecosystem — with early foundations from [convex-helpers](https://github.com/get-convex/convex-helpers)
