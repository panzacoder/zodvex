import { describe, expect, it } from 'bun:test'
import { z } from 'zod'
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

const tableMap = { users: userSchemas }

// Minimal mock DB reader
function createMockDbReader(tables: Record<string, any[]>) {
  return {
    system: { get: async () => null, query: () => ({}), normalizeId: () => null },
    normalizeId: (tableName: string, id: string) => (id.startsWith(`${tableName}:`) ? id : null),
    get: async (id: string) => {
      for (const docs of Object.values(tables)) {
        const doc = docs.find((d: any) => d._id === id)
        if (doc) return doc
      }
      return null
    },
    query: (tableName: string) => ({
      fullTableScan: () => ({
        collect: async () => tables[tableName] ?? []
      }),
      collect: async () => tables[tableName] ?? []
    })
  }
}

// Minimal mock DB writer (extends reader with write methods)
function createMockDbWriter(tables: Record<string, any[]>) {
  const reader = createMockDbReader(tables)
  const calls: { method: string; args: any[] }[] = []
  return {
    db: {
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
    },
    calls
  }
}

describe('createCodecCustomization', () => {
  const tableData = {
    users: [{ _id: 'users:1', _creationTime: 100, name: 'Alice', createdAt: 1700000000000 }]
  }

  it('returns query and mutation customization objects', () => {
    const codec = createCodecCustomization(tableMap)
    expect(codec.query).toBeDefined()
    expect(codec.query.args).toEqual({})
    expect(codec.query.input).toBeTypeOf('function')
    expect(codec.mutation).toBeDefined()
    expect(codec.mutation.args).toEqual({})
    expect(codec.mutation.input).toBeTypeOf('function')
  })

  it('query customization wraps ctx.db with CodecDatabaseReader', async () => {
    const codec = createCodecCustomization(tableMap)
    const mockCtx = { db: createMockDbReader(tableData) }

    const result = await codec.query.input(mockCtx, {})

    // The wrapped db should decode docs
    const user = await result.ctx.db.get('users:1')
    expect(user.createdAt).toBeInstanceOf(Date)
  })

  it('query customization wraps ctx.db.query() with decoding', async () => {
    const codec = createCodecCustomization(tableMap)
    const mockCtx = { db: createMockDbReader(tableData) }

    const result = await codec.query.input(mockCtx, {})

    // The query chain path should also decode
    const users = await result.ctx.db.query('users').collect()
    expect(users[0].createdAt).toBeInstanceOf(Date)
  })

  it('mutation customization wraps ctx.db with CodecDatabaseWriter', async () => {
    const codec = createCodecCustomization(tableMap)
    const { db, calls } = createMockDbWriter(tableData)
    const mockCtx = { db }

    const result = await codec.mutation.input(mockCtx, {})

    // Reads should decode
    const user = await result.ctx.db.get('users:1')
    expect(user.createdAt).toBeInstanceOf(Date)

    // Writes should encode
    await result.ctx.db.insert('users', { name: 'Bob', createdAt: new Date(1700000000000) })
    expect(calls[0].args[1].createdAt).toBe(1700000000000)
  })
})
