import { v } from 'convex/values'
import { registryHelpers, type Zid } from '../ids'
import { getObjectShape } from '../schema/objectShape'
import { $ZodType } from '../zod-core'

// Helper to check if a schema is a Zid.
// Robust across module-instance boundaries: when zodvex is loaded from two
// separate bundles (e.g. the CLI's bundled copy vs. the user's `zodvex`
// import), `registryHelpers`'s WeakMap is per-bundle and may be empty for
// schemas constructed in the other bundle. Fall back to the `_tableName`
// property and the `convexId:` description tag set by zid() — both travel
// with the schema instance itself.
export function isZid<T extends string>(schema: $ZodType): schema is Zid<T> {
  return getZidTableName(schema) !== undefined
}

export function getZidTableName(schema: $ZodType): string | undefined {
  const metadata = registryHelpers.getMetadata(schema)
  if (
    metadata?.isConvexId === true &&
    metadata?.tableName &&
    typeof metadata.tableName === 'string'
  ) {
    return metadata.tableName
  }
  const tn = (schema as { _tableName?: unknown })._tableName
  if (typeof tn === 'string' && tn.length > 0) return tn
  const desc = (schema as { description?: unknown }).description
  if (typeof desc === 'string' && desc.startsWith('convexId:')) {
    return desc.slice('convexId:'.length)
  }
  return undefined
}

// union helpers
export function makeUnion(members: any[]): any {
  const nonNull = members.filter(Boolean)
  if (nonNull.length === 0) return v.any()
  if (nonNull.length === 1) return nonNull[0]
  return v.union(nonNull[0], nonNull[1], ...nonNull.slice(2))
}

export { getObjectShape }
