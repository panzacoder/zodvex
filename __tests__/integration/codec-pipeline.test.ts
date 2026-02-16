import { describe, expect, it } from 'bun:test'
import { z } from 'zod'
import { composeHooks, createDatabaseHooks } from '../../src/db/hooks'
import { initZodvex } from '../../src/init'
import { defineZodSchema } from '../../src/schema'
import { zodTable } from '../../src/tables'
import { zx } from '../../src/zx'

// ============================================================================
// Setup (mirrors example/convex/schema.ts pattern)
// ============================================================================

const STATE_MAP: Record<string, string> = { CA: 'California', NY: 'New York' }
const REVERSE_MAP: Record<string, string> = { California: 'CA', 'New York': 'NY' }

const stateCode = () =>
  zx.codec(z.string(), z.string(), {
    decode: (code: string) => STATE_MAP[code] ?? code,
    encode: (name: string) => REVERSE_MAP[name] ?? name
  })

const Users = zodTable('users', {
  name: z.string(),
  email: z.string(),
  state: stateCode()
})

const Events = zodTable('events', {
  title: z.string(),
  startDate: zx.date(),
  endDate: zx.date().optional(),
  organizerId: zx.id('users')
})

const schema = defineZodSchema({ users: Users, events: Events })

// In-memory mock database
function createMockDb() {
  const store: Record<string, any> = {}
  let nextId = 1

  return {
    store,
    get: async (id: string) => store[id] ?? null,
    query: (table: string) => {
      const docs = () => Object.values(store).filter((d: any) => d._table === table)
      return {
        collect: async () => docs(),
        first: async () => docs()[0] ?? null,
        unique: async () => (docs().length === 1 ? docs()[0] : null),
        take: async (n: number) => docs().slice(0, n),
        withIndex: function () {
          return this
        },
        order: function () {
          return this
        },
        filter: function () {
          return this
        }
      }
    },
    insert: async (table: string, doc: any) => {
      const id = `${table}:${nextId++}`
      store[id] = { ...doc, _id: id, _creationTime: Date.now(), _table: table }
      return id
    },
    patch: async (id: string, patch: any) => {
      if (!store[id]) throw new Error('Not found')
      Object.assign(store[id], patch)
    },
    delete: async (id: string) => {
      delete store[id]
    }
  }
}

// Mock server that passes handler through but injects mock db
function createMockServer(db: any) {
  const wrapper = (fn: any) => {
    // Return the handler with ctx.db injected
    return {
      ...fn,
      _handler: fn.handler,
      _invoke: async (args: any) => fn.handler({ db }, args)
    }
  }
  return {
    query: wrapper,
    mutation: wrapper,
    action: wrapper,
    internalQuery: wrapper,
    internalMutation: wrapper,
    internalAction: wrapper
  }
}

describe('Full codec pipeline integration', () => {
  it('decodes zx.date() on read through initZodvex builder', async () => {
    const db = createMockDb()
    // Seed wire-format data
    db.store['events:1'] = {
      _id: 'events:1',
      _creationTime: 1000,
      _table: 'events',
      title: 'Meeting',
      startDate: 1700000000000,
      organizerId: 'users:1'
    }

    const server = createMockServer(db)
    const { zq } = initZodvex(schema, server as any)

    const getEvent = zq({
      args: { eventId: zx.id('events') },
      handler: async (ctx: any, { eventId }: any) => {
        const event = await ctx.db.get(eventId)
        // Should be decoded: Date, not number
        expect(event.startDate).toBeInstanceOf(Date)
        expect(event.startDate.getTime()).toBe(1700000000000)
        return event
      }
    })

    await getEvent._invoke({ eventId: 'events:1' })
  })

  it('encodes stateCode() on write through initZodvex builder', async () => {
    const db = createMockDb()
    const server = createMockServer(db)
    const { zm } = initZodvex(schema, server as any)

    const createUser = zm({
      args: { name: z.string(), email: z.string(), state: stateCode() },
      handler: async (ctx: any, args: any) => {
        return ctx.db.insert('users', args)
      }
    })

    const id = await createUser._invoke({
      name: 'John',
      email: 'john@test.com',
      state: 'California'
    })

    // Wire format in DB should be "CA"
    expect(db.store[id].state).toBe('CA')
  })

  it('hooks compose correctly: validation then logging', async () => {
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
    const { zq, zCustomCtx } = initZodvex(schema, server as any)

    const adminCtx = zCustomCtx(async () => ({
      user: { name: 'Admin', role: 'admin' }
    }))

    const validationHooks = createDatabaseHooks<any>({
      decode: {
        before: {
          one: async (ctx: any, doc: any) => {
            log.push('validation')
            if (ctx.user.role !== 'admin') return null
            return doc
          }
        }
      }
    })

    const loggingHooks = createDatabaseHooks<any>({
      decode: {
        after: {
          one: async (ctx: any, doc: any) => {
            log.push('logging')
            return doc
          }
        }
      }
    })

    const composed = composeHooks([validationHooks, loggingHooks])
    const adminQuery = zq.withContext(adminCtx).withHooks(composed)

    const listUsers = adminQuery({
      args: {},
      handler: async (ctx: any) => {
        return ctx.db.query('users').collect()
      }
    })

    await listUsers._invoke({})
    expect(log).toEqual(['validation', 'logging'])
  })
})
