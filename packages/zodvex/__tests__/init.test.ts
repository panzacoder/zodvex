import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { zCustomQuery } from '../src/internal/custom'
import { composeCustomizations, createZodvexBuilder, initZodvex } from '../src/internal/init'
import { zx } from '../src/internal/zx'
import {
  createMockDbReader,
  createMockDbWriter,
  userSchemas,
  userTableData
} from './fixtures/mock-db'

const functionNameSymbol = Symbol.for('functionName')

describe('composeCustomizations', () => {
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

    const composed = composeCustomizations(mockCodecCust, userCust)
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

    const composed = composeCustomizations(mockCodecCust, userCust)
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

    const composed = composeCustomizations(mockCodecCust, userCust)
    expect(composed.args).toEqual({ sessionId: { type: 'id' } })
  })

  it('works when user customization has no input', async () => {
    const userCust = { args: {} }

    const composed = composeCustomizations(mockCodecCust, userCust)
    const result = await composed.input({ db: { original: true } }, {})

    // Should still get codec ctx
    expect(result.ctx.db.wrapped).toBe(true)
  })

  it('propagates user top-level onSuccess (convex-helpers convention)', async () => {
    const onSuccessFn = () => {
      /* noop */
    }
    const userCust = {
      args: {},
      input: async () => ({
        ctx: {},
        args: {},
        onSuccess: onSuccessFn
      })
    }

    const composed = composeCustomizations(mockCodecCust, userCust)
    const result = await composed.input({}, {})

    expect(result.onSuccess).toBe(onSuccessFn)
  })
})

describe('createZodvexBuilder', () => {
  // Mock builder that captures the registered function
  const mockQueryBuilder = (fn: any) => fn

  const noOp = {
    args: {} as Record<string, never>,
    input: async (ctx: any, _args: any, _extra?: any) => ({ ctx: {}, args: {} })
  }

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
    const customized = zq.withContext({
      args: {},
      input: async (ctx: any) => ({ ctx: {}, args: {} })
    })
    expect(customized).toBeTypeOf('function')
  })

  it('.withContext() result does NOT have .withContext() (not chainable)', () => {
    const zq = createZodvexBuilder(mockQueryBuilder, noOp, zCustomQuery)
    const customized = zq.withContext({
      args: {},
      input: async (ctx: any) => ({ ctx: {}, args: {} })
    })
    expect((customized as any).withContext).toBeUndefined()
  })
})

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

describe('initZodvex integration', () => {
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

    const rawCtx = { db: createMockDbReader(userTableData) }
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

    const rawCtx = { db: createMockDbReader(userTableData) }
    const result = await fn.handler(rawCtx, {})

    expect(result[0].createdAt).toBeInstanceOf(Date)
  })

  it('zm base callable: ctx.db.insert() encodes runtime values', async () => {
    const { zm } = initZodvex(mockSchema, mockServer as any)

    const { db, calls } = createMockDbWriter(userTableData)

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

    const rawCtx = { db: createMockDbReader(userTableData) }
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

    const rawCtx = { db: createMockDbReader(userTableData) }
    const result = await fn.handler(rawCtx, { token: 'abc123' })
    expect(result).toBe('session-abc123')
  })
})

describe('initZodvex with wrapDb: false', () => {
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

    const rawCtx = { db: createMockDbReader(userTableData) }
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

    const rawCtx = { db: createMockDbReader(userTableData) }
    const result = await fn.handler(rawCtx, { id: 'users:1' })

    // No codec wrapping — raw timestamp
    expect(result.doc.createdAt).toBe(1700000000000)
    // User customization still works
    expect(result.user).toBe('AuthUser')
  })
})

// ---------------------------------------------------------------------------
// initZodvex with registry
// ---------------------------------------------------------------------------

describe('initZodvex with registry', () => {
  const mockSchema = { __zodTableMap: { users: userSchemas } }
  const mockServer = {
    query: (fn: any) => fn,
    mutation: (fn: any) => fn,
    action: (fn: any) => fn,
    internalQuery: (fn: any) => fn,
    internalMutation: (fn: any) => fn,
    internalAction: (fn: any) => fn
  }

  /** Create a fake FunctionReference with the well-known functionName symbol */
  function fakeRef(path: string) {
    return { [functionNameSymbol]: path } as any
  }

  const taskReturnsSchema = z.object({
    _id: z.string(),
    title: z.string(),
    createdAt: zx.date()
  })

  const registry = {
    'tasks:get': { returns: taskReturnsSchema }
  }

  it('should accept a lazy registry thunk', () => {
    const result = initZodvex(mockSchema, mockServer as any, {
      registry: () => registry
    })
    expect(result.za).toBeTypeOf('function')
    expect(result.zia).toBeTypeOf('function')
    expect(result.za.withContext).toBeTypeOf('function')
    expect(result.zia.withContext).toBeTypeOf('function')
  })

  it('za handler receives wrapped ctx.runQuery that decodes results', async () => {
    const ts = 1700000000000
    const { za } = initZodvex(mockSchema, mockServer as any, {
      registry: () => registry
    })

    const fn = za({
      handler: async (ctx: any) => {
        return ctx.runQuery(fakeRef('tasks:get'))
      }
    })

    const rawCtx = {
      runQuery: async () => ({ _id: 'abc', title: 'Test', createdAt: ts }),
      runMutation: async () => undefined,
      runAction: async () => undefined,
      auth: { getUserIdentity: async () => null }
    }

    const result: any = await fn.handler(rawCtx, {})

    // Should be decoded: number -> Date
    expect(result.createdAt).toBeInstanceOf(Date)
    expect(result.createdAt.getTime()).toBe(ts)
  })

  it('zia handler receives wrapped ctx.runMutation that decodes results', async () => {
    const ts = 1700000000000
    const { zia } = initZodvex(mockSchema, mockServer as any, {
      registry: () => registry
    })

    const fn = zia({
      handler: async (ctx: any) => {
        return ctx.runMutation(fakeRef('tasks:get'))
      }
    })

    const rawCtx = {
      runQuery: async () => undefined,
      runMutation: async () => ({ _id: 'abc', title: 'Test', createdAt: ts }),
      runAction: async () => undefined,
      auth: { getUserIdentity: async () => null }
    }

    const result: any = await fn.handler(rawCtx, {})

    // Should be decoded: number -> Date
    expect(result.createdAt).toBeInstanceOf(Date)
    expect(result.createdAt.getTime()).toBe(ts)
  })

  it('za handler without registry has no codec wrapping', async () => {
    const ts = 1700000000000
    const { za } = initZodvex(mockSchema, mockServer as any)

    const fn = za({
      handler: async (ctx: any) => {
        return ctx.runQuery(fakeRef('tasks:get'))
      }
    })

    const rawCtx = {
      runQuery: async () => ({ _id: 'abc', title: 'Test', createdAt: ts }),
      runMutation: async () => undefined,
      runAction: async () => undefined,
      auth: { getUserIdentity: async () => null }
    }

    const result: any = await fn.handler(rawCtx, {})

    // Without registry, no decoding — raw number stays as-is
    expect(result.createdAt).toBe(ts)
  })

  it('registry thunk is not called at construction time', () => {
    let called = false
    initZodvex(mockSchema, mockServer as any, {
      registry: () => {
        called = true
        return registry
      }
    })

    // The thunk should NOT have been called during initZodvex()
    expect(called).toBe(false)
  })

  it('za.withContext() composes registry codec with user customization', async () => {
    const ts = 1700000000000
    const { za } = initZodvex(mockSchema, mockServer as any, {
      registry: () => registry
    })

    const authedAction = za.withContext({
      args: {},
      input: async (ctx: any) => ({
        ctx: { user: 'AuthUser' },
        args: {}
      })
    })

    const fn = authedAction({
      handler: async (ctx: any) => {
        const doc = await ctx.runQuery(fakeRef('tasks:get'))
        return { doc, user: ctx.user }
      }
    })

    const rawCtx = {
      runQuery: async () => ({ _id: 'abc', title: 'Test', createdAt: ts }),
      runMutation: async () => undefined,
      runAction: async () => undefined,
      auth: { getUserIdentity: async () => null }
    }

    const result: any = await fn.handler(rawCtx, {})

    // Registry codec works: number -> Date
    expect(result.doc.createdAt).toBeInstanceOf(Date)
    // User customization works
    expect(result.user).toBe('AuthUser')
  })
})

// ---------------------------------------------------------------------------
// Type-level regression: Overwrite<T, {}> must preserve T, not collapse it.
// See: https://github.com/panzacoder/zodvex/issues — za.withContext() bug
// where Record<string, never> collapsed ActionCtx to { [k: string]: never }.
// ---------------------------------------------------------------------------
import type { Overwrite } from '../src/internal/types'

type ActionCtxLike = { auth: { getUserIdentity: () => Promise<null> }; runQuery: () => void }

// Empty overlay must preserve the original type
// biome-ignore lint/complexity/noBannedTypes: {} is the exact type under test — this is the regression guard
type WithEmpty = Overwrite<ActionCtxLike, {}>
const _checkAuth: WithEmpty['auth'] = {} as ActionCtxLike['auth']
const _checkRunQuery: WithEmpty['runQuery'] = {} as ActionCtxLike['runQuery']

// Non-empty overlay should still work (replace auth, keep runQuery)
type WithOverlay = Overwrite<ActionCtxLike, { auth: string }>
const _checkOverlayAuth: WithOverlay['auth'] = 'overridden'
const _checkOverlayRunQuery: WithOverlay['runQuery'] = {} as ActionCtxLike['runQuery']
