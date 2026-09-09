import type { GenericId } from 'convex/values'
import { z } from 'zod'
import { registryHelpers } from '../ids'

/**
 * ID type for explicit type annotations
 */
export type ZxId<TableName extends string> = z.ZodString &
  z.ZodType<GenericId<TableName>> & {
    _tableName: TableName
  }

/**
 * Creates a Convex ID validator for a specific table.
 *
 * Wire format: string (Convex ID)
 * Runtime format: GenericId<TableName> (branded string type)
 *
 * Note: Unlike zx.date(), IDs don't require runtime transformation since
 * GenericId<T> is a branded string type. The branding is purely type-level.
 *
 * @param tableName - The Convex table name for this ID
 *
 * @example
 * ```typescript
 * const schema = z.object({
 *   userId: zx.id('users'),
 *   teamId: zx.id('teams').optional(),
 * })
 * ```
 */
export function id<TableName extends string>(tableName: TableName): ZxId<TableName> {
  // Create base string validator with refinement
  const baseSchema = z.string().check(
    z.refine(val => typeof val === 'string' && val.length > 0, {
      message: `Invalid ID for table "${tableName}"`
    }),
    z.describe(`convexId:${tableName}`)
  )

  // Store metadata for registry lookup so mapping can convert to v.id(tableName)
  registryHelpers.setMetadata(baseSchema, {
    isConvexId: true,
    tableName
  })

  // Add the tableName property for type-level detection
  const branded = baseSchema as any
  branded._tableName = tableName

  return branded as ZxId<TableName>
}
