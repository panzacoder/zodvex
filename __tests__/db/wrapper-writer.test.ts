import { describe, expect, it } from 'bun:test'
import { z } from 'zod'
import { createZodDbWriter } from '../../src/db/wrapper'
import { zodTable } from '../../src/tables'
import { zx } from '../../src/zx'

const Events = zodTable('events', {
  title: z.string(),
  startDate: zx.date()
})

const Users = zodTable('users', {
  name: z.string(),
  email: z.string()
})

const zodTables = { events: Events, users: Users }

function createMockDb() {
  const store: Record<string, any> = {}
  let nextId = 1

  return {
    store,
    db: {
      get: async (id: string) => store[id] ?? null,
      query: (table: string) => {
        const docs = () => Object.values(store).filter((d: any) => d._table === table)
        let chain: any
        chain = {
          withIndex: () => chain,
          filter: () => chain,
          order: () => chain,
          collect: async () => docs(),
          first: async () => docs()[0] ?? null,
          unique: async () => (docs().length === 1 ? docs()[0] : null),
          take: async (n: number) => docs().slice(0, n)
        }
        return chain
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
}

describe('createZodDbWriter', () => {
  it('encodes Date to timestamp on insert', async () => {
    const { db, store } = createMockDb()
    const zodDb = createZodDbWriter(db as any, zodTables)

    const id = await zodDb.insert('events', {
      title: 'Meeting',
      startDate: new Date(1700000000000)
    })

    expect(store[id].startDate).toBe(1700000000000)
    expect(typeof store[id].startDate).toBe('number')
    expect(store[id].title).toBe('Meeting')
  })

  it('encodes Date to timestamp on patch', async () => {
    const { db, store } = createMockDb()
    store['events:99'] = {
      _id: 'events:99',
      _creationTime: 1000,
      _table: 'events',
      title: 'Old',
      startDate: 1600000000000
    }

    const zodDb = createZodDbWriter(db as any, zodTables)
    await zodDb.patch('events:99' as any, {
      startDate: new Date(1700000000000)
    })

    expect(store['events:99'].startDate).toBe(1700000000000)
  })

  it('delete passes through to underlying db', async () => {
    const { db, store } = createMockDb()
    store['events:99'] = { _id: 'events:99', _table: 'events' }

    const zodDb = createZodDbWriter(db as any, zodTables)
    await zodDb.delete('events:99' as any)

    expect(store['events:99']).toBeUndefined()
  })

  it('writer also supports reading (get/query) with decode', async () => {
    const { db, store } = createMockDb()
    store['events:99'] = {
      _id: 'events:99',
      _creationTime: 1000,
      _table: 'events',
      title: 'Test',
      startDate: 1700000000000
    }

    const zodDb = createZodDbWriter(db as any, zodTables)
    const event = await zodDb.get('events:99' as any)

    expect(event?.startDate).toBeInstanceOf(Date)
  })

  it('calls encode.before hook on insert', async () => {
    const log: string[] = []
    const { db } = createMockDb()

    const hooks = {
      encode: {
        before: async (_ctx: any, doc: any) => {
          log.push('encode.before')
          return doc
        }
      }
    }

    const zodDb = createZodDbWriter(db as any, zodTables, hooks)
    await zodDb.insert('events', {
      title: 'Test',
      startDate: new Date(1700000000000)
    })

    expect(log).toContain('encode.before')
  })

  it('calls encode.before hook on patch with existingDoc in context', async () => {
    const { db, store } = createMockDb()
    store['events:99'] = {
      _id: 'events:99',
      _creationTime: 1000,
      _table: 'events',
      title: 'Existing',
      startDate: 1600000000000
    }

    let capturedCtx: any = null
    const hooks = {
      encode: {
        before: async (ctx: any, doc: any) => {
          capturedCtx = ctx
          return doc
        }
      }
    }

    const zodDb = createZodDbWriter(db as any, zodTables, hooks)
    await zodDb.patch('events:99' as any, { title: 'Updated' })

    expect(capturedCtx.operation).toBe('patch')
    expect(capturedCtx.existingDoc).toBeDefined()
    expect(capturedCtx.existingDoc.title).toBe('Existing')
  })

  it('encode.before hook can deny insert by returning null', async () => {
    const { db } = createMockDb()

    const hooks = {
      encode: {
        before: async () => null
      }
    }

    const zodDb = createZodDbWriter(db as any, zodTables, hooks)
    expect(zodDb.insert('events', { title: 'Denied', startDate: new Date() })).rejects.toThrow()
  })

  it('handles tables without codecs (no-op encode)', async () => {
    const { db, store } = createMockDb()
    const zodDb = createZodDbWriter(db as any, zodTables)

    const id = await zodDb.insert('users', {
      name: 'John',
      email: 'john@test.com'
    })

    expect(store[id].name).toBe('John')
    expect(store[id].email).toBe('john@test.com')
  })
})
