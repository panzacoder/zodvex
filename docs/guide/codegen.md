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
- `ctx.runQuery` / `ctx.runMutation` in actions that decode results via the registry
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

The generated `_zodvex/api.js` exports a `zodvexRegistry` — a plain object mapping every public function path to its `args` and `returns` Zod schemas. Wire it into `initZodvex` via the `registry` option so actions can auto-decode `runQuery` / `runMutation` results:

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

When the registry is provided, `za` and `zia` replace `ctx.runQuery` and `ctx.runMutation` with codec-aware versions that automatically decode results using the registry's `returns` schema.

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

Re-exports all `zodTable` model objects discovered in your convex directory. Lets client code import models from a single stable path rather than hunting through server files:

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

## Bootstrapping note

The first time you run `zodvex generate`, your `functions.ts` likely already imports from `_zodvex/api.js` (to wire the registry). The CLI handles this chicken-and-egg problem by writing a minimal stub `api.js` before discovery runs, then overwriting it with the real generated output.
