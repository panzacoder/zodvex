import { describe, expect, it } from 'bun:test'
import { z } from 'zod'
import {
  CodecDatabaseReader,
  CodecDatabaseWriter,
  CodecQueryChain,
  createZodDbReader,
  createZodDbWriter
} from '../src/db'
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

// Mock query chain — simulates Convex's QueryInitializer/Query/OrderedQuery
function createMockQuery(docs: any[]) {
  const mockQuery: any = {
    fullTableScan: () => mockQuery,
    withIndex: () => mockQuery,
    withSearchIndex: () => mockQuery,
    order: () => mockQuery,
    filter: () => mockQuery,
    limit: () => mockQuery,
    count: async () => docs.length,
    first: async () => docs[0] ?? null,
    unique: async () => {
      if (docs.length > 1) throw new Error('not unique')
      return docs[0] ?? null
    },
    collect: async () => docs,
    take: async (n: number) => docs.slice(0, n),
    paginate: async () => ({
      page: docs,
      isDone: true,
      continueCursor: 'cursor'
    }),
    [Symbol.asyncIterator]: async function* () {
      for (const doc of docs) yield doc
    }
  }
  return mockQuery
}

// Mock DB reader — simulates GenericDatabaseReader
function createMockDbReader(tables: Record<string, any[]>) {
  const mockDb: any = {
    system: { get: async () => null, query: () => ({}), normalizeId: () => null },
    normalizeId: (tableName: string, id: string) => {
      return id.startsWith(`${tableName}:`) ? id : null
    },
    get: async (idOrTable: string, maybeId?: string) => {
      if (maybeId !== undefined) {
        const docs = tables[idOrTable] ?? []
        return docs.find((d: any) => d._id === maybeId) ?? null
      }
      for (const docs of Object.values(tables)) {
        const doc = docs.find((d: any) => d._id === idOrTable)
        if (doc) return doc
      }
      return null
    },
    query: (tableName: string) => {
      const docs = tables[tableName] ?? []
      return createMockQuery(docs)
    }
  }
  return mockDb
}

describe('CodecQueryChain', () => {
  const wireDocs = [
    { _id: 'users:1', _creationTime: 100, name: 'Alice', createdAt: 1700000000000 },
    { _id: 'users:2', _creationTime: 200, name: 'Bob', createdAt: 1700100000000 }
  ]

  it('collect() decodes all documents', async () => {
    const chain = new CodecQueryChain(createMockQuery(wireDocs), userDocSchema)
    const results = await chain.collect()

    expect(results).toHaveLength(2)
    expect(results[0].createdAt).toBeInstanceOf(Date)
    expect(results[0].createdAt.getTime()).toBe(1700000000000)
    expect(results[1].createdAt).toBeInstanceOf(Date)
  })

  it('first() decodes a single document', async () => {
    const chain = new CodecQueryChain(createMockQuery(wireDocs), userDocSchema)
    const result = await chain.first()

    expect(result).not.toBeNull()
    expect(result?.createdAt).toBeInstanceOf(Date)
    expect(result?.name).toBe('Alice')
  })

  it('first() returns null for empty results', async () => {
    const chain = new CodecQueryChain(createMockQuery([]), userDocSchema)
    const result = await chain.first()

    expect(result).toBeNull()
  })

  it('unique() decodes a single document', async () => {
    const chain = new CodecQueryChain(createMockQuery([wireDocs[0]]), userDocSchema)
    const result = await chain.unique()

    expect(result).not.toBeNull()
    expect(result?.createdAt).toBeInstanceOf(Date)
  })

  it('take(n) decodes n documents', async () => {
    const chain = new CodecQueryChain(createMockQuery(wireDocs), userDocSchema)
    const results = await chain.take(1)

    expect(results).toHaveLength(1)
    expect(results[0].createdAt).toBeInstanceOf(Date)
  })

  it('paginate() decodes page items', async () => {
    const chain = new CodecQueryChain(createMockQuery(wireDocs), userDocSchema)
    const result = await chain.paginate({ numItems: 10, cursor: null })

    expect(result.page).toHaveLength(2)
    expect(result.page[0].createdAt).toBeInstanceOf(Date)
    expect(result.isDone).toBe(true)
    expect(result.continueCursor).toBe('cursor')
  })

  it('intermediate methods return wrapped chains', async () => {
    const chain = new CodecQueryChain(createMockQuery(wireDocs), userDocSchema)
    const results = await chain.order('asc').collect()
    expect(results[0].createdAt).toBeInstanceOf(Date)
  })

  it('fullTableScan() returns wrapped chain', async () => {
    const chain = new CodecQueryChain(createMockQuery(wireDocs), userDocSchema)
    const results = await chain.fullTableScan().collect()
    expect(results[0].createdAt).toBeInstanceOf(Date)
  })

  it('filter() returns wrapped chain', async () => {
    const chain = new CodecQueryChain(createMockQuery(wireDocs), userDocSchema)
    const results = await chain.filter(() => true).collect()
    expect(results[0].createdAt).toBeInstanceOf(Date)
  })

  it('limit() returns wrapped chain', async () => {
    const chain = new CodecQueryChain(createMockQuery(wireDocs), userDocSchema)
    const results = await chain.limit(1).collect()
    expect(results[0].createdAt).toBeInstanceOf(Date)
  })

  it('count() passes through without decoding', async () => {
    const chain = new CodecQueryChain(createMockQuery(wireDocs), userDocSchema)
    const count = await chain.count()
    expect(count).toBe(2)
  })

  it('propagates ZodError when document fails schema validation', async () => {
    const badDocs = [{ _id: 'users:1', _creationTime: 100, name: 123, createdAt: 'not-a-number' }]
    const chain = new CodecQueryChain(createMockQuery(badDocs), userDocSchema)
    await expect(chain.first()).rejects.toThrow()
  })

  it('async iteration decodes each document', async () => {
    const chain = new CodecQueryChain(createMockQuery(wireDocs), userDocSchema)
    const results: any[] = []

    for await (const doc of chain) {
      results.push(doc)
    }

    expect(results).toHaveLength(2)
    expect(results[0].createdAt).toBeInstanceOf(Date)
  })
})

describe('CodecDatabaseReader', () => {
  const tableMap = {
    users: userSchemas
  }

  const tableData = {
    users: [
      { _id: 'users:1', _creationTime: 100, name: 'Alice', createdAt: 1700000000000 },
      { _id: 'users:2', _creationTime: 200, name: 'Bob', createdAt: 1700100000000 }
    ]
  }

  it('get(id) decodes the document', async () => {
    const db = new CodecDatabaseReader(createMockDbReader(tableData), tableMap)
    const user = await db.get('users:1' as any)

    expect(user).not.toBeNull()
    expect(user?.name).toBe('Alice')
    expect(user?.createdAt).toBeInstanceOf(Date)
  })

  it('get(id) returns null for missing documents', async () => {
    const db = new CodecDatabaseReader(createMockDbReader(tableData), tableMap)
    const user = await db.get('users:missing' as any)

    expect(user).toBeNull()
  })

  it('get(table, id) decodes the document', async () => {
    const db = new CodecDatabaseReader(createMockDbReader(tableData), tableMap)
    const user = await db.get('users' as any, 'users:1' as any)

    expect(user).not.toBeNull()
    expect(user?.createdAt).toBeInstanceOf(Date)
  })

  it('query() returns a CodecQueryChain', async () => {
    const db = new CodecDatabaseReader(createMockDbReader(tableData), tableMap)
    const results = await db.query('users' as any).collect()

    expect(results).toHaveLength(2)
    expect(results[0].createdAt).toBeInstanceOf(Date)
  })

  it('passes through for tables not in the zodTableMap', async () => {
    const db = new CodecDatabaseReader(
      createMockDbReader({
        ...tableData,
        logs: [{ _id: 'logs:1', _creationTime: 100, message: 'hello' }]
      }),
      tableMap
    )

    const results = await db.query('logs' as any).collect()
    expect(results[0].message).toBe('hello')
  })

  it('normalizeId passes through to inner db', () => {
    const db = new CodecDatabaseReader(createMockDbReader(tableData), tableMap)
    const result = db.normalizeId('users' as any, 'users:1')

    expect(result).toBe('users:1')
  })

  it('system property passes through to inner db', () => {
    const db = new CodecDatabaseReader(createMockDbReader(tableData), tableMap)
    expect(db.system).toBeDefined()
  })
})

// Mock DB writer — extends mock reader with write operations
function createMockDbWriter(tables: Record<string, any[]>) {
  const calls: { method: string; args: any[] }[] = []
  const reader = createMockDbReader(tables)

  const mockDb: any = {
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
  }

  return { db: mockDb, calls }
}

describe('CodecDatabaseWriter', () => {
  const tableMap = {
    users: userSchemas
  }

  const tableData = {
    users: [{ _id: 'users:1', _creationTime: 100, name: 'Alice', createdAt: 1700000000000 }]
  }

  it('insert() encodes runtime values to wire format', async () => {
    const { db: mockDb, calls } = createMockDbWriter(tableData)
    const db = new CodecDatabaseWriter(mockDb, tableMap)

    const id = await db.insert(
      'users' as any,
      {
        name: 'Charlie',
        createdAt: new Date(1700000000000)
      } as any
    )

    expect(id).toBe('users:new')
    expect(calls).toHaveLength(1)
    expect(calls[0].method).toBe('insert')
    expect(calls[0].args[0]).toBe('users')
    expect(calls[0].args[1].createdAt).toBe(1700000000000)
    expect(calls[0].args[1].name).toBe('Charlie')
  })

  it('patch(id, value) encodes partial runtime values', async () => {
    const { db: mockDb, calls } = createMockDbWriter(tableData)
    const db = new CodecDatabaseWriter(mockDb, tableMap)

    await db.patch(
      'users:1' as any,
      {
        createdAt: new Date(1800000000000)
      } as any
    )

    expect(calls).toHaveLength(1)
    expect(calls[0].method).toBe('patch')
    expect(calls[0].args[1].createdAt).toBe(1800000000000)
  })

  it('replace(id, value) encodes full runtime document', async () => {
    const { db: mockDb, calls } = createMockDbWriter(tableData)
    const db = new CodecDatabaseWriter(mockDb, tableMap)

    await db.replace(
      'users:1' as any,
      {
        name: 'Alice Updated',
        createdAt: new Date(1800000000000)
      } as any
    )

    expect(calls).toHaveLength(1)
    expect(calls[0].method).toBe('replace')
    expect(calls[0].args[1].createdAt).toBe(1800000000000)
  })

  it('delete() passes through without encoding', async () => {
    const { db: mockDb, calls } = createMockDbWriter(tableData)
    const db = new CodecDatabaseWriter(mockDb, tableMap)

    await db.delete('users:1' as any)

    expect(calls).toHaveLength(1)
    expect(calls[0].method).toBe('delete')
    expect(calls[0].args[0]).toBe('users:1')
  })

  it('read methods delegate to CodecDatabaseReader', async () => {
    const { db: mockDb } = createMockDbWriter(tableData)
    const db = new CodecDatabaseWriter(mockDb, tableMap)

    const user = await db.get('users:1' as any)
    expect(user).not.toBeNull()
    expect(user?.createdAt).toBeInstanceOf(Date)

    const results = await db.query('users' as any).collect()
    expect(results[0].createdAt).toBeInstanceOf(Date)
  })

  it('passes through writes for tables not in zodTableMap', async () => {
    const { db: mockDb, calls } = createMockDbWriter(tableData)
    const db = new CodecDatabaseWriter(mockDb, tableMap)

    await db.insert('logs' as any, { message: 'hello' } as any)

    expect(calls).toHaveLength(1)
    expect(calls[0].args[1]).toEqual({ message: 'hello' })
  })
})

describe('createZodDbReader', () => {
  const tableData = {
    users: [{ _id: 'users:1', _creationTime: 100, name: 'Alice', createdAt: 1700000000000 }]
  }

  it('creates a CodecDatabaseReader from schema with __zodTableMap', async () => {
    const schema = { __zodTableMap: { users: userSchemas } }
    const db = createZodDbReader(createMockDbReader(tableData) as any, schema)

    const user = await db.get('users:1' as any)
    expect(user).not.toBeNull()
    expect(user?.createdAt).toBeInstanceOf(Date)
  })
})

describe('createZodDbWriter', () => {
  const tableData = {
    users: [{ _id: 'users:1', _creationTime: 100, name: 'Alice', createdAt: 1700000000000 }]
  }

  it('creates a CodecDatabaseWriter from schema with __zodTableMap', async () => {
    const schema = { __zodTableMap: { users: userSchemas } }
    const { db: mockDb, calls } = createMockDbWriter(tableData)
    const db = createZodDbWriter(mockDb as any, schema)

    await db.insert(
      'users' as any,
      {
        name: 'New',
        createdAt: new Date(1700000000000)
      } as any
    )

    expect(calls[0].args[1].createdAt).toBe(1700000000000)
  })
})
