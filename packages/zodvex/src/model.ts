/**
 * defineZodModel — Client-safe model definitions with type-safe indexes
 *
 * This module is the client-safe spiritual successor to zodTable().
 * It produces Zod schemas for codec decode/encode and type-safe index
 * definitions via z.input<T> field path extraction.
 *
 * Exported from zodvex/core (no server imports).
 */

import { z } from 'zod'
import { attachMeta } from './meta'
import {
  addSystemFields,
  createUnionFromOptions,
  getUnionOptions,
  isZodUnion
} from './schemaHelpers'
import {
  $ZodObject,
  $ZodOptional,
  type $ZodShape,
  $ZodType,
  type input as zinput
} from './zod-core'
import { type ZxId, zx } from './zx'

/** Wrap in .optional() only if not already optional. Uses core constructor for zod-mini compat. */
function ensureOptional(schema: $ZodType): z.ZodOptional<any> {
  if (schema instanceof $ZodOptional) return schema as z.ZodOptional<any>
  return new $ZodOptional({ type: 'optional', innerType: schema }) as z.ZodOptional<any>
}

// ============================================================================
// Field Path Types
// ============================================================================

/**
 * Extract all valid field paths from a TypeScript object type.
 * Mirrors Convex's ExtractFieldPaths but operates on plain TS types
 * inferred from z.input<T> (wire format).
 *
 * - Recurses into nested objects to produce dotted paths ("address.city")
 * - Distributes over unions (T extends T trick)
 * - Excludes arrays (can't index into array elements)
 * - Unwraps nullable/optional via NonNullable before recursing
 */
export type FieldPaths<T> = T extends any[]
  ? never
  : T extends Record<string, any>
    ? T extends T // distribute over unions
      ? {
          [K in keyof T & string]:
            | K
            | (NonNullable<T[K]> extends any[]
                ? never
                : NonNullable<T[K]> extends Record<string, any>
                  ? `${K}.${FieldPaths<NonNullable<T[K]>>}`
                  : never)
        }[keyof T & string]
      : never
    : never

/**
 * Field paths valid for index definitions on a model.
 * Uses z.input<T> to get wire-format paths, plus _creationTime system field.
 */
export type ModelFieldPaths<InsertSchema extends $ZodType> =
  | FieldPaths<zinput<InsertSchema>>
  | '_creationTime'

// ============================================================================
// Index Config Types
// ============================================================================

export type SearchIndexConfig = {
  searchField: string
  filterFields?: string[]
}

export type VectorIndexConfig = {
  vectorField: string
  dimensions: number
  filterFields?: string[]
}

// ============================================================================
// ZodModel Type
// ============================================================================

/**
 * A client-safe model definition with type-safe schemas and index metadata.
 *
 * Produced by defineZodModel(). Chainable via .index(), .searchIndex(), .vectorIndex().
 * Each chain call returns a new immutable model with accumulated metadata.
 *
 * Downstream consumers wrap this to add domain metadata (e.g., security rules).
 */
export type ZodModel<
  Name extends string = string,
  Fields extends $ZodShape = $ZodShape,
  InsertSchema extends $ZodType = $ZodType,
  Indexes extends Record<string, readonly string[]> = Record<string, readonly string[]>,
  SearchIndexes extends Record<string, SearchIndexConfig> = Record<string, SearchIndexConfig>,
  VectorIndexes extends Record<string, VectorIndexConfig> = Record<string, VectorIndexConfig>
> = {
  readonly name: Name
  readonly fields: Fields
  readonly schema: {
    readonly doc: z.ZodObject<Fields & { _id: ZxId<Name>; _creationTime: z.ZodNumber }>
    /** User fields only — alias for insert */
    readonly base: z.ZodObject<Fields>
    readonly insert: z.ZodObject<Fields>
    readonly update: z.ZodObject<
      { _id: ZxId<Name>; _creationTime: z.ZodOptional<z.ZodNumber> } & {
        [K in keyof Fields]: z.ZodOptional<Fields[K]>
      }
    >
    readonly docArray: z.ZodArray<
      z.ZodObject<Fields & { _id: ZxId<Name>; _creationTime: z.ZodNumber }>
    >
    readonly paginatedDoc: z.ZodObject<{
      page: z.ZodArray<z.ZodObject<Fields & { _id: ZxId<Name>; _creationTime: z.ZodNumber }>>
      isDone: z.ZodBoolean
      continueCursor: z.ZodOptional<z.ZodNullable<z.ZodString>>
    }>
  }
  readonly indexes: Indexes
  readonly searchIndexes: SearchIndexes
  readonly vectorIndexes: VectorIndexes

  index<
    IndexName extends string,
    First extends ModelFieldPaths<InsertSchema>,
    Rest extends ModelFieldPaths<InsertSchema>[]
  >(
    name: IndexName,
    fields: readonly [First, ...Rest]
  ): ZodModel<
    Name,
    Fields,
    InsertSchema,
    Indexes & Record<IndexName, readonly [First, ...Rest, '_creationTime']>,
    SearchIndexes,
    VectorIndexes
  >

  searchIndex<IndexName extends string>(
    name: IndexName,
    config: SearchIndexConfig
  ): ZodModel<
    Name,
    Fields,
    InsertSchema,
    Indexes,
    SearchIndexes & Record<IndexName, SearchIndexConfig>,
    VectorIndexes
  >

  vectorIndex<IndexName extends string>(
    name: IndexName,
    config: VectorIndexConfig
  ): ZodModel<
    Name,
    Fields,
    InsertSchema,
    Indexes,
    SearchIndexes,
    VectorIndexes & Record<IndexName, VectorIndexConfig>
  >
}

// ============================================================================
// defineZodModel
// ============================================================================

/**
 * Define a client-safe model with Zod schemas and type-safe index definitions.
 *
 * Accepts either a raw Zod shape (object mapping field names to Zod types) or
 * a pre-built Zod schema (union, discriminated union, or object).
 *
 * @param name - The table name (literal string type preserved)
 * @param fieldsOrSchema - Raw Zod shape or pre-built Zod schema
 * @returns A ZodModel with schemas, chainable index methods
 *
 * @example Raw shape (most common)
 * ```ts
 * const patients = defineZodModel('patients', {
 *   clinicId: z.string(),
 *   email: z.string().email().optional(),
 *   createdAt: zx.date(),
 * })
 *   .index('byClinic', ['clinicId'])
 *   .index('byCreation', ['_creationTime'])
 * ```
 *
 * @example Discriminated union
 * ```ts
 * const visits = defineZodModel('visits', z.discriminatedUnion('type', [
 *   z.object({ type: z.literal('phone'), duration: z.number() }),
 *   z.object({ type: z.literal('in-person'), roomId: z.string() }),
 * ]))
 *   .index('byType', ['type'])
 * ```
 */
// Overload 1: raw shape (existing behavior)
export function defineZodModel<Name extends string, Fields extends $ZodShape>(
  name: Name,
  fields: Fields
  // biome-ignore lint/complexity/noBannedTypes: {} is intentional — represents zero indexes/searchIndexes/vectorIndexes
): ZodModel<Name, Fields, z.ZodObject<Fields>, {}, {}, {}>

// Overload 2: pre-built schema (union or object)
export function defineZodModel<Name extends string, Schema extends $ZodType>(
  name: Name,
  schema: Schema
  // biome-ignore lint/complexity/noBannedTypes: {} is intentional — represents zero indexes/searchIndexes/vectorIndexes
): ZodModel<Name, $ZodShape, Schema, {}, {}, {}>

// Implementation
export function defineZodModel<Name extends string>(
  name: Name,
  fieldsOrSchema: $ZodShape | $ZodType
): any {
  // Detect if input is a pre-built Zod schema (union, object, etc.) vs raw shape
  if (fieldsOrSchema instanceof $ZodType) {
    return createUnionModel(name, fieldsOrSchema as $ZodType)
  }

  // Existing raw-shape path
  const fields = fieldsOrSchema as $ZodShape

  const insertSchema = z.object(fields)
  const docSchema = z.object({ ...fields, _id: zx.id(name), _creationTime: z.number() })

  // Create partial shape for update: _id required, _creationTime optional, user fields partial
  const partialShape: Record<string, $ZodType> = {}
  for (const [key, value] of Object.entries(fields)) {
    partialShape[key] = ensureOptional(value as $ZodType)
  }
  const updateSchema = z.object({
    _id: zx.id(name),
    _creationTime: z.number().optional(),
    ...partialShape
  })

  const docArraySchema = z.array(docSchema)

  const paginatedDocSchema = z.object({
    page: z.array(docSchema),
    isDone: z.boolean(),
    continueCursor: z.string().nullable().optional()
  })

  const schema = {
    doc: docSchema,
    base: insertSchema,
    insert: insertSchema,
    update: updateSchema,
    docArray: docArraySchema,
    paginatedDoc: paginatedDocSchema
  }

  function createModel(
    indexes: Record<string, readonly string[]>,
    searchIndexes: Record<string, SearchIndexConfig>,
    vectorIndexes: Record<string, VectorIndexConfig>
  ): any {
    const model = {
      name,
      fields,
      schema,
      indexes,
      searchIndexes,
      vectorIndexes,
      index(indexName: string, indexFields: readonly string[]) {
        return createModel(
          { ...indexes, [indexName]: [...indexFields, '_creationTime'] },
          searchIndexes,
          vectorIndexes
        )
      },
      searchIndex(indexName: string, config: SearchIndexConfig) {
        return createModel(indexes, { ...searchIndexes, [indexName]: config }, vectorIndexes)
      },
      vectorIndex(indexName: string, config: VectorIndexConfig) {
        return createModel(indexes, searchIndexes, { ...vectorIndexes, [indexName]: config })
      }
    }
    attachMeta(model, { type: 'model', tableName: name, schemas: schema })
    return model
  }

  return createModel({}, {}, {})
}

// ============================================================================
// createUnionModel — Internal helper for union/schema path
// ============================================================================

/**
 * Creates a ZodModel from a pre-built Zod schema (union, discriminated union, or object).
 * Mirrors the union path logic from zodTable() in tables.ts.
 *
 * @internal
 */
function createUnionModel<Name extends string>(name: Name, inputSchema: $ZodType): any {
  const insertSchema = inputSchema
  const docSchema = addSystemFields(name, inputSchema)
  const docArraySchema = z.array(docSchema)
  const paginatedDocSchema = z.object({
    page: z.array(docSchema),
    isDone: z.boolean(),
    continueCursor: z.string().nullable().optional()
  })

  // Build update schema: _id required, _creationTime optional, user fields partial
  let updateSchema: $ZodType
  if (isZodUnion(inputSchema)) {
    const originalOptions = getUnionOptions(inputSchema)
    const updateOptions = originalOptions.map((variant: $ZodType) => {
      if (variant instanceof $ZodObject) {
        const partialShape: Record<string, $ZodType> = {}
        for (const [key, value] of Object.entries(variant._zod.def.shape)) {
          partialShape[key] = ensureOptional(value as $ZodType)
        }
        return z.object({
          _id: zx.id(name),
          _creationTime: z.number().optional(),
          ...partialShape
        })
      }
      return variant
    })
    updateSchema = createUnionFromOptions(updateOptions)
  } else if (inputSchema instanceof $ZodObject) {
    const partialShape: Record<string, $ZodType> = {}
    for (const [key, value] of Object.entries(inputSchema._zod.def.shape)) {
      partialShape[key] = ensureOptional(value as $ZodType)
    }
    updateSchema = z.object({
      _id: zx.id(name),
      _creationTime: z.number().optional(),
      ...partialShape
    })
  } else {
    updateSchema = inputSchema
  }

  const schema = {
    doc: docSchema,
    base: insertSchema,
    insert: insertSchema,
    update: updateSchema,
    docArray: docArraySchema,
    paginatedDoc: paginatedDocSchema
  }

  // For union models, fields is an empty shape (field paths come from InsertSchema generic)
  const fields: $ZodShape = {}

  function createModel(
    indexes: Record<string, readonly string[]>,
    searchIndexes: Record<string, SearchIndexConfig>,
    vectorIndexes: Record<string, VectorIndexConfig>
  ): any {
    const model = {
      name,
      fields,
      schema,
      indexes,
      searchIndexes,
      vectorIndexes,
      index(indexName: string, indexFields: readonly string[]) {
        return createModel(
          { ...indexes, [indexName]: [...indexFields, '_creationTime'] },
          searchIndexes,
          vectorIndexes
        )
      },
      searchIndex(indexName: string, config: SearchIndexConfig) {
        return createModel(indexes, { ...searchIndexes, [indexName]: config }, vectorIndexes)
      },
      vectorIndex(indexName: string, config: VectorIndexConfig) {
        return createModel(indexes, searchIndexes, { ...vectorIndexes, [indexName]: config })
      }
    }
    attachMeta(model, { type: 'model', tableName: name, schemas: schema })
    return model
  }

  return createModel({}, {}, {})
}
