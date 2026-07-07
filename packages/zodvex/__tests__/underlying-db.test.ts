import { Triggers } from 'convex-helpers/server/triggers'
import { describe, expect, it } from 'vitest'
import { createZodvexCustomization } from '../src/internal/customization'
import { createZodDbWriter, ZodvexDatabaseReader, ZodvexDatabaseWriter } from '../src/internal/db'
import { initZodvex } from '../src/internal/init'
import {
  createMockDbReader,
  createMockDbWriter,
  userTableData,
  userTableMap
} from './fixtures/mock-db'

/**
 * db-wrap composability (#92): the codec wrapper can delegate to a
 * user-supplied underlying db (`underlyingDb`), so native-shape layers like
 * convex-helpers triggers sit UNDER the codec layer:
 *
 *   codec (zodvex) → triggers (convex-helpers) → real db
 *
 * The underlying layer must observe wire-format writes (encode happens above
 * it), and `db.unwrap()` must return exactly the db the codec delegates to.
 */

/** A minimal stateful fake Convex db supporting the calls convex-helpers'
 * writerWithTriggers makes: insert, 2-arg get(table, id), patch, delete,
 * normalizeId. Stores documents as given (wire format). */
function createStatefulDb(initial?: Record<string, any[]>) {
  const tables: Record<string, any[]> = structuredClone(initial ?? {})
  let counter = 0

  const findTable = (id: string) => id.split(':')[0]
  // Return snapshots, like a real backend — callers must not observe later mutations
  const lookup = (table: string, id: string) => {
    const doc = (tables[table] ?? []).find((d: any) => d._id === id)
    return doc ? structuredClone(doc) : null
  }
  const live = (table: string, id: string) =>
    (tables[table] ?? []).find((d: any) => d._id === id) ?? null

  const db = {
    system: {},
    normalizeId: (tableName: string, id: string) => (id.startsWith(`${tableName}:`) ? id : null),
    get: async (idOrTable: string, maybeId?: string) => {
      if (maybeId !== undefined) return lookup(idOrTable, maybeId)
      return lookup(findTable(idOrTable), idOrTable)
    },
    insert: async (table: string, value: any) => {
      const id = `${table}:${++counter}`
      tables[table] = tables[table] ?? []
      tables[table].push({ _id: id, _creationTime: Date.now(), ...value })
      return id
    },
    patch: async (idOrTable: any, idOrValue: any, maybeValue?: any) => {
      const [table, id, value] =
        maybeValue !== undefined
          ? [idOrTable, idOrValue, maybeValue]
          : [findTable(idOrTable), idOrTable, idOrValue]
      const doc = live(table, id)
      if (!doc) throw new Error(`patch: ${id} not found`)
      Object.assign(doc, value)
    },
    replace: async (idOrTable: any, idOrValue: any, maybeValue?: any) => {
      const [table, id, value] =
        maybeValue !== undefined
          ? [idOrTable, idOrValue, maybeValue]
          : [findTable(idOrTable), idOrTable, idOrValue]
      const doc = live(table, id)
      if (!doc) throw new Error(`replace: ${id} not found`)
      const preserved = { _id: doc._id, _creationTime: doc._creationTime }
      for (const key of Object.keys(doc)) delete doc[key]
      Object.assign(doc, value, preserved)
    },
    delete: async (idOrTable: any, maybeId?: any) => {
      const [table, id] =
        maybeId !== undefined ? [idOrTable, maybeId] : [findTable(idOrTable), idOrTable]
      tables[table] = (tables[table] ?? []).filter((d: any) => d._id !== id)
    },
    query: (tableName: string) => ({
      fullTableScan: () => ({ collect: async () => tables[tableName] ?? [] }),
      collect: async () => tables[tableName] ?? []
    })
  }

  return { db, tables }
}

describe('createZodvexCustomization with underlyingDb', () => {
  it('mutation writes route through the underlying db, in wire format', async () => {
    const { db: raw, calls } = createMockDbWriter(userTableData)
    const seen: any[] = []
    const underlying = {
      ...raw,
      insert: async (table: string, value: any) => {
        seen.push({ table, value })
        return raw.insert(table, value)
      }
    }

    const codec = createZodvexCustomization(userTableMap, {
      underlyingDb: { mutation: () => underlying as any }
    })
    const result = await codec.mutation.input({ db: raw }, {})

    await result.ctx.db.insert('users', { name: 'Bob', createdAt: new Date(1700000000000) })

    // Underlying layer saw the write — already encoded to wire format
    expect(seen).toHaveLength(1)
    expect(seen[0].value.createdAt).toBe(1700000000000)
    // ...and forwarded it to the real db
    expect(calls[0].args[1].createdAt).toBe(1700000000000)
  })

  it('mutation resolver receives the raw ctx', async () => {
    const { db: raw } = createMockDbWriter(userTableData)
    const ctx = { db: raw, auth: { tokenIdentifier: 'test' } }
    let receivedCtx: any
    const codec = createZodvexCustomization(userTableMap, {
      underlyingDb: {
        mutation: c => {
          receivedCtx = c
          return c.db
        }
      }
    })
    await codec.mutation.input(ctx, {})
    expect(receivedCtx).toBe(ctx)
  })

  it('query reads route through the underlying db and still decode', async () => {
    const raw = createMockDbReader(userTableData)
    let used = false
    const underlying = {
      ...raw,
      get: async (id: string) => {
        used = true
        return raw.get(id)
      }
    }

    const codec = createZodvexCustomization(userTableMap, {
      underlyingDb: { query: () => underlying as any }
    })
    const result = await codec.query.input({ db: raw }, {})

    const user = await result.ctx.db.get('users:1')
    expect(used).toBe(true)
    expect(user.createdAt).toBeInstanceOf(Date)
  })

  it('without underlyingDb, ctx.db is used directly (unchanged behavior)', async () => {
    const codec = createZodvexCustomization(userTableMap)
    const raw = createMockDbReader(userTableData)
    const result = await codec.query.input({ db: raw }, {})
    expect(result.ctx.db.unwrap()).toBe(raw)
  })
})

describe('initZodvex with underlyingDb', () => {
  const server = {
    query: (def: any) => def,
    mutation: (def: any) => def,
    action: (def: any) => def,
    internalQuery: (def: any) => def,
    internalMutation: (def: any) => def,
    internalAction: (def: any) => def
  } as any
  const schema = { __zodTableMap: userTableMap } as any

  it('zm handler sees codec db delegating to the underlying db', async () => {
    const { db: raw, calls } = createMockDbWriter(userTableData)
    const seen: any[] = []
    const underlying = {
      ...raw,
      insert: async (table: string, value: any) => {
        seen.push({ table, value })
        return raw.insert(table, value)
      }
    }

    const { zm } = initZodvex(schema, server, {
      underlyingDb: { mutation: () => underlying as any }
    }) as any

    const fn = zm({
      handler: async (ctx: any) => {
        await ctx.db.insert('users', { name: 'Eve', createdAt: new Date(1700000000000) })
        return null
      }
    })
    await fn.handler({ db: raw }, {})

    expect(seen).toHaveLength(1)
    expect(seen[0].value.createdAt).toBe(1700000000000)
    expect(calls[0].args[1].createdAt).toBe(1700000000000)
  })

  it('throws when combined with wrapDb: false', () => {
    expect(() =>
      initZodvex(schema, server, {
        wrapDb: false,
        underlyingDb: { mutation: (ctx: any) => ctx.db }
      } as any)
    ).toThrow(/underlyingDb.*wrapDb/)
  })

  it('.withContext() customizations still see the composed codec db', async () => {
    const { db: raw } = createMockDbWriter(userTableData)
    const underlying = { ...raw }

    const { zm } = initZodvex(schema, server, {
      underlyingDb: { mutation: () => underlying as any }
    }) as any

    let ctxDbInCustomization: any
    const builder = zm.withContext({
      args: {},
      input: async (ctx: any) => {
        ctxDbInCustomization = ctx.db
        return { ctx: { role: 'admin' }, args: {} }
      }
    })
    const fn = builder({
      handler: async (ctx: any) => ({ role: ctx.role, sameDb: ctx.db === ctxDbInCustomization })
    })
    const result = await fn.handler({ db: raw }, {})

    expect(ctxDbInCustomization).toBeInstanceOf(ZodvexDatabaseWriter)
    expect(ctxDbInCustomization.unwrap()).toBe(underlying)
    expect(result).toEqual({ role: 'admin', sameDb: true })
  })
})

describe('unwrap() escape hatch', () => {
  it('reader returns the bare db when no underlying db is configured', () => {
    const raw = createMockDbReader(userTableData)
    const reader = new ZodvexDatabaseReader(raw as any, userTableMap)
    expect(reader.unwrap()).toBe(raw)
  })

  it('writer returns the underlying db it delegates to', () => {
    const { db: raw } = createMockDbWriter(userTableData)
    const underlying = { ...raw }
    const writer = new ZodvexDatabaseWriter(underlying as any, userTableMap)
    expect(writer.unwrap()).toBe(underlying)
  })

  it('survives .withRules() — unwrap bypasses rules and codec', () => {
    const { db: raw } = createMockDbWriter(userTableData)
    const writer = new ZodvexDatabaseWriter(raw as any, userTableMap)
    const ruled = writer.withRules({}, { users: { insert: async () => false } })
    expect(ruled.unwrap()).toBe(raw)
  })

  it('survives .audit()', () => {
    const { db: raw } = createMockDbWriter(userTableData)
    const writer = new ZodvexDatabaseWriter(raw as any, userTableMap)
    const audited = writer.audit({
      onWrite: async () => {
        /* no-op audit sink */
      }
    })
    expect(audited.unwrap()).toBe(raw)
  })
})

describe('composition with real convex-helpers Triggers', () => {
  it('triggers fire on codec-encoded writes through the composed stack', async () => {
    const { db: raw } = createStatefulDb()
    const changes: any[] = []

    const triggers = new Triggers<any>()
    triggers.register('users', async (_ctx, change) => {
      changes.push(change)
    })

    const rawCtx = { db: raw } as any
    const writer = createZodDbWriter(triggers.wrapDB(rawCtx).db, {
      __zodTableMap: userTableMap
    })

    // Insert with a decoded Date — codec encodes BEFORE the trigger layer
    const id = await writer.insert('users', {
      name: 'Alice',
      createdAt: new Date(1700000000000)
    } as any)

    expect(changes).toHaveLength(1)
    expect(changes[0].operation).toBe('insert')
    // The trigger saw the wire-format doc: number, not Date (encode ordering pinned)
    expect(changes[0].newDoc.createdAt).toBe(1700000000000)
    expect(changes[0].newDoc.createdAt).not.toBeInstanceOf(Date)

    // Patch through the codec layer also fires the trigger with wire values
    await writer.patch(id as any, { createdAt: new Date(1800000000000) } as any)
    expect(changes).toHaveLength(2)
    expect(changes[1].operation).toBe('update')
    expect(changes[1].oldDoc.createdAt).toBe(1700000000000)
    expect(changes[1].newDoc.createdAt).toBe(1800000000000)

    // Delete fires too
    await writer.delete(id as any)
    expect(changes).toHaveLength(3)
    expect(changes[2].operation).toBe('delete')
    expect(changes[2].newDoc).toBeNull()

    // Reads back through the codec layer decode as usual
    const before = changes[2].oldDoc
    expect(before.createdAt).toBe(1800000000000)
  })

  it('trigger-maintained count stays correct under .withRules() on top', async () => {
    const { db: raw, tables } = createStatefulDb({
      counters: [{ _id: 'counters:1', _creationTime: 0, table: 'users', count: 0 }]
    })

    const triggers = new Triggers<any>()
    triggers.register('users', async (ctx: any, change: any) => {
      const delta = change.operation === 'insert' ? 1 : change.operation === 'delete' ? -1 : 0
      if (delta === 0) return
      const counter = await ctx.innerDb.get('counters', 'counters:1')
      await ctx.innerDb.patch('counters', 'counters:1', { count: counter.count + delta })
    })

    const rawCtx = { db: raw } as any
    const base = new ZodvexDatabaseWriter(triggers.wrapDB(rawCtx).db as any, userTableMap)
    const writer = base.withRules(
      {},
      {
        users: {
          insert: async (_ctx: any, doc: any) => {
            if (doc.name === 'blocked') throw new Error('insert denied')
            return doc
          }
        }
      }
    )

    const id1 = await writer.insert('users', {
      name: 'A',
      createdAt: new Date(1700000000000)
    } as any)
    await writer.insert('users', { name: 'B', createdAt: new Date(1700000000000) } as any)
    expect(tables.counters[0].count).toBe(2)

    // Rules layer denies BEFORE encode/triggers — count unchanged
    await expect(
      writer.insert('users', { name: 'blocked', createdAt: new Date(1700000000000) } as any)
    ).rejects.toThrow()
    expect(tables.counters[0].count).toBe(2)

    await writer.delete(id1 as any)
    expect(tables.counters[0].count).toBe(1)

    // The stored user docs are wire format (encoded above the trigger layer)
    expect(tables.users.every((d: any) => typeof d.createdAt === 'number')).toBe(true)
  })
})
