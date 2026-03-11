import { z } from 'zod'
import type { ZodTableSchemas } from '../../src/schema'
import { zx } from '../../src/zx'

export const userDocSchema = z.object({
  _id: z.string(),
  _creationTime: z.number(),
  name: z.string(),
  createdAt: zx.date()
})

export const userInsertSchema = z.object({
  name: z.string(),
  createdAt: zx.date()
})

export const userSchemas: ZodTableSchemas = {
  doc: userDocSchema,
  docArray: z.array(userDocSchema),
  base: userInsertSchema,
  insert: userInsertSchema,
  update: userInsertSchema.partial().extend({ _id: z.string() })
}

export const userTableMap = { users: userSchemas }

export const userTableData = {
  users: [{ _id: 'users:1', _creationTime: 100, name: 'Alice', createdAt: 1700000000000 }]
}

export function createMockDbReader(tables: Record<string, any[]>) {
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

export function createMockDbWriter(tables: Record<string, any[]>) {
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
