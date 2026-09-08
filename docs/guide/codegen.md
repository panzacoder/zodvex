# Codegen & Client-Side Schema Sharing

zodvex includes a code generator that introspects your Convex directory at build time and emits a `_zodvex/` directory. This is optional infrastructure — the server-side codec-aware DB works with just `initZodvex` and no codegen at all.

## What codegen provides

| Feature | Without codegen | With codegen |
|---------|-----------------|--------------|
| Codec-aware `ctx.db` (server) | Yes | Yes |
| Typed `QueryCtx` / `MutationCtx` | Manual | Generated |
| `useZodQuery` / `useZodMutation` React hooks | No | Yes |
| `ZodvexClient` for non-React consumers | No | Yes |
| Action auto-decode via registry | No | Yes |
| Boundary helpers (`encodeArgs`, `decodeResult`) | No | Yes |

**You do NOT need codegen for:**
- Server-side codec-aware DB reads and writes
- Zod validation on function args and returns
- Table schemas and model definitions

**You DO need codegen for:**
- Typed React hooks that encode args and decode results automatically
- `ctx.runQuery` / `ctx.runMutation` and `ctx.scheduler.runAfter` / `runAt` that auto-encode codec args (and decode results) via the registry
- Sharing Zod schemas between server and client without importing server-only modules

## Setup

### Install and run

zodvex ships a CLI. Add convenience scripts to your project's `package.json`:

```json
{
  "scripts": {
    "dev": "concurrently \"zodvex dev\" \"bunx convex dev\" \"vite\"",
    "build": "zodvex generate && vite build",
    "generate": "zodvex generate"
  }
}
```

- `zodvex generate` — one-shot generation, writes `convex/_zodvex/`
- `zodvex dev` — watch mode, regenerates on every `.ts` / `.js` change in `convex/`

By default the CLI looks for `./convex/` relative to cwd. Pass an explicit path if your layout differs:

```bash
zodvex generate path/to/convex
```

### gitignore

The `_zodvex/` directory is generated output. Add it to `.gitignore`:

```
convex/_zodvex/
```

## Registry wiring

The generated `_zodvex/api.js` exports a `zodvexRegistry` — a plain object mapping every public function path to its `args` and `returns` Zod schemas. Wire it into `initZodvex` via the `registry` option so `runQuery` / `runMutation` / `scheduler.runAfter` / `scheduler.runAt` auto-encode codec args (and decode results):

```typescript
// convex/functions.ts
import { initZodvex } from 'zodvex/server'
import { query, mutation, action, internalQuery, internalMutation, internalAction } from './_generated/server'
import schema from './schema'
import { zodvexRegistry } from './_zodvex/api.js'

export const { zq, zm, za, ziq, zim, zia } = initZodvex(schema, {
  query,
  mutation,
  action,
  internalQuery,
  internalMutation,
  internalAction,
}, {
  registry: () => zodvexRegistry,
})
```

The `registry` option is a thunk (`() => zodvexRegistry`) to avoid a circular-import issue: `functions.ts` is itself discovered during codegen, so it imports from `_zodvex/api.js` at runtime rather than at module evaluation time.

When the registry is provided, `za` and `zia` replace `ctx.runQuery` and `ctx.runMutation` with codec-aware versions that **encode args** (decoded → wire) before the call and **decode results** (wire → runtime) after, using the registry's `args` / `returns` schemas. The mutation builders (`zm` / `zim`) likewise wrap `ctx.scheduler.runAfter` / `ctx.scheduler.runAt` to encode args. This means you can pass natural decoded values when calling into another wrapped function — including codecs whose runtime form can't cross the Convex boundary as-is (e.g. a Symbol-valued field) — and zodvex encodes them to wire at the call site, symmetric with the inbound decode the receiver already performs.

## Generated files

Running `zodvex generate` writes four file pairs (`.js` + `.d.ts`) into `convex/_zodvex/`:

### `api.js` — the registry

The registry maps every public Convex function path to its Zod `args` and `returns` schemas. It is the source of truth used by the client hooks and action auto-decode.

```typescript
// _zodvex/api.js (generated excerpt)
export const zodvexRegistry = {
  'tasks:get': {
    args: z.object({ id: zx.id("tasks") }),
    returns: TaskModel.schema.doc.nullable(),
  },
  'tasks:create': {
    args: z.object({ title: z.string(), /* ... */ }),
    returns: zx.id("tasks"),
  },
  // one entry per public function
}
```

Model references (`TaskModel.schema.doc`) are imported directly — the registry stays live and always reflects the current schema definition.

### `schema.js` — model re-exports

Re-exports all `defineZodModel` model objects discovered in your convex directory. Lets client code import models from a single stable path rather than hunting through server files:

```typescript
// _zodvex/schema.js (generated)
export { TaskModel } from '../models/task.js'
export { UserModel } from '../models/user.js'
// ...
```

### `server.js` — context types

Exports `QueryCtx`, `MutationCtx`, and `ActionCtx` typed with the codec layer already applied. Import these instead of the raw types from `_generated/server`:

```typescript
// _zodvex/server.js (generated)
// QueryCtx  — ctx.db is ZodvexDatabaseReader (decoded types on reads)
// MutationCtx — ctx.db is ZodvexDatabaseWriter (decoded reads, encoded writes)
// ActionCtx — standard action context
```

Usage in your function files:

```typescript
import type { QueryCtx, MutationCtx } from './_zodvex/server.js'

export const getTask = zq({
  args: { id: zx.id('tasks') },
  returns: TaskModel.schema.doc.nullable(),
  handler: async (ctx: QueryCtx, { id }) => {
    return ctx.db.get(id) // return type is decoded Task, not wire format
  }
})
```

### `client.js` — pre-bound hooks and helpers

Exports React hooks and client utilities pre-bound to the registry:

```typescript
// _zodvex/client.js (generated)
export const { useZodQuery, useZodMutation, useQuery_experimental } = createZodvexHooks(zodvexRegistry)

export const createClient = (options) => createZodvexClient(zodvexRegistry, options)
export const createReactClient = (options) => createZodvexReactClient(zodvexRegistry, options)

export const { encodeArgs, decodeResult } = createBoundaryHelpers(zodvexRegistry)
```

Use `useZodQuery` and `useZodMutation` as drop-in replacements for Convex's built-in hooks. They encode args (e.g. `Date` → epoch ms) and decode results (e.g. epoch ms → `Date`) using the registry's Zod schemas:

```tsx
import { useZodQuery, useZodMutation } from '../convex/_zodvex/client'
import { api } from '../convex/_generated/api'

function TaskDetail({ id }: { id: string }) {
  const task = useZodQuery(api.tasks.get, { id })
  // task.dueDate is a Date, not a number — decoded automatically

  const complete = useZodMutation(api.tasks.complete)
  return <button onClick={() => complete({ id })}>Complete</button>
}
```

`encodeArgs` and `decodeResult` are lower-level helpers for non-hook use cases (e.g. form submit handlers, non-React clients).

### `useQuery_experimental` — explicit query states

The generated client also exports Convex's object-form query hook with codec support:

```tsx
import { useQuery_experimental } from '../convex/_zodvex/client'
import { api } from '../convex/_zodvex/api'

function Tasks() {
  const result = useQuery_experimental({ query: api.tasks.list, args: {} })
  if (result.status === 'pending') return <p>Loading…</p>
  if (result.status === 'error') return <p>{result.error.message}</p>
  return <pre>{JSON.stringify(result.data)}</pre>
}
```

Arguments use decoded types (such as `Date`), and successful results are decoded through the registry. Pass `args: 'skip'` to suspend the query. Set `throwOnError: true` to throw failures to a React error boundary; the result type then contains only `pending` and `success`.

This hook requires **Convex 1.37 or newer**. Older SDKs can still import the generated client and use the existing hooks; only calling `useQuery_experimental` requires upgrading. Bundlers may warn about the unavailable export on older SDKs; projects that treat such warnings as errors should also upgrade. The name follows Convex's experimental API naming and does not require a prerelease version of Zodvex.

By default, argument encoding and result decoding failures become an `error` state. Native query failures follow Convex's `throwOnError` setting; configuration errors such as a missing provider still throw. Unlike `useZodQuery`, this hook decodes strictly by default when a return schema exists. Missing registry entries or schemas pass through unchanged. A custom factory created with `createZodvexHooks(registry, { onDecodeError: 'warn' })` explicitly opts into warning and returning the raw wire result on decode failure.

### `ZodvexClient` / `ZodvexReactClient` — codec-aware drop-in clients

`createZodvexClient` (vanilla JS) and `createZodvexReactClient` (React) wrap Convex's `ConvexClient` / `ConvexReactClient` and apply registry codecs on every call — args are encoded to wire on the way out, results decoded to runtime on the way in. They aim to be **near drop-in replacements** for the Convex clients, exposing the same surface:

- **`ZodvexClient`** (↔ `ConvexClient`): `query`, `mutate` (alias `mutation`), `action`, `subscribe` (alias `onUpdate`), `onPaginatedUpdate_experimental`, `getAuth`, `setAuth` (accepts a token string *or* an `AuthTokenFetcher` + `onChange`), `connectionState`, `subscribeToConnectionState`, `closed` / `disabled`, `close`. The inner client is reachable via the `convex` getter.
- **`ZodvexReactClient`** (↔ `ConvexReactClient`): `query`, `mutation`, `action`, `watchQuery`, `prewarmQuery`, `setAuth`, `clearAuth`, `connectionState`, `subscribeToConnectionState`, `url`, `logger`, `close`.

The data methods (`query` / `mutate` / `action` / `subscribe` / `watchQuery` / paginated) are codec-wrapped; the auth, connection, and lifecycle methods are thin pass-throughs to the underlying Convex client.

### Paginated React queries

Generated clients export `useZodPaginatedQuery`:

```tsx
import { useZodPaginatedQuery } from '../convex/_zodvex/client'

const { results, status, isLoading, loadMore } = useZodPaginatedQuery(
  api.tasks.list,
  { after: new Date() },
  { initialNumItems: 25 }
)
```

Pass domain arguments or `'skip'`; Convex supplies `paginationOpts`, manages live pages,
page splits and cursors, and accumulates results. Zodvex encodes the domain arguments
and decodes result items using the registered `returns.page` array schema.

This requires an ordinary argument object and an ordinary return object containing
`page: z.array(itemSchema)`. Argument-object refinements, return-object refinements or
transforms, and page-array refinements or transforms are rejected. Item schemas retain
codecs, refinements, unions, defaults and transforms supported by normal Zod decoding.
Functions without a relevant registry schema pass through unchanged.

These aggregate APIs validate items, not the original page envelopes or their metadata.
They do not fabricate a cursor or a page completion flag to run the return schema.
Use `query`, `subscribe`, or `watchQuery` with explicit `paginationOpts` when you need
client-side validation of complete pages. Codec failures always throw, even when the
factory uses `onDecodeError: 'warn'` for its other methods. Handle React failures with
an error boundary; invalid arguments do not start a subscription.

`ZodvexClient.onPaginatedUpdate_experimental` uses the same argument and item contract.
Its callback receives `{ results, status, loadMore }`, matching Convex's runtime, and
its returned subscription decodes `getCurrentValue()` too. Call the subscription itself
or `.unsubscribe()` to stop it. `.getQueryLogs()` returns `undefined` on SDK versions
without that method. This corrects the previous, non-working page-envelope signature.

## Bootstrapping note

The first time you run `zodvex generate`, your `functions.ts` likely already imports from `_zodvex/api.js` (to wire the registry). The CLI handles this chicken-and-egg problem by writing a minimal stub `api.js` before discovery runs, then overwriting it with the real generated output.
