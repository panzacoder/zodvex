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
 */
export function zid<TableName extends string>(tableName: TableName): z.ZodType<GenericId<TableName>> {
  // Use z.custom to preserve the GenericId<TableName> inference while validating as a string
  const schema = z.custom<GenericId<TableName>>((val) => typeof val === 'string' && val.length > 0, {
    message: `Invalid ID for table "${tableName}"`
  })

  // Store metadata for registry lookup so mapping can convert to v.id(tableName)
  registryHelpers.setMetadata(schema, {
    isConvexId: true,
    tableName
  })

  return schema as z.ZodType<GenericId<TableName>>
}

export type Zid<TableName extends string> = ReturnType<typeof zid<TableName>>
