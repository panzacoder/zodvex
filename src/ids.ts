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
 * Compatible with AI SDK and other tools that don't support transforms.
 * Uses type-level branding instead of runtime transforms for GenericId<T> compatibility.
 *
 * @param tableName - The Convex table name for this ID
 * @returns A Zod string validator typed as GenericId<TableName>
 */
export function zid<TableName extends string>(
  tableName: TableName
): z.ZodType<GenericId<TableName>> & { _tableName: TableName } {
  // Create base string validator with refinement (no transform or brand)
  const baseSchema = z
    .string()
    .refine(val => typeof val === 'string' && val.length > 0, {
      message: `Invalid ID for table "${tableName}"`
    })
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

  // Type assertion provides GenericId<TableName> typing without runtime transform
  // This maintains type safety while being compatible with AI SDK and similar tools
  return branded as z.ZodType<GenericId<TableName>> & { _tableName: TableName }
}

export type Zid<TableName extends string> = ReturnType<typeof zid<TableName>>
