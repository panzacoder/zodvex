import { defineTable } from 'convex/server'
import type { GenericId } from 'convex/values'
import { Table } from 'convex-helpers/server'
import { z } from 'zod'
import { zid } from './ids'
import { type ConvexValidatorFromZodFieldsAuto, zodToConvex, zodToConvexFields } from './mapping'

/**
 * Makes all properties of a Zod object shape optional.
 */
type PartialShape<Shape extends z.ZodRawShape> = {
  [K in keyof Shape]: z.ZodOptional<Shape[K]>
}

/**
 * Helper type for Convex system fields added to documents
 */
type SystemFields<TableName extends string> = {
  _id: ReturnType<typeof zid<TableName>>
  _creationTime: z.ZodNumber
}

/**
 * Maps over union options, extending each ZodObject variant with system fields.
 * Non-object variants are preserved as-is.
 */
type MapSystemFields<TableName extends string, Options extends readonly z.ZodTypeAny[]> = {
  [K in keyof Options]: Options[K] extends z.ZodObject<infer Shape extends z.ZodRawShape>
    ? z.ZodObject<Shape & SystemFields<TableName>>
    : Options[K]
}

// ============================================================================
// Union Helpers - Type-safe utilities for working with Zod unions
// ============================================================================

/**
 * Type guard to check if a schema is a union type (ZodUnion or ZodDiscriminatedUnion).
 */
export function isZodUnion(
  schema: z.ZodTypeAny
): schema is
  | z.ZodUnion<readonly z.ZodTypeAny[]>
  | z.ZodDiscriminatedUnion<readonly z.ZodObject<z.ZodRawShape>[], string> {
  return schema instanceof z.ZodUnion || schema instanceof z.ZodDiscriminatedUnion
}

/**
 * Extracts the options array from a ZodUnion or ZodDiscriminatedUnion.
 * Both union types have an `.options` property, but TypeScript doesn't
 * create a common accessor after instanceof checks.
 *
 * @param schema - A ZodUnion or ZodDiscriminatedUnion schema
 * @returns The array of union variant schemas
 */
export function getUnionOptions(
  schema:
    | z.ZodUnion<readonly z.ZodTypeAny[]>
    | z.ZodDiscriminatedUnion<readonly z.ZodObject<z.ZodRawShape>[], string>
): readonly z.ZodTypeAny[] {
  // Both ZodUnion and ZodDiscriminatedUnion have .options getter
  // This is safe because we've constrained the input type
  return schema.options
}

/**
 * Minimum tuple type required by z.union() - at least 2 elements.
 */
type UnionTuple<T extends z.ZodTypeAny = z.ZodTypeAny> = readonly [T, T, ...T[]]

/**
 * Asserts that an array has at least 2 elements, as required by z.union().
 * Throws an error if the array has fewer than 2 elements.
 *
 * @param options - Array of Zod schemas
 * @throws Error if array has fewer than 2 elements
 */
export function assertUnionOptions<T extends z.ZodTypeAny>(
  options: readonly T[]
): asserts options is UnionTuple<T> {
  if (options.length < 2) {
    throw new Error(
      `z.union() requires at least 2 options, but received ${options.length}. ` +
        'This indicates an invalid union schema was passed to zodTable().'
    )
  }
}

/**
 * Creates a z.union() from an array of options with runtime validation.
 * Ensures the array has at least 2 elements as required by Zod.
 *
 * @param options - Array of Zod schemas (must have at least 2 elements)
 * @returns A ZodUnion schema
 * @throws Error if array has fewer than 2 elements
 */
export function createUnionFromOptions<T extends z.ZodTypeAny>(
  options: readonly T[]
): z.ZodUnion<UnionTuple<T>> {
  assertUnionOptions(options)
  return z.union(options)
}

/**
 * Adds Convex system fields (_id, _creationTime) to a Zod schema.
 *
 * For object schemas: extends with system fields
 * For union schemas: adds system fields to each variant
 *
 * @param tableName - The Convex table name
 * @param schema - The Zod schema (object or union)
 * @returns Schema with system fields added
 */
// Overload 1: ZodObject - extends with system fields
export function addSystemFields<TableName extends string, Shape extends z.ZodRawShape>(
  tableName: TableName,
  schema: z.ZodObject<Shape>
): z.ZodObject<Shape & SystemFields<TableName>>

// Overload 2: ZodUnion - maps system fields to each variant
export function addSystemFields<TableName extends string, Options extends readonly z.ZodTypeAny[]>(
  tableName: TableName,
  schema: z.ZodUnion<Options>
): z.ZodUnion<MapSystemFields<TableName, Options>>

// Overload 3: ZodDiscriminatedUnion - maps system fields preserving discriminator
// Note: Zod v4 signature is ZodDiscriminatedUnion<Options, Discriminator>
export function addSystemFields<
  TableName extends string,
  Options extends readonly z.ZodObject<z.ZodRawShape>[],
  Discriminator extends string
>(
  tableName: TableName,
  schema: z.ZodDiscriminatedUnion<Options, Discriminator>
): z.ZodDiscriminatedUnion<MapSystemFields<TableName, Options>, Discriminator>

// Overload 4: Fallback for other ZodTypes - returns as-is
export function addSystemFields<TableName extends string, S extends z.ZodTypeAny>(
  tableName: TableName,
  schema: S
): S

// Implementation
export function addSystemFields<TableName extends string>(
  tableName: TableName,
  schema: z.ZodTypeAny
): z.ZodTypeAny {
  // Handle union schemas - add system fields to each variant
  if (isZodUnion(schema)) {
    const originalOptions = getUnionOptions(schema)
    const extendedOptions = originalOptions.map((variant: z.ZodTypeAny) => {
      if (variant instanceof z.ZodObject) {
        return variant.extend({
          _id: zid(tableName),
          _creationTime: z.number()
        })
      }
      // Non-object variants are returned as-is (shouldn't happen in practice)
      return variant
    })
    return createUnionFromOptions(extendedOptions)
  }

  // Handle object schemas
  if (schema instanceof z.ZodObject) {
    return schema.extend({
      _id: zid(tableName),
      _creationTime: z.number()
    })
  }

  // Fallback: return schema as-is
  return schema
}

/**
 * System fields added to Convex documents.
 */
type DocSystemFields<TableName extends string> = {
  _id: ReturnType<typeof zid<TableName>>
  _creationTime: z.ZodNumber
}

/**
 * Merges a Zod shape with additional fields, preserving type information.
 *
 * TypeScript cannot verify that `{ ...shape1, ...shape2 }` produces `Shape1 & Shape2`
 * at the type level (it infers a mapped type instead). This helper makes the type
 * assertion explicit and localized.
 *
 * @internal
 */
function mergeShapes<Base extends z.ZodRawShape, Extension extends z.ZodRawShape>(
  base: Base,
  extension: Extension
): Base & Extension {
  return { ...base, ...extension } as Base & Extension
}

/**
 * Type for validators that can be used with Convex's defineTable.
 *
 * Convex's defineTable expects Validator<Record<string, any>, "required", any>,
 * but zodToConvex returns more specific types that TypeScript can't verify are
 * compatible. This type represents validators that produce object documents.
 *
 * @internal
 */
type TableValidator = Parameters<typeof defineTable>[0]

/**
 * Asserts that a Convex validator can be used to define a table.
 *
 * This is needed because zodToConvex returns a specific validator type (like VUnion)
 * that TypeScript can't verify is assignable to defineTable's expected input type,
 * even though all union variants are objects that produce Record<string, any>.
 *
 * The runtime behavior is correct - Convex supports union validators in tables.
 * This is purely a TypeScript limitation with complex mapped types.
 *
 * @internal
 */
function asTableValidator<V extends { kind: string }>(validator: V): TableValidator {
  return validator as unknown as TableValidator
}

/**
 * Creates a Zod schema for a Convex document with system fields.
 *
 * @param tableName - The Convex table name
 * @param schema - The Zod object schema for user fields
 * @returns A Zod object schema with _id and _creationTime added
 */
export function zodDoc<TableName extends string, Shape extends z.ZodRawShape>(
  tableName: TableName,
  schema: z.ZodObject<Shape>
): z.ZodObject<Shape & DocSystemFields<TableName>> {
  const systemFields: DocSystemFields<TableName> = {
    _id: zid(tableName),
    _creationTime: z.number()
  }

  return z.object(mergeShapes(schema.shape, systemFields))
}

// Helper to create nullable doc schema
export function zodDocOrNull<
  TableName extends string,
  Shape extends z.ZodRawShape,
  Schema extends z.ZodObject<Shape>
>(tableName: TableName, schema: Schema) {
  return z.union([zodDoc(tableName, schema), z.null()])
}

/**
 * Helper to detect if input is an object shape (plain object with Zod validators)
 */
function isObjectShape(input: any): input is Record<string, z.ZodTypeAny> {
  // Check if it's a plain object (not a Zod instance)
  if (!input || typeof input !== 'object') return false

  // If it's a Zod instance, it's not an object shape
  if (input instanceof z.ZodType) return false

  // Check if all values are Zod types
  for (const key in input) {
    if (!(input[key] instanceof z.ZodType)) {
      return false
    }
  }

  return true
}

/**
 * Defines a Convex table using either:
 * - A raw Zod shape (an object mapping field names to Zod types)
 * - A Zod union schema (for polymorphic tables)
 *
 * For object shapes, this function intentionally accepts a raw shape instead of a ZodObject instance.
 * Accepting raw shapes allows TypeScript to infer field types more accurately and efficiently,
 * leading to better type inference and performance throughout the codebase.
 *
 * For union schemas, this enables polymorphic tables with discriminated unions.
 *
 * Returns the Table definition along with Zod schemas for documents and arrays.
 *
 * @param name - The table name
 * @param schemaOrShape - Either a raw object shape or a Zod union schema
 * @returns A Table with attached helpers (shape, schema, zDoc, docArray, withSystemFields)
 *
 * @example Object shape
 * ```ts
 * const Users = zodTable('users', {
 *   name: z.string(),
 *   email: z.string().email(),
 *   age: z.number().optional()
 * })
 *
 * // Use in schema
 * export default defineSchema({ users: Users.table })
 *
 * // Use for return types
 * export const getUsers = zQuery(query, {},
 *   async (ctx) => ctx.db.query('users').collect(),
 *   { returns: Users.docArray }
 * )
 * ```
 *
 * @example Union schema (polymorphic table)
 * ```ts
 * const shapeSchema = z.union([
 *   z.object({ kind: z.literal('circle'), r: z.number() }),
 *   z.object({ kind: z.literal('rectangle'), width: z.number() })
 * ])
 *
 * const Shapes = zodTable('shapes', shapeSchema)
 *
 * // Use in schema
 * export default defineSchema({ shapes: Shapes.table })
 *
 * // Use for return types with system fields
 * export const getShapes = zQuery(query, {},
 *   async (ctx) => ctx.db.query('shapes').collect(),
 *   { returns: Shapes.docArray }
 * )
 * ```
 */
// Helper type to compute the result of addSystemFields for use in zodTable return type
type AddSystemFieldsResult<
  TableName extends string,
  Schema extends z.ZodTypeAny
> = Schema extends z.ZodObject<infer Shape extends z.ZodRawShape>
  ? z.ZodObject<Shape & SystemFields<TableName>>
  : Schema extends z.ZodUnion<infer Options extends readonly z.ZodTypeAny[]>
    ? z.ZodUnion<MapSystemFields<TableName, Options>>
    : Schema extends z.ZodDiscriminatedUnion<
          infer Options extends readonly z.ZodObject<z.ZodRawShape>[],
          infer Disc extends string
        >
      ? z.ZodDiscriminatedUnion<MapSystemFields<TableName, Options>, Disc>
      : Schema

/**
 * Update schema shape: _id required, _creationTime optional, user fields partial
 */
type UpdateShape<TableName extends string, Shape extends z.ZodRawShape> = {
  _id: ReturnType<typeof zid<TableName>>
  _creationTime: z.ZodOptional<z.ZodNumber>
} & PartialShape<Shape>

/**
 * Maps over union options for update schema.
 * Each variant gets _id required, _creationTime optional, and user fields partial.
 */
type MapUpdateVariants<TableName extends string, Options extends readonly z.ZodTypeAny[]> = {
  [K in keyof Options]: Options[K] extends z.ZodObject<infer Shape extends z.ZodRawShape>
    ? z.ZodObject<UpdateShape<TableName, Shape>>
    : Options[K]
}

/**
 * Computes the update schema type for a given schema.
 * Includes _id (required), _creationTime (optional), and partial user fields.
 * For unions: each variant gets update shape
 * For objects: the whole object gets update shape
 * For other types: returns as-is
 */
type UpdateSchemaType<
  TableName extends string,
  Schema extends z.ZodTypeAny
> = Schema extends z.ZodUnion<infer Options extends readonly z.ZodTypeAny[]>
  ? z.ZodUnion<MapUpdateVariants<TableName, Options>>
  : Schema extends z.ZodDiscriminatedUnion<
        infer Options extends readonly z.ZodObject<z.ZodRawShape>[],
        infer _Disc extends string
      >
    ? z.ZodUnion<MapUpdateVariants<TableName, Options>>
    : Schema extends z.ZodObject<infer Shape extends z.ZodRawShape>
      ? z.ZodObject<UpdateShape<TableName, Shape>>
      : Schema

// Overload 1: Object shape (most common case)
export function zodTable<TableName extends string, Shape extends Record<string, z.ZodTypeAny>>(
  name: TableName,
  shape: Shape
): ReturnType<typeof Table<ConvexValidatorFromZodFieldsAuto<Shape>, TableName>> & {
  shape: Shape
  zDoc: z.ZodObject<
    Shape & {
      _id: ReturnType<typeof zid<TableName>>
      _creationTime: z.ZodNumber
    }
  >
  docArray: z.ZodArray<
    z.ZodObject<
      Shape & {
        _id: ReturnType<typeof zid<TableName>>
        _creationTime: z.ZodNumber
      }
    >
  >
  schema: {
    doc: z.ZodObject<
      Shape & {
        _id: ReturnType<typeof zid<TableName>>
        _creationTime: z.ZodNumber
      }
    >
    docArray: z.ZodArray<
      z.ZodObject<
        Shape & {
          _id: ReturnType<typeof zid<TableName>>
          _creationTime: z.ZodNumber
        }
      >
    >
    /** The base schema - user fields without system fields */
    base: z.ZodObject<Shape>
    /** Alias for base - user fields for insert operations */
    insert: z.ZodObject<Shape>
    /** Update schema - _id required, _creationTime optional, user fields partial */
    update: z.ZodObject<UpdateShape<TableName, Shape>>
  }
}

// Overload 2: Union/schema types
export function zodTable<TableName extends string, Schema extends z.ZodTypeAny>(
  name: TableName,
  schema: Schema
): {
  table: ReturnType<typeof defineTable>
  tableName: TableName
  validator: ReturnType<typeof zodToConvex<Schema>>
  schema: {
    doc: AddSystemFieldsResult<TableName, Schema>
    docArray: z.ZodArray<AddSystemFieldsResult<TableName, Schema>>
    /** The base schema - user fields without system fields */
    base: Schema
    /** Alias for base - user fields for insert operations */
    insert: Schema
    /** Update schema - _id required, _creationTime optional, user fields partial */
    update: UpdateSchemaType<TableName, Schema>
  }
  docArray: z.ZodArray<AddSystemFieldsResult<TableName, Schema>>
  withSystemFields: () => AddSystemFieldsResult<TableName, Schema>
}

export function zodTable<
  TableName extends string,
  SchemaOrShape extends z.ZodTypeAny | Record<string, z.ZodTypeAny>
>(name: TableName, schemaOrShape: SchemaOrShape): any {
  // Detect if it's an object shape or a schema
  if (isObjectShape(schemaOrShape)) {
    // Original object shape logic
    const shape = schemaOrShape as Record<string, z.ZodTypeAny>

    // Convert fields with proper types
    const convexFields = zodToConvexFields(shape) as ConvexValidatorFromZodFieldsAuto<typeof shape>

    // Create the Table from convex-helpers with explicit type
    const table = Table<ConvexValidatorFromZodFieldsAuto<typeof shape>, TableName>(
      name,
      convexFields
    )

    // Create zDoc schema with system fields
    const zDoc = zodDoc(name, z.object(shape))

    // Create docArray helper for return types
    const docArray = z.array(zDoc)

    // Create base schema (user fields only, no system fields)
    const baseSchema = z.object(shape)

    // Create partial shape for user fields
    const partialShape: Record<string, z.ZodTypeAny> = {}
    for (const [key, value] of Object.entries(shape)) {
      partialShape[key] = value.optional()
    }

    // Create update schema: _id required, _creationTime optional, user fields partial
    const updateSchema = z.object({
      _id: zid(name),
      _creationTime: z.number().optional(),
      ...partialShape
    })

    // Create schema namespace
    const schema = {
      doc: zDoc,
      docArray,
      base: baseSchema,
      insert: baseSchema, // alias for base
      update: updateSchema
    }

    // Track if we've warned about deprecated properties
    const warned = { zDoc: false, docArray: false }

    // Attach everything for comprehensive usage
    const result = Object.assign(table, {
      shape,
      schema
    })

    Object.defineProperty(result, 'zDoc', {
      get() {
        if (!warned.zDoc) {
          console.warn('zodvex: `zDoc` is deprecated, use `schema.doc` instead')
          warned.zDoc = true
        }
        return schema.doc
      },
      enumerable: true
    })

    Object.defineProperty(result, 'docArray', {
      get() {
        if (!warned.docArray) {
          console.warn('zodvex: `docArray` is deprecated, use `schema.docArray` instead')
          warned.docArray = true
        }
        return schema.docArray
      },
      enumerable: true
    })

    return result
  } else {
    // Union or other schema type logic
    const schema = schemaOrShape as z.ZodTypeAny

    // Convert schema to Convex validator
    const convexValidator = zodToConvex(schema)

    // For unions, use defineTable directly (not Table helper which expects object fields)
    // Convex supports union validators in tables, but TypeScript can't verify the types
    const table = defineTable(asTableValidator(convexValidator))

    // Create document schema with system fields
    const docSchema = addSystemFields(name, schema)

    // Create docArray helper
    const docArray = z.array(docSchema)

    // Create update schema: _id required, _creationTime optional, user fields partial
    let updateSchema: z.ZodTypeAny
    if (isZodUnion(schema)) {
      const originalOptions = getUnionOptions(schema)
      const updateOptions = originalOptions.map((variant: z.ZodTypeAny) => {
        if (variant instanceof z.ZodObject) {
          // Create partial shape for user fields
          const partialShape: Record<string, z.ZodTypeAny> = {}
          for (const [key, value] of Object.entries(variant.shape)) {
            partialShape[key] = (value as z.ZodTypeAny).optional()
          }
          // Add system fields: _id required, _creationTime optional
          return z.object({
            _id: zid(name),
            _creationTime: z.number().optional(),
            ...partialShape
          })
        }
        return variant
      })
      updateSchema = createUnionFromOptions(updateOptions)
    } else if (schema instanceof z.ZodObject) {
      // Create partial shape for user fields
      const partialShape: Record<string, z.ZodTypeAny> = {}
      for (const [key, value] of Object.entries(schema.shape)) {
        partialShape[key] = (value as z.ZodTypeAny).optional()
      }
      // Add system fields: _id required, _creationTime optional
      updateSchema = z.object({
        _id: zid(name),
        _creationTime: z.number().optional(),
        ...partialShape
      })
    } else {
      updateSchema = schema
    }

    // Create schema namespace
    const schemaNamespace = {
      doc: docSchema,
      docArray,
      base: schema,
      insert: schema, // alias for base
      update: updateSchema
    }

    // Attach helpers for union tables
    // Return structure similar to Table() but without fields-based helpers
    return {
      table,
      tableName: name,
      validator: convexValidator,
      schema: schemaNamespace,
      docArray, // deprecated
      withSystemFields: () => addSystemFields(name, schema)
    }
  }
}
