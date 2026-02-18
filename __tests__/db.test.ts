import { describe, expect, it } from 'bun:test'
import { z } from 'zod'
import { CodecDatabaseReader, CodecQueryChain } from '../src/db'
import { zx } from '../src/zx'

const userDocSchema = z.object({
  _id: z.string(),
  _creationTime: z.number(),
  name: z.string(),
  createdAt: zx.date()
})

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

  it('count() passes through without decoding', async () => {
    const chain = new CodecQueryChain(createMockQuery(wireDocs), userDocSchema)
    const count = await chain.count()
    expect(count).toBe(2)
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
    users: userDocSchema
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
