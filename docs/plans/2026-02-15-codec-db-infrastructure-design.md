# Codec-Aware Database Infrastructure Design

> **Status**: Draft
> **Date**: 2026-02-15
> **Context**: zodvex issue #37 revealed that codec support is incomplete — codecs work at the wrapper/validator level but not at the database access or client boundaries. This design generalizes the codec pipeline so it works across all boundaries.

## Open Discussion: Naming Convention

**Needs further brainstorming before implementation.** The current working name `createZodDb()` is descriptive but may not be the final choice. Key considerations:

- Should zodvex's factory functions share a naming convention (`createZod*` vs `z*Builder`)?
- How does this relate to Convex's `GenericDatabaseReader` and `GenericDatabaseWriter` interfaces?
- The db wrapper and function builders serve different lifecycles (runtime vs definition-time) — should naming reflect this?

Placeholder name `createZodDb()` is used throughout this document.

---

## Architecture Overview

zodvex codec infrastructure provides four layers:

1. **`createZodDb()`** — A fluent wrapper around Convex's `ctx.db` that auto-decodes on read and auto-encodes on write. Preserves the full Convex query API (`.first()`, `.unique()`, `.collect()`, `.take()`, `.paginate()`). Accepts optional decode/encode hooks for advanced use cases (security, audit, transforms).

2. **Primitive utilities** — `decodeDoc()` and `encodeDoc()` as escape hatches for consumers who build their own DB layer or have edge cases the wrapper doesn't cover.

3. **Client-side decode utility** — `decodeResult()` in `zodvex/core` (client-safe) for decoding wire-format query results on the frontend.

4. **Auto-encode in wrappers** — `zQuery`/`zMutation` and custom builders auto-encode args via `z.encode()`, eliminating manual arg processing (replaces patterns like hotpot's `processSensitiveArgs`).

### Export Structure

- `zodvex/core` — Client-safe: `decodeResult`, `encodeArgs`, `zx`, types
- `zodvex/server` — Server-only: `createZodDb`, `decodeDoc`, `encodeDoc`, wrappers, `zodTable`
- `zodvex` — Everything (backwards compatible)

---

## Type System

### Hook Contexts (Discriminated Unions)

Operations are modeled as discriminated unions so that TypeScript narrows which data is available in each hook.

```typescript
// Read contexts
interface SingleDocRead {
  table: string
  operation: 'get' | 'first' | 'unique'
}

interface MultiDocRead {
  table: string
  operation: 'collect' | 'take' | 'paginate'
}

type ReadContext = SingleDocRead | MultiDocRead

// Write contexts
interface InsertContext {
  table: string
  operation: 'insert'
}

interface PatchContext<WireDoc = Record<string, unknown>> {
  table: string
  operation: 'patch'
  existingDoc: WireDoc
}

interface DeleteContext<WireDoc = Record<string, unknown>> {
  table: string
  operation: 'delete'
  existingDoc: WireDoc
}

type WriteContext = InsertContext | PatchContext | DeleteContext
```

`PatchContext.existingDoc` and `DeleteContext.existingDoc` should be typed to the table's wire schema when generics allow, falling back to `Record<string, unknown>`.

### Hook Types

Hooks are grouped **operation-first** (decode/encode), then **timing** (before/after), then **cardinality** (one/many).

```typescript
type DecodeHooks = {
  before?: {
    one?:  (ctx: SingleDocRead, doc: WireDoc) => Promise<WireDoc | null> | WireDoc | null
    many?: (
      ctx: MultiDocRead,
      docs: WireDoc[],
      one: (doc: WireDoc) => Promise<WireDoc | null>
    ) => Promise<WireDoc[]> | WireDoc[]
  }
  after?: {
    one?:  (ctx: SingleDocRead, doc: RuntimeDoc) => Promise<RuntimeDoc | null> | RuntimeDoc | null
    many?: (
      ctx: MultiDocRead,
      docs: RuntimeDoc[],
      one: (doc: RuntimeDoc) => Promise<RuntimeDoc | null>
    ) => Promise<RuntimeDoc[]> | RuntimeDoc[]
  }
}

type EncodeHooks = {
  before?: (ctx: WriteContext, doc: RuntimeDoc) => Promise<RuntimeDoc | null> | RuntimeDoc | null
  after?:  (ctx: WriteContext, doc: WireDoc) => Promise<WireDoc | null> | WireDoc | null
}

type CodecHooks = {
  decode?: DecodeHooks
  encode?: EncodeHooks
}
```

### One/Many Relationship

- **Single-doc operations** (`.get()`, `.first()`, `.unique()`) call `one`.
- **Multi-doc operations** (`.collect()`, `.take()`, `.paginate()`) call `many`.
- If only `one` is provided, zodvex derives `many` by mapping `one` over the array (sensible default).
- If `many` is provided, it receives a pre-bound `one` as its third argument. The `many` implementation **chooses** whether to call `one` — it is a convenience, not an obligation.
- zodvex bridges `one` internally so the bound function has the correct context; the `many` callback just calls `one(doc)` with no context argument.

```typescript
// Default many when only one is provided (internal to zodvex):
const defaultMany = async (ctx, docs, boundOne) => {
  const results = await Promise.all(docs.map(boundOne))
  return results.filter(Boolean)
}
```

### Write Hooks

Writes are always single-doc in Convex, so encode hooks have no one/many split. For `patch` and `delete` operations, zodvex internally fetches the existing document and provides it on the context as `existingDoc`.

---

## Execution Flow

### Read Path

For every terminal method (`.get()`, `.first()`, `.unique()`, `.collect()`, `.take()`, `.paginate()`):

```
Raw doc(s) from Convex
  -> decode.before.one/many    (hooks: RLS, FLS, field transforms)
  -> decodeDoc(schema, doc)    (zodvex codec: wire -> runtime)
  -> decode.after.one/many     (hooks: audit logging, post-processing)
  -> Return to handler
```

### Write Path

For `.insert()`, `.patch()`, `.delete()`:

```
Runtime doc from handler
  -> encode.before(ctx, doc)   (hooks: RLS check, FLS write policy, normalization)
  -> encodeDoc(schema, doc)    (zodvex codec: runtime -> wire)
  -> encode.after(ctx, doc)    (hooks: audit logging, post-encode validation)
  -> Raw write to Convex
```

For `.patch()` and `.delete()`, zodvex fetches the existing document before running hooks, making it available as `ctx.existingDoc`.

---

## Fluent Query API (Wrapper Class)

`createZodDb()` returns an object that mirrors the Convex `ctx.db` API. The query chain is implemented as an explicit wrapper class (not a Proxy) that delegates query-building methods to Convex and intercepts terminal methods to apply the hook + codec pipeline.

```typescript
// Conceptual structure (not final implementation):
class ZodQuery<TableName, Schema> {
  // Query-building — pure delegation
  withIndex(name, builder?)  -> ZodQuery  // delegates to inner query
  filter(predicate)          -> ZodQuery
  order(order)               -> ZodQuery

  // Terminal methods — intercept, apply hooks + decode
  async first()              -> RuntimeDoc | null
  async unique()             -> RuntimeDoc | null
  async collect()            -> RuntimeDoc[]
  async take(n)              -> RuntimeDoc[]
  async paginate(opts)       -> PaginationResult<RuntimeDoc>
}
```

If Convex adds new query-building methods, zodvex adds them to the wrapper class. If Convex adds new terminal methods, zodvex adds them with hook integration. Consumers never need to proxy or intercept Convex APIs themselves.

### Writer Interface

```typescript
interface ZodDbWriter {
  insert(table, doc: RuntimeDoc) -> Promise<GenericId>
  patch(table, id, patch: Partial<RuntimeDoc>) -> Promise<void>
  delete(table, id) -> Promise<void>
}
```

---

## API Surface

### Primary: `createZodDb()`

```typescript
function createZodDb<Schemas>(
  db: GenericDatabaseReader | GenericDatabaseWriter,
  schemas: Schemas,
  hooks?: CodecHooks,
): ZodDb<Schemas>
```

- `db` — The raw Convex `ctx.db` (reader or writer)
- `schemas` — Map of table names to Zod doc schemas (from `zodTable().schema.doc`)
- `hooks` — Optional decode/encode hooks
- Returns a `ZodDb` that provides `.get()`, `.query()`, and (if db is a writer) `.insert()`, `.patch()`, `.delete()`

### Primitives (Escape Hatch): `decodeDoc()` / `encodeDoc()`

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

Decodes wire-format query results on the frontend. Equivalent to `schema.parse(data)` but named for clarity and exported from the client-safe entrypoint.

### Wrapper Auto-Encode

`zQuery`, `zMutation`, and custom builders auto-encode args via `z.encode(argsSchema, args)` on input. This means codecs in args schemas (e.g., `SensitiveField -> SensitiveWire`) are handled automatically without manual `processSensitiveArgs`-style code.

---

## Usage Examples

### Simple User (Calendar App with `zx.date()`)

```typescript
// === Schema ===
const Events = zodTable('events', {
  title: z.string(),
  startDate: zx.date(),
  endDate: zx.date().optional(),
  organizerId: zx.id('users'),
})

// === One-time setup ===
const tableSchemas = { events: Events.schema.doc }

export const codecQuery = zCustomQuery(query, {
  args: {},
  input: async (ctx) => ({
    ctx: { db: createZodDb(ctx.db, tableSchemas) },
    args: {},
  }),
})

// === Handlers — Dates just work ===
export const getEvent = codecQuery({
  args: { eventId: zx.id('events') },
  returns: Events.schema.doc,
  handler: async ({ db }, { eventId }) => {
    const event = await db.get('events', eventId)
    // event.startDate is Date, not number
    return event
  },
})

export const listUpcoming = codecQuery({
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

export const findByOrganizer = codecQuery({
  args: { organizerId: zx.id('users') },
  returns: Events.schema.doc.nullable(),
  handler: async ({ db }, { organizerId }) => {
    return await db.query('events')
      .withIndex('organizerId', iq => iq.eq('organizerId', organizerId))
      .first()
    // .first() returns single decoded doc or null
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

### Advanced User (Hotpot — RLS + FLS + SensitiveField Codecs)

```typescript
// === Custom query with security hooks ===
export const hotpotQuery = zCustomQuery(query, {
  args: {},
  input: async (ctx, _args, extra?: { required?: HotpotEntitlement[] }) => {
    const securityCtx = await resolveContext(ctx)

    if (extra?.required?.length) {
      assertEntitlements(securityCtx, extra.required)
    }

    const db = createZodDb(ctx.db, hotpotSchemas, {
      decode: {
        before: {
          // Single-doc: per-doc RLS check + FLS field transform
          one: async (ctx, doc) => {
            if (!await checkRlsRead(securityCtx, doc, rules[ctx.table])) return null
            return applyFls(doc, schemas[ctx.table], securityCtx, resolver, {
              defaultReadPolicy, fieldRules: fieldRules[ctx.table], table: ctx.table,
            })
          },
          // Multi-doc: batch RLS, then per-doc FLS (ignores bound one, implements directly)
          many: async (ctx, docs, _one) => {
            const filtered = await filterByRls(securityCtx, docs, rules[ctx.table])
            return Promise.all(filtered.map(doc =>
              applyFls(doc, schemas[ctx.table], securityCtx, resolver, {
                defaultReadPolicy, fieldRules: fieldRules[ctx.table], table: ctx.table,
              })
            ))
          },
        },
        after: {
          // Audit logging on decoded results
          one: async (ctx, doc) => {
            produceReadAuditLog(securityCtx, doc)
            return doc
          },
          // many not provided — zodvex maps one over the array
        },
      },
      encode: {
        before: async (ctx, doc) => {
          // RLS write checks (two-phase for patch)
          const rule = rules[ctx.table]
          if (ctx.operation === 'patch') {
            const oldRls = await checkRlsWrite(securityCtx, ctx.existingDoc, rule, 'modify')
            if (!oldRls.allowed) throw new Error(`RLS denied modify on ${ctx.table}`)
            const merged = { ...ctx.existingDoc, ...doc }
            const newRls = await checkRlsWrite(securityCtx, merged, rule, 'modify')
            if (!newRls.allowed) throw new Error(`RLS denied modify result on ${ctx.table}`)
          } else if (ctx.operation === 'insert') {
            const rlsResult = await checkRlsWrite(securityCtx, doc, rule, 'insert')
            if (!rlsResult.allowed) throw new Error(`RLS denied insert on ${ctx.table}`)
          } else if (ctx.operation === 'delete') {
            const rlsResult = await checkRlsWrite(securityCtx, ctx.existingDoc, rule, 'delete')
            if (!rlsResult.allowed) throw new Error(`RLS denied delete on ${ctx.table}`)
          }
          // FLS write policy
          return applyFlsWrite(doc, schemas[ctx.table], securityCtx, resolver, {
            defaultWritePolicy, fieldRules: fieldRules[ctx.table],
          })
        },
        after: async (ctx, doc) => {
          // Write audit logging
          const hasSensitive = findSensitiveFields(schemas[ctx.table]).length > 0
          if (hasSensitive) {
            produceWriteAuditLog(securityCtx, ctx.operation.toUpperCase(), ctx.table, doc)
          }
          return doc
        },
      },
    })

    return { ctx: { db, securityCtx }, args: {} }
  },
})

// === Handlers — identical API to simple user ===
export const getPatient = hotpotQuery({
  args: { patientId: zx.id('patients') },
  returns: patients.schema.doc,
  required: ['hotpot:clinic:patients:view'],
  handler: async ({ db }, { patientId }) => {
    const patient = await db.get('patients', patientId)
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
    // Batch RLS filtered, per-doc FLS applied, decoded, audit logged
    // Full Convex query API — resolves Heath's concern
  },
})

// === Client ===
import { decodeResult } from 'zodvex/core'

function PatientList() {
  const rawPatients = useQuery(api.patients.listPatients, { clinicId })
  const patients = decodeResult(patients.schema.docArray, rawPatients)
  // patients[0].email is SensitiveField<string>
}
```

---

## Relationship to Existing zodvex Code

### What Changes

- **`customCtxWithHooks` transforms** (`transforms.input`, `transforms.output`): These were the original hook points on the function wrapper layer. With codec hooks moving to the DB layer (where they belong), the transforms on `customCtxWithHooks` may be simplified or deprecated. The DB-level hooks are more specific and don't conflate function-level concerns (like output formatting) with data-access concerns (like codec transforms).

- **`convexCodec()`**: Still useful as a standalone codec builder. `decodeDoc()`/`encodeDoc()` are lower-level primitives that `createZodDb()` uses internally.

- **`zodTable().schema.doc`**: The #37 fix made these wire-format. This is still correct — `schema.doc` represents what Convex stores. The codec decode happens at the DB wrapper level, not the schema level.

### What Stays the Same

- `zodTable()`, `zx.date()`, `zx.id()`, `zx.codec()` — unchanged
- `zodToConvex()`, `zodToConvexFields()` — unchanged
- `zQuery`, `zMutation`, `zAction` — unchanged (but now auto-encode args)
- `zCustomQuery`, `zCustomMutation`, `zCustomAction` — unchanged
- `zQueryBuilder`, `zCustomQueryBuilder`, etc. — unchanged

---

## Design Decisions Summary

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Scope | Generic codec infra only | zodvex stays a codec/validation library; hotpot owns security |
| DB integration | Replace ctx.db via customization | Matches existing `customCtxWithHooks` pattern |
| Query API | Explicit wrapper class (not Proxy) | Debuggable, type-safe, zodvex owns Convex API coupling |
| Extension model | Hooks on `createZodDb()` | One API for simple and advanced; no consumer-built proxies |
| Hook grouping | Operation-first (decode/encode), then timing (before/after) | Groups related concerns; decode = all read hooks, encode = all write hooks |
| Hook cardinality | one/many split with bound `one` passed to `many` | Preserves Convex API semantics (no forced array wrapping); `many` chooses whether to use `one` |
| Default `many` | Maps `one` over array | Sensible default; advanced users override for batch optimization |
| Primitives | `decodeDoc()`/`encodeDoc()` escape hatch | For consumers who build custom DB layers |
| Client decode | Utility function in `zodvex/core` | No React dependency in zodvex; client hook brainstormed separately |
| Arg encoding | Auto-encode in wrappers via `z.encode()` | Eliminates manual `processSensitiveArgs`-style code |
