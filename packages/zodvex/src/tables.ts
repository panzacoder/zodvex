import { defineTable } from 'convex/server'
import type { GenericId } from 'convex/values'
import { Table } from 'convex-helpers/server'
import { z } from 'zod'
import { type ConvexValidatorFromZodFieldsAuto, zodToConvex, zodToConvexFields } from './mapping'
import { createObjectSchemaBundle, createSchemaBundle } from './modelSchemaBundle'
import { addSystemFields, type MapSystemFields, type SystemFields } from './schemaHelpers'
import { $ZodObject, type $ZodShape, $ZodType, clone } from './zod-core'
import { type ZxId, zx } from './zx'

/**
 * System fields added to Convex documents.
 */
type DocSystemFields<TableName extends string> = {
  _id: ZxId<TableName>
  _creationTime: z.ZodNumber
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
 * Spreads the original def to preserve catchall, checks, and error settings.
 *
 * @deprecated Use `defineZodModel` instead. See migration guide (TODO: link).
 *
 * @param tableName - The Convex table name
 * @param schema - The Zod object schema for user fields
 * @returns A Zod object schema with _id and _creationTime added
 */
export function zodDoc<TableName extends string, Shape extends $ZodShape>(
  tableName: TableName,
  schema: z.ZodObject<Shape>
): z.ZodObject<Shape & DocSystemFields<TableName>> {
  const newShape = { ...schema._zod.def.shape, _id: zx.id(tableName), _creationTime: z.number() }
  // Clone preserves the original's class + reinitializes with merged def
  return clone(schema, { ...schema._zod.def, shape: newShape }) as z.ZodObject<
    Shape & DocSystemFields<TableName>
  >
}

/**
 * @deprecated Use `defineZodModel` instead. See migration guide (TODO: link).
 */
export function zodDocOrNull<
  TableName extends string,
  Shape extends $ZodShape,
  Schema extends z.ZodObject<Shape>
>(tableName: TableName, schema: Schema) {
  return z.union([zodDoc(tableName, schema), z.null()])
}

/**
 * Helper to detect if input is an object shape (plain object with Zod validators)
 */
function isObjectShape(input: any): input is Record<string, $ZodType> {
  // Check if it's a plain object (not a Zod instance)
  if (!input || typeof input !== 'object') return false

  // If it's a Zod instance, it's not an object shape
  if (input instanceof $ZodType) return false

  // Check if all values are Zod types
  for (const key in input) {
    if (!(input[key] instanceof $ZodType)) {
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
 * @deprecated Use `defineZodModel` instead. See migration guide (TODO: link).
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
type AddSystemFieldsResult<TableName extends string, Schema extends $ZodType> =
  Schema extends z.ZodObject<infer Shape extends z.ZodRawShape>
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
  _id: ZxId<TableName>
  _creationTime: z.ZodOptional<z.ZodNumber>
} & {
  [K in keyof Shape]: z.ZodOptional<Shape[K]>
}

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
type UpdateSchemaType<TableName extends string, Schema extends $ZodType> =
  Schema extends z.ZodUnion<infer Options extends readonly z.ZodTypeAny[]>
    ? z.ZodUnion<MapUpdateVariants<TableName, Options>>
    : Schema extends z.ZodDiscriminatedUnion<
          infer Options extends readonly z.ZodObject<z.ZodRawShape>[],
          infer _Disc extends string
        >
      ? z.ZodUnion<MapUpdateVariants<TableName, Options>>
      : Schema extends z.ZodObject<infer Shape extends z.ZodRawShape>
        ? z.ZodObject<UpdateShape<TableName, Shape>>
        : Schema

// Overload 1: Object shape (most common case - raw object with Zod validators)
export function zodTable<TableName extends string, Shape extends Record<string, $ZodType>>(
  name: TableName,
  shape: Shape
): ReturnType<typeof Table<ConvexValidatorFromZodFieldsAuto<Shape>, TableName>> & {
  shape: Shape
  /** @deprecated Use `schema.doc` instead */
  zDoc: z.ZodObject<
    Shape & {
      _id: ZxId<TableName>
      _creationTime: z.ZodNumber
    }
  >
  /** @deprecated Use `schema.docArray` instead */
  docArray: z.ZodArray<
    z.ZodObject<
      Shape & {
        _id: ZxId<TableName>
        _creationTime: z.ZodNumber
      }
    >
  >
  schema: {
    doc: z.ZodObject<
      Shape & {
        _id: ZxId<TableName>
        _creationTime: z.ZodNumber
      }
    >
    docArray: z.ZodArray<
      z.ZodObject<
        Shape & {
          _id: ZxId<TableName>
          _creationTime: z.ZodNumber
        }
      >
    >
    /** Paginated result schema matching Convex's PaginationResult shape */
    paginatedDoc: z.ZodObject<{
      page: z.ZodArray<z.ZodObject<Shape & { _id: ZxId<TableName>; _creationTime: z.ZodNumber }>>
      isDone: z.ZodBoolean
      continueCursor: z.ZodOptional<z.ZodNullable<z.ZodString>>
    }>
    /** The base schema - user fields without system fields */
    base: z.ZodObject<Shape>
    /** Alias for base - user fields for insert operations */
    insert: z.ZodObject<Shape>
    /** Update schema - _id required, _creationTime optional, user fields partial */
    update: z.ZodObject<UpdateShape<TableName, Shape>>
  }
}

// Overload 2: ZodObject wrapper (extracts shape for same type inference as raw shape)
export function zodTable<TableName extends string, Shape extends $ZodShape>(
  name: TableName,
  schema: z.ZodObject<Shape>
): ReturnType<typeof Table<ConvexValidatorFromZodFieldsAuto<Shape>, TableName>> & {
  shape: Shape
  /** @deprecated Use `schema.doc` instead */
  zDoc: z.ZodObject<
    Shape & {
      _id: ZxId<TableName>
      _creationTime: z.ZodNumber
    }
  >
  /** @deprecated Use `schema.docArray` instead */
  docArray: z.ZodArray<
    z.ZodObject<
      Shape & {
        _id: ZxId<TableName>
        _creationTime: z.ZodNumber
      }
    >
  >
  schema: {
    doc: z.ZodObject<
      Shape & {
        _id: ZxId<TableName>
        _creationTime: z.ZodNumber
      }
    >
    docArray: z.ZodArray<
      z.ZodObject<
        Shape & {
          _id: ZxId<TableName>
          _creationTime: z.ZodNumber
        }
      >
    >
    /** Paginated result schema matching Convex's PaginationResult shape */
    paginatedDoc: z.ZodObject<{
      page: z.ZodArray<z.ZodObject<Shape & { _id: ZxId<TableName>; _creationTime: z.ZodNumber }>>
      isDone: z.ZodBoolean
      continueCursor: z.ZodOptional<z.ZodNullable<z.ZodString>>
    }>
    /** The base schema - user fields without system fields */
    base: z.ZodObject<Shape>
    /** Alias for base - user fields for insert operations */
    insert: z.ZodObject<Shape>
    /** Update schema - _id required, _creationTime optional, user fields partial */
    update: z.ZodObject<UpdateShape<TableName, Shape>>
  }
}

// Overload 3: Union/schema types
export function zodTable<TableName extends string, Schema extends $ZodType>(
  name: TableName,
  schema: Schema
): {
  table: ReturnType<typeof defineTable>
  tableName: TableName
  validator: ReturnType<typeof zodToConvex<Schema>>
  schema: {
    doc: AddSystemFieldsResult<TableName, Schema>
    docArray: z.ZodArray<AddSystemFieldsResult<TableName, Schema>>
    /** Paginated result schema matching Convex's PaginationResult shape */
    paginatedDoc: z.ZodObject<{
      page: z.ZodArray<AddSystemFieldsResult<TableName, Schema>>
      isDone: z.ZodBoolean
      continueCursor: z.ZodOptional<z.ZodNullable<z.ZodString>>
    }>
    /** The base schema - user fields without system fields */
    base: Schema
    /** Alias for base - user fields for insert operations */
    insert: Schema
    /** Update schema - _id required, _creationTime optional, user fields partial */
    update: UpdateSchemaType<TableName, Schema>
  }
  /** @deprecated Use `schema.docArray` instead */
  docArray: z.ZodArray<AddSystemFieldsResult<TableName, Schema>>
  withSystemFields: () => AddSystemFieldsResult<TableName, Schema>
}

export function zodTable<
  TableName extends string,
  SchemaOrShape extends $ZodType | Record<string, $ZodType>
>(name: TableName, schemaOrShape: SchemaOrShape): any {
  // Detect if it's an object shape, ZodObject, or other schema
  // For ZodObject: extract its shape to use the type-preserving path
  const isZodObject = schemaOrShape instanceof $ZodObject
  if (isObjectShape(schemaOrShape) || isZodObject) {
    // Extract shape from ZodObject or use raw shape directly
    const shape = isZodObject
      ? (schemaOrShape as z.ZodObject<z.ZodRawShape>).shape
      : (schemaOrShape as Record<string, $ZodType>)

    // Convert fields with proper types
    const convexFields = zodToConvexFields(shape) as ConvexValidatorFromZodFieldsAuto<typeof shape>

    // Create the Table from convex-helpers with explicit type
    const table = Table<ConvexValidatorFromZodFieldsAuto<typeof shape>, TableName>(
      name,
      convexFields
    )

    // Create base schema (user fields only, no system fields)
    // When a ZodObject is passed, preserve it to maintain options like .passthrough(), .strict(), .catchall()
    const baseSchema = isZodObject ? (schemaOrShape as z.ZodObject<z.ZodRawShape>) : z.object(shape)
    const schema = createObjectSchemaBundle(name, shape, baseSchema as z.ZodObject<any>)
    const zDoc = schema.doc
    const docArray = schema.docArray

    // Attach everything for comprehensive usage
    // zDoc and docArray are deprecated but kept for backwards compatibility
    // TypeScript @deprecated annotations provide compile-time warnings
    return Object.assign(table, {
      shape,
      schema,
      zDoc,
      docArray
    })
  } else {
    // Union or other schema type logic
    const schema = schemaOrShape as $ZodType

    // Convert schema to Convex validator
    const convexValidator = zodToConvex(schema)

    // For unions, use defineTable directly (not Table helper which expects object fields)
    // Convex supports union validators in tables, but TypeScript can't verify the types
    const table = defineTable(asTableValidator(convexValidator))
    const schemaNamespace = createSchemaBundle(name, schema)

    // Attach helpers for union tables
    // Return structure similar to Table() but without fields-based helpers
    return {
      table,
      tableName: name,
      validator: convexValidator,
      schema: schemaNamespace,
      docArray: schemaNamespace.docArray, // deprecated
      withSystemFields: () => schemaNamespace.doc
    }
  }
}
