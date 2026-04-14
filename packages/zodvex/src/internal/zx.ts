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
import { addSystemFields } from './schemaHelpers'
import { createSchemaUpdateSchema } from './modelSchemaBundle'
import type { ZodvexCodec } from './types'
import {
  $ZodType as $ZodTypeValue,
  type $ZodCustom,
  type $ZodNumber,
  type $ZodType,
  type output as zoutput
} from './zod-core'

/**
 * Date codec type for explicit type annotations
 */
export type FullZodvexCodec<W extends $ZodType, R extends $ZodType> = z.ZodCodec<W, R> &
  ZodvexCodec<W, R>

export type ZxDate = FullZodvexCodec<$ZodNumber, $ZodCustom<Date, Date>>

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
  ) as unknown as ZxDate
}

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
function id<TableName extends string>(tableName: TableName): ZxId<TableName> {
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
 * // Encrypted data codec
 * const encryptedString = zx.codec(
 *   z.object({ encrypted: z.string() }),  // Wire format
 *   z.custom<string>(() => true),          // Runtime format
 *   {
 *     decode: (wire) => decrypt(wire.encrypted),
 *     encode: (value) => ({ encrypted: encrypt(value) })
 *   }
 * )
 * ```
 */
function codec<W extends $ZodType, R extends $ZodType, WO = zoutput<W>, RI = zoutput<R>>(
  wire: W,
  runtime: R,
  transforms: {
    decode: (wire: WO) => RI
    encode: (runtime: RI) => WO
  }
): FullZodvexCodec<W, R> {
  return zodvexCodec(wire, runtime, transforms) as unknown as FullZodvexCodec<W, R>
}

/**
 * Minimal model shape accepted by zx helpers.
 * Both full and slim models satisfy this at runtime.
 */
type ZxModelInput = {
  readonly name: string
  readonly fields: Record<string, $ZodType>
  readonly schema?: unknown
}

/**
 * Extracts the base schema from a model input.
 * Object models: reconstructs from fields. Union models: extracts from schema property.
 */
function getBaseSchemaFromModel(model: ZxModelInput): $ZodType {
  const hasFields = Object.keys(model.fields).length > 0
  if (hasFields) {
    return z.object(model.fields) as any
  }
  // Union model — need the base schema from model.schema
  const s = model.schema as any
  if (s instanceof $ZodTypeValue) return s // slim model: .schema IS the base
  if (s?.base instanceof $ZodTypeValue) return s.base // full model: .schema.base
  throw new Error('[zodvex] Union model passed to zx helper without a base schema')
}

/**
 * Constructs a doc schema: base fields + _id + _creationTime.
 * For object models: extends fields with system fields.
 * For union models: adds system fields to each variant via addSystemFields.
 */
function doc(model: ZxModelInput) {
  const baseSchema = getBaseSchemaFromModel(model)
  return addSystemFields(model.name, baseSchema)
}

/**
 * Constructs an update schema: _id required + _creationTime optional + all user fields optional.
 * For union models: maps partial over each variant via createSchemaUpdateSchema.
 */
function update(model: ZxModelInput) {
  const baseSchema = getBaseSchemaFromModel(model)
  return createSchemaUpdateSchema(model.name, baseSchema)
}

/**
 * Constructs a doc array schema: z.array(doc(model)).
 */
function docArray(model: ZxModelInput) {
  return z.array(doc(model))
}

/**
 * Pagination options schema — matches Convex's PaginationOptions type.
 */
function paginationOpts() {
  return z.object({
    numItems: z.number(),
    cursor: z.string().nullable(),
    endCursor: z.string().nullable().optional(),
    id: z.number().optional(),
    maximumRowsRead: z.number().optional(),
    maximumBytesRead: z.number().optional()
  })
}

/**
 * Paginated result schema — wraps any item schema in Convex's PaginationResult shape.
 */
function paginationResult<T extends $ZodType>(itemSchema: T) {
  return z.object({
    page: z.array(itemSchema),
    isDone: z.boolean(),
    continueCursor: z.string(),
    splitCursor: z.string().nullable().optional(),
    pageStatus: z.enum(['SplitRecommended', 'SplitRequired']).nullable().optional()
  })
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
  codec,

  /**
   * Pagination options schema matching Convex's PaginationOptions type
   * @see {@link paginationOpts}
   */
  paginationOpts,

  /**
   * Paginated result schema wrapping any item schema in Convex's PaginationResult shape
   * @see {@link paginationResult}
   */
  paginationResult,

  /**
   * Doc schema: model fields + _id + _creationTime
   * @see {@link doc}
   */
  doc,

  /**
   * Update schema: _id required, all other fields optional
   * @see {@link update}
   */
  update,

  /**
   * Doc array schema: z.array(doc(model))
   * @see {@link docArray}
   */
  docArray
} as const
