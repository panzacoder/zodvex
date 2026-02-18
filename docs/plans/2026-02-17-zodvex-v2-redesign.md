# zodvex v2 Redesign: Codec Boundary Layer

**Date:** 2026-02-17
**Status:** Approved (revised)
**Branch:** `fix/codec-issues`
**Context:** Full API redesign based on audit of builder/wrapper layers, hotpot consumer analysis, and alignment with Convex's "blessed functions" philosophy.
**Prerequisite reading:** `docs/decisions/2026-02-17-runtime-only-middleware.md`
**Revision note:** Revised to align with convex-helpers' composition model. zodvex owns codec correctness; convex-helpers owns customization lifecycle (onSuccess, ctx augmentation, builder chaining).

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

- Context customization — convex-helpers' `customCtx`
- Authorization / security — hotpot (or the consumer)
- Function-level side effects — convex-helpers' `onSuccess`
- Customization lifecycle (input, onSuccess, builder chaining) — convex-helpers
- DB-level middleware / interception — consumer wrapper functions (Convex's `wrapDatabaseReader` pattern)

### Relationships

- **convex-helpers:** zodvex produces builders that are composable with convex-helpers' `customQuery`. Consumers chain customizations using convex-helpers' native composition model. zodvex never re-implements convex-helpers' customization lifecycle.
- **hotpot:** Primary consumer. Uses `customQuery(zq, hotpotCustomization)` to build "blessed builders".
- **App developers:** Use hotpot's blessed builders. See `{ args, handler, returns }` — identical to vanilla Convex.

### Key principle: composability

zodvex builders produce output that convex-helpers' `customQuery` can wrap. This means:

```typescript
// zodvex produces a codec-aware builder
const zq = zCustomQuery(query, codecCustomization)

// convex-helpers chains customizations on top — standard composition
const layer1 = customQuery(zq, auditCustomization)
const layer2 = customQuery(layer1, securityCustomization)
```

zodvex never handles `onSuccess`, never manages customization lifecycle, never re-implements builder chaining. That's convex-helpers' job.

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
- Returns a builder whose output is composable with convex-helpers' `customQuery`

**`createCodecCustomization(zodTables)`** — Returns a standard convex-helpers `Customization` that wraps `ctx.db` with codec-aware reader/writer.
- For queries: wraps with `createZodDbReader` (decode on read)
- For mutations: wraps with `createZodDbWriter` (decode on read, encode on write)
- This is a plain `Customization` — no zodvex-specific types

### Usage patterns

**Pattern 1: Direct — codec-aware builder**

```typescript
const codecCust = createCodecCustomization(zodTables)
const zq = zCustomQuery(query, codecCust)

export const getEvent = zq({
  args: { eventId: zx.id("events") },
  returns: Events.schema.doc.nullable(),
  handler: async (ctx, { eventId }) => {
    return ctx.db.get(eventId)  // returns Date objects, not timestamps
  },
})
```

**Pattern 2: Blessed builder — compose with convex-helpers**

```typescript
import { customQuery, customCtx } from 'convex-helpers/server/customFunctions'

const codecCust = createCodecCustomization(zodTables)
const zq = zCustomQuery(query, codecCust)

// convex-helpers chains customization on top — standard pattern
const hotpotQuery = customQuery(zq, {
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

// App developers use the blessed builder
export const getPatient = hotpotQuery({
  args: { patientId: zx.id("patients") },
  returns: Patients.schema.doc.nullable(),
  handler: async (ctx, { patientId }) => {
    return ctx.db.get(patientId)
  },
})
```

**Pattern 3: Multi-layer composition**

```typescript
// Each layer is independent and composable
const zq = zCustomQuery(query, codecCust)
const auditQuery = customQuery(zq, auditCustomization)
const hotpotQuery = customQuery(auditQuery, securityCustomization)
```

### `initZodvex` — convenience binding

```typescript
import { initZodvex } from 'zodvex/server'

const { zq, zm, za, ziq, zim, zia } = initZodvex(schema, server)
```

Pre-binds `createCodecCustomization(schema.zodTables)` + `server.query`/etc. into ready-to-use builders. Equivalent to:

```typescript
const codecCust = createCodecCustomization(schema.zodTables)
const zq = zCustomQuery(server.query, codecCust)
const zm = zCustomMutation(server.mutation, codecCust)
const za = zCustomAction(server.action)  // no DB in actions
const ziq = zCustomQuery(server.internalQuery, codecCust)
const zim = zCustomMutation(server.internalMutation, codecCust)
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
const hotpotQuery = customQuery(zq, hotpotCustomization)
```

### Composability constraint

`customQuery(zq, customization)` works when `customization.args` is `{}` (no custom args from the customization layer). This is the common case — most customizations only add ctx properties (user, db, etc.), not extra args.

When a customization needs custom args (e.g., `{ sessionId: v.id("sessions") }`), convex-helpers' `addFieldsToValidator` will try to merge Convex validators with the Zod schemas from the inner builder. This does not work. For this case, use `zCustomQuery` directly with the customization:

```typescript
// Custom args from customization — use zCustomQuery directly
const sessionQuery = zCustomQuery(query, {
  args: { sessionId: v.id("sessions") },  // Convex validator
  input: async (ctx, { sessionId }) => {
    const session = await ctx.db.get(sessionId)
    return { ctx: { session }, args: {} }
  },
})
```

This is a known limitation documented here so consumers don't hit it by surprise.

---

## Pipeline Design

zodvex owns steps 1, 3, 6, 7. convex-helpers owns steps 2 and 5 (when the consumer chains with `customQuery`).

### Function pipeline (boundaries 3,4)

```
CLIENT REQUEST
  |
  v
1. Zod->Convex validator conversion              (construction time, once)
   zodToConvexFields(argsSchema) -> Convex args     [zodvex]
   zodToConvex(returnsSchema) -> Convex returns      [zodvex]
  |
2. customization.input(ctx, customArgs, extra)    [convex-helpers or zodvex codec]
   -> { ctx, args, onSuccess? }
   Codec customization: ctx.db is now codec-aware
   Consumer customization: ctx augmented with user, security, etc.
  |
3. Zod args parse: argsSchema.safeParse(args)     [zodvex]
   Codecs decode: timestamp -> Date, etc.            (boundary 3: wire -> runtime)
  |
4. handler(augmentedCtx, runtimeArgs) -> result   [user code]
   ctx.db reads return runtime types
   ctx.db writes accept runtime types
  |
5. onSuccess({ ctx, args, result })               [convex-helpers]
   Sees runtime types: Date, SensitiveWrapper
   Runs here, before step 6
  |
6. Zod return encode: z.encode(returns, result)   [zodvex]
   Codecs encode: Date -> timestamp, etc.            (boundary 4: runtime -> wire)
  |
7. stripUndefined(encoded)                        [zodvex]
  |
8. Return wire result to Convex
```

### Key invariant

`onSuccess` (step 5) runs before Zod encode (step 6). This is guaranteed by the architecture: convex-helpers runs `onSuccess` after the inner handler returns but before passing the result back. zodvex's Zod encode happens inside the inner handler's return path. So the sequence is always: zodvex handler encodes → returns to convex-helpers → convex-helpers has already run onSuccess before reaching zodvex's encode.

**Wait — that's wrong.** Let me trace more carefully:

When composed as `customQuery(zq, customization)`:
1. convex-helpers' outer handler runs `customization.input()` → gets `{ ctx, args, onSuccess }`
2. Calls inner handler (zodvex's `zq`) with augmented ctx
3. zodvex's handler: parses args through Zod, runs user handler, **encodes returns through Zod**
4. zodvex returns encoded wire result to convex-helpers
5. convex-helpers runs `onSuccess({ result })` — but result is already encoded!

**This means `onSuccess` sees wire types, not runtime types.** The encode happens inside zodvex's handler, before convex-helpers runs `onSuccess`.

### Solving the onSuccess ordering problem

There are two approaches:

**Option A: zodvex's `customFnBuilder` handles `onSuccess` from the codec customization's `input()` return.**

zodvex's internal `customFnBuilder` checks for `added.onSuccess` (the convex-helpers convention) and runs it before Zod encode. This is a small, focused piece of convex-helpers' lifecycle that zodvex must replicate to maintain the key invariant. zodvex does NOT re-implement the full customization lifecycle — just the `onSuccess` timing.

When composed as `customQuery(zq, hotpotCustomization)`:
- The codec customization (inside `zq`) has no `onSuccess` — it just wraps ctx.db
- The consumer's customization (in `customQuery`) returns `onSuccess`
- convex-helpers runs `onSuccess` after zodvex's handler returns — **sees wire types**

So `onSuccess` from the outer `customQuery` layer sees wire types. But `onSuccess` from a customization passed directly to `zCustomQuery` sees runtime types (because zodvex handles it before encode).

**This is a documented trade-off:**
- Direct `zCustomQuery(query, customizationWithOnSuccess)` → onSuccess sees runtime types ✓
- Composed `customQuery(zq, customizationWithOnSuccess)` → onSuccess sees wire types ✗

**Option B: zodvex does NOT encode returns — let Convex handle it.**

If zodvex skips the `z.encode` step and relies on Convex's own return validator (generated by `zodToConvex` at construction time), then the handler returns runtime types. convex-helpers' `onSuccess` sees runtime types. Convex's validator layer encodes.

But Convex's validator doesn't know about Zod codecs — it only knows about `v.number()`, `v.string()`, etc. A `Date` returned from the handler would fail Convex's `v.float64()` validator. So zodvex MUST encode returns.

**Resolution: Option A.** zodvex's `customFnBuilder` handles `onSuccess` from its direct customization's `input()` return, running it before Zod encode. For the composed case (`customQuery(zq, outerCustomization)`), the outer `onSuccess` sees wire types. This is acceptable because:

1. The hotpot pattern puts `onSuccess` in the **direct** customization to `zCustomQuery`, not in an outer `customQuery` layer
2. If a consumer needs `onSuccess` to see runtime types, they pass it directly to `zCustomQuery`
3. The outer `customQuery` layer is for auth/security context — `onSuccess` is less common there

### What zodvex's `customFnBuilder` handles

- Zod-to-Convex validator conversion (construction time)
- `customization.input()` execution (to augment ctx with codec DB)
- `onSuccess` from `customization.input()` return — before Zod encode
- Zod args parse
- Zod returns encode
- `stripUndefined`
- `__zodvexMeta` decoration

### What zodvex's `customFnBuilder` does NOT handle

- Builder chaining / composition (convex-helpers' `customQuery`)
- Transforms (eliminated)
- Hooks (eliminated — `onSuccess` is the convex-helpers convention, handled as above)
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

Returns a standard convex-helpers `Customization` object:

```typescript
function createCodecCustomization(zodTables: ZodTableMap): Customization {
  return {
    args: {},
    input: async (ctx) => ({
      ctx: { db: createZodDbWriter(ctx.db, zodTables) },
      args: {}
    })
  }
}
```

Note: Uses `createZodDbWriter` (not reader) because it extends reader with insert/patch/delete. For query-only builders, the extra write methods are harmless — they're never called.

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

// Composed with convex-helpers
const hotpotQuery = customQuery(zq, customCtx(async (ctx) => {
  const user = await getUser(ctx)
  const db = createSecureReader({ user }, ctx.db, securityRules)
  return { user, db }
}))
```

### What zodvex provides

| Export | Purpose |
|---|---|
| `createCodecCustomization(zodTables)` | Standard `Customization` for codec DB wrapping |
| `createZodDbReader(db, zodTables)` | Manual reader wrapping (escape hatch) |
| `createZodDbWriter(db, zodTables)` | Manual writer wrapping (escape hatch) |
| `CodecDatabaseReader` / `CodecDatabaseWriter` types | Interface for the codec-wrapped db |
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
- `zCustomQuery`, `zCustomMutation`, `zCustomAction` — improved (composable with convex-helpers' `customQuery`)
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
| `zCustomQueryBuilder(query, customization)` | `zCustomQuery(query, codecCust)` + `customQuery(zq, hotpotCustomization)` |
| `transforms.output` for audit logging | `onSuccess` in customization passed to `zCustomQuery` or `customQuery` |
| `createSecureReader` wrapping raw `ctx.db` | Same pattern — `ctx.db` is now codec-aware via `createCodecCustomization` |
| `zx.codec()` for SensitiveField | Unchanged |

### Post-migration evaluation

After migration is complete, evaluate whether the `zodvex/transform` package export still provides value or should be removed/consolidated.

---

## De-risking & Testing Strategy

### Priority 1: Composition proof

This is the foundation. If `customQuery(zq, customization)` doesn't compose correctly, the entire architecture falls apart.

1. **`customQuery(zq, customization)` produces working blessed builders** — args are Zod schemas, returns are Zod schemas, everything validates and encodes correctly
2. **Multi-layer composition works** — `customQuery(customQuery(zq, layer1), layer2)` chains correctly
3. **`onSuccess` sees runtime types when passed directly to `zCustomQuery`** — the key invariant holds for the direct path

### Priority 2: onSuccess ordering verification

4. **Direct path: `zCustomQuery(query, customizationWithOnSuccess)`** — onSuccess sees Date, SensitiveWrapper (runtime types)
5. **Composed path: `customQuery(zq, customizationWithOnSuccess)`** — onSuccess sees timestamps, wire objects (encoded types) — this is the documented trade-off
6. **onSuccess has closure access** — resources created in `input()` are accessible in `onSuccess` callback

### Priority 3: DB codec layer

7. **Reads return runtime types** — `ctx.db.get(id)` returns Date objects, SensitiveWrapper instances
8. **Writes accept runtime types** — `ctx.db.insert("table", { startDate: new Date() })` stores timestamp
9. **Consumer wrapper composes** — wrapping codec-aware `ctx.db` with security reader preserves codec behavior

### Priority 4: Decode cost benchmark

10. **Overhead is negligible** — 1000 docs with mixed codecs, target <25ms overhead

### Priority 5: Integration

11. **Full blessed-builder flow** — `initZodvex` → `customQuery(zq, hotpotCustomization)` → handler reads/writes → `onSuccess` audits → wire result to client

---

## Decision Log

| Decision | Choice | Rationale |
|---|---|---|
| Identity | Codec boundary layer | Not a general Zod wrapper; convex-helpers covers basics |
| Customization lifecycle | convex-helpers owns it | zodvex never re-implements builder chaining, onSuccess timing, etc. |
| Customization type | convex-helpers' `Customization` directly | No zodvex wrapper type needed |
| Composition model | `customQuery(zq, customization)` | zodvex builders are composable with convex-helpers' `customQuery` |
| onSuccess handling | zodvex handles it for direct customization only | Direct path sees runtime types; composed path sees wire types (documented trade-off) |
| `customFnBuilder` | Internal only — not a public API | Workhorse for Zod validation; consumers never see it |
| DB middleware API | None (consumer wrapper functions) | Follows Convex's `wrapDatabaseReader` pattern |
| DB middleware data | Runtime types only | See `docs/decisions/2026-02-17-runtime-only-middleware.md` |
| `initZodvex` return names | Short names: `zq`, `zm`, `za`, `ziq`, `zim`, `zia` | Ergonomic; avoids collision with export-level names |
| Builder naming | No "Builder" suffix; `zCustomQuery` is the primary name | Aligns with convex-helpers' `zCustomQuery` naming |
| Migration | Major version bump, deprecations, no `zodvex/v2` | Clean evolution, deprecated exports with warnings |
| Codegen | Direct schema references + `__zodvexMeta` | No `zodToSource()` for custom codecs |
| Client-safe models | Open item | `zodTable()` depends on server-only `defineTable()` |
| `zodvex/transform` | Evaluate post-migration | May not be needed after redesign |
| Convex philosophy | "Blessed functions" via composition | `customQuery(zq, customization)` — each layer is independent |
