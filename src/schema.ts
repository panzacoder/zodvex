import { defineSchema } from 'convex/server'
import type { z } from 'zod'

/**
 * The set of Zod schemas produced by zodTable() for a single table.
 * Carries doc (full with system fields), insert (user fields only),
 * update (partial user fields + _id), base, and docArray.
 */
export type ZodTableSchemas = {
  doc: z.ZodTypeAny
  docArray: z.ZodTypeAny
  base: z.ZodTypeAny
  insert: z.ZodTypeAny
  update: z.ZodTypeAny
}

/**
 * Maps table names to their full zodTable() schema set.
 * Used by CodecDatabaseReader/Writer to look up decode/encode schemas.
 */
export type ZodTableMap = Record<string, ZodTableSchemas>

// Accept any zodTable() result shape — both object-shape and union overloads
type ZodTableEntry = {
  table: any
  schema: ZodTableSchemas
}

/**
 * Wraps Convex's defineSchema() and captures zodTable references.
 * The returned object is a valid Convex schema AND carries __zodTableMap
 * for use by createZodDbReader/createZodDbWriter.
 *
 * @example
 * ```typescript
 * // convex/schema.ts
 * export default defineZodSchema({
 *   users: Users,
 *   posts: Posts,
 * })
 * ```
 */
export function defineZodSchema<T extends Record<string, ZodTableEntry>>(tables: T) {
  const convexTables: Record<string, any> = {}
  const zodTableMap: ZodTableMap = {}

  for (const [name, entry] of Object.entries(tables)) {
    convexTables[name] = entry.table
    zodTableMap[name] = entry.schema
  }

  const convexSchema = defineSchema(convexTables)

  return Object.assign(convexSchema, { __zodTableMap: zodTableMap })
}
