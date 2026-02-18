# Composition Layer Design: `createCodecCustomization` + `initZodvex`

> Bridges the DB codec primitives (boundaries 5/6) to the function builder layer.
> Builds on the v2 distilled design (Section 3 + Section 5).

---

## 1. `createCodecCustomization` (public)

**File:** `src/customization.ts`

Creates convex-helpers `Customization` objects that wrap `ctx.db` with codec readers/writers. Returns `{ query, mutation }` for manual composition or use with `zCustomQuery`/`zCustomMutation`.

```typescript
function createCodecCustomization(tableMap: ZodTableMap): {
  query: Customization    // wraps ctx.db with CodecDatabaseReader
  mutation: Customization // wraps ctx.db with CodecDatabaseWriter
}
```

Each customization's `input` function replaces `ctx.db` with the codec-wrapped version. Tables not in the `ZodTableMap` pass through unchanged.

**Use case:** Advanced users / frameworks (like hotpot) that compose their own customizations and don't use `initZodvex`.

---

## 2. `initZodvex`

**File:** `src/init.ts`

One-time setup. Accepts the schema (from `defineZodSchema`) and the full Convex server object. Returns pre-bound builders with optional DB wrapping.

```typescript
function initZodvex(
  schema: { __zodTableMap: ZodTableMap },
  server: {
    query, mutation, action,
    internalQuery, internalMutation, internalAction
  },
  options?: { wrapDb?: boolean }  // default: true
): {
  zq, zm, za,     // public builders (callable + .withContext())
  ziq, zim, zia   // internal builders (callable + .withContext())
}
```

### Options

- `wrapDb: true` (default) — every function gets codec-wrapped `ctx.db`
- `wrapDb: false` — builders do Zod validation on args/returns but don't touch `ctx.db`. For users who want pre-bound schema convenience without DB interception.

### Builder shape

Each builder (e.g., `zq`) is:

1. **Callable** — `zq({ args, handler, returns? })` produces a registered Convex function with Zod validation and (if `wrapDb: true`) codec DB wrapping.

2. **Has `.withContext()`** — `zq.withContext(customization)` returns a `CustomBuilder` that pre-composes the codec layer + the user's customization.

```typescript
// Base usage: Zod validation + codec DB
export const getUser = zq({
  args: { id: zx.id('users') },
  handler: async (ctx, { id }) => ctx.db.get(id)
})

// With custom context: + auth/security layer
const authQuery = zq.withContext(
  customCtx(async (ctx) => {
    // ctx.db is already codec-wrapped here
    const user = await getUserOrThrow(ctx)
    return { user }
  })
)

export const getMyProfile = authQuery({
  handler: async (ctx) => ctx.db.get(ctx.user._id)
})
```

Actions (`za`, `zia`) always use NoOp for the codec customization (actions don't have `ctx.db`). They still get `.withContext()` for custom context injection.

---

## 3. Composition mechanics

### Why this works (avoiding the nesting constraint)

The v2 distilled design's hard constraint (2a): `zCustomQuery(zCustomQuery(...))` does NOT work. Zod-aware builders cannot nest.

We avoid this by composing at the **customization level**, not the builder level. `.withContext()` creates a single composed customization and passes it to one `zCustomQuery` call against the raw Convex builder.

### `.withContext()` composition

```typescript
zq.withContext = (userCust) => {
  const composed = {
    args: userCust.args ?? {},
    input: async (ctx, args, extra) => {
      // 1. Codec layer: wrap ctx.db
      const codecResult = await codecCust.input(ctx, {}, extra)
      const codecCtx = { ...ctx, ...codecResult.ctx }

      // 2. User layer: sees codec-wrapped ctx.db
      const userResult = await userCust.input(codecCtx, args, extra)

      // 3. Merge: user ctx additions on top of codec ctx
      return {
        ctx: { ...codecResult.ctx, ...userResult.ctx },
        args: userResult.args ?? {}
      }
    }
  }
  return zCustomQuery(server.query, composed)
}
```

### Validation checkpoint

**This composition MUST be validated during implementation with runtime tests.**

Test cases:
1. `zq({ args, handler })` — handler's `ctx.db` returns decoded docs (Date objects, not timestamps)
2. `zq.withContext(cust)({ args, handler })` — handler sees both codec-wrapped `ctx.db` AND augmented context from user customization
3. Writes through `zm` — `ctx.db.insert()` encodes runtime values to wire format

**If any test fails, stop implementation and return to design.** The likely failure mode is a shape mismatch in how `customFnBuilder` processes the composed customization's `input` return value.

---

## 4. Internal: `createZodvexBuilder`

**File:** `src/init.ts` (not exported)

Generic factory that creates a callable-with-`.withContext()` from a raw Convex builder + codec customization:

```typescript
function createZodvexBuilder(
  rawBuilder: any,
  codecCust: Customization,
  customFn: typeof zCustomQuery
) {
  const base = customFn(rawBuilder, codecCust)

  base.withContext = (userCust) => {
    const composed = composeCodecAndUser(codecCust, userCust)
    return customFn(rawBuilder, composed)
  }

  return base
}
```

Used by `initZodvex`:

```typescript
const codec = createCodecCustomization(schema.__zodTableMap)
const noOp = { args: {}, input: NoOp.input }
const wrap = options?.wrapDb !== false

return {
  zq:  createZodvexBuilder(server.query, wrap ? codec.query : noOp, zCustomQuery),
  zm:  createZodvexBuilder(server.mutation, wrap ? codec.mutation : noOp, zCustomMutation),
  za:  createZodvexBuilder(server.action, noOp, zCustomAction),
  ziq: createZodvexBuilder(server.internalQuery, wrap ? codec.query : noOp, zCustomQuery),
  zim: createZodvexBuilder(server.internalMutation, wrap ? codec.mutation : noOp, zCustomMutation),
  zia: createZodvexBuilder(server.internalAction, noOp, zCustomAction),
}
```

### `composeCodecAndUser` (internal helper)

Builds a single composed `Customization` from the codec layer and the user's customization. Codec `input` runs first, user `input` sees the codec-wrapped ctx.

---

## 5. Export structure

| Export | Path | Public? |
|---|---|---|
| `createCodecCustomization` | `zodvex/server` | Yes — escape hatch for manual composition |
| `initZodvex` | `zodvex/server` | Yes — opinionated entrypoint |
| `createZodvexBuilder` | — | No — internal to `src/init.ts` |
| `composeCodecAndUser` | — | No — internal to `src/init.ts` |

**Unchanged exports** (all still work):
- `zQueryBuilder`, `zMutationBuilder`, `zActionBuilder` — standalone builders
- `zCustomQuery`, `zCustomMutation`, `zCustomAction` — 2-arg custom builders
- `createZodDbReader`, `createZodDbWriter` — DB wrapper primitives

---

## 6. File organization

- `src/customization.ts` (new) — `createCodecCustomization`
- `src/init.ts` (new) — `initZodvex`, `createZodvexBuilder`, `composeCodecAndUser`
- `src/server/index.ts` (modified) — add exports for new modules
