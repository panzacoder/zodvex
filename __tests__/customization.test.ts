import { describe, expect, it } from 'bun:test'
import { z } from 'zod'
import { CodecDatabaseReader, CodecDatabaseWriter } from '../src/db'
import { createCodecCustomization } from '../src/customization'
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

// --- Mock infrastructure (reused patterns from db.test.ts) ---

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

// --- Tests ---

const tableMap = { users: userSchemas }

const tableData = {
  users: [
    { _id: 'users:1', _creationTime: 100, name: 'Alice', createdAt: 1700000000000 },
    { _id: 'users:2', _creationTime: 200, name: 'Bob', createdAt: 1700100000000 }
  ]
}

describe('createCodecCustomization', () => {
  it('returns query and mutation customization objects with args and input', () => {
    const customization = createCodecCustomization(tableMap)

    expect(customization.query).toBeDefined()
    expect(customization.mutation).toBeDefined()

    // Both have args (empty object) and input (async function)
    expect(customization.query.args).toEqual({})
    expect(typeof customization.query.input).toBe('function')

    expect(customization.mutation.args).toEqual({})
    expect(typeof customization.mutation.input).toBe('function')
  })

  describe('query customization', () => {
    it('wraps ctx.db with CodecDatabaseReader — db.get() returns decoded Date', async () => {
      const customization = createCodecCustomization(tableMap)
      const mockCtx = { db: createMockDbReader(tableData) }

      const result = await customization.query.input(mockCtx, {})

      expect(result.ctx.db).toBeInstanceOf(CodecDatabaseReader)
      expect(result.args).toEqual({})

      // Verify decoding works: get() should decode timestamp to Date
      const user = await result.ctx.db.get('users:1')
      expect(user).not.toBeNull()
      expect(user.name).toBe('Alice')
      expect(user.createdAt).toBeInstanceOf(Date)
      expect(user.createdAt.getTime()).toBe(1700000000000)
    })

    it('wraps ctx.db.query() with decoding — collect() returns decoded Dates', async () => {
      const customization = createCodecCustomization(tableMap)
      const mockCtx = { db: createMockDbReader(tableData) }

      const result = await customization.query.input(mockCtx, {})

      // Verify query chain decodes: query().collect() should decode timestamps
      const users = await result.ctx.db.query('users').collect()
      expect(users).toHaveLength(2)
      expect(users[0].createdAt).toBeInstanceOf(Date)
      expect(users[0].createdAt.getTime()).toBe(1700000000000)
      expect(users[1].createdAt).toBeInstanceOf(Date)
      expect(users[1].createdAt.getTime()).toBe(1700100000000)
    })

    it('accepts the 3-arg signature (ctx, args, extra)', async () => {
      const customization = createCodecCustomization(tableMap)
      const mockCtx = { db: createMockDbReader(tableData) }

      // Should work with all three arguments (convex-helpers Customization signature)
      const result = await customization.query.input(mockCtx, {}, { someExtra: true })

      expect(result.ctx.db).toBeInstanceOf(CodecDatabaseReader)
    })
  })

  describe('mutation customization', () => {
    it('wraps ctx.db with CodecDatabaseWriter — reads decode', async () => {
      const customization = createCodecCustomization(tableMap)
      const { db: mockDb } = createMockDbWriter(tableData)
      const mockCtx = { db: mockDb }

      const result = await customization.mutation.input(mockCtx, {})

      expect(result.ctx.db).toBeInstanceOf(CodecDatabaseWriter)
      expect(result.args).toEqual({})

      // Verify read decoding works
      const user = await result.ctx.db.get('users:1')
      expect(user).not.toBeNull()
      expect(user.name).toBe('Alice')
      expect(user.createdAt).toBeInstanceOf(Date)
      expect(user.createdAt.getTime()).toBe(1700000000000)
    })

    it('wraps ctx.db with CodecDatabaseWriter — writes encode', async () => {
      const customization = createCodecCustomization(tableMap)
      const { db: mockDb, calls } = createMockDbWriter(tableData)
      const mockCtx = { db: mockDb }

      const result = await customization.mutation.input(mockCtx, {})

      // Insert with a Date — should be encoded to timestamp on the wire
      await result.ctx.db.insert('users', {
        name: 'Charlie',
        createdAt: new Date(1700000000000)
      })

      expect(calls).toHaveLength(1)
      expect(calls[0].method).toBe('insert')
      expect(calls[0].args[0]).toBe('users')
      expect(calls[0].args[1].createdAt).toBe(1700000000000)
      expect(calls[0].args[1].name).toBe('Charlie')
    })

    it('accepts the 3-arg signature (ctx, args, extra)', async () => {
      const customization = createCodecCustomization(tableMap)
      const { db: mockDb } = createMockDbWriter(tableData)
      const mockCtx = { db: mockDb }

      // Should work with all three arguments (convex-helpers Customization signature)
      const result = await customization.mutation.input(mockCtx, {}, { someExtra: true })

      expect(result.ctx.db).toBeInstanceOf(CodecDatabaseWriter)
    })
  })
})
