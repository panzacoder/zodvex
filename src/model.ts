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
import { type ZxId, zx } from './zx'

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
export type ModelFieldPaths<InsertSchema extends z.ZodTypeAny> =
  | FieldPaths<z.input<InsertSchema>>
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
 * Frameworks like hotpot wrap this to add domain metadata (e.g., security rules).
 */
export type ZodModel<
  Name extends string = string,
  Fields extends z.ZodRawShape = z.ZodRawShape,
  InsertSchema extends z.ZodTypeAny = z.ZodTypeAny,
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
 * @param name - The table name (literal string type preserved)
 * @param fields - Raw Zod shape mapping field names to Zod types
 * @returns A ZodModel with schemas, chainable index methods
 *
 * @example
 * ```ts
 * import { z } from 'zod'
 * import { defineZodModel, zx } from 'zodvex/core'
 *
 * const patients = defineZodModel('patients', {
 *   clinicId: z.string(),
 *   email: z.string().email().optional(),
 *   createdAt: zx.date(),
 * })
 *   .index('byClinic', ['clinicId'])
 *   .index('byCreation', ['_creationTime'])
 * ```
 */
export function defineZodModel<Name extends string, Fields extends z.ZodRawShape>(
  name: Name,
  fields: Fields
): ZodModel<Name, Fields, z.ZodObject<Fields>, {}, {}, {}> {
  const insertSchema = z.object(fields)
  const docSchema = insertSchema.extend({
    _id: zx.id(name),
    _creationTime: z.number()
  })

  // Create partial shape for update: _id required, _creationTime optional, user fields partial
  const partialShape: Record<string, z.ZodTypeAny> = {}
  for (const [key, value] of Object.entries(fields)) {
    partialShape[key] = (value as z.ZodTypeAny).optional()
  }
  const updateSchema = z.object({
    _id: zx.id(name),
    _creationTime: z.number().optional(),
    ...partialShape
  })

  const docArraySchema = z.array(docSchema)

  const schema = {
    doc: docSchema,
    base: insertSchema,
    insert: insertSchema,
    update: updateSchema,
    docArray: docArraySchema
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
