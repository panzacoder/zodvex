# Row-Level Rules & Audit

Gate and transform database access per row, and observe reads and writes — both on the
codec-aware `ctx.db`, operating on **decoded** documents (`Date` objects, typed IDs), not
wire values.

When you set up builders with [`initZodvex`](./builders.md), `ctx.db` is wrapped so codecs
decode on read and encode on write. `.withRules()` and `.audit()` are additional layers on
that same wrapped db: they see the decoded representation, and they compose with each other.

> **Heads up (API evolution):** the chainable `ctx.db.withRules(...).audit(...)` form
> documented here is the current (0.7.x) API. A future release (targeted 0.8) is expected to
> move these to *applied* free functions — `audit(withRules(ctx.db, ctx, rules), { … })` — to
> match Convex's own `wrapDatabaseReader` shape. The behavior and rule/audit shapes below
> stay the same; only the call form changes.

## Row-level rules — `.withRules()`

```ts
ctx.db.withRules(ruleCtx, rules, config?)
```

- **`ruleCtx`** — any value your rules close over (e.g. the current user id). It's passed to
  every rule as the first argument.
- **`rules`** — a per-table map of rules keyed by operation.
- **`config`** (optional) — `{ defaultPolicy?: 'allow' | 'deny', allowCounting?: boolean }`.

`.withRules()` returns a reader or writer of the same type, so it chains (with `.audit()`, or
another `.withRules()`).

### Read rules

A `read` rule runs for every document the query returns. Return the doc to allow it, `null`
(or `false`) to filter it out, or a modified doc to transform what the caller sees.

```ts
export const listOwnTasks = zq({
  args: { ownerId: zx.id('users') },
  handler: async (ctx, { ownerId }) => {
    const secureDb = ctx.db.withRules(
      { ownerId },
      {
        tasks: {
          // doc is fully decoded — dates are Date, ids are branded
          read: async (rule: { ownerId: string }, doc) =>
            doc.assigneeId === rule.ownerId ? doc : null,
        },
      },
    )
    return await secureDb.query('tasks').collect() // only the owner's tasks
  },
  returns: z.array(TaskModel.schema.doc),
})
```

### Write rules

Write rules gate `insert` / `patch` / `replace` / `delete`. Return the (optionally
transformed) value to allow; **throw to deny**.

```ts
export const updateOwnTask = zm({
  args: { taskId: zx.id('tasks'), title: z.string().optional(), actorId: zx.id('users') },
  handler: async (ctx, { taskId, title, actorId }) => {
    const secureDb = ctx.db.withRules(
      { actorId },
      {
        tasks: {
          patch: async (rule: { actorId: string }, doc, value) => {
            if (doc.assigneeId !== rule.actorId) throw new Error('Not your task')
            return value // could also transform the patch here
          },
        },
      },
    )
    await secureDb.patch(taskId, title !== undefined ? { title } : {})
  },
})
```

Rule signatures (all receive `ruleCtx` first; docs/values are decoded):

| Operation | Signature | Allow / deny |
| --- | --- | --- |
| `read` | `(ctx, doc) => doc \| null \| boolean` | return doc/`true` to allow, `null`/`false` to hide, a doc to transform |
| `insert` | `(ctx, value) => value` | return value (maybe transformed); **throw** to deny |
| `patch` | `(ctx, doc, value) => partial` | return patch; **throw** to deny |
| `replace` | `(ctx, doc, value) => value` | return replacement; **throw** to deny |
| `delete` | `(ctx, doc) => void` | **throw** to deny |

### Default policy

With `defaultPolicy: 'deny'`, **every** table is denied unless it has a matching rule —
including tables you didn't mention. This gives you a deny-by-default posture where access is
explicitly granted per table/operation.

```ts
ctx.db.withRules(ruleCtx, { tasks: { read: … } }, { defaultPolicy: 'deny' })
// reads/writes to any table other than an allowed tasks.read now throw
```

`allowCounting` (default `false`) controls whether `.count()` is permitted while rules are
active — counting can bypass per-row `read` filtering, so it's opt-in.

## Audit — `.audit()`

`.audit(config)` returns a wrapped db that fires callbacks after successful operations. It
sees the same decoded docs, and (when chained after `.withRules()`) only the docs/writes that
the rules allowed.

```ts
const auditedDb = ctx.db.audit({
  afterRead: (table, doc) => log.read(table, doc._id),
  afterWrite: (table, event) => log.write(table, event),
})
```

- **`afterRead(table, doc)`** — fires once per document returned by `get()` / `query()`
  terminals. Does not fire for a `get()` that returns `null`.
- **`afterWrite(table, event)`** — fires after a successful write. `event` is a discriminated
  union carrying decoded types:

  ```ts
  | { type: 'insert';  id; value }        // value = decoded insert doc
  | { type: 'patch';   id; doc; value }   // doc = prior decoded doc, value = decoded patch
  | { type: 'replace'; id; doc; value }
  | { type: 'delete';  id; doc }
  ```

`afterRead` is available on both readers and writers; `afterWrite` only on writers.

## Composing rules + audit

Both layers wrap the same codec-aware db and return the same type, so order is up to you.
Chaining `.withRules().audit()` means **audit observes only what the rules allowed**:

```ts
const db = ctx.db
  .withRules({ ownerId }, { tasks: { read: async (r, d) => (d.ownerId === r.ownerId ? d : null) } })
  .audit({ afterRead: (t, doc) => log.read(t, doc._id) })

await db.query('tasks').collect()
// codec decode → rules filter → audit fires per surviving doc
```

The pipeline is always: **raw db → codec decode → rules → audit → your handler**. Because
rules and audit sit above the codec layer, they never deal with wire formats — a `patch` rule
compares a branded `assigneeId`, an `afterWrite` event carries a decoded `value`.

## See also

- [Builders](./builders.md) — `initZodvex` and the codec-aware `ctx.db`
- [Custom Context](./custom-context.md) — attach auth/user to `ctx` with `.withContext()`
- [Streams](./streams.md) — `zodvexStream` runs over the same secure, rules-preserving reader
