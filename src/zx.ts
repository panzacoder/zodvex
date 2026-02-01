/**
 * zx - zodvex extended validators
 *
 * A namespace for zodvex-specific validators and codecs that handle
 * Convex wire format transformations. The "zx" prefix signals:
 * - "zodvex" or "zod + convex" extended types
 * - Explicit transformations (not magic)
 * - Discoverable via IDE autocomplete on `zx.`
 *
 * @example
 * ```typescript
 * import { z } from 'zod'
 * import { zx } from 'zodvex'
 *
 * const userShape = {
 *   name: z.string(),           // Standard Zod
 *   createdAt: zx.date(),       // zodvex: Date ↔ timestamp
 *   teamId: zx.id('teams'),     // zodvex: Convex ID
 * }
 * ```
 */

import type { GenericId } from 'convex/values'
import { z } from 'zod'
import { zodvexCodec } from './codec'
import { registryHelpers } from './ids'
import type { ZodvexCodec } from './types'

/**
 * Date codec type for explicit type annotations
 */
export type ZxDate = ZodvexCodec<z.ZodNumber, z.ZodCustom<Date>>

/**
 * Creates a Date codec that transforms between Date objects and timestamps.
 *
 * Wire format: number (Unix timestamp in milliseconds)
 * Runtime format: Date object
 *
 * @example
 * ```typescript
 * const schema = z.object({
 *   createdAt: zx.date(),
 *   updatedAt: zx.date().optional(),
 * })
 * ```
 */
function date(): ZxDate {
  return zodvexCodec(
    z.number(), // Wire: timestamp
    z.custom<Date>(val => val instanceof Date, {
      message: 'Expected Date instance'
    }),
    {
      decode: (timestamp: number) => new Date(timestamp),
      encode: (date: Date) => date.getTime()
    }
  )
}

/**
 * ID type for explicit type annotations
 */
export type ZxId<TableName extends string> = z.ZodType<GenericId<TableName>> & {
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
function id<TableName extends string>(tableName: TableName): ZxId<TableName> {
  // Create base string validator with refinement
  const baseSchema = z
    .string()
    .refine(val => typeof val === 'string' && val.length > 0, {
      message: `Invalid ID for table "${tableName}"`
    })
    .describe(`convexId:${tableName}`)

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

/**
 * Creates a custom codec for transforming between wire and runtime formats.
 *
 * Use this when you need custom transformations beyond the built-in helpers.
 *
 * @param wire - Zod schema for the wire format (stored in Convex)
 * @param runtime - Zod schema for the runtime format (used in code)
 * @param transforms - Encode/decode functions
 *
 * @example
 * ```typescript
 * // Sensitive data codec
 * const sensitiveString = zx.codec(
 *   z.object({ encrypted: z.string() }),  // Wire format
 *   z.custom<string>(() => true),          // Runtime format
 *   {
 *     decode: (wire) => decrypt(wire.encrypted),
 *     encode: (value) => ({ encrypted: encrypt(value) })
 *   }
 * )
 * ```
 */
function codec<W extends z.ZodTypeAny, R extends z.ZodTypeAny>(
  wire: W,
  runtime: R,
  transforms: {
    decode: (wire: z.output<W>) => z.input<R>
    encode: (runtime: z.output<R>) => z.input<W>
  }
): ZodvexCodec<W, R> {
  return zodvexCodec(wire, runtime, transforms)
}

/**
 * zx namespace - zodvex extended validators
 *
 * Provides explicit, discoverable helpers for Convex-specific transformations.
 */
export const zx = {
  /**
   * Date ↔ timestamp codec
   * @see {@link date}
   */
  date,

  /**
   * Convex ID validator
   * @see {@link id}
   */
  id,

  /**
   * Custom codec builder
   * @see {@link codec}
   */
  codec
} as const
