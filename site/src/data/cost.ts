/**
 * "What it costs" — one concrete goal, and the code each approach makes you
 * write at every place the value passes through.
 *
 * Effort:  manual  = you write it, in every function that touches the value
 *          partial = you get some of it, the rest is on you
 *          auto    = declared once, handled everywhere
 *
 * Facts behind the do-it-yourself column (convex-helpers/server/zod4, 0.1.123):
 *  - zodToConvex maps a Zod pipe/codec to its *input* side, so a
 *    z.codec(z.number(), z.date()) field becomes v.float64() and zCustomMutation
 *    parses args → the handler receives a Date. That part is real.
 *  - `returns` is parsed (wire → runtime), not encoded, and its Convex validator
 *    is built from the *output* side (z.date() → "not supported"). A codec in
 *    returns cannot work; you declare wire shape and encode by hand.
 *  - ctx.db, index ranges, runQuery / scheduler, and useQuery are untouched.
 */

export type Effort = 'manual' | 'partial' | 'auto'

export interface CostCell {
  effort: Effort
  code?: string
  note: string
}

export interface CostRow {
  step: string
  convex: CostCell
  diy: CostCell
  zodvex: CostCell
}

export interface CostGoal {
  id: string
  title: string
  goal: string
  rows: CostRow[]
}

export const effortLabel: Record<Effort, string> = {
  manual: 'by hand',
  partial: 'partly',
  auto: 'automatic',
}

export const dateGoal: CostGoal = {
  id: 'dates',
  title: 'A real Date',
  goal: 'Store a task’s due date, and work with it as a Date everywhere: in handlers, in queries, and in React.',
  rows: [
    {
      step: 'Declare the field',
      convex: {
        effort: 'manual',
        code: "dueDate: v.number()",
        note: 'Milliseconds. That it is a date lives in your head and in a comment.',
      },
      diy: {
        effort: 'partial',
        code: 'z.codec(z.number(), z.date(), …)',
        note: 'The codec gives args a Date. The table still maps to v.float64() and every other boundary sees the number.',
      },
      zodvex: {
        effort: 'auto',
        code: 'dueDate: zx.date()',
        note: 'One field. Wire float64, runtime Date, at every boundary below.',
      },
    },
    {
      step: 'Receive it as an argument',
      convex: {
        effort: 'manual',
        code: 'new Date(args.dueDate)',
        note: 'At the top of every handler that wants a Date.',
      },
      diy: {
        effort: 'auto',
        code: 'args.dueDate  // Date',
        note: 'zCustomMutation parses args, so the codec decodes. This is the one boundary the do-it-yourself route gets for free.',
      },
      zodvex: {
        effort: 'auto',
        code: 'args.dueDate  // Date',
        note: 'Same: the full Zod pipeline runs on args.',
      },
    },
    {
      step: 'Write it to the database',
      convex: {
        effort: 'manual',
        code: 'dueDate: date.getTime()',
        note: 'Back to a number before every insert, patch and replace.',
      },
      diy: {
        effort: 'manual',
        code: 'dueDate: args.dueDate.getTime()',
        note: 'ctx.db is the plain writer. Encode by hand, and the Doc type is still number.',
      },
      zodvex: {
        effort: 'auto',
        code: "ctx.db.insert('tasks', args)",
        note: 'ctx.db encodes through the model on every write.',
      },
    },
    {
      step: 'Read it back',
      convex: {
        effort: 'manual',
        code: 'new Date(task.dueDate)',
        note: "At every use site. Doc<'tasks'> says number, so nothing reminds you.",
      },
      diy: {
        effort: 'manual',
        code: 'taskSchema.parse(doc)',
        note: 'Decode after every get, collect and paginate, and cast or re-type the result yourself.',
      },
      zodvex: {
        effort: 'auto',
        code: 'task.dueDate  // Date',
        note: 'Every row is parsed through TaskModel on read. The type says Date because it is one.',
      },
    },
    {
      step: 'Query by it',
      convex: {
        effort: 'manual',
        code: "q.gte('dueDate', since.getTime())",
        note: 'Index and filter values are wire values.',
      },
      diy: {
        effort: 'manual',
        code: "q.gte('dueDate', since.getTime())",
        note: 'Nothing sits between you and the index builder.',
      },
      zodvex: {
        effort: 'auto',
        code: "q.gte('dueDate', since)",
        note: 'Index range and filter values are encoded through the field’s schema.',
      },
    },
    {
      step: 'Return it',
      convex: {
        effort: 'manual',
        code: 'returns: v.number()',
        note: 'Wire shape out. Whoever calls you converts.',
      },
      diy: {
        effort: 'manual',
        code: 'returns: z.number()  // not the codec',
        note: 'Returns are parsed, not encoded, and the Convex validator is built from the Date side, so a codec here breaks. Declare wire shape and call getTime() yourself.',
      },
      zodvex: {
        effort: 'auto',
        code: 'returns: zx.docArray(TaskModel)',
        note: 'The handler returns Dates. zodvex encodes them for the wire.',
      },
    },
    {
      step: 'Show it in React',
      convex: {
        effort: 'manual',
        code: 'new Date(t.dueDate)',
        note: 'In every component that renders one.',
      },
      diy: {
        effort: 'manual',
        code: 'new Date(t.dueDate)',
        note: 'useQuery knows nothing about your Zod schemas, and the server sent a number anyway.',
      },
      zodvex: {
        effort: 'auto',
        code: 't.dueDate.toLocaleDateString()',
        note: 'useZodQuery decodes with the same returns schema the server used.',
      },
    },
    {
      step: 'Send it from a form',
      convex: {
        effort: 'manual',
        code: 'dueDate: picked.getTime()',
        note: 'And validate the title yourself, or ship it and let the server reject it.',
      },
      diy: {
        effort: 'manual',
        code: 'dueDate: picked.getTime()',
        note: 'The client has no codec unless you build a registry it can import.',
      },
      zodvex: {
        effort: 'auto',
        code: 'create({ …, dueDate: picked })',
        note: 'useZodMutation validates and encodes before the call leaves the browser.',
      },
    },
    {
      step: 'Pass it to another function or the scheduler',
      convex: {
        effort: 'manual',
        code: "runAfter(0, fn, { dueDate: d.getTime() })",
        note: 'Wire values across every internal call.',
      },
      diy: {
        effort: 'manual',
        code: "runAfter(0, fn, { dueDate: d.getTime() })",
        note: 'Encode on the way out; the receiving function’s codec decodes on the way in.',
      },
      zodvex: {
        effort: 'auto',
        code: 'runAfter(0, fn, { dueDate: d })',
        note: 'With the registry wired, runQuery, runMutation and the scheduler encode args.',
      },
    },
    {
      step: 'Rows you did not write',
      convex: {
        effort: 'manual',
        note: 'A migration, a dashboard edit or an older function can leave a value no code ever checks. It flows into handlers and the UI as-is.',
      },
      diy: {
        effort: 'partial',
        note: 'Only the rows you remembered to parse. Everything else is served exactly as stored.',
      },
      zodvex: {
        effort: 'auto',
        note: 'Every read is a real Zod parse. A row that breaks the schema fails loudly with the field named, instead of reaching a handler.',
      },
    },
  ],
}

/** Places you write conversion code for this goal, per approach. */
export function tally(goal: CostGoal) {
  const count = (k: 'convex' | 'diy' | 'zodvex', e: Effort) =>
    goal.rows.filter((r) => r[k].effort === e).length
  return {
    convex: { manual: count('convex', 'manual'), partial: count('convex', 'partial') },
    diy: { manual: count('diy', 'manual'), partial: count('diy', 'partial') },
    zodvex: { manual: count('zodvex', 'manual'), partial: count('zodvex', 'partial') },
  }
}

/* ────────────────────────────────────────────────────────────────────────
   Outcomes vs. effort — the same three approaches, by what you want.
   ──────────────────────────────────────────────────────────────────────── */

export interface OutcomeRow {
  outcome: string
  convex: CostCell
  diy: CostCell
  zodvex: CostCell
}

export const outcomes: OutcomeRow[] = [
  {
    outcome: 'A Date is a Date everywhere',
    convex: { effort: 'manual', note: 'Convert at roughly nine places per field: args, writes, reads, index ranges, returns, internal calls, React, forms.' },
    diy: { effort: 'partial', note: 'A codec decodes args. The database, returns, internal calls and the client still see the number.' },
    zodvex: { effort: 'auto', note: 'zx.date() once. Handlers, queries, returns, internal calls and React all work in Dates.' },
  },
  {
    outcome: 'A custom type (money, encrypted, tagged) is real in code',
    convex: { effort: 'manual', note: 'Store the wire form and convert it wherever it appears.' },
    diy: { effort: 'partial', note: 'Same as dates: the codec helps at args only, and you encode and decode at every other boundary.' },
    zodvex: { effort: 'auto', note: 'zx.codec(wire, runtime, transforms) once. Same guarantees as zx.date().' },
  },
  {
    outcome: 'A rule like .email() or .min(1) runs everywhere',
    convex: { effort: 'manual', note: 'Not expressible in v.*. A guard at the top of each handler, and again in each form.' },
    diy: { effort: 'partial', note: 'Runs on args and returns. Not on what the database hands back, and not in the client without a registry.' },
    zodvex: { effort: 'auto', note: 'Runs on args, returns, writes, reads and in useZodMutation before the call is sent.' },
  },
  {
    outcome: 'A table’s shape is written once',
    convex: { effort: 'manual', note: 'The table validator, a hand-built doc validator for returns, and a Zod schema for forms drift independently.' },
    diy: { effort: 'partial', note: 'Zod fields feed the table, but the doc schema with _id and _creationTime is still assembled by hand.' },
    zodvex: { effort: 'auto', note: 'defineZodModel is the only copy. zx.doc, zx.docArray, zx.update and zx.base derive the rest.' },
  },
  {
    outcome: 'Rules hold for data you did not write',
    convex: { effort: 'manual', note: 'Convex checks shape on write. Anything else is only as good as the code that wrote the row.' },
    diy: { effort: 'manual', note: 'Same, unless you parse every read yourself.' },
    zodvex: { effort: 'auto', note: 'Every read parses. Bad rows fail with the field named instead of reaching the UI.' },
  },
  {
    outcome: 'Row access rules and audit see real types',
    convex: { effort: 'manual', note: 'Filters and logging repeated in each handler.' },
    diy: { effort: 'partial', note: 'rowLevelSecurity wraps the db, but its rules see stored values and compose with the Zod wrapper by hand.' },
    zodvex: { effort: 'auto', note: '.withRules() and .audit() on ctx.db, on decoded documents, in a fixed order.' },
  },
]

/** What a general do-it-yourself solution has to include. This is the library. */
export const diyChecklist = [
  ['A typed wrapper around ctx.db', 'get, query, withIndex, filter, paginate, insert, patch, replace, delete, with TypeScript types mapped from the wire DataModel to decoded documents.'],
  ['Encoding for index ranges and filters', 'q.eq / q.gte / q.lt values must be encoded through the field schema, including fields inside unions.'],
  ['Codec-aware runQuery, runMutation and scheduler', 'Encode args on the way out and decode results on the way in, per function.'],
  ['A client-safe registry of every function’s schemas', 'So React hooks and non-React clients can encode args and decode results without importing server code.'],
  ['Exact optional and nullable semantics', 'z.optional → v.optional, z.nullable → v.union(T, v.null()), and both together, preserved through every helper.'],
  ['Rules, audit, streams and triggers on top of all of it', 'Access rules that see decoded documents, audit hooks, honest pagination across substreams, and ctx.db wrappers that stack with convex-helpers triggers.'],
] as const
