# Runtime Registry, React Hooks & Vanilla Client

> Design for the consumer layer: typed registry, React hooks, vanilla JS client, and action auto-codec.

---

## 1. Problem

zodvex codegen produces a `zodvexRegistry` mapping function paths to Zod schemas. Three consumers need to use this registry for automatic codec transforms:

1. **React hooks** — decode wire data from `useQuery` results to runtime types (Date, custom codecs)
2. **Vanilla JS client** — same decode for non-React environments (Node.js CLI, SSR, vanilla apps)
3. **Server actions** — encode args before `ctx.runQuery`/`ctx.runMutation`, decode results after

Today, none of these consumers exist. The registry is generated but unused.

---

## 2. Design

### 2a. Registry Shape

The codegen produces a typed `zodvexRegistry` constant. Since the generated file is `.ts`, TypeScript infers decoded types directly from the Zod schemas — no separate `.d.ts` generation needed.

```typescript
// convex/_zodvex/api.ts (generated)
export const zodvexRegistry = {
  'users:get': {
    args: z.object({ id: zx.id("users") }),
    returns: UserModel.schema.doc.nullable(),
  },
  'tasks:list': {
    args: z.object({ status: z.enum([...]).optional(), ... }),
    returns: zPaginated(TaskModel.schema.doc),
  },
  // ... every registered function
} as const
```

Both `args` and `returns` schemas are present — required for full round-trip codec in actions.

### 2b. Factory Functions (zodvex source code)

Three factory functions take a registry and return pre-bound consumers:

**`zodvex/react` — `createZodvexHooks(registry)`**

Returns `{ useZodQuery, useZodMutation }`. Thin wrappers around Convex's native `useQuery`/`useMutation` from `convex/react`:

- `useZodQuery(fnRef, args)` — calls `useQuery`, decodes result via registry's `returns` schema
- `useZodMutation(fnRef)` — returns a mutate function that encodes args via registry's `args` schema

API is identical to Convex's hooks. Drop-in replacement.

**`zodvex/client` — `createZodvexClient(registry, options)`**

Returns a `ZodvexClient` instance wrapping `ConvexClient` from `convex/browser`:

- `.query(fnRef, args)` — encode args, decode result
- `.mutate(fnRef, args)` — encode args, decode result
- `.subscribe(fnRef, args, callback)` — encode args, decode in callback

hotpot wraps `ZodvexClient` instead of `ConvexClient` directly, adding security transforms on top.

**`zodvex/server` — `createZodvexActionCtx(registry, ctx)` (internal)**

Wraps `ctx.runQuery` and `ctx.runMutation` on action contexts:

1. Look up function path in registry
2. Encode args via `args` schema (Date → number, etc.)
3. Call original `ctx.runQuery`/`ctx.runMutation` with wire args
4. Decode result via `returns` schema
5. Return decoded result to handler

Consumer never calls this directly — it's used internally by `za`/`zia` builders.

### 2c. Codegen Output

```
convex/_zodvex/
  schema.ts    — model re-exports (existing, unchanged)
  api.ts       — typed zodvexRegistry (renamed from validators.ts)
  client.ts    — pre-bound hooks + client factory (NEW)
```

**`_zodvex/client.ts`** (generated):

```typescript
import { createZodvexHooks } from 'zodvex/react'
import { createZodvexClient } from 'zodvex/client'
import { zodvexRegistry } from './api'

export const { useZodQuery, useZodMutation } = createZodvexHooks(zodvexRegistry)

export const createClient = (options: { url: string; token?: string }) =>
  createZodvexClient(zodvexRegistry, options)
```

Consumer usage — zero boilerplate:

```typescript
import { useZodQuery } from '../_zodvex/client'
const user = useZodQuery(api.users.get, { id })  // user.createdAt is Date
```

### 2d. Action Integration via initZodvex

`initZodvex` gains an optional `registry` parameter (lazy thunk to break circular dependency):

```typescript
import { zodvexRegistry } from './_zodvex/api'

export const { zq, zm, za } = initZodvex(schema, server, {
  registry: () => zodvexRegistry
})
```

**Circular dependency resolution:** Functions are created by `za` → codegen discovers them → codegen produces the registry → `za` needs the registry. The lazy thunk breaks this cycle: the import resolves at module load time (the file exists), but the thunk is only called at runtime when an action handler invokes `ctx.runQuery`.

**Stub generation:** `zodvex init` creates an empty `_zodvex/api.ts` stub so the import resolves before the first codegen run:

```typescript
// Auto-generated stub. Run `zodvex generate` to populate.
export const zodvexRegistry = {} as const
```

When `registry` is omitted from `initZodvex`, `za`/`zia` behave as today (no codec wrapping). Backward compatible.

### 2e. Package Entry Points

```
zodvex           — everything (existing)
zodvex/core      — client-safe schemas, codecs, models (existing)
zodvex/server    — server builders, initZodvex, DB wrappers (existing)
zodvex/react     — NEW: createZodvexHooks factory
zodvex/client    — NEW: createZodvexClient, ZodvexClient class
zodvex/codegen   — codegen CLI + generate (existing)
zodvex/transform — schema transforms (existing)
```

Peer dependencies:
- `zodvex/react` adds `react` as optional peer dep
- `zodvex/client` uses `convex/browser` (already transitive from `convex`)
- `zodvex/server` gains no new deps

---

## 3. Spike: Function Path Lookup

**Problem:** Given `api.tasks.list` (a FunctionReference object), how do we get `"tasks:list"` (the registry key)?

**Candidates:**
- `getFunctionName()` from `convex/server` — official API, but likely server-only
- If not available client-side: explore reimplementing the extraction logic, or investigate what Convex's own `useQuery` does internally to resolve the function reference (it must extract the path somewhere)
- Direct `_name` property access — works but depends on Convex internals

**Resolution:** Spike during implementation. Design the registry lookup interface behind an abstraction so the mechanism can be swapped without changing consumers.

---

## 4. Consumer Experience

### React

```typescript
import { useZodQuery, useZodMutation } from '../_zodvex/client'
import { api } from '../_generated/api'

function UserProfile({ id }) {
  const user = useZodQuery(api.users.get, { id })
  // user.createdAt is Date, not number
}
```

### Vanilla JS / Node.js

```typescript
import { createClient } from '../_zodvex/client'
import { api } from '../_generated/api'

const client = createClient({ url: 'https://...' })
const user = await client.query(api.users.get, { id })
// user.createdAt is Date
```

### Server Actions

```typescript
export const myAction = za({
  args: { userId: zx.id('users') },
  handler: async (ctx, { userId }) => {
    const user = await ctx.runQuery(api.users.get, { id: userId })
    // user.createdAt is Date — auto-decoded via registry
  },
})
```

---

## 5. hotpot Integration Path

hotpot currently wraps `ConvexClient` with `HotpotClient` for security transforms. With this design:

- `HotpotClient` wraps `ZodvexClient` instead of `ConvexClient`
- Codec transforms (Date, custom codecs) happen at the zodvex layer
- Security transforms (SensitiveField encode/decode) happen at the hotpot layer
- Same layering pattern as server-side (zodvex codec → hotpot security)

React-side: hotpot's `useSensitiveQuery` would wrap `useZodQuery` instead of `useQuery`, gaining auto-codec for free.
