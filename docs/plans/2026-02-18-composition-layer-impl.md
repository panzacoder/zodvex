# Composition Layer Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build `createCodecCustomization` and `initZodvex` to bridge DB codec primitives to the function builder layer.

**Architecture:** `createCodecCustomization` produces convex-helpers Customization objects that wrap `ctx.db`. `initZodvex` uses these to return pre-bound builders (`zq`, `zm`, `za`, etc.) that are callable AND have `.withContext()` for composing user customizations. An internal `createZodvexBuilder` factory augments `CustomBuilder` results with the `.withContext()` method.

**Tech Stack:** TypeScript, Zod v4, Convex, convex-helpers, Bun test runner

**Design doc:** `docs/plans/2026-02-18-composition-layer-design.md`

---

### Task 1: `createCodecCustomization`

**Files:**
- Create: `src/customization.ts`
- Create: `__tests__/customization.test.ts`

**Step 1: Write the failing test**

```typescript
// __tests__/customization.test.ts
import { describe, expect, it } from 'bun:test'
import { z } from 'zod'
import { createCodecCustomization } from '../src/customization'
import type { ZodTableSchemas } from '../src/schema'
import { zx } from '../src/zx'

const userDocSchema = z.object({
  _id: z.string(),
  _creationTime: z.number(),
  name: z.string(),
  createdAt: zx.date()
})

const userInsertSchema = z.object({
  name: z.string(),
  createdAt: zx.date()
})

const userSchemas: ZodTableSchemas = {
  doc: userDocSchema,
  docArray: z.array(userDocSchema),
  base: userInsertSchema,
  insert: userInsertSchema,
  update: userInsertSchema.partial().extend({ _id: z.string() })
}

const tableMap = { users: userSchemas }

// Minimal mock DB reader
function createMockDbReader(tables: Record<string, any[]>) {
  return {
    system: { get: async () => null, query: () => ({}), normalizeId: () => null },
    normalizeId: (tableName: string, id: string) => (id.startsWith(`${tableName}:`) ? id : null),
    get: async (id: string) => {
      for (const docs of Object.values(tables)) {
        const doc = docs.find((d: any) => d._id === id)
        if (doc) return doc
      }
      return null
    },
    query: () => ({})
  }
}

// Minimal mock DB writer (extends reader with write methods)
function createMockDbWriter(tables: Record<string, any[]>) {
  const reader = createMockDbReader(tables)
  const calls: { method: string; args: any[] }[] = []
  return {
    db: {
      ...reader,
      insert: async (table: string, value: any) => {
        calls.push({ method: 'insert', args: [table, value] })
        return `${table}:new`
      },
      patch: async (...args: any[]) => { calls.push({ method: 'patch', args }) },
      replace: async (...args: any[]) => { calls.push({ method: 'replace', args }) },
      delete: async (...args: any[]) => { calls.push({ method: 'delete', args }) }
    },
    calls
  }
}

describe('createCodecCustomization', () => {
  const tableData = {
    users: [
      { _id: 'users:1', _creationTime: 100, name: 'Alice', createdAt: 1700000000000 }
    ]
  }

  it('returns query and mutation customization objects', () => {
    const codec = createCodecCustomization(tableMap)
    expect(codec.query).toBeDefined()
    expect(codec.query.args).toEqual({})
    expect(codec.query.input).toBeTypeOf('function')
    expect(codec.mutation).toBeDefined()
    expect(codec.mutation.args).toEqual({})
    expect(codec.mutation.input).toBeTypeOf('function')
  })

  it('query customization wraps ctx.db with CodecDatabaseReader', async () => {
    const codec = createCodecCustomization(tableMap)
    const mockCtx = { db: createMockDbReader(tableData) }

    const result = await codec.query.input(mockCtx, {})

    // The wrapped db should decode docs
    const user = await result.ctx.db.get('users:1')
    expect(user.createdAt).toBeInstanceOf(Date)
  })

  it('mutation customization wraps ctx.db with CodecDatabaseWriter', async () => {
    const codec = createCodecCustomization(tableMap)
    const { db, calls } = createMockDbWriter(tableData)
    const mockCtx = { db }

    const result = await codec.mutation.input(mockCtx, {})

    // Reads should decode
    const user = await result.ctx.db.get('users:1')
    expect(user.createdAt).toBeInstanceOf(Date)

    // Writes should encode
    await result.ctx.db.insert('users', { name: 'Bob', createdAt: new Date(1700000000000) })
    expect(calls[0].args[1].createdAt).toBe(1700000000000)
  })
})
```

**Step 2: Run test to verify it fails**

Run: `bun test __tests__/customization.test.ts`
Expected: FAIL — `createCodecCustomization` not found

**Step 3: Write minimal implementation**

```typescript
// src/customization.ts
import { CodecDatabaseReader, CodecDatabaseWriter } from './db'
import type { ZodTableMap } from './schema'

/**
 * Creates Convex Customization objects that wrap ctx.db with codec
 * readers/writers. Returns { query, mutation } for use with
 * zCustomQuery/zCustomMutation or manual composition.
 *
 * @example
 * ```typescript
 * const codec = createCodecCustomization(schema.__zodTableMap)
 * const authQuery = zCustomQuery(query, {
 *   args: {},
 *   input: async (ctx) => {
 *     const codecResult = await codec.query.input(ctx, {})
 *     const user = await getUserOrThrow({ ...ctx, ...codecResult.ctx })
 *     return { ctx: { ...codecResult.ctx, user }, args: {} }
 *   }
 * })
 * ```
 */
export function createCodecCustomization(tableMap: ZodTableMap) {
  return {
    query: {
      args: {},
      input: async (ctx: any) => ({
        ctx: { db: new CodecDatabaseReader(ctx.db, tableMap) },
        args: {}
      })
    },
    mutation: {
      args: {},
      input: async (ctx: any) => ({
        ctx: { db: new CodecDatabaseWriter(ctx.db, tableMap) },
        args: {}
      })
    }
  }
}
```

**Step 4: Run test to verify it passes**

Run: `bun test __tests__/customization.test.ts`
Expected: PASS (3 tests)

**Step 5: Commit**

```bash
git add src/customization.ts __tests__/customization.test.ts
git commit -m "feat: add createCodecCustomization for manual codec composition"
```

---

### Task 2: `composeCodecAndUser` internal helper

**Files:**
- Modify: `src/init.ts` (create new file)
- Create: `__tests__/init.test.ts`

**Step 1: Write the failing test**

```typescript
// __tests__/init.test.ts (initial content)
import { describe, expect, it } from 'bun:test'

// We test composeCodecAndUser indirectly since it's not exported.
// Import the internal via a re-export trick or test through initZodvex.
// For now, test the composition logic directly by importing from init.

// NOTE: composeCodecAndUser is internal. We'll test it through
// createZodvexBuilder and initZodvex in later tasks.
// This task creates the file and the helper.

describe('composition helpers (tested via integration)', () => {
  it('placeholder for integration tests in Task 5', () => {
    expect(true).toBe(true)
  })
})
```

**Step 2: Write implementation**

```typescript
// src/init.ts
import type { Customization } from 'convex-helpers/server/customFunctions'

/**
 * Composes a codec customization with a user customization.
 * Codec input runs first (wraps ctx.db), user input runs second
 * (sees codec-wrapped ctx.db).
 *
 * Internal — not exported.
 */
export function composeCodecAndUser(
  codecCust: { args: Record<string, never>; input: (ctx: any, args: any, extra?: any) => any },
  userCust: { args?: any; input?: (ctx: any, args: any, extra?: any) => any }
) {
  return {
    args: userCust.args ?? {},
    input: async (ctx: any, args: any, extra?: any) => {
      // 1. Codec layer: wrap ctx.db
      const codecResult = await codecCust.input(ctx, {}, extra)
      const codecCtx = { ...ctx, ...codecResult.ctx }

      // 2. User layer: sees codec-wrapped ctx.db
      if (!userCust.input) {
        return { ctx: codecResult.ctx, args: {} }
      }
      const userResult = await userCust.input(codecCtx, args, extra)

      // 3. Merge: user ctx additions on top of codec ctx
      return {
        ctx: { ...codecResult.ctx, ...(userResult.ctx ?? {}) },
        args: userResult.args ?? {}
      }
    }
  }
}
```

**Step 3: Run test**

Run: `bun test __tests__/init.test.ts`
Expected: PASS (placeholder)

**Step 4: Commit**

```bash
git add src/init.ts __tests__/init.test.ts
git commit -m "feat: add composeCodecAndUser internal helper"
```

---

### Task 3: `createZodvexBuilder` internal factory

**Files:**
- Modify: `src/init.ts`
- Modify: `__tests__/init.test.ts`

**Step 1: Write the failing test**

Add to `__tests__/init.test.ts`:

```typescript
import { z } from 'zod'
import { zCustomQuery } from '../src/custom'
import { createCodecCustomization } from '../src/customization'
import { createZodvexBuilder } from '../src/init'
import type { ZodTableSchemas } from '../src/schema'
import { zx } from '../src/zx'

// ... (reuse userSchemas/tableMap from Task 1 test, or define here)

describe('createZodvexBuilder', () => {
  // Mock builder that captures the registered function
  const mockQueryBuilder = (fn: any) => fn

  const noOp = { args: {} as Record<string, never>, input: async (ctx: any) => ({ ctx: {}, args: {} }) }

  it('returns a callable function', () => {
    const zq = createZodvexBuilder(mockQueryBuilder, noOp, zCustomQuery)
    expect(zq).toBeTypeOf('function')
  })

  it('has a .withContext() method', () => {
    const zq = createZodvexBuilder(mockQueryBuilder, noOp, zCustomQuery)
    expect(zq.withContext).toBeTypeOf('function')
  })

  it('.withContext() returns a callable', () => {
    const zq = createZodvexBuilder(mockQueryBuilder, noOp, zCustomQuery)
    const customized = zq.withContext({ args: {}, input: async (ctx: any) => ({ ctx: {}, args: {} }) })
    expect(customized).toBeTypeOf('function')
  })
})
```

**Step 2: Run test to verify it fails**

Run: `bun test __tests__/init.test.ts`
Expected: FAIL — `createZodvexBuilder` not exported or not found

**Step 3: Write implementation**

Add to `src/init.ts`:

```typescript
import { zCustomQuery, zCustomMutation, zCustomAction } from './custom'

/**
 * Creates a zodvex-enhanced builder: a CustomBuilder callable with
 * a .withContext() method for composing user customizations.
 *
 * Internal — not exported from the package.
 */
export function createZodvexBuilder(
  rawBuilder: any,
  codecCust: { args: Record<string, never>; input: (ctx: any, args: any, extra?: any) => any },
  customFn: typeof zCustomQuery | typeof zCustomMutation | typeof zCustomAction
) {
  const base: any = customFn(rawBuilder as any, codecCust as any)

  base.withContext = (userCust: any) => {
    const composed = composeCodecAndUser(codecCust, userCust)
    return customFn(rawBuilder as any, composed as any)
  }

  return base
}
```

**Step 4: Run test to verify it passes**

Run: `bun test __tests__/init.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/init.ts __tests__/init.test.ts
git commit -m "feat: add createZodvexBuilder internal factory"
```

---

### Task 4: `initZodvex` function

**Files:**
- Modify: `src/init.ts`
- Modify: `__tests__/init.test.ts`

**Step 1: Write the failing test**

Add to `__tests__/init.test.ts`:

```typescript
import { initZodvex } from '../src/init'

describe('initZodvex', () => {
  const mockSchema = { __zodTableMap: { users: userSchemas } }

  // Mock server object — builders are pass-through functions
  const mockServer = {
    query: (fn: any) => fn,
    mutation: (fn: any) => fn,
    action: (fn: any) => fn,
    internalQuery: (fn: any) => fn,
    internalMutation: (fn: any) => fn,
    internalAction: (fn: any) => fn
  }

  it('returns all 6 builders', () => {
    const result = initZodvex(mockSchema, mockServer as any)
    expect(result.zq).toBeTypeOf('function')
    expect(result.zm).toBeTypeOf('function')
    expect(result.za).toBeTypeOf('function')
    expect(result.ziq).toBeTypeOf('function')
    expect(result.zim).toBeTypeOf('function')
    expect(result.zia).toBeTypeOf('function')
  })

  it('all builders have .withContext()', () => {
    const result = initZodvex(mockSchema, mockServer as any)
    expect(result.zq.withContext).toBeTypeOf('function')
    expect(result.zm.withContext).toBeTypeOf('function')
    expect(result.za.withContext).toBeTypeOf('function')
    expect(result.ziq.withContext).toBeTypeOf('function')
    expect(result.zim.withContext).toBeTypeOf('function')
    expect(result.zia.withContext).toBeTypeOf('function')
  })

  it('accepts wrapDb: false option', () => {
    const result = initZodvex(mockSchema, mockServer as any, { wrapDb: false })
    expect(result.zq).toBeTypeOf('function')
    expect(result.zq.withContext).toBeTypeOf('function')
  })
})
```

**Step 2: Run test to verify it fails**

Run: `bun test __tests__/init.test.ts`
Expected: FAIL — `initZodvex` not found

**Step 3: Write implementation**

Add to `src/init.ts`:

```typescript
import { NoOp } from 'convex-helpers/server/customFunctions'
import type {
  ActionBuilder,
  MutationBuilder,
  QueryBuilder
} from 'convex/server'
import { createCodecCustomization } from './customization'
import type { ZodTableMap } from './schema'

/**
 * One-time zodvex setup. Returns pre-bound builders with optional
 * codec DB wrapping and .withContext() for composing user customizations.
 *
 * @example
 * ```typescript
 * import schema from './schema'
 * import { query, mutation, action, internalQuery, internalMutation, internalAction } from './_generated/server'
 * import { initZodvex } from 'zodvex/server'
 *
 * export const { zq, zm, za, ziq, zim, zia } = initZodvex(schema, {
 *   query, mutation, action,
 *   internalQuery, internalMutation, internalAction
 * })
 * ```
 */
export function initZodvex(
  schema: { __zodTableMap: ZodTableMap },
  server: {
    query: QueryBuilder<any, 'public'>
    mutation: MutationBuilder<any, 'public'>
    action: ActionBuilder<any, 'public'>
    internalQuery: QueryBuilder<any, 'internal'>
    internalMutation: MutationBuilder<any, 'internal'>
    internalAction: ActionBuilder<any, 'internal'>
  },
  options?: { wrapDb?: boolean }
) {
  const codec = createCodecCustomization(schema.__zodTableMap)
  const noOp = { args: {} as Record<string, never>, input: NoOp.input }
  const wrap = options?.wrapDb !== false

  return {
    zq: createZodvexBuilder(server.query, wrap ? codec.query : noOp, zCustomQuery),
    zm: createZodvexBuilder(server.mutation, wrap ? codec.mutation : noOp, zCustomMutation),
    za: createZodvexBuilder(server.action, noOp, zCustomAction),
    ziq: createZodvexBuilder(server.internalQuery, wrap ? codec.query : noOp, zCustomQuery),
    zim: createZodvexBuilder(server.internalMutation, wrap ? codec.mutation : noOp, zCustomMutation),
    zia: createZodvexBuilder(server.internalAction, noOp, zCustomAction)
  }
}
```

**Step 4: Run test to verify it passes**

Run: `bun test __tests__/init.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/init.ts __tests__/init.test.ts
git commit -m "feat: add initZodvex one-time setup function"
```

---

### Task 5: VALIDATION CHECKPOINT — integration tests

> **CRITICAL:** If these tests fail due to composition issues (not just typos), **STOP implementation and return to design mode.** The likely failure is a shape mismatch in how `customFnBuilder` processes the composed customization.

**Files:**
- Modify: `__tests__/init.test.ts`

**Step 1: Write the integration tests**

Add to `__tests__/init.test.ts`:

```typescript
describe('initZodvex integration', () => {
  const tableData = {
    users: [
      { _id: 'users:1', _creationTime: 100, name: 'Alice', createdAt: 1700000000000 }
    ]
  }

  const mockSchema = { __zodTableMap: { users: userSchemas } }
  const mockServer = {
    query: (fn: any) => fn,
    mutation: (fn: any) => fn,
    action: (fn: any) => fn,
    internalQuery: (fn: any) => fn,
    internalMutation: (fn: any) => fn,
    internalAction: (fn: any) => fn
  }

  it('zq base callable: handler receives codec-wrapped ctx.db', async () => {
    const { zq } = initZodvex(mockSchema, mockServer as any)

    // Register a function
    const fn = zq({
      args: { id: z.string() },
      handler: async (ctx: any, { id }: any) => {
        return ctx.db.get(id)
      }
    })

    // Call the registered handler with a raw (unwrapped) ctx
    const rawCtx = { db: createMockDbReader(tableData) }
    const result = await fn.handler(rawCtx, { id: 'users:1' })

    // Should be decoded (Date, not timestamp)
    expect(result.createdAt).toBeInstanceOf(Date)
    expect(result.createdAt.getTime()).toBe(1700000000000)
  })

  it('zm base callable: ctx.db.insert() encodes runtime values', async () => {
    const { zm } = initZodvex(mockSchema, mockServer as any)

    const { db, calls } = createMockDbWriter(tableData)

    const fn = zm({
      args: { name: z.string(), date: z.number() },
      handler: async (ctx: any, { name, date }: any) => {
        await ctx.db.insert('users', { name, createdAt: new Date(date) })
      }
    })

    await fn.handler({ db }, { name: 'Bob', date: 1700000000000 })

    expect(calls[0].method).toBe('insert')
    expect(calls[0].args[1].createdAt).toBe(1700000000000) // encoded
  })

  it('zq.withContext(): handler sees codec-wrapped db AND custom context', async () => {
    const { zq } = initZodvex(mockSchema, mockServer as any)

    const authQuery = zq.withContext({
      args: {},
      input: async (ctx: any) => ({
        ctx: { user: { name: 'AuthUser' } },
        args: {}
      })
    })

    const fn = authQuery({
      args: { id: z.string() },
      handler: async (ctx: any, { id }: any) => {
        const doc = await ctx.db.get(id)
        return { doc, userName: ctx.user.name }
      }
    })

    const rawCtx = { db: createMockDbReader(tableData) }
    const result = await fn.handler(rawCtx, { id: 'users:1' })

    // Codec wrapping works
    expect(result.doc.createdAt).toBeInstanceOf(Date)
    // User customization works
    expect(result.userName).toBe('AuthUser')
  })
})
```

**Step 2: Run tests**

Run: `bun test __tests__/init.test.ts`

**Expected:** PASS. If FAIL due to composition issues, **stop and return to design.**

Possible failure modes:
- `customFnBuilder` doesn't call `customization.input` for the base path (no user args)
- The `input` return shape `{ ctx, args }` doesn't match what `customFnBuilder` expects
- The mock builder pass-through `(fn) => fn` doesn't work with `customFnBuilder`

**Step 3: Commit**

```bash
git add __tests__/init.test.ts
git commit -m "test: validation checkpoint — initZodvex integration tests"
```

---

### Task 6: `wrapDb: false` integration test

**Files:**
- Modify: `__tests__/init.test.ts`

**Step 1: Write the test**

Add to `__tests__/init.test.ts`:

```typescript
describe('initZodvex with wrapDb: false', () => {
  const tableData = {
    users: [
      { _id: 'users:1', _creationTime: 100, name: 'Alice', createdAt: 1700000000000 }
    ]
  }

  const mockSchema = { __zodTableMap: { users: userSchemas } }
  const mockServer = {
    query: (fn: any) => fn,
    mutation: (fn: any) => fn,
    action: (fn: any) => fn,
    internalQuery: (fn: any) => fn,
    internalMutation: (fn: any) => fn,
    internalAction: (fn: any) => fn
  }

  it('handler receives raw ctx.db (no codec wrapping)', async () => {
    const { zq } = initZodvex(mockSchema, mockServer as any, { wrapDb: false })

    const fn = zq({
      args: { id: z.string() },
      handler: async (ctx: any, { id }: any) => {
        return ctx.db.get(id)
      }
    })

    const rawCtx = { db: createMockDbReader(tableData) }
    const result = await fn.handler(rawCtx, { id: 'users:1' })

    // Should be RAW (timestamp, not Date) because no codec wrapping
    expect(result.createdAt).toBe(1700000000000)
  })
})
```

**Step 2: Run test**

Run: `bun test __tests__/init.test.ts`
Expected: PASS

**Step 3: Commit**

```bash
git add __tests__/init.test.ts
git commit -m "test: wrapDb: false option disables codec DB wrapping"
```

---

### Task 7: Export wiring + build verification

**Files:**
- Modify: `src/server/index.ts`
- Modify: `__tests__/exports.test.ts`

**Step 1: Add exports**

In `src/server/index.ts`, add:

```typescript
// Codec customization (manual composition escape hatch)
export { createCodecCustomization } from '../customization'
// One-time setup
export { initZodvex } from '../init'
```

**Step 2: Update export tests**

Add to `__tests__/exports.test.ts` in the `zodvex/server exports` describe block:

```typescript
it('exports initZodvex', async () => {
  const { initZodvex } = await import('../src/server')
  expect(initZodvex).toBeDefined()
})

it('exports createCodecCustomization', async () => {
  const { createCodecCustomization } = await import('../src/server')
  expect(createCodecCustomization).toBeDefined()
})
```

Add to `zodvex (root) exports` test:

```typescript
expect(zodvex.initZodvex).toBeDefined()
expect(zodvex.createCodecCustomization).toBeDefined()
```

**Step 3: Run full verification**

```bash
bun test
bun run build
bun run lint
```

Expected: All pass

**Step 4: Commit**

```bash
git add src/server/index.ts __tests__/exports.test.ts
git commit -m "feat: wire up initZodvex and createCodecCustomization exports"
```

---

### Summary

| Task | What | Risk |
|------|------|------|
| 1 | `createCodecCustomization` | Low — wraps existing DB classes |
| 2 | `composeCodecAndUser` helper | Low — simple function composition |
| 3 | `createZodvexBuilder` factory | Medium — attaches method to callable |
| 4 | `initZodvex` function | Low — wires existing pieces together |
| **5** | **VALIDATION CHECKPOINT** | **High — tests real composition through customFnBuilder** |
| 6 | `wrapDb: false` test | Low — NoOp path |
| 7 | Export wiring + build | Low — mechanical |
