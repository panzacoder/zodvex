import { describe, expect, it } from 'bun:test'
import { z } from 'zod'
import { createZodDbReader } from '../../src/db/wrapper'
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

// Helper to create mock Convex db reader
function createMockReader(data: Record<string, any>) {
  return {
    get: async (id: string) => data[id] ?? null,
    query: (table: string) => {
      const docs = Object.values(data).filter((d: any) => d._table === table)
      let chain: any
      chain = {
        withIndex: (_name: string, _fn?: any) => chain,
        filter: (_fn: any) => chain,
        order: (_order: string) => chain,
        collect: async () => docs,
        first: async () => docs[0] ?? null,
        unique: async () => (docs.length === 1 ? docs[0] : null),
        take: async (n: number) => docs.slice(0, n)
      }
      return chain
    }
  }
}

describe('createZodDbReader', () => {
  it('decodes documents from db.get()', async () => {
    const db = createMockReader({
      'events:1': {
        _id: 'events:1',
        _creationTime: 1000,
        _table: 'events',
        title: 'Meeting',
        startDate: 1700000000000
      }
    })

    const zodDb = createZodDbReader(db as any, zodTables)
    const event = await zodDb.get('events:1' as any)

    expect(event).not.toBeNull()
    expect(event?.title).toBe('Meeting')
    expect(event?.startDate).toBeInstanceOf(Date)
    expect(event?.startDate.getTime()).toBe(1700000000000)
  })

  it('returns null from db.get() when document not found', async () => {
    const db = createMockReader({})
    const zodDb = createZodDbReader(db as any, zodTables)
    const result = await zodDb.get('events:999' as any)
    expect(result).toBeNull()
  })

  it('decodes documents from query().collect()', async () => {
    const db = createMockReader({
      'events:1': {
        _id: 'events:1',
        _creationTime: 1000,
        _table: 'events',
        title: 'Meeting',
        startDate: 1700000000000
      },
      'events:2': {
        _id: 'events:2',
        _creationTime: 2000,
        _table: 'events',
        title: 'Lunch',
        startDate: 1700100000000
      }
    })

    const zodDb = createZodDbReader(db as any, zodTables)
    const events = await zodDb.query('events').collect()

    expect(events).toHaveLength(2)
    expect(events[0].startDate).toBeInstanceOf(Date)
    expect(events[1].startDate).toBeInstanceOf(Date)
  })

  it('decodes documents from query().first()', async () => {
    const db = createMockReader({
      'events:1': {
        _id: 'events:1',
        _creationTime: 1000,
        _table: 'events',
        title: 'First',
        startDate: 1700000000000
      }
    })

    const zodDb = createZodDbReader(db as any, zodTables)
    const event = await zodDb.query('events').first()

    expect(event).not.toBeNull()
    expect(event?.startDate).toBeInstanceOf(Date)
  })

  it('returns null from query().first() when no results', async () => {
    const db = createMockReader({})
    const zodDb = createZodDbReader(db as any, zodTables)
    const result = await zodDb.query('events').first()
    expect(result).toBeNull()
  })

  it('decodes documents from query().take()', async () => {
    const db = createMockReader({
      'events:1': {
        _id: 'events:1',
        _creationTime: 1000,
        _table: 'events',
        title: 'A',
        startDate: 1700000000000
      },
      'events:2': {
        _id: 'events:2',
        _creationTime: 2000,
        _table: 'events',
        title: 'B',
        startDate: 1700100000000
      }
    })

    const zodDb = createZodDbReader(db as any, zodTables)
    const events = await zodDb.query('events').take(1)

    expect(events).toHaveLength(1)
    expect(events[0].startDate).toBeInstanceOf(Date)
  })

  it('chains query methods (withIndex, order, filter)', async () => {
    const db = createMockReader({
      'events:1': {
        _id: 'events:1',
        _creationTime: 1000,
        _table: 'events',
        title: 'Test',
        startDate: 1700000000000
      }
    })

    const zodDb = createZodDbReader(db as any, zodTables)
    // Should not throw - all chain methods delegate
    const events = await zodDb.query('events').withIndex('startDate').order('desc').collect()

    expect(events).toHaveLength(1)
    expect(events[0].startDate).toBeInstanceOf(Date)
  })

  it('applies decode.before.one hook (can filter)', async () => {
    const db = createMockReader({
      'events:1': {
        _id: 'events:1',
        _creationTime: 1000,
        _table: 'events',
        title: 'Secret',
        startDate: 1700000000000
      }
    })

    const hooks = {
      decode: {
        before: {
          one: async (_ctx: any, _doc: any) => null // deny all
        }
      }
    }

    const zodDb = createZodDbReader(db as any, zodTables, hooks)
    const result = await zodDb.get('events:1' as any)
    expect(result).toBeNull()
  })

  it('applies decode.after.one hook (can transform)', async () => {
    const db = createMockReader({
      'events:1': {
        _id: 'events:1',
        _creationTime: 1000,
        _table: 'events',
        title: 'Test',
        startDate: 1700000000000
      }
    })

    const hooks = {
      decode: {
        after: {
          one: async (_ctx: any, doc: any) => ({ ...doc, enriched: true })
        }
      }
    }

    const zodDb = createZodDbReader(db as any, zodTables, hooks)
    const event = await zodDb.get('events:1' as any)
    expect(event?.enriched).toBe(true)
    expect(event?.startDate).toBeInstanceOf(Date) // still decoded
  })

  it('applies decode.before.one to filter in query().collect()', async () => {
    const db = createMockReader({
      'events:1': {
        _id: 'events:1',
        _creationTime: 1000,
        _table: 'events',
        title: 'Public',
        startDate: 1700000000000
      },
      'events:2': {
        _id: 'events:2',
        _creationTime: 2000,
        _table: 'events',
        title: 'Secret',
        startDate: 1700100000000
      }
    })

    const hooks = {
      decode: {
        before: {
          one: async (_ctx: any, doc: any) => {
            return doc.title === 'Secret' ? null : doc
          }
        }
      }
    }

    const zodDb = createZodDbReader(db as any, zodTables, hooks)
    const events = await zodDb.query('events').collect()
    expect(events).toHaveLength(1)
    expect(events[0].title).toBe('Public')
  })
})
