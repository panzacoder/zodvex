/**
 * Minimal compatibility for convex-helpers/server/zodV4 imports
 * This library itself IS the Zod v4 compatibility layer
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
export function zid<TableName extends string>(tableName: TableName): z.ZodTypeAny {
  const schema = z
    .string()
    .refine((val): val is GenericId<TableName> => typeof val === 'string' && val.length > 0, {
      message: `Invalid ID for table "${tableName}"`
    })

  // Store metadata for registry lookup
  registryHelpers.setMetadata(schema, {
    isConvexId: true,
    tableName
  })

  return schema as z.ZodTypeAny
}

export type Zid<TableName extends string> = ReturnType<typeof zid<TableName>>
