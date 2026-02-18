# zodvex v2 Redesign: Codec Boundary Layer

**Date:** 2026-02-17
**Status:** Approved
**Branch:** `fix/codec-issues`
**Context:** Full API redesign based on audit of builder/wrapper layers, hotpot consumer analysis, and alignment with Convex's "blessed functions" philosophy.
**Prerequisite reading:** `docs/decisions/2026-02-17-runtime-only-middleware.md`

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
- Codec-aware DB wrapper (boundaries 5,6)
- Zod pipeline for function args/returns (boundaries 3,4)
- Codegen + validator registry (boundaries 1,2)

### What zodvex does NOT own

- Context customization — convex-helpers' `customCtx`
- Authorization / security — hotpot (or the consumer)
- Function-level side effects — convex-helpers' `onSuccess`
- DB-level middleware / interception — consumer wrapper functions (Convex's `wrapDatabaseReader` pattern)

### Relationships

- **convex-helpers:** zodvex wraps around it, not replaces it. `zCustomQuery` accepts a standard `Customization` from convex-helpers.
- **hotpot:** Primary consumer. Uses `zCustomQuery`/`zCustomMutation`/`zCustomAction` to build "blessed builders" (`hotpotQuery`, `hotpotMutation`, etc.).
- **App developers:** Use hotpot's blessed builders. See `{ args, handler, returns }` — identical to vanilla Convex.

---

## API Surface

### Tier 1: `initZodvex` (recommended for projects)

```typescript
import { initZodvex } from 'zodvex'

const { zQuery, zMutation, zAction, zCustomQuery, zCustomMutation, zCustomAction } =
  initZodvex(schema, server)
```

Schema pre-bound. Codec-aware `ctx.db` and Zod pipeline baked in.

**Simple functions** (equivalent to `query`/`mutation`/`action` from Convex):

```typescript
export const getEvent = zQuery({
  args: { eventId: zx.id("events") },
  returns: Events.schema.doc.nullable(),
  handler: async (ctx, { eventId }) => {
    return ctx.db.get(eventId)  // returns Date objects, not timestamps
  },
})
```

**Blessed builders** (equivalent to `customQuery` from convex-helpers):

```typescript
const hotpotQuery = zCustomQuery(
  query,
  customCtx(async (ctx) => {
    const user = await getUser(ctx)
    const db = createSecureReader({ user }, ctx.db, securityRules)
    return {
      user,
      db,
      onSuccess: ({ result }) => auditLog(result, user),
    }
  })
)

// App developers use the blessed builder
export const getPatient = hotpotQuery({
  args: { patientId: zx.id("patients") },
  returns: Patients.schema.doc.nullable(),
  handler: async (ctx, { patientId }) => {
    return ctx.db.get(patientId)
  },
})
```

### Tier 2: Standalone builders (for library authors without `initZodvex`)

```typescript
import { zQueryBuilder, zCustomQueryBuilder } from 'zodvex'

const zq = zQueryBuilder(query, { zodTables })
const secureQuery = zCustomQueryBuilder(query, customization, { zodTables })
```

For consumers who can't or don't want to use `initZodvex`.

### Tier 3: Raw wrappers (backward compat / escape hatch)

```typescript
import { zQuery } from 'zodvex'

export const getEvent = zQuery(query, {
  args: { eventId: z.string() },
  returns: z.object({ title: z.string() }),
  handler: async (ctx, { eventId }) => { ... },
})
```

Just Zod validation, no DB wrapping. Points toward convex-helpers for even simpler usage.

---

## Pipeline Design

### Function pipeline (boundaries 3,4)

```
CLIENT REQUEST
  |
  v
1. Zod->Convex validator conversion              (construction time, once)
   zodToConvexFields(argsSchema) -> Convex args
   zodToConvex(returnsSchema) -> Convex returns
  |
2. customization.input(ctx, customArgs, extra)    (convex-helpers' step)
   -> { ctx, args, onSuccess? }
   ctx.db is now codec-aware
  |
3. Zod args parse: argsSchema.safeParse(args)     (boundary 3: wire -> runtime)
   Codecs decode: timestamp -> Date, etc.
  |
4. handler(augmentedCtx, runtimeArgs) -> result   (user code)
   ctx.db reads return runtime types
   ctx.db writes accept runtime types
  |
5. onSuccess({ ctx, args, result })               (convex-helpers' hook)
   Sees runtime types: Date, SensitiveWrapper
   MUST run here, before step 6
  |
6. Zod return encode: z.encode(returns, result)   (boundary 4: runtime -> wire)
   Codecs encode: Date -> timestamp, etc.
  |
7. stripUndefined(encoded)                        (Convex compatibility)
  |
8. Return wire result to Convex
```

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

### Key invariant

`onSuccess` (step 5) MUST run before Zod encode (step 6). This eliminates the need for `transforms.output`, `boundary` config, or any zodvex extension to convex-helpers' `Customization` type.

Currently zodvex's `customFnBuilder` runs `onSuccess` after encode — **that's a bug to fix**, not a new feature to add.

### What's eliminated by correct pipeline ordering

- `transforms.input` — consumer transforms args in `customization.input()` (convex-helpers' pattern)
- `transforms.output` — consumer observes/logs result in `onSuccess` (sees runtime types)
- `boundary` config — no separate intercept point needed
- `CustomizationWithHooks` type — standard `Customization` from convex-helpers is sufficient
- `customCtxWithHooks()` — `customCtx()` from convex-helpers is sufficient

---

## Database Codec Layer

### Automatic codec wrapping

`initZodvex` / `zCustomQuery` wraps `ctx.db` with codec awareness. By the time the consumer's `customCtx` runs, reads return runtime types and writes accept runtime types.

### Consumer DB wrappers (Convex's pattern)

Consumers who need DB-level interception (security, transforms) write their own wrapper functions, following Convex's `wrapDatabaseReader` pattern:

```typescript
// hotpot's code, not zodvex's
function createSecureReader({ user }, db, rules) {
  return {
    get: async (id) => {
      const doc = await db.get(id)      // runtime types (codec-aware)
      if (!checkRLS(doc, user, rules)) return null
      return applyFLS(doc, user, rules)  // SensitiveWrapper.hidden() etc.
    },
    query: (table) => { /* wrap query chain similarly */ },
  }
}

// Used inside a blessed builder
const hotpotQuery = zCustomQuery(
  query,
  customCtx(async (ctx) => {
    const user = await getUser(ctx)
    const db = createSecureReader({ user }, ctx.db, securityRules)
    return { user, db }
  })
)
```

### What zodvex provides

| Export | Purpose |
|---|---|
| `CodecDatabaseReader` / `CodecDatabaseWriter` types | Interface for the codec-wrapped db |
| `RuntimeDoc` type | Type for decoded documents |
| `decodeDoc(schema, wireDoc)` / `encodeDoc(schema, runtimeDoc)` | Manual escape hatches |

### What's removed from zodvex

| Removed | Reason |
|---|---|
| `createDatabaseHooks()` | Consumer's responsibility |
| `composeHooks()` | Consumer composes their own wrappers |
| `DatabaseHooks` type (6 hook points) | Replaced by consumer wrapper functions |
| `src/db/hooks.ts` public API | Internal only |
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

Builders from `initZodvex` decorate function exports for codegen discovery:

```typescript
// zQuery internally does:
const fn = query({ args, returns, handler })
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
- `initZodvex()` — improved (delegates to `customFnBuilder`, proper Zod pipeline)
- `zQuery`, `zMutation`, `zAction` — improved (codec-aware via initZodvex)
- `zCustomQuery`, `zCustomMutation`, `zCustomAction` — improved (accepts convex-helpers' `Customization` directly)

### What gets deprecated (with warnings)

| Deprecated | Replacement |
|---|---|
| `zCustomQueryBuilder` | `zCustomQuery` (identical, pick one name) |
| `zCustomMutationBuilder` | `zCustomMutation` |
| `zCustomActionBuilder` | `zCustomAction` |
| `customCtxWithHooks()` | `customCtx()` from convex-helpers |
| `zCustomCtx()` | `customCtx()` from convex-helpers |
| `zCustomCtxWithArgs()` | `customCtxAndArgs()` from convex-helpers |

### What gets removed

| Removed | Reason |
|---|---|
| `CustomizationWithHooks` type | `Customization` from convex-helpers is sufficient |
| `CustomizationHooks` type | `onSuccess` is in convex-helpers' `Customization` |
| `CustomizationTransforms` type | Eliminated by pipeline ordering fix |
| `buildHandler()` | Reimplemented `customFnBuilder` without Zod validation |
| `createDatabaseHooks()` | Consumer's responsibility |
| `composeHooks()` | Consumer composes their own wrappers |
| `DatabaseHooks` type | Replaced by consumer wrapper functions |

### Hotpot migration

| Current usage | Migration |
|---|---|
| `zCustomQueryBuilder(query, customization)` | `zCustomQuery(query, customization)` — rename |
| `transforms.output` for audit logging | `onSuccess` in `customCtx` return — pipeline ordering fix makes this work |
| `createSecureReader` wrapping raw `ctx.db` | Same pattern, `ctx.db` is now codec-aware — security wraps on top |
| `zx.codec()` for SensitiveField | Unchanged |

### Post-migration evaluation

After migration is complete, evaluate whether the `zodvex/transform` package export still provides value or should be removed/consolidated.

---

## De-risking & Testing Strategy

### Priority 1: Pipeline ordering proof

This is the foundation. If this doesn't hold, `onSuccess` replacing `transforms.output` and eliminating `boundary` config both fall apart.

1. **`onSuccess` sees runtime types** — result contains `Date` instances and `SensitiveWrapper` instances, not timestamps and wire objects
2. **`onSuccess` sees SensitiveWrapper instances** — audit logging can call `.expose()` and check `.status`
3. **`onSuccess` has closure access** — resources created in `input()` are accessible in `onSuccess` callback

### Priority 2: DB codec layer

4. **Reads return runtime types** — `ctx.db.get(id)` returns Date objects, SensitiveWrapper instances
5. **Writes accept runtime types** — `ctx.db.insert("table", { startDate: new Date() })` stores timestamp
6. **Consumer wrapper composes** — wrapping codec-aware `ctx.db` with security reader preserves codec behavior

### Priority 3: Decode cost benchmark

7. **Overhead is negligible** — 1000 docs with mixed codecs, decode-then-filter vs filter-then-decode, target <25ms overhead

### Priority 4: Integration

8. **Full blessed-builder flow** — `initZodvex` -> `zCustomQuery` with `customCtx` -> handler reads/writes -> `onSuccess` audits -> wire result to client

---

## Decision Log

| Decision | Choice | Rationale |
|---|---|---|
| Identity | Codec boundary layer | Not a general Zod wrapper; convex-helpers covers basics |
| Customization type | convex-helpers' `Customization` directly | No zodvex wrapper type needed |
| DB middleware API | None (consumer wrapper functions) | Follows Convex's `wrapDatabaseReader` pattern |
| DB middleware data | Runtime types only | See `docs/decisions/2026-02-17-runtime-only-middleware.md` |
| Function-boundary middleware | None (`onSuccess` sufficient) | Pipeline ordering fix eliminates need for `transforms.*` |
| "Hooks" naming | Removed concept | Consumer owns interception via wrapper functions |
| Builder hierarchy | `zQuery` (base) -> `zCustomQuery` (blessed builders) | Matches Convex's `query` -> `customQuery` |
| Migration | Major version bump, deprecations, no `zodvex/v2` | Clean evolution, deprecated exports with warnings |
| Codegen | Direct schema references | No `zodToSource()` for custom codecs |
| Client-safe models | Open item | `zodTable()` depends on server-only `defineTable()` |
| `zodvex/transform` | Evaluate post-migration | May not be needed after redesign |
| Convex philosophy | "Blessed functions" pattern | No middleware chaining; compose in one `customCtx` |
