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

The generated `_zodvex/server.ts` exposes a **pre-wired** `initZodvex(server)` that closes over your schema, the registry, and the runtime table map. Userland `convex/functions.ts` is one import + one call — no registry wiring to remember:

```typescript
// convex/functions.ts
import { query, mutation, action, internalQuery, internalMutation, internalAction } from './_generated/server'
import { initZodvex } from './_zodvex/server'

export const { zq, zm, za, ziq, zim, zia } = initZodvex({
  query,
  mutation,
  action,
  internalQuery,
  internalMutation,
  internalAction,
})
```

The registry (from `_zodvex/api.js`) maps every public function path to its `args` and `returns` Zod schemas. `_zodvex/server.ts` wires it in **split by runtime**: actions get the full registry through a lazy `import('./api.js')` thunk (actions run in Node, and the dynamic import keeps the heavy `returns`/model-doc graph out of every endpoint's static bundle), while mutations — whose scheduler `runAfter`/`runAt` encoding runs in Convex's Q/M V8 sandbox, where dynamic `import()` is forbidden — get a statically-imported **args-only** registry from `_zodvex/api.args.js` via the `schedulerRegistry` option. The args-only file carries no `returns` schemas, so it stays light.

When the registry is wired, `za` and `zia` replace `ctx.runQuery` and `ctx.runMutation` with codec-aware versions that **encode args** (decoded → wire) before the call and **decode results** (wire → runtime) after, using the registry's `args` / `returns` schemas. The mutation builders (`zm` / `zim`) likewise wrap `ctx.scheduler.runAfter` / `ctx.scheduler.runAt` to encode args. This means you can pass natural decoded values when calling into another wrapped function — including codecs whose runtime form can't cross the Convex boundary as-is (e.g. a Symbol-valued field) — and zodvex encodes them to wire at the call site, symmetric with the inbound decode the receiver already performs.

> **Migrating from `initZodvex(schema, server, { registry: () => zodvexRegistry })`?** The library-level `initZodvex` still accepts the explicit `schema` + `registry` form. Run `bun zodvex migrate` (or `npx zodvex migrate`) to automatically rewrite `schema.ts` and `functions.ts` to the consolidated shape.

## Generated files

Running `zodvex generate` writes into `convex/_zodvex/`: four file pairs (`schema`, `api`, `api.args`, `client` as `.js` + `.d.ts`), two TypeScript modules (`tables.ts`, `server.ts`), and a `convex.config.ts` marker (a NOOP file whose presence makes Convex's CLI skip `_zodvex/` during entrypoint discovery):

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

### `tables.ts` — pure-Convex table definitions

A default-export object mapping table names to plain `defineTable(...)` definitions, plus a `DecodedDocs` type. Userland `convex/schema.ts` becomes Convex-canonical and zod-free:

```typescript
// convex/schema.ts
import { defineSchema } from 'convex/server'
import tables from './_zodvex/tables'

export default defineSchema(tables)
```

This is the heart of the memory-ceiling fix: Convex evaluates `schema.ts` in its own 64 MB isolate, and with `tables.ts` that isolate loads zero zod, zodvex, or model code.

### `schema.js` — model re-exports

Re-exports all `defineZodModel` model objects discovered in your convex directory. Lets client code import models from a single stable path rather than hunting through server files:

```typescript
// _zodvex/schema.js (generated)
export { TaskModel } from '../models/task.js'
export { UserModel } from '../models/user.js'
// ...
```

### `server.ts` — pre-wired entry point

The single module userland server code imports from. It exports:

- **`initZodvex(server, options?)`** — pre-wired with the schema, the split registry (lazy full for actions, static args-only for mutations), and a statically-built table map (see [Registry wiring](#registry-wiring) above). Pass `registry` / `schedulerRegistry` / `tableMap` / `wrapDb` in `options` to override.
- **`QueryCtx`, `MutationCtx`, `ActionCtx`** — context types with the codec layer already applied (`ctx.db` is `ZodvexDatabaseReader` / `ZodvexDatabaseWriter` with decoded types). Import these instead of the raw types from `_generated/server`.
- **`schema`** — the base schema with the runtime table map and decoded-doc type token attached, for code that needs codec-aware DB wrappers outside a `zq`/`zm` handler.

Usage in your function files:

```typescript
import type { QueryCtx, MutationCtx } from './_zodvex/server'

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
export const { useZodQuery, useZodMutation } = createZodvexHooks(zodvexRegistry)

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

### `ZodvexClient` / `ZodvexReactClient` — codec-aware drop-in clients

`createZodvexClient` (vanilla JS) and `createZodvexReactClient` (React) wrap Convex's `ConvexClient` / `ConvexReactClient` and apply registry codecs on every call — args are encoded to wire on the way out, results decoded to runtime on the way in. They aim to be **near drop-in replacements** for the Convex clients, exposing the same surface:

- **`ZodvexClient`** (↔ `ConvexClient`): `query`, `mutate` (alias `mutation`), `action`, `subscribe` (alias `onUpdate`), `onPaginatedUpdate_experimental`, `getAuth`, `setAuth` (accepts a token string *or* an `AuthTokenFetcher` + `onChange`), `connectionState`, `subscribeToConnectionState`, `closed` / `disabled`, `close`. The inner client is reachable via the `convex` getter.
- **`ZodvexReactClient`** (↔ `ConvexReactClient`): `query`, `mutation`, `action`, `watchQuery`, `prewarmQuery`, `setAuth`, `clearAuth`, `connectionState`, `subscribeToConnectionState`, `url`, `logger`, `close`.

The data methods (`query` / `mutate` / `action` / `subscribe` / `watchQuery` / paginated) are codec-wrapped; the auth, connection, and lifecycle methods are thin pass-throughs to the underlying Convex client.

## Bootstrapping note

The first time you run `zodvex generate`, your `functions.ts` likely already imports from `_zodvex/api.js` (to wire the registry). The CLI handles this chicken-and-egg problem by writing a minimal stub `api.js` before discovery runs, then overwriting it with the real generated output.
