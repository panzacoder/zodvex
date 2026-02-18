# Plan 2: Redesign `initZodvex` to Delegate to `customFnBuilder`

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the broken `buildHandler` in `init.ts` with proper delegation to `customFnBuilder`, so all builders from `initZodvex` get full Zod validation, codec encoding, and correct pipeline ordering.

**Architecture:** `initZodvex` currently uses `buildHandler` which reimplements `customFnBuilder` but skips ALL Zod processing. The fix: `initZodvex` creates an internal `Customization` that wraps `ctx.db` with the codec layer, then passes it to `zCustomQuery`/`zCustomMutation`/`zCustomAction` from `src/custom.ts`. The `zCustomQuery` result becomes the base builder. Blessed builders are created by calling `zCustomQuery` with a composed customization (codec wrapping + user's custom ctx).

**Tech Stack:** TypeScript, Zod v4, Bun test runner, convex-helpers

**Prerequisite:** Plan 1 (pipeline ordering fix) must be complete.

**Prerequisite reading:**
- `docs/plans/2026-02-17-zodvex-v2-redesign.md` (Sections: API Surface, Pipeline Design)
- `src/custom.ts` — `customFnBuilder`, `zCustomQuery`, `zCustomMutation`, `zCustomAction`
- `src/init.ts` — current `buildHandler`, `initZodvex`
- `src/db/wrapper.ts` — `createZodDbReader`, `createZodDbWriter`
- `node_modules/convex-helpers/server/customFunctions.ts` — `Customization` type, `customCtx`

---

### Task 1: Write tests for the core problem — `initZodvex` builders have no Zod validation

Prove that the current `initZodvex` builders skip Zod arg validation and returns encoding.

**Files:**
- Modify: `__tests__/init.test.ts`

**Step 1: Write the failing tests**

Add to the existing describe block in `__tests__/init.test.ts`:

```typescript
  it('zq validates args with Zod (rejects invalid args)', async () => {
    const { zq } = initZodvex(schema, server as any)
    const fn = zq({
      args: { title: z.string().min(3) },
      handler: async (_ctx: any, { title }: any) => title
    })

    // Should throw validation error — "ab" is too short (min 3)
    await expect(fn.handler({}, { title: 'ab' })).rejects.toThrow()
  })

  it('zq encodes return values through Zod returns schema', async () => {
    const { zq } = initZodvex(schema, server as any)
    const fn = zq({
      args: {},
      returns: z.object({ when: zx.date() }),
      handler: async () => ({ when: new Date('2025-06-15T00:00:00Z') })
    })

    const result = await fn.handler({}, {})
    // Should be encoded to timestamp, not a Date
    expect(typeof result.when).toBe('number')
  })

  it('zm validates args with Zod', async () => {
    const { zm } = initZodvex(schema, server as any)
    const fn = zm({
      args: { email: z.string().email() },
      handler: async (_ctx: any, { email }: any) => email
    })

    // Should throw — "not-an-email" isn't valid
    await expect(fn.handler({}, { email: 'not-an-email' })).rejects.toThrow()
  })
```

**Step 2: Run the tests to verify they fail**

Run: `bun test __tests__/init.test.ts`
Expected: FAIL — current `buildHandler` passes args straight through without Zod validation, and returns are not encoded.

**Step 3: Commit the failing tests**

```bash
git add __tests__/init.test.ts
git commit -m "test: add failing tests proving initZodvex builders skip Zod validation"
```

---

### Task 2: Rewrite `initZodvex` to use `customFnBuilder` via internal customization

This is the core fix. Replace `buildHandler` + `createQueryBuilder` + `createMutationBuilder` + `createActionBuilder` with functions that delegate to `zCustomQuery`/`zCustomMutation`/`zCustomAction`.

**Files:**
- Modify: `src/init.ts`

**Step 1: Understand the target architecture**

`initZodvex(schema, server)` should:

1. Create a base `Customization` that wraps `ctx.db` with codec-aware reader/writer
2. Pass that customization to `zCustomQuery(server.query, codecCustomization)` to get the base `zQuery` builder
3. Return `zQuery`, `zMutation`, `zAction` (and internal variants) as the base builders
4. Return `zCustomQuery`, `zCustomMutation`, `zCustomAction` partially applied with schema for creating blessed builders

**Step 2: Rewrite `src/init.ts`**

Replace the entire file content:

```typescript
import type {
  ActionBuilder,
  FunctionVisibility,
  GenericDataModel,
  MutationBuilder,
  QueryBuilder
} from 'convex/server'
import { customCtx } from 'convex-helpers/server/customFunctions'
import type { Customization } from 'convex-helpers/server/customFunctions'
import { zCustomQuery, zCustomMutation, zCustomAction } from './custom'
import { createZodDbReader, createZodDbWriter } from './db/wrapper'

type ZodTables = Record<string, { name: string; table: any; schema: { doc: any; base: any } }>

type ZodSchema = {
  tables: Record<string, any>
  zodTables: ZodTables
}

type Server<DataModel extends GenericDataModel> = {
  query: QueryBuilder<DataModel, 'public'>
  internalQuery: QueryBuilder<DataModel, 'internal'>
  mutation: MutationBuilder<DataModel, 'public'>
  internalMutation: MutationBuilder<DataModel, 'internal'>
  action: ActionBuilder<DataModel, 'public'>
  internalAction: ActionBuilder<DataModel, 'internal'>
}

/**
 * One-time setup that creates codec-aware builders for your Convex project.
 *
 * Each returned query/mutation builder automatically wraps `ctx.db` with a
 * codec-aware layer that decodes reads (wire -> runtime, e.g. timestamps -> Dates)
 * and encodes writes (runtime -> wire) using your zodTable schemas.
 *
 * Action builders do NOT wrap ctx.db (actions have no database access in Convex).
 *
 * All builders include full Zod validation: args parsing, returns encoding,
 * Zod -> Convex validator conversion, and `stripUndefined`.
 *
 * @param schema - Schema from `defineZodSchema()` containing zodTable refs
 * @param server - Convex server functions (`query`, `mutation`, `action`, and internal variants)
 * @returns Pre-configured builders and blessed-builder factories
 *
 * @example
 * ```ts
 * import { initZodvex, defineZodSchema, zodTable } from 'zodvex/server'
 * import { customCtx } from 'convex-helpers/server/customFunctions'
 * import * as server from './_generated/server'
 *
 * const schema = defineZodSchema({ users: Users, events: Events })
 *
 * export const {
 *   zQuery, zMutation, zAction,
 *   zCustomQuery, zCustomMutation, zCustomAction,
 * } = initZodvex(schema, server)
 *
 * // Basic query — ctx.db auto-decodes
 * export const getEvent = zQuery({
 *   args: { id: zx.id('events') },
 *   returns: Events.schema.doc.nullable(),
 *   handler: async (ctx, { id }) => ctx.db.get(id),
 * })
 *
 * // Blessed builder with auth context
 * const hotpotQuery = zCustomQuery(
 *   customCtx(async (ctx) => {
 *     const user = await getUser(ctx)
 *     const db = createSecureReader({ user }, ctx.db, securityRules)
 *     return { user, db }
 *   })
 * )
 * ```
 */
export function initZodvex<DataModel extends GenericDataModel>(
  schema: ZodSchema,
  server: Server<DataModel>
) {
  const zodTables = schema.zodTables

  // --- Internal codec customization ---
  // Wraps ctx.db with codec-aware reader (for queries) or writer (for mutations).
  // This is the invisible codec layer that makes ctx.db return Date, etc.

  const codecQueryCustomization = customCtx((ctx: any) => ({
    db: createZodDbReader(ctx.db, zodTables)
  }))

  const codecMutationCustomization = customCtx((ctx: any) => ({
    db: createZodDbWriter(ctx.db, zodTables)
  }))

  // --- Base builders (codec-aware, Zod-validated) ---
  // These are equivalent to Convex's `query`/`mutation`/`action` but with codecs.

  const zQuery = zCustomQuery(server.query, codecQueryCustomization)
  const zMutation = zCustomMutation(server.mutation, codecMutationCustomization)
  const zAction = zCustomAction(server.action, { args: {}, input: async () => ({ ctx: {}, args: {} }) })
  const zInternalQuery = zCustomQuery(server.internalQuery, codecQueryCustomization)
  const zInternalMutation = zCustomMutation(server.internalMutation, codecMutationCustomization)
  const zInternalAction = zCustomAction(server.internalAction, { args: {}, input: async () => ({ ctx: {}, args: {} }) })

  // --- Blessed builder factories ---
  // Pre-bind schema so consumers just pass their customization.
  // These create "blessed builders" (hotpotQuery, hotpotMutation, etc.)
  //
  // The consumer's customization composes ON TOP of the codec customization.
  // Their ctx.db is already codec-aware by the time their input() runs.

  function makeZCustomQuery(customization: Customization<any, any, any, any, any>) {
    // Compose: codec wrapping first, then consumer's customization on top
    const composed = {
      args: customization.args ?? {},
      input: async (ctx: any, args: any, extra: any) => {
        // Step 1: wrap db with codecs
        const codecCtx = { ...ctx, db: createZodDbReader(ctx.db, zodTables) }
        // Step 2: run consumer's customization (sees codec-aware db)
        if (customization.input) {
          const added = await customization.input(codecCtx, args, extra)
          return added
        }
        return { ctx: { db: codecCtx.db }, args: {} }
      }
    }
    return zCustomQuery(server.query, composed as any)
  }

  function makeZCustomMutation(customization: Customization<any, any, any, any, any>) {
    const composed = {
      args: customization.args ?? {},
      input: async (ctx: any, args: any, extra: any) => {
        const codecCtx = { ...ctx, db: createZodDbWriter(ctx.db, zodTables) }
        if (customization.input) {
          return customization.input(codecCtx, args, extra)
        }
        return { ctx: { db: codecCtx.db }, args: {} }
      }
    }
    return zCustomMutation(server.mutation, composed as any)
  }

  function makeZCustomAction(customization: Customization<any, any, any, any, any>) {
    return zCustomAction(server.action, customization)
  }

  return {
    // Base builders (codec-aware)
    zQuery,
    zMutation,
    zAction,
    zInternalQuery,
    zInternalMutation,
    zInternalAction,

    // Blessed builder factories
    zCustomQuery: makeZCustomQuery,
    zCustomMutation: makeZCustomMutation,
    zCustomAction: makeZCustomAction,
  }
}
```

**Step 3: Run the tests**

Run: `bun test __tests__/init.test.ts`
Expected: All tests pass — including the new Zod validation tests from Task 1.

**Step 4: Run the full test suite**

Run: `bun test`
Expected: All pass. Some existing tests may need minor adjustments due to the changed mock server interface (the new builders go through `customFnBuilder` which expects Convex builder shape).

**Step 5: Commit**

```bash
git add src/init.ts
git commit -m "refactor: rewrite initZodvex to delegate to customFnBuilder (fixes zero-validation bug)"
```

---

### Task 3: Update the existing init tests for the new API shape

The existing tests in `__tests__/init.test.ts` test `.withContext()` and `.withHooks()` which no longer exist. Update them for the new API.

**Files:**
- Modify: `__tests__/init.test.ts`

**Step 1: Update the tests**

The new API returns `{ zQuery, zMutation, zAction, zCustomQuery, zCustomMutation, zCustomAction, zInternalQuery, zInternalMutation, zInternalAction }`.

Key changes:
- `zq` is now `zQuery` (renamed to match Convex conventions)
- `.withContext()` and `.withHooks()` are gone — use `zCustomQuery(customization)` instead
- `zCustomCtx` and `zCustomCtxWithArgs` are gone — use `customCtx` from convex-helpers

Replace the test file with updated tests:

```typescript
import { describe, expect, it } from 'bun:test'
import { z } from 'zod'
import { customCtx } from 'convex-helpers/server/customFunctions'
import { initZodvex } from '../src/init'
import { defineZodSchema } from '../src/schema'
import { zodTable } from '../src/tables'
import { zx } from '../src/zx'

const Events = zodTable('events', {
  title: z.string(),
  startDate: zx.date()
})

const Users = zodTable('users', {
  name: z.string(),
  email: z.string()
})

const schema = defineZodSchema({ events: Events, users: Users })

// Mock server — must return the config object (mimicking Convex builder)
const server = {
  query: (config: any) => config,
  mutation: (config: any) => config,
  action: (config: any) => config,
  internalQuery: (config: any) => config,
  internalMutation: (config: any) => config,
  internalAction: (config: any) => config
}

describe('initZodvex', () => {
  it('returns all expected builders', () => {
    const result = initZodvex(schema, server as any)
    expect(result.zQuery).toBeDefined()
    expect(result.zMutation).toBeDefined()
    expect(result.zAction).toBeDefined()
    expect(result.zInternalQuery).toBeDefined()
    expect(result.zInternalMutation).toBeDefined()
    expect(result.zInternalAction).toBeDefined()
    expect(result.zCustomQuery).toBeDefined()
    expect(result.zCustomMutation).toBeDefined()
    expect(result.zCustomAction).toBeDefined()
  })

  it('zQuery produces a registered function when called with config', () => {
    const { zQuery } = initZodvex(schema, server as any)
    const fn = zQuery({
      args: { title: z.string() },
      handler: async (_ctx: any, { title }: any) => title
    })
    expect(fn).toBeDefined()
  })

  it('zQuery validates args with Zod (rejects invalid args)', async () => {
    const { zQuery } = initZodvex(schema, server as any)
    const fn = zQuery({
      args: { title: z.string().min(3) },
      handler: async (_ctx: any, { title }: any) => title
    })

    // Should throw validation error — "ab" is too short (min 3)
    await expect(fn.handler({}, { title: 'ab' })).rejects.toThrow()
  })

  it('zQuery encodes return values through Zod returns schema', async () => {
    const { zQuery } = initZodvex(schema, server as any)
    const fn = zQuery({
      args: {},
      returns: z.object({ when: zx.date() }),
      handler: async () => ({ when: new Date('2025-06-15T00:00:00Z') })
    })

    const result = await fn.handler({}, {})
    expect(typeof result.when).toBe('number')
  })

  it('zCustomQuery creates a blessed builder with custom context', () => {
    const { zCustomQuery } = initZodvex(schema, server as any)

    const authQuery = zCustomQuery(
      customCtx(async (ctx: any) => ({
        user: { name: 'Admin' }
      }))
    )

    expect(authQuery).toBeDefined()
    expect(typeof authQuery).toBe('function')
  })

  it('zAction builder works without ctx.db', () => {
    const { zAction } = initZodvex(schema, server as any)
    const fn = zAction({
      args: { message: z.string() },
      handler: async (_ctx: any, { message }: any) => message
    })
    expect(fn).toBeDefined()
  })
})
```

**Step 2: Run the tests**

Run: `bun test __tests__/init.test.ts`
Expected: All pass

**Step 3: Commit**

```bash
git add __tests__/init.test.ts
git commit -m "test: update init tests for new initZodvex API shape"
```

---

### Task 4: Update the integration test for the new API

`__tests__/integration/codec-pipeline.test.ts` uses `zq`, `.withContext()`, `.withHooks()`, and `zCustomCtx` — all changed.

**Files:**
- Modify: `__tests__/integration/codec-pipeline.test.ts`

**Step 1: Update the integration test**

Key changes:
- `zq` -> `zQuery`
- `zq.withContext(ctx).withHooks(hooks)` -> use `zCustomQuery` with a customization that includes the hooks behavior as part of the customCtx pattern
- `zCustomCtx` -> `customCtx` from convex-helpers
- `createDatabaseHooks` / `composeHooks` -> inline the hook logic into the customCtx (per the v2 design: consumer owns DB middleware via wrapper functions)

Update the "hooks compose correctly" test to use the new pattern:

```typescript
  it('consumer DB wrapper composes on top of codec layer', async () => {
    const log: string[] = []
    const db = createMockDb()
    db.store['users:1'] = {
      _id: 'users:1',
      _creationTime: 1000,
      _table: 'users',
      name: 'John',
      email: 'john@test.com',
      state: 'CA'
    }

    const server = createMockServer(db)
    const { zCustomQuery } = initZodvex(schema, server as any)

    // Consumer wraps codec-aware db with their own logic
    const adminQuery = zCustomQuery(
      customCtx(async (ctx: any) => {
        const user = { name: 'Admin', role: 'admin' }
        log.push('auth')

        // Wrap codec-aware db with security check
        const secureDb = {
          ...ctx.db,
          query: (table: string) => {
            const chain = ctx.db.query(table)
            return {
              ...chain,
              collect: async () => {
                const docs = await chain.collect()
                log.push('security-filter')
                return docs.filter((d: any) => user.role === 'admin' ? true : false)
              }
            }
          }
        }
        return { user, db: secureDb }
      })
    )

    const listUsers = adminQuery({
      args: {},
      handler: async (ctx: any) => {
        return ctx.db.query('users').collect()
      }
    })

    const result = await listUsers._invoke({})
    expect(log).toContain('auth')
    expect(log).toContain('security-filter')
  })
```

**Step 2: Run the test**

Run: `bun test __tests__/integration/codec-pipeline.test.ts`
Expected: All pass

**Step 3: Commit**

```bash
git add __tests__/integration/codec-pipeline.test.ts
git commit -m "test: update integration tests for new initZodvex + blessed builder pattern"
```

---

### Task 5: Remove dead code from `init.ts`

Verify that `buildHandler`, `createQueryBuilder`, `createMutationBuilder`, `createActionBuilder`, `DbBuilder`, `ZodvexActionBuilder`, `zCustomCtx`, `zCustomCtxWithArgs`, and associated types are no longer referenced anywhere.

**Files:**
- Verify: `src/init.ts` — should be the clean rewrite from Task 2
- Verify: No other files import removed symbols

**Step 1: Search for references to removed symbols**

Search the codebase for:
- `buildHandler` — should have 0 references
- `DbBuilder` — should have 0 references
- `ZodvexActionBuilder` — should have 0 references
- `zCustomCtx` (as an import from `init.ts`) — should have 0 references
- `zCustomCtxWithArgs` — should have 0 references
- `.withContext(` — should have 0 references from zodvex code (tests may have been updated)
- `.withHooks(` — should have 0 references from zodvex code

**Step 2: Run the full test suite**

Run: `bun test`
Expected: All pass

**Step 3: Run type checking**

Run: `bun run type-check`
Expected: No errors

**Step 4: Commit (if any cleanup was needed)**

```bash
git add -A
git commit -m "chore: remove dead code from init.ts rewrite"
```

---

### Task 6: Verify `zCustomQuery` blessed builder receives codec-aware `ctx.db`

This is the critical integration test: when a consumer creates a blessed builder via `zCustomQuery(customCtx(...))`, their `customCtx` function should receive `ctx.db` that already decodes.

**Files:**
- Modify: `__tests__/integration/codec-pipeline.test.ts`

**Step 1: Add the test**

```typescript
  it('blessed builder customCtx receives codec-aware ctx.db', async () => {
    const db = createMockDb()
    db.store['events:1'] = {
      _id: 'events:1',
      _creationTime: 1000,
      _table: 'events',
      title: 'Meeting',
      startDate: 1700000000000,
      organizerId: 'users:1'
    }

    const server = createMockServer(db)
    const { zCustomQuery } = initZodvex(schema, server as any)

    let ctxDbReturnedDate = false

    const blessedQuery = zCustomQuery(
      customCtx(async (ctx: any) => {
        // Verify: ctx.db.get returns decoded data (Date, not timestamp)
        const event = await ctx.db.get('events:1')
        ctxDbReturnedDate = event?.startDate instanceof Date
        return { verified: true }
      })
    )

    const myFn = blessedQuery({
      args: {},
      handler: async (ctx: any) => {
        expect(ctx.verified).toBe(true)
        return 'ok'
      }
    })

    await myFn._invoke({})
    expect(ctxDbReturnedDate).toBe(true)
  })
```

**Step 2: Run the test**

Run: `bun test __tests__/integration/codec-pipeline.test.ts`
Expected: PASS

**Step 3: Run the full test suite**

Run: `bun test`
Expected: All pass

**Step 4: Commit**

```bash
git add __tests__/integration/codec-pipeline.test.ts
git commit -m "test: prove blessed builder customCtx receives codec-aware ctx.db"
```

---

## Summary

After completing this plan:
- `initZodvex` delegates to `customFnBuilder` via `zCustomQuery`/`zCustomMutation`/`zCustomAction`
- All builders have full Zod validation (args parsing, returns encoding)
- `buildHandler` and all its associated dead code are removed
- `zCustomCtx` / `zCustomCtxWithArgs` are replaced by `customCtx` from convex-helpers
- `.withContext()` / `.withHooks()` chaining pattern is replaced by `zCustomQuery(customization)` factory
- Blessed builders receive codec-aware `ctx.db` automatically
- Integration tests prove the full pipeline works end-to-end

**Next plan:** Plan 3 simplifies the DB codec layer (removes hooks from public API).
