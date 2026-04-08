import { v } from 'convex/values'
import { registryHelpers, type Zid } from '../ids'
import { getObjectShape } from '../schema/objectShape'
import { $ZodType } from '../zod-core'

// Helper to check if a schema is a Zid
export function isZid<T extends string>(schema: $ZodType): schema is Zid<T> {
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

export { getObjectShape }
