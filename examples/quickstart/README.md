# zodvex Quickstart

A minimal example showing zodvex's codec-aware database in action — **no zodvex codegen required**.

## What this shows

- `defineZodModel` to declare a model with a Zod schema
- `defineZodSchema` to build a Convex schema from your models
- `initZodvex` to get codec-aware `zq`/`zm` function builders
- Dates (`zx.date()`) round-trip transparently — write a `Date`, read back a `Date`

No `zodvex generate`, no `_zodvex/` registry output. Just `npx convex dev`.

## Structure

```
convex/
  models.ts     — EventModel: Zod schema with zx.date() fields
  schema.ts     — Convex schema built from models
  functions.ts  — initZodvex wires the schema + server builders
  events.ts     — list and create queries/mutations
```

## Running locally

```bash
# Install deps
bun install

# Start Convex dev (handles schema push, Convex codegen, and function deployment)
bun run dev
```

Convex's own `npx convex dev` (or `bunx convex dev`) is still required because
`convex/_generated/` comes from Convex, not zodvex.

## How codecs work without codegen

`initZodvex(schema, { query, mutation, ... })` returns `zq` and `zm` builders that wrap
Convex's native function builders with a codec-aware `ctx.db`. When you call `ctx.db.insert()`
or `ctx.db.query()`, the wrapper automatically:

- **Encodes** on write: `Date` → `number` (Unix timestamp)
- **Decodes** on read: `number` → `Date`

Your handlers work with plain TypeScript types. Convex stores the wire format. No manual
conversion needed.

## Peer dependencies

This example uses:

- `convex` >= 1.28.0
- `convex-helpers` >= 0.1.104
- `zod` >= 4.3.6
- `zodvex` (workspace)

These are declared as `dependencies` here for explicitness. In your own project they would
typically be peer dependencies of zodvex itself.
