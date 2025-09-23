/**
 * IDs + registry for Convex + Zod v4
 */

import type { GenericId } from 'convex/values'
import { z } from 'zod'

// Simple registry for metadata
const metadata = new WeakMap<z.ZodTypeAny, any>()

export const registryHelpers = {
  getMetadata: (type: z.ZodTypeAny) => metadata.get(type),
  setMetadata: (type: z.ZodTypeAny, meta: any) => metadata.set(type, meta)
}

/**
 * Create a Zod validator for a Convex Id
 *
 * Uses the string → transform → brand pattern for proper type narrowing with ctx.db.get()
 * This aligns with Zod v4 best practices and matches convex-helpers implementation
 */
export function zid<TableName extends string>(tableName: TableName): z.ZodType<GenericId<TableName>> & { _tableName: TableName } {
  // Use the string → transform → brand pattern (aligned with Zod v4 best practices)
  const baseSchema = z
    .string()
    .refine((val) => typeof val === 'string' && val.length > 0, {
      message: `Invalid ID for table "${tableName}"`
    })
    .transform((val) => {
      // Cast to GenericId while keeping the string value
      return val as string & GenericId<TableName>;
    })
    .brand(`ConvexId_${tableName}`)  // Use native Zod v4 .brand() method
    // Add a human-readable marker for client-side introspection utilities
    // used in apps/native (e.g., to detect relationship fields in dynamic forms).
    .describe(`convexId:${tableName}`)

  // Store metadata for registry lookup so mapping can convert to v.id(tableName)
  registryHelpers.setMetadata(baseSchema, {
    isConvexId: true,
    tableName
  })

  // Add the tableName property for type-level detection
  const branded = baseSchema as any
  branded._tableName = tableName

  return branded as z.ZodType<GenericId<TableName>> & { _tableName: TableName }
}

export type Zid<TableName extends string> = ReturnType<typeof zid<TableName>>
