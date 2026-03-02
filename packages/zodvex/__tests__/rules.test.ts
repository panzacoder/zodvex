import { describe, expect, it } from 'bun:test'
import { z } from 'zod'
import { CodecDatabaseReader, CodecDatabaseWriter } from '../src/db'
import type {
  CodecRules,
  CodecRulesConfig,
  ReaderAuditConfig,
  TableRules,
  WriteEvent,
  WriterAuditConfig
} from '../src/rules'
import { RulesCodecQueryChain } from '../src/rules'
import type { ZodTableSchemas } from '../src/schema'
import { zx } from '../src/zx'

describe('rules types', () => {
  it('exports all public types', () => {
    // Type-level assertions — if this compiles, the types are correctly exported.
    // Runtime assertion just confirms the test ran.
    const config: CodecRulesConfig = { defaultPolicy: 'allow', allowCounting: false }
    expect(config.defaultPolicy).toBe('allow')
  })

  it('WriteEvent discriminates by type', () => {
    const event: WriteEvent = { type: 'insert', id: 'test:1' as any, value: { name: 'Alice' } }
    expect(event.type).toBe('insert')
  })
})

const docSchema = z.object({
  _id: z.string(),
  _creationTime: z.number(),
  name: z.string(),
  createdAt: zx.date(),
  role: z.string()
})

// Helper: creates a raw mock query (RulesCodecQueryChain extends CodecQueryChain directly)
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

// Wire-format docs (createdAt is a timestamp number)
const wireDocs = [
  { _id: 'u:1', _creationTime: 100, name: 'Alice', createdAt: 1700000000000, role: 'admin' },
  { _id: 'u:2', _creationTime: 200, name: 'Bob', createdAt: 1700100000000, role: 'user' },
  { _id: 'u:3', _creationTime: 300, name: 'Charlie', createdAt: 1700200000000, role: 'user' }
]

describe('RulesCodecQueryChain', () => {
  const allowAll = async (_ctx: any, doc: any) => doc
  const denyAll = async (_ctx: any, _doc: any) => null
  const adminsOnly = async (_ctx: any, doc: any) => (doc.role === 'admin' ? doc : null)

  it('collect() returns all docs when rule allows all', async () => {
    const chain = new RulesCodecQueryChain(createMockQuery(wireDocs), docSchema, allowAll, {})
    const results = await chain.collect()
    expect(results).toHaveLength(3)
    expect(results[0].createdAt).toBeInstanceOf(Date)
  })

  it('collect() filters docs through read rule', async () => {
    const chain = new RulesCodecQueryChain(createMockQuery(wireDocs), docSchema, adminsOnly, {})
    const results = await chain.collect()
    expect(results).toHaveLength(1)
    expect(results[0].name).toBe('Alice')
  })

  it('collect() returns empty array when rule denies all', async () => {
    const chain = new RulesCodecQueryChain(createMockQuery(wireDocs), docSchema, denyAll, {})
    const results = await chain.collect()
    expect(results).toHaveLength(0)
  })

  it('first() returns first allowed doc, skipping denied', async () => {
    const usersOnly = async (_ctx: any, doc: any) => (doc.role === 'user' ? doc : null)
    const chain = new RulesCodecQueryChain(createMockQuery(wireDocs), docSchema, usersOnly, {})
    const result = await chain.first()
    expect(result).not.toBeNull()
    expect(result?.name).toBe('Bob')
  })

  it('first() returns null when no docs pass the rule', async () => {
    const chain = new RulesCodecQueryChain(createMockQuery(wireDocs), docSchema, denyAll, {})
    const result = await chain.first()
    expect(result).toBeNull()
  })

  it('take(n) collects n allowed docs, skipping denied', async () => {
    const usersOnly = async (_ctx: any, doc: any) => (doc.role === 'user' ? doc : null)
    const chain = new RulesCodecQueryChain(createMockQuery(wireDocs), docSchema, usersOnly, {})
    const results = await chain.take(1)
    expect(results).toHaveLength(1)
    expect(results[0].name).toBe('Bob')
  })

  it('unique() applies rule and returns doc if allowed', async () => {
    const singleDoc = [wireDocs[0]]
    const chain = new RulesCodecQueryChain(createMockQuery(singleDoc), docSchema, allowAll, {})
    const result = await chain.unique()
    expect(result).not.toBeNull()
    expect(result?.name).toBe('Alice')
  })

  it('unique() returns null when rule denies', async () => {
    const singleDoc = [wireDocs[0]]
    const chain = new RulesCodecQueryChain(createMockQuery(singleDoc), docSchema, denyAll, {})
    const result = await chain.unique()
    expect(result).toBeNull()
  })

  it('paginate() post-filters the page (page may shrink)', async () => {
    const chain = new RulesCodecQueryChain(createMockQuery(wireDocs), docSchema, adminsOnly, {})
    const result = await chain.paginate({ numItems: 10, cursor: null })
    expect(result.page).toHaveLength(1)
    expect(result.page[0].name).toBe('Alice')
    expect(result.isDone).toBe(true)
  })

  it('count() throws when allowCounting is false', async () => {
    const chain = new RulesCodecQueryChain(createMockQuery(wireDocs), docSchema, allowAll, {
      allowCounting: false
    })
    await expect(chain.count()).rejects.toThrow('count is not allowed with rules')
  })

  it('count() delegates when allowCounting is true', async () => {
    const chain = new RulesCodecQueryChain(createMockQuery(wireDocs), docSchema, allowAll, {
      allowCounting: true
    })
    const count = await chain.count()
    expect(count).toBe(3)
  })

  it('read rule can transform documents', async () => {
    const transform = async (_ctx: any, doc: any) => ({ ...doc, name: doc.name.toUpperCase() })
    const chain = new RulesCodecQueryChain(createMockQuery(wireDocs), docSchema, transform, {})
    const results = await chain.collect()
    expect(results[0].name).toBe('ALICE')
  })

  it('read rule boolean shorthand: true passes doc through unchanged', async () => {
    const allowBoolean = async (_ctx: any, _doc: any) => true
    const chain = new RulesCodecQueryChain(createMockQuery(wireDocs), docSchema, allowBoolean, {})
    const results = await chain.collect()
    expect(results).toHaveLength(3)
    expect(results[0].createdAt).toBeInstanceOf(Date)
  })

  it('read rule boolean shorthand: false denies', async () => {
    const denyBoolean = async (_ctx: any, _doc: any) => false
    const chain = new RulesCodecQueryChain(createMockQuery(wireDocs), docSchema, denyBoolean, {})
    const results = await chain.collect()
    expect(results).toHaveLength(0)
  })

  it('async iteration filters through rule', async () => {
    const chain = new RulesCodecQueryChain(createMockQuery(wireDocs), docSchema, adminsOnly, {})
    const results: any[] = []
    for await (const doc of chain) {
      results.push(doc)
    }
    expect(results).toHaveLength(1)
    expect(results[0].name).toBe('Alice')
  })

  it('intermediate methods delegate and re-wrap', async () => {
    const chain = new RulesCodecQueryChain(createMockQuery(wireDocs), docSchema, adminsOnly, {})
    const results = await chain
      .order('asc')
      .filter(() => true)
      .collect()
    expect(results).toHaveLength(1)
  })
})

// ============================================================================
// CodecDatabaseReader.withRules() tests
// ============================================================================

const userDocSchema = z.object({
  _id: z.string(),
  _creationTime: z.number(),
  name: z.string(),
  createdAt: zx.date(),
  role: z.string()
})

const userInsertSchema = z.object({
  name: z.string(),
  createdAt: zx.date(),
  role: z.string()
})

const userSchemas: ZodTableSchemas = {
  doc: userDocSchema,
  docArray: z.array(userDocSchema),
  paginatedDoc: z.object({
    page: z.array(userDocSchema),
    isDone: z.boolean(),
    continueCursor: z.string()
  }),
  base: userInsertSchema,
  insert: userInsertSchema,
  update: userInsertSchema.partial().extend({ _id: z.string() })
}

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

const tableMap = { users: userSchemas }
const tableData = {
  users: [
    { _id: 'users:1', _creationTime: 100, name: 'Alice', createdAt: 1700000000000, role: 'admin' },
    { _id: 'users:2', _creationTime: 200, name: 'Bob', createdAt: 1700100000000, role: 'user' }
  ]
}

describe('CodecDatabaseReader.withRules()', () => {
  it('get() applies read rule and returns allowed doc', async () => {
    const db = new CodecDatabaseReader(createMockDbReader(tableData), tableMap)
    const secureDb = db.withRules(
      {},
      {
        users: { read: async (_ctx: any, doc: any) => doc }
      }
    )
    const user = await secureDb.get('users:1' as any)
    expect(user).not.toBeNull()
    expect(user?.name).toBe('Alice')
    expect(user?.createdAt).toBeInstanceOf(Date)
  })

  it('get() returns null when read rule denies', async () => {
    const db = new CodecDatabaseReader(createMockDbReader(tableData), tableMap)
    const secureDb = db.withRules(
      {},
      {
        users: { read: async () => null }
      }
    )
    const user = await secureDb.get('users:1' as any)
    expect(user).toBeNull()
  })

  it('get() passes context to read rule', async () => {
    const ctx = { clinicId: 'c1' }
    const db = new CodecDatabaseReader(createMockDbReader(tableData), tableMap)
    const secureDb = db.withRules(ctx, {
      users: {
        read: async (ctx: any, doc: any) => {
          expect(ctx.clinicId).toBe('c1')
          return doc
        }
      }
    })
    await secureDb.get('users:1' as any)
  })

  it('query().collect() filters through read rule', async () => {
    const db = new CodecDatabaseReader(createMockDbReader(tableData), tableMap)
    const secureDb = db.withRules(
      {},
      {
        users: { read: async (_ctx: any, doc: any) => (doc.role === 'admin' ? doc : null) }
      }
    )
    const results = await secureDb.query('users' as any).collect()
    expect(results).toHaveLength(1)
    expect(results[0].name).toBe('Alice')
  })

  it('read rule can transform documents', async () => {
    const db = new CodecDatabaseReader(createMockDbReader(tableData), tableMap)
    const secureDb = db.withRules(
      {},
      {
        users: { read: async (_ctx: any, doc: any) => ({ ...doc, name: doc.name.toUpperCase() }) }
      }
    )
    const user = await secureDb.get('users:1' as any)
    expect(user?.name).toBe('ALICE')
  })

  it('read rule boolean shorthand: true passes doc through', async () => {
    const db = new CodecDatabaseReader(createMockDbReader(tableData), tableMap)
    const secureDb = db.withRules(
      {},
      {
        users: { read: async () => true }
      }
    )
    const user = await secureDb.get('users:1' as any)
    expect(user).not.toBeNull()
    expect(user?.name).toBe('Alice')
  })

  it('read rule boolean shorthand: false denies', async () => {
    const db = new CodecDatabaseReader(createMockDbReader(tableData), tableMap)
    const secureDb = db.withRules(
      {},
      {
        users: { read: async () => false }
      }
    )
    const user = await secureDb.get('users:1' as any)
    expect(user).toBeNull()
  })

  it('tables without rules pass through unchanged', async () => {
    const db = new CodecDatabaseReader(createMockDbReader(tableData), tableMap)
    const secureDb = db.withRules({}, {})
    const user = await secureDb.get('users:1' as any)
    expect(user).not.toBeNull()
    expect(user?.name).toBe('Alice')
  })

  it('normalizeId and system pass through', () => {
    const db = new CodecDatabaseReader(createMockDbReader(tableData), tableMap)
    const secureDb = db.withRules({}, {})
    expect(secureDb.normalizeId('users' as any, 'users:1')).toBe('users:1')
    expect(secureDb.system).toBeDefined()
  })

  it('chaining withRules() layers rules', async () => {
    const db = new CodecDatabaseReader(createMockDbReader(tableData), tableMap)
    const secureDb = db
      .withRules(
        {},
        {
          users: { read: async (_ctx: any, doc: any) => (doc.role === 'admin' ? doc : null) }
        }
      )
      .withRules(
        {},
        {
          users: { read: async (_ctx: any, doc: any) => ({ ...doc, name: doc.name.toUpperCase() }) }
        }
      )
    const results = await secureDb.query('users' as any).collect()
    expect(results).toHaveLength(1)
    expect(results[0].name).toBe('ALICE')
  })
})

// ============================================================================
// CodecDatabaseWriter.withRules() tests
// ============================================================================

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

describe('CodecDatabaseWriter.withRules()', () => {
  it('insert() calls insert rule and uses transformed value', async () => {
    const { db: mockDb, calls } = createMockDbWriter(tableData)
    const db = new CodecDatabaseWriter(mockDb, tableMap)
    const secureDb = db.withRules(
      {},
      {
        users: {
          insert: async (_ctx: any, value: any) => ({ ...value, name: 'INJECTED' })
        }
      }
    )
    await secureDb.insert(
      'users' as any,
      {
        name: 'Charlie',
        createdAt: new Date(1700000000000),
        role: 'user'
      } as any
    )
    expect(calls).toHaveLength(1)
    // The rule transformed name to 'INJECTED', then the inner writer encoded it
    expect(calls[0].args[1].name).toBe('INJECTED')
  })

  it('insert() throws when insert rule throws', async () => {
    const { db: mockDb } = createMockDbWriter(tableData)
    const db = new CodecDatabaseWriter(mockDb, tableMap)
    const secureDb = db.withRules(
      {},
      {
        users: {
          insert: async () => {
            throw new Error('insert denied')
          }
        }
      }
    )
    await expect(
      secureDb.insert(
        'users' as any,
        {
          name: 'X',
          createdAt: new Date(),
          role: 'user'
        } as any
      )
    ).rejects.toThrow('insert denied')
  })

  it('patch() calls patch rule with current doc and patch value', async () => {
    const { db: mockDb, calls } = createMockDbWriter(tableData)
    const db = new CodecDatabaseWriter(mockDb, tableMap)
    let receivedDoc: any
    let receivedValue: any
    const secureDb = db.withRules(
      {},
      {
        users: {
          read: async (_ctx: any, doc: any) => doc,
          patch: async (_ctx: any, doc: any, value: any) => {
            receivedDoc = doc
            receivedValue = value
            return value
          }
        }
      }
    )
    await secureDb.patch('users:1' as any, { name: 'Alice Updated' } as any)
    expect(receivedDoc.name).toBe('Alice')
    expect(receivedDoc.createdAt).toBeInstanceOf(Date) // decoded doc
    expect(receivedValue.name).toBe('Alice Updated')
    expect(calls).toHaveLength(1)
  })

  it('patch() throws when doc not found (no read access)', async () => {
    const { db: mockDb } = createMockDbWriter(tableData)
    const db = new CodecDatabaseWriter(mockDb, tableMap)
    const secureDb = db.withRules(
      {},
      {
        users: { read: async () => null }
      }
    )
    await expect(secureDb.patch('users:1' as any, { name: 'X' } as any)).rejects.toThrow(
      'no read access or doc does not exist'
    )
  })

  it('patch() throws when patch rule throws', async () => {
    const { db: mockDb } = createMockDbWriter(tableData)
    const db = new CodecDatabaseWriter(mockDb, tableMap)
    const secureDb = db.withRules(
      {},
      {
        users: {
          read: async (_ctx: any, doc: any) => doc,
          patch: async () => {
            throw new Error('modify denied')
          }
        }
      }
    )
    await expect(secureDb.patch('users:1' as any, { name: 'X' } as any)).rejects.toThrow(
      'modify denied'
    )
  })

  it('delete() calls delete rule with current doc', async () => {
    const { db: mockDb, calls } = createMockDbWriter(tableData)
    const db = new CodecDatabaseWriter(mockDb, tableMap)
    let receivedDoc: any
    const secureDb = db.withRules(
      {},
      {
        users: {
          read: async (_ctx: any, doc: any) => doc,
          delete: async (_ctx: any, doc: any) => {
            receivedDoc = doc
          }
        }
      }
    )
    await secureDb.delete('users:1' as any)
    expect(receivedDoc.name).toBe('Alice')
    expect(calls).toHaveLength(1)
  })

  it('delete() throws when delete rule throws', async () => {
    const { db: mockDb } = createMockDbWriter(tableData)
    const db = new CodecDatabaseWriter(mockDb, tableMap)
    const secureDb = db.withRules(
      {},
      {
        users: {
          read: async (_ctx: any, doc: any) => doc,
          delete: async () => {
            throw new Error('delete denied')
          }
        }
      }
    )
    await expect(secureDb.delete('users:1' as any)).rejects.toThrow('delete denied')
  })

  it('replace() calls replace rule with current doc and replacement', async () => {
    const { db: mockDb, calls } = createMockDbWriter(tableData)
    const db = new CodecDatabaseWriter(mockDb, tableMap)
    const secureDb = db.withRules(
      {},
      {
        users: {
          read: async (_ctx: any, doc: any) => doc,
          replace: async (_ctx: any, _doc: any, value: any) => value
        }
      }
    )
    await secureDb.replace(
      'users:1' as any,
      {
        name: 'Alice Replaced',
        createdAt: new Date(1700000000000),
        role: 'admin'
      } as any
    )
    expect(calls).toHaveLength(1)
  })

  it('defaultPolicy deny blocks operations without rules', async () => {
    const { db: mockDb } = createMockDbWriter(tableData)
    const db = new CodecDatabaseWriter(mockDb, tableMap)
    const secureDb = db.withRules(
      {},
      {
        users: { read: async (_ctx: any, doc: any) => doc }
      },
      { defaultPolicy: 'deny' }
    )
    await expect(
      secureDb.insert(
        'users' as any,
        {
          name: 'X',
          createdAt: new Date(),
          role: 'user'
        } as any
      )
    ).rejects.toThrow('insert not allowed on users')
  })

  it('defaultPolicy allow passes operations without rules', async () => {
    const { db: mockDb, calls } = createMockDbWriter(tableData)
    const db = new CodecDatabaseWriter(mockDb, tableMap)
    const secureDb = db.withRules(
      {},
      {
        users: { read: async (_ctx: any, doc: any) => doc }
      },
      { defaultPolicy: 'allow' }
    )
    await secureDb.insert(
      'users' as any,
      {
        name: 'Charlie',
        createdAt: new Date(1700000000000),
        role: 'user'
      } as any
    )
    expect(calls).toHaveLength(1)
  })

  it('read methods delegate through rules', async () => {
    const { db: mockDb } = createMockDbWriter(tableData)
    const db = new CodecDatabaseWriter(mockDb, tableMap)
    const secureDb = db.withRules(
      {},
      {
        users: { read: async (_ctx: any, doc: any) => (doc.role === 'admin' ? doc : null) }
      }
    )
    const results = await secureDb.query('users' as any).collect()
    expect(results).toHaveLength(1)
    expect(results[0].name).toBe('Alice')
  })
})
