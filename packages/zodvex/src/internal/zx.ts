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
import { createSchemaUpdateSchema } from './modelSchemaBundle'
import { addSystemFields } from './schemaHelpers'
import type { ZodvexCodec } from './types'
import {
  type $ZodCustom,
  $ZodNullable,
  type $ZodNumber,
  $ZodOptional,
  type $ZodType,
  $ZodType as $ZodTypeValue,
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
 * Per-model caches so repeated `zx.doc(model)` / `zx.base(model)` / etc. calls
 * across call sites share a single Zod schema instance.
 *
 * Caches are keyed on a stable identity that survives chain methods
 * (`.index()`, `.searchIndex()`, `.vectorIndex()`), which return new model
 * objects but preserve `fields` (object slim) and `schema` (union slim) by
 * reference. Keying on the model object would force every chain step to
 * re-allocate.
 *
 * Full models bypass these caches entirely — they carry a pre-built schema
 * bundle, and `zx.*(fullModel)` returns the bundle's schema directly so
 * identity matches `fullModel.schema.{doc,base,...}`.
 *
 * The cache maps are pinned to `globalThis` under a `Symbol.for` registry so
 * multiple bundled copies of this module share state. tsup splits each entry
 * into its own bundle (CLI, codegen, main, server, …), duplicating this file
 * per entry. Without the shared registry, `zx.doc(Model)` in user code
 * (loaded from `dist/index.js`) and `zx.doc(ref)` in codegen (loaded from
 * `dist/cli/index.js`) would write to distinct WeakMaps, producing different
 * instances for the same model — identity matching would silently fail.
 */
function sharedWeakMap(name: string): WeakMap<object, $ZodType> {
  const key = Symbol.for(`zodvex.zx.cache.${name}`)
  const g = globalThis as unknown as Record<symbol, WeakMap<object, $ZodType>>
  const existing = g[key]
  if (existing) return existing
  const created = new WeakMap<object, $ZodType>()
  g[key] = created
  return created
}

const baseCache = sharedWeakMap('base')
const docCache = sharedWeakMap('doc')
const updateCache = sharedWeakMap('update')
const docArrayCache = sharedWeakMap('docArray')

/**
 * Stable cache key for slim models:
 *   - union slim → the user-supplied schema (preserved across chains)
 *   - object slim → the fields record (preserved across chains)
 */
function slimCacheKey(model: ZxModelInput): object {
  const s = model.schema as any
  return s instanceof $ZodTypeValue ? s : model.fields
}

/**
 * Returns the base schema for a model — the user fields as a Zod object (or the
 * user-supplied union for discriminated-union models).
 *
 * Full models: returns the bundle's pre-built `.base` (no allocation).
 * Union slim: returns the user's schema (no allocation — it IS the base).
 * Object slim: builds `z.object(fields)` once, cached on `fields`.
 */
function base(model: ZxModelInput): $ZodType {
  const s = model.schema as any
  if (s?.base instanceof $ZodTypeValue) return s.base
  if (s instanceof $ZodTypeValue) return s
  const cached = baseCache.get(model.fields)
  if (cached) return cached
  if (Object.keys(model.fields).length === 0) {
    throw new Error(`[zodvex] Cannot derive base schema for model '${model.name}'`)
  }
  const built = z.object(model.fields) as any
  baseCache.set(model.fields, built)
  return built
}

/**
 * Constructs a doc schema: base fields + _id + _creationTime.
 * Full models reuse `model.schema.doc`; slim models cache on slimCacheKey(model).
 */
function doc(model: ZxModelInput) {
  const s = model.schema as any
  if (s?.doc instanceof $ZodTypeValue) return s.doc
  const key = slimCacheKey(model)
  const cached = docCache.get(key)
  if (cached) return cached
  const built = addSystemFields(model.name, base(model)) as any
  docCache.set(key, built)
  return built
}

/**
 * Constructs an update schema: _id required + _creationTime optional + all user fields optional.
 * Full models reuse `model.schema.update`; slim models cache on slimCacheKey(model).
 */
function update(model: ZxModelInput) {
  const s = model.schema as any
  if (s?.update instanceof $ZodTypeValue) return s.update
  const key = slimCacheKey(model)
  const cached = updateCache.get(key)
  if (cached) return cached
  const built = createSchemaUpdateSchema(model.name, base(model)) as any
  updateCache.set(key, built)
  return built
}

/**
 * Constructs a doc array schema: z.array(doc(model)).
 * Full models reuse `model.schema.docArray`; slim models cache on slimCacheKey(model).
 */
function docArray(model: ZxModelInput) {
  const s = model.schema as any
  if (s?.docArray instanceof $ZodTypeValue) return s.docArray
  const key = slimCacheKey(model)
  const cached = docArrayCache.get(key)
  if (cached) return cached
  const built = z.array(doc(model)) as any
  docArrayCache.set(key, built)
  return built
}

/** Wrap in .nullable() using core constructor for zod-mini compat. */
function nullable(schema: $ZodType): $ZodType {
  return new $ZodNullable({ type: 'nullable', innerType: schema }) as any
}

/** Wrap in .optional() using core constructor for zod-mini compat. */
function optional(schema: $ZodType): $ZodType {
  return new $ZodOptional({ type: 'optional', innerType: schema }) as any
}

/** Wrap in .nullable().optional() using core constructors for zod-mini compat. */
function nullableOptional(schema: $ZodType): $ZodType {
  return optional(nullable(schema))
}

/**
 * Pagination options schema — matches Convex's PaginationOptions type.
 */
function paginationOpts() {
  return z.object({
    numItems: z.number(),
    cursor: nullable(z.string()),
    endCursor: nullableOptional(z.string()),
    id: optional(z.number()),
    maximumRowsRead: optional(z.number()),
    maximumBytesRead: optional(z.number())
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
    splitCursor: nullableOptional(z.string()),
    pageStatus: nullableOptional(z.enum(['SplitRecommended', 'SplitRequired']))
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
   * Base schema for a model (user fields only; no system fields).
   * For object models reconstructs from fields; for union models returns the
   * user-supplied union. Cached per-model.
   * @see {@link base}
   */
  base,

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
