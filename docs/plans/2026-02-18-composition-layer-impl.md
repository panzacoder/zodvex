# Composition Layer Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build `createCodecCustomization` and `initZodvex` to bridge DB codec primitives to the function builder layer.

**Architecture:** `createCodecCustomization` produces convex-helpers Customization objects that wrap `ctx.db`. `initZodvex` uses these to return pre-bound builders (`zq`, `zm`, `za`, etc.) that are callable AND have `.withContext()` for composing user customizations. An internal `createZodvexBuilder` factory augments `CustomBuilder` results with the `.withContext()` method. A `ZodvexBuilder` type provides full type inference through `initZodvex` overloads.

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
    query: (tableName: string) => ({
      fullTableScan: () => ({
        collect: async () => tables[tableName] ?? []
      }),
      collect: async () => tables[tableName] ?? []
    })
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

  it('query customization wraps ctx.db.query() with decoding', async () => {
    const codec = createCodecCustomization(tableMap)
    const mockCtx = { db: createMockDbReader(tableData) }

    const result = await codec.query.input(mockCtx, {})

    // The query chain path should also decode
    const users = await result.ctx.db.query('users').collect()
    expect(users[0].createdAt).toBeInstanceOf(Date)
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
      args: {} as Record<string, never>,
      input: async (ctx: any, _args: any, _extra?: any) => ({
        ctx: { db: new CodecDatabaseReader(ctx.db, tableMap) },
        args: {}
      })
    },
    mutation: {
      args: {} as Record<string, never>,
      input: async (ctx: any, _args: any, _extra?: any) => ({
        ctx: { db: new CodecDatabaseWriter(ctx.db, tableMap) },
        args: {}
      })
    }
  }
}
```

**Step 4: Run test to verify it passes**

Run: `bun test __tests__/customization.test.ts`
Expected: PASS (4 tests)

**Step 5: Commit**

```bash
git add src/customization.ts __tests__/customization.test.ts
git commit -m "feat: add createCodecCustomization for manual codec composition"
```

---

### Task 2: `composeCodecAndUser` internal helper

**Files:**
- Create: `src/init.ts`
- Create: `__tests__/init.test.ts`

**Step 1: Write the failing tests**

```typescript
// __tests__/init.test.ts (initial content)
import { describe, expect, it } from 'bun:test'
import { composeCodecAndUser } from '../src/init'

describe('composeCodecAndUser', () => {
  // Minimal codec customization mock — wraps ctx.db
  const mockCodecCust = {
    args: {} as Record<string, never>,
    input: async (ctx: any, _args: any, _extra?: any) => ({
      ctx: { db: { wrapped: true, inner: ctx.db } },
      args: {}
    })
  }

  it('codec runs first, user sees codec-wrapped ctx', async () => {
    let userReceivedCtx: any
    const userCust = {
      args: {},
      input: async (ctx: any) => {
        userReceivedCtx = ctx
        return { ctx: { user: 'Alice' }, args: {} }
      }
    }

    const composed = composeCodecAndUser(mockCodecCust, userCust)
    await composed.input({ db: { original: true } }, {})

    // User should see the codec-wrapped db, not the original
    expect(userReceivedCtx.db.wrapped).toBe(true)
    expect(userReceivedCtx.db.inner.original).toBe(true)
  })

  it('merges codec ctx and user ctx (user on top)', async () => {
    const userCust = {
      args: {},
      input: async (ctx: any) => ({
        ctx: { user: 'Alice' },
        args: {}
      })
    }

    const composed = composeCodecAndUser(mockCodecCust, userCust)
    const result = await composed.input({ db: { original: true } }, {})

    expect(result.ctx.db.wrapped).toBe(true)
    expect(result.ctx.user).toBe('Alice')
  })

  it('surfaces user customization args', async () => {
    const userCust = {
      args: { sessionId: { type: 'id' } },
      input: async (ctx: any, args: any) => ({
        ctx: { session: args.sessionId },
        args: { resolved: true }
      })
    }

    const composed = composeCodecAndUser(mockCodecCust, userCust)
    expect(composed.args).toEqual({ sessionId: { type: 'id' } })
  })

  it('works when user customization has no input', async () => {
    const userCust = { args: {} }

    const composed = composeCodecAndUser(mockCodecCust, userCust)
    const result = await composed.input({ db: { original: true } }, {})

    // Should still get codec ctx
    expect(result.ctx.db.wrapped).toBe(true)
  })

  it('propagates user hooks.onSuccess through composition', async () => {
    const onSuccessFn = () => {}
    const userCust = {
      args: {},
      input: async () => ({
        ctx: {},
        args: {},
        hooks: { onSuccess: onSuccessFn }
      })
    }

    const composed = composeCodecAndUser(mockCodecCust, userCust)
    const result = await composed.input({}, {})

    expect(result.hooks?.onSuccess).toBe(onSuccessFn)
  })

  it('propagates user top-level onSuccess (convex-helpers convention)', async () => {
    const onSuccessFn = () => {}
    const userCust = {
      args: {},
      input: async () => ({
        ctx: {},
        args: {},
        onSuccess: onSuccessFn
      })
    }

    const composed = composeCodecAndUser(mockCodecCust, userCust)
    const result = await composed.input({}, {})

    expect(result.onSuccess).toBe(onSuccessFn)
  })

  it('propagates user transforms through composition', async () => {
    const transforms = {
      input: (args: any) => args,
      output: (result: any) => result
    }
    const userCust = {
      args: {},
      input: async () => ({
        ctx: {},
        args: {},
        transforms
      })
    }

    const composed = composeCodecAndUser(mockCodecCust, userCust)
    const result = await composed.input({}, {})

    expect(result.transforms).toBe(transforms)
  })
})
```

**Step 2: Run test to verify it fails**

Run: `bun test __tests__/init.test.ts`
Expected: FAIL — `composeCodecAndUser` not found

**Step 3: Write implementation**

```typescript
// src/init.ts

/**
 * Composes a codec customization with a user customization.
 * Codec input runs first (wraps ctx.db), user input runs second
 * (sees codec-wrapped ctx.db). Propagates user's hooks, onSuccess,
 * and transforms through the composition.
 *
 * Internal — exported for testing but not re-exported from package.
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
        args: userResult.args ?? {},
        // Pass through user's hooks/onSuccess/transforms
        ...(userResult.hooks && { hooks: userResult.hooks }),
        ...(userResult.onSuccess && { onSuccess: userResult.onSuccess }),
        ...(userResult.transforms && { transforms: userResult.transforms }),
      }
    }
  }
}
```

**Step 4: Run test to verify it passes**

Run: `bun test __tests__/init.test.ts`
Expected: PASS (7 tests)

**Step 5: Commit**

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

  const noOp = { args: {} as Record<string, never>, input: async (ctx: any, _args: any, _extra?: any) => ({ ctx: {}, args: {} }) }

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

  it('.withContext() result does NOT have .withContext() (not chainable)', () => {
    const zq = createZodvexBuilder(mockQueryBuilder, noOp, zCustomQuery)
    const customized = zq.withContext({ args: {}, input: async (ctx: any) => ({ ctx: {}, args: {} }) })
    expect((customized as any).withContext).toBeUndefined()
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
 * .withContext() is NOT chainable — returns a plain CustomBuilder.
 * To compose multiple customizations, compose them before passing
 * to .withContext().
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

### Task 3.5: `ZodvexBuilder` type + `Overwrite` export + `initZodvex` overloads

**Files:**
- Modify: `src/custom.ts` — export `Overwrite` type (line 197)
- Modify: `src/init.ts` — add `ZodvexBuilder` type and `initZodvex` overloads
- Modify: `src/types.ts` — re-export `Overwrite` (so it flows through core + server)

**Step 1: Export `Overwrite` from `src/custom.ts`**

In `src/custom.ts` line 197, change:

```typescript
type Overwrite<T, U> = Omit<T, keyof U> & U
```

to:

```typescript
export type Overwrite<T, U> = Omit<T, keyof U> & U
```

**Step 2: Add `ZodvexBuilder` type to `src/init.ts`**

```typescript
import type {
  FunctionVisibility,
  GenericActionCtx,
  GenericDataModel,
  GenericMutationCtx,
  GenericQueryCtx,
  ActionBuilder,
  MutationBuilder,
  QueryBuilder
} from 'convex/server'
import type { Customization } from 'convex-helpers/server/customFunctions'
import type { PropertyValidators } from 'convex/values'
import type { CustomBuilder, Overwrite } from './custom'
import { CodecDatabaseReader, CodecDatabaseWriter } from './db'

/**
 * A zodvex builder: callable CustomBuilder + .withContext() for composing
 * user customizations on top of the codec layer.
 *
 * .withContext() is NOT chainable — returns a plain CustomBuilder.
 * To compose multiple customizations, compose them before passing to .withContext().
 */
export type ZodvexBuilder<
  FuncType extends 'query' | 'mutation' | 'action',
  CodecCtx extends Record<string, any>,
  InputCtx,
  Visibility extends FunctionVisibility,
> = CustomBuilder<
    FuncType,
    Record<string, never>,
    CodecCtx,
    Record<string, never>,
    InputCtx,
    Visibility,
    Record<string, any>
  >
  & {
    withContext: <
      CustomArgsValidator extends PropertyValidators,
      CustomCtx extends Record<string, any>,
      CustomMadeArgs extends Record<string, any>,
      ExtraArgs extends Record<string, any> = Record<string, any>,
    >(
      customization: Customization<
        Overwrite<InputCtx, CodecCtx>,   // user sees codec-augmented ctx
        CustomArgsValidator,
        CustomCtx,
        CustomMadeArgs,
        ExtraArgs
      >
    ) => CustomBuilder<
      FuncType,
      CustomArgsValidator,
      Overwrite<CodecCtx, CustomCtx>,   // user ctx patches on top of codec ctx
      CustomMadeArgs,
      InputCtx,
      Visibility,
      ExtraArgs
    >
  }
```

**Step 3: Add `initZodvex` overloads to `src/init.ts`**

```typescript
// Overload 1: wrapDb: false — no codec DB wrapping
export function initZodvex<DM extends GenericDataModel>(
  schema: { __zodTableMap: ZodTableMap },
  server: {
    query: QueryBuilder<DM, 'public'>
    mutation: MutationBuilder<DM, 'public'>
    action: ActionBuilder<DM, 'public'>
    internalQuery: QueryBuilder<DM, 'internal'>
    internalMutation: MutationBuilder<DM, 'internal'>
    internalAction: ActionBuilder<DM, 'internal'>
  },
  options: { wrapDb: false }
): {
  zq: ZodvexBuilder<'query', {}, GenericQueryCtx<DM>, 'public'>
  zm: ZodvexBuilder<'mutation', {}, GenericMutationCtx<DM>, 'public'>
  za: ZodvexBuilder<'action', {}, GenericActionCtx<DM>, 'public'>
  ziq: ZodvexBuilder<'query', {}, GenericQueryCtx<DM>, 'internal'>
  zim: ZodvexBuilder<'mutation', {}, GenericMutationCtx<DM>, 'internal'>
  zia: ZodvexBuilder<'action', {}, GenericActionCtx<DM>, 'internal'>
}

// Overload 2: wrapDb: true (default) — codec DB wrapping enabled
export function initZodvex<DM extends GenericDataModel>(
  schema: { __zodTableMap: ZodTableMap },
  server: {
    query: QueryBuilder<DM, 'public'>
    mutation: MutationBuilder<DM, 'public'>
    action: ActionBuilder<DM, 'public'>
    internalQuery: QueryBuilder<DM, 'internal'>
    internalMutation: MutationBuilder<DM, 'internal'>
    internalAction: ActionBuilder<DM, 'internal'>
  },
  options?: { wrapDb?: true }
): {
  zq: ZodvexBuilder<'query', { db: CodecDatabaseReader<DM> }, GenericQueryCtx<DM>, 'public'>
  zm: ZodvexBuilder<'mutation', { db: CodecDatabaseWriter<DM> }, GenericMutationCtx<DM>, 'public'>
  za: ZodvexBuilder<'action', {}, GenericActionCtx<DM>, 'public'>
  ziq: ZodvexBuilder<'query', { db: CodecDatabaseReader<DM> }, GenericQueryCtx<DM>, 'internal'>
  zim: ZodvexBuilder<'mutation', { db: CodecDatabaseWriter<DM> }, GenericMutationCtx<DM>, 'internal'>
  zia: ZodvexBuilder<'action', {}, GenericActionCtx<DM>, 'internal'>
}
```

Key design decisions:
- `DM extends GenericDataModel` is inferred from `server.query: QueryBuilder<DM, 'public'>`
- `.withContext()`'s Customization Ctx param = `Overwrite<InputCtx, CodecCtx>` → user's `input` fn gets autocomplete on `ctx.db: CodecDatabaseReader<DM>`
- Composed CustomCtx = `Overwrite<CodecCtx, UserCtx>` → user can override `db` if needed
- Actions always use `CodecCtx = {}` (no `ctx.db`)
- Implementation body unchanged — uses `any` internally. Type safety enforced by overload return types.

**Step 4: Run type-check**

Run: `bun run type-check`
Expected: PASS

**Step 5: Commit**

```bash
git add src/custom.ts src/init.ts
git commit -m "feat: add ZodvexBuilder type and typed initZodvex overloads"
```

---

### Task 4: `initZodvex` implementation

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

Add to `src/init.ts` (the implementation signature, below the overloads):

```typescript
import { NoOp } from 'convex-helpers/server/customFunctions'
import { createCodecCustomization } from './customization'
import type { ZodTableMap } from './schema'

// Implementation
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

  // --- Core composition tests ---

  it('zq base callable: handler receives codec-wrapped ctx.db', async () => {
    const { zq } = initZodvex(mockSchema, mockServer as any)

    const fn = zq({
      args: { id: z.string() },
      handler: async (ctx: any, { id }: any) => {
        return ctx.db.get(id)
      }
    })

    const rawCtx = { db: createMockDbReader(tableData) }
    const result = await fn.handler(rawCtx, { id: 'users:1' })

    // Should be decoded (Date, not timestamp)
    expect(result.createdAt).toBeInstanceOf(Date)
    expect(result.createdAt.getTime()).toBe(1700000000000)
  })

  it('zq: ctx.db.query().collect() returns decoded docs', async () => {
    const { zq } = initZodvex(mockSchema, mockServer as any)

    const fn = zq({
      handler: async (ctx: any) => {
        return ctx.db.query('users').collect()
      }
    })

    const rawCtx = { db: createMockDbReader(tableData) }
    const result = await fn.handler(rawCtx, {})

    expect(result[0].createdAt).toBeInstanceOf(Date)
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

  // --- Action tests ---

  it('za: handler works without ctx.db wrapping', async () => {
    const { za } = initZodvex(mockSchema, mockServer as any)

    const fn = za({
      args: { msg: z.string() },
      handler: async (ctx: any, { msg }: any) => {
        // Actions have no ctx.db — just verify the handler runs
        return `received: ${msg}`
      }
    })

    const rawCtx = {} // actions don't have db
    const result = await fn.handler(rawCtx, { msg: 'hello' })
    expect(result).toBe('received: hello')
  })

  it('za.withContext(): composes without db wrapping', async () => {
    const { za } = initZodvex(mockSchema, mockServer as any)

    const authedAction = za.withContext({
      args: {},
      input: async (ctx: any) => ({
        ctx: { user: 'AuthUser' },
        args: {}
      })
    })

    const fn = authedAction({
      handler: async (ctx: any) => ctx.user
    })

    const result = await fn.handler({}, {})
    expect(result).toBe('AuthUser')
  })

  // --- User customization with args ---

  it('zq.withContext() with custom args surfaces them', async () => {
    const { zq } = initZodvex(mockSchema, mockServer as any)

    const sessionQuery = zq.withContext({
      args: { token: z.string() },
      input: async (ctx: any, { token }: any) => ({
        ctx: { session: `session-${token}` },
        args: {}
      })
    })

    const fn = sessionQuery({
      handler: async (ctx: any) => ctx.session
    })

    const rawCtx = { db: createMockDbReader(tableData) }
    const result = await fn.handler(rawCtx, { token: 'abc123' })
    expect(result).toBe('session-abc123')
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

### Task 6: `wrapDb: false` integration tests

**Files:**
- Modify: `__tests__/init.test.ts`

**Step 1: Write the tests**

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

  it('wrapDb: false + .withContext(): no codec, user ctx works', async () => {
    const { zq } = initZodvex(mockSchema, mockServer as any, { wrapDb: false })

    const authQuery = zq.withContext({
      args: {},
      input: async (ctx: any) => ({
        ctx: { user: 'AuthUser' },
        args: {}
      })
    })

    const fn = authQuery({
      args: { id: z.string() },
      handler: async (ctx: any, { id }: any) => {
        const doc = await ctx.db.get(id)
        return { doc, user: ctx.user }
      }
    })

    const rawCtx = { db: createMockDbReader(tableData) }
    const result = await fn.handler(rawCtx, { id: 'users:1' })

    // No codec wrapping — raw timestamp
    expect(result.doc.createdAt).toBe(1700000000000)
    // User customization still works
    expect(result.user).toBe('AuthUser')
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
- Modify: `src/custom.ts` — ensure `Overwrite` is exported (if not done in Task 3.5)
- Modify: `src/server/index.ts` — add exports
- Modify: `__tests__/exports.test.ts`

**Step 1: Add exports**

In `src/server/index.ts`, add:

```typescript
// Codec customization (manual composition escape hatch)
export { createCodecCustomization } from '../customization'
// One-time setup + types
export { initZodvex, type ZodvexBuilder } from '../init'
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
bun run type-check
```

Expected: All pass

**Step 4: Commit**

```bash
git add src/custom.ts src/server/index.ts __tests__/exports.test.ts
git commit -m "feat: wire up initZodvex and createCodecCustomization exports"
```

---

### Summary

| Task | What | Risk | Changes from original |
|------|------|------|----------------------|
| 1 | `createCodecCustomization` | Low | Fixed input sig `(ctx, _args, _extra?)` + query() test |
| 2 | `composeCodecAndUser` helper | Low | Real unit tests + hooks/onSuccess/transforms passthrough |
| 3 | `createZodvexBuilder` factory | Medium | + non-chainable test |
| **3.5** | **`ZodvexBuilder` type + overloads** | **Medium** | **NEW — full type inference via DM generic + overloads** |
| 4 | `initZodvex` function | Low | Uses typed overloads from 3.5 |
| **5** | **VALIDATION CHECKPOINT** | **High** | **Expanded: query(), actions, custom args** |
| 6 | `wrapDb: false` tests | Low | + combo test with `.withContext()` |
| 7 | Export wiring + build | Low | + `ZodvexBuilder` type export |
