/**
 * The side-by-side scenarios on the home page.
 *
 * Every snippet is written against the real APIs:
 *   - Convex:            `convex/server`, `convex/values`, `convex/react`
 *   - convex-helpers:    `convex-helpers/server/zod4`, `.../customFunctions`, `.../rowLevelSecurity`
 *   - zodvex:            `zodvex`, `zodvex/server`, generated `convex/_zodvex/client`
 *
 * Keep lines ≤ 74 characters so a snippet fits a half-width pane without scrolling.
 * `marks` are 1-based line numbers → 'bad' (friction) | 'good' (what zodvex does for you) | 'note'.
 */

export type Mark = 'bad' | 'good' | 'note'

export interface Snippet {
  /** File path shown in the panel header. */
  file: string
  lang?: 'ts' | 'tsx'
  code: string
  marks?: Record<number, Mark>
  /** Short bullets rendered under the code. */
  notes?: string[]
}

export interface Scenario {
  id: string
  title: string
  goal: string
  convex: Snippet
  /** `{ same: true }` means "identical to the plain Convex snippet" — rendered with a banner. */
  helpers: Snippet | { same: true; why: string }
  zodvex: Snippet
}

export const scenarios: Scenario[] = [
  // ───────────────────────────────────────────────────────────────────────────
  {
    id: 'schema',
    title: 'Define the table',
    goal: 'A task has a non-empty title, a status, an owner, and an optional due date.',
    convex: {
      file: 'convex/schema.ts',
      code: `import { defineSchema, defineTable } from 'convex/server'
import { v } from 'convex/values'

export default defineSchema({
  tasks: defineTable({
    title: v.string(),                // "non-empty" cannot be expressed
    status: v.union(v.literal('todo'), v.literal('done')),
    ownerId: v.id('users'),
    dueDate: v.optional(v.number()), // a Date stored as ms, by convention
    createdAt: v.number(),
  }).index('by_owner', ['ownerId']),
})`,
      marks: { 6: 'bad', 9: 'bad' },
      notes: [
        'Validators describe shape only. Anything beyond structure is a comment.',
        'Dates are numbers everywhere, and every reader has to remember that.',
      ],
    },
    helpers: {
      file: 'convex/schema.ts',
      code: `import { z } from 'zod'
import { defineSchema, defineTable } from 'convex/server'
import { zid, zodToConvexFields } from 'convex-helpers/server/zod4'

export const taskFields = {
  title: z.string().min(1),       // erased: the table sees v.string()
  status: z.enum(['todo', 'done']),
  ownerId: zid('users'),
  dueDate: z.number().optional(), // still ms: z.date() throws in the mapper
  createdAt: z.number(),
}

export default defineSchema({
  tasks: defineTable(zodToConvexFields(taskFields))
    .index('by_owner', ['ownerId']),
})`,
      marks: { 6: 'bad', 9: 'bad' },
      notes: [
        'You write Zod, but the table stores a lossy translation of it.',
        'No codecs: the schema cannot say “this number is a Date”.',
      ],
    },
    zodvex: {
      file: 'convex/models.ts · convex/schema.ts',
      code: `import { z } from 'zod'
import { zx, defineZodModel } from 'zodvex'

export const TaskModel = defineZodModel('tasks', {
  title: z.string().min(1),       // held on args, returns, db reads + writes
  status: z.enum(['todo', 'done']),
  ownerId: zx.id('users'),
  dueDate: zx.date().optional(),  // Date in your code, float64 in storage
  createdAt: zx.date(),
}).index('by_owner', ['ownerId'])

// convex/schema.ts
import { defineZodSchema } from 'zodvex/server'
import { TaskModel } from './models'

export default defineZodSchema({ tasks: TaskModel })`,
      marks: { 5: 'good', 8: 'good' },
      notes: [
        'The model is the schema. Refinements are kept, not translated away.',
        'Codecs live in the field definition, so every boundary agrees on what a Date is.',
        'defineZodModel is client-safe: import it in React for forms and types.',
      ],
    },
  },

  // ───────────────────────────────────────────────────────────────────────────
  {
    id: 'mutation',
    title: 'Write a mutation',
    goal: 'Create a task. Reject empty titles. Accept a due date.',
    convex: {
      file: 'convex/tasks.ts',
      code: `import { mutation } from './_generated/server'
import { v } from 'convex/values'

export const create = mutation({
  args: {
    title: v.string(),
    ownerId: v.id('users'),
    dueDate: v.optional(v.number()),
  },
  returns: v.id('tasks'),
  handler: async (ctx, args) => {
    // v.* checked the shape; everything else is on you
    if (args.title.trim() === '') throw new Error('title is required')
    return await ctx.db.insert('tasks', {
      ...args,
      status: 'todo',
      createdAt: Date.now(),
    })
  },
})`,
      marks: { 12: 'bad', 13: 'bad', 17: 'bad' },
      notes: [
        'Business rules become hand-written guards at the top of every handler.',
        'Timestamps are produced and consumed by hand, in every function.',
      ],
    },
    helpers: {
      file: 'convex/functions.ts · convex/tasks.ts',
      code: `import { zCustomMutation } from 'convex-helpers/server/zod4'
import { NoOp } from 'convex-helpers/server/customFunctions'
import { mutation } from './_generated/server'

export const zMutation = zCustomMutation(mutation, NoOp)

// convex/tasks.ts
import { z } from 'zod'
import { zid } from 'convex-helpers/server/zod4'
import { zMutation } from './functions'

export const create = zMutation({
  args: {
    title: z.string().min(1),       // Zod runs on args, a real win
    ownerId: zid('users'),
    dueDate: z.number().optional(), // but it is still a timestamp
  },
  returns: zid('tasks'),
  handler: async (ctx, args) =>
    ctx.db.insert('tasks', {        // the plain db: nothing is encoded
      ...args,
      status: 'todo',
      createdAt: Date.now(),
    }),
})`,
      marks: { 14: 'good', 16: 'bad', 20: 'bad', 23: 'bad' },
      notes: [
        'Arguments get the full Zod pipeline. That is where it stops.',
        'ctx.db is the plain Convex db: writes are not encoded, reads are not parsed.',
      ],
    },
    zodvex: {
      file: 'convex/tasks.ts',
      code: `import { z } from 'zod'
import { zx } from 'zodvex'
import { zm } from './functions'

export const create = zm({
  args: {
    title: z.string().min(1),       // full Zod pipeline on every call
    ownerId: zx.id('users'),
    dueDate: zx.date().optional(),  // arrives in the handler as a Date
  },
  returns: zx.id('tasks'),
  handler: async (ctx, args) =>
    ctx.db.insert('tasks', {        // encodes Date → number on write
      ...args,
      status: 'todo',
      createdAt: new Date(),
    }),
})`,
      marks: { 7: 'good', 9: 'good', 13: 'good', 16: 'good' },
      notes: [
        'Refinements, transforms and codecs all run before your handler sees args.',
        'The handler works in runtime types. The wire stays Convex-safe.',
        'zm comes from a one-time initZodvex call (see Get started).',
      ],
    },
  },

  // ───────────────────────────────────────────────────────────────────────────
  {
    id: 'read',
    title: 'Read from the database',
    goal: "List a user's overdue tasks.",
    convex: {
      file: 'convex/tasks.ts',
      code: `import { query } from './_generated/server'
import { v } from 'convex/values'
import schema from './schema'

// rebuild the document shape by hand
const taskDoc = v.object({
  ...schema.tables.tasks.validator.fields,
  _id: v.id('tasks'),
  _creationTime: v.number(),
})

export const overdue = query({
  args: { ownerId: v.id('users') },
  returns: v.array(taskDoc),
  handler: async (ctx, { ownerId }) => {
    const tasks = await ctx.db
      .query('tasks')
      .withIndex('by_owner', (q) => q.eq('ownerId', ownerId))
      .collect()
    // rows come back exactly as stored; nothing re-checks them
    const now = Date.now()
    return tasks.filter((t) => t.dueDate !== undefined && t.dueDate < now)
  },
})`,
      marks: { 5: 'bad', 6: 'bad', 7: 'bad', 20: 'bad', 22: 'bad' },
      notes: [
        'Return validators are assembled by hand from the table validator.',
        'A row written before a rule existed is served as-is, forever.',
      ],
    },
    helpers: {
      file: 'convex/tasks.ts',
      code: `import { z } from 'zod'
import { zid } from 'convex-helpers/server/zod4'
import { zQuery } from './functions'
import { taskFields } from './schema'

// still hand-assembled from the field map
const taskDoc = z.object({
  _id: zid('tasks'),
  _creationTime: z.number(),
  ...taskFields,
})

export const overdue = zQuery({
  args: { ownerId: zid('users') },
  returns: z.array(taskDoc),        // Zod checks the return value…
  handler: async (ctx, { ownerId }) => {
    const tasks = await ctx.db      // …but ctx.db is untouched: wire rows
      .query('tasks')
      .withIndex('by_owner', (q) => q.eq('ownerId', ownerId))
      .collect()
    const now = Date.now()
    return tasks.filter((t) => t.dueDate !== undefined && t.dueDate < now)
  },
})`,
      marks: { 6: 'bad', 7: 'bad', 15: 'good', 17: 'bad', 21: 'bad' },
      notes: [
        'The doc schema is still hand-assembled from the field map.',
        'Validation happens at the function edge; the db in the middle is a black box.',
      ],
    },
    zodvex: {
      file: 'convex/tasks.ts',
      code: `import { zx } from 'zodvex'
import { zq } from './functions'
import { TaskModel } from './models'

export const overdue = zq({
  args: { ownerId: zx.id('users') },
  returns: zx.docArray(TaskModel),  // derived from the model
  handler: async (ctx, { ownerId }) => {
    const tasks = await ctx.db      // every row parsed through TaskModel
      .query('tasks')
      .withIndex('by_owner', (q) => q.eq('ownerId', ownerId))
      .collect()
    const now = new Date()          // dueDate is a Date, so compare Dates
    return tasks.filter((t) => t.dueDate !== undefined && t.dueDate < now)
  },
})`,
      marks: { 7: 'good', 9: 'good', 13: 'good', 14: 'good' },
      notes: [
        'zx.doc / zx.docArray / zx.update derive function schemas from the model.',
        'Reads are a real Zod parse, so the db boundary is validated too.',
        'Index range values are encoded as well: q.gte("createdAt", someDate) just works.',
      ],
    },
  },

  // ───────────────────────────────────────────────────────────────────────────
  {
    id: 'client',
    title: 'Call it from React',
    goal: 'Show due dates in the UI and create tasks from a form.',
    convex: {
      file: 'src/Tasks.tsx',
      lang: 'tsx',
      code: `import { useMutation, useQuery } from 'convex/react'
import { api } from '../convex/_generated/api'

export function Tasks({ ownerId }: { ownerId: Id<'users'> }) {
  const tasks = useQuery(api.tasks.overdue, { ownerId })
  const create = useMutation(api.tasks.create)
  // title: string, picked: Date — from form state

  const add = () =>
    create({ title, ownerId, dueDate: picked.getTime() }) // by hand…

  return (
    <ul>
      {tasks?.map((t) => (
        <li key={t._id}>
          {t.title} · due {new Date(t.dueDate!).toLocaleDateString()}
        </li>
      ))}
    </ul>                                      {/* …and decode by hand */}
  )
}`,
      marks: { 10: 'bad', 16: 'bad' },
      notes: [
        'Types are inferred, but the values are wire values: ms timestamps, plain strings.',
        'An empty title round-trips to the server before anyone finds out.',
      ],
    },
    helpers: {
      same: true,
      why: 'convex-helpers/zod validates inside the function. The wire format and the React hooks are exactly what plain Convex gives you, so this file does not change.',
    },
    zodvex: {
      file: 'src/Tasks.tsx',
      lang: 'tsx',
      code: `import { useZodMutation, useZodQuery } from '../convex/_zodvex/client'
import { api } from '../convex/_generated/api'

export function Tasks({ ownerId }: { ownerId: Id<'users'> }) {
  const tasks = useZodQuery(api.tasks.overdue, { ownerId })  // decoded
  const create = useZodMutation(api.tasks.create)  // validated + encoded
  // title: string, picked: Date — from form state

  const add = () =>
    create({ title, ownerId, dueDate: picked })  // a Date, like the server

  return (
    <ul>
      {tasks?.map((t) => (
        <li key={t._id}>
          {t.title} · due {t.dueDate?.toLocaleDateString()}
        </li>
      ))}
    </ul>
  )
}`,
      marks: { 5: 'good', 6: 'good', 10: 'good', 16: 'good' },
      notes: [
        'zodvex generate emits convex/_zodvex/client with hooks bound to your functions.',
        'Args fail fast on the client with a ZodError you can map to form fields.',
        'Results arrive as Date objects and branded IDs: the same types the handler returned.',
      ],
    },
  },

  // ───────────────────────────────────────────────────────────────────────────
  {
    id: 'rules',
    title: 'Row-level rules and audit',
    goal: 'Only return tasks the caller owns, and log every read.',
    convex: {
      file: 'convex/tasks.ts',
      code: `import { query } from './_generated/server'
import { getUserOrThrow } from './auth'

export const mine = query({
  args: {},
  handler: async (ctx) => {
    const user = await getUserOrThrow(ctx)
    const tasks = await ctx.db.query('tasks').collect()
    // remember this filter in every function that touches tasks
    const own = tasks.filter((t) => t.ownerId === user._id)
    for (const t of own) console.log('read', 'tasks', t._id)
    return own
  },
})`,
      marks: { 9: 'bad', 10: 'bad', 11: 'bad' },
      notes: [
        'Access control is a convention, enforced by code review.',
        'Auditing is more loops in more handlers.',
      ],
    },
    helpers: {
      file: 'convex/functions.ts · convex/tasks.ts',
      code: `import { zCustomQuery } from 'convex-helpers/server/zod4'
import { customCtx } from 'convex-helpers/server/customFunctions'
import { wrapDatabaseReader } from 'convex-helpers/server/rowLevelSecurity'
import { query } from './_generated/server'
import { getUserOrThrow } from './auth'

export const zQuery = zCustomQuery(
  query,
  customCtx(async (ctx) => {
    const user = await getUserOrThrow(ctx)
    const rules = {                 // rules see raw wire docs
      tasks: { read: async (_c, doc) => doc.ownerId === user._id },
    }
    return { user, db: wrapDatabaseReader({ user }, ctx.db, rules) }
  }),
)

// convex/tasks.ts — audit is still your problem
export const mine = zQuery({
  args: {},
  handler: async (ctx) => ctx.db.query('tasks').collect(),
})`,
      marks: { 11: 'bad', 12: 'bad', 14: 'note', 18: 'bad' },
      notes: [
        'Rules are a separate wrapper you compose with the Zod wrapper yourself.',
        'Rules see stored values, so any date logic inside them is timestamp math.',
      ],
    },
    zodvex: {
      file: 'convex/tasks.ts',
      code: `import { zx } from 'zodvex'
import { zq } from './functions'
import { TaskModel } from './models'
import { getUserOrThrow } from './auth'

export const mine = zq({
  args: {},
  returns: zx.docArray(TaskModel),
  handler: async (ctx) => {
    const user = await getUserOrThrow(ctx)
    const db = ctx.db
      .withRules({ user }, {        // rules see decoded docs
        tasks: {
          read: async (r, doc) => (doc.ownerId === r.user._id ? doc : null),
        },
      })
      .audit({ afterRead: (table, doc) => log.read(table, doc._id) })
    return await db.query('tasks').collect()
  },
})`,
      marks: { 12: 'good', 14: 'good', 17: 'good' },
      notes: [
        'Rules and audit ride on the same codec-aware ctx.db: decoded docs, typed IDs, Dates.',
        'Pipeline order is fixed: raw db → decode → rules → audit → your handler.',
        'Deny-by-default is one option away: { defaultPolicy: "deny" }.',
      ],
    },
  },
]
