# Codec-Aware Database Infrastructure Design

> **Status**: Draft (hooks resolved)
> **Date**: 2026-02-15
> **Context**: zodvex issue #37 revealed that codec support is incomplete — codecs work at the wrapper/validator level but not at the database access or client boundaries. This design generalizes the codec pipeline so it works across all boundaries.

---

## Architecture Overview

zodvex asserts opinions about how codecs work and where they run. By supporting codecs in schemas (`zx.date()`, `zx.codec()`), zodvex takes responsibility for the full wire↔runtime boundary — not just validation, but automatic transforms at every layer.

### Layers

1. **`defineZodSchema()`** — Wraps Convex's `defineSchema()` to capture zodTable references alongside Convex table definitions. The schema becomes the single source of truth for both Convex validators and Zod codec schemas.

2. **`initZodvex(schema, server)`** — One-time initialization that returns pre-configured builders (`zq`, `zm`, `za`, etc.) with codecs automatic. Also returns `zCustomCtx` for advanced context customization.

3. **DB wrapping** — Codec-aware wrapper around `GenericDatabaseReader`/`GenericDatabaseWriter` that auto-decodes on read and auto-encodes on write. Preserves the full Convex query API. Advanced users add hooks via `createDatabaseHooks()` + `.withHooks()` on builders (parallel to convex-helpers' `wrapDatabaseReader/Writer`).

4. **Primitive utilities** — `decodeDoc()` and `encodeDoc()` as escape hatches for consumers who build their own DB layer.

5. **Client-side decode** — `decodeResult()` in `zodvex/core` (client-safe) for decoding wire-format results on the frontend.

6. **Auto-encode in wrappers** — Builders auto-encode args via `z.encode()`, eliminating manual arg processing (replaces patterns like hotpot's `processSensitiveArgs`).

### Export Structure

- `zodvex/core` — Client-safe: `decodeResult`, `encodeArgs`, `zx`, types
- `zodvex/server` — Server-only: `initZodvex`, `defineZodSchema`, `zCustomCtx`, `decodeDoc`, `encodeDoc`, `zodTable`, builders
- `zodvex` — Everything (backwards compatible)

---

## Schema Definition: `defineZodSchema()`

Wraps Convex's `defineSchema()` to capture zodTable references. The return value is a valid Convex schema definition (Convex codegen still works) plus carries zodTable metadata for zodvex.

```typescript
// schema.ts
import { defineZodSchema, zodTable } from 'zodvex/server'

export const Events = zodTable('events', {
  title: z.string(),
  startDate: zx.date(),
  endDate: zx.date().optional(),
  organizerId: zx.id('users'),
})

export const Users = zodTable('users', {
  name: z.string(),
  email: z.string(),
})

export default defineZodSchema({
  events: Events,
  users: Users,
})
```

Internally, `defineZodSchema`:
1. Calls Convex's `defineSchema()` with `.table` from each zodTable (Convex gets what it needs)
2. Stores zodTable references on a `.zodTables` property (zodvex gets what it needs)

### zodTable Enhancement

`zodTable()` will store its table name on the return value (additive, non-breaking):

```typescript
// Current return:
{ table, schema: { doc, docArray, base, insert, update } }

// Enhanced return:
{ name: 'events', table, schema: { doc, docArray, base, insert, update } }
```

---

## Initialization: `initZodvex()`

One-time setup that creates all pre-configured builders. Accepts the schema from `defineZodSchema()` and the Convex server functions.

```typescript
import schema from './schema'
import * as server from './_generated/server'
import { initZodvex } from 'zodvex/server'

export const {
  // Ready-to-use builders (codecs automatic)
  zq, zm, za,           // public query, mutation, action
  ziq, zim, zia,        // internal query, mutation, action

  // For custom context augmentation
  zCustomCtx,
  zCustomCtxWithArgs,
} = initZodvex(schema, server)
```

Internally, `initZodvex` calls `zQueryBuilder(server.query, schema)` etc. for each builder, and returns `zCustomCtx`/`zCustomCtxWithArgs` pre-configured with the schema.

### What the builders do

- `zq`, `ziq` — `zQueryBuilder(query, schema)`: Zod validation on args/returns + auto-decode `ctx.db` reads
- `zm`, `zim` — `zMutationBuilder(mutation, schema)`: Zod validation + auto-decode reads + auto-encode writes
- `za`, `zia` — `zActionBuilder(action, schema)`: Zod validation on args/returns (actions have no `ctx.db`)

### Codegen (future)

With codegen, `_generated/zodvex.ts` would contain the `initZodvex` call automatically:

```typescript
// _generated/zodvex.ts (auto-generated)
import schema from '../schema'
import * as server from './server'
import { initZodvex } from 'zodvex/server'

export const { zq, zm, za, ziq, zim, zia, zCustomCtx, zCustomCtxWithArgs } =
  initZodvex(schema, server)
```

Manual setup today, codegen tomorrow. Same output either way.

---

## Context Customization: `zCustomCtx()` / `zCustomCtxWithArgs()`

Parallels convex-helpers' `customCtx()` and `customCtxAndArgs()`, but pre-configured with the zodvex schema for codec support.

### `zCustomCtx(fn)`

Augments the context with additional properties. The function receives the raw Convex ctx and an optional `extra` parameter for definition-level keys (like `required`).

```typescript
// Simple auth context
const authCtx = zCustomCtx(async (ctx) => {
  const user = await getUser(ctx)
  return { user }
})

export const authQuery = zq.withContext(authCtx)

// With extra definition-level keys
const hotpotCtx = zCustomCtx(async (ctx, extra?: { required?: HotpotEntitlement[] }) => {
  const securityCtx = await resolveContext(ctx)
  if (extra?.required) assertEntitlements(securityCtx, extra.required)
  return { securityCtx }
})
```

### `zCustomCtxWithArgs({ args, input })`

Like `zCustomCtx` but also adds custom args to the Convex function's arg validator. Parallels `customCtxAndArgs` from convex-helpers. The `extra` parameter is available here too — it's orthogonal to "WithArgs".

```typescript
// Adds sessionId to every function's args
const sessionCtx = zCustomCtxWithArgs({
  args: { sessionId: z.string() },
  input: async (ctx, { sessionId }, extra?) => {
    const session = await loadSession(ctx, sessionId)
    return { session }
  },
})
```

### ExtraArgs

Both `zCustomCtx` and `zCustomCtxWithArgs` support an optional `extra` parameter on the `input` function. This is separate from "WithArgs" (which adds required args to the function's arg validator). ExtraArgs adds extra keys to the function *definition* object — keys like `required` that configure the customization but aren't Convex function arguments.

The ExtraArgs type is inferred from the `extra` parameter's type annotation. The builder ensures those keys appear on the function definition object:

```typescript
// The `extra` type flows to the function definition
export const getPatient = hotpotQuery({
  args: { patientId: zx.id('patients') },
  required: ['hotpot:clinic:patients:view'],  // typed from extra
  handler: async ({ db, securityCtx }, { patientId }) => { ... },
})
```

### Relationship to convex-helpers

| convex-helpers | zodvex | Difference |
|---|---|---|
| `customCtx(fn)` | `zCustomCtx(fn)` | Schema pre-injected, codecs on ctx.db automatic |
| `customCtxAndArgs({args, input})` | `zCustomCtxWithArgs({args, input})` | Same |
| `customQuery(query, customization)` | `zq.withContext(ctx)` (or similar) | Schema + codecs handled by builder |

---

## DB Wrapping Hooks

zodvex's hooks are the equivalent of convex-helpers' `wrapDatabaseReader()` / `wrapDatabaseWriter()` — they intercept database operations to apply transforms, security checks, or logging. The key difference: zodvex's hooks are codec-aware (they understand wire vs runtime format and where in the pipeline they run).

### `createDatabaseHooks<Ctx>()`

Factory function that creates a typed hook configuration. The `Ctx` generic flows to all hook callbacks, ensuring hooks have access to the augmented context (e.g., security context from `zCustomCtx`).

```typescript
const securityHooks = createDatabaseHooks<HotpotCtx>({
  decode: {
    before: {
      one: async (ctx, doc) => {
        // RLS check + FLS application — sees wire format
        // Return null to filter out, return doc to pass through
      },
      many: async (ctx, docs, one) => {
        // Batch RLS — receives pre-bound `one` as third arg
        // Can call `one` per-doc or implement batch logic directly
      },
    },
    after: {
      one: async (ctx, doc) => {
        // Post-decode — sees runtime format (Date, SensitiveField, etc.)
        return doc
      },
    },
  },
  encode: {
    before: async (ctx, doc) => {
      // Write RLS + FLS — sees runtime format before encoding
    },
    after: async (ctx, doc) => {
      // Post-encode — sees wire format, useful for audit logging
      return doc
    },
  },
})
```

### Hook Types

Hooks are grouped **operation-first** (decode/encode), then **timing** (before/after), then **cardinality** (one/many).

```typescript
type DecodeHooks<Ctx> = {
  before?: {
    one?:  (ctx: Ctx & SingleDocRead, doc: WireDoc) => Promise<WireDoc | null> | WireDoc | null
    many?: (
      ctx: Ctx & MultiDocRead,
      docs: WireDoc[],
      one: (doc: WireDoc) => Promise<WireDoc | null>
    ) => Promise<WireDoc[]> | WireDoc[]
  }
  after?: {
    one?:  (ctx: Ctx & SingleDocRead, doc: RuntimeDoc) => Promise<RuntimeDoc | null> | RuntimeDoc | null
    many?: (
      ctx: Ctx & MultiDocRead,
      docs: RuntimeDoc[],
      one: (doc: RuntimeDoc) => Promise<RuntimeDoc | null>
    ) => Promise<RuntimeDoc[]> | RuntimeDoc[]
  }
}

type EncodeHooks<Ctx> = {
  before?: (ctx: Ctx & WriteContext, doc: RuntimeDoc) => Promise<RuntimeDoc | null> | RuntimeDoc | null
  after?:  (ctx: Ctx & WriteContext, doc: WireDoc) => Promise<WireDoc | null> | WireDoc | null
}
```

### Hook Contexts (Discriminated Unions)

```typescript
// Read contexts — intersected with Ctx from createDatabaseHooks
interface SingleDocRead { table: string; operation: 'get' | 'first' | 'unique' }
interface MultiDocRead { table: string; operation: 'collect' | 'take' | 'paginate' }

// Write contexts
interface InsertContext { table: string; operation: 'insert' }
interface PatchContext { table: string; operation: 'patch'; existingDoc: WireDoc }
interface DeleteContext { table: string; operation: 'delete'; existingDoc: WireDoc }
```

### One/Many Relationship

- **Single-doc operations** (`.get()`, `.first()`, `.unique()`) call `one`.
- **Multi-doc operations** (`.collect()`, `.take()`, `.paginate()`) call `many`.
- Default `many`: maps `one` over array. Advanced users override for batch optimization.
- `many` receives pre-bound `one` as third arg — **chooses** whether to call it.

### Builder Composition: `.withContext()` / `.withHooks()`

Hooks attach to builders via fluent chaining. Each builder from `initZodvex` supports `.withContext()` and `.withHooks()`:

```typescript
// Base builder — codecs only (most users)
export const getEvent = zq({ ... })

// Context only — no custom DB hooks
export const authQuery = zq.withContext(authCtx)

// Hooks only — no custom context (rare, but valid)
export const auditQuery = zq.withHooks(auditHooks)

// Both — hotpot's use case
export const hotpotQuery = zq.withContext(hotpotCtx).withHooks(securityHooks)
```

**Ordering constraint**: `.withContext()` must come before `.withHooks()` when both are used, because hooks need access to the augmented context type. The fluent chain enforces this — `.withContext()` returns a builder whose `.withHooks()` method accepts hooks typed to the augmented ctx.

**Type flow through the chain:**

```typescript
zq                          // Builder<QueryCtx>
  .withContext(hotpotCtx)   // Builder<QueryCtx & { securityCtx }>
  .withHooks(securityHooks) // Builder<QueryCtx & { securityCtx }> (hooks see augmented ctx)
```

The result is a new builder — a "template" — that produces functions when called:

```typescript
const hotpotQuery = zq.withContext(hotpotCtx).withHooks(hotpotHooks)

// Calling the builder produces a Convex function
export const getPatient = hotpotQuery({ ... })
export const listPatients = hotpotQuery({ ... })
```

### Hook Composition: `composeHooks()`

`.withHooks()` accepts a single hook config. When multiple hook concerns need to combine (security + audit, etc.), use `composeHooks()`:

```typescript
import { composeHooks, createDatabaseHooks } from 'zodvex/server'

const securityHooks = createDatabaseHooks<HotpotCtx>({
  decode: {
    before: {
      one: async (ctx, doc) => { /* RLS + FLS */ },
      many: async (ctx, docs, one) => { /* batch RLS */ },
    },
  },
  encode: {
    before: async (ctx, doc) => { /* write RLS + FLS */ },
  },
})

const auditHooks = createDatabaseHooks<HotpotCtx>({
  decode: {
    after: {
      one: async (ctx, doc) => { /* log read */ return doc },
    },
  },
})

// Pipeline: security runs first at each stage, audit runs second
const hotpotHooks = composeHooks([securityHooks, auditHooks])
```

`composeHooks(hooks: DatabaseHooks[])` takes an array and pipes each stage in order — at each stage (e.g., `decode.before.one`), hook A's result feeds into hook B. For `many`, the composed `one` is also piped.

---

## Fluent Query API (Wrapper Class)

The codec-aware DB wrapper mirrors the Convex `ctx.db` API. The query chain is an explicit wrapper class (not a Proxy) that delegates query-building methods to Convex and intercepts terminal methods to apply the codec pipeline.

```typescript
// Conceptual structure (not final implementation):
class ZodQuery<TableName, Schema> {
  // Query-building — pure delegation
  withIndex(name, builder?)  -> ZodQuery
  filter(predicate)          -> ZodQuery
  order(order)               -> ZodQuery

  // Terminal methods — intercept, apply codec decode (+ hooks if configured)
  async first()              -> RuntimeDoc | null
  async unique()             -> RuntimeDoc | null
  async collect()            -> RuntimeDoc[]
  async take(n)              -> RuntimeDoc[]
  async paginate(opts)       -> PaginationResult<RuntimeDoc>
}
```

### Writer Interface

```typescript
interface ZodDbWriter {
  insert(table, doc: RuntimeDoc) -> Promise<GenericId>
  patch(table, id, patch: Partial<RuntimeDoc>) -> Promise<void>
  delete(table, id) -> Promise<void>
}
```

For `patch` and `delete`, the wrapper internally fetches the existing document before running encode hooks, making it available as `ctx.existingDoc`.

---

## Primitives (Escape Hatch)

### `decodeDoc()` / `encodeDoc()`

```typescript
function decodeDoc<S extends z.ZodType>(schema: S, raw: unknown): z.output<S>
function encodeDoc<S extends z.ZodType>(schema: S, value: z.output<S>): z.input<S>
```

For consumers who build their own DB layer and need the codec transform without the wrapper.

### Client-Side: `decodeResult()`

```typescript
// Exported from zodvex/core (client-safe, no server dependencies)
function decodeResult<S extends z.ZodType>(schema: S, data: unknown): z.output<S>
```

Decodes wire-format query results on the frontend.

---

## Usage Examples

### Simple User (Calendar App)

```typescript
// === schema.ts ===
import { defineZodSchema, zodTable, zx } from 'zodvex/server'
import { z } from 'zod'

export const Events = zodTable('events', {
  title: z.string(),
  startDate: zx.date(),
  endDate: zx.date().optional(),
  organizerId: zx.id('users'),
})

export default defineZodSchema({ events: Events })

// === functions.ts ===
import schema from './schema'
import * as server from './_generated/server'
import { initZodvex } from 'zodvex/server'

const { zq } = initZodvex(schema, server)

export const getEvent = zq({
  args: { eventId: zx.id('events') },
  returns: Events.schema.doc,
  handler: async ({ db }, { eventId }) => {
    const event = await db.get(eventId)
    // event.startDate is Date, not number — automatic
    return event
  },
})

export const listUpcoming = zq({
  args: {},
  returns: Events.schema.docArray,
  handler: async ({ db }) => {
    return await db.query('events')
      .withIndex('startDate')
      .order('desc')
      .take(10)
    // Full Convex query API, all dates decoded
  },
})

// === Client ===
import { decodeResult } from 'zodvex/core'

function EventList() {
  const rawEvents = useQuery(api.events.listUpcoming)
  const events = decodeResult(Events.schema.docArray, rawEvents)
  // events[0].startDate is Date
}
```

### Advanced User (Hotpot)

```typescript
// === setup.ts ===
import schema from './schema'
import * as server from './_generated/server'
import { initZodvex, createDatabaseHooks, composeHooks } from 'zodvex/server'

const { zq, zm, zCustomCtx } = initZodvex(schema, server)

// Context augmentation — parallels customCtx from convex-helpers
const hotpotCtx = zCustomCtx(async (ctx, extra?: { required?: HotpotEntitlement[] }) => {
  const securityCtx = await resolveContext(ctx)
  if (extra?.required) assertEntitlements(securityCtx, extra.required)
  return { securityCtx }
})

// DB wrapping hooks — parallels wrapDatabaseReader/Writer from convex-helpers
const securityHooks = createDatabaseHooks<HotpotMutationCtx>({
  decode: {
    before: {
      one: async (ctx, doc) => {
        // Per-doc RLS check + FLS application
        const rlsResult = await checkRlsRead(ctx.securityCtx, doc, ...)
        if (!rlsResult.allowed) return null
        return applyFls(doc, ...)
      },
      many: async (ctx, docs, one) => {
        // Batch RLS — ignores bound `one`, implements FLS directly
        return filterByRls(ctx.securityCtx, docs, ...)
      },
    },
  },
  encode: {
    before: async (ctx, doc) => {
      // Two-phase RLS for patch (old + new state) + FLS write policy
      await checkRlsWrite(ctx.securityCtx, doc, ...)
      return applyFlsWrite(doc, ...)
    },
  },
})

const auditHooks = createDatabaseHooks<HotpotMutationCtx>({
  decode: {
    after: {
      one: async (ctx, doc) => {
        produceReadAuditLog(ctx.securityCtx, doc)
        return doc
      },
    },
  },
  encode: {
    after: async (ctx, doc) => {
      produceWriteAuditLog(ctx.securityCtx, doc)
      return doc
    },
  },
})

const hotpotHooks = composeHooks([securityHooks, auditHooks])

// Create builders with hotpot's ctx + hooks
export const hotpotQuery = zq.withContext(hotpotCtx).withHooks(hotpotHooks)
export const hotpotMutation = zm.withContext(hotpotCtx).withHooks(hotpotHooks)

// === handlers.ts ===
export const getPatient = hotpotQuery({
  args: { patientId: zx.id('patients') },
  returns: patients.schema.doc,
  required: ['hotpot:clinic:patients:view'],
  handler: async ({ db, securityCtx }, { patientId }) => {
    const patient = await db.get(patientId)
    // patient.email is SensitiveField<string> (decoded via codec)
    // RLS checked, FLS applied, audit logged — all via hooks
    return patient
  },
})

export const listPatients = hotpotQuery({
  args: { clinicId: z.string() },
  returns: patients.schema.docArray,
  handler: async ({ db }, { clinicId }) => {
    return await db.query('patients')
      .withIndex('clinicId', iq => iq.eq('clinicId', clinicId))
      .collect()
    // Full Convex query API — resolves Heath's concern
  },
})
```

---

## Relationship to convex-helpers

zodvex builds on convex-helpers but takes a different approach to make codecs automatic.

| Concern | convex-helpers approach | zodvex approach |
|---|---|---|
| Custom context | `customCtx(fn)` | `zCustomCtx(fn)` — same pattern, schema pre-injected |
| DB wrapping | `wrapDatabaseReader(ctx, db, rules)` — manual, per-request | Auto via `initZodvex` builders; `createDatabaseHooks()` + `.withHooks()` for advanced |
| RLS | `RowLevelSecurity(components, rules)` — function-level | DB-level hooks via `createDatabaseHooks()` in codec pipeline |
| Zod validation | `zodV4` module for schema mapping | Full codec support: validation + wire↔runtime transforms |
| Function builders | `customQuery`, `customMutation` | `zq`, `zm` from `initZodvex` — codecs built in |

**Key difference**: convex-helpers treats DB wrapping and function building as separate manual steps. zodvex says: define your schema with codecs, and the pipeline works automatically. Advanced users add hooks for security/audit — but the codec layer is handled.

**What we're NOT doing**: Reinventing RLS or security. Hotpot's RLS/FLS logic lives in hooks that zodvex provides attachment points for. zodvex is the codec infrastructure; consumers own their domain logic.

---

## Relationship to Existing zodvex Code

### What Changes

- **`initZodvex()`** — New. One-time setup that creates all builders with codecs pre-configured.
- **`defineZodSchema()`** — New. Wraps `defineSchema()` to capture zodTable references.
- **`zCustomCtx()` / `zCustomCtxWithArgs()`** — New. Codec-aware parallels to convex-helpers' `customCtx`/`customCtxAndArgs`.
- **`zQueryBuilder(query, schema)`** — Enhanced. Optional second arg enables auto-codec on `ctx.db`. Without schema, works as before.
- **`zodTable()`** — Enhanced. Stores table name on return value.
- **`customCtxWithHooks` transforms** — May be simplified or deprecated. DB-level hooks replace function-level transforms for codec concerns.

### What Stays the Same

- `zodTable()`, `zx.date()`, `zx.id()`, `zx.codec()` — unchanged (zodTable enhanced with `.name`)
- `zodToConvex()`, `zodToConvexFields()` — unchanged
- `zQuery`, `zMutation`, `zAction` — unchanged (but now auto-encode args)
- `customCtx`, `customCtxAndArgs` — still re-exported for non-codec use cases
- `convexCodec()` — still useful as standalone codec builder
- `zodTable().schema.doc` — stays wire-format (decode happens at DB wrapper level)

---

## Design Decisions Summary

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Schema source of truth | `defineZodSchema()` wrapping `defineSchema()` | One place for both Convex validators and Zod codec schemas |
| Initialization | `initZodvex(schema, server)` returns all builders | Zero-config for simple users; one setup call |
| Builder codecs | `zQueryBuilder(query, schema)` auto-wraps ctx.db | Codecs should be automatic, not manual wiring |
| Context customization | `zCustomCtx(fn)` / `zCustomCtxWithArgs({args, input})` | Parallels convex-helpers pattern; familiar to Convex developers |
| ExtraArgs | `extra` param on `input` fn, available on both `zCustomCtx` and `zCustomCtxWithArgs` | Orthogonal to "WithArgs"; inferred from `extra` type annotation |
| DB hooks | Separate concern from context (parallel to `wrapDatabaseReader`) | Hooks are codec-aware transforms, not context augmentation |
| Hook factory | `createDatabaseHooks<Ctx>({decode, encode})` | Ctx generic flows to all hooks; typed to augmented context |
| Hook attachment | `.withHooks()` on the builder, after `.withContext()` | Fluent chain enforces ordering; hooks see augmented ctx type |
| Hook composition | `composeHooks(hooks[])` — array, piped in order | Consumer controls ordering; zodvex provides utility, doesn't impose |
| Hook grouping | Operation-first (decode/encode), then timing, then cardinality | Groups related concerns; validated in earlier brainstorm |
| Hook cardinality | one/many split with bound `one` passed to `many` | `many` chooses whether to use `one`; enables batch optimization |
| Query API | Explicit wrapper class (not Proxy) | Debuggable, type-safe, zodvex owns Convex API coupling |
| Primitives | `decodeDoc()`/`encodeDoc()` escape hatch | For consumers who build custom DB layers |
| Client decode | `decodeResult()` in `zodvex/core` | No React dependency in zodvex; client hook brainstormed separately |
| Arg encoding | Auto-encode in wrappers via `z.encode()` | Eliminates manual `processSensitiveArgs`-style code |
| Codegen | Future — generates `_generated/zodvex.ts` | Manual setup works today; codegen automates it tomorrow |
| Scope | Generic codec infra | zodvex owns codecs; consumers (hotpot) own domain logic (security, audit) |

---

## Open Questions

1. **Action support**: `actionCtx` is a passthrough today (no `ctx.db`). Future: wrap `ctx.runQuery()`/`ctx.runMutation()` for auto-decode of results?
2. **Client-side React hooks**: `useCodecQuery` or similar — deferred to separate brainstorm.
3. **Codegen**: `zodToSource()` serializer for client-safe schemas — separate design, relates to hotpot's `_generated/validators.ts` task.
