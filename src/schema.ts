import { defineSchema } from 'convex/server'
import type { z } from 'zod'

/**
 * Maps table names to their Zod doc schemas (with system fields).
 * Used by CodecDatabaseReader/Writer to look up decode/encode schemas.
 */
export type ZodTableMap = Record<string, z.ZodTypeAny>

// Accept any zodTable() result shape — both object-shape and union overloads
type ZodTableEntry = {
  table: any
  schema: { doc: z.ZodTypeAny }
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
    zodTableMap[name] = entry.schema.doc
  }

  const convexSchema = defineSchema(convexTables)

  return Object.assign(convexSchema, { __zodTableMap: zodTableMap })
}
