import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { zodvexCodec } from '../src/internal/codec'
import {
  createZodDbReader,
  createZodDbWriter,
  ZodvexDatabaseReader,
  ZodvexDatabaseWriter,
  ZodvexQueryChain
} from '../src/internal/db'
import type { ZodTableSchemas } from '../src/internal/schema'
import { zx } from '../src/internal/zx'

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
  update: userInsertSchema.partial().extend({ _id: z.string() }),
  paginatedDoc: z.object({
    page: z.array(userDocSchema),
    isDone: z.boolean(),
    continueCursor: z.string(),
    splitCursor: z.string().nullable().optional(),
    pageStatus: z.enum(['SplitRecommended', 'SplitRequired']).nullable().optional()
  })
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

describe('ZodvexQueryChain', () => {
  const wireDocs = [
    { _id: 'users:1', _creationTime: 100, name: 'Alice', createdAt: 1700000000000 },
    { _id: 'users:2', _creationTime: 200, name: 'Bob', createdAt: 1700100000000 }
  ]

  it('collect() decodes all documents', async () => {
    const chain = new ZodvexQueryChain(createMockQuery(wireDocs), userDocSchema)
    const results = await chain.collect()

    expect(results).toHaveLength(2)
    expect(results[0].createdAt).toBeInstanceOf(Date)
    expect(results[0].createdAt.getTime()).toBe(1700000000000)
    expect(results[1].createdAt).toBeInstanceOf(Date)
  })

  it('first() decodes a single document', async () => {
    const chain = new ZodvexQueryChain(createMockQuery(wireDocs), userDocSchema)
    const result = await chain.first()

    expect(result).not.toBeNull()
    expect(result?.createdAt).toBeInstanceOf(Date)
    expect(result?.name).toBe('Alice')
  })

  it('first() returns null for empty results', async () => {
    const chain = new ZodvexQueryChain(createMockQuery([]), userDocSchema)
    const result = await chain.first()

    expect(result).toBeNull()
  })

  it('unique() decodes a single document', async () => {
    const chain = new ZodvexQueryChain(createMockQuery([wireDocs[0]]), userDocSchema)
    const result = await chain.unique()

    expect(result).not.toBeNull()
    expect(result?.createdAt).toBeInstanceOf(Date)
  })

  it('take(n) decodes n documents', async () => {
    const chain = new ZodvexQueryChain(createMockQuery(wireDocs), userDocSchema)
    const results = await chain.take(1)

    expect(results).toHaveLength(1)
    expect(results[0].createdAt).toBeInstanceOf(Date)
  })

  it('paginate() decodes page items', async () => {
    const chain = new ZodvexQueryChain(createMockQuery(wireDocs), userDocSchema)
    const result = await chain.paginate({ numItems: 10, cursor: null })

    expect(result.page).toHaveLength(2)
    expect(result.page[0].createdAt).toBeInstanceOf(Date)
    expect(result.isDone).toBe(true)
    expect(result.continueCursor).toBe('cursor')
  })

  it('intermediate methods return wrapped chains', async () => {
    const chain = new ZodvexQueryChain(createMockQuery(wireDocs), userDocSchema)
    const results = await chain.order('asc').collect()
    expect(results[0].createdAt).toBeInstanceOf(Date)
  })

  it('fullTableScan() returns wrapped chain', async () => {
    const chain = new ZodvexQueryChain(createMockQuery(wireDocs), userDocSchema)
    const results = await chain.fullTableScan().collect()
    expect(results[0].createdAt).toBeInstanceOf(Date)
  })

  it('filter() returns wrapped chain', async () => {
    const chain = new ZodvexQueryChain(createMockQuery(wireDocs), userDocSchema)
    const results = await chain.filter(() => true).collect()
    expect(results[0].createdAt).toBeInstanceOf(Date)
  })

  it('limit() returns wrapped chain', async () => {
    const chain = new ZodvexQueryChain(createMockQuery(wireDocs), userDocSchema)
    const results = await chain.limit(1).collect()
    expect(results[0].createdAt).toBeInstanceOf(Date)
  })

  it('count() passes through without decoding', async () => {
    const chain = new ZodvexQueryChain(createMockQuery(wireDocs), userDocSchema)
    const count = await chain.count()
    expect(count).toBe(2)
  })

  it('propagates ZodError when document fails schema validation', async () => {
    const badDocs = [{ _id: 'users:1', _creationTime: 100, name: 123, createdAt: 'not-a-number' }]
    const chain = new ZodvexQueryChain(createMockQuery(badDocs), userDocSchema)
    await expect(chain.first()).rejects.toThrow()
  })

  it('async iteration decodes each document', async () => {
    const chain = new ZodvexQueryChain(createMockQuery(wireDocs), userDocSchema)
    const results: any[] = []

    for await (const doc of chain) {
      results.push(doc)
    }

    expect(results).toHaveLength(2)
    expect(results[0].createdAt).toBeInstanceOf(Date)
  })
})

describe('ZodvexDatabaseReader', () => {
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
    const db = new ZodvexDatabaseReader(createMockDbReader(tableData), tableMap)
    const user = await db.get('users:1' as any)

    expect(user).not.toBeNull()
    expect(user?.name).toBe('Alice')
    expect(user?.createdAt).toBeInstanceOf(Date)
  })

  it('get(id) returns null for missing documents', async () => {
    const db = new ZodvexDatabaseReader(createMockDbReader(tableData), tableMap)
    const user = await db.get('users:missing' as any)

    expect(user).toBeNull()
  })

  it('get(table, id) decodes the document', async () => {
    const db = new ZodvexDatabaseReader(createMockDbReader(tableData), tableMap)
    const user = await db.get('users' as any, 'users:1' as any)

    expect(user).not.toBeNull()
    expect(user?.createdAt).toBeInstanceOf(Date)
  })

  it('query() returns a ZodvexQueryChain', async () => {
    const db = new ZodvexDatabaseReader(createMockDbReader(tableData), tableMap)
    const results = await db.query('users' as any).collect()

    expect(results).toHaveLength(2)
    expect(results[0].createdAt).toBeInstanceOf(Date)
  })

  it('passes through for tables not in the zodTableMap', async () => {
    const db = new ZodvexDatabaseReader(
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
    const db = new ZodvexDatabaseReader(createMockDbReader(tableData), tableMap)
    const result = db.normalizeId('users' as any, 'users:1')

    expect(result).toBe('users:1')
  })

  it('system property passes through to inner db', () => {
    const db = new ZodvexDatabaseReader(createMockDbReader(tableData), tableMap)
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

describe('ZodvexDatabaseWriter', () => {
  const tableMap = {
    users: userSchemas
  }

  const tableData = {
    users: [{ _id: 'users:1', _creationTime: 100, name: 'Alice', createdAt: 1700000000000 }]
  }

  it('insert() encodes runtime values to wire format', async () => {
    const { db: mockDb, calls } = createMockDbWriter(tableData)
    const db = new ZodvexDatabaseWriter(mockDb, tableMap)

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
    const db = new ZodvexDatabaseWriter(mockDb, tableMap)

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
    const db = new ZodvexDatabaseWriter(mockDb, tableMap)

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
    const db = new ZodvexDatabaseWriter(mockDb, tableMap)

    await db.delete('users:1' as any)

    expect(calls).toHaveLength(1)
    expect(calls[0].method).toBe('delete')
    expect(calls[0].args[0]).toBe('users:1')
  })

  it('read methods delegate to ZodvexDatabaseReader', async () => {
    const { db: mockDb } = createMockDbWriter(tableData)
    const db = new ZodvexDatabaseWriter(mockDb, tableMap)

    const user = await db.get('users:1' as any)
    expect(user).not.toBeNull()
    expect(user?.createdAt).toBeInstanceOf(Date)

    const results = await db.query('users' as any).collect()
    expect(results[0].createdAt).toBeInstanceOf(Date)
  })

  it('passes through writes for tables not in zodTableMap', async () => {
    const { db: mockDb, calls } = createMockDbWriter(tableData)
    const db = new ZodvexDatabaseWriter(mockDb, tableMap)

    await db.insert('logs' as any, { message: 'hello' } as any)

    expect(calls).toHaveLength(1)
    expect(calls[0].args[1]).toEqual({ message: 'hello' })
  })
})

describe('createZodDbReader', () => {
  const tableData = {
    users: [{ _id: 'users:1', _creationTime: 100, name: 'Alice', createdAt: 1700000000000 }]
  }

  it('creates a ZodvexDatabaseReader from schema with __zodTableMap', async () => {
    const schema = { __zodTableMap: { users: userSchemas } }
    const db = createZodDbReader(createMockDbReader(tableData) as any, schema)

    const user = await db.get('users:1' as any)
    expect(user).not.toBeNull()
    expect(user?.createdAt).toBeInstanceOf(Date)
  })
})

describe('typed overloads', () => {
  // Type-level assertions: verify overloads produce typed results instead of `any`.
  // These tests use TypeScript inference — a type error here means the overload is broken.

  type TestDataModel = {
    users: {
      document: { _id: string; _creationTime: number; name: string; createdAt: number }
      fieldPaths: '_id' | '_creationTime' | 'name' | 'createdAt'
      indexes: Record<string, never>
      searchIndexes: Record<string, never>
      vectorIndexes: Record<string, never>
    }
  }

  type DecodedUser = {
    _id: string
    _creationTime: number
    name: string
    createdAt: Date
  }

  type TestDecodedDocs = { users: DecodedUser }

  const tableMap = { users: userSchemas }
  const tableData = {
    users: [{ _id: 'users:1', _creationTime: 100, name: 'Alice', createdAt: 1700000000000 }]
  }

  it('get() returns decoded doc type', async () => {
    const { db: mockDb } = createMockDbWriter(tableData)
    const db = new ZodvexDatabaseWriter(mockDb, tableMap) as ZodvexDatabaseWriter<
      TestDataModel,
      TestDecodedDocs
    >

    const user = await db.get('users:1' as any)
    // If overloads work, `user` is `DecodedUser | null`, not `any`
    if (user) {
      // This assignment would fail at the type level if user were `any` —
      // but `any` absorbs everything. Instead, assert the resolved type
      // by checking a property access is typed correctly.
      const name: string = user.name
      const createdAt: Date = user.createdAt
      expect(name).toBe('Alice')
      expect(createdAt).toBeInstanceOf(Date)
    }
  })

  it('insert() accepts decoded fields without system fields', async () => {
    const { db: mockDb, calls } = createMockDbWriter(tableData)
    const db = new ZodvexDatabaseWriter(mockDb, tableMap) as ZodvexDatabaseWriter<
      TestDataModel,
      TestDecodedDocs
    >

    // The typed overload should accept { name: string; createdAt: Date }
    // and reject _id or _creationTime fields.
    const id = await db.insert('users' as any, {
      name: 'Charlie',
      createdAt: new Date(1700000000000)
    })

    expect(typeof id).toBe('string')
    expect(calls[0].args[1].createdAt).toBe(1700000000000)
  })

  it('patch() accepts partial decoded fields', async () => {
    const { db: mockDb, calls } = createMockDbWriter(tableData)
    const db = new ZodvexDatabaseWriter(mockDb, tableMap) as ZodvexDatabaseWriter<
      TestDataModel,
      TestDecodedDocs
    >

    // The typed overload should accept Partial<{ name: string; createdAt: Date }>
    await db.patch('users:1' as any, {
      createdAt: new Date(1800000000000)
    })

    expect(calls[0].args[1].createdAt).toBe(1800000000000)
  })

  it('replace() accepts full decoded fields without system fields', async () => {
    const { db: mockDb, calls } = createMockDbWriter(tableData)
    const db = new ZodvexDatabaseWriter(mockDb, tableMap) as ZodvexDatabaseWriter<
      TestDataModel,
      TestDecodedDocs
    >

    await db.replace('users:1' as any, {
      name: 'Alice Updated',
      createdAt: new Date(1800000000000)
    })

    expect(calls[0].args[1].createdAt).toBe(1800000000000)
  })

  it('delete() accepts typed GenericId', async () => {
    const { db: mockDb, calls } = createMockDbWriter(tableData)
    const db = new ZodvexDatabaseWriter(mockDb, tableMap) as ZodvexDatabaseWriter<
      TestDataModel,
      TestDecodedDocs
    >

    await db.delete('users:1' as any)

    expect(calls[0].method).toBe('delete')
    expect(calls[0].args[0]).toBe('users:1')
  })

  it('query() returns decoded doc type via chain', async () => {
    const { db: mockDb } = createMockDbWriter(tableData)
    const db = new ZodvexDatabaseWriter(mockDb, tableMap) as ZodvexDatabaseWriter<
      TestDataModel,
      TestDecodedDocs
    >

    const results = await db.query('users' as any).collect()
    if (results.length > 0) {
      const name: string = results[0].name
      const createdAt: Date = results[0].createdAt
      expect(name).toBe('Alice')
      expect(createdAt).toBeInstanceOf(Date)
    }
  })
})

describe('createZodDbWriter', () => {
  const tableData = {
    users: [{ _id: 'users:1', _creationTime: 100, name: 'Alice', createdAt: 1700000000000 }]
  }

  it('creates a ZodvexDatabaseWriter from schema with __zodTableMap', async () => {
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

// --- withIndex encoding tests ---

function createIndexCapturingMockQuery(docs: any[]) {
  const captured: { method: string; field: string; value: any }[] = []

  const mockIndexBuilder: any = new Proxy(
    {},
    {
      get(_target, prop) {
        if (['eq', 'gt', 'gte', 'lt', 'lte'].includes(prop as string)) {
          return (fieldName: string, value: any) => {
            captured.push({ method: prop as string, field: fieldName, value })
            return mockIndexBuilder
          }
        }
        if (prop === 'search') {
          return (..._args: any[]) => mockIndexBuilder
        }
        return undefined
      }
    }
  )

  const mockQuery: any = {
    fullTableScan: () => mockQuery,
    withIndex: (_name: string, rangeFn?: (q: any) => any) => {
      if (rangeFn) rangeFn(mockIndexBuilder)
      return mockQuery
    },
    withSearchIndex: (_name: string, filterFn?: (q: any) => any) => {
      if (filterFn) filterFn(mockIndexBuilder)
      return mockQuery
    },
    order: () => mockQuery,
    filter: () => mockQuery,
    limit: () => mockQuery,
    first: async () => docs[0] ?? null,
    unique: async () => docs[0] ?? null,
    collect: async () => docs,
    take: async (n: number) => docs.slice(0, n),
    paginate: async () => ({ page: docs, isDone: true, continueCursor: 'cursor' }),
    [Symbol.asyncIterator]: async function* () {
      for (const doc of docs) yield doc
    }
  }

  return { mockQuery, captured }
}

describe('withIndex encoding', () => {
  const wireDocs = [{ _id: 'users:1', _creationTime: 100, name: 'Alice', createdAt: 1700000000000 }]

  it('encodes a Date value to timestamp for a top-level codec field via .eq()', async () => {
    const { mockQuery, captured } = createIndexCapturingMockQuery(wireDocs)
    const chain = new ZodvexQueryChain(mockQuery, userDocSchema)

    await chain
      .withIndex('byDate' as any, (q: any) => q.eq('createdAt', new Date(1700000000000)))
      .first()

    expect(captured).toHaveLength(1)
    expect(captured[0].method).toBe('eq')
    expect(captured[0].field).toBe('createdAt')
    expect(captured[0].value).toBe(1700000000000)
  })

  it('passes through non-codec field values unchanged via .eq()', async () => {
    const { mockQuery, captured } = createIndexCapturingMockQuery(wireDocs)
    const chain = new ZodvexQueryChain(mockQuery, userDocSchema)

    await chain.withIndex('byName' as any, (q: any) => q.eq('name', 'Alice')).first()

    expect(captured).toHaveLength(1)
    expect(captured[0].value).toBe('Alice')
  })

  it('passes through dot-path values unchanged (wire sub-field)', async () => {
    const objectCodecDocSchema = z.object({
      _id: z.string(),
      _creationTime: z.number(),
      email: zodvexCodec(
        z.object({ value: z.string(), encrypted: z.string() }),
        z.custom<{ expose: () => string }>(() => true),
        {
          decode: (wire: any) => ({ expose: () => wire.value }),
          encode: (rt: any) => ({ value: rt.expose(), encrypted: 'enc' })
        }
      )
    })

    const { mockQuery, captured } = createIndexCapturingMockQuery([])
    const chain = new ZodvexQueryChain(mockQuery, objectCodecDocSchema)

    await chain
      .withIndex('byEmail' as any, (q: any) => q.eq('email.value', 'alice@example.com'))
      .first()

    expect(captured).toHaveLength(1)
    expect(captured[0].value).toBe('alice@example.com')
  })

  it('encodes values through .gt(), .gte(), .lt(), .lte()', async () => {
    const { mockQuery, captured } = createIndexCapturingMockQuery(wireDocs)
    const chain = new ZodvexQueryChain(mockQuery, userDocSchema)

    const start = new Date(1700000000000)
    const end = new Date(1700100000000)

    await chain
      .withIndex('byDate' as any, (q: any) => q.gte('createdAt', start).lt('createdAt', end))
      .first()

    expect(captured).toHaveLength(2)
    expect(captured[0]).toEqual({ method: 'gte', field: 'createdAt', value: 1700000000000 })
    expect(captured[1]).toEqual({ method: 'lt', field: 'createdAt', value: 1700100000000 })
  })

  it('passes through when no indexRange callback is provided', async () => {
    const { mockQuery } = createIndexCapturingMockQuery(wireDocs)
    const chain = new ZodvexQueryChain(mockQuery, userDocSchema)

    const result = await chain.withIndex('byName' as any).first()
    expect(result).not.toBeNull()
  })
})

describe('withIndex encoding — union schemas', () => {
  const unionDocSchema = z.discriminatedUnion('kind', [
    z.object({
      _id: z.string(),
      _creationTime: z.number(),
      kind: z.literal('email'),
      recipientId: z.string(),
      createdAt: zx.date()
    }),
    z.object({
      _id: z.string(),
      _creationTime: z.number(),
      kind: z.literal('push'),
      recipientId: z.string(),
      createdAt: zx.date()
    }),
    z.object({
      _id: z.string(),
      _creationTime: z.number(),
      kind: z.literal('in_app'),
      recipientId: z.string(),
      createdAt: zx.date()
    })
  ])

  it('encodes a codec field (zx.date) through a union schema via .eq()', async () => {
    const { mockQuery, captured } = createIndexCapturingMockQuery([])
    const chain = new ZodvexQueryChain(mockQuery, unionDocSchema)

    await chain
      .withIndex('by_created' as any, (q: any) => q.eq('createdAt', new Date(1700000000000)))
      .first()

    expect(captured).toHaveLength(1)
    expect(captured[0].method).toBe('eq')
    expect(captured[0].field).toBe('createdAt')
    expect(captured[0].value).toBe(1700000000000)
  })

  it('encodes discriminator literals through a per-field union via .eq()', async () => {
    const { mockQuery, captured } = createIndexCapturingMockQuery([])
    const chain = new ZodvexQueryChain(mockQuery, unionDocSchema)

    await chain.withIndex('by_kind' as any, (q: any) => q.eq('kind', 'push')).first()

    expect(captured).toHaveLength(1)
    expect(captured[0].method).toBe('eq')
    expect(captured[0].field).toBe('kind')
    expect(captured[0].value).toBe('push')
  })

  it('encodes compound index fields on a union schema', async () => {
    const { mockQuery, captured } = createIndexCapturingMockQuery([])
    const chain = new ZodvexQueryChain(mockQuery, unionDocSchema)

    await chain
      .withIndex('by_recipient_and_kind' as any, (q: any) =>
        q.eq('recipientId', 'user123').eq('kind', 'email')
      )
      .first()

    expect(captured).toHaveLength(2)
    expect(captured[0]).toEqual({ method: 'eq', field: 'recipientId', value: 'user123' })
    expect(captured[1]).toEqual({ method: 'eq', field: 'kind', value: 'email' })
  })

  it('encodes codec field through .gte() on a union schema', async () => {
    const { mockQuery, captured } = createIndexCapturingMockQuery([])
    const chain = new ZodvexQueryChain(mockQuery, unionDocSchema)

    await chain
      .withIndex('by_created' as any, (q: any) => q.gte('createdAt', new Date(1700000000000)))
      .first()

    expect(captured).toHaveLength(1)
    expect(captured[0].method).toBe('gte')
    expect(captured[0].value).toBe(1700000000000)
  })

  it('passes through non-codec fields unchanged on a union schema', async () => {
    const { mockQuery, captured } = createIndexCapturingMockQuery([])
    const chain = new ZodvexQueryChain(mockQuery, unionDocSchema)

    await chain.withIndex('by_recipient' as any, (q: any) => q.eq('recipientId', 'user123')).first()

    expect(captured).toHaveLength(1)
    expect(captured[0].value).toBe('user123')
  })

  it('handles plain z.union (non-discriminated) the same way', async () => {
    const plainUnionSchema = z.union([
      z.object({
        _id: z.string(),
        _creationTime: z.number(),
        type: z.literal('a'),
        timestamp: zx.date()
      }),
      z.object({
        _id: z.string(),
        _creationTime: z.number(),
        type: z.literal('b'),
        timestamp: zx.date()
      })
    ])

    const { mockQuery, captured } = createIndexCapturingMockQuery([])
    const chain = new ZodvexQueryChain(mockQuery, plainUnionSchema)

    await chain
      .withIndex('by_timestamp' as any, (q: any) => q.eq('timestamp', new Date(1700000000000)))
      .first()

    expect(captured).toHaveLength(1)
    expect(captured[0].value).toBe(1700000000000)
  })
})

describe('withSearchIndex encoding', () => {
  const wireDocs = [{ _id: 'users:1', _creationTime: 100, name: 'Alice', createdAt: 1700000000000 }]

  it('encodes values in withSearchIndex .eq() filter fields', async () => {
    const { mockQuery, captured } = createIndexCapturingMockQuery(wireDocs)
    const chain = new ZodvexQueryChain(mockQuery, userDocSchema)

    await chain
      .withSearchIndex('search' as any, (q: any) =>
        q.search('name', 'Alice').eq('createdAt', new Date(1700000000000))
      )
      .first()

    // .search() doesn't get captured (not an eq/gt/lt method), but .eq() does
    expect(captured.some((c: any) => c.method === 'eq' && c.value === 1700000000000)).toBe(true)
  })
})

// --- filter encoding tests ---

function createFilterCapturingMockQuery(docs: any[]) {
  const captured: { method: string; left: any; right: any }[] = []

  function makeExpr(inner: any) {
    return { serialize: () => inner, _isExpression: undefined }
  }

  const mockFilterBuilder: any = {
    field: (fieldPath: string) => makeExpr({ $field: fieldPath }),
    eq: (l: any, r: any) => {
      captured.push({ method: 'eq', left: l, right: r })
      return makeExpr({ $eq: [l, r] })
    },
    neq: (l: any, r: any) => {
      captured.push({ method: 'neq', left: l, right: r })
      return makeExpr({ $neq: [l, r] })
    },
    lt: (l: any, r: any) => {
      captured.push({ method: 'lt', left: l, right: r })
      return makeExpr({ $lt: [l, r] })
    },
    lte: (l: any, r: any) => {
      captured.push({ method: 'lte', left: l, right: r })
      return makeExpr({ $lte: [l, r] })
    },
    gt: (l: any, r: any) => {
      captured.push({ method: 'gt', left: l, right: r })
      return makeExpr({ $gt: [l, r] })
    },
    gte: (l: any, r: any) => {
      captured.push({ method: 'gte', left: l, right: r })
      return makeExpr({ $gte: [l, r] })
    },
    and: (...exprs: any[]) => makeExpr({ $and: exprs }),
    or: (...exprs: any[]) => makeExpr({ $or: exprs }),
    not: (x: any) => makeExpr({ $not: x })
  }

  const mockQuery: any = {
    fullTableScan: () => mockQuery,
    withIndex: () => mockQuery,
    withSearchIndex: () => mockQuery,
    order: () => mockQuery,
    filter: (predicate: any) => {
      if (typeof predicate === 'function') predicate(mockFilterBuilder)
      return mockQuery
    },
    limit: () => mockQuery,
    first: async () => docs[0] ?? null,
    unique: async () => docs[0] ?? null,
    collect: async () => docs,
    take: async (n: number) => docs.slice(0, n),
    paginate: async () => ({ page: docs, isDone: true, continueCursor: 'cursor' }),
    [Symbol.asyncIterator]: async function* () {
      for (const doc of docs) yield doc
    }
  }

  return { mockQuery, mockFilterBuilder, captured }
}

describe('filter encoding', () => {
  it('encodes a codec field (zx.date) via eq(field, value)', async () => {
    const { mockQuery, captured } = createFilterCapturingMockQuery([])
    const chain = new ZodvexQueryChain(mockQuery, userDocSchema)
    await chain.filter((q: any) => q.eq(q.field('createdAt'), new Date(1700000000000))).first()
    expect(captured).toHaveLength(1)
    expect(captured[0].method).toBe('eq')
    expect(captured[0].left.serialize()).toEqual({ $field: 'createdAt' })
    expect(captured[0].right).toBe(1700000000000)
  })

  it('passes through non-codec field values unchanged', async () => {
    const { mockQuery, captured } = createFilterCapturingMockQuery([])
    const chain = new ZodvexQueryChain(mockQuery, userDocSchema)
    await chain.filter((q: any) => q.eq(q.field('name'), 'Alice')).first()
    expect(captured).toHaveLength(1)
    expect(captured[0].right).toBe('Alice')
  })

  it('passes through dot-path values unchanged', async () => {
    const objectCodecDocSchema = z.object({
      _id: z.string(),
      _creationTime: z.number(),
      email: zodvexCodec(
        z.object({ value: z.string(), encrypted: z.string() }),
        z.custom<{ expose: () => string }>(() => true),
        {
          decode: (wire: any) => ({ expose: () => wire.value }),
          encode: (rt: any) => ({ value: rt.expose(), encrypted: 'enc' })
        }
      )
    })
    const { mockQuery, captured } = createFilterCapturingMockQuery([])
    const chain = new ZodvexQueryChain(mockQuery, objectCodecDocSchema)
    await chain.filter((q: any) => q.eq(q.field('email.value'), 'alice@example.com')).first()
    expect(captured).toHaveLength(1)
    expect(captured[0].right).toBe('alice@example.com')
  })

  it('encodes multiple comparisons inside and()', async () => {
    const { mockQuery, captured } = createFilterCapturingMockQuery([])
    const chain = new ZodvexQueryChain(mockQuery, userDocSchema)
    await chain
      .filter((q: any) =>
        q.and(
          q.gte(q.field('createdAt'), new Date(1700000000000)),
          q.lt(q.field('createdAt'), new Date(1700100000000))
        )
      )
      .first()
    expect(captured).toHaveLength(2)
    expect(captured[0]).toMatchObject({ method: 'gte', right: 1700000000000 })
    expect(captured[1]).toMatchObject({ method: 'lt', right: 1700100000000 })
  })

  it('encodes discriminator literals on union schema', async () => {
    const unionDocSchema = z.discriminatedUnion('kind', [
      z.object({
        _id: z.string(),
        _creationTime: z.number(),
        kind: z.literal('email'),
        createdAt: zx.date()
      }),
      z.object({
        _id: z.string(),
        _creationTime: z.number(),
        kind: z.literal('push'),
        createdAt: zx.date()
      })
    ])
    const { mockQuery, captured } = createFilterCapturingMockQuery([])
    const chain = new ZodvexQueryChain(mockQuery, unionDocSchema)
    await chain.filter((q: any) => q.eq(q.field('kind'), 'push')).first()
    expect(captured).toHaveLength(1)
    expect(captured[0].right).toBe('push')
  })

  it('encodes via neq()', async () => {
    const { mockQuery, captured } = createFilterCapturingMockQuery([])
    const chain = new ZodvexQueryChain(mockQuery, userDocSchema)
    await chain.filter((q: any) => q.neq(q.field('createdAt'), new Date(1700000000000))).first()
    expect(captured).toHaveLength(1)
    expect(captured[0].method).toBe('neq')
    expect(captured[0].right).toBe(1700000000000)
  })

  it('does not intercept and/or/not', async () => {
    const { mockQuery, captured } = createFilterCapturingMockQuery([])
    const chain = new ZodvexQueryChain(mockQuery, userDocSchema)
    await chain
      .filter((q: any) => {
        const expr1 = q.eq(q.field('name'), 'Alice')
        const expr2 = q.eq(q.field('name'), 'Bob')
        return q.and(expr1, expr2)
      })
      .first()
    expect(captured).toHaveLength(2)
  })

  it('encodes reversed operand order (value, field)', async () => {
    const { mockQuery, captured } = createFilterCapturingMockQuery([])
    const chain = new ZodvexQueryChain(mockQuery, userDocSchema)
    await chain.filter((q: any) => q.eq(new Date(1700000000000), q.field('createdAt'))).first()
    expect(captured).toHaveLength(1)
    expect(captured[0].left).toBe(1700000000000)
    expect(captured[0].right.serialize()).toEqual({ $field: 'createdAt' })
  })

  it('passes through null for fields without a schema entry', async () => {
    const { mockQuery, captured } = createFilterCapturingMockQuery([])
    const chain = new ZodvexQueryChain(mockQuery, userDocSchema)
    await chain.filter((q: any) => q.eq(q.field('unknownField'), null)).first()
    expect(captured).toHaveLength(1)
    expect(captured[0].right).toBeNull()
  })
})

describe('filter encoding — real Convex boundary', () => {
  it('encodes Date to timestamp through real filterBuilderImpl', async () => {
    const { filterBuilderImpl } = await import(
      '../node_modules/convex/dist/esm/server/impl/filter_builder_impl.js'
    )
    let capturedResult: any = null
    const mockQuery: any = {
      fullTableScan: () => mockQuery,
      withIndex: () => mockQuery,
      withSearchIndex: () => mockQuery,
      order: () => mockQuery,
      filter: (predicate: any) => {
        capturedResult = predicate(filterBuilderImpl)
        return mockQuery
      },
      limit: () => mockQuery,
      first: async () => null,
      unique: async () => null,
      collect: async () => [],
      take: async () => [],
      paginate: async () => ({ page: [], isDone: true, continueCursor: '' }),
      [Symbol.asyncIterator]: async function* () {
        // intentionally empty — no docs to yield
      }
    }
    const chain = new ZodvexQueryChain(mockQuery, userDocSchema)
    await chain.filter((q: any) => q.eq(q.field('createdAt'), new Date(1700000000000))).first()
    expect(capturedResult).toBeDefined()
    expect(capturedResult.serialize()).toEqual({
      $eq: [{ $field: 'createdAt' }, { $literal: 1700000000000 }]
    })
  })
})
