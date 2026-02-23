# Example App Implementation Plan — Task Manager

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a real, runnable Convex + Vite + React task manager app in `examples/task-manager/` that exercises all zodvex features and serves as an end-to-end smoke test before shipping.

**Architecture:** A Convex backend with three tables (users, tasks, comments) using `defineZodModel` for client-safe types, `zodTable` + `defineZodSchema` for the Convex schema, and `initZodvex` for codec-aware builders. A minimal Vite + React frontend proves data round-trips. A CLI smoke test script verifies codegen output and exercises functions against the real backend.

**Tech Stack:** Bun, Convex, Vite, React, zodvex (linked via `file:../../`), zod v4

**Important context:**
- `defineZodSchema` takes `zodTable()` results (not `defineZodModel` results)
- `defineZodModel` is client-safe and provides codegen metadata (`__zodvexMeta`)
- Both need the same field definitions, so model files export field shapes for reuse
- `initZodvex(schema, server)` returns `{ zq, zm, za, ziq, zim, zia }` builders
- With `wrapDb: true` (default), `ctx.db` auto-decodes reads and auto-encodes writes
- Convex initialization requires human interaction (`npx convex dev` prompts for project setup)

---

### Task 1: Project scaffold

**Files:**
- Create: `examples/task-manager/package.json`
- Create: `examples/task-manager/tsconfig.json`
- Create: `examples/task-manager/vite.config.ts`
- Create: `examples/task-manager/index.html`
- Create: `examples/task-manager/.gitignore`
- Remove: `examples/basic-usage.ts`
- Remove: `examples/queries.ts`

**Step 1: Build zodvex (prerequisite for file: link)**

Run: `bun run build` (from zodvex root)
Expected: `dist/` updated

**Step 2: Create `examples/task-manager/package.json`**

```json
{
  "name": "zodvex-example-task-manager",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "concurrently \"zodvex dev\" \"bunx convex dev\" \"vite\"",
    "build": "zodvex generate && vite build",
    "deploy": "zodvex generate && bunx convex deploy",
    "generate": "zodvex generate",
    "test:smoke": "bun run test/smoke.ts"
  },
  "dependencies": {
    "convex": "^1.28.0",
    "react": "^19.1.0",
    "react-dom": "^19.1.0",
    "zodvex": "file:../../",
    "zod": "^4.1.12"
  },
  "devDependencies": {
    "@types/react": "^19.1.0",
    "@types/react-dom": "^19.1.0",
    "@vitejs/plugin-react": "^4.5.2",
    "concurrently": "^9.1.2",
    "convex-helpers": "^0.1.104",
    "typescript": "^5.9.3",
    "vite": "^6.3.5"
  }
}
```

**Step 3: Create `examples/task-manager/tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ESNext",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "jsx": "react-jsx",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "outDir": "dist",
    "declaration": true,
    "paths": {}
  },
  "include": ["src", "convex", "test"]
}
```

**Step 4: Create `examples/task-manager/vite.config.ts`**

```ts
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: { port: 3000 }
})
```

**Step 5: Create `examples/task-manager/index.html`**

```html
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>zodvex Task Manager</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

**Step 6: Create `examples/task-manager/.gitignore`**

```
node_modules/
dist/
convex/_generated/
convex/_zodvex/
.env.local
```

**Step 7: Remove old static example files**

Run: `rm examples/basic-usage.ts examples/queries.ts`

**Step 8: Install dependencies**

Run: `cd examples/task-manager && bun install`
Expected: `node_modules/` created, zodvex linked from `../../`

**Step 9: Commit**

```bash
git add examples/ && git commit -m "scaffold: task-manager example project"
```

---

### Task 2: Initialize Convex project

**This task requires human interaction** — `npx convex dev` prompts for project setup.

**Step 1: Initialize Convex**

Run (from `examples/task-manager/`): `npx convex dev --once`

This will:
1. Prompt to create or link a Convex project
2. Create `convex/_generated/` with `api.ts`, `server.ts`, `dataModel.ts`
3. Create `.env.local` with `CONVEX_URL`

The executor should stop here and ask the user to complete the interactive Convex setup if it fails.

**Step 2: Verify `_generated/` exists**

Run: `ls examples/task-manager/convex/_generated/`
Expected: `api.ts`, `server.ts`, `dataModel.ts` (at minimum)

**Step 3: Commit (only if _generated is not gitignored — it should be, so skip)**

No commit for generated files. The .gitignore from Task 1 covers `convex/_generated/`.

---

### Task 3: Codecs and model definitions

**Files:**
- Create: `examples/task-manager/convex/codecs.ts`
- Create: `examples/task-manager/convex/models/user.ts`
- Create: `examples/task-manager/convex/models/task.ts`
- Create: `examples/task-manager/convex/models/comment.ts`

**Step 1: Create `convex/codecs.ts` — shared custom codec**

```ts
import { z } from 'zod'
import { zx } from 'zodvex/core'

/**
 * Duration codec — stores total minutes (wire), exposes { hours, minutes } (runtime).
 * Demonstrates zx.codec() with distinct wire and runtime formats.
 */
export const zDuration = zx.codec(
  z.number(),
  z.object({ hours: z.number(), minutes: z.number() }),
  {
    decode: (mins) => ({ hours: Math.floor(mins / 60), minutes: mins % 60 }),
    encode: (d) => d.hours * 60 + d.minutes,
  }
)
```

**Step 2: Create `convex/models/user.ts`**

```ts
import { z } from 'zod'
import { zx, defineZodModel } from 'zodvex/core'

/** Shared field shape — used by both defineZodModel and zodTable in schema.ts */
export const userFields = {
  name: z.string(),
  email: z.string(),
  avatarUrl: z.string().optional(),
  createdAt: zx.date(),
}

export const UserModel = defineZodModel('users', userFields)
  .index('by_email', ['email'])
```

**Step 3: Create `convex/models/task.ts`**

```ts
import { z } from 'zod'
import { zx, defineZodModel } from 'zodvex/core'
import { zDuration } from '../codecs'

/** Shared field shape — used by both defineZodModel and zodTable in schema.ts */
export const taskFields = {
  title: z.string(),
  description: z.string().optional(),
  status: z.enum(['todo', 'in_progress', 'done']),
  priority: z.enum(['low', 'medium', 'high']).nullable(),
  ownerId: zx.id('users'),
  assigneeId: zx.id('users').optional(),
  dueDate: zx.date().optional(),
  completedAt: zx.date().optional(),
  estimate: zDuration.optional(),
  createdAt: zx.date(),
}

export const TaskModel = defineZodModel('tasks', taskFields)
  .index('by_owner', ['ownerId'])
  .index('by_status', ['status'])
  .index('by_assignee', ['assigneeId'])
```

**Step 4: Create `convex/models/comment.ts`**

```ts
import { z } from 'zod'
import { zx, defineZodModel } from 'zodvex/core'

/** Shared field shape — used by both defineZodModel and zodTable in schema.ts */
export const commentFields = {
  taskId: zx.id('tasks'),
  authorId: zx.id('users'),
  body: z.string(),
  createdAt: zx.date(),
}

export const CommentModel = defineZodModel('comments', commentFields)
  .index('by_task', ['taskId'])
```

**Step 5: Verify imports resolve**

Run (from `examples/task-manager/`): `bunx tsc --noEmit convex/models/user.ts convex/models/task.ts convex/models/comment.ts convex/codecs.ts`

If this fails on `zodvex/core` resolution, check that `bun run build` was run in the zodvex root and that `node_modules/zodvex` is symlinked correctly.

**Step 6: Commit**

```bash
git add examples/task-manager/convex/codecs.ts examples/task-manager/convex/models/
git commit -m "feat(example): model definitions with defineZodModel + zDuration codec"
```

---

### Task 4: Schema and initZodvex setup

**Files:**
- Create: `examples/task-manager/convex/schema.ts`
- Create: `examples/task-manager/convex/functions.ts`

**Step 1: Create `convex/schema.ts`**

`defineZodSchema` takes `zodTable()` results, not `defineZodModel` results. We import the shared field shapes from model files and create `zodTable` entries with indexes.

```ts
import { zodTable, defineZodSchema } from 'zodvex'
import { userFields } from './models/user'
import { taskFields } from './models/task'
import { commentFields } from './models/comment'

const Users = zodTable('users', userFields)
const Tasks = zodTable('tasks', taskFields)
const Comments = zodTable('comments', commentFields)

export default defineZodSchema({
  users: {
    ...Users,
    table: Users.table.index('by_email', ['email']),
  },
  tasks: {
    ...Tasks,
    table: Tasks.table
      .index('by_owner', ['ownerId'])
      .index('by_status', ['status'])
      .index('by_assignee', ['assigneeId']),
  },
  comments: {
    ...Comments,
    table: Comments.table.index('by_task', ['taskId']),
  },
})
```

**Step 2: Create `convex/functions.ts`**

```ts
import { initZodvex } from 'zodvex/server'
import {
  query,
  mutation,
  action,
  internalQuery,
  internalMutation,
  internalAction,
} from './_generated/server'
import schema from './schema'

export const { zq, zm, za, ziq, zim, zia } = initZodvex(schema, {
  query,
  mutation,
  action,
  internalQuery,
  internalMutation,
  internalAction,
})
```

**Step 3: Push schema to Convex**

Run (from `examples/task-manager/`): `npx convex dev --once`
Expected: Schema pushed successfully, tables created

If this fails, read the error carefully — likely a schema validation issue. Common problems:
- `zodvex` import not resolving — ensure `bun run build` was run in root and `bun install` in example
- Convex validator mapping issue — check zodvex's `zodTable` output

**Step 4: Commit**

```bash
git add examples/task-manager/convex/schema.ts examples/task-manager/convex/functions.ts
git commit -m "feat(example): schema + initZodvex setup"
```

---

### Task 5: User CRUD functions

**Files:**
- Create: `examples/task-manager/convex/users.ts`

**Step 1: Write user functions**

```ts
import { z } from 'zod'
import { zx } from 'zodvex/core'
import { zq, zm } from './functions'
import { UserModel } from './models/user'

export const get = zq({
  args: { id: zx.id('users') },
  handler: async (ctx, { id }) => {
    return await ctx.db.get(id)
  },
  returns: UserModel.schema.doc.nullable(),
})

export const getByEmail = zq({
  args: { email: z.string() },
  handler: async (ctx, { email }) => {
    return await ctx.db
      .query('users')
      .withIndex('by_email', (q) => q.eq('email', email))
      .unique()
  },
  returns: UserModel.schema.doc.nullable(),
})

export const create = zm({
  args: {
    name: z.string(),
    email: z.string(),
    avatarUrl: z.string().optional(),
  },
  handler: async (ctx, args) => {
    const id = await ctx.db.insert('users', {
      ...args,
      createdAt: new Date(),
    })
    return id
  },
  returns: zx.id('users'),
})

export const update = zm({
  args: {
    id: zx.id('users'),
    name: z.string().optional(),
    email: z.string().optional(),
    avatarUrl: z.string().optional(),
  },
  handler: async (ctx, { id, ...fields }) => {
    await ctx.db.patch(id, fields)
  },
})
```

**Step 2: Push and verify**

Run: `npx convex dev --once` (from `examples/task-manager/`)
Expected: Functions registered successfully

**Step 3: Commit**

```bash
git add examples/task-manager/convex/users.ts
git commit -m "feat(example): user CRUD functions"
```

---

### Task 6: Task CRUD functions

**Files:**
- Create: `examples/task-manager/convex/tasks.ts`

**Step 1: Write task functions**

These demonstrate: `zx.id()` references, `zx.date()` codecs, `zDuration` custom codec, `.nullable()`, `.optional()`, enum args, pagination, and model schema returns.

```ts
import { z } from 'zod'
import { zx } from 'zodvex/core'
import { zq, zm } from './functions'
import { TaskModel } from './models/task'

export const get = zq({
  args: { id: zx.id('tasks') },
  handler: async (ctx, { id }) => {
    return await ctx.db.get(id)
  },
  returns: TaskModel.schema.doc.nullable(),
})

export const list = zq({
  args: {
    status: z.enum(['todo', 'in_progress', 'done']).optional(),
    ownerId: zx.id('users').optional(),
    paginationOpts: z.object({
      numItems: z.number(),
      cursor: z.string().nullable(),
    }),
  },
  handler: async (ctx, { status, ownerId, paginationOpts }) => {
    let q = ctx.db.query('tasks')

    if (ownerId) {
      q = q.withIndex('by_owner', (idx) => idx.eq('ownerId', ownerId))
    } else if (status) {
      q = q.withIndex('by_status', (idx) => idx.eq('status', status))
    }

    return await q.order('desc').paginate(paginationOpts)
  },
})

export const create = zm({
  args: {
    title: z.string(),
    description: z.string().optional(),
    status: z.enum(['todo', 'in_progress', 'done']).optional(),
    priority: z.enum(['low', 'medium', 'high']).nullable().optional(),
    ownerId: zx.id('users'),
    assigneeId: zx.id('users').optional(),
    dueDate: zx.date().optional(),
    estimate: z.number().optional(),
  },
  handler: async (ctx, args) => {
    const id = await ctx.db.insert('tasks', {
      ...args,
      status: args.status ?? 'todo',
      priority: args.priority ?? null,
      createdAt: new Date(),
    })
    return id
  },
  returns: zx.id('tasks'),
})

export const update = zm({
  args: {
    id: zx.id('tasks'),
    title: z.string().optional(),
    description: z.string().optional(),
    status: z.enum(['todo', 'in_progress', 'done']).optional(),
    priority: z.enum(['low', 'medium', 'high']).nullable().optional(),
    assigneeId: zx.id('users').optional(),
    dueDate: zx.date().optional(),
    estimate: z.number().optional(),
  },
  handler: async (ctx, { id, ...fields }) => {
    await ctx.db.patch(id, fields)
  },
})

export const complete = zm({
  args: { id: zx.id('tasks') },
  handler: async (ctx, { id }) => {
    await ctx.db.patch(id, {
      status: 'done' as const,
      completedAt: new Date(),
    })
  },
})
```

**Note on pagination:** The `paginationOpts` arg uses Convex's pagination format. The `list` function returns a `PaginationResult` which includes `{ page, isDone, continueCursor }`. The codec DB wrapper auto-decodes each doc in `page`.

**Note on `estimate` arg:** The `create` and `update` args accept `z.number()` (wire format — total minutes), not the decoded `{ hours, minutes }` object. This is because args come from the client over the wire. The codec decode happens on DB reads, not on function args.

**Step 2: Push and verify**

Run: `npx convex dev --once`
Expected: Functions registered

**Step 3: Commit**

```bash
git add examples/task-manager/convex/tasks.ts
git commit -m "feat(example): task CRUD with pagination, enums, codecs"
```

---

### Task 7: Comment CRUD functions

**Files:**
- Create: `examples/task-manager/convex/comments.ts`

**Step 1: Write comment functions**

```ts
import { z } from 'zod'
import { zx } from 'zodvex/core'
import { zq, zm } from './functions'
import { CommentModel } from './models/comment'

export const list = zq({
  args: { taskId: zx.id('tasks') },
  handler: async (ctx, { taskId }) => {
    return await ctx.db
      .query('comments')
      .withIndex('by_task', (q) => q.eq('taskId', taskId))
      .order('desc')
      .collect()
  },
  returns: CommentModel.schema.docArray,
})

export const create = zm({
  args: {
    taskId: zx.id('tasks'),
    authorId: zx.id('users'),
    body: z.string(),
  },
  handler: async (ctx, args) => {
    const id = await ctx.db.insert('comments', {
      ...args,
      createdAt: new Date(),
    })
    return id
  },
  returns: zx.id('comments'),
})
```

**Step 2: Push and verify**

Run: `npx convex dev --once`
Expected: Functions registered

**Step 3: Commit**

```bash
git add examples/task-manager/convex/comments.ts
git commit -m "feat(example): comment list + create functions"
```

---

### Task 8: Codegen verification

**Step 1: Run zodvex generate**

Run (from `examples/task-manager/`): `bunx zodvex generate`

If the `zodvex` bin isn't found via `bunx`, try: `bun ../../dist/cli/index.js generate`

Expected output: `[zodvex] Generated N model(s), N function(s)`

**Step 2: Verify generated schema.ts**

Run: `cat examples/task-manager/convex/_zodvex/schema.ts`

Expected contents:
- `// AUTO-GENERATED by zodvex` header
- Re-exports for `UserModel`, `TaskModel`, `CommentModel` from their source files

**Step 3: Verify generated validators.ts**

Run: `cat examples/task-manager/convex/_zodvex/validators.ts`

Expected contents:
- `// AUTO-GENERATED by zodvex` header
- `export const zodvexRegistry = { ... }`
- Function entries like `'users:get'`, `'users:create'`, `'tasks:list'`, etc.
- Model schema references like `UserModel.schema.doc` for functions returning model docs
- `zodToSource` output like `z.object(...)` for ad-hoc args schemas

**Step 4: Verify generated files can be imported**

Run: `bun -e "import('./examples/task-manager/convex/_zodvex/validators.ts').then(() => console.log('OK'))"`
Expected: `OK` (no import errors)

**Step 5: No commit — generated files are gitignored**

---

### Task 9: React frontend

**Files:**
- Create: `examples/task-manager/src/main.tsx`
- Create: `examples/task-manager/src/App.tsx`

**Step 1: Create `src/main.tsx`**

```tsx
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { ConvexProvider, ConvexReactClient } from 'convex/react'
import App from './App'

const convex = new ConvexReactClient(import.meta.env.VITE_CONVEX_URL as string)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ConvexProvider client={convex}>
      <App />
    </ConvexProvider>
  </StrictMode>
)
```

**Step 2: Create `src/App.tsx`**

Minimal UI with three panels. Uses vanilla Convex hooks (`useQuery`, `useMutation`). No styling framework — just enough to see data flowing.

```tsx
import { useState } from 'react'
import { useQuery, useMutation } from 'convex/react'
import { api } from '../convex/_generated/api'

export default function App() {
  return (
    <div style={{ display: 'flex', gap: '2rem', padding: '1rem', fontFamily: 'system-ui' }}>
      <UserPanel />
      <TaskPanel />
    </div>
  )
}

function UserPanel() {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const createUser = useMutation(api.users.create)

  return (
    <div style={{ flex: 1 }}>
      <h2>Users</h2>
      <form
        onSubmit={async (e) => {
          e.preventDefault()
          await createUser({ name, email })
          setName('')
          setEmail('')
        }}
      >
        <input placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} />
        <input placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} />
        <button type="submit">Create User</button>
      </form>
    </div>
  )
}

function TaskPanel() {
  const tasks = useQuery(api.tasks.list, {
    paginationOpts: { numItems: 10, cursor: null },
  })
  const [title, setTitle] = useState('')
  const createTask = useMutation(api.tasks.create)
  const completeTask = useMutation(api.tasks.complete)

  // Need a user ID to create tasks — for demo, use the first user
  const userByEmail = useQuery(api.users.getByEmail, { email: 'demo@example.com' })
  const ownerId = userByEmail?._id

  return (
    <div style={{ flex: 2 }}>
      <h2>Tasks</h2>

      {ownerId && (
        <form
          onSubmit={async (e) => {
            e.preventDefault()
            await createTask({ title, ownerId, estimate: 60 })
            setTitle('')
          }}
        >
          <input placeholder="Task title" value={title} onChange={(e) => setTitle(e.target.value)} />
          <button type="submit">Add Task</button>
        </form>
      )}

      {!ownerId && <p>Create a user with email "demo@example.com" first</p>}

      <ul>
        {tasks?.page?.map((task: any) => (
          <li key={task._id}>
            <strong>{task.title}</strong> — {task.status}
            {task.estimate != null && ` (est: ${task.estimate} min)`}
            {task.status !== 'done' && (
              <button onClick={() => completeTask({ id: task._id })} style={{ marginLeft: '0.5rem' }}>
                Complete
              </button>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}
```

**Note:** The frontend receives wire format from Convex (timestamps as numbers, duration as minutes). This is expected — client-side auto-decode (`zodvex/react` hooks) doesn't exist yet. The frontend proves the data flows correctly at the wire level.

**Step 3: Add `VITE_CONVEX_URL` to environment**

The `convex dev` command creates `.env.local` with `CONVEX_URL=...`. Vite needs `VITE_` prefix:

Run: `cd examples/task-manager && echo "VITE_CONVEX_URL=$(grep CONVEX_URL .env.local | cut -d= -f2)" >> .env.local`

Or: manually add `VITE_CONVEX_URL=<your convex url>` to `.env.local`.

**Step 4: Verify frontend builds**

Run (from `examples/task-manager/`): `bunx vite build`
Expected: Build succeeds without errors

**Step 5: Commit**

```bash
git add examples/task-manager/src/
git commit -m "feat(example): minimal React frontend with user + task panels"
```

---

### Task 10: Smoke test script

**Files:**
- Create: `examples/task-manager/test/smoke.ts`

This is the confidence layer. It verifies:
1. Codegen produces correct output
2. Generated files are importable
3. Convex functions work end-to-end
4. Codec wire formats are correct

**Step 1: Write `test/smoke.ts`**

```ts
import { ConvexHttpClient } from 'convex/browser'
import { api } from '../convex/_generated/api'
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

const CONVEX_URL = process.env.CONVEX_URL
  ?? (() => {
    // Read from .env.local if not in env
    const envPath = path.resolve(import.meta.dir, '../.env.local')
    if (!fs.existsSync(envPath)) throw new Error('No .env.local found. Run `npx convex dev` first.')
    const content = fs.readFileSync(envPath, 'utf-8')
    const match = content.match(/CONVEX_URL=(.+)/)
    if (!match) throw new Error('CONVEX_URL not found in .env.local')
    return match[1]
  })()

const client = new ConvexHttpClient(CONVEX_URL)

let passed = 0
let failed = 0

function assert(condition: boolean, message: string) {
  if (condition) {
    console.log(`  pass ${message}`)
    passed++
  } else {
    console.error(`  FAIL ${message}`)
    failed++
  }
}

async function main() {
  console.log('\n=== zodvex Smoke Test ===\n')

  // --- Part 1: Codegen ---
  console.log('1. Codegen')

  const convexDir = path.resolve(import.meta.dir, '../convex')
  const zodvexDir = path.join(convexDir, '_zodvex')

  // Run codegen
  const cliPath = path.resolve(import.meta.dir, '../../../../dist/cli/index.js')
  const result = spawnSync('bun', [cliPath, 'generate'], {
    cwd: path.resolve(import.meta.dir, '..'),
    stdio: 'pipe',
  })
  assert(result.status === 0, 'zodvex generate ran successfully')

  // Verify files exist
  assert(fs.existsSync(path.join(zodvexDir, 'schema.ts')), 'schema.ts generated')
  assert(fs.existsSync(path.join(zodvexDir, 'validators.ts')), 'validators.ts generated')

  // Verify schema.ts content
  const schemaContent = fs.readFileSync(path.join(zodvexDir, 'schema.ts'), 'utf-8')
  assert(schemaContent.includes('AUTO-GENERATED'), 'schema.ts has auto-generated header')
  assert(schemaContent.includes('UserModel'), 'schema.ts exports UserModel')
  assert(schemaContent.includes('TaskModel'), 'schema.ts exports TaskModel')
  assert(schemaContent.includes('CommentModel'), 'schema.ts exports CommentModel')

  // Verify validators.ts content
  const validatorsContent = fs.readFileSync(path.join(zodvexDir, 'validators.ts'), 'utf-8')
  assert(validatorsContent.includes('AUTO-GENERATED'), 'validators.ts has auto-generated header')
  assert(validatorsContent.includes('zodvexRegistry'), 'validators.ts exports registry')
  assert(validatorsContent.includes("'users:get'"), 'registry has users:get')
  assert(validatorsContent.includes("'tasks:list'"), 'registry has tasks:list')
  assert(validatorsContent.includes("'comments:create'"), 'registry has comments:create')

  // --- Part 2: Convex Functions ---
  console.log('\n2. Convex Functions')

  // Create a test user
  const userId = await client.mutation(api.users.create, {
    name: 'Smoke Test User',
    email: `smoke-${Date.now()}@test.com`,
  })
  assert(typeof userId === 'string', `user created: ${userId}`)

  // Get user back
  const user = await client.query(api.users.get, { id: userId })
  assert(user !== null, 'user retrieved')
  assert(user!.name === 'Smoke Test User', 'user name matches')
  assert(typeof user!.createdAt === 'number', `createdAt is wire format (number): ${user!.createdAt}`)

  // Create a task with duration estimate (90 minutes)
  const taskId = await client.mutation(api.tasks.create, {
    title: 'Smoke Test Task',
    ownerId: userId,
    priority: 'high',
    estimate: 90,
  })
  assert(typeof taskId === 'string', `task created: ${taskId}`)

  // Get task back
  const task = await client.query(api.tasks.get, { id: taskId })
  assert(task !== null, 'task retrieved')
  assert(task!.title === 'Smoke Test Task', 'task title matches')
  assert(task!.status === 'todo', 'task default status is todo')
  assert(task!.priority === 'high', 'task priority matches')
  assert(task!.ownerId === userId, 'task ownerId matches')
  assert(typeof task!.createdAt === 'number', `task createdAt is wire format: ${task!.createdAt}`)
  assert(typeof task!.estimate === 'number', `task estimate is wire format (number): ${task!.estimate}`)
  assert(task!.estimate === 90, 'task estimate value is 90 (minutes)')

  // Complete the task
  await client.mutation(api.tasks.complete, { id: taskId })
  const completedTask = await client.query(api.tasks.get, { id: taskId })
  assert(completedTask!.status === 'done', 'task status is done after complete')
  assert(typeof completedTask!.completedAt === 'number', 'completedAt is wire format after complete')

  // Create a comment
  const commentId = await client.mutation(api.comments.create, {
    taskId,
    authorId: userId,
    body: 'Smoke test comment',
  })
  assert(typeof commentId === 'string', `comment created: ${commentId}`)

  // List comments
  const comments = await client.query(api.comments.list, { taskId })
  assert(Array.isArray(comments), 'comments list is an array')
  assert(comments.length === 1, 'one comment returned')
  assert(comments[0].body === 'Smoke test comment', 'comment body matches')
  assert(typeof comments[0].createdAt === 'number', 'comment createdAt is wire format')

  // List tasks with pagination
  const taskPage = await client.query(api.tasks.list, {
    paginationOpts: { numItems: 10, cursor: null },
  })
  assert(taskPage.page !== undefined, 'paginated result has page')
  assert(taskPage.page.length >= 1, 'at least one task in page')

  // --- Summary ---
  console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`)
  process.exit(failed > 0 ? 1 : 0)
}

main().catch((err) => {
  console.error('Smoke test crashed:', err)
  process.exit(1)
})
```

**Step 2: Verify smoke test runs**

This requires a running Convex backend. Either `convex dev` running or a deployed project.

Run (from `examples/task-manager/`): `bun run test:smoke`
Expected: All assertions pass

If assertions fail, debug based on output. Common issues:
- `CONVEX_URL not found` — run `npx convex dev --once` first
- Function not found — run `npx convex dev --once` to push functions
- Type errors in assertions — adjust based on actual Convex response format

**Step 3: Commit**

```bash
git add examples/task-manager/test/
git commit -m "test(example): e2e smoke test for codegen + Convex functions"
```

---

### Task 11: Integration verification and cleanup

**Step 1: Run full build**

Run (from zodvex root): `bun run build`
Run (from `examples/task-manager/`): `bun install` (refresh linked zodvex)

**Step 2: Run zodvex generate**

Run (from `examples/task-manager/`): `bunx zodvex generate`
Expected: Models and functions discovered

**Step 3: Run smoke test**

Run (from `examples/task-manager/`): `bun run test:smoke`
Expected: All assertions pass

**Step 4: Verify frontend builds**

Run (from `examples/task-manager/`): `bunx vite build`
Expected: Build succeeds

**Step 5: Run zodvex library tests (regression check)**

Run (from zodvex root): `bun test`
Expected: All 547+ tests pass

**Step 6: Commit any final fixes**

```bash
git add -A examples/task-manager/
git commit -m "feat(example): complete task-manager example with codegen + smoke test"
```

---

### Notes for the Executor

**Convex initialization is interactive.** Task 2 requires human intervention to create a Convex project. If `npx convex dev` fails or requires auth, stop and ask the user.

**Wire format vs runtime format.** The `ConvexHttpClient` (used in smoke test) and vanilla Convex React hooks return **wire format** — dates as numbers, duration as minutes. This is correct. Client-side auto-decode (`zodvex/react`) doesn't exist yet. The smoke test verifies wire format specifically.

**Server-side codecs are automatic.** With `initZodvex` + `wrapDb: true` (default), the server's `ctx.db` auto-decodes reads and auto-encodes writes. So `new Date()` in handlers gets encoded to a timestamp on write, and timestamps get decoded back to Dates on read (within the server). The wire format sent to the client is Convex's standard JSON (numbers for dates).

**`estimate` field encoding.** In `tasks.create`, the arg is `z.number()` (wire format — total minutes). The `zDuration` codec lives on the model's field definition. The codec runs at the DB boundary:
- On `ctx.db.insert(...)`: if the handler passes `90`, the codec's `.encode()` is a no-op (number to number). But if using the decoded `{ hours, minutes }` format, `encodeDoc` would convert it to `90`.
- On `ctx.db.get(...)`: the codec's `.decode()` converts `90` to `{ hours: 1, minutes: 30 }` within the server.
- Over the wire to client: Convex sends the wire format (`90`), since there's no client-side decode hook yet.

**File linking.** `"zodvex": "file:../../"` in package.json means `bun install` copies the zodvex dist into `node_modules/zodvex`. After changing zodvex source, you need: `bun run build` (in root) then `bun install` (in example) to pick up changes.
