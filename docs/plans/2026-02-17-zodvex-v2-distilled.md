# zodvex v2: Distilled Design Knowledge

> Standalone reference. Everything we learned from the v2 redesign exploration.
> The branch (`fix/codec-issues`) may be discarded. This doc preserves the signal.

---

## 1. Identity

zodvex is a **codec boundary layer** for Convex. Six boundaries, three pairs:

```
Client Code  <->  useQuery/useMutation  <->  handler  <->  ctx.db
         [1,2]                      [3,4]            [5,6]
```

zodvex owns codec correctness at all six. It is NOT a general Zod wrapper or context management framework — convex-helpers handles context, zodvex adds codecs.

---

## 2. Hard Constraints Discovered

### 2a. Zod-aware builders cannot nest

`zCustomQuery(zCustomQuery(query, layer1), layer2)` **does not work**. This is inherent to the Zod-aware builder pattern — not a zodvex bug.

**Why:** The outer `customFnBuilder` converts Zod schemas → Convex validators, then calls `innerBuilder({ args: convexValidators, handler })`. The inner builder tries `z.object(convexValidators)` — fails because Convex validators aren't Zod schemas.

**Verified:** convex-helpers' own `zCustomQuery` (in `server/zod.ts`) has the same limitation. It calls `builder({ args, handler })` where `builder` must be a raw Convex builder, not another Zod-aware builder.

**Implication:** Composition must happen at the **customization level**, not the builder level. You compose customization objects, then pass one composed customization to one `zCustomQuery` call against the raw Convex builder.

### 2b. Convex enforces Reader/Writer at compile AND runtime

- `ctx.db` in queries is `GenericDatabaseReader` — no `insert()`, `patch()`, `delete()`
- `ctx.db` in mutations is `GenericDatabaseWriter` — extends reader with write methods
- TypeScript enforces at compile time, Convex enforces at runtime
- Using Writer for queries gives misleading autocomplete and confusing runtime errors

**Implication:** Codec DB wrappers must be separate: `createZodDbReader` for queries, `createZodDbWriter` for mutations. Any "codec customization" must return `{ query, mutation }` — not a single object.

### 2c. onSuccess must fire before Zod encode

`onSuccess` callbacks need to see **runtime types** (Date, SensitiveWrapper), not wire types (timestamp, string). This means onSuccess must run before `z.encode(returns, result)`.

convex-helpers' own `customFnBuilder` (non-Zod, in `customFunctions.ts`) runs onSuccess before returning — but the Zod `customFnBuilder` runs `returns.parse(ret)` (which encodes) BEFORE `onSuccess`. This means:

- zodvex's `customFnBuilder` must handle onSuccess **before** the encode step
- This is already the case in zodvex's implementation

---

## 3. Composition Model

### The pattern that works

Compose **customizations**, not builders. One `zCustomQuery` call per builder, against the raw Convex builder:

```typescript
// initZodvex composes codec + user customization into ONE object
function makeZCustomQuery(userCustomization) {
  const composed = {
    args: userCustomization.args ?? {},
    input: async (ctx, args, extra) => {
      // 1. Codec layer: wrap ctx.db
      const codecDb = createZodDbReader(ctx.db, zodTables)
      const codecCtx = { ...ctx, db: codecDb }
      // 2. User layer: augment ctx with auth, security, etc.
      const result = await userCustomization.input(codecCtx, args, extra)
      return result
    }
  }
  return zCustomQuery(server.query, composed)  // ONE call, raw builder
}
```

### What `initZodvex` should return

```typescript
const {
  zq, zm, za,         // base builders (codec-aware)
  ziq, zim, zia,       // internal variants
  zCustomQuery,        // one-arg factory: (customization) => builder
  zCustomMutation,     // one-arg factory: (customization) => builder
  zCustomAction,       // one-arg factory: (customization) => builder
} = initZodvex(schema, server)
```

The one-arg factories pre-compose codec + the user's customization. Consumer usage:

```typescript
const hotpotQuery = zCustomQuery({
  args: { sessionId: zx.id("sessions") },  // Zod validators
  input: async (ctx, { sessionId }) => {
    const user = await getUser(ctx)
    return { ctx: { user }, args: {} }
  }
})
```

### For users who don't use `initZodvex`

Export `createCodecCustomization(zodTables)` as the escape hatch:

```typescript
const codec = createCodecCustomization(zodTables)
// codec.query — wraps ctx.db with reader
// codec.mutation — wraps ctx.db with writer

// User must manually compose
const zq = zCustomQuery(server.query, composeCustomizations(codec.query, hotpotCust))
```

**Open question:** Do we need a `composeCustomizations` utility, or is manual composition sufficient?

---

## 4. Pipeline Ordering

```
1. Zod→Convex validator conversion           (construction time)
2. customization.input() chain                (codec layer, then user layers)
   → { ctx, args, onSuccess? }
3. Zod args parse (decode: wire → runtime)    (boundary 3)
4. handler(augmentedCtx, runtimeArgs)          (user code)
5. onSuccess({ ctx, args, result })            (sees runtime types)
6. Zod return encode (runtime → wire)          (boundary 4)
7. stripUndefined
```

Key: onSuccess (step 5) always before encode (step 6).

---

## 5. DB Codec Layer

### What exists and works

- `createZodDbReader(db, zodTables)` — wraps reads with decode
- `createZodDbWriter(db, zodTables)` — wraps reads with decode + writes with encode
- `decodeDoc(schema, wireDoc)` / `encodeDoc(schema, runtimeDoc)` — primitives
- `ZodQueryChain` class — explicit wrapper, preserves `.first()`, `.unique()`, `.collect()`, `.take()`

### What should be added

- `createCodecCustomization(zodTables)` → `{ query: Customization, mutation: Customization }`
- Named types: `CodecDatabaseReader`, `CodecDatabaseWriter`
- Export `ZodTableMap`, `RuntimeDoc`, `WireDoc` types

### Consumer DB wrappers

hotpot (and others) write their own wrappers following Convex's `wrapDatabaseReader` pattern. zodvex provides the codec layer; consumers add security/RLS/FLS on top. zodvex does NOT provide hook points, compose utilities, or middleware APIs for this.

---

## 6. What to Eliminate

| Thing | Why |
|---|---|
| `CustomizationWithHooks` type | Use convex-helpers' `Customization` directly (has `onSuccess`) |
| `CustomizationHooks` type | Not needed |
| `transforms.input` / `transforms.output` | Replace with `customCtx` input + `onSuccess` |
| `createDatabaseHooks()` / `composeHooks()` | Consumer responsibility |
| `zCustomQueryBuilder` (duplicate name) | Keep `zCustomQuery` only |
| `zQueryBuilder` / `zMutationBuilder` / `zActionBuilder` | Fold into `zCustomQuery(builder)` |
| "Internal flattening" | Solving a problem we don't have — just compose customizations |

> **Migration note:** Removing `CustomizationWithHooks`, `CustomizationHooks`, `CustomizationTransforms`, `CustomizationResult`, `CustomizationInputResult` types, `customCtxWithHooks()` helper, and all transforms logic from `customFnBuilder` requires a migration path review for downstream consumers (hotpot). Until then, `customFnBuilder` checks both `added?.hooks?.onSuccess` (zodvex convention) and `added?.onSuccess` (convex-helpers convention) for backward compatibility.

---

## 7. What's Unchanged and Solid

- `zodTable()`, `defineZodSchema()` — schema definition
- `zx.date()`, `zx.id()`, `zx.codec()` — codec primitives
- `zodToConvex`, `zodToConvexFields` — validator mapping with correct optional/nullable
- `convexCodec` — encode/decode utilities
- `safePick`, `safeOmit`, `zPaginated`, `stripUndefined` — utilities

---

## 8. Open Items

1. **`composeCustomizations` utility** — needed? Or is manual composition fine?
2. **`__zodvexMeta` function decoration** — for codegen discovery. Shape: `{ zodArgs, zodReturns }`
3. **Client-safe model definitions** — `zodTable()` uses server-only `defineTable()`, blocking client imports
4. **Codegen / validator registry** — `_generated/zodvex/` with schema re-exports + `getReturns(fn)` / `getArgs(fn)`
5. **Multi-layer onSuccess** — when `initZodvex`'s factory composes codec + user customization, and the user customization returns `onSuccess`, how does it compose if there are multiple layers? (Only relevant if we support >2 layers)
