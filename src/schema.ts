/**
 * Schema definition utilities for zodvex.
 *
 * Provides defineZodSchema() which wraps table definitions to capture
 * zodTable references alongside Convex table definitions. This becomes
 * the single source of truth for both Convex validators and Zod codec schemas.
 *
 * Does NOT call Convex's defineSchema() — this is library-safe and does not
 * require convex/server at import time.
 */

/**
 * Minimal shape of a zodTable result: must have a `.table` property
 * (the Convex table definition) plus any other zodTable properties.
 */
type ZodTableDef = { table: any; name: string; schema: any }

/**
 * Wraps table definitions to capture zodTable references for zodvex.
 * Returns a structured object with both Convex table defs (.tables)
 * and full zodTable refs (.zodTables) for codec support.
 *
 * This does NOT call Convex's defineSchema() — it only organizes the
 * table definitions into a structured return value that can be used
 * both for Convex schema definition and zodvex codec infrastructure.
 *
 * @param tables - Object mapping table names to zodTable definitions
 * @returns Structured schema with `.tables` (Convex table defs) and `.zodTables` (full zodTable refs)
 *
 * @example
 * ```ts
 * const Users = zodTable('users', { name: z.string(), email: z.string() })
 * const Events = zodTable('events', { title: z.string(), date: z.number() })
 *
 * const schema = defineZodSchema({ users: Users, events: Events })
 *
 * // schema.tables → { users: Users.table, events: Events.table }
 * // schema.zodTables → { users: Users, events: Events }
 *
 * // Use with Convex's defineSchema:
 * export default defineSchema(schema.tables)
 * ```
 */
export function defineZodSchema<T extends Record<string, ZodTableDef>>(
  tables: T
): {
  tables: { [K in keyof T]: T[K]['table'] }
  zodTables: T
} {
  const convexTables = {} as Record<string, any>
  for (const [name, zodTableDef] of Object.entries(tables)) {
    convexTables[name] = zodTableDef.table
  }

  return {
    tables: convexTables as { [K in keyof T]: T[K]['table'] },
    zodTables: tables
  }
}
