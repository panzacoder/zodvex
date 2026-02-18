import { describe, expect, it } from 'bun:test'
import { z } from 'zod'
import { zCustomQuery } from '../src/custom'
import { composeCodecAndUser, createZodvexBuilder, initZodvex } from '../src/init'
import type { ZodTableSchemas } from '../src/schema'
import { zx } from '../src/zx'

// --- Shared test fixtures ---

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
      patch: async (...args: any[]) => {
        calls.push({ method: 'patch', args })
      },
      replace: async (...args: any[]) => {
        calls.push({ method: 'replace', args })
      },
      delete: async (...args: any[]) => {
        calls.push({ method: 'delete', args })
      }
    },
    calls
  }
}

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
