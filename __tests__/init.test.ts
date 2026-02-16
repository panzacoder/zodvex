import { describe, expect, it } from 'bun:test'
import { z } from 'zod'
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

// Mock server
const server = {
  query: (fn: any) => fn,
  mutation: (fn: any) => fn,
  action: (fn: any) => fn,
  internalQuery: (fn: any) => fn,
  internalMutation: (fn: any) => fn,
  internalAction: (fn: any) => fn
}

describe('initZodvex', () => {
  it('returns builders: zq, zm, za, ziq, zim, zia', () => {
    const result = initZodvex(schema, server as any)
    expect(result.zq).toBeDefined()
    expect(result.zm).toBeDefined()
    expect(result.za).toBeDefined()
    expect(result.ziq).toBeDefined()
    expect(result.zim).toBeDefined()
    expect(result.zia).toBeDefined()
  })

  it('returns zCustomCtx and zCustomCtxWithArgs', () => {
    const result = initZodvex(schema, server as any)
    expect(result.zCustomCtx).toBeDefined()
    expect(result.zCustomCtxWithArgs).toBeDefined()
  })

  it('zq produces a function when called with config', () => {
    const { zq } = initZodvex(schema, server as any)
    const fn = zq({
      args: { title: z.string() },
      handler: async (ctx: any, args: any) => {
        return args.title
      }
    })
    expect(fn).toBeDefined()
  })

  it('zq.withContext returns a new builder', () => {
    const { zq, zCustomCtx } = initZodvex(schema, server as any)
    const authCtx = zCustomCtx(async (ctx: any) => {
      return { user: { name: 'test' } }
    })
    const authQuery = zq.withContext(authCtx)
    expect(authQuery).toBeDefined()
    expect(typeof authQuery).toBe('function')
  })

  it('zq.withContext().withHooks() returns a new builder', () => {
    const { zq, zCustomCtx } = initZodvex(schema, server as any)
    const authCtx = zCustomCtx(async (ctx: any) => {
      return { user: { name: 'test' } }
    })
    const hooks = {
      decode: {
        after: {
          one: async (_ctx: any, doc: any) => doc
        }
      }
    }
    const hooked = zq.withContext(authCtx).withHooks(hooks)
    expect(hooked).toBeDefined()
    expect(typeof hooked).toBe('function')
  })
})
