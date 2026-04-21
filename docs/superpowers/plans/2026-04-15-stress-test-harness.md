# Stress Test Black-Box Harness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the template-based stress test with a stable black-box harness that measures any composed convex/zodvex project without coupling to library internals.

**Architecture:** Hand-written seed files (real zodvex code) are scaled to N models by a composer that does table-name replacement. A black-box measurer imports the composed directory and reports heap. A runner orchestrates ceiling search across variants (zod, zod+slim, mini, mini+slim) via flags that map to env vars and compiler passes.

**Tech Stack:** TypeScript, Bun, v8 heap stats, zod-to-mini compiler, ts-morph

**Spec:** `docs/superpowers/specs/2026-04-15-stress-test-harness-design.md`

---

## File Map

| File | Action | Responsibility |
|------|--------|---------------|
| `examples/stress-test/seeds/models/task.ts` | Create | Small seed model (4 fields) |
| `examples/stress-test/seeds/models/project.ts` | Create | Small seed model (5 fields) |
| `examples/stress-test/seeds/models/comment.ts` | Create | Small seed model (4 fields) |
| `examples/stress-test/seeds/models/user.ts` | Create | Medium seed model (8 fields) |
| `examples/stress-test/seeds/models/document.ts` | Create | Medium seed model (10 fields) |
| `examples/stress-test/seeds/models/notification.ts` | Create | Large seed model (discriminated union) |
| `examples/stress-test/seeds/models/activity.ts` | Create | Large seed model (union with nested objects) |
| `examples/stress-test/seeds/endpoints/task.ts` | Create | Endpoint seed (get, list, create, update, delete) |
| `examples/stress-test/seeds/endpoints/project.ts` | Create | Endpoint seed |
| `examples/stress-test/seeds/endpoints/comment.ts` | Create | Endpoint seed |
| `examples/stress-test/seeds/endpoints/user.ts` | Create | Endpoint seed |
| `examples/stress-test/seeds/endpoints/document.ts` | Create | Endpoint seed |
| `examples/stress-test/seeds/endpoints/notification.ts` | Create | Endpoint seed |
| `examples/stress-test/seeds/endpoints/activity.ts` | Create | Endpoint seed |
| `examples/stress-test/compose.ts` | Create | Scales seeds to N models via file copy + name replacement |
| `examples/stress-test/measure.ts` | Rewrite | Black-box measurer — imports a directory, reports heap |
| `examples/stress-test/stress-test.ts` | Create | Runner — parses flags, orchestrates compose → compile → measure |
| `examples/stress-test/package.json` | Modify | Update scripts |
| `package.json` (repo root) | Modify | Update `verify:examples` to use new harness commands |

---

### Task 1: Write seed model files

Seed models are hand-written zodvex code based on the real task-manager example. They're self-contained (no external codec imports) and read `ZODVEX_SLIM` env var.

**Files:**
- Create: `examples/stress-test/seeds/models/task.ts`
- Create: `examples/stress-test/seeds/models/project.ts`
- Create: `examples/stress-test/seeds/models/comment.ts`
- Create: `examples/stress-test/seeds/models/user.ts`
- Create: `examples/stress-test/seeds/models/document.ts`
- Create: `examples/stress-test/seeds/models/notification.ts`
- Create: `examples/stress-test/seeds/models/activity.ts`

- [ ] **Step 1: Create small seed — task.ts**

```typescript
// examples/stress-test/seeds/models/task.ts
import { z } from 'zod'
import { defineZodModel, zx } from 'zodvex'

export const taskFields = {
  title: z.string(),
  done: z.boolean(),
  priority: z.number(),
  createdAt: zx.date(),
}

const opts = process.env.ZODVEX_SLIM === '1' ? { schemaHelpers: false } : undefined

export const TaskModel = defineZodModel('tasks', taskFields, opts)
  .index('by_created', ['createdAt'])
```

- [ ] **Step 2: Create small seed — project.ts**

```typescript
// examples/stress-test/seeds/models/project.ts
import { z } from 'zod'
import { defineZodModel, zx } from 'zodvex'

export const projectFields = {
  name: z.string(),
  description: z.string().optional(),
  ownerId: zx.id('projects'),
  active: z.boolean(),
  createdAt: zx.date(),
}

const opts = process.env.ZODVEX_SLIM === '1' ? { schemaHelpers: false } : undefined

export const ProjectModel = defineZodModel('projects', projectFields, opts)
  .index('by_owner', ['ownerId'])
  .index('by_created', ['createdAt'])
```

- [ ] **Step 3: Create small seed — comment.ts**

Note: All `zx.id()` calls reference the seed's **own** table name, not foreign tables. The composer replaces all occurrences of the table name string, so self-references become `zx.id('comments_0002')` etc. Cross-table foreign keys are not needed — the stress test measures memory, not relational integrity.

```typescript
// examples/stress-test/seeds/models/comment.ts
import { z } from 'zod'
import { defineZodModel, zx } from 'zodvex'

export const commentFields = {
  parentId: zx.id('comments'),
  authorId: zx.id('comments'),
  body: z.string(),
  createdAt: zx.date(),
}

const opts = process.env.ZODVEX_SLIM === '1' ? { schemaHelpers: false } : undefined

export const CommentModel = defineZodModel('comments', commentFields, opts)
  .index('by_parent', ['parentId'])
  .index('by_created', ['createdAt'])
```

- [ ] **Step 4: Create medium seed — user.ts**

```typescript
// examples/stress-test/seeds/models/user.ts
import { z } from 'zod'
import { defineZodModel, zx } from 'zodvex'

export const userFields = {
  name: z.string(),
  email: z.string(),
  avatarUrl: z.string().optional(),
  role: z.enum(['admin', 'member', 'viewer']),
  settings: z.object({
    theme: z.enum(['light', 'dark']),
    notifications: z.boolean(),
  }).optional(),
  lastLoginAt: zx.date().optional(),
  active: z.boolean(),
  createdAt: zx.date(),
}

const opts = process.env.ZODVEX_SLIM === '1' ? { schemaHelpers: false } : undefined

export const UserModel = defineZodModel('users', userFields, opts)
  .index('by_email', ['email'])
  .index('by_role', ['role'])
  .index('by_created', ['createdAt'])
```

- [ ] **Step 5: Create medium seed — document.ts**

```typescript
// examples/stress-test/seeds/models/document.ts
import { z } from 'zod'
import { defineZodModel, zx } from 'zodvex'

export const documentFields = {
  title: z.string(),
  content: z.string(),
  status: z.enum(['draft', 'review', 'published', 'archived']),
  authorId: zx.id('documents'),
  tags: z.array(z.string()),
  metadata: z.object({
    wordCount: z.number(),
    version: z.number(),
    source: z.string().optional(),
  }),
  isPublic: z.boolean(),
  score: z.number().nullable(),
  updatedAt: zx.date().optional(),
  createdAt: zx.date(),
}

const opts = process.env.ZODVEX_SLIM === '1' ? { schemaHelpers: false } : undefined

export const DocumentModel = defineZodModel('documents', documentFields, opts)
  .index('by_author', ['authorId'])
  .index('by_status', ['status'])
  .index('by_created', ['createdAt'])
```

- [ ] **Step 6: Create large seed — notification.ts (discriminated union)**

```typescript
// examples/stress-test/seeds/models/notification.ts
import { z } from 'zod'
import { defineZodModel, zx } from 'zodvex'

const EmailNotification = z.object({
  kind: z.literal('email'),
  recipientId: zx.id('notifications'),
  subject: z.string(),
  body: z.string(),
  sentAt: zx.date(),
  createdAt: zx.date(),
})

const PushNotification = z.object({
  kind: z.literal('push'),
  recipientId: zx.id('notifications'),
  title: z.string(),
  badge: z.number().optional(),
  sentAt: zx.date(),
  createdAt: zx.date(),
})

const InAppNotification = z.object({
  kind: z.literal('in_app'),
  recipientId: zx.id('notifications'),
  message: z.string(),
  linkTo: z.string().optional(),
  read: z.boolean(),
  createdAt: zx.date(),
})

export const notificationSchema = z.discriminatedUnion('kind', [
  EmailNotification,
  PushNotification,
  InAppNotification,
])

const opts = process.env.ZODVEX_SLIM === '1' ? { schemaHelpers: false } : undefined

export const NotificationModel = defineZodModel('notifications', notificationSchema, opts)
  .index('by_recipient', ['recipientId'])
  .index('by_kind', ['kind'])
  .index('by_created', ['createdAt'])
```

- [ ] **Step 7: Create large seed — activity.ts (union with nested objects)**

```typescript
// examples/stress-test/seeds/models/activity.ts
import { z } from 'zod'
import { defineZodModel, zx } from 'zodvex'

const addressSchema = z.object({
  street: z.string(),
  city: z.string(),
  state: z.string(),
  zip: z.string(),
  country: z.string().optional(),
})

const contactVariantA = z.object({
  kind: z.literal('email'),
  email: z.string(),
  verified: z.boolean(),
})

const contactVariantB = z.object({
  kind: z.literal('phone'),
  phone: z.string(),
  extension: z.string().optional(),
})

const contactVariantC = z.object({
  kind: z.literal('address'),
  address: addressSchema,
  isPrimary: z.boolean(),
})

export const activityFields = {
  title: z.string(),
  description: z.string().optional(),
  status: z.enum(['draft', 'review', 'active', 'suspended', 'archived']),
  priority: z.number(),
  ownerId: zx.id('activities'),
  assigneeId: zx.id('activities').optional(),
  contact: z.discriminatedUnion('kind', [contactVariantA, contactVariantB, contactVariantC]),
  tags: z.array(z.string()),
  labels: z.array(z.object({ name: z.string(), color: z.string() })),
  metadata: z.object({
    source: z.string(),
    version: z.number(),
    features: z.array(z.string()),
  }),
  isPublic: z.boolean(),
  score: z.number().nullable(),
  rating: z.number().optional(),
  retryCount: z.number(),
  lastActivityAt: zx.date().optional(),
  createdAt: zx.date(),
  updatedAt: zx.date().optional(),
}

const opts = process.env.ZODVEX_SLIM === '1' ? { schemaHelpers: false } : undefined

export const ActivityModel = defineZodModel('activities', activityFields, opts)
  .index('by_owner', ['ownerId'])
  .index('by_status', ['status'])
  .index('by_created', ['createdAt'])
  .index('by_priority', ['priority'])
```

- [ ] **Step 8: Verify seeds import successfully**

```bash
cd examples/stress-test
bun -e "await import('./seeds/models/task.ts'); await import('./seeds/models/project.ts'); await import('./seeds/models/comment.ts'); await import('./seeds/models/user.ts'); await import('./seeds/models/document.ts'); await import('./seeds/models/notification.ts'); await import('./seeds/models/activity.ts'); console.log('All seeds OK')"
```

Expected: `All seeds OK`

- [ ] **Step 9: Commit**

```bash
git add examples/stress-test/seeds/models/
git commit -m "feat: add hand-written seed models for stress test harness"
```

---

### Task 2: Write seed endpoint files

Endpoint seeds use `zx.doc()` / `zx.docArray()` helpers so they work for both slim and full models. Each seed has get, list, create, update, delete functions.

**Files:**
- Create: `examples/stress-test/seeds/endpoints/task.ts`
- Create: `examples/stress-test/seeds/endpoints/project.ts`
- Create: `examples/stress-test/seeds/endpoints/comment.ts`
- Create: `examples/stress-test/seeds/endpoints/user.ts`
- Create: `examples/stress-test/seeds/endpoints/document.ts`
- Create: `examples/stress-test/seeds/endpoints/notification.ts`
- Create: `examples/stress-test/seeds/endpoints/activity.ts`

- [ ] **Step 1: Create task endpoint seed**

```typescript
// examples/stress-test/seeds/endpoints/task.ts
import { zx } from 'zodvex'
import { zq, zm } from '../functions'
import { TaskModel, taskFields } from '../models/task'

const byIdArgs = { id: zx.id('tasks') }

export const getTask = zq({
  args: byIdArgs,
  handler: async (ctx, { id }) => ctx.db.get(id),
  returns: zx.doc(TaskModel).nullable(),
})

export const listTasks = zq({
  args: {},
  handler: async (ctx) => ctx.db.query('tasks').collect(),
  returns: zx.docArray(TaskModel),
})

export const createTask = zm({
  args: { title: taskFields.title, priority: taskFields.priority },
  handler: async (ctx, args) =>
    ctx.db.insert('tasks', { ...args, done: false, createdAt: new Date() }),
  returns: zx.id('tasks'),
})

export const updateTask = zm({
  args: { id: zx.id('tasks'), title: taskFields.title },
  handler: async (ctx, { id, ...fields }) => ctx.db.patch(id, fields),
})

export const deleteTask = zm({
  args: byIdArgs,
  handler: async (ctx, { id }) => ctx.db.delete(id),
})
```

- [ ] **Step 2: Create remaining endpoint seeds**

Create the same pattern for project, comment, user, document, notification, and activity. Each follows the same structure:

- `get<Name>` — `zq` with id arg, returns `zx.doc(Model).nullable()`
- `list<Name>` — `zq` with no args, returns `zx.docArray(Model)`
- `create<Name>` — `zm` with a subset of fields, returns `zx.id('table')`
- `update<Name>` — `zm` with id + fields
- `delete<Name>` — `zm` with id arg

For **notification** (discriminated union model), endpoints are the same — `zx.doc()` and `zx.docArray()` handle unions transparently.

Create each file following the task.ts pattern. Use the matching model's exported fields and table name. For the create handler args, pick 2-3 representative fields from each model.

**project.ts:**
```typescript
import { zx } from 'zodvex'
import { zq, zm } from '../functions'
import { ProjectModel, projectFields } from '../models/project'

const byIdArgs = { id: zx.id('projects') }

export const getProject = zq({
  args: byIdArgs,
  handler: async (ctx, { id }) => ctx.db.get(id),
  returns: zx.doc(ProjectModel).nullable(),
})

export const listProjects = zq({
  args: {},
  handler: async (ctx) => ctx.db.query('projects').collect(),
  returns: zx.docArray(ProjectModel),
})

export const createProject = zm({
  args: { name: projectFields.name, ownerId: projectFields.ownerId },
  handler: async (ctx, args) =>
    ctx.db.insert('projects', { ...args, active: true, createdAt: new Date() }),
  returns: zx.id('projects'),
})

export const updateProject = zm({
  args: { id: zx.id('projects'), name: projectFields.name },
  handler: async (ctx, { id, ...fields }) => ctx.db.patch(id, fields),
})

export const deleteProject = zm({
  args: byIdArgs,
  handler: async (ctx, { id }) => ctx.db.delete(id),
})
```

**comment.ts:**
```typescript
import { zx } from 'zodvex'
import { zq, zm } from '../functions'
import { CommentModel, commentFields } from '../models/comment'

const byIdArgs = { id: zx.id('comments') }

export const getComment = zq({
  args: byIdArgs,
  handler: async (ctx, { id }) => ctx.db.get(id),
  returns: zx.doc(CommentModel).nullable(),
})

export const listComments = zq({
  args: {},
  handler: async (ctx) => ctx.db.query('comments').collect(),
  returns: zx.docArray(CommentModel),
})

export const createComment = zm({
  args: { parentId: commentFields.parentId, authorId: commentFields.authorId, body: commentFields.body },
  handler: async (ctx, args) =>
    ctx.db.insert('comments', { ...args, createdAt: new Date() }),
  returns: zx.id('comments'),
})

export const updateComment = zm({
  args: { id: zx.id('comments'), body: commentFields.body },
  handler: async (ctx, { id, ...fields }) => ctx.db.patch(id, fields),
})

export const deleteComment = zm({
  args: byIdArgs,
  handler: async (ctx, { id }) => ctx.db.delete(id),
})
```

**user.ts:**
```typescript
import { z } from 'zod'
import { zx } from 'zodvex'
import { zq, zm } from '../functions'
import { UserModel, userFields } from '../models/user'

const byIdArgs = { id: zx.id('users') }

export const getUser = zq({
  args: byIdArgs,
  handler: async (ctx, { id }) => ctx.db.get(id),
  returns: zx.doc(UserModel).nullable(),
})

export const listUsers = zq({
  args: {},
  handler: async (ctx) => ctx.db.query('users').collect(),
  returns: zx.docArray(UserModel),
})

export const createUser = zm({
  args: { name: userFields.name, email: userFields.email, role: userFields.role },
  handler: async (ctx, args) =>
    ctx.db.insert('users', { ...args, active: true, createdAt: new Date() }),
  returns: zx.id('users'),
})

export const updateUser = zm({
  args: { id: zx.id('users'), name: userFields.name },
  handler: async (ctx, { id, ...fields }) => ctx.db.patch(id, fields),
})

export const deleteUser = zm({
  args: byIdArgs,
  handler: async (ctx, { id }) => ctx.db.delete(id),
})
```

**document.ts:**
```typescript
import { zx } from 'zodvex'
import { zq, zm } from '../functions'
import { DocumentModel, documentFields } from '../models/document'

const byIdArgs = { id: zx.id('documents') }

export const getDocument = zq({
  args: byIdArgs,
  handler: async (ctx, { id }) => ctx.db.get(id),
  returns: zx.doc(DocumentModel).nullable(),
})

export const listDocuments = zq({
  args: {},
  handler: async (ctx) => ctx.db.query('documents').collect(),
  returns: zx.docArray(DocumentModel),
})

export const createDocument = zm({
  args: { title: documentFields.title, content: documentFields.content, authorId: documentFields.authorId },
  handler: async (ctx, args) =>
    ctx.db.insert('documents', { ...args, status: 'draft', tags: [], metadata: { wordCount: 0, version: 1 }, isPublic: false, score: null, createdAt: new Date() }),
  returns: zx.id('documents'),
})

export const updateDocument = zm({
  args: { id: zx.id('documents'), title: documentFields.title },
  handler: async (ctx, { id, ...fields }) => ctx.db.patch(id, fields),
})

export const deleteDocument = zm({
  args: byIdArgs,
  handler: async (ctx, { id }) => ctx.db.delete(id),
})
```

**notification.ts:**
```typescript
import { z } from 'zod'
import { zx } from 'zodvex'
import { zq, zm } from '../functions'
import { NotificationModel } from '../models/notification'

const byIdArgs = { id: zx.id('notifications') }

export const getNotification = zq({
  args: byIdArgs,
  handler: async (ctx, { id }) => ctx.db.get(id),
  returns: zx.doc(NotificationModel).nullable(),
})

export const listNotifications = zq({
  args: {},
  handler: async (ctx) => ctx.db.query('notifications').collect(),
  returns: zx.docArray(NotificationModel),
})

export const createNotification = zm({
  args: {
    kind: z.literal('in_app'),
    recipientId: zx.id('notifications'),
    message: z.string(),
    read: z.boolean(),
  },
  handler: async (ctx, args) =>
    ctx.db.insert('notifications', { ...args, createdAt: new Date() }),
  returns: zx.id('notifications'),
})

export const updateNotification = zm({
  args: { id: zx.id('notifications'), message: z.string() },
  handler: async (ctx, { id, ...fields }) => ctx.db.patch(id, fields),
})

export const deleteNotification = zm({
  args: byIdArgs,
  handler: async (ctx, { id }) => ctx.db.delete(id),
})
```

**activity.ts:**
```typescript
import { z } from 'zod'
import { zx } from 'zodvex'
import { zq, zm } from '../functions'
import { ActivityModel, activityFields } from '../models/activity'

const byIdArgs = { id: zx.id('activities') }

export const getActivity = zq({
  args: byIdArgs,
  handler: async (ctx, { id }) => ctx.db.get(id),
  returns: zx.doc(ActivityModel).nullable(),
})

export const listActivities = zq({
  args: {},
  handler: async (ctx) => ctx.db.query('activities').collect(),
  returns: zx.docArray(ActivityModel),
})

export const createActivity = zm({
  args: { title: activityFields.title, ownerId: activityFields.ownerId, priority: activityFields.priority },
  handler: async (ctx, args) =>
    ctx.db.insert('activities', { ...args, status: 'draft', tags: [], labels: [], metadata: { source: 'test', version: 1, features: [] }, isPublic: false, score: null, retryCount: 0, createdAt: new Date() }),
  returns: zx.id('activities'),
})

export const updateActivity = zm({
  args: { id: zx.id('activities'), title: activityFields.title },
  handler: async (ctx, { id, ...fields }) => ctx.db.patch(id, fields),
})

export const deleteActivity = zm({
  args: byIdArgs,
  handler: async (ctx, { id }) => ctx.db.delete(id),
})
```

- [ ] **Step 3: Commit**

```bash
git add examples/stress-test/seeds/endpoints/
git commit -m "feat: add hand-written seed endpoints for stress test harness"
```

---

### Task 3: Write the composer

The composer takes a count N and the seeds directory, and produces a composed `convex/` directory. It copies seed files round-robin with unique table names and export names, then generates `schema.ts` and `functions.ts`.

**Files:**
- Create: `examples/stress-test/compose.ts`

- [ ] **Step 1: Implement the composer**

```typescript
// examples/stress-test/compose.ts
import { mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync, existsSync } from 'fs'
import { join, basename } from 'path'
import { fileURLToPath } from 'url'

const EXAMPLE_DIR = fileURLToPath(new URL('.', import.meta.url))
const SEEDS_DIR = join(EXAMPLE_DIR, 'seeds')

export interface ComposeConfig {
  count: number
  outputDir: string
}

interface SeedInfo {
  /** Base name without extension: 'task', 'project', etc. */
  name: string
  /** PascalCase: 'Task', 'Project', etc. */
  pascal: string
  /** Original model file content */
  modelSource: string
  /** Original endpoint file content */
  endpointSource: string
  /** Table name extracted from defineZodModel('table_name', ...) */
  tableName: string
  /** Export name of the model: 'TaskModel', 'ProjectModel', etc. */
  modelExport: string
  /** Export name of the fields: 'taskFields', 'projectFields', etc. */
  fieldsExport: string
}

function toPascal(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1)
}

function loadSeeds(): SeedInfo[] {
  const modelDir = join(SEEDS_DIR, 'models')
  const endpointDir = join(SEEDS_DIR, 'endpoints')
  const seeds: SeedInfo[] = []

  for (const file of readdirSync(modelDir).filter(f => f.endsWith('.ts')).sort()) {
    const name = basename(file, '.ts')
    const pascal = toPascal(name)
    const modelSource = readFileSync(join(modelDir, file), 'utf-8')
    const endpointPath = join(endpointDir, file)
    const endpointSource = existsSync(endpointPath) ? readFileSync(endpointPath, 'utf-8') : ''

    // Extract table name from defineZodModel('table_name', ...)
    const tableMatch = modelSource.match(/defineZodModel\(\s*'([^']+)'/)
    const tableName = tableMatch ? tableMatch[1] : name + 's'

    const modelExport = `${pascal}Model`
    const fieldsExport = `${name}Fields`

    seeds.push({ name, pascal, modelSource, endpointSource, tableName, modelExport, fieldsExport })
  }

  return seeds
}

function renameSeed(
  source: string,
  seed: SeedInfo,
  index: number,
  suffix: string,
  newTable: string,
  newPascal: string
): string {
  let out = source
  // Replace table name strings (in defineZodModel, zx.id, ctx.db.query, ctx.db.insert)
  out = out.replaceAll(`'${seed.tableName}'`, `'${newTable}'`)
  // Replace model export name
  out = out.replaceAll(seed.modelExport, `${newPascal}Model`)
  // Replace fields export name
  out = out.replaceAll(seed.fieldsExport, `${newPascal.charAt(0).toLowerCase() + newPascal.slice(1)}Fields`)
  // Replace import paths — endpoints import from '../models/seed_name', need '../models/composed_name'
  out = out.replaceAll(`../models/${seed.name}`, `../models/${seed.name}_${suffix}`)
  return out
}

export function compose(config: ComposeConfig): { modelsDir: string; endpointsDir: string; outputDir: string } {
  const { count, outputDir } = config
  const modelsDir = join(outputDir, 'models')
  const endpointsDir = join(outputDir, 'endpoints')

  // Clean output
  if (existsSync(outputDir)) rmSync(outputDir, { recursive: true })
  mkdirSync(modelsDir, { recursive: true })
  mkdirSync(endpointsDir, { recursive: true })

  const seeds = loadSeeds()
  if (seeds.length === 0) throw new Error('No seed files found')

  const modelImports: string[] = []
  const tableEntries: string[] = []

  for (let i = 0; i < count; i++) {
    const seed = seeds[i % seeds.length]
    const suffix = String(i).padStart(4, '0')
    const newTable = `${seed.tableName}_${suffix}`
    const newPascal = `${seed.pascal}${suffix}`
    const fileName = `${seed.name}_${suffix}`

    // Compose model file
    const modelOut = renameSeed(seed.modelSource, seed, i, suffix, newTable, newPascal)
    writeFileSync(join(modelsDir, `${fileName}.ts`), modelOut)

    // Compose endpoint file (if seed has one)
    if (seed.endpointSource) {
      const endpointOut = renameSeed(seed.endpointSource, seed, i, suffix, newTable, newPascal)
      writeFileSync(join(endpointsDir, `${fileName}.ts`), endpointOut)
    }

    const modelExport = `${newPascal}Model`
    modelImports.push(`import { ${modelExport} } from './models/${fileName}'`)
    tableEntries.push(`  ${newTable}: ${modelExport},`)
  }

  // Generate schema.ts
  const schemaSource = `import { defineZodSchema } from 'zodvex/server'

${modelImports.join('\n')}

export default defineZodSchema({
${tableEntries.join('\n')}
})
`
  writeFileSync(join(outputDir, 'schema.ts'), schemaSource)

  // Generate functions.ts (standalone stub — no real Convex runtime)
  const functionsSource = `import { initZodvex } from 'zodvex/server'
import {
  query,
  mutation,
  action,
  internalQuery,
  internalMutation,
  internalAction,
} from '../_generated/server'

const schema = { __zodTableMap: {} } as any

export const { zq, zm } = initZodvex(schema, {
  query,
  mutation,
  action,
  internalQuery,
  internalMutation,
  internalAction,
}, { wrapDb: false })
`
  writeFileSync(join(outputDir, 'functions.ts'), functionsSource)

  // Summary
  writeFileSync(join(outputDir, 'summary.json'), JSON.stringify({ count, seeds: seeds.length }, null, 2))

  return { modelsDir, endpointsDir, outputDir }
}

// CLI entry point
if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2)
  const count = parseInt(args.find(a => a.startsWith('--count='))?.split('=')[1] ?? '50')
  const outputDir = args.find(a => a.startsWith('--output='))?.split('=')[1] ?? join(EXAMPLE_DIR, 'convex', 'composed')

  console.log(`Composing ${count} models from ${readdirSync(join(SEEDS_DIR, 'models')).filter(f => f.endsWith('.ts')).length} seeds`)
  compose({ count, outputDir })
  console.log(`Output: ${outputDir}`)
}
```

- [ ] **Step 2: Test the composer**

```bash
cd examples/stress-test
bun run compose.ts --count=10
cat convex/composed/summary.json
ls convex/composed/models/ | wc -l   # should be 10
ls convex/composed/endpoints/ | wc -l # should be 10
head -5 convex/composed/models/task_0000.ts  # verify table name replacement
head -5 convex/composed/schema.ts            # verify imports
```

- [ ] **Step 3: Commit**

```bash
git add examples/stress-test/compose.ts
git commit -m "feat: add seed composer for stress test harness"
```

---

### Task 4: Rewrite the measurer as a black box

The measurer imports any directory and reports heap. It knows nothing about zodvex, models, or variants.

**Files:**
- Rewrite: `examples/stress-test/measure.ts`

- [ ] **Step 1: Rewrite measure.ts**

```typescript
// examples/stress-test/measure.ts
//
// Black-box heap measurer.
// Imports a convex directory (schema.ts + endpoints), reports heap delta.
// Knows nothing about zodvex internals — if an import fails, that's a signal
// about the library code, not this script.

import { join } from 'path'
import { existsSync, readdirSync, writeFileSync, mkdirSync } from 'fs'
import v8 from 'v8'

interface MeasureConfig {
  dir: string
  runtime: 'zod' | 'mini'
  resultsFile?: string
}

export interface MeasureResult {
  dir: string
  runtime: string
  heapBefore: number
  heapAfter: number
  heapDelta: number
  heapDeltaMB: string
  heapPeakMB: string
  modulesLoaded: number
  modulesFailed: number
  timestamp: string
}

function forceGC() {
  if (typeof globalThis.gc === 'function') {
    globalThis.gc()
  }
}

function getHeapUsed(): number {
  return v8.getHeapStatistics().used_heap_size
}

function parseArgs(): MeasureConfig {
  const args = process.argv.slice(2)
  const dir = args.find(a => a.startsWith('--dir='))?.split('=')[1]
  if (!dir) throw new Error('--dir=<path> is required')
  const runtime = (args.find(a => a.startsWith('--runtime='))?.split('=')[1] ?? 'zod') as 'zod' | 'mini'
  const resultsFile = args.find(a => a.startsWith('--results='))?.split('=')[1]
  return { dir, runtime, resultsFile }
}

export async function measure(config: MeasureConfig): Promise<MeasureResult> {
  const { dir, runtime } = config

  if (!existsSync(dir)) {
    throw new Error(`Directory not found: ${dir}`)
  }

  // Pre-import runtime libraries to baseline them out.
  // Must match the imports the composed code uses so we measure only schema creation.
  if (runtime === 'mini') {
    await import('zod/mini')
    await import('zodvex/mini')
    await import('zodvex/mini/server')
  } else {
    await import('zod')
    await import('zodvex')
    await import('zodvex/server')
  }

  forceGC()
  forceGC()
  const heapBefore = getHeapUsed()

  // Import schema.ts if it exists
  const schemaPath = join(dir, 'schema.ts')
  if (existsSync(schemaPath)) {
    await import(schemaPath)
  }

  // Import all endpoint files
  let modulesLoaded = 0
  let modulesFailed = 0
  const endpointsDir = join(dir, 'endpoints')
  if (existsSync(endpointsDir)) {
    const files = readdirSync(endpointsDir).filter(f => f.endsWith('.ts')).sort()
    for (const file of files) {
      try {
        await import(join(endpointsDir, file))
        modulesLoaded++
      } catch (e) {
        modulesFailed++
        console.error(`FAILED: ${file}: ${(e as Error).message}`)
      }
    }
  }

  // Count schema modules too
  if (existsSync(schemaPath)) {
    const modelsDir = join(dir, 'models')
    if (existsSync(modelsDir)) {
      modulesLoaded += readdirSync(modelsDir).filter(f => f.endsWith('.ts')).length
    }
  }

  if (modulesFailed > 0) {
    throw new Error(
      `${modulesFailed}/${modulesFailed + modulesLoaded} modules failed to import. ` +
      `Measurement is invalid.`
    )
  }

  forceGC()
  forceGC()
  const heapAfter = getHeapUsed()

  const delta = heapAfter - heapBefore
  return {
    dir,
    runtime,
    heapBefore,
    heapAfter,
    heapDelta: delta,
    heapDeltaMB: (delta / 1024 / 1024).toFixed(2),
    heapPeakMB: (heapAfter / 1024 / 1024).toFixed(2),
    modulesLoaded,
    modulesFailed: 0,
    timestamp: new Date().toISOString(),
  }
}

// CLI entry point
if (import.meta.url === `file://${process.argv[1]}`) {
  const config = parseArgs()
  const result = await measure(config)

  console.log(`${result.runtime} (${result.modulesLoaded} modules): +${result.heapDeltaMB} MB (peak: ${result.heapPeakMB} MB)`)

  if (config.resultsFile) {
    const dir = join(config.resultsFile, '..')
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    writeFileSync(config.resultsFile, JSON.stringify(result, null, 2))
    console.log(`Result saved to ${config.resultsFile}`)
  }
}
```

- [ ] **Step 2: Test the measurer against composed output**

```bash
cd examples/stress-test
bun run compose.ts --count=10
bun --expose-gc run measure.ts --dir=convex/composed --runtime=zod
```

Expected: A single line like `zod (20 modules): +X.XX MB (peak: Y.YY MB)` — no zodvex-specific output, no variant logic, no property counts.

- [ ] **Step 3: Commit**

```bash
git add examples/stress-test/measure.ts
git commit -m "feat: rewrite measurer as black-box directory importer"
```

---

### Task 5: Write the runner

The runner parses flags, orchestrates compose → compile → measure, and handles ceiling search + reporting.

**Files:**
- Create: `examples/stress-test/stress-test.ts`
- Modify: `examples/stress-test/package.json`

- [ ] **Step 1: Implement the runner**

```typescript
// examples/stress-test/stress-test.ts
import { execSync } from 'child_process'
import { join } from 'path'
import { fileURLToPath } from 'url'
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync, cpSync, rmSync } from 'fs'
import { transformCode, transformImports } from 'zod-to-mini'
import { Project } from 'ts-morph'

const ROOT = fileURLToPath(new URL('.', import.meta.url))
const COMPOSED_DIR = join(ROOT, 'convex', 'composed')
const COMPILED_DIR = join(ROOT, 'convex', 'compiled')
const RESULTS_DIR = join(ROOT, 'results')

// --- Flag Parsing ---

interface Flags {
  count?: number   // ad-hoc mode: measure at exactly N
  slim: boolean
  mini: boolean
  deploy: boolean
  budget: number
}

function parseFlags(): Flags {
  const args = process.argv.slice(2)
  return {
    count: args.find(a => a.startsWith('--count=')) ? parseInt(args.find(a => a.startsWith('--count='))!.split('=')[1]) : undefined,
    slim: args.includes('--slim'),
    mini: args.includes('--mini'),
    deploy: args.includes('--deploy'),
    budget: parseInt(args.find(a => a.startsWith('--budget='))?.split('=')[1] ?? '64'),
  }
}

// --- Variant Definition ---

interface Variant {
  name: string
  slim: boolean
  mini: boolean
}

function getVariants(flags: Flags): Variant[] {
  // If specific flags are set, run only that variant
  if (flags.slim || flags.mini) {
    return [{ name: variantName(flags.slim, flags.mini), slim: flags.slim, mini: flags.mini }]
  }
  // Default: all 4 variants
  return [
    { name: 'zod', slim: false, mini: false },
    { name: 'zod + slim', slim: true, mini: false },
    { name: 'mini', slim: false, mini: true },
    { name: 'mini + slim', slim: true, mini: true },
  ]
}

function variantName(slim: boolean, mini: boolean): string {
  if (slim && mini) return 'mini + slim'
  if (slim) return 'zod + slim'
  if (mini) return 'mini'
  return 'zod'
}

// --- Compile (zod → mini) ---

function compileDirectory(srcDir: string, destDir: string): void {
  if (existsSync(destDir)) rmSync(destDir, { recursive: true })
  cpSync(srcDir, destDir, { recursive: true })

  const dirs = ['models', 'endpoints']
  for (const sub of dirs) {
    const dir = join(destDir, sub)
    if (!existsSync(dir)) continue
    for (const file of readdirSync(dir).filter(f => f.endsWith('.ts'))) {
      const filePath = join(dir, file)
      compileFile(filePath)
    }
  }

  // Compile schema.ts and functions.ts
  for (const file of ['schema.ts', 'functions.ts']) {
    const filePath = join(destDir, file)
    if (existsSync(filePath)) compileFile(filePath)
  }
}

function compileFile(filePath: string): void {
  const code = readFileSync(filePath, 'utf-8')
  const result = transformCode(code)
  let output = result.code

  const project = new Project({ useInMemoryFileSystem: true })
  const sf = project.createSourceFile('tmp.ts', output)
  transformImports(sf)
  for (const imp of sf.getImportDeclarations()) {
    const spec = imp.getModuleSpecifierValue()
    if (spec === 'zodvex' || spec === 'zodvex/core') imp.setModuleSpecifier('zodvex/mini')
    if (spec === 'zodvex/server') imp.setModuleSpecifier('zodvex/mini/server')
  }
  output = sf.getFullText()

  writeFileSync(filePath, output)
}

// --- Measurement (subprocess) ---

interface MeasurePoint {
  variant: string
  count: number
  heapDeltaMB: number
  heapPeakMB: number
  modulesLoaded: number
}

function measureAtCount(count: number, variant: Variant): MeasurePoint | null {
  const env: Record<string, string> = {
    ...process.env as Record<string, string>,
    NODE_OPTIONS: '--expose-gc',
  }
  if (variant.slim) env.ZODVEX_SLIM = '1'

  // Use a temp JSON file for structured output — no stdout scraping
  const resultsFile = join(ROOT, '.measure-result.json')

  try {
    // Compose
    execSync(`bun run compose.ts --count=${count} --output=${COMPOSED_DIR}`, {
      cwd: ROOT, stdio: 'pipe', timeout: 60_000,
    })

    // Compile if mini
    let measureDir = COMPOSED_DIR
    if (variant.mini) {
      compileDirectory(COMPOSED_DIR, COMPILED_DIR)
      measureDir = COMPILED_DIR
    }

    // Measure in subprocess — output goes to JSON file, not parsed from stdout
    const runtime = variant.mini ? 'mini' : 'zod'
    execSync(
      `bun --expose-gc run measure.ts --dir=${measureDir} --runtime=${runtime} --results=${resultsFile}`,
      { cwd: ROOT, encoding: 'utf-8', timeout: 120_000, env }
    )

    // Read structured result
    if (!existsSync(resultsFile)) return null
    const result = JSON.parse(readFileSync(resultsFile, 'utf-8'))

    return {
      variant: variant.name,
      count,
      heapDeltaMB: parseFloat(result.heapDeltaMB),
      heapPeakMB: parseFloat(result.heapPeakMB),
      modulesLoaded: result.modulesLoaded,
    }
  } catch (e) {
    console.error(`  ${count}: FAILED — ${(e as Error).message?.split('\n')[0]}`)
    return null
  }
}

// --- Ceiling Search ---

function findCeiling(variant: Variant, budget: number): { ceiling: number; points: MeasurePoint[] } {
  console.log(`\n${'='.repeat(60)}`)
  console.log(`Searching ceiling for: ${variant.name} (budget=${budget} MB)`)
  console.log('='.repeat(60))

  const points: MeasurePoint[] = []
  let lastGood = 0
  let hi = 500

  // Coarse pass: step by 50
  for (let count = 50; count <= hi; count += 50) {
    const point = measureAtCount(count, variant)
    if (!point) { hi = count; break }
    points.push(point)
    console.log(`  ${count}: ${point.heapDeltaMB.toFixed(2)} MB`)
    if (point.heapDeltaMB <= budget) {
      lastGood = count
    } else {
      hi = count
      break
    }
  }

  if (lastGood === 0) return { ceiling: 0, points }

  // Fine pass: binary search
  let lo = lastGood
  while (hi - lo > 5) {
    const mid = Math.round((lo + hi) / 2)
    const point = measureAtCount(mid, variant)
    if (!point || point.heapDeltaMB > budget) {
      console.log(`  ${mid}: ${point?.heapDeltaMB.toFixed(2) ?? 'FAILED'} MB (over)`)
      if (point) points.push(point)
      hi = mid
    } else {
      console.log(`  ${mid}: ${point.heapDeltaMB.toFixed(2)} MB (under)`)
      points.push(point)
      lo = mid
      lastGood = mid
    }
  }

  const ceilingPoint = points.find(p => p.count === lastGood)
  console.log(`  → Ceiling: ${lastGood} endpoints @ ${ceilingPoint?.heapDeltaMB.toFixed(2) ?? '?'} MB`)

  return { ceiling: lastGood, points }
}

// --- Report ---

function writeReport(
  results: { variant: string; ceiling: number; points: MeasurePoint[] }[],
  budget: number
): void {
  if (!existsSync(RESULTS_DIR)) mkdirSync(RESULTS_DIR, { recursive: true })

  const lines: string[] = [
    '# Stress Test Report',
    '',
    `**Date:** ${new Date().toISOString().split('T')[0]}`,
    `**Budget:** ${budget} MB`,
    '',
    '## OOM Ceilings',
    '',
    '| Variant | Max Endpoints | Heap at Ceiling (MB) |',
    '|---------|--------------|---------------------|',
  ]

  for (const r of results) {
    const ceilingPoint = r.points.find(p => p.count === r.ceiling)
    lines.push(`| ${r.variant} | ${r.ceiling} | ${ceilingPoint?.heapDeltaMB.toFixed(2) ?? 'n/a'} |`)
  }

  lines.push('', '## All Measurements', '')
  lines.push('| Variant | Count | Heap Delta (MB) | Peak (MB) | Modules |')
  lines.push('|---------|-------|-----------------|-----------|---------|')

  for (const r of results) {
    const sorted = [...r.points].sort((a, b) => a.count - b.count)
    for (const p of sorted) {
      lines.push(`| ${p.variant} | ${p.count} | ${p.heapDeltaMB.toFixed(2)} | ${p.heapPeakMB.toFixed(2)} | ${p.modulesLoaded} |`)
    }
  }

  const reportPath = join(RESULTS_DIR, 'report.md')
  writeFileSync(reportPath, lines.join('\n'))
  console.log(`\nReport written to ${reportPath}`)

  // Also save raw JSON
  writeFileSync(
    join(RESULTS_DIR, 'report.json'),
    JSON.stringify({ date: new Date().toISOString(), budget, results }, null, 2)
  )
}

// --- Main ---

async function main() {
  const flags = parseFlags()
  const variants = getVariants(flags)

  if (flags.deploy) {
    throw new Error(
      '--deploy mode is not yet implemented. ' +
      'It will use `npx convex deploy` to find the real Convex isolate ceiling.'
    )
  }

  console.log(`Stress Test Harness`)
  console.log(`Budget: ${flags.budget} MB`)
  console.log(`Variants: ${variants.map(v => v.name).join(', ')}`)

  if (flags.count !== undefined) {
    // Ad-hoc: single measurement
    for (const variant of variants) {
      const point = measureAtCount(flags.count, variant)
      if (point) {
        console.log(`${variant.name} @ ${flags.count}: ${point.heapDeltaMB.toFixed(2)} MB (peak: ${point.heapPeakMB.toFixed(2)} MB)`)
      }
    }
    return
  }

  // Ceiling search + report
  const results: { variant: string; ceiling: number; points: MeasurePoint[] }[] = []

  for (const variant of variants) {
    const { ceiling, points } = findCeiling(variant, flags.budget)
    results.push({ variant: variant.name, ceiling, points })
  }

  // Print summary
  console.log('\n' + '='.repeat(60))
  console.log('RESULTS')
  console.log('='.repeat(60))
  console.log(`\n| Variant | Ceiling (endpoints) | Heap at ceiling (MB) |`)
  console.log(`|---------|--------------------|--------------------|`)
  for (const r of results) {
    const p = r.points.find(p => p.count === r.ceiling)
    console.log(`| ${r.variant} | ${r.ceiling} | ${p?.heapDeltaMB.toFixed(2) ?? 'n/a'} |`)
  }

  writeReport(results, flags.budget)
}

main().catch(console.error)
```

- [ ] **Step 2: Update package.json scripts**

In `examples/stress-test/package.json`, update the scripts:

```json
{
  "scripts": {
    "stress-test": "bun run stress-test.ts",
    "compose": "bun run compose.ts",
    "measure": "bun run measure.ts"
  }
}
```

Remove the old `generate`, `report` scripts.

- [ ] **Step 3: Test the runner with a single measurement**

```bash
cd examples/stress-test
bun run stress-test --count=50
```

Expected: Measurements for all 4 variants at count 50.

- [ ] **Step 4: Test ceiling search for one variant**

```bash
bun run stress-test --slim
```

Expected: Binary search for "zod + slim" ceiling, report with all measurement points.

- [ ] **Step 5: Commit**

```bash
git add examples/stress-test/stress-test.ts examples/stress-test/package.json
git commit -m "feat: add stress test runner with ceiling search and reporting"
```

---

### Task 6: Clean up old infrastructure

Move legacy files out, update gitignore, and fix the root `verify:examples` script.

**Files:**
- Remove/move: `examples/stress-test/generate.ts`
- Remove/move: `examples/stress-test/report.ts`
- Remove/move: `examples/stress-test/find-ceiling.ts`
- Remove/move: `examples/stress-test/templates/` directory
- Modify: `examples/stress-test/.gitignore`
- Modify: `package.json` (repo root) — update `verify:examples`

- [ ] **Step 1: Move old files to legacy/**

```bash
cd examples/stress-test
mkdir -p legacy
mv generate.ts legacy/
mv report.ts legacy/
mv find-ceiling.ts legacy/
mv templates/ legacy/
mv results/ legacy/results-archive/
mkdir results
```

- [ ] **Step 2: Update .gitignore**

```
convex/composed/
convex/compiled/
convex/generated/
node_modules/
.env.local
.measure-result.json
```

- [ ] **Step 3: Update root verify:examples script**

In `package.json` at the repo root, the `verify:examples` script currently calls the old stress-test commands:

```
bun run --cwd examples/stress-test typecheck && bun run --cwd examples/stress-test generate && bun run --cwd examples/stress-test measure -- --count=11 ...  && bun run --cwd examples/stress-test report -- --scales=11 ...
```

Replace the stress-test portion with the new harness:

```
bun run --cwd examples/stress-test typecheck && bun run --cwd examples/stress-test stress-test -- --count=11
```

This composes 11 models from seeds, measures all 4 variants at that count, and verifies the harness works. The full `verify:examples` line becomes:

```json
"verify:examples": "bun run guard:mini-imports && bun run --cwd examples/stress-test typecheck && bun run --cwd examples/stress-test stress-test -- --count=11 && bun run --cwd examples/task-manager typecheck && bun run --cwd examples/task-manager test && bun run --cwd examples/task-manager generate && bun run --cwd examples/task-manager-mini typecheck && bun run --cwd examples/task-manager-mini test && bun run --cwd examples/task-manager-mini generate"
```

- [ ] **Step 4: Update README.md**

Replace the contents of `examples/stress-test/README.md` with usage for the new harness:

````markdown
# Stress Test Harness

Measures zodvex memory footprint at scale to find the OOM ceiling on Convex's 64 MB V8 isolate.

## Quick Start

```bash
# Build zodvex first (harness imports from built dist)
cd ../.. && bun run build && cd examples/stress-test

# Find OOM ceiling for all 4 variants (zod, zod+slim, mini, mini+slim)
bun run stress-test

# Find ceiling for a specific variant
bun run stress-test --slim --mini

# Single measurement at a specific count (for debugging)
bun run stress-test --count=200 --slim
```

## How It Works

1. **Seeds** (`seeds/`) — hand-written zodvex models and endpoints covering small/medium/large complexity
2. **Composer** (`compose.ts`) — scales seeds to N models via file copy + table name replacement
3. **Compiler** — runs zod-to-mini on composed output for the mini variant
4. **Measurer** (`measure.ts`) — black-box: imports a directory, reports V8 heap delta
5. **Runner** (`stress-test.ts`) — orchestrates ceiling search across all variants

## Flags

| Flag | Description |
|------|-------------|
| `--count=N` | Single measurement at N endpoints (skips ceiling search) |
| `--slim` | Enable `{ schemaHelpers: false }` via ZODVEX_SLIM env var |
| `--mini` | Compile zod → zod/mini before measuring |
| `--budget=N` | MB budget for ceiling search (default: 64) |

## Architecture

Seeds are real zodvex code — not templates. When the library API changes, the seeds may need updating, but the measurement harness (compose/measure/runner) stays stable.

The `ZODVEX_SLIM` env var controls whether seeds pass `{ schemaHelpers: false }` to `defineZodModel`. The compiler handles the zod → mini transform. All configuration is via flags to the runner.
````

- [ ] **Step 5: Commit**

```bash
git add examples/stress-test/.gitignore examples/stress-test/legacy/ examples/stress-test/README.md package.json
git add -u examples/stress-test/  # capture removals from original locations
git commit -m "chore: move legacy stress test infrastructure to legacy/, update verify:examples and README"
```

---

### Task 7: End-to-end validation

Run the full ceiling search and verify results are reasonable.

**Files:** None — validation only

- [ ] **Step 1: Build zodvex** (measurer imports from built dist)

```bash
cd /path/to/zodvex
bun run build
```

- [ ] **Step 2: Run full ceiling search**

```bash
cd examples/stress-test
bun run stress-test
```

Expected: All 4 variants complete, report generated at `results/report.md`. Ceiling numbers should be in the right ballpark (zod ~150-200, mini ~300-400).

- [ ] **Step 3: Verify the report**

Check `results/report.md`:
- OOM Ceilings table has all 4 variants
- All Measurements table has data points from both coarse and fine passes
- Numbers are reasonable (not 0, not 500)

- [ ] **Step 4: Run ad-hoc measurement to spot-check**

```bash
bun run stress-test --count=100 --mini
```

Expected: Single measurement for "mini" at 100 endpoints. Number should match the corresponding point in the report (within ±5% for GC variance).

- [ ] **Step 5: Commit report**

```bash
git add examples/stress-test/results/
git commit -m "docs: add stress test harness validation results"
```

