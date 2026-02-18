# zodvex v2 Redesign: Codec Boundary Layer

**Date:** 2026-02-17
**Status:** Approved (revised)
**Branch:** `fix/codec-issues`
**Context:** Full API redesign based on audit of builder/wrapper layers, hotpot consumer analysis, and alignment with Convex's "blessed functions" philosophy.
**Prerequisite reading:** `docs/decisions/2026-02-17-runtime-only-middleware.md`
**Revision note:** Revised to use `zCustomQuery`-based composition with internal flattening. zodvex owns codec correctness AND composition (via flattening). Separate reader/writer customizations preserve Convex's type-safety boundary.

---

## Identity

zodvex v2 is a **codec boundary layer** for Convex. It ensures data is correctly encoded/decoded at every transition point between layers.

```
Client Code  <->  useQuery/useMutation  <->  query/mutation handler  <->  ctx.db
         [1,2]                      [3,4]                        [5,6]
```

Each `<->` is bidirectional (encode going right, decode going left). zodvex owns codec correctness at all 6 boundaries.

### What zodvex owns

- Codec primitives: `zx.date()`, `zx.id()`, `zx.codec()`
- Schema definition: `zodTable()`, `defineZodSchema()`
- Zod->Convex validator mapping with correct optional/nullable semantics
- Codec-aware DB wrapper (boundaries 5,6) — packaged as a standard `Customization`
- Zod pipeline for function args/returns (boundaries 3,4)
- `__zodvexMeta` function decoration for codegen discovery
- Codegen + validator registry (boundaries 1,2)

### What zodvex does NOT own

- Context customization logic — convex-helpers' `customCtx` (zodvex composes customizations but doesn't define them)
- Authorization / security — hotpot (or the consumer)
- DB-level middleware / interception — consumer wrapper functions (Convex's `wrapDatabaseReader` pattern)

### Relationships

- **convex-helpers:** zodvex uses convex-helpers' `Customization` type as the interface for context augmentation. Consumers define customizations using convex-helpers' patterns (`customCtx`, raw `{ args, input }` objects). zodvex composes these customizations internally via flattening.
- **hotpot:** Primary consumer. Uses `zCustomQuery(zq, hotpotCustomization)` to build "blessed builders".
- **App developers:** Use hotpot's blessed builders. See `{ args, handler, returns }` — identical to vanilla Convex.

### Key principle: composability via `zCustomQuery`

zodvex builders compose with `zCustomQuery` — consumers layer customizations using zodvex's own builder, preserving Zod validation at every level:

```typescript
// zodvex produces a codec-aware builder
const zq = zCustomQuery(query, codecCustomization)

// Layer customizations using zCustomQuery — Zod validators at every level
const hotpotQuery = zCustomQuery(zq, {
  args: { sessionId: zx.id("sessions") },  // Zod, not v.id()
  input: async (ctx, { sessionId }) => { ... }
})
```

**Why `zCustomQuery`, not convex-helpers' `customQuery`:** Using zodvex's `zCustomQuery` means consumers can use Zod validators for custom args at every composition layer. convex-helpers' `customQuery` would require Convex validators (`v.id()`, `v.string()`) for any args added by the customization — breaking the Zod-everywhere contract.

### Internal flattening

When `zCustomQuery(zq, hotpotCustomization)` is called and `zq` is itself a zodvex builder, `customFnBuilder` **flattens** rather than nesting:

```
zCustomQuery(zq, hotpotCust)
  ↓ detects zq.__zodvexBuilder
  ↓ unwraps: zq was customFnBuilder(server.query, codecCust)
  ↓ composes: customFnBuilder(server.query, compose(codecCust, hotpotCust))
```

Only ONE layer of Zod-to-Convex conversion. Only ONE Zod parse. Customizations chain: codec wraps `ctx.db` first, then hotpot adds user/security on the codec-wrapped ctx. This is critical because nested `customFnBuilder` calls would double-convert args (Zod→Convex in the outer layer, then passed as Convex validators to the inner layer which tries to treat them as Zod schemas — which fails).

The builder stores its internals for composition:
- `customBuilder.__zodvexBuilder = true`
- `customBuilder.__zodvexInnerBuilder = builder` (the raw Convex builder, recursively unwrapped)
- `customBuilder.__zodvexCustomization = customization`

---

## API Surface

### Primary exports

```typescript
import { zCustomQuery, zCustomMutation, zCustomAction } from 'zodvex/server'
import { createCodecCustomization } from 'zodvex/server'
```

**`zCustomQuery(builder, customization?)`** — Zod-aware builder wrapper.
- Accepts Zod schemas for args/returns (not Convex validators)
- Converts Zod to Convex validators with correct optional/nullable semantics
- Parses args through Zod (applies codecs: timestamp → Date)
- Encodes returns through Zod (applies codecs: Date → timestamp)
- When passed a `customization`, runs `customization.input()` to augment ctx (e.g., codec DB)
- **Composable:** When `builder` is itself a zodvex builder, internally flattens (see "Internal flattening" above)
- Returns a builder that can itself be passed as `builder` to another `zCustomQuery` call

**`createCodecCustomization(zodTables)`** — Returns codec-aware `Customization` objects for queries and mutations.
- Returns `{ query: Customization, mutation: Customization }`
- `query`: wraps `ctx.db` with `createZodDbReader` — read-only (decode on read)
- `mutation`: wraps `ctx.db` with `createZodDbWriter` — read + write (decode on read, encode on write)
- Separate customizations preserve Convex's type-safety: query handlers see `CodecDatabaseReader` (no `insert`/`patch`/`delete`), mutation handlers see `CodecDatabaseWriter`

### Usage patterns

**Pattern 1: Direct — codec-aware builder**

```typescript
const codec = createCodecCustomization(zodTables)
const zq = zCustomQuery(query, codec.query)

export const getEvent = zq({
  args: { eventId: zx.id("events") },
  returns: Events.schema.doc.nullable(),
  handler: async (ctx, { eventId }) => {
    return ctx.db.get(eventId)  // returns Date objects, not timestamps
  },
})
```

**Pattern 2: Blessed builder — compose with `zCustomQuery`**

```typescript
const codec = createCodecCustomization(zodTables)
const zq = zCustomQuery(query, codec.query)

// Layer hotpot customization using zCustomQuery — Zod args throughout
const hotpotQuery = zCustomQuery(zq, {
  args: {},
  input: async (ctx) => {
    const user = await getUser(ctx)
    const db = createSecureReader({ user }, ctx.db, securityRules)
    return {
      ctx: { user, db },
      args: {},
      onSuccess: ({ result }) => auditLog(result, user),
    }
  },
})

// App developers use the blessed builder — identical to vanilla Convex
export const getPatient = hotpotQuery({
  args: { patientId: zx.id("patients") },
  returns: Patients.schema.doc.nullable(),
  handler: async (ctx, { patientId }) => {
    return ctx.db.get(patientId)
  },
})
```

**Pattern 3: Blessed builder with custom args (Zod at every level)**

```typescript
// hotpot adds a sessionId arg — uses Zod, not Convex validators
const hotpotQuery = zCustomQuery(zq, {
  args: { sessionId: zx.id("sessions") },  // Zod validator!
  input: async (ctx, { sessionId }) => {
    const session = await ctx.db.get(sessionId)
    const user = await getUser(ctx, session)
    return { ctx: { user, session }, args: {} }
  },
})

// App developers only see their own args
export const getPatient = hotpotQuery({
  args: { patientId: zx.id("patients") },
  handler: async (ctx, { patientId }) => ctx.db.get(patientId),
})
```

**Pattern 4: Multi-layer composition**

```typescript
// Each layer is independent and composable via zCustomQuery
const zq = zCustomQuery(query, codec.query)
const auditQuery = zCustomQuery(zq, auditCustomization)
const hotpotQuery = zCustomQuery(auditQuery, securityCustomization)
```

### `initZodvex` — convenience binding

```typescript
import { initZodvex } from 'zodvex/server'

const { zq, zm, za, ziq, zim, zia } = initZodvex(schema, server)
```

Pre-binds `createCodecCustomization(schema.zodTables)` + `server.query`/etc. into ready-to-use builders. Equivalent to:

```typescript
const codec = createCodecCustomization(schema.zodTables)
const zq = zCustomQuery(server.query, codec.query)      // codec-aware reader
const zm = zCustomMutation(server.mutation, codec.mutation)  // codec-aware writer
const za = zCustomAction(server.action)  // no DB in actions
const ziq = zCustomQuery(server.internalQuery, codec.query)
const zim = zCustomMutation(server.internalMutation, codec.mutation)
const zia = zCustomAction(server.internalAction)
```

**Simple functions:**

```typescript
export const getEvent = zq({
  args: { eventId: zx.id("events") },
  returns: Events.schema.doc.nullable(),
  handler: async (ctx, { eventId }) => ctx.db.get(eventId),
})
```

**Blessed builders:**

```typescript
const hotpotQuery = zCustomQuery(zq, hotpotCustomization)
```

No composability constraints — `zCustomQuery(zq, ...)` works with any args (Zod validators at every level) thanks to internal flattening.

---

## Pipeline Design

zodvex owns all pipeline steps. With internal flattening, there is only ONE `customFnBuilder` layer regardless of how many `zCustomQuery` calls are composed.

### Function pipeline (boundaries 3,4)

```
CLIENT REQUEST
  |
  v
1. Zod->Convex validator conversion              (construction time, once)
   zodToConvexFields(argsSchema) -> Convex args     [zodvex]
   zodToConvex(returnsSchema) -> Convex returns      [zodvex]
  |
2. Composed customization.input() chain           [zodvex]
   Codec layer: ctx.db wrapped with reader/writer
   Consumer layers: ctx augmented with user, security, etc.
   -> { ctx, args, onSuccess? }
  |
3. Zod args parse: argsSchema.safeParse(args)     [zodvex]
   Codecs decode: timestamp -> Date, etc.            (boundary 3: wire -> runtime)
  |
4. handler(augmentedCtx, runtimeArgs) -> result   [user code]
   ctx.db reads return runtime types
   ctx.db writes accept runtime types
  |
5. onSuccess({ ctx, args, result })               [zodvex]
   Sees runtime types: Date, SensitiveWrapper
   Always runs before encode (guaranteed by architecture)
  |
6. Zod return encode: z.encode(returns, result)   [zodvex]
   Codecs encode: Date -> timestamp, etc.            (boundary 4: runtime -> wire)
  |
7. stripUndefined(encoded)                        [zodvex]
  |
8. Return wire result to Convex
```

### Key invariant

`onSuccess` (step 5) **always** runs before Zod encode (step 6). This is guaranteed by internal flattening: regardless of how many `zCustomQuery(zq, ...)` layers are composed, they flatten to a single `customFnBuilder` call. The outermost customization's `onSuccess` is captured during the composed `input()` chain and runs before encode.

**No trade-off, no special cases.** The previous design had a "direct vs composed" onSuccess ordering problem because it used convex-helpers' `customQuery` for composition (which runs onSuccess after zodvex's encode). Internal flattening eliminates this entirely.

### What zodvex's `customFnBuilder` handles

- Zod-to-Convex validator conversion (construction time)
- Composed `customization.input()` chain (flattened from all layers)
- `onSuccess` from the composed customization — before Zod encode
- Zod args parse
- Zod returns encode
- `stripUndefined`
- `__zodvexMeta` decoration
- **Builder composition detection** — when `builder` arg is a zodvex builder, flatten instead of nest

### What zodvex's `customFnBuilder` does NOT handle

- Transforms (eliminated)
- Hooks (eliminated — `onSuccess` is native convex-helpers convention)
- `CustomizationWithHooks` (eliminated)

### DB pipeline (boundaries 5,6)

Lives inside `ctx.db`. Invisible to the handler.

**Read path (boundary 5):**
```
ctx.db.get(id) or ctx.db.query("table").collect()
  -> Convex returns wire doc(s)
  -> codec decode: schema.parse(wireDoc) -> runtime doc
  -> return runtime doc(s) to handler
```

**Write path (boundary 6):**
```
ctx.db.insert("table", runtimeDoc) or ctx.db.patch(id, runtimePatch)
  -> codec encode: z.encode(schema, runtimeDoc) -> wire doc
  -> stripUndefined
  -> Convex stores wire doc
```

---

## Database Codec Layer

### `createCodecCustomization(zodTables)`

Returns separate customizations for queries (reader) and mutations (writer), preserving Convex's type-safety boundary:

```typescript
function createCodecCustomization(zodTables: ZodTableMap) {
  return {
    query: {
      args: {},
      input: async (ctx: any) => ({
        ctx: { db: createZodDbReader(ctx.db, zodTables) },
        args: {}
      })
    },
    mutation: {
      args: {},
      input: async (ctx: any) => ({
        ctx: { db: createZodDbWriter(ctx.db, zodTables) },
        args: {}
      })
    }
  }
}
```

**Why separate reader/writer:**
- Convex types `ctx.db` as `DatabaseReader` for queries and `DatabaseWriter` for mutations
- `DatabaseWriter extends DatabaseReader` — adds `insert()`, `patch()`, `replace()`, `delete()`
- TypeScript AND runtime enforce this boundary — calling `.insert()` on a query's db fails both at compile time and at runtime
- If we used Writer for queries, TypeScript would allow `ctx.db.insert()` in a query handler — misleading autocomplete and no compile-time guard. At runtime it would produce a confusing error from the underlying Convex reader (which doesn't implement write methods)
- Separate customizations preserve this: query handlers see `CodecDatabaseReader` (no write methods), mutation handlers see `CodecDatabaseWriter`

### Consumer DB wrappers (Convex's pattern)

Consumers who need DB-level interception (security, transforms) write their own wrapper functions, following Convex's `wrapDatabaseReader` pattern:

```typescript
// hotpot's code, not zodvex's
function createSecureReader(
  { user }: { user: User },
  db: CodecDatabaseReader,   // typed! consumer knows the interface
  rules: SecurityRules
): CodecDatabaseReader {
  return {
    get: async (id) => {
      const doc = await db.get(id)      // runtime types (codec-aware)
      if (!checkRLS(doc, user, rules)) return null
      return applyFLS(doc, user, rules)  // SensitiveWrapper.hidden() etc.
    },
    query: (table) => { /* wrap query chain similarly */ },
    get system() { return db.system }
  }
}

// Composed with zCustomQuery — Zod at every level
const hotpotQuery = zCustomQuery(zq, {
  args: {},
  input: async (ctx) => {
    const user = await getUser(ctx)
    const db = createSecureReader({ user }, ctx.db, securityRules)
    return { ctx: { user, db }, args: {} }
  }
})
```

### What zodvex provides

| Export | Purpose |
|---|---|
| `createCodecCustomization(zodTables)` | Returns `{ query, mutation }` customizations |
| `createZodDbReader(db, zodTables)` | Manual reader wrapping (escape hatch) |
| `createZodDbWriter(db, zodTables)` | Manual writer wrapping (escape hatch) |
| `CodecDatabaseReader` type | Interface for codec-wrapped reader (queries) |
| `CodecDatabaseWriter` type | Interface for codec-wrapped writer (mutations, extends reader) |
| `ZodTableMap` type | Map of table name → zodTable entry |
| `RuntimeDoc` / `WireDoc` types | Type for decoded/encoded documents |
| `decodeDoc(schema, wireDoc)` / `encodeDoc(schema, runtimeDoc)` | Primitive escape hatches |

### What's removed from zodvex

| Removed | Reason |
|---|---|
| `createDatabaseHooks()` | Consumer's responsibility |
| `composeHooks()` | Consumer composes their own wrappers |
| `DatabaseHooks` type (6 hook points) | Replaced by consumer wrapper functions |
| `src/db/hooks.ts` public API | Removed |
| All wire-side hook types | Runtime-only (see decision doc) |

---

## Schema, Codecs & Codegen

### Schema definition (unchanged)

```typescript
const Events = zodTable("events", {
  title: z.string(),
  startDate: zx.date(),
  endDate: zx.date().optional(),
})

export const schema = defineZodSchema({
  events: Events,
  patients: Patients,
})
```

### Codec primitives (unchanged)

```typescript
zx.date()        // Date <-> timestamp
zx.id("table")   // branded string ID
zx.codec(wire, runtime, { encode, decode })  // consumer-defined
```

### Codegen: validator registry

Generated code references model schemas directly — no `zodToSource()` serialization.

```
schema.ts (user-authored)
  defineZodSchema({ events: Events, patients: Patients })
        |
        v
_generated/zodvex/schema.ts (codegen)
  Re-exports zodTable schemas (client-safe)
        |
        v
_generated/zodvex/validators.ts (codegen)
  import { Patients } from './schema'
  validators["patients/index:get"] = {
    args: z.object({ patientId: zx.id("patients") }),
    returns: Patients.schema.doc.nullable(),
  }
        |
        +-- Client hooks: useHotpotQuery(api.patients.get, args)
        +-- Server actions: ctx.runQuery(api.patients.get, args)
        +-- Future: REST endpoints
```

### Function decoration

Builders from `initZodvex` (and `zCustomQuery` internally) decorate function exports for codegen discovery:

```typescript
// customFnBuilder internally does:
const fn = builder({ args, returns, handler })
fn.__zodvexMeta = { zodArgs: config.args, zodReturns: config.returns }
return fn
```

### Open item: client-safe model definitions

`zodTable()` uses `defineTable()` which is server-only, making model files non-importable from client code. This blocks the "direct reference" codegen strategy. Two paths to explore:

1. **Codegen sanitizes** — extracts Zod schemas from zodTable, re-exports without Convex table definition
2. **Client-safe model primitive** — e.g. `defineZodModel()` that captures the Zod schema without calling `defineTable()`

This is an isolated concern to explore during implementation.

---

## Migration Strategy

### Approach: major version bump with deprecations

No `zodvex/v2` namespace. API evolves in place.

### What stays (unchanged or improved)

- `zodTable()`, `defineZodSchema()` — unchanged
- `zx.date()`, `zx.id()`, `zx.codec()` — unchanged
- `zodToConvex`, `zodToConvexFields` — unchanged
- `decodeDoc()`, `encodeDoc()` — unchanged
- `zCustomQuery`, `zCustomMutation`, `zCustomAction` — improved (composable via `zCustomQuery(zq, ...)` with internal flattening)
- `initZodvex()` — improved (returns short names `zq`, `zm`, `za`, `ziq`, `zim`, `zia`)

### What's new

| New | Purpose |
|---|---|
| `createCodecCustomization(zodTables)` | First-class codec Customization export |
| `CodecDatabaseReader` / `CodecDatabaseWriter` types | Named types for codec-wrapped db |
| `__zodvexMeta` function decoration | Codegen discovery metadata |

### What gets deprecated (with warnings)

| Deprecated | Replacement |
|---|---|
| `zCustomQueryBuilder` | `zCustomQuery` (identical, pick one name) |
| `zCustomMutationBuilder` | `zCustomMutation` |
| `zCustomActionBuilder` | `zCustomAction` |
| `zQueryBuilder` | `zCustomQuery(builder)` (without customization) |
| `zMutationBuilder` | `zCustomMutation(builder)` |
| `zActionBuilder` | `zCustomAction(builder)` |
| `customCtxWithHooks()` | `customCtx()` from convex-helpers |
| `transforms.input` | Transform args in `customCtx` `input()` |
| `transforms.output` | Use `onSuccess` via convex-helpers |

### What gets removed

| Removed | Reason |
|---|---|
| `CustomizationWithHooks` type | convex-helpers' `Customization` is sufficient |
| `CustomizationHooks` type | `onSuccess` is in convex-helpers' `Customization` |
| `CustomizationTransforms` type | Eliminated — consumer logic in `customCtx` / `onSuccess` |
| `CustomizationResult` type | No longer needed |
| `CustomizationInputResult` type | No longer needed |
| `buildHandler()` | Was already removed |
| `createDatabaseHooks()` | Was already removed |
| `composeHooks()` | Was already removed |
| `DatabaseHooks` type | Was already removed |

### Hotpot migration

| Current usage | Migration |
|---|---|
| `zCustomQueryBuilder(query, customization)` | `zCustomQuery(query, codec.query)` + `zCustomQuery(zq, hotpotCustomization)` |
| `transforms.output` for audit logging | `onSuccess` in customization passed to `zCustomQuery` |
| `createSecureReader` wrapping raw `ctx.db` | Same pattern — `ctx.db` is now codec-aware via `createCodecCustomization` |
| `zx.codec()` for SensitiveField | Unchanged |

### Post-migration evaluation

After migration is complete, evaluate whether the `zodvex/transform` package export still provides value or should be removed/consolidated.

---

## De-risking & Testing Strategy

### Priority 1: Composition proof

This is the foundation. If `zCustomQuery(zq, customization)` doesn't compose correctly with internal flattening, the entire architecture falls apart.

1. **`zCustomQuery(zq, customization)` produces working blessed builders** — args are Zod schemas at every level, validates and encodes correctly
2. **Multi-layer composition works** — `zCustomQuery(zCustomQuery(zq, layer1), layer2)` chains correctly via recursive flattening
3. **Custom args from outer layer work** — `zCustomQuery(zq, { args: { sessionId: zx.id("sessions") }, ... })` merges args correctly
4. **Internal flattening is transparent** — flattened builder behaves identically to a non-composed builder

### Priority 2: onSuccess ordering verification

5. **`onSuccess` always sees runtime types** — Date, SensitiveWrapper (guaranteed by flattening — no trade-off)
6. **`onSuccess` has closure access** — resources created in `input()` are accessible in `onSuccess` callback
7. **Composed `onSuccess` fires from the outermost customization** — customization chain picks up the last `onSuccess`

### Priority 3: DB codec layer

7. **Reads return runtime types** — `ctx.db.get(id)` returns Date objects, SensitiveWrapper instances
8. **Writes accept runtime types** — `ctx.db.insert("table", { startDate: new Date() })` stores timestamp
9. **Consumer wrapper composes** — wrapping codec-aware `ctx.db` with security reader preserves codec behavior

### Priority 4: Decode cost benchmark

10. **Overhead is negligible** — 1000 docs with mixed codecs, target <25ms overhead

### Priority 5: Integration

11. **Full blessed-builder flow** — `initZodvex` → `zCustomQuery(zq, hotpotCustomization)` → handler reads/writes → `onSuccess` audits → wire result to client

---

## Decision Log

| Decision | Choice | Rationale |
|---|---|---|
| Identity | Codec boundary layer | Not a general Zod wrapper; convex-helpers covers basics |
| Composition model | `zCustomQuery(zq, customization)` with internal flattening | Zod validators at every level; no double Zod-to-Convex conversion |
| Internal flattening | `customFnBuilder` detects zodvex builders, composes customizations | Avoids nested builder problem; single Zod parse + single conversion |
| Customization type | convex-helpers' `Customization` directly | No zodvex wrapper type needed |
| onSuccess handling | Always sees runtime types | Flattening guarantees onSuccess runs before encode — no trade-off |
| `createCodecCustomization` | Returns `{ query, mutation }` | Preserves Convex's `DatabaseReader`/`DatabaseWriter` type boundary |
| `CodecDatabaseReader`/`Writer` | Separate named types | Query handlers get reader (no write methods), mutation handlers get writer |
| `customFnBuilder` | Internal only — not a public API | Workhorse for Zod validation + composition; consumers never see it |
| DB middleware API | None (consumer wrapper functions) | Follows Convex's `wrapDatabaseReader` pattern |
| DB middleware data | Runtime types only | See `docs/decisions/2026-02-17-runtime-only-middleware.md` |
| `initZodvex` return names | Short names: `zq`, `zm`, `za`, `ziq`, `zim`, `zia` | Ergonomic; avoids collision with export-level names |
| Builder naming | No "Builder" suffix; `zCustomQuery` is the primary name | Aligns with convex-helpers' `zCustomQuery` naming |
| Migration | Major version bump, deprecations, no `zodvex/v2` | Clean evolution, deprecated exports with warnings |
| Codegen | Direct schema references + `__zodvexMeta` | No `zodToSource()` for custom codecs |
| Client-safe models | Open item | `zodTable()` depends on server-only `defineTable()` |
| `zodvex/transform` | Evaluate post-migration | May not be needed after redesign |
| Convex philosophy | "Blessed functions" via composition | `zCustomQuery(zq, customization)` — each layer is independent |
