# Example Application Design — Task Manager

**Date:** 2026-02-23
**Status:** Approved
**Branch:** feat/codec-end-to-end

## Overview

A real, runnable Convex application inside `examples/task-manager/` that serves two purposes: (1) a reference implementation showing new users how to set up and use zodvex, and (2) an end-to-end smoke test that verifies the full stack works against a real Convex backend before shipping.

## Architecture

Three layers:

- **Convex backend** — Models, functions, schema, codegen. Exercises all zodvex server-side features.
- **Vite + React frontend** — Minimal UI proving data round-trips correctly. No auth, no styling framework, no routing.
- **CLI smoke test** — Script that runs codegen, verifies generated files, and exercises Convex functions end-to-end.

## Linking to zodvex

The example uses `"zodvex": "file:../../"` in `package.json`. This tests the built dist — what consumers actually get from npm. Requires `bun run build` in the zodvex root first.

## Data Model

Three tables:

### `users`
- `name: z.string()`
- `email: z.string()`
- `avatarUrl: z.string().optional()`
- `createdAt: zx.date()`
- Index: `by_email` on `["email"]`

### `tasks`
- `title: z.string()`
- `description: z.string().optional()`
- `status: z.enum(["todo", "in_progress", "done"])`
- `priority: z.enum(["low", "medium", "high"]).nullable()`
- `ownerId: zx.id("users")`
- `assigneeId: zx.id("users").optional()`
- `dueDate: zx.date().optional()`
- `completedAt: zx.date().optional()`
- `estimate: zDuration.optional()` — custom codec (see below)
- `createdAt: zx.date()`
- Indexes: `by_owner` on `["ownerId"]`, `by_status` on `["status"]`, `by_assignee` on `["assigneeId"]`

### `comments`
- `taskId: zx.id("tasks")`
- `authorId: zx.id("users")`
- `body: z.string()`
- `createdAt: zx.date()`
- Index: `by_task` on `["taskId"]`

## Custom Codec: Duration

A `zDuration` codec demonstrates `zx.codec()` with a distinct wire and runtime format:

```ts
const zDuration = zx.codec(
  z.number(),  // wire: total minutes
  z.object({ hours: z.number(), minutes: z.number() }),  // runtime
  {
    decode: (mins) => ({ hours: Math.floor(mins / 60), minutes: mins % 60 }),
    encode: (d) => d.hours * 60 + d.minutes,
  }
)
```

Wire format (Convex stores): `90`
Runtime format (app uses): `{ hours: 1, minutes: 30 }`

Defined in `convex/codecs.ts` and used by the tasks model.

## Features Exercised

| zodvex Feature | Where Demonstrated |
|---|---|
| `defineZodModel` | `convex/models/*.ts` — all three tables |
| `defineZodSchema` | `convex/schema.ts` |
| `initZodvex` | `convex/functions.ts` — `zq`, `zm`, `za` builders |
| `zx.id()` | Cross-table references (ownerId, assigneeId, taskId, authorId) |
| `zx.date()` | Timestamps (createdAt, dueDate, completedAt) |
| `zx.codec()` | Duration (estimate field on tasks) |
| `.optional()` | description, avatarUrl, assigneeId, dueDate, completedAt, estimate |
| `.nullable()` | priority |
| `z.enum()` | status, priority |
| Index definitions | by_email, by_owner, by_status, by_assignee, by_task |
| `zodvex generate` | CLI codegen producing `_zodvex/schema.ts` + `_zodvex/validators.ts` |
| `zodvex dev` | Watch mode in dev script |
| `zodvex init` | Package.json script setup |

## Backend Functions

**`convex/functions.ts`** — `initZodvex` setup, exports `zq`, `zm`, `za`

**`convex/users.ts`**
- `get` — by ID, returns user doc
- `getByEmail` — by email index, returns user doc or null
- `create` — insert user
- `update` — partial update

**`convex/tasks.ts`**
- `get` — by ID
- `list` — filtered by status/owner, paginated
- `create` — insert task
- `update` — partial update
- `complete` — sets completedAt to now

**`convex/comments.ts`**
- `list` — by taskId index
- `create` — insert comment

## Frontend

Vite + React. Single page with three panels: user selector, task list, task detail with comments. Uses vanilla Convex hooks (`useQuery`/`useMutation`) since `zodvex/react` doesn't exist yet. Intentionally bare-bones — no auth, no Tailwind, no routing. The UI is scaffolding for the smoke test, not a design showcase.

Once `zodvex/react` ships, swap to `useZodQuery` and the frontend proves auto-decode works.

## Smoke Test

`test/smoke.ts` — a script run with `bun run test:smoke` that:

1. Runs `zodvex generate` against the convex/ directory
2. Verifies generated files exist and contain expected content (model re-exports, registry entries)
3. Verifies registry correctness — model schemas by identity reference, ad-hoc schemas via zodToSource
4. Verifies generated files can be imported without errors
5. Exercises Convex functions — CRUD for users/tasks/comments, verifies data round-trips (duration stored as minutes, dates as timestamps)

Requires `convex dev` running or a deployed project.

## Project Structure

```
examples/task-manager/
├── package.json          # file:../../ zodvex dep, convex, vite, react
├── tsconfig.json
├── vite.config.ts
├── convex/
│   ├── _generated/       # convex dev output (gitignored)
│   ├── _zodvex/          # zodvex generate output (gitignored)
│   ├── schema.ts         # defineZodSchema
│   ├── functions.ts      # initZodvex setup
│   ├── codecs.ts         # zDuration
│   ├── models/
│   │   ├── user.ts
│   │   ├── task.ts
│   │   └── comment.ts
│   ├── users.ts
│   ├── tasks.ts
│   └── comments.ts
├── src/
│   ├── main.tsx
│   └── App.tsx
├── test/
│   └── smoke.ts
├── index.html
└── .gitignore
```

## Package Scripts

```json
{
  "dev": "concurrently \"zodvex dev\" \"bunx convex dev\" \"vite\"",
  "build": "zodvex generate && vite build",
  "deploy": "zodvex generate && bunx convex deploy",
  "test:smoke": "bun run test/smoke.ts"
}
```

## What This Does NOT Cover

- `zodvex/react` hooks (don't exist yet)
- Auth / custom context with user injection (no auth provider)
- `zodvex/transform` schema walking utilities
- Union table types
- `zodvex/registry` JSON schema export

These can be added as the library grows.
