import { v } from 'convex/values'
import { z } from 'zod'
import { registryHelpers, type Zid } from '../ids'

// Helper to check if a schema is a Zid
export function isZid<T extends string>(schema: z.ZodType): schema is Zid<T> {
  // Check our metadata registry for ConvexId marker
  const metadata = registryHelpers.getMetadata(schema)
  return (
    metadata?.isConvexId === true && metadata?.tableName && typeof metadata.tableName === 'string'
  )
}

// union helpers
export function makeUnion(members: any[]): any {
  const nonNull = members.filter(Boolean)
  if (nonNull.length === 0) return v.any()
  if (nonNull.length === 1) return nonNull[0]
  return v.union(nonNull[0], nonNull[1], ...nonNull.slice(2))
}

export function getObjectShape(obj: any): Record<string, any> {
  // Use public API .shape property for ZodObject
  if (obj instanceof z.ZodObject) {
    return obj.shape
  }
  // Fallback for edge cases
  if (obj && typeof obj === 'object' && typeof obj.shape === 'object') {
    return obj.shape as Record<string, any>
  }
  return {}
}
