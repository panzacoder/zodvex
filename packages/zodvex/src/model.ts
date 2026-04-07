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
  type AddSystemFieldsToUnion,
  addSystemFields,
  createUnionFromOptions,
  getUnionOptions,
  isZodUnion
} from './schemaHelpers'
import {
  $ZodArray,
  $ZodObject,
  $ZodOptional,
  type $ZodShape,
  $ZodType,
  type input as zinput
} from './zod-core'
import { type ZxId, zx } from './zx'

// Return type alias so the function signature line doesn't contain z.Zod* (formatter-safe)
type AnyOptional = z.ZodOptional<any> // zod-ok

/** Wrap in .optional() only if not already optional. Uses core constructor for zod-mini compat. */
function ensureOptional(schema: $ZodType): AnyOptional {
  if (schema instanceof $ZodOptional) return schema as z.ZodOptional<any> // zod-ok
  return new $ZodOptional({ type: 'optional', innerType: schema }) as z.ZodOptional<any> // zod-ok
}

type RuntimeModelSchemaBundle = {
  readonly doc: $ZodType
  readonly base: $ZodType
  readonly insert: $ZodType
  readonly update: $ZodType
  readonly docArray: $ZodType
  readonly paginatedDoc: $ZodType
}

function createPartialShape(shape: Record<string, $ZodType>): Record<string, $ZodType> {
  const partialShape: Record<string, $ZodType> = {}
  for (const [key, value] of Object.entries(shape)) {
    partialShape[key] = ensureOptional(value)
  }
  return partialShape
}

function createUpdateObjectSchema<Name extends string>(
  name: Name,
  shape: Record<string, $ZodType>
): z.ZodObject<any> {
  return z.object({
    _id: zx.id(name),
    _creationTime: z.optional(z.number()),
    ...createPartialShape(shape)
  })
}

function createPaginatedDocSchema(docSchema: $ZodType): z.ZodObject<any> {
  return z.object({
    page: z.array(docSchema),
    isDone: z.boolean(),
    continueCursor: z.optional(z.nullable(z.string()))
  })
}

function createObjectModelSchemaBundle<Name extends string>(
  name: Name,
  fields: $ZodShape
): RuntimeModelSchemaBundle {
  const insertSchema = z.object(fields)
  const docSchema = z.object({ ...fields, _id: zx.id(name), _creationTime: z.number() })

  return {
    doc: docSchema,
    base: insertSchema,
    insert: insertSchema,
    update: createUpdateObjectSchema(name, fields),
    docArray: z.array(docSchema),
    paginatedDoc: createPaginatedDocSchema(docSchema)
  }
}

function createSchemaModelUpdateSchema<Name extends string>(name: Name, inputSchema: $ZodType): $ZodType {
  if (isZodUnion(inputSchema)) {
    const updateOptions = getUnionOptions(inputSchema).map((variant: $ZodType) => {
      if (variant instanceof $ZodObject) {
        return createUpdateObjectSchema(name, variant._zod.def.shape)
      }
      return variant
    })
    return createUnionFromOptions(updateOptions)
  }

  if (inputSchema instanceof $ZodObject) {
    return createUpdateObjectSchema(name, inputSchema._zod.def.shape)
  }

  return inputSchema
}

function createSchemaModelSchemaBundle<Name extends string>(
  name: Name,
  inputSchema: $ZodType
): RuntimeModelSchemaBundle {
  const docSchema = addSystemFields(name, inputSchema)

  return {
    doc: docSchema,
    base: inputSchema,
    insert: inputSchema,
    update: createSchemaModelUpdateSchema(name, inputSchema),
    docArray: z.array(docSchema),
    paginatedDoc: createPaginatedDocSchema(docSchema)
  }
}

function createModel<Name extends string>(
  name: Name,
  fields: $ZodShape,
  schema: RuntimeModelSchemaBundle,
  indexes: Record<string, readonly string[]> = {},
  searchIndexes: Record<string, SearchIndexConfig> = {},
  vectorIndexes: Record<string, VectorIndexConfig> = {}
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
        name,
        fields,
        schema,
        { ...indexes, [indexName]: [...indexFields, '_creationTime'] },
        searchIndexes,
        vectorIndexes
      )
    },
    searchIndex(indexName: string, config: SearchIndexConfig) {
      return createModel(
        name,
        fields,
        schema,
        indexes,
        { ...searchIndexes, [indexName]: config },
        vectorIndexes
      )
    },
    vectorIndex(indexName: string, config: VectorIndexConfig) {
      return createModel(
        name,
        fields,
        schema,
        indexes,
        searchIndexes,
        { ...vectorIndexes, [indexName]: config }
      )
    }
  }

  attachMeta(model, { type: 'model', tableName: name, schemas: schema })
  return model
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
 * Constraint for the schema bundle carried by ZodModel.
 * Concrete types (FullZodModelSchemas, MiniModelSchemas) satisfy this.
 */
export type ModelSchemas = {
  readonly doc: $ZodType
  readonly base: $ZodType
  readonly insert: $ZodType
  readonly update: $ZodType
  readonly docArray: $ZodType
  readonly paginatedDoc: $ZodType
}

/**
 * Schema types for union/discriminated union models.
 * Preserves the specific Schema type so ConvexTableFor can compute
 * validators from the union, and consumers get typed schema.doc access.
 */
export type UnionModelSchemas<Name extends string, Schema extends $ZodType> = {
  readonly doc: AddSystemFieldsToUnion<Name, Schema>
  readonly base: Schema
  readonly insert: Schema
  readonly update: $ZodType
  readonly docArray: $ZodArray<AddSystemFieldsToUnion<Name, Schema>>
  readonly paginatedDoc: $ZodType
}

/** @internal Update shape for FullZodModelSchemas — full-zod types only. */ // zod-ok
type FullUpdateShape<Name extends string, Fields extends $ZodShape> = {
  // zod-ok
  _id: ZxId<Name> // zod-ok
  _creationTime: z.ZodOptional<z.ZodNumber> // zod-ok
} & { [K in keyof Fields]: z.ZodOptional<Fields[K]> } // zod-ok

/** @internal Doc shape used by docArray and paginatedDoc. */ // zod-ok
type FullDocShape<Name extends string, Fields extends $ZodShape> = Fields & {
  // zod-ok
  _id: ZxId<Name> // zod-ok
  _creationTime: z.ZodNumber // zod-ok
} // zod-ok

/** @internal PaginatedDoc shape for FullZodModelSchemas. */ // zod-ok
type FullPaginatedShape<Name extends string, Fields extends $ZodShape> = {
  // zod-ok
  page: z.ZodArray<z.ZodObject<FullDocShape<Name, Fields>>> // zod-ok
  isDone: z.ZodBoolean // zod-ok
  continueCursor: z.ZodOptional<z.ZodNullable<z.ZodString>> // zod-ok
} // zod-ok

/**
 * Full-zod schema types — the default for zodvex/core consumers.
 * Each property uses z.ZodObject / z.ZodArray etc. from full zod, // zod-ok
 * providing method chaining (.parse(), .shape, .nullable(), etc.).
 */
export type FullZodModelSchemas<Name extends string, Fields extends $ZodShape> = {
  readonly doc: z.ZodObject<FullDocShape<Name, Fields>> // zod-ok
  readonly base: z.ZodObject<Fields> // zod-ok
  readonly insert: z.ZodObject<Fields> // zod-ok
  readonly update: z.ZodObject<FullUpdateShape<Name, Fields>> // zod-ok
  readonly docArray: z.ZodArray<z.ZodObject<FullDocShape<Name, Fields>>> // zod-ok
  readonly paginatedDoc: z.ZodObject<FullPaginatedShape<Name, Fields>> // zod-ok
}

/**
 * A client-safe model definition with type-safe schemas and index metadata.
 *
 * Produced by defineZodModel(). Chainable via .index(), .searchIndex(), .vectorIndex().
 * Each chain call returns a new immutable model with accumulated metadata.
 *
 * The `Schemas` parameter carries the concrete schema types — full-zod types
 * from zodvex/core, mini types from zodvex/mini. Chain methods preserve `Schemas`
 * unchanged since they only modify index metadata.
 *
 * Downstream consumers wrap this to add domain metadata (e.g., security rules).
 */
export type ZodModel<
  Name extends string = string,
  Fields extends $ZodShape = $ZodShape,
  InsertSchema extends $ZodType = $ZodType,
  Schemas extends ModelSchemas = ModelSchemas,
  Indexes extends Record<string, readonly string[]> = Record<string, readonly string[]>,
  SearchIndexes extends Record<string, SearchIndexConfig> = Record<string, SearchIndexConfig>,
  VectorIndexes extends Record<string, VectorIndexConfig> = Record<string, VectorIndexConfig>
> = {
  readonly name: Name
  readonly fields: Fields
  readonly schema: Schemas
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
    Schemas,
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
    Schemas,
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
    Schemas,
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
): ZodModel<Name, Fields, z.ZodObject<Fields>, FullZodModelSchemas<Name, Fields>, {}, {}, {}> // zod-ok

// Overload 2: pre-built schema (union or object)
export function defineZodModel<Name extends string, Schema extends $ZodType>(
  name: Name,
  schema: Schema
  // biome-ignore lint/complexity/noBannedTypes: {} is intentional — represents zero indexes/searchIndexes/vectorIndexes
): ZodModel<Name, $ZodShape, Schema, UnionModelSchemas<Name, Schema>, {}, {}, {}>

// Implementation
export function defineZodModel<Name extends string>(
  name: Name,
  fieldsOrSchema: $ZodShape | $ZodType
): any {
  // Detect if input is a pre-built Zod schema (union, object, etc.) vs raw shape
  if (fieldsOrSchema instanceof $ZodType) {
    return createModel(name, {}, createSchemaModelSchemaBundle(name, fieldsOrSchema as $ZodType))
  }

  const fields = fieldsOrSchema as $ZodShape
  return createModel(name, fields, createObjectModelSchemaBundle(name, fields))
}
